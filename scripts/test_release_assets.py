import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('verify-release-assets.py').resolve()
class ReleaseAssetsTest(unittest.TestCase):
    def run_case(self, mutation=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'package.json').write_text('{"version":"1.5.0"}')
            assets = root/'assets'; assets.mkdir()
            env = dict(os.environ, GITHUB_REPOSITORY='AiW520/tuzi-switch', GITHUB_SHA='a'*40, GITHUB_RUN_ID='123')
            for name, target, suffixes in [('macos-arm64','aarch64-apple-darwin',['.dmg']),('macos-x64','x86_64-apple-darwin',['.dmg']),('windows-x64','x86_64-pc-windows-msvc',['.exe','.msi']),('linux-x64','x86_64-unknown-linux-gnu',['.AppImage','.deb','.rpm'])]:
                files=[]
                for ext in suffixes:
                    file=f'tuzi-assistant-{name}{ext}'; data=b'SYNTHETIC installer'; (assets/file).write_bytes(data)
                    files.append(dict(file=file,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
                m=dict(repository=env['GITHUB_REPOSITORY'],commit=env['GITHUB_SHA'],run='123',target=target,version='1.5.0',channel='stable',applicationId='com.tuziswitch.desktop',isolatedLocalProfile=False,files=files)
                (assets/f'manifest-{name}.json').write_text(json.dumps(m))
            if mutation: mutation(assets)
            return subprocess.run([sys.executable,str(SCRIPT),'assets'],cwd=root,env=env,capture_output=True).returncode
    def test_complete(self): self.assertEqual(self.run_case(),0)
    def test_tampering(self): self.assertNotEqual(self.run_case(lambda a:(a/'tuzi-assistant-macos-arm64.dmg').write_bytes(b'changed')),0)
    def test_missing(self): self.assertNotEqual(self.run_case(lambda a:(a/'tuzi-assistant-windows-x64.exe').unlink()),0)
    def test_test_identity(self):
        def change(a):
            p=a/'manifest-macos-arm64.json'; m=json.loads(p.read_text());m['applicationId']='com.tuziswitch.desktop.acceptance';p.write_text(json.dumps(m))
        self.assertNotEqual(self.run_case(change),0)
if __name__=='__main__': unittest.main()
