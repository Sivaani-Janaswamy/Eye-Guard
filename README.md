# EyeGuard — AI Vision Health & Digital Correction System

> Like Grammarly, but for your eyes.

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Version](https://img.shields.io/badge/version-1.4.1-blue)
![License](https://img.shields.io/badge/license-ISC-blue)
![Platform](https://img.shields.io/badge/platform-chrome%20extension-orange)
![TypeScript](https://img.shields.io/badge/typescript-6.0.3-blue)
![MediaPipe](https://img.shields.io/badge/mediapipe-face--mesh-0.4.1633559619-green)

---

## Table of Contents

- [What is EyeGuard](#what-is-eyeguard)
- [Live Demo](#live-demo)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Algorithm Reference](#algorithm-reference)
- [Privacy Architecture](#privacy-architecture)
- [Known Issues & Limitations](#known-issues--limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What is EyeGuard

Myopia (nearsightedness) affects over 2.6 billion people globally, with prevalence projected to reach 50% of the world's population by 2050. The primary risk factors are excessive near-work (screen time), insufficient working distance, reduced blink rate causing dry eye, and poor ambient lighting. Children and young adults are particularly vulnerable as their eyes are still developing.

EyeGuard is a Chrome extension that uses on-device computer vision to monitor your eye health in real-time. It leverages MediaPipe FaceMesh to detect 468 facial landmarks at approximately 30fps, calculating screen distance through inter-ocular distance estimation, tracking blink rate via Eye Aspect Ratio (EAR) algorithm, and measuring ambient lighting from the camera feed. The system computes a daily eye health score (0-100) from four components: screen time, distance, blink rate, and lighting. Smart alerts trigger when metrics fall outside healthy thresholds (e.g., <50cm distance for 10s, <15 blinks/min for 60s, <50 lux for 30s), with cooldown mechanisms to prevent annoyance. A 7/14/30-day prediction engine uses weighted linear regression to forecast risk levels based on habit trends.

EyeGuard's privacy-first architecture ensures all processing happens locally on your device. Raw camera frames are never stored or transmitted—only scalar metrics (distanceCm, blinkRate, lux) are persisted to IndexedDB. Face landmarks are used briefly for real-time calculations and immediately discarded. The extension requires camera access but operates entirely offline, with no cloud dependencies or data transmission. This design complies with India's DPDP Act 2023 and Chrome Web Store camera policies, giving users full control over their biometric data while providing actionable insights to protect their vision health.

---

## Live Demo

![EyeGuard Dashboard](docs/screenshots/dashboard-overview.png)

*Screenshot: EyeGuard dashboard showing 30-day score trend, live session metrics, and prediction card*

![Extension Popup](docs/screenshots/popup-score.png)

*Screenshot: Popup showing today's eye score with 4-component breakdown*

---

## How It Works

### The Pipeline

```
Camera (getUserMedia)
    ↓
Hidden <video id="eyeguard-monitoring-video"> element (640×480)
    ↓
MediaPipe FaceMesh WASM (main-world.ts)
  - 468 face landmarks at ~30fps
  - Eye Aspect Ratio (EAR) for blink detection
    Left eye:  landmarks [362,385,387,263,373,380]
    Right eye: landmarks [33,160,158,133,153,144]
  - Inter-ocular distance for screen distance
    IPD_CM = 6.3cm, FOCAL_PX = 550
    ↓
window.postMessage (EYEGUARD_FRAME)
    ↓
Content Script (overlay.ts)
  - Updates HUD badge
  - Updates status display
  - Forwards to service worker
    ↓
chrome.runtime.sendMessage (SENSOR_FRAME)
    ↓
Service Worker (service-worker.ts)
  - Writes live_stats to IndexedDB every 333ms (~3 FPS)
  - Updates session averages every 25 frames
  - Recomputes daily score via RECOMPUTE_SCORE alarm (1 min interval)
    ↓
IndexedDB (Dexie.js)
  Tables: sessions, scores, alerts, correction, predictions, consent, live_stats, session_data
    ↓
React Dashboard (useLiveQuery)
  - Reactive UI updates
  - 30-day trend chart
  - Prediction engine
```

### Face Detection Detail

EyeGuard uses Google's MediaPipe FaceMesh, a machine learning solution for 3D face landmark detection. The model runs entirely on-device via WebAssembly (WASM), requiring no cloud inference. It detects 468 3D facial landmarks covering the entire face, including eyes, lips, and face contour. The configuration uses `refineLandmarks: true` for more precise eye and lip landmarks, with `minDetectionConfidence: 0.5` and `minTrackingConfidence: 0.5` thresholds. The model files are self-hosted in the extension's `face_mesh/` directory and loaded via the locateFile pattern: `chrome-extension://${EXT_ID}/face_mesh/${file}`. This CSP-compliant approach avoids external CDN dependencies and ensures the extension works offline.

### Blink Detection

Blink detection uses the Eye Aspect Ratio (EAR) algorithm, which measures the ratio between vertical and horizontal eye dimensions. The formula:

```
EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
```

Where p1-p6 are the six eye landmarks forming the eye contour. The threshold is set to 0.21 (calibrated for glasses wearers). A blink is registered when EAR drops below threshold for 2+ consecutive frames (debounce), with a rolling 60-second window to calculate blinks per minute. The implementation uses exponential moving average smoothing on the EAR values to reduce noise from slight facial movements.

### Distance Estimation

Screen distance is estimated using the inter-ocular distance (distance between left and right eye centers):

```
distanceCm = (IPD_CM × FOCAL_PX) / pixelDistance
```

Where:
- IPD_CM = 6.3cm (average human inter-pupillary distance)
- FOCAL_PX = 550 (approximate webcam focal length in pixels)
- pixelDistance = Euclidean distance between landmark[33] (left eye) and landmark[263] (right eye)

The calculation includes a 5-frame moving average for smoothing and clamps results to 15-200cm range. Calibration assumes a standard 640×480 webcam at typical laptop distance. Known error margins: ±5-8cm with glasses, ±8cm with head angles >15° from frontal.

---

## Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CHROME BROWSER                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              WEBPAGE (any tab)                       │   │
│  │                                                      │   │
│  │  ┌─────────────────┐    ┌──────────────────────┐    │   │
│  │  │  main-world.ts  │    │    overlay.ts         │    │   │
│  │  │  (PAGE context) │    │ (CONTENT SCRIPT ctx)  │    │   │
│  │  │                 │    │                       │    │   │
│  │  │ MediaPipe WASM  │    │ HUD Overlay           │    │   │
│  │  │ FaceMesh 468pts │───▶│ Alert Toasts          │    │   │
│  │  │ EAR Blink Calc  │    │ CSS Correction        │    │   │
│  │  │ Distance Est.   │    │ Keepalive Ping        │    │   │
│  │  │                 │    │        │              │    │   │
│  │  │  window.post    │    │  chrome.runtime       │    │   │
│  │  │  Message()      │    │  .sendMessage()       │    │   │
│  │  └─────────────────┘    └──────────┬────────────┘    │   │
│  │         ▲                          │                  │   │
│  │  <video id="eyeguard-monitoring-video">              │   │
│  │   (off-screen, 640×480, opacity: 0.01)              │   │
│  └────────────────────────────────────┼──────────────────┘   │
│                                       │                      │
│  ┌────────────────────────────────────▼──────────────────┐   │
│  │              SERVICE WORKER                           │   │
│  │           (service-worker.ts)                        │   │
│  │                                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │  │Session Track│  │Score Engine  │  │Alert Engine│  │   │
│  │  │frameBuffer[]│  │4-component   │  │5 types     │  │   │
│  │  │25fr updates │  │0-100 formula │  │cooldown    │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────┘  │   │
│  │                                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐                   │   │
│  │  │Prediction   │  │Display       │                   │   │
│  │  │Engine       │  │Corrector     │                   │   │
│  │  │WLS Regression│  │CSS Filters   │                   │   │
│  │  └─────────────┘  └──────────────┘                   │   │
│  │                          │                           │   │
│  │               IndexedDB (Dexie.js)                   │   │
│  │    ┌──────────┬──────────┬──────────┬────────────┐   │   │
│  │    │sessions  │scores    │alerts    │live_stats  │   │   │
│  │    │consent   │correction│predictions│session_data│   │   │
│  │    └──────────┴──────────┴──────────┴────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         REACT DASHBOARD (chrome-extension:// page)   │   │
│  │                                                      │   │
│  │  useLiveQuery (dexie-react-hooks) → reactive updates │   │
│  │  ScoreCard │ TrendChart │ PredictionCard │ CameraTest│   │
│  │  CorrectionPanel │ AlertFeed │ WeeklySummary          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

PRIVACY BOUNDARY: No data crosses this boundary →
Raw frames: NEVER stored | Landmarks: NEVER stored
Only scalar metrics: distanceCm, blinkRate, lux
```

### Module Dependency Graph

```
manifest.json
├── dist/service-worker.js
│   ├── engine/score-engine.ts
│   ├── engine/alert-engine.ts
│   ├── engine/session-tracker.ts
│   ├── prediction/risk-predictor.ts
│   ├── correction/display-corrector.ts
│   └── db/schema.ts
├── dist/content/overlay.js
│   ├── correction/display-corrector.ts
│   └── db/schema.ts
├── dist/main-world.js
│   ├── cv/face-mesh.ts
│   └── cv/blink-detector.ts
└── popup/popup.js
    └── db/schema.ts

dashboard/ (separate Vite app)
├── pages/Dashboard.tsx
├── components/ScoreCard.tsx
├── components/TrendChart.tsx
├── components/PredictionCard.tsx
├── components/CameraTest.tsx
├── components/CorrectionPanel.tsx
├── components/AlertFeed.tsx
└── db/schema.ts (shared via @extension/db alias)
```

---

## Features

### Core Monitoring
- [x] **Real-time face detection** — MediaPipe FaceMesh at ~30fps, 468 landmarks, WASM on-device
- [x] **Screen distance monitoring** — Estimates distance using inter-ocular distance formula, alerts below 50cm for 10s
- [x] **Blink rate tracking** — Eye Aspect Ratio algorithm, 0.21 threshold, 60-second rolling window
- [x] **Ambient light detection** — Lux estimation from video feed, alerts below 50 lux for 30s
- [x] **20-20-20 rule enforcement** — 20-minute timer, non-intrusive toast notification
- [x] **Daily eye health score** — 0-100 scale, 4 components of 25pts each
- [x] **7/14/30-day risk prediction** — Weighted linear regression on score history, 5 confidence levels
- [x] **Digital vision correction** — CSS filter injection: contrast, brightness, blue light, font scaling
- [x] **Smart alerts** — Max 20 alerts/hour, 30s cooldown, auto-dismiss after 10s
- [x] **Draggable HUD** — Persistent positioning, minimize to icon
- [x] **Website dark mode** — CSS invert filter with media protection
- [x] **Privacy-first** — All processing on-device, no frames stored

### Planned (v2)
- [ ] Android native app (CameraX + foreground service)
- [ ] Cross-device score sync (FastAPI backend, optional)
- [ ] Outdoor exposure tracking (GPS integration)
- [ ] Firefox and Safari ports

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| CV Engine | MediaPipe FaceMesh (WASM) | Face landmark detection |
| Extension | Chrome MV3 TypeScript | Platform |
| Build | esbuild | Fast bundling |
| Local DB | Dexie.js + IndexedDB | Reactive data storage |
| Dashboard | React 19 + Vite | Analytics UI |
| Charts | Recharts | Score trend visualization |
| Styling | Tailwind CSS | Dashboard styling |
| ID generation | nanoid | Session/alert IDs |
| Backend (optional) | FastAPI + PostgreSQL | Cloud sync |

---

## Installation

### From Source (Development)

```bash
# 1. Clone the repository
git clone [repo-url]
cd EyeGuard/eyehealth

# 2. Install dashboard dependencies
cd dashboard
npm install

# 3. Install extension dependencies  
cd ../extension
npm install

# 4. Build dashboard first (syncs to extension)
cd ../dashboard
npm run build

# 5. Build extension
cd ../extension
npm run build:ext

# 6. Load in Chrome
# Open chrome://extensions
# Enable "Developer mode"
# Click "Load unpacked"
# Select: EyeGuard/eyehealth/extension
```

### Prerequisites

- Node.js 18+ (tested with v24.12.2)
- npm 9+
- Chrome 120+ (for Manifest V3 support)

### First Run

```
1. Click the EyeGuard icon in Chrome toolbar
2. Click "Allow camera access" — required for monitoring
3. Grant camera permission in the browser prompt
4. EyeGuard HUD appears top-left of every webpage
5. Wait 30 seconds for MediaPipe models to load
6. HUD updates to "Tracking Active" when face is detected
7. Click "View full dashboard" in popup for full analytics
```

---

## Development Setup

### Project Structure

```
EyeGuard/eyehealth/
├── extension/
│   ├── background/
│   │   └── service-worker.ts    # SW + data pipeline
│   ├── content/
│   │   ├── overlay.ts           # Content script + HUD
│   │   └── main-world.ts        # MediaPipe CV pipeline
│   ├── cv/
│   │   ├── face-mesh.ts         # MediaPipe FaceMesh wrapper
│   │   └── blink-detector.ts    # EAR blink detection
│   ├── db/
│   │   ├── schema.ts            # Dexie table definitions
│   │   └── db.ts                # Database singleton
│   ├── engine/
│   │   ├── score-engine.ts      # 4-component scoring (0-100)
│   │   ├── alert-engine.ts      # Threshold-based alerts
│   │   └── session-tracker.ts   # Session state management
│   ├── correction/
│   │   └── display-corrector.ts # CSS filter injection
│   ├── prediction/
│   │   └── risk-predictor.ts    # WLS regression predictor
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.tsx            # Extension popup
│   ├── icons/
│   ├── face_mesh/               # Self-hosted MediaPipe files
│   ├── dist/                    # Build output
│   ├── manifest.json
│   ├── package.json
│   └── tsconfig.json
│
├── dashboard/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Dashboard.tsx    # Main dashboard page
│   │   ├── components/
│   │   │   ├── ScoreCard.tsx
│   │   │   ├── TrendChart.tsx
│   │   │   ├── PredictionCard.tsx
│   │   │   ├── CameraTest.tsx   # Live diagnostics panel
│   │   │   ├── CorrectionPanel.tsx
│   │   │   └── AlertFeed.tsx
│   │   └── App.tsx
│   ├── scripts/
│   │   └── sync-dashboard-to-extension.cjs
│   ├── package.json
│   └── vite.config.ts
│
├── tests/
│   └── cv/
│       └── BENCHMARK_REPORT.md
│
└── README.md                    # This file
```

### Build Commands

```bash
# Development (dashboard hot reload)
cd dashboard && npm run dev

# Production build (always in this order)
cd dashboard && npm run build    # syncs to extension/dist/dashboard
cd extension && npm run build:ext

# Extension build output:
# dist/service-worker.js    ~272kb
# dist/content/overlay.js   ~23kb
# dist/main-world.js        ~138kb
# popup/popup.js            ~1.3mb

# Type checking only (no build)
cd extension && npx tsc --noEmit
cd dashboard && npx tsc --noEmit
```

### Environment Variables (Backend only)

```env
DATABASE_URL=postgresql+asyncpg://...
SUPABASE_JWT_SECRET=...
ENVIRONMENT=development
```

### Debugging

```bash
# View service worker logs
# chrome://extensions → EyeGuard → "service worker" link

# View content script logs
# F12 on any tab → Console → filter "[EyeGuard"

# Inspect IndexedDB
# Service worker console:
db.table('live_stats').get(1).then(console.log)
db.sessions.toArray().then(console.log)
db.scores.orderBy('date').last().then(console.log)

# Force an alert for testing
# Temporarily in alert-engine.ts:
distanceThresholdCm: 200  # triggers on any distance
```

---

## Algorithm Reference

### Scoring Formula

```typescript
// Screen time score (25 pts)
// Full score ≤ 6h, zero at ≥ 12h
screenTimeScore = clamp(25 - max(0, (totalHours - 6)) × 4.17, 0, 25)

// Distance score (25 pts)
// Full score ≥ 60cm, zero at ≤ 30cm
distanceScore = clamp((avgDistanceCm - 30) / 30 × 25, 0, 25)

// Blink score (25 pts)
// Full score ≥ 15 bpm, zero at ≤ 5 bpm
blinkScore = clamp((avgBlinkRate - 5) / 10 × 25, 0, 25)

// Lighting score (25 pts)
// Full score ≥ 200 lux, zero at ≤ 20 lux
lightingScore = clamp((avgLux - 20) / 180 × 25, 0, 25)

// Total
score = round(screenTimeScore + distanceScore + blinkScore + lightingScore)
riskLevel = score ≥ 75 ? "low" : score ≥ 50 ? "moderate" : "high"
```

Example calculation:
| Input | Value | Score Component |
|---|---|---|
| Screen time | 7 hours | 20.8 / 25 |
| Distance | 48cm | 15.0 / 25 |
| Blink rate | 12/min | 17.5 / 25 |
| Lighting | 180 lux | 22.2 / 25 |
| **Total** | | **76 / 100 — Low risk** |

### Alert Thresholds

| Alert Type | Threshold | Cooldown | Message |
|---|---|---|---|
| Distance | < 50cm for 10s | 30s | "You're too close to the screen..." |
| Blink rate | < 15/min for 60s | 3m | "Blink more..." |
| Lighting | < 50 lux for 30s | 5m | "Low light detected..." |
| Usage time | > 20 min | 1m | "20-20-20 break..." |
| Max per hour | 20 alerts | — | Anti-annoyance cap |

### Prediction Engine

```
Algorithm: Weighted Least Squares Linear Regression
Input: Last N days of DailyEyeScore values
Weights: Recent days weighted 2× (1 + i/N)

trendSlope = WLS(scores, weights)
projected  = lastScore + trendSlope × horizonDays
riskLevel  = projected ≥ 75 ? "low" : projected ≥ 50 ? "moderate" : "high"

Confidence by data volume:
< 5 days  → "Not enough data"
5-9 days  → "Early estimate"
10-20 days → "Moderate confidence"
21+ days  → "Based on your habit history"
```

---

## Privacy Architecture

```
DATA CLASSIFICATION TABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Data Type          Stored Locally   Sent to Server   Retention
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Raw camera frames  NEVER            NEVER            N/A
Face landmarks     NEVER            NEVER            N/A
blinkRate (scalar) Yes, per session No               90 days
distanceCm (scalar)Yes, per session No               90 days
Daily EyeScore     Yes              If sync enabled  1 year
Alert history      Yes              No               30 days
Correction profile Yes              If sync enabled  Until deleted
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROCESSING PIPELINE (Privacy Boundary)
Camera → MediaPipe WASM (on-device) → scalar metrics only
                              ↑
                    No raw frames cross this line
```

EyeGuard is designed with privacy as a core principle. All computer vision processing happens entirely on-device using MediaPipe's WebAssembly runtime. Raw camera frames are never written to disk or transmitted—only scalar metrics (distanceCm, blinkRate, lux) are persisted to IndexedDB. Face landmarks are used briefly for real-time calculations and immediately discarded; they are never stored in the database. The extension requires camera access but operates entirely offline with no cloud dependencies. Consent is tracked via versioned ConsentRecord in the database, and users can delete all data via the extension settings. This architecture complies with India's Digital Personal Data Protection Act 2023 and Chrome Web Store camera policies, which prohibit storing or transmitting biometric data without explicit user consent.

---

## Known Issues & Limitations

### Current Limitations

1. **Distance accuracy with glasses** — EAR-based detection has ±5-8cm additional error when subject wears glasses. The focal length calibration assumes average IPD of 6.3cm.

2. **Blink rate stabilization** — Requires ~10 seconds of continuous face detection before blink rate stabilizes. Shows 0 initially during warmup.

3. **Font scaling scope** — CSS font scaling only affects websites using `rem`-based typography. Hardcoded `px` values are unaffected.

4. **Blue light filter** — CSS filter approximation only. Not equivalent to hardware blue-light filters or f.lux.

5. **Outdoor tracking** — Not implemented in v1. GPS unavailable in Chrome extension context.

6. **iOS not supported** — Background camera access restricted by iOS. Extension-only for now.

7. **Service worker lifespan** — MV3 service workers have a 30-second idle timeout. Keepalive ping every 25s mitigates this but SW state resets on wake.

8. **Session continuity** — If service worker sleeps and wakes, in-memory frameBuffer resets. Session averages may be computed from partial data.

### Known Bugs (In Progress)

See STATUS.md (project root) for the latest bug fixes and audit results.

---

## Roadmap

### v1.1 (Current Sprint)
- [x] Simplify CameraTest component (remove FaceMesh dependency)
- [x] Fix APPROX_FOCAL constant (600 → 550)
- [x] Remove production console.log statements
- [x] Add skeleton loading states
- [ ] Add CorrectionPanel → extension message bridge
- [ ] Comprehensive CSP compliance audit

### v2.0 (Next Major)
- [ ] Android native app (Kotlin + CameraX)
- [ ] Cross-device sync via FastAPI backend
- [ ] Real benchmark testing with ground-truth video
- [ ] Firefox extension port

### v3.0 (Future)
- [ ] iOS app (foreground-only monitoring)
- [ ] AI-powered personalized recommendations
- [ ] Healthcare provider integration
- [ ] Research partnership data collection

---

## Contributing

```bash
# Fork and clone
git clone https://github.com/[your-username]/EyeGuard
cd EyeGuard/eyehealth

# Create feature branch
git checkout -b feature/your-feature-name

# Build order (always dashboard first)
cd dashboard && npm run build
cd ../extension && npm run build:ext

# Load extension in Chrome for testing
# chrome://extensions → Load unpacked → select extension/

# Before submitting PR, verify:
cd extension && npx tsc --noEmit   # no TypeScript errors
cd dashboard && npx tsc --noEmit  # no TypeScript errors
```

### Module Ownership

| Module | File | Description |
|---|---|---|
| CV Pipeline | content/main-world.ts | MediaPipe, EAR, distance |
| Content Script | content/overlay.ts | HUD, alerts, camera |
| Data Pipeline | background/service-worker.ts | SW, scoring, DB |
| Score Logic | engine/score-engine.ts | Formula only |
| Alert Logic | engine/alert-engine.ts | Thresholds only |
| Prediction | prediction/risk-predictor.ts | WLS regression |
| Correction | correction/display-corrector.ts | CSS filters |
| Dashboard | dashboard/src/ | React UI |

### Privacy Rules for Contributors

Any PR that violates these will be rejected:
- Raw camera frames must NEVER be stored or transmitted
- Face landmarks must NEVER be persisted to IndexedDB
- Camera access must require ConsentRecord in DB first
- All CV processing must remain in main-world.ts (on-device)

---

## License

ISC License (see LICENSE file for details)

---

## Acknowledgements

- [MediaPipe FaceMesh](https://google.github.io/mediapipe/solutions/face_mesh) — Google
- [Dexie.js](https://dexie.org) — IndexedDB wrapper
- Research: "Global Prevalence of Myopia and High Myopia" — Brien Holden Vision Institute, 2016
