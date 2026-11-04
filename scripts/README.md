# scripts

`build_demo.py` toy model + demo cases + recorded replays + `results/toy_results.md` (CPU, < 1 min).
`extract_embeddings.py` resumable, sharded WSI embedding extraction (Kaggle/Colab GPU).
`build_cache.py` merge per-slide features into the memory-mapped cache + splits. `train_real.py` heads × seeds → results table.
`smoke.py` end-to-end check of a running stack. `kind_up.sh` build images and deploy on kind. See `docs/RUNBOOK.md`.
