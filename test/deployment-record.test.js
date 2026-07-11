import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SUI_MAINNET_USDC_TYPE, validateRuntimeConfig } from '../runtime-config.js';

const ROOT = new URL('../', import.meta.url);
const SUI_OBJECT_ID = /^0x[0-9a-f]{64}$/;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
}

async function readPublicConfig() {
  const source = await readFile(new URL('public/config.js', ROOT), 'utf8');
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename: 'public/config.js' }).runInContext(context);
  return context.window.ANIMACRAFT_CONFIG;
}

test('keeps the production runtime pinned to the canonical Mainnet deployment', async () => {
  const [deployment, runtime, moveSource] = await Promise.all([
    readJson('deployments/mainnet.json'),
    readPublicConfig(),
    readFile(new URL('move/animacraft/sources/animacraft.move', ROOT), 'utf8'),
  ]);

  assert.equal(deployment.schemaVersion, 'animacraft.deployment.v1');
  assert.equal(deployment.network, 'mainnet');
  assert.equal(deployment.packageId, deployment.originalPackageId);
  assert.equal(runtime.network, deployment.network);
  assert.equal(runtime.packageId, deployment.originalPackageId);
  assert.equal(runtime.paymentCoinType, SUI_MAINNET_USDC_TYPE);
  assert.match(moveSource, new RegExp(`const VERSION: u64 = ${deployment.protocolVersion};`));

  for (const field of ['packageId', 'originalPackageId', 'publisherAddress', 'upgradeCapId', 'publisherObjectId', 'displayObjectId']) {
    assert.match(deployment[field], SUI_OBJECT_ID, `${field} must be a canonical 32-byte Sui id`);
  }

  assert.match(deployment.publishDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.equal(deployment.verification.transactionStatus, 'success');
  assert.equal(validateRuntimeConfig(runtime, { strict: true, requireSoulidity: true }).valid, true);
});
