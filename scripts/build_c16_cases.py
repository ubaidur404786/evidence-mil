"""Real CAMELYON16 case bundles: our own 20x tiling + live Phikon features + pathologist annotation.

For each downloaded slide (data/c16/<id>.tif + .xml from scripts/download_c16.py):
  1. tile at 20x (224 px ≈ 112 µm), keep tissue tiles (saturation mask on a thumbnail), cap at --max-tiles
  2. encode every kept tile with Phikon (GPU if available) — the same encoder the upload path uses
  3. thumbnail (cropped to the tile grid), annotation overlay, per-tile tumour fraction, tissue crops

Why our own tiling (ADR-014): the public Phikon weights do not reproduce the cached Owkin vectors, and the
cached tile coordinates do not line up on every slide. Encoding our own tiles keeps placement, demo cases
and uploads consistent. The head was trained on the cached features; results/c16_localisation.md reports
how it behaves on these live features.

  uv run --no-sync python scripts/build_c16_cases.py --out data/demo_cases_c16
Needs the ml extras `wsi` and `phikon`. Writes only under data/ (git-ignored).
"""

import argparse
import io
import json
from pathlib import Path

import numpy as np

from evidencemil.data.wsi import (
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

TARGET_MPP = 0.5  # 20x
TILE_PX = 224
CROP_PX = 160
LABELS_CSV = "data/c16/reference.csv"


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


def tissue_tiles(slide, tile_l0: int, rows: int, cols: int, min_tissue: float = 0.5) -> np.ndarray:
    """(row, col) of tiles with enough tissue: saturation > 0.07 and not white, on a 4-px-per-tile thumbnail."""
    small = np.asarray(slide.get_thumbnail((cols * 4, rows * 4)).convert("RGB"), dtype=np.float32) / 255
    small = np.pad(small, ((0, max(0, rows * 4 - small.shape[0])), (0, max(0, cols * 4 - small.shape[1])), (0, 0)),
                   constant_values=1)[: rows * 4, : cols * 4]
    sat = small.max(-1) - small.min(-1)
    tissue = (sat > 0.07) & (small.mean(-1) < 0.9)
    frac = tissue.reshape(rows, 4, cols, 4).mean(axis=(1, 3))
    return np.argwhere(frac >= min_tissue)


def labels() -> dict[str, int]:
    import csv

    return {r["image"].removesuffix(".tif"): int(r["type"] == "tumor") for r in csv.DictReader(open(LABELS_CSV))}


def build(slide_path: Path, out: Path, encoder, max_px: int, max_tiles: int, label: int | None) -> dict:
    from PIL import Image

    sid = slide_path.stem
    slide = open_slide(slide_path)
    w, h = slide.dimensions
    mpp = float(slide.properties.get("openslide.mpp-x", 0.243))
    tile_l0 = round(TILE_PX * TARGET_MPP / mpp)
    rows, cols = h // tile_l0, w // tile_l0
    coords = tissue_tiles(slide, tile_l0, rows, cols)
    sampled = len(coords) > max_tiles
    if sampled:
        coords = coords[np.sort(np.random.default_rng(0).choice(len(coords), max_tiles, replace=False))]

    cdir = crops_dir(out, f"c16-{sid}")
    cdir.mkdir(parents=True, exist_ok=True)
    feats = []
    for i in range(0, len(coords), 64):
        tiles = [read_tile(slide, int(c * tile_l0), int(r * tile_l0), tile_l0, TILE_PX) for r, c in coords[i : i + 64]]
        feats.append(encoder.embed(np.stack(tiles)))
        for j, t in enumerate(tiles):
            buf = io.BytesIO()
            Image.fromarray(t).resize((CROP_PX, CROP_PX), Image.Resampling.BILINEAR).save(buf, format="JPEG", quality=85)
            (cdir / f"{i + j}.jpg").write_bytes(buf.getvalue())
    emb = np.concatenate(feats)

    thumb, scale = thumbnail(slide, max_px)
    canvas = thumb[: round(rows * tile_l0 / scale), : round(cols * tile_l0 / scale)]
    xml = slide_path.with_suffix(".xml")
    polys = load_asap_polygons(xml) if xml.exists() else []
    overlay = annotation_overlay(polygon_mask(polys, canvas.shape[:2], scale)) if polys else None
    reference = tile_tumour_fraction(polys, coords, tile_l0) if polys else np.zeros(len(coords), np.float32)

    meta = {
        "domain": "Lymph node metastasis (CAMELYON16)",
        "title": f"Sentinel lymph node · {sid}",
        "source": "Slide + annotation: CAMELYON16 (Radboud UMC / UMC Utrecht, CC0) · encoder: Phikon (Owkin, non-commercial)",
        "note": f"{len(coords)} tissue tiles at 20x{' (random sample)' if sampled else ''}; "
                f"pathologist outline {'shown' if polys else 'none (no tumour annotated)'}",
        "encoder": "phikon (live features, precomputed for the demo)", "tile_um": round(tile_l0 * mpp, 1),
        "pack": "c16", "has_annotation": bool(polys),
    }
    save_bundle(CaseBundle(f"c16-{sid}", canvas, (rows, cols), coords, emb, None, label, meta, overlay, reference), out)
    return {"case": sid, "tiles": len(coords), "grid": [rows, cols], "tile_l0": tile_l0,
            "annotated_tiles": int((reference >= 0.5).sum()), "label": label}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slides", default="data/c16")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-px", type=int, default=1600)
    ap.add_argument("--max-tiles", type=int, default=3000)
    ap.add_argument("--only", nargs="*", help="slide ids (default: all downloaded)")
    args = ap.parse_args()
    encoder = build_encoder("phikon")
    truth = labels()
    for p in sorted(Path(args.slides).glob("test_*.tif")):
        if args.only and p.stem not in args.only:
            continue
        if (Path(args.out) / f"c16-{p.stem}.json").exists():
            continue
        print(json.dumps(build(p, Path(args.out), encoder, args.max_px, args.max_tiles, truth.get(p.stem))), flush=True)


if __name__ == "__main__":
    main()
