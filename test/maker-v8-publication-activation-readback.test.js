import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { createMakerV8CompilerRpcAdapterV8, makerV8TransactionEventsDigestV8 } from '../maker-v8-browser.js';
import { makerV8ChainTypes, MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';
import { MAKER_V8_RUNTIME_SCHEMA, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_CLOCK_OBJECT_ID } from '../maker-v8-runtime.js';

const sid = number => `0x${BigInt(number).toString(16).padStart(64, '0')}`;
const txDigest = () => '11111111111111111111111111111111';
const objectDigest = txDigest;
const hash = byte => Array(32).fill(byte);
const wallet = sid(900);
const hex = byte => byte.toString(16).padStart(2, '0').repeat(32);
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


async function finalReadback(mutate = () => {}) {
  const rt = runtime(), types = makerV8ChainTypes(rt), root = rootResponse().data;
  const adminFields = { version: 8, rootId: root.objectId, owner: wallet, controlEpoch: '0' };
  const adminType = `${rt.roles.core.typeOriginPackageId}::maker_v8::MakerAdminCapV8`;
  const adminRef = { objectId: sid(112), version: '8', digest: txDigest() };
  const transaction = new Transaction(); transaction.setSender(wallet);
  transaction.moveCall({ target: `${rt.roles.release.callablePackageId}::release_v8::seal_and_activate_maker_v8`,
    arguments: [transaction.sharedObjectRef({ objectId: root.objectId, initialSharedVersion: '1', mutable: true }), transaction.objectRef(adminRef)],
    typeArguments: [rt.paymentCoinType] });
  const kind = await transaction.build({ onlyTransactionKind: true });
  const transactionBcs = bcs.TransactionData.serialize({ V1: { kind: bcs.TransactionKind.parse(kind), sender: wallet,
    gasData: { payment: [{ objectId: sid(9999), version: '1', digest: txDigest() }], owner: wallet, price: '1', budget: '1000000' },
    expiration: { None: true } } }).toBytes();
  const digest = TransactionDataBuilder.getDigestFromBytes(transactionBcs);
  const activation = activationEvent().parsedJson;
  const registryLayout = bcs.struct('Registries', Object.fromEntries(Object.keys(activation.registry_ids).map(key => [key, bcs.Address])));
  const eventLayout = bcs.struct('MakerV8Activated', Object.fromEntries(Object.entries(activation).map(([key, value]) => [key,
    key === 'registry_ids' ? registryLayout : key === 'maker_key' ? bcs.string() : Array.isArray(value) ? bcs.vector(bcs.u8())
      : key.endsWith('_id') || key === 'owner' ? bcs.Address : bcs.u64()])));
  const event = { eventType: types.activationEvent, packageId: rt.roles.release.callablePackageId, module: 'release_v8',
    sender: wallet, json: activation, bcs: eventLayout.serialize(activation).toBytes() };
  const eventsDigest = makerV8TransactionEventsDigestV8([event]).digest;
  const rows = [
    { objectId: root.objectId, version: '9', digest: txDigest(), type: types.root, owner: { Shared: { initialSharedVersion: '1' } }, parsed: root.content.fields },
    { objectId: adminRef.objectId, version: '9', digest: txDigest(), type: adminType, owner: { AddressOwner: wallet }, parsed: adminFields },
  ].map(row => ({ ...row, previousTransaction: digest, contentBcs: Uint8Array.of(1), objectBcs: Uint8Array.of(2) }));
  const effectsBcs = bcs.TransactionEffects.serialize({ V1: {
    status: { Success: true }, executedEpoch: '1', gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' },
    modifiedAtVersions: [[adminRef.objectId, adminRef.version]], sharedObjects: [], transactionDigest: digest,
    created: [], mutated: rows.map(row => [{ objectId: row.objectId, version: row.version, digest: row.digest }, row.owner]),
    unwrapped: [], deleted: [], unwrappedThenDeleted: [], wrapped: [],
    gasObject: [{ objectId: sid(9999), version: '2', digest: txDigest() }, { AddressOwner: wallet }], eventsDigest, dependencies: [],
  } }).toBytes();
  const evidence = { digest, checkpoint: '7', epoch: '1', transactionBcs, transactionBcsBase64: toBase64(transactionBcs),
    effectsBcs, effectsBcsBase64: toBase64(effectsBcs), effectsStatus: { success: true }, eventsDigest, transactionEvents: { eventCount: 1 } };
  const client = {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getFinalizedTransactionEvidence() { return evidence; },
    core: { async getTransaction() { return { $kind: 'Transaction', Transaction: {
      digest, epoch: '1', status: { success: true }, transaction: { sender: wallet, commands: transaction.getData().commands }, bcs: transactionBcs,
      effects: { status: { success: true }, transactionDigest: digest, bcs: effectsBcs, eventsDigest,
        changedObjects: rows.map(row => ({ objectId: row.objectId, outputState: 'ObjectWrite', idOperation: 'None',
          outputVersion: row.version, outputDigest: row.digest, outputOwner: row.owner })) },
      events: [event], objectTypes: Object.fromEntries(rows.map(row => [row.objectId, row.type])),
    } }; } },
    async getHistoricalObject({ objectId, version }) {
      const row = objectId === adminRef.objectId && version === 8n
        ? { ...rows[1], version: '8' } : rows.find(row => row.objectId === objectId && BigInt(row.version) === version);
      assert.ok(row); const result = structuredClone(row); if (objectId === root.objectId) mutate(result);
      return result;
    },
  };
  const publication = { context: { signerAddress: wallet, _derived: { productBindingCommitment: hex(5), callCapSetCommitment: hex(6) } },
    document: { lineage: { makerKey: 'fresh-maker', version: 1 } }, commitments: { content: hex(2), version: hex(1) }, manifest: { sha256: hex(13) } };
  const base = { root: { type: types.root, reference: { kind: 'shared', objectId: root.objectId, initialSharedVersion: '1' } },
    adminCap: { type: adminType, reference: { kind: 'owned', ...adminRef }, fields: adminFields } };
  const adapter = createMakerV8CompilerRpcAdapterV8({ client, runtime: rt });
  return adapter.recoverCheckpoint({ kind: 'ACTIVATION_CHUNK', digest, build: { transaction, checkpoint: { final: true } }, publication, base });
}

test('FINALIZE adapter reads real nested Root commitments without obsolete flat aliases', async () => {
  const readback = await finalReadback();
  assert.equal(readback.lifecycle, 'ACTIVE');
  assert.equal(readback.manifestSha256, hex(13));
  assert.equal(readback.protocolConfigCommitment, hex(4));
  assert.equal(readback.productBindingCommitment, hex(5));
  assert.equal(readback.callCapSetCommitment, hex(6));
});

test('FINALIZE nested commitment authority rejects missing, malformed and wrong values despite flat shadows', async t => {
  for (const [container, field, expected] of [
    ['content', 'manifest_sha256', 13],
    ['economics', 'protocol_config_commitment', 4],
    ['release', 'product_binding_commitment', 5],
    ['release', 'call_cap_set_commitment', 6],
  ]) {
    for (const shape of ['missing', 'malformed', 'wrong']) for (const shadow of [false, true]) await t.test(`${field} ${shape} shadow=${shadow}`, async () => {
      await assert.rejects(finalReadback(row => {
        const fields = row.parsed;
        if (shadow) fields[field] = hash(expected); // Obsolete aliases cannot repair authoritative nested data.
        const nested = container === 'release' ? fields.publication.release_commitments : fields[container];
        if (shape === 'missing') delete nested[field];
        else nested[field] = shape === 'malformed' ? [1] : hash(99);
      }));
    });
  }
  await assert.rejects(finalReadback(row => {
    for (const field of ['manifest_sha256', 'protocol_config_commitment', 'product_binding_commitment', 'call_cap_set_commitment']) row.parsed[field] = hash(99);
  }), { code: 'MAKER_V8_CHAIN_FIELD_UNKNOWN' });
});

test('FINALIZE retains historical reference, owner, transaction, BCS-presence and lifecycle rejection', async t => {
  for (const [name, mutate] of [
    ['version', row => { row.version = '10'; }],
    ['digest', row => { row.digest = '22222222222222222222222222222222'; }],
    ['owner', row => { row.owner = { AddressOwner: wallet }; }],
    ['transaction', row => { row.previousTransaction = txDigest(); }],
    ['content BCS', row => { row.contentBcs = null; }],
    ['object BCS', row => { row.objectBcs = null; }],
    ['lifecycle', row => { row.parsed.lifecycle = '0'; }],
    ['root owner', row => { row.parsed.owner = sid(901); }],
  ]) await t.test(name, async () => { await assert.rejects(finalReadback(mutate)); });
});
