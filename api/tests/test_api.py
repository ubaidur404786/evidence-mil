import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evidence_agent import ReviewAgent
from evidence_api.main import Settings, create_app
from evidencemil.cli import make_toy_bundles
from evidencemil.experiment import run_experiment
from evidencemil.pipeline import STEPS, save_model

CONTRACTS = Path(__file__).parents[2] / "contracts" / "schemas"
CFG = {"data": {"kind": "toy", "n_train": 120, "n_val": 30, "n_test": 20},
       "encoder": {"name": "fake", "dim": 32},
       "head": {"name": "additive", "hidden": 32, "dropout": 0.0},
       "train": {"epochs": 12, "lr": 0.003}, "abstain": {"low": 0.4, "high": 0.6}}


@pytest.fixture(scope="module")
def settings(tmp_path_factory) -> Settings:
    root = tmp_path_factory.mktemp("api")
    save_model(run_experiment(CFG, root / "work").model, root / "model")
    make_toy_bundles(root / "model", root / "cases", n=4)
    return Settings(root / "cases", root / "model", root / "db.sqlite")


@pytest.fixture()
def client(settings) -> TestClient:
    return TestClient(create_app(settings, ReviewAgent()))


def parse_sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_health_and_cases(client):
    assert client.get("/health").json()["status"] == "ok"
    cases = client.get("/cases").json()
    assert [c["case_id"] for c in cases] == ["toy-01", "toy-02", "toy-03", "toy-04"]
    assert cases[0]["domain"] == "toy"


def test_unknown_case_and_run_404(client):
    assert client.post("/runs", json={"case_id": "nope"}).status_code == 404
    assert client.get("/runs/nope/events").status_code == 404


def test_sse_streams_six_steps_in_order(client):
    run = client.post("/runs", json={"case_id": "toy-01"}).json()
    resp = client.get(f"/runs/{run['run_id']}/events")
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(resp.text)
    assert [e["step"] for kind, e in events if kind == "step"] == STEPS
    assert [e["index"] for kind, e in events if kind == "step"] == list(range(6))
    assert events[-1][0] == "done"


def test_report_approve_and_audit(client):
    run_id = client.post("/runs", json={"case_id": "toy-01"}).json()["run_id"]
    report = client.get(f"/runs/{run_id}/report").json()
    if report["status"] == "abstained":
        pytest.skip("toy model abstained on this case")
    assert report["status"] == "draft" and report["verifier"]["passed"]
    evidence = client.get(f"/runs/{run_id}/evidence").json()
    cited = {c for s in report["sections"] for c in s["citations"]}
    assert cited <= {p["patch_id"] for p in evidence["patches"]}
    done = client.post(f"/runs/{run_id}/decision", json={"action": "approve"}).json()
    assert done["status"] == "approved"
    assert client.post(f"/runs/{run_id}/decision", json={"action": "approve"}).status_code == 409
    assert [a["action"] for a in client.get(f"/runs/{run_id}/audit").json()] == ["run", "approve"]


def test_bad_edit_stays_draft(client):
    run_id = client.post("/runs", json={"case_id": "toy-01"}).json()["run_id"]
    if client.get(f"/runs/{run_id}/report").json()["status"] != "draft":
        pytest.skip("not a draft")
    bad = [{"title": "x", "text": "Probability 99.9%.", "citations": [999]}]
    out = client.post(f"/runs/{run_id}/decision", json={"action": "edit", "sections": bad}).json()
    assert out["status"] == "draft" and not out["verifier"]["passed"]


def test_replay_mode(settings, tmp_path):
    live = TestClient(create_app(settings, ReviewAgent()))
    run_id = live.post("/runs", json={"case_id": "toy-02"}).json()["run_id"]
    (tmp_path / "toy-02.json").write_text(json.dumps(live.get(f"/runs/{run_id}/steps").json()))
    replay_settings = Settings(settings.cases_dir, settings.model_dir, tmp_path / "r.sqlite", tmp_path)
    client = TestClient(create_app(replay_settings, ReviewAgent()))
    rid = client.post("/runs", json={"case_id": "toy-02"}).json()["run_id"]
    steps = client.get(f"/runs/{rid}/steps").json()
    assert [s["step"] for s in steps] == STEPS
    assert client.get(f"/runs/{rid}/report").status_code == 409


def _props(schema: dict, name: str, root: dict) -> set[str]:
    node = schema["components"]["schemas"][name] if "components" in schema else root
    return set(node["properties"])


def test_openapi_matches_contracts(client):
    spec = client.get("/openapi.json").json()
    comps = spec["components"]["schemas"]
    for name in ("StepEvent", "Evidence", "Report"):
        contract = json.loads((CONTRACTS / f"{name}.json").read_text())
        assert set(comps[name]["properties"]) == set(contract["properties"]), name
        assert set(comps[name]["required"]) == set(contract["required"]), name
