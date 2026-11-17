#!/usr/bin/env python3
"""Read-only acceptance preflight. No keys, trust changes, installation or model calls."""
import argparse
import datetime
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess


def run(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        return {"ok": result.returncode == 0, "text": result.stdout.strip()}
    except (OSError, subprocess.TimeoutExpired):
        return {"ok": False, "text": ""}


def collect():
    system = platform.system()
    result = {
        "schemaVersion": 1,
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "system": system,
        "systemRelease": platform.release(),
        "architecture": platform.machine(),
        "freeGiB": round(shutil.disk_usage(Path.home()).free / 1024 ** 3, 2),
        "expectedClaudeVersion": "5.11492.5",
        "functionalAcceptance": False,
        "note": "Environment evidence only. Complete the manual acceptance matrix on the same candidate.",
    }
    if system == "Darwin":
        candidates = [Path("/Applications/Claude.app"), Path.home() / "Applications/Claude.app"]
        for app in candidates:
            info = app / "Contents/Info.plist"
            if info.is_file():
                with info.open("rb") as source:
                    result["claudeVersion"] = plistlib.load(source).get("CFBundleShortVersionString", "")
                result["claudeSignatureValid"] = run([
                    "/usr/bin/codesign", "--verify", "--deep", "--strict", "-R",
                    '=anchor apple generic and identifier "com.anthropic.claudefordesktop" and certificate leaf[subject.OU] = "Q6L2SF6YDW"',
                    str(app),
                ])["ok"]
                break
    elif system == "Windows":
        script = """$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$packages=@(Get-AppxPackage -Name Claude; Get-AppxPackage -Name AnthropicPBC.Claude) | Select-Object Name,PackageFamilyName,@{n='Version';e={$_.Version.ToString()}},@{n='Architecture';e={$_.Architecture.ToString()}},@{n='Status';e={$_.Status.ToString()}}
$services=@(Get-Service vmcompute,hns -ErrorAction SilentlyContinue | Select-Object Name,@{n='Status';e={$_.Status.ToString()}})
@{packages=@($packages);virtualizationServices=$services} | ConvertTo-Json -Depth 4 -Compress
"""
        probe = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script])
        try:
            result["windows"] = json.loads(probe["text"]) if probe["ok"] else {"probeFailed": True}
        except ValueError:
            result["windows"] = {"probeFailed": True}
    elif system == "Linux":
        result["claudePackage"] = run(["dpkg-query", "-W", "-f=${Status} ${Version} ${Architecture}", "claude-desktop"])
        result["kvmAccessible"] = os.access("/dev/kvm", os.R_OK | os.W_OK)
        result["tools"] = {name: shutil.which(name) is not None for name in (
            "certutil", "pkexec", "openssl", "qemu-system-x86_64" if platform.machine() == "x86_64" else "qemu-system-aarch64", "virtiofsd")}
        result["virtiofsdAvailable"] = result["tools"]["virtiofsd"] or Path("/usr/libexec/virtiofsd").is_file() or Path("/usr/lib/qemu/virtiofsd").is_file()
        result["unsupportedFeatures"] = ["dictation", "computerUse"]
        result["desktopSession"] = os.environ.get("XDG_SESSION_TYPE", "unknown")
        result["recommendedFreeGiB"] = 25
    else:
        result["unsupportedPlatform"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    body = json.dumps(collect(), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(body, encoding="utf-8")
    else:
        print(body, end="")


if __name__ == "__main__":
    main()
