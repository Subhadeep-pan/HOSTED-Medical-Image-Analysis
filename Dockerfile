FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# opencv-python-headless only needs libglib2.0-0 at runtime (no libGL/X11
# libraries needed, unlike the full opencv-python package).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# 1 worker / 2 threads keeps only a single copy of each loaded TFLite model
# in memory at a time, which matters on low-RAM hosts (e.g. Render free tier).
CMD exec gunicorn \
    --bind :$PORT \
    --workers 1 \
    --threads 2 \
    --timeout 120 \
    --max-requests 200 \
    --max-requests-jitter 20 \
    app:app
