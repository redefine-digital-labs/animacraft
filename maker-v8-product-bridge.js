import {
  assertMakerV8Document,
  createMakerV8Document,
  projectPublicMakerV8Document,
} from './maker-v8-document.js';
import {
  applyMakerV8WorkspaceCommand,
  createMakerV8Workspace,
} from './maker-v8-workspace.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalMakerV8Json } from './maker-v8-compiler.js';
import { makerV8RuleIssue } from './maker-v8-rules.js';
import {
  decodeMakerV8ProjectZip,
  encodeMakerV8ProjectZip,
} from './maker-v8-project-zip.js';
import {
  renderMakerV8DraftRecipePngV8,
  renderMakerV8PlayerRecipePngV8,
} from './maker-v8-player-journey.js';
import { makerV8PlayerRecipeCommitmentV8 } from './maker-v8-player-controller.js';
import { createMakerV8LocalPlayer } from './maker-v8-local-player.js';
import { exactMakerV8ExportOptions, makerV8ExportSizes } from './maker-v8-render-core.js';
import { makerV8DraftAuthorUpgrade } from './maker-v8-draft-store.js';
import { creatorStyleEditorState, exactCreatorTransform } from './maker-v8-creator-style.js';
import { createCreatorCharacterStarter } from './maker-v8-creator-structure.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import { isDefinitiveWalletStandardRejectionV8 } from './maker-v8-browser.js';

export const MAKER_V8_PRODUCT_BRIDGE_SCHEMA = 'animacraft.maker-v8-product-bridge.v1';
export const MAKER_V8_PRODUCT_PLAYER_SESSION_SCHEMA = 'animacraft.maker-v8-player-session.v1';

const SAFE_DRAFT_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const EXACT_HASH = /^[0-9a-f]{64}$/;
const publicationFlights = new Map();
const publicationLock = (key, operation) => {
  if (globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request(`maker-publication:${key}`, operation);
  }
  // Browsers must provide the origin-wide lock; Node's shared map is used by
  // injected local tests only, never as a cross-tab production substitute.
  if (typeof window !== 'undefined') {
    fail('MAKER_V8_PUBLICATION_LOCK_UNAVAILABLE', 'This browser cannot safely coordinate publication across tabs.', 'PERSISTENCE');
  }
  const prior = publicationFlights.get(key) ?? Promise.resolve();
  const result = prior.catch(() => {}).then(operation);
  publicationFlights.set(key, result);
  return result.finally(() => { if (publicationFlights.get(key) === result) publicationFlights.delete(key); });
};
const PRODUCT_STARTING_STRUCTURES = new Set(['blank', 'character']);
const RENDERABLE_MEDIA_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const RENDER_RECORD_FIELDS = Object.freeze([
  'schemaVersion', 'mediaType', 'width', 'height', 'bytesBase64', 'byteLength', 'sha256',
]);
const CONTEXTUAL_CHOICE_BUNDLE_FIELDS = Object.freeze([
  'schemaVersion', 'address', 'rootId', 'baseEntitlements', 'packStyles',
  'externalStyles', 'certifiedAssets', 'diagnostics',
]);

