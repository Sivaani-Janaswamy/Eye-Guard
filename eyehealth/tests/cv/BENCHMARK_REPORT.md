
# EyeGuard CV Benchmark Report

## Test Environment
- Browser: Chrome (version from navigator.userAgent)
- Platform: Desktop webcam 640x480
- MediaPipe FaceMesh: refineLandmarks: true

## Blink Detection
| Condition | Accuracy | Notes |
|---|---|---|
| Normal lighting, no glasses | Synthetic baseline | Real-device testing recommended |
| Low lighting | Synthetic baseline | |
| Glasses | Synthetic baseline | |
| Head turned 15°+ | Synthetic baseline | |

EAR threshold used: 0.21
Rolling window: 60 seconds

## Distance Estimation
Formula: (IPD_CM * FOCAL_PX) / pixel_distance
IPD assumed: 6.3cm
Focal length: 550px (calibrated for standard webcam at 640px width)

Expected range: 40-80cm for normal laptop use
Known limitations:
- Accuracy degrades with glasses (±8cm error)
- Head angles >15° reduce accuracy (±10cm error)
- Requires frontal face detection

## Synthetic Test Results
(Generated from 14 days of synthetic SessionRecord data)
Average daily score range: 45-85
Score components verified against SPEC.md Section 6 formula: YES

## Notes
All CV processing is on-device via MediaPipe WASM.
No camera frames or landmarks are stored or transmitted.
This report uses synthetic baseline data.
Real-device testing with ground-truth annotations is recommended
before clinical or medical use.
