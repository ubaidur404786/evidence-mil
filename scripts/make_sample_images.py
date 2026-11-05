"""Upload-ready sample images: a 20x crop around the annotated tumour of downloaded CAMELYON16 slides (CC0).

  uv run --no-sync python scripts/make_sample_images.py test_001 test_027 test_065 --out data/samples
Each crop is SIZE x SIZE px at 0.5 µm/px (the 224 px / 112 µm tiling the c16 pack expects). The files are
published as a GitHub release asset, not committed (data stays out of git).
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

from evidencemil.data.wsi import load_asap_polygons, open_slide

ROOT = Path(__file__).parents[1]
TARGET_MPP = 0.5


def crop(slide_id: str, size: int, out: Path) -> Path:
    slide = open_slide(ROOT / "data/c16" / f"{slide_id}.tif")
    mpp = float(slide.properties.get("openslide.mpp-x", 0.243))
    polys = load_asap_polygons(ROOT / "data/c16" / f"{slide_id}.xml")
    # Centre on the largest annotated tumour region.
    big = max(polys, key=lambda p: np.ptp(p[:, 0]) * np.ptp(p[:, 1]))
    cx, cy = big.mean(axis=0)
    side_l0 = round(size * TARGET_MPP / mpp)
    level = slide.get_best_level_for_downsample(side_l0 / size)
    ds = slide.level_downsamples[level]
    region = slide.read_region((int(cx - side_l0 / 2), int(cy - side_l0 / 2)), level,
                               (round(side_l0 / ds), round(side_l0 / ds))).convert("RGB")
    path = out / f"camelyon16_{slide_id}_tumour_20x.jpg"
    region.resize((size, size), Image.Resampling.LANCZOS).save(path, quality=90)
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slides", nargs="+")
    ap.add_argument("--size", type=int, default=2240)
    ap.add_argument("--out", default="data/samples")
    args = ap.parse_args()
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    for s in args.slides:
        p = crop(s, args.size, out)
        print(p.name, f"{p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
