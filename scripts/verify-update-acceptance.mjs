import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  candidate,
  verify,
  platforms,
  installerTypes,
  stagePublication,
} from "./update-acceptance.mjs";

function fixture(fn, version = "1.6.3") {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "SYNTHETIC-upgrade-evidence-"),
  );
  try {
    fs.writeFileSync(
      path.join(dir, "latest.json"),
      JSON.stringify({ version }),
    );
    fs.writeFileSync(path.join(dir, "package.tar.gz"), "SYNTHETIC package");
    const c = candidate(dir, {
      GITHUB_REPOSITORY: "tuziapi/tuzi-switch",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "123",
    });
    const evidence = {
      ...c,
      status: "passed",
      signingKey: "existing-channel-key",
      reviewer: "SYNTHETIC UNIT TEST ONLY",
      completedAt: "2026-11-15T00:00:00Z",
      platforms: platforms.map((platform) => ({
        platform,
        kind: "real-installed-app",
        status: "passed",
        fromVersion: "1.6.1",
        toVersion: version,
        evidence: "SYNTHETIC TEST RECORD",
        checks: Object.fromEntries(
          [
            "download",
            "signature",
            "install",
            "restart",
            "version",
            "dataPreservation",
            "corruptPackage",
            "networkFailure",
            "installFailure",
            "retry",
            "businessAttribution",
          ].map((k) => [k, "passed"]),
        ),
      })),
    };
    for (const p of evidence.platforms) {
      p.installers = installerTypes[p.platform].map((type) => ({
        type,
        status: "passed",
        evidence: "SYNTHETIC INSTALLER TEST RECORD",
        checks: { ...p.checks },
      }));
    }
    fn(dir, evidence, c);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("accepts reviewed evidence for identical candidate bytes", () =>
  fixture((d, e, c) => assert.equal(verify(d, e, c).commit, c.commit)));
test("rejects rebuilt or modified packages", () =>
  fixture((d, e, c) => {
    fs.writeFileSync(path.join(d, "package.tar.gz"), "changed");
    assert.throws(() => verify(d, e, c), /checksum/);
  }));
test("rejects missing, duplicate, mocked and untested platforms", () =>
  fixture((d, e, c) => {
    for (const change of [
      (x) => x.platforms.pop(),
      (x) => (x.platforms[0].kind = "mock"),
      (x) => (x.platforms[0].checks.restart = "pending"),
      (x) => (x.platforms[0] = x.platforms[1]),
      (x) => (x.signingKey = "ephemeral-test-key"),
      (x) => (x.status = "pending"),
    ]) {
      const copy = structuredClone(e);
      change(copy);
      assert.throws(() => verify(d, copy, c));
    }
  }));
test("rejects source, repository, run and version substitutions", () =>
  fixture((d, e, c) => {
    for (const key of ["repository", "commit", "runId", "tag"])
      assert.throws(() => verify(d, { ...e, [key]: "other" }, c), /mismatch/);
  }));
test("rejects changed evidence file list, downgrade and missing analytics check", () =>
  fixture((d, e, c) => {
    for (const change of [
      (x) => delete x.files["package.tar.gz"],
      (x) => (x.platforms[0].fromVersion = x.platforms[0].toVersion),
      (x) => delete x.platforms[0].checks.businessAttribution,
    ]) {
      const copy = structuredClone(e);
      change(copy);
      assert.throws(() => verify(d, copy, c));
    }
  }));
test("rejects missing installer types and untested install paths", () =>
  fixture((d, e, c) => {
    for (const change of [
      (x) => delete x.platforms[0].installers,
      (x) => x.platforms[2].installers.pop(),
      (x) => (x.platforms[3].installers[2] = x.platforms[3].installers[0]),
      (x) => (x.platforms[2].installers[1].checks.restart = "pending"),
    ]) {
      const copy = structuredClone(e);
      change(copy);
      assert.throws(() => verify(d, copy, c), /installer/i);
    }
  }));

test("manual transition excludes native update metadata and requires subsequent signed upgrade evidence", () =>
  fixture((d, e, c) => {
    assert.equal(c.delivery, "manual-key-transition");
    assert.ok(!c.publicationFiles.includes("latest.json"));
    assert.throws(() => verify(d, e, c));
    e.signingKey = "new-official-channel-key";
    for (const p of e.platforms) {
      p.method = "manual-install";
      for (const i of p.installers) {
        i.method = "manual-install";
        i.signedUpgrade = {
          kind: "real-installed-app",
          status: "passed",
          fromVersion: "1.6.2",
          toVersion: "1.6.3",
          publicKeySha256: c.publicKeySha256,
          artifactSha256: "b".repeat(64),
          commit: "c".repeat(40),
          evidence: "SYNTHETIC NEXT UPGRADE",
          checks: { ...i.checks },
        };
      }
    }
    assert.equal(verify(d, e, c).delivery, "manual-key-transition");
    const output = path.join(
      os.tmpdir(),
      `SYNTHETIC-publication-${Date.now()}`,
    );
    try {
      stagePublication(d, output);
      assert.ok(!fs.existsSync(path.join(output, "latest.json")));
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
    for (const mutate of [
      (x) => delete x.platforms[0].installers[0].signedUpgrade,
      (x) =>
        (x.platforms[0].installers[0].signedUpgrade.publicKeySha256 =
          "f".repeat(64)),
      (x) =>
        (x.platforms[0].installers[0].signedUpgrade.checks.signature =
          "pending"),
      (x) => x.publicationFiles.push("latest.json"),
    ]) {
      const copy = structuredClone(e);
      mutate(copy);
      assert.throws(() => verify(d, copy, c));
    }
  }, "1.6.2"));

test("protected test executor binds official key, manual delivery and public installer subset", () =>
  fixture((d) => {
    fs.writeFileSync(path.join(d,'tuzi-assistant-macos-arm64.dmg'),'SYNTHETIC direct installer');
    fs.writeFileSync(path.join(d,'tuzi-assistant-macos-arm64.app.tar.gz'),'SYNTHETIC updater');
    fs.writeFileSync(path.join(d,'tuzi-assistant-macos-arm64.app.tar.gz.sig'),'SYNTHETIC signature');
    const env={GITHUB_REPOSITORY:'AiW520/tuzi-switch',TUZI_SWITCH_RELEASE_REPOSITORY:'tuziapi/tuzi-switch',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123'};
    assert.throws(()=>candidate(d,env), /Unapproved/);
    const c=candidate(d,{...env,TUZI_OFFICIAL_TEST_CANDIDATE:'1'});
    assert.equal(c.repository,'AiW520/tuzi-switch');
    assert.equal(c.releaseRepository,'tuziapi/tuzi-switch');
    assert.equal(c.delivery,'manual-key-transition');
    assert.ok(c.publicationFiles.includes('tuzi-assistant-macos-arm64.dmg'));
    assert.ok(!c.publicationFiles.some(f=>f.endsWith('.sig') || f.endsWith('.app.tar.gz') || f==='latest.json'));
    assert.ok(!fs.readFileSync(path.join(d,'SHA256SUMS'),'utf8').includes('.sig'));
  }, '1.6.2'));
