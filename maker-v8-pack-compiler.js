import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase58, fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { MAKER_V8_SEAL_ID_BCS_V2, MAKER_V8_SEAL_CERTIFICATION_BCS_V2 } from './maker-v8-seal-compiler.js';
import { deriveMakerV8SealRuntimeRegistryCommitmentV2, advanceMakerV8SealRuntimeV2 } from './maker-v8-seal-runtime-compiler.js';

import {
  MAKER_V8_PACK_COMPILER_RESULT_SCHEMA,
  MAKER_V8_PACK_PUBLICATION_CERTIFICATION_SCHEMA,
  assertMakerV8PackDocumentV8,
  canonicalMakerV8PackJson,
} from './maker-v8-pack-controller.js';
import {
  MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
} from './maker-v8-pack-publication.js';
import {
  assertMakerV8PackPreparedTransportV8,
  deriveMakerV8PackSemanticContentCommitmentV8,
} from './maker-v8-pack-transport.js';
import {
  MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
  assertMakerV8ProtectedAssetIdentityV8,
} from './maker-v8-protected-transport.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8AttestedPackageTuple,
  makerV8AttestedReplacement,
  assertMakerV8MainnetRpc,
  makerV8ChainTypes,
} from './maker-v8-chain.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import { assertMakerV8PlayerProtocolCurrentV8 } from './maker-v8-player-protocol.js';
import { packPublicationAuthoringContent } from './maker-v8-pack-authoring.js';
import { compileMakerV8PackDefinitionRowsV8, planMakerV8PackDefinitionRegistrationV8,
  buildMakerV8PackDefinitionStepV8 } from './maker-v8-pack-definitions-compiler.js';

export const MAKER_V8_PACK_COMPILER_SCHEMA = 'animacraft.maker-v8-pack-compiler.v1';
export { compileMakerV8PackDefinitionRowsV8, buildMakerV8PackDefinitionRegistrationV8,
  planMakerV8PackDefinitionRegistrationV8, buildMakerV8PackDefinitionStepV8 } from './maker-v8-pack-definitions-compiler.js';
export const MAKER_V8_PACK_COMPILED_SCHEMA = 'animacraft.maker-v8-pack-compiled.v1';
export const MAKER_V8_PACK_CHECKPOINT_SCHEMA = 'animacraft.maker-v8-pack-checkpoint.v1';
export const MAKER_V8_PACK_STYLE_COMMITMENT_SCHEMA =
  'animacraft.maker-v8-pack-style-commitment.v1';
export const MAKER_V8_PACK_COMPILER_CHUNK_SIZE = 64;

const HASH = /^[0-9a-f]{64}$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const ACCESS = Object.freeze({ FREE: 0, PAID: 1, INCLUDED_WITH_MAKER: 2 });
const COMPLETE = Object.freeze({
  UNLIMITED_FREE: 0,
  FREE_QUOTA_THEN_PAID: 1,
  PAID_EVERY_TIME: 2,
  FREE_QUOTA_THEN_BLOCK: 3,
});
const encoder = new TextEncoder();
const BV = bcs.byteVector();
const OString = bcs.option(bcs.string());
const PackStyle = bcs.struct('PackStyleV8', {
  index: bcs.u64(),
  definition_sources: bcs.struct('PackStyleDefinitionSourcesV8', {
    part: bcs.u8(), track: bcs.u8(), color: bcs.option(bcs.u8()),
  }),
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  layer_track_key: bcs.string(),
  color_channel_key: OString,
  default_swatch_key: OString,
  asset_blob_id: bcs.string(),
  asset_sha256: BV,
  asset_content_commitment: BV,
  protected: bcs.bool(),
  seal_binding_commitment: BV,
  style_commitment: BV,
});
const PackEmpty = bcs.struct('PackEmptyCommitmentInputV8', {
  domain: BV,
  version: bcs.u64(),
  root_content_commitment: BV,
  release_content_commitment: BV,
});
const PackAdvance = bcs.struct('PackStyleCommitmentInputV8', {
  domain: BV,
  version: bcs.u64(),
  root_content_commitment: BV,
  release_content_commitment: BV,
  sequence: bcs.u64(),
  previous: BV,
  style: PackStyle,
});
const SealBinding = bcs.struct('SealBindingCommitmentInputV8', {
  domain: BV,
  version: bcs.u64(),
  registry_id: bcs.Address,
  registry_commitment: BV,
  runtime_revision: bcs.u64(),
  runtime_commitment: BV,
  policy_config_id: bcs.Address,
  policy_commitment: BV,
  root_id: bcs.Address,
  root_version: bcs.u64(),
  root_content_commitment: BV,
  scope_kind: bcs.u8(),
  scope_key: bcs.string(),
  scope_commitment: BV,
  asset_key: bcs.string(),
  asset_content_commitment: BV,
  ciphertext_blob_id: bcs.string(),
  ciphertext_sha256: BV,
  ciphertext_blob_commitment: BV,
  certification_commitment: BV,
  seal_id: BV,
});
const COMPILER_TRANSACTIONS = new WeakMap();
const COMPILER_SIGNED_ARTIFACTS = new WeakMap();

export class MakerV8PackCompilerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8PackCompilerError';
    this.code = code;
    if (details !== undefined) this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new MakerV8PackCompilerError(code, message, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (value instanceof Transaction) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_PACK_COMPILER_SHAPE_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PACK_COMPILER_SHAPE_INVALID', `${label} has fields outside its exact schema.`, {
      actual,
      expected,
    });
  }
  return value;
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  return hashBytes(encoder.encode(canonicalMakerV8PackJson(value)));
}

function domain(value) {
  return encoder.encode(value);
}

function hashBcs(schema, value) {
  return hashBytes(schema.serialize(value).toBytes());
}

function ciphertextBlobCommitment(asset) {
  return hashValue({
    schemaVersion: 'animacraft.maker-v8-ciphertext-transport.v1',
    blobId: asset.blobId,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    mediaType: asset.mediaType,
  });
}

function fromHex(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('MAKER_V8_PACK_COMPILER_HASH_INVALID', `${label} must be one lowercase SHA-256.`);
  }
  return Uint8Array.from({ length: 32 }, (_entry, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function address(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value) || /^0x0+$/.test(value)) {
    fail('MAKER_V8_PACK_COMPILER_ID_INVALID', `${label} must be one canonical non-zero Sui ID.`);
  }
  return value;
}

function decimal(value, label) {
  const text = String(value ?? '');
  if (!UINT.test(text) || BigInt(text) > (1n << 64n) - 1n) {
    fail('MAKER_V8_PACK_COMPILER_INTEGER_INVALID', `${label} must be one canonical u64.`);
  }
  return text;
}

function same(left, right) {
  return canonicalMakerV8PackJson(left) === canonicalMakerV8PackJson(right);
}

function target(compiled, fn) {
  return `${compiled.runtimePackageId}::runtime_v8::${fn}`;
}

function roleTarget(packageId, module, fn) {
  return `${packageId}::${module}::${fn}`;
}

function suiDigest(value, label) {
  try {
    if (typeof value !== 'string' || fromBase58(value).length !== 32) throw new Error('digest');
  } catch {
    fail('MAKER_V8_PACK_COMPILER_DIGEST_INVALID', `${label} must be one canonical Sui digest.`);
  }
  return value;
}

function pureBytes(transaction, value) {
  return transaction.pure.vector('u8', [...(typeof value === 'string' ? fromHex(value, 'Move bytes') : value)]);
}

function objectArgument(transaction, input, mutable) {
  if (input.kind === 'shared') {
    return transaction.sharedObjectRef({
      objectId: input.objectId,
      initialSharedVersion: input.initialSharedVersion,
      mutable,
    });
  }
  return transaction.objectRef({
    objectId: input.objectId,
    version: input.version,
    digest: input.digest,
  });
}

function assertInput(value, label, expectedKind = null) {
  if (!plain(value) || !['shared', 'owned'].includes(value.kind)
    || expectedKind !== null && value.kind !== expectedKind) {
    fail('MAKER_V8_PACK_COMPILER_INPUT_INVALID', `${label} has an invalid object input kind.`);
  }
  if (value.kind === 'shared') {
    exact(value, ['kind', 'objectId', 'initialSharedVersion'], label);
    address(value.objectId, `${label}.objectId`);
    decimal(value.initialSharedVersion, `${label}.initialSharedVersion`);
  } else {
    exact(value, ['kind', 'objectId', 'version', 'digest'], label);
    address(value.objectId, `${label}.objectId`);
    decimal(value.version, `${label}.version`);
    try {
      if (fromBase58(value.digest).length !== 32) throw new Error('length');
    } catch {
      fail('MAKER_V8_PACK_COMPILER_INPUT_INVALID', `${label}.digest is invalid.`);
    }
  }
  return freeze(structuredClone(value));
}

function assertAuthorityInputs(value, document) {
  exact(value, [
    'root', 'definitionRegistry', 'baseRegistry', 'packRegistry',
    'makerAdmin', 'admissionAuthority',
  ], 'Pack compiler authority inputs');
  const checked = {
    root: assertInput(value.root, 'inputs.root', 'shared'),
    definitionRegistry: assertInput(value.definitionRegistry, 'inputs.definitionRegistry', 'shared'),
    baseRegistry: assertInput(value.baseRegistry, 'inputs.baseRegistry', 'shared'),
    packRegistry: assertInput(value.packRegistry, 'inputs.packRegistry', 'shared'),
    makerAdmin: assertInput(value.makerAdmin, 'inputs.makerAdmin', 'owned'),
    admissionAuthority: assertInput(value.admissionAuthority, 'inputs.admissionAuthority', 'owned'),
  };
  const expected = {
    root: document.bindings.root.objectRef.objectId,
    definitionRegistry: document.bindings.definitionRegistry.objectRef.objectId,
    baseRegistry: document.bindings.baseRegistry.objectRef.objectId,
    packRegistry: document.bindings.packRegistry.objectRef.objectId,
    makerAdmin: document.bindings.makerAdmin.objectRef.objectId,
    admissionAuthority: document.bindings.admissionAuthority.objectRef.objectId,
  };
  for (const [name, objectId] of Object.entries(expected)) {
    if (checked[name].objectId !== objectId) {
      fail('MAKER_V8_PACK_COMPILER_INPUT_DRIFT', `${name} input differs from the exact Pack document binding.`);
    }
  }
  return freeze(checked);
}

