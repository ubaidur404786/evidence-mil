"""Train mean / abmil / additive heads on a real embedding cache and write a results table.

  uv run python scripts/train_real.py --config ml/configs/camelyon16_phikon_additive.yaml --seeds 0 1 2

Writes results/<cache name>_results.md (+ .json) and the additive model (seed 0) to
results/raw/<cache name>_additive/. One bag per step, so GPU memory stays small (6 GB is plenty).
"""

import argparse
import json
from pathlib import Path

import numpy as np
import yaml

from evidencemil.experiment import run_experiment
from evidencemil.pipeline import save_model

ROOT = Path(__file__).parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0])
    ap.add_argument("--heads", nargs="+", default=["mean", "abmil", "additive"])
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    cache = Path(cfg["data"]["dir"])
    cfg["data"]["splits"] = json.loads((cache / "splits.json").read_text())
    name = cache.name
    results: dict[str, list[dict]] = {}
    for head in args.heads:
        for seed in args.seeds:
            c = {**cfg, "head": {**cfg["head"], "name": head}, "train": {**cfg["train"], "seed": seed}}
            res = run_experiment(c, ROOT / "results/raw" / f"{name}_work")
            results.setdefault(head, []).append(res.metrics)
            print(head, seed, {k: round(v, 4) for k, v in res.metrics.items()}, flush=True)
            if head == "additive" and seed == args.seeds[0]:
                save_model(res.model, ROOT / "results/raw" / f"{name}_additive")

    lines = [f"# {name}: test-set results (mean ± sd over seeds {args.seeds})", "",
             "| head | AUROC | AUPRC | ECE |", "|---|---|---|---|"]
    for head, ms in results.items():
        cells = []
        for k in ("auroc", "auprc", "ece"):
            v = np.array([m[k] for m in ms])
            cells.append(f"{v.mean():.3f} ± {v.std():.3f}")
        lines.append(f"| {head} | " + " | ".join(cells) + " |")
    (ROOT / "results" / f"{name}_results.md").write_text("\n".join(lines) + "\n")
    (ROOT / "results" / f"{name}_results.json").write_text(json.dumps(results, indent=1))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
