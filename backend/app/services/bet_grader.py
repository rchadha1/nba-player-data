"""
Server-side copy of web/src/lib/betEvaluator.ts, so the pick log can record exactly the
grades the app shows. Keep the two in sync: any change to a rule or constant there must be
made here too (scripts/check_grader.py compares them on real data).
"""
import math
from typing import Optional

COMBO_MAP = {
    "PTS+REB+AST": ["PTS", "REB", "AST"],
    "PTS+REB":     ["PTS", "REB"],
    "PTS+AST":     ["PTS", "AST"],
    "AST+REB":     ["AST", "REB"],
}

SPREAD_INFLATE = 1.15
POISSON_PROPS  = {"3PT", "STL", "BLK"}
EV_STRONG      = 0.10
EV_SOLID       = 0.06
EV_LEAN        = 0.04
MARKET_GAP     = 0.12
TIGHT_SPREAD   = 0.10
MIN_NO_PRICE   = 0.27
TOP_PICK_GAP   = 0.10

_GRADE_ORDER = {"STRONG": 0, "SOLID": 1, "LEAN": 2, "SKIP": 3}


def _js_round(x: float) -> int:
    """Math.round: halves round up (Python's round() rounds halves to even)."""
    return math.floor(x + 0.5)


def _prop(prediction: dict, prop: str) -> Optional[dict]:
    return (prediction.get("props") or {}).get(prop)


def _expected(prop: str, prediction: dict) -> Optional[float]:
    p = _prop(prediction, prop)
    if p is not None:
        return p["expected"]
    parts = COMBO_MAP.get(prop)
    if not parts:
        return None
    vals = [(_prop(prediction, x) or {}).get("expected") for x in parts]
    if any(v is None for v in vals):
        return None
    return _js_round(sum(vals) * 10) / 10


def _std_dev(prop: str, prediction: dict) -> Optional[float]:
    p = _prop(prediction, prop)
    if p is not None and p.get("std_dev") is not None:
        return p["std_dev"]
    return (prediction.get("combo_std_dev") or {}).get(prop)


def _erfc(x: float) -> float:
    # Abramowitz & Stegun 7.1.26 — same approximation as the client, so results match exactly
    z = abs(x)
    t = 1 / (1 + 0.3275911 * z)
    y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * math.exp(-z * z)
    return y if x >= 0 else 2 - y


def _prob_over(prop: str, strike: float, prediction: dict) -> Optional[float]:
    mu = _expected(prop, prediction)
    if mu is None:
        return None
    if prop in POISSON_PROPS:
        term = math.exp(-mu)
        cdf = term
        for i in range(1, math.floor(strike) + 1):
            term *= mu / i
            cdf += term
        return 1 - cdf
    sd = _std_dev(prop, prediction)
    if sd is None:
        return None
    return 0.5 * _erfc((strike - mu) / (max(0.5, sd) * SPREAD_INFLATE * math.sqrt(2)))


def _fee(price: float) -> float:
    return math.ceil(0.07 * price * (1 - price) * 100 - 1e-9) / 100


def _confidence(prop: str, prediction: dict) -> str:
    confs = [(_prop(prediction, p) or {}).get("confidence", "low") for p in COMBO_MAP.get(prop, [prop])]
    if all(c == "high" for c in confs):
        return "high"
    if any(c == "low" for c in confs):
        return "low"
    return "medium"


def _warnings(prop: str, direction: str, prediction: dict) -> list[str]:
    w: list[str] = []
    rp = prediction.get("role_pattern") or {}
    involves_pts = "PTS" in prop
    involves_ast = "AST" in prop
    involves_reb = "REB" in prop
    involves_blk = prop == "BLK"
    sizes = prediction.get("sample_sizes") or {}
    n_series = sizes.get("series") or 0

    if involves_ast and direction == "over" and rp.get("indices") and rp["indices"][0] < 0.25:
        w.append("Low AST-rate in series — assists over is a role mismatch")
    if involves_pts and direction == "over" and rp.get("last_role") == "facilitator" and n_series >= 2:
        w.append("Facilitator mode last game — scoring may be suppressed")
    if involves_ast and direction == "over" and rp.get("last_role") == "scorer" and n_series >= 2:
        w.append("Scorer mode last game — assists likely down")

    foul = prediction.get("foul_trouble") or {}
    if foul.get("warning") and direction == "over":
        w.append(f"Foul trouble ({foul.get('avg_fouls')}/game avg) reduces counting stats")

    zones = prediction.get("shot_zones") or {}
    paint_cause = (zones.get("paint_cause") or {}).get("cause")
    if ((involves_pts or involves_reb or involves_blk) and direction == "over" and zones.get("paint_drift_warning")
            and paint_cause not in ("player_execution", "normal_variance")):
        w.append("Paint access down in series — ceiling compressed")

    if (_prop(prediction, prop) or {}).get("wo_direction_warning"):
        w.append("Without-teammate sample shows lower averages — check game context")

    if prediction.get("phase") == "playoffs" and n_series < 2 and (sizes.get("vs_opponent") or 0) < 3:
        w.append("Thin opponent history — prediction less reliable")

    mins = prediction.get("minutes_flag") or {}
    if mins.get("minutes_declining"):
        w.append("Minutes declining each postseason game — role may be shrinking")
    if mins.get("restriction_scale") is not None:
        w.append("Role compression — recent minutes well below baseline (prediction scaled down)")

    for a in prediction.get("key_absences") or []:
        w.append(f"{a['name']} (starter, {_js_round(a['usage'])}% usage) is out")

    status = prediction.get("injury_status") or "Active"
    if status != "Active":
        w.append(f"Player listed as {status} — limited minutes or DNP risk")

    pts_avg = (_prop(prediction, "PTS") or {}).get("season_avg") or 0
    is_star = pts_avg >= 18
    blowout = prediction.get("blowout_risk") or {}
    if direction == "under" and is_star and blowout.get("team_trailing"):
        w.append("Star player facing elimination — stars frequently elevate in must-win games")
    if direction == "over" and not is_star and blowout.get("warning"):
        w.append("Blowout-series risk — role player minutes frequently compressed")
    return w