function assertProtectionAuthority(value, document) {
  exact(value, [
    'protocolConfig', 'catalog', 'releaseConfig', 'sealPolicy', 'sealRegistry',
    'catalogId', 'productBindingCommitment', 'policyCommitment',
    'registryCommitment', 'runtimeRevision', 'runtimeCommitment',
    'sealPolicyConfigId', 'registryState',
  ], 'Pack protected authority');
  const checked = {
    protocolConfig: assertInput(value.protocolConfig, 'protection.protocolConfig', 'shared'),
    catalog: assertInput(value.catalog, 'protection.catalog', 'shared'),
    releaseConfig: assertInput(value.releaseConfig, 'protection.releaseConfig', 'shared'),
    sealPolicy: assertInput(value.sealPolicy, 'protection.sealPolicy', 'shared'),
    sealRegistry: assertInput(value.sealRegistry, 'protection.sealRegistry', 'shared'),
    catalogId: address(value.catalogId, 'protection.catalogId'),
    productBindingCommitment: value.productBindingCommitment,
    policyCommitment: value.policyCommitment,
    registryCommitment: value.registryCommitment,
    runtimeRevision: decimal(value.runtimeRevision, 'protection.runtimeRevision'),
    runtimeCommitment: value.runtimeCommitment,
    sealPolicyConfigId: address(value.sealPolicyConfigId, 'protection.sealPolicyConfigId'),
    registryState: structuredClone(value.registryState),
  };
  for (const field of [
    'productBindingCommitment', 'policyCommitment', 'registryCommitment', 'runtimeCommitment',
  ]) fromHex(checked[field], `protection.${field}`);
  if (deriveMakerV8SealRuntimeRegistryCommitmentV2(checked.registryState) !== checked.registryCommitment
    || checked.runtimeCommitment !== checked.registryCommitment
    || checked.registryState.runtimeRevision !== checked.runtimeRevision
    || checked.registryState.registryId !== checked.sealRegistry.objectId
    || checked.registryState.rootId !== document.bindings.root.objectRef.objectId
    || checked.registryState.makerVersion !== document.bindings.root.makerVersion
    || checked.registryState.rootContentCommitment !== document.bindings.root.contentCommitment
    || checked.registryState.policyId !== checked.sealPolicyConfigId) {
    fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', 'Seal registry state differs from its actual commitment and Maker.');
  }
  if (checked.catalog.objectId !== checked.catalogId
    || checked.sealPolicy.objectId !== checked.sealPolicyConfigId
    || checked.releaseConfig.objectId !== document.bindings.releaseConfig.objectRef.objectId
    || checked.productBindingCommitment !== document.bindings.releaseConfig.productBindingCommitment) {
    fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', 'Protected Pack authority differs from the exact document/runtime binding.');
  }
  return freeze(checked);
}

function protectedAssetKey(style) {
  return `${style.partKey}/${style.itemKey}/${style.styleKey}`;
}

function deriveProtectedRows(document, contentCommitment, authority) {
  const scopeKey = `pack/${document.metadata.semanticPackId}`;
  let revision = BigInt(authority.runtimeRevision);
  let runtimeCommitment = authority.runtimeCommitment;
  let registryState = authority.registryState;
  const rows = [];
  for (const [styleIndex, style] of document.styles.entries()) {
    if (!style.asset.protected) continue;
    if (style.asset.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE
      || style.asset.blobId === null) {
      fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Protected Pack Style lacks its exact ciphertext transport/binding.');
    }
    const assetKey = protectedAssetKey(style);
    const blobCommitment = ciphertextBlobCommitment(style.asset);
    const certificationCommitment = hashBcs(MAKER_V8_SEAL_CERTIFICATION_BCS_V2, {
      domain: 'animacraft-fresh-v8/seal/ciphertext-certification/v2',
      schema_revision: 2n,
      catalog_id: authority.catalogId,
      product_binding_commitment: fromHex(authority.productBindingCommitment),
      policy_commitment: fromHex(authority.policyCommitment),
      root_content_commitment: fromHex(document.bindings.root.contentCommitment),
      maker_version: BigInt(document.bindings.root.makerVersion),
      scope_kind: 1,
      scope_key: scopeKey,
      scope_commitment: fromHex(contentCommitment),
      asset_key: assetKey,
      asset_content_commitment: fromHex(style.asset.contentCommitment),
      ciphertext_blob_id: style.asset.blobId,
      ciphertext_sha256: fromHex(style.asset.sha256),
      ciphertext_blob_commitment: fromHex(blobCommitment),
    });
    const sealId = hashBcs(MAKER_V8_SEAL_ID_BCS_V2, {
      domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2',
      schema_revision: 2n,
      product_binding_commitment: fromHex(authority.productBindingCommitment),
      policy_commitment: fromHex(authority.policyCommitment),
      root_content_commitment: fromHex(document.bindings.root.contentCommitment),
      maker_version: BigInt(document.bindings.root.makerVersion),
      scope_kind: 1,
      scope_key: scopeKey,
      asset_key: assetKey,
    });
    const row = {
      scope_kind: 1,
      scope_key: scopeKey,
      scope_commitment: fromHex(contentCommitment),
      asset_key: assetKey,
      asset_content_commitment: fromHex(style.asset.contentCommitment),
      ciphertext_blob_id: style.asset.blobId,
      ciphertext_sha256: fromHex(style.asset.sha256),
      ciphertext_blob_commitment: fromHex(blobCommitment),
      certification_commitment: fromHex(certificationCommitment),
      seal_id: fromHex(sealId),
    };
    const expectedSealRevision = revision;
    const advanced = advanceMakerV8SealRuntimeV2(registryState, row);
    registryState = advanced.state;
    runtimeCommitment = advanced.commitment;
    revision += 1n;
    const sealBindingCommitment = hashBcs(SealBinding, {
      domain: domain('animacraft-v8/runtime/seal-binding'),
      version: 8n,
      registry_id: authority.sealRegistry.objectId,
      registry_commitment: fromHex(runtimeCommitment),
      runtime_revision: revision,
      runtime_commitment: fromHex(runtimeCommitment),
      policy_config_id: authority.sealPolicyConfigId,
      policy_commitment: fromHex(authority.policyCommitment),
      root_id: document.bindings.root.objectRef.objectId,
      root_version: BigInt(document.bindings.root.makerVersion),
      root_content_commitment: fromHex(document.bindings.root.contentCommitment),
      scope_kind: 1,
      scope_key: scopeKey,
      scope_commitment: fromHex(contentCommitment),
      asset_key: assetKey,
      asset_content_commitment: fromHex(style.asset.contentCommitment),
      ciphertext_blob_id: style.asset.blobId,
      ciphertext_sha256: fromHex(style.asset.sha256),
      ciphertext_blob_commitment: fromHex(blobCommitment),
      certification_commitment: fromHex(certificationCommitment),
      seal_id: fromHex(sealId),
    });
    rows.push(freeze({
      styleIndex,
      assetId: style.asset.assetId,
      assetKey,
      scopeKey,
      expectedSealRevision: expectedSealRevision.toString(),
      nextRuntimeRevision: revision.toString(),
      nextRuntimeCommitment: runtimeCommitment,
      nextRegistryState: registryState,
      ciphertextBlobCommitment: blobCommitment,
      certificationCommitment,
      sealId,
      sealBindingCommitment,
    }));
  }
  return freeze(rows);
}

function assertProtection(value, document, contentCommitment) {
  if (value === null) {
    if (document.styles.some((style) => style.asset.protected)) {
      fail('MAKER_V8_PACK_PROTECTION_REQUIRED', 'Protected Pack styles require one immutable Seal authority.');
    }
    return null;
  }
  exact(value, ['authority', 'rows'], 'compiled Pack protection');
  const authority = assertProtectionAuthority(value.authority, document);
  if (!Array.isArray(value.rows)) {
    fail('MAKER_V8_PACK_PROTECTION_INVALID', 'Compiled protected Pack rows must be an array.');
  }
  const expected = deriveProtectedRows(document, contentCommitment, authority);
  if (!same(value.rows, expected)) {
    fail('MAKER_V8_PACK_PROTECTION_DRIFT', 'Compiled protected Pack rows differ from the exact Seal BCS grammar.');
  }
  document.styles.forEach((style, index) => {
    if (!style.asset.protected) return;
    const row = expected.find((entry) => entry.styleIndex === index);
    if (!row || style.asset.sealBindingCommitment !== row.sealBindingCommitment) {
      fail('MAKER_V8_PACK_SEAL_BINDING_DRIFT', 'Protected Pack Style differs from its exact post-registration Seal binding.');
    }
  });
  return freeze({ authority, rows: expected });
}

function stylePayload(style) {
  return freeze({
    schemaVersion: MAKER_V8_PACK_STYLE_COMMITMENT_SCHEMA,
    version: 8,
    sequence: style.sequence,
    partKey: style.partKey,
    itemKey: style.itemKey,
    styleKey: style.styleKey,
    layerTrackKey: style.layerTrackKey,
    colorChannelKey: style.colorChannelKey,
    defaultSwatchKey: style.defaultSwatchKey,
    asset: structuredClone(style.asset),
  });
}

