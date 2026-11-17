# The game's server as a Docker image, for running it on a server (docs/SERVER.md).
# Build and run it with Docker Compose (compose.yaml), from the repository's folder:
#   DODGEBALL_VERSION=$(git describe --tags --always --dirty) docker compose up -d --build
FROM python:3.13-slim

# No .pyc files in the image, and the console's lines (joins, the host link, errors) go straight
# to `docker compose logs` instead of waiting in a buffer.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# The locked dependencies first, so this layer is reused until requirements.txt changes. Where
# PyPI is slow or blocked: docker compose build --build-arg PIP_INDEX_URL=https://<mirror>/simple
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The game (.dockerignore leaves out the tests, the art scripts, logs and local files).
COPY . .

# Which code this is, for the session logs (the image has no git): given by whoever builds it.
ARG VERSION=unknown
RUN python -c "import json, os; json.dump({'commit': os.environ.get('VERSION') or 'unknown'}, open('build_info.json', 'w'))"

# Run as a user without rights: it can read the game and write only to /data, where the host's
# saved rules and the session logs go. /data is a volume, so it outlives every update.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin dodgeball \
    && mkdir /data && chown dodgeball /data
USER dodgeball
VOLUME /data

# HTTP and the game's WebSocket (/ws), without TLS: a proxy in front gives players https.
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4)"]
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser", "--data-dir", "/data"]
