"""
Records the last pregame quote for every Kalshi NBA player-prop contract in kalshi_quotes,
so model picks can later be backtested against prices that were actually available.

Every 15 minutes each contract whose game hasn't tipped is overwritten with its current
quote; once the game starts the row stops changing, leaving the final pregame quote.
"""
import threading
import time
from datetime import datetime, timezone

from psycopg2.extras import execute_values

from app.db import get_conn
from app.services.nba_service import (
    _get, ESPN_SITE, _ESPN_TO_NBA_ABBR, _kalshi_markets, _kalshi_event_date,
)


def _tip_times(game_date) -> dict[frozenset, datetime]:
    """{frozenset of NBA-style team codes: tip-off time} from ESPN's scoreboard."""
    board = _get(f"{ESPN_SITE}/scoreboard", {"dates": game_date.strftime("%Y%m%d")})
    tips = {}
    for ev in board.get("events", []):
        teams = frozenset(
            _ESPN_TO_NBA_ABBR.get(c["team"]["abbreviation"], c["team"]["abbreviation"])
            for c in ev["competitions"][0]["competitors"]
        )
        tips[teams] = datetime.fromisoformat(ev["date"].replace("Z", "+00:00"))
    return tips


def snapshot_kalshi_quotes() -> int:
    """Upserts current quotes for contracts whose game hasn't started. Returns rows written."""
    now = datetime.now(timezone.utc)
    tips_by_date: dict = {}
    rows = []
    for stat, m in _kalshi_markets():
        if m.get("strike_type") != "greater" or m.get("floor_strike") is None:
            continue
        game_date = _kalshi_event_date(m["event_ticker"])
        if game_date not in tips_by_date:
            tips_by_date[game_date] = _tip_times(game_date)
        code = m["event_ticker"].split("-")[1][7:]  # "MILMIA"
        tip = tips_by_date[game_date].get(frozenset((code[:3], code[3:])))
        if not tip or tip <= now:
            continue
        rows.append((
            m["ticker"], m["event_ticker"], game_date, tip, m.get("title", "").split(":")[0], stat,
            float(m["floor_strike"]), float(m.get("yes_bid_dollars") or 0), float(m.get("yes_ask_dollars") or 0),
            float(m.get("last_price_dollars") or 0), now,
        ))
    if rows:
        with get_conn() as conn:
            execute_values(conn.cursor(), """
                INSERT INTO kalshi_quotes (ticker, event_ticker, game_date, tip_time, player_name, stat,
                                           strike, yes_bid, yes_ask, last_price, captured_at)
                VALUES %s
                ON CONFLICT (ticker) DO UPDATE SET
                    yes_bid = EXCLUDED.yes_bid, yes_ask = EXCLUDED.yes_ask,
                    last_price = EXCLUDED.last_price, captured_at = EXCLUDED.captured_at
                WHERE kalshi_quotes.tip_time > EXCLUDED.captured_at
            """, rows)
    return len(rows)


def start_snapshot_loop(interval_minutes: float = 15) -> None:
    """Daemon thread: snapshot now, then every interval_minutes. Failures are logged and retried next cycle."""
    def loop():
        while True:
            try:
                print(f"[kalshi_quotes] stored {snapshot_kalshi_quotes()} pregame quotes")
            except Exception as e:
                print(f"[kalshi_quotes] snapshot failed: {e}")
            time.sleep(interval_minutes * 60)
    threading.Thread(target=loop, daemon=True).start()
