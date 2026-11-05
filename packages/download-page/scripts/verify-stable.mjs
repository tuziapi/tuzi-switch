import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installerFormats,
  repository,
  createStableRelease,
  isStableRelease,
} from "../src/stableRelease.js";
function fixture() {
  return {
    draft: false,
    prerelease: false,
    tag_name: "v1.5.0",
    html_url: `https://github.com/${repository}/releases/tag/v1.5.0`,
    published_at: "2026-11-03T00:00:00Z",
    assets: installerFormats.map((p) => ({
      name: p.file,
      state: "uploaded",
      size: 123,
      digest: `sha256:${"a".repeat(64)}`,
      browser_download_url: `https://github.com/${repository}/releases/download/v1.5.0/${p.file}`,
    })),
  };
}
test("all seven installers are public direct files and have checksums", () => {
  const r = createStableRelease(fixture());
  assert.ok(isStableRelease(r));
  assert.equal(r.downloads.length, 7);
  assert.ok(r.downloads.every((d) => !d.href.includes("/actions/")));
});
test("draft, prerelease, incomplete, duplicate or substituted installers are rejected", () => {
  for (const change of [
    (r) => (r.draft = true),
    (r) => (r.prerelease = true),
    (r) => r.assets.pop(),
    (r) => r.assets.push(r.assets[0]),
    (r) => (r.assets[0].browser_download_url = "https://bad.test/file.dmg"),
    (r) => (r.assets[0].digest = ""),
  ]) {
    const r = fixture();
    change(r);
    assert.throws(() => createStableRelease(r));
  }
});
test("browser fails closed for altered format or cross-version download URLs", () => {
  for (const change of [
    (r) => (r.downloads[0].format = "ZIP"),
    (r) =>
      (r.downloads[0].href = r.downloads[0].href.replace("v1.5.0", "v1.4.3")),
    (r) => (r.channel = "acceptance"),
  ]) {
    const r = createStableRelease(fixture());
    change(r);
    assert.equal(isStableRelease(r), false);
  }
});
