from fastapi import APIRouter
from app.services.nba_service import get_play_by_play

router = APIRouter()


@router.get("/{game_id}")
async def game_events(game_id: str):
    """
    Returns all play-by-play events for a game.
    Each event includes: period, clock, player, event type, score, description.
    Use these to build per-player event timelines.
    """
    return get_play_by_play(game_id)
