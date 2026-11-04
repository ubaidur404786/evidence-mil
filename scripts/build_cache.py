"""Merge per-slide features into the memory-mapped cache layout (see ml/.../data/bags.py) + splits.json.

Input formats:
  --emb DIR    per-slide <id>.npz from extract_embeddings.py (embeddings, coords); needs --labels CSV
               with columns `slide_id,label` (1 = tumour). Slide ids starting with "test" form the test split.
  --owkin DIR  owkin/camelyon16-features parquet files (data/Phikon_{train,test}-*.parquet): one row per
               slide with `features` [N<=1000, 3 + 768] and `label`. The first 3 columns are (level, x, y)
               tile indices; all-zero rows are padding and are dropped. No slide ids are given, so ids are
               train_000.. / test_000.. in file order.
The non-test slides are split train/val, stratified by label (--val-frac).

  uv run python scripts/build_cache.py --owkin data/owkin_c16/data --out data/cache_phikon
"""

import argparse
import csv
import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np

Case = tuple[str, int, np.ndarray, np.ndarray]


def stream_emb(directory: Path, labels: dict[str, int]) -> Iterator[Case]:
    for p in sorted(directory.glob("*.npz")):
        if p.stem in labels:
            with np.load(p) as z:
                yield p.stem, labels[p.stem], z["embeddings"], z["coords"]


def stream_owkin(directory: Path) -> Iterator[Case]:
    import pyarrow.parquet as pq

    for split in ("train", "test"):
        i = 0
        for p in sorted(directory.glob(f"Phikon_{split}-*.parquet")):
            f = pq.ParquetFile(p)
            for batch in f.iter_batches(batch_size=8, columns=["features", "label"]):
                for feats, label in zip(batch.column("features").to_pylist(),
                                        batch.column("label").to_pylist(), strict=True):
                    arr = np.asarray(feats, dtype=np.float32)
                    arr = arr[np.abs(arr[:, 3:]).sum(axis=1) > 0]  # drop padding
                    coords = arr[:, [2, 1]].astype(np.int32)  # (row, col) = (y, x)
                    yield f"{split}_{i:03d}", int(label), arr[:, 3:].astype(np.float16), coords
                    i += 1


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--emb")
    g.add_argument("--owkin")
    ap.add_argument("--labels")
    ap.add_argument("--out", required=True)
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    if args.emb:
        labels = {r["slide_id"]: int(r["label"]) for r in csv.DictReader(open(args.labels))}

        def stream() -> Iterator[Case]:
            return stream_emb(Path(args.emb), labels)
    else:
        def stream() -> Iterator[Case]:
            return stream_owkin(Path(args.owkin))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # Two passes (sizes, then fill a memmap): never holds all embeddings in RAM.
    sizes, dim = [], None
    for _, _, emb, _ in stream():
        sizes.append(len(emb))
        dim = emb.shape[1]
    mm = np.lib.format.open_memmap(out / "embeddings.npy", mode="w+", dtype=np.float16,
                                   shape=(sum(sizes), dim))
    entries, start = [], 0
    for sid, label, emb, coords in stream():
        if len(emb) == 0:
            continue
        mm[start : start + len(emb)] = emb
        entries.append({"case_id": sid, "label": label, "start": start, "end": start + len(emb),
                        "coords": np.asarray(coords).tolist()})
        start += len(emb)
    mm.flush()
    (out / "index.json").write_text(json.dumps({"cases": entries}))

    rng = np.random.default_rng(args.seed)
    test = [e["case_id"] for e in entries if e["case_id"].lower().startswith("test")]
    rest = [e for e in entries if e["case_id"] not in set(test)]
    val: list[str] = []
    for y in (0, 1):
        ids = [e["case_id"] for e in rest if e["label"] == y]
        rng.shuffle(ids)
        val += ids[: int(len(ids) * args.val_frac)]
    train = [e["case_id"] for e in rest if e["case_id"] not in set(val)]
    (out / "splits.json").write_text(json.dumps({"train": train, "val": val, "test": test}, indent=1))
    pos = sum(e["label"] for e in entries)
    print(f"{len(entries)} slides ({pos} positive), {start} patches, dim {dim}; "
          f"train/val/test = {len(train)}/{len(val)}/{len(test)}")


if __name__ == "__main__":
    main()
