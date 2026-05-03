import json
import sqlite3
from typing import Optional, List
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from pathlib import Path
from app.core.config import settings

# ─── Connection ──────────────────────────────────────────────────────────────

_SQLITE_PATH = Path(__file__).parent.parent / "predictions.db"
_use_postgres = bool(settings.database_url)


@contextmanager
def get_conn():
    if _use_postgres:
        conn = psycopg2.connect(settings.database_url, cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(_SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _placeholder() -> str:
    return "%s" if _use_postgres else "?"


# ─── Query helpers ────────────────────────────────────────────────────────────

def execute(conn, sql: str, params=()) -> "cursor":
    """Run sql with the correct placeholder style for the active backend."""
    if _use_postgres:
        sql = sql.replace("?", "%s")
    cur = conn.cursor()
    cur.execute(sql, params)
    return cur


def fetchone(conn, sql: str, params=()) -> Optional[dict]:
    cur = execute(conn, sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def fetchall(conn, sql: str, params=()) -> List[dict]:
    cur = execute(conn, sql, params)
    return [dict(r) for r in cur.fetchall()]


def lastrowid(conn, cur, table: str = "id") -> int:
    if _use_postgres:
        row = cur.fetchone()
        return row[table] if row else None
    return cur.lastrowid


# ─── JSON helpers ─────────────────────────────────────────────────────────────

_JSON_COLS = {
    "without_teammate_ids", "without_teammate_names",
    "excluded_defender_ids", "props", "sample_sizes", "actual_stats", "bets",
}


def row_to_dict(row) -> dict:
    d = dict(row)
    for key in _JSON_COLS:
        if d.get(key) is not None and isinstance(d[key], str):
            d[key] = json.loads(d[key])
    return d


def _json(val) -> Optional[str]:
    """Serialize to JSON string for SQLite; pass through for Postgres (JSONB)."""
    if val is None:
        return None
    if _use_postgres:
        return json.dumps(val) if not isinstance(val, str) else val
    return json.dumps(val) if not isinstance(val, str) else val


# ─── Schema (SQLite only — Postgres schema is in supabase_schema.sql) ─────────

def init_db():
    if _use_postgres:
        return  # schema managed via supabase_schema.sql
    with get_conn() as conn:
        execute(conn, """
            CREATE TABLE IF NOT EXISTS bet_picks (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT    DEFAULT (datetime('now')),
                game_date       TEXT,
                game_label      TEXT,
                player_id       TEXT,
                player_name     TEXT    NOT NULL,
                prop            TEXT    NOT NULL,
                line            REAL    NOT NULL,
                pick            TEXT    NOT NULL,
                result          TEXT,
                actual_value    REAL,
                line_type       TEXT    NOT NULL DEFAULT 'standard',
                grade           TEXT,
                predicted_value REAL,
                notes           TEXT,
                prediction_id   INTEGER
            )
        """)
        execute(conn, """
            CREATE TABLE IF NOT EXISTS predictions (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at            TEXT    DEFAULT (datetime('now')),
                player_id             TEXT    NOT NULL,
                player_name           TEXT    NOT NULL,
                season                TEXT    NOT NULL,
                opponent              TEXT    NOT NULL,
                game_label            TEXT,
                without_teammate_ids  TEXT    NOT NULL DEFAULT '[]',
                without_teammate_names TEXT   NOT NULL DEFAULT '[]',
                excluded_defender_ids TEXT    NOT NULL DEFAULT '[]',
                props                 TEXT    NOT NULL,
                sample_sizes          TEXT    NOT NULL,
                adjusted_pts          REAL,
                actual_stats          TEXT,
                bets                  TEXT,
                notes                 TEXT
            )
        """)
        try:
            execute(conn, "ALTER TABLE predictions ADD COLUMN bets TEXT")
        except Exception:
            pass
