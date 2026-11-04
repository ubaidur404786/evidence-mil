# api

Thin FastAPI app (`evidence_api.main:app_factory`). Routes: `GET /health`, `GET /cases`, `POST /runs`,
`GET /runs/{id}/events` (SSE, `?delay_ms=` pacing), `/steps`, `/evidence`, `/report`, `POST /decision`, `/audit`.
SQLite run store + audit log. Replay mode: set `EVIDENCE_REPLAY_DIR` to recorded `<case_id>.json` files.
Run: `uv run uvicorn evidence_api.main:app_factory --factory --port 8000`. Test: `uv run pytest api`.
