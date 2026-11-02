import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  acceptancePlatforms,
  createAcceptanceRelease,
  isAcceptanceRelease,
} from "../src/acceptanceRelease.js";
const now = Date.parse("2026-11-02T00:00:00Z");
function fixture() {
  const pin = { runId: "123", commit: "ab".repeat(20) };
  const run = {
    id: 123,
    head_sha: pin.commit,
    repository: { full_name: "AiW520/tuzi-switch" },
    path: ".github/workflows/acceptance-build.yml",
    status: "completed",
    conclusion: "success",
  };
  const artifacts = acceptancePlatforms.map((p, i) => ({
    id: 10 + i,
    name: `tuzi-assistant-${p.target}-${pin.commit}`,
    expired: false,
    size_in_bytes: 500,
    expires_at: "2026-12-01T00:00:00Z",
    workflow_run: { id: 123, head_sha: pin.commit },
  }));
  return { pin, run, artifacts };
}
test("each architecture resolves to its exact successful build artifact", () => {
  const f = fixture();
  const r = createAcceptanceRelease(f.pin, f.run, f.artifacts, now);
  assert.equal(isAcceptanceRelease(r, now), true);
  assert.equal(r.tag, "test-abababab");
  assert.deepEqual(
    r.downloads.map((d) => d.id),
    ["macos", "macos-intel", "windows", "linux"],
  );
  assert.ok(
    r.downloads.every(
      (d) => d.href === `${r.sourceUrl}/artifacts/${d.artifactId}`,
    ),
  );
});
test("running, failed, unrelated repository, wrong workflow or wrong commit is rejected", () => {
  for (const update of [
    { status: "in_progress" },
    { conclusion: "failure" },
    { repository: { full_name: "untrusted/repo" } },
    { path: "other.yml" },
    { head_sha: "cd".repeat(20) },
  ]) {
    const f = fixture();
    Object.assign(f.run, update);
    assert.throws(() =>
      createAcceptanceRelease(f.pin, f.run, f.artifacts, now),
    );
  }
});
test("expired, missing, duplicate, empty or mismatched artifacts fail closed", () => {
  for (const change of [
    (a) => a.pop(),
    (a) => a.push(a[0]),
    (a) => (a[0].expired = true),
    (a) => (a[0].size_in_bytes = 0),
    (a) => (a[0].expires_at = "2026-10-01T00:00:00Z"),
    (a) => (a[0].workflow_run.head_sha = "cd".repeat(20)),
  ]) {
    const f = fixture();
    change(f.artifacts);
    assert.throws(() =>
      createAcceptanceRelease(f.pin, f.run, f.artifacts, now),
    );
  }
});
test("browser rejects old release links, swapped artifacts, expired data and executable commands", () => {
  const f = fixture();
  const original = createAcceptanceRelease(f.pin, f.run, f.artifacts, now);
  for (const change of [
    (r) =>
      (r.downloads[0].href =
        "https://github.com/tuziapi/tuzi-switch/releases/download/v1.4.3/old.dmg"),
    (r) => (r.downloads[1].artifactId = r.downloads[0].artifactId),
    (r) => (r.command = "sh install.sh"),
    (r) => (r.downloads[0].expiresAt = "2026-10-01T00:00:00Z"),
  ]) {
    const r = structuredClone(original);
    change(r);
    assert.equal(isAcceptanceRelease(r, now), false);
  }
});
test("analytics accepts new test platforms and versions but rejects other parents and origins", () => {
  const html = readFileSync(
    new URL("../public/tuzi-download-analytics.html", import.meta.url),
    "utf8",
  );
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const listeners = {},
    calls = [],
    parent = {};
  const window = {
    parent,
    umami: { track: (...args) => calls.push(args) },
    addEventListener: (name, fn) => (listeners[name] = fn),
  };
  vm.runInNewContext(script, {
    window,
    location: { origin: "https://example.test" },
    Set,
  });
  const message = {
    origin: "https://example.test",
    source: parent,
    data: {
      type: "tuzi-download-click",
      platform: "macos-intel",
      version: "test-abababab",
    },
  };
  listeners.message(message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "switch_download_click");
  for (const override of [
    { origin: "https://untrusted.test" },
    { source: {} },
    { data: { ...message.data, version: "not-a-build" } },
  ])
    listeners.message({ ...message, ...override });
  assert.equal(calls.length, 1);
});
