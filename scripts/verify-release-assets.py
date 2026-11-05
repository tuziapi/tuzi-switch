"""Fail publication unless seven direct installers match the four build manifests."""
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
expected = {
    'macos-arm64': ('aarch64-apple-darwin', ['.dmg']),
    'macos-x64': ('x86_64-apple-darwin', ['.dmg']),
    'windows-x64': ('x86_64-pc-windows-msvc', ['.exe', '.msi']),
    'linux-x64': ('x86_64-unknown-linux-gnu', ['.AppImage', '.deb', '.rpm']),
}
version = json.loads(Path('package.json').read_text())['version']
for name, (target, formats) in expected.items():
    m = json.loads((root / f'manifest-{name}.json').read_text())
    for key, value in {
        'repository': os.environ['GITHUB_REPOSITORY'], 'commit': os.environ['GITHUB_SHA'],
        'run': os.environ['GITHUB_RUN_ID'], 'target': target, 'version': version,
        'channel': 'stable', 'applicationId': 'com.tuziswitch.desktop', 'isolatedLocalProfile': False,
    }.items():
        if m.get(key) != value: raise SystemExit(f'{name}: mismatched {key}')
    files = {f['file']: f for f in m['files']}
    required = {f'tuzi-assistant-{name}{ext}' for ext in formats}
    if len(files) != len(m['files']) or set(files) != required:
        raise SystemExit(f'{name}: missing or duplicate package')
    for filename, entry in files.items():
        data = (root / filename).read_bytes()
        if len(data) != entry['bytes'] or not data or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise SystemExit(f'{filename}: checksum mismatch')
print('Seven installers verified against source, target, identity and SHA256')
