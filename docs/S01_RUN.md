# Команды S01

Сборка выполняется на отдельной Linux-среде/сборочном компьютере, не на VPS
с действующими проектами. Компьютер владельца не обязателен: допустима облачная
сборочная среда. На Android устанавливается результат. APK успешно собран 2026-11-02; результаты см. в отчете S01.
Команды ниже подготовлены; минимальный набор SDK и JDK установлен в текущей сборочной среде.

Сначала проверь локальные изменения, не делай reset/clean:

```bash
git clone https://github.com/maillunex-lang/UfaGame.git
cd UfaGame
git fetch origin codex/s01-technical-prototype
git switch --track origin/codex/s01-technical-prototype
git status --short --branch
```

Нужны Godot **4.6.3 official** с export templates **4.6.3.stable**, полный
JDK17 (java/javac/keytool), Node **24.19.0**, Python3 и Android command-line tools.
Скачай Godot/templates с официального релиза:
https://github.com/godotengine/godot/releases/tag/4.6.3-stable
Шаблоны установи через Godot → Editor → Manage Export Templates → Install from File.
Command-line tools: https://developer.android.com/studio#command-tools
SDK не устанавливай из устаревшего пакета Linux-дистрибутива.

После установки CLI и JDK (пути замени на свои):

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
java -version
javac -version
godot --version
node --version
sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" 'platform-tools' 'build-tools;36.0.0' 'platforms;android-36' 'cmdline-tools;latest'
```

В Godot Editor Settings → Export → Android укажи Java SDK Path и Android SDK
Path. Эти настройки локальны для сборочной среды; не записывай пути/ключи в Git.
Debug keystore используй только для S01, храни вне репозитория; при необходимости
создай локально через keytool и настрой Debug keystore в Android export preset.
Не используй release-ключ в прототипе. Финальная подпись и восстановление — S04.

```bash
bash tools/s01/check.sh
bash tools/s01/build-android.sh
cat build/s01/apk-size.json
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs build/s01/Game-S01-arm64-debug.apk
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging build/s01/Game-S01-arm64-debug.apk
```

Проверить package org.ufagame.game.s01, minSdk24, targetSdk36 и arm64-v8a.
APK/ключи/полные личные логи в Git не добавлять. Приложение проигрывает локальную
запись серверного вывода; подключения к боевому серверу здесь нет.

На подключенном Android (или скачай APK на телефон и подтверди установку):

```bash
adb devices
adb install -r build/s01/Game-S01-arm64-debug.apk
adb shell am start -n org.ufagame.game.s01/com.godot.game.GodotApp
adb shell run-as org.ufagame.game.s01 find files -type f
adb shell am force-stop org.ufagame.game.s01
adb shell am start -n org.ufagame.game.s01/com.godot.game.GodotApp
```

При первом запуске ресурс stored, при повторном reused; HP меняется 100→75→40→0.
Запиши модель/Android, фактический путь files (а не cache), повтор после force-stop,
перезагрузки телефона и `adb install -r` того же APK без потери ресурса.
Не удаляй приложение и не очищай его данные для проверки сохранности.
Без adb проверяй поведение на экране; точный app-private путь остается непроверенным.

После успешной сборки перенеси размер/hash/проверку подписи и результаты устройства
в docs/reports/S01.md, затем отдельно обнови roadmap.md. До этого S01 blocked.
S02 зависит от S01; отсутствие SSH не блокирует S01.


## Установленная среда этого сеанса

```bash
cd /workspace/UfaGame
source /workspace/toolchains/env.sh
bash tools/s01/build-android.sh
```

JDK17: /workspace/toolchains/jdk17; SDK: /workspace/toolchains/android-sdk;
Android templates: $XDG_DATA_HOME/godot/export_templates/4.6.3.stable.
Command-line tools 19.0, platform-tools 37.0.1, build-tools 35.0.1 и 36.0.0,
platforms 35 и 36. NDK/CMake не устанавливались: для обычного APK-экспорта
они не требуются; понадобятся при собственной нативной/Gradle-сборке.
В sdkmanager использованы --proxy=http --proxy_host=proxy --proxy_port=8080;
публичные CA среды добавлены в локальный truststore JDK с проверкой TLS.
Debug key хранится вне репозитория; env.sh и локальные Editor Settings
не предназначены для переноса на другое устройство.


## Скачать опубликованный прототип на Android

[Скачать APK](https://github.com/maillunex-lang/UfaGame/releases/download/s01-prototype-v0.0.1/Game-S01-arm64-debug.apk)
или [открыть релиз с проверочными файлами](https://github.com/maillunex-lang/UfaGame/releases/tag/s01-prototype-v0.0.1).
Это CI-сборка с отдельным debug key. Если уже ставил старый локальный S01 APK,
он не обновится поверх: сначала удали именно старый S01-прототип.
После установки проверь: HP 100→75→40→0, перезапуск, сохранение ресурса.
Для приемки запиши модель/Android и результат, не очищая данные приложения.
Внутри прототипа нет игрового прогресса или боевого сервера.

Дополнительные технические проверки стека:

```bash
npm ci --prefix tools/s01/stack-check --ignore-scripts --no-audit --no-fund
npm run check --prefix tools/s01/stack-check
bash tools/s01/check-postgres.sh
```

PostgreSQL-проверка требует локальный Docker, временный контейнер без сети
и host ports автоматически удаляется. На VPS владельца эти команды не запускать.
