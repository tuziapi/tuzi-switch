"""Operate unchanged signed Mac candidates via existing Accessibility permission.

Runs only on disposable test-repository hosts. The actual app and its restarted
child inherit a loopback-only sandbox. Discovery is synthetic; packages are not.
"""
import hashlib
import base64
import ctypes
from signed_candidate_identity import verify_candidate
from signed_creative_webdriver import PNG
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import plistlib
import signal
import socket
import ssl
import sqlite3
import subprocess
import sys
import tarfile
import time
from urllib.parse import urlsplit, parse_qs

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
            if host == 'api.tu-zi.com':
                return self.creative()
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

        def do_POST(self):
            if self.headers.get('Host', '').split(':')[0] == 'api.tu-zi.com':
                return self.creative()
            self.send_error(404)

        def creative(self):
            url=urlsplit(self.path)
            try:
                if url.path == '/api/status':
                    assert self.command == 'GET'
                    result={'success':True,'data':{'system_name':'SYNTHETIC Mac lab'}}
                else:
                    assert self.headers.get('Authorization') == 'Bearer sk-SYNTHETIC-GENERATION'
                    if url.path == '/v1/models':
                        assert self.command == 'GET'
                        result={'data':[dict(id='gpt-image-2.5-sunburst',supported_endpoint_types=['image-generation'],
                            endpoints={'image-generation':{'path':'/v1/images/generations','method':'POST'}})]}
                    else:
                        assert self.command == 'POST' and url.path == '/v1/images/generations'
                        length=int(self.headers.get('Content-Length','0'))
                        assert 0 < length < 1024*1024
                        body=json.loads(self.rfile.read(length))
                        assert not body.get('layer_decomposition_options'), 'No repeat splitting tests'
                        channels=parse_qs(url.query).get('ch',[])
                        assert channels == ['3'], 'Official native generation must carry exactly one ch=3'
                        assert body['model']=='gpt-image-2.5-sunburst'
                        result={'data':[{'url':'data:image/png;base64,'+PNG}]}
                        with (lab/'creative-requests.jsonl').open('a') as log:
                            log.write(json.dumps(dict(version=(lab/'creative-version').read_text(),model=body['model'],
                                channels=channels,syntheticAuthorizationMatched=True,layers=False))+'\n')
                content=json.dumps(result).encode()
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(content)))
                self.end_headers(); self.wfile.write(content)
            except Exception as error:
                with (lab/'creative-errors.jsonl').open('a') as log:
                    log.write(json.dumps(dict(path=url.path,error=repr(error)))+'\n')
                self.send_error(500,'Synthetic provider rejected native request')

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
legacy_dir = Path(os.environ['LEGACY_INSTALLER_DIR']) if os.environ.get('LEGACY_INSTALLER_DIR') else None
legacy_version = os.environ.get('LEGACY_VERSION', '1.6.1')
legacy_sources = {
    '1.6.0': dict(commit='21cad50c7f5b916b94bccf39c6d594724241bfb1', **{
        'macos-arm64': '1e1db32f85831404c83ddfb9817999d1bd7df33a82b9572624cf4364dcd55e1b',
        'macos-x64': '9e315ce4b8280f6c15218f2184b1847f2038bf1e69a5e7bc15611aada0582a4d'}),
    '1.6.1': dict(commit='7c13bc943a4b7116af15593ec0ac18af0ba9727f', **{
        'macos-arm64': '464efd9f5f2db3efa64b9c3599264b20e47097ec0efd5e8c29d57dc307510d25',
        'macos-x64': 'f31b97cfb582b035f6460a591545efe3ed500a3cc7c7ecec9bd3b17241a10aa5'}),
}
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
    return capture(['osascript','-e',script],text=True,stderr=subprocess.PIPE,timeout=60).strip()


def tree():
    return ax('return entire contents of front window of p')


def pointer_click(x, y):
    # System Events' coordinate click does not reliably emit mouseMoved.
    # The canvas upload shortcut explicitly requires its pointer-move state.
    class Point(ctypes.Structure):
        _fields_=[('x',ctypes.c_double),('y',ctypes.c_double)]
    cg=ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    cf=ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    cg.CGEventCreateMouseEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint32,Point,ctypes.c_uint32]
    cg.CGEventCreateMouseEvent.restype=ctypes.c_void_p
    cg.CGEventPost.argtypes=[ctypes.c_uint32,ctypes.c_void_p]
    cf.CFRelease.argtypes=[ctypes.c_void_p]
    for event_type in [5,1,2]:  # moved, left down, left up
        event=cg.CGEventCreateMouseEvent(None,event_type,Point(x,y),0)
        assert event, 'Native pointer event could not be created'
        cg.CGEventPost(0,event)
        cf.CFRelease(event)
        time.sleep(.15)


