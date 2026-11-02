# Минимальная Android-оболочка Studio

S04: Java Activity/WebView, читает встроенный общий контракт v1, no remote pages,
JavaScript/file access выключены. Это рабочий технический экран, не редактор.
S09/S10 реализуют React-комбайн и подключение к нему. Сборка:
`bash tools/android/build.sh VERSION_CODE` с PRIVATE signing env; команды/границы
в [отчете S04](../../docs/reports/S04.md).
