# Разработка UfaGame

S01 принят на iQOO15R / Android16: запуск, HP0 и reuse ресурса. S02 организует исходники и проверки. API/worker S05 и серверные auth S06/S07 реализованы; Studio — минимальная Android-оболочка. Игровые системы и редактор пока не реализованы. Статусы этапов — в [roadmap](../roadmap.md).

## Получить исходники

Текущая ветка разработки содержит завершенный S01 и работу S02; main может отставать. Не применяй reset/clean к существующей рабочей копии.

```bash
git clone --branch codex/s02-monorepo https://github.com/maillunex-lang/UfaGame.git
cd UfaGame
git status --short --branch
```

Нужны Git, Node24.19.0/npm11.9.0, Python3 и gitleaks8.30.1. Для Godot-проверок дополнительно нужен Godot4.6.3 official. Node закреплен в .node-version, JS зависимости — в корневом package-lock.json. Локальный installer gitleaks поддерживает Linux x86_64 и проверяет архив по checksums издателя, TLS verification включена.

```bash
npm ci --ignore-scripts --no-audit --no-fund
bash tools/install-gitleaks.sh /tmp/ufagame-tools/bin
export PATH="/tmp/ufagame-tools/bin:$PATH"
npm run check
npm run check:game
```

`check` также запускает контрактные тесты S03 и strict TypeScript API/worker; `npm run test:integration` отдельно проверяет PostgreSQL ledger/jobs/auth. `check` выполняет lint/syntax, форматирование файлов инфраструктуры S02, статическую проверку планирования, поиск секретов в исходниках/истории и compile/smoke проверку стека S01. Это не игровой сервер и не сквозная проверка игры. Lint намеренно не переписывает старые спецификации. `npm run format` форматирует только перечисленные инфраструктурные файлы.

`check:game` проверяет store/replay и headless запуск. `npm run dev:game` открывает технический прототип Godot; команда требует графическую среду. `npm run fixture:events` генерирует локальную запись вывода Node, не запускает API.

```bash
npm run dev:game
npm run fixture:events
npm run check:postgres
```

Последняя команда требует локальный Docker: образ PostgreSQL18.4 закреплен digest, временная БД без сети и портов хоста удаляется после smoke. Она не создает схему игры. Все эти команды предназначены для среды разработки, не для обследования или изменения VPS.

## Android

[APK прототипа](https://github.com/maillunex-lang/UfaGame/releases/tag/s01-prototype-v0.0.1) уже доступен с телефона. Компьютер владельцу не нужен для установки. Сборка выполняется в отдельной среде; [команды и версии](S01_RUN.md). `npm run build:android:s01` требует JDK/SDK/templates и локальных Editor Settings.

Workflow `S01 Android prototype` публикует одноразовый prerelease, не перезаписывает существующий APK и не заменяет постоянную подпись S04. Workflow `Repository checks` выполняет проверки исходников и Godot без публикации и с contents:read. Он не делает deployment и не требует доступа к VPS.

## Структура

| Каталог                       | Назначение / фактическая готовность                 |
| ----------------------------- | --------------------------------------------------- |
| apps/game                     | Рабочий технический прототип S01                    |
| apps/studio-web               | Зарезервирован для S09                              |
| apps/studio-android           | Минимальный native shell S04; полный UI S10         |
| services/prototype            | Генератор fixture S01                               |
| services/api, services/worker | API/worker S05 и auth S06/S07                       |
| packages/contracts            | Строгие схемы/registry/validator S03                |
| packages/battle-core          | Бой S17, пока README                                |
| packages/content-validator    | Валидатор S13, пока README                          |
| content, infra, tests         | Структура для следующих этапов, реализаций пока нет |
| tools/s01/stack-check         | Реальный npm workspace технических проверок         |
| schemas, examples, prompts    | Сохраненный комплект и изолированный контракт S01   |
| docs/adr, docs/reports        | Решения, доказательства и ограничения               |

Новые npm пакеты добавлять в workspaces только вместе с реализацией. Godot не является npm пакетом. Legacy lockfile tools/s01/stack-check/package-lock.json сохранен для самостоятельных команд S01; в monorepo/CI источником зависимостей служит корневой lockfile.

## Изменения и передача

Работай в отдельной ветке, сверяй git status/fetch перед изменениями и push. Не перезаписывай main и не force-push чужую работу. Перед push: `npm run check`, для изменений Godot — `npm run check:game`, для Android — измерение/подпись APK. Новый runtime контракт сначала описывать в схеме и ADR.

После каждого этапа отдельно обновлять roadmap: результат, файлы, точные проверки, ограничения, commit/URL и следующий доступный этап. Сборка, ручная приемка, публикация и deployment — разные доказательства. Старые записи журнала сохраняются как история; текущий статус находится в таблице.

Текущие Android/auth команды и честные ограничения: [S03–S07](S03_S07_RUN.md).

## Передача APK

По указанию владельца все установочные APK передаются прямыми ссылками GitHub
Releases, а не только локальными файлами. Подписанные готовые builds можно
публиковать без передачи private signing keys в CI:

```bash
bash tools/android/publish-release.sh 6 7 s07-android-v0.0.7 b733ff031512d8f7cf084f2bf4d9dbedfc95e710
```

Это уже опубликованный tag; повторная команда откажет в перезаписи. Для нового
выпуска использовать новые build codes/tag и точный source commit. Script
проверяет build hashes, передает только APK/public metadata через orphan branch,
GitHub Actions публикует prerelease и удаляет свою transfer branch. Исходники
не получают binary history. При ошибке публикации не выдавать будущий URL за
готовый файл: дождаться release и проверить скачанные bytes. Это transport
готовых артефактов, не замена постоянной подписи или Android-приемки.

## Владелец и аудит S08

Отдельные admin sessions/CSRF, CLI provisioning без default password и audit
реализованы на сервере. [Команды и границы](S08_RUN.md). Web UI следующий S09;
S08 не добавляет экранов или новых APK. Production owner/proxy не настраивались.
