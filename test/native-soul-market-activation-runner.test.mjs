import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import { nativeSoulMarketActivationFixture } from './fixtures/native-soul-market-activation-fixture.mjs';
import { contextFixture } from './fixtures/native-soul-bootstrap-context-fixture.mjs';
import { certifyMainnetV8MarketActivation, buildMainnetV8ReadyTransaction, inspectMainnetV8Transaction,
  certifyOrdinalReadback, nativeSoulMarketActivationContextFromWal, assertMainnetV8ReadyWalContextContents } from '../scripts/mainnet-v8-release.mjs';
import { buildNativeSoulMarketActivationTransaction } from '../scripts/native-soul-market-activation.mjs';
import { MAINNET_V8_RELEASE_STEPS, MAINNET_V8_CHAIN_IDENTIFIER, MAINNET_V8_RELEASE_RUNNER_SCHEMA,
  sha256MainnetV8Json } from '../scripts/mainnet-v8-release-lib.mjs';

// Exact BCS fixtures and actual reader/compiler, not mainnet execution/finality.
function fixture(options) {
  const f = nativeSoulMarketActivationFixture(options), calls = [];
  const transport = {
    getObject: () => { throw new Error('Latest object lookup is forbidden'); },
    getHistoricalObject: async request => {
      calls.push(request); assert.equal(typeof request.version, 'bigint');
      const row = Object.values(f.objects).find(row => row.reference.objectId === request.objectId
        && row.reference.version === String(request.version));
      assert.ok(row, 'exact historical reference required');
      const owner = row.owner.kind === 'shared' ? { kind: 'Shared', initialSharedVersion: row.owner.initialSharedVersion }
        : { kind: 'AddressOwner', address: row.owner.address };
      return { ...row.reference, type: row.type, owner, previousTransaction: row.previousTransaction,
        objectBcs: fromBase64(row.objectBcsBase64) };
    },
  };
  const args = { input: structuredClone(f.input), priorObjects: structuredClone(f.priorObjects), signer: f.sender, transport,
    finalityEvidence: { digest: TransactionDataBuilder.getDigestFromBytes(f.transactionBytes),
      transactionBase64: toBase64(f.transactionBytes), effectsBcsBase64: toBase64(f.effectsBytes) } };
  return { f, args, calls };
}
test('actual READY compiler includes both existing market gate calls at the sole activation step', async () => {
  const f = nativeSoulMarketActivationFixture();
  const step = MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'ACTIVATE_SOULIDITY_MARKET');
  assert.equal(step.ordinal, '12');
  const actual = await inspectMainnetV8Transaction(buildMainnetV8ReadyTransaction({ ordinal: step.ordinal,
    readyArtifact: { kind: step.kind, stageData: f.input }, transactionContext: {
      sender: f.sender, gasPrice: '100', gasBudget: '100000000', epoch: '1242', chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER, nonce: 123,
    } }));
  const expected = await buildNativeSoulMarketActivationTransaction(f.input).build({ onlyTransactionKind: true });
  assert.equal(actual.transactionKindBase64, toBase64(expected));
  assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal: '13',
    readyArtifact: { kind: step.kind, stageData: f.input }, transactionContext: {} }));
});
test('actual market certifier reads exactly two effect-selected historical versions', async () => {
  const { f, args, calls } = fixture();
  const result = await certifyMainnetV8MarketActivation(args);
  assert.deepEqual(result, f.journal); assert.equal(calls.length, 2);
  assert.ok(Object.isFrozen(result.objects.marketConfigV2.reference));
});
test('market certifier rejects mismatched finality before any network read', async () => {
  const { args, calls } = fixture();
  args.finalityEvidence.digest = toBase58(new Uint8Array(32).fill(98));
  await assert.rejects(certifyMainnetV8MarketActivation(args), { code: 'MAINNET_V8_READBACK_TRANSACTION_INVALID' });
  assert.equal(calls.length, 0);
});
for (const field of ['version', 'digest', 'previousTransaction']) {
  test(`market certifier rejects historical ${field} substitution`, async () => {
    const { args } = fixture(), read = args.transport.getHistoricalObject;
    args.transport.getHistoricalObject = async request => ({ ...await read(request),
      [field]: field === 'version' ? '999' : toBase58(new Uint8Array(32).fill(98)) });
    await assert.rejects(certifyMainnetV8MarketActivation(args));
  });
}
test('market certifier snapshots input/prior/finality before asynchronous reads', async () => {
  const { f, args } = fixture(), read = args.transport.getHistoricalObject;
  let mutated = false;
  args.transport.getHistoricalObject = async request => {
    if (!mutated) {
      mutated = true; args.input.marketConfig.objectId = args.input.packageId;
      args.priorObjects.marketAdminCapV2.reference.version = '999';
      args.finalityEvidence.effectsBcsBase64 = ''; args.finalityEvidence.digest = 'bad';
    }
    return read(request);
  };
  assert.deepEqual(await certifyMainnetV8MarketActivation(args), f.journal);
});
test('market certifier settles both in-flight historical reads before rejecting', async () => {
  const { args } = fixture(); let completed = 0, index = 0;
  args.transport.getHistoricalObject = async () => {
    if (index++ === 0) throw new Error('historical read failed');
    await new Promise(resolve => setImmediate(resolve)); completed++; throw new Error('second failed');
  };
  await assert.rejects(certifyMainnetV8MarketActivation(args), /historical read failed/);
  assert.equal(completed, 1);
});

