import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayModel, gatewayBody, isPrivateFile, decodeJsonBody, readJsonBody } from './runtime.mjs';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { PassThrough } from 'node:stream';
test('isolated hosts reject unbound model names instead of silently changing models', () => {
  const config = { strictModels: true, managed: true, models: ['claude-local-default'], model:'claude-local-default', smallModel:'claude-local-default' };
  assert.equal(gatewayModel(config, undefined),config.model);
  assert.equal(gatewayModel(config,config.model),config.model);
  assert.throws(() => gatewayModel(config, 'claude-haiku-unbound'));
  assert.throws(() => gatewayBody(config,Buffer.from(JSON.stringify({model:'unknown'}))));
  assert.equal(gatewayModel({...config,strictModels:false},'claude-haiku-unbound'),config.smallModel);
});

test('receipt privacy uses Unix ownership and modes, and Windows regular file identity', () => {
  const file = { isFile: () => true, isSymbolicLink: () => false, uid: 501, mode: 0o600 };
  for (const platform of ['darwin', 'linux']) {
    assert.equal(isPrivateFile(file, { platform, uid: 501 }), true);
    assert.equal(isPrivateFile(file, { platform, uid: 502 }), false);
    assert.equal(isPrivateFile({ ...file, mode: 0o644 }, { platform, uid: 501 }), false);
  }
  assert.equal(isPrivateFile({ ...file, mode: 0o666 }, { platform: 'win32' }), true);
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.equal(isPrivateFile({ ...file, isSymbolicLink: () => true }, { platform }), false);
    assert.equal(isPrivateFile({ ...file, isFile: () => false }, { platform }), false);
  }
});

test('compressed requests preserve Unicode and reject corruption, expansion and unknown encodings', async () => {
  const payload = { prompt: '兔子测试 café 🐰', model: 'bound-model' };
  const raw = Buffer.from(JSON.stringify(payload));
  for (const [encoding, encode] of [['identity', x => x], ['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
    assert.deepEqual(await decodeJsonBody(encode(raw), encoding), payload);
    await assert.rejects(decodeJsonBody(encode(raw), encoding, 4), { statusCode: 413 });
  }
  await assert.rejects(decodeJsonBody(Buffer.from('broken'), 'gzip'), { statusCode: 400 });
  await assert.rejects(decodeJsonBody(raw, 'zstd'), { statusCode: 415 });
  await assert.rejects(decodeJsonBody(raw, 'gzip, br'), { statusCode: 415 });
  for (const value of ['[]', 'null', 'true', '"text"', '{']) {
    await assert.rejects(decodeJsonBody(Buffer.from(value)), { statusCode: 400 });
  }
});

test('streamed JSON rejects oversized and interrupted uploads before gateway forwarding', async () => {
  const req = new PassThrough();
  req.headers = {};
  const pending = assert.rejects(readJsonBody(req, 4), { statusCode: 413 });
  req.write(Buffer.alloc(5));
  req.end();
  await pending;
  const aborted = new PassThrough();
  aborted.headers = {};
  const failure = assert.rejects(readJsonBody(aborted), { statusCode: 400 });
  aborted.emit('aborted');
  aborted.end();
  await failure;
});
