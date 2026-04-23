import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "predictions.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
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
                prediction_id   INTEGER REFERENCES predictions(id)
            )
        """)
        conn.execute("""
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
        # migration for existing DBs
        try:
            conn.execute("ALTER TABLE predictions ADD COLUMN bets TEXT")
            conn.commit()
        except Exception:
            pass
        conn.commit()


def row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    for key in ("without_teammate_ids", "without_teammate_names",
                "excluded_defender_ids", "props", "sample_sizes", "actual_stats", "bets"):
        if d.get(key) is not None:
            d[key] = json.loads(d[key])
    return d
