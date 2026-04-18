# SPEC.md — AI Vision Health + Digital Correction System
> **Version:** 1.0.0 | **Status:** Active | **Last Updated:** 2025-04-18
> This file is the single source of truth for all AI agents working on this project.
> Agents must read this file completely before writing any code.

---

## 0. Agent Instructions

If you are an AI agent reading this file:
- Follow each section in order. Do NOT skip sections.
- Every module is defined in Section 14 (Agent Module Assignments). Work only within your assigned module's listed files.
- Do NOT modify other modules' files unless the task explicitly says so.
- All file paths are relative to project root `/eyehealth/`
- After completing a task, update `STATUS.md` with what you built and what tests passed.
- If something is ambiguous, default to the simpler implementation and log it in `STATUS.md` under `DECISIONS`.
- Never expose raw camera frames outside the device. See Section 4 (Privacy).

---

## 1. Project Overview

**Name:** EyeGuard — AI Vision Health & Digital Correction System
**Tagline:** Like Grammarly running in the background, but for your eyes.

**Problem:** Myopia prevalence is rising sharply (~50% of global population by 2050). Poor screen habits — close distance, low blink rate, bad lighting, zero breaks — are the primary behavioral driver. No tool currently monitors these in real time and corrects for them digitally.

**Solution:** A cross-platform app that:
1. Monitors screen habits via camera + sensors (on-device only)
2. Scores daily eye health (0–100)
3. Alerts users with non-intrusive nudges
4. Applies software-level visual correction (contrast, sharpness, font scaling, blue light)
5. Predicts risk trends over 7–30 days from behavioral history

**Target Platform (MVP):** Chrome Browser Extension (desktop) — chosen for fastest iteration, no app store friction, and direct DOM access for digital correction.

---

## 2. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Extension | Chrome Extension MV3 (TypeScript) | Fast to ship, no app store |
| CV / Face Detection | MediaPipe Face Mesh (WASM, on-device) | No frames leave device |
| Local Storage | IndexedDB via Dexie.js | Structured, queryable, offline-first |
| Backend (optional) | FastAPI (Python) + PostgreSQL | Only aggregated scores, never raw frames |
| Dashboard UI | React 18 + Tailwind CSS | Component-based, easy to agent-build |
| Charts | Recharts | Lightweight, React-native |
| Auth (if backend) | Supabase Auth (JWT) | Easy setup, free tier |

---

## 3. Folder Structure

```
eyehealth/
├── extension/                  # Chrome extension (MV3)
│   ├── manifest.json
│   ├── background/
│   │   └── service-worker.ts   # Agent: Module A
│   ├── content/
│   │   └── overlay.ts          # Agent: Module B
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.tsx           # Agent: Module C
│   ├── cv/
│   │   ├── face-mesh.ts        # Agent: Module D
│   │   └── blink-detector.ts   # Agent: Module D
│   ├── engine/
│   │   ├── session-tracker.ts  # Agent: Module E
│   │   ├── score-engine.ts     # Agent: Module E
│   │   └── alert-engine.ts     # Agent: Module F
│   ├── correction/
│   │   └── display-corrector.ts # Agent: Module G
│   ├── prediction/
│   │   └── risk-predictor.ts   # Agent: Module H
│   └── db/
│       ├── schema.ts           # Agent: Module A (first)
│       └── db.ts
├── dashboard/                  # React dashboard (separate page)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ScoreCard.tsx   # Agent: Module I
│   │   │   ├── TrendChart.tsx  # Agent: Module I
│   │   │   ├── AlertFeed.tsx   # Agent: Module I
│   │   │   └── CorrectionPanel.tsx # Agent: Module I
│   │   └── pages/
│   │       └── Dashboard.tsx
│   └── package.json
├── backend/                    # Optional sync backend
│   ├── main.py                 # Agent: Module J
│   ├── models.py
│   ├── routes/
│   │   ├── sessions.py
│   │   ├── scores.py
│   │   ├── alerts.py
│   │   └── predictions.py
│   └── requirements.txt
├── tests/
│   ├── cv/
│   │   └── blink_accuracy.test.ts  # Agent: Module K
│   └── engine/
│       └── score_engine.test.ts
├── privacy/
│   └── PRIVACY_ARCHITECTURE.md     # See Section 4
├── SPEC.md                     # This file
├── STATUS.md                   # Agents update this
└── README.md
```

---

