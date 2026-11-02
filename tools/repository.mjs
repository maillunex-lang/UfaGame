import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const list = (...args) =>
  execFileSync('git', ['ls-files', '-z', ...args], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
const tracked = list('--cached');
const candidates = [
  ...new Set(list('--cached', '--others', '--exclude-standard')),
];
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (exit ${result.status})`);
}
function checkTrackedPaths() {
  for (const file of tracked) {
    const sensitive =
      /(^|\/)(private|backups|node_modules|\.godot)(\/|$)|\.(keystore|jks|pem|key|apk|aab|dump)$|(^|\/)\.env($|\.)/;
    if (
      sensitive.test(file) &&
      !file.endsWith('/.env.example') &&
      file !== '.env.example'
    ) {
      throw new Error(`Forbidden tracked path: ${file}`);
    }
  }
}
checkTrackedPaths();
switch (process.argv[2]) {
  case 'lint':
    run('git', ['diff', '--check']);
    run('git', ['diff', '--cached', '--check']);
    for (const file of candidates.filter((p) => p.endsWith('.mjs')))
      run(process.execPath, ['--check', file]);
    console.log('Repository paths, whitespace and JavaScript syntax: OK');
    break;
  case 'secrets': {
    const version = readFileSync('.gitleaks-version', 'utf8').trim();
    const actual = execFileSync('gitleaks', ['version'], {
      encoding: 'utf8',
    }).trim();
    if (actual !== version) throw new Error(`Use gitleaks ${version}`);
    const directory = mkdtempSync(join(tmpdir(), 'ufagame-source-scan-'));
    try {
      for (const file of candidates) {
        if (!lstatSync(file).isFile()) continue;
        const destination = join(directory, file);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(file, destination);
      }
      run('gitleaks', ['dir', '--redact', '--no-banner', directory]);
      run('gitleaks', ['git', '--redact', '--no-banner', '.']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    break;
  }
  default:
    throw new Error('Usage: node tools/repository.mjs lint|secrets');
}
