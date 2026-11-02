#!/usr/bin/env bash
# Run by the VPS owner. Changes only the reviewed agroapp config, with backup.
set -euo pipefail
cfg=/etc/nginx/sites-available/agroapp
root_dir=/srv/ufagame-test
renderer=${1:?Provide path to reviewed render-nginx.py}
[[ $EUID == 0 && -f $cfg && ! -L $cfg && -f $renderer ]] || { echo 'Invalid prerequisites'; exit 1; }
command -v nginx >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null
command -v systemctl >/dev/null
[[ -r $root_dir/studio/index.html ]] || { echo 'Studio files missing'; exit 1; }
runuser -u www-data -- test -r "$root_dir/studio/index.html"
curl -fsS --max-time 5 http://127.0.0.1:8055/health/ready | python3 -c 'import json,sys; assert json.load(sys.stdin)=={"status":"ok"}'
curl -fsSL --max-time 15 --max-redirs 5 -o /dev/null https://tts-ufa.ru/
nginx -t
backup_dir=$(mktemp -d "$root_dir/nginx-backup-XXXXXX")
chmod 700 "$backup_dir"
cp -p -- "$cfg" "$backup_dir/original.conf"
candidate=$(mktemp /etc/nginx/sites-available/.ufagame-agroapp-XXXXXX)
cleanup_candidate() { if [[ -n $candidate && -e $candidate ]]; then rm -- "$candidate"; fi; }
trap cleanup_candidate EXIT
python3 "$renderer" "$backup_dir/original.conf" "$candidate"
chmod --reference="$cfg" "$candidate"
chown --reference="$cfg" "$candidate"
cp -p -- "$candidate" "$backup_dir/applied.conf"
diff -U0 "$backup_dir/original.conf" "$candidate" || [[ $? -eq 1 ]]
if ! cmp -s -- "$cfg" "$backup_dir/original.conf"; then echo 'Config changed; not applying'; exit 1; fi
printf 'Backup: %s/original.conf\n' "$backup_dir"
changed=0
rollback() {
  local result=$?
  trap - EXIT
  if (( changed )); then
    if cmp -s -- "$cfg" "$backup_dir/applied.conf"; then
      echo 'Failure: restoring original nginx configuration.' >&2
      local restore
      restore=$(mktemp /etc/nginx/sites-available/.ufagame-restore-XXXXXX)
      cp -p -- "$backup_dir/original.conf" "$restore"
      mv -f -- "$restore" "$cfg"
      if nginx -t; then systemctl reload nginx || echo 'Reload failed; check nginx manually' >&2; else echo 'Restored config failed nginx -t; check nginx manually' >&2; fi
    else
      echo 'Config changed after apply; automatic rollback refused. Inspect backup.' >&2
    fi
  fi
  cleanup_candidate
  exit "$result"
}
trap rollback EXIT
mv -f -- "$candidate" "$cfg"
candidate=''
changed=1
nginx -t
systemctl reload nginx
curl -fsSL --max-time 15 --max-redirs 5 -o /dev/null https://tts-ufa.ru/
curl -fsS --max-time 15 https://tts-ufa.ru/game/studio/ | sha256sum | grep -q '^976ed7b422c88eeacc800eb5483e500400b7f7fa68cbf1b8c619b241a5b55a3e '
curl -fsS --max-time 15 https://tts-ufa.ru/game/studio/assets/index-BnhVGTRP.js | sha256sum | grep -q '^156667ec4d5fe839e795a76b026a68f0f4071ae03ca986ea8d4cf82cc76b7849 '
curl -fsS --max-time 15 https://tts-ufa.ru/game/server/health/ready | python3 -c 'import json,sys; assert json.load(sys.stdin)=={"status":"ok"}'
changed=0
printf 'Portal, Studio HTML/JS, and API health passed. Backup: %s/original.conf\n' "$backup_dir"
