# deploy

`docker/`: multi-stage, non-root images for the api (CPU torch, demo assets generated at build) and the web
(nginx-unprivileged, `/api` proxied with SSE buffering off). Compose file at repo root (`--profile llm` adds Ollama).
`k8s/`: kustomize base + `overlays/local` (kind, NodePort 30080 → host 8081) and `overlays/cloud` (GHCR images, ingress).
Bring up kind: `bash scripts/kind_up.sh`. Smoke test any stack: `uv run python scripts/smoke.py <base>/api`.
