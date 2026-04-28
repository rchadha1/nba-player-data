"""
Analyses historical player events to generate a bet recommendation.
This is the core logic — expand with your own model over time.
"""
import pandas as pd
from typing import Optional
from app.services.nba_service import (
    get_player_game_log, get_player_season_averages, get_team_defensive_matchup,
    get_team_pace_map, get_player_team_abbr, _ESPN_TO_NBA_ABBR,
    get_player_foul_trouble, get_player_shot_zones, get_paint_cause_analysis,
    get_player_injury_status,
)

PRED_PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT", "3PA", "FTM", "2PM", "FTA", "2PA"]
_SHRINK_K            = 8    # games shrinkage: pulls toward season avg
_SERIES_K            = 3    # series shrinkage: looser — even 1 game carries real signal
_DECAY               = 0.75 # recency decay per game (1.0 = equal weight, lower = heavier on recent)
_SERIES_DECAY        = 0.50 # heavier decay for series games — most recent game is the current truth
_SERIES_CORR_K       = 1    # error correction from same-series saved actuals: 1 game = 50% weight
_PLAYER_BIAS_K       = 5    # error correction from all player actuals: 5 games = 50% weight
_REGRESS_K           = 4    # regression-to-mean anchor: higher = slower to trust deviations
_HOME_AWAY_K         = 10   # home/away split: slightly conservative (location is a weaker signal)
_DEF_ADJ_DAMPEN_K    = 1    # defender adj dampening: 1 series game → 50%, 2 → 33%, 3 → 25%
_MIN_WARNING_THRESH  = 0.75 # flag if last series game minutes < 75% of season average


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


def _stddev(games: list[dict], prop: str) -> Optional[float]:
    """Population std dev of a stat across games. None if fewer than 3 games."""
    vals = [_parse_stat(g.get(prop, 0)) for g in games]
    if len(vals) < 3:
        return None
    mean = sum(vals) / len(vals)
    variance = sum((v - mean) ** 2 for v in vals) / len(vals)
    return round(variance ** 0.5, 2)


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


def _find_nba_abbr(opponent: str) -> Optional[str]:
    """Resolve any opponent string (full name, nickname, abbr) to an nba_api abbreviation."""
    from nba_api.stats.static import teams as nba_teams_static
    needle = opponent.strip().lower()
    for team in nba_teams_static.get_teams():
        if (needle == team["abbreviation"].lower()
                or needle in team["full_name"].lower()
                or needle == team["nickname"].lower()
                or needle == team["city"].lower()):
            return team["abbreviation"]
    # Fallback: try ESPN→NBA mapping
    return _ESPN_TO_NBA_ABBR.get(opponent.strip().upper())


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
    anchor_type = opp_games[0].get("season_type", "")
    for i in range(1, len(opp_games)):
        try:
            t_newer = datetime.fromisoformat(opp_games[i - 1]["date"].replace("Z", "+00:00"))
            t_older = datetime.fromisoformat(opp_games[i]["date"].replace("Z", "+00:00"))
            game_type = opp_games[i].get("season_type", "")
            if (t_newer - t_older).days <= max_gap_days and (not anchor_type or not game_type or game_type == anchor_type):
                series.append(opp_games[i])
            else:
                break  # gap too large or crossed a season-type boundary
        except Exception:
            break
    return series


def _parse_fga(game: dict) -> float:
    """Extract field goal attempts from ESPN's 'made-attempted' FG string."""
    fg = str(game.get("FG", "0-0"))
    if "-" in fg:
        parts = fg.split("-")
        try:
            return float(parts[1]) if len(parts) > 1 else 0.0
        except ValueError:
            return 0.0
    return 0.0


def _role_index(game: dict) -> Optional[float]:
    """AST / (AST + FGA). 1.0 = pure facilitator, 0.0 = pure scorer."""
    ast = _parse_stat(game.get("AST", 0))
    fga = _parse_fga(game)
    total = ast + fga
    return round(ast / total, 2) if total > 0 else None


