from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_conn

router = APIRouter()


class CreatePickRequest(BaseModel):
    game_date: Optional[str] = None
    game_label: Optional[str] = None
    player_id: Optional[str] = None
    player_name: str
    prop: str
    line: float
    pick: str               # "OVER" | "UNDER"
    result: Optional[str] = None   # "WIN" | "LOSS" | "PUSH"
    actual_value: Optional[float] = None
    line_type: str = "standard"    # "standard" | "goblin" | "demon"
    grade: Optional[str] = None    # "STRONG" | "LEAN" | "SKIP"
    predicted_value: Optional[float] = None
    notes: Optional[str] = None
    prediction_id: Optional[int] = None


class UpdatePickRequest(BaseModel):
    result: Optional[str] = None
    actual_value: Optional[float] = None
    notes: Optional[str] = None


def _row_to_dict(row) -> dict:
    return dict(row)


@router.post("")
async def create_pick(req: CreatePickRequest):
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO bet_picks
               (game_date, game_label, player_id, player_name, prop, line, pick,
                result, actual_value, line_type, grade, predicted_value, notes, prediction_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.game_date, req.game_label, req.player_id, req.player_name,
             req.prop, req.line, req.pick, req.result, req.actual_value,
             req.line_type, req.grade, req.predicted_value, req.notes, req.prediction_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM bet_picks WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row_to_dict(row)


@router.get("")
async def list_picks(
    player_id: Optional[str] = None,
    game_label: Optional[str] = None,
    result: Optional[str] = None,
    limit: int = 200,
):
    query = "SELECT * FROM bet_picks WHERE 1=1"
    params: list = []
    if player_id:
        query += " AND player_id=?"
        params.append(player_id)
    if game_label:
        query += " AND game_label LIKE ?"
        params.append(f"%{game_label}%")
    if result:
        query += " AND result=?"
        params.append(result.upper())
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/stats")
async def pick_stats(player_id: Optional[str] = None):
    query_base = "SELECT * FROM bet_picks WHERE result IS NOT NULL"
    params: list = []
    if player_id:
        query_base += " AND player_id=?"
        params.append(player_id)

    with get_conn() as conn:
        rows = [_row_to_dict(r) for r in conn.execute(query_base, params).fetchall()]

    if not rows:
        return {"total": 0, "wins": 0, "losses": 0, "win_rate": None, "by_prop": {}, "by_grade": {}, "by_line_type": {}}

    wins   = sum(1 for r in rows if r["result"] == "WIN")
    losses = sum(1 for r in rows if r["result"] == "LOSS")
    total  = wins + losses

    def breakdown(key: str) -> dict:
        groups: dict[str, dict] = {}
        for r in rows:
            val = r.get(key) or "unknown"
            if val not in groups:
                groups[val] = {"wins": 0, "losses": 0}
            if r["result"] == "WIN":
                groups[val]["wins"] += 1
            elif r["result"] == "LOSS":
                groups[val]["losses"] += 1
        for g in groups.values():
            t = g["wins"] + g["losses"]
            g["total"] = t
            g["win_rate"] = round(g["wins"] / t, 3) if t else None
        return dict(sorted(groups.items(), key=lambda x: x[1]["total"], reverse=True))

    return {
        "total":        total,
        "wins":         wins,
        "losses":       losses,
        "win_rate":     round(wins / total, 3) if total else None,
        "by_prop":      breakdown("prop"),
        "by_grade":     breakdown("grade"),
        "by_line_type": breakdown("line_type"),
    }


@router.patch("/{pick_id}")
async def update_pick(pick_id: int, req: UpdatePickRequest):
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM bet_picks WHERE id=?", (pick_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pick not found")
        fields, params = [], []
        if req.result is not None:
            fields.append("result=?")
            params.append(req.result.upper())
        if req.actual_value is not None:
            fields.append("actual_value=?")
            params.append(req.actual_value)
        if req.notes is not None:
            fields.append("notes=?")
            params.append(req.notes)
        if fields:
            params.append(pick_id)
            conn.execute(f"UPDATE bet_picks SET {', '.join(fields)} WHERE id=?", params)
            conn.commit()
        row = conn.execute("SELECT * FROM bet_picks WHERE id=?", (pick_id,)).fetchone()
    return _row_to_dict(row)


@router.delete("/{pick_id}")
async def delete_pick(pick_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM bet_picks WHERE id=?", (pick_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pick not found")
        conn.execute("DELETE FROM bet_picks WHERE id=?", (pick_id,))
        conn.commit()
    return {"deleted": pick_id}
