"""Whole-slide helpers: thumbnails, tile crops, tumour annotations (ASAP XML) and their masks.

Needs the optional `wsi` extra (openslide, pillow). Coordinates are level-0 pixels unless stated.
Tile geometry follows the Owkin CAMELYON16 features: a DeepZoom grid of 224 px tiles at a fixed
DeepZoom level; `tile_size_level0` converts that grid to level-0 pixels.
"""

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class TileGrid:
    tile_px: int  # tile edge in level-0 pixels
    out_px: int  # tile edge as fed to the encoder


def deepzoom_tile_size_level0(width: int, height: int, dz_level: int, tile: int = 224) -> int:
    """DeepZoom: level L_max = ceil(log2(max dim)) is full resolution; each level below halves it."""
    max_level = math.ceil(math.log2(max(width, height)))
    return tile * 2 ** (max_level - dz_level)


def open_slide(path: Path):
    import openslide

    return openslide.OpenSlide(str(path))


def thumbnail(slide, max_px: int) -> tuple[np.ndarray, float]:
    """RGB uint8 thumbnail with the longer side <= max_px, and level-0 px per thumbnail px."""
    w, h = slide.dimensions
    scale = max(w, h) / max_px
    img = slide.get_thumbnail((int(w / scale), int(h / scale))).convert("RGB")
    return np.asarray(img), w / img.size[0]


def read_tile(slide, x0: int, y0: int, size_l0: int, out_px: int) -> np.ndarray:
    """Tile at level-0 (x0, y0) with edge size_l0, read from the best pyramid level, resized to out_px."""
    from PIL import Image

    level = slide.get_best_level_for_downsample(size_l0 / out_px)
    down = slide.level_downsamples[level]
    side = int(round(size_l0 / down))
    img = slide.read_region((x0, y0), level, (side, side)).convert("RGB")
    if img.size[0] != out_px:
        img = img.resize((out_px, out_px), Image.Resampling.BILINEAR)
    return np.asarray(img)


def load_asap_polygons(path: Path) -> list[np.ndarray]:
    """Tumour polygons from a CAMELYON ASAP annotation file (exclusion group '_2' is skipped)."""
    polys = []
    for ann in ET.parse(path).getroot().iter("Annotation"):
        if ann.get("PartOfGroup") == "_2":
            continue
        pts = [(float(c.get("X")), float(c.get("Y"))) for c in ann.iter("Coordinate")]
        if len(pts) >= 3:
            polys.append(np.asarray(pts))
    return polys


def polygon_mask(polys: list[np.ndarray], shape: tuple[int, int], px_per_cell: float) -> np.ndarray:
    """Rasterise level-0 polygons onto a [H, W] bool grid where one cell = px_per_cell level-0 px."""
    from PIL import Image, ImageDraw

    img = Image.new("L", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(img)
    for p in polys:
        # -0.5: PIL fills pixels by their corner; shift so a cell counts when its centre is inside.
        draw.polygon([tuple(xy) for xy in (p / px_per_cell - 0.5)], fill=1)
    return np.asarray(img, dtype=bool)


def tile_tumour_fraction(polys: list[np.ndarray], coords: np.ndarray, tile_l0: int,
                         samples: int = 4) -> np.ndarray:
    """Share of each tile (row, col coords) covered by tumour polygons, on a samples x samples raster."""
    if not polys or len(coords) == 0:
        return np.zeros(len(coords), dtype=np.float32)
    rows, cols = coords.max(axis=0) + 1
    mask = polygon_mask(polys, (int(rows) * samples, int(cols) * samples), tile_l0 / samples)
    blocks = mask.reshape(int(rows), samples, int(cols), samples).mean(axis=(1, 3))
    return blocks[coords[:, 0], coords[:, 1]].astype(np.float32)
