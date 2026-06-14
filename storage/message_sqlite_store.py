from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable


_DB_LOCK = threading.RLock()

MessageKeyBuilder = Callable[[dict[str, Any]], str]


def sqlite_path_for_json(message_path: Path) -> Path:
    return message_path.with_suffix(".sqlite3")


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS messages (
            dedupe_key TEXT PRIMARY KEY,
            account TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            folder TEXT NOT NULL DEFAULT '',
            mail_type TEXT NOT NULL DEFAULT '',
            sort_value TEXT NOT NULL DEFAULT '',
            cached_at TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_sort_value
            ON messages(sort_value DESC, cached_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_account
            ON messages(account);
        CREATE INDEX IF NOT EXISTS idx_messages_source
            ON messages(source);
        CREATE INDEX IF NOT EXISTS idx_messages_mail_type
            ON messages(mail_type);
        """
    )


def _row_sort_value(row: dict[str, Any]) -> str:
    return str(row.get("received_at") or row.get("cached_at") or "")


def save_messages_snapshot(
    path: Path,
    rows: list[dict[str, Any]],
    *,
    dedupe_key: MessageKeyBuilder,
) -> None:
    db_path = sqlite_path_for_json(path)
    cleaned = [row for row in rows if isinstance(row, dict)]
    with _DB_LOCK:
        conn = _connect(db_path)
        try:
            _ensure_schema(conn)
            conn.execute("DELETE FROM messages")
            for row in cleaned:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO messages (
                        dedupe_key, account, source, folder, mail_type, sort_value, cached_at, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dedupe_key(row),
                        str(row.get("account") or ""),
                        str(row.get("source") or ""),
                        str(row.get("folder") or ""),
                        str(row.get("mail_type") or ""),
                        _row_sort_value(row),
                        str(row.get("cached_at") or ""),
                        json.dumps(row, ensure_ascii=False),
                    ),
                )
            conn.commit()
        finally:
            conn.close()


def load_messages(path: Path) -> list[dict[str, Any]]:
    db_path = sqlite_path_for_json(path)
    if not db_path.exists():
        return []
    with _DB_LOCK:
        conn = _connect(db_path)
        try:
            _ensure_schema(conn)
            rows = conn.execute(
                """
                SELECT payload_json
                FROM messages
                ORDER BY sort_value DESC, cached_at DESC, rowid ASC
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
