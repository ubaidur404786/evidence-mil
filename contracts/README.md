# contracts

Single source of truth for shared types: `schemas/*.json` (JSON Schema 2020-12).
Generated: pydantic models in `src/evidence_contracts/models.py`, TS types in `generated/ts/`.
Regenerate after editing a schema: `uv run python contracts/generate.py` (needs Node for TS).
Test: `uv run pytest contracts`.
