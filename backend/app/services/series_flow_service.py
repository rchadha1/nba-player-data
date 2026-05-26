import re
from collections import defaultdict
from app.services.nba_service import get_player_game_log, _get, _resolve_to_espn_id

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"

_CACHE: dict = {}


def _shot_cat(text: str) -> str:
    t = text.lower()
    if "three" in t or "3-point" in t:
        return "3pt"
    if "free throw" in t:
        return "ft"
    if "dunk" in t or "layup" in t or "finger roll" in t or "tip" in t:
        return "paint"
    return "mid"


def _process_game(game_id: str, espn_id: str, opp_abbr: str) -> dict:
    if game_id in _CACHE:
        return _CACHE[game_id]

    data = _get(ESPN_SUMMARY, {"event": game_id})
    plays = data.get("plays", [])

    # Determine player's team ID from competitors (the one that isn't the opponent)
    player_team_id = ""
    for comp in data.get("header", {}).get("competitions", []):
        for team in comp.get("competitors", []):
            if team["team"]["abbreviation"] != opp_abbr:
                player_team_id = team["team"]["id"]

    # Team shot profile
    team_shots: dict = defaultdict(lambda: [0, 0])
    for p in plays:
        text = p.get("text", "")
        if "makes" not in text and "misses" not in text:
            continue
        if p.get("team", {}).get("id") != player_team_id:
            continue
        cat = _shot_cat(text)
        team_shots[cat][1] += 1
        if "makes" in text:
            team_shots[cat][0] += 1

    # Team Q scoring
    team_q: dict = defaultdict(int)
    for p in plays:
        if not p.get("scoringPlay"):
            continue
        if p.get("team", {}).get("id") != player_team_id:
            continue
        team_q[p.get("period", {}).get("number", 1)] += p.get("scoreValue", 0)

    # Player quarter scoring (by ESPN athlete ID in participants)
    player_q: dict = defaultdict(int)
    for p in plays:
        if not p.get("scoringPlay"):
            continue
        parts = p.get("participants", [])
        if not parts:
            continue
        if parts[0].get("athlete", {}).get("id", "") != espn_id:
            continue
        q = p.get("period", {}).get("number", 1)
        player_q[q] += p.get("scoreValue", 0)

    result = {
        "team_shots": {k: {"made": v[0], "att": v[1]} for k, v in team_shots.items()},
        "team_q": dict(team_q),
        "player_q": dict(player_q),
    }
    _CACHE[game_id] = result
    return result


def _pct(made: int, att: int) -> int:
    return round(made / att * 100) if att else 0


def _compute_signals(series_log: list, games: list) -> list:
    signals = []
    if not games:
        return signals

    last = games[-1]

    # Team 3PT volume warning
    att = last["team_3pt_att"]
    pct = last["team_3pt_pct"]
    if att >= 25:
        kind = "warning" if pct < 30 else "info"
        signals.append({"type": kind, "text": f"Team 3PT-heavy G{last['game_num']}: {att} att at {pct}%"})

    # Team FTA trend across last 2 games
    if len(games) == 2:
        delta = last["team_fta"] - games[0]["team_fta"]
        if abs(delta) >= 5:
            arrow = "↑" if delta > 0 else "↓"
            signals.append({
                "type": "info",
                "text": f"Team FTA {arrow}: G{games[0]['game_num']} {games[0]['team_fta']} → G{last['game_num']} {last['team_fta']}",
            })

    # Player FTA spike/drop
    if len(games) == 2:
        delta = last["player_fta"] - games[0]["player_fta"]
        if abs(delta) >= 3:
            arrow = "↑" if delta > 0 else "↓"
            signals.append({
                "type": "warning",
                "text": f"Player FTA {arrow}: G{games[0]['game_num']} {int(games[0]['player_fta'])} → G{last['game_num']} {int(last['player_fta'])}",
            })
    if last["player_fta"] == 0 and int(last["player_min"].split(":")[0] if ":" in str(last["player_min"]) else last["player_min"] or 0) >= 15:
        signals.append({"type": "info", "text": "0 FTA last game — opponent sagging, not fouling"})

    # Q4 fade
    total = last["player_q1"] + last["player_q2"] + last["player_q3"] + last["player_q4"]
    if total >= 10 and last["player_q4"] <= max(2, total * 0.15):
        pct_q4 = round(last["player_q4"] / total * 100)
        signals.append({
            "type": "warning",
            "text": f"Q4 fade: {last['player_q4']} pts in Q4 ({pct_q4}% of total) last game",
        })

    # Player underperformed vs series avg
    if len(series_log) >= 3:
        # avg excluding most recent game
        avg = sum(int(g.get("PTS", 0)) for g in series_log[1:]) / (len(series_log) - 1)
        if last["player_pts"] < avg * 0.6 and avg >= 8:
            signals.append({
                "type": "warning",
                "text": f"Underperformed last game: {last['player_pts']} pts vs {round(avg, 1)} series avg",
            })

    # Team paint efficiency
    paint_att = last["team_paint_att"]
    paint_pct = last["team_paint_pct"]
    if paint_att >= 8:
        signals.append({"type": "info", "text": f"Team paint: {last['team_paint_made']}/{paint_att} ({paint_pct}%) last game"})

    return signals


