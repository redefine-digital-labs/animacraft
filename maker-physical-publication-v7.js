import { normalizeStructTag } from '@mysten/sui/utils';
import { compileMakerV4MoveProjectionV2 } from './maker-publication-v4.js';
import { createItemProductDefinitionV6 } from './maker-composable-v6-bridge.js';
import {
  PHYSICAL_PART_BEHAVIORS,
  STYLE_PRODUCT_ADMISSION_CLASSES,
  STYLE_PRODUCT_SUPPLY_MODES,
  collectPhysicalStyleCatalogV7Issues,
  createPhysicalStyleCatalogV7,
} from './maker-physical-v7.js';
import { getPhysicalStyleCatalogV7Draft } from './maker-physical-v7-workspace.js';

export const MAKER_PHYSICAL_PUBLICATION_V7_SCHEMA =
  'animacraft.maker-physical-publication.v7';
export const MAKER_PHYSICAL_RELEASE_PLAN_V7_SCHEMA =
  'animacraft.maker-physical-release-plan.v7';

export const MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  INTENT: 'INTENT',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
});

export const MAKER_PHYSICAL_PUBLICATION_V7_STAGES = Object.freeze({
  V6_VERIFIED: 'V6_VERIFIED',
  ASSETS_VERIFYING: 'ASSETS_VERIFYING',
  DEFINITIONS_UPLOADING: 'DEFINITIONS_UPLOADING',
  DEFINITIONS_CERTIFYING: 'DEFINITIONS_CERTIFYING',
  PROFILE_CREATING: 'PROFILE_CREATING',
  POLICIES_REGISTERING: 'POLICIES_REGISTERING',
  PROFILE_SEALING: 'PROFILE_SEALING',
  FAMILIES_PUBLISHING: 'FAMILIES_PUBLISHING',
  STYLES_PUBLISHING: 'STYLES_PUBLISHING',
  COMPLETE: 'COMPLETE',
});

export const MAKER_PHYSICAL_V7_MOVE_FUNCTIONS = Object.freeze({
  CREATE_PROFILE: 'create_maker_physical_profile_v7',
  REGISTER_PART_POLICY: 'register_part_policy_v7',
  SEAL_PROFILE: 'seal_maker_physical_profile_v7',
  PUBLISH_FAMILY: 'publish_item_family_v7',
  PUBLISH_EXTERNAL_FAMILY: 'publish_external_item_family_v7',
  PUBLISH_STYLE: 'publish_style_product_v7',
  PUBLISH_EXTERNAL_STYLE: 'publish_external_style_product_v7',
});

export const MAKER_PHYSICAL_V7_TRANSPORTS = Object.freeze({
  WALRUS: 'WALRUS',
  SUI: 'SUI',
});

const SUI_ID = /^0x[0-9a-f]+$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const NONCE = /^[a-zA-Z0-9._:-]{16,256}$/;
const BASE_INCLUDED = 'BASE_INCLUDED';
const PACK_INCLUDED = 'PACK_INCLUDED';
const OPEN_EDITION = 'OPEN_EDITION';
const LIMITED_EDITION = 'LIMITED_EDITION';

const PART_BEHAVIOR_KIND = Object.freeze({
  [PHYSICAL_PART_BEHAVIORS.FIXED]: 0,
  [PHYSICAL_PART_BEHAVIORS.SOUL_LOCAL]: 1,
  [PHYSICAL_PART_BEHAVIORS.OPEN]: 2,
  [PHYSICAL_PART_BEHAVIORS.HYBRID]: 3,
});
const SOURCE_KIND = Object.freeze({
  [STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL]: 0,
  [STYLE_PRODUCT_ADMISSION_CLASSES.CERTIFIED]: 1,
  [STYLE_PRODUCT_ADMISSION_CLASSES.OPEN]: 2,
});

