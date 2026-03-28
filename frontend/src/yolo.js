import * as ort from "onnxruntime-web";

const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.45;

const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
  "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
  "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
  "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
  "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
  "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
  "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
];

let session = null;
const offscreen = document.createElement("canvas");
offscreen.width = INPUT_SIZE;
offscreen.height = INPUT_SIZE;
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

export async function loadModel() {
  ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
  session = await ort.InferenceSession.create("/models/yolov8n.onnx", {
    executionProviders: ["wasm"],
  });
  return session;
}

export function preprocess(video, brighten = false) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);
  const dx = (INPUT_SIZE - nw) / 2;
  const dy = (INPUT_SIZE - nh) / 2;

  offCtx.fillStyle = "#808080";
  offCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  if (brighten) {
    offCtx.filter = "brightness(1.6) contrast(1.3)";
  }
  offCtx.drawImage(video, dx, dy, nw, nh);
  offCtx.filter = "none";

  const imageData = offCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imageData.data;
  const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    float32[i] = pixels[i * 4] / 255;                          // R
    float32[INPUT_SIZE * INPUT_SIZE + i] = pixels[i * 4 + 1] / 255; // G
    float32[2 * INPUT_SIZE * INPUT_SIZE + i] = pixels[i * 4 + 2] / 255; // B
  }

  return { tensor: float32, scale, dx, dy };
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a[2] * a[3];
  const areaB = b[2] * b[3];
  return inter / (areaA + areaB - inter);
}

function nms(boxes, scores, threshold) {
  const indices = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const keep = [];
  const suppressed = new Set();

  for (const i of indices) {
    if (suppressed.has(i)) continue;
    keep.push(i);
    for (const j of indices) {
      if (suppressed.has(j) || j === i) continue;
      if (iou(boxes[i], boxes[j]) > threshold) suppressed.add(j);
    }
  }
  return keep;
}

export async function detect(video) {
  if (!session) return [];

  const { tensor, scale, dx, dy } = preprocess(video, true);
  const input = new ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await session.run({ images: input });

  // Output shape: [1, 84, 8400] — 4 box coords + 80 class scores per detection
  const output = results[Object.keys(results)[0]].data;
  const numDetections = 8400;
  const numClasses = 80;

  const boxes = [];
  const scores = [];
  const classIds = [];

  for (let i = 0; i < numDetections; i++) {
    // Find best class
    let maxScore = 0;
    let maxClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = output[(4 + c) * numDetections + i];
      if (score > maxScore) {
        maxScore = score;
        maxClass = c;
      }
    }

    if (maxScore < CONF_THRESHOLD) continue;

    // cx, cy, w, h in letterboxed coords
    const cx = output[0 * numDetections + i];
    const cy = output[1 * numDetections + i];
    const w = output[2 * numDetections + i];
    const h = output[3 * numDetections + i];

    // Convert to original video coords
    const x = (cx - w / 2 - dx) / scale;
    const y = (cy - h / 2 - dy) / scale;
    const bw = w / scale;
    const bh = h / scale;

    boxes.push([x, y, bw, bh]);
    scores.push(maxScore);
    classIds.push(maxClass);
  }

  const keep = nms(boxes, scores, IOU_THRESHOLD);

  return keep.map((i) => ({
    bbox: boxes[i],
    score: scores[i],
    class: COCO_CLASSES[classIds[i]] || `class_${classIds[i]}`,
  }));
}
