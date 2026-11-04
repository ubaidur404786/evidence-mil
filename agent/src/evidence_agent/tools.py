"""Deterministic tools the agent may cite. They only read the Evidence; no model calls."""

from evidence_contracts import Evidence


def what_if(evidence: Evidence) -> dict:
    """Probability after removing the top-k patches, read from the deletion curve."""
    curve = {p.removed: p.probability for p in evidence.deletion_curve}
    k = min(len(evidence.top_k), max(curve) if curve else 0)
    return {"removed": k, "probability_before": curve.get(0, evidence.probability),
            "probability_after": curve.get(k, evidence.probability)}


def top_patches(evidence: Evidence) -> list[dict]:
    by_id = {p.patch_id: p for p in evidence.patches}
    return [{"patch_id": i, "row": by_id[i].row, "col": by_id[i].col,
             "contribution": by_id[i].contribution} for i in evidence.top_k]


def quality_issues(evidence: Evidence) -> list[str]:
    issues = []
    if not evidence.patches:
        issues.append("no patches")
    if len(evidence.patches) < 4:
        issues.append("fewer than 4 patches; too little tissue")
    return issues
