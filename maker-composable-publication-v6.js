import { normalizeStructTag } from '@mysten/sui/utils';
import {
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  ITEM_RIGHTS_ORIGINS,
  THIRD_PARTY_ADMISSION_MODES,
} from './maker-composable-v6.js';
import { buildMakerComposableV6Manifest } from './maker-composable-v6-bridge.js';

export const MAKER_COMPOSABLE_PUBLICATION_V6_SCHEMA =
  'animacraft.maker-composable-publication.v6';
export const MAKER_COMPOSABLE_RELEASE_PLAN_V6_SCHEMA =
  'animacraft.maker-composable-release-plan.v6';

export const MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS = Object.freeze({
  WALRUS: 'WALRUS',
  SUI: 'SUI',
});

export const MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  INTENT: 'INTENT',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
});

export const MAKER_COMPOSABLE_PUBLICATION_V6_STAGES = Object.freeze({
  COMPANION_LOCKED: 'COMPANION_LOCKED',
  WALRUS_UPLOADING: 'WALRUS_UPLOADING',
  WALRUS_CERTIFYING: 'WALRUS_CERTIFYING',
  PROFILE_CREATING: 'PROFILE_CREATING',
  ITEMS_PUBLISHING: 'ITEMS_PUBLISHING',
  ITEMS_ATTESTING: 'ITEMS_ATTESTING',
  PROFILE_SEALING: 'PROFILE_SEALING',
  ITEMS_ADMITTING: 'ITEMS_ADMITTING',
  COMPLETE: 'COMPLETE',
});

/**
 * Audited against move/animacraft/sources/composition_v6.move. Keep these
 * names explicit so an upgraded callable package cannot silently route a v6
 * release through a similarly named or legacy entry point.
 */
export const MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS = Object.freeze({
  CREATE_PROFILE: 'create_maker_profile_v6',
  PUBLISH_OFFICIAL_PRODUCT: 'publish_official_item_product_v6',
  PUBLISH_EXTERNAL_PRODUCT: 'publish_external_item_product_v6',
  PUBLISH_VALIDATOR_ATTESTATION: 'publish_validator_attestation_v6',
  SEAL_PROFILE: 'seal_maker_profile_v6',
  ADMIT_OFFICIAL: 'admit_official_item_v6',
  ADMIT_CERTIFIED: 'admit_certified_item_v6',
  ADMIT_OPEN: 'admit_open_item_v6',
  PROFILE_COMPANION_BLOB_ID: 'profile_companion_manifest_blob_id_v6',
  PROFILE_COMPANION_HASH: 'profile_companion_manifest_hash_v6',
});

const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const SUI_ID = /^0x[0-9a-f]+$/i;
const NONCE = /^[a-zA-Z0-9._:-]{16,256}$/;
const CLOCK_OBJECT_ID = '0x6';
const EMPTY_EXTENSIONS_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const PROFILE_MODE = Object.freeze({ COMPOSABLE: 1 });
const THIRD_PARTY_POLICY = Object.freeze({
  [THIRD_PARTY_ADMISSION_MODES.DISABLED]: 0,
  [THIRD_PARTY_ADMISSION_MODES.CERTIFIED]: 1,
  [THIRD_PARTY_ADMISSION_MODES.OPEN]: 2,
});
const ACCESS_KIND = Object.freeze({
  [ITEM_ACCESS_MODES.EMBEDDED]: 0,
  [ITEM_ACCESS_MODES.FREE_CLAIM]: 1,
  [ITEM_ACCESS_MODES.PAID_ONCE]: 2,
});
const BINDING_KIND = Object.freeze({
  [ITEM_BINDING_MODES.EMBEDDED]: 0,
  [ITEM_BINDING_MODES.ACCOUNT]: 1,
  [ITEM_BINDING_MODES.SOUL_BOUND]: 2,
  [ITEM_BINDING_MODES.OWNED]: 3,
});
const RIGHTS_KIND = Object.freeze({
  [ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE]: 0,
  [ITEM_RIGHTS_ORIGINS.LICENSE_WRAPPED]: 1,
});
const ORIGIN_KIND = Object.freeze({
  [ITEM_ORIGIN_CLASSES.OFFICIAL]: 0,
  [ITEM_ORIGIN_CLASSES.CERTIFIED]: 1,
  [ITEM_ORIGIN_CLASSES.OPEN]: 2,
});

export class MakerComposableV6PublicationError extends Error {
  constructor(message, code = 'COMPOSABLE_V6_PUBLICATION_ERROR', details = {}) {
    super(message);
    this.name = 'MakerComposableV6PublicationError';
    this.code = code;
    this.details = details;
  }
}

function error(code, message, details = {}) {
  throw new MakerComposableV6PublicationError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
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
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value) {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function required(value, label) {
  const result = string(value);
  if (!result) {
    error(
      'COMPOSABLE_V6_PUBLICATION_CONTEXT_MISSING',
      `${label} is required for a recovery-bound v6 release.`,
      { label },
    );
  }
  return result;
}

function commitment(value, label) {
  const result = string(value).replace(/^0x/i, '').toLowerCase();
  if (!HASH.test(result)) {
    error(
      'COMPOSABLE_V6_PUBLICATION_INVALID_COMMITMENT',
      `${label} must be an exact 32-byte hexadecimal commitment.`,
      { label },
    );
  }
  return result;
}

function optionalCommitment(value) {
  return string(value) ? commitment(value, 'extensionsHash') : EMPTY_EXTENSIONS_HASH;
}

function safeSequence(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    error(
      'COMPOSABLE_V6_PUBLICATION_INVALID_SEQUENCE',
      'Publication sequence must be a non-negative safe integer.',
    );
  }
  return result;
}

