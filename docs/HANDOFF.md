# Передача UfaGame другому исполнителю

Обновлено 2026-11-03. Рабочий репозиторий:
https://github.com/maillunex-lang/UfaGame. Последняя работа — ветка
`claude/ufagame-s10-s20-continue-nu48zr` (содержит всю `codex/s10-studio-android`
плюс commit 4371e4a: боевые параметры героя и серверный preview боя, ADR 0012).
Прежняя ветка `codex/s10-studio-android` этим не изменялась.
Сначала fetch этой ветки, проверь `git status`, историю, `AGENTS.md`,
`PROJECT_SPEC.md`, `ARCHITECTURE.md`, `OPEN_DECISIONS.md`, `roadmap.md`,
`PROMPT_CONTINUE.md`, нужные отчеты `docs/reports/` и `prompts/stages/`.
Не начинай заново, не перезаписывай чужие изменения. В прежней рабочей среде был
чужой untracked `examples/hello_bashkortostan.zip`; не удаляй и не добавляй его
без необходимости. Актуальный commit выясняй через git, а не только по этому файлу.

## Что попросил владелец

Продолжать реализацию S10–S20, не задавать дополнительных вопросов и не требовать
от него ручной приемки в процессе; проверять автоматически и не помечать done то,
что фактически не выполнено/не проверено. По окончании он намерен проверять и
исправлять ошибки. Каждый APK для владельца публикуй в GitHub Releases
`maillunex-lang/UfaGame`, не заменяя существующие assets; передавай прямую ссылку.
Приватные signing keys, пароли, токены, session cookies и содержимое private.env
не выкладывать и не просить прислать. Владелец ранее попросил добровольное
сохранение пароля Studio; частичная Android-реализация есть в v9+.

## Состояние проекта

- S01–S09 done по roadmap. S09 владелец подтвердил на iQOO 15R / Android 16:
  Studio открывается, проверялись черновики, перезапуск и конфликт версий.
- S10 in_progress: Android Studio v12 подписана прежним ключом, есть WebView,
  Android Keystore для добровольного сохранения пароля, выбор PNG/ZIP и
  предварительная обработка загрузки ZIP. File export/import end-to-end и все
  device проверки не завершены. Последний опубликованный APK:
  https://github.com/maillunex-lang/UfaGame/releases/download/s11-studio-test-v12/Studio-v12.apk
  Его публикация/сборка не означает установку или device проверку v12.
- S11 in_progress: в Git подготовлены owner-only API PNG, миграции 007/008,
  аудит, ограничения, UI загрузки и preview, сетка/loop/anchor/scale с ревизией.
  Есть только ограниченный PNG; аудио, другие типы, промышленная изоляция,
  игровая привязка и полная приемка не готовы. Эти изменения не развернуты на VPS.
- S12–S14 blocked: предварительные схемы ug-content/1, ограниченный локальный
  ZIP inspector и JSON-only export/план create-only импорта существуют, но нет
  полного валидатора/карантина, транзакционного импорта, ресурсов и UI.
  Не выдавай локальный roundtrip за работающий импорт/экспорт редактора.
- S15–S16 не реализованы полностью. S17 in_progress: экспериментальный
  детерминированный battle-core 2+3, движение, энергия, базовые auto abilities;
  не подключен к API или игре. S18 blocked: есть только in-memory прототип команд,
  без WebSocket/persistence/auth. S19 не завершен. S20 blocked: начальные формы
  героев/фракций/способностей в Git, без полной модели способностей, публикации
  и боевого preview. См. таблицу и поздние записи roadmap, не ранний журнал.
- Последний кодовый commit на момент передачи: `9ed2a09` (кадры/preview PNG).
  Проверяй более новые commits и CI. На нем локально `npm run check` и мобильный
  Chromium с mock API прошли; GitHub Actions 41568725779 (isolated stack) и
  41568725839 (source, Godot, integration с реальной PostgreSQL) — success.
  Device приемка новых возможностей и развертывание на VPS не выполнялись.

## VPS и защита существующего портала

Владелец выполняет все команды на VPS самостоятельно. Не подключайся по SSH,
не проси доступ/секреты; выдавай ему команды в чат, когда это необходимо для
развертывания. IP `144.31.254.99`, домен `tts-ufa.ru`; на нем уже работает
портал. Не менять корневой сайт, чужие сервисы, Docker volumes, firewall, SSH,
не очищать Docker глобально, не занимать используемые порты.

Владелец ранее запустил отдельный тестовый Compose `ufagame_s09_test` из
`/srv/ufagame-test/source` на commit `71cef2f02c91cc60f8c3b3f125e7ab34fc50e21e`.
API слушает `127.0.0.1:8055`, PostgreSQL отдельная; Studio обслуживается через
`https://tts-ufa.ru/game/studio/`, API через `/game/server/`. Секрет БД находится
в защищенном `/srv/ufagame-test/private.env` — его содержимое не выводить.
Существующий nginx успешно проверен после изменения; копия прежнего конфига:
`/srv/ufagame-test/nginx-backup-NlQfm8/original.conf`.

На VPS по состоянию передачи нет миграций 007/008 и новых интерфейсов из Git.
Обновлять только через отдельный проверенный план, сохраняя БД и портал; учесть
около 1,9 ГиБ RAM на машине, существующие сервисы и общее origin с порталом.
Ранние 404 после nginx reload устранили ожиданием готовности конфигурации.
Проверка root-портала HTTP 200 и изоляция проектов обязательны при изменениях.
Тестовый S09-стек не означает завершения официального S52.

## APK и проверка

Android toolchain и приватные ключи в прошлой среде находились вне git; в другой
среде они могут отсутствовать. Не создавай новый signing key для обновления поверх
старого. Если прежняя приватная подпись недоступна, укажи ограничение; не проси
публиковать ключ. Проверки `npm run check`, `npm run check:studio:browser`,
`npm run test:integration` и Android build требуют соответствующих инструментов;
следуй отчетам и различай mock от реальной PostgreSQL/device проверки.
После каждого этапа отдельно обновляй roadmap и отчеты; незавершенное оставляй
in_progress/blocked. В конце сообщи ссылки GitHub и точные ограничения.

## Дополнение 2026-11-03: preview боя (S17/S20)

Commit 4371e4a: `hero.data.combat`, `ability.data.energy_cost`, capability
`battle.combat.v1`, компилятор черновика в бой v2, owner endpoint
`POST /admin/v1/drafts/:id/battle-preview`, панель «Проверка боя на сервере» в
Studio. Миграций нет; API Docker-образу нужен `packages/battle-core/` (Dockerfile
обновлен). На VPS не развернуто — команды выдаются владельцу в чат.

Воспроизведение проверок без Docker-демона: `pg_ctlcluster 16 main start`, роль и
БД для текущего пользователя, затем `PGHOST=/var/run/postgresql PGUSER=<роль>
PGDATABASE=<бд> npm run db:migrate`, `npm run build:studio-web`,
`node tools/sync-contracts.mjs`, `node --test --test-concurrency=1
tests/integration/*.test.mjs`; браузер — `UFA_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
Godot в такой среде отсутствует — его тест падает с ENOENT, проверяется в CI.
