import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const platforms = [
  "macos-arm64",
  "macos-x64",
  "windows-x64",
  "linux-x64",
];
export const installerTypes = {
  "macos-arm64": ["app"],
  "macos-x64": ["app"],
  "windows-x64": ["nsis", "msi"],
  "linux-x64": ["appimage", "deb", "rpm"],
};
const checks = [
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
];
const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const filenames = (dir) =>
  fs
    .readdirSync(dir)
    .filter((name) => name !== "candidate.json")
    .sort();

export function candidate(dir, env = process.env) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "latest.json")));
  const result = {
    schemaVersion: 1,
    repository: env.GITHUB_REPOSITORY,
    commit: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    tag: `v${manifest.version}`,
    files: {},
  };
  if (
    !["tuziapi/tuzi-switch", "AiW520/tuzi-switch"].includes(
      result.repository,
    ) ||
    !/^[a-f0-9]{40}$/.test(result.commit) ||
    !/^[1-9]\d*$/.test(result.runId) ||
    !/^v\d+\.\d+\.\d+$/.test(result.tag)
  )
    fail("Invalid candidate identity");
  for (const name of filenames(dir)) {
    const file = path.join(dir, name);
    if (!fs.lstatSync(file).isFile()) fail("Candidate contains a non-file");
    result.files[name] = digest(file);
  }
  fs.writeFileSync(
    path.join(dir, "candidate.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  return result;
}

// Evidence is reviewed separately after the real installations. Never generate
// passing evidence from compilation, unit tests, or an isolated-key smoke test.
export function verify(dir, evidence, expected) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, "candidate.json")));
  if (c.schemaVersion !== 1 || evidence.schemaVersion !== 1)
    fail("Unsupported evidence schema");
  for (const key of ["repository", "commit", "runId", "tag"]) {
    if (!expected[key] || c[key] !== expected[key] || evidence[key] !== c[key])
      fail(`Acceptance ${key} mismatch`);
  }
  if (
    !/^[a-f0-9]{40}$/.test(c.commit) ||
    !/^[1-9]\d*$/.test(c.runId) ||
    !/^v\d+\.\d+\.\d+$/.test(c.tag)
  )
    fail("Invalid candidate identity");
  const files = filenames(dir);
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(c.files).sort()))
    fail("Candidate files changed");
  if (
    JSON.stringify(Object.entries(c.files).sort()) !==
    JSON.stringify(Object.entries(evidence.files ?? {}).sort())
  )
    fail("Tested files differ from publication files");
  for (const name of files) {
    const file = path.join(dir, name);
    if (!fs.lstatSync(file).isFile() || digest(file) !== c.files[name])
      fail(`Candidate checksum mismatch: ${name}`);
  }
  if (
    evidence.status !== "passed" ||
    evidence.signingKey !== "existing-channel-key" ||
    !evidence.reviewer?.trim() ||
    !Number.isFinite(Date.parse(evidence.completedAt))
  )
    fail("Real channel signing and reviewed acceptance are required");
  if (
    !Array.isArray(evidence.platforms) ||
    evidence.platforms.length !== platforms.length
  )
    fail("All shipped platforms require native acceptance");
  for (const name of platforms) {
    const entries = evidence.platforms.filter((p) => p.platform === name);
    const p = entries[0];
    if (
      entries.length !== 1 ||
      p.kind !== "real-installed-app" ||
      p.status !== "passed" ||
      p.toVersion !== c.tag.slice(1) ||
      !/^\d+\.\d+\.\d+$/.test(p.fromVersion ?? "") ||
      compareVersions(p.fromVersion, p.toVersion) >= 0 ||
      !p.evidence?.trim() ||
      !checks.every((key) => p.checks?.[key] === "passed")
    )
      fail(`Incomplete real upgrade acceptance: ${name}`);
    const installers = p.installers;
    if (!Array.isArray(installers) || installers.length !== installerTypes[name].length)
      fail(`All shipped installer types require native acceptance: ${name}`);
    for (const type of installerTypes[name]) {
      const matches = installers.filter((i) => i.type === type);
      const installation = matches[0];
      if (matches.length !== 1 || installation.status !== "passed"
        || !installation.evidence?.trim()
        || !checks.every((key) => installation.checks?.[key] === "passed"))
        fail(`Incomplete installer acceptance: ${name}/${type}`);
    }
  }
  return c;
}

export function compareVersions(a, b) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "candidate") candidate(process.argv[3]);
  else if (process.argv[2] === "verify") {
    verify(process.argv[3], JSON.parse(fs.readFileSync(process.argv[4])), {
      repository: process.env.GITHUB_REPOSITORY,
      commit: process.env.CANDIDATE_SHA,
      runId: process.env.CANDIDATE_RUN_ID,
      tag: process.env.RELEASE_TAG,
    });
    console.log("Real upgrade evidence matches every candidate byte");
  } else fail("Expected candidate or verify");
}
