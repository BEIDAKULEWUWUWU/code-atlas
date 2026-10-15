"""The task routes, against a throwaway database."""

from __future__ import annotations

import pytest

from app import create_app
from db import session
from models import create_schema


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TASKFLOW_DB", str(tmp_path / "test.db"))
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture
def seeded(tmp_path, monkeypatch):
    monkeypatch.setenv("TASKFLOW_DB", str(tmp_path / "test.db"))
    with session() as connection:
        create_schema(connection)


def test_list_is_empty_to_start(client):
    assert client.get("/api/tasks").get_json() == []


def test_create_then_list(client):
    created = client.post("/api/tasks", json={"title": "write the tests"})
    assert created.status_code == 201
    body = created.get_json()
    assert body["title"] == "write the tests"
    assert body["done"] is False

    listed = client.get("/api/tasks").get_json()
    assert [task["id"] for task in listed] == [body["id"]]


def test_create_without_a_title_is_rejected(client):
    """A title of spaces is the case worth asserting: it passes a truthiness check and produces
    a row no one can find in the list."""
    response = client.post("/api/tasks", json={"title": "   "})
    assert response.status_code == 400


def test_patch_only_touches_what_it_names(client):
    task = client.post("/api/tasks", json={"title": "one", "owner": "ada"}).get_json()
    patched = client.patch(f"/api/tasks/{task['id']}", json={"done": True}).get_json()
    assert patched["done"] is True
    assert patched["title"] == "one"
    assert patched["owner"] == "ada"


def test_patch_ignores_unknown_fields(client):
    task = client.post("/api/tasks", json={"title": "one"}).get_json()
    patched = client.patch(f"/api/tasks/{task['id']}", json={"id": "hijacked"}).get_json()
    assert patched["id"] == task["id"]


def test_delete_is_idempotent_from_the_client_side(client):
    task = client.post("/api/tasks", json={"title": "one"}).get_json()
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 404
