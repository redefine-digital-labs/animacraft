import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createMakerV8ProductBridge } from '../maker-v8-product-bridge.js';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { seedMinimalArtworkDraft } from './fixtures/maker-v8-minimal-artwork.js';

import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8ChainTypes,
  makerV8AttestedReplacement,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_COMPOSABLE_ACTIONS,
  MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
  buildMakerV8ComposableRequestV8,
  buildMakerV8ComposableTransactionV8,
  createMakerV8ComposableAuthorityLoaderV8,
  createMakerV8ComposableControllerV8,
  createMakerV8ComposablePersistenceV8,
  createMakerV8ComposableReadbackV8,
} from '../maker-v8-composable-controller.js';
import { createMakerV8PackPublicationMemoryPersistenceV8 } from '../maker-v8-pack-publication.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
  makerV8StableType,
} from '../maker-v8-runtime.js';
import { attestFixtureRuntime } from './fixtures/maker-v8-runtime-attestation.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const suiDigest = (value) => toBase58(new Uint8Array(32).fill(value));
const signer = id(900);
const recipient = id(901);
const gas = id(902);
const ZERO = '00'.repeat(32);

function rawRuntime() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: id(10 + index * 2),
        callablePackageId: id(11 + index * 2),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(40),
    protocolConfigId: id(41),
    protocolTreasuryId: id(42),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: id(50), runtime: id(51), output: id(52), physical: id(53),
      market: id(54), release: id(55),
    },
    makerBindings: [],
  };
}

const runtime = await attestFixtureRuntime(rawRuntime());
const types = makerV8ChainTypes(runtime);

function ref(value) {
  return { objectId: id(value), version: String(value), digest: suiDigest(value) };
}

function input(value, type, owner, fields) {
  return { objectRef: ref(value), type, owner, fields };
}

function fixtures() {
  const rootId = id(100);
  const definitionsId = id(101);
  const baseRegistryId = id(102);
  const packRegistryId = id(103);
  const admissionId = id(104);
  const makerAdminId = id(105);
  const productId = id(106);
  const externalAdminId = id(107);
  const root = input(100, types.root, { kind: 'SHARED', initialSharedVersion: '1' }, {
    id: rootId, lifecycle: '1', owner: signer, admin_cap_id: makerAdminId, control_epoch: '0',
  });
  const definitionRegistry = input(101, types.runtimeDefinitions, { kind: 'SHARED', initialSharedVersion: '2' }, {
    id: definitionsId, root_id: rootId, root_version: '1', root_content_commitment: [...new Uint8Array(32)],
    base_registry_id: baseRegistryId, admission_ceiling: '2', sealed: true,
  });
  const baseRegistry = input(102, types.baseRegistry, { kind: 'SHARED', initialSharedVersion: '3' }, {
    id: baseRegistryId, root_id: rootId,
  });
  const packRegistry = input(103, types.packRegistry, { kind: 'SHARED', initialSharedVersion: '4' }, {
    id: packRegistryId, root_id: rootId, definition_registry_id: definitionsId,
    admission_authority_id: admissionId, revision: '9', external_admission_count: '0',
  });
  const admissionAuthority = input(104, types.packAdmissionAuthority, { kind: 'SHARED', initialSharedVersion: '5' }, {
    id: admissionId, root_id: rootId,
  });
  const makerAdmin = input(105, types.adminCap, { kind: 'ADDRESS', address: signer }, {
    id: makerAdminId, root_id: rootId, owner: signer, control_epoch: '0',
  });
  const product = input(106, types.externalItemProduct, { kind: 'SHARED', initialSharedVersion: '6' }, {
    id: productId, version: '8', root_id: rootId, root_version: '1', root_content_commitment: [...new Uint8Array(32)],
    creator: signer, owner: signer, control_epoch: '0', admin_cap_id: externalAdminId,
    lifecycle: '0', part_key: 'outfit', item_key: 'cape', style_key: 'default',
    layer_track_key: 'outfit', color_channel_key: { vec: [] }, default_swatch_key: { vec: [] },
    asset_blob_id: 'walrus-composable-1', asset_sha256: [...new Uint8Array(32)],
    asset_media_type: 'image/png', asset_byte_length: '4', asset_content_commitment: [...new Uint8Array(32)],
    compatibility_commitment: [...new Uint8Array(32)], content_commitment: [...new Uint8Array(32)],
    transferable: true, supply: '0',
  });
  const adminCap = input(107, types.externalItemAdminCap, { kind: 'ADDRESS', address: signer }, {
    id: externalAdminId, version: '8', product_id: productId, owner: signer, control_epoch: '0',
  });
  const catalog = input(40, types.productReleaseCatalog, { kind: 'SHARED', initialSharedVersion: '7' }, {
    id: runtime.catalogId,
  });
  const runtimeConfig = input(51, types.runtimeConfig, { kind: 'SHARED', initialSharedVersion: '8' }, {
    id: runtime.roleConfigIds.runtime, catalog_id: runtime.catalogId,
  });
  const protocolConfig = input(41, types.protocolConfig, { kind: 'SHARED', initialSharedVersion: '1' }, {
    id: runtime.protocolConfigId,
  });
  const pinned = makerV8AttestedReplacement(runtime);
  const replacement = { objectRef: { objectId: pinned.objectId, version: String(pinned.version), digest: pinned.digest },
    type: makerV8StableType(runtime, 'core', 'package_binding_v8', 'FreshTupleReplacementBindingV2'),
    owner: { kind: 'IMMUTABLE' }, fields: { catalog_id: runtime.catalogId } };
  return {
    rootId, definitionsId, baseRegistryId, packRegistryId, admissionId,
    makerAdminId, productId, externalAdminId,
    root, definitionRegistry, baseRegistry, packRegistry, admissionAuthority,
    makerAdmin, product, adminCap, catalog, runtimeConfig, protocolConfig, replacement,
  };
}

