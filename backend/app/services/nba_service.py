"""
NBA data via ESPN's public API — no API key required.
Player search uses nba_api static JSON (no network call).
Game logs and play-by-play use ESPN's public API.
stats.nba.com endpoints use nba_api with browser-spoofed headers.
"""
import time
import json
import unicodedata
import requests
from pathlib import Path
from typing import Optional
from nba_api.stats.static import players as nba_players, teams as nba_teams
from nba_api.stats.library.http import NBAStatsHTTP

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

# Required to bypass stats.nba.com bot detection
NBAStatsHTTP.headers = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Host": "stats.nba.com",
    "Origin": "https://www.nba.com",
    "Pragma": "no-cache",
    "Referer": "https://www.nba.com/",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
}

ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_WEB  = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba"

# All 30 current NBA team abbreviations — used to filter out All-Star / exhibition games
_NBA_TEAM_ABBRS = {
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GS",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NO", "NY",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SA", "TOR", "UTAH", "WSH",
}


def _get(url: str, params: dict = {}) -> dict:
    time.sleep(0.3)
    r = requests.get(url, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Player search — uses local nba_api JSON (no network call)
# ---------------------------------------------------------------------------

def search_player(name: str) -> list[dict]:
    """Returns only currently active players matching the name.
    ESPN roster cache overrides stale nba_api is_active flags.
    """
    _build_espn_id_cache()
    matches = nba_players.find_players_by_full_name(name)
    return [
        {"id": str(p["id"]), "full_name": p["full_name"]}
        for p in matches
        if p["is_active"] or (p["full_name"].lower() in _espn_id_cache)
    ]


# In-memory caches built from all 30 team rosters
_espn_id_cache: dict[str, str] = {}               # lowercase name → espn_id
_espn_player_team_cache: dict[str, str] = {}       # espn_id → team_id
_espn_team_roster_cache: dict[str, list] = {}      # team_id → [{id, full_name}]
_espn_team_abbr_cache: dict[str, str] = {}         # team_id → abbreviation

# ESPN abbreviations that differ from nba_api abbreviations
_ESPN_TO_NBA_ABBR: dict[str, str] = {
    "GS": "GSW", "SA": "SAS", "NO": "NOP", "NY": "NYK",
    "UTAH": "UTA", "WSH": "WAS",
}


def _build_espn_id_cache() -> None:
    """Fetches all 30 NBA team rosters to build player/team lookup caches."""
    global _espn_id_cache, _espn_player_team_cache, _espn_team_roster_cache, _espn_team_abbr_cache
    if _espn_id_cache:
        return  # already built

    teams_data = _get(f"{ESPN_SITE}/teams")
    team_list = [
        t["team"]
        for sport in teams_data.get("sports", [])
        for league in sport.get("leagues", [])
        for t in league.get("teams", [])
    ]

    for team in team_list:
        team_id = str(team.get("id", ""))
        abbr = team.get("abbreviation", "")
        if team_id and abbr:
            _espn_team_abbr_cache[team_id] = abbr

    for team in team_list:
        team_id = str(team.get("id", ""))
        try:
            roster = _get(f"{ESPN_SITE}/teams/{team_id}/roster")
            team_players = []
            for athlete in roster.get("athletes", []):
                name     = athlete.get("displayName", "")
                espn_id  = str(athlete.get("id", ""))
                if name and espn_id:
                    _espn_id_cache[name.lower()] = espn_id
                    _espn_player_team_cache[espn_id] = team_id
                    team_players.append({"id": espn_id, "full_name": name})
            _espn_team_roster_cache[team_id] = team_players
        except Exception:
            continue


def _get_espn_athlete_id(player_name: str) -> Optional[str]:
    _build_espn_id_cache()
    return _espn_id_cache.get(player_name.lower())


def get_player_headshot_url(athlete_id: str) -> Optional[str]:
    """Returns the ESPN headshot URL for a player given their NBA or ESPN ID."""
    _build_espn_id_cache()
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            return f"https://a.espncdn.com/i/headshots/nba/players/full/{espn_id}.png"
    # If already an ESPN ID, use directly
    return f"https://a.espncdn.com/i/headshots/nba/players/full/{athlete_id}.png"


def get_player_injury_status(athlete_id: str) -> str:
    """Returns the player's own current injury status from ESPN (e.g. 'GTD', 'Out', 'Active')."""
    import re as _re
    _build_espn_id_cache()
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            athlete_id = espn_id
    try:
        data = _get(f"{ESPN_SITE}/injuries")
    except Exception:
        return "Active"
    for team_entry in data.get("injuries", []):
        for inj in team_entry.get("injuries", []):
            a = inj.get("athlete", {})
            pid = None
            for link in a.get("links", []):
                if "playercard" in link.get("rel", []):
                    m = _re.search(r"/id/(\d+)/", link.get("href", ""))
                    if m:
                        pid = m.group(1)
                    break
            if pid == athlete_id:
                return inj.get("status", "Active")
    return "Active"


def get_player_team_injuries(athlete_id: str) -> list[dict]:
    """Returns current injury report for the player's team from ESPN."""
    import re as _re
    _build_espn_id_cache()

    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            athlete_id = espn_id

    team_id = _espn_player_team_cache.get(athlete_id)
    if not team_id:
        return []

    team_player_ids = {p["id"] for p in _espn_team_roster_cache.get(team_id, [])}

    try:
        data = _get(f"{ESPN_SITE}/injuries")
    except Exception:
        return []

    results = []
    for team_entry in data.get("injuries", []):
        for inj in team_entry.get("injuries", []):
            a = inj.get("athlete", {})
            # Extract ESPN athlete ID from playercard href
            pid = None
            for link in a.get("links", []):
                if "playercard" in link.get("rel", []):
                    m = _re.search(r"/id/(\d+)/", link.get("href", ""))
                    if m:
                        pid = m.group(1)
                    break
            if pid and pid in team_player_ids and pid != athlete_id:
                results.append({
                    "id":          pid,
                    "full_name":   a.get("displayName", ""),
                    "short_name":  a.get("shortName", ""),
                    "status":      inj.get("status", ""),
                    "comment":     inj.get("shortComment", ""),
                })
    return results


def get_player_teammates(athlete_id: str) -> list[dict]:
    """Returns the current roster of the team the player belongs to, excluding themselves."""
    _build_espn_id_cache()

    # Resolve NBA ID → ESPN ID if needed
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            athlete_id = espn_id

    team_id = _espn_player_team_cache.get(athlete_id)
    if not team_id:
        return []

    return [p for p in _espn_team_roster_cache.get(team_id, []) if p["id"] != athlete_id]


def _parse_stat(value) -> float:
    """Parse a stat value that may be a number or a 'made-attempted' string like '1-4'."""
    if not value:
        return 0.0
    s = str(value).split("-")[0]
    try:
        return float(s)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Game log — per-game box score stats for a player
# ---------------------------------------------------------------------------

def get_player_game_log(athlete_id: str, season: str = "2026") -> list[dict]:
    """
    Returns per-game stats for a player.
    athlete_id can be an NBA player ID — we resolve to ESPN ID automatically.
    Season format: '2025' = 2024-25 season, '2024' = 2023-24, etc.
    """
    # If the ID looks like an NBA ID (numeric), resolve to ESPN athlete ID
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        player_name = nba_match["full_name"]
        espn_id = _get_espn_athlete_id(player_name)
        if espn_id:
            athlete_id = espn_id

    data = _get(f"{ESPN_WEB}/athletes/{athlete_id}/gamelog", {"season": season})

    labels = data.get("labels", [])       # ['MIN', 'FG', 'FG%', '3PT', ...]
    names  = data.get("names", [])        # full stat names
    events = data.get("events", {})       # keyed by ESPN game ID

    season_types = data.get("seasonTypes", [])
    rows = []

    for season_type in season_types:
        for category in season_type.get("categories", []):
            for event_ref in category.get("events", []):
                game_id   = event_ref.get("eventId", "")
                stats_raw = event_ref.get("stats", [])
                event_info = events.get(game_id, {})

                opponent_info = event_info.get("opponent", {})
                opp_abbr = opponent_info.get("abbreviation", "")
                opp_name = opponent_info.get("displayName", "")
                at_vs = event_info.get("atVs", "vs") or "vs"
                matchup = f"{at_vs} {opp_abbr}" if opp_abbr else ""
                is_all_star = event_info.get("team", {}).get("isAllStar", False)
                game = {
                    "game_id":        game_id,
                    "date":           event_info.get("gameDate", ""),
                    "matchup":        matchup,
                    "home_away":      "home" if at_vs == "vs" else "away",
                    "result":         event_info.get("gameResult", ""),
                    "opponent_abbr":  opp_abbr,
                    "opponent_name":  opp_name,
                    "is_all_star":    is_all_star,
                    "season_type":    season_type.get("displayName", season_type.get("name", "")),
                }
                # zip stat labels to values
                for label, value in zip(labels, stats_raw):
                    game[label] = value

                # Extract attempted counts from made-attempted strings (e.g. "3-7" → 7)
                for _src, _key in (("FG", "FGA"), ("3PT", "3PA"), ("FT", "FTA")):
                    try:
                        parts = str(game.get(_src, "0-0")).split("-")
                        game[_key] = float(parts[1]) if len(parts) > 1 else 0.0
                    except (ValueError, IndexError):
                        game[_key] = 0.0
                # FTM as an explicit key (same value as FT first number, clearer naming)
                game["FTM"] = _parse_stat(game.get("FT", 0))
                # 2PM = total FGM minus 3-pointers made
                game["2PM"] = _parse_stat(game.get("FG", 0)) - _parse_stat(game.get("3PT", 0))
                # 2PA = total FGA minus 3-point attempts
                game["2PA"] = game.get("FGA", 0.0) - game.get("3PA", 0.0)

                if (_parse_stat(game.get("MIN", "0")) > 0
                        and not game.get("is_all_star")
                        and game.get("opponent_abbr", "") in _NBA_TEAM_ABBRS):
                    rows.append(game)

    return rows


def get_player_season_averages(athlete_id: str, season: str = "2026") -> dict:
    """Returns ESPN's official season averages for a player (matches what ESPN displays)."""
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            athlete_id = espn_id

    data = _get(f"{ESPN_WEB}/athletes/{athlete_id}/gamelog", {"season": season})
    labels = data.get("labels", [])
    events = data.get("events", {})

    result: dict = {}
    target_categories = None

    for season_type in data.get("seasonTypes", []):
        for stat_group in season_type.get("summary", {}).get("stats", []):
            if stat_group.get("type") == "avg":
                raw = dict(zip(labels, stat_group.get("stats", [])))
                result = {k: _parse_stat(v) for k, v in raw.items()}
                target_categories = season_type.get("categories", [])
                break
        if result:
            break

    # Compute shooting %, attempt averages from individual game totals in the same
    # season type (regular season only). ESPN's labels don't include "3PT%" and
    # attempt columns like "3PA" aren't separate labels either, so we derive them
    # from the made-attempted strings ("2-7" → made=2, att=7).
    if target_categories:
        totals: dict[str, list[float]] = {"FG": [0.0, 0.0], "3PT": [0.0, 0.0], "FT": [0.0, 0.0]}
        n_games = 0
        for category in target_categories:
            for ev in category.get("events", []):
                ev_info = events.get(ev.get("eventId", ""), {})
                if ev_info.get("team", {}).get("isAllStar", False):
                    continue
                if ev_info.get("opponent", {}).get("abbreviation", "") not in _NBA_TEAM_ABBRS:
                    continue
                gs = dict(zip(labels, ev.get("stats", [])))
                if _parse_stat(gs.get("MIN", "0")) <= 0:
                    continue
                n_games += 1
                for src in ("FG", "3PT", "FT"):
                    parts = str(gs.get(src, "0-0")).split("-")
                    try:
                        m = float(parts[0]) if parts[0] else 0.0
                        a = float(parts[1]) if len(parts) > 1 and parts[1] else 0.0
                        totals[src][0] += m
                        totals[src][1] += a
                    except (ValueError, IndexError):
                        pass
        if totals["FG"][1] > 0:
            result["FG%"] = round(totals["FG"][0] / totals["FG"][1] * 100, 1)
        if totals["3PT"][1] > 0:
            result["3PT%"] = round(totals["3PT"][0] / totals["3PT"][1] * 100, 1)
        if totals["FT"][1] > 0:
            result["FT%"] = round(totals["FT"][0] / totals["FT"][1] * 100, 1)
        if n_games > 0:
            result["FGA"] = round(totals["FG"][1] / n_games, 1)
            result["3PA"] = round(totals["3PT"][1] / n_games, 1)
            result["FTA"] = round(totals["FT"][1] / n_games, 1)

    return result


# ---------------------------------------------------------------------------
# Play-by-play — every event in a game
# ---------------------------------------------------------------------------

def _resolve_to_espn_id(athlete_id: str) -> str:
    """Resolve an NBA player ID to ESPN athlete ID if needed."""
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            return espn_id
    return athlete_id


def _parse_interaction(play: dict, player_a: str, player_b: str) -> Optional[dict]:
    """
    Returns a structured interaction if both players are in the play's participants.
    Participant ordering from ESPN: [primary actor, secondary actor]
      - Made shot with assist: [scorer, assister]
      - Blocked shot:          [shooter, blocker]   (text says "blocker blocks shooter" but order is reversed)
      - Steal/turnover:        [ball handler, stealer]
    """
    parts = play.get("participants", [])
    ids = [p["athlete"]["id"] for p in parts if "athlete" in p]
    if player_a not in ids or player_b not in ids:
        return None

    text = play.get("text", "")
    text_lower = text.lower()
    scoring = play.get("scoringPlay", False)
    shooting = play.get("shootingPlay", False)
    p0, p1 = ids[0], ids[1] if len(ids) > 1 else None

    if scoring and shooting:
        action, actor_id, target_id = "assisted", p1, p0
    elif shooting and not scoring and "block" in text_lower:
        action, actor_id, target_id = "blocked", p1, p0
    elif "steal" in text_lower:
        action, actor_id, target_id = "stole", p1, p0
    else:
        return None

    return {
        "period":      play.get("period", {}).get("number"),
        "clock":       play.get("clock", {}).get("displayValue"),
        "actor_id":    actor_id,
        "action":      action,
        "target_id":   target_id,
        "description": text,
        "score_value": play.get("scoreValue", 0),
    }


def _nba_season_str(season: str) -> str:
    """Convert ESPN season year ('2026') to NBA API format ('2025-26')."""
    year = int(season)
    return f"{year - 1}-{str(year)[2:]}"


def _parse_matchup_row(row: dict) -> dict:
    gp   = row.get("GP") or 1
    poss = row.get("PARTIAL_POSS") or 1
    fgm  = int(row.get("MATCHUP_FGM", 0))
    fga  = int(row.get("MATCHUP_FGA", 0))
    return {
        "games":             int(gp),
        "matchup_min":       row.get("MATCHUP_MIN", ""),
        "partial_poss":      round(float(poss), 1),
        "pts_total":         int(row.get("PLAYER_PTS", 0)),
        "pts_per_game":      round(row.get("PLAYER_PTS", 0) / gp, 1),
        "pts_per_100_poss":  round(row.get("PLAYER_PTS", 0) / poss * 100, 1),
        "fgm":               fgm,
        "fga":               fga,
        "misses":            fga - fgm,
        "fg_pct":            round(float(row.get("MATCHUP_FG_PCT", 0)), 3),
        "fg3m":              int(row.get("MATCHUP_FG3M", 0)),
        "fg3a":              int(row.get("MATCHUP_FG3A", 0)),
        "fg3_pct":           round(float(row.get("MATCHUP_FG3_PCT", 0)), 3),
        "turnovers":         int(row.get("MATCHUP_TOV", 0)),
        "blocks":            int(row.get("MATCHUP_BLK", 0)),
    }


def _get_matchup_stats(off_id: str, def_id: str, nba_season: str) -> dict:
    """
    Returns how the offensive player performed when guarded by the defensive player.
    Falls back to previous season if current season has no data yet.
    """
    from nba_api.stats.endpoints import LeagueSeasonMatchups

    prev_season = f"{int(nba_season[:4]) - 1}-{nba_season[2:4]}"

    for season, stype in [
        (nba_season,  "Regular Season"),
        (nba_season,  "Playoffs"),
        (prev_season, "Regular Season"),
        (prev_season, "Playoffs"),
    ]:
        time.sleep(0.3)
        try:
            r = LeagueSeasonMatchups(
                off_player_id_nullable=off_id,
                def_player_id_nullable=def_id,
                season=season,
                season_type_playoffs=stype,
                timeout=20,
            )
            df = r.get_data_frames()[0]
            if df.empty:
                continue
            result = _parse_matchup_row(df.iloc[0].to_dict())
            result["season"] = season
            result["season_type"] = stype
            return result
        except Exception:
            continue
    return {}


def get_player_defender_breakdown(player_id: str, season: str = "2026") -> list[dict]:
    """
    Returns all defenders ranked by shots stopped against this offensive player.
    Falls back to previous season if no current season data.
    Uses LeagueSeasonMatchups with no defender filter.
    """
    from nba_api.stats.endpoints import LeagueSeasonMatchups

    nba_season = _nba_season_str(season)
    prev_season = f"{int(nba_season[:4]) - 1}-{nba_season[2:4]}"

    # Resolve NBA ID → nba_api compatible numeric ID
    nba_match = nba_players.find_player_by_id(int(player_id)) if player_id.isdigit() else None
    nba_id = str(nba_match["id"]) if nba_match else player_id

    for s, stype in [
        (nba_season,  "Regular Season"),
        (nba_season,  "Playoffs"),
        (prev_season, "Regular Season"),
        (prev_season, "Playoffs"),
    ]:
        try:
            time.sleep(0.3)
            r = LeagueSeasonMatchups(
                off_player_id_nullable=nba_id,
                season=s,
                season_type_playoffs=stype,
                timeout=25,
            )
            df = r.get_data_frames()[0]
            if df.empty:
                continue

            rows = []
            for _, row in df.iterrows():
                parsed = _parse_matchup_row(row.to_dict())
                parsed["defender_id"]   = str(int(row.get("DEF_PLAYER_ID", 0)))
                parsed["defender_name"] = row.get("DEF_PLAYER_NAME", "")
                parsed["season"]        = s
                parsed["season_type"]   = stype
                rows.append(parsed)

            # Sort by most shots faced (highest fga) to surface meaningful matchups
            rows.sort(key=lambda x: x["fga"], reverse=True)
            return rows
        except Exception:
            continue
    return []


def _pvp_row(player_id: str, vs_player_id: str, nba_season: str) -> dict:
    """
    Returns the player's box score stats in games where they faced vs_player_id's team.
    Uses PlayerVsPlayer from nba_api (stats.nba.com).
    """
    from nba_api.stats.endpoints import PlayerVsPlayer as _PVP
    try:
        r = _PVP(player_id=player_id, vs_player_id=vs_player_id, season=nba_season, timeout=20)
        df = r.get_data_frames()[0]
        if df.empty:
            return {}
        row = df.iloc[0].to_dict()
        gp = row.get("GP", 0) or 1
        return {
            "games":   int(gp),
            "wins":    int(row.get("W", 0)),
            "losses":  int(row.get("L", 0)),
            "per_game": {
                "PTS": round(row.get("PTS", 0) / gp, 1),
                "REB": round(row.get("REB", 0) / gp, 1),
                "AST": round(row.get("AST", 0) / gp, 1),
                "STL": round(row.get("STL", 0) / gp, 1),
                "BLK": round(row.get("BLK", 0) / gp, 1),
                "FG_PCT":  round(row.get("FG_PCT", 0), 3),
                "FG3_PCT": round(row.get("FG3_PCT", 0), 3),
                "TOV": round(row.get("TOV", 0) / gp, 1),
                "MIN": round(row.get("MIN", 0) / gp, 1),
            },
        }
    except Exception:
        return {}


def _resolve_nba_team_id(opponent: str) -> Optional[int]:
    """Map a team name or abbreviation string to an NBA stats team ID."""
    needle = opponent.strip().lower()
    for t in nba_teams.get_teams():
        if (needle in t["full_name"].lower()
                or needle == t["abbreviation"].lower()
                or needle == t["nickname"].lower()):
            return t["id"]
    return None


def get_team_defensive_matchup(
    off_player_id: str, opponent: str, season: str = "2026"
) -> dict:
    """
    Aggregates possession-level matchup data across ALL defenders on the opponent team.
    Returns team-level FG% allowed, total possessions, and per-defender breakdown.
    Falls back to previous season if current season has no data.
    """
    from nba_api.stats.endpoints import LeagueSeasonMatchups

    nba_team_id = _resolve_nba_team_id(opponent)
    if not nba_team_id:
        return {}

    nba_season = _nba_season_str(season)
    prev_season = f"{int(nba_season[:4]) - 1}-{nba_season[2:4]}"

    # Resolve off_player_id to NBA numeric ID
    nba_match = nba_players.find_player_by_id(int(off_player_id)) if off_player_id.isdigit() else None
    nba_id = str(nba_match["id"]) if nba_match else off_player_id

    for s, stype in [
        (nba_season,  "Regular Season"),
        (nba_season,  "Playoffs"),
        (prev_season, "Regular Season"),
        (prev_season, "Playoffs"),
    ]:
        time.sleep(0.3)
        try:
            r = LeagueSeasonMatchups(
                off_player_id_nullable=nba_id,
                def_team_id_nullable=nba_team_id,
                season=s,
                season_type_playoffs=stype,
                timeout=25,
            )
            df = r.get_data_frames()[0]
            if df.empty:
                continue

            total_fgm  = int(df["MATCHUP_FGM"].sum())
            total_fga  = int(df["MATCHUP_FGA"].sum())
            total_poss = round(float(df["PARTIAL_POSS"].sum()), 1)
            total_pts  = int(df["PLAYER_PTS"].sum())
            team_fg_pct = round(total_fgm / total_fga, 3) if total_fga else 0.0

            defenders = []
            for _, row in df.sort_values("PARTIAL_POSS", ascending=False).iterrows():
                defenders.append({
                    "defender_name": row["DEF_PLAYER_NAME"],
                    "defender_id":   str(int(row["DEF_PLAYER_ID"])),
                    "partial_poss":  round(float(row["PARTIAL_POSS"]), 1),
                    "fgm":           int(row["MATCHUP_FGM"]),
                    "fga":           int(row["MATCHUP_FGA"]),
                    "misses":        int(row["MATCHUP_FGA"]) - int(row["MATCHUP_FGM"]),
                    "fg_pct":        round(float(row["MATCHUP_FG_PCT"]), 3),
                    "pts":           int(row["PLAYER_PTS"]),
                })

            return {
                "season":       s,
                "season_type":  stype,
                "n_defenders":  len(defenders),
                "total_poss":   total_poss,
                "total_fgm":    total_fgm,
                "total_fga":    total_fga,
                "total_pts":    total_pts,
                "team_fg_pct":  team_fg_pct,
                "defenders":    defenders,
            }
        except Exception:
            continue
    return {}


def get_player_head_to_head(
    player_a_id: str, player_b_id: str, season: str = "2026"
) -> dict:
    """
    Returns head-to-head data between two players:
      - box_scores: each player's per-game averages in games vs the other's team
                    (from NBA official stats via PlayerVsPlayer)
      - interactions: play-level blocks/steals/assists between them
                      (from ESPN play-by-play)
    player_a_id / player_b_id: NBA player IDs (resolved to ESPN IDs for PBP).
    """
    nba_season = _nba_season_str(season)

    # --- Box scores + scored-on data from NBA stats API ---
    box_a = _pvp_row(player_a_id, player_b_id, nba_season)
    time.sleep(0.5)
    box_b = _pvp_row(player_b_id, player_a_id, nba_season)
    time.sleep(0.5)
    # a_scores_on_b: how A performed offensively when B was the primary defender
    a_scores_on_b = _get_matchup_stats(player_a_id, player_b_id, nba_season)
    time.sleep(0.5)
    # b_scores_on_a: how B performed offensively when A was the primary defender
    b_scores_on_a = _get_matchup_stats(player_b_id, player_a_id, nba_season)

    # --- Play-level interactions from ESPN PBP ---
    _build_espn_id_cache()
    espn_a = _resolve_to_espn_id(player_a_id)
    espn_b = _resolve_to_espn_id(player_b_id)

    games_a = get_player_game_log(espn_a, season)
    games_b = get_player_game_log(espn_b, season)
    shared_game_ids = {g["game_id"] for g in games_a} & {g["game_id"] for g in games_b}
    game_date_map = {g["game_id"]: g.get("date", "") for g in games_a}

    interactions: list[dict] = []
    for game_id in sorted(shared_game_ids):
        raw = _get(f"{ESPN_SITE}/summary", {"event": game_id})
        for play in raw.get("plays", []):
            ix = _parse_interaction(play, espn_a, espn_b)
            if ix:
                ix["game_id"] = game_id
                ix["date"] = game_date_map.get(game_id, "")
                interactions.append(ix)

    def _count(actor: str, action: str) -> int:
        return sum(1 for i in interactions if i["actor_id"] == actor and i["action"] == action)

    n = len(shared_game_ids) or 1
    interaction_summary = {
        "a_blocks_b":  _count(espn_a, "blocked"),
        "b_blocks_a":  _count(espn_b, "blocked"),
        "a_steals_b":  _count(espn_a, "stole"),
        "b_steals_a":  _count(espn_b, "stole"),
        "a_assists_b": _count(espn_a, "assisted"),
        "b_assists_a": _count(espn_b, "assisted"),
        "a_blocks_b_per_game":  round(_count(espn_a, "blocked") / n, 2),
        "b_blocks_a_per_game":  round(_count(espn_b, "blocked") / n, 2),
        "a_steals_b_per_game":  round(_count(espn_a, "stole") / n, 2),
        "b_steals_a_per_game":  round(_count(espn_b, "stole") / n, 2),
    }

    return {
        "player_a_id":          player_a_id,
        "player_b_id":          player_b_id,
        "shared_games":         len(shared_game_ids),
        "player_a_box":         box_a,
        "player_b_box":         box_b,
        "a_scores_on_b":        a_scores_on_b,
        "b_scores_on_a":        b_scores_on_a,
        "interaction_summary":  interaction_summary,
        "interactions":         interactions,
    }


_pbp_cache: dict[str, list[dict]] = {}


def get_play_by_play(game_id: str) -> list[dict]:
    """
    Returns all play-by-play events for a game.
    Each event includes: period, clock, type, text description, participants, score.
    Example text: 'LeBron James blocks Anthony Edwards layup'
    """
    if game_id in _pbp_cache:
        return _pbp_cache[game_id]

    data = _get(f"{ESPN_SITE}/summary", {"event": game_id})
    plays = data.get("plays", [])

    result = []
    for play in plays:
        result.append({
            "id":           play.get("id"),
            "sequence":     play.get("sequenceNumber"),
            "period":       play.get("period", {}).get("number"),
            "clock":        play.get("clock", {}).get("displayValue"),
            "type":         play.get("type", {}).get("text"),
            "description":  play.get("text"),
            "home_score":   play.get("homeScore"),
            "away_score":   play.get("awayScore"),
            "scoring_play": play.get("scoringPlay"),
            "score_value":  play.get("scoreValue", 0),
            "participants": [
                p["athlete"]["id"]
                for p in play.get("participants", [])
                if "athlete" in p
            ],
        })

    _pbp_cache[game_id] = result
    return result


# ---------------------------------------------------------------------------
# Game summary — boxscore + odds + win probability
# ---------------------------------------------------------------------------

def get_game_summary(game_id: str) -> dict:
    data = _get(f"{ESPN_SITE}/summary", {"event": game_id})
    return {
        "boxscore":        data.get("boxscore"),
        "odds":            data.get("odds"),
        "win_probability": data.get("winprobability"),
        "leaders":         data.get("leaders"),
    }


# ---------------------------------------------------------------------------
# Player games list — find recent game IDs for a player
# ---------------------------------------------------------------------------

def get_player_recent_games(athlete_id: str, season: str = "2026") -> list[str]:
    """Returns a list of ESPN game IDs the player appeared in."""
    games = get_player_game_log(athlete_id, season)
    return [g["game_id"] for g in games if g.get("game_id")]


# ---------------------------------------------------------------------------
# Teams — all 30 NBA teams
# ---------------------------------------------------------------------------

def get_teams() -> list[dict]:
    """Returns all NBA teams sorted alphabetically."""
    data = _get(f"{ESPN_SITE}/teams")
    teams = []
    for sport in data.get("sports", []):
        for league in sport.get("leagues", []):
            for t in league.get("teams", []):
                team = t.get("team", {})
                logos = team.get("logos", [])
                teams.append({
                    "id":           team.get("id"),
                    "abbreviation": team.get("abbreviation"),
                    "display_name": team.get("displayName"),
                    "short_name":   team.get("shortDisplayName"),
                    "logo":         logos[0].get("href", "") if logos else "",
                })
    return sorted(teams, key=lambda x: x["display_name"])


# ---------------------------------------------------------------------------
# Today's games scoreboard
# ---------------------------------------------------------------------------

def get_today_games() -> list[dict]:
    """Returns today's NBA games from ESPN scoreboard."""
    data = _get(f"{ESPN_SITE}/scoreboard")
    games = []
    for event in data.get("events", []):
        competitions = event.get("competitions", [])
        if not competitions:
            continue
        comp = competitions[0]
        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        status = event.get("status", {})
        status_type = status.get("type", {})
        home_team = home.get("team", {})
        away_team = away.get("team", {})
        home_logos = home_team.get("logos", [])
        away_logos = away_team.get("logos", [])
        games.append({
            "id":              event.get("id"),
            "name":            event.get("name", ""),
            "status_state":    status_type.get("state", "pre"),  # pre, in, post
            "status_detail":   status.get("displayClock", ""),
            "status_period":   status.get("period", 0),
            "status_short":    status_type.get("shortDetail", ""),
            "completed":       status_type.get("completed", False),
            "home_team_id":    home_team.get("id"),
            "home_abbr":       home_team.get("abbreviation", ""),
            "home_name":       home_team.get("displayName", ""),
            "home_short":      home_team.get("shortDisplayName", ""),
            "home_logo":       home_logos[0].get("href", "") if home_logos else "",
            "home_score":      home.get("score", ""),
            "home_record":     (home.get("records") or [{}])[0].get("summary", ""),
            "away_team_id":    away_team.get("id"),
            "away_abbr":       away_team.get("abbreviation", ""),
            "away_name":       away_team.get("displayName", ""),
            "away_short":      away_team.get("shortDisplayName", ""),
            "away_logo":       away_logos[0].get("href", "") if away_logos else "",
            "away_score":      away.get("score", ""),
            "away_record":     (away.get("records") or [{}])[0].get("summary", ""),
        })
    return games


# ---------------------------------------------------------------------------
# Game roster — players from both teams for a given game
# ---------------------------------------------------------------------------

def get_game_roster(game_id: str) -> dict:
    """Returns players for both teams in a game, with injury status where available."""
    import re as _re
    _build_espn_id_cache()

    # Fetch game summary to identify the two teams
    data = _get(f"{ESPN_SITE}/summary", {"event": game_id})
    boxscore = data.get("boxscore", {})
    teams_data = boxscore.get("teams", [])

    result = {}
    injury_map: dict[str, dict] = {}

    # Build injury map from ESPN injury feed
    try:
        inj_data = _get(f"{ESPN_SITE}/injuries")
        for team_entry in inj_data.get("injuries", []):
            for inj in team_entry.get("injuries", []):
                a = inj.get("athlete", {})
                pid = None
                for link in a.get("links", []):
                    if "playercard" in link.get("rel", []):
                        m = _re.search(r"/id/(\d+)/", link.get("href", ""))
                        if m:
                            pid = m.group(1)
                        break
                if pid:
                    injury_map[pid] = {
                        "status":  inj.get("status", ""),
                        "comment": inj.get("shortComment", ""),
                    }
    except Exception:
        pass

    for team_entry in teams_data:
        team_info = team_entry.get("team", {})
        team_id = str(team_info.get("id", ""))
        abbr = team_info.get("abbreviation", "")
        logos = team_info.get("logos", [])
        players_raw = _espn_team_roster_cache.get(team_id, [])
        players = []
        for p in players_raw:
            inj = injury_map.get(p["id"], {})
            players.append({
                "id":      p["id"],
                "name":    p["full_name"],
                "status":  inj.get("status", "Active"),
                "comment": inj.get("comment", ""),
            })
        result[abbr] = {
            "team_id":    team_id,
            "abbr":       abbr,
            "name":       team_info.get("displayName", ""),
            "short_name": team_info.get("shortDisplayName", ""),
            "logo":       logos[0].get("href", "") if logos else "",
            "players":    sorted(players, key=lambda x: x["name"]),
        }

    return result


# ---------------------------------------------------------------------------
# Matchup — player stats filtered to games vs a specific opponent
# ---------------------------------------------------------------------------

def get_player_vs_team(athlete_id: str, opponent: str, season: str = "2026") -> list[dict]:
    """
    Returns game log rows for games against a specific opponent.
    Matches against opponent_name, opponent_abbr, and matchup string (all case-insensitive).
    opponent: full team name (e.g. 'Houston Rockets') or abbreviation (e.g. 'HOU').
    """
    games = get_player_game_log(athlete_id, season)
    needle = opponent.strip().lower()
    return [
        g for g in games
        if needle in g.get("opponent_name", "").lower()
        or needle in g.get("opponent_abbr", "").lower()
        or needle in g.get("matchup", "").lower()
    ]


# ---------------------------------------------------------------------------
# With/Without splits — player stats with vs. without a teammate
# ---------------------------------------------------------------------------

SPLIT_PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT"]



def _avg_stats(games: list[dict]) -> dict:
    if not games:
        return {p: 0.0 for p in SPLIT_PROPS}
    return {
        p: round(sum(_parse_stat(g.get(p, 0)) for g in games) / len(games), 1)
        for p in SPLIT_PROPS
    }


def get_player_without_teammate(
    player_id: str, teammate_id: str, season: str = "2026"
) -> dict:
    """
    Returns per-stat averages split into games where the teammate played
    vs. games where they did not appear (DNP / injured / rested).
    ESPN only includes games a player actually played in their game log,
    so a missing game_id means the teammate was out.
    """
    player_games, teammate_games = (
        get_player_game_log(player_id, season),
        get_player_game_log(teammate_id, season),
    )

    teammate_game_ids = {g["game_id"] for g in teammate_games}

    with_games    = [g for g in player_games if g["game_id"] in teammate_game_ids]
    without_games = [g for g in player_games if g["game_id"] not in teammate_game_ids]

    return {
        "with_teammate": {
            "games":    len(with_games),
            "averages": _avg_stats(with_games),
        },
        "without_teammate": {
            "games":    len(without_games),
            "averages": _avg_stats(without_games),
        },
    }


# ---------------------------------------------------------------------------
# Team pace — possessions per 48 min from NBA Stats API
# ---------------------------------------------------------------------------

import time as _time_mod

_pace_cache: dict[str, dict[str, float]] = {}
_pace_cache_ts: dict[str, float] = {}
_PACE_CACHE_TTL = 3600  # 1 hour


def _to_nba_season(season: str) -> str:
    """Convert ESPN/internal season '2026' → nba_api format '2025-26'."""
    year = int(season)
    return f"{year - 1}-{str(year)[-2:]}"


def get_team_pace_map(season: str = "2026", season_type: str = "Playoffs") -> dict[str, float]:
    """Returns {nba_abbreviation: pace} for all teams. Cached for 1 hour."""
    cache_key = f"{season}_{season_type}"
    now = _time_mod.time()
    if cache_key in _pace_cache and now - _pace_cache_ts.get(cache_key, 0) < _PACE_CACHE_TTL:
        return _pace_cache[cache_key]

    try:
        from nba_api.stats.endpoints import leaguedashteamstats
        df = leaguedashteamstats.LeagueDashTeamStats(
            measure_type_detailed_defense="Advanced",
            per_mode_detailed="PerGame",
            season=_to_nba_season(season),
            season_type_all_star=season_type,
        ).get_data_frames()[0]
        # column is TEAM_NAME, not TEAM_ABBREVIATION — map via nba_api static data
        name_to_abbr = {t["full_name"]: t["abbreviation"] for t in nba_teams.get_teams()}
        result = {}
        for _, row in df.iterrows():
            if row.get("PACE") is None:
                continue
            abbr = name_to_abbr.get(str(row["TEAM_NAME"]))
            if abbr:
                result[abbr] = float(row["PACE"])
    except Exception:
        result = {}

    _pace_cache[cache_key] = result
    _pace_cache_ts[cache_key] = now
    return result


def get_player_team_abbr(athlete_id: str) -> Optional[str]:
    """Returns the ESPN team abbreviation for a player (resolved from NBA or ESPN ID)."""
    _build_espn_id_cache()
    nba_match = nba_players.find_player_by_id(int(athlete_id)) if athlete_id.isdigit() else None
    if nba_match:
        espn_id = _get_espn_athlete_id(nba_match["full_name"])
        if espn_id:
            athlete_id = espn_id
    team_id = _espn_player_team_cache.get(athlete_id)
    if not team_id:
        return None
    return _espn_team_abbr_cache.get(team_id)


# ---------------------------------------------------------------------------
# PrizePicks
# ---------------------------------------------------------------------------

_pp_cache: dict = {}
_pp_cache_ts: float = 0.0
_PP_CACHE_TTL = 1800        # 30 minutes in-memory TTL
_PP_DISK_TTL  = 24 * 3600   # 24 hours before treating disk cache as truly stale
_PP_DISK_PATH = Path(__file__).parent.parent.parent / "pp_cache.json"

_PP_STAT_MAP = {
    "Points": "PTS",
    "Rebounds": "REB",
    "Assists": "AST",
    "3-PT Made": "3PT",
    "3-PT Attempted": "3PA",
    "Blocked Shots": "BLK",
    "Steals": "STL",
    "Free Throws Made": "FTM",
    "Free Throws Attempted": "FTA",
    "Two Pointers Made": "2PM",
    "Two Pointers Attempted": "2PA",
    "Pts+Rebs+Asts": "PTS+REB+AST",
    "Pts+Rebs": "PTS+REB",
    "Pts+Asts": "PTS+AST",
    "Rebs+Asts": "AST+REB",
}

_PP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://app.prizepicks.com",
    "Referer": "https://app.prizepicks.com/board",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Connection": "keep-alive",
}


