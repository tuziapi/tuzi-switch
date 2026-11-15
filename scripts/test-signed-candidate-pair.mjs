import test from 'node:test';
import assert from 'node:assert/strict';
import { pair, validatePair, verifyRun, verifyCandidateIdentity } from './signed-candidate-pair.mjs';

const run = () => ({ id: Number(pair.base.runId), repository: { full_name: pair.repository }, status: 'completed', conclusion: 'success', head_sha: pair.base.commit, path: '.github/workflows/unified-release.yml', event: 'workflow_dispatch' });
const candidate = () => ({ schemaVersion: 2, repository: pair.repository, releaseRepository: pair.releaseRepository, runId: pair.base.runId, commit: pair.base.commit, tag: `v${pair.base.version}`, publicKeySha256: pair.publicKeySha256 });

test('accepts the pinned pair and matching successful run and candidate', () => {
  validatePair(pair); verifyRun(run(), 'base'); verifyCandidateIdentity(candidate(), 'base');
});
test('rejects stale, foreign, unsuccessful or different-source run records', () => {
  for (const patch of [
    { id: Number(pair.target.runId) }, { repository: { full_name: 'untrusted/repo' } },
    { status: 'in_progress' }, { conclusion: 'failure' }, { head_sha: pair.target.commit },
    { path: '.github/workflows/another.yml' }, { event: 'pull_request' },
  ]) assert.throws(() => verifyRun({ ...run(), ...patch }, 'base'));
});
test('artifact metadata cannot choose its own run, source, channel or key', () => {
  for (const patch of [
    { runId: pair.target.runId }, { commit: pair.target.commit }, { tag: 'v9.0.0' },
    { publicKeySha256: '0'.repeat(64) }, { repository: 'untrusted/repo' },
    { releaseRepository: pair.repository }, { schemaVersion: 1 },
  ]) assert.throws(() => verifyCandidateIdentity({ ...candidate(), ...patch }, 'base'));
});
test('rejects ambiguous identity, malformed IDs and a non-increasing target', () => {
  for (const field of ['runId', 'commit', 'version']) {
    const same = structuredClone(pair); same.target[field] = same.base[field];
    assert.throws(() => validatePair(same));
  }
  for (const value of ['1; echo unsafe', '../1', '', '0']) {
    const malformed = structuredClone(pair); malformed.base.runId = value;
    assert.throws(() => validatePair(malformed));
  }
});