## 4. Privacy Architecture (REQUIRED — Read Before Building Any CV Code)

> This section exists because EyeGuard uses always-on camera access. Mishandling this is a deployment blocker.

### 4.1 Core Privacy Principles

1. **No raw frames ever leave the device.** The camera feed is processed entirely in-browser via MediaPipe WASM. Only derived metrics (blinkRate, distanceCm, isLowLight) are stored.
2. **No biometric data is stored.** Face landmarks are computed transiently in memory and immediately discarded. Only the scalar outputs are persisted.
3. **Explicit opt-in only.** Camera permission is requested with a clear explanation. Users can disable monitoring at any time from the popup.
4. **Local-first.** All data defaults to IndexedDB on the user's device. Backend sync is opt-in and sends only anonymised aggregates (daily scores, not raw frames or landmarks).
5. **Data deletion.** Users can wipe all local data from the popup settings panel. If backend sync is enabled, a DELETE /api/v1/user/data endpoint purges server records.

### 4.2 Data Classification

| Data Type | Stored Locally | Sent to Server | Retention |
|---|---|---|---|
| Raw camera frames | NEVER | NEVER | N/A |
| Face landmarks | NEVER | NEVER | N/A |
| blinkRate (scalar) | Yes, per session | No | 90 days |
| distanceCm (scalar) | Yes, per session | No | 90 days |
| Daily EyeScore | Yes | Only if sync enabled | 1 year |
| Alert history | Yes | No | 30 days |
| Correction profile | Yes | Only if sync enabled | Until deleted |

### 4.3 Compliance Notes

- **India DPDP Act 2023:** User consent must be granular and withdrawable. Log consent timestamp in IndexedDB.
- **Chrome Web Store Policy:** Declare camera usage in manifest with justification. Do not request camera on pages where it is not active.
- **GDPR (if EU users):** Implement right-to-erasure via the delete endpoint. Do not store any PII.

### 4.4 Privacy Architecture File

Agents building the CV or backend modules must generate `privacy/PRIVACY_ARCHITECTURE.md` containing:
- Data flow diagram (text/ASCII)
- Consent flow description
- What is stored vs discarded at each pipeline step

---

## 5. Data Models (TypeScript)

Agents must use these exact interfaces. Do not rename fields.

```typescript
// SensorFrame — transient, never persisted
interface SensorFrame {
  timestamp: number;
  faceDetected: boolean;
  screenDistanceCm: number;
  blinkRate: number;          // blinks/min, rolling 60s window
  ambientLuxLevel: number;
  isLowLight: boolean;        // lux < 50
  confidence: number;         // 0.0–1.0, MediaPipe landmark confidence
}

// SessionRecord — persisted to IndexedDB
interface SessionRecord {
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

// DailyEyeScore — persisted to IndexedDB + optionally synced
interface DailyEyeScore {
  date: string;               // "YYYY-MM-DD"
  score: number;              // 0–100, integer
  breakdown: {
    screenTimeScore: number;  // 0–25
    distanceScore: number;    // 0–25
    blinkScore: number;       // 0–25
    lightingScore: number;    // 0–25
  };
  riskLevel: "low" | "moderate" | "high";
  myopiaRiskFlag: boolean;    // true if score < 50 for 3+ consecutive days
  totalScreenMinutes: number;
}

// AlertEvent — persisted to IndexedDB
interface AlertEvent {
  alertId: string;
  type: "distance" | "blink" | "lighting" | "usage_time" | "outdoor";
  severity: "info" | "warning" | "critical";
  triggeredAt: number;
  dismissed: boolean;
  snoozedUntil: number | null;
  message: string;
  actionTaken: "dismissed" | "snoozed" | "complied" | null;
}

// CorrectionProfile — persisted to IndexedDB
interface CorrectionProfile {
  contrastBoost: number;      // 0.0–1.0
  sharpnessLevel: number;     // 0.0–1.0
  fontScaleFactor: number;    // 1.0–2.0
  blueLightFilter: number;    // 0.0–1.0
  autoAdjust: boolean;
  activePreset: "off" | "office" | "night" | "custom";
}

// ConsentRecord — persisted to IndexedDB, never synced
interface ConsentRecord {
  consentedAt: number;        // unix ms
  consentVersion: string;     // "1.0"
  cameraGranted: boolean;
  backendSyncEnabled: boolean;
  dataRetentionDays: number;
}

// PredictionResult — computed, persisted
interface PredictionResult {
  generatedAt: number;
  horizon: "7d" | "14d" | "30d";
  predictedRiskLevel: "low" | "moderate" | "high";
  confidence: number;
  trendSlope: number;         // score change per day (negative = worsening)
  keyFactors: string[];
  recommendation: string;
  disclaimer: string;         // always "This is a habit trend indicator, not medical advice."
}
```

