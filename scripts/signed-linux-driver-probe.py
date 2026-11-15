"""Inspect an unchanged signed candidate in a disposable, network-blocked user.

This probes the installed WebKit UI/IPC control path, not upgrade acceptance.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

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
          'candidateRunId': '43680220045', 'candidateCommit': '11b8e308ef77708df3526a7701d106fc04b15f57'}
env = {k: v for k, v in os.environ.items() if not any(word in k.upper() for word in ['TOKEN', 'SECRET', 'PASSWORD', 'PRIVATE_KEY'])}
env.update(TAURI_WEBVIEW_AUTOMATION='true', WEBKIT_DISABLE_DMABUF_RENDERER='1', WEBKIT_DISABLE_COMPOSITING_MODE='1')
session = None

def request(method, route, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('http://127.0.0.1:4444' + route, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=75) as response:
        result = json.load(response)
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
            'browserName': 'MiniBrowser', 'webkitgtk:browserOptions': {'binary': executable}}}})
        session = created['sessionId']
        prefix = '/session/' + session
        request('POST', prefix + '/timeouts', {'script': 30000})
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
        (root / 'installed.png').write_bytes(base64.b64decode(request('GET', prefix + '/screenshot')))
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
