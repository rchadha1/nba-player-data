import type { GamePrediction } from "@/api/client";

export type BetGrade = "STRONG" | "LEAN" | "SKIP";
export type BetDirection = "over" | "under";

export interface BetEvaluation {
  prop: string;
  direction: BetDirection;
  expected: number;
  line: number;
  edge: number;       // 0–1, e.g. 0.15 = 15%
  grade: BetGrade;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  variance_flag: boolean;   // true = high std dev on an under bet
  std_dev: number | null;
}

const COMBO_MAP: Record<string, string[]> = {
  "PTS+REB+AST": ["PTS", "REB", "AST"],
  "PTS+REB":     ["PTS", "REB"],
  "PTS+AST":     ["PTS", "AST"],
  "AST+REB":     ["AST", "REB"],
};

const LEAN_THRESHOLD      = 0.12;
const STRONG_THRESHOLD    = 0.20;
// Under bets where std_dev / expected exceeds this get downgraded one tier
const HIGH_VARIANCE_RATIO = 0.25;

function getExpected(prop: string, prediction: GamePrediction): number | null {
  if (prediction.props[prop] != null) return prediction.props[prop].expected;
  const parts = COMBO_MAP[prop];
  if (!parts) return null;
  const vals = parts.map((p) => prediction.props[p]?.expected);
  if (vals.some((v) => v == null)) return null;
  return Math.round((vals.reduce((a, b) => a! + b!, 0)!) * 10) / 10;
}

function getStdDev(prop: string, prediction: GamePrediction): number | null {
  // For individual props, use directly
  if (prediction.props[prop]?.std_dev != null) return prediction.props[prop].std_dev;
  // For combos, sum component std devs (conservative — assumes positive correlation)
  const parts = COMBO_MAP[prop];
  if (!parts) return null;
  const devs = parts.map((p) => prediction.props[p]?.std_dev ?? null);
  if (devs.some((d) => d == null)) return null;
  return Math.round((devs.reduce((a, b) => a! + b!, 0)!) * 10) / 10;
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
  varianceFlag: boolean,
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

  const nOpp = prediction.sample_sizes.vs_opponent;
  if (nSeries < 2 && nOpp < 3) {
    warnings.push("Thin opponent history — prediction less reliable");
  }

  if (varianceFlag) {
    warnings.push("High game-to-game variance — under bet has significant blowup risk");
  }

  return warnings;
}

export function evaluateBets(
  ppLines: Record<string, number>,
  prediction: GamePrediction,
): BetEvaluation[] {
  const nSeries    = prediction.sample_sizes.series;
  const nOpp       = prediction.sample_sizes.vs_opponent;
  const hasHistory = nSeries >= 2 || nOpp >= 3;
  const results: BetEvaluation[] = [];

  for (const [prop, line] of Object.entries(ppLines)) {
    const expected = getExpected(prop, prediction);
    if (expected == null || line <= 0) continue;

    const direction: BetDirection = expected > line ? "over" : "under";
    const edge       = Math.abs(expected - line) / line;
    const confidence = getConfidence(prop, prediction);
    const std_dev    = getStdDev(prop, prediction);

    // High variance flag: under bets where the std dev is >25% of expected value
    // means the player has a meaningful chance of blowing past the line even if
    // the expected value sits below it
    const variance_flag = direction === "under"
      && std_dev != null
      && expected > 0
      && (std_dev / expected) > HIGH_VARIANCE_RATIO;

    const warnings = getWarnings(prop, direction, prediction, variance_flag);

    let grade: BetGrade;
    if (edge >= STRONG_THRESHOLD && confidence !== "low" && hasHistory && warnings.length === 0) {
      grade = "STRONG";
    } else if (edge >= STRONG_THRESHOLD && confidence !== "low" && hasHistory) {
      grade = "LEAN";
    } else if (edge >= LEAN_THRESHOLD && confidence !== "low" && hasHistory && !variance_flag) {
      grade = "LEAN";
    } else {
      grade = "SKIP";
    }

    results.push({ prop, direction, expected, line, edge, grade, confidence, warnings, variance_flag, std_dev });
  }

  const order: Record<BetGrade, number> = { STRONG: 0, LEAN: 1, SKIP: 2 };
  return results.sort((a, b) =>
    order[a.grade] !== order[b.grade]
      ? order[a.grade] - order[b.grade]
      : b.edge - a.edge,
  );
}
