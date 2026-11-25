import type { GamePrediction, KalshiQuote, SeasonGame } from "@/api/client";

export type BetGrade = "STRONG" | "SOLID" | "LEAN" | "SKIP";
export type BetDirection = "over" | "under";

export interface BetEvaluation {
  prop: string;
  direction: BetDirection;  // over = buy YES, under = buy NO
  expected: number;
  line: number;             // the contract's strike
  side: "YES" | "NO";
  price: number;            // what one contract costs, in dollars
  prob: number;             // model's chance this side wins
  edge: number;             // expected profit per $1 contract after Kalshi's fee
  grade: BetGrade;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  std_dev: number | null;
  ticker: string;           // Kalshi contract ticker
}

/** kalshi.com page for the bet's game and stat, with the order panel pre-filled for this
 * contract and side (Kalshi's own op_* parameters, copied from its order URLs). */
export function kalshiOrderUrl(pageUrl: string, bet: BetEvaluation): string {
  return `${pageUrl}?op_market_ticker=${bet.ticker}&op_order_side=${bet.side.toLowerCase()}&op_side=BUY&op_order_type=dollars`;
}

const COMBO_MAP: Record<string, string[]> = {
  "PTS+REB+AST": ["PTS", "REB", "AST"],
  "PTS+REB":     ["PTS", "REB"],
  "PTS+AST":     ["PTS", "AST"],
  "AST+REB":     ["AST", "REB"],
};

// Calibration backtest 2026-11-18 (18k game × strike pairs): the last-15-game spread is
// ~15% too narrow, and a Poisson curve fits low-count stats better than a normal one.
const SPREAD_INFLATE = 1.15;
const POISSON_PROPS  = new Set(["3PT", "STL", "BLK"]);
// Expected profit per $1 contract. Judgment calls until the money backtest on recorded
// pregame quotes (kalshi_quotes) can set them.
const EV_STRONG = 0.10;
const EV_SOLID  = 0.06;
const EV_LEAN   = 0.04;
// Model vs market chance gap that usually means news the model can't see (injury, lineup).
// Only judged on quotes tight enough for the market's mid to mean something. Conservative
// until the money backtest shows whether big disagreements win or lose.
const MARKET_GAP       = 0.12;
const TIGHT_SPREAD     = 0.10;
// kalshi.com shows no NO button on rows where NO is this cheap (checked by hand 2026-11-19:
// hidden at 26¢ and below, shown at 28¢ and above), so those contracts can't be bought there.
const MIN_NO_PRICE     = 0.27;
// Season record this far below the model's chance is flagged (shown on SOLID/STRONG only)
const RECORD_GAP       = 0.10;

/** How often this bet's side would have won in the player's games this season (YES: over
 * the strike; NO: at or under it), and whether that's well below the model's chance. */
export function seasonRecord(games: SeasonGame[], bet: BetEvaluation): { hits: number; n: number; low: boolean } {
  const parts = COMBO_MAP[bet.prop] ?? [bet.prop];
  const hits = games.filter((g) => {
    const v = parts.reduce((sum, k) => sum + (g[k] ?? 0), 0);
    return bet.side === "YES" ? v > bet.line : v <= bet.line;
  }).length;
  return { hits, n: games.length, low: games.length > 0 && bet.prob - hits / games.length > RECORD_GAP };
}

// Top Picks: SOLID/STRONG bets whose season record beats the price by at least this much,
// i.e. both the model and the player's own history say the market is too low
export const TOP_PICK_GAP = 0.10;

/** Season record minus price (e.g. 0.83 − 0.57 = 0.26), or null if the bet isn't a Top Pick. */
export function topPickGap(games: SeasonGame[], bet: BetEvaluation): number | null {
  if (bet.grade !== "SOLID" && bet.grade !== "STRONG") return null;
  const r = seasonRecord(games, bet);
  if (!r.n) return null;
  const gap = r.hits / r.n - bet.price;
  return gap >= TOP_PICK_GAP ? gap : null;
}

