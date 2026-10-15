"""Everything under /api/tasks."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from db import session
from models import Task, from_row, insert

# Written as one constant and used by every rule below, so the collection path and the item path
# cannot drift apart — the second one is derived from the first.
TASKS = "/api/tasks"

router = Blueprint("tasks", __name__)


@router.get(TASKS)
def list_tasks():
    owner = request.args.get("owner")
    with session() as connection:
        if owner:
            rows = connection.execute(
                "SELECT * FROM tasks WHERE owner = ? ORDER BY created DESC", (owner,)
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM tasks ORDER BY created DESC").fetchall()
    return jsonify([from_row(row).to_dict() for row in rows])


@router.post(TASKS)
def create_task():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400
    task = Task(title=title, due=body.get("due"), owner=body.get("owner"))
    with session() as connection:
        insert(connection, task)
    return jsonify(task.to_dict()), 201


@router.patch(f"{TASKS}/<task_id>")
def update_task(task_id: str):
    body = request.get_json(silent=True) or {}
    allowed = {"title", "done", "due", "owner"}
    fields = {key: value for key, value in body.items() if key in allowed}
    if not fields:
        return jsonify({"error": "nothing to update"}), 400

    with session() as connection:
        row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            return jsonify({"error": "no such task"}), 404
        task = from_row(row)
        for key, value in fields.items():
            setattr(task, key, value)
        connection.execute(
            "UPDATE tasks SET title = ?, done = ?, due = ?, owner = ? WHERE id = ?",
            (task.title, int(task.done), task.due, task.owner, task.id),
        )
        connection.commit()
    return jsonify(task.to_dict())


@router.delete(f"{TASKS}/<task_id>")
def delete_task(task_id: str):
    with session() as connection:
        cursor = connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        connection.commit()
    if cursor.rowcount == 0:
        return jsonify({"error": "no such task"}), 404
    return "", 204
