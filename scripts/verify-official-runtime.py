import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location("preview_collector", Path(__file__).with_name("collect-opentu-test-installer.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def verify_resources(root, node, provenance):
    packaged = json.loads((root / "claude-local-runtime/provenance.json").read_text(encoding="utf-8"))
    assert packaged == provenance, "Packaged runtime provenance differs from verified source"
    for resource in ["claude-local-runtime/LICENSE-node.txt", "licenses/LICENSE-claude-local.txt", "licenses/NOTICE-claude-local.txt", "licenses/TUZI-PATCHES.md"]:
        assert (root / resource).is_file(), f"Missing redistribution material: {resource}"
    collector.probe_packaged_node(node, provenance["version"])
    verify_media_resources(root)


def verify_media_resources(root):
    media = root / "media-runtime"
    expected = json.loads(Path("src-tauri/target/media-runtime/provenance.json").read_text(encoding="utf-8"))
    packaged = json.loads((media / "provenance.json").read_text(encoding="utf-8"))
    assert packaged == expected, "Packaged compression provenance differs from build"
    engine = media / ("ffmpeg.exe" if expected["platform"] == "win32" else "ffmpeg")
    assert collector.digest(engine) == expected["binarySha256"], "Compression engine bytes changed"
    for source in expected["sources"]:
        assert Path(source["file"]).name == source["file"]
        assert collector.digest(media / "sources" / source["file"]) == source["sha256"]
    for name in ["COPYING.GPLv2", "COPYING.x264", "COPYING.pkgconf", "README.txt", "sources/prepare-media-runtime.mjs"]:
        assert (media / name).is_file(), f"Missing compression source or notice: {name}"
    output = subprocess.check_output([str(engine.resolve()), "-version"], text=True, timeout=15)
    assert "--disable-network" in output and "--enable-libx264" in output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    args = parser.parse_args()
    bundle = Path("src-tauri/target") / args.target / "release/bundle"
    provenance = json.loads((Path("src-tauri/target/claude-local-runtime") / args.target / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["target"] == args.target and provenance["runtimeProbe"] == "passed"
    version = json.loads(Path("package.json").read_text(encoding="utf-8"))["version"]
    if "apple" in args.target:
        installers = list(bundle.rglob("*.dmg"))
        assert len(installers) == 1
        with tempfile.TemporaryDirectory() as mount:
            subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, str(installers[0])], check=True)
            try:
                apps = list(Path(mount).glob("*.app"))
                assert len(apps) == 1
                app = apps[0]
                info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
                assert info["CFBundleIdentifier"] == "com.tuziswitch.desktop"
                assert info["CFBundleExecutable"] == "tu-zi-switch"
                assert info["CFBundleShortVersionString"] == version
                subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
                node = app / "Contents/MacOS/tuzi-claude-node"
                collector.verify_node_entitlements(node)
                verify_resources(app / "Contents/Resources", node, provenance)
            finally:
                subprocess.run(["hdiutil", "detach", mount], check=True)
    elif "windows" in args.target:
        installers = list(bundle.rglob("*.exe"))
        assert len(installers) == 1
        with tempfile.TemporaryDirectory() as directory:
            extractor = shutil.which("7z") or str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "7-Zip/7z.exe")
            subprocess.run([extractor, "x", "-y", str(installers[0].resolve()), "-o" + directory], check=True, stdout=subprocess.DEVNULL)
            nodes = list(Path(directory).rglob("tuzi-claude-node.exe"))
            assert len(nodes) == 1
            verify_resources(nodes[0].parent, nodes[0], provenance)
        msi_files = list(bundle.rglob("*.msi"))
        assert len(msi_files) == 1
        with tempfile.TemporaryDirectory() as directory:
            # Administrative extraction checks MSI's actual resource table;
            # NSIS success cannot prove MSI includes newly added resources.
            subprocess.run(["msiexec", "/a", str(msi_files[0].resolve()), "/qn", "TARGETDIR=" + directory], check=True, timeout=120)
            nodes = list(Path(directory).rglob("tuzi-claude-node.exe"))
            assert len(nodes) == 1
            verify_resources(nodes[0].parent, nodes[0], provenance)
    else:
        installers = list(bundle.rglob("*.deb"))
        assert len(installers) == 1
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(["dpkg-deb", "-x", str(installers[0]), directory], check=True)
            root = Path(directory)
            assert (root / "usr/bin/tu-zi-switch").is_file()
            metadata = list(root.rglob("claude-local-runtime/provenance.json"))
            assert len(metadata) == 1
            verify_resources(metadata[0].parent.parent, root / "usr/bin/tuzi-claude-node", provenance)
    print(f"Verified stable identity, packaged runtime and redistribution materials: {args.target}")


if __name__ == "__main__":
    main()
