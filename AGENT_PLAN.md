# AGENT_PLAN.md — How to Build EyeGuard with AI Agents on Antigravity

> This file tells you exactly what to do in Antigravity, in what order, and what to say to each agent.

---

## What is Antigravity?

Antigravity lets you run multiple AI coding agents in parallel — each agent gets a task, reads your files, writes code, and you review/merge. Think of it like having 5 junior devs working simultaneously, each on one part of your app.

---

## Pre-Flight Checklist (Do This Before Spawning Any Agents)

- [x] Create a new Antigravity project called `eyeguard`
- [x] Upload `SPEC.md` to the project root — this is the bible every agent reads
- [x] Create an empty `STATUS.md` using the template in SPEC.md Section 18
- [x] Run this setup script to scaffold the correct structure:
  ```bash
  # Extension — plain TypeScript bundled with esbuild (NOT Vite — extensions have no dev server)
  mkdir -p eyehealth/extension/{background,content,popup,cv,engine,correction,prediction,db,icons}
  cd eyehealth/extension
  npm init -y
  npm install dexie nanoid
  npm install -D typescript @types/chrome esbuild
  # Create tsconfig.json for the extension:
  echo '{
    "compilerOptions": {
      "target": "ES2020",
      "module": "ES2020",
      "moduleResolution": "bundler",
      "strict": true,
      "outDir": "dist",
      "lib": ["ES2020", "DOM"]
    },
    "include": ["**/*.ts"]
  }' > tsconfig.json

  # Dashboard — this IS a Vite/React app (opened as a standalone tab, not injected)
  cd ../..
  npm create vite@latest eyehealth/dashboard -- --template react-ts
  cd eyehealth/dashboard
  npm install dexie recharts
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p
  ```
- [ ] Add `@mediapipe/face_mesh` to `eyehealth/extension/package.json` dependencies

---

## Phase 1 — Foundation (Run These Sequentially, Not in Parallel)

These three modules must be built in order because everything else depends on them.

---

### Agent 1A — Database Schema + Service Worker

**When to run:** First. Nothing else starts until this is done.

**Antigravity prompt:**
```
You are building Module A of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task:
1. Create `extension/db/schema.ts` — the Dexie.js IndexedDB schema using the exact interfaces from SPEC.md Section 5.
2. Create `extension/db/db.ts` — export a singleton `db` instance of EyeGuardDB.
3. Create `extension/background/service-worker.ts` — MV3 service worker skeleton that:
   - Listens for chrome.runtime.onInstalled (initialize DB)
   - Listens for chrome.alarms.onAlarm (trigger daily score computation at midnight)
   - Handles messages from content script: START_SESSION, END_SESSION, LOG_ALERT
   - Runs a consent check on startup — if no ConsentRecord exists, opens the popup

Rules:
- Use the exact TypeScript interfaces from SPEC.md Section 5.
- Use nanoid() for all ID generation.
- No raw camera frames or face landmarks are ever stored anywhere.
- After completing, update STATUS.md: set Module A to "complete", log any decisions made.
```

**What you should get:** `db/schema.ts`, `db/db.ts`, `background/service-worker.ts`

**Review checklist:**
- [X] All 6 Dexie tables match SPEC.md Section 12
- [X] Service worker handles all 3 message types
- [X] No biometric fields in the schema

---

### Agent 1D — CV Pipeline (MediaPipe)

**When to run:** After Module A is complete.