export class MakerPhysicalV7PublicationError extends Error {
  constructor(message, code = 'PHYSICAL_V7_PUBLICATION_ERROR', details = {}) {
    super(message);
    this.name = 'MakerPhysicalV7PublicationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerPhysicalV7PublicationError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return structuredClone(value);
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function required(value, label) {
  const normalized = string(value);
  if (!normalized) fail('PHYSICAL_V7_CONTEXT_MISSING', `${label} is required.`, { label });
  return normalized;
}

function commitment(value, label) {
  const normalized = string(value).replace(/^0x/i, '').toLowerCase();
  if (!HASH.test(normalized)) fail('PHYSICAL_V7_COMMITMENT_INVALID', `${label} must be a 32-byte hexadecimal commitment.`);
  return normalized;
}

function exactId(value, label) {
  const normalized = string(value).toLowerCase();
  if (!SUI_ID.test(normalized)) fail('PHYSICAL_V7_OBJECT_ID_INVALID', `${label} must be a Sui object ID.`);
  return normalized;
}

function outputRef(actionId, field) {
  return { $output: { actionId, field } };
}

function contextRef(field) {
  return { $context: field };
}

function moveTarget(packageId, functionName) {
  return `${required(packageId, 'Callable v7 package ID')}::physical_composition_v7::${functionName}`;
}

function action({
  id,
  stage,
  target,
  inputs,
  outputs,
  policy = null,
  transport = MAKER_PHYSICAL_V7_TRANSPORTS.SUI,
  authority = null,
}) {
  return {
    id,
    stage,
    transport,
    authority: authority || {
      role: 'MAKER',
      signer: contextRef('owner'),
      capability: contextRef('makerControlCapId'),
    },
    target,
    inputs,
    outputs,
    policy,
  };
}

function walrusAction(value) {
  return action({ ...value, transport: MAKER_PHYSICAL_V7_TRANSPORTS.WALRUS });
}

function actionKey(value) {
  return encodeURIComponent(String(value)).replace(/%/g, '_');
}

function tuple(partId, itemId, styleId) {
  return `${partId}\u0000${itemId}\u0000${styleId}`;
}

function v6Action(checkpoint, id) {
  return array(checkpoint?.actions).find((entry) => entry?.id === id) || null;
}

function confirmedV6Output(checkpoint, actionId, field, label) {
  const entry = v6Action(checkpoint, actionId);
  if (entry?.status !== 'CONFIRMED') {
    fail('PHYSICAL_V7_V6_INCOMPLETE', `${label} is not confirmed in the v6 checkpoint.`, { actionId });
  }
  const value = entry?.outputs?.[field] ?? entry?.confirmation?.[field];
  return exactId(value, label);
}

function assertCompletedV6(v6Publication) {
  const plan = object(v6Publication?.plan);
  const checkpoint = object(v6Publication?.checkpoint);
  if (plan.schema !== 'animacraft.maker-composable-release-plan.v6'
      || checkpoint.schema !== 'animacraft.maker-composable-publication.v6'
      || checkpoint.completed !== true
      || checkpoint.planIdentity !== plan.planIdentity
      || checkpoint.bindingIdentity !== plan.bindingIdentity
      || checkpoint.currentActionIndex !== array(plan.actions).length) {
    fail(
      'PHYSICAL_V7_REQUIRES_COMPLETED_V6',
      'Physical Style v7 can only extend the exact completed and byte-locked v6 release.',
    );
  }
  array(checkpoint.actions).forEach((entry, index) => {
    if (entry?.id !== plan.actions[index]?.id || entry?.status !== 'CONFIRMED') {
      fail('PHYSICAL_V7_V6_CHECKPOINT_INVALID', 'Every v6 action must be confirmed before v7 publication.', { index });
    }
  });
  return { plan, checkpoint };
}

function v6ProductMap(v6Plan, v6Checkpoint) {
  const products = new Map();
  array(v6Plan?.companion?.manifest?.items).forEach((product) => {
    const key = actionKey(product.id);
    const publishAction = array(v6Plan.actions).find((entry) => entry.id === `chain.product.publish.${key}`);
    const admissionAction = v6Action(v6Checkpoint, `chain.product.admit.${key}`);
    if (!publishAction || admissionAction?.status !== 'CONFIRMED') {
      fail('PHYSICAL_V7_V6_PRODUCT_NOT_ADMITTED', 'Every physical Style must bind an admitted v6 Product.', { productId: product.id });
    }
    const productObjectId = confirmedV6Output(
      v6Checkpoint,
      publishAction.id,
      'productId',
      `v6 Product ${product.id}`,
    );
    products.set(String(product.id), {
      product,
      productObjectId,
      familyCommitment: commitment(publishAction.inputs?.familyCommitment, `${product.id} family commitment`),
      definitionCommitment: commitment(
        publishAction.inputs?.definitionCommitment,
        `${product.id} definition commitment`,
      ),
      assetCommitment: commitment(
        publishAction.inputs?.assetCommitment,
        `${product.id} asset commitment`,
      ),
      sourceKind: Number(publishAction.inputs?.originKind),
      attestationId: confirmedV6Output(
        v6Checkpoint,
        `chain.product.attest.${key}`,
        'attestationId',
        `v6 Product ${product.id} validator attestation`,
      ),
    });
  });
  return products;
}

async function exactDefinition(v6) {
  const value = createItemProductDefinitionV6(v6.product);
  const json = stableJson(value);
  const hash = await sha256(json);
  if (hash !== v6.definitionCommitment
      || commitment(v6.product?.manifestHash, `${v6.product?.id} manifest hash`) !== hash) {
    fail(
      'PHYSICAL_V7_DEFINITION_COMMITMENT_MISMATCH',
      'The exact canonical v6 ProductDefinition bytes do not match the admitted on-chain definition commitment.',
      { v6ProductId: v6.product?.id, expected: v6.definitionCommitment, actual: hash },
    );
  }
  if (commitment(v6.product?.contentHash, `${v6.product?.id} content hash`) !== v6.assetCommitment) {
    fail(
      'PHYSICAL_V7_ASSET_COMMITMENT_MISMATCH',
      'The exact v6 Product content commitment does not match the admitted on-chain asset commitment.',
      { v6ProductId: v6.product?.id },
    );
  }
  return {
    value,
    json,
    hash,
    byteLength: new TextEncoder().encode(json).byteLength,
  };
}

function sourceOf(product) {
  const components = array(product?.components);
  if (components.length !== 1 || !object(components[0]?.baseSource).partId) {
    fail(
      'PHYSICAL_V7_EXACT_V6_SOURCE_REQUIRED',
      'One v7 Style Product must bind one v6 Product containing exactly one immutable base Style source.',
      { v6ProductId: product?.id },
    );
  }
  return object(components[0].baseSource);
}

function projectionMaps(document) {
  const projection = compileMakerV4MoveProjectionV2(document);
  if (!projection?.commerce) {
    fail('PHYSICAL_V7_COMMERCE_PROJECTION_REQUIRED', 'Physical v7 requires the exact Commerce v5 Style projection.');
  }
  const projectedItems = new Map();
  array(projection.items).forEach((entry) => {
    if (entry.projectionKind !== 'style') return;
    projectedItems.set(tuple(entry.sourcePartId, entry.sourceItemId, entry.sourceStyleId), entry);
  });
  const styleRows = new Map();
  array(projection.commerce.styleProducts).forEach((entry) => {
    styleRows.set(`${entry.partKey}\u0000${entry.itemKey}\u0000${entry.styleKey}`, entry);
  });
  return { projection, projectedItems, styleRows };
}

function baseAssetForSource(baseManifest, source) {
  const part = array(baseManifest?.parts).find((entry) => String(entry?.id) === String(source.partId));
  const item = array(part?.items).find((entry) => String(entry?.id) === String(source.itemId));
  const style = array(item?.styles).find((entry) => String(entry?.id) === String(source.styleId));
  const asset = array(baseManifest?.assets).find((entry) => String(entry?.id) === String(style?.assetId));
  return { style, asset };
}

function exactPngLocator({ entry, baseManifest, baseManifestBlobId }) {
  const component = array(entry.v6.product?.components)[0];
  const expectedHash = commitment(component?.assetHash, `${entry.product.id} PNG hash`);
  const declaredHash = string(entry.product?.exactPng?.contentHash)
    ? commitment(entry.product.exactPng.contentHash, `${entry.product.id} declared PNG hash`)
    : expectedHash;
  if (declaredHash !== expectedHash) {
    fail('PHYSICAL_V7_PNG_HASH_MISMATCH', 'The v7 exact PNG does not match the admitted v6 component hash.', {
      productId: entry.product.id,
    });
  }
  if (Number(entry.product?.exactPng?.width) !== Number(component?.assetWidth)
      || Number(entry.product?.exactPng?.height) !== Number(component?.assetHeight)) {
    fail('PHYSICAL_V7_PNG_DIMENSION_MISMATCH', 'The v7 exact PNG dimensions do not match the admitted v6 component.', {
      productId: entry.product.id,
    });
  }

  if (entry.product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL) {
    const { asset } = baseAssetForSource(baseManifest, entry.source);
    const baseHash = commitment(
      asset?.sha256 || asset?.contentHash || asset?.digest,
      `${entry.product.id} base Maker PNG hash`,
    );
    if (baseHash !== expectedHash) {
      fail(
        'PHYSICAL_V7_BASE_PNG_HASH_MISMATCH',
        'The certified base Maker PNG does not match the exact admitted v6 component.',
        { productId: entry.product.id },
      );
    }
    return {
      blobId: required(baseManifestBlobId, 'Certified base Maker Quilt Blob ID'),
      identifier: required(asset?.identifier, `${entry.product.id} base Maker PNG identifier`),
      expectedHash,
      source: 'BASE_MAKER_QUILT',
    };
  }

  const componentBlobId = required(component?.assetBlobId, `${entry.product.id} external PNG Blob ID`);
  const declaredBlobId = string(entry.product?.exactPng?.blobId);
  if (declaredBlobId && declaredBlobId !== componentBlobId) {
    fail('PHYSICAL_V7_EXTERNAL_PNG_LOCATOR_MISMATCH', 'The v7 external PNG locator differs from its admitted v6 Product.', {
      productId: entry.product.id,
    });
  }
  return {
    blobId: componentBlobId,
    identifier: '',
    expectedHash,
    source: 'EXTERNAL_PRODUCT_BLOB',
  };
}

function definitionGroupKey(entry) {
  return entry.product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL
    ? 'maker'
    : `supplier:${String(entry.product.publisher).toLowerCase()}`;
}

function supplyPolicy(product, projectionRow) {
  if (product.supply.mode === STYLE_PRODUCT_SUPPLY_MODES.INCLUDED) {
    const packKey = string(projectionRow.packId);
    return {
      supplyClass: packKey ? PACK_INCLUDED : BASE_INCLUDED,
      maxSupply: '0',
      packKey,
    };
  }
  if (projectionRow.packId) {
    fail(
      'PHYSICAL_V7_PACK_SUPPLY_MISMATCH',
      'A Style already gated by an Expansion Pack must publish as Pack Included, not as an independently sold Style.',
      { packId: projectionRow.packId, productId: product.id },
    );
  }
  if (product.supply.mode === STYLE_PRODUCT_SUPPLY_MODES.OPEN_EDITION) {
    return { supplyClass: OPEN_EDITION, maxSupply: '0', packKey: '' };
  }
  const cap = Number(product.supply.cap);
  if (!Number.isSafeInteger(cap) || cap < 1) {
    fail('PHYSICAL_V7_SUPPLY_INVALID', 'Limited Edition requires a positive safe supply cap.', { productId: product.id });
  }
  return { supplyClass: LIMITED_EDITION, maxSupply: String(cap), packKey: '' };
}

function partIsRequired(part) {
  return part?.required === true
    || part?.selection?.required === true
    || part?.selectionMode === 'REQUIRED';
}

function derivedPolicy(part, styles) {
  const sourceKinds = styles.map((entry) => SOURCE_KIND[entry.product.admissionClass]);
  const soulLocal = styles.some((entry) => [BASE_INCLUDED, PACK_INCLUDED].includes(entry.supply.supplyClass));
  const owned = styles.some((entry) => ![BASE_INCLUDED, PACK_INCLUDED].includes(entry.supply.supplyClass));
  const behavior = soulLocal && owned
    ? PHYSICAL_PART_BEHAVIORS.HYBRID
    : owned
      ? PHYSICAL_PART_BEHAVIORS.OPEN
      : PHYSICAL_PART_BEHAVIORS.SOUL_LOCAL;
  if (partIsRequired(part) && !soulLocal) {
    fail(
      'PHYSICAL_V7_REQUIRED_PART_NEEDS_INCLUDED_STYLE',
      'A required physical Part needs at least one Base or Pack Included Style.',
      { partId: part.id },
    );
  }
  return {
    partId: String(part.id),
    slotKey: String(styles[0].projection.partKey),
    behavior,
    behaviorKind: PART_BEHAVIOR_KIND[behavior],
    required: partIsRequired(part),
    maxSourceKind: Math.max(...sourceKinds),
  };
}

function normalizeRuntimeContext(runtime, context, v6Plan, profileId) {
  const result = {
    owner: required(context.owner || v6Plan.context?.owner, 'Maker owner'),
    makerControlCapId: exactId(context.makerControlCapId || v6Plan.context?.makerControlCapId, 'MakerControlCapV5'),
    baseMakerRootId: exactId(v6Plan.context?.baseMakerRootId, 'MakerRootV5'),
    v6ProfileId: exactId(profileId, 'MakerProfileV6'),
    callablePackageId: exactId(runtime.callablePackageId || runtime.packageId, 'Callable v7 package'),
    commerceProtocolConfigV5Id: exactId(runtime.commerceProtocolConfigV5Id, 'CommerceProtocolConfigV5'),
    compositionProtocolConfigV6Id: exactId(runtime.compositionProtocolConfigV6Id, 'CompositionProtocolConfigV6'),
    physicalProtocolConfigV7Id: exactId(runtime.physicalProtocolConfigV7Id, 'PhysicalProtocolConfigV7'),
    physicalRegistryV7Id: exactId(runtime.physicalRegistryV7Id, 'PhysicalRegistryV7'),
  };
  if (string(v6Plan.context?.callablePackageId).toLowerCase() !== result.callablePackageId
      || string(v6Plan.context?.commerceProtocolConfigV5Id).toLowerCase() !== result.commerceProtocolConfigV5Id
      || string(v6Plan.context?.compositionProtocolConfigV6Id).toLowerCase() !== result.compositionProtocolConfigV6Id) {
    fail('PHYSICAL_V7_V6_RUNTIME_MISMATCH', 'The v7 runtime does not extend the callable package and protocol objects locked by v6.');
  }
  return result;
}

/**
 * Build the initial read-only, byte-locked v7 release. No network or wallet
 * operation is performed. v6 must already be fully confirmed, so a failed v7
 * extension can never mutate or obscure the working v6 Maker. Independently
 * supplied post-release Styles intentionally use a separate incremental
 * publication checkpoint; they must never be appended to this initial plan.
 */
export async function buildMakerPhysicalV7PublicationPlan({
  document,
  catalog: catalogInput = null,
  v6Publication,
  baseManifest = null,
  baseManifestBlobId = '',
  context = {},
  runtime = {},
} = {}) {
  const { plan: v6Plan, checkpoint: v6Checkpoint } = assertCompletedV6(v6Publication);
  const catalog = createPhysicalStyleCatalogV7(catalogInput || getPhysicalStyleCatalogV7Draft(document));
  const authoringIssues = collectPhysicalStyleCatalogV7Issues(catalog, { publish: false });
  if (!catalog.enabled || authoringIssues.length) {
    fail('PHYSICAL_V7_CATALOG_INVALID', 'Resolve the physical Style catalog before publication.', { issues: authoringIssues });
  }
  const profileId = confirmedV6Output(v6Checkpoint, 'chain.profile.create', 'profileId', 'Completed v6 Profile');
  const planContext = normalizeRuntimeContext(runtime, context, v6Plan, profileId);
  const v6Products = v6ProductMap(v6Plan, v6Checkpoint);
  const { projection, projectedItems, styleRows } = projectionMaps(document);
  const physicalProducts = [];
  const usedV6Ids = new Set();
  const usedV6ObjectIds = new Set();
  for (const family of catalog.families) {
    for (const product of family.styles) {
    const v6 = v6Products.get(String(product.v6ProductId));
    if (!v6) fail('PHYSICAL_V7_V6_PRODUCT_UNKNOWN', 'Style Product references a v6 logical Product outside the completed companion.', { productId: product.id, v6ProductId: product.v6ProductId });
    if (usedV6Ids.has(product.v6ProductId)) fail('PHYSICAL_V7_V6_PRODUCT_DUPLICATE', 'One v6 Product can back only one concrete v7 Style Product.', { v6ProductId: product.v6ProductId });
    if (usedV6ObjectIds.has(v6.productObjectId)) fail('PHYSICAL_V7_V6_PRODUCT_OBJECT_DUPLICATE', 'Two exact v7 Styles cannot reuse one admitted v6 ItemProduct object.', { v6ProductObjectId: v6.productObjectId });
    usedV6Ids.add(product.v6ProductId);
    usedV6ObjectIds.add(v6.productObjectId);
    const source = sourceOf(v6.product);
    if (product.baseSource && tuple(source.partId, source.itemId, source.styleId) !== tuple(product.baseSource.partId, product.baseSource.itemId, product.baseSource.styleId)) {
      fail('PHYSICAL_V7_SOURCE_MISMATCH', 'The v7 Style and admitted v6 Product do not bind the same immutable base Style.', { productId: product.id });
    }
    const projected = projectedItems.get(tuple(source.partId, source.itemId, source.styleId));
    if (!projected) fail('PHYSICAL_V7_STYLE_PROJECTION_MISSING', 'The exact v5 Style projection is missing.', { productId: product.id, source });
    const row = styleRows.get(`${projected.partKey}\u0000${projected.itemKey}\u0000${source.styleId}`);
    if (!row) fail('PHYSICAL_V7_STYLE_ROW_MISSING', 'The exact Commerce v5 Style registry row is missing.', { productId: product.id });
    const supply = supplyPolicy(product, row);
    const expectedSourceKind = SOURCE_KIND[product.admissionClass];
    if (v6.sourceKind !== expectedSourceKind) fail('PHYSICAL_V7_ADMISSION_MISMATCH', 'v7 admission class must equal the admitted v6 Product origin.', { productId: product.id });
    const definition = await exactDefinition(v6);
    const entry = {
      family,
      product,
      v6,
      source,
      projection: { ...projected, ...row },
      supply,
      definition: {
        ...definition,
        identifier: `definitions/${definition.hash}.json`,
      },
    };
    entry.asset = exactPngLocator({ entry, baseManifest, baseManifestBlobId });
    physicalProducts.push(entry);
    }
  }
  if (!physicalProducts.length) fail('PHYSICAL_V7_EMPTY', 'Publish at least one exact physical Style Product.');

  const familyGroups = new Map();
  physicalProducts.forEach((entry) => {
    const familyKey = String(entry.family.id);
    if (!familyGroups.has(familyKey)) familyGroups.set(familyKey, []);
    familyGroups.get(familyKey).push(entry);
  });
  familyGroups.forEach((entries, familyId) => {
    const first = entries[0];
    if (first.product.admissionClass !== STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL
        && String(first.product.publisher).toLowerCase() !== String(first.product.creator).toLowerCase()) {
      fail(
        'PHYSICAL_V7_EXTERNAL_AUTHORITY_INVALID',
        'An external v7 Style supplier must be both the immutable v6 publisher and original creator.',
        { familyId },
      );
    }
    const mismatched = entries.some((entry) => (
      entry.projection.partKey !== first.projection.partKey
      || String(entry.source.partId) !== String(first.source.partId)
      || String(entry.source.itemId) !== String(first.source.itemId)
      || entry.v6.familyCommitment !== first.v6.familyCommitment
      || entry.v6.product.creator !== first.v6.product.creator
      || entry.v6.product.rightsOrigin !== first.v6.product.rightsOrigin
      || entry.product.admissionClass !== first.product.admissionClass
      || entry.product.publisher !== first.product.publisher
    ));
    if (mismatched) fail(
      'PHYSICAL_V7_FAMILY_INCONSISTENT',
      'Every Style in one Item Family must share its source Item, admission authority, v6 family commitment, creator and rights origin.',
      { familyId },
    );
  });

  const byPart = new Map();
  physicalProducts.forEach((entry) => {
    const sourcePartId = String(entry.source.partId);
    if (!byPart.has(sourcePartId)) byPart.set(sourcePartId, []);
    byPart.get(sourcePartId).push(entry);
  });
  const partPolicies = array(document?.parts)
    .filter((part) => byPart.has(String(part.id)))
    .map((part) => derivedPolicy(part, byPart.get(String(part.id))));
  if (partPolicies.length !== byPart.size) fail('PHYSICAL_V7_PART_POLICY_MISSING', 'Every physical Part requires one deterministic policy.');

  const rendererCommitment = commitment(v6Plan.companion?.manifest?.compatibility?.renderer?.commitment, 'v6 renderer commitment');
  const definitionGroups = new Map();
  physicalProducts.forEach((entry) => {
    const groupKey = definitionGroupKey(entry);
    if (!definitionGroups.has(groupKey)) definitionGroups.set(groupKey, []);
    definitionGroups.get(groupKey).push(entry);
    entry.definitionGroupKey = groupKey;
  });
  const actions = [];
  physicalProducts.forEach((entry) => actions.push(walrusAction({
    id: `walrus.asset.verify.${actionKey(entry.product.id)}`,
    stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.ASSETS_VERIFYING,
    authority: {
      role: 'READBACK',
      signer: entry.product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL
        ? contextRef('owner')
        : String(entry.product.publisher),
      capability: null,
    },
    target: 'walrus:verify-certified-file',
    inputs: {
      blobId: entry.asset.blobId,
      identifier: entry.asset.identifier,
      expectedHash: entry.asset.expectedHash,
      contentType: 'image/png',
      width: Number(entry.product.exactPng.width),
      height: Number(entry.product.exactPng.height),
    },
    outputs: ['blobId', 'identifier', 'observedHash', 'certified', 'assetVerified'],
    policy: {
      logicalStyleProductId: entry.product.id,
      source: entry.asset.source,
    },
  })));
  definitionGroups.forEach((entries, groupKey) => {
    const first = entries[0];
    const external = first.product.admissionClass !== STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL;
    const authority = external
      ? { role: 'ITEM_PUBLISHER', signer: String(first.product.publisher), capability: null }
      : { role: 'MAKER', signer: contextRef('owner'), capability: null };
    const key = actionKey(groupKey);
    actions.push(walrusAction({
      id: `walrus.definitions.upload.${key}`,
      stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.DEFINITIONS_UPLOADING,
      authority,
      target: 'walrus:register-and-upload',
      inputs: {
        files: entries.map((entry) => ({
          identifier: entry.definition.identifier,
          contentType: 'application/json',
          manifestJson: entry.definition.json,
          manifestHash: entry.definition.hash,
          byteLength: entry.definition.byteLength,
          logicalStyleProductId: entry.product.id,
        })),
      },
      outputs: ['blobId', 'uploadDigest', 'observedHashes'],
      policy: { groupKey, productIds: entries.map((entry) => entry.product.id) },
    }));
    actions.push(walrusAction({
      id: `walrus.definitions.certify.${key}`,
      stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.DEFINITIONS_CERTIFYING,
      authority,
      target: 'walrus:certify-and-readback',
      inputs: {
        blobId: outputRef(`walrus.definitions.upload.${key}`, 'blobId'),
        files: entries.map((entry) => ({
          identifier: entry.definition.identifier,
          expectedHash: entry.definition.hash,
        })),
      },
      outputs: ['blobId', 'certified', 'observedHashes'],
      policy: { groupKey, productIds: entries.map((entry) => entry.product.id) },
    }));
  });
  actions.push(action({
    id: 'chain.physical-profile.create',
    stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.PROFILE_CREATING,
    target: moveTarget(planContext.callablePackageId, MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.CREATE_PROFILE),
    inputs: {
      physicalRegistryV7Id: contextRef('physicalRegistryV7Id'),
      physicalProtocolConfigV7Id: contextRef('physicalProtocolConfigV7Id'),
      compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
      v6ProfileId: contextRef('v6ProfileId'),
      baseMakerRootId: contextRef('baseMakerRootId'),
      makerControlCapId: contextRef('makerControlCapId'),
      commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
    },
    outputs: ['physicalProfileId', 'transactionDigest', 'readbackVerified'],
  }));
  partPolicies.forEach((policy) => actions.push(action({
    id: `chain.part-policy.register.${actionKey(policy.slotKey)}`,
    stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.POLICIES_REGISTERING,
    target: moveTarget(planContext.callablePackageId, MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.REGISTER_PART_POLICY),
    inputs: {
      physicalProfileId: outputRef('chain.physical-profile.create', 'physicalProfileId'),
      physicalProtocolConfigV7Id: contextRef('physicalProtocolConfigV7Id'),
      baseMakerRootId: contextRef('baseMakerRootId'),
      makerControlCapId: contextRef('makerControlCapId'),
      slotKey: policy.slotKey,
      behaviorKind: policy.behaviorKind,
      required: policy.required,
      maxSourceKind: policy.maxSourceKind,
    },
    outputs: ['transactionDigest', 'policyReadback'],
    policy,
  })));
  actions.push(action({
    id: 'chain.physical-profile.seal',
    stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.PROFILE_SEALING,
    target: moveTarget(planContext.callablePackageId, MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.SEAL_PROFILE),
    inputs: {
      physicalProfileId: outputRef('chain.physical-profile.create', 'physicalProfileId'),
      physicalProtocolConfigV7Id: contextRef('physicalProtocolConfigV7Id'),
      baseMakerRootId: contextRef('baseMakerRootId'),
      makerControlCapId: contextRef('makerControlCapId'),
    },
    outputs: ['transactionDigest', 'sealedReadback'],
  }));
  familyGroups.forEach((entries, familyId) => {
    const first = entries[0];
    const external = first.product.admissionClass !== STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL;
    actions.push(action({
      id: `chain.family.publish.${actionKey(familyId)}`,
      stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.FAMILIES_PUBLISHING,
      target: moveTarget(
        planContext.callablePackageId,
        external
          ? MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.PUBLISH_EXTERNAL_FAMILY
          : MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.PUBLISH_FAMILY,
      ),
      authority: external
        ? { role: 'ITEM_PUBLISHER', signer: String(first.product.publisher), capability: null }
        : null,
      inputs: {
        physicalRegistryV7Id: contextRef('physicalRegistryV7Id'),
        physicalProtocolConfigV7Id: contextRef('physicalProtocolConfigV7Id'),
        compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
        physicalProfileId: outputRef('chain.physical-profile.create', 'physicalProfileId'),
        v6ProfileId: contextRef('v6ProfileId'),
        v6ProductId: first.v6.productObjectId,
        baseMakerRootId: contextRef('baseMakerRootId'),
        ...(external ? {} : { makerControlCapId: contextRef('makerControlCapId') }),
        commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
        familyKey: String(first.source.itemId),
        label: String(first.family.name),
        familyCommitment: first.v6.familyCommitment,
      },
      outputs: ['familyObjectId', 'transactionDigest', 'readbackVerified'],
      policy: {
        logicalFamilyId: familyId,
        slotKey: String(first.projection.partKey),
        sourceItemId: String(first.source.itemId),
        admissionClass: first.product.admissionClass,
      },
    }));
  });
  physicalProducts
    .sort((left, right) => (
      Number(left.projection.renderOrder || 0) - Number(right.projection.renderOrder || 0)
      || String(left.projection.partKey).localeCompare(String(right.projection.partKey))
      || String(left.projection.itemKey).localeCompare(String(right.projection.itemKey))
      || String(left.projection.styleKey).localeCompare(String(right.projection.styleKey))
    ))
    .forEach((entry) => {
      const external = entry.product.admissionClass !== STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL;
      const definitionKey = actionKey(entry.definitionGroupKey);
      actions.push(action({
      id: `chain.style-product.publish.${actionKey(entry.product.id)}`,
      stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.STYLES_PUBLISHING,
      target: moveTarget(
        planContext.callablePackageId,
        external
          ? MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.PUBLISH_EXTERNAL_STYLE
          : MAKER_PHYSICAL_V7_MOVE_FUNCTIONS.PUBLISH_STYLE,
      ),
      authority: external
        ? { role: 'ITEM_PUBLISHER', signer: String(entry.product.publisher), capability: null }
        : null,
      inputs: {
        physicalRegistryV7Id: contextRef('physicalRegistryV7Id'),
        physicalProtocolConfigV7Id: contextRef('physicalProtocolConfigV7Id'),
        compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
        physicalProfileId: outputRef('chain.physical-profile.create', 'physicalProfileId'),
        v6ProfileId: contextRef('v6ProfileId'),
        familyObjectId: outputRef(`chain.family.publish.${actionKey(entry.family.id)}`, 'familyObjectId'),
        v6ProductId: entry.v6.productObjectId,
        baseMakerRootId: contextRef('baseMakerRootId'),
        ...(external ? {} : { makerControlCapId: contextRef('makerControlCapId') }),
        commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
        recipeItemKey: String(entry.projection.itemKey),
        styleKey: String(entry.projection.styleKey),
        label: String(entry.product.name),
        supplyClass: entry.supply.supplyClass,
        maxSupply: entry.supply.maxSupply,
        definitionBlobId: outputRef(`walrus.definitions.certify.${definitionKey}`, 'blobId'),
        definitionIdentifier: entry.definition.identifier,
        definitionHash: entry.definition.hash,
        assetBlobId: entry.asset.blobId,
        assetIdentifier: entry.asset.identifier,
        rendererCommitment,
      },
      outputs: ['styleProductObjectId', 'transactionDigest', 'readbackVerified'],
      policy: {
        logicalStyleProductId: entry.product.id,
        v6LogicalProductId: entry.product.v6ProductId,
        source: clone(entry.source),
        partKey: String(entry.projection.partKey),
        recipeItemKey: String(entry.projection.itemKey),
        familyKey: String(entry.source.itemId),
        styleKey: String(entry.projection.styleKey),
        packKey: entry.supply.packKey,
        supplyClass: entry.supply.supplyClass,
        definitionHash: entry.definition.hash,
        assetHash: entry.asset.expectedHash,
      },
      }));
    });

  const binding = {
    v6PlanIdentity: v6Plan.planIdentity,
    v6BindingIdentity: v6Plan.bindingIdentity,
    v6ProfileId: planContext.v6ProfileId,
    baseMakerRootId: planContext.baseMakerRootId,
    catalogHash: await sha256(stableJson(catalog)),
    rendererCommitment,
    baseManifestBlobId: string(baseManifestBlobId),
  };
  const bindingIdentity = await sha256(stableJson(binding));
  const draft = {
    schema: MAKER_PHYSICAL_RELEASE_PLAN_V7_SCHEMA,
    version: 1,
    binding,
    bindingIdentity,
    context: planContext,
    catalog,
    projection: {
      schemaVersion: projection.schemaVersion,
      partPolicies,
      products: physicalProducts.map((entry) => ({
        logicalStyleProductId: entry.product.id,
        v6LogicalProductId: entry.product.v6ProductId,
        v6ProductObjectId: entry.v6.productObjectId,
        familyId: entry.family.id,
        partKey: String(entry.projection.partKey),
        familyKey: String(entry.source.itemId),
        recipeItemKey: String(entry.projection.itemKey),
        styleKey: String(entry.projection.styleKey),
        packKey: entry.supply.packKey,
        supplyClass: entry.supply.supplyClass,
        definitionHash: entry.definition.hash,
        definitionIdentifier: entry.definition.identifier,
        definitionGroupKey: entry.definitionGroupKey,
        assetBlobId: entry.asset.blobId,
        assetIdentifier: entry.asset.identifier,
        assetHash: entry.asset.expectedHash,
      })),
    },
    summary: {
      partPolicyCount: partPolicies.length,
      familyCount: familyGroups.size,
      styleProductCount: physicalProducts.length,
      baseIncludedCount: physicalProducts.filter((entry) => entry.supply.supplyClass === BASE_INCLUDED).length,
      packIncludedCount: physicalProducts.filter((entry) => entry.supply.supplyClass === PACK_INCLUDED).length,
      purchasableCount: physicalProducts.filter((entry) => [OPEN_EDITION, LIMITED_EDITION].includes(entry.supply.supplyClass)).length,
      definitionQuiltCount: definitionGroups.size,
      assetVerificationCount: physicalProducts.length,
    },
    actions,
  };
  return freeze({ ...draft, planIdentity: await sha256(stableJson(draft)) });
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) fail('PHYSICAL_V7_TIME_INVALID', 'Publication time is invalid.');
  return date.toISOString();
}

export async function createMakerPhysicalV7PublicationCheckpoint({ plan, nonce, createdAt } = {}) {
  if (plan?.schema !== MAKER_PHYSICAL_RELEASE_PLAN_V7_SCHEMA || plan?.version !== 1) {
    fail('PHYSICAL_V7_PLAN_INVALID', 'A supported byte-locked v7 plan is required.');
  }
  const exactNonce = required(nonce, 'Publication recovery nonce');
  if (!NONCE.test(exactNonce)) fail('PHYSICAL_V7_NONCE_INVALID', 'Publication nonce must contain 16-256 safe characters.');
  const recoveryIdentity = await sha256(stableJson({ nonce: exactNonce, bindingIdentity: plan.bindingIdentity, planIdentity: plan.planIdentity }));
  const now = timestamp(createdAt);
  return freeze({
    schema: MAKER_PHYSICAL_PUBLICATION_V7_SCHEMA,
    version: 1,
    sequence: 0,
    nonce: exactNonce,
    recoveryIdentity,
    binding: clone(plan.binding),
    bindingIdentity: plan.bindingIdentity,
    planIdentity: plan.planIdentity,
    stage: MAKER_PHYSICAL_PUBLICATION_V7_STAGES.V6_VERIFIED,
    currentActionIndex: 0,
    actions: plan.actions.map((entry) => ({ id: entry.id, status: MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.PENDING, intentKey: '', submission: null, confirmation: null, outputs: null })),
    completed: false,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function hydrateMakerPhysicalV7PublicationCheckpoint(value, { plan } = {}) {
  if (value?.schema !== MAKER_PHYSICAL_PUBLICATION_V7_SCHEMA || value?.version !== 1
      || plan?.schema !== MAKER_PHYSICAL_RELEASE_PLAN_V7_SCHEMA
      || stableJson(value.binding) !== stableJson(plan.binding)
      || value.bindingIdentity !== plan.bindingIdentity
      || value.planIdentity !== plan.planIdentity) {
    fail('PHYSICAL_V7_CHECKPOINT_SCOPE_MISMATCH', 'The v7 checkpoint belongs to another immutable release.');
  }
  const recoveryIdentity = await sha256(stableJson({ nonce: value.nonce, bindingIdentity: plan.bindingIdentity, planIdentity: plan.planIdentity }));
  if (!NONCE.test(string(value.nonce)) || recoveryIdentity !== value.recoveryIdentity) fail('PHYSICAL_V7_CHECKPOINT_NONCE_MISMATCH', 'The v7 checkpoint recovery identity is invalid.');
  const cursor = Number(value.currentActionIndex);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > plan.actions.length || array(value.actions).length !== plan.actions.length) {
    fail('PHYSICAL_V7_CHECKPOINT_INVALID', 'The v7 checkpoint cursor is invalid.');
  }
  const actions = value.actions.map((entry, index) => {
    if (entry?.id !== plan.actions[index]?.id || !Object.values(MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS).includes(entry?.status)) fail('PHYSICAL_V7_CHECKPOINT_INVALID', 'The v7 checkpoint action list changed.', { index });
    if (index < cursor && entry.status !== MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.CONFIRMED) fail('PHYSICAL_V7_CHECKPOINT_INVALID', 'A prior v7 action is not confirmed.', { index });
    if (index > cursor && entry.status !== MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.PENDING) fail('PHYSICAL_V7_CHECKPOINT_INVALID', 'A future v7 action was mutated out of order.', { index });
    return clone(entry);
  });
  const completed = cursor === plan.actions.length;
  if (Boolean(value.completed) !== completed) fail('PHYSICAL_V7_CHECKPOINT_INVALID', 'The v7 completion flag does not match its cursor.');
  return freeze({ ...clone(value), actions, currentActionIndex: cursor, completed });
}

function assertGate(runtime, plan) {
  if (runtime?.physicalStyleV7ReleaseEnabled !== true) fail('PHYSICAL_V7_RELEASE_DISABLED', 'Physical Style v7 publication is disabled.');
  if (runtime?.compositionV6ReleaseEnabled !== true || runtime?.commerceV5ReleaseEnabled !== true || runtime?.canonicalSoulMintEnabled !== true) {
    fail('PHYSICAL_V7_DEPENDENCY_DISABLED', 'Physical v7 requires active canonical Soul mint, Commerce v5 and Composable v6.');
  }
  if (runtime?.network !== 'mainnet') fail('PHYSICAL_V7_NETWORK_MISMATCH', 'Production physical v7 publication is Mainnet-only.');
  const fields = ['callablePackageId', 'commerceProtocolConfigV5Id', 'compositionProtocolConfigV6Id', 'physicalProtocolConfigV7Id', 'physicalRegistryV7Id'];
  const mismatch = fields.filter((field) => string(runtime?.[field]).toLowerCase() !== string(plan?.context?.[field]).toLowerCase());
  if (mismatch.length) fail('PHYSICAL_V7_RUNTIME_SCOPE_MISMATCH', 'The runtime does not match this byte-locked v7 plan.', { fields: mismatch });
  try {
    if (runtime.physicalV7SoulOwnerProofType) normalizeStructTag(runtime.physicalV7SoulOwnerProofType);
  } catch {
    fail('PHYSICAL_V7_OWNER_PROOF_TYPE_INVALID', 'The physical v7 Soul owner proof type is invalid.');
  }
}

function resolved(value, checkpoint, plan) {
  if (Array.isArray(value)) return value.map((entry) => resolved(entry, checkpoint, plan));
  if (!value || typeof value !== 'object') return value;
  if (value.$context) return plan.context[value.$context];
  if (value.$output) {
    const actionEntry = checkpoint.actions.find((entry) => entry.id === value.$output.actionId);
    if (actionEntry?.status !== MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.CONFIRMED) fail('PHYSICAL_V7_OUTPUT_UNCONFIRMED', 'A v7 action references an unconfirmed output.', value.$output);
    const output = actionEntry.outputs?.[value.$output.field] ?? actionEntry.confirmation?.[value.$output.field];
    if (output === undefined || output === null || output === '') fail('PHYSICAL_V7_OUTPUT_MISSING', 'A confirmed v7 action output is missing.', value.$output);
    return output;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolved(entry, checkpoint, plan)]));
}

export async function nextMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime } = {}) {
  const hydrated = await hydrateMakerPhysicalV7PublicationCheckpoint(checkpoint, { plan });
  assertGate(runtime, plan);
  if (hydrated.completed) return null;
  const planned = plan.actions[hydrated.currentActionIndex];
  return freeze({ ...clone(planned), authority: resolved(planned.authority, hydrated, plan), inputs: resolved(planned.inputs, hydrated, plan) });
}