function asAtomicString(value, label) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    error(
      'COMPOSABLE_V6_PUBLICATION_UNSAFE_INTEGER',
      `${label} must be an exact unsigned integer.`,
    );
  }
  let parsed;
  try {
    parsed = BigInt(value ?? 0);
  } catch {
    error(
      'COMPOSABLE_V6_PUBLICATION_UNSAFE_INTEGER',
      `${label} must be an exact unsigned integer.`,
    );
  }
  if (parsed < 0n || parsed > ((1n << 64n) - 1n)) {
    error(
      'COMPOSABLE_V6_PUBLICATION_UNSAFE_INTEGER',
      `${label} is outside the Sui u64 range.`,
    );
  }
  return parsed.toString();
}

function moveTarget(callablePackageId, functionName) {
  const packageId = string(callablePackageId) || '<callable-package-id>';
  return `${packageId}::composition_v6::${functionName}`;
}

function outputRef(actionId, field) {
  return { $output: { actionId, field } };
}

function contextRef(field) {
  return { $context: field };
}

function action({
  id,
  stage,
  transport,
  authority,
  target,
  inputs,
  outputs,
  policy = null,
}) {
  return {
    id,
    stage,
    transport,
    authority,
    target,
    inputs,
    outputs,
    policy,
  };
}

function productActionKey(productId) {
  return encodeURIComponent(productId).replace(/%/g, '_');
}

function admissionFunction(originClass) {
  if (originClass === ITEM_ORIGIN_CLASSES.OFFICIAL) {
    return MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.ADMIT_OFFICIAL;
  }
  if (originClass === ITEM_ORIGIN_CLASSES.CERTIFIED) {
    return MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.ADMIT_CERTIFIED;
  }
  return MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.ADMIT_OPEN;
}

function topologicalProducts(products) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const dependencies = new Map(products.map((product) => [
    product.id,
    new Set([...array(product.requires), ...array(product.excludes)]),
  ]));
  dependencies.forEach((refs, productId) => refs.forEach((ref) => {
    if (!byId.has(ref)) {
      error(
        'COMPOSABLE_V6_PUBLICATION_UNKNOWN_RULE_TARGET',
        `Item Product ${productId} references ${ref}, which is not locked in this companion release.`,
        { productId, targetProductId: ref },
      );
    }
  }));

  const ordered = [];
  const ready = products
    .filter((product) => dependencies.get(product.id).size === 0)
    .map((product) => product.id)
    .sort();
  const emitted = new Set();
  while (ready.length) {
    const current = ready.shift();
    if (emitted.has(current)) continue;
    emitted.add(current);
    ordered.push(byId.get(current));
    dependencies.forEach((refs, productId) => {
      if (emitted.has(productId)) return;
      refs.delete(current);
      if (refs.size === 0) {
        ready.push(productId);
        ready.sort();
      }
    });
  }
  if (ordered.length !== products.length) {
    const productIds = products
      .map((product) => product.id)
      .filter((productId) => !emitted.has(productId))
      .sort();
    error(
      'COMPOSABLE_V6_PUBLICATION_RULE_CYCLE',
      'On-chain v6 admission requires every rule target to be admitted first; cyclic Item rules cannot be released.',
      { productIds },
    );
  }
  return ordered;
}

function assertOfficialDependencyClosure(products) {
  const originById = new Map(products.map((product) => [
    product.id,
    product.originClass,
  ]));
  products
    .filter((product) => product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL)
    .forEach((product) => {
      const externalTargets = [...array(product.requires), ...array(product.excludes)]
        .filter((targetId) => originById.get(targetId) !== ITEM_ORIGIN_CLASSES.OFFICIAL)
        .sort();
      if (externalTargets.length) {
        error(
          'COMPOSABLE_V6_PUBLICATION_OFFICIAL_DEPENDS_ON_EXTERNAL',
          'Official base Items cannot require or exclude third-party Items. Put the relationship on the third-party Item so the Maker can seal a usable base before optional external signers participate.',
          { productId: product.id, externalTargets },
        );
      }
    });
}

function productPolicy(product) {
  const makerEndorsementRequired = product.originClass !== ITEM_ORIGIN_CLASSES.OPEN;
  return {
    originClass: product.originClass,
    technicalValidation: {
      required: true,
      passed: product.validation?.passed === true,
      manifestAttestationId: string(product.validation?.attestationId),
      validationEpoch: Number(product.validation?.epoch || 0),
      onchainValidatorAttestationRequired: true,
    },
    makerEndorsement: {
      required: makerEndorsementRequired,
      authority: makerEndorsementRequired ? 'MAKER_CONTROL_CAP' : 'NONE',
      certification: makerEndorsementRequired ? clone(product.certification) : null,
    },
    economics: {
      accessMode: product.access.mode,
      accessKind: ACCESS_KIND[product.access.mode],
      bindingMode: product.access.binding,
      bindingKind: BINDING_KIND[product.access.binding],
      priceAtomic: asAtomicString(product.access.priceAtomic, `${product.id} price`),
      makerEcosystemFeeBps: Number(product.makerEcosystemFeeBps || 0),
      transferable: product.access.transferable === true,
      paymentCoinType: contextRef('paymentCoinType'),
    },
  };
}

async function familyCommitment(product, baseMaker) {
  return sha256(stableJson({
    schema: 'animacraft.item-product-family.v6',
    makerRootId: baseMaker.makerRootId,
    productId: product.id,
    creator: product.creator,
  }));
}

