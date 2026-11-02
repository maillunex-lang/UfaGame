#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
s07_old=${1:?Usage: bash tools/android/publish-release.sh oldCode newCode tag sourceCommit}
s07_new=${2:?Missing new versionCode}
s07_tag=${3:?Missing release tag}
s07_source=$(git rev-parse "${4:?Missing source commit}^{commit}")
[[ "$s07_old" =~ ^[1-9][0-9]{0,7}$ && "$s07_new" =~ ^[1-9][0-9]{0,7}$ && "$s07_tag" =~ ^[A-Za-z0-9._-]+$ ]] || exit 1
[[ "$s07_new" -gt "$s07_old" ]] || exit 1
s07_repo=maillunex-lang/UfaGame
if gh release view "$s07_tag" --repo "$s07_repo" >/dev/null 2>&1; then
 echo 'Release already exists; refusing to overwrite public APKs'; exit 1
fi
s07_root=$PWD
s07_tmp=$(mktemp -d /tmp/ufagame-apk-transfer-XXXXXX)
trap 'rm -rf -- "$s07_tmp"' EXIT
s07_branch="artifact-staging/apk-$(date -u +%Y%m%d%H%M%S)-$$"
mkdir -p "$s07_tmp/.github/workflows"
cp tools/android/release-staging.yml "$s07_tmp/.github/workflows/publish.yml"
python3 - "$s07_root" "$s07_tmp" "$s07_old" "$s07_new" "$s07_tag" "$s07_source" <<'PY'
import sys,shutil,hashlib,json,zipfile
from pathlib import Path
root,out=map(Path,sys.argv[1:3]);old,new=map(int,sys.argv[3:5]);tag,source=sys.argv[5:7]
files=[]
# Only these public build products are transferred. Never copy a signing directory.
for code in [old,new]:
    build=root/f'build/android/{code}'
    report={r['name']:r for r in json.loads((build/'report.json').read_text())}
    for app in ['Game-arm64','Studio']:
        artifact=build/f'{app}.apk'
        assert artifact.stat().st_size==report[app]['bytes']
        assert hashlib.sha256(artifact.read_bytes()).hexdigest()==report[app]['sha256']
        with zipfile.ZipFile(artifact) as archive:
            assert 'AndroidManifest.xml' in archive.namelist() and 'classes.dex' in archive.namelist()
        shutil.copyfile(build/f'{app}.apk',out/f'{app}-v{code}.apk')
        shutil.copyfile(build/f'{app}.signature.txt',out/f'{app}-v{code}.signature.txt')
    shutil.copyfile(build/'report.json',out/f'v{code}-report.json')
(out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(out.glob('*.apk'))))
notes=f'''Технические APK S03–S07, не готовая игра. Android7+, Game только arm64-v8a.

Game: org.ufagame.game; Studio: org.ufagame.studio. Старый S01 — отдельный .s01 package.

Проверка обновления:
1. Установи Game v{old}, нажми «Проверить защищенное хранилище»: stored.
2. Перезапусти, проверь снова: reused.
3. Установи Game v{new} поверх v{old} без удаления/очистки данных: снова reused.
4. Аналогично проверь установку и update Studio v{old}→v{new}.

Это пока непроверенные на телефоне сценарии. Studio — минимальная оболочка, редактор не реализован.
Live HTTPS API не настроен. Не отправляй пароли в работающий портал. Будущий путь https://tts-ufa.ru/game/server требует обследования VPS и настройки отдельного маршрута.

APKs уже подписаны постоянными локальными ключами; ключи и пароли в релиз НЕ включены.
Source commit: {source}
'''
(out/'release-notes.md').write_text(notes)
for p in sorted(out.iterdir()):
    if p.is_file():files.append({'name':p.name,'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(out/'release-manifest.json').write_text(json.dumps({'tag':tag,'source_sha':source,'title':f'S03–S07 — Game и Studio v{old}→v{new}','files':files},ensure_ascii=False,indent=2)+'\n')
PY
# Orphan transfer branch: binaries never enter source branch history.
git -C "$s07_tmp" init --initial-branch "$s07_branch" >/dev/null
# Stage only the explicitly selected public artifacts and metadata.
git -C "$s07_tmp" add --all
git -C "$s07_tmp" -c user.name=Codex -c user.email=codex@openai.com commit -m "Transfer signed APKs for $s07_tag" >/dev/null
git -C "$s07_tmp" remote add origin "https://github.com/$s07_repo.git"
git -C "$s07_tmp" push origin "$s07_branch"
echo "Transfer branch: $s07_branch"
echo "Release will be published by GitHub Actions: https://github.com/$s07_repo/releases/tag/$s07_tag"
