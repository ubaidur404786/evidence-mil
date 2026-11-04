# EvidenceMIL

**See why the model decided.** A large image is a bag of small patches. EvidenceMIL finds the patches that drove
the prediction, replays every step in a dashboard, and writes a checked report that a person approves.

> Decision-support demo, not a medical device.

<!-- demo GIF: record from docs/DEMO_SCRIPT.md and place at docs/demo.gif -->

## The problem
Experts often need to find a few important regions inside a huge image, for example a few tumour cells in a
lymph-node slide. An AI model can give the whole image a score, but a score with no reason is hard to trust.
EvidenceMIL gives the score **and** shows the exact evidence behind it.

## How it works
![architecture](docs/architecture.svg)

1. **Tile**: cut the image into a grid of small patches and drop empty background.
2. **Encode**: a frozen, pretrained vision model turns each patch into a list of numbers (a vector).
3. **Aggregate**: a small "additive" model weighs the patches and outputs one score. The score is *exactly*
   the sum of one contribution per patch, so the explanation is exact, not an approximation.
4. **Explain**: heatmap, the top patches, bars that add up to the score, and a what-if slider that removes the
   top patches and shows the score fall.
5. **Report**: an agent drafts a short report. A verifier rejects any number or patch id that is not in the
   evidence. A person approves or edits it. If the model is unsure, it abstains instead of guessing.

The engine is domain-agnostic. The first domain pack targets breast-cancer lymph-node slides (CAMELYON16).

## Run it
Requirements: [uv](https://docs.astral.sh/uv/), Node 22. Everything runs on a CPU laptop.
```bash
uv sync --all-packages --all-extras
uv run python scripts/build_demo.py      # trains the toy model, writes demo cases (< 1 min)
uv run uvicorn evidence_api.main:app_factory --factory --port 8000
cd web && npm ci && npm run dev          # open http://localhost:5173
```
No backend? `cd web && npm run build && npx vite preview` and open `/?replay` to watch recorded runs.
With Docker: `docker compose up --build` then open http://localhost:8080.
Tests: `uv run pytest contracts ml agent api` and `cd web && npm test && npx playwright test`.

## Results
**Toy task** (synthetic: a faint cross hidden in noise patches; `results/toy_results.md`):

| head | AUROC | AUPRC | ECE | top-1 patch is a true pattern patch |
|---|---|---|---|---|
| mean (baseline) | 0.955 | 0.967 | 0.150 | 1.00 (chance 0.04) |
| attention MIL (baseline) | 1.000 | 1.000 | 0.000 | 1.00 |
| **additive (ours)** | 1.000 | 1.000 | 0.000 | 1.00 |

The toy task checks the machinery: exact additivity, localisation and calibration. It is not a claim about
real images.

**CAMELYON16** (130 official test slides; frozen Phikon features from `owkin/camelyon16-features`;
mean ± sd over 3 seeds; `results/cache_phikon_results.md`):

| head | AUROC | AUPRC | ECE |
|---|---|---|---|
| mean (baseline) | 0.579 ± 0.010 | 0.541 ± 0.014 | 0.137 ± 0.021 |
| attention MIL (baseline) | 0.920 ± 0.008 | 0.924 ± 0.006 | 0.069 ± 0.015 |
| **additive (ours)** | 0.911 ± 0.012 | 0.924 ± 0.008 | 0.068 ± 0.018 |

The additive head matches attention MIL within noise while every prediction decomposes exactly into
per-patch contributions. Features are under the Owkin non-commercial licence and are not redistributed here.

## Engineering
- Modular monolith: `ml/` (pure PyTorch library), `agent/` (LangGraph), `api/` (FastAPI, SSE), `web/`
  (React + TypeScript), all typed through one schema in `contracts/` (JSON Schema → pydantic + TS).
- Tests in every module, including additivity property tests, ONNX parity, agent abstain/reject/approve paths,
  an SSE order test, a check that the OpenAPI schema matches the contracts, and a Playwright replay smoke test.
- Docker (multi-stage, non-root), Kubernetes (kustomize, kind and cloud overlays), GitHub Actions CI.
- Design decisions: [docs/DECISIONS.md](docs/DECISIONS.md). Data and model licences: [docs/DATA.md](docs/DATA.md).

## Limits
- Decision-support demo, not a medical device. It has not been clinically validated.
- Demo cases use cached patch embeddings (labelled "cached" in the UI). Everything after the encoder runs live.
- Pathology feature sets and encoders listed in `docs/DATA.md` are non-commercial; this repo is for research and
  portfolio use.

## Project layout
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Acknowledgements
Built with assistance from Claude (Anthropic) for code and documentation drafting. Design decisions, experiments
and review by the author. CAMELYON16 challenge organisers for the data; DINOv2 (Meta AI, Apache-2.0); Owkin for
the Phikon features.
