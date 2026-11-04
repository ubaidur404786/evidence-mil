"""Resumable patch-embedding extraction for whole-slide images (run on Kaggle/Colab GPU).

One output file per slide: <out>/<slide_id>.npz with `embeddings` [N, D] float16 and `coords`
[N, 2] (row, col in tile units). Slides already done are skipped, so rerun after any interruption.
Shard with --shard i --num-shards k to split work across sessions.

  pip install openslide-python openslide-bin torch numpy
  python scripts/extract_embeddings.py --slides /kaggle/input/camelyon16/train --out /kaggle/working/emb \
      --encoder dinov2 --variant dinov2_vits14 --shard 0 --num-shards 4

Then merge into the cache layout used by `ml`:
  uv run python scripts/build_cache.py --emb data/emb_dinov2 --labels data/camelyon16_labels.csv \
      --out data/cache_dinov2
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1] / "ml" / "src"))


def tissue_mask_level(slide, level: int, background: float = 0.8) -> np.ndarray:
    thumb = np.asarray(slide.read_region((0, 0), level, slide.level_dimensions[level]).convert("L"))
    return thumb / 255.0 < background


def iter_tiles(slide, tile_px: int, min_tissue: float):
    """Yield (row, col, RGB float tile) at level 0 for tiles with enough tissue (checked on a thumbnail)."""
    level = slide.get_best_level_for_downsample(32)
    mask = tissue_mask_level(slide, level)
    down = slide.level_downsamples[level]
    w, h = slide.level_dimensions[0]
    for r in range(h // tile_px):
        for c in range(w // tile_px):
            y0, x0 = int(r * tile_px / down), int(c * tile_px / down)
            y1, x1 = max(y0 + 1, int((r + 1) * tile_px / down)), max(x0 + 1, int((c + 1) * tile_px / down))
            if mask[y0:y1, x0:x1].mean() < min_tissue:
                continue
            tile = slide.read_region((c * tile_px, r * tile_px), 0, (tile_px, tile_px)).convert("RGB")
            yield r, c, np.asarray(tile, dtype=np.float32) / 255.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slides", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--encoder", default="dinov2")
    ap.add_argument("--variant", default="dinov2_vits14")
    ap.add_argument("--tile-px", type=int, default=256, help="level-0 tile size (~0.25 µm/px → 64 µm)")
    ap.add_argument("--min-tissue", type=float, default=0.5)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--num-shards", type=int, default=1)
    args = ap.parse_args()

    import openslide

    from evidencemil.encoders import build_encoder

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    slides = sorted(p for p in Path(args.slides).rglob("*") if p.suffix.lower() in {".tif", ".svs"})
    mine = [p for i, p in enumerate(slides) if i % args.num_shards == args.shard]
    enc = build_encoder(args.encoder, variant=args.variant, batch_size=args.batch)
    print(f"{len(mine)} slides in shard {args.shard}/{args.num_shards}", flush=True)

    for p in mine:
        target = out / f"{p.stem}.npz"
        if target.exists():
            continue
        t0 = time.time()
        slide = openslide.OpenSlide(str(p))
        coords, embs, buf = [], [], []
        for r, c, tile in iter_tiles(slide, args.tile_px, args.min_tissue):
            coords.append((r, c))
            buf.append(tile)
            if len(buf) == args.batch:
                embs.append(enc.embed(np.stack(buf)).astype(np.float16))
                buf = []
        if buf:
            embs.append(enc.embed(np.stack(buf)).astype(np.float16))
        tmp = out / f"{p.stem}.tmp.npz"  # write-then-rename so a killed job never leaves a half file
        np.savez(tmp, embeddings=np.concatenate(embs) if embs else np.zeros((0, enc.dim), np.float16),
                 coords=np.asarray(coords, dtype=np.int32).reshape(-1, 2))
        tmp.replace(target)
        print(f"{p.stem}: {len(coords)} tiles in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
