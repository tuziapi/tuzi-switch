"""Operate unchanged signed Mac candidates via existing Accessibility permission.

Runs only on disposable test-repository hosts. The actual app and its restarted
child inherit a loopback-only sandbox. Discovery is synthetic; packages are not.
"""
import hashlib
from signed_candidate_identity import verify_candidate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import plistlib
import signal
import socket
import ssl
import subprocess
import sys
import tarfile
import time
from urllib.parse import urlsplit

assert sys.platform == 'darwin'
assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('GITHUB_REPOSITORY') == 'AiW520/tuzi-switch'
assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def serve(target_dir, lab, asset):
    assert os.geteuid() == 0
    target = json.loads((target_dir/'candidate.json').read_text())
    verify_candidate(target, 'target')
    (lab/'server.pid').write_text(str(os.getpid()))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Accept,Content-Type,Cache-Control')
            super().end_headers()

        def do_OPTIONS(self):
            self.send_response(204)
            self.end_headers()

        def do_GET(self):
            route = urlsplit(self.path).path
            host = self.headers.get('Host', '').split(':')[0]
            mode = (lab/'mode').read_text().strip()
            with (lab/'requests.jsonl').open('a') as log:
                log.write(json.dumps(dict(host=host, path=route, mode=mode))+'\n')
            if host == 'api.github.com' and route == '/repos/tuziapi/tuzi-switch/releases/latest':
                content = json.dumps(dict(tag_name=target['tag'], draft=False, prerelease=False,
                    html_url='https://github.com/tuziapi/tuzi-switch/releases/tag/'+target['tag'],
                    published_at='2026-11-15T00:00:00Z', body='SYNTHETIC signed Mac upgrade discovery',
                    assets=[dict(name=name, state='uploaded', size=(target_dir/name).stat().st_size,
                        digest='sha256:'+digest,
                        browser_download_url='https://github.com/tuziapi/tuzi-switch/releases/download/'+target['tag']+'/'+name)
                        for name,digest in target['files'].items()])).encode()
            elif host == 'github.com' and route == '/tuziapi/tuzi-switch/releases/latest/download/latest.json':
                content = (target_dir/'latest.json').read_bytes()
            elif host == 'github.com' and route == '/tuziapi/tuzi-switch/releases/download/'+target['tag']+'/'+asset:
                if mode == 'missing':
                    self.send_error(404)
                    return
                content = (target_dir/asset).read_bytes()
                assert sha(content) == target['files'][asset]
                if mode == 'corrupt':
                    content += b'SYNTHETIC TAMPER'
                elif mode == 'interrupted':
                    self.send_response(200)
                    self.send_header('Content-Length',str(len(content)))
                    self.end_headers()
                    self.wfile.write(content[:1024]); self.wfile.flush()
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.close_connection = True
                    return
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type','application/json' if route.endswith('json') or host=='api.github.com' else 'application/octet-stream')
            self.send_header('Content-Length',str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    server = ThreadingHTTPServer(('127.0.0.1',443),Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(lab/'tls.crt'),str(lab/'tls.key'))
    server.socket = context.wrap_socket(server.socket,server_side=True)
    (lab/'server.ready').touch()
    server.serve_forever()


if sys.argv[1] == '--serve':
    serve(Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4])
    sys.exit(0)

assert os.geteuid() != 0
base_dir,target_dir,output = map(Path,sys.argv[1:4])
platform = sys.argv[4]
assert platform in ['macos-arm64','macos-x64']
assert not (Path.home()/'.tuzi-switch').exists(), 'Clean disposable profile required'
output.mkdir(parents=True,exist_ok=True)
lab = output.parent
base = json.loads((base_dir/'candidate.json').read_text())
target = json.loads((target_dir/'candidate.json').read_text())
verify_candidate(base, 'base')
verify_candidate(target, 'target')
asset = 'tuzi-assistant-'+platform+'.app.tar.gz'
report = dict(kind='real-installed-macos-subset',officialAcceptance=False,platform=platform,
              base=base,target=target,checks={},discovery='synthetic-local-https',
              remaining=['published-old-version-manual-transition','valid-package-install-permission-failure',
                         'creative-project-migration','native-runtime-IPC-identity','business-provider-acceptance'])
app = executable = process = server = mount = None
trusted = hosts_changed = False
trust_restore = None
original_hosts = Path('/etc/hosts').read_bytes()
pid = None


