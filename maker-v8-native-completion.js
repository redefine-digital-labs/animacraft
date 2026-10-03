/** Native Soul Complete data/ABI helpers. No deployment defaults or live authority. */
import { MAKER_V8_PUBLIC_PREVIEW_KEY, decodeMakerV8PublicPreviewV8 } from './maker-v8-public-preview.js';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils';
import { fromHex } from '@mysten/sui/utils';
import { deriveMakerV8NativeContentIdV8 } from './maker-v8-native-content-identity.js';
import { decodeContentEnvelope } from './maker-v8-native-envelope-codec.js';

export const MAKER_V8_NATIVE_KIOSK_ITEM_KEY_TYPE = normalizeStructTag('0x2::dynamic_object_field::Wrapper<0x2::kiosk::Item>');
export const MAKER_V8_NATIVE_KIOSK_ITEM_TYPE = normalizeStructTag(`0x2::dynamic_field::Field<${MAKER_V8_NATIVE_KIOSK_ITEM_KEY_TYPE},0x2::object::ID>`);
// Field<Wrapper<Item>, ID>: UID, Wrapper.name.Item.id, value.ID (three addresses).
const KIOSK_ITEM_BCS = bcs.struct('NativeKioskItemField', {
  id: bcs.Address, keyId: bcs.Address, valueId: bcs.Address,
});
const ID = /^0x[0-9a-f]{64}$/;
function invalid(message) {
  const error = new Error(message);
  error.code = 'MAKER_V8_NATIVE_COMPLETION_INVALID';
  throw error;
}
function exact(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) invalid(`${label} has invalid fields.`);
}
function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || /^0x0+$/.test(value)) invalid(`${label} requires an exact nonzero object ID.`);
}
function text(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > limit) invalid(`${label} is empty or exceeds its UTF-8 limit.`);
}

export function deriveMakerV8NativeKioskItemIdV8(kioskId, soulId) {
  id(kioskId, 'Kiosk'); id(soulId, 'Soul');
  return deriveDynamicFieldID(kioskId, MAKER_V8_NATIVE_KIOSK_ITEM_KEY_TYPE, bcs.Address.serialize(soulId).toBytes());
}

function assertKioskItem(row, kioskId, soulId) {
  const fieldId = deriveMakerV8NativeKioskItemIdV8(kioskId, soulId);
  if (row.type !== MAKER_V8_NATIVE_KIOSK_ITEM_TYPE || row.change !== 'created'
    || row.objectId !== fieldId || row.owner?.kind !== 'ObjectOwner' || row.owner.value !== kioskId) {
    invalid('Native Kiosk wrapper has the wrong exact type, creation, derived UID or parent.');
  }
  let raw; let decoded;
  try {
    raw = fromBase64(row.contentBcsBase64);
    decoded = KIOSK_ITEM_BCS.parse(raw);
  } catch { invalid('Native Kiosk wrapper requires canonical 96-byte BCS.'); }
  if (raw.length !== 96 || toBase64(raw) !== row.contentBcsBase64
    || KIOSK_ITEM_BCS.serialize(decoded).toBase64() !== row.contentBcsBase64
    || decoded.id !== fieldId || decoded.keyId !== soulId || decoded.valueId !== soulId
    || row.fields?.id !== decoded.id || row.fields?.keyId !== decoded.keyId || row.fields?.valueId !== decoded.valueId) {
    invalid('Native Kiosk wrapper BCS UID, Item key or ID value differs from this Soul.');
  }
  return true;
}

function historicalKioskItemUnavailable(ref, status, cause = null) {
  const error = new Error('Native Kiosk wrapper historical version is unavailable; retry against an archival Sui Mainnet gRPC endpoint.');
  error.code = 'MAKER_V8_BROWSER_READBACK_UNAVAILABLE';
  error.layer = 'READBACK';
  error.retryable = true;
  error.details = { retryable: true, archivalRpcRequired: true, objectId: ref.objectId,
    version: String(ref.version), status, cause };
  throw error;
}

