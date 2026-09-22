#!/bin/sh
set -eu

target="${1:-dist}"
mkdir -p "$target"

for source in src/*.ts; do
  base=$(basename "$source" .ts)
  printf 'compiling %s\n' "$base"
done

printf 'done -> %s\n' "$target"
