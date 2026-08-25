import asyncio
import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.api.routes import players, games, events, bets, teams, predictions, picks
from app.services.nba_service import _build_espn_id_cache
from app.db import init_db

app = FastAPI(title="NBA Betting Analytics API", version="0.1.0", redirect_slashes=False)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # An unhandled exception otherwise skips CORSMiddleware entirely and returns
    # a bare response with no Access-Control-Allow-Origin header, which browsers
    # report as a CORS failure even though the real cause is a server crash.
    print(f"[unhandled] {request.method} {request.url.path}: {type(exc).__name__}: {exc}")
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


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
