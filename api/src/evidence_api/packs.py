"""Domain packs: one trained head + its cases (+ optional live encoder for uploads).

Configured with EVIDENCE_PACKS (a JSON list, or a path to a JSON file), e.g.
  [{"name": "toy", "title": "Synthetic toy", "cases_dir": "data/demo_cases", "model_dir": "data/model",
    "live_encoder": "fake", "patch_px": 16, "min_tissue": 0},
   {"name": "c16", "title": "Lymph node (CAMELYON16)", "cases_dir": "data/demo_cases_c16",
    "model_dir": "results/raw/cache_phikon_additive", "live_encoder": "phikon", "patch_px": 224,
    "min_tissue": 0.5, "tile_um": 112}]
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from evidencemil.encoders import build_encoder
from evidencemil.pipeline import CaseModel, load_model


@dataclass
class Pack:
    name: str
    cases_dir: Path
    model_dir: Path
    title: str = ""
    live_encoder: str | None = None  # needed to encode uploads; None = cached cases only
    encoder_kwargs: dict = field(default_factory=dict)
    patch_px: int = 224  # upload tile size in image pixels (224 px at 20x for c16)
    min_tissue: float = 0.5  # drop upload tiles with less tissue than this (0 = keep all)
    tile_um: float | None = None
    _model: CaseModel | None = field(default=None, repr=False)
    _encoder: object | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.cases_dir, self.model_dir = Path(self.cases_dir), Path(self.model_dir)
        self.title = self.title or self.name

    @property
    def uploads_dir(self) -> Path:
        return self.cases_dir / "uploads"

    def model(self) -> CaseModel:
        if self._model is None:
            self._model = load_model(self.model_dir)
        return self._model

    def encoder(self):
        if self.live_encoder is None:
            return None
        if self._encoder is None:
            self._encoder = build_encoder(self.live_encoder, **self.encoder_kwargs)
        return self._encoder

    def public(self) -> dict:
        return {"name": self.name, "title": self.title, "upload": self.live_encoder is not None,
                "patch_px": self.patch_px, "tile_um": self.tile_um}


def packs_from_env() -> list[Pack]:
    raw = os.environ.get("EVIDENCE_PACKS")
    if raw:
        spec = json.loads(Path(raw).read_text() if not raw.lstrip().startswith("[") else raw)
        return [Pack(**p) for p in spec]
    return [Pack("toy", os.environ.get("EVIDENCE_CASES_DIR", "data/demo_cases"),
                 os.environ.get("EVIDENCE_MODEL_DIR", "data/model"), title="Synthetic toy",
                 live_encoder="fake", encoder_kwargs={"dim": 32}, patch_px=16, min_tissue=0)]
