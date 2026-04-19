import { SessionRecord } from "../db/schema";
import { nanoid } from "nanoid";

export type SyntheticSessionRecord = SessionRecord & { isSyntheticData: boolean };

/**
 * Produces structured realistic sessions mapped to benchmark bounds with natural variance.
 * Specifically handles the dashboard pipeline ensuring the Demo components can securely graph realistic habit flows.
 */
export function generateSyntheticBenchmarkData(days: number = 14): SyntheticSessionRecord[] {
  const sessions: SyntheticSessionRecord[] = [];
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (let i = 0; i < days; i++) {
    // Generate 1-3 sessions per day simulating various breaks
    const numSessions = Math.floor(Math.random() * 3) + 1;
    
    for (let j = 0; j < numSessions; j++) {
      // Session duration: 45 min to 3 hours
      const durationMs = (45 + Math.random() * 135) * 60 * 1000;
      const startTime = now - (days - i) * ONE_DAY_MS + (j * Math.random() * 4 * 60 * 60 * 1000);
      const endTime = startTime + durationMs;
      
      const session: SyntheticSessionRecord = {
        sessionId: nanoid(),
        startTime,
        endTime,
        durationMs,
        
        // Natural variance distributions mapped around target thresholds
        avgDistanceCm: 35 + Math.random() * 30,  // 35cm to 65cm
        avgBlinkRate: 8 + Math.random() * 12,    // 8bpm to 20bpm
        avgLuxLevel: 30 + Math.random() * 150,   // 30lux to 180lux
        
        breaksTaken: Math.floor(Math.random() * 3),
        alertsTriggered: Math.floor(Math.random() * 5),
        platform: "chrome-extension",
        
        isSyntheticData: true,
      };

      sessions.push(session);
    }
  }

  // Sort chronologically precisely
  return sessions.sort((a, b) => a.startTime - b.startTime);
}