function mutate(checkpoint, patch, currentPatch = null) {
  const actions = checkpoint.actions.map((entry, index) => index === checkpoint.currentActionIndex && currentPatch ? { ...clone(entry), ...clone(currentPatch) } : clone(entry));
  return { ...clone(checkpoint), ...clone(patch), actions, sequence: Number(checkpoint.sequence || 0) + 1, updatedAt: timestamp() };
}

export async function beginMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime } = {}) {
  const hydrated = await hydrateMakerPhysicalV7PublicationCheckpoint(checkpoint, { plan });
  const actionValue = await nextMakerPhysicalV7PublicationAction({ checkpoint: hydrated, plan, runtime });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (current.status !== MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.PENDING) return hydrated;
  const intentKey = await sha256(stableJson({ recoveryIdentity: hydrated.recoveryIdentity, actionId: actionValue.id, sequence: hydrated.sequence }));
  return freeze(mutate(hydrated, { stage: actionValue.stage, lastError: null }, { status: MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.INTENT, intentKey }));
}

export async function markMakerPhysicalV7PublicationSubmitted({ checkpoint, plan, actionId, submission } = {}) {
  const hydrated = await hydrateMakerPhysicalV7PublicationCheckpoint(checkpoint, { plan });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (current.id !== actionId || current.status !== MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.INTENT) fail('PHYSICAL_V7_SUBMISSION_OUT_OF_ORDER', 'v7 submission is out of order.');
  return freeze(mutate(hydrated, {}, { status: MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.SUBMITTED, submission: clone(submission) }));
}

