# Data and model licences

Status: rows marked with a date were checked on the official page on that date. Others are still unverified
and must be checked before use. Never commit data or weights.

## Datasets
| Name | Use | Access note | Licence | Verified |
|---|---|---|---|---|
| CAMELYON16 (399 slides: 270 train, 130 test; reference.csv lists 129) | main pack: slide images + tumour annotations | AWS open data `s3://camelyon-dataset/CAMELYON16/` (no account); ~0.5–2 GB per slide | **CC0** — `license.txt` in the official bucket: "CAMELYON16 data set is available under CC0" (Radboud UMC Computational Pathology Group) | 2026-11-04 |
| owkin/camelyon16-features (Phikon features) | fast head validation | Hugging Face, 3 parquet files, 1.2 GB; 399 slides × ≤1000 tiles, cols = (level, x, y) + 768 features | Owkin non-commercial licence (HistoSSLscaling LICENSE.txt, read in full): non-commercial research by non-profit entities; results for other uses need Owkin approval; derivatives under same terms. Used locally only; features never committed or shipped in images | 2026-11-04 |
| kaczmarj/camelyon16-uni (UNI features) | fast head validation | Hugging Face, gated (accept conditions) | CC-BY-NC-SA-4.0, non-commercial academic only (card) | 2026-11-04 |
| torchmil Camelyon16 MIL (UNI or resnet50_bt features) | fast head validation | library download | check | no |
| Synthetic toy bags | tests + first demo | generated | ours | n/a |

Sources: https://camelyon17.grand-challenge.org/Data/ · https://owkin.github.io/FLamby/_sources/fed_camelyon.rst.txt ·
https://huggingface.co/datasets/owkin/camelyon16-features/blob/main/README.md ·
https://huggingface.co/datasets/kaczmarj/camelyon16-uni · https://torchmil.readthedocs.io/en/main/api/datasets/camelyon16mil_dataset/

## Encoders (candidates)
| Name | Type | Note | Verified |
|---|---|---|---|
| DINOv2 (ViT-S/B) | general | Apache-2.0 (github.com/facebookresearch/dinov2 LICENSE) | 2026-11-04 |
| Phikon (v1, owkin/phikon) | pathology, ViT-B/16, 768-d | Owkin non-commercial licence (HF card → HistoSSLscaling LICENSE.txt); not gated. Used for live encoding of uploads, same model as the cached features | 2026-11-04 |
| Phikon-v2 | pathology | Owkin non-commercial licence (HF card, LICENSE.pdf) | 2026-11-04 |
| OpenPath | pathology | Apache-2.0 per a third-party card; research-stage | no |
| UNI / UNI2-h / Virchow2 | pathology | gated; check terms | no |
| H-Optimus-0 | pathology | licence reported inconsistently; read the card | no |
| ResNet-50 (ImageNet) | baseline | small CNN baseline | no |

Rule: pick by licence first, then by results. Portfolio use may allow non-commercial weights; say so in the README.

## Feature ↔ slide alignment (verified)
Owkin feature rows for the test split are in official order: row i = `test_{i+1:03d}` (all 129 labels match
`reference.csv`; the one slide missing from reference.csv has no label there). Tile coordinates are (DeepZoom level 17, x, y) of
224 px tiles; `scripts/build_c16_cases.py` re-encodes sampled tiles with Phikon and records the median
cosine similarity to the cached vectors per slide (`alignment_cosine` in the case metadata).