---

## 6. Scoring Algorithm

Score is computed at end of each day from that day's SessionRecords.

```typescript
function nullScore(today: string): DailyEyeScore {
  return {
    date: today,
    score: 0,
    breakdown: { screenTimeScore: 0, distanceScore: 0, blinkScore: 0, lightingScore: 0 },
    riskLevel: "high",
    myopiaRiskFlag: false,
    totalScreenMinutes: 0,
  };
}

function computeDailyScore(sessions: SessionRecord[], today: string): DailyEyeScore {
  if (sessions.length === 0) return nullScore(today);

  const totalMins = sessions.reduce((s, r) => s + r.durationMs / 60000, 0);
  const avgDist   = weightedAvg(sessions, "avgDistanceCm");
  const avgBlink  = weightedAvg(sessions, "avgBlinkRate");
  const avgLux    = weightedAvg(sessions, "avgLuxLevel");

  // Screen time: 25pts. Full score ≤ 6h. Zero at ≥ 12h.
  const screenTimeScore = clamp(25 - Math.max(0, (totalMins / 60 - 6)) * 4.17, 0, 25);

  // Distance: 25pts. Full score ≥ 60cm. Zero at ≤ 30cm.
  const distanceScore = clamp((avgDist - 30) / 30 * 25, 0, 25);

  // Blink rate: 25pts. Full score ≥ 15 bpm. Zero at ≤ 5 bpm.
  const blinkScore = clamp((avgBlink - 5) / 10 * 25, 0, 25);

  // Lighting: 25pts. Full score at lux ≥ 200. Zero at lux ≤ 20.
  const lightingScore = clamp((avgLux - 20) / 180 * 25, 0, 25);

  const score = Math.round(screenTimeScore + distanceScore + blinkScore + lightingScore);
  const riskLevel: "low" | "moderate" | "high" = score >= 75 ? "low" : score >= 50 ? "moderate" : "high";
  const myopiaRiskFlag = false; // Set to true in score-engine.ts after checking 3 consecutive days < 50

  return {
    date: today,
    score,
    breakdown: { screenTimeScore, distanceScore, blinkScore, lightingScore },
    riskLevel,
    myopiaRiskFlag,
    totalScreenMinutes: Math.round(totalMins),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function weightedAvg(sessions: SessionRecord[], key: keyof SessionRecord): number {
  const totalDur = sessions.reduce((s, r) => s + r.durationMs, 0);
  return sessions.reduce((s, r) => s + (r[key] as number) * (r.durationMs / totalDur), 0);
}
```

---

## 7. Alert Thresholds (Defaults)

```typescript
const DEFAULT_THRESHOLDS = {
  distanceThresholdCm: 50,       // alert if < 50cm for > 10s
  blinkRateMinimum: 15,          // alert if < 15 bpm for > 60s
  luxMinimum: 50,                // alert if lux < 50 for > 30s
  continuousUsageMinutes: 20,    // 20-20-20 rule trigger
  alertCooldownSeconds: 300,     // min 5min between same alert type
  maxAlertsPerHour: 4,           // anti-annoyance cap
};
```

Alert messages must be exactly these strings (used by tests):

```typescript
const ALERT_MESSAGES = {
  distance: "You're too close to the screen — try moving back a bit",
  blink:    "Blink more — your eyes need moisture",
  lighting: "Low light detected — eye strain risk is high",
  usage_time: "20-20-20: Look at something 20 feet away for 20 seconds",
  outdoor:  "No outdoor time today — sunlight helps reduce myopia risk",
};
```

---

## 8. CV Benchmarking Requirements (Internship-Level Proof)

> This section addresses a known gap: CV accuracy must be measured, not assumed.

### 8.1 What to Benchmark

Agent Module K must produce `tests/cv/BENCHMARK_REPORT.md` containing:

| Condition | Blink Detection Accuracy | Distance Estimation Error |
|---|---|---|
| Normal lighting, no glasses | Target ≥ 85% | Target ≤ ±5cm |
| Low lighting | Target ≥ 70% | Target ≤ ±8cm |
| Glasses | Target ≥ 75% | Target ≤ ±6cm |
| Head turned 15°+ | Target ≥ 65% | Target ≤ ±10cm |

