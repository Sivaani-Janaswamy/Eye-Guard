/**
 * DB Schema & Data Models
 * Follows exact interfaces from SPEC.md Section 5
 */
import Dexie, { type Table } from "dexie";

export interface SensorFrame {
  timestamp: number;
  faceDetected: boolean;
  screenDistanceCm: number;
  blinkRate: number;          // blinks/min, rolling 60s window
  ambientLuxLevel: number;
  isLowLight: boolean;        // lux < 50
  confidence: number;         // 0.0–1.0, MediaPipe landmark confidence
  landmarks?: number[][];
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface SessionRecord {
  sessionId: string;          // nanoid()
  startTime: number;          // unix ms
  endTime: number | null;
  durationMs: number;
  avgDistanceCm: number;
  avgBlinkRate: number;
  avgLuxLevel: number;
  breaksTaken: number;
  alertsTriggered: number;
  platform: "chrome-extension" | "android" | "desktop";
}

export interface DailyEyeScore {
  date: string;               // "YYYY-MM-DD"
  score: number;              // 0–100, integer
  breakdown: {
    screenTimeScore: number;  // 0–25
    distanceScore: number;    // 0–25
    blinkScore: number;       // 0–25
    lightingScore: number;    // 0–25
  };
  avgDistanceCm: number;
  avgBlinkRate: number;
  avgLux: number;
  riskLevel: "low" | "moderate" | "high";
  myopiaRiskFlag: boolean;    // true if score < 50 for 3+ consecutive days
  totalScreenMinutes: number;
  totalDurationMs: number;
}

export interface AlertEvent {
  alertId: string;
  type: "distance" | "blink" | "lighting" | "usage_time" | "outdoor";
  severity: "info" | "warning" | "critical";
  triggeredAt: number;
  dismissed: boolean;
  snoozedUntil: number | null;
  message: string;
  actionTaken: "dismissed" | "snoozed" | "complied" | null;
}

export interface CorrectionProfile {
  contrastBoost: number;      // 0.0–1.0
  sharpnessLevel: number;     // 0.0–1.0
  fontScaleFactor: number;    // 1.0–2.0
  blueLightFilter: number;    // 0.0–1.0
  autoAdjust: boolean;
  activePreset: "off" | "office" | "night" | "custom";
}

export interface ConsentRecord {
  consentedAt: number;        // unix ms
  consentVersion: string;     // "1.0"
  cameraGranted: boolean;
  backendSyncEnabled: boolean;
  dataRetentionDays: number;
}

export interface PredictionResult {
  generatedAt: number;
  horizon: "7d" | "14d" | "30d";
  predictedRiskLevel: "low" | "moderate" | "high";
  confidence: number;
  trendSlope: number;         // score change per day (negative = worsening)
  keyFactors: string[];
  recommendation: string;
  disclaimer: string;         // always "This is a habit trend indicator, not medical advice."
}

// Fixed id—there is only ever one profile record.
export interface StoredCorrectionProfile extends CorrectionProfile {
  id: 1;
}

export class EyeGuardDB extends Dexie {
  sessions!:    Table<SessionRecord>;
  scores!:      Table<DailyEyeScore>;
  alerts!:      Table<AlertEvent>;
  correction!:  Table<StoredCorrectionProfile>;
  predictions!: Table<PredictionResult>;
  consent!:     Table<ConsentRecord>;
  live_stats!:  Table<{ 
    id: number; 
    distanceCm: number; 
    blinkRate: number; 
    lux: number; 
    faceDetected: boolean; 
    updatedAt: number;
    confidence?: number;
    landmarks?: number[][] | null;
  }>;
  session_data!: Table<{
    id: number;
    durationMs: number;
    updatedAt: number;
  }>;

  constructor() {
    super("EyeGuardDB");
    
    this.version(1).stores({
      sessions:    "sessionId, startTime, endTime",
      scores:      "date, score, riskLevel",
      alerts:      "alertId, type, triggeredAt, dismissed",
      correction:  "id",
      predictions: "generatedAt, horizon",
      consent:     "consentedAt",
    });

    this.version(2).stores({
      live_stats: "id"
    });

    this.version(3).stores({
      session_data: "id, updatedAt"
    });
  }
}
