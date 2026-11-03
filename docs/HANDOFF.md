# Передача UfaGame другому исполнителю

Обновлено 2026-11-03. Репозиторий https://github.com/maillunex-lang/UfaGame.
Основная ветка — `main` (ветки `codex/s10-studio-android` и
`claude/ufagame-s10-s20-continue-nu48zr` указывают на тот же commit). Владелец
разрешил работать со всеми ветками; новые изменения пушить в `main` (fast-forward),
при необходимости синхронно в две другие. Актуальный commit выясняй через git.

## Состояние
- done: S01–S18 (доказательства — roadmap.md и docs/reports/Sxx.md).
  S10 и S16 приняты владельцем на iQOO 15R / Android 16.
- in_progress: S19 (обработка кадров в Game, см. docs/reports/S19.md), S51 (обследование VPS). blocked: S20 (по S19), S52 (по поздним этапам).
- Продолжить S19: поток, экран боя и его обязательные проверки, затем S20 и далее по зависимостям roadmap.
- S18: packages/battle-core/live.mjs, services/api/src/live-battles.ts и live-routes.ts,
  миграция 011, ADR 0017. Поток и команды проверены локально с PostgreSQL и WebSocket.
  На VPS S18 не развернут, существующий nginx не настроен для WebSocket upgrade;
  Android и внешний WSS не проверены. Не заявляй S19 готовым без его проверок.

## Что работает у владельца
- VPS 144.31.254.99, домен tts-ufa.ru, рядом работает чужой портал (корень `/`
  перенаправляет на /admin/login — это норма). Тестовый стек `ufagame_s09_test` в
  /srv/ufagame-test/source: API на 127.0.0.1:8055 (`/game/server/`), статика Studio
  /srv/ufagame-test/studio (`/game/studio/`), секрет БД в /srv/ufagame-test/private.env
  (не выводить). Развернут commit 11e466b (миграции до 010). nginx: в `/game/server/`
  `client_max_body_size 16m` (backup /srv/ufagame-test/nginx-backup-9bTW35/original.conf).
- Обновление (владелец выполняет сам, команды присылать в чат): backup БД `pg_dump`
  → `git fetch origin main && git checkout --detach <sha>` → `docker compose -p
  ufagame_s09_test --env-file /srv/ufagame-test/private.env -f infra/studio-test/compose.yml
  up -d --build api` → health/ready → сборка статики в контейнере node:24.19.0 и копия в
  /srv/ufagame-test/studio. Полный образец — последние записи roadmap (S17 deployment).
- APK: Studio v14 и Game v9 — последние (ссылки в roadmap). Game v9 не знает capability
  `battle.abilities.v2`: версия мира с новыми эффектами будет для нее несовместима до
  Game v10.

## Сборка и проверки в новой среде
- Node 24 (`/opt/node24/bin` или nvm), `npm ci`, gitleaks по `tools/install-gitleaks.sh`.
- PostgreSQL 16 локально: `pg_ctlcluster 16 main start`, роль/БД для текущего
  пользователя, `PGHOST=/var/run/postgresql PGUSER=<роль> PGDATABASE=<бд> npm run db:migrate`,
  `node tools/sync-contracts.mjs`, `node --test --test-concurrency=1 tests/integration/*.test.mjs`
  (29 тестов). Контейнер может перезапускаться — PostgreSQL тогда надо запустить снова.
- Браузер: `UFA_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run check:studio:browser`.
- Godot 4.6.3 (+ export templates 4.6.3) с GitHub releases godotengine; Android SDK
  cmdline-tools → `sdkmanager "build-tools;36.0.0" "platforms;android-36" "platform-tools"`,
  путь SDK в editor_settings Godot; JDK 21 подходит.
- Подпись APK: ключи НЕ в репозитории. Владелец дает архив `signing-backup.tar`
  (game.keystore, studio.keystore, password.txt) прямо в сессию; распаковать вне
  репозитория в каталог 700 и указать `UFAGAME_SIGNING_DIR`. Сверять сертификаты:
  Studio badb1f78…ccf7, Game e8959e0f…e575. Новые ключи не создавать.
- Сборка: `UFAGAME_GAME_ONLY=1 bash tools/android/build.sh <code>` (Game),
  `bash tools/android/build-studio-test.sh <code>` (Studio). Публикация в Releases:
  временная orphan-ветка `artifact-staging/apk-*` с файлами и release-manifest.json и
  workflow tools/android/release-staging.yml (создает Release и удаляет ветку).
  Пушить ее только после зеленого CI исходного commit и без `*.signature.txt`
  (gitleaks ложно срабатывает на digest публичного ключа). После публикации скачать и
  сверить SHA-256. Не заменять опубликованные файлы.

## Как общаться с владельцем
По-русски, на «ты», коротко и без жаргона. Владелец работает с Android-телефона,
команды VPS выполняет сам — присылать готовые блоки команд и что прислать в ответ.
Для проверок давать короткий чек-лист «нажми → что должно появиться». Интерфейс
Studio делать понятным без ID и JSON (владелец так попросил). Не отмечать done без
доказательств; ручной отчет владельца записывать как ручной.
