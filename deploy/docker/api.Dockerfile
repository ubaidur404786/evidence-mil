# Backend image: api + ml + agent (modular monolith, ADR-002). CPU-only torch keeps it small.
# Build context = repo root:  docker build -f deploy/docker/api.Dockerfile -t evidence-api .
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
WORKDIR /src
RUN uv venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
# CPU wheel first, so the workspace install below does not pull the CUDA build.
RUN uv pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.15.0"
COPY contracts contracts
COPY ml ml
COPY agent agent
COPY api api
RUN uv pip install ./contracts ./ml ./agent ./api
# Demo assets are generated, never committed (ADR-003): toy model + cached-embedding cases.
COPY scripts/build_demo.py scripts/build_demo.py
RUN mkdir -p results web/public/replay && python scripts/build_demo.py > /dev/null

FROM python:3.12-slim
RUN useradd --create-home --uid 10001 app
COPY --from=build /opt/venv /opt/venv
COPY --from=build --chown=app /src/data /app/data
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 \
    EVIDENCE_CASES_DIR=/app/data/demo_cases EVIDENCE_MODEL_DIR=/app/data/model \
    EVIDENCE_DB=/app/state/evidence.sqlite
WORKDIR /app
RUN mkdir /app/state && chown app /app/state
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "evidence_api.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
