"""Exercise unchanged signed Linux bytes through the actual installed WebKit UI.

Only runs as root on the disposable test-repository runner. The app remains an
unprivileged, network-blocked user. Discovery/TLS are local; signatures and the
package manager are real. This is a subset, never a release acceptance record.
"""
import hashlib
from signed_candidate_identity import verify_candidate
from signed_creative_webdriver import CreativeChecks, MODEL45, MODEL55, model_response
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, parse_qs

assert sys.platform == 'linux' and os.geteuid() == 0
assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('GITHUB_REPOSITORY') == 'AiW520/tuzi-switch'
assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
base_dir, target_dir, output = map(Path, sys.argv[1:4])
installer = sys.argv[4] if len(sys.argv) > 4 else 'deb'
assert installer in ['deb', 'appimage', 'rpm']
legacy_dir = Path(os.environ['LEGACY_INSTALLER_DIR']) if os.environ.get('LEGACY_INSTALLER_DIR') else None
legacy_version = os.environ.get('LEGACY_VERSION', '1.6.1')
legacy = None
legacy_sources = {
    '1.6.0': ('a32d0a5766cc6a8d0e9f0c84258db29b7ce5b747e771844816730e296ab0c0c2', '21cad50c7f5b916b94bccf39c6d594724241bfb1'),
    '1.6.1': ('a9a621811b3b52c7bb9d61bd070f5666ae72a04bbdbc955fa6005fcf3dc52cc2', '7c13bc943a4b7116af15593ec0ac18af0ba9727f'),
}
base = json.loads((base_dir / 'candidate.json').read_text())
target = json.loads((target_dir / 'candidate.json').read_text())
verify_candidate(base, 'base')
verify_candidate(target, 'target')
for directory, candidate in [(base_dir, base), (target_dir, target)]:
    assert candidate['releaseRepository'] == 'tuziapi/tuzi-switch'
    for name, digest in candidate['files'].items():
        assert Path(name).name == name
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest
output.mkdir(parents=True, exist_ok=True)
lab = output.parent
username = 'tuziupgrade'
uid = int(subprocess.check_output(['id', '-u', username]))
gid = int(subprocess.check_output(['id', '-g', username]))
assert not (Path('/home') / username / '.tuzi-switch').exists(), 'Fresh disposable user required'
executable = lab/'installed'/'Tuzi.AppImage' if installer == 'appimage' else Path('/usr/bin/tu-zi-switch')
asset = 'tuzi-assistant-linux-x64.' + ('AppImage' if installer == 'appimage' else installer)
if legacy_dir:
    assert legacy_version in legacy_sources
    manifest = (legacy_dir/'manifest-linux-x64.json').read_bytes()
    assert hashlib.sha256(manifest).hexdigest() == legacy_sources[legacy_version][0]
    legacy = json.loads(manifest)
    assert legacy['repository'] == 'tuziapi/tuzi-switch'
    assert legacy['version'] == legacy_version and legacy['commit'] == legacy_sources[legacy_version][1]
    entry = next(f for f in legacy['files'] if f['file'] == asset)
    assert hashlib.sha256((legacy_dir/asset).read_bytes()).hexdigest() == entry['sha256']
if installer == 'appimage':
    executable.parent.mkdir()
    shutil.copyfile((legacy_dir or base_dir)/asset, executable)
    executable.chmod(0o755)
    executable.parent.chmod(0o555)
report = dict(kind='real-installed-linux-subset', officialAcceptance=False, installerType=installer,
              discovery='synthetic-local-https', signingKey='new-official-channel-key',
              base=base, target=target, checks={}, requests=[], remaining=[
                  'published-old-version-manual-transition', 'creative-project-migration',
                  'business-attribution', 'reviewed-cross-platform-acceptance'])
