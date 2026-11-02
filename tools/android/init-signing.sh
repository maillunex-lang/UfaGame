#!/usr/bin/env bash
set -euo pipefail
s04_private=${1:?Usage: bash tools/android/init-signing.sh /private/path}
umask 077
mkdir -p "$s04_private"
[[ ! -e "$s04_private/password.txt" ]] || { echo 'Signing directory already initialized; refusing to replace keys'; exit 1; }
python3 - "$s04_private/password.txt" <<'PY'
import secrets,sys
from pathlib import Path
Path(sys.argv[1]).write_text(secrets.token_urlsafe(48))
PY
for s04_app in game studio; do
 keytool -genkeypair -keystore "$s04_private/$s04_app.keystore" -storetype PKCS12 -alias "$s04_app" -storepass:file "$s04_private/password.txt" -keypass:file "$s04_private/password.txt" -dname "CN=UfaGame $s04_app" -keyalg RSA -keysize 3072 -validity 10000
done
# Archive is PRIVATE and contains password+keys. Never upload it to GitHub.
tar -cf "$s04_private/signing-backup.tar" -C "$s04_private" game.keystore studio.keystore password.txt
s04_restore=$(mktemp -d)
trap 'rm -rf -- "$s04_restore"' EXIT
tar -xf "$s04_private/signing-backup.tar" -C "$s04_restore"
for s04_app in game studio; do
 keytool -exportcert -keystore "$s04_private/$s04_app.keystore" -alias "$s04_app" -storepass:file "$s04_private/password.txt" -file "$s04_restore/$s04_app.original.der" >/dev/null
 keytool -exportcert -keystore "$s04_restore/$s04_app.keystore" -alias "$s04_app" -storepass:file "$s04_restore/password.txt" -file "$s04_restore/$s04_app.restored.der" >/dev/null
 cmp "$s04_restore/$s04_app.original.der" "$s04_restore/$s04_app.restored.der"
done
echo 'Private signing initialized; local backup restoration certificates match.'
