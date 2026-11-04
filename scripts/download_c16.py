"""Download CAMELYON16 slides + tumour annotations (CC0, AWS open-data bucket; no account needed).

Parallel HTTP range requests in 16 MB chunks; each chunk is retried on its own and kept on disk,
so a flaky connection never restarts a 2 GB file. Rerun to resume; finished slides are skipped.

  python scripts/download_c16.py test_027 test_001 ...      -> data/c16/
"""

import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://camelyon-dataset.s3.amazonaws.com/CAMELYON16"
CHUNK = 16 * 1024 * 1024
OUT = Path(__file__).parents[1] / "data" / "c16"


def size_of(url: str) -> int:
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
        return int(r.headers["Content-Length"])


def fetch_chunk(url: str, part: Path, start: int, end: int) -> None:
    want = end - start + 1
    for attempt in range(20):
        if part.exists() and part.stat().st_size == want:
            return
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) == want:
                part.write_bytes(data)
                return
        except OSError:
            pass
        time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"chunk {part.name} failed")


def download(url: str, target: Path, workers: int = 8) -> None:
    if target.exists():
        return
    total = size_of(url)
    parts_dir = target.with_suffix(target.suffix + ".parts")
    parts_dir.mkdir(parents=True, exist_ok=True)
    ranges = [(i, s, min(s + CHUNK, total) - 1) for i, s in enumerate(range(0, total, CHUNK))]
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(lambda r: fetch_chunk(url, parts_dir / f"{r[0]:05d}", r[1], r[2]), ranges))
    tmp = target.with_suffix(target.suffix + ".tmp")
    with open(tmp, "wb") as f:
        for i, _, _ in ranges:
            f.write((parts_dir / f"{i:05d}").read_bytes())
    if tmp.stat().st_size != total:
        raise RuntimeError(f"{target.name}: size mismatch")
    tmp.replace(target)
    for p in parts_dir.iterdir():
        p.unlink()
    parts_dir.rmdir()


def main(slides: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for s in slides:
        t0 = time.time()
        download(f"{BASE}/images/{s}.tif", OUT / f"{s}.tif")
        try:
            urllib.request.urlretrieve(f"{BASE}/annotations/{s}.xml", OUT / f"{s}.xml")
        except OSError:  # normal slides have no annotation
            pass
        print(f"{s} done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
