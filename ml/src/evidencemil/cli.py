"""CLI.

  evidencemil train --config ml/configs/toy_additive.yaml --out results/raw/toy_additive
  evidencemil demo-cases --model results/raw/toy_additive --out data/demo_cases
  evidencemil export-onnx --model results/raw/toy_additive --out results/raw/toy_additive/head.onnx
"""

import argparse
import json
import tempfile
from pathlib import Path

import numpy as np
import torch
import yaml

from evidencemil.data.tiler import assemble_grid
from evidencemil.data.toy import ToyBag, make_bag
from evidencemil.experiment import run_experiment
from evidencemil.mil.train import sigmoid
from evidencemil.pipeline import CaseBundle, load_model, save_bundle, save_model


def cmd_train(args: argparse.Namespace) -> None:
    cfg = yaml.safe_load(Path(args.config).read_text())
    with tempfile.TemporaryDirectory() as tmp:
        result = run_experiment(cfg, Path(cfg.get("workdir", tmp)))
    out = Path(args.out)
    save_model(result.model, out)
    (out / "metrics.json").write_text(json.dumps(result.metrics, indent=1))
    print(json.dumps({k: round(v, 4) for k, v in result.metrics.items()}))


def make_toy_bundles(model_dir: Path, out: Path, n: int = 6, seed: int = 7) -> list[str]:
    """Toy demo cases: labels 1,0,1,0,... and a last ambiguous case.

    The ambiguous case has one faint pattern patch; its strength is picked so the model is
    least sure (closest to 0.5), to show the abstain path in the demo.
    """
    model = load_model(model_dir)
    enc = model.encoder()
    ids = []
    for i in range(n):
        ambiguous = i == n - 1
        if ambiguous:
            bag = _most_ambiguous_bag(model, enc, seed + i)
            title = "Ambiguous: one faint pattern"
        else:
            bag = make_bag(np.random.default_rng(seed + i), label=int(i % 2 == 0))
            title = "Pattern present" if bag.label else "Noise only"
        p = bag.patches.shape[1]
        thumb = assemble_grid(bag.patches, bag.coords, (8, 8))
        case_id = f"toy-{i + 1:02d}"
        save_bundle(CaseBundle(case_id, thumb, (8, 8), bag.coords, enc.embed(bag.patches), None,
                               bag.label, {"domain": "toy", "title": title, "patch_px": p,
                                           "true_patches": np.flatnonzero(bag.patch_mask).tolist()}),
                    out)
        ids.append(case_id)
    return ids


def _most_ambiguous_bag(model, enc, seed: int):
    """Blend a pattern bag with its pattern-free twin; bisect the blend for probability 0.5."""
    pos = make_bag(np.random.default_rng(seed), label=1, n_positive=(1, 1))
    neg = make_bag(np.random.default_rng(seed), label=0)  # same noise, no pattern

    def prob(t: float) -> float:
        with torch.inference_mode():
            emb = enc.embed((1 - t) * neg.patches + t * pos.patches)
            logit = float(model.head(torch.from_numpy(emb))["logit"])
        return float(sigmoid(logit, model.spec.temperature))

    lo, hi = 0.0, 1.0
    for _ in range(30):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if prob(mid) < 0.5 else (lo, mid)
    t = (lo + hi) / 2
    return ToyBag(((1 - t) * neg.patches + t * pos.patches).astype(np.float32), pos.coords,
                  pos.patch_mask, 1)


def cmd_demo_cases(args: argparse.Namespace) -> None:
    print(make_toy_bundles(Path(args.model), Path(args.out)))


def cmd_export_onnx(args: argparse.Namespace) -> None:
    from evidencemil.export import export_onnx

    model = load_model(Path(args.model))
    export_onnx(model.head, model.spec.dim, Path(args.out))
    print(f"wrote {args.out}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="evidencemil")
    sub = parser.add_subparsers(required=True)
    p = sub.add_parser("train")
    p.add_argument("--config", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_train)
    p = sub.add_parser("demo-cases")
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_demo_cases)
    p = sub.add_parser("export-onnx")
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_export_onnx)
    args = parser.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
