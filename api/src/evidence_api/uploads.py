"""Turn an uploaded image into a case bundle: tile, drop background, keep raw patches for live encoding.

Whole-slide files (.svs/.tif pyramids, gigapixels) go through scripts/extract_embeddings.py instead.
Uploads are processed locally only; nothing is sent to any third-party service.
"""

import io
import re
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

from evidence_api.packs import Pack
from evidencemil.data.tiler import tile_image
from evidencemil.pipeline import CaseBundle, save_bundle
from evidencemil.pipeline.bundle import crops_dir

MAX_SIDE = 8192
MAX_PATCHES = 1500
THUMB_PX = 1600
CROP_PX = 160


class UploadError(ValueError):
    pass


def _safe_title(name: str) -> str:
    return re.sub(r"[^\w.\- ]", "_", Path(name).name)[:80] or "upload"


def image_to_bundle(data: bytes, filename: str, pack: Pack) -> CaseBundle:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # PIL raises many types for bad files
        raise UploadError(f"not a readable image: {exc}") from exc
    if max(img.size) > MAX_SIDE:
        raise UploadError(f"image is {img.size[0]}x{img.size[1]} px; max side is {MAX_SIDE}. "
                          "Use scripts/extract_embeddings.py for whole slides.")
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    if min(rgb.shape[:2]) < pack.patch_px:
        raise UploadError(f"image is smaller than one {pack.patch_px} px tile")

    tiles = tile_image(rgb, pack.patch_px, background_level=0.8, min_tissue=pack.min_tissue)
    if len(tiles.patches) > MAX_PATCHES:
        raise UploadError(f"{len(tiles.patches)} tissue tiles; max is {MAX_PATCHES}. Crop the region of interest.")

    rows, cols = tiles.grid
    region = rgb[: rows * pack.patch_px, : cols * pack.patch_px]
    scale = max(1.0, max(region.shape[:2]) / THUMB_PX)
    thumb = Image.fromarray((region * 255).astype(np.uint8))
    thumb = thumb.resize((round(region.shape[1] / scale), round(region.shape[0] / scale)),
                         Image.Resampling.LANCZOS)

    case_id = f"up-{uuid.uuid4().hex[:8]}"
    return CaseBundle(
        case_id, np.asarray(thumb), tiles.grid, tiles.coords, None,
        (tiles.patches * 255).round().astype(np.uint8), None,
        {"title": _safe_title(filename), "domain": pack.title, "pack": pack.name,
         "source": "uploaded image (processed locally)", "tile_um": pack.tile_um,
         "note": f"{len(tiles.patches)} tissue tiles of {pack.patch_px} px; encoded live on run"},
    )


def save_upload(bundle: CaseBundle, pack: Pack) -> None:
    save_bundle(bundle, pack.uploads_dir)
    cdir = crops_dir(pack.uploads_dir, bundle.case_id)
    cdir.mkdir(parents=True, exist_ok=True)
    for pid, patch in enumerate(bundle.patches):
        im = Image.fromarray(patch if patch.ndim == 3 else np.stack([patch] * 3, -1))
        buf = io.BytesIO()
        im.resize((CROP_PX, CROP_PX), Image.Resampling.BILINEAR).save(buf, format="JPEG", quality=85)
        (cdir / f"{pid}.jpg").write_bytes(buf.getvalue())
