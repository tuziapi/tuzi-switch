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
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    output = ROOT / "src-tauri/target" / target / "release"
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(os.environ["WINDIR"]) / "System32/whoami.exe", output / "tu-zi-switch.exe")
    subprocess.run(["node", sys.argv[1], "bundle", "--verbose", "--target", target,
                    "--bundles", "msi", "--no-sign", "--config", str(config_path)], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
