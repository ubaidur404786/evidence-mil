"""run_case(): the six pipeline stages as a generator of StepEvents (contracts).

The report stage is injected (`report_fn`) because `ml` must not import `agent`.
"""

import time
from collections.abc import Callable, Iterator

import numpy as np
import torch

from evidence_contracts import Evidence, StepEvent
from evidencemil.explain import deletion_curve, explain_bag, top_k
from evidencemil.pipeline.bundle import CaseBundle
from evidencemil.pipeline.model import CaseModel
from evidencemil.pipeline.png import png_data_url

STEPS = ["input", "tile", "encode", "aggregate", "explain", "report"]
ReportFn = Callable[[Evidence], dict]


def project_2d(x: np.ndarray) -> np.ndarray:
    """PCA to 2-D, scaled to [-1, 1] per axis, for the 'encode' scatter animation."""
    centred = x - x.mean(axis=0, keepdims=True)
    if len(x) < 2:
        return np.zeros((len(x), 2), dtype=np.float32)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    p = centred @ vt[:2].T
    if p.shape[1] < 2:
        p = np.pad(p, ((0, 0), (0, 2 - p.shape[1])))
    scale = np.abs(p).max(axis=0, keepdims=True)
    return (p / np.where(scale == 0, 1, scale)).astype(np.float32)


def _r(x: float) -> float:
    return round(float(x), 4)


def run_case(bundle: CaseBundle, model: CaseModel, report_fn: ReportFn | None = None,
             k: int = 5, curve_len: int = 10) -> Iterator[StepEvent]:
    def event(i: int, payload: dict, started: float, cached: bool = False) -> StepEvent:
        return StepEvent(case_id=bundle.case_id, step=STEPS[i], index=i, payload=payload,
                         cached=cached, elapsed_ms=_r((time.perf_counter() - started) * 1000))

    t = time.perf_counter()
    yield event(0, {"thumbnail": png_data_url(bundle.thumbnail), "title": bundle.meta.get("title", ""),
                    "domain": bundle.meta.get("domain", ""), "reference_label": bundle.label}, t)

    t = time.perf_counter()
    yield event(1, {"rows": bundle.grid[0], "cols": bundle.grid[1],
                    "coords": bundle.coords.tolist(), "n_patches": len(bundle.coords)}, t)

    t = time.perf_counter()
    if bundle.cached:
        emb = bundle.embeddings
    else:
        emb = model.encoder().embed(bundle.patches)
    yield event(2, {"encoder": model.spec.encoder, "dim": int(emb.shape[1]),
                    "projection": np.round(project_2d(emb), 4).tolist()}, t, cached=bundle.cached)

    t = time.perf_counter()
    bag = torch.from_numpy(np.asarray(emb, dtype=np.float32))
    ex = explain_bag(model.head, bag, model.spec.temperature)
    abstain = model.abstains(ex.probability)
    yield event(3, {"head": model.spec.head, "logit": _r(ex.logit), "bias": _r(ex.bias),
                    "probability": _r(ex.probability), "temperature": _r(model.spec.temperature),
                    "abstain": abstain, "abstain_band": [model.spec.abstain_low, model.spec.abstain_high],
                    "attention": [_r(a) for a in ex.attention]}, t)

    t = time.perf_counter()
    top = top_k(ex.contributions, k)
    order = top_k(ex.contributions, len(ex.contributions))
    curve = deletion_curve(model.head, bag, order, curve_len, model.spec.temperature)
    evidence = Evidence(
        case_id=bundle.case_id, logit=_r(ex.logit), bias=_r(ex.bias),
        probability=_r(ex.probability), abstain=abstain, top_k=top,
        patches=[{"patch_id": i, "row": int(r), "col": int(c), "attention": _r(ex.attention[i]),
                  "contribution": _r(ex.contributions[i])}
                 for i, (r, c) in enumerate(bundle.coords)],
        deletion_curve=[{"removed": n, "probability": _r(p)} for n, p in curve],
    )
    yield event(4, {"evidence": evidence.model_dump(mode="json")}, t)

    t = time.perf_counter()
    report = report_fn(evidence) if report_fn else {"pending": True}
    yield event(5, {"report": report}, t)