export class MakerV8ProductBridgeError extends Error {
  constructor(code, message, layer = 'PRODUCT', details = undefined) {
    super(message);
    this.name = 'MakerV8ProductBridgeError';
    this.code = code;
    this.layer = layer;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, layer, details) {
  throw new MakerV8ProductBridgeError(code, message, layer, details);
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

function method(value, name, label, { optional = false } = {}) {
  if (typeof value?.[name] === 'function') return value[name].bind(value);
  if (optional) return null;
  fail('MAKER_V8_PRODUCT_BRIDGE_ADAPTER_INVALID', `${label}.${name} is required.`, 'CONFIGURATION');
}

function errorDiagnostic(cause, fallback = 'MAKER_V8_PRODUCT_READ_FAILED') {
  return freeze({
    severity: 'ERROR',
    layer: typeof cause?.layer === 'string' ? cause.layer : 'PRODUCT',
    code: typeof cause?.code === 'string' ? cause.code : fallback,
    message: typeof cause?.message === 'string' && cause.message
      ? cause.message : 'Animacraft product data could not be read.',
    details: freeze({ ...(plain(cause?.details) ? cause.details : {}) }),
  });
}

function walletSnapshot(value, disconnected = false) {
  if (disconnected) return freeze({ status: 'disconnected', address: null, network: null, reason: null });
  const address = typeof value?.address === 'string' ? value.address.toLowerCase() : null;
  if (!address) return freeze({ status: 'disconnected', address: null, network: null, reason: null });
  if (!EXACT_ID.test(address)) {
    fail('MAKER_V8_PRODUCT_WALLET_INVALID', 'Wallet returned a non-canonical Sui address.', 'WALLET');
  }
  const network = value.network === 'mainnet' ? 'mainnet' : String(value.network ?? '');
  return freeze({
    status: network === 'mainnet' ? 'connected' : 'wrong-network',
    address,
    network: network || null,
    reason: network === 'mainnet' ? null : 'Switch the wallet account to Sui Mainnet.',
  });
}

function disconnectedWallet(error) {
  return new Set([
    'MAKER_V8_BROWSER_WALLET_NOT_CONNECTED',
    'MAKER_V8_BROWSER_WALLET_UNAVAILABLE',
    'MAKER_V8_BROWSER_WALLET_NETWORK_DRIFT',
  ]).has(error?.code);
}

function safeDraftId(value, now) {
  const candidate = String(value ?? '').trim().toLowerCase();
  if (SAFE_DRAFT_ID.test(candidate)) return candidate;
  const fallback = `maker-${String(now())}`;
  if (!SAFE_DRAFT_ID.test(fallback)) {
    fail('MAKER_V8_PRODUCT_DRAFT_ID_INVALID', 'A safe Maker v8 draft identifier is required.', 'DRAFT');
  }
  return fallback;
}

function exactDraftId(value) {
  if (typeof value !== 'string' || !SAFE_DRAFT_ID.test(value)) {
    fail('MAKER_V8_PRODUCT_DRAFT_ID_INVALID', 'A safe Maker v8 draft identifier is required.', 'DRAFT');
  }
  return value;
}

// Recovery accepts the caller's complete pending snapshot, never a fresh read
// of the conflicting source. Storage owns revisions/timestamps on the new copy.
function recoveryAssetContents(document, assets, draftId) {
  if (!Array.isArray(assets) || assets.length !== document.assets.length
    || new Set(assets.map(row => row?.assetId)).size !== assets.length) {
    fail('MAKER_V8_PRODUCT_RECOVERY_ASSETS_INVALID', 'Recovery requires every draft asset exactly once.', 'DRAFT');
  }
  return assets.map(row => {
    const descriptor = document.assets.find(asset => asset.id === row?.assetId);
    let bytes;
    try { bytes = typeof row?.bytesBase64 === 'string' ? fromBase64(row.bytesBase64) : null; } catch {}
    if (!plain(row) || !descriptor || !bytes || bytes.length < 1
      || bytes.length > 12 * 1024 * 1024 || toBase64(bytes) !== row.bytesBase64
      || (row.draftId !== undefined && row.draftId !== draftId)
      || row.kind !== descriptor.kind || row.mediaType !== descriptor.mediaType
      || row.byteLength !== bytes.length || descriptor.byteLength !== bytes.length
      || [...sha256(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== row.sha256) {
      fail('MAKER_V8_PRODUCT_RECOVERY_ASSETS_INVALID', 'Recovery asset bytes, hash or document descriptor do not match.', 'DRAFT');
    }
    return { assetId: row.assetId, kind: row.kind, mediaType: row.mediaType, bytesBase64: row.bytesBase64 };
  }).sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
}

function canvasDimensions(value) {
  const match = String(value ?? '').match(/(\d{2,5})\s*[×x]\s*(\d{2,5})/i);
  if (!match) return { width: 1024, height: 1024 };
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 16 || width > 16_384 || height < 16 || height > 16_384) {
    return { width: 1024, height: 1024 };
  }
  return { width, height };
}

/** Convert the product shell's bounded local form into the one exact v8 document. */
export function makerV8DocumentFromProductDraft(value, { now = () => Date.now() } = {}) {
  if (!plain(value)) {
    fail('MAKER_V8_PRODUCT_DRAFT_INVALID', 'Maker draft must be a plain record.', 'DRAFT');
  }
  const makerKey = safeDraftId(value.makerId ?? value.draftId, now);
  const name = String(value.name || 'Untitled Maker').trim().slice(0, 256) || 'Untitled Maker';
  const dimensions = canvasDimensions(value.canvas);
  const startingStructure = value.startingStructure === undefined
    ? 'character' : value.startingStructure;
  if (typeof startingStructure !== 'string'
    || !PRODUCT_STARTING_STRUCTURES.has(startingStructure)) {
    fail(
      'MAKER_V8_PRODUCT_STARTING_STRUCTURE_INVALID',
      'New Maker startingStructure must be exactly character or blank.',
      'DRAFT',
    );
  }
  const createDocument = startingStructure === 'blank'
    ? createMakerV8Document : createCreatorCharacterStarter;
  const document = structuredClone(createDocument({
    makerKey,
    name,
    width: dimensions.width,
    height: dimensions.height,
  }));
  document.metadata.summary = String(value.description || '').trim().slice(0, 2_048);
  document.lineage.changelog = 'Created with the Animacraft Fresh Maker v8 Creator Studio.';
  assertMakerV8Document(document, { mode: 'draft' });
  return freeze(document);
}

function mergeProductFieldsIntoDocument(value, current, now) {
  const candidate = makerV8DocumentFromProductDraft(value, { now });
  if (!current) return candidate;
  const document = structuredClone(current);
  document.metadata.name = candidate.metadata.name;
  document.metadata.summary = candidate.metadata.summary;
  document.canvas = structuredClone(candidate.canvas);
  document.lineage.changelog = candidate.lineage.changelog;
  assertMakerV8Document(document, { mode: 'draft' });
  return freeze(document);
}

function activeAttemptId(plan) {
  return typeof plan?.attemptId === 'string' && plan.attemptId ? plan.attemptId : null;
}

function readyPlayerSnapshotIdentity(snapshot) {
  if (snapshot?.status !== 'READY' || !plain(snapshot.player)) return null;
  const rootId = snapshot.player.rootId;
  if (typeof rootId !== 'string' || !EXACT_ID.test(rootId)) {
    fail(
      'MAKER_V8_PRODUCT_PLAYER_ROOT_DRIFT',
      'Player snapshot no longer identifies one exact certified Maker Root.',
      'PLAYER',
    );
  }
  const roots = [snapshot.recipe?.rootId, snapshot.loadout?.rootId]
    .filter((value) => value !== undefined);
  if (roots.some((value) => value !== rootId)) {
    fail(
      'MAKER_V8_PRODUCT_PLAYER_ROOT_DRIFT',
      'Player, Recipe, and Loadout no longer identify the same certified Maker Root.',
      'PLAYER',
    );
  }
  const commitments = [
    snapshot.player.evidence?.contentCommitment,
    snapshot.recipe?.rootContentCommitment,
    snapshot.loadout?.rootContentCommitment,
  ].filter((value) => value !== undefined);
  if (new Set(commitments).size > 1) {
    fail(
      'MAKER_V8_PRODUCT_PLAYER_COMMITMENT_DRIFT',
      'Player, Recipe, and Loadout no longer share one exact Root commitment.',
      'PLAYER',
    );
  }
  return freeze({ rootId, rootContentCommitment: commitments[0] ?? null });
}

function exactPlayerPreviewAuthority(snapshot) {
  const identity = readyPlayerSnapshotIdentity(snapshot);
  if (!identity || !EXACT_HASH.test(identity.rootContentCommitment ?? '')
    || !plain(snapshot.recipe) || !plain(snapshot.loadout)) {
    fail('STALE_PLAYER_SESSION', 'Player preview lacks one exact live Recipe and Loadout.', 'PLAYER');
  }
  const recipeCommitment = makerV8PlayerRecipeCommitmentV8(snapshot.recipe);
  const versions = [
    snapshot.player?.makerVersion,
    snapshot.recipe.makerVersion,
    snapshot.loadout.makerVersion,
  ].map((value) => String(value ?? ''));
  if (snapshot.loadout.recipeCommitment !== recipeCommitment
    || versions.some((value) => !/^[1-9][0-9]*$/.test(value))
    || new Set(versions).size !== 1) {
    fail('STALE_PLAYER_SESSION', 'Player preview Recipe, Loadout, or Maker version drifted.', 'PLAYER');
  }
  return freeze({
    ...identity,
    makerVersion: versions[0],
    recipeCommitment,
    recipeJson: canonicalMakerV8Json(snapshot.recipe),
    loadoutJson: canonicalMakerV8Json(snapshot.loadout),
  });
}

function samePlayerPreviewAuthority(left, right) {
  return left?.rootId === right?.rootId
    && left?.rootContentCommitment === right?.rootContentCommitment
    && left?.makerVersion === right?.makerVersion
    && left?.recipeCommitment === right?.recipeCommitment
    && left?.recipeJson === right?.recipeJson
    && left?.loadoutJson === right?.loadoutJson;
}

function draftPreviewAuthority(record, assets) {
  if (!plain(record) || typeof record.draftId !== 'string'
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !plain(record.document) || !Array.isArray(assets)) {
    fail('STALE_DRAFT_PREVIEW', 'Creator preview lacks one exact durable draft bundle.', 'DRAFT');
  }
  return freeze({
    draftId: record.draftId,
    revision: record.revision,
    documentJson: canonicalMakerV8Json(record.document),
    assetsJson: canonicalMakerV8Json(assets),
  });
}

function sameDraftPreviewAuthority(left, right) {
  return left?.draftId === right?.draftId
    && left?.revision === right?.revision
    && left?.documentJson === right?.documentJson
    && left?.assetsJson === right?.assetsJson;
}

function exactPngRenderRecord(value, layer) {
  const fields = plain(value) ? Object.keys(value).sort() : [];
  const expected = [...RENDER_RECORD_FIELDS].sort();
  if (!plain(value) || fields.length !== expected.length
    || fields.some((field, index) => field !== expected[index])
    || value.schemaVersion !== 'animacraft.maker-v8-player-render.v1'
    || value.mediaType !== 'image/png'
    || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 16_384
    || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 16_384
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || !EXACT_HASH.test(value.sha256 ?? '')
    || typeof value.bytesBase64 !== 'string') {
    fail(
      layer === 'DRAFT' ? 'MAKER_V8_PRODUCT_DRAFT_RENDER_INVALID' : 'MAKER_V8_PRODUCT_PLAYER_RENDER_INVALID',
      'Deterministic preview returned an invalid canonical PNG record.',
      layer,
    );
  }
  let bytes;
  try {
    bytes = fromBase64(value.bytesBase64);
  } catch {
    bytes = null;
  }
  const digest = bytes
    ? [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    : null;
  if (!bytes || toBase64(bytes) !== value.bytesBase64
    || bytes.length !== value.byteLength || digest !== value.sha256) {
    fail(
      layer === 'DRAFT' ? 'MAKER_V8_PRODUCT_DRAFT_RENDER_INVALID' : 'MAKER_V8_PRODUCT_PLAYER_RENDER_INVALID',
      'Deterministic preview bytes differ from their exact render evidence.',
      layer,
    );
  }
  return freeze(structuredClone(value));
}

/**
 * Product-facing orchestration bridge. It does not construct chain adapters or
 * invent missing capabilities: a control is exposed only when its certified
 * controller was explicitly supplied.
 */
export function createMakerV8ProductBridge({
  productRuntime,
  drafts,
  localPlayerStore = null,
  publication = null,
  publicationTransport = null,
  publicationStore = null,
  lifecycle = null,
  player = null,
  playerJourney = null,
  pack = null,
  composable = null,
  composableTransport = null,
  rendering = {},
  execution = {},
  now = () => Date.now(),
} = {}) {
  const readyProduct = method(productRuntime, 'ready', 'productRuntime');
  const loadPlaza = method(productRuntime?.catalog, 'loadPlaza', 'productRuntime.catalog');
  const loadPlayer = method(productRuntime?.catalog, 'loadPlayer', 'productRuntime.catalog');
  const loadInventory = method(productRuntime?.inventory, 'load', 'productRuntime.inventory', { optional: true });
  const loadContextualChoices = method(
    productRuntime?.choices,
    'load',
    'productRuntime.choices',
    { optional: true },
  );
  const loadMakerLineage = method(
    productRuntime?.lineage,
    'load',
    'productRuntime.lineage',
    { optional: true },
  );
  const loadCertifiedAsset = method(
    productRuntime?.assets,
    'load',
    'productRuntime.assets',
    { optional: true },
  );
  const currentAccount = method(productRuntime?.wallet, 'getCurrentAccount', 'productRuntime.wallet');
  const reconnect = method(productRuntime?.wallet, 'reconnect', 'productRuntime.wallet');
  const walletSubscribe = method(productRuntime?.wallet, 'subscribe', 'productRuntime.wallet', { optional: true });
  const walletDispose = method(productRuntime?.wallet, 'dispose', 'productRuntime.wallet', { optional: true });
  const createDraftBundleRecord = method(drafts, 'createBundle', 'drafts');
  const createSuccessorDraftRecord = method(drafts, 'createSuccessor', 'drafts', { optional: true });
  const loadDraftRecord = method(drafts, 'load', 'drafts');
  const listDraftRecords = method(drafts, 'list', 'drafts');
  const deleteDraftRecord = method(drafts, 'delete', 'drafts', { optional: true });
  const saveDraftRecord = method(drafts, 'compareAndSwap', 'drafts');
  const saveDraftBundleRecord = method(drafts, 'compareAndSwapBundle', 'drafts', { optional: true });
  const listDraftVersionsRecord = method(drafts, 'listVersions', 'drafts', { optional: true });
  const restoreDraftVersionRecord = method(drafts, 'restoreVersion', 'drafts', { optional: true });
  const exportDraftRecord = method(drafts, 'export', 'drafts');
  const importDraftRecord = method(drafts, 'importBundle', 'drafts', { optional: true });
  const replaceDraftBundleRecord = method(drafts, 'replaceBundle', 'drafts', { optional: true });
  const closeDrafts = method(drafts, 'close', 'drafts', { optional: true });
  const listDraftAssets = method(drafts, 'listAssets', 'drafts', { optional: true });
  const upsertDraftAsset = method(drafts, 'upsertAsset', 'drafts', { optional: true });
  const renderPlayerRecipe = typeof rendering?.renderPlayer === 'function'
    ? rendering.renderPlayer : renderMakerV8PlayerRecipePngV8;
  const renderDraftRecipe = typeof rendering?.renderDraft === 'function'
    ? rendering.renderDraft : renderMakerV8DraftRecipePngV8;
  const renderingDependencies = freeze(Object.fromEntries([
    ['canvasFactory', rendering?.canvasFactory],
    ['decodeImage', rendering?.decodeImage],
    ['colorizeImage', rendering?.colorizeImage],
  ].filter(([, value]) => typeof value === 'function')));

  const gates = freeze({
    allowWalletSignature: execution.allowWalletSignature === true,
    allowBroadcast: execution.allowBroadcast === true,
  });
  if (gates.allowWalletSignature !== gates.allowBroadcast) {
    fail(
      'MAKER_V8_PRODUCT_EXECUTION_GATE_INVALID',
      'Wallet signing and exact-byte broadcast gates must change together.',
      'CONFIGURATION',
    );
  }

  let softDisconnected = false;
  let disposed = false;
  let runtimeStatus = 'STARTING';
  let wallet = walletSnapshot(null);
  let templates = null;
  let activePublicationAttemptId = null;
  let publicationGeneration = 0;
  let publicationReview = null;
  const invalidatePublicationReview = () => { publicationGeneration += 1; publicationReview = null; };
  let route = null;
  let issue = null;
  let walletInitialized = false;
  let playerSessionGeneration = 0;
  let activePlayerContext = null;
  let playerRenderGeneration = 0;
  let playerRenderController = null;
  let playerContextRefreshGeneration = 0;
  let draftRenderGeneration = 0;
  let localPlayerGeneration = 0;
  let localPlayer = null;
  const listeners = new Set();

  const invalidateLocalPlayer = () => {
    localPlayerGeneration += 1;
    localPlayer?.dispose();
    localPlayer = null;
  };

  const walletIdentity = (value) => [
    value?.status ?? 'disconnected',
    value?.address ?? '',
    value?.network ?? '',
  ].join(':');
  const invalidatePlayerRender = () => {
    playerRenderGeneration += 1;
    playerRenderController?.abort();
    playerRenderController = null;
  };
  const invalidatePlayerSession = () => {
    playerSessionGeneration += 1;
    invalidatePlayerRender();
    playerContextRefreshGeneration += 1;
    activePlayerContext = null;
  };
  const capturePlayerContextOwnership = () => {
    const context = activePlayerContext;
    return context ? freeze({
      context,
      generation: context.generation,
      rootId: context.rootId,
    }) : null;
  };
  const ownsActivePlayerContext = (ownership) => Boolean(
    ownership
    && activePlayerContext === ownership.context
    && activePlayerContext?.generation === ownership.generation
    && activePlayerContext?.rootId === ownership.rootId
    && playerSessionGeneration === ownership.generation,
  );
  const invalidateOwnedPlayerContext = (ownership) => {
    if (!ownsActivePlayerContext(ownership)) return false;
    invalidatePlayerSession();
    return true;
  };
  const invalidateDraftPreviews = () => {
    invalidatePublicationReview();
    draftRenderGeneration += 1;
    invalidateLocalPlayer();
  };
  const assertDraftPreviewCurrent = (generation) => {
    if (disposed || generation !== draftRenderGeneration) {
      fail('STALE_DRAFT_PREVIEW', 'A newer Creator preview or draft mutation replaced this work.', 'DRAFT');
    }
  };
  const applyWallet = (nextWallet) => {
    const changed = walletInitialized && walletIdentity(wallet) !== walletIdentity(nextWallet);
    walletInitialized = true;
    wallet = nextWallet;
    if (changed) { invalidatePlayerSession(); invalidatePublicationReview(); }
    return wallet;
  };
  const assertPlayerSessionCurrent = (generation, expectedWalletIdentity = null) => {
    if (disposed || generation !== playerSessionGeneration
      || (expectedWalletIdentity !== null && walletIdentity(wallet) !== expectedWalletIdentity)) {
      fail(
        'STALE_PLAYER_SESSION',
        'A newer Player session or wallet identity replaced this work.',
        'PLAYER',
        { generation, activeGeneration: playerSessionGeneration },
      );
    }
  };
  const assertPlayerRenderCurrent = (
    sessionGeneration,
    renderGeneration,
    expectedWalletIdentity,
  ) => {
    assertPlayerSessionCurrent(sessionGeneration, expectedWalletIdentity);
    if (renderGeneration !== playerRenderGeneration) {
      fail(
        'STALE_PLAYER_SESSION',
        'A newer Player preview or Recipe mutation replaced this render.',
        'PLAYER',
      );
    }
  };

  const state = () => freeze({
    schemaVersion: MAKER_V8_PRODUCT_BRIDGE_SCHEMA,
    runtime: freeze({
      status: runtimeStatus,
      transport: productRuntime?.capabilities?.transport ?? 'SUI_GRPC_GRAPHQL',
      jsonRpc: false,
      issue,
    }),
    wallet,
    templates,
    route,
    publication: freeze({
      attemptId: activePublicationAttemptId,
      available: Boolean(publication),
      signingEnabled: gates.allowWalletSignature,
      broadcastEnabled: gates.allowBroadcast,
    }),
    capabilities: freeze({
      drafts: true,
      player: Boolean(player),
      playerJourney: Boolean(playerJourney),
      nativeCompletionConfigured: gates.allowWalletSignature && gates.allowBroadcast
        && typeof playerJourney?.isNativeCompletionConfigured === 'function'
        && playerJourney.isNativeCompletionConfigured() === true,
      pack: Boolean(pack),
      composable: Boolean(composable),
      lifecycle: Boolean(lifecycle),
      successor: Boolean(loadMakerLineage && createSuccessorDraftRecord),
    }),
  });
  const emit = () => {
    const snapshot = state();
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* Product observers never control execution. */ }
    }
    return snapshot;
  };
  const rememberError = (error) => {
    issue = errorDiagnostic(error);
    emit();
    throw error;
  };

  let readyPromise = null;
  const ensureReady = async () => {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          await readyProduct();
          runtimeStatus = 'READY';
          issue = null;
          emit();
          return true;
        } catch (error) {
          runtimeStatus = 'ERROR';
          issue = errorDiagnostic(error, 'MAKER_V8_PRODUCT_RUNTIME_FAILED');
          emit();
          throw error;
        }
      })();
    }
    return readyPromise;
  };

  const readWallet = async ({ optional = true } = {}) => {
    if (softDisconnected) {
      applyWallet(walletSnapshot(null, true));
      emit();
      return wallet;
    }
    try {
      applyWallet(walletSnapshot(await currentAccount()));
      emit();
      return wallet;
    } catch (error) {
      if (!optional || !disconnectedWallet(error)) throw error;
      applyWallet(walletSnapshot(null));
      emit();
      return wallet;
    }
  };

  const requireConnected = async () => {
    const snapshot = await readWallet({ optional: false });
    if (snapshot.status !== 'connected') {
      fail('MAKER_V8_PRODUCT_WALLET_REQUIRED', 'Connect a Sui Mainnet wallet first.', 'WALLET');
    }
    return snapshot;
  };

  const assertContextualChoices = (value, { address: expectedAddress, rootId }) => {
    const fields = plain(value) ? Object.keys(value).sort() : [];
    const expectedFields = [...CONTEXTUAL_CHOICE_BUNDLE_FIELDS].sort();
    if (!plain(value)
      || fields.length !== expectedFields.length
      || fields.some((field, index) => field !== expectedFields[index])
      || value.schemaVersion !== 'animacraft.maker-v8-contextual-choices.v1'
      || value.address !== expectedAddress
      || value.rootId !== rootId
      || !Array.isArray(value.baseEntitlements)
      || !Array.isArray(value.packStyles)
      || !Array.isArray(value.externalStyles)
      || !Array.isArray(value.certifiedAssets)
      || !Array.isArray(value.diagnostics)
      || value.diagnostics.length !== 0) {
      fail(
        'MAKER_V8_PRODUCT_CONTEXTUAL_AUTHORITY_INVALID',
        'Contextual choices lack one exact clean wallet and active Root authority.',
        'PLAYER',
      );
    }
    return freeze(structuredClone(value));
  };

  const mergeContextualChoices = (playerView, contextualChoices) => {
    if (contextualChoices.rootId !== playerView.rootId) {
      fail(
        'MAKER_V8_PRODUCT_CONTEXTUAL_ROOT_DRIFT',
        'Contextual Pack and external choices belong to a different Maker Root.',
        'PLAYER',
      );
    }
    const assets = new Map();
    for (const asset of [
      ...(Array.isArray(playerView.certifiedAssets) ? playerView.certifiedAssets : []),
      ...(Array.isArray(contextualChoices.certifiedAssets)
        ? contextualChoices.certifiedAssets : []),
    ]) {
      const current = assets.get(asset.assetId);
      if (current && canonicalMakerV8Json(current) !== canonicalMakerV8Json(asset)) {
        fail(
          'MAKER_V8_PRODUCT_CONTEXTUAL_ASSET_COLLISION',
          'A contextual Pack asset collides with another certified asset identity.',
          'ASSET',
          { assetId: asset.assetId },
        );
      }
      assets.set(asset.assetId, freeze(structuredClone(asset)));
    }
    return freeze({
      ...structuredClone(playerView),
      certifiedAssets: freeze([...assets.values()]),
      contextualChoices: freeze(structuredClone(contextualChoices)),
    });
  };

  const attachContextualChoices = async (
    playerView,
    { account, generation, expectedWalletIdentity } = {},
  ) => {
    if (!loadContextualChoices || !EXACT_ID.test(playerView?.rootId ?? '')
      || account?.status !== 'connected') return playerView;
    const contextualChoices = await loadContextualChoices({
      address: account.address,
      rootId: playerView.rootId,
    });
    assertPlayerSessionCurrent(generation, expectedWalletIdentity);
    const exact = assertContextualChoices(contextualChoices, {
      address: account.address,
      rootId: playerView.rootId,
    });
    return mergeContextualChoices(playerView, exact);
  };

  const persistProductDraft = async (input, { createOnly = false } = {}) => {
    invalidateDraftPreviews();
    const draftId = safeDraftId(input?.makerId ?? input?.draftId, now);
    const current = await loadDraftRecord(draftId);
    const document = mergeProductFieldsIntoDocument(
      { ...input, makerId: draftId },
      current?.document ?? null,
      now,
    );
    if (current) {
      if (createOnly) {
        fail('MAKER_V8_PRODUCT_DRAFT_EXISTS', `Draft ${draftId} already exists.`, 'DRAFT');
      }
      if (canonicalMakerV8Json(current.document) === canonicalMakerV8Json(document)) return current;
      return saveDraftRecord({
        draftId,
        expectedRevision: current.revision,
        document,
        updatedAt: Number(now()),
      });
    }
    const createdAt = Number(now());
    const created = await createDraftBundleRecord({
      draftId,
      document,
      createdAt,
      assets: [],
    });
    return created.draft;
  };

  const transportInputForDraft = async (record, signerAddress) => {
    if (!listDraftAssets) {
      fail(
        'MAKER_V8_PRODUCT_ASSET_PERSISTENCE_REQUIRED',
        'Publication requires durable bytes for every Maker asset.',
        'PUBLICATION',
      );
    }
    const assets = await listDraftAssets(record.draftId);
    return freeze({
      document: structuredClone(record.document),
      signerAddress,
      attemptNonce: `product-${record.draftId}-r${record.revision}`,
      assets: assets.map((asset) => ({
        assetId: asset.assetId,
        kind: asset.kind,
        mediaType: asset.mediaType,
        bytesBase64: asset.bytesBase64,
      })),
    });
  };

  const bridge = {
    schemaVersion: MAKER_V8_PRODUCT_BRIDGE_SCHEMA,
    ready: ensureReady,
    getState: state,
    subscribe(listener) {
      if (typeof listener !== 'function') {
        fail('MAKER_V8_PRODUCT_LISTENER_INVALID', 'Product listener must be a function.', 'VALIDATION');
      }
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    navigate(nextRoute) {
      invalidatePublicationReview();
      route = plain(nextRoute) ? freeze(structuredClone(nextRoute)) : null;
      emit();
      return route;
    },
    async getWalletState() {
      await ensureReady();
      return readWallet();
    },
    async connectWallet() {
      await ensureReady();
      softDisconnected = false;
      applyWallet(walletSnapshot(await reconnect()));
      issue = null;
      emit();
      return wallet;
    },
    async disconnectWallet() {
      softDisconnected = true;
      invalidatePlayerSession();
      walletInitialized = true;
      wallet = walletSnapshot(null, true);
      emit();
      return wallet;
    },
    async listTemplates() {
      let result;
      try {
        await ensureReady();
        result = await loadPlaza();
      } catch (error) {
        result = freeze({
          status: 'ERROR',
          makers: freeze([]),
          diagnostics: freeze([errorDiagnostic(error, 'MAKER_V8_PRODUCT_CATALOG_UNAVAILABLE')]),
        });
      }
      templates = result;
      issue = result?.status === 'ERROR' ? result.diagnostics?.[0] ?? null : null;
      emit();
      return templates;
    },
    async getTemplate({ makerId } = {}) {
      await ensureReady();
      const result = await loadPlayer(makerId);
      if (result?.status !== 'READY' || !result.player) {
        const diagnostic = result?.diagnostics?.[0];
        fail(
          diagnostic?.code ?? 'MAKER_V8_PRODUCT_TEMPLATE_UNAVAILABLE',
          diagnostic?.message ?? 'The selected certified Maker is unavailable.',
          diagnostic?.layer ?? 'PLAYER',
        );
      }
      return freeze(structuredClone(result.player));
    },
    async loadCertifiedAsset({ asset, signal } = {}) {
      if (!loadCertifiedAsset) {
        fail(
          'MAKER_V8_PRODUCT_ASSET_READER_UNAVAILABLE',
          'Certified Maker artwork is unavailable in this runtime.',
          'ASSET',
        );
      }
      await ensureReady();
      const loaded = await loadCertifiedAsset(asset, { signal });
      const expected = plain(asset) ? asset : {};
      const exact = ['assetId', 'blobId', 'mediaType', 'byteLength', 'sha256'];
      if (!plain(loaded) || exact.some((field) => loaded[field] !== expected[field])
        || typeof loaded.bytesBase64 !== 'string') {
        fail(
          'MAKER_V8_PRODUCT_ASSET_READBACK_DRIFT',
          'Certified artwork readback differs from its Manifest evidence.',
          'ASSET',
        );
      }
      if (!RENDERABLE_MEDIA_TYPES.has(loaded.mediaType)) {
        fail(
          'MAKER_V8_PRODUCT_ASSET_MEDIA_UNSAFE',
          'This certified asset format is not allowed in the product image renderer.',
          'ASSET',
          { assetId: loaded.assetId, mediaType: loaded.mediaType },
        );
      }
      let bytes;
      try {
        bytes = fromBase64(loaded.bytesBase64);
      } catch {
        fail('MAKER_V8_PRODUCT_ASSET_BASE64_INVALID', 'Certified artwork bytes are not canonical Base64.', 'ASSET');
      }
      if (toBase64(bytes) !== loaded.bytesBase64 || bytes.length !== loaded.byteLength) {
        fail('MAKER_V8_PRODUCT_ASSET_BASE64_INVALID', 'Certified artwork bytes are not canonical Base64.', 'ASSET');
      }
      return freeze({
        schemaVersion: 'animacraft.maker-v8-product-asset.v1',
        assetId: loaded.assetId,
        blobId: loaded.blobId,
        mediaType: loaded.mediaType,
        byteLength: loaded.byteLength,
        sha256: loaded.sha256,
        dataUrl: `data:${loaded.mediaType};base64,${loaded.bytesBase64}`,
      });
    },
    async listDrafts() {
      return listDraftRecords();
    },
    async createDraft(input) {
      return persistProductDraft(input, { createOnly: true });
    },
    async deleteDraft({ draftId, expectedRevision } = {}) {
      const id = exactDraftId(draftId);
      invalidateDraftPreviews();
      return deleteDraftRecord({ draftId: id, expectedRevision });
    },
    async getDraft({ draftId } = {}) {
      const draft = await loadDraftRecord(exactDraftId(draftId));
      if (!draft) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      const assets = listDraftAssets ? await listDraftAssets(draft.draftId) : [];
      return freeze({ draft, assets });
    },
    async openLocalPlayer({ draftId, expectedRevision } = {}) {
      const checkedId = exactDraftId(draftId);
      invalidateLocalPlayer();
      const generation = localPlayerGeneration;
      const current = () => {
        if (disposed || generation !== localPlayerGeneration) {
          fail('STALE_LOCAL_PLAYER', 'A newer local session or Creator edit replaced this Player Test.', 'DRAFT');
        }
      };
      const read = async () => {
        current();
        if (!listDraftAssets) fail('MAKER_V8_PRODUCT_ASSET_PERSISTENCE_REQUIRED', 'Local Player requires durable draft assets.', 'DRAFT');
        const record = await loadDraftRecord(checkedId);
        const assets = await listDraftAssets(checkedId);
        current();
        if (!record || record.draftId !== checkedId || record.revision !== expectedRevision) {
          fail('STALE_LOCAL_PLAYER', 'Local Player draft identity or revision changed.', 'DRAFT');
        }
        return freeze({ record, assets, authority: draftPreviewAuthority(record, assets) });
      };
      const bundle = await read();
      const assetHash = [...sha256(new TextEncoder().encode(bundle.authority.assetsJson))]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const assertBundleCurrent = async () => {
        const observed = await read();
        if (!sameDraftPreviewAuthority(bundle.authority, observed.authority)) {
          fail('STALE_LOCAL_PLAYER', 'Local Player document or asset bytes changed.', 'DRAFT');
        }
        return observed;
      };
      const session = createMakerV8LocalPlayer({
        draftId: checkedId, draftRevision: bundle.record.revision, document: bundle.record.document,
      });
      await assertBundleCurrent();
      localPlayer = session;
      const renderTickets = { preview: 0, export: 0 };
      const checkpointBinding = freeze({ draftId: checkedId, draftRevision: bundle.record.revision,
        documentHash: JSON.parse(session.exportCheckpoint()).documentHash, assetHash });
      // Only a real draft-store read can prove an exact old-author projection.
      // Published documents and cloned records do not get a hash alias.
      const authorUpgrade = makerV8DraftAuthorUpgrade(bundle.record);
      const sourceDocumentHash = authorUpgrade
        ? [...sha256(new TextEncoder().encode(authorUpgrade.sourceDocumentJson))]
          .map(byte => byte.toString(16).padStart(2, '0')).join('')
        : null;
      const normalizedCheckpoint = (serialized) => {
        if (typeof serialized !== 'string' || serialized.length > 32 * 1024 * 1024 + 1024
          || new TextEncoder().encode(serialized).length > 32 * 1024 * 1024 + 1024) {
          fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local bundle checkpoint is too large.', 'DRAFT');
        }
        let value;
        try { value = JSON.parse(serialized); } catch {
          fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local bundle checkpoint JSON is invalid.', 'DRAFT');
        }
        if (!plain(value) || Object.keys(value).length !== 3
          || value.schemaVersion !== 'animacraft.maker-v8-local-player-bundle-checkpoint.v1'
          || value.assetHash !== assetHash || typeof value.checkpoint !== 'string'
          || canonicalMakerV8Json(value) !== serialized) {
          fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local checkpoint assets do not match this draft.', 'DRAFT');
        }
        if (authorUpgrade) {
          let payload;
          try { payload = JSON.parse(value.checkpoint); } catch {
            fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local checkpoint JSON is invalid.', 'DRAFT');
          }
          if (plain(payload) && payload.documentHash === sourceDocumentHash
            && payload.draftId === checkedId && payload.draftRevision === bundle.record.revision
            && canonicalMakerV8Json(payload) === value.checkpoint) {
            value.checkpoint = canonicalMakerV8Json({ ...payload, documentHash: checkpointBinding.documentHash });
          }
        }
        // Revalidate references, rules and personalization before storage writes.
        const validator = createMakerV8LocalPlayer({
          draftId: checkedId, draftRevision: bundle.record.revision, document: bundle.record.document,
        });
        try { validator.restoreCheckpoint(value.checkpoint, 0); }
        finally { validator.dispose(); }
        return value;
      };
      const exportLocalCheckpoint = async () => {
        const revision = session.getSnapshot().revision;
        await assertBundleCurrent();
        current();
        if (session.getSnapshot().revision !== revision) fail('STALE_LOCAL_PLAYER', 'Local Player changed during export.', 'DRAFT');
        return canonicalMakerV8Json({
          schemaVersion: 'animacraft.maker-v8-local-player-bundle-checkpoint.v1',
          assetHash, checkpoint: session.exportCheckpoint(),
        });
      };
      return freeze({
        getSnapshot() { current(); return session.getSnapshot(); },
        setRecipe(recipe, revision) { current(); return session.setRecipe(recipe, revision); },
        setPersonalization(input, revision) { current(); return session.setPersonalization(input, revision); },
        setImageExport(input, revision) { current(); return session.setImageExport(input, revision); },
        exportCheckpoint: exportLocalCheckpoint,
        async loadCheckpoint() {
          if (typeof localPlayerStore?.load !== 'function') fail('LOCAL_PLAYER_STORE_UNAVAILABLE', 'Local checkpoint storage is unavailable.', 'DRAFT');
          await assertBundleCurrent();
          let record = await localPlayerStore.load(checkpointBinding);
          if (!record && authorUpgrade) {
            const prior = await localPlayerStore.load({ ...checkpointBinding, documentHash: sourceDocumentHash });
            if (prior) {
              const checkpoint = canonicalMakerV8Json(normalizedCheckpoint(prior.checkpoint));
              await assertBundleCurrent();
              try {
                // Preserve the original and never overwrite a racing new save.
                record = await localPlayerStore.save({ binding: checkpointBinding, checkpoint, expected: null });
              } catch (error) {
                if (error?.code !== 'LOCAL_PLAYER_STORE_CAS_CONFLICT') throw error;
                record = await localPlayerStore.load(checkpointBinding);
                if (!record) throw error;
              }
            }
          }
          if (record) normalizedCheckpoint(record.checkpoint);
          await assertBundleCurrent();
          session.getSnapshot();
          return record;
        },
        captureCheckpointSave() {
          current();
          if (typeof localPlayerStore?.save !== 'function') fail('LOCAL_PLAYER_STORE_UNAVAILABLE', 'Local checkpoint storage is unavailable.', 'DRAFT');
          const revision = session.getSnapshot().revision;
          const checkpoint = canonicalMakerV8Json({
            schemaVersion: 'animacraft.maker-v8-local-player-bundle-checkpoint.v1',
            assetHash, checkpoint: session.exportCheckpoint(),
          });
          // Captured bytes belong to the already validated immutable source.
          // Persisting them must not depend on a later UI/model lifetime.
          return freeze({ revision, commit: (expected) => localPlayerStore.save({
            binding: checkpointBinding, checkpoint, expected,
          }) });
        },
        async restoreCheckpoint(serialized, revision) {
          const value = normalizedCheckpoint(serialized);
          await assertBundleCurrent();
          current();
          return session.restoreCheckpoint(value.checkpoint, revision);
        },
        reset(revision) { current(); return session.reset(revision); },
        undo(revision) { current(); return session.undo(revision); },
        redo(revision) { current(); return session.redo(revision); },
        async getAssets() {
          const observed = await assertBundleCurrent();
          session.getSnapshot();
          return observed.assets;
        },
        async renderPreview(exportInput = null) {
          current();
          const snapshot = session.getSnapshot();
          const exportOptions = exportInput === null ? null : exactMakerV8ExportOptions(snapshot.document.canvas, exportInput);
          const lane = exportOptions === null ? 'preview' : 'export';
          const ticket = ++renderTickets[lane];
          const assertRenderCurrent = () => {
            current();
            if (ticket !== renderTickets[lane] || session.getSnapshot().revision !== snapshot.revision) {
              fail('STALE_LOCAL_PLAYER', 'Local Player recipe changed during rendering.', 'DRAFT');
            }
          };
          const observed = await assertBundleCurrent();
          assertRenderCurrent();
          const rendered = await renderDraftRecipe({
            document: snapshot.document, assets: observed.assets,
            recipe: snapshot.recipe, ...renderingDependencies, exportOptions,
          });
          assertRenderCurrent();
          await assertBundleCurrent();
          assertRenderCurrent();
          const result = exactPngRenderRecord(rendered, 'DRAFT');
          if (exportOptions) {
            const target = makerV8ExportSizes(snapshot.document.canvas)[exportOptions.sizeMode];
            if (result.width !== target.width || result.height !== target.height) {
              fail('MAKER_V8_LOCAL_PLAYER_EXPORT_SIZE_MISMATCH', 'Rendered export dimensions differ from the requested size.', 'DRAFT');
            }
          }
          return result;
        },
        dispose() {
          session.dispose();
          if (generation === localPlayerGeneration) invalidateLocalPlayer();
        },
      });
    },
    async saveDraft(input) {
      return persistProductDraft(input);
    },
    async dispatchDraftCommand({ draftId, expectedRevision, command } = {}) {
      invalidateDraftPreviews();
      const checkedId = exactDraftId(draftId);
      const draft = await loadDraftRecord(checkedId);
      if (!draft) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      if (draft.revision !== expectedRevision) {
        fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Maker draft changed in another tab.', 'DRAFT');
      }
      const document = applyMakerV8WorkspaceCommand(draft.document, command);
      return saveDraftRecord({
        draftId: checkedId,
        expectedRevision,
        document,
        updatedAt: Number(now()),
      });
    },
    async dispatchDraftTransaction({
      draftId,
      expectedRevision,
      commands = [],
      assetUpserts = [],
      assetDeletes = [],
    } = {}) {
      invalidateDraftPreviews();
      if (!saveDraftBundleRecord) {
        fail(
          'MAKER_V8_PRODUCT_DRAFT_TRANSACTION_UNAVAILABLE',
          'Atomic Maker document and asset transactions are unavailable.',
          'DRAFT',
        );
      }
      if (!Array.isArray(commands) || commands.length > 1_000
        || !Array.isArray(assetUpserts) || !Array.isArray(assetDeletes)) {
        fail(
          'MAKER_V8_PRODUCT_DRAFT_TRANSACTION_INVALID',
          'A draft transaction requires bounded command and asset mutation arrays.',
          'DRAFT',
        );
      }
      const checkedId = exactDraftId(draftId);
      const draft = await loadDraftRecord(checkedId);
      if (!draft) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      if (draft.revision !== expectedRevision) {
        fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Maker draft changed in another tab.', 'DRAFT');
      }
      let document = draft.document;
      for (const command of commands) {
        document = applyMakerV8WorkspaceCommand(document, command);
      }
      return saveDraftBundleRecord({
        draftId: checkedId,
        expectedRevision,
        document,
        assetUpserts: structuredClone(assetUpserts),
        assetDeletes: structuredClone(assetDeletes),
        updatedAt: Number(now()),
      });
    },
    async replaceDraftDocument({ draftId, expectedRevision, document } = {}) {
      invalidateDraftPreviews();
      const checkedId = exactDraftId(draftId);
      const current = await loadDraftRecord(checkedId);
      if (!current) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      if (current.revision !== expectedRevision) {
        fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Maker draft changed in another tab.', 'DRAFT');
      }
      const checkedDocument = assertMakerV8Document(structuredClone(document), { mode: 'draft' });
      return saveDraftRecord({
        draftId: checkedId,
        expectedRevision,
        document: checkedDocument,
        updatedAt: Number(now()),
      });
    },
    async replaceDraftSnapshot({ draftId, expectedRevision, document, assets } = {}) {
      invalidateDraftPreviews();
      const id = exactDraftId(draftId);
      const checkedDocument = assertMakerV8Document(structuredClone(document), { mode: 'draft' });
      if (!Array.isArray(assets)) throw new TypeError('A complete draft asset snapshot is required.');
      const snapshot = structuredClone(assets);
      const current = await loadDraftRecord(id);
      if (!current || current.revision !== expectedRevision) {
        fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Maker draft changed in another tab.', 'DRAFT');
      }
      const currentAssets = await listDraftAssets(id);
      const wanted = new Set(snapshot.map(row => row.assetId));
      if (wanted.size !== snapshot.length) throw new TypeError('Draft snapshot has duplicate assets.');
      return saveDraftBundleRecord({ draftId: id, expectedRevision, document: checkedDocument,
        updatedAt: Number(now()),
        assetUpserts: snapshot.map(row => ({ assetId: row.assetId,
          expectedRevision: currentAssets.find(asset => asset.assetId === row.assetId)?.revision ?? null,
          kind: row.kind, mediaType: row.mediaType, bytesBase64: row.bytesBase64 })),
        assetDeletes: currentAssets.filter(row => !wanted.has(row.assetId))
          .map(row => ({ assetId: row.assetId, expectedRevision: row.revision })),
      });
    },
    async recoverDraftCopy({ sourceDraftId, draftId, document, assets } = {}) {
      const sourceId = exactDraftId(sourceDraftId);
      const targetId = exactDraftId(draftId);
      if (targetId === sourceId || !/^maker-recovery-[a-z0-9][a-z0-9_-]*$/.test(targetId)) {
        fail('MAKER_V8_PRODUCT_RECOVERY_ID_INVALID', 'Choose a new local recovery draft identifier.', 'DRAFT');
      }
      const checkedDocument = assertMakerV8Document(structuredClone(document), { mode: 'draft' });
      const contents = recoveryAssetContents(checkedDocument, structuredClone(assets), sourceId);
      let bundle;
      try {
        bundle = await createDraftBundleRecord({
          draftId: targetId, document: checkedDocument, assets: contents, createdAt: Number(now()),
        });
      } catch (error) {
        // An overlapping retry may have committed first. Only the store's exact
        // duplicate error permits this path; I/O and integrity failures propagate.
        if (error?.code !== 'MAKER_V8_DRAFT_EXISTS') throw error;
        bundle = await exportDraftRecord(targetId);
      }
      const draft = bundle?.draft;
      if (draft?.draftId !== targetId
        || canonicalMakerV8Json(draft.document) !== canonicalMakerV8Json(checkedDocument)
        || canonicalMakerV8Json(recoveryAssetContents(draft.document, bundle.assets, targetId))
          !== canonicalMakerV8Json(contents)) {
        fail('MAKER_V8_PRODUCT_RECOVERY_TARGET_MISMATCH', 'This recovery identifier already contains a different snapshot.', 'DRAFT');
      }
      return freeze({ draft, assets: bundle.assets });
    },
    async listDraftVersions({ draftId } = {}) {
      if (!listDraftVersionsRecord) {
        fail('MAKER_V8_PRODUCT_VERSION_HISTORY_UNAVAILABLE', 'Draft version history is unavailable.', 'DRAFT');
      }
      return listDraftVersionsRecord(exactDraftId(draftId));
    },
    async listMakerLineage({ draftId } = {}) {
      if (!loadMakerLineage) {
        fail('MAKER_V8_PRODUCT_LINEAGE_UNAVAILABLE', 'Onchain Maker lineage is unavailable.', 'DRAFT');
      }
      const draft = await loadDraftRecord(exactDraftId(draftId));
      if (!draft) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      await ensureReady();
      return loadMakerLineage({ makerKey: draft.document.lineage.makerKey });
    },
    async createSuccessorDraft({ draftId, expectedRevision, previousRootId } = {}) {
      invalidateDraftPreviews();
      if (!loadMakerLineage || !createSuccessorDraftRecord) {
        fail('MAKER_V8_PRODUCT_SUCCESSOR_UNAVAILABLE', 'Atomic Maker successor publication is unavailable.', 'DRAFT');
      }
      const sourceDraftId = exactDraftId(draftId);
      const rootId = typeof previousRootId === 'string' ? previousRootId.toLowerCase() : '';
      if (!EXACT_ID.test(rootId)) {
        fail('MAKER_V8_PRODUCT_SUCCESSOR_ROOT_INVALID', 'Choose one exact archived Maker Root.', 'DRAFT');
      }
      const source = await loadDraftRecord(sourceDraftId);
      if (!source) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      if (source.revision !== expectedRevision) {
        fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Maker draft changed in another tab.', 'DRAFT');
      }
      const account = await requireConnected();
      await ensureReady();
      const lineage = await loadMakerLineage({ makerKey: source.document.lineage.makerKey });
      const predecessor = lineage.find((entry) => entry.rootId === rootId);
      if (!predecessor || predecessor.lifecycle !== 'ARCHIVED'
        || predecessor.ownerAddress !== account.address
        || predecessor.successorRootId !== null) {
        fail(
          'MAKER_V8_PRODUCT_SUCCESSOR_PREDECESSOR_INVALID',
          'Successor creation requires your exact archived, unbranched Maker Root.',
          'DRAFT',
        );
      }
      const version = predecessor.makerVersion + 1;
      const document = structuredClone(source.document);
      document.lineage.version = version;
      document.lineage.previousRootId = predecessor.rootId;
      document.lineage.previousVersionCommitment = predecessor.versionCommitment;
      document.lineage.changelog = Array.isArray(document.lineage.changelog)
        ? [...document.lineage.changelog, `Version ${version} from archived Root ${predecessor.rootId}.`]
        : `${String(document.lineage.changelog || '').trim()}\nVersion ${version} from archived Root ${predecessor.rootId}.`.trim();
      assertMakerV8Document(document, { mode: 'draft' });
      const successorDraftId = `maker-successor-${rootId.slice(2)}`;
      const currentAccount = await requireConnected();
      if (currentAccount.address !== account.address) fail('MAKER_V8_PRODUCT_WALLET_CHANGED', 'Wallet changed during successor preparation.', 'WALLET');
      const resume = async () => {
        const existing = await loadDraftRecord(successorDraftId);
        if (!existing) return null;
        if (canonicalMakerV8Json(existing.document) !== canonicalMakerV8Json(document)) {
          fail('MAKER_V8_PRODUCT_SUCCESSOR_EXISTS', `A successor draft already exists: ${successorDraftId}. Open it from Library; the current draft is preserved.`, 'DRAFT');
        }
        const fresh = await loadDraftRecord(sourceDraftId);
        if (!fresh || fresh.revision !== expectedRevision) fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Source draft changed in another tab.', 'DRAFT');
        const assets = listDraftAssets ? await listDraftAssets(successorDraftId) : [];
        const sourceAssets = listDraftAssets ? await listDraftAssets(sourceDraftId) : [];
        const identity = rows => rows.map(({ draftId, revision, createdAt, updatedAt, ...asset }) => asset)
          .sort((a, b) => a.assetId.localeCompare(b.assetId));
        if (canonicalMakerV8Json(identity(assets)) !== canonicalMakerV8Json(identity(sourceAssets))) {
          fail('MAKER_V8_PRODUCT_SUCCESSOR_EXISTS', `Successor assets differ: open ${successorDraftId} from Library. No draft was overwritten.`, 'DRAFT');
        }
        if ((await requireConnected()).address !== account.address) fail('MAKER_V8_PRODUCT_WALLET_CHANGED', 'Wallet changed during successor preparation.', 'WALLET');
        return freeze({ draft: existing, assets });
      };
      const existing = await resume();
      if (existing) return existing;
      try { return await createSuccessorDraftRecord({
        sourceDraftId,
        sourceExpectedRevision: expectedRevision,
        draftId: successorDraftId,
        document,
        createdAt: Number(now()),
      }); } catch (error) {
        if (error?.code !== 'MAKER_V8_DRAFT_EXISTS') throw error;
        return await resume();
      }
    },
    async restoreDraftVersion({ draftId, expectedRevision, revision } = {}) {
      invalidateDraftPreviews();
      if (!restoreDraftVersionRecord) {
        fail('MAKER_V8_PRODUCT_VERSION_HISTORY_UNAVAILABLE', 'Draft version history is unavailable.', 'DRAFT');
      }
      return restoreDraftVersionRecord({
        draftId: exactDraftId(draftId),
        expectedRevision,
        revision,
        updatedAt: Number(now()),
      });
    },
    async upsertDraftAsset(input = {}) {
      invalidateDraftPreviews();
      if (!upsertDraftAsset) {
        fail('MAKER_V8_PRODUCT_ASSET_PERSISTENCE_REQUIRED', 'Maker asset persistence is unavailable.', 'DRAFT');
      }
      return upsertDraftAsset({ ...input, updatedAt: Number(now()) });
    },
    async previewMaker(input) {
      const draftId = typeof input?.makerId === 'string' && SAFE_DRAFT_ID.test(input.makerId)
        ? input.makerId : null;
      const current = draftId ? await loadDraftRecord(draftId) : null;
      const document = mergeProductFieldsIntoDocument(input, current?.document ?? null, now);
      const workspace = createMakerV8Workspace({ document });
      return freeze({ document, preview: workspace.preview(), issues: workspace.getState().issues });
    },
    async renderDraftPreview({ draftId, recipe, stylePreview } = {}) {
      const previewRecipe = recipe === undefined ? undefined : structuredClone(recipe);
      const preview = stylePreview === undefined ? undefined : structuredClone(stylePreview);
      if (preview && (Object.keys(preview).sort().join(',') !== 'expectedRevision,itemKey,partKey,styleKey,transform'
        || !Number.isSafeInteger(preview.expectedRevision) || preview.expectedRevision < 1
        || !['partKey', 'itemKey', 'styleKey'].every(key => typeof preview[key] === 'string' && preview[key]))) {
        throw new TypeError('A Style preview requires one exact draft revision and selection.');
      }
      if (!listDraftAssets) {
        fail(
          'MAKER_V8_PRODUCT_ASSET_PERSISTENCE_REQUIRED',
          'Creator preview requires durable bytes for every Maker asset.',
          'DRAFT',
        );
      }
      const checkedDraftId = exactDraftId(draftId);
      const generation = ++draftRenderGeneration;
      assertDraftPreviewCurrent(generation);
      const record = await loadDraftRecord(checkedDraftId);
      assertDraftPreviewCurrent(generation);
      if (!record) {
        fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      }
      let previewDocument = record.document;
      if (preview !== undefined) {
        if (!preview || preview.expectedRevision !== record.revision) throw new TypeError('The Style preview draft revision has changed.');
        previewDocument = structuredClone(record.document);
        const style = previewDocument.parts.find(row => row.key === preview.partKey)?.items.find(row => row.key === preview.itemKey)
          ?.styles.find(row => row.key === preview.styleKey);
        if (!style || !style.assetId || creatorStyleEditorState(style).positionLocked) {
          throw new TypeError('An unlocked saved PNG Style is required for a position preview.');
        }
        style.transform = exactCreatorTransform(preview.transform);
        assertMakerV8Document(previewDocument, { mode: 'draft' });
      }
      const assets = await listDraftAssets(checkedDraftId);
      assertDraftPreviewCurrent(generation);
      const authority = draftPreviewAuthority(record, assets);
      const confirmed = await loadDraftRecord(checkedDraftId);
      assertDraftPreviewCurrent(generation);
      const confirmedAssets = await listDraftAssets(checkedDraftId);
      assertDraftPreviewCurrent(generation);
      if (!confirmed || !sameDraftPreviewAuthority(
        authority,
        draftPreviewAuthority(confirmed, confirmedAssets),
      )) {
        fail('STALE_DRAFT_PREVIEW', 'The Creator draft changed while its preview was loading.', 'DRAFT');
      }
      const result = await renderDraftRecipe({
        document: previewDocument,
        assets,
        recipe: previewRecipe === undefined ? record.document.defaultRecipe : previewRecipe,
        ...renderingDependencies,
      });
      assertDraftPreviewCurrent(generation);
      const finalRecord = await loadDraftRecord(checkedDraftId);
      assertDraftPreviewCurrent(generation);
      const finalAssets = await listDraftAssets(checkedDraftId);
      assertDraftPreviewCurrent(generation);
      if (!finalRecord || !sameDraftPreviewAuthority(
        authority,
        draftPreviewAuthority(finalRecord, finalAssets),
      )) {
        fail('STALE_DRAFT_PREVIEW', 'The Creator draft changed while its preview was rendering.', 'DRAFT');
      }
      return exactPngRenderRecord(result, 'DRAFT');
    },
    async exportProject(input) {
      const candidate = input?.makerId && SAFE_DRAFT_ID.test(input.makerId)
        ? await loadDraftRecord(input.makerId) : null;
      if (!candidate) return freeze({ handled: false, project: structuredClone(input) });
      return freeze({ handled: true, project: await exportDraftRecord(candidate.draftId) });
    },
    async exportProjectZip({ makerId } = {}) {
      const candidate = await loadDraftRecord(exactDraftId(makerId));
      if (!candidate) fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Maker draft was not found.', 'DRAFT');
      const archive = encodeMakerV8ProjectZip(await exportDraftRecord(candidate.draftId));
      return freeze({
        fileName: `${candidate.draftId}.animacraft.zip`,
        mediaType: 'application/zip',
        byteLength: archive.byteLength,
        bytesBase64: toBase64(archive),
      });
    },
  };

  if (importDraftRecord) {
    bridge.importProject = async (bundle) => {
      invalidateDraftPreviews();
      return importDraftRecord(bundle);
    };
    bridge.importProjectZip = async ({ bytesBase64 } = {}) => {
      invalidateDraftPreviews();
      let archive;
      try {
        archive = fromBase64(bytesBase64);
        if (toBase64(archive) !== bytesBase64) throw new Error('noncanonical');
      } catch {
        fail('MAKER_V8_PRODUCT_PROJECT_ZIP_INVALID', 'Project ZIP bytes must use canonical Base64.', 'DRAFT');
      }
      return importDraftRecord(decodeMakerV8ProjectZip(archive));
    };
    if (replaceDraftBundleRecord) {
      bridge.replaceDraftFromProjectZip = async ({
        draftId, expectedRevision, bytesBase64,
      } = {}) => {
        invalidateDraftPreviews();
        let archive;
        try {
          archive = fromBase64(bytesBase64);
          if (toBase64(archive) !== bytesBase64) throw new Error('noncanonical');
        } catch {
          fail('MAKER_V8_PRODUCT_PROJECT_ZIP_INVALID', 'Project ZIP bytes must use canonical Base64.', 'DRAFT');
        }
        return replaceDraftBundleRecord({
          draftId: exactDraftId(draftId),
          expectedRevision,
          bundle: decodeMakerV8ProjectZip(archive),
          updatedAt: Number(now()),
        });
      };
    }
  }

  if (!deleteDraftRecord) delete bridge.deleteDraft;
  if (!saveDraftBundleRecord || !listDraftAssets) delete bridge.replaceDraftSnapshot;
  if (!upsertDraftAsset) delete bridge.upsertDraftAsset;
  if (!saveDraftBundleRecord) delete bridge.dispatchDraftTransaction;
  if (!listDraftVersionsRecord || !restoreDraftVersionRecord) {
    delete bridge.listDraftVersions;
    delete bridge.restoreDraftVersion;
  }

  if (publication) {
    const samePublicationContent = (left, right) => {
      const { attemptNonce: leftNonce, ...leftContent } = left;
      const { attemptNonce: rightNonce, ...rightContent } = right;
      return canonicalMakerV8Json(leftContent) === canonicalMakerV8Json(rightContent);
    };
    const hash = value => [...sha256(new TextEncoder().encode(canonicalMakerV8Json(value)))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const releaseIdentity = hash(assertMakerV8Runtime(productRuntime.runtime, { requireEnabled: true }));
    const stale = () => fail('MAKER_V8_PRODUCT_PUBLICATION_STALE',
      'The Maker, wallet or reviewed step changed. Open publication review again.', 'PUBLICATION');
    const checkGeneration = generation => { if (disposed || generation !== publicationGeneration) stale(); };
    const loadLive = async (draftId, expectedRevision) => {
      const account = await requireConnected();
      const record = await loadDraftRecord(exactDraftId(draftId));
      if (!record || record.revision !== expectedRevision) stale();
      const input = await transportInputForDraft(record, account.address);
      const reread = await loadDraftRecord(draftId);
      if (!reread || reread.revision !== record.revision
        || canonicalMakerV8Json(reread.document) !== canonicalMakerV8Json(record.document)) stale();
      return { account, record, input, contentSha256: hash(input) };
    };
    const bindingKey = (draftId, signer) => hash({ draftId, signer, releaseIdentity, network: 'mainnet' });
    // Upload IDs are wallet/content scoped across releases. Both old/new tabs
    // must share this lock even though their source bindings stay release-bound.
    const lockKey = signer => hash({ signer, network: 'mainnet' });
    const assertBinding = (binding, key) => {
      if (!binding || binding.key !== key || binding.scope.releaseIdentity !== releaseIdentity
        || binding.scope.contentSha256 !== hash(binding.input)
        || binding.input.signerAddress !== binding.scope.signerAddress
        || binding.input.attemptNonce !== `product-${binding.scope.draftId}-r${binding.scope.draftRevision}`) stale();
    };
    const assertLive = async review => {
      checkGeneration(review.generation);
      const live = await loadLive(review.dto.scope.draftId, review.currentSavedRevision);
      checkGeneration(review.generation);
      if (live.account.address !== review.dto.scope.signerAddress
        || live.contentSha256 !== review.currentContentSha256) stale();
      return live;
    };
    const projectReview = async (binding, live, generation) => {
      let transport = null, plan = null, identity = null, step = null;
      if (binding.attemptId) {
        ({ plan, identity } = await method(publication, 'inspect', 'publication')(binding.attemptId));
      } else {
        transport = await method(publicationTransport, 'prepareReview', 'publicationTransport')(binding.input);
        plan = transport.plan ?? null;
        if (plan) {
          binding = await publicationTransport.saveBinding(binding.key, binding.revision, { ...binding, attemptId: plan.attemptId });
          ({ plan, identity } = await method(publication, 'inspect', 'publication')(plan.attemptId));
        }
      }
      let status, stage, nextAction = null;
      if (plan) {
        if (plan.immutable?.signerAddress !== binding.scope.signerAddress) stale();
        status = plan.status === 'ACTIVE' ? plan.current?.outcome?.status ?? 'READY' : plan.status;
        stage = plan.current?.kind ?? (plan.status === 'COMPLETE' ? 'COMPLETE' : 'PUBLICATION');
        if (status === 'READY') {
          step = await method(publication, 'prepareReview', 'publication')(plan.attemptId);
          nextAction = step ? 'SIGN' : null;
        } else if (['SIGNED', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN'].includes(status)) {
          step = { id: plan.attemptId, revision: plan.revision, digest: plan.current.outcome.digest,
            stage, gasBudgetMist: null, gasPriceMist: null, storageEpochs: null,
            deletable: null, storageCostAtomic: null, relayTipMist: null };
          nextAction = 'CONTINUE';
        }
      } else {
        status = transport.status; stage = transport.stage;
        step = transport.step ?? null;
        if (status === 'TRANSPORT_SIGNATURE_REQUIRED' && step) nextAction = 'SIGN';
        if (status === 'TRANSPORT_RECOVERY_REQUIRED') {
          step = { id: transport.upload.uploadId, revision: transport.upload.revision,
            status: transport.upload.status, stage: transport.upload.stage,
            digest: transport.upload.transactionDigest, gasBudgetMist: null, gasPriceMist: null,
            storageEpochs: transport.upload.epochs, deletable: transport.upload.deletable,
            storageCostAtomic: null, relayTipMist: null };
          nextAction = 'CONTINUE';
        }
      }
      checkGeneration(generation);
      const scope = { ...binding.scope, currentSavedRevision: live.record.revision,
        publishingEarlierRevision: binding.scope.draftRevision !== live.record.revision,
        currentContentMatches: samePublicationContent(binding.input, live.input) };
      if (status === 'COMPLETE' && !scope.currentContentMatches) status = 'NEW_VERSION_REQUIRED';
      const publicAssets = projectPublicMakerV8Document(binding.input.document).assets;
      const totalResources = publicAssets.length + 2; // Living Content + assets + Manifest.
      const completedResources = plan ? totalResources : stage === 'LIVING_CONTENT' ? 0
        : stage === 'MANIFEST' ? totalResources - 1
          : stage === 'ASSET' && Number.isSafeInteger(transport.completedAssets)
            ? Math.min(totalResources - 1, 1 + Math.max(0, transport.completedAssets)) : null;
      const progress = { completed: completedResources, total: totalResources,
        currentKind: plan ? 'PUBLICATION' : stage, currentLabel: transport?.assetId ?? '',
        ...(!plan && stage === 'ASSET' && Number.isSafeInteger(transport?.assetCount) && transport.assetCount > 1
          ? { currentCount: transport.assetCount } : {}) };
      const reviewId = hash({ scope, generation, bindingRevision: binding.revision, step, status });
      const dto = freeze({ schemaVersion: 'animacraft.maker-v8-publication-review.v1',
        reviewId, scope, status, stage, nextAction, step, attemptId: plan?.attemptId ?? null,
        rootId: plan?.status === 'COMPLETE' && identity?.complete === true ? identity.rootId : null,
        makerVersion: identity?.makerVersion ?? binding.input.document.lineage.version,
        frozenMakerName: binding.input.document.metadata.name,
        assetCount: publicAssets.length,
        progress,
        message: status === 'NEW_VERSION_REQUIRED' ? 'The earlier saved revision is published. Current edits are unpublished. Open chain version history to explicitly archive the predecessor and create the next version.'
          : status === 'COMPLETE' ? 'This saved revision is published. Inspect the completed chain version.'
          : scope.publishingEarlierRevision ? 'Continue the previously reviewed saved version. Your newer draft is preserved.'
            : nextAction === 'SIGN' ? 'Review this exact transaction before opening the wallet.'
              : nextAction === 'CONTINUE' ? 'Continue the existing signed transaction. This can broadcast or upload its exact saved bytes.'
                : 'Publication requires review.' });
      const review = { dto, binding, generation, currentSavedRevision: live.record.revision,
        currentContentSha256: live.contentSha256, plan };
      await assertLive(review);
      publicationReview = review;
      activePublicationAttemptId = dto.attemptId;
      emit();
      return dto;
    };
    const prepareMakerPublication = async ({ draftId, expectedRevision } = {}) => {
      invalidatePublicationReview();
      const generation = publicationGeneration;
      const live = await loadLive(draftId, expectedRevision);
      checkGeneration(generation);
      const key = bindingKey(draftId, live.account.address);
      return publicationLock(lockKey(live.account.address), async () => {
        checkGeneration(generation);
        let binding = await method(publicationTransport, 'loadBinding', 'publicationTransport')(key);
        if (!binding || (!binding.started && binding.scope.contentSha256 !== live.contentSha256)) {
          if (binding?.attemptId) await method(publication, 'discardUnsigned', 'publication')(binding.attemptId);
          binding = await method(publicationTransport, 'saveBinding', 'publicationTransport')(key, binding?.revision ?? null, {
            scope: { draftId, draftRevision: live.record.revision, signerAddress: live.account.address,
              network: 'mainnet', releaseIdentity, contentSha256: live.contentSha256 },
            input: live.input, started: false, attemptId: null,
          });
        }
        assertBinding(binding, key);
        if (binding.scope.signerAddress !== live.account.address) stale();
        return projectReview(binding, live, generation);
      });
    };
    const act = async (input, action) => {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('MAKER_V8_PRODUCT_EXECUTION_DISABLED', 'Publication signing and broadcast are disabled.', 'PUBLICATION');
      }
      const review = publicationReview;
      if (!review || input?.reviewId !== review.dto.reviewId || review.dto.nextAction !== action) stale();
      publicationReview = null;
      return publicationLock(lockKey(review.dto.scope.signerAddress), async () => {
        const live = await assertLive(review);
        let binding = await publicationTransport.loadBinding(review.binding.key);
        assertBinding(binding, review.binding.key);
        if (!binding || binding.revision !== review.binding.revision) stale();
        // Claim the exact source snapshot before prompting, so a crash/reload or
        // a later edit cannot start a replacement Maker from a newer revision.
        if (!binding.started) binding = await publicationTransport.saveBinding(binding.key, binding.revision,
          { ...binding, started: true });
        const check = async () => { await assertLive(review); };
        if (action === 'SIGN') {
          try {
            const result = review.plan
              ? await method(publication, 'signReviewed', 'publication')(review.dto.attemptId, review.dto.step, check)
              : await method(publicationTransport, 'signReviewed', 'publicationTransport')(review.dto.step, check);
            if (!review.binding.started && result?.current?.outcome?.status === 'READY') {
              binding = await publicationTransport.saveBinding(binding.key, binding.revision, { ...binding, started: false });
            }
          } catch (error) {
            const rejected = error?.definitiveRejection === true && error?.signedArtifactCreated === false
              || isDefinitiveWalletStandardRejectionV8(error);
            // Only a proven first-prompt rejection releases the unsigned source
            // binding. Unknown failures and any earlier signature stay pinned.
            if (!review.binding.started && rejected) {
              await publicationTransport.saveBinding(binding.key, binding.revision, { ...binding, started: false });
            }
            throw error;
          }
        } else if (review.plan) {
          const current = await method(publication, 'inspect', 'publication')(review.dto.attemptId);
          if (current.plan.revision !== review.dto.step.revision) stale();
          await check();
          await method(publication, 'replayExact', 'publication')(review.dto.attemptId);
        } else {
          await check();
          await method(publicationTransport, 'continueReviewed', 'publicationTransport')(review.dto.step);
        }
        checkGeneration(review.generation);
        return projectReview(binding, live, review.generation);
      });
    };
    Object.assign(bridge, {
      prepareMakerPublication,
      inspectMakerPublication: prepareMakerPublication,
      signMakerPublication: input => act(input, 'SIGN'),
      continueMakerPublication: input => act(input, 'CONTINUE'),
      cancelMakerPublicationReview: invalidatePublicationReview,
      async getPublishedMaker({ draftId } = {}) {
        const account = await requireConnected();
        const key = bindingKey(exactDraftId(draftId), account.address);
        const binding = await method(publicationTransport, 'loadBinding', 'publicationTransport')(key);
        if (!binding?.attemptId) return null;
        assertBinding(binding, key);
        const identity = await method(publication, 'lookupFinalized', 'publication')(binding.attemptId);
        const record = await loadDraftRecord(draftId);
        const currentContentMatches = record ? samePublicationContent(binding.input,
          await transportInputForDraft(record, account.address)) : false;
        const confirmed = await requireConnected();
        if (confirmed.address !== account.address) stale();
        return identity?.complete ? freeze({ ...identity, scope: { ...binding.scope,
          currentSavedRevision: record?.revision ?? null, currentContentMatches } }) : null;
      },
    });
  }

  if (lifecycle) {
    const archiveSources = new WeakMap();
    const sourceProof = async ({ draftId, expectedRevision, rootId }) => {
      const generation = publicationGeneration;
      const account = await requireConnected();
      const record = await loadDraftRecord(exactDraftId(draftId));
      if (!record || record.revision !== expectedRevision) fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Save the exact current draft before archiving.', 'DRAFT');
      assertMakerV8Document(record.document, { mode: 'compile' });
      if (!listDraftAssets || !loadMakerLineage) fail('MAKER_V8_PRODUCT_SUCCESSOR_UNAVAILABLE', 'Successor source verification is unavailable.', 'DRAFT');
      const assets = recoveryAssetContents(record.document, await listDraftAssets(draftId), draftId);
      const lineage = await loadMakerLineage({ makerKey: record.document.lineage.makerKey });
      const predecessor = lineage.find(row => row.rootId === rootId);
      if (!predecessor || predecessor.ownerAddress !== account.address || predecessor.successorRootId !== null
        || !['ACTIVE', 'PAUSED'].includes(predecessor.lifecycle)) fail('MAKER_V8_PRODUCT_SUCCESSOR_PREDECESSOR_INVALID', 'Archive requires your exact unbranched published predecessor.', 'DRAFT');
      const fresh = await loadDraftRecord(draftId);
      if (disposed || generation !== publicationGeneration || fresh?.revision !== expectedRevision || canonicalMakerV8Json(fresh.document) !== canonicalMakerV8Json(record.document)
        || (await requireConnected()).address !== account.address) fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Source or wallet changed during archive review.', 'DRAFT');
      return canonicalMakerV8Json({ generation, signer: account.address, draftId, expectedRevision, rootId, document: record.document, assets });
    };
    const getSnapshot = method(lifecycle, 'getSnapshot', 'lifecycle', { optional: true });
    const build = method(lifecycle, 'build', 'lifecycle');
    const prepare = method(lifecycle, 'prepare', 'lifecycle');
    const requestSignature = method(lifecycle, 'requestSignature', 'lifecycle');
    const recover = method(lifecycle, 'recover', 'lifecycle');
    const recoverByRoot = method(lifecycle, 'recoverByRoot', 'lifecycle', { optional: true });
    if (getSnapshot) bridge.getLifecycleSnapshot = async (input) => {
      await requireConnected();
      return getSnapshot(input);
    };
    bridge.prepareLifecycleAction = async (input) => {
      await requireConnected();
      const source = input?.action === 'ARCHIVE' && input.draftId ? await sourceProof(input) : null;
      const prepared = await prepare(await build(input));
      if (source !== null) {
        if (await sourceProof(input) !== source) fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Archive source changed.', 'DRAFT');
        archiveSources.set(prepared, { input: structuredClone(input), source });
      }
      return prepared;
    };
    bridge.requestLifecycleSignature = async (prepared) => {
      await requireConnected();
      const guarded = archiveSources.get(prepared);
      if (guarded && await sourceProof(guarded.input) !== guarded.source) fail('MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH', 'Current document or assets changed after archive review.', 'DRAFT');
      return requestSignature(prepared);
    };
    bridge.recoverLifecycleAction = async (input) => {
      if (recoverByRoot && input?.rootId && input?.action && !input?.recoveryId) {
        const account = await requireConnected();
        return recoverByRoot({
          action: input.action,
          rootId: input.rootId,
          signer: account.address,
        });
      }
      return recover(input);
    };
  }

  if (player) {
    const readPlayerSnapshot = method(player, 'getSnapshot', 'player');
    const loadExactPlayer = method(player, 'loadPlayer', 'player');
    const setExactPlayerRecipe = method(player, 'setRecipe', 'player');
    const updateExactPlayerRecipe = method(player, 'updateRecipe', 'player');
    const resetExactPlayerRecipe = method(player, 'resetRecipe', 'player');
    const decryptProtectedSelection = method(
      player,
      'decryptProtectedSelection',
      'player',
      { optional: true },
    );
    const livePlayerContext = async ({ snapshot, ownership, assertConsumerCurrent = null }) => {
      const { generation, rootId, context } = ownership ?? {};
      const expectedWalletIdentity = context?.walletIdentity ?? null;
      if (!ownsActivePlayerContext(ownership)) {
        fail('STALE_PLAYER_SESSION', 'A newer Player context replaced this authority read.', 'PLAYER');
      }
      const refreshGeneration = ++playerContextRefreshGeneration;
      const assertRefreshCurrent = () => {
        assertConsumerCurrent?.();
        assertPlayerSessionCurrent(generation, expectedWalletIdentity);
        if (refreshGeneration !== playerContextRefreshGeneration
          || !ownsActivePlayerContext(ownership)
          || activePlayerContext.rootId !== rootId) {
          fail('STALE_PLAYER_SESSION', 'A newer live Player authority read replaced this work.', 'PLAYER');
        }
      };
      try {
        assertRefreshCurrent();
        const before = exactPlayerPreviewAuthority(snapshot);
        if (context.rootId !== before.rootId
          || context.rootContentCommitment !== before.rootContentCommitment) {
          fail('STALE_PLAYER_SESSION', 'The active Player context differs from its exact Recipe.', 'PLAYER');
        }

        const live = await loadPlayer(before.rootId);
        assertRefreshCurrent();
        if (live?.status !== 'READY' || live.player?.rootId !== before.rootId
          || live.player?.lifecycle !== 'ACTIVE'
          || String(live.player?.makerVersion ?? '') !== before.makerVersion
          || live.player?.evidence?.contentCommitment !== before.rootContentCommitment) {
          fail('STALE_PLAYER_SESSION', 'The certified Maker Root is no longer the exact active Player authority.', 'PLAYER');
        }

        const account = await readWallet();
        assertRefreshCurrent();
        let contextualChoices = null;
        if (loadContextualChoices && account.status === 'connected') {
          const loaded = await loadContextualChoices({
            address: account.address,
            rootId: before.rootId,
          });
          assertRefreshCurrent();
          contextualChoices = assertContextualChoices(loaded, {
            address: account.address,
            rootId: before.rootId,
          });
        }

        const confirmed = await readPlayerSnapshot();
        assertRefreshCurrent();
        const after = exactPlayerPreviewAuthority(confirmed);
        if (!samePlayerPreviewAuthority(before, after)) {
          fail('STALE_PLAYER_SESSION', 'Player Recipe or Loadout changed during its live authority read.', 'PLAYER');
        }
        const confirmedAccount = await readWallet();
        assertRefreshCurrent();
        if (walletIdentity(confirmedAccount) !== walletIdentity(account)) {
          fail('STALE_PLAYER_SESSION', 'Wallet identity changed during the live Player authority read.', 'PLAYER');
        }
        const nextContext = freeze({
          generation,
          rootId: after.rootId,
          rootContentCommitment: after.rootContentCommitment,
          makerVersion: after.makerVersion,
          recipeCommitment: after.recipeCommitment,
          walletAddress: account.status === 'connected' ? account.address : null,
          walletIdentity: expectedWalletIdentity,
          canvas: structuredClone(confirmed.player.document?.canvas ?? null),
          contextualChoices,
        });
        assertRefreshCurrent();
        activePlayerContext = nextContext;
        return freeze({
          snapshot: contextualChoices ? freeze({
            ...structuredClone(confirmed),
            player: mergeContextualChoices(confirmed.player, contextualChoices),
          }) : freeze(structuredClone(confirmed)),
          authority: after,
          context: nextContext,
          contextualJson: contextualChoices === null
            ? 'null' : canonicalMakerV8Json(contextualChoices),
        });
      } catch (error) {
        // A replaced render must neither install its late read nor invalidate
        // the context already captured by its successor before that read began.
        try { assertConsumerCurrent?.(); } catch { throw error; }
        if (refreshGeneration === playerContextRefreshGeneration) {
          invalidateOwnedPlayerContext(ownership);
        }
        throw error;
      }
    };
    bridge.getPlayerSnapshot = async (...args) => {
      // A recipe read takes precedence over pixels for the previous recipe.
      // Cancel that render before awaiting: otherwise its post-render authority
      // check can supersede this read and reject the user's current edit.
      invalidatePlayerRender();
      const ownership = capturePlayerContextOwnership();
      const snapshot = await readPlayerSnapshot(...args);
      if (!ownership) return snapshot;
      return (await livePlayerContext({
        snapshot,
        ownership,
      })).snapshot;
    };
    bridge.openPlayerSession = async ({ rootId } = {}) => {
      const checkedRootId = typeof rootId === 'string' ? rootId.toLowerCase() : '';
      if (!EXACT_ID.test(checkedRootId)) {
        fail('MAKER_V8_PRODUCT_PLAYER_ROOT_INVALID', 'Choose one exact certified Maker Root.', 'PLAYER');
      }
      invalidatePlayerSession();
      const generation = playerSessionGeneration;
      await ensureReady();
      assertPlayerSessionCurrent(generation);
      const account = await readWallet();
      assertPlayerSessionCurrent(generation);
      const expectedWalletIdentity = walletIdentity(account);
      const snapshot = await loadExactPlayer(checkedRootId);
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      if (snapshot?.status !== 'READY' || snapshot?.player?.rootId !== checkedRootId
        || !snapshot.recipe || !snapshot.loadout) {
        const diagnostic = snapshot?.diagnostics?.[0] ?? snapshot?.lastError;
        fail(
          diagnostic?.code ?? 'MAKER_V8_PRODUCT_PLAYER_UNAVAILABLE',
          diagnostic?.message ?? 'The selected certified Maker cannot open in Player.',
          diagnostic?.layer ?? 'PLAYER',
        );
      }
      const identity = readyPlayerSnapshotIdentity(snapshot);
      if (identity.rootId !== checkedRootId) {
        fail(
          'MAKER_V8_PRODUCT_PLAYER_ROOT_DRIFT',
          'The opened Player session differs from the selected certified Maker Root.',
          'PLAYER',
        );
      }
      const playerView = await attachContextualChoices(snapshot.player, {
        account,
        generation,
        expectedWalletIdentity,
      });
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      const confirmedAccount = await readWallet();
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      if (walletIdentity(confirmedAccount) !== expectedWalletIdentity) {
        fail('STALE_PLAYER_SESSION', 'Wallet identity changed while opening Player.', 'PLAYER');
      }
      activePlayerContext = freeze({
        generation,
        rootId: identity.rootId,
        rootContentCommitment: identity.rootContentCommitment,
        walletAddress: account.status === 'connected' ? account.address : null,
        walletIdentity: expectedWalletIdentity,
        canvas: structuredClone(playerView.document?.canvas ?? null),
        contextualChoices: playerView.contextualChoices
          ? freeze(structuredClone(playerView.contextualChoices)) : null,
      });
      return freeze({
        schemaVersion: MAKER_V8_PRODUCT_PLAYER_SESSION_SCHEMA,
        status: 'READY',
        rootId: checkedRootId,
        player: playerView,
        recipe: structuredClone(snapshot.recipe),
        loadout: structuredClone(snapshot.loadout),
        execution: structuredClone(snapshot.execution),
      });
    };
    // Preview and export share the live authority reader: newest render wins.
    // Separate lanes here would race its context ownership/refresh generation.
    const renderCurrentPlayer = async ({ rootId, exportInput, exporting = false } = {}) => {
      const checkedRootId = typeof rootId === 'string' ? rootId.toLowerCase() : '';
      let ownership = capturePlayerContextOwnership();
      const context = ownership?.context;
      if (!EXACT_ID.test(checkedRootId) || !context || ownership.rootId !== checkedRootId) {
        fail('STALE_PLAYER_SESSION', 'Open this exact certified Maker in Player before rendering.', 'PLAYER');
      }
      // Capture caller intent before any asynchronous authority or media read.
      // Invalid options must not cancel an already valid in-flight preview.
      const exportOptions = exporting ? exactMakerV8ExportOptions(context.canvas, exportInput) : null;
      const exportTarget = exporting ? makerV8ExportSizes(context.canvas)[exportOptions.sizeMode] : null;
      const assertExportCanvas = (snapshot) => {
        if (exporting && (snapshot.player.document?.canvas?.width !== context.canvas.width
          || snapshot.player.document?.canvas?.height !== context.canvas.height)) {
          fail('STALE_PLAYER_SESSION', 'Player canvas changed while its export was rendering.', 'PLAYER');
        }
      };
      const generation = ownership.generation;
      const expectedWalletIdentity = context.walletIdentity;
      invalidatePlayerRender();
      const renderGeneration = playerRenderGeneration;
      const controller = new AbortController();
      playerRenderController = controller;
      const assertCurrent = () => {
        assertPlayerRenderCurrent(generation, renderGeneration, expectedWalletIdentity);
        controller.signal.throwIfAborted();
      };
      const decryptCurrentSelection = decryptProtectedSelection ? async (input) => {
        assertCurrent();
        const bytes = await decryptProtectedSelection({ ...input, signal: controller.signal });
        try { assertCurrent(); } catch (error) {
          if (bytes instanceof Uint8Array) bytes.fill(0);
          throw error;
        }
        return bytes;
      } : null;
      try {
        assertCurrent();
        const snapshot = await readPlayerSnapshot();
        assertCurrent();
        const before = await livePlayerContext({
          snapshot,
          ownership,
          assertConsumerCurrent: assertCurrent,
        });
        ownership = freeze({
          context: before.context,
          generation: before.context.generation,
          rootId: before.context.rootId,
        });
        assertCurrent();
        assertExportCanvas(before.snapshot);
        const result = await renderPlayerRecipe({
          player: before.snapshot.player,
          recipe: before.snapshot.recipe,
          signer: before.context.walletAddress,
          productRuntime,
          ...renderingDependencies,
          exportOptions,
          decryptProtectedSelection: decryptCurrentSelection,
        });
        assertCurrent();
        const afterSnapshot = await readPlayerSnapshot();
        assertCurrent();
        const after = await livePlayerContext({
          snapshot: afterSnapshot,
          ownership,
          assertConsumerCurrent: assertCurrent,
        });
        assertCurrent();
        assertExportCanvas(after.snapshot);
        if (!samePlayerPreviewAuthority(before.authority, after.authority)
          || before.contextualJson !== after.contextualJson) {
          fail('STALE_PLAYER_SESSION', 'Player authority changed while its preview was rendering.', 'PLAYER');
        }
        const record = exactPngRenderRecord(result, 'PLAYER');
        if (exportTarget && (record.width !== exportTarget.width || record.height !== exportTarget.height)) {
          fail('MAKER_V8_PLAYER_EXPORT_SIZE_MISMATCH', 'Rendered export dimensions differ from the requested size.', 'PLAYER');
        }
        return record;
      } finally {
        controller.abort();
        if (playerRenderController === controller) playerRenderController = null;
      }
    };
    bridge.renderPlayerPreview = ({ rootId } = {}) => renderCurrentPlayer({ rootId });
    bridge.renderPlayerExport = ({ rootId, exportOptions } = {}) => renderCurrentPlayer({
      rootId, exportInput: exportOptions, exporting: true,
    });
    const mutatePlayerRecipe = async (mutation, args) => {
      invalidatePlayerRender();
      let ownership = capturePlayerContextOwnership();
      const context = ownership?.context;
      if (!ownership) return mutation(...args);
      const generation = ownership.generation;
      const expectedWalletIdentity = context.walletIdentity;
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      const beforeSnapshot = await readPlayerSnapshot();
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      const before = await livePlayerContext({ snapshot: beforeSnapshot, ownership });
      ownership = freeze({
        context: before.context,
        generation: before.context.generation,
        rootId: before.context.rootId,
      });
      let result;
      try {
        result = await mutation(...args);
      } finally {
        // A preview that began during the controller mutation is stale too.
        invalidatePlayerRender();
      }
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      const afterSnapshot = await readPlayerSnapshot();
      assertPlayerSessionCurrent(generation, expectedWalletIdentity);
      await livePlayerContext({ snapshot: afterSnapshot, ownership });
      return result;
    };
    bridge.setPlayerRecipe = (...args) => mutatePlayerRecipe(setExactPlayerRecipe, args);
    bridge.updatePlayerRecipe = (...args) => mutatePlayerRecipe(updateExactPlayerRecipe, args);
    bridge.resetPlayerRecipe = (...args) => mutatePlayerRecipe(resetExactPlayerRecipe, args);
    bridge.preparePlayerAction = method(player, 'preparePlayerAction', 'player');
    bridge.executePlayerAction = method(player, 'executePlayerAction', 'player');
    bridge.recoverPlayerAction = method(player, 'recoverPlayerAction', 'player');
    if (typeof player.recoverActivePlayerAction === 'function') {
      bridge.recoverActivePlayerAction = method(player, 'recoverActivePlayerAction', 'player');
    }
    bridge.getPlayerAction = method(player, 'getPlayerAction', 'player');
    if (typeof player.getPendingPlayerAction === 'function') {
      bridge.getPendingPlayerAction = method(player, 'getPendingPlayerAction', 'player');
    }
  }

  if (playerJourney) {
    const complete = method(playerJourney, 'complete', 'playerJourney');
    if (typeof playerJourney.openReception === 'function') bridge.openPlayerReception = ({ rootId }) => {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('MAKER_V8_PRODUCT_EXECUTION_DISABLED', 'Character completion is not enabled for this release.', 'PLAYER');
      }
      if (wallet.status !== 'connected') {
        fail('MAKER_V8_PRODUCT_WALLET_REQUIRED', 'Connect a Sui Mainnet wallet first.', 'WALLET');
      }
      // Cached wallet identity only scopes the popup, never authorizes writes.
      // complete/production provider independently reread the wallet after await.
      return playerJourney.openReception({ rootId, signer: wallet.address });
    };
    if (typeof playerJourney.exportEnvelopeRecovery === 'function') bridge.exportPlayerEnvelopeRecovery = async ({ rootId }) => {
      const account = await requireConnected();
      const result = await playerJourney.exportEnvelopeRecovery({ rootId, signer: account.address });
      if ((await requireConnected()).address !== account.address) {
        fail('MAKER_V8_PRODUCT_WALLET_CHANGED', 'Wallet changed while reading recovery.', 'WALLET');
      }
      return result;
    };
    bridge.completePlayerJourney = async (input, { confirmStep, signal, startNew = false, newCompletionFrom, recoveryJson } = {}) => {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail(
          'MAKER_V8_PRODUCT_EXECUTION_DISABLED',
          'Character completion is not enabled for this release.',
          'PLAYER',
        );
      }
      const account = await requireConnected();
      const confirmationGeneration = playerSessionGeneration;
      return complete({ ...input, signer: account.address }, {
        signal, recoveryJson, startNew: startNew === true, newCompletionFrom: newCompletionFrom == null ? undefined : structuredClone(newCompletionFrom),
        confirmStep: typeof confirmStep !== 'function' ? undefined : async (step) => {
          signal?.throwIfAborted();
          const current = await requireConnected();
          assertPlayerSessionCurrent(confirmationGeneration);
          if (current.address !== account.address || step?.signer !== account.address
            || step.rootId !== input.rootId) {
            fail('MAKER_V8_PRODUCT_WALLET_CHANGED', 'Completion confirmation belongs to another wallet or Maker.', 'WALLET');
          }
          const confirmed = await confirmStep(step);
          signal?.throwIfAborted();
          if ((await requireConnected()).address !== account.address) {
            fail('MAKER_V8_PRODUCT_WALLET_CHANGED', 'Wallet changed during completion confirmation.', 'WALLET');
          }
          assertPlayerSessionCurrent(confirmationGeneration);
          return confirmed;
        },
      });
    };
  }

  if (pack) {
    const createPackDraft = method(pack, 'createPackDraft', 'pack');
    const listPackDrafts = method(pack, 'list', 'pack', { optional: true });
    const upsertPackAsset = method(pack, 'upsertAsset', 'pack', { optional: true });
    const loadPackDraft = method(pack, 'load', 'pack');
    const preparePackPublication = method(pack, 'preparePublication', 'pack', { optional: true });
    const resumePackPublication = method(pack, 'resumePublication', 'pack');
    const signPackPublication = method(pack, 'requestPublicationSignature', 'pack');
    const recoverPackPublication = method(pack, 'recoverPublicationOutcome', 'pack');
    const replayPackPublication = method(pack, 'replayPackPublication', 'pack');
    bridge.createPackDraft = async (input = {}) => {
      if (input.rootId && input.makerDraftId) {
        fail('MAKER_V8_PRODUCT_PACK_PARENT_AMBIGUOUS', 'Choose one local or published parent.', 'PACK');
      }
      if (input.rootId) return createPackDraft(input);
      if (!input.makerDraftId) return createPackDraft(input);
      const makerDraftId = exactDraftId(input.makerDraftId);
      const makerDraft = await loadDraftRecord(makerDraftId);
      if (!makerDraft) {
        fail('MAKER_V8_PRODUCT_DRAFT_NOT_FOUND', 'Open the Maker that owns this Pack.', 'PACK');
      }
      const account = await requireConnected();
      const parent = await exportDraftRecord(makerDraftId);
      if ((await requireConnected()).address !== account.address) {
        fail('MAKER_V8_PRODUCT_WALLET_CHANGED', 'Wallet changed while capturing the Pack parent.', 'WALLET');
      }
      return createPackDraft({ ...input, parent });
    };
    if (listPackDrafts) bridge.listPackDrafts = listPackDrafts;
    bridge.loadPackDraft = loadPackDraft;
    const loadPackPreview = method(pack, 'loadPreview', 'pack', { optional: true });
    if (loadPackPreview) bridge.renderPackPreview = async ({ draftId, selection } = {}) => {
      const selected = selection === undefined ? null : structuredClone(selection);
      const account = await requireConnected();
      const { draft, document, assets } = await loadPackPreview(exactDraftId(draftId));
      const parent = draft?.document.authoringParent ?? draft?.document.bindings.parent;
      if (!draft || draft.document.author.address !== account.address
        || !parent) {
        fail('MAKER_V8_PRODUCT_PACK_PARENT_UNAVAILABLE', 'Open a Pack with captured parent artwork owned by this wallet.', 'PACK');
      }
      // The Studio authenticates captured parent + owned bytes, never the live Maker.
      const bindingJson = canonicalMakerV8Json(draft.document.bindings);
      const recipe = structuredClone(document.defaultRecipe);
      if (selected) {
        if (Object.keys(selected).sort().join(',') !== 'itemKey,partKey,styleKey'
          || !document.parts.find(part => part.key === selected.partKey)?.items
            .find(item => item.key === selected.itemKey)?.styles.some(style => style.key === selected.styleKey)) {
          fail('MAKER_V8_PACK_PREVIEW_SELECTION_INVALID', 'Select one existing Pack workspace Style.', 'PACK');
        }
        const index = recipe.selections.findIndex(row => row.partKey === selected.partKey);
        if (index < 0) recipe.selections.push(selected); else recipe.selections[index] = selected;
      }
      const ruleIssue = makerV8RuleIssue(document.rules, recipe.selections);
      if (ruleIssue) fail(ruleIssue.code, ruleIssue.message, 'PACK');
      const result = await renderDraftRecipe({ document, assets, recipe, ...renderingDependencies });
      const confirmed = await loadPackDraft(draft.draftId);
      if (disposed || (await requireConnected()).address !== account.address
        || !confirmed || confirmed.revision !== draft.revision || confirmed.document.author.address !== account.address
        || canonicalMakerV8Json(confirmed.document.bindings) !== bindingJson
        || (confirmed.document.authoringParent ?? confirmed.document.bindings.parent)?.draftSha256 !== parent.draftSha256) {
        fail('STALE_PACK_PREVIEW', 'The Pack parent or wallet changed while rendering.', 'PACK');
      }
      return exactPngRenderRecord(result, 'DRAFT');
    };
    bridge.savePackDraft = method(pack, 'save', 'pack');
    const bindPackParent = method(pack, 'bindPublishedParent', 'pack', { optional: true });
    if (bindPackParent) bridge.bindPackParent = bindPackParent;
    if (upsertPackAsset) bridge.upsertPackAsset = upsertPackAsset;
    bridge.previewPack = method(pack, 'preview', 'pack');
    bridge.exportPack = method(pack, 'export', 'pack');
    bridge.resumePackPublication = resumePackPublication;
    bridge.requestPackPublicationSignature = signPackPublication;
    bridge.recoverPackPublicationOutcome = recoverPackPublication;
    bridge.replayPackPublication = replayPackPublication;
    if (preparePackPublication) bridge.continuePackPublication = async ({ draftId } = {}) => {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('MAKER_V8_PRODUCT_EXECUTION_DISABLED', 'Expansion Pack publishing is not enabled for this release.', 'PACK');
      }
      await requireConnected();
      let draft = await loadPackDraft(draftId);
      if (!draft) fail('MAKER_V8_PRODUCT_PACK_NOT_FOUND', 'Open and save this Expansion Pack first.', 'PACK');
      let result;
      if (draft.publication?.status === 'UNPREPARED') {
        result = await preparePackPublication({
          draftId: draft.draftId,
          expectedRevision: draft.revision,
        });
        draft = result.draft ?? result;
      }
      if (draft.publication?.status === 'READY') {
        result = await signPackPublication({
          draftId: draft.draftId,
          expectedRevision: draft.revision,
        });
        draft = result.draft ?? result;
      }
      if (['ACTIVE', 'OUTCOME_UNKNOWN'].includes(draft.publication?.status)) {
        result = await resumePackPublication({
          draftId: draft.draftId,
          attemptId: draft.publication.attemptId,
          expectedRevision: draft.revision,
        });
        draft = result.draft ?? result;
      }
      if (result?.plan?.status === 'ACTIVE'
        && result.plan.current?.outcome?.status === 'OUTCOME_PENDING') {
        result = await replayPackPublication({
          draftId: draft.draftId,
          expectedRevision: draft.revision,
        });
        draft = result.draft ?? result;
      }
      return freeze({
        ...(plain(result) ? result : {}),
        draft,
        status: draft.publication?.status ?? 'UNPREPARED',
        message: draft.publication?.status === 'COMPLETE'
          ? 'Expansion Pack published.'
          : 'Pack release progress was saved. Continue here after the transaction settles.',
      });
    };
    bridge.performPackLifecycle = method(pack, 'performLifecycle', 'pack');
  }

  if (composable) {
    if (typeof composable.stage === 'function' && typeof composable.list === 'function') {
      const operationActions = ['MINT_ITEM', 'ADMIT_OPEN', 'ADMIT_CERTIFIED', 'REVOKE_ADMISSION', 'PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL'];
      bridge.listComposableOperations = async () => {
        const account = await requireConnected(), result = await composable.list();
        if (result.address !== account.address || (await requireConnected()).address !== account.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed while reading Item operations.', 'COMPOSABLE');
        return { address: account.address, rows: result.rows.filter(row => operationActions.includes(row.request.action)) };
      };
      bridge.stageComposableOperation = async request => {
        const account = await requireConnected();
        if (!operationActions.includes(request?.action) || request.signer !== account.address) fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Reviewed request differs.', 'COMPOSABLE');
        return composable.stage(request);
      };
      bridge.continueComposableOperation = async ({ requestId, action, mode }) => {
        if (!operationActions.includes(action)) fail('MAKER_V8_COMPOSABLE_INPUT_INVALID', 'Unsupported operation.', 'COMPOSABLE');
        if (!gates.allowWalletSignature || !gates.allowBroadcast) fail('MAKER_V8_PRODUCT_EXECUTION_DISABLED', 'Composable signing and broadcast are disabled.', 'COMPOSABLE');
        await requireConnected();
        const saved = await composable.load({ requestId, action });
        if (!saved || saved.status !== 'ACTIVE') fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Item operation is missing or terminal. Read its current state.', 'COMPOSABLE');
        if (mode === 'SIGN' && !saved.ticket) return composable.prepare(saved.request);
        if (mode === 'RECOVER' && saved.ticket) return composable.recover(saved.ticket);
        fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Item operation changed. Read its current state.', 'COMPOSABLE');
      };
    }
    if (composableTransport && typeof composable.load === 'function') {
      bridge.createComposableUploadProduct = async ({ uploadId }) => {
        if (!gates.allowWalletSignature || !gates.allowBroadcast) {
          fail('MAKER_V8_PRODUCT_EXECUTION_DISABLED', 'Composable signing and broadcast are disabled.', 'COMPOSABLE');
        }
        await requireConnected();
        const prior = await composable.load({ requestId: uploadId, action: 'CREATE_PRODUCT' });
        if (prior?.ticket) return prior.ticket;
        // Existing unsigned plans keep their exact authority snapshot. The engine
        // rechecks fresh authority before signing; never create a second attempt.
        return prepareComposable(prior?.request || await bridge.reviewComposableUpload({ uploadId }));
      };
      bridge.loadComposableUploadProduct = async ({ uploadId }) => {
        await requireConnected();
        const prior = await composable.load({ requestId: uploadId, action: 'CREATE_PRODUCT' });
        return prior ? { status: prior.status, ticket: prior.ticket, readback: prior.readback } : null;
      };
    }
    if (composableTransport) bridge.advanceComposableUpload = async input => {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('MAKER_V8_PRODUCT_EXECUTION_DISABLED', 'Composable upload signing and broadcast are disabled.', 'COMPOSABLE');
      }
      await requireConnected();
      return composableTransport.advance(input);
    };
    if (composableTransport) bridge.listComposableUploads = async () => {
      await requireConnected();
      const history = await composableTransport.history();
      const rows = await Promise.all(history.rows.map(async row => {
        if (row.status !== 'COMPLETE' || !bridge.loadComposableUploadProduct) return row;
        try { return { ...row, productAttempt: await bridge.loadComposableUploadProduct({ uploadId: row.uploadId }) }; }
        catch (error) { return { ...row, productError: String(error?.message || error) }; }
      }));
      if ((await requireConnected()).address !== history.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed during upload history.', 'COMPOSABLE');
      return { ...history, rows };
    };
    if (composableTransport) bridge.prepareComposableStorage = async (input) => {
      const account = await requireConnected();
      if (input?.binding?.address !== account.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet differs from external artwork.', 'COMPOSABLE');
      return composableTransport.prepare(input);
    };
    bridge.listComposableMakers = async () => {
      await requireConnected();
      const result = await loadPlaza();
      if (!['READY', 'EMPTY'].includes(result?.status) || !Array.isArray(result.makers)
        || result.diagnostics?.length) {
        fail('MAKER_V8_COMPOSABLE_CATALOG_INCOMPLETE', 'Published Makers could not be read completely.', 'COMPOSABLE');
      }
      return freeze(result.makers.map(row => freeze({ rootId: row.id, title: row.title })));
    };
    bridge.getComposableMaker = async ({ rootId }) => {
      await requireConnected();
      const result = await loadPlayer(rootId);
      const value = result?.player;
      if (result?.status !== 'READY' || result.diagnostics?.length || value?.rootId !== rootId
        || value.lifecycle !== 'ACTIVE' || value.evidence?.rootId !== rootId
        || value.evidence?.makerVersion !== value.makerVersion) {
        fail('MAKER_V8_COMPOSABLE_TARGET_UNAVAILABLE', 'The exact published Maker is unavailable or inactive.', 'COMPOSABLE');
      }
      const document = assertMakerV8Document(value.document, { mode: 'compile' });
      const admitted = document.composition.mode === 'COMPOSABLE'
        && document.composition.thirdPartyAdmission !== 'DISABLED';
      return freeze({ rootId, makerVersion: value.makerVersion,
        definitionRegistryId: value.composableBinding?.definitionRegistryId,
        baseRegistryId: value.composableBinding?.baseRegistryId,
        packRegistryId: value.composableBinding?.packRegistryId,
        admissionAuthorityId: value.composableBinding?.admissionAuthorityId,
        contentCommitment: value.evidence.contentCommitment,
        admission: document.composition.thirdPartyAdmission,
        tracks: freeze(document.tracks.map(track => freeze({ key: track.key, label: track.label }))),
        colors: freeze(document.colors.map(channel => freeze({ key: channel.key, label: channel.label,
          swatches: freeze(channel.swatches.map(swatch => freeze({ key: swatch.key, label: swatch.label }))) }))),
        parts: freeze(document.parts.filter(part => admitted && part.wardrobeMode === 'SLOT')
          .map(part => freeze({ key: part.key, label: part.label, capacity: part.capacity }))),
      });
    };
    bridge.listComposableProducts = async () => {
      if (!loadInventory) fail('MAKER_V8_COMPOSABLE_INVENTORY_UNAVAILABLE', 'External Product inventory is unavailable.', 'COMPOSABLE');
      const account = await requireConnected();
      const result = await loadInventory({ address: account.address });
      const current = await requireConnected();
      if (current.address !== account.address || result?.address !== account.address) {
        fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed while loading external Products.', 'COMPOSABLE');
      }
      if (!['READY', 'EMPTY'].includes(result?.status) || !Array.isArray(result.items)
        || !Array.isArray(result.diagnostics) || result.diagnostics.length) {
        fail('MAKER_V8_COMPOSABLE_INVENTORY_INCOMPLETE', 'External Product inventory could not be read completely. Retry before choosing a Product.', 'COMPOSABLE');
      }
      return freeze({ address: account.address,
        products: freeze(result.items.filter(item => item.kind === 'EXTERNAL_PRODUCT_CONTROL')) });
    };
    const buildComposable = method(composable, 'build', 'composable');
    const prepareComposable = method(composable, 'prepare', 'composable');
    const recoverComposable = method(composable, 'recover', 'composable');
    // Product control is wallet-wide; never derive it from the open Maker draft.
    bridge.reviewComposableProduct = async ({ productId, action, recipient }) => {
      const allowed = { PAUSE_PRODUCT: [0], RESUME_PRODUCT: [1], ARCHIVE_PRODUCT: [0, 1], TRANSFER_CONTROL: [0, 1, 2] };
      if (!Object.hasOwn(allowed, action)) fail('MAKER_V8_COMPOSABLE_INPUT_INVALID', 'Unknown Product management action.', 'COMPOSABLE');
      const account = await requireConnected(), inventory = await bridge.listComposableProducts();
      const product = inventory.products.find(row => row.id === productId);
      if (!product || !allowed[action].includes(product.lifecycle) || product.objectIds?.length !== 2 || product.objectIds[0] !== productId) {
        fail('MAKER_V8_COMPOSABLE_PRODUCT_UNAVAILABLE', 'Product control or lifecycle does not allow this action.', 'COMPOSABLE');
      }
      if (action === 'TRANSFER_CONTROL' && (!/^0x[0-9a-f]{64}$/.test(recipient) || /^0x0+$/.test(recipient) || recipient === account.address)) {
        fail('MAKER_V8_COMPOSABLE_RECIPIENT_INVALID', 'Choose a different nonzero recipient wallet.', 'COMPOSABLE');
      }
      const request = await buildComposable({ action, requestId: `control-${globalThis.crypto.randomUUID()}`,
        rootId: product.rootId, productId, adminCapId: product.objectIds[1],
        ...(action === 'TRANSFER_CONTROL' ? { payload: { recipient } } : {}) });
      if ((await requireConnected()).address !== account.address || request.signer !== account.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed during Product review.', 'COMPOSABLE');
      return request;
    };
    bridge.reviewComposableItem = async ({ productId }) => {
      const account = await requireConnected();
      const inventory = await bridge.listComposableProducts();
      const product = inventory.products.find(row => row.id === productId);
      if (!product || product.lifecycle !== 0 || !Array.isArray(product.objectIds)
        || product.objectIds.length !== 2 || product.objectIds[0] !== productId) {
        fail('MAKER_V8_COMPOSABLE_PRODUCT_UNAVAILABLE', 'Select an active Product controlled by this wallet.', 'COMPOSABLE');
      }
      const request = await buildComposable({ action: 'MINT_ITEM', requestId: `mint-${globalThis.crypto.randomUUID()}`,
        rootId: product.rootId, productId, adminCapId: product.objectIds[1], payload: { recipient: account.address } });
      if ((await requireConnected()).address !== account.address || request.signer !== account.address
        || request.payload.recipient !== account.address) {
        fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed during Item review.', 'COMPOSABLE');
      }
      return request;
    };
    bridge.reviewComposableAdmission = async ({ rootId, productId, action }) => {
      if (!['ADMIT_OPEN', 'ADMIT_CERTIFIED', 'REVOKE_ADMISSION'].includes(action)) fail('MAKER_V8_COMPOSABLE_INPUT_INVALID', 'Unknown admission action.', 'COMPOSABLE');
      const account = await requireConnected(), target = await bridge.getComposableMaker({ rootId });
      if (!loadInventory) fail('MAKER_V8_COMPOSABLE_INVENTORY_UNAVAILABLE', 'Maker control inventory is unavailable.', 'COMPOSABLE');
      const inventory = await loadInventory({ address: account.address });
      if (inventory?.address !== account.address || !['READY', 'EMPTY'].includes(inventory.status)
        || !Array.isArray(inventory.items) || !Array.isArray(inventory.diagnostics) || inventory.diagnostics.length) {
        fail('MAKER_V8_COMPOSABLE_INVENTORY_INCOMPLETE', 'Maker control could not be read completely.', 'COMPOSABLE');
      }
      const admins = inventory.items.filter(row => row.kind === 'MAKER_ADMIN' && row.rootId === rootId);
      if (admins.length !== 1 || !target.definitionRegistryId || !target.packRegistryId || !target.admissionAuthorityId
        || (action === 'ADMIT_OPEN' && target.admission !== 'OPEN')
        || (action === 'ADMIT_CERTIFIED' && target.admission === 'DISABLED')) {
        fail('MAKER_V8_COMPOSABLE_ADMISSION_UNAVAILABLE', 'Current wallet or Maker policy does not authorize this admission action.', 'COMPOSABLE');
      }
      const request = await buildComposable({ action, requestId: `admission-${globalThis.crypto.randomUUID()}`,
        rootId, productId, makerAdminId: admins[0].id, definitionRegistryId: target.definitionRegistryId,
        packRegistryId: target.packRegistryId, admissionAuthorityId: target.admissionAuthorityId });
      if ((await requireConnected()).address !== account.address || request.signer !== account.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed during admission review.', 'COMPOSABLE');
      return request;
    };
    // rebuilds the request below; this result is not reusable signing authority.
    if (composableTransport) bridge.reviewComposableUpload = async input => {
      const account = await requireConnected();
      const source = await composableTransport.productSource(input);
      const target = await bridge.getComposableMaker({ rootId: source.binding.rootId });
      const p = source.payload;
      if (source.binding.address !== account.address || source.binding.makerVersion !== target.makerVersion
        || source.binding.contentCommitment !== target.contentCommitment
        || !target.parts.some(part => part.key === p.partKey)
        || !target.tracks.some(track => track.key === p.layerTrackKey)
        || (p.colorChannelKey !== null && !target.colors.some(color => color.key === p.colorChannelKey
          && color.swatches.some(swatch => swatch.key === p.defaultSwatchKey)))
        || !target.definitionRegistryId || !target.baseRegistryId) {
        fail('MAKER_V8_COMPOSABLE_TARGET_CHANGED', 'Certified source target changed or is unavailable.', 'COMPOSABLE');
      }
      if ((await requireConnected()).address !== account.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Wallet changed during Product review.', 'COMPOSABLE');
      const request = await buildComposable({ action: 'CREATE_PRODUCT', requestId: source.uploadId,
        draftRevision: source.artworkRevision,
        rootId: target.rootId, definitionRegistryId: target.definitionRegistryId,
        baseRegistryId: target.baseRegistryId, payload: p });
      if (request.signer !== account.address) fail('MAKER_V8_COMPOSABLE_WALLET_CHANGED', 'Product review signer differs.', 'COMPOSABLE');
      return request;
    };
    bridge.reviewComposableAction = async (input) => {
      await requireConnected();
      return buildComposable(input);
    };
    bridge.prepareComposableAction = async (input) => {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail(
          'MAKER_V8_PRODUCT_EXECUTION_DISABLED',
          'Composable Item signing and broadcast are disabled.',
          'COMPOSABLE',
        );
      }
      await requireConnected();
      return prepareComposable(await buildComposable(input));
    };
    bridge.recoverComposableAction = async (ticket) => {
      await requireConnected();
      return recoverComposable(ticket);
    };
  }

  let offWallet = null;
  if (walletSubscribe) {
    offWallet = walletSubscribe((event) => {
      if (disposed || softDisconnected) return;
      const account = event?.account ?? event;
      try { applyWallet(walletSnapshot(account)); } catch (error) { issue = errorDiagnostic(error); }
      emit();
    });
  }

  bridge.dispose = () => {
    if (disposed) return;
    disposed = true;
    invalidateLocalPlayer();
    invalidatePlayerSession();
    draftRenderGeneration += 1;
    try { offWallet?.(); } catch {}
    try { walletDispose?.(); } catch {}
    try { closeDrafts?.(); } catch {}
    listeners.clear();
  };

  return freeze(bridge);
}