function normalizePlanContext(context, runtime, manifest) {
  const baseMaker = manifest.baseMaker;
  if (string(context?.baseMakerRootId)
      && string(context.baseMakerRootId) !== string(baseMaker.makerRootId)) {
    error(
      'COMPOSABLE_V6_PUBLICATION_BASE_ROOT_MISMATCH',
      'The release context does not match the companion MakerRootV5 binding.',
    );
  }
  return {
    makerKey: required(context?.makerKey, 'Maker recovery key'),
    owner: required(context?.owner, 'Current Maker owner'),
    makerControlCapId: string(context?.makerControlCapId),
    // Every Item requires an independent technical attestation. These public
    // authority references must be discovered before the immutable plan is
    // created; an empty placeholder would make the checkpoint unrecoverable.
    validatorCapId: required(context?.validatorCapId, 'Current ValidatorCapV6 object'),
    validatorAddress: required(context?.validatorAddress, 'Current ValidatorCapV6 owner'),
    openAdmissionSubmitter: string(context?.openAdmissionSubmitter)
      || required(context?.owner, 'Current Maker owner'),
    baseMakerRootId: string(baseMaker.makerRootId),
    baseRootMakerId: string(baseMaker.rootMakerId),
    baseVersionId: string(baseMaker.versionId),
    baseVersionNumber: Number(baseMaker.versionNumber),
    baseManifestHash: commitment(baseMaker.manifestHash, 'Base Maker manifest hash'),
    callablePackageId: string(runtime?.callablePackageId || runtime?.packageId),
    commerceProtocolConfigV5Id: string(runtime?.commerceProtocolConfigV5Id),
    compositionV6TypeOriginPackageId: string(runtime?.compositionV6TypeOriginPackageId),
    compositionProtocolConfigV6Id: string(runtime?.compositionProtocolConfigV6Id),
    compositionProtocolTreasuryV6Id: string(runtime?.compositionProtocolTreasuryV6Id),
    compositionRegistryV6Id: string(runtime?.compositionRegistryV6Id),
    compositionV6SoulOwnerProofTypeOriginPackageId: string(
      runtime?.compositionV6SoulOwnerProofTypeOriginPackageId,
    ),
    compositionV6SoulOwnerProofType: string(runtime?.compositionV6SoulOwnerProofType),
    paymentCoinType: string(runtime?.paymentCoinType),
    clockObjectId: string(context?.clockObjectId) || CLOCK_OBJECT_ID,
  };
}

function bindingFrom(planContext, companionManifestHash) {
  return {
    makerKey: planContext.makerKey,
    owner: planContext.owner,
    baseMakerRootId: planContext.baseMakerRootId,
    baseRootMakerId: planContext.baseRootMakerId,
    baseVersionId: planContext.baseVersionId,
    baseVersionNumber: planContext.baseVersionNumber,
    baseManifestHash: planContext.baseManifestHash,
    companionManifestHash,
  };
}

function profileAction(planContext, manifest, companionManifestHash) {
  return action({
    id: 'chain.profile.create',
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.PROFILE_CREATING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI,
    authority: { role: 'MAKER', signer: contextRef('owner'), capability: contextRef('makerControlCapId') },
    target: moveTarget(
      planContext.callablePackageId,
      MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.CREATE_PROFILE,
    ),
    inputs: {
      rootId: contextRef('baseMakerRootId'),
      makerControlCapId: contextRef('makerControlCapId'),
      compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
      commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
      compositionRegistryV6Id: contextRef('compositionRegistryV6Id'),
      mode: PROFILE_MODE.COMPOSABLE,
      itemAssetization: manifest.profile.itemAssetization === true,
      thirdPartyPolicy: THIRD_PARTY_POLICY[manifest.profile.thirdPartyAdmission],
      slotSchemaCommitment: manifest.compatibility.manifestHash,
      rendererCommitment: manifest.compatibility.renderer.commitment,
      companionManifestBlobId: outputRef('walrus.companion.certify', 'blobId'),
      companionManifestHash,
      extensionsHash: optionalCommitment(manifest.profile.extensionsHash),
    },
    outputs: [
      'profileId',
      'companionManifestBlobId',
      'companionManifestHash',
      'transactionDigest',
    ],
    policy: {
      baseMaker: clone(manifest.baseMaker),
      companionManifestHash,
    },
  });
}