function moveStyle(style, reference = null) {
  const styleCommitment = hashValue(stylePayload(style));
  return freeze({
    index: BigInt(style.sequence),
    definition_sources: { part: reference?.part.scope === 'PACK_SELF' ? 2 : 1,
      track: reference?.track.scope === 'PACK_SELF' ? 2 : 1,
      color: style.colorChannelKey === null ? null : reference?.color.scope === 'PACK_SELF' ? 2 : 1 },
    part_key: style.partKey,
    item_key: style.itemKey,
    style_key: style.styleKey,
    layer_track_key: style.layerTrackKey,
    color_channel_key: style.colorChannelKey,
    default_swatch_key: style.defaultSwatchKey,
    asset_blob_id: style.asset.blobId,
    asset_sha256: fromHex(style.asset.sha256, 'style.asset.sha256'),
    asset_content_commitment: fromHex(style.asset.contentCommitment, 'style.asset.contentCommitment'),
    protected: style.asset.protected,
    seal_binding_commitment: style.asset.sealBindingCommitment === null
      ? new Uint8Array() : fromHex(style.asset.sealBindingCommitment, 'style.asset.sealBindingCommitment'),
    style_commitment: fromHex(styleCommitment, 'styleCommitment'),
  });
}

export function deriveMakerV8PackCommitmentsV8(documentValue, contentCommitment) {
  const document = assertMakerV8PackDocumentV8(documentValue, { mode: 'COMPILE' });
  const content = fromHex(contentCommitment, 'contentCommitment');
  const root = fromHex(document.bindings.root.contentCommitment, 'rootContentCommitment');
  const references = document.authoring === undefined ? null : packPublicationAuthoringContent(document).definitions.styles;
  if (references && (references.length !== document.styles.length || document.styles.some((style, index) => {
    const ref = references[index];
    return ref.sequence !== style.sequence || ref.part.key !== style.partKey || ref.itemKey !== style.itemKey
      || ref.styleKey !== style.styleKey || ref.track.key !== style.layerTrackKey
      || (ref.color?.key ?? null) !== style.colorChannelKey || ref.defaultSwatchKey !== style.defaultSwatchKey;
  }))) {
    fail('MAKER_V8_PACK_COMPILED_DRIFT', 'Published Styles differ from their exact authored namespace references.');
  }
  const styles = document.styles.map((style, index) => moveStyle(style, references?.[index]));
  let rolling = sha256(PackEmpty.serialize({
    domain: encoder.encode('animacraft-v8/runtime/pack-styles-empty'),
    version: 8n,
    root_content_commitment: root,
    release_content_commitment: content,
  }).toBytes());
  const rollingCommitments = [hashBytes(rolling)];
  for (const [index, style] of styles.entries()) {
    rolling = sha256(PackAdvance.serialize({
      domain: encoder.encode('animacraft-v8/runtime/pack-style'),
      version: 8n,
      root_content_commitment: root,
      release_content_commitment: content,
      sequence: BigInt(index),
      previous: rolling,
      style,
    }).toBytes());
    rollingCommitments.push(hashBytes(rolling));
  }
  return freeze({
    styles,
    emptyStyleCommitment: rollingCommitments[0],
    rollingCommitments,
    expectedStyleCommitment: rollingCommitments.at(-1),
  });
}

function assertCompiled(value) {
  const compiled = structuredClone(value);
  exact(compiled, [
    'schemaVersion', 'chainIdentifier', 'signer', 'documentSha256', 'document',
    'runtimePackageId', 'runtimePackageDigest', 'releasePackageId', 'corePackageId', 'coreOriginalPackageId',
    'paymentCoinType', 'transport',
    'inputs', 'accessKind', 'completeMode', 'contentCommitment',
    'emptyStyleCommitment', 'expectedStyleCommitment', 'rollingCommitments',
    'styleCommitments', 'chunkSize', 'protection',
  ], 'compiled Pack publication');
  if (compiled.schemaVersion !== MAKER_V8_PACK_COMPILED_SCHEMA
    || compiled.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || !HASH.test(compiled.documentSha256)
    || !HASH.test(compiled.contentCommitment) || !HASH.test(compiled.emptyStyleCommitment)
    || !HASH.test(compiled.expectedStyleCommitment)
    || !Number.isSafeInteger(compiled.chunkSize) || compiled.chunkSize < 1 || compiled.chunkSize > 128
    || !Object.values(ACCESS).includes(compiled.accessKind)
    || !Object.values(COMPLETE).includes(compiled.completeMode)) {
    fail('MAKER_V8_PACK_COMPILED_INVALID', 'Compiled Pack identity or limits are invalid.');
  }
  address(compiled.signer, 'compiled.signer');
  address(compiled.runtimePackageId, 'compiled.runtimePackageId');
  address(compiled.corePackageId, 'compiled.corePackageId');
  address(compiled.coreOriginalPackageId, 'compiled.coreOriginalPackageId');
  address(compiled.releasePackageId, 'compiled.releasePackageId');
  suiDigest(compiled.runtimePackageDigest, 'compiled.runtimePackageDigest');
  compiled.document = assertMakerV8PackDocumentV8(compiled.document, { mode: 'COMPILE' });
  compiled.transport = assertMakerV8PackPreparedTransportV8(compiled.transport, compiled.document);
  compiled.inputs = assertAuthorityInputs(compiled.inputs, compiled.document);
  compiled.protection = assertProtection(
    compiled.protection,
    compiled.document,
    compiled.contentCommitment,
  );
  if (compiled.signer !== compiled.document.author.address
    || compiled.documentSha256 !== hashValue(compiled.document)
    || compiled.runtimePackageId === compiled.document.bindings.root.objectRef.objectId
    || compiled.contentCommitment !== compiled.transport.manifest.contentCommitment
    || compiled.accessKind !== ACCESS[compiled.document.access.kind]
    || compiled.completeMode !== COMPLETE[compiled.document.completion.mode]) {
    fail('MAKER_V8_PACK_COMPILED_DRIFT', 'Compiled Pack differs from its exact document or certified transport.');
  }
  const commitments = deriveMakerV8PackCommitmentsV8(compiled.document, compiled.contentCommitment);
  const styleCommitments = commitments.styles.map((style) => toHex(style.style_commitment));
  if (!same(compiled.rollingCommitments, commitments.rollingCommitments)
    || !same(compiled.styleCommitments, styleCommitments)
    || compiled.emptyStyleCommitment !== commitments.emptyStyleCommitment
    || compiled.expectedStyleCommitment !== commitments.expectedStyleCommitment) {
    fail('MAKER_V8_PACK_COMPILED_DRIFT', 'Compiled Pack style commitments drifted from the exact Move BCS grammar.');
  }
  return freeze(compiled);
}

function transactionKind(transaction, stage) {
  return transaction.build({ onlyTransactionKind: true }).then((bytes) => {
    const parsed = bcs.TransactionKind.parse(bytes);
    const roundtrip = bcs.TransactionKind.serialize(parsed).toBytes();
    if (parsed?.$kind !== 'ProgrammableTransaction'
      || roundtrip.length !== bytes.length
      || roundtrip.some((byte, index) => byte !== bytes[index])
      || parsed.ProgrammableTransaction.commands.some((command) => command.$kind !== 'MoveCall'
        && !(stage === 'DEFINITIONS_APPEND' && command.$kind === 'MakeMoveVec'))) {
      fail('MAKER_V8_PACK_COMPILER_KIND_INVALID', 'Pack compiler emitted a non-canonical TransactionKind.');
    }
    return freeze({
      bytes: toBase64(bytes),
      sha256: hashBytes(bytes),
      targets: parsed.ProgrammableTransaction.commands.filter(command => command.$kind === 'MoveCall').map(({ MoveCall: call }) => (
        `${call.package}::${call.module}::${call.function}`
      )),
    });
  });
}

function authorizeDurableSignedArtifact(authority, plan, compiled) {
  const cursor = plan?.current;
  const digest = cursor?.outcome?.digest;
  if (cursor?.fullTransaction === null || cursor?.fullTransaction === undefined
    || cursor?.signature === null || cursor?.signature === undefined
    || typeof digest !== 'string') return null;
  let bytes; let parsed; let roundtrip; let signature;
  try {
    bytes = fromBase64(cursor.fullTransaction);
    signature = fromBase64(cursor.signature);
    if (toBase64(bytes) !== cursor.fullTransaction || toBase64(signature) !== cursor.signature) {
      throw new Error('canonical base64');
    }
    parsed = bcs.TransactionData.parse(bytes);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PACK_COMPILER_SIGNED_ARTIFACT_INVALID', 'Durable Pack signed artifacts are not canonical BCS/Base64.');
  }
  const kindBytes = parsed?.$kind === 'V1'
    ? bcs.TransactionKind.serialize(parsed.V1.kind).toBytes() : null;
  if (!(kindBytes instanceof Uint8Array) || !sameBytes(bytes, roundtrip)
    || parsed.V1.sender !== compiled.signer || parsed.V1.gasData?.owner !== compiled.signer
    || toBase64(kindBytes) !== cursor.descriptor.kindBytes
    || hashBytes(kindBytes) !== cursor.descriptor.kindSha256
    || TransactionDataBuilder.getDigestFromBytes(bytes) !== digest) {
    fail('MAKER_V8_PACK_COMPILER_SIGNED_ARTIFACT_DRIFT', 'Durable Pack TransactionData differs from its compiler cursor.');
  }
  const proof = freeze({
    digest,
    signer: compiled.signer,
    bytes: cursor.fullTransaction,
    signature: cursor.signature,
    kindBytes: cursor.descriptor.kindBytes,
    kindSha256: cursor.descriptor.kindSha256,
  });
  const artifacts = COMPILER_SIGNED_ARTIFACTS.get(authority) ?? new Map();
  COMPILER_SIGNED_ARTIFACTS.set(authority, artifacts);
  artifacts.delete(digest);
  artifacts.set(digest, proof);
  while (artifacts.size > 64) artifacts.delete(artifacts.keys().next().value);
  return proof;
}

