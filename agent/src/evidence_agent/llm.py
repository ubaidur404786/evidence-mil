"""LLM adapters. The LLM only words the evidence; it never predicts (ADR-005).

template (default, no LLM) · fake (tests) · http (any OpenAI-compatible endpoint: local Ollama /
llama.cpp, or a hosted provider for the open-data demo only).
"""

import json
import os
import urllib.request
from typing import Protocol

from evidence_agent.tools import top_patches, what_if
from evidence_contracts import Evidence


class LLM(Protocol):
    name: str

    def draft(self, evidence: Evidence, feedback: list[str]) -> list[dict]:
        """Return report sections [{title, text, citations}]."""
        ...


def _pct(p: float) -> str:
    return f"{round(p * 100, 1):.1f}%"


class TemplateLLM:
    name = "template"

    def draft(self, evidence: Evidence, feedback: list[str]) -> list[dict]:
        tops = top_patches(evidence)
        wi = what_if(evidence)
        verdict = "positive" if evidence.probability >= 0.5 else "negative"
        ids = ", ".join(str(t["patch_id"]) for t in tops[:3])
        return [
            {"title": "Summary",
             "text": f"The model scores this case {verdict} with probability "
                     f"{_pct(evidence.probability)} (logit {evidence.logit:.2f}).",
             "citations": []},
            {"title": "Evidence",
             "text": f"The strongest contributions come from patches {ids}. "
                     f"Patch {tops[0]['patch_id']} alone adds {tops[0]['contribution']:.2f} to the logit."
                     if tops else "No patch carries a notable contribution.",
             "citations": [t["patch_id"] for t in tops[:3]]},
            {"title": "What-if",
             "text": f"Removing the top {wi['removed']} patches changes the probability from "
                     f"{_pct(wi['probability_before'])} to {_pct(wi['probability_after'])}.",
             "citations": [t["patch_id"] for t in tops[: wi["removed"]]]},
            {"title": "Limits",
             "text": "Decision-support demo, not a medical device. A specialist must review the "
                     "highlighted regions.",
             "citations": []},
        ]


class FakeLLM:
    """Returns scripted section lists in order; repeats the last one."""

    name = "fake"

    def __init__(self, scripted: list[list[dict]]):
        self.scripted = scripted
        self.calls = 0

    def draft(self, evidence: Evidence, feedback: list[str]) -> list[dict]:
        out = self.scripted[min(self.calls, len(self.scripted) - 1)]
        self.calls += 1
        return out


PROMPT = """You write a short review of an image-AI result. Use ONLY numbers and patch ids that appear
in the JSON. Do not add a diagnosis. Return JSON: {{"sections": [{{"title", "text", "citations"}}]}}
with titles Summary, Evidence, What-if, Limits. Citations are patch ids.
Evidence: {evidence}
Tools: {tools}
Fix these verifier errors if any: {feedback}"""


class HttpLLM:
    name = "http"

    def __init__(self, base_url: str, model: str, api_key: str | None = None, timeout: float = 60):
        self.base_url, self.model, self.api_key, self.timeout = base_url.rstrip("/"), model, api_key, timeout

    def draft(self, evidence: Evidence, feedback: list[str]) -> list[dict]:
        ev = evidence.model_dump(mode="json")
        ev["patches"] = [p for p in ev["patches"] if p["patch_id"] in evidence.top_k]
        body = {"model": self.model, "temperature": 0, "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": PROMPT.format(
                    evidence=json.dumps(ev), tools=json.dumps(what_if(evidence)),
                    feedback=json.dumps(feedback))}]}
        req = urllib.request.Request(f"{self.base_url}/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json",
                                              **({"Authorization": f"Bearer {self.api_key}"}
                                                 if self.api_key else {})})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            content = json.loads(resp.read())["choices"][0]["message"]["content"]
        return json.loads(content)["sections"]


def build_llm(kind: str | None = None) -> LLM:
    kind = kind or os.environ.get("EVIDENCE_LLM", "template")
    if kind == "template":
        return TemplateLLM()
    if kind == "http":
        return HttpLLM(os.environ["EVIDENCE_LLM_URL"], os.environ.get("EVIDENCE_LLM_MODEL", "llama3.2"),
                       os.environ.get("EVIDENCE_LLM_KEY"))
    raise ValueError(f"unknown llm {kind!r}")
