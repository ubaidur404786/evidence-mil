"""Image encoding for StepEvents (data URLs). PNG is stdlib-only; JPEG is used when Pillow is present."""

import base64
import io
import struct
import zlib

import numpy as np


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def _uint8(image: np.ndarray) -> np.ndarray:
    return image if image.dtype == np.uint8 else (np.clip(image, 0, 1) * 255).round().astype(np.uint8)


def encode_png(image: np.ndarray) -> bytes:
    """image: float [0, 1] or uint8, shape [H, W], [H, W, 3] or [H, W, 4]."""
    img = _uint8(image)
    h, w = img.shape[:2]
    channels = 1 if img.ndim == 2 else img.shape[2]
    colour = {1: 0, 3: 2, 4: 6}[channels]  # PNG colour types: grey, RGB, RGBA
    raw = b"".join(b"\x00" + img[r].tobytes() for r in range(h))
    header = struct.pack(">IIBBBBB", w, h, 8, colour, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", header)
            + _chunk(b"IDAT", zlib.compress(raw, 6)) + _chunk(b"IEND", b""))


def png_data_url(image: np.ndarray) -> str:
    return "data:image/png;base64," + base64.b64encode(encode_png(image)).decode("ascii")


def image_data_url(image: np.ndarray, quality: int = 82) -> str:
    """RGB photos as JPEG (much smaller) when Pillow is installed; everything else as PNG."""
    img = _uint8(image)
    if img.ndim == 3 and img.shape[2] == 3:
        try:
            from PIL import Image
        except ImportError:
            return png_data_url(img)
        buf = io.BytesIO()
        Image.fromarray(img).save(buf, format="JPEG", quality=quality)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return png_data_url(img)


def bytes_data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
