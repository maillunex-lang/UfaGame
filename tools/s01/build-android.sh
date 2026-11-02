#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ "$(godot --version)" == '4.6.3.stable.official.7d41c59c4' ]] || { echo 'Use pinned Godot 4.6.3 official'; exit 1; }
command -v javac >/dev/null || { echo 'Install full JDK (recommended 17), not JRE only'; exit 1; }
bash tools/s01/check.sh
mkdir -p build/s01
# No removal of user data: verify clean export in a temporary project copy.
s01_tmp=$(mktemp -d)
trap 'rm -rf -- "$s01_tmp"' EXIT
cp -R apps/game "$s01_tmp/game"
rm -rf -- "$s01_tmp/game/.godot"
godot --headless --path "$s01_tmp/game" --editor --import --quit
godot --headless --path "$s01_tmp/game" --export-debug 'Android S01' "$PWD/build/s01/Game-S01-arm64-debug.apk"
python3 - <<'PY'
from pathlib import Path
import hashlib, json
p=Path('build/s01/Game-S01-arm64-debug.apk')
size=p.stat().st_size
report={'artifact':str(p),'bytes':size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'budget_bytes':95000000,'within_budget':size<=95000000,'device_tested':False}
Path('build/s01/apk-size.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
if not report['within_budget']: raise SystemExit('APK exceeds budget')
PY
