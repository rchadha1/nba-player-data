# NBA Betting Analytics

Player data-driven app for making informed NBA player prop bets.

## Stack

| Layer | Tech |
|---|---|
| Backend | Python · FastAPI · nba_api · pbpstats |
| Web | React · Vite · TypeScript |
| Mobile | Expo · React Native · TypeScript |
| Database | PostgreSQL (recommended) |

## Project Structure

```
nba-player-data/
├── backend/          # FastAPI — data ingestion + betting analysis
├── web/              # React web app
└── mobile/           # Expo React Native mobile app
```

## Setup

### 1. Fix npm cache permissions (one-time)
```bash
sudo chown -R $(whoami) ~/.npm
```

### 2. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your DB URL
uvicorn app.main:app --reload
```

### 3. Web
```bash
cd web
npm install
cp .env.example .env.local
npm run dev            # runs at http://localhost:5173
```

### 4. Mobile
```bash
cd mobile
npm install
cp .env.example .env
npx expo start         # scan QR with Expo Go app
```

## Key Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/players/search?name=` | Search players by name |
| GET | `/api/players/{id}/gamelog` | Per-game stats for a season |
| GET | `/api/players/{id}/career` | Career stats |
| GET | `/api/events/{game_id}` | Full play-by-play for a game |
| POST | `/api/bets/analyze` | Prop bet hit-rate analysis |

### Analyze a prop (example)
```bash
curl -X POST http://localhost:8000/api/bets/analyze \
  -H "Content-Type: application/json" \
  -d '{"player_id": 2544, "prop": "PTS", "line": 24.5, "last_n_games": 10}'
```

Response:
```json
{
  "player_id": 2544,
  "prop": "PTS",
  "line": 24.5,
  "average": 27.3,
  "hit_rate": 0.7,
  "recommendation": "OVER",
  "game_values": [28, 31, 19, 25, ...]
}
```

## Data Sources

- **[nba_api](https://github.com/swar/nba_api)** — Free wrapper for stats.nba.com (play-by-play, shot charts, game logs)
- **[pbpstats](https://github.com/dblackrun/pbpstats)** — Possession-level event data
- **[BALLDONTLIE](https://www.balldontlie.io/)** — Live player props (optional, requires API key)

## Roadmap

- [ ] Add opponent defensive rating to prop analysis
- [ ] Home/away and back-to-back splits
- [ ] Shot chart visualizations
- [ ] Push notifications for high-confidence props
- [ ] ML model replacing hit-rate heuristic
