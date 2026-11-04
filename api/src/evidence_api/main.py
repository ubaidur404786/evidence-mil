"""FastAPI app.

Env: EVIDENCE_CASES_DIR (demo bundles), EVIDENCE_MODEL_DIR (trained head), EVIDENCE_DB (sqlite file),
EVIDENCE_REPLAY_DIR (optional: recorded <case_id>.json event files, offline-safe demo mode),
EVIDENCE_CORS (comma-separated origins for local dev).

A run computes all six stages once (fast: cached embeddings + small head) and stores the events;
GET /runs/{id}/events streams them as SSE, paced by `delay_ms` so the dashboard can animate.
"""

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from evidence_agent import ReviewAgent, build_llm
from evidence_api.store import Store
from evidence_contracts import Evidence, Report, StepEvent
from evidencemil.pipeline import load_bundle, load_model, run_case
from evidencemil.pipeline.bundle import list_bundles


@dataclass
class Settings:
    cases_dir: Path
    model_dir: Path
    db_path: Path
    replay_dir: Path | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        replay = os.environ.get("EVIDENCE_REPLAY_DIR")
        return cls(Path(os.environ.get("EVIDENCE_CASES_DIR", "data/demo_cases")),
                   Path(os.environ.get("EVIDENCE_MODEL_DIR", "data/model")),
                   Path(os.environ.get("EVIDENCE_DB", "data/evidence.sqlite")),
                   Path(replay) if replay else None)


class CaseSummary(BaseModel):
    case_id: str
    title: str = ""
    domain: str = ""
    label: int | None = None


class RunRequest(BaseModel):
    case_id: str


class RunCreated(BaseModel):
    run_id: str
    case_id: str


class Decision(BaseModel):
    action: Literal["approve", "edit"]
    sections: list[dict] | None = None


def create_app(settings: Settings | None = None, agent: ReviewAgent | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    store = Store(settings.db_path)
    agent = agent or ReviewAgent.with_sqlite(settings.db_path.with_suffix(".agent.sqlite"), build_llm())
    model = load_model(settings.model_dir)

    app = FastAPI(title="EvidenceMIL API", version="0.1.0")
    origins = [o for o in os.environ.get("EVIDENCE_CORS", "").split(",") if o]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"],
                           allow_headers=["*"])

    def get_run_or_404(run_id: str) -> dict:
        run = store.get_run(run_id)
        if run is None:
            raise HTTPException(404, f"unknown run {run_id}")
        return run

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "model": model.spec.head, "encoder": model.spec.encoder}

    @app.get("/cases", response_model=list[CaseSummary])
    def cases() -> list[CaseSummary]:
        return [CaseSummary(**{k: m.get(k) for k in ("case_id", "title", "domain", "label")
                               if m.get(k) is not None}) for m in list_bundles(settings.cases_dir)]

    @app.post("/runs", response_model=RunCreated, status_code=201)
    def start_run(req: RunRequest) -> RunCreated:
        replay = settings.replay_dir and settings.replay_dir / f"{req.case_id}.json"
        run_id = uuid.uuid4().hex[:12]
        if replay and replay.exists():
            events = [StepEvent.model_validate(e).model_dump(mode="json")
                      for e in json.loads(replay.read_text())]
        else:
            if not (settings.cases_dir / f"{req.case_id}.json").exists():
                raise HTTPException(404, f"unknown case {req.case_id}")
            bundle = load_bundle(settings.cases_dir, req.case_id)
            events = [e.model_dump(mode="json") for e in run_case(
                bundle, model, report_fn=lambda ev: agent.start(ev, run_id))]
        store.add_run(run_id, req.case_id, events)
        store.audit(run_id, "run", {"case_id": req.case_id, "replay": bool(replay and replay.exists())})
        return RunCreated(run_id=run_id, case_id=req.case_id)

    @app.get("/runs/{run_id}/steps", response_model=list[StepEvent])
    def steps(run_id: str) -> list[dict]:
        return get_run_or_404(run_id)["events"]

    @app.get("/runs/{run_id}/events")
    async def events(run_id: str, delay_ms: int = 0) -> StreamingResponse:
        run = get_run_or_404(run_id)

        async def stream() -> AsyncIterator[str]:
            for e in run["events"]:
                yield f"event: step\ndata: {json.dumps(e)}\n\n"
                if delay_ms:
                    await asyncio.sleep(min(delay_ms, 5000) / 1000)
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache"})

    @app.get("/runs/{run_id}/evidence", response_model=Evidence)
    def evidence(run_id: str) -> dict:
        return get_run_or_404(run_id)["events"][4]["payload"]["evidence"]

    @app.get("/runs/{run_id}/report", response_model=Report)
    def report(run_id: str) -> dict:
        get_run_or_404(run_id)
        try:
            return agent.report(run_id)
        except KeyError as exc:  # replayed runs have no agent thread
            raise HTTPException(409, "run has no live report (replay mode)") from exc

    @app.post("/runs/{run_id}/decision", response_model=Report)
    def decide(run_id: str, decision: Decision) -> dict:
        get_run_or_404(run_id)
        if not agent.waiting_for_human(run_id):
            raise HTTPException(409, "report is not waiting for a decision")
        result = agent.decide(run_id, decision.action, decision.sections)
        store.audit(run_id, decision.action, {"status": result["status"],
                                              "passed": result["verifier"]["passed"]})
        return result

    @app.get("/runs/{run_id}/audit")
    def audit(run_id: str) -> list[dict]:
        get_run_or_404(run_id)
        return store.audit_log(run_id)

    return app


def app_factory() -> FastAPI:
    """uvicorn entry point: `uvicorn evidence_api.main:app_factory --factory`."""
    return create_app()
