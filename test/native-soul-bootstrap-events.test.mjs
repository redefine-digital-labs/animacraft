import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { nativeSoulStageOutcomeFixture } from './fixtures/native-soul-native-stage-ready-fixture.mjs';
import { buildMainnetV8OutcomeEvidence, mainnetV8TypedDigest,
  sha256MainnetV8Bytes as hash, sha256MainnetV8Json as jsonHash } from '../scripts/mainnet-v8-release-lib.mjs';
import { certifyMainnetV8NativeBootstrap } from '../scripts/mainnet-v8-release.mjs';

// Independent layouts from the actual Protocol/Seal Move event definitions.
// These tests use encoded mock historical RPC results, never a network or key.
const Event = bcs.struct('FixtureNativeEvent', { package_id: bcs.Address,
  transaction_module: bcs.string(), sender: bcs.Address, event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()) });
const Events = bcs.struct('FixtureNativeEvents', { data: bcs.vector(Event) });
const Treasury = bcs.struct('FixtureTreasuryInitialized', { config_id: bcs.Address,
  treasury_id: bcs.Address, revision: bcs.u64(), commitment: bcs.vector(bcs.u8()) });
const Enabled = bcs.struct('FixtureEnabledChanged', { config_id: bcs.Address,
  revision: bcs.u64(), enabled: bcs.bool(), commitment: bcs.vector(bcs.u8()) });
const Seal = bcs.struct('FixtureSealPolicyCreated', { config_id: bcs.Address, catalog_id: bcs.Address,
  threshold: bcs.u16(), key_server_set_commitment: bcs.vector(bcs.u8()), commitment: bcs.vector(bcs.u8()) });
const otherId = `0x${'77'.repeat(32)}`;
const errorCode = error => error.code === 'NATIVE_SOUL_BOOTSTRAP_EVENTS_INVALID';
const outcomeError = input => input.observation.certificate.finalityEvidence.transactionEvents?.eventCount === '0'
  // The outer finality validator already disallows a non-null empty receipt;
  // the live entry below separately exercises the stage event validator.
  ? error => error.code === 'MAINNET_V8_DECIMAL_INVALID' && /transactionEvents.eventCount/.test(error.message)
  : errorCode;

function rehashEvents(input, mutate) {
  const changed = structuredClone(input), certificate = changed.observation.certificate;
  const finality = certificate.finalityEvidence;
  const events = finality.transactionEvents === null ? { data: [] }
    : Events.parse(fromBase64(finality.transactionEvents.bcsBase64));
  const absent = mutate(events.data) === null;
  const bytes = Events.serialize(events).toBytes();
  finality.eventsDigest = absent ? null : mainnetV8TypedDigest('TransactionEvents', bytes);
  finality.transactionEvents = absent ? null : { digest: finality.eventsDigest, bcsBase64: toBase64(bytes), eventCount: String(events.data.length) };
  const effects = bcs.TransactionEffects.parse(fromBase64(finality.effectsBcsBase64));
  effects.V2.eventsDigest = finality.eventsDigest;
  const effectsBytes = bcs.TransactionEffects.serialize(effects).toBytes();
  finality.effectsBcsBase64 = toBase64(effectsBytes); finality.effectsSha256 = hash(effectsBytes);
  finality.effectsDigest = mainnetV8TypedDigest('TransactionEffects', effectsBytes);
  certificate.finalityEvidenceSha256 = jsonHash(finality);
  changed.observation.certificateSha256 = jsonHash(certificate);
  return changed;
}
function changePayload(events, index, codec, mutate) {
  const value = codec.parse(Uint8Array.from(events[index].contents)); mutate(value);
  events[index].contents = codec.serialize(value).toBytes();
}
async function live(input) {
  const { readback, finalityEvidence } = input.observation.certificate;
  const rows = [...Object.values(readback.objects), ...Object.values(readback.consensusObjects)];
  let reads = 0;
  const result = await certifyMainnetV8NativeBootstrap({ stage: readback.stage, input: readback.input,
    priorObjects: readback.priorObjects, signer: input.signedArtifact.signer, finalityEvidence,
    transport: { getObject() { assert.fail('No current/latest dependency lookup'); },
      async getHistoricalObject(request) {
        assert.equal(typeof request.version, 'bigint'); reads++;
        const row = rows.find(r => r.reference.objectId === request.objectId
          && r.reference.version === String(request.version));
        assert.ok(row, 'exact historical object/version required');
        const owner = row.owner.kind === 'shared' ? { kind: 'Shared', initialSharedVersion: row.owner.initialSharedVersion }
          : row.owner.kind === 'address' ? { kind: 'AddressOwner', address: row.owner.address }
            : row.owner.kind === 'object' ? { kind: 'ObjectOwner', address: row.owner.objectId } : { kind: 'Immutable' };
        return { ...row.reference, type: row.type, owner, previousTransaction: row.previousTransaction,
          objectBcs: fromBase64(row.objectBcsBase64) };
      } },
  });
  assert.ok(reads > 0);
  return result;
}

