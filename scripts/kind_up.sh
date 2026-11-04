#!/usr/bin/env bash
# Build images, create a kind cluster, deploy the local overlay, run the smoke test.
# Needs: docker, kind, kubectl, uv.  Usage: bash scripts/kind_up.sh
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f deploy/docker/api.Dockerfile -t evidence-api:latest .
docker build -f deploy/docker/web.Dockerfile -t evidence-web:latest .
kind get clusters | grep -qx evidence || kind create cluster --name evidence --config deploy/k8s/kind-config.yaml
kind load docker-image evidence-api:latest evidence-web:latest --name evidence
kubectl apply -k deploy/k8s/overlays/local
kubectl -n evidence-mil rollout status deploy/api --timeout=180s
kubectl -n evidence-mil rollout status deploy/web --timeout=60s
uv run python scripts/smoke.py http://localhost:8081/api
