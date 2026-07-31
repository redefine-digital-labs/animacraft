import { Transaction } from '@mysten/sui/transactions';
import {
  MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS,
  beginMakerComposableV6PublicationAction,
  buildMakerComposableV6PublicationPlan,
  confirmMakerComposableV6PublicationAction,
  createMakerComposableV6PublicationCheckpoint,
  hydrateMakerComposableV6PublicationCheckpoint,
  markMakerComposableV6PublicationSubmitted,
  nextMakerComposableV6PublicationAction,
  recordMakerComposableV6PublicationError,
} from './maker-composable-publication-v6.js';

const STORAGE_PREFIX = 'animacraft:composable-publication-v6:';
const SUI_ID = /^0x[0-9a-f]+$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;

export class MakerComposableV6PublicationAppError extends Error {
  constructor(message, code = 'COMPOSABLE_V6_PUBLICATION_APP_ERROR', details = {}) {
    super(message);
    this.name = 'MakerComposableV6PublicationAppError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerComposableV6PublicationAppError(message, code, details);
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

function ownerAddress(value) {
  const direct = id(value?.owner);
  if (direct) return direct;
  const owner = object(value?.owner || value);
  return id(owner.AddressOwner || owner.addressOwner || owner.address_owner || owner.address);
}

function hexBytes(value, name) {
  const normalized = String(value || '').replace(/^0x/i, '').toLowerCase();
  if (!HASH.test(normalized)) fail(
    'COMPOSABLE_V6_CHAIN_INPUT_INVALID',
    `${name} must be an exact 32-byte commitment.`,
  );
  return Array.from({ length: 32 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
}

function pureIdVector(tx, values, name) {
  const ids = array(values).map(id);
  if (ids.length !== array(values).length) fail(
    'COMPOSABLE_V6_CHAIN_INPUT_INVALID',
    `${name} contains an invalid Sui object ID.`,
  );
  return tx.pure.vector('address', ids);
}

const INPUT_ORDER = Object.freeze({
  create_maker_profile_v6: [
    'rootId', 'makerControlCapId', 'compositionProtocolConfigV6Id',
    'commerceProtocolConfigV5Id', 'compositionRegistryV6Id', 'mode',
    'itemAssetization', 'thirdPartyPolicy', 'slotSchemaCommitment',
    'rendererCommitment', 'companionManifestBlobId', 'companionManifestHash',
    'extensionsHash',
  ],
  seal_maker_profile_v6: [
    'profileId', 'rootId', 'makerControlCapId', 'compositionProtocolConfigV6Id',
    'commerceProtocolConfigV5Id',
  ],
  publish_official_item_product_v6: [
    'profileId', 'rootId', 'makerControlCapId', 'compositionProtocolConfigV6Id',
    'commerceProtocolConfigV5Id', 'familyCommitment', 'definitionCommitment',
    'assetCommitment', 'slotKey', 'accessKind', 'bindingKind', 'priceAtomic',
    'makerEcosystemFeeBps', 'transferable', 'requiredProductIds',
    'excludedProductIds', 'extensionsHash',
  ],
  publish_external_item_product_v6: [
    'profileId', 'compositionProtocolConfigV6Id', 'commerceProtocolConfigV5Id',
    'originKind', 'familyCommitment', 'definitionCommitment', 'assetCommitment', 'slotKey',
    'rightsOrigin', 'accessKind', 'bindingKind', 'priceAtomic',
    'makerEcosystemFeeBps', 'transferable', 'requiredProductIds',
    'excludedProductIds', 'extensionsHash',
  ],
  publish_validator_attestation_v6: [
    'compositionProtocolConfigV6Id', 'commerceProtocolConfigV5Id', 'validatorCapId',
    'profileId', 'productId', 'clockObjectId',
  ],
  admit_official_item_v6: [
    'profileId', 'productId', 'validatorAttestationId', 'rootId',
    'makerControlCapId', 'compositionProtocolConfigV6Id',
    'commerceProtocolConfigV5Id', 'clockObjectId',
  ],
  admit_certified_item_v6: [
    'profileId', 'productId', 'validatorAttestationId', 'rootId',
    'makerControlCapId', 'compositionProtocolConfigV6Id',
    'commerceProtocolConfigV5Id', 'clockObjectId',
  ],
  admit_open_item_v6: [
    'profileId', 'productId', 'validatorAttestationId',
    'compositionProtocolConfigV6Id', 'commerceProtocolConfigV5Id', 'clockObjectId',
  ],
});

function moveFunction(target) {
  return String(target || '').split('::').at(-1);
}

function transactionArgument(tx, name, value) {
  if (['slotKey', 'companionManifestBlobId'].includes(name)) return tx.pure.string(String(value));
  if (name.endsWith('Id') || ['rootId', 'profileId', 'productId'].includes(name)) {
    const objectId = id(value);
    if (!objectId) fail('COMPOSABLE_V6_CHAIN_INPUT_INVALID', `${name} must be a Sui object ID.`);
    return tx.object(objectId);
  }
  if (['requiredProductIds', 'excludedProductIds'].includes(name)) {
    return pureIdVector(tx, value, name);
  }
  if (['slotSchemaCommitment', 'rendererCommitment', 'companionManifestHash',
    'extensionsHash', 'familyCommitment', 'definitionCommitment',
    'assetCommitment'].includes(name)) {
    return tx.pure.vector('u8', hexBytes(value, name));
  }
  if (['mode', 'thirdPartyPolicy', 'originKind', 'rightsOrigin', 'accessKind', 'bindingKind'].includes(name)) {
    return tx.pure.u8(value);
  }
  if (name === 'makerEcosystemFeeBps') return tx.pure.u16(value);
  if (name === 'priceAtomic') return tx.pure.u64(String(value));
  if (['itemAssetization', 'transferable'].includes(name)) return tx.pure.bool(Boolean(value));
  fail('COMPOSABLE_V6_CHAIN_INPUT_UNSUPPORTED', `Unsupported v6 publication input ${name}.`);
}

/** Build exactly one audited composition_v6 publication call. */
export function transactionFromComposableV6PublicationAction(action) {
  if (action?.transport !== 'SUI') fail(
    'COMPOSABLE_V6_CHAIN_ACTION_REQUIRED',
    'A resolved Sui publication action is required.',
  );
  const functionName = moveFunction(action.target);
  const inputOrder = INPUT_ORDER[functionName];
  if (!inputOrder) fail(
    'COMPOSABLE_V6_CHAIN_TARGET_UNSUPPORTED',
    `Unsupported Composable v6 publication target ${action.target}.`,
  );
  const tx = new Transaction();
  tx.moveCall({
    target: action.target,
    arguments: inputOrder.map((name) => transactionArgument(tx, name, action.inputs?.[name])),
  });
  return tx;
}

function resultObjects(response) {
  return array(response?.objects || response?.data || response).filter((entry) => !entry?.error);
}

/**
 * Discover the current technical-validator authority from chain state. The
 * object ID and owner address are public authority references, never secrets.
 */
export async function discoverComposableV6ValidatorAuthority({ suiClient, configId } = {}) {
  const exactConfigId = id(configId);
  if (!suiClient || !exactConfigId) fail(
    'COMPOSABLE_V6_VALIDATOR_DISCOVERY_CONTEXT_MISSING',
    'CompositionProtocolConfigV6 and a Sui client are required for technical-validator discovery.',
  );
  const configResponse = await suiClient.getObjects({
    objectIds: [exactConfigId],
    include: { json: true, type: true },
  });
  const config = resultObjects(configResponse)[0];
  const validatorCapId = id(field(config, 'validator_cap_id', 'validatorCapId'));
  if (!validatorCapId) fail(
    'COMPOSABLE_V6_VALIDATOR_AUTHORITY_UNAVAILABLE',
    'CompositionProtocolConfigV6 does not expose a valid current ValidatorCapV6 object.',
  );
  const capResponse = await suiClient.getObjects({
    objectIds: [validatorCapId],
    include: { json: true, owner: true, type: true },
  });
  const cap = resultObjects(capResponse)[0];
  const validatorAddress = ownerAddress(cap);
  if (!cap || !validatorAddress) fail(
    'COMPOSABLE_V6_VALIDATOR_AUTHORITY_UNAVAILABLE',
    'The current ValidatorCapV6 owner is not visible. Publication is waiting for technical validation setup.',
    { validatorCapId },
  );
  return Object.freeze({ validatorCapId, validatorAddress });
}

function indexedTransaction(value) {
  return value?.Transaction || value?.transaction || value || {};
}

function eventJson(event) {
  return object(event?.parsedJson || event?.parsed_json || event?.json);
}

function eventType(event) {
  return String(event?.type || '');
}

function eventId(value) {
  return id(value);
}

function eventHash(value) {
  if (typeof value === 'string') return value.replace(/^0x/i, '').toLowerCase();
  const bytes = array(value?.bytes || value);
  return bytes.map((entry) => Number(entry).toString(16).padStart(2, '0')).join('');
}

function exactEvent(events, suffix, predicate = () => true) {
  const matches = events.filter((entry) => eventType(entry).endsWith(`::${suffix}`) && predicate(eventJson(entry)));
  if (matches.length !== 1) fail(
    'COMPOSABLE_V6_CHAIN_READBACK_MISMATCH',
    `Expected exactly one ${suffix} event for this transaction.`,
    { count: matches.length },
  );
  return eventJson(matches[0]);
}

function objectTypeEntries(indexed) {
  return Object.entries(object(indexed?.objectTypes || indexed?.object_types));
}

/** Read finalized transaction evidence into the protocol checkpoint shape. */
export async function readComposableV6PublicationSubmission({
  action,
  submission,
  suiClient,
} = {}) {
  const transactionDigest = String(submission?.transactionDigest || submission?.digest || '');
  if (!transactionDigest) fail(
    'COMPOSABLE_V6_CHAIN_SUBMISSION_INVALID',
    'A submitted Sui transaction digest is required for readback.',
  );
  const fetched = submission?.indexed || await suiClient?.getTransaction?.({
    digest: transactionDigest,
    include: { effects: true, objectTypes: true, events: true },
  });
  const indexed = indexedTransaction(fetched);
  const events = array(indexed.events);
  const confirmation = { transactionDigest, readbackVerified: true };
  if (action.id === 'chain.profile.create') {
    const parsed = exactEvent(events, 'MakerProfileCreatedV6', (entry) => (
      eventId(entry.root_id || entry.rootId) === id(action.inputs.rootId)
    ));
    confirmation.profileId = eventId(parsed.profile_id || parsed.profileId);
    confirmation.companionManifestBlobId = String(
      parsed.companion_manifest_blob_id || parsed.companionManifestBlobId || '',
    );
    confirmation.companionManifestHash = eventHash(
      parsed.companion_manifest_hash || parsed.companionManifestHash,
    );
  } else if (action.id.startsWith('chain.product.publish.')) {
    const parsed = exactEvent(events, 'ItemProductPublishedV6', (entry) => (
      Number(entry.origin_kind ?? entry.originKind) === Number(action.inputs.originKind)
      && Number(entry.access_kind ?? entry.accessKind) === Number(action.inputs.accessKind)
      && Number(entry.binding_kind ?? entry.bindingKind) === Number(action.inputs.bindingKind)
      && String(entry.price_atomic ?? entry.priceAtomic) === String(action.inputs.priceAtomic)
      && Number(entry.maker_ecosystem_fee_bps ?? entry.makerEcosystemFeeBps)
        === Number(action.inputs.makerEcosystemFeeBps)
      && Boolean(entry.transferable) === Boolean(action.inputs.transferable)
      && eventId(entry.publisher) === id(action.authority.signer)
    ));
    confirmation.productId = eventId(parsed.product_id || parsed.productId);
  } else if (action.id.startsWith('chain.product.attest.')) {
    const matches = objectTypeEntries(indexed).filter(([, type]) => (
      String(type).endsWith('::composition_v6::ValidatorAttestationV6')
    ));
    if (matches.length !== 1) fail(
      'COMPOSABLE_V6_CHAIN_READBACK_MISMATCH',
      'Validator attestation transaction must create exactly one ValidatorAttestationV6.',
      { count: matches.length },
    );
    confirmation.attestationId = id(matches[0][0]);
    const response = await suiClient?.getObjects?.({
      objectIds: [confirmation.attestationId],
      include: { json: true, type: true },
    });
    const attestation = resultObjects(response)[0];
    if (!attestation
        || id(field(attestation, 'config_id', 'configId')) !== id(action.inputs.compositionProtocolConfigV6Id)
        || id(field(attestation, 'profile_id', 'profileId')) !== id(action.inputs.profileId)
        || id(field(attestation, 'product_id', 'productId')) !== id(action.inputs.productId)) {
      fail(
        'COMPOSABLE_V6_CHAIN_READBACK_MISMATCH',
        'ValidatorAttestationV6 fields do not match the exact Config, Profile and Product.',
      );
    }
  } else if (action.id === 'chain.profile.seal') {
    exactEvent(events, 'MakerProfileSealedV6', (entry) => (
      eventId(entry.profile_id || entry.profileId) === id(action.inputs.profileId)
    ));
    confirmation.sealedReadback = true;
  } else if (action.id.startsWith('chain.product.admit.')) {
    exactEvent(events, 'ItemAdmittedV6', (entry) => (
      eventId(entry.profile_id || entry.profileId) === id(action.inputs.profileId)
      && eventId(entry.product_id || entry.productId) === id(action.inputs.productId)
      && Number(entry.source_kind ?? entry.sourceKind) === Number(action.inputs.originKind)
      && eventId(entry.attestation_id || entry.attestationId)
        === id(action.inputs.validatorAttestationId)
    ));
    confirmation.admissionReadback = true;
  } else {
    fail('COMPOSABLE_V6_CHAIN_TARGET_UNSUPPORTED', `Unsupported readback action ${action.id}.`);
  }
  return confirmation;
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `web-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function keyFor(plan) {
  return `${STORAGE_PREFIX}${plan.bindingIdentity}`;
}

function save(storage, key, plan, checkpoint) {
  storage?.setItem?.(key, JSON.stringify({ plan, checkpoint }));
}

/**
 * Creates or restores the exact v6 companion release that extends an already
 * Active Commerce v5 MakerRoot. This function only byte-locks local data; it
 * never touches Sui or Walrus, including while the v6 release gate is closed.
 */
export async function prepareComposableV6Publication({
  document,
  baseManifest,
  baseManifestJson,
  baseManifestHash,
  baseMakerRootId,
  makerOwner,
  currentOwnershipEpoch = 0,
  context = {},
  runtime = {},
  storage = globalThis.localStorage,
} = {}) {
  const plan = await buildMakerComposableV6PublicationPlan({
    document,
    baseManifest,
    baseManifestJson,
    baseManifestHash,
    baseMakerRootId,
    makerOwner,
    currentOwnershipEpoch,
    context,
    runtime,
  });
  const key = keyFor(plan);
  const saved = storage?.getItem?.(key);
  const checkpoint = saved
    ? await hydrateMakerComposableV6PublicationCheckpoint(
        JSON.parse(saved).checkpoint || JSON.parse(saved),
        { plan },
      )
    : await createMakerComposableV6PublicationCheckpoint({ plan, nonce: randomNonce() });
  save(storage, key, plan, checkpoint);
  return { key, plan, checkpoint };
}

/**
 * Advances exactly one ordered v6 action. Intent is durably persisted before
 * a chargeable write and the submission receipt is persisted before readback.
 * A submitted checkpoint is confirmation-only, so refresh/retry cannot sign a
 * second transaction. A v6 failure is returned with its own checkpoint and
 * never mutates the completed v5 release.
 */
export async function advanceComposableV6Publication({
  publication,
  runtime = {},
  storage = globalThis.localStorage,
  executeWalrusAction,
  executeSuiAction,
  confirmAction,
  onStatus = () => {},
} = {}) {
  const { key, plan } = publication || {};
  let checkpoint = await hydrateMakerComposableV6PublicationCheckpoint(
    publication?.checkpoint,
    { plan },
  );
  if (checkpoint.completed) return { key, completed: true, plan, checkpoint };

  // The protocol helper checks this again before resolving an action. Keeping
  // this early return guarantees a closed release gate performs zero network
  // requests and zero wallet signatures while retaining its local checkpoint.
  if (runtime?.compositionV6ReleaseEnabled !== true) {
    return { key, gated: true, completed: false, plan, checkpoint };
  }

  let action = await nextMakerComposableV6PublicationAction({ checkpoint, plan, runtime });
  try {
    if (checkpoint.actions[checkpoint.currentActionIndex].status
        === MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.PENDING) {
      checkpoint = await beginMakerComposableV6PublicationAction({ checkpoint, plan, runtime });
      save(storage, key, plan, checkpoint);
    }
    action = await nextMakerComposableV6PublicationAction({ checkpoint, plan, runtime });
    const current = checkpoint.actions[checkpoint.currentActionIndex];
    let submission = current.submission;
    if (current.status === MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.INTENT) {
      onStatus('awaiting-signature', { action });
      const execute = action.transport === 'WALRUS' ? executeWalrusAction : executeSuiAction;
      if (typeof execute !== 'function') {
        throw new Error(`No ${action.transport} executor is configured for ${action.id}.`);
      }
      submission = await execute({ action, plan, checkpoint });
      checkpoint = await markMakerComposableV6PublicationSubmitted({
        checkpoint,
        plan,
        actionId: action.id,
        submission,
      });
      save(storage, key, plan, checkpoint);
    }
    onStatus('confirming', { action, submission });
    if (typeof confirmAction !== 'function') {
      throw new Error(`No readback verifier is configured for ${action.id}.`);
    }
    const confirmation = await confirmAction({ action, plan, checkpoint, submission });
    checkpoint = await confirmMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      actionId: action.id,
      confirmation,
    });
    save(storage, key, plan, checkpoint);
    onStatus(checkpoint.completed ? 'completed' : 'confirmed', { action, checkpoint });
    return { key, completed: checkpoint.completed, plan, checkpoint };
  } catch (error) {
    checkpoint = await recordMakerComposableV6PublicationError({ checkpoint, plan, error });
    save(storage, key, plan, checkpoint);
    return {
      recoverable: true,
      key,
      completed: false,
      actionId: action?.id || '',
      message: error?.message || 'Composable v6 publication failed.',
      error,
      plan,
      checkpoint,
    };
  }
}

export function clearComposableV6Publication(publication, storage = globalThis.localStorage) {
  if (publication?.key) storage?.removeItem?.(publication.key);
}
