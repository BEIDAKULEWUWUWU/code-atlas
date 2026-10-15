# Taskflow

A small task board: a static front end in `web/` and a JSON API in `api/`.

This directory is a **fixture**, not a runnable product. It exists so the screenshots and
the relation tests have a project to look at that is shaped like the ones people actually
map — a front end that calls an API, a few modules deep in each, and one endpoint written
down in two languages at once.

It is deliberately small. Every number the viewer shows about it can be checked by hand.

## Layout

```
web/            TypeScript front end, no framework
  src/api.ts    the endpoints, one function each
  src/client.ts fetch wrapper
api/            Python JSON API
  routes/       one module per resource
  tests/
docs/           notes, not code
```

## Running it

It does not run. See `docs/architecture.md` for what it would do if it did.
