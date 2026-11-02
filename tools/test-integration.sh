#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
s05_docker=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
s05_root=$(mktemp -d /tmp/ufagame-integration-XXXXXX)
mkdir "$s05_root/socket"
chmod 777 "$s05_root/socket"
s05_image='postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382'
s05_container=$("${s05_docker[@]}" run -d --network none --tmpfs /var/lib/postgresql --mount "type=bind,src=$s05_root/socket,dst=/var/run/postgresql" -e POSTGRES_HOST_AUTH_METHOD=trust "$s05_image" postgres -c listen_addresses='')
s05_cleanup() {
 "${s05_docker[@]}" exec --user 0 "$s05_container" chmod 0777 /var/run/postgresql >/dev/null 2>&1 || true
 "${s05_docker[@]}" stop --time 5 "$s05_container" >/dev/null 2>&1 || true
 "${s05_docker[@]}" rm -f "$s05_container" >/dev/null 2>&1 || true
 rm -rf -- "$s05_root"
}
trap s05_cleanup EXIT
s05_ready=false
for ((i=0;i<30;i++));do
 if "${s05_docker[@]}" exec "$s05_container" pg_isready -U postgres >/dev/null 2>&1; then s05_ready=true;break;fi
 sleep 1
done
[[ "$s05_ready" == true ]] || { "${s05_docker[@]}" logs "$s05_container"; exit 1; }
export PGHOST="$s05_root/socket" PGUSER=postgres PGDATABASE=postgres
unset DATABASE_URL
npm run db:migrate
npm run db:migrate
node tools/sync-contracts.mjs
node --test --test-concurrency=1 tests/integration/*.test.mjs
