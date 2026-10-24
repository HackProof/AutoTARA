FROM python:3.13-slim

LABEL org.opencontainers.image.title="AutoTARA Simulation Server"
LABEL org.opencontainers.image.description="FastAPI server for MAL simulations"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SIMULATION_RUNS_DIR=/app/runs \
    SIMULATION_TIMEOUT_SECONDS=120

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app \
    && mkdir -p /app/runs \
    && chown -R app:app /app

COPY --chown=app:app main.py worker.py schemas.py attack_tree.py ./

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/simulations/health', timeout=3).close()"]

# The concurrency limit in main.py is shared within one Uvicorn process.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
