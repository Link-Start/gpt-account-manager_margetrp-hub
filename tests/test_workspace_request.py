import unittest
from http import HTTPStatus

import server as s


class WorkspaceRequestIdTests(unittest.TestCase):
    def test_missing_workspace_defaults_to_public(self) -> None:
        self.assertEqual(s.request_workspace_id("", ""), "public")

    def test_valid_header_takes_priority(self) -> None:
        self.assertEqual(
            s.request_workspace_id("ws_alpha01", "ws_beta02"),
            "ws_alpha01",
        )

    def test_invalid_header_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            s.request_workspace_id("bad id", "")

    def test_invalid_query_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            s.request_workspace_id("", "bad id")

    def test_valid_query_is_used_when_header_missing(self) -> None:
        self.assertEqual(s.request_workspace_id("", "ws_query1"), "ws_query1")


class HandlerWorkspaceRequestTests(unittest.TestCase):
    def test_handler_workspace_id_rejects_invalid_value(self) -> None:
        sent = {}

        class DummyHeaders:
            def get(self, key, default=""):
                if key == "X-Workspace-Id":
                    return "bad id"
                return default

        handler = s.Handler.__new__(s.Handler)
        handler.path = "/client-api/accounts"
        handler.headers = DummyHeaders()

        def fake_send_json(payload, status=HTTPStatus.OK):
            sent["payload"] = payload
            sent["status"] = status

        handler.send_json = fake_send_json

        with self.assertRaises(s.RequestHandled):
            handler.workspace_id()

        self.assertEqual(sent["status"], HTTPStatus.BAD_REQUEST)
        self.assertEqual(sent["payload"]["error_code"], "invalid_workspace_id")


if __name__ == "__main__":
    unittest.main()
