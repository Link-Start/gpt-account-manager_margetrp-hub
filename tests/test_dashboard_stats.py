import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dashboard_stats import dashboard_stats_response_for_activity_paths
from storage.activity_store import save_login_history, save_refresh_results


class DummyMailbox:
    def __init__(self, email: str, status: str = "idle", error_code: str = ""):
        self.email = email
        self.last_status = status
        self.last_error_code = error_code


class DashboardStatsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def build_response(self, *, refresh_path: Path | None = None, login_path: Path | None = None):
        return dashboard_stats_response_for_activity_paths(
            "ws-1",
            refresh_results_path=refresh_path,
            login_history_path=login_path,
            days=30,
            limit=300,
            tz_offset_minutes=480,
            app_version="1.0.8",
            iso_now=lambda: "2026-06-14T12:00:00+00:00",
            load_workspace_accounts=lambda workspace_id: {"m1": DummyMailbox("ms@example.com")},
            load_workspace_temp_addresses=lambda workspace_id: {"t1": DummyMailbox("temp@example.com")},
            load_workspace_generic_accounts=lambda workspace_id: {"g1": DummyMailbox("imap@example.com", status="error", error_code="imap_failed")},
            load_workspace_refresh_results=lambda workspace_id: [{"email": "fallback@example.com"}],
            load_workspace_login_history=lambda workspace_id: [{"job_id": "fallback-job"}],
            load_workspace_messages=lambda workspace_id: [],
            parse_message_datetime=lambda value: datetime.fromisoformat(value) if value else None,
            normalize_mail_type=lambda value, text: str(value or "unknown"),
            coerce_text=lambda value: "" if value is None else str(value),
            classify_mail=lambda text: "normal",
            first_text=lambda *values: next((str(value) for value in values if value), ""),
        )

    def test_dashboard_stats_activity_path_prefers_sqlite_refresh_and_login_history(self):
        refresh_path = self.root / "refresh_results.json"
        login_path = self.root / "login_history.json"
        save_refresh_results(
            refresh_path,
            [{"email": "sqlite@example.com", "job_id": "job-sqlite", "plan_type": "plus", "refreshed_at": "2026-06-14T11:00:00+00:00"}],
            limit=100,
        )
        save_login_history(
            login_path,
            [{"job_id": "job-sqlite", "status": "success", "finished_at": "2026-06-14T11:05:00+00:00"}],
            limit=100,
        )

        response = self.build_response(refresh_path=refresh_path, login_path=login_path)

        self.assertEqual(response["refresh"]["saved_total"], 1)
        self.assertEqual(response["refresh"]["plans"][0]["plan_type"], "plus")
        self.assertEqual(response["activity"]["login_history_total"], 1)

    def test_dashboard_stats_activity_path_keeps_fallback_when_no_sqlite_path_given(self):
        response = self.build_response()

        self.assertEqual(response["refresh"]["saved_total"], 1)
        self.assertEqual(response["activity"]["login_history_total"], 1)


if __name__ == "__main__":
    unittest.main()
