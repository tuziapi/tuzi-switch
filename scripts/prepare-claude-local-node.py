#!/usr/bin/env python3
"""Stage a checksum-pinned Node sidecar for an explicit desktop target.

Cross-target extraction validates the binary architecture without executing it.
Only a matching host runs the runtime probe; provenance records that distinction.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import struct
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

VERSION = "24.22.3"
# Official v24.22.3 SHASUMS256.txt, fetched 2026-11-17. Adding a target is not
# a declaration that Claude itself is supported or has passed acceptance there.
TARGETS = {
    "aarch64-apple-darwin": ("darwin-arm64.tar.gz", "ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd", "macho", 0x100000C),
    "x86_64-apple-darwin": ("darwin-x64.tar.gz", "977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7", "macho", 0x1000007),
    "x86_64-pc-windows-msvc": ("win-x64.zip", "e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f", "pe", 0x8664),
    "aarch64-pc-windows-msvc": ("win-arm64.zip", "b3cc74a295b39d4f273271e96f58c06dd2b35757ca12abec64c7d0598b434f14", "pe", 0xAA64),
    "x86_64-unknown-linux-gnu": ("linux-x64.tar.xz", "4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb", "elf", 62),
    "aarch64-unknown-linux-gnu": ("linux-arm64.tar.xz", "6e51a2ada00f0011cc266f65d98922b403d7ad88f809ca2aa615a5fe1ce6e86c", "elf", 183),
}
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024


def native_target():
    machine = platform.machine()
    if platform.system() == "Windows":
        machine = os.environ.get("PROCESSOR_ARCHITEW6432", os.environ.get("PROCESSOR_ARCHITECTURE", machine))
    cpu = {"arm64": "aarch64", "aarch64": "aarch64", "x86_64": "x86_64", "amd64": "x86_64"}.get(machine.lower())
    system = {"Darwin": "apple-darwin", "Windows": "pc-windows-msvc", "Linux": "unknown-linux-gnu"}.get(platform.system())
    target = f"{cpu}-{system}"
    if target not in TARGETS:
        raise ValueError("Unsupported build host; specify a supported --target for extraction")
    return target


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def extract_member(archive, name, destination, limit, mode):
    members = [member for member in archive.getmembers() if member.name == name]
    if len(members) != 1:
        raise ValueError(f"Missing or duplicate archive member: {name}")
    member = members[0]
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


def extract_zip_member(archive, name, destination, limit, mode):
    members = [member for member in archive.infolist() if member.filename == name]
    if len(members) != 1:
        raise ValueError(f"Missing or duplicate archive member: {name}")
    member = members[0]
    file_type = stat.S_IFMT(member.external_attr >> 16)
    if member.is_dir() or file_type not in (0, stat.S_IFREG) or member.flag_bits & 1 or not 0 < member.file_size <= limit:
        raise ValueError(f"Invalid archive member: {name}")
    with archive.open(member) as source, destination.open("wb") as output:
        remaining = member.file_size
        while remaining:
            block = source.read(min(1024 * 1024, remaining))
            if not block:
                raise ValueError(f"Truncated archive member: {name}")
            output.write(block)
            remaining -= len(block)
    destination.chmod(mode)


def verify_binary(path, target):
    _, _, kind, machine = TARGETS[target]
    with path.open("rb") as source:
        header = source.read(64)
        actual = None
        if kind == "macho" and header[:4] == b"\xcf\xfa\xed\xfe" and len(header) >= 8:
            actual = struct.unpack_from("<I", header, 4)[0]
        elif kind == "elf" and header[:6] == b"\x7fELF\x02\x01" and len(header) >= 20:
            actual = struct.unpack_from("<H", header, 18)[0]
        elif kind == "pe" and header[:2] == b"MZ" and len(header) == 64:
            offset = struct.unpack_from("<I", header, 60)[0]
            if offset < 1024 * 1024:
                source.seek(offset)
                pe = source.read(6)
                if pe[:4] == b"PE\0\0" and len(pe) == 6:
                    actual = struct.unpack_from("<H", pe, 4)[0]
        if actual != machine:
            raise ValueError(f"Node executable architecture does not match {target}")


def stage_runtime(target, output):
    suffix, expected, _, _ = TARGETS[target]
    archive_name = f"node-v{VERSION}-{suffix}"
    url = f"https://nodejs.org/dist/v{VERSION}/{archive_name}"
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / archive_name
    if not archive_path.is_file() or digest(archive_path) != expected:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output, suffix=".download", delete=False) as download:
                temporary = Path(download.name)
                with urllib.request.urlopen(url, timeout=60) as response:
                    size = 0
                    while True:
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        size += len(block)
                        if size > MAX_ARCHIVE_BYTES:
                            raise ValueError("Node archive exceeds expected size")
                        download.write(block)
            # Windows cannot rename a NamedTemporaryFile while its handle is open.
            if digest(temporary) != expected:
                raise ValueError("Official Node archive SHA-256 mismatch")
            os.replace(temporary, archive_path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(dir=output, prefix=".stage-") as stage:
        stage = Path(stage)
        windows = "windows" in target
        binary = stage / (f"tuzi-claude-node-{target}" + (".exe" if windows else ""))
        license_path = stage / "LICENSE-node.txt"
        prefix = archive_name.removesuffix(".zip").removesuffix(".tar.gz").removesuffix(".tar.xz")
        if windows:
            with zipfile.ZipFile(archive_path) as archive:
                extract_zip_member(archive, f"{prefix}/node.exe", binary, 150 * 1024 * 1024, 0o755)
                extract_zip_member(archive, f"{prefix}/LICENSE", license_path, 2 * 1024 * 1024, 0o644)
        else:
            with tarfile.open(archive_path, "r:*") as archive:
                extract_member(archive, f"{prefix}/bin/node", binary, 150 * 1024 * 1024, 0o755)
                extract_member(archive, f"{prefix}/LICENSE", license_path, 2 * 1024 * 1024, 0o644)
        verify_binary(binary, target)
        env = dict(os.environ)
        for key in ["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS"]:
            env.pop(key, None)
        try:
            matches_host = target == native_target()
        except ValueError:
            matches_host = False
        if matches_host:
            subprocess.run(
                [str(binary.resolve()), "-e", "if(process.version!=='v" + VERSION + "'||typeof fetch!=='function'||typeof WebSocket!=='function')process.exit(1)"],
                env=env, check=True, timeout=15, capture_output=True,
            )
        provenance = {"version": VERSION, "target": target, "url": url,
                      "archiveSha256": expected, "binarySha256": digest(binary),
                      "architectureVerified": True,
                      "runtimeProbe": "passed" if matches_host else "not-run-cross-target"}
        (stage / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
        for member in [binary, license_path, stage / "provenance.json"]:
            os.replace(member, output / member.name)
    print(f"Verified Node {VERSION} staged for {target}; runtime probe: {provenance['runtimeProbe']}")
    return provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=sorted(TARGETS))
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "src-tauri/target/claude-local-runtime")
    args = parser.parse_args()
    stage_runtime(args.target or native_target(), args.output_dir)


if __name__ == "__main__":
    main()
