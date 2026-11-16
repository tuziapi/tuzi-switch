import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayModel, gatewayBody } from './runtime.mjs';
test('isolated hosts reject unbound model names instead of silently changing models', () => {
  const config = { strictModels: true, managed: true, models: ['claude-local-default'], model:'claude-local-default', smallModel:'claude-local-default' };
  assert.equal(gatewayModel(config, undefined),config.model);
  assert.equal(gatewayModel(config,config.model),config.model);
  assert.throws(() => gatewayModel(config, 'claude-haiku-unbound'));
  assert.throws(() => gatewayBody(config,Buffer.from(JSON.stringify({model:'unknown'}))));
  assert.equal(gatewayModel({...config,strictModels:false},'claude-haiku-unbound'),config.smallModel);
});
