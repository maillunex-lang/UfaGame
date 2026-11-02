# S03–S07: что можно запустить

## Проверки в отдельной dev среде

```bash
npm ci --ignore-scripts --no-audit --no-fund
bash tools/install-gitleaks.sh /tmp/ufagame-tools/bin
export PATH="/tmp/ufagame-tools/bin:$PATH"
npm run check
npm run test:integration
npm run check:game
```

Нужны Node24.19.0, Python3, Docker и Godot4.6.3. Integration создает только свою
временную PostgreSQL18.4, без сети/host ports, и удаляет ее. Подтверждает ledger,
jobs и auth races; это не deployment. Не запускать эти инструкции на рабочем VPS
до отдельного обследования S51. Все отчеты — docs/reports/S03.md … S07.md.

## Собрать оба APK

Сборочная среда этого сеанса:

```bash
source /workspace/toolchains/env.sh
export UFAGAME_SIGNING_DIR=/workspace/toolchains/private/ufagame-release
bash tools/android/build.sh 6
```

Для измененного/публикуемого исходника выбрать новый возрастающий versionCode;
не заменять уже опубликованный APK под тем же номером. На другой среде нужны
JDK17, SDK36/build-tools36.0.0, Godot4.6.3 templates с android_source.zip.
Ключи перенести приватно; init-signing запрещает перезапись готового каталога.
Новый signing identity после потери ключа не обновит уже установленный package.

Game org.ufagame.game и Studio org.ufagame.studio подписаны разными постоянными
локальными ключами. S01 org.ufagame.game.s01 — другое приложение и не обновляется
этим APK. Studio пока только минимальный technical screen с общим контрактом.
Редактор и владелец Studio еще не реализованы.

На телефоне без API можно проверить: установить Game code4, нажать
«Проверить защищенное хранилище» → stored; закрыть и открыть → reused;
установить Game code6 поверх code4 без удаления данных → снова reused.
Это отдельный probe file, не перезапись аккаунта. Зафиксировать модель/Android,
package/version и результат, не считать тест пройденным по одной сборке.
Также проверить установку Studio и update code4→6. Не удалять приложение между
версиями: это уничтожит проверяемые данные. Приватную signing-backup.tar
сохранить у владельца вне текущей среды, в защищенном хранилище; не в GitHub.

## Реальные guest/login/recovery потоки

Нужны работающие PostgreSQL migrations и HTTPS endpoint. Dev API:
`npm run db:migrate`, затем `npm run dev:api`; private DATABASE_URL либо PGHOST/
PGUSER/PGDATABASE задаются окружением, .env автоматически не читается.
По умолчанию bind127.0.0.1/port0, адрес печатается. Worker: `npm run dev:worker`.

Routes: GET /health/live, /health/ready, /v1/capabilities, /v1/progress;
POST /v1/guests, /v1/sessions/refresh, /v1/sessions/revoke,
/v1/account/bind, /v1/sessions/login, /v1/account/recover,
/v1/account/recovery/rotate. Bodies/версии: packages/contracts и ADR0002/0004.
Прямых endpoints выдачи валюты клиенту нет.

В Game ввести подтвержденный HTTPS base URL. Создать гостя, записать player_id,
перезапустить без очистки данных, проверить тот же player_id. Привязать логин/
пароль, сохранить показанный секретный код вне игры. Login должен возвращать
тот же player_id. Recovery с новым паролем меняет код и отзывает старые сессии;
повтор старого кода должен отказать. При потере ответа можно войти новым паролем
и выпустить новый recovery code. Не публиковать код/пароль/токены на скриншотах.

Предпочтительный будущий URL владельца: https://tts-ufa.ru/game/server.
Домен уже обслуживает рабочий портал; DNS запись для prefix не нужна, но route
пока не создан/не обследован. VPS144.31.254.99 и internal8055 — только кандидат
после S51. Внешний prefix proxy должен снять перед upstream /v1/... .
Сохраняем root portal и его сервисы/порты. Пока в APK нет активного default URL:
не отправлять пароли в не настроенный путь рабочего портала.
