"""DINOv2 wrapper (Apache-2.0, see docs/DATA.md). Weights download on first use via torch.hub.

Used for embedding extraction (scripts/extract_embeddings.py), not in unit tests.
"""

import numpy as np
import torch

from evidencemil.encoders.base import register

_DIMS = {"dinov2_vits14": 384, "dinov2_vitb14": 768}
_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


@register("dinov2")
class DinoV2Encoder:
    def __init__(self, variant: str = "dinov2_vits14", device: str | None = None,
                 batch_size: int = 64, input_size: int = 224):
        self.name = variant
        self.dim = _DIMS[variant]
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.batch_size = batch_size
        self.input_size = input_size
        self._model = None

    def _load(self) -> torch.nn.Module:
        if self._model is None:
            self._model = torch.hub.load("facebookresearch/dinov2", self.name).eval().to(self.device)
        return self._model

    @torch.inference_mode()
    def embed(self, patches: np.ndarray) -> np.ndarray:
        model = self._load()
        out = []
        for i in range(0, len(patches), self.batch_size):
            x = torch.from_numpy(np.ascontiguousarray(patches[i : i + self.batch_size])).float()
            if x.ndim == 3:  # grey -> RGB
                x = x.unsqueeze(-1).repeat(1, 1, 1, 3)
            x = x.permute(0, 3, 1, 2)
            x = torch.nn.functional.interpolate(x, size=self.input_size, mode="bilinear")
            x = ((x - _MEAN) / _STD).to(self.device)
            with torch.autocast(self.device, enabled=self.device == "cuda"):
                out.append(model(x).float().cpu())
        return torch.cat(out).numpy()
