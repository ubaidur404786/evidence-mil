# Roadmap — one milestone at a time, gate before next

Order follows the build: model → agent → API → dashboard → Docker → Kubernetes/CI → cloud/launch.
Each gate = tests green + boxes ticked. Update this file as you go.

## M0 — Foundations
- [x] `git init` (ask before first commit), `uv` workspace, ruff, pytest config, pre-commit-free keep simple
- [x] `contracts/`: JSON Schemas for `StepEvent`, `Evidence`, `Report`; generate pydantic + TS types; schema tests
- [x] Synthetic toy dataset generator ("bright pattern hidden in noise patches") for tests and a first demo
- [x] `docs/DATA.md` licences verified on official pages
- Gate: `pytest contracts` green; toy generator test green.

## M1 — ML core (`ml/`), on synthetic data first
- [x] data: tiler (grid, background filter), bag dataset, embedding cache reader (memory-mapped)
- [x] encoders: interface + registry + one real encoder wrapper (DINOv2) + fake encoder for tests
- [x] mil: `mean`, `abmil`, `additive` heads; loss; temperature scaling
- [x] explain: contributions, top-k, deletion curve, heatmap grid
- [x] pipeline: `run_case()` that yields `StepEvent`s (used later by API)
- [x] train/eval CLI with config files; metrics: AUROC, AUPRC, ECE, localisation
- Gate ✅ (24 ml tests green): additivity property test, head learns the toy task (AUROC > 0.95), localisation on toy > chance,
  end-to-end `run_case` test emits all 6 events in order.

## M2 — Real data + encoder experiment
- [ ] Start from a public precomputed feature set to validate the head quickly (check licence) — scripts ready (`build_cache.py --owkin`); **owner runs** (RUNBOOK §1)
- [ ] Extract own embeddings on Kaggle/Colab (resumable shards; owner runs it) for 2–3 encoders — `scripts/extract_embeddings.py` ready; **owner runs** (RUNBOOK §2)
- [ ] Train heads, compare vs baselines, external/centre-wise check where possible — `scripts/train_real.py` ready; toy comparison in `results/toy_results.md`
- [ ] Faithfulness: deletion/insertion, random-weight sanity check; write `results/` tables — deletion curve + random-weight check implemented and tested on toy; real run pending
- [ ] Export chosen head to ONNX; build 5–8 demo case bundles (thumbnail tiles + cached embeddings) — ONNX export + parity test done; 6 toy demo bundles built; real bundles pending
- Gate ⏳ (needs owner's real-data run; ONNX parity ✅): results table committed, chosen encoder recorded in DECISIONS, ONNX parity test (torch vs onnx).

## M3 — Agent (`agent/`)
- [x] LangGraph: gate → tools → draft → verifier → human interrupt; Postgres/SQLite checkpointer
- [x] LLM adapter: template (default), local, hosted; fake LLM for tests
- [x] Verifier rejects any number/patch id not in the evidence
- Gate ✅ (11 agent tests green): graph tests (abstain path, verifier-reject path, approve path) green with fake LLM.

## M4 — API (`api/`)
- [x] FastAPI: list cases, start run, SSE stream of `StepEvent`, approve/edit report, health
- [x] Case store + audit log; replay-file mode
- Gate ✅ (7 api tests green): TestClient tests + SSE order test + OpenAPI schema matches `contracts/`.

## M5 — Dashboard (`web/`)
- [x] Step player: Input → Tile → Encode → Aggregate → Explain → Report, animated, pausable, replayable
- [x] Explain view: heatmap overlay, top-k patches, contribution bars summing to the score, what-if slider
- [x] Report view with citations and approve/edit
- Gate ✅ (7 vitest + Playwright smoke green): vitest component tests + one Playwright smoke test of the full replay.

## M6 — Docker
- [x] Dockerfiles (multi-stage, non-root), `docker-compose.yml` (web, api, db, optional llm profile) — written; db = SQLite volume (ADR-008); build not run (Docker daemon off)
- Gate ⏳ (Docker daemon off; smoke script passes against local uvicorn): `docker compose up` + smoke script passes.

## M7 — Kubernetes + CI
- [x] kustomize base + `local` (kind) and `cloud` overlays; probes, resources, config/secret split — renders cleanly (`kubectl kustomize`); kind apply pending (kind not installed)
- [x] GitHub Actions: lint, tests per module, image build, manifest validation — `.github/workflows/ci.yml`; not run yet (no push)
- Gate ⏳ (needs push + kind): CI green; manifests apply cleanly on kind and the app answers.

## M8 — Cloud + launch
- [ ] Deploy to a free container host (check current terms); public demo URL — **owner** (RUNBOOK §6)
- [x] README (problem, diagram, GIF, results, quickstart, limits, Acknowledgements incl. Claude assistance) — real-data results + GIF pending
- [ ] Record demo video from `docs/DEMO_SCRIPT.md`; LinkedIn post draft — LinkedIn draft in `docs/LINKEDIN_POST.md`; video is the owner's
- Gate ⏳: fresh-clone quickstart works; links checked.
