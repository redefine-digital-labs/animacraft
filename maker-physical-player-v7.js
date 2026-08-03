import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import {
  MAKER_V4_COMMERCE_STYLE_ROW_V5,
  flattenMakerV4RecipeV2,
} from './maker-publication-v4.js';
import { createItemProductDefinitionV6 } from './maker-composable-v6-bridge.js';

export const PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA =
  'animacraft.physical-trusted-player.v7';
export const PHYSICAL_V7_INITIAL_LOADOUT_SCHEMA =
  'animacraft.physical-initial-loadout.v7';

const SUI_ID = /^0x[0-9a-f]+$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const MAX_TABLE_ROWS = 5_000;

const SuiIdV7Bcs = bcs.struct('ID', { bytes: bcs.Address });
const InitialPhysicalAuthorizationHashInputV7Bcs = bcs.struct(
  'InitialPhysicalAuthorizationHashInputV7',
  {
    version: bcs.u64(),
    config_id: SuiIdV7Bcs,
    profile_id: SuiIdV7Bcs,
    v6_profile_id: SuiIdV7Bcs,
    root_id: SuiIdV7Bcs,
    recipe_hash: bcs.vector(bcs.u8()),
    visual_recipe_indices: bcs.vector(bcs.u64()),
    style_product_ids: bcs.vector(SuiIdV7Bcs),
  },
);

export class MakerPhysicalPlayerV7Error extends Error {
  constructor(message, code = 'PHYSICAL_PLAYER_V7_ERROR', details = {}) {
    super(message);
    this.name = 'MakerPhysicalPlayerV7Error';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerPhysicalPlayerV7Error(message, code, details);
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

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
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

function string(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const source = object(value);
  const nested = source.value || source.bytes || source.fields || source.vec?.[0];
  return nested === undefined ? '' : string(nested);
}

function exactId(value, label) {
  const normalized = string(value).toLowerCase();
  if (!SUI_ID.test(normalized)) fail('PHYSICAL_V7_OBJECT_ID_INVALID', `${label} must be an exact Sui object ID.`);
  return normalizeSuiAddress(normalized);
}

function optionalId(value) {
  const normalized = string(value).toLowerCase();
  return SUI_ID.test(normalized) ? normalizeSuiAddress(normalized) : '';
}

function exactHash(value, label) {
  const normalized = string(value).replace(/^0x/i, '').toLowerCase();
  if (!HASH.test(normalized)) fail('PHYSICAL_V7_HASH_INVALID', `${label} must be an exact 32-byte hash.`);
  return normalized;
}

function hashBytes(value, label) {
  return exactHash(value, label).match(/.{2}/g).map((byte) => Number.parseInt(byte, 16));
}

function bytesHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  return bytesHex(await crypto.subtle.digest('SHA-256', bytes));
}

function field(fieldsValue, ...names) {
  for (const name of names) if (fieldsValue?.[name] !== undefined) return fieldsValue[name];
  return undefined;
}

function fields(value) {
  const json = object(value?.json);
  const source = Object.keys(json).length ? json : object(value);
  return object(source.fields && typeof source.fields === 'object' ? source.fields : source);
}

function id(value) {
  if (typeof value === 'string') return optionalId(value);
  if (Array.isArray(value)) return value.map(id).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  const source = object(value);
  const nested = source.id || source.bytes || source.address || source.fields || source.vec || source.some;
  return nested === undefined ? '' : id(nested);
}

function bool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
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

async function getObjects(client, objectIds) {
  const ids = [...new Set(objectIds.map(optionalId).filter(Boolean))];
  const result = [];
  for (let index = 0; index < ids.length; index += 50) {
    const page = await client.getObjects({
      objectIds: ids.slice(index, index + 50),
      include: { json: true, previousTransaction: true },
    });
    result.push(...array(page?.objects).filter((entry) => entry && !entry.error));
  }
  return result;
}

async function scanTable(client, tableId) {
  const parentId = optionalId(tableId);
  if (!parentId) fail('PHYSICAL_V7_TABLE_MISSING', 'A required Physical v7 Table ID is missing.');
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
    if (rows.length > MAX_TABLE_ROWS) fail('PHYSICAL_V7_TABLE_LIMIT', 'A Physical v7 table exceeded the bounded query limit.');
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor);
  const missing = rows.filter((row) => !row?.value?.json).map((row) => id(row?.fieldId)).filter(Boolean);
  const wrappers = new Map((await getObjects(client, missing)).map((entry) => [id(entry.objectId || entry.id), entry]));
  return rows.map((row) => {
    const wrapper = wrappers.get(id(row?.fieldId));
    const source = fields(wrapper || row?.value || row);
    return {
      fieldId: id(row?.fieldId || wrapper?.objectId || wrapper?.id),
      name: field(source, 'name') ?? row?.name?.json ?? row?.name,
      value: field(source, 'value') ?? row?.value?.json ?? row?.value,
    };
  });
}

