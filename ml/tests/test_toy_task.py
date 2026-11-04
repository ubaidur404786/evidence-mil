"""Gate tests: the heads learn the toy task, localise, and run_case emits 6 events in order."""

from pathlib import Path

import numpy as np
import pytest
import torch
import yaml

from evidencemil.cli import make_toy_bundles
from evidencemil.experiment import run_experiment
from evidencemil.pipeline import STEPS, load_bundle, load_model, run_case, save_model

CONFIG = Path(__file__).parents[1] / "configs" / "toy_additive.yaml"


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    cfg = yaml.safe_load(CONFIG.read_text())
    return run_experiment(cfg, tmp_path_factory.mktemp("toy"))


def test_additive_head_learns_toy_task(trained):
    m = trained.metrics
    assert m["auroc"] > 0.95, m
    assert trained.history[-1] < trained.history[0]


def test_localisation_beats_chance(trained):
    m = trained.metrics
    assert m["loc_top1"] > m["loc_top1_chance"] + 0.3, m


def test_run_case_emits_six_events(trained, tmp_path):
    save_model(trained.model, tmp_path / "model")
    model = load_model(tmp_path / "model")
    ids = make_toy_bundles(tmp_path / "model", tmp_path / "cases", n=2)
    bundle = load_bundle(tmp_path / "cases", ids[0])
    seen = []
    events = list(run_case(bundle, model, report_fn=lambda ev: {"case_id": ev.case_id}))
    for e in events:
        seen.append(e.step.value)
        assert e.case_id == ids[0] and e.index == STEPS.index(e.step.value)
    assert seen == STEPS
    assert events[2].cached is True
    evidence = events[4].payload["evidence"]
    total = sum(p["contribution"] for p in evidence["patches"]) + evidence["bias"]
    assert total == pytest.approx(evidence["logit"], abs=1e-2)
    assert events[5].payload["report"] == {"case_id": ids[0]}


def test_run_case_encodes_live_when_not_cached(trained):
    from evidencemil.data.toy import make_bag
    from evidencemil.pipeline import CaseBundle

    bag = make_bag(np.random.default_rng(1), 1)
    bundle = CaseBundle("live", np.zeros((128, 128)), (8, 8), bag.coords, patches=bag.patches)
    events = list(run_case(bundle, trained.model))
    assert events[2].cached is False and events[5].payload == {"report": {"pending": True}}


def test_onnx_parity(trained, tmp_path):
    ort = pytest.importorskip("onnxruntime")
    from evidencemil.export import export_onnx

    path = tmp_path / "head.onnx"
    export_onnx(trained.model.head, trained.model.spec.dim, path)
    sess = ort.InferenceSession(str(path))
    for n in (3, 64, 200):
        bag = torch.randn(n, trained.model.spec.dim)
        with torch.inference_mode():
            ref = trained.model.head(bag)
        logit, contrib, att = sess.run(None, {"bag": bag.numpy()})
        np.testing.assert_allclose(logit, ref["logit"].numpy(), atol=1e-4)
        np.testing.assert_allclose(contrib, ref["contributions"].numpy(), atol=1e-4)
        np.testing.assert_allclose(att, ref["attention"].numpy(), atol=1e-5)


def test_random_weight_sanity_check(trained):
    from evidencemil.data.toy import make_dataset
    from evidencemil.explain.explain import random_weight_check
    from evidencemil.mil import build_head

    enc = trained.model.encoder()
    bags = [torch.from_numpy(enc.embed(b.patches)) for b in make_dataset(20, seed=5)]
    torch.manual_seed(123)
    fresh = build_head("additive", trained.model.spec.dim, hidden=32)
    rho = random_weight_check(trained.model.head, fresh, bags)
    assert rho < 0.9, rho  # explanations must depend on the learned weights
