# Architecture

Two halves that never share code, joined by one written-down contract.

## The contract

Every task operation is one HTTP request against a path under `/api/tasks`. The front end
writes those paths in `web/src/api.ts`; the API answers them in `api/routes/tasks.py`. Those
are the only two files that need to change when the shape of a task changes.

The paths are written out in both places rather than generated from a shared schema. A
generated client would be more correct and would also mean neither half can be read on its
own — and at this size, being able to read one file and know what it does is worth more than
the guarantee.

## The front end

`web/src/main.ts` is the whole wiring: build two components, subscribe a render function to
the store, fetch once. Everything else is a module with one job.

- `client.ts` is the only file that calls `fetch`. Above it, failures are exceptions.
- `api.ts` is one function per endpoint.
- `store.ts` holds the state and the three mutations over it.
- `components/` are three functions that each return an element and a render method.

There is no framework and no virtual DOM. The list is small and it does not reorder, so
rows are pooled by index and rebuilt in place.

## The API

`app.py` creates the application and registers three blueprints. `routes/` has one module
per resource. `models.py` owns the schema and the row conversion; `db.py` owns the
connection and is the only module that knows SQLite is involved.

Authentication is a signed cookie with no server-side session table, so signing out cannot
revoke a token that has already been issued. That is a deliberate trade for a single-user
board and would not be the right one for anything shared.

## What is not here

No migrations — the schema is created if missing, and changing it means deleting the
database. No background work. No pagination; the list is fetched whole.
