import asyncio
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes import players, games, events, bets, teams, predictions, picks
from app.services.nba_service import _build_espn_id_cache
from app.db import init_db

app = FastAPI(title="NBA Betting Analytics API", version="0.1.0", redirect_slashes=False)


@app.on_event("startup")
async def startup():
    init_db()
    asyncio.get_event_loop().run_in_executor(None, _build_espn_id_cache)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router, prefix="/api/players", tags=["players"])
app.include_router(games.router, prefix="/api/games", tags=["games"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(bets.router, prefix="/api/bets", tags=["bets"])
app.include_router(teams.router, prefix="/api/teams", tags=["teams"])
app.include_router(predictions.router, prefix="/api/predictions", tags=["predictions"])
app.include_router(picks.router, prefix="/api/picks", tags=["picks"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/nba-stats")
async def health_nba_stats():
    from app.services.nba_service import check_stats_nba_reachable
    return check_stats_nba_reachable()


@app.get("/health/nba-matchup-test")
async def health_nba_matchup_test(player_id: str = "201939", opponent: str = "Phoenix Suns"):
    from app.services.nba_service import get_team_defensive_matchup
    start = time.time()
    result = get_team_defensive_matchup(player_id, opponent)
    return {
        "elapsed_s": round(time.time() - start, 2),
        "found": bool(result),
        "season": result.get("season"),
        "season_type": result.get("season_type"),
        "n_defenders": result.get("n_defenders"),
    }


@app.get("/health/db")
async def health_db():
    import psycopg2
    direct_url = settings.direct_database_url
    if direct_url:
        try:
            conn = psycopg2.connect(direct_url, sslmode="require")
            try:
                cur = conn.cursor()
                cur.execute("SELECT 1")
            finally:
                conn.close()
            return {"status": "ok", "via": "direct"}
        except Exception as e:
            return {"status": "error", "detail": str(e)}
    else:
        from app.db import get_conn, execute
        with get_conn() as conn:
            execute(conn, "SELECT 1")
        return {"status": "ok", "via": "pooler"}
