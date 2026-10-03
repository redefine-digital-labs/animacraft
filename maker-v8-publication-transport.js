import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { bindMakerV8SourceAssets } from './maker-v8-source-asset.js';

import { assertMakerV8Document, projectPublicMakerV8Document } from './maker-v8-document.js';
import { compileMakerV8LivingContentV8 } from './maker-v8-living-content-compiler.js';
import {
  MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
  assertMakerV8ProtectedAssetV8,
} from './maker-v8-protected-transport.js';
import { makerV8WalrusUploadIdV8 } from './maker-v8-walrus.js';

export const MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA =
  'animacraft.maker-v8-publication-transport.v1';

const SAFE_KEY = /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const encoder = new TextEncoder();

export class MakerV8PublicationTransportError extends Error {
  constructor(code, message, layer = 'TRANSPORT', details = {}) {
    super(message);
    this.name = 'MakerV8PublicationTransportError';
    this.code = code;
    this.layer = layer;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, layer = 'TRANSPORT', details = {}) {
  throw new MakerV8PublicationTransportError(code, message, layer, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_TRANSPORT_SHAPE_INVALID', `${label} must be a plain record.`, 'VALIDATION');
  const expected = new Set(fields);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = Object.keys(value).filter((field) => !expected.has(field));
  if (missing.length || unknown.length) {
    fail('MAKER_V8_TRANSPORT_SHAPE_INVALID', `${label} has an unexpected shape.`, 'VALIDATION', {
      missing,
      unknown,
    });
  }
  return value;
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_TRANSPORT_DEPENDENCY_INVALID', `${label}.${method} is required.`, 'CONFIGURATION');
  }
}

function canonicalBase64(value, label) {
  try {
    if (typeof value !== 'string') throw new Error('shape');
    const bytes = fromBase64(value);
    if (bytes.length < 1 || toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_TRANSPORT_BYTES_INVALID', `${label} must be non-empty canonical Base64.`, 'VALIDATION');
  }
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value) {
  const walk = (entry) => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number' && Number.isFinite(entry)) return Object.is(entry, -0) ? 0 : entry;
    if (Array.isArray(entry)) return entry.map(walk);
    if (!plain(entry)) fail('MAKER_V8_TRANSPORT_JSON_INVALID', 'Publication transport evidence must be plain JSON.', 'VALIDATION');
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, walk(entry[key])]));
  };
  return JSON.stringify(walk(value));
}

function owner(value) {
  const checked = typeof value === 'string' ? value.toLowerCase() : '';
  if (!EXACT_ID.test(checked) || /^0x0+$/.test(checked)) {
    fail('MAKER_V8_TRANSPORT_OWNER_INVALID', 'Publication owner must be one canonical non-zero Sui address.', 'VALIDATION');
  }
  return checked;
}

