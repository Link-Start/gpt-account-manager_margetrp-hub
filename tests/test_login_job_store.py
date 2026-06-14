import tempfile
import unittest
from pathlib import Path

from storage.login_job_store import load_login_jobs, upsert_login_job


class LoginJobStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "login_jobs.sqlite3"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_upsert_and_load_login_jobs(self) -> None:
        upsert_login_job(
            self.db_path,
            {
                "job_id": "job-a",
                "workspace_id": "public",
                "status": "running",
                "state": "waiting_code",
                "updated_at": "2026-06-14T10:02:00+00:00",
                "created_at": "2026-06-14T10:00:00+00:00",
                "logs": [{"message": "waiting"}],
            },
            limit=10,
        )
        upsert_login_job(
            self.db_path,
            {
                "job_id": "job-b",
                "workspace_id": "ws-a",
                "status": "success",
                "state": "success",
                "updated_at": "2026-06-14T10:03:00+00:00",
                "created_at": "2026-06-14T10:01:00+00:00",
            },
            limit=10,
        )

        rows = load_login_jobs(self.db_path)

        self.assertEqual([row["job_id"] for row in rows], ["job-b", "job-a"])
        self.assertEqual(rows[1]["logs"][0]["message"], "waiting")

    def test_limit_keeps_latest_jobs(self) -> None:
        for index in range(3):
            upsert_login_job(
                self.db_path,
                {
                    "job_id": f"job-{index}",
                    "workspace_id": "public",
                    "status": "running",
                    "state": "running",
                    "updated_at": f"2026-06-14T10:0{index}:00+00:00",
                    "created_at": f"2026-06-14T10:0{index}:00+00:00",
                },
                limit=2,
            )

        rows = load_login_jobs(self.db_path)

        self.assertEqual([row["job_id"] for row in rows], ["job-2", "job-1"])


if __name__ == "__main__":
    unittest.main()
