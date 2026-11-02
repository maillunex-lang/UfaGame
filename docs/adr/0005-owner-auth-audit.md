# ADR 0005: один владелец, отдельные sessions, CSRF и audit

S08 зависит от принятого S07. Его backend и реальный Godot HTTPS/controller smoke
проверены с PostgreSQL, Android Keystore/update принят владельцем отдельно.
Production Android→VPS smoke остается S52; это не требование доступа к VPS в S08.
Внешняя private backup signing keys по-прежнему blocker только S04.

Owner хранится отдельно от players, singleton id=1 CHECK. Только локальная CLI
provisioning команда с login и private password file0600, без default credentials
и публичного signup/admin escalation. Scrypt как S07. Создание и все изменения
owner/session/profile/пароля аудируются в одной транзакции с effect.

Admin URLs /admin/v1, независимо от /v1/players. Opaque cookie256bit, только
hash в owner_sessions, TTL30min. Cookie __Secure-ufagame-owner: Secure, HttpOnly,
SameSite=Strict, host-only. Public cookie Path по умолчанию /game/server/admin/v1;
соответствует будущему path prefix proxy, не корню рабочего портала.
ADMIN_ORIGIN обязателен для включения admin API, только HTTPS origin без path,
например https://tts-ufa.ru. Без него admin fail-closed503. Все mutating admin
requests требуют exact Origin и X-Ufa-CSRF; GET допускает отсутствие Origin,
но отвергает явно чужой Origin. Нет CORS allow и state-changing GET.
CSRF token = domain-separated SHA256 от secret cookie, возвращается JSON login/
GET session, в browser только memory (не localStorage). Сравнение constant-time.
Это позволяет безопасный reload без хранения raw CSRF в БД. Duplicate cookie
names отклоняются. Player bearer никогда не считается owner credentials.

Публичный path /game/server/admin/v1 должен быть stripped proxy перед upstream.
Cookie path использует внешний URL, не stripped route. ADMIN_COOKIE_PATH задается
оператором и должен оканчиваться /admin/v1. S08 не меняет proxy/VPS.
Same-origin portal и Studio разделяют web origin; cookie Path — не security
boundary против XSS в другом приложении этого же origin. Перед production S52
проверить portal/CSP; отдельный origin нужен, если требуется строгая изоляция.
Это не меняет выбранный владельцем path без отдельного решения.

Audit: owner_id/action/resource/reason/request_id/before/after/sequence/time.
Secret keys/tokens/password/hash/cookie/CSRF не допускаются в snapshots.
UPDATE/DELETE/TRUNCATE audit запрещены triggers; суперпользователь БД может
обойти triggers, криптографической неизменяемости не обещаем. Production DB role
least privilege и резервирование — S50/S52. Audit SQL не публикуется с реальными
данными. No request-body logs.

Реальная минимальная mutation: owner display_name/revision (не игровой прогресс).
Profile write требует expected_revision и request_id; optimistic race409,
повтор того же payload возвращает исходный after без нового audit. Reuse ID
с другим payload409. Credentials rotate требует текущий пароль, отзывает все
owner sessions и пишет только credential_version в audit. Logout/revoke-all
также audited. Browser UI для этих endpoints относится к S09, не заглушка S08.
