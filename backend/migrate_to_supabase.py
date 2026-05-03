"""
One-time migration: SQLite predictions.db → Supabase PostgreSQL.

Usage:
  1. Set DATABASE_URL in backend/.env to the Supabase connection string
  2. Set YOUR_USER_ID to your UUID from Supabase Auth > Users
  3. Run: python3 migrate_to_supabase.py
  4. Verify counts, then you're done
"""

import json
import sqlite3
import sys
import os

# ── Config ──────────────────────────────────────────────────────────────────
SQLITE_PATH = os.path.join(os.path.dirname(__file__), "predictions.db")
YOUR_USER_ID = "355ca21e-e844-44d8-be2f-4e93e0510427"

# Load DATABASE_URL from .env
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ── Validation ───────────────────────────────────────────────────────────────
if not YOUR_USER_ID:
    print("ERROR: set YOUR_USER_ID in this script before running")
    sys.exit(1)
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in backend/.env")
    sys.exit(1)
# psycopg2 doesn't accept the asyncpg+postgresql:// prefix
pg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").replace("postgres+asyncpg://", "postgresql://")

# ── Connect ──────────────────────────────────────────────────────────────────
import psycopg2
import psycopg2.extras

sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = sqlite3.Row
pg_conn = psycopg2.connect(pg_url, cursor_factory=psycopg2.extras.RealDictCursor)
pg_conn.autocommit = False

def j(val):
    """Parse a JSON string from SQLite; return None if null."""
    if val is None:
        return None
    if isinstance(val, str):
        return json.loads(val)
    return val

try:
    # ── Migrate predictions ──────────────────────────────────────────────────
    rows = sqlite_conn.execute("SELECT * FROM predictions ORDER BY id").fetchall()
    print(f"Migrating {len(rows)} predictions...")

    old_to_new_prediction_id: dict[int, int] = {}

    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO public.predictions
                    (user_id, created_at, player_id, player_name, season, opponent, game_label,
                     without_teammate_ids, without_teammate_names, excluded_defender_ids,
                     props, sample_sizes, adjusted_pts, actual_stats, notes, bets)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (
                YOUR_USER_ID,
                r["created_at"],
                r["player_id"], r["player_name"], r["season"], r["opponent"], r["game_label"],
                json.dumps(j(r["without_teammate_ids"]) or []),
                json.dumps(j(r["without_teammate_names"]) or []),
                json.dumps(j(r["excluded_defender_ids"]) or []),
                json.dumps(j(r["props"])),
                json.dumps(j(r["sample_sizes"])),
                r["adjusted_pts"],
                json.dumps(j(r["actual_stats"])) if r["actual_stats"] else None,
                r["notes"],
                json.dumps(j(r["bets"])) if r["bets"] else None,
            ))
            new_id = cur.fetchone()["id"]
            old_to_new_prediction_id[r["id"]] = new_id

    # ── Migrate bet_picks ────────────────────────────────────────────────────
    rows = sqlite_conn.execute("SELECT * FROM bet_picks ORDER BY id").fetchall()
    print(f"Migrating {len(rows)} bet picks...")

    with pg_conn.cursor() as cur:
        for r in rows:
            new_pred_id = old_to_new_prediction_id.get(r["prediction_id"]) if r["prediction_id"] else None
            cur.execute("""
                INSERT INTO public.bet_picks
                    (user_id, created_at, game_date, game_label, player_id, player_name,
                     prop, line, pick, result, actual_value, line_type, grade,
                     predicted_value, notes, prediction_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                YOUR_USER_ID,
                r["created_at"],
                r["game_date"], r["game_label"], r["player_id"], r["player_name"],
                r["prop"], r["line"], r["pick"], r["result"], r["actual_value"],
                r["line_type"] or "standard", r["grade"],
                r["predicted_value"], r["notes"], new_pred_id,
            ))

    pg_conn.commit()
    print("Done. Verifying counts...")

    with pg_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM public.predictions WHERE user_id = %s", (YOUR_USER_ID,))
        pg_pred = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) FROM public.bet_picks WHERE user_id = %s", (YOUR_USER_ID,))
        pg_picks = cur.fetchone()["count"]

    sqlite_pred  = sqlite_conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    sqlite_picks = sqlite_conn.execute("SELECT COUNT(*) FROM bet_picks").fetchone()[0]

    print(f"  predictions : SQLite={sqlite_pred}  Supabase={pg_pred}  {'OK' if sqlite_pred == pg_pred else 'MISMATCH'}")
    print(f"  bet_picks   : SQLite={sqlite_picks} Supabase={pg_picks} {'OK' if sqlite_picks == pg_picks else 'MISMATCH'}")

except Exception as e:
    pg_conn.rollback()
    print(f"ERROR: {e}")
    raise
finally:
    sqlite_conn.close()
    pg_conn.close()