async function productActions(planContext, product) {
  const key = productActionKey(product.id);
  const official = product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL;
  const publishId = `chain.product.publish.${key}`;
  const attestationId = `chain.product.attest.${key}`;
  const admissionId = `chain.product.admit.${key}`;
  const requiredProductIds = array(product.requires).map((id) => outputRef(
    `chain.product.publish.${productActionKey(id)}`,
    'productId',
  ));
  const excludedProductIds = array(product.excludes).map((id) => outputRef(
    `chain.product.publish.${productActionKey(id)}`,
    'productId',
  ));
  const commonInputs = {
    profileId: outputRef('chain.profile.create', 'profileId'),
    compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
    commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
    // Item origin is immutable chain truth. Official calls do not consume
    // this value, but retaining it in every action lets finalized-event
    // readback verify the exact manifest class uniformly.
    originKind: ORIGIN_KIND[product.originClass],
    familyCommitment: await familyCommitment(product, {
      makerRootId: planContext.baseMakerRootId,
    }),
    definitionCommitment: product.manifestHash,
    assetCommitment: product.contentHash,
    slotKey: product.slotClaims[0].slotId,
    accessKind: ACCESS_KIND[product.access.mode],
    bindingKind: BINDING_KIND[product.access.binding],
    priceAtomic: asAtomicString(product.access.priceAtomic, `${product.id} price`),
    makerEcosystemFeeBps: Number(product.makerEcosystemFeeBps || 0),
    transferable: product.access.transferable === true,
    requiredProductIds,
    excludedProductIds,
    extensionsHash: optionalCommitment(product.extensionsHash),
  };
  if (official) {
    commonInputs.rootId = contextRef('baseMakerRootId');
    commonInputs.makerControlCapId = contextRef('makerControlCapId');
  } else {
    commonInputs.rightsOrigin = RIGHTS_KIND[product.rightsOrigin];
  }
  const publish = action({
    id: publishId,
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.ITEMS_PUBLISHING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI,
    authority: official
      ? { role: 'MAKER', signer: contextRef('owner'), capability: contextRef('makerControlCapId') }
      : { role: 'ITEM_PUBLISHER', signer: product.publisher, capability: null },
    target: moveTarget(
      planContext.callablePackageId,
      official
        ? MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.PUBLISH_OFFICIAL_PRODUCT
        : MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.PUBLISH_EXTERNAL_PRODUCT,
    ),
    inputs: commonInputs,
    outputs: ['productId', 'transactionDigest'],
    policy: productPolicy(product),
  });

  const attest = action({
    id: attestationId,
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.ITEMS_ATTESTING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI,
    authority: {
      role: 'PROTOCOL_VALIDATOR',
      signer: contextRef('validatorAddress'),
      capability: contextRef('validatorCapId'),
    },
    target: moveTarget(
      planContext.callablePackageId,
      MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.PUBLISH_VALIDATOR_ATTESTATION,
    ),
    inputs: {
      compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
      commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
      validatorCapId: contextRef('validatorCapId'),
      profileId: outputRef('chain.profile.create', 'profileId'),
      productId: outputRef(publishId, 'productId'),
      clockObjectId: contextRef('clockObjectId'),
    },
    outputs: ['attestationId', 'transactionDigest'],
    policy: productPolicy(product),
  });

  const admissionInputs = {
    profileId: outputRef('chain.profile.create', 'profileId'),
    productId: outputRef(publishId, 'productId'),
    validatorAttestationId: outputRef(attestationId, 'attestationId'),
    compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
    commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
    clockObjectId: contextRef('clockObjectId'),
    // Readback-only evidence; Move input order ignores this metadata field.
    originKind: ORIGIN_KIND[product.originClass],
  };
  if (product.originClass !== ITEM_ORIGIN_CLASSES.OPEN) {
    admissionInputs.rootId = contextRef('baseMakerRootId');
    admissionInputs.makerControlCapId = contextRef('makerControlCapId');
  }
  const admit = action({
    id: admissionId,
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.ITEMS_ADMITTING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI,
    authority: product.originClass === ITEM_ORIGIN_CLASSES.OPEN
      ? { role: 'OPEN_SUBMITTER', signer: contextRef('openAdmissionSubmitter'), capability: null }
      : { role: 'MAKER', signer: contextRef('owner'), capability: contextRef('makerControlCapId') },
    target: moveTarget(planContext.callablePackageId, admissionFunction(product.originClass)),
    inputs: admissionInputs,
    outputs: ['transactionDigest', 'admissionReadback'],
    policy: productPolicy(product),
  });
  return { publish, attest, admit };
}

/**
 * Build and byte-lock a previewable release plan. This function performs no
 * Walrus or Sui writes and deliberately works while the runtime gate is off.
 */
