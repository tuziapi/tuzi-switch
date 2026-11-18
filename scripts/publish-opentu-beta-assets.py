"""Publish the validated beta assets on the test repository, preserving Latest."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

REPO = 'AiW520/tuzi-switch'
TAG = 'opentu-preview-v1.6.3-beta.5'

def gh(*args):
    return subprocess.check_output(['gh', *args], text=True).strip()

def api(path):
    return json.loads(gh('api', f'repos/{REPO}/{path}'))

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return 'sha256:' + h.hexdigest()

def verify_assets(release, files):
    assert len(release['assets']) == len(files), 'Unexpected or missing assets'
    for path in files:
        matches = [a for a in release['assets'] if a['name'] == path.name]
        assert len(matches) == 1, path.name
        asset = matches[0]
        assert asset['size'] == path.stat().st_size and asset['digest'] == digest(path), path.name
        assert asset['state'] == 'uploaded', path.name

def select_draft(releases):
    matches = [r for r in releases if r['tag_name'] == TAG]
    assert len(matches) <= 1, 'Duplicate release tag'
    if not matches:
        return None
    release = matches[0]
    assert release['draft'] and release['prerelease'], 'Refuse to replace a published release'
    return release

def create_draft(sha):
    # Use the create response directly: the release list can lag behind writes.
    release = json.loads(gh('api', '-X', 'POST', f'repos/{REPO}/releases',
        '-f', f'tag_name={TAG}', '-f', f'target_commitish={sha}',
        '-F', 'draft=true', '-F', 'prerelease=true', '-f', 'make_latest=false',
        '-f', 'name=OpenTu 1.6.3-beta.5 测试版',
        '-F', 'body=@docs/releases/opentu-preview-v1.6.3-beta.5.md'))
    draft = select_draft([release])
    assert draft is not None, 'Create response did not identify the expected draft'
    return draft

if __name__ == '__main__':
    assert os.environ.get('GITHUB_REPOSITORY') == REPO
    assert os.environ.get('GITHUB_REF') == 'refs/heads/main'
    sha = os.environ['SOURCE_SHA']; assert re.fullmatch(r'[a-f0-9]{40}', sha)
    metadata = json.loads(Path('prepared-release-preview-release.json').read_text())
    assert metadata['commit'] == sha and metadata['tag'] == TAG and metadata['repository'] == REPO
    assert metadata['prerelease'] is True and metadata['automaticUpdates'] is False
    assert metadata['runId'] == int(os.environ['BUILD_RUN_ID'])
    files = sorted(Path('prepared-release').iterdir())
    assert len(files) == 8 and all(p.is_file() and not p.is_symlink() for p in files)
    previous = api('releases/latest')
    # GitHub's release-by-tag endpoint excludes drafts. Resolve a draft via
    # the release list, then use its numeric ID throughout verification.
    draft = select_draft(api('releases?per_page=100'))
    if draft is None:
        # Never move or replace an existing tag.
        gh('api','-X','POST',f'repos/{REPO}/git/refs','-f',f'ref=refs/tags/{TAG}','-f',f'sha={sha}')
        draft = create_draft(sha)
    assert draft is not None
    tag = api(f'git/ref/tags/{TAG}')['object']
    assert tag['type'] == 'commit' and tag['sha'] == sha
    release_id = draft['id']
    assert all(a['name'] in {p.name for p in files} for a in draft['assets'])
    for path in files:
        matches = [a for a in draft['assets'] if a['name'] == path.name]
        if matches:
            # Resume only byte-identical draft assets; never use --clobber.
            verify_assets({'assets': matches}, [path])
        else:
            gh('release','upload',TAG,'-R',REPO,str(path))
    verify_assets(api(f'releases/{release_id}'), files)
    gh('release','edit',TAG,'-R',REPO,'--draft=false','--prerelease','--latest=false')
    release = api(f'releases/{release_id}')
    verify_assets(release,files)
    assert not release['draft'] and release['prerelease']
    assert api('releases/latest')['id'] == previous['id'], 'Stable Latest changed'
    Path('opentu-preview-publication.json').write_text(json.dumps({
        'repository':REPO,'tag':TAG,'commit':sha,'runId':metadata['runId'],
        'releaseId':release['id'],'releaseUrl':release['html_url'],
        'previousLatest':previous['tag_name'],'assets':[
            {'name':a['name'],'size':a['size'],'digest':a['digest'],'url':a['browser_download_url']}
            for a in release['assets']],
    },indent=2)+'\n')
    print('Published verified test prerelease; stable Latest is unchanged.')
