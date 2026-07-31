import { EncryptedObject, SealClient, SessionKey } from '@mysten/seal';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import {
  fromHex,
  normalizeSuiAddress,
  toHex,
} from '@mysten/sui/utils';

export const MAKER_SEAL_V5_SCHEMA = 'animacraft.maker-seal.v5';
export const MAKER_SEAL_ASSET_V5_SCHEMA = 'animacraft.sealed-asset.v5';
export const MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA =
  'animacraft.sealed-complete-output.v5';
export const MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE =
  'application/vnd.animacraft.seal-v5';
export const MAKER_SEAL_MODULE = 'seal_v5';
export const MAKER_SEAL_APPROVE_FUNCTION =
  'seal_approve_paid_style_v5';
export const MAKER_SEAL_APPROVE_COMPLETE_OUTPUT_FUNCTION =
  'seal_approve_complete_output_v5';
export const SOULIDITY_ANIMACRAFT_OUTPUT_SEAL_MODULE =
  'animacraft_output_seal';
export const SOULIDITY_ANIMACRAFT_OUTPUT_SEAL_APPROVE_FUNCTION =
  'seal_approve_animacraft_complete_output_v5';
export const MAKER_SEAL_COMPLETE_OUTPUT_MODE = 'SEAL_COMPLETE_OUTPUT';
export const MAKER_SEAL_DEFAULT_TTL_MIN = 10;
export const MAKER_SEAL_MAX_TTL_MIN = 30;
export const MAKER_SEAL_PRODUCT_BASE = 0;
export const MAKER_SEAL_PRODUCT_PACK = 1;

const SHA2_256_BYTES = 32;
const MAX_SEAL_SERVERS = 32;
const TEXT_ENCODER = new TextEncoder();

const SealIdentityV5Bcs = bcs.struct('SealIdentityV5', {
  release_commitment: bcs.byteVector(),
  product_kind: bcs.u8(),
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  pack_key: bcs.string(),
  asset_digest: bcs.byteVector(),
});

const PaidStyleAssetV5Bcs = bcs.struct('PaidStyleAssetV5', {
  seal_id: bcs.byteVector(),
  product_kind: bcs.u8(),
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  pack_key: bcs.string(),
  ciphertext_blob_id: bcs.string(),
  asset_digest: bcs.byteVector(),
});

const CompleteOutputIdentityV5Bcs = bcs.struct('CompleteOutputIdentityV5', {
  root_id: bcs.Address,
  payer: bcs.Address,
  recipe_hash: bcs.byteVector(),
  output_nonce: bcs.byteVector(),
  output_digest: bcs.byteVector(),
});

export class MakerSealV5Error extends Error {
  constructor(message, code = 'MAKER_SEAL_V5_INVALID', details = {}) {
    super(message);
    this.name = 'MakerSealV5Error';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new MakerSealV5Error(message, code, details);
}

function requiredString(value, label) {
  const result = String(value || '').trim();
  if (!result) {
    fail('MAKER_SEAL_V5_REQUIRED', `${label} is required.`);
  }
  return result;
}

function exactBytes(value, length, label) {
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value)
      && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? Uint8Array.from(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : typeof value === 'string'
          ? fromHex(value)
          : null;
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    fail(
      'MAKER_SEAL_V5_INVALID_BYTES',
      `${label} must contain exactly ${length} bytes.`,
      { length: bytes?.length ?? null },
    );
  }
  return new Uint8Array(bytes);
}

function bytesValue(value, label) {
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value)
      && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? Uint8Array.from(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!(bytes instanceof Uint8Array)) {
    fail(
      'MAKER_SEAL_V5_INVALID_BYTES',
      `${label} must be binary data.`,
    );
  }
  return new Uint8Array(bytes);
}

function normalizedId(value, label) {
  try {
    return normalizeSuiAddress(requiredString(value, label));
  } catch {
    return fail(
      'MAKER_SEAL_V5_INVALID_SUI_ID',
      `${label} must be a valid Sui address or object ID.`,
    );
  }
}

