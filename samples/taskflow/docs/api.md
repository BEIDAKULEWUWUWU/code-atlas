# API

All bodies are JSON. All errors are `{"error": "..."}` with the status that goes with them.

| Method | Path | Sends | Answers |
|---|---|---|---|
| GET | `/api/tasks` | `?owner=` optional | `200` an array of tasks |
| POST | `/api/tasks` | `{title, due?, owner?}` | `201` the task, `400` without a title |
| PATCH | `/api/tasks/<id>` | any of `title, done, due, owner` | `200` the task, `404` if unknown |
| DELETE | `/api/tasks/<id>` | — | `204`, `404` if unknown |
| POST | `/api/session` | `{owner}` | `201` with a signed token |
| DELETE | `/api/session` | — | `200`, clears the cookie |
| GET | `/api/health` | — | `200`, or `503` with the database error |

A task:

```json
{
  "id": "9f2c1ab40e77",
  "title": "write up the release",
  "done": false,
  "due": "2026-04-02",
  "owner": "ada",
  "created": "2026-03-28T09:14:03.221904+00:00"
}
```

`PATCH` ignores fields it does not recognise rather than rejecting the request. `id` and
`created` are in that set: they are not editable, and a client that sends them back
unchanged should not get an error for it.

`due` is a date, not a timestamp. The board only ever asks which day something is due, and
storing an instant would make "due today" depend on the time zone of whoever is looking.
