import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SUI_MAINNET_USDC_TYPE, validateRuntimeConfig } from '../runtime-config.js';

const ROOT = new URL('../', import.meta.url);
const SUI_OBJECT_ID = /^0x[0-9a-f]{64}$/;
const SOULIDITY_MAINNET = Object.freeze({
  originalPackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  callablePackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  sealNamespacePackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  v5TypeOriginPackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  v6TypeOriginPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
});
const EXPANSION_PACK_V8_MAINNET = Object.freeze({
  packageId: '0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a',
  upgradeTxDigest: '2ef2pUjBBuhGDTuzVHZwo3ZkqgkqzUc6A2mNnjZeLLTF',
  upgradeCheckpoint: '309641036',
  upgradedAtMs: '1786494456691',
  sourceCommit: '59cae42a8602f54a7b7902aee77971a1dff8a270',
  sourceTree: '794b18902c5d758889baf80431a3f99f59e4a8aa',
  packageDigest: 'Mquf4qbGQ5nFAJhS8MyzGZZbK6bgAnxqUF4jQVdA7kw',
  packageObjectDigest: '8Br3y89HNVPUndvAVhyddc4rV8GTCFZ2Pde8aMnEpfm',
});

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
  const [deployment, runtime, moveSource, publishedSource] = await Promise.all([
    readJson('deployments/mainnet.json'),
    readPublicConfig(),
    readFile(new URL('move/animacraft/sources/animacraft.move', ROOT), 'utf8'),
    readFile(new URL('move/animacraft/Published.toml', ROOT), 'utf8'),
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
  assert.equal(deployment.protocolVersion, 4, 'the base animacraft.move protocol remains version 4');
  assert.equal(deployment.packageVersion, 4);
  assert.equal(deployment.commerceProtocolVersion, 5);
  assert.equal(deployment.compositionProtocolVersion, 6);
  assert.equal(deployment.expansionPackProtocolVersion, 8);
  assert.match(moveSource, /const VERSION: u64 = 4;/, 'v5/v6 are additive modules and do not relabel the base protocol');
  assert.notEqual(runtime.callablePackageId, runtime.originalPackageId, 'the callable upgrade package is distinct from the stable v3 TypeOrigin');
  assert.notEqual(runtime.protocolFeePackageId, runtime.callablePackageId, 'the v4 fee TypeOrigin remains frozen while the callable advances to v6');
  assert.equal(runtime.protocolFeePackageId, deployment.protocolFeePackageId);
  assert.equal(runtime.protocolFeeConfigId, deployment.protocolFeeConfigId);
  assert.equal(runtime.protocolTreasuryId, deployment.protocolTreasuryId);
  assert.equal(runtime.protocolFeeAdminCapId, deployment.protocolFeeAdminCapId);
  assert.equal(runtime.protocolFeeAdminCapOwner, deployment.protocolFeeAdminCapOwner);
  assert.match(deployment.upgradeTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.protocolFeeInitializationTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.commerceV5UpgradeTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.commerceV5InitializationTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.compositionV6UpgradeTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.match(deployment.compositionV6InitializationTxDigest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.equal(runtime.primaryProtocolFeeBps, 5_000);
  assert.equal(deployment.primaryProtocolFeeBps, runtime.primaryProtocolFeeBps);
  assert.equal(deployment.canonicalSoulMintEnabled, false);
  assert.equal(deployment.verification.protocolFeeObjectsReadBack, true);
  assert.equal(deployment.verification.protocolFeeEnabled, true);
  assert.equal(deployment.verification.commerceV5ObjectsReadBack, true);
  assert.equal(deployment.verification.commerceV5Enabled, true);
  assert.equal(deployment.verification.commerceV5BindOnceDependenciesBound, true);
  assert.equal(deployment.verification.compositionV6ObjectsReadBack, true);
  assert.equal(deployment.verification.compositionV6Enabled, true);
  assert.equal(deployment.verification.compositionV6SoulOwnerProofBound, true);
  assert.equal(
    deployment.observedChainState.preexistingCoreActivationTxDigest,
    'AVYsGvyfgSVFQ8mrQWXCpNbNzwDcPc4BboegLsetSYXT',
  );
  assert.equal(deployment.observedChainState.protocolFee.enabled, true);
  assert.equal(deployment.observedChainState.commerceV5.enabled, true);
  assert.equal(deployment.observedChainState.compositionV6.enabled, true);
  assert.equal(deployment.observedChainState.productRuntime.expansionPackV8ReleaseEnabled, false);
  assert.equal(deployment.observedChainState.productRuntime.canonicalSoulMintEnabled, false);
  assert.equal(runtime.expansionPackV8CallablePackageId, EXPANSION_PACK_V8_MAINNET.packageId);
  assert.equal(runtime.expansionPackV8TypeOriginPackageId, EXPANSION_PACK_V8_MAINNET.packageId);
  assert.equal(runtime.expansionPackV8ReleaseEnabled, false);
  assert.equal(deployment.expansionPackV8CallablePackageId, EXPANSION_PACK_V8_MAINNET.packageId);
  assert.equal(deployment.expansionPackV8TypeOriginPackageId, EXPANSION_PACK_V8_MAINNET.packageId);
  assert.equal(deployment.expansionPackV8ReleaseEnabled, false);
  assert.equal(runtime.callablePackageId, deployment.callablePackageId, 'the product remains pinned to the v4 callable');
  assert.notEqual(runtime.callablePackageId, runtime.expansionPackV8CallablePackageId);
  assert.equal(deployment.releases.expansionPackV8.callablePackageId, EXPANSION_PACK_V8_MAINNET.packageId);
  assert.equal(deployment.releases.expansionPackV8.typeOriginPackageId, EXPANSION_PACK_V8_MAINNET.packageId);
  assert.equal(deployment.releases.expansionPackV8.packageVersion, 6);
  assert.equal(deployment.releases.expansionPackV8.upgradeTxDigest, EXPANSION_PACK_V8_MAINNET.upgradeTxDigest);
  assert.equal(deployment.releases.expansionPackV8.upgradeCheckpoint, EXPANSION_PACK_V8_MAINNET.upgradeCheckpoint);
  assert.equal(deployment.releases.expansionPackV8.upgradedAtMs, EXPANSION_PACK_V8_MAINNET.upgradedAtMs);
  assert.equal(deployment.releases.expansionPackV8.sourceCommit, EXPANSION_PACK_V8_MAINNET.sourceCommit);
  assert.equal(deployment.releases.expansionPackV8.sourceTree, EXPANSION_PACK_V8_MAINNET.sourceTree);
  assert.equal(deployment.releases.expansionPackV8.packageDigest, EXPANSION_PACK_V8_MAINNET.packageDigest);
  assert.equal(deployment.releases.expansionPackV8.packageObjectDigest, EXPANSION_PACK_V8_MAINNET.packageObjectDigest);
  assert.equal(deployment.releases.expansionPackV8.enabled, false);
  assert.equal(deployment.verification.expansionPackV8UpgradeTransactionStatus, 'success');
  assert.equal(deployment.verification.expansionPackV8SourceStatus, 'success');
  assert.equal(deployment.verification.expansionPackV8PackageReadBack, true);
  assert.equal(deployment.verification.expansionPackV8Enabled, false);
  assert.equal(deployment.verification.expansionPackV8CompleteToSoulidityEnabled, false);
  assert.equal(deployment.verification.expansionPackV8CompleteBridgeEnabled, false);
  assert.equal(deployment.verification.expansionPackV8PhysicalBridgeEnabled, false);
  assert.equal(deployment.verification.expansionPackV8CompanionProofAvailable, false);
  assert.equal(deployment.verification.expansionPackV8ObjectsCreated, 0);
  assert.equal(deployment.verification.expansionPackV8MoveEventsObserved, 0);
  assert.equal(deployment.verification.expansionPackV8SealWritesObserved, false);
  assert.equal(deployment.verification.expansionPackV8WalrusWritesObserved, false);
  assert.match(publishedSource, /published-at = "0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a"/);
  assert.match(publishedSource, /original-id = "0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea"/);
  assert.match(publishedSource, /^version = 6$/m);

  for (const field of [
    'commerceV5TypeOriginPackageId',
    'commerceProtocolConfigV5Id',
    'commerceProtocolTreasuryV5Id',
    'compositionV6TypeOriginPackageId',
    'compositionProtocolConfigV6Id',
    'compositionProtocolTreasuryV6Id',
    'compositionRegistryV6Id',
    'compositionAdminCapV6Id',
    'compositionAdminCapV6Owner',
    'compositionValidatorCapV6Id',
    'compositionValidatorCapV6Owner',
  ]) {
    assert.equal(runtime[field], deployment[field], `${field} must match the runtime record`);
    assert.match(deployment[field], SUI_OBJECT_ID, `${field} must be a canonical 32-byte Sui id`);
  }
  assert.equal(runtime.commerceV5LogicalAuxiliaryBlobId, '');
  assert.equal(runtime.commerceV5SoulBindingProofType, '');
  assert.equal(runtime.commerceV5ReleaseEnabled, false);
  assert.equal(runtime.soulidityPackageId, SOULIDITY_MAINNET.callablePackageId);
  assert.equal(runtime.soulidityCallablePackageId, SOULIDITY_MAINNET.callablePackageId);
  assert.equal(deployment.soulidityCallablePackageId, SOULIDITY_MAINNET.callablePackageId);
  assert.equal(deployment.soulidityOriginalPackageId, SOULIDITY_MAINNET.originalPackageId);
  assert.equal(runtime.souliditySealNamespacePackageId, SOULIDITY_MAINNET.sealNamespacePackageId);
  assert.equal(deployment.souliditySealNamespacePackageId, SOULIDITY_MAINNET.sealNamespacePackageId);
  assert.equal(
    runtime.soulidityTypeOriginPackageId,
    deployment.soulidityTypeOriginPackageId,
    'the existing v5 Soulidity TypeOrigin remains frozen',
  );
  assert.equal(runtime.soulidityTypeOriginPackageId, SOULIDITY_MAINNET.v5TypeOriginPackageId);
  assert.equal(runtime.compositionV6SoulOwnerProofTypeOriginPackageId, deployment.compositionV6SoulOwnerProofTypeOriginPackageId);
  assert.equal(runtime.compositionV6SoulOwnerProofTypeOriginPackageId, SOULIDITY_MAINNET.v6TypeOriginPackageId);
  assert.equal(runtime.compositionV6SoulOwnerProofType, '');
  assert.equal(runtime.compositionV6ReleaseEnabled, false);
  assert.equal(deployment.releases.compositionV6.soulOwnerProofTypeOriginPackageId, SOULIDITY_MAINNET.v6TypeOriginPackageId);
  assert.equal(deployment.releases.compositionV6.soulOwnerProofType, '');
  assert.equal(runtime.compositionValidatorEpochV6, 0);
  assert.equal(
    runtime.compositionValidatorPolicyCommitmentV6,
    deployment.compositionValidatorPolicyCommitmentV6,
  );
  assert.equal(
    deployment.compositionValidatorPolicyLabelV6,
    'animacraft-v6-validator-policy/mainnet/2026-08-01/disabled-launch',
  );
  assert.equal(deployment.releases.commerceV5.sourceCommit, '31073bd3b90d0256571133198518621980fc22c1');
  assert.equal(deployment.releases.compositionV6.sourceCommit, '7fd4ff63c3164ca5bc0aeeb2c177acbfb3bf50d5');
  assert.notEqual(deployment.releases.compositionV6.sourceTree, deployment.source.sourceTree);
  assert.equal(deployment.releases.expansionPackV8.sourceTree, deployment.source.sourceTree);
  assert.equal(deployment.releases.expansionPackV8.sourceCommit, deployment.source.sourceCommit);
  assert.equal(deployment.releases.expansionPackV8.upgradeTxDigest, deployment.upgradeTxDigest);
  assert.equal(deployment.releases.expansionPackV8.upgradeCheckpoint, deployment.upgradeCheckpoint);
  assert.equal(deployment.releases.expansionPackV8.upgradedAtMs, deployment.upgradedAtMs);
  assert.equal(deployment.releases.expansionPackV8.packageDigest, deployment.verification.packageDigest);

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
