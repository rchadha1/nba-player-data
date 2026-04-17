"""
Analyses historical player events to generate a bet recommendation.
This is the core logic — expand with your own model over time.
"""
import pandas as pd
from typing import Optional
from app.services.nba_service import get_player_game_log

PRED_PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT"]
_SHRINK_K = 8  # higher = more conservative, pulls harder toward season avg


def _parse_stat(value) -> float:
    """Handle plain numbers and ESPN's 'made-attempted' strings like '2-5'."""
    try:
        return float(str(value or 0).split("-")[0])
    except ValueError:
        return 0.0


def _avg(games: list[dict], prop: str) -> float:
    vals = [_parse_stat(g.get(prop, 0)) for g in games]
    return round(sum(vals) / len(vals), 1) if vals else 0.0


def _weight(n: int) -> float:
    """Bayesian shrinkage weight: 0 with no data, approaches 1 with large n."""
    return n / (n + _SHRINK_K)


def _filter_vs(games: list[dict], opponent: str) -> list[dict]:
    needle = opponent.strip().lower()
    return [
        g for g in games
        if needle in g.get("opponent_name", "").lower()
        or needle in g.get("opponent_abbr", "").lower()
        or needle in g.get("matchup", "").lower()
    ]


def predict_game_performance(
    player_id: str,
    opponent: str,
    without_teammate_id: Optional[str],
    season: str = "2026",
) -> dict:
    """
    Projects per-stat expected values for an upcoming game given:
      - opponent team
      - a teammate who will be absent

    Method: additive adjustment with Bayesian shrinkage.
      expected = season_avg
               + (opp_avg   - season_avg) * opp_weight
               + (wo_avg    - season_avg) * wo_weight

    Each factor only moves the projection proportionally to how much data
    backs it up (shrinkage constant _SHRINK_K). If games exist where BOTH
    conditions held (vs this opponent AND without this teammate), those are
    blended in with their own weight as the most direct evidence.

    Confidence:
      high   — intersection >= 3 games
      medium — opp_games >= 3 AND without_games >= 5
      low    — otherwise (treat projection as directional, not precise)
    """
    all_games = get_player_game_log(player_id, season)
    if not all_games:
        return {}

    opp_games = _filter_vs(all_games, opponent)

    if without_teammate_id:
        tm_game_ids = {g["game_id"] for g in get_player_game_log(without_teammate_id, season)}
        wo_games    = [g for g in all_games if g["game_id"] not in tm_game_ids]
        ix_games    = [g for g in opp_games  if g["game_id"] not in tm_game_ids]
    else:
        wo_games = all_games
        ix_games = opp_games

    n_season = len(all_games)
    n_opp    = len(opp_games)
    n_wo     = len(wo_games)
    n_ix     = len(ix_games)

    props_out = {}
    for prop in PRED_PROPS:
        season_avg = _avg(all_games, prop)
        opp_avg    = _avg(opp_games, prop)  if n_opp else season_avg
        wo_avg     = _avg(wo_games,  prop)  if n_wo  else season_avg
        ix_avg     = _avg(ix_games,  prop)  if n_ix  else None

        opp_w = _weight(n_opp)
        wo_w  = _weight(n_wo)

        additive = round(
            season_avg
            + (opp_avg - season_avg) * opp_w
            + (wo_avg  - season_avg) * wo_w,
            1,
        )

        # If intersection data exists, blend it in weighted by its own sample size
        if ix_avg is not None and n_ix > 0:
            ix_w     = _weight(n_ix)
            expected = round((1 - ix_w) * additive + ix_w * ix_avg, 1)
        else:
            expected = additive

        if n_ix >= 3:
            confidence = "high"
        elif n_opp >= 3 and n_wo >= 5:
            confidence = "medium"
        else:
            confidence = "low"

        # Flag when the without-teammate factor is pulling DOWN — means the
        # data contradicts the "more opportunity" assumption. Could be selection
        # bias (injury games, load management) rather than a real effect.
        wo_direction_warning = without_teammate_id is not None and wo_avg < season_avg

        props_out[prop] = {
            "season_avg":              season_avg,
            "vs_opponent_avg":         opp_avg,
            "without_teammate_avg":    wo_avg,
            "intersection_avg":        ix_avg,
            "expected":                expected,
            "confidence":              confidence,
            "wo_direction_warning":    wo_direction_warning,
        }

    return {
        "player_id":   player_id,
        "opponent":    opponent,
        "sample_sizes": {
            "season":             n_season,
            "vs_opponent":        n_opp,
            "without_teammate":   n_wo if without_teammate_id else None,
            "intersection":       n_ix if without_teammate_id else None,
        },
        "props": props_out,
        # Expose the actual game dates so the caller can inspect sample quality
        "without_teammate_games": [
            {"date": g.get("date"), "matchup": g.get("matchup"), "result": g.get("result")}
            for g in wo_games
        ] if without_teammate_id else [],
    }


def _hit_rate(values: list[float], line: float) -> float:
    """% of games a player went over the given line."""
    if not values:
        return 0.0
    return round(sum(1 for v in values if v > line) / len(values), 3)


def analyze_player_prop(
    player_id: str,
    prop: str,  # "PTS", "REB", "AST", "STL", "BLK", "3PT"
    line: float,
    last_n_games: int = 10,
    season: str = "2026",
    opponent: Optional[str] = None,
) -> dict:
    """
    Returns a simple hit-rate analysis for a player prop over the last N games.
    If opponent is provided, analysis is restricted to games vs that team only.
    Extend this with ML models, opponent defence ratings, home/away splits, etc.
    """
    games = get_player_game_log(player_id, season)

    if opponent:
        needle = opponent.strip().lower()
        games = [
            g for g in games
            if needle in g.get("opponent_name", "").lower()
            or needle in g.get("opponent_abbr", "").lower()
            or needle in g.get("matchup", "").lower()
        ]

    recent = games[:last_n_games]

    values = [float(str(g.get(prop, 0) or 0).split("-")[0] or 0) for g in recent]
    avg = round(sum(values) / len(values), 2) if values else 0.0
    hit = _hit_rate(values, line)

    recommendation = "OVER" if hit >= 0.6 else "UNDER" if hit <= 0.4 else "PASS"

    return {
        "player_id":   player_id,
        "prop":        prop,
        "line":        line,
        "last_n_games": last_n_games,
        "opponent":    opponent,
        "games_found": len(games),
        "average":     avg,
        "hit_rate":    hit,
        "recommendation": recommendation,
        "game_values": values,
    }
