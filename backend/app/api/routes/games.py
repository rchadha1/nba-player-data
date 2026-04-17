from fastapi import APIRouter
from app.services.nba_service import get_play_by_play

router = APIRouter()


@router.get("/{game_id}/pbp")
async def play_by_play(game_id: str):
    return get_play_by_play(game_id)


