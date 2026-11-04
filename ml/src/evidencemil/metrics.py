"""Evaluation metrics: AUROC, AUPRC, ECE, localisation."""

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score


def auroc(labels: np.ndarray, scores: np.ndarray) -> float:
    return float(roc_auc_score(labels, scores))


def auprc(labels: np.ndarray, scores: np.ndarray) -> float:
    return float(average_precision_score(labels, scores))


def ece(labels: np.ndarray, probs: np.ndarray, n_bins: int = 10) -> float:
    """Expected calibration error with equal-width bins on P(class 1)."""
    bins = np.clip((probs * n_bins).astype(int), 0, n_bins - 1)
    total = 0.0
    for b in range(n_bins):
        m = bins == b
        if m.any():
            total += m.mean() * abs(probs[m].mean() - labels[m].mean())
    return float(total)


def localisation_hit_rate(contributions: list[np.ndarray], masks: list[np.ndarray], k: int = 1) -> float:
    """Share of positive bags whose top-k patches include at least one true positive patch."""
    hits = []
    for c, m in zip(contributions, masks, strict=True):
        if m.any():
            top = np.argsort(-c, kind="stable")[:k]
            hits.append(bool(m[top].any()))
    return float(np.mean(hits)) if hits else float("nan")


def localisation_chance(masks: list[np.ndarray], k: int = 1) -> float:
    """Expected hit rate when k patches are picked at random (no replacement)."""
    rates = []
    for m in masks:
        if m.any():
            n, p = len(m), int(m.sum())
            miss = 1.0
            for j in range(min(k, n)):
                miss *= (n - p - j) / (n - j)
            rates.append(1.0 - max(miss, 0.0))
    return float(np.mean(rates)) if rates else float("nan")