def stage(name):
    report['stage'] = name
    print('MAC-STAGE: ' + name, flush=True)
    (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')


def capture(args, **kwargs):
    kwargs.setdefault('timeout', 30)
    return subprocess.check_output(args, **kwargs)


def run(args, **kwargs):
    kwargs.setdefault('timeout', 60)
    print('MAC-COMMAND: ' + ' '.join(str(a) for a in args[:3]), flush=True)
    return subprocess.run(args,check=True,**kwargs)


def wait_for(fn,message,seconds=90):
    deadline = time.monotonic()+seconds
    last = None
    while time.monotonic()<deadline:
        try:
            value=fn()
            if value:
                return value
        except (subprocess.SubprocessError,OSError) as error:
            last=(getattr(error, 'stderr', None) or str(error))
        time.sleep(0.5)
    raise AssertionError(message+'; last='+str(last))


def ax(body):
    script = 'tell application "System Events"\nset p to first application process whose unix id is '+str(pid)+'\nset frontmost of p to true\n'+body+'\nend tell'
    return capture(['osascript','-e',script],text=True,stderr=subprocess.PIPE,timeout=25).strip()


def tree():
    return ax('return entire contents of front window of p')


def button(names,press=False):
    labels='{'+','.join(json.dumps(s,ensure_ascii=False) for s in names)+'}'
    body='''set labels to LABELS
set allItems to get entire contents of front window of p
repeat with itemRef in allItems
try
if role of itemRef is "AXButton" and enabled of itemRef then
set titleText to name of itemRef
if titleText is in labels then
PRESS
return true
end if
end if
end try
end repeat
return false'''.replace('LABELS',labels).replace('PRESS','perform action "AXPress" of itemRef' if press else '')
    return ax(body)=='true'


def click(names):
    stage('press '+str(names))
    wait_for(lambda: button(names),'Accessible enabled button missing: '+str(names))
    assert button(names,True)


def screenshot(name):
    (output/(name+'.ax.txt')).write_text(tree())
    run(['screencapture','-x',str(output/(name+'.png'))],capture_output=True)


def files_in_archive(directory):
    with tarfile.open(directory/asset,'r:gz') as archive:
        return {'/'.join(Path(member.name).parts[1:]):sha(archive.extractfile(member).read())
                for member in archive.getmembers() if member.isfile()}


def assert_app(expected,version):
    actual={str(f.relative_to(app)):sha(f.read_bytes()) for f in app.rglob('*') if f.is_file()}
    assert actual==expected, 'Installed app differs from signed archive'
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    assert info['CFBundleIdentifier']=='com.tuziswitch.desktop'
    assert info['CFBundleShortVersionString']==version
    run(['codesign','--verify','--deep','--strict',str(app)],capture_output=True)
    return dict(version=version,identifier=info['CFBundleIdentifier'],files=actual)


def app_pids():
    rows=capture(['ps','-axo','pid=,command='],text=True).splitlines()
    return [int(row.split(None,1)[0]) for row in rows if len(row.split(None,1))==2 and row.split(None,1)[1]==str(executable)]


try:
    stage('existing Accessibility permission')
    assert capture(['osascript','-e','tell application "System Events" to get UI elements enabled'],text=True).strip()=='true', 'Existing Accessibility permission required; never grant it automatically'
    stage('verify and install original DMG')
    expected_base=files_in_archive(base_dir); expected_target=files_in_archive(target_dir)
    dmg=base_dir/('tuzi-assistant-'+platform+'.dmg')
    assert sha(dmg.read_bytes())==base['files'][dmg.name]
    mounted=plistlib.loads(capture(['hdiutil','attach','-readonly','-nobrowse','-plist',str(dmg)]))
    mounts=[e['mount-point'] for e in mounted['system-entities'] if 'mount-point' in e]
    assert len(mounts)==1
    mount=mounts[0]
    apps=list(Path(mount).glob('*.app')); assert len(apps)==1
    app=lab/apps[0].name
    assert not app.exists()
    run(['ditto',str(apps[0]),str(app)])
    run(['hdiutil','detach',mount],stdout=subprocess.DEVNULL); mount=None
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    executable=app/'Contents/MacOS'/info['CFBundleExecutable']
    report['architecture']=capture(['lipo','-archs',str(executable)],text=True).strip()
    assert report['architecture']==('arm64' if platform=='macos-arm64' else 'x86_64')
    assert capture(['uname','-m'],text=True).strip()==report['architecture']
    report['installedBase']=assert_app(expected_base,'1.6.2')
    stage('create temporary TLS certificates')
    # Ephemeral HTTPS trust, separate from the immutable official update key.
    openssl = os.environ.get('TUZI_TEST_OPENSSL','openssl')
    run([openssl,'req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',str(lab/'ca.key'),
         '-out',str(lab/'ca.crt'),'-subj','/CN=SYNTHETIC Tuzi Mac Lab CA','-addext','basicConstraints=critical,CA:TRUE'],capture_output=True)
    run([openssl,'req','-newkey','rsa:2048','-nodes','-keyout',str(lab/'tls.key'),'-out',str(lab/'tls.csr'),'-subj','/CN=github.com'],capture_output=True)
    (lab/'tls.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:github.com,DNS:api.github.com\n')
    run([openssl,'x509','-req','-in',str(lab/'tls.csr'),'-CA',str(lab/'ca.crt'),'-CAkey',str(lab/'ca.key'),
         '-CAserial',str(lab/'ca.srl'),'-CAcreateserial','-out',str(lab/'tls.crt'),'-days','1','-sha256','-extfile',str(lab/'tls.ext')],capture_output=True)
    (lab/'ca.key').chmod(0o600); (lab/'tls.key').chmod(0o600)
    stage('trust temporary local CA')
    run(['sudo','security','add-trusted-cert','-d','-r','trustRoot','-k','/Library/Keychains/System.keychain',str(lab/'ca.crt')],capture_output=True); trusted=True
    fingerprint=capture([openssl,'x509','-in',str(lab/'ca.crt'),'-noout','-fingerprint','-sha1'],text=True).strip().split('=')[-1].replace(':','')
    # Preserve all unrelated trust settings in this disposable host. Removing a
    # single admin trust record with remove-trusted-cert hangs on these runners.
    trust_export=lab/'admin-trust-with-probe.plist'
    run(['sudo','security','trust-settings-export','-d',str(trust_export)],capture_output=True)
    trust_settings=plistlib.loads(capture(['sudo','cat',str(trust_export)]))
    matching=[key for key in trust_settings['trustList'] if key.upper()==fingerprint]
    assert len(matching)==1, 'Synthetic CA missing from exported admin trust'
    del trust_settings['trustList'][matching[0]]
    trust_restore=lab/'admin-trust-without-probe.plist'
    trust_restore.write_bytes(plistlib.dumps(trust_settings))
    stage('prepare loopback discovery')
    hosts_changed=True
    run(['sudo','tee','/etc/hosts'],input=original_hosts+b'\n127.0.0.1 github.com api.github.com\n',stdout=subprocess.DEVNULL)
    run(['sudo','dscacheutil','-flushcache'])
    (lab/'mode').write_text('normal')
    server_log=(output/'server.log').open('w')
    server=subprocess.Popen(['sudo','env','GITHUB_ACTIONS=true','GITHUB_REPOSITORY=AiW520/tuzi-switch',
        'RUNNER_ENVIRONMENT=github-hosted',sys.executable,str(Path(__file__).resolve()),'--serve',str(target_dir),str(lab),asset],stdout=server_log,stderr=server_log)
    wait_for(lambda: (lab/'server.ready').exists(),'Loopback TLS server failed to start',20)
    sandbox=lab/'loopback.sb'
    sandbox.write_text('(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n')
    app_env={k:v for k,v in os.environ.items() if not any(w in k.upper() for w in ['TOKEN','SECRET','PASSWORD','PRIVATE_KEY'])}
    application_log=(output/'application.log').open('w')
    stage('launch original installed application')
    process=subprocess.Popen(['sandbox-exec','-f',str(sandbox),str(executable)],env=app_env,stdout=application_log,stderr=application_log)
    pid=process.pid; report['initialPid']=pid
    click(['Got it','我知道了'])
    # Use the persistent toolbar control, not the expiring 15-second toast.
    click(['New version available: 1.6.3','检测到新版本：1.6.3'])
    screenshot('01-update-dialog')
    for failure in ['corrupt','interrupted','missing']:
        (lab/'mode').write_text(failure)
        click(['下载更新','重新下载'])
        wait_for(lambda: button(['重新下载']),failure+' was not rejected',120)
        assert process.poll() is None
        assert_app(expected_base,'1.6.2')
        assert not button(['重启并更新'])
        requests=[json.loads(line) for line in (lab/'requests.jsonl').read_text().splitlines()]
        assert any(r['path'].endswith(asset) and r['mode']==failure for r in requests)
        report['checks'][failure]='passed'
        screenshot('02-'+failure)
    (lab/'mode').write_text('normal')
    click(['重新下载'])
    wait_for(lambda: button(['重启并更新']),'Native signature verification failed',120)
    screenshot('03-signature-verified')
    click(['重启并更新'])
    # No app launch is allowed after this point. Observe the native restart.
    wait_for(lambda: process.poll() is not None,'Old process did not exit',120)
    assert process.returncode==0
    report['oldExitCode']=process.returncode
    restarted=wait_for(lambda: [p for p in app_pids() if p!=pid],'No automatically restarted app',120)
    assert len(restarted)==1
    pid=restarted[0]; report['restartedPid']=pid
    report['installedTarget']=assert_app(expected_target,'1.6.3')
    wait_for(lambda: 'Tuzi account' in tree(),'Restarted actual app UI missing')
    assert not button(['Got it','我知道了']), 'Welcome dismissal was lost'
    screenshot('04-automatically-restarted')
    report['checks'].update({k:'passed' for k in ['download','nativeSignature','install','automaticRestart',
        'exactSignedTargetBytes','welcomePreferencePreserved','sameInstallationRetry']})
    report['subsetStatus']='passed'
    stage('completed signed upgrade subset')
except Exception as error:
    report['subsetStatus']='failed'; report['error']=repr(error)
    try:
        screenshot('failure')
    except Exception as diagnostic:
        report['diagnosticError']=str(diagnostic)
    raise
finally:
    if (lab/'requests.jsonl').exists():
        report['requests']=[json.loads(line) for line in (lab/'requests.jsonl').read_text().splitlines()]
    (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    for app_pid in app_pids() if executable else []:
        try:
            os.kill(app_pid,signal.SIGTERM)
        except ProcessLookupError:
            pass
    if trusted:
        fingerprint=capture([openssl,'x509','-in',str(lab/'ca.crt'),'-noout','-fingerprint','-sha1'],text=True).strip().split('=')[-1].replace(':','')
        try:
            # Removal/import timed out on these disposable runners. Revoke
            # only this ephemeral CA instead; keep
            # its explicit deny record until GitHub discards the host.
            curl=['/usr/bin/curl','-q','--silent','--show-error','--noproxy','*',
                  '--connect-timeout','5','--max-time','10','--output','/dev/null',
                  'https://github.com/tuziapi/tuzi-switch/releases/latest/download/latest.json']
            if server and (lab/'server.ready').exists():
                before=subprocess.run(curl,capture_output=True,timeout=15)
                assert before.returncode==0, 'TLS positive control failed before CA revocation'
                report['testCaTrustedBeforeRevocation']=True
            run(['sudo','security','add-trusted-cert','-d','-r','deny','-k',
                 '/Library/Keychains/System.keychain',str(lab/'ca.crt')],capture_output=True,timeout=30)
            revoked=lab/'admin-trust-revoked.plist'
            run(['sudo','security','trust-settings-export','-d',str(revoked)],capture_output=True)
            revoked_settings=plistlib.loads(capture(['sudo','cat',str(revoked)]))
            matching=[key for key in revoked_settings['trustList'] if key.upper()==fingerprint]
            assert len(matching)==1
            record=revoked_settings['trustList'].pop(matching[0])
            assert record['trustSettings']==[{'kSecTrustSettingsResult':3}], 'Expected unconditional synthetic CA distrust'
            assert trust_restore and revoked_settings==plistlib.loads(trust_restore.read_bytes()), 'Unrelated admin trust changed'
            report['unrelatedAdminTrustPreserved']=True
            if server and (lab/'server.ready').exists():
                after=subprocess.run(curl,capture_output=True,timeout=15)
                assert after.returncode==60, 'Revoked synthetic CA did not produce certificate rejection'
                report['testCaRejectedAfterRevocation']=True
            report['testCaDenyRecordRetainedUntilRunnerDisposal']=True
        except (subprocess.SubprocessError,OSError,AssertionError,KeyError) as error:
            report.setdefault('cleanupErrors',[]).append('Synthetic CA revocation: '+repr(error))
        try:
            run(['sudo','security','delete-certificate','-Z',fingerprint,'/Library/Keychains/System.keychain'],capture_output=True,timeout=30)
        except subprocess.SubprocessError as error:
            report.setdefault('cleanupErrors',[]).append('Synthetic certificate deletion: '+repr(error))
    if (lab/'server.pid').exists():
        subprocess.run(['sudo','kill', (lab/'server.pid').read_text().strip()],check=False,timeout=15)
    if server:
        server.wait(timeout=15)
    if hosts_changed:
        run(['sudo','tee','/etc/hosts'],input=original_hosts,stdout=subprocess.DEVNULL)
        run(['sudo','dscacheutil','-flushcache'])
    for name in ['ca.key','tls.key']:
        (lab/name).unlink(missing_ok=True)
    (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if mount:
        subprocess.run(['hdiutil','detach',mount],check=False,stdout=subprocess.DEVNULL,timeout=30)

if report.get('cleanupErrors'):
    raise AssertionError('Temporary trust cleanup failed; see preserved results.json')
