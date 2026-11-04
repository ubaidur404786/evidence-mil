"""Cut an image into a grid of square patches and drop background patches."""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Tiles:
    patches: np.ndarray  # [N, P, P] or [N, P, P, C]
    coords: np.ndarray  # [N, 2] (row, col) in grid units
    grid: tuple[int, int]  # (rows, cols) of the full grid before filtering


def tissue_fraction(patch: np.ndarray, background_level: float) -> float:
    """Fraction of pixels darker than `background_level` (slides have a bright background)."""
    grey = patch.mean(axis=-1) if patch.ndim == 3 else patch
    return float((grey < background_level).mean())


def tile_image(
    image: np.ndarray,
    patch_size: int,
    background_level: float = 0.85,
    min_tissue: float = 0.0,
) -> Tiles:
    """Non-overlapping grid; the ragged right/bottom border is dropped.

    `image` is float in [0, 1], shape [H, W] or [H, W, C]. With `min_tissue=0` every patch is kept.
    """
    rows, cols = image.shape[0] // patch_size, image.shape[1] // patch_size
    if rows == 0 or cols == 0:
        raise ValueError(f"image {image.shape[:2]} smaller than patch_size {patch_size}")
    patches, coords = [], []
    for r in range(rows):
        for c in range(cols):
            p = image[r * patch_size : (r + 1) * patch_size, c * patch_size : (c + 1) * patch_size]
            if min_tissue <= 0 or tissue_fraction(p, background_level) >= min_tissue:
                patches.append(p)
                coords.append((r, c))
    if not patches:
        raise ValueError("every patch was filtered as background")
    return Tiles(np.stack(patches), np.asarray(coords, dtype=np.int64), (rows, cols))


def assemble_grid(patches: np.ndarray, coords: np.ndarray, grid: tuple[int, int]) -> np.ndarray:
    """Inverse of tiling for display: place patches back on a canvas (missing = 1.0, white)."""
    p = patches.shape[1]
    canvas = np.ones((grid[0] * p, grid[1] * p, *patches.shape[3:]), dtype=patches.dtype)
    for patch, (r, c) in zip(patches, coords, strict=True):
        canvas[r * p : (r + 1) * p, c * p : (c + 1) * p] = patch
    return canvas
