#!/usr/bin/env python3
"""Add only `client_max_body_size 16m;` to the existing UfaGame API location.

Never modifies the input file. Refuses anything unexpected so the owner can review.
16 MiB covers the 8 MiB PNG/WAV/ZIP limits after base64 (~11.2 MiB) plus JSON.
"""
import pathlib
import re
import sys

if len(sys.argv) != 3:
    raise SystemExit('Usage: render-body-limit.py INPUT OUTPUT')
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
if any(re.search(r'\bclient_max_body_size\b', active[i]) for i in range(start + 1, end)):
    raise SystemExit('client_max_body_size already set in /game/server/; nothing to do')
indent = re.match(r'^\s*', lines[start + 1]).group() if start + 1 < end else '    '
lines.insert(start + 1, f'{indent}client_max_body_size 16m;\n')
dst.write_text(''.join(lines), encoding='utf-8')
