"""Verifier: every number and patch id in the report must exist in the evidence (ADR-005)."""

import re

from evidence_contracts import Evidence

PATCH_RE = re.compile(r"\bpatch(?:es)?\s+#?(\d+(?:\s*(?:,|and)\s*#?\d+)*)", re.IGNORECASE)
NUMBER_RE = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?%?")


def _allowed_numbers(evidence: Evidence, tool_numbers: list[float]) -> set[str]:
    allowed: set[str] = set()

    def add(x: float) -> None:
        for d in (0, 1, 2, 3, 4):
            v = round(x, d)
            allowed.add(f"{v:.{d}f}")
            allowed.add(f"{v:.{d}f}".rstrip("0").rstrip(".") or "0")

    def add_prob(p: float) -> None:
        add(p)
        for d in (0, 1):
            allowed.add(f"{round(p * 100, d):.{d}f}%")

    for x in (evidence.logit, evidence.bias, *tool_numbers):
        add(x)
    add_prob(evidence.probability)
    for pt in evidence.deletion_curve:
        add_prob(pt.probability)
        add(pt.removed)
    for p in evidence.patches:
        add(p.contribution)
        add_prob(p.attention)
        add(p.row)
        add(p.col)
    for n in (len(evidence.patches), len(evidence.top_k)):
        add(n)
    return allowed


def verify_sections(sections: list[dict], evidence: Evidence,
                    tool_numbers: list[float] | None = None) -> dict:
    """Returns contracts VerifierResult: {"passed": bool, "errors": [str]}."""
    ids = {p.patch_id for p in evidence.patches}
    allowed = _allowed_numbers(evidence, tool_numbers or [])
    errors: list[str] = []
    for s in sections:
        text = s["text"]
        for cited in s.get("citations", []):
            if cited not in ids:
                errors.append(f"{s['title']}: citation {cited} is not a patch in the evidence")
        mentioned = set()
        for group in PATCH_RE.findall(text):
            mentioned.update(int(x) for x in re.findall(r"\d+", group))
        for pid in mentioned:
            if pid not in ids:
                errors.append(f"{s['title']}: patch {pid} is not in the evidence")
        stripped = PATCH_RE.sub(" ", text)
        for num in NUMBER_RE.findall(stripped):
            if num not in allowed:
                errors.append(f"{s['title']}: number {num} is not supported by the evidence")
    return {"passed": not errors, "errors": errors}
