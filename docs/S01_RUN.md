# Команды S01

Сборка выполняется на отдельной Linux-среде/сборочном компьютере, не на VPS
с действующими проектами. Компьютер владельца не обязателен: допустима облачная
сборочная среда. На Android устанавливается результат. В текущем сеансе APK нет.
Команды ниже подготовлены; установка отсутствующих зависимостей не выполнялась.

Сначала проверь локальные изменения, не делай reset/clean:

```bash
git clone https://github.com/maillunex-lang/UfaGame.git
cd UfaGame
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
sdkmanager --sdk_root="$ANDROID_HOME" 'platform-tools' 'build-tools;35.0.1' 'platforms;android-35' 'cmdline-tools;latest' 'cmake;3.10.2.4988404' 'ndk;28.1.13356709'
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
"$ANDROID_HOME/build-tools/35.0.1/apksigner" verify --verbose --print-certs build/s01/Game-S01-arm64-debug.apk
"$ANDROID_HOME/build-tools/35.0.1/aapt" dump badging build/s01/Game-S01-arm64-debug.apk
```

Проверить package org.ufagame.game.s01, minSdk26, targetSdk35 и arm64-v8a.
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