def _detect_role_pattern(series_games: list[dict]) -> dict:
    """
    Returns the role pattern across series games (most recent first).
    pattern: 'alternating' | 'trending_scorer' | 'trending_facilitator' | 'scorer' | 'facilitator' | 'unknown'
    """
    indices = [i for i in [_role_index(g) for g in series_games] if i is not None]
    if not indices:
        return {"pattern": "unknown", "last_role": None, "indices": []}

    last_role = "facilitator" if indices[0] >= 0.45 else "scorer"

    if len(indices) < 2:
        return {"pattern": last_role, "last_role": last_role, "indices": indices}

    prev_role = "facilitator" if indices[1] >= 0.45 else "scorer"

    if last_role != prev_role:
        pattern = "alternating"
    elif last_role == "scorer":
        pattern = "trending_scorer"
    else:
        pattern = "trending_facilitator"

    return {"pattern": pattern, "last_role": last_role, "indices": indices}


def _generate_summary(
    opponent: str,
    props_out: dict,
    sample_sizes: dict,
    pace_ratio: float,
    without_teammate_ids: Optional[list[str]],
    foul_trouble: dict,
    shot_zones: dict,
    role_pattern: dict,
    is_home: Optional[bool],
    series_correction: float,
) -> str:
    pts = props_out.get("PTS", {})
    ast = props_out.get("AST", {})
    n_series = sample_sizes.get("series", 0)
    parts = []

    # Role pattern — lead with this if we have series data, it's the most actionable signal
    if n_series >= 2 and role_pattern.get("pattern") not in ("unknown", None):
        p = role_pattern["pattern"]
        lr = role_pattern["last_role"]
        ri = role_pattern.get("indices", [])
        ri_strs = [f"G{i+1}: {round(v*100)}% AST-rate" for i, v in enumerate(ri)]
        if p == "alternating":
            next_role = "facilitator" if lr == "scorer" else "scorer"
            parts.append(
                f"Role has alternated each game this series ({', '.join(ri_strs)}) — "
                f"last game was {lr}-first, projection leans {next_role} for Game {n_series + 1}."
            )
        elif p == "trending_scorer":
            parts.append(f"Scoring-first in both series games ({', '.join(ri_strs)}) — slight scorer continuation edge applied.")
        elif p == "trending_facilitator":
            parts.append(f"Facilitator-first in both series games ({', '.join(ri_strs)}) — slight playmaker continuation applied, dampening PTS.")

    # Pace
    if abs(pace_ratio - 1.0) >= 0.04:
        pct = round(abs(1 - pace_ratio) * 100, 1)
        direction = "slower" if pace_ratio < 1.0 else "faster"
        parts.append(
            f"Matchup pace is {pct}% {direction} than regular season, pulling all averages {'down' if pace_ratio < 1.0 else 'up'} before blending."
        )

    # Without teammate effect on scoring
    if without_teammate_ids and pts.get("without_teammate_avg") is not None and pts.get("season_avg") is not None:
        diff = round(pts["without_teammate_avg"] - pts["season_avg"], 1)
        if abs(diff) >= 1.5:
            direction = "higher" if diff > 0 else "lower"
            parts.append(
                f"Without his teammates, scoring avg runs {abs(diff)} pts {direction} ({pts['without_teammate_avg']} vs {pts['season_avg']} season) — heavier usage load factored in."
            )

    # Series form vs corrections
    if n_series >= 1 and pts.get("series_avg") is not None:
        correction_note = f", with a +{series_correction} correction from outperforming earlier predictions" if series_correction >= 1.0 else ""
        parts.append(
            f"Series average of {pts['series_avg']} pts across {n_series} game{'s' if n_series > 1 else ''}{correction_note}."
        )

    # Defender matchup
    def_adj = pts.get("defender_adj")
    if def_adj is not None and abs(def_adj) >= 0.8:
        direction = "favorable" if def_adj > 0 else "unfavorable"
        parts.append(
            f"Defender matchup is {direction} ({'+' if def_adj > 0 else ''}{def_adj} pts) based on possession-level matchup data vs {opponent}."
        )

    # Foul trouble
    if foul_trouble.get("warning"):
        avg_f = foul_trouble.get("avg_fouls", 0)
        parts.append(
            f"Foul trouble risk ({avg_f} fouls/game avg in series) applies a minutes-reduction to all counting stats."
        )

    # Shot zone drift
    if shot_zones and shot_zones.get("paint_drift_warning"):
        drift = shot_zones.get("drift", {}).get("paint", 0.0)
        parts.append(
            f"Paint access down {round(abs(drift) * 100, 1)}pp in this series vs baseline — shot zone adjustment applied to PTS."
        )

    # Road game note
    if is_home is False and n_series == 0:
        parts.append(f"Road game vs {opponent}.")

    return " ".join(parts[:5])


