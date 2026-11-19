import test from "node:test";
import assert from "node:assert/strict";
import {
  isPreviewRelease,
  previewDownloadRelease,
  previewPlatforms,
  previewRepository,
  previewVersion,
  previewTag,
} from "../src/previewRelease.js";
function fixture() {
  const commit = "a".repeat(40);
  const base = `https://github.com/${previewRepository}/releases/download/${previewTag}/`;
  return {
    channel: "preview",
    repository: previewRepository,
    version: previewVersion,
    tag: previewTag,
    prerelease: true,
    applicationId: "com.tuziswitch.desktop.opentu-preview",
    automaticUpdates: false,
    commit,
    runId: 123,
    releaseUrl: `https://github.com/${previewRepository}/releases/tag/${previewTag}`,
    sourceUrl: `${base}opentu-preview-source-${commit}.tar.gz`,
    downloads: previewPlatforms.map((p) => {
      const file = `OpenTu-Preview-${previewVersion}-${p.id}${p.extension}`;
      return {
        platform: p.id,
        file,
        url: base + file,
        bytes: 1234,
        sha256: "b".repeat(64),
      };
    }),
  };
}
test("preview accepts all five isolated packages from one pinned beta release", () =>
  assert.equal(isPreviewRelease(fixture()), true));
test("preview rejects official routing, missing packages, duplicate targets, bad hashes and automatic updates", () => {
  for (const mutate of [
    (r) => (r.repository = "tuziapi/tuzi-switch"),
    (r) => (r.channel = "stable"),
    (r) => (r.prerelease = false),
    (r) => (r.automaticUpdates = true),
    (r) => (r.applicationId = "com.tuziswitch.desktop"),
    (r) => r.downloads.pop(),
    (r) => (r.downloads[0] = r.downloads[1]),
    (r) => (r.downloads[0].sha256 = "bad"),
    (r) => (r.downloads[0].url = "https://example.org/installer.exe"),
    (r) => (r.sourceUrl = "https://example.org/source"),
    (r) => (r.commit = "main"),
    (r) => (r.runId = -1),
  ]) {
    const value = fixture();
    mutate(value);
    assert.equal(isPreviewRelease(value), false);
  }
  assert.equal(isPreviewRelease(null), false);
});

test("existing page adapter preserves all architectures, hashes and source links", () => {
  const raw = fixture();
  const view = previewDownloadRelease(raw);
  assert.deepEqual(
    view.downloads.map((d) => d.id),
    ["macos", "macos-intel", "windows", "deb", "deb-arm64"],
  );
  assert.equal(view.sourceUrl, raw.releaseUrl);
  assert.equal(view.correspondingSourceUrl, raw.sourceUrl);
  assert.equal(view.tag, `v${previewVersion}`);
  view.downloads.forEach((d, i) => {
    assert.equal(d.href, raw.downloads[i].url);
    assert.equal(d.sha256, raw.downloads[i].sha256);
    assert.equal(d.bytes, raw.downloads[i].bytes);
  });
  raw.downloads.pop();
  assert.throws(() => previewDownloadRelease(raw), /Invalid preview/);
});
