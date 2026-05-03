import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.db import get_conn, execute, fetchone, fetchall, lastrowid, row_to_dict
from app.core.auth import get_current_user

router = APIRouter()


class SavePredictionRequest(BaseModel):
    player_id: str
    player_name: str
    season: str
    opponent: str
    game_label: Optional[str] = None
    without_teammate_ids: list[str] = []
    without_teammate_names: list[str] = []
    excluded_defender_ids: list[str] = []
    props: dict
    sample_sizes: dict
    adjusted_pts: Optional[float] = None
    notes: Optional[str] = None


class RecordActualsRequest(BaseModel):
    actual_stats: dict  # e.g. {"PTS": 19, "REB": 8, "AST": 13, "STL": 2, "BLK": 1, "3PT": 1}


class SaveBetsRequest(BaseModel):
    bets: list[dict]  # [{stat, line, pick, result}]


@router.post("", status_code=201)
def save_prediction(req: SavePredictionRequest, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cur = execute(conn, """
            INSERT INTO predictions
                (user_id, player_id, player_name, season, opponent, game_label,
                 without_teammate_ids, without_teammate_names, excluded_defender_ids,
                 props, sample_sizes, adjusted_pts, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id
        """, (
            user["id"], req.player_id, req.player_name, req.season, req.opponent, req.game_label,
            json.dumps(req.without_teammate_ids),
            json.dumps(req.without_teammate_names),
            json.dumps(req.excluded_defender_ids),
            json.dumps(req.props),
            json.dumps(req.sample_sizes),
            req.adjusted_pts,
            req.notes,
        ))
        row = fetchone(conn, "SELECT * FROM predictions WHERE id=?", (lastrowid(conn, cur),))
    return row_to_dict(row)


@router.get("")
def list_predictions(
    player_id: Optional[str] = None,
    opponent: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    with get_conn() as conn:
        if player_id and opponent:
            rows = fetchall(conn,
                "SELECT * FROM predictions WHERE user_id=? AND player_id=? AND opponent=? ORDER BY created_at DESC",
                (user["id"], player_id, opponent))
        elif player_id:
            rows = fetchall(conn,
                "SELECT * FROM predictions WHERE user_id=? AND player_id=? ORDER BY created_at DESC",
                (user["id"], player_id))
        else:
            rows = fetchall(conn,
                "SELECT * FROM predictions WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
                (user["id"],))
    return [row_to_dict(r) for r in rows]


@router.get("/{prediction_id}")
def get_prediction(prediction_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        row = fetchone(conn, "SELECT * FROM predictions WHERE id=? AND user_id=?", (prediction_id, user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Prediction not found")
    return row_to_dict(row)


@router.patch("/{prediction_id}/actuals")
def record_actuals(prediction_id: int, req: RecordActualsRequest, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        if not fetchone(conn, "SELECT id FROM predictions WHERE id=? AND user_id=?", (prediction_id, user["id"])):
            raise HTTPException(status_code=404, detail="Prediction not found")
        execute(conn, "UPDATE predictions SET actual_stats=? WHERE id=?",
                (json.dumps(req.actual_stats), prediction_id))
        return row_to_dict(fetchone(conn, "SELECT * FROM predictions WHERE id=?", (prediction_id,)))


@router.patch("/{prediction_id}/bets")
def save_bets(prediction_id: int, req: SaveBetsRequest, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        if not fetchone(conn, "SELECT id FROM predictions WHERE id=? AND user_id=?", (prediction_id, user["id"])):
            raise HTTPException(status_code=404, detail="Prediction not found")
        execute(conn, "UPDATE predictions SET bets=? WHERE id=?",
                (json.dumps(req.bets), prediction_id))
        return row_to_dict(fetchone(conn, "SELECT * FROM predictions WHERE id=?", (prediction_id,)))


@router.delete("/{prediction_id}", status_code=204)
def delete_prediction(prediction_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        if not fetchone(conn, "SELECT id FROM predictions WHERE id=? AND user_id=?", (prediction_id, user["id"])):
            raise HTTPException(status_code=404, detail="Prediction not found")
        execute(conn, "DELETE FROM predictions WHERE id=? AND user_id=?", (prediction_id, user["id"]))
