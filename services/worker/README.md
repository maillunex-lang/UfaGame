# PostgreSQL worker

S05 реализован: ledger_delta jobs, dedupe, SKIP LOCKED claim, lease/fencing,
атомарные effect+ack. API для постановки задач доступно только trusted server code.

`npm run dev:worker` использует ту же приватную PG конфигурацию, что API.
Миграции сначала `npm run db:migrate`. Deployment/VPS не настроены.