mode = 'normal'
active_version = 'not-started'
report['creativeRequests'] = []
server = driver = session = None
hosts = Path('/etc/hosts')
original_hosts = hosts.read_bytes()
trust = Path('/etc/pki/ca-trust/source/anchors/tuzi-signed-upgrade.crt') if installer == 'rpm' else Path('/usr/local/share/ca-certificates/tuzi-signed-upgrade.crt')
refresh_trust = ['update-ca-trust', 'extract'] if installer == 'rpm' else ['update-ca-certificates']
sudoers = Path('/etc/sudoers.d/tuzi-signed-upgrade')
assert not trust.exists() and not sudoers.exists()


def digest_executable():
    return hashlib.sha256(executable.read_bytes()).hexdigest()


def application_processes():
    found = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        selected = False
        try:
            # /proc directory ownership can become root for non-dumpable
            # processes; the actual effective UID is recorded in status.
            uids = re.search(r'^Uid:\s+(\d+)\s+(\d+)', (proc/'status').read_text(), re.MULTILINE)
            if not uids or int(uids.group(2)) != uid:
                continue
            selected = True
            process_exe = str((proc/'exe').readlink()).removesuffix(' (deleted)')
            if installer != 'appimage' and process_exe == str(executable.resolve()):
                found.append(int(proc.name))
            elif installer == 'appimage' and Path(process_exe).name == 'tu-zi-switch':
                process_environment = (proc/'environ').read_bytes().split(b'\0')
                if ('APPIMAGE=' + str(executable)).encode() in process_environment:
                    found.append(int(proc.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError) as error:
            if selected:
                report.setdefault('processInspectionErrors', {})[proc.name] = str(error)
    return found


def wait_for(fn, message, seconds=60):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            result = fn()
            if result:
                return result
        except (OSError, RuntimeError) as error:
            last = str(error)
        time.sleep(0.3)
    raise AssertionError(f'{message}; last={last}')


def request(method, route, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('http://127.0.0.1:4444' + route, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{method} {route}: {error.read().decode()[:5000]}') from error
    value = result.get('value', result)
    if isinstance(value, dict) and value.get('error'):
        raise RuntimeError(value)
    return value


def execute(script, async_=False, args=None):
    return request('POST', '/session/' + session + '/execute/' + ('async' if async_ else 'sync'),
                   {'script': script, 'args': args or []})


def element_action(element, value):
    key='element-6066-11e4-a52e-4f735466cecf'
    assert key in element, 'Actual WebDriver element reference required'
    execute("arguments[0].scrollIntoView({block:'center',inline:'center',behavior:'instant'}); return true;",args=[element])
    previous=None
    stable_samples=0
    def stable():
        nonlocal previous,stable_samples
        box=execute('''const e=arguments[0],r=e.getBoundingClientRect();
const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
return e.isConnected && (hit===e || e.contains(hit)) ? [r.x,r.y,r.width,r.height] : null;''', args=[element])
        stable_samples=stable_samples+1 if box and box==previous else 0
        previous=box
        return stable_samples>=3
    # Unlike Playwright, WebKitWebDriver does not wait for the host's arrival
    # animation. A click during that transform can hit the neighboring tab.
    wait_for(stable,'Native control did not become stable and unobscured',30)
    route='/session/'+session+'/element/'+element[key]
    if value is None:
        request('POST', route+'/click', {})
    else:
        request('POST', route+'/clear', {})
        request('POST', route+'/value', {'text': value})


def attach(address=None):
    global session
    options = {'binary': str(executable), 'args': []}
    if address:
        options['targetAddress'] = address
    result = request('POST', '/session', {'capabilities': {'alwaysMatch': {'webkitgtk:browserOptions': options}}})
    session = result['sessionId']
    request('POST', '/session/' + session + '/timeouts', {'script': 30000})
    wait_for(lambda: execute('return Boolean(window.__TAURI_INTERNALS__ && document.body)'), 'Actual app document not ready')


def identity(version, commit):
    result = execute('''const done=arguments[arguments.length-1]; Promise.all([
window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'),
window.__TAURI_INTERNALS__.invoke('get_update_build_info')
]).then(([version,identifier,build])=>done({version,identifier,build}),e=>done({error:String(e)}));''', True)
    assert result['version'] == version and result['identifier'] == 'com.tuziswitch.desktop', result
    assert result['build']['commit'] == commit and result['build']['repository'] == 'tuziapi/tuzi-switch', result
    assert result['build']['channel'] == 'stable', result
    return result


def buttons(names, click=False):
    return execute('''const names=arguments[0],click=arguments[1];
const button=[...document.querySelectorAll('button')].find(e=>names.includes(e.textContent.trim()) && e.getClientRects().length && !e.disabled);
if(button && click) button.click(); return Boolean(button);''', args=[names, click])


def click(names, seconds=60):
    wait_for(lambda: buttons(names), 'Visible enabled button missing: ' + str(names), seconds)
    assert buttons(names, True)


def screenshot(name):
    # WebKit's screenshot request timed out in the first two runs despite
    # responsive DOM/IPC. Capture the actual disposable X display instead.
    pids = application_processes()
    assert len(pids) == 1
    environment = dict(v.split(b'=', 1) for v in Path('/proc/' + str(pids[0]) + '/environ').read_bytes().split(b'\0') if b'=' in v)
    capture_env = {key: environment[key.encode()].decode() for key in ['DISPLAY', 'XAUTHORITY'] if key.encode() in environment}
    assert 'DISPLAY' in capture_env
    subprocess.run(['/usr/bin/import', '-window', 'root', str(output / (name + '.png'))],
                   env={'PATH': '/usr/bin:/bin', **capture_env}, check=True, timeout=20)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        # Match the public GitHub API's cross-origin response, just as the
        # Windows fixture does. The installed renderer performs discovery.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Accept,Content-Type,Cache-Control')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def creative(self):
        url = urlsplit(self.path)
        try:
            if url.path == '/api/status':
                assert self.command == 'GET' and not self.headers.get('Authorization')
                result = {'success': True, 'data': {'system_name': 'SYNTHETIC local status'}}
            else:
                assert self.headers.get('Authorization') == 'Bearer sk-SYNTHETIC-GENERATION'
                if url.path == '/v1/models':
                    assert self.command == 'GET' and 'ch' not in parse_qs(url.query)
                    result = {'data': [dict(id=id, supported_endpoint_types=['image-generation'],
                                           endpoints={'image-generation': {'path': '/v1/images/generations', 'method': 'POST'}})
                                       for id in [MODEL45, MODEL55]]}
                else:
                    assert self.command == 'POST' and url.path == '/v1/images/generations'
                    length = int(self.headers.get('Content-Length', '0'))
                    assert 0 < length < 1024 * 1024
                    body = json.loads(self.rfile.read(length))
                    channels = parse_qs(url.query).get('ch', [])
                    if active_version in ['1.6.2', '1.6.3']:
                        assert channels == ['3'], 'Official native generation must carry ch=3 exactly once'
                    result = model_response(body)
                    report['creativeRequests'].append(dict(version=active_version, model=body['model'],
                        channels=channels, layers=bool(body.get('layer_decomposition_options')), syntheticAuthorizationMatched=True))
            content = json.dumps(result).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers(); self.wfile.write(content)
        except Exception as error:
            report.setdefault('creativeServerErrors', []).append(str(error))
            self.send_error(500, 'Synthetic fixture rejected native request')

    def do_POST(self):
        if self.headers.get('Host', '').split(':')[0] == 'api.tu-zi.com':
            self.creative()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.headers.get('Host', '').split(':')[0] == 'api.tu-zi.com':
            self.creative()
            return
        self.path = urlsplit(self.path).path
        host = self.headers.get('Host', '').split(':')[0]
        report['requests'].append(dict(host=host, path=self.path, mode=mode))
        if host == 'api.github.com' and self.path == '/repos/tuziapi/tuzi-switch/releases/latest':
            release = dict(tag_name=target['tag'], draft=False, prerelease=False,
                           html_url='https://github.com/tuziapi/tuzi-switch/releases/tag/' + target['tag'],
                           published_at='2026-11-15T00:00:00Z', body='SYNTHETIC discovery for signed ' + installer + ' testing',
                           assets=[dict(name=name, state='uploaded', size=(target_dir/name).stat().st_size,
                                        digest='sha256:' + digest,
                                        browser_download_url='https://github.com/tuziapi/tuzi-switch/releases/download/' + target['tag'] + '/' + name)
                                   for name, digest in target['files'].items()])
            content = json.dumps(release).encode()
        elif host == 'github.com' and self.path == '/tuziapi/tuzi-switch/releases/latest/download/latest.json':
            content = (target_dir / 'latest.json').read_bytes()
        elif host == 'github.com' and self.path == '/tuziapi/tuzi-switch/releases/download/' + target['tag'] + '/' + asset:
            if mode == 'missing':
                self.send_error(404)
                return
            content = (target_dir / asset).read_bytes()
            if mode == 'corrupt':
                content += b'SYNTHETIC TAMPER'
            elif mode == 'interrupted':
                self.send_response(200)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content[:1024])
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_RDWR)
                self.close_connection = True
                return
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if self.path.endswith('json') or host == 'api.github.com' else 'application/octet-stream')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)


