"""Inspect an unchanged signed candidate in a disposable, network-blocked user.

This probes the installed WebKit UI/IPC control path, not upgrade acceptance.
"""
import json
from signed_candidate_identity import PAIR
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error

assert sys.platform == 'linux'
assert os.environ.get('GITHUB_REPOSITORY') == 'AiW520/tuzi-switch'
assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
assert subprocess.check_output(['id', '-un'], text=True).strip() == 'tuziqa'
executable, output = sys.argv[1:]
root = Path(output)
root.mkdir(parents=True, exist_ok=True)
assert not (Path.home() / '.tuzi-switch').exists(), 'Clean disposable profile required'
report = {'kind': 'installed-linux-driver-probe', 'officialAcceptance': False,
          'candidateRunId': PAIR['base']['runId'], 'candidateCommit': PAIR['base']['commit']}
env = {k: v for k, v in os.environ.items() if not any(word in k.upper() for word in ['TOKEN', 'SECRET', 'PASSWORD', 'PRIVATE_KEY'])}
env.update(TAURI_WEBVIEW_AUTOMATION='true', WEBKIT_DISABLE_DMABUF_RENDERER='1', WEBKIT_DISABLE_COMPOSITING_MODE='1')
session = None

def request(method, route, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('http://127.0.0.1:4444' + route, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=75) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # Only the local WebDriver server is reachable here. Preserve its
        # structured reason instead of hiding it behind an HTTP 500 summary.
        raise RuntimeError(f'{method} {route}: {error.read().decode()[:12000]}') from error
    value = result.get('value', result)
    if isinstance(value, dict) and value.get('error'):
        raise RuntimeError(value)
    return value

with (root / 'driver.log').open('w') as log:
    driver = subprocess.Popen(['WebKitWebDriver', '--port=4444'], env=env, stdout=log, stderr=log)
    try:
        for _ in range(100):
            try:
                request('GET', '/status')
                break
            except OSError:
                time.sleep(0.1)
        created = request('POST', '/session', {'capabilities': {'alwaysMatch': {
            'webkitgtk:browserOptions': {'binary': executable, 'args': []}}}})
        session = created['sessionId']
        prefix = '/session/' + session
        request('POST', prefix + '/timeouts', {'script': 30000})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            ready = request('POST', prefix + '/execute/sync', {'script': 'return Boolean(window.__TAURI_INTERNALS__ && document.body)', 'args': []})
            if ready:
                break
            time.sleep(0.2)
        assert ready, 'Actual application document must load before native IPC checks'
        identity = request('POST', prefix + '/execute/async', {'script': '''
const done = arguments[arguments.length - 1];
Promise.all([
  window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
  window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'),
  window.__TAURI_INTERNALS__.invoke('get_update_build_info')
]).then(([version, identifier, build]) => done({version, identifier, build}), e => done({error:String(e)}));
''', 'args': []})
        report['identity'] = identity
        assert identity['version'] == '1.6.2'
        assert identity['identifier'] == 'com.tuziswitch.desktop'
        assert identity['build']['repository'] == 'tuziapi/tuzi-switch'
        assert identity['build']['channel'] == 'stable'
        assert identity['build']['commit'] == report['candidateCommit']
        report['ui'] = request('POST', prefix + '/execute/sync', {'script': 'return document.body.innerText', 'args': []})
        # Capture the actual X display; WebKit's screenshot endpoint can stall
        # even while the installed app's DOM and native IPC remain responsive.
        subprocess.run(['import', '-window', 'root', str(root/'installed.png')], check=True, timeout=20)
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        if session:
            try:
                request('DELETE', '/session/' + session)
            except Exception as error:
                report['sessionCleanupError'] = str(error)
        driver.terminate()
        try:
            driver.wait(timeout=10)
        except subprocess.TimeoutExpired:
            driver.kill()
            driver.wait()
        (root / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