def _normalize_name(name: str) -> str:
    # Strip diacritics (ć→c, č→c, ū→u, etc.) so "Jokic" matches "Jokić"
    nfd = unicodedata.normalize("NFD", name)
    ascii_name = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return ascii_name.lower().replace(".", "").replace("'", "").replace("-", " ").strip()


_PP_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def _load_pp_disk_cache() -> tuple[dict, float]:
    """Load persisted PrizePicks cache from disk. Returns (data, timestamp)."""
    try:
        if _PP_DISK_PATH.exists():
            payload = json.loads(_PP_DISK_PATH.read_text())
            return payload.get("data", {}), float(payload.get("ts", 0))
    except Exception:
        pass
    return {}, 0.0


def _save_pp_disk_cache(data: dict) -> None:
    try:
        _PP_DISK_PATH.write_text(json.dumps({"ts": _time_mod.time(), "data": data}))
    except Exception:
        pass


def _fetch_prizepicks() -> dict:
    global _pp_cache, _pp_cache_ts
    now = _time_mod.time()

    # 1. In-memory cache still fresh
    if _pp_cache_ts > 0 and now - _pp_cache_ts < _PP_CACHE_TTL:
        return _pp_cache

    # 2. Try fetching fresh data from PrizePicks using curl_cffi (spoofs Chrome TLS fingerprint
    #    to bypass Cloudflare bot detection — plain requests gets flagged and 429'd)
    result: dict[str, dict[str, float]] = {}
    fetch_ok = False
    try:
        from curl_cffi import requests as curl_requests

        player_names: dict[str, str] = {}
        page = 1
        per_page = 500

        while True:
            url = f"https://api.prizepicks.com/projections?league_id=7&per_page={per_page}&page={page}"
            resp = curl_requests.get(url, headers=_PP_HEADERS, impersonate="chrome124", timeout=15)
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("included", []):
                if item.get("type") == "new_player":
                    player_names[item["id"]] = item["attributes"]["name"]

            projections = data.get("data", [])
            for proj in projections:
                if proj.get("type") != "projection":
                    continue
                attrs = proj.get("attributes", {})
                if attrs.get("odds_type") != "standard":
                    continue
                stat_type = attrs.get("stat_type", "")
                line = attrs.get("line_score")
                if line is None:
                    continue
                mapped = _PP_STAT_MAP.get(stat_type)
                if not mapped:
                    continue
                pid = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
                name = player_names.get(pid)
                if not name:
                    continue
                key = _normalize_name(name)
                if key not in result:
                    result[key] = {}
                result[key][mapped] = float(line)

            if len(projections) < per_page:
                break
            page += 1
            if page > 5:
                break
            time.sleep(0.3)

        if result:
            fetch_ok = True
            _pp_cache = result
            _pp_cache_ts = now
            _save_pp_disk_cache(result)
        else:
            _pp_cache_ts = now - _PP_CACHE_TTL + 120
    except Exception as _e:
        backoff = 600 if "429" in str(_e) else 120
        _pp_cache_ts = now - _PP_CACHE_TTL + backoff

    # 3. Fall back to disk cache if live fetch failed or returned nothing.
    # On a hard failure (exception / rate-limit), serve any cached data
    # regardless of age — stale lines are better than empty.
    if not fetch_ok:
        disk_data, disk_ts = _load_pp_disk_cache()
        if disk_data:
            age = now - disk_ts
            if age < _PP_DISK_TTL or not _pp_cache:
                _pp_cache = disk_data

    return _pp_cache


