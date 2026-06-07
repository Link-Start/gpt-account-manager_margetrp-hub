from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def message_key(message: dict[str, Any]) -> str:
    return "|".join([
        str(message.get("source", "")),
        str(message.get("account", "")),
        str(message.get("folder", "")),
        str(message.get("mid", "")),
        str(message.get("subject", "")),
        str(message.get("received_at", "")),
    ])


def load_messages(
    path: Path,
    *,
    coerce_text: Callable[[Any], str],
    normalize_mail_type: Callable[[Any, str], str],
    mail_type_labels: dict[str, str],
) -> list[dict[str, Any]]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return []
    rows = raw.get("messages", []) if isinstance(raw, dict) else raw
    if not isinstance(rows, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        message = dict(item)
        message_text = " ".join(
            coerce_text(message.get(key))
            for key in ["sender", "subject", "preview", "body", "html_body", "mail_type_label"]
        )
        normalized_type = normalize_mail_type(message.get("mail_type"), message_text)
        message["mail_type"] = normalized_type
        message["mail_type_label"] = mail_type_labels.get(normalized_type, "other")
        cleaned.append(message)
    return cleaned


def save_messages(
    messages: list[dict[str, Any]],
    path: Path,
    *,
    sort_key: Callable[[dict[str, Any]], Any],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    trimmed = sorted(messages, key=sort_key, reverse=True)[:2000]
    payload = {
        "updated_at": _iso_now(),
        "messages": trimmed,
    }
    tmp = path.with_suffix(".json.tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def upsert_messages(
    incoming: list[dict[str, Any]],
    path: Path,
    *,
    coerce_text: Callable[[Any], str],
    normalize_mail_type: Callable[[Any, str], str],
    mail_type_labels: dict[str, str],
    sort_key: Callable[[dict[str, Any]], Any],
) -> None:
    if not incoming:
        return
    cache = {
        message_key(message): message
        for message in load_messages(
            path,
            coerce_text=coerce_text,
            normalize_mail_type=normalize_mail_type,
            mail_type_labels=mail_type_labels,
        )
    }
    now = _iso_now()
    for message in incoming:
        message.setdefault("cached_at", now)
        cache[message_key(message)] = message
    save_messages(list(cache.values()), path, sort_key=sort_key)
