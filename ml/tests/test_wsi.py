import numpy as np
import pytest

from evidencemil.pipeline import CaseBundle, load_bundle, save_bundle
from evidencemil.pipeline.bundle import patch_image
from evidencemil.pipeline.png import encode_png, image_data_url
from evidencemil.pipeline.run import localisation

wsi = pytest.importorskip("evidencemil.data.wsi")
pytest.importorskip("PIL")

ASAP = """<?xml version="1.0"?><ASAP_Annotations><Annotations>
<Annotation Name="T1" Type="Polygon" PartOfGroup="Tumor"><Coordinates>
<Coordinate Order="0" X="0" Y="0"/><Coordinate Order="1" X="200" Y="0"/>
<Coordinate Order="2" X="200" Y="100"/><Coordinate Order="3" X="0" Y="100"/></Coordinates></Annotation>
<Annotation Name="X" Type="Polygon" PartOfGroup="_2"><Coordinates>
<Coordinate Order="0" X="0" Y="0"/><Coordinate Order="1" X="9" Y="0"/><Coordinate Order="2" X="9" Y="9"/>
</Coordinates></Annotation></Annotations></ASAP_Annotations>"""


def test_deepzoom_tile_size():
    # 100k px slide: max level 17 (2^17 = 131072) -> level 17 is full resolution, level 16 is 2x down
    assert wsi.deepzoom_tile_size_level0(100_000, 50_000, 17) == 224
    assert wsi.deepzoom_tile_size_level0(200_000, 90_000, 17) == 448


def test_asap_polygons_and_tumour_fraction(tmp_path):
    xml = tmp_path / "a.xml"
    xml.write_text(ASAP)
    polys = wsi.load_asap_polygons(xml)
    assert len(polys) == 1  # exclusion group "_2" skipped
    coords = np.array([[0, 0], [0, 1], [1, 0], [3, 3]])  # tiles of 100 px
    frac = wsi.tile_tumour_fraction(polys, coords, tile_l0=100)
    assert frac.tolist() == pytest.approx([1.0, 1.0, 0.0, 0.0])


def test_localisation_metrics():
    ref = np.array([1.0, 0.8, 0.0, 0.0, 0.0])
    loc = localisation(np.array([5.0, 4.0, 0.1, 0.0, -1.0]), ref)
    assert loc["precision_at_1"] == 1.0 and loc["auroc"] == 1.0 and loc["chance"] == 0.4
    assert localisation(np.zeros(3), np.zeros(3)) is None  # normal slide: nothing to localise


def test_png_rgba_and_jpeg():
    assert encode_png(np.zeros((3, 4, 4), np.uint8))[:8] == b"\x89PNG\r\n\x1a\n"
    assert image_data_url(np.zeros((8, 8, 3), np.uint8)).startswith("data:image/jpeg")
    assert image_data_url(np.zeros((8, 8))).startswith("data:image/png")


def test_bundle_roundtrip_with_overlay_and_crops(tmp_path):
    b = CaseBundle("c1", np.zeros((20, 40, 3), np.uint8), (2, 4), np.array([[0, 0], [1, 3]]),
                   np.ones((2, 8), np.float32), label=1, meta={"title": "t"},
                   overlay=np.zeros((20, 40, 4), np.uint8), reference=np.array([1.0, 0.0]))
    save_bundle(b, tmp_path)
    (tmp_path / "c1_crops").mkdir()
    (tmp_path / "c1_crops" / "1.jpg").write_bytes(b"jpegbytes")
    got = load_bundle(tmp_path, "c1")
    assert got.overlay.shape == (20, 40, 4) and got.reference.tolist() == [1.0, 0.0]
    assert patch_image(got, 1) == (b"jpegbytes", "image/jpeg")
    data, mime = patch_image(got, 0)  # no crop stored -> cut from the thumbnail
    assert mime == "image/png" and data[:4] == b"\x89PNG"
