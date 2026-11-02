# Разработка UfaGame

S01 принят на iQOO15R / Android16: запуск, HP0 и reuse ресурса. S02 организует исходники и проверки. API, worker, Studio и игровые системы пока не реализованы. Статусы этапов — в [roadmap](../roadmap.md).

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

`check` выполняет lint/syntax, форматирование файлов инфраструктуры S02, статическую проверку планирования, поиск секретов в исходниках/истории и compile/smoke проверку стека S01. Это не игровой сервер и не сквозная проверка игры. Lint намеренно не переписывает старые спецификации. `npm run format` форматирует только перечисленные инфраструктурные файлы.

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
| apps/studio-android           | Зарезервирован для S10                              |
| services/prototype            | Генератор fixture S01                               |
| services/api, services/worker | Зарезервированы для S05                             |
| packages/contracts            | Контракты S03, пока README                          |
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
