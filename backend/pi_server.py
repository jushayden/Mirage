#!/usr/bin/env python3
"""
Mirage Pi Backend — captures CSI camera, runs MediaPipe gesture recognition,
sends results over WebSocket to the browser frontend.
"""

import asyncio
import base64
import json
import time

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
import websockets

# Config
WS_HOST = "0.0.0.0"
WS_PORT = 9200
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
FRAME_SEND_INTERVAL = 3  # send camera frame every N frames
MODEL_PATH = "gesture_recognizer.task"

# MediaPipe gesture labels
GESTURE_LABELS = {
    "None": None,
    "Closed_Fist": "fist",
    "Open_Palm": "open palm",
    "Pointing_Up": "point up",
    "Thumb_Down": "thumbs down",
    "Thumb_Up": "thumbs up",
    "Victory": "peace",
    "ILoveYou": "I love you",
}


class MirageBackend:
    def __init__(self):
        self.clients = set()
        self.running = False
        self.cap = None
        self.recognizer = None
        self.frame_count = 0

    def setup_camera(self):
        """Open camera — tries picamera2 first, falls back to OpenCV."""
        try:
            from picamera2 import Picamera2
            self.picam = Picamera2()
            config = self.picam.create_preview_configuration(
                main={"size": (CAMERA_WIDTH, CAMERA_HEIGHT), "format": "RGB888"}
            )
            self.picam.configure(config)
            self.picam.start()
            self.use_picamera = True
            print(f"Camera opened (picamera2) at {CAMERA_WIDTH}x{CAMERA_HEIGHT}")
        except Exception as e:
            print(f"picamera2 not available ({e}), trying OpenCV...")
            self.cap = cv2.VideoCapture(0)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
            if not self.cap.isOpened():
                raise RuntimeError("Failed to open camera")
            self.use_picamera = False
            print(f"Camera opened (OpenCV) at {CAMERA_WIDTH}x{CAMERA_HEIGHT}")

    def read_frame(self):
        if self.use_picamera:
            frame = self.picam.capture_array()
            # picamera2 returns RGB, MediaPipe wants RGB, OpenCV wants BGR for encoding
            return frame
        else:
            ret, frame = self.cap.read()
            if not ret:
                return None
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    def setup_mediapipe(self):
        """Initialize MediaPipe gesture recognizer."""
        options = vision.GestureRecognizerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.55,
            min_hand_presence_confidence=0.55,
            min_tracking_confidence=0.4,
        )
        self.recognizer = vision.GestureRecognizer.create_from_options(options)
        print("MediaPipe gesture recognizer loaded")

    def process_frame(self, frame, timestamp_ms):
        """Run gesture recognition on a frame."""
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        result = self.recognizer.recognize_for_video(mp_image, timestamp_ms)
        return result

    def build_payload(self, result, frame):
        """Build JSON payload from MediaPipe results."""
        hands = []
        gestures = []

        if result.hand_landmarks:
            for i, landmarks in enumerate(result.hand_landmarks):
                handedness = "Unknown"
                if result.handedness and i < len(result.handedness):
                    handedness = result.handedness[i][0].category_name

                hand_data = {
                    "landmarks": [
                        {"x": lm.x, "y": lm.y, "z": lm.z}
                        for lm in landmarks
                    ],
                    "handedness": handedness,
                }
                hands.append(hand_data)

                # Gesture
                if result.gestures and i < len(result.gestures):
                    top = result.gestures[i][0]
                    gesture_name = GESTURE_LABELS.get(
                        top.category_name, top.category_name
                    )
                    if gesture_name:
                        # Compute cursor position (index tip) and palm center
                        index_tip = landmarks[8]
                        wrist = landmarks[0]
                        mid_mcp = landmarks[9]
                        palm_x = (wrist.x + mid_mcp.x) / 2
                        palm_y = (wrist.y + mid_mcp.y) / 2

                        # Pinch amount
                        thumb_tip = landmarks[4]
                        pinch_dist = (
                            (thumb_tip.x - index_tip.x) ** 2
                            + (thumb_tip.y - index_tip.y) ** 2
                        ) ** 0.5
                        pinch_amount = max(0, min(1, 1 - (pinch_dist - 0.04) / 0.06))

                        gestures.append({
                            "hand": handedness,
                            "gesture": gesture_name,
                            "confidence": int(top.score * 100),
                            "action": self._gesture_to_action(gesture_name, pinch_amount),
                            "cursorPosition": {
                                "x": index_tip.x,
                                "y": index_tip.y,
                                "z": index_tip.z,
                            },
                            "palmPosition": {
                                "x": palm_x,
                                "y": palm_y,
                                "z": wrist.z,
                            },
                            "pinchAmount": pinch_amount,
                        })

        payload = {
            "hands": hands,
            "gestures": gestures,
        }

        # Send camera frame periodically
        self.frame_count += 1
        if self.frame_count % FRAME_SEND_INTERVAL == 0:
            # Convert RGB to BGR for JPEG encoding
            bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 50])
            payload["frame"] = "data:image/jpeg;base64," + base64.b64encode(
                buf
            ).decode("ascii")

        return json.dumps(payload)

    def _gesture_to_action(self, gesture, pinch_amount):
        actions = {
            "open palm": "dismiss",
            "fist": "grab",
            "point up": "cursor",
            "thumbs up": "confirm",
            "thumbs down": "cancel",
        }
        if pinch_amount > 0.7:
            return "select"
        return actions.get(gesture)

    async def handle_client(self, websocket):
        self.clients.add(websocket)
        print(f"Client connected ({len(self.clients)} total)")
        try:
            async for msg in websocket:
                pass  # ignore client messages for now
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"Client disconnected ({len(self.clients)} total)")

    async def broadcast_loop(self):
        self.setup_camera()
        self.setup_mediapipe()
        self.running = True
        print("Tracking active — waiting for clients...")

        while self.running:
            if not self.clients:
                await asyncio.sleep(0.05)
                continue

            frame = self.read_frame()
            if frame is None:
                await asyncio.sleep(0.01)
                continue

            timestamp_ms = int(time.time() * 1000)
            result = self.process_frame(frame, timestamp_ms)
            payload = self.build_payload(result, frame)

            dead = set()
            for client in list(self.clients):
                try:
                    await client.send(payload)
                except Exception:
                    dead.add(client)
            self.clients -= dead

            # Small yield to avoid hogging the event loop
            await asyncio.sleep(0.01)

    async def start(self):
        print(f"Starting Mirage backend on ws://{WS_HOST}:{WS_PORT}")
        async with websockets.serve(
            self.handle_client,
            WS_HOST,
            WS_PORT,
            ping_interval=20,
            ping_timeout=60,
        ):
            print(f"WebSocket server running on ws://{WS_HOST}:{WS_PORT}")
            await self.broadcast_loop()

    def stop(self):
        self.running = False
        if self.cap:
            self.cap.release()
        if hasattr(self, "picam") and self.picam:
            self.picam.stop()


if __name__ == "__main__":
    backend = MirageBackend()
    try:
        asyncio.run(backend.start())
    except KeyboardInterrupt:
        print("\nShutting down...")
        backend.stop()
