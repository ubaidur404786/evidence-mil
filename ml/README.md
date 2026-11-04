# ml

Pure Python library `evidencemil` (no web code): `data/` (tiler, toy task, memory-mapped embedding cache),
`encoders/` (registry: fake, precomputed, DINOv2), `mil/` (mean, abmil, additive heads; training; temperature
scaling), `explain/` (contributions, top-k, deletion curve, heatmap, random-weight check), `pipeline/` (`run_case`
yields six `StepEvent`s), `export.py` (ONNX). CLI: `uv run evidencemil train --config ml/configs/toy_additive.yaml --out ...`.
Test: `uv run pytest ml`.
