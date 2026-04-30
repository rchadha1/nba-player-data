"""
Post-game pick analysis: fetches ESPN PBP + box score for a completed game
and generates a per-pick breakdown explaining each win/loss.
"""
import re
import time
import requests
from typing import Optional

from app.services.nba_service import ESPN_SITE, HEADERS, _normalize_name

# Common nickname → substring found in ESPN team name
_LABEL_ALIASES: dict[str, str] = {
    "cavs": "cavalier",
    "mavs": "maverick",
    "sixers": "76er",
    "dubs": "warrior",
    "wolves": "timberwolf",
    "blazers": "trail blazer",
    "pacers": "pacer",
}


def _get(url: str, params: dict = {}) -> dict:
    time.sleep(0.3)
    r = requests.get(url, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def _find_espn_game(game_label: str, game_date: str) -> Optional[dict]:
    """Find ESPN game matching label on game_date (tries ±1 day if not found)."""
    from datetime import datetime, timedelta

    label_lower = game_label.lower()
    vs_idx = label_lower.find(" vs ")
    sep = " vs "
    if vs_idx < 0:
        vs_idx = label_lower.find(" at ")
        sep = " at "

    if vs_idx >= 0:
        left_raw  = re.sub(r'\s+g(?:ame)?\s*\d+$', '', label_lower[:vs_idx]).strip()
        right_raw = re.sub(r'\s+g(?:ame)?\s*\d+$', '', label_lower[vs_idx + len(sep):]).strip()
        keywords = [left_raw, right_raw]
    else:
        keywords = [label_lower]

    # Expand aliases
    expanded = []
    for kw in keywords:
        expanded.append(_LABEL_ALIASES.get(kw, kw))

    def _keyword_in(kw: str, text: str) -> bool:
        alias = _LABEL_ALIASES.get(kw, kw)
        # Use first 5 chars of each word to handle plural/suffix differences
        for token in (kw, alias):
            for word in token.split():
                if len(word) >= 3 and word[:5] in text:
                    return True
        return False

    def _try_date(date_str: str) -> Optional[dict]:
        compact = date_str.replace("-", "")[:8]
        try:
            data = _get(f"{ESPN_SITE}/scoreboard", {"dates": compact})
        except Exception:
            return None
        for event in data.get("events", []):
            name = (event.get("name") or "").lower()
            if all(_keyword_in(kw, name) for kw in keywords):
                comps = (event.get("competitions") or [{}])[0]
                competitors = comps.get("competitors", [])
                home = next((c for c in competitors if c.get("homeAway") == "home"), {})
                away = next((c for c in competitors if c.get("homeAway") == "away"), {})
                return {
                    "id":         event["id"],
                    "home_abbr":  home.get("team", {}).get("abbreviation", ""),
                    "home_name":  home.get("team", {}).get("displayName", ""),
                    "away_abbr":  away.get("team", {}).get("abbreviation", ""),
                    "away_name":  away.get("team", {}).get("displayName", ""),
                    "home_score": home.get("score", ""),
                    "away_score": away.get("score", ""),
                }
        return None

    if game_date:
        for delta in (0, -1, 1):
            try:
                dt = datetime.fromisoformat(game_date[:10]) + timedelta(days=delta)
                result = _try_date(dt.strftime("%Y%m%d"))
                if result:
                    return result
            except Exception:
                pass
    return None


def _extract_box_players(data: dict) -> dict:
    """Returns {player_name_lower: {name, team, home_away, stats}} from boxscore."""
    result = {}
    boxscore = data.get("boxscore", {})
    comp = (data.get("header", {}).get("competitions") or [{}])[0]
    team_homeaway: dict[str, str] = {}
    for c in comp.get("competitors", []):
        tid = str(c.get("team", {}).get("id", ""))
        team_homeaway[tid] = c.get("homeAway", "")

    for team in boxscore.get("players", []):
        team_abbr = team.get("team", {}).get("abbreviation", "")
        team_id   = str(team.get("team", {}).get("id", ""))
        home_away = team_homeaway.get(team_id, "")
        stats_meta = (team.get("statistics") or [{}])[0]
        labels = stats_meta.get("labels", [])
        for p in stats_meta.get("athletes", []):
            name  = p.get("athlete", {}).get("displayName", "")
            stats = dict(zip(labels, p.get("stats", [])))
            result[name.lower()] = {
                "name":     name,
                "team":     team_abbr,
                "home_away": home_away,
                "stats":    stats,
            }
    return result


def _extract_quarter_scores(data: dict) -> list[dict]:
    """Returns [{q, home, away, home_running, away_running}, ...]."""
    comp = (data.get("header", {}).get("competitions") or [{}])[0]
    home = next((c for c in comp.get("competitors", []) if c.get("homeAway") == "home"), {})
    away = next((c for c in comp.get("competitors", []) if c.get("homeAway") == "away"), {})
    home_q = [int(ls.get("displayValue") or 0) for ls in home.get("linescores", [])]
    away_q = [int(ls.get("displayValue") or 0) for ls in away.get("linescores", [])]
    quarters, rh, ra = [], 0, 0
    for i, (h, a) in enumerate(zip(home_q, away_q)):
        rh += h; ra += a
        quarters.append({"q": i + 1, "home": h, "away": a, "home_running": rh, "away_running": ra})
    return quarters


def _game_script_summary(quarters: list[dict], home_name: str, away_name: str) -> str:
    if not quarters:
        return ""
    final = quarters[-1]
    hf, af = final["home_running"], final["away_running"]
    margin = abs(hf - af)
    winner = home_name if hf > af else away_name
    ht_home = sum(q["home"] for q in quarters[:2])
    ht_away = sum(q["away"] for q in quarters[:2])
    ht_margin = abs(ht_home - ht_away)
    ht_leader = home_name if ht_home > ht_away else away_name
    q1 = quarters[0]
    q1_margin = abs(q1["home"] - q1["away"])
    q1_leader = home_name if q1["home"] > q1["away"] else away_name

    if margin >= 15 and ht_margin >= 15 and ht_leader == winner:
        script = (
            f"Home blowout — {winner} led wire to wire, up {ht_margin} at halftime."
            if winner == home_name
            else f"Road blowout — {winner} dominated from the jump, up {ht_margin} at halftime."
        )
    elif margin >= 15 and ht_margin >= 10 and ht_leader != winner:
        script = (
            f"Massive comeback — {ht_leader} led by {ht_margin} at halftime but {winner} "
            f"outscored them in the second half to win by {margin}."
        )
    elif margin >= 10:
        script = f"{winner} controlled most of the game, winning by {margin}. Led by {ht_margin} at half."
    elif ht_margin <= 3:
        script = f"Close game — within {ht_margin} at halftime. {winner} won by {margin}."
    else:
        script = f"{ht_leader} led by {ht_margin} at halftime. {winner} closed it out, winning by {margin}."

    if q1_margin >= 12:
        q1_h = q1["home"] if q1_leader == home_name else q1["away"]
        q1_a = q1["away"] if q1_leader == home_name else q1["home"]
        script += f" {q1_leader} blew it open in Q1 ({q1_h}–{q1_a})."
    return script


def _player_in_text(full_norm: str, text_norm: str) -> bool:
    """
    True when the player's full normalized name appears as a substring in the text.
    Using the full name ("lebron james") prevents matching plays that only mention
    another player who shares a first or last name (e.g. James Harden, LaMelo Ball).
    Falls back to last-name-only for players with 8+ char last names (distinctive enough).
    """
    if full_norm in text_norm:
        return True
    # Distinctive long last name — last name alone is unambiguous
    parts = full_norm.split()
    last = parts[-1] if parts else full_norm
    return len(last) >= 8 and last in text_norm


def _parse_player_pbp(player_name: str, plays: list) -> dict:
    """Extract key PBP events for a player from raw ESPN plays."""
    full_norm  = _normalize_name(player_name)
    norm_parts = full_norm.split()

    fouls_by_q:     dict[int, list[str]] = {1: [], 2: [], 3: [], 4: []}
    turnovers_by_q: dict[int, list[str]] = {1: [], 2: [], 3: [], 4: []}
    bench_outs:     list[dict] = []
    made_shots:     list[str]  = []
    missed_shots:   list[str]  = []
    three_attempts  = 0
    three_makes     = 0
    ft_makes        = 0
    ft_attempts     = 0
    pts_by_q:       dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
    seen_foul_keys: set = set()

    for play in plays:
        text = (play.get("text") or "").strip()
        if not text:
            continue
        text_norm = _normalize_name(text)

        # Fast reject: full name must appear somewhere in the play
        if not _player_in_text(full_norm, text_norm):
            continue

        period_raw = play.get("period", {})
        qt = int(period_raw.get("number", 0)) if isinstance(period_raw, dict) else int(period_raw or 0)
        clock_raw = play.get("clock", {})
        clock = clock_raw.get("displayValue", "") if isinstance(clock_raw, dict) else str(clock_raw or "")
        home_s = play.get("homeScore", 0)
        away_s = play.get("awayScore", 0)
        text_lower = text.lower()
        snippet = text[:90]

        # Primary-actor check: ESPN parentheticals name secondary participants
        # (e.g. "Durant bad pass (LeBron James steals)" or "Smart makes 3PT (LeBron assists)").
        # Only attribute events to the player when their name appears BEFORE any "(".
        primary_norm = text_norm.split("(")[0]
        is_primary   = _player_in_text(full_norm, primary_norm)

        if "foul" in text_lower and 1 <= qt <= 4 and is_primary:
            key = (qt, clock)
            if key not in seen_foul_keys:
                seen_foul_keys.add(key)
                fouls_by_q[qt].append(f"Q{qt} {clock}: {snippet}")

        elif any(k in text_lower for k in ("turnover", "bad pass", "out of bounds", "lost ball", "travel")):
            if 1 <= qt <= 4 and is_primary:
                turnovers_by_q[qt].append(f"Q{qt} {clock}: {snippet}")

        elif "enters the game for" in text_lower:
            after_for = _normalize_name(text.split("enters the game for", 1)[-1])
            if _player_in_text(full_norm, after_for):
                bench_outs.append({"q": qt, "clock": clock, "score": f"{home_s}–{away_s}", "text": snippet})

        elif "makes" in text_lower and is_primary:
            made_shots.append(f"Q{qt} {clock}: {snippet}")
            is_three = "three" in text_lower or "3-point" in text_lower or "3 point" in text_lower
            is_ft    = "free throw" in text_lower
            if is_ft:
                ft_makes    += 1
                ft_attempts += 1
                if 1 <= qt <= 4:
                    pts_by_q[qt] += 1
            elif is_three:
                three_makes    += 1
                three_attempts += 1
                if 1 <= qt <= 4:
                    pts_by_q[qt] += 3
            else:
                if 1 <= qt <= 4:
                    pts_by_q[qt] += 2

        elif "misses" in text_lower and is_primary:
            missed_shots.append(f"Q{qt} {clock}: {snippet}")
            is_three = "three" in text_lower or "3-point" in text_lower or "3 point" in text_lower
            is_ft    = "free throw" in text_lower
            if is_ft:
                ft_attempts += 1
            elif is_three:
                three_attempts += 1

    return {
        "fouls_by_q":     fouls_by_q,
        "turnovers_by_q": turnovers_by_q,
        "bench_outs":     bench_outs,
        "made_shots":     made_shots,
        "missed_shots":   missed_shots,
        "three_attempts": three_attempts,
        "three_makes":    three_makes,
        "ft_makes":       ft_makes,
        "ft_attempts":    ft_attempts,
        "pts_by_q":       pts_by_q,
    }


def _box_line(stats: dict) -> str:
    pts = stats.get("PTS", "—"); reb = stats.get("REB", "—"); ast = stats.get("AST", "—")
    mins = stats.get("MIN", "—"); fg = stats.get("FG", "—"); tp = stats.get("3PT", "—")
    ft = stats.get("FT", "—"); to_ = stats.get("TO", "—"); pf = stats.get("PF", "—"); pm = stats.get("+/-", "—")
    return f"{pts} PTS, {reb} REB, {ast} AST in {mins} min | FG: {fg}, 3PT: {tp}, FT: {ft}, TO: {to_}, PF: {pf} | {pm}"


def _result_icon(result: Optional[str]) -> str:
    return {"WIN": "✓", "LOSS": "✗", "PUSH": "~"}.get(result or "", "○")


def _parse_shooting(stat_str) -> tuple:
    """'8-15' → (8, 15). Returns (0, 0) on failure."""
    try:
        a, b = str(stat_str).split("-")
        return int(a), int(b)
    except Exception:
        return 0, 0


def _int_stat(stats: dict, key: str) -> int:
    try:
        return int(stats.get(key) or 0)
    except (ValueError, TypeError):
        return 0


def _pick_section(pick: dict, pbp: dict, box_player: Optional[dict]) -> str:
    name     = pick["player_name"]
    prop     = pick["prop"]
    pick_dir = pick["pick"]
    line     = pick["line"]
    actual   = pick.get("actual_value")
    result   = pick.get("result")
    ltype    = pick.get("line_type", "standard")

    type_tag   = f" [{ltype.upper()}]" if ltype != "standard" else ""
    actual_str = str(actual) if actual is not None else "?"
    icon       = _result_icon(result)
    lines      = [f"**{name} — {prop} {pick_dir} {line}{type_tag} → {actual_str} {icon}**"]

    stats = (box_player or {}).get("stats", {})
    if box_player:
        lines.append(_box_line(stats))

    bullets: list[str] = []

    # ── Box score splits ───────────────────────────────────────────────────
    fg_made, fg_att   = _parse_shooting(stats.get("FG",  "0-0"))
    tp_made, tp_att   = _parse_shooting(stats.get("3PT", "0-0"))
    ft_made, ft_att   = _parse_shooting(stats.get("FT",  "0-0"))
    to_count          = _int_stat(stats, "TO")
    pf_count          = _int_stat(stats, "PF")
    reb_count         = _int_stat(stats, "REB")
    ast_count         = _int_stat(stats, "AST")
    pts_count         = _int_stat(stats, "PTS")
    try:
        pm_val = int(str(stats.get("+/-", "0")).replace("+", ""))
    except (ValueError, TypeError):
        pm_val = 0
    mins_str = str(stats.get("MIN", "") or "")
    try:
        mins_played: Optional[float] = float(mins_str.split(":")[0]) if ":" in mins_str else float(mins_str)
    except (ValueError, TypeError):
        mins_played = None

    gap = round(float(actual) - float(line), 1) if actual is not None else None
    fg_pct = round(fg_made / fg_att * 100) if fg_att > 0 else 0

    # ── PBP-derived data ───────────────────────────────────────────────────
    q1_fouls    = pbp["fouls_by_q"].get(1, [])
    q2_fouls    = pbp["fouls_by_q"].get(2, [])
    pf_pbp      = sum(len(v) for v in pbp["fouls_by_q"].values())
    foul_early  = len(q1_fouls) >= 2 or (len(q1_fouls) == 1 and len(q2_fouls) >= 1)
    all_tos     = [t for q in pbp["turnovers_by_q"].values() for t in q]
    pts_by_q    = pbp.get("pts_by_q", {})
    pbp_3a      = pbp["three_attempts"]
    pbp_3m      = pbp["three_makes"]
    pbp_fta     = pbp.get("ft_attempts", 0)
    pbp_ftm     = pbp.get("ft_makes", 0)
    pbp_pts     = sum(pts_by_q.values())

    # Quarter scoring string, e.g. "Q1: 6  Q2: 8  Q3: 4  Q4: 10"
    q_scoring_str = "  ".join(
        f"Q{q}: {pts_by_q.get(q, 0)}" for q in (1, 2, 3, 4) if pts_by_q.get(q, 0) > 0
    )

    # Best quarter for scoring
    best_q  = max(pts_by_q, key=lambda q: pts_by_q.get(q, 0), default=0)
    best_q_pts = pts_by_q.get(best_q, 0) if best_q else 0

    ha = (box_player or {}).get("home_away", "")

    # ── Foul trouble (always relevant) ────────────────────────────────────
    if len(q1_fouls) >= 2:
        bullets.append(
            f"2 fouls in Q1 → coach immediately restricted minutes to protect foul situation. "
            "Early foul trouble is the single biggest cause of unders not hitting."
        )
    elif len(q1_fouls) == 1 and len(q2_fouls) >= 1:
        bullets.append("Picked up fouls in Q1 and Q2 — coach limited run before halftime to protect the foul count.")
    if pf_count >= 5:
        bullets.append(f"Fouled out ({pf_count} PF) — missed meaningful Q4 possessions.")
    elif pf_count == 4 and prop in ("REB", "AST", "BLK", "PTS"):
        bullets.append("4 personal fouls forced passive play late — avoided contact to stay on the floor.")

    # ── Prop-specific analysis ─────────────────────────────────────────────
    if prop == "PTS":
        if pick_dir == "OVER":
            if result == "LOSS":
                if fg_pct < 38 and fg_att >= 8:
                    bullets.append(
                        f"Shot {fg_made}-{fg_att} ({fg_pct}%) from the field — cold shooting was the primary reason. "
                        f"{q_scoring_str or 'Scoring spread thin across all quarters.'}"
                    )
                elif fg_att < 10 and not foul_early:
                    bullets.append(
                        f"Low shot volume: only {fg_att} FGA. "
                        + ("Game script likely reduced usage." if pm_val <= -10 else "Touches weren't coming his way.")
                    )
                elif ft_att == 0:
                    bullets.append(
                        f"Shot {fg_made}-{fg_att} ({fg_pct}%) but never got to the free throw line — "
                        "missing that scoring avenue was the difference."
                    )
                else:
                    bullets.append(
                        f"Shot {fg_made}-{fg_att} ({fg_pct}%) with {ft_made}/{ft_att} FT — "
                        f"fell {abs(gap)} short of {line}. {q_scoring_str or ''}"
                    )
                if to_count >= 3:
                    bullets.append(f"{to_count} turnovers cost possessions and disrupted rhythm.")
            else:  # WIN
                if q_scoring_str:
                    bullets.append(f"Scoring distribution: {q_scoring_str}.")
                if fg_pct >= 55 and fg_att >= 10:
                    bullets.append(f"Efficient {fg_made}-{fg_att} ({fg_pct}%) shooting drove the total over.")
                if ft_att >= 6:
                    bullets.append(f"Got to the line {ft_att} times ({ft_made}/{ft_att} FT) — free throw volume helped clear the line.")
                if pbp_3m >= 3:
                    bullets.append(f"Hit {pbp_3m} threes to pad the scoring total.")
                if best_q_pts >= 10:
                    bullets.append(f"Big Q{best_q} ({best_q_pts} pts from PBP) was the catalyst for exceeding {line}.")

        else:  # UNDER
            if result == "LOSS":
                # Scored MORE than expected — explain WHY
                if q_scoring_str:
                    bullets.append(f"Scoring distribution: {q_scoring_str}.")
                if best_q_pts >= 10:
                    bullets.append(
                        f"Exploded for {best_q_pts} pts in Q{best_q} — that quarter alone pushed past the {line} line. "
                        + ("Late-game clutch situations drew heavy usage." if best_q == 4 else "Hot stretch in the half drove the total up.")
                    )
                if pbp_3m >= 3:
                    bullets.append(
                        f"Made {pbp_3m}-of-{pbp_3a} threes ({round(pbp_3m/pbp_3a*100) if pbp_3a else 0}%) — above-average three-point shooting inflated the total."
                    )
                if pbp_fta >= 8:
                    bullets.append(
                        f"Got to the line {pbp_fta} times ({pbp_ftm}/{pbp_fta}) — unusually high FTA count added extra points."
                    )
                if fg_pct >= 55 and fg_att >= 10:
                    bullets.append(f"Shot an efficient {fg_pct}% from the field — hard to bet unders when shooting that well.")
                if not bullets or len(bullets) == 1:
                    bullets.append(
                        f"Scored {pts_count} vs under line {line} — exceeded by {abs(gap)}. "
                        f"Shot {fg_made}-{fg_att} ({fg_pct}%) with {ft_att} FTAs."
                    )
            else:  # WIN (UNDER hit)
                if fg_pct < 40 and fg_att >= 8:
                    bullets.append(f"Cold shooting ({fg_made}-{fg_att}, {fg_pct}%) kept the total under {line}.")
                if fg_att < 10 and not foul_early:
                    bullets.append(f"Only {fg_att} FGA — low shot volume kept scoring down.")
                if best_q_pts <= 6 and pts_count <= line:
                    bullets.append(f"No single big quarter: {q_scoring_str or 'scoring spread thin'}.")

    elif prop == "3PT":
        if tp_att == 0 or pbp_3a == 0:
            bullets.append(
                "0 three-point attempts — never pulled the trigger from outside. "
                "3PT props require attempts; no attempts = guaranteed loss regardless of pick direction."
            )
        elif pick_dir == "OVER" and result == "LOSS":
            pct = round(pbp_3m / pbp_3a * 100) if pbp_3a > 0 else 0
            if pbp_3a < int(line) * 2:
                bullets.append(
                    f"Only attempted {pbp_3a} threes — not enough volume to realistically hit {int(line)} makes. "
                    f"Made {pbp_3m} of those ({pct}%)."
                )
            else:
                bullets.append(
                    f"Went {pbp_3m}-{pbp_3a} ({pct}%) from three — volume was there but shots didn't fall."
                )
        elif pick_dir == "UNDER" and result == "LOSS":
            bullets.append(
                f"Made {pbp_3m}-of-{pbp_3a} threes — exceeded the {line} line. "
                "Unusually hot from three; this is variance-driven unless it was a systemic mismatch."
            )
        else:
            bullets.append(f"Went {pbp_3m}-{pbp_3a} from three to {'clear' if result == 'WIN' else 'miss'} the {line} line.")

    elif prop == "REB":
        if pick_dir == "OVER" and result == "LOSS":
            if foul_early or pf_count >= 4:
                bullets.append(
                    f"Foul trouble ({pf_count} PF) directly cut rebounding chances — "
                    "fewer box-out possessions near the basket and conservative run from the coach."
                )
            elif mins_played and mins_played < 28:
                bullets.append(f"Only {int(mins_played)} minutes played — fewer possessions directly caps rebound totals.")
            elif pm_val <= -15 and ha == "away":
                bullets.append(
                    f"Road blowout (–{abs(pm_val)}): starters pulled early in Q4, "
                    "fewer meaningful possessions to grab boards."
                )
            else:
                bullets.append(
                    f"Grabbed {reb_count} vs line {line} — fell {abs(gap)} short. "
                    "Opponent pace, box-out schemes, or game script can suppress totals unpredictably."
                )
        elif pick_dir == "UNDER" and result == "LOSS":
            bullets.append(
                f"Hauled in {reb_count} rebounds to exceed the {line} under line by {abs(gap)}. "
                + ("Dominant on the glass in a high-possession game." if reb_count >= 12 else "")
            )
        else:
            bullets.append(f"Grabbed {reb_count} rebounds — {'cleared' if result == 'WIN' else 'fell short of'} the {line} line.")
            if not foul_early and result == "WIN":
                bullets.append("Stayed out of foul trouble — full minutes near the basket.")

    elif prop == "AST":
        if pick_dir == "OVER" and result == "LOSS":
            if fg_att >= 15:
                bullets.append(
                    f"High scoring load ({fg_att} FGA, {pts_count} PTS) — player was being fed the ball rather than facilitating. "
                    "Shot-heavy roles suppress assist totals."
                )
            elif to_count >= 3:
                bullets.append(
                    f"{to_count} turnovers — heavy TO nights often come with coaches tightening ball movement, fewer sets run through that player."
                )
            elif pm_val <= -10:
                bullets.append(
                    f"Team trailed by {abs(pm_val)} — falling behind forces isolation/hero ball and shrinks assist opportunities."
                )
            else:
                bullets.append(f"Only {ast_count} assists vs line {line} — teammate shooting and offensive scheme drove this.")
        elif pick_dir == "UNDER" and result == "LOSS":
            bullets.append(
                f"Dished {ast_count} assists to exceed the {line} under line. "
                "Teammates were hitting shots and the offense ran through him."
            )
        else:
            bullets.append(f"Dished {ast_count} assists — {'cleared' if result == 'WIN' else 'fell short of'} the {line} line.")

    elif prop == "STL":
        if result == "LOSS":
            bullets.append(
                f"Recorded {actual} steals vs line {line}. Steals are high-variance — they depend on opponent "
                "ball-handling tendencies, defensive assignments, and opportunistic reads. "
                "Hard to bet with confidence without opponent TO rate analysis."
            )
        else:
            bullets.append(f"Recorded {actual} steals to {'clear' if pick_dir == 'OVER' else 'stay under'} the {line} line.")

    elif prop == "BLK":
        if result == "LOSS":
            bullets.append(
                f"Only {actual} blocks vs line {line}. Blocks are highly dependent on whether opponents attack the paint — "
                "perimeter-heavy offenses or opponents who avoided the rim will suppress totals regardless of rim protection ability."
            )
        else:
            bullets.append(f"Blocked {actual} shots to {'clear' if pick_dir == 'OVER' else 'stay under'} the {line} line.")

    elif "+" in prop:
        if result == "LOSS" and gap is not None:
            bullets.append(
                f"Combined {prop} fell {abs(gap)} short of {line}. "
                + ("Foul trouble suppressed multiple counting categories." if foul_early or pf_count >= 4
                   else "One weak category dragged the combined total under.")
            )
        elif gap is not None:
            bullets.append(f"Combined {prop} cleared {line} by {gap}.")

    # ── Turnovers (secondary context) ─────────────────────────────────────
    if to_count >= 4 and not any("turnover" in b.lower() for b in bullets):
        bullets.append(f"{to_count} turnovers — significant ball security issues disrupted rhythm.")
    elif to_count >= 2 and prop in ("AST",) and not any("turnover" in b.lower() for b in bullets):
        bullets.append(f"{to_count} turnovers alongside {ast_count} assists — assist opportunities may have been limited by live-ball TOs.")

    # ── Game script context ────────────────────────────────────────────────
    if ha == "away" and pm_val <= -15 and not any("blowout" in b.lower() for b in bullets):
        bullets.append(
            f"Road blowout loss (–{abs(pm_val)}): starters typically get early exits in Q4 when down 20+, "
            "reducing final counting stats."
        )
    elif ha == "home" and pm_val >= 15 and result == "WIN" and prop in ("PTS", "REB", "AST"):
        bullets.append(f"Home blowout win (+{pm_val}): comfortable lead means full starter run in a controlled offense.")

    if pick.get("notes"):
        bullets.append(f"Note: {pick['notes']}")

    if bullets:
        lines.append("")
        for b in bullets:
            lines.append(f"- {b}")

    return "\n".join(lines)


def _fuzzy_box_lookup(player_name: str, box_players: dict) -> Optional[dict]:
    norm = _normalize_name(player_name)
    if norm in box_players:
        return box_players[norm]
    parts = norm.split()
    last  = parts[-1] if parts else norm
    for k, v in box_players.items():
        if last in k.split():
            return v
    return None


def _parse_num(val) -> int:
    """Parse a stat value to int, handling '2-5' made-attempt format."""
    try:
        return int(float(str(val or 0).split("-")[0]))
    except (ValueError, TypeError):
        return 0


def _format_series_summary(prop: str, games: list[dict]) -> str:
    """Format series game log for a prop as 'G1: X stat, Ymin | G2: ...' (most recent first)."""
    if not games:
        return ""
    parts = []
    for i, g in enumerate(games, 1):
        mins = g.get("MIN", "?")
        p = _parse_num(g.get("PTS", 0))
        r = _parse_num(g.get("REB", 0))
        a = _parse_num(g.get("AST", 0))
        if prop == "PTS":
            stat = f"{p} pts"
        elif prop == "REB":
            stat = f"{r} reb"
        elif prop == "AST":
            stat = f"{a} ast"
        elif prop == "3PT":
            made = _parse_num(g.get("3PT", 0))
            att = int(float(g.get("3PA") or 0))
            stat = f"{made}-{att} 3PT"
        elif prop == "STL":
            stat = f"{_parse_num(g.get('STL', 0))} stl"
        elif prop == "BLK":
            stat = f"{_parse_num(g.get('BLK', 0))} blk"
        elif prop == "FTM":
            made = _parse_num(g.get("FT", 0))
            att = int(float(g.get("FTA") or 0))
            stat = f"{made}/{att} ftm"
        elif prop == "PTS+REB+AST":
            stat = f"{p}pts/{r}reb/{a}ast ({p+r+a})"
        elif prop == "PTS+REB":
            stat = f"{p}pts/{r}reb ({p+r})"
        elif prop == "PTS+AST":
            stat = f"{p}pts/{a}ast ({p+a})"
        elif prop == "AST+REB":
            stat = f"{a}ast/{r}reb ({a+r})"
        else:
            stat = "?"
        parts.append(f"G{i}: {stat}, {mins}min")
    return " | ".join(parts)


def _build_series_summaries(
    picks: list[dict],
    box_players: dict,
    home_abbr: str,
    away_abbr: str,
) -> dict[str, str]:
    """
    Returns {f"{player_name}|{prop}": formatted_series_string} for each pick.
    Fetches each player's playoff series game log vs their series opponent.
    """
    from app.services.nba_service import get_player_game_log
    from app.services.betting_service import _filter_vs, _filter_series

    player_series: dict[str, list[dict]] = {}
    seen_ids: set[str] = set()
    summaries: dict[str, str] = {}

    for pick in picks:
        player_name = pick["player_name"]
        player_id   = (pick.get("player_id") or "").strip()

        if player_name not in player_series:
            if not player_id or player_id in seen_ids:
                player_series[player_name] = []
            else:
                seen_ids.add(player_id)
                box         = _fuzzy_box_lookup(player_name, box_players)
                player_team = (box or {}).get("team", "").upper()
                if player_team == home_abbr.upper():
                    opp = away_abbr
                elif player_team == away_abbr.upper():
                    opp = home_abbr
                else:
                    player_series[player_name] = []
                    continue
                try:
                    all_games = get_player_game_log(player_id, "2026")
                    opp_games = _filter_vs(all_games, opp)
                    player_series[player_name] = _filter_series(opp_games)
                except Exception:
                    player_series[player_name] = []

        games = player_series.get(player_name, [])
        if games:
            summaries[f"{player_name}|{pick['prop']}"] = _format_series_summary(pick["prop"], games)

    return summaries


def analyze_game(game_label: str, game_date: str, picks: list[dict]) -> dict:
    """
    Finds the ESPN game, pulls PBP + box score, generates a per-pick
    breakdown report as a markdown string.
    """
    game = _find_espn_game(game_label, game_date)
    if not game:
        return {"error": f"Could not find ESPN game for '{game_label}' on {game_date}.", "report": None}

    game_id   = game["id"]
    home_name = game["home_name"]
    away_name = game["away_name"]
    home_abbr = game["home_abbr"]
    away_abbr = game["away_abbr"]

    try:
        data = _get(f"{ESPN_SITE}/summary", {"event": game_id})
    except Exception as e:
        return {"error": f"Failed to fetch game data: {e}", "report": None}

    plays       = data.get("plays", [])
    box_players = _extract_box_players(data)
    quarters    = _extract_quarter_scores(data)
    script      = _game_script_summary(quarters, home_name, away_name)

    q_str = " | ".join(
        f"Q{q['q']}: {home_abbr} {q['home']}–{away_abbr} {q['away']}"
        for q in quarters
    )

    # Parse PBP for every picked player upfront
    pbp_by_player = {
        p["player_name"]: _parse_player_pbp(p["player_name"], plays)
        for p in picks
    }

    # Fetch series game logs for each player
    series_summaries = _build_series_summaries(picks, box_players, home_abbr, away_abbr)

    # Try LLM-generated report first; fall back to rule-based if key not configured
    try:
        from app.services.llm_service import game_analysis_report
        final_score = f"{away_abbr} {game['away_score']} – {home_abbr} {game['home_score']} ({home_name} home)"
        report_text = game_analysis_report(
            game_label        = game_label,
            final_score       = final_score,
            quarter_breakdown = q_str,
            game_script       = script,
            picks             = picks,
            box_scores        = box_players,
            pbp_by_player     = pbp_by_player,
            series_summaries  = series_summaries,
        )
    except Exception:
        # Fall back to rule-based report
        wins    = [p for p in picks if p.get("result") == "WIN"]
        losses  = [p for p in picks if p.get("result") == "LOSS"]
        pending = [p for p in picks if not p.get("result")]

        def build_section(pick: dict) -> str:
            box = _fuzzy_box_lookup(pick["player_name"], box_players)
            pbp = pbp_by_player[pick["player_name"]]
            return _pick_section(pick, pbp, box)

        report: list[str] = [
            f"## {game_label}",
            f"**Final:** {away_abbr} {game['away_score']} – {home_abbr} {game['home_score']} ({home_name} home)",
            f"**Quarter breakdown:** {q_str}",
            f"**Game script:** {script}",
            "",
        ]
        for section_label, section_picks in [("✓ Wins", wins), ("✗ Losses", losses), ("○ Pending", pending)]:
            if section_picks:
                report.append(f"### {section_label} ({len(section_picks)})")
                report.append("")
                for p in section_picks:
                    report.append(build_section(p))
                    report.append("")
        report_text = "\n".join(report)

    return {
        "report":      report_text,
        "game_id":     game_id,
        "home_team":   home_name,
        "away_team":   away_name,
        "final_score": f"{home_abbr} {game['home_score']} – {away_abbr} {game['away_score']}",
    }