function preparedInput(input) {
  exact(input, ['document', 'signerAddress', 'attemptNonce', 'assets'], 'publication transport input');
  assertMakerV8Document(input.document, { mode: 'compile' });
  const signerAddress = owner(input.signerAddress);
  if (typeof input.attemptNonce !== 'string' || !input.attemptNonce
    || encoder.encode(input.attemptNonce).length > 192 || !Array.isArray(input.assets)) {
    fail('MAKER_V8_TRANSPORT_INPUT_INVALID', 'Publication attempt nonce or asset set is invalid.', 'VALIDATION');
  }
  const publicDocument = projectPublicMakerV8Document(input.document);
  const descriptors = new Map(publicDocument.assets.map((asset) => [asset.id, asset]));
  const protectedAssets = new Map();
  const usageByAsset = new Map();
  for (const part of publicDocument.parts) for (const item of part.items) for (const style of item.styles) {
    const usage = usageByAsset.get(style.assetId) ?? [];
    usage.push(style.protected === true);
    usageByAsset.set(style.assetId, usage);
    if (style.protected !== true) continue;
    if (protectedAssets.has(style.assetId)) {
      fail(
        'MAKER_V8_TRANSPORT_PROTECTED_ASSET_AMBIGUOUS',
        `Protected asset ${style.assetId} is shared by multiple public Styles.`,
        'VALIDATION',
      );
    }
    protectedAssets.set(style.assetId, freeze({
      partKey: part.key,
      itemKey: item.key,
      styleKey: style.key,
    }));
  }
  for (const [assetId, usages] of usageByAsset) {
    if (usages.some(Boolean) && (usages.length !== 1 || usages[0] !== true)) {
      fail(
        'MAKER_V8_TRANSPORT_PROTECTED_ASSET_AMBIGUOUS',
        `Protected asset ${assetId} must belong to exactly one public protected Style.`,
        'VALIDATION',
      );
    }
  }
  const seen = new Set();
  const assets = input.assets.filter((asset) => descriptors.has(asset?.assetId)).map((asset, index) => {
    exact(asset, ['assetId', 'kind', 'mediaType', 'bytesBase64'], `publication asset[${index}]`);
    const bytes = canonicalBase64(asset.bytesBase64, `publication asset ${String(asset.assetId)}`);
    const descriptor = descriptors.get(asset.assetId);
    if (!SAFE_KEY.test(String(asset.assetId ?? '')) || seen.has(asset.assetId)
      || !descriptor || descriptor.kind !== asset.kind || descriptor.mediaType !== asset.mediaType
      || descriptor.byteLength !== bytes.length) {
      fail(
        'MAKER_V8_TRANSPORT_ASSET_DRIFT',
        `Publication asset ${String(asset.assetId)} differs from the exact document descriptor.`,
        'VALIDATION',
      );
    }
    seen.add(asset.assetId);
    const sha256Value = hashBytes(bytes);
    return freeze({
      assetId: asset.assetId,
      kind: asset.kind,
      mediaType: asset.mediaType,
      bytesBase64: asset.bytesBase64,
      byteLength: bytes.length,
      sha256: sha256Value,
      protected: protectedAssets.has(asset.assetId),
      semantic: protectedAssets.get(asset.assetId) ?? null,
      uploadId: protectedAssets.has(asset.assetId) ? null : makerV8WalrusUploadIdV8({
          owner: signerAddress,
          purpose: `asset-${hashBytes(encoder.encode(asset.assetId)).slice(0, 24)}`,
          contentSha256: sha256Value,
        }),
    });
  }).sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
  if (assets.length !== descriptors.size || [...descriptors.keys()].some((assetId) => !seen.has(assetId))) {
    fail('MAKER_V8_TRANSPORT_ASSET_SET_INCOMPLETE', 'Publication requires exact bytes for every Maker asset.', 'VALIDATION');
  }
  return freeze({
    document: bindMakerV8SourceAssets(input.document, assets),
    signerAddress,
    attemptNonce: input.attemptNonce,
    assets,
  });
}

function stageView(kind, upload, details = {}) {
  const label = kind === 'ASSET' ? 'asset' : kind === 'LIVING_CONTENT' ? 'Soul documents' : 'Manifest';
  const signatureRequired = upload.status === 'SIGNATURE_REQUIRED';
  const recoveryRequired = upload.status === 'RECOVERY_REQUIRED';
  if (!signatureRequired && !recoveryRequired && upload.status !== 'FAILED') {
    fail('MAKER_V8_TRANSPORT_UPLOAD_STATE_INVALID', 'Walrus upload has an unsupported durable state.');
  }
  return freeze({
    schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA,
    status: upload.status === 'FAILED'
      ? 'FAILED' : signatureRequired ? 'TRANSPORT_SIGNATURE_REQUIRED' : 'TRANSPORT_RECOVERY_REQUIRED',
    stage: kind,
    upload,
    plan: null,
    ...details,
    message: upload.status === 'FAILED'
      ? 'Walrus transport failed and requires review.'
      : signatureRequired
        ? `Review and sign the exact ${label} Walrus transaction.`
        : `Query and recover the existing ${label} Walrus transaction.`,
  });
}