function sameBytes(left, right) {
  return left.length === right.length
    && left.every((byte, index) => byte === right[index]);
}

function buildInit(compiled) {
  const transaction = new Transaction();
  transaction.setSender(compiled.signer);
  const coin = [compiled.paymentCoinType];
  const releaseResult = transaction.moveCall({
    target: target(compiled, 'new_pack_release_v8'),
    typeArguments: coin,
    arguments: [
      objectArgument(transaction, compiled.inputs.root, false),
      objectArgument(transaction, compiled.inputs.definitionRegistry, false),
      transaction.pure.string(compiled.document.metadata.semanticPackId),
      transaction.pure.string(compiled.transport.manifest.blobId),
      pureBytes(transaction, compiled.transport.manifest.sha256),
      pureBytes(transaction, compiled.contentCommitment),
      transaction.pure.u8(compiled.accessKind),
      transaction.pure.u64(compiled.document.access.priceAtomic),
      transaction.pure.u8(compiled.completeMode),
      transaction.pure.u64(compiled.document.completion.priceAtomic),
      transaction.pure.u64(compiled.document.completion.freeQuotaPerWallet),
      transaction.pure.u64(compiled.document.completion.totalCap),
      transaction.pure.u64(String(compiled.document.styles.length)),
      pureBytes(transaction, compiled.expectedStyleCommitment),
    ],
  });
  const [release, cap, treasury] = releaseResult;
  transaction.moveCall({
    target: target(compiled, 'share_pack_release_v8'), typeArguments: coin, arguments: [release],
  });
  transaction.moveCall({
    target: target(compiled, 'share_pack_treasury_v8'), typeArguments: coin, arguments: [treasury],
  });
  transaction.moveCall({
    target: target(compiled, 'transfer_pack_admin_cap_v8'),
    arguments: [cap, transaction.pure.address(compiled.signer)],
  });
  return transaction;
}

function checkpointObjectInput(value, label, expectedKind) {
  if (!plain(value)) fail('MAKER_V8_PACK_CHECKPOINT_INVALID', `${label} is missing.`);
  exact(value, ['objectRef', 'input'], label);
  exact(value.objectRef, ['objectId', 'version', 'digest'], `${label}.objectRef`);
  const input = assertInput(value.input, `${label}.input`, expectedKind);
  if (input.objectId !== value.objectRef.objectId) {
    fail('MAKER_V8_PACK_CHECKPOINT_INVALID', `${label} input and object ref differ.`);
  }
  return freeze({ objectRef: structuredClone(value.objectRef), input });
}

function assertCheckpoint(value, compiled, expectedOrdinal = null) {
  exact(value, [
    'schemaVersion', 'ordinal', 'stage', 'digest', 'kindSha256', 'startStyle', 'endStyle',
    'release', 'adminCap', 'treasury', 'observedStyleCount', 'rollingStyleCommitment',
    'packRegistryRevision',
  ], 'Pack checkpoint');
  if (value.schemaVersion !== MAKER_V8_PACK_CHECKPOINT_SCHEMA
    || !Number.isSafeInteger(value.ordinal) || value.ordinal < 0
    || expectedOrdinal !== null && value.ordinal !== expectedOrdinal
    || !['INIT', 'DEFINITIONS_BEGIN', 'DEFINITIONS_APPEND', 'DEFINITIONS_FINALIZE',
      'DEFINITIONS_COLOR_BEGIN', 'DEFINITIONS_COLOR_APPEND', 'DEFINITIONS_COLOR_FINISH', 'APPEND', 'FINALIZE'].includes(value.stage)
    || !Number.isSafeInteger(value.startStyle) || !Number.isSafeInteger(value.endStyle)
    || value.startStyle < 0 || value.endStyle < value.startStyle
    || !HASH.test(value.kindSha256) || !HASH.test(value.rollingStyleCommitment)) {
    fail('MAKER_V8_PACK_CHECKPOINT_INVALID', 'Pack checkpoint cursor or hashes are invalid.');
  }
  try {
    if (fromBase58(value.digest).length !== 32) throw new Error('digest');
  } catch {
    fail('MAKER_V8_PACK_CHECKPOINT_INVALID', 'Pack checkpoint digest is invalid.');
  }
  const checkpoint = {
    ...structuredClone(value),
    release: checkpointObjectInput(value.release, 'checkpoint.release', 'shared'),
    adminCap: checkpointObjectInput(value.adminCap, 'checkpoint.adminCap', 'owned'),
    treasury: checkpointObjectInput(value.treasury, 'checkpoint.treasury', 'shared'),
    observedStyleCount: decimal(value.observedStyleCount, 'checkpoint.observedStyleCount'),
    packRegistryRevision: decimal(value.packRegistryRevision, 'checkpoint.packRegistryRevision'),
  };
  if (Number(checkpoint.observedStyleCount) !== checkpoint.endStyle
    || checkpoint.stage.startsWith('DEFINITIONS_') && (compiled.document.authoring === undefined
      || checkpoint.startStyle !== 0 || checkpoint.endStyle !== 0)
    || checkpoint.endStyle > compiled.document.styles.length
    || checkpoint.rollingStyleCommitment !== compiled.rollingCommitments[checkpoint.endStyle]) {
    fail('MAKER_V8_PACK_CHECKPOINT_DRIFT', 'Pack checkpoint differs from the compiler style prefix.');
  }
  return freeze(checkpoint);
}

function buildAppend(compiled, predecessor, start, end) {
  const transaction = new Transaction();
  transaction.setSender(compiled.signer);
  const release = objectArgument(transaction, predecessor.release.input, true);
  const cap = objectArgument(transaction, predecessor.adminCap.input, false);
  const definitions = objectArgument(transaction, compiled.inputs.definitionRegistry, false);
  const base = objectArgument(transaction, compiled.inputs.baseRegistry, false);
  const compiledStyles = deriveMakerV8PackCommitmentsV8(
    compiled.document,
    compiled.contentCommitment,
  ).styles;
  for (let index = start; index < end; index += 1) {
    const style = compiled.document.styles[index];
    const compiledStyle = compiledStyles[index];
    const sources = transaction.moveCall({
      target: target(compiled, 'new_pack_style_definition_sources_v8'),
      arguments: [transaction.pure.u8(compiledStyle.definition_sources.part),
        transaction.pure.u8(compiledStyle.definition_sources.track),
        transaction.pure.option('u8', compiledStyle.definition_sources.color)],
    });
    if (style.asset.protected) {
      const protection = compiled.protection;
      const row = protection?.rows.find((entry) => entry.styleIndex === index);
      if (!row) {
        fail('MAKER_V8_PACK_PROTECTION_DRIFT', 'Protected Pack append lacks its exact Seal row.');
      }
      const sealAuthority = protection.authority;
      const certification = transaction.moveCall({
        target: roleTarget(compiled.releasePackageId, 'release_v8', 'certify_pack_ciphertext_v8'),
        typeArguments: [compiled.paymentCoinType],
        arguments: [
          objectArgument(transaction, sealAuthority.protocolConfig, false),
          objectArgument(transaction, sealAuthority.catalog, false),
          objectArgument(transaction, sealAuthority.releaseConfig, false),
          objectArgument(transaction, sealAuthority.sealPolicy, false),
          objectArgument(transaction, compiled.inputs.root, false),
          transaction.pure.string(row.scopeKey),
          pureBytes(transaction, compiled.contentCommitment),
          transaction.pure.string(row.assetKey),
          pureBytes(transaction, style.asset.contentCommitment),
          transaction.pure.string(style.asset.blobId),
          pureBytes(transaction, style.asset.sha256),
          pureBytes(transaction, row.ciphertextBlobCommitment),
        ],
      });
      transaction.moveCall({
        target: roleTarget(compiled.runtimePackageId, 'runtime_seal_v8', 'append_protected_pack_style_v8'),
        typeArguments: [compiled.paymentCoinType],
        arguments: [
          release,
          cap,
          definitions,
          base,
          objectArgument(transaction, compiled.inputs.root, false),
          objectArgument(transaction, sealAuthority.sealRegistry, true),
          objectArgument(transaction, sealAuthority.sealPolicy, false),
          objectArgument(transaction, sealAuthority.catalog, false),
          transaction.pure.u64(row.expectedSealRevision),
          certification,
          transaction.pure.u64(style.sequence),
          sources,
          transaction.pure.string(style.partKey),
          transaction.pure.string(style.itemKey),
          transaction.pure.string(style.styleKey),
          transaction.pure.string(style.layerTrackKey),
          transaction.pure.option('string', style.colorChannelKey),
          transaction.pure.option('string', style.defaultSwatchKey),
          transaction.pure.string(style.asset.blobId),
          pureBytes(transaction, style.asset.sha256),
          pureBytes(transaction, row.ciphertextBlobCommitment),
          pureBytes(transaction, style.asset.contentCommitment),
          pureBytes(transaction, row.certificationCommitment),
          pureBytes(transaction, compiledStyle.style_commitment),
        ],
      });
      continue;
    }
    transaction.moveCall({
      target: target(compiled, 'append_unprotected_pack_style_v8'),
      typeArguments: [compiled.paymentCoinType],
      arguments: [
        release,
        cap,
        definitions,
        base,
        transaction.pure.u64(style.sequence),
        sources,
        transaction.pure.string(style.partKey),
        transaction.pure.string(style.itemKey),
        transaction.pure.string(style.styleKey),
        transaction.pure.string(style.layerTrackKey),
        transaction.pure.option('string', style.colorChannelKey),
        transaction.pure.option('string', style.defaultSwatchKey),
        transaction.pure.string(style.asset.blobId),
        pureBytes(transaction, style.asset.sha256),
        pureBytes(transaction, style.asset.contentCommitment),
        pureBytes(transaction, compiledStyle.style_commitment),
      ],
    });
  }
  return transaction;
}

