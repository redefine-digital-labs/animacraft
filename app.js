import { makerV8WalrusAssetPathV8 } from './maker-v8-asset-quilt.js';
import { createOriginalProductApp } from './original-product-app.js';
import { createAnimacraftWalletUiV8 } from './animacraft-wallet-ui.js';
import { createMakerV8DAppKitWalletAdapterV8 } from './maker-v8-dapp-kit-wallet.js';
import { createMakerV8DraftPersistence } from './maker-v8-draft-store.js';
import { createMakerV8LocalPlayerStore } from './maker-v8-local-player-store.js';
import { createMakerV8ComposableArtworkStore } from './maker-v8-composable-artwork-store.js';
import { createMakerV8ComposableTransport } from './maker-v8-composable-transport.js';
import { createMakerV8ProductBridge } from './maker-v8-product-bridge.js';
import { createMakerV8ProductRuntime, createMakerV8PackParentLoaderV8 } from './maker-v8-product-runtime.js';
import { createMakerV8PublicationControllerV8 } from './maker-v8-publication-controller.js';
import { createMakerV8PublicationPersistenceV8 } from './maker-v8-publication-store.js';
import { createProductionMakerV8PublicationAdaptersV8 } from './maker-v8-publication-adapters.js';
import { createMakerV8PublicationTransportV8 } from './maker-v8-publication-transport.js';
import { createProductionMakerV8WalrusPublisherV8 } from './maker-v8-walrus.js';
import { createProductionMakerV8LifecycleAdaptersV8 } from './maker-v8-lifecycle-adapters.js';
import { createProductionMakerV8PlayerAdaptersV8 } from './maker-v8-player-adapters.js';
import { MAKER_V8_PLAYER_ACTIONS } from './maker-v8-player-controller.js';
import { createMakerV8PlayerJourneyV8 } from './maker-v8-player-journey.js';
import { createProductionMakerV8NativeContentV8 } from './maker-v8-native-content-production.js';
import { createProductionMakerV8ProtectedTransportV8 } from './maker-v8-protected-transport.js';
import { createProductionMakerV8PackAdaptersV8, createMakerV8PackStudioV8 } from './maker-v8-pack-adapters.js';
import { createMakerV8PackPersistenceV8 } from './maker-v8-pack-persistence.js';
import { createProductionMakerV8ComposableControllerV8 } from './maker-v8-composable-controller.js';
import { createProductionMakerV8BrowserAdapters } from './maker-v8-browser.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  createMakerV8ChainClient,
} from './maker-v8-chain.js';
import {
  MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  createProductionMakerV8SuiGrpcTransport,
} from './maker-v8-sui-grpc.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';

export const ANIMACRAFT_PRODUCT_APP_SCHEMA = 'animacraft.product-app.v8';
export const ANIMACRAFT_WALRUS_MAINNET_AGGREGATOR =
  'https://aggregator.walrus-mainnet.walrus.space';

const SAFE_BLOB_ID = /^[A-Za-z0-9_-]{1,512}$/;

