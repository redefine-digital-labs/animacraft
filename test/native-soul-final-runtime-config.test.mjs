import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { contextFixture } from './fixtures/native-soul-bootstrap-context-fixture.mjs';
import { nativeSoulMarketActivationFixture } from './fixtures/native-soul-market-activation-fixture.mjs';
import { mainnetV8RuntimeConfigFromWal, buildMainnetV8PairedConfig, assertMainnetV8ExportConfigContents, readMainnetV8DeploymentConfig } from '../scripts/mainnet-v8-release.mjs';
import { MAINNET_V8_RELEASE_STEPS, MAINNET_V8_RELEASE_RUNNER_SCHEMA, sha256MainnetV8Json } from '../scripts/mainnet-v8-release-lib.mjs';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS } from '../scripts/native-soul-external-publications.mjs';

// Projection over synthetic certified rows: full bootstrap Object BCS, not
// publication/finality proof, an executed WAL or product acceptance.
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
function fixture() {
  const { manifest, plan, priorReadbacks } = contextFixture('VERIFY_AND_EXPORT');
  const native = manifest.packages.find(row => row.role === 'soulidity');
  const market = nativeSoulMarketActivationFixture({ packageId: native.packageId, sender: plan.sender,
    marketConfigId: id(9001), marketAdminCapId: id(9006), previousTransaction: native.publishDigest });
  const nativeReadback = { schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA, role: 'soulidity',
    kind: 'PACKAGE_PUBLISH_CERTIFICATE', transactionDigest: native.publishDigest,
    package: { reference: { objectId: native.packageId, digest: native.packageDigest, version: native.packageVersion },
    linkage: NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(row => ({ originalId: row.originalId,
      upgradedId: row.publishedAt, upgradedVersion: row.version })) },
    soulidityInitialization: { packageId: native.packageId,
      objects: Object.fromEntries(Object.entries(market.priorObjects).map(([kind, row]) => [kind, { ...row,
        owner: row.owner.kind === 'shared' ? { Shared: { initial_shared_version: row.owner.initialSharedVersion } }
          : { AddressOwner: row.owner.address },
      }])), ids: {
      marketConfigV2Id: id(9001), kindRegistryId: id(9002), kioskRegistryId: id(9003), soulTransferPolicyId: id(9004), collectionTransferPolicyId: id(9005),
      profileRegistryId: id(9010), socialRegistryId: id(9011), communityRegistryId: id(9012), communityVoteRegistryId: id(9013),
    } } };
  const rows = { core: priorReadbacks.core, soulidity: nativeReadback, ...priorReadbacks,
    ACTIVATE_SOULIDITY_MARKET: market.journal };
  const wal = { plan, executionPlanId: plan.executionPlanId, finalManifest: manifest, releaseId: manifest.releaseId,
    events: MAINNET_V8_RELEASE_STEPS.filter(row => rows[row.kind === 'PUBLISH' ? row.role : row.kind]).map(row => ({
      ordinal: row.ordinal, attempt: '0', status: 'FINALIZED_SUCCESS',
      evidence: { observation: { details: { certificate: {
        readback: rows[row.kind === 'PUBLISH' ? row.role : row.kind],
        readbackSha256: sha256MainnetV8Json(rows[row.kind === 'PUBLISH' ? row.role : row.kind]),
        ...(row.kind === 'ACTIVATE_SOULIDITY_MARKET' ? { finalityEvidence: {
          digest: TransactionDataBuilder.getDigestFromBytes(market.transactionBytes),
          transactionBase64: toBase64(market.transactionBytes), effectsBcsBase64: toBase64(market.effectsBytes),
        } } : {}),
      } } } },
    })) };
  return { wal, priorReadbacks, nativeReadback, native, market };
}

