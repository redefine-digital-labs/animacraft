import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { validatedDraftExportBundle } from './maker-v8-draft-store.js';
import { assertPackAuthoring, packAuthoringDocument, packAuthoringContent, packAuthoringParent, preparePackStructure, preparePackEdits } from './maker-v8-pack-authoring.js';
import { projectPublicMakerV8Document } from './maker-v8-document.js';
import { bindMakerV8SourceAssets } from './maker-v8-source-asset.js';

import {
  MAKER_V8_PACK_COMPILER_RESULT_SCHEMA,
  MAKER_V8_PACK_DOCUMENT_SCHEMA,
  MAKER_V8_PACK_DRAFT_SCHEMA,
  MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA,
  assertMakerV8PackDraftV8,
  canonicalMakerV8PackJson,
  createMakerV8PackControllerV8,
} from './maker-v8-pack-controller.js';
import { createMakerV8PackPersistenceV8 } from './maker-v8-pack-persistence.js';
import {
  createMakerV8PackAuthorityLoaderV8,
  createMakerV8PackCompilerV8,
  createMakerV8PackProtectionAuthorityLoaderV8,
} from './maker-v8-pack-compiler.js';
import {
  createMakerV8PackPublicationControllerV8,
  createMakerV8PackPublicationPersistenceV8,
} from './maker-v8-pack-publication.js';
import {
  createMakerV8PackPublicationBoundaryV8,
  createMakerV8PackReadbackV8,
} from './maker-v8-pack-publication-adapters.js';
import {
  MAKER_V8_PACK_TRANSPORT_SCHEMA,
  createMakerV8PackTransportV8,
} from './maker-v8-pack-transport.js';
import { createProductionMakerV8PackLifecycleV8 } from './maker-v8-pack-lifecycle.js';
import {
  attestMakerV8Runtime,
  createMakerV8ChainClient,
} from './maker-v8-chain.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';

export const MAKER_V8_PACK_ADAPTERS_SCHEMA = 'animacraft.maker-v8-pack-adapters.v1';
export const MAKER_V8_PACK_STUDIO_SCHEMA = 'animacraft.maker-v8-pack-studio.v1';

const EXACT_ID = /^0x[0-9a-f]{64}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MEDIA_TYPES = new Set(['image/png', 'image/webp']);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export class MakerV8PackAdaptersError extends Error {
  constructor(code, message, layer = 'PACK_ADAPTER', details = undefined) {
    super(message);
    this.name = 'MakerV8PackAdaptersError';
    this.code = code;
    this.layer = layer;
    if (details !== undefined) this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, layer, details) {
  throw new MakerV8PackAdaptersError(code, message, layer, details);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactId(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value)) {
    fail('MAKER_V8_PACK_ID_INVALID', `${label} must be one exact lowercase Sui ID.`, 'INPUT');
  }
  return value;
}

function safeKey(value, label) {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) {
    fail('MAKER_V8_PACK_KEY_INVALID', `${label} must be one safe Fresh-v8 semantic key.`, 'INPUT');
  }
  return value;
}

function exactAccount(value) {
  const address = typeof value === 'string' ? value : value?.address;
  return exactId(String(address || '').toLowerCase(), 'Connected wallet');
}

