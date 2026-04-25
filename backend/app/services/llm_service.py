"""
Thin wrapper around the Anthropic SDK.
All LLM calls go through here so the API key and model are managed in one place.
"""
from typing import Optional
from app.core.config import settings

MODEL = "claude-sonnet-4-6"


def _client():
    import anthropic
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set in .env")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def call(prompt: str, system: str = "", max_tokens: int = 1500) -> str:
    """Single user-turn call. Returns the text response."""
    client = _client()
    messages = [{"role": "user", "content": prompt}]
    kwargs = dict(model=MODEL, max_tokens=max_tokens, messages=messages)
    if system:
        kwargs["system"] = system
    response = client.messages.create(**kwargs)
    return response.content[0].text


def game_analysis_report(
    game_label: str,
    final_score: str,
    quarter_breakdown: str,
    game_script: str,
    picks: list[dict],
    box_scores: dict,       # {player_name_lower: {name, team, stats}}
    pbp_by_player: dict,    # {player_name: parsed_pbp_dict}
) -> str:
    """
    Sends game data to Claude and returns a markdown analysis report
    explaining why each pick won or lost.
    """
    system = (
        "You are a sharp NBA betting analyst. You explain bet outcomes clearly and honestly, "
        "using specific game data. You don't pad with generic basketball commentary. "
        "Every claim you make is grounded in the numbers provided."
    )

    # Format picks
    picks_block = ""
    for p in picks:
        result_str = p.get("result") or "pending"
        actual = p.get("actual_value")
        actual_str = f" → actual: {actual}" if actual is not None else ""
        ltype = p.get("line_type", "standard")
        tag = f" [{ltype.upper()}]" if ltype != "standard" else ""
        picks_block += (
            f"- {p['player_name']} | {p['prop']} {p['pick']} {p['line']}{tag}"
            f"{actual_str} | {result_str.upper()}\n"
        )

    # Format box scores for picked players
    box_block = ""
    for p in picks:
        key = p["player_name"].lower()
        # fuzzy match
        box = box_scores.get(key)
        if not box:
            for k, v in box_scores.items():
                if p["player_name"].split()[-1].lower() in k:
                    box = v
                    break
        if box:
            s = box["stats"]
            box_block += (
                f"{box['name']} ({box['team']}, {box.get('home_away','')}):\n"
                f"  {s.get('PTS','—')} PTS | {s.get('REB','—')} REB | {s.get('AST','—')} AST | "
                f"{s.get('MIN','—')} min | FG {s.get('FG','—')} | 3PT {s.get('3PT','—')} | "
                f"FT {s.get('FT','—')} | TO {s.get('TO','—')} | PF {s.get('PF','—')} | "
                f"+/- {s.get('+/-','—')}\n"
            )

    # Format PBP highlights for each picked player
    pbp_block = ""
    for p in picks:
        name = p["player_name"]
        pbp = pbp_by_player.get(name)
        if not pbp:
            continue
        pts_by_q = pbp.get("pts_by_q", {})
        q_scoring = " | ".join(
            f"Q{q}: {pts_by_q.get(q, 0)} pts"
            for q in (1, 2, 3, 4)
            if pts_by_q.get(q, 0) > 0
        )
        fouls = sum(len(v) for v in pbp.get("fouls_by_q", {}).values())
        q1_fouls = len(pbp.get("fouls_by_q", {}).get(1, []))
        tos = sum(len(v) for v in pbp.get("turnovers_by_q", {}).values())
        three_line = f"{pbp.get('three_makes',0)}-{pbp.get('three_attempts',0)} from three"
        ft_line = f"{pbp.get('ft_makes',0)}/{pbp.get('ft_attempts',0)} FT"

        pbp_block += (
            f"{name}:\n"
            f"  Scoring by quarter: {q_scoring or 'n/a'}\n"
            f"  3PT: {three_line} | FT: {ft_line}\n"
            f"  Fouls: {fouls} total (Q1: {q1_fouls}) | Turnovers: {tos}\n"
        )

    prompt = f"""Analyze the following completed NBA game and explain why each bet won or lost.

## {game_label}
Final: {final_score}
Quarter breakdown: {quarter_breakdown}
Game script: {game_script}

## Picks
{picks_block.strip()}

## Box Scores
{box_block.strip() or "Not available"}

## Play-by-Play Highlights
{pbp_block.strip() or "Not available"}

---

Write a markdown report with these sections:
1. A brief 1-2 sentence game summary
2. For each pick (wins first, then losses): bold header with result, then 2-4 bullet points explaining specifically why using the data above
3. A "Patterns" section at the end noting any recurring themes across the picks (e.g. foul trouble, blowout, hot shooting)

Be direct and specific. Reference actual numbers. Don't write generic basketball commentary."""

    return call(prompt, system=system, max_tokens=2000)


def situational_reasoning(
    player_name: str,
    opponent: str,
    is_home: Optional[bool],
    series_context: str,
    props: dict,             # {prop: {expected, confidence, season_avg, vs_opponent_avg, ...}}
    risk_flags: dict,
) -> str:
    """
    Given formula output + series context provided by the user, returns
    Claude's situational read on which props to trust and which to fade.
    """
    system = (
        "You are a sharp NBA prop bettor. You receive a statistical model's projections "
        "and add situational context the model can't capture. You're honest about uncertainty "
        "and never oversell a pick. Keep it concise — bettors want signal, not noise."
    )

    location = "Home" if is_home is True else ("Road" if is_home is False else "Unknown location")

    props_block = ""
    for prop, data in props.items():
        exp = data.get("expected", "?")
        conf = data.get("confidence", "?")
        s_avg = data.get("season_avg", "?")
        opp_avg = data.get("vs_opponent_avg", "?")
        props_block += (
            f"  {prop}: projected {exp} (confidence: {conf}) | "
            f"season avg {s_avg} | vs {opponent} avg {opp_avg}\n"
        )

    flags_block = ""
    if risk_flags:
        pf36 = risk_flags.get("pf_per_36")
        if pf36 and pf36 >= 4.0:
            flags_block += f"  - High foul rate ({pf36} PF/36) — REB/BLK props carry risk\n"
        if risk_flags.get("rotation_instability"):
            flags_block += "  - Inconsistent minutes (high std dev) — counting stats volatile\n"
        penalty = risk_flags.get("spread_blowout_penalty")
        if penalty:
            flags_block += f"  - Blowout road underdog penalty applied ({penalty}x)\n"

    prompt = f"""A statistical model has produced the following prop projections. Add your situational read.

Player: {player_name}
Opponent: {opponent}
Location: {location}
Series context: {series_context or "none provided"}

Formula projections:
{props_block.strip()}

Risk flags from the model:
{flags_block.strip() or "  None"}

---

In 3-5 sentences, tell the bettor:
1. Which props look most trustworthy given the series context (and why)
2. Any props you'd fade or treat with caution despite the formula number
3. One specific thing about this game situation the formula can't account for

Don't repeat the numbers back. Add the layer of reasoning the model is missing."""

    return call(prompt, system=system, max_tokens=600)