fixture = dict(id='SYNTHETIC-SIGNED-LINUX', name='SYNTHETIC Linux preserved provider',
               settingsConfig={'env': {'ANTHROPIC_AUTH_TOKEN': 'SYNTHETIC-NO-REAL-CREDENTIAL',
                                        'ANTHROPIC_BASE_URL': 'https://synthetic.invalid'}})


def seed():
    seeded = execute('''const provider=arguments[0],done=arguments[arguments.length-1];
window.__TAURI_INTERNALS__.invoke('add_provider',{app:'claude',provider,addToLive:false}).then(()=>{
localStorage.setItem('SYNTHETIC-SIGNED-LINUX','preserve-me');done(true)},e=>done({error:String(e)}));''', True, [fixture])
    assert seeded is True


def assert_preserved():
    preserved = execute('''const done=arguments[arguments.length-1];
window.__TAURI_INTERNALS__.invoke('get_providers',{app:'claude'}).then(providers=>done({providers,
preference:localStorage.getItem('SYNTHETIC-SIGNED-LINUX')}),e=>done({error:String(e)}));''', True)
    assert preserved['providers'][fixture['id']]['settingsConfig'] == fixture['settingsConfig']
    assert preserved['providers'][fixture['id']]['name'] == fixture['name']
    assert preserved['preference'] == 'preserve-me'