def predict_game_performance(
    player_id: str,
    opponent: str,
    without_teammate_ids: Optional[list[str]],
    season: str = "2026",
    is_home: Optional[bool] = None,
    spread: Optional[float] = None,
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

    # --- New risk variables ---
    season_pf  = official_avgs.get("PF", 0.0)
    season_min = official_avgs.get("MIN", 0.0)
    pf_per_36  = round(season_pf / season_min * 36, 1) if season_min > 0 else 0.0

    min_std_dev = _stddev(all_games[:15], "MIN")

    # Blowout spread penalty: road underdog in a big spread game sees suppressed stats
    # from game-script distortion (chasing, desperate shot selection, reduced Q4 run).
    # Positive spread = player's team is underdog by that many points.
    spread_blowout_penalty = 1.0
    if spread is not None and is_home is False and spread >= 7:
        spread_blowout_penalty = max(0.80, 1.0 - ((spread - 7) / 3.5) * 0.05)
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

    # --- Series game IDs (used by foul trouble + shot zones) ---
    series_game_ids   = [g["game_id"] for g in series_games if g.get("game_id")]
    series_game_id_set = set(series_game_ids)
    # Baseline = most recent non-series games (up to 5) for shot zone comparison
    baseline_game_ids = [g["game_id"] for g in all_games if g.get("game_id") and g["game_id"] not in series_game_id_set][:5]

    # --- Foul trouble (series PBP) ---
    foul_trouble: dict = {}
    try:
        if series_game_ids:
            foul_trouble = get_player_foul_trouble(player_id, series_game_ids)
    except Exception:
        pass

    injury_status = "Active"
    try:
        injury_status = get_player_injury_status(player_id)
    except Exception:
        pass

    # --- Shot zones (series vs baseline PBP) ---
    shot_zones: dict = {}
    try:
        if series_game_ids:
            shot_zones = get_player_shot_zones(player_id, series_game_ids, baseline_game_ids)
    except Exception:
        pass

    # --- Minutes flag ---
    # Warn if the most recent series game saw the player in a significantly
    # reduced role vs their season average (coaching decision / benching).
    season_avg_min   = _parse_stat(official_avgs.get("MIN", 0))
    series_game_mins = [_parse_stat(g.get("MIN", 0)) for g in series_games]
    last5_mins       = [_parse_stat(g.get("MIN", 0)) for g in last5_games]
    last_series_min  = series_game_mins[0] if series_game_mins else None
    last5_avg_min    = round(sum(last5_mins) / len(last5_mins), 1) if last5_mins else None
    min_warning      = (
        last_series_min is not None
        and season_avg_min > 0
        and last_series_min < _MIN_WARNING_THRESH * season_avg_min
    )

    # --- Blowout / series game-script risk ---
    # Only meaningful when we have series games (strong proxy for playoffs — regular
    # season rematches rarely fall within the 10-day _filter_series window).
    blowout_risk: dict = {"warning": False, "series_record": None, "message": ""}
    if n_series >= 1:
        s_wins  = sum(1 for g in series_games if g.get("result") == "W")
        s_losses = sum(1 for g in series_games if g.get("result") == "L")
        record_str = f"{s_wins}-{s_losses}"
        if s_losses > s_wins:
            blowout_risk = {
                "warning": True,
                "series_record": record_str,
                "message": (
                    f"Team is down {record_str} in this series. "
                    "Desperation game script risk — secondary scorers on the losing team "
                    "can exceed projections in garbage time or comeback attempts. "
                    "Treat UNDER bets on role players with extra caution."
                ),
            }
        elif s_wins > s_losses:
            blowout_risk = {
                "warning": True,
                "series_record": record_str,
                "message": (
                    f"Team leads {record_str} in this series. "
                    "If this game becomes a blowout, starters may be rested late. "
                    "OVER bets on stars carry sit-risk; UNDER bets on role players carry garbage-time inflation risk."
                ),
            }
        # 1-1 or equal series — no directional flag, both teams playing straight up

    # Foul trouble minutes reduction: each foul above 2 costs ~2.5 min
    # Cap reduction at 15% so the adjustment stays conservative
    avg_fouls = foul_trouble.get("avg_fouls", 0.0)
    if avg_fouls > 2.0 and season_avg_min > 0:
        mins_lost = (avg_fouls - 2.0) * 2.5
        foul_adj_factor = max(0.85, 1.0 - mins_lost / season_avg_min)
    else:
        foul_adj_factor = 1.0

    # Shot zone paint drift — negative adjustment to PTS when player is pushed off paint
    paint_drift = shot_zones.get("drift", {}).get("paint", 0.0) if shot_zones else 0.0
    series_shot_attempts = shot_zones.get("series", {}).get("total_attempts", 0) if shot_zones else 0

    # Per-stat shot zone adjustment factors.
    # Applied when paint drift < -12% and series has at least 4 shot attempts (1 game of data).
    # Multipliers reflect how strongly each stat depends on interior positioning.
    _SZ_MULT  = {"PTS": 0.30, "REB": 0.25, "BLK": 0.25, "AST": 0.15, "FTM": 0.40}
    _SZ_FLOOR = {"PTS": 0.90, "REB": 0.92, "BLK": 0.92, "AST": 0.94, "FTM": 0.82}
    shot_zone_factors: dict[str, float] = {}
    paint_cause: dict = {}
    if paint_drift < -0.12 and series_shot_attempts >= 4:
        # Determine whether the paint drift is opponent-forced or self-inflicted.
        # Only apply shot zone multipliers when the opponent is actively boxing out more.
        try:
            paint_cause = get_paint_cause_analysis(player_id, opponent, series_games, season)
        except Exception:
            paint_cause = {"cause": "insufficient_data", "details": {}}
        if paint_cause.get("cause") in ("opponent_scheme", "insufficient_data"):
            # Apply adjustments when opponent is confirmed scheming, or when we can't tell
            # (benefit of the doubt goes to the conservative/lower prediction).
            for _s, _m in _SZ_MULT.items():
                shot_zone_factors[_s] = max(_SZ_FLOOR[_s], 1.0 + paint_drift * _m)

    # --- Role pattern (facilitator vs scorer) from series PBP box scores ---
    role_pattern = _detect_role_pattern(series_games)

    # Role adjustment factors — only applied when we have 2+ series games
    role_pts_factor = 1.0
    role_ast_factor = 1.0
    if n_series >= 2:
        p  = role_pattern["pattern"]
        lr = role_pattern["last_role"]
        if p == "alternating":
            if lr == "scorer":
                # Last game scorer → predict bounce to facilitator
                role_pts_factor = 0.93
                role_ast_factor = 1.12
            else:
                # Last game facilitator → predict bounce to scorer
                role_pts_factor = 1.07
                role_ast_factor = 0.90
        elif p == "trending_scorer":
            role_pts_factor = 1.03
            role_ast_factor = 0.96
        elif p == "trending_facilitator":
            role_pts_factor = 0.97
            role_ast_factor = 1.04

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

    # --- Pace normalization ---
    # season_avg / last5 / opp_avg were accumulated at the player's regular-season
    # team pace. Adjust them to the expected playoff matchup pace before blending.
    pace_ratio    = 1.0
    player_pace   = None
    matchup_pace  = None
    pace_source   = "none"
    try:
        player_espn_abbr = get_player_team_abbr(player_id)
        if player_espn_abbr:
            player_nba_abbr = _ESPN_TO_NBA_ABBR.get(player_espn_abbr.upper(), player_espn_abbr.upper())
            opp_nba_abbr    = _find_nba_abbr(opponent)

            reg_paces     = get_team_pace_map(season, "Regular Season")
            playoff_paces = get_team_pace_map(season, "Playoffs")

            # Baseline = player's regular-season pace (what their averages were built on)
            player_pace = reg_paces.get(player_nba_abbr)

            if player_pace and opp_nba_abbr:
                # Matchup pace = avg of both teams' playoff pace (falls back to reg season)
                p1 = playoff_paces.get(player_nba_abbr) or player_pace
                p2 = playoff_paces.get(opp_nba_abbr) or reg_paces.get(opp_nba_abbr)
                if p2:
                    matchup_pace = (p1 + p2) / 2
                    pace_ratio   = matchup_pace / player_pace
                    pace_source  = "playoffs" if playoff_paces.get(player_nba_abbr) else "regular_season"
    except Exception:
        pass

    props_out = {}
    for prop in PRED_PROPS:
        raw_season_avg = official_avgs.get(prop) if official_avgs.get(prop) else _avg(all_games, prop)

        # Apply pace ratio to all per-game averages derived from regular-season data.
        # series_avg is already at the matchup pace — do not scale it.
        season_avg = round(raw_season_avg * pace_ratio, 1)
        opp_avg    = round(_avg(opp_games,    prop) * pace_ratio, 1) if n_opp  else season_avg
        wo_avg     = round(_avg(wo_games,     prop) * pace_ratio, 1) if n_wo   else season_avg
        l5_avg     = round(_wavg(last5_games, prop) * pace_ratio, 1) if n_l5   else season_avg
        ix_avg     = round(_avg(ix_games,     prop) * pace_ratio, 1) if n_ix   else None
        # Minutes spike: if the most recent series game had >40% more minutes than
        # the prior series average, scale that game's counting stats down proportionally
        # before computing averages. Prevents heavy-usage outlier games (e.g. a bench
        # player doubling their usual role for one game) from inflating projections.
        series_games_adj = list(series_games)
        if n_series >= 2:
            last_min      = _parse_stat(series_games[0].get("MIN", 0))
            prior_min_avg = sum(_parse_stat(g.get("MIN", 0)) for g in series_games[1:]) / (n_series - 1)
            if prior_min_avg > 0 and last_min > prior_min_avg * 1.4:
                min_scale  = prior_min_avg / last_min
                adjusted   = dict(series_games[0])
                adjusted[prop] = round(_parse_stat(series_games[0].get(prop, 0)) * min_scale, 1)
                series_games_adj = [adjusted] + list(series_games[1:])

        series_avg          = _avg(series_games_adj,  prop)                          if n_series else None
        series_avg_weighted = _wavg(series_games_adj, prop, decay=_SERIES_DECAY)     if n_series else None

        # Detect opponent mid-series adjustment: most recent game dropped >50% vs prior series avg.
        # Signals a deliberate defensive scheme change, not random variance.
        # Also detect upward spikes (>1.8x prior avg) — treats them as partial outliers by
        # falling back to the unweighted series average so recency decay doesn't over-index.
        # Threshold lowered from 2.0 → 1.8 to catch near-double spikes that slipped through.
        series_reversal: Optional[dict] = None
        series_spike = False
        if n_series >= 2:
            last_val  = _parse_stat(series_games[0].get(prop, 0))  # use original, not adjusted
            prior_avg = _avg(series_games[1:], prop)
            if prior_avg > 1.0 and last_val < prior_avg * 0.5:
                series_reversal = {"last": last_val, "prior_avg": round(prior_avg, 1)}
            elif prior_avg > 1.0 and last_val > prior_avg * 1.8:
                series_spike = True
                series_avg_weighted = series_avg  # use unweighted avg to dampen the outlier

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
        if series_avg_weighted is not None and n_series > 0:
            s_w      = _weight(n_series, k=_SERIES_K)
            additive = round((1 - s_w) * additive + s_w * series_avg_weighted, 1)

        # Home/away split — applied after series blend, before defender adj
        loc_avg = None
        if location_games is not None and n_location > 0:
            loc_avg  = round(_avg(location_games, prop) * pace_ratio, 1)
            loc_w    = _weight(n_location, k=_HOME_AWAY_K)
            additive = round(additive + (loc_avg - season_avg) * loc_w, 1)

        # Apply defender adjustment to PTS only.
        # Dampen aggressively once series games exist — 1 actual game is stronger
        # evidence than all pre-series possession history combined.
        if prop == "PTS" and def_w > 0:
            series_dampen = 1.0 - _weight(n_series, k=_DEF_ADJ_DAMPEN_K) if n_series else 1.0
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

        # Regression-to-mean: pull back toward pace-adjusted season_avg.
        # Strength weakens as confirmed series data accumulates (series games + saved actuals).
        n_anchor  = n_series + n_series_corr
        revert_w  = 1.0 - _weight(n_anchor, k=_REGRESS_K)
        expected  = round(expected - (expected - season_avg) * revert_w * 0.5, 1)

        # Foul trouble — proportional minutes reduction on all counting stats
        if foul_adj_factor < 1.0:
            expected = round(expected * foul_adj_factor, 1)

        # Shot zone drift — paint access loss hurts PTS, REB, BLK, AST
        if prop in shot_zone_factors:
            expected = round(expected * shot_zone_factors[prop], 1)

        # Role adjustment — PTS and AST shift based on facilitator/scorer pattern
        if prop == "PTS" and role_pts_factor != 1.0:
            expected = round(expected * role_pts_factor, 1)
        elif prop == "AST" and role_ast_factor != 1.0:
            expected = round(expected * role_ast_factor, 1)

        if n_series >= 3 or n_ix >= 3:
            confidence = "high"
        elif n_opp >= 3 and n_wo >= 5:
            confidence = "medium"
        else:
            confidence = "low"

        # Shot profile validator: 3PT prop needs real 3PT volume to be meaningful.
        # If player averages < 1.5 attempts/game the line has structural no-go risk.
        shot_profile_warning = False
        if prop == "3PT" and official_avgs.get("3PA", 10.0) < 1.5:
            shot_profile_warning = True
            confidence = "low"

        # Foul rate risk: high-foul players lose minutes unpredictably in playoffs.
        # PF/36 > 4.0 is the danger zone for counting stats that require floor time.
        foul_rate_warning = False
        if pf_per_36 >= 4.0 and prop in ("REB", "AST", "BLK"):
            foul_rate_warning = True
            if confidence == "high":
                confidence = "medium"

        # Rotation instability: high minute variance = fragmented stints = unreliable volume.
        rotation_risk = False
        if min_std_dev is not None and min_std_dev > 6.0 and prop in ("PTS", "REB", "AST"):
            rotation_risk = True
            if confidence == "high":
                confidence = "medium"

        # Apply spread blowout penalty on counting stats for road underdogs.
        if spread_blowout_penalty < 1.0 and prop in ("PTS", "REB", "AST", "STL", "BLK", "3PT", "FTM"):
            expected = round(expected * spread_blowout_penalty, 1)

        wo_direction_warning = bool(without_teammate_ids) and wo_avg < season_avg

        # Std dev from last 15 games — enough sample to measure volatility without going stale
        std_dev = _stddev(all_games[:15], prop)

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
            "pace_factor":          round(pace_ratio, 4) if pace_ratio != 1.0 else None,
            "expected":             expected,
            "confidence":           confidence,
            "wo_direction_warning": wo_direction_warning,
            "std_dev":              std_dev,
            "series_reversal":      series_reversal,
            "series_spike":         series_spike,
            "shot_profile_warning": shot_profile_warning,
            "foul_rate_warning":    foul_rate_warning,
            "rotation_risk":        rotation_risk,
            "spread_blowout_applied": spread_blowout_penalty < 1.0,
        }

    pts_series_corr = sum(d.get("PTS", 0.0) for d in series_deltas) / n_series_corr if n_series_corr > 0 else 0.0
    summary = _generate_summary(
        opponent=opponent,
        props_out=props_out,
        sample_sizes={
            "season": n_season, "vs_opponent": n_opp, "series": n_series,
            "without_teammate": n_wo if without_teammate_ids else None,
            "last5": n_l5, "def_poss": def_poss,
        },
        pace_ratio=pace_ratio,
        without_teammate_ids=without_teammate_ids,
        foul_trouble=foul_trouble,
        shot_zones=shot_zones,
        role_pattern=role_pattern,
        is_home=is_home,
        series_correction=round(pts_series_corr * _weight(n_series_corr, k=_SERIES_CORR_K), 1) if n_series_corr > 0 else 0.0,
    )

    return {
        "player_id":  player_id,
        "opponent":   opponent,
        "minutes_flag": {
            "warning":         min_warning,
            "season_avg_min":  round(season_avg_min, 1),
            "last_series_min": last_series_min,
            "last5_avg_min":   last5_avg_min,
            "series_game_mins": series_game_mins,
            "min_std_dev":     round(min_std_dev, 2) if min_std_dev is not None else None,
        },
        "risk_flags": {
            "pf_per_36":              pf_per_36,
            "foul_rate_high":         pf_per_36 >= 4.0,
            "rotation_instability":   min_std_dev is not None and min_std_dev > 6.0,
            "spread":                 spread,
            "spread_blowout_penalty": round(spread_blowout_penalty, 3) if spread_blowout_penalty < 1.0 else None,
        },
        "pace_info": {
            "player_season_pace": round(player_pace, 1) if player_pace else None,
            "matchup_pace":       round(matchup_pace, 1) if matchup_pace else None,
            "pace_ratio":         round(pace_ratio, 4),
            "source":             pace_source,
        },
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
        "role_pattern": role_pattern,
        "summary": summary,
        "blowout_risk": blowout_risk,
        "foul_trouble": foul_trouble,
        "injury_status": injury_status,
        "shot_zones": {**shot_zones, "paint_cause": paint_cause} if shot_zones else shot_zones,
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
