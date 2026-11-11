#!/usr/bin/env bash
# Checks the Bibles in bibles-import/ (or a folder given as the first argument) through the app.
set -e
cd "$(dirname "$0")/.."
npx vite build >/dev/null
(cd dist && python3 -m http.server 4871 --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
LD_LIBRARY_PATH=$HOME/.local/chromium-libs/root/usr/lib/x86_64-linux-gnu node tests/check-bibles.mjs "${@:-bibles-import/extracted}"