def get_prizepicks_lines(player_name: str) -> dict[str, float]:
    """Returns {stat: line} for a player from PrizePicks. Empty dict if not found."""
    data = _fetch_prizepicks()
    key = _normalize_name(player_name)

    # 1. Exact match
    if key in data:
        return data[key]

    # 2. Fuzzy: all query words appear in stored key (handles PrizePicks having extra words)
    words = key.split()
    for stored_key, lines in data.items():
        if all(w in stored_key for w in words):
            return lines

    # 3. Suffix-stripped: drop trailing Jr/Sr/II/III/IV then retry
    # Handles "Wendell Carter Jr" (NBA) vs "Wendell Carter" (PrizePicks)
    core_words = [w for w in words if w not in _PP_SUFFIXES]
    if len(core_words) < len(words):
        core_key = " ".join(core_words)
        if core_key in data:
            return data[core_key]
        for stored_key, lines in data.items():
            if all(w in stored_key for w in core_words):
                return lines

    return {}


# ---------------------------------------------------------------------------
# Foul trouble analysis
# ---------------------------------------------------------------------------

def _nba_id_to_espn_id(nba_player_id: str) -> Optional[str]:
    """Convert an NBA Stats player ID to ESPN athlete ID."""
    _build_espn_id_cache()
    try:
        nba_match = nba_players.find_player_by_id(int(nba_player_id))
        if nba_match:
            return _espn_id_cache.get(nba_match["full_name"].lower())
    except Exception:
        pass
    return None


