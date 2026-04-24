import { db } from "../db/db";
import { DailyEyeScore, SessionRecord } from "../db/schema";

/**
 * Bounds a value between the given minimum and maximum limit.
 */
function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Computes a weighted average for a given metric across all sessions, weighted by duration.
 */
function weightedAvg(sessions: SessionRecord[], key: keyof SessionRecord): number {
  const totalDur = sessions.reduce((s, r) => s + r.durationMs, 0);
  if (totalDur === 0) return 0;
  return sessions.reduce((s, r) => s + (r[key] as number) * (r.durationMs / totalDur), 0);
}

/**
 * Returns a null score payload indicating zero data for the selected day.
 */
function nullScore(today: string): DailyEyeScore {
  return {
    date: today,
    score: 0,
    breakdown: { screenTimeScore: 0, distanceScore: 0, blinkScore: 0, lightingScore: 0 },
    avgDistanceCm: 0,
    avgBlinkRate: 0,
    avgLux: 0,
    riskLevel: "high",
    myopiaRiskFlag: false,
    totalScreenMinutes: 0,
    totalDurationMs: 0,
  };
}

export class ScoreEngine {
  /**
   * Computes the daily score mathematically without side-effects based EXACTLY on Section 6.
   * @param sessions A list of SessionRecords for the target day
   * @param today A YYYY-MM-DD formatted string representing the date
   * @returns DailyEyeScore object
   */
  public computeDailyScore(sessions: SessionRecord[], today: string): DailyEyeScore {
    if (sessions.length === 0) return nullScore(today);

    const totalMs = sessions.reduce((s, r) => s + r.durationMs, 0);
    const totalMins = totalMs / 60000;
    const avgDist = weightedAvg(sessions, "avgDistanceCm");
    const avgBlink = weightedAvg(sessions, "avgBlinkRate");
    const avgLux = weightedAvg(sessions, "avgLuxLevel");

    // Screen time: 25pts. Full score <= 6h. Zero at >= 12h.
    const screenTimeScore = clamp(25 - Math.max(0, (totalMins / 60 - 6)) * 4.17, 0, 25);

    // Distance: 25pts. Full score >= 60cm. Zero at <= 30cm.
    const distanceScore = clamp((avgDist - 30) / 30 * 25, 0, 25);

    // Blink rate: 25pts. Full score >= 15 bpm. Zero at <= 5 bpm.
    const blinkScore = clamp((avgBlink - 5) / 10 * 25, 0, 25);

    // Lighting: 25pts. Full score at lux >= 200. Zero at lux <= 20.
    const lightingScore = clamp((avgLux - 20) / 180 * 25, 0, 25);

    const score = Math.round(screenTimeScore + distanceScore + blinkScore + lightingScore);
    const riskLevel: "low" | "moderate" | "high" = score >= 75 ? "low" : score >= 50 ? "moderate" : "high";
    const myopiaRiskFlag = false; // Resolved correctly dynamically when persisting/fetching via DB context.

    return {
      date: today,
      score,
      breakdown: { screenTimeScore, distanceScore, blinkScore, lightingScore },
      avgDistanceCm: Math.round(avgDist),
      avgBlinkRate: parseFloat(avgBlink.toFixed(1)),
      avgLux: Math.round(avgLux),
      riskLevel,
      myopiaRiskFlag,
      totalScreenMinutes: Math.round(totalMins),
      totalDurationMs: totalMs,
    };
  }

  /**
   * Generates a date string representing today locally.
   */
  private getTodayDateString(): string {
    const tzOffset = (new Date()).getTimezoneOffset() * 60000; 
    return (new Date(Date.now() - tzOffset)).toISOString().split("T")[0];
  }

  /**
   * Fetches today's relevant sessions, leverages `computeDailyScore`, and returns the final score.
   * Also persists to DB so history checks can rely on the latest data correctly.
   */
  public async getTodayScore(): Promise<DailyEyeScore> {
    const today = this.getTodayDateString();
    
    // Convert YYYY-MM-DD into start of day timestamp locally
    const startDate = new Date(`${today}T00:00:00`);
    const startTime = startDate.getTime();

    // Query Dexie
    const sessions = await db.sessions
      .where("startTime")
      .aboveOrEqual(startTime)
      .toArray();

    // Compute base score
    let dailyScore = this.computeDailyScore(sessions, today);

    // Process Myopia Risk Flag (3 consecutive days < 50)
    // To do this properly, get the last 3 recorded days from the DB
    const recentScores = await db.scores
      .orderBy("date")
      .reverse()
      .limit(3)
      .toArray();

    let consecutiveHighRisk = 0;
    
    // Overwrite the most recent one if it's already today being re-checked
    if (recentScores.length > 0 && recentScores[0].date === today) {
       recentScores[0] = dailyScore;
    } else {
       recentScores.unshift(dailyScore);
    }
    
    for (let i = 0; i < Math.min(recentScores.length, 3); i++) {
       if (recentScores[i].score < 50) {
          consecutiveHighRisk++;
       } else {
          break; // Broken streak
       }
    }

    if (consecutiveHighRisk >= 3) {
       dailyScore.myopiaRiskFlag = true;
    }

    // Persist and return
    await db.scores.put(dailyScore);
    return dailyScore;
  }

  /**
   * Gets the finalized score history over a defined past horizon.
   */
  public async getScoreHistory(days: number): Promise<DailyEyeScore[]> {
    const dates: string[] = [];
    const _24h = 86400000;
    const now = Date.now();

    const tzOffset = (new Date()).getTimezoneOffset() * 60000; 
    
    const cutoffDateObj = new Date(now - (days * _24h) - tzOffset);
    const cutoffStr = cutoffDateObj.toISOString().split("T")[0];

    return db.scores
      .where("date")
      .aboveOrEqual(cutoffStr)
      .sortBy("date");
  }
}
