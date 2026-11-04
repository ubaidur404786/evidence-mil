# Decisions (short ADRs)

## ADR-001 — Frozen pretrained encoder + our MIL head (do not retrain the encoder)
Decision: use a pretrained image encoder frozen, precompute patch embeddings once, train only the MIL head.
Why: slide-level labels only (~400 slides), 6 GB GPU / free Colab-Kaggle, and this is the standard
approach in the field. End-to-end encoder training would overfit and cannot fit the hardware.
Consequence: encoder is a config choice; changing it means re-extracting embeddings, nothing else changes.
Experiment (M2): compare 3 encoders under the same head — general (DINOv2), domain-specific
(a pathology foundation model, licence permitting), and a small CNN baseline. Optional: light
adaptation (linear probe / LoRA on a patch subset) only if the gap justifies it. Pick on results.

## ADR-002 — Modular monolith
One backend container (`api` imports `ml` + `agent`), separate web and database containers.
Revisit only with a measured scaling or isolation need.

## ADR-003 — Demo uses cached embeddings; MIL, explain and agent run live
Gigapixel slides cannot be encoded on a free CPU in a demo. Sample cases ship with tiles + cached
embeddings; the UI says "cached". Everything after the encoder is computed live. Offline GPU worker
(documented, not hosted) handles new slides.

## ADR-004 — Universal framing, one real domain pack first
Engine = "any large image is a bag of patches". First pack = CAMELYON16 (breast-cancer lymph-node
slides). A second pack (e.g. satellite or defect inspection) is a stretch goal, not a requirement.

## ADR-005 — LLM only words verified evidence
Prediction comes from the MIL head. The agent drafts text, a verifier checks every number and patch
id against the evidence JSON, a human approves. Template fallback when no LLM is available.

## ADR-006 — Kubernetes is demonstrated, not required for the live demo
Manifests (kustomize) are validated on a local kind cluster in CI-adjacent scripts. The public live
demo runs on a free container host (chosen in M8; check current free-tier terms).

## ADR-007 — Contracts toolchain
JSON Schemas in `contracts/schemas` are the source; `contracts/generate.py` produces pydantic v2
(datamodel-code-generator) and TS (json-schema-to-typescript, pinned via npx). Generated files are committed.
`uv` workspace at root with members `contracts`, `ml` (more added per milestone). Own git repo in this folder
(the parent portfolio repo ignores it).

## ADR-008 — SQLite (on a volume) for runs, audit and agent checkpoints
The demo has one writer and tiny state; SQLite avoids a database container. SQL is kept plain so a Postgres
swap is mechanical. Consequence: api runs with 1 replica (`Recreate`) in Kubernetes. Revisit if multi-replica is needed.

## ADR-009 — Runs are computed once, then streamed
`POST /runs` executes all six stages (cached embeddings + small head: milliseconds) and stores the events;
`GET /runs/{id}/events` streams them as SSE with optional pacing. Same code path serves recorded replays.

## ADR-010 — Toy demo data generated at build time
The toy model, demo bundles and recorded replays are produced by `scripts/build_demo.py` (and in the api image
build). Only the small recorded replay JSON (synthetic, ours) is committed, for the offline web demo.
The ambiguous demo case is a blend of a pattern bag and its pattern-free twin, bisected to probability 0.5,
so the abstain path is visible.

## ADR-011 — LLM adapter is OpenAI-compatible HTTP
One `http` adapter covers local (Ollama, llama.cpp) and hosted endpoints; `template` is the default and the
fallback after a verifier failure or LLM error. Hosted use is limited to open-data demo cases.
