import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from app.core.auth import get_current_user
from app.services.betting_service import predict_game_performance
from app.services.box_score_service import get_season_games
from app.services.nba_service import (
    get_play_by_play, get_today_games, get_game_roster, get_playoff_games, get_kalshi_quotes, kalshi_lines_from_quotes,
    get_kalshi_urls, _get, ESPN_SITE,
)

router = APIRouter()

_edges_cache: dict[str, tuple[float, dict]] = {}
_EDGES_CACHE_TTL = 1200  # 20 minutes — outlives the 15-minute warm cycle so warmed games stay hot
_EDGES_WORKERS   = 5     # predictions in flight at once — each mostly waits on ESPN
_EDGES_WARM_MIN  = 15    # pre-compute today's pregame games this often


@router.get("/today")
async def today_games():
    """Returns today's NBA games with scores and status."""
    return get_today_games()


@router.get("/playoff")
async def playoff_games():
    """Returns recent and upcoming NBA playoff games (last 14 days + next 7 days)."""
    return get_playoff_games()


@router.get("/{game_id}/roster")
async def game_roster(game_id: str):
    """Returns players for both teams in a game with injury status."""
    return get_game_roster(game_id)


@router.get("/{game_id}/pbp")
async def play_by_play(game_id: str):
    return get_play_by_play(game_id)


@router.get("/{game_id}/edges")
def game_edges(game_id: str, _: dict = Depends(get_current_user)):
    """
    Prediction + Kalshi quotes for every non-Out player in the game who has Kalshi markets.
    Grading stays client-side (betEvaluator.ts) so the rules live in one place.
    Kalshi quotes come from the cached full-board fetch, so this adds no Kalshi requests.

    Predictions are cached; quotes and game_state ('pre' / 'in' / 'post') are attached fresh
    on every call — prices move, and after tip-off they react to the game, which the
    pregame model can't see.
    """
    t0 = time.time()
    state = _get(f"{ESPN_SITE}/summary", {"event": game_id})["header"]["competitions"][0]["status"]["type"]["state"]
    hit = _edges_cache.get(game_id)
    cached = bool(hit and time.time() - hit[0] < _EDGES_CACHE_TTL)
    result = hit[1] if cached else _compute_edges(game_id)
    if result is None:
        return {"status": "unavailable", "players": [], "failed": [], "game_state": state}
    response = _with_quotes(result, state)
    print(f"[edges] {game_id}: {len(result['players'])} players in {time.time() - t0:.1f}s ({'cached' if cached else 'computed'})")
    return response


def _compute_edges(game_id: str) -> Optional[dict]:
    """Predictions for every non-Out player with Kalshi markets; cached. None if Kalshi is down."""
    roster = get_game_roster(game_id)
    teams = list(roster.values())
    if len(teams) != 2:
        return {"status": "ok", "players": [], "failed": []}

    jobs = []
    for team, opp in ((teams[0], teams[1]), (teams[1], teams[0])):
        out_ids = [p["id"] for p in team["players"] if p["status"] == "Out"]
        for p in team["players"]:
            if p["status"] == "Out":
                continue
            quotes = get_kalshi_quotes(p["name"])
            if quotes is None:
                return None
            if quotes:
                jobs.append((p, team, opp, out_ids))

    def run(job):
        p, team, opp, out_ids = job
        prediction = predict_game_performance(
            player_id=p["id"],
            opponent=opp["name"],
            without_teammate_ids=out_ids or None,
            is_home=team["home_away"] == "home" if team.get("home_away") else None,
        )
        return {"id": p["id"], "name": p["name"], "team_abbr": team["abbr"], "status": p["status"],
                "prediction": prediction, "season_games": get_season_games(p["id"])}

    players, failed = [], []
    with ThreadPoolExecutor(max_workers=_EDGES_WORKERS) as pool:
        for job, fut in [(j, pool.submit(run, j)) for j in jobs]:
            try:
                result = fut.result()
                if result["prediction"]:
                    players.append(result)
                else:
                    failed.append(job[0]["name"])
            except Exception as e:
                print(f"[game_edges] {job[0]['name']} failed: {type(e).__name__}: {e}")
                failed.append(job[0]["name"])

    result = {"status": "ok", "players": players, "failed": failed}
    _edges_cache[game_id] = (time.time(), result)
    return result


def start_edges_warm_loop() -> None:
    """Daemon thread: every _EDGES_WARM_MIN minutes, pre-compute Best Bets for today's games
    that haven't tipped, so a click is served from cache instead of waiting ~10-30s."""
    def loop():
        while True:
            try:
                # US Eastern date: servers run on UTC, where tonight's games are already "tomorrow"
                today_et = (datetime.now(timezone.utc) - timedelta(hours=5)).date()
                board = _get(f"{ESPN_SITE}/scoreboard", {"dates": today_et.strftime("%Y%m%d")})
                pre = [ev["id"] for ev in board.get("events", []) if ev["status"]["type"]["state"] == "pre"]
                t0 = time.time()
                for game_id in pre:
                    _compute_edges(game_id)
                print(f"[edges] warmed {len(pre)} pregame games in {time.time() - t0:.0f}s")
            except Exception as e:
                print(f"[edges] warm failed: {type(e).__name__}: {e}")
            time.sleep(_EDGES_WARM_MIN * 60)
    threading.Thread(target=loop, daemon=True).start()


def _with_quotes(result: dict, state: str) -> dict:
    """Attach current Kalshi quotes (plus reference lines and kalshi.com links) to cached predictions."""
    players = []
    for p in result["players"]:
        quotes = get_kalshi_quotes(p["name"])
        if quotes is None:
            return {"status": "unavailable", "players": [], "failed": [], "game_state": state}
        players.append({**p, "quotes": quotes, "lines": kalshi_lines_from_quotes(quotes),
                        "urls": get_kalshi_urls(p["name"])})
    return {**result, "players": players, "game_state": state}
