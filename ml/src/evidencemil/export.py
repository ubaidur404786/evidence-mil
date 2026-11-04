"""ONNX export of a MIL head. Outputs: logit [], contributions [N], attention [N]; N is dynamic."""

from pathlib import Path

import torch
from torch import nn


class _Wrapper(nn.Module):
    def __init__(self, head: nn.Module):
        super().__init__()
        self.head = head

    def forward(self, bag: torch.Tensor):
        out = self.head(bag)
        return out["logit"], out["contributions"], out["attention"]


def export_onnx(head: nn.Module, dim: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    head.eval()
    torch.onnx.export(
        _Wrapper(head), (torch.randn(16, dim),), str(path),
        input_names=["bag"], output_names=["logit", "contributions", "attention"],
        dynamic_axes={"bag": {0: "n"}, "contributions": {0: "n"}, "attention": {0: "n"}},
        opset_version=17, dynamo=False,
    )