**Antigravity prompt:**
```
You are building Module D of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task:
1. Create `extension/cv/face-mesh.ts` — wraps MediaPipe FaceMesh WASM:
   - Initializes FaceMesh with refineLandmarks: true
   - Exposes processFrame(videoElement): Promise<SensorFrame>
   - Estimates screenDistanceCm using inter-ocular distance from landmarks (landmarks 33 and 263)
   - Returns SensorFrame (see SPEC.md Section 5) — confidence field is MediaPipe's detection confidence
   - NEVER stores or logs the landmarks array itself

2. Create `extension/cv/blink-detector.ts`:
   - Tracks Eye Aspect Ratio (EAR) using landmarks: left eye (362,385,387,263,373,380), right eye (33,160,158,133,153,144)
   - EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
   - Blink threshold: EAR < 0.25 for 2+ consecutive frames
   - Maintains a 60-second rolling window to compute blinks/min
   - Exposes: detectBlink(landmarks): boolean, getBlinkRate(): number

Privacy rule: landmarks are used for computation only. They are passed in and used transiently. Never log, store, or transmit them.

After completing, update STATUS.md.
```

**What you should get:** `cv/face-mesh.ts`, `cv/blink-detector.ts`

**Review checklist:**
- [X] EAR formula matches the landmark indices listed above
- [X] No `console.log(landmarks)` anywhere
- [X] `processFrame` returns SensorFrame, not raw landmark data

---

### Agent 1E — Session Tracker + Score Engine

**When to run:** After Modules A and D are complete.

**Antigravity prompt:**
```
You are building Module E of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task:
1. Create `extension/engine/session-tracker.ts`:
   - startSession(): creates a SessionRecord in IndexedDB with nanoid sessionId
   - endSession(sessionId): calculates duration, avgDistanceCm, avgBlinkRate, avgLuxLevel from buffered SensorFrames, writes to DB
   - addFrame(frame: SensorFrame): appends to in-memory buffer (not DB)
   - getActiveSession(): returns current SessionRecord or null

2. Create `extension/engine/score-engine.ts`:
   - computeDailyScore(sessions: SessionRecord[]): DailyEyeScore — use EXACT algorithm from SPEC.md Section 6
   - getTodayScore(): Promise<DailyEyeScore> — fetches today's sessions from DB, computes score
   - getScoreHistory(days: number): Promise<DailyEyeScore[]>
   - Implement clamp() and weightedAvg() as specified in Section 6

Use the exact scoring formula from SPEC.md Section 6. Do not invent your own weights.

After completing, update STATUS.md.
```

**What you should get:** `engine/session-tracker.ts`, `engine/score-engine.ts`

---

## Phase 2 — Core Features (Run These in Parallel After Phase 1)

All three agents below can run simultaneously in Antigravity.

---

### Agent 2F — Alert Engine

**Antigravity prompt:**
```
You are building Module F of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task — create `extension/engine/alert-engine.ts`:
- evaluateFrame(frame: SensorFrame, sessionDurationMs: number): AlertEvent | null
  Checks all thresholds from SPEC.md Section 7 DEFAULT_THRESHOLDS.
  Returns an AlertEvent if any threshold is breached, null otherwise.
  Enforces cooldown (no same alert type within alertCooldownSeconds).
  Enforces maxAlertsPerHour cap.

- Use the EXACT alert message strings from SPEC.md Section 7 ALERT_MESSAGES.
- dismissAlert(alertId): marks alert dismissed in DB
- snoozeAlert(alertId, minutes): sets snoozedUntil timestamp

After completing, update STATUS.md.
```

---

### Agent 2G — Digital Correction

**Antigravity prompt:**
```
You are building Module G of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task — create `extension/correction/display-corrector.ts`:
- applyCorrection(profile: CorrectionProfile): void
  Injects CSS filter string onto document.documentElement
  Use buildFilterString() from SPEC.md Section 9

- applySharpness(level: number): void
  Injects an SVG feConvolveMatrix filter as a hidden SVG in the body
  Applies it to html via filter: url(#eyeguard-sharpen)
  level 0 = identity matrix, level 1 = strong sharpen kernel:
  [0,-1,0,-1,9,-1,0,-1,0]

- applyFontScale(factor: number): void
  Sets document.documentElement.style.fontSize = `${factor * 16}px`

- removeCorrection(): void — removes all injected filters

- Export CORRECTION_PRESETS from SPEC.md Section 9

After completing, update STATUS.md.
```

---

### Agent 2B — Content Script Overlay

