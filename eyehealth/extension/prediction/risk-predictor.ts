import { DailyEyeScore, PredictionResult } from "../db/schema";

/** Weighted least squares linear regression. Returns slope (score change per day). */
function weightedLinearRegression(scores: number[], weights: number[]): number {
  const n = scores.length;
  const xs = scores.map((_, i) => i);
  const wSum  = weights.reduce((a, w) => a + w, 0);
  const wxSum = xs.reduce((a, x, i) => a + weights[i] * x, 0);
  const wySum = scores.reduce((a, y, i) => a + weights[i] * y, 0);
  const wxxSum = xs.reduce((a, x, i) => a + weights[i] * x * x, 0);
  const wxySum = xs.reduce((a, x, i) => a + weights[i] * x * scores[i], 0);
  const denom = wSum * wxxSum - wxSum * wxSum;
  return denom === 0 ? 0 : (wSum * wxySum - wxSum * wySum) / denom;
}

function horizonDays(horizon: "7d" | "14d" | "30d"): number {
  return { "7d": 7, "14d": 14, "30d": 30 }[horizon];
}

/**
 * Derives a human-readable confidence UI label based on the number of days of history available.
 * Provided as an export so UI components can map raw confidence appropriately.
 */
export function confidenceLabel(days: number): string {
  if (days < 5)  return "Not enough data";
  if (days < 10) return "Early estimate";
  if (days < 21) return "Moderate confidence";
  return "Based on your habit history";
}

/**
 * Evaluates history to provide descriptive insight explanations.
 */
export function extractKeyFactors(history: DailyEyeScore[]): string[] {
  if (history.length === 0) return ["No data available to determine factors."];

  const factors: string[] = [];
  
  // Blink rate calc targeting recent 7 days average
  const recentWeek = history.slice(-7);
  let sumBlinks = 0;
  let distViolations = 0;
  
  for (const day of recentWeek) {
    // 25pts equals >= 15 bpm. 0pts equals <= 5 bpm. 
    // reverse the blink score map roughly: blinkScore = (avgBlink - 5) / 10 * 25
    // avgBlink = (blinkScore * 10 / 25) + 5
    const avgBlink = (day.breakdown.blinkScore * 10 / 25) + 5;
    sumBlinks += avgBlink;
    
    // Reverse distance map roughly: distanceScore = (avgDist - 30) / 30 * 25
    const avgDist = (day.breakdown.distanceScore * 30 / 25) + 30;
    if (avgDist < 45) distViolations++;
  }
  
  const weeklyAvgBlink = Math.round(sumBlinks / recentWeek.length);
  if (weeklyAvgBlink < 15) {
    factors.push(`Blink rate averaged ${weeklyAvgBlink} bpm this week (target: 15+)`);
  } else {
    factors.push(`Strong blink rate averaging ${weeklyAvgBlink} bpm this week`);
  }

  if (distViolations > 0) {
    factors.push(`Screen distance below 45cm on ${distViolations} of the last ${recentWeek.length} days`);
  }

  if (history.length >= 7) {
    const olderScore = history[history.length - 7].score;
    const currentScore = history[history.length - 1].score;
    const diff = currentScore - olderScore;
    if (diff < -5) {
      factors.push(`Daily score dropped ${Math.abs(diff)} points over the past week`);
    } else if (diff > 5) {
      factors.push(`Daily score improved by ${diff} points over the past week`);
    }
  }

  // Ensure top 3
  return factors.slice(0, 3);
}

export function predictRisk(history: DailyEyeScore[], horizon: "7d" | "14d" | "30d"): PredictionResult {
  const now = Date.now();

  if (history.length < 5) {
    return {
      generatedAt: now,
      horizon,
      predictedRiskLevel: "low",
      confidence: confidenceLabel(history.length) as unknown as number, 
      trendSlope: 0,
      keyFactors: ["Not enough data yet"],
      recommendation: "Keep using EyeGuard for 5+ days to unlock predictions",
      disclaimer: "This is a habit trend indicator, not medical advice.",
    };
  }

  const weights    = history.map((_, i) => 1 + i / history.length); // recent = higher weight
  const scores     = history.map(d => d.score);
  const trendSlope = weightedLinearRegression(scores, weights);

  const daysAhead  = horizonDays(horizon);
  const projected  = scores[scores.length - 1] + trendSlope * daysAhead;
  const predicted  = Math.min(100, Math.max(0, projected));

  const riskLevel: "low" | "moderate" | "high" = predicted >= 75 ? "low" : predicted >= 50 ? "moderate" : "high";
  const confidence = Math.min(0.9, 0.4 + history.length * 0.035);
  const keyFactors = extractKeyFactors(history);

  return {
    generatedAt: now,
    horizon,
    predictedRiskLevel: riskLevel,
    confidence: confidenceLabel(history.length) as unknown as number,
    trendSlope,
    keyFactors,
    recommendation: trendSlope < -0.5
      ? "Your score is declining — increase break frequency and maintain 50cm+ screen distance"
      : "Keep up your current habits",
    disclaimer: "This is a habit trend indicator, not medical advice.",
  };
}
