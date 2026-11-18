import argparse, hashlib, json, pathlib, shutil, subprocess

parser=argparse.ArgumentParser()
parser.add_argument('--artifacts', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--sha', required=True)
parser.add_argument('--run', type=int, required=True)
args=parser.parse_args()
version='1.6.3-beta.5'
tag='opentu-preview-v'+version
repository='AiW520/tuzi-switch'
platforms={
 'macos-arm64':('aarch64-apple-darwin','.dmg'),
 'macos-x64':('x86_64-apple-darwin','.dmg'),
 'windows-x64':('x86_64-pc-windows-msvc','.exe'),
 'linux-x64':('x86_64-unknown-linux-gnu','.deb'),
 'linux-arm64':('aarch64-unknown-linux-gnu','.deb'),
}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
assert not args.output.exists(), 'Use a new output directory; do not overwrite publication bytes'
args.output.mkdir(parents=True)
manifests=[]; downloads=[]
base=f'https://github.com/{repository}/releases/download/{tag}/'
for platform,(target,suffix) in platforms.items():
 paths=list(args.artifacts.rglob(platform+'.json'))
 assert len(paths)==1, f'Missing or duplicate manifest: {platform}'
 m=json.loads(paths[0].read_text())
 assert m['commit']==args.sha and int(m['runId'])==args.run
 assert m['repository']==repository and m['channel']=='preview' and m['version']==version
 assert m['target']==target and m['platform']==platform
 assert m['applicationId']=='com.tuziswitch.desktop.opentu-preview'
 assert m['isolatedProfile'] is True and m['automaticUpdates'] is False
 name=f'OpenTu-Preview-{version}-{platform}{suffix}'
 assert m['file']==name
 p=paths[0].parent/name
 assert p.is_file() and not p.is_symlink() and p.stat().st_size==m['bytes'] and digest(p)==m['sha256']
 assert set(['native-runtime-probe','release-native-integration','packaged-node-script-executed']).issubset(m['checks'])
 if platform.startswith('macos-'): assert 'node-jit-entitlement' in m['checks']
 shutil.copy2(p,args.output/name)
 manifests.append(m)
 downloads.append({'platform':platform,'file':name,'bytes':m['bytes'],'sha256':m['sha256'],'url':base+name})
source=f'opentu-preview-source-{args.sha}.tar.gz'
subprocess.run(['git','archive','--format=tar.gz',f'--prefix=opentu-preview-{version}/',f'--output={args.output/source}',args.sha],check=True)
(args.output/'build-manifest.json').write_text(json.dumps({'version':version,'commit':args.sha,'runId':args.run,'packages':manifests},indent=2)+'\n')
files=sorted(p for p in args.output.iterdir() if p.is_file())
(args.output/'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in files))
metadata={'channel':'preview','repository':repository,'version':version,'tag':tag,'prerelease':True,
 'applicationId':'com.tuziswitch.desktop.opentu-preview','automaticUpdates':False,'commit':args.sha,'runId':args.run,
 'releaseUrl':f'https://github.com/{repository}/releases/tag/{tag}','sourceUrl':base+source,'downloads':downloads}
out=args.output.parent/(args.output.name+'-preview-release.json')
out.write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps({'files':[p.name for p in args.output.iterdir()],'metadata':str(out),'bytes':sum(p.stat().st_size for p in args.output.iterdir())},indent=2))
