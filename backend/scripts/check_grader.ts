// Prints the client grader's output for a saved /tonight-edges response, for check_grader.py.
import { readFileSync } from "fs";
import { evaluateBets, topPickGap } from "../../web/src/lib/betEvaluator.ts";

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out: Record<string, unknown> = {};
for (const g of data.games) for (const p of g.players) for (const b of evaluateBets(p.quotes, p.prediction)) {
  out[`${p.id}|${b.prop}`] = {
    grade: b.grade, ticker: b.ticker, side: b.side, price: b.price, prob: b.prob, edge: b.edge,
    warnings: b.warnings.length, top: topPickGap(p.season_games ?? [], b) != null,
  };
}
console.log(JSON.stringify(out));