def get_player_foul_trouble(nba_player_id: str, series_game_ids: list[str]) -> dict:
    """
    Parse ESPN PBP for series games to extract per-quarter foul counts.
    Returns avg fouls/game, early-foul-game count, and a warning flag.
    """
    espn_id = _nba_id_to_espn_id(nba_player_id)
    if not espn_id or not series_game_ids:
        return {"avg_fouls": 0.0, "early_foul_games": 0, "games": [], "warning": False}

    games_data = []
    for game_id in series_game_ids:
        try:
            pbp = get_play_by_play(game_id)
        except Exception:
            continue

        seen: set[tuple] = set()
        fouls_by_q: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
        for event in pbp:
            if espn_id not in (event.get("participants") or []):
                continue
            desc = (event.get("description") or "").lower()
            etype = (event.get("type") or "").lower()
            if "foul" not in desc and "foul" not in etype:
                continue
            # skip foul turnover duplicates — same clock/period as the foul itself
            key = (event.get("period"), event.get("clock"))
            if key in seen:
                continue
            seen.add(key)
            q = int(event.get("period") or 0)
            if q in fouls_by_q:
                fouls_by_q[q] += 1

        total = sum(fouls_by_q.values())
        early_foul = fouls_by_q[1] >= 2 or fouls_by_q[2] >= 2
        games_data.append({
            "game_id": game_id,
            "fouls_by_quarter": fouls_by_q,
            "total_fouls": total,
            "early_foul": early_foul,
        })

    if not games_data:
        return {"avg_fouls": 0.0, "early_foul_games": 0, "games": [], "warning": False}

    avg_fouls = round(sum(g["total_fouls"] for g in games_data) / len(games_data), 1)
    early_foul_games = sum(1 for g in games_data if g["early_foul"])
    warning = avg_fouls >= 3.0 or early_foul_games >= 2

    return {
        "avg_fouls": avg_fouls,
        "early_foul_games": early_foul_games,
        "games": games_data,
        "warning": warning,
    }


