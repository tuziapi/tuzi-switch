#!/usr/bin/env python3
"""Stage the pinned official Node sidecar for the local macOS ARM64 build."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = "24.22.3"
ARCHIVE = f"node-v{VERSION}-darwin-arm64.tar.gz"
SHA256 = "ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd"
URL = f"https://nodejs.org/dist/v{VERSION}/{ARCHIVE}"
TARGET = "aarch64-apple-darwin"
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def extract_member(archive, name, destination, limit, mode):
    member = archive.getmember(name)
    if not member.isfile() or not 0 < member.size <= limit:
        raise ValueError(f"Invalid archive member: {name}")
    # Extract only these explicit regular files, never archive paths or symlinks.
    with archive.extractfile(member) as source, destination.open("wb") as output:
        remaining = member.size
        while remaining:
            block = source.read(min(1024 * 1024, remaining))
            if not block:
                raise ValueError(f"Truncated archive member: {name}")
            output.write(block)
            remaining -= len(block)
    destination.chmod(mode)


def main():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("Claude P0 sidecar is currently verified only on macOS ARM64")
    root = Path(__file__).resolve().parents[1]
    output = root / "src-tauri/target/claude-local-runtime"
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / ARCHIVE
    if not archive_path.is_file() or digest(archive_path) != SHA256:
        with tempfile.NamedTemporaryFile(dir=output, suffix=".download", delete=False) as download:
            temporary = Path(download.name)
            try:
                with urllib.request.urlopen(URL, timeout=60) as response:
                    size = 0
                    while True:
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        size += len(block)
                        if size > MAX_ARCHIVE_BYTES:
                            raise ValueError("Node archive exceeds expected size")
                        download.write(block)
                download.flush()
                if digest(temporary) != SHA256:
                    raise ValueError("Official Node archive SHA-256 mismatch")
                os.replace(temporary, archive_path)
            finally:
                temporary.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(dir=output, prefix=".stage-") as stage:
        stage = Path(stage)
        binary = stage / f"tuzi-claude-node-{TARGET}"
        license_path = stage / "LICENSE-node.txt"
        with tarfile.open(archive_path, "r:gz") as archive:
            prefix = f"node-v{VERSION}-darwin-arm64"
            extract_member(archive, f"{prefix}/bin/node", binary, 150 * 1024 * 1024, 0o755)
            extract_member(archive, f"{prefix}/LICENSE", license_path, 2 * 1024 * 1024, 0o644)
        env = dict(os.environ)
        for key in ["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS"]:
            env.pop(key, None)
        subprocess.run(
            [str(binary), "-e", "if(process.version!=='v" + VERSION + "'||typeof fetch!=='function'||typeof WebSocket!=='function')process.exit(1)"],
            env=env, check=True, timeout=15, capture_output=True,
        )
        provenance = {"version": VERSION, "target": TARGET, "url": URL,
                      "archiveSha256": SHA256, "binarySha256": digest(binary)}
        for member in [binary, license_path]:
            os.replace(member, output / member.name)
        (output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(f"Verified Node {VERSION} staged for {TARGET}")


if __name__ == "__main__":
    main()