export class AnimacraftProductAppError extends Error {
  constructor(code, message, layer = 'APP', details = undefined) {
    super(message);
    this.name = 'AnimacraftProductAppError';
    this.code = code;
    this.layer = layer;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, layer, details) {
  throw new AnimacraftProductAppError(code, message, layer, details);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function assertAnimacraftExecutionConfig(value) {
  const expected = [
    'schemaVersion',
    'network',
    'chainIdentifier',
    'allowWalletSignature',
    'allowBroadcast',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) {
    fail('ANIMACRAFT_EXECUTION_INVALID', 'The exact Animacraft execution configuration is required.', 'CONFIGURATION');
  }
  if (value.schemaVersion !== 'animacraft.web-execution.v8'
    || value.network !== 'mainnet'
    || value.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || typeof value.allowWalletSignature !== 'boolean'
    || typeof value.allowBroadcast !== 'boolean'
    || value.allowWalletSignature !== value.allowBroadcast) {
    fail('ANIMACRAFT_EXECUTION_INVALID', 'Animacraft execution must pin Mainnet and change signing/broadcast gates together.', 'CONFIGURATION');
  }
  return freeze({ ...value });
}

function assertAnimacraftProtectionConfig(value) {
  if (value === undefined || value === null) {
    return freeze({
      schemaVersion: 'animacraft.protected-execution.v1',
      allowProtectedContent: false,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join('\0')
      !== ['schemaVersion', 'allowProtectedContent'].sort().join('\0')
    || value.schemaVersion !== 'animacraft.protected-execution.v1'
    || typeof value.allowProtectedContent !== 'boolean') {
    fail('ANIMACRAFT_PROTECTION_INVALID', 'The exact server-only protection configuration is required.', 'CONFIGURATION');
  }
  return freeze({ ...value });
}

/**
 * Product configuration carries its public schema marker, while transaction
 * boundaries intentionally accept only the four execution authority fields.
 * Keep this projection explicit so adding UI configuration can never silently
 * expand a signing or broadcast authority record.
 */
export function createAnimacraftChainExecutionV8(webExecution) {
  if (!webExecution || typeof webExecution !== 'object') {
    fail('ANIMACRAFT_EXECUTION_REQUIRED', 'The exact v8 execution configuration is required.', 'CONFIGURATION');
  }
  return freeze({
    network: webExecution.network,
    chainIdentifier: webExecution.chainIdentifier,
    allowWalletSignature: webExecution.allowWalletSignature,
    allowBroadcast: webExecution.allowBroadcast,
  });
}

export function createLazyMakerV8LifecycleFacade(resolveLifecycle, { resolveRead = resolveLifecycle } = {}) {
  if (typeof resolveLifecycle !== 'function') {
    fail('ANIMACRAFT_LIFECYCLE_RESOLVER_REQUIRED', 'Lifecycle capability requires one explicit resolver.', 'CONFIGURATION');
  }
  let resolved = null;
  const load = async () => {
    if (!resolved) {
      resolved = Promise.resolve().then(resolveLifecycle).then((value) => {
        for (const method of ['build', 'prepare', 'requestSignature', 'recover']) {
          if (typeof value?.[method] !== 'function') {
            fail('ANIMACRAFT_LIFECYCLE_ADAPTER_INVALID', `Lifecycle adapter.${method} is required.`, 'CONFIGURATION');
          }
        }
        return value;
      }).catch((error) => {
        resolved = null;
        throw error;
      });
    }
    return resolved;
  };
  return freeze({
    getSnapshot: async (input) => {
      // Read-only production composition does not initialize the signing WAL.
      const lifecycle = resolveRead === resolveLifecycle ? await load() : await resolveRead();
      if (typeof lifecycle.getSnapshot !== 'function') {
        fail('ANIMACRAFT_LIFECYCLE_READ_UNAVAILABLE', 'Lifecycle readback is unavailable.', 'LIFECYCLE');
      }
      return lifecycle.getSnapshot(input);
    },
    build: async (input) => (await load()).build(input),
    prepare: async (input) => (await load()).prepare(input),
    requestSignature: async (input) => (await load()).requestSignature(input),
    recover: async (input) => (await load()).recover(input),
    recoverByRoot: async (input) => {
      const lifecycle = await load();
      if (typeof lifecycle.recoverByRoot !== 'function') {
        fail('ANIMACRAFT_LIFECYCLE_RECOVERY_INVALID', 'Lifecycle root recovery is unavailable.', 'LIFECYCLE');
      }
      return lifecycle.recoverByRoot(input);
    },
  });
}

export function createLazyMakerV8PlayerFacade(resolvePlayer) {
  if (typeof resolvePlayer !== 'function') {
    fail('ANIMACRAFT_PLAYER_RESOLVER_REQUIRED', 'Player capability requires one explicit resolver.', 'CONFIGURATION');
  }
  let resolved = null;
  const load = async () => {
    if (!resolved) {
      resolved = Promise.resolve().then(resolvePlayer).then((value) => {
        for (const method of [
          'getSnapshot', 'loadPlayer', 'setRecipe', 'updateRecipe', 'resetRecipe',
          'preparePlayerAction', 'executePlayerAction', 'recoverPlayerAction', 'getPlayerAction',
        ]) {
          if (typeof value?.[method] !== 'function') {
            fail('ANIMACRAFT_PLAYER_ADAPTER_INVALID', `Player adapter.${method} is required.`, 'CONFIGURATION');
          }
        }
        return value;
      }).catch((error) => {
        resolved = null;
        throw error;
      });
    }
    return resolved;
  };
  return freeze({
    getSnapshot: async (...args) => (await load()).getSnapshot(...args),
    loadPlayer: async (...args) => (await load()).loadPlayer(...args),
    setRecipe: async (...args) => (await load()).setRecipe(...args),
    updateRecipe: async (...args) => (await load()).updateRecipe(...args),
    resetRecipe: async (...args) => (await load()).resetRecipe(...args),
    quotePlayerCompletion: async (...args) => {
      const value = await load();
      if (typeof value.quotePlayerCompletion !== 'function') {
        fail('ANIMACRAFT_PLAYER_QUOTE_UNAVAILABLE',
          'Player adapter does not expose a read-only completion overview.', 'CONFIGURATION');
      }
      return value.quotePlayerCompletion(...args);
    },
    resolveProtectedOutputIdentity: async (...args) => {
      const value = await load();
      if (typeof value.resolveProtectedOutputIdentity !== 'function') {
        fail(
          'ANIMACRAFT_PLAYER_PROTECTED_IDENTITY_UNAVAILABLE',
          'Player adapter does not expose protected Output identity.',
          'CONFIGURATION',
        );
      }
      return value.resolveProtectedOutputIdentity(...args);
    },
    decryptProtectedSelection: async (...args) => {
      const signal = args[0]?.signal;
      signal?.throwIfAborted();
      const value = await load();
      signal?.throwIfAborted();
      if (typeof value.decryptProtectedSelection !== 'function') {
        fail(
          'ANIMACRAFT_PLAYER_PROTECTED_DECRYPT_UNAVAILABLE',
          'Player adapter does not expose protected Base/Pack decryption.',
          'CONFIGURATION',
        );
      }
      return value.decryptProtectedSelection(...args);
    },
    reuseCommittedPlayerLoadout: async (...args) => {
      const player = await load();
      if (typeof player.reuseCommittedPlayerLoadout !== 'function') {
        fail('ANIMACRAFT_PLAYER_ADAPTER_INVALID', 'Player adapter cannot verify a committed Loadout.', 'CONFIGURATION');
      }
      return player.reuseCommittedPlayerLoadout(...args);
    },
    preparePlayerAction: async (...args) => (await load()).preparePlayerAction(...args),
    executePlayerAction: async (...args) => (await load()).executePlayerAction(...args),
    recoverPlayerAction: async (...args) => (await load()).recoverPlayerAction(...args),
    recoverActivePlayerAction: async (...args) => {
      const player = await load();
      if (typeof player.recoverActivePlayerAction !== 'function') {
        fail('ANIMACRAFT_PLAYER_ADAPTER_INVALID', 'Player adapter cannot recover the active durable action.', 'CONFIGURATION');
      }
      return player.recoverActivePlayerAction(...args);
    },
    getPlayerAction: async (...args) => (await load()).getPlayerAction(...args),
  });
}

export function createLazyMakerV8PackFacade(resolvePack, resolveLocalPack = resolvePack) {
  if (typeof resolvePack !== 'function') {
    fail('ANIMACRAFT_PACK_RESOLVER_REQUIRED', 'Pack Studio requires one explicit resolver.', 'CONFIGURATION');
  }
  let resolved = null;
  let localResolved = null;
  const loadLocal = () => {
    if (resolveLocalPack === resolvePack) return load();
    localResolved ??= Promise.resolve().then(resolveLocalPack).catch(error => {
      localResolved = null;
      throw error;
    });
    return localResolved;
  };
  const load = async () => {
    if (!resolved) {
      resolved = Promise.resolve().then(resolvePack).then((value) => {
        for (const method of [
          'createPackDraft', 'list', 'load', 'save', 'upsertAsset', 'preview', 'export',
          'preparePublication', 'resumePublication', 'requestPublicationSignature',
          'recoverPublicationOutcome', 'replayPackPublication', 'performLifecycle',
        ]) {
          if (typeof value?.[method] !== 'function') {
            fail('ANIMACRAFT_PACK_ADAPTER_INVALID', `Pack adapter.${method} is required.`, 'CONFIGURATION');
          }
        }
        return value;
      }).catch((error) => {
        resolved = null;
        throw error;
      });
    }
    return resolved;
  };
  return freeze({
    createPackDraft: async (input) => (await (input?.parent ? loadLocal() : load())).createPackDraft(input),
    list: async () => (await loadLocal()).list(),
    load: async (draftId) => (await loadLocal()).load(draftId),
    bindPublishedParent: async (input) => (await load()).bindPublishedParent(input),
    save: async (input) => (await loadLocal()).save(input),
    upsertAsset: async (input) => (await loadLocal()).upsertAsset(input),
    loadPreview: async (input) => (await loadLocal()).loadPreview(input),
    preview: async (input) => (await loadLocal()).preview(input),
    export: async (draftId) => (await loadLocal()).export(draftId),
    preparePublication: async (input) => (await load()).preparePublication(input),
    resumePublication: async (input) => (await load()).resumePublication(input),
    requestPublicationSignature: async (input) => (await load()).requestPublicationSignature(input),
    recoverPublicationOutcome: async (input) => (await load()).recoverPublicationOutcome(input),
    replayPackPublication: async (input) => (await load()).replayPackPublication(input),
    performLifecycle: async (input) => (await load()).performLifecycle(input),
  });
}

export function createLazyMakerV8ComposableFacade(resolveComposable) {
  if (typeof resolveComposable !== 'function') {
    fail('ANIMACRAFT_COMPOSABLE_RESOLVER_REQUIRED', 'Composable Items require one explicit resolver.', 'CONFIGURATION');
  }
  let resolved = null;
  const load = async () => {
    if (!resolved) {
      resolved = Promise.resolve().then(resolveComposable).then((value) => {
        for (const method of ['build', 'prepare', 'recover']) {
          if (typeof value?.[method] !== 'function') {
            fail('ANIMACRAFT_COMPOSABLE_ADAPTER_INVALID', `Composable adapter.${method} is required.`, 'CONFIGURATION');
          }
        }
        return value;
      }).catch((error) => {
        resolved = null;
        throw error;
      });
    }
    return resolved;
  };
  return freeze({
    build: async (input) => (await load()).build(input),
    prepare: async (input) => (await load()).prepare(input),
    recover: async (input) => (await load()).recover(input),
    load: async (input) => (await load()).load(input),
    list: async () => (await load()).list(),
    stage: async input => (await load()).stage(input),
  });
}

/** Official Mainnet Walrus read path. Integrity is independently rechecked by the manifest adapter. */
export function createMainnetWalrusManifestFetcher({
  fetcher = globalThis.fetch,
  aggregator = ANIMACRAFT_WALRUS_MAINNET_AGGREGATOR,
} = {}) {
  if (typeof fetcher !== 'function') {
    fail('ANIMACRAFT_WALRUS_FETCH_REQUIRED', 'A browser Fetch implementation is required.', 'CONFIGURATION');
  }
  let base;
  try {
    base = new URL(aggregator);
  } catch {
    fail('ANIMACRAFT_WALRUS_ENDPOINT_INVALID', 'Walrus aggregator URL is invalid.', 'CONFIGURATION');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    fail('ANIMACRAFT_WALRUS_ENDPOINT_INVALID', 'Walrus aggregator must be a credential-free HTTPS origin.', 'CONFIGURATION');
  }
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '');
  return async ({ blobId, signal } = {}) => {
    if (typeof blobId !== 'string' || !SAFE_BLOB_ID.test(blobId)) {
      fail('ANIMACRAFT_WALRUS_BLOB_ID_INVALID', 'Walrus Blob ID is not canonical bounded text.', 'MANIFEST');
    }
    const path = blobId.length === 50 ? makerV8WalrusAssetPathV8(blobId) : `/v1/blobs/${encodeURIComponent(blobId)}`;
    const url = new URL(`${basePath}${path}`, base.origin);
    let response;
    try {
      response = await fetcher(url.href, freeze({
        method: 'GET',
        signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: freeze({ Accept: 'application/json, application/octet-stream;q=0.9' }),
      }));
    } catch (cause) {
      fail(
        'ANIMACRAFT_WALRUS_READ_FAILED',
        'Certified Walrus Manifest could not be read.',
        'MANIFEST',
        { cause: String(cause?.message ?? cause ?? 'unknown') },
      );
    }
    if (!response || response.ok !== true) {
      fail(
        'ANIMACRAFT_WALRUS_READ_FAILED',
        'Certified Walrus Manifest is temporarily unavailable.',
        'MANIFEST',
        { status: Number(response?.status ?? 0) },
      );
    }
    return response;
  };
}

export function createLifecycleProductFacade({ controller, authority, client, adapters,
  chain = createMakerV8ChainClient(authority.runtime, { rpc: client, network: 'mainnet' }),
}) {
  const loadRoot = async (input = {}) => {
    const rootId = String(input.rootId ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(rootId)) {
      fail('ANIMACRAFT_LIFECYCLE_ROOT_REQUIRED', 'Select one exact published Root.', 'LIFECYCLE');
    }
    const account = { ...await adapters.wallet.getCurrentAccount() };
    if (!account.address || account.network !== 'mainnet') {
      fail('ANIMACRAFT_LIFECYCLE_WALLET_REQUIRED', 'A connected Mainnet wallet is required.', 'LIFECYCLE');
    }
    const activation = (await chain.discover()).find((entry) => entry.binding.rootId === rootId);
    if (!activation) {
      fail('ANIMACRAFT_LIFECYCLE_ROOT_NOT_FOUND', 'The selected Root has no certified v8 activation.', 'LIFECYCLE');
    }
    const context = await chain.loadContext(activation);
    const owned = await chain.inventory(account.address, context.root);
    const admin = owned.adminCaps.find((entry) => entry.objectId === context.root.adminCapId);
    if (!admin) {
      fail('ANIMACRAFT_LIFECYCLE_ADMIN_REQUIRED', 'The connected wallet does not own the current MakerAdmin capability.', 'LIFECYCLE');
    }
    return {
      wallet: { address: account.address, network: 'mainnet' },
      root: context.root,
      admin,
    };
  };
  const loadInput = async (input = {}) => {
    const action = String(input.action ?? '');
    const base = { ...await loadRoot(input), action };
    const operational = await chain.loadOperationalState(base.root);
    if (action === 'WITHDRAW_MAKER_REVENUE') {
      return freeze({
        ...base,
        makerTreasury: operational.makerTreasury,
        amountAtomic: String(input.amountAtomic ?? operational.makerTreasury.balanceAtomic),
        recipient: String(input.recipient ?? base.wallet.address).toLowerCase(),
      });
    }
    return freeze({
      ...base,
      protocolConfig: operational.protocolConfig,
      catalog: authority.catalog,
      releaseConfig: authority.configs.release,
    });
  };
  return freeze({
    schemaVersion: 'animacraft.product-lifecycle.v1',
    execution: controller.execution,
    // Advisory readback only: building/confirming a withdrawal re-reads authority
    // and balances. Opening a panel must never prepare a transaction or WAL.
    getSnapshot: async (input) => {
      const { wallet, root, admin } = await loadRoot(input);
      const { makerTreasury } = await chain.loadOperationalState(root);
      const current = await adapters.wallet.getCurrentAccount();
      if (current.address !== wallet.address || current.network !== wallet.network) {
        fail('ANIMACRAFT_LIFECYCLE_WALLET_CHANGED', 'The wallet changed while loading revenue.', 'LIFECYCLE');
      }
      return freeze({
        schemaVersion: 'animacraft.product-lifecycle-snapshot.v1',
        wallet,
        rootId: root.objectId,
        makerKey: root.makerKey,
        makerVersion: String(root.makerVersion),
        lifecycle: root.lifecycle,
        controlEpoch: String(root.controlEpoch),
        adminCapId: admin.objectId,
        paymentCoinType: authority.runtime.paymentCoinType,
        treasury: {
          objectId: makerTreasury.objectId,
          version: String(makerTreasury.version),
          digest: makerTreasury.digest,
          balanceAtomic: String(makerTreasury.balanceAtomic),
          totalCollectedAtomic: String(makerTreasury.totalCollectedAtomic),
          totalWithdrawnAtomic: String(makerTreasury.totalWithdrawnAtomic),
        },
      });
    },
    build: async (input) => controller.build(await loadInput(input)),
    prepare: (built) => controller.prepare(built),
    requestSignature: (prepared) => controller.requestSignature(prepared),
    recover: (ticket) => controller.recover(ticket),
    recoverByRoot: (input) => controller.recoverByRoot(input),
    reclaimActive: (input) => controller.reclaimActive(input),
  });
}

export async function createProductionAnimacraftApp({
  root,
  win = globalThis.window,
  doc = globalThis.document,
  runtime: runtimeInput = win?.SoulidityMakerV8,
  execution: executionInput = win?.SoulidityV8Execution,
  protection: protectionInput = win?.AnimacraftV8Protection,
  client = null,
  browserAdapters = null,
  walletUi: walletUiInput = null,
  walletAdapter: walletAdapterInput = null,
  manifestFetcher = null,
  indexedDB = win?.indexedDB,
  controllers = {},
} = {}) {
  if (!root || typeof root.querySelector !== 'function'
    || !doc?.getElementById?.('makerV4CreatorMount')
    || !doc?.getElementById?.('walletButton')) {
    fail(
      'ANIMACRAFT_PRODUCT_ROOT_REQUIRED',
      'The approved original Animacraft document and Creator mount are required.',
      'CONFIGURATION',
    );
  }
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const execution = assertAnimacraftExecutionConfig(executionInput);
  const protection = assertAnimacraftProtectionConfig(protectionInput);
  const chainExecution = createAnimacraftChainExecutionV8(execution);
  const transport = client ?? createProductionMakerV8SuiGrpcTransport();
  const walletUi = walletUiInput ?? await createAnimacraftWalletUiV8({
    network: 'mainnet',
    grpcUrl: MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
    doc,
  });
  const walletAdapter = walletAdapterInput ?? browserAdapters?.wallet
    ?? createMakerV8DAppKitWalletAdapterV8({
      dAppKit: walletUi.dAppKit,
      client: transport,
      allowWalletSignature: execution.allowWalletSignature,
    });
  const adapters = browserAdapters ?? createProductionMakerV8BrowserAdapters({
    runtime,
    execution,
    client: transport,
    wallet: walletAdapter,
  });
  const productRuntime = createMakerV8ProductRuntime({
    runtime,
    client: transport,
    browserAdapters: adapters,
    manifestFetcher: manifestFetcher ?? createMainnetWalrusManifestFetcher(),
  });
  const drafts = createMakerV8DraftPersistence(indexedDB);
  const localPlayerStore = createMakerV8LocalPlayerStore(indexedDB);
  const publicationStore = controllers.publicationStore
    ?? createMakerV8PublicationPersistenceV8(indexedDB);
  const publicationAdapters = controllers.publicationAdapters
    ?? createProductionMakerV8PublicationAdaptersV8({
      client: transport,
      runtime,
      persistence: publicationStore,
      execution: chainExecution,
      walletAdapter: adapters.wallet,
    });
  const publication = controllers.publication
    ?? createMakerV8PublicationControllerV8({
      persistence: publicationStore,
      compiler: publicationAdapters.compiler,
      boundary: publicationAdapters.boundary,
      wallet: adapters.wallet,
      rpc: adapters.rpc,
      execution: chainExecution,
    });
  const walrus = controllers.walrus ?? createProductionMakerV8WalrusPublisherV8({
    rpc: adapters.rpc,
    wallet: adapters.wallet,
    execution: chainExecution,
    indexedDB,
    storageManager: win?.navigator?.storage,
  });
  const protectedTransport = controllers.protectedTransport
    ?? (protection.allowProtectedContent
      ? createProductionMakerV8ProtectedTransportV8({ runtime, transport })
      : null);
  const publicationTransport = controllers.publicationTransport
    ?? createMakerV8PublicationTransportV8({
      publisher: walrus.publisher,
      compiler: publicationAdapters.compiler,
      publication,
      protector: protectedTransport,
    });
  let lifecycleAuthority = controllers.lifecycleAuthority ?? null;
  let lifecycleAdapters = controllers.lifecycleAdapters ?? null;
  const resolveLifecycle = controllers.lifecycle
    ? async () => controllers.lifecycle
    : async () => {
        lifecycleAuthority ??= await attestMakerV8Runtime(transport, runtime);
        lifecycleAdapters ??= await createProductionMakerV8LifecycleAdaptersV8({
          client: transport,
          runtime: lifecycleAuthority.runtime,
          execution: chainExecution,
          walletAdapter: adapters.wallet,
          indexedDB,
        });
        return createLifecycleProductFacade({
          controller: lifecycleAdapters.controller,
          authority: lifecycleAuthority,
          client: transport,
          adapters,
        });
      };
  const lifecycle = createLazyMakerV8LifecycleFacade(resolveLifecycle, {
    resolveRead: controllers.lifecycle ? resolveLifecycle : async () => {
      lifecycleAuthority ??= await attestMakerV8Runtime(transport, runtime);
      return createLifecycleProductFacade({
        controller: {},
        authority: lifecycleAuthority,
        client: transport,
        adapters,
      });
    },
  });
  let playerAdapters = controllers.playerAdapters ?? null;
  const resolvePlayer = controllers.player
    ? async () => controllers.player
    : async () => {
        playerAdapters ??= await createProductionMakerV8PlayerAdaptersV8({
          client: transport,
          productRuntime,
          runtime,
          walletAdapter: adapters.wallet,
          execution: {
            ...chainExecution,
            allowProtectedContent: protection.allowProtectedContent,
          },
          indexedDB,
        });
        const controller = playerAdapters.controller;
        return freeze({
          ...controller,
          async decryptProtectedSelection({ selectionIndex, ciphertext, signal } = {}) {
            signal?.throwIfAborted();
            if (!playerAdapters.protectedContent) {
              fail(
                'ANIMACRAFT_PLAYER_PROTECTED_DECRYPT_DISABLED',
                'Protected Base/Pack decryption is disabled by the deployment gate.',
                'GATE',
              );
            }
            const snapshot = controller.getSnapshot();
            const account = await playerAdapters.wallet.getCurrentAccount();
            signal?.throwIfAborted();
            return playerAdapters.protectedContent.decrypt({
              request: {
                action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
                player: snapshot.player,
                recipe: snapshot.recipe,
                loadout: snapshot.loadout,
                input: {},
                account,
              },
              selectionIndex,
              ciphertext,
              signal,
            });
          },
        });
      };
  const player = createLazyMakerV8PlayerFacade(resolvePlayer);
  const nativeContent = controllers.nativeContent ?? createProductionMakerV8NativeContentV8({
    runtime, client: transport, wallet: adapters.wallet, walrus, win, indexedDB, execution: chainExecution,
  });
  const playerJourney = controllers.playerJourney ?? createMakerV8PlayerJourneyV8({
    player,
    productRuntime,
    walrus,
    protectedTransport,
    nativeContent,
  });
  let packAdapters = controllers.packAdapters ?? null;
  const resolvePack = controllers.pack
    ? async () => controllers.pack
    : async () => {
        packAdapters ??= await createProductionMakerV8PackAdaptersV8({
          loadParent: createMakerV8PackParentLoaderV8(productRuntime.catalog),
          client: transport,
          runtime,
          wallet: adapters.wallet,
          rpc: adapters.rpc,
          publisher: walrus.publisher,
          protectedTransport,
          execution: chainExecution,
          indexedDB,
        });
        return packAdapters.controller;
      };
  // Local authoring uses the same Pack schema/database but no chain bootstrap.
  // Only exact published-parent creation and release/lifecycle actions resolve
  // the attested production adapter above. There is no alternate issuer.
  const pack = createLazyMakerV8PackFacade(resolvePack, controllers.pack ? resolvePack : () => {
    const chainOnly = () => { throw new Error('Published Pack parents require the attested production adapter.'); };
    return createMakerV8PackStudioV8({
      chain: { discover: chainOnly, loadContext: chainOnly, loadPackAuthoringContext: chainOnly },
      wallet: adapters.wallet,
      persistence: createMakerV8PackPersistenceV8(indexedDB),
    });
  });
  let composableAdapters = controllers.composableAdapters ?? null;
  const resolveComposable = controllers.composable
    ? async () => controllers.composable
    : async () => {
        composableAdapters ??= await createProductionMakerV8ComposableControllerV8({
          client: transport,
          runtime,
          wallet: adapters.wallet,
          rpc: adapters.rpc,
          execution: chainExecution,
          indexedDB,
        });
        return composableAdapters.controller;
      };
  const composable = createLazyMakerV8ComposableFacade(resolveComposable);
  const composableArtworkStore = createMakerV8ComposableArtworkStore(indexedDB);
  const resolveComposableTransport = () => createMakerV8ComposableTransport({
    publisher: walrus.publisher, artworkStore: composableArtworkStore, wallet: adapters.wallet,
  });
  const composableTransport = { prepare: input => resolveComposableTransport().prepare(input),
    advance: input => resolveComposableTransport().advance(input),
    productSource: input => resolveComposableTransport().productSource(input),
    history: () => resolveComposableTransport().history() };
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    localPlayerStore,
    publication,
    publicationTransport,
    publicationStore,
    lifecycle,
    player,
    playerJourney,
    protectedTransport,
    pack,
    composable,
    composableTransport,
    execution,
  });
  const shell = createOriginalProductApp({ bridge, walletUi, win, doc });
  const ready = Promise.all([shell.ready, bridge.ready()]).then(([shellState, bridgeState]) => freeze({
    shell: shellState,
    bridge: bridgeState,
  }));
  ready.catch(() => {
    // The bridge state carries the exact diagnostic; public browsing remains
    // visible while all writes stay fail-closed.
  });
  const dispose = () => {
    composableArtworkStore.close();
    const localDrains = shell.destroy();
    bridge.dispose();
    void nativeContent.dispose?.();
    void Promise.resolve(localDrains).finally(() => localPlayerStore.close());
    if (walletAdapter !== adapters.wallet) walletAdapter.dispose?.();
    walletUi.destroy?.();
  };
  win?.addEventListener?.('pagehide', dispose, { once: true });
  return freeze({
    schemaVersion: ANIMACRAFT_PRODUCT_APP_SCHEMA,
    runtime,
    execution,
    transport,
    adapters,
    walletUi,
    walletAdapter: adapters.wallet,
    productRuntime,
    publication,
    publicationStore,
    publicationAdapters,
    publicationTransport,
    walrus,
    lifecycleAdapters,
    lifecycleAuthority,
    lifecycle,
    player,
    playerJourney,
    playerAdapters,
    pack,
    packAdapters,
    composable,
    composableAdapters,
    resolvePlayer,
    resolvePack,
    resolveComposable,
    resolveLifecycle,
    bridge,
    shell,
    ready,
    dispose,
  });
}

export function renderAnimacraftBootstrapFailure(root, error) {
  const message = typeof error?.message === 'string' && error.message
    ? error.message : 'Animacraft could not initialize its certified v8 runtime.';
  const creatorMount = root?.querySelector?.('#makerV4CreatorMount');
  if (creatorMount) {
    creatorMount.textContent = message;
    creatorMount.setAttribute?.('data-runtime-state', 'error');
  }
  for (const id of ['creatorGateWalletButton', 'publishMaker', 'resumePublication']) {
    const control = root?.querySelector?.(`#${id}`);
    if (!control) continue;
    control.disabled = true;
    control.setAttribute?.('aria-disabled', 'true');
    control.title = message;
  }
  return message;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const root = document.body;
  if (root && document.getElementById('makerV4CreatorMount')) {
    createProductionAnimacraftApp({ root, win: window, doc: document }).catch((error) => {
      renderAnimacraftBootstrapFailure(root, error);
      console.error('Animacraft v8 bootstrap failed.', error);
    });
  }
}