/**
 * Coordinates certified Soul documents -> assets -> canonical Manifest -> deterministic Maker
 * publication. The durable state remains in the per-blob Walrus WAL and the
 * publication WAL, so a reload rebuilds this view without a compatibility DB.
 */
export function createMakerV8PublicationTransportV8({
  publisher,
  compiler,
  publication,
  protector = null,
} = {}) {
  for (const method of ['prepare', 'requestSignature', 'resume', 'load']) {
    requireMethod(publisher, method, 'publisher');
  }
  requireMethod(compiler, 'prepareTransportManifest', 'compiler');
  requireMethod(publication, 'prepare', 'publication');

  const requireProtection = () => {
    requireMethod(publisher, 'loadContent', 'publisher');
    requireMethod(compiler, 'prepareProtectedAssetIdentities', 'compiler');
    requireMethod(protector, 'protectAsset', 'protector');
  };

  const ensureUpload = async ({ uploadId, owner: checkedOwner, mediaType, bytesBase64 }) => {
    let view = await publisher.load(uploadId);
    if (!view) {
      try {
        view = await publisher.prepare({ uploadId, owner: checkedOwner, mediaType, bytesBase64, epochs: 3 });
      } catch (error) {
        if (error?.code !== 'MAKER_V8_WALRUS_UPLOAD_EXISTS'
          || mediaType === MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE) throw error;
        view = await publisher.load(uploadId);
      }
    }
    // Protected encryption is randomized. Its semantic upload ID selects the
    // durable winner; protectedUpload reads and validates that winner's bytes
    // immediately below instead of comparing them to a losing local encryption.
    if (!view || view.uploadId !== uploadId
      || (mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE
        && view.byteSha256 !== hashBytes(canonicalBase64(bytesBase64, 'upload bytes')))) {
      fail('MAKER_V8_TRANSPORT_UPLOAD_DRIFT', 'Durable Walrus upload does not match the exact requested bytes.', 'PERSISTENCE');
    }
    return view;
  };

  const protectedUpload = async ({ checked, asset, identity }) => {
    const contentCommitment = hashBytes(encoder.encode(canonical({
      schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA,
      identity,
      plaintextSha256: asset.sha256,
    })));
    const uploadId = makerV8WalrusUploadIdV8({
      owner: checked.signerAddress,
      purpose: `protected-${hashBytes(encoder.encode(asset.assetId)).slice(0, 24)}`,
      contentSha256: contentCommitment,
    });
    let content = await publisher.loadContent(uploadId);
    if (!content) {
      const protectedAsset = assertMakerV8ProtectedAssetV8(await protector.protectAsset({
        schemaVersion: MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA,
        identity,
        asset: {
          mediaType: asset.mediaType,
          bytesBase64: asset.bytesBase64,
          byteLength: asset.byteLength,
          sha256: asset.sha256,
        },
      }), identity);
      try {
        await ensureUpload({
          uploadId,
          owner: checked.signerAddress,
          mediaType: protectedAsset.mediaType,
          bytesBase64: protectedAsset.bytesBase64,
        });
      } catch (error) {
        // Two tabs may encrypt the same semantic asset concurrently. The
        // strict Walrus create CAS chooses one durable ciphertext; the loser
        // must adopt that exact record instead of retaining its random Seal
        // output.
        if (error?.code !== 'MAKER_V8_WALRUS_UPLOAD_EXISTS') throw error;
      }
      content = await publisher.loadContent(uploadId);
    }
    if (!content || content.uploadId !== uploadId
      || content.owner !== checked.signerAddress
      || content.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE
      || typeof content.bytesBase64 !== 'string'
      || content.byteLength < 1
      || content.byteSha256 !== hashBytes(canonicalBase64(
        content.bytesBase64,
        `durable protected asset ${asset.assetId}`,
      ))) {
      fail(
        'MAKER_V8_TRANSPORT_PROTECTED_ASSET_DRIFT',
        `Durable protected asset ${asset.assetId} is missing or differs from its exact ciphertext.`,
        'PERSISTENCE',
      );
    }
    const upload = await publisher.load(uploadId);
    if (!upload || upload.uploadId !== uploadId || upload.byteSha256 !== content.byteSha256) {
      fail('MAKER_V8_TRANSPORT_PROTECTED_ASSET_DRIFT', 'Durable protected Walrus upload is missing.', 'PERSISTENCE');
    }
    return freeze({ upload, content });
  };

  const inspect = async (input, operation = 'INSPECT') => {
    const checked = preparedInput(input);
    const protectedAssets = checked.assets.filter((asset) => asset.protected);
    if (protectedAssets.length) requireProtection();
    const living = await compileMakerV8LivingContentV8(checked.document);
    const livingBytesBase64 = toBase64(Uint8Array.from(living.bytes));
    const livingUploadId = makerV8WalrusUploadIdV8({
      owner: checked.signerAddress, purpose: 'living-content', contentSha256: living.sha256,
    });
    let livingUpload = await ensureUpload({
      uploadId: livingUploadId, owner: checked.signerAddress,
      mediaType: 'application/vnd.animacraft.living-content-bundle+bcs', bytesBase64: livingBytesBase64,
    });
    if (livingUpload.status !== 'COMPLETE') {
      if (operation === 'SIGN' && livingUpload.status === 'SIGNATURE_REQUIRED') {
        livingUpload = await publisher.requestSignature(livingUploadId);
      } else if (operation === 'RECOVER' && livingUpload.status === 'RECOVERY_REQUIRED') {
        livingUpload = await publisher.resume(livingUploadId);
      }
      if (livingUpload.status !== 'COMPLETE') return stageView('LIVING_CONTENT', livingUpload, { assetId: null, completedAssets: 0 });
    }
    if (livingUpload.uploadId !== livingUploadId || livingUpload.byteSha256 !== living.sha256
      || typeof livingUpload.blobId !== 'string' || !livingUpload.blobId
      || typeof livingUpload.blobObjectId !== 'string' || !/^0x[0-9a-f]{64}$/.test(livingUpload.blobObjectId)
      || /^0x0+$/.test(livingUpload.blobObjectId)) {
      fail('MAKER_V8_TRANSPORT_UPLOAD_DRIFT', 'Certified Soul document upload differs from its actual bundle.', 'PERSISTENCE');
    }
    const livingContentTransport = freeze({ blobId: livingUpload.blobId, blobObjectId: livingUpload.blobObjectId, bytesBase64: livingBytesBase64 });
    let protectedIdentities = new Map();
    if (protectedAssets.length) {
      requireProtection();
      const prepared = await compiler.prepareProtectedAssetIdentities({
        document: structuredClone(checked.document),
        signerAddress: checked.signerAddress,
        livingContentTransport,
        assetTransports: checked.assets.map((asset) => ({
          assetId: asset.assetId,
          blobId: `walrus-asset-preview-${hashBytes(encoder.encode(asset.assetId)).slice(0, 24)}`,
          mediaType: asset.mediaType,
          bytesBase64: asset.bytesBase64,
        })),
        manifestBlobIdPlaceholder: 'walrus-manifest-preview',
      });
      if (!Array.isArray(prepared?.assets)
        || prepared.assets.length !== protectedAssets.length) {
        fail(
          'MAKER_V8_TRANSPORT_PROTECTED_IDENTITY_DRIFT',
          'Compiler did not return every protected publication asset identity.',
          'COMPILER',
        );
      }
      protectedIdentities = new Map(prepared.assets.map((entry) => [entry.assetId, entry.identity]));
      if (protectedAssets.some((asset) => !protectedIdentities.has(asset.assetId))) {
        fail(
          'MAKER_V8_TRANSPORT_PROTECTED_IDENTITY_DRIFT',
          'Compiler protected asset identities differ from the public document.',
          'COMPILER',
        );
      }
    }
    const assetTransports = [];
    for (const asset of checked.assets) {
      let content = {
        mediaType: asset.mediaType,
        bytesBase64: asset.bytesBase64,
      };
      let upload;
      if (asset.protected) {
        const durable = await protectedUpload({
          checked,
          asset,
          identity: protectedIdentities.get(asset.assetId),
        });
        upload = durable.upload;
        content = durable.content;
      } else {
        upload = await ensureUpload({
          uploadId: asset.uploadId,
          owner: checked.signerAddress,
          mediaType: asset.mediaType,
          bytesBase64: asset.bytesBase64,
        });
      }
      if (upload.status !== 'COMPLETE') {
        if (operation === 'SIGN' && upload.status === 'SIGNATURE_REQUIRED') {
          upload = await publisher.requestSignature(upload.uploadId);
        } else if (operation === 'RECOVER' && upload.status === 'RECOVERY_REQUIRED') {
          upload = await publisher.resume(upload.uploadId);
        }
        if (upload.status !== 'COMPLETE') {
          return stageView('ASSET', upload, { assetId: asset.assetId, completedAssets: assetTransports.length });
        }
      }
      assetTransports.push(freeze({
        assetId: asset.assetId,
        blobId: upload.blobId,
        mediaType: content.mediaType,
        bytesBase64: content.bytesBase64,
      }));
    }

    const preparedManifest = await compiler.prepareTransportManifest({
      document: structuredClone(checked.document),
      signerAddress: checked.signerAddress,
      livingContentTransport,
      assetTransports: structuredClone(assetTransports),
      manifestBlobIdPlaceholder: 'walrus-manifest-preview',
    });
    const manifestUploadId = makerV8WalrusUploadIdV8({
      owner: checked.signerAddress,
      purpose: 'manifest',
      contentSha256: preparedManifest.manifest.sha256,
    });
    let manifestUpload = await ensureUpload({
      uploadId: manifestUploadId,
      owner: checked.signerAddress,
      mediaType: 'application/json',
      bytesBase64: preparedManifest.manifest.bytesBase64,
    });
    if (manifestUpload.status !== 'COMPLETE') {
      if (operation === 'SIGN' && manifestUpload.status === 'SIGNATURE_REQUIRED') {
        manifestUpload = await publisher.requestSignature(manifestUpload.uploadId);
      } else if (operation === 'RECOVER' && manifestUpload.status === 'RECOVERY_REQUIRED') {
        manifestUpload = await publisher.resume(manifestUpload.uploadId);
      }
      if (manifestUpload.status !== 'COMPLETE') {
        return stageView('MANIFEST', manifestUpload, {
          assetId: null,
          completedAssets: assetTransports.length,
        });
      }
    }

    const plan = await publication.prepare({
      document: structuredClone(checked.document),
      transport: {
        livingContent: livingContentTransport,
        manifest: {
          blobId: manifestUpload.blobId,
          bytesBase64: preparedManifest.manifest.bytesBase64,
        },
        assets: assetTransports,
      },
      signerAddress: checked.signerAddress,
      attemptNonce: checked.attemptNonce,
    });
    return freeze({
      schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA,
      status: 'PUBLICATION_READY',
      stage: 'PUBLICATION',
      upload: manifestUpload,
      assetId: null,
      completedAssets: assetTransports.length,
      plan,
      message: 'All Walrus bytes are certified and the exact Maker v8 publication plan is durable.',
    });
  };

  return freeze({
    schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA,
    prepare: (input) => inspect(input, 'INSPECT'),
    requestSignature: (input) => inspect(input, 'SIGN'),
    recover: (input) => inspect(input, 'RECOVER'),
  });
}
