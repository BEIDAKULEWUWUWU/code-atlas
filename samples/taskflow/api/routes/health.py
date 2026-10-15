"""Readiness. Deliberately separate from the rest, so a failing database is one red check
rather than every route going down at once."""

from __future__ import annotations

import time

from flask import Blueprint, jsonify

from db import session

STARTED = time.time()

router = Blueprint("health", __name__)


@router.get("/api/health")
def health():
    try:
        with session() as connection:
            connection.execute("SELECT 1").fetchone()
    except Exception as error:  # noqa: BLE001 — the message is the payload
        return jsonify({"ok": False, "database": str(error)}), 503
    return jsonify({"ok": True, "uptime": round(time.time() - STARTED, 1)})
