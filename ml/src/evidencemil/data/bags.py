"""Bags of patch embeddings: an on-disk memory-mapped cache and a torch Dataset over it.

Cache layout (one directory):
  embeddings.npy  float16/float32 [total_patches, D], opened with mmap (never fully in RAM)
  index.json      {"cases": [{"case_id", "label", "start", "end", "coords": [[r, c], ...]}]}
"""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset


@dataclass(frozen=True)
class CaseEntry:
    case_id: str
    label: int
    start: int
    end: int
    coords: list[list[int]]


def write_cache(directory: Path, cases: list[tuple[str, int, np.ndarray, np.ndarray]]) -> None:
    """cases: (case_id, label, embeddings [N, D], coords [N, 2]). Small-data helper (tests, demo)."""
    directory.mkdir(parents=True, exist_ok=True)
    entries, chunks, start = [], [], 0
    for case_id, label, emb, coords in cases:
        chunks.append(emb.astype(np.float32))
        entries.append({"case_id": case_id, "label": int(label), "start": start,
                        "end": start + len(emb), "coords": coords.tolist()})
        start += len(emb)
    np.save(directory / "embeddings.npy", np.concatenate(chunks))
    (directory / "index.json").write_text(json.dumps({"cases": entries}))


class EmbeddingCache:
    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.embeddings = np.load(self.directory / "embeddings.npy", mmap_mode="r")
        raw = json.loads((self.directory / "index.json").read_text())
        self.cases = [CaseEntry(**c) for c in raw["cases"]]
        self._by_id = {c.case_id: i for i, c in enumerate(self.cases)}

    def __len__(self) -> int:
        return len(self.cases)

    @property
    def dim(self) -> int:
        return int(self.embeddings.shape[1])

    def get(self, i: int) -> tuple[np.ndarray, CaseEntry]:
        c = self.cases[i]
        return np.array(self.embeddings[c.start : c.end], dtype=np.float32), c

    def by_id(self, case_id: str) -> tuple[np.ndarray, CaseEntry]:
        return self.get(self._by_id[case_id])


class BagDataset(Dataset):
    """Yields (bag [N, D] float tensor, label float tensor). Batch size is 1 bag (ragged N)."""

    def __init__(self, cache: EmbeddingCache, indices: list[int] | None = None):
        self.cache = cache
        self.indices = list(range(len(cache))) if indices is None else indices

    def __len__(self) -> int:
        return len(self.indices)

    def __getitem__(self, i: int) -> tuple[torch.Tensor, torch.Tensor]:
        emb, entry = self.cache.get(self.indices[i])
        return torch.from_numpy(emb), torch.tensor(float(entry.label))
