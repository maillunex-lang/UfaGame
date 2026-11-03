# Серверная симуляция боя (S17)

- `index.mjs` — ранний шаг v1 (ADR 0007).
- `auto.mjs` + `auto.schema.json` — экспериментальная fixed-step симуляция v2 (ADR 0009).
- `compile.mjs` — сборка снимка v2 из черновика Studio и полный прогон с журналом,
  кадрами и SHA-256 (ADR 0012). Используется owner endpoint battle-preview.

Бой Game, наград и рейтинга этот код пока не выдает. Статус — в [roadmap](../../roadmap.md).
