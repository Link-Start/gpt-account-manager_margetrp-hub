import tempfile
import unittest
from pathlib import Path

import server as s


class LoginJobPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.original_file = s.LOGIN_JOBS_FILE
        self.original_jobs = s.LOGIN_JOBS
        self.original_lock = s.LOGIN_JOBS_LOCK
        s.LOGIN_JOBS_FILE = self.root / "login_jobs.sqlite3"
        s.LOGIN_JOBS = {}

    def tearDown(self) -> None:
        s.LOGIN_JOBS_FILE = self.original_file
        s.LOGIN_JOBS = self.original_jobs
        s.LOGIN_JOBS_LOCK = self.original_lock
        self.tmp.cleanup()

    def test_set_login_job_status_persists_terminal_job(self) -> None:
        job = {
            "job_id": "job-1",
            "workspace_id": "public",
            "status": "running",
            "state": "waiting_code",
            "email": "user@example.com",
            "logs": [],
            "created_at": "2026-06-14T10:00:00+00:00",
            "updated_at": "2026-06-14T10:00:00+00:00",
            "started_at": "2026-06-14T10:00:00+00:00",
        }
        s.LOGIN_JOBS["job-1"] = job

        s.set_login_job_status("job-1", "failed", error="bad code", error_code="email_code_invalid")

        rows = s.load_persisted_login_jobs()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["job_id"], "job-1")
        self.assertEqual(rows[0]["status"], "failed")
        self.assertEqual(rows[0]["error_code"], "email_code_invalid")

    def test_manual_codes_are_persisted(self) -> None:
        job = {
            "job_id": "job-2",
            "workspace_id": "public",
            "status": "running",
            "state": "waiting_code",
            "email": "user@example.com",
            "logs": [],
            "created_at": "2026-06-14T10:00:00+00:00",
            "updated_at": "2026-06-14T10:00:00+00:00",
            "started_at": "2026-06-14T10:00:00+00:00",
        }
        s.LOGIN_JOBS["job-2"] = job

        s.set_login_manual_email_code({"job_id": "job-2", "manual_email_code": "123456"}, "public")
        s.set_login_manual_phone_code({"job_id": "job-2", "manual_phone_code": "654321"}, "public")

        rows = s.load_persisted_login_jobs()
        self.assertEqual(rows[0]["manual_email_code"], "123456")
        self.assertEqual(rows[0]["manual_phone_code"], "654321")

    def test_restore_login_job_marks_non_terminal_job_as_interrupted(self) -> None:
        restored = s.restore_login_job(
            {
                "job_id": "job-3",
                "workspace_id": "public",
                "status": "running",
                "state": "waiting_code",
                "email": "user@example.com",
                "logs": [{"message": "waiting"}],
                "created_at": "2026-06-14T10:00:00+00:00",
                "updated_at": "2026-06-14T10:01:00+00:00",
                "started_at": "2026-06-14T10:00:00+00:00",
            }
        )

        self.assertEqual(restored["status"], "failed")
        self.assertEqual(restored["state"], "failed")
        self.assertEqual(restored["error_code"], "login_interrupted")
        self.assertTrue(restored["retryable"])
        self.assertIn("服务重启", restored["error"])
        self.assertEqual(restored["logs"][-1]["step"], "restart")


if __name__ == "__main__":
    unittest.main()