function canonicalAssetBytes(value) {
  try {
    if (typeof value !== 'string') throw new Error('shape');
    const bytes = fromBase64(value);
    if (bytes.length < 1 || bytes.length > MAX_ASSET_BYTES || toBase64(bytes) !== value) {
      throw new Error('canonical');
    }
    return bytes;
  } catch {
    fail('MAKER_V8_PACK_ASSET_BYTES_INVALID', 'Pack artwork must be canonical PNG/WebP Base64 up to 8 MiB.', 'ASSET');
  }
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle?.digest) {
    fail('MAKER_V8_PACK_CRYPTO_REQUIRED', 'Web Crypto SHA-256 is required.', 'ENVIRONMENT');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function blockedCompiler() {
  const authority = {};
  return Object.freeze({
    authority,
    async compilePack() {
      fail(
        'MAKER_V8_PACK_PUBLICATION_COMPILER_UNAVAILABLE',
        'Exact Pack publication is not enabled until the dedicated Runtime-v8 Pack compiler and readback certifier are connected.',
        'COMPILER',
      );
    },
  });
}

function blockedPublication() {
  const unavailable = () => {
    fail('MAKER_V8_PACK_PUBLICATION_UNAVAILABLE', 'Exact Pack publication is not connected.', 'PUBLICATION');
  };
  return Object.freeze({
    schemaVersion: MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA,
    prepare: unavailable,
    resume: unavailable,
    requestSignature: unavailable,
    recoverOutcome: unavailable,
    replayExact: unavailable,
  });
}

function draftTime(current, now) {
  const observed = Number(now());
  if (!Number.isSafeInteger(observed) || observed < 0) {
    fail('MAKER_V8_PACK_CLOCK_INVALID', 'Pack clock must be a non-negative safe integer.', 'ENVIRONMENT');
  }
  return Math.max(observed, Number(current?.updatedAt ?? -1) + 1);
}

function createDocument({ bindings, account, metadata, access, completion }) {
  return {
    schemaVersion: MAKER_V8_PACK_DOCUMENT_SCHEMA,
    protocolVersion: 8,
    metadata: {
      semanticPackId: safeKey(metadata.semanticPackId, 'semanticPackId'),
      name: String(metadata.name || '').trim(),
      summary: String(metadata.summary || '').trim(),
      coverAssetId: null,
    },
    author: { address: account, role: 'MAKER_OWNER' },
    admission: {
      makerApproval: 'REQUIRED',
      expectedPackRegistryRevision: bindings.packRegistry?.revision ?? null,
    },
    access: {
      kind: access?.kind ?? 'FREE',
      priceAtomic: String(access?.priceAtomic ?? '0'),
    },
    completion: {
      mode: completion?.mode ?? 'UNLIMITED_FREE',
      priceAtomic: String(completion?.priceAtomic ?? '0'),
      freeQuotaPerWallet: String(completion?.freeQuotaPerWallet ?? '0'),
      totalCap: String(completion?.totalCap ?? '0'),
    },
    styles: [],
    bindings,
  };
}

function updateDocument(current, fields = {}) {
  if (!plain(fields)) fail('MAKER_V8_PACK_FIELDS_INVALID', 'Pack edit fields must be one plain record.', 'INPUT');
  const document = structuredClone(current.document);
  if (fields.rootId && fields.rootId !== document.bindings.root?.objectRef.objectId) {
    fail('MAKER_V8_PACK_ROOT_IMMUTABLE', 'A Pack draft cannot silently change its Maker Root.', 'BINDING');
  }
  if (fields.semanticPackId !== undefined) document.metadata.semanticPackId = safeKey(fields.semanticPackId, 'semanticPackId');
  if (fields.name !== undefined) document.metadata.name = String(fields.name).trim();
  if (fields.summary !== undefined) document.metadata.summary = String(fields.summary).trim();
  if (fields.accessKind !== undefined) document.access.kind = String(fields.accessKind);
  if (fields.accessPriceAtomic !== undefined) document.access.priceAtomic = String(fields.accessPriceAtomic);
  if (fields.completeMode !== undefined) document.completion.mode = String(fields.completeMode);
  if (fields.completePriceAtomic !== undefined) document.completion.priceAtomic = String(fields.completePriceAtomic);
  if (fields.freeQuotaPerWallet !== undefined) document.completion.freeQuotaPerWallet = String(fields.freeQuotaPerWallet);
  if (fields.totalCap !== undefined) document.completion.totalCap = String(fields.totalCap);
  if (document.styles.length) {
    const style = document.styles[0];
    for (const field of ['partKey', 'itemKey', 'styleKey', 'layerTrackKey']) {
      if (fields[field] !== undefined) style[field] = safeKey(fields[field], field);
    }
  }
  return document;
}

export function createMakerV8PackStudioV8({
  chain,
  loadParent = null,
  wallet,
  persistence,
  compiler = null,
  publication = null,
  transport = null,
  lifecycle = null,
  execution = { allowWalletSignature: false, allowBroadcast: false },
  now = () => Date.now(),
} = {}) {
  for (const method of ['discover', 'loadContext', 'loadPackAuthoringContext']) {
    if (typeof chain?.[method] !== 'function') {
      fail('MAKER_V8_PACK_CHAIN_INVALID', `chain.${method} is required.`, 'CONFIGURATION');
    }
  }
  if (typeof wallet?.getCurrentAccount !== 'function') {
    fail('MAKER_V8_PACK_WALLET_INVALID', 'wallet.getCurrentAccount is required.', 'CONFIGURATION');
  }
  for (const method of ['create', 'load', 'list', 'compareAndSwap', 'loadAsset', 'listAssets', 'upsertAsset']) {
    if (typeof persistence?.[method] !== 'function') {
      fail('MAKER_V8_PACK_PERSISTENCE_INVALID', `persistence.${method} is required.`, 'CONFIGURATION');
    }
  }
  const controller = createMakerV8PackControllerV8({
    persistence,
    compiler: compiler ?? blockedCompiler(),
    publication: publication ?? blockedPublication(),
    lifecycle,
    execution,
    now,
    validateLocalParent: validatedDraftExportBundle,
    validateAuthoring: assertPackAuthoring,
    resolvePublishedParent: async ({ rootId, document }) => {
      if (typeof loadParent !== 'function') fail('MAKER_V8_PACK_PARENT_RESOLVER_REQUIRED', 'Certified Maker content reader is required.', 'CONFIGURATION');
      const { account, bindings } = await loadBindings(rootId);
      if (account !== document.author.address || bindings.root.objectRef.objectId !== rootId) {
        fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Connect the exact Pack author wallet.', 'CONTEXT');
      }
      const published = await loadParent({ rootId, rootVersion: bindings.root.makerVersion,
        rootContentCommitment: bindings.root.contentCommitment });
      const captured = packAuthoringParent(document);
      const projected = projectPublicMakerV8Document(captured.draft.document);
      const ids = new Set(projected.assets.map(asset => asset.id));
      const expected = { document: bindMakerV8SourceAssets(projected, captured.assets),
        assets: captured.assets.filter(asset => ids.has(asset.assetId)).map(asset => ({
          assetId: asset.assetId, kind: asset.kind, mediaType: asset.mediaType,
          byteLength: asset.byteLength, sha256: asset.sha256,
        })).sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0) };
      if (canonicalMakerV8PackJson(published) !== canonicalMakerV8PackJson(expected)) {
        fail('MAKER_V8_PACK_PARENT_CONTENT_MISMATCH', 'Published Maker differs from the Pack captured parent.', 'BINDING');
      }
      if (exactAccount(await wallet.getCurrentAccount()) !== account) fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Wallet changed during parent verification.', 'CONTEXT');
      return { bindings, authoring: packAuthoringDocument(document) };
    },
  });

  if (transport !== null) {
    if (transport.schemaVersion !== MAKER_V8_PACK_TRANSPORT_SCHEMA) {
      fail('MAKER_V8_PACK_TRANSPORT_INVALID', 'Pack Studio requires the exact Pack Walrus transport.', 'CONFIGURATION');
    }
    for (const method of ['prepare', 'requestSignature', 'recover']) {
      if (typeof transport?.[method] !== 'function') {
        fail('MAKER_V8_PACK_TRANSPORT_INVALID', `transport.${method} is required.`, 'CONFIGURATION');
      }
    }
  }

  const transportInput = async (draft) => {
    const account = exactAccount(await wallet.getCurrentAccount());
    if (draft.document.author.address !== account) {
      fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Connected wallet differs from the exact Pack author.', 'CONTEXT');
    }
    const activeAssetIds = new Set(draft.document.styles.map(style => style.asset.assetId));
    // Retained local artwork is not part of the current publication. Keep it
    // in storage; the transport still validates the exact active set and bytes.
    const assets = (await persistence.listAssets(draft.draftId)).filter(asset => activeAssetIds.has(asset.assetId));
    const [latest, currentAccount] = await Promise.all([
      controller.load(draft.draftId), wallet.getCurrentAccount(),
    ]);
    if (latest.revision !== draft.revision
      || canonicalMakerV8PackJson(latest) !== canonicalMakerV8PackJson(draft)) {
      fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed while reading publication assets. Reopen the current draft.', 'PERSISTENCE');
    }
    if (exactAccount(currentAccount) !== account) {
      fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Wallet changed while reading publication assets.', 'CONTEXT');
    }
    return { draft, assets, owner: account };
  };

  const continuePublication = async (input, operation) => {
    if (transport === null) return controller[operation === 'PREPARE'
      ? 'preparePublication' : operation === 'SIGN'
        ? 'requestPublicationSignature' : 'recoverPublicationOutcome'](input);
    const checkedInput = plain(input) ? input : {};
    const draft = await controller.load(checkedInput.draftId);
    if (draft.document.bindings.kind === 'LOCAL_DRAFT') {
      fail('MAKER_V8_PACK_PARENT_NOT_PUBLISHED', 'Bind the exact published parent release before publishing this Pack.', 'BINDING');
    }
    if (draft.publication.status !== 'UNPREPARED') {
      if (operation === 'PREPARE') return controller.preparePublication(checkedInput);
      if (operation === 'SIGN') return controller.requestPublicationSignature(checkedInput);
      return controller.recoverPublicationOutcome(checkedInput);
    }
    if (checkedInput.expectedRevision !== null && checkedInput.expectedRevision !== undefined
      && checkedInput.expectedRevision !== draft.revision) {
      fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed before transport recovery.', 'PERSISTENCE');
    }
    const view = await transport[operation === 'PREPARE'
      ? 'prepare' : operation === 'SIGN' ? 'requestSignature' : 'recover'](
      await transportInput(draft),
    );
    if (view.status !== 'PUBLICATION_TRANSPORT_READY') {
      return freeze({ draft, transport: view, plan: null, execution: controller.execution });
    }
    const preparedDocument = view.prepared?.document;
    const sameDocument = canonicalMakerV8PackJson(preparedDocument)
      === canonicalMakerV8PackJson(draft.document);
    const saved = sameDocument ? draft : await controller.save({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      document: preparedDocument,
      updatedAt: draftTime(draft, now),
    });
    const result = await controller.preparePublication({
      draftId: saved.draftId,
      expectedRevision: saved.revision,
      context: { transport: structuredClone(view.prepared) },
    });
    return freeze({ ...result, transport: view });
  };

  const loadBindings = async (rootId) => {
    const account = exactAccount(await wallet.getCurrentAccount());
    const activations = await chain.discover();
    const selected = activations.filter((entry) => entry?.binding?.rootId === rootId);
    if (selected.length !== 1) {
      fail('MAKER_V8_PACK_ROOT_NOT_FOUND', 'Selected Maker Root was not discovered exactly once on Mainnet.', 'READBACK');
    }
    const context = await chain.loadContext(selected[0]);
    const bindings = await chain.loadPackAuthoringContext(context.root, account);
    return { account, bindings };
  };

  const studio = {
    schemaVersion: MAKER_V8_PACK_STUDIO_SCHEMA,
    execution: controller.execution,
    subscribe: (listener) => controller.subscribe(listener),
    list: () => persistence.list(),
    load: (draftId) => controller.load(draftId),
    bindPublishedParent: input => controller.bindPublishedParent(input),
    async loadPreview(draftId) {
      const draft = await controller.load(draftId);
      const account = exactAccount(await wallet.getCurrentAccount());
      if (account !== draft.document.author.address || draft.document.bindings.kind !== 'LOCAL_DRAFT' && !draft.document.authoringParent) {
        fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Open a local Pack owned by this wallet.', 'CONTEXT');
      }
      const authoring = packAuthoringContent(draft.document);
      const document = authoring.content.document;
      const assets = [...packAuthoringParent(draft.document).assets];
      for (const row of draft.document.styles) {
        const asset = await persistence.loadAsset(draftId, row.asset.assetId);
        if (!asset || asset.sha256 !== row.asset.sha256 || asset.byteLength !== row.asset.byteLength
          || asset.mediaType !== row.asset.mediaType) {
          fail('MAKER_V8_PACK_PREVIEW_ASSET_MISMATCH', 'Saved Pack artwork does not match its Style.', 'ASSET');
        }
        assets.push({ assetId: asset.assetId, kind: 'layer', mediaType: asset.mediaType,
          byteLength: asset.byteLength, bytesBase64: asset.bytesBase64, sha256: asset.sha256 });
      }
      if ((await controller.load(draftId)).revision !== draft.revision
        || exactAccount(await wallet.getCurrentAccount()) !== account) {
        fail('STALE_PACK_PREVIEW', 'Pack or wallet changed while loading its preview.', 'CONTEXT');
      }
      return { draft, document, assets, authoring };
    },
    preview: (input) => controller.preview(input),
    export: (draftId) => controller.export(draftId),
    validate: (value, options) => controller.validate(value, options),
    preparePublication: (input) => continuePublication(input, 'PREPARE'),
    resumePublication: async (input) => {
      const draft = await controller.load(input?.draftId);
      return draft.publication.status === 'UNPREPARED' && transport !== null
        ? continuePublication(input, 'RECOVER')
        : controller.resumePublication(input);
    },
    requestPublicationSignature: (input) => continuePublication(input, 'SIGN'),
    recoverPublicationOutcome: (input) => continuePublication(input, 'RECOVER'),
    replayPackPublication: async (input) => {
      const draft = await controller.load(input?.draftId);
      return draft.publication.status === 'UNPREPARED' && transport !== null
        ? continuePublication(input, 'RECOVER')
        : controller.replayPackPublication(input);
    },
    performLifecycle: (input) => controller.performLifecycle(input),

    async createPackDraft({ draftId, rootId, parent, metadata = {}, access = {}, completion = {} } = {}) {
      if (parent !== undefined) {
        if (rootId !== undefined) fail('MAKER_V8_PACK_PARENT_AMBIGUOUS', 'Choose one local or published parent.', 'BINDING');
        const account = exactAccount(await wallet.getCurrentAccount());
        const parentSnapshot = structuredClone(parent);
        await validatedDraftExportBundle(parentSnapshot);
        if (exactAccount(await wallet.getCurrentAccount()) !== account) {
          fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Wallet changed while capturing the parent.', 'CONTEXT');
        }
        return controller.createPackDraft({ draftId,
          document: createDocument({ bindings: { kind: 'LOCAL_DRAFT', parent: parentSnapshot },
            account, metadata, access, completion }), createdAt: draftTime(null, now) });
      }
      const checkedRoot = exactId(String(rootId || '').toLowerCase(), 'rootId');
      const { account, bindings } = await loadBindings(checkedRoot);
      return controller.createPackDraft({
        draftId,
        document: createDocument({ bindings, account, metadata, access, completion }),
        createdAt: draftTime(null, now),
      });
    },

    async save({ draftId, expectedRevision, fields } = {}) {
      const current = await controller.load(draftId);
      let document = updateDocument(current, fields);
      if (fields?.edits !== undefined) document = preparePackEdits(document, fields.edits);
      let assetCopies = [];
      if (fields?.structure !== undefined) ({ document, assetCopies } = preparePackStructure(document, fields.structure));
      if (exactAccount(await wallet.getCurrentAccount()) !== current.document.author.address) {
        fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Connect the Pack author wallet before saving.', 'CONTEXT');
      }
      if (assetCopies.length) {
        if (current.revision !== expectedRevision) fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack changed before copying.', 'PERSISTENCE');
        if (current.publication.status !== 'UNPREPARED') fail('MAKER_V8_PACK_DRAFT_LOCKED', 'A publication attempt locks this Pack.', 'PUBLICATION');
        // The pure local structure helper preserves the exact authenticated parent.
        const next = assertMakerV8PackDraftV8({ ...structuredClone(current), document,
          revision: current.revision + 1, updatedAt: draftTime(current, now) });
        return persistence.copyAssets({ draftId, expectedRevision, next, copies: assetCopies });
      }
      return controller.save({
        draftId,
        expectedRevision,
        document,
        updatedAt: draftTime(current, now),
      });
    },

    async upsertAsset({ draftId, expectedRevision, style, asset } = {}) {
      const current = await controller.load(draftId);
      const assertAuthor = async () => {
        if (exactAccount(await wallet.getCurrentAccount()) !== current.document.author.address) {
          fail('MAKER_V8_PACK_ACCOUNT_DRIFT', 'Connect the Pack author wallet before saving artwork.', 'CONTEXT');
        }
      };
      await assertAuthor();
      if (current.revision !== expectedRevision) {
        fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed before artwork persistence.', 'PERSISTENCE');
      }
      if (!plain(style) || !plain(asset)) {
        fail('MAKER_V8_PACK_ASSET_INPUT_INVALID', 'Pack Style and asset inputs are required.', 'INPUT');
      }
      if (style.protected !== undefined && typeof style.protected !== 'boolean') {
        fail('MAKER_V8_PACK_ASSET_PROTECTION_INVALID', 'Pack Style protection must be one explicit boolean.', 'INPUT');
      }
      const mediaType = String(asset.mediaType || '');
      if (!MEDIA_TYPES.has(mediaType)) {
        fail('MAKER_V8_PACK_ASSET_MEDIA_INVALID', 'Pack artwork must be PNG or WebP.', 'ASSET');
      }
      const bytes = canonicalAssetBytes(asset.bytesBase64);
      const hash = await sha256(bytes);
      const assetId = safeKey(asset.assetId, 'assetId');
      const document = structuredClone(current.document);
      const semantic = {
        partKey: safeKey(style.partKey, 'partKey'),
        itemKey: safeKey(style.itemKey, 'itemKey'),
        styleKey: safeKey(style.styleKey, 'styleKey'),
        layerTrackKey: safeKey(style.layerTrackKey, 'layerTrackKey'),
      };
      const index = document.styles.findIndex((entry) => (
        entry.partKey === semantic.partKey
        && entry.itemKey === semantic.itemKey
        && entry.styleKey === semantic.styleKey
      ));
      const priorAsset = await persistence.loadAsset(draftId, assetId);
      const row = {
        sequence: String(index < 0 ? document.styles.length : index),
        ...semantic,
        colorChannelKey: style.colorChannelKey === null || style.colorChannelKey === undefined
          ? null : safeKey(style.colorChannelKey, 'colorChannelKey'),
        defaultSwatchKey: style.defaultSwatchKey === null || style.defaultSwatchKey === undefined
          ? null : safeKey(style.defaultSwatchKey, 'defaultSwatchKey'),
        asset: {
          assetId,
          mediaType,
          byteLength: bytes.length,
          sha256: hash,
          blobId: null,
          contentCommitment: hash,
          protected: style.protected === true,
          sealBindingCommitment: null,
        },
      };
      if ((row.colorChannelKey === null) !== (row.defaultSwatchKey === null)) {
        fail('MAKER_V8_PACK_COLOR_REFERENCE_INVALID', 'Pack color channel and swatch must be present together.', 'INPUT');
      }
      const replacedAssetId = index < 0 ? null : document.styles[index].asset.assetId;
      if (index < 0) document.styles.push(row);
      else document.styles[index] = row;
      if (document.metadata.coverAssetId === null || document.metadata.coverAssetId === replacedAssetId) {
        document.metadata.coverAssetId = assetId;
      }
      document.styles.forEach((entry, sequence) => { entry.sequence = String(sequence); });
      if (document.authoring !== undefined) {
        document.authoring = packAuthoringDocument(document);
        assertPackAuthoring(document);
      }
      const updatedAt = draftTime(current, now);
      const next = assertMakerV8PackDraftV8({
        schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
        draftId: current.draftId,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt,
        document,
        publication: structuredClone(current.publication),
      });
      await assertAuthor();
      return persistence.upsertAsset({
        draftId,
        expectedRevision,
        next,
        assetId,
        mediaType,
        bytesBase64: asset.bytesBase64,
        expectedAssetRevision: priorAsset?.revision ?? null,
        updatedAt,
      });
    },
  };
  return freeze(studio);
}

