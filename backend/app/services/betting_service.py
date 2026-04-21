"""
Analyses historical player events to generate a bet recommendation.
This is the core logic — expand with your own model over time.
"""
import pandas as pd
from typing import Optional
from app.services.nba_service import get_player_game_log, get_player_season_averages, get_team_defensive_matchup

PRED_PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT"]
_SHRINK_K       = 8    # games shrinkage: pulls toward season avg
_SERIES_K       = 3    # series shrinkage: looser — even 1 game carries real signal
_DECAY          = 0.75 # recency decay per game (1.0 = equal weight, lower = heavier on recent)
_SERIES_CORR_K  = 1    # error correction from same-series saved actuals: 1 game = 50% weight
_PLAYER_BIAS_K  = 5    # error correction from all player actuals: 5 games = 50% weight
_REGRESS_K      = 4    # regression-to-mean anchor: higher = slower to trust deviations
_HOME_AWAY_K    = 10   # home/away split: slightly conservative (location is a weaker signal)


def _parse_stat(value) -> float:
    """Handle plain numbers and ESPN's 'made-attempted' strings like '2-5'."""
    try:
        return float(str(value or 0).split("-")[0])
    except ValueError:
        return 0.0


def _avg(games: list[dict], prop: str) -> float:
    vals = [_parse_stat(g.get(prop, 0)) for g in games]
    return round(sum(vals) / len(vals), 1) if vals else 0.0


def _wavg(games: list[dict], prop: str, decay: float = _DECAY) -> float:
    """Exponentially decay-weighted average — index 0 (most recent) gets weight 1.0."""
    vals = [_parse_stat(g.get(prop, 0)) for g in games]
    if not vals:
        return 0.0
    weights = [decay ** i for i in range(len(vals))]
    total_w = sum(weights)
    return round(sum(v * w for v, w in zip(vals, weights)) / total_w, 1)


def _weight(n: int, k: int = _SHRINK_K) -> float:
    """Bayesian shrinkage weight: 0 with no data, approaches 1 with large n."""
    return n / (n + k)


def _load_corrections(player_id: str, opponent: str) -> tuple[list[dict], list[dict]]:
    """
    Returns (series_deltas, player_deltas) — lists of {stat: actual-predicted} dicts.
    series_deltas: same player + same opponent only (most recent first).
    player_deltas: all saved actuals for this player (any opponent).
    """
    try:
        import json as _json
        from app.db import get_conn
        with get_conn() as conn:
            rows = conn.execute(
                """SELECT props, actual_stats, opponent FROM predictions
                   WHERE player_id=? AND actual_stats IS NOT NULL
                   ORDER BY created_at DESC""",
                (player_id,),
            ).fetchall()
    except Exception:
        return [], []

    series_deltas: list[dict] = []
    player_deltas: list[dict] = []
    opp_norm = opponent.strip().lower()

    for row in rows:
        try:
            props   = _json.loads(row["props"])   if isinstance(row["props"],   str) else row["props"]
            actuals = _json.loads(row["actual_stats"]) if isinstance(row["actual_stats"], str) else row["actual_stats"]
            row_opp = (row["opponent"] or "").strip().lower()
        except Exception:
            continue

        delta: dict[str, float] = {}
        for stat in PRED_PROPS:
            if stat in actuals and stat in props and isinstance(props[stat], dict):
                predicted = props[stat].get("expected")
                if predicted is not None:
                    delta[stat] = float(actuals[stat]) - float(predicted)

        if not delta:
            continue

        player_deltas.append(delta)
        if row_opp == opp_norm:
            series_deltas.append(delta)

    return series_deltas, player_deltas


def _filter_vs(games: list[dict], opponent: str) -> list[dict]:
    needle = opponent.strip().lower()
    return [
        g for g in games
        if needle in g.get("opponent_name", "").lower()
        or needle in g.get("opponent_abbr", "").lower()
        or needle in g.get("matchup", "").lower()
    ]


def _filter_series(opp_games: list[dict], max_gap_days: int = 10) -> list[dict]:
    """
    Current playoff series: most-recent consecutive games vs opponent
    with no gap larger than max_gap_days between them.
    A gap >10 days signals a series/season boundary (playoff series games
    are 2-4 days apart; regular-season-to-playoff gap is typically 2+ weeks).
    """
    from datetime import datetime
    if not opp_games:
        return []
    series = [opp_games[0]]
    for i in range(1, len(opp_games)):
        try:
            t_newer = datetime.fromisoformat(opp_games[i - 1]["date"].replace("Z", "+00:00"))
            t_older = datetime.fromisoformat(opp_games[i]["date"].replace("Z", "+00:00"))
            if (t_newer - t_older).days <= max_gap_days:
                series.append(opp_games[i])
            else:
                break  # gap too large — prior game is a different series/season
        except Exception:
            break
    return series


