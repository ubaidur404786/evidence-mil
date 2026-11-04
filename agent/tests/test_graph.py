import pytest

from evidence_agent import FakeLLM, ReviewAgent, TemplateLLM, verify_sections
from evidence_contracts import Evidence


def make_evidence(probability: float = 0.91, abstain: bool = False, n: int = 8) -> Evidence:
    patches = [{"patch_id": i, "row": i // 4, "col": i % 4, "attention": 0.1,
                "contribution": 2.5 if i == 3 else 0.05} for i in range(n)]
    return Evidence(case_id="toy-01", logit=2.3, bias=-0.55, probability=probability,
                    abstain=abstain, patches=patches, top_k=[3, 0, 1],
                    deletion_curve=[{"removed": k, "probability": p}
                                    for k, p in enumerate([probability, 0.3, 0.2, 0.12])])


GOOD = [{"title": "Summary", "text": "Probability 91.0%, driven by patch 3.", "citations": [3]}]
BAD = [{"title": "Summary", "text": "Probability 97%, driven by patch 42.", "citations": [42]}]


def test_verifier_accepts_template_and_rejects_invented_facts():
    ev = make_evidence()
    assert verify_sections(TemplateLLM().draft(ev, []), ev)["passed"]
    result = verify_sections(BAD, ev)
    assert not result["passed"]
    joined = " ".join(result["errors"])
    assert "97%" in joined and "patch 42" in joined and "citation 42" in joined


def test_abstain_path():
    agent = ReviewAgent(FakeLLM([GOOD]))
    report = agent.start(make_evidence(probability=0.52, abstain=True), "t-abstain")
    assert report["status"] == "abstained" and not agent.waiting_for_human("t-abstain")


def test_quality_gate_abstains_on_tiny_bag():
    report = ReviewAgent().start(make_evidence(n=2).model_copy(update={"top_k": [0]}), "t-q")
    assert report["status"] == "abstained"


def test_verifier_reject_then_template_fallback_succeeds():
    llm = FakeLLM([BAD])
    agent = ReviewAgent(llm)
    report = agent.start(make_evidence(), "t-fallback")
    assert llm.calls == 1  # second attempt used the template
    assert report["status"] == "draft" and report["verifier"]["passed"]
    assert agent.waiting_for_human("t-fallback")


def test_verifier_reject_path_when_retries_exhausted():
    agent = ReviewAgent(FakeLLM([BAD]), max_attempts=1)
    report = agent.start(make_evidence(), "t-reject")
    assert report["status"] == "rejected" and not report["verifier"]["passed"]
    assert not agent.waiting_for_human("t-reject")


def test_approve_path():
    agent = ReviewAgent(FakeLLM([GOOD]))
    assert agent.start(make_evidence(), "t-ok")["status"] == "draft"
    report = agent.decide("t-ok", "approve")
    assert report["status"] == "approved" and report["sections"] == GOOD


def test_edit_path_reverified():
    agent = ReviewAgent(FakeLLM([GOOD]))
    agent.start(make_evidence(), "t-edit")
    bad = agent.decide("t-edit", "edit", BAD)
    assert bad["status"] == "draft" and not bad["verifier"]["passed"]


def test_llm_exception_falls_back():
    class Broken:
        name = "broken"

        def draft(self, *_):
            raise ConnectionError("down")

    assert ReviewAgent(Broken()).start(make_evidence(), "t-down")["verifier"]["passed"]


def test_sqlite_checkpointer_survives_new_agent(tmp_path):
    db = tmp_path / "ck.sqlite"
    ReviewAgent.with_sqlite(db, FakeLLM([GOOD])).start(make_evidence(), "t-db")
    report = ReviewAgent.with_sqlite(db).decide("t-db", "approve")
    assert report["status"] == "approved"


@pytest.mark.parametrize("text", ["Logit 2.30.", "Removing 3 patches gives 12.0%.", "Bias -0.55."])
def test_verifier_allows_real_numbers(text):
    assert verify_sections([{"title": "t", "text": text, "citations": []}], make_evidence())["passed"]
