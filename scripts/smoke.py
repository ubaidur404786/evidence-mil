"""Smoke test against a running stack (compose, kind or cloud).

  uv run python scripts/smoke.py http://localhost:8080/api
Checks: health, cases, a full run with six SSE steps in order, report verifier, approve.
"""

import json
import sys
import urllib.request

STEPS = ["input", "tile", "encode", "aggregate", "explain", "report"]


def call(url: str, data: dict | None = None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode()
    return body if "text/event-stream" in r.headers.get("content-type", "") else json.loads(body)


def main(base: str) -> None:
    base = base.rstrip("/")
    assert call(f"{base}/health")["status"] == "ok"
    cases = call(f"{base}/cases")
    assert cases, "no demo cases"
    run = call(f"{base}/runs", {"case_id": cases[0]["case_id"]})
    sse = call(f"{base}/runs/{run['run_id']}/events")
    steps = [json.loads(line[6:])["step"] for line in sse.splitlines()
             if line.startswith("data: ") and line != "data: {}"]
    assert steps == STEPS, steps
    report = call(f"{base}/runs/{run['run_id']}/report")
    assert report["verifier"]["passed"], report
    if report["status"] == "draft":
        assert call(f"{base}/runs/{run['run_id']}/decision", {"action": "approve"})["status"] == "approved"
    print(f"smoke OK: {len(cases)} cases, run {run['run_id']} -> {report['status']}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/api")
