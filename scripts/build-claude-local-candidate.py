#!/usr/bin/env python3
"""Build a local unsigned candidate using a target-specific pinned sidecar.

Does not install, launch, publish, change versions, or invoke remote workflows.
Run on the target OS; macOS supports native ARM and Intel cross-builds.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("stage_node", Path(__file__).with_name("prepare-claude-local-node.py"))
stage_node = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage_node)


def build_config(target, opentu_preview=False, test_release=False):
    if test_release and not opentu_preview:
        raise ValueError("Published test installers require the isolated OpenTu profile")
    if target not in stage_node.TARGETS:
        raise ValueError("Unsupported target")
    directory = f"target/claude-local-runtime/{target}"
    config = {"bundle": {
        "createUpdaterArtifacts": False,
        "externalBin": [f"{directory}/tuzi-claude-node"],
        "resources": {
            f"{directory}/LICENSE-node.txt": "claude-local-runtime/LICENSE-node.txt",
            f"{directory}/provenance.json": "claude-local-runtime/provenance.json",
            "vendor/claude-local/LICENSE": "licenses/LICENSE-claude-local.txt",
            "vendor/claude-local/NOTICE-TUZI.txt": "licenses/NOTICE-claude-local.txt",
            "vendor/claude-local/TUZI-PATCHES.md": "licenses/TUZI-PATCHES.md",
        },
    }}
    if "apple" in target:
        config["bundle"]["macOS"] = {
            "entitlements": "claude-local.entitlements.plist",
            "hardenedRuntime": True,
        }
    if opentu_preview:
        preview = json.loads((ROOT / "src-tauri/tauri.opentu-preview.conf.json").read_text(encoding="utf-8"))
        config["bundle"].update(preview.pop("bundle"))
        config.update(preview)
        if "linux" in target:
            config["productName"] = "OpenTu Preview"
            config["bundle"]["externalBin"] = [f"{directory}/tuzi-opentu-preview-node"]
    if test_release:
        config["version"] = "1.6.3-beta.5"
        if "apple" in target:
            config["bundle"]["macOS"]["signingIdentity"] = "-"
    return config


def bundle_kind(target, test_release=False):
    if "apple" in target:
        return "dmg" if test_release else "app"
    if "windows" in target:
        return "nsis"
    return "deb"


def validate_host(target, native):
    if target not in stage_node.TARGETS or native not in stage_node.TARGETS:
        raise ValueError("Unsupported target or host")
    if target.split("-", 1)[1] != native.split("-", 1)[1]:
        raise ValueError("Build on the target operating system; cross-OS packaging is not supported")


def pnpm_command(arguments, executable, windows=False):
    path = Path(executable)
    if windows and path.suffix.lower() in (".cmd", ".bat"):
        # Execute the JS entry through Node. Windows batch shims can interpret
        # shell metacharacters in a workspace path even with shell=False.
        entries = [path.parent / "node_modules/pnpm/bin/pnpm.cjs",
                   path.parent.parent / "pnpm/bin/pnpm.cjs",
                   path.parent / "node_modules/corepack/dist/pnpm.js"]
        entry = next((entry for entry in entries if entry.is_file()), None)
        if entry is None:
            raise ValueError("Cannot locate pnpm's Node entry; install pnpm with npm or use the standalone executable")
        return [shutil.which("node") or "node", str(entry), *arguments]
    return [executable, *arguments]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=sorted(stage_node.TARGETS))
    parser.add_argument("--dry-run", action="store_true", help="Print the local build plan without downloading or building")
    parser.add_argument("--opentu-preview", action="store_true", help="Combine Claude and OpenTu in the independent OpenTu acceptance app and profile")
    parser.add_argument("--test-release", action="store_true", help="Build optimized isolated 1.6.3-beta.5 installers; does not publish")
    args = parser.parse_args()
    target = args.target or stage_node.native_target()
    validate_host(target, stage_node.native_target())
    config_name = "opentu-candidate.conf.json" if args.opentu_preview else "candidate.conf.json"
    config_path = ROOT / "src-tauri/target/claude-local-runtime" / target / config_name
    compiler_host = stage_node.native_target()
    if shutil.which("rustc"):
        version = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True, timeout=15)
        compiler_host = next((line.removeprefix("host: ") for line in version.stdout.splitlines() if line.startswith("host: ")), compiler_host)
    target_flags = [] if target == compiler_host else ["--target", target]
    config = build_config(target, args.opentu_preview, args.test_release)
    command = ["pnpm", "tauri", "build", *([] if args.test_release else ["--debug"]), *target_flags,
               "--features", "claude-desktop-local,opentu-preview" if args.opentu_preview else "claude-desktop-local", "--bundles", bundle_kind(target, args.test_release),
               *([] if args.test_release else ["--no-sign"]), "--config", str(config_path)]
    if args.dry_run:
        print(json.dumps({"target": target, "command": command, "config": config}, indent=2))
        return
    command = pnpm_command(command[1:], shutil.which("pnpm") or shutil.which("pnpm.cmd") or "pnpm", os.name == "nt")
    output = config_path.parent
    provenance = stage_node.stage_runtime(target, output)
    binary = output / (f"tuzi-claude-node-{target}" + (".exe" if "windows" in target else ""))
    if provenance["target"] != target or provenance["binarySha256"] != stage_node.digest(binary):
        raise ValueError("Runtime provenance does not match the build target")
    if args.opentu_preview and "linux" in target:
        shutil.copy2(binary, output / f"tuzi-opentu-preview-node-{target}")
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    environment = dict(os.environ)
    environment["CARGO_INCREMENTAL"] = "0"
    subprocess.run(command, cwd=ROOT, env=environment, check=True)


if __name__ == "__main__":
    main()