function getExpected(prop: string, prediction: GamePrediction): number | null {
  if (prediction.props[prop] != null) return prediction.props[prop].expected;
  const parts = COMBO_MAP[prop];
  if (!parts) return null;
  const vals = parts.map((p) => prediction.props[p]?.expected);
  if (vals.some((v) => v == null)) return null;
  return Math.round((vals.reduce((a, b) => a! + b!, 0)!) * 10) / 10;
}

function getStdDev(prop: string, prediction: GamePrediction): number | null {
  return prediction.props[prop]?.std_dev ?? prediction.combo_std_dev?.[prop] ?? null;
}

// Complementary error function (Abramowitz & Stegun 7.1.26, error < 1.5e-7)
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

/** Model's P(stat > strike), or null if the prediction lacks what's needed. */
function probOver(prop: string, strike: number, prediction: GamePrediction): number | null {
  const mu = getExpected(prop, prediction);
  if (mu == null) return null;
  if (POISSON_PROPS.has(prop)) {
    let term = Math.exp(-mu), cdf = term;
    for (let i = 1; i <= Math.floor(strike); i++) { term *= mu / i; cdf += term; }
    return 1 - cdf;
  }
  const sd = getStdDev(prop, prediction);
  if (sd == null) return null;
  return 0.5 * erfc((strike - mu) / (Math.max(0.5, sd) * SPREAD_INFLATE * Math.SQRT2));
}

// Kalshi's taker fee: 7% × price × (1 − price), rounded up to the cent
function kalshiFee(price: number): number {
  return Math.ceil(0.07 * price * (1 - price) * 100 - 1e-9) / 100;
}

/** What a `stake`-dollar order pays back if it wins, as Kalshi's order panel shows it: the
 * fee is charged once per order (rounded up to the cent) and comes out of the stake. */
export function kalshiPayout(stake: number, price: number): number {
  const fee = Math.ceil(0.07 * (stake / price) * price * (1 - price) * 100 - 1e-9) / 100;
  return (stake - fee) / price;
}

/** Highest price at which a bet the model gives `prob` still grades at least LEAN — the
 * "still worth it" floor, which doesn't move when the market does. */
export function maxWorthItPrice(prob: number): number | null {
  for (let cents = 99; cents >= 1; cents--) {
    const p = cents / 100;
    if (prob - p - kalshiFee(p) >= EV_LEAN) return p;
  }
  return null;
}

function getConfidence(prop: string, prediction: GamePrediction): "high" | "medium" | "low" {
  const parts = COMBO_MAP[prop] ?? [prop];
  const confs = parts.map((p) => prediction.props[p]?.confidence ?? "low");
  if (confs.every((c) => c === "high")) return "high";
  if (confs.some((c) => c === "low")) return "low";
  return "medium";
}