# ---------------------------------------------------------------------------
# Shot zone profile (paint / mid-range / 3PT) from PBP descriptions
# ---------------------------------------------------------------------------

_PAINT_KEYWORDS = {"layup", "dunk", "driving", "hook", "finger roll", "alley", "tip", "putback", "floater"}
_MID_KEYWORDS   = {"jump shot", "pull-up", "turnaround", "fadeaway", "bank"}


def _shot_zone(event: dict) -> Optional[str]:
    """Categorise a PBP event as 'paint', 'mid', or 'three'. None if not a shot."""
    score_val = event.get("score_value", 0)
    desc = (event.get("description") or "").lower()
    etype = (event.get("type") or "").lower()

    is_attempt = score_val in (2, 3) or "miss" in desc
    if not is_attempt:
        return None

    if score_val == 3 or "3-point" in etype or "three" in desc or "3-pt" in desc:
        return "three"
    if any(k in desc for k in _PAINT_KEYWORDS):
        return "paint"
    if any(k in desc for k in _MID_KEYWORDS):
        return "mid"
    if score_val == 2:  # unclassified 2PT — assume mid
        return "mid"
    return None


def _parse_shot_zones(espn_id: str, game_ids: list[str]) -> dict:
    counts: dict[str, int] = {"paint": 0, "mid": 0, "three": 0}
    for gid in game_ids:
        try:
            pbp = get_play_by_play(gid)
        except Exception:
            continue
        for event in pbp:
            if espn_id not in (event.get("participants") or []):
                continue
            zone = _shot_zone(event)
            if zone:
                counts[zone] += 1
    total = sum(counts.values())
    if total == 0:
        return {"paint": 0.0, "mid": 0.0, "three": 0.0, "total_attempts": 0}
    return {k: round(counts[k] / total, 3) for k in counts} | {"total_attempts": total}


