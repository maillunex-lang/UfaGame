#!/usr/bin/env bash
# Run by the VPS owner as root on the test stack only:
#   cd /srv/ufagame-test/source && git fetch origin main \
#     && git show <commit>:infra/studio-test/update.sh > /tmp/ufagame-update.sh \
#     && bash /tmp/ufagame-update.sh <commit>
# Steps: checks before → DB backup (pg_dump) + old commit + old Studio files →
# checkout <commit> → rebuild only the `api` service of project ufagame_s09_test
# (migrations apply at API start) → build Studio in a throwaway node container →
# swap Studio files → checks after (portal, API ready, Studio, WebSocket route).
# Any failure after the switch restores the old commit, API and Studio.
# Touches nothing else: no other containers, no nginx, no firewall, no ports.
set -euo pipefail

main() {
  local commit=${1:?Usage: update.sh <commit-sha>}
  [[ $commit =~ ^[0-9a-f]{7,40}$ ]] || { echo 'Commit must be a hex SHA'; exit 1; }
  [[ $EUID == 0 ]] || { echo 'Run as root'; exit 1; }
  root=${UFA_UPDATE_ROOT:-/srv/ufagame-test} src=$root/source
  P=ufagame_s09_test F=infra/studio-test/compose.yml ENV=$root/private.env
  cd "$src"
  [[ -f $ENV ]] || { echo "Missing $ENV"; exit 1; }
  [[ -z $(git status --porcelain --untracked-files=no) ]] || { echo 'Source tree has local changes; stopping'; exit 1; }

  portal() { curl -fsSL --max-time 15 --max-redirs 5 -o /dev/null https://tts-ufa.ru/; }
  ready() { curl -fsS --max-time 10 http://127.0.0.1:8055/health/ready | grep -q '"ok"'; }
  public_ready() { curl -fsS --max-time 15 https://tts-ufa.ru/game/server/health/ready | grep -q '"ok"'; }
  studio() { curl -fsS --max-time 15 https://tts-ufa.ru/game/studio/ | grep -q '<div id="root">'; }
  wait_ready() { local i; for i in $(seq 1 45); do ready && return 0; sleep 2; done; return 1; }
  must() { local name=$1; shift; if "$@"; then echo "$name ok"; else echo "$name FAILED" >&2; return 1; fi; }

  echo '== 1/6 Checks before update'
  must portal portal
  must api public_ready
  must studio studio
  git cat-file -e "$commit^{commit}" 2>/dev/null || git fetch -q origin main
  git cat-file -e "$commit^{commit}" || { echo 'Commit not found after fetch'; exit 1; }

  echo '== 2/6 Backup'
  B=$root/backup-$(date +%Y%m%d-%H%M%S)-$$; mkdir -m 700 "$B"
  docker compose -p $P --env-file $ENV -f $F exec -T db pg_dump -U ufagame -d ufagame_test -Fc > "$B/db.dump"
  [[ -s $B/db.dump ]] || { echo 'Empty DB dump; stopping'; exit 1; }
  git rev-parse HEAD > "$B/old-commit"
  cp -a "$root/studio" "$B/studio-old"
  echo "backup: $B ($(du -h "$B/db.dump" | cut -f1) DB dump)"

  switched=0
  rollback() {
    local code=$?
    trap - EXIT
    if (( switched )); then
      echo "!! Failure: rolling back to $(cat "$B/old-commit")" >&2
      git checkout -q --detach "$(cat "$B/old-commit")"
      docker compose -p $P --env-file $ENV -f $F up -d --build api || true
      rm -rf "$root/studio" && cp -a "$B/studio-old" "$root/studio"
      if wait_ready; then echo 'Rollback: API ready' >&2; else echo 'Rollback: API NOT ready — send this output' >&2; fi
      echo "DB was not restored (migrations only add tables). Dump: $B/db.dump" >&2
    fi
    exit "$code"
  }
  trap rollback EXIT

  echo "== 3/6 API → $commit"
  switched=1
  git checkout -q --detach "$commit"
  docker compose -p $P --env-file $ENV -f $F up -d --build api
  must 'api ready (migrations applied):' wait_ready

  echo '== 4/6 Studio build'
  mkdir -p "$root/build-web" && rm -rf "${root:?}/build-web/"*
  docker run --rm --memory 900m -v "$src":/src:ro -v "$root/build-web":/out node:24.19.0-bookworm-slim \
    sh -c 'cp -a /src /tmp/w && cd /tmp/w && rm -rf node_modules && npm ci --ignore-scripts --no-audit --no-fund && npm run build:studio-web && cp -a apps/studio-web/dist/. /out/'
  ls "$root/build-web/assets" >/dev/null
  rm -rf "$root/studio" && cp -a "$root/build-web" "$root/studio" && chmod -R a+rX "$root/studio"

  echo '== 5/6 Checks after update'
  sleep 2
  must portal portal
  must api public_ready
  must studio studio
  local ws; ws=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(head -c 16 /dev/urandom | base64)" https://tts-ufa.ru/game/server/v1/live-battles/00000000-0000-4000-8000-000000000000/stream?after=0 || true)
  echo "websocket route answers: $ws (401 = reaches API, fine)"

  switched=0
  trap - EXIT
  echo "== 6/6 Done: $(git rev-parse --short HEAD). Backup kept in $B"
}

main "$@"