function getWarnings(
  prop: string,
  direction: BetDirection,
  prediction: GamePrediction,
): string[] {
  const warnings: string[] = [];
  const rp = prediction.role_pattern;
  const involvesPts = prop === "PTS" || prop.includes("PTS");
  const involvesAst = prop === "AST" || prop.includes("AST");
  const nSeries = prediction.sample_sizes.series;

  if (involvesAst && direction === "over" && (rp?.indices?.length ?? 0) > 0) {
    if (rp.indices[0] < 0.25) {
      warnings.push("Low AST-rate in series — assists over is a role mismatch");
    }
  }

  if (involvesPts && direction === "over" && rp?.last_role === "facilitator" && nSeries >= 2) {
    warnings.push("Facilitator mode last game — scoring may be suppressed");
  }
  if (involvesAst && direction === "over" && rp?.last_role === "scorer" && nSeries >= 2) {
    warnings.push("Scorer mode last game — assists likely down");
  }

  if (prediction.foul_trouble?.warning && direction === "over") {
    warnings.push(`Foul trouble (${prediction.foul_trouble.avg_fouls}/game avg) reduces counting stats`);
  }

  const involvesReb = prop === "REB" || prop.includes("REB");
  const involvesBlk = prop === "BLK";
  const paintCause = prediction.shot_zones?.paint_cause?.cause;
  const paintAdjApplied = paintCause !== "player_execution" && paintCause !== "normal_variance";
  if ((involvesPts || involvesReb || involvesBlk) && direction === "over" && prediction.shot_zones?.paint_drift_warning && paintAdjApplied) {
    const drift = prediction.shot_zones.drift?.paint ?? 0;
    const statLabel = involvesBlk ? "BLK" : involvesReb ? "REB" : "PTS";
    warnings.push(`Paint access down ${Math.round(Math.abs(drift) * 100)}pp in series — ${statLabel} ceiling compressed`);
  }

  if (prediction.props[prop]?.wo_direction_warning) {
    warnings.push("Without-teammate sample shows lower averages — check game context");
  }

  // Regular season: thin opponent history is the norm, not a red flag (it would block
  // every STRONG/SOLID grade); the season-sample bar in evaluateBets covers reliability.
  const nOpp = prediction.sample_sizes.vs_opponent;
  if (prediction.phase === "playoffs" && nSeries < 2 && nOpp < 3) {
    warnings.push("Thin opponent history — prediction less reliable");
  }

  if (prediction.minutes_flag?.minutes_declining) {
    warnings.push("Minutes declining each postseason game — role may be shrinking");
  }

  if (prediction.minutes_flag?.restriction_scale != null) {
    warnings.push(prediction.phase === "playoffs"
      ? "Role compression in this series — recent minutes below series baseline (prediction scaled down)"
      : "Role compression — last 3 games' minutes well below season average (prediction scaled down)");
  }

  for (const a of prediction.key_absences ?? []) {
    warnings.push(`${a.name} (starter, ${Math.round(a.usage)}% usage) is out — ${a.games_without} game${a.games_without === 1 ? "" : "s"} this season without him; role likely changes`);
  }

  const status = prediction.injury_status ?? "Active";
  if (status && status !== "Active") {
    warnings.push(`⚠️ Player listed as ${status} — limited minutes or DNP risk`);
  }

  const ptsSznAvg = prediction.props["PTS"]?.season_avg ?? 0;
  const isStar = ptsSznAvg >= 18;
  if (direction === "under" && isStar && prediction.blowout_risk?.team_trailing) {
    const record = prediction.blowout_risk.series_record ?? "";
    warnings.push(`⚠️ Star player (${ptsSznAvg} PPG) facing elimination (down ${record}) — stars frequently elevate in must-win games`);
  }

  if (direction === "over" && !isStar && prediction.blowout_risk?.warning) {
    const record = prediction.blowout_risk.series_record ?? "";
    warnings.push(`⚠️ Blowout-series risk (${record}) — role player minutes frequently compressed when games get lopsided`);
  }

  return warnings;
}

/**
 * Grades Kalshi contracts on the price you'd actually pay: for each strike, compare the
 * model's chance with the YES ask (over) or the NO price, 1 − YES bid (under), after
 * Kalshi's fee. Returns the best contract per prop. Game-to-game variance is already in
 * the probability, so there's no separate variance gate.
 */