def get_player_shot_zones(nba_player_id: str, series_game_ids: list[str], baseline_game_ids: list[str]) -> dict:
    """
    Returns shot zone distributions for series vs baseline (recent games).
    Drift values: positive = more of that zone in series vs baseline.
    """
    espn_id = _nba_id_to_espn_id(nba_player_id)
    if not espn_id:
        return {}

    series   = _parse_shot_zones(espn_id, series_game_ids)   if series_game_ids   else {}
    baseline = _parse_shot_zones(espn_id, baseline_game_ids) if baseline_game_ids else {}

    drift: dict[str, float] = {}
    if series.get("total_attempts", 0) > 0 and baseline.get("total_attempts", 0) > 0:
        for k in ("paint", "mid", "three"):
            drift[k] = round(series.get(k, 0.0) - baseline.get(k, 0.0), 3)

    return {
        "series":              series,
        "baseline":            baseline,
        "drift":               drift,
        "paint_drift_warning": drift.get("paint", 0.0) < -0.12,
    }


# ---------------------------------------------------------------------------
# Paint drift cause detection
# ---------------------------------------------------------------------------

def _get_nba_game_ids_for_dates(
    team_abbr: str,
    date_strs: list[str],
    nba_season: str,
) -> dict[str, str]:
    """
    Maps ESPN game dates → NBA Stats game IDs for a given team.
    Returns {espn_date_str: nba_game_id}.  Unmatched dates are omitted.
    """
    from nba_api.stats.endpoints import LeagueGameFinder
    from datetime import datetime

    try:
        result = LeagueGameFinder(
            team_abbreviation_nullable=team_abbr,
            season_nullable=nba_season,
            timeout=25,
        ).get_data_frames()[0]
    except Exception:
        return {}

    # GAME_DATE format from NBA Stats: 'YYYY-MM-DD'
    date_to_gameid: dict[str, str] = {}
    for _, row in result.iterrows():
        nba_date_str = str(row.get("GAME_DATE", ""))[:10]          # 'YYYY-MM-DD'
        game_id      = str(row.get("GAME_ID", ""))
        if nba_date_str and game_id:
            date_to_gameid[nba_date_str] = game_id

    mapping: dict[str, str] = {}
    for espn_date in date_strs:
        # ESPN dates look like '2026-04-20T00:00Z' or '2026-04-20'
        try:
            dt = datetime.fromisoformat(espn_date.replace("Z", "+00:00"))
            short = dt.strftime("%Y-%m-%d")
        except Exception:
            short = espn_date[:10]
        if short in date_to_gameid:
            mapping[espn_date] = date_to_gameid[short]

    return mapping


