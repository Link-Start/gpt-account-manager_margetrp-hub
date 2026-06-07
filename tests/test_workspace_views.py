import json
import tempfile
import unittest
from pathlib import Path

import server as s


def microsoft_row(email: str, *, password: str, client_id: str, refresh_token: str) -> dict[str, str]:
    return {
        "email": email,
        "password": password,
        "client_id": client_id,
        "refresh_token": refresh_token,
    }


class WorkspaceViewsIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.originals = {
            "WORKSPACES_DIR": s.WORKSPACES_DIR,
            "ACCOUNTS_FILE": s.ACCOUNTS_FILE,
            "TEMP_ADDRESSES_FILE": s.TEMP_ADDRESSES_FILE,
            "GENERIC_ACCOUNTS_FILE": s.GENERIC_ACCOUNTS_FILE,
            "MESSAGES_FILE": s.MESSAGES_FILE,
            "REFRESH_RESULTS_FILE": s.REFRESH_RESULTS_FILE,
            "LOGIN_HISTORY_FILE": s.LOGIN_HISTORY_FILE,
            "WORKSPACE_VIEWS": s.WORKSPACE_VIEWS,
            "WORKSPACE_STATE": s.WORKSPACE_STATE,
        }
        s.WORKSPACES_DIR = self.root / "workspaces"
        s.ACCOUNTS_FILE = self.root / "accounts.json"
        s.TEMP_ADDRESSES_FILE = self.root / "temp_addresses.json"
        s.GENERIC_ACCOUNTS_FILE = self.root / "generic_accounts.json"
        s.MESSAGES_FILE = self.root / "messages.json"
        s.REFRESH_RESULTS_FILE = self.root / "refresh_results.json"
        s.LOGIN_HISTORY_FILE = self.root / "login_history.json"
        s.WORKSPACE_VIEWS = s.WorkspaceViews(
            normalize_workspace_id=s.normalize_workspace_id,
            workspace_file=s.workspace_file,
            public_accounts_file=s.ACCOUNTS_FILE,
            public_temp_addresses_file=s.TEMP_ADDRESSES_FILE,
            public_generic_accounts_file=s.GENERIC_ACCOUNTS_FILE,
            public_messages_file=s.MESSAGES_FILE,
            public_refresh_results_file=s.REFRESH_RESULTS_FILE,
            public_login_history_file=s.LOGIN_HISTORY_FILE,
            load_accounts_map=s.load_accounts,
            load_temp_addresses_map=s.load_temp_addresses,
            load_generic_accounts_map=s.load_generic_accounts,
            load_messages_rows=s.load_messages,
            load_refresh_results_rows=s.load_refresh_results,
            load_login_history_rows=s.load_login_history,
            message_row_key=s.workspace_message_row_key,
            row_fallback_key=s.json_row_fallback_key,
        )
        s.WORKSPACE_STATE = s.WorkspaceState(
            workspaces_dir=s.WORKSPACES_DIR,
            views=s.WORKSPACE_VIEWS,
            save_accounts_map=s.save_accounts,
            save_temp_addresses_map=s.save_temp_addresses,
            save_generic_accounts_map=s.save_generic_accounts,
            save_messages_rows=s.save_messages,
            message_key=s.message_key,
            coerce_text=s.coerce_text,
            iso_now=s.iso_now,
            row_fallback_key=s.json_row_fallback_key,
        )

    def tearDown(self) -> None:
        for key, value in self.originals.items():
            setattr(s, key, value)
        self.tmp.cleanup()

    def write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def public_workspace_dir(self) -> Path:
        return s.workspace_file("public", "dummy").parent

    def test_public_workspace_merges_root_and_public_files(self) -> None:
        self.write_json(s.ACCOUNTS_FILE, {
            "accounts": [
                microsoft_row("root@example.com", password="root-pass", client_id="root-client", refresh_token="root-rt"),
                microsoft_row("same@example.com", password="old-pass", client_id="old-client", refresh_token="old-rt"),
            ]
        })
        self.write_json(s.MESSAGES_FILE, {
            "messages": [
                {
                    "source": "root",
                    "account": "root@example.com",
                    "folder": "inbox",
                    "mid": "1",
                    "subject": "hello",
                    "received_at": "2026-06-08T00:00:00+00:00",
                }
            ]
        })
        self.write_json(s.REFRESH_RESULTS_FILE, {
            "results": [
                {"email": "root@example.com", "job_id": "job-root"},
                {"email": "same@example.com", "job_id": "job-old"},
            ]
        })
        self.write_json(s.LOGIN_HISTORY_FILE, {
            "history": [
                {"job_id": "job-root", "status": "success"},
                {"job_id": "job-old", "status": "failed"},
            ]
        })

        public_dir = self.public_workspace_dir()
        self.write_json(public_dir / "accounts.json", {
            "accounts": [
                microsoft_row("public@example.com", password="public-pass", client_id="public-client", refresh_token="public-rt"),
                microsoft_row("same@example.com", password="new-pass", client_id="new-client", refresh_token="new-rt"),
            ]
        })
        self.write_json(public_dir / "messages.json", {
            "messages": [
                {
                    "source": "public",
                    "account": "public@example.com",
                    "folder": "inbox",
                    "mid": "2",
                    "subject": "world",
                    "received_at": "2026-06-08T01:00:00+00:00",
                }
            ]
        })
        self.write_json(public_dir / "refresh_results.json", {
            "results": [
                {"email": "public@example.com", "job_id": "job-public"},
                {"email": "same@example.com", "job_id": "job-new"},
            ]
        })
        self.write_json(public_dir / "login_history.json", {
            "history": [
                {"job_id": "job-public", "status": "success"},
                {"job_id": "job-old", "status": "success"},
            ]
        })

        accounts = s.load_workspace_accounts("public")
        messages = s.load_workspace_messages("public")
        refresh_rows = s.load_workspace_refresh_results("public")
        history_rows = s.load_workspace_login_history("public")

        self.assertEqual(set(accounts.keys()), {"root@example.com", "public@example.com", "same@example.com"})
        self.assertEqual(accounts["same@example.com"].password, "new-pass")
        self.assertEqual(len(messages), 2)
        refresh_map = {row["email"]: row for row in refresh_rows}
        self.assertEqual(set(refresh_map.keys()), {"root@example.com", "public@example.com", "same@example.com"})
        self.assertEqual(refresh_map["same@example.com"]["job_id"], "job-new")
        history_map = {row["job_id"]: row for row in history_rows}
        self.assertEqual(set(history_map.keys()), {"job-root", "job-public", "job-old"})
        self.assertEqual(history_map["job-old"]["status"], "success")

    def test_non_public_workspace_does_not_fall_back_to_root_public_files(self) -> None:
        self.write_json(s.ACCOUNTS_FILE, {
            "accounts": [microsoft_row("root@example.com", password="root-pass", client_id="root-client", refresh_token="root-rt")]
        })
        self.write_json(s.workspace_file("team-a1", "accounts.json"), {
            "accounts": [microsoft_row("workspace@example.com", password="ws-pass", client_id="ws-client", refresh_token="ws-rt")]
        })

        accounts = s.load_workspace_accounts("team-a1")

        self.assertEqual(set(accounts.keys()), {"workspace@example.com"})
        self.assertNotIn("root@example.com", accounts)

    def test_public_save_helpers_keep_root_and_workspace_paths_in_sync(self) -> None:
        self.write_json(s.ACCOUNTS_FILE, {
            "accounts": [microsoft_row("root@example.com", password="root-pass", client_id="root-client", refresh_token="root-rt")]
        })
        public_dir = self.public_workspace_dir()
        self.write_json(public_dir / "accounts.json", {
            "accounts": [microsoft_row("public@example.com", password="public-pass", client_id="public-client", refresh_token="public-rt")]
        })

        accounts = s.load_workspace_accounts("public")
        accounts.pop("root@example.com", None)
        accounts["new@example.com"] = s.MailAccount(
            email="new@example.com",
            password="new-pass",
            client_id="new-client",
            refresh_token="new-rt",
        )
        s.save_workspace_accounts_state("public", accounts)

        workspace_accounts = s.load_accounts(s.workspace_accounts_path("public"))
        root_accounts = s.load_accounts(s.ACCOUNTS_FILE)
        self.assertEqual(set(workspace_accounts.keys()), {"public@example.com", "new@example.com"})
        self.assertEqual(set(root_accounts.keys()), {"public@example.com", "new@example.com"})

    def test_public_workspace_dedupes_same_message_across_root_and_workspace_files(self) -> None:
        duplicated = {
            "source": "microsoft",
            "account": "dup@example.com",
            "folder": "inbox",
            "mid": "msg-1",
            "subject": "same subject",
            "received_at": "2026-06-08T02:00:00+00:00",
            "cached_at": "2026-06-08T02:10:00+00:00",
        }
        self.write_json(s.MESSAGES_FILE, {"messages": [duplicated]})
        public_dir = self.public_workspace_dir()
        self.write_json(public_dir / "messages.json", {
            "messages": [
                {
                    **duplicated,
                    "cached_at": "2026-06-08T02:20:00+00:00",
                    "mail_type_label": "verification",
                }
            ]
        })

        messages = s.load_workspace_messages("public")

        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["account"], "dup@example.com")

    def test_startup_login_history_uses_workspace_path_when_entry_marks_public(self) -> None:
        public_dir = self.public_workspace_dir()
        self.write_json(public_dir / "login_history.json", {
            "history": [
                {"job_id": "job-public", "status": "success", "workspace_id": "public"},
            ]
        })

        history_rows = s.startup_login_history_entries()

        self.assertEqual(len(history_rows), 1)
        self.assertEqual(history_rows[0]["workspace_id"], "public")

    def test_public_workspace_upsert_messages_syncs_root_and_workspace_files(self) -> None:
        root_message = {
            "source": "microsoft",
            "account": "root@example.com",
            "folder": "inbox",
            "mid": "root-1",
            "subject": "root",
            "received_at": "2026-06-08T00:00:00+00:00",
        }
        workspace_message = {
            "source": "temp",
            "account": "temp@example.com",
            "folder": "inbox",
            "mid": "temp-1",
            "subject": "temp",
            "received_at": "2026-06-08T01:00:00+00:00",
        }
        incoming = {
            "source": "generic",
            "account": "new@example.com",
            "folder": "inbox",
            "mid": "new-1",
            "subject": "new",
            "received_at": "2026-06-08T02:00:00+00:00",
        }
        self.write_json(s.MESSAGES_FILE, {"messages": [root_message]})
        public_dir = self.public_workspace_dir()
        self.write_json(public_dir / "messages.json", {"messages": [workspace_message]})

        s.workspace_state().upsert_messages_state("public", [incoming])

        root_messages = s.load_messages(s.MESSAGES_FILE)
        workspace_messages = s.load_messages(public_dir / "messages.json")
        expected_accounts = {"root@example.com", "temp@example.com", "new@example.com"}
        self.assertEqual({row["account"] for row in root_messages}, expected_accounts)
        self.assertEqual({row["account"] for row in workspace_messages}, expected_accounts)


if __name__ == "__main__":
    unittest.main()
