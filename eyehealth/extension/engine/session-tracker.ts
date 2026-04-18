import { nanoid } from "nanoid";
import { db } from "../db/db";
import { SensorFrame, SessionRecord } from "../db/schema";

export class SessionTracker {
  private activeSession: SessionRecord | null = null;
  private frameBuffer: SensorFrame[] = [];

  /**
   * Initializes a new session and saves the initial record to the database.
   * @returns The generated SessionRecord
   */
  public async startSession(): Promise<SessionRecord> {
    const sessionId = nanoid();
    const startTime = Date.now();
    
    this.activeSession = {
      sessionId,
      startTime,
      endTime: null,
      durationMs: 0,
      avgDistanceCm: 0,
      avgBlinkRate: 0,
      avgLuxLevel: 0,
      breaksTaken: 0,
      alertsTriggered: 0,
      platform: "chrome-extension"
    };

    // Store in DB initially
    await db.sessions.put(this.activeSession);
    this.frameBuffer = [];
    
    return this.activeSession;
  }

  /**
   * Appends a frame to the in-memory buffer without touching the DB.
   * @param frame The latest SensorFrame array snapshot
   */
  public addFrame(frame: SensorFrame): void {
    if (this.activeSession) {
      this.frameBuffer.push(frame);
    }
  }

  /**
   * Finalizes the session, calculates aggregated metrics, and saves the final outcome to the DB.
   * @param sessionId The ID of the session to end
   * @returns The finalized SessionRecord, or null if the session ID didn't match active
   */
  public async endSession(sessionId: string): Promise<SessionRecord | null> {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return null;
    }

    const endTime = Date.now();
    this.activeSession.endTime = endTime;
    this.activeSession.durationMs = endTime - this.activeSession.startTime;

    // Calculate averages from buffered frames
    if (this.frameBuffer.length > 0) {
      let sumDistance = 0;
      let sumBlinkRate = 0;
      let sumLux = 0;
      let countDistanceValid = 0;

      for (const frame of this.frameBuffer) {
        if (frame.faceDetected && frame.screenDistanceCm > 0) {
          sumDistance += frame.screenDistanceCm;
          countDistanceValid++;
        }
        sumBlinkRate += frame.blinkRate;
        sumLux += frame.ambientLuxLevel;
      }

      this.activeSession.avgDistanceCm = countDistanceValid > 0 ? sumDistance / countDistanceValid : 0;
      this.activeSession.avgBlinkRate = sumBlinkRate / this.frameBuffer.length;
      this.activeSession.avgLuxLevel = sumLux / this.frameBuffer.length;
    }

    // Persist finalized session
    await db.sessions.put(this.activeSession);
    
    const finishedSession = { ...this.activeSession };
    
    // Clear in-memory active tracking
    this.activeSession = null;
    this.frameBuffer = [];

    return finishedSession;
  }

  /**
   * Retrieves the currently active session record, if any.
   * @returns The current SessionRecord or null
   */
  public getActiveSession(): SessionRecord | null {
    return this.activeSession;
  }
}
