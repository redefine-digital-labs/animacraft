import { Transaction } from '@mysten/sui/transactions';
import { hydrateTrustedMakerComposableV6Catalog } from './maker-composable-player-v6-hydration.js';
import {
  MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS,
  beginMakerComposableV6PlayerAction,
  buildMakerComposableV6PlayerActionPlan,
  confirmMakerComposableV6PlayerAction,
  createMakerComposableV6PlayerCheckpoint,
  hydrateMakerComposableV6PlayerCheckpoint,
  markMakerComposableV6PlayerSubmitted,
  recordMakerComposableV6PlayerError,
} from './maker-composable-player-v6.js';
import {
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  createItemEntitlementV6,
} from './maker-composable-v6.js';

const SUI_ID = /^0x[0-9a-f]+$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const MAX_TABLE_ROWS = 2_000;
const CHECKPOINT_PREFIX = 'animacraft:composable-player-v6:';

export class MakerComposablePlayerV6AppError extends Error {
  constructor(message, code = 'COMPOSABLE_PLAYER_V6_APP_ERROR', details = {}) {
    super(message);
    this.name = 'MakerComposablePlayerV6AppError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerComposablePlayerV6AppError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return structuredClone(value);
}

function field(fields, ...names) {
  for (const name of names) if (fields?.[name] !== undefined) return fields[name];
  return undefined;
}

function fields(value) {
  const json = object(value?.json);
  const source = Object.keys(json).length ? json : object(value);
  return object(source.fields && typeof source.fields === 'object' ? source.fields : source);
}

function id(value) {
  if (typeof value === 'string') return SUI_ID.test(value.trim()) ? value.trim().toLowerCase() : '';
  if (Array.isArray(value)) return value.map(id).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  const source = object(value);
  const nested = source.id || source.bytes || source.address || source.fields || source.vec || source.some;
  return nested === undefined ? '' : id(nested);
}

function string(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const source = object(value);
  const nested = source.value || source.bytes || source.fields || source.vec?.[0];
  return nested === undefined ? '' : string(nested);
}

function bool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  // Missing/invalid chain fields must stay invalid. Coercing them to false
  // would let an absent `transferable: false` or profile flag match a
  // false-valued manifest during trusted hydration.
  return undefined;
}

