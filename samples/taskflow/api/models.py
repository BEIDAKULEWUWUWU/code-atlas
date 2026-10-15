"""The schema, and the row-to-dict conversion every route goes through."""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    due      TEXT,
    owner    TEXT,
    created  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks (owner, done);
"""


@dataclass
class Task:
    title: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    done: bool = False
    due: str | None = None
    owner: str | None = None
    created: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA)
    connection.commit()


def from_row(row: sqlite3.Row) -> Task:
    """SQLite has no boolean type, so `done` arrives as 0 or 1."""
    return Task(
        id=row["id"],
        title=row["title"],
        done=bool(row["done"]),
        due=row["due"],
        owner=row["owner"],
        created=row["created"],
    )


def insert(connection: sqlite3.Connection, task: Task) -> Task:
    connection.execute(
        "INSERT INTO tasks (id, title, done, due, owner, created) VALUES (?, ?, ?, ?, ?, ?)",
        (task.id, task.title, int(task.done), task.due, task.owner, task.created),
    )
    connection.commit()
    return task