/** Read only the created, effects-matched wrapper version; latest custody may already have changed. */
export async function readMakerV8NativeKioskItemV8({ client, response, kioskId, soulId, transactionDigest }) {
  const fieldId = deriveMakerV8NativeKioskItemIdV8(kioskId, soulId);
  const changes = (response.objectChanges ?? []).filter(change => change.objectId === fieldId);
  const refs = (response.compilerEffectsOutputRefs ?? []).filter(ref => ref.objectId === fieldId);
  if (changes.length !== 1 || refs.length !== 1 || changes[0].type !== 'created'
    || normalizeStructTag(changes[0].objectType) !== MAKER_V8_NATIVE_KIOSK_ITEM_TYPE
    || String(changes[0].version) !== String(refs[0].version) || changes[0].digest !== refs[0].digest
    || refs[0].owner?.kind !== 'ObjectOwner' || refs[0].owner.value !== kioskId) {
    invalid('Native Kiosk wrapper lacks an exact created TransactionEffects reference.');
  }
  const ref = refs[0];
  if (typeof client?.getHistoricalObject !== 'function') historicalKioskItemUnavailable(ref, 'METHOD_UNAVAILABLE');
  let object;
  try { object = await client.getHistoricalObject({ objectId: fieldId, version: BigInt(ref.version) }); }
  catch (error) { historicalKioskItemUnavailable(ref, 'GRPC_ERROR', String(error?.message || error)); }
  const owner = object?.owner;
  const ownerKind = owner?.$kind ?? owner?.kind ?? (owner?.ObjectOwner ? 'ObjectOwner' : null);
  const ownerId = owner?.ObjectOwner ?? owner?.value;
  if (object?.objectId !== fieldId || String(object.version) !== String(ref.version) || object.digest !== ref.digest
    || object.previousTransaction !== transactionDigest || normalizeStructTag(object.type) !== MAKER_V8_NATIVE_KIOSK_ITEM_TYPE
    || ownerKind !== 'ObjectOwner' || ownerId !== kioskId
    || !(object.contentBcs instanceof Uint8Array) || !(object.objectBcs instanceof Uint8Array)) {
    invalid('Native Kiosk wrapper historical object differs from its effects-bound creation.');
  }
  let fields;
  try { fields = KIOSK_ITEM_BCS.parse(object.contentBcs); }
  catch { invalid('Native Kiosk wrapper requires canonical 96-byte BCS.'); }
  const row = { type: MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, change: 'created', objectId: fieldId,
    version: String(ref.version), digest: ref.digest, owner: { kind: 'ObjectOwner', value: kioskId },
    fields, contentBcsBase64: toBase64(object.contentBcs) };
  assertKioskItem(row, kioskId, soulId);
  return row;
}

export function assertMakerV8NativeCompletionInputV8(value) {
  exact(value, ['name', 'description', 'initialContent', 'initialStateConfig', 'currentKioskId', 'currentKioskCapOnChainId', 'mintNonce', 'expectedContentObjectId'], 'nativeSoul');
  if (typeof value.mintNonce !== 'string' || !/^[0-9a-f]{32}$/.test(value.mintNonce)) invalid('Mint nonce requires exactly 16 hexadecimal bytes.');
  id(value.expectedContentObjectId, 'Predicted SoulContent');
  text(value.name, 256, 'Soul name');
  if (typeof value.description !== 'string' || new TextEncoder().encode(value.description).length > 4096) invalid('Soul description exceeds its UTF-8 limit.');
  if ((value.currentKioskId === null) !== (value.currentKioskCapOnChainId === null)) invalid('Kiosk and personal cap must be supplied together.');
  if (value.currentKioskId !== null) {
    id(value.currentKioskId, 'Kiosk'); id(value.currentKioskCapOnChainId, 'Kiosk cap');
  }
  if (!Array.isArray(value.initialContent) || !Array.isArray(value.initialStateConfig)) invalid('Native content and state config must be arrays.');
  let soulCount = 0; let memoryCount = 0;
  const blobs = new Set();
  const versions = new Map();
  for (const row of value.initialContent) {
    exact(row, ['kind', 'name', 'slotReadModeMask', 'downloadPolicy', 'setActive', 'blobObjectId', 'expectedVersionIndex', 'encryptedEnvelope'], 'initialContent entry');
    // Current native app supports built-ins only. Custom kind UI must first
    // provide descriptor history for its cached permissions before signing.
    if (!Number.isSafeInteger(row.kind) || row.kind < 0 || row.kind > 4
      || !Number.isSafeInteger(row.slotReadModeMask) || row.slotReadModeMask < 0
      || typeof row.setActive !== 'boolean'
      || !['public', 'owner_only', 'allowlist'].includes(row.downloadPolicy)) invalid('Invalid typed native content policy.');
    text(row.name, Infinity, 'Content name'); id(row.blobObjectId, 'Content Blob');
    const slot = JSON.stringify([row.kind, row.name]); const next = versions.get(slot) ?? 0;
    if (row.expectedVersionIndex !== String(next)) invalid('Initial versions must follow the exact per-slot zero-based order.');
    versions.set(slot, next + 1);
    if (typeof row.encryptedEnvelope !== 'string' || !row.encryptedEnvelope.length
      || new TextEncoder().encode(row.encryptedEnvelope).length > 65536) invalid('Initial envelope requires 1..65536 UTF-8 bytes.');
    if (blobs.has(row.blobObjectId)) invalid('One owned Blob cannot be consumed twice.');
    blobs.add(row.blobObjectId);
    if (row.kind === 0 || row.kind === 1) {
      if (row.name !== (row.kind === 0 ? 'soul' : 'default') || row.slotReadModeMask !== 3
        || row.downloadPolicy !== 'public' || row.setActive) invalid('SOUL_DOC/MEMORY must retain native mint invariants.');
      if (row.kind === 0) soulCount++; else memoryCount++;
    }
  }
  if (soulCount !== 1 || memoryCount < 1) invalid('Native mint requires exactly one SOUL_DOC and at least one MEMORY Blob.');
  const keys = new Set();
  for (const row of value.initialStateConfig) {
    exact(row, ['key', 'valueUtf8'], 'initialStateConfig entry');
    text(row.key, Infinity, 'State config key');
    if (keys.has(row.key) || row.key.startsWith('content_seal_envelope_v1:') || typeof row.valueUtf8 !== 'string'
      || new TextEncoder().encode(row.valueUtf8).length > 65536) invalid('Invalid or duplicate state config entry.');
    if (row.key === MAKER_V8_PUBLIC_PREVIEW_KEY) decodeMakerV8PublicPreviewV8(row.valueUtf8);
    keys.add(row.key);
  }
  return value;
}

