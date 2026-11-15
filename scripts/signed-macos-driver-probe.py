"""Probe actual unchanged macOS candidate UI on a disposable hosted runner."""
import hashlib
import json
from signed_candidate_identity import PAIR
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import time

assert sys.platform == 'darwin'
assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('GITHUB_REPOSITORY') == 'AiW520/tuzi-switch'
assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
source, output = map(Path, sys.argv[1:3])
platform = sys.argv[3]
assert platform in ['macos-arm64', 'macos-x64']
assert not (Path.home()/'.tuzi-switch').exists(), 'Disposable clean application profile required'
output.mkdir(parents=True, exist_ok=True)
report = dict(kind='installed-macos-control-probe', officialAcceptance=False,
              candidateRunId=PAIR['base']['runId'], candidateCommit=PAIR['base']['commit'], platform=platform)
mount = process = None
try:
    m = json.loads((source/f'manifest-{platform}.json').read_text())
    assert m['commit'] == report['candidateCommit'] and m['version'] == '1.6.2'
    dmg = source/f'tuzi-assistant-{platform}.dmg'
    entry = next(f for f in m['files'] if f['file'] == dmg.name)
    assert hashlib.sha256(dmg.read_bytes()).hexdigest() == entry['sha256']
    mounted = plistlib.loads(subprocess.check_output(['hdiutil','attach','-readonly','-nobrowse','-plist',str(dmg)]))
    mounts = [e['mount-point'] for e in mounted['system-entities'] if 'mount-point' in e]
    assert len(mounts) == 1
    mount = mounts[0]
    apps = list(Path(mount).glob('*.app')); assert len(apps) == 1
    app = output.parent/apps[0].name
    assert not app.exists()
    subprocess.run(['ditto', str(apps[0]), str(app)], check=True)
    subprocess.run(['hdiutil','detach',mount],check=True,stdout=subprocess.DEVNULL)
    mount = None
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    assert info['CFBundleIdentifier']=='com.tuziswitch.desktop' and info['CFBundleShortVersionString']=='1.6.2'
    executable = app/'Contents/MacOS'/info['CFBundleExecutable']
    report['architecture'] = subprocess.check_output(['lipo','-archs',str(executable)],text=True).strip()
    assert report['architecture'] == ('arm64' if platform=='macos-arm64' else 'x86_64')
    assert subprocess.check_output(['uname','-m'],text=True).strip() == report['architecture']
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True,capture_output=True)
    report['executableSha256'] = hashlib.sha256(executable.read_bytes()).hexdigest()
    sandbox = output.parent/'network.sb'
    sandbox.write_text('(version 1)\n(allow default)\n(deny network*)\n')
    app_env = {k:v for k,v in os.environ.items() if not any(w in k.upper() for w in ['TOKEN','SECRET','PASSWORD','PRIVATE_KEY'])}
    with (output/'application.log').open('w') as log:
        process = subprocess.Popen(['sandbox-exec','-f',str(sandbox),str(executable)],env=app_env,stdout=log,stderr=log)
        time.sleep(8)
        assert process.poll() is None, 'Installed app exited before UI inspection'
        report['pid'] = process.pid
        probe = subprocess.run(['osascript','-e','tell application "System Events" to get UI elements enabled'],capture_output=True,text=True,timeout=25)
        report['accessibilityProbe'] = dict(returncode=probe.returncode,stdout=probe.stdout.strip(),stderr=probe.stderr.strip())
        capture = subprocess.run(['screencapture','-x',str(output/'installed.png')],capture_output=True,text=True,timeout=25)
        report['screenCapture'] = dict(returncode=capture.returncode,stderr=capture.stderr.strip())
        if probe.returncode == 0 and probe.stdout.strip() == 'true':
            script = f'''tell application "System Events"
set p to first application process whose unix id is {process.pid}
set frontmost of p to true
return entire contents of front window of p
end tell'''
            tree = subprocess.run(['osascript','-e',script],capture_output=True,text=True,timeout=30)
            report['accessibilityTree'] = dict(returncode=tree.returncode,stdout=tree.stdout[:30000],stderr=tree.stderr.strip())
            report['probeStatus'] = 'ui-control-available' if tree.returncode == 0 and tree.stdout.strip() else 'ui-control-blocked'
        else:
            report['probeStatus'] = 'ui-control-blocked'
        report['unchangedAfterLaunch'] = hashlib.sha256(executable.read_bytes()).hexdigest() == report['executableSha256']
        assert report['unchangedAfterLaunch']
except Exception as error:
    report['probeStatus'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
        report['cleanupExitCode'] = process.returncode
    if mount:
        subprocess.run(['hdiutil','detach',mount],check=False,stdout=subprocess.DEVNULL)
    (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
