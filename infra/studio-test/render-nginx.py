#!/usr/bin/env python3
"""Render only the reviewed additions; never modify the input file."""
import pathlib
import re
import sys

if len(sys.argv) != 3:
    raise SystemExit('Usage: render-nginx.py INPUT OUTPUT')
src, dst = map(pathlib.Path, sys.argv[1:])
lines = src.read_text(encoding='utf-8').splitlines(keepends=True)
active = [line.split('#', 1)[0] for line in lines]
if sum(bool(re.match(r'^\s*server\s*\{', s)) for s in active) != 1:
    raise SystemExit('Expected exactly one server block')
if sum(bool(re.match(r'^\s*server_name\s+tts-ufa\.ru\s*;', s)) for s in active) != 1:
    raise SystemExit('Expected server_name tts-ufa.ru')
if any(re.match(r'^\s*(include|location\s+[^;{]*?/game(?:/|\s|\{))', s) for s in active):
    raise SystemExit('Include or existing game location; manual review required')
anchors = [i for i, s in enumerate(active) if re.match(r'^\s*location\s+/\s*\{\s*$', s)]
if len(anchors) != 1:
    raise SystemExit('Expected exactly one location / block')
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
dst.write_text(''.join(lines[:anchors[0]] + insert + lines[anchors[0]:]), encoding='utf-8')
