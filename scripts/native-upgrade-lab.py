"""Real desktop app replacement/restart with ephemeral signatures and synthetic data.

This is a native smoke test, NOT acceptance of official signed release bytes.
No private key, application, or data from an existing installation is used.
"""
import argparse
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def command(args, env, log):
    with log.open('ab') as out:
        subprocess.run(args, cwd=ROOT, env=env, stdout=out, stderr=out, check=True)


def remove_msi_fixture(package, env, log):
    # Only the isolated QA package is removed, on a disposable hosted runner.
    with log.open('ab') as out:
        result = subprocess.run(['msiexec', '/x', str(package), '/qn', '/norestart'],
                                env=env, stdout=out, stderr=out)
    if result.returncode not in (0, 1605, 1614):
        raise RuntimeError(f'QA MSI uninstall failed: {result.returncode}')


def process_alive(pid):
    if sys.platform == 'win32':
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x00100000, False, pid)
        if not handle:
            return False
        try:
            return kernel.WaitForSingleObject(handle, 0) == 258
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        if sys.platform == 'linux':
            stat = Path(f'/proc/{pid}/stat')
            if stat.exists() and stat.read_text().split(') ')[1].startswith('Z'):
                return False
        return True
    except ProcessLookupError:
        return False


def failure_diagnostics(case, process, executable, before_hash, events):
    """Capture only laboratory process/file state, never credentials or env."""
    report = {
        'launcherPid': process.pid,
        'launcherExitCode': process.poll(),
        'observedProcesses': [
            {'pid': pid, 'alive': process_alive(pid)}
            for pid in sorted({e['detail']['pid'] for e in events
                               if e['event'] == 'started' and 'pid' in e['detail']})
        ],
        'executableExists': executable.exists(),
        'beforeSha256': before_hash,
    }
    try:
        report['afterSha256'] = hashlib.sha256(executable.read_bytes()).hexdigest()
    except OSError as error:
        report['executableReadError'] = str(error)
    if sys.platform == 'win32':
        # Restrict the inventory to the laboratory app/installer and descendants.
        # Command lines and environment are deliberately excluded.
        script = r'''
$all = @(Get-CimInstance Win32_Process)
$selected = @($all | Where-Object {
  $_.Name -eq 'tu-zi-switch.exe' -or
  $_.ExecutablePath -like '*tuzi-upgrade-lab*' -or
  $_.ExecutablePath -like '*tauri-updater*'
})
do {
  $ids = @($selected.ProcessId)
  $children = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids })
  $selected += $children
} while ($children.Count -gt 0)
@($selected | ForEach-Object {
  $proc = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  [PSCustomObject]@{pid=$_.ProcessId; parentPid=$_.ParentProcessId;
    name=$_.Name; executable=$_.ExecutablePath; windowTitle=$proc.MainWindowTitle}
}) | ConvertTo-Json -Depth 3 -Compress
'''
        try:
            completed = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
                                       capture_output=True, text=True, timeout=20, check=True)
            report['windowsProcesses'] = json.loads(completed.stdout or '[]')
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            report['processInspectionError'] = type(error).__name__
    (case / 'failure-diagnostics.json').write_text(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--installer', choices=['app', 'nsis', 'msi', 'appimage', 'deb', 'rpm'])
    options = parser.parse_args()
    platform = {'darwin': 'macos', 'win32': 'windows', 'linux': 'linux'}.get(sys.platform)
    if not platform:
        raise SystemExit('Unsupported native platform')
    bundle = options.installer or {'macos': 'app', 'windows': 'nsis', 'linux': 'appimage'}[platform]
    if bundle not in {'macos': ['app'], 'windows': ['nsis', 'msi'], 'linux': ['appimage', 'deb', 'rpm']}[platform]:
        raise SystemExit('Installer does not match this operating system')
    if bundle in ('msi', 'deb', 'rpm') and not (
        os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('GITHUB_REPOSITORY') == 'AiW520/tuzi-switch'
    ):
        raise SystemExit('System package experiments require the disposable test-repository runner')
    root = Path(options.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    env = dict(os.environ)
    env.setdefault('CARGO_TARGET_DIR', str(root / 'target'))
    target_dir = Path(env['CARGO_TARGET_DIR'])
    env['APPLE_SIGNING_IDENTITY'] = '-'
    env['APPIMAGE_EXTRACT_AND_RUN'] = '1'
    env['WEBKIT_DISABLE_DMABUF_RENDERER'] = '1'
    env['WEBKIT_DISABLE_COMPOSITING_MODE'] = '1'
    suffix = {'app': '.app', 'nsis': '.exe', 'msi': '.msi', 'appimage': '.AppImage', 'deb': '.deb', 'rpm': '.rpm'}[bundle]
    env['TUZI_SWITCH_RELEASE_REPOSITORY'] = 'tuziapi/tuzi-switch'
    env['VITE_RELEASE_REPOSITORY'] = 'tuziapi/tuzi-switch'
    cli = ['node', str(ROOT / 'node_modules/@tauri-apps/cli/tauri.js')]
    key = root / 'SYNTHETIC.key'
    if not key.exists():
        # CLI prints generated key material; keep output in a private local file.
        command(cli + ['signer', 'generate', '--ci', '-p', '', '-w', str(key)], env, root / 'key-generation.private.log')
        os.chmod(key, 0o600)
        os.chmod(root / 'key-generation.private.log', 0o600)
    pubkey = Path(str(key) + '.pub').read_text().strip()
    for version in ['0.0.1', '0.0.2']:
        saved = root / f'app-{version}{suffix}'
        if options.skip_build:
            if not saved.exists():
                raise SystemExit(f'Missing prebuilt laboratory app: {saved}')
            continue
        config = {
            'productName': 'Tuzi Update QA', 'version': version,
            'identifier': 'com.tuziswitch.desktop.update-qa',
            'build': {'beforeBuildCommand': ''},
            'bundle': {'createUpdaterArtifacts': False, 'windows': {'nsis': {'installMode': 'currentUser'}}},
            'app': {'windows': [{'label': 'main', 'url': 'about:blank', 'visible': False}]},
            'plugins': {'deep-link': {'desktop': {'schemes': ['tuziswitch-update-qa']}},
                        'updater': {'pubkey': pubkey, 'endpoints': [], 'dangerousInsecureTransportProtocol': True}},
        }
        if bundle in ('deb', 'rpm'):
            config['mainBinaryName'] = 'tuzi-update-qa'
        config_file = root / f'config-{version}.json'
        config_file.write_text(json.dumps(config))
        print(f'Building isolated application {version}', flush=True)
        command(cli + ['build', '--features', 'updater-acceptance', '--bundles', bundle, '--config', str(config_file)], env, root / f'build-{version}.log')
        if 'Failed to add bundler type' in (root / f'build-{version}.log').read_text(errors='replace'):
            raise RuntimeError('Native bundle is missing its installer type; refusing fallback-only acceptance')
        if saved.exists():
            raise SystemExit(f'Refusing to overwrite previous test app: {saved}')
        bundles = target_dir / 'release/bundle'
        if platform == 'macos':
            shutil.copytree(bundles / 'macos/Tuzi Update QA.app', saved, symlinks=True)
        else:
            # Both versions share the Cargo cache; select this version explicitly.
            pattern = (f'*_{version}_*-setup.exe' if bundle == 'nsis' else
                       f'*-{version}-*.rpm' if bundle == 'rpm' else f'*_{version}_*{suffix}')
            produced = list((bundles / bundle).glob(pattern))
            if len(produced) != 1:
                raise RuntimeError('Expected exactly one native installer')
            shutil.copy2(produced[0], saved)
    if options.build_only:
        print(f'Built both {bundle} laboratory packages; no installation was tested.', flush=True)
        return
    archive = root / ('update.tar.gz' if platform == 'macos' else f'update{suffix}')
    if platform == 'macos':
        with tarfile.open(archive, 'w:gz') as out:
            out.add(root / 'app-0.0.2.app', arcname='Tuzi Update QA.app')
    else:
        shutil.copy2(root / f'app-0.0.2{suffix}', archive)
    command(cli + ['signer', 'sign', '-f', str(key), '-p', '', str(archive)], env, root / 'sign.log')
    invalid = root / 'invalid.tar.gz'
    invalid.write_bytes(b'SYNTHETIC signed invalid archive')
    command(cli + ['signer', 'sign', '-f', str(key), '-p', '', str(invalid)], env, root / 'sign.log')
    corrupt = root / 'corrupt.tar.gz'
    corrupt.write_bytes(archive.read_bytes() + b'SYNTHETIC TAMPER')

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/interrupted.tar.gz':
                self.send_response(200)
                self.send_header('Content-Length', str(archive.stat().st_size))
                self.end_headers()
                self.wfile.write(archive.read_bytes()[:1024])
                self.wfile.flush()
                self.close_connection = True
                return
            super().do_GET()

        def log_message(self, *args):
            pass
    handler = functools.partial(Handler, directory=str(root))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    target = ('darwin-aarch64' if os.uname().machine == 'arm64' else 'darwin-x86_64') if platform == 'macos' else {'windows': 'windows-x86_64', 'linux': 'linux-x86_64'}[platform]
    results = []
    retry_case = None
    scenarios = [
            ('tampered-signature', 'download-error', corrupt, '0.0.2'),
            ('interrupted-download', 'download-error', root / 'interrupted.tar.gz', '0.0.2'),
            ('missing-package', 'download-error', root / 'absent.tar.gz', '0.0.2'),
            ('install-failure', 'install-error', archive if bundle == 'appimage' else invalid, '0.0.2'),
            ('same-version', 'no-update', archive, '0.0.1'),
            ('downgrade', 'no-update', archive, '0.0.0'),
            ('upgrade-and-restart', 'upgrade', archive, '0.0.2'),
            ('retry-after-signature-rejection', 'upgrade', archive, '0.0.2'),
    ]
    if bundle in ('nsis', 'msi', 'deb', 'rpm'):
        # System package identities have one registered installation. Retry
        # before another scenario resets it; never reinstall the rejected app
        # merely to repair the test's registration state.
        scenarios.insert(1, scenarios.pop())
    try:
        for name, mode, asset, version in scenarios:
            retry = name == 'retry-after-signature-rejection'
            case = retry_case if retry else root / 'runs' / f'{name}-{time.time_ns()}'
            if name == 'tampered-signature':
                retry_case = case
            if retry:
                (case / 'events.jsonl').rename(case / 'rejected-events.jsonl')
                executable = (Path('/usr/bin/tuzi-update-qa') if bundle in ('deb', 'rpm') else
                    next((case / 'Tuzi Update QA.app/Contents/MacOS').iterdir()) if platform == 'macos' else
                    case / 'installed' / ('tu-zi-switch.exe' if platform == 'windows' else 'Tuzi Update QA.AppImage'))
                app = case / 'installed' if platform != 'macos' else case / 'Tuzi Update QA.app'
            else:
                (case / 'home').mkdir(parents=True)
            if not retry and platform == 'macos':
                app = case / 'Tuzi Update QA.app'
                shutil.copytree(root / 'app-0.0.1.app', app, symlinks=True)
                executable = next((app / 'Contents/MacOS').iterdir())
            elif not retry and platform == 'windows':
                app = case / 'installed'
                if bundle == 'msi':
                    for previous in ['0.0.2', '0.0.1']:
                        remove_msi_fixture(root / f'app-{previous}.msi', env, case / 'initial-install.log')
                    command(['msiexec', '/i', str(root / 'app-0.0.1.msi'), '/qn', '/norestart',
                             f'INSTALLDIR={app}'], env, case / 'initial-install.log')
                else:
                    command([str(root / 'app-0.0.1.exe'), '/S', f'/D={app}'], env, case / 'initial-install.log')
                executable = app / 'tu-zi-switch.exe'
            elif not retry and bundle in ('deb', 'rpm'):
                app = Path('/usr/bin')
                executable = app / 'tuzi-update-qa'
                installer = ['sudo', 'dpkg', '-i'] if bundle == 'deb' else ['sudo', 'rpm', '-U', '--oldpackage', '--replacepkgs']
                try:
                    command(installer + [str(root / f'app-0.0.1{suffix}')], env, case / 'initial-install.log')
                except subprocess.CalledProcessError:
                    # Only synthetic package-install diagnostics, never signing output.
                    print((case / 'initial-install.log').read_text(errors='replace'), flush=True)
                    raise
            elif not retry:
                app = case / 'installed'
                app.mkdir()
                executable = app / 'Tuzi Update QA.AppImage'
                shutil.copy2(root / 'app-0.0.1.AppImage', executable)
                executable.chmod(0o755)
                if mode == 'install-error' and bundle == 'appimage':
                    app.chmod(0o555)
            before_hash = hashlib.sha256(executable.read_bytes()).hexdigest()
            signature = Path(str(invalid if asset == invalid else archive) + '.sig').read_text().strip()
            manifest_target = target if platform == 'macos' else f'{target}-{bundle}'
            manifest = {'version': version, 'platforms': {manifest_target: {'url': f'{base}/{asset.name}', 'signature': signature}}}
            manifest_file = root / f'{name}.json'
            manifest_file.write_text(json.dumps(manifest))
            # no-update target differs from the running version, so it cannot be
            # mistaken for the post-restart branch in the native verifier.
            scenario = {'endpoint': f'{base}/{manifest_file.name}', 'version': '0.0.2', 'mode': mode}
            (case / 'scenario.json').write_text(json.dumps(scenario))
            if not retry:
                (case / '.updater-lab-profile').write_bytes(b'SYNTHETIC updater laboratory profile\n')
            launch_env = {**env, 'CC_SWITCH_TEST_HOME': str(case / 'home'), 'TUZI_UPDATER_QA_ROOT': str(case)}
            print(f'Running real native scenario: {name}', flush=True)
            with (case / ('retry-process.log' if retry else 'process.log')).open('wb') as log:
                process = subprocess.Popen([str(executable), '--tuzi-verify-updater-install',
                    f'--tuzi-updater-qa-root={case}'], env=launch_env, stdout=log, stderr=log)
                deadline = time.monotonic() + 180
                events = []
                while time.monotonic() < deadline:
                    event_file = case / 'events.jsonl'
                    if event_file.exists():
                        events = [json.loads(line) for line in event_file.read_text().splitlines() if line.strip()]
                    if any(e['event'] in ('passed', 'failed') for e in events):
                        break
                    time.sleep(0.25)
                terminal = next((e for e in events if e['event'] in ('passed', 'failed')), None)
                if not terminal or terminal['event'] != 'passed':
                    failure_diagnostics(case, process, executable, before_hash, events)
                    if process.poll() is None:
                        process.terminate()
                    raise RuntimeError(f'{name} failed: {terminal}; logs: {case}')
                expected_bundle = {'app': 'Some(App)', 'nsis': 'Some(Nsis)', 'msi': 'Some(Msi)',
                                   'appimage': 'Some(AppImage)', 'deb': 'Some(Deb)', 'rpm': 'Some(Rpm)'}[bundle]
                starts = [e for e in events if e['event'] == 'started']
                if not starts or any(e['detail'].get('bundleType') != expected_bundle for e in starts):
                    raise RuntimeError(f'{name}: installed app did not retain its native installer type')
                if platform == 'windows' and mode == 'upgrade':
                    restored = [e for e in events if e['event'] == 'profile-restored']
                    if len(restored) != 2:
                        raise RuntimeError(f'{name}: original and restarted profiles were not both validated')
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    raise RuntimeError(f'{name}: old process did not exit')
            # AppImage/installer launchers can exit before the restarted application.
            # Wait for every observed native PID, so the next case cannot be
            # swallowed by a still-running single-instance owner.
            pids = {e['detail']['pid'] for e in events if e['event'] == 'started' and 'pid' in e['detail']}
            exit_deadline = time.monotonic() + 30
            while any(process_alive(pid) for pid in pids) and time.monotonic() < exit_deadline:
                time.sleep(0.1)
            if any(process_alive(pid) for pid in pids):
                raise RuntimeError(f'{name}: native application did not exit after reporting success')
            if bundle == 'appimage':
                app.chmod(0o755)
            if mode != 'upgrade' and hashlib.sha256(executable.read_bytes()).hexdigest() != before_hash:
                raise RuntimeError(f'{name}: failed update modified installed executable')
            result = {'scenario': name, 'status': 'passed', 'events': events, 'directory': str(case)}
            results.append(result)
            (root / 'results.json').write_text(json.dumps({'kind': 'isolated-native-smoke', 'platform': target,
                'installerType': bundle, 'signingKey': 'ephemeral-test-key', 'officialAcceptance': False, 'results': results}, indent=2))
        print(f'{len(results)} real native scenarios passed; official channel acceptance remains separate.', flush=True)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