function normalizedHex(bytes) {
  return `0x${toHex(bytes)}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

async function sha256(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : TEXT_ENCODER.encode(String(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

async function blobBytes(blob, label = 'Asset') {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    fail(
      'MAKER_SEAL_V5_BLOB_MISSING',
      `${label} must be a readable Blob or File.`,
    );
  }
  return new Uint8Array(await blob.arrayBuffer());
}

function runtimeBlob(record) {
  if (record && typeof record.arrayBuffer === 'function') return record;
  if (record?.blob && typeof record.blob.arrayBuffer === 'function') {
    return record.blob;
  }
  if (record?.file && typeof record.file.arrayBuffer === 'function') {
    return record.file;
  }
  return null;
}

function runtimeRecord(runtimeAssets, assetId) {
  return runtimeAssets instanceof Map
    ? runtimeAssets.get(assetId)
    : runtimeAssets?.[assetId];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeServerConfigs(serverConfigs) {
  if (!Array.isArray(serverConfigs)
    || serverConfigs.length < 1
    || serverConfigs.length > MAX_SEAL_SERVERS) {
    fail(
      'MAKER_SEAL_V5_SERVER_CONFIG',
      `Choose between 1 and ${MAX_SEAL_SERVERS} Seal key servers.`,
    );
  }
  const seen = new Set();
  return serverConfigs.map((server, index) => {
    const objectId = normalizedId(
      server?.objectId,
      `Seal key server ${index + 1} object ID`,
    );
    if (seen.has(objectId)) {
      fail(
        'MAKER_SEAL_V5_DUPLICATE_SERVER',
        'Each Seal key server object ID must be unique.',
        { objectId },
      );
    }
    seen.add(objectId);
    const weight = Number(server?.weight);
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > 255) {
      fail(
        'MAKER_SEAL_V5_SERVER_WEIGHT',
        'Every Seal key server needs a weight from 1 through 255.',
        { objectId, weight: server?.weight },
      );
    }
    const apiKeyName = String(server?.apiKeyName || '').trim();
    const apiKey = String(server?.apiKey || '').trim();
    if (Boolean(apiKeyName) !== Boolean(apiKey)) {
      fail(
        'MAKER_SEAL_V5_SERVER_API_KEY',
        'A Seal key server API key header and value must be configured together.',
        { objectId },
      );
    }
    return {
      objectId,
      weight,
      ...(server?.aggregatorUrl
        ? { aggregatorUrl: requiredString(server.aggregatorUrl, 'Seal aggregator URL') }
        : {}),
      ...(apiKeyName
        ? { apiKeyName }
        : {}),
      ...(apiKey
        ? { apiKey }
        : {}),
    };
  });
}

function publicServerDescriptor(serverConfigs) {
  return serverConfigs.map(({ objectId, weight, aggregatorUrl }) => ({
    objectId,
    weight,
    ...(aggregatorUrl ? { aggregatorUrl } : {}),
  }));
}

function assertThreshold(threshold, serverConfigs) {
  const value = Number(threshold);
  const totalWeight = serverConfigs.reduce(
    (total, server) => total + server.weight,
    0,
  );
  if (!Number.isSafeInteger(value) || value < 1 || value > totalWeight) {
    fail(
      'MAKER_SEAL_V5_THRESHOLD',
      'Seal threshold must be a positive integer no larger than total server weight.',
      { threshold, totalWeight },
    );
  }
  return value;
}

export function createMakerSealClientV5({
  suiClient,
  serverConfigs,
  verifyKeyServers = true,
  timeout = 10_000,
} = {}) {
  if (!suiClient?.core) {
    fail(
      'MAKER_SEAL_V5_SUI_CLIENT',
      'Seal requires a Sui client with the Core API.',
    );
  }
  const configs = normalizeServerConfigs(serverConfigs);
  const timeoutMs = Number(timeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    fail(
      'MAKER_SEAL_V5_TIMEOUT',
      'Seal timeout must be between 1,000 and 60,000 milliseconds.',
    );
  }
  return new SealClient({
    suiClient,
    serverConfigs: configs,
    verifyKeyServers: verifyKeyServers !== false,
    timeout: timeoutMs,
  });
}

export async function digestMakerSealAssetV5(bytesOrBlob) {
  const bytes = bytesOrBlob instanceof Uint8Array
    ? bytesOrBlob
    : await blobBytes(bytesOrBlob);
  return sha256(bytes);
}

function exactProductKind(value) {
  const kind = value === 'BASE'
    ? MAKER_SEAL_PRODUCT_BASE
    : value === 'PACK'
      ? MAKER_SEAL_PRODUCT_PACK
      : Number(value);
  if (![MAKER_SEAL_PRODUCT_BASE, MAKER_SEAL_PRODUCT_PACK].includes(kind)) {
    fail(
      'MAKER_SEAL_V5_PRODUCT_KIND',
      'A protected Style must be gated by paid Base access or a paid Pack.',
    );
  }
  return kind;
}

function exactPackKey(productKind, value) {
  return exactProductKind(productKind) === MAKER_SEAL_PRODUCT_PACK
    ? requiredString(value, 'Pack key')
    : String(value || '').trim();
}

export async function deriveMakerSealIdV5({
  releaseCommitment,
  productKind,
  partKey,
  itemKey,
  styleKey,
  packKey,
  assetDigest,
} = {}) {
  const exactKind = exactProductKind(productKind);
  const identity = {
    release_commitment: exactBytes(
      releaseCommitment,
      SHA2_256_BYTES,
      'Seal release commitment',
    ),
    product_kind: exactKind,
    part_key: requiredString(partKey, 'Part key'),
    item_key: requiredString(itemKey, 'Item key'),
    style_key: requiredString(styleKey, 'Style key'),
    pack_key: exactPackKey(exactKind, packKey),
    asset_digest: exactBytes(
      assetDigest,
      SHA2_256_BYTES,
      'PNG asset digest',
    ),
  };
  const bytes = SealIdentityV5Bcs.serialize(identity).toBytes();
  const idBytes = await sha256(bytes);
  return Object.freeze({
    id: normalizedHex(idBytes),
    idBytes,
    identity: Object.freeze({
      releaseCommitment: normalizedHex(identity.release_commitment),
      productKind: identity.product_kind,
      partKey: identity.part_key,
      itemKey: identity.item_key,
      styleKey: identity.style_key,
      packKey: identity.pack_key,
      assetDigest: normalizedHex(identity.asset_digest),
    }),
  });
}

export async function deriveMakerCompleteOutputSealIdV5({
  makerRootId,
  payer,
  recipeHash,
  outputNonce,
  outputDigest,
} = {}) {
  const identity = {
    root_id: normalizedId(makerRootId, 'MakerRootV5 ID'),
    payer: normalizedId(payer, 'Complete payer'),
    recipe_hash: exactBytes(
      recipeHash,
      SHA2_256_BYTES,
      'Complete recipe hash',
    ),
    output_nonce: exactBytes(
      outputNonce,
      SHA2_256_BYTES,
      'Complete output nonce',
    ),
    output_digest: exactBytes(
      outputDigest,
      SHA2_256_BYTES,
      'Complete output plaintext digest',
    ),
  };
  const bytes = CompleteOutputIdentityV5Bcs.serialize(identity).toBytes();
  const idBytes = await sha256(bytes);
  return Object.freeze({
    id: normalizedHex(idBytes),
    idBytes,
    identity: Object.freeze({
      makerRootId: identity.root_id,
      payer: identity.payer,
      recipeHash: normalizedHex(identity.recipe_hash),
      outputNonce: normalizedHex(identity.output_nonce),
      outputDigest: normalizedHex(identity.output_digest),
    }),
  });
}

function paidProjectionBindings(manifest) {
  const projection = manifest?.moveProjectionV2;
  const commerce = projection?.commerce;
  if (!commerce || !Array.isArray(commerce.packPolicies)) {
    return [];
  }
  const basePaid = commerce.makerAccess?.mode === 'ONE_TIME_PAID';
  const packAccess = new Map(
    commerce.packPolicies
      .map((policy) => [
        String(policy?.packId || ''),
        String(policy?.accessMode || ''),
      ])
      .filter(([packKey]) => packKey),
  );
  const styleProducts = new Map(
    (Array.isArray(commerce.styleProducts) ? commerce.styleProducts : [])
      .map((style) => [
        `${String(style.partKey || '')}\u0000${String(style.itemKey || '')}`,
        style,
      ]),
  );
  return (Array.isArray(projection.items) ? projection.items : [])
    .filter((item) => item?.projectionKind === 'style')
    .flatMap((item) => {
      const product = styleProducts.get(
        `${String(item.partKey || '')}\u0000${String(item.itemKey || '')}`,
      );
      const packKey = String(product?.packId || '');
      const packPaid = packKey
        && packAccess.get(packKey) === 'ONE_TIME_PAID';
      if (!packPaid && !basePaid) return [];
      const productKind = packPaid
        ? MAKER_SEAL_PRODUCT_PACK
        : MAKER_SEAL_PRODUCT_BASE;
      const assetId = String(item?.assetRef?.assetId || '');
      const partKey = String(product?.partKey || item.partKey || '');
      const itemKey = String(product?.itemKey || item.itemKey || '');
      const styleKey = String(product?.styleKey || item.sourceStyleId || '');
      if (!assetId || !partKey || !itemKey || !styleKey) {
        fail(
          'MAKER_SEAL_V5_PROJECTION_INCOMPLETE',
          'Every paid Pack Style needs an exact projected Style and PNG Asset.',
          { item: clone(item), product: clone(product) },
        );
      }
      return [{
        assetId,
        partKey,
        itemKey,
        styleKey,
        packKey,
        productKind,
        sourcePartId: String(item.sourcePartId || ''),
        sourceItemId: String(item.sourceItemId || ''),
        sourceStyleId: String(item.sourceStyleId || ''),
      }];
    });
}

export function makerV5PaidSealBindings(manifest) {
  return Object.freeze(
    paidProjectionBindings(manifest)
      .map((binding) => Object.freeze({ ...binding })),
  );
}

export function makerV5RequiresSealProtection(manifest) {
  return paidProjectionBindings(manifest).length > 0;
}

function assertPaidAssetsArePrivateOnly(document, bindings) {
  const paidAssetIds = new Set(bindings.map((binding) => binding.assetId));
  const publicReferences = [];
  const add = (assetId, path) => {
    const id = String(assetId || '');
    if (id && paidAssetIds.has(id)) publicReferences.push({ assetId: id, path });
  };
  add(document?.metadata?.coverAssetId, 'metadata.coverAssetId');
  (Array.isArray(document?.layerTracks) ? document.layerTracks : [])
    .forEach((track, index) => (
      add(track?.referenceAssetId, `layerTracks.${track?.id || index}.referenceAssetId`)
    ));
  const inspectParts = (parts, prefix) => {
    (Array.isArray(parts) ? parts : []).forEach((part, partIndex) => {
      const partPath = `${prefix}.${part?.id || partIndex}`;
      add(part?.iconAssetId, `${partPath}.iconAssetId`);
      (Array.isArray(part?.items) ? part.items : []).forEach((item, itemIndex) => {
        add(
          item?.thumbnailAssetId,
          `${partPath}.items.${item?.id || itemIndex}.thumbnailAssetId`,
        );
      });
    });
  };
  inspectParts(document?.parts, 'parts');
  (Array.isArray(document?.extensions?.expansionDrafts)
    ? document.extensions.expansionDrafts
    : []
  ).forEach((pack, packIndex) => {
    const prefix = `extensions.expansionDrafts.${pack?.packId || packIndex}`;
    (Array.isArray(pack?.layerTracks) ? pack.layerTracks : [])
      .forEach((track, trackIndex) => {
        add(
          track?.referenceAssetId,
          `${prefix}.layerTracks.${track?.id || trackIndex}.referenceAssetId`,
        );
      });
    inspectParts(pack?.parts, `${prefix}.parts`);
  });
  if (publicReferences.length) {
    fail(
      'MAKER_SEAL_V5_PAID_ASSET_PUBLIC_REFERENCE',
      'A paid Pack PNG cannot also be a public cover, icon, thumbnail, or track reference. Upload a separate public preview image.',
      { references: publicReferences },
    );
  }
}

function publicationAssetBlobs(bundle) {
  const result = new Map();
  (Array.isArray(bundle?.entries) ? bundle.entries : []).forEach((entry) => {
    const assetId = String(entry?.assetId || '');
    if (!assetId) return;
    if (result.has(assetId)) {
      fail(
        'MAKER_SEAL_V5_DUPLICATE_BUNDLE_ASSET',
        `Publication bundle contains Asset "${assetId}" more than once.`,
        { assetId },
      );
    }
    const blob = runtimeBlob(entry?.blob);
    if (blob) result.set(assetId, blob);
  });
  return result;
}

async function assetDigestsForBindings(bindings, bundle, runtimeAssets) {
  const records = new Map();
  const bundleBlobs = publicationAssetBlobs(bundle);
  for (const binding of bindings) {
    if (records.has(binding.assetId)) {
      fail(
        'MAKER_SEAL_V5_SHARED_PAID_ASSET',
        'Each paid Style must own an independent PNG Asset so its Seal identity stays exact.',
        {
          assetId: binding.assetId,
          first: records.get(binding.assetId).binding,
          second: binding,
        },
      );
    }
    // Encrypt the exact Blob already selected for the Walrus publication
    // bundle. Runtime assets are only a backwards-compatible fallback.
    const blob = bundleBlobs.get(binding.assetId)
      || runtimeBlob(runtimeRecord(runtimeAssets, binding.assetId));
    if (!blob) {
      fail(
        'MAKER_SEAL_V5_PAID_BLOB_MISSING',
        `Paid Pack Asset "${binding.assetId}" has no readable source PNG.`,
        { assetId: binding.assetId },
      );
    }
    const bytes = await blobBytes(blob, `Paid Pack Asset "${binding.assetId}"`);
    const digest = await sha256(bytes);
    records.set(binding.assetId, { binding, blob, bytes, digest });
  }
  return records;
}

async function assertPaidAssetContentsAreNotPublic(
  bindings,
  bundle,
  runtimeAssets,
  paidRecords,
) {
  const paidAssetIds = new Set(bindings.map((binding) => binding.assetId));
  const paidDigestOwners = new Map();
  paidRecords.forEach((record, assetId) => {
    const digest = normalizedHex(record.digest);
    const owners = paidDigestOwners.get(digest) || [];
    owners.push(assetId);
    paidDigestOwners.set(digest, owners);
  });
  const publicEntries = (Array.isArray(bundle?.entries) ? bundle.entries : [])
    .filter((entry) => (
      entry?.kind !== 'maker-manifest'
      && entry?.assetId
      && !paidAssetIds.has(String(entry.assetId))
    ));
  for (const entry of publicEntries) {
    const assetId = String(entry.assetId);
    const blob = runtimeBlob(entry.blob)
      || runtimeBlob(runtimeRecord(runtimeAssets, assetId));
    if (!blob) {
      fail(
        'MAKER_SEAL_V5_PUBLIC_BLOB_MISSING',
        `Public Asset "${assetId}" has no readable source Blob for the paid-content privacy audit.`,
        { assetId, identifier: String(entry.identifier || '') },
      );
    }
    const digest = normalizedHex(await digestMakerSealAssetV5(blob));
    const paidOwners = paidDigestOwners.get(digest);
    if (paidOwners?.length) {
      fail(
        'MAKER_SEAL_V5_PAID_CONTENT_PUBLIC_COPY',
        'Paid PNG bytes cannot be republished under another public Asset ID, including covers, icons, thumbnails, or free Styles.',
        {
          publicAssetId: assetId,
          publicIdentifier: String(entry.identifier || ''),
          paidAssetIds: [...paidOwners],
          assetDigest: digest,
        },
      );
    }
  }
}

export async function buildMakerSealReleaseCommitmentV5(
  manifest,
  assetDigestRecords = new Map(),
) {
  const assets = [...assetDigestRecords.entries()]
    .map(([assetId, record]) => ({
      assetId,
      digest: normalizedHex(record.digest),
      productKind: record.binding.productKind,
      partKey: record.binding.partKey,
      itemKey: record.binding.itemKey,
      styleKey: record.binding.styleKey,
      packKey: record.binding.packKey,
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const immutableManifest = clone(manifest || {});
  // Seal metadata is derived from this commitment, so exclude only that
  // self-reference. Every other immutable release field stays committed.
  delete immutableManifest.seal;
  const immutableRelease = {
    schema: MAKER_SEAL_V5_SCHEMA,
    manifest: immutableManifest,
    paidAssets: assets,
  };
  return sha256(TEXT_ENCODER.encode(stableJson(immutableRelease)));
}

export async function encryptMakerPaidPackAssetV5({
  sealClient,
  sealPackageId,
  threshold,
  releaseCommitment,
  binding,
  assetBytes,
  assetDigest,
  plaintextMediaType = 'image/png',
  serverConfigs = [],
} = {}) {
  if (!sealClient?.encrypt) {
    fail(
      'MAKER_SEAL_V5_CLIENT_MISSING',
      'A configured Seal client is required to encrypt paid Pack assets.',
    );
  }
  const packageId = normalizedId(sealPackageId, 'Seal policy package ID');
  const configs = normalizeServerConfigs(serverConfigs);
  const exactThreshold = assertThreshold(threshold, configs);
  const bytes = bytesValue(assetBytes, 'Paid Pack Asset');
  if (!bytes.length) {
    fail('MAKER_SEAL_V5_EMPTY_ASSET', 'A paid Pack PNG cannot be empty.');
  }
  const digest = assetDigest
    ? exactBytes(assetDigest, SHA2_256_BYTES, 'PNG asset digest')
    : await sha256(bytes);
  const derived = await deriveMakerSealIdV5({
    releaseCommitment,
    productKind: binding?.productKind,
    partKey: binding?.partKey,
    itemKey: binding?.itemKey,
    styleKey: binding?.styleKey,
    packKey: binding?.packKey,
    assetDigest: digest,
  });
  const aadValue = {
    schema: MAKER_SEAL_ASSET_V5_SCHEMA,
    sealPackageId: packageId,
    sealId: derived.id,
    releaseCommitment: normalizedHex(exactBytes(
      releaseCommitment,
      SHA2_256_BYTES,
      'Seal release commitment',
    )),
    assetDigest: normalizedHex(digest),
    productKind: derived.identity.productKind,
    partKey: derived.identity.partKey,
    itemKey: derived.identity.itemKey,
    styleKey: derived.identity.styleKey,
    packKey: derived.identity.packKey,
    plaintextMediaType: requiredString(
      plaintextMediaType,
      'Plaintext media type',
    ),
  };
  const aad = TEXT_ENCODER.encode(stableJson(aadValue));
  const { encryptedObject } = await sealClient.encrypt({
    threshold: exactThreshold,
    packageId,
    id: derived.id,
    data: bytes,
    aad,
  });
  const ciphertext = encryptedObject instanceof Uint8Array
    ? encryptedObject
    : new Uint8Array(encryptedObject);
  if (!ciphertext.length) {
    fail(
      'MAKER_SEAL_V5_EMPTY_CIPHERTEXT',
      'Seal returned an empty ciphertext.',
    );
  }
  const ciphertextDigest = await sha256(ciphertext);
  return Object.freeze({
    blob: new Blob([ciphertext], { type: MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE }),
    bytes: ciphertext,
    registration: Object.freeze({
      sealId: derived.id,
      sealIdBytes: derived.idBytes,
      productKind: derived.identity.productKind,
      partKey: derived.identity.partKey,
      itemKey: derived.identity.itemKey,
      styleKey: derived.identity.styleKey,
      packKey: derived.identity.packKey,
      assetDigest: normalizedHex(digest),
      assetDigestBytes: digest,
    }),
    protection: Object.freeze({
      schemaVersion: MAKER_SEAL_ASSET_V5_SCHEMA,
      mode: 'SEAL_PAID_PACK',
      sealPackageId: packageId,
      sealId: derived.id,
      releaseCommitment: normalizedHex(exactBytes(
        releaseCommitment,
        SHA2_256_BYTES,
        'Seal release commitment',
      )),
      assetDigest: normalizedHex(digest),
      ciphertextDigest: normalizedHex(ciphertextDigest),
      productKind: derived.identity.productKind,
      partKey: derived.identity.partKey,
      itemKey: derived.identity.itemKey,
      styleKey: derived.identity.styleKey,
      packKey: derived.identity.packKey,
      threshold: exactThreshold,
      keyServers: publicServerDescriptor(configs),
      plaintextMediaType: aadValue.plaintextMediaType,
      ciphertextMediaType: MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE,
      aad: stableJson(aadValue),
    }),
  });
}

/**
 * Encrypts the exact final Complete OC bytes before any payment transaction is
 * signed. The public low-resolution preview is deliberately not part of this
 * ciphertext: it is bound later as a separate display URL for Soulidity.
 */
export async function encryptMakerCompleteOutputV5({
  sealClient,
  sealPackageId,
  makerRootId,
  payer,
  recipeHash,
  outputNonce,
  outputBlob,
  outputBytes,
  plaintextMediaType = 'image/png',
  threshold,
  serverConfigs = [],
} = {}) {
  if (!sealClient?.encrypt) {
    fail(
      'MAKER_SEAL_V5_CLIENT_MISSING',
      'A configured Seal client is required to encrypt the final Complete OC.',
    );
  }
  const packageId = normalizedId(
    sealPackageId,
    'Seal policy package ID',
  );
  const configs = normalizeServerConfigs(serverConfigs);
  const exactThreshold = assertThreshold(threshold, configs);
  const bytes = outputBytes !== undefined
    ? bytesValue(outputBytes, 'Complete OC output')
    : await blobBytes(outputBlob, 'Complete OC output');
  if (!bytes.length) {
    fail(
      'MAKER_SEAL_V5_EMPTY_COMPLETE_OUTPUT',
      'The final Complete OC PNG cannot be empty.',
    );
  }
  const digest = await sha256(bytes);
  const nonce = outputNonce === undefined || outputNonce === null
    ? globalThis.crypto.getRandomValues(new Uint8Array(SHA2_256_BYTES))
    : exactBytes(
      outputNonce,
      SHA2_256_BYTES,
      'Complete output nonce',
    );
  const derived = await deriveMakerCompleteOutputSealIdV5({
    makerRootId,
    payer,
    recipeHash,
    outputNonce: nonce,
    outputDigest: digest,
  });
  const mediaType = requiredString(
    plaintextMediaType,
    'Complete output plaintext media type',
  );
  const aadValue = {
    schema: MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA,
    sealPackageId: packageId,
    sealId: derived.id,
    makerRootId: derived.identity.makerRootId,
    payer: derived.identity.payer,
    recipeHash: derived.identity.recipeHash,
    outputNonce: derived.identity.outputNonce,
    outputDigest: derived.identity.outputDigest,
    plaintextMediaType: mediaType,
  };
  const aad = TEXT_ENCODER.encode(stableJson(aadValue));
  const { encryptedObject } = await sealClient.encrypt({
    threshold: exactThreshold,
    packageId,
    id: derived.id,
    data: bytes,
    aad,
  });
  const ciphertext = encryptedObject instanceof Uint8Array
    ? encryptedObject
    : new Uint8Array(encryptedObject || []);
  if (!ciphertext.length) {
    fail(
      'MAKER_SEAL_V5_EMPTY_CIPHERTEXT',
      'Seal returned an empty Complete output ciphertext.',
    );
  }
  const ciphertextDigest = await sha256(ciphertext);
  return Object.freeze({
    blob: new Blob([ciphertext], {
      type: MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE,
    }),
    bytes: ciphertext,
    protection: Object.freeze({
      schemaVersion: MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA,
      mode: MAKER_SEAL_COMPLETE_OUTPUT_MODE,
      sealPackageId: packageId,
      sealId: derived.id,
      makerRootId: derived.identity.makerRootId,
      payer: derived.identity.payer,
      recipeHash: derived.identity.recipeHash,
      outputNonce: derived.identity.outputNonce,
      outputDigest: derived.identity.outputDigest,
      ciphertextDigest: normalizedHex(ciphertextDigest),
      ciphertextBlobId: '',
      publicPreviewUrl: '',
      threshold: exactThreshold,
      keyServers: Object.freeze(publicServerDescriptor(configs)),
      plaintextMediaType: mediaType,
      ciphertextMediaType: MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE,
      aad: stableJson(aadValue),
    }),
  });
}

export function bindMakerCompleteOutputCiphertextV5(encrypted, {
  ciphertextBlobId,
  publicPreviewUrl,
} = {}) {
  if (
    encrypted?.protection?.schemaVersion
      !== MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA
    || encrypted?.protection?.mode !== MAKER_SEAL_COMPLETE_OUTPUT_MODE
    || !encrypted?.blob
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_DESCRIPTOR',
      'Encrypt the final Complete OC before binding its Walrus locations.',
    );
  }
  const blobId = requiredString(
    ciphertextBlobId,
    'Complete output ciphertext Walrus Blob ID',
  );
  const previewUrl = requiredString(
    publicPreviewUrl,
    'Complete output public preview URL',
  );
  const protection = Object.freeze({
    ...encrypted.protection,
    ciphertextBlobId: blobId,
    publicPreviewUrl: previewUrl,
  });
  return Object.freeze({
    ...encrypted,
    protection,
    completeOutput: Object.freeze({
      outputSealId: protection.sealId,
      outputNonce: protection.outputNonce,
      outputDigest: protection.outputDigest,
      ciphertextBlobId: blobId,
      publicPreviewUrl: previewUrl,
    }),
  });
}

function completeOutputRecoveryMetadata(value) {
  const protection = value?.protection || value;
  return {
    schemaVersion: String(protection?.schemaVersion || ''),
    mode: String(protection?.mode || ''),
    sealPackageId: String(protection?.sealPackageId || ''),
    sealId: String(protection?.sealId || ''),
    makerRootId: String(protection?.makerRootId || ''),
    payer: String(protection?.payer || ''),
    recipeHash: String(protection?.recipeHash || ''),
    outputNonce: String(protection?.outputNonce || ''),
    outputDigest: String(protection?.outputDigest || ''),
    ciphertextDigest: String(protection?.ciphertextDigest || ''),
    ciphertextBlobId: String(protection?.ciphertextBlobId || ''),
    publicPreviewUrl: String(protection?.publicPreviewUrl || ''),
    threshold: Number(protection?.threshold || 0),
    keyServers: clone(protection?.keyServers || []),
    plaintextMediaType: String(protection?.plaintextMediaType || ''),
    ciphertextMediaType: String(protection?.ciphertextMediaType || ''),
    aad: String(protection?.aad || ''),
  };
}

export function makerCompleteOutputSealRecoveryIdentityV5(value) {
  return stableJson(completeOutputRecoveryMetadata(value));
}

export function makerCompleteOutputSealRecoveryPayloadV5(value) {
  const metadata = completeOutputRecoveryMetadata(value);
  if (
    metadata.schemaVersion !== MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA
    || metadata.mode !== MAKER_SEAL_COMPLETE_OUTPUT_MODE
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_DESCRIPTOR',
      'The Complete output recovery payload needs a valid Seal descriptor.',
    );
  }
  return Object.freeze({
    ...metadata,
    blob: value?.blob,
  });
}

/**
 * Verify a Complete-output ciphertext before any Walrus write. Callers should
 * pass the immutable protection descriptor captured at encryption time as
 * `expectedProtection`; recovery metadata is not itself a trust anchor.
 */
export async function verifyMakerCompleteOutputCiphertextV5(
  payload,
  { expectedProtection = payload?.protection || payload, requireLocations = false } = {},
) {
  const metadata = completeOutputRecoveryMetadata(payload);
  const expected = completeOutputRecoveryMetadata(expectedProtection);
  if (
    metadata.schemaVersion !== MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA
    || metadata.mode !== MAKER_SEAL_COMPLETE_OUTPUT_MODE
    || metadata.threshold < 1
    || (requireLocations
      && (!metadata.ciphertextBlobId || !metadata.publicPreviewUrl))
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_RECOVERY',
      'The Complete output recovery checkpoint is incomplete.',
    );
  }
  const immutableFields = [
    'schemaVersion',
    'mode',
    'sealPackageId',
    'sealId',
    'makerRootId',
    'payer',
    'recipeHash',
    'outputNonce',
    'outputDigest',
    'ciphertextDigest',
    'threshold',
    'plaintextMediaType',
    'ciphertextMediaType',
    'aad',
  ];
  if (immutableFields.some((field) => metadata[field] !== expected[field])) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_DESCRIPTOR_MISMATCH',
      'Recovered Complete output metadata differs from its immutable encryption descriptor.',
    );
  }
  normalizedId(metadata.sealPackageId, 'Seal policy package ID');
  normalizedId(metadata.makerRootId, 'MakerRootV5 ID');
  normalizedId(metadata.payer, 'Complete payer');
  exactBytes(metadata.sealId, SHA2_256_BYTES, 'Complete output Seal ID');
  exactBytes(metadata.recipeHash, SHA2_256_BYTES, 'Complete recipe hash');
  exactBytes(metadata.outputNonce, SHA2_256_BYTES, 'Complete output nonce');
  exactBytes(
    metadata.outputDigest,
    SHA2_256_BYTES,
    'Complete output plaintext digest',
  );
  const expectedCiphertextDigest = normalizedHex(exactBytes(
    metadata.ciphertextDigest,
    SHA2_256_BYTES,
    'Complete output ciphertext digest',
  ));
  const actualCiphertextDigest = normalizedHex(
    await digestMakerSealAssetV5(payload?.blob),
  );
  if (actualCiphertextDigest !== expectedCiphertextDigest) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_CIPHERTEXT',
      'The persisted Complete output ciphertext failed its immutable digest check.',
    );
  }
  const derived = await deriveMakerCompleteOutputSealIdV5({
    makerRootId: metadata.makerRootId,
    payer: metadata.payer,
    recipeHash: metadata.recipeHash,
    outputNonce: metadata.outputNonce,
    outputDigest: metadata.outputDigest,
  });
  if (derived.id !== normalizedHex(exactBytes(
    metadata.sealId,
    SHA2_256_BYTES,
    'Complete output Seal ID',
  ))) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ID',
      'The Complete output recovery checkpoint has a mismatched Seal identity.',
    );
  }
  const expectedAad = stableJson({
    schema: MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA,
    sealPackageId: normalizedId(
      metadata.sealPackageId,
      'Seal policy package ID',
    ),
    sealId: derived.id,
    makerRootId: derived.identity.makerRootId,
    payer: derived.identity.payer,
    recipeHash: derived.identity.recipeHash,
    outputNonce: derived.identity.outputNonce,
    outputDigest: derived.identity.outputDigest,
    plaintextMediaType: requiredString(
      metadata.plaintextMediaType,
      'Complete output plaintext media type',
    ),
  });
  if (
    metadata.aad !== expectedAad
    || metadata.ciphertextMediaType !== MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_AAD',
      'The Complete output ciphertext identity or authenticated data is inconsistent.',
    );
  }
  return true;
}

export async function verifyMakerCompleteOutputSealRecoveryPayloadV5(payload) {
  return verifyMakerCompleteOutputCiphertextV5(payload, {
    expectedProtection: payload,
    requireLocations: true,
  });
}

/**
 * Replace every PNG gated by paid Base or paid Pack access with Seal
 * ciphertext before the Walrus Quilt is encoded. Public preview assets stay
 * unchanged.
 */
export async function protectMakerV5PaidPackAssetsForPublication({
  document,
  bundle,
  runtimeAssets,
  sealClient,
  sealPackageId,
  threshold,
  serverConfigs,
} = {}) {
  if (!bundle?.manifest || !Array.isArray(bundle.entries)) {
    fail(
      'MAKER_SEAL_V5_BUNDLE_MISSING',
      'Build the immutable Maker publication bundle before applying Seal.',
    );
  }
  const bindings = paidProjectionBindings(bundle.manifest);
  if (!bindings.length) {
    return Object.freeze({
      ...bundle,
      seal: Object.freeze({
        schemaVersion: MAKER_SEAL_V5_SCHEMA,
        required: false,
        paidAssetCount: 0,
        registrationRecords: Object.freeze([]),
      }),
    });
  }
  assertPaidAssetsArePrivateOnly(document, bindings);
  const records = await assetDigestsForBindings(
    bindings,
    bundle,
    runtimeAssets,
  );
  await assertPaidAssetContentsAreNotPublic(
    bindings,
    bundle,
    runtimeAssets,
    records,
  );
  const releaseCommitment = await buildMakerSealReleaseCommitmentV5(
    bundle.manifest,
    records,
  );
  const encryptedByAssetId = new Map();
  for (const [assetId, record] of records) {
    encryptedByAssetId.set(assetId, await encryptMakerPaidPackAssetV5({
      sealClient,
      sealPackageId,
      threshold,
      releaseCommitment,
      binding: record.binding,
      assetBytes: record.bytes,
      assetDigest: record.digest,
      plaintextMediaType: record.blob.type || 'image/png',
      serverConfigs,
    }));
  }

  const manifest = clone(bundle.manifest);
  manifest.seal = {
    schemaVersion: MAKER_SEAL_V5_SCHEMA,
    required: true,
    sealPackageId: normalizedId(sealPackageId, 'Seal policy package ID'),
    releaseCommitment: normalizedHex(releaseCommitment),
    threshold: Number(threshold),
    keyServers: publicServerDescriptor(normalizeServerConfigs(serverConfigs)),
    paidAssetCount: encryptedByAssetId.size,
    policyObjectId: null,
  };
  manifest.assets = (Array.isArray(manifest.assets) ? manifest.assets : [])
    .map((asset) => {
      const encrypted = encryptedByAssetId.get(String(asset?.id || ''));
      return encrypted
        ? { ...asset, protection: clone(encrypted.protection) }
        : asset;
    });
  const manifestJson = JSON.stringify(manifest);
  const manifestBlob = new Blob([manifestJson], { type: 'application/json' });
  const entries = bundle.entries.map((entry) => {
    if (entry.kind === 'maker-manifest') {
      return { ...entry, blob: manifestBlob };
    }
    const encrypted = encryptedByAssetId.get(String(entry.assetId || ''));
    return encrypted
      ? {
        ...entry,
        blob: encrypted.blob,
        kind: 'sealed-paid-pack-asset',
        plaintextKind: entry.kind,
      }
      : entry;
  });
  const assetEntries = entries.filter((entry) => entry.kind !== 'maker-manifest');
  const renderAssetEntries = entries.filter((entry) => (
    entry.assetId && entry.projectionOnly !== true
  ));
  const registrationRecords = [...encryptedByAssetId.entries()]
    .map(([assetId, encrypted]) => ({
      assetId,
      ...encrypted.registration,
    }))
    .sort((left, right) => left.sealId.localeCompare(right.sealId));
  if (
    registrationRecords.length !== bindings.length
    || manifest.seal.paidAssetCount !== bindings.length
  ) {
    fail(
      'MAKER_SEAL_V5_COVERAGE_MISMATCH',
      'Every paid Pack Style must have exactly one encrypted PNG and one on-chain registration.',
      {
        projectedPaidStyles: bindings.length,
        encryptedAssets: manifest.seal.paidAssetCount,
        registrationRecords: registrationRecords.length,
      },
    );
  }
  return Object.freeze({
    ...bundle,
    manifest,
    manifestJson,
    entries,
    assetEntries,
    renderAssetEntries,
    seal: Object.freeze({
      schemaVersion: MAKER_SEAL_V5_SCHEMA,
      required: true,
      sealPackageId: manifest.seal.sealPackageId,
      releaseCommitment: manifest.seal.releaseCommitment,
      threshold: manifest.seal.threshold,
      keyServers: Object.freeze(manifest.seal.keyServers),
      paidAssetCount: registrationRecords.length,
      registrationRecords: Object.freeze(registrationRecords),
      sourceManifestJson: String(
        bundle.manifestJson || JSON.stringify(bundle.manifest),
      ),
    }),
  });
}

function serializableRegistration(record) {
  return Object.freeze({
    assetId: requiredString(record?.assetId, 'Protected Asset ID'),
    sealId: normalizedHex(exactBytes(
      record?.sealId,
      SHA2_256_BYTES,
      'Seal ID',
    )),
    productKind: exactProductKind(record?.productKind),
    partKey: requiredString(record?.partKey, 'Part key'),
    itemKey: requiredString(record?.itemKey, 'Item key'),
    styleKey: requiredString(record?.styleKey, 'Style key'),
    packKey: exactPackKey(record?.productKind, record?.packKey),
    assetDigest: normalizedHex(exactBytes(
      record?.assetDigest,
      SHA2_256_BYTES,
      'PNG asset digest',
    )),
  });
}

function sealRecoveryMetadata(payload) {
  return {
    schemaVersion: String(payload?.schemaVersion || ''),
    required: payload?.required === true,
    sealPackageId: String(payload?.sealPackageId || ''),
    releaseCommitment: String(payload?.releaseCommitment || ''),
    threshold: Number(payload?.threshold || 0),
    keyServers: clone(payload?.keyServers || []),
    paidAssetCount: Number(payload?.paidAssetCount || 0),
    sourceManifestJson: String(payload?.sourceManifestJson || ''),
    registrationRecords: (payload?.registrationRecords || [])
      .map(serializableRegistration),
    ciphertextAssets: (payload?.ciphertextAssets || []).map((asset) => ({
      assetId: String(asset?.assetId || ''),
      identifier: String(asset?.identifier || ''),
      kind: String(asset?.kind || ''),
      plaintextKind: String(asset?.plaintextKind || ''),
      ciphertextDigest: String(asset?.ciphertextDigest || ''),
    })),
  };
}

export function makerSealRecoveryIdentityV5(payload) {
  return stableJson(sealRecoveryMetadata(payload));
}

export function makerSealRecoveryPayloadV5(bundle) {
  if (bundle?.seal?.required !== true) return null;
  const manifestAssets = new Map(
    (bundle.manifest?.assets || []).map((asset) => [String(asset?.id || ''), asset]),
  );
  const ciphertextAssets = bundle.entries
    .filter((entry) => entry?.kind === 'sealed-paid-pack-asset')
    .map((entry) => {
      const protection = manifestAssets.get(String(entry.assetId || ''))?.protection;
      return Object.freeze({
        assetId: requiredString(entry.assetId, 'Protected Asset ID'),
        identifier: requiredString(entry.identifier, 'Protected Asset identifier'),
        kind: 'sealed-paid-pack-asset',
        plaintextKind: String(entry.plaintextKind || ''),
        ciphertextDigest: normalizedHex(exactBytes(
          protection?.ciphertextDigest,
          SHA2_256_BYTES,
          'Seal ciphertext digest',
        )),
        blob: entry.blob,
      });
    });
  if (ciphertextAssets.length !== Number(bundle.seal.paidAssetCount)) {
    fail(
      'MAKER_SEAL_V5_RECOVERY_COVERAGE',
      'The recovery payload does not contain every protected ciphertext Blob.',
    );
  }
  return Object.freeze({
    schemaVersion: MAKER_SEAL_V5_SCHEMA,
    required: true,
    sealPackageId: bundle.seal.sealPackageId,
    releaseCommitment: bundle.seal.releaseCommitment,
    threshold: bundle.seal.threshold,
    keyServers: clone(bundle.seal.keyServers),
    paidAssetCount: bundle.seal.paidAssetCount,
    sourceManifestJson: bundle.seal.sourceManifestJson,
    registrationRecords: Object.freeze(
      bundle.seal.registrationRecords.map(serializableRegistration),
    ),
    ciphertextAssets: Object.freeze(ciphertextAssets),
  });
}

export async function verifyMakerSealRecoveryPayloadV5(payload) {
  if (!payload) return true;
  const metadata = sealRecoveryMetadata(payload);
  const registrationIds = metadata.registrationRecords
    .map((record) => record.assetId)
    .sort();
  const ciphertextIds = metadata.ciphertextAssets
    .map((asset) => asset.assetId)
    .sort();
  if (
    metadata.schemaVersion !== MAKER_SEAL_V5_SCHEMA
    || !metadata.required
    || !metadata.sourceManifestJson
    || metadata.registrationRecords.length !== metadata.paidAssetCount
    || metadata.ciphertextAssets.length !== metadata.paidAssetCount
    || new Set(registrationIds).size !== metadata.paidAssetCount
    || new Set(ciphertextIds).size !== metadata.paidAssetCount
    || registrationIds.some((assetId, index) => assetId !== ciphertextIds[index])
    || metadata.ciphertextAssets.some((asset) => (
      asset.kind !== 'sealed-paid-pack-asset'
      || !asset.identifier
      || !asset.ciphertextDigest
    ))
  ) {
    fail(
      'MAKER_SEAL_V5_RECOVERY_COVERAGE',
      'The paid-content recovery payload is incomplete or duplicated.',
    );
  }
  for (const asset of payload.ciphertextAssets || []) {
    const actual = normalizedHex(await digestMakerSealAssetV5(asset?.blob));
    const expected = normalizedHex(exactBytes(
      asset?.ciphertextDigest,
      SHA2_256_BYTES,
      'Seal ciphertext digest',
    ));
    if (actual !== expected) {
      fail(
        'MAKER_SEAL_V5_RECOVERY_CIPHERTEXT',
        'A persisted Seal ciphertext Blob failed its immutable digest check.',
        { assetId: asset?.assetId },
      );
    }
  }
  return true;
}

function sourceManifestShapeFromProtected(manifest) {
  const value = clone(manifest || {});
  delete value.seal;
  value.assets = (Array.isArray(value.assets) ? value.assets : []).map((asset) => {
    const result = { ...asset };
    delete result.protection;
    return result;
  });
  return value;
}

function exactSortedKeys(map) {
  return [...map.keys()].sort();
}

function sameKeys(...maps) {
  if (!maps.length) return true;
  const expected = exactSortedKeys(maps[0]);
  return maps.slice(1).every((map) => {
    const actual = exactSortedKeys(map);
    return actual.length === expected.length
      && actual.every((key, index) => key === expected[index]);
  });
}

/**
 * Strictly anchor a persisted recovery checkpoint to both the original source
 * Manifest and the protected Manifest before any recovered Blob reaches
 * Walrus.
 */
export async function verifyMakerSealProtectedPublicationStateV5({
  sourceBundle,
  manifestJson,
  protectedManifest = null,
  sealRecovery,
} = {}) {
  if (!sourceBundle?.manifest || !Array.isArray(sourceBundle.entries)) {
    fail(
      'MAKER_SEAL_V5_BUNDLE_MISSING',
      'The source publication bundle is required.',
    );
  }
  await verifyMakerSealRecoveryPayloadV5(sealRecovery);
  if (
    String(sourceBundle.manifestJson || '')
      !== String(sealRecovery?.sourceManifestJson || '')
  ) {
    fail(
      'MAKER_SEAL_V5_RECOVERY_SOURCE_MISMATCH',
      'The current Maker graph differs from the source graph that was encrypted.',
    );
  }
  let manifest = protectedManifest;
  if (!manifest) {
    try {
      manifest = JSON.parse(String(manifestJson || ''));
    } catch {
      fail(
        'MAKER_SEAL_V5_RECOVERY_MANIFEST',
        'The persisted protected Manifest is not valid JSON.',
      );
    }
  }
  const recovery = sealRecoveryMetadata(sealRecovery);
  if (
    manifest?.seal?.required !== true
    || manifest.seal.schemaVersion !== MAKER_SEAL_V5_SCHEMA
    || manifest.seal.releaseCommitment !== recovery.releaseCommitment
    || manifest.seal.sealPackageId !== recovery.sealPackageId
    || Number(manifest.seal.paidAssetCount) !== recovery.paidAssetCount
    || Number(manifest.seal.threshold) !== recovery.threshold
    || stableJson(manifest.seal.keyServers || [])
      !== stableJson(recovery.keyServers)
    || stableJson(sourceManifestShapeFromProtected(manifest))
      !== stableJson(sourceBundle.manifest)
  ) {
    fail(
      'MAKER_SEAL_V5_RECOVERY_MANIFEST',
      'The protected Manifest does not match its source graph and Seal recovery checkpoint.',
    );
  }

  const expectedBindings = new Map(
    paidProjectionBindings(sourceBundle.manifest)
      .map((binding) => [binding.assetId, binding]),
  );
  const registrations = new Map(
    recovery.registrationRecords.map((record) => [record.assetId, record]),
  );
  const ciphertextAssets = new Map(
    (sealRecovery.ciphertextAssets || [])
      .map((asset) => [String(asset.assetId || ''), asset]),
  );
  const protectedAssets = new Map();
  for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!asset?.protection) continue;
    if (asset.protection.mode !== 'SEAL_PAID_PACK') {
      fail(
        'MAKER_SEAL_V5_RECOVERY_PROTECTION',
        'The protected Manifest contains an unsupported Asset protection mode.',
        { assetId: String(asset.id || '') },
      );
    }
    const assetId = requiredString(asset.id, 'Protected Asset ID');
    if (protectedAssets.has(assetId)) {
      fail(
        'MAKER_SEAL_V5_RECOVERY_COVERAGE',
        'The protected Manifest contains a duplicate protected Asset.',
        { assetId },
      );
    }
    protectedAssets.set(assetId, asset.protection);
  }
  if (
    !sameKeys(
      expectedBindings,
      registrations,
      ciphertextAssets,
      protectedAssets,
    )
    || expectedBindings.size !== recovery.paidAssetCount
  ) {
    fail(
      'MAKER_SEAL_V5_RECOVERY_COVERAGE',
      'Paid source Styles, registrations, ciphertexts, and protected Manifest Assets must have the same exact Asset IDs.',
      {
        sourceAssetIds: exactSortedKeys(expectedBindings),
        registrationAssetIds: exactSortedKeys(registrations),
        ciphertextAssetIds: exactSortedKeys(ciphertextAssets),
        protectedAssetIds: exactSortedKeys(protectedAssets),
      },
    );
  }

  for (const [assetId, binding] of expectedBindings) {
    const record = registrations.get(assetId);
    const ciphertext = ciphertextAssets.get(assetId);
    const protection = protectedAssets.get(assetId);
    const identityMatches = (
      Number(record.productKind) === Number(binding.productKind)
      && record.partKey === binding.partKey
      && record.itemKey === binding.itemKey
      && record.styleKey === binding.styleKey
      && record.packKey === binding.packKey
      && Number(protection.productKind) === Number(record.productKind)
      && protection.partKey === record.partKey
      && protection.itemKey === record.itemKey
      && protection.styleKey === record.styleKey
      && String(protection.packKey || '') === record.packKey
      && protection.assetDigest === record.assetDigest
      && protection.releaseCommitment === recovery.releaseCommitment
      && protection.sealPackageId === recovery.sealPackageId
      && protection.schemaVersion === MAKER_SEAL_ASSET_V5_SCHEMA
      && protection.ciphertextMediaType === MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE
      && ciphertext.kind === 'sealed-paid-pack-asset'
      && String(ciphertext.ciphertextDigest || '')
        === String(protection.ciphertextDigest || '')
    );
    if (!identityMatches) {
      fail(
        'MAKER_SEAL_V5_RECOVERY_PROTECTION',
        'A paid source Style, registration, ciphertext, or protected Asset descriptor differs.',
        { assetId },
      );
    }
    const derived = await deriveMakerSealIdV5({
      releaseCommitment: recovery.releaseCommitment,
      productKind: record.productKind,
      partKey: record.partKey,
      itemKey: record.itemKey,
      styleKey: record.styleKey,
      packKey: record.packKey,
      assetDigest: record.assetDigest,
    });
    const expectedAad = stableJson({
      schema: MAKER_SEAL_ASSET_V5_SCHEMA,
      sealPackageId: recovery.sealPackageId,
      sealId: derived.id,
      releaseCommitment: recovery.releaseCommitment,
      assetDigest: record.assetDigest,
      productKind: Number(record.productKind),
      partKey: record.partKey,
      itemKey: record.itemKey,
      styleKey: record.styleKey,
      packKey: record.packKey,
      plaintextMediaType: requiredString(
        protection.plaintextMediaType,
        'Protected Asset plaintext media type',
      ),
    });
    const actualCiphertextDigest = normalizedHex(
      await digestMakerSealAssetV5(ciphertext.blob),
    );
    if (
      protection.sealId !== record.sealId
      || record.sealId !== derived.id
      || protection.aad !== expectedAad
      || actualCiphertextDigest !== protection.ciphertextDigest
    ) {
      fail(
        'MAKER_SEAL_V5_RECOVERY_CIPHERTEXT',
        'A recovered paid ciphertext failed its protected Manifest digest or Seal identity.',
        { assetId },
      );
    }
  }
  return manifest;
}

export async function restoreMakerSealPublicationBundleV5({
  sourceBundle,
  manifestJson,
  sealRecovery,
} = {}) {
  if (!sourceBundle?.manifest || !Array.isArray(sourceBundle.entries)) {
    fail('MAKER_SEAL_V5_BUNDLE_MISSING', 'The source publication bundle is required.');
  }
  const manifest = await verifyMakerSealProtectedPublicationStateV5({
    sourceBundle,
    manifestJson,
    sealRecovery,
  });
  const ciphertextByAssetId = new Map(
    sealRecovery.ciphertextAssets.map((asset) => [String(asset.assetId), asset]),
  );
  const manifestBlob = new Blob([String(manifestJson)], {
    type: 'application/json',
  });
  const entries = sourceBundle.entries.map((entry) => {
    if (entry.kind === 'maker-manifest') return { ...entry, blob: manifestBlob };
    const protectedAsset = ciphertextByAssetId.get(String(entry.assetId || ''));
    return protectedAsset
      ? {
        ...entry,
        blob: protectedAsset.blob,
        kind: 'sealed-paid-pack-asset',
        plaintextKind: protectedAsset.plaintextKind || entry.kind,
      }
      : entry;
  });
  if (
    entries.filter((entry) => entry.kind === 'sealed-paid-pack-asset').length
      !== sealRecovery.paidAssetCount
  ) {
    fail(
      'MAKER_SEAL_V5_RECOVERY_COVERAGE',
      'The source publication entries do not match every persisted ciphertext.',
    );
  }
  return Object.freeze({
    ...sourceBundle,
    manifest,
    manifestJson: String(manifestJson),
    entries,
    assetEntries: entries.filter((entry) => entry.kind !== 'maker-manifest'),
    renderAssetEntries: entries.filter((entry) => (
      entry.assetId && entry.projectionOnly !== true
    )),
    seal: Object.freeze({
      ...sealRecoveryMetadata(sealRecovery),
      registrationRecords: Object.freeze(
        sealRecovery.registrationRecords.map(serializableRegistration),
      ),
    }),
  });
}

export function buildMakerSealPublicationPlanV5({
  manifest,
  sealRecovery,
  entries,
  files,
} = {}) {
  if (manifest?.seal?.required !== true) {
    return Object.freeze({ required: false, registrations: Object.freeze([]) });
  }
  if (
    !sealRecovery
    || sealRecovery.releaseCommitment !== manifest.seal.releaseCommitment
    || sealRecovery.sealPackageId !== manifest.seal.sealPackageId
    || Number(sealRecovery.paidAssetCount) !== Number(manifest.seal.paidAssetCount)
  ) {
    fail(
      'MAKER_SEAL_V5_PUBLICATION_PLAN',
      'The certified Manifest and Seal recovery checkpoint do not match.',
    );
  }
  const protectedAssets = new Map(
    (manifest.assets || [])
      .filter((asset) => asset?.protection?.mode === 'SEAL_PAID_PACK')
      .map((asset) => [String(asset.id || ''), asset.protection]),
  );
  if (protectedAssets.size !== Number(manifest.seal.paidAssetCount)) {
    fail(
      'MAKER_SEAL_V5_PUBLICATION_PLAN',
      'The protected Manifest Asset count differs from its Seal header.',
    );
  }
  const recoveryRegistrations = new Map(
    (sealRecovery.registrationRecords || [])
      .map((record) => [String(record.assetId || ''), record]),
  );
  const recoveryCiphertexts = new Map(
    (sealRecovery.ciphertextAssets || [])
      .map((asset) => [String(asset.assetId || ''), asset]),
  );
  if (
    !sameKeys(
      protectedAssets,
      recoveryRegistrations,
      recoveryCiphertexts,
    )
    || protectedAssets.size !== Number(manifest.seal.paidAssetCount)
  ) {
    fail(
      'MAKER_SEAL_V5_PUBLICATION_PLAN',
      'Protected Manifest Assets, registrations, and ciphertext recovery records differ.',
    );
  }
  if (!Array.isArray(entries) || !Array.isArray(files) || entries.length !== files.length) {
    fail(
      'MAKER_SEAL_V5_PUBLICATION_PLAN',
      'Walrus did not return one certified location per publication entry.',
    );
  }
  const locations = new Map();
  const entriesByAssetId = new Map();
  entries.forEach((entry, index) => {
    const assetId = String(entry?.assetId || '');
    if (!assetId) return;
    const ciphertextBlobId = String(files[index]?.id || '');
    if (
      !ciphertextBlobId
      || locations.has(assetId)
      || entriesByAssetId.has(assetId)
    ) {
      fail(
        'MAKER_SEAL_V5_PUBLICATION_PLAN',
        'A protected Asset has a missing or duplicate Walrus quilt-patch ID.',
        { assetId },
      );
    }
    locations.set(assetId, ciphertextBlobId);
    entriesByAssetId.set(assetId, entry);
  });
  const registrations = sealRecovery.registrationRecords.map((record) => {
    const protection = protectedAssets.get(record.assetId);
    const ciphertextBlobId = locations.get(record.assetId);
    const uploadedEntry = entriesByAssetId.get(record.assetId);
    const recoveryCiphertext = recoveryCiphertexts.get(record.assetId);
    if (
      !ciphertextBlobId
      || uploadedEntry?.kind !== 'sealed-paid-pack-asset'
      || !protection
      || recoveryCiphertext?.kind !== 'sealed-paid-pack-asset'
      || recoveryCiphertext?.ciphertextDigest !== protection.ciphertextDigest
      || protection.sealId !== record.sealId
      || Number(protection.productKind) !== Number(record.productKind)
      || protection.partKey !== record.partKey
      || protection.itemKey !== record.itemKey
      || protection.styleKey !== record.styleKey
      || String(protection.packKey || '') !== record.packKey
      || protection.assetDigest !== record.assetDigest
      || protection.releaseCommitment !== manifest.seal.releaseCommitment
    ) {
      fail(
        'MAKER_SEAL_V5_PUBLICATION_PLAN',
        'A protected Asset descriptor, registration, or certified ciphertext Blob ID differs.',
        { assetId: record.assetId },
      );
    }
    return Object.freeze({
      ...serializableRegistration(record),
      ciphertextBlobId,
    });
  });
  if (registrations.length !== Number(manifest.seal.paidAssetCount)) {
    fail(
      'MAKER_SEAL_V5_PUBLICATION_PLAN',
      'The Seal policy plan does not cover every protected Manifest Asset.',
    );
  }
  return Object.freeze({
    required: true,
    sealPackageId: String(manifest.seal.sealPackageId || ''),
    releaseCommitment: String(manifest.seal.releaseCommitment || ''),
    paidAssetCount: registrations.length,
    registrations: Object.freeze(registrations),
  });
}

function transaction(sender) {
  const tx = new Transaction();
  if (sender) tx.setSender(normalizedId(sender, 'Transaction sender'));
  return tx;
}

export function buildCreateMakerSealPolicyV5({
  callablePackageId,
  makerRootId,
  releaseCommitment,
  sender,
} = {}) {
  const tx = transaction(sender);
  tx.moveCall({
    target: `${normalizedId(callablePackageId, 'Seal callable package ID')}::${MAKER_SEAL_MODULE}::create_and_share_maker_seal_policy_v5`,
    arguments: [
      tx.object(normalizedId(makerRootId, 'MakerRootV5 ID')),
      tx.pure.vector('u8', exactBytes(
        releaseCommitment,
        SHA2_256_BYTES,
        'Seal release commitment',
      )),
    ],
  });
  return tx;
}

export function buildRegisterMakerSealPaidStyleV5({
  callablePackageId,
  policyId,
  makerRootId,
  registration,
  sender,
  transaction: suppliedTransaction,
} = {}) {
  const tx = suppliedTransaction || transaction(sender);
  tx.moveCall({
    target: `${normalizedId(callablePackageId, 'Seal callable package ID')}::${MAKER_SEAL_MODULE}::register_paid_style_asset_v5`,
    arguments: [
      tx.object(normalizedId(policyId, 'MakerSealPolicyV5 ID')),
      tx.object(normalizedId(makerRootId, 'MakerRootV5 ID')),
      tx.pure.u8(exactProductKind(registration?.productKind)),
      tx.pure.string(requiredString(registration?.partKey, 'Part key')),
      tx.pure.string(requiredString(registration?.itemKey, 'Item key')),
      tx.pure.string(requiredString(registration?.styleKey, 'Style key')),
      tx.pure.string(exactPackKey(
        registration?.productKind,
        registration?.packKey,
      )),
      tx.pure.vector('u8', exactBytes(
        registration?.assetDigestBytes || registration?.assetDigest,
        SHA2_256_BYTES,
        'PNG asset digest',
      )),
    ],
  });
  return tx;
}

/**
 * Appends policy creation, exact paid-Style registration, sealing, and sharing
 * to an existing Commerce Style-registry sealing PTB. The Commerce registry
 * must be sealed by an earlier command in this transaction (or already
 * sealed), so both immutable registries become visible atomically.
 */
export function appendPublishMakerSealPolicyV5(transactionValue, {
  callablePackageId,
  makerRootId,
  releaseCommitment,
  registrations,
} = {}) {
  const tx = transactionValue;
  if (!tx?.moveCall || !tx?.object || !tx?.pure) {
    fail(
      'MAKER_SEAL_V5_TRANSACTION_MISSING',
      'A Sui Transaction is required to publish the Seal policy.',
    );
  }
  const packageId = normalizedId(
    callablePackageId,
    'Seal callable package ID',
  );
  const rootId = normalizedId(makerRootId, 'MakerRootV5 ID');
  const records = Array.isArray(registrations) ? registrations : [];
  if (!records.length) {
    fail(
      'MAKER_SEAL_V5_REGISTRATIONS_MISSING',
      'At least one paid Style registration is required to publish a Seal policy.',
    );
  }
  const policy = tx.moveCall({
    target: `${packageId}::${MAKER_SEAL_MODULE}::new_maker_seal_policy_v5`,
    arguments: [
      tx.object(rootId),
      tx.pure.vector('u8', exactBytes(
        releaseCommitment,
        SHA2_256_BYTES,
        'Seal release commitment',
      )),
    ],
  });
  for (const registration of records) {
    tx.moveCall({
      target: `${packageId}::${MAKER_SEAL_MODULE}::register_paid_style_asset_v5`,
      arguments: [
        policy,
        tx.object(rootId),
        tx.pure.u8(exactProductKind(registration?.productKind)),
        tx.pure.string(requiredString(registration?.partKey, 'Part key')),
        tx.pure.string(requiredString(registration?.itemKey, 'Item key')),
        tx.pure.string(requiredString(registration?.styleKey, 'Style key')),
        tx.pure.string(exactPackKey(
          registration?.productKind,
          registration?.packKey,
        )),
        tx.pure.vector('u8', exactBytes(
          registration?.assetDigestBytes || registration?.assetDigest,
          SHA2_256_BYTES,
          'PNG asset digest',
        )),
      ],
    });
  }
  tx.moveCall({
    target: `${packageId}::${MAKER_SEAL_MODULE}::seal_maker_seal_policy_v5`,
    arguments: [policy, tx.object(rootId)],
  });
  tx.moveCall({
    target: `${packageId}::${MAKER_SEAL_MODULE}::share_maker_seal_policy_v5`,
    arguments: [policy],
  });
  return Object.freeze({ transaction: tx, policy });
}

export function buildSealMakerSealPolicyV5({
  callablePackageId,
  policyId,
  makerRootId,
  sender,
} = {}) {
  const tx = transaction(sender);
  tx.moveCall({
    target: `${normalizedId(callablePackageId, 'Seal callable package ID')}::${MAKER_SEAL_MODULE}::seal_maker_seal_policy_v5`,
    arguments: [
      tx.object(normalizedId(policyId, 'MakerSealPolicyV5 ID')),
      tx.object(normalizedId(makerRootId, 'MakerRootV5 ID')),
    ],
  });
  return tx;
}

function jsonField(value, ...keys) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return value;
  const fields = value.fields && typeof value.fields === 'object'
    ? value.fields
    : value;
  for (const key of keys) {
    if (Object.hasOwn(fields, key)) return fields[key];
  }
  return undefined;
}

function jsonId(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return jsonId(
    jsonField(value, 'id', 'bytes', 'address')
      || jsonField(jsonField(value, 'id'), 'id', 'bytes'),
  );
}

function u64Number(value, label) {
  let number;
  try {
    number = BigInt(value ?? 0);
  } catch {
    fail('MAKER_SEAL_V5_READBACK_INVALID', `${label} is not an integer.`);
  }
  if (number < 0n || number > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(
      'MAKER_SEAL_V5_READBACK_INVALID',
      `${label} cannot be represented safely by this client.`,
    );
  }
  return Number(number);
}

export function parseMakerSealPolicyV5(object) {
  const json = object?.json || object?.content || object;
  const fields = json?.fields && typeof json.fields === 'object'
    ? json.fields
    : json;
  const type = String(object?.type || json?.type || '');
  if (!/::seal_v5::MakerSealPolicyV5$/.test(type)) {
    fail(
      'MAKER_SEAL_V5_POLICY_TYPE',
      'Expected a seal_v5::MakerSealPolicyV5 object.',
    );
  }
  return Object.freeze({
    objectId: normalizedId(
      object?.objectId || object?.id || jsonId(jsonField(fields, 'id')),
      'MakerSealPolicyV5 ID',
    ),
    type,
    version: u64Number(
      jsonField(fields, 'version'),
      'Seal policy version',
    ),
    rootId: normalizedId(
      jsonId(jsonField(fields, 'root_id', 'rootId')),
      'MakerRootV5 ID',
    ),
    releaseCommitment: normalizedHex(exactBytes(
      jsonField(fields, 'release_commitment', 'releaseCommitment'),
      SHA2_256_BYTES,
      'Seal release commitment',
    )),
    registeredAssetsTableId: normalizedId(
      jsonId(jsonField(fields, 'registered_assets', 'registeredAssets')),
      'MakerSealPolicyV5 registry table ID',
    ),
    assetCount: u64Number(
      jsonField(fields, 'asset_count', 'assetCount'),
      'Seal policy asset count',
    ),
    sealed: jsonField(fields, 'sealed') === true,
  });
}

export function parseMakerSealPolicyCreatedEventV5(event) {
  const json = event?.contents?.json || event?.json || event;
  const fields = json?.fields && typeof json.fields === 'object'
    ? json.fields
    : json;
  try {
    return Object.freeze({
      policyId: normalizedId(
        jsonId(jsonField(fields, 'policy_id', 'policyId')),
        'MakerSealPolicyV5 ID',
      ),
      rootId: normalizedId(
        jsonId(jsonField(fields, 'root_id', 'rootId')),
        'MakerRootV5 ID',
      ),
      releaseCommitment: normalizedHex(exactBytes(
        jsonField(fields, 'release_commitment', 'releaseCommitment'),
        SHA2_256_BYTES,
        'Seal release commitment',
      )),
      digest: String(event?.transaction?.digest || event?.digest || ''),
    });
  } catch {
    return null;
  }
}

export function parseMakerSealRegistrationV5(bytes) {
  const record = PaidStyleAssetV5Bcs.parse(bytesValue(
    bytes,
    'MakerSealPolicyV5 registration BCS',
  ));
  return Object.freeze({
    sealId: normalizedHex(exactBytes(
      record.seal_id,
      SHA2_256_BYTES,
      'Seal ID',
    )),
    productKind: exactProductKind(record.product_kind),
    partKey: String(record.part_key),
    itemKey: String(record.item_key),
    styleKey: String(record.style_key),
    packKey: String(record.pack_key),
    ciphertextBlobId: String(record.ciphertext_blob_id),
    assetDigest: normalizedHex(exactBytes(
      record.asset_digest,
      SHA2_256_BYTES,
      'PNG asset digest',
    )),
  });
}

export async function queryMakerSealRegistrationsV5(client, policy) {
  if (!client?.listDynamicFields) {
    fail(
      'MAKER_SEAL_V5_CLIENT_MISSING',
      'A Sui client with listDynamicFields is required for Seal readback.',
    );
  }
  const records = [];
  let cursor = null;
  do {
    const page = await client.listDynamicFields({
      parentId: normalizedId(
        policy?.registeredAssetsTableId,
        'MakerSealPolicyV5 registry table ID',
      ),
      cursor,
      limit: 50,
      include: { value: true },
    });
    for (const field of page?.dynamicFields || []) {
      const bytes = field?.value?.bcs;
      if (!(bytes instanceof Uint8Array)) {
        fail(
          'MAKER_SEAL_V5_READBACK_MISSING',
          'Sui did not return a paid Style Seal registration as BCS bytes.',
        );
      }
      records.push(parseMakerSealRegistrationV5(bytes));
    }
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor && records.length < 100_000);
  if (records.length !== Number(policy?.assetCount)) {
    fail(
      'MAKER_SEAL_V5_READBACK_COUNT',
      'The Seal registration table does not match MakerSealPolicyV5.asset_count.',
      { expected: policy?.assetCount, actual: records.length },
    );
  }
  const identities = new Set();
  for (const record of records) {
    if (identities.has(record.sealId)) {
      fail(
        'MAKER_SEAL_V5_READBACK_DUPLICATE',
        'The Seal policy contains a duplicate immutable Seal ID.',
      );
    }
    identities.add(record.sealId);
  }
  return Object.freeze(records);
}

export function assertMakerSealPolicyReadbackV5({
  policy,
  registrations,
  makerRootId,
  releaseCommitment,
  expectedRegistrations,
} = {}) {
  if (
    !policy?.sealed
    || policy.version !== 1
    || normalizedId(policy.rootId, 'MakerRootV5 ID')
      !== normalizedId(makerRootId, 'MakerRootV5 ID')
    || normalizedHex(exactBytes(
      policy.releaseCommitment,
      SHA2_256_BYTES,
      'Seal release commitment',
    )) !== normalizedHex(exactBytes(
      releaseCommitment,
      SHA2_256_BYTES,
      'Seal release commitment',
    ))
  ) {
    fail(
      'MAKER_SEAL_V5_POLICY_MISMATCH',
      'The on-chain Seal policy does not match this immutable Maker release.',
    );
  }
  const expected = Array.isArray(expectedRegistrations)
    ? expectedRegistrations
    : [];
  const actual = Array.isArray(registrations) ? registrations : [];
  const expectedById = new Map(expected.map((record) => [
    normalizedHex(exactBytes(record.sealId, SHA2_256_BYTES, 'Seal ID')),
    record,
  ]));
  if (
    expectedById.size !== expected.length
    || actual.length !== expected.length
    || policy.assetCount !== expected.length
  ) {
    fail(
      'MAKER_SEAL_V5_POLICY_COVERAGE',
      'The Seal policy does not contain exactly one registration per paid Style.',
    );
  }
  for (const record of actual) {
    const expectedRecord = expectedById.get(record.sealId);
    if (
      !expectedRecord
      || record.productKind !== exactProductKind(expectedRecord.productKind)
      || record.partKey !== String(expectedRecord.partKey || '')
      || record.itemKey !== String(expectedRecord.itemKey || '')
      || record.styleKey !== String(expectedRecord.styleKey || '')
      || record.packKey !== String(expectedRecord.packKey || '')
      || record.assetDigest !== normalizedHex(exactBytes(
        expectedRecord.assetDigest,
        SHA2_256_BYTES,
        'PNG asset digest',
      ))
      || record.ciphertextBlobId !== String(
        expectedRecord.ciphertextBlobId || '',
      )
    ) {
      fail(
        'MAKER_SEAL_V5_REGISTRATION_MISMATCH',
        'A Seal registration does not match the Manifest, Commerce Style, or ciphertext Blob.',
        { sealId: record.sealId },
      );
    }
  }
  return true;
}

export function buildMakerSealApprovalTransactionV5({
  callablePackageId,
  policyId,
  makerRootId,
  sealId,
  sender,
} = {}) {
  const tx = transaction(sender);
  tx.moveCall({
    target: `${normalizedId(callablePackageId, 'Seal callable package ID')}::${MAKER_SEAL_MODULE}::${MAKER_SEAL_APPROVE_FUNCTION}`,
    arguments: [
      tx.pure.vector('u8', exactBytes(sealId, SHA2_256_BYTES, 'Seal ID')),
      tx.object(normalizedId(policyId, 'MakerSealPolicyV5 ID')),
      tx.object(normalizedId(makerRootId, 'MakerRootV5 ID')),
    ],
  });
  return tx;
}

export function buildMakerCompleteOutputSealApprovalTransactionV5({
  callablePackageId,
  makerRootId,
  sealId,
  sender,
  entitlement,
} = {}) {
  if (!entitlement || typeof entitlement !== 'object') {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ENTITLEMENT',
      'Read the exact Complete output record before building its Seal approval.',
    );
  }
  const exactRootId = normalizedId(
    makerRootId,
    'Complete output MakerRootV5 ID',
  );
  const exactSealId = normalizedHex(exactBytes(
    sealId,
    SHA2_256_BYTES,
    'Complete output Seal ID',
  ));
  if (
    normalizedId(entitlement.rootId, 'Complete output entitlement Root ID')
      !== exactRootId
    || normalizedHex(exactBytes(
      entitlement.sealId,
      SHA2_256_BYTES,
      'Complete output entitlement Seal ID',
    )) !== exactSealId
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ENTITLEMENT_MISMATCH',
      'The Complete output approval does not match its exact on-chain record.',
    );
  }
  if (entitlement.soulBound === true || String(entitlement.boundSoulId || '')) {
    fail(
      'MAKER_SEAL_V5_SOUL_BOUND_APPROVAL_REQUIRED',
      'This Complete output is Soul-bound and must use Soulidity current-owner Seal approval.',
      { boundSoulId: String(entitlement.boundSoulId || '') },
    );
  }
  if (
    normalizedId(entitlement.payer, 'Complete output payer')
      !== normalizedId(sender, 'Complete output payer')
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_PAYER_MISMATCH',
      'Only the exact payer may use the pre-binding Complete output approval.',
    );
  }
  const tx = transaction(sender);
  tx.moveCall({
    target: `${normalizedId(callablePackageId, 'Seal callable package ID')}::${MAKER_SEAL_MODULE}::${MAKER_SEAL_APPROVE_COMPLETE_OUTPUT_FUNCTION}`,
    arguments: [
      tx.pure.vector(
        'u8',
        exactBytes(exactSealId, SHA2_256_BYTES, 'Complete output Seal ID'),
      ),
      tx.object(exactRootId),
    ],
  });
  return tx;
}

/// Builds the only valid Complete-output approval after Soul binding. The
/// Soulidity Move policy verifies immutable Animacraft provenance, the exact
/// bound output companion, and SoulState.current_owner in one dry-run.
export function buildSoulBoundCompleteOutputSealApprovalTransactionV5({
  callablePackageId,
  makerRootId,
  animacraftProvenanceId,
  outputProvenanceId,
  soulStateId,
  sealId,
  sender,
  entitlement,
} = {}) {
  if (!entitlement || typeof entitlement !== 'object') {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ENTITLEMENT',
      'Read the exact Soul-bound Complete output record before building its Seal approval.',
    );
  }
  const exactRootId = normalizedId(
    makerRootId,
    'Complete output MakerRootV5 ID',
  );
  const exactSealId = normalizedHex(exactBytes(
    sealId,
    SHA2_256_BYTES,
    'Complete output Seal ID',
  ));
  const boundSoulId = String(entitlement.boundSoulId || '');
  if (
    entitlement.soulBound !== true
    || !boundSoulId
    || normalizedId(entitlement.rootId, 'Complete output entitlement Root ID')
      !== exactRootId
    || normalizedHex(exactBytes(
      entitlement.sealId,
      SHA2_256_BYTES,
      'Complete output entitlement Seal ID',
    )) !== exactSealId
  ) {
    fail(
      'MAKER_SEAL_V5_SOUL_BINDING_MISMATCH',
      'Soulidity approval requires the exact Soul-bound Complete output record.',
    );
  }
  normalizedId(boundSoulId, 'Complete output bound Soul ID');
  const tx = transaction(sender);
  tx.moveCall({
    target: `${normalizedId(callablePackageId, 'Soulidity callable package ID')}::${SOULIDITY_ANIMACRAFT_OUTPUT_SEAL_MODULE}::${SOULIDITY_ANIMACRAFT_OUTPUT_SEAL_APPROVE_FUNCTION}`,
    arguments: [
      tx.pure.vector(
        'u8',
        exactBytes(exactSealId, SHA2_256_BYTES, 'Complete output Seal ID'),
      ),
      tx.object(exactRootId),
      tx.object(normalizedId(
        animacraftProvenanceId,
        'AnimacraftProvenance ID',
      )),
      tx.object(normalizedId(
        outputProvenanceId,
        'AnimacraftOutputProvenanceV5 ID',
      )),
      tx.object(normalizedId(soulStateId, 'SoulState ID')),
    ],
  });
  return tx;
}

function sessionSignature(result) {
  const signature = typeof result === 'string'
    ? result
    : result?.signature || result?.bytes || result?.result?.signature;
  return requiredString(signature, 'Seal session signature');
}

export async function createMakerSealSessionKeyV5({
  suiClient,
  address,
  sealPackageId,
  signer,
  signPersonalMessage,
  ttlMin = MAKER_SEAL_DEFAULT_TTL_MIN,
} = {}) {
  const ttl = Number(ttlMin);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAKER_SEAL_MAX_TTL_MIN) {
    fail(
      'MAKER_SEAL_V5_SESSION_TTL',
      `Seal session TTL must be between 1 and ${MAKER_SEAL_MAX_TTL_MIN} minutes.`,
    );
  }
  const sessionKey = await SessionKey.create({
    address: normalizedId(address, 'Wallet address'),
    packageId: normalizedId(sealPackageId, 'Seal policy package ID'),
    ttlMin: ttl,
    signer,
    suiClient,
  });
  if (!signer) {
    if (typeof signPersonalMessage !== 'function') {
      fail(
        'MAKER_SEAL_V5_SESSION_SIGNER',
        'A wallet personal-message signer is required for Seal decryption.',
      );
    }
    const signed = await signPersonalMessage({
      message: sessionKey.getPersonalMessage(),
    });
    await sessionKey.setPersonalMessageSignature(sessionSignature(signed));
  }
  return sessionKey;
}

export async function decryptMakerSealAssetV5({
  encryptedBlob,
  protection,
  sealClient,
  sessionKey,
  txBytes,
  parseEncryptedObject = (bytes) => EncryptedObject.parse(bytes),
} = {}) {
  if (protection?.schemaVersion !== MAKER_SEAL_ASSET_V5_SCHEMA
    || protection?.mode !== 'SEAL_PAID_PACK') {
    fail(
      'MAKER_SEAL_V5_PROTECTION_DESCRIPTOR',
      'This Asset does not contain a valid paid Pack Seal descriptor.',
    );
  }
  if (!sealClient?.decrypt) {
    fail(
      'MAKER_SEAL_V5_CLIENT_MISSING',
      'A configured Seal client is required to decrypt paid Pack assets.',
    );
  }
  if (!sessionKey || sessionKey.isExpired?.()) {
    fail(
      'MAKER_SEAL_V5_SESSION_EXPIRED',
      'Create or renew the wallet Seal session before decrypting this Pack.',
    );
  }
  const ciphertext = await blobBytes(encryptedBlob, 'Seal ciphertext');
  const ciphertextDigest = await sha256(ciphertext);
  const expectedCiphertextDigest = exactBytes(
    protection.ciphertextDigest,
    SHA2_256_BYTES,
    'Seal ciphertext digest',
  );
  if (toHex(ciphertextDigest) !== toHex(expectedCiphertextDigest)) {
    fail(
      'MAKER_SEAL_V5_CIPHERTEXT_DIGEST_MISMATCH',
      'The downloaded Seal ciphertext does not match the immutable Maker Manifest.',
    );
  }
  const expectedPackage = normalizedId(
    protection.sealPackageId,
    'Seal policy package ID',
  );
  const expectedId = normalizedHex(exactBytes(
    protection.sealId,
    SHA2_256_BYTES,
    'Seal ID',
  ));
  const envelope = parseEncryptedObject(ciphertext);
  const envelopePackage = normalizedId(
    envelope?.packageId,
    'Encrypted Seal package ID',
  );
  const envelopeId = normalizedHex(exactBytes(
    envelope?.id,
    SHA2_256_BYTES,
    'Encrypted Seal ID',
  ));
  if (envelopePackage !== expectedPackage || envelopeId !== expectedId) {
    fail(
      'MAKER_SEAL_V5_ENVELOPE_MISMATCH',
      'The encrypted PNG does not match its immutable Seal descriptor.',
      {
        expectedPackage,
        envelopePackage,
        expectedId,
        envelopeId,
      },
    );
  }
  const bytes = txBytes instanceof Uint8Array
    ? txBytes
    : new Uint8Array(txBytes || []);
  if (!bytes.length) {
    fail(
      'MAKER_SEAL_V5_APPROVAL_TRANSACTION',
      'Build the Seal approval transaction before requesting decryption.',
    );
  }
  const plaintext = await sealClient.decrypt({
    data: ciphertext,
    sessionKey,
    txBytes: bytes,
    checkShareConsistency: true,
  });
  const digest = await sha256(plaintext);
  const expectedDigest = exactBytes(
    protection.assetDigest,
    SHA2_256_BYTES,
    'PNG asset digest',
  );
  if (toHex(digest) !== toHex(expectedDigest)) {
    fail(
      'MAKER_SEAL_V5_PLAINTEXT_DIGEST_MISMATCH',
      'The decrypted paid Pack PNG does not match the immutable release digest.',
    );
  }
  return new Blob([plaintext], {
    type: requiredString(
      protection.plaintextMediaType || 'image/png',
      'Plaintext media type',
    ),
  });
}

export async function decryptMakerCompleteOutputV5({
  encryptedBlob,
  protection,
  entitlement,
  makerRootId,
  sealClient,
  sessionKey,
  txBytes,
  parseEncryptedObject = (bytes) => EncryptedObject.parse(bytes),
} = {}) {
  if (
    protection?.schemaVersion !== MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA
    || protection?.mode !== MAKER_SEAL_COMPLETE_OUTPUT_MODE
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_DESCRIPTOR',
      'This final OC does not contain a valid Complete output Seal descriptor.',
    );
  }
  if (!sealClient?.decrypt) {
    fail(
      'MAKER_SEAL_V5_CLIENT_MISSING',
      'A configured Seal client is required to decrypt the final Complete OC.',
    );
  }
  if (!sessionKey || sessionKey.isExpired?.()) {
    fail(
      'MAKER_SEAL_V5_SESSION_EXPIRED',
      'Create or renew the wallet Seal session before decrypting this final OC.',
    );
  }
  if (!entitlement || typeof entitlement !== 'object') {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ENTITLEMENT',
      'Read the exact Complete output entitlement from MakerRootV5 before decrypting.',
    );
  }

  const exactRootId = normalizedId(
    makerRootId || entitlement.rootId,
    'Complete output MakerRootV5 ID',
  );
  const exactPayer = normalizedId(entitlement.payer, 'Complete output payer');
  const exactSealId = normalizedHex(exactBytes(
    entitlement.sealId,
    SHA2_256_BYTES,
    'Complete output Seal ID',
  ));
  const exactRecipeHash = normalizedHex(exactBytes(
    entitlement.recipeHash,
    SHA2_256_BYTES,
    'Complete output recipe hash',
  ));
  const exactNonce = normalizedHex(exactBytes(
    entitlement.outputNonce,
    SHA2_256_BYTES,
    'Complete output nonce',
  ));
  const exactDigest = normalizedHex(exactBytes(
    entitlement.outputDigest,
    SHA2_256_BYTES,
    'Complete output plaintext digest',
  ));
  const ciphertextBlobId = requiredString(
    entitlement.ciphertextBlobId,
    'Complete output ciphertext Walrus Blob ID',
  );
  if (
    normalizedId(protection.makerRootId, 'MakerRootV5 ID') !== exactRootId
    || normalizedId(protection.payer, 'Complete payer') !== exactPayer
    || normalizedHex(exactBytes(
      protection.sealId,
      SHA2_256_BYTES,
      'Complete output Seal ID',
    )) !== exactSealId
    || normalizedHex(exactBytes(
      protection.recipeHash,
      SHA2_256_BYTES,
      'Complete recipe hash',
    )) !== exactRecipeHash
    || normalizedHex(exactBytes(
      protection.outputNonce,
      SHA2_256_BYTES,
      'Complete output nonce',
    )) !== exactNonce
    || normalizedHex(exactBytes(
      protection.outputDigest,
      SHA2_256_BYTES,
      'Complete output plaintext digest',
    )) !== exactDigest
    || requiredString(
      protection.ciphertextBlobId,
      'Complete output ciphertext Walrus Blob ID',
    ) !== ciphertextBlobId
  ) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ENTITLEMENT_MISMATCH',
      'The Complete output Seal descriptor does not match its exact on-chain entitlement.',
    );
  }

  const derived = await deriveMakerCompleteOutputSealIdV5({
    makerRootId: exactRootId,
    payer: exactPayer,
    recipeHash: exactRecipeHash,
    outputNonce: exactNonce,
    outputDigest: exactDigest,
  });
  if (derived.id !== exactSealId) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_ID',
      'The Complete output entitlement has an invalid Seal identity.',
    );
  }
  const expectedAad = stableJson({
    schema: MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA,
    sealPackageId: normalizedId(
      protection.sealPackageId,
      'Seal policy package ID',
    ),
    sealId: exactSealId,
    makerRootId: exactRootId,
    payer: exactPayer,
    recipeHash: exactRecipeHash,
    outputNonce: exactNonce,
    outputDigest: exactDigest,
    plaintextMediaType: requiredString(
      protection.plaintextMediaType,
      'Complete output plaintext media type',
    ),
  });
  if (String(protection.aad || '') !== expectedAad) {
    fail(
      'MAKER_SEAL_V5_COMPLETE_OUTPUT_AAD',
      'The Complete output Seal descriptor metadata was modified.',
    );
  }

  const ciphertext = await blobBytes(
    encryptedBlob,
    'Complete output Seal ciphertext',
  );
  const ciphertextDigest = await sha256(ciphertext);
  const expectedCiphertextDigest = exactBytes(
    protection.ciphertextDigest,
    SHA2_256_BYTES,
    'Complete output ciphertext digest',
  );
  if (toHex(ciphertextDigest) !== toHex(expectedCiphertextDigest)) {
    fail(
      'MAKER_SEAL_V5_CIPHERTEXT_DIGEST_MISMATCH',
      'The downloaded final OC ciphertext does not match its immutable descriptor.',
    );
  }
  const expectedPackage = normalizedId(
    protection.sealPackageId,
    'Seal policy package ID',
  );
  const envelope = parseEncryptedObject(ciphertext);
  const envelopePackage = normalizedId(
    envelope?.packageId,
    'Encrypted Seal package ID',
  );
  const envelopeId = normalizedHex(exactBytes(
    envelope?.id,
    SHA2_256_BYTES,
    'Encrypted Complete output Seal ID',
  ));
  if (envelopePackage !== expectedPackage || envelopeId !== exactSealId) {
    fail(
      'MAKER_SEAL_V5_ENVELOPE_MISMATCH',
      'The encrypted final OC does not match its exact Complete entitlement.',
    );
  }
  const bytes = txBytes instanceof Uint8Array
    ? txBytes
    : new Uint8Array(txBytes || []);
  if (!bytes.length) {
    fail(
      'MAKER_SEAL_V5_APPROVAL_TRANSACTION',
      'Build the Complete output Seal approval transaction before decryption.',
    );
  }
  const plaintext = await sealClient.decrypt({
    data: ciphertext,
    sessionKey,
    txBytes: bytes,
    checkShareConsistency: true,
  });
  const plaintextDigest = await sha256(plaintext);
  if (toHex(plaintextDigest) !== toHex(exactBytes(
    exactDigest,
    SHA2_256_BYTES,
    'Complete output plaintext digest',
  ))) {
    fail(
      'MAKER_SEAL_V5_PLAINTEXT_DIGEST_MISMATCH',
      'The decrypted final OC does not match its on-chain digest.',
    );
  }
  return new Blob([plaintext], {
    type: protection.plaintextMediaType,
  });
}
