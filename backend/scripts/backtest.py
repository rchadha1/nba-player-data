"""
Replays predict_game_performance on this season's finished games, giving the model
only the games played BEFORE each target game, and reports mean absolute error per
stat against a naive "season average to date" baseline.

    cd backend && .venv/bin/python -m scripts.backtest [--phase regular|playoffs] [--out rows.json] [--players N]

Players come from box_scores, and a game counts only if the player averaged MIN_PRIOR_MPG+
minutes in his games BEFORE it. Choosing players by anything known today (current Kalshi
markets, full-season minutes) favours players whose roles grew, which made every prediction
look ~0.5 PTS too low.

Held constant (disabled) in every run so before/after comparisons are fair:
  - defender matchup + team pace: season-level aggregates that leak future games
    and hit stats.nba.com, which throttles
  - injury status: only the current status is available, not historical

--defender enables the playoff defender matchup adjustment using PREVIOUS-season data
only (entirely before any game being replayed, so nothing leaks). The regular season
has no defender term.

Position defense always runs, reading only box_scores rows dated before each game.
"""
import argparse
import json
import random
from datetime import datetime, timedelta
from statistics import mean

from app.db import get_conn, fetchall
from app.services import betting_service as bs
from app.services.box_score_service import get_position_defense
from app.services.nba_service import (
    get_player_game_log, get_team_defensive_matchup, CURRENT_SEASON,
)

STATS = ["PTS", "REB", "AST", "3PT", "STL", "BLK"]
AVG_KEYS = ["PTS", "REB", "AST", "STL", "BLK", "3PT", "3PA", "FTM", "FTA", "2PM", "2PA", "MIN", "PF"]
MIN_PRIOR_GAMES = 5
MIN_PRIOR_MPG = 20


def _season_avgs(games: list[dict]) -> dict:
    """Stand-in for ESPN's official season averages, computed from prior games only."""
    out = {k: round(mean(bs._parse_stat(g.get(k)) for g in games), 1) for k in AVG_KEYS}
    made = sum(int(g["FG"].split("-")[0]) for g in games if "-" in str(g.get("FG")))
    att = sum(int(g["FG"].split("-")[1]) for g in games if "-" in str(g.get("FG")))
    out["FG%"] = round(made / att * 100, 1) if att else 0.0
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", help="force a phase (only once predict_game_performance accepts it)")
    ap.add_argument("--out", help="write per-prediction rows to this JSON file")
    ap.add_argument("--defender", action="store_true", help="enable defender adj from previous-season data")
    ap.add_argument("--players", type=int, help="random sample of N players (seed 42) for a quicker run")
    args = ap.parse_args()
    extra = {"phase": args.phase} if args.phase else {}

    prev_season = str(int(CURRENT_SEASON) - 1)
    bs.get_team_defensive_matchup = (
        (lambda pid, opp, _season=None: get_team_defensive_matchup(pid, opp, prev_season))
        if args.defender else (lambda *a, **k: {})
    )
    bs._compute_pace_ratio = lambda *a, **k: (1.0, None, None, "none")
    bs.get_player_injury_status = lambda *a, **k: "Active"

    with get_conn() as conn:
        players = [(r["player_id"], r["name"]) for r in fetchall(conn, """
            SELECT player_id, MAX(player_name) AS name FROM box_scores
            WHERE season = ? AND season_type = 2 AND min > 0
            GROUP BY player_id HAVING COUNT(*) > ? ORDER BY name
        """, (CURRENT_SEASON, MIN_PRIOR_GAMES))]
    if args.players:
        players = random.Random(42).sample(players, min(args.players, len(players)))

    rows = []
    for pid, name in players:
        try:
            games = [g for g in get_player_game_log(pid) if "Regular" in g.get("season_type", "")]
        except Exception as e:
            print(f"  {name}: skipped ({type(e).__name__}: {e})")
            continue
        for i, target in enumerate(games):
            prior = games[i + 1:]  # game logs are newest-first
            if len(prior) < MIN_PRIOR_GAMES or mean(bs._parse_stat(g.get("MIN")) for g in prior) < MIN_PRIOR_MPG:
                continue
            bs.get_player_game_log = lambda _pid, _season=None, prior=prior: prior
            bs.get_player_season_averages = lambda _pid, _season=None, prior=prior: _season_avgs(prior)
            # Log dates are UTC; box_scores uses the US date the game was played
            game_day = (datetime.fromisoformat(target["date"].replace("Z", "+00:00")) - timedelta(hours=5)).date()
            bs.get_position_defense = lambda pid, opp, game_day=game_day: get_position_defense(pid, opp, before=game_day)
            pred = bs.predict_game_performance(
                player_id=pid,
                opponent=target["opponent_name"],
                without_teammate_ids=None,
                is_home=target["home_away"] == "home",
                **extra,
            )
            naive = _season_avgs(prior)
            rows.append({
                "player": name, "date": target["date"], "opponent": target["opponent_name"],
                "n_prior": len(prior),
                **{f"{s}_actual": bs._parse_stat(target.get(s)) for s in STATS},
                **{f"{s}_pred": pred["props"][s]["expected"] for s in STATS},
                **{f"{s}_naive": naive[s] for s in STATS},
                "confidence": {s: pred["props"][s]["confidence"] for s in STATS},
                "def_poss": pred["sample_sizes"]["def_poss"],
                "def_adj": pred["props"]["PTS"]["defender_adj"],
                "pos_def_adj": pred["props"]["PTS"]["position_def_adj"],
            })
        print(f"  {name}: {sum(r['player'] == name for r in rows)} games")

    print(f"\n{len(rows)} predictions, {len({r['player'] for r in rows})} players\n")
    print(f"{'stat':5} {'model MAE':>10} {'naive MAE':>10} {'model better':>13} {'model bias':>11}")
    for s in STATS:
        m = mean(abs(r[f"{s}_pred"] - r[f"{s}_actual"]) for r in rows)
        n = mean(abs(r[f"{s}_naive"] - r[f"{s}_actual"]) for r in rows)
        bias = mean(r[f"{s}_pred"] - r[f"{s}_actual"] for r in rows)
        print(f"{s:5} {m:10.3f} {n:10.3f} {(n - m) / n * 100:12.1f}% {bias:+11.2f}")

    if args.defender:
        adj = [r for r in rows if r["def_adj"]]
        print(f"\ndefender adj applied to {len(adj)}/{len(rows)} PTS predictions")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()
