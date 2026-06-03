from __future__ import annotations

from typing import Any


REFRESH_STATES = {
    "pending",
    "queued",
    "running",
    "checking_mail",
    "checking_proxy",
    "establishing_session",
    "waiting_code",
    "submitting_code",
    "building_auth",
    "syncing_cpa",
    "persisting",
    "success",
    "failed",
    "cancelled",
}

TERMINAL_REFRESH_STATES = {"success", "failed", "cancelled"}

REFRESH_STATE_STATUS = {
    "pending": "queued",
    "queued": "queued",
    "running": "running",
    "checking_mail": "running",
    "checking_proxy": "running",
    "establishing_session": "running",
    "waiting_code": "running",
    "submitting_code": "running",
    "building_auth": "running",
    "syncing_cpa": "running",
    "persisting": "running",
    "success": "success",
    "failed": "failed",
    "cancelled": "failed",
}

STEP_STATE = {
    "start": "running",
    "mail_credentials": "checking_mail",
    "proxy": "checking_proxy",
    "proxy_check": "checking_proxy",
    "egress": "checking_proxy",
    "browser_queue": "establishing_session",
    "prepare": "establishing_session",
    "auth_session": "establishing_session",
    "sentinel": "establishing_session",
    "submit_email": "establishing_session",
    "strategy": "establishing_session",
    "identifier": "establishing_session",
    "password": "establishing_session",
    "login_ready": "establishing_session",
    "login_loading": "establishing_session",
    "security_check": "establishing_session",
    "signup_start": "establishing_session",
    "email_input": "establishing_session",
    "password_input": "establishing_session",
    "send_code": "waiting_code",
    "waiting_code": "waiting_code",
    "waiting_email": "waiting_code",
    "mail_code_poll": "waiting_code",
    "mail_code_missing": "waiting_code",
    "manual_email_code": "waiting_code",
    "phone_otp": "waiting_code",
    "phone_code": "waiting_code",
    "submit_code": "submitting_code",
    "verify_code": "submitting_code",
    "email_verified": "submitting_code",
    "oauth_callback": "building_auth",
    "token_exchange": "building_auth",
    "oauth": "building_auth",
    "session": "building_auth",
    "fetch_session": "building_auth",
    "convert": "building_auth",
    "upload": "syncing_cpa",
    "uploading": "syncing_cpa",
    "persist_success": "persisting",
    "persist_failed": "persisting",
    "done": "success",
    "success": "success",
    "failed": "failed",
    "cancel": "cancelled",
}

STATE_ALIASES = {
    "idle": "pending",
    "wait": "pending",
    "waiting": "pending",
    "start": "queued",
    "started": "running",
    "in_progress": "running",
    "mail": "checking_mail",
    "mail_check": "checking_mail",
    "mail_credentials": "checking_mail",
    "proxy": "checking_proxy",
    "proxy_check": "checking_proxy",
    "auth": "establishing_session",
    "auth_session": "establishing_session",
    "oauth": "establishing_session",
    "code": "waiting_code",
    "wait_code": "waiting_code",
    "email_code": "waiting_code",
    "phone_code": "waiting_code",
    "submit": "submitting_code",
    "submit_code": "submitting_code",
    "callback": "building_auth",
    "token": "building_auth",
    "convert": "building_auth",
    "cpa": "syncing_cpa",
    "upload": "syncing_cpa",
    "persist": "persisting",
    "saved": "persisting",
    "done": "success",
    "ok": "success",
    "error": "failed",
    "cancel": "cancelled",
    "canceled": "cancelled",
    "login_cancelled": "cancelled",
}


def normalize_refresh_state(value: Any, fallback: str = "pending") -> str:
    text = str(value or "").strip().lower().replace("-", "_")
    normalized = STATE_ALIASES.get(text, text)
    if normalized in REFRESH_STATES:
        return normalized
    if fallback and fallback != text:
        return normalize_refresh_state(fallback, "pending")
    return "pending"


def refresh_status_for_state(state: Any) -> str:
    normalized = normalize_refresh_state(state)
    return REFRESH_STATE_STATUS.get(normalized, "queued")


def is_terminal_refresh_state(state: Any) -> bool:
    return normalize_refresh_state(state) in TERMINAL_REFRESH_STATES


def refresh_state_from_step(step: Any) -> str:
    normalized = str(step or "").strip().lower().replace("-", "_")
    return STEP_STATE.get(normalized, "")


def terminal_refresh_states() -> set[str]:
    return set(TERMINAL_REFRESH_STATES)
