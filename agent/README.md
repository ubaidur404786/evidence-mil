# agent

LangGraph review graph: gate → tools → draft → verify → human approval (`interrupt`).
Depends only on `contracts`. The LLM (template by default, or any OpenAI-compatible endpoint via
`EVIDENCE_LLM=http`, `EVIDENCE_LLM_URL`, `EVIDENCE_LLM_MODEL`) only words the evidence; the verifier
rejects any number or patch id not present in it. SQLite checkpointer for resumable approvals.
Test: `uv run pytest agent`.
