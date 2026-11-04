"""Where is the disease? EvidenceMIL vs older ways of finding it, on the same real slides and features.

Methods (all on the same live Phikon tile features of the downloaded CAMELYON16 slides):
  additive MIL (ours)        slide labels only; heatmap = exact patch contributions (sum = logit)
  attention MIL (ABMIL)      slide labels only; heatmap = attention weights (no sign, not additive)
  supervised patch classifier needs pathologist outlines for training (the CAMELYON16-winner / U-Net family:
                             learn tumour vs normal per patch, slide score = max patch probability);
                             evaluated leave-one-slide-out so a slide never trains its own heatmap
  mean pooling               slide labels only; no heatmap (every patch counts the same)

  uv run --no-sync python scripts/compare_methods.py --cases data/demo_cases_c16
Writes results/c16_comparison.md and results/c16_comparison.json.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import yaml
from sklearn.linear_model import LogisticRegression

from evidencemil.experiment import run_experiment
from evidencemil.mil.train import sigmoid
from evidencemil.pipeline import load_bundle, load_model, save_model
from evidencemil.pipeline.bundle import list_bundles
from evidencemil.pipeline.run import REFERENCE_POSITIVE, localisation

ROOT = Path(__file__).parents[1]
CFG = ROOT / "ml/configs/camelyon16_phikon_additive.yaml"


def head_model(name: str):
    path = ROOT / f"results/raw/cache_phikon_{name}"
    if not (path / "spec.json").exists():  # train once on the cached training split (same recipe as the table)
        cfg = yaml.safe_load(CFG.read_text())
        cfg["data"]["splits"] = json.loads((ROOT / cfg["data"]["dir"] / "splits.json").read_text())
        cfg["head"] = {**cfg["head"], "name": name}
        save_model(run_experiment(cfg, ROOT / "results/raw/work").model, path)
    return load_model(path)


def mil_scores(model, emb: np.ndarray, use: str) -> tuple[float, np.ndarray]:
    with torch.inference_mode():
        out = model.head(torch.from_numpy(emb))
    return float(sigmoid(float(out["logit"]), model.spec.temperature)), out[use].numpy()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", required=True)
    args = ap.parse_args()
    cases = [load_bundle(Path(args.cases), m["case_id"]) for m in list_bundles(Path(args.cases))]
    additive, abmil, mean = head_model("additive"), head_model("abmil"), head_model("mean")

    per_slide: dict[str, dict] = {}
    for b in cases:
        emb = b.embeddings.astype(np.float32)
        truth = b.reference >= REFERENCE_POSITIVE
        row = {"label": b.label, "tumour_patches": int(truth.sum()), "patches": len(emb)}
        for name, model, use in (("additive MIL (ours)", additive, "contributions"),
                                 ("attention MIL", abmil, "attention"), ("mean pooling", mean, "contributions")):
            p, heat = mil_scores(model, emb, use)
            row[name] = {"p": p, "abstain": model.abstains(p),
                         "loc": localisation(heat, b.reference) if name != "mean pooling" else None}
        per_slide[b.case_id] = row

    # Supervised patch classifier, leave-one-slide-out (needs annotations: tumour slides + normal slides).
    for b in cases:
        train = [c for c in cases if c.case_id != b.case_id]
        x = np.concatenate([c.embeddings for c in train]).astype(np.float32)
        y = np.concatenate([c.reference >= REFERENCE_POSITIVE for c in train])
        if y.sum() == 0:
            continue
        clf = LogisticRegression(max_iter=2000, C=0.1, class_weight="balanced").fit(x, y)
        prob = clf.predict_proba(b.embeddings.astype(np.float32))[:, 1]
        per_slide[b.case_id]["supervised patch classifier"] = {
            "p": float(prob.max()), "abstain": False, "loc": localisation(prob, b.reference)}

    methods = ["additive MIL (ours)", "attention MIL", "supervised patch classifier", "mean pooling"]
    needs = {"additive MIL (ours)": "slide label", "attention MIL": "slide label",
             "supervised patch classifier": "pixel outlines", "mean pooling": "slide label"}
    exact = {"additive MIL (ours)": "yes: contributions sum to the score", "attention MIL": "no: weights, no sign",
             "supervised patch classifier": "per-patch probability; slide score = max", "mean pooling": "none"}
    summary = {}
    for m in methods:
        rows = [r[m] for r in per_slide.values() if m in r]
        locs = [r["loc"] for r in rows if r["loc"]]
        decided = [(s[m]["p"] >= 0.5) == bool(s["label"]) for s in per_slide.values() if m in s and not s[m]["abstain"]]
        summary[m] = {"slides": len(rows), "decisions_correct": int(sum(decided)),
                      "abstained": int(sum(r["abstain"] for r in rows)), "wrong": int(len(decided) - sum(decided)),
                      "loc_auroc": float(np.mean([x["auroc"] for x in locs])) if locs else None,
                      "precision_at_10": float(np.mean([x["precision_at_10"] for x in locs])) if locs else None,
                      "chance": float(np.mean([x["chance"] for x in locs])) if locs else None}

    tumour = [k for k, r in per_slide.items() if r["tumour_patches"]]
    lines = ["# Finding the metastasis: EvidenceMIL vs older approaches (CAMELYON16, real slides)", "",
             f"{len(per_slide)} test slides ({len(tumour)} with annotated tumour), live Phikon features at 20x, "
             "same tiles for every method. Localisation is scored against the pathologists' outlines "
             "(a patch is tumour when ≥ 50% inside).", "",
             "| method | training labels | slide decisions: correct / abstained / wrong | localisation AUROC | "
             "top-10 precision | heatmap |",
             "|---|---|---|---|---|---|"]
    for m in methods:
        s = summary[m]
        auc = f"{s['loc_auroc']:.3f}" if s["loc_auroc"] is not None else "—"
        p10 = f"{s['precision_at_10']:.2f} (chance {s['chance']:.2f})" if s["precision_at_10"] is not None else "—"
        lines.append(f"| {m} | {needs[m]} | {s['decisions_correct']} / {s['abstained']} / {s['wrong']} | {auc} | {p10} "
                     f"| {exact[m]} |")
    lines += ["", "## Per slide", "", "| slide | label | tumour patches | " + " | ".join(methods) + " |",
              "|---|---|---|" + "---|" * len(methods)]
    for k, r in per_slide.items():
        cells = []
        for m in methods:
            if m not in r:
                cells.append("—")
                continue
            loc = r[m]["loc"]
            cells.append(f"P={r[m]['p']:.2f}" + (" (abstains)" if r[m]["abstain"] else "")
                         + (f", AUROC {loc['auroc']:.2f}" if loc else ""))
        lines.append(f"| {k} | {r['label']} | {r['tumour_patches']} | " + " | ".join(cells) + " |")
    lines += ["", "Published context (not reproduced here): the CAMELYON16 winning method (Wang et al., 2016) trained a",
              "CNN patch classifier on pixel-level annotations and reached slide AUC 0.925. Segmentation networks such",
              "as U-Net need the same pixel-level masks. EvidenceMIL reaches 0.911 ± 0.012 slide AUROC on the full",
              "test set (results/cache_phikon_results.md) from slide labels only, and its heatmap is the score itself.",
              "", "Abstained = calibrated probability inside the model's uncertainty band (35–65%): the case goes to a",
              "specialist instead of receiving a possibly wrong answer. The supervised classifier has no such band.",
              "", "Prototype scale: few slides, so treat per-method differences as indicative, not significant.",
              "Generated by `scripts/compare_methods.py`."]
    (ROOT / "results/c16_comparison.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "results/c16_comparison.json").write_text(json.dumps({"summary": summary, "per_slide": per_slide},
                                                                  indent=1), encoding="utf-8")
    print("\n".join(lines).encode("ascii", "replace").decode())


if __name__ == "__main__":
    main()
