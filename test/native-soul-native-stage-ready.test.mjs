import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import {
  MAINNET_V8_RELEASE_STEPS, MAINNET_V8_PUBLISH_ORDER, MAINNET_V8_ROLE_ORDER,
  nativeSoulBootstrapInputFromStageData as extract, buildMainnetV8ReadyEvidence,
  assertMainnetV8NativeBootstrapReadback,
  buildMainnetV8OutcomeEvidence, mainnetV8TypedDigest,
  assertWalEvidence,
  nativeSoulMarketActivationInputFromStageData,
  sha256MainnetV8Bytes as hash, sha256MainnetV8Json as jsonHash,
} from '../scripts/mainnet-v8-release-lib.mjs';
import { buildNativeSoulBootstrapTransaction as build } from '../scripts/native-soul-bootstrap-transactions.mjs';
import { bootstrapStages } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { bootstrapHistoryFixture } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
import { bootstrapFinalityEvents } from './fixtures/native-soul-bootstrap-events-fixture.mjs';
import { buildNativeSoulMarketActivationTransaction } from '../scripts/native-soul-market-activation.mjs';
import {
  nativeSoulStageDataFixture as stageData,
  nativeSoulStageReadyFixture as ready,
  nativeSoulStageOutcomeFixture as outcome,
} from './fixtures/native-soul-native-stage-ready-fixture.mjs';

const digest = toBase58(new Uint8Array(32).fill(73));
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const kindBytes = (stage, input) => TransactionDataBuilder.restore(build(stage, input).getData()).build({ onlyTransactionKind: true });
const marketOutcome = () => outcome('ACTIVATE_SOULIDITY_MARKET');

test('one schedule contains exact eight publications, four native stages, market activation and export', () => {
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.map(s => s.ordinal), Array.from({ length: 14 }, (_, i) => String(i)));
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.slice(0, 8).map(s => [s.kind, s.role]), MAINNET_V8_PUBLISH_ORDER.map(role => ['PUBLISH', role]));
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.slice(8).map(s => s.kind), [...bootstrapStages, 'ACTIVATE_SOULIDITY_MARKET', 'VERIFY_AND_EXPORT']);
  assert.equal(MAINNET_V8_ROLE_ORDER.length, 7);
});
for (const stage of bootstrapStages) {
  test(`${stage}: shared extraction preserves actual builder bytes and is immutable/offline`, async t => {
    const data = stageData(stage), before = structuredClone(data);
    const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('offline only'); });
    const input = extract(stage, data), expected = structuredClone(before); delete expected.keyServerCertificates;
    assert.deepEqual(input, expected); assert.deepEqual(data, before);
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.packageIds));
    assert.deepEqual(kindBytes(stage, input), await build(stage, expected).build({ onlyTransactionKind: true }));
    data.packageIds.core = id(999); assert.notEqual(input.packageIds.core, data.packageIds.core);
    assert.equal(network.mock.callCount(), 0);
  });
  test(`${stage}: actual READY dispatcher accepts canonical native input and transaction envelope`, () => {
    const f = ready(stage), before = structuredClone(f);
    const result = buildMainnetV8ReadyEvidence(f);
    assert.deepEqual(f, before); assert.ok(Object.isFrozen(result));
    assertWalEvidence({ status: 'READY', ordinal: f.ordinal, attempt: '0', evidence: result });
  });
  test(`${stage}: READY cannot move to an adjacent ordinal or preserve a stale stage hash`, () => {
    const f = ready(stage);
    assert.throws(() => buildMainnetV8ReadyEvidence({ ...f, ordinal: String(BigInt(f.ordinal) - 1n) }));
    f.readyArtifact.stageData.protocolConfig.initialSharedVersion = '99';
    assert.throws(() => buildMainnetV8ReadyEvidence(f), /hash/);
    f.readyArtifact.stageDataSha256 = jsonHash(f.readyArtifact.stageData);
    // Stage data remains structurally valid; transaction binding is additionally
    // enforced by the runner's shared native compiler before signing.
  });
  for (const [name, mutate] of Object.entries({
    'missing Soulidity': x => { delete x.packageIds.soulidity; },
    'duplicate publication': x => { x.packageIds.soulidity = x.packageIds.core; },
    'unknown role': x => { x.packageIds.legacy = id(901); },
    'zero package': x => { x.packageIds.core = id(0); },
    'short package': x => { x.packageIds.core = '0x1'; },
    'zero shared version': x => { x.protocolConfig.initialSharedVersion = '0'; },
    'invalid owned digest': x => { x.protocolAdminCap.digest = 'invalid'; },
    'unknown ctx': x => { x.ctx = id(1); },
    'unknown gas': x => { x.gasBudget = '1000'; },
  })) test(`${stage}: input rejects ${name}`, () => {
    const data = stageData(stage); mutate(data); assert.throws(() => extract(stage, data));
  });
}