/** Objects are supplied by the caller's live-certified custody reader. */
export function appendMakerV8NativeCompletionV8({ transaction: tx, targets, config, input,
  objects, authorization, paymentCoinType, objectArgument }) {
  assertMakerV8NativeCompletionInputV8(input);
  if (deriveMakerV8NativeContentIdV8(config, tx.getData().sender, input.mintNonce) !== input.expectedContentObjectId) invalid('Predicted SoulContent differs from the signed author and registry.');
  for (const entry of input.initialContent) decodeContentEnvelope(entry.encryptedEnvelope,
    { contentObjectId: input.expectedContentObjectId, kind: entry.kind, name: entry.name,
      versionIndex: entry.expectedVersionIndex, blobObjectId: entry.blobObjectId }, config.soulidityOriginalPackageId);
  const call = (packageId, moduleName, fn, args, typeArguments = []) => {
    const target = `0x${packageId.slice(2).padStart(64, '0')}::${moduleName}::${fn}`;
    targets.push(target);
    return tx.moveCall({ target, arguments: args, typeArguments });
  };
  const pkg = config.soulidityCallablePackageId;
  let kiosk; let cap;
  if (input.currentKioskId === null) {
    const created = call('0x2', 'kiosk', 'new', []);
    kiosk = created[0];
    cap = call(config.kioskPackageId, 'personal_kiosk', 'new', [kiosk, created[1]])[0];
  } else {
    kiosk = objectArgument(objects.kiosk, true);
    cap = objectArgument(objects.personalKioskCap);
  }
  call(pkg, 'market', 'ensure_personal_kiosk_registered_v2', [
    objectArgument(objects.marketConfig), objectArgument(objects.kioskRegistry, true), cap,
  ]);
  const content = input.initialContent.map((entry, index) => call(pkg, 'market', 'new_initial_content_entry', [
    tx.pure.u32(entry.kind), tx.pure.string(entry.name), tx.pure.u64(entry.slotReadModeMask),
    tx.pure.u8(['public', 'owner_only', 'allowlist'].indexOf(entry.downloadPolicy)),
    tx.pure.bool(entry.setActive), objectArgument(objects.contentBlobs[index], true),
    tx.pure.u64(entry.expectedVersionIndex), tx.pure.vector('u8', [...new TextEncoder().encode(entry.encryptedEnvelope)]),
  ]));
  const stateConfig = input.initialStateConfig.map((entry) => call(pkg, 'market', 'new_state_config_entry', [
    tx.pure.string(entry.key), tx.pure.vector('u8', [...new TextEncoder().encode(entry.valueUtf8)]),
  ]));
  const state = call(pkg, 'market', 'mint_animacraft_v8_in_personal_kiosk', [
    objectArgument(objects.marketConfig), objectArgument(objects.kindRegistry),
    objectArgument(objects.kioskRegistry, true), objectArgument(objects.soulTransferPolicy), kiosk, cap,
    objectArgument(objects.root), objectArgument(objects.protocolConfig),
    objectArgument(objects.outputRegistry, true), objectArgument(objects.soulRegistry, true), authorization,
    tx.pure.string(input.name), tx.pure.string(input.description),
    tx.makeMoveVec({ type: `${config.soulidityOriginalPackageId}::market::InitialContentEntry`, elements: content }),
    tx.makeMoveVec({ type: `${config.soulidityOriginalPackageId}::market::StateConfigEntry`, elements: stateConfig }),
    tx.pure.vector('u8', [...fromHex(input.mintNonce)]), tx.pure.address(input.expectedContentObjectId), objectArgument(objects.clock),
  ], [paymentCoinType]);
  call(pkg, 'market', 'finalize_soul_state', [state]);
  if (input.currentKioskId === null) {
    call('0x2', 'transfer', 'public_share_object', [kiosk], ['0x2::kiosk::Kiosk']);
    call(config.kioskPackageId, 'personal_kiosk', 'transfer_to_sender', [cap]);
  }
}

