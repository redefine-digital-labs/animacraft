import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMakerV8PackProfiles } from '../maker-v8-profile-wire.js';
import { MAKER_V8_PACK_DEFINITIONS_BCS, packDefinitionCommitmentV8 } from '../maker-v8-pack-definition-wire.js';

import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { fromBase64, fromHex, toBase64, toBase58, normalizeStructTag, deriveDynamicFieldID } from '@mysten/sui/utils';
import { assertMakerV8Runtime } from '../maker-v8-runtime.js';

import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MakerV8ChainError,
  MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
  MAKER_V8_EVENT_DISCOVERY_PAGE_SIZE,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  createMakerV8ChainClient,
  discoverMakerV8Activations,
  listOwnedMakerV8Inventory,
  loadReceivingRefV8,
  loadMakerV8OperationalState,
  loadMakerV8PackAuthoringContext,
  makerV8ChainTypes,
  parseMakerRootV8,
  parseMakerTreasuryV8,
  parseMakerV8ActivatedEvent,
  parsePhysicalAssetV8,
  parseProtocolConfigV8,
  parseSoulBundleV8,
  readFinalizedMakerV8Transaction,
  isMakerV8RuntimeAttested,
  makerV8AttestedCoreArtifact,
  makerV8AttestedPackageTuple,
  readMakerV8NativeSoulBinding,
  isMakerV8NativeSoulBinding,
  attestMakerV8NativeSoulIntegration,
  isMakerV8NativeSoulIntegrationAttested,
  attestMakerV8NativeSoulCompletionRecovery,
  isMakerV8NativeSoulCompletionRecoveryAttested,
  readMakerV8NativePersonalKiosk,
} from '../maker-v8-chain.js';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';
import { CORE_BASE_REGISTRY_MODULE_BASE64 } from './fixtures/maker-v8-runtime-attestation.js';
import { nativeBindingFixture as createNativeBindingFixture, nativeIntegrationFixture as createNativeIntegrationFixture } from './fixtures/maker-v8-native-integration.js';

const sid = (number) => `0x${number.toString(16).padStart(64, '0')}`;
const txDigest = (character = '4') => character.repeat(44);
const objectDigest = (character = '5') => character.repeat(44);
const hash = (byte) => Array(32).fill(byte);
const wallet = sid(900);
const mainnetRpc = (methods = {}) => ({
  async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
  ...methods,
});

