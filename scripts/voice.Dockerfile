# Tool image for generating the built-in voice clips (scripts/voice_clips.py).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir kokoro-onnx==0.6.1
