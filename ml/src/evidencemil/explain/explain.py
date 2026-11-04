"""Explanations. All work on one bag; the head is re-run for what-if deletions."""

from dataclasses import dataclass

import numpy as np
import torch
from torch import nn

from evidencemil.mil.train import sigmoid


@dataclass
class BagExplanation:
    logit: float
    bias: float
    probability: float
    contributions: np.ndarray  # [N]
    attention: np.ndarray  # [N]


@torch.inference_mode()
def explain_bag(head: nn.Module, bag: torch.Tensor, temperature: float = 1.0) -> BagExplanation:
    head.eval()
    out = head(bag)
    logit = float(out["logit"])
    return BagExplanation(
        logit=logit,
        bias=float(out["bias"]),
        probability=float(sigmoid(logit, temperature)),
        contributions=out["contributions"].cpu().numpy(),
        attention=out["attention"].cpu().numpy(),
    )


def top_k(contributions: np.ndarray, k: int) -> list[int]:
    """Indices of the k largest positive-direction contributions (ties broken by index)."""
    order = np.argsort(-contributions, kind="stable")
    return [int(i) for i in order[: min(k, len(order))]]


@torch.inference_mode()
def deletion_curve(head: nn.Module, bag: torch.Tensor, order: list[int], max_removed: int,
                   temperature: float = 1.0) -> list[tuple[int, float]]:
    """Remove patches in `order`, re-run the head, return (removed, probability) pairs.

    The last patch is never removed (an empty bag has no score).
    """
    head.eval()
    keep = np.ones(bag.shape[0], dtype=bool)
    points = [(0, float(sigmoid(float(head(bag)["logit"]), temperature)))]
    for removed, idx in enumerate(order[: min(max_removed, bag.shape[0] - 1)], start=1):
        keep[idx] = False
        logit = float(head(bag[torch.from_numpy(keep)])["logit"])
        points.append((removed, float(sigmoid(logit, temperature))))
    return points


def heatmap_grid(values: np.ndarray, coords: np.ndarray, grid: tuple[int, int]) -> np.ndarray:
    """Place per-patch values on the tile grid; filtered-out cells are NaN."""
    out = np.full(grid, np.nan, dtype=np.float32)
    out[coords[:, 0], coords[:, 1]] = values
    return out


@torch.inference_mode()
def random_weight_check(head: nn.Module, fresh_head: nn.Module, bags: list[torch.Tensor]) -> float:
    """Sanity check (Adebayo et al. 2018): mean Spearman correlation between contributions of the
    trained head and a randomly initialised head of the same type. Should be near 0."""
    from scipy.stats import spearmanr

    head.eval()
    fresh_head.eval()
    rhos = []
    for bag in bags:
        a = head(bag)["contributions"].numpy()
        b = fresh_head(bag)["contributions"].numpy()
        if len(a) > 2:
            rhos.append(spearmanr(a, b).statistic)
    return float(np.nanmean(rhos)) if rhos else float("nan")