### 8.2 How to Run Benchmarks

```typescript
// tests/cv/blink_accuracy.test.ts
// Uses pre-recorded video clips (stored in tests/cv/fixtures/)
// Ground truth blinks manually annotated in tests/cv/fixtures/labels.json

interface BenchmarkLabel {
  videoFile: string;
  condition: "normal" | "low_light" | "glasses" | "head_turned";
  totalBlinks: number;          // manually counted
  durationSeconds: number;
  avgDistanceCm: number;        // measured with ruler
}
```

### 8.3 Synthetic Data Fallback

If real benchmark videos are not available at build time, generate synthetic data:

```typescript
function generateSyntheticBenchmarkData(days: number = 14): SessionRecord[] {
  // Produces realistic sessions with known variance
  // Used to seed dashboard demo and test score engine
  // MUST be clearly labeled as synthetic in the UI ("Demo data")
}
```

---

## 9. Digital Correction Implementation

The display corrector applies CSS filters to the active tab's `<html>` element via content script injection. It does NOT modify any page's DOM content.

```typescript
// correction/display-corrector.ts

function buildFilterString(profile: CorrectionProfile): string {
  const contrast  = 1 + profile.contrastBoost * 0.4;        // 1.0–1.4
  const brightness = 1 - profile.blueLightFilter * 0.15;    // 0.85–1.0
  const saturate  = 1 - profile.blueLightFilter * 0.3;      // 0.7–1.0

  return `contrast(${contrast}) brightness(${brightness}) saturate(${saturate})`;
}

function applySharpness(level: number): void {
  // Inject SVG feConvolveMatrix filter for edge sharpening
  // level 0.0 = no filter, 1.0 = strong sharpen kernel
}

function applyFontScale(factor: number): void {
  // Inject: document.documentElement.style.fontSize = `${factor * 16}px`
  // This scales rem-based layouts. px-based layouts unaffected (known limitation).
}

// Presets
const CORRECTION_PRESETS: Record<string, CorrectionProfile> = {
  off:    { contrastBoost: 0,   sharpnessLevel: 0,   fontScaleFactor: 1.0, blueLightFilter: 0,   autoAdjust: false, activePreset: "off" },
  office: { contrastBoost: 0.3, sharpnessLevel: 0.2, fontScaleFactor: 1.1, blueLightFilter: 0.2, autoAdjust: false, activePreset: "office" },
  night:  { contrastBoost: 0.2, sharpnessLevel: 0.1, fontScaleFactor: 1.2, blueLightFilter: 0.8, autoAdjust: false, activePreset: "night" },
};
```

---

## 10. Prediction Engine

> The prediction engine is a habit trend indicator, NOT a medical diagnosis tool. This must be stated clearly in the UI.

### 10.1 Algorithm

Uses weighted linear regression over the last N days of DailyEyeScore values.

```typescript
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

function confidenceLabel(days: number): string {
  if (days < 5)  return "Not enough data";
  if (days < 10) return "Early estimate";
  if (days < 21) return "Moderate confidence";
  return "Based on your habit history";
}

function predictRisk(history: DailyEyeScore[], horizon: "7d" | "14d" | "30d"): PredictionResult {
  const now = Date.now();

  if (history.length < 5) {
    return {
      generatedAt: now,
      horizon,
      predictedRiskLevel: "low",
      confidence: 0.1,
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
    confidence,
    trendSlope,
    keyFactors,
    recommendation: trendSlope < -0.5
      ? "Your score is declining — increase break frequency and maintain 50cm+ screen distance"
      : "Keep up your current habits",
    disclaimer: "This is a habit trend indicator, not medical advice.",
  };
}
```

### 10.2 Confidence Calibration

| Days of Data | Max Confidence | UI Label |
|---|---|---|
| < 5 days | 0.20 | "Not enough data" |
| 5–9 days | 0.55 | "Early estimate" |
| 10–20 days | 0.75 | "Moderate confidence" |
| 21+ days | 0.90 | "Based on your habit history" |

Confidence must never be shown as a raw float. Use the UI Label strings above.

---

## 11. REST API Contracts (Backend — Optional)

Base URL: `https://api.eyeguard.app/v1`
Auth: `Authorization: Bearer <jwt>` on all routes except `/auth/*`

