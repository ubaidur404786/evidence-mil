"""Minimal PNG encoder (stdlib only) so thumbnails can travel inside StepEvents as data URLs."""

import base64
import struct
import zlib

import numpy as np


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def encode_png(image: np.ndarray) -> bytes:
    """image: float [0, 1] or uint8, shape [H, W] (grey) or [H, W, 3] (RGB)."""
    img = image if image.dtype == np.uint8 else (np.clip(image, 0, 1) * 255).round().astype(np.uint8)
    h, w = img.shape[:2]
    colour = 0 if img.ndim == 2 else 2
    raw = b"".join(b"\x00" + img[r].tobytes() for r in range(h))
    header = struct.pack(">IIBBBBB", w, h, 8, colour, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", header)
            + _chunk(b"IDAT", zlib.compress(raw, 6)) + _chunk(b"IEND", b""))


def png_data_url(image: np.ndarray) -> str:
    return "data:image/png;base64," + base64.b64encode(encode_png(image)).decode("ascii")