def evaluate_bets(quotes: dict[str, list[dict]], prediction: dict) -> list[dict]:
    """Best contract per prop with its grade — same rules and order as evaluateBets()."""
    sizes = prediction.get("sample_sizes") or {}
    n_series = sizes.get("series") or 0
    n_opp = sizes.get("vs_opponent") or 0
    has_history = (sizes.get("season") or 0) >= 10 if prediction.get("phase") == "regular" else (n_series >= 2 or n_opp >= 3)
    results = []

    for prop, ladder in quotes.items():
        expected = _expected(prop, prediction)
        if expected is None:
            continue
        best = None
        for q in ladder:
            p_over = _prob_over(prop, q["strike"], prediction)
            if p_over is None:
                continue
            sides = [
                ("over", "YES", q["yes_ask"], p_over, 0 < q["yes_ask"] < 1),
                ("under", "NO", 1 - q["yes_bid"], 1 - p_over, q["yes_bid"] > 0 and 1 - q["yes_bid"] >= MIN_NO_PRICE),
            ]
            for direction, side, price, prob, ok in sides:
                if not ok:
                    continue
                edge = prob - price - _fee(price)
                if best is None or edge > best["edge"]:
                    best = {"direction": direction, "side": side, "price": price, "prob": prob, "edge": edge,
                            "strike": q["strike"], "quote": q}
        if best is None:
            continue

        confidence = _confidence(prop, prediction)
        warnings = _warnings(prop, best["direction"], prediction)
        bid, ask = best["quote"]["yes_bid"], best["quote"]["yes_ask"]
        if bid > 0 and ask - bid <= TIGHT_SPREAD:
            market_prob = (bid + ask) / 2 if best["side"] == "YES" else 1 - (bid + ask) / 2
            if best["prob"] - market_prob > MARKET_GAP:
                warnings.append(f"Market disagrees sharply (model {_js_round(best['prob'] * 100)}% vs market {_js_round(market_prob * 100)}%)")

        clean = confidence == "high" and has_history and not warnings
        if best["edge"] >= EV_STRONG and clean:
            grade = "STRONG"
        elif best["edge"] >= EV_SOLID and clean:
            grade = "SOLID"
        elif best["edge"] >= EV_LEAN and confidence != "low" and has_history:
            grade = "LEAN"
        else:
            grade = "SKIP"
        if grade == "STRONG" and prediction.get("phase") == "playoffs" and n_series == 0 \
                and ((_prop(prediction, "PTS") or {}).get("season_avg") or 0) < 18:
            grade = "SOLID"
            warnings.append("Downgraded from STRONG — G1 of new series")

        results.append({
            "prop": prop, "direction": best["direction"], "expected": expected, "line": best["strike"],
            "side": best["side"], "price": best["price"], "prob": best["prob"], "edge": best["edge"],
            "grade": grade, "confidence": confidence, "warnings": warnings, "ticker": best["quote"].get("ticker"),
        })

    results.sort(key=lambda r: (_GRADE_ORDER[r["grade"]], -r["edge"]))
    return results


def season_record(games: list[dict], bet: dict) -> tuple[int, int]:
    """(games this bet's side would have won this season, games played)."""
    parts = COMBO_MAP.get(bet["prop"], [bet["prop"]])
    hits = 0
    for g in games:
        v = sum(g.get(k) or 0 for k in parts)
        hits += (v > bet["line"]) if bet["side"] == "YES" else (v <= bet["line"])
    return hits, len(games)


def is_top_pick(games: list[dict], bet: dict) -> bool:
    if bet["grade"] not in ("SOLID", "STRONG"):
        return False
    hits, n = season_record(games, bet)
    return n > 0 and hits / n - bet["price"] >= TOP_PICK_GAP
