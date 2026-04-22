import json
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_conn, row_to_dict

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
def save_prediction(req: SavePredictionRequest):
    with get_conn() as conn:
        cur = conn.execute("""
            INSERT INTO predictions
                (player_id, player_name, season, opponent, game_label,
                 without_teammate_ids, without_teammate_names, excluded_defender_ids,
                 props, sample_sizes, adjusted_pts, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            req.player_id, req.player_name, req.season, req.opponent, req.game_label,
            json.dumps(req.without_teammate_ids),
            json.dumps(req.without_teammate_names),
            json.dumps(req.excluded_defender_ids),
            json.dumps(req.props),
            json.dumps(req.sample_sizes),
            req.adjusted_pts,
            req.notes,
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM predictions WHERE id=?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row)


@router.get("")
def list_predictions(player_id: Optional[str] = None, opponent: Optional[str] = None):
    with get_conn() as conn:
        if player_id and opponent:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE player_id=? AND opponent=? ORDER BY created_at DESC",
                (player_id, opponent)
            ).fetchall()
        elif player_id:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE player_id=? ORDER BY created_at DESC",
                (player_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM predictions ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
    return [row_to_dict(r) for r in rows]


@router.get("/{prediction_id}")
def get_prediction(prediction_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM predictions WHERE id=?", (prediction_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Prediction not found")
    return row_to_dict(row)


@router.patch("/{prediction_id}/actuals")
def record_actuals(prediction_id: int, req: RecordActualsRequest):
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE predictions SET actual_stats=? WHERE id=?",
            (json.dumps(req.actual_stats), prediction_id)
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Prediction not found")
        row = conn.execute("SELECT * FROM predictions WHERE id=?", (prediction_id,)).fetchone()
    return row_to_dict(row)


@router.patch("/{prediction_id}/bets")
def save_bets(prediction_id: int, req: SaveBetsRequest):
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE predictions SET bets=? WHERE id=?",
            (json.dumps(req.bets), prediction_id)
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Prediction not found")
        row = conn.execute("SELECT * FROM predictions WHERE id=?", (prediction_id,)).fetchone()
    return row_to_dict(row)


@router.delete("/{prediction_id}", status_code=204)
def delete_prediction(prediction_id: int):
    with get_conn() as conn:
        result = conn.execute("DELETE FROM predictions WHERE id=?", (prediction_id,))
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Prediction not found")