function emptyInputs() {
  return {
    root: null, definitionRegistry: null, baseRegistry: null, packRegistry: null,
    admissionAuthority: null, makerAdmin: null, catalog: null, runtimeConfig: null,
    protocolConfig: null, replacement: null,
    product: null, adminCap: null,
  };
}

function emptyPayload() {
  return {
    partKey: null, itemKey: null, styleKey: null, layerTrackKey: null,
    colorChannelKey: null, defaultSwatchKey: null, assetBlobId: null,
    assetSha256: null, assetMediaType: null, assetByteLength: null,
    assetContentCommitment: null, transferable: null, recipient: null,
  };
}

function request(action = MAKER_V8_COMPOSABLE_ACTIONS.PAUSE_PRODUCT) {
  const f = fixtures();
  const inputs = emptyInputs();
  const payload = emptyPayload();
  if (action === 'CREATE_PRODUCT') {
    Object.assign(inputs, { root: f.root, definitionRegistry: f.definitionRegistry, baseRegistry: f.baseRegistry });
    Object.assign(payload, {
      partKey: 'outfit', itemKey: 'cape', styleKey: 'default', layerTrackKey: 'outfit',
      colorChannelKey: null, defaultSwatchKey: null, assetBlobId: 'walrus-composable-1',
      assetSha256: ZERO, assetMediaType: 'image/png', assetByteLength: '4',
      assetContentCommitment: ZERO, transferable: true,
    });
  } else if (['ADMIT_OPEN', 'ADMIT_CERTIFIED'].includes(action)) {
    Object.assign(inputs, {
      packRegistry: f.packRegistry, admissionAuthority: f.admissionAuthority,
      definitionRegistry: f.definitionRegistry, root: f.root, makerAdmin: f.makerAdmin,
      product: f.product,
      ...(action === 'ADMIT_CERTIFIED' ? { catalog: f.catalog, runtimeConfig: f.runtimeConfig,
        protocolConfig: f.protocolConfig, replacement: f.replacement } : {}),
    });
  } else if (action === 'REVOKE_ADMISSION') {
    Object.assign(inputs, {
      packRegistry: f.packRegistry, admissionAuthority: f.admissionAuthority,
      definitionRegistry: f.definitionRegistry, root: f.root, makerAdmin: f.makerAdmin,
    });
  } else {
    Object.assign(inputs, { product: f.product, adminCap: f.adminCap });
    if (['TRANSFER_CONTROL', 'MINT_ITEM'].includes(action)) payload.recipient = recipient;
  }
  return buildMakerV8ComposableRequestV8({
    schemaVersion: 'animacraft.maker-v8-composable-request.v1',
    action,
    requestId: `external-${action.toLowerCase().replaceAll('_', '-')}`,
    signer,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    inputs,
    product: {
      rootId: f.rootId,
      productId: action === 'CREATE_PRODUCT' ? null : f.productId,
      adminCapId: ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM'].includes(action)
        ? f.externalAdminId : null,
      sourceLifecycle: ['PAUSE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM'].includes(action) ? 0
        : action === 'RESUME_PRODUCT' || action === 'ARCHIVE_PRODUCT' ? 1 : null,
      controlEpoch: ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM'].includes(action)
        ? '0' : null,
      packRegistryRevision: ['ADMIT_OPEN', 'ADMIT_CERTIFIED', 'REVOKE_ADMISSION'].includes(action) ? '9' : null,
    },
    payload,
  });
}

test('Composable compiler covers the exact external author, admission, lifecycle, transfer and mint ABI', async () => {
  const expected = {
    CREATE_PRODUCT: ['new_external_item_product_v8', 'share_external_item_product_v8', 'transfer_external_item_admin_cap_v8'],
    ADMIT_OPEN: ['admit_open_external_product_v8'],
    ADMIT_CERTIFIED: ['certify_external_item_product_v8', 'admit_certified_external_product_v8'],
    REVOKE_ADMISSION: ['revoke_external_product_v8'],
    PAUSE_PRODUCT: ['pause_external_product_v8'],
    RESUME_PRODUCT: ['resume_external_product_v8'],
    ARCHIVE_PRODUCT: ['archive_external_product_v8'],
    TRANSFER_CONTROL: ['transfer_external_item_control_v8'],
    MINT_ITEM: ['mint_owned_external_item_v8', 'transfer_new_owned_item_to_holder_v8'],
  };
  for (const [action, suffixes] of Object.entries(expected)) {
    const built = await buildMakerV8ComposableTransactionV8(runtime, request(action));
    assert.deepEqual(built.targets.map((target) => target.split('::').at(-1)), suffixes);
    assert.equal(typeof built.kindSha256, 'string');
  }
});