def predict_game_performance(
    player_id: str,
    opponent: str,
    without_teammate_ids: Optional[list[str]],
    season: str = "2026",
    is_home: Optional[bool] = None,
) -> dict:
    """
    Projects per-stat expected values for an upcoming game.

    Formula (additive, Bayesian-shrunk):
      expected_PTS = season_avg
        + (opp_team_avg  - season_avg) * weight(n_opp_games,  K=8)   # box-score vs this team
        + (wo_avg        - season_avg) * weight(n_wo_games,   K=8)   # without teammate
        + (last5_avg     - season_avg) * weight(5,            K=8)   # recent form
        + (def_factor-1) * season_avg * weight(total_poss,   K=50)  # possession-level defender adjustment

    def_factor = team_matchup_fg_pct / season_fg_pct
      Aggregates FG% allowed across ALL opponent defenders vs this player.
      K=50 possessions so thin samples barely move the needle.

    All other stats (REB/AST/STL/BLK/3PT) use the first three terms only —
    possession-level matchup data only gives reliable signal for PTS via FG%.
    """
    all_games = get_player_game_log(player_id, season)
    if not all_games:
        return {}

    official_avgs = get_player_season_averages(player_id, season)
    last5_games   = all_games[:5]
    opp_games     = _filter_vs(all_games, opponent)
    series_games  = _filter_series(opp_games)

    if without_teammate_ids:
        tm_game_ids: set[str] = set()
        for tid in without_teammate_ids:
            tm_game_ids.update(g["game_id"] for g in get_player_game_log(tid, season))
        wo_games = [g for g in all_games if g["game_id"] not in tm_game_ids]
        ix_games = [g for g in opp_games  if g["game_id"] not in tm_game_ids]
    else:
        wo_games = all_games
        ix_games = opp_games

    home_games     = [g for g in all_games if g.get("home_away") == "home"]
    away_games     = [g for g in all_games if g.get("home_away") == "away"]
    location_games = (home_games if is_home else away_games) if is_home is not None else None

    n_season   = len(all_games)
    n_opp      = len(opp_games)
    n_wo       = len(wo_games)
    n_ix       = len(ix_games)
    n_l5       = len(last5_games)
    n_series   = len(series_games)
    n_location = len(location_games) if location_games is not None else 0

    # Load error corrections from previously saved predictions with actuals recorded
    series_deltas, player_deltas = _load_corrections(player_id, opponent)
    n_series_corr = len(series_deltas)
    n_player_corr = len(player_deltas)

    # --- Possession-level defender adjustment (PTS only) ---
    def_matchup     = get_team_defensive_matchup(player_id, opponent, season)
    # ESPN stores FG% as e.g. 51.5 (percentage); convert to decimal
    _raw_fg = official_avgs.get("FG%") or official_avgs.get("FG_PCT") or 0.0
    season_fg_pct = _raw_fg / 100.0 if _raw_fg > 1.0 else _raw_fg
    def_factor      = 1.0
    def_poss        = 0
    def_season_used = None

    if def_matchup and season_fg_pct and def_matchup.get("total_fga", 0) >= 5:
        def_factor      = def_matchup["team_fg_pct"] / season_fg_pct
        def_poss        = def_matchup["total_poss"]
        def_season_used = f"{def_matchup['season']} {def_matchup['season_type']}"

    # K=50 possessions for defender weight (vs K=8 games for box-score factors)
    def_w = def_poss / (def_poss + 50) if def_poss else 0.0

    props_out = {}
    for prop in PRED_PROPS:
        season_avg  = official_avgs.get(prop) if official_avgs.get(prop) else _avg(all_games, prop)
        opp_avg     = _avg(opp_games,    prop) if n_opp   else season_avg
        wo_avg      = _avg(wo_games,     prop) if n_wo    else season_avg
        # recency-weighted last 5 (most recent game weighted highest)
        l5_avg      = _wavg(last5_games, prop) if n_l5    else season_avg
        ix_avg      = _avg(ix_games,     prop) if n_ix    else None
        series_avg  = _wavg(series_games, prop) if n_series else None

        opp_w    = _weight(n_opp)
        wo_w     = _weight(n_wo)
        l5_w     = _weight(n_l5)

        additive = round(
            season_avg
            + (opp_avg - season_avg) * opp_w
            + (wo_avg  - season_avg) * wo_w
            + (l5_avg  - season_avg) * l5_w,
            1,
        )

        if ix_avg is not None and n_ix > 0:
            ix_w     = _weight(n_ix)
            additive = round((1 - ix_w) * additive + ix_w * ix_avg, 1)

        # Same-series signal: tighter K so even 1 game moves the needle
        if series_avg is not None and n_series > 0:
            s_w      = _weight(n_series, k=_SERIES_K)
            additive = round((1 - s_w) * additive + s_w * series_avg, 1)

        # Home/away split — applied after series blend, before defender adj
        loc_avg = None
        if location_games is not None and n_location > 0:
            loc_avg  = _avg(location_games, prop)
            loc_w    = _weight(n_location, k=_HOME_AWAY_K)
            additive = round(additive + (loc_avg - season_avg) * loc_w, 1)

        # Apply defender adjustment to PTS only.
        # Dampen it as series data accumulates — actual game results
        # override pre-series matchup data (K=_SERIES_K same as series blend).
        if prop == "PTS" and def_w > 0:
            series_dampen = 1.0 - _weight(n_series, k=_SERIES_K) if n_series else 1.0
            def_adj  = round((def_factor - 1.0) * season_avg * def_w * series_dampen, 1)
            expected = round(additive + def_adj, 1)
        else:
            def_adj  = 0.0
            expected = additive

        # --- Error corrections from saved actuals ---
        # Series correction: avg delta from prior games vs this same opponent.
        # 1 prior game → 50% weight, 2 games → 67%, etc.
        series_corr = 0.0
        if n_series_corr > 0:
            avg_series_delta = sum(d.get(prop, 0.0) for d in series_deltas) / n_series_corr
            series_corr = round(avg_series_delta * _weight(n_series_corr, k=_SERIES_CORR_K), 1)
            expected = round(expected + series_corr, 1)

        # Player bias correction: avg delta across ALL saved actuals for this player.
        # Dampened as series corrections grow (series data is more specific).
        player_corr = 0.0
        if n_player_corr > 0:
            avg_player_delta = sum(d.get(prop, 0.0) for d in player_deltas) / n_player_corr
            p_dampen = 1.0 - _weight(n_series_corr, k=_SERIES_CORR_K) if n_series_corr else 1.0
            player_corr = round(avg_player_delta * _weight(n_player_corr, k=_PLAYER_BIAS_K) * p_dampen, 1)
            expected = round(expected + player_corr, 1)

        # Regression-to-mean: final pull back toward season_avg.
        # Strength weakens as confirmed series data accumulates (series games + saved actuals).
        n_anchor  = n_series + n_series_corr
        revert_w  = 1.0 - _weight(n_anchor, k=_REGRESS_K)
        expected  = round(expected - (expected - season_avg) * revert_w * 0.5, 1)

        if n_series >= 3 or n_ix >= 3:
            confidence = "high"
        elif n_opp >= 3 and n_wo >= 5:
            confidence = "medium"
        else:
            confidence = "low"

        wo_direction_warning = bool(without_teammate_ids) and wo_avg < season_avg

        props_out[prop] = {
            "season_avg":           season_avg,
            "vs_opponent_avg":      opp_avg,
            "without_teammate_avg": wo_avg,
            "last5_avg":            l5_avg,
            "series_avg":           series_avg,
            "intersection_avg":     ix_avg,
            "defender_adj":         def_adj if prop == "PTS" else None,
            "location_avg":         loc_avg,
            "series_correction":    series_corr if n_series_corr > 0 else None,
            "player_bias":          player_corr if n_player_corr > 0 else None,
            "expected":             expected,
            "confidence":           confidence,
            "wo_direction_warning": wo_direction_warning,
        }

    return {
        "player_id":  player_id,
        "opponent":   opponent,
        "sample_sizes": {
            "season":           n_season,
            "vs_opponent":      n_opp,
            "series":           n_series,
            "without_teammate": n_wo if without_teammate_ids else None,
            "intersection":     n_ix if without_teammate_ids else None,
            "last5":            n_l5,
            "def_poss":         def_poss,
        },
        "defender_matchup": {
            "season_used":  def_season_used,
            "team_fg_pct":  def_matchup.get("team_fg_pct") if def_matchup else None,
            "season_fg_pct": season_fg_pct,
            "def_factor":   round(def_factor, 3),
            "total_poss":   def_poss,
            "defenders":    def_matchup.get("defenders", []) if def_matchup else [],
        },
        "props": props_out,
        "without_teammate_games": [
            {"date": g.get("date"), "matchup": g.get("matchup"), "result": g.get("result")}
            for g in wo_games
        ] if without_teammate_ids else [],
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