for (const stage of bootstrapStages) {
  test(`${stage}: actual outcome entry reaches native cold history with exact finality and signed bytes`, () => {
    const input = outcome(stage), before = structuredClone(input);
    const result = buildMainnetV8OutcomeEvidence(input);
    assert.equal(result.observation.kind, `${stage}_FINALIZED_SUCCESS`);
    assert.deepEqual(result.observation.details.certificate.readback, input.observation.certificate.readback);
    assert.deepEqual(input, before);
    assertWalEvidence({ status: input.status, ordinal: input.ordinal, attempt: input.attempt, evidence: result });
  });
  test(`${stage}: actual outcome rejects rehashed historical substitution and stage swap`, () => {
    const input = outcome(stage), certificate = input.observation.certificate;
    certificate.readback.objects.protocol.reference.digest = digest;
    certificate.readbackSha256 = jsonHash(certificate.readback);
    input.observation.certificateSha256 = jsonHash(certificate);
    assert.throws(() => buildMainnetV8OutcomeEvidence(input), /digest/);
    const swapped = outcome(stage); swapped.observation.certificate.readback.stage = 'BOOTSTRAP_RELEASE';
    swapped.observation.certificate.readbackSha256 = jsonHash(swapped.observation.certificate.readback);
    swapped.observation.certificateSha256 = jsonHash(swapped.observation.certificate);
    assert.throws(() => buildMainnetV8OutcomeEvidence(swapped), /stage/);
  });
  test(`${stage}: successful outcome cannot omit its signed artifact`, () => {
    const input = outcome(stage); delete input.signedArtifact;
    assert.throws(() => buildMainnetV8OutcomeEvidence(input));
  });
  test(`${stage}: actual WAL evidence rejects rehashed finality with another signature`, () => {
    const input = outcome(stage), c = input.observation.certificate;
    const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x44));
    c.finalityEvidence.signature = toBase64(signatureBytes);
    c.finalityEvidence.signatureSha256 = hash(signatureBytes);
    c.finalityEvidenceSha256 = jsonHash(c.finalityEvidence);
    input.observation.certificateSha256 = jsonHash(c);
    const evidence = buildMainnetV8OutcomeEvidence(input);
    assert.throws(() => assertWalEvidence({ status: input.status, ordinal: input.ordinal,
      attempt: input.attempt, evidence }), /differs from the signed artifact/);
  });
  test(`${stage}: finalized failure retains signed/finality checks without requiring successful readback`, () => {
    const input = outcome(stage), c = input.observation.certificate, e = c.finalityEvidence;
    const parsed = bcs.TransactionEffects.parse(fromBase64(e.effectsBcsBase64));
    parsed.V2.status = { Failure: { error: { InsufficientGas: true }, command: null } };
    const bytes = bcs.TransactionEffects.serialize(parsed).toBytes();
    Object.assign(e, { effectsBcsBase64: toBase64(bytes), effectsSha256: hash(bytes),
      effectsDigest: mainnetV8TypedDigest('TransactionEffects', bytes), effectsStatus: { success: false, error: { code: 'InsufficientGas' } } });
    c.finalityEvidenceSha256 = jsonHash(e); c.readback = null; c.readbackSha256 = null;
    input.observation.certificateSha256 = jsonHash(c); input.status = 'FINALIZED_FAILURE';
    assert.equal(buildMainnetV8OutcomeEvidence(input).observation.kind, `${stage}_FINALIZED_FAILURE`);
    delete input.signedArtifact;
    assert.throws(() => buildMainnetV8OutcomeEvidence(input));
  });
}
test('actual VERIFY13 outcome accepts exact eight-package proof without signatures and refuses old ordinal12', () => {
  const packageVerification = { kind: 'FINAL_PACKAGE_REBUILD_VERIFICATION', executionPlanId: '1'.repeat(64),
    releaseId: '2'.repeat(64), packages: MAINNET_V8_PUBLISH_ORDER.map((role, i) => ({ role, packageId: id(11 + i),
      packageDigest: digest, packageVersion: '1', publishDigest: digest,
      ...Object.fromEntries(['sourceCommitment', 'packageCommitment', 'abiCommitment', 'moduleMapSha256',
        'objectBcsSha256', 'readbackSha256'].map(k => [k, 'a'.repeat(64)])) })) };
  const verification = { kind: 'VERIFY_AND_EXPORT', executionPlanId: '1'.repeat(64), releaseId: '2'.repeat(64),
    finalManifestSha256: '3'.repeat(64), packageVerification, packageVerificationSha256: jsonHash(packageVerification),
    runtimeAttestationSha256: '4'.repeat(64), marketActivationCertificateSha256: '7'.repeat(64) };
  const exports = { filename: 'native-release.json', sha256: '5'.repeat(64), protectedDecryptionReady: false };
  const certificate = { verification, verificationSha256: jsonHash(verification), exports, exportsSha256: jsonHash(exports) };
  const input = { status: 'FINALIZED_SUCCESS', ordinal: '13', attempt: '0', readyArtifactSha256: '6'.repeat(64),
    observation: { certificate, certificateSha256: jsonHash(certificate) } };
  assert.equal(buildMainnetV8OutcomeEvidence(input).observation.kind, 'VERIFY_AND_EXPORT_FINALIZED_SUCCESS');
  assert.throws(() => buildMainnetV8OutcomeEvidence({ ...input, digest }));
  assert.throws(() => buildMainnetV8OutcomeEvidence({ ...input, ordinal: '12' }));
  packageVerification.packages.pop(); verification.packageVerificationSha256 = jsonHash(packageVerification);
  certificate.verificationSha256 = jsonHash(verification); input.observation.certificateSha256 = jsonHash(certificate);
  assert.throws(() => buildMainnetV8OutcomeEvidence(input), /eight/);
});
for (const [name, mutate] of Object.entries({
  'missing debit': rows => { rows.splice(rows.findIndex(([, r]) => r.outputState.AccumulatorWriteV1), 1); },
  'wrong delta': rows => { rows.find(([, r]) => r.outputState.AccumulatorWriteV1)[1].outputState.AccumulatorWriteV1.value.Integer = '2'; },
  'wrong direction': rows => { rows.find(([, r]) => r.outputState.AccumulatorWriteV1)[1].outputState.AccumulatorWriteV1.operation = { Merge: true }; },
  'wrong payer': rows => { rows.find(([, r]) => r.outputState.AccumulatorWriteV1)[1].outputState.AccumulatorWriteV1.address.address = id(999); },
  'wrong accumulator ID': rows => { rows.find(([, r]) => r.outputState.AccumulatorWriteV1)[0] = id(999); },
  'duplicate debit': rows => { rows.push(structuredClone(rows.find(([, r]) => r.outputState.AccumulatorWriteV1))); },
})) test(`actual outcome rejects rehashed address-balance gas ${name}`, () => {
  const input = outcome('SETUP_RELEASE'), c = input.observation.certificate, e = c.finalityEvidence;
  const parsed = bcs.TransactionEffects.parse(fromBase64(e.effectsBcsBase64));
  mutate(parsed.V2.changedObjects);
  const bytes = bcs.TransactionEffects.serialize(parsed).toBytes();
  Object.assign(e, { effectsBcsBase64: toBase64(bytes), effectsSha256: hash(bytes),
    effectsDigest: mainnetV8TypedDigest('TransactionEffects', bytes) });
  c.finalityEvidenceSha256 = jsonHash(e); input.observation.certificateSha256 = jsonHash(c);
  assert.throws(() => buildMainnetV8OutcomeEvidence(input));
});
test('retired monolithic stage cannot be extracted or dispatched', () => {
  const data = stageData('SETUP_RELEASE');
  assert.throws(() => extract('BOOTSTRAP_RELEASE', data));
  const f = ready('SETUP_RELEASE'); f.readyArtifact.kind = 'BOOTSTRAP_RELEASE';
  assert.throws(() => buildMainnetV8ReadyEvidence(f));
});
test('VERIFY_AND_EXPORT is nontransactional only at ordinal13, not the former ordinal12', () => {
  const f = ready('FINALIZE_BOOTSTRAP');
  f.ordinal = '13';
  f.readyArtifact.kind = 'VERIFY_AND_EXPORT';
  f.readyArtifact.stageData = { releaseId: '1'.repeat(64), finalManifestSha256: '2'.repeat(64),
    bootstrapCertificateSha256: '3'.repeat(64), marketActivationCertificateSha256: '4'.repeat(64), exportFilename: 'native-release.json' };
  f.readyArtifact.stageDataSha256 = jsonHash(f.readyArtifact.stageData);
  f.readyArtifact.predecessorReadback.ordinal = '12';
  f.readyArtifact.simulation = null; f.readyArtifact.gasFunding = null;
  const envelope = f.unsignedEnvelope; f.unsignedEnvelope = null;
  assert.ok(buildMainnetV8ReadyEvidence(f));
  assert.throws(() => buildMainnetV8ReadyEvidence({ ...f, unsignedEnvelope: envelope }));
  assert.throws(() => buildMainnetV8ReadyEvidence({ ...f, ordinal: '12' }));
  assert.throws(() => buildMainnetV8ReadyEvidence({ ...f, ordinal: '14' }));
});
for (const stage of bootstrapStages) test(`${stage}: a native transaction cannot omit its envelope or simulation`, () => {
  const f = ready(stage);
  assert.throws(() => buildMainnetV8ReadyEvidence({ ...f, unsignedEnvelope: null }));
  f.readyArtifact.simulation = null;
  assert.throws(() => buildMainnetV8ReadyEvidence(f));
});
for (const stage of bootstrapStages.filter(s => s !== 'SETUP_RELEASE')) test(`${stage}: certificates are not transaction inputs`, () => {
  const data = stageData(stage); data.keyServerCertificates = [];
  assert.throws(() => extract(stage, data));
});
for (const [name, mutate] of Object.entries({
  'missing certificates': x => { delete x.keyServerCertificates; },
  'empty certificates': x => { x.keyServerCertificates = []; },
  'extra certificate': x => { x.keyServerCertificates.push(structuredClone(x.keyServerCertificates[0])); },
  'missing second certificate': x => { x.keyServerCertificates.pop(); },
  'reversed certificates': x => { x.keyServerCertificates.reverse(); },
  'duplicate certificate': x => { x.keyServerCertificates[1] = structuredClone(x.keyServerCertificates[0]); },
  'second wrong owner': x => { x.keyServerCertificates[1].owner = id(88); },
  'second wrong content hash': x => { x.keyServerCertificates[1].contentSha256 = 'a'.repeat(64); },
  'second wrong type': x => { x.keyServerCertificates[1].type += 'Other'; },
  'wrong committee': x => { x.keyServerCertificates[0].objectId = id(88); },
  'wrong type': x => { x.keyServerCertificates[0].type += 'Other'; },
  'wrong owner': x => { x.keyServerCertificates[0].owner = id(88); },
  'wrong content hash': x => { x.keyServerCertificates[0].contentSha256 = 'a'.repeat(64); },
  'zero certificate version': x => { x.keyServerCertificates[0].version = '0'; },
  'wrong previous digest': x => { x.keyServerCertificates[0].previousTransaction = '0x01'; },
  'extra certificate field': x => { x.keyServerCertificates[0].secret = 'forbidden'; },
  'missing Catalog role': x => { delete x.commitments.release; },
  'eighth Catalog role': x => { x.commitments.soulidity = structuredClone(x.commitments.release); },
  'zero source': x => { x.commitments.core.source = '0'.repeat(64); },
  'Seal package mismatch': x => { x.commitments.seal.package = 'a'.repeat(64); },
  'wrong Walrus System': x => { x.walrusSystem.objectId = id(77); },
})) test(`SETUP rejects ${name} through both extractor and actual READY dispatcher`, () => {
  const f = ready('SETUP_RELEASE'); mutate(f.readyArtifact.stageData);
  f.readyArtifact.stageDataSha256 = jsonHash(f.readyArtifact.stageData);
  assert.throws(() => extract('SETUP_RELEASE', f.readyArtifact.stageData));
  assert.throws(() => buildMainnetV8ReadyEvidence(f));
});