### Sessions

```
POST   /sessions/start
Body:  { deviceId: string, platform: string, consentVersion: string }
Resp:  201 { sessionId: string, startTime: number }

POST   /sessions/:id/end
Body:  { endTime: number, avgDistanceCm: number, avgBlinkRate: number, avgLuxLevel: number, breaksTaken: number }
Resp:  200 { sessionId: string, durationMs: number }

GET    /sessions?date=YYYY-MM-DD&limit=20&offset=0
Resp:  200 { sessions: SessionRecord[], total: number }
```

### Scores

```
GET    /score/today
Resp:  200 DailyEyeScore

GET    /score/history?from=YYYY-MM-DD&to=YYYY-MM-DD
Resp:  200 { scores: DailyEyeScore[] }

POST   /score/compute
Resp:  202 { jobId: string }   // async, poll /score/today
```

### Alerts

```
GET    /alerts?unread=true&limit=10
Resp:  200 { alerts: AlertEvent[] }

POST   /alerts/:id/dismiss
POST   /alerts/:id/snooze
Body:  { snoozeMinutes: number }

GET    /alerts/config
PUT    /alerts/config
Body:  Partial<typeof DEFAULT_THRESHOLDS>
```

### Correction

```
GET    /correction/profile
PUT    /correction/profile
Body:  CorrectionProfile
Resp:  200 { applied: boolean, activePreset: string }

GET    /correction/presets
Resp:  200 { presets: Record<string, CorrectionProfile> }
```

### Prediction

```
GET    /prediction/latest
Resp:  200 PredictionResult

POST   /prediction/generate
Body:  { horizon: "7d" | "14d" | "30d" }
Resp:  202 { jobId: string }
```

### Analytics

```
GET    /analytics/weekly-summary
Resp:  200 {
  weekOf: string,
  avgDailyScore: number,
  totalScreenHours: number,
  avgBlinkRate: number,
  avgDistanceCm: number,
  breaksComplied: number,
  breaksTotal: number,
  outdoorMinutes: number,
  trend: "improving" | "stable" | "worsening"
}

GET    /analytics/trends?metric=blinkRate|distance|score&days=30
Resp:  200 { data: { date: string, value: number }[] }
```

### User / Privacy

```
DELETE /user/data
Resp:  200 { deletedAt: number, recordsDeleted: number }

GET    /user/consent
PUT    /user/consent
Body:  ConsentRecord
```

---

## 12. IndexedDB Schema (Dexie.js)

```typescript
// db/schema.ts
import Dexie, { Table } from "dexie";

// CorrectionProfile stored with a fixed id — there is only ever one profile record.
interface StoredCorrectionProfile extends CorrectionProfile {
  id: 1; // always 1 — use db.correction.put({ id: 1, ...profile }) to upsert
}

class EyeGuardDB extends Dexie {
  sessions!:    Table<SessionRecord>;
  scores!:      Table<DailyEyeScore>;
  alerts!:      Table<AlertEvent>;
  correction!:  Table<StoredCorrectionProfile>;
  predictions!: Table<PredictionResult>;
  consent!:     Table<ConsentRecord>;

  constructor() {
    super("EyeGuardDB");
    this.version(1).stores({
      sessions:    "sessionId, startTime, endTime",
      scores:      "date, score, riskLevel",
      alerts:      "alertId, type, triggeredAt, dismissed",
      correction:  "id",                          // fixed primary key, always id=1
      predictions: "generatedAt, horizon",
      consent:     "consentedAt",
    });
  }
}

export const db = new EyeGuardDB();
```

---

## 13. Chrome Extension Manifest

```json
{
  "manifest_version": 3,
  "name": "EyeGuard — Vision Health Monitor",
  "version": "0.1.0",
  "description": "Real-time eye health monitoring and digital vision correction. All processing is on-device.",
  "permissions": ["storage", "tabs", "alarms", "notifications"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/overlay.js"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "32": "icons/icon32.png" }
  },
  "icons": { "32": "icons/icon32.png", "128": "icons/icon128.png" }
}
```

> **Note for agents:** Camera access in MV3 is NOT declared in the manifest. It is requested at runtime via `navigator.mediaDevices.getUserMedia({ video: true })` inside the content script. The browser shows its own native camera permission prompt. Do NOT add `"camera"` to permissions — Chrome will reject the extension.

---

## 14. Agent Module Assignments

