import { nanoid } from "nanoid";
import { db } from "../db/db";
import { AlertEvent, SensorFrame } from "../db/schema";

const DEFAULT_THRESHOLDS = {
  distanceThresholdCm: 50,       // alert if < 50cm for > 10s
  blinkRateMinimum: 15,          // alert if < 15 bpm for > 60s
  luxMinimum: 50,                // alert if lux < 50 for > 30s
  continuousUsageMinutes: 20,    // 20-20-20 rule trigger
  alertCooldownSeconds: 300,     // min 5min between same alert type
  maxAlertsPerHour: 4,           // anti-annoyance cap
};

const ALERT_MESSAGES = {
  distance: "You're too close to the screen — try moving back a bit",
  blink:    "Blink more — your eyes need moisture",
  lighting: "Low light detected — eye strain risk is high",
  usage_time: "20-20-20: Look at something 20 feet away for 20 seconds",
  outdoor:  "No outdoor time today — sunlight helps reduce myopia risk",
};

export class AlertEngine {
  private thresholds = DEFAULT_THRESHOLDS;
  
  // State for continuous duration tracking
  private violationStart = {
    distance: null as number | null,
    blink: null as number | null,
    lighting: null as number | null,
  };

  private lastFrameTimestamp: number | null = null;
  private lastAlertTimestamp: Record<string, number> = {};
  
  // Rolling hour window for maxAlertsPerHour
  private recentAlerts: number[] = [];

  /**
   * Evaluates the current frame against alert thresholds.
   * Includes stateful tracking for time-based thresholds (e.g. "> 10s").
   * @param frame The latest SensorFrame to evaluate
   * @param sessionDurationMs Total elapsed time in current session
   * @returns An AlertEvent if triggered, otherwise null
   */
  public evaluateFrame(frame: SensorFrame, sessionDurationMs: number): AlertEvent | null {
    const now = frame.timestamp;
    
    // Prune recent alerts outside the 1-hour window to enforce maxAlertsPerHour
    const ONE_HOUR = 3600000;
    this.recentAlerts = this.recentAlerts.filter(t => now - t < ONE_HOUR);

    if (this.recentAlerts.length >= this.thresholds.maxAlertsPerHour) {
      this.lastFrameTimestamp = now;
      return null; // Cap reached, no alerts allowed right now
    }

    // Evaluate Distance (< 50cm for > 10s)
    let triggeredType: keyof typeof ALERT_MESSAGES | null = null;
    let severity: "info" | "warning" | "critical" = "warning";

    if (frame.faceDetected && frame.screenDistanceCm > 0 && frame.screenDistanceCm < this.thresholds.distanceThresholdCm) {
      if (!this.violationStart.distance) this.violationStart.distance = now;
      else if (now - this.violationStart.distance > 10000) triggeredType = "distance";
    } else {
      this.violationStart.distance = null;
    }

    // Evaluate Blink Rate (< 15 bpm for > 60s)
    // Only check if we've ostensibly had 60s of frames 
    // We treat blinkRate continuously since it's already a 60s rolling average. 
    // If the rolling average itself drops below 15 for 60 sustained seconds, we trigger.
    if (frame.blinkRate < this.thresholds.blinkRateMinimum) {
      if (!this.violationStart.blink) this.violationStart.blink = now;
      else if (now - this.violationStart.blink > 60000) triggeredType = "blink";
    } else {
      this.violationStart.blink = null;
    }

    // Evaluate Lighting (lux < 50 for > 30s)
    if (frame.ambientLuxLevel < this.thresholds.luxMinimum) {
      if (!this.violationStart.lighting) this.violationStart.lighting = now;
      else if (now - this.violationStart.lighting > 30000) triggeredType = "lighting";
    } else {
      this.violationStart.lighting = null;
    }

    // Evaluate 20-20-20 rule (> 20 mins)
    // For simplicity, we just trigger if the modulo crosses the boundary.
    if (sessionDurationMs >= this.thresholds.continuousUsageMinutes * 60000) {
       // Since sessionDurationMs keeps growing, we only alert once per interval.
       // E.g. session > 20 mins, then next is tracking until they take a break and session resets.
       // We'll rely on the cooldown mechanism for preventing spam.
       severity = "info";
       if (!triggeredType) { // Prioritize other active health warnings first
           triggeredType = "usage_time";
       }
    }

    this.lastFrameTimestamp = now;

    if (!triggeredType) return null;

    // Cooldown check
    const lastTimeTypeFired = this.lastAlertTimestamp[triggeredType] || 0;
    if (now - lastTimeTypeFired < this.thresholds.alertCooldownSeconds * 1000) {
      return null;
    }

    // Checks passed. Generate alert.
    const newAlert: AlertEvent = {
      alertId: nanoid(),
      type: triggeredType as any,
      severity,
      triggeredAt: now,
      dismissed: false,
      snoozedUntil: null,
      message: ALERT_MESSAGES[triggeredType],
      actionTaken: null
    };

    // Update tracking structures
    this.lastAlertTimestamp[triggeredType] = now;
    this.recentAlerts.push(now);
    
    // Reset the violation timer so it doesn't trigger continuously immediately 
    // after cooldown without a clean state if they ignored the alert
    if (triggeredType === "distance") this.violationStart.distance = null;
    if (triggeredType === "blink") this.violationStart.blink = null;
    if (triggeredType === "lighting") this.violationStart.lighting = null;

    // Persist async (fire and forget)
    db.alerts.put(newAlert).catch(console.error);

    return newAlert;
  }

  /**
   * Marks an alert as dismissed in the IndexedDB backend.
   * @param alertId The unique ID of the alert
   */
  public async dismissAlert(alertId: string): Promise<void> {
    const alert = await db.alerts.get(alertId);
    if (alert) {
      alert.dismissed = true;
      alert.actionTaken = "dismissed";
      await db.alerts.put(alert);
    }
  }

  /**
   * Snoozes an alert for a specified number of minutes.
   * @param alertId The unique ID of the alert
   * @param minutes The duration to snooze
   */
  public async snoozeAlert(alertId: string, minutes: number): Promise<void> {
    const alert = await db.alerts.get(alertId);
    if (alert) {
      alert.snoozedUntil = Date.now() + minutes * 60000;
      alert.actionTaken = "snoozed";
      await db.alerts.put(alert);
    }
  }
}
