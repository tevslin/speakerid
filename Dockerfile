# Dockerfile - Local GPU speakerid (SmartTranscripts™) Container
FROM pytorch/pytorch:2.2.1-cuda12.1-cudnn8-runtime

WORKDIR /app

# Install system dependencies (ffmpeg is required by WhisperX for audio decoding)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install WhisperX, PyAnnote, and speakerid dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Optional: Pre-bake WhisperX & alignment models if desired during build
ARG PRELOAD_MODELS=0
ARG HF_TOKEN=""
ENV HF_HOME=/app/models
ENV HF_HUB_CACHE=/app/models/hub

RUN if [ "$PRELOAD_MODELS" = "1" ]; then \
        python -c "import whisperx; whisperx.load_model('large-v3', 'cpu')" && \
        python -c "import whisperx; whisperx.load_align_model('en', 'cpu')" && \
        python -c "import nltk; nltk.download('punkt'); nltk.download('punkt_tab')"; \
    fi

RUN if [ "$PRELOAD_MODELS" = "1" ] && [ -n "$HF_TOKEN" ]; then \
        python -c "import whisperx.diarize; whisperx.diarize.DiarizationPipeline(token='$HF_TOKEN', device='cpu')"; \
    fi

# Copy speakerid source code and install CLI entrypoint
COPY . /app
RUN pip install --no-cache-dir --no-deps -e /app

ENTRYPOINT ["speakerid"]
CMD ["--help"]
