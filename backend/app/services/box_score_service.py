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

from app.db import get_conn, execute, fetchall, fetchone
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


def _parse_summary(game_id: str, game_date: date, season_type: int) -> list[tuple]:
    data = _get(f"{ESPN_SITE}/summary", {"event": game_id})
    teams = data["boxscore"]["players"]
    abbrs = [t["team"]["abbreviation"] for t in teams]
    rows = []
    for i, team in enumerate(teams):
        stats = team["statistics"][0]
        idx = {label: j for j, label in enumerate(stats["labels"])}
        for a in stats["athletes"]:
            s = a.get("stats") or []
            if a.get("didNotPlay") or not s:
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
                game_id, game_date, CURRENT_SEASON, season_type, abbrs[i], abbrs[1 - i],
                ath["id"], ath["displayName"], (ath.get("position") or {}).get("abbreviation"),
                bool(a.get("starter")), *[vals[c] for c in _STAT_COLS],
            ))
    return rows


def sync_box_scores(until: Optional[date] = None) -> int:
    """Fetch and store box scores for finished games not yet in the DB. Returns games added."""
    until = until or date.today()
    with get_conn() as conn:
        last = fetchone(conn, "SELECT MAX(game_date) AS d FROM box_scores WHERE season = ?", (CURRENT_SEASON,))
        stored = {r["game_id"] for r in fetchall(conn, "SELECT DISTINCT game_id FROM box_scores WHERE season = ?", (CURRENT_SEASON,))}
    start = last["d"] if last and last["d"] else date(int(CURRENT_SEASON) - 1, 10, 1)

    added = 0
    day = start
    while day <= until:
        board = _get(f"{ESPN_SITE}/scoreboard", {"dates": day.strftime("%Y%m%d")})
        for ev in board.get("events", []):
            season_type = ev.get("season", {}).get("type")
            if ev["id"] in stored or season_type not in (2, 3) or not ev["status"]["type"]["completed"]:
                continue
            rows = _parse_summary(ev["id"], day, season_type)
            with get_conn() as conn:
                for r in rows:
                    execute(conn, f"""
                        INSERT INTO box_scores (game_id, game_date, season, season_type, team_abbr, opp_abbr,
                            player_id, player_name, position, starter, {", ".join(_STAT_COLS)})
                        VALUES ({", ".join(["?"] * (10 + len(_STAT_COLS)))})
                        ON CONFLICT (game_id, player_id) DO NOTHING
                    """, r)
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
    before = before or date.today()

    with get_conn() as conn:
        me = fetchone(conn, "SELECT position FROM box_scores WHERE player_id = ? ORDER BY game_date DESC LIMIT 1",
                      (_resolve_espn_id(player_id),))
        if not me or not me["position"]:
            return None
        r = fetchone(conn, """
            SELECT SUM(pts) FILTER (WHERE opp_abbr = ?) AS opp_pts,
                   SUM(min) FILTER (WHERE opp_abbr = ?) AS opp_min,
                   COUNT(DISTINCT game_id) FILTER (WHERE opp_abbr = ?) AS n_games,
                   SUM(pts) AS lg_pts, SUM(min) AS lg_min
            FROM box_scores
            WHERE season = ? AND season_type = 2 AND position = ? AND min > 0 AND game_date < ?
        """, (opp_abbr, opp_abbr, opp_abbr, CURRENT_SEASON, me["position"], before))
    if not r or not r["n_games"] or not r["opp_min"] or not r["lg_min"]:
        return None
    opp_rate, lg_rate = r["opp_pts"] / r["opp_min"], r["lg_pts"] / r["lg_min"]
    return {
        "position":    me["position"],
        "opp_abbr":    opp_abbr,
        "n_games":     r["n_games"],
        "opp_rate":    round(opp_rate, 4),
        "league_rate": round(lg_rate, 4),
        "raw_factor":  round(opp_rate / lg_rate, 4),
    }


def get_usage_profiles(player_ids: list[str]) -> dict[str, dict]:
    """
    {input_id: {name, games, start_rate, mpg, usage}} for this regular season. usage is the
    standard usage rate: share of team plays (FGA + 0.44·FTA + TOV) used while on the floor,
    in percent (league median ≈ 18.5).
    """
    espn = {_resolve_espn_id(pid): pid for pid in player_ids}
    with get_conn() as conn:
        rows = fetchall(conn, f"""
            WITH team AS (
                SELECT game_id, team_abbr, SUM(fga + 0.44 * fta + tov) AS plays
                FROM box_scores WHERE season = ? AND season_type = 2 GROUP BY 1, 2
            )
            SELECT b.player_id, MAX(b.player_name) AS name, COUNT(*) AS games,
                   AVG(CASE WHEN b.starter THEN 1.0 ELSE 0.0 END) AS start_rate, AVG(b.min) AS mpg,
                   100 * SUM(b.fga + 0.44 * b.fta + b.tov) * 48 / NULLIF(SUM(b.min * t.plays), 0) AS usage
            FROM box_scores b JOIN team t USING (game_id, team_abbr)
            WHERE b.season = ? AND b.season_type = 2 AND b.min > 0
              AND b.player_id IN ({", ".join(["?"] * len(espn))})
            GROUP BY b.player_id
        """, (CURRENT_SEASON, CURRENT_SEASON, *espn))
    return {
        espn[r["player_id"]]: {
            "name": r["name"], "games": r["games"], "start_rate": round(float(r["start_rate"]), 2),
            "mpg": round(float(r["mpg"]), 1), "usage": round(float(r["usage"] or 0), 1),
        }
        for r in rows
    }


def start_sync_loop(interval_hours: float = 6) -> None:
    """Daemon thread: sync now, then every interval_hours. Failures are logged and retried next cycle."""
    def loop():
        while True:
            try:
                print(f"[box_scores] synced {sync_box_scores()} new games")
            except Exception as e:
                print(f"[box_scores] sync failed: {e}")
            time.sleep(interval_hours * 3600)
    threading.Thread(target=loop, daemon=True).start()
