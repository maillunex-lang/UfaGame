# Проверки

contracts/: strict schema roundtrip/negative/capabilities.
integration/: PostgreSQL18.4 ledger/jobs и auth/account races/replay/revoke.
`npm run check:contracts`, `npm run test:integration`. Godot store/replay и client
registry проверяет `npm run check:game`. Android Keystore/login/update требуют
отдельной приемки на телефоне; серверные тесты ее не заменяют.
