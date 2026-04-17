from fastapi import APIRouter
from app.services.nba_service import get_teams

router = APIRouter()


@router.get("/")
async def list_teams():
    """Returns all 30 NBA teams sorted alphabetically."""
    return get_teams()
