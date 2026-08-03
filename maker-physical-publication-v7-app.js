import { Transaction } from '@mysten/sui/transactions';
import {
  MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS,
  beginMakerPhysicalV7PublicationAction,
  buildMakerPhysicalV7PublicationPlan,
  confirmMakerPhysicalV7PublicationAction,
  createMakerPhysicalV7PublicationCheckpoint,
  hydrateMakerPhysicalV7PublicationCheckpoint,
  markMakerPhysicalV7PublicationSubmitted,
  nextMakerPhysicalV7PublicationAction,
  recordMakerPhysicalV7PublicationError,
} from './maker-physical-publication-v7.js';

const STORAGE_PREFIX = 'animacraft:physical-publication-v7:';
const SUI_ID = /^0x[0-9a-f]+$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;

export class MakerPhysicalV7PublicationAppError extends Error {
  constructor(message, code = 'PHYSICAL_V7_PUBLICATION_APP_ERROR', details = {}) {
    super(message);
    this.name = 'MakerPhysicalV7PublicationAppError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerPhysicalV7PublicationAppError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function id(value) {
  if (typeof value === 'string') return SUI_ID.test(value.trim()) ? value.trim().toLowerCase() : '';
  if (Array.isArray(value)) return value.map(id).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  const source = object(value);
  return id(source.id || source.bytes || source.address || source.fields || source.vec || source.some);
}

function field(value, ...names) {
  const source = object(value?.json || value);
  const fields = object(source.fields || source);
  for (const name of names) if (fields[name] !== undefined) return fields[name];
  return undefined;
}

function bool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function string(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return string(value.value ?? value.bytes ?? value.fields ?? value.vec?.[0]);
}

function hex(value) {
  if (typeof value === 'string') {
    const normalized = value.replace(/^0x/i, '').toLowerCase();
    return HASH.test(normalized) ? normalized : '';
  }
  const bytes = array(value?.bytes || value?.vec || value);
  return bytes.length === 32 ? bytes.map((entry) => Number(entry).toString(16).padStart(2, '0')).join('') : '';
}

function hexBytes(value, label) {
  const normalized = String(value || '').replace(/^0x/i, '').toLowerCase();
  if (!HASH.test(normalized)) fail('PHYSICAL_V7_CHAIN_INPUT_INVALID', `${label} must be an exact 32-byte commitment.`);
  return Array.from({ length: 32 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
}

const INPUT_ORDER = Object.freeze({
  create_maker_physical_profile_v7: [
    'physicalRegistryV7Id', 'physicalProtocolConfigV7Id',
    'compositionProtocolConfigV6Id', 'v6ProfileId', 'baseMakerRootId',
    'makerControlCapId', 'commerceProtocolConfigV5Id',
  ],
  register_part_policy_v7: [
    'physicalProfileId', 'physicalProtocolConfigV7Id', 'baseMakerRootId',
    'makerControlCapId', 'slotKey', 'behaviorKind', 'required', 'maxSourceKind',
  ],
  seal_maker_physical_profile_v7: [
    'physicalProfileId', 'physicalProtocolConfigV7Id', 'baseMakerRootId',
    'makerControlCapId',
  ],
  publish_item_family_v7: [
    'physicalRegistryV7Id', 'physicalProtocolConfigV7Id',
    'compositionProtocolConfigV6Id', 'physicalProfileId', 'v6ProfileId',
    'v6ProductId', 'baseMakerRootId', 'makerControlCapId',
    'commerceProtocolConfigV5Id', 'familyKey', 'label', 'familyCommitment',
  ],
  publish_external_item_family_v7: [
    'physicalRegistryV7Id', 'physicalProtocolConfigV7Id',
    'compositionProtocolConfigV6Id', 'physicalProfileId', 'v6ProfileId',
    'v6ProductId', 'baseMakerRootId', 'commerceProtocolConfigV5Id',
    'familyKey', 'label', 'familyCommitment',
  ],
  publish_style_product_v7: [
    'physicalRegistryV7Id', 'physicalProtocolConfigV7Id',
    'compositionProtocolConfigV6Id', 'physicalProfileId', 'v6ProfileId',
    'familyObjectId', 'v6ProductId', 'baseMakerRootId', 'makerControlCapId',
    'commerceProtocolConfigV5Id', 'recipeItemKey', 'styleKey', 'label', 'supplyKind',
    'maxSupply', 'definitionBlobId', 'definitionIdentifier', 'definitionHash',
    'assetBlobId', 'assetIdentifier', 'rendererCommitment',
  ],
  publish_external_style_product_v7: [
    'physicalRegistryV7Id', 'physicalProtocolConfigV7Id',
    'compositionProtocolConfigV6Id', 'physicalProfileId', 'v6ProfileId',
    'familyObjectId', 'v6ProductId', 'baseMakerRootId',
    'commerceProtocolConfigV5Id', 'recipeItemKey', 'styleKey', 'label', 'supplyKind',
    'maxSupply', 'definitionBlobId', 'definitionIdentifier', 'definitionHash',
    'assetBlobId', 'assetIdentifier', 'rendererCommitment',
  ],
});

const SUPPLY_KIND = Object.freeze({
  BASE_INCLUDED: 0,
  PACK_INCLUDED: 0,
  OPEN_EDITION: 1,
  LIMITED_EDITION: 2,
});

const SUI_OBJECT_INPUTS = new Set([
  'physicalRegistryV7Id',
  'physicalProtocolConfigV7Id',
  'compositionProtocolConfigV6Id',
  'physicalProfileId',
  'v6ProfileId',
  'familyObjectId',
  'v6ProductId',
  'baseMakerRootId',
  'makerControlCapId',
  'commerceProtocolConfigV5Id',
]);

function moveFunction(target) {
  return String(target || '').split('::').at(-1);
}

function transactionArgument(tx, name, input) {
  let value = input;
  if (name === 'supplyKind') value = SUPPLY_KIND[input.supplyClass];
  if (SUI_OBJECT_INPUTS.has(name)) {
    const objectId = id(value);
    if (!objectId) fail('PHYSICAL_V7_CHAIN_INPUT_INVALID', `${name} must be a Sui object ID.`);
    return tx.object(objectId);
  }
  if (['slotKey', 'familyKey', 'recipeItemKey', 'styleKey', 'label', 'definitionBlobId', 'definitionIdentifier', 'assetBlobId', 'assetIdentifier'].includes(name)) return tx.pure.string(String(value));
  if (['familyCommitment', 'definitionHash', 'rendererCommitment'].includes(name)) return tx.pure.vector('u8', hexBytes(value, name));
  if (['behaviorKind', 'maxSourceKind', 'supplyKind'].includes(name)) {
    if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 255) fail('PHYSICAL_V7_CHAIN_INPUT_INVALID', `${name} must be a u8.`);
    return tx.pure.u8(Number(value));
  }
  if (name === 'maxSupply') return tx.pure.u64(String(value));
  if (name === 'required') return tx.pure.bool(Boolean(value));
  fail('PHYSICAL_V7_CHAIN_INPUT_UNSUPPORTED', `Unsupported v7 publication input ${name}.`);
}

export function transactionFromPhysicalV7PublicationAction(action) {
  if (action?.transport !== 'SUI') fail('PHYSICAL_V7_CHAIN_ACTION_REQUIRED', 'A resolved Sui v7 action is required.');
  const functionName = moveFunction(action.target);
  const order = INPUT_ORDER[functionName];
  if (!order) fail('PHYSICAL_V7_CHAIN_TARGET_UNSUPPORTED', `Unsupported physical v7 target ${action.target}.`);
  const tx = new Transaction();
  tx.moveCall({
    target: action.target,
    arguments: order.map((name) => transactionArgument(tx, name, action.inputs)),
  });
  return tx;
}

function indexedTransaction(value) {
  return value?.Transaction || value?.transaction || value || {};
}

function eventType(value) {
  return String(value?.type || '');
}

function eventJson(value) {
  return object(value?.parsedJson || value?.parsed_json || value?.json);
}

function exactEvent(events, suffix, predicate) {
  const matches = events.filter((entry) => eventType(entry).endsWith(`::${suffix}`) && predicate(eventJson(entry)));
  if (matches.length !== 1) fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', `Expected exactly one ${suffix} event.`, { count: matches.length });
  return eventJson(matches[0]);
}

function resultObjects(response) {
  return array(response?.objects || response?.data || response).filter((entry) => entry && !entry.error);
}

function createdObject(indexed, suffix) {
  const matches = Object.entries(object(indexed?.objectTypes || indexed?.object_types))
    .filter(([, type]) => String(type).endsWith(`::physical_composition_v7::${suffix}`));
  if (matches.length !== 1) fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', `Expected one created ${suffix}.`, { count: matches.length });
  return id(matches[0][0]);
}

async function getExactObject(client, objectId, label) {
  const response = await client?.getObjects?.({ objectIds: [objectId], include: { json: true, type: true, owner: true } });
  const result = resultObjects(response)[0];
  if (!result || id(result.objectId || result.id) !== id(objectId)) fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', `${label} is not visible after finalized execution.`);
  return result;
}

export async function readPhysicalV7PublicationSubmission({ action, submission, suiClient } = {}) {
  const transactionDigest = String(submission?.transactionDigest || submission?.digest || '');
  if (!transactionDigest) fail('PHYSICAL_V7_CHAIN_SUBMISSION_INVALID', 'A Sui transaction digest is required.');
  const fetched = submission?.indexed || await suiClient?.getTransaction?.({ digest: transactionDigest, include: { effects: true, objectTypes: true, events: true } });
  const indexed = indexedTransaction(fetched);
  const events = array(indexed.events);
  const confirmation = { transactionDigest };
  if (action.id === 'chain.physical-profile.create') {
    confirmation.physicalProfileId = createdObject(indexed, 'MakerPhysicalProfileV7');
    const profile = await getExactObject(suiClient, confirmation.physicalProfileId, 'MakerPhysicalProfileV7');
    if (id(field(profile, 'config_id', 'configId')) !== id(action.inputs.physicalProtocolConfigV7Id)
        || id(field(profile, 'v6_profile_id', 'v6ProfileId')) !== id(action.inputs.v6ProfileId)
        || id(field(profile, 'root_id', 'rootId')) !== id(action.inputs.baseMakerRootId)
        || bool(field(profile, 'sealed')) !== false) {
      fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', 'Created physical Profile does not match Config, v6 Profile and MakerRoot.');
    }
    confirmation.readbackVerified = true;
  } else if (action.id.startsWith('chain.part-policy.register.')) {
    exactEvent(events, 'PartPolicyRegisteredV7', (entry) => (
      id(entry.profile_id || entry.profileId) === id(action.inputs.physicalProfileId)
      && String(entry.slot_key || entry.slotKey || '') === String(action.inputs.slotKey)
      && Number(entry.behavior) === Number(action.inputs.behaviorKind)
      && Boolean(entry.required) === Boolean(action.inputs.required)
      && Number(entry.max_source_kind ?? entry.maxSourceKind) === Number(action.inputs.maxSourceKind)
    ));
    confirmation.policyReadback = true;
  } else if (action.id === 'chain.physical-profile.seal') {
    const profile = await getExactObject(suiClient, action.inputs.physicalProfileId, 'MakerPhysicalProfileV7');
    if (bool(field(profile, 'sealed')) !== true) fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', 'Physical Profile is not sealed after finalized execution.');
    confirmation.sealedReadback = true;
  } else if (action.id.startsWith('chain.family.publish.')) {
    const entry = exactEvent(events, 'ItemFamilyPublishedV7', (event) => (
      id(event.profile_id || event.profileId) === id(action.inputs.physicalProfileId)
      && id(event.seed_v6_product_id || event.seedV6ProductId) === id(action.inputs.v6ProductId)
      && String(event.slot_key || event.slotKey || '') === String(action.policy?.slotKey)
    ));
    confirmation.familyObjectId = id(entry.family_id || entry.familyId);
    if (!confirmation.familyObjectId) fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', 'ItemFamilyPublishedV7 is missing the exact family ID.');
    confirmation.readbackVerified = true;
  } else if (action.id.startsWith('chain.style-product.publish.')) {
    const expectedSupply = SUPPLY_KIND[action.inputs.supplyClass];
    const entry = exactEvent(events, 'StyleProductPublishedV7', (event) => (
      id(event.family_id || event.familyId) === id(action.inputs.familyObjectId)
      && id(event.v6_product_id || event.v6ProductId) === id(action.inputs.v6ProductId)
      && Number(event.supply_kind ?? event.supplyKind) === expectedSupply
      && String(event.max_supply ?? event.maxSupply) === String(action.inputs.maxSupply)
      && String(event.definition_blob_id ?? event.definitionBlobId ?? event.style_manifest_blob_id ?? event.styleManifestBlobId) === String(action.inputs.definitionBlobId)
      && String(event.definition_identifier ?? event.definitionIdentifier ?? '') === String(action.inputs.definitionIdentifier)
      && hex(event.definition_hash ?? event.definitionHash ?? event.style_manifest_hash ?? event.styleManifestHash) === String(action.inputs.definitionHash)
      && String(event.asset_blob_id ?? event.assetBlobId ?? '') === String(action.inputs.assetBlobId)
      && String(event.asset_identifier ?? event.assetIdentifier ?? '') === String(action.inputs.assetIdentifier)
    ));
    confirmation.styleProductObjectId = id(entry.style_product_id || entry.styleProductId);
    if (!confirmation.styleProductObjectId) fail('PHYSICAL_V7_CHAIN_READBACK_MISMATCH', 'StyleProductPublishedV7 is missing the exact Product ID.');
    confirmation.readbackVerified = true;
  } else {
    fail('PHYSICAL_V7_CHAIN_TARGET_UNSUPPORTED', `Unsupported v7 readback action ${action.id}.`);
  }
  return confirmation;
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `web-${[...bytes].map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
}

function keyFor(plan) {
  return `${STORAGE_PREFIX}${plan.bindingIdentity}`;
}

function save(storage, key, plan, checkpoint) {
  storage?.setItem?.(key, JSON.stringify({ plan, checkpoint }));
}

export async function preparePhysicalV7Publication({
  document,
  catalog,
  v6Publication,
  context,
  runtime,
  storage = globalThis.localStorage,
} = {}) {
  const plan = await buildMakerPhysicalV7PublicationPlan({ document, catalog, v6Publication, context, runtime });
  const key = keyFor(plan);
  const saved = storage?.getItem?.(key);
  const checkpoint = saved
    ? await hydrateMakerPhysicalV7PublicationCheckpoint(JSON.parse(saved).checkpoint || JSON.parse(saved), { plan })
    : await createMakerPhysicalV7PublicationCheckpoint({ plan, nonce: randomNonce() });
  save(storage, key, plan, checkpoint);
  return { key, plan, checkpoint };
}

export async function advancePhysicalV7Publication({
  publication,
  runtime,
  storage = globalThis.localStorage,
  executeWalrusAction,
  executeSuiAction,
  confirmAction,
  onStatus = () => {},
} = {}) {
  const { key, plan } = publication || {};
  let checkpoint = await hydrateMakerPhysicalV7PublicationCheckpoint(publication?.checkpoint, { plan });
  if (checkpoint.completed) return { key, completed: true, plan, checkpoint };
  if (runtime?.physicalStyleV7ReleaseEnabled !== true) return { key, gated: true, completed: false, plan, checkpoint };
  let action = await nextMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime });
  try {
    if (checkpoint.actions[checkpoint.currentActionIndex].status === MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.PENDING) {
      checkpoint = await beginMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime });
      save(storage, key, plan, checkpoint);
    }
    action = await nextMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime });
    const current = checkpoint.actions[checkpoint.currentActionIndex];
    let submission = current.submission;
    if (current.status === MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.INTENT) {
      const execute = action.transport === 'WALRUS' ? executeWalrusAction : executeSuiAction;
      if (typeof execute !== 'function') throw new Error(`No ${action.transport} executor is configured for ${action.id}.`);
      onStatus(action.transport === 'WALRUS' ? 'walrus' : 'awaiting-signature', { action });
      submission = await execute({ action, plan, checkpoint });
      checkpoint = await markMakerPhysicalV7PublicationSubmitted({ checkpoint, plan, actionId: action.id, submission });
      save(storage, key, plan, checkpoint);
    }
    if (typeof confirmAction !== 'function') throw new Error(`No readback verifier is configured for ${action.id}.`);
    onStatus('confirming', { action, submission });
    const confirmation = await confirmAction({ action, plan, checkpoint, submission });
    checkpoint = await confirmMakerPhysicalV7PublicationAction({ checkpoint, plan, actionId: action.id, confirmation });
    save(storage, key, plan, checkpoint);
    onStatus(checkpoint.completed ? 'completed' : 'confirmed', { action, checkpoint });
    return { key, completed: checkpoint.completed, plan, checkpoint };
  } catch (error) {
    checkpoint = await recordMakerPhysicalV7PublicationError({ checkpoint, plan, error });
    save(storage, key, plan, checkpoint);
    return { recoverable: true, key, completed: false, actionId: action?.id || '', error, message: error?.message || 'Physical v7 publication failed.', plan, checkpoint };
  }
}

export function clearPhysicalV7Publication(publication, storage = globalThis.localStorage) {
  if (publication?.key) storage?.removeItem?.(publication.key);
}
