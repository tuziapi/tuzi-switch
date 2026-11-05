"""Isolated tests: official local DMGs, real macOS verification, no application launch.
TUZI_TEST_DMG_DIR supplies the matching release DMGs. Only curl is mocked to copy these;
public-network tests separately run --verify-only. Failure tests mock one tool.
"""
import os, pathlib, plistlib, pty, select, shlex, signal, subprocess, tempfile, time, unittest
SCRIPT = pathlib.Path(__file__).with_name("install-macos.sh").resolve()
FIXTURES = os.environ.get("TUZI_TEST_DMG_DIR", "")

@unittest.skipUnless(os.uname().sysname == "Darwin" and FIXTURES, "requires macOS and TUZI_TEST_DMG_DIR")
class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tuzi-installer-test-")
        self.root = pathlib.Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.dest = self.root / "Applications with spaces"
        self.dest.mkdir()
        self.app = self.dest / "兔子助手.app"
        self.home = self.root / "home"
        self.home.mkdir()
        self.config = self.home / "user-config-sentinel"
        self.config.write_text("keep user data")
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:/usr/bin:/bin:/usr/sbin:/sbin")
        self.tool("ps", "exit 0\n")  # Isolated test install; do not touch the user's running app.
        self.tool("curl", """out=''
while [ "$#" -gt 0 ]; do
  case "$1" in --output) out="$2"; shift 2;; *) url="$1"; shift;; esac
done
cp """ + shlex.quote(FIXTURES) + '/"$(basename "$url")" "$out"\n')

    def tearDown(self):
        self.assertEqual(self.config.read_text(), "keep user data")
        self.assertFalse(list(self.dest.glob(".tuzi-install.*")))
        self.temp.cleanup()

    def tool(self, name, body):
        p = self.bin / name
        p.write_text("#!/bin/bash\nset -e\n" + body)
        p.chmod(0o755)

    def old_app(self, version="1.5.5", identifier="com.tuziswitch.desktop"):
        (self.app / "Contents").mkdir(parents=True)
        with (self.app / "Contents/Info.plist").open("wb") as f:
            plistlib.dump({"CFBundleIdentifier": identifier, "CFBundleShortVersionString": version}, f)
        (self.app / "old-sentinel").write_text("old application")

    def run_installer(self, answers=(), args=()):
        pid, fd = pty.fork()
        if pid == 0:
            os.execve("/bin/bash", ["/bin/bash", str(SCRIPT), "--install-dir", str(self.dest), "--no-open", *args], self.env)
        output = b""
        answered = 0
        deadline = time.monotonic() + 90
        status = None
        try:
            while time.monotonic() < deadline:
                ready, _, _ = select.select([fd], [], [], 0.1)
                if ready:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        data = b""
                    output += data
                    if output.count(b"[y/N] ") > answered and answered < len(answers):
                        os.write(fd, (answers[answered] + "\n").encode())
                        answered += 1
                waited, state = os.waitpid(pid, os.WNOHANG)
                if waited:
                    status = state
                    break
            if status is None:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
                self.fail("Installer timed out: " + output.decode(errors="replace"))
        finally:
            os.close(fd)
        return os.waitstatus_to_exitcode(status), output.decode(errors="replace")

    def test_decline_before_download_keeps_old_app(self):
        self.old_app()
        self.tool("curl", "exit 99\n")
        code, output = self.run_installer(["n"])
        self.assertEqual(code, 0, output)
        self.assertTrue((self.app / "old-sentinel").exists())

    def test_network_failure_never_replaces(self):
        self.old_app()
        self.tool("curl", "exit 22\n")
        code, output = self.run_installer(["y"])
        self.assertNotEqual(code, 0, output)
        self.assertTrue((self.app / "old-sentinel").exists())

    def test_corrupt_download_fails_before_mount(self):
        self.old_app()
        self.tool("curl", """while [ "$#" -gt 0 ]; do
if [ "$1" = --output ]; then printf corrupted > "$2"; exit 0; fi
shift
done
""")
        code, output = self.run_installer(["y"])
        self.assertNotEqual(code, 0, output)
        self.assertIn("SHA-256 不匹配", output)
        self.assertTrue((self.app / "old-sentinel").exists())

    def test_decline_gatekeeper_consent_keeps_old_app(self):
        self.old_app()
        code, output = self.run_installer(["y", "n"])
        self.assertEqual(code, 0, output)
        self.assertIn("原应用未改动", output)
        self.assertTrue((self.app / "old-sentinel").exists())

    def test_real_install_preserves_backup_and_clears_only_new_app(self):
        self.old_app()
        subprocess.run(["xattr", "-w", "com.apple.quarantine", "0083;1234;test;", str(self.app)], check=True)
        code, output = self.run_installer(["y", "y"])
        self.assertEqual(code, 0, output)
        self.assertIn("安装完成", output)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(self.app)], check=True)
        backup = list(self.dest.glob(".tuzi-backup-*/兔子助手.app"))
        self.assertEqual(len(backup), 1)
        self.assertTrue((backup[0] / "old-sentinel").exists())
        self.assertNotIn("com.apple.quarantine", subprocess.check_output(["xattr", str(self.app)], text=True))
        self.assertIn("com.apple.quarantine", subprocess.check_output(["xattr", str(backup[0])], text=True))

    def test_failed_replacement_restores_backup(self):
        self.old_app()
        self.tool("mv", """case "$1" in */.tuzi-install.*/兔子助手.app) exit 1;; esac
exec /bin/mv "$@"
""")
        code, output = self.run_installer(["y", "y"])
        self.assertNotEqual(code, 0, output)
        self.assertTrue((self.app / "old-sentinel").exists())

    def test_newer_version_is_not_downgraded(self):
        self.old_app("1.6.0")
        code, output = self.run_installer()
        self.assertNotEqual(code, 0, output)
        self.assertIn("不会降级", output)

    def test_unrelated_app_is_not_replaced(self):
        self.old_app(identifier="example.other")
        code, output = self.run_installer()
        self.assertNotEqual(code, 0, output)
        self.assertIn("其他应用", output)

    def test_symlink_is_not_followed(self):
        self.app.symlink_to(self.home, target_is_directory=True)
        code, output = self.run_installer()
        self.assertNotEqual(code, 0, output)
        self.assertIn("符号链接", output)

    def test_running_app_is_not_replaced(self):
        self.old_app()
        self.tool("ps", "printf '/Applications/兔子助手.app/Contents/MacOS/tuzi-switch\\n'\n")
        code, output = self.run_installer()
        self.assertNotEqual(code, 0, output)
        self.assertIn("正在运行", output)

    def test_invalid_signature_is_not_bypassed(self):
        self.old_app()
        self.tool("codesign", "exit 1\n")
        code, output = self.run_installer(["y"])
        self.assertNotEqual(code, 0, output)
        self.assertIn("签名完整性校验失败", output)
        self.assertTrue((self.app / "old-sentinel").exists())

    def test_intel_and_rosetta_detection(self):
        self.tool("uname", 'if [ "$1" = -s ]; then echo Darwin; else echo x86_64; fi\n')
        for arm_capable, expected in [("0", "macos-x64.dmg"), ("1", "macos-arm64.dmg")]:
            with self.subTest(arm_capable=arm_capable):
                self.tool("sysctl", "echo " + arm_capable + "\n")
                code, output = self.run_installer(args=["--verify-only"])
                self.assertEqual(code, 0, output)
                self.assertIn(expected, output)

    def test_verify_only_both_architectures(self):
        for arch in ["arm64", "x64"]:
            with self.subTest(arch=arch):
                code, output = self.run_installer(args=["--verify-only", "--arch", arch])
                self.assertEqual(code, 0, output)
                self.assertIn("仅校验完成", output)
                self.assertFalse(self.app.exists())

if __name__ == "__main__":
    unittest.main(verbosity=2)
