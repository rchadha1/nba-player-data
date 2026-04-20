import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes import players, games, events, bets, teams, predictions
from app.services.nba_service import _build_espn_id_cache
from app.db import init_db

app = FastAPI(title="NBA Betting Analytics API", version="0.1.0")


@app.on_event("startup")
async def startup():
    init_db()
    asyncio.get_event_loop().run_in_executor(None, _build_espn_id_cache)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8081"],
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


@app.get("/health")
async def health():
    return {"status": "ok"}
