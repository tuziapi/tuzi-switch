import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function verifyReleaseIdentity({
  version,
  tauriVersion,
  cargo,
  lock,
  ref,
  publish,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Invalid release version");
  const packageSection =
    cargo.match(/^\[package\]\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] ?? "";
  const cargoVersion = packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (
    tauriVersion !== version ||
    cargoVersion !== version ||
    !lock.includes(`name = "tu-zi-switch"\nversion = "${version}"\n`)
  )
    throw Error("Version mismatch");
  const tag = `v${version}`;
  if ((publish || ref.startsWith("refs/tags/")) && ref !== `refs/tags/${tag}`)
    throw Error("Publication requires the matching version tag");
  return tag;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const tag = verifyReleaseIdentity({
    version: JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    tauriVersion: JSON.parse(
      fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
    ).version,
    cargo: fs.readFileSync("src-tauri/Cargo.toml", "utf8"),
    lock: fs.readFileSync("src-tauri/Cargo.lock", "utf8"),
    ref: process.env.GITHUB_REF ?? "",
    publish: process.env.PUBLISH === "true",
  });
  fs.accessSync(`docs/releases/${tag}.md`);
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`Verified ${tag}; publication=${process.env.PUBLISH === "true"}`);
}
