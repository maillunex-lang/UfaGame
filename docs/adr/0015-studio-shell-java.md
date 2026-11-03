# ADR 0015: Android-оболочка Studio на Java вместо Kotlin

Статус: принято. Промпт S10 называет Kotlin; оболочка с S04 написана на Java и
собирается без Gradle (aapt/javac/d8/apksigner, tools/android/build-studio-test.sh).
Требования S10 (WebView только для разрешенного HTTPS origin, без JavaScript
bridge, file chooser, загрузка экспорта, сессия, back, обработка ошибок, подпись)
не зависят от языка; используются те же Android API. Переход на Kotlin потребовал бы
Gradle/Kotlin toolchain без выгоды для владельца. Язык не является критерием
готовности S10; при росте нативной части решение можно пересмотреть.
