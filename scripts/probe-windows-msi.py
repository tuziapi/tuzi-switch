import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("candidate_builder", Path(__file__).with_name("build-claude-local-candidate.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def main():
    if os.name != "nt" or os.environ.get("GITHUB_REPOSITORY") != "AiW520/tuzi-switch" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise RuntimeError("This synthetic packaging probe requires a disposable hosted Windows runner")
    target = "x86_64-pc-windows-msvc"
    runtime = ROOT / "src-tauri/target/claude-local-runtime" / target
    builder.stage_node.stage_runtime(target, runtime)
    channel = json.loads(subprocess.check_output(["node", "scripts/tauri-release-config.cjs", "--desktop-product-name"], cwd=ROOT, text=True))
    config = builder.stable_config(target, channel)
    config["bundle"]["createUpdaterArtifacts"] = False
    config_path = runtime / "synthetic-msi-probe.json"
    output = ROOT / "src-tauri/target" / target / "release"
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(os.environ["WINDIR"]) / "System32/whoami.exe", output / "tu-zi-switch.exe")
    files = builder.per_user_msi.prepare_template(ROOT, config, output, runtime / "per-user-runtime.wxs")
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    subprocess.run(["node", sys.argv[1], "bundle", "--verbose", "--target", target,
                    "--bundles", "msi,nsis", "--no-sign", "--config", str(config_path)], cwd=ROOT, check=True)
    installers = list((output / "bundle/msi").glob("*.msi"))
    if len(installers) != 1:
        raise RuntimeError("Expected exactly one synthetic MSI")
    extracted = Path(os.environ["RUNNER_TEMP"]) / "synthetic-msi-extracted"
    subprocess.run(["msiexec.exe", "/a", str(installers[0]), "/qn", "TARGETDIR=" + str(extracted)], check=True, timeout=120)
    nodes = list(extracted.rglob("tuzi-claude-node.exe"))
    if len(nodes) != 1:
        raise RuntimeError("Packaged Node is missing or ambiguous")
    for source, destination in files.values():
        installed = nodes[0].parent.joinpath(*destination.parts)
        if installed.read_bytes() != source.read_bytes():
            raise RuntimeError("MSI resource name or contents differ: " + str(destination))
    subprocess.run([str(nodes[0]), "--version"], check=True, timeout=15)
    print("Synthetic MSI passed WiX validation, resource byte checks and packaged Node execution")
    subprocess.run([sys.executable, "scripts/verify-official-runtime.py", "--target", target], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
