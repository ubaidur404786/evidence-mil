# Runbook — commands the owner runs (long jobs, real data, Docker, cloud)

All from the repo root in PowerShell unless noted. Nothing here commits data or weights.

## 0. Local dev (minutes)
```powershell
uv sync --all-packages --all-extras
uv run python scripts/build_demo.py           # toy model + demo cases + web/public/replay
uv run uvicorn evidence_api.main:app_factory --factory --port 8000
cd web; npm ci; npm run dev                   # http://localhost:5173 (proxies /api → :8000)
```

## 1. Real data, fast path: precomputed Phikon features (M2, ~1 h incl. download)
Licence: Owkin non-commercial (docs/DATA.md). Portfolio/research use only.
1. Download (1.2 GB):
   `uv run --with huggingface_hub hf download owkin/camelyon16-features --repo-type dataset --include "data/*" --local-dir data/owkin_c16`
2. Build the memory-mapped cache (labels and tile coordinates come from the parquet files), then train on CPU:
```powershell
uv run python scripts/build_cache.py --owkin data/owkin_c16/data --out data/cache_phikon
uv run python scripts/train_real.py --config ml/configs/camelyon16_phikon_additive.yaml --seeds 0 1 2
uv run python scripts/build_real_cases.py --cache data/cache_phikon --model results/raw/cache_phikon_additive --out data/demo_cases_c16
```
   Close Docker Desktop first on an 8 GB laptop (training was killed once for low memory while kind was running).
3. Real slides, demo cases and the method comparison (GPU; extras `wsi` + `phikon`):
```powershell
uv pip install "openslide-python>=1.3" "openslide-bin>=4.0" pillow "transformers>=4.40" safetensors
uv run --no-sync python scripts/download_c16.py test_001 test_027 test_062 test_065 test_094   # CC0, ~5 GB
uv run --no-sync python scripts/build_c16_cases.py --out data/demo_cases_c16      # tile 20x + live Phikon
uv run --no-sync python scripts/evaluate_localisation.py --cases data/demo_cases_c16 --model results/raw/cache_phikon_additive
uv run --no-sync python scripts/compare_methods.py --cases data/demo_cases_c16    # writes results/c16_comparison.md
uv run --no-sync python scripts/build_demo.py      # data/packs.json + recorded runs for the web demo
$env:EVIDENCE_PACKS="data/packs.json"; uv run --no-sync uvicorn evidence_api.main:app_factory --factory --port 8000
```
   The first upload to the c16 pack loads Phikon (≈ 1–2 min); later uploads of ~100 tiles take a few seconds on GPU.

## GPU (RTX 3050, driver 592.82 / CUDA 13.1)
The lock file keeps CPU torch (CI and Docker have no GPU). For local GPU work, install the CUDA wheel and use
`--no-sync` so uv does not swap it back:
```powershell
uv pip install --index-url https://download.pytorch.org/whl/cu130 "torch==2.14.1+cu130"
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
uv run --no-sync python scripts/train_real.py --config ml/configs/camelyon16_phikon_additive.yaml --seeds 0 1 2
```
Config `device: auto` picks cuda when available. A plain `uv run`/`uv sync` restores CPU torch.
torch 2.15 CUDA wheels need CUDA 13.2+ (newer driver); 2.14.1+cu130 matches this driver.

## 2. Own embeddings on Kaggle (M2, several GPU sessions; resumable)
Kaggle notebook, GPU T4, internet on. CAMELYON16 slides attached as a dataset (or downloaded from the
official GigaScience/AWS open-data mirror). Each session processes one shard; re-running skips finished slides.
```bash
pip install openslide-python openslide-bin
git clone https://github.com/<you>/evidence-mil && cd evidence-mil
pip install -e contracts -e ml
python scripts/extract_embeddings.py --slides /kaggle/input/camelyon16 --out /kaggle/working/emb_dinov2 \
    --encoder dinov2 --variant dinov2_vits14 --batch 64 --shard 0 --num-shards 4
```
Download `/kaggle/working/emb_dinov2/*.npz` into `data/emb_dinov2/`, then:
```powershell
uv run python scripts/build_cache.py --emb data/emb_dinov2 --labels data/c16_labels.csv --out data/cache_dinov2
```
Copy the Phikon config, set `dir: data/cache_dinov2`, `encoder: {name: precomputed, dim: 384}`, and train as above.

## 3. ONNX export + parity
```powershell
uv run evidencemil export-onnx --model results/raw/cache_phikon_additive --out results/raw/cache_phikon_additive/head.onnx
uv run pytest ml -k onnx
```

## 4. Docker (M6)
Start Docker Desktop, then:
```powershell
docker compose up --build -d --wait
uv run python scripts/smoke.py http://localhost:8080/api
```

## 5. Kubernetes on kind (M7)
Install kind (`winget install Kubernetes.kind`), then in Git Bash: `bash scripts/kind_up.sh`
(dashboard at http://localhost:8081).

## 6. Cloud (M8)
Push to GitHub → CI builds and pushes `ghcr.io/<you>/evidence-mil-{api,web}`. Deploy both images on a free
container host (check its current free-tier terms first; record the choice in DECISIONS). The web image proxies
`/api/` to host `api:8000`; on hosts without service DNS, build web with `VITE_API_BASE=https://<api-url>` and set
`EVIDENCE_CORS=https://<web-url>` on the api.
