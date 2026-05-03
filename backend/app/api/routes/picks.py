from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.db import get_conn, execute, fetchone, fetchall, lastrowid
from app.core.auth import get_current_user, require_premium
from app.services.game_analysis_service import analyze_game

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
    player_name: Optional[str] = None
    prop: Optional[str] = None
    line: Optional[float] = None
    pick: Optional[str] = None
    line_type: Optional[str] = None
    result: Optional[str] = None
    actual_value: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
async def create_pick(req: CreatePickRequest, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cur = execute(conn, """
            INSERT INTO bet_picks
              (user_id, game_date, game_label, player_id, player_name, prop, line, pick,
               result, actual_value, line_type, grade, predicted_value, notes, prediction_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id
        """, (user["id"], req.game_date, req.game_label, req.player_id, req.player_name,
              req.prop, req.line, req.pick, req.result, req.actual_value,
              req.line_type, req.grade, req.predicted_value, req.notes, req.prediction_id))
        row = fetchone(conn, "SELECT * FROM bet_picks WHERE id=?", (lastrowid(conn, cur),))
    return row


@router.get("")
async def list_picks(
    player_id: Optional[str] = None,
    game_label: Optional[str] = None,
    result: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(get_current_user),
):
    query = "SELECT * FROM bet_picks WHERE user_id=?"
    params: list = [user["id"]]
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
        return fetchall(conn, query, params)


@router.get("/stats")
async def pick_stats(player_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = "SELECT * FROM bet_picks WHERE user_id=? AND result IS NOT NULL"
    params: list = [user["id"]]
    if player_id:
        query += " AND player_id=?"
        params.append(player_id)
    with get_conn() as conn:
        rows = fetchall(conn, query, params)

    if not rows:
        return {"total": 0, "wins": 0, "losses": 0, "voids": 0, "win_rate": None,
                "by_prop": {}, "by_grade": {}, "by_line_type": {}, "by_prop_pick": {}}

    wins   = sum(1 for r in rows if r["result"] == "WIN")
    losses = sum(1 for r in rows if r["result"] == "LOSS")
    voids  = sum(1 for r in rows if r["result"] == "VOID")
    total  = wins + losses

    def breakdown(key: str) -> dict:
        groups: dict[str, dict] = {}
        for r in rows:
            val = r.get(key) or "unknown"
            g = groups.setdefault(val, {"wins": 0, "losses": 0})
            if r["result"] == "WIN":    g["wins"] += 1
            elif r["result"] == "LOSS": g["losses"] += 1
        for g in groups.values():
            t = g["wins"] + g["losses"]
            g["total"] = t
            g["win_rate"] = round(g["wins"] / t, 3) if t else None
        return dict(sorted(groups.items(), key=lambda x: x[1]["total"], reverse=True))

    def breakdown_prop_direction() -> dict:
        groups: dict[str, dict] = {}
        for r in rows:
            prop = r.get("prop") or "unknown"
            direction = r.get("pick") or "unknown"
            groups.setdefault(prop, {}).setdefault(direction, {"wins": 0, "losses": 0})
            g = groups[prop][direction]
            if r["result"] == "WIN":    g["wins"] += 1
            elif r["result"] == "LOSS": g["losses"] += 1
        for directions in groups.values():
            for g in directions.values():
                t = g["wins"] + g["losses"]
                g["total"] = t
                g["win_rate"] = round(g["wins"] / t, 3) if t else None
        return dict(sorted(groups.items(), key=lambda x: sum(d["total"] for d in x[1].values()), reverse=True))

    return {
        "total":        total, "wins": wins, "losses": losses, "voids": voids,
        "win_rate":     round(wins / total, 3) if total else None,
        "by_prop":      breakdown("prop"),
        "by_grade":     breakdown("grade"),
        "by_line_type": breakdown("line_type"),
        "by_prop_pick": breakdown_prop_direction(),
    }


@router.patch("/{pick_id}")
async def update_pick(pick_id: int, req: UpdatePickRequest, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        if not fetchone(conn, "SELECT id FROM bet_picks WHERE id=? AND user_id=?", (pick_id, user["id"])):
            raise HTTPException(status_code=404, detail="Pick not found")
        fields, params = [], []
        upper_cols = {"result", "pick", "grade"}
        for col in ("player_name", "prop", "line", "pick", "line_type", "result", "actual_value", "grade", "notes"):
            val = getattr(req, col)
            if val is not None:
                fields.append(f"{col}=?")
                params.append(val.upper() if isinstance(val, str) and col in upper_cols else val)
        if fields:
            params.extend([pick_id, user["id"]])
            execute(conn, f"UPDATE bet_picks SET {', '.join(fields)} WHERE id=? AND user_id=?", params)
        return fetchone(conn, "SELECT * FROM bet_picks WHERE id=?", (pick_id,))


class AnalyzeGameRequest(BaseModel):
    game_label: str
    game_date: Optional[str] = None


@router.post("/analyze-game")
async def analyze_game_picks(req: AnalyzeGameRequest, user: dict = Depends(require_premium)):
    with get_conn() as conn:
        if req.game_date:
            rows = fetchall(conn,
                "SELECT * FROM bet_picks WHERE user_id=? AND game_label LIKE ? AND game_date=? ORDER BY created_at ASC",
                (user["id"], f"%{req.game_label}%", req.game_date))
        else:
            rows = fetchall(conn,
                "SELECT * FROM bet_picks WHERE user_id=? AND game_label LIKE ? ORDER BY created_at ASC",
                (user["id"], f"%{req.game_label}%"))

    if not rows:
        raise HTTPException(status_code=404, detail=f"No picks found for game '{req.game_label}'")

    game_date = req.game_date or (rows[0].get("game_date") or "")
    result = analyze_game(req.game_label, game_date, rows)
    if result.get("error") and not result.get("report"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.delete("/{pick_id}")
async def delete_pick(pick_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        if not fetchone(conn, "SELECT id FROM bet_picks WHERE id=? AND user_id=?", (pick_id, user["id"])):
            raise HTTPException(status_code=404, detail="Pick not found")
        execute(conn, "DELETE FROM bet_picks WHERE id=? AND user_id=?", (pick_id, user["id"]))
    return {"deleted": pick_id}
