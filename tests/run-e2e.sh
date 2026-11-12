#!/usr/bin/env bash
# Builds the web app, serves it, and runs the browser tests. Screenshots go to tests/out/.
set -e
cd "$(dirname "$0")/.."
npx vite build >/dev/null
python3 tests/make-fixtures.py >/dev/null
node tests/make-office-fixtures.mjs >/dev/null 2>&1
(cd dist && python3 -m http.server 4871 --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
mkdir -p tests/out
LD_LIBRARY_PATH=$HOME/.local/chromium-libs/root/usr/lib/x86_64-linux-gnu node tests/e2e.mjs "$@"
LD_LIBRARY_PATH=$HOME/.local/chromium-libs/root/usr/lib/x86_64-linux-gnu node tests/licence.mjs
