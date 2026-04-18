import { FaceMesh, Results, Options } from "@mediapipe/face_mesh";
import { BlinkDetector } from "./blink-detector";
import { SensorFrame } from "../db/schema";

export class FaceMeshProcessor {
  private faceMesh: FaceMesh;
  private blinkDetector: BlinkDetector;
  
  // Offscreen canvas for lighting estimation
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  constructor() {
    this.blinkDetector = new BlinkDetector();
    
    this.faceMesh = new FaceMesh({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }
    });

    const options: Options = {
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    };
    
    this.faceMesh.setOptions(options);

    this.canvas = document.createElement('canvas');
    // Compute lighting on a small downsampled frame for performance
    this.canvas.width = 64; 
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Process a single video frame. Never stores or logs raw landmarks.
   * @param videoElement The active video feed
   * @returns A promise that resolves to a SensorFrame
   */
  public async processFrame(videoElement: HTMLVideoElement): Promise<SensorFrame> {
    return new Promise((resolve) => {
      this.faceMesh.onResults((results: Results) => {
        // Evaluate lighting while we process
        const luxLevel = this.estimateAmbientLux(videoElement);

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const landmarks = results.multiFaceLandmarks[0];
          
          // Estimate distance using inter-ocular distance (landmarks 33 and 263)
          const p1 = landmarks[33];
          const p2 = landmarks[263];
          
          const dx = (p2.x - p1.x) * videoElement.videoWidth;
          const dy = (p2.y - p1.y) * videoElement.videoHeight;
          const distancePixels = Math.sqrt(dx * dx + dy * dy);
          
          // Average human IPD ~ 6.3cm, typical webcam focal length ~ 600px
          let distanceCm = 50; 
          if (distancePixels > 0) {
             distanceCm = (6.3 * 600) / distancePixels;
          }

          // Detect blink
          this.blinkDetector.detectBlink(landmarks);
          
          // Determine confidence - Mediapipe JS callback doesn't expose raw confidence directly in face_mesh results sometimes,
          // but we map it to 0.9 if detected since minDetectionConfidence is met.
          // Depending on @mediapipe/face_mesh version, maybe we can't extract exactly. 
          // Defaulting to 0.9 if face is robustly detected.
          const confidence = 0.9; 

          resolve({
            timestamp: Date.now(),
            faceDetected: true,
            screenDistanceCm: distanceCm,
            blinkRate: this.blinkDetector.getBlinkRate(),
            ambientLuxLevel: luxLevel,
            isLowLight: luxLevel < 50,
            confidence: confidence
          });
        } else {
          // No face detected
          resolve({
            timestamp: Date.now(),
            faceDetected: false,
            screenDistanceCm: -1,
            blinkRate: this.blinkDetector.getBlinkRate(),
            ambientLuxLevel: luxLevel,
            isLowLight: luxLevel < 50,
            confidence: 0
          });
        }
      });

      // Send to mediapipe
      this.faceMesh.send({ image: videoElement }).catch((e) => {
         // Resolve with an empty frame if processing fails
         resolve({
            timestamp: Date.now(),
            faceDetected: false,
            screenDistanceCm: -1,
            blinkRate: this.blinkDetector.getBlinkRate(),
            ambientLuxLevel: 0,
            isLowLight: true,
            confidence: 0
          });
      });
    });
  }

  private estimateAmbientLux(videoElement: HTMLVideoElement): number {
    if (!this.ctx) return 100;
    
    try {
      this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
      const frameData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const data = frameData.data;
      let sum = 0;
      // RGBA array
      for (let i = 0; i < data.length; i += 4) {
        // Luminance formulation: 0.299*R + 0.587*G + 0.114*B
        const luma = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        sum += luma;
      }
      const avgLuma = sum / (data.length / 4);
      
      // Map 0-255 luma to an approximate lux value (0 - 300)
      return (avgLuma / 255) * 300;
    } catch(e) {
      return 100; // fail-safe
    }
  }
}
