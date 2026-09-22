"""The connection, and the only module that knows the database exists."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / "data" / "tasks.db"


def connect(path: str | os.PathLike[str] | None = None) -> sqlite3.Connection:
    """Open the database, creating the directory on the way in.

    A missing parent directory is the single most common way this project fails on a fresh
    checkout, and the error SQLite gives for it does not say which directory is missing.
    """
    target = Path(path or os.environ.get("TASKFLOW_DB") or DEFAULT_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def session() -> sqlite3.Connection:
    """The connection for this request.

    One connection per call rather than a pool: SQLite serialises writers anyway, and a pool
    would only move the contention somewhere harder to see.
    """
    return connect()
