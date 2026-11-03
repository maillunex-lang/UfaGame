#!/usr/bin/env bash
# Run by the VPS owner as root. Adds only `client_max_body_size 16m;` to the
# existing /game/server/ location of the reviewed config, with backup, diff,
# nginx -t, reload, smoke checks and automatic rollback on failure.
set -euo pipefail
cfg=/etc/nginx/sites-available/agroapp
root_dir=/srv/ufagame-test
renderer=${1:?Provide path to reviewed render-body-limit.py}
[[ $EUID == 0 && -f $cfg && ! -L $cfg && -f $renderer ]] || { echo 'Invalid prerequisites'; exit 1; }
for tool in nginx python3 curl systemctl; do command -v "$tool" >/dev/null; done
portal_check() { curl -fsSL --max-time 15 --max-redirs 5 -o /dev/null https://tts-ufa.ru/; }
api_check() { curl -fsS --max-time 15 https://tts-ufa.ru/game/server/health/ready | python3 -c 'import json,sys; assert json.load(sys.stdin)=={"status":"ok"}'; }
studio_check() { curl -fsS --max-time 15 https://tts-ufa.ru/game/studio/ | grep -q '<div id="root">'; }
portal_check; api_check; studio_check
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
echo 'Waiting for reloaded nginx to accept a 2 MB body on /game/server/ ...'
ready=false
for attempt in $(seq 1 15); do
  # An unknown POST route answers 404 from the API; nginx would answer 413 if the limit were still 1m.
  code=$(head -c 2000000 /dev/zero | curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary @- https://tts-ufa.ru/game/server/__body_probe || true)
  if [[ $code != 413 && $code != 000 ]]; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo "Body limit not active (last HTTP $code)" >&2; exit 1; }
echo "Large body passes nginx (HTTP $code from API)."
echo 'Checking portal, Studio and API after reload...'
portal_check; studio_check; api_check
changed=0
printf 'Portal, Studio and API passed. Backup: %s/original.conf\n' "$backup_dir"