test('Composable request rejects invalid lifecycle, authority, unused fields and transfer-to-self', () => {
  const paused = structuredClone(request('PAUSE_PRODUCT'));
  paused.product.sourceLifecycle = 1;
  assert.throws(() => buildMakerV8ComposableRequestV8(paused), { code: 'MAKER_V8_COMPOSABLE_LIFECYCLE_INVALID' });
  const capDrift = structuredClone(request('MINT_ITEM'));
  capDrift.inputs.adminCap.owner.address = id(999);
  assert.throws(() => buildMakerV8ComposableRequestV8(capDrift), { code: 'MAKER_V8_COMPOSABLE_AUTHORITY_INVALID' });
  const unused = structuredClone(request('PAUSE_PRODUCT'));
  unused.payload.itemKey = 'forged';
  assert.throws(() => buildMakerV8ComposableRequestV8(unused), { code: 'MAKER_V8_COMPOSABLE_UNUSED_INPUT' });
  const self = structuredClone(request('TRANSFER_CONTROL'));
  self.payload.recipient = signer;
  assert.throws(() => buildMakerV8ComposableRequestV8(self), { code: 'MAKER_V8_COMPOSABLE_RECIPIENT_INVALID' });
});

test('certified admission serializes the actual five-input certification ABI before consuming its proof', async () => {
  const req = request('ADMIT_CERTIFIED');
  const built = await buildMakerV8ComposableTransactionV8(runtime, req);
  const data = Transaction.fromKind(fromBase64(built.kindBytes)).getData();
  const call = data.commands[0].MoveCall;
  assert.equal(call.function, 'certify_external_item_product_v8');
  assert.equal(call.arguments.length, 5);
  assert.deepEqual(call.typeArguments, []);
  assert.deepEqual(call.arguments.map(arg => {
    assert.equal(arg.$kind, 'Input');
    const object = data.inputs[arg.Input].Object;
    return (object.SharedObject ?? object.ImmOrOwnedObject).objectId;
  }), ['protocolConfig', 'catalog', 'replacement', 'runtimeConfig', 'product'].map(name => req.inputs[name].objectRef.objectId));
  assert.deepEqual(data.commands[1].MoveCall.arguments[6], { $kind: 'Result', Result: 0 });
});

for (const changed of ['protocol-id', 'protocol-type', 'protocol-owner', 'replacement-id',
  'replacement-version', 'replacement-digest', 'replacement-owner', 'replacement-catalog', 'catalog', 'runtime-config']) {
  test(`certified admission rejects ${changed} drift instead of building an obsolete or substituted call`, async () => {
    const req = structuredClone(request('ADMIT_CERTIFIED'));
    delete req.documentSha256;
    if (changed === 'protocol-id') req.inputs.protocolConfig.objectRef.objectId = id(999);
    else if (changed === 'protocol-type') req.inputs.protocolConfig.type = types.runtimeConfig;
    else if (changed === 'protocol-owner') req.inputs.protocolConfig.owner = { kind: 'IMMUTABLE' };
    else if (changed === 'replacement-id') req.inputs.replacement.objectRef.objectId = id(999);
    else if (changed === 'replacement-version') req.inputs.replacement.objectRef.version = '99';
    else if (changed === 'replacement-digest') req.inputs.replacement.objectRef.digest = suiDigest(99);
    else if (changed === 'replacement-owner') req.inputs.replacement.owner = { kind: 'SHARED', initialSharedVersion: '1' };
    else if (changed === 'replacement-catalog') req.inputs.replacement.fields.catalog_id = id(999);
    else if (changed === 'catalog') req.inputs.catalog.objectRef.objectId = id(999);
    else req.inputs.runtimeConfig.objectRef.objectId = id(999);
    await assert.rejects(buildMakerV8ComposableTransactionV8(runtime, buildMakerV8ComposableRequestV8(req)),
      { code: 'MAKER_V8_COMPOSABLE_CERTIFICATION_AUTHORITY_DRIFT' });
  });
}

test('certified admission rejects an old request without protocol/replacement inputs', () => {
  const req = structuredClone(request('ADMIT_CERTIFIED'));
  delete req.documentSha256; delete req.inputs.protocolConfig; delete req.inputs.replacement;
  assert.throws(() => buildMakerV8ComposableRequestV8(req), { code: 'MAKER_V8_COMPOSABLE_FIELDS_INVALID' });
});

function absence(transactionDigest, checkpoint = '9') {
  return {
    schemaVersion: 'animacraft.sui-transaction-absence.v8', kind: 'SUI_GRPC_TRANSACTION_NOT_FOUND',
    grpcCode: 'NOT_FOUND', grpcService: 'sui.rpc.v2.LedgerService', grpcMethod: 'GetTransaction',
    requestedDigest: transactionDigest, chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    watermarkEpoch: '1', watermarkCheckpointSequence: checkpoint,
    watermarkCheckpointDigest: suiDigest(Number(checkpoint)),
  };
}