function buildFinalize(compiled, predecessor) {
  const transaction = new Transaction();
  transaction.setSender(compiled.signer);
  const coin = [compiled.paymentCoinType];
  const release = objectArgument(transaction, predecessor.release.input, true);
  const cap = objectArgument(transaction, predecessor.adminCap.input, false);
  transaction.moveCall({
    target: target(compiled, 'seal_pack_release_v8'),
    typeArguments: coin,
    arguments: [release, cap],
  });
  transaction.moveCall({
    target: target(compiled, 'admit_pack_release_v8'),
    typeArguments: coin,
    arguments: [
      objectArgument(transaction, compiled.inputs.packRegistry, true),
      objectArgument(transaction, compiled.inputs.admissionAuthority, false),
      objectArgument(transaction, compiled.inputs.definitionRegistry, false),
      objectArgument(transaction, compiled.inputs.root, false),
      objectArgument(transaction, compiled.inputs.makerAdmin, false),
      release,
      transaction.pure.u64(compiled.document.admission.expectedPackRegistryRevision),
    ],
  });
  return transaction;
}

async function buildDescriptor(authority, compiled, {
  ordinal, stage, startStyle, endStyle, predecessor, definitions,
}) {
  const transaction = definitions
    ? (await buildMakerV8PackDefinitionStepV8(definitions.value, definitions.plan, ordinal - 1, definitions.options)).transaction
    : stage === 'INIT' ? buildInit(compiled)
    : stage === 'APPEND' ? buildAppend(compiled, predecessor, startStyle, endStyle)
      : buildFinalize(compiled, predecessor);
  const kind = await transactionKind(transaction, stage);
  const descriptor = freeze({
    schemaVersion: MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
    ordinal,
    stage,
    startStyle,
    endStyle,
    signer: compiled.signer,
    kindBytes: kind.bytes,
    kindSha256: kind.sha256,
    targets: kind.targets,
    checkpoint: freeze({
      schemaVersion: 'animacraft.maker-v8-pack-stage-precondition.v1',
      compiledSha256: hashValue(compiled),
      predecessorDigest: predecessor?.digest ?? null,
      predecessorRollingStyleCommitment: predecessor?.rollingStyleCommitment ?? null,
      expectedPackRegistryRevision: compiled.document.admission.expectedPackRegistryRevision,
    }),
  });
  COMPILER_TRANSACTIONS.set(transaction, freeze({
    authority,
    executionBlocked: compiled.document.authoring !== undefined,
    signer: compiled.signer,
    kindBytes: kind.bytes,
    kindSha256: kind.sha256,
  }));
  return freeze({ transaction, descriptor });
}

function inputOwner(value, label) {
  if (plain(value?.Shared)) {
    return freeze({
      kind: 'shared',
      initialSharedVersion: decimal(
        value.Shared.initial_shared_version ?? value.Shared.initialSharedVersion,
        `${label}.initialSharedVersion`,
      ),
    });
  }
  if (typeof value?.AddressOwner === 'string') {
    return freeze({ kind: 'owned', address: address(value.AddressOwner, `${label}.AddressOwner`) });
  }
  fail('MAKER_V8_PACK_COMPILER_OWNER_INVALID', `${label} has an unsupported owner.`);
}

export function createMakerV8PackAuthorityLoaderV8({ client, runtime: runtimeInput } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  if (typeof client?.getObject !== 'function') {
    fail('MAKER_V8_PACK_COMPILER_CLIENT_INVALID', 'Pack compiler authority loader requires gRPC getObject.');
  }
  const types = makerV8ChainTypes(runtime);
  const specs = Object.freeze({
    root: ['root', 'shared'],
    definitionRegistry: ['runtimeDefinitions', 'shared'],
    baseRegistry: ['baseRegistry', 'shared'],
    packRegistry: ['packRegistry', 'shared'],
    makerAdmin: ['adminCap', 'owned'],
    admissionAuthority: ['packAdmissionAuthority', 'owned'],
  });
  return async ({ document }) => {
    const bindings = document.bindings;
    const bindingFor = {
      root: bindings.root,
      definitionRegistry: bindings.definitionRegistry,
      baseRegistry: bindings.baseRegistry,
      packRegistry: bindings.packRegistry,
      makerAdmin: bindings.makerAdmin,
      admissionAuthority: bindings.admissionAuthority,
    };
    const result = {};
    for (const [name, [typeKey, expectedKind]] of Object.entries(specs)) {
      const binding = bindingFor[name];
      const response = await client.getObject({
        id: binding.objectRef.objectId,
        options: { showType: true, showContent: true, showOwner: true },
      });
      const data = response?.data;
      const observedType = String(data?.type ?? data?.content?.type ?? '').replace(/\s+/g, '');
      if (!plain(data) || data.objectId !== binding.objectRef.objectId
        || String(data.version) !== binding.objectRef.version
        || data.digest !== binding.objectRef.digest
        || observedType !== String(types[typeKey]).replace(/\s+/g, '')) {
        fail('MAKER_V8_PACK_COMPILER_AUTHORITY_DRIFT', `${name} differs from the exact Pack binding.`);
      }
      const observedOwner = inputOwner(data.owner, `${name}.owner`);
      if (observedOwner.kind !== expectedKind
        || expectedKind === 'owned' && observedOwner.address !== document.author.address) {
        fail('MAKER_V8_PACK_COMPILER_AUTHORITY_DRIFT', `${name} owner differs from the Pack authoring authority.`);
      }
      result[name] = observedOwner.kind === 'shared'
        ? { kind: 'shared', objectId: data.objectId, initialSharedVersion: observedOwner.initialSharedVersion }
        : { kind: 'owned', ...structuredClone(binding.objectRef) };
    }
    return assertAuthorityInputs(result, document);
  };
}

function moveFields(value, label) {
  const fields = plain(value?.fields) ? value.fields : plain(value) ? value : null;
  if (!fields) fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', `${label} has no exact Move fields.`);
  return fields;
}

function moveHash(value, label) {
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return value.map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  const normalized = String(value ?? '').replace(/^0x/, '').toLowerCase();
  if (!HASH.test(normalized)) {
    if (typeof value === 'string') {
      try {
        const bytes = fromBase64(value);
        if (bytes.length === 32 && toBase64(bytes) === value) return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      } catch { /* Reject below. */ }
    }
    fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', `${label} is not one exact 32-byte commitment.`);
  }
  return normalized;
}

function publicationOption(value, label) {
  const wrapped = plain(value?.fields) ? value.fields : value;
  if (plain(wrapped) && Object.hasOwn(wrapped, 'vec')) {
    if (Object.keys(wrapped).length !== 1 || !Array.isArray(wrapped.vec) || wrapped.vec.length !== 1) {
      fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', `${label} must be one installed publication value.`);
    }
    return wrapped.vec[0];
  }
  if (wrapped === null || wrapped === undefined || Array.isArray(wrapped)) {
    fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', `${label} is not installed.`);
  }
  return wrapped;
}

function moveId(value, label) {
  const candidate = typeof value === 'string' ? value
    : typeof value?.id === 'string' ? value.id
      : value?.fields !== undefined ? moveId(value.fields, label) : '';
  return address(String(candidate).toLowerCase(), label);
}

function responseFields(data, expectedType, objectId, label) {
  const observedType = String(data?.type ?? data?.content?.type ?? '').replace(/\s+/g, '');
  if (!plain(data) || data.objectId !== objectId
    || observedType !== String(expectedType).replace(/\s+/g, '')) {
    fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', `${label} identity/type differs from the exact v8 authority.`);
  }
  const owner = inputOwner(data.owner, `${label}.owner`);
  if (owner.kind !== 'shared') {
    fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', `${label} must be one shared v8 authority object.`);
  }
  return freeze({ fields: moveFields(data.content?.fields, label), owner });
}

/**
 * Reads the mutable Seal registry plus its immutable Release/Policy/Catalog
 * authority. The Seal registry ID is derived from the certified Root binding,
 * never accepted from the Pack draft or caller.
 */
