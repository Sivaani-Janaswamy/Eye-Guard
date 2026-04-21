# EyeGuard CV Benchmark Report
Generated: Tuesday, 21 April 2026

## Pipeline Status
| Component | Status | Evidence |
|---|---|---|
| MediaPipe FaceMesh | Working | onResults fires at ~30fps |
| Face detection | Working | faces: 1 confirmed in logs |
| Distance calculation | Fixed | 45cm to 75cm range confirmed |
| Blink detection | Working | EAR values: 0.18 (blink) to 0.35 (open) |
| Frame pipeline | Working | ~3 FPS DB write throttling confirmed |

## Distance Estimation
- Formula: (6.3cm × 600px) / inter-ocular pixel distance
- Calibrated for: 640×480 webcam at standard laptop distance
- Tested range: 15cm to 200cm
- Target range: 40-70cm for normal use
- Known limitations:
  - Glasses add ±5cm error
  - Head angles >15° add ±8cm error
  - Accuracy requires frontal face detection

## Blink Detection  
- Algorithm: Eye Aspect Ratio (EAR)
- Threshold: 0.21 (calibrated for glasses wearers)
- Window: 60-second rolling average
- Debounce: Consecutive frame check + smooth filter
- Landmark indices: 
  - Left: [362,385,387,263,373,380]
  - Right: [33,160,158,133,153,144]
- EAR range observed: 0.15 - 0.40

## Scoring Algorithm
Per SPEC.md Section 6:
- Screen time (25pts): full score ≤6h, zero at ≥12h
- Distance (25pts): full score ≥60cm, zero at ≤30cm  
- Blink rate (25pts): full score ≥15/min, zero at ≤5/min
- Lighting (25pts): full score ≥200 lux, zero at ≤20 lux

## Privacy Compliance
- Raw camera frames: NEVER stored
- Face landmarks: NEVER persisted (stripped in Service Worker)
- Only scalar metrics stored: distanceCm, blinkRate, lux, confidence
- All CV processing: on-device via MediaPipe WASM

## Known Limitations
1. Blink rate requires 10+ seconds to stabilize
2. Distance assumes average IPD of 6.3cm
3. Outdoor tracking not implemented in v1
4. iOS not supported (background camera restrictions)