function controllerHarness({ unknown = false, persistence = createMakerV8PackPublicationMemoryPersistenceV8(), accountAddress, startTime = 100, action = 'MINT_ITEM', loadRequest } = {}) {
  const order = [];
  const durableRequest = request(action);
  let queryCount = 0;
  const controller = createMakerV8ComposableControllerV8({
    runtime,
    loadRequest: loadRequest || (async () => durableRequest),
    persistence,
    boundary: {
      async buildExactTransaction({ transaction }) {
        order.push('build');
        transaction.setExpiration({ Epoch: '2' });
        transaction.setGasPrice(1n);
        transaction.setGasBudget(1_000_000n);
        transaction.setGasPayment([{ objectId: gas, version: '1', digest: suiDigest(7) }]);
        const bytes = await transaction.build();
        return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) };
      },
      async dryRunExactTransaction() { order.push('dry-run'); return { status: 'SUCCESS' }; },
      async broadcastExactTransaction({ digest }) { order.push('broadcast'); return { accepted: true, digest }; },
    },
    wallet: {
      async getCurrentAccount() { return { address: accountAddress || durableRequest.signer, network: 'mainnet' }; },
      async signExactTransaction({ bytes, digest, signer: address }) {
        order.push('sign');
        return { bytes, digest, signer: address, signature: toBase64(Uint8Array.of(1, 2, 3)) };
      },
      async verifyExactSignature() { order.push('verify'); return true; },
    },
    rpc: {
      async queryTransaction({ digest: transactionDigest }) {
        order.push('query');
        queryCount += 1;
        if (unknown) throw Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' });
        if (queryCount <= 2) return {
          status: 'NOT_FOUND', digest: transactionDigest, epoch: null, effectsFingerprint: null,
          eventsDigest: null, error: null, absence: absence(transactionDigest, String(8 + queryCount)),
        };
        return {
          status: 'FINALIZED_SUCCESS', digest: transactionDigest, epoch: '2',
          effectsFingerprint: 'aa'.repeat(32), eventsDigest: null, error: null, absence: null,
        };
      },
    },
    certifyFinalized: async ({ request: checked, artifact }) => ({
      schemaVersion: 'animacraft.maker-v8-composable-readback.v1', action: checked.action,
      rootId: checked.product.rootId, productId: checked.product.productId,
      productRef: checked.inputs.product.objectRef, adminCapRef: checked.inputs.adminCap.objectRef,
      itemRef: ref(120), lifecycle: checked.product.sourceLifecycle,
      owner: checked.signer, controlEpoch: checked.product.controlEpoch,
      packRegistryRevision: null, finalizedDigest: artifact.digest,
    }),
    execution: { allowWalletSignature: true, allowBroadcast: true },
    now: (() => { let value = startTime; return () => value += 1; })(),
  });
  return { controller, order, get queryCount() { return queryCount; } };
}

test('Composable writes are durable, query-first and replay only the same signed bytes', async () => {
  const fixture = controllerHarness();
  const staged = await fixture.controller.stage(await fixture.controller.build({}));
  assert.equal(staged.status, 'ACTIVE'); assert.equal(staged.ticket, null);
  assert.deepEqual(fixture.order, [], 'staging only persists; never signs or broadcasts');
  assert.equal((await fixture.controller.list()).rows[0].request.requestId, staged.request.requestId);
  const ticket = await fixture.controller.prepare(fixture.controller.build({}));
  assert.equal(ticket.schemaVersion, MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA);
  const durable = await fixture.controller.load({ requestId: request('MINT_ITEM').requestId, action: 'MINT_ITEM' });
  assert.deepEqual(durable.ticket, ticket);
  const retried = await fixture.controller.prepare(durable.request);
  assert.deepEqual(retried, ticket);
  assert.equal(fixture.order.filter(value => value === 'sign').length, 1);
  const changedSnapshot = structuredClone(durable.request);
  changedSnapshot.inputs.product.objectRef.version = String(Number(changedSnapshot.inputs.product.objectRef.version) + 1);
  delete changedSnapshot.documentSha256;
  await assert.rejects(fixture.controller.prepare(buildMakerV8ComposableRequestV8(changedSnapshot)), { code: 'MAKER_V8_PACK_PUBLICATION_COLLISION' });
  assert.equal(fixture.order.filter(value => value === 'sign').length, 1, 'fresh snapshot cannot mint under another attempt ID');
  const result = await fixture.controller.recover(ticket);
  assert.equal(result.status, 'FINALIZED_SUCCESS');
  assert.equal(result.readback.action, 'MINT_ITEM');
  assert.equal(fixture.queryCount, 3);
  assert.deepEqual(fixture.order, [
    'build', 'dry-run', 'sign', 'verify',
    'query', 'query', 'verify', 'broadcast', 'query', 'verify',
  ]);
});

test('Composable staged requests reopen from IndexedDB without inventory or signing', async () => {
  const idb = new IDBFactory(), options = { storageManager: { persisted: async () => true, persist: async () => true } };
  const first = controllerHarness({ persistence: createMakerV8ComposablePersistenceV8(idb, options) });
  const staged = await first.controller.stage(await first.controller.build({}));
  const second = controllerHarness({ persistence: createMakerV8ComposablePersistenceV8(idb, options), startTime: 200 });
  const listed = await second.controller.list();
  assert.equal(listed.rows.length, 1);
  assert.deepEqual(listed.rows[0], staged);
  assert.deepEqual(second.order, []);
});