Each module is a discrete unit. Agents are assigned one module at a time.

| Module | Agent Task | Files | Depends On |
|---|---|---|---|
| **A** | DB schema + service worker skeleton | `db/schema.ts`, `db/db.ts`, `background/service-worker.ts` | Nothing — build first |
| **B** | Content script overlay (alert UI injection) | `content/overlay.ts` | Module A |
| **C** | Popup UI (score widget, quick settings) | `popup/popup.tsx`, `popup.html` | Module A, E |
| **D** | CV pipeline (MediaPipe + blink detection) | `cv/face-mesh.ts`, `cv/blink-detector.ts` | Module A |
| **E** | Session tracker + score engine | `engine/session-tracker.ts`, `engine/score-engine.ts` | Module A, D |
| **F** | Alert engine | `engine/alert-engine.ts` | Module E |
| **G** | Digital correction | `correction/display-corrector.ts` | Module A |
| **H** | Prediction engine | `prediction/risk-predictor.ts` | Module E |
| **I** | Dashboard UI (React) | `dashboard/src/**` | Module A, E, H |
| **J** | Backend API (FastAPI) | `backend/**` | Module A |
| **K** | CV benchmarks + synthetic data | `tests/**` | Module D |

### Agent Prompt Template

When spawning an agent on Antigravity, use this prompt prefix:

```
You are building Module [X] of the EyeGuard project.

1. Read SPEC.md completely before writing any code.
2. Your task: [describe task]
3. Files to create: [list files]
4. Do NOT modify files outside your module.
5. After completing, update STATUS.md with: files created, tests status, decisions made.
6. Privacy rule: never store raw camera frames or face landmarks anywhere.
7. Use the exact TypeScript interfaces from SPEC.md Section 5.
8. Use the exact alert messages from SPEC.md Section 7.
```

---

## 15. Build Order (Critical — Follow This Sequence)

```
Phase 1 — Foundation (do these first, in order)
  [1] Module A  — DB schema + service worker
  [2] Module D  — CV pipeline (MediaPipe)
  [3] Module E  — Session tracker + score engine

Phase 2 — Core Features (parallel after Phase 1)
  [4] Module F  — Alert engine
  [5] Module G  — Digital correction
  [6] Module B  — Content script overlay

Phase 3 — Intelligence + UI (parallel after Phase 2)
  [7] Module H  — Prediction engine
  [8] Module C  — Popup UI
  [9] Module I  — Dashboard

Phase 4 — Quality
  [10] Module K — CV benchmarks + BENCHMARK_REPORT.md
  [11] Module J — Backend (optional, only if time permits)
```

---

## 16. Definition of Done

A module is "done" when:
- [ ] All specified files exist and compile without TypeScript errors
- [ ] Unit tests pass (where specified)
- [ ] No raw camera frames are stored or transmitted
- [ ] Consent check runs before any camera access
- [ ] `STATUS.md` is updated with module status
- [ ] Code has JSDoc comments on all exported functions

### Project is "demo-ready" when Modules A–I are done.
### Project is "internship-portfolio-ready" when Module K (benchmarks) is also done.

---

## 17. Known Limitations (Be Honest in UI and Docs)

Agents must surface these limitations in the UI and README. Do not hide them.

1. **Distance estimation** uses face bounding box size as a proxy for distance. Accuracy degrades with glasses, non-frontal head angles, and extreme lighting. Error range: ±5–10cm under typical conditions.
2. **Prediction engine** is a linear trend model, not a medical AI. It requires 5+ days of data and should be labeled "Based on your habits" — never "medical advice."
3. **Font scaling** only works on websites using rem-based typography. Websites with hardcoded px sizes will not be affected.
4. **Blue light filter** is a CSS brightness/saturation approximation. It is not equivalent to hardware blue-light filters or medical-grade f.lux.
5. **Outdoor tracking** is not implemented in MVP (no GPS in Chrome extension). It is listed as a future feature.

---

## 18. STATUS.md Template (Agents must fill this in)

```markdown
# STATUS.md

## Module Completion

| Module | Status | Agent | Completed At | Notes |
|---|---|---|---|---|
| A | pending | — | — | — |
| B | pending | — | — | — |
...

## DECISIONS
(Log any spec-ambiguous decisions here)

## BLOCKERS
(Log anything blocking progress)

## TEST RESULTS
(Log test pass/fail results per module)
```

---

*End of SPEC.md — v1.0.0*
