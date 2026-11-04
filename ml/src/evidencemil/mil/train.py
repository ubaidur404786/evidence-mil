"""Training loop (one bag per step), prediction and temperature scaling."""

from dataclasses import dataclass

import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset


@dataclass
class TrainConfig:
    epochs: int = 20
    lr: float = 1e-3
    weight_decay: float = 1e-4
    seed: int = 0
    device: str = "cpu"


def bag_loss(logit: torch.Tensor, label: torch.Tensor) -> torch.Tensor:
    return nn.functional.binary_cross_entropy_with_logits(logit, label)


def train_head(head: nn.Module, data: Dataset, cfg: TrainConfig) -> list[float]:
    """Returns mean loss per epoch. Bags have different sizes, so we step per bag."""
    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)
    head.to(cfg.device).train()
    opt = torch.optim.AdamW(head.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    history = []
    for _ in range(cfg.epochs):
        total = 0.0
        for i in rng.permutation(len(data)):
            bag, label = data[int(i)]
            loss = bag_loss(head(bag.to(cfg.device))["logit"], label.to(cfg.device))
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item()
        history.append(total / max(len(data), 1))
    head.eval()
    return history


@torch.inference_mode()
def predict_logits(head: nn.Module, data: Dataset, device: str = "cpu") -> tuple[np.ndarray, np.ndarray]:
    head.eval()
    logits, labels = [], []
    for i in range(len(data)):
        bag, label = data[i]
        logits.append(head(bag.to(device))["logit"].item())
        labels.append(label.item())
    return np.asarray(logits), np.asarray(labels)


def fit_temperature(logits: np.ndarray, labels: np.ndarray, steps: int = 50) -> float:
    """Single scalar T > 0 minimising NLL of sigmoid(logit / T) on a held-out set."""
    x = torch.tensor(logits, dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.float32)
    log_t = torch.zeros((), requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=steps)

    def closure() -> torch.Tensor:
        opt.zero_grad()
        loss = nn.functional.binary_cross_entropy_with_logits(x / log_t.exp(), y)
        loss.backward()
        return loss

    opt.step(closure)
    return float(log_t.detach().exp().clamp(0.05, 20.0))


def sigmoid(x: np.ndarray | float, temperature: float = 1.0) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-np.asarray(x) / temperature))
