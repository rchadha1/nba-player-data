from fastapi import APIRouter, HTTPException
from app.services.nba_service import search_player, get_player_game_log, get_player_vs_team, get_player_without_teammate, get_player_teammates, get_player_season_averages, get_player_head_to_head, get_player_defender_breakdown

router = APIRouter()


@router.get("/search")
async def search(name: str):
    results = search_player(name)
    if not results:
        raise HTTPException(status_code=404, detail="Player not found")
    return results


@router.get("/{player_id}/gamelog")
async def game_log(player_id: str, season: str = "2026"):
    return get_player_game_log(player_id, season)


@router.get("/{player_id}/vs")
async def vs_team(player_id: str, opponent: str, season: str = "2026"):
    """Returns game log filtered to games against a specific opponent team."""
    return get_player_vs_team(player_id, opponent, season)


@router.get("/{player_id}/teammates")
async def teammates(player_id: str):
    """Returns the current roster of the player's team, excluding themselves."""
    return get_player_teammates(player_id)


@router.get("/{player_id}/without/{teammate_id}")
async def without_teammate(player_id: str, teammate_id: str, season: str = "2026"):
    """Returns with/without split averages for a player when a teammate is in/out."""
    return get_player_without_teammate(player_id, teammate_id, season)


@router.get("/{player_id}/season-averages")
async def season_averages(player_id: str, season: str = "2026"):
    """Returns ESPN's official season averages for a player."""
    return get_player_season_averages(player_id, season)


@router.get("/{player_id}/h2h/{opponent_id}")
async def head_to_head(player_id: str, opponent_id: str, season: str = "2026"):
    """Returns play-level interactions (blocks, steals, assists) between two players."""
    return get_player_head_to_head(player_id, opponent_id, season)


@router.get("/{player_id}/defender-breakdown")
async def defender_breakdown(player_id: str, season: str = "2026"):
    """Returns all defenders ranked by shots attempted against this offensive player."""
    return get_player_defender_breakdown(player_id, season)
