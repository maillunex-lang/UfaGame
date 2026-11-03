#!/usr/bin/env python3
"""Add WebSocket pass-through to the existing UfaGame API location only.

Adds to `location ^~ /game/server/ { ... }`:
  proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $http_connection; proxy_read_timeout 120s;
Normal requests keep their own Connection header. Never modifies the input file;
refuses anything unexpected so the owner can review.
"""
import pathlib
import re
import sys

if len(sys.argv) != 3:
    raise SystemExit('Usage: render-websocket.py INPUT OUTPUT')
src, dst = map(pathlib.Path, sys.argv[1:])
lines = src.read_text(encoding='utf-8').splitlines(keepends=True)
active = [line.split('#', 1)[0] for line in lines]
starts = [i for i, s in enumerate(active) if re.match(r'^\s*location\s+\^~\s+/game/server/\s*\{\s*$', s)]
if len(starts) != 1:
    raise SystemExit('Expected exactly one "location ^~ /game/server/ {" block')
start = starts[0]
end = next((i for i in range(start + 1, len(active)) if re.match(r'^\s*\}\s*$', active[i])), None)
if end is None or any('{' in active[i] for i in range(start + 1, end)):
    raise SystemExit('Unexpected nested block in /game/server/ location')
body = ''.join(active[start + 1:end])
for directive in ('proxy_http_version', 'Upgrade', 'proxy_read_timeout'):
    if re.search(r'\b' + directive + r'\b', body):
        raise SystemExit(f'{directive} already present in /game/server/; nothing to do')
indent = re.match(r'^\s*', lines[start + 1]).group() if start + 1 < end else '    '
add = [f'{indent}proxy_http_version 1.1;\n', f'{indent}proxy_set_header Upgrade $http_upgrade;\n',
       f'{indent}proxy_set_header Connection $http_connection;\n', f'{indent}proxy_read_timeout 120s;\n']
lines[start + 1:start + 1] = add
dst.write_text(''.join(lines), encoding='utf-8')
