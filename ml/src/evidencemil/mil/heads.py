"""MIL heads. Each maps a bag [N, D] to {logit [], contributions [N], attention [N]}.

`contributions` are exact for `mean` and `additive` (sum + bias == logit). For `abmil` the
classifier is non-linear on the pooled vector, so contributions are attention * logit (a proxy).
"""

import torch
from torch import nn


class GatedAttention(nn.Module):
    """Ilse et al. 2018 gated attention: a_i = softmax(w · (tanh(V h_i) * sigmoid(U h_i)))."""

    def __init__(self, dim: int, hidden: int):
        super().__init__()
        self.v = nn.Linear(dim, hidden)
        self.u = nn.Linear(dim, hidden)
        self.w = nn.Linear(hidden, 1)

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        scores = self.w(torch.tanh(self.v(h)) * torch.sigmoid(self.u(h))).squeeze(-1)
        return torch.softmax(scores, dim=0)


class MeanHead(nn.Module):
    def __init__(self, dim: int, **_):
        super().__init__()
        self.classifier = nn.Linear(dim, 1)

    def forward(self, h: torch.Tensor) -> dict[str, torch.Tensor]:
        n = h.shape[0]
        attention = torch.full((n,), 1.0 / n, device=h.device)
        contributions = attention * (h @ self.classifier.weight.squeeze(0))
        logit = contributions.sum() + self.classifier.bias.squeeze(0)
        return {"logit": logit, "contributions": contributions, "attention": attention,
                "bias": self.classifier.bias.squeeze(0)}


class ABMILHead(nn.Module):
    def __init__(self, dim: int, hidden: int = 64, dropout: float = 0.1, **_):
        super().__init__()
        self.embed = nn.Sequential(nn.Linear(dim, hidden), nn.ReLU(), nn.Dropout(dropout))
        self.attention = GatedAttention(hidden, hidden)
        self.classifier = nn.Sequential(nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, 1))

    def forward(self, h: torch.Tensor) -> dict[str, torch.Tensor]:
        z = self.embed(h)
        a = self.attention(z)
        logit = self.classifier((a.unsqueeze(-1) * z).sum(0)).squeeze(0)
        bias = torch.zeros((), device=h.device)
        return {"logit": logit, "contributions": a * logit, "attention": a, "bias": bias}


class AdditiveHead(nn.Module):
    """Ours: a = softmax(gated_attention(z)), e_i = a_i * (w · z_i), logit = Σ e_i + b."""

    def __init__(self, dim: int, hidden: int = 64, dropout: float = 0.1, **_):
        super().__init__()
        self.embed = nn.Sequential(nn.Linear(dim, hidden), nn.ReLU(), nn.Dropout(dropout))
        self.attention = GatedAttention(hidden, hidden)
        self.patch_score = nn.Linear(hidden, 1, bias=False)
        self.bias = nn.Parameter(torch.zeros(()))

    def forward(self, h: torch.Tensor) -> dict[str, torch.Tensor]:
        z = self.embed(h)
        a = self.attention(z)
        contributions = a * self.patch_score(z).squeeze(-1)
        return {"logit": contributions.sum() + self.bias, "contributions": contributions,
                "attention": a, "bias": self.bias}


HEADS = {"mean": MeanHead, "abmil": ABMILHead, "additive": AdditiveHead}


def build_head(name: str, dim: int, **kwargs) -> nn.Module:
    if name not in HEADS:
        raise KeyError(f"unknown head {name!r}; known: {sorted(HEADS)}")
    return HEADS[name](dim=dim, **kwargs)
