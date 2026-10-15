#!/usr/bin/env bash
# Both halves at once, and the cleanup that is easy to forget.
set -euo pipefail

cd "$(dirname "$0")/.."

export TASKFLOW_SECRET="${TASKFLOW_SECRET:-dev-only-not-a-secret}"

python -m pip install -r api/requirements.txt
python api/seed.py --owner local

# The API first: the front end's dev server proxies to it, and a proxy with nothing behind it
# answers 502 with no hint about which half is missing.
python -m flask --app api/app.py run --port 8000 &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT

npm --prefix web install
npm --prefix web run dev
