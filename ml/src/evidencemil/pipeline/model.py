"""A trained case model = encoder name + head weights + temperature + abstain band."""

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import torch
from torch import nn

from evidencemil.encoders import build_encoder
from evidencemil.mil import build_head


@dataclass
class ModelSpec:
    encoder: str
    encoder_kwargs: dict
    head: str
    head_kwargs: dict
    dim: int
    temperature: float = 1.0
    abstain_low: float = 0.4  # abstain when low < probability < high
    abstain_high: float = 0.6


@dataclass
class CaseModel:
    spec: ModelSpec
    head: nn.Module

    def encoder(self):
        return build_encoder(self.spec.encoder, **self.spec.encoder_kwargs)

    def abstains(self, probability: float) -> bool:
        return self.spec.abstain_low < probability < self.spec.abstain_high


def save_model(model: CaseModel, directory: Path) -> None:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    torch.save(model.head.state_dict(), directory / "head.pt")
    (directory / "spec.json").write_text(json.dumps(asdict(model.spec), indent=1))


def load_model(directory: Path) -> CaseModel:
    directory = Path(directory)
    spec = ModelSpec(**json.loads((directory / "spec.json").read_text()))
    head = build_head(spec.head, spec.dim, **spec.head_kwargs)
    head.load_state_dict(torch.load(directory / "head.pt", map_location="cpu", weights_only=True))
    return CaseModel(spec, head.eval())
