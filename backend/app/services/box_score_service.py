"""
Stores every finished game's player box scores in the box_scores table so opponent
defense stats can be computed from the DB instead of re-fetching ~250 ESPN summaries.

sync_box_scores() is incremental: it re-checks from the last stored date (a game can
finish after the previous sync ran) and only fetches summaries for unseen games.
"""
import threading
import time
from datetime import date, timedelta
from typing import Optional

from nba_api.stats.static import teams as nba_teams
from psycopg2.extras import execute_values

from app.db import get_conn, fetchall, fetchone
from app.services.nba_service import (
    _get, ESPN_SITE, CURRENT_SEASON, _ESPN_TO_NBA_ABBR, _resolve_nba_team_id, _resolve_espn_id,
)

_NBA_TO_ESPN_ABBR = {v: k for k, v in _ESPN_TO_NBA_ABBR.items()}

_STAT_COLS = ["min", "pts", "reb", "ast", "fg3m", "fg3a", "stl", "blk",
              "fgm", "fga", "ftm", "fta", "oreb", "dreb", "tov", "pf"]


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _split(v) -> tuple[float, float]:
    """'5-11' → (5.0, 11.0)"""
    made, _, att = str(v).partition("-")
    return _num(made), _num(att)


def _parse_summary(game_id: str, game_date: date, season: str, season_type: int) -> list[tuple]:
    data = _get(f"{ESPN_SITE}/summary", {"event": game_id})
    teams = data["boxscore"]["players"]
    abbrs = [t["team"]["abbreviation"] for t in teams]
    rows = []
    for i, team in enumerate(teams):
        stats = team["statistics"][0]
        idx = {label: j for j, label in enumerate(stats["labels"])}
        for a in stats["athletes"]:
            s = a.get("stats") or []
            # ESPN occasionally lists a placeholder athlete with no id (seen: 2025-11-29 CHI)
            if a.get("didNotPlay") or not s or "id" not in a.get("athlete", {}):
                continue
            g = lambda label: s[idx[label]]
            fgm, fga = _split(g("FG"))
            fg3m, fg3a = _split(g("3PT"))
            ftm, fta = _split(g("FT"))
            vals = {
                "min": _num(g("MIN")), "pts": _num(g("PTS")), "reb": _num(g("REB")),
                "ast": _num(g("AST")), "fg3m": fg3m, "fg3a": fg3a, "stl": _num(g("STL")),
                "blk": _num(g("BLK")), "fgm": fgm, "fga": fga, "ftm": ftm, "fta": fta,
                "oreb": _num(g("OREB")), "dreb": _num(g("DREB")), "tov": _num(g("TO")),
                "pf": _num(g("PF")),
            }
            ath = a["athlete"]
            rows.append((
                game_id, game_date, season, season_type, abbrs[i], abbrs[1 - i],
                ath["id"], ath["displayName"], (ath.get("position") or {}).get("abbreviation"),
                bool(a.get("starter")), *[vals[c] for c in _STAT_COLS],
            ))
    return rows


def sync_box_scores(until: Optional[date] = None, season: str = CURRENT_SEASON) -> int:
    """Fetch and store box scores for finished games not yet in the DB. Returns games added.
    A past season (e.g. '2026') backfills Oct 1 through the end of June."""
    until = min(until or date.today(), date(int(season), 6, 30))
    with get_conn() as conn:
        last = fetchone(conn, "SELECT MAX(game_date) AS d FROM box_scores WHERE season = ?", (season,))
        stored = {r["game_id"] for r in fetchall(conn, "SELECT DISTINCT game_id FROM box_scores WHERE season = ?", (season,))}
    start = last["d"] if last and last["d"] else date(int(season) - 1, 10, 1)

    added = 0
    day = start
    while day <= until:
        board = _get(f"{ESPN_SITE}/scoreboard", {"dates": day.strftime("%Y%m%d")})
        for ev in board.get("events", []):
            season_type = ev.get("season", {}).get("type")
            if ev["id"] in stored or season_type not in (2, 3) or not ev["status"]["type"]["completed"]:
                continue
            try:
                rows = _parse_summary(ev["id"], day, season, season_type)
            except Exception as e:
                # Skip one malformed box score rather than stalling every future sync on it
                print(f"[box_scores] skipped game {ev['id']} ({day}): {type(e).__name__}: {e}")
                continue
            if rows:
                with get_conn() as conn:
                    execute_values(conn.cursor(), f"""
                        INSERT INTO box_scores (game_id, game_date, season, season_type, team_abbr, opp_abbr,
                            player_id, player_name, position, starter, {", ".join(_STAT_COLS)})
                        VALUES %s
                        ON CONFLICT (game_id, player_id) DO NOTHING
                    """, rows)
            stored.add(ev["id"])
            added += 1
        day += timedelta(days=1)
    return added


