// Extended gesture system — pinch, swipe detection + action mapping
// Works on top of MediaPipe's gesture recognizer output + raw landmarks

const SWIPE_VELOCITY_THRESHOLD = 0.015; // normalized units per ms
const SWIPE_MIN_DISTANCE = 0.12;        // normalized screen units
const PINCH_THRESHOLD = 0.06;           // normalized distance
const PINCH_RELEASE_THRESHOLD = 0.10;
const HISTORY_MAX = 10;

// Per-hand tracking state
const handStates = new Map();

function getState(hand) {
  if (!handStates.has(hand)) {
    handStates.set(hand, {
      positions: [],        // { x, y, z, t } ring buffer for velocity
      pinching: false,
      swipeStart: null,
      lastGesture: null,
      gestureStartTime: 0,
    });
  }
  return handStates.get(hand);
}

function distance2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function palmCenter(landmarks) {
  // Average of wrist (0) and middle MCP (9)
  return {
    x: (landmarks[0].x + landmarks[9].x) / 2,
    y: (landmarks[0].y + landmarks[9].y) / 2,
    z: (landmarks[0].z + landmarks[9].z) / 2,
  };
}

// Returns pinch progress 0-1 (1 = fully pinched)
function getPinchAmount(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const dist = distance2d(thumbTip, indexTip);
  return Math.max(0, Math.min(1, 1 - (dist - PINCH_THRESHOLD) / (PINCH_RELEASE_THRESHOLD - PINCH_THRESHOLD)));
}

// Detect swipe from position history
function detectSwipe(state, now) {
  const positions = state.positions;
  if (positions.length < 5) return null;

  const recent = positions[positions.length - 1];
  const old = positions[Math.max(0, positions.length - 8)];
  const dt = recent.t - old.t;
  if (dt < 50) return null; // need at least 50ms of data

  const dx = recent.x - old.x;
  const dy = recent.y - old.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const velocity = dist / dt;

  if (velocity < SWIPE_VELOCITY_THRESHOLD || dist < SWIPE_MIN_DISTANCE) return null;

  // Determine direction
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > -45 && angle < 45) return "swipe left";    // mirrored
  if (angle > 135 || angle < -135) return "swipe right";  // mirrored
  if (angle > 45 && angle < 135) return "swipe down";
  if (angle > -135 && angle < -45) return "swipe up";

  return null;
}

// Gesture-to-action mapping
const ACTION_MAP = {
  "pinch":       "select",
  "pinch release": "release",
  "open palm":   "dismiss",
  "fist":        "grab",
  "point up":    "cursor",
  "peace":       null,
  "thumbs up":   "confirm",
  "thumbs down": "cancel",
  "I love you":  null,
  "swipe left":  "navigate_left",
  "swipe right": "navigate_right",
  "swipe up":    "navigate_up",
  "swipe down":  "navigate_down",
};

// Gesture event history
const gestureLog = [];

function logGesture(hand, gesture, action) {
  gestureLog.push({ hand, gesture, action, time: Date.now() });
  if (gestureLog.length > HISTORY_MAX) gestureLog.shift();
}

export function getGestureLog() {
  return gestureLog;
}

// Main processing — call once per hand per frame
export function processHand(hand, landmarks, mediapipeGesture, now) {
  const state = getState(hand);
  const center = palmCenter(landmarks);

  // Track position history
  state.positions.push({ x: center.x, y: center.y, z: center.z, t: now });
  if (state.positions.length > 15) state.positions.shift();

  // Pinch detection
  const pinchAmount = getPinchAmount(landmarks);
  const wasPinching = state.pinching;
  state.pinching = pinchAmount > 0.7;

  let gesture = mediapipeGesture;
  let action = ACTION_MAP[gesture] || null;
  let extras = {
    pinchAmount,
    palmPosition: { x: 1 - center.x, y: center.y, z: center.z }, // mirror X
    cursorPosition: { x: 1 - landmarks[8].x, y: landmarks[8].y, z: landmarks[8].z }, // index tip mirrored
  };

  // Override with pinch if detected
  if (state.pinching && !wasPinching) {
    gesture = "pinch";
    action = "select";
    logGesture(hand, gesture, action);
  } else if (!state.pinching && wasPinching) {
    gesture = "pinch release";
    action = "release";
    logGesture(hand, gesture, action);
  } else if (state.pinching) {
    gesture = "pinching";
    action = "drag";
  }

  // Swipe detection (only when not pinching)
  if (!state.pinching) {
    const swipe = detectSwipe(state, now);
    if (swipe && swipe !== state.lastGesture) {
      gesture = swipe;
      action = ACTION_MAP[swipe] || null;
      state.lastGesture = swipe;
      state.gestureStartTime = now;
      logGesture(hand, gesture, action);
      state.positions = []; // reset after swipe
    }
  }

  // Clear stale swipe
  if (state.lastGesture?.startsWith("swipe") && now - state.gestureStartTime > 500) {
    state.lastGesture = null;
  }

  // Log new mediapipe gestures
  if (gesture !== state.lastGesture && !gesture?.startsWith("pinch") && !gesture?.startsWith("swipe")) {
    if (gesture && gesture !== state.lastGesture) {
      state.lastGesture = gesture;
      logGesture(hand, gesture, action);
    }
  }

  return { hand, gesture, action, confidence: 1, ...extras };
}

export function clearStates() {
  handStates.clear();
}
