# Mirage

A gesture-controlled holographic UI: your hands drive a 3D scene, tracked either in the browser from your webcam or, in the physical hologram rig, by a Logitech camera wired to a Raspberry Pi.

## What it does

- **Hand-tracked 3D** — MediaPipe hand landmarks drive a Three.js holographic scene: a hand cursor, pinch-to-grab, and dual-hand interaction.
- **In-browser object detection** — a YOLO model runs on ONNX Runtime Web inside a Web Worker, so live detection adds no lag to the UI.
- **Two modes** — *browser mode* tracks hands locally from your webcam; *Pi mode* runs the physical hologram rig: a Logitech camera feeds hand tracking to a Raspberry Pi, which drives the digital display that renders the scene shown through the hologram and broadcasts gestures to the frontend over WebSocket.
- Sound design and bloom post-processing.

## Stack

**Frontend** — React · Vite · Three.js (`@react-three/fiber`, `drei`, `postprocessing`) · MediaPipe Tasks Vision · ONNX Runtime Web
**Backend (Raspberry Pi)** — Python · MediaPipe · OpenCV · websockets

## Run it

```bash
# frontend
cd frontend && npm install && npm run dev

# optional Raspberry Pi backend
cd backend && pip install -r requirements.txt && python pi_server.py
```

Deployed on Vercel.