export const MAKER_V8_NATIVE_BINDING_FIELDS = Object.freeze([
  'version', 'protocolConfigId', 'soulRegistryId', 'soulId', 'soulStateId', 'rootId',
  'makerVersion', 'rootContentCommitment', 'makerCreator', 'makerTreasuryId',
  'originalHolder', 'outputId', 'receiptId', 'outputKey', 'outputPolicyCommitment',
  'recipeCommitment', 'renderCommitment', 'outputCommitment', 'receiptCommitment',
  'rights', 'authorizationCommitment',
]);
export const MAKER_V8_NATIVE_SOUL_FIELDS = Object.freeze([
  'version', 'name', 'description', 'imageUrl', 'provenanceKind', 'originRef', 'creator',
]);
export const MAKER_V8_NATIVE_STATE_FIELDS = Object.freeze([
  'version', 'soulId', 'creator', 'creatorRoyaltyBps', 'currentOwner', 'currentKioskId',
  'ownershipEpoch', 'grantCapacity', 'activeGrants', 'activeGrantIds', 'activeGrantCount',
  'contentId', 'configExt', 'collectionId', 'accessListId', 'isListed',
]);

/** Checks historical, effects-bound ownership; never consults today's owner. */
export function assertMakerV8NativeCompleteObjectsV8({ record, outputs, types }) {
  const get = (type) => {
    const rows = outputs.filter((row) => row.type === type);
    if (rows.length !== 1 || rows[0].change !== 'created') invalid('Native Complete requires one newly created object per exact type.');
    return rows[0];
  };
  const soul = get(types.nativeSoul); const state = get(types.nativeSoulState);
  const binding = get(types.nativeSoulBinding);
  const output = get(types.completeOutput); const receipt = get(types.completeReceipt);
  const kioskItem = get(MAKER_V8_NATIVE_KIOSK_ITEM_TYPE);
  if (outputs.length !== 6) invalid('Native Complete must contain six exact evidence objects including Kiosk custody.');
  const b = binding.fields; const s = state.fields; const n = soul.fields;
  const expected = record.plan.descriptor.expected.nativeSoul;
  const input = record.input.nativeSoul;
  if (!expected || !input) invalid('Native Complete signed expectations are missing.');
  assertKioskItem(kioskItem, s.currentKioskId, soul.objectId);
  for (const row of [binding, output, receipt]) {
    if (row.owner?.kind !== 'Immutable') invalid('Complete provenance must be immutable.');
  }
  if (state.owner?.kind !== 'Shared' || soul.owner?.kind !== 'ObjectOwner'
    || soul.owner.value !== kioskItem.objectId
    || input.currentKioskId !== null && input.currentKioskId !== s.currentKioskId
    || s.currentOwner !== record.plan.signer || s.creator !== record.plan.signer
    || String(s.ownershipEpoch) !== '0' || s.isListed !== false
    || s.contentId !== input.expectedContentObjectId
    || s.soulId !== soul.objectId || b.soulId !== soul.objectId || b.soulStateId !== state.objectId) invalid('Native Soul/State ownership or exact binding differs from this mint.');
  if (n.name !== input.name || n.description !== input.description
    || n.imageUrl !== `walrus://${record.input.render.blobId}` || Number(n.provenanceKind) !== 3
    || n.creator !== record.plan.signer) invalid('Native Soul metadata differs from signed Complete input.');
  if (b.protocolConfigId !== expected.protocolConfigId || b.soulRegistryId !== expected.soulRegistryId
    || b.rootId !== record.playerIdentity.rootId || String(b.makerVersion) !== record.playerIdentity.makerVersion
    || b.rootContentCommitment !== record.playerIdentity.rootContentCommitment
    || b.originalHolder !== record.plan.signer || b.outputId !== output.objectId || b.receiptId !== receipt.objectId
    || b.outputKey !== record.loadout.outputKey || !/^[0-9a-f]{64}$/.test(b.authorizationCommitment)) invalid('Native immutable binding differs from exact signed authority.');
  for (const key of ['recipeCommitment', 'renderCommitment', 'outputCommitment', 'outputPolicyCommitment']) {
    if (b[key] !== output.fields[key] || b[key] !== receipt.fields[key]) invalid(`Native binding ${key} differs from original Complete evidence.`);
  }
  if (b.receiptCommitment !== receipt.fields.receiptCommitment) invalid('Native receipt commitment drift.');
  return true;
}
