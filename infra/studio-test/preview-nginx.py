#!/usr/bin/env python3
"""Preview additions only; never modify the server configuration."""
import difflib
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1] if len(sys.argv) == 2 else '/etc/nginx/sites-available/agroapp')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
active = [line.split('#', 1)[0] for line in lines]
if sum(bool(re.match(r'^\s*server\s*\{', s)) for s in active) != 1:
    raise SystemExit('Expected exactly one server block; no preview generated.')
if sum(bool(re.match(r'^\s*server_name\s+tts-ufa\.ru\s*;', s)) for s in active) != 1:
    raise SystemExit('Expected server_name tts-ufa.ru; no preview generated.')
if any(re.match(r'^\s*(include|location\s+[^;{]*?/game(?:/|\s|\{))', s) for s in active):
    raise SystemExit('Include or existing /game location found; manual review required.')
anchors = [i for i, s in enumerate(active) if re.match(r'^\s*location\s+/\s*\{\s*$', s)]
if len(anchors) != 1:
    raise SystemExit('Expected one location / block; no preview generated.')
indent = re.match(r'^\s*', lines[anchors[0]]).group()
fragment = '''location = /game/studio { return 308 /game/studio/; }
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

'''
insert = [indent + line if line.strip() else '\n' for line in fragment.splitlines(keepends=True)]
new = lines[:anchors[0]] + insert + lines[anchors[0]:]
print(''.join(difflib.unified_diff(lines, new, fromfile=str(path), tofile='PROPOSED-only', n=0)), end='')