test('actual export consumer merges all four stages and includes native Complete configuration', () => {
  const { wal, priorReadbacks, native } = fixture();
  const result = mainnetV8RuntimeConfigFromWal(wal), runtime = result.runtimeConfig;
  assert.equal(result.finalReadback.stage, 'FINALIZE_BOOTSTRAP');
  assert.equal(runtime.protocolTreasuryId, priorReadbacks.INITIALIZE_PROTOCOL.objects.protocolTreasury.reference.objectId);
  assert.equal(runtime.roleConfigIds.seal, priorReadbacks.SETUP_RELEASE.objects.sealConfig.reference.objectId);
  assert.equal(runtime.roleConfigIds.output, priorReadbacks.FINALIZE_BOOTSTRAP.objects.outputConfig.reference.objectId);
  assert.equal(result.objects.outputConfig.reference.version, '15');
  assert.equal(Object.hasOwn(result.objects, 'bootstrapAdmin'), false);
  assert.equal(Object.keys(runtime.roles).length, 7);
  assert.equal(runtime.nativeSoulIntegration.soulidityCallablePackageId, native.packageId);
  assert.equal(runtime.nativeSoulIntegration.soulidityCallableDigest, native.packageDigest);
  assert.equal(runtime.nativeSoulIntegration.expectedNativeBinding.soulDefiningType, `${native.packageId}::soul::Soul`);
  assert.equal(runtime.nativeSoulIntegration.kioskPackageId, NATIVE_SOUL_EXTERNAL_PUBLICATIONS.find(row => row.packageName === 'Kiosk').publishedAt);
  assert.equal(Object.hasOwn(runtime, 'marketWritesEnabled'), false);
  const env = result.soulidityEnvironment, target = JSON.parse(env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON);
  assert.equal(Object.keys(env).length, 17);
  for (const [suffix, n] of [['PROFILE', 9010], ['SOCIAL', 9011], ['COMMUNITY', 9012], ['COMMUNITY_VOTE', 9013]]) {
    assert.equal(env[`NEXT_PUBLIC_SOULIDITY_${suffix}_REGISTRY_ID`], id(n));
  }
  assert.equal(env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID, native.packageId);
  assert.equal(env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID, target.soulidityCallablePackageId);
  assert.equal(env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID, runtime.nativeSoulIntegration.marketConfigV2Id);
  assert.equal(env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID, id(9005));
  assert.equal(env.NEXT_PUBLIC_KIOSK_PACKAGE_ID, runtime.nativeSoulIntegration.kioskPackageId);
  const walrus = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.find(row => row.packageName === 'Walrus');
  assert.equal(env.NEXT_PUBLIC_WALRUS_BLOB_TYPE, `${walrus.originalId}::blob::Blob`);
  assert.notEqual(env.NEXT_PUBLIC_WALRUS_BLOB_TYPE, `${walrus.publishedAt}::blob::Blob`);
  assert.equal(env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE, runtime.paymentCoinType);
  assert.deepEqual(target.expectedNativeBinding, runtime.nativeSoulIntegration.expectedNativeBinding);
  for (const role of ['output', 'runtime', 'release']) {
    const sealed = wal.finalManifest.packages.find(row => row.role === role);
    assert.equal(role === 'output' ? target.outputCallableDigest : target[role].callableDigest, sealed.packageDigest);
  }
  const market = wal.finalManifest.packages.find(row => row.role === 'market');
  assert.deepEqual(target.equipmentMarket, {
    originalPackageId: market.packageId, callablePackageId: market.packageId,
    callableDigest: market.packageDigest,
    replacementId: priorReadbacks.FINALIZE_BOOTSTRAP.objects.replacement.reference.objectId,
  });
  assert.equal(target.equipmentWritesEnabled, false); assert.equal(target.marketWritesEnabled, false);
  assert.ok(Object.isFrozen(env));
});

for (const [name, mutate] of [
  ['missing finalization', f => { f.wal.events = f.wal.events.filter(row => row.ordinal !== '11'); }],
  ['unfinalized transaction', f => { f.wal.events.find(row => row.ordinal === '11').status = 'FINALIZED_SUCCESS_PENDING_READBACK'; }],
  ['old setup pretending final', f => { Object.assign(f.priorReadbacks.FINALIZE_BOOTSTRAP, f.priorReadbacks.SETUP_RELEASE); }],
  ['wrong native package', f => { f.nativeReadback.package.reference.objectId = id(9999); }],
  ['wrong native digest', f => { f.nativeReadback.package.reference.digest = 'wrong'; }],
  ['wrong native initialization', f => { f.nativeReadback.soulidityInitialization.packageId = id(9999); }],
  ['missing native IDs', f => { delete f.nativeReadback.soulidityInitialization.ids.soulTransferPolicyId; }],
  ...['profileRegistryId', 'socialRegistryId', 'communityRegistryId', 'communityVoteRegistryId'].flatMap(key => [
    [`missing ${key}`, f => { delete f.nativeReadback.soulidityInitialization.ids[key]; }],
    [`zero ${key}`, f => { f.nativeReadback.soulidityInitialization.ids[key] = id(0); }],
    [`aliased ${key}`, f => { f.nativeReadback.soulidityInitialization.ids[key] = id(9001); }],
  ]),
  ['missing collection policy', f => { delete f.nativeReadback.soulidityInitialization.ids.collectionTransferPolicyId; }],
  ['aliased collection policy', f => { f.nativeReadback.soulidityInitialization.ids.collectionTransferPolicyId = id(9004); }],
  ['wrong dependency target', f => { f.nativeReadback.package.linkage.find(row => row.originalId === NATIVE_SOUL_EXTERNAL_PUBLICATIONS[0].originalId).upgradedId = id(9999); }],
  ['final input drift', f => { f.priorReadbacks.FINALIZE_BOOTSTRAP.input.protocolAdminCap.version = '999'; }],
  ['final predecessor drift', f => { f.priorReadbacks.FINALIZE_BOOTSTRAP.priorObjects.protocolAdmin.reference.version = '999'; }],
  ['final Object BCS drift', f => { f.priorReadbacks.FINALIZE_BOOTSTRAP.objects.outputConfig.objectBcsBase64 = 'AA=='; }],
  ['missing certified replacement', f => { delete f.priorReadbacks.FINALIZE_BOOTSTRAP.objects.replacement; }],
  ['replacement reference drift', f => { f.priorReadbacks.FINALIZE_BOOTSTRAP.objects.replacement.reference.objectId = id(9999); }],
  ['replacement Object BCS drift', f => { f.priorReadbacks.FINALIZE_BOOTSTRAP.objects.replacement.objectBcsBase64 = 'AA=='; }],
]) {
  test(`actual export projection rejects ${name}`, () => { const f = fixture(); mutate(f); assert.throws(() => mainnetV8RuntimeConfigFromWal(f.wal)); });
}