export function evaluateBets(
  quotes: Record<string, KalshiQuote[]>,
  prediction: GamePrediction,
  modelWeight = 1,  // < 1 pulls each contract's chance toward Kalshi's mid (see modelChoice.ts)
): BetEvaluation[] {
  const nSeries    = prediction.sample_sizes.series;
  const nOpp       = prediction.sample_sizes.vs_opponent;
  // Regular season has no series, so require a solid current-season sample instead
  const hasHistory = prediction.phase === "regular"
    ? prediction.sample_sizes.season >= 10
    : nSeries >= 2 || nOpp >= 3;
  const results: BetEvaluation[] = [];

  for (const [prop, ladder] of Object.entries(quotes)) {
    const expected = getExpected(prop, prediction);
    if (expected == null) continue;

    let best: { direction: BetDirection; side: "YES" | "NO"; strike: number; price: number; prob: number; edge: number; quote: KalshiQuote } | null = null;
    for (const q of ladder) {
      const pModel = probOver(prop, q.strike, prediction);
      if (pModel == null) continue;
      const mid = q.yes_bid > 0 ? (q.yes_bid + q.yes_ask) / 2 : q.yes_ask;
      const pOver = modelWeight * pModel + (1 - modelWeight) * mid;
      const sides = [
        { direction: "over" as const,  side: "YES" as const, price: q.yes_ask,     prob: pOver,     ok: q.yes_ask > 0 && q.yes_ask < 1 },
        { direction: "under" as const, side: "NO" as const,  price: 1 - q.yes_bid, prob: 1 - pOver, ok: q.yes_bid > 0 && 1 - q.yes_bid >= MIN_NO_PRICE },
      ];
      for (const s of sides) {
        if (!s.ok) continue;
        const edge = s.prob - s.price - kalshiFee(s.price);
        if (!best || edge > best.edge) best = { ...s, strike: q.strike, edge, quote: q };
      }
    }
    if (!best) continue;

    const confidence = getConfidence(prop, prediction);
    const warnings   = getWarnings(prop, best.direction, prediction);
    const { yes_bid, yes_ask } = best.quote;
    if (yes_bid > 0 && yes_ask - yes_bid <= TIGHT_SPREAD) {
      const marketProb = best.side === "YES" ? (yes_bid + yes_ask) / 2 : 1 - (yes_bid + yes_ask) / 2;
      if (best.prob - marketProb > MARKET_GAP) {
        warnings.push(`Market disagrees sharply (model ${Math.round(best.prob * 100)}% vs market ${Math.round(marketProb * 100)}%) — likely injury or lineup news the model can't see`);
      }
    }

    let grade: BetGrade;
    // STRONG/SOLID require high confidence — playoffs: n_series ≥ 3; regular season: 10+ games
    // this season — plus no warnings. LEAN tolerates warnings and medium confidence.
    if (best.edge >= EV_STRONG && confidence === "high" && hasHistory && warnings.length === 0) {
      grade = "STRONG";
    } else if (best.edge >= EV_SOLID && confidence === "high" && hasHistory && warnings.length === 0) {
      grade = "SOLID";
    } else if (best.edge >= EV_LEAN && confidence !== "low" && hasHistory) {
      grade = "LEAN";
    } else {
      grade = "SKIP";
    }

    // G1 role-player cap: non-stars have unpredictable minutes/usage in the first playoff
    // game vs a new opponent. Stars (season PTS avg ≥ 18) play guaranteed minutes regardless.
    if (grade === "STRONG" && prediction.phase === "playoffs" && nSeries === 0) {
      const ptsSznAvg = prediction.props["PTS"]?.season_avg ?? 0;
      if (ptsSznAvg < 18) {
        grade = "SOLID";
        warnings.push("Downgraded from STRONG — G1 of new series, role player minutes unpredictable");
      }
    }

    results.push({
      prop, direction: best.direction, expected, line: best.strike, side: best.side, price: best.price,
      prob: best.prob, edge: best.edge, grade, confidence, warnings, std_dev: getStdDev(prop, prediction),
      ticker: best.quote.ticker,
    });
  }

  const order: Record<BetGrade, number> = { STRONG: 0, SOLID: 1, LEAN: 2, SKIP: 3 };
  return results.sort((a, b) =>
    order[a.grade] !== order[b.grade]
      ? order[a.grade] - order[b.grade]
      : b.edge - a.edge,
  );
}
