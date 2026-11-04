"""Frozen patch encoders behind a small registry (ADR-001)."""

from evidencemil.encoders.base import Encoder, build_encoder, register

__all__ = ["Encoder", "build_encoder", "register"]
