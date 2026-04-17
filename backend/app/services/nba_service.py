"""
NBA data via ESPN's public API — no API key required.
Player search uses nba_api static JSON (no network call).
Game logs and play-by-play use ESPN's public API.
"""
import time
import requests
from typing import Optional
from nba_api.stats.static import players as nba_players

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_WEB  = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba"


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
                game = {
                    "game_id":        game_id,
                    "date":           event_info.get("gameDate", ""),
                    "matchup":        event_info.get("name", ""),
                    "home_away":      event_info.get("homeAway", ""),
                    "result":         event_info.get("gameResult", ""),
                    "opponent_abbr":  opponent_info.get("abbreviation", ""),
                    "opponent_name":  opponent_info.get("displayName", ""),
                }
                # zip stat labels to values
                for label, value in zip(labels, stats_raw):
                    game[label] = value

                rows.append(game)

    return rows


# ---------------------------------------------------------------------------
# Play-by-play — every event in a game
# ---------------------------------------------------------------------------

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


def _parse_stat(value) -> float:
    """Parse a stat value that may be a number or a 'made-attempted' string like '1-4'."""
    if not value:
        return 0.0
    s = str(value).split("-")[0]  # take made portion from "1-4" format
    try:
        return float(s)
    except ValueError:
        return 0.0


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
