import importlib.util
import hashlib
import io
import os
import plistlib
from pathlib import Path
import tarfile
import stat
import struct
import warnings
import zipfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("stage_node", Path(__file__).with_name("prepare-claude-local-node.py"))
stage_node = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage_node)
build_spec = importlib.util.spec_from_file_location("build_candidate", Path(__file__).with_name("build-claude-local-candidate.py"))
build_candidate = importlib.util.module_from_spec(build_spec)
build_spec.loader.exec_module(build_candidate)


class NodeArchiveTests(unittest.TestCase):
    def test_official_build_preserves_identity_and_signed_updates_with_runtime(self):
        channel = {"plugins": {"updater": {"pubkey": "synthetic-public-key", "endpoints": ["https://github.com/tuziapi/tuzi-switch/releases/latest/download/latest.json"]}}}
        for target in stage_node.TARGETS:
            config = build_candidate.stable_config(target, channel)
            self.assertTrue(config["bundle"]["createUpdaterArtifacts"])
            self.assertEqual(config["plugins"], channel["plugins"])
            self.assertNotIn("identifier", config)
            self.assertNotIn("mainBinaryName", config)
            self.assertIn("licenses/LICENSE-claude-local.txt", config["bundle"]["resources"].values())
            self.assertTrue(config["bundle"]["externalBin"][0].endswith("/tuzi-claude-node"))
        test_channel = {"plugins": {"updater": {"pubkey": "synthetic-test-key", "endpoints": ["https://github.com/AiW520/tuzi-switch/releases/latest/download/latest.json"]}}}
        self.assertEqual(build_candidate.stable_config("aarch64-apple-darwin", test_channel)["plugins"], test_channel["plugins"])
        with self.assertRaisesRegex(ValueError, "supported updater"):
            build_candidate.stable_config("aarch64-apple-darwin", {"plugins": {"updater": {"endpoints": []}}})

    def test_published_preview_is_versioned_isolated_and_has_linux_binary_names(self):
        with self.assertRaisesRegex(ValueError, "isolated"):
            build_candidate.build_config("x86_64-pc-windows-msvc", False, True)
        for target in stage_node.TARGETS:
            config = build_candidate.build_config(target, True, True)
            self.assertEqual(config["version"], "1.6.3-beta.5")
            self.assertEqual(config["mainBinaryName"], "tuzi-opentu-preview")
            self.assertFalse(config["bundle"]["createUpdaterArtifacts"])
            self.assertEqual(config["plugins"]["updater"]["endpoints"], [])
            if "apple" in target:
                self.assertEqual(config["bundle"]["macOS"]["signingIdentity"], "-")
            if "linux" in target:
                self.assertEqual(config["productName"], "OpenTu Preview")
                self.assertTrue(config["bundle"]["externalBin"][0].endswith("/tuzi-opentu-preview-node"))
        self.assertEqual(build_candidate.bundle_kind("aarch64-apple-darwin", True), "dmg")

    def test_macos_signing_keeps_only_required_jit_entitlement_and_hardened_runtime(self):
        for target in ["aarch64-apple-darwin", "x86_64-apple-darwin"]:
            for preview, published in [(False, False), (True, False), (True, True)]:
                config = build_candidate.build_config(target, preview, published)["bundle"]["macOS"]
                self.assertTrue(config["hardenedRuntime"])
                entitlements = build_candidate.ROOT / "src-tauri" / config["entitlements"]
                self.assertEqual(plistlib.loads(entitlements.read_bytes()), {"com.apple.security.cs.allow-jit": True})

    def test_combined_preview_keeps_separate_identity_and_packaged_runtime(self):
        config = build_candidate.build_config("aarch64-apple-darwin", True)
        self.assertEqual(config["identifier"], "com.tuziswitch.desktop.opentu-preview")
        self.assertEqual(config["plugins"]["updater"]["endpoints"], [])
        self.assertEqual(config["plugins"]["deep-link"]["desktop"]["schemes"], ["tuzi-opentu-preview"])
        self.assertFalse(config["bundle"]["createUpdaterArtifacts"])
        self.assertTrue(config["bundle"]["externalBin"])
        self.assertIn("licenses/LICENSE-claude-local.txt", config["bundle"]["resources"].values())
        normal = build_candidate.build_config("aarch64-apple-darwin")
        self.assertNotIn("identifier", normal)

    def test_windows_build_avoids_batch_shell_for_paths_with_metacharacters(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "project & test"
            entry = parent / "node_modules/pnpm/bin/pnpm.cjs"
            entry.parent.mkdir(parents=True)
            entry.write_text("// synthetic fixture")
            config = str(parent / "candidate.conf.json")
            command = build_candidate.pnpm_command(["tauri", "build", "--config", config], str(parent / "pnpm.cmd"), True)
            self.assertEqual(command[1:], [str(entry), "tauri", "build", "--config", config])
            self.assertFalse(command[0].lower().endswith((".cmd", ".bat")))

    def test_windows_staging_publishes_matching_binary_license_and_provenance(self):
        target = "x86_64-pc-windows-msvc"
        suffix, _, kind, machine = stage_node.TARGETS[target]
        data = bytearray(128)
        data[:2] = b"MZ"
        struct.pack_into("<I", data, 60, 64)
        data[64:68] = b"PE\0\0"
        struct.pack_into("<H", data, 68, machine)
        archive = io.BytesIO()
        prefix = f"node-v{stage_node.VERSION}-win-x64"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr(prefix + "/node.exe", data)
            output.writestr(prefix + "/LICENSE", "synthetic test license")
        payload = archive.getvalue()
        checksum = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory, \
            patch.dict(stage_node.TARGETS, {target: (suffix, checksum, kind, machine)}), \
            patch.object(stage_node, "native_target", return_value="aarch64-apple-darwin"), \
            patch.object(stage_node.urllib.request, "urlopen", return_value=io.BytesIO(payload)):
            record = stage_node.stage_runtime(target, Path(directory))
            self.assertEqual(record["runtimeProbe"], "not-run-cross-target")
            self.assertEqual(record["binarySha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual((Path(directory) / "LICENSE-node.txt").read_text(), "synthetic test license")
            self.assertEqual(list(Path(directory).glob("*.download")), [])

    def test_failed_download_preserves_existing_staged_runtime(self):
        with tempfile.TemporaryDirectory() as directory, \
            patch.object(stage_node.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt archive")):
            output = Path(directory)
            sentinel = output / "provenance.json"
            sentinel.write_text("old verified metadata")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                stage_node.stage_runtime("x86_64-pc-windows-msvc", output)
            self.assertEqual(sentinel.read_text(), "old verified metadata")
            self.assertEqual(list(output.glob("*.download")), [])

    def test_candidates_cannot_mix_runtime_provenance_between_targets(self):
        paths = set()
        for target in stage_node.TARGETS:
            config = build_candidate.build_config(target)["bundle"]
            self.assertFalse(config["createUpdaterArtifacts"])
            provenance = next(p for p in config["resources"] if p.endswith("provenance.json"))
            self.assertEqual(Path(provenance).parent, Path(config["externalBin"][0]).parent)
            self.assertNotIn(provenance, paths)
            paths.add(provenance)

    def test_cross_os_builds_fail_before_side_effects(self):
        for target in stage_node.TARGETS:
            build_candidate.validate_host(target, target)
        build_candidate.validate_host("x86_64-apple-darwin", "aarch64-apple-darwin")
        with self.assertRaisesRegex(ValueError, "target operating system"):
            build_candidate.validate_host("x86_64-pc-windows-msvc", "aarch64-apple-darwin")

    def extract(self, kind, limit):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "node"
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w") as archive:
                member = tarfile.TarInfo("bin/node")
                member.type = kind
                member.size = 4 if kind == tarfile.REGTYPE else 0
                member.linkname = "../../outside"
                archive.addfile(member, io.BytesIO(b"NODE") if member.size else None)
            buffer.seek(0)
            with tarfile.open(fileobj=buffer) as archive:
                stage_node.extract_member(archive, "bin/node", output, limit, 0o755)
            self.assertEqual(output.read_bytes(), b"NODE")
            if os.name != "nt":
                self.assertEqual(output.stat().st_mode & 0o777, 0o755)

    def test_extracts_only_regular_verified_member(self):
        self.extract(tarfile.REGTYPE, 4)

    def test_rejects_symbolic_link(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.extract(tarfile.SYMTYPE, 4)

    def test_rejects_hard_link(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.extract(tarfile.LNKTYPE, 4)

    def test_rejects_oversized_binary(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.extract(tarfile.REGTYPE, 3)

    def zip_extract(self, mode=stat.S_IFREG | 0o755, duplicates=False, limit=4):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "node.exe"
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                member = zipfile.ZipInfo("node/node.exe")
                member.create_system = 3
                member.external_attr = mode << 16
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr(member, b"NODE")
                    if duplicates:
                        archive.writestr(member, b"EVIL")
            buffer.seek(0)
            with zipfile.ZipFile(buffer) as archive:
                stage_node.extract_zip_member(archive, "node/node.exe", output, limit, 0o755)
            self.assertEqual(output.read_bytes(), b"NODE")

    def test_windows_zip_regular_file(self):
        self.zip_extract()

    def test_windows_zip_rejects_symlink(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.zip_extract(mode=stat.S_IFLNK | 0o777)

    def test_windows_zip_rejects_duplicate_executable(self):
        with self.assertRaisesRegex(ValueError, "duplicate archive member"):
            self.zip_extract(duplicates=True)

    def test_windows_zip_rejects_oversized_executable(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.zip_extract(limit=3)

    def test_cross_platform_architecture_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "node"
            for target, (_, _, kind, machine) in stage_node.TARGETS.items():
                data = bytearray(128)
                if kind == "macho":
                    data[:4] = b"\xcf\xfa\xed\xfe"
                    struct.pack_into("<I", data, 4, machine)
                elif kind == "elf":
                    data[:6] = b"\x7fELF\x02\x01"
                    struct.pack_into("<H", data, 18, machine)
                else:
                    data[:2] = b"MZ"
                    struct.pack_into("<I", data, 60, 64)
                    data[64:68] = b"PE\0\0"
                    struct.pack_into("<H", data, 68, machine)
                binary.write_bytes(data)
                stage_node.verify_binary(binary, target)
                for wrong in stage_node.TARGETS.keys() - {target}:
                    with self.assertRaisesRegex(ValueError, "architecture"):
                        stage_node.verify_binary(binary, wrong)

    def test_truncated_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "node"
            binary.write_bytes(b"MZ")
            for target in stage_node.TARGETS:
                with self.assertRaisesRegex(ValueError, "architecture"):
                    stage_node.verify_binary(binary, target)


if __name__ == "__main__":
    unittest.main()
