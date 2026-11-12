#!/usr/bin/env bash
# Tests the phone's live-stream sender (RtmpPublisher.java) against ffmpeg acting as YouTube/Facebook.
set -e
cd "$(dirname "$0")/.."
JDK=$HOME/.local/android-toolchain/jdk/bin
. $HOME/.local/ffmpeg-ubuntu/env.sh
FF="env LD_LIBRARY_PATH=$LIBS $HOME/.local/ffmpeg-ubuntu/root/usr/bin/ffmpeg -hide_banner -loglevel error"
FP="env LD_LIBRARY_PATH=$LIBS $HOME/.local/ffmpeg-ubuntu/root/usr/bin/ffprobe -hide_banner -loglevel error"
O=tests/out/stream; rm -rf $O; mkdir -p $O/classes
$JDK/javac -d $O/classes android/app/src/main/java/com/osoree/plus/stream/{Amf0,Avc,RtmpPublisher}.java tests/stream/StreamTest.java
# test media: 1280x720 30 fps H.264 with access-unit delimiters and 2 s key frames, plus AAC
$FF -f lavfi -i testsrc2=size=1280x720:rate=30 -t 6 -c:v libx264 -profile:v main -pix_fmt yuv420p -g 60 -bf 0 -x264-params aud=1 -b:v 2500k -f h264 $O/test.h264
$FF -f lavfi -i sine=frequency=440:sample_rate=44100 -ac 2 -t 6 -c:a aac -b:a 128k -f adts $O/test.aac
pass=0; fail=0
ok() { if [ "$2" = 1 ]; then echo "PASS $1 $3"; pass=$((pass+1)); else echo "FAIL $1 $3"; fail=$((fail+1)); fi; }
# wait for a background server, but never forever
finish() { for i in $(seq 1 60); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.5; done; kill "$1" 2>/dev/null || true; }
run() { local opts=(); while [[ "$1" == -D* ]]; do opts+=("$1"); shift; done; $JDK/java "${opts[@]}" -cp $O/classes StreamTest "$@"; }

# 1. RTMP, as YouTube
$FF -listen 1 -timeout 20 -i rtmp://127.0.0.1:19350/live2/abcd-efgh -c copy -y $O/rtmp.flv & L=$!
sleep 1
run rtmp://127.0.0.1:19350/live2 abcd-efgh $O/test.h264 $O/test.aac 8 > $O/rtmp.log 2>&1 || true
finish $L
cat $O/rtmp.log | tail -3
INFO=$($FP -show_entries stream=codec_name,width,height,sample_rate,channels -show_entries format=duration -of compact $O/rtmp.flv 2>&1)
echo "$INFO"
echo "$INFO" | grep -q "codec_name=h264|width=1280|height=720" && ok "RTMP: H.264 1280x720 received" 1 || ok "RTMP: H.264 1280x720 received" 0
echo "$INFO" | grep -q "codec_name=aac|sample_rate=44100|channels=2" && ok "RTMP: AAC stereo received" 1 || ok "RTMP: AAC stereo received" 0
DUR=$(echo "$INFO" | grep -o 'duration=[0-9.]*' | cut -d= -f2)
python3 -c "import sys; sys.exit(0 if 7.0 <= float('${DUR:-0}') <= 9.5 else 1)" && ok "RTMP: full length ($DUR s)" 1 || ok "RTMP: full length ($DUR s)" 0
$FF -i $O/rtmp.flv -vf "select=eq(n\,150)" -frames:v 1 -y $O/frame.png && [ -s $O/frame.png ] && ok "RTMP: frames decode" 1 || ok "RTMP: frames decode" 0
ERR=$($FF -v error -i $O/rtmp.flv -f null - 2>&1 | wc -l); [ "$ERR" -eq 0 ] && ok "RTMP: no decode errors" 1 || ok "RTMP: no decode errors" 0 "($ERR lines)"