export async function buildMakerComposableV6PublicationPlan({
  document,
  baseManifest,
  baseManifestJson,
  baseManifestHash = '',
  baseMakerRootId = '',
  makerOwner = '',
  currentOwnershipEpoch = 0,
  context = {},
  runtime = {},
} = {}) {
  const companionManifest = await buildMakerComposableV6Manifest(document, {
    baseManifest,
    baseManifestJson,
    baseManifestHash,
    baseMakerRootId,
    makerOwner,
    currentOwnershipEpoch,
  });
  if (!companionManifest) {
    error(
      'COMPOSABLE_V6_PUBLICATION_NOT_REQUIRED',
      'This Maker is Fixed or has no v6 companion release.',
    );
  }
  const companionManifestJson = stableJson(companionManifest);
  const companionManifestHash = await sha256(companionManifestJson);
  const planContext = normalizePlanContext({
    ...context,
    owner: context.owner || makerOwner,
    baseMakerRootId,
  }, runtime, companionManifest);
  const binding = bindingFrom(planContext, companionManifestHash);
  const bindingIdentity = await sha256(stableJson(binding));
  assertOfficialDependencyClosure(companionManifest.items);
  const orderedProducts = topologicalProducts(companionManifest.items);

  const walrusUpload = action({
    id: 'walrus.companion.upload',
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.WALRUS_UPLOADING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.WALRUS,
    authority: { role: 'MAKER', signer: contextRef('owner'), capability: null },
    target: 'walrus:register-and-upload',
    inputs: {
      identifier: 'animacraft-composable-v6.json',
      contentType: 'application/json',
      manifestJson: companionManifestJson,
      manifestHash: companionManifestHash,
      byteLength: new TextEncoder().encode(companionManifestJson).byteLength,
    },
    outputs: ['blobId', 'uploadDigest', 'observedHash'],
  });
  const walrusCertify = action({
    id: 'walrus.companion.certify',
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.WALRUS_CERTIFYING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.WALRUS,
    authority: { role: 'MAKER', signer: contextRef('owner'), capability: null },
    target: 'walrus:certify-and-readback',
    inputs: {
      blobId: outputRef('walrus.companion.upload', 'blobId'),
      manifestHash: companionManifestHash,
    },
    outputs: ['blobId', 'certified', 'observedHash'],
  });

  const perProduct = [];
  for (const product of orderedProducts) {
    perProduct.push({
      product,
      actions: await productActions(planContext, product),
    });
  }
  const officialProducts = perProduct.filter(({ product }) => (
    product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL
  ));
  const externalProducts = perProduct.filter(({ product }) => (
    product.originClass !== ITEM_ORIGIN_CLASSES.OFFICIAL
  ));
  const createProfile = profileAction(planContext, companionManifest, companionManifestHash);
  const sealProfile = action({
    id: 'chain.profile.seal',
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.PROFILE_SEALING,
    transport: MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI,
    authority: { role: 'MAKER', signer: contextRef('owner'), capability: contextRef('makerControlCapId') },
    target: moveTarget(
      planContext.callablePackageId,
      MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.SEAL_PROFILE,
    ),
    inputs: {
      profileId: outputRef('chain.profile.create', 'profileId'),
      rootId: contextRef('baseMakerRootId'),
      makerControlCapId: contextRef('makerControlCapId'),
      compositionProtocolConfigV6Id: contextRef('compositionProtocolConfigV6Id'),
      commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
    },
    outputs: ['transactionDigest', 'sealedReadback'],
    policy: { immutableAfterConfirmation: true },
  });
  const actions = [
    walrusUpload,
    walrusCertify,
    createProfile,
    ...officialProducts.map((entry) => entry.actions.publish),
    ...officialProducts.map((entry) => entry.actions.attest),
    sealProfile,
    ...officialProducts.map((entry) => entry.actions.admit),
    ...externalProducts.flatMap((entry) => [
      entry.actions.publish,
      entry.actions.attest,
      entry.actions.admit,
    ]),
  ];
  const draft = {
    schema: MAKER_COMPOSABLE_RELEASE_PLAN_V6_SCHEMA,
    version: 1,
    binding,
    bindingIdentity,
    context: planContext,
    companion: {
      schemaVersion: companionManifest.schemaVersion,
      manifest: companionManifest,
      manifestJson: companionManifestJson,
      manifestHash: companionManifestHash,
    },
    summary: {
      itemCount: orderedProducts.length,
      officialCount: orderedProducts.filter((item) => item.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL).length,
      certifiedCount: orderedProducts.filter((item) => item.originClass === ITEM_ORIGIN_CLASSES.CERTIFIED).length,
      openCount: orderedProducts.filter((item) => item.originClass === ITEM_ORIGIN_CLASSES.OPEN).length,
      paidCount: orderedProducts.filter((item) => item.access.mode === ITEM_ACCESS_MODES.PAID_ONCE).length,
      ownedCount: orderedProducts.filter((item) => item.access.binding === ITEM_BINDING_MODES.OWNED).length,
      validatorAttestationCount: orderedProducts.length,
      makerEndorsementCount: orderedProducts.filter((item) => item.originClass !== ITEM_ORIGIN_CLASSES.OPEN).length,
      baseOfficialCount: officialProducts.length,
      postSealExternalCount: externalProducts.length,
    },
    actions,
  };
  const planIdentity = await sha256(stableJson(draft));
  return freeze({ ...draft, planIdentity });
}

function checkpointBinding(plan) {
  if (plan?.schema !== MAKER_COMPOSABLE_RELEASE_PLAN_V6_SCHEMA || plan?.version !== 1) {
    error(
      'COMPOSABLE_V6_RELEASE_PLAN_INVALID',
      'A supported byte-locked v6 release plan is required.',
    );
  }
  return {
    binding: clone(plan.binding),
    bindingIdentity: required(plan.bindingIdentity, 'Plan binding identity'),
    planIdentity: required(plan.planIdentity, 'Plan identity'),
  };
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    error('COMPOSABLE_V6_PUBLICATION_INVALID_TIME', 'Publication time is invalid.');
  }
  return date.toISOString();
}