def _get_opponent_boxouts(nba_game_id: str, opponent_team_id: int) -> Optional[float]:
    """
    Returns the opponent team's defensive box-out rate for one game
    using BoxScoreHustleV2.  Returns None on failure.
    """
    from nba_api.stats.endpoints import BoxScoreHustleV2
    time.sleep(0.4)
    try:
        df = BoxScoreHustleV2(game_id=nba_game_id, timeout=20).get_data_frames()[1]  # team stats
        team_row = df[df["TEAM_ID"] == opponent_team_id]
        if team_row.empty:
            return None
        row = team_row.iloc[0]
        def_boxouts = float(row.get("DEF_BOXOUTS", 0) or 0)
        return def_boxouts
    except Exception:
        return None


def _get_player_paint_touches(nba_game_id: str, nba_player_id_int: int) -> Optional[float]:
    """
    Returns the player's paint touch count for one game using
    BoxScorePlayerTrackV3 (falls back to V2 if V3 unavailable).
    """
    from nba_api.stats.endpoints import BoxScorePlayerTrackV3, BoxScorePlayerTrackV2
    time.sleep(0.4)
    for EndpointCls in (BoxScorePlayerTrackV3, BoxScorePlayerTrackV2):
        try:
            df = EndpointCls(game_id=nba_game_id, timeout=20).get_data_frames()[0]
            player_row = df[df["personId"] == nba_player_id_int] if "personId" in df.columns else df[df["PLAYER_ID"] == nba_player_id_int]
            if player_row.empty:
                continue
            row = player_row.iloc[0]
            col = next((c for c in ("paintTouches", "PAINT_TOUCHES") if c in row.index), None)
            if col is None:
                continue
            return float(row[col] or 0)
        except Exception:
            continue
    return None


