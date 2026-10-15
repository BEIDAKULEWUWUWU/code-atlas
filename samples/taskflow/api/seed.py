"""Fill a database with a few tasks, so the front end has something to draw.

    python api/seed.py --owner ada

Not a fixture and not a migration: it is the thing you run once after cloning, and it is
deliberately the only file that both reads the schema and writes rows.
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta

from db import connect
from models import Task, create_schema, insert

SAMPLE = [
    ("read the design notes", 2),
    ("reply to the review", 1),
    ("fix the flaky test", -3),
    ("write up the release", 5),
    ("delete the old branch", None),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", default="local")
    parser.add_argument("--path", default=None, help="database to fill")
    arguments = parser.parse_args()

    today = date.today()
    with connect(arguments.path) as connection:
        create_schema(connection)
        for title, due_in in SAMPLE:
            due = (today + timedelta(days=due_in)).isoformat() if due_in is not None else None
            insert(connection, Task(title=title, due=due, owner=arguments.owner))
    print(f"seeded {len(SAMPLE)} tasks for {arguments.owner}")


if __name__ == "__main__":
    main()
