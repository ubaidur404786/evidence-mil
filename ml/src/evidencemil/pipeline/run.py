"""run_case(): the six pipeline stages as a generator of StepEvents (contracts).

The report stage is injected (`report_fn`) because `ml` must not import `agent`.
Stage payloads (free-form `payload` in the contract) are documented in docs/ARCHITECTURE.md §2.
"""

import time
from collections.abc import Callable, Iterator

import numpy as np
import torch

from evidence_contracts import Evidence, StepEvent
from evidencemil import metrics
from evidencemil.encoders.base import Encoder
from evidencemil.explain import deletion_curve, explain_bag, top_k
from evidencemil.pipeline.bundle import CaseBundle, patch_image
from evidencemil.pipeline.model import CaseModel
from evidencemil.pipeline.png import bytes_data_url, image_data_url, png_data_url

STEPS = ["input", "tile", "encode", "aggregate", "explain", "report"]
ReportFn = Callable[[Evidence], dict]
GALLERY = 8  # top patches shipped with an image in the explain event
REFERENCE_POSITIVE = 0.5  # a patch counts as annotated tumour when >= 50% of it is inside the outline


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


def localisation(contributions: np.ndarray, reference: np.ndarray) -> dict | None:
    """How well the highest-contribution patches match annotated tumour patches (positive slides only)."""
    truth = reference >= REFERENCE_POSITIVE
    if not truth.any() or truth.all():
        return None
    order = np.argsort(-contributions, kind="stable")
    out = {"annotated_patches": int(truth.sum()), "chance": _r(truth.mean()),
           "auroc": _r(metrics.auroc(truth.astype(int), contributions))}
    for k in (1, 5, 10):
        out[f"precision_at_{k}"] = _r(truth[order[:k]].mean())
    return out


def run_case(bundle: CaseBundle, model: CaseModel, report_fn: ReportFn | None = None,
             k: int = 5, curve_len: int = 10, encoder: Encoder | None = None) -> Iterator[StepEvent]:
    def event(i: int, payload: dict, started: float, cached: bool = False) -> StepEvent:
        return StepEvent(case_id=bundle.case_id, step=STEPS[i], index=i, payload=payload,
                         cached=cached, elapsed_ms=_r((time.perf_counter() - started) * 1000))

    meta = {k_: v for k_, v in bundle.meta.items() if not k_.startswith("_")}
    t = time.perf_counter()
    yield event(0, {
        "thumbnail": image_data_url(bundle.thumbnail),
        "overlay": png_data_url(bundle.overlay) if bundle.overlay is not None else None,
        "title": meta.get("title", ""), "domain": meta.get("domain", ""),
        "source": meta.get("source", ""), "note": meta.get("note", ""),
        "reference_label": bundle.label,
        "image_size": list(bundle.thumbnail.shape[:2]),
    }, t)

    t = time.perf_counter()
    reference = bundle.reference
    yield event(1, {
        "rows": bundle.grid[0], "cols": bundle.grid[1], "coords": bundle.coords.tolist(),
        "n_patches": len(bundle.coords), "tile_um": meta.get("tile_um"),
        "reference": None if reference is None else [_r(v) for v in reference],
    }, t)

    t = time.perf_counter()
    if bundle.cached:
        emb = bundle.embeddings
    else:
        patches = bundle.patches
        if patches.dtype == np.uint8:
            patches = patches.astype(np.float32) / 255.0
        emb = (encoder or model.encoder()).embed(patches)
    yield event(2, {"encoder": meta.get("encoder", model.spec.encoder), "dim": int(emb.shape[1]),
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
    images = {str(pid): bytes_data_url(*patch_image(bundle, pid)) for pid in order[:GALLERY]}
    yield event(4, {"evidence": evidence.model_dump(mode="json"), "patch_images": images,
                    "localisation": None if reference is None else localisation(ex.contributions, reference)},
                t)

    t = time.perf_counter()
    report = report_fn(evidence) if report_fn else {"pending": True}
    yield event(5, {"report": report}, t)
