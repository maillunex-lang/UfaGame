# Как подготовить ZIP-пакет UfaGame (инструкция для внешнего ИИ)

Этот документ можно целиком передать другому ИИ вместе с экспортом нужных объектов
из Studio. Формат — `ug-content/1` (ADR 0013, MODDING_SPEC.md). Пакет содержит только
данные: никакого кода, скриптов, ссылок на сеть.

## Что дать ИИ
1. Этот файл.
2. ZIP, скачанный в Studio кнопкой «Скачать выбранное» (объекты + зависимости) или
   «Скачать весь черновик». В нем `manifest.json` с текущей `base_content_version` и
   `required_capabilities`, а также точные JSON существующих объектов.
3. Схемы: `packages/contracts/content.schema.json`, `mod_manifest.schema.json`,
   `mod_operations.schema.json`, `mod_resource.schema.json`, `capabilities.json`.
4. Рабочий пример: `examples/ufa_batyrs_starter/`.

Не проси ИИ угадывать поля: всё, чего нет в схемах, сервер отклонит.

## Правила для ИИ
- Структура: `manifest.json`, `operations.json`, `entities/<id>.json`,
  `resources/<id>.json`, `assets/<id>.png|wav`, необязательно `README.md`.
- ID: `^[a-z][a-z0-9_]{2,79}$`, стабильные, латиница; названия (`name`) — по-русски.
- `base_content_version` — ровно из экспортированного manifest.
- `required_capabilities` — только из `capabilities.json`. Боевые параметры героя
  (`combat`) и `energy_cost` требуют `battle.combat.v1`; `sprite_resource_id` и
  `sound_resource_id` — `content.resources.v1`.
- Новый объект: `{"op":"create","entity_type":"<kind>","id":"<id>","source":"entities/<id>.json"}`.
- Изменение существующего: `replace` с `expected_sha256` — SHA-256 от канонического JSON
  объекта ИЗ ЭКСПОРТА (ключи отсортированы на всех уровнях, без пробелов и переводов
  строк, UTF-8). Пример на Python:
  `hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',',':'), ensure_ascii=False).encode()).hexdigest()`.
- Удаление: `{"op":"delete","entity_type":"<kind>","id":"<id>","expected_sha256":"..."}`;
  на удаляемый объект не должны ссылаться другие.
- Ресурс: `{"op":"create","entity_type":"resource","id":"<id>","source":"resources/<id>.json"}`,
  в `resources/<id>.json`: `id`, `file` (`assets/...png|wav`), `license` {`name`, `attribution`},
  `loop`; для PNG можно `scale_bp`, `anchor`, `frames` (кадры внутри изображения).
  PNG — 8 бит, без interlace, до 4096×4096; WAV — PCM 8/16 бит, 1–2 канала,
  8–48 кГц, до 120 с. Существующий ресурс заменить нельзя — новый файл = новый id.
- Операции над ресурсами ставь перед объектами, которые на них ссылаются.
- `manifest.files`: каждый файл, кроме manifest, ровно один раз, с точным `size` и
  `sha256`. Лишних файлов быть не должно. `dependencies: []`.
- Лимиты: ZIP до 8 МиБ, до 1000 файлов, файл до 8 МиБ.

## Что происходит при импорте
Studio → «Импорт и экспорт ZIP» → «Проверить пакет»: сервер проверяет пакет в карантине
и показывает, что будет создано/заменено/удалено, конфликты и изменения полей. Для
каждого конфликта владелец выбирает «Оставить моё» или «Взять из пакета». «Применить
импорт» меняет черновик одной транзакцией; ошибка не меняет ничего. Импорт не публикует
контент — публикация отдельный шаг (S15).
