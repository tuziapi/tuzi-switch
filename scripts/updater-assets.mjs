import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const targets = {
  "macos-arm64": { "darwin-aarch64": ".app.tar.gz" },
  "macos-x64": { "darwin-x86_64": ".app.tar.gz" },
  "windows-x64": {
    "windows-x86_64-nsis": ".exe",
    "windows-x86_64-msi": ".msi",
  },
  "linux-x64": {
    "linux-x86_64-appimage": ".AppImage",
    "linux-x86_64-deb": ".deb",
    "linux-x86_64-rpm": ".rpm",
  },
};
export function verifySignature(bytes, encodedSignature, encodedKey) {
  const keyLines = Buffer.from(encodedKey.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const lines = Buffer.from(encodedSignature.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const key = Buffer.from(keyLines[1] ?? "", "base64");
  const sig = Buffer.from(lines[1] ?? "", "base64");
  const globalSig = Buffer.from(lines[3] ?? "", "base64");
  if (
    key.length !== 42 ||
    sig.length !== 74 ||
    globalSig.length !== 64 ||
    !lines[2]?.startsWith("trusted comment: ") ||
    !key.subarray(2, 10).equals(sig.subarray(2, 10))
  )
    throw Error("Invalid updater signature identity");
  const algorithm = sig.subarray(0, 2).toString();
  if (!["Ed", "ED"].includes(algorithm))
    throw Error("Unknown signature algorithm");
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  const content =
    algorithm === "ED"
      ? createHash("blake2b512").update(bytes).digest()
      : bytes;
  if (
    !verify(null, content, publicKey, sig.subarray(10)) ||
    !verify(
      null,
      Buffer.concat([sig.subarray(10), Buffer.from(lines[2].slice(17))]),
      publicKey,
      globalSig,
    )
  )
    throw Error("Updater signature verification failed");
}
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
export function collect(source, output, name) {
  if (!targets[name]) throw Error("Unknown build target");
  for (const ext of Object.values(targets[name])) {
    const filename = `tuzi-assistant-${name}${ext}`;
    const target = path.join(output, filename);
    if (!fs.existsSync(target)) {
      const candidates = walk(source).filter((p) => p.endsWith(ext));
      if (candidates.length !== 1)
        throw Error(`Expected one updater artifact: ${name}${ext}`);
      fs.copyFileSync(candidates[0], target);
    }
    const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY;
    if (!keyPath || !fs.existsSync(keyPath))
      throw Error("Missing updater signing key file");
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
        "signer",
        "sign",
        "-f",
        keyPath,
        "-p",
        process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
        target,
      ],
      { stdio: "pipe" },
    );
    if (result.status !== 0) throw Error(`Could not sign ${filename}`);
    verifySignature(
      fs.readFileSync(target),
      fs.readFileSync(`${target}.sig`, "utf8"),
      fs.readFileSync(path.join(root, "scripts/aiw520-updater.pub"), "utf8"),
    );
  }
}
export function manifest(dir, env = process.env) {
  const version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const tag = env.GITHUB_REF_NAME;
  if (tag !== `v${version}` || env.GITHUB_REPOSITORY !== "AiW520/tuzi-switch")
    throw Error("Invalid updater release identity");
  const platforms = {};
  const pubkey = fs.readFileSync(
    path.join(root, "scripts/aiw520-updater.pub"),
    "utf8",
  );
  for (const [name, entries] of Object.entries(targets)) {
    const source = JSON.parse(
      fs.readFileSync(path.join(dir, `manifest-${name}.json`), "utf8"),
    );
    if (
      source.version !== version ||
      source.commit !== env.GITHUB_SHA ||
      source.run !== env.GITHUB_RUN_ID ||
      source.repository !== env.GITHUB_REPOSITORY
    )
      throw Error("Updater source mismatch");
    for (const [target, ext] of Object.entries(entries)) {
      const filename = `tuzi-assistant-${name}${ext}`;
      const signature = fs
        .readFileSync(path.join(dir, `${filename}.sig`), "utf8")
        .trim();
      verifySignature(
        fs.readFileSync(path.join(dir, filename)),
        signature,
        pubkey,
      );
      platforms[target] = {
        url: `https://github.com/${env.GITHUB_REPOSITORY}/releases/download/${tag}/${filename}`,
        signature,
      };
    }
  }
  // Compatibility for runtimes without an embedded installer type.
  platforms["windows-x86_64"] = platforms["windows-x86_64-nsis"];
  platforms["linux-x86_64"] = platforms["linux-x86_64-appimage"];
  const result = {
    version,
    notes: fs.readFileSync(path.join(root, `docs/releases/${tag}.md`), "utf8"),
    pub_date: new Date().toISOString(),
    platforms,
  };
  fs.writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "collect") collect(...process.argv.slice(3));
  else if (process.argv[2] === "manifest") manifest(process.argv[3]);
  else throw Error("Expected collect or manifest");
}
