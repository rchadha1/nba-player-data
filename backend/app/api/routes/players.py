from fastapi import APIRouter, HTTPException
from app.services.nba_service import (
    search_player, get_player_game_log, get_player_vs_team,
    get_player_without_teammate, get_player_teammates, get_player_season_averages,
    get_player_head_to_head, get_player_defender_breakdown, get_player_team_injuries,
    get_player_headshot_url, get_kalshi_quotes, kalshi_lines_from_quotes, get_kalshi_game_state, get_kalshi_urls,
    get_team_defensive_matchup,
    get_game_matchups, CURRENT_SEASON,
)

router = APIRouter()


@router.get("/search")
async def search(name: str):
    results = search_player(name)
    if not results:
        raise HTTPException(status_code=404, detail="Player not found")
    return results


@router.get("/{player_id}/gamelog")
async def game_log(player_id: str, season: str = CURRENT_SEASON):
    return get_player_game_log(player_id, season)


@router.get("/{player_id}/vs")
async def vs_team(player_id: str, opponent: str, season: str = CURRENT_SEASON):
    """Returns game log filtered to games against a specific opponent team."""
    return get_player_vs_team(player_id, opponent, season)


@router.get("/{player_id}/teammates")
async def teammates(player_id: str):
    """Returns the current roster of the player's team, excluding themselves."""
    return get_player_teammates(player_id)


@router.get("/{player_id}/without/{teammate_id}")
async def without_teammate(player_id: str, teammate_id: str, season: str = CURRENT_SEASON):
    """Returns with/without split averages for a player when a teammate is in/out."""
    return get_player_without_teammate(player_id, teammate_id, season)


@router.get("/{player_id}/season-averages")
async def season_averages(player_id: str, season: str = CURRENT_SEASON):
    """Returns ESPN's official season averages for a player."""
    return get_player_season_averages(player_id, season)


@router.get("/{player_id}/h2h/{opponent_id}")
async def head_to_head(player_id: str, opponent_id: str, season: str = CURRENT_SEASON):
    """Returns play-level interactions (blocks, steals, assists) between two players."""
    return get_player_head_to_head(player_id, opponent_id, season)


@router.get("/{player_id}/defender-breakdown")
async def defender_breakdown(player_id: str, season: str = CURRENT_SEASON):
    """Returns all defenders ranked by shots attempted against this offensive player."""
    return get_player_defender_breakdown(player_id, season)


@router.get("/{player_id}/vs-team-defenders")
async def vs_team_defenders(player_id: str, team: str, season: str = CURRENT_SEASON):
    """Returns per-defender matchup stats for all players on a specific opponent team."""
    result = get_team_defensive_matchup(player_id, team, season)
    return result.get("defenders", [])


@router.get("/{player_id}/game-matchups")
async def game_matchups(player_id: str, game_date: str, opponent: str):
    """Returns per-defender matchup stats for a specific game using BoxScoreMatchupsV3."""
    return get_game_matchups(player_id, game_date, opponent)


@router.get("/{player_id}/team-injuries")
async def team_injuries(player_id: str):
    """Returns current ESPN injury report for the player's team."""
    return get_player_team_injuries(player_id)


@router.get("/{player_id}/headshot")
async def headshot(player_id: str):
    url = get_player_headshot_url(player_id)
    if not url:
        raise HTTPException(status_code=404, detail="Headshot not found")
    return {"url": url}


@router.get("/{player_id}/kalshi")
async def kalshi(player_id: str, player_name: str):
    """Returns {lines, quotes, urls, game_state, status} — status is 'ok' (may be empty if the
    player has no open markets) or 'unavailable' (Kalshi couldn't be reached).
    quotes are what bets are graded on; lines are a reference only; urls are the kalshi.com
    page per stat. game_state is the ESPN state of the quotes' game ('pre' / 'in' / 'post',
    None if unknown)."""
    quotes = get_kalshi_quotes(player_name)
    if quotes is None:
        return {"lines": {}, "quotes": {}, "urls": {}, "game_state": None, "status": "unavailable"}
    try:
        state = get_kalshi_game_state(player_name) if quotes else None
    except Exception as e:
        print(f"[kalshi] game state lookup failed: {e}")
        state = None
    return {"lines": kalshi_lines_from_quotes(quotes), "quotes": quotes, "urls": get_kalshi_urls(player_name),
            "game_state": state, "status": "ok"}
