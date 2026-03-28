import { GestureRecognizer, FilesetResolver } from "@mediapipe/tasks-vision";
import { processHand, clearStates } from "./gestures";

let recognizer = null;

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const GESTURE_LABELS = {
  "None": null,
  "Closed_Fist": "fist",
  "Open_Palm": "open palm",
  "Pointing_Up": "point up",
  "Thumb_Down": "thumbs down",
  "Thumb_Up": "thumbs up",
  "Victory": "peace",
  "ILoveYou": "I love you",
};

const HAND_COLORS = {
  Left: { line: "#00ff88", dot: "#00d4ff" },
  Right: { line: "#ff6b9d", dot: "#ffaa00" },
};

// Landmark smoothing — stores previous landmarks per hand
const LANDMARK_SMOOTHING = 0.6; // 0 = no smoothing, 1 = frozen
const smoothedLandmarks = new Map();

function smoothLandmark(handKey, landmarks) {
  const prev = smoothedLandmarks.get(handKey);
  if (!prev) {
    smoothedLandmarks.set(handKey, landmarks.map((lm) => ({ ...lm })));
    return landmarks;
  }

  const speed = 1 - LANDMARK_SMOOTHING;
  const smoothed = landmarks.map((lm, i) => ({
    x: prev[i].x + (lm.x - prev[i].x) * speed,
    y: prev[i].y + (lm.y - prev[i].y) * speed,
    z: prev[i].z + (lm.z - prev[i].z) * speed,
  }));

  smoothedLandmarks.set(handKey, smoothed);
  return smoothed;
}

export async function loadHandModel() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "/models/gesture_recognizer.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.4,
  });
  return recognizer;
}

export function detectHands(video, timestamp) {
  if (!recognizer) return null;
  return recognizer.recognizeForVideo(video, timestamp);
}

export function processResults(results, now) {
  if (!results || !results.landmarks) {
    clearStates();
    smoothedLandmarks.clear();
    return [];
  }

  const processed = [];
  for (let i = 0; i < results.landmarks.length; i++) {
    const handedness = results.handednesses?.[i]?.[0]?.categoryName || "Unknown";
    const topGesture = results.gestures?.[i]?.[0];
    const mediapipeGesture = topGesture
      ? (GESTURE_LABELS[topGesture.categoryName] ?? topGesture.categoryName)
      : null;

    // Smooth landmarks before passing to gesture processor
    const smoothed = smoothLandmark(handedness, results.landmarks[i]);
    const result = processHand(handedness, smoothed, mediapipeGesture, now);
    processed.push(result);
  }
  return processed;
}

export function drawHands(ctx, results, gestureResults, width, height) {
  if (!results || !results.landmarks) return;

  for (let i = 0; i < results.landmarks.length; i++) {
    const handedness = results.handednesses?.[i]?.[0]?.categoryName || "Unknown";
    const colors = HAND_COLORS[handedness] || HAND_COLORS.Left;
    const gestureInfo = gestureResults?.[i];

    // Use smoothed landmarks for drawing
    const landmarks = smoothedLandmarks.get(handedness) || results.landmarks[i];

    // Draw connections
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
      const la = landmarks[a];
      const lb = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(width - la.x * width, la.y * height);
      ctx.lineTo(width - lb.x * width, lb.y * height);
      ctx.stroke();
    }

    // Draw landmarks
    for (const lm of landmarks) {
      const x = width - lm.x * width;
      const y = lm.y * height;
      ctx.fillStyle = colors.dot;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw pinch indicator
    if (gestureInfo && gestureInfo.pinchAmount > 0.3) {
      const thumb = landmarks[4];
      const index = landmarks[8];
      const tx = width - thumb.x * width;
      const ty = thumb.y * height;
      const ix = width - index.x * width;
      const iy = index.y * height;

      ctx.strokeStyle = `rgba(255, 170, 0, ${gestureInfo.pinchAmount})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 170, 0, ${gestureInfo.pinchAmount})`;
      ctx.beginPath();
      ctx.arc((tx + ix) / 2, (ty + iy) / 2, 6 * gestureInfo.pinchAmount, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Draw floating gesture label near wrist
    if (gestureInfo && gestureInfo.gesture) {
      const wrist = landmarks[0];
      const lx = width - wrist.x * width;
      const ly = wrist.y * height + 30;

      const label = gestureInfo.gesture.toUpperCase();
      const actionLabel = gestureInfo.action ? ` → ${gestureInfo.action}` : "";
      const text = label + actionLabel;

      ctx.font = "bold 12px Inter, system-ui, sans-serif";
      const textWidth = ctx.measureText(text).width;

      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(lx - textWidth / 2 - 8, ly - 14, textWidth + 16, 22);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - textWidth / 2 - 8, ly - 14, textWidth + 16, 22);

      ctx.fillStyle = colors.line;
      ctx.fillText(text, lx - textWidth / 2, ly + 2);
    }
  }
}
