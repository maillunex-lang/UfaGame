# API S05–S07

Реализованы PostgreSQL migrations, health/capabilities, внутренний ledger,
guest/refresh/revoke/progress, bind/login/recover и rotation recovery code.
Игровых боев/покупок/награды по клиентскому запросу нет. Логи request bodies
и credentials отключены; ошибки публичные, без SQL/секретов.

```bash
npm ci --ignore-scripts --no-audit --no-fund
# Задай DATABASE_URL приватно либо PGHOST/PGUSER/PGDATABASE для локальной БД.
npm run db:migrate
npm run dev:api
```

По умолчанию слушает127.0.0.1 и случайный свободный порт0, адрес печатается.
Сервис не читает .env автоматически: экспортируй переменные из private окружения
средствами своей сборочной среды. Не копируй пароли в историю команд/репозиторий.
На VPS пока не запускать: требуется S51 и отдельный план deployment.

`npm run test:integration` поднимает только свою временную БД Docker без сети,
с Unix socket; проверяет races/replay/rollback. См. docs/reports/S05–S07 и
[контракт](../../docs/adr/0002-contracts.md), [решение](../../docs/adr/0004-server-foundation.md).