const nativeBindingFixture = () => createNativeBindingFixture(runtime());
const nativeIntegrationFixture = () => createNativeIntegrationFixture(runtime());
test('optional native integration validates exact package introduction tables, dependencies and shared configs', async () => {
  const f = nativeIntegrationFixture(); const { runtime: normalized } = await attestMakerV8Runtime(f.rpc, f.config);
  assert.equal(normalized.nativeSoulIntegration.walrusPackageId, sid(82));
  const evidence = await attestMakerV8NativeSoulIntegration(f.rpc, normalized);
  assert.equal(evidence.packageEvidence.objectId, sid(80));
  assert.equal(evidence.packageEvidence.walrusBlobType, `${sid(75)}::blob::Blob`);
  assert.equal(evidence.kioskEvidence.personalKioskCapType, `${sid(74)}::personal_kiosk::PersonalKioskCap`);
  assert.equal(evidence.objects.marketConfig.type, `${sid(73)}::market::MarketConfigV2`);
  assert.equal(isMakerV8NativeSoulIntegrationAttested(evidence, normalized), true);
  assert.equal(isMakerV8NativeSoulIntegrationAttested({ ...evidence }, normalized), false);
  await assert.rejects(attestMakerV8NativeSoulIntegration(f.rpc, f.config), { code: 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED' });
  const changed = structuredClone(f.config);
  changed.roles.output = { typeOriginPackageId: sid(998), callablePackageId: sid(998) };
  const other = createNativeIntegrationFixture(changed);
  const otherRuntime = (await attestMakerV8Runtime(other.rpc, other.config)).runtime;
  assert.equal(isMakerV8NativeSoulIntegrationAttested(evidence, otherRuntime), false);
  await assert.rejects(attestMakerV8NativeSoulIntegration(f.rpc, otherRuntime));
  assert.equal(isMakerV8NativeSoulIntegrationAttested(evidence, { ...f.config, nativeSoulIntegration: { ...f.pin, marketConfigV2Id: sid(999) } }), false);
});

test('native integration refuses missing pins, metadata substitution, package drift and malformed live configs', async t => {
  await assert.rejects(attestMakerV8NativeSoulIntegration(mainnetRpc(), runtime()), { code: 'MAKER_V8_NATIVE_INTEGRATION_REQUIRED' });
  for (const [label, mutate] of Object.entries({
    unknown: f => { f.pin.extra = true; }, missing: f => { delete f.pin.walrusPackageId; },
    digestFormat: f => { f.pin.soulidityCallableDigest = 'not-a-digest'; },
    alias: f => { f.pin.kindRegistryId = f.pin.marketConfigV2Id; },
    genericType: f => { f.pin.expectedNativeBinding.soulOriginalType += '<u8>'; },
  })) await t.test(label, () => { const f = nativeIntegrationFixture(); mutate(f); assert.throws(() => assertMakerV8Runtime(f.config)); });
  for (const [label, mutate] of Object.entries({
    packageDigest: f => { f.objects.get(sid(80)).data.digest = toBase58(Uint8Array.from({ length: 32 }, () => 9)); },
    packageLineage: f => { f.objects.get(sid(80)).data.bcs.originalId = sid(99); },
    missingOrigins: f => { delete f.objects.get(sid(80)).data.bcs.typeOriginTable; },
    wrongIntroduction: f => { f.objects.get(sid(80)).data.bcs.typeOriginTable[0].packageId = sid(80); },
    missingModule: f => { delete f.objects.get(sid(80)).data.bcs.moduleMap.animacraft_v8_binding; },
    duplicateType: f => { f.objects.get(sid(80)).data.bcs.typeOriginTable.push(f.objects.get(sid(80)).data.bcs.typeOriginTable[0]); },
    wrongLink: f => { f.objects.get(sid(80)).data.bcs.linkageTable[0].upgradedId = sid(99); },
    walrusVersion: f => { f.objects.get(sid(80)).data.bcs.linkageTable[1].upgradedVersion = '9'; },
    outputTuple: f => { f.objects.get(sid(80)).data.bcs.linkageTable.find(row => row.originalId === f.config.roles.output.typeOriginPackageId).upgradedId = sid(999); },
    runtimeVersion: f => { f.objects.get(sid(80)).data.bcs.linkageTable.find(row => row.originalId === f.config.roles.runtime.typeOriginPackageId).upgradedVersion = '9'; },
    configOwner: f => { f.objects.get(sid(90)).data.owner = { Immutable: true }; },
    wrongConfigType: f => { f.objects.get(sid(90)).data.type = `${sid(71)}::market::MarketConfigV2`; },
    configJson: f => { f.objects.get(sid(90)).data.content.fields.primary_enabled = false; },
    configTrailing: f => { const b = f.objects.get(sid(90)).data.bcs; b.bcsBytes = toBase64(Uint8Array.from([...fromBase64(b.bcsBytes), 0])); },
  })) await t.test(label, async () => { const f = nativeIntegrationFixture(); const { runtime: attested } = await attestMakerV8Runtime(f.rpc, f.config); mutate(f); await assert.rejects(attestMakerV8NativeSoulIntegration(f.rpc, attested)); });
});

test('completed Soul recovery checks immutable authority without depending on fresh issuance or Kiosk/Walrus availability', async () => {
  const f = nativeIntegrationFixture();
  const { runtime: attested } = await attestMakerV8Runtime(f.rpc, f.config);
  const config = f.objects.get(sid(90)).data;
  config.content.fields.primary_enabled = false;
  config.bcs.bcsBytes = toBase64(bcs.struct('MarketConfigV2', {
    id: bcs.Address, version: bcs.u64(), legacy_config_id: bcs.Address, fee_recipient: bcs.Address,
    platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool(),
  }).serialize(config.content.fields).toBytes());
  await assert.rejects(attestMakerV8NativeSoulIntegration(f.rpc, attested), { code: 'MAKER_V8_RUNTIME_AUTHORITY_MISMATCH' });
  const getObject = f.rpc.getObject;
  f.rpc.getObject = input => {
    assert.ok(![81, 82, 90, 91, 92, 93].map(sid).includes(input.id), 'Recovery must not read issuance-only dependencies');
    return getObject(input);
  };
  const recovery = await attestMakerV8NativeSoulCompletionRecovery(f.rpc, attested);
  assert.equal(isMakerV8NativeSoulCompletionRecoveryAttested(recovery, attested), true);
  assert.equal(isMakerV8NativeSoulCompletionRecoveryAttested({ ...recovery }, attested), false);
  assert.equal(isMakerV8NativeSoulIntegrationAttested(recovery, attested), false);
  assert.equal(isMakerV8NativeSoulCompletionRecoveryAttested(recovery, f.config), false);
  assert.equal(Object.hasOwn(recovery, 'objects'), false);
  await assert.rejects(readMakerV8NativePersonalKiosk(f.rpc, attested, recovery, wallet));
});

test('completed Soul recovery still refuses callable/type/binding/dependency drift and cross-runtime evidence', async t => {
  for (const [label, mutate] of Object.entries({
    digest: f => { f.objects.get(sid(80)).data.digest = toBase58(new Uint8Array(32).fill(9)); },
    typeOrigin: f => { f.objects.get(sid(80)).data.bcs.typeOriginTable[0].packageId = sid(80); },
    binding: f => { f.field.fieldId = sid(999); },
    outputLink: f => { f.objects.get(sid(80)).data.bcs.linkageTable.find(row => row.originalId === f.config.roles.output.typeOriginPackageId).upgradedVersion = '9'; },
  })) await t.test(label, async () => {
    const f = nativeIntegrationFixture(); const { runtime: attested } = await attestMakerV8Runtime(f.rpc, f.config);
    mutate(f); await assert.rejects(attestMakerV8NativeSoulCompletionRecovery(f.rpc, attested));
  });
  const f = nativeIntegrationFixture(); const attested = (await attestMakerV8Runtime(f.rpc, f.config)).runtime;
  const proof = await attestMakerV8NativeSoulCompletionRecovery(f.rpc, attested);
  const config = structuredClone(f.config); config.roles.output = { typeOriginPackageId: sid(998), callablePackageId: sid(998) };
  const other = createNativeIntegrationFixture(config);
  const otherRuntime = (await attestMakerV8Runtime(other.rpc, other.config)).runtime;
  assert.equal(isMakerV8NativeSoulCompletionRecoveryAttested(proof, otherRuntime), false);
  const mint = await attestMakerV8NativeSoulIntegration(f.rpc, attested);
  assert.equal(isMakerV8NativeSoulCompletionRecoveryAttested(mint, attested), false);
});

async function personalKioskFixture() {
  const f = nativeIntegrationFixture();
  const attested = (await attestMakerV8Runtime(f.rpc, f.config)).runtime;
  const integration = await attestMakerV8NativeSoulIntegration(f.rpc, attested);
  const keyType = `${sid(73)}::market::PersonalKioskOwnerKey`;
  const valueType = `${sid(73)}::market::PersonalKioskRegistration`;
  const name = { type: keyType, bcsBase64: toBase64(bcs.Address.serialize(wallet).toBytes()) };
  const schema = bcs.struct('PersonalKioskRegistration', { version: bcs.u64(), kiosk_id: bcs.Address, kiosk_cap_id: bcs.Address });
  const registration = { version: '1', kiosk_id: sid(700), kiosk_cap_id: sid(701) };
  const field = { kind: 'DynamicField', childId: null,
    fieldId: deriveDynamicFieldID(sid(92), keyType, fromBase64(name.bcsBase64)), name,
    value: { type: valueType, bcsBase64: toBase64(schema.serialize(registration).toBytes()) },
    type: normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`) };
  const shapes = [
    { id: bcs.Address, profits: bcs.struct('Balance', { value: bcs.u64() }), owner: bcs.Address, item_count: bcs.u32(), allow_extensions: bcs.bool() },
    { id: bcs.Address, cap: bcs.option(bcs.struct('KioskOwnerCap', { id: bcs.Address, for: bcs.Address })) },
  ];
  const values = [
    { id: sid(700), profits: { value: '0' }, owner: wallet, item_count: 1, allow_extensions: false },
    { id: sid(701), cap: { id: sid(702), for: sid(700) } },
  ];
  const types = [normalizeStructTag('0x2::kiosk::Kiosk'), integration.kioskEvidence.personalKioskCapType];
  const encode = index => {
    const data = f.objects.get(values[index].id).data;
    data.content.fields = structuredClone(values[index]);
    data.bcs.bcsBytes = toBase64(bcs.struct('PersonalKioskFixture', shapes[index]).serialize(values[index]).toBytes());
  };
  values.forEach((value, index) => {
    f.objects.set(value.id, { data: { objectId: value.id, version: '3', digest: f.pin.soulidityCallableDigest,
      owner: index === 0 ? { Shared: { initial_shared_version: '1' } } : { AddressOwner: wallet }, type: types[index],
      content: { dataType: 'moveObject', type: types[index] }, bcs: { dataType: 'moveObject', type: types[index] } } });
    encode(index);
  });
  const calls = [];
  f.rpc.getDynamicField = async input => { calls.push(input); return field; };
  return { ...f, attested, integration, keyType, valueType, schema, registration, field, values, encode, calls };
}

test('native personal Kiosk reader uses exact introduced registry key and verifies real cap custody', async () => {
  const f = await personalKioskFixture();
  const result = await readMakerV8NativePersonalKiosk(f.rpc, f.attested, f.integration, wallet);
  assert.deepEqual(result, { currentKioskId: sid(700), currentKioskCapOnChainId: sid(701) });
  assert.deepEqual(f.calls, [{ parentId: sid(92), name: f.field.name }]);
  assert.ok(Object.isFrozen(result));
  await assert.rejects(readMakerV8NativePersonalKiosk(f.rpc, f.attested, { ...f.integration }, wallet));
  await assert.rejects(readMakerV8NativePersonalKiosk(f.rpc, f.config, f.integration, wallet));
});

test('native personal Kiosk treats only exact official notFound as a new wallet', async () => {
  const f = await personalKioskFixture();
  const missing = objectId => new ObjectError('NOT_FOUND', 'absent', { reason: 'notFound', objectId });
  f.rpc.getDynamicField = async () => { throw missing(f.field.fieldId); };
  assert.deepEqual(await readMakerV8NativePersonalKiosk(f.rpc, f.attested, f.integration, wallet), {
    currentKioskId: null, currentKioskCapOnChainId: null,
  });
  for (const error of [missing(sid(999)), new Error('not found'), { reason: 'notFound', objectId: f.field.fieldId }]) {
    f.rpc.getDynamicField = async () => { throw error; };
    await assert.rejects(readMakerV8NativePersonalKiosk(f.rpc, f.attested, f.integration, wallet), value => value === error);
  }
});

test('native personal Kiosk rejects field substitution, stale registration and noncanonical custody', async t => {
  for (const [label, mutate] of Object.entries({
    wrongField: f => { f.field.fieldId = sid(999); },
    wrongKey: f => { f.field.name.type = `${sid(71)}::market::PersonalKioskOwnerKey`; },
    wrongSigner: f => { f.field.name.bcsBase64 = toBase64(bcs.Address.serialize(sid(999)).toBytes()); },
    wrongValue: f => { f.field.value.type = `${sid(71)}::market::PersonalKioskRegistration`; },
    wrongFieldType: f => { f.field.type = '0x2::dynamic_field::Field<u8,u8>'; },
    child: f => { f.field.childId = sid(700); },
    trailingBCS: f => { f.field.value.bcsBase64 = toBase64(new Uint8Array([...fromBase64(f.field.value.bcsBase64), 0])); },
    wrongVersion: f => { f.field.value.bcsBase64 = toBase64(f.schema.serialize({ ...f.registration, version: '2' }).toBytes()); },
    wrongKioskOwner: f => { f.objects.get(sid(700)).data.owner = { AddressOwner: wallet }; },
    wrongStoredOwner: f => { f.values[0].owner = sid(999); f.encode(0); },
    wrongCapOwner: f => { f.objects.get(sid(701)).data.owner = { AddressOwner: sid(999) }; },
    wrongCapTarget: f => { f.values[1].cap.for = sid(999); f.encode(1); },
    emptyCap: f => { f.values[1].cap = null; f.encode(1); },
    wrongCapType: f => { f.objects.get(sid(701)).data.type = `${sid(81)}::personal_kiosk::PersonalKioskCap`; },
    jsonDrift: f => { f.objects.get(sid(700)).data.content.fields.item_count = 2; },
    objectId: f => { f.objects.get(sid(700)).data.objectId = sid(999); },
  })) await t.test(label, async () => {
    const f = await personalKioskFixture(); mutate(f);
    await assert.rejects(readMakerV8NativePersonalKiosk(f.rpc, f.attested, f.integration, wallet));
  });
});

test('native Soul reader proves exact protocol slot and permits witnesses introduced after native Soul', async () => {
  const fixture = nativeBindingFixture(); const calls = [];
  const rpc = mainnetRpc({ async getDynamicField(input) { calls.push(input); return fixture.field; } });
  const evidence = await readMakerV8NativeSoulBinding(rpc, fixture.config);
  assert.deepEqual(calls, [{ parentId: fixture.config.protocolConfigId, name: { type: fixture.keyType, bcsBase64: 'AA==' } }]);
  assert.deepEqual([...fromBase64(fixture.field.name.bcsBase64)], [0]);
  assert.notEqual(evidence.fieldId, deriveDynamicFieldID(fixture.config.protocolConfigId, fixture.keyType, new Uint8Array()));
  assert.equal(evidence.soulOriginalType, `${sid(71)}::soul::Soul`);
  assert.equal(evidence.soulDefiningType, `${sid(71)}::soul::Soul`);
  assert.equal(evidence.mintWitnessDefiningType, `${sid(72)}::animacraft_v8_binding::MintBindingWitnessV8`);
  assert.equal(evidence.ownerWitnessOriginalType, `${sid(71)}::animacraft_v8_binding::SoulOwnerWitnessV8`);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(isMakerV8NativeSoulBinding(evidence, fixture.config), true);
  assert.equal(isMakerV8NativeSoulBinding({ ...evidence }, fixture.config), false);
  assert.equal(isMakerV8NativeSoulBinding(evidence, { ...fixture.config, protocolConfigId: sid(999) }), false);
});

test('native Soul binding rejects altered dynamic fields, noncanonical BCS and unrelated type lineage', async t => {
  const mutations = {
    protocol: f => { f.fields.config_id = sid(999); },
    fieldId: f => { f.field.fieldId = sid(999); },
    keyType: f => { f.field.name.type = `${sid(99)}::protocol_config_v8::SoulidityBindingSlotKeyV8`; },
    emptyKeyBytes: f => { f.field.name.bcsBase64 = ''; },
    trueKeyBytes: f => { f.field.name.bcsBase64 = 'AQ=='; },
    emptyDerivedId: f => { f.field.fieldId = deriveDynamicFieldID(f.config.protocolConfigId, f.keyType, new Uint8Array()); },
    trueDerivedId: f => { f.field.fieldId = deriveDynamicFieldID(f.config.protocolConfigId, f.keyType, new Uint8Array([1])); },
    valueType: f => { f.field.value.type = `${sid(99)}::protocol_config_v8::SoulidityBindingV8`; },
    fieldType: f => { f.field.type = '0x2::dynamic_field::Field<u8,u8>'; },
    child: f => { f.field.childId = sid(9); },
    missingChild: f => { delete f.field.childId; },
    lineage: f => { f.fields.soul_original.name = `${sid(99).slice(2)}::soul::Soul`; },
    proofIntroduction: f => { f.fields.owner_defining.name = `${sid(99).slice(2)}::animacraft_v8_binding::SoulOwnerWitnessV8`; },
    generic: f => { f.fields.soul_defining.name += '<u8>'; },
    prefixedStoredType: f => { f.fields.soul_original.name = `0x${f.fields.soul_original.name}`; },
    wrongProof: f => { f.fields.mint_original.name = f.fields.owner_original.name; },
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async () => {
    const fixture = nativeBindingFixture(); mutate(fixture);
    fixture.field.value.bcsBase64 = toBase64(fixture.schema.serialize(fixture.fields).toBytes());
    await assert.rejects(readMakerV8NativeSoulBinding(mainnetRpc({ async getDynamicField() { return fixture.field; } }), fixture.config), { code: 'MAKER_V8_RUNTIME_AUTHORITY_MISMATCH' });
  });
  const fixture = nativeBindingFixture(); fixture.field.value.bcsBase64 = toBase64(Uint8Array.from([...fromBase64(fixture.field.value.bcsBase64), 0]));
  await assert.rejects(readMakerV8NativeSoulBinding(mainnetRpc({ async getDynamicField() { return fixture.field; } }), fixture.config), { code: 'MAKER_V8_RUNTIME_AUTHORITY_BCS_INVALID' });
});

test('native Soul binding has no missing-slot or wrong-network success fallback', async () => {
  const fixture = nativeBindingFixture(); let reads = 0;
  await assert.rejects(readMakerV8NativeSoulBinding(mainnetRpc({ async getDynamicField() { throw new Error('not found'); } }), fixture.config), { code: 'MAKER_V8_NATIVE_SOUL_BINDING_READ_FAILED' });
  await assert.rejects(readMakerV8NativeSoulBinding({ async getChainIdentifier() { return 'testnet'; }, async getDynamicField() { reads++; } }, fixture.config), { code: 'MAKER_V8_RPC_CHAIN_ID_MISMATCH' });
  assert.equal(reads, 0);
});

test('compiled native empty-key layout preserves its false byte inside the full Field BCS', () => {
  const f = nativeBindingFixture();
  // Independent layout: UID address, the compiler-inserted false byte, then value.
  const raw = new Uint8Array([...bcs.Address.serialize(f.field.fieldId).toBytes(), 0, ...f.schema.serialize(f.fields).toBytes()]);
  const parsed = f.fieldSchema.parse(raw);
  assert.equal(parsed.name.dummy_field, false);
  assert.deepEqual(parsed.value, f.fields);
  assert.deepEqual([...f.fieldSchema.serialize(parsed).toBytes()], [...raw]);
  const emptyKeySchema = bcs.struct('WrongField', { id: bcs.Address, name: bcs.struct('WrongEmptyKey', {}), value: f.schema });
  const emptyRaw = emptyKeySchema.serialize({ id: f.field.fieldId, name: {}, value: f.fields }).toBytes();
  assert.notDeepEqual([...emptyRaw], [...raw]);
  // The generic SDK parser can consume shifted fields; exact value binding and
  // canonical roundtrip, rather than parse success alone, reject that encoding.
  const shifted = f.fieldSchema.parse(emptyRaw);
  assert.notEqual(shifted.value.config_id, f.config.protocolConfigId);
  assert.notEqual(toBase64(f.fieldSchema.serialize(shifted).toBytes()), toBase64(emptyRaw));
});

test('bootstrap authority uses compiled false-key bytes and rejects empty or true keys and derived IDs', async () => {
  const f = currentRuntimeAuthorityFixture(); const original = f.rpc.getDynamicField;
  let observed;
  f.rpc.getDynamicField = async input => { observed = input; return original(input); };
  await attestMakerV8Runtime(f.rpc, f.config);
  assert.equal(observed.name.bcsBase64, 'AA==');
  assert.equal(f.field.fieldId, deriveDynamicFieldID(f.config.catalogId, observed.name.type, new Uint8Array([0])));
  for (const [bytes, wrongId] of [[new Uint8Array(), false], [new Uint8Array([1]), false],
    [new Uint8Array(), true], [new Uint8Array([1]), true]]) {
    const fresh = currentRuntimeAuthorityFixture();
    if (wrongId) fresh.field.fieldId = deriveDynamicFieldID(fresh.config.catalogId, fresh.field.name.type, bytes);
    else fresh.field.name.bcsBase64 = toBase64(bytes);
    fresh.rpc.getDynamicField = async () => fresh.field;
    await assert.rejects(attestMakerV8Runtime(fresh.rpc, fresh.config), { code: 'MAKER_V8_RUNTIME_AUTHORITY_MISMATCH' });
  }
});

function runtime() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: sid(index * 2 + 1),
        callablePackageId: sid(index * 2 + 1),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: sid(20),
    protocolConfigId: sid(21),
    protocolTreasuryId: sid(22),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: sid(23), runtime: sid(24), output: sid(25), physical: sid(26),
      market: sid(27), release: sid(28),
    },
    makerBindings: [],
  };
}

function binding() {
  return {
    rootId: sid(100),
    baseRegistryId: sid(101),
    makerTreasuryId: sid(102),
    sealRegistryId: sid(103),
    runtimeDefinitionRegistryId: sid(104),
    packRegistryId: sid(105),
    packAdmissionAuthorityId: sid(106),
    outputRegistryId: sid(107),
    soulRegistryId: sid(108),
    physicalRegistryId: sid(109),
    marketRegistryId: sid(110),
    marketTreasuryId: sid(111),
  };
}

function activationEvent(overrides = {}) {
  const rt = runtime();
  const b = binding();
  return {
    id: { txDigest: txDigest(), eventSeq: '0' },
    type: makerV8ChainTypes(rt).activationEvent,
    parsedJson: {
      root_id: b.rootId,
      version: '8',
      owner: wallet,
      control_epoch: '0',
      admin_cap_id: sid(112),
      maker_key: 'fresh-maker',
      maker_version: '1',
      version_commitment: hash(1),
      content_commitment: hash(2),
      renderer_commitment: hash(3),
      protocol_config_id: rt.protocolConfigId,
      protocol_config_revision: '7',
      protocol_config_commitment: hash(4),
      protocol_treasury_id: rt.protocolTreasuryId,
      maker_treasury_id: b.makerTreasuryId,
      catalog_id: rt.catalogId,
      product_binding_commitment: hash(5),
      call_cap_set_commitment: hash(6),
      base_registry_id: b.baseRegistryId,
      registry_ids: companionFields(b),
      replacement_id: sid(120),
      bootstrap_certificate_id: sid(121),
      ...overrides,
    },
  };
}

function moveObject(type, objectId, fields, owner = { AddressOwner: wallet }, version = '9') {
  return {
    data: {
      objectId,
      version,
      digest: objectDigest(String((Number(version) % 5) + 4)),
      type,
      owner,
      content: { dataType: 'moveObject', type, fields: { id: { id: objectId }, ...fields } },
    },
  };
}

function companionFields(b) {
  return {
    seal_registry_id: b.sealRegistryId,
    runtime_definition_registry_id: b.runtimeDefinitionRegistryId,
    pack_registry_id: b.packRegistryId,
    admission_authority_id: b.packAdmissionAuthorityId,
    output_registry_id: b.outputRegistryId,
    soul_registry_id: b.soulRegistryId,
    physical_registry_id: b.physicalRegistryId,
    market_registry_id: b.marketRegistryId,
  };
}

function rootResponse(overrides = {}) {
  const rt = runtime();
  const b = binding();
  return moveObject(
    makerV8ChainTypes(rt).root,
    b.rootId,
    {
      version: '8',
      core_original_package_id: rt.roles.core.typeOriginPackageId,
      core_callable_package_id: rt.roles.core.callablePackageId,
      creator: wallet,
      owner: wallet,
      admin_cap_id: sid(112),
      control_epoch: '0',
      lifecycle: '1',
      maker_key: 'fresh-maker',
      maker_version: '1',
      version_commitment: hash(1),
      previous_root_id: null,
      previous_version_commitment: null,
      successor_authority_id: null,
      successor_root_id: null,
      maker_document_commitment: hash(10),
      creator_defaults_commitment: hash(11),
      living_content_binding_commitment: hash(12),
      content: {
        renderer_commitment: hash(3),
        manifest_blob_id: 'manifest-blob',
        manifest_sha256: hash(13),
        content_commitment: hash(2),
      },
      base_registry_id: b.baseRegistryId,
      maker_treasury_id: b.makerTreasuryId,
      expected_base_definition_count: '4',
      expected_base_registry_commitment: hash(14),
      expected_pack_admission_policy_commitment: hash(15),
      economics: {
        protocol_config_id: rt.protocolConfigId,
        protocol_config_revision: '7',
        protocol_config_commitment: hash(4),
        protocol_treasury_id: rt.protocolTreasuryId,
        commitment: hash(16),
      },
      rights: { commitment: hash(17) },
      publication: {
        catalog_id: rt.catalogId,
        sealed_base_registry_commitment: '12'.repeat(32),
        release_commitments: { product_binding_commitment: hash(5), call_cap_set_commitment: hash(6) },
        registry_ids: companionFields(b),
      },
      created_at_ms: '1',
      ...overrides,
    },
    { Shared: { initial_shared_version: '1' } },
  );
}

function parsedRoot() {
  return parseMakerRootV8(rootResponse(), runtime(), activationEvent());
}

function catalogAndConfigResponses(rt) {
  const current = currentRuntimeAuthorityFixture();
  assert.deepEqual(current.config, rt);
  const catalog = current.objects.get(rt.catalogId);
  const configs = Object.fromEntries(Object.entries(rt.roleConfigIds)
    .map(([role, objectId]) => [role, current.objects.get(objectId)]));
  const packages = Object.fromEntries(Object.keys(rt.roles).map((role, index) => [role, {
    data: {
      objectId: rt.roles[role].callablePackageId,
      version: '1',
      digest: String(index + 2).repeat(44),
      owner: { Immutable: true },
      bcs: {
        dataType: 'package', id: rt.roles[role].callablePackageId, version: '1',
        moduleMap: role === 'core' ? { base_registry_v8: CORE_BASE_REGISTRY_MODULE_BASE64 } : {},
      },
    },
  }]));
  return { catalog, configs, packages, current };
}

function attestationRpc(evidence, rt) {
  return mainnetRpc({
    getDynamicField: evidence.current.rpc.getDynamicField,
    async getObject({ id: objectId }) {
      const role = Object.keys(rt.roles).find((r) => rt.roles[r].callablePackageId === objectId);
      return role ? evidence.packages[role] : evidence.current.objects.get(objectId);
    },
  });
}

test('Mainnet current Catalog, six consumed setup installations and certified replacement attest the only signing runtime', async () => {
  const rt = runtime();
  const evidence = catalogAndConfigResponses(rt);
  const rpc = attestationRpc(evidence, rt);
  const attested = await attestMakerV8Runtime(rpc, rt);
  assert.equal(attested.catalog.productBindingCommitment, Buffer.from(evidence.catalog.data.content.fields.binding.commitment).toString('hex'));
  assert.deepEqual(Object.keys(attested.configs), ['seal', 'runtime', 'output', 'physical', 'market', 'release']);
  assert.equal(isMakerV8RuntimeAttested(attested.runtime), true);
  assert.equal(isMakerV8RuntimeAttested(rt), false, 'caller config is not the normalized attested capability');
  assert.deepEqual(makerV8AttestedPackageTuple(attested.runtime), attested.packageTuple);
  assert.deepEqual(attested.packageTuple.map(({ role, packageDigest }) => ({ role, packageDigest })), [
    { role: 'core', packageDigest: '2'.repeat(44) },
    { role: 'seal', packageDigest: '3'.repeat(44) },
    { role: 'runtime', packageDigest: '4'.repeat(44) },
    { role: 'output', packageDigest: '5'.repeat(44) },
    { role: 'physical', packageDigest: '6'.repeat(44) },
    { role: 'market', packageDigest: '7'.repeat(44) },
    { role: 'release', packageDigest: '8'.repeat(44) },
  ]);
  assert.deepEqual(Object.keys(attested.packageTuple[0]), [
    'role', 'originalPackageId', 'callablePackageId', 'packageDigest',
  ]);
  assert.deepEqual(makerV8AttestedCoreArtifact(attested.runtime), attested.coreArtifact);
  assert.deepEqual(Object.keys(attested.coreArtifact), [
    'callablePackageId', 'packageDigest', 'baseRegistryModuleSha256',
  ]);
  assert.equal(attested.coreArtifact.baseRegistryModuleSha256, MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256);
  assert.throws(
    () => makerV8AttestedPackageTuple(rt),
    (error) => error.code === 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED',
  );

  const grpcProjected = catalogAndConfigResponses(rt);
  const projectBytes = (value) => {
    if (Array.isArray(value) && value.length === 32) return toBase64(Uint8Array.from(value));
    if (!value || typeof value !== 'object') return value;
    Object.keys(value).forEach((key) => { value[key] = projectBytes(value[key]); });
    return value;
  };
  projectBytes(grpcProjected.catalog.data.content.fields);
  Object.values(grpcProjected.configs).forEach((response) => projectBytes(response.data.content.fields));
  const grpcAttested = await attestMakerV8Runtime(attestationRpc(grpcProjected, rt), rt);
  assert.equal(grpcAttested.catalog.productBindingCommitment, Buffer.from(evidence.catalog.data.content.fields.binding.commitment).toString('hex'));

  const publishedCore = catalogAndConfigResponses(rt);
  const publishedCoreBytes = Uint8Array.from(fromBase64(CORE_BASE_REGISTRY_MODULE_BASE64));
  // Current metered module's self-address slot, decoded from its Move address
  // table. This models publication substitution; it is not a live receipt.
  assert.deepEqual(publishedCoreBytes.slice(10408, 10440), new Uint8Array(32));
  publishedCoreBytes.set(fromHex(rt.roles.core.callablePackageId), 10408);
  publishedCore.packages.core.data.bcs.moduleMap.base_registry_v8 = toBase64(publishedCoreBytes);
  const publishedAttested = await attestMakerV8Runtime(attestationRpc(publishedCore, rt), rt);
  assert.equal(
    publishedAttested.coreArtifact.baseRegistryModuleSha256,
    MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
  );
  assert.throws(
    () => makerV8AttestedCoreArtifact(rt),
    (error) => error.code === 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED',
  );

  const stale = catalogAndConfigResponses(rt);
  stale.configs.market.data.content.fields.runtime_caller_cap.caller_callable_package_id = sid(999);
  stale.current.sync(rt.roleConfigIds.market);
  await assert.rejects(() => attestMakerV8Runtime(attestationRpc(stale, rt), rt), (error) => error.code === 'MAKER_V8_RUNTIME_AUTHORITY_MISMATCH');

  const wrongTypeOrigin = catalogAndConfigResponses(rt);
  wrongTypeOrigin.configs.market.data.type = `${sid(999)}::market_v8::MarketPackageConfigV8`;
  await assert.rejects(() => attestMakerV8Runtime(attestationRpc(wrongTypeOrigin, rt), rt),
    { code: 'UNSUPPORTED_LEGACY_PRODUCT' });

  for (const [name, expectedCode, mutate] of [
    ['digest', 'MAKER_V8_CHAIN_DIGEST_INVALID', (response) => { response.data.digest = 'caller-hash'; }],
    ['owner', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', (response) => { response.data.owner = { AddressOwner: wallet }; }],
    ['object id', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', (response) => { response.data.objectId = sid(998); }],
    ['BCS data type', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', (response) => { response.data.bcs.dataType = 'moveObject'; }],
  ]) {
    const corrupt = catalogAndConfigResponses(rt);
    mutate(corrupt.packages.market);
    await assert.rejects(() => attestMakerV8Runtime(attestationRpc(corrupt, rt), rt), (error) => error.code === expectedCode, name);
  }

  for (const [name, mutate] of [
    ['missing Core module', (response) => { delete response.data.bcs.moduleMap.base_registry_v8; }],
    ['wrong Core module', (response) => { response.data.bcs.moduleMap.base_registry_v8 = Buffer.from('drift').toString('base64'); }],
    ['non-canonical Core module', (response) => { response.data.bcs.moduleMap.base_registry_v8 = `${response.data.bcs.moduleMap.base_registry_v8}=\n`; }],
    ['malformed Core package digest', (response) => { response.data.digest = 'not-a-sui-digest'; }],
  ]) {
    const corrupt = catalogAndConfigResponses(rt);
    mutate(corrupt.packages.core);
    await assert.rejects(() => attestMakerV8Runtime(attestationRpc(corrupt, rt), rt), (error) => error.code === 'MAKER_V8_CORE_ARTIFACT_UNMEASURED', name);
  }
});

test('stable chain types use TypeOrigin identities and exact native payment generic', () => {
  const rt = runtime();
  const types = makerV8ChainTypes(rt);
  assert.equal(types.activationEvent, `${rt.roles.release.typeOriginPackageId}::release_v8::MakerV8Activated`);
  assert.equal(types.root, `${rt.roles.core.typeOriginPackageId}::maker_v8::MakerRootV8<${MAKER_V8_PAYMENT_COIN_TYPE}>`);
  assert.equal(Object.isFrozen(types), true);
});

test('MakerV8Activated parses the complete seven-role tuple and rejects old discovery', () => {
  const activation = parseMakerV8ActivatedEvent(activationEvent(), runtime());
  const { marketTreasuryId: _, ...eventBinding } = binding();
  assert.deepEqual(activation.binding, eventBinding);
  assert.equal(activation.owner, wallet);
  assert.equal(activation.productBindingCommitment, '05'.repeat(32));

  const legacy = activationEvent();
  legacy.type = `${sid(1)}::maker_v7::OCMakerPublished`;
  assert.throws(
    () => parseMakerV8ActivatedEvent(legacy, runtime()),
    (error) => error instanceof MakerV8ChainError && error.code === 'UNSUPPORTED_LEGACY_PRODUCT',
  );
});

test('activation rejects missing fields, object collisions, and runtime identity drift', () => {
  const missing = activationEvent();
  delete missing.parsedJson.registry_ids;
  assert.throws(() => parseMakerV8ActivatedEvent(missing, runtime()), /required/);
  assert.throws(
    () => parseMakerV8ActivatedEvent(activationEvent({ registry_ids: { ...companionFields(binding()), pack_registry_id: binding().marketRegistryId } }), runtime()),
    (error) => error.code === 'MAKER_V8_BINDING_ID_COLLISION',
  );
  assert.throws(
    () => parseMakerV8ActivatedEvent(activationEvent({ catalog_id: sid(777) }), runtime()),
    (error) => error.code === 'MAKER_V8_ACTIVATION_RUNTIME_MISMATCH',
  );
});

test('Root readback verifies lifecycle, immutable snapshot, and every companion binding', () => {
  const root = parsedRoot();
  assert.equal(root.lifecycle, 'ACTIVE');
  assert.equal(root.owner.kind, 'shared');
  assert.equal(root.creatorAddress, wallet);
  assert.equal(root.productBindingCommitment, '05'.repeat(32));
  assert.equal(root.callCapSetCommitment, '06'.repeat(32));
  const corrupted = rootResponse();
  corrupted.data.content.fields.publication.registry_ids.market_registry_id = sid(999);
  assert.throws(
    () => parseMakerRootV8(corrupted, runtime(), activationEvent()),
    (error) => error.code === 'MAKER_V8_COMPANION_BINDING_MISMATCH',
  );

  const transferred = parseMakerRootV8(rootResponse({
    owner: sid(901),
    admin_cap_id: sid(902),
    control_epoch: '1',
  }), runtime(), activationEvent());
  assert.equal(transferred.ownerAddress, sid(901));
  assert.equal(transferred.adminCapId, sid(902));
  assert.equal(transferred.controlEpoch, 1n);
  assert.equal(transferred.contentCommitment, root.contentCommitment);
});

test('ProtocolConfig and MakerTreasury readback provide live eligibility facts', async () => {
  const rt = runtime();
  const root = parsedRoot();
  const protocolResponse = moveObject(
    makerV8ChainTypes(rt).protocolConfig,
    rt.protocolConfigId,
    {
      version: '8',
      core_original_package_id: rt.roles.core.typeOriginPackageId,
      core_callable_package_id: rt.roles.core.callablePackageId,
      revision: '7',
      treasury_id: rt.protocolTreasuryId,
      payment_coin_type: rt.paymentCoinType,
      enabled: true,
      commitment: hash(4),
    },
    { Shared: { initial_shared_version: '1' } },
  );
  const treasuryResponse = moveObject(
    makerV8ChainTypes(rt).makerTreasury,
    root.binding.makerTreasuryId,
    {
      version: '8',
      root_id: root.objectId,
      maker_version: '1',
      root_content_commitment: hash(2),
      revenue: { fields: { value: '0' } },
      total_collected: '50',
      total_withdrawn: '50',
    },
    { Shared: { initial_shared_version: '1' } },
  );
  const protocol = parseProtocolConfigV8(protocolResponse, rt, root);
  const wrappedRoot = structuredClone(root);
  wrappedRoot.fields.economics = { fields: wrappedRoot.fields.economics };
  assert.equal(parseProtocolConfigV8(protocolResponse, rt, wrappedRoot).objectId, rt.protocolConfigId);
  const treasury = parseMakerTreasuryV8(treasuryResponse, rt, root);
  assert.equal(protocol.enabled, true);
  assert.equal(protocol.revision, 7n);
  assert.equal(protocol.commitment, `0x${'04'.repeat(32)}`);
  assert.equal(treasury.balanceAtomic, 0n);
  assert.equal(treasury.totalCollectedAtomic, 50n);

  const loaded = await loadMakerV8OperationalState(mainnetRpc({
    async getObject({ id: objectId }) {
      return objectId === rt.protocolConfigId ? protocolResponse : treasuryResponse;
    },
  }), rt, root);
  assert.equal(loaded.protocolConfig.commitment, protocol.commitment);
  assert.equal(loaded.makerTreasury.balanceAtomic, 0n);

  const wrong = moveObject(makerV8ChainTypes(rt).protocolConfig, rt.protocolConfigId, {
    version: '8', core_original_package_id: rt.roles.core.typeOriginPackageId,
    core_callable_package_id: rt.roles.core.callablePackageId, revision: '7',
    treasury_id: rt.protocolTreasuryId, payment_coin_type: `${sid(999)}::coin::BAD`,
    enabled: true, commitment: hash(4),
  });
  assert.throws(() => parseProtocolConfigV8(wrong, rt, root), (error) => error.code === 'MAKER_V8_PROTOCOL_CONFIG_MISMATCH');
});

function soulResponses() {
  const rt = runtime();
  const root = parsedRoot();
  const outputId = sid(200);
  const receiptId = sid(201);
  const soulId = sid(202);
  const common = {
    root_id: root.objectId,
    maker_version: '1',
    root_content_commitment: hash(2),
    output_key: 'default-png',
    holder: wallet,
  };
  return {
    output: moveObject(makerV8ChainTypes(rt).completeOutput, outputId, {
      ...common,
      version: '8', output_registry_id: root.binding.outputRegistryId,
    }),
    receipt: moveObject(makerV8ChainTypes(rt).completeReceipt, receiptId, {
      ...common,
      version: '8', output_id: outputId,
    }),
    soul: moveObject(makerV8ChainTypes(rt).canonicalSoul, soulId, {
      ...common,
      version: '8', soul_registry_id: root.binding.soulRegistryId,
      ownership_epoch: '3', output_id: outputId, receipt_id: receiptId,
    }),
  };
}

test('Soul inventory joins the exact live Output/Receipt/Soul triple', () => {
  const root = parsedRoot();
  const bundle = parseSoulBundleV8(soulResponses(), runtime(), wallet, root);
  assert.equal(bundle.ownershipEpoch, 3n);
  assert.equal(bundle.output.objectRef.objectId, sid(200));
  const wrong = soulResponses();
  wrong.soul.data.content.fields.receipt_id = sid(555);
  assert.throws(
    () => parseSoulBundleV8(wrong, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_SOUL_BUNDLE_MISMATCH',
  );
});

function physicalResponse(sourceKind = 0) {
  const rt = runtime();
  const root = parsedRoot();
  return moveObject(makerV8ChainTypes(rt).physicalAsset, sid(300 + sourceKind), {
    version: '8', registry_id: root.binding.physicalRegistryId,
    root_id: root.objectId, maker_version: '1', root_content_commitment: hash(2),
    source: { fields: {
      source_kind: String(sourceKind), source_id: sourceKind ? sid(400) : root.binding.baseRegistryId,
      source_semantic_id: sourceKind ? 'pack-alpha' : '', source_content_commitment: hash(20),
      source_treasury_id: sourceKind ? sid(401) : null, pack_registry_id: sourceKind ? [root.binding.packRegistryId] : [],
      pack_registry_revision: '0', registered_pack_owner: [], registered_pack_control_epoch: '0',
      registered_pack_admin_cap_id: [],
    } },
    style: { fields: {
      part_key: 'body', item_key: 'shirt', style_key: 'default', layer_track_key: 'body',
      color_channel_key: [], default_swatch_key: [], style_asset_blob_id: 'asset',
      style_asset_sha256: hash(21), style_protected: false,
    } },
    holder: wallet, ownership_epoch: '2', transferable: true,
  });
}

test('Physical inventory infers Base versus Pack only from verified custody fields', () => {
  const root = parsedRoot();
  const base = parsePhysicalAssetV8(physicalResponse(0), runtime(), wallet, root);
  const pack = parsePhysicalAssetV8(physicalResponse(1), runtime(), wallet, root);
  assert.equal(base.source, 'BASE');
  assert.equal(base.sourceTreasuryId, null);
  assert.equal(pack.source, 'PACK');
  assert.equal(pack.sourceTreasuryId, sid(401));
  const forged = physicalResponse(0);
  forged.data.content.fields.source.fields.source_treasury_id = sid(401);
  assert.throws(
    () => parsePhysicalAssetV8(forged, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_PHYSICAL_SOURCE_MISMATCH',
  );

  const flatConflict = physicalResponse(0);
  flatConflict.data.content.fields.sourceKind = '1';
  assert.throws(
    () => parsePhysicalAssetV8(flatConflict, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_PHYSICAL_FIELDS_LEGACY',
  );

  const flatOnly = physicalResponse(0);
  const flatFields = flatOnly.data.content.fields;
  Object.assign(flatFields, flatFields.source.fields, flatFields.style.fields);
  delete flatFields.source;
  delete flatFields.style;
  assert.throws(
    () => parsePhysicalAssetV8(flatOnly, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_CHAIN_FIELDS_INVALID',
  );
});

test('discovery queries only MakerV8Activated and paginates without dual reads', async () => {
  const calls = [];
  const rpc = mainnetRpc({
    async queryEvents(input) {
      calls.push(input);
      return calls.length === 1
        ? { data: [activationEvent()], hasNextPage: true, nextCursor: { txDigest: txDigest(), eventSeq: '1' } }
        : { data: [], hasNextPage: false, nextCursor: null };
    },
  });
  const rows = await discoverMakerV8Activations(rpc, runtime());
  assert.equal(rows.length, 1);
  assert.deepEqual(calls[0].query, { MoveEventType: makerV8ChainTypes(runtime()).activationEvent });
  assert.equal(calls[0].limit, MAKER_V8_EVENT_DISCOVERY_PAGE_SIZE);
  assert.equal(calls[0].limit, 50);
  assert.equal(JSON.stringify(calls).includes('OCMaker'), false);
});

test('owned inventory queries only stable v8 types and requires complete Soul bundles', async () => {
  const root = parsedRoot();
  const types = makerV8ChainTypes(runtime());
  const soul = soulResponses();
  const foreignPhysical = physicalResponse(0);
  foreignPhysical.data.objectId = sid(999);
  foreignPhysical.data.content.fields.id = { id: sid(999) };
  foreignPhysical.data.content.fields.root_id = sid(998);
  const foreignAdmin = moveObject(types.adminCap, sid(997), {
    version: '8', root_id: sid(998), owner: wallet, control_epoch: '0',
  });
  const byType = new Map([
    [types.adminCap, [foreignAdmin]], [types.completeOutput, [soul.output]],
    [types.completeReceipt, [soul.receipt]], [types.canonicalSoul, [soul.soul]],
    [types.physicalAsset, [physicalResponse(0), foreignPhysical]],
  ]);
  const calls = [];
  const rpc = mainnetRpc({
    async getOwnedObjects(input) {
      calls.push(input);
      return { data: byType.get(input.filter.StructType) ?? [], hasNextPage: false, nextCursor: null };
    },
  });
  const inventory = await listOwnedMakerV8Inventory(rpc, runtime(), wallet, root);
  assert.equal(inventory.soulBundles.length, 1);
  assert.equal(inventory.physicalAssets.length, 1);
  assert.equal(inventory.adminCaps.length, 0);
  assert.deepEqual(new Set(calls.map((call) => call.filter.StructType)), new Set([
    types.adminCap,
    types.makerAccess,
    types.packAdminCap,
    types.packPass,
    types.externalItemAdminCap,
    types.ownedExternalItem,
    types.ownedBaseItem,
    types.makerLoadout,
    types.completeOutput,
    types.completeReceipt,
    types.canonicalSoul,
    types.physicalAsset,
  ]));
});

test('contextual inventory certifies access, owned Base/external Items, active Pack passes, and loadout slots', async () => {
  const rt = runtime();
  const root = parsedRoot();
  const types = makerV8ChainTypes(rt);
  const productId = sid(730);
  const rows = new Map([
    [types.makerAccess, [moveObject(types.makerAccess, sid(701), {
      version: '8', root_id: root.objectId, maker_version: '1',
      root_content_commitment: hash(2), holder: wallet,
      paid_atomic: '0', issued_at_ms: '10',
    })]],
    [types.packPass, [moveObject(types.packPass, sid(702), {
      version: '8', release_id: sid(731), root_id: root.objectId,
      root_version: '1', root_content_commitment: hash(2),
      release_content_commitment: hash(20), holder: wallet,
      paid_atomic: '0', issued_at_ms: '11', commitment: hash(21),
    })]],
    [types.ownedBaseItem, [moveObject(types.ownedBaseItem, sid(703), {
      version: '8', root_id: root.objectId, root_version: '1',
      root_content_commitment: hash(2),
      definition_registry_id: root.binding.runtimeDefinitionRegistryId,
      pack_registry_id: root.binding.packRegistryId,
      base_registry_id: root.binding.baseRegistryId,
      part_key: 'body', item_key: 'base-hair', item_payload_commitment: hash(22),
      holder: wallet, ownership_epoch: '3', transferable: true,
      equip_lock: { fields: { loadout_id: sid(705), equip_revision: '8', selection_index: '1' } },
    })]],
    [types.ownedExternalItem, [moveObject(types.ownedExternalItem, sid(704), {
      version: '8', product_id: productId,
      product_content_commitment: hash(23), asset_content_commitment: hash(24),
      holder: wallet, ownership_epoch: '2', transferable: true, equip_lock: null,
    })]],
    [types.makerLoadout, [moveObject(types.makerLoadout, sid(705), {
      version: '8', root_id: root.objectId, root_version: '1',
      root_content_commitment: hash(2),
      definition_registry_id: root.binding.runtimeDefinitionRegistryId,
      pack_registry_id: root.binding.packRegistryId,
      maker_access_pass_id: sid(701), maker_access_commitment: hash(25),
      holder: wallet, revision: '8', attached_pack_definitions: [], definition_slots: [{ source_definition_id: root.objectId,
        part_key: 'body', profile_commitment: hash(27), start: '0', capacity: '1' }],
      selections: [null], selection_count: '0', commitment: hash(26),
    })]],
  ]);
  const product = moveObject(types.externalItemProduct, productId, {
    version: '8', root_id: root.objectId, root_version: '1',
    root_content_commitment: hash(2), part_key: 'body', item_key: 'external-hat',
    style_key: 'violet', lifecycle: '0', content_commitment: hash(23),
    layer_track_key: 'body-track', color_channel_key: null, default_swatch_key: null,
    asset_blob_id: 'external-asset', asset_sha256: hash(24),
    asset_media_type: 'image/png', asset_byte_length: '1024',
    asset_content_commitment: hash(24), transferable: true,
    compatibility_commitment: hash(25),
  }, { Shared: { initial_shared_version: '1' } });
  const releaseId = sid(731);
  const admissionTableId = sid(732);
  const release = moveObject(types.packRelease, releaseId, {
    version: '8', root_id: root.objectId, root_version: '1',
    root_content_commitment: hash(2), semantic_pack_id: 'pack-one',
    manifest_blob_id: 'pack-manifest', manifest_sha256: hash(30),
    content_commitment: hash(20), lifecycle: '2', expected_style_count: '1',
    access_kind: '0', access_price_atomic: '0',
  }, { Shared: { initial_shared_version: '1' } });
  const packRegistry = moveObject(types.packRegistry, root.binding.packRegistryId, {
    version: '8', root_id: root.objectId, root_version: '1',
    root_content_commitment: hash(2), releases: { id: admissionTableId, size: '1' }, external_admissions: { id: sid(733), size: '1' },
  }, { Shared: { initial_shared_version: '1' } });
  const admissionLayout = bcs.struct('PackAdmissionRecordV8Fixture', {
    release_id: bcs.Address,
    semantic_pack_id: bcs.string(),
    release_content_commitment: bcs.vector(bcs.u8()),
    admitted_revision: bcs.u64(),
    admission_state: bcs.u8(),
  });
  const admissionBcs = admissionLayout.serialize({
    release_id: releaseId,
    semantic_pack_id: 'pack-one',
    release_content_commitment: hash(20),
    admitted_revision: 4n,
    admission_state: 0,
  }).toBytes();
  let servedRelease = release;
  let servedPackRegistry = packRegistry;
  const ownedRows = { semantic_pack_id: 'pack-one', tracks: [], colors: [], rules: [], visibility: [],
    parts: [{ sequence: '0', key: 'plume', label: 'Plume', kind: 0, render_order: '0', menu_order: '0',
      visible: true, required: false, slot_mode: 1, capacity: '2', track_keys: [],
      visibility_tokens: [], visibility_commitment: hash(31), payload_commitment: hash(32) }] };
  let definitionHash = [...packDefinitionCommitmentV8(releaseId, hash(20), ownedRows)];
  const definitionRegistry = moveObject(types.runtimeDefinitions, root.binding.runtimeDefinitionRegistryId, {
    version: '8', root_id: root.objectId, root_version: '1', root_content_commitment: hash(2),
    base_registry_id: root.binding.baseRegistryId, sealed: true, admission_ceiling: '1',
  }, { Shared: { initial_shared_version: '1' } });
  let externalMode = 'active';
  const rpc = mainnetRpc({
    async getOwnedObjects(input) {
      return { data: rows.get(input.filter.StructType) ?? [], hasNextPage: false, nextCursor: null };
    },
    async getObject(input) {
      if (input.id === productId) return product;
      if (input.id === releaseId) return servedRelease;
      if (input.id === root.binding.packRegistryId) return servedPackRegistry;
      if (input.id === root.binding.runtimeDefinitionRegistryId) return definitionRegistry;
      assert.fail(`unexpected object read ${input.id}`);
    },
    async getDynamicField(input) {
      if (input.parentId === releaseId) {
        const valueType = `${rt.roles.runtime.typeOriginPackageId}::runtime_v8::PackDefinitionsV8`;
        return { kind: 'DynamicField', name: input.name,
          fieldId: deriveDynamicFieldID(releaseId, input.name.type, fromBase64(input.name.bcsBase64)),
          type: `0x2::dynamic_field::Field<${input.name.type},${valueType}>`, value: {
            type: valueType, bcsBase64: toBase64(MAKER_V8_PACK_DEFINITIONS_BCS.serialize({ version: 8,
              release_id: releaseId, release_content_commitment: hash(20), rows: ownedRows, commitment: definitionHash }).toBytes()),
          } };
      }
      if (input.parentId === sid(733) && externalMode === 'missing') throw new ObjectError('NOT_FOUND', 'absent', {
        reason: 'notFound', objectId: deriveDynamicFieldID(input.parentId, input.name.type, fromBase64(input.name.bcsBase64)),
      });
      if (input.parentId === sid(733) && externalMode === 'network') throw new Error('network unavailable');
      if (input.parentId === sid(733)) return { kind: 'DynamicField', name: input.name,
        value: { type: `${rt.roles.runtime.typeOriginPackageId}::runtime_v8::ExternalAdmissionRecordV8`,
          bcsBase64: toBase64(bcs.struct('ExternalAdmissionFixture', { product_id: bcs.Address,
            compatibility_commitment: bcs.vector(bcs.u8()), product_content_commitment: bcs.vector(bcs.u8()),
            attestation_commitment: bcs.option(bcs.vector(bcs.u8())), admitted_revision: bcs.u64(), admission_state: bcs.u8() }).serialize({
              product_id: productId, compatibility_commitment: hash(externalMode === 'drift' ? 26 : 25), product_content_commitment: hash(23), attestation_commitment: null, admitted_revision: 1, admission_state: externalMode === 'revoked' ? 1 : 0,
            }).toBytes()) } };
      assert.equal(input.parentId, admissionTableId);
      return {
        kind: 'DynamicField',
        name: input.name,
        value: {
          type: `${rt.roles.runtime.typeOriginPackageId}::runtime_v8::PackAdmissionRecordV8`,
          bcsBase64: toBase64(admissionBcs),
        },
      };
    },
  });
  const inventory = await listOwnedMakerV8Inventory(rpc, rt, wallet, root);
  assert.equal(inventory.makerAccessPasses.length, 1);
  assert.equal(inventory.packPasses.length, 1);
  assert.equal(inventory.packPasses[0].release.semanticPackId, 'pack-one');
  assert.equal(inventory.packPasses[0].admission.admittedRevision, '4');
  assert.equal(inventory.ownedBaseItems[0].equipLock.selectionIndex, '1');
  assert.equal(inventory.ownedExternalItems[0].product.styleKey, 'violet');
  assert.equal(inventory.ownedExternalItems[0].product.trackKey, 'body-track');
  assert.equal(inventory.ownedExternalItems[0].product.assetBlobId, 'external-asset');
  assert.equal(inventory.ownedExternalItems[0].product.assetMediaType, 'image/png');
  assert.equal(inventory.ownedExternalItems[0].product.assetByteLength, 1024);
  assert.equal(inventory.makerLoadouts[0].revision, 8n);
  assert.deepEqual(inventory.makerLoadouts[0].attachedPackDefinitions, []);
  assert.equal(inventory.makerLoadouts[0].definitionSlots[0].part_key, 'body');
  const originalLoadout = rows.get(types.makerLoadout)[0];
  const originalSlots = structuredClone(originalLoadout.data.content.fields.definition_slots);
  for (const mutation of ['missing', 'null', 'object', 'attached-with-base-only-slots']) {
    const altered = structuredClone(originalLoadout);
    const fields = altered.data.content.fields;
    if (mutation === 'missing') delete fields.attached_pack_definitions;
    if (mutation === 'null') fields.attached_pack_definitions = null;
    if (mutation === 'object') fields.attached_pack_definitions = {};
    if (mutation === 'attached-with-base-only-slots') fields.attached_pack_definitions = [{
      release_id: sid(731), definition_commitment: hash(28),
    }];
    rows.set(types.makerLoadout, [altered]);
    await assert.rejects(listOwnedMakerV8Inventory(rpc, rt, wallet, root), { code: 'MAKER_V8_LOADOUT_LAYOUT_INVALID' });
  }
  const attachedLoadout = structuredClone(originalLoadout);
  const attachedFields = attachedLoadout.data.content.fields;
  attachedFields.attached_pack_definitions = [{ release_id: releaseId, definition_commitment: definitionHash }];
  const profile = deriveMakerV8PackProfiles({ contentCommitment: Buffer.from(hash(20)).toString('hex'), rows: ownedRows }, 1)[0];
  attachedFields.definition_slots.push({ source_definition_id: releaseId, part_key: 'plume',
    profile_commitment: [...fromHex(profile.profileCommitment)], start: '1', capacity: '2' });
  attachedFields.selections.push(null, null);
  rows.set(types.makerLoadout, [attachedLoadout]);
  const withAttachment = await listOwnedMakerV8Inventory(rpc, rt, wallet, root);
  assert.equal(withAttachment.makerLoadouts[0].definitionSlots[1].part_key, 'plume');
  assert.deepEqual(withAttachment.makerLoadouts[0].packDefinitionLayout, {
    bindings: [{ releaseId, definitionCommitment: Buffer.from(definitionHash).toString('hex') }],
    profiles: [{ ...profile, releaseId }],
  });
  assert.ok(Object.isFrozen(withAttachment.makerLoadouts[0].packDefinitionLayout.profiles));
  const originalPasses = rows.get(types.packPass);
  rows.set(types.packPass, []);
  assert.equal((await listOwnedMakerV8Inventory(rpc, rt, wallet, root)).makerLoadouts.length, 1);
  rows.set(types.packPass, originalPasses);
  // A zero-Part bundle still has a mandatory exact binding but no extra slots.
  const savedParts = ownedRows.parts;
  const savedHash = definitionHash;
  ownedRows.parts = [];
  definitionHash = [...packDefinitionCommitmentV8(releaseId, hash(20), ownedRows)];
  const zeroPartLoadout = structuredClone(originalLoadout);
  zeroPartLoadout.data.content.fields.attached_pack_definitions = [{ release_id: releaseId, definition_commitment: definitionHash }];
  rows.set(types.makerLoadout, [zeroPartLoadout]);
  assert.equal((await listOwnedMakerV8Inventory(rpc, rt, wallet, root)).makerLoadouts[0].definitionSlots.length, 1);
  ownedRows.parts = savedParts; definitionHash = savedHash;
  for (const mutate of [
    fields => { fields.definition_slots[1].profile_commitment = hash(99); },
    fields => { fields.definition_slots[1].capacity = '1'; },
    fields => { fields.definition_slots[1].source_definition_id = sid(999); },
    fields => { fields.definition_slots.reverse(); },
    fields => { fields.definition_slots.pop(); },
    fields => { fields.attached_pack_definitions[0].definition_commitment = hash(99); },
    fields => { fields.attached_pack_definitions.push(structuredClone(fields.attached_pack_definitions[0])); },
  ]) {
    const changed = structuredClone(attachedLoadout); mutate(changed.data.content.fields);
    rows.set(types.makerLoadout, [changed]);
    await assert.rejects(listOwnedMakerV8Inventory(rpc, rt, wallet, root), { code: 'MAKER_V8_LOADOUT_LAYOUT_INVALID' });
  }
  for (const mutation of ['missing', 'foreign', 'gap', 'capacity', 'profile', 'duplicate']) {
    const altered = structuredClone(originalLoadout);
    const loadoutFields = altered.data.content.fields;
    rows.set(types.makerLoadout, [altered]);
    if (mutation === 'missing') delete loadoutFields.definition_slots;
    if (mutation === 'foreign') loadoutFields.definition_slots[0].source_definition_id = sid(999);
    if (mutation === 'gap') loadoutFields.definition_slots[0].start = '1';
    if (mutation === 'capacity') loadoutFields.definition_slots[0].capacity = '2';
    if (mutation === 'profile') loadoutFields.definition_slots[0].profile_commitment = [];
    if (mutation === 'duplicate') loadoutFields.definition_slots.push({ ...originalSlots[0] });
    await assert.rejects(listOwnedMakerV8Inventory(rpc, rt, wallet, root));
  }
  rows.set(types.makerLoadout, [originalLoadout]);
  assert.equal(inventory.ownedExternalItems[0].product.admission.admissionState, 0);
  externalMode = 'revoked';
  assert.equal((await listOwnedMakerV8Inventory(rpc, rt, wallet, root)).ownedExternalItems[0].product.admission.admissionState, 1);
  externalMode = 'missing';
  assert.equal((await listOwnedMakerV8Inventory(rpc, rt, wallet, root)).ownedExternalItems[0].product.admission, null);
  externalMode = 'network';
  await assert.rejects(listOwnedMakerV8Inventory(rpc, rt, wallet, root), /network unavailable/);
  externalMode = 'drift';
  await assert.rejects(listOwnedMakerV8Inventory(rpc, rt, wallet, root), { code: 'MAKER_V8_EXTERNAL_ADMISSION_DRIFT' });
  externalMode = 'active';
  servedPackRegistry = structuredClone(packRegistry);
  servedPackRegistry.data.objectId = sid(999);
  servedPackRegistry.data.content.fields.id = sid(999);
  await assert.rejects(listOwnedMakerV8Inventory(rpc, rt, wallet, root), { code: 'MAKER_V8_EXTERNAL_ADMISSION_DRIFT' });
  servedPackRegistry = packRegistry;

  servedRelease = structuredClone(release);
  servedRelease.data.content.fields.lifecycle = '1';
  await assert.rejects(
    () => listOwnedMakerV8Inventory(rpc, rt, wallet, root),
    (error) => error.code === 'MAKER_V8_PACK_RELEASE_INACTIVE',
    'a SEALED Pack must never be exposed as an ACTIVE Player choice',
  );
});

test('Receiving uses exact child object ID/version/digest and rejects tx.object substitution context', async () => {
  const rt = runtime();
  const listingId = sid(500);
  const child = moveObject(makerV8ChainTypes(rt).adminCap, sid(501), {
    version: '8', root_id: binding().rootId, owner: wallet, control_epoch: '0',
  }, { ObjectOwner: listingId }, '17');
  const rpc = mainnetRpc({ async getObject() { return child; } });
  const ref = await loadReceivingRefV8(rpc, rt, sid(501), listingId, makerV8ChainTypes(rt).adminCap);
  assert.deepEqual(ref, {
    objectId: sid(501), version: '17', digest: objectDigest('6'), network: 'mainnet',
    type: makerV8ChainTypes(rt).adminCap, listingId,
  });
  child.data.owner = { ObjectOwner: sid(999) };
  assert.rejects(
    () => loadReceivingRefV8(rpc, rt, sid(501), listingId, makerV8ChainTypes(rt).adminCap),
    (error) => error.layer === 'stale' && error.code === 'MAKER_V8_RECEIVING_OWNER_MISMATCH',
  );
});

test('gRPC finalized readback is query-first, sender-bound, event-bound, and failure-layered', async () => {
  const eventType = makerV8ChainTypes(runtime()).activationEvent;
  const finalizedRpc = ({ success = true } = {}) => {
    const transaction = {
      digest: txDigest(),
      epoch: '7',
      status: { success, error: success ? null : { message: 'MoveAbort(...)' } },
      transaction: { sender: wallet },
      effects: {
        transactionDigest: txDigest(),
        status: { success, error: success ? null : { message: 'MoveAbort(...)' } },
        changedObjects: [],
      },
      events: [{ eventType }],
    };
    return mainnetRpc({
      async getTransactionFinality() {
        return {
          digest: txDigest(), checkpoint: '10', epoch: '7',
          status: transaction.status,
        };
      },
      core: {
        async getTransaction() {
          return success
            ? { $kind: 'Transaction', Transaction: transaction }
            : { $kind: 'FailedTransaction', FailedTransaction: transaction };
        },
      },
    });
  };
  const result = await readFinalizedMakerV8Transaction(finalizedRpc(), txDigest(), {
    expectedSender: wallet, expectedEventTypes: [eventType],
  });
  assert.equal(result.digest, txDigest());

  await assert.rejects(
    () => readFinalizedMakerV8Transaction(finalizedRpc({ success: false }), txDigest(), { expectedSender: wallet }),
    (error) => error.layer === 'finalized' && error.code === 'MAKER_V8_FINALIZED_FAILURE',
  );
  await assert.rejects(
    () => readFinalizedMakerV8Transaction(mainnetRpc({
      async getTransactionFinality() { throw new Error('not indexed'); },
      core: { async getTransaction() { throw new Error('must not run'); } },
    }), txDigest(), { expectedSender: wallet }),
    (error) => error.layer === 'signed-outcome' && error.code === 'MAKER_V8_SIGNED_OUTCOME_UNKNOWN',
  );
});

test('client accepts only an RPC attested to the exact Mainnet chain identifier', async () => {
  class Rpc { async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; } }
  const client = createMakerV8ChainClient(runtime(), { rpc: new Rpc(), network: 'mainnet' });
  await assert.doesNotReject(() => client.ready());
  assert.throws(
    () => createMakerV8ChainClient(runtime(), { rpc: new Rpc(), network: 'testnet' }),
    (error) => error.code === 'MAKER_V8_NETWORK_MISMATCH',
  );
  await assert.rejects(
    () => createMakerV8ChainClient(runtime(), {
      rpc: { async getChainIdentifier() { return 'testnet-chain'; } }, network: 'mainnet',
    }).ready(),
    (error) => error.code === 'MAKER_V8_RPC_CHAIN_ID_MISMATCH',
  );
});

test('Pack authoring context derives every registry and MakerAdmin ref from the activated Root', async () => {
  const rt = runtime();
  const b = binding();
  const root = parsedRoot();
  const types = makerV8ChainTypes(rt);
  const objects = new Map([
    [b.runtimeDefinitionRegistryId, moveObject(types.runtimeDefinitions, b.runtimeDefinitionRegistryId, {
      version: '8', root_id: b.rootId, root_version: '1', root_content_commitment: hash(2),
      base_registry_id: b.baseRegistryId, admission_ceiling: '2', sealed: true,
    }, { Shared: { initial_shared_version: '2' } })],
    [b.baseRegistryId, moveObject(types.baseRegistry, b.baseRegistryId, {
      version: '8', root_id: b.rootId, maker_version: '1', root_content_commitment: hash(2), sealed: true,
    }, { Shared: { initial_shared_version: '3' } })],
    [b.packRegistryId, moveObject(types.packRegistry, b.packRegistryId, {
      version: '8', root_id: b.rootId, root_version: '1', root_content_commitment: hash(2),
      definition_registry_id: b.runtimeDefinitionRegistryId,
      admission_authority_id: b.packAdmissionAuthorityId,
      admission_policy_commitment: hash(15), revision: '7',
    }, { Shared: { initial_shared_version: '4' } })],
    [b.packAdmissionAuthorityId, moveObject(types.packAdmissionAuthority, b.packAdmissionAuthorityId, {
      version: '8', root_id: b.rootId, root_version: '1', root_content_commitment: hash(2),
    })],
    [b.physicalRegistryId, moveObject(types.physicalRegistry, b.physicalRegistryId, {
      version: '8', catalog_id: rt.catalogId, product_binding_commitment: hash(5),
      call_cap_set_commitment: hash(6), root_id: b.rootId, maker_version: '1',
      root_content_commitment: hash(2), base_registry_id: b.baseRegistryId, revision: '0',
    }, { Shared: { initial_shared_version: '5' } })],
    [b.marketRegistryId, moveObject(types.marketRegistry, b.marketRegistryId, {
      catalog_id: rt.catalogId, product_binding_commitment: hash(5), call_cap_set_commitment: hash(6),
      root_id: b.rootId, maker_version: '1', root_content_commitment: hash(2),
      treasury_id: b.marketTreasuryId, sealed: true, revision: '0',
    }, { Shared: { initial_shared_version: '6' } })],
    [rt.roleConfigIds.release, moveObject(types.releaseConfig, rt.roleConfigIds.release, {
      version: '8', catalog_id: rt.catalogId, product_binding_commitment: hash(5),
      call_cap_set_commitment: hash(6), release_call_cap: {},
    }, { Shared: { initial_shared_version: '7' } })],
  ]);
  const admin = moveObject(types.adminCap, root.adminCapId, {
    version: '8', root_id: b.rootId, owner: wallet, control_epoch: '0',
  });
  const rpc = mainnetRpc({
    async getOwnedObjects({ filter }) {
      return {
        data: filter.StructType === types.adminCap ? [admin] : [],
        hasNextPage: false,
        nextCursor: null,
      };
    },
    async getObject({ id: objectId }) {
      return objects.get(objectId);
    },
  });
  const context = await loadMakerV8PackAuthoringContext(rpc, rt, root, wallet);
  assert.equal(context.root.objectRef.objectId, b.rootId);
  assert.equal(context.makerAdmin.objectRef.objectId, root.adminCapId);
  assert.equal(context.definitionRegistry.admissionCeiling, 'OPEN');
  assert.equal(context.packRegistry.revision, '7');
  assert.equal(context.packRegistry.admissionAuthorityId, b.packAdmissionAuthorityId);
  assert.equal(context.physicalRegistry.productBindingCommitment, hash(5).map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  assert.equal(context.releaseConfig.objectRef.objectId, rt.roleConfigIds.release);

  // All companion objects agreeing with one another is insufficient: they
  // must agree with the independently certified Root publication.
  for (const key of ['product_binding_commitment', 'call_cap_set_commitment', 'catalog_id']) {
    const originals = new Map();
    for (const objectId of [b.physicalRegistryId, b.marketRegistryId, rt.roleConfigIds.release]) {
      originals.set(objectId, objects.get(objectId));
      const changed = structuredClone(objects.get(objectId));
      changed.data.content.fields[key] = key === 'catalog_id' ? sid(999) : hash(99);
      objects.set(objectId, changed);
    }
    await assert.rejects(loadMakerV8PackAuthoringContext(rpc, rt, root, wallet),
      { code: 'MAKER_V8_PACK_PRODUCT_BINDING_MISMATCH' });
    for (const [objectId, original] of originals) objects.set(objectId, original);
  }
  const originalPhysical = objects.get(b.physicalRegistryId);
  const wrongPhysical = structuredClone(originalPhysical);
  wrongPhysical.data.objectId = sid(999);
  wrongPhysical.data.content.fields.id = { id: sid(999) };
  objects.set(b.physicalRegistryId, wrongPhysical);
  await assert.rejects(loadMakerV8PackAuthoringContext(rpc, rt, root, wallet),
    { code: 'MAKER_V8_PACK_REGISTRY_BINDING_MISMATCH' });
  objects.set(b.physicalRegistryId, originalPhysical);

  const driftedPackRegistry = structuredClone(objects.get(b.packRegistryId));
  driftedPackRegistry.data.content.fields.definition_registry_id = sid(999);
  objects.set(b.packRegistryId, driftedPackRegistry);
  await assert.rejects(
    loadMakerV8PackAuthoringContext(rpc, rt, root, wallet),
    (error) => error.code === 'MAKER_V8_PACK_REGISTRY_BINDING_MISMATCH',
  );
});