test('Composable unknown outcome never fabricates readback or broadcasts', async () => {
  const persistence = createMakerV8PackPublicationMemoryPersistenceV8();
  const fixture = controllerHarness({ unknown: true, persistence });
  const ticket = await fixture.controller.prepare(fixture.controller.build({}));
  const result = await fixture.controller.recover(ticket);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(result.readback, null);
  assert.equal(fixture.order.includes('broadcast'), false);
  const reloaded = controllerHarness({ unknown: true, persistence, startTime: 200 });
  const input = { requestId: request('MINT_ITEM').requestId, action: 'MINT_ITEM' };
  assert.deepEqual((await reloaded.controller.load(input)).ticket, ticket);
  assert.deepEqual(reloaded.order, [], 'restoring a ticket has no signing or network effect');
  assert.equal((await reloaded.controller.recover(ticket)).status, 'OUTCOME_UNKNOWN');
  assert.equal(reloaded.order.includes('sign'), false);
  assert.equal(reloaded.order.includes('broadcast'), false);
  const otherWallet = controllerHarness({ persistence, accountAddress: id(999) });
  assert.equal(await otherWallet.controller.load(input), null);
  assert.deepEqual((await otherWallet.controller.list()).rows, []);
});

function rpcOwner(value) {
  if (value.owner.kind === 'IMMUTABLE') return { Immutable: true };
  return value.owner.kind === 'SHARED'
    ? { Shared: { initial_shared_version: value.owner.initialSharedVersion } }
    : { AddressOwner: value.owner.address };
}

function currentResponse(value) {
  return { data: {
    objectId: value.objectRef.objectId, version: value.objectRef.version, digest: value.objectRef.digest,
    type: value.type, owner: rpcOwner(value),
    content: { dataType: 'moveObject', type: value.type, fields: structuredClone(value.fields) },
  } };
}

function historicalValue(value, parsed = value.fields, transactionDigest = suiDigest(31)) {
  return {
    objectId: value.objectRef.objectId, version: value.objectRef.version, digest: value.objectRef.digest,
    type: value.type, previousTransaction: transactionDigest, parsed: structuredClone(parsed),
    owner: value.owner.kind === 'SHARED'
      ? { Shared: { initial_shared_version: value.owner.initialSharedVersion } }
      : { AddressOwner: value.owner.address },
    contentBcs: Uint8Array.of(1), objectBcs: Uint8Array.of(2),
  };
}

test('production Composable authority cold-reads exact Maker/product control and rejects BCS drift', async () => {
  const checked = request('ADMIT_CERTIFIED');
  const all = Object.values(checked.inputs).filter(Boolean);
  const byId = Object.fromEntries(all.map((value) => [value.objectRef.objectId, value]));
  let drift = false;
  const client = {
    async getObject({ id: objectId }) { return currentResponse(byId[objectId]); },
    async getHistoricalObject({ objectId }) {
      const value = byId[objectId];
      const parsed = structuredClone(value.fields);
      if (drift && objectId === checked.inputs.packRegistry.objectRef.objectId) parsed.revision = '10';
      return historicalValue(value, parsed);
    },
  };
  const load = createMakerV8ComposableAuthorityLoaderV8({
    client, runtime,
    wallet: { async getCurrentAccount() { return { address: signer }; } },
    assertTransport: () => {},
  });
  const raw = {
    action: checked.action, requestId: checked.requestId, rootId: checked.product.rootId,
    productId: checked.product.productId,
    rootObjectId: checked.inputs.root.objectRef.objectId,
    definitionRegistryId: checked.inputs.definitionRegistry.objectRef.objectId,
    packRegistryId: checked.inputs.packRegistry.objectRef.objectId,
    admissionAuthorityId: checked.inputs.admissionAuthority.objectRef.objectId,
    makerAdminId: checked.inputs.makerAdmin.objectRef.objectId,
    payload: emptyPayload(),
  };
  const observed = await load(raw);
  assert.equal(observed.product.packRegistryRevision, '9');
  const ignoredOverrides = await load({ ...raw, protocolConfigId: id(998), replacementBindingId: id(999) });
  assert.equal(ignoredOverrides.inputs.protocolConfig.objectRef.objectId, runtime.protocolConfigId);
  assert.equal(ignoredOverrides.inputs.replacement.objectRef.objectId, makerV8AttestedReplacement(runtime).objectId);
  assert.equal(ignoredOverrides.inputs.replacement.owner.kind, 'IMMUTABLE');
  drift = true;
  await assert.rejects(load(raw), { code: 'MAKER_V8_COMPOSABLE_CURRENT_BCS_DRIFT' });
});

