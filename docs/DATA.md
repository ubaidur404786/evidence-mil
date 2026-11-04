# Data and model licences

Status: rows marked with a date were checked on the official page on that date. Others are still unverified
and must be checked before use. Never commit data or weights.

## Datasets
| Name | Use | Access note | Licence | Verified |
|---|---|---|---|---|
| CAMELYON16 (399 slides: 270 train, 129 test) | main pack | open hosting via GigaScience / challenge site; size reported ~0.9 TB | grand-challenge Data page footer: "made available under CC0"; page calls the data open access. Footer may cover the page, not the slides, so we treat use as research/non-commercial and cite the challenge | 2026-11-04 |
| owkin/camelyon16-features (Phikon features) | fast head validation | Hugging Face | "Owkin non-commercial license" (card, links HistoSSLscaling LICENSE.txt) | 2026-11-04 |
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
| Phikon-v2 | pathology | Owkin non-commercial licence (HF card, LICENSE.pdf) | 2026-11-04 |
| OpenPath | pathology | Apache-2.0 per a third-party card; research-stage | no |
| UNI / UNI2-h / Virchow2 | pathology | gated; check terms | no |
| H-Optimus-0 | pathology | licence reported inconsistently; read the card | no |
| ResNet-50 (ImageNet) | baseline | small CNN baseline | no |

Rule: pick by licence first, then by results. Portfolio use may allow non-commercial weights; say so in the README.