**Antigravity prompt:**
```
You are building Module B of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task — create `extension/content/overlay.ts`:
This is the content script that runs on every page.

1. Alert overlay: injectAlert(alert: AlertEvent): void
   - Creates a floating div (bottom-right, z-index 999999)
   - Shows alert.message with a dismiss button and a snooze (5min) button
   - Auto-dismisses after 8 seconds if no interaction
   - Styled minimally: white card, soft shadow, 14px sans-serif, max-width 320px
   - Must not interfere with page layout (position: fixed)

2. Starts the camera + MediaPipe loop:
   - Requests camera only if consent exists (check IndexedDB ConsentRecord)
   - Creates a hidden <video> element for the webcam feed
   - Calls face-mesh.ts processFrame() every 200ms (5fps)
   - Sends resulting SensorFrame to service worker via chrome.runtime.sendMessage

3. Listens for messages from service worker:
   - SHOW_ALERT → call injectAlert()
   - APPLY_CORRECTION → call display-corrector.ts applyCorrection()
   - REMOVE_CORRECTION → call display-corrector.ts removeCorrection()

Privacy: camera is ONLY started if a valid ConsentRecord exists in IndexedDB.

After completing, update STATUS.md.
```

---

## Phase 3 — Intelligence + UI (Parallel After Phase 2)

---

### Agent 3H — Prediction Engine

**Antigravity prompt:**
```
You are building Module H of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task — create `extension/prediction/risk-predictor.ts`:
- predictRisk(history: DailyEyeScore[], horizon: "7d"|"14d"|"30d"): PredictionResult
  Implement weighted linear regression from SPEC.md Section 10.1
  Use confidence calibration from SPEC.md Section 10.2 — confidence must map to the UI Label strings, not raw floats.

- extractKeyFactors(history: DailyEyeScore[]): string[]
  Returns top 3 human-readable strings explaining the trend.
  Example outputs:
  - "Blink rate averaged 11 bpm this week (target: 15+)"
  - "Screen distance below 45cm on 5 of the last 7 days"
  - "Daily score dropped 8 points over the past week"

IMPORTANT: PredictionResult must include a disclaimer field:
  disclaimer: "This is a habit trend indicator, not medical advice."

After completing, update STATUS.md.
```

---

### Agent 3C — Popup UI

**Antigravity prompt:**
```
You are building Module C of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task — create the Chrome extension popup:
Files: `extension/popup/popup.html`, `extension/popup/popup.tsx`

The popup (400x500px) must show:
1. Today's EyeScore (large number, color: green ≥75, amber 50–74, red <50)
2. Score breakdown bar (4 components, each out of 25)
3. Current session duration + blink rate + distance
4. Quick correction preset buttons: Off / Office / Night
5. A "View Dashboard" link (opens dashboard/index.html in new tab)
6. Monitoring toggle (on/off) — sends STOP_MONITORING or START_MONITORING to service worker
7. Settings gear icon → shows alert threshold sliders

Read data from IndexedDB via db.ts (imported directly).
Use the exact color thresholds: green ≥75, amber 50–74, red <50.

After completing, update STATUS.md.
```

---

### Agent 3I — Dashboard

**Antigravity prompt:**
```
You are building Module I of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task — build the React dashboard in `dashboard/src/`:

Pages and components to create:
1. Dashboard.tsx — main layout with 4 sections
2. ScoreCard.tsx — today's score + risk level badge
3. TrendChart.tsx — 30-day score history line chart using Recharts
4. AlertFeed.tsx — last 10 alerts with dismiss buttons
5. CorrectionPanel.tsx — sliders for all 4 correction settings + preset buttons
6. PredictionCard.tsx — shows PredictionResult with confidence label (use UI Label strings from SPEC.md Section 10.2, not raw floats)

Seed the dashboard with synthetic data if IndexedDB is empty.
Label synthetic data clearly: "Demo data — connect the extension to see real stats"

The prediction card MUST show the disclaimer:
"This is a habit trend indicator, not medical advice."

Read all data from IndexedDB via db.ts.
Use Recharts for charts, Tailwind for styling.

After completing, update STATUS.md.
```