export function createMakerV8PackProtectionAuthorityLoaderV8({
  client,
  runtime: runtimeInput,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  if (typeof client?.getObject !== 'function') {
    fail('MAKER_V8_PACK_COMPILER_CLIENT_INVALID', 'Protected Pack authority loader requires gRPC getObject.');
  }
  const types = makerV8ChainTypes(runtime);
  return async ({ document }) => {
    await assertMakerV8MainnetRpc(client);
    const replacement = makerV8AttestedReplacement(runtime);
    const rootId = document.bindings.root.objectRef.objectId;
    const options = { showType: true, showContent: true, showOwner: true };
    const rootResponse = await client.getObject({ id: rootId, options });
    const rootData = rootResponse?.data;
    const root = responseFields(rootData, types.root, rootId, 'MakerRootV8');
    if (String(rootData.version) !== document.bindings.root.objectRef.version
      || rootData.digest !== document.bindings.root.objectRef.digest
      || moveHash(moveFields(root.fields.content, 'Root.content').content_commitment, 'Root.content.content_commitment')
        !== document.bindings.root.contentCommitment
      || decimal(root.fields.maker_version, 'Root.maker_version')
        !== document.bindings.root.makerVersion) {
      fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', 'Protected Pack Root differs from the exact draft binding.');
    }
    const publication = moveFields(root.fields.publication, 'Root.publication');
    moveHash(publicationOption(publication.sealed_base_registry_commitment, 'Root.sealed_base_registry_commitment'), 'Root.sealed_base_registry_commitment');
    const registries = moveFields(publicationOption(publication.registry_ids, 'Root.registry_ids'), 'Root.registry_ids');
    const commitments = moveFields(publicationOption(publication.release_commitments, 'Root.release_commitments'), 'Root.release_commitments');
    if (decimal(root.fields.version, 'Root.version') !== '8'
      || decimal(root.fields.lifecycle, 'Root.lifecycle') !== '1'
      || moveId(publicationOption(publication.catalog_id, 'Root.catalog_id'), 'Root.catalog_id') !== runtime.catalogId
      || moveHash(commitments.product_binding_commitment, 'Root.product_binding_commitment') !== moveHash(replacement.fields.package_tuple_commitment, 'Replacement.tuple')
      || moveHash(commitments.call_cap_set_commitment, 'Root.call_cap_set_commitment') !== moveHash(replacement.fields.call_cap_set_commitment, 'Replacement.capSet')) {
      fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', 'Protected Pack Root is not the active certified product release.');
    }
    const sealRegistryId = moveId(registries.seal_registry_id, 'Root.seal_registry_id');
    const objectIds = [
      runtime.protocolConfigId,
      runtime.catalogId,
      runtime.roleConfigIds.release,
      runtime.roleConfigIds.seal,
      sealRegistryId,
    ];
    const responses = await Promise.all(objectIds.map((id) => client.getObject({ id, options })));
    const labels = ['ProtocolConfigV8', 'ProductReleaseCatalogV8', 'ReleasePackageConfigV8', 'SealPolicyConfigV8', 'SealRegistryV8'];
    const expectedTypes = [
      types.protocolConfig, types.productReleaseCatalog, types.releaseConfig,
      types.sealConfig, types.sealRegistry,
    ];
    const parsed = responses.map((response, index) => responseFields(
      response?.data,
      expectedTypes[index],
      objectIds[index],
      labels[index],
    ));
    const [protocolConfig, catalog, releaseConfig, sealPolicy, sealRegistry] = parsed;
    const liveSnapshot = index => ({ objectId: objectIds[index], type: expectedTypes[index],
      owner: { kind: 'SHARED' }, fields: parsed[index].fields });
    await assertMakerV8PlayerProtocolCurrentV8({ client, runtime,
      objects: { protocolConfig: liveSnapshot(0), catalog: liveSnapshot(1) } });
    if (String(responses[2]?.data?.version) !== document.bindings.releaseConfig.objectRef.version
      || responses[2]?.data?.digest !== document.bindings.releaseConfig.objectRef.digest) {
      fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', 'Release config differs from the Pack document binding.');
    }
    const productBindingCommitment = moveHash(
      sealPolicy.fields.product_binding_commitment,
      'SealPolicy.product_binding_commitment',
    );
    const policyCommitment = moveHash(sealPolicy.fields.commitment, 'SealPolicy.commitment');
    if (moveId(sealPolicy.fields.catalog_id, 'SealPolicy.catalog_id') !== runtime.catalogId
      || productBindingCommitment !== moveHash(commitments.product_binding_commitment, 'Root.product_binding_commitment')
      || productBindingCommitment !== document.bindings.releaseConfig.productBindingCommitment
      || moveId(releaseConfig.fields.catalog_id, 'ReleaseConfig.catalog_id') !== runtime.catalogId
      || moveHash(releaseConfig.fields.product_binding_commitment, 'ReleaseConfig.product_binding_commitment') !== productBindingCommitment
      || moveHash(releaseConfig.fields.call_cap_set_commitment, 'ReleaseConfig.call_cap_set_commitment') !== moveHash(commitments.call_cap_set_commitment, 'Root.call_cap_set_commitment')
      || moveId(sealRegistry.fields.catalog_id, 'SealRegistry.catalog_id') !== runtime.catalogId
      || moveId(sealRegistry.fields.root_id, 'SealRegistry.root_id') !== rootId
      || decimal(sealRegistry.fields.maker_version, 'SealRegistry.maker_version')
        !== document.bindings.root.makerVersion
      || moveHash(sealRegistry.fields.root_content_commitment, 'SealRegistry.root_content_commitment')
        !== document.bindings.root.contentCommitment
      || moveId(sealRegistry.fields.policy_config_id, 'SealRegistry.policy_config_id')
        !== runtime.roleConfigIds.seal
      || moveHash(sealRegistry.fields.product_binding_commitment, 'SealRegistry.product_binding_commitment')
        !== productBindingCommitment
      || moveHash(sealRegistry.fields.policy_commitment, 'SealRegistry.policy_commitment')
        !== policyCommitment
      || sealRegistry.fields.sealed !== true) {
      fail('MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT', 'Seal policy/registry differs from the activated Maker and release.');
    }
    const input = (index) => ({
      kind: 'shared',
      objectId: objectIds[index],
      initialSharedVersion: parsed[index].owner.initialSharedVersion,
    });
    return assertProtectionAuthority({
      protocolConfig: input(0),
      catalog: input(1),
      releaseConfig: input(2),
      sealPolicy: input(3),
      sealRegistry: input(4),
      catalogId: runtime.catalogId,
      productBindingCommitment,
      policyCommitment,
      registryCommitment: moveHash(sealRegistry.fields.commitment, 'SealRegistry.commitment'),
      runtimeRevision: decimal(sealRegistry.fields.runtime_revision, 'SealRegistry.runtime_revision'),
      runtimeCommitment: moveHash(sealRegistry.fields.commitment, 'SealRegistry.commitment'),
      registryState: {
        registryId: sealRegistryId, rootId, makerVersion: document.bindings.root.makerVersion,
        rootContentCommitment: document.bindings.root.contentCommitment, policyId: runtime.roleConfigIds.seal,
        ...Object.fromEntries(['base', 'pack', 'complete'].flatMap(scope => [
          [`${scope}Count`, decimal(sealRegistry.fields[`${scope}_count`], `SealRegistry.${scope}_count`)],
          [`${scope}Commitment`, moveHash(sealRegistry.fields[`${scope}_commitment`], `SealRegistry.${scope}_commitment`)],
        ])),
        revision: decimal(sealRegistry.fields.revision, 'SealRegistry.revision'),
        runtimeRevision: decimal(sealRegistry.fields.runtime_revision, 'SealRegistry.runtime_revision'), sealed: true,
      },
      sealPolicyConfigId: runtime.roleConfigIds.seal,
    }, document);
  };
}

export function assertMakerV8PackCompilerTransactionV8(authority, transaction, expected = {}) {
  const proof = COMPILER_TRANSACTIONS.get(transaction);
  if (proof?.executionBlocked) {
    fail('MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE', 'Authored Pack execution remains blocked pending complete publication and consumer acceptance.');
  }
  if (!proof || proof.authority !== authority
    || expected.signer !== undefined && proof.signer !== expected.signer
    || expected.kindBytes !== undefined && proof.kindBytes !== expected.kindBytes
    || expected.kindSha256 !== undefined && proof.kindSha256 !== expected.kindSha256) {
    fail('MAKER_V8_PACK_COMPILER_TRANSACTION_PROOF_REQUIRED', 'Boundary requires this compiler authority exact Transaction instance.');
  }
  return proof;
}

export function assertMakerV8PackSignedArtifactV8(authority, input) {
  const proof = COMPILER_SIGNED_ARTIFACTS.get(authority)?.get(input?.digest);
  if (!proof || proof.signer !== input.signer || proof.bytes !== input.bytes
    || proof.signature !== input.signature) {
    fail(
      'MAKER_V8_PACK_COMPILER_SIGNED_PROOF_REQUIRED',
      'Pack broadcast requires an exact signed artifact reauthorized from durable WAL.',
    );
  }
  return proof;
}

export function createMakerV8PackCompilerV8({
  runtime: runtimeInput,
  loadAuthority,
  loadProtectedAuthority = null,
  loadParent = null,
  readback,
  chunkSize = MAKER_V8_PACK_COMPILER_CHUNK_SIZE,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  if (typeof loadAuthority !== 'function') fail('MAKER_V8_PACK_COMPILER_AUTHORITY_LOADER_REQUIRED', 'Pack compiler authority loader is required.');
  if (typeof readback?.certifyStage !== 'function') fail('MAKER_V8_PACK_COMPILER_READBACK_REQUIRED', 'Pack compiler readback certifier is required.');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 128) {
    fail('MAKER_V8_PACK_COMPILER_CHUNK_INVALID', 'Pack compiler chunk size must be from 1 to 128.');
  }
  const packageTuple = makerV8AttestedPackageTuple(runtime);
  const runtimePackage = packageTuple.find((entry) => entry.role === 'runtime');
  const releasePackage = packageTuple.find((entry) => entry.role === 'release');
  if (!runtimePackage || runtimePackage.callablePackageId !== runtime.roles.runtime.callablePackageId) {
    fail('MAKER_V8_PACK_COMPILER_RUNTIME_DRIFT', 'Attested Runtime package tuple is incomplete.');
  }
  if (!releasePackage || releasePackage.callablePackageId !== runtime.roles.release.callablePackageId) {
    fail('MAKER_V8_PACK_COMPILER_RUNTIME_DRIFT', 'Attested Release package tuple is incomplete.');
  }
  const runtimePackageDigest = suiDigest(runtimePackage.packageDigest, 'Runtime package digest');
  const authority = {};

  const validateCompiled = (value) => {
    const compiled = assertCompiled(value);
    if (compiled.runtimePackageId !== runtime.roles.runtime.callablePackageId
      || compiled.corePackageId !== runtime.roles.core.callablePackageId
      || compiled.coreOriginalPackageId !== runtime.roles.core.typeOriginPackageId
      || compiled.runtimePackageDigest !== runtimePackageDigest
      || compiled.releasePackageId !== runtime.roles.release.callablePackageId
      || compiled.paymentCoinType !== runtime.paymentCoinType) {
      fail('MAKER_V8_PACK_COMPILER_RUNTIME_DRIFT', 'Compiled Pack differs from the attested Runtime-v8 package.');
    }
    if (compiled.protection !== null) {
      const protectedAuthority = compiled.protection.authority;
      if (protectedAuthority.protocolConfig.objectId !== runtime.protocolConfigId
        || protectedAuthority.catalog.objectId !== runtime.catalogId
        || protectedAuthority.releaseConfig.objectId !== runtime.roleConfigIds.release
        || protectedAuthority.sealPolicy.objectId !== runtime.roleConfigIds.seal
        || protectedAuthority.catalogId !== runtime.catalogId
        || protectedAuthority.sealPolicyConfigId !== runtime.roleConfigIds.seal) {
        fail('MAKER_V8_PACK_COMPILER_RUNTIME_DRIFT', 'Protected Pack authority differs from the attested seven-package runtime.');
      }
    }
    return compiled;
  };

  const loadProtection = async (document, purpose) => {
    if (typeof loadProtectedAuthority !== 'function') {
      fail(
        'MAKER_V8_PACK_PROTECTION_AUTHORITY_REQUIRED',
        'Protected Pack publication requires the exact live Seal/Release authority loader.',
      );
    }
    return assertProtectionAuthority(
      await loadProtectedAuthority({ document: structuredClone(document), purpose }),
      document,
    );
  };

  const assertPublishedParent = async (document) => {
    if (document.authoring === undefined) return;
    if (typeof loadParent !== 'function') {
      fail('MAKER_V8_PACK_PARENT_RESOLVER_REQUIRED', 'Authored Pack compilation requires the independently certified Maker content reader.');
    }
    const expected = packPublicationAuthoringContent(document).content.parent;
    const published = await loadParent({ rootId: document.bindings.root.objectRef.objectId,
      rootVersion: document.bindings.root.makerVersion, rootContentCommitment: document.bindings.root.contentCommitment });
    if (!plain(published) || !same(published, expected)) {
      fail('MAKER_V8_PACK_PARENT_CONTENT_MISMATCH', 'Retained Pack parent differs from independently certified published Maker content.');
    }
  };

  const assertFreshAuthority = async (compiled, purpose, completedStyles = 0) => {
    await assertPublishedParent(compiled.document);
    const live = assertAuthorityInputs(
      await loadAuthority({ document: structuredClone(compiled.document), purpose }),
      compiled.document,
    );
    if (!same(live, compiled.inputs)) {
      fail(
        'MAKER_V8_PACK_COMPILER_AUTHORITY_DRIFT',
        'Live Pack authority differs from the immutable compiler inputs.',
        { purpose },
      );
    }
    if (compiled.protection !== null) {
      const observed = await loadProtection(compiled.document, purpose);
      const expectedRows = compiled.protection.rows.filter((row) => row.styleIndex < completedStyles);
      const expectedRevision = expectedRows.at(-1)?.nextRuntimeRevision
        ?? compiled.protection.authority.runtimeRevision;
      const expectedRuntimeCommitment = expectedRows.at(-1)?.nextRuntimeCommitment
        ?? compiled.protection.authority.runtimeCommitment;
      const expected = {
        ...structuredClone(compiled.protection.authority),
        runtimeRevision: expectedRevision,
        runtimeCommitment: expectedRuntimeCommitment,
        registryCommitment: expectedRuntimeCommitment,
        registryState: expectedRows.at(-1)?.nextRegistryState ?? compiled.protection.authority.registryState,
      };
      if (!same(observed, expected)) {
        fail(
          'MAKER_V8_PACK_PROTECTION_AUTHORITY_DRIFT',
          'Live Seal registry differs from the exact protected Pack prefix.',
          { purpose, completedStyles },
        );
      }
    }
    return live;
  };

  const attestBuilt = async (compiled, cursor) => {
    const built = await buildDescriptor(authority, compiled, cursor);
    return freeze({ authority, transaction: built.transaction, descriptor: built.descriptor });
  };

  const initialCursor = (compiled) => ({
    ordinal: 0,
    stage: 'INIT',
    startStyle: 0,
    endStyle: 0,
    predecessor: null,
  });

  const definitionContext = async (compiled, head) => {
    const authored = packPublicationAuthoringContent(compiled.document);
    const value = await compileMakerV8PackDefinitionRowsV8(authored.content,
      { expectedParent: authored.content.parent, semanticPackId: compiled.document.metadata.semanticPackId });
    const options = { corePackageId: compiled.corePackageId, coreOriginalPackageId: compiled.coreOriginalPackageId,
      runtimePackageId: compiled.runtimePackageId, paymentCoinType: compiled.paymentCoinType, signer: compiled.signer,
      releaseRef: { objectId: head.release.input.objectId, initialSharedVersion: head.release.input.initialSharedVersion },
      adminCapRef: head.adminCap.objectRef, baseRegistryRef: { objectId: compiled.inputs.baseRegistry.objectId,
        initialSharedVersion: compiled.inputs.baseRegistry.initialSharedVersion }, releaseContentCommitment: compiled.contentCommitment };
    const plan = await planMakerV8PackDefinitionRegistrationV8(value, options);
    return { value, plan, options };
  };

  const successorCursor = async (compiled, headValue) => {
    const head = assertCheckpoint(headValue, compiled);
    if (head.stage === 'FINALIZE') {
      fail('MAKER_V8_PACK_COMPILER_SUCCESSOR_INVALID', 'Final Pack checkpoint has no successor.');
    }
    const start = Number(head.observedStyleCount);
    if (compiled.document.authoring !== undefined && (head.stage === 'INIT' || head.stage.startsWith('DEFINITIONS_'))) {
      const definitions = await definitionContext(compiled, head);
      if (head.stage === 'INIT' ? head.ordinal !== 0 :
        `DEFINITIONS_${definitions.plan.steps[head.ordinal - 1]?.stage}` !== head.stage) {
        fail('MAKER_V8_PACK_CHECKPOINT_DRIFT', 'Definition checkpoint is outside the source-derived publication sequence.');
      }
      const step = definitions.plan.steps[head.ordinal];
      if (step) return { ordinal: head.ordinal + 1, stage: `DEFINITIONS_${step.stage}`,
        startStyle: 0, endStyle: 0, predecessor: head, definitions };
    }
    if (start < compiled.document.styles.length) {
      return {
        ordinal: head.ordinal + 1,
        stage: 'APPEND',
        startStyle: start,
        endStyle: Math.min(start + compiled.chunkSize, compiled.document.styles.length),
        predecessor: head,
      };
    }
    return {
      ordinal: head.ordinal + 1,
      stage: 'FINALIZE',
      startStyle: start,
      endStyle: start,
      predecessor: head,
    };
  };

  const draftProtectedContext = async (draft, purpose) => {
    const document = assertMakerV8PackDocumentV8(draft?.document, { mode: 'DRAFT' });
    if (!draft || !same(draft.document, document)) {
      fail('MAKER_V8_PACK_COMPILER_DOCUMENT_DRIFT', 'Protected Pack preparation requires the exact durable draft.');
    }
    const protectedStyles = document.styles.filter((style) => style.asset.protected);
    if (protectedStyles.length === 0) {
      return freeze({ document, protectedStyles, authority: null });
    }
    return freeze({
      document,
      protectedStyles,
      authority: await loadProtection(document, purpose),
    });
  };

  return freeze({
    schemaVersion: MAKER_V8_PACK_COMPILER_SCHEMA,
    authority,

    async prepareProtectedAssetIdentities({ draft, assets } = {}) {
      if (!Array.isArray(assets)) {
        fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Protected Pack identity preparation requires exact local assets.');
      }
      const context = await draftProtectedContext(draft, 'PREPARE_PROTECTED_IDENTITIES');
      const byId = new Map(assets.map((asset) => [asset?.assetId, asset]));
      if (byId.size !== assets.length) {
        fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Protected Pack local asset IDs must be unique.');
      }
      const prepared = context.protectedStyles.map((style) => {
        const asset = byId.get(style.asset.assetId);
        if (!asset || asset.mediaType !== style.asset.mediaType
          || asset.byteLength !== style.asset.byteLength
          || asset.sha256 !== style.asset.sha256
          || style.asset.contentCommitment !== style.asset.sha256) {
          fail('MAKER_V8_PACK_PROTECTED_ASSET_DRIFT', 'Protected Pack plaintext differs from its exact Style descriptor.');
        }
        const identity = assertMakerV8ProtectedAssetIdentityV8({
          schemaVersion: MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
          signer: context.document.author.address,
          scopeKind: 1,
          scopeKey: `pack/${context.document.metadata.semanticPackId}`,
          assetKey: protectedAssetKey(style),
          rootContentCommitment: context.document.bindings.root.contentCommitment,
          makerVersion: context.document.bindings.root.makerVersion,
          releasePackageId: runtime.roles.release.typeOriginPackageId,
          productBindingCommitment: context.authority.productBindingCommitment,
          policyCommitment: context.authority.policyCommitment,
          sealPolicyConfigId: context.authority.sealPolicyConfigId,
          assetContentCommitment: style.asset.contentCommitment,
        });
        return freeze({ assetId: style.asset.assetId, identity });
      }).sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
      return freeze({
        schemaVersion: 'animacraft.maker-v8-pack-protected-identities.v1',
        signerAddress: context.document.author.address,
        assets: prepared,
      });
    },

    async bindProtectedAssetTransports({ draft, assets } = {}) {
      if (!Array.isArray(assets)) {
        fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Protected Pack binding requires exact uploaded assets.');
      }
      const context = await draftProtectedContext(draft, 'BIND_PROTECTED_TRANSPORTS');
      const document = structuredClone(context.document);
      const byId = new Map(assets.map((asset) => [asset?.assetId, asset]));
      if (byId.size !== assets.length || byId.size !== document.styles.length) {
        fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Pack binding requires exactly one uploaded asset for every Style.');
      }
      for (const style of document.styles) {
        const uploaded = byId.get(style.asset.assetId);
        if (!uploaded || typeof uploaded.blobId !== 'string' || !uploaded.blobId
          || !Number.isSafeInteger(uploaded.byteLength) || uploaded.byteLength < 1
          || !HASH.test(uploaded.sha256)) {
          fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Uploaded Pack asset metadata is invalid.');
        }
        if (style.asset.protected) {
          if (uploaded.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE) {
            fail('MAKER_V8_PACK_PROTECTED_ASSET_INVALID', 'Protected Pack assets must publish canonical Seal ciphertext.');
          }
        } else if (uploaded.mediaType !== style.asset.mediaType
          || uploaded.byteLength !== style.asset.byteLength
          || uploaded.sha256 !== style.asset.sha256) {
          fail('MAKER_V8_PACK_PROTECTED_ASSET_DRIFT', 'Unprotected Pack upload differs from its exact local bytes.');
        }
        style.asset.blobId = uploaded.blobId;
        style.asset.mediaType = uploaded.mediaType;
        style.asset.byteLength = uploaded.byteLength;
        style.asset.sha256 = uploaded.sha256;
      }
      const contentCommitment = deriveMakerV8PackSemanticContentCommitmentV8(context.document);
      const rows = context.authority === null
        ? [] : deriveProtectedRows(document, contentCommitment, context.authority);
      rows.forEach((row) => {
        document.styles[row.styleIndex].asset.sealBindingCommitment = row.sealBindingCommitment;
      });
      const compiledDocument = assertMakerV8PackDocumentV8(document, { mode: 'COMPILE' });
      return freeze({
        schemaVersion: 'animacraft.maker-v8-pack-protected-bindings.v1',
        document: structuredClone(compiledDocument),
        contentCommitment,
      });
    },

    async compilePack({ draft, document: documentInput, documentSha256, context } = {}) {
      const document = assertMakerV8PackDocumentV8(documentInput, { mode: 'COMPILE' });
      if (draft?.document === undefined || !same(draft.document, document)
        || documentSha256 !== hashValue(document)) {
        fail('MAKER_V8_PACK_COMPILER_DOCUMENT_DRIFT', 'Pack compiler input differs from its exact draft/document hash.');
      }
      if (document.styles.length < 1) {
        fail('MAKER_V8_PACK_COMPILER_STYLES_REQUIRED', 'Pack publication requires at least one exact Style.');
      }
      await assertPublishedParent(document);
      const transport = assertMakerV8PackPreparedTransportV8(context?.transport, document);
      const inputs = assertAuthorityInputs(
        await loadAuthority({ document: structuredClone(document), purpose: 'INITIAL_COMPILE' }),
        document,
      );
      const hasProtected = document.styles.some((style) => style.asset.protected);
      const protectionAuthority = hasProtected
        ? await loadProtection(document, 'INITIAL_COMPILE') : null;
      const protection = hasProtected ? {
        authority: structuredClone(protectionAuthority),
        rows: deriveProtectedRows(document, transport.manifest.contentCommitment, protectionAuthority),
      } : null;
      const commitments = deriveMakerV8PackCommitmentsV8(document, transport.manifest.contentCommitment);
      const publicationInput = validateCompiled({
        schemaVersion: MAKER_V8_PACK_COMPILED_SCHEMA,
        chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        signer: document.author.address,
        documentSha256,
        document: structuredClone(document),
        runtimePackageId: runtime.roles.runtime.callablePackageId,
        corePackageId: runtime.roles.core.callablePackageId,
        coreOriginalPackageId: runtime.roles.core.typeOriginPackageId,
        runtimePackageDigest,
        releasePackageId: runtime.roles.release.callablePackageId,
        paymentCoinType: runtime.paymentCoinType,
        transport: structuredClone(transport),
        inputs: structuredClone(inputs),
        accessKind: ACCESS[document.access.kind],
        completeMode: COMPLETE[document.completion.mode],
        contentCommitment: transport.manifest.contentCommitment,
        emptyStyleCommitment: commitments.emptyStyleCommitment,
        expectedStyleCommitment: commitments.expectedStyleCommitment,
        rollingCommitments: [...commitments.rollingCommitments],
        styleCommitments: commitments.styles.map((style) => toHex(style.style_commitment)),
        chunkSize,
        protection: structuredClone(protection),
      });
      return freeze({
        schemaVersion: MAKER_V8_PACK_COMPILER_RESULT_SCHEMA,
        authority,
        documentSha256,
        publicationInput: structuredClone(publicationInput),
      });
    },

    async prepare(request) {
      exact(request, [
        'schemaVersion', 'kind', 'draftId', 'draftRevision', 'documentSha256',
        'publicationInput',
      ], 'Pack publication request');
      const compiled = validateCompiled(request?.publicationInput);
      if (request.schemaVersion !== 'animacraft.maker-v8-pack-publication-request.v1'
        || request.kind !== 'PACK'
        || typeof request.draftId !== 'string' || !request.draftId.length
        || !Number.isSafeInteger(request.draftRevision) || request.draftRevision < 1
        || request.documentSha256 !== compiled.documentSha256) {
        fail('MAKER_V8_PACK_COMPILER_REQUEST_DRIFT', 'Pack publication request differs from the compiled artifact.');
      }
      await assertPublishedParent(compiled.document);
      const built = await attestBuilt(compiled, initialCursor(compiled));
      return freeze({
        ...built,
        attemptId: `pack-${hashValue({
          draftId: request.draftId,
          draftRevision: request.draftRevision,
          documentSha256: compiled.documentSha256,
          compiledSha256: hashValue(compiled),
        }).slice(0, 48)}`,
      });
    },

    async rehydrate({ plan, purpose = 'REHYDRATE', requireFreshAuthority = false }) {
      const compiled = validateCompiled(plan?.immutable?.request?.publicationInput);
      if (requireFreshAuthority) {
        if (compiled.document.authoring !== undefined) {
          fail('MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE', 'Authored Pack signing/replay remains blocked until publication mapping is complete.');
        }
        await assertFreshAuthority(compiled, purpose, Number(plan?.head?.observedStyleCount ?? 0));
      }
      const cursor = plan.current.descriptor.stage === 'INIT'
        ? initialCursor(compiled)
        : await successorCursor(compiled, plan.head);
      const built = await attestBuilt(compiled, cursor);
      if (!same(built.descriptor, plan.current.descriptor)) {
        fail('MAKER_V8_PACK_COMPILER_REHYDRATE_DRIFT', 'Pack compiler rebuild differs from the durable descriptor.');
      }
      authorizeDurableSignedArtifact(authority, plan, compiled);
      return built;
    },

    async prepareSuccessor({ plan, head }) {
      const compiled = validateCompiled(plan?.immutable?.request?.publicationInput);
      await assertFreshAuthority(compiled, 'PREPARE_SUCCESSOR', Number(head?.observedStyleCount ?? 0));
      return attestBuilt(compiled, await successorCursor(compiled, head));
    },

    async certifyFinalized({ plan, query, artifact }) {
      const compiled = validateCompiled(plan?.immutable?.request?.publicationInput);
      const descriptor = plan.current.descriptor;
      const cursor = descriptor.stage === 'INIT' ? initialCursor(compiled) : await successorCursor(compiled, plan.head);
      const rebuilt = await attestBuilt(compiled, cursor);
      if (!same(rebuilt.descriptor, descriptor)) fail('MAKER_V8_PACK_COMPILER_REHYDRATE_DRIFT', 'Finalized cursor differs from the source-derived plan.');
      const result = await readback.certifyStage({
        definitions: cursor.definitions ?? null,
        compiled: structuredClone(compiled),
        descriptor: structuredClone(descriptor),
        predecessor: structuredClone(plan.head),
        query: structuredClone(query),
        artifact: structuredClone(artifact),
      });
      exact(result, ['checkpoint', 'chain'], 'Pack stage readback');
      const checkpoint = assertCheckpoint(result.checkpoint, compiled, descriptor.ordinal);
      if (checkpoint.stage !== descriptor.stage || checkpoint.digest !== artifact.digest
        || checkpoint.kindSha256 !== descriptor.kindSha256
        || checkpoint.startStyle !== descriptor.startStyle
        || checkpoint.endStyle !== descriptor.endStyle) {
        fail('MAKER_V8_PACK_COMPILER_READBACK_DRIFT', 'Pack checkpoint differs from its finalized descriptor.');
      }
      const complete = descriptor.stage === 'FINALIZE';
      if (complete !== (result.chain !== null)) {
        fail('MAKER_V8_PACK_COMPILER_READBACK_DRIFT', 'Only FINALIZE may yield one certified active Pack chain state.');
      }
      return freeze({ authority, checkpoint, complete, chain: structuredClone(result.chain) });
    },

    async certifyPackPublication({ draft, plan, documentSha256 }) {
      const compiled = validateCompiled(plan?.immutable?.request?.publicationInput);
      if (plan?.status !== 'COMPLETE' || !plan.terminal?.chain
        || documentSha256 !== compiled.documentSha256
        || !same(draft?.document, compiled.document)) {
        fail('MAKER_V8_PACK_COMPILER_CERTIFICATION_INVALID', 'Completed Pack plan differs from its exact compiler document or chain evidence.');
      }
      return freeze({
        schemaVersion: MAKER_V8_PACK_PUBLICATION_CERTIFICATION_SCHEMA,
        authority,
        attemptId: plan.attemptId,
        documentSha256,
        readback: structuredClone(plan.terminal.chain),
      });
    },
  });
}

// Keep Base64 parsing in the module trust boundary: compiled TransactionKind
// descriptors are independently re-parsed by the durable Pack publication WAL.
void fromBase64;
