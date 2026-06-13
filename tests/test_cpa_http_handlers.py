import unittest
from http import HTTPStatus
from types import SimpleNamespace

from cpa_http_handlers import CpaHttpHandlers


class DummyHandler:
    def __init__(self, *, path="/", payload=None, workspace_id="ws_demo", query=""):
        self.path = path
        self._payload = payload if payload is not None else {}
        self._workspace_id = workspace_id
        self.sent = []
        self.read_count = 0
        self.parsed = SimpleNamespace(path=path, query=query)

    def read_json(self):
        self.read_count += 1
        return dict(self._payload)

    def workspace_id(self):
        return self._workspace_id

    def send_json(self, payload, status=HTTPStatus.OK):
        self.sent.append((payload, status))


class CpaHttpHandlersTests(unittest.TestCase):
    def make_handlers(self, **overrides):
        defaults = {
            "get_cpa_login_job": lambda job_id, workspace: {"success": True, "job_id": job_id, "workspace": workspace},
            "get_local_oauth_flow": lambda state: {"success": True, "state": state},
            "scan_cpa_401": lambda payload: {"success": True, "kind": "scan", "payload": payload},
            "repair_cpa_401": lambda payload: {"success": True, "kind": "repair", "payload": payload},
            "delete_cpa_items": lambda payload: {"success": True, "kind": "delete", "payload": payload},
            "replace_cpa_auth_file": lambda payload: {"success": True, "kind": "replace", "payload": payload},
            "refresh_lifecycle": lambda payload: {"success": True, "kind": "local-refresh", "payload": payload},
            "refresh_cpa_lifecycle": lambda payload: {"success": True, "kind": "cpa-refresh", "payload": payload},
            "set_login_manual_email_code": lambda payload, workspace: {"success": True, "kind": "manual-email", "payload": payload, "workspace": workspace},
            "set_login_manual_phone_code": lambda payload, workspace: {"success": True, "kind": "manual-phone", "payload": payload, "workspace": workspace},
            "cancel_login_job": lambda payload, workspace: {"success": True, "kind": "cancel", "payload": payload, "workspace": workspace},
            "start_cpa_login_job": lambda payload, workspace: {"success": True, "kind": "start", "payload": payload, "workspace": workspace},
            "classify_login_exception": lambda exc: {"message": str(exc), "code": "login_failed", "hint": "", "retryable": True},
            "cpa_direct_oauth_start": lambda payload: {"success": True, "kind": "oauth-start", "payload": payload},
            "cpa_direct_oauth_callback": lambda payload: {"success": True, "kind": "oauth-callback", "payload": payload},
        }
        defaults.update(overrides)
        return CpaHttpHandlers(**defaults)

    def test_handle_client_get_login_status_uses_workspace_and_job_id(self):
        handlers = self.make_handlers()
        handler = DummyHandler(path="/client-api/cpa/login-status", query="job_id=job-123")

        handled = handlers.handle_client_get(handler, handler.parsed)

        self.assertTrue(handled)
        self.assertEqual(handler.sent, [({"success": True, "job_id": "job-123", "workspace": "ws_demo"}, HTTPStatus.OK)])

    def test_handle_client_post_lifecycle_refresh_routes_to_local_refresh(self):
        handlers = self.make_handlers()
        handler = DummyHandler(path="/client-api/accounts/lifecycle-refresh", payload={"items": [1]})

        handled = handlers.handle_client_post(handler)

        self.assertTrue(handled)
        self.assertEqual(handler.sent[0][0]["kind"], "local-refresh")
        self.assertEqual(handler.sent[0][0]["payload"], {"items": [1]})

    def test_handle_client_post_login_start_enables_stored_mail_credentials_flag(self):
        seen = {}

        def start_job(payload, workspace):
            seen["payload"] = payload
            seen["workspace"] = workspace
            return {"success": True}

        handlers = self.make_handlers(start_cpa_login_job=start_job)
        handler = DummyHandler(
            path="/client-api/cpa/login-start",
            payload={"email": "user@example.com", "useStoredMailCredentials": True},
        )

        handled = handlers.handle_client_post(handler)

        self.assertTrue(handled)
        self.assertTrue(seen["payload"]["_allow_stored_mail_credentials"])
        self.assertEqual(seen["workspace"], "ws_demo")

    def test_handle_client_post_login_start_uses_classified_error(self):
        handlers = self.make_handlers(
            start_cpa_login_job=lambda payload, workspace: (_ for _ in ()).throw(RuntimeError("boom")),
            classify_login_exception=lambda exc: {
                "message": "代理不可用",
                "code": "proxy_failed",
                "hint": "更换代理",
                "retryable": False,
            },
        )
        handler = DummyHandler(path="/client-api/cpa/login-start", payload={"email": "user@example.com"})

        handled = handlers.handle_client_post(handler)

        self.assertTrue(handled)
        payload, status = handler.sent[0]
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertEqual(payload["error_code"], "proxy_failed")
        self.assertEqual(payload["error"], "代理不可用")
        self.assertFalse(payload["retryable"])

    def test_handle_client_post_disabled_local_oauth_returns_gone(self):
        handlers = self.make_handlers()
        handler = DummyHandler(path="/client-api/cpa/local-oauth-start")

        handled = handlers.handle_client_post(handler)

        self.assertTrue(handled)
        self.assertEqual(handler.sent[0][1], HTTPStatus.GONE)
        self.assertIn("已停用", handler.sent[0][0]["error"])


if __name__ == "__main__":
    unittest.main()
