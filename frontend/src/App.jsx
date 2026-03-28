import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { loadHandModel, detectHands, processResults, drawHands } from "./hands";
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
  const uiUpdateCounter = useRef(0);

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
      setLoadStatus("Loading models...");

      try {
        await loadHandModel();
        handsReady.current = true;
        if (!cancelled) setLoadStatus("ready");
      } catch {
        if (!cancelled) setLoadStatus("Failed to load models");
      }
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

    uiUpdateCounter.current++;
    if (uiUpdateCounter.current % 5 === 0) {
      setHandsCount(numHands);
      setGestureDisplay(gestureResults.map((g) => ({
        hand: g.hand,
        gesture: g.gesture,
        action: g.action,
      })));
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
        <color attach="background" args={["#050505"]} />
        <HoloScene gestureRef={gestureRef} />
      </Canvas>

      {/* Camera feed — bottom right */}
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
              color: "rgba(255,255,255,0.5)",
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
                background: "rgba(0,0,0,0.5)",
                padding: "6px 12px",
                borderRadius: "4px",
                color: "#555",
                borderLeft: "2px solid #333",
              }}>
                Pi Backend
              </div>
            )}

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
