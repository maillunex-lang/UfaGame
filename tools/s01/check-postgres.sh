#!/usr/bin/env bash
set -euo pipefail
# Isolated S01 availability check. No host ports, no production schema or data.
s01_image='postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382'
s01_docker=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
s01_container=$("${s01_docker[@]}" run -d --network none --tmpfs /var/lib/postgresql -e POSTGRES_HOST_AUTH_METHOD=trust "$s01_image" postgres -c listen_addresses='')
trap '"${s01_docker[@]}" rm -f "$s01_container" >/dev/null' EXIT
s01_ready=false
for ((i=0; i<30; i++)); do
  if "${s01_docker[@]}" exec "$s01_container" pg_isready -h /var/run/postgresql -U postgres >/dev/null 2>&1; then s01_ready=true; break; fi
  sleep 1
done
[[ "$s01_ready" == true ]] || { echo 'PostgreSQL not ready'; "${s01_docker[@]}" logs "$s01_container"; exit 1; }
"${s01_docker[@]}" exec -i "$s01_container" psql -h /var/run/postgresql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT version();
CREATE TEMP TABLE s01_probe (id integer PRIMARY KEY);
INSERT INTO s01_probe VALUES (1);
DO $$ BEGIN
  BEGIN
    INSERT INTO s01_probe VALUES (1);
    RAISE EXCEPTION 'expected unique_violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
BEGIN;
INSERT INTO s01_probe VALUES (2);
ROLLBACK;
DO $$ BEGIN
  IF (SELECT count(*) FROM s01_probe) <> 1 THEN RAISE EXCEPTION 'rollback failed'; END IF;
END $$;
SELECT 'S01 PostgreSQL smoke ok' AS result;
SQL
