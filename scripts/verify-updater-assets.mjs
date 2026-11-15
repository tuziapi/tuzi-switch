import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { verifySignature, targets, manifest, signArtifact } from "./updater-assets.mjs";
function fixture(bytes) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = Buffer.from("01234567");
  const pub = Buffer.concat([
    Buffer.from("Ed"),
    id,
    publicKey.export({ type: "spki", format: "der" }).subarray(-32),
  ]);
  const signature = sign(
    null,
    createHash("blake2b512").update(bytes).digest(),
    privateKey,
  );
  const comment = "timestamp:1";
  const global = sign(
    null,
    Buffer.concat([signature, Buffer.from(comment)]),
    privateKey,
  );
  return {
    pub: Buffer.from(
      `untrusted comment: test\n${pub.toString("base64")}\n`,
    ).toString("base64"),
    sig: Buffer.from(
      `untrusted comment: test\n${Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
    ).toString("base64"),
  };
}
test("accepts authentic minisign and rejects modified payload, key and comment", () => {
  const bytes = Buffer.from("synthetic package"),
    f = fixture(bytes);
  verifySignature(bytes, f.sig, f.pub);
  assert.throws(() => verifySignature(Buffer.from("modified"), f.sig, f.pub));
  assert.throws(() => verifySignature(bytes, f.sig, fixture(bytes).pub));
  const altered = Buffer.from(
    Buffer.from(f.sig, "base64")
      .toString()
      .replace("timestamp:1", "timestamp:2"),
  ).toString("base64");
  assert.throws(() => verifySignature(bytes, altered, f.pub));
});
test("covers each native installer without mixing MSI/EXE or DEB/AppImage", () => {
  const all = Object.values(targets).flatMap(Object.entries);
  assert.equal(all.length, 7);
  assert.deepEqual(targets["windows-x64"], {
    "windows-x86_64-nsis": ".exe",
    "windows-x86_64-msi": ".msi",
  });
  assert.equal(targets["linux-x64"]["linux-x86_64-deb"], ".deb");
  assert.equal(targets["linux-x64"]["linux-x86_64-rpm"], ".rpm");
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import channels from "./release-channel.cjs";
import { verifyReleaseIdentity } from "./verify-release-identity.mjs";

test("installed CLI signs with an encrypted key file despite build key environment", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tuzi-signer-test-"));
  const key = path.join(temp, "SYNTHETIC.key");
  const target = path.join(temp, "synthetic.txt");
  const password = "SYNTHETIC-test-password";
  const names = ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    execFileSync(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "signer", "generate", "--ci", "-p", password, "-w", key], { stdio: "pipe" });
    const pubkey = fs.readFileSync(`${key}.pub`, "utf8").trim();
    t.mock.method(channels, "releaseChannel", () => ({ pubkey }));
    fs.writeFileSync(target, "SYNTHETIC signing regression");
    process.env.TAURI_SIGNING_PRIVATE_KEY = key;
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = path.join(temp, "unused.key");
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password;
    signArtifact(target);
    verifySignature(fs.readFileSync(target), fs.readFileSync(`${target}.sig`, "utf8"), pubkey);
    assert.equal(process.env.TAURI_SIGNING_PRIVATE_KEY, key);
    fs.rmSync(`${target}.sig`);
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "SYNTHETIC-wrong-password";
    assert.throws(() => signArtifact(target), /Could not sign synthetic.txt/);
    assert.equal(fs.existsSync(`${target}.sig`), false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("official and test releases use different, existing trust roots", () => {
  const official = channels.releaseChannel({});
  const testChannel = channels.releaseChannel({
    VITE_RELEASE_REPOSITORY: "AiW520/tuzi-switch",
  });
  assert.equal(official.repository, "tuziapi/tuzi-switch");
  assert.notEqual(official.pubkey, testChannel.pubkey);
  assert.equal(
    official.pubkey,
    JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json")).plugins.updater
      .pubkey,
  );
  assert.throws(() =>
    channels.releaseChannel({ GITHUB_REPOSITORY: "untrusted/repo" }),
  );
  for (const channel of [official, testChannel]) {
    const config = JSON.parse(
      execFileSync(process.execPath, ["scripts/tauri-release-config.cjs"], {
        env: { ...process.env, VITE_RELEASE_REPOSITORY: channel.repository },
        encoding: "utf8",
      }),
    );
    assert.equal(config.plugins.updater.pubkey, channel.pubkey);
    assert.deepEqual(config.plugins.updater.endpoints, [
      `https://github.com/${channel.repository}/releases/latest/download/latest.json`,
    ]);
  }
});

