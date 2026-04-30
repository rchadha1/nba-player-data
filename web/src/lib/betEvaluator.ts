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
  variance_flag: boolean;   // true = high std dev relative to expected; blocks LEAN/STRONG
  std_dev: number | null;
}

const COMBO_MAP: Record<string, string[]> = {
  "PTS+REB+AST": ["PTS", "REB", "AST"],
  "PTS+REB":     ["PTS", "REB"],
  "PTS+AST":     ["PTS", "AST"],
  "AST+REB":     ["AST", "REB"],
};

const LEAN_THRESHOLD           = 0.12;
const STRONG_THRESHOLD         = 0.20;
// UNDER: std_dev/expected > 0.25 → meaningful blowup risk even when avg is below line
const HIGH_VARIANCE_RATIO      = 0.25;
// OVER: std_dev/expected > 0.60 → player frequently hits 0, over is unreliable (STL, BLK, FTM, erratic 3PT)
const OVER_HIGH_VARIANCE_RATIO = 0.60;
// Within-series std_dev/expected > 0.35 → volatile within this series; block STRONG, cap at LEAN.
const SERIES_HIGH_VARIANCE_RATIO = 0.35;
// For lines ≤ 1.0, the % edge is easily inflated (0.3 diff on a 0.5 line = 60%).
// Require a minimum absolute edge so low-line props like BLK 0.5 can't grade STRONG/LEAN.
const LOW_LINE_THRESHOLD       = 1.0;
const MIN_ABS_EDGE             = 0.5;

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
    if (direction === "under") {
      warnings.push("High game-to-game variance — under bet has significant blowup risk");
    } else {
      warnings.push("High game-to-game variance — player frequently misses this line (hits 0 often)");
    }
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

    const variance_flag = std_dev != null && expected > 0 && (
      (direction === "under" && (std_dev / expected) > HIGH_VARIANCE_RATIO) ||
      (direction === "over" && line <= 2.0 && (std_dev / expected) > OVER_HIGH_VARIANCE_RATIO)
    );

    const warnings = getWarnings(prop, direction, prediction, variance_flag);

    const absEdge = Math.abs(expected - line);
    const meetsAbsEdge = line > LOW_LINE_THRESHOLD || absEdge >= MIN_ABS_EDGE;

    let grade: BetGrade;
    if (edge >= STRONG_THRESHOLD && confidence !== "low" && hasHistory && warnings.length === 0 && meetsAbsEdge) {
      grade = "STRONG";
    } else if (edge >= STRONG_THRESHOLD && confidence !== "low" && hasHistory && meetsAbsEdge) {
      grade = "LEAN";
    } else if (edge >= LEAN_THRESHOLD && confidence !== "low" && hasHistory && !variance_flag && meetsAbsEdge) {
      grade = "LEAN";
    } else {
      grade = "SKIP";
    }

    // Within-series variance check: high spread across series games blocks STRONG → LEAN.
    // Uses series_std_dev (backend) rather than season std_dev to catch prop-specific series volatility.
    if (grade === "STRONG") {
      const seriesStdDev = prediction.props[prop]?.series_std_dev ?? null;
      if (seriesStdDev !== null && expected > 0 && (seriesStdDev / expected) > SERIES_HIGH_VARIANCE_RATIO) {
        grade = "LEAN";
      }
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
