"""A case bundle: thumbnail + tile grid + cached embeddings or raw patches (ADR-003).

On disk (one directory per pack):
  <case_id>.json       meta: grid, label, title, domain, source, ...
  <case_id>.npz        thumbnail, coords, [embeddings | patches], [overlay], [reference]
  <case_id>_crops/     optional <patch_id>.jpg tissue crops for the patch inspector
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from evidencemil.pipeline.png import encode_png


@dataclass
class CaseBundle:
    case_id: str
    thumbnail: np.ndarray  # [H, W] or [H, W, 3]; covers exactly grid rows x cols tiles
    grid: tuple[int, int]
    coords: np.ndarray  # [N, 2] (row, col) tile indices
    embeddings: np.ndarray | None = None  # [N, D] cached; if None, `patches` are encoded live
    patches: np.ndarray | None = None  # [N, P, P(, C)]
    label: int | None = None  # ground truth, shown only as "reference" in the UI
    meta: dict = field(default_factory=dict)  # e.g. {"domain": "toy", "title": "..."}
    overlay: np.ndarray | None = None  # [H, W, 4] uint8 RGBA (e.g. pathologist annotation)
    reference: np.ndarray | None = None  # [N] per-patch ground truth in [0, 1] (tumour fraction)

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
    if bundle.overlay is not None:
        arrays["overlay"] = bundle.overlay
    if bundle.reference is not None:
        arrays["reference"] = bundle.reference.astype(np.float32)
    path = directory / f"{bundle.case_id}.npz"
    np.savez_compressed(path, **arrays)
    meta = {"case_id": bundle.case_id, "grid": list(bundle.grid), "label": bundle.label,
            "n_patches": len(bundle.coords), **bundle.meta}
    (directory / f"{bundle.case_id}.json").write_text(json.dumps(meta, indent=1))
    return path


def load_bundle(directory: Path, case_id: str) -> CaseBundle:
    directory = Path(directory)
    meta = json.loads((directory / f"{case_id}.json").read_text())
    with np.load(directory / f"{case_id}.npz") as z:
        bundle = CaseBundle(
            case_id, z["thumbnail"], tuple(meta.pop("grid")), z["coords"],
            z["embeddings"].astype(np.float32) if "embeddings" in z else None,
            z["patches"] if "patches" in z else None,
            meta.pop("label"), {},
            z["overlay"] if "overlay" in z else None,
            z["reference"] if "reference" in z else None,
        )
    meta.pop("case_id")
    meta.pop("n_patches", None)
    bundle.meta = meta
    bundle.meta["_dir"] = str(directory)
    return bundle


def list_bundles(directory: Path) -> list[dict]:
    if not Path(directory).exists():
        return []
    return [json.loads(p.read_text()) for p in sorted(Path(directory).glob("*.json"))]


def crops_dir(directory: Path, case_id: str) -> Path:
    return Path(directory) / f"{case_id}_crops"


def patch_image(bundle: CaseBundle, patch_id: int) -> tuple[bytes, str]:
    """Image of one patch: the stored tissue crop if present, else a crop of the thumbnail."""
    if "_dir" in bundle.meta:
        jpg = crops_dir(Path(bundle.meta["_dir"]), bundle.case_id) / f"{patch_id}.jpg"
        if jpg.exists():
            return jpg.read_bytes(), "image/jpeg"
    if bundle.patches is not None:
        return encode_png(_to_unit(bundle.patches[patch_id])), "image/png"
    rows, cols = bundle.grid
    h, w = bundle.thumbnail.shape[:2]
    r, c = bundle.coords[patch_id]
    ch, cw = h / rows, w / cols
    crop = bundle.thumbnail[int(r * ch) : max(int((r + 1) * ch), int(r * ch) + 1),
                            int(c * cw) : max(int((c + 1) * cw), int(c * cw) + 1)]
    return encode_png(_to_unit(crop)), "image/png"


def _to_unit(img: np.ndarray) -> np.ndarray:
    return img if img.dtype == np.uint8 else np.clip(img, 0, 1)
