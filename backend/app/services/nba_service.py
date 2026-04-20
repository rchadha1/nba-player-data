"""
NBA data via ESPN's public API — no API key required.
Player search uses nba_api static JSON (no network call).
Game logs and play-by-play use ESPN's public API.
stats.nba.com endpoints use nba_api with browser-spoofed headers.
"""
import time
import requests
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


def _build_espn_id_cache() -> None:
    """Fetches all 30 NBA team rosters to build player/team lookup caches."""
    global _espn_id_cache, _espn_player_team_cache, _espn_team_roster_cache
    if _espn_id_cache:
        return  # already built

    teams_data = _get(f"{ESPN_SITE}/teams")
    team_ids = [
        t["team"]["id"]
        for sport in teams_data.get("sports", [])
        for league in sport.get("leagues", [])
        for t in league.get("teams", [])
    ]

    for team_id in team_ids:
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
                }
                # zip stat labels to values
                for label, value in zip(labels, stats_raw):
                    game[label] = value

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

    for season_type in data.get("seasonTypes", []):
        for stat_group in season_type.get("summary", {}).get("stats", []):
            if stat_group.get("type") == "avg":
                raw = dict(zip(labels, stat_group.get("stats", [])))
                return {k: _parse_stat(v) for k, v in raw.items()}
    return {}


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


def get_play_by_play(game_id: str) -> list[dict]:
    """
    Returns all play-by-play events for a game.
    Each event includes: period, clock, type, text description, participants, score.
    Example text: 'LeBron James blocks Anthony Edwards layup'
    """
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
