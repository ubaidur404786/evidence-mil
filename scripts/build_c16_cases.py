"""Real CAMELYON16 case bundles: slide thumbnail + pathologist annotation + cached Phikon features.

For each downloaded slide (data/c16/<id>.tif, from scripts/download_c16.sh) that is in the cache:
  1. place the cached tiles on the slide (DeepZoom level 17 grid of 224 px tiles, as in the Owkin features)
  2. check that placement: re-encode a few tiles with Phikon and compare with the cached vectors
  3. thumbnail (padded to the tile grid), annotation overlay, per-tile tumour fraction, tissue crops

  uv run --no-sync python scripts/build_c16_cases.py --cache data/cache_phikon --out data/demo_cases_c16
Needs the ml extras `wsi` and `phikon`. Writes only under data/ (git-ignored).
"""

import argparse
import io
import json
import math
from pathlib import Path

import numpy as np

from evidencemil.data.bags import EmbeddingCache
from evidencemil.data.wsi import (
    deepzoom_tile_size_level0,
    load_asap_polygons,
    open_slide,
    polygon_mask,
    read_tile,
    thumbnail,
    tile_tumour_fraction,
)
from evidencemil.encoders import build_encoder
from evidencemil.pipeline import CaseBundle, save_bundle
from evidencemil.pipeline.bundle import crops_dir

DZ_LEVEL = 17
CROP_PX = 160


def annotation_overlay(mask: np.ndarray) -> np.ndarray:
    """RGBA: translucent fill + solid outline (outline = mask minus its 1-px erosion)."""
    inner = mask.copy()
    inner[1:, :] &= mask[:-1, :]
    inner[:-1, :] &= mask[1:, :]
    inner[:, 1:] &= mask[:, :-1]
    inner[:, :-1] &= mask[:, 1:]
    edge = mask & ~inner
    rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
    rgba[mask] = (0, 170, 120, 45)
    rgba[edge] = (0, 150, 100, 255)
    return rgba


def check_alignment(slide, coords: np.ndarray, emb: np.ndarray, tile_l0: int, encoder, n: int = 24) -> float:
    rng = np.random.default_rng(0)
    pick = rng.choice(len(coords), size=min(n, len(coords)), replace=False)
    tiles = np.stack([read_tile(slide, int(c * tile_l0), int(r * tile_l0), tile_l0, 224)
                      for r, c in coords[pick]])
    live = encoder.embed(tiles)
    ref = emb[pick]
    cos = (live * ref).sum(1) / (np.linalg.norm(live, axis=1) * np.linalg.norm(ref, axis=1))
    return float(np.median(cos))


def build(slide_path: Path, cache: EmbeddingCache, out: Path, encoder, max_px: int) -> dict:
    from PIL import Image

    sid = slide_path.stem
    emb, entry = cache.by_id(sid)
    coords = np.asarray(entry.coords)
    slide = open_slide(slide_path)
    w, h = slide.dimensions
    tile_l0 = deepzoom_tile_size_level0(w, h, DZ_LEVEL)
    cosine = check_alignment(slide, coords, emb, tile_l0, encoder)

    rows, cols = math.ceil(h / tile_l0), math.ceil(w / tile_l0)
    thumb, scale = thumbnail(slide, max_px)
    canvas = np.full((round(rows * tile_l0 / scale), round(cols * tile_l0 / scale), 3), 255, np.uint8)
    canvas[: min(thumb.shape[0], canvas.shape[0]), : min(thumb.shape[1], canvas.shape[1])] = \
        thumb[: canvas.shape[0], : canvas.shape[1]]

    xml = slide_path.with_suffix(".xml")
    polys = load_asap_polygons(xml) if xml.exists() else []
    overlay = annotation_overlay(polygon_mask(polys, canvas.shape[:2], scale)) if polys else None
    reference = tile_tumour_fraction(polys, coords, tile_l0)

    cdir = crops_dir(out, f"c16-{sid}")
    cdir.mkdir(parents=True, exist_ok=True)
    for pid, (r, c) in enumerate(coords):
        buf = io.BytesIO()
        Image.fromarray(read_tile(slide, int(c * tile_l0), int(r * tile_l0), tile_l0, CROP_PX)).save(
            buf, format="JPEG", quality=85)
        (cdir / f"{pid}.jpg").write_bytes(buf.getvalue())

    mpp = float(slide.properties.get("openslide.mpp-x", 0.243))
    meta = {
        "domain": "CAMELYON16 · sentinel lymph node",
        "title": f"Lymph node slide {sid}",
        "source": "CAMELYON16 (Radboud UMC / UMC Utrecht, CC0) · features: Phikon (Owkin, non-commercial)",
        "note": f"{len(coords)} tissue tiles sampled by the feature set; pathologist annotation "
                f"{'shown' if polys else 'none (normal slide)'}",
        "encoder": "phikon (cached)", "tile_um": round(tile_l0 * mpp, 1),
        "alignment_cosine": round(cosine, 4), "pack": "c16", "has_annotation": bool(polys),
    }
    save_bundle(CaseBundle(f"c16-{sid}", canvas, (rows, cols), coords, emb, None, entry.label, meta,
                           overlay, reference), out)
    return {"case": sid, "tile_l0": tile_l0, "grid": [rows, cols], "alignment_cosine": round(cosine, 4),
            "annotated_tiles": int((reference >= 0.5).sum()), "label": entry.label}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--slides", default="data/c16")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-px", type=int, default=1600)
    args = ap.parse_args()
    cache = EmbeddingCache(Path(args.cache))
    known = {c.case_id for c in cache.cases}
    encoder = build_encoder("phikon")
    for p in sorted(Path(args.slides).glob("test_*.tif")):
        if p.stem in known:
            print(json.dumps(build(p, cache, Path(args.out), encoder, args.max_px)), flush=True)


if __name__ == "__main__":
    main()
