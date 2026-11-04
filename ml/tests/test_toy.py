import numpy as np

from evidencemil.data.toy import make_bag, make_dataset


def test_shapes_and_range():
    bag = make_bag(np.random.default_rng(0), label=1, grid=(4, 5), patch_size=12)
    assert bag.patches.shape == (20, 12, 12)
    assert bag.coords.shape == (20, 2)
    assert bag.coords[-1].tolist() == [3, 4]
    assert 0.0 <= bag.patches.min() and bag.patches.max() <= 1.0


def test_mil_labels_match_masks():
    for bag in make_dataset(50, seed=1):
        assert bag.label == int(bag.patch_mask.any())
        if bag.label:
            assert 1 <= bag.patch_mask.sum() <= 4


def test_positive_patches_are_brighter():
    bag = make_bag(np.random.default_rng(2), label=1)
    pos = bag.patches[bag.patch_mask].max(axis=(1, 2)).mean()
    neg = bag.patches[~bag.patch_mask].mean()
    assert pos > neg + 0.4


def test_deterministic_and_balanced():
    a, b = make_dataset(200, seed=3), make_dataset(200, seed=3)
    assert all(np.array_equal(x.patches, y.patches) for x, y in zip(a, b, strict=True))
    assert 70 < sum(x.label for x in a) < 130
