from fastapi import APIRouter
from app.services.nba_service import get_teams, get_team_roster

router = APIRouter()


@router.get("/")
async def list_teams():
    """Returns all 30 NBA teams sorted alphabetically."""
    return get_teams()


@router.get("/{team_id}/roster")
async def team_roster(team_id: str):
    """Returns the current roster for a team by ESPN team ID."""
    return get_team_roster(team_id)