def get_series_flow(athlete_id: str) -> dict:
    log = get_player_game_log(athlete_id, season="2026")
    playoff = [g for g in log if "Post" in g.get("season_type", "")]

    if not playoff:
        return {"games": [], "signals": [], "opponent": None, "games_played": 0, "next_game_num": 1}

    opp_abbr = playoff[0].get("opponent_abbr")
    series = [g for g in playoff if g.get("opponent_abbr") == opp_abbr]
    played = [g for g in series if g.get("game_id")]

    if not played:
        return {"games": [], "signals": [], "opponent": opp_abbr, "games_played": 0, "next_game_num": 1}

    espn_id = _resolve_to_espn_id(athlete_id)

    last_2 = played[:2]  # most recent first
    games_out = []

    for i, game in enumerate(reversed(last_2)):  # chronological
        game_id = game["game_id"]
        game_num = len(series) - len(last_2) + i + 1

        pbp = _process_game(game_id, espn_id, opp_abbr)
        ts = pbp["team_shots"]
        pq = pbp["player_q"]

        total_q = pq.get(1, 0) + pq.get(2, 0) + pq.get(3, 0) + pq.get(4, 0)

        games_out.append({
            "game_num": game_num,
            "date": game.get("date", "")[:10],
            "result": game.get("result", "?"),
            # team shot profile
            "team_3pt_att":   ts.get("3pt", {}).get("att", 0),
            "team_3pt_made":  ts.get("3pt", {}).get("made", 0),
            "team_3pt_pct":   _pct(ts.get("3pt", {}).get("made", 0), ts.get("3pt", {}).get("att", 0)),
            "team_paint_att": ts.get("paint", {}).get("att", 0),
            "team_paint_made":ts.get("paint", {}).get("made", 0),
            "team_paint_pct": _pct(ts.get("paint", {}).get("made", 0), ts.get("paint", {}).get("att", 0)),
            "team_fta":       ts.get("ft", {}).get("att", 0),
            "team_ftm":       ts.get("ft", {}).get("made", 0),
            # player box score
            "player_pts":  int(game.get("PTS", 0)),
            "player_fta":  float(game.get("FTA", 0)),
            "player_3pa":  float(game.get("3PA", 0)),
            "player_min":  game.get("MIN", "?"),
            # player quarter scoring
            "player_q1": pq.get(1, 0),
            "player_q2": pq.get(2, 0),
            "player_q3": pq.get(3, 0),
            "player_q4": pq.get(4, 0),
            "player_q4_pct": round(pq.get(4, 0) / total_q * 100) if total_q else 0,
        })

    signals = _compute_signals(series, games_out)

    return {
        "opponent": opp_abbr,
        "games_played": len(series),
        "next_game_num": len(series) + 1,
        "games": games_out,
        "signals": signals,
    }
