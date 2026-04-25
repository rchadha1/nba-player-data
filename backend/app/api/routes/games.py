from fastapi import APIRouter
from app.services.nba_service import get_play_by_play, get_today_games, get_game_roster, get_playoff_games

router = APIRouter()


@router.get("/today")
async def today_games():
    """Returns today's NBA games with scores and status."""
    return get_today_games()


@router.get("/playoff")
async def playoff_games():
    """Returns recent and upcoming NBA playoff games (last 14 days + next 7 days)."""
    return get_playoff_games()


@router.get("/{game_id}/roster")
async def game_roster(game_id: str):
    """Returns players for both teams in a game with injury status."""
    return get_game_roster(game_id)


@router.get("/{game_id}/pbp")
async def play_by_play(game_id: str):
    return get_play_by_play(game_id)


