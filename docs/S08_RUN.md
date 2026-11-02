# S08 — владелец и аудит

Это server API этап. Web-интерфейс Studio появляется в S09. Production owner
не создавался: нет default password и публичной регистрации владельца.
Эти команды предназначены для отдельной dev среды с собственной БД;
на рабочем VPS144.31.254.99 до обследования S51 их не выполнять.

## Инициализировать одного владельца

Сначала `npm ci --ignore-scripts --no-audit --no-fund`, private PG окружение и
`npm run db:migrate`. .env автоматически не читается. Затем в своём терминале:

```bash
umask 077
mkdir -p private
read -r -p 'Логин владельца (латиница/цифры/_): ' UFAGAME_OWNER_LOGIN
read -r -s -p 'Пароль владельца (12–128 символов): ' ufa_owner_password
printf '%s' "$ufa_owner_password" > private/owner-password.txt
unset ufa_owner_password
export UFAGAME_OWNER_LOGIN
export UFAGAME_OWNER_PASSWORD_FILE="$PWD/private/owner-password.txt"
npm run owner:create
```

Команда проверяет regular file0600, не следует symlinks, не печатает пароль.
После provisioning сохрани пароль в своём защищённом хранилище и удали только
этот одноразовый файл. Каталог private игнорируется Git. Повторная provisioning
команда откажет с CONFLICT и не перезапишет существующего владельца.
В БД singleton id1, login lower, scrypt hash; никаких секретов по умолчанию.
Это не аккаунт игрока и не превращение зарегистрированного игрока в владельца.

## Конфигурация API

Для будущего выбранного пути:

```bash
export ADMIN_ORIGIN=https://tts-ufa.ru
export ADMIN_COOKIE_PATH=/game/server/admin/v1
npm run dev:api
```

API по умолчанию слушает127.0.0.1/свободный port0. Эти команды не добавляют
reverse proxy, TLS или DNS и не включают API на рабочем портале. Порт8055 еще
не проверен. Перед внешним доступом нужны S51/S52 и точечный diff/rollback proxy.
Public `/game/server/admin/v1/...` должен превратиться в upstream `/admin/v1/...`.
Origin — только scheme+host+port, без path. Cookie Path — внешний path, не stripped.
Без ADMIN_ORIGIN все admin routes отвечают503 (fail closed).

## Контракт

- POST /admin/v1/sessions: owner_login_request; exact Origin обязателен;
  ответ owner_session, плюс Secure/HttpOnly/SameSiteStrict cookie.
- GET /admin/v1/session: cookie; восстановить profile и CSRF token в память UI.
- GET /admin/v1/owner: публичные поля профиля владельца, без password hash.
- PATCH /admin/v1/owner/profile: owner_profile_request, optimistic revision,
  reason/request_id, Origin + X-Ufa-CSRF. Replay того же UUID/payload не пишет
  второй audit; другой payload с прежним UUID или устаревшая revision →409.
- POST /admin/v1/sessions/logout и /revoke-all: owner_logout_request,
  Origin + X-Ufa-CSRF; соответствующие sessions отзываются, cookie очищается.
- POST /admin/v1/owner/password: owner_password_request; текущий пароль,
  новый пароль, reason/request_id. Отзыв всех owner sessions, требуется новый login.
- GET /admin/v1/audit?after=0&limit=50: cursor string, максимум100 событий,
  before/after/actor/reason/request_id. Только owner cookie.

Cookie живет30мин, hash в БД; bearer игрока не принимается ни на одном admin
endpoint. CSRF берется из JSON login/session, в будущем browser UI хранить только
в памяти, не localStorage. Нет state-changing GET/CORS allow. При смене пароля
и revoke-all старые cookies не действуют. Request body logs выключены.

Audit insert и mutation одной транзакцией: при недоступном audit изменение
откатывается. Triggers запрещают UPDATE/DELETE/TRUNCATE audit, но root DB может
обойти triggers; это не криптографически защищенный журнал. Production DB role,
backup/restore — отдельные S50/S52. Не удалять audit для отката кода.

## Проверки

```bash
npm run check
npm run test:integration
```

Integration использует временную PostgreSQL без сети/host ports. Проверяются
singleton race, CLI file permissions, player denial, cookie/expiry/CSRF/Origin,
optimistic race/idempotency, immutable audit и rollback при сбое audit insert,
logout/revoke-all/password rotation и redacted errors. Дополнительно настоящий
Godot client работает через trusted TLS/path prefix для регрессии S06/S07.
Нужны Godot4.6.3 и openssl; CI устанавливает Godot composite action.
