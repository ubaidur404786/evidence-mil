import numpy as np
import pytest
import torch

from evidencemil.data.bags import BagDataset, EmbeddingCache, write_cache
from evidencemil.data.tiler import assemble_grid, tile_image
from evidencemil.encoders import build_encoder
from evidencemil.explain import deletion_curve, explain_bag, heatmap_grid, top_k
from evidencemil.metrics import ece, localisation_chance, localisation_hit_rate
from evidencemil.mil import build_head
from evidencemil.mil.train import fit_temperature
from evidencemil.pipeline.png import encode_png


def test_tiler_grid_and_background_filter():
    img = np.ones((40, 50), dtype=np.float32)  # white background
    img[:10, :10] = 0.2  # one tissue patch
    t = tile_image(img, 10)
    assert t.grid == (4, 5) and len(t.patches) == 20
    t = tile_image(img, 10, min_tissue=0.5)
    assert t.coords.tolist() == [[0, 0]]
    assert assemble_grid(t.patches, t.coords, t.grid)[:10, :10].mean() == pytest.approx(0.2)
    with pytest.raises(ValueError):
        tile_image(img, 100)


def test_cache_roundtrip_is_memory_mapped(tmp_path):
    rng = np.random.default_rng(0)
    cases = [(f"c{i}", i % 2, rng.random((5 + i, 4)), np.zeros((5 + i, 2), int)) for i in range(3)]
    write_cache(tmp_path, cases)
    cache = EmbeddingCache(tmp_path)
    assert isinstance(cache.embeddings, np.memmap) and cache.dim == 4
    emb, entry = cache.by_id("c2")
    assert emb.shape == (7, 4) and entry.label == 0
    np.testing.assert_allclose(emb, cases[2][2], rtol=1e-6)
    bag, y = BagDataset(cache)[1]
    assert bag.shape == (6, 4) and y.item() == 1.0


def test_encoder_registry():
    enc = build_encoder("fake", dim=8)
    assert enc.embed(np.random.rand(3, 16, 16)).shape == (3, 8)
    assert enc.embed(np.random.rand(2, 16, 16, 3)).shape == (2, 8)
    with pytest.raises(KeyError):
        build_encoder("nope")


@pytest.mark.parametrize("name", ["mean", "additive"])
@pytest.mark.parametrize("n", [1, 7, 50])
def test_additivity_property(name, n):
    torch.manual_seed(n)
    head = build_head(name, 12).eval()
    bag = torch.randn(n, 12)
    out = head(bag)
    assert out["contributions"].shape == (n,)
    assert torch.allclose(out["contributions"].sum() + out["bias"], out["logit"], atol=1e-5)
    assert torch.allclose(out["attention"].sum(), torch.tensor(1.0), atol=1e-5)


def test_abmil_shapes():
    out = build_head("abmil", 12).eval()(torch.randn(9, 12))
    assert out["logit"].shape == () and out["attention"].shape == (9,)


def test_explain_and_deletion_curve():
    torch.manual_seed(0)
    head = build_head("additive", 6).eval()
    bag = torch.randn(10, 6)
    ex = explain_bag(head, bag)
    assert ex.logit == pytest.approx(ex.contributions.sum() + ex.bias, abs=1e-5)
    order = top_k(ex.contributions, 10)
    assert ex.contributions[order[0]] == ex.contributions.max()
    curve = deletion_curve(head, bag, order, max_removed=20)
    assert len(curve) == 10 and curve[0] == (0, pytest.approx(ex.probability))
    grid = heatmap_grid(np.arange(3.0), np.array([[0, 0], [1, 1], [0, 2]]), (2, 3))
    assert grid[1, 1] == 1 and np.isnan(grid[1, 0])


def test_metrics():
    assert ece(np.array([1, 0]), np.array([1.0, 0.0])) == 0.0
    masks = [np.array([1, 0, 0, 0], bool), np.array([0, 0, 0, 0], bool)]
    assert localisation_hit_rate([np.array([5.0, 0, 0, 0]), np.zeros(4)], masks) == 1.0
    assert localisation_chance(masks, k=1) == pytest.approx(0.25)


def test_temperature_scaling_softens_overconfident_logits():
    rng = np.random.default_rng(0)
    labels = rng.integers(0, 2, 400)
    logits = (labels * 2 - 1) * 10.0 * np.where(rng.random(400) < 0.8, 1, -1)  # 80% right, very sure
    assert fit_temperature(logits, labels) > 2.0


def test_png_signature():
    assert encode_png(np.zeros((4, 5))).startswith(b"\x89PNG")
    assert encode_png(np.zeros((4, 5, 3))).startswith(b"\x89PNG")
