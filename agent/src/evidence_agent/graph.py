"""LangGraph review graph.

gate --abstain/quality--> END (status "abstained")
gate --> tools --> draft --> verify --pass--> human (interrupt: approve | edit) --> END
                     ^          |fail, retries left (template fallback after first LLM failure)
                     +----------+   fail, no retries --> END (status "rejected")
"""

from pathlib import Path
from typing import Any, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from evidence_agent.llm import LLM, TemplateLLM
from evidence_agent.tools import quality_issues, what_if
from evidence_agent.verify import verify_sections
from evidence_contracts import Evidence, Report


class State(TypedDict, total=False):
    evidence: dict
    tools: dict
    sections: list[dict]
    verifier: dict
    status: str
    attempts: int


class ReviewAgent:
    def __init__(self, llm: LLM | None = None, checkpointer: Any = None, max_attempts: int = 2):
        self.llm = llm or TemplateLLM()
        self.fallback = TemplateLLM()
        self.max_attempts = max_attempts
        self.graph = self._build().compile(checkpointer=checkpointer or MemorySaver())

    @classmethod
    def with_sqlite(cls, path: Path, llm: LLM | None = None) -> "ReviewAgent":
        import sqlite3

        from langgraph.checkpoint.sqlite import SqliteSaver

        conn = sqlite3.connect(str(path), check_same_thread=False)
        return cls(llm, SqliteSaver(conn))

    # ---- nodes ----
    def _gate(self, state: State) -> dict:
        ev = Evidence.model_validate(state["evidence"])
        issues = quality_issues(ev)
        if ev.abstain or issues:
            reason = "; ".join(issues) or (
                f"probability {ev.probability} is inside the abstain band, so the model does not decide")
            return {"status": "abstained", "sections": [
                {"title": "Abstained", "text": f"No report drafted: {reason}. Refer to a specialist.",
                 "citations": []}], "verifier": {"passed": True, "errors": []}}
        return {"status": "drafting", "attempts": 0}

    def _tools(self, state: State) -> dict:
        return {"tools": {"what_if": what_if(Evidence.model_validate(state["evidence"]))}}

    def _draft(self, state: State) -> dict:
        ev = Evidence.model_validate(state["evidence"])
        attempts = state.get("attempts", 0)
        llm = self.llm if attempts == 0 else self.fallback
        feedback = state.get("verifier", {}).get("errors", [])
        try:
            sections = llm.draft(ev, feedback)
        except Exception as exc:  # LLM down -> template keeps the demo working
            sections = self.fallback.draft(ev, [f"llm error: {exc}"])
        return {"sections": sections, "attempts": attempts + 1}

    def _verify(self, state: State) -> dict:
        ev = Evidence.model_validate(state["evidence"])
        nums = [v for v in state.get("tools", {}).get("what_if", {}).values()]
        result = verify_sections(state["sections"], ev, nums)
        status = "draft" if result["passed"] else (
            "rejected" if state["attempts"] >= self.max_attempts else "retry")
        return {"verifier": result, "status": status}

    def _human(self, state: State) -> dict:
        decision = interrupt({"sections": state["sections"], "verifier": state["verifier"]})
        if decision.get("action") == "edit":
            ev = Evidence.model_validate(state["evidence"])
            result = verify_sections(decision["sections"], ev,
                                     list(state.get("tools", {}).get("what_if", {}).values()))
            if not result["passed"]:
                return {"verifier": result, "status": "draft"}  # stays a draft; UI shows errors
            return {"sections": decision["sections"], "verifier": result, "status": "edited"}
        return {"status": "approved"}

    def _build(self) -> StateGraph:
        g = StateGraph(State)
        g.add_node("gate", self._gate)
        g.add_node("tools", self._tools)
        g.add_node("draft", self._draft)
        g.add_node("verify", self._verify)
        g.add_node("human", self._human)
        g.add_edge(START, "gate")
        g.add_conditional_edges("gate", lambda s: END if s["status"] == "abstained" else "tools")
        g.add_edge("tools", "draft")
        g.add_edge("draft", "verify")
        g.add_conditional_edges("verify", lambda s: {"draft": "human", "retry": "draft"}.get(
            s["status"], END))
        g.add_edge("human", END)
        return g

    # ---- public API ----
    def start(self, evidence: Evidence, thread_id: str) -> dict:
        """Run until the human step (or the end). Returns a contracts Report dict."""
        cfg = {"configurable": {"thread_id": thread_id}}
        self.graph.invoke({"evidence": evidence.model_dump(mode="json")}, cfg)
        return self.report(thread_id)

    def decide(self, thread_id: str, action: str, sections: list[dict] | None = None) -> dict:
        cfg = {"configurable": {"thread_id": thread_id}}
        self.graph.invoke(Command(resume={"action": action, "sections": sections}), cfg)
        return self.report(thread_id)

    def waiting_for_human(self, thread_id: str) -> bool:
        snap = self.graph.get_state({"configurable": {"thread_id": thread_id}})
        return "human" in snap.next

    def report(self, thread_id: str) -> dict:
        s = self.graph.get_state({"configurable": {"thread_id": thread_id}}).values
        report = Report(case_id=s["evidence"]["case_id"], status=s["status"],
                        sections=s.get("sections", []),
                        verifier=s.get("verifier", {"passed": False, "errors": []}))
        return report.model_dump(mode="json")
