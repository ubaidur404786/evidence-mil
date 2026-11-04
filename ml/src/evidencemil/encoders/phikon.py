"""Phikon (Owkin, ViT-B/16, 768-d CLS token; non-commercial licence, see docs/DATA.md).

Same encoder that produced owkin/camelyon16-features, so tiles encoded live are comparable with the
cached features the head was trained on. Expects 224 x 224 RGB tiles at 20x (~0.5 µm/px).
"""

import numpy as np
import torch

from evidencemil.encoders.base import register

_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


@register("phikon")
class PhikonEncoder:
    name = "phikon"
    dim = 768

    def __init__(self, device: str | None = None, batch_size: int = 32, **_):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.batch_size = batch_size
        self._model = None

    def _load(self):
        if self._model is None:
            from transformers import ViTModel

            self._model = ViTModel.from_pretrained("owkin/phikon", add_pooling_layer=False)
            self._model.eval().to(self.device)
        return self._model

    @torch.inference_mode()
    def embed(self, patches: np.ndarray) -> np.ndarray:
        """patches [N, 224, 224, 3] float in [0, 1] (or uint8) -> [N, 768] float32."""
        model = self._load()
        out = []
        for i in range(0, len(patches), self.batch_size):
            x = torch.from_numpy(np.ascontiguousarray(patches[i : i + self.batch_size])).float()
            if x.max() > 1.5:  # uint8 input
                x = x / 255.0
            x = x.permute(0, 3, 1, 2)
            if x.shape[-1] != 224:
                x = torch.nn.functional.interpolate(x, size=224, mode="bilinear", antialias=True)
            x = ((x - _MEAN) / _STD).to(self.device)
            with torch.autocast("cuda", enabled=self.device == "cuda"):
                cls = model(pixel_values=x).last_hidden_state[:, 0]
            out.append(cls.float().cpu())
        return torch.cat(out).numpy()
