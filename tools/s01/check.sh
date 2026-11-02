#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/sync-contracts.mjs
node services/prototype/emit-events.mjs
python3 tools/validate_planning.py
godot --headless --path apps/game --editor --import --quit
godot --headless --path apps/game --script res://test_s01.gd
godot --headless --path apps/game --script res://test_s01.gd
godot --headless --path apps/game --quit-after 300
