# География Башкортостана

- `wikidata-query.sparql` — запрос к https://query.wikidata.org/sparql.
- `wikidata-raw.json` — ответ как есть; `retrieved-at.txt` — дата получения (UTC).
- `bashkortostan.locations.json` — готовый набор (1 республика, 54 района, 9 городских
  округов), сборка: `node tools/geo/build-locations.mjs`.
- Сверка с OpenStreetMap: `node tools/geo/check-osm.mjs > docs/reports/S21-geo-check.json`.

Лицензия набора: CC0 (Wikidata). Отчет сверки содержит сведения OpenStreetMap
(© участники OpenStreetMap, ODbL) и в игровой контент не переносится.
Обновление: заново выполнить запрос, сохранить ответ и дату, пересобрать, сверить,
проверить тестами `npm run check:contracts`.
