# coding: utf-8
"""Opt-in macOS profile isolation probe. Launches a private signed Claude copy with an empty profile
and a rejecting loopback proxy. Never trusts a CA or sends an inference request.
Run with --run; refuses if Claude is already running. Only terminates the process carrying
this probe's unique proxy flag. Reports hashes, never personal file contents.
"""
import argparse, hashlib, json, os, pathlib, socket, subprocess, tempfile, threading, time

def processes():
    return subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True).splitlines()

def primary_snapshots():
    home = pathlib.Path.home()
    roots = [home/'.claude/settings.json', home/'.claude.json']
    for name in ['Claude','Claude-3p']:
        base=home/'Library/Application Support'/name
        roots.extend([base/'claude_desktop_config.json',base/'configLibrary'])
    result={}
    for root in roots:
        files=sorted(root.rglob('*')) if root.is_dir() else [root]
        for path in files:
            if path.is_file(): result[str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
            elif not path.exists(): result[str(path)]='absent'
    return result

def bundle_hash(app):
    digest=hashlib.sha256()
    for path in sorted(pathlib.Path(app).rglob('*')):
        digest.update(str(path.relative_to(app)).encode())
        if path.is_symlink(): digest.update(os.readlink(path).encode())
        elif path.is_file():
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024*1024), b''): digest.update(chunk)
    return digest.hexdigest()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true')
    parser.add_argument('--app', required=True);parser.add_argument('--expected-version', required=True);args=parser.parse_args()
    if not args.run: parser.error('--run is required for a real isolated client launch')
    app=str(pathlib.Path(args.app).resolve())
    if app == '/Applications/Claude.app': raise RuntimeError('Probe requires a private application copy')
    original_before=bundle_hash('/Applications/Claude.app')
    copy_before=bundle_hash(app)
    native_log=pathlib.Path.home()/'Library/Logs/Claude/main.log'
    log_offset=native_log.stat().st_size if native_log.exists() else 0
    exe=app+'/Contents/MacOS/Claude'
    if any('/Contents/MacOS/Claude ' in row or row.rstrip().endswith('/Contents/MacOS/Claude') for row in processes()): raise RuntimeError('Quit existing Claude before this probe')
    version=subprocess.check_output(['/usr/bin/defaults','read',app+'/Contents/Info','CFBundleShortVersionString'],text=True).strip()
    if version!=args.expected_version: raise RuntimeError('Unexpected Claude version')
    before=primary_snapshots()
    root=pathlib.Path(tempfile.mkdtemp(prefix='tuzi-claude-isolation-'))
    profile=root/'desktop-profile';profile.mkdir(mode=0o700)
    (profile/'claude_desktop_config.json').write_text('{"deploymentMode":"1p"}')
    library=root/'desktop-profile-3p/configLibrary';library.mkdir(parents=True,mode=0o700)
    entry_id='11111111-2222-4333-8444-555555555559'
    (library/'_meta.json').write_text(json.dumps({'appliedId':entry_id,'entries':[{'id':entry_id,'name':'Tuzi Local'}]}))
    (library/(entry_id+'.json')).write_text('{"disableAutoUpdates":true}')
    code=root/'code-profile';code.mkdir(mode=0o700)
    server=socket.socket();server.bind(('127.0.0.1',0));server.listen();server.settimeout(0.25)
    port=server.getsockname()[1];flag=f'--proxy-server=http://127.0.0.1:{port}'
    stopped=threading.Event()
    def reject_network():
        while not stopped.is_set():
            try:
                conn,_=server.accept();conn.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');conn.close()
            except socket.timeout: pass
    thread=threading.Thread(target=reject_network,daemon=True);thread.start()
    env={k:v for k,v in os.environ.items() if not k.startswith(('ANTHROPIC_','CLAUDE_','ELECTRON_')) and k not in ['NODE_OPTIONS','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy']}
    env.update(CLAUDE_USER_DATA_DIR=str(profile), CLAUDE_CONFIG_DIR=str(code))
    owned=[]
    failure=None
    environment_received=False
    try:
        subprocess.run(['/usr/bin/open','-n',app,'--env','CLAUDE_USER_DATA_DIR='+str(profile),'--env','CLAUDE_CONFIG_DIR='+str(code),'--args',flag,'--disable-http-cache','--user-data-dir='+str(profile)],env=env,check=True)
        for _ in range(80):
            owned=[int(row.strip().split(' ',1)[0]) for row in processes() if exe in row and flag in row]
            if owned:
                proc_env=subprocess.check_output(['ps','eww','-p',str(owned[0]),'-o','command='],text=True)
                environment_received='CLAUDE_USER_DATA_DIR='+str(profile) in proc_env
            if owned and (profile/'Local State').is_file() and native_log.exists():
                with native_log.open('rb') as stream:
                    stream.seek(log_offset)
                    if b'Auto-updates disabled' in stream.read(): break
            time.sleep(0.25)
        assert owned, 'No owned Claude process found'
        assert (profile/'Local State').is_file(), 'Claude did not write the isolated profile'
    except Exception as error:
        failure=str(error)
    finally:
        # TERM only; never kill all Claude processes and never use an escalated fallback.
        for row in processes():
            if exe in row and flag in row:
                os.kill(int(row.strip().split(' ',1)[0]),15)
        for _ in range(40):
            if not any(exe in row and flag in row for row in processes()):break
            time.sleep(0.25)
        stopped.set();thread.join(timeout=1);server.close()
    after=primary_snapshots()
    with native_log.open('rb') as stream:
        stream.seek(log_offset); log=stream.read().decode(errors='replace')
    updates_disabled='Auto-updates disabled' in log
    report={'claudeVersion':version,'applicationPath':app,'autoUpdatesDisabledInNativeLog':updates_disabled,'originalBundleUnchanged':original_before==bundle_hash('/Applications/Claude.app'),'copyBundleUnchanged':copy_before==bundle_hash(app),'originalBundleSha256':original_before,'copyBundleSha256':copy_before,'profileCreated':(profile/'Local State').is_file(),'launchEnvironmentReceived':environment_received,'failure':failure,'personalConfigHashesUnchanged':before==after,
            'ownedProcessExited':not any(exe in row and flag in row for row in processes()),'certificateInstalled':False,'modelCalls':0,
            'scope':'profile isolation launch only; not login, Chat, Code task, voice or computer-use acceptance', 'profileDirectory':str(profile)}
    (root/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2));print('Report:',root/'report.json')
    assert report['autoUpdatesDisabledInNativeLog'] and report['originalBundleUnchanged'] and report['copyBundleUnchanged'] and report['personalConfigHashesUnchanged'] and report['ownedProcessExited'] and report['profileCreated'] and not failure
if __name__=='__main__': main()
