#!/usr/bin/env bash
# Tests the phone's screen server (Java) on this computer with real browsers: fonts, media, Wi-Fi gating and the Wi-Fi camera.
set -e
cd "$(dirname "$0")/.."
JDK=$HOME/.local/android-toolchain/jdk/bin
B=tests/out/server; rm -rf $B; mkdir -p $B/classes $B/assets $B/media/sub
npx vite build >/dev/null
ln -s "$PWD/dist" $B/assets/public
$JDK/javac -d $B/classes tests/server/android/content/res/AssetManager.java android/app/src/main/java/com/osoree/plus/ScreenServer.java tests/server/Harness.java
(cd dist && python3 -m http.server 4872 --bind 127.0.0.1 >/dev/null 2>&1) &
WEB=$!
trap 'kill $WEB' EXIT
sleep 1
LD_LIBRARY_PATH=$HOME/.local/chromium-libs/root/usr/lib/x86_64-linux-gnu node tests/server.mjs "$JDK/java" "$B" "$(hostname -I | awk '{print $1}')"
