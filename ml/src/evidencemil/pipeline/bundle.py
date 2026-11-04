"""A demo case bundle: thumbnail + tile grid + (optional) patches or cached embeddings (ADR-003)."""

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class CaseBundle:
    case_id: str
    thumbnail: np.ndarray  # [H, W] or [H, W, 3] float [0, 1], grid-aligned
    grid: tuple[int, int]
    coords: np.ndarray  # [N, 2]
    embeddings: np.ndarray | None = None  # [N, D] cached; if None, `patches` are encoded live
    patches: np.ndarray | None = None  # [N, P, P(, C)]
    label: int | None = None  # ground truth, shown only as "reference" in the UI
    meta: dict = field(default_factory=dict)  # e.g. {"domain": "toy", "title": "..."}

    @property
    def cached(self) -> bool:
        return self.embeddings is not None


def save_bundle(bundle: CaseBundle, directory: Path) -> Path:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    arrays = {"thumbnail": bundle.thumbnail, "coords": bundle.coords}
    if bundle.embeddings is not None:
        arrays["embeddings"] = bundle.embeddings.astype(np.float16)
    if bundle.patches is not None:
        arrays["patches"] = bundle.patches
    path = directory / f"{bundle.case_id}.npz"
    np.savez_compressed(path, **arrays)
    meta = {"case_id": bundle.case_id, "grid": list(bundle.grid), "label": bundle.label, **bundle.meta}
    (directory / f"{bundle.case_id}.json").write_text(json.dumps(meta, indent=1))
    return path


def load_bundle(directory: Path, case_id: str) -> CaseBundle:
    directory = Path(directory)
    meta = json.loads((directory / f"{case_id}.json").read_text())
    with np.load(directory / f"{case_id}.npz") as z:
        emb = z["embeddings"].astype(np.float32) if "embeddings" in z else None
        patches = z["patches"] if "patches" in z else None
        bundle = CaseBundle(case_id, z["thumbnail"], tuple(meta.pop("grid")), z["coords"],
                            emb, patches, meta.pop("label"), {})
    meta.pop("case_id")
    bundle.meta = meta
    return bundle


def list_bundles(directory: Path) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(Path(directory).glob("*.json"))]
