# Mirage

A gesture-controlled holographic UI. Your hands drive a 3D scene — no mouse, no controller. Hand tracking runs either in the browser from your webcam or on a Raspberry Pi camera that streams gestures over WebSocket.

## What it does

- **Hand-tracked 3D** — MediaPipe hand landmarks drive a Three.js holographic scene: a hand cursor, pinch-to-grab, and dual-hand interaction.
- **In-browser object detection** — a YOLO model runs on ONNX Runtime Web inside a Web Worker, so live detection adds no lag to the UI.
- **Two modes** — *browser mode* tracks hands locally from the webcam; *Pi mode* offloads tracking to a Raspberry Pi backend that broadcasts gestures over WebSocket.
- Sound design and bloom post-processing for the holographic feel.

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
