# ADR 0004: PostgreSQL, economy, jobs, auth

S05: migrations под advisory lock и checksum, одна транзакция на migration.
Integer balances int32 nonnegative, ledger append-only для application logic.
Trusted applyDelta сериализуется блокировкой player row; idempotency key scoped
per player, fingerprint currency/delta/reason/source. Replay возвращает прошлый
результат; другой payload с тем же key — CONFLICT. Ошибки откатываются целиком.
Публичного API выдачи/траты валюты до профильных gameplay endpoints нет.

Jobs живут в PostgreSQL; claim SKIP LOCKED, lease token (fencing), renew только
до истечения. Effect и ack одной SQL транзакцией, старый worker не меняет данные.
Обработчик ledger_delta использует idempotency job ID; неизвлекаемый сбой
не создает повторную выдачу. Лимит attempts5, pending retry с задержкой1с.

Auth S06/S07: opaque random256bit access/refresh, только SHA256 в БД,
access15min/refresh30days. Bootstrap повторяется по случайному installation
secret, initial pair выводится domain-separated SHA256 от него. В БД только
bootstrap hash + session hash, не исходный secret; retry возвращает ту же
сессию до rotation/revoke, затем401 (не создает новую). После bind bootstrap
отключен. Access берется из Authorization Bearer, player ID не принимается.
Refresh lock order player→session, атомарная ротация; replay401. Revocation
проверяется на каждом запросе БД, не только в клиенте.

Пароль: Node crypto.scrypt N=131072,r=8,p=1,maxmem256MiB, случайная salt16B,
constant-time сравнение. Login ASCII3..32, casefold lower, уникален PostgreSQL.
Recovery random32B, SHA256, одноразовый; меняет password/code и отзывает все
сессии в одной транзакции под player lock. Старый код/сессии не работают.
Rate limits auth по IP, max10/min и глобальный120/min, single-process memory;
перед multi-instance deployment требуется общий store и trusted proxy policy.
Нет подробных auth ошибок/логов bodies/tokens/recovery/password.
Android credential store: AES-GCM ключ AndroidKeyStore, ciphertext в files,
allowBackupfalse, запись temp+rename; plaintext persistence запрещен.
Расширенные тесты Android требуют устройства, не подменяются JVM compile.