def get_position_defense(player_id: str, opponent: str, before: Optional[date] = None) -> Optional[dict]:
    """
    Opponent's points per minute allowed to the player's position (G/F/C) this regular
    season vs the league-wide rate for that position, from games before `before`
    (default today). None when the player or opponent has no stored games.
    """
    team_id = _resolve_nba_team_id(opponent)
    team = next((t for t in nba_teams.get_teams() if t["id"] == team_id), None)
    if not team:
        return None
    opp_abbr = _NBA_TO_ESPN_ABBR.get(team["abbreviation"], team["abbreviation"])
    espn_id = _resolve_espn_id(player_id)

    if before is None:
        # Live requests: season totals cached until the next sync adds games
        agg = _position_aggregates()
        position = agg["positions"].get(espn_id)
        if not position:
            return None
        opp = agg["by_team"].get((opp_abbr, position))
        lg = agg["by_position"].get(position)
        r = {"opp_pts": opp["pts"], "opp_min": opp["min"], "n_games": opp["games"],
             "lg_pts": lg["pts"], "lg_min": lg["min"]} if opp and lg else None
    else:
        # Backtests: only games before the replayed date
        with get_conn() as conn:
            me = fetchone(conn, "SELECT position FROM box_scores WHERE player_id = ? ORDER BY game_date DESC LIMIT 1",
                          (espn_id,))
            if not me or not me["position"]:
                return None
            position = me["position"]
            r = fetchone(conn, """
                SELECT SUM(pts) FILTER (WHERE opp_abbr = ?) AS opp_pts,
                       SUM(min) FILTER (WHERE opp_abbr = ?) AS opp_min,
                       COUNT(DISTINCT game_id) FILTER (WHERE opp_abbr = ?) AS n_games,
                       SUM(pts) AS lg_pts, SUM(min) AS lg_min
                FROM box_scores
                WHERE season = ? AND season_type = 2 AND position = ? AND min > 0 AND game_date < ?
            """, (opp_abbr, opp_abbr, opp_abbr, CURRENT_SEASON, position, before))
    if not r or not r["n_games"] or not r["opp_min"] or not r["lg_min"]:
        return None
    opp_rate, lg_rate = r["opp_pts"] / r["opp_min"], r["lg_pts"] / r["lg_min"]
    return {
        "position":    position,
        "opp_abbr":    opp_abbr,
        "n_games":     r["n_games"],
        "opp_rate":    round(opp_rate, 4),
        "league_rate": round(lg_rate, 4),
        "raw_factor":  round(opp_rate / lg_rate, 4),
    }


# Season aggregates only change when a sync adds games: compute once, reuse across requests.
# Cleared after each sync that adds games; the TTL covers a sync run by another process.
_usage_cache: dict = {"ts": 0.0, "profiles": None}
_position_cache: dict = {"ts": 0.0, "agg": None}
_AGG_CACHE_TTL = 3600


def _position_aggregates() -> dict:
    """This regular season's PTS/min/games allowed by each team to each position, league
    totals per position, and each player's most recent position."""
    if _position_cache["agg"] is None or time.time() - _position_cache["ts"] >= _AGG_CACHE_TTL:
        with get_conn() as conn:
            team_rows = fetchall(conn, """
                SELECT opp_abbr, position, SUM(pts) AS pts, SUM(min) AS min, COUNT(DISTINCT game_id) AS games
                FROM box_scores WHERE season = ? AND season_type = 2 AND min > 0 AND position IS NOT NULL
                GROUP BY 1, 2
            """, (CURRENT_SEASON,))
            pos_rows = fetchall(conn, """
                SELECT DISTINCT ON (player_id) player_id, position FROM box_scores
                WHERE position IS NOT NULL ORDER BY player_id, game_date DESC
            """)
        by_position: dict = {}
        for r in team_rows:
            lg = by_position.setdefault(r["position"], {"pts": 0.0, "min": 0.0})
            lg["pts"] += float(r["pts"])
            lg["min"] += float(r["min"])
        _position_cache["agg"] = {
            "by_team": {(r["opp_abbr"], r["position"]): {"pts": float(r["pts"]), "min": float(r["min"]), "games": r["games"]}
                        for r in team_rows},
            "by_position": by_position,
            "positions": {r["player_id"]: r["position"] for r in pos_rows},
        }
        _position_cache["ts"] = time.time()
    return _position_cache["agg"]


