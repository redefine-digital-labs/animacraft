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
  assert.equal(runtime.network, deployment.network);
  assert.equal(runtime.packageId, deployment.packageId);
  assert.equal(runtime.packageId, runtime.callablePackageId);
  assert.equal(runtime.callablePackageId, deployment.callablePackageId);
  assert.equal(runtime.originalPackageId, deployment.originalPackageId);
  assert.equal(runtime.graphqlUrl, 'https://graphql.mainnet.sui.io/graphql');
  assert.equal(runtime.paymentCoinType, SUI_MAINNET_USDC_TYPE);
  assert.equal(runtime.canonicalSoulMintEnabled, false, 'canonical mint stays gated until the reviewed adapter is deployed');
  assert.equal(deployment.protocolVersion, 4, 'the deployment record tracks the source-verified v4 upgrade');
  assert.match(moveSource, /const VERSION: u64 = 4;/, 'the source tree matches the published v4 protocol');
  assert.notEqual(runtime.callablePackageId, runtime.originalPackageId, 'the callable upgrade package is distinct from the stable v3 TypeOrigin');
  assert.equal(runtime.protocolFeePackageId, runtime.callablePackageId, 'v4 is the stable TypeOrigin for canonical fee types');
  assert.equal(runtime.protocolFeePackageId, deployment.protocolFeePackageId);
  assert.equal(runtime.protocolFeeConfigId, deployment.protocolFeeConfigId);
  assert.equal(runtime.protocolTreasuryId, deployment.protocolTreasuryId);
  assert.equal(runtime.protocolFeeAdminCapId, deployment.protocolFeeAdminCapId);
  assert.equal(runtime.protocolFeeAdminCapOwner, deployment.protocolFeeAdminCapOwner);
  assert.match(deployment.upgradeTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.protocolFeeInitializationTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.equal(runtime.primaryProtocolFeeBps, 5_000);
  assert.equal(deployment.primaryProtocolFeeBps, runtime.primaryProtocolFeeBps);
  assert.equal(deployment.canonicalSoulMintEnabled, false);
  assert.equal(deployment.verification.protocolFeeObjectsReadBack, true);
  assert.equal(deployment.verification.protocolFeeEnabled, false);

  for (const field of [
    'packageId',
    'callablePackageId',
    'originalPackageId',
    'protocolFeePackageId',
    'protocolFeeConfigId',
    'protocolTreasuryId',
    'protocolFeeAdminCapId',
    'protocolFeeAdminCapOwner',
    'publisherAddress',
    'upgradeCapId',
    'publisherObjectId',
    'displayObjectId',
  ]) {
    assert.match(deployment[field], SUI_OBJECT_ID, `${field} must be a canonical 32-byte Sui id`);
  }

  assert.match(deployment.publishDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.verification.packageDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.equal(deployment.verification.transactionStatus, 'success');
  assert.equal(deployment.verification.upgradeTransactionStatus, 'success');
  assert.equal(deployment.verification.protocolFeeInitializationStatus, 'success');
  assert.equal(deployment.verification.sourceStatus, 'success');
  assert.match(deployment.verification.sourceVerifiedAtUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const integrationReadiness = validateRuntimeConfig(runtime, { strict: true, requireSoulidity: true });
  assert.equal(integrationReadiness.valid, false, 'production must stay fail-closed until canonical Soul minting is activated');
  assert.match(integrationReadiness.errors.join(' '), /canonicalSoulMintEnabled=true/);
});