for (const stage of ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE']) {
  test(`${stage}: exact Move events pass actual outcome and historical live certifier`, async () => {
    const input = nativeSoulStageOutcomeFixture(stage);
    const finality = input.observation.certificate.finalityEvidence;
    const events = Events.parse(fromBase64(finality.transactionEvents.bcsBase64)).data;
    assert.equal(events.length, stage === 'INITIALIZE_PROTOCOL' ? 2 : 1);
    assert.deepEqual(events.map(e => e.event_type.name), stage === 'INITIALIZE_PROTOCOL'
      ? ['ProtocolTreasuryV8Initialized', 'ProtocolV8EnabledChanged'] : ['SealPolicyCreatedV8']);
    assert.equal(buildMainnetV8OutcomeEvidence(input).kind, 'FINALIZED_SUCCESS');
    assert.deepEqual(await live(input), input.observation.certificate.readback);
  });
  const mutations = [
    ['wrong emitted package', events => { events[0].package_id = otherId; }],
    ['wrong transaction module', events => { events[0].transaction_module = 'wrong'; }],
    ['wrong signer', events => { events[0].sender = otherId; }],
    ['wrong type origin', events => { events[0].event_type.address = otherId; }],
    ['wrong type module', events => { events[0].event_type.module = 'wrong'; }],
    ['unrelated event substituted', events => { events[0].event_type.name = 'Unrelated'; }],
    ['unexpected type argument', events => { events[0].event_type.typeParams = [{ u8: true }]; }],
    ['duplicated event', events => { events.push(structuredClone(events[0])); }],
    ['missing event', events => { events.pop(); }],
    ['null events instead of required receipt', () => null],
    ['payload trailing byte', events => { events[0].contents.push(0); }],
    ['payload truncated', events => { events[0].contents.pop(); }],
  ];
  if (stage === 'INITIALIZE_PROTOCOL') mutations.push(
    ['event order', events => events.reverse()],
    ['treasury config', events => changePayload(events, 0, Treasury, value => { value.config_id = otherId; })],
    ['treasury ID', events => changePayload(events, 0, Treasury, value => { value.treasury_id = otherId; })],
    ['intermediate revision', events => changePayload(events, 0, Treasury, value => { value.revision = '7'; })],
    ['intermediate commitment', events => changePayload(events, 0, Treasury, value => { value.commitment[0] ^= 1; })],
    ['enabled config', events => changePayload(events, 1, Enabled, value => { value.config_id = otherId; })],
    ['final revision', events => changePayload(events, 1, Enabled, value => { value.revision = '7'; })],
    ['false enabled', events => changePayload(events, 1, Enabled, value => { value.enabled = false; })],
    ['final commitment', events => changePayload(events, 1, Enabled, value => { value.commitment[0] ^= 1; })],
  );
  else mutations.push(
    ['Seal config', events => changePayload(events, 0, Seal, value => { value.config_id = otherId; })],
    ['catalog', events => changePayload(events, 0, Seal, value => { value.catalog_id = otherId; })],
    ['threshold', events => changePayload(events, 0, Seal, value => { value.threshold += 1; })],
    ['key-server commitment', events => changePayload(events, 0, Seal, value => { value.key_server_set_commitment[0] ^= 1; })],
    ['policy commitment', events => changePayload(events, 0, Seal, value => { value.commitment[0] ^= 1; })],
  );
  for (const [name, mutate] of mutations) test(`${stage}: rehashed ${name} fails both actual entry points`, async () => {
    const changed = rehashEvents(nativeSoulStageOutcomeFixture(stage), mutate);
    assert.throws(() => buildMainnetV8OutcomeEvidence(changed), outcomeError(changed));
    await assert.rejects(() => live(changed), errorCode);
  });
}

for (const stage of ['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP']) {
  test(`${stage}: actual no-event receipt passes both entries`, async () => {
    const input = nativeSoulStageOutcomeFixture(stage);
    assert.equal(input.observation.certificate.finalityEvidence.transactionEvents, null);
    assert.equal(input.observation.certificate.finalityEvidence.eventsDigest, null);
    assert.equal(buildMainnetV8OutcomeEvidence(input).kind, 'FINALIZED_SUCCESS');
    assert.deepEqual(await live(input), input.observation.certificate.readback);
  });
  for (const [name, mutate] of [
    ['empty vector with a digest', () => {}],
    ['invented event', events => events.push({ package_id: otherId, transaction_module: 'wrong',
      sender: otherId, event_type: { address: otherId, module: 'wrong', name: 'Unexpected', typeParams: [] }, contents: [0] })],
  ]) test(`${stage}: ${name} is not a null receipt`, async () => {
    const changed = rehashEvents(nativeSoulStageOutcomeFixture(stage), mutate);
    assert.throws(() => buildMainnetV8OutcomeEvidence(changed), outcomeError(changed));
    await assert.rejects(() => live(changed), errorCode);
  });
}