---

## Phase 4 — Quality

### Agent 4K — CV Benchmarks

**Antigravity prompt:**
```
You are building Module K of the EyeGuard project.

Read SPEC.md completely before writing any code.

Your task:
1. Create `tests/cv/blink_accuracy.test.ts`:
   - Implement the benchmark test runner using BenchmarkLabel from SPEC.md Section 8.2
   - If fixture videos are not available, generate synthetic SensorFrame sequences that simulate known blink events
   - Report accuracy as: detected_blinks / ground_truth_blinks

2. Create `tests/cv/fixtures/labels.json`:
   - Provide 4 synthetic test cases (one per condition from SPEC.md Section 8.1)
   - Each with realistic numbers for a synthetic 60-second session

3. Create `tests/cv/BENCHMARK_REPORT.md`:
   - Fill in the benchmark table from SPEC.md Section 8.1
   - If using synthetic data, label results as "Synthetic baseline — real-device testing recommended"
   - Include a section: "Limitations and Conditions for Accuracy Degradation"

4. Create `extension/engine/generateSyntheticData.ts`:
   - Implements generateSyntheticBenchmarkData(days: number): SessionRecord[]
   - Produces 14 days of realistic sessions with natural variance
   - Clearly exports a isSyntheticData: true flag on each record

After completing, update STATUS.md.
```

---

## Parallelization Map (Visual Summary)

```
DAY 1
  [sequential]  Agent 1A → Agent 1D → Agent 1E

DAY 2
  [parallel]    Agent 2F + Agent 2G + Agent 2B (all at once)

DAY 3
  [parallel]    Agent 3H + Agent 3C + Agent 3I (all at once)

DAY 4
  [sequential]  Agent 4K (benchmarks)
  [optional]    Agent J (backend, only if you need cloud sync)

DAY 5
  Integration testing + demo polish
```

---

## Integration Steps (You Do These Between Phases)

After Phase 1, verify manually:
- Open Chrome DevTools → Application → IndexedDB → check EyeGuardDB tables exist

After Phase 2, verify manually:
- Load the extension, grant camera, check that SensorFrames are flowing (service worker console logs)
- Trigger a fake alert by temporarily setting `distanceThresholdCm: 200` in config

After Phase 3, verify manually:
- Open popup, check score renders
- Open dashboard, check 30-day chart renders with synthetic data

---

## Common Agent Mistakes to Watch For

When reviewing agent output, check for these:

| Mistake | Where to Look | Fix |
|---|---|---|
| Storing landmarks in DB | db/schema.ts, cv/*.ts | Remove any landmark fields from stored types |
| Using random score weights | engine/score-engine.ts | Re-check against SPEC.md Section 6 exactly |
| Wrong alert messages | engine/alert-engine.ts | Compare to SPEC.md Section 7 ALERT_MESSAGES |
| Confidence shown as raw float | prediction/*.ts, popup, dashboard | Map to UI Label strings from Section 10.2 |
| Camera started without consent | content/overlay.ts | Add ConsentRecord check before getUserMedia |
| Missing disclaimer on prediction | dashboard/PredictionCard.tsx | Must show "not medical advice" text |

---

## Final Demo Checklist

Before showing to judges or an interviewer:

- [ ] Extension loads without errors in Chrome
- [ ] Camera permission prompt shows privacy explanation
- [ ] Popup shows today's score (or "Demo data" if no real session)
- [ ] At least one alert fires during a live demo (reduce threshold temporarily)
- [ ] Dashboard shows 14-day trend chart with synthetic data
- [ ] Prediction card shows confidence label (not a raw number)
- [ ] Prediction card shows "not medical advice" disclaimer
- [ ] BENCHMARK_REPORT.md exists and is readable
- [ ] Privacy architecture section is in README

---

*End of AGENT_PLAN.md*
