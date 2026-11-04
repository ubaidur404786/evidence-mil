"""Train + evaluate a head from a config dict. Shared by the CLI and the tests.

Config keys: data {kind: toy|cache, ...}, encoder {name, ...}, head {name, ...}, train {...},
abstain {low, high}. Splits: train / val (temperature) / test (metrics).
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from evidencemil import metrics
from evidencemil.data.bags import BagDataset, EmbeddingCache, write_cache
from evidencemil.data.toy import ToyBag, make_dataset
from evidencemil.encoders import build_encoder
from evidencemil.explain import explain_bag
from evidencemil.mil import build_head
from evidencemil.mil.train import TrainConfig, fit_temperature, predict_logits, sigmoid, train_head
from evidencemil.pipeline.model import CaseModel, ModelSpec


@dataclass
class Result:
    model: CaseModel
    metrics: dict[str, float]
    history: list[float]


def toy_cache(directory: Path, bags: list[ToyBag], encoder_cfg: dict, prefix: str) -> EmbeddingCache:
    enc = build_encoder(encoder_cfg["name"], **_kwargs(encoder_cfg))
    write_cache(directory, [(f"{prefix}-{i:04d}", b.label, enc.embed(b.patches), b.coords)
                            for i, b in enumerate(bags)])
    return EmbeddingCache(directory)


def _kwargs(section: dict) -> dict:
    return {k: v for k, v in section.items() if k != "name"}


def _split_cache(cfg: dict, workdir: Path) -> tuple[dict[str, BagDataset], dict[str, list]]:
    data = cfg["data"]
    masks: dict[str, list] = {}
    if data["kind"] == "toy":
        sets = {}
        for split, seed_offset in (("train", 0), ("val", 1), ("test", 2)):
            bags = make_dataset(data[f"n_{split}"], seed=data.get("seed", 0) + 1000 * seed_offset,
                                grid=tuple(data.get("grid", (8, 8))))
            sets[split] = BagDataset(toy_cache(workdir / split, bags, cfg["encoder"], split))
            masks[split] = [b.patch_mask for b in bags]
        return sets, masks
    if data["kind"] == "cache":
        cache = EmbeddingCache(Path(data["dir"]))
        ids = {c.case_id: i for i, c in enumerate(cache.cases)}
        splits = data["splits"]  # {"train": [case_id, ...], "val": [...], "test": [...]}
        return {s: BagDataset(cache, [ids[c] for c in splits[s]]) for s in splits}, {}
    raise ValueError(f"unknown data kind {data['kind']!r}")


def run_experiment(cfg: dict, workdir: Path) -> Result:
    sets, masks = _split_cache(cfg, Path(workdir))
    dim = sets["train"].cache.dim
    head = build_head(cfg["head"]["name"], dim, **_kwargs(cfg["head"]))
    tcfg = TrainConfig(**cfg.get("train", {}))
    history = train_head(head, sets["train"], tcfg)

    val_logits, val_labels = predict_logits(head, sets["val"], tcfg.device)
    temperature = fit_temperature(val_logits, val_labels)
    test_logits, test_labels = predict_logits(head, sets["test"], tcfg.device)
    head.cpu()  # explanations, export and serving run on CPU
    probs = np.asarray(sigmoid(test_logits, temperature))
    result = {
        "auroc": metrics.auroc(test_labels, probs),
        "auprc": metrics.auprc(test_labels, probs),
        "ece": metrics.ece(test_labels, probs),
        "temperature": temperature,
    }
    if "test" in masks:
        contribs = [explain_bag(head, sets["test"][i][0]).contributions for i in range(len(sets["test"]))]
        result["loc_top1"] = metrics.localisation_hit_rate(contribs, masks["test"], k=1)
        result["loc_top1_chance"] = metrics.localisation_chance(masks["test"], k=1)

    ab = cfg.get("abstain", {})
    spec = ModelSpec(encoder=cfg["encoder"]["name"], encoder_kwargs=_kwargs(cfg["encoder"]),
                     head=cfg["head"]["name"], head_kwargs=_kwargs(cfg["head"]), dim=dim,
                     temperature=temperature, abstain_low=ab.get("low", 0.4),
                     abstain_high=ab.get("high", 0.6))
    torch.set_grad_enabled(True)
    return Result(CaseModel(spec, head), result, history)
