import { assertMakerV8PublishedSources, MAKER_V8_SOURCE_ASSET_KEY } from './maker-v8-source-asset.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { compileMakerV8PackDefinitionRowsV8 } from './maker-v8-pack-definitions-compiler.js';
import { MAKER_V8_PACK_DEFINITION_ROWS_BCS, packDefinitionCommitmentV8 } from './maker-v8-pack-definition-wire.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  createMakerV8ChainClient,
} from './maker-v8-chain.js';
import {
  createProductionMakerV8BrowserAdapters,
} from './maker-v8-browser.js';
import {
  createProductionMakerV8SuiGrpcTransport,
} from './maker-v8-sui-grpc.js';
import {
  assertMakerV8Runtime,
} from './maker-v8-runtime.js';
import {
  MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA,
  createMakerV8CatalogAdapter,
} from './maker-v8-catalog-adapter.js';
import {
  createMakerV8CertifiedAssetAdapter,
  createMakerV8ManifestAdapter,
} from './maker-v8-manifest-adapter.js';
import {
  createMakerV8PackManifestReadAdapterV8,
} from './maker-v8-pack-transport.js';

export const MAKER_V8_PRODUCT_RUNTIME_SCHEMA = 'animacraft.maker-v8-product-runtime.v1';
export const MAKER_V8_PRODUCT_READ_ONLY_EXECUTION = Object.freeze({
  network: 'mainnet',
  chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  allowWalletSignature: false,
  allowBroadcast: false,
});

const EXACT_ID = /^0x[0-9a-f]{64}$/;

/** Local render lookup key only. Never replaces a stored asset ID, content
 * commitment, Blob identity or original-artwork proof. Bounded to 69 chars. */