# 2. RTMPS (TLS), as Facebook / Instagram
openssl req -x509 -newkey rsa:2048 -nodes -keyout $O/key.pem -out $O/cert.pem -days 1 -subj "/CN=localhost" 2>/dev/null
rm -f $O/trust.p12; $JDK/keytool -importcert -noprompt -alias test -file $O/cert.pem -keystore $O/trust.p12 -storetype PKCS12 -storepass testpass >/dev/null 2>&1
# ffmpeg cannot listen for RTMPS itself, so a small TLS front end (like a platform's) passes the stream to it
$FF -listen 1 -timeout 20 -i rtmp://127.0.0.1:19444/rtmp/FB-123-key -c copy -y $O/rtmps.flv & L=$!
sleep 1
python3 -I tests/stream/tls_front.py 19443 19444 $O/cert.pem $O/key.pem & T=$!
sleep 0.5
run -Djavax.net.ssl.trustStore=$O/trust.p12 -Djavax.net.ssl.trustStorePassword=testpass rtmps://localhost:19443/rtmp/ FB-123-key $O/test.h264 $O/test.aac 5 > $O/rtmps.log 2>&1 || true
finish $L; kill $T 2>/dev/null || true
tail -2 $O/rtmps.log
$FP -show_entries stream=codec_name -of csv=p=0 $O/rtmps.flv 2>/dev/null | tr '\n' ' ' | grep -q "h264 aac" && ok "RTMPS (encrypted) stream received" 1 || ok "RTMPS (encrypted) stream received" 0
# an RTMPS server whose certificate is not trusted must be refused, not streamed to
python3 -I tests/stream/tls_front.py 19445 19446 $O/cert.pem $O/key.pem & T=$!
sleep 0.5
timeout 12 $JDK/java -cp $O/classes StreamTest rtmps://localhost:19445/rtmp/ k $O/test.h264 $O/test.aac 2 > $O/untrusted.log 2>&1 || true
kill $T 2>/dev/null || true
grep -qiE "STATE retrying .*(certif|PKIX|trust)" $O/untrusted.log && ok "untrusted RTMPS certificate refused" 1 || ok "untrusted RTMPS certificate refused" 0 "$(head -2 $O/untrusted.log | tr '\n' ' ')"

# 3. the stream key in the address (Instagram/TikTok style), no separate key
$FF -listen 1 -timeout 20 -i rtmp://127.0.0.1:19351/app/KEYINURL -c copy -y $O/inurl.flv & L=$!
sleep 1
run rtmp://127.0.0.1:19351/app/KEYINURL "" $O/test.h264 $O/test.aac 3 > $O/inurl.log 2>&1 || true
finish $L
[ -s $O/inurl.flv ] && ok "key inside the server address" 1 || ok "key inside the server address" 0

# 4. the platform drops the connection, then comes back: the sender reconnects
( $FF -listen 1 -timeout 20 -i rtmp://127.0.0.1:19352/live/k -c copy -t 3 -y $O/part1.flv; sleep 1; $FF -listen 1 -timeout 30 -i rtmp://127.0.0.1:19352/live/k -c copy -y $O/part2.flv ) & L=$!
sleep 1
run rtmp://127.0.0.1:19352/live k $O/test.h264 $O/test.aac 14 > $O/reconnect.log 2>&1 || true
finish $L
grep -q "STATE retrying" $O/reconnect.log && ok "notices the dropped connection" 1 || ok "notices the dropped connection" 0
[ $(grep -c "STATE live" $O/reconnect.log) -ge 2 ] && ok "reconnects by itself" 1 || ok "reconnects by itself" 0
$FP -show_entries stream=codec_name -of csv=p=0 $O/part2.flv 2>/dev/null | tr '\n' ' ' | grep -q "h264 aac" && ok "stream continues after reconnecting" 1 || ok "stream continues after reconnecting" 0

# 5. nothing listening: a clear message, not a crash
timeout 12 $JDK/java -cp $O/classes StreamTest rtmp://127.0.0.1:19399/live k $O/test.h264 $O/test.aac 2 > $O/refused.log 2>&1 || true
grep -qE "STATE retrying .*(refused|Connection)" $O/refused.log && ok "server unreachable is reported" 1 || ok "server unreachable is reported" 0 "$(head -3 $O/refused.log | tr '\n' ' ')"
echo "$pass passed $fail failed"
[ $fail -eq 0 ]