test('admission bridge composes real authority loader and durable controller without mock build replies', async () => {
  const checked = request('ADMIT_CERTIFIED');
  const byId = Object.fromEntries(Object.values(checked.inputs).filter(Boolean).map(value => [value.objectRef.objectId, value]));
  let makerControlMoved = false;
  const readObject = objectId => {
    const value = structuredClone(byId[objectId]);
    if (makerControlMoved && objectId === checked.inputs.makerAdmin.objectRef.objectId) value.owner.address = id(999);
    return value;
  };
  const client = { getObject: async ({ id }) => currentResponse(readObject(id)),
    getHistoricalObject: async ({ objectId }) => { const value = readObject(objectId); return historicalValue(value, value.fields); } };
  const wallet = { getCurrentAccount: async () => ({ address: signer, network: 'mainnet' }), reconnect: async () => ({ address: signer, network: 'mainnet' }) };
  const loadRequest = createMakerV8ComposableAuthorityLoaderV8({ client, runtime, wallet, assertTransport: () => {} });
  const fixture = controllerHarness({ action: 'ADMIT_CERTIFIED', unknown: true, loadRequest });
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  const record = await seedMinimalArtworkDraft(drafts, { draftId: 'admission-integration', name: 'Admission integration' });
  const document = structuredClone(record.document);
  document.composition = { mode: 'COMPOSABLE', thirdPartyAdmission: 'CERTIFIED', itemAssetization: true };
  const rootId = checked.product.rootId;
  const productRuntime = {
    ready: async () => true, wallet,
    inventory: { load: async () => ({ address: signer, status: 'READY', diagnostics: [], items: [
      { kind: 'MAKER_ADMIN', rootId, id: checked.inputs.makerAdmin.objectRef.objectId }] }) },
    catalog: { loadPlaza: async () => ({ status: 'READY', diagnostics: [], makers: [] }),
      loadPlayer: async () => ({ status: 'READY', diagnostics: [], player: { rootId, makerVersion: '1', lifecycle: 'ACTIVE', document,
        evidence: { rootId, makerVersion: '1', contentCommitment: 'a'.repeat(64) }, composableBinding: {
          definitionRegistryId: checked.inputs.definitionRegistry.objectRef.objectId,
          packRegistryId: checked.inputs.packRegistry.objectRef.objectId,
          admissionAuthorityId: checked.inputs.admissionAuthority.objectRef.objectId } } }) },
  };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, composable: fixture.controller,
    execution: { allowWalletSignature: true, allowBroadcast: true } });
  try {
    const reviewed = await bridge.reviewComposableAdmission({ rootId, productId: checked.product.productId, action: 'ADMIT_CERTIFIED' });
    assert.equal(reviewed.product.packRegistryRevision, '9');
    assert.equal(reviewed.inputs.protocolConfig.objectRef.objectId, runtime.protocolConfigId);
    const staged = await bridge.stageComposableOperation(reviewed);
    assert.equal(staged.ticket, null); assert.deepEqual(fixture.order, []);
    const identity = { requestId: reviewed.requestId, action: reviewed.action };
    await bridge.continueComposableOperation({ ...identity, mode: 'SIGN' });
    const saved = (await bridge.listComposableOperations()).rows[0];
    assert.ok(saved.ticket); assert.equal(saved.status, 'ACTIVE');
    await assert.rejects(bridge.continueComposableOperation({ ...identity, mode: 'SIGN' }), { code: 'MAKER_V8_COMPOSABLE_TICKET_DRIFT' });
    assert.equal((await bridge.continueComposableOperation({ ...identity, mode: 'RECOVER' })).status, 'OUTCOME_UNKNOWN');
    assert.equal(fixture.order.filter(value => value === 'sign').length, 1);
    assert.equal(fixture.order.includes('broadcast'), false);
    makerControlMoved = true;
    await assert.rejects(bridge.reviewComposableAdmission({ rootId, productId: checked.product.productId, action: 'ADMIT_CERTIFIED' }),
      { code: 'MAKER_V8_COMPOSABLE_MAKER_ADMIN_DRIFT' });
    assert.equal(fixture.order.filter(value => value === 'sign').length, 1, 'stale inventory cannot authorize another operation');
  } finally { bridge.dispose(); drafts.close(); }
});

test('Product management bridge stages real authority-built lifecycle and transfer requests', async () => {
  for (const action of ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL']) {
    const checked = request(action);
    const lifecycle = action === 'RESUME_PRODUCT' ? 1 : 0;
    const byId = Object.fromEntries(Object.values(checked.inputs).filter(Boolean).map(value => [value.objectRef.objectId, structuredClone(value)]));
    byId[checked.product.productId].fields.lifecycle = String(lifecycle);
    const client = { getObject: async ({ id }) => currentResponse(byId[id]),
      getHistoricalObject: async ({ objectId }) => historicalValue(byId[objectId], byId[objectId].fields) };
    const wallet = { getCurrentAccount: async () => ({ address: signer, network: 'mainnet' }), reconnect: async () => ({ address: signer, network: 'mainnet' }) };
    const loadRequest = createMakerV8ComposableAuthorityLoaderV8({ client, runtime, wallet, assertTransport: () => {} });
    const fixture = controllerHarness({ action, unknown: true, loadRequest });
    const drafts = createMakerV8DraftPersistence(new IDBFactory());
    const productRuntime = { wallet, ready: async () => true,
      catalog: { loadPlayer: async () => assert.fail('no Maker draft authority'), loadPlaza: async () => assert.fail('no catalog needed') },
      inventory: { load: async () => ({ address: signer, status: 'READY', diagnostics: [], items: [{ kind: 'EXTERNAL_PRODUCT_CONTROL',
        id: checked.product.productId, rootId: checked.product.rootId, lifecycle,
        objectIds: [checked.product.productId, checked.product.adminCapId] }] }) } };
    const bridge = createMakerV8ProductBridge({ productRuntime, drafts, composable: fixture.controller });
    try {
      const reviewed = await bridge.reviewComposableProduct({ productId: checked.product.productId, action,
        ...(action === 'TRANSFER_CONTROL' ? { recipient } : {}) });
      assert.equal(reviewed.action, action);
      assert.equal(reviewed.product.sourceLifecycle, lifecycle);
      assert.equal(reviewed.inputs.adminCap.objectRef.objectId, checked.product.adminCapId);
      if (action === 'TRANSFER_CONTROL') assert.equal(reviewed.payload.recipient, recipient);
      const saved = await bridge.stageComposableOperation(reviewed);
      assert.equal(saved.ticket, null); assert.deepEqual(fixture.order, []);
      await assert.rejects(bridge.continueComposableOperation({ requestId: reviewed.requestId, action, mode: 'SIGN' }), { code: 'MAKER_V8_PRODUCT_EXECUTION_DISABLED' });
    } finally { bridge.dispose(); drafts.close(); }
  }
});

