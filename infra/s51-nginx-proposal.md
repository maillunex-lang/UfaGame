# S51 — предварительное предложение маршрутов

Только для обсуждения, не применять как готовый patch. Выборка владельца показала
`server_name tts-ufa.ru` на443 в `/etc/nginx/sites-available/agroapp`, location /;
прямых include в этом файле в показанном выводе нет. Глобальные include,
regex/rewrite и фактический контекст не установлены. Рабочий портал после двух
redirects дает200, пути /game/… —404. Порт8055 на момент снимка не слушается.

Предлагаемый фрагмент **внутри существующего server block 443**, после проверки
полной конфигурации и только когда test API/UI готовы (не сейчас):

```nginx
location = /game/studio { return 308 /game/studio/; }
location ^~ /game/studio/ {
    alias /srv/ufagame-test/studio/;
    index index.html;
}
location ^~ /game/server/ {
    proxy_pass http://127.0.0.1:8055/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Закрывающий `/` в proxy_pass снимает `/game/server/`: `/game/server/v1/...`
передается как `/v1/...`. Studio собрана с base `/game/studio/`; API должен
слушать только loopback, с отдельной БД и секретами вне web-root. Строка alias
— предложенный путь, каталога пока нет. Не добавлять proxy headers/timeout,
authentication и CORS без проверки существующей конфигурации и S08/S52.
Текущий API `trustProxy:false`: rate limit за общим proxy будет считать клиентов
по адресу proxy. До реального развертывания нужен отдельный проверенный план
доверенного proxy/лимитов; не включать trust всех адресов.

До применения: проверить наличие конфликтующих regex/include на всех уровнях,
повторить ss/socket check8055, согласовать limits и свободное место; подготовить
изолированные сервисы/БД и восстановимый backup существующей конфигурации.
Нужен фактический diff от текущих байтов `/etc/nginx/sites-available/agroapp`,
без раскрытия ключей/секретов; этот эскиз не доказывает, что patch применится.
Вне scope S51: команда `nginx -t` для итоговой конфигурации и управляемый reload
только по готовому согласованному плану. Не отключать TLS/SSH/firewall.

Откат: вернуть проверенную предыдущую копию только измененного nginx-файла,
проверить `nginx -t`, затем применить прежнюю конфигурацию согласованным способом;
остановить только новые сервисы тестового проекта. Проверить портал до/после:
HTTPS root200 после redirect, ранее существующие health checks и пути проекта.
Не удалять чужие контейнеры/volumes и не откатывать БД соседних проектов.
