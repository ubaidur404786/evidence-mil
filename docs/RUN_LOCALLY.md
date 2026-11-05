# Run EvidenceMIL on your machine (uploads)

The public demo (GitHub Pages) only replays recorded runs. To analyse your own image, run it locally: the upload goes
through the same pipeline (tiles → Phikon embeddings → patch scores → slide score → explanation → verified report).
Nothing leaves your machine except the one-time model downloads.

## 1. Start the app with Docker
Needs Docker Desktop and git.
```bash
git clone https://github.com/ubaidur404786/evidence-mil.git
cd evidence-mil
docker compose pull        # prebuilt images from ghcr.io (or: docker compose up --build)
docker compose up -d
```
Open http://localhost:8080. The synthetic demo pack works straight away, uploads included.

## 2. Enable the CAMELYON16 pack (one time, ~30–60 min on CPU)
Needs [uv](https://docs.astral.sh/uv/). Downloads Owkin's Phikon features (1.2 GB, non-commercial licence, see
`docs/DATA.md`) and trains the small additive head. Weights are never committed or shipped in the images.
```bash
uv sync --all-packages
uv run --with huggingface_hub hf download owkin/camelyon16-features --repo-type dataset --include "data/*" --local-dir data/owkin_c16
uv run python scripts/build_cache.py --owkin data/owkin_c16/data --out data/cache_phikon
uv run python scripts/train_real.py --config ml/configs/camelyon16_phikon_additive.yaml --seeds 0
```
Copy the head where Docker mounts it and restart the API:
```powershell
New-Item -ItemType Directory -Force models/c16 | Out-Null      # PowerShell
Copy-Item results/raw/cache_phikon_additive/* models/c16/
docker compose restart api
```
```bash
mkdir -p models/c16 && cp results/raw/cache_phikon_additive/* models/c16/ && docker compose restart api   # macOS/Linux
```
The CAMELYON16 pack now appears in the upload dialog. Optional: real sample cases built with
`scripts/build_c16_cases.py` (RUNBOOK §1, GPU) can be copied into `samples/c16/` to show up in the worklist.

## 3. Upload
Click **Upload image**, pick the CAMELYON16 pack, drop an H&E region at 20× (0.5 µm/px), PNG/JPEG, ≤ 8192 px a side,
≤ 1500 tissue tiles. Sample images (CC0 crops around annotated tumour, made with `scripts/make_sample_images.py`):
https://github.com/ubaidur404786/evidence-mil/releases/tag/samples-v1

| sample | tissue tiles | result |
|---|---|---|
| camelyon16_test_001_tumour_20x.jpg | 100 | P = 0.998, positive |
| camelyon16_test_027_tumour_20x.jpg | 91 | P = 0.999, positive |
| camelyon16_test_065_tumour_20x.jpg | 24 | P = 1.000, positive |

The first CAMELYON16 upload downloads and loads Phikon (1–2 min). After that a 100-tile image takes roughly
10–30 s on CPU (Docker image), a few seconds on a GPU.

## Without Docker (GPU)
See `docs/RUNBOOK.md` §0–1 and the GPU section: `uv sync`, install the CUDA torch wheel, then
`$env:EVIDENCE_PACKS="data/packs.json"; uv run --no-sync uvicorn evidence_api.main:app_factory --factory --port 8000`
and `cd web; npm ci; npm run dev`.

Decision support for demonstration, not a medical device.