def manual_install(directory, old=False):
    if installer == 'appimage':
        shutil.copyfile(directory/asset, executable)
        executable.chmod(0o755)
    else:
        command = ['rpm', '-U'] + (['--oldpackage'] if old else []) if installer == 'rpm' else ['dpkg', '-i']
        subprocess.run([*command, str(directory/asset)], check=True)


try:
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-keyout', str(lab/'ca.key'), '-out', str(trust), '-subj', '/CN=SYNTHETIC Tuzi update lab CA',
                    '-addext', 'basicConstraints=critical,CA:TRUE'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(lab/'tls.key'),
                    '-out', str(lab/'tls.csr'), '-subj', '/CN=github.com'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (lab/'tls.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:github.com,DNS:api.github.com,DNS:api.tu-zi.com\n')
    subprocess.run(['openssl', 'x509', '-req', '-in', str(lab/'tls.csr'), '-CA', str(trust),
                    '-CAkey', str(lab/'ca.key'), '-CAserial', str(lab/'ca.srl'), '-CAcreateserial',
                    '-out', str(lab/'tls.crt'), '-days', '1', '-sha256', '-extfile', str(lab/'tls.ext')],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (lab/'ca.key').chmod(0o600)
    (lab/'tls.key').chmod(0o600)
    subprocess.run(refresh_trust, check=True, stdout=subprocess.DEVNULL)
    hosts.write_bytes(original_hosts + b'\n127.0.0.1 github.com api.github.com api.tu-zi.com\n')
    server = ThreadingHTTPServer(('127.0.0.1', 443), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(lab/'tls.crt'), str(lab/'tls.key'))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # No application/IPC overrides or insecure TLS flags. Only documented WebKit automation.
    app_env = ['TAURI_WEBVIEW_AUTOMATION=true', 'WEBKIT_DISABLE_DMABUF_RENDERER=1',
               'WEBKIT_DISABLE_COMPOSITING_MODE=1', 'XDG_RUNTIME_DIR=' + str(lab/'runtime')]
    if installer == 'appimage':
        app_env.append('APPIMAGE_EXTRACT_AND_RUN=1')
    log = (output/'driver.log').open('w')
    driver_binary = shutil.which('WebKitWebDriver')
    if not driver_binary:
        matches = list(Path('/usr/libexec').rglob('WebKitWebDriver'))
        assert len(matches) == 1, 'Exactly one installed WebKit driver is required'
        driver_binary = str(matches[0])
    display_command = ['xvfb-run', '-a', 'dbus-run-session', '--', driver_binary, '--port=4444']
    if installer == 'rpm':
        subprocess.Popen(['sudo', '-H', '-u', username, 'Xvfb', ':99', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-ac'], stdout=log, stderr=log)
        wait_for(lambda: Path('/tmp/.X11-unix/X99').exists(), 'Disposable Fedora display did not start')
        app_env.append('DISPLAY=:99')
        display_command = ['dbus-run-session', '--', driver_binary, '--port=4444']
    driver = subprocess.Popen(['sudo', '-H', '-u', username, 'env', '-i', 'HOME=/home/' + username,
                              'USER=' + username, 'PATH=/usr/bin:/bin', *app_env,
                              *display_command],
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    wait_for(lambda: request('GET', '/status'), 'WebKitWebDriver not listening')
    creative = CreativeChecks(execute, screenshot, element_action)
    if legacy_dir:
        active_version = legacy_version
        manual_install(legacy_dir, old=True)
        attach()
        report['legacy'] = legacy
        report['legacyIdentity'] = identity(legacy_version, legacy['commit'])
        legacy_pids = application_processes()
        assert len(legacy_pids) == 1
        report['legacyPid'] = legacy_pids[0]
        report['legacyExecutableSha256'] = digest_executable()
        click(['我知道了', 'Got it'])
        seed()
        assert_preserved()
        legacy_creative = creative.create()
        creative.leave()
        screenshot('00-published-legacy-before-transition')
        settings_saved = execute('''const done=arguments[arguments.length-1];
window.__TAURI_INTERNALS__.invoke('get_settings').then(settings=>window.__TAURI_INTERNALS__.invoke('save_settings',
{settings:{...settings,minimizeToTrayOnClose:false}})).then(()=>done(true),e=>done({error:String(e)}));''', True)
        assert settings_saved is True
        try:
            execute("window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}); return true")
        except (OSError, RuntimeError):
            pass
        wait_for(lambda: not any(p in application_processes() for p in legacy_pids), 'Published old app failed to close normally')
        report['legacyCloseMethod'] = 'ordinary-window-close-with-minimize-to-tray-disabled; process disappearance observed; exit code not exposed by WebDriver'
        try:
            request('DELETE', '/session/' + session)
        except (OSError, RuntimeError):
            pass
        session = None
        manual_install(base_dir)
    active_version = '1.6.2'
    attach()
    report['baseIdentity'] = identity('1.6.2', base['commit'])
    initial_pids = application_processes()
    assert len(initial_pids) == 1, initial_pids
    report['initialPid'] = initial_pids[0]
    process_env = Path('/proc/' + str(initial_pids[0]) + '/environ').read_bytes().split(b'\0')
    inspector = next(v.split(b'=', 1)[1].decode() for v in process_env if v.startswith(b'WEBKIT_INSPECTOR_SERVER='))
    report['inspectorAddress'] = inspector
    before_hash = digest_executable()
    report['initialExecutableSha256'] = before_hash
    if legacy_dir:
        assert_preserved()
        assert not buttons(['我知道了', 'Got it'])
        assert report['legacyExecutableSha256'] != before_hash
        report['checks']['publishedLegacyManualTransition'] = 'passed'
        report['remaining'].remove('published-old-version-manual-transition')
        creative.preserved(legacy_creative, 'manual-transition')
        report['checks']['legacyCreativeImageTaskPreservation'] = 'passed'
    else:
        click(['我知道了', 'Got it'])
        seed()
    current_creative = creative.create(current=True)
    report['checks']['nativeSeedream55Synthetic'] = 'passed'
    creative.leave()
    # The header notice is persistent even after the initial toast expires.
    wait_for(lambda: execute('''const names=['检测到新版本：1.6.3','New version available: 1.6.3'];
const e=[...document.querySelectorAll('button')].find(e=>e.getClientRects().length && names.includes(e.getAttribute('aria-label')));
if(e)e.click();return Boolean(e);'''), 'Persistent update control missing')
    screenshot('01-update-dialog')
    for failure in ['corrupt', 'interrupted', 'missing']:
        mode = failure
        click(['下载更新', '重新下载'])
        wait_for(lambda: buttons(['重新下载']), failure + ' must be rejected', 90)
        assert any(r['path'].endswith(asset) and r['mode'] == failure for r in report['requests'])
        assert digest_executable() == before_hash
        identity('1.6.2', base['commit'])
        assert not buttons(['重启并更新'])
        report['checks'][failure] = 'passed'
        screenshot('02-' + failure)
    mode = 'normal'
    click(['重新下载'])
    wait_for(lambda: buttons(['重启并更新']), 'Native signature did not verify', 120)
    screenshot('03-signature-verified')
    # Valid signed package, actual denied OS privileges. No invalid-format substitute.
    if installer == 'appimage':
        assert subprocess.run(['sudo', '-u', username, 'test', '-w', str(executable.parent)]).returncode != 0
    click(['重启并更新'])
    wait_for(lambda: buttons(['重新下载']), 'Expected package-manager permission failure', 60)
    assert digest_executable() == before_hash
    identity('1.6.2', base['commit'])
    if installer != 'appimage':
        permission_diagnostics = (output/'driver.log').read_text(errors='replace')
        denial = re.findall(r'[^\n]*(?:not in the sudoers|a password is required|a terminal is required|no tty present|No authentication agent)[^\n]*', permission_diagnostics, flags=re.IGNORECASE)
        assert denial, 'Installation rejection must include actual OS authorization diagnostics'
        report['installPermissionDiagnostics'] = denial
    else:
        report['installPermissionDiagnostics'] = ['Root-owned directory mode 0555; actual unprivileged test -w was denied; signed bytes and running old process remained unchanged.']
    report['checks']['validPackageInstallPermissionDenied'] = 'passed'
    screenshot('04-install-permission-denied')
    # Grant only the real updater dpkg command on this disposable user/VM, then retry.
    if installer != 'appimage':
        package_command = '/usr/bin/rpm -U' if installer == 'rpm' else '/usr/bin/dpkg -i'
        sudoers.write_text(username + ' ALL=(root) NOPASSWD: ' + package_command + ' /tmp/tauri_rpm_update*/package.rpm\n')
        sudoers.chmod(0o440)
        subprocess.run(['visudo', '-cf', str(sudoers)], check=True, stdout=subprocess.DEVNULL)
    else:
        os.chown(executable.parent, uid, gid)
        executable.parent.chmod(0o755)
        assert subprocess.run(['sudo', '-u', username, 'test', '-w', str(executable.parent)]).returncode == 0
    click(['重新下载'])
    wait_for(lambda: buttons(['重启并更新']), 'Retry signature did not verify', 120)
    click(['重启并更新'])
    # From this point there is deliberately no app launch. Observe the updater's restart.
    next_pids = wait_for(lambda: [p for p in application_processes() if p not in initial_pids], 'No automatic restarted process', 120)
    assert digest_executable() != before_hash
    report['restartedPids'] = next_pids
    wait_for(lambda: not any(p in application_processes() for p in initial_pids), 'Old process did not exit')
    try:
        request('DELETE', '/session/' + session)
    except RuntimeError:
        pass
    session = None
    attach(inspector)
    report['targetIdentity'] = identity('1.6.3', target['commit'])
    active_version = '1.6.3'
    assert_preserved()
    report['finalExecutableSha256'] = digest_executable()
    if installer == 'appimage':
        assert report['initialExecutableSha256'] == base['files'][asset]
        assert report['finalExecutableSha256'] == target['files'][asset]
    report['checks'].update({k: 'passed' for k in ['download', 'nativeSignature', 'install', 'automaticRestart', 'version', 'sqliteProviderAndWebviewPreference', 'sameInstallationRetry']})
    screenshot('05-automatically-restarted')
    creative.preserved(current_creative, 'signed-upgrade')
    assert len([r for r in report['creativeRequests'] if r['version'] == '1.6.2']) == 2
    report['creativeAfterUpgrade'] = creative.create()
    assert any(record['version'] == '1.6.3' and record['channels'] == ['3'] for record in report['creativeRequests'])
    report['checks']['targetNativeBusinessAttribution'] = 'passed'
    assert not report.get('creativeServerErrors')
    report['checks']['creativeImageLayerOcrTaskPreservation'] = 'passed'
    report['checks']['installedDesktopAttributionSynthetic'] = 'passed'
    report['creativeScope'] = 'Installed UI, native HTTP, persisted images/layers/OCR/tasks and exact pixels; synthetic provider. No production billing claim.'
    report['subsetStatus'] = 'passed'
except Exception as error:
    report['subsetStatus'] = 'failed'
    report['error'] = str(error)
    if session:
        try:
            report['failureUi'] = execute('return document.body.innerText')
            report['nativeCheckDiagnostic'] = execute('''const done=arguments[arguments.length-1];
window.__TAURI_INTERNALS__.invoke('plugin:updater|check',{timeout:10000}).then(result=>done({result}),e=>done({error:String(e)}));''', True)
            screenshot('failure')
        except Exception as diagnostic:
            report['diagnosticError'] = str(diagnostic)
    raise
finally:
    # Keep the original failure evidence even if a minimal image lacks a
    # cleanup utility. The disposable container is also removed by Docker.
    (output/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if installer == 'deb':
        package_owner = subprocess.run(['dpkg-query', '-S', str(executable)], capture_output=True, text=True).stdout.strip()
        report['installedPackageOwner'] = package_owner
        if package_owner:
            report['finalPackageVersion'] = subprocess.run(['dpkg-query', '-W', '-f=${Version}', package_owner.split(': ')[0]], capture_output=True, text=True).stdout
    elif installer == 'rpm':
        report['installedPackageOwner'] = subprocess.run(['rpm', '-qf', str(executable)], capture_output=True, text=True).stdout.strip()
        report['finalPackageVersion'] = subprocess.run(['rpm', '-qf', str(executable), '--qf', '%{VERSION}'], capture_output=True, text=True).stdout
    if server:
        server.shutdown()
        server.server_close()
    subprocess.run(['pkill', '-u', username], check=False)
    if driver:
        try:
            driver.wait(timeout=15)
        except subprocess.TimeoutExpired:
            driver.kill()
            driver.wait()
    hosts.write_bytes(original_hosts)
    trust.unlink(missing_ok=True)
    sudoers.unlink(missing_ok=True)
    subprocess.run(refresh_trust, stdout=subprocess.DEVNULL, check=False)
    (output/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
