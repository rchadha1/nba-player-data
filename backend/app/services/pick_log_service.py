"""
Logs the grade the app gives every player prop before each game, so the money test can
check whether STRONG / SOLID / LEAN picks actually win at the prices shown.

One row per (game, player, prop), written by the Best Bets warm loop every cycle until
tip-off (bet_grader.py grades exactly like the client):
  final_* — the latest pregame grade and price, overwritten each cycle, so after tip-off
            it holds the last check before the game
  best_*  — the highest grade the prop reached that day (ties: bigger edge), with the
            price and time, kept even if the pick later fades

model_pick_history adds a row whenever a prop's grade, contract or side changes, so any
moment's pick can be replayed (e.g. "bet when it first turned SOLID").
"""
from datetime import date, datetime, timezone

from psycopg2.extras import execute_values

from app.db import get_conn, fetchall
from app.services.bet_grader import evaluate_bets, season_record, is_top_pick

_PICK_COLS = ["grade", "ticker", "side", "strike", "price", "prob", "edge", "top_pick", "at"]

# A new grade beats the stored best if it ranks higher, or ranks the same with a bigger edge
_BETTER = """(array_position(ARRAY['STRONG','SOLID','LEAN','SKIP'], EXCLUDED.best_grade)
                < array_position(ARRAY['STRONG','SOLID','LEAN','SKIP'], model_picks.best_grade)
              OR (EXCLUDED.best_grade = model_picks.best_grade AND EXCLUDED.best_edge > model_picks.best_edge))"""


def record_picks(game_id: str, game_date: date, tip_time: str, edges: dict) -> int:
    """Grade every player prop in a game's Best Bets data (as _with_quotes returns it) and
    upsert into model_picks. Returns the number of props logged."""
    now = datetime.now(timezone.utc)
    tip = datetime.fromisoformat(tip_time.replace("Z", "+00:00"))
    if now >= tip:
        return 0
    rows, history = [], []
    with get_conn() as conn:
        last = {(r["player_id"], r["prop"]): (r["grade"], r["ticker"], r["side"]) for r in fetchall(conn, """
            SELECT DISTINCT ON (player_id, prop) player_id, prop, grade, ticker, side FROM model_pick_history
            WHERE game_id = ? ORDER BY player_id, prop, changed_at DESC
        """, (game_id,))}
    for p in edges["players"]:
        games = p.get("season_games") or []
        for b in evaluate_bets(p["quotes"], p["prediction"]):
            hits, n = season_record(games, b)
            top = is_top_pick(games, b)
            pick = (b["grade"], b["ticker"], b["side"], b["line"], b["price"], round(b["prob"], 4),
                    round(b["edge"], 4), top, now)
            rows.append((game_date, game_id, tip, p["id"], p["name"], p["team_abbr"], b["prop"], b["expected"],
                         hits, n, " | ".join(b["warnings"]) or None, *pick, *pick))
            if last.get((p["id"], b["prop"])) != (b["grade"], b["ticker"], b["side"]):
                history.append((game_id, p["id"], b["prop"], now, game_date, p["name"], b["grade"], b["ticker"],
                                b["side"], b["line"], b["price"], round(b["prob"], 4), round(b["edge"], 4), top))
    if not rows:
        return 0

    final = ", ".join(f"final_{c} = EXCLUDED.final_{c}" for c in _PICK_COLS)
    best = ", ".join(f"best_{c} = CASE WHEN {_BETTER} THEN EXCLUDED.best_{c} ELSE model_picks.best_{c} END"
                     for c in _PICK_COLS)
    with get_conn() as conn:
        execute_values(conn.cursor(), f"""
            INSERT INTO model_picks (game_date, game_id, tip_time, player_id, player_name, team_abbr, prop,
                expected, season_hits, season_n, final_warnings,
                {", ".join(f"final_{c}" for c in _PICK_COLS)}, {", ".join(f"best_{c}" for c in _PICK_COLS)})
            VALUES %s
            ON CONFLICT (game_id, player_id, prop) DO UPDATE SET
                expected = EXCLUDED.expected, season_hits = EXCLUDED.season_hits, season_n = EXCLUDED.season_n,
                final_warnings = EXCLUDED.final_warnings, {final}, {best}
            WHERE model_picks.tip_time > EXCLUDED.final_at
        """, rows)
        if history:
            execute_values(conn.cursor(), """
                INSERT INTO model_pick_history (game_id, player_id, prop, changed_at, game_date, player_name,
                    grade, ticker, side, strike, price, prob, edge, top_pick)
                VALUES %s ON CONFLICT DO NOTHING
            """, history)
    return len(rows)
