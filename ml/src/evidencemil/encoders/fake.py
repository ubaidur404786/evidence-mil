"""Fake encoder for tests and the toy demo: cheap hand-made features + fixed random projection.

It stands in for a pretrained model so the whole pipeline runs on CPU in seconds.
"""

import numpy as np

from evidencemil.encoders.base import register


@register("fake")
class FakeEncoder:
    name = "fake"

    def __init__(self, dim: int = 32, seed: int = 0):
        self.dim = dim
        self._proj = np.random.default_rng(seed).standard_normal((6, dim)).astype(np.float32)

    def embed(self, patches: np.ndarray) -> np.ndarray:
        x = patches.mean(axis=-1) if patches.ndim == 4 else patches  # grey [N, P, P]
        x = x.astype(np.float32)
        mid = x.shape[1] // 2
        row_band = x[:, mid - 1 : mid + 2, :].mean(axis=(1, 2))
        col_band = x[:, :, mid - 1 : mid + 2].mean(axis=(1, 2))
        feats = np.stack([
            x.mean(axis=(1, 2)),
            x.std(axis=(1, 2)),
            x.max(axis=(1, 2)),
            row_band,
            col_band,
            row_band + col_band - 2 * x.mean(axis=(1, 2)),  # "cross-ness"
        ], axis=1)
        return np.tanh(feats @ self._proj).astype(np.float32)


@register("precomputed")
class PrecomputedEncoder:
    """Marker for models trained on precomputed features: cases must ship cached embeddings."""

    name = "precomputed"

    def __init__(self, dim: int = 0):
        self.dim = dim

    def embed(self, patches: np.ndarray) -> np.ndarray:
        raise RuntimeError("this model was trained on precomputed features; use cached embeddings")
