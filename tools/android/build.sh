#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${JAVA_HOME:?Set full JDK17 JAVA_HOME}"
: "${ANDROID_HOME:?Set Android SDK path}"
: "${UFAGAME_SIGNING_DIR:?Set PRIVATE signing directory}"
s04_code=${1:?Usage: bash tools/android/build.sh versionCode}
[[ "$s04_code" =~ ^[1-9][0-9]{0,7}$ ]] || exit 1
export PATH="$JAVA_HOME/bin:$PATH"
s04_tools="$ANDROID_HOME/build-tools/36.0.0"
s04_android="$ANDROID_HOME/platforms/android-36/android.jar"
s04_output="$PWD/build/android/$s04_code"
mkdir -p "$s04_output"
s04_tmp=$(mktemp -d)
trap 'rm -rf -- "$s04_tmp"' EXIT
node tools/sync-contracts.mjs
cp -R apps/game "$s04_tmp/game"
rm -rf "$s04_tmp/game/.godot"
python3 - "$s04_tmp/game/export_presets.cfg" "$s04_code" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text().replace('Android S01','Android Release').replace('org.ufagame.game.s01','org.ufagame.game').replace('version/code=1',f'version/code={sys.argv[2]}').replace('version/name="0.0.1-s01"',f'version/name="0.0.{sys.argv[2]}"').replace('package/name="UfaGame S01"','package/name="Game"')
p.write_text(s)
PY
export GODOT_ANDROID_KEYSTORE_RELEASE_PATH="$UFAGAME_SIGNING_DIR/game.keystore"
export GODOT_ANDROID_KEYSTORE_RELEASE_USER=game
GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=$(cat "$UFAGAME_SIGNING_DIR/password.txt")
export GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD
godot --headless --path "$s04_tmp/game" --editor --import --quit
godot --headless --path "$s04_tmp/game" --export-release 'Android Release' "$s04_output/Game-arm64.apk"
unset GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD
mkdir -p "$s04_tmp/studio/gen" "$s04_tmp/studio/classes" "$s04_tmp/studio/dex"
python3 - "$s04_tmp/studio/AndroidManifest.xml" "$s04_code" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_text(Path('apps/studio-android/AndroidManifest.xml').read_text().replace('@CODE@',sys.argv[2]))
PY
"$s04_tools/aapt" package -f -M "$s04_tmp/studio/AndroidManifest.xml" -I "$s04_android" -A apps/studio-android/assets -J "$s04_tmp/studio/gen" -F "$s04_tmp/studio/unsigned.apk"
find apps/studio-android/src -name '*.java' -print > "$s04_tmp/studio/sources.txt"
javac -encoding UTF-8 --release 8 -classpath "$s04_android" -d "$s04_tmp/studio/classes" @"$s04_tmp/studio/sources.txt"
jar cf "$s04_tmp/studio/classes.jar" -C "$s04_tmp/studio/classes" .
"$s04_tools/d8" --lib "$s04_android" --min-api 24 --output "$s04_tmp/studio/dex" "$s04_tmp/studio/classes.jar"
python3 - "$s04_tmp/studio" <<'PY'
import sys,zipfile
from pathlib import Path
p=Path(sys.argv[1])
with zipfile.ZipFile(p/'unsigned.apk','a') as z:z.write(p/'dex/classes.dex','classes.dex')
PY
"$s04_tools/zipalign" -f 4 "$s04_tmp/studio/unsigned.apk" "$s04_output/Studio.apk"
"$s04_tools/apksigner" sign --ks "$UFAGAME_SIGNING_DIR/studio.keystore" --ks-key-alias studio --ks-pass "file:$UFAGAME_SIGNING_DIR/password.txt" "$s04_output/Studio.apk"
for s04_app in Game-arm64 Studio; do
 "$s04_tools/apksigner" verify --verbose --print-certs "$s04_output/$s04_app.apk" > "$s04_output/$s04_app.signature.txt"
 "$s04_tools/aapt" dump badging "$s04_output/$s04_app.apk" > "$s04_output/$s04_app.badging.txt"
done
python3 - "$s04_output" <<'PY'
import json,hashlib,sys
from pathlib import Path
p=Path(sys.argv[1]);report=[]
for name in ['Game-arm64','Studio']:
 b=(p/f'{name}.apk').read_bytes();report.append({'name':name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'device_update_tested':False})
assert report[0]['bytes']<=95000000
(p/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
PY
