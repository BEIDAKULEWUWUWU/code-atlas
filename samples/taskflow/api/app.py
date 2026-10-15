"""The application object, and nothing else. Routes live in routes/."""

from __future__ import annotations

from flask import Flask, jsonify

from db import session
from models import create_schema
from routes.auth import current_owner
from routes.auth import router as auth_router
from routes.health import router as health_router
from routes.tasks import router as tasks_router


def create_app() -> Flask:
    app = Flask(__name__)
    app.json.sort_keys = False

    with session() as connection:
        create_schema(connection)

    app.register_blueprint(auth_router)
    app.register_blueprint(health_router)
    app.register_blueprint(tasks_router)

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"error": "no such route"}), 404

    @app.errorhandler(Exception)
    def unhandled(error: Exception):
        """A traceback in the response is a gift to whoever is probing the API, and this one is
        reachable without a login. Logged in full, returned in one line."""
        app.logger.exception("unhandled", exc_info=error)
        return jsonify({"error": "internal error"}), 500

    @app.before_request
    def attach_owner():
        app.logger.debug("request from %s", current_owner() or "anonymous")

    return app


app = create_app()
