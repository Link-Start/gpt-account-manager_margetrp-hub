from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


_DB_LOCK = threading.RLock()


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS login_jobs (
            job_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_login_jobs_workspace_updated
            ON login_jobs(workspace_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_login_jobs_updated
            ON login_jobs(updated_at DESC);
        """
    )


def _job_id(job: dict[str, Any]) -> str:
    return str(job.get("job_id") or "").strip()


def upsert_login_job(db_path: Path, job: dict[str, Any], *, limit: int) -> None:
    job_id = _job_id(job)
    if not job_id:
        return
    with _DB_LOCK:
        conn = _connect(db_path)
        try:
            _ensure_schema(conn)
            conn.execute(
                """
                INSERT OR REPLACE INTO login_jobs (
                    job_id, workspace_id, status, state, updated_at, created_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    str(job.get("workspace_id") or ""),
                    str(job.get("status") or ""),
                    str(job.get("state") or ""),
                    str(job.get("updated_at") or ""),
                    str(job.get("created_at") or ""),
                    json.dumps(job, ensure_ascii=False),
                ),
            )
            if limit > 0:
                conn.execute(
                    """
                    DELETE FROM login_jobs
                    WHERE job_id NOT IN (
                        SELECT job_id
                        FROM login_jobs
                        ORDER BY updated_at DESC, rowid DESC
                        LIMIT ?
                    )
                    """,
                    (limit,),
                )
            conn.commit()
        finally:
            conn.close()


def load_login_jobs(db_path: Path) -> list[dict[str, Any]]:
    if not db_path.exists():
        return []
    with _DB_LOCK:
        conn = _connect(db_path)
        try:
            _ensure_schema(conn)
            rows = conn.execute(
                """
                SELECT payload_json
                FROM login_jobs
                ORDER BY updated_at DESC, rowid DESC
                """
            ).fetchall()
            result: list[dict[str, Any]] = []
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"] or ""))
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(payload, dict):
                    result.append(payload)
            return result
        finally:
            conn.close()