def get_paint_cause_analysis(
    nba_player_id: str,
    opponent: str,
    series_games: list[dict],
    season: str = "2026",
) -> dict:
    """
    Determines the cause of a player's reduced paint access in the series:
      - 'opponent_scheme'   — opponent is boxing out heavily (above season avg)
      - 'player_execution'  — opponent box-outs are normal; player choosing fewer paint touches
      - 'normal_variance'   — neither metric clearly elevated
      - 'insufficient_data' — NBA Stats IDs couldn't be mapped or API call failed

    Also returns per-game raw numbers so the summary can explain the finding.
    """
    from nba_api.stats.endpoints import LeagueHustleStatsTeam, LeagueDashPtStats

    nba_season = _nba_season_str(season)

    # Resolve player to NBA numeric ID
    try:
        nba_match = nba_players.find_player_by_id(int(nba_player_id))
        nba_id_int = nba_match["id"] if nba_match else int(nba_player_id)
    except Exception:
        return {"cause": "insufficient_data", "details": {}}

    # Resolve opponent to NBA team ID + abbreviation
    opp_team = None
    for t in nba_teams.get_teams():
        needle = opponent.strip().lower()
        if needle in t["full_name"].lower() or needle == t["abbreviation"].lower() or needle == t["nickname"].lower():
            opp_team = t
            break
    if not opp_team:
        return {"cause": "insufficient_data", "details": {}}
    opp_team_id  = int(opp_team["id"])
    opp_nba_abbr = opp_team["abbreviation"]

    # Map ESPN game dates → NBA Stats game IDs
    espn_dates = [g.get("date", "") for g in series_games if g.get("date")]
    date_to_nba = _get_nba_game_ids_for_dates(opp_nba_abbr, espn_dates, nba_season)
    if not date_to_nba:
        return {"cause": "insufficient_data", "details": {"reason": "no_game_id_mapping"}}

    nba_game_ids = list(date_to_nba.values())

    # --- Per-game: opponent defensive box-outs and player paint touches ---
    series_opp_boxouts: list[float] = []
    series_player_paints: list[float] = []
    for nba_gid in nba_game_ids:
        bo = _get_opponent_boxouts(nba_gid, opp_team_id)
        if bo is not None:
            series_opp_boxouts.append(bo)
        pt = _get_player_paint_touches(nba_gid, nba_id_int)
        if pt is not None:
            series_player_paints.append(pt)

    if not series_opp_boxouts and not series_player_paints:
        return {"cause": "insufficient_data", "details": {"reason": "api_data_unavailable"}}

    # --- Season baselines ---
    season_avg_boxouts: Optional[float]  = None
    season_avg_paints:  Optional[float]  = None

    try:
        time.sleep(0.4)
        hustle_df = LeagueHustleStatsTeam(
            season=nba_season,
            season_type_all_star="Playoffs",
            timeout=20,
        ).get_data_frames()[0]
        opp_row = hustle_df[hustle_df["TEAM_ID"] == opp_team_id]
        if not opp_row.empty:
            season_avg_boxouts = float(opp_row.iloc[0].get("DEF_BOXOUTS", 0) or 0)
    except Exception:
        pass

    try:
        time.sleep(0.4)
        touch_df = LeagueDashPtStats(
            season=nba_season,
            season_type_all_star="Playoffs",
            pt_measure_type="Touches",
            per_mode_simple="PerGame",
            timeout=20,
        ).get_data_frames()[0]
        player_row = touch_df[touch_df["PLAYER_ID"] == nba_id_int]
        if player_row.empty:
            # fallback: regular season
            time.sleep(0.4)
            touch_df2 = LeagueDashPtStats(
                season=nba_season,
                season_type_all_star="Regular Season",
                pt_measure_type="Touches",
                per_mode_simple="PerGame",
                timeout=20,
            ).get_data_frames()[0]
            player_row = touch_df2[touch_df2["PLAYER_ID"] == nba_id_int]
        if not player_row.empty:
            paint_col = next((c for c in ("PAINT_TOUCHES", "paintTouches") if c in player_row.columns), None)
            if paint_col:
                season_avg_paints = float(player_row.iloc[0][paint_col] or 0)
    except Exception:
        pass

    # --- Determine cause ---
    avg_series_boxouts = round(sum(series_opp_boxouts) / len(series_opp_boxouts), 1) if series_opp_boxouts else None
    avg_series_paints  = round(sum(series_player_paints) / len(series_player_paints), 1) if series_player_paints else None

    opponent_elevated = (
        avg_series_boxouts is not None
        and season_avg_boxouts is not None
        and avg_series_boxouts > season_avg_boxouts * 1.10  # >10% above baseline
    )
    player_low = (
        avg_series_paints is not None
        and season_avg_paints is not None
        and avg_series_paints < season_avg_paints * 0.85  # >15% below baseline
    )

    if opponent_elevated:
        cause = "opponent_scheme"
    elif player_low and not opponent_elevated:
        cause = "player_execution"
    else:
        cause = "normal_variance"

    return {
        "cause": cause,
        "details": {
            "avg_series_opp_boxouts":   avg_series_boxouts,
            "season_avg_opp_boxouts":   round(season_avg_boxouts, 1) if season_avg_boxouts else None,
            "avg_series_player_paints": avg_series_paints,
            "season_avg_player_paints": round(season_avg_paints, 1) if season_avg_paints else None,
            "opponent_elevated":        opponent_elevated,
            "player_low":               player_low,
            "games_mapped":             len(nba_game_ids),
        },
    }


# ---------------------------------------------------------------------------
# Playoff games — recent + upcoming, cached for 10 minutes
# ---------------------------------------------------------------------------
import re as _re_top
import threading
_playoff_cache: dict = {"ts": 0.0, "data": []}
_playoff_lock  = threading.Lock()

def get_playoff_games() -> list[dict]:
    """
    Returns NBA playoff games from the last 14 days through the next 7 days.
    Results are cached for 10 minutes to avoid hammering ESPN.
    """
    from datetime import date, timedelta

    with _playoff_lock:
        if time.time() - _playoff_cache["ts"] < 600:
            return _playoff_cache["data"]

    today      = date.today()
    start_date = today - timedelta(days=14)
    end_date   = today + timedelta(days=7)
    start_s    = start_date.strftime("%Y%m%d")
    end_s      = end_date.strftime("%Y%m%d")

    events: list[dict] = []

    # Try the range form first; ESPN supports YYYYMMDD-YYYYMMDD
    try:
        data   = _get(f"{ESPN_SITE}/scoreboard", {"dates": f"{start_s}-{end_s}", "seasontype": "3"})
        events = data.get("events", [])
    except Exception:
        events = []

    # Fall back: one request per date (slower but reliable)
    if not events:
        current = start_date
        while current <= end_date:
            try:
                d = _get(f"{ESPN_SITE}/scoreboard", {"dates": current.strftime("%Y%m%d"), "seasontype": "3"})
                events.extend(d.get("events", []))
            except Exception:
                pass
            current += timedelta(days=1)

    games: list[dict] = []
    seen:  set[str]   = set()

    for event in events:
        eid = event.get("id")
        if not eid or eid in seen:
            continue
        seen.add(eid)

        comps = event.get("competitions") or [{}]
        comp  = comps[0]
        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue

        home_team = home.get("team", {})
        away_team = away.get("team", {})
        status    = event.get("status", {})
        status_t  = status.get("type", {})

        # Try to extract game number from ESPN notes
        game_num: int | None = None
        series_text = ""
        for note in event.get("notes", []):
            txt = note.get("headline", "") or note.get("text", "") or ""
            m = _re_top.search(r"game\s*(\d+)", txt, _re_top.IGNORECASE)
            if m:
                game_num = int(m.group(1))
            if txt:
                series_text = txt

        away_short = away_team.get("shortDisplayName", away_team.get("abbreviation", ""))
        home_short = home_team.get("shortDisplayName", home_team.get("abbreviation", ""))
        if game_num:
            label = f"{away_short} at {home_short} G{game_num}"
        else:
            label = f"{away_short} at {home_short}"

        # Return raw UTC ISO timestamp — the frontend converts to the user's local timezone.
        date_raw  = event.get("date", "")
        game_date = date_raw  # e.g. "2026-04-25T02:00:00Z"

        games.append({
            "id":           eid,
            "label":        label,
            "name":         event.get("name", ""),
            "series":       series_text,
            "game_date":    game_date,
            "status_state": status_t.get("state", "pre"),
            "completed":    status_t.get("completed", False),
            "home_abbr":    home_team.get("abbreviation", ""),
            "home_name":    home_team.get("displayName", ""),
            "home_short":   home_short,
            "away_abbr":    away_team.get("abbreviation", ""),
            "away_name":    away_team.get("displayName", ""),
            "away_short":   away_short,
            "home_score":   home.get("score", ""),
            "away_score":   away.get("score", ""),
        })

    # Sort: completed games first (most recent first), then upcoming by date
    games.sort(key=lambda g: (0 if g["completed"] else 1, g["game_date"]), reverse=False)
    games = sorted(games, key=lambda g: g["game_date"], reverse=True)

    with _playoff_lock:
        _playoff_cache["ts"]   = time.time()
        _playoff_cache["data"] = games

    return games
