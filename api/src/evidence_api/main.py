"""FastAPI app.

Env: EVIDENCE_PACKS (see packs.py; default = toy pack from EVIDENCE_CASES_DIR / EVIDENCE_MODEL_DIR),
EVIDENCE_DB (sqlite file), EVIDENCE_REPLAY_DIR (optional recorded <case_id>.json runs),
EVIDENCE_CORS (comma-separated origins for local dev).

A run computes all six stages once and stores the events (ADR-009); GET /runs/{id}/events streams
them as SSE, paced by `delay_ms` so the dashboard can animate.
"""

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from evidence_agent import ReviewAgent, build_llm
from evidence_api.packs import Pack, packs_from_env
from evidence_api.store import Store
from evidence_api.uploads import UploadError, image_to_bundle, save_upload
from evidence_contracts import Evidence, Report, StepEvent
from evidencemil.pipeline import load_bundle, run_case
from evidencemil.pipeline.bundle import list_bundles, patch_image

MAX_UPLOAD_BYTES = 64 * 1024 * 1024


@dataclass
class Settings:
    packs: list[Pack]
    db_path: Path
    replay_dir: Path | None = None
    cors: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> "Settings":
        replay = os.environ.get("EVIDENCE_REPLAY_DIR")
        return cls(packs_from_env(), Path(os.environ.get("EVIDENCE_DB", "data/evidence.sqlite")),
                   Path(replay) if replay else None,
                   [o for o in os.environ.get("EVIDENCE_CORS", "").split(",") if o])


class CaseSummary(BaseModel):
    case_id: str
    pack: str
    title: str = ""
    domain: str = ""
    source: str = ""
    label: int | None = None
    n_patches: int | None = None
    has_annotation: bool = False
    uploaded: bool = False


class WorklistItem(BaseModel):
    case_id: str
    run_id: str
    probability: float
    abstain: bool
    status: str


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
    packs = {p.name: p for p in settings.packs}

    app = FastAPI(title="EvidenceMIL API", version="0.2.0")
    if settings.cors:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors, allow_methods=["*"],
                           allow_headers=["*"])

    def case_index() -> dict[str, tuple[Pack, Path, dict]]:
        index = {}
        for pack in packs.values():
            for directory in (pack.cases_dir, pack.uploads_dir):
                for meta in list_bundles(directory):
                    index[meta["case_id"]] = (pack, directory, meta)
        return index

    def find_case(case_id: str) -> tuple[Pack, Path, dict]:
        found = case_index().get(case_id)
        if found is None:
            raise HTTPException(404, f"unknown case {case_id}")
        return found

    def get_run_or_404(run_id: str) -> dict:
        run = store.get_run(run_id)
        if run is None:
            raise HTTPException(404, f"unknown run {run_id}")
        return run

    def summary(pack: Pack, directory: Path, m: dict) -> CaseSummary:
        return CaseSummary(case_id=m["case_id"], pack=pack.name, title=m.get("title", ""),
                           domain=m.get("domain", ""), source=m.get("source", ""), label=m.get("label"),
                           n_patches=m.get("n_patches"), has_annotation=bool(m.get("has_annotation")),
                           uploaded=directory == pack.uploads_dir)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "packs": list(packs)}

    @app.get("/packs")
    def list_packs() -> list[dict]:
        return [p.public() for p in packs.values()]

    @app.get("/cases", response_model=list[CaseSummary])
    def cases() -> list[CaseSummary]:
        return [summary(*v) for v in case_index().values()]

    @app.get("/cases/{case_id}/patches/{patch_id}")
    def patch(case_id: str, patch_id: int) -> Response:
        _, directory, meta = find_case(case_id)
        bundle = load_bundle(directory, case_id)
        if not 0 <= patch_id < len(bundle.coords):
            raise HTTPException(404, "unknown patch")
        data, mime = patch_image(bundle, patch_id)
        return Response(data, media_type=mime, headers={"Cache-Control": "max-age=86400"})

    @app.post("/uploads", response_model=CaseSummary, status_code=201)
    async def upload(file: UploadFile = File(...), pack: str = Form("c16")) -> CaseSummary:
        target = packs.get(pack)
        if target is None or target.live_encoder is None:
            raise HTTPException(400, f"pack {pack!r} does not accept uploads")
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "file larger than 64 MB")
        try:
            bundle = await run_in_threadpool(image_to_bundle, data, file.filename or "upload", target)
        except UploadError as exc:
            raise HTTPException(422, str(exc)) from exc
        await run_in_threadpool(save_upload, bundle, target)
        store.audit(None, "upload", {"case_id": bundle.case_id, "pack": pack,
                                     "filename": bundle.meta["title"], "patches": len(bundle.coords)})
        return summary(target, target.uploads_dir, {**bundle.meta, "case_id": bundle.case_id,
                                                     "label": None, "n_patches": len(bundle.coords)})

    @app.post("/runs", response_model=RunCreated, status_code=201)
    def start_run(req: RunRequest) -> RunCreated:
        run_id = uuid.uuid4().hex[:12]
        replay = settings.replay_dir and settings.replay_dir / f"{req.case_id}.json"
        if replay and replay.exists():
            events = [StepEvent.model_validate(e).model_dump(mode="json")
                      for e in json.loads(replay.read_text())]
        else:
            pack, directory, _ = find_case(req.case_id)
            bundle = load_bundle(directory, req.case_id)
            events = [e.model_dump(mode="json") for e in run_case(
                bundle, pack.model(), report_fn=lambda ev: agent.start(ev, run_id),
                encoder=None if bundle.cached else pack.encoder())]
        store.add_run(run_id, req.case_id, events)
        store.audit(run_id, "run", {"case_id": req.case_id, "replay": bool(replay and replay.exists())})
        return RunCreated(run_id=run_id, case_id=req.case_id)

    @app.get("/worklist", response_model=list[WorklistItem])
    def worklist() -> list[WorklistItem]:
        items = []
        for run in store.latest_runs():
            agg = run["events"][3]["payload"]
            try:
                status = agent.report(run["run_id"])["status"]
            except KeyError:
                status = "replay"
            items.append(WorklistItem(case_id=run["case_id"], run_id=run["run_id"],
                                      probability=agg["probability"], abstain=agg["abstain"], status=status))
        return items

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
