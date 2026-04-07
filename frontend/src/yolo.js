// YOLO wrapper — sends frames to Web Worker, receives results
// Main thread never blocks on inference

import YoloWorker from "./yolo.worker.js?worker";

const INPUT_SIZE = 640;

let worker = null;
let ready = false;
let latestResults = [];
let onReady = null;
let busy = false;

const offscreen = document.createElement("canvas");
offscreen.width = INPUT_SIZE;
offscreen.height = INPUT_SIZE;
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

export function loadModel() {
  return new Promise((resolve, reject) => {
    worker = new YoloWorker();

    worker.onmessage = (e) => {
      if (e.data.type === "ready") {
        ready = true;
        resolve();
      } else if (e.data.type === "results") {
        latestResults = e.data.predictions;
        busy = false;
      } else if (e.data.type === "error") {
        reject(new Error(e.data.message));
      }
    };

    worker.onerror = (e) => reject(e);
  });
}

// Send a frame to the worker for detection (non-blocking)
export function sendFrame(video) {
  if (!ready || !worker || busy) return;
  if (!video || video.readyState < 2) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);
  const dx = (INPUT_SIZE - nw) / 2;
  const dy = (INPUT_SIZE - nh) / 2;

  // Letterbox + brighten on main thread (fast canvas ops)
  offCtx.fillStyle = "#808080";
  offCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  offCtx.filter = "brightness(1.4) contrast(1.2)";
  offCtx.drawImage(video, dx, dy, nw, nh);
  offCtx.filter = "none";

  const imageData = offCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  busy = true;
  worker.postMessage(
    { type: "detect", imageData: imageData.data, videoWidth: vw, videoHeight: vh },
    [imageData.data.buffer] // transfer ownership for zero-copy
  );
}

// Get latest results (non-blocking, returns whatever we have)
export function getResults() {
  return latestResults;
}

export function isReady() {
  return ready;
}
