from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


PathResolver = Callable[[str, str], Path]
WorkspaceNormalizer = Callable[[str], str]
MapLoader = Callable[[Path], dict[str, Any]]
RowsLoader = Callable[[Path], list[dict[str, Any]]]
RowKeyBuilder = Callable[[dict[str, Any]], str]


@dataclass(frozen=True)
class WorkspaceViews:
    normalize_workspace_id: WorkspaceNormalizer
    workspace_file: PathResolver
    public_accounts_file: Path
    public_temp_addresses_file: Path
    public_generic_accounts_file: Path
    public_messages_file: Path
    public_refresh_results_file: Path
    public_login_history_file: Path
    load_accounts_map: MapLoader
    load_temp_addresses_map: MapLoader
    load_generic_accounts_map: MapLoader
    load_messages_rows: RowsLoader
    load_refresh_results_rows: RowsLoader
    load_login_history_rows: RowsLoader
    message_row_key: RowKeyBuilder
    row_fallback_key: RowKeyBuilder

    def accounts(self, workspace_id: str) -> dict[str, Any]:
        return self._load_map(
            workspace_id,
            filename="accounts.json",
            public_file=self.public_accounts_file,
            loader=self.load_accounts_map,
        )

    def temp_addresses(self, workspace_id: str) -> dict[str, Any]:
        return self._load_map(
            workspace_id,
            filename="temp_addresses.json",
            public_file=self.public_temp_addresses_file,
            loader=self.load_temp_addresses_map,
        )

    def generic_accounts(self, workspace_id: str) -> dict[str, Any]:
        return self._load_map(
            workspace_id,
            filename="generic_accounts.json",
            public_file=self.public_generic_accounts_file,
            loader=self.load_generic_accounts_map,
        )

    def messages(self, workspace_id: str) -> list[dict[str, Any]]:
        return self._load_rows(
            workspace_id,
            filename="messages.json",
            public_file=self.public_messages_file,
            loader=self.load_messages_rows,
            row_key=self.message_row_key,
        )

    def refresh_results(self, workspace_id: str, *, row_key: RowKeyBuilder) -> list[dict[str, Any]]:
        return self._load_rows(
            workspace_id,
            filename="refresh_results.json",
            public_file=self.public_refresh_results_file,
            loader=self.load_refresh_results_rows,
            row_key=row_key,
        )

    def login_history(self, workspace_id: str, *, row_key: RowKeyBuilder) -> list[dict[str, Any]]:
        return self._load_rows(
            workspace_id,
            filename="login_history.json",
            public_file=self.public_login_history_file,
            loader=self.load_login_history_rows,
            row_key=row_key,
        )

    def _load_map(
        self,
        workspace_id: str,
        *,
        filename: str,
        public_file: Path,
        loader: MapLoader,
    ) -> dict[str, Any]:
        merged: dict[str, Any] = {}
        for path in self._paths_for_workspace(workspace_id, filename=filename, public_file=public_file):
            merged.update(loader(path))
        return merged

    def _load_rows(
        self,
        workspace_id: str,
        *,
        filename: str,
        public_file: Path,
        loader: RowsLoader,
        row_key: RowKeyBuilder,
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        for path in self._paths_for_workspace(workspace_id, filename=filename, public_file=public_file):
            for row in loader(path):
                merged[row_key(row)] = row
        return list(merged.values())

    def _paths_for_workspace(self, workspace_id: str, *, filename: str, public_file: Path) -> list[Path]:
        workspace = self.normalize_workspace_id(workspace_id)
        paths = [self.workspace_file(workspace, filename)]
        if workspace == "public":
            paths.insert(0, public_file)
        return paths


def json_row_fallback_key(row: dict[str, Any]) -> str:
    return json.dumps(row, ensure_ascii=False, sort_keys=True)