export async function confirmMakerPhysicalV7PublicationAction({ checkpoint, plan, actionId, confirmation } = {}) {
  const hydrated = await hydrateMakerPhysicalV7PublicationCheckpoint(checkpoint, { plan });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (current.id !== actionId || current.status !== MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.SUBMITTED) fail('PHYSICAL_V7_CONFIRMATION_OUT_OF_ORDER', 'v7 confirmation is out of order.');
  const planned = plan.actions[hydrated.currentActionIndex];
  const outputs = Object.fromEntries(array(planned.outputs).map((field) => {
    const value = confirmation?.[field];
    if (value === undefined || value === null || value === '') fail('PHYSICAL_V7_CONFIRMATION_INCOMPLETE', `Confirmed v7 action is missing ${field}.`, { actionId });
    return [field, clone(value)];
  }));
  const actions = hydrated.actions.map((entry, index) => index === hydrated.currentActionIndex ? { ...clone(entry), status: MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.CONFIRMED, confirmation: clone(confirmation), outputs } : clone(entry));
  const cursor = hydrated.currentActionIndex + 1;
  return freeze({ ...clone(hydrated), sequence: hydrated.sequence + 1, actions, currentActionIndex: cursor, completed: cursor === plan.actions.length, stage: cursor === plan.actions.length ? MAKER_PHYSICAL_PUBLICATION_V7_STAGES.COMPLETE : plan.actions[cursor].stage, lastError: null, updatedAt: timestamp() });
}

