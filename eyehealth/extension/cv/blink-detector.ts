/**
 * blink-detector.ts
 * Module D: Tracks Eye Aspect Ratio (EAR) to detect blinks.
 */

// Normalized landmark interface from MediaPipe Face Mesh
export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export class BlinkDetector {
  private history: number[] = []; // Store blink timestamps (unix ms)
  private consecutiveFramesBelowThreshold = 0;
  private isBlinking = false;
  private readonly EAR_THRESHOLD = 0.25;
  private readonly BLINK_FRAMES = 2; // 2+ consecutive frames < 0.25
  private readonly WINDOW_MS = 60000; // 60 seconds rolling window

  private distance(p1: NormalizedLandmark, p2: NormalizedLandmark): number {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  }

  private calculateEAR(eyeLandmarks: NormalizedLandmark[]): number {
    // p1, p2, p3, p4, p5, p6
    const p1 = eyeLandmarks[0];
    const p2 = eyeLandmarks[1];
    const p3 = eyeLandmarks[2];
    const p4 = eyeLandmarks[3];
    const p5 = eyeLandmarks[4];
    const p6 = eyeLandmarks[5];

    // ||p2 - p6||
    const dist2_6 = this.distance(p2, p6);
    // ||p3 - p5||
    const dist3_5 = this.distance(p3, p5);
    // ||p1 - p4||
    const dist1_4 = this.distance(p1, p4);

    return (dist2_6 + dist3_5) / (2.0 * dist1_4);
  }

  /**
   * Evaluates the given landmarks for eye blinking using Eye Aspect Ratio (EAR).
   * Maintains history internally.
   * @param landmarks The array of face landmarks
   * @returns true if a blink triggered successfully on this frame
   */
  public detectBlink(landmarks: NormalizedLandmark[]): boolean {
    // Left eye indices: 362,385,387,263,373,380
    const leftEyeIds = [362, 385, 387, 263, 373, 380];
    const leftEye = leftEyeIds.map((id) => landmarks[id]);

    // Right eye indices: 33,160,158,133,153,144
    const rightEyeIds = [33, 160, 158, 133, 153, 144];
    const rightEye = rightEyeIds.map((id) => landmarks[id]);

    const leftEAR = this.calculateEAR(leftEye);
    const rightEAR = this.calculateEAR(rightEye);

    // Average EAR
    const avgEAR = (leftEAR + rightEAR) / 2.0;

    const now = Date.now();
    let blinkDetectedThisFrame = false;

    if (avgEAR < this.EAR_THRESHOLD) {
      this.consecutiveFramesBelowThreshold++;
    } else {
      // If we recover above threshold and we had 2+ frames below, it's a blink
      if (this.consecutiveFramesBelowThreshold >= this.BLINK_FRAMES && !this.isBlinking) {
        this.history.push(now);
        this.isBlinking = true;
        blinkDetectedThisFrame = true;
      } else if (this.consecutiveFramesBelowThreshold === 0) {
        // Reset blinking state when fully open
        this.isBlinking = false;
      }
      this.consecutiveFramesBelowThreshold = 0;
    }

    // Cleanup old history
    this.history = this.history.filter((t) => now - t <= this.WINDOW_MS);

    return blinkDetectedThisFrame;
  }

  /**
   * Retrieves the number of blinks calculated over the rolling 60-second window.
   * @returns blinks per minute
   */
  public getBlinkRate(): number {
    const now = Date.now();
    this.history = this.history.filter((t) => now - t <= this.WINDOW_MS);

    // Rate per minute. If we haven't been running for a full minute, scale it.
    // However, the spec says "blinks/min, rolling 60s window".
    // For simplicity, we return the count in the last 60s. 
    return this.history.length;
  }
}