export async function createProductionMakerV8PackAdaptersV8({
  runtime: runtimeInput,
  loadParent = null,
  client,
  wallet,
  rpc = null,
  publication = null,
  publisher = null,
  protectedTransport = null,
  lifecycle = null,
  execution = { allowWalletSignature: false, allowBroadcast: false },
  indexedDB = globalThis.indexedDB,
  persistenceOptions = {},
  lifecyclePersistenceOptions = {},
  publicationPersistence = null,
  publicationPersistenceOptions = {},
  compiler = null,
  now = () => Date.now(),
} = {}) {
  const configured = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const attested = await attestMakerV8Runtime(client, configured);
  const chain = createMakerV8ChainClient(attested.runtime, { rpc: client, network: 'mainnet' });
  const persistence = createMakerV8PackPersistenceV8(indexedDB, persistenceOptions);
  let transport = null;
  let exactCompiler = compiler;
  let exactPublication = publication;
  let exactLifecycle = lifecycle;
  let lifecycleAdapters = null;
  let boundary = null;
  let readback = null;
  let publicationStore = publicationPersistence;
  if (exactCompiler === null || exactPublication === null) {
    if (typeof rpc?.queryTransaction !== 'function') {
      fail(
        'MAKER_V8_PACK_QUERY_RPC_REQUIRED',
        'Production Pack publication requires the exact gRPC query-first browser RPC.',
        'CONFIGURATION',
      );
    }
    readback = createMakerV8PackReadbackV8({ client, runtime: attested.runtime });
    exactCompiler ??= createMakerV8PackCompilerV8({
      runtime: attested.runtime,
      loadParent,
      loadAuthority: createMakerV8PackAuthorityLoaderV8({ client, runtime: attested.runtime }),
      loadProtectedAuthority: createMakerV8PackProtectionAuthorityLoaderV8({
        client,
        runtime: attested.runtime,
      }),
      readback,
    });
    boundary = createMakerV8PackPublicationBoundaryV8({
      client,
      compilerAuthority: exactCompiler.authority,
      execution,
    });
    publicationStore ??= createMakerV8PackPublicationPersistenceV8(
      indexedDB,
      publicationPersistenceOptions,
    );
    exactPublication ??= createMakerV8PackPublicationControllerV8({
      persistence: publicationStore,
      compiler: exactCompiler,
      boundary,
      wallet,
      rpc,
      execution,
      now,
    });
  }
  if (publisher !== null) {
    transport = createMakerV8PackTransportV8({
      publisher,
      compiler: exactCompiler,
      protector: protectedTransport,
    });
  }
  if (exactLifecycle === null) {
    if (typeof rpc?.queryTransaction !== 'function') {
      fail(
        'MAKER_V8_PACK_QUERY_RPC_REQUIRED',
        'Production Pack lifecycle requires the exact gRPC query-first browser RPC.',
        'CONFIGURATION',
      );
    }
    lifecycleAdapters = await createProductionMakerV8PackLifecycleV8({
      client,
      runtime: attested.runtime,
      wallet,
      rpc,
      execution,
      indexedDB,
      persistenceOptions: lifecyclePersistenceOptions,
      now,
    });
    exactLifecycle = lifecycleAdapters.controller;
  }
  const controller = createMakerV8PackStudioV8({
    chain,
    loadParent,
    wallet,
    persistence,
    compiler: exactCompiler,
    publication: exactPublication,
    transport,
    lifecycle: exactLifecycle,
    execution,
    now,
  });
  return freeze({
    schemaVersion: MAKER_V8_PACK_ADAPTERS_SCHEMA,
    runtime: attested.runtime,
    attestation: attested,
    chain,
    persistence,
    publicationPersistence: publicationStore,
    compiler: exactCompiler,
    boundary,
    readback,
    publication: exactPublication,
    lifecycle: exactLifecycle,
    lifecycleAdapters,
    transport,
    controller,
  });
}

// Keep this referenced by source audits: Pack compilers must use the exact
// controller result schema when the dedicated publication implementation is
// added, never an ad-hoc Maker publication shortcut.
void MAKER_V8_PACK_COMPILER_RESULT_SCHEMA;
