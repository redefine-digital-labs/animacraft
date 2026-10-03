import { fromBase64, toBase64 } from '@mysten/sui/utils';

export const MAKER_V8_CATALOG_ADAPTER_SCHEMA = 'animacraft.maker-v8-catalog-adapter.v1';
export const MAKER_V8_PLAZA_VIEW_SCHEMA = 'animacraft.maker-v8-plaza-view.v1';
export const MAKER_V8_PLAYER_VIEW_SCHEMA = 'animacraft.maker-v8-player-view.v1';
export const MAKER_V8_LINEAGE_VIEW_SCHEMA = 'animacraft.maker-v8-lineage-view.v1';
export const MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA = 'animacraft.maker-v8-catalog-diagnostic.v1';

const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fail(code, message, layer = 'CATALOG', details = {}) {
  throw new MakerV8CatalogError(code, message, layer, details);
}

export class MakerV8CatalogError extends Error {
  constructor(code, message, layer = 'CATALOG', details = {}) {
    super(message);
    this.name = 'MakerV8CatalogError';
    this.code = code;
    this.layer = layer;
    this.details = freeze({ ...details });
  }
}

function id(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!EXACT_ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('MAKER_V8_CATALOG_ID_INVALID', `${label} must be an exact non-zero Sui ID.`, 'VALIDATION');
  }
  return normalized;
}

function boundedText(value, label, maximum = 512) {
  if (typeof value !== 'string' || !value.length || encoder.encode(value).length > maximum) {
    fail('MAKER_V8_CATALOG_TEXT_INVALID', `${label} must be non-empty bounded text.`, 'ROOT');
  }
  return value;
}

function bytesHash(value, label) {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = [...value];
    if (bytes.length === 32
      && bytes.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      return bytes.map((entry) => entry.toString(16).padStart(2, '0')).join('');
    }
  }
  if (typeof value === 'string' && HASH.test(value)) return value;
  if (typeof value === 'string') {
    try {
      const bytes = fromBase64(value);
      if (bytes.length === 32 && toBase64(bytes) === value) {
        return [...bytes].map((entry) => entry.toString(16).padStart(2, '0')).join('');
      }
    } catch {
      // Fail below with one stable diagnostic.
    }
  }
  fail('MAKER_V8_CATALOG_HASH_INVALID', `${label} must contain exactly 32 bytes.`, 'ROOT');
}

function rootManifestPointer(root) {
  if (!plain(root?.content)) {
    fail('MAKER_V8_ROOT_FIELDS_INVALID', 'Activated Root has no certified content record.', 'ROOT');
  }
  const blobId = boundedText(root.content.manifestBlobId, 'root.content.manifestBlobId');
  const sha256 = bytesHash(root.content.manifestSha256, 'root.content.manifestSha256');
  const contentCommitment = bytesHash(root.contentCommitment, 'root.contentCommitment');
  if (sha256 !== contentCommitment) {
    fail(
      'MAKER_V8_ROOT_MANIFEST_COMMITMENT_MISMATCH',
      'Activated Root Manifest SHA-256 differs from its content commitment.',
      'ROOT',
      { sha256, contentCommitment },
    );
  }
  return freeze({ blobId, sha256 });
}

function diagnostic(cause, context = {}) {
  const code = typeof cause?.code === 'string'
    ? cause.code : 'MAKER_V8_CATALOG_READ_FAILED';
  const message = typeof cause?.message === 'string' && cause.message
    ? cause.message : 'Maker v8 product data could not be read.';
  const layer = typeof cause?.layer === 'string' && cause.layer
    ? cause.layer.toUpperCase() : 'CATALOG';
  return freeze({
    schemaVersion: MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA,
    severity: context.severity ?? 'ERROR',
    layer,
    code,
    message,
    rootId: context.rootId ?? null,
    makerKey: context.makerKey ?? null,
    details: freeze({ ...(plain(cause?.details) ? cause.details : {}) }),
  });
}

function inactiveDiagnostic(root) {
  return freeze({
    schemaVersion: MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA,
    severity: 'INFO',
    layer: 'ROOT',
    code: 'MAKER_V8_ROOT_NOT_ACTIVE',
    message: `Maker Root is ${String(root.lifecycle || 'UNKNOWN')} and is not public in Plaza.`,
    rootId: root.objectId,
    makerKey: root.makerKey,
    details: freeze({ lifecycle: root.lifecycle ?? null }),
  });
}

