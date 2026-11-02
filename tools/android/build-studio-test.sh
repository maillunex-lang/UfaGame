#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${JAVA_HOME:?Set full JDK17 JAVA_HOME}" "${ANDROID_HOME:?Set Android SDK path}" "${UFAGAME_SIGNING_DIR:?Set private signing directory}"
code=${1:?Usage: build-studio-test.sh versionCode}
[[ "$code" =~ ^[1-9][0-9]{0,7}$ ]] || exit 1
export PATH="$JAVA_HOME/bin:$PATH"
tools="$ANDROID_HOME/build-tools/36.0.0"
android="$ANDROID_HOME/platforms/android-36/android.jar"
out="$PWD/build/android/$code"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$out" "$tmp/gen" "$tmp/classes" "$tmp/dex"
python3 - "$tmp/AndroidManifest.xml" "$code" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_text(Path('apps/studio-android/AndroidManifest.xml').read_text().replace('@CODE@',sys.argv[2]))
PY
"$tools/aapt" package -f -M "$tmp/AndroidManifest.xml" -I "$android" -A apps/studio-android/assets -J "$tmp/gen" -F "$tmp/unsigned.apk"
find apps/studio-android/src -name '*.java' -print > "$tmp/sources.txt"
javac -encoding UTF-8 --release 8 -classpath "$android" -d "$tmp/classes" @"$tmp/sources.txt"
jar cf "$tmp/classes.jar" -C "$tmp/classes" .
"$tools/d8" --lib "$android" --min-api 24 --output "$tmp/dex" "$tmp/classes.jar"
python3 - "$tmp" <<'PY'
import sys,zipfile
from pathlib import Path
p=Path(sys.argv[1])
with zipfile.ZipFile(p/'unsigned.apk','a') as z:z.write(p/'dex/classes.dex','classes.dex')
PY
"$tools/zipalign" -f 4 "$tmp/unsigned.apk" "$out/Studio.apk"
"$tools/apksigner" sign --ks "$UFAGAME_SIGNING_DIR/studio.keystore" --ks-key-alias studio --ks-pass "file:$UFAGAME_SIGNING_DIR/password.txt" "$out/Studio.apk"
"$tools/apksigner" verify --verbose --print-certs "$out/Studio.apk" > "$out/Studio.signature.txt"
"$tools/aapt" dump badging "$out/Studio.apk" > "$out/Studio.badging.txt"
sha256sum "$out/Studio.apk"
