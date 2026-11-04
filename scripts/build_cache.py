"""Merge per-slide embedding files into the memory-mapped cache layout + a splits file.

Input formats:
  --emb DIR             per-slide <id>.npz from extract_embeddings.py (embeddings, coords)
  --owkin DIR           owkin/camelyon16-features .npy files: per-slide [N, 3 + D], first 3 columns
                        are (zoom level, x, y) metadata (check the dataset card before running)
Labels CSV: columns `slide_id,label` (label 1 = tumour). Official test slides go to `test`,
the rest is split train/val (stratified, --val-frac).

  uv run python scripts/build_cache.py --owkin data/owkin_c16 --labels data/c16_labels.csv
      --out data/cache_phikon
"""

import argparse
import csv
import json
from pathlib import Path

import numpy as np


def stream_cases(args):
    if args.emb:
        for p in sorted(Path(args.emb).glob("*.npz")):
            with np.load(p) as z:
                yield p.stem, z["embeddings"], z["coords"]
    else:
        for p in sorted(Path(args.owkin).rglob("*.npy")):
            arr = np.load(p, mmap_mode="r")
            xy = np.asarray(arr[:, 1:3])
            step = np.diff(np.unique(xy[:, 0]))[0] if len(np.unique(xy[:, 0])) > 1 else 1
            coords = ((xy - xy.min(axis=0)) // max(step, 1)).astype(np.int32)[:, ::-1]  # (row, col)
            yield p.stem.split(".")[0], np.asarray(arr[:, 3:], dtype=np.float16), coords


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--emb")
    g.add_argument("--owkin")
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    labels = {r["slide_id"]: int(r["label"]) for r in csv.DictReader(open(args.labels))}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # Two passes: size first, then fill a memmap; never holds all embeddings in RAM.
    sizes, dim = {}, None
    for sid, emb, _ in stream_cases(args):
        if sid in labels and len(emb):
            sizes[sid], dim = len(emb), emb.shape[1]
    total = sum(sizes.values())
    mm = np.lib.format.open_memmap(out / "embeddings.npy", mode="w+", dtype=np.float16, shape=(total, dim))
    entries, start = [], 0
    for sid, emb, coords in stream_cases(args):
        if sid not in sizes:
            continue
        mm[start : start + len(emb)] = emb
        entries.append({"case_id": sid, "label": labels[sid], "start": start, "end": start + len(emb),
                        "coords": np.asarray(coords).tolist()})
        start += len(emb)
    mm.flush()
    (out / "index.json").write_text(json.dumps({"cases": entries}))

    rng = np.random.default_rng(args.seed)
    test = [e["case_id"] for e in entries if e["case_id"].lower().startswith("test")]
    rest = [e for e in entries if e["case_id"] not in test]
    val = []
    for y in (0, 1):
        ids = [e["case_id"] for e in rest if e["label"] == y]
        rng.shuffle(ids)
        val += ids[: int(len(ids) * args.val_frac)]
    train = [e["case_id"] for e in rest if e["case_id"] not in val]
    (out / "splits.json").write_text(json.dumps({"train": train, "val": val, "test": test}, indent=1))
    print(f"{len(entries)} slides, {total} patches, dim {dim}; train/val/test = "
          f"{len(train)}/{len(val)}/{len(test)}")


if __name__ == "__main__":
    main()
