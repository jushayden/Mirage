import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { loadHandModel, detectHands, processResults, drawHands } from "./hands";
import { loadModel as loadYolo, sendFrame, getResults as getYoloResults, isReady as isYoloReady } from "./yolo";
import { HoloScene } from "./scene/HoloScene";

// Detect if we should use WebSocket backend (Pi mode) or browser camera
const WS_URL = "ws://localhost:9200";

export default function App() {
  const videoRef = useRef(null);
  const feedImgRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const handsReady = useRef(false);
  const gestureRef = useRef([]);
  const wsRef = useRef(null);

  const [loadStatus, setLoadStatus] = useState("Connecting...");
  const [cameraReady, setCameraReady] = useState(false);
  const [mode, setMode] = useState(null); // "browser" or "backend"
  const [handsCount, setHandsCount] = useState(0);
  const [gestureDisplay, setGestureDisplay] = useState([]);
  const [objects, setObjects] = useState([]);
  const uiUpdateCounter = useRef(0);
  const yoloFrameCounter = useRef(0);

  // Try WebSocket first, fall back to browser camera
  useEffect(() => {
    let cancelled = false;
    let ws = null;

    function tryWebSocket() {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      const timeout = setTimeout(() => {
        // WebSocket didn't connect in 2s, fall back to browser
        ws.close();
        if (!cancelled) startBrowserMode();
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        if (!cancelled) {
          setMode("backend");
          setLoadStatus("ready");
          console.log("Connected to Pi backend");
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Update camera frame
          if (data.frame && feedImgRef.current) {
            feedImgRef.current.src = data.frame;
          }

          // Update gesture data
          const gestures = data.gestures || [];
          gestureRef.current = gestures;

          // Throttled UI updates
          uiUpdateCounter.current++;
          if (uiUpdateCounter.current % 3 === 0) {
            setHandsCount(data.hands?.length || 0);
            setGestureDisplay(gestures.map((g) => ({
              hand: g.hand,
              gesture: g.gesture,
              action: g.action,
            })));
          }
        } catch {}
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        if (!cancelled && !mode) startBrowserMode();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
      };
    }

    async function startBrowserMode() {
      if (cancelled) return;
      setMode("browser");
      setLoadStatus("Loading hand tracking...");

      try {
        await loadHandModel();
        handsReady.current = true;
        if (!cancelled) setLoadStatus("ready");
      } catch {
        if (!cancelled) setLoadStatus("Failed to load models");
      }

      // Load YOLO in background — non-blocking, doesn't delay startup
      loadYolo()
        .then(() => console.log("YOLO ready (Web Worker)"))
        .catch(() => console.warn("YOLO failed to load — continuing without object detection"));
    }

    tryWebSocket();

    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
  }, []);

  // Start browser camera (only in browser mode)
  useEffect(() => {
    if (mode !== "browser") return;
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
  }, [mode]);

  // Browser-mode detection loop
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

    gestureRef.current = gestureResults;

    // YOLO — send frame to worker every 10th frame (non-blocking)
    if (isYoloReady()) {
      yoloFrameCounter.current++;
      if (yoloFrameCounter.current % 10 === 0) {
        sendFrame(video);
      }

      // Draw latest YOLO results (from previous worker response)
      const yoloPreds = getYoloResults();
      if (yoloPreds.length > 0) {
        for (const pred of yoloPreds) {
          const [x, y, w, h] = pred.bbox;
          const mx = canvas.width - x - w;
          ctx.strokeStyle = "rgba(100,180,255,0.4)";
          ctx.lineWidth = 1;
          ctx.strokeRect(mx, y, w, h);

          const label = `${pred.class} ${Math.round(pred.score * 100)}%`;
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(100,180,255,0.5)";
          ctx.fillText(label, mx + 4, y > 14 ? y - 4 : y + h + 12);
        }
      }
    }

    uiUpdateCounter.current++;
    if (uiUpdateCounter.current % 5 === 0) {
      setHandsCount(numHands);
      setGestureDisplay(gestureResults.map((g) => ({
        hand: g.hand,
        gesture: g.gesture,
        action: g.action,
      })));
      if (isYoloReady()) {
        setObjects(getYoloResults().map((p) => `${p.class} ${Math.round(p.score * 100)}%`));
      }
    }

    animRef.current = requestAnimationFrame(detect);
  }, []);

  // Start browser detection loop when ready
  useEffect(() => {
    if (mode === "browser" && cameraReady && handsReady.current) {
      setLoadStatus("ready");
      animRef.current = requestAnimationFrame(detect);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [cameraReady, detect, mode]);

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
        <color attach="background" args={["#030508"]} />
        <HoloScene gestureRef={gestureRef} />
        <EffectComposer>
          <Bloom
            intensity={0.8}
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.3} darkness={0.85} />
        </EffectComposer>
      </Canvas>

      {/* Scanline overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,20,40,0.04) 2px, rgba(0,20,40,0.04) 4px)",
          zIndex: 1,
        }}
      />

      {/* Noise/grain overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.03,
          background: "url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJuIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC43IiBudW1PY3RhdmVzPSI0IiBzdGl0Y2hUaWxlcz0ic3RpdGNoIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsdGVyPSJ1cmwoI24pIi8+PC9zdmc+)",
          zIndex: 1,
        }}
      />

      {/* Camera feed — bottom right */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          width: "480px",
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid rgba(100,180,255,0.15)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.6), 0 0 15px rgba(80,160,255,0.08)",
          zIndex: 10,
        }}
      >
        <div style={{ position: "relative" }}>
          {mode === "browser" ? (
            <>
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
            </>
          ) : (
            <img
              ref={feedImgRef}
              alt=""
              style={{
                display: "block",
                width: "100%",
                borderRadius: "8px",
                filter: "grayscale(1) contrast(1.1)",
                minHeight: "270px",
                background: "#111",
              }}
            />
          )}
          <div
            style={{
              position: "absolute",
              top: "6px",
              left: "8px",
              fontSize: "9px",
              fontFamily: "Inter, system-ui, sans-serif",
              letterSpacing: "2px",
              color: "rgba(100,180,255,0.5)",
              textTransform: "uppercase",
            }}
          >
            {mode === "backend" ? "PI FEED" : "LIVE"}
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
            {mode === "backend" && (
              <div style={{
                background: "rgba(0,8,16,0.6)",
                padding: "6px 12px",
                borderRadius: "4px",
                color: "#4488aa",
                borderLeft: "2px solid #2a5566",
              }}>
                Pi Backend
              </div>
            )}

            <div style={{
              background: "rgba(0,8,16,0.6)",
              padding: "6px 12px",
              borderRadius: "4px",
              color: handsCount > 0 ? "#88ccee" : "#334455",
              borderLeft: `2px solid ${handsCount > 0 ? "#5599bb" : "#1a2a33"}`,
            }}>
              {handsCount > 0
                ? `${handsCount} hand${handsCount !== 1 ? "s" : ""}`
                : "No hands"
              }
            </div>

            {gestureDisplay.length > 0 && (
              <div style={{
                background: "rgba(0,8,16,0.6)",
                padding: "6px 12px",
                borderRadius: "4px",
                color: "#aaddff",
                borderLeft: "2px solid #5599cc",
              }}>
                {gestureDisplay.map((g) =>
                  `${g.hand}: ${g.gesture}${g.action ? ` → ${g.action}` : ""}`
                ).join(" | ")}
              </div>
            )}

            {objects.length > 0 && (
              <div style={{
                background: "rgba(0,8,16,0.6)",
                padding: "6px 12px",
                borderRadius: "4px",
                color: "#6699aa",
                borderLeft: "2px solid #334d55",
                fontSize: "10px",
              }}>
                {objects.length} object{objects.length !== 1 ? "s" : ""}: {objects.join(", ")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