for (const stage of bootstrapStages) {
  test(`${stage}: cold readback delegates full historical Object/effects validation`, () => {
    const f = bootstrapHistoryFixture(stage);
    const eventFields = bootstrapFinalityEvents(f);
    f.effects.V2.eventsDigest = eventFields.eventsDigest; f.refreshEffects();
    const readback = { schema: 'native-soul-bootstrap-history-v1', stage, input: f.input,
      objects: f.objects, priorObjects: f.priorObjects, consensusObjects: f.consensusObjects };
    const finality = { transactionBase64: toBase64(f.transactionBytes), effectsBcsBase64: toBase64(f.effectsBytes), ...eventFields };
    assert.equal(assertMainnetV8NativeBootstrapReadback(readback, stage, finality, f.sender), readback);
    assert.throws(() => assertMainnetV8NativeBootstrapReadback(readback, 'BOOTSTRAP_RELEASE', finality, f.sender));
    assert.throws(() => assertMainnetV8NativeBootstrapReadback(readback, stage, finality, id(666)));
    const damaged = structuredClone(readback); damaged.objects.protocol.reference.digest = digest;
    assert.throws(() => assertMainnetV8NativeBootstrapReadback(damaged, stage, finality, f.sender));
    const extra = { ...readback, derivedHistory: {} };
    assert.throws(() => assertMainnetV8NativeBootstrapReadback(extra, stage, finality, f.sender));
  });
}