test("build-only accepts a branch; publishing requires a matching tag and all four versions", () => {
  const input = {
    version: "1.5.5",
    tauriVersion: "1.5.5",
    cargo: '[package]\nversion = "1.5.5"\n',
    lock: 'name = "tu-zi-switch"\nversion = "1.5.5"\n',
    ref: "refs/heads/build",
    publish: false,
  };
  assert.equal(verifyReleaseIdentity(input), "v1.5.5");
  assert.throws(() =>
    verifyReleaseIdentity({
      ...input,
      cargo:
        '[package]\nversion = "1.4.3"\n[dependencies.example]\nversion = "1.5.5"\n',
    }),
  );
  assert.throws(() => verifyReleaseIdentity({ ...input, publish: true }));
  assert.equal(
    verifyReleaseIdentity({ ...input, ref: "refs/tags/v1.5.5", publish: true }),
    "v1.5.5",
  );
  assert.throws(() =>
    verifyReleaseIdentity({ ...input, ref: "refs/tags/v1.5.4" }),
  );
  assert.throws(() =>
    verifyReleaseIdentity({
      ...input,
      lock: input.lock.replace("1.5.5", "1.5.4"),
    }),
  );
});

test("complete signed manifest rejects cross-channel manifests and tampered installers", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tuzi-manifest-test-"));
  const bytes = Buffer.from("SYNTHETIC installer"),
    f = fixture(bytes);
  const version = JSON.parse(fs.readFileSync("package.json")).version;
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (filename, ...args) => {
    if (String(filename).endsWith("src-tauri/tauri.conf.json"))
      return JSON.stringify({ plugins: { updater: { pubkey: f.pub } } });
    if (String(filename).endsWith("scripts/aiw520-updater.pub")) return f.pub;
    return read(filename, ...args);
  });
  try {
    for (const repository of ["tuziapi/tuzi-switch", "AiW520/tuzi-switch"]) {
      const env = {
        GITHUB_REPOSITORY: repository,
        GITHUB_SHA: "a".repeat(40),
        GITHUB_RUN_ID: "123",
        RELEASE_TAG: `v${version}`,
      };
      for (const [name, entries] of Object.entries(targets)) {
        fs.writeFileSync(
          path.join(temp, `manifest-${name}.json`),
          JSON.stringify({
            version,
            repository,
            commit: env.GITHUB_SHA,
            run: "123",
          }),
        );
        for (const ext of Object.values(entries)) {
          fs.writeFileSync(
            path.join(temp, `tuzi-assistant-${name}${ext}`),
            bytes,
          );
          fs.writeFileSync(
            path.join(temp, `tuzi-assistant-${name}${ext}.sig`),
            f.sig,
          );
        }
      }
      if (repository === 'AiW520/tuzi-switch') {
        const protectedEnv={...env,TUZI_SWITCH_RELEASE_REPOSITORY:'tuziapi/tuzi-switch',TUZI_OFFICIAL_TEST_CANDIDATE:'1'};
        assert.throws(()=>manifest(temp,protectedEnv),/source mismatch/);
        for(const name of Object.keys(targets)) {
          const file=path.join(temp,`manifest-${name}.json`);
          fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file)),releaseRepository:'tuziapi/tuzi-switch'}));
        }
        const official=manifest(temp,protectedEnv);
        assert.ok(Object.values(official.platforms).every(p=>p.url.includes('/tuziapi/tuzi-switch/')));
        assert.throws(()=>manifest(temp,{...protectedEnv,TUZI_OFFICIAL_TEST_CANDIDATE:'0'}),/identity/);
      }
      const result = manifest(temp, env);
      assert.equal(Object.keys(result.platforms).length, 9);
      assert.ok(
        Object.values(result.platforms).every((p) =>
          p.url.startsWith(
            `https://github.com/${repository}/releases/download/v${version}/`,
          ),
        ),
      );
      assert.throws(
        () =>
          manifest(temp, {
            ...env,
            GITHUB_REPOSITORY:
              repository === "tuziapi/tuzi-switch"
                ? "AiW520/tuzi-switch"
                : "tuziapi/tuzi-switch",
          }),
        /source mismatch/,
      );
      fs.writeFileSync(
        path.join(temp, "tuzi-assistant-macos-arm64.app.tar.gz"),
        "tampered",
      );
      assert.throws(() => manifest(temp, env), /verification failed/);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