def button(names,press=False):
    labels='{'+','.join(json.dumps(s,ensure_ascii=False) for s in names)+'}'
    body='''set labels to LABELS
repeat with itemRef in (get buttons of front window of p)
try
if name of itemRef is in labels then
if not enabled of itemRef then return false
PRESS
return true
end if
end try
end repeat
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
    wait_for(lambda: button(names,True),'Accessible enabled button missing: '+str(names))


def screenshot(name):
    (output/(name+'.ax.txt')).write_text(tree())
    run(['screencapture','-x',str(output/(name+'.png'))],capture_output=True)


creative_title='SYNTHETIC Mac migration '+legacy_version


def press_label(label, prefix=False):
    # WebKit exposes canvas tools as radio buttons and the host switch as a
    # popup button. Operate their existing accessibility actions only.
    literal=json.dumps(label,ensure_ascii=False)
    comparison=('starts with ' if prefix else 'is ')+literal
    body='''repeat with itemRef in (get entire contents of front window of p)
try
if role of itemRef is in {"AXButton", "AXRadioButton", "AXPopUpButton", "AXCheckBox"} then
if name of itemRef COMPARISON then
perform action "AXPress" of itemRef
return true
end if
end if
end try
end repeat
return false'''.replace('COMPARISON',comparison)
    wait_for(lambda: ax(body)=='true','Accessible label missing: '+label)


def creative_record():
    # Read only the synthetic board created through this runner's real UI.
    # Compare WebKit's complete serialized record, including all image data,
    # without writing to its database or decoding/recreating its format.
    root=Path.home()/'Library/WebKit/com.tuziswitch.desktop/WebsiteData'
    matches=[]
    for db in root.rglob('IndexedDB.sqlite3'):
        with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as connection:
            try:
                store=connection.execute("SELECT id FROM ObjectStoreInfo WHERE name='boards'").fetchone()
                if not store:
                    continue
                for store_id,key,value in connection.execute('SELECT objectStoreID,key,value FROM Records NOT INDEXED'):
                    if store_id!=store[0]:
                        continue
                    data=bytes(value)
                    if creative_title.encode() in data or creative_title.encode('utf-16-le') in data:
                        image_present=b'image' in data or 'image'.encode('utf-16-le') in data
                        if not image_present:
                            continue
                        matches.append(dict(key=sha(key.encode() if isinstance(key,str) else key),
                                            value=sha(data),bytes=len(data)))
            except sqlite3.OperationalError:
                continue
    assert len(matches)<=1, 'Ambiguous synthetic board'
    return matches[0] if matches else None


def create_creative_fixture():
    click(['opentu 创作'])
    click(['我的项目'])
    click(['新建项目'])
    click(['我的项目'])
    click(['重命名 未命名项目'])
    ax('keystroke "a" using command down\nkeystroke '+json.dumps(creative_title)+'\nkey code 36')
    press_label(creative_title,prefix=True)
    # Native image import, not direct IndexedDB insertion or a synthetic app.
    image_path=lab/'SYNTHETIC-migration.png'
    image_path.write_bytes(base64.b64decode(PNG))
    if button(['不再提示']):
        click(['不再提示'])
    if button(['展开工具栏']):
        click(['展开工具栏'])
    # Compact runner screens clip the middle toolbar into an internal
    # scroller. Hidden radios retain AX bounds outside that viewport. Place
    # the pointer in the empty board first, satisfying the app shortcut's
    # existing moving-point guard, then use its actual Cmd+U command.
    bounds=ax('return {position of front window of p, size of front window of p}')
    x,y,w,h=map(float,bounds.split(', '))
    pointer_click(int(x+w*.85),int(y+h*.25))
    ax('key code 32 using command down')
    # WebKit's file input uses a standalone NSOpenPanel on current macOS;
    # it is not always exposed as an AXSheet. Open may be disabled until a
    # file is selected, so inspect its presence plus the enabled Cancel.
    wait_for(lambda: button(['Cancel','取消']) and any(
        'button '+label+' of' in tree() for label in ['Open','打开']),
        'Native image picker did not open')
    ax('keystroke "g" using {command down, shift down}')
    time.sleep(1)
    ax('keystroke '+json.dumps(str(image_path))+'\nkey code 36')
    # Intel runners may still be navigating when the next Return arrives.
    # Wait for the real file selection to enable Open, then press that button.
    click(['Open','打开'])
    wait_for(creative_record,'Imported image was not persisted')
    screenshot('00-legacy-creative-image')
    press_label('兔子助手导航')
    click(['Codex'])
    saved=wait_for(creative_record,'Synthetic project disappeared')
    report['legacyCreativeRecord']=saved
    return saved


def assert_creative_preserved(saved, label):
    assert wait_for(creative_record,'Saved creative record missing')==saved, 'Complete serialized project changed during upgrade'
    click(['opentu 创作'])
    click(['我的项目'])
    press_label(creative_title,prefix=True)
    # Collapsed toolbars intentionally omit the task-queue control. The
    # composer and imported canvas image are present in either toolbar state.
    wait_for(lambda: 'text area ' in tree() and 'image 1 of group opentu' in tree(),
             'Creative canvas and imported image did not finish loading')
    screenshot('06-creative-preserved-'+label)
    press_label('兔子助手导航')
    click(['Codex'])


def native_business_attribution(version, configure=False):
    stage('native synthetic generation attribution '+version)
    (lab/'creative-version').write_text(version)
    click(['opentu 创作'])
    wait_for(lambda: 'text area ' in tree(),'Creative canvas not ready for native attribution')
    if configure:
        click(['创作配置'])
        press_label('手动配置')
        body='''repeat with itemRef in (get entire contents of front window of p)