function normalizeProfile(value, objectId) {
  const source = fields(value);
  return {
    objectId: id(objectId || field(source, 'id')),
    configObjectId: id(field(source, 'config_id', 'configId')),
    v6ProfileObjectId: id(field(source, 'v6_profile_id', 'v6ProfileId')),
    makerRootObjectId: id(field(source, 'root_id', 'rootId')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rendererCommitment: hex(field(source, 'renderer_commitment', 'rendererCommitment')),
    sealed: bool(field(source, 'sealed')),
  };
}

function normalizeV6Profile(value, objectId) {
  const source = fields(value);
  return {
    objectId: id(objectId || field(source, 'id')),
    configObjectId: id(field(source, 'config_id', 'configId')),
    makerRootObjectId: id(field(source, 'root_id', 'rootId')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rendererCommitment: hex(field(source, 'renderer_commitment', 'rendererCommitment')),
    admissionsTableId: id(field(source, 'admissions')),
    sealed: bool(field(source, 'sealed')),
  };
}

function normalizeFamily(value, objectId) {
  const source = fields(value);
  return {
    objectId: id(objectId || field(source, 'id')),
    configObjectId: id(field(source, 'config_id', 'configId')),
    profileObjectId: id(field(source, 'profile_id', 'profileId')),
    seedV6ProductObjectId: id(field(source, 'seed_v6_product_id', 'seedV6ProductId')),
    creator: id(field(source, 'creator')),
    slotKey: string(field(source, 'slot_key', 'slotKey')),
    familyKey: string(field(source, 'family_key', 'familyKey')),
    familyCommitment: hex(field(source, 'family_commitment', 'familyCommitment')),
  };
}

function normalizeStyleProduct(value, objectId) {
  const source = fields(value);
  return {
    objectId: id(objectId || field(source, 'id')),
    configObjectId: id(field(source, 'config_id', 'configId')),
    profileObjectId: id(field(source, 'profile_id', 'profileId')),
    v6ProfileObjectId: id(field(source, 'v6_profile_id', 'v6ProfileId')),
    familyObjectId: id(field(source, 'family_id', 'familyId')),
    v6ProductObjectId: id(field(source, 'v6_product_id', 'v6ProductId')),
    originalCreator: id(field(source, 'original_creator', 'originalCreator')),
    slotKey: string(field(source, 'slot_key', 'slotKey')),
    styleKey: string(field(source, 'style_key', 'styleKey')),
    recipeItemKey: string(field(source, 'recipe_item_key', 'recipeItemKey')),
    sourceKind: integer(field(source, 'source_kind', 'sourceKind')),
    entitlementKind: integer(field(source, 'entitlement_kind', 'entitlementKind')),
    supplyKind: integer(field(source, 'supply_kind', 'supplyKind')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: hex(field(source, 'asset_commitment', 'assetCommitment')),
    definitionBlobId: string(field(source, 'definition_blob_id', 'definitionBlobId')),
    definitionIdentifier: string(field(source, 'definition_identifier', 'definitionIdentifier')),
    assetBlobId: string(field(source, 'asset_blob_id', 'assetBlobId')),
    assetIdentifier: string(field(source, 'asset_identifier', 'assetIdentifier')),
    rendererCommitment: hex(field(source, 'renderer_commitment', 'rendererCommitment')),
    active: bool(field(source, 'active')),
  };
}

function normalizeV6Product(value, objectId) {
  const source = fields(value);
  return {
    objectId: id(objectId || field(source, 'id')),
    configObjectId: id(field(source, 'config_id', 'configId')),
    publisher: id(field(source, 'publisher')),
    originalCreator: id(field(source, 'original_creator', 'originalCreator')),
    originKind: integer(field(source, 'origin_kind', 'originKind')),
    familyCommitment: hex(field(source, 'family_commitment', 'familyCommitment')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: hex(field(source, 'asset_commitment', 'assetCommitment')),
    slotKey: string(field(source, 'slot_key', 'slotKey')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    rightsOrigin: integer(field(source, 'rights_origin', 'rightsOrigin')),
    accessKind: integer(field(source, 'access_kind', 'accessKind')),
    bindingKind: integer(field(source, 'binding_kind', 'bindingKind')),
    priceAtomic: string(field(source, 'price_atomic', 'priceAtomic')),
    makerEcosystemFeeBps: integer(field(source, 'maker_ecosystem_fee_bps', 'makerEcosystemFeeBps')),
    transferable: bool(field(source, 'transferable')),
    requiredProductIds: array(field(source, 'required_product_ids', 'requiredProductIds')).map(id),
    excludedProductIds: array(field(source, 'excluded_product_ids', 'excludedProductIds')).map(id),
  };
}

function normalizeAdmission(row) {
  const source = fields(row.value);
  return {
    productObjectId: id(row.name),
    sourceKind: integer(field(source, 'source_kind', 'sourceKind')),
    attestationObjectId: id(field(source, 'attestation_id', 'attestationId')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    assetCommitment: hex(field(source, 'asset_commitment', 'assetCommitment')),
    slotKey: string(field(source, 'slot_key', 'slotKey')),
    rightsOrigin: integer(field(source, 'rights_origin', 'rightsOrigin')),
    accessKind: integer(field(source, 'access_kind', 'accessKind')),
    bindingKind: integer(field(source, 'binding_kind', 'bindingKind')),
    priceAtomic: string(field(source, 'price_atomic', 'priceAtomic')),
    makerEcosystemFeeBps: integer(field(source, 'maker_ecosystem_fee_bps', 'makerEcosystemFeeBps')),
    transferable: bool(field(source, 'transferable')),
    requiredProductIds: array(field(source, 'required_product_ids', 'requiredProductIds')).map(id),
    excludedProductIds: array(field(source, 'excluded_product_ids', 'excludedProductIds')).map(id),
    publisher: id(field(source, 'publisher')),
    active: bool(field(source, 'active')),
  };
}

function normalizeAttestation(value, objectId) {
  const source = fields(value);
  return {
    objectId: id(objectId || field(source, 'id')),
    configObjectId: id(field(source, 'config_id', 'configId')),
    profileObjectId: id(field(source, 'profile_id', 'profileId')),
    productObjectId: id(field(source, 'product_id', 'productId')),
    definitionCommitment: hex(field(source, 'definition_commitment', 'definitionCommitment')),
    slotSchemaCommitment: hex(field(source, 'slot_schema_commitment', 'slotSchemaCommitment')),
    validatorPolicyCommitment: hex(field(source, 'validator_policy_commitment', 'validatorPolicyCommitment')),
    validatorEpoch: integer(field(source, 'validator_epoch', 'validatorEpoch')),
    issuedAtMs: integer(field(source, 'issued_at_ms', 'issuedAtMs')),
  };
}

function componentOfV6Definition(product) {
  const components = array(product?.components);
  const source = object(components[0]?.baseSource);
  if (components.length !== 1) {
    fail('PHYSICAL_V7_V6_COMPONENT_INVALID', 'Each physical v7 Style must resolve to one exact PNG component.');
  }
  const hasBaseSource = Boolean(string(source.partId) && string(source.itemId) && string(source.styleId));
  return { component: components[0], source: hasBaseSource ? source : null };
}

function assertSameId(actual, expected, code, message) {
  if (optionalId(actual) !== optionalId(expected)) fail(code, message, { actual, expected });
}

function sameIds(left, right) {
  const leftIds = array(left).map(optionalId);
  const rightIds = array(right).map(optionalId);
  return leftIds.length === rightIds.length
    && leftIds.every((entry, index) => entry === rightIds[index]);
}

function assertV6Admission({ admission, product, attestation, profile, config, runtime }) {
  const configObjectId = optionalId(runtime.compositionProtocolConfigV6Id);
  if (!admission || admission.active !== true || !attestation
      || admission.sourceKind !== product.originKind
      || admission.definitionCommitment !== product.definitionCommitment
      || admission.assetCommitment !== product.assetCommitment
      || admission.slotKey !== product.slotKey
      || admission.rightsOrigin !== product.rightsOrigin
      || admission.accessKind !== product.accessKind
      || admission.bindingKind !== product.bindingKind
      || admission.priceAtomic !== product.priceAtomic
      || admission.makerEcosystemFeeBps !== product.makerEcosystemFeeBps
      || admission.transferable !== product.transferable
      || admission.publisher !== product.publisher
      || !sameIds(admission.requiredProductIds, product.requiredProductIds)
      || !sameIds(admission.excludedProductIds, product.excludedProductIds)
      || product.configObjectId !== configObjectId
      || product.slotSchemaCommitment !== profile.slotSchemaCommitment
      || attestation.configObjectId !== configObjectId
      || attestation.profileObjectId !== profile.objectId
      || attestation.productObjectId !== product.objectId
      || attestation.definitionCommitment !== product.definitionCommitment
      || attestation.slotSchemaCommitment !== product.slotSchemaCommitment
      || attestation.validatorPolicyCommitment !== config.validatorPolicyCommitment
      || attestation.validatorEpoch !== config.validatorEpoch
      || attestation.issuedAtMs < 0) {
    fail('PHYSICAL_V7_V6_ADMISSION_INVALID', 'A StyleProduct is not backed by the exact active v6 admission and validator attestation.', {
      productObjectId: product?.objectId,
    });
  }
}

/**
 * Gate-aware, fail-closed chain/Walrus hydration for Player Complete. The gate
 * return deliberately precedes all client and loader access.
 */
export async function hydratePhysicalV7PlayerState({
  runtime = {},
  client,
  makerRootObjectId,
  v6Trusted,
  definitionLoader,
  assetLoader,
} = {}) {
  if (runtime?.physicalStyleV7ReleaseEnabled !== true) return null;
  if (!client || typeof definitionLoader !== 'function' || typeof assetLoader !== 'function') {
    fail('PHYSICAL_V7_RUNTIME_MISSING', 'Physical v7 requires Sui and exact Walrus byte loaders.');
  }
  if (v6Trusted?.trusted !== true) {
    fail('PHYSICAL_V7_V6_TRUST_REQUIRED', 'Physical v7 requires the trusted sealed v6 catalog.');
  }
  const physicalProtocolConfigObjectId = exactId(
    runtime.physicalProtocolConfigV7Id,
    'PhysicalProtocolConfigV7',
  );
  const physicalRegistryObjectId = exactId(runtime.physicalRegistryV7Id, 'PhysicalRegistryV7');
  const v6ProfileObjectId = exactId(v6Trusted.profileObjectId, 'MakerProfileV6');
  const makerRootId = exactId(makerRootObjectId, 'MakerRootV5');
  const protocolObjects = await getObjects(client, [
    physicalProtocolConfigObjectId,
    physicalRegistryObjectId,
    runtime.compositionProtocolConfigV6Id,
    v6ProfileObjectId,
  ]);
  const byId = new Map(protocolObjects.map((entry) => [id(entry.objectId || entry.id), entry]));
  const config = byId.get(physicalProtocolConfigObjectId);
  const registry = byId.get(physicalRegistryObjectId);
  const v6ConfigObject = byId.get(optionalId(runtime.compositionProtocolConfigV6Id));
  const v6ProfileObject = byId.get(v6ProfileObjectId);
  if (!config || !registry || !v6ConfigObject || !v6ProfileObject) {
    fail('PHYSICAL_V7_PROTOCOL_UNAVAILABLE', 'Physical v7 and its canonical v6 protocol/profile objects are not visible.');
  }
  const configFields = fields(config);
  const registryFields = fields(registry);
  const v6ConfigFields = fields(v6ConfigObject);
  const v6Config = {
    validatorPolicyCommitment: hex(field(v6ConfigFields, 'validator_policy_commitment', 'validatorPolicyCommitment')),
    validatorEpoch: integer(field(v6ConfigFields, 'validator_epoch', 'validatorEpoch')),
    enabled: bool(field(v6ConfigFields, 'enabled')),
  };
  if (bool(field(configFields, 'enabled')) !== true
      || id(field(configFields, 'registry_id', 'registryId')) !== physicalRegistryObjectId
      || id(field(configFields, 'v6_config_id', 'v6ConfigId')) !== optionalId(runtime.compositionProtocolConfigV6Id)
      || id(field(configFields, 'v5_config_id', 'v5ConfigId')) !== optionalId(runtime.commerceProtocolConfigV5Id)
      || id(field(registryFields, 'config_id', 'configId')) !== physicalProtocolConfigObjectId
      || v6Config.enabled !== true
      || !v6Config.validatorPolicyCommitment
      || v6Config.validatorEpoch < 0) {
    fail('PHYSICAL_V7_PROTOCOL_DISABLED', 'Physical v7 is disabled or its v5/v6 protocol tuple differs.');
  }

  const profileRows = await scanTable(client, id(field(registryFields, 'profiles')));
  const profileRow = profileRows.find((row) => id(row.name) === v6ProfileObjectId);
  if (!profileRow) fail('PHYSICAL_V7_PROFILE_NOT_FOUND', 'This v6 Maker has no physical v7 profile.');
  const profileObjectId = exactId(id(profileRow.value), 'MakerPhysicalProfileV7');
  const profileObject = (await getObjects(client, [profileObjectId]))[0];
  const profile = normalizeProfile(profileObject, profileObjectId);
  const v6Profile = normalizeV6Profile(v6ProfileObject, v6ProfileObjectId);
  if (profile.sealed !== true) fail('PHYSICAL_V7_PROFILE_NOT_SEALED', 'The physical v7 profile is not sealed.');
  assertSameId(profile.configObjectId, physicalProtocolConfigObjectId, 'PHYSICAL_V7_PROFILE_CONFIG_MISMATCH', 'Physical profile config mismatch.');
  assertSameId(profile.v6ProfileObjectId, v6ProfileObjectId, 'PHYSICAL_V7_PROFILE_V6_MISMATCH', 'Physical profile v6 binding mismatch.');
  assertSameId(profile.makerRootObjectId, makerRootId, 'PHYSICAL_V7_PROFILE_ROOT_MISMATCH', 'Physical profile Maker root mismatch.');
  if (v6Profile.sealed !== true
      || v6Profile.configObjectId !== optionalId(runtime.compositionProtocolConfigV6Id)
      || v6Profile.makerRootObjectId !== makerRootId
      || profile.slotSchemaCommitment !== v6Profile.slotSchemaCommitment
      || profile.rendererCommitment !== v6Profile.rendererCommitment) {
    fail('PHYSICAL_V7_PROFILE_COMMITMENT_MISMATCH', 'Physical profile renderer/slot commitment differs from v6.');
  }

  // The v6 companion is immutable and intentionally does not grow when an
  // independently admitted supplier publishes later. Discover physical Styles
  // from the v7 registry, then prove every backing ItemProduct through the live
  // sealed v6 admission/attestation tables instead of assuming companion
  // membership.
  const allStyleRows = await scanTable(client, id(field(registryFields, 'style_products')));
  const allStyleObjects = await getObjects(client, allStyleRows.map((row) => id(row.value)));
  const normalizedStyles = allStyleObjects
    .map((entry) => normalizeStyleProduct(entry, entry.objectId || entry.id))
    .filter((entry) => entry.profileObjectId === profileObjectId);
  if (!normalizedStyles.length) fail('PHYSICAL_V7_STYLE_COVERAGE_INCOMPLETE', 'The sealed physical profile has no StyleProducts.');
  const registryStyleRowByV6 = new Map(allStyleRows.map((row) => [id(row.name), id(row.value)]));
  if (new Set(normalizedStyles.map((entry) => entry.v6ProductObjectId)).size !== normalizedStyles.length
      || new Set(normalizedStyles.map((entry) => entry.objectId)).size !== normalizedStyles.length) {
    fail('PHYSICAL_V7_STYLE_IDENTITY_DUPLICATE', 'Physical v7 returned duplicate StyleProduct or v6 Product identities.');
  }
  normalizedStyles.forEach((entry) => {
    if (registryStyleRowByV6.get(entry.v6ProductObjectId) !== entry.objectId) {
      fail('PHYSICAL_V7_STYLE_REGISTRY_SUBSTITUTION', 'The v7 registry row does not bind this exact v6 Product to this exact StyleProduct.');
    }
  });
  const v6ProductObjects = await getObjects(client, normalizedStyles.map((entry) => entry.v6ProductObjectId));
  const v6ProductsById = new Map(v6ProductObjects.map((entry) => {
    const normalized = normalizeV6Product(entry, entry.objectId || entry.id);
    return [normalized.objectId, normalized];
  }));
  if (v6ProductsById.size !== normalizedStyles.length) {
    fail('PHYSICAL_V7_V6_PRODUCTS_MISSING', 'A StyleProduct backing ItemProductV6 is not visible.');
  }
  const admissionRows = await scanTable(client, v6Profile.admissionsTableId);
  const admissionByProduct = new Map(admissionRows.map((row) => {
    const normalized = normalizeAdmission(row);
    return [normalized.productObjectId, normalized];
  }));
  const attestationObjects = await getObjects(
    client,
    normalizedStyles.map((entry) => admissionByProduct.get(entry.v6ProductObjectId)?.attestationObjectId),
  );
  const attestationById = new Map(attestationObjects.map((entry) => {
    const normalized = normalizeAttestation(entry, entry.objectId || entry.id);
    return [normalized.objectId, normalized];
  }));
  const familyObjects = await getObjects(client, normalizedStyles.map((entry) => entry.familyObjectId));
  const families = familyObjects.map((entry) => normalizeFamily(entry, entry.objectId || entry.id));
  const familyById = new Map(families.map((entry) => [entry.objectId, entry]));
  if (familyById.size !== new Set(normalizedStyles.map((entry) => entry.familyObjectId)).size) {
    fail('PHYSICAL_V7_FAMILY_COVERAGE_INCOMPLETE', 'A physical v7 StyleProduct family is missing.');
  }

  const verifiedStyles = [];
  for (const style of normalizedStyles) {
    const v6Product = v6ProductsById.get(style.v6ProductObjectId);
    const admission = admissionByProduct.get(style.v6ProductObjectId);
    const attestation = attestationById.get(admission?.attestationObjectId);
    assertV6Admission({
      admission,
      product: v6Product,
      attestation,
      profile: v6Profile,
      config: v6Config,
      runtime,
    });
    const family = familyById.get(style.familyObjectId);
    assertSameId(style.configObjectId, physicalProtocolConfigObjectId, 'PHYSICAL_V7_STYLE_CONFIG_MISMATCH', 'StyleProduct config mismatch.');
    assertSameId(style.profileObjectId, profileObjectId, 'PHYSICAL_V7_STYLE_PROFILE_MISMATCH', 'StyleProduct profile mismatch.');
    assertSameId(style.v6ProfileObjectId, v6ProfileObjectId, 'PHYSICAL_V7_STYLE_V6_PROFILE_MISMATCH', 'StyleProduct v6 profile mismatch.');
    if (style.active !== true || !family
        || family.profileObjectId !== profileObjectId
        || family.slotKey !== style.slotKey
        || family.creator !== v6Product.originalCreator
        || family.familyCommitment !== v6Product.familyCommitment
        || style.slotKey !== v6Product.slotKey
        || style.originalCreator !== v6Product.originalCreator
        || style.sourceKind !== v6Product.originKind
        || style.definitionCommitment !== v6Product.definitionCommitment
        || style.assetCommitment !== v6Product.assetCommitment
        || style.rendererCommitment !== profile.rendererCommitment) {
      fail('PHYSICAL_V7_STYLE_BINDING_MISMATCH', 'A physical v7 StyleProduct differs from its immutable v6 Product/family/profile.');
    }
    if (!style.definitionBlobId || !style.assetBlobId) {
      fail('PHYSICAL_V7_STYLE_LOCATOR_MISSING', 'A physical v7 StyleProduct is missing immutable definition or PNG locators.');
    }
    const definitionBytes = await definitionLoader({
      blobId: style.definitionBlobId,
      identifier: style.definitionIdentifier,
      expectedHash: style.definitionCommitment,
    });
    if (!(definitionBytes instanceof Uint8Array)
        || await sha256(definitionBytes) !== style.definitionCommitment) {
      fail('PHYSICAL_V7_DEFINITION_HASH_MISMATCH', 'Canonical ProductDefinition bytes do not match StyleProductV7.');
    }
    let definition;
    try { definition = JSON.parse(new TextDecoder().decode(definitionBytes)); } catch {
      fail('PHYSICAL_V7_DEFINITION_INVALID', 'Canonical ProductDefinition bytes are not valid JSON.');
    }
    const canonicalDefinition = stableJson(createItemProductDefinitionV6(definition));
    if (new TextDecoder().decode(definitionBytes) !== canonicalDefinition
        || stableJson(definition) !== canonicalDefinition) {
      fail('PHYSICAL_V7_DEFINITION_CANONICAL_MISMATCH', 'Walrus ProductDefinition is not the exact canonical v6 definition.');
    }
    const logicalId = string(definition.id);
    const { component, source } = componentOfV6Definition(definition);
    const definitionComponent = array(definition.components)[0];
    if (array(definition.components).length !== 1
        || array(definition.slotClaims).length !== 1
        || string(definition.slotClaims[0]?.slotId) !== style.slotKey
        || exactHash(definition.contentHash, `${logicalId} content commitment`) !== v6Product.assetCommitment
        || optionalId(definition.creator) !== v6Product.originalCreator
        || optionalId(definition.publisher) !== v6Product.publisher
        || string(definitionComponent?.assetHash) !== exactHash(component.assetHash, `${logicalId} PNG hash`)) {
      fail('PHYSICAL_V7_DEFINITION_COMPONENT_MISMATCH', 'ProductDefinition does not resolve to the exact one PNG component.');
    }
    const assetBytes = await assetLoader({
      blobId: style.assetBlobId,
      identifier: style.assetIdentifier,
      expectedHash: exactHash(component.assetHash, `${logicalId} PNG hash`),
    });
    if (!(assetBytes instanceof Uint8Array)
        || await sha256(assetBytes) !== exactHash(component.assetHash, `${logicalId} PNG hash`)) {
      fail('PHYSICAL_V7_ASSET_HASH_MISMATCH', 'The exact PNG bytes do not match the canonical ProductDefinition.');
    }
    verifiedStyles.push({
      ...style,
      logicalV6ProductId: logicalId,
      sourcePartId: string(source?.partId),
      sourceItemId: string(source?.itemId),
      sourceStyleId: string(source?.styleId),
      familyKey: family.familyKey,
      definitionVerified: true,
      assetVerified: true,
    });
  }

  return freeze({
    schemaVersion: PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA,
    version: 7,
    trusted: true,
    queryVerified: true,
    physicalProtocolConfigObjectId,
    physicalRegistryObjectId,
    physicalProfileObjectId: profileObjectId,
    v6ProfileObjectId,
    makerRootObjectId: makerRootId,
    slotSchemaCommitment: profile.slotSchemaCommitment,
    rendererCommitment: profile.rendererCommitment,
    sealed: true,
    families: clone(families),
    styleProducts: clone(verifiedStyles),
  });
}

/** Exact SHA-256(BCS) used by InitialPhysicalAuthorizationHashInputV7. */
export async function hashPhysicalV7InitialAuthorization({
  physicalProtocolConfigObjectId,
  physicalProfileObjectId,
  v6ProfileObjectId,
  makerRootObjectId,
  recipeHash,
  visualRecipeIndices,
  initialStyleProductObjectIds,
} = {}) {
  const bytes = InitialPhysicalAuthorizationHashInputV7Bcs.serialize({
    version: 7,
    config_id: { bytes: normalizeSuiAddress(exactId(physicalProtocolConfigObjectId, 'PhysicalProtocolConfigV7')) },
    profile_id: { bytes: normalizeSuiAddress(exactId(physicalProfileObjectId, 'MakerPhysicalProfileV7')) },
    v6_profile_id: { bytes: normalizeSuiAddress(exactId(v6ProfileObjectId, 'MakerProfileV6')) },
    root_id: { bytes: normalizeSuiAddress(exactId(makerRootObjectId, 'MakerRootV5')) },
    recipe_hash: hashBytes(recipeHash, 'Complete recipe hash'),
    visual_recipe_indices: array(visualRecipeIndices).map((value) => BigInt(value)),
    style_product_ids: array(initialStyleProductObjectIds).map((value) => ({
      bytes: normalizeSuiAddress(exactId(value, 'StyleProductV7')),
    })),
  }).toBytes();
  return sha256(bytes);
}

/** Retain only chain/Walrus verified fields across the Complete OC boundary. */
export function createPhysicalV7CompletionSnapshot(trusted) {
  if (trusted === null || trusted === undefined) return null;
  if (trusted?.schemaVersion !== PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA
      || trusted?.trusted !== true
      || trusted?.queryVerified !== true
      || trusted?.sealed !== true) {
    fail('PHYSICAL_V7_TRUST_SNAPSHOT_INVALID', 'A sealed query-verified physical v7 state is required.');
  }
  // External Free/Paid Styles are wardrobe acquisitions after the Soul exists
  // and can legitimately have no baseSource or v5 row. Only Included Styles
  // can participate in the canonical Complete authorization snapshot.
  const included = array(trusted.styleProducts).filter((style) => Number(style?.supplyKind) === 0);
  const styleProducts = included.map((style, index) => {
    if (style?.definitionVerified !== true || style?.assetVerified !== true) {
      fail('PHYSICAL_V7_TRUSTED_STYLE_UNVERIFIED', `Physical Style ${index + 1} was not verified from chain and Walrus.`);
    }
    return {
      objectId: exactId(style.objectId, `Physical Style ${index + 1}`),
      familyObjectId: exactId(style.familyObjectId, `Physical Style ${index + 1} family`),
      v6ProductObjectId: exactId(style.v6ProductObjectId, `Physical Style ${index + 1} v6 Product`),
      slotKey: string(style.slotKey),
      recipeItemKey: string(style.recipeItemKey),
      styleKey: string(style.styleKey),
      definitionVerified: true,
      assetVerified: true,
    };
  });
  if (!styleProducts.length
      || styleProducts.some((style) => !style.slotKey || !style.recipeItemKey || !style.styleKey)
      || new Set(styleProducts.map((style) => style.objectId)).size !== styleProducts.length
      || new Set(styleProducts.map((style) => style.v6ProductObjectId)).size !== styleProducts.length) {
    fail('PHYSICAL_V7_TRUSTED_STYLE_SET_INVALID', 'The trusted physical v7 Style set is incomplete or duplicated.');
  }
  return freeze({
    schemaVersion: PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA,
    version: 7,
    trusted: true,
    queryVerified: true,
    sealed: true,
    physicalProtocolConfigObjectId: exactId(trusted.physicalProtocolConfigObjectId, 'PhysicalProtocolConfigV7'),
    physicalRegistryObjectId: exactId(trusted.physicalRegistryObjectId, 'PhysicalRegistryV7'),
    physicalProfileObjectId: exactId(trusted.physicalProfileObjectId, 'MakerPhysicalProfileV7'),
    v6ProfileObjectId: exactId(trusted.v6ProfileObjectId, 'MakerProfileV6'),
    makerRootObjectId: exactId(trusted.makerRootObjectId, 'MakerRootV5'),
    styleProducts,
  });
}

function tuple(partKey, itemKey, styleKey) {
  return `${partKey}\u0000${itemKey}\u0000${styleKey}`;
}

/**
 * Freeze the exact v5 Complete selection order into the v7 initial wardrobe
 * handoff. No query string, menu order, or mutable Player selection is read.
 */
export async function buildPhysicalV7InitialLoadoutSummary({
  document,
  recipe,
  flattened = null,
  recipeHash,
  trusted,
} = {}) {
  if (trusted === null || trusted === undefined) return null;
  if (trusted?.schemaVersion !== PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA
      || trusted?.trusted !== true
      || trusted?.queryVerified !== true
      || trusted?.sealed !== true) {
    fail('PHYSICAL_V7_TRUST_SNAPSHOT_INVALID', 'Player Complete requires a sealed, query-verified physical v7 snapshot.');
  }
  const exact = flattened || flattenMakerV4RecipeV2(document, recipe);
  const suiRecipe = array(exact?.suiRecipe);
  const styleSelections = array(exact?.styleSelections);
  if (!suiRecipe.length || suiRecipe.length !== styleSelections.length) {
    fail('PHYSICAL_V7_RECIPE_COVERAGE_INVALID', 'The v5 Recipe and StyleSelection arrays must be complete and equal length.');
  }
  const projectionRows = new Map(array(exact?.projection?.commerce?.styleProducts).map((row) => [
    tuple(row.partKey, row.itemKey, row.styleKey),
    row,
  ]));
  const trustedStyles = new Map(array(trusted.styleProducts).map((style) => [
    tuple(style.slotKey, style.recipeItemKey, style.styleKey),
    style,
  ]));
  if (trustedStyles.size !== array(trusted.styleProducts).length) {
    fail('PHYSICAL_V7_TRUSTED_STYLE_DUPLICATE', 'The trusted StyleProduct set contains duplicate v5 identities.');
  }
  const initialAuthorizationRows = styleSelections.map((selection, recipeIndex) => {
    const slot = suiRecipe[recipeIndex];
    const partKey = string(selection?.partKey);
    const recipeItemKey = string(selection?.itemKey);
    const styleKey = string(selection?.styleKey);
    if (!partKey || !recipeItemKey || !styleKey
        || string(slot?.partKey) !== partKey
        || string(slot?.itemKey) !== recipeItemKey
        || Number(slot?.renderOrder) !== recipeIndex) {
      fail('PHYSICAL_V7_RECIPE_ORDER_MISMATCH', 'v7 authorization rows must follow the exact contiguous v5 Recipe order.', { recipeIndex });
    }
    const projection = projectionRows.get(tuple(partKey, recipeItemKey, styleKey));
    if (!projection) fail('PHYSICAL_V7_STYLE_PROJECTION_MISSING', 'The v5 Style registry row is missing.', { recipeIndex });
    if (projection.rowKind === MAKER_V4_COMMERCE_STYLE_ROW_V5.VISUAL) {
      const style = trustedStyles.get(tuple(partKey, recipeItemKey, styleKey));
      if (!style || style.definitionVerified !== true || style.assetVerified !== true) {
        fail('PHYSICAL_V7_VISUAL_STYLE_UNVERIFIED', 'A visual Recipe row is not backed by a verified StyleProductV7.', { recipeIndex });
      }
      return {
        recipeIndex,
        rowKind: MAKER_V4_COMMERCE_STYLE_ROW_V5.VISUAL,
        partKey,
        recipeItemKey,
        styleKey,
        familyObjectId: exactId(style.familyObjectId, 'ItemFamilyV7'),
        styleProductObjectId: exactId(style.objectId, 'StyleProductV7'),
        v6ProductObjectId: exactId(style.v6ProductObjectId, 'ItemProductV6'),
      };
    }
    if (![MAKER_V4_COMMERCE_STYLE_ROW_V5.LOGICAL_NONE,
      MAKER_V4_COMMERCE_STYLE_ROW_V5.LOGICAL_COLOR].includes(projection.rowKind)) {
      fail('PHYSICAL_V7_STYLE_ROW_KIND_INVALID', 'The v5 Style registry row kind is unsupported.', { recipeIndex });
    }
    return {
      recipeIndex,
      rowKind: projection.rowKind,
      partKey,
      recipeItemKey,
      styleKey,
    };
  });
  const visualRows = initialAuthorizationRows.filter((row) => row.rowKind === 'VISUAL');
  if (!visualRows.length
      || new Set(visualRows.map((row) => row.styleProductObjectId)).size !== visualRows.length) {
    fail('PHYSICAL_V7_INITIAL_STYLE_SET_INVALID', 'Initial v7 loadout must contain unique visual StyleProduct IDs.');
  }
  const visualRecipeIndices = visualRows.map((row) => row.recipeIndex);
  const initialStyleProductObjectIds = visualRows.map((row) => row.styleProductObjectId);
  const summary = {
    schemaVersion: PHYSICAL_V7_INITIAL_LOADOUT_SCHEMA,
    version: 7,
    physicalProtocolConfigObjectId: exactId(trusted.physicalProtocolConfigObjectId, 'PhysicalProtocolConfigV7'),
    physicalRegistryObjectId: exactId(trusted.physicalRegistryObjectId, 'PhysicalRegistryV7'),
    physicalProfileObjectId: exactId(trusted.physicalProfileObjectId, 'MakerPhysicalProfileV7'),
    v6ProfileObjectId: exactId(trusted.v6ProfileObjectId, 'MakerProfileV6'),
    makerRootObjectId: exactId(trusted.makerRootObjectId, 'MakerRootV5'),
    recipeHash: exactHash(recipeHash, 'Complete recipe hash'),
    initialAuthorizationRows,
    visualRecipeIndices,
    initialStyleProductObjectIds,
  };
  summary.authorizationCommitment = await hashPhysicalV7InitialAuthorization(summary);
  return freeze(summary);
}

export async function verifyPhysicalV7InitialLoadoutSummary(input = {}) {
  const rebuilt = await buildPhysicalV7InitialLoadoutSummary(input);
  const actual = input?.summary;
  if (!actual || stableJson(actual) !== stableJson(rebuilt)) {
    fail('PHYSICAL_V7_INITIAL_LOADOUT_TAMPERED', 'Physical v7 initial loadout differs from the trusted completion snapshot.');
  }
  return true;
}