export async function createMakerComposableV6PublicationCheckpoint({
  plan,
  nonce,
  createdAt,
} = {}) {
  const identity = checkpointBinding(plan);
  const normalizedNonce = required(nonce, 'Publication nonce');
  if (!NONCE.test(normalizedNonce)) {
    error(
      'COMPOSABLE_V6_PUBLICATION_INVALID_NONCE',
      'Publication nonce must contain 16-256 safe, non-whitespace characters.',
    );
  }
  const recoveryIdentity = await sha256(stableJson({
    nonce: normalizedNonce,
    bindingIdentity: identity.bindingIdentity,
    planIdentity: identity.planIdentity,
  }));
  const now = timestamp(createdAt);
  return freeze({
    schema: MAKER_COMPOSABLE_PUBLICATION_V6_SCHEMA,
    version: 1,
    sequence: 0,
    nonce: normalizedNonce,
    recoveryIdentity,
    ...identity,
    stage: MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.COMPANION_LOCKED,
    currentActionIndex: 0,
    actions: plan.actions.map((entry) => ({
      id: entry.id,
      transport: entry.transport,
      status: MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.PENDING,
      intentKey: '',
      submission: null,
      confirmation: null,
      outputs: null,
    })),
    completed: false,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function hydrateMakerComposableV6PublicationCheckpoint(
  value,
  { plan } = {},
) {
  const identity = checkpointBinding(plan);
  if (value?.schema !== MAKER_COMPOSABLE_PUBLICATION_V6_SCHEMA || value?.version !== 1) {
    error(
      'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
      'The saved v6 publication checkpoint is unsupported.',
    );
  }
  if (stableJson(value.binding) !== stableJson(identity.binding)
      || value.bindingIdentity !== identity.bindingIdentity
      || value.planIdentity !== identity.planIdentity) {
    error(
      'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_SCOPE_MISMATCH',
      'The checkpoint belongs to a different Maker root, version, base hash, or companion hash.',
    );
  }
  const expectedRecoveryIdentity = await sha256(stableJson({
    nonce: value.nonce,
    bindingIdentity: identity.bindingIdentity,
    planIdentity: identity.planIdentity,
  }));
  if (!NONCE.test(string(value.nonce)) || value.recoveryIdentity !== expectedRecoveryIdentity) {
    error(
      'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_NONCE_MISMATCH',
      'The checkpoint recovery nonce is invalid for this exact release.',
    );
  }
  const sequence = safeSequence(value.sequence);
  const currentActionIndex = Number(value.currentActionIndex);
  if (!Number.isSafeInteger(currentActionIndex)
      || currentActionIndex < 0
      || currentActionIndex > plan.actions.length
      || !Array.isArray(value.actions)
      || value.actions.length !== plan.actions.length) {
    error(
      'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
      'The saved v6 checkpoint action cursor is invalid.',
    );
  }
  const actions = value.actions.map((entry, index) => {
    const planned = plan.actions[index];
    if (entry?.id !== planned.id
        || entry?.transport !== planned.transport
        || !Object.values(MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS).includes(entry?.status)) {
      error(
        'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
        'The saved v6 checkpoint action list does not match the locked release plan.',
        { index },
      );
    }
    if (index < currentActionIndex
        && entry.status !== MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.CONFIRMED) {
      error(
        'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
        'A completed publication action is not confirmed.',
        { index, actionId: entry.id },
      );
    }
    if (index > currentActionIndex
        && entry.status !== MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.PENDING) {
      error(
        'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
        'A future publication action was mutated out of order.',
        { index, actionId: entry.id },
      );
    }
    if (index === currentActionIndex
        && currentActionIndex < plan.actions.length
        && entry.status === MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.CONFIRMED) {
      error(
        'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
        'A confirmed publication action must advance the checkpoint cursor atomically.',
        { index, actionId: entry.id },
      );
    }
    return clone(entry);
  });
  const completed = currentActionIndex === plan.actions.length;
  if (Boolean(value.completed) !== completed) {
    error(
      'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_INVALID',
      'The saved v6 checkpoint completion flag does not match its cursor.',
    );
  }
  return freeze({
    ...clone(value),
    sequence,
    currentActionIndex,
    actions,
    completed,
  });
}

export function serializeMakerComposableV6PublicationCheckpoint(checkpoint) {
  return JSON.stringify(checkpoint);
}

function validSuiId(value) {
  return SUI_ID.test(string(value));
}

function assertRuntimeGate(runtime) {
  if (runtime?.compositionV6ReleaseEnabled !== true) {
    error(
      'COMPOSABLE_V6_RELEASE_DISABLED',
      'Composable Assets v6 chain release is disabled. The locked plan remains previewable and recoverable.',
    );
  }
  if (runtime?.network !== 'mainnet') {
    error(
      'COMPOSABLE_V6_RUNTIME_NETWORK_MISMATCH',
      'Production Composable Assets v6 publication is restricted to Sui Mainnet.',
    );
  }
  const ids = [
    'callablePackageId',
    'commerceProtocolConfigV5Id',
    'compositionV6TypeOriginPackageId',
    'compositionProtocolConfigV6Id',
    'compositionProtocolTreasuryV6Id',
    'compositionRegistryV6Id',
    'compositionV6SoulOwnerProofTypeOriginPackageId',
  ];
  const missing = ids.filter((field) => !validSuiId(runtime?.[field]));
  if (missing.length) {
    error(
      'COMPOSABLE_V6_RUNTIME_INCOMPLETE',
      'Composable Assets v6 chain release requires its complete reviewed package/object tuple.',
      { fields: missing },
    );
  }
  if (runtime?.commerceV5ReleaseEnabled !== true
      || runtime?.canonicalSoulMintEnabled !== true
      || !string(runtime?.compositionV6SoulOwnerProofType)
      || !string(runtime?.paymentCoinType)) {
    error(
      'COMPOSABLE_V6_RUNTIME_DEPENDENCY_DISABLED',
      'Composable Assets v6 requires active Commerce v5, canonical Soul minting, and the exact Soul owner proof type.',
    );
  }
  const soulOwnerProofTypeOrigin = string(
    runtime?.compositionV6SoulOwnerProofTypeOriginPackageId,
  );
  let actualProofType = '';
  let expectedProofType = '';
  try {
    actualProofType = normalizeStructTag(runtime.compositionV6SoulOwnerProofType);
    expectedProofType = normalizeStructTag(
      `${soulOwnerProofTypeOrigin}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
    );
  } catch {
    // Report the same fail-closed error below.
  }
  if (!soulOwnerProofTypeOrigin || actualProofType !== expectedProofType) {
    error(
      'COMPOSABLE_V6_RUNTIME_PROOF_TYPE_MISMATCH',
      'The v6 release runtime must use the exact Soulidity AnimacraftSoulOwnerProofV6 TypeOrigin.',
    );
  }
}

function assertRuntimeMatchesPlan(runtime, plan) {
  const fields = [
    'callablePackageId',
    'commerceProtocolConfigV5Id',
    'compositionV6TypeOriginPackageId',
    'compositionProtocolConfigV6Id',
    'compositionProtocolTreasuryV6Id',
    'compositionRegistryV6Id',
    'compositionV6SoulOwnerProofTypeOriginPackageId',
    'compositionV6SoulOwnerProofType',
    'paymentCoinType',
  ];
  const mismatches = fields.filter((field) => (
    string(runtime?.[field]) !== string(plan?.context?.[field])
  ));
  if (mismatches.length) {
    error(
      'COMPOSABLE_V6_RUNTIME_SCOPE_MISMATCH',
      'The active runtime does not match the package, objects, proof type, and payment coin byte-locked by this release plan.',
      { fields: mismatches },
    );
  }
}

function assertResolvedChainAuthority(actionValue) {
  if (!validSuiId(actionValue?.authority?.signer)) {
    error(
      'COMPOSABLE_V6_CHAIN_AUTHORITY_INVALID',
      'The current v6 chain action requires an explicit Sui signer address.',
      { actionId: actionValue?.id, role: actionValue?.authority?.role },
    );
  }
  if (actionValue?.authority?.capability !== null
      && !validSuiId(actionValue?.authority?.capability)) {
    error(
      'COMPOSABLE_V6_CHAIN_CAPABILITY_INVALID',
      'The current v6 chain action requires its exact on-chain capability object.',
      { actionId: actionValue?.id, role: actionValue?.authority?.role },
    );
  }
  if (!validSuiId(actionValue?.inputs?.compositionProtocolConfigV6Id)) {
    error(
      'COMPOSABLE_V6_CHAIN_INPUT_INVALID',
      'The current v6 chain action is not bound to a valid CompositionProtocolConfigV6 object.',
      { actionId: actionValue?.id },
    );
  }
  if (!validSuiId(actionValue?.inputs?.commerceProtocolConfigV5Id)) {
    error(
      'COMPOSABLE_V6_CHAIN_INPUT_INVALID',
      'The current v6 chain action is not bound to a valid CommerceProtocolConfigV5 emergency gate object.',
      { actionId: actionValue?.id },
    );
  }
}

function outputFor(checkpoint, actionId, field) {
  const actionState = checkpoint.actions.find((entry) => entry.id === actionId);
  if (actionState?.status !== MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.CONFIRMED) {
    return undefined;
  }
  return actionState.outputs?.[field];
}

function resolveValue(value, checkpoint, plan, path = 'inputs') {
  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveValue(entry, checkpoint, plan, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return value;
  if (value.$context) {
    const result = plan.context?.[value.$context];
    if (result === undefined || result === null || result === '') {
      error(
        'COMPOSABLE_V6_ACTION_INPUT_UNRESOLVED',
        `Publication action input ${path} requires context.${value.$context}.`,
        { path, contextField: value.$context },
      );
    }
    return result;
  }
  if (value.$output) {
    const result = outputFor(checkpoint, value.$output.actionId, value.$output.field);
    if (result === undefined || result === null || result === '') {
      error(
        'COMPOSABLE_V6_ACTION_INPUT_UNRESOLVED',
        `Publication action input ${path} requires a confirmed earlier result.`,
        { path, ...value.$output },
      );
    }
    return result;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    resolveValue(entry, checkpoint, plan, `${path}.${key}`),
  ]));
}

export async function nextMakerComposableV6PublicationAction({
  checkpoint,
  plan,
  runtime = {},
} = {}) {
  const hydrated = await hydrateMakerComposableV6PublicationCheckpoint(checkpoint, { plan });
  if (hydrated.completed) return null;
  const planned = plan.actions[hydrated.currentActionIndex];
  // Both Walrus registration/certification and Sui submission are chargeable
  // production writes. The release gate permits neither; only byte-locking and
  // checkpoint creation remain available while disabled.
  assertRuntimeGate(runtime);
  assertRuntimeMatchesPlan(runtime, plan);
  const state = hydrated.actions[hydrated.currentActionIndex];
  const resolved = {
    ...clone(planned),
    status: state.status,
    intentKey: state.intentKey,
    inputs: resolveValue(planned.inputs, hydrated, plan),
    authority: resolveValue(planned.authority, hydrated, plan, 'authority'),
  };
  if (planned.transport === MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI) {
    assertResolvedChainAuthority(resolved);
  }
  return freeze(resolved);
}

function replaceCurrent(checkpoint, actionState, now, extras = {}) {
  const actions = checkpoint.actions.map((entry, index) => (
    index === checkpoint.currentActionIndex ? actionState : entry
  ));
  return freeze({
    ...clone(checkpoint),
    ...extras,
    sequence: checkpoint.sequence + 1,
    actions,
    updatedAt: timestamp(now),
  });
}

export async function beginMakerComposableV6PublicationAction({
  checkpoint,
  plan,
  runtime = {},
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PublicationCheckpoint(checkpoint, { plan });
  const resolved = await nextMakerComposableV6PublicationAction({
    checkpoint: hydrated,
    plan,
    runtime,
  });
  if (!resolved) return hydrated;
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (current.status !== MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.PENDING) {
    return hydrated;
  }
  const intentKey = await sha256(stableJson({
    recoveryIdentity: hydrated.recoveryIdentity,
    actionId: resolved.id,
  }));
  return replaceCurrent(hydrated, {
    ...current,
    status: MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.INTENT,
    intentKey,
  }, now, { stage: resolved.stage, lastError: null });
}

function requireCurrent(checkpoint, plan, actionId) {
  if (checkpoint.completed) {
    error('COMPOSABLE_V6_PUBLICATION_COMPLETE', 'The v6 release is already complete.');
  }
  const planned = plan.actions[checkpoint.currentActionIndex];
  const state = checkpoint.actions[checkpoint.currentActionIndex];
  if (planned?.id !== actionId || state?.id !== actionId) {
    error(
      'COMPOSABLE_V6_PUBLICATION_OUT_OF_ORDER',
      'Publication actions must be recorded in the locked plan order.',
      { expected: planned?.id, received: actionId },
    );
  }
  return { planned, state };
}

export async function markMakerComposableV6PublicationSubmitted({
  checkpoint,
  plan,
  actionId,
  submission,
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PublicationCheckpoint(checkpoint, { plan });
  const { state } = requireCurrent(hydrated, plan, actionId);
  if (state.status !== MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.INTENT) {
    error(
      'COMPOSABLE_V6_PUBLICATION_INTENT_MISSING',
      'Persist the exact action intent before recording a submission.',
    );
  }
  if (!submission || typeof submission !== 'object') {
    error(
      'COMPOSABLE_V6_PUBLICATION_SUBMISSION_INVALID',
      'A durable submission receipt is required.',
    );
  }
  return replaceCurrent(hydrated, {
    ...state,
    status: MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.SUBMITTED,
    submission: clone(submission),
  }, now);
}

function validateConfirmation(planned, confirmation, plan, checkpoint) {
  const evidence = object(confirmation);
  if (planned.transport === MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI) {
    if (!string(evidence.transactionDigest) || evidence.readbackVerified !== true) {
      error(
        'COMPOSABLE_V6_CHAIN_READBACK_REQUIRED',
        'A Sui action is confirmed only after its transaction digest and object/event readback are verified.',
      );
    }
    if (planned.id === 'chain.profile.seal' && evidence.sealedReadback !== true) {
      error(
        'COMPOSABLE_V6_CHAIN_READBACK_REQUIRED',
        'MakerProfileV6 sealing is confirmed only after sealed=true readback.',
      );
    }
    if (planned.id.startsWith('chain.product.admit.')
        && evidence.admissionReadback !== true) {
      error(
        'COMPOSABLE_V6_CHAIN_READBACK_REQUIRED',
        'Item admission is confirmed only after the exact Product is present in the MakerProfileV6 admission table.',
      );
    }
  } else {
    if (!string(evidence.blobId)
        || commitment(evidence.observedHash, 'Walrus observed hash') !== plan.companion.manifestHash) {
      error(
        'COMPOSABLE_V6_WALRUS_READBACK_MISMATCH',
        'Walrus readback must match the exact locked companion bytes.',
      );
    }
    if (planned.id === 'walrus.companion.certify') {
      const uploadedBlobId = outputFor(checkpoint, 'walrus.companion.upload', 'blobId');
      if (evidence.certified !== true || evidence.blobId !== uploadedBlobId) {
        error(
          'COMPOSABLE_V6_WALRUS_CERTIFICATION_REQUIRED',
          'The exact uploaded companion Blob must be certified before any Sui action.',
        );
      }
    }
  }
  const outputs = {};
  planned.outputs.forEach((field) => {
    if (evidence[field] !== undefined) outputs[field] = clone(evidence[field]);
  });
  if (planned.transport === MAKER_COMPOSABLE_PUBLICATION_V6_TRANSPORTS.SUI) {
    outputs.transactionDigest ||= evidence.transactionDigest;
  }
  if (planned.id === 'chain.profile.create' && !validSuiId(outputs.profileId)) {
    error('COMPOSABLE_V6_CHAIN_OUTPUT_MISSING', 'Profile creation readback must return profileId.');
  }
  if (planned.id === 'chain.profile.create') {
    const uploadedBlobId = outputFor(checkpoint, 'walrus.companion.certify', 'blobId');
    const observedHash = string(outputs.companionManifestHash).replace(/^0x/i, '').toLowerCase();
    if (outputs.companionManifestBlobId !== uploadedBlobId
        || observedHash !== plan.companion.manifestHash) {
      error(
        'COMPOSABLE_V6_PROFILE_COMPANION_READBACK_MISMATCH',
        'MakerProfileV6 must read back the exact certified Walrus companion Blob ID and manifest hash.',
      );
    }
  }
  if (planned.id.startsWith('chain.product.publish.') && !validSuiId(outputs.productId)) {
    error('COMPOSABLE_V6_CHAIN_OUTPUT_MISSING', 'Item publication readback must return productId.');
  }
  if (planned.id.startsWith('chain.product.attest.') && !validSuiId(outputs.attestationId)) {
    error('COMPOSABLE_V6_CHAIN_OUTPUT_MISSING', 'Validator readback must return attestationId.');
  }
  return outputs;
}

export async function confirmMakerComposableV6PublicationAction({
  checkpoint,
  plan,
  actionId,
  confirmation,
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PublicationCheckpoint(checkpoint, { plan });
  const { planned, state } = requireCurrent(hydrated, plan, actionId);
  if (![MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.INTENT,
    MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.SUBMITTED].includes(state.status)) {
    error(
      'COMPOSABLE_V6_PUBLICATION_INTENT_MISSING',
      'Recover or submit the persisted action intent before confirmation.',
    );
  }
  const outputs = validateConfirmation(planned, confirmation, plan, hydrated);
  const nextIndex = hydrated.currentActionIndex + 1;
  const completed = nextIndex === plan.actions.length;
  const actions = hydrated.actions.map((entry, index) => (
    index === hydrated.currentActionIndex
      ? {
          ...entry,
          status: MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.CONFIRMED,
          confirmation: clone(confirmation),
          outputs,
        }
      : entry
  ));
  return freeze({
    ...clone(hydrated),
    sequence: hydrated.sequence + 1,
    stage: completed
      ? MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.COMPLETE
      : plan.actions[nextIndex].stage,
    currentActionIndex: nextIndex,
    actions,
    completed,
    lastError: null,
    updatedAt: timestamp(now),
  });
}

export async function recordMakerComposableV6PublicationError({
  checkpoint,
  plan,
  error: failure,
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PublicationCheckpoint(checkpoint, { plan });
  return freeze({
    ...clone(hydrated),
    sequence: hydrated.sequence + 1,
    lastError: {
      code: string(failure?.code) || 'COMPOSABLE_V6_PUBLICATION_ACTION_FAILED',
      message: string(failure?.message) || 'Composable v6 publication action failed.',
      actionId: plan.actions[hydrated.currentActionIndex]?.id || '',
      at: timestamp(now),
    },
    updatedAt: timestamp(now),
  });
}
