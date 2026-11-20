"""
Checks that app/services/bet_grader.py grades exactly like web/src/lib/betEvaluator.ts.

    cd backend && .venv/bin/python -m scripts.check_grader edges.json

edges.json is a saved /api/games/tonight-edges response. Runs both graders on it and lists
every bet where grade, contract, side, price, probability, edge, warning count or Top Pick
status differ.
"""
import json
import subprocess
import sys
from pathlib import Path

from app.services.bet_grader import evaluate_bets, is_top_pick

path = sys.argv[1]
web = Path(__file__).resolve().parents[2] / "web"
ts = json.loads(subprocess.run(["npx", "tsx", str(Path(__file__).with_suffix(".ts")), path],
                               cwd=web, capture_output=True, text=True, check=True).stdout)

py = {}
for g in json.load(open(path))["games"]:
    for p in g["players"]:
        for b in evaluate_bets(p["quotes"], p["prediction"]):
            py[f"{p['id']}|{b['prop']}"] = {
                "grade": b["grade"], "ticker": b["ticker"], "side": b["side"], "price": b["price"],
                "prob": b["prob"], "edge": b["edge"], "warnings": len(b["warnings"]),
                "top": is_top_pick(p.get("season_games") or [], b),
            }

diffs = []
for key in sorted(set(ts) | set(py)):
    a, b = ts.get(key), py.get(key)
    if a is None or b is None:
        diffs.append(f"{key}: only in {'python' if a is None else 'client'}")
        continue
    for field in a:
        x, y = a[field], b[field]
        same = abs(x - y) < 1e-9 if isinstance(x, float) or isinstance(y, float) else x == y
        if not same:
            diffs.append(f"{key} {field}: client {x} vs python {y}")

print(f"{len(ts)} bets compared, {len(diffs)} differences")
for d in diffs[:30]:
    print("  " + d)
