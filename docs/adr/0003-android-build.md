# ADR 0003: минимальные Android builds S04

Game: Godot4.6.3 official template release, arm64-v8a, minSdk24/target36.
Studio: Android SDK Java Activity/WebView без Gradle (javac17/D8/aapt36),
minSdk24/target36. Java выбран для малого native bridge без зависимости Kotlin
compiler; он совместим с будущим Kotlin и не меняет React/WebView архитектуру.
S04 экран Studio читает встроенный общий контракт; редакторы остаются S09/S10.
Game package org.ufagame.game, Studio org.ufagame.studio; S01 package изолирован.
versionCode монотонен и общий вход сборки, нельзя менять key для обновления.

Ключи RSA3072, отдельные Game/Studio, создаются один раз вне Git. Сборка никогда
не генерирует ключ при отсутствии: только явная init-signing команда в приватный
каталог. Passphrase случайная, не коммитится, не печатается. Приватный backup
содержит keys/password и требует закрытого хранения владельцем. Восстановление
проверяется экспортом/сравнением сертификатов. Публичны только APK/hash/certificate.
Копия в одной временной среде не равна сохраненной у владельца резервной копии.
Пока не подтверждены private off-environment backup и Android install-over-update,
S04 не done. Следующие S05–S07 зависят от S03/S05, не от S04.
