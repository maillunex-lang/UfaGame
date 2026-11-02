#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)-$(uname -m)" == 'Linux-x86_64' ]] || { echo 'This installer supports Linux x86_64 only'; exit 1; }
s02_version=$(cat .gitleaks-version)
s02_destination=${1:?Usage: bash tools/install-gitleaks.sh /path/to/local/bin}
s02_destination=$(realpath -m "$s02_destination")
mkdir -p "$s02_destination"
s02_tmp=$(mktemp -d)
trap 'rm -rf -- "$s02_tmp"' EXIT
s02_archive="gitleaks_${s02_version}_linux_x64.tar.gz"
s02_base="https://github.com/gitleaks/gitleaks/releases/download/v${s02_version}"
curl -fL --retry 3 -o "$s02_tmp/$s02_archive" "$s02_base/$s02_archive"
curl -fL --retry 3 -o "$s02_tmp/checksums.txt" "$s02_base/gitleaks_${s02_version}_checksums.txt"
python3 - "$s02_tmp" "$s02_archive" <<'PY'
from pathlib import Path
import hashlib, sys
root, name = Path(sys.argv[1]), sys.argv[2]
lines = (root / 'checksums.txt').read_text().splitlines()
expected = next(line.split()[0] for line in lines if line.split()[-1] == name)
assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, 'checksum mismatch'
PY
tar -xzf "$s02_tmp/$s02_archive" -C "$s02_destination" gitleaks
"$s02_destination/gitleaks" version
