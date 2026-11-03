# Передача UfaGame другому исполнителю

Обновлено 2026-11-04. Репозиторий https://github.com/maillunex-lang/UfaGame.
Основная ветка — `main`; ветки `claude/ufagame-s10-s20-continue-nu48zr` и
`codex/s10-studio-android` держатся на том же commit. Владелец разрешил работать со всеми
ветками: пушить fast-forward в `main` (и синхронно в две другие). Актуальный commit — через git.

## Состояние этапов
- done (приняты владельцем на телефоне iQOO 15R / Android 16 или закрыты доказательствами):
  S01–S25, S27–S29 (см. таблицу и журнал roadmap.md, отчёты docs/reports/).
- in_progress — код и автопроверки готовы, ждут проверки владельцем:
  S26 (скорости/быстрый расчёт) и S30 (задания) — Game v15, отчёт docs/reports/S26-S30.md. Владелец сообщил, что VPS обновлён до 9b4d1f6; игра на телефоне ещё не подтверждена.
- S31 in_progress: подготовительный контракт/ADR 0024, в игру не подключён, см. docs/reports/S31.md.
- Приоритет владельца — компактный игровой срез 15–20 минут; чат, гильдии, арену, покупки,
  ИИ-жителей и большой редактор отложить. Продолжить S31 для удобных экранов игры;
  оставшиеся этапы сохраняются в roadmap и не считаются выполненными.

## Как работали (сохранить)
- Пакеты из 2–3 связанных этапов: один APK, одно обновление сервера, один чек-лист.
- Контракт сначала: packages/contracts/*.schema.json + index.mjs (правила), capabilities.json,
  ADR в docs/adr (последний 0023). Новая механика = новая capability → новая Game APK.
- Сервер подтверждает всё: награды/траты только через ledger (`applyDeltaTx`, ключ ≥16 символов),
  ожидаемое состояние (`from_level` и т.п.), `request_id` для повторов, блокировка игрока.
- Studio: без ручного ввода ID/JSON, выбор из списков, предлагаемые значения с флагом `proposed`.
- Стартовый мир для проверок: tools/content/starter-world.mjs → `npm run build:starter`
  (content/starter/ufagame-starter.zip, balance.json); при новой механике дополняй его.
- После каждого пакета: roadmap.md (журнал + таблица статусов), docs/reports/…, commit/push,
  CI зелёный, Game APK в Releases, команда обновления VPS владельцу, чек-лист «нажми → что увидишь».

## Окружение и проверки
- Node 24 (`/opt/node24/bin`), PostgreSQL 16 (`pg_ctlcluster 16 main start` — после
  перезапуска контейнера он остановлен), Godot 4.6.3, Chromium Playwright.
- `export PATH=/opt/node24/bin:$HOME/.local/bin:$PATH PGHOST=/var/run/postgresql PGUSER=root PGDATABASE=ufagame_it UFA_CHROMIUM_PATH=/opt/pw-browsers/chromium`
- Чистая БД перед интеграцией: `su - postgres -c "psql -q -c 'drop database if exists ufagame_it' -c 'create database ufagame_it owner root'"`,
  `npm run db:migrate`, `node tools/sync-contracts.mjs`,
  `node --test --test-concurrency=1 tests/integration/*.test.mjs` (сейчас 50 тестов).
- `npm run check` (lint, gitleaks, контракты, Studio, ядро, стартовый мир, typecheck, сборка);
  `npm run check:studio:browser`; `bash tools/s01/check.sh` (Godot).
- Тесты, запускающие живые бои, должны завершать их в `after()` — иначе мешают следующим файлам.
- Тест Godot = node-тест + driver .gd (tests/integration/godot-*.test.mjs).

## APK и подпись
- Ключи НЕ в git. Владелец передаёт `signing-backup.tar`; распаковать вне репозитория
  (раньше: /root/.ufagame-signing). Новые ключи не создавать.
- Сборка Game: `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=/opt/android-sdk UFAGAME_SIGNING_DIR=<папка ключей> UFAGAME_GAME_ONLY=1 bash tools/android/build.sh <versionCode>`
  → build/android/game-<код>/. Последняя: Game v15 (код 15). Сертификат Game e8959e0f…e575, Studio badb1f78…ccf7.
- Публикация: только после зелёного CI. Сироту-ветку `artifact-staging/apk-*` с APK,
  SHA256SUMS.txt, release-notes.md, release-manifest.json и `.github/workflows/publish.yml`
  (копия tools/android/release-staging.yml) пушить в репозиторий; workflow создаёт Release и
  удаляет ветку. Затем скачать APK из Release и сверить SHA-256. Пример — журнал roadmap.

## VPS (только владелец выполняет команды)
- 144.31.254.99, tts-ufa.ru; рядом чужой портал — не трогать. Тестовый стек `ufagame_s09_test`
  в /srv/ufagame-test (API 127.0.0.1:8055 → /game/server/, Studio → /game/studio/).
- Обновление одной командой (резервная копия, миграции при старте, проверки, автооткат):
  `cd /srv/ufagame-test/source && git fetch origin main && git show <sha>:infra/studio-test/update.sh > /tmp/ufagame-update.sh && bash /tmp/ufagame-update.sh <sha>`
  — в конце `== 6/6 Done: <sha>`. Развёрнут de5acc8 (до S26/S30).
