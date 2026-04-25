from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from app.services.betting_service import analyze_player_prop, predict_game_performance

router = APIRouter()


class PropRequest(BaseModel):
    player_id: str
    prop: str           # "PTS", "REB", "AST", "STL", "BLK", "3PT"
    line: float
    last_n_games: int = 10
    season: str = "2026"
    opponent: Optional[str] = None   # full team name, e.g. "Houston Rockets"


class PredictRequest(BaseModel):
    player_id: str
    opponent: str
    without_teammate_ids: Optional[list[str]] = None
    season: str = "2026"
    is_home: Optional[bool] = None
    spread: Optional[float] = None
    series_context: Optional[str] = None  # e.g. "Series tied 1-1, team lost G2 at home"


@router.post("/predict")
async def predict_game(req: PredictRequest):
    """
    Projects expected stat values for an upcoming game using additive
    adjustment with Bayesian shrinkage across opponent and teammate factors.
    Appends LLM situational reasoning when series_context is provided.
    """
    result = predict_game_performance(
        player_id=req.player_id,
        opponent=req.opponent,
        without_teammate_ids=req.without_teammate_ids,
        season=req.season,
        is_home=req.is_home,
        spread=req.spread,
    )

    if req.series_context:
        try:
            from app.services.llm_service import situational_reasoning
            result["situational_reasoning"] = situational_reasoning(
                player_name    = result.get("player_name", req.player_id),
                opponent       = req.opponent,
                is_home        = req.is_home,
                series_context = req.series_context,
                props          = result.get("props", {}),
                risk_flags     = result.get("risk_flags", {}),
            )
        except Exception:
            result["situational_reasoning"] = None

    return result


@router.post("/analyze")
async def analyze_prop(req: PropRequest):
    """
    Core endpoint: given a player prop line, returns hit rate,
    rolling average, and an OVER/UNDER/PASS recommendation.
    Pass opponent to restrict analysis to games vs that team only.
    """
    return analyze_player_prop(
        player_id=req.player_id,
        prop=req.prop,
        line=req.line,
        last_n_games=req.last_n_games,
        season=req.season,
        opponent=req.opponent,
    )
