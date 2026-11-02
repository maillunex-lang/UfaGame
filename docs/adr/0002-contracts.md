# ADR 0002: контракты v1

Дата: 2026-11-02 UTC. API /v1, schema_version1, simulation_version1.
Общий источник: packages/contracts/*.schema.json, registry capabilities.json.
Node валидирует через AJV2020 без coercion/removeAdditional; неизвестные поля,
типы, версии и capabilities отклоняются. Stable content IDs неизменяемы,
player/battle/ledger IDs UUID. Целые игровые значения ограничены int32,
seed uint32. Экономика доступна только доверенному коду сервера, не API клиента.

Сущности этого среза: faction/ability/hero/item/stage/ui_label/dialogue_template.
Новый тип требует schema/capability/обработчик/редактор, не произвольный JSON.
Ссылки и дубли IDs проверяются до публикации. Это минимальный контракт,
не готовый контент главы. Прежние ug-content/1 схемы ZIP сохранены для S12;
они не заменяют runtime v1 и не загружают код/PCK.

Snapshot закрепляет battle/content/simulation/seed/actors/last_seq.
Событие содержит battle_id, seq, at_ms, kind, target_id, hp; пока только hp.
Дедупликация/порядок обеспечиваются runtime, схемы задают форму.
Расширение enum или обязательных полей — новая capability/версия с миграцией,
старый опубликованный контент не переписывается. Удаление — future dependency
check/compensation, не автоматическая потеря состояния. Совместимость выбирается
по API+capabilities, не по номеру APK. До S17 нет серверного расчета боя.

Auth endpoints: POST /v1/guests, /v1/sessions/refresh, /v1/sessions/revoke,
/v1/account/bind, /v1/sessions/login, /v1/account/recover; GET /v1/progress,
GET /health/live, /health/ready, GET /v1/capabilities.
Bodies: guest_request/refresh_request/revoke_request/bind_request/login_request/
recover_request. Session и progress имеют отдельные response schemas.
Bind/recover возвращают bound_session {session, recovery_code} (показать и сохранить вне игры).
Нельзя читать чужой progress по player_id: он берется только из bearer session.
Ошибки возвращают error{code,message,request_id}, без деталей PostgreSQL/секретов.
Request body <=16КиБ, no extra fields. Auth TTL/rate limits фиксируются S06/S07.
POST /v1/account/recovery/rotate с password требует bearer и выдает новый
recovery_code, прежний немедленно недействителен; позволяет восстановить код
после потерянного bind/recover ответа через обычный password login.
Bootstrap installation_secret — 32 случайных байта base64url, не device ID.
Idempotent bootstrap не должен выдавать новую сессию после revoke/rotation.
Refresh — ротация атомарно; recovery — одноразовый, отзывает все старые сессии.
HTTPS обязателен вне loopback/dev, Android хранит credential в Keystore AES-GCM.

Consumers: Node imports @ufagame/contracts; Android build embeds copies из того
же каталога; клиент/Studio показывают доступную версию/проверяют capability set.
Полный UI/редактор и общий runtime renderer — следующие этапы.