test('external admission readback binds raw event BCS, effects and historical registry revision', async () => {
  const checked = request('ADMIT_OPEN');
  const transactionDigest = suiDigest(33);
  const registryRef = { objectId: checked.inputs.packRegistry.objectRef.objectId, version: '200', digest: suiDigest(20) };
  const post = structuredClone(checked.inputs.packRegistry.fields);
  post.revision = '10';
  const eventBytes = bcs.struct('PackRegistryRevisionAdvancedV8', {
    root_id: bcs.Address, previous_revision: bcs.u64(), revision: bcs.u64(),
    subject_id: bcs.Address, operation: bcs.u8(),
  }).serialize({ root_id: checked.product.rootId, previous_revision: 9n, revision: 10n, subject_id: checked.product.productId, operation: 2 }).toBytes();
  const response = {
    compilerTransactionKindProof: { transactionKindSha256: 'a'.repeat(64) },
    objectChanges: [{ type: 'mutated', ...registryRef, objectType: types.packRegistry }],
    compilerEffectsOutputRefs: [{ ...registryRef, owner: { kind: 'Shared', value: '4' } }],
    events: [{
      type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackRegistryRevisionAdvancedV8`,
      sender: signer, bcs: toBase64(eventBytes),
      parsedJson: { root_id: checked.product.rootId, previous_revision: '9', revision: '10', subject_id: checked.product.productId, operation: '2' },
    }],
  };
  const certify = createMakerV8ComposableReadbackV8({
    client: { async getHistoricalObject() { return {
      ...registryRef, previousTransaction: transactionDigest, type: types.packRegistry,
      owner: { Shared: { initial_shared_version: '4' } }, parsed: post,
      contentBcs: Uint8Array.of(3), objectBcs: Uint8Array.of(4),
    }; } },
    runtime, readFinalized: async () => response, assertTransport: () => {},
  });
  const result = await certify({
    request: checked, artifact: { digest: transactionDigest }, transaction: {},
    descriptor: { kindSha256: 'a'.repeat(64) },
  });
  assert.equal(result.packRegistryRevision, '10');
});

function finalizedObject(refValue, type, parsed, owner, transactionDigest) {
  return {
    ...refValue,
    previousTransaction: transactionDigest,
    type,
    owner,
    parsed: structuredClone(parsed),
    contentBcs: Uint8Array.of(5),
    objectBcs: Uint8Array.of(6),
  };
}

function finalizedResponse(kindSha256, entries, events = []) {
  return {
    compilerTransactionKindProof: { transactionKindSha256: kindSha256 },
    objectChanges: entries.map(({ change, ref: objectRef, type }) => ({
      type: change,
      objectId: objectRef.objectId,
      version: objectRef.version,
      digest: objectRef.digest,
      objectType: type,
    })),
    compilerEffectsOutputRefs: entries.map(({ ref: objectRef }) => ({
      ...objectRef,
      owner: { kind: 'AddressOwner', value: signer },
    })),
    events,
  };
}

async function certifyComposableFixture(checked, response, history, transactionDigest, kindSha256) {
  const certify = createMakerV8ComposableReadbackV8({
    client: {
      async getHistoricalObject({ objectId }) {
        const value = history[objectId];
        assert.ok(value, `missing historical fixture ${objectId}`);
        return value;
      },
    },
    runtime,
    readFinalized: async () => response,
    assertTransport: () => {},
  });
  return certify({
    request: checked,
    artifact: { digest: transactionDigest },
    transaction: {},
    descriptor: { kindSha256 },
  });
}

test('external product creation certifies exact shared custody and the transferred admin cap', async () => {
  const checked = request('CREATE_PRODUCT');
  const transactionDigest = suiDigest(34);
  const kindSha256 = 'b'.repeat(64);
  const productRef = { objectId: id(130), version: '130', digest: suiDigest(34) };
  const capRef = { objectId: id(131), version: '131', digest: suiDigest(35) };
  const productFields = {
    id: productRef.objectId,
    version: '8',
    root_id: checked.product.rootId,
    root_version: '1',
    root_content_commitment: [...new Uint8Array(32)],
    creator: signer,
    owner: signer,
    control_epoch: '0',
    admin_cap_id: capRef.objectId,
    lifecycle: '0',
    part_key: checked.payload.partKey,
    item_key: checked.payload.itemKey,
    style_key: checked.payload.styleKey,
    layer_track_key: checked.payload.layerTrackKey,
    color_channel_key: { vec: [] },
    default_swatch_key: { vec: [] },
    asset_blob_id: checked.payload.assetBlobId,
    asset_sha256: [...new Uint8Array(32)],
    asset_media_type: checked.payload.assetMediaType,
    asset_byte_length: checked.payload.assetByteLength,
    asset_content_commitment: [...new Uint8Array(32)],
    compatibility_commitment: [...new Uint8Array(32)],
    content_commitment: [...new Uint8Array(32)],
    transferable: true,
    supply: '0',
  };
  const capFields = {
    id: capRef.objectId,
    version: '8',
    product_id: productRef.objectId,
    owner: signer,
    control_epoch: '0',
  };
  const entries = [
    { change: 'created', ref: productRef, type: types.externalItemProduct },
    { change: 'created', ref: capRef, type: types.externalItemAdminCap },
  ];
  const response = finalizedResponse(kindSha256, entries);
  const history = {
    [productRef.objectId]: finalizedObject(
      productRef,
      types.externalItemProduct,
      productFields,
      { Shared: { initial_shared_version: productRef.version } },
      transactionDigest,
    ),
    [capRef.objectId]: finalizedObject(
      capRef,
      types.externalItemAdminCap,
      capFields,
      { AddressOwner: signer },
      transactionDigest,
    ),
  };
  const result = await certifyComposableFixture(checked, response, history, transactionDigest, kindSha256);
  assert.equal(result.productId, productRef.objectId);
  assert.deepEqual(result.adminCapRef, capRef);

  history[capRef.objectId].owner = { AddressOwner: recipient };
  await assert.rejects(
    certifyComposableFixture(checked, response, history, transactionDigest, kindSha256),
    { code: 'MAKER_V8_COMPOSABLE_CUSTODY_DRIFT' },
  );
});

test('external product control transfer certifies both state fields and actual object custody', async () => {
  const checked = request('TRANSFER_CONTROL');
  const transactionDigest = suiDigest(36);
  const kindSha256 = 'c'.repeat(64);
  const productRef = { objectId: checked.product.productId, version: '140', digest: suiDigest(36) };
  const capRef = { objectId: checked.product.adminCapId, version: '141', digest: suiDigest(37) };
  const productFields = structuredClone(checked.inputs.product.fields);
  productFields.owner = recipient;
  productFields.control_epoch = '1';
  const capFields = structuredClone(checked.inputs.adminCap.fields);
  capFields.owner = recipient;
  capFields.control_epoch = '1';
  const entries = [
    { change: 'mutated', ref: productRef, type: types.externalItemProduct },
    { change: 'mutated', ref: capRef, type: types.externalItemAdminCap },
  ];
  const response = finalizedResponse(kindSha256, entries);
  const history = {
    [productRef.objectId]: finalizedObject(
      productRef,
      types.externalItemProduct,
      productFields,
      { Shared: { initial_shared_version: checked.inputs.product.owner.initialSharedVersion } },
      transactionDigest,
    ),
    [capRef.objectId]: finalizedObject(
      capRef,
      types.externalItemAdminCap,
      capFields,
      { AddressOwner: recipient },
      transactionDigest,
    ),
  };
  const result = await certifyComposableFixture(checked, response, history, transactionDigest, kindSha256);
  assert.equal(result.owner, recipient);
  assert.equal(result.controlEpoch, '1');

  history[capRef.objectId].owner = { AddressOwner: signer };
  await assert.rejects(
    certifyComposableFixture(checked, response, history, transactionDigest, kindSha256),
    { code: 'MAKER_V8_COMPOSABLE_CUSTODY_DRIFT' },
  );
});

test('external item mint certifies product supply, content commitments, holder and actual custody', async () => {
  const checked = request('MINT_ITEM');
  const transactionDigest = suiDigest(38);
  const kindSha256 = 'd'.repeat(64);
  const productRef = { objectId: checked.product.productId, version: '150', digest: suiDigest(38) };
  const itemRef = { objectId: id(151), version: '151', digest: suiDigest(39) };
  const productFields = structuredClone(checked.inputs.product.fields);
  productFields.supply = '1';
  const itemFields = {
    id: itemRef.objectId,
    version: '8',
    product_id: checked.product.productId,
    product_content_commitment: structuredClone(productFields.content_commitment),
    asset_content_commitment: structuredClone(productFields.asset_content_commitment),
    holder: recipient,
    ownership_epoch: '0',
    transferable: productFields.transferable,
  };
  const entries = [
    { change: 'mutated', ref: productRef, type: types.externalItemProduct },
    { change: 'created', ref: itemRef, type: types.ownedExternalItem },
  ];
  const response = finalizedResponse(kindSha256, entries);
  const history = {
    [productRef.objectId]: finalizedObject(
      productRef,
      types.externalItemProduct,
      productFields,
      { Shared: { initial_shared_version: checked.inputs.product.owner.initialSharedVersion } },
      transactionDigest,
    ),
    [itemRef.objectId]: finalizedObject(
      itemRef,
      types.ownedExternalItem,
      itemFields,
      { AddressOwner: recipient },
      transactionDigest,
    ),
  };
  const result = await certifyComposableFixture(checked, response, history, transactionDigest, kindSha256);
  assert.deepEqual(result.itemRef, itemRef);

  history[itemRef.objectId].owner = { AddressOwner: signer };
  await assert.rejects(
    certifyComposableFixture(checked, response, history, transactionDigest, kindSha256),
    { code: 'MAKER_V8_COMPOSABLE_CUSTODY_DRIFT' },
  );
});