function manifestAsset(manifest, assetId) {
  if (assetId === null) return null;
  const asset = manifest.certifiedAssets.find((entry) => entry.assetId === assetId);
  if (!asset) {
    fail(
      'MAKER_V8_CATALOG_COVER_ASSET_MISSING',
      'Manifest coverAssetId has no exact certified asset.',
      'MANIFEST',
      { assetId },
    );
  }
  return freeze({ ...asset });
}

function assertManifestBindsRoot(root, manifestRead) {
  const manifest = manifestRead?.manifest;
  if (!plain(manifest) || !plain(manifest.document)) {
    fail('MAKER_V8_CATALOG_MANIFEST_READ_INVALID', 'Manifest adapter returned an invalid read envelope.', 'MANIFEST');
  }
  if (manifestRead.sha256 !== rootManifestPointer(root).sha256) {
    fail(
      'MAKER_V8_CATALOG_MANIFEST_READBACK_MISMATCH',
      'Manifest adapter returned bytes for another Root commitment.',
      'MANIFEST',
    );
  }
  const document = manifest.document;
  if (document.lineage?.makerKey !== root.makerKey
    || BigInt(document.lineage?.version ?? -1) !== BigInt(root.makerVersion)) {
    fail(
      'MAKER_V8_CATALOG_MANIFEST_LINEAGE_MISMATCH',
      'Manifest document lineage differs from the exact activated Root.',
      'MANIFEST',
      {
        rootMakerKey: root.makerKey,
        rootMakerVersion: String(root.makerVersion),
        manifestMakerKey: document.lineage?.makerKey ?? null,
        manifestMakerVersion: document.lineage?.version ?? null,
      },
    );
  }
  return manifest;
}

function rootEvidence(activation, root, manifestRead) {
  return freeze({
    activationEventType: activation.type,
    activationTransactionDigest: activation.transactionDigest ?? null,
    rootId: root.objectId,
    rootVersion: String(root.version),
    rootDigest: root.digest,
    makerVersion: String(root.makerVersion),
    lifecycle: root.lifecycle,
    contentCommitment: root.contentCommitment,
    rendererCommitment: bytesHash(root.rendererCommitment, 'root.rendererCommitment'),
    manifestBlobId: manifestRead.blobId,
    manifestSha256: manifestRead.sha256,
    manifestByteLength: manifestRead.byteLength,
  });
}

function plazaCard(activation, root, manifestRead) {
  const manifest = assertManifestBindsRoot(root, manifestRead);
  const document = manifest.document;
  return freeze({
    schemaVersion: MAKER_V8_PLAZA_VIEW_SCHEMA,
    id: root.objectId,
    rootId: root.objectId,
    makerKey: root.makerKey,
    makerVersion: String(root.makerVersion),
    title: document.metadata.name,
    summary: document.metadata.summary,
    creatorName: document.metadata.creator ?? '',
    style: document.metadata.style ?? '',
    creatorAddress: root.creatorAddress,
    ownerAddress: root.ownerAddress,
    lifecycle: 'ACTIVE',
    coverAsset: manifestAsset(manifest, document.metadata.coverAssetId),
    canvas: freeze({ ...document.canvas }),
    compositionMode: document.composition.mode,
    counts: freeze({
      parts: document.parts.length,
      assets: document.assets.length,
      outputs: document.outputs.length,
    }),
    evidence: rootEvidence(activation, root, manifestRead),
  });
}

function playerView(activation, root, manifestRead) {
  const manifest = assertManifestBindsRoot(root, manifestRead);
  const document = manifest.document;
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_VIEW_SCHEMA,
    id: root.objectId,
    rootId: root.objectId,
    makerKey: root.makerKey,
    makerVersion: String(root.makerVersion),
    title: document.metadata.name,
    summary: document.metadata.summary,
    creatorName: document.metadata.creator ?? '',
    style: document.metadata.style ?? '',
    creatorAddress: root.creatorAddress,
    ownerAddress: root.ownerAddress,
    lifecycle: 'ACTIVE',
    coverAsset: manifestAsset(manifest, document.metadata.coverAssetId),
    document,
    certifiedAssets: manifest.certifiedAssets,
    composableBinding: freeze({ definitionRegistryId: root.binding?.runtimeDefinitionRegistryId,
      baseRegistryId: root.binding?.baseRegistryId, packRegistryId: root.binding?.packRegistryId,
      admissionAuthorityId: root.binding?.packAdmissionAuthorityId }),
    evidence: rootEvidence(activation, root, manifestRead),
  });
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_CATALOG_ADAPTER_INVALID', `${label}.${method} is required.`, 'CONFIGURATION');
  }
}