function walFixture() {
  const context = contextFixture('VERIFY_AND_EXPORT');
  const row = context.manifest.packages.find(row => row.role === 'soulidity');
  const base = fixture({ packageId: row.packageId, sender: context.plan.sender, previousTransaction: row.publishDigest });
  const publication = { role: 'soulidity', schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'PACKAGE_PUBLISH_CERTIFICATE', transactionDigest: row.publishDigest,
    package: { reference: { objectId: row.packageId, version: row.packageVersion, digest: row.packageDigest } },
    soulidityInitialization: { packageId: row.packageId, objects: Object.fromEntries(Object.entries(base.f.priorObjects).map(([kind, value]) => [kind, {
      ...value, owner: value.owner.kind === 'shared' ? { Shared: { initial_shared_version: value.owner.initialSharedVersion } }
        : { AddressOwner: value.owner.address },
    }])) } };
  const event = (ordinal, readback) => ({ ordinal, status: 'FINALIZED_SUCCESS', evidence: { observation: { details: { certificate: { readback } } } } });
  const final = event('11', context.priorReadbacks.FINALIZE_BOOTSTRAP);
  const wal = { plan: context.plan, finalManifest: context.manifest, releaseId: context.manifest.releaseId,
    events: [event('6', publication), final] };
  const derived = nativeSoulMarketActivationContextFromWal(wal);
  const readyArtifact = { kind: 'ACTIVATE_SOULIDITY_MARKET', stageData: derived.stageData,
    stageDataSha256: sha256MainnetV8Json(derived.stageData), predecessorReadback: {
      ordinal: '11', certificate: final.evidence.observation.details,
      certificateSha256: sha256MainnetV8Json(final.evidence.observation.details),
    } };
  return { ...base, wal, publication, readyArtifact };
}
test('actual READY context and dispatcher bind market activation to SO publication and FINAL11', async () => {
  const f = walFixture();
  assertMainnetV8ReadyWalContextContents({ wal: f.wal, ordinal: '12', readyArtifact: f.readyArtifact });
  const observed = await certifyOrdinalReadback({ ordinal: '12', wal: f.wal,
    ready: { readyArtifact: f.readyArtifact }, transport: f.args.transport, finalityEvidence: f.args.finalityEvidence });
  assert.deepEqual(observed, f.f.journal); assert.equal(f.calls.length, 2);
});
test('market READY rejects self-reported reference and omitted bootstrap predecessor', () => {
  const f = walFixture(); f.readyArtifact.stageData = structuredClone(f.readyArtifact.stageData);
  f.readyArtifact.stageData.marketAdminCap.version = '999';
  f.readyArtifact.stageDataSha256 = sha256MainnetV8Json(f.readyArtifact.stageData);
  assert.throws(() => assertMainnetV8ReadyWalContextContents({ wal: f.wal, ordinal: '12', readyArtifact: f.readyArtifact }));
  f.wal.events.pop(); assert.throws(() => nativeSoulMarketActivationContextFromWal(f.wal));
});
test('actual market dispatcher rejects mismatched publication before historical I/O', async () => {
  const f = walFixture(); f.publication.package.reference.digest = toBase58(new Uint8Array(32).fill(99));
  await assert.rejects(certifyOrdinalReadback({ ordinal: '12', wal: f.wal, ready: { readyArtifact: f.readyArtifact },
    transport: f.args.transport, finalityEvidence: f.args.finalityEvidence }));
  assert.equal(f.calls.length, 0);
});
