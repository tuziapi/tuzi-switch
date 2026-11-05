import { test } from "node:test";
import assert from "node:assert/strict";
import {
  macosInstallerTag,
  macosInstallerUrl,
  macosInstallCommand,
} from "../src/macosInstaller.js";
import {
  isStableRelease,
  createStableRelease,
  installerFormats,
  repository,
} from "../src/stableRelease.js";
function fixture() {
  const release = createStableRelease({
    draft: false,
    prerelease: false,
    tag_name: macosInstallerTag,
    html_url:
      "https://github.com/" + repository + "/releases/tag/" + macosInstallerTag,
    published_at: "2026-11-05T00:00:00Z",
    assets: installerFormats.map((p) => ({
      name: p.file,
      state: "uploaded",
      size: 123,
      digest: "sha256:" + "a".repeat(64),
      browser_download_url:
        "https://github.com/" +
        repository +
        "/releases/download/" +
        macosInstallerTag +
        "/" +
        p.file,
    })),
  });
  release.macosInstaller = {
    tag: macosInstallerTag,
    href: macosInstallerUrl,
    sha256: "b".repeat(64),
  };
  return release;
}
test("official script command verifies its checksum before execution", () => {
  const r = fixture();
  if (repository !== "tuziapi/tuzi-switch") {
    assert.equal(isStableRelease(r), false);
    assert.equal(macosInstallCommand(r), "");
    return;
  }
  assert.ok(isStableRelease(r));
  const command = macosInstallCommand(r);
  assert.ok(command.includes("set -e"));
  assert.ok(command.includes("mktemp"));
  assert.ok(command.includes(r.macosInstaller.sha256));
  assert.ok(
    command.indexOf("shasum") < command.indexOf('/bin/bash "$installer"'),
  );
  assert.ok(!command.includes("| bash"));
});
test("rejects substituted script host, hash, tag and channel", () => {
  for (const change of [
    (r) => {
      r.macosInstaller.href = "https://bad.test/script.sh";
    },
    (r) => {
      r.macosInstaller.sha256 = "'; touch /tmp/bad; #";
    },
    (r) => {
      r.macosInstaller.tag = "v1.5.4";
    },
    (r) => {
      r.repository = "AiW520/tuzi-switch";
    },
    (r) => {
      r.tag = "v1.5.6";
    },
  ]) {
    const r = fixture();
    change(r);
    assert.equal(macosInstallCommand(r), "");
    assert.equal(isStableRelease(r), false);
  }
});
test("old metadata remains valid without advertising an installer", () => {
  const r = fixture();
  delete r.macosInstaller;
  assert.ok(isStableRelease(r));
  assert.equal(macosInstallCommand(r), "");
  assert.equal(macosInstallCommand(null), "");
});
