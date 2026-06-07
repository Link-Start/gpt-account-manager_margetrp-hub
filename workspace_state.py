from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from workspace_views import WorkspaceViews, json_row_fallback_key


MapSaver = Callable[[dict[str, Any], Path], None]
TextCoercer = Callable[[Any], str]
RowKeyBuilder = Callable[[dict[str, Any]], str]
RowsSaver = Callable[[list[dict[str, Any]], Path], None]
MessageFilter = Callable[[list[dict[str, Any]], dict[str, Any]], list[dict[str, Any]]]
IsoNowFn = Callable[[], str]


@dataclass(frozen=True)
class WorkspaceState:
    workspaces_dir: Path
    views: WorkspaceViews
    save_accounts_map: MapSaver
    save_temp_addresses_map: MapSaver
    save_generic_accounts_map: MapSaver
    save_messages_rows: RowsSaver
    message_key: RowKeyBuilder
    coerce_text: TextCoercer
    iso_now: IsoNowFn
    row_fallback_key: RowKeyBuilder = json_row_fallback_key

    def normalize_workspace_id(self, workspace_id: Any) -> str:
        return self.views.normalize_workspace_id(workspace_id)

    def accounts_path(self, workspace_id: str) -> Path:
        return self.views.workspace_file(workspace_id, "accounts.json")

    def temp_addresses_path(self, workspace_id: str) -> Path:
        return self.views.workspace_file(workspace_id, "temp_addresses.json")

    def generic_accounts_path(self, workspace_id: str) -> Path:
        return self.views.workspace_file(workspace_id, "generic_accounts.json")

    def messages_path(self, workspace_id: str) -> Path:
        return self.views.workspace_file(workspace_id, "messages.json")

    def message_write_paths(self, workspace_id: str) -> list[Path]:
        workspace = self.normalize_workspace_id(workspace_id)
        paths = [self.messages_path(workspace)]
        if workspace == "public":
            paths.insert(0, self.views.public_messages_file)
        return paths

    def load_accounts(self, workspace_id: str) -> dict[str, Any]:
        return self.views.accounts(workspace_id)

    def load_temp_addresses(self, workspace_id: str) -> dict[str, Any]:
        return self.views.temp_addresses(workspace_id)

    def load_generic_accounts(self, workspace_id: str) -> dict[str, Any]:
        return self.views.generic_accounts(workspace_id)

    def load_messages(self, workspace_id: str) -> list[dict[str, Any]]:
        return self.views.messages(workspace_id)

    def save_messages_state(self, workspace_id: str, messages: list[dict[str, Any]]) -> None:
        for path in self.message_write_paths(workspace_id):
            self.save_messages_rows(messages, path)

    def upsert_messages_state(self, workspace_id: str, incoming: list[dict[str, Any]]) -> int:
        if not incoming:
            return 0
        cache = {self.message_key(message): message for message in self.load_messages(workspace_id)}
        now = self.iso_now()
        for message in incoming:
            message.setdefault("cached_at", now)
            cache[self.message_key(message)] = message
        merged = list(cache.values())
        self.save_messages_state(workspace_id, merged)
        return len(merged)

    def delete_messages_state(
        self,
        workspace_id: str,
        payload: dict[str, Any],
        *,
        filter_messages: MessageFilter,
    ) -> dict[str, Any]:
        messages = self.load_messages(workspace_id)
        raw_messages = payload.get("messages")
        if isinstance(raw_messages, list) and raw_messages:
            targets = [item for item in raw_messages if isinstance(item, dict)]
        else:
            filter_payload = payload.get("filter")
            if isinstance(filter_payload, dict):
                targets = filter_messages(messages, filter_payload)
            else:
                message = payload.get("message")
                if not isinstance(message, dict):
                    raise RuntimeError("缺少要删除的邮件")
                targets = [message]
        target_keys = {self.message_key(item) for item in targets if isinstance(item, dict)}
        if not target_keys:
            return {
                "success": True,
                "deleted": 0,
                "cache_removed": 0,
                "message": "没有匹配到需要清理的缓存邮件",
            }
        kept = [item for item in messages if self.message_key(item) not in target_keys]
        deleted = len(messages) - len(kept)
        if deleted:
            self.save_messages_state(workspace_id, kept)
        return {
            "success": True,
            "deleted": deleted,
            "cache_removed": deleted,
            "message": "已从工具缓存批量清理，不会删除远端真实邮箱邮件",
        }

    def load_refresh_results(self, workspace_id: str) -> list[dict[str, Any]]:
        return self.views.refresh_results(
            workspace_id,
            row_key=lambda row: (
                self.coerce_text(row.get("email")).lower()
                or self.coerce_text(row.get("job_id"))
                or self.row_fallback_key(row)
            ),
        )

    def load_login_history(self, workspace_id: str) -> list[dict[str, Any]]:
        return self.views.login_history(
            workspace_id,
            row_key=lambda row: self.coerce_text(row.get("job_id")) or self.row_fallback_key(row),
        )

    def save_accounts_state(self, workspace_id: str, accounts: dict[str, Any]) -> None:
        workspace = self.normalize_workspace_id(workspace_id)
        self.save_accounts_map(accounts, self.accounts_path(workspace))
        if workspace == "public":
            self.save_accounts_map(accounts, self.views.public_accounts_file)

    def save_temp_addresses_state(self, workspace_id: str, addresses: dict[str, Any]) -> None:
        workspace = self.normalize_workspace_id(workspace_id)
        self.save_temp_addresses_map(addresses, self.temp_addresses_path(workspace))
        if workspace == "public":
            self.save_temp_addresses_map(addresses, self.views.public_temp_addresses_file)

    def save_generic_accounts_state(self, workspace_id: str, accounts: dict[str, Any]) -> None:
        workspace = self.normalize_workspace_id(workspace_id)
        self.save_generic_accounts_map(accounts, self.generic_accounts_path(workspace))
        if workspace == "public":
            self.save_generic_accounts_map(accounts, self.views.public_generic_accounts_file)

    def startup_login_history_entries(self) -> list[dict[str, Any]]:
        history_paths = [self.views.public_login_history_file]
        if self.workspaces_dir.exists():
            history_paths.extend(sorted(self.workspaces_dir.glob("*/login_history.json")))
        history_by_job: dict[str, dict[str, Any]] = {}
        for path in history_paths:
            for entry in self.views.load_login_history_rows(path):
                job_id = self.coerce_text(entry.get("job_id"))
                if not job_id:
                    continue
                workspace_id = self.normalize_workspace_id(entry.get("workspace_id"))
                if workspace_id == "public" and path.parent.parent == self.workspaces_dir:
                    workspace_id = self.normalize_workspace_id(path.parent.name)
                history_by_job[job_id] = {**entry, "workspace_id": workspace_id}
        return list(history_by_job.values())
