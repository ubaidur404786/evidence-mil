"""Demo bundles from a real embedding cache (local only: data/ is git-ignored, licence is non-commercial).

The Phikon feature set ships no slide images, so the thumbnail is a tissue map: one pixel block per kept
tile. Picks test slides: the most confident positive, the most confident negative, and the least sure one.

  uv run python scripts/build_real_cases.py --cache data/cache_phikon \
      --model results/raw/cache_phikon_additive --out data/demo_cases_c16
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from evidencemil.data.bags import EmbeddingCache
from evidencemil.mil.train import sigmoid
from evidencemil.pipeline import CaseBundle, load_model, save_bundle


def tissue_map(coords: np.ndarray, block: int) -> tuple[np.ndarray, tuple[int, int], np.ndarray]:
    origin = coords.min(axis=0)
    local = coords - origin
    rows, cols = (local.max(axis=0) + 1).tolist()
    img = np.ones((rows * block, cols * block), dtype=np.float32)
    for r, c in local:
        img[r * block : (r + 1) * block, c * block : (c + 1) * block] = 0.55
    return img, (rows, cols), local


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--block", type=int, default=4)
    args = ap.parse_args()

    cache = EmbeddingCache(Path(args.cache))
    model = load_model(Path(args.model))
    test_ids = json.loads((Path(args.cache) / "splits.json").read_text())["test"]
    probs = {}
    for cid in test_ids:
        emb, _ = cache.by_id(cid)
        with torch.inference_mode():
            logit = float(model.head(torch.from_numpy(emb))["logit"])
        probs[cid] = float(sigmoid(logit, model.spec.temperature))
    by_p = sorted(probs, key=probs.get)
    picks = {by_p[-1]: "Most confident tumour score", by_p[0]: "Most confident normal score",
             min(probs, key=lambda c: abs(probs[c] - 0.5)): "Least certain slide"}
    for cid, title in picks.items():
        emb, entry = cache.by_id(cid)
        thumb, grid, local = tissue_map(np.asarray(entry.coords), args.block)
        save_bundle(CaseBundle(f"c16-{cid}", thumb, grid, local, emb, None, entry.label,
                               {"domain": "CAMELYON16 (Phikon features)", "title": title,
                                "note": "tissue map; slide image not shipped"}), Path(args.out))
        print(cid, title, round(probs[cid], 3), "label", entry.label)


if __name__ == "__main__":
    main()
