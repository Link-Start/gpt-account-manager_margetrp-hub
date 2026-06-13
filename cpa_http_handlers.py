from __future__ import annotations

import urllib.parse
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Callable


PayloadHandler = Callable[[dict[str, Any]], dict[str, Any]]
WorkspacePayloadHandler = Callable[[dict[str, Any], str], dict[str, Any]]
LoginStatusLoader = Callable[[str, str], dict[str, Any]]
LocalOauthStatusLoader = Callable[[str], dict[str, Any]]
LoginExceptionClassifier = Callable[[Exception], dict[str, Any]]


@dataclass(frozen=True)
class CpaHttpHandlers:
    get_cpa_login_job: LoginStatusLoader
    get_local_oauth_flow: LocalOauthStatusLoader
    scan_cpa_401: PayloadHandler
    repair_cpa_401: PayloadHandler
    delete_cpa_items: PayloadHandler
    replace_cpa_auth_file: PayloadHandler
    refresh_lifecycle: PayloadHandler
    refresh_cpa_lifecycle: PayloadHandler
    set_login_manual_email_code: WorkspacePayloadHandler
    set_login_manual_phone_code: WorkspacePayloadHandler
    cancel_login_job: WorkspacePayloadHandler
    start_cpa_login_job: WorkspacePayloadHandler
    classify_login_exception: LoginExceptionClassifier
    cpa_direct_oauth_start: PayloadHandler
    cpa_direct_oauth_callback: PayloadHandler

    def _bad_request(self, handler: Any, exc: Exception) -> bool:
        handler.send_json({"success": False, "error": str(exc)[:500]}, status=HTTPStatus.BAD_REQUEST)
        return True

    def _classified_bad_request(self, handler: Any, exc: Exception, *, default_code: str) -> bool:
        details = self.classify_login_exception(exc)
        handler.send_json({
            "success": False,
            "error": details.get("message", str(exc))[:500],
            "error_code": details.get("code", default_code),
            "error_hint": details.get("hint", ""),
            "retryable": details.get("retryable", True),
        }, status=HTTPStatus.BAD_REQUEST)
        return True

    def handle_client_get(self, handler: Any, parsed_request: urllib.parse.ParseResult) -> bool:
        if parsed_request.path == "/client-api/cpa/login-status":
            try:
                params = urllib.parse.parse_qs(parsed_request.query)
                handler.send_json(self.get_cpa_login_job(params.get("job_id", [""])[0], handler.workspace_id()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if parsed_request.path == "/client-api/cpa/local-oauth-status":
            try:
                params = urllib.parse.parse_qs(parsed_request.query)
                handler.send_json(self.get_local_oauth_flow(params.get("state", [""])[0]))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        return False

    def handle_client_post(self, handler: Any) -> bool:
        if handler.path == "/client-api/cpa/scan-401":
            try:
                handler.send_json(self.scan_cpa_401(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/repair-401":
            try:
                handler.send_json(self.repair_cpa_401(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path in {"/client-api/cpa/delete", "/client-api/cpa/delete-selected"}:
            try:
                handler.send_json(self.delete_cpa_items(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/replace-auth":
            try:
                handler.send_json(self.replace_cpa_auth_file(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/accounts/lifecycle-refresh":
            try:
                handler.send_json(self.refresh_lifecycle(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/lifecycle-refresh":
            try:
                handler.send_json(self.refresh_cpa_lifecycle(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/login-manual-code":
            try:
                handler.send_json(self.set_login_manual_email_code(handler.read_json(), handler.workspace_id()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/login-manual-phone-code":
            try:
                handler.send_json(self.set_login_manual_phone_code(handler.read_json(), handler.workspace_id()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/login-cancel":
            try:
                handler.send_json(self.cancel_login_job(handler.read_json(), handler.workspace_id()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/login-start":
            try:
                payload = handler.read_json()
                if payload.get("use_stored_mail_credentials") or payload.get("useStoredMailCredentials"):
                    payload["_allow_stored_mail_credentials"] = True
                handler.send_json(self.start_cpa_login_job(payload, handler.workspace_id()))
            except Exception as exc:
                return self._classified_bad_request(handler, exc, default_code="login_failed")
            return True
        if handler.path == "/client-api/cpa/direct-oauth-start":
            try:
                handler.send_json(self.cpa_direct_oauth_start(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/direct-oauth-callback":
            try:
                handler.send_json(self.cpa_direct_oauth_callback(handler.read_json()))
            except Exception as exc:
                return self._bad_request(handler, exc)
            return True
        if handler.path == "/client-api/cpa/companion-wait-code":
            handler.send_json(
                {"success": False, "error": "Companion 扩展路径已停用；凭证刷新只走 CPA OAuth 协议登录。"},
                status=HTTPStatus.GONE,
            )
            return True
        if handler.path == "/client-api/cpa/manual-oauth-start":
            handler.send_json(
                {"success": False, "error": "手动 OAuth 路径已停用；凭证刷新只走 CPA OAuth 协议登录。"},
                status=HTTPStatus.GONE,
            )
            return True
        if handler.path == "/client-api/cpa/manual-oauth-complete":
            handler.send_json(
                {"success": False, "error": "手动 OAuth 路径已停用；凭证刷新只走 CPA OAuth 协议登录。"},
                status=HTTPStatus.GONE,
            )
            return True
        if handler.path == "/client-api/cpa/local-oauth-start":
            handler.send_json(
                {"success": False, "error": "本机浏览器 OAuth 路径已停用；凭证刷新只走 CPA OAuth 协议登录。"},
                status=HTTPStatus.GONE,
            )
            return True
        return False
