"""Encoder interface and registry. Encoders are frozen: embed() never builds a graph."""

from collections.abc import Callable
from typing import Protocol

import numpy as np

_REGISTRY: dict[str, Callable[..., "Encoder"]] = {}


class Encoder(Protocol):
    name: str
    dim: int

    def embed(self, patches: np.ndarray) -> np.ndarray:
        """patches [N, P, P(, C)] float in [0, 1] -> embeddings [N, dim] float32."""
        ...


def register(name: str) -> Callable:
    def deco(factory: Callable[..., Encoder]) -> Callable[..., Encoder]:
        _REGISTRY[name] = factory
        return factory

    return deco


def build_encoder(name: str, **kwargs) -> Encoder:
    # Import side-effect registers the built-in encoders.
    from evidencemil.encoders import dinov2, fake, phikon  # noqa: F401

    if name not in _REGISTRY:
        raise KeyError(f"unknown encoder {name!r}; known: {sorted(_REGISTRY)}")
    return _REGISTRY[name](**kwargs)
