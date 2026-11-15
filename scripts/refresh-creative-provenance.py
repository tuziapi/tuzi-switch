#!/usr/bin/env python3
"""Rebuild and verify the embedded source manifest and patch against pinned Git source.

Pass --source-repo when the pinned desktop revision is not in this repository.
No network, source checkout mutation, or application data access is performed.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'packages/creative-workspace'
UPSTREAM = PACKAGE / 'upstream'
SOURCE = json.loads((ROOT / 'docs/development/creative-feature-sync-source.json').read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-repo', type=pathlib.Path, default=ROOT)
SOURCE_REPO = parser.parse_args().source_repo.resolve()
REVISION = SOURCE['desktopCommit']
if subprocess.run(['git', 'cat-file', '-e', REVISION + '^{commit}'], cwd=SOURCE_REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    raise SystemExit('Pinned desktop revision unavailable; pass --source-repo with its local checkout.')
manifest = json.loads((PACKAGE / 'UPSTREAM.json').read_text())
local = {entry['path']: entry for entry in manifest['localFiles']}
omitted = [entry['path'] for entry in manifest['omittedPaths']]
tracked = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', REVISION], cwd=SOURCE_REPO, text=True).splitlines()
source_paths = set(tracked)
files = sorted(p.relative_to(UPSTREAM).as_posix() for p in UPSTREAM.rglob('*') if p.is_file())
assert not any(p.startswith(prefix) for p in files for prefix in omitted), 'Removed workflow source reintroduced'
original = {}
for p in files:
    if p in source_paths:
        original[p] = subprocess.check_output(['git', 'show', f'{REVISION}:{p}'], cwd=SOURCE_REPO)
    else:
        assert p in local, f'Unregistered local source: {p}'
manifest['revision'] = REVISION
manifest['integration'] = {
    'assistantRevision': SOURCE['targetBase'],
    'featureSourceRevision': SOURCE['sourceCommit'],
    'featureBaseRevision': SOURCE['desktopBase'],
    'date': SOURCE['date'],
    'strategy': 'three-way feature adaptation; preserve assistant host patches and workflow exclusions',
}
manifest['files'] = [{'path': p, 'sha256': hashlib.sha256(data).hexdigest()} for p, data in sorted(original.items())]
with tempfile.TemporaryDirectory(prefix='creative-provenance-') as tmp:
    temp = pathlib.Path(tmp)
    base = temp / 'source'
    base.mkdir()
    for p, data in original.items():
        f = base / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    subprocess.run(['git', 'init', '-q', str(base)], check=True)
    subprocess.run(['git', 'add', '-f', '.'], cwd=base, check=True)
    for p in files:
        f = base / p
        f.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(UPSTREAM / p, f)
    for p in local:
        subprocess.run(['git', 'add', '-N', '-f', p], cwd=base, check=True)
    patch = subprocess.check_output(['git', 'diff', '--binary', '--no-ext-diff'], cwd=base)
    (PACKAGE / 'UPSTREAM-PATCHES.patch').write_bytes(patch)
    check = temp / 'reconstructed'
    check.mkdir()
    for p, data in original.items():
        f = check / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    # An independent repository prevents Git from inheriting any parent worktree.
    subprocess.run(['git', 'init', '-q', str(check)], check=True)
    subprocess.run(['git', 'apply', '--check', str(PACKAGE / 'UPSTREAM-PATCHES.patch')], cwd=check, check=True)
    subprocess.run(['git', 'apply', str(PACKAGE / 'UPSTREAM-PATCHES.patch')], cwd=check, check=True)
    for p in files:
        assert (check / p).read_bytes() == (UPSTREAM / p).read_bytes(), p
(PACKAGE / 'UPSTREAM.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'sourceRevision': REVISION, 'originalFiles': len(original), 'localFiles': len(local), 'reconstructedFiles': len(files), 'patchBytes': len(patch)}, indent=2))
