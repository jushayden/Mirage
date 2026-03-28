import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { loadModel, detect as yoloDetect } from "./yolo";
import { loadHandModel, detectHands, processResults, drawHands } from "./hands";
import { HoloScene } from "./scene/HoloScene";

const COLORS = [
  "#00d4ff", "#ff3b8b", "#00ff88", "#ffaa00", "#aa55ff",
  "#ff5555", "#55ffff", "#ffff55", "#ff55ff", "#55ff55",
];

const SMOOTHING = 0.75;

function getColor(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const yoloReady = useRef(false);
  const handsReady = useRef(false);
  const yoloFrameCount = useRef(0);
  const lastYoloPredictions = useRef([]);
  const smoothedBoxes = useRef(new Map());
  const gestureRef = useRef([]);
  const [loadStatus, setLoadStatus] = useState("Loading models...");
  const [cameraReady, setCameraReady] = useState(false);

  // UI state — updated throttled, not every frame
  const [objects, setObjects] = useState([]);
  const [handsCount, setHandsCount] = useState(0);
  const [gestureDisplay, setGestureDisplay] = useState([]);
  const uiUpdateCounter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      // YOLO disabled for performance — hand tracking + 3D only
      // loadModel().then(() => { if (!cancelled) yoloReady.current = true; }),
      loadHandModel().then(() => { if (!cancelled) handsReady.current = true; }),
    ])
      .then(() => { if (!cancelled) setLoadStatus("ready"); })
      .catch(() => setLoadStatus("Failed to load models"));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let stream = null;
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraReady(true);
        }
      } catch {
        setLoadStatus("Camera access denied");
      }
    }
    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const drawYoloBoxes = useCallback((ctx, predictions, canvasWidth) => {
    const currentKeys = new Set();
    const speed = 1 - SMOOTHING;
    const detectedObjects = [];

    for (const pred of predictions) {
      const [x, y, w, h] = pred.bbox;
      const mx = canvasWidth - x - w;
      const key = pred.class;
      currentKeys.add(key);
      detectedObjects.push(`${pred.class} ${Math.round(pred.score * 100)}%`);

      const target = { x: mx, y, w, h };
      const prev = smoothedBoxes.current.get(key);
      let smooth;
      if (prev) {
        smooth = {
          x: lerp(prev.x, target.x, speed),
          y: lerp(prev.y, target.y, speed),
          w: lerp(prev.w, target.w, speed),
          h: lerp(prev.h, target.h, speed),
        };
      } else {
        smooth = target;
      }
      smoothedBoxes.current.set(key, smooth);

      const color = getColor(pred.class);
      const label = `${pred.class} ${Math.round(pred.score * 100)}%`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(smooth.x, smooth.y, smooth.w, smooth.h);
      ctx.font = "13px Inter, system-ui, sans-serif";
      const textWidth = ctx.measureText(label).width;
      const labelY = smooth.y > 26 ? smooth.y - 4 : smooth.y + smooth.h + 18;
      const bgY = smooth.y > 26 ? smooth.y - 24 : smooth.y + smooth.h;
      ctx.fillStyle = color;
      ctx.fillRect(smooth.x, bgY, textWidth + 12, 22);
      ctx.fillStyle = "#000";
      ctx.fillText(label, smooth.x + 6, labelY);
    }

    for (const key of smoothedBoxes.current.keys()) {
      if (!currentKeys.has(key)) smoothedBoxes.current.delete(key);
    }
    return detectedObjects;
  }, []);

  const detect = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detect);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // YOLO disabled — too heavy alongside hand tracking + 3D
    // TODO: re-enable when we move YOLO to a web worker
    let detectedObjects = null;

    // Hand tracking every frame — write to ref, not state
    let numHands = 0;
    let gestureResults = [];
    if (handsReady.current) {
      const now = performance.now();
      const handResults = detectHands(video, now);
      if (handResults && handResults.landmarks?.length > 0) {
        gestureResults = processResults(handResults, now);
        drawHands(ctx, handResults, gestureResults, canvas.width, canvas.height);
        numHands = handResults.landmarks.length;
      }
    }

    // Update ref immediately (3D scene reads this)
    gestureRef.current = gestureResults;

    // Update UI state only every 5th frame to avoid re-render spam
    uiUpdateCounter.current++;
    if (uiUpdateCounter.current % 5 === 0) {
      if (detectedObjects) setObjects(detectedObjects);
      setHandsCount(numHands);
      setGestureDisplay(gestureResults.map((g) => ({
        hand: g.hand,
        gesture: g.gesture,
        action: g.action,
      })));
    }

    animRef.current = requestAnimationFrame(detect);
  }, [drawYoloBoxes]);

  useEffect(() => {
    if (cameraReady && (yoloReady.current || handsReady.current)) {
      setLoadStatus("ready");
      animRef.current = requestAnimationFrame(detect);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [cameraReady, detect]);

  const isRunning = loadStatus === "ready";

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000", position: "relative" }}>
      {/* Fullscreen 3D scene */}
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 100, position: [0, 0, 5] }}
        gl={{ antialias: true, alpha: false, toneMapping: false, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
        frameloop="always"
      >
        <color attach="background" args={["#050505"]} />
        <HoloScene gestureRef={gestureRef} />
      </Canvas>

      {/* Camera feed — bottom right, larger */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          width: "480px",
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
          zIndex: 10,
        }}
      >
        <div style={{ position: "relative" }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              display: "block",
              width: "100%",
              borderRadius: "8px",
              transform: "scaleX(-1)",
              filter: "grayscale(1) contrast(1.1)",
            }}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "6px",
              left: "8px",
              fontSize: "9px",
              fontFamily: "Inter, system-ui, sans-serif",
              letterSpacing: "2px",
              color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase",
            }}
          >
            LIVE
          </div>
        </div>
      </div>

      {/* Status overlay */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "11px",
          letterSpacing: "2px",
          textTransform: "uppercase",
          zIndex: 10,
        }}
      >
        {!isRunning && (
          <div style={{
            background: "rgba(0,0,0,0.5)",
            padding: "6px 12px",
            borderRadius: "4px",
            color: "#888",
          }}>
            {loadStatus}
          </div>
        )}

        {isRunning && (
          <>
            <div style={{
              background: "rgba(0,0,0,0.5)",
              padding: "6px 12px",
              borderRadius: "4px",
              color: objects.length > 0 ? "#999" : "#444",
              borderLeft: "2px solid #555",
            }}>
              {objects.length > 0
                ? `${objects.length} object${objects.length !== 1 ? "s" : ""}: ${objects.join(", ")}`
                : "No objects"
              }
            </div>

            <div style={{
              background: "rgba(0,0,0,0.5)",
              padding: "6px 12px",
              borderRadius: "4px",
              color: handsCount > 0 ? "#ccc" : "#444",
              borderLeft: `2px solid ${handsCount > 0 ? "#fff" : "#333"}`,
            }}>
              {handsCount > 0
                ? `${handsCount} hand${handsCount !== 1 ? "s" : ""}`
                : "No hands"
              }
            </div>

            {gestureDisplay.length > 0 && (
              <div style={{
                background: "rgba(0,0,0,0.5)",
                padding: "6px 12px",
                borderRadius: "4px",
                color: "#fff",
                borderLeft: "2px solid #fff",
              }}>
                {gestureDisplay.map((g) =>
                  `${g.hand}: ${g.gesture}${g.action ? ` → ${g.action}` : ""}`
                ).join(" | ")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
