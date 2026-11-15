// This checked-in identity pair is deliberately independent of artifact metadata.
// Replace it only after successful candidate builds, before testing those bytes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compareVersions, deliveryPolicy } from './update-acceptance.mjs';

export function validatePair(pair) {
  assert.equal(pair.schemaVersion, 1);
  assert.equal(pair.repository, 'AiW520/tuzi-switch');
  assert.equal(pair.releaseRepository, 'tuziapi/tuzi-switch');
  for (const role of ['base', 'target']) {
    const value = pair[role];
    assert.match(value.runId, /^[1-9]\d*$/);
    assert.match(value.commit, /^[a-f0-9]{40}$/);
    assert.match(value.version, /^\d+\.\d+\.\d+$/);
    assert.equal(pair.publicKeySha256, deliveryPolicy(pair.releaseRepository, value.version).publicKeySha256);
  }
  assert.notEqual(pair.base.runId, pair.target.runId);
  assert.notEqual(pair.base.commit, pair.target.commit);
  assert.ok(compareVersions(pair.base.version, pair.target.version) < 0);
  return pair;
}

export const pair = validatePair(JSON.parse(fs.readFileSync(new URL('./signed-candidate-pair.json', import.meta.url))));

export function verifyRun(run, role, expected = pair) {
  validatePair(expected);
  const identity = expected[role];
  assert.ok(identity && ['base', 'target'].includes(role));
  assert.equal(String(run.id), identity.runId);
  assert.equal(run.repository?.full_name, expected.repository);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.equal(run.head_sha, identity.commit);
  assert.equal(run.path, '.github/workflows/unified-release.yml');
  assert.equal(run.event, 'workflow_dispatch');
}

export function verifyCandidateIdentity(candidate, role, expected = pair) {
  validatePair(expected);
  const identity = expected[role];
  assert.ok(identity && ['base', 'target'].includes(role));
  assert.equal(candidate.schemaVersion, 2);
  assert.equal(candidate.repository, expected.repository);
  assert.equal(candidate.releaseRepository, expected.releaseRepository);
  assert.equal(candidate.runId, identity.runId);
  assert.equal(candidate.commit, identity.commit);
  assert.equal(candidate.tag, `v${identity.version}`);
  assert.equal(candidate.publicKeySha256, expected.publicKeySha256);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], 'resolve');
  // execFileSync avoids interpolating identities into a shell command.
  for (const role of ['base', 'target']) {
    const run = JSON.parse(execFileSync('gh', ['api', `repos/${pair.repository}/actions/runs/${pair[role].runId}`], { encoding: 'utf8' }));
    verifyRun(run, role);
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `base_run_id=${pair.base.runId}\ntarget_run_id=${pair.target.runId}\n`);
  }
  console.log(JSON.stringify({ repository: pair.repository, base: pair.base, target: pair.target }));
}
