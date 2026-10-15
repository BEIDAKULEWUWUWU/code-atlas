"""Sessions: the signature has to cover the owner, or the cookie is a claim anyone can edit."""

from __future__ import annotations

import time

import pytest

from app import create_app
from routes.auth import COOKIE, SESSION_DAYS, _sign


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("TASKFLOW_SECRET", "test-secret")
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def test_sign_in_returns_a_signed_token(client):
    body = client.post("/api/session", json={"owner": "ada"}).get_json()
    owner, _, issued, _, signature = body["token"].partition(".")
    assert owner == "ada"
    assert signature == _sign("ada", int(issued))


def test_a_token_signed_for_someone_else_does_not_work(client):
    """The whole point of signing the owner: changing it must invalidate the signature."""
    body = client.post("/api/session", json={"owner": "ada"}).get_json()
    _, _, issued, _, signature = body["token"].partition(".")
    forged = f"root.{issued}.{signature}"

    with client.session_transaction() as session:
        session[COOKIE] = forged
    assert client.get("/api/session").status_code in (401, 405)


def test_an_expired_token_is_refused(client):
    issued = int(time.time()) - (SESSION_DAYS + 1) * 86_400
    with client.session_transaction() as session:
        session[COOKIE] = f"ada.{issued}.{_sign('ada', issued)}"
    assert client.get("/api/session").status_code in (401, 405)


def test_sign_out_clears_the_cookie(client):
    response = client.delete("/api/session")
    assert response.status_code == 200
    assert COOKIE in response.headers.get("Set-Cookie", "")
