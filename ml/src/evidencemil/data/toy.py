"""Synthetic toy task: a bright pattern hidden in noise patches.

A bag is a grid of small grey-noise patches. In positive bags a few patches carry a bright
cross. The bag label is 1 iff at least one patch is positive (standard MIL assumption),
and the per-patch mask is ground truth for localisation tests.
"""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ToyBag:
    patches: np.ndarray  # [N, P, P] float32 in [0, 1]
    coords: np.ndarray  # [N, 2] int (row, col)
    patch_mask: np.ndarray  # [N] bool, True where the pattern is present
    label: int


def _cross(size: int) -> np.ndarray:
    img = np.zeros((size, size), dtype=np.float32)
    mid = size // 2
    img[mid - 1 : mid + 2, :] = 1.0
    img[:, mid - 1 : mid + 2] = 1.0
    return img


def make_bag(
    rng: np.random.Generator,
    label: int,
    grid: tuple[int, int] = (8, 8),
    patch_size: int = 16,
    n_positive: tuple[int, int] = (1, 4),
    noise: float = 0.15,
    strength: float = 0.6,
) -> ToyBag:
    rows, cols = grid
    n = rows * cols
    patches = (0.3 + noise * rng.standard_normal((n, patch_size, patch_size))).astype(np.float32)
    mask = np.zeros(n, dtype=bool)
    if label == 1:
        k = int(rng.integers(n_positive[0], n_positive[1] + 1))
        mask[rng.choice(n, size=k, replace=False)] = True
        patches[mask] += strength * _cross(patch_size)
    coords = np.stack(np.divmod(np.arange(n), cols), axis=1).astype(np.int64)
    return ToyBag(np.clip(patches, 0.0, 1.0), coords, mask, label)


def make_dataset(n_bags: int, seed: int = 0, positive_rate: float = 0.5, **kw) -> list[ToyBag]:
    rng = np.random.default_rng(seed)
    labels = (rng.random(n_bags) < positive_rate).astype(int)
    return [make_bag(rng, int(y), **kw) for y in labels]
