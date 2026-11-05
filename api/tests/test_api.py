import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evidence_agent import ReviewAgent
from evidence_api.main import Settings, create_app
from evidence_api.packs import Pack
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
    pack = Pack("toy", root / "cases", root / "model", live_encoder="fake",
                encoder_kwargs={"dim": 32}, patch_px=16, min_tissue=0)
    return Settings([pack], root / "db.sqlite")


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
    replay_settings = Settings(settings.packs, tmp_path / "r.sqlite", tmp_path)
    client = TestClient(create_app(replay_settings, ReviewAgent()))
    rid = client.post("/runs", json={"case_id": "toy-02"}).json()["run_id"]
    steps = client.get(f"/runs/{rid}/steps").json()
    assert [s["step"] for s in steps] == STEPS
    assert client.get(f"/runs/{rid}/report").status_code == 409


def test_openapi_matches_contracts(client):
    spec = client.get("/openapi.json").json()
    comps = spec["components"]["schemas"]
    for name in ("StepEvent", "Evidence", "Report"):
        contract = json.loads((CONTRACTS / f"{name}.json").read_text())
        assert set(comps[name]["properties"]) == set(contract["properties"]), name
        assert set(comps[name]["required"]) == set(contract["required"]), name


def _png(width: int, height: int) -> bytes:
    import io

    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(0)
    img = (0.3 + 0.15 * rng.standard_normal((height, width, 3))).clip(0, 1)
    buf = io.BytesIO()
    Image.fromarray((img * 255).astype("uint8")).save(buf, format="PNG")
    return buf.getvalue()


def test_upload_then_run_encodes_live(client):
    resp = client.post("/uploads", files={"file": ("my slide.png", _png(128, 96), "image/png")},
                       data={"pack": "toy"})
    assert resp.status_code == 201, resp.text
    case = resp.json()
    assert case["uploaded"] and case["n_patches"] == 48 and case["title"] == "my slide.png"
    run_id = client.post("/runs", json={"case_id": case["case_id"]}).json()["run_id"]
    steps = client.get(f"/runs/{run_id}/steps").json()
    assert [s["step"] for s in steps] == STEPS and steps[2]["cached"] is False
    assert steps[4]["payload"]["patch_images"]  # gallery images for the top patches
    img = client.get(f"/cases/{case['case_id']}/patches/0")
    assert img.status_code == 200 and img.headers["content-type"] in ("image/jpeg", "image/png")
    assert case["case_id"] in [c["case_id"] for c in client.get("/cases").json()]


def test_upload_rejects_bad_input(client):
    bad = client.post("/uploads", files={"file": ("x.png", b"not an image", "image/png")}, data={"pack": "toy"})
    assert bad.status_code == 422
    tiny = client.post("/uploads", files={"file": ("t.png", _png(8, 8), "image/png")}, data={"pack": "toy"})
    assert tiny.status_code == 422
    assert client.post("/uploads", files={"file": ("t.png", _png(64, 64), "image/png")},
                       data={"pack": "nope"}).status_code == 400


def test_worklist_and_packs(client):
    run_id = client.post("/runs", json={"case_id": "toy-02"}).json()["run_id"]
    items = {i["case_id"]: i for i in client.get("/worklist").json()}
    assert items["toy-02"]["run_id"] == run_id and 0 <= items["toy-02"]["probability"] <= 1
    assert client.get("/packs").json()[0] == {"name": "toy", "title": "toy", "upload": True,
                                              "patch_px": 16, "tile_um": None}


def test_packs_without_a_trained_head_are_skipped(tmp_path, monkeypatch):
    import json

    from evidence_api.packs import packs_from_env

    (tmp_path / "m").mkdir()
    (tmp_path / "m" / "spec.json").write_text("{}")
    spec = [{"name": "ok", "cases_dir": str(tmp_path / "c"), "model_dir": str(tmp_path / "m"),
             "uploads": str(tmp_path / "u")},
            {"name": "missing", "cases_dir": str(tmp_path / "c"), "model_dir": str(tmp_path / "nope")}]
    monkeypatch.setenv("EVIDENCE_PACKS", json.dumps(spec))
    packs = packs_from_env()
    assert [p.name for p in packs] == ["ok"]
    assert packs[0].uploads_dir == tmp_path / "u"