function resultStatus(items, diagnostics) {
  const errors = diagnostics.filter((entry) => entry.severity === 'ERROR').length;
  if (errors && items.length) return 'DEGRADED';
  if (errors) return 'ERROR';
  if (!items.length) return 'EMPTY';
  return 'READY';
}

export function createMakerV8CatalogAdapter({ chain, manifests } = {}) {
  requireMethod(chain, 'discover', 'chain');
  requireMethod(chain, 'loadContext', 'chain');
  requireMethod(manifests, 'load', 'manifests');

  async function readActivation(activation, { requireActive = false } = {}) {
    const rootId = id(activation?.binding?.rootId, 'activation.binding.rootId');
    const context = await chain.loadContext(activation);
    const root = context?.root;
    if (!root || id(root.objectId, 'root.objectId') !== rootId) {
      fail('MAKER_V8_CATALOG_ROOT_MISMATCH', 'Chain adapter returned another Maker Root.', 'ROOT', { rootId });
    }
    if (root.lifecycle !== 'ACTIVE') {
      if (requireActive) {
        fail(
          'MAKER_V8_ROOT_NOT_ACTIVE',
          `Maker Root is ${String(root.lifecycle || 'UNKNOWN')}, not ACTIVE.`,
          'ROOT',
          { rootId, lifecycle: root.lifecycle ?? null },
        );
      }
      return freeze({ activation, root, manifestRead: null });
    }
    const pointer = rootManifestPointer(root);
    const manifestRead = await manifests.load(pointer);
    assertManifestBindsRoot(root, manifestRead);
    return freeze({ activation, root, manifestRead });
  }

  async function discover() {
    const activations = await chain.discover();
    if (!Array.isArray(activations)) {
      fail('MAKER_V8_CATALOG_ACTIVATIONS_INVALID', 'Chain discovery did not return an Activation array.', 'DISCOVERY');
    }
    return activations;
  }

  return freeze({
    schemaVersion: MAKER_V8_CATALOG_ADAPTER_SCHEMA,

    async loadLineage({ makerKey } = {}) {
      const checkedMakerKey = boundedText(makerKey, 'lineage.makerKey', 128);
      const activations = (await discover()).filter((activation) => activation?.makerKey === checkedMakerKey);
      const versions = [];
      const rootIds = new Set();
      const makerVersions = new Set();
      for (const activation of activations) {
        const rootId = id(activation?.binding?.rootId, 'activation.binding.rootId');
        if (rootIds.has(rootId)) {
          fail('MAKER_V8_LINEAGE_ROOT_DUPLICATE', 'Maker lineage contains a duplicate Root activation.', 'DISCOVERY', { rootId });
        }
        rootIds.add(rootId);
        const context = await chain.loadContext(activation);
        const root = context?.root;
        if (!root || id(root.objectId, 'root.objectId') !== rootId
          || root.makerKey !== checkedMakerKey
          || !['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(root.lifecycle)) {
          fail('MAKER_V8_LINEAGE_ROOT_INVALID', 'Maker lineage returned another or ineligible Root.', 'ROOT', { rootId });
        }
        const version = Number(root.makerVersion);
        if (!Number.isSafeInteger(version) || version < 1 || makerVersions.has(version)) {
          fail('MAKER_V8_LINEAGE_VERSION_INVALID', 'Maker lineage versions must be unique positive safe integers.', 'ROOT', { rootId });
        }
        makerVersions.add(version);
        const manifestRead = await manifests.load(rootManifestPointer(root));
        const manifest = assertManifestBindsRoot(root, manifestRead);
        versions.push(freeze({
          schemaVersion: MAKER_V8_LINEAGE_VIEW_SCHEMA,
          rootId,
          makerKey: checkedMakerKey,
          makerVersion: version,
          versionCommitment: root.versionCommitment,
          previousRootId: root.previousRootId,
          previousVersionCommitment: root.previousVersionCommitment,
          successorRootId: root.successorRootId,
          lifecycle: root.lifecycle,
          ownerAddress: root.ownerAddress,
          document: manifest.document,
          evidence: rootEvidence(activation, root, manifestRead),
        }));
      }
      versions.sort((left, right) => right.makerVersion - left.makerVersion);
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        if (version.makerVersion === 1) {
          if (version.previousRootId !== null || version.previousVersionCommitment !== null) {
            fail('MAKER_V8_LINEAGE_LINK_INVALID', 'Maker version 1 cannot have a predecessor.', 'ROOT');
          }
          continue;
        }
        const previous = versions.find((entry) => entry.makerVersion === version.makerVersion - 1);
        if (!previous || version.previousRootId !== previous.rootId
          || version.previousVersionCommitment !== previous.versionCommitment
          || previous.successorRootId !== version.rootId) {
          fail('MAKER_V8_LINEAGE_LINK_INVALID', 'Maker lineage is not one exact predecessor/successor chain.', 'ROOT', { rootId: version.rootId });
        }
      }
      return freeze(versions);
    },

    async loadPlaza() {
      let activations;
      try {
        activations = await discover();
      } catch (cause) {
        const diagnostics = freeze([diagnostic(cause)]);
        return freeze({
          schemaVersion: MAKER_V8_PLAZA_VIEW_SCHEMA,
          status: 'ERROR',
          makers: freeze([]),
          diagnostics,
          stats: freeze({ observedActivationCount: 0, activeMakerCount: 0, inactiveRootCount: 0, errorCount: 1 }),
        });
      }

      const diagnostics = [];
      const unique = [];
      const rootIds = new Set();
      for (const activation of activations) {
        let rootId = null;
        try {
          rootId = id(activation?.binding?.rootId, 'activation.binding.rootId');
          if (rootIds.has(rootId)) {
            fail(
              'MAKER_V8_ACTIVATION_DUPLICATE',
              'Discovery returned more than one Activation for the same Root.',
              'DISCOVERY',
              { rootId },
            );
          }
          rootIds.add(rootId);
          unique.push(activation);
        } catch (cause) {
          diagnostics.push(diagnostic(cause, { rootId }));
        }
      }

      const outcomes = await Promise.all(unique.map(async (activation) => {
        const context = {
          rootId: activation?.binding?.rootId ?? null,
          makerKey: activation?.makerKey ?? null,
        };
        try {
          return { read: await readActivation(activation), error: null, context };
        } catch (cause) {
          return { read: null, error: cause, context };
        }
      }));

      const makers = [];
      let inactiveRootCount = 0;
      for (const outcome of outcomes) {
        if (outcome.error) {
          diagnostics.push(diagnostic(outcome.error, outcome.context));
          continue;
        }
        const { read } = outcome;
        if (!read) continue;
        if (read.root.lifecycle !== 'ACTIVE') {
          inactiveRootCount += 1;
          diagnostics.push(inactiveDiagnostic(read.root));
          continue;
        }
        try {
          makers.push(plazaCard(read.activation, read.root, read.manifestRead));
        } catch (cause) {
          diagnostics.push(diagnostic(cause, {
            rootId: read.root.objectId,
            makerKey: read.root.makerKey,
          }));
        }
      }
      const frozenDiagnostics = freeze(diagnostics);
      const frozenMakers = freeze(makers);
      const errorCount = diagnostics.filter((entry) => entry.severity === 'ERROR').length;
      return freeze({
        schemaVersion: MAKER_V8_PLAZA_VIEW_SCHEMA,
        status: resultStatus(frozenMakers, frozenDiagnostics, activations.length),
        makers: frozenMakers,
        diagnostics: frozenDiagnostics,
        stats: freeze({
          observedActivationCount: activations.length,
          activeMakerCount: makers.length,
          inactiveRootCount,
          errorCount,
        }),
      });
    },

    async loadPlayer(rootIdInput) {
      let rootId = null;
      try {
        rootId = id(rootIdInput, 'rootId');
        const activations = await discover();
        const matches = activations.filter((entry) => (
          typeof entry?.binding?.rootId === 'string'
          && entry.binding.rootId.toLowerCase() === rootId
        ));
        if (matches.length !== 1) {
          fail(
            matches.length === 0
              ? 'MAKER_V8_ACTIVATION_NOT_FOUND' : 'MAKER_V8_ACTIVATION_DUPLICATE',
            matches.length === 0
              ? 'No exact MakerV8Activated event binds this Root.'
              : 'More than one Activation binds this Root.',
            'DISCOVERY',
            { rootId, matches: matches.length },
          );
        }
        const read = await readActivation(matches[0], { requireActive: true });
        const player = playerView(read.activation, read.root, read.manifestRead);
        return freeze({
          schemaVersion: MAKER_V8_PLAYER_VIEW_SCHEMA,
          status: 'READY',
          player,
          diagnostics: freeze([]),
        });
      } catch (cause) {
        return freeze({
          schemaVersion: MAKER_V8_PLAYER_VIEW_SCHEMA,
          status: 'ERROR',
          player: null,
          diagnostics: freeze([diagnostic(cause, { rootId })]),
        });
      }
    },
  });
}