function number(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function atomic(value) {
  if (value === undefined || value === null || value === '') return '';
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function hex(value) {
  if (typeof value === 'string') {
    const normalized = value.replace(/^0x/i, '').toLowerCase();
    return HASH.test(normalized) ? normalized : '';
  }
  const bytes = Array.isArray(value)
    ? value
    : array(object(value).bytes || object(value).vec || object(value).fields);
  if (bytes.length !== 32 || bytes.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) return '';
  return bytes.map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function releaseOpen(runtime) {
  return runtime?.compositionV6ReleaseEnabled === true;
}

async function getObjects(client, objectIds) {
  const ids = [...new Set(objectIds.map(id).filter(Boolean))];
  if (!ids.length) return [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 50) batches.push(ids.slice(index, index + 50));
  const pages = await Promise.all(batches.map((batch) => client.getObjects({
    objectIds: batch,
    include: { json: true, previousTransaction: true },
  })));
  return pages.flatMap((page) => array(page?.objects)).filter((entry) => entry && !entry.error);
}

async function scanTable(client, tableId) {
  const parentId = id(tableId);
  if (!parentId) fail('COMPOSABLE_PLAYER_V6_TABLE_MISSING', 'A required v6 Table object ID is missing.');
  const rows = [];
  let cursor = null;
  do {
    const page = await client.listDynamicFields({
      parentId,
      cursor,
      limit: 50,
      include: { value: true },
    });
    rows.push(...array(page?.dynamicFields));
    if (rows.length > MAX_TABLE_ROWS) {
      fail('COMPOSABLE_PLAYER_V6_TABLE_LIMIT', 'A v6 table exceeded the bounded Player query limit.', { parentId });
    }
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor);
  const missing = rows.filter((row) => !row?.value?.json).map((row) => id(row?.fieldId)).filter(Boolean);
  const wrappers = new Map((await getObjects(client, missing)).map((entry) => [id(entry.objectId || entry.id), entry]));
  return rows.map((row) => {
    const wrapper = wrappers.get(id(row?.fieldId));
    const wrapperFields = fields(wrapper || row?.value || row);
    return {
      fieldId: id(row?.fieldId || wrapper?.objectId || wrapper?.id),
      name: field(wrapperFields, 'name') ?? row?.name?.json ?? row?.name,
      value: field(wrapperFields, 'value') ?? row?.value?.json ?? row?.value,
    };
  });
}

function normalizeProfile(value, objectId) {
  const source = fields(value);
  return {
    id: id(objectId || field(source, 'id')),
    rootId: id(field(source, 'root_id', 'rootId')),
    mode: number(field(source, 'mode')),
    loadoutMutable: bool(field(source, 'loadout_mutable', 'loadoutMutable')),
    itemAssetization: bool(field(source, 'item_assetization', 'itemAssetization')),
    thirdPartyPolicy: number(field(source, 'third_party_policy', 'thirdPartyPolicy')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rendererCommitment: hex(field(source, 'renderer_commitment', 'rendererCommitment')),
    companionManifestBlobId: string(field(source, 'companion_manifest_blob_id', 'companionManifestBlobId')),
    companionManifestHash: hex(field(source, 'companion_manifest_hash', 'companionManifestHash')),
    extensionsHash: hex(field(source, 'extensions_hash', 'extensionsHash')),
    sealed: bool(field(source, 'sealed')),
    admissionsTableId: id(field(source, 'admissions')),
  };
}

function normalizeProduct(value) {
  const source = fields(value);
  return {
    id: id(field(source, 'id')),
    sourceRootId: id(field(source, 'source_root_id', 'sourceRootId')),
    publisher: id(field(source, 'publisher')),
    originalCreator: id(field(source, 'original_creator', 'originalCreator')),
    originKind: number(field(source, 'origin_kind', 'originKind')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: hex(field(source, 'asset_commitment', 'assetCommitment')),
    slotKey: string(field(source, 'slot_key', 'slotKey')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rightsOrigin: number(field(source, 'rights_origin', 'rightsOrigin')),
    accessKind: number(field(source, 'access_kind', 'accessKind')),
    bindingKind: number(field(source, 'binding_kind', 'bindingKind')),
    priceAtomic: atomic(field(source, 'price_atomic', 'priceAtomic')),
    makerEcosystemFeeBps: number(field(source, 'maker_ecosystem_fee_bps', 'makerEcosystemFeeBps')),
    transferable: bool(field(source, 'transferable')),
    requiredProductIds: array(field(source, 'required_product_ids', 'requiredProductIds')).map(id),
    excludedProductIds: array(field(source, 'excluded_product_ids', 'excludedProductIds')).map(id),
    extensionsHash: hex(field(source, 'extensions_hash', 'extensionsHash')),
  };
}

function normalizeAdmission(row, profileId) {
  const source = fields(row.value);
  return {
    profileId,
    productId: id(row.name),
    sourceKind: number(field(source, 'source_kind', 'sourceKind')),
    attestationId: id(field(source, 'attestation_id', 'attestationId')),
    admittedBy: id(field(source, 'admitted_by', 'admittedBy')),
    admittedAtMs: number(field(source, 'admitted_at_ms', 'admittedAtMs')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: hex(field(source, 'asset_commitment', 'assetCommitment')),
    slotKey: string(field(source, 'slot_key', 'slotKey')),
    rightsOrigin: number(field(source, 'rights_origin', 'rightsOrigin')),
    accessKind: number(field(source, 'access_kind', 'accessKind')),
    bindingKind: number(field(source, 'binding_kind', 'bindingKind')),
    priceAtomic: atomic(field(source, 'price_atomic', 'priceAtomic')),
    makerEcosystemFeeBps: number(field(source, 'maker_ecosystem_fee_bps', 'makerEcosystemFeeBps')),
    transferable: bool(field(source, 'transferable')),
    requiredProductIds: array(field(source, 'required_product_ids', 'requiredProductIds')).map(id),
    excludedProductIds: array(field(source, 'excluded_product_ids', 'excludedProductIds')).map(id),
    publisher: id(field(source, 'publisher')),
    active: bool(field(source, 'active')),
  };
}

function normalizeAttestation(value) {
  const source = fields(value);
  return {
    id: id(field(source, 'id')),
    profileId: id(field(source, 'profile_id', 'profileId')),
    productId: id(field(source, 'product_id', 'productId')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    validatorPolicyCommitment: hex(field(source, 'validator_policy_commitment', 'validatorPolicyCommitment')),
    validatorEpoch: number(field(source, 'validator_epoch', 'validatorEpoch')),
    issuedAtMs: number(field(source, 'issued_at_ms', 'issuedAtMs')),
  };
}

function productAssets(products, assetUrl) {
  const assets = new Map();
  products.forEach((product) => array(product.components).forEach((component) => {
    if (component.baseSource || !component.assetBlobId) return;
    assets.set(component.assetBlobId, {
      assetId: component.assetBlobId,
      identifier: component.assetBlobId,
      url: assetUrl(component.assetBlobId),
      thumbnailUrl: assetUrl(component.assetBlobId),
      width: component.assetWidth,
      height: component.assetHeight,
      contentHash: component.assetHash,
      mediaType: 'image/png',
    });
  }));
  return [...assets.values()];
}

function entitlementFor(product, source, overrides) {
  return createItemEntitlementV6(product, {
    ...overrides,
    issuedAtMs: number(field(source, 'granted_at_ms', 'grantedAtMs')),
    paidAtomic: number(field(source, 'paid_atomic', 'paidAtomic')),
    rightsSnapshotHash: product.rightsManifestHash,
    issuanceNonce: `chain:${overrides.id}`,
  });
}

async function walletEntitlements(client, registryFields, catalog, wallet, soulId, runtime) {
  const byObjectId = new Map(Object.entries(catalog.productObjectIds).map(([logical, objectId]) => [id(objectId), logical]));
  const byLogical = new Map(catalog.products.map((product) => [product.id, product]));
  const result = [];
  const addTable = async (table, binding) => {
    for (const row of await scanTable(client, id(field(registryFields, table)))) {
      const key = fields(row.name);
      const productObjectId = id(field(key, 'product_id', 'productId'));
      const logicalId = byObjectId.get(productObjectId);
      const product = byLogical.get(logicalId);
      if (!product || product.access.binding !== binding) continue;
      if (binding === ITEM_BINDING_MODES.ACCOUNT
          && id(field(key, 'wallet')) === wallet) {
        result.push(entitlementFor(product, fields(row.value), {
          id: row.fieldId,
          holderAddress: wallet,
        }));
      }
      if (binding === ITEM_BINDING_MODES.SOUL_BOUND
          && soulId && id(field(key, 'soul_id', 'soulId')) === soulId) {
        result.push(entitlementFor(product, fields(row.value), {
          id: row.fieldId,
          soulId,
        }));
      }
    }
  };
  await addTable('wallet_entitlements', ITEM_BINDING_MODES.ACCOUNT);
  if (soulId) await addTable('soul_entitlements', ITEM_BINDING_MODES.SOUL_BOUND);
  let cursor = null;
  do {
    const page = await client.listOwnedObjects({
      owner: wallet,
      type: `${runtime.compositionV6TypeOriginPackageId}::composition_v6::OwnedItemV6`,
      cursor,
      limit: 50,
      include: { json: true },
    });
    for (const owned of array(page?.objects)) {
      const source = fields(owned);
      const objectId = id(owned.objectId || owned.id || field(source, 'id'));
      const logicalId = byObjectId.get(id(field(source, 'product_id', 'productId')));
      const product = byLogical.get(logicalId);
      if (!product || product.access.binding !== ITEM_BINDING_MODES.OWNED) continue;
      result.push(createItemEntitlementV6(product, {
        id: objectId,
        ownerAddress: wallet,
        equippedSoulId: id(field(source, 'locked_soul', 'lockedSoul')) || null,
        issuedAtMs: 0,
        paidAtomic: product.access.mode === ITEM_ACCESS_MODES.PAID_ONCE ? product.access.priceAtomic : 0,
        rightsSnapshotHash: product.rightsManifestHash,
        issuanceNonce: `chain:${objectId}`,
      }));
    }
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor);
  return result;
}

/**
 * Gate-aware read path. A closed gate returns before touching the client or
 * Walrus loader, so partially configured deployments cannot leak preview
 * metadata into a Player catalog.
 */
export async function hydrateComposableV6PlayerState({
  runtime = {},
  client,
  walletAddress,
  makerRootId,
  soulId = '',
  soulStateId = '',
  appearanceStateId = '',
  appearanceRevision = 0,
  companionLoader,
  assetUrl = (blobId) => blobId,
} = {}) {
  if (!releaseOpen(runtime)) return null;
  if (!client || typeof companionLoader !== 'function') {
    fail('COMPOSABLE_PLAYER_V6_RUNTIME_MISSING', 'The v6 Sui query client and Walrus companion loader are required.');
  }
  const wallet = id(walletAddress);
  const rootId = id(makerRootId);
  if (!wallet || !rootId) fail('COMPOSABLE_PLAYER_V6_CONTEXT_MISSING', 'Player wallet and MakerRootV5 are required.');
  const protocolObjects = await getObjects(client, [
    runtime.compositionProtocolConfigV6Id,
    runtime.compositionRegistryV6Id,
  ]);
  const byId = new Map(protocolObjects.map((entry) => [
    id(entry.objectId || entry.id),
    entry,
  ]));
  const config = byId.get(id(runtime.compositionProtocolConfigV6Id));
  const registry = byId.get(id(runtime.compositionRegistryV6Id));
  if (!config || !registry) fail('COMPOSABLE_PLAYER_V6_PROTOCOL_UNAVAILABLE', 'The reviewed v6 protocol objects are not visible.');
  const configFields = fields(config);
  const registryFields = fields(registry);
  if (!bool(field(configFields, 'enabled'))
      || id(field(configFields, 'registry_id', 'registryId')) !== id(runtime.compositionRegistryV6Id)
      || id(field(registryFields, 'config_id', 'configId')) !== id(runtime.compositionProtocolConfigV6Id)) {
    fail('COMPOSABLE_PLAYER_V6_PROTOCOL_DISABLED', 'Composable Assets v6 is disabled or its protocol objects are not linked.');
  }
  const profileRows = await scanTable(client, id(field(registryFields, 'profiles')));
  const profileObjects = await getObjects(client, profileRows.map((row) => id(row.value)));
  const profiles = profileObjects.map((entry) => normalizeProfile(entry, entry.objectId || entry.id));
  const profile = profiles.find((entry) => entry.rootId === rootId);
  if (!profile) fail('COMPOSABLE_PLAYER_V6_PROFILE_NOT_FOUND', 'This Maker release has no v6 Composable Profile.');
  const companionBytes = await companionLoader(profile.companionManifestBlobId);
  if (!(companionBytes instanceof Uint8Array)) {
    fail('COMPOSABLE_PLAYER_V6_COMPANION_INVALID', 'The Walrus companion loader must return exact bytes.');
  }
  if (await sha256(companionBytes) !== profile.companionManifestHash) {
    fail('COMPOSABLE_PLAYER_V6_COMPANION_HASH_MISMATCH', 'The Walrus companion bytes do not match MakerProfileV6.');
  }
  let companionManifest;
  try {
    companionManifest = JSON.parse(new TextDecoder().decode(companionBytes));
  } catch {
    fail('COMPOSABLE_PLAYER_V6_COMPANION_INVALID', 'The v6 companion is not valid JSON.');
  }
  const admissionRows = await scanTable(client, profile.admissionsTableId);
  const admissions = admissionRows.map((row) => normalizeAdmission(row, profile.id));
  const productObjects = await getObjects(client, admissions.map((entry) => entry.productId));
  const products = productObjects.map(normalizeProduct);
  const attestationObjects = await getObjects(client, admissions.map((entry) => entry.attestationId));
  const attestations = attestationObjects.map(normalizeAttestation);
  const catalog = hydrateTrustedMakerComposableV6Catalog({
    companionManifest,
    trustedChainState: {
      queryVerified: true,
      profile,
      products,
      admissions,
      attestations,
      companionManifestBlobId: profile.companionManifestBlobId,
      companionManifestHash: profile.companionManifestHash,
      validatorPolicyCommitment: hex(field(configFields, 'validator_policy_commitment', 'validatorPolicyCommitment')),
      validatorEpoch: number(field(configFields, 'validator_epoch', 'validatorEpoch')),
    },
  });
  const entitlements = await walletEntitlements(
    client,
    registryFields,
    catalog,
    wallet,
    id(soulId),
    runtime,
  );
  return Object.freeze({
    ...catalog,
    manifest: Object.freeze({ ...clone(companionManifest), items: clone(catalog.products) }),
    companionManifest: clone(companionManifest),
    products: clone(catalog.products),
    entitlements,
    ownerAddress: wallet,
    soulId: id(soulId),
    soulStateId: id(soulStateId),
    appearanceStateId: id(appearanceStateId),
    selected: clone(companionManifest.fallbackLoadout?.productIds || []),
    loadout: clone(companionManifest.fallbackLoadout?.productIds || []),
    revision: Number.isSafeInteger(Number(appearanceRevision))
      ? Math.max(0, Number(appearanceRevision))
      : 0,
    appearanceRevision: Number.isSafeInteger(Number(appearanceRevision))
      ? Math.max(0, Number(appearanceRevision))
      : 0,
    assets: productAssets(catalog.products, assetUrl),
    ownershipEpoch: 0,
  });
}

function checkpointKey(plan) {
  return `${CHECKPOINT_PREFIX}${plan.planIdentity}`;
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `web-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function transactionArgument(tx, input, name, results) {
  if (input?.kind === 'OBJECT') return tx.object(input.objectId);
  if (input?.kind === 'RESULT') {
    const result = results.get(input.callId);
    if (!result) fail('COMPOSABLE_PLAYER_V6_PLAN_RESULT_MISSING', `Move result ${input.callId} is unavailable.`);
    const outputIndex = Number.isSafeInteger(input.output) ? input.output : input.outputIndex;
    return Number.isSafeInteger(outputIndex) ? result[outputIndex] : result;
  }
  if (input?.kind === 'OPTION') return tx.pure.option('address', input.value || null);
  if (Array.isArray(input)) {
    if (input.every((entry) => entry?.kind === 'RESULT')) {
      return tx.makeMoveVec({ elements: input.map((entry) => transactionArgument(tx, entry, name, results)) });
    }
    return tx.pure.vector('u8', input);
  }
  if (name === 'productId') return tx.pure.address(input);
  if (name === 'subjectKind') return tx.pure.u8(input);
  if (name === 'expectedRevision') return tx.pure.u64(input);
  if (name === 'slotKey') return tx.pure.string(input);
  fail('COMPOSABLE_PLAYER_V6_PLAN_INPUT_UNSUPPORTED', `Unsupported v6 PTB input ${name}.`);
}

export function transactionFromComposableV6Plan(plan) {
  const tx = new Transaction();
  const results = new Map();
  const exactPayment = plan?.context?.paymentCoinId && plan?.context?.priceAtomic
    ? tx.splitCoins(tx.object(plan.context.paymentCoinId), [
        tx.pure.u64(String(plan.context.priceAtomic)),
      ])[0]
    : null;
  for (const moveCall of plan.action.calls) {
    const result = tx.moveCall({
      target: moveCall.target,
      typeArguments: moveCall.typeArguments || [],
      arguments: moveCall.inputOrder.map((name) => (
        name === 'payment' && exactPayment
          ? exactPayment
          : transactionArgument(tx, moveCall.inputs[name], name, results)
      )),
    });
    results.set(moveCall.id, result);
  }
  return tx;
}

/** Recovery-bound generic write adapter used by Item, lock and appearance actions. */
export async function executeComposableV6PlayerAction({
  runtime = {},
  input,
  recovery = null,
  signAndWait,
  confirmReadback,
  storage = globalThis.localStorage,
  onStatus = () => {},
} = {}) {
  let recoveredEnvelope = null;
  const recoveryDigest = String(recovery?.digest || '');
  if (recoveryDigest && storage) {
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const candidateKey = storage.key(index);
      if (!String(candidateKey || '').startsWith(CHECKPOINT_PREFIX)) continue;
      try {
        const candidate = JSON.parse(storage.getItem(candidateKey));
        if (candidate?.checkpoint?.submission?.transactionDigest === recoveryDigest) {
          recoveredEnvelope = candidate;
          break;
        }
      } catch {
        // A malformed unrelated browser value never authorizes a transaction.
      }
    }
  }
  const plan = recoveredEnvelope?.plan
    || await buildMakerComposableV6PlayerActionPlan({ runtime, ...input });
  const key = checkpointKey(plan);
  let checkpoint;
  const saved = recoveredEnvelope || (storage?.getItem?.(key) ? JSON.parse(storage.getItem(key)) : null);
  if (saved) checkpoint = await hydrateMakerComposableV6PlayerCheckpoint(saved.checkpoint || saved, { plan });
  else checkpoint = await createMakerComposableV6PlayerCheckpoint({ plan, nonce: randomNonce() });
  const persist = () => storage?.setItem?.(key, JSON.stringify({ plan, checkpoint }));
  if (checkpoint.status === MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.PENDING) {
    onStatus('planning');
    checkpoint = await beginMakerComposableV6PlayerAction({ checkpoint, plan, runtime });
    persist();
  }
  let digest = checkpoint.submission?.transactionDigest || '';
  try {
    if (checkpoint.status === MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.INTENT) {
      onStatus('awaiting-signature');
      const submitted = await signAndWait(transactionFromComposableV6Plan(plan));
      digest = String(submitted?.digest || submitted?.transactionDigest || '');
      checkpoint = await markMakerComposableV6PlayerSubmitted({
        checkpoint,
        plan,
        submission: { transactionDigest: digest },
      });
      persist();
      onStatus('submitted', { digest });
    }
    onStatus('confirming', { digest });
    const confirmation = await confirmReadback({ digest, plan });
    checkpoint = await confirmMakerComposableV6PlayerAction({ checkpoint, plan, confirmation });
    storage?.removeItem?.(key);
    return { confirmed: true, digest, checkpoint, outputs: checkpoint.outputs };
  } catch (error) {
    checkpoint = await recordMakerComposableV6PlayerError({ checkpoint, plan, error });
    persist();
    if (digest) return { recoverable: true, digest, message: error?.message || '', checkpoint };
    throw error;
  }
}
