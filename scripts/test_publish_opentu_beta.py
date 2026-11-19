import hashlib,importlib.util,json,pathlib,subprocess,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publish',ROOT/'scripts/publish-opentu-beta-assets.py')
publish=importlib.util.module_from_spec(spec);spec.loader.exec_module(publish)
PLATFORMS={'macos-arm64':('aarch64-apple-darwin','.dmg'),'macos-x64':('x86_64-apple-darwin','.dmg'),'windows-x64':('x86_64-pc-windows-msvc','.exe'),'linux-x64':('x86_64-unknown-linux-gnu','.deb'),'linux-arm64':('aarch64-unknown-linux-gnu','.deb')}
class PublicationChecks(unittest.TestCase):
 def test_creation_uses_response_even_when_release_list_is_stale(self):
  draft={'tag_name':publish.TAG,'id':123,'draft':True,'prerelease':True}
  with patch.object(publish,'gh',return_value=json.dumps(draft)) as request, patch.object(publish,'api',return_value=[]) as stale_list:
   self.assertEqual(publish.create_draft('a'*40),draft)
   stale_list.assert_not_called()
   self.assertEqual(request.call_count,1)
  with patch.object(publish,'gh',return_value=json.dumps({**draft,'draft':False})):
   with self.assertRaises(AssertionError):publish.create_draft('a'*40)

 def test_draft_resume_cannot_replace_a_published_release(self):
  draft={'tag_name':publish.TAG,'id':123,'draft':True,'prerelease':True}
  self.assertIsNone(publish.select_draft([]))
  self.assertEqual(publish.select_draft([draft]),draft)
  for releases in [[{**draft,'draft':False}],[{**draft,'prerelease':False}],[draft,draft]]:
   with self.assertRaises(AssertionError):publish.select_draft(releases)

 def test_remote_digest_matching_and_rejection(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'synthetic.bin';p.write_bytes(b'synthetic')
   asset={'name':p.name,'size':p.stat().st_size,'digest':publish.digest(p),'state':'uploaded'}
   publish.verify_assets({'assets':[asset]},[p])
   for field,value in [('digest','sha256:'+'0'*64),('size',1),('state','new'),('name','different')]:
    with self.assertRaises(AssertionError):publish.verify_assets({'assets':[{**asset,field:value}]},[p])
   with self.assertRaises(AssertionError):publish.verify_assets({'assets':[]},[p])
 def test_preparation_validates_all_five_before_publication(self):
  with tempfile.TemporaryDirectory() as d:
   base=pathlib.Path(d);subprocess.run(['git','init','-q',str(base)],check=True)
   (base/'synthetic.txt').write_text('synthetic source only')
   subprocess.run(['git','add','.'],cwd=base,check=True)
   subprocess.run(['git','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','synthetic'],cwd=base,check=True)
   sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=base,text=True).strip()
   files=[]
   for platform,(target,suffix) in PLATFORMS.items():
    folder=base/'artifacts'/platform;folder.mkdir(parents=True)
    name=f'OpenTu-Preview-1.6.3-beta.5-{platform}{suffix}';p=folder/name;p.write_bytes(b'synthetic '+platform.encode())
    m={'commit':sha,'runId':'123','repository':'AiW520/tuzi-switch','channel':'preview','version':'1.6.3-beta.5','target':target,'platform':platform,'applicationId':'com.tuziswitch.desktop.opentu-preview','isolatedProfile':True,'automaticUpdates':False,'file':name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'checks':['native-runtime-probe','release-native-integration','packaged-node-script-executed','node-jit-entitlement']}
    f=folder/(platform+'.json');f.write_text(json.dumps(m));files.append(f)
   def run(label):return subprocess.run(['python3',str(ROOT/'scripts/prepare-opentu-beta-assets.py'),'--artifacts',str(base/'artifacts'),'--output',str(base/label),'--sha',sha,'--run','123'],cwd=base,capture_output=True,text=True)
   self.assertEqual(run('good').returncode,0)
   self.assertEqual(len(list((base/'good').iterdir())),8)
   for i,(field,value) in enumerate([('repository','tuziapi/tuzi-switch'),('commit','0'*40),('sha256','0'*64),('automaticUpdates',True),('runId','124'),('checks',['native-runtime-probe','release-native-integration']),('checks',['native-runtime-probe','release-native-integration','packaged-node-script-executed'])]):
    f=files[0];original=f.read_text();m=json.loads(original);m[field]=value;f.write_text(json.dumps(m))
    self.assertNotEqual(run('bad'+str(i)).returncode,0,field);f.write_text(original)
   files[-1].unlink();self.assertNotEqual(run('missing').returncode,0)
if __name__ == "__main__":
 unittest.main()