def _all_usage_profiles() -> dict[str, dict]:
    """{espn_id: {name, games, start_rate, mpg, usage}} for every player this regular season."""
    if _usage_cache["profiles"] is None or time.time() - _usage_cache["ts"] >= _AGG_CACHE_TTL:
        with get_conn() as conn:
            rows = fetchall(conn, """
                WITH team AS (
                    SELECT game_id, team_abbr, SUM(fga + 0.44 * fta + tov) AS plays
                    FROM box_scores WHERE season = ? AND season_type = 2 GROUP BY 1, 2
                )
                SELECT b.player_id, MAX(b.player_name) AS name, COUNT(*) AS games,
                       AVG(CASE WHEN b.starter THEN 1.0 ELSE 0.0 END) AS start_rate, AVG(b.min) AS mpg,
                       100 * SUM(b.fga + 0.44 * b.fta + b.tov) * 48 / NULLIF(SUM(b.min * t.plays), 0) AS usage
                FROM box_scores b JOIN team t USING (game_id, team_abbr)
                WHERE b.season = ? AND b.season_type = 2 AND b.min > 0
                GROUP BY b.player_id
            """, (CURRENT_SEASON, CURRENT_SEASON))
        _usage_cache["profiles"] = {
            r["player_id"]: {
                "name": r["name"], "games": r["games"], "start_rate": round(float(r["start_rate"]), 2),
                "mpg": round(float(r["mpg"]), 1), "usage": round(float(r["usage"] or 0), 1),
            }
            for r in rows
        }
        _usage_cache["ts"] = time.time()
    return _usage_cache["profiles"]


def get_usage_profiles(player_ids: list[str]) -> dict[str, dict]:
    """
    {input_id: {name, games, start_rate, mpg, usage}} for this regular season. usage is the
    standard usage rate: share of team plays (FGA + 0.44·FTA + TOV) used while on the floor,
    in percent (league median ≈ 18.5).
    """
    profiles = _all_usage_profiles()
    return {pid: profiles[e] for pid in player_ids if (e := _resolve_espn_id(pid)) in profiles}


_last_season_cache: dict = {"avgs": None}  # last season never changes mid-season


def get_last_season_averages(player_id: str) -> Optional[dict]:
    """{games, PTS, REB, AST, 3PT, STL, BLK} per game for last regular season, or None."""
    if _last_season_cache["avgs"] is None:
        with get_conn() as conn:
            rows = fetchall(conn, """
                SELECT player_id, COUNT(*) AS games, AVG(pts) AS pts, AVG(reb) AS reb, AVG(ast) AS ast,
                       AVG(fg3m) AS fg3m, AVG(stl) AS stl, AVG(blk) AS blk
                FROM box_scores WHERE season = ? AND season_type = 2 AND min > 0
                GROUP BY player_id
            """, (str(int(CURRENT_SEASON) - 1),))
        _last_season_cache["avgs"] = {
            r["player_id"]: {"games": r["games"], "PTS": float(r["pts"]), "REB": float(r["reb"]),
                             "AST": float(r["ast"]), "3PT": float(r["fg3m"]), "STL": float(r["stl"]),
                             "BLK": float(r["blk"])}
            for r in rows
        }
    return _last_season_cache["avgs"].get(_resolve_espn_id(player_id))


def start_sync_loop(interval_hours: float = 6) -> None:
    """Daemon thread: sync now, then every interval_hours. Failures are logged and retried next cycle."""
    def loop():
        while True:
            try:
                added = sync_box_scores()
                if added:
                    _usage_cache["profiles"] = None
                    _position_cache["agg"] = None
                print(f"[box_scores] synced {added} new games")
            except Exception as e:
                print(f"[box_scores] sync failed: {e}")
            time.sleep(interval_hours * 3600)
    threading.Thread(target=loop, daemon=True).start()