export function makerV8PackRenderAssetId(releaseId, assetId) {
  if (!EXACT_ID.test(releaseId) || typeof assetId !== 'string' || !assetId || assetId.length > 128) {
    fail('MAKER_V8_PRODUCT_PACK_ASSET_ID_INVALID', 'Pack render identity requires an exact Release and bounded asset ID.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(['animacraft/pack-render-asset/v1', releaseId, assetId]));
  return `pack-${[...sha256(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

let singleton = null;
let singletonOptions = null;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fail(code, message, details = {}) {
  throw new MakerV8ProductRuntimeError(code, message, details);
}

export class MakerV8ProductRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MakerV8ProductRuntimeError';
    this.code = code;
    this.layer = 'PRODUCT_RUNTIME';
    this.details = freeze({ ...details });
  }
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_PRODUCT_ADAPTER_INVALID', `${label}.${method} is required.`);
  }
}

function assertBrowserAdapters(value) {
  if (!plain(value)) fail('MAKER_V8_PRODUCT_BROWSER_INVALID', 'Browser adapters are required.');
  for (const method of ['getCurrentAccount', 'reconnect', 'subscribe', 'dispose']) {
    requireMethod(value.wallet, method, 'browserAdapters.wallet');
  }
  if (!plain(value.compiler)) {
    fail('MAKER_V8_PRODUCT_COMPILER_INVALID', 'The fresh-v8 compiler RPC adapter is required.');
  }
  for (const method of [
    'loadTrustedContext',
    'assertContextFresh',
    'recoverStage',
    'recoverCheckpoint',
  ]) requireMethod(value.compiler, method, 'browserAdapters.compiler');
  return value;
}

function assertChain(value) {
  requireMethod(value, 'discover', 'chain');
  requireMethod(value, 'loadContext', 'chain');
  return value;
}

function productDiagnostic(cause) {
  return freeze({
    schemaVersion: MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA,
    severity: 'ERROR',
    layer: typeof cause?.layer === 'string' ? cause.layer.toUpperCase() : 'PRODUCT',
    code: typeof cause?.code === 'string' ? cause.code : 'MAKER_V8_PRODUCT_READ_FAILED',
    message: typeof cause?.message === 'string' && cause.message
      ? cause.message : 'Fresh-v8 product data could not be read.',
    rootId: null,
    makerKey: null,
    details: freeze({ ...(plain(cause?.details) ? cause.details : {}) }),
  });
}

/**
 * Create one isolated product read runtime. It intentionally omits the
 * transaction/sign/broadcast adapters even though the underlying browser
 * implementation can provide them to the separate execution controller.
 */
/** Resolve Pack parent only through the existing chain/manifest-certified catalog. */
export function createMakerV8PackParentLoaderV8(catalog) {
  requireMethod(catalog, 'loadPlayer', 'catalog');
  return async ({ rootId, rootVersion, rootContentCommitment }) => {
    const read = await catalog.loadPlayer(rootId);
    const player = read?.player;
    if (read?.status !== 'READY' || player?.lifecycle !== 'ACTIVE' || player.rootId !== rootId
      || player.makerVersion !== rootVersion || player.evidence?.contentCommitment !== rootContentCommitment
      || player.evidence.rootId !== rootId || player.evidence.makerVersion !== rootVersion) {
      fail('MAKER_V8_PRODUCT_PACK_PARENT_DRIFT', 'Pack parent differs from the certified active Maker version.');
    }
    const pointers = new Map((player.certifiedAssets || []).map(asset => [asset.assetId, asset]));
    if (pointers.size !== player.certifiedAssets?.length || pointers.size !== player.document.assets.length) {
      fail('MAKER_V8_PRODUCT_PACK_PARENT_DRIFT', 'Certified parent asset inventory differs.');
    }
    try { assertMakerV8PublishedSources(player.document, player.certifiedAssets); }
    catch { fail('MAKER_V8_PRODUCT_PACK_PARENT_DRIFT', 'Certified parent source identity differs.'); }
    const usages = new Map();
    for (const part of player.document.parts) for (const item of part.items) for (const style of item.styles) {
      const rows = usages.get(style.assetId) ?? [];
      rows.push(style);
      usages.set(style.assetId, rows);
    }
    const assets = player.document.assets.map(descriptor => {
      const asset = pointers.get(descriptor.id);
      const styles = usages.get(descriptor.id) ?? [];
      const protectedStyle = styles.find(style => style.protected);
      if (!asset || !/^[0-9a-f]{64}$/.test(asset.sha256)
        || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1
        || (protectedStyle
          ? styles.length !== 1 || asset.mediaType !== 'application/vnd.animacraft.seal-ciphertext'
          : asset.mediaType !== descriptor.mediaType || asset.byteLength !== descriptor.byteLength)) {
        fail('MAKER_V8_PRODUCT_PACK_PARENT_DRIFT', 'Certified parent asset descriptor differs.');
      }
      return { assetId: descriptor.id, kind: descriptor.kind, mediaType: descriptor.mediaType,
        byteLength: descriptor.byteLength,
        sha256: protectedStyle ? protectedStyle.payload[MAKER_V8_SOURCE_ASSET_KEY].sha256 : asset.sha256 };
    }).sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
    return freeze({ document: structuredClone(player.document), assets });
  };
}

export function createMakerV8ProductRuntime({
  runtime: runtimeInput,
  manifestFetcher,
  manifestAdapter = null,
  packManifestAdapter = null,
  assetAdapter = null,
  client: clientInput = null,
  browserAdapters: browserInput = null,
  chain: chainInput = null,
  walletRegistry,
  walletId = null,
  dataSource = null,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const manifests = manifestAdapter ?? createMakerV8ManifestAdapter({ fetcher: manifestFetcher });
  requireMethod(manifests, 'load', 'manifestAdapter');
  const certifiedAssets = assetAdapter
    ?? (typeof manifestFetcher === 'function'
      ? createMakerV8CertifiedAssetAdapter({ fetcher: manifestFetcher })
      : null);
  if (certifiedAssets) requireMethod(certifiedAssets, 'load', 'assetAdapter');
  const packManifests = packManifestAdapter
    ?? (typeof manifestFetcher === 'function'
      ? createMakerV8PackManifestReadAdapterV8({ fetcher: manifestFetcher,
        loadParent: binding => createMakerV8PackParentLoaderV8(catalog)(binding) })
      : null);
  if (packManifests) requireMethod(packManifests, 'load', 'packManifestAdapter');
  const client = clientInput
    ?? (browserInput && chainInput ? null : createProductionMakerV8SuiGrpcTransport());
  const browser = assertBrowserAdapters(browserInput ?? createProductionMakerV8BrowserAdapters({
    runtime,
    execution: MAKER_V8_PRODUCT_READ_ONLY_EXECUTION,
    client,
    ...(walletRegistry === undefined ? {} : { walletRegistry }),
    walletId,
    dataSource,
  }));

  let chainPromise = null;
  const resolveChain = async () => {
    if (chainInput) return assertChain(chainInput);
    if (!client) fail('MAKER_V8_PRODUCT_CHAIN_CLIENT_REQUIRED', 'A gRPC client or explicit chain adapter is required.');
    if (!chainPromise) {
      chainPromise = (async () => {
        const attested = await attestMakerV8Runtime(client, runtime);
        return createMakerV8ChainClient(attested.runtime, { rpc: client, network: 'mainnet' });
      })();
    }
    return chainPromise;
  };
  const chain = freeze({
    async discover() { return (await resolveChain()).discover(); },
    async loadContext(activation) { return (await resolveChain()).loadContext(activation); },
  });
  const catalog = createMakerV8CatalogAdapter({ chain, manifests });
  const lineage = freeze({
    load: (input) => catalog.loadLineage(input),
  });

  const wallet = freeze({
    getCurrentAccount: (...args) => browser.wallet.getCurrentAccount(...args),
    reconnect: (...args) => browser.wallet.reconnect(...args),
    subscribe: (...args) => browser.wallet.subscribe(...args),
    dispose: (...args) => browser.wallet.dispose(...args),
  });
  const inventory = freeze({
    async load(request = {}) {
      const address = request.address;
      if (typeof address !== 'string') {
        fail('MAKER_V8_PRODUCT_INVENTORY_ADDRESS_REQUIRED', 'A connected wallet address is required.');
      }
      const requestedRootId = request.rootId == null
        ? null : String(request.rootId).toLowerCase();
      if (requestedRootId !== null && !EXACT_ID.test(requestedRootId)) {
        fail('MAKER_V8_PRODUCT_INVENTORY_ROOT_INVALID', 'Root-scoped inventory requires one exact Maker Root ID.');
      }
      const resolved = await resolveChain();
      const activations = await resolved.discover();
      const candidates = requestedRootId === null ? activations : activations.filter((activation) => (
        String(activation?.binding?.rootId ?? '').toLowerCase() === requestedRootId
      ));
      if (requestedRootId !== null && candidates.length !== 1) {
        fail(
          'MAKER_V8_PRODUCT_INVENTORY_ROOT_INVALID',
          'Root-scoped inventory requires one exact activated Maker.',
          { rootId: requestedRootId, observed: candidates.length },
        );
      }
      const rows = [];
      const diagnostics = [];
      for (const activation of candidates) {
        try {
          const context = await resolved.loadContext(activation);
          if (!['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(context.root.lifecycle)) continue;
          const owned = await resolved.inventory(address, context.root);
          for (const admin of owned.adminCaps) {
            rows.push(freeze({
              id: admin.objectId,
              kind: 'MAKER_ADMIN',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([admin.objectId]),
              ownershipEpoch: null,
              sourceKind: null,
              sourceId: null,
              sourceTreasuryId: null,
              availableActions: freeze([]),
              lifecycleActions: freeze(context.root.lifecycle === 'ACTIVE'
                ? ['PAUSE', 'ARCHIVE', 'WITHDRAW_MAKER_REVENUE']
                : context.root.lifecycle === 'PAUSED'
                  ? ['RESUME', 'ARCHIVE', 'WITHDRAW_MAKER_REVENUE']
                  : ['WITHDRAW_MAKER_REVENUE']),
            }));
          }
          for (const pass of owned.makerAccessPasses ?? []) {
            rows.push(freeze({
              id: pass.objectId,
              kind: 'MAKER_ACCESS',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([pass.objectId]),
              ownershipEpoch: null,
              sourceKind: 'MAKER',
              sourceId: context.root.objectId,
              sourceTreasuryId: null,
              paidAtomic: pass.paidAtomic,
              issuedAtMs: pass.issuedAtMs,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
          for (const release of owned.packControls ?? []) {
            rows.push(freeze({
              id: release.objectId,
              kind: 'PACK_CONTROL',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([release.objectId, release.adminCap.objectId]),
              ownershipEpoch: release.adminCap.controlEpoch.toString(),
              sourceKind: 'PACK',
              sourceId: release.objectId,
              sourceTreasuryId: release.treasuryId,
              semanticPackId: release.semanticPackId,
              contentCommitment: release.contentCommitment,
              lifecycle: release.lifecycle,
              availableActions: freeze([]),
              lifecycleActions: freeze(['PAUSE', 'RESUME', 'ARCHIVE', 'WITHDRAW_PACK_REVENUE']),
            }));
          }
          for (const pass of owned.packPasses ?? []) {
            rows.push(freeze({
              id: pass.objectId,
              kind: 'PACK_ACCESS',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([pass.objectId]),
              ownershipEpoch: null,
              sourceKind: 'PACK',
              sourceId: pass.releaseId,
              sourceTreasuryId: null,
              contentCommitment: pass.releaseContentCommitment,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
          for (const product of owned.externalControls ?? []) {
            rows.push(freeze({
              id: product.objectId,
              kind: 'EXTERNAL_PRODUCT_CONTROL',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([product.objectId, product.adminCap.objectId]),
              ownershipEpoch: product.adminCap.controlEpoch.toString(),
              sourceKind: 'EXTERNAL',
              sourceId: product.objectId,
              sourceTreasuryId: null,
              contentCommitment: product.contentCommitment,
              assetContentCommitment: product.assetContentCommitment,
              lifecycle: product.lifecycle,
              availableActions: freeze([]),
              lifecycleActions: freeze(['PAUSE', 'RESUME', 'ARCHIVE', 'TRANSFER_CONTROL']),
            }));
          }
          for (const item of owned.ownedBaseItems ?? []) {
            rows.push(freeze({
              id: item.objectId,
              kind: 'OWNED_BASE_ITEM',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([item.objectId]),
              ownershipEpoch: item.ownershipEpoch.toString(),
              sourceKind: 'BASE',
              sourceId: context.root.binding.baseRegistryId,
              sourceTreasuryId: null,
              partKey: item.partKey,
              itemKey: item.itemKey,
              contentCommitment: item.itemPayloadCommitment,
              equipped: item.equipLock !== null,
              equipLock: item.equipLock,
              transferable: item.transferable,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
          for (const item of owned.ownedExternalItems ?? []) {
            rows.push(freeze({
              id: item.objectId,
              kind: 'OWNED_EXTERNAL_ITEM',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([item.objectId, item.product.objectId]),
              ownershipEpoch: item.ownershipEpoch.toString(),
              sourceKind: 'EXTERNAL',
              sourceId: item.productId,
              sourceTreasuryId: null,
              partKey: item.product.partKey,
              itemKey: item.product.itemKey,
              styleKey: item.product.styleKey,
              contentCommitment: item.assetContentCommitment,
              equipped: item.equipLock !== null,
              equipLock: item.equipLock,
              transferable: item.transferable,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
          for (const loadout of owned.makerLoadouts ?? []) {
            rows.push(freeze({
              id: loadout.objectId,
              kind: 'MAKER_LOADOUT',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([loadout.objectId]),
              ownershipEpoch: null,
              sourceKind: 'LOADOUT',
              sourceId: loadout.objectId,
              sourceTreasuryId: null,
              revision: loadout.revision.toString(),
              selectionCount: loadout.selectionCount.toString(),
              contentCommitment: loadout.commitment,
              selections: loadout.selections,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
          for (const bundle of owned.soulBundles) {
            rows.push(freeze({
              id: bundle.output.objectId,
              kind: 'SOUL_BUNDLE',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([
                bundle.output.objectId,
                bundle.receipt.objectId,
                bundle.soul.objectId,
              ]),
              ownershipEpoch: bundle.ownershipEpoch.toString(),
              sourceKind: null,
              sourceId: null,
              sourceTreasuryId: null,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
          for (const asset of owned.physicalAssets) {
            const base = asset.sourceKind === 0;
            rows.push(freeze({
              id: asset.objectId,
              kind: base ? 'PHYSICAL_BASE' : 'PHYSICAL_PACK',
              rootId: context.root.objectId,
              makerKey: context.root.makerKey,
              objectIds: freeze([asset.objectId]),
              ownershipEpoch: asset.ownershipEpoch.toString(),
              sourceKind: asset.sourceKind,
              sourceId: asset.sourceId,
              sourceTreasuryId: asset.sourceTreasuryId,
              availableActions: freeze([]),
              lifecycleActions: freeze([]),
            }));
          }
        } catch (error) {
          diagnostics.push(productDiagnostic(error));
        }
      }
      rows.sort((left, right) => left.id.localeCompare(right.id));
      return freeze({
        schemaVersion: 'animacraft.maker-v8-product-inventory.v1',
        status: diagnostics.length ? (rows.length ? 'DEGRADED' : 'ERROR') : (rows.length ? 'READY' : 'EMPTY'),
        address,
        rootId: requestedRootId,
        items: freeze(rows),
        diagnostics: freeze(diagnostics),
      });
    },
  });
  const loadPlayerContext = async (request = {}) => {
      const address = typeof request.address === 'string' ? request.address.toLowerCase() : '';
      const rootId = typeof request.rootId === 'string' ? request.rootId.toLowerCase() : '';
      if (!EXACT_ID.test(address) || !EXACT_ID.test(rootId)) {
        fail(
          'MAKER_V8_PRODUCT_CHOICE_CONTEXT_INVALID',
          'Contextual Player choices require one exact wallet and Maker Root.',
        );
      }
      const resolved = await resolveChain();
      const activations = await resolved.discover();
      const matches = activations.filter((activation) => (
        String(activation?.binding?.rootId ?? '').toLowerCase() === rootId
      ));
      if (matches.length !== 1) {
        fail(
          'MAKER_V8_PRODUCT_CHOICE_ROOT_INVALID',
          'Contextual Player choices require one exact activated Maker Root.',
          { rootId, observed: matches.length },
        );
      }
      const context = await resolved.loadContext(matches[0]);
      if (context?.root?.objectId !== rootId || context.root.lifecycle !== 'ACTIVE') {
        fail(
          'MAKER_V8_PRODUCT_CHOICE_ROOT_INACTIVE',
          'Contextual Player choices require the exact ACTIVE Maker Root.',
          { rootId, lifecycle: context?.root?.lifecycle ?? null },
        );
      }
      requireMethod(resolved, 'discoverPackReleases', 'chain');
      const [owned, publicPacks] = await Promise.all([
        resolved.inventory(address, context.root), resolved.discoverPackReleases(context.root),
      ]);
      const packStyles = [];
      const packDefinitions = [];
      const loadouts = owned.makerLoadouts ?? [];
      if (loadouts.length > 1) fail('MAKER_V8_PRODUCT_LOADOUT_AMBIGUOUS', 'Choose one exact Maker loadout before equipping Items.');
      const currentLoadout = loadouts[0] ?? null;
      const accessForItem = (item, admissionReason = '') => {
        let reason = admissionReason;
        let equippedInCurrentLoadout = false;
        const lock = item.equipLock;
        if (!Object.hasOwn(item, 'equipLock') || item.ownershipEpoch === undefined) reason ||= 'Item ownership or equip-lock state is unavailable.';
        else if (lock !== null) {
          const optional = currentLoadout?.selections?.[Number(lock.selectionIndex)];
          const unwrapped = optional?.fields ?? optional;
          const selected = Array.isArray(unwrapped?.vec) ? unwrapped.vec[0] : unwrapped;
          const row = selected?.fields ?? selected;
          const subject = row?.access_subject?.id ?? row?.access_subject;
          equippedInCurrentLoadout = Boolean(currentLoadout && lock.loadoutId === currentLoadout.objectId
            && String(row?.selection_index) === lock.selectionIndex && subject === item.objectId
            && Number(row?.source_class) === (item.productId ? 2 : 0)
            && (!item.productId || (row?.source_definition_id?.id ?? row?.source_definition_id) === item.productId)
            && row?.part_key === (item.product?.partKey ?? item.partKey)
            && row?.item_key === (item.product?.itemKey ?? item.itemKey)
            && (!item.productId || row?.style_key === item.product.styleKey)
            && String(row?.source_epoch) === String(item.ownershipEpoch)
            && /^[1-9][0-9]*$/.test(lock.equipRevision) && BigInt(lock.equipRevision) <= BigInt(currentLoadout.revision));
          if (!equippedInCurrentLoadout) reason ||= 'This Item is equipped in another loadout or its equip-lock proof is inconsistent.';
        }
        return freeze({ accessible: reason === '', canEquip: reason === '', reason,
          ownedLockAvailable: lock === null, equippedInCurrentLoadout });
      };
      const certifiedPackAssets = [];
      const diagnostics = [];
      const packChoices = new Map();
      for (const release of publicPacks) {
        const entry = release?.entry;
        if (!release || release.rootId !== rootId || release.lifecycle !== 2
          || release.admission?.admissionState !== 0 || packChoices.has(release.objectId)
          || ![0, 1, 2].includes(entry?.kind) || !/^(?:0|[1-9][0-9]*)$/.test(entry?.priceAtomic)
          || BigInt(entry.priceAtomic) > 1_000_000_000_000n
          || (entry.kind === 1 ? entry.priceAtomic === '0' : entry.priceAtomic !== '0')
          || entry.paymentCoinType !== runtime.paymentCoinType) {
          fail('MAKER_V8_PRODUCT_PACK_CHOICE_DRIFT', 'Public Pack choice lacks its exact ACTIVE admission or entry policy.');
        }
        packChoices.set(release.objectId, { release, owned: false });
      }
      for (const pass of owned.packPasses ?? []) {
        const release = pass.release;
        const publicChoice = packChoices.get(pass.releaseId);
        if (!release || release.rootId !== rootId || release.lifecycle !== 2
          || pass.releaseId !== release.objectId
          || pass.releaseContentCommitment !== release.contentCommitment
          || pass.admission?.admissionState !== 0 || !publicChoice
          || release.contentCommitment !== publicChoice.release.contentCommitment
          || release.manifestBlobId !== publicChoice.release.manifestBlobId
          || release.manifestSha256 !== publicChoice.release.manifestSha256
          || JSON.stringify(release.entry) !== JSON.stringify(publicChoice.release.entry)) {
          fail(
            'MAKER_V8_PRODUCT_PACK_CHOICE_DRIFT',
            'PackPass differs from its exact ACTIVE admitted Release.',
            { releaseId: pass.releaseId ?? null },
          );
        }
        publicChoice.owned = true;
      }
      const hasMakerAccess = (owned.makerAccessPasses ?? []).length > 0;
      for (const choice of packChoices.values()) {
        const { release } = choice;
        if (!packManifests) {
          fail(
            'MAKER_V8_PRODUCT_PACK_MANIFEST_READER_REQUIRED',
            'Pack choices require the certified Pack Manifest reader.',
          );
        }
        const read = await packManifests.load({
          blobId: release.manifestBlobId,
          sha256: release.manifestSha256,
          rootId,
          rootVersion: context.root.makerVersion.toString(),
          rootContentCommitment: context.root.contentCommitment,
          semanticPackId: release.semanticPackId,
          contentCommitment: release.contentCommitment,
        });
        const styles = read.manifest.content.styles;
        let definitionCommitment = null;
        let styleReferences = null;
        if (read.manifest.content.authoring) {
          // The manifest adapter has independently certified its parent. Reuse
          // the publication projection, including rules/visibility even when
          // every Style points only at Base Parts, Tracks and Colors.
          const authoring = read.manifest.content.authoring;
          const compiled = await compileMakerV8PackDefinitionRowsV8(authoring, {
            expectedParent: authoring.parent, semanticPackId: release.semanticPackId,
          });
          requireMethod(resolved, 'loadPackDefinitions', 'chain');
          const bundle = await resolved.loadPackDefinitions({
            releaseId: release.objectId, contentCommitment: release.contentCommitment,
            semanticPackId: release.semanticPackId,
          });
          const expectedHash = [...packDefinitionCommitmentV8(release.objectId,
            release.contentCommitment.match(/../g).map(value => parseInt(value, 16)), compiled.rows)]
            .map(byte => byte.toString(16).padStart(2, '0')).join('');
          if (bundle.releaseId !== release.objectId || bundle.contentCommitment !== release.contentCommitment
            || bundle.semanticPackId !== release.semanticPackId || bundle.definitionCommitment !== expectedHash
            || MAKER_V8_PACK_DEFINITION_ROWS_BCS.serialize(bundle.rows).toBase64()
              !== MAKER_V8_PACK_DEFINITION_ROWS_BCS.serialize(compiled.rows).toBase64()) {
            fail('MAKER_V8_PRODUCT_PACK_DEFINITIONS_DRIFT', 'Pack definitions differ from the certified author document.');
          }
          definitionCommitment = expectedHash;
          styleReferences = compiled.styleReferences;
          packDefinitions.push({ releaseId: release.objectId, semanticPackId: release.semanticPackId,
            contentCommitment: release.contentCommitment, definitionCommitment,
            document: structuredClone(authoring.document), styleReferences: structuredClone(styleReferences),
            ownedParts: structuredClone(compiled.ownedParts), rules: structuredClone(compiled.rules) });
        }
        if (String(styles.length) !== release.expectedStyleCount) {
          fail(
            'MAKER_V8_PRODUCT_PACK_STYLE_COUNT_DRIFT',
            'Pack Manifest Style count differs from the ACTIVE Release.',
            { releaseId: release.objectId, expected: release.expectedStyleCount, observed: styles.length },
          );
        }
        for (const style of styles) {
          const authoredDocument = read.manifest.content.authoring?.document;
          let render = null;
          // Plain Packs reference only Root definitions. Authored references are
          // resolved by the same validated projection used for publication.
          let definitionScope = {
            part: { source: 'BASE', sourceId: rootId, key: style.partKey },
            track: { source: 'BASE', sourceId: rootId, key: style.layerTrackKey },
            color: style.colorChannelKey === null ? null
              : { source: 'BASE', sourceId: rootId, key: style.colorChannelKey },
          };
          if (authoredDocument) {
            const refs = styleReferences.filter(row => row.sequence === style.sequence
              && row.part.key === style.partKey && row.itemKey === style.itemKey && row.styleKey === style.styleKey);
            const ref = refs[0];
            if (refs.length !== 1 || ref.track.key !== style.layerTrackKey
              || (ref.color?.key ?? null) !== style.colorChannelKey || ref.defaultSwatchKey !== style.defaultSwatchKey) {
              fail('MAKER_V8_PRODUCT_PACK_RENDER_DRIFT', 'Pack Style index differs from its validated definition references.');
            }
            const bind = reference => reference === null ? null : {
              source: reference.scope === 'BASE' ? 'BASE' : 'PACK',
              sourceId: reference.scope === 'BASE' ? rootId : release.objectId,
              key: reference.key,
            };
            definitionScope = { part: bind(ref.part), track: bind(ref.track), color: bind(ref.color) };
            const item = authoredDocument.parts.find(part => part.key === style.partKey)?.items.find(item => item.key === style.itemKey);
            const authored = item?.styles.find(row => row.key === style.styleKey);
            if (!authored || authored.assetId !== style.asset.assetId || authored.trackKey !== style.layerTrackKey
              || authored.protected !== style.asset.protected || authored.colorChannelKey !== style.colorChannelKey
              || authored.defaultSwatchKey !== style.defaultSwatchKey) {
              fail('MAKER_V8_PRODUCT_PACK_RENDER_DRIFT', 'Pack rendering definition differs from its certified Style index.');
            }
            render = structuredClone({ transform: authored.transform, opacity: authored.opacity,
              blendMode: authored.blendMode, displayOrder: authored.displayOrder,
              visibleWhen: authored.visibleWhen ?? null,
              sourceAsset: authored.payload.animacraftSourceAsset ?? null });
          }
          packStyles.push(freeze({
            source: 'PACK',
            id: `pack:${release.objectId}:${style.partKey}:${style.itemKey}:${style.styleKey}`,
            label: `${read.manifest.content.metadata.name} · ${style.styleKey}`,
            partKey: style.partKey,
            itemKey: style.itemKey,
            styleKey: style.styleKey,
            trackKey: style.layerTrackKey,
            colorChannelKey: style.colorChannelKey,
            defaultSwatchKey: style.defaultSwatchKey,
            releaseId: release.objectId,
            semanticPackId: release.semanticPackId,
            externalProductId: null,
            ownedExternalItemId: null,
            assetId: makerV8PackRenderAssetId(release.objectId, style.asset.assetId),
            protected: style.asset.protected,
            render,
            definitionCommitment,
            definitionScope,
            entry: freeze({ ...release.entry }),
            owned: choice.owned,
            access: freeze({
              accessible: choice.owned, canEquip: choice.owned,
              availableForAcquire: !choice.owned && (release.entry.kind !== 2 || hasMakerAccess),
              reason: choice.owned ? '' : release.entry.kind === 2
                ? hasMakerAccess ? 'Included with Maker access; claim this Pack before choosing its Styles.'
                  : 'This included Pack requires the exact MakerAccess entitlement before it can be claimed.'
                : release.entry.kind === 0 ? 'Claim this free Pack before choosing its Styles.'
                  : 'Purchase entry to this Pack before choosing its Styles.',
            }),
          }));
        }
        certifiedPackAssets.push(...read.assets.map(asset => ({ ...asset,
          assetId: makerV8PackRenderAssetId(release.objectId, asset.assetId) })));
      }
      const externalStyles = [];
      const certifiedExternalAssets = [];
      for (const item of owned.ownedExternalItems ?? []) {
        const product = item.product;
        if (!product || product.rootId !== rootId
          || product.objectId !== item.productId
          || product.contentCommitment !== item.productContentCommitment
          || product.assetContentCommitment !== item.assetContentCommitment) {
          fail(
            'MAKER_V8_PRODUCT_EXTERNAL_CHOICE_DRIFT',
            'Owned external Item differs from its exact ACTIVE Product.',
            { productId: item.productId ?? null },
          );
        }
        const assetId = `external-${product.objectId.slice(2)}`;
        const admissionReason = product.lifecycle !== 0 ? 'This external Product is not active.'
          : !product.admission ? 'This external Product has not been admitted to this Maker.'
            : product.admission.admissionState !== 0 ? 'This external Product admission is not active.' : '';
        externalStyles.push(freeze({
          source: 'EXTERNAL',
          id: `external:${item.objectId}`,
          label: `${product.itemKey} · ${product.styleKey}`,
          partKey: product.partKey,
          itemKey: product.itemKey,
          styleKey: product.styleKey,
          trackKey: product.trackKey,
          colorChannelKey: product.colorChannelKey,
          defaultSwatchKey: product.defaultSwatchKey,
          releaseId: null,
          semanticPackId: null,
          externalProductId: product.objectId,
          ownedExternalItemId: item.objectId,
          assetId,
          protected: false,
          owned: true, ownershipEpoch: String(item.ownershipEpoch), equipLock: structuredClone(item.equipLock),
          access: accessForItem(item, admissionReason),
        }));
        const asset = freeze({
          assetId,
          blobId: product.assetBlobId,
          mediaType: product.assetMediaType,
          byteLength: product.assetByteLength,
          sha256: product.assetSha256,
        });
        const existingAsset = certifiedExternalAssets.find(entry => entry.assetId === assetId);
        if (existingAsset && JSON.stringify(existingAsset) !== JSON.stringify(asset)) fail('MAKER_V8_PRODUCT_EXTERNAL_ASSET_DRIFT', 'Instances of one external Product disagree on certified asset content.');
        if (!existingAsset) certifiedExternalAssets.push(asset);
      }
      const baseEntitlements = (owned.ownedBaseItems ?? []).map((item) => freeze({
        ownedItemId: item.objectId,
        partKey: item.partKey,
        itemKey: item.itemKey,
        ownershipEpoch: item.ownershipEpoch.toString(),
        equipLock: structuredClone(item.equipLock), access: accessForItem(item),
      }));
      const sortChoices = (left, right) => left.id.localeCompare(right.id);
      packStyles.sort(sortChoices);
      externalStyles.sort(sortChoices);
      certifiedPackAssets.sort((left, right) => left.assetId.localeCompare(right.assetId));
      certifiedExternalAssets.sort((left, right) => left.assetId.localeCompare(right.assetId));
      baseEntitlements.sort((left, right) => left.ownedItemId.localeCompare(right.ownedItemId));
      const choiceBundle = freeze({
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address,
        rootId,
        baseEntitlements: freeze(baseEntitlements),
        packStyles: freeze(packStyles),
        externalStyles: freeze(externalStyles),
        certifiedAssets: freeze([...certifiedPackAssets, ...certifiedExternalAssets]
          .sort((left, right) => left.assetId.localeCompare(right.assetId))),
        diagnostics: freeze(diagnostics),
      });
      if (currentLoadout && (!EXACT_ID.test(currentLoadout.objectId)
        || currentLoadout.rootId !== rootId || currentLoadout.holder !== address
        || typeof currentLoadout.revision !== 'string'
        || !/^(0|[1-9][0-9]*)$/.test(currentLoadout.revision)
        || !currentLoadout.packDefinitionLayout)) {
        fail('MAKER_V8_PRODUCT_LOADOUT_LAYOUT_INVALID', 'Player definitions require the certified current Loadout layout.');
      }
      return freeze({ choices: choiceBundle, definitions: {
        schemaVersion: 'animacraft.maker-v8-player-definitions.v1', address, rootId,
        packs: packDefinitions,
        currentLoadout: currentLoadout === null ? null : {
          objectId: currentLoadout.objectId, revision: currentLoadout.revision,
          layout: structuredClone(currentLoadout.packDefinitionLayout),
        },
      } });
  };
  const playerContext = freeze({ load: loadPlayerContext });
  const choices = freeze({ async load(request) { return (await loadPlayerContext(request)).choices; } });
  const product = {
    schemaVersion: MAKER_V8_PRODUCT_RUNTIME_SCHEMA,
    runtime,
    capabilities: freeze({
      network: 'mainnet',
      transport: 'SUI_GRPC_GRAPHQL',
      readOnly: true,
      jsonRpc: false,
      legacyProtocol: false,
      walletSignature: false,
      broadcast: false,
    }),
    async ready() {
      const resolved = await resolveChain();
      if (typeof resolved.ready === 'function') await resolved.ready();
      return true;
    },
    catalog,
    lineage,
    wallet,
    inventory,
    choices,
    playerContext,
    compiler: browser.compiler,
  };
  if (certifiedAssets) {
    product.assets = freeze({
      schemaVersion: certifiedAssets.schemaVersion,
      load: (asset, options) => certifiedAssets.load(asset, options),
    });
  }
  return freeze(product);
}

/** Initialize or return the one application-wide Maker v8 product runtime. */
export function initializeMakerV8ProductRuntime(options) {
  if (singleton) {
    if (options === undefined || options === singletonOptions) return singleton;
    fail(
      'MAKER_V8_PRODUCT_SINGLETON_RECONFIGURE_FORBIDDEN',
      'The Maker v8 product runtime singleton cannot be silently reconfigured.',
    );
  }
  if (!plain(options)) {
    fail('MAKER_V8_PRODUCT_OPTIONS_REQUIRED', 'Maker v8 product runtime options are required for initialization.');
  }
  singletonOptions = options;
  singleton = createMakerV8ProductRuntime(options);
  return singleton;
}

/** Read the initialized application-wide runtime without creating a fallback. */
export function getMakerV8ProductRuntime() {
  if (!singleton) {
    fail(
      'MAKER_V8_PRODUCT_SINGLETON_UNINITIALIZED',
      'Initialize the Maker v8 product runtime before reading it.',
    );
  }
  return singleton;
}
