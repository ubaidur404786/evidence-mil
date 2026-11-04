import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from evidence_contracts import Evidence, Report, StepEvent

ROOT = Path(__file__).parents[1]
SCHEMAS = {p.stem: json.loads(p.read_text()) for p in (ROOT / "schemas").glob("*.json")}

EVIDENCE = {
    "case_id": "toy-001", "logit": 1.5, "bias": -0.5, "probability": 0.82, "abstain": False,
    "patches": [
        {"patch_id": 0, "row": 0, "col": 0, "attention": 0.9, "contribution": 2.1},
        {"patch_id": 1, "row": 0, "col": 1, "attention": 0.1, "contribution": -0.1},
    ],
    "top_k": [0],
    "deletion_curve": [{"removed": 0, "probability": 0.82}, {"removed": 1, "probability": 0.3}],
}
REPORT = {
    "case_id": "toy-001", "status": "draft",
    "sections": [{"title": "Finding", "text": "Patch 0 drives the score.", "citations": [0]}],
    "verifier": {"passed": True, "errors": []},
}
EVENT = {"case_id": "toy-001", "step": "tile", "index": 1, "payload": {"rows": 8, "cols": 8}}
CASES = [
    ("Evidence", Evidence, EVIDENCE),
    ("Report", Report, REPORT),
    ("StepEvent", StepEvent, EVENT),
]


def test_schemas_are_valid_json_schema():
    assert set(SCHEMAS) == {"StepEvent", "Evidence", "Report"}
    for schema in SCHEMAS.values():
        jsonschema.Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize(("name", "model", "example"), CASES)
def test_example_valid_in_schema_and_pydantic(name, model, example):
    jsonschema.validate(example, SCHEMAS[name])
    assert model.model_validate(example).model_dump(mode="json", exclude_unset=True) == example


@pytest.mark.parametrize(("name", "model", "bad"), [
    ("StepEvent", StepEvent, {**EVENT, "step": "train"}),
    ("StepEvent", StepEvent, {**EVENT, "index": 6}),
    ("Evidence", Evidence, {**EVIDENCE, "probability": 1.2}),
    ("Evidence", Evidence, {**EVIDENCE, "extra": 1}),
    ("Report", Report, {**REPORT, "status": "maybe"}),
])
def test_invalid_rejected_by_both(name, model, bad):
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, SCHEMAS[name])
    with pytest.raises(ValidationError):
        model.model_validate(bad)


def test_generated_ts_in_sync_with_schemas():
    for name, schema in SCHEMAS.items():
        ts = (ROOT / "generated" / "ts" / f"{name}.ts").read_text()
        assert f"export interface {name}" in ts
        for field in schema["properties"]:
            assert f"{field}" in ts
