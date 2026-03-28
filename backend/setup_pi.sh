#!/bin/bash
# Mirage Pi Setup — run this on your Raspberry Pi
set -e

echo "=== Mirage Pi Setup ==="

# Install system deps
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv libcamera-dev python3-picamera2

# Create venv
python3 -m venv venv
source venv/bin/activate

# Install Python deps
pip install mediapipe opencv-python-headless websockets

# Download gesture model
if [ ! -f gesture_recognizer.task ]; then
  echo "Downloading gesture recognizer model..."
  curl -L -o gesture_recognizer.task \
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task"
fi

echo ""
echo "=== Setup complete ==="
echo "To run: source venv/bin/activate && python pi_server.py"
echo "Then open your Mirage URL in Chromium"