export async function recordMakerPhysicalV7PublicationError({ checkpoint, plan, error } = {}) {
  const hydrated = await hydrateMakerPhysicalV7PublicationCheckpoint(checkpoint, { plan });
  return freeze({ ...clone(hydrated), sequence: hydrated.sequence + 1, lastError: { code: string(error?.code) || 'PHYSICAL_V7_ACTION_FAILED', message: string(error?.message) || 'Physical v7 action failed.', actionId: hydrated.actions[hydrated.currentActionIndex]?.id || '', at: timestamp() }, updatedAt: timestamp() });
}

export function physicalV7PublicationObjectIds({ plan, checkpoint } = {}) {
  if (!checkpoint?.completed) fail('PHYSICAL_V7_PUBLICATION_INCOMPLETE', 'Physical v7 publication is not complete.');
  const output = (actionId, field) => checkpoint.actions.find((entry) => entry.id === actionId)?.outputs?.[field];
  return freeze({
    physicalProfileObjectId: exactId(output('chain.physical-profile.create', 'physicalProfileId'), 'Physical Profile'),
    familyObjectIds: Object.fromEntries(plan.projection.products.map((entry) => [entry.familyId, exactId(output(`chain.family.publish.${actionKey(entry.familyId)}`, 'familyObjectId'), `Family ${entry.familyId}`)])),
    styleProductObjectIds: Object.fromEntries(plan.projection.products.map((entry) => [entry.logicalStyleProductId, exactId(output(`chain.style-product.publish.${actionKey(entry.logicalStyleProductId)}`, 'styleProductObjectId'), `Style Product ${entry.logicalStyleProductId}`)])),
    definitionBlobIds: Object.fromEntries(plan.projection.products.map((entry) => [
      entry.logicalStyleProductId,
      required(
        output(`walrus.definitions.certify.${actionKey(entry.definitionGroupKey)}`, 'blobId'),
        `Definition Blob ${entry.logicalStyleProductId}`,
      ),
    ])),
  });
}
