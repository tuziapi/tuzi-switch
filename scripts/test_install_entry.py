"""Offline regression for the legacy official installer entry; never installs."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('install_tuzi_switch.sh').resolve()
PAYLOAD = b'synthetic AppImage; not executable'

class InstallerEntryTests(unittest.TestCase):
    def run_entry(self, *, corrupt=False, repository='tuziapi/tuzi-switch', tag='v1.5.5'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'uname').write_text('#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n')
            (root / 'sha256sum').write_text('#!/bin/sh\nexec shasum -a 256 "$@"\n')
            digest = '0' * 64 if corrupt else hashlib.sha256(PAYLOAD).hexdigest()
            (root / 'curl').write_text(f'''#!{sys.executable}
import pathlib,sys
args=sys.argv[1:]
url=next(a for a in args if a.startswith('https://'))
with open({str(root / 'urls')!r},'a') as f: f.write(url+'\\n')
if url.endswith('/latest'):
 print('https://github.com/tuziapi/tuzi-switch/releases/tag/v1.5.5',end='')
else:
 path=pathlib.Path(args[args.index('-o')+1])
 if url.endswith('/SHA256SUMS'): path.write_text({(digest+'  tuzi-assistant-linux-x64.AppImage'+chr(10))!r})
 elif url.endswith('/tuzi-assistant-linux-x64.AppImage'): path.write_bytes({PAYLOAD!r})
 else: sys.exit(8)
''')
            for name in ['uname', 'curl', 'sha256sum']:
                (root / name).chmod(0o755)
            env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'], TUZI_SWITCH_REPO=repository, TUZI_SWITCH_TAG=tag)
            result = subprocess.run(['bash', str(SCRIPT), '--verify-only'], env=env, capture_output=True, text=True)
            urls=(root/'urls').read_text() if (root/'urls').exists() else ''
            return result, urls

    def test_official_file_and_checksum(self):
        result, urls=self.run_entry()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Verified official v1.5.5', result.stdout)
        self.assertIn('/v1.5.5/tuzi-assistant-linux-x64.AppImage', urls)
        self.assertNotIn('mirror', urls)

    def test_tampered_payload_rejected(self):
        result, _=self.run_entry(corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Verified official', result.stdout)

    def test_latest_resolves_one_fixed_release(self):
        result, urls=self.run_entry(tag='latest')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('/releases/tag/', 'https://github.com/tuziapi/tuzi-switch/releases/tag/v1.5.5')
        self.assertIn('/download/v1.5.5/SHA256SUMS', urls)
        self.assertIn('/download/v1.5.5/tuzi-assistant-linux-x64.AppImage', urls)

    def test_other_repository_rejected_before_download(self):
        result, urls=self.run_entry(repository='AiW520/tuzi-switch')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(urls, '')

if __name__ == '__main__': unittest.main()