try
if subrole of itemRef is "AXSecureTextField" then
set value of attribute "AXFocused" of itemRef to true
keystroke "a" using command down
keystroke "sk-SYNTHETIC-GENERATION"
return true
end if
end try
end repeat
return false'''
        wait_for(lambda: ax(body)=='true','Manual synthetic API key input missing')
        screenshot('07-synthetic-provider-configured')
        click(['保存'])
        wait_for(lambda: not button(['保存']),'Provider settings did not close')
    ax('key code 53')
    body='''repeat with itemRef in (get entire contents of front window of p)
try
if role of itemRef is "AXTextArea" then
set value of attribute "AXFocused" of itemRef to true
keystroke "a" using command down
keystroke "SYNTHETIC Mac native attribution VERSION"
return true
end if
end try
end repeat
return false'''.replace('VERSION',version)
    wait_for(lambda: ax(body)=='true','Canvas prompt input missing')
    screenshot('08-before-native-generation-'+version)
    before=(lab/'creative-requests.jsonl').read_text().splitlines() if (lab/'creative-requests.jsonl').exists() else []
    click(['发送生成请求','Send generation request'])
    def receipt():
        if not (lab/'creative-requests.jsonl').exists():
            return None
        rows=[json.loads(line) for line in (lab/'creative-requests.jsonl').read_text().splitlines()]
        assert len(rows)<=len(before)+1, 'Unexpected automatic duplicate generation'
        return rows[-1] if len(rows)==len(before)+1 and rows[-1]['version']==version else None
    result=wait_for(receipt,'Native generation did not reach isolated provider')
    # Receipt proves native request attribution, not a paid provider result.
    report.setdefault('nativeBusinessRequests',[]).append(result)
    screenshot('09-native-attribution-'+version)
    press_label('兔子助手导航')
    click(['Codex'])


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
    (lab/'tls.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:github.com,DNS:api.github.com,DNS:api.tu-zi.com\n')
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
    run(['sudo','tee','/etc/hosts'],input=original_hosts+b'\n127.0.0.1 github.com api.github.com api.tu-zi.com\n',stdout=subprocess.DEVNULL)
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
    # Only the app's dedicated temporary directory is denied in the staging
    # failure test. Never change the runner's or a user's normal temp directory.
    installer_temp=lab/'installer-temp'
    installer_temp.mkdir(mode=0o700)
    app_env['TMPDIR']=str(installer_temp)
    if legacy_dir:
        stage('published old-version manual transition')
        legacy_bytes=(legacy_dir/('manifest-'+platform+'.json')).read_bytes()
        assert sha(legacy_bytes)==legacy_sources[legacy_version][platform]
        legacy=json.loads(legacy_bytes)
        assert legacy['repository']=='tuziapi/tuzi-switch'
        assert legacy['version']==legacy_version
        assert legacy['commit']==legacy_sources[legacy_version]['commit']
        legacy_dmg=legacy_dir/dmg.name
        entry=next(f for f in legacy['files'] if f['file']==legacy_dmg.name)
        assert sha(legacy_dmg.read_bytes())==entry['sha256']
        base_backup=lab/'verified-base.app'
        app.rename(base_backup)
        mounted=plistlib.loads(capture(['hdiutil','attach','-readonly','-nobrowse','-plist',str(legacy_dmg)]))
        mounts=[e['mount-point'] for e in mounted['system-entities'] if 'mount-point' in e]
        assert len(mounts)==1
        mount=mounts[0]
        old_apps=list(Path(mount).glob('*.app')); assert len(old_apps)==1
        run(['ditto',str(old_apps[0]),str(app)])
        run(['hdiutil','detach',mount],stdout=subprocess.DEVNULL); mount=None
        old_info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
        assert old_info['CFBundleShortVersionString']==legacy_version
        assert old_info['CFBundleIdentifier']=='com.tuziswitch.desktop'
        assert legacy['commit'].encode() in executable.read_bytes()
        run(['codesign','--verify','--deep','--strict',str(app)],capture_output=True)
        process=subprocess.Popen(['sandbox-exec','-f',str(sandbox),str(executable)],env=app_env,stdout=application_log,stderr=application_log)
        pid=process.pid
        click(['Got it','我知道了'])
        wait_for(lambda: 'Tuzi account' in tree(),'Published old app did not load')
        screenshot('00-published-old-version')
        legacy_creative=create_creative_fixture()
        ax('keystroke "q" using command down')
        wait_for(lambda: process.poll() is not None,'Published app must quit normally')
        assert process.returncode==0
        legacy_creative=wait_for(creative_record,'Project lost on normal legacy exit')
        app.rename(lab/'published-legacy.app')
        base_backup.rename(app)
        assert_app(expected_base,'1.6.2')
        report['manualTransition']={'fromVersion':legacy_version,'toVersion':'1.6.2',
            'source':legacy,'oldExitCode':process.returncode,'dataScope':'welcome preference and complete UI-created image project record'}
    stage('launch original installed application')
    process=subprocess.Popen(['sandbox-exec','-f',str(sandbox),str(executable)],env=app_env,stdout=application_log,stderr=application_log)
    pid=process.pid; report['initialPid']=pid
    if legacy_dir:
        wait_for(lambda: 'Codex' in tree(),'Manually updated app did not load')
        assert not button(['Got it','我知道了']), 'Manual transition lost welcome preference'
        report['checks']['publishedLegacyManualTransition']='passed'
        report['manualTransition']['status']='passed'
        report['remaining'].remove('published-old-version-manual-transition')
        assert_creative_preserved(legacy_creative,'manual-transition')
        report['checks']['legacyCreativeImageProjectPreservation']='passed'
        native_business_attribution('1.6.2',configure=True)
        # Wait for the app's own persistence after the synthetic request.
        time.sleep(5)
        before_upgrade_creative=wait_for(creative_record,'Project absent before signed upgrade')
    else:
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
    stage('valid signed package staging permission failure')
    installer_temp.chmod(0o500)
    try:
        try:
            (installer_temp/'must-be-denied').mkdir()
        except PermissionError:
            pass
        else:
            raise AssertionError('OS did not deny installer temp directory creation')
        click(['重启并更新'])
        wait_for(lambda: button(['重新下载']),'Staging permission error was not recoverable',60)
        assert process.poll() is None
        assert_app(expected_base,'1.6.2')
        assert '安装未完成' in tree()
        screenshot('03-staging-permission-denied')
    finally:
        installer_temp.chmod(0o700)
    report['checks']['validSignedPackageStagingPermissionDenied']='passed'
    report['installerFailureScope']='Real OS temp-directory denial after signature verification; old app remains running. Privileged final app replacement failure is not covered.'
    report['remaining'].remove('valid-package-install-permission-failure')
    click(['重新下载'])
    wait_for(lambda: button(['重启并更新']),'Retry after permission restoration failed',120)
    click(['重启并更新'])
    # No app launch is allowed after this point. Observe the native restart.
    wait_for(lambda: process.poll() is not None,'Old process did not exit',120)
    assert process.returncode==0
    report['oldExitCode']=process.returncode
    restarted=wait_for(lambda: [p for p in app_pids() if p!=pid],'No automatically restarted app',120)
    assert len(restarted)==1
    pid=restarted[0]; report['restartedPid']=pid
    report['installedTarget']=assert_app(expected_target,'1.6.3')
    wait_for(lambda: 'Codex' in tree(),'Restarted actual app UI missing')
    assert not button(['Got it','我知道了']), 'Welcome dismissal was lost'
    screenshot('04-automatically-restarted')
    if legacy_dir:
        assert_creative_preserved(before_upgrade_creative,'signed-upgrade')
        report['checks']['creativeImageProjectPreservation']='passed'
        native_business_attribution('1.6.3')
        report['checks']['nativeBusinessAttribution']='passed'
        report['remaining'].remove('creative-project-migration')
        report['remaining'].remove('native-runtime-IPC-identity')
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
    if (lab/'creative-errors.jsonl').exists():
        report['creativeServerErrors']=[json.loads(line) for line in (lab/'creative-errors.jsonl').read_text().splitlines()]
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