test('market12 actual READY and cold outcome/WAL evidence use exact two-call bytes, objects and address gas', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('offline only'); });
  const r = ready('ACTIVATE_SOULIDITY_MARKET'), before = structuredClone(r);
  const input = nativeSoulMarketActivationInputFromStageData(r.readyArtifact.stageData);
  assert.ok(Object.isFrozen(input) && Object.isFrozen(input.marketConfig));
  assert.deepEqual(await buildNativeSoulMarketActivationTransaction(input).build({ onlyTransactionKind: true }),
    fromBase64(r.unsignedEnvelope.transactionKindBase64));
  const evidence = buildMainnetV8ReadyEvidence(r);
  assertWalEvidence({ status: 'READY', ordinal: '12', attempt: '0', evidence }); assert.deepEqual(r, before);
  const o = marketOutcome(), copy = structuredClone(o), result = buildMainnetV8OutcomeEvidence(o);
  assert.equal(result.observation.kind, 'ACTIVATE_SOULIDITY_MARKET_FINALIZED_SUCCESS');
  assertWalEvidence({ status: o.status, ordinal: '12', attempt: '0', evidence: result });
  assert.deepEqual(o, copy); assert.equal(network.mock.callCount(), 0);
});
for (const [name, mutate] of Object.entries({
  'extra keyserver certificates': x => { x.keyServerCertificates = []; },
  'zero owned version': x => { x.marketAdminCap.version = '0'; },
  'zero shared birth': x => { x.marketConfig.initialSharedVersion = '0'; },
  'extra ctx': x => { x.ctx = id(88); },
})) test(`market READY rejects ${name} even after stage rehash`, () => {
  const r = ready('ACTIVATE_SOULIDITY_MARKET'); mutate(r.readyArtifact.stageData);
  r.readyArtifact.stageDataSha256 = jsonHash(r.readyArtifact.stageData);
  assert.throws(() => buildMainnetV8ReadyEvidence(r));
});
for (const [name, mutate] of Object.entries({
  'wrong stage': x => { x.stage = 'FINALIZE_BOOTSTRAP'; },
  'missing admin output': x => { delete x.objects.marketAdminCapV2; },
  'forged prior version': x => { x.priorObjects.marketAdminCapV2.reference.version = '999'; },
  'substituted package': x => { x.input.packageId = id(991); },
  'extra field': x => { x.consensusObjects = {}; },
})) test(`market actual outcome rejects ${name} with consistent outer hashes`, () => {
  const o = marketOutcome(), c = o.observation.certificate; mutate(c.readback);
  c.readbackSha256 = jsonHash(c.readback); o.observation.certificateSha256 = jsonHash(c);
  assert.throws(() => buildMainnetV8OutcomeEvidence(o));
});
test('market actual success rejects missing gas debit after complete effects/certificate rehash', () => {
  const o = marketOutcome(), c = o.observation.certificate, e = c.finalityEvidence;
  const effects = bcs.TransactionEffects.parse(fromBase64(e.effectsBcsBase64));
  effects.V2.changedObjects = effects.V2.changedObjects.filter(([, row]) => !row.outputState.AccumulatorWriteV1);
  const bytes = bcs.TransactionEffects.serialize(effects).toBytes();
  Object.assign(e, { effectsBcsBase64: toBase64(bytes), effectsSha256: hash(bytes), effectsDigest: mainnetV8TypedDigest('TransactionEffects', bytes) });
  c.finalityEvidenceSha256 = jsonHash(e); o.observation.certificateSha256 = jsonHash(c);
  assert.throws(() => buildMainnetV8OutcomeEvidence(o));
});
test('market12 cannot be an unsigned VERIFY; finalized failure still retains signature and finality', () => {
  const missing = marketOutcome(); delete missing.signedArtifact;
  assert.throws(() => buildMainnetV8OutcomeEvidence(missing));
  const o = marketOutcome(), c = o.observation.certificate, e = c.finalityEvidence;
  const effects = bcs.TransactionEffects.parse(fromBase64(e.effectsBcsBase64));
  effects.V2.status = { Failure: { error: { InsufficientGas: true }, command: null } };
  const bytes = bcs.TransactionEffects.serialize(effects).toBytes();
  Object.assign(e, { effectsBcsBase64: toBase64(bytes), effectsSha256: hash(bytes), effectsDigest: mainnetV8TypedDigest('TransactionEffects', bytes),
    effectsStatus: { success: false, error: { code: 'InsufficientGas' } } });
  c.readback = null; c.readbackSha256 = null; c.finalityEvidenceSha256 = jsonHash(e);
  o.observation.certificateSha256 = jsonHash(c); o.status = 'FINALIZED_FAILURE';
  const result = buildMainnetV8OutcomeEvidence(o);
  assertWalEvidence({ status: o.status, ordinal: '12', attempt: '0', evidence: result });
});
