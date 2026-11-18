#!/usr/bin/env python3
"""Verify and collect exactly one isolated beta installer; never publish."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile

VERSION = '1.6.3-beta.5'
TARGETS = {
    'aarch64-apple-darwin': ('macos-arm64', '.dmg'),
    'x86_64-apple-darwin': ('macos-x64', '.dmg'),
    'x86_64-pc-windows-msvc': ('windows-x64', '.exe'),
    'x86_64-unknown-linux-gnu': ('linux-x64', '.deb'),
    'aarch64-unknown-linux-gnu': ('linux-arm64', '.deb'),
}

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def probe_packaged_node(node, version):
    probe = Path(__file__).with_name('probe-packaged-node.cjs').resolve()
    output = subprocess.check_output([str(node.resolve()), str(probe)], text=True, timeout=15)
    result = json.loads(output)
    assert result == {'version': 'v' + version, 'script': True, 'fetch': True, 'websocket': True}, result

def verify_node_entitlements(node):
    output = subprocess.check_output(['codesign', '-d', '--entitlements', ':-', str(node)])
    entitlements = plistlib.loads(output)
    assert entitlements.get('com.apple.security.cs.allow-jit') is True, 'Packaged Node requires JIT permission'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=TARGETS)
    parser.add_argument('--platform', required=True)
    args = parser.parse_args()
    platform, suffix = TARGETS[args.target]
    assert platform == args.platform, 'Target/platform mismatch'
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert re.fullmatch(r'[a-f0-9]{40}', commit)
    provenance = json.loads((Path('src-tauri/target/claude-local-runtime') / args.target / 'provenance.json').read_text())
    assert provenance['target'] == args.target and provenance['runtimeProbe'] == 'passed'
    bundles = [Path('src-tauri/target/release/bundle'), Path('src-tauri/target') / args.target / 'release/bundle']
    candidates = [p for root in bundles if root.exists() for p in root.rglob('*') if p.is_file() and p.suffix == suffix]
    assert len(candidates) == 1, f'Expected one installer, found {len(candidates)}'
    installer = candidates[0]
    checks = ['native-runtime-probe', 'release-native-integration']
    if suffix == '.dmg':
        with tempfile.TemporaryDirectory() as mount:
            subprocess.run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', mount, str(installer)], check=True)
            try:
                apps = list(Path(mount).glob('*.app')); assert len(apps) == 1
                app = apps[0]
                info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
                assert info['CFBundleIdentifier'] == 'com.tuziswitch.desktop.opentu-preview'
                assert info['CFBundleExecutable'] == 'tuzi-opentu-preview'
                assert info['CFBundleShortVersionString'] == VERSION
                subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
                node = app / 'Contents/MacOS/tuzi-claude-node'
                verify_node_entitlements(node)
                probe_packaged_node(node, provenance['version'])
                checks += ['dmg-mounted', 'isolated-identity', 'beta-version', 'ad-hoc-signature', 'node-jit-entitlement', 'packaged-node-script-executed']
            finally:
                subprocess.run(['hdiutil', 'detach', mount], check=True)
    elif suffix == '.deb':
        package = subprocess.check_output(['dpkg-deb', '-f', str(installer), 'Package'], text=True).strip()
        assert package not in ('tu-zi-switch', 'tuzi-switch'), 'Stable package identity collision'
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['dpkg-deb', '-x', str(installer), directory], check=True)
            root = Path(directory)
            assert not (root / 'usr/bin/tu-zi-switch').exists()
            assert not (root / 'usr/bin/tuzi-claude-node').exists()
            assert (root / 'usr/bin/tuzi-opentu-preview').is_file()
            node = root / 'usr/bin/tuzi-opentu-preview-node'
            probe_packaged_node(node, provenance['version'])
            checks += ['deb-extracted', 'no-stable-binary-collision', 'packaged-node-script-executed']
    elif suffix == '.exe':
        with tempfile.TemporaryDirectory() as directory:
            extractor = shutil.which('7z') or str(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / '7-Zip/7z.exe')
            subprocess.run([extractor, 'x', '-y', str(installer.resolve()), '-o' + directory], check=True, stdout=subprocess.DEVNULL)
            nodes = list(Path(directory).rglob('tuzi-claude-node.exe'))
            assert len(nodes) == 1, 'Expected exactly one packaged Node in NSIS installer'
            probe_packaged_node(nodes[0], provenance['version'])
            checks += ['nsis-extracted', 'packaged-node-script-executed']
    output = Path('opentu-test-artifacts'); output.mkdir(exist_ok=True)
    name = f'OpenTu-Preview-{VERSION}-{platform}{suffix}'
    dest = output / name; shutil.copy2(installer, dest)
    manifest = {'version': VERSION, 'channel': 'preview', 'repository': os.environ.get('GITHUB_REPOSITORY'),
                'commit': commit, 'runId': os.environ.get('GITHUB_RUN_ID'), 'target': args.target, 'platform': platform,
                'applicationId': 'com.tuziswitch.desktop.opentu-preview', 'isolatedProfile': True,
                'automaticUpdates': False, 'developerSigned': False, 'notarized': False,
                'file': name, 'bytes': dest.stat().st_size, 'sha256': digest(dest), 'checks': checks}
    (output / f'{platform}.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
