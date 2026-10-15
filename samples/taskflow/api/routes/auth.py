"""Sign in and out. Sessions are signed cookies; there is no server-side session table."""

from __future__ import annotations

import hmac
import os
import time
from functools import wraps

from flask import Blueprint, jsonify, request

COOKIE = "taskflow_session"
SESSION_DAYS = 14

router = Blueprint("auth", __name__)


def _secret() -> bytes:
    secret = os.environ.get("TASKFLOW_SECRET")
    if not secret:
        raise RuntimeError("TASKFLOW_SECRET is not set")
    return secret.encode()


def _sign(owner: str, issued: int) -> str:
    """The signature covers the owner and the issue time, so neither can be edited in place.

    `compare_digest` rather than `==`: the two are the same speed for a correct guess and
    different speeds for a wrong one, and that difference is enough to recover a signature.
    """
    payload = f"{owner}:{issued}".encode()
    return hmac.new(_secret(), payload, "sha256").hexdigest()


def current_owner() -> str | None:
    raw = request.cookies.get(COOKIE)
    if not raw:
        return None
    owner, _, issued, _, signature = raw.partition(".")
    if not owner or not issued or not signature:
        return None
    try:
        issued_at = int(issued)
    except ValueError:
        return None
    if time.time() - issued_at > SESSION_DAYS * 86_400:
        return None
    if not hmac.compare_digest(signature, _sign(owner, issued_at)):
        return None
    return owner


def requires_login(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_owner() is None:
            return jsonify({"error": "signed out"}), 401
        return view(*args, **kwargs)

    return wrapped


@router.post("/api/session")
def sign_in():
    body = request.get_json(silent=True) or {}
    owner = (body.get("owner") or "").strip()
    if not owner:
        return jsonify({"error": "owner is required"}), 400
    issued = int(time.time())
    return jsonify({"owner": owner, "token": f"{owner}.{issued}.{_sign(owner, issued)}"}), 201


@router.delete("/api/session")
def sign_out():
    response = jsonify({"ok": True})
    response.delete_cookie(COOKIE)
    return response
