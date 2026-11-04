"""SQLite run store + audit log. Postgres-ready SQL kept plain on purpose."""

import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, case_id TEXT NOT NULL,
  created REAL NOT NULL, events TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL,
  run_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL);
"""


class Store:
    def __init__(self, path: Path | str):
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def add_run(self, run_id: str, case_id: str, events: list[dict]) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT INTO runs VALUES (?, ?, ?, ?)",
                               (run_id, case_id, time.time(), json.dumps(events)))

    def get_run(self, run_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT case_id, events FROM runs WHERE run_id = ?",
                                     (run_id,)).fetchone()
        return None if row is None else {"run_id": run_id, "case_id": row[0], "events": json.loads(row[1])}

    def audit(self, run_id: str | None, action: str, detail: dict) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT INTO audit (ts, run_id, action, detail) VALUES (?, ?, ?, ?)",
                               (time.time(), run_id, action, json.dumps(detail)))

    def audit_log(self, run_id: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT ts, action, detail FROM audit WHERE run_id = ? ORDER BY id",
                                      (run_id,)).fetchall()
        return [{"ts": ts, "action": a, "detail": json.loads(d)} for ts, a, d in rows]