test('export snapshot stays detached and deeply frozen while later verification awaits', () => {
  const f = fixture(), result = mainnetV8RuntimeConfigFromWal(f.wal);
  const original = JSON.stringify(result);
  f.priorReadbacks.FINALIZE_BOOTSTRAP.input.protocolAdminCap.version = '999';
  f.nativeReadback.soulidityInitialization.ids.kindRegistryId = id(9999);
  f.wal.finalManifest.packages[0].packageId = id(9999);
  assert.equal(JSON.stringify(result), original);
  assert.ok(Object.isFrozen(result.runtimeConfig.nativeSoulIntegration));
  assert.ok(Object.isFrozen(result.finalReadback.input.protocolAdminCap));
  assert.throws(() => { result.finalReadback.objects.catalog.reference.version = '999'; }, TypeError);
  assert.throws(() => { result.runtimeConfig.roleConfigIds.output = id(9999); }, TypeError);
});

function exportedFixture() {
  const { wal } = fixture();
  const packageVerification = { fixture: 'authenticated by enclosing WAL, not this projection test' };
  const config = buildMainnetV8PairedConfig({ wal, packageVerification });
  const bytes = Buffer.from(JSON.stringify(config));
  const certificate = { verification: { packageVerification }, exports: {
    filename: 'animacraft-mainnet-v8-config.json', sha256: createHash('sha256').update(bytes).digest('hex'),
  } };
  wal.events.push({ ordinal: '13', status: 'FINALIZED_SUCCESS', evidence: { observation: { details: { certificate } } } });
  return { wal, config, bytes, certificate };
}
test('deployment content reader binds both configurations to the completed export hash', () => {
  const f = exportedFixture();
  assert.deepEqual(assertMainnetV8ExportConfigContents(f), f.config);
  assert.equal(f.config.marketActivation.primaryEnabled, true);
  assert.equal(f.config.marketActivation.secondaryEnabled, true);
  f.wal.events.pop();
  assert.throws(() => assertMainnetV8ExportConfigContents(f), { code: 'MAINNET_V8_EXPORT_INCOMPLETE' });
});
for (const [name, mutate] of [
  ['missing activation', f => { f.wal.events = f.wal.events.filter(row => row.ordinal !== '12'); }],
  ['unfinalized activation', f => { f.wal.events.find(row => row.ordinal === '12').status = 'FINALIZED_SUCCESS_PENDING_READBACK'; }],
  ['changed activation BCS even after rehash', f => {
    const cert = f.wal.events.find(row => row.ordinal === '12').evidence.observation.details.certificate;
    cert.readback.objects.marketConfigV2.objectBcsBase64 = 'AA=='; cert.readbackSha256 = sha256MainnetV8Json(cert.readback);
  }],
]) {
  test(`paired export refuses ${name}`, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => buildMainnetV8PairedConfig({ wal: f.wal, packageVerification: {} }));
  });
}
test('deployment export rejects unsupported format before reading any file', async () => {
  await assert.rejects(readMainnetV8DeploymentConfig({ stateDir: '/does-not-exist', format: 'shell' }),
    { code: 'MAINNET_V8_ARGUMENT_INVALID' });
});
for (const [name, mutate, rehash] of [
  ['modified bytes', c => { c.releaseId = 'a'.repeat(64); }, false],
  ['different release even when rehashed', c => { c.releaseId = 'a'.repeat(64); }, true],
  ['SO target swap even when rehashed', c => { c.soulidityEnvironment.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID = id(9999); }, true],
  ...['originalPackageId', 'callablePackageId', 'callableDigest', 'replacementId'].map(key => [
    `equipment Market ${key} swap even when rehashed`, c => {
      const target = JSON.parse(c.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON);
      target.equipmentMarket[key] = key === 'callableDigest' ? 'wrong' : id(9999);
      c.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target);
    }, true,
  ]),
  ['missing equipment Market even when rehashed', c => {
    const target = JSON.parse(c.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON);
    delete target.equipmentMarket;
    c.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target);
  }, true],
  ['unaccepted write gate even when rehashed', c => { const t = JSON.parse(c.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON); t.marketWritesEnabled = true; c.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(t); }, true],
  ['unexpected secret-like field even when rehashed', c => { c.AUTH_SECRET = 'not-a-real-secret'; }, true],
]) {
  test(`deployment content reader rejects ${name}`, () => {
    const f = exportedFixture(), config = structuredClone(f.config); mutate(config);
    f.bytes = Buffer.from(JSON.stringify(config));
    if (rehash) f.certificate.exports.sha256 = createHash('sha256').update(f.bytes).digest('hex');
    assert.throws(() => assertMainnetV8ExportConfigContents(f), { code: 'MAINNET_V8_CONFIG_EXPORT_DRIFT' });
  });
}
