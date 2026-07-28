import {
  collectMakerV5ValidationIssues,
  createMakerV5Document,
  isMakerV5Document,
  MAKER_V5_LIMITS,
} from './maker-v4.js';
import {
  composeRuleTargets,
  createMakerRuleIndex,
  evaluateRecipe,
  normalizeRecipe,
  normalizeRuleSelector,
  ruleSelectorKey,
} from './maker-rules.js';
import {
  buildPlayerPartOptions,
  evaluatePlayerClearOptionalOption,
  evaluatePlayerItemOption,
  evaluatePlayerRemovePartOption,
  evaluatePlayerStyleOption,
  generatePlayablePlayerRecipe,
  normalizePlayablePlayerRecipe,
} from './maker-player-options.js';
import {
  checkExpansionPackCompatibility,
  compareMakerCompatibility,
  EXPANSION_PACK_SCHEMA,
  mergeExpansionPacks,
} from './expansion-packs.js';
import { evaluateVisibleWhen, renderResolvedScene, resolveMakerScene } from './maker-renderer.js';
import { createMakerCommandStore } from './maker-command-store.js';
import {
  addDocumentAsset,
  createGradientColorChannel,
  createItem,
  createLayerTrack,
  createPart,
  createStyle,
  duplicateItem,
  duplicatePart,
  duplicateStyle,
  effectiveStyleTransform,
  findItem,
  findPart,
  findStyle,
  linkedPartTrackPairs,
  linkedPartTrackOrderMatches,
  moveArrayEntry,
  normalizeDocumentOrders,
  partLayerTrackIds,
  partTrackLinkage,
  recipeSelectionMap,
  removeUnreferencedAssetMetadata,
  replaceRecipeSelection,
  synchronizeLinkedPartOrderFromTracks,
  synchronizeLinkedTrackOrderFromParts,
  synchronizeDefaultRecipe,
  uniqueDocumentId,
} from './maker-document-ops.js';
import {
  buildAssetImportMapping,
  buildProjectAssetImportMapping,
  collectTrackAlignmentWarnings,
  createAlphaCroppedThumbnail,
  createAssetId,
  createCachedAssetResolver,
  assertMakerAssetDimensions,
  inspectPngAsset,
  reviveRuntimeAssetRecord,
  revokeRuntimeAsset,
  runtimeAssetRecord,
} from './maker-assets.js';
import { createGradientColorProcessor } from './maker-color.js';
import { createMakerProjectArchive, readMakerProjectArchive } from './maker-project-archive.js';
import {
  buildMakerV4PublicationBundle,
  collectReferencedMakerV4AssetIds,
  MAKER_V4_EMBEDDED_EXPANSION_CONTAINER,
  MAKER_V4_EMBEDDED_EXPANSION_RUNTIME,
  MAKER_V4_MANIFEST_IDENTIFIER,
} from './maker-publication-v4.js';
import {
  SOUL_CONFIG_DOCUMENTS,
  resetSoulConfig,
  updateSoulConfig,
  validateSoulConfig,
} from './maker-soul-config.js';
import { resolveLivingContent } from './living-content.js';
import {
  loadPlayerWorkspaceSession,
  savePlayerWorkspaceSession,
} from './maker-workspace-store.js';
import { createMakerDraftRepository } from './maker-draft-repository.js';
import {
  clearMakerDraftWal,
  loadMakerDraftWal,
  makerDraftWalSnapshotsEqual,
  writeMakerDraftWal,
} from './maker-draft-wal.js';
import {
  clearPlayerSessionWal,
  listPlayerSessionWals,
  playerSessionWalSnapshotsEqual,
  writePlayerSessionWal,
} from './player-session-wal.js';
import {
  buildPlayerShareUrl,
  calculatePlayerExportSize,
  isPlayerOriginalExportSafe,
  safePngFilename,
} from './player-export.js';
import { makerWorkspaceText } from './maker-workspace-i18n.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function checked(value) {
  return value ? 'checked' : '';
}

function selected(value, expected) {
  return String(value ?? '') === String(expected ?? '') ? 'selected' : '';
}

function colorChannelHasLockedStyle(document, channelId) {
  if (!channelId) return false;
  return Boolean(document?.parts?.some((part) => part.items.some((item) => item.styles.some((style) => (
    style.styleLocked && style.colorChannelId === channelId
  )))));
}

function trackContainsLockedStyle(document, trackId) {
  if (!trackId) return false;
  return Boolean(document?.parts?.some((part) => part.items.some((item) => item.styles.some((style) => (
    style.styleLocked && style.layerTrackId === trackId
  )))));
}

function trackVisualOrderLocked(document, trackId) {
  const track = document?.layerTracks?.find((candidate) => candidate.id === trackId);
  return Boolean(track?.locked || trackContainsLockedStyle(document, trackId));
}

function trackOrderChangeCrossesLock(document, beforeTracks, afterTracks) {
  const afterIndex = new Map(afterTracks.map((track, index) => [track.id, index]));
  return beforeTracks.some((track, beforeIndex) => {
    const nextIndex = afterIndex.get(track.id);
    if (!Number.isInteger(nextIndex) || nextIndex === beforeIndex) return false;
    return beforeTracks
      .slice(Math.min(beforeIndex, nextIndex), Math.max(beforeIndex, nextIndex) + 1)
      .some((candidate) => trackVisualOrderLocked(document, candidate.id));
  });
}

function partMoveCrossesLockedLinkedTrack(document, fromIndex, toIndex) {
  if (!document || fromIndex === toIndex || fromIndex < 0 || toIndex < 0
    || fromIndex >= document.parts.length || toIndex >= document.parts.length) return false;
  const next = structuredClone(document);
  moveArrayEntry(next.parts, fromIndex, toIndex);
  synchronizeLinkedTrackOrderFromParts(next);
  return trackOrderChangeCrossesLock(document, document.layerTracks || [], next.layerTracks || []);
}

function linkedTrackOrderSyncCrossesLock(document) {
  const next = structuredClone(document);
  synchronizeLinkedTrackOrderFromParts(next);
  return trackOrderChangeCrossesLock(document, document.layerTracks || [], next.layerTracks || []);
}

function clone(value) {
  return structuredClone(value);
}

function workspacePausedEconomicsMetadata(value, fallbackMakerObjectId = '') {
  if (!value || typeof value !== 'object') return null;
  const rawMutation = value.pendingMutation;
  const mutationKind = String(rawMutation?.kind || '');
  const mutationCreatedAt = String(rawMutation?.createdAt || '');
  const pendingMutation = rawMutation
    && typeof rawMutation === 'object'
    && String(rawMutation.digest || '')
    && ['pause', 'archive', 'restore'].includes(mutationKind)
    && mutationCreatedAt
    && Number.isFinite(Date.parse(mutationCreatedAt))
    ? {
        digest: String(rawMutation.digest),
        kind: mutationKind,
        expectedMintingEnabled: Boolean(rawMutation.expectedMintingEnabled),
        expectedArchived: typeof rawMutation.expectedArchived === 'boolean'
          ? rawMutation.expectedArchived
          : null,
        createdAt: mutationCreatedAt,
      }
    : null;
  return {
    makerObjectId: String(value.makerObjectId || fallbackMakerObjectId),
    mintFeeEnabled: Boolean(value.mintFeeEnabled),
    mintPriceAtomic: Number(value.mintPriceAtomic || 0),
    royaltyBps: Number(value.royaltyBps || 0),
    makerUpdatedAtMs: String(value.makerUpdatedAtMs || ''),
    pendingMutation,
    capturedAt: String(value.capturedAt || ''),
  };
}

function workspacePersistenceMetadata(context, snapshot, walletAddress) {
  const rootMakerId = String(snapshot?.document?.version?.rootMakerId || '');
  const candidateBinding = context?.chainBinding;
  const bindingOwner = String(candidateBinding?.ownerWallet || '').trim();
  const bindingRootMakerId = String(candidateBinding?.rootMakerId || '').trim();
  const normalizedWallet = String(walletAddress || '').trim();
  // Treat the shell as untrusted input at the persistence boundary. A stale
  // callback must never relabel another wallet's AdminCap or OCMaker object.
  const rawBinding = candidateBinding
    && typeof candidateBinding === 'object'
    && bindingOwner
    && normalizedWallet
    && bindingOwner.toLowerCase() === normalizedWallet.toLowerCase()
    && bindingRootMakerId === rootMakerId
    ? candidateBinding
    : null;
  const publishedVersions = Array.isArray(rawBinding?.publishedVersions)
    ? rawBinding.publishedVersions.reduce((entries, rawVersion) => {
        if (!rawVersion || typeof rawVersion !== 'object') return entries;
        const makerObjectId = String(rawVersion.makerObjectId || '');
        const versionId = String(rawVersion.versionId || '');
        if (!makerObjectId || !versionId) return entries;
        const normalized = {
          rootMakerId: String(rawVersion.rootMakerId || rootMakerId),
          versionId,
          parentVersionId: String(rawVersion.parentVersionId || ''),
          versionNumber: Math.max(0, Math.floor(Number(rawVersion.versionNumber || 0))),
          profileOrder: Math.max(-1, Math.floor(Number(rawVersion.profileOrder ?? -1))),
          makerObjectId,
          makerTreasuryObjectId: String(rawVersion.makerTreasuryObjectId || ''),
          makerAdminCapObjectId: String(rawVersion.makerAdminCapObjectId || ''),
          publishDigest: String(rawVersion.publishDigest || ''),
          makerPreviousTransaction: String(rawVersion.makerPreviousTransaction || ''),
          archived: Boolean(rawVersion.archived),
          mintingEnabled: rawVersion.mintingEnabled !== false,
          mintFeeEnabled: Boolean(rawVersion.mintFeeEnabled),
          mintPriceAtomic: Number(rawVersion.mintPriceAtomic || 0),
          royaltyBps: Number(rawVersion.royaltyBps || 0),
          makerUpdatedAtMs: String(rawVersion.makerUpdatedAtMs || ''),
          current: Boolean(rawVersion.current),
          pausedEconomics: workspacePausedEconomicsMetadata(
            rawVersion.pausedEconomics,
            makerObjectId,
          ),
        };
        const previousIndex = entries.findIndex(
          (entry) => entry.makerObjectId.toLowerCase() === makerObjectId.toLowerCase(),
        );
        if (previousIndex >= 0) entries[previousIndex] = normalized;
        else entries.push(normalized);
        return entries;
      }, [])
    : [];
  const rawPausedEconomics = rawBinding?.pausedEconomics;
  const pausedEconomics = workspacePausedEconomicsMetadata(rawPausedEconomics);
  const chainBinding = rawBinding && typeof rawBinding === 'object'
    ? {
        schema: 'animacraft.chain-binding.v1',
        rootMakerId,
        ownerWallet: bindingOwner,
        makerObjectId: String(rawBinding.makerObjectId || ''),
        makerTreasuryObjectId: String(rawBinding.makerTreasuryObjectId || ''),
        makerAdminCapObjectId: String(rawBinding.makerAdminCapObjectId || ''),
        publishDigest: String(rawBinding.publishDigest || ''),
        archived: Boolean(rawBinding.archived),
        mintingEnabled: rawBinding.mintingEnabled !== false,
        mintFeeEnabled: Boolean(rawBinding.mintFeeEnabled),
        mintPriceAtomic: Number(rawBinding.mintPriceAtomic || 0),
        royaltyBps: Number(rawBinding.royaltyBps || 0),
        pausedEconomics,
        publishedVersions,
      }
    : null;
  const publishedDocument = isMakerV5Document(context?.publishedDocument)
    && context.publishedDocument.version.rootMakerId === rootMakerId
    ? clone(context.publishedDocument)
    : null;
  const publishedRecipe = publishedDocument
    ? clone(context?.publishedRecipe || publishedDocument.defaultRecipe)
    : null;
  return {
    makerVersionId: snapshot.document.version.versionId,
    rootMakerId,
    walletAddress,
    name: snapshot.document.metadata.name,
    chainBinding,
    publishedSnapshot: publishedDocument
      ? {
          document: publishedDocument,
          recipe: publishedRecipe,
        }
      : null,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function persistedAssetBlob(record) {
  const value = record?.blob || record?.file;
  return typeof Blob !== 'undefined' && value instanceof Blob ? value : null;
}

function persistedAssetUrl(value) {
  const url = String(value || '');
  return url && !url.startsWith('blob:') ? url : '';
}

function safeDisplayImageUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (source.startsWith('blob:')) return source;
  try {
    const base = globalThis.location?.origin || 'https://animacraft.soulidity.ai';
    const url = new URL(source, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function safeExternalLinkUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const base = globalThis.location?.origin || 'https://animacraft.soulidity.ai';
    const url = new URL(source, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

const PREFLIGHT_PNG_BYTES = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96, 96, 0,
  0, 0, 5, 0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

function publicationPreflightPngBlob() {
  return new Blob([PREFLIGHT_PNG_BYTES], { type: 'image/png' });
}

function publicationPreflightAssetBlob(record, descriptor) {
  const localBlob = persistedAssetBlob(record);
  if (localBlob) return localBlob;
  const remoteUrl = persistedAssetUrl(record?.url)
    || persistedAssetUrl(descriptor?.url)
    || persistedAssetUrl(descriptor?.legacy?.url);
  if (!remoteUrl) return null;
  // The synchronous Creator Preflight cannot download a remote Walrus Asset.
  // A real Blob placeholder lets the final bundle validator check the exact
  // immutable graph, identifiers, auxiliary entry, and file count. Step 1
  // still downloads and byte-validates the remote source before upload.
  return new Blob([], {
    type: String(descriptor?.mediaType || record?.type || 'application/octet-stream'),
  });
}

function runtimeAssetHasReadableSource(record) {
  return Boolean(record?.blob || record?.file || record?.url);
}

async function blobPayloadsEqual(left, right) {
  if (!left || !right || left.size !== right.size || left.type !== right.type) return false;
  const leftBytes = new Uint8Array(await left.arrayBuffer());
  const rightBytes = new Uint8Array(await right.arrayBuffer());
  if (leftBytes.length !== rightBytes.length) return false;
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function browserLocalStorage() {
  if (typeof globalThis.window === 'undefined') return null;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function browserWalWriterId() {
  if (typeof globalThis.window === 'undefined') {
    return globalThis.crypto?.randomUUID?.() || `maker-tab-${Date.now()}-${Math.random()}`;
  }
  const storageKey = 'animacraft-maker-wal-writer-v1';
  try {
    const existing = globalThis.sessionStorage?.getItem(storageKey);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || `maker-tab-${Date.now()}-${Math.random()}`;
    globalThis.sessionStorage?.setItem(storageKey, created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `maker-tab-${Date.now()}-${Math.random()}`;
  }
}

function browserPlayerWalWriterId() {
  return globalThis.crypto?.randomUUID?.()
    || `player-tab-${Date.now()}-${Math.random()}`;
}

function playerSessionRecordRevision(record) {
  return Number.isSafeInteger(record?.revision) && record.revision >= 0
    ? record.revision
    : null;
}

function debounce(callback, delay) {
  let timer = null;
  let pendingArgs = null;
  let running = Promise.resolve();
  const invoke = () => {
    const args = pendingArgs || [];
    pendingArgs = null;
    timer = null;
    const result = running.then(() => callback(...args));
    running = result.catch(() => undefined);
    return result;
  };
  const schedule = (...args) => {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void invoke();
    }, delay);
  };
  schedule.flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      return invoke();
    }
    return running;
  };
  schedule.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  schedule.pending = () => timer !== null;
  return schedule;
}

function safeFileName(value, fallback = 'asset') {
  return String(value || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || fallback;
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

const MAKER_INFO_FIELD_SPECS = Object.freeze({
  'maker-name': Object.freeze({
    path: 'metadata.name',
    labelKey: 'makerName',
    limit: MAKER_V5_LIMITS.maxNameBytes,
  }),
  'maker-creator': Object.freeze({
    path: 'metadata.creator',
    labelKey: 'makerCreator',
    limit: MAKER_V5_LIMITS.maxNameBytes,
  }),
  'maker-summary': Object.freeze({
    path: 'metadata.summary',
    labelKey: 'makerIntroduction',
    limit: MAKER_V5_LIMITS.maxDescriptionBytes,
  }),
  'maker-style': Object.freeze({
    path: 'metadata.style',
    labelKey: 'makerWorldStyle',
    limit: MAKER_V5_LIMITS.maxNameBytes,
  }),
  'maker-license-note': Object.freeze({
    path: 'metadata.license.note',
    labelKey: 'makerLicenseNote',
    limit: MAKER_V5_LIMITS.maxDescriptionBytes,
  }),
});

function makerInfoFieldByPath(path) {
  const entry = Object.entries(MAKER_INFO_FIELD_SPECS)
    .find(([, spec]) => spec.path === String(path || ''));
  return entry ? { action: entry[0], ...entry[1] } : null;
}

function styleSceneKey(partId, itemId, styleId) {
  return `${String(partId || '')}/${String(itemId || '')}/${String(styleId || '')}`;
}

function compactIssue(issue) {
  return {
    code: String(issue?.code || 'invalid'),
    path: String(issue?.path || ''),
    message: String(issue?.message || issue?.code || 'Invalid Maker data.'),
  };
}

function simpleVisibleWhenPartId(condition) {
  if (condition === undefined || condition === null || condition === true) return '';
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null;
  const keys = Object.keys(condition).filter((key) => condition[key] !== undefined);
  const supportedKeys = new Set(['op', 'partId', 'selected']);
  if (
    keys.some((key) => !supportedKeys.has(key))
    || !condition.partId
    || (condition.op && condition.op !== 'selected')
    || condition.selected === false
  ) return null;
  return String(condition.partId);
}

function ruleViolationCodes(result) {
  return [...new Set((result?.violations || []).map((issue) => String(issue?.code || '')).filter(Boolean))];
}

function recipeContainsSelection(recipe, expected) {
  return (recipe?.selections || []).some((selection) => (
    String(selection?.partId || '') === String(expected.partId)
    && String(selection?.itemId || '') === String(expected.itemId)
    && String(selection?.styleId || '') === String(expected.styleId)
  ));
}

export function enabledExpansionIdsForDocument(document, enabledIds = []) {
  const values = Array.isArray(enabledIds)
    ? enabledIds
    : enabledIds instanceof Set
      ? [...enabledIds]
      : [];
  const requested = new Set(values.map((value) => String(value || '')).filter(Boolean));
  return (document?.extensions?.expansionDrafts || [])
    .map((pack) => String(pack?.packId || ''))
    .filter((packId) => packId && requested.has(packId));
}

function resolvedPlayerColorChannelIds(document, recipe) {
  try {
    const scene = resolveMakerScene(document, recipe, { strict: false });
    return new Set(scene.layers
      .map((layer) => String(layer?.colorChannel?.id || ''))
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

function workspaceStyleRecords(document) {
  const base = (document?.parts || []).flatMap((part) => (part.items || []).flatMap((item) => (
    (item.styles || []).map((style) => ({
      style,
      part,
      item,
      packName: '',
      partName: part.name,
      itemName: item.name,
      path: `${part.id}/${item.id}/${style.id}`,
    }))
  )));
  const expansion = (document?.extensions?.expansionDrafts || []).flatMap((pack) => (
    [...(pack.parts || []), ...(pack.partExtensions || [])].flatMap((part) => (part.items || []).flatMap((item) => (
      (item.styles || []).map((style) => ({
        style,
        part,
        item,
        packName: pack.name || pack.packId,
        partName: part.name,
        itemName: item.name,
        path: `extensions.expansionDrafts.${pack.packId}/${part.id}/${item.id}/${style.id}`,
      }))
    )))
  ));
  return [...base, ...expansion];
}

function workspaceAssetDescriptor(document, assetId) {
  return (document?.assets || []).find((asset) => asset.id === assetId)
    || (document?.extensions?.expansionDrafts || [])
      .flatMap((pack) => pack.assets || [])
      .find((asset) => asset.id === assetId)
    || null;
}

function collectMakerRulePreflightIssues(document) {
  const issues = [];
  try {
    const index = createMakerRuleIndex(document);
    const defaultEvaluation = evaluateRecipe(document, document.defaultRecipe, { index });
    if (!defaultEvaluation.valid) {
      const violations = ruleViolationCodes(defaultEvaluation);
      issues.push({
        code: 'default_recipe_rule_violation',
        path: 'defaultRecipe',
        message: `The default Recipe violates Maker rules or visibility conditions${violations.length ? ` (${violations.join(', ')})` : ''}.`,
      });
    }

    const graphResult = normalizeRecipe(
      document,
      { selections: [], colors: document.defaultRecipe?.colors || [] },
      { index },
    );
    if (!graphResult.valid) {
      const exhausted = ruleViolationCodes(graphResult).includes('constraint-search-limit');
      issues.push({
        code: exhausted ? 'maker_rule_search_limit' : 'unsatisfiable_maker_rules',
        path: 'rules',
        message: exhausted
          ? 'Maker rule validation reached its safety limit. Simplify the rule graph before publication.'
          : 'No playable public Recipe satisfies this Maker rule graph.',
      });
      return issues;
    }

    let reachableStyleCount = 0;
    let inconclusiveStyleCount = 0;
    document.parts.forEach((part) => {
      (part.items || [])
        .filter((item) => item?.enabled !== false && String(item?.status || 'public').toLowerCase() === 'public')
        .forEach((item) => {
          let itemHasReachableStyle = false;
          let itemReachabilityConclusive = true;
          (item.styles || []).forEach((style) => {
            const expected = { partId: part.id, itemId: item.id, styleId: style.id };
            const candidateResult = normalizeRecipe(
              document,
              {
                selections: [expected],
                colors: document.defaultRecipe?.colors || [],
              },
              {
                index,
                lockedPartIds: [part.id],
              },
            );
            const reachable = candidateResult.valid
              && recipeContainsSelection(candidateResult.documentRecipe, expected);
            if (reachable) {
              itemHasReachableStyle = true;
              reachableStyleCount += 1;
              return;
            }
            const exhausted = ruleViolationCodes(candidateResult).includes('constraint-search-limit');
            if (exhausted) {
              itemReachabilityConclusive = false;
              inconclusiveStyleCount += 1;
              issues.push({
                code: 'maker_rule_search_limit',
                path: `${part.id}/${item.id}/${style.id}`,
                message: `${part.name} / ${item.name} / ${style.name} could not be proven reachable before the rule-search safety limit.`,
              });
              return;
            }
            issues.push({
              code: 'unreachable_public_style_rules',
              path: `${part.id}/${item.id}/${style.id}`,
              message: `${part.name} / ${item.name} / ${style.name} cannot appear in any valid player Recipe.`,
            });
          });
          if (!itemHasReachableStyle && itemReachabilityConclusive) {
            issues.push({
              code: 'unreachable_public_item_rules',
              path: `${part.id}/${item.id}`,
              message: `${part.name} / ${item.name} cannot appear in any valid player Recipe.`,
            });
          }
        });
    });

    if (reachableStyleCount === 0 && inconclusiveStyleCount === 0) {
      issues.push({
        code: 'unsatisfiable_maker_rules',
        path: 'rules',
        message: 'No public Style can appear in a playable Recipe for this Maker.',
      });
    }
  } catch (error) {
    issues.push({
      code: 'maker_rules_evaluation_failed',
      path: 'rules',
      message: error?.message || 'Maker rules could not be evaluated.',
    });
  }
  return issues;
}

function recipeWithColors(document, recipe) {
  const next = clone(recipe || { selections: [], colors: [] });
  next.selections ||= [];
  const requested = new Map((next.colors || []).map((entry) => [entry.channelId, entry.swatchId]));
  next.colors = document.colorChannels.flatMap((channel) => {
    const swatches = Array.isArray(channel.swatches) ? channel.swatches : [];
    const requestedSwatchId = requested.get(channel.id);
    const swatchId = swatches.some((swatch) => swatch.id === requestedSwatchId)
      ? requestedSwatchId
      : swatches.some((swatch) => swatch.id === channel.defaultSwatchId)
        ? channel.defaultSwatchId
        : swatches[0]?.id;
    return swatchId ? [{ channelId: channel.id, swatchId }] : [];
  });
  return next;
}

function itemContainsLockedStyle(item) {
  return Boolean(item?.styles?.some((style) => style.styleLocked));
}

function partContainsLockedStyle(part) {
  return Boolean(part?.items?.some(itemContainsLockedStyle));
}

function rewriteExpansionItemSelfReferences(value, partId, sourceItemId, copiedItemId) {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteExpansionItemSelfReferences(
      entry,
      partId,
      sourceItemId,
      copiedItemId,
    ));
  }
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  if (String(result.partId || '') === String(partId)) {
    if (String(result.itemId || '') === String(sourceItemId)) result.itemId = copiedItemId;
    if (Array.isArray(result.itemIds)) {
      result.itemIds = result.itemIds.map((itemId) => (
        String(itemId) === String(sourceItemId) ? copiedItemId : itemId
      ));
    }
  }
  [
    'condition',
    'conditions',
    'all',
    'any',
    'and',
    'or',
    'not',
    'requires',
    'excludes',
  ].forEach((field) => {
    if (result[field] !== undefined) {
      result[field] = rewriteExpansionItemSelfReferences(
        result[field],
        partId,
        sourceItemId,
        copiedItemId,
      );
    }
  });
  return result;
}

function rewriteExpansionOwnerSelfReferences(owner, partId, sourceItemId, copiedItemId) {
  owner.requires = rewriteExpansionItemSelfReferences(
    owner.requires || [],
    partId,
    sourceItemId,
    copiedItemId,
  );
  owner.excludes = rewriteExpansionItemSelfReferences(
    owner.excludes || [],
    partId,
    sourceItemId,
    copiedItemId,
  );
  owner.visibleWhen = rewriteExpansionItemSelfReferences(
    owner.visibleWhen,
    partId,
    sourceItemId,
    copiedItemId,
  );
}

function pruneDeletedRuleSelector(target, deleted) {
  if (typeof target === 'string') {
    try {
      return pruneDeletedRuleSelector(normalizeRuleSelector(target), deleted);
    } catch {
      return target;
    }
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) return target;
  if (String(target.partId || '') !== String(deleted.partId || '')) return target;
  if (!deleted.itemId) return null;

  const result = { ...target };
  if (result.itemId && String(result.itemId) === String(deleted.itemId)) {
    if (!deleted.styleId) return null;
    if (result.styleId && String(result.styleId) === String(deleted.styleId)) return null;
    if (Array.isArray(result.styleIds)) {
      result.styleIds = result.styleIds.filter(
        (styleId) => String(styleId) !== String(deleted.styleId),
      );
      if (!result.styleIds.length) return null;
    }
    return result;
  }

  if (Array.isArray(result.itemIds)) {
    if (!deleted.styleId) {
      result.itemIds = result.itemIds.filter(
        (itemId) => String(itemId) !== String(deleted.itemId),
      );
      if (!result.itemIds.length) return null;
    }
    return result;
  }
  return result;
}

function pruneDeletedVisibilityCondition(condition, deleted) {
  if (Array.isArray(condition)) {
    return condition
      .map((entry) => pruneDeletedVisibilityCondition(entry, deleted))
      .filter((entry) => entry !== null);
  }
  if (typeof condition === 'string') return pruneDeletedRuleSelector(condition, deleted);
  if (!condition || typeof condition !== 'object') return condition;
  if (condition.op === 'selected' || condition.partId) {
    return pruneDeletedRuleSelector(condition, deleted);
  }
  if (condition.op === 'not') {
    const nested = pruneDeletedVisibilityCondition(condition.condition, deleted);
    return nested === null ? null : { ...condition, condition: nested };
  }
  if (condition.op === 'all' || condition.op === 'any') {
    const conditions = pruneDeletedVisibilityCondition(condition.conditions || [], deleted);
    return conditions.length ? { ...condition, conditions } : null;
  }
  const result = { ...condition };
  let hasConditionField = false;
  ['all', 'any', 'and', 'or', 'requires', 'excludes'].forEach((field) => {
    if (result[field] === undefined) return;
    hasConditionField = true;
    result[field] = pruneDeletedVisibilityCondition(result[field], deleted);
  });
  if (result.not !== undefined) {
    hasConditionField = true;
    result.not = pruneDeletedVisibilityCondition(result.not, deleted);
  }
  if (
    hasConditionField
    && ['all', 'any', 'and', 'or', 'requires', 'excludes'].every(
      (field) => result[field] === undefined || result[field]?.length === 0,
    )
    && (result.not === undefined || result.not === null || result.not?.length === 0)
  ) return null;
  return result;
}

function pruneDeletedOwnerReferences(owner, deleted) {
  owner.requires = (owner.requires || [])
    .map((target) => pruneDeletedRuleSelector(target, deleted))
    .filter(Boolean);
  owner.excludes = (owner.excludes || [])
    .map((target) => pruneDeletedRuleSelector(target, deleted))
    .filter(Boolean);
  owner.visibleWhen = pruneDeletedVisibilityCondition(owner.visibleWhen, deleted);
}

function pruneDeletedDefinitionReferences(document, deleted) {
  document.parts.forEach((part) => {
    pruneDeletedOwnerReferences(part, deleted);
    part.items.forEach((item) => {
      pruneDeletedOwnerReferences(item, deleted);
      item.styles.forEach((style) => pruneDeletedOwnerReferences(style, deleted));
    });
  });
  document.rules = (document.rules || []).flatMap((rule) => {
    const triggerField = ['trigger', 'when', 'if', 'source', 'left']
      .find((field) => rule[field] !== undefined)
      || 'trigger';
    const trigger = pruneDeletedRuleSelector(
      rule[triggerField],
      deleted,
    );
    if (!trigger) return [];
    const targetField = Array.isArray(rule.targets)
      ? 'targets'
      : rule.type === 'requires' || rule.requires
        ? 'requires'
        : 'excludes';
    const existingTargets = rule[targetField] ?? rule.target ?? rule.right;
    const targets = (Array.isArray(existingTargets) ? existingTargets : [existingTargets])
      .map((target) => pruneDeletedRuleSelector(target, deleted))
      .filter(Boolean);
    if (!targets.length) return [];
    return [{
      ...rule,
      [triggerField]: trigger,
      ...(Object.hasOwn(rule, targetField) ? { [targetField]: targets } : { targets }),
    }];
  });
}

function ownerRuleRows(document) {
  const rows = [];
  document.parts.forEach((part) => {
    ['requires', 'excludes'].forEach((type) => (part[type] || []).forEach((target, index) => rows.push({
      id: `part:${part.id}:${type}:${index}`,
      ownerType: 'part',
      ownerPartId: part.id,
      ownerItemId: '',
      ownerStyleId: '',
      ownerName: part.name,
      type,
      target,
      index,
    })));
    part.items.forEach((item) => {
      ['requires', 'excludes'].forEach((type) => (item[type] || []).forEach((target, index) => rows.push({
        id: `item:${part.id}:${item.id}:${type}:${index}`,
        ownerType: 'item',
        ownerPartId: part.id,
        ownerItemId: item.id,
        ownerStyleId: '',
        ownerName: `${part.name} / ${item.name}`,
        type,
        target,
        index,
      })));
      item.styles.forEach((style) => {
        ['requires', 'excludes'].forEach((type) => (style[type] || []).forEach((target, index) => rows.push({
          id: `style:${part.id}:${item.id}:${style.id}:${type}:${index}`,
          ownerType: 'style',
          ownerPartId: part.id,
          ownerItemId: item.id,
          ownerStyleId: style.id,
          ownerName: `${part.name} / ${item.name} / ${style.name}`,
          type,
          target,
          index,
        })));
      });
    });
  });
  return rows;
}

function ownerRuleGroups(document) {
  const groups = new Map();
  ownerRuleRows(document).forEach((row) => {
    const key = [row.ownerType, row.ownerPartId, row.ownerItemId, row.ownerStyleId, row.type].join('\u0000');
    const group = groups.get(key) || {
      key,
      ownerType: row.ownerType,
      ownerPartId: row.ownerPartId,
      ownerItemId: row.ownerItemId,
      ownerStyleId: row.ownerStyleId,
      ownerName: row.ownerName,
      type: row.type,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  });
  return [...groups.values()];
}

function ruleTargetSummary(document, target) {
  const selector = normalizeRuleSelector(target);
  const part = findPart(document, selector.partId);
  const itemIds = selector.itemId ? [selector.itemId] : selector.itemIds || [];
  const item = itemIds.length === 1 ? findItem(document, selector.partId, itemIds[0]) : null;
  const styleIds = selector.styleId ? [selector.styleId] : selector.styleIds || [];
  if (styleIds.length && item) {
    const names = styleIds.map((styleId) => item.styles.find((style) => style.id === styleId)?.name || styleId);
    return {
      any: styleIds.length > 1,
      label: [part?.name || selector.partId, item.name, names.join(' / ')].join(' › '),
    };
  }
  if (itemIds.length) {
    const names = itemIds.map((itemId) => findItem(document, selector.partId, itemId)?.name || itemId);
    return {
      any: itemIds.length > 1,
      label: [part?.name || selector.partId, names.join(' / ')].join(' › '),
    };
  }
  return { any: false, label: part?.name || selector.partId };
}

export function ruleOwnerFromDefinition(document, definition) {
  const [partId = '', itemId = '', styleId = ''] = String(definition || '').split('::');
  const part = findPart(document, partId);
  if (!part) return null;
  if (!itemId) return part;
  const item = findItem(document, partId, itemId);
  if (!item) return null;
  if (!styleId) return item;
  return findStyle(document, partId, itemId, styleId);
}

function defaultExpansion(document, index) {
  const packId = uniqueDocumentId(`expansion-${index + 1}`, [document.extensions?.expansionDrafts || []], 'expansion');
  return {
    schemaVersion: EXPANSION_PACK_SCHEMA,
    packId,
    namespace: `pack${index + 1}`,
    name: `Expansion ${index + 1}`,
    version: '1.0.0',
    baseMakerId: document.version.rootMakerId,
    baseVersion: String(document.version.number),
    layerTracks: [],
    colorChannels: [],
    assets: [],
    parts: [],
    rules: [],
  };
}

export class MakerWorkspace {
  constructor(options = {}) {
    this.creatorRoot = options.creatorRoot || null;
    this.playerRoot = options.playerRoot || null;
    this.callbacks = options.callbacks || {};
    this.locale = options.locale || 'en';
    this.context = null;
    this.store = null;
    this.draftRepository = options.draftRepository || createMakerDraftRepository();
    this.loadPlayerSessionRecord = options.loadPlayerSessionRecord || loadPlayerWorkspaceSession;
    this.savePlayerSessionRecord = options.savePlayerSessionRecord || savePlayerWorkspaceSession;
    this.unsubscribe = null;
    this.assets = new Map();
    this.assetResolver = createCachedAssetResolver(this.assets);
    this.applyColorChannel = createGradientColorProcessor();
    this.rulePreflightCache = new WeakMap();
    this.releasePreflightCache = new WeakMap();
    this.creatorTab = 'structure';
    this.selectedPartId = '';
    this.selectedItemId = '';
    this.selectedStyleId = '';
    this.selectedTrackId = '';
    this.selectedChannelId = '';
    this.selectedSoulDocumentKey = 'soulMd';
    this.playerPartId = '';
    this.creatorRecipe = { selections: [], colors: [] };
    this.playerRecipe = { selections: [], colors: [] };
    this.playerUndo = [];
    this.playerRedo = [];
    this.playerCreatorPreview = false;
    this.playerProfile = { name: 'Untitled OC', world: '', description: '', tags: '' };
    this.playerLivingContent = null;
    this.playerSaveState = 'idle';
    this.playerSaveError = '';
    this.playerSaveErrorCode = '';
    this.playerSavedAt = 0;
    this.playerSessionRevision = 0;
    this.playerQueuedRevision = 0;
    this.playerPersistedRevision = null;
    this.playerSessionContextKey = '';
    this.playerSessionContextVersionId = '';
    this.playerSessionContextDocument = null;
    this.playerSessionRequestId = 0;
    this.playerSessionSwitchInProgress = false;
    this.playerSessionTransitionPromise = Promise.resolve();
    this.playerPersistedRevisions = new Map();
    this.playerRecoveredWriteAhead = null;
    this.playerRecoveryBranches = [];
    this.playerRecoverySelectedWriterId = '';
    this.playerSaveConflictRevision = null;
    this.playerSaveQueue = Promise.resolve();
    this.playerRenderState = { key: '', status: 'idle', error: '' };
    this.playerIntroOpen = false;
    this.playerExportOpen = false;
    this.playerExportIntent = 'download';
    this.playerExportSizeMode = 'standard';
    this.playerExportTransparent = false;
    this.playerExportState = 'idle';
    this.playerExportError = '';
    this.playerExportPreviewUrl = '';
    this.playerExportPreviewBlob = null;
    this.playerExportDimensions = null;
    this.playerExportSnapshot = null;
    this.playerExportRequestId = 0;
    this.playerExportAbortController = null;
    this.playerShareState = 'idle';
    this.creatorPublishOpen = false;
    this.creatorPublishState = {
      stage: 'idle',
      status: '',
      busy: false,
      digest: '',
      error: null,
      relayTipMist: null,
      relayTipQuotedAt: '',
      walrusStorageCostFrost: null,
      walrusWriteCostFrost: null,
      walrusTotalCostFrost: null,
      actions: {},
    };
    this.creatorPublishCloseConfirm = false;
    this.creatorPublishCopyState = 'idle';
    this.versionHistoryOpen = false;
    this.versionHistoryStatus = 'idle';
    this.versionHistoryEntries = [];
    this.versionHistoryError = '';
    this.versionHistoryMessage = '';
    this.versionHistoryRequestId = 0;
    this.restoringCheckpointRevision = null;
    this.playerPublishOpen = false;
    this.playerPublishState = {
      stage: 'idle',
      status: '',
      busy: false,
      digest: '',
      error: null,
      relayTipMist: null,
      relayTipQuotedAt: '',
      walrusStorageCostFrost: null,
      walrusWriteCostFrost: null,
      walrusTotalCostFrost: null,
      actions: {},
    };
    this.playerPublishCloseConfirm = false;
    this.playerPublishCopyState = 'idle';
    this.enabledExpansionIds = new Set();
    this.pendingImport = null;
    this.pendingCreatorText = null;
    this.ruleBuilderError = '';
    this.creatorZoom = 1;
    this.creatorSpacePressed = false;
    this.creatorPreviewMode = 'all';
    this.hiddenStyleKeys = new Set();
    this.creatorHiddenPartIds = new Set();
    this.editingPositionStyleKey = '';
    this.dragPreview = null;
    this.styleScalePreview = null;
    this.dragSort = null;
    this.renderAbort = { creator: null, player: null };
    this.contextEpoch = 0;
    this.contextRequestId = 0;
    this.contextSwitchInProgress = false;
    this.restoreInProgress = false;
    this.restoreError = '';
    this.lifecycleMutationMakerKeys = new Set();
    this.deletedMakerKeys = new Set();
    this.walStorage = Object.hasOwn(options, 'walStorage')
      ? options.walStorage
      : browserLocalStorage();
    this.walWriterId = String(options.walWriterId || browserWalWriterId());
    this.playerWalWriterId = String(
      options.playerWalWriterId || browserPlayerWalWriterId(),
    );
    this.recoveryWriteAhead = null;
    this.writeAheadError = '';
    this.textAutosave = debounce(() => this.flushPendingCreatorText(), 300);
    this.autosave = debounce(() => this.save({ automatic: true }), 850);
    this.sessionAutosave = debounce(() => this.savePlayerSession(), 500);
    this.boundCreatorClick = (event) => this.handleCreatorClick(event);
    this.boundCreatorChange = (event) => {
      const operation = this.captureMakerOperation();
      Promise.resolve(this.handleCreatorChange(event)).catch((error) => {
        if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
        const message = error.message || this.tr('assetImportFailed');
        this.store?.setSaveState('error', message);
        this.callbacks.onCreatorError?.(error);
      });
    };
    this.boundCreatorInput = (event) => this.handleCreatorInput(event);
    this.boundCreatorFocusout = (event) => {
      if (this.captureCreatorText(event.target)) this.flushPendingCreatorText();
    };
    this.boundCreatorKeydown = (event) => {
      if (this.handlePublishDialogKeydown('creator', event)) return;
      if (this.creatorTab !== 'structure') {
        if (event.key === 'Tab') {
          this.trapModalFocus(
            this.creatorRoot?.querySelector('#makerV4ToolDialog'),
            event,
          );
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault?.();
          this.openCreatorTab('structure');
          return;
        }
      }
      const editingText = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (event.code === 'Space' && !editingText) {
        this.creatorSpacePressed = true;
        this.creatorRoot?.querySelector('.v4-canvas-viewport')?.classList.add('pan-ready');
        event.preventDefault?.();
        return;
      }
      if (event.key === 'Escape' && this.versionHistoryOpen) this.closeVersionHistory();
    };
    this.boundCreatorKeyup = (event) => {
      if (event.code !== 'Space') return;
      this.creatorSpacePressed = false;
      this.creatorRoot?.querySelector('.v4-canvas-viewport')?.classList.remove('pan-ready');
    };
    this.boundPlayerClick = (event) => this.handlePlayerClick(event);
    this.boundPlayerChange = (event) => this.handlePlayerChange(event);
    this.boundPlayerKeydown = (event) => {
      if (this.handlePublishDialogKeydown('player', event)) return;
      if (this.playerExportOpen) {
        if (event.key === 'Tab') {
          this.trapModalFocus(
            this.playerRoot?.querySelector('#makerPlayerExportDialog'),
            event,
          );
        } else if (event.key === 'Escape') {
          event.preventDefault?.();
          this.closePlayerExport();
        }
        return;
      }
      if (this.handlePlayerRadioKeydown(event)) return;
      if (!this.playerIntroOpen) return;
      if (event.key === 'Tab') {
        this.trapModalFocus(
          this.playerRoot?.querySelector('#makerPlayerInfoDialog'),
          event,
        );
      } else if (event.key === 'Escape') {
        event.preventDefault?.();
        this.closePlayerInfo();
      }
    };
    this.attachRootListeners();
    this.renderEmpty();
  }

  attachRootListeners() {
    if (this.creatorRoot) {
      this.creatorRoot.addEventListener('click', this.boundCreatorClick);
      this.creatorRoot.addEventListener('change', this.boundCreatorChange);
      this.creatorRoot.addEventListener('input', this.boundCreatorInput);
      this.creatorRoot.addEventListener('focusout', this.boundCreatorFocusout);
      this.creatorRoot.addEventListener('keydown', this.boundCreatorKeydown);
      this.creatorRoot.addEventListener('keyup', this.boundCreatorKeyup);
      this.creatorRoot.addEventListener('dragstart', (event) => this.handleDragStart(event));
      this.creatorRoot.addEventListener('dragover', (event) => this.handleDragOver(event));
      this.creatorRoot.addEventListener('drop', (event) => this.handleDrop(event));
    }
    if (this.playerRoot) {
      this.playerRoot.addEventListener('click', this.boundPlayerClick);
      this.playerRoot.addEventListener('change', this.boundPlayerChange);
      this.playerRoot.addEventListener('input', this.boundPlayerChange);
      this.playerRoot.addEventListener('keydown', this.boundPlayerKeydown);
    }
  }

  renderEmpty() {
    const copy = `<div class="v4-empty"><strong>${escapeHtml(this.tr('selectOrCreateMaker'))}</strong><span>${escapeHtml(this.tr('emptyMakerCopy'))}</span></div>`;
    if (this.creatorRoot) this.creatorRoot.innerHTML = copy;
    if (this.playerRoot) this.playerRoot.innerHTML = copy;
  }

  get makerKey() {
    return String(this.context?.makerKey || '');
  }

  get creatorPersistenceEnabled() {
    return this.context?.creatorPersistenceEnabled !== false;
  }

  get playerSessionKey() {
    if (this.playerSessionContextKey) return this.playerSessionContextKey;
    const wallet = String(this.context?.walletAddress || 'wallet');
    const version = String(this.runtimeDocument()?.version?.versionId || this.context?.versionId || this.makerKey);
    return `${wallet}::${version}`;
  }

  playerSessionKeyForDocument(document = this.store?.getState().document) {
    const wallet = String(this.context?.walletAddress || '');
    const version = String(document?.version?.versionId || '');
    return wallet && version ? `${wallet}::${version}` : '';
  }

  resetPlayerSessionPersistence({
    sessionKey = '',
    versionId = '',
    document = null,
    state = 'idle',
  } = {}) {
    this.playerSessionContextKey = String(sessionKey || '');
    this.playerSessionContextVersionId = String(versionId || '');
    this.playerSessionContextDocument = document ? clone(document) : null;
    this.playerSaveState = state;
    this.playerSaveError = '';
    this.playerSaveErrorCode = '';
    this.playerSavedAt = 0;
    this.playerSessionRevision = 0;
    this.playerQueuedRevision = 0;
    this.playerPersistedRevision = null;
    this.playerRecoveredWriteAhead = null;
    this.playerRecoveryBranches = [];
    this.playerRecoverySelectedWriterId = '';
    this.playerSaveConflictRevision = null;
  }

  documentMutationBlocked() {
    return Boolean(
      !this.creatorPersistenceEnabled
      || this.lifecycleMutationMakerKeys.has(this.makerKey)
      || this.deletedMakerKeys.has(this.makerKey)
      || this.callbacks.canMutateDocument?.() === false
    );
  }

  documentMutationBlockedMessage() {
    return String(this.callbacks.documentMutationBlockedMessage?.() || this.tr('workspaceRestoreBlocked'));
  }

  runtimeAsset(assetId) {
    const direct = this.assets.get(assetId);
    if (direct) return direct;
    const separator = String(assetId || '').indexOf('__');
    if (separator > 0) return this.assets.get(String(assetId).slice(separator + 2)) || null;
    return null;
  }

  runtimeDocument() {
    if (!this.store) return null;
    const document = this.store.getState().document;
    const drafts = document.extensions?.expansionDrafts || [];
    const enabled = drafts.filter((pack) => this.enabledExpansionIds.has(pack.packId));
    if (!enabled.length) return document;
    const result = mergeExpansionPacks(document, enabled, { returnResult: true });
    return result.compatible ? result.maker : document;
  }

  normalizeDocument(document) {
    document.extensions ||= {};
    document.extensions.expansionDrafts ||= [];
    document.layerTracks ||= [];
    document.colorChannels ||= [];
    document.parts ||= [];
    document.assets ||= [];
    document.expansionPacks ||= [];
    normalizeDocumentOrders(document);
    synchronizeDefaultRecipe(document);
    return document;
  }

  runtimeAssetsForContext(context, document) {
    const suppliedAssets = context.assets instanceof Map
      ? [...context.assets.values()]
      : Array.from(context.assets || []);
    const nextAssets = new Map();
    suppliedAssets.forEach((record) => {
      const assetId = String(record.assetId || record.id || record.identifier || '');
      if (!assetId) return;
      const revived = record.url || record.thumbnailUrl
        ? { ...record, assetId }
        : reviveRuntimeAssetRecord({
            ...record,
            assetId,
            blob: record.blob || record.file,
          });
      nextAssets.set(assetId, revived);
    });
    document.assets.forEach((descriptor) => {
      if (nextAssets.has(descriptor.id)) return;
      const supplied = suppliedAssets.find((asset) => (
        [asset.id, asset.assetId, asset.identifier].includes(descriptor.id)
        || asset.identifier === descriptor.identifier
      ));
      if (supplied) {
        const blob = supplied.blob || supplied.file;
        nextAssets.set(descriptor.id, supplied.url
          ? { ...supplied, assetId: descriptor.id, blob }
          : reviveRuntimeAssetRecord({ ...supplied, assetId: descriptor.id, blob }));
      } else if (descriptor.url || descriptor.legacy?.url) {
        nextAssets.set(descriptor.id, {
          assetId: descriptor.id,
          url: descriptor.url || descriptor.legacy.url,
          thumbnailUrl: descriptor.thumbnailUrl || '',
          width: descriptor.width,
          height: descriptor.height,
          identifier: descriptor.identifier,
          source: 'remote',
        });
      }
    });
    return nextAssets;
  }

  replaceRuntimeAssets(nextAssets) {
    const retainedObjectUrls = new Set(
      [...nextAssets.values()]
        .flatMap((record) => [record?.url, record?.thumbnailUrl])
        .filter((url) => String(url || '').startsWith('blob:')),
    );
    this.assets.forEach((record) => {
      [record?.url, record?.thumbnailUrl].forEach((url) => {
        if (
          String(url || '').startsWith('blob:')
          && !retainedObjectUrls.has(url)
        ) URL.revokeObjectURL(url);
      });
    });
    this.assetResolver.clear();
    this.assets = nextAssets;
    this.assetResolver = createCachedAssetResolver(this.assets);
    this.rulePreflightCache = new WeakMap();
    this.releasePreflightCache = new WeakMap();
  }

  async setContext(context) {
    const contextRequestId = ++this.contextRequestId;
    const requestedMakerKey = String(context?.makerKey || '');
    const previousMakerKey = this.makerKey;
    const sameMaker = Boolean(requestedMakerKey && previousMakerKey === requestedMakerKey);

    if (!requestedMakerKey) {
      if (previousMakerKey) {
        this.contextSwitchInProgress = true;
        while (this.playerSessionSwitchInProgress) {
          await this.playerSessionTransitionPromise;
        }
        await this.sessionAutosave.flush();
        this.sessionAutosave.cancel();
        this.textAutosave.cancel();
        this.flushPendingCreatorText();
        try {
          const flushed = await this.flushPendingChanges({ reason: 'clear-context' });
          if (!flushed.saved) throw new Error(this.store?.getState().saveMessage || this.tr('saveFailed'));
        } catch (error) {
          if (contextRequestId !== this.contextRequestId) return;
          this.contextSwitchInProgress = false;
          throw error;
        }
      }
      if (contextRequestId !== this.contextRequestId) return;
      this.contextEpoch += 1;
      this.contextSwitchInProgress = false;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.context = null;
      this.store = null;
      this.resetPlayerExport();
      this.enabledExpansionIds = new Set();
      this.playerLivingContent = null;
      this.playerSessionRequestId += 1;
      this.playerSessionSwitchInProgress = false;
      this.resetPlayerSessionPersistence();
      this.playerRenderState = { key: '', status: 'idle', error: '' };
      this.renderEmpty();
      return;
    }

    if (!sameMaker && previousMakerKey) {
      this.contextSwitchInProgress = true;
      while (this.playerSessionSwitchInProgress) {
        await this.playerSessionTransitionPromise;
      }
      await this.sessionAutosave.flush();
      this.sessionAutosave.cancel();
      this.textAutosave.cancel();
      this.flushPendingCreatorText();
      try {
        const flushed = await this.flushPendingChanges({ reason: 'switch-maker' });
        if (!flushed.saved) throw new Error(this.store?.getState().saveMessage || this.tr('saveFailed'));
      } catch (error) {
        if (contextRequestId !== this.contextRequestId) return;
        this.contextSwitchInProgress = false;
        throw error;
      }
      if (contextRequestId !== this.contextRequestId) return;
      this.contextEpoch += 1;
      this.contextSwitchInProgress = false;
      this.autosave.cancel();
    } else if (!sameMaker) {
      this.contextEpoch += 1;
    }
    const contextEpoch = this.contextEpoch;

    this.context = { ...this.context, ...context };
    if (Object.hasOwn(context, 'publishedDocument')) {
      this.releasePreflightCache = new WeakMap();
    }
    if (sameMaker && this.store) {
      if (Object.hasOwn(context, 'creatorPreview')) {
        this.playerCreatorPreview = Boolean(context.creatorPreview);
      } else if (context.isPublished === true) {
        this.playerCreatorPreview = false;
      }
      if (context.document && !isMakerV5Document(context.document)) {
        throw new TypeError('Legacy Maker v3/v4 documents are incompatible with Maker v5.');
      }
      if (context.replaceDocument === true && isMakerV5Document(context.document) && !this.store.getState().dirty) {
        const incoming = this.normalizeDocument(clone(context.document));
        const current = this.store.getState().document;
        const incomingRecipe = recipeWithColors(
          incoming,
          context.recipe || incoming.defaultRecipe,
        );
        const currentRecipe = this.store.getState().recipe;
        const documentChanged = JSON.stringify(incoming) !== JSON.stringify(current);
        const recipeChanged = JSON.stringify(incomingRecipe) !== JSON.stringify(currentRecipe);
        const nextAssets = this.runtimeAssetsForContext(context, incoming);
        this.replaceRuntimeAssets(nextAssets);
        if (documentChanged || recipeChanged) {
          this.resetPlayerExport();
          this.store.replace(incoming, incomingRecipe, { clearHistory: true, markSaved: true });
          this.creatorRecipe = clone(incomingRecipe);
          this.ensureCreatorSelection(incoming);
          while (this.playerSessionSwitchInProgress) {
            await this.playerSessionTransitionPromise;
          }
        }
      }
      this.render();
      return;
    }
    this.unsubscribe?.();
    this.resetPlayerExport();
    this.assetResolver.clear();
    this.assets.forEach(revokeRuntimeAsset);
    this.assets = new Map();
    this.assetResolver = createCachedAssetResolver(this.assets);
    this.selectedPartId = '';
    this.selectedItemId = '';
    this.selectedStyleId = '';
    this.selectedTrackId = '';
    this.selectedChannelId = '';
    this.enabledExpansionIds = new Set();
    this.playerLivingContent = null;
    this.playerSessionRequestId += 1;
    this.playerSessionSwitchInProgress = false;
    this.resetPlayerSessionPersistence();
    this.playerRenderState = { key: '', status: 'idle', error: '' };
    this.playerCreatorPreview = Boolean(context.creatorPreview);
    this.hiddenStyleKeys.clear();
    this.creatorHiddenPartIds.clear();
    this.editingPositionStyleKey = '';
    this.dragPreview = null;
    this.styleScalePreview = null;
    this.versionHistoryOpen = false;
    this.versionHistoryStatus = 'idle';
    this.versionHistoryEntries = [];
    this.versionHistoryError = '';
    this.versionHistoryMessage = '';
    this.versionHistoryRequestId += 1;
    this.restoringCheckpointRevision = null;
    this.restoreError = '';
    this.recoveryWriteAhead = null;
    this.pendingImport = null;

    if (context.document && !isMakerV5Document(context.document)) {
      throw new TypeError('Legacy Maker v3/v4 documents are incompatible with Maker v5; create a new Maker instead.');
    }
    const document = context.document
      ? clone(context.document)
      : createMakerV5Document({
          makerId: context.rootMakerId || context.makerId || context.makerKey,
          name: context.name || this.tr('versionHistoryUnknownName'),
          creator: context.creator || '',
        });
    this.normalizeDocument(document);
    this.assets = this.runtimeAssetsForContext(context, document);
    this.assetResolver = createCachedAssetResolver(this.assets);
    const recipe = recipeWithColors(document, context.recipe || document.defaultRecipe);
    this.store = createMakerCommandStore(document, recipe);
    this.creatorRecipe = clone(recipe);
    this.unsubscribe = this.store.subscribe((next, event) => {
      const nextVersionId = String(next.document.version?.versionId || '');
      const playerVersionChanged = Boolean(
        this.playerSessionContextVersionId
        && nextVersionId
        && nextVersionId !== this.playerSessionContextVersionId,
      );
      if (
        playerVersionChanged
        && !this.restoreInProgress
        && !this.contextSwitchInProgress
        && !this.playerSessionSwitchInProgress
      ) {
        const previousPlayerDocument = this.playerSessionContextDocument
          || this.store.getState().document;
        const transition = this.preparePlayerSessionVersionTransition(
          previousPlayerDocument,
        );
        this.playerSessionTransitionPromise = this.transitionPlayerSessionVersion(
          clone(next.document),
          transition,
        );
        void this.playerSessionTransitionPromise;
      } else if (!playerVersionChanged) {
        this.playerSessionContextDocument = clone(next.document);
      }
      this.ensureCreatorSelection(next.document);
      this.syncCreatorRecipeSelection();
      if (['execute', 'undo', 'redo'].includes(event.reason)) {
        // Player history is valid only for one immutable Maker graph. Even a
        // document edit that leaves the current Recipe unchanged can delete an
        // id held by an older undo/redo entry.
        this.playerUndo = [];
        this.playerRedo = [];
        const runtimeDocument = this.runtimeDocument();
        const repairedPlayerRecipe = normalizePlayablePlayerRecipe(
          runtimeDocument,
          this.playerRecipe,
          this.playerOptionSettings(runtimeDocument),
        );
        const nextPlayerRecipe = repairedPlayerRecipe.valid
          ? repairedPlayerRecipe.documentRecipe
          : recipeWithColors(runtimeDocument, this.playerRecipe);
        if (JSON.stringify(nextPlayerRecipe) !== JSON.stringify(this.playerRecipe)) {
          this.playerRecipe = nextPlayerRecipe;
        }
      }
      this.render();
      if (event.reason !== 'save-state' && next.dirty) {
        this.persistWriteAheadSnapshot(this.store, this.makerKey);
      }
      if (event.reason !== 'replace' && event.reason !== 'save-state') {
        this.callbacks.onDocumentChange?.({
          makerKey: this.makerKey,
          document: next.document,
          recipe: next.recipe,
          assets: this.assets,
          event,
        });
        this.autosave();
      }
    });
    this.ensureCreatorSelection(document);
    const initialPlayerRecipe = recipeWithColors(document, context.playerRecipe || document.defaultRecipe);
    const playablePlayerRecipe = normalizePlayablePlayerRecipe(
      document,
      initialPlayerRecipe,
      this.playerOptionSettings(document),
    );
    this.playerRecipe = playablePlayerRecipe.documentRecipe;
    this.playerPartId = document.parts.find((part) => part.menuVisible)?.id || document.parts[0]?.id || '';
    this.playerProfile = {
      name: context.profile?.name || this.tr('untitledOc'),
      world: context.profile?.world || document.metadata.style || '',
      description: context.profile?.description || '',
      tags: context.profile?.tags || '',
    };
    this.playerLivingContent = this.normalizePlayerLivingContent(
      context.playerLivingContent,
      document,
    );
    this.resetPlayerSessionPersistence({
      sessionKey: this.playerSessionKeyForDocument(document),
      versionId: document.version.versionId,
      document,
    });
    this.playerUndo = [];
    this.playerRedo = [];
    this.playerIntroOpen = true;
    this.restoreInProgress = Boolean(
      this.creatorPersistenceEnabled
      && this.makerKey
      && this.context?.walletAddress,
    );
    this.render();
    if (this.restoreInProgress) {
      await this.restoreLocalWorkspace(contextEpoch);
    } else if (this.context?.walletAddress) {
      const playerSessionRequestId = ++this.playerSessionRequestId;
      await this.restorePlayerSessionForDocument(document, {
        requestId: playerSessionRequestId,
      });
      if (this.contextEpoch === contextEpoch) this.render();
    }
  }

  playerSessionConflictMessage() {
    return this.tr('playerSessionConflict', {
      count: Math.max(1, this.playerRecoveryBranches.length),
    });
  }

  playerSessionMigrationSnapshot(baseDocument = this.store?.getState().document) {
    if (!baseDocument) return null;
    const snapshot = this.playerSessionSnapshot(baseDocument);
    return snapshot ? clone(snapshot) : null;
  }

  applyPlayerSessionSnapshot(session, baseDocument, { closeIntro = true } = {}) {
    if (!session || session.makerVersionId !== baseDocument?.version?.versionId) return false;
    this.enabledExpansionIds = new Set(enabledExpansionIdsForDocument(
      baseDocument,
      session.enabledExpansionIds,
    ));
    this.playerProfile = { ...this.playerProfile, ...(session.profile || {}) };
    const runtimeDocument = this.runtimeDocument();
    const playablePlayerRecipe = normalizePlayablePlayerRecipe(
      runtimeDocument,
      session.recipe || this.playerRecipe,
      this.playerOptionSettings(runtimeDocument),
    );
    this.playerRecipe = playablePlayerRecipe.documentRecipe;
    this.playerLivingContent = this.normalizePlayerLivingContent(
      session.livingContent,
      runtimeDocument,
    );
    if (closeIntro) this.playerIntroOpen = false;
    return true;
  }

  setPlayerSessionConflict(candidate, persistedRevision) {
    this.playerRecoveredWriteAhead = candidate || null;
    this.playerRecoverySelectedWriterId = String(candidate?.writerId || '');
    this.playerSaveState = 'error';
    this.playerSaveErrorCode = 'PLAYER_SESSION_CONFLICT';
    this.playerSaveError = this.playerSessionConflictMessage();
    this.playerSaveConflictRevision = (
      persistedRevision === null || Number.isSafeInteger(persistedRevision)
    )
      ? persistedRevision
      : null;
  }

  async restorePlayerSessionForDocument(baseDocument, {
    requestId = this.playerSessionRequestId,
    migrationSession = null,
  } = {}) {
    const versionId = String(baseDocument?.version?.versionId || '');
    const sessionKey = this.playerSessionKeyForDocument(baseDocument);
    if (!versionId || !sessionKey) return { restored: false, reason: 'missing-context' };
    this.playerSessionContextKey = sessionKey;
    this.playerSessionContextVersionId = versionId;
    this.playerSessionContextDocument = clone(baseDocument);
    const playerSession = await this.loadPlayerSessionRecord(sessionKey);
    if (
      requestId !== this.playerSessionRequestId
      || this.playerSessionContextKey !== sessionKey
      || this.store?.getState().document.version.versionId !== versionId
    ) return { restored: false, reason: 'stale-request' };

    const persistedRevision = playerSessionRecordRevision(playerSession);
    this.playerPersistedRevision = persistedRevision;
    this.playerPersistedRevisions.set(sessionKey, persistedRevision);
    const validBranches = [];
    listPlayerSessionWals(this.walStorage, sessionKey).forEach((candidate) => {
      if (candidate.session?.makerVersionId !== versionId) {
        clearPlayerSessionWal(this.walStorage, sessionKey, {
          writerId: candidate.writerId,
          expectedWriterId: candidate.writerId,
          throughRevision: candidate.revision,
          expectedSession: candidate.session,
        });
        return;
      }
      if (
        playerSession?.session
        && playerSessionWalSnapshotsEqual(candidate, { session: playerSession.session })
      ) {
        clearPlayerSessionWal(this.walStorage, sessionKey, {
          writerId: candidate.writerId,
          expectedWriterId: candidate.writerId,
          throughRevision: candidate.revision,
          expectedSession: candidate.session,
        });
        return;
      }
      validBranches.push(candidate);
    });
    this.playerRecoveryBranches = validBranches;

    const recoverable = validBranches.filter((candidate) => (
      candidate.baseRevision === persistedRevision
      && (persistedRevision === null || candidate.revision > persistedRevision)
    ));
    const currentWriter = validBranches.find(
      (candidate) => candidate.writerId === this.playerWalWriterId,
    ) || null;
    let selectedBranch = currentWriter;
    let conflict = false;
    if (selectedBranch) {
      conflict = !recoverable.includes(selectedBranch)
        || validBranches.some(
          (candidate) => !playerSessionWalSnapshotsEqual(candidate, selectedBranch),
        );
    } else if (validBranches.length) {
      selectedBranch = validBranches[0];
      const allEquivalent = validBranches.every(
        (candidate) => playerSessionWalSnapshotsEqual(candidate, selectedBranch),
      );
      conflict = !recoverable.includes(selectedBranch) || !allEquivalent;
    }

    let sourceSession = selectedBranch?.session || playerSession?.session || null;
    let migrated = false;
    if (!sourceSession && migrationSession) {
      sourceSession = {
        ...clone(migrationSession),
        makerVersionId: versionId,
        updatedAt: new Date().toISOString(),
      };
      migrated = true;
    }
    if (sourceSession) this.applyPlayerSessionSnapshot(sourceSession, baseDocument);
    else {
      this.playerLivingContent = this.normalizePlayerLivingContent(
        this.playerLivingContent,
        this.runtimeDocument(),
      );
    }

    this.playerSessionRevision = Math.max(
      persistedRevision ?? 0,
      selectedBranch?.revision ?? 0,
    );
    this.playerQueuedRevision = this.playerSessionRevision;
    this.playerSavedAt = Number(
      selectedBranch?.updatedAt || playerSession?.savedAt || Date.now(),
    );
    this.playerRecoveredWriteAhead = selectedBranch;
    this.playerRecoverySelectedWriterId = String(selectedBranch?.writerId || '');
    this.playerSaveConflictRevision = null;
    this.playerSaveError = '';
    this.playerSaveErrorCode = '';

    if (conflict) {
      this.setPlayerSessionConflict(selectedBranch, persistedRevision);
      return { restored: true, conflict: true, sessionKey };
    }
    if (selectedBranch) {
      this.playerSaveState = 'dirty';
      if (selectedBranch.writerId !== this.playerWalWriterId) {
        writePlayerSessionWal(this.walStorage, sessionKey, {
          revision: selectedBranch.revision,
          baseRevision: persistedRevision,
          session: selectedBranch.session,
        }, {
          writerId: this.playerWalWriterId,
        });
      }
      await this.savePlayerSession();
      return { restored: true, recovered: true, sessionKey };
    }
    if (playerSession?.session) {
      this.playerSaveState = 'saved';
      return { restored: true, persisted: true, sessionKey };
    }
    if (migrated) {
      this.playerSaveState = 'dirty';
      this.markPlayerSessionDirty();
      await this.savePlayerSession();
      return { restored: true, migrated: true, sessionKey };
    }
    this.playerSaveState = 'idle';
    return { restored: true, sessionKey };
  }

  activatePlayerRecoveryBranch(writerId) {
    const candidate = this.playerRecoveryBranches.find(
      (branch) => branch.writerId === String(writerId || ''),
    );
    const baseDocument = this.store?.getState().document;
    if (!candidate || !baseDocument || candidate.session?.makerVersionId !== baseDocument.version.versionId) {
      return false;
    }
    if (!this.applyPlayerSessionSnapshot(candidate.session, baseDocument)) return false;
    this.playerSessionRevision = Math.max(
      this.playerPersistedRevision ?? 0,
      candidate.revision,
    );
    this.playerQueuedRevision = this.playerSessionRevision;
    this.setPlayerSessionConflict(candidate, this.playerPersistedRevision);
    this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload());
    this.render();
    return true;
  }

  exportPlayerRecoveryBranches() {
    if (!this.playerRecoveryBranches.length) return null;
    const payload = {
      schemaVersion: 'animacraft.player-recovery.v1',
      sessionKey: this.playerSessionKey,
      exportedAt: new Date().toISOString(),
      branches: this.playerRecoveryBranches.map(({ storageKey, ...branch }) => clone(branch)),
    };
    this.callbacks.onExportPlayerRecovery?.(payload);
    if (globalThis.document && globalThis.URL?.createObjectURL) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = `${safeFileName(this.playerProfile.name, 'oc')}-recovery.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
    return payload;
  }

  preparePlayerSessionVersionTransition(previousDocument) {
    const sessionKey = this.playerSessionKeyForDocument(previousDocument);
    const migrationSession = this.playerSessionMigrationSnapshot(previousDocument);
    const revision = this.playerSessionRevision;
    const baseRevision = this.playerPersistedRevision;
    this.sessionAutosave.cancel();
    let oldSavePromise = Promise.resolve({ saved: true, reason: 'already-persisted' });
    if (this.playerSaveState === 'saving') {
      oldSavePromise = this.playerSaveQueue;
    } else if (
      sessionKey
      && migrationSession
      && ['dirty', 'error'].includes(this.playerSaveState)
    ) {
      oldSavePromise = this.savePlayerSession({
        baseDocument: previousDocument,
        sessionKey,
        revision,
        baseRevision,
        snapshot: migrationSession,
      });
    }
    return { oldSavePromise, migrationSession };
  }

  async transitionPlayerSessionVersion(nextDocument, {
    oldSavePromise = Promise.resolve(),
    migrationSession = null,
  } = {}) {
    const versionId = String(nextDocument?.version?.versionId || '');
    const sessionKey = this.playerSessionKeyForDocument(nextDocument);
    if (!versionId || !sessionKey) return;
    const requestId = ++this.playerSessionRequestId;
    this.playerSessionSwitchInProgress = true;
    this.resetPlayerSessionPersistence({
      sessionKey,
      versionId,
      document: nextDocument,
      state: 'saving',
    });
    this.render();
    try {
      await oldSavePromise;
      if (
        requestId === this.playerSessionRequestId
        && this.store?.getState().document.version.versionId === versionId
      ) {
        await this.restorePlayerSessionForDocument(nextDocument, {
          requestId,
          migrationSession,
        });
      }
    } catch (error) {
      if (requestId === this.playerSessionRequestId) {
        this.playerSaveState = 'error';
        this.playerSaveErrorCode = 'PLAYER_SESSION_RESTORE_FAILED';
        this.playerSaveError = this.tr('playerSessionRestoreFailed', {
          error: error?.message || this.tr('saveFailed'),
        });
        this.callbacks.onPlayerSaveError?.(error);
      }
    } finally {
      if (requestId === this.playerSessionRequestId) {
        this.playerSessionSwitchInProgress = false;
        const currentDocument = this.store?.getState().document;
        if (
          currentDocument
          && currentDocument.version.versionId !== this.playerSessionContextVersionId
        ) {
          const previousPlayerDocument = this.playerSessionContextDocument || nextDocument;
          const transition = this.preparePlayerSessionVersionTransition(
            previousPlayerDocument,
          );
          this.playerSessionTransitionPromise = this.transitionPlayerSessionVersion(
            clone(currentDocument),
            transition,
          );
          void this.playerSessionTransitionPromise;
        } else {
          this.render();
        }
      }
    }
  }

  async restoreLocalWorkspace(contextEpoch = this.contextEpoch) {
    if (
      !this.creatorPersistenceEnabled
      || !this.makerKey
      || !this.context?.walletAddress
    ) return;
    const requestedMakerKey = this.makerKey;
    const requestedStore = this.store;
    const baseRevision = requestedStore?.getState().revision ?? 0;
    this.restoreInProgress = true;
    this.restoreError = '';
    try {
      const saved = await this.draftRepository.load(requestedMakerKey);
      if (
        this.context?.makerKey !== requestedMakerKey
        || this.contextEpoch !== contextEpoch
        || this.store !== requestedStore
      ) return;
      const currentState = requestedStore.getState();
      const mayRestore = currentState.revision === baseRevision && !currentState.dirty;
      if (!mayRestore) {
        throw new Error(this.tr('recoveryRevisionChanged'));
      }
      (saved?.assets || []).forEach((record) => {
        const previous = this.assets.get(record.assetId);
        const revived = reviveRuntimeAssetRecord(record);
        if (!runtimeAssetHasReadableSource(revived) && runtimeAssetHasReadableSource(previous)) {
          // v6.0.0 and earlier stripped every runtime URL before persistence.
          // Keep a valid manifest/Walrus source instead of allowing that
          // incomplete legacy record to break Creator → Player preview.
          this.assets.set(record.assetId, previous);
          return;
        }
        if (previous) revokeRuntimeAsset(previous);
        this.assets.set(record.assetId, revived);
      });
      this.assetResolver.clear();
      this.assetResolver = createCachedAssetResolver(this.assets);
      if (this.contextEpoch !== contextEpoch) return;
      if (
        saved?.document
        && saved.document.version?.rootMakerId !== requestedStore.getState().document.version.rootMakerId
      ) {
        throw new Error(this.tr('recoveryIdentityMismatch'));
      }
      if (saved?.document) {
        const restored = this.normalizeDocument(saved.document);
        requestedStore.replace(restored, saved.recipe || restored.defaultRecipe, {
          clearHistory: true,
          markSaved: true,
          persistedRevision: saved.revision,
        });
        requestedStore.setSaveState(
          'saved',
          saved.savedAt
            ? this.tr('savedAtTime', { time: this.formatSavedClock(saved.savedAt) })
            : this.tr('savedStatus'),
          { revision: saved.revision },
        );
        this.creatorRecipe = clone(saved.recipe || restored.defaultRecipe);
        const restoredPlayerRecipe = normalizePlayablePlayerRecipe(
          restored,
          saved.recipe || restored.defaultRecipe,
          this.playerOptionSettings(restored),
        );
        this.playerRecipe = restoredPlayerRecipe.documentRecipe;
        this.ensureCreatorSelection(restored);
        this.callbacks.onRestored?.({
          makerKey: requestedMakerKey,
          document: restored,
          recipe: saved.recipe || restored.defaultRecipe,
          assets: this.assets,
          metadata: clone(saved.metadata || {}),
          revision: saved.revision,
          savedAt: saved.savedAt,
        });
      }
      const persistedRevision = Number.isSafeInteger(saved?.revision) ? saved.revision : null;
      const writeAhead = loadMakerDraftWal(this.walStorage, requestedMakerKey, {
        writerId: this.walWriterId,
      });
      this.recoveryWriteAhead = writeAhead;
      let recoveredWriteAhead = false;
      if (writeAhead) {
        if (writeAhead.writerId && writeAhead.writerId !== this.walWriterId) {
          throw new Error(this.tr('workspaceWalForeignTab'));
        } else if (saved?.document && makerDraftWalSnapshotsEqual(writeAhead, {
          document: saved.document,
          recipe: saved.recipe,
        })) {
          clearMakerDraftWal(this.walStorage, requestedMakerKey, {
            writerId: writeAhead.writerId,
            expectedSnapshot: writeAhead,
          });
          this.recoveryWriteAhead = null;
        } else {
          if (writeAhead.baseRevision !== persistedRevision) {
            throw new Error(this.tr('workspaceWalConflict'));
          }
          if (
            !isMakerV5Document(writeAhead.document)
            || writeAhead.document.version?.rootMakerId
              !== requestedStore.getState().document.version.rootMakerId
          ) {
            throw new Error(this.tr('workspaceWalWrongMaker'));
          }
          const recoveredDocument = this.normalizeDocument(clone(writeAhead.document));
          const recoveredRecipe = recipeWithColors(
            recoveredDocument,
            writeAhead.recipe || recoveredDocument.defaultRecipe,
          );
          requestedStore.replace(recoveredDocument, recoveredRecipe, {
            clearHistory: true,
            markSaved: false,
          });
          this.creatorRecipe = clone(recoveredRecipe);
          this.playerRecipe = clone(recoveredRecipe);
          this.ensureCreatorSelection(recoveredDocument);
          this.persistWriteAheadSnapshot(requestedStore, requestedMakerKey);
          recoveredWriteAhead = true;
          this.callbacks.onRestored?.({
            makerKey: requestedMakerKey,
            document: recoveredDocument,
            recipe: recoveredRecipe,
            assets: this.assets,
            metadata: clone(saved?.metadata || {}),
            revision: requestedStore.getState().revision,
            savedAt: writeAhead.updatedAt,
            recoveredFromWriteAhead: true,
          });
        }
      }
      const baseDocument = requestedStore.getState().document;
      const playerSessionRequestId = ++this.playerSessionRequestId;
      await this.restorePlayerSessionForDocument(baseDocument, {
        requestId: playerSessionRequestId,
      });
      if (this.contextEpoch !== contextEpoch) return;
      if (!saved?.document || recoveredWriteAhead) {
        const initialCommit = await this.save({
          automatic: true,
          force: !recoveredWriteAhead,
          allowDuringRestore: true,
        });
        if (!initialCommit?.confirmed) {
          throw new Error(
            recoveredWriteAhead
              ? this.tr('workspaceWalCommitFailed')
              : this.tr('workspaceInitialCommitFailed'),
          );
        }
        if (recoveredWriteAhead && writeAhead) {
          clearMakerDraftWal(this.walStorage, requestedMakerKey, {
            writerId: writeAhead.writerId,
            expectedSnapshot: writeAhead,
          });
          this.recoveryWriteAhead = null;
        }
      }
    } catch (error) {
      if (this.context?.makerKey === requestedMakerKey && this.store === requestedStore) {
        this.restoreError = error.message || this.tr('restoreFailed');
        this.store?.setSaveState('error', this.restoreError);
      }
    } finally {
      if (this.contextEpoch === contextEpoch) {
        this.restoreInProgress = false;
        this.render();
      }
    }
  }

  async retryLocalWorkspaceRestore() {
    if (
      !this.creatorPersistenceEnabled
      || !this.store
      || !this.makerKey
      || !this.context?.walletAddress
      || this.restoreInProgress
    ) return;
    if (this.store.getState().dirty) {
      this.restoreError = this.tr('workspaceRestoreBlocked');
      this.render();
      return;
    }
    this.restoreError = '';
    this.restoreInProgress = true;
    this.render();
    await this.restoreLocalWorkspace(this.contextEpoch);
  }

  ensureCreatorSelection(document) {
    let part = findPart(document, this.selectedPartId) || document.parts[0] || null;
    this.selectedPartId = part?.id || '';
    const recipeSelection = part
      ? recipeSelectionMap(this.creatorRecipe || this.store?.getState().recipe || document.defaultRecipe).get(part.id)
      : null;
    let item = part?.items.find((candidate) => candidate.id === this.selectedItemId)
      || part?.items.find((candidate) => candidate.id === recipeSelection?.itemId)
      || part?.items.find((candidate) => candidate.id === part.defaultItemId)
      || part?.items[0]
      || null;
    this.selectedItemId = item?.id || '';
    const recipeStyleId = recipeSelection?.itemId === item?.id ? recipeSelection?.styleId : '';
    let style = item?.styles.find((candidate) => candidate.id === this.selectedStyleId)
      || item?.styles.find((candidate) => candidate.id === recipeStyleId)
      || item?.styles.find((candidate) => candidate.id === item.defaultStyleId)
      || item?.styles[0]
      || null;
    this.selectedStyleId = style?.id || '';
    const styleKey = style ? styleSceneKey(part.id, item.id, style.id) : '';
    this.editingPositionStyleKey = style && !style.styleLocked && !style.positionLocked && (
      style.positionConfirmed === false || this.editingPositionStyleKey === styleKey
    ) ? styleKey : '';
    this.selectedTrackId = document.layerTracks.some((track) => track.id === this.selectedTrackId)
      ? this.selectedTrackId
      : style?.layerTrackId || document.layerTracks[0]?.id || '';
    this.selectedChannelId = document.colorChannels.some((channel) => channel.id === this.selectedChannelId)
      ? this.selectedChannelId
      : style?.colorChannelId || document.colorChannels[0]?.id || '';
    const partIds = new Set(document.parts.map((candidate) => candidate.id));
    this.creatorHiddenPartIds = new Set([...this.creatorHiddenPartIds].filter((partId) => partIds.has(partId)));
    const styleKeys = new Set(document.parts.flatMap((candidatePart) => candidatePart.items.flatMap((candidateItem) => (
      candidateItem.styles.map((candidateStyle) => styleSceneKey(candidatePart.id, candidateItem.id, candidateStyle.id))
    ))));
    this.hiddenStyleKeys = new Set([...this.hiddenStyleKeys].filter((key) => styleKeys.has(key)));
  }

  syncCreatorRecipeSelection({ partId = this.selectedPartId, itemId = this.selectedItemId, styleId = this.selectedStyleId } = {}) {
    if (!this.store) return;
    const document = this.store.getState().document;
    const desired = clone(this.creatorRecipe || this.store.getState().recipe || document.defaultRecipe);
    const completeSelection = Boolean(itemId && styleId && findStyle(document, partId, itemId, styleId));
    replaceRecipeSelection(desired, { partId, itemId: completeSelection ? itemId : '', styleId });
    if (!completeSelection) {
      this.creatorRecipe = recipeWithColors(document, desired);
      return;
    }
    const normalized = normalizeRecipe(document, desired, { preferPartId: partId });
    this.creatorRecipe = recipeWithColors(document, normalized.valid ? normalized.documentRecipe : desired);
  }

  currentStyleKey(part = null, item = null, style = null) {
    const records = part && item ? { part, item, style } : this.selectedCreatorRecords();
    return records.part && records.item && records.style
      ? styleSceneKey(records.part.id, records.item.id, records.style.id)
      : '';
  }

  render() {
    if (!this.store) return this.renderEmpty();
    this.renderCreator();
    this.renderPlayer();
    requestAnimationFrame(() => {
      this.drawCreatorCanvas();
      this.drawPlayerCanvas();
      this.attachCanvasDrag();
    });
  }

  persistWriteAheadSnapshot(requestedStore = this.store, requestedMakerKey = this.makerKey) {
    if (
      !this.creatorPersistenceEnabled
      || !requestedStore
      || !requestedMakerKey
      || !this.walStorage
      || this.deletedMakerKeys.has(requestedMakerKey)
    ) return false;
    try {
      const snapshot = requestedStore.snapshotForSave();
      writeMakerDraftWal(this.walStorage, requestedMakerKey, snapshot, {
        writerId: this.walWriterId,
        walletAddress: this.context?.walletAddress || '',
        rootMakerId: snapshot.document.version?.rootMakerId || '',
      });
      this.writeAheadError = '';
      return true;
    } catch (error) {
      this.writeAheadError = this.tr('workspaceWalWriteFailed');
      requestedStore?.setSaveState('error', this.writeAheadError);
      console.warn(this.writeAheadError, error);
      return false;
    }
  }

  clearWriteAheadSnapshot(requestedMakerKey, expectedSnapshot = null) {
    if (!requestedMakerKey || !this.walStorage) return false;
    try {
      const cleared = clearMakerDraftWal(this.walStorage, requestedMakerKey, {
        writerId: this.walWriterId,
        expectedSnapshot,
      });
      if (cleared && this.makerKey === requestedMakerKey) this.recoveryWriteAhead = null;
      return cleared;
    } catch (error) {
      this.writeAheadError = this.tr('workspaceWalClearFailed');
      console.warn(this.writeAheadError, error);
      return false;
    }
  }

  emergencyRecoverySnapshot() {
    if (this.recoveryWriteAhead) return this.recoveryWriteAhead;
    if (!this.makerKey || !this.walStorage) return null;
    try {
      this.recoveryWriteAhead = loadMakerDraftWal(this.walStorage, this.makerKey, {
        writerId: this.walWriterId,
      });
      return this.recoveryWriteAhead;
    } catch {
      return null;
    }
  }

  exportEmergencyRecoveryJson() {
    const recovery = this.emergencyRecoverySnapshot();
    if (!recovery) return false;
    const { storageKey: _storageKey, ...record } = recovery;
    const content = JSON.stringify(record, null, 2);
    this.callbacks.onEmergencyRecoveryExport?.({
      makerKey: this.makerKey,
      record: clone(record),
      content,
    });
    if (
      typeof globalThis.document?.createElement === 'function'
      && typeof globalThis.URL?.createObjectURL === 'function'
    ) {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = `${safeFileName(
        recovery.document?.metadata?.name,
        recovery.rootMakerId || 'maker',
      )}-emergency-recovery.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
    return true;
  }

  async save({
    automatic = false,
    force = false,
    allowDuringRestore = false,
  } = {}) {
    if (
      !this.creatorPersistenceEnabled
      || !this.store
      || !this.makerKey
      || !this.context?.walletAddress
      || this.lifecycleMutationMakerKeys.has(this.makerKey)
      || this.deletedMakerKeys.has(this.makerKey)
    ) return null;
    if ((!allowDuringRestore && this.restoreInProgress) || this.restoreError) return null;
    this.flushPendingCreatorText();
    if (!automatic) this.autosave.cancel();
    const requestedStore = this.store;
    const requestedMakerKey = this.makerKey;
    const requestedContextEpoch = this.contextEpoch;
    const requestedWallet = this.context.walletAddress;
    let stateBeforeSave = requestedStore.getState();
    if (
      force
      && !stateBeforeSave.dirty
      && Number.isSafeInteger(stateBeforeSave.persistedRevision)
    ) {
      // Repository revisions are strictly monotonic. A confirmed publication
      // can change only Workspace persistence metadata (chain binding and the
      // immutable published snapshot) while leaving the editable document
      // byte-for-byte unchanged, so advance the local revision without adding
      // a fake Undo command before committing that metadata.
      requestedStore.replace(
        stateBeforeSave.document,
        stateBeforeSave.recipe,
        { clearHistory: false, markSaved: false },
      );
      stateBeforeSave = requestedStore.getState();
    }
    if (!force && !stateBeforeSave.dirty) {
      return {
        makerKey: requestedMakerKey,
        requestedRevision: stateBeforeSave.revision,
        persistedRevision: this.draftRepository.getStatus(requestedMakerKey).persistedRevision,
        confirmed: true,
        superseded: false,
        conflict: false,
        noop: true,
      };
    }
    const snapshot = requestedStore.snapshotForSave();
    const assets = [...this.assets.values()].map((record) => ({
      ...record,
      // Object URLs are session-local and must never be restored. Stable
      // manifest/Walrus URLs are part of a remote-backed editable draft and
      // must survive refresh and Creator → Player handoff.
      url: persistedAssetUrl(record.url),
      thumbnailUrl: persistedAssetUrl(record.thumbnailUrl),
    }));
    requestedStore.setSaveState('saving', this.tr('savingChanges'));
    try {
      const result = await this.draftRepository.save(requestedMakerKey, {
        ...snapshot,
        assets,
        metadata: workspacePersistenceMetadata(
          this.context,
          snapshot,
          requestedWallet,
        ),
      });
      if (
        this.store !== requestedStore
        || this.makerKey !== requestedMakerKey
        || this.contextEpoch !== requestedContextEpoch
      ) return result;
      if (
        this.lifecycleMutationMakerKeys.has(requestedMakerKey)
        || this.deletedMakerKeys.has(requestedMakerKey)
      ) return result;
      if (result.confirmed) {
        const savedAt = result.savedAt
          ?? this.draftRepository.getStatus(requestedMakerKey).savedAt
          ?? Date.now();
        requestedStore.setSaveState('saved', this.tr('savedAtTime', {
          time: this.formatSavedClock(savedAt),
        }), { revision: snapshot.revision });
        const current = requestedStore.getState();
        if (current.dirty) {
          this.persistWriteAheadSnapshot(requestedStore, requestedMakerKey);
        } else {
          this.clearWriteAheadSnapshot(requestedMakerKey, snapshot);
        }
        if (current.revision === snapshot.revision) {
          this.callbacks.onSaved?.({
            makerKey: requestedMakerKey,
            document: current.document,
            recipe: current.recipe,
            assets: this.assets,
            automatic,
            revision: snapshot.revision,
          });
        } else {
          this.autosave();
        }
      } else if (
        result.conflict
        || (
          result.superseded
          && Number.isSafeInteger(result.persistedRevision)
          && result.persistedRevision > snapshot.revision
        )
      ) {
        requestedStore.setSaveState(
          'error',
          this.tr('workspaceCrossTabConflict'),
        );
      } else if (requestedStore.getState().dirty) {
        this.autosave();
      }
      return result;
    } catch (error) {
      if (
        this.store === requestedStore
        && this.makerKey === requestedMakerKey
        && !this.lifecycleMutationMakerKeys.has(requestedMakerKey)
        && !this.deletedMakerKeys.has(requestedMakerKey)
      ) {
        requestedStore.setSaveState('error', error.message || this.tr('saveFailed'));
      }
      return null;
    }
  }

  hasUnsavedChanges() {
    if (!this.store) return false;
    const state = this.store.getState();
    return Boolean(
      this.pendingCreatorText
      || this.textAutosave.pending()
      || this.autosave.pending()
      || state.dirty
      || state.saveState === 'saving'
      || state.saveState === 'error'
      || this.sessionAutosave.pending()
      || ['dirty', 'saving', 'error'].includes(this.playerSaveState)
    );
  }

  async flushPendingChanges({ reason = 'flush' } = {}) {
    this.textAutosave.cancel();
    this.flushPendingCreatorText();
    if (
      this.context?.walletAddress
      && ['dirty', 'error'].includes(this.playerSaveState)
      && !this.sessionAutosave.pending()
    ) this.sessionAutosave();
    await this.sessionAutosave.flush();
    await this.playerSaveQueue;
    const requestedStore = this.store;
    const requestedMakerKey = this.makerKey;
    if (!this.creatorPersistenceEnabled) {
      this.autosave.cancel();
      return {
        makerKey: requestedMakerKey,
        reason,
        saved: !['dirty', 'saving', 'error'].includes(this.playerSaveState),
        creatorPersistenceSkipped: true,
      };
    }
    if (this.deletedMakerKeys.has(requestedMakerKey)) {
      this.autosave.cancel();
      return {
        makerKey: requestedMakerKey,
        reason,
        saved: true,
        deleted: true,
      };
    }
    if (!requestedStore || !requestedMakerKey || !this.context?.walletAddress) {
      this.autosave.cancel();
      return {
        makerKey: requestedMakerKey,
        reason,
        saved: !requestedStore?.getState().dirty && !['dirty', 'saving', 'error'].includes(this.playerSaveState),
      };
    }

    if (requestedStore.getState().dirty && !this.autosave.pending()) this.autosave();
    await this.autosave.flush();
    await this.draftRepository.flush(requestedMakerKey);

    if (
      this.store === requestedStore
      && this.makerKey === requestedMakerKey
      && requestedStore.getState().dirty
    ) {
      await this.save({ automatic: true });
      await this.draftRepository.flush(requestedMakerKey);
    }

    return {
      makerKey: requestedMakerKey,
      reason,
      saved: (
        (this.store !== requestedStore || !requestedStore.getState().dirty)
        && !['dirty', 'saving', 'error'].includes(this.playerSaveState)
      ),
    };
  }

  isCurrentMakerOperation(makerKey, store, contextEpoch) {
    return Boolean(
      makerKey
      && this.makerKey === makerKey
      && this.store === store
      && this.contextEpoch === contextEpoch
    );
  }

  captureMakerOperation() {
    return {
      makerKey: this.makerKey,
      store: this.store,
      contextEpoch: this.contextEpoch,
    };
  }

  async flushCompletedAssetOperation(operation, reason) {
    if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
      return false;
    }
    const result = await this.flushPendingChanges({ reason });
    if (
      this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)
      && !result.saved
    ) {
      throw new Error(operation.store.getState().saveMessage || this.tr('saveFailed'));
    }
    return result.saved;
  }

  async openVersionHistory() {
    if (!this.store || !this.makerKey) return;
    const requestedMakerKey = this.makerKey;
    const requestedStore = this.store;
    const requestedContextEpoch = this.contextEpoch;
    const requestId = ++this.versionHistoryRequestId;
    this.versionHistoryOpen = true;
    this.versionHistoryStatus = 'loading';
    this.versionHistoryEntries = [];
    this.versionHistoryError = '';
    this.versionHistoryMessage = '';
    this.render();
    try {
      const flushed = await this.flushPendingChanges({ reason: 'open-version-history' });
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      if (!flushed.saved) throw new Error(this.tr('versionHistoryFlushFailed'));
      const checkpoints = await this.draftRepository.listCheckpoints(requestedMakerKey);
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      this.versionHistoryEntries = checkpoints;
      this.versionHistoryStatus = checkpoints.length ? 'ready' : 'empty';
      this.render();
    } catch (error) {
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      this.versionHistoryStatus = 'error';
      this.versionHistoryError = error?.message || this.tr('versionHistoryFailed');
      this.render();
    }
  }

  closeVersionHistory() {
    if (this.versionHistoryStatus === 'restoring') return;
    this.versionHistoryRequestId += 1;
    this.versionHistoryOpen = false;
    this.versionHistoryStatus = 'idle';
    this.versionHistoryError = '';
    this.versionHistoryMessage = '';
    this.restoringCheckpointRevision = null;
    this.render();
  }

  async restoreVersionCheckpoint(checkpointRevisionValue) {
    if (!this.store || !this.makerKey || this.versionHistoryStatus === 'restoring' || this.documentMutationBlocked()) return;
    const checkpointRevision = Number(checkpointRevisionValue);
    if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 0) return;
    const checkpoint = this.versionHistoryEntries.find((entry) => entry.revision === checkpointRevision);
    if (!checkpoint) return;
    const checkpointName = checkpoint.document?.metadata?.name
      || checkpoint.metadata?.name
      || this.tr('versionHistoryUnknownName');
    if (!this.confirmDelete(this.tr('versionHistoryRestoreConfirm', {
      revision: checkpointRevision,
      name: checkpointName,
    }))) return;

    const requestedMakerKey = this.makerKey;
    const requestedStore = this.store;
    const requestedContextEpoch = this.contextEpoch;
    const requestedRootMakerId = requestedStore.getState().document.version?.rootMakerId || '';
    const requestId = ++this.versionHistoryRequestId;
    this.versionHistoryStatus = 'restoring';
    this.versionHistoryError = '';
    this.versionHistoryMessage = '';
    this.restoringCheckpointRevision = checkpointRevision;
    this.render();
    try {
      const flushed = await this.flushPendingChanges({ reason: 'restore-version-history' });
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      if (!flushed.saved) throw new Error(this.tr('versionHistoryFlushFailed'));

      const restoration = await this.draftRepository.restoreCheckpoint(
        requestedMakerKey,
        checkpointRevision,
      );
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      if (
        restoration?.makerKey !== requestedMakerKey
        || restoration?.committed !== true
        || restoration?.conflict === true
        || !Number.isSafeInteger(restoration?.persistedRevision)
      ) {
        throw new Error(this.tr('versionHistoryRestoreFailed'));
      }

      const saved = await this.draftRepository.load(requestedMakerKey);
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      if (
        saved?.makerKey !== requestedMakerKey
        || saved?.revision !== restoration.persistedRevision
        || !saved?.document
        || saved.document.version?.rootMakerId !== requestedRootMakerId
      ) {
        throw new Error(this.tr('versionHistoryRestoreFailed'));
      }

      const restoredDocument = this.normalizeDocument(clone(saved.document));
      this.assetResolver.clear();
      this.assets.forEach(revokeRuntimeAsset);
      this.assets = new Map();
      (saved.assets || []).forEach((record) => {
        const assetId = String(record.assetId || '');
        if (!assetId) return;
        this.assets.set(assetId, reviveRuntimeAssetRecord({ ...record, assetId }));
      });
      this.assetResolver = createCachedAssetResolver(this.assets);

      const restoredRecipe = recipeWithColors(
        restoredDocument,
        saved.recipe || restoredDocument.defaultRecipe,
      );
      requestedStore.replace(restoredDocument, restoredRecipe, {
        clearHistory: true,
        markSaved: true,
        persistedRevision: saved.revision,
      });
      this.clearWriteAheadSnapshot(requestedMakerKey, {
        document: restoredDocument,
        recipe: restoredRecipe,
      });
      this.creatorRecipe = clone(restoredRecipe);
      const playablePlayerRecipe = normalizePlayablePlayerRecipe(
        restoredDocument,
        restoredRecipe,
        this.playerOptionSettings(restoredDocument),
      );
      this.playerRecipe = playablePlayerRecipe.documentRecipe;
      this.playerUndo = [];
      this.playerRedo = [];
      this.ensureCreatorSelection(restoredDocument);
      this.callbacks.onRestored?.({
        makerKey: requestedMakerKey,
        document: restoredDocument,
        recipe: restoredRecipe,
        assets: this.assets,
        metadata: clone(saved.metadata || {}),
        revision: saved.revision,
        savedAt: saved.savedAt,
        restoredFromRevision: checkpointRevision,
      });

      let checkpoints = this.versionHistoryEntries;
      try {
        checkpoints = await this.draftRepository.listCheckpoints(requestedMakerKey);
      } catch {
        checkpoints = [{
          revision: saved.revision,
          document: clone(restoredDocument),
          metadata: clone(saved.metadata || {}),
          savedAt: saved.savedAt,
        }, ...checkpoints];
      }
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      this.versionHistoryEntries = checkpoints;
      this.versionHistoryStatus = 'ready';
      this.versionHistoryMessage = this.tr('versionHistoryRestored', { revision: saved.revision });
      this.restoringCheckpointRevision = null;
      this.render();
    } catch (error) {
      if (
        requestId !== this.versionHistoryRequestId
        || !this.isCurrentMakerOperation(requestedMakerKey, requestedStore, requestedContextEpoch)
      ) return;
      this.versionHistoryStatus = 'error';
      this.versionHistoryError = error?.message || this.tr('versionHistoryRestoreFailed');
      this.restoringCheckpointRevision = null;
      this.render();
    }
  }

  playerSaveStatusText() {
    if (this.playerSaveState === 'saving') return this.tr('playerDraftSaving');
    if (this.playerSaveState === 'dirty') return this.tr('playerDraftUnsaved');
    if (this.playerSaveState === 'error') return this.tr('playerDraftSaveFailed', {
      error: this.playerSaveError || this.tr('saveFailed'),
    });
    if (this.playerSaveState === 'saved') {
      return this.tr('playerDraftSavedAt', {
        time: this.formatSavedClock(this.playerSavedAt || Date.now()),
      });
    }
    return this.tr('playerDraftNotSaved');
  }

  renderPlayerRecoveryBranches() {
    if (
      this.playerSaveErrorCode !== 'PLAYER_SESSION_CONFLICT'
      || !this.playerRecoveryBranches.length
    ) return '';
    const branches = this.playerRecoveryBranches.map((branch, index) => {
      const profileName = String(
        branch.session?.profile?.name || this.tr('untitledOc'),
      );
      const base = branch.baseRevision === null
        ? this.tr('playerRecoveryNewDraft')
        : String(branch.baseRevision);
      const active = branch.writerId === this.playerRecoverySelectedWriterId;
      return `
        <button
          type="button"
          class="${active ? 'active' : ''}"
          data-action="player-select-recovery"
          data-writer-id="${escapeHtml(branch.writerId)}"
          aria-pressed="${active ? 'true' : 'false'}"
        >
          <strong>${escapeHtml(this.tr('playerRecoveryCopyLabel', { index: index + 1, name: profileName }))}</strong>
          <small>${escapeHtml(this.tr('playerRecoveryCopyMeta', { revision: branch.revision, base }))}</small>
        </button>
      `;
    }).join('');
    return `
      <section class="v4-player-recovery" role="region" aria-labelledby="v4PlayerRecoveryTitle">
        <div>
          <strong id="v4PlayerRecoveryTitle">${escapeHtml(this.tr('playerRecoveryTitle', { count: this.playerRecoveryBranches.length }))}</strong>
          <p role="alert">${escapeHtml(this.tr('playerRecoveryCopy'))}</p>
        </div>
        <div class="v4-player-recovery-branches">${branches}</div>
        <button type="button" data-action="player-export-recovery">${escapeHtml(this.tr('playerRecoveryExport'))}</button>
      </section>
    `;
  }

  updatePlayerSaveStatusUi() {
    const status = this.playerRoot?.querySelector('#v4PlayerSaveStatus');
    if (status) {
      status.textContent = this.playerSaveStatusText();
      status.dataset.state = this.playerSaveState;
    }
    const retry = this.playerRoot?.querySelector('[data-action="player-retry-save"]');
    if (retry) retry.hidden = this.playerSaveState !== 'error';
    this.updatePlayerCompletionUi();
  }

  markPlayerSessionDirty() {
    this.playerSessionRevision += 1;
    this.playerSaveState = 'dirty';
    this.playerSaveError = '';
    this.playerSaveErrorCode = '';
    try {
      const sessionKey = this.playerSessionKey;
      const session = this.playerSessionSnapshot();
      if (sessionKey && session) {
        writePlayerSessionWal(this.walStorage, sessionKey, {
          revision: this.playerSessionRevision,
          baseRevision: this.playerPersistedRevision,
          session,
        }, {
          writerId: this.playerWalWriterId,
        });
      }
    } catch (error) {
      this.playerSaveState = 'error';
      this.playerSaveError = error?.message || this.tr('saveFailed');
      this.playerSaveErrorCode = String(error?.code || 'PLAYER_SESSION_SAVE_FAILED');
      this.callbacks.onPlayerSaveError?.(error);
    }
    this.updatePlayerSaveStatusUi();
  }

  playerSessionSnapshot(baseDocument = this.store?.getState().document) {
    if (!baseDocument) return null;
    return {
      makerVersionId: baseDocument.version.versionId,
      recipe: clone(this.playerRecipe),
      profile: clone(this.playerProfile),
      livingContent: clone(this.playerLivingContentDraft(this.runtimeDocument())),
      enabledExpansionIds: enabledExpansionIdsForDocument(baseDocument, this.enabledExpansionIds),
      updatedAt: new Date().toISOString(),
    };
  }

  retryPlayerSessionSave() {
    if (this.playerSaveErrorCode === 'PLAYER_SESSION_RESTORE_FAILED') {
      const document = this.store?.getState().document;
      if (!document) return Promise.resolve({ saved: false, reason: 'missing-context' });
      this.playerSessionTransitionPromise = this.transitionPlayerSessionVersion(
        clone(document),
        {
          migrationSession: this.playerSessionMigrationSnapshot(document),
        },
      );
      return this.playerSessionTransitionPromise.then(() => ({
        saved: this.playerSaveState === 'saved',
        sessionKey: this.playerSessionKey,
      }));
    }
    if (
      this.playerSaveState === 'error'
      && (this.playerSaveConflictRevision === null
        || Number.isSafeInteger(this.playerSaveConflictRevision))
      && this.playerSaveErrorCode === 'PLAYER_SESSION_CONFLICT'
    ) {
      this.playerPersistedRevision = this.playerSaveConflictRevision;
      this.playerPersistedRevisions.set(
        this.playerSessionKey,
        this.playerSaveConflictRevision,
      );
      this.playerSessionRevision = Math.max(
        this.playerSessionRevision,
        this.playerPersistedRevision ?? 0,
      );
      this.playerSaveConflictRevision = null;
      this.markPlayerSessionDirty();
    }
    return this.savePlayerSession();
  }

  async savePlayerSession(options = {}) {
    const walletAddress = String(this.context?.walletAddress || '');
    const baseDocument = options.baseDocument || this.store?.getState().document;
    if (!walletAddress || !baseDocument) return { saved: false, reason: 'missing-context' };
    const sessionKey = String(
      options.sessionKey || `${walletAddress}::${baseDocument.version.versionId}`,
    );
    if (!this.playerSessionContextKey && !options.sessionKey) {
      this.playerSessionContextKey = sessionKey;
      this.playerSessionContextVersionId = baseDocument.version.versionId;
      this.playerSessionContextDocument = clone(baseDocument);
    }
    const sessionRevision = Number.isSafeInteger(options.revision)
      ? options.revision
      : this.playerSessionRevision;
    const isCurrentContext = () => (
      this.playerSessionContextKey === sessionKey
      && this.playerSessionContextVersionId === baseDocument.version.versionId
    );
    if (isCurrentContext()) {
      this.playerQueuedRevision = Math.max(this.playerQueuedRevision, sessionRevision);
    }
    const writeAhead = listPlayerSessionWals(this.walStorage, sessionKey).find(
      (candidate) => candidate.writerId === this.playerWalWriterId,
    ) || null;
    const snapshot = options.snapshot
      ? clone(options.snapshot)
      : (
          writeAhead?.revision === sessionRevision
          && writeAhead.session?.makerVersionId === baseDocument.version.versionId
        )
        ? clone(writeAhead.session)
        : this.playerSessionSnapshot(baseDocument);
    if (isCurrentContext()) {
      this.playerSaveState = 'saving';
      this.playerSaveError = '';
      this.playerSaveErrorCode = '';
      this.updatePlayerSaveStatusUi();
    }
    const write = this.playerSaveQueue.then(async () => {
      const baseRevision = this.playerPersistedRevisions.has(sessionKey)
        ? this.playerPersistedRevisions.get(sessionKey)
        : options.baseRevision ?? (
          isCurrentContext() ? this.playerPersistedRevision : null
        );
      const result = await this.savePlayerSessionRecord(sessionKey, snapshot, {
        revision: sessionRevision,
        baseRevision,
        writerId: this.playerWalWriterId,
      });
      if (result?.committed === false) {
        const conflict = new Error(this.playerSessionConflictMessage());
        conflict.code = 'PLAYER_SESSION_CONFLICT';
        conflict.persistedRevision = result.persistedRevision ?? null;
        throw conflict;
      }
      const committed = {
        committed: true,
        persistedRevision: Number.isSafeInteger(result?.persistedRevision)
          ? result.persistedRevision
          : sessionRevision,
        savedAt: Number(result?.savedAt || Date.now()),
      };
      this.playerPersistedRevisions.set(sessionKey, committed.persistedRevision);
      if (isCurrentContext()) this.playerPersistedRevision = committed.persistedRevision;
      return committed;
    });
    this.playerSaveQueue = write.catch(() => undefined);
    try {
      const result = await write;
      clearPlayerSessionWal(this.walStorage, sessionKey, {
        writerId: this.playerWalWriterId,
        expectedWriterId: this.playerWalWriterId,
        throughRevision: sessionRevision,
        expectedSession: snapshot,
      });
      const recoveredWriteAhead = isCurrentContext()
        ? this.playerRecoveredWriteAhead
        : null;
      if (
        recoveredWriteAhead
        && recoveredWriteAhead.writerId !== this.playerWalWriterId
      ) {
        clearPlayerSessionWal(this.walStorage, sessionKey, {
          writerId: recoveredWriteAhead.writerId,
          expectedWriterId: recoveredWriteAhead.writerId,
          throughRevision: recoveredWriteAhead.revision,
          expectedSession: recoveredWriteAhead.session,
        });
      }
      if (isCurrentContext()) {
        const resolvedWriterId = this.playerRecoverySelectedWriterId;
        const unresolvedBranches = this.playerRecoveryBranches.filter((candidate) => {
          if (
            candidate.writerId === resolvedWriterId
            || playerSessionWalSnapshotsEqual(candidate, { session: snapshot })
          ) {
            clearPlayerSessionWal(this.walStorage, sessionKey, {
              writerId: candidate.writerId,
              expectedWriterId: candidate.writerId,
              throughRevision: candidate.revision,
              expectedSession: candidate.session,
            });
            return false;
          }
          return true;
        });
        this.playerRecoveryBranches = unresolvedBranches;
        this.playerRecoveredWriteAhead = null;
        this.playerRecoverySelectedWriterId = '';
        this.playerSaveConflictRevision = null;
        this.playerSaveErrorCode = '';
        if (this.playerSessionRevision === sessionRevision) {
          if (unresolvedBranches.length) {
            const nextBranch = unresolvedBranches[0];
            this.applyPlayerSessionSnapshot(nextBranch.session, baseDocument);
            this.playerSessionRevision = Math.max(
              result.persistedRevision,
              nextBranch.revision,
            );
            this.playerQueuedRevision = this.playerSessionRevision;
            this.setPlayerSessionConflict(nextBranch, result.persistedRevision);
            this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload());
          } else {
            this.playerSaveState = 'saved';
            this.playerSaveError = '';
            this.playerSavedAt = result.savedAt;
          }
        } else if (this.playerQueuedRevision > sessionRevision) {
          this.playerSaveState = 'saving';
        } else {
          this.playerSaveState = 'dirty';
          this.sessionAutosave();
        }
        if (unresolvedBranches.length) this.render();
        else this.updatePlayerSaveStatusUi();
      }
      return { saved: true, sessionKey, revision: sessionRevision };
    } catch (error) {
      if (isCurrentContext()) {
        if (this.playerQueuedRevision > sessionRevision) {
          this.playerSaveState = 'saving';
        } else {
          this.playerSaveState = 'error';
          this.playerSaveError = error?.message || this.tr('saveFailed');
          this.playerSaveErrorCode = String(
            error?.code || 'PLAYER_SESSION_SAVE_FAILED',
          );
          this.playerSaveConflictRevision = error?.code === 'PLAYER_SESSION_CONFLICT'
            && (error.persistedRevision === null || Number.isSafeInteger(error.persistedRevision))
            ? error.persistedRevision
            : this.playerSaveConflictRevision;
          if (error?.code === 'PLAYER_SESSION_CONFLICT') {
            this.playerRecoveryBranches = listPlayerSessionWals(
              this.walStorage,
              sessionKey,
            ).filter(
              (candidate) => candidate.session?.makerVersionId === baseDocument.version.versionId,
            );
            const currentBranch = this.playerRecoveryBranches.find(
              (candidate) => candidate.writerId === this.playerWalWriterId,
            ) || this.playerRecoveryBranches[0] || null;
            this.setPlayerSessionConflict(
              currentBranch,
              this.playerSaveConflictRevision,
            );
          }
        }
        if (error?.code === 'PLAYER_SESSION_CONFLICT') this.render();
        else this.updatePlayerSaveStatusUi();
      }
      this.callbacks.onPlayerSaveError?.(error);
      return { saved: false, sessionKey, revision: sessionRevision, error };
    }
  }

  selectedCreatorRecords(document = this.store?.getState().document) {
    const part = document ? findPart(document, this.selectedPartId) : null;
    const item = part ? findItem(document, part.id, this.selectedItemId) : null;
    const style = item ? findStyle(document, part.id, item.id, this.selectedStyleId) : null;
    return { part, item, style };
  }

  itemThumbnailUrl(item, preferredStyleId = '') {
    const explicit = this.runtimeAsset(item?.thumbnailAssetId);
    if (explicit?.thumbnailUrl || explicit?.url) {
      return safeDisplayImageUrl(explicit.thumbnailUrl || explicit.url);
    }
    const style = item?.styles?.find((candidate) => candidate.id === preferredStyleId)
      || item?.styles?.find((candidate) => candidate.id === item.defaultStyleId)
      || item?.styles?.find((candidate) => candidate.assetId)
      || item?.styles?.[0];
    return this.styleThumbnailUrl(style);
  }

  styleThumbnailUrl(style) {
    const source = this.runtimeAsset(style?.assetId);
    if (source?.thumbnailUrl || source?.url) {
      return safeDisplayImageUrl(source.thumbnailUrl || source.url);
    }
    const document = this.runtimeDocument();
    const descriptor = document?.assets?.find((asset) => asset.id === style?.assetId);
    return safeDisplayImageUrl(
      descriptor?.thumbnailUrl || descriptor?.url || descriptor?.legacy?.url || '',
    );
  }

  partThumbnailUrl(part, selection = null) {
    const icon = this.runtimeAsset(part?.iconAssetId);
    if (icon?.thumbnailUrl || icon?.url) {
      return safeDisplayImageUrl(icon.thumbnailUrl || icon.url);
    }
    const selectedItem = part?.items?.find((item) => item.id === selection?.itemId);
    const selectedThumbnail = this.itemThumbnailUrl(selectedItem, selection?.styleId);
    if (selectedThumbnail) return selectedThumbnail;
    const fallbackItem = this.playerVisibleItems(part).find((item) => this.itemThumbnailUrl(item));
    return this.itemThumbnailUrl(fallbackItem);
  }

  makerCoverUrl(document = this.store?.getState().document) {
    const coverAssetId = document?.metadata?.coverAssetId;
    if (!coverAssetId) return '';
    const runtime = this.runtimeAsset(coverAssetId);
    if (runtime?.thumbnailUrl || runtime?.url) {
      return safeDisplayImageUrl(runtime.thumbnailUrl || runtime.url);
    }
    const descriptor = document.assets?.find((asset) => asset.id === coverAssetId);
    return safeDisplayImageUrl(
      descriptor?.thumbnailUrl || descriptor?.url || descriptor?.legacy?.url || '',
    );
  }

  publicationIssues(document = this.store?.getState().document) {
    if (!document) return [];
    const issues = collectMakerV5ValidationIssues(document, { mode: 'publish' })
      .filter((issue) => issue.path !== 'metadata.coverAssetId')
      .map(compactIssue);
    const externalIssues = Array.isArray(this.context?.externalPublicationIssues)
      ? this.context.externalPublicationIssues
      : [];
    issues.unshift(...externalIssues
      .filter((issue) => issue && typeof issue === 'object' && issue.message)
      .map((issue) => ({
        code: String(issue.code || 'external_publication_issue'),
        path: String(issue.path || 'publication'),
        message: String(issue.message),
      })));
    if (document.extensions?.stressTest?.doNotPublish === true) {
      issues.unshift({
        code: 'fixture_do_not_publish',
        path: 'extensions.stressTest.doNotPublish',
        message: 'This negative stress fixture is deliberately blocked from publication. Create a clean Maker from reviewed, human-approved assets.',
      });
    }
    let ruleIssues = this.rulePreflightCache.get(document);
    if (!ruleIssues) {
      ruleIssues = collectMakerRulePreflightIssues(document);
      this.rulePreflightCache.set(document, ruleIssues);
    }
    issues.push(...ruleIssues.map((issue) => ({ ...issue })));
    if (!linkedPartTrackOrderMatches(document)) {
      issues.push({
        code: 'part_track_order_mismatch',
        path: 'layerTracks',
        message: 'Standard Part order and linked Layer Track order differ. Sync them before publishing so Player, Renderer, Walrus and Sui use one order.',
      });
    }
    workspaceStyleRecords(document)
      .filter(({ item }) => (item.status || 'public') === 'public')
      .forEach(({ style, partName, itemName, path }) => {
      const runtime = this.runtimeAsset(style.assetId);
      const descriptor = workspaceAssetDescriptor(document, style.assetId);
      if (!style.assetId || (!runtime && !descriptor?.url && !descriptor?.legacy?.url)) {
        issues.push({ code: 'runtime_asset_missing', path, message: `${partName} / ${itemName} / ${style.name} is missing its local or remote PNG.` });
      } else if (runtime?.hasVisiblePixels === false) {
        issues.push({ code: 'transparent_public_style', path, message: `${partName} / ${itemName} / ${style.name} is fully transparent. Use an optional Part for “None” instead of an empty PNG.` });
      } else if (style.positionConfirmed === false) {
        issues.push({ code: 'position_unconfirmed', path, message: `${partName} / ${itemName} / ${style.name} has a cropped PNG whose Canvas position is not confirmed.` });
      }
    });
    const runtime = this.runtimeDocument();
    try {
      const scene = resolveMakerScene(runtime, document.defaultRecipe, { strict: false });
      scene.issues.forEach((issue) => issues.push(compactIssue(issue)));
    } catch (error) {
      issues.push({ code: 'default_recipe_render', path: 'defaultRecipe', message: error.message });
    }
    const compatibility = this.compatibilityReport(document);
    if (compatibility && !compatibility.compatible && document.version.compatibility !== 'breaking') {
      issues.push({
        code: 'compatibility_declaration_mismatch',
        path: 'version.compatibility',
        message: 'This update changes existing recipes or rendering. Confirm it as breaking so old OCs remain pinned to their previous Maker version.',
      });
    }
    (document.extensions?.expansionDrafts || []).forEach((pack) => {
      const result = checkExpansionPackCompatibility(document, pack);
      result.errors.forEach((error) => issues.push({
        code: `expansion_${error.code || 'incompatible'}`,
        path: `extensions.expansionDrafts.${pack.packId || 'pack'}`,
        message: `${pack.name || pack.packId || 'ExpansionPack'}: ${error.message || error.code || 'not compatible with this Maker version'}.`,
      }));
    });
    const soulConfig = validateSoulConfig(document.livingContent, document);
    if (!soulConfig.valid) {
      issues.push({
        code: 'invalid_living_content',
        path: 'livingContent',
        message: soulConfig.error || 'Soul Configuration must contain valid personality, memory, and SKILL.md documents.',
      });
    }
    let releaseIssues = this.releasePreflightCache.get(document);
    if (!releaseIssues) {
      releaseIssues = [];
      try {
        const expansionDrafts = clone(document.extensions?.expansionDrafts || []);
        const releaseDocument = clone(document);
        const usedAssetIds = new Set(releaseDocument.assets.map((asset) => asset.id));
        const usedIdentifiers = new Set(releaseDocument.assets.map((asset) => asset.identifier).filter(Boolean));
        let coverAssetId = 'maker-release-cover';
        let coverSuffix = 2;
        while (usedAssetIds.has(coverAssetId)) {
          coverAssetId = `maker-release-cover-${coverSuffix}`;
          coverSuffix += 1;
        }
        let coverIdentifier = 'maker-cover.png';
        coverSuffix = 2;
        while (usedIdentifiers.has(coverIdentifier)) {
          coverIdentifier = `maker-cover-${coverSuffix}.png`;
          coverSuffix += 1;
        }
        releaseDocument.assets.push({
          id: coverAssetId,
          identifier: coverIdentifier,
          kind: 'maker-cover',
          mediaType: 'image/png',
          width: releaseDocument.canvas.width,
          height: releaseDocument.canvas.height,
          source: 'generated-release-preflight',
        });
        releaseDocument.metadata.coverAssetId = coverAssetId;
        const runtimeAssets = new Map();
        collectReferencedMakerV4AssetIds(releaseDocument).forEach((assetId) => {
          if (assetId === coverAssetId) {
            runtimeAssets.set(assetId, publicationPreflightPngBlob());
            return;
          }
          const descriptor = workspaceAssetDescriptor(releaseDocument, assetId);
          const blob = publicationPreflightAssetBlob(this.runtimeAsset(assetId), descriptor);
          if (blob) runtimeAssets.set(assetId, blob);
        });
        buildMakerV4PublicationBundle(releaseDocument, runtimeAssets, {
          previousDocument: this.context?.publishedDocument || null,
          publicExtensions: expansionDrafts.length
            ? { expansionRuntime: 'embedded-v1', expansionDrafts }
            : {},
          projectionAuxiliaryBlob: publicationPreflightPngBlob(),
        });
      } catch (error) {
        releaseIssues.push({
          code: `release_${String(error?.code || 'compilation_failed')}`,
          path: 'publication.release',
          message: error?.message || 'The final Walrus manifest and Sui projection could not be compiled.',
        });
      }
      this.releasePreflightCache.set(document, releaseIssues);
    }
    issues.push(...releaseIssues.map((issue) => ({ ...issue })));
    issues.push(...collectTrackAlignmentWarnings(document, this.assets));
    return issues.filter((issue, index, entries) => entries.findIndex((candidate) => `${candidate.code}:${candidate.path}:${candidate.message}` === `${issue.code}:${issue.path}:${issue.message}`) === index);
  }

  blockingPublicationIssues(document = this.store?.getState().document) {
    return this.publicationIssues(document).filter((issue) => issue.severity !== 'warning');
  }

  compatibilityReport(document = this.store?.getState().document) {
    if (!document || !this.context?.publishedDocument) return null;
    try {
      return compareMakerCompatibility(this.context.publishedDocument, document);
    } catch (error) {
      return { compatible: false, level: 'error', summary: error.message, breaking: [{ code: 'compatibility-check', message: error.message }], warnings: [], additions: [] };
    }
  }

  getDocument() {
    return this.store ? clone(this.store.getState().document) : null;
  }

  async listDraftProjects(filter = {}) {
    return this.draftRepository.listProjects(filter);
  }

  async loadDraftProject(makerKey) {
    return this.draftRepository.load(makerKey);
  }

  async commitRecoveredDraftCopy({
    makerKey,
    document,
    recipe = document?.defaultRecipe,
    assets = [],
    metadata = {},
  } = {}) {
    const requestedMakerKey = String(makerKey || '').trim();
    if (!requestedMakerKey) throw new Error(this.tr('recoveryMakerKeyRequired'));
    if (!isMakerV5Document(document)) {
      throw new Error(this.tr('recoveryOnlyV5'));
    }
    if (!Array.isArray(assets)) throw new Error(this.tr('recoveryAssetsArray'));

    const existing = await this.draftRepository.load(requestedMakerKey);
    if (existing) throw new Error(this.tr('recoveryDestinationExists'));

    const snapshot = {
      revision: 0,
      baseRevision: null,
      document: clone(document),
      recipe: clone(recipe || document.defaultRecipe),
      assets: clone(assets),
      metadata: {
        ...clone(metadata),
        recoveryCopy: true,
      },
    };
    const committed = await this.draftRepository.save(requestedMakerKey, snapshot);
    if (!committed?.confirmed || committed.conflict) {
      throw new Error(this.tr('recoveryStorageConflict'));
    }
    await this.draftRepository.flush(requestedMakerKey);

    const verified = await this.draftRepository.load(requestedMakerKey);
    const documentMatches = verified?.document
      && JSON.stringify(verified.document) === JSON.stringify(snapshot.document);
    const recipeMatches = verified?.recipe
      && JSON.stringify(verified.recipe) === JSON.stringify(snapshot.recipe);
    const expectedAssets = new Map();
    snapshot.assets.forEach((asset) => {
      const assetId = String(asset?.assetId || '').trim();
      if (!assetId) throw new Error(this.tr('recoveryAssetIdRequired'));
      if (expectedAssets.has(assetId)) {
        throw new Error(this.tr('recoveryAssetDuplicated', { assetId }));
      }
      expectedAssets.set(assetId, asset);
    });
    const verifiedAssets = new Map(
      (verified?.assets || []).map((asset) => [String(asset?.assetId || '').trim(), asset]),
    );
    let assetsMatch = expectedAssets.size === verifiedAssets.size;
    for (const [assetId, expectedAsset] of expectedAssets) {
      const verifiedAsset = verifiedAssets.get(assetId);
      if (!verifiedAsset) {
        assetsMatch = false;
        break;
      }
      const expectedBlob = persistedAssetBlob(expectedAsset);
      if (expectedBlob) {
        const verifiedBlob = persistedAssetBlob(verifiedAsset);
        if (!await blobPayloadsEqual(expectedBlob, verifiedBlob)) {
          assetsMatch = false;
          break;
        }
      }
      for (const field of ['identifier', 'kind', 'mediaType', 'width', 'height', 'url']) {
        if ((expectedAsset[field] ?? null) !== (verifiedAsset[field] ?? null)) {
          assetsMatch = false;
          break;
        }
      }
      if (!assetsMatch) break;
    }
    if (
      verified?.revision !== 0
      || !documentMatches
      || !recipeMatches
      || !assetsMatch
    ) {
      throw new Error(this.tr('recoveryReadbackFailed'));
    }
    return verified;
  }

  async deleteDraftProject(makerKey) {
    const requestedMakerKey = String(makerKey || '').trim();
    if (!requestedMakerKey) throw new Error('Maker key is required.');
    const deletingCurrentMaker = Boolean(
      requestedMakerKey
      && requestedMakerKey === this.makerKey
    );
    const pendingCreatorText = deletingCurrentMaker
      ? this.pendingCreatorText
      : null;
    this.deletedMakerKeys.add(requestedMakerKey);
    try {
      if (deletingCurrentMaker) {
        // Prevent delayed input and autosave callbacks from publishing another
        // revision after the repository tombstone. Already-running saves are
        // allowed to finish before deleteProject is queued.
        this.textAutosave.cancel();
        this.autosave.cancel();
        await this.textAutosave.flush();
        await this.autosave.flush();
      }
      await this.draftRepository.flush?.(requestedMakerKey);
      const result = await this.draftRepository.deleteProject(requestedMakerKey);
      if (deletingCurrentMaker && this.makerKey === requestedMakerKey) {
        this.pendingCreatorText = null;
      }
      this.clearWriteAheadSnapshot(requestedMakerKey);
      return result;
    } catch (error) {
      this.deletedMakerKeys.delete(requestedMakerKey);
      if (deletingCurrentMaker && this.makerKey === requestedMakerKey) {
        this.pendingCreatorText = pendingCreatorText;
        if (this.pendingCreatorText) this.textAutosave();
        if (this.store?.getState().dirty) this.autosave();
      }
      if (error?.code === 'MAKER_DRAFT_DELETE_CONFLICT') {
        const localized = new Error(this.tr('workspaceDeleteConflict'));
        localized.code = error.code;
        throw localized;
      }
      throw error;
    }
  }

  getCreatorRecipe() {
    return this.store ? clone(this.creatorRecipe || this.store.getState().recipe) : null;
  }

  getPlayerSnapshot() {
    const document = this.runtimeDocument();
    return {
      document: document ? clone(document) : null,
      recipe: clone(this.playerRecipe),
      profile: clone(this.playerProfile),
      livingContent: clone(this.resolvedPlayerLivingContent(document)?.content || null),
      assets: new Map(this.assets),
    };
  }

  getPublicationIssues() {
    const document = this.store?.getState().document;
    return this.blockingPublicationIssues(document).map((issue) => {
      if (this.locale === 'en' || !document) return { ...issue };
      const styleRecord = workspaceStyleRecords(document)
        .find((record) => record.path === String(issue.path || ''));
      const [partId, itemId, styleId] = String(issue.path || '').split('/');
      const part = styleRecord?.part || findPart(document, partId);
      const item = styleRecord?.item || (part && findItem(document, partId, itemId));
      const style = styleRecord?.style
        || item?.styles.find((candidate) => candidate.id === styleId);
      return {
        ...issue,
        rawMessage: issue.message,
        message: this.issueText(issue, {
          part: part?.name || partId,
          item: item?.name || itemId,
          style: style?.name || styleId,
        }),
      };
    });
  }

  setCreatorPublishState(nextState = {}) {
    this.setPublicationState('creator', nextState);
  }

  openCreatorReleaseManager() {
    if (!this.store) return false;
    this.creatorPublishOpen = true;
    this.creatorPublishCloseConfirm = false;
    this.render();
    this.focusCreatorPublishDialog();
    return true;
  }

  async discardVersionDraft() {
    const operation = this.captureMakerOperation();
    if (this.lifecycleMutationMakerKeys.has(operation.makerKey)) return false;
    const publishedSource = this.context?.publishedDocument;
    const currentDocument = operation.store?.getState?.().document;
    const currentVersionId = String(currentDocument?.version?.versionId || '');
    const publishedVersionId = String(publishedSource?.version?.versionId || '');
    if (
      this.context?.isPublished !== true
      || !isMakerV5Document(publishedSource)
      || !currentVersionId
      || !publishedVersionId
      || currentVersionId === publishedVersionId
    ) return false;

    const pendingCreatorText = this.pendingCreatorText;
    this.lifecycleMutationMakerKeys.add(operation.makerKey);
    this.textAutosave.cancel();
    this.autosave.cancel();
    try {
      // Wait for a save that had already begun before this lifecycle action.
      // No later save for this Maker can start while the mutation lock is held.
      await this.textAutosave.flush();
      await this.autosave.flush();
      await this.draftRepository.flush?.(operation.makerKey);
      if (!this.isCurrentMakerOperation(
        operation.makerKey,
        operation.store,
        operation.contextEpoch,
      )) return false;

      const publishedDocument = this.normalizeDocument(clone(publishedSource));
      const publishedRecipe = clone(
        this.context?.publishedRecipe || publishedDocument.defaultRecipe,
      );
      const repositoryStatus = this.draftRepository.getStatus?.(operation.makerKey) || {};
      const originalSnapshot = operation.store.snapshotForSave();
      const persistedRevision = Number.isSafeInteger(repositoryStatus.persistedRevision)
        ? repositoryStatus.persistedRevision
        : originalSnapshot.baseRevision;
      const nextRevision = Math.max(
        originalSnapshot.revision,
        Number.isSafeInteger(repositoryStatus.latestRequestedRevision)
          ? repositoryStatus.latestRequestedRevision
          : -1,
        Number.isSafeInteger(persistedRevision) ? persistedRevision : -1,
      ) + 1;
      const assets = [...this.assets.values()].map((record) => ({
        ...record,
        url: persistedAssetUrl(record.url),
        thumbnailUrl: persistedAssetUrl(record.thumbnailUrl),
      }));

      operation.store.setSaveState('saving', this.tr('savingChanges'));
      let result;
      try {
        result = await this.draftRepository.save(operation.makerKey, {
          revision: nextRevision,
          baseRevision: Number.isSafeInteger(persistedRevision)
            ? persistedRevision
            : null,
          document: publishedDocument,
          recipe: publishedRecipe,
          journal: [],
          assets,
          metadata: workspacePersistenceMetadata(
            this.context,
            { document: publishedDocument },
            this.context.walletAddress,
          ),
        });
        await this.draftRepository.flush?.(operation.makerKey);
      } catch (error) {
        if (this.isCurrentMakerOperation(
          operation.makerKey,
          operation.store,
          operation.contextEpoch,
        )) {
          operation.store.setSaveState('error', error.message || this.tr('saveFailed'));
        }
        return false;
      }

      const current = this.isCurrentMakerOperation(
        operation.makerKey,
        operation.store,
        operation.contextEpoch,
      );
      if (!current || !result?.confirmed || result.conflict === true) {
        if (current) operation.store.setSaveState('error', this.tr('saveFailed'));
        return false;
      }

      // Persistence is now confirmed. Only at this point is the visible
      // workspace switched to the published snapshot, making failure rollback
      // implicit: before confirmation no document, history, selection, or
      // Player state has been touched.
      this.pendingCreatorText = null;
      this.resetPlayerExport();
      operation.store.replace(publishedDocument, publishedRecipe, {
        clearHistory: true,
        markSaved: true,
        persistedRevision: Number.isSafeInteger(result.persistedRevision)
          ? result.persistedRevision
          : nextRevision,
      });
      this.creatorRecipe = clone(publishedRecipe);
      const playablePlayerRecipe = normalizePlayablePlayerRecipe(
        publishedDocument,
        publishedRecipe,
        this.playerOptionSettings(publishedDocument),
      );
      this.playerRecipe = playablePlayerRecipe.documentRecipe;
      this.playerUndo = [];
      this.playerRedo = [];
      this.ensureCreatorSelection(publishedDocument);
      this.clearWriteAheadSnapshot(operation.makerKey);

      const revision = operation.store.getState().revision;
      const payload = {
        makerKey: operation.makerKey,
        document: operation.store.getState().document,
        recipe: operation.store.getState().recipe,
        assets: this.assets,
        automatic: false,
        revision,
      };
      this.callbacks.onDocumentChange?.({
        ...payload,
        event: {
          reason: 'discard-version-draft',
          label: 'Discard version draft',
        },
      });
      this.callbacks.onSaved?.(payload);
      this.render();
      return true;
    } finally {
      this.lifecycleMutationMakerKeys.delete(operation.makerKey);
      if (
        this.isCurrentMakerOperation(
          operation.makerKey,
          operation.store,
          operation.contextEpoch,
        )
        && operation.store.getState().document.version.versionId === currentVersionId
      ) {
        this.pendingCreatorText = pendingCreatorText;
        if (this.pendingCreatorText) this.textAutosave();
        if (operation.store.getState().dirty) this.autosave();
      }
    }
  }

  openCreatorPublication() {
    const document = this.store?.getState?.().document;
    if (!document) return;
    const issues = this.blockingPublicationIssues(document);
    if (issues.length) {
      this.creatorTab = 'validate';
      this.render();
      return;
    }
    const operation = this.captureMakerOperation();
    void this.flushPendingChanges({ reason: 'publish' }).then((result) => {
      if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      if (!result.saved) {
        operation.store.setSaveState('error', operation.store.getState().saveMessage || this.tr('saveFailed'));
        return;
      }
      const savedDocument = operation.store.getState().document;
      const savedIssues = this.blockingPublicationIssues(savedDocument);
      if (savedIssues.length) {
        this.creatorTab = 'validate';
        this.render();
        return;
      }
      this.creatorPublishOpen = true;
      this.creatorPublishCloseConfirm = false;
      this.callbacks.onPublish?.({
        document: savedDocument,
        recipe: savedDocument.defaultRecipe,
        assets: this.assets,
        compatibility: this.compatibilityReport(savedDocument),
      });
      this.render();
      this.focusCreatorPublishDialog();
    }).catch((error) => {
      if (this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
        operation.store.setSaveState('error', error.message || this.tr('saveFailed'));
      }
    });
  }

  setPlayerPublishState(nextState = {}) {
    this.setPublicationState('player', nextState);
  }

  setPublicationState(kind, nextState = {}) {
    const stateKey = kind === 'creator' ? 'creatorPublishState' : 'playerPublishState';
    const closeConfirmKey = kind === 'creator'
      ? 'creatorPublishCloseConfirm'
      : 'playerPublishCloseConfirm';
    const copyStateKey = kind === 'creator'
      ? 'creatorPublishCopyState'
      : 'playerPublishCopyState';
    const previous = this[stateKey];
    const next = {
      ...previous,
      ...nextState,
      actions: { ...previous.actions, ...(nextState.actions || {}) },
    };
    const changed = JSON.stringify(next) !== JSON.stringify(previous);
    if (next.error?.diagnostic !== previous.error?.diagnostic) this[copyStateKey] = 'idle';
    const closeConfirmationSettled = Boolean(this[closeConfirmKey] && !next.busy);
    if (closeConfirmationSettled) this[closeConfirmKey] = false;
    this[stateKey] = next;
    if ((changed || closeConfirmationSettled) && this.store) {
      requestAnimationFrame(() => {
        this.render();
        if (closeConfirmationSettled && this[`${kind}PublishOpen`]) {
          this.focusPublishDialog(kind);
        }
      });
    }
  }

  focusPublishDialog(kind, selector = '') {
    const root = kind === 'creator' ? this.creatorRoot : this.playerRoot;
    const dialogId = kind === 'creator' ? 'makerCreatorPublishDialog' : 'makerPlayerPublishDialog';
    requestAnimationFrame(() => {
      root?.querySelector(selector || `#${dialogId}`)?.focus?.({ preventScroll: true });
    });
  }

  focusCreatorPublishDialog(selector = '#makerCreatorPublishDialog') {
    this.focusPublishDialog('creator', selector);
  }

  focusPlayerPublishDialog(selector = '#makerPlayerPublishDialog') {
    this.focusPublishDialog('player', selector);
  }

  modalFocusableElements(scope) {
    if (!scope?.querySelectorAll) return [];
    return [...scope.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), details > summary, [href], [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hidden && node.getAttribute?.('aria-hidden') !== 'true');
  }

  trapModalFocus(scope, event) {
    if (!scope?.querySelectorAll) return;
    const focusable = this.modalFocusableElements(scope);
    if (!focusable.length) {
      event.preventDefault?.();
      scope.focus?.();
      return;
    }
    const active = globalThis.document?.activeElement;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (active === scope || active === first || !scope.contains?.(active))) {
      event.preventDefault?.();
      last.focus?.();
    } else if (!event.shiftKey && (active === last || !scope.contains?.(active))) {
      event.preventDefault?.();
      first.focus?.();
    }
  }

  trapPublishFocus(kind, event) {
    const root = kind === 'creator' ? this.creatorRoot : this.playerRoot;
    const closeConfirm = kind === 'creator'
      ? this.creatorPublishCloseConfirm
      : this.playerPublishCloseConfirm;
    const dialogId = kind === 'creator' ? 'makerCreatorPublishDialog' : 'makerPlayerPublishDialog';
    const confirmId = kind === 'creator'
      ? 'makerCreatorPublishCloseConfirm'
      : 'makerPlayerPublishCloseConfirm';
    const dialog = root?.querySelector(`#${dialogId}`);
    if (!dialog?.querySelectorAll) return;
    const scope = closeConfirm ? root?.querySelector(`#${confirmId}`) : dialog;
    if (!scope?.querySelectorAll) return;
    this.trapModalFocus(scope, event);
  }

  trapCreatorPublishFocus(event) {
    this.trapPublishFocus('creator', event);
  }

  trapPlayerPublishFocus(event) {
    this.trapPublishFocus('player', event);
  }

  handlePublishDialogKeydown(kind, event) {
    const open = kind === 'creator' ? this.creatorPublishOpen : this.playerPublishOpen;
    if (!open) return false;
    if (event.key === 'Tab') {
      this.trapPublishFocus(kind, event);
    } else if (event.key === 'Escape') {
      event.preventDefault?.();
      const closeConfirmKey = kind === 'creator'
        ? 'creatorPublishCloseConfirm'
        : 'playerPublishCloseConfirm';
      if (this[closeConfirmKey]) {
        this[closeConfirmKey] = false;
        this.render();
        this.focusPublishDialog(
          kind,
          `[data-action="close-${kind}-publish"]`,
        );
      } else {
        this.requestClosePublication(kind);
      }
    }
    return true;
  }

  requestClosePublication(kind, { force = false } = {}) {
    const state = kind === 'creator' ? this.creatorPublishState : this.playerPublishState;
    const closeConfirmKey = kind === 'creator'
      ? 'creatorPublishCloseConfirm'
      : 'playerPublishCloseConfirm';
    // A Player step owns the exact reviewed OC snapshot. Letting the Player
    // close and edit while that step is running could publish an older image
    // or profile after the visible OC changed. Creator document edits are
    // independently write-locked during publication, so their existing
    // checkpoint-preserving close path remains safe.
    if (state.busy && (!force || kind === 'player')) {
      this[closeConfirmKey] = true;
      this.render();
      this.focusPublishDialog(kind, `[data-action="keep-${kind}-publish-open"]`);
      return;
    }
    this[`${kind}PublishOpen`] = false;
    this[closeConfirmKey] = false;
    this.render();
    const returnSelector = kind === 'creator'
      ? '[data-action="publish"]'
      : '[data-action="player-complete"]';
    requestAnimationFrame(() => {
      const root = kind === 'creator' ? this.creatorRoot : this.playerRoot;
      root?.querySelector(returnSelector)?.focus?.({ preventScroll: true });
    });
  }

  requestCloseCreatorPublish(options = {}) {
    this.requestClosePublication('creator', options);
  }

  requestClosePlayerPublish(options = {}) {
    this.requestClosePublication('player', options);
  }

  async copyPublishError(kind) {
    const state = kind === 'creator' ? this.creatorPublishState : this.playerPublishState;
    const copyStateKey = kind === 'creator'
      ? 'creatorPublishCopyState'
      : 'playerPublishCopyState';
    const text = String(state.error?.diagnostic || state.error?.details || '');
    if (!text) return;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(text);
      } else {
        const textarea = globalThis.document?.createElement?.('textarea');
        if (!textarea || !globalThis.document?.body) throw new Error('Clipboard unavailable');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        globalThis.document.body.append(textarea);
        textarea.select();
        const copied = globalThis.document.execCommand?.('copy');
        textarea.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      this[copyStateKey] = 'copied';
    } catch {
      this[copyStateKey] = 'error';
    }
    this.render();
    this.focusPublishDialog(kind, `[data-action="copy-${kind}-publish-error"]`);
  }

  async copyCreatorPublishError() {
    await this.copyPublishError('creator');
  }

  async copyPlayerPublishError() {
    await this.copyPublishError('player');
  }

  openCreatorTab(tab = 'structure') {
    const allowed = new Set(['structure', 'info', 'layers', 'colors', 'rules', 'expansions', 'soul', 'validate']);
    this.creatorTab = allowed.has(tab) ? tab : 'structure';
    if (this.creatorTab !== 'rules') this.ruleBuilderError = '';
    this.render();
    requestAnimationFrame(() => {
      const selector = this.creatorTab === 'structure'
        ? '[data-action="creator-tab"][data-tab="structure"]'
        : '.v4-tool-modal-backdrop [data-action="close-tool"]';
      this.creatorRoot?.querySelector(selector)?.focus?.({ preventScroll: true });
    });
  }

  focusPlayerInfoDialog(selector = '#makerPlayerInfoDialog') {
    requestAnimationFrame(() => {
      this.playerRoot?.querySelector(selector)?.focus?.({ preventScroll: true });
    });
  }

  focusPlayerExportDialog(selector = '#makerPlayerExportDialog') {
    requestAnimationFrame(() => {
      this.playerRoot?.querySelector(selector)?.focus?.({ preventScroll: true });
    });
  }

  handlePlayerRadioKeydown(event) {
    const keys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
    if (!keys.has(event?.key)) return false;
    const current = event.target?.closest?.('[role="radio"][data-player-radio-group]');
    const group = current?.closest?.('[role="radiogroup"]');
    if (!current || !group?.querySelectorAll) return false;
    const radios = [...group.querySelectorAll('[role="radio"][data-player-radio-group]')]
      .filter((radio) => !radio.hidden);
    const currentIndex = radios.indexOf(current);
    if (currentIndex < 0 || radios.length === 0) return false;
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = radios.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + radios.length) % radios.length;
    } else {
      nextIndex = (currentIndex + 1) % radios.length;
    }
    event.preventDefault?.();
    const next = radios[nextIndex];
    radios.forEach((radio, index) => radio.setAttribute?.('tabindex', index === nextIndex ? '0' : '-1'));
    next.focus?.({ preventScroll: true });
    if (next.getAttribute?.('aria-disabled') === 'true') return true;
    const groupKey = String(next.dataset?.playerRadioGroup || '');
    const radioIndex = String(next.dataset?.playerRadioIndex || '');
    next.click?.();
    requestAnimationFrame(() => {
      this.playerRoot?.querySelector(
        `[role="radio"][data-player-radio-group="${groupKey}"][data-player-radio-index="${radioIndex}"]`,
      )?.focus?.({ preventScroll: true });
    });
    return true;
  }

  capturePlayerExportScroll() {
    const body = this.playerRoot?.querySelector?.('.v4-player-export-body');
    if (!body) return null;
    return {
      left: Number(body.scrollLeft || 0),
      top: Number(body.scrollTop || 0),
    };
  }

  restorePlayerExportScroll(position) {
    if (!position) return;
    requestAnimationFrame(() => {
      const body = this.playerRoot?.querySelector?.('.v4-player-export-body');
      if (!body) return;
      body.scrollLeft = position.left;
      body.scrollTop = position.top;
    });
  }

  closePlayerInfo() {
    if (!this.playerIntroOpen) return;
    this.playerIntroOpen = false;
    this.markPlayerSessionDirty();
    this.sessionAutosave();
    this.render();
    requestAnimationFrame(() => {
      this.playerRoot?.querySelector('[data-action="player-info"]')?.focus?.({ preventScroll: true });
    });
  }

  setLocale(locale = 'en', { render = true } = {}) {
    const next = ['en', 'zh', 'ja', 'ko', 'vi'].includes(locale) ? locale : 'en';
    if (next === this.locale) return;
    this.locale = next;
    if (this.playerSaveErrorCode === 'PLAYER_SESSION_CONFLICT') {
      this.playerSaveError = this.playerSessionConflictMessage();
    }
    if (render) this.render();
  }

  setPlayerCreatorPreview(enabled, { render = true } = {}) {
    const next = Boolean(enabled);
    if (next === this.playerCreatorPreview) return;
    this.playerCreatorPreview = next;
    if (render) this.render();
  }

  tr(key, variables = {}) {
    return makerWorkspaceText(this.locale, key, variables);
  }

  makerInfoByteStatus(action, value) {
    const spec = MAKER_INFO_FIELD_SPECS[action];
    if (!spec) return null;
    const bytes = utf8Length(value);
    return {
      ...spec,
      bytes,
      valid: bytes <= spec.limit,
      over: Math.max(0, bytes - spec.limit),
      statusId: `makerInfoBytes-${action}`,
    };
  }

  makerInfoByteStatusText(status) {
    if (!status) return '';
    const count = this.tr('makerInfoByteCount', {
      bytes: status.bytes,
      limit: status.limit,
    });
    return status.valid
      ? count
      : `${count} · ${this.tr('makerInfoByteExceeded', { over: status.over })}`;
  }

  updateMakerInfoByteStatus(input) {
    const status = this.makerInfoByteStatus(input?.dataset?.action, input?.value);
    if (!status) return;
    input.setAttribute?.('aria-invalid', status.valid ? 'false' : 'true');
    input.setAttribute?.('aria-describedby', status.statusId);
    const output = this.creatorRoot?.querySelector?.(`#${status.statusId}`);
    if (output) {
      output.textContent = this.makerInfoByteStatusText(status);
      output.classList?.toggle?.('invalid', !status.valid);
    }
  }

  blendModeText(mode) {
    const key = {
      normal: 'blendNormal', multiply: 'blendMultiply', screen: 'blendScreen', overlay: 'blendOverlay', darken: 'blendDarken', lighten: 'blendLighten',
      'color-dodge': 'blendColorDodge', 'color-burn': 'blendColorBurn', 'hard-light': 'blendHardLight', 'soft-light': 'blendSoftLight', difference: 'blendDifference', exclusion: 'blendExclusion',
      hue: 'blendHue', saturation: 'blendSaturation', color: 'blendColor', luminosity: 'blendLuminosity', 'linear-dodge': 'blendLinearDodge',
    }[mode];
    return key ? this.tr(key) : String(mode || '');
  }

  licenseText(kind) {
    const key = {
      'personal-use': 'licensePersonalUse', 'free-remix': 'licenseFreeRemix', 'paid-commercial': 'licensePaidCommercial', 'exclusive-commission': 'licenseExclusiveCommission',
    }[kind];
    return key ? this.tr(key) : String(kind || this.tr('unknown'));
  }

  saveStateText(state) {
    if (state.saveState === 'error') return state.saveMessage || this.tr('saveFailed');
    if (state.saveState === 'saving') return this.tr('savingChanges');
    if (state.saveState === 'dirty' || state.dirty) return this.tr('unsavedChanges');
    if (state.saveMessage === 'Loaded') return this.tr('loadingStatus');
    if (state.saveState === 'saved' && state.saveMessage) return state.saveMessage;
    return this.tr('savedStatus');
  }

  formatSavedClock(value) {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return '';
    const locale = {
      en: 'en-US',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
      vi: 'vi-VN',
    }[this.locale] || 'en-US';
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  formatCheckpointSavedAt(value) {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return this.tr('versionHistoryUnknownTime');
    const locale = {
      en: 'en-US',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
      vi: 'vi-VN',
    }[this.locale] || 'en-US';
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  issueText(issue, context = {}) {
    if (issue.code === 'external_version_draft_conflict') {
      return issue.message || this.tr('issueInvalid');
    }
    if (issue.code === 'runtime_asset_missing') return this.tr('missingAsset', context);
    if (issue.code === 'position_unconfirmed') return this.tr('positionUnconfirmed', context);
    if (issue.code === 'transparent_public_style') return this.tr('transparentPublicStyle', context);
    if (issue.code === 'fixture_do_not_publish') return this.tr('issueFixtureDoNotPublish');
    const makerInfoField = makerInfoFieldByPath(issue.path);
    if (issue.code === 'invalid_text' && makerInfoField) {
      return this.tr('makerInfoProtocolTextInvalid', {
        field: this.tr(makerInfoField.labelKey),
        limit: makerInfoField.limit,
      });
    }
    if (this.locale === 'en') return issue.message || this.tr('issueUnknown');
    if (issue.code === 'default_recipe_rule_violation') return this.tr('issueDefaultRecipeRules');
    if (issue.code === 'unsatisfiable_maker_rules') return this.tr('issueUnsatisfiableRules');
    if (issue.code === 'unreachable_public_item_rules') return this.tr('issueUnreachableItem', context);
    if (issue.code === 'unreachable_public_style_rules') return this.tr('issueUnreachableStyle', context);
    if (issue.code === 'maker_rule_search_limit') return this.tr('issueRuleSearchLimit');
    if (issue.code === 'compatibility_declaration_mismatch') return this.tr('issueCompatibility');
    if (issue.code === 'part_track_order_mismatch') return this.tr('issuePartTrackOrder');
    if (String(issue.code).startsWith('release_')) {
      return this.tr('issueReleaseCompilation', {
        code: String(issue.code).slice('release_'.length),
      });
    }
    if (issue.code === 'default_recipe_render') return this.tr('issueRender');
    if (String(issue.code).startsWith('expansion_')) return this.tr('issueExpansion');
    if (issue.code === 'missing_reference') return this.tr('issueMissingReference');
    if (issue.code === 'duplicate' || issue.code === 'duplicate-selection') return this.tr('issueDuplicate');
    if (issue.code === 'limit') return this.tr('issueLimit');
    if (issue.code === 'cycle') return this.tr('issueCycle');
    if (issue.code === 'contradictory_rule') return this.tr('issueContradictory');
    if (issue.code === 'missing_default') return this.tr('issueMissingDefault');
    if (issue.code === 'invalid_default') return this.tr('issueInvalidDefault');
    if (String(issue.code).includes('rule') || String(issue.code).includes('recipe')) return this.tr('issueRule');
    if (String(issue.code).startsWith('invalid_') || String(issue.code).startsWith('unsupported_')) return this.tr('issueInvalid');
    if (String(issue.code).startsWith('unknown') || String(issue.code).includes('missing')) return this.tr('issueUnknown');
    return this.tr('issueInvalid');
  }

  captureCreatorViewState() {
    if (!this.creatorRoot?.querySelector) return null;
    const scrollSelectors = [
      '.v4-parts-list', '.v4-canvas-viewport', '.v4-inspector', '.v4-item-grid', '.v4-advanced-panel',
      '.v4-track-list', '.v4-color-workspace', '.v4-rule-list', '.v4-expansion-grid', '.v4-soul-editor', '.v4-preflight-list',
    ];
    const scroll = scrollSelectors.map((selector) => {
      const node = this.creatorRoot.querySelector(selector);
      return node ? { selector, top: node.scrollTop, left: node.scrollLeft } : null;
    }).filter(Boolean);
    const active = globalThis.document?.activeElement;
    const ownsActive = Boolean(active && this.creatorRoot.contains?.(active));
    const identity = ownsActive ? {
      id: active.id || '',
      action: active.dataset?.action || '',
      dataset: Object.fromEntries(Object.entries(active.dataset || {}).filter(([key]) => key !== 'action')),
      start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    } : null;
    const page = Number.isFinite(globalThis.window?.scrollX) && Number.isFinite(globalThis.window?.scrollY)
      ? { left: globalThis.window.scrollX, top: globalThis.window.scrollY }
      : null;
    return { scroll, identity, page };
  }

  restoreCreatorViewState(viewState) {
    if (!viewState || !this.creatorRoot?.querySelector) return;
    viewState.scroll.forEach(({ selector, top, left }) => {
      const node = this.creatorRoot.querySelector(selector);
      if (!node) return;
      node.scrollTop = top;
      node.scrollLeft = left;
    });
    if (viewState.page && typeof globalThis.window?.scrollTo === 'function') {
      globalThis.window.scrollTo(viewState.page.left, viewState.page.top);
    }
    const identity = viewState.identity;
    if (!identity) return;
    const escapeAttribute = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    let selector = identity.id ? `#${escapeAttribute(identity.id)}` : identity.action ? `[data-action="${escapeAttribute(identity.action)}"]` : '';
    if (!identity.id && selector) Object.entries(identity.dataset).forEach(([key, value]) => {
      const attribute = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      selector += `[data-${attribute}="${escapeAttribute(value)}"]`;
    });
    const replacement = selector ? this.creatorRoot.querySelector(selector) : null;
    if (!replacement) return;
    replacement.focus?.({ preventScroll: true });
    if (identity.start !== null && typeof replacement.setSelectionRange === 'function') {
      replacement.setSelectionRange(identity.start, identity.end ?? identity.start);
    }
  }

  creatorTabLabel(tab = this.creatorTab, issueCount = 0) {
    return {
      structure: this.tr('partsItems'),
      info: this.tr('makerInfo'),
      layers: this.tr('layerTracks'),
      colors: this.tr('smartColor'),
      rules: this.tr('rules'),
      expansions: this.tr('expansionPacks'),
      soul: this.tr('soulConfig'),
      validate: this.tr(issueCount ? 'preflightCount' : 'preflightReady', { count: issueCount }),
    }[tab] || this.tr('partsItems');
  }

  beginNextVersion() {
    if (!this.store) return false;
    const before = this.store.getState().document.version.versionId;
    this.executeDocument('Start next Maker version', () => {});
    return this.store.getState().document.version.versionId !== before;
  }

  updateMakerSettings(settings = {}) {
    if (!this.store) return;
    const current = this.store.getState().document;
    const nextComparable = {
      name: settings.name ?? current.metadata.name,
      summary: settings.summary ?? current.metadata.summary,
      creator: settings.creator ?? current.metadata.creator,
      style: settings.style ?? current.metadata.style,
      licenseKind: settings.licenseKind ?? current.metadata.license.kind,
      licenseNote: settings.licenseNote ?? current.metadata.license.note,
      royaltyBps: settings.royaltyBps ?? current.publication.royaltyBps,
      mintingEnabled: settings.mintingEnabled ?? current.publication.mintingEnabled,
      mintFeeEnabled: settings.mintFeeEnabled ?? current.publication.mintFeeEnabled,
      mintPriceAtomic: settings.mintPriceAtomic ?? current.publication.mintPriceAtomic,
      paymentCoinType: settings.paymentCoinType ?? current.publication.paymentCoinType,
      paymentCoinSymbol: settings.paymentCoinSymbol ?? current.publication.paymentCoinSymbol,
    };
    const currentComparable = {
      name: current.metadata.name,
      summary: current.metadata.summary,
      creator: current.metadata.creator,
      style: current.metadata.style,
      licenseKind: current.metadata.license.kind,
      licenseNote: current.metadata.license.note,
      royaltyBps: current.publication.royaltyBps,
      mintingEnabled: current.publication.mintingEnabled,
      mintFeeEnabled: current.publication.mintFeeEnabled,
      mintPriceAtomic: current.publication.mintPriceAtomic,
      paymentCoinType: current.publication.paymentCoinType,
      paymentCoinSymbol: current.publication.paymentCoinSymbol,
    };
    const makerIdentityChanged = ['name', 'summary', 'creator', 'style']
      .some((key) => String(nextComparable[key]) !== String(currentComparable[key]));
    if (JSON.stringify(nextComparable) === JSON.stringify(currentComparable)
      && settings.livingContent === undefined) return;
    this.executeDocument('Update Maker settings', ({ document }) => {
      Object.assign(document.metadata, {
        name: String(nextComparable.name),
        summary: String(nextComparable.summary),
        creator: String(nextComparable.creator),
        style: String(nextComparable.style),
      });
      document.metadata.license = {
        kind: String(nextComparable.licenseKind),
        note: String(nextComparable.licenseNote),
      };
      Object.assign(document.publication, {
        royaltyBps: Number(nextComparable.royaltyBps || 0),
        mintingEnabled: Boolean(nextComparable.mintingEnabled),
        mintFeeEnabled: Boolean(nextComparable.mintFeeEnabled),
        mintPriceAtomic: Number(nextComparable.mintPriceAtomic || 0),
        paymentCoinType: String(nextComparable.paymentCoinType || ''),
        paymentCoinSymbol: String(nextComparable.paymentCoinSymbol || ''),
      });
      if (settings.livingContent !== undefined) {
        document.livingContent = clone(settings.livingContent);
      } else if (makerIdentityChanged) {
        let content = validateSoulConfig(document.livingContent, document).content;
        SOUL_CONFIG_DOCUMENTS.forEach(({ key }) => {
          if (!content.customized[key]) content = resetSoulConfig(content, key, document);
        });
        document.livingContent = content;
      }
    });
  }

  playerBackgroundPartIds(document = this.runtimeDocument()) {
    const explicit = document?.extensions?.playerExport?.backgroundPartIds;
    if (Array.isArray(explicit)) {
      return new Set(explicit.map((partId) => String(partId || '')).filter(Boolean));
    }
    const conventionalNames = new Set([
      'background',
      'backdrop',
      'scene',
      'bg',
      '背景',
      '背景图',
      '场景',
      '背景画',
      '배경',
      '장면',
      'phông nền',
      'cảnh',
    ]);
    return new Set((document?.parts || []).filter((part) => {
      const id = String(part.id || '').trim().toLowerCase();
      const name = String(part.name || '').trim().toLowerCase();
      return conventionalNames.has(id)
        || conventionalNames.has(name)
        || /(^|[-_\s])(background|backdrop|scene|bg)([-_\s]|$)/i.test(id);
    }).map((part) => part.id));
  }

  async renderRecipeToBlob(recipe = this.playerRecipe, {
    type = 'image/png',
    quality,
    document: documentOverride = null,
    sizeMode = 'original',
    transparentBackground = false,
    signal = null,
  } = {}) {
    const document = documentOverride || this.runtimeDocument();
    if (!document) throw new Error(this.tr('noMakerLoaded'));
    signal?.throwIfAborted?.();
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas) throw new Error(this.tr('canvasExportBrowserOnly'));
    const scene = resolveMakerScene(document, recipe, { strict: true });
    if (transparentBackground) {
      const backgroundPartIds = this.playerBackgroundPartIds(document);
      scene.background = null;
      scene.layers = scene.layers.filter((layer) => !backgroundPartIds.has(layer.partId));
    }
    const dimensions = calculatePlayerExportSize(document.canvas, { mode: sizeMode });
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext?.('2d');
    if (!context) throw new Error(this.tr('canvasExportBrowserOnly'));
    context.scale(dimensions.width / scene.width, dimensions.height / scene.height);
    scene.layers.forEach((layer) => this.ensureAssetAlias(layer.assetId));
    await renderResolvedScene(scene, context, {
      resize: false,
      skipMissingAssets: false,
      resolveAsset: (assetId) => this.assetResolver.resolve(assetId),
      applyColorChannel: this.applyColorChannel,
      signal,
    });
    signal?.throwIfAborted?.();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (signal?.aborted) {
          reject(signal.reason || new DOMException('The render was aborted.', 'AbortError'));
          return;
        }
        if (blob) resolve(blob);
        else reject(new Error(this.tr('recipeExportFailed')));
      }, type, quality);
    });
  }

  playerExternalLinks(document = this.runtimeDocument()) {
    const raw = this.callbacks.getPlayerExternalLinks?.({
      document,
      makerKey: this.makerKey,
      context: this.context,
    }) || {};
    const result = {
      creatorUrl: safeExternalLinkUrl(raw.creatorUrl),
      communityUrl: safeExternalLinkUrl(raw.communityUrl),
    };
    try {
      result.shareUrl = raw.shareUrl
        ? safeExternalLinkUrl(raw.shareUrl)
        : buildPlayerShareUrl({
            baseUrl: raw.baseUrl,
            makerId: raw.makerId,
          });
    } catch {
      result.shareUrl = '';
    }
    return result;
  }

  createPlayerExportSnapshot(document = this.runtimeDocument()) {
    if (!document) return null;
    return deepFreeze({
      document: clone(document),
      recipe: clone(recipeWithColors(document, this.playerRecipe)),
      profile: clone(this.playerProfile),
      livingContent: clone(this.resolvedPlayerLivingContent(document)?.content || null),
      createdAt: new Date().toISOString(),
    });
  }

  revokePlayerExportPreview() {
    if (this.playerExportPreviewUrl) URL.revokeObjectURL?.(this.playerExportPreviewUrl);
    this.playerExportPreviewUrl = '';
    this.playerExportPreviewBlob = null;
  }

  resetPlayerExport({ preservePreferences = false } = {}) {
    this.playerExportRequestId += 1;
    this.playerExportAbortController?.abort?.();
    this.playerExportAbortController = null;
    this.revokePlayerExportPreview();
    this.playerExportOpen = false;
    this.playerExportIntent = 'download';
    if (!preservePreferences) {
      this.playerExportSizeMode = 'standard';
      this.playerExportTransparent = false;
    }
    this.playerExportState = 'idle';
    this.playerExportError = '';
    this.playerExportDimensions = null;
    this.playerExportSnapshot = null;
    this.playerShareState = 'idle';
  }

  openPlayerExport(intent = 'download') {
    const document = this.runtimeDocument();
    if (!document) return;
    this.resetPlayerExport({ preservePreferences: true });
    this.playerExportOpen = true;
    this.playerExportIntent = intent === 'complete' ? 'complete' : 'download';
    this.playerExportSnapshot = this.createPlayerExportSnapshot(document);
    if (
      this.playerExportSizeMode === 'original'
      && !isPlayerOriginalExportSafe(this.playerExportSnapshot.document.canvas)
    ) {
      this.playerExportSizeMode = 'standard';
    }
    this.playerExportState = 'rendering';
    this.playerIntroOpen = false;
    this.render();
    this.focusPlayerExportDialog();
    void this.preparePlayerExportPreview();
  }

  closePlayerExport() {
    if (!this.playerExportOpen) return;
    const returnAction = this.playerExportIntent === 'complete'
      ? 'player-complete'
      : 'player-preview-export';
    this.resetPlayerExport({ preservePreferences: true });
    this.render();
    requestAnimationFrame(() => {
      this.playerRoot?.querySelector(`[data-action="${returnAction}"]`)?.focus?.({ preventScroll: true });
    });
  }

  async preparePlayerExportPreview({ focusSelector = '' } = {}) {
    const snapshot = this.playerExportSnapshot;
    if (!this.playerExportOpen || !snapshot) return;
    const requestId = ++this.playerExportRequestId;
    this.playerExportAbortController?.abort?.();
    const abortController = new AbortController();
    this.playerExportAbortController = abortController;
    this.revokePlayerExportPreview();
    this.playerExportState = 'rendering';
    this.playerExportError = '';
    this.playerExportDimensions = calculatePlayerExportSize(snapshot.document.canvas, {
      mode: this.playerExportSizeMode,
    });
    this.render();
    this.focusPlayerExportDialog(focusSelector || '#makerPlayerExportDialog');
    try {
      const blob = await this.renderRecipeToBlob(snapshot.recipe, {
        document: snapshot.document,
        sizeMode: this.playerExportSizeMode,
        transparentBackground: this.playerExportTransparent,
        signal: abortController.signal,
      });
      if (!this.playerExportOpen || requestId !== this.playerExportRequestId) return;
      this.playerExportPreviewBlob = blob;
      this.playerExportPreviewUrl = URL.createObjectURL(blob);
      this.playerExportState = 'ready';
      this.playerExportError = '';
    } catch (error) {
      if (!this.playerExportOpen || requestId !== this.playerExportRequestId) return;
      this.playerExportState = 'error';
      // Renderer diagnostics can contain low-level English asset details.
      // Keep the Player-facing message localized and fail closed.
      this.playerExportError = this.tr('previewRenderFailed');
    }
    if (this.playerExportAbortController === abortController) {
      this.playerExportAbortController = null;
    }
    this.render();
    this.focusPlayerExportDialog(focusSelector || '#makerPlayerExportDialog');
  }

  downloadPlayerExport() {
    if (!this.playerExportPreviewBlob || !this.playerExportPreviewUrl || !this.playerExportSnapshot) return;
    const link = globalThis.document?.createElement?.('a');
    if (!link) return;
    link.href = this.playerExportPreviewUrl;
    link.download = safePngFilename(
      this.playerExportSnapshot.profile?.name || this.tr('untitledOc'),
    );
    link.click();
  }

  exportPlayerRecipe(snapshot = this.playerExportSnapshot) {
    const document = snapshot?.document || this.runtimeDocument();
    if (!document) return;
    const livingContent = snapshot
      ? snapshot.livingContent
      : this.resolvedPlayerLivingContent(document)?.content || null;
    const profile = snapshot?.profile || this.playerProfile;
    const payload = {
      schemaVersion: 'animacraft.player-recipe.v5',
      makerVersionId: document.version.versionId,
      recipe: snapshot?.recipe || this.playerRecipe,
      profile,
      livingContent,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = globalThis.document?.createElement?.('a');
    if (link) {
      link.href = url;
      link.download = `${safeFileName(profile.name, 'oc')}-recipe.json`;
      link.click();
    }
    URL.revokeObjectURL(url);
    this.callbacks.onExportRecipe?.(payload);
  }

  async copyTextToClipboard(value) {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(value);
      return;
    }
    const textarea = globalThis.document?.createElement?.('textarea');
    if (!textarea || !globalThis.document?.body) throw new Error('Clipboard unavailable');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    globalThis.document.body.append(textarea);
    textarea.select();
    const copied = globalThis.document.execCommand?.('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard unavailable');
  }

  async sharePlayerMaker({ native = false } = {}) {
    const document = this.playerExportSnapshot?.document || this.runtimeDocument();
    const shareUrl = this.playerExternalLinks(document).shareUrl;
    if (!shareUrl) {
      this.playerShareState = 'unavailable';
      this.render();
      this.focusPlayerExportDialog('[data-action="player-copy-maker-link"]');
      return;
    }
    try {
      if (native && typeof globalThis.navigator?.share === 'function') {
        await globalThis.navigator.share({
          title: document.metadata.name,
          text: this.tr('shareMakerText', { maker: document.metadata.name }),
          url: shareUrl,
        });
        this.playerShareState = 'shared';
      } else {
        await this.copyTextToClipboard(shareUrl);
        this.playerShareState = 'copied';
      }
    } catch (error) {
      this.playerShareState = error?.name === 'AbortError' ? 'idle' : 'error';
    }
    this.render();
    this.focusPlayerExportDialog(
      native ? '[data-action="player-share-maker"]' : '[data-action="player-copy-maker-link"]',
    );
  }

  completePlayerExport() {
    const snapshot = this.playerExportSnapshot;
    const imageBlob = this.playerExportPreviewBlob;
    if (!snapshot || this.playerExportState !== 'ready' || !imageBlob?.size) return;
    const creatorPreview = this.playerCreatorPreview;
    const issues = this.playerCompletionIssues(snapshot.document, snapshot.recipe, {
      profile: snapshot.profile,
      livingContent: snapshot.livingContent,
    });
    if (issues.length) {
      this.callbacks.onPlayerError?.(new Error(issues[0]));
      return;
    }
    const imageExport = deepFreeze({
      sizeMode: this.playerExportSizeMode,
      transparentBackground: this.playerExportTransparent,
      width: this.playerExportDimensions?.width || snapshot.document.canvas.width,
      height: this.playerExportDimensions?.height || snapshot.document.canvas.height,
      mediaType: 'image/png',
    });
    this.resetPlayerExport({ preservePreferences: true });
    this.playerPublishOpen = !creatorPreview;
    this.playerPublishCloseConfirm = false;
    this.callbacks.onCompleteOc?.({
      document: snapshot.document,
      recipe: snapshot.recipe,
      profile: snapshot.profile,
      livingContent: snapshot.livingContent,
      imageBlob,
      imageExport,
      assets: this.assets,
    });
    this.render();
    if (!creatorPreview) this.focusPlayerPublishDialog();
  }

  renderCreator() {
    if (!this.creatorRoot || !this.store) return;
    const viewState = this.captureCreatorViewState();
    const state = this.store.getState();
    const document = state.document;
    this.ensureCreatorSelection(document);
    const { part, item, style } = this.selectedCreatorRecords(document);
    const issues = this.publicationIssues(document);
    const previewAssetCount = document.parts.reduce((count, candidatePart) => count + candidatePart.items.reduce((itemCount, candidateItem) => (
      itemCount + candidateItem.styles.filter((candidateStyle) => {
        const descriptor = document.assets.find((asset) => asset.id === candidateStyle.assetId);
        return Boolean(candidateStyle.assetId && (this.runtimeAsset(candidateStyle.assetId) || descriptor?.url || descriptor?.legacy?.url));
      }).length
    ), 0), 0);
    let visiblePreviewLayerCount = 0;
    try {
      const previewScene = resolveMakerScene(document, this.creatorRecipe || state.recipe, { strict: false });
      visiblePreviewLayerCount = previewScene.layers.filter((layer) => {
        if (this.creatorHiddenPartIds.has(layer.partId)) return false;
        if (this.hiddenStyleKeys.has(styleSceneKey(layer.partId, layer.itemId, layer.styleId))) return false;
        const descriptor = document.assets.find((asset) => asset.id === layer.assetId);
        return Boolean(layer.assetId && (this.runtimeAsset(layer.assetId) || descriptor?.url || descriptor?.legacy?.url));
      }).length;
    } catch {
      visiblePreviewLayerCount = 0;
    }
    const canComparePreviewLayers = Boolean(style && visiblePreviewLayerCount >= 2);
    if (!canComparePreviewLayers && this.creatorPreviewMode !== 'all') this.creatorPreviewMode = 'all';
    const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
    const compatibility = this.compatibilityReport(document);
    const lifecycle = this.context?.lifecycle || {};
    const lifecycleLabel = String(lifecycle.label || this.tr('publishMainnet'));
    const lifecycleManageLabel = String(lifecycle.manageLabel || lifecycleLabel);
    const lifecycleBadgeClass = String(lifecycle.badgeClass || '');
    const partRows = document.parts.map((candidate, index) => {
      const linkage = partTrackLinkage(document, candidate.id);
      const linkedTrack = linkage.mode === 'linked'
        ? document.layerTracks.find((track) => track.id === linkage.trackId)
        : null;
      const linkLabel = linkage.mode === 'linked'
        ? this.tr('partLinkedTrack', { track: linkedTrack?.name || linkage.trackId })
        : linkage.mode === 'unassigned'
          ? this.tr('partTrackUnassigned')
          : this.tr('partCustomStacking', { count: linkage.trackIds.length });
      const previousIndex = index - 1;
      const nextIndex = index + 1;
      const previousBlocked = previousIndex < 0
        || partMoveCrossesLockedLinkedTrack(document, index, previousIndex);
      const nextBlocked = nextIndex >= document.parts.length
        || partMoveCrossesLockedLinkedTrack(document, index, nextIndex);
      return `
        <div class="v4-part-row ${candidate.id === part?.id ? 'active' : ''} ${this.creatorHiddenPartIds.has(candidate.id) ? 'preview-hidden' : ''} ${linkage.mode === 'linked' ? 'linked-track' : 'custom-track'}" draggable="true" data-drag-kind="part" data-drag-id="${escapeHtml(candidate.id)}">
          <span class="v4-part-drag" aria-hidden="true">⋮⋮<b>${String(index + 1).padStart(2, '0')}</b></span>
          <button class="v4-part-select" type="button" data-action="select-part" data-part-id="${escapeHtml(candidate.id)}">
            <span class="v4-part-icon">${candidate.iconAssetId && this.runtimeAsset(candidate.iconAssetId)?.url ? `<img src="${escapeHtml(this.runtimeAsset(candidate.iconAssetId).url)}" alt="" />` : escapeHtml(candidate.name.slice(0, 2).toUpperCase())}</span>
            <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(this.tr('partStatus', { items: candidate.items.length, styles: candidate.items.reduce((count, candidateItem) => count + candidateItem.styles.length, 0) }))}</small><small class="v4-part-track-status">${escapeHtml(linkLabel)}</small></span>
            <em>${candidate.required ? this.tr('required') : this.tr('optional')}</em>
          </button>
          <div class="v4-part-order-actions">
            <button type="button" data-action="move-part" data-part-id="${escapeHtml(candidate.id)}" data-direction="up" aria-label="${escapeHtml(this.tr('movePartUp'))}" title="${escapeHtml(this.tr('movePartUp'))}" ${previousBlocked ? 'disabled' : ''}>↑</button>
            <button type="button" data-action="move-part" data-part-id="${escapeHtml(candidate.id)}" data-direction="down" aria-label="${escapeHtml(this.tr('movePartDown'))}" title="${escapeHtml(this.tr('movePartDown'))}" ${nextBlocked ? 'disabled' : ''}>↓</button>
          </div>
          <button class="v4-part-eye ${this.creatorHiddenPartIds.has(candidate.id) ? '' : 'active'}" type="button" data-action="toggle-part-preview" data-part-id="${escapeHtml(candidate.id)}" aria-pressed="${!this.creatorHiddenPartIds.has(candidate.id)}" aria-label="${escapeHtml(this.tr(this.creatorHiddenPartIds.has(candidate.id) ? 'showPartPreview' : 'hidePartPreview'))}" title="${escapeHtml(this.tr(this.creatorHiddenPartIds.has(candidate.id) ? 'showPartPreview' : 'hidePartPreview'))}">${this.creatorHiddenPartIds.has(candidate.id) ? '◎' : '◉'}</button>
        </div>
      `;
    }).join('');
    const itemRows = part?.items.map((candidate) => {
      const thumbnail = this.itemThumbnailUrl(candidate);
      return `
        <button class="v4-item-card ${candidate.id === item?.id ? 'active' : ''}" type="button" draggable="true" data-drag-kind="item" data-parent-id="${escapeHtml(part.id)}" data-drag-id="${escapeHtml(candidate.id)}" data-action="select-item" data-item-id="${escapeHtml(candidate.id)}">
          <span class="v4-item-thumb">${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" />` : '<i>PNG</i>'}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${escapeHtml(this.tr('styleCount', { count: candidate.styles.length }))}</small>
        </button>
      `;
    }).join('') || `<div class="v4-inline-empty"><strong>${escapeHtml(this.tr('noItemsYet'))}</strong><span>${escapeHtml(this.tr('noItemsCopy'))}</span></div>`;
    const styleRows = item?.styles.map((candidate) => {
      const runtime = this.runtimeAsset(candidate.assetId);
      const key = styleSceneKey(part.id, item.id, candidate.id);
      return `
        <button class="v4-style-chip ${candidate.id === style?.id ? 'active' : ''} ${this.hiddenStyleKeys.has(key) ? 'muted' : ''}" type="button" draggable="${candidate.styleLocked ? 'false' : 'true'}" data-drag-kind="style" data-parent-id="${escapeHtml(`${part.id}/${item.id}`)}" data-drag-id="${escapeHtml(candidate.id)}" data-action="select-style" data-style-id="${escapeHtml(candidate.id)}">
          <span class="v4-style-chip-thumb">${runtime?.thumbnailUrl || runtime?.url ? `<img src="${escapeHtml(runtime.thumbnailUrl || runtime.url)}" alt="" />` : '<i>PNG</i>'}</span>
          <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.id === item.defaultStyleId ? this.tr('defaultStyle') : this.tr('style'))}</small></span>
          ${candidate.styleLocked ? '<em>🔒</em>' : candidate.positionLocked ? '<em>⌖</em>' : ''}
        </button>
      `;
    }).join('') || `<span class="v4-style-empty">${escapeHtml(this.tr('noStylesYet'))}</span>`;

    this.creatorRoot.innerHTML = `
      <section class="v4-studio-shell">
        <header class="v4-studio-topbar">
          <div class="v4-studio-title">
            <span class="v4-eyebrow">${escapeHtml(this.tr('studio'))}</span>
            <div><h2>${escapeHtml(document.metadata.name)}</h2><span class="v4-version-badge">${escapeHtml(document.version.versionId)} · ${document.canvas.width}×${document.canvas.height}</span></div>
          </div>
          <div class="v4-save-indicator ${escapeHtml(state.saveState)}"><i></i><span>${escapeHtml(this.saveStateText(state))}</span></div>
          <div class="v4-top-actions">
            <button type="button" class="maker-lifecycle-badge ${escapeHtml(lifecycleBadgeClass)}" data-action="manage-lifecycle" aria-label="${escapeHtml(lifecycleManageLabel)}">${escapeHtml(lifecycleLabel)}</button>
            <button type="button" data-action="back-library">${escapeHtml(this.tr('backToLibrary'))}</button>
            <button type="button" data-action="undo" ${state.canUndo ? '' : 'disabled'} title="${escapeHtml(state.canUndo ? this.tr('undoHint') : this.tr('undoUnavailable'))}">↶ ${escapeHtml(this.tr('undo'))}</button>
            <button type="button" data-action="redo" ${state.canRedo ? '' : 'disabled'} title="${escapeHtml(state.canRedo ? this.tr('redoHint') : this.tr('redoUnavailable'))}">↷ ${escapeHtml(this.tr('redo'))}</button>
            <button type="button" data-action="save" title="${escapeHtml(this.tr('saveHint'))}">${escapeHtml(this.tr(state.saveState === 'saving' ? 'saving' : 'save'))}</button>
            <button type="button" data-action="open-version-history">${escapeHtml(this.tr('versionHistory'))}</button>
            <button type="button" data-action="export-project">${escapeHtml(this.tr('projectZip'))}</button>
            <label class="v4-file-button compact">${escapeHtml(this.tr('importZip'))}<input type="file" accept=".zip,application/zip" data-action="import-project" /></label>
            <button type="button" data-action="open-player" title="${escapeHtml(this.tr(previewAssetCount ? 'playerTestHint' : 'playerTestBlocked'))}">▶ ${escapeHtml(this.tr('playerTest'))}</button>
            <button class="primary" type="button" data-action="publish">${escapeHtml(blockingIssues.length ? this.tr(blockingIssues.length === 1 ? 'reviewIssue' : 'reviewIssues', { count: blockingIssues.length }) : this.tr('publishMainnet'))}</button>
          </div>
        </header>
        ${this.documentMutationBlocked() ? `<div class="v4-version-history-notice" role="status" aria-live="polite">${escapeHtml(this.documentMutationBlockedMessage())}</div>` : ''}

        <nav class="v4-studio-tabs" aria-label="${escapeHtml(this.tr('makerToolsLabel'))}" role="tablist">
          ${[
            ['structure', this.tr('partsItems')],
            ['info', this.tr('makerInfo')],
            ['layers', this.tr('layerTracks')],
            ['colors', this.tr('smartColor')],
            ['rules', this.tr('rules')],
            ['expansions', this.tr('expansionPacks')],
            ['soul', this.tr('soulConfig')],
            ['validate', this.tr(issues.length ? 'preflightCount' : 'preflightReady', { count: issues.length })],
          ].map(([id, label]) => `<button type="button" id="makerV4Tab-${id}" class="${this.creatorTab === id ? 'active' : ''}" data-action="creator-tab" data-tab="${id}" role="tab" aria-selected="${this.creatorTab === id}" aria-controls="${id === 'structure' ? 'makerV4ToolPanel' : 'makerV4ToolDialog'}" tabindex="${this.creatorTab === id ? '0' : '-1'}">${escapeHtml(label)}</button>`).join('')}
        </nav>

        <div id="makerV4ToolPanel" class="v4-studio-workspace" role="tabpanel" aria-labelledby="makerV4Tab-structure">
          <aside class="v4-parts-browser">
            <div class="v4-panel-head"><div><span>${escapeHtml(this.tr('parts'))}</span><strong>${escapeHtml(this.tr('playerMenuLinkedOrder'))}</strong><small>${escapeHtml(this.tr('playerMenuLinkedOrderCopy'))}</small></div><button type="button" data-action="add-part" aria-label="${escapeHtml(this.tr('addPartAria'))}">＋</button></div>
            <div class="v4-parts-list">${partRows || `<div class="v4-inline-empty"><span>${escapeHtml(this.tr('createFirstPart'))}</span></div>`}</div>
            ${part ? `<div class="v4-part-actions"><button type="button" data-action="copy-part">${escapeHtml(this.tr('duplicate'))}</button><button type="button" data-action="delete-part" class="danger" ${partContainsLockedStyle(part) ? 'disabled' : ''}>${escapeHtml(this.tr('delete'))}</button></div>` : ''}
          </aside>

          <main class="v4-canvas-column">
            <div class="v4-canvas-toolbar">
              <div><strong>${escapeHtml(this.tr('runtimePreview'))}</strong><span id="v4CreatorRenderStatus">${escapeHtml(this.tr('runtimePreviewCopy'))}</span></div>
              <div class="v4-canvas-tools">
                <div class="v4-preview-mode" role="group" aria-label="${escapeHtml(this.tr('previewModeLabel'))}">
                  <button type="button" class="${this.creatorPreviewMode === 'all' ? 'active' : ''}" data-action="set-preview-mode" data-preview-mode="all" aria-pressed="${this.creatorPreviewMode === 'all'}">${escapeHtml(this.tr('previewShowAll'))}</button>
                  <button type="button" class="${this.creatorPreviewMode === 'dim' ? 'active' : ''}" data-action="set-preview-mode" data-preview-mode="dim" aria-pressed="${this.creatorPreviewMode === 'dim'}" ${canComparePreviewLayers ? '' : 'disabled'}>${escapeHtml(this.tr('previewDimOthers'))}</button>
                  <button type="button" class="${this.creatorPreviewMode === 'solo' ? 'active' : ''}" data-action="set-preview-mode" data-preview-mode="solo" aria-pressed="${this.creatorPreviewMode === 'solo'}" ${canComparePreviewLayers ? '' : 'disabled'}>${escapeHtml(this.tr('previewSoloCurrent'))}</button>
                </div>
                <button type="button" data-action="show-all-parts">${escapeHtml(this.tr('showAllParts'))}</button>
                <button type="button" data-action="show-current-part" ${part ? '' : 'disabled'}>${escapeHtml(this.tr('showCurrentPart'))}</button>
                <label>${escapeHtml(this.tr('zoom'))} <input type="range" min="50" max="200" step="10" value="${Math.round(this.creatorZoom * 100)}" data-action="canvas-zoom" /></label>
                <button type="button" class="${document.canvas.pixelMode === 'pixelated' ? 'active' : ''}" data-action="toggle-pixel" aria-pressed="${document.canvas.pixelMode === 'pixelated'}">${escapeHtml(this.tr('pixelMode'))}</button>
              </div>
            </div>
            <div class="v4-canvas-viewport ${document.canvas.pixelMode === 'pixelated' ? 'pixelated' : ''}">
              <div class="v4-canvas-ruler"><span>0,0</span><span>${document.canvas.width},${document.canvas.height}</span></div>
              <canvas id="makerV4CreatorCanvas" class="v4-runtime-canvas ${style && !style.positionLocked && !style.styleLocked && this.editingPositionStyleKey === styleSceneKey(part.id, item.id, style.id) ? 'position-editing' : ''}" style="width:${Math.round(this.creatorZoom * 100)}%" tabindex="0" aria-label="${escapeHtml(this.tr('makerCanvasLabel'))}"></canvas>
              ${!style?.assetId ? `<div class="v4-canvas-empty"><strong>${escapeHtml(this.tr('selectVisualStyle'))}</strong><span>${escapeHtml(this.tr('selectVisualStyleCopy'))}</span></div>` : ''}
            </div>
            <div class="v4-items-dock">
              <div class="v4-panel-head">
                <div><span>${escapeHtml(this.tr('items'))}</span><strong>${escapeHtml(part?.name || this.tr('selectPart'))}</strong></div>
                <div>
                  <button type="button" data-action="add-item" ${part ? '' : 'disabled'}>${escapeHtml(this.tr('addItem'))}</button>
                  <label class="v4-file-button ${item ? '' : 'disabled'}">${escapeHtml(this.tr('batchImport'))}<input type="file" accept="image/png" multiple data-action="batch-import" ${item ? '' : 'disabled'} /></label>
                  <label class="v4-file-button">${escapeHtml(this.tr('importMatrixFolder'))}<input type="file" accept="image/png" multiple webkitdirectory directory data-action="project-import" /></label>
                </div>
              </div>
              <div class="v4-item-grid">${itemRows}</div>
              ${item ? `<div class="v4-style-row"><span>${escapeHtml(this.tr('styles'))}</span>${styleRows}<button type="button" data-action="add-style">${escapeHtml(this.tr('addStyle'))}</button></div>` : ''}
            </div>
          </main>

          <aside class="v4-inspector">
            <div class="v4-panel-head v4-inspector-context"><div><span>${escapeHtml(this.tr('currentStyle'))}</span><strong>${escapeHtml([part?.name || '—', item?.name || '—', style?.name || '—'].join(' › '))}</strong></div></div>
            ${this.renderCreatorInspector(document, part, item, style)}
          </aside>
        </div>
        ${this.creatorTab !== 'structure' ? `<div class="v4-tool-modal-backdrop" data-action="close-tool-backdrop">
          <section id="makerV4ToolDialog" class="v4-advanced-panel primary-tool" role="dialog" aria-modal="true" aria-labelledby="makerV4ToolTitle" tabindex="-1">
            <header class="v4-tool-context"><div><span>${escapeHtml(this.creatorTabLabel(this.creatorTab, issues.length))}</span><strong id="makerV4ToolTitle">${escapeHtml(document.metadata.name)}</strong></div><button type="button" data-action="close-tool" aria-label="${escapeHtml(this.tr('close'))}">×</button></header>
            ${this.renderCreatorAdvanced(document, issues, compatibility)}
          </section>
        </div>` : ''}
        ${this.renderCreatorPublishFlow()}
      </section>
      ${this.renderWorkspaceRestoreGuard()}
      ${this.renderVersionHistory()}
      ${this.renderImportDialog(document)}
    `;
    this.restoreCreatorViewState(viewState);
  }

  renderWorkspaceRestoreGuard() {
    if (!this.restoreInProgress && !this.restoreError) return '';
    const recoveryAvailable = Boolean(this.restoreError && this.emergencyRecoverySnapshot());
    return `
      <div class="v4-modal-backdrop v4-workspace-restore-backdrop">
        <section class="v4-workspace-restore-dialog" role="status" aria-live="polite">
          ${this.restoreInProgress ? `
            <i></i>
            <strong>${escapeHtml(this.tr('workspaceRestoring'))}</strong>
            <span>${escapeHtml(this.tr('workspaceRestoringCopy'))}</span>
          ` : `
            <strong>${escapeHtml(this.tr('restoreFailed'))}</strong>
            <span>${escapeHtml(this.tr('workspaceRestoreBlocked'))}</span>
            <small>${escapeHtml(this.restoreError)}</small>
            <div>
              <button type="button" data-action="back-library">${escapeHtml(this.tr('backToLibrary'))}</button>
              ${recoveryAvailable ? `<button type="button" data-action="export-emergency-recovery">${escapeHtml(this.tr('workspaceRecoveryExport'))}</button>` : ''}
              <button type="button" class="primary" data-action="retry-workspace-restore">${escapeHtml(this.tr('workspaceRestoreRetry'))}</button>
            </div>
          `}
        </section>
      </div>
    `;
  }

  renderVersionHistory() {
    if (!this.versionHistoryOpen) return '';
    const persistedRevision = this.draftRepository.getStatus(this.makerKey).persistedRevision;
    const busy = this.versionHistoryStatus === 'loading' || this.versionHistoryStatus === 'restoring';
    const list = this.versionHistoryEntries.length ? `
      <ol class="v4-version-history-list">
        ${this.versionHistoryEntries.map((checkpoint) => {
          const revision = Number(checkpoint.revision);
          const name = checkpoint.document?.metadata?.name
            || checkpoint.metadata?.name
            || this.tr('versionHistoryUnknownName');
          const current = revision === persistedRevision;
          const restoring = this.restoringCheckpointRevision === revision;
          return `
            <li class="${current ? 'current' : ''}">
              <div>
                <strong>${escapeHtml(name)}</strong>
                <span>${escapeHtml(this.tr('versionHistoryRevision', { revision }))}</span>
                <time>${escapeHtml(this.formatCheckpointSavedAt(checkpoint.savedAt))}</time>
              </div>
              ${current
                ? `<em>${escapeHtml(this.tr('versionHistoryCurrent'))}</em>`
                : `<button type="button" data-action="restore-checkpoint" data-revision="${revision}" ${busy ? 'disabled' : ''}>${escapeHtml(this.tr(restoring ? 'versionHistoryRestoring' : 'versionHistoryRestore'))}</button>`}
            </li>
          `;
        }).join('')}
      </ol>
    ` : '';
    let content = list;
    if (this.versionHistoryStatus === 'loading') {
      content = `<div class="v4-version-history-state loading"><i></i><strong>${escapeHtml(this.tr('versionHistoryLoading'))}</strong><span>${escapeHtml(this.tr('versionHistoryLoadingCopy'))}</span></div>`;
    } else if (this.versionHistoryStatus === 'empty') {
      content = `<div class="v4-version-history-state"><strong>${escapeHtml(this.tr('versionHistoryEmpty'))}</strong><span>${escapeHtml(this.tr('versionHistoryEmptyCopy'))}</span></div>`;
    } else if (this.versionHistoryStatus === 'error') {
      content = `
        <div class="v4-version-history-state error">
          <strong>${escapeHtml(this.tr('versionHistoryFailed'))}</strong>
          <span>${escapeHtml(this.versionHistoryError || this.tr('versionHistoryRestoreFailed'))}</span>
          <button type="button" data-action="retry-version-history">${escapeHtml(this.tr('versionHistoryRetry'))}</button>
        </div>
        ${list}
      `;
    } else if (this.versionHistoryStatus === 'restoring') {
      content = `
        <div class="v4-version-history-notice">${escapeHtml(this.tr('versionHistoryRestoring'))}</div>
        ${list}
      `;
    } else if (this.versionHistoryMessage) {
      content = `
        <div class="v4-version-history-notice success">${escapeHtml(this.versionHistoryMessage)}</div>
        ${list}
      `;
    }
    return `
      <div class="v4-modal-backdrop v4-version-history-backdrop" data-action="close-version-history-backdrop">
        <section class="v4-version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="makerVersionHistoryTitle">
          <header>
            <div>
              <span class="v4-eyebrow">${escapeHtml(this.tr('versionHistory'))}</span>
              <h3 id="makerVersionHistoryTitle">${escapeHtml(this.tr('versionHistoryTitle'))}</h3>
              <p>${escapeHtml(this.tr('versionHistoryCopy'))}</p>
            </div>
            <button type="button" data-action="close-version-history" aria-label="${escapeHtml(this.tr('close'))}" ${this.versionHistoryStatus === 'restoring' ? 'disabled' : ''}>×</button>
          </header>
          <div class="v4-version-history-content">${content}</div>
        </section>
      </div>
    `;
  }

  publicationLocale() {
    return {
      en: 'en-US',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
      vi: 'vi-VN',
    }[this.locale] || 'en-US';
  }

  publicationAtomicAmount(value) {
    if (value == null || !String(value).trim()) return null;
    try {
      const atomic = BigInt(String(value));
      if (atomic < 0n) return null;
      const whole = atomic / 1_000_000_000n;
      const fraction = String(atomic % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
      return {
        atomic: new Intl.NumberFormat(this.publicationLocale()).format(atomic),
        token: fraction ? `${whole}.${fraction}` : String(whole),
      };
    } catch {
      return null;
    }
  }

  publicationQuoteTime(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    try {
      return {
        datetime: date.toISOString(),
        label: new Intl.DateTimeFormat(this.publicationLocale(), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(date),
      };
    } catch {
      return null;
    }
  }

  publicationQuote(state) {
    const nested = state.quote && typeof state.quote === 'object' ? state.quote : {};
    const storage = state.walrusStorageCostFrost
      ?? nested.walrusStorageCostFrost
      ?? nested.storageCostFrost
      ?? null;
    const write = state.walrusWriteCostFrost
      ?? nested.walrusWriteCostFrost
      ?? nested.writeCostFrost
      ?? null;
    let total = state.walrusTotalCostFrost
      ?? nested.walrusTotalCostFrost
      ?? nested.totalCostFrost
      ?? null;
    if (total == null && storage != null && write != null) {
      try {
        total = String(BigInt(String(storage)) + BigInt(String(write)));
      } catch {
        total = null;
      }
    }
    return {
      relayTipMist: state.relayTipMist ?? nested.relayTipMist ?? null,
      relayTipQuotedAt: state.relayTipQuotedAt ?? nested.relayTipQuotedAt ?? '',
      walrusStorageCostFrost: storage,
      walrusWriteCostFrost: write,
      walrusTotalCostFrost: total,
    };
  }

  renderPublicationQuote(state, prefix) {
    const quote = this.publicationQuote(state);
    const relay = this.publicationAtomicAmount(quote.relayTipMist);
    const quotedAt = this.publicationQuoteTime(quote.relayTipQuotedAt);
    const storage = this.publicationAtomicAmount(quote.walrusStorageCostFrost);
    const write = this.publicationAtomicAmount(quote.walrusWriteCostFrost);
    const total = this.publicationAtomicAmount(quote.walrusTotalCostFrost);
    if (!relay && !storage && !write && !total) return '';
    const unavailable = escapeHtml(this.tr('publishQuoteUnavailable'));
    const walrusValue = (amount) => amount
      ? `<strong>${escapeHtml(`${amount.atomic} FROST`)}</strong><small>${escapeHtml(`${amount.token} WAL`)}</small>`
      : `<strong>${unavailable}</strong>`;
    const quoteTitleId = `maker${prefix === 'creator' ? 'Creator' : 'Player'}PublishQuoteTitle`;
    return `
      <aside class="v4-chain-fee" aria-labelledby="${quoteTitleId}">
        <div class="v4-chain-fee-heading">
          <span id="${quoteTitleId}">${escapeHtml(this.tr('publishQuoteTitle'))}</span>
          <small>${escapeHtml(this.tr('publishQuoteCopy'))}</small>
          ${quotedAt ? `<time datetime="${escapeHtml(quotedAt.datetime)}">${escapeHtml(this.tr('publishQuoteAt', { time: quotedAt.label }))}</time>` : ''}
        </div>
        <dl>
          <div>
            <dt>${escapeHtml(this.tr('relayTipEstimate'))}</dt>
            <dd>
              ${relay
                ? `<strong>${escapeHtml(`${relay.atomic} MIST`)}</strong><small>${escapeHtml(`${relay.token} SUI`)}</small>`
                : `<strong>${unavailable}</strong>`}
            </dd>
          </div>
          <div>
            <dt>${escapeHtml(this.tr('walrusStorageEstimate'))}</dt>
            <dd>${walrusValue(storage)}</dd>
          </div>
          <div>
            <dt>${escapeHtml(this.tr('walrusWriteEstimate'))}</dt>
            <dd>${walrusValue(write)}</dd>
          </div>
          <div class="total">
            <dt>${escapeHtml(this.tr('walrusTotalEstimate'))}</dt>
            <dd>${walrusValue(total)}</dd>
          </div>
        </dl>
        ${relay ? `<p>${escapeHtml(this.tr('relayTipEstimateCopy', { mist: relay.atomic, sui: relay.token }))}</p>` : ''}
        <p class="v4-chain-fee-warning">${escapeHtml(this.tr('publishQuoteGasWarning'))}</p>
      </aside>
    `;
  }

  renderPublicationFlow(kind) {
    const creator = kind === 'creator';
    const open = creator ? this.creatorPublishOpen : this.playerPublishOpen;
    if (!open) return '';
    const state = creator ? this.creatorPublishState : this.playerPublishState;
    const actions = state.actions || {};
    const closeConfirm = creator
      ? this.creatorPublishCloseConfirm
      : this.playerPublishCloseConfirm;
    const copyState = creator
      ? this.creatorPublishCopyState
      : this.playerPublishCopyState;
    const prefix = creator ? 'creator' : 'player';
    const dialogId = creator ? 'makerCreatorPublishDialog' : 'makerPlayerPublishDialog';
    const titleId = creator ? 'makerCreatorPublishTitle' : 'makerPlayerPublishTitle';
    const copyId = creator ? 'makerCreatorPublishCopy' : 'makerPlayerPublishCopy';
    const confirmId = creator
      ? 'makerCreatorPublishCloseConfirm'
      : 'makerPlayerPublishCloseConfirm';
    const step = state.digest
      ? 4
      : ['certified', 'publish-pending'].includes(state.stage)
        ? 4
        : ['uploaded', 'certify-pending'].includes(state.stage)
          ? 3
          : ['encoded', 'register-pending', 'registered'].includes(state.stage)
            ? 2
            : 1;
    const steps = [
      this.tr(creator ? 'prepareQuilt' : 'prepareFiles'),
      this.tr('registerAndUpload'),
      this.tr('certifyWalrus'),
      this.tr(creator ? 'publishOnSui' : 'continueToSoulidity'),
    ];
    const stepItems = steps.map((label, index) => {
      const number = index + 1;
      const completed = Boolean(state.digest) || number < step;
      const current = !state.digest && number === step;
      const status = completed
        ? this.tr('publishStepCompleted')
        : current ? this.tr('publishStepCurrent') : this.tr('publishStepPending');
      return `
        <li class="${completed ? 'completed' : current ? 'current' : 'pending'}" ${current ? 'aria-current="step"' : ''}>
          <span>${number}</span>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(status)}</small>
        </li>
      `;
    }).join('');
    const errorKeys = {
      TIP_TOO_HIGH: ['publishErrorTipTitle', 'publishErrorTipCopy'],
      WALLET_REJECTED: ['publishErrorRejectedTitle', 'publishErrorRejectedCopy'],
      INSUFFICIENT_GAS: ['publishErrorGasTitle', 'publishErrorGasCopy'],
      INSUFFICIENT_WAL_BALANCE: ['publishErrorWalBalanceTitle', 'publishErrorWalBalanceCopy'],
      INSUFFICIENT_SUI_BALANCE: ['publishErrorSuiBalanceTitle', 'publishErrorSuiBalanceCopy'],
      NETWORK_UNAVAILABLE: ['publishErrorNetworkTitle', 'publishErrorNetworkCopy'],
      UPLOAD_QUOTE_CHANGED: ['publishErrorQuoteChangedTitle', 'publishErrorQuoteChangedCopy'],
      WALRUS_CERTIFICATION_NOT_VISIBLE: ['publishErrorCertificationSyncTitle', 'publishErrorCertificationSyncCopy'],
      TRANSACTION_OUTCOME_PENDING: ['publishErrorPendingTitle', 'publishErrorPendingCopy'],
      UPLOAD_RECOVERY_MISMATCH: ['publishErrorRecoveryMismatchTitle', 'publishErrorRecoveryMismatchCopy'],
    };
    const errorCopy = state.error
      ? errorKeys[state.error.code] || ['publishErrorTitle', 'publishErrorGeneric']
      : null;
    const certificationStateSyncing = state.error?.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE';
    const retryAction = String(state.error?.action || '');
    const retryAvailable = actions[retryAction]
      || (retryAction === 'onchain' && actions.publish);
    const canRetry = Boolean(
      !state.busy
      && retryAction
      && retryAction !== 'review'
      && state.error?.code !== 'TRANSACTION_OUTCOME_PENDING'
      && retryAvailable,
    );
    const canRecoverPending = Boolean(
      !state.busy
      && state.error?.code === 'TRANSACTION_OUTCOME_PENDING'
      && retryAction
      && retryAction !== 'review'
      && retryAvailable
    );
    const retryLabel = state.error?.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE'
      ? this.tr('recheckCertificationStatus')
      : state.error?.code === 'UPLOAD_QUOTE_CHANGED' && retryAction === 'prepare'
        ? this.tr('refreshUploadQuote')
        : retryAction === 'resume'
          ? this.tr('resumeUpload')
          : this.tr('retryReleaseStep');
    const copyLabel = copyState === 'copied'
      ? this.tr('errorDetailsCopied')
      : copyState === 'error'
        ? this.tr('errorDetailsCopyFailed')
        : this.tr('copyErrorDetails');
    const pendingResume = Boolean(
      !state.busy
      && state.error?.code === 'TRANSACTION_OUTCOME_PENDING'
      && actions.resume
      && !actions.review,
    );
    const errorPanel = state.error ? `
      <aside class="v4-chain-error${certificationStateSyncing ? ' is-syncing' : ''}" role="${certificationStateSyncing ? 'status' : 'alert'}" aria-live="${certificationStateSyncing ? 'polite' : 'assertive'}">
        <div>
          <span>${escapeHtml(state.error.code || 'CHAIN_ACTION_FAILED')}</span>
          <strong>${escapeHtml(this.tr(errorCopy[0]))}</strong>
        </div>
        <p>${escapeHtml(this.tr(errorCopy[1]))}</p>
        <details>
          <summary>${escapeHtml(this.tr('technicalDetails'))}</summary>
          <pre>${escapeHtml(state.error.diagnostic || state.error.details || '')}</pre>
        </details>
        <div class="v4-chain-error-actions">
          <button type="button" data-action="copy-${prefix}-publish-error">${escapeHtml(copyLabel)}</button>
          ${canRetry ? `<button class="primary" type="button" data-action="${prefix}-publish-retry" data-publish-action="${escapeHtml(retryAction)}">${escapeHtml(retryLabel)}</button>` : ''}
          ${canRecoverPending ? `<button class="primary" type="button" data-action="${prefix}-publish-recover" data-publish-action="${escapeHtml(retryAction)}">${escapeHtml(this.tr('recoverPendingRelease'))}</button>` : ''}
          ${pendingResume ? `<button class="primary" type="button" data-action="${prefix}-publish-resume">${escapeHtml(this.tr('resumeUpload'))}</button>` : ''}
          ${!state.busy && actions.review ? `<button class="primary" type="button" data-action="${prefix}-publish-review">${escapeHtml(this.tr('reviewPendingRelease'))}</button>` : ''}
          ${!state.busy && actions.discard ? `<button type="button" data-action="${prefix}-publish-discard">${escapeHtml(this.tr('discardSavedUpload'))}</button>` : ''}
        </div>
      </aside>
    ` : '';
    const closeConfirmation = closeConfirm ? `
      <aside id="${confirmId}" class="v4-chain-close-confirm" role="alertdialog" aria-labelledby="${confirmId}Title" aria-describedby="${confirmId}Copy" tabindex="-1">
        <strong id="${confirmId}Title">${escapeHtml(this.tr('publishCloseConfirmTitle'))}</strong>
        <p id="${confirmId}Copy">${escapeHtml(this.tr('publishCloseConfirmCopy'))}</p>
        <div>
          <button class="primary" type="button" data-action="keep-${prefix}-publish-open">${escapeHtml(this.tr('keepPublishOpen'))}</button>
          ${creator ? `<button type="button" data-action="force-close-${prefix}-publish">${escapeHtml(this.tr('closePublishAnyway'))}</button>` : ''}
        </div>
      </aside>
    ` : '';
    const quote = this.publicationQuote(state);
    const hasQuote = Object.values(quote).some((value) => this.publicationAtomicAmount(value));
    const registerLabel = state.stage === 'registered'
      ? this.tr('retryUploadStep')
      : hasQuote ? this.tr('confirmRegisterUploadStep') : this.tr('registerUploadStep');
    const title = this.tr(creator ? 'publishMakerStep' : 'finishOcStep', { step });
    const status = state.status || this.tr(creator ? 'immutableMakerPublishCopy' : 'pinnedOcPublishCopy');
    const contentState = closeConfirm ? 'inert aria-hidden="true"' : '';
    const activeTitleId = closeConfirm ? `${confirmId}Title` : titleId;
    const activeCopyId = closeConfirm ? `${confirmId}Copy` : copyId;
    return `
      <div class="v4-modal-backdrop v4-chain-flow-backdrop" data-action="close-${prefix}-publish-backdrop">
        <section id="${dialogId}" class="v4-chain-flow ${creator ? 'creator' : 'player'}" role="dialog" aria-modal="true" aria-labelledby="${activeTitleId}" aria-describedby="${activeCopyId}" aria-busy="${state.busy ? 'true' : 'false'}" tabindex="-1">
          <div class="v4-chain-flow-content" ${contentState}>
            <header>
              <div>
                <span class="v4-eyebrow">${escapeHtml(this.tr(creator ? 'creatorReleaseEyebrow' : 'playerReleaseEyebrow'))}</span>
                <h3 id="${titleId}">${escapeHtml(title)}</h3>
                <p id="${copyId}">${escapeHtml(this.tr('publishDialogCopy'))}</p>
              </div>
              <button type="button" data-action="close-${prefix}-publish" aria-label="${escapeHtml(this.tr('close'))}">×</button>
            </header>
            <ol>${stepItems}</ol>
            ${this.renderPublicationQuote(state, prefix)}
            <div class="v4-chain-status ${state.busy ? 'busy' : ''}" role="status" aria-live="polite">
              ${state.busy ? '<i aria-hidden="true"></i>' : ''}
              <span>${escapeHtml(status)}</span>
              ${state.busy ? `<small>${escapeHtml(this.tr('publishWorking'))}</small>` : ''}
            </div>
            ${errorPanel}
            <footer>
              ${!state.busy && !state.error && actions.resume ? `<button type="button" data-action="${prefix}-publish-resume">${escapeHtml(this.tr('resumeUpload'))}</button>` : ''}
              ${!state.busy && !state.error && actions.prepare ? `<button type="button" data-action="${prefix}-publish-prepare">${escapeHtml(this.tr(creator ? 'prepareQuiltStep' : 'prepareOcStep'))}</button>` : ''}
              ${!state.busy && !state.error && actions.register ? `<button class="primary" type="button" data-action="${prefix}-publish-register">${escapeHtml(registerLabel)}</button>` : ''}
              ${!state.busy && !state.error && actions.certify ? `<button class="primary" type="button" data-action="${prefix}-publish-certify">${escapeHtml(this.tr('certifyStep'))}</button>` : ''}
              ${!state.busy && !state.error && actions.publish ? `<button class="primary" type="button" data-action="${prefix}-publish-onchain">${escapeHtml(this.tr(creator ? 'publishMakerStepButton' : 'continueSoulidityStep'))}</button>` : ''}
              ${!state.busy && actions.review && !state.error ? `<button class="primary" type="button" data-action="${prefix}-publish-review">${escapeHtml(this.tr('reviewPendingRelease'))}</button>` : ''}
              ${state.digest ? `<strong class="v4-chain-published">${escapeHtml(this.tr(creator ? 'publishedDone' : 'completedDone'))}</strong>` : ''}
            </footer>
          </div>
          ${closeConfirmation}
        </section>
      </div>
    `;
  }

  renderCreatorPublishFlow() {
    return this.renderPublicationFlow('creator');
  }

  renderPlayerPublishFlow() {
    return this.renderPublicationFlow('player');
  }

  renderCreatorInspector(document, part, item, style) {
    if (!part) return `<div class="v4-inline-empty"><strong>${escapeHtml(this.tr('noPartSelected'))}</strong><span>${escapeHtml(this.tr('noPartSelectedCopy'))}</span></div>`;
    const defaultOptions = part.items.map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${selected(part.defaultItemId, candidate.id)}>${escapeHtml(candidate.name)}</option>`).join('');
    const channelOptions = [`<option value="">${escapeHtml(this.tr('noSmartColor'))}</option>`, ...document.colorChannels.filter((channel) => channel.mode === 'gradient-map').map((channel) => `<option value="${escapeHtml(channel.id)}" ${selected(style?.colorChannelId, channel.id)}>${escapeHtml(channel.name)}</option>`)].join('');
    const visibleWhenPartId = simpleVisibleWhenPartId(style?.visibleWhen);
    const advancedVisibility = Boolean(style?.visibleWhen && visibleWhenPartId === null);
    const visibleOptions = [
      ...(advancedVisibility ? [`<option value="__advanced__" selected>${escapeHtml(this.tr('advancedVisibilityCondition'))}</option>`] : []),
      `<option value="" ${selected(visibleWhenPartId, '')}>${escapeHtml(this.tr('alwaysVisible'))}</option>`,
      ...document.parts.filter((candidate) => candidate.id !== part.id).map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${selected(visibleWhenPartId, candidate.id)}>${escapeHtml(this.tr('whenPartSelected', { part: candidate.name }))}</option>`),
    ].join('');
    const styleKey = style ? styleSceneKey(part.id, item.id, style.id) : '';
    const styleLocked = Boolean(style?.styleLocked);
    const positionLocked = styleLocked || Boolean(style?.positionLocked);
    const styleDisabled = styleLocked ? 'disabled' : '';
    const positionReadonly = positionLocked ? 'readonly aria-readonly="true"' : '';
    const positionDisabled = positionLocked ? 'disabled' : '';
    const positionEditorOpen = Boolean(style && !positionLocked && (style.positionConfirmed === false || this.editingPositionStyleKey === styleKey));
    const effectiveTransform = style ? effectiveStyleTransform(document, style) : null;
    const pixelCoordinates = document.canvas.pixelMode === 'pixelated';
    const exportBackground = this.playerBackgroundPartIds(document).has(part.id);
    return `
      <div class="v4-inspector-section">
        <span class="v4-inspector-label">${escapeHtml(this.tr('part'))}</span>
        <label>${escapeHtml(this.tr('name'))}<input value="${escapeHtml(part.name)}" data-action="part-name" maxlength="128" /></label>
        <div class="v4-toggle-grid">
          <label><input type="checkbox" ${checked(part.required)} data-action="part-required" /> ${escapeHtml(this.tr('required'))}</label>
          <label><input type="checkbox" ${checked(part.menuVisible)} data-action="part-visible" /> ${escapeHtml(this.tr('playerMenu'))}</label>
          <label><input type="checkbox" ${checked(exportBackground)} data-action="part-export-background" /> ${escapeHtml(this.tr('exportBackgroundPart'))}</label>
        </div>
        <label>${escapeHtml(this.tr('defaultItem'))}<select data-action="part-default" ${part.items.length ? '' : 'disabled'}><option value="">${escapeHtml(this.tr('none'))}</option>${defaultOptions}</select></label>
        <label class="v4-file-button wide">${escapeHtml(this.tr('uploadPartIcon'))}<input type="file" accept="image/png,image/jpeg" data-action="part-icon" /></label>
      </div>
      ${item ? `
        <div class="v4-inspector-section">
          <span class="v4-inspector-label">${escapeHtml(this.tr('item'))}</span>
          <label>${escapeHtml(this.tr('name'))}<input value="${escapeHtml(item.name)}" data-action="item-name" maxlength="128" /></label>
          <div class="v4-inline-actions"><button type="button" data-action="copy-item">${escapeHtml(this.tr('duplicate'))}</button><button type="button" class="danger" data-action="delete-item" ${itemContainsLockedStyle(item) ? 'disabled' : ''}>${escapeHtml(this.tr('delete'))}</button></div>
          <label class="v4-file-button wide">${escapeHtml(this.tr('customThumbnail'))}<input type="file" accept="image/png,image/jpeg" data-action="item-thumbnail" /></label>
        </div>
        <div class="v4-inspector-section">
          <span class="v4-inspector-label">${escapeHtml(this.tr('style'))}</span>
          <p class="v4-style-concept">${escapeHtml(this.tr('stylePngCopy'))}</p>
          ${style ? `
            <label>${escapeHtml(this.tr('name'))}<input value="${escapeHtml(style.name)}" data-action="style-name" maxlength="128" ${styleDisabled} /></label>
            <div class="v4-inline-actions">
              <button type="button" data-action="copy-style">${escapeHtml(this.tr('duplicate'))}</button>
              <button type="button" data-action="set-default-style" ${styleLocked || item.defaultStyleId === style.id ? 'disabled' : ''}>${escapeHtml(item.defaultStyleId === style.id ? this.tr('defaultStyle') : this.tr('setDefaultStyle'))}</button>
              <button type="button" class="danger" data-action="delete-style" ${styleDisabled}>${escapeHtml(this.tr('delete'))}</button>
            </div>
            <div class="v4-style-locks">
              <label><input type="checkbox" ${checked(style.positionLocked)} data-action="style-position-locked" ${styleLocked ? 'disabled' : ''} /> ${escapeHtml(this.tr('positionLock'))}</label>
              <label><input type="checkbox" ${checked(style.styleLocked)} data-action="style-locked" /> ${escapeHtml(this.tr('styleLock'))}</label>
            </div>
            <label class="v4-file-button wide ${styleLocked ? 'disabled' : ''}">${escapeHtml(this.tr(style.assetId ? 'replaceStylePng' : 'uploadStylePng'))}<input type="file" accept="image/png" data-action="style-asset" ${styleDisabled} /></label>
            <div class="v4-position-row">
              <p class="v4-position-summary">X ${Number(effectiveTransform.x).toFixed(1)} · Y ${Number(effectiveTransform.y).toFixed(1)} · ${escapeHtml(this.tr('scale'))} ${Number(effectiveTransform.scale).toFixed(2)} · ${escapeHtml(this.tr('rotate'))} ${Number(effectiveTransform.rotation).toFixed(1)}°</p>
              ${positionEditorOpen
                ? `<button type="button" class="primary" data-action="confirm-position" ${style.assetId ? '' : 'disabled'}>${escapeHtml(this.tr('confirmPosition'))}</button>`
                : `<button type="button" data-action="edit-position" ${positionLocked || !style.assetId ? 'disabled' : ''}>${escapeHtml(this.tr('adjustPosition'))}</button>`}
            </div>
            <div class="v4-number-grid">
              <label>X<input type="number" step="${pixelCoordinates ? '1' : '0.1'}" value="${Number(effectiveTransform.x).toFixed(pixelCoordinates ? 0 : 1)}" data-action="style-x" ${positionReadonly} /></label>
              <label>Y<input type="number" step="${pixelCoordinates ? '1' : '0.1'}" value="${Number(effectiveTransform.y).toFixed(pixelCoordinates ? 0 : 1)}" data-action="style-y" ${positionReadonly} /></label>
              <label>${escapeHtml(this.tr('scale'))}<input type="number" min="0.01" max="100" step="0.01" value="${Number(effectiveTransform.scale).toFixed(2)}" data-action="style-scale" ${positionReadonly} /></label>
              <label>${escapeHtml(this.tr('rotate'))}<input type="number" step="1" value="${Number(effectiveTransform.rotation).toFixed(1)}" data-action="style-rotation" ${positionReadonly} /></label>
            </div>
            <label>${escapeHtml(this.tr('scaleOnCanvas'))}<input type="range" min="5" max="400" value="${Math.round(Number(effectiveTransform.scale) * 100)}" data-action="style-scale-preview" ${positionDisabled} /></label>
            <label>${escapeHtml(this.tr('opacity'))}<input type="range" min="0" max="100" value="${Math.round(style.opacity * 100)}" data-action="style-opacity" ${styleDisabled} /></label>
            <label>${escapeHtml(this.tr('blendMode'))}<select data-action="style-blend" ${styleDisabled}>${['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity','linear-dodge'].map((mode) => `<option value="${mode}" ${selected(style.blendMode, mode)}>${escapeHtml(this.blendModeText(mode))}</option>`).join('')}</select></label>
            <label>${escapeHtml(this.tr('smartColor'))}<select data-action="style-channel" ${styleDisabled}>${channelOptions}</select></label>
            <label>${escapeHtml(this.tr('showThisStyle'))}<select data-action="style-visible-when" ${styleDisabled || advancedVisibility ? 'disabled' : ''}>${visibleOptions}</select>${advancedVisibility ? `<small>${escapeHtml(this.tr('advancedVisibilityPreserved'))}</small>` : ''}</label>
            <div class="v4-inline-actions">
              <button type="button" data-action="toggle-style-hidden">${escapeHtml(this.tr(this.hiddenStyleKeys.has(styleKey) ? 'showStyle' : 'hideStyle'))}</button>
            </div>
            ${positionEditorOpen ? `<small>${escapeHtml(this.tr('dragPositionCopy'))}</small>` : ''}
          ` : `<div class="v4-inline-empty"><strong>${escapeHtml(this.tr('noStylesYet'))}</strong><span>${escapeHtml(this.tr('addStyleCopy'))}</span></div>`}
        </div>
      ` : ''}
    `;
  }

  renderCreatorAdvanced(document, issues, compatibility) {
    if (this.creatorTab === 'structure') {
      const { part, item, style } = this.selectedCreatorRecords(document);
      return `
        <div class="v4-advanced-head"><div><span>${escapeHtml(this.tr('partsItems'))}</span><h3>${escapeHtml(this.tr('structureTitle'))}</h3></div><button type="button" data-action="set-default-recipe">${escapeHtml(this.tr('setDefault'))}</button></div>
        <div class="v4-explainer-grid">
          <article><strong>${escapeHtml(this.tr('part'))}</strong><span>${escapeHtml(this.tr('partConceptCopy'))}</span><em>${escapeHtml(part?.name || '—')}</em></article>
          <article><strong>${escapeHtml(this.tr('item'))}</strong><span>${escapeHtml(this.tr('itemConceptCopy'))}</span><em>${escapeHtml(item?.name || '—')}</em></article>
          <article><strong>${escapeHtml(this.tr('style'))}</strong><span>${escapeHtml(this.tr('styleConceptCopy'))}</span><em>${escapeHtml(style?.name || '—')}</em></article>
        </div>
      `;
    }
    if (this.creatorTab === 'info') {
      const coverUrl = this.makerCoverUrl(document);
      const coverInitials = String(document.metadata.name || 'Maker').trim().slice(0, 2).toUpperCase();
      const licenseOptions = [
        'personal-use',
        'free-remix',
        'paid-commercial',
        'exclusive-commission',
      ].map((kind) => (
        `<option value="${kind}" ${selected(document.metadata.license?.kind, kind)}>${escapeHtml(this.licenseText(kind))}</option>`
      )).join('');
      const makerInfoControl = (action, value, { wide = false, textarea = false } = {}) => {
        const status = this.makerInfoByteStatus(action, value);
        const label = this.tr(MAKER_INFO_FIELD_SPECS[action].labelKey);
        const attributes = `data-action="${action}" maxlength="${status.limit}" aria-describedby="${status.statusId}" aria-invalid="${status.valid ? 'false' : 'true'}"`;
        const control = textarea
          ? `<textarea ${attributes}>${escapeHtml(value)}</textarea>`
          : `<input value="${escapeHtml(value)}" ${attributes} />`;
        return `
          <label class="${wide ? 'wide' : ''}">
            ${escapeHtml(label)}
            ${control}
            <small id="${status.statusId}" data-maker-byte-status="${action}" class="v4-maker-info-byte-status ${status.valid ? '' : 'invalid'}">${escapeHtml(this.makerInfoByteStatusText(status))}</small>
          </label>
        `;
      };
      return `
        <div class="v4-advanced-head">
          <div>
            <span>${escapeHtml(this.tr('makerInfo'))}</span>
            <h3>${escapeHtml(this.tr('makerInfoTitle'))}</h3>
            <p>${escapeHtml(this.tr('makerInfoCopy'))}</p>
          </div>
        </div>
        <div class="v4-maker-info-workspace">
          <section class="v4-maker-cover-editor">
            <div class="v4-maker-cover-preview ${coverUrl ? 'has-image' : ''}">
              ${coverUrl
                ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(this.tr('makerCoverAlt', { name: document.metadata.name }))}" />`
                : `<span aria-hidden="true">${escapeHtml(coverInitials || 'MA')}</span>`}
            </div>
            <div>
              <strong>${escapeHtml(this.tr('makerCover'))}</strong>
              <p>${escapeHtml(this.tr('makerCoverCopy'))}</p>
              <div class="v4-inline-actions">
                <label class="v4-file-button">${escapeHtml(this.tr(coverUrl ? 'replaceMakerCover' : 'uploadMakerCover'))}<input type="file" accept="image/png,image/jpeg" data-action="maker-cover" /></label>
                <button type="button" class="danger" data-action="remove-maker-cover" ${document.metadata.coverAssetId ? '' : 'disabled'}>${escapeHtml(this.tr('removeMakerCover'))}</button>
              </div>
              <small>${escapeHtml(this.tr('makerCoverRequirements'))}</small>
            </div>
          </section>
          <section class="v4-maker-info-form">
            ${makerInfoControl('maker-name', document.metadata.name)}
            ${makerInfoControl('maker-creator', document.metadata.creator)}
            ${makerInfoControl('maker-summary', document.metadata.summary, { wide: true, textarea: true })}
            ${makerInfoControl('maker-style', document.metadata.style)}
            <label>${escapeHtml(this.tr('makerLicense'))}<select data-action="maker-license-kind">${licenseOptions}</select></label>
            ${makerInfoControl('maker-license-note', document.metadata.license?.note || '', { wide: true, textarea: true })}
          </section>
          <dl class="v4-maker-info-facts">
            <div><dt>${escapeHtml(this.tr('makerId'))}</dt><dd><code>${escapeHtml(document.version.rootMakerId)}</code></dd></div>
            <div><dt>${escapeHtml(this.tr('version'))}</dt><dd><code>${escapeHtml(document.version.versionId)}</code></dd></div>
            <div><dt>${escapeHtml(this.tr('makerCanvas'))}</dt><dd>${document.canvas.width} × ${document.canvas.height}</dd></div>
          </dl>
        </div>
      `;
    }
    if (this.creatorTab === 'layers') {
      const { part: selectedPart, item: selectedItem, style: selectedStyle } = this.selectedCreatorRecords(document);
      const alignmentByTrack = new Map(collectTrackAlignmentWarnings(document, this.assets).map((warning) => [warning.trackId, warning]));
      const linkedPairs = linkedPartTrackPairs(document);
      const linkedPairByTrack = new Map(linkedPairs.map((pair) => [pair.trackId, pair]));
      const linkedOrderMatches = linkedPartTrackOrderMatches(document);
      const linkedOrderLocked = linkedTrackOrderSyncCrossesLock(document);
      const trackOptions = [
        `<option value="" ${selected(selectedStyle?.layerTrackId, '')}>${escapeHtml(this.tr('noLayerTrack'))}</option>`,
        ...document.layerTracks.map((track) => `<option value="${escapeHtml(track.id)}" ${selected(selectedStyle?.layerTrackId, track.id)}>${escapeHtml(track.name)}</option>`),
      ].join('');
      const rows = document.layerTracks.map((track, trackIndex) => {
        const bindings = document.parts.flatMap((part) => part.items.flatMap((item) => item.styles
          .filter((style) => style.layerTrackId === track.id)
          .map((style) => ({
            part,
            item,
            style,
            current: part.id === selectedPart?.id && item.id === selectedItem?.id && style.id === selectedStyle?.id,
          }))));
        const ownerParts = [...new Map(bindings.map((binding) => [binding.part.id, binding.part])).values()];
        const linkedPart = linkedPairByTrack.has(track.id)
          ? document.parts.find((candidate) => candidate.id === linkedPairByTrack.get(track.id).partId)
          : null;
        const placementLabel = linkedPart
          ? this.tr('trackFollowsPart', { part: linkedPart.name })
          : ownerParts.length
            ? this.tr('trackCustomOwners', { count: ownerParts.length })
            : this.tr('trackUnassigned');
        const containsLockedStyle = bindings.some((binding) => binding.style.styleLocked);
        const visualOrderLocked = track.locked || containsLockedStyle;
        const moveBackDisabled = trackIndex === 0
          || visualOrderLocked
          || trackVisualOrderLocked(document, document.layerTracks[trackIndex - 1]?.id);
        const moveFrontDisabled = trackIndex === document.layerTracks.length - 1
          || visualOrderLocked
          || trackVisualOrderLocked(document, document.layerTracks[trackIndex + 1]?.id);
        const visualLockLabel = track.locked
          ? this.tr('trackLocked')
          : containsLockedStyle
            ? this.tr('styleLockedTrack')
            : '';
        return `
          <div class="v4-track-row ${track.id === this.selectedTrackId ? 'active' : ''} ${bindings.some((binding) => binding.current) ? 'has-current-style' : ''} ${linkedPart ? 'linked-part' : 'custom-track'} ${visualOrderLocked ? 'locked' : ''}" draggable="${visualOrderLocked ? 'false' : 'true'}" data-drag-kind="track" data-drag-id="${escapeHtml(track.id)}" data-drop-kind="track">
            <button type="button" data-action="select-track" data-track-id="${escapeHtml(track.id)}"><span>⋮⋮</span><strong>${escapeHtml(track.name)}</strong><small>${escapeHtml(this.tr('trackStyleCount', { count: bindings.length }))}</small></button>
            <input value="${escapeHtml(track.name)}" data-action="track-name" data-track-id="${escapeHtml(track.id)}" maxlength="128" ${track.locked ? 'disabled' : ''} />
            <span class="v4-track-placement">${escapeHtml(placementLabel)}${visualLockLabel ? ` · ${escapeHtml(visualLockLabel)}` : ''}</span>
            <div>${alignmentByTrack.has(track.id) ? `<button type="button" class="warning" data-action="approve-track-alignment" data-track-id="${escapeHtml(track.id)}" title="${escapeHtml(alignmentByTrack.get(track.id).message)}">${escapeHtml(this.tr('reviewDrift'))}</button>` : track.alignmentApproved ? `<em>${escapeHtml(this.tr('exceptionApproved'))}</em>` : ''}<button type="button" data-action="toggle-track-lock" data-track-id="${escapeHtml(track.id)}">${escapeHtml(this.tr(track.locked ? 'unlockTrack' : 'lockTrack'))}</button><button type="button" data-action="move-track" data-track-id="${escapeHtml(track.id)}" data-direction="up" aria-label="${escapeHtml(this.tr('moveTrackBack'))}" title="${escapeHtml(this.tr('moveTrackBack'))}" ${moveBackDisabled ? 'disabled' : ''}>↑</button><button type="button" data-action="move-track" data-track-id="${escapeHtml(track.id)}" data-direction="down" aria-label="${escapeHtml(this.tr('moveTrackFront'))}" title="${escapeHtml(this.tr('moveTrackFront'))}" ${moveFrontDisabled ? 'disabled' : ''}>↓</button><button type="button" data-action="delete-track" data-track-id="${escapeHtml(track.id)}" aria-label="${escapeHtml(this.tr('deleteTrackAria'))}" ${bindings.length || track.locked ? 'disabled' : ''}>×</button></div>
            <div class="v4-track-bindings"><strong>${escapeHtml(this.tr('trackBindings'))}</strong>${bindings.length ? bindings.map(({ part, item, style, current }) => `<button type="button" class="${current ? 'current' : ''}" data-action="select-style-binding" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}" title="${escapeHtml(this.tr(current ? 'selectedStyleBinding' : 'openStyleBinding'))}">${escapeHtml(part.name)} › ${escapeHtml(item.name)} › ${escapeHtml(style.name)}</button>`).join('') : `<span>${escapeHtml(this.tr('noTrackBindings'))}</span>`}</div>
          </div>
        `;
      }).join('');
      return `
        <div class="v4-advanced-head"><div><span>${escapeHtml(this.tr('layerTracks'))}</span><h3>${escapeHtml(this.tr('layerOrderTitle'))}</h3><p>${escapeHtml(this.tr('layerOrderCopy'))}</p></div><div><button type="button" data-action="sync-linked-track-order" ${linkedOrderMatches || linkedOrderLocked ? 'disabled' : ''}>${escapeHtml(this.tr(linkedOrderMatches ? 'linkedOrderSynced' : 'syncLinkedOrder'))}</button><button type="button" data-action="add-track">${escapeHtml(this.tr('addTrack'))}</button></div></div>
        ${selectedStyle ? `
          <div class="v4-track-assignment">
            <div><span>${escapeHtml(this.tr('currentStyle'))}</span><strong>${escapeHtml([selectedPart?.name, selectedItem?.name, selectedStyle.name].filter(Boolean).join(' › '))}</strong></div>
            <label>${escapeHtml(this.tr('layerTrack'))}<select data-action="assign-style-track" ${selectedStyle.styleLocked ? 'disabled' : ''}>${trackOptions}</select></label>
          </div>
        ` : ''}
        <div class="v4-track-list">${rows || `<div class="v4-inline-empty"><span>${escapeHtml(this.tr('emptyTracks'))}</span></div>`}</div>
      `;
    }
    if (this.creatorTab === 'colors') {
      const gradientChannels = document.colorChannels.filter((channel) => channel.mode === 'gradient-map');
      const selectedChannel = gradientChannels.find((channel) => channel.id === this.selectedChannelId) || gradientChannels[0];
      const channels = gradientChannels.map((channel) => `
        <button type="button" class="v4-color-channel-card ${selectedChannel?.id === channel.id ? 'active' : ''}" data-action="select-channel" data-channel-id="${escapeHtml(channel.id)}">
          <span style="--swatch:${escapeHtml(channel.swatches.find((swatch) => swatch.id === channel.defaultSwatchId)?.hintColor || '#7b5cff')}"></span>
          <strong>${escapeHtml(channel.name)}</strong><small>${escapeHtml(this.tr('colorCountMode', { count: channel.swatches.length, mode: this.tr('gradientMap') }))}</small>
        </button>
      `).join('');
      const linkedStyleRecords = selectedChannel ? document.parts.flatMap((part) => part.items.flatMap((item) => item.styles
        .filter((style) => style.colorChannelId === selectedChannel.id)
        .map((style) => ({ style, label: `${part.name} / ${item.name} / ${style.name}` })))) : [];
      const linkedStyles = linkedStyleRecords.map(({ style, label }) => `${label}${style.styleLocked ? ' 🔒' : ''}`);
      const channelLocked = colorChannelHasLockedStyle(document, selectedChannel?.id);
      const channelDisabled = channelLocked ? `disabled title="${escapeHtml(this.tr('styleLock'))}"` : '';
      const swatches = selectedChannel?.swatches.map((swatch) => `
        <div class="v4-swatch-editor ${swatch.id === selectedChannel.defaultSwatchId ? 'default' : ''}">
          <input type="radio" name="v4-default-swatch" value="${escapeHtml(swatch.id)}" ${checked(swatch.id === selectedChannel.defaultSwatchId)} data-action="channel-default-swatch" title="${escapeHtml(this.tr('defaultColor'))}" ${channelDisabled} />
          <input value="${escapeHtml(swatch.name)}" data-action="swatch-name" data-swatch-id="${escapeHtml(swatch.id)}" maxlength="128" ${channelDisabled} />
          <label>${escapeHtml(this.tr('hint'))}<input type="color" value="${escapeHtml(swatch.hintColor)}" data-action="swatch-hint" data-swatch-id="${escapeHtml(swatch.id)}" ${channelDisabled} /></label>
          <label>${escapeHtml(this.tr('shadow'))}<input type="color" value="${escapeHtml(swatch.stops[0]?.color || '#111111')}" data-action="swatch-stop" data-swatch-id="${escapeHtml(swatch.id)}" data-stop-index="0" ${channelDisabled} /></label>
          <label>${escapeHtml(this.tr('mid'))}<input type="color" value="${escapeHtml(swatch.stops[Math.floor((swatch.stops.length - 1) / 2)]?.color || swatch.hintColor)}" data-action="swatch-mid" data-swatch-id="${escapeHtml(swatch.id)}" ${channelDisabled} /></label>
          <label>${escapeHtml(this.tr('light'))}<input type="color" value="${escapeHtml(swatch.stops.at(-1)?.color || '#ffffff')}" data-action="swatch-stop" data-swatch-id="${escapeHtml(swatch.id)}" data-stop-index="${Math.max(1, swatch.stops.length - 1)}" ${channelDisabled} /></label>
          <button type="button" data-action="delete-swatch" data-swatch-id="${escapeHtml(swatch.id)}" aria-label="${escapeHtml(this.tr('deleteColorPresetAria'))}" ${selectedChannel.swatches.length <= 1 || channelLocked ? channelDisabled || 'disabled' : ''}>×</button>
        </div>
      `).join('') || '';
      return `
        <div class="v4-advanced-head"><div><span>${escapeHtml(this.tr('smartColor'))}</span><h3>${escapeHtml(this.tr('smartColorTitle'))}</h3><p>${escapeHtml(this.tr('smartColorCopy'))}</p></div><button type="button" data-action="add-channel">${escapeHtml(this.tr('addChannel'))}</button></div>
        <div class="v4-color-workspace">
          <div class="v4-color-channel-list">${channels || `<div class="v4-inline-empty"><span>${escapeHtml(this.tr('createChannelCopy'))}</span></div>`}</div>
          ${selectedChannel ? `<div class="v4-color-detail">
            <div class="v4-form-row"><label>${escapeHtml(this.tr('name'))}<input value="${escapeHtml(selectedChannel.name)}" data-action="channel-name" ${channelDisabled} /></label><span>${escapeHtml(this.tr('gradientMap'))}</span><button type="button" class="danger" data-action="delete-channel" ${channelDisabled}>${escapeHtml(this.tr('delete'))}</button></div>
            <div class="v4-swatch-list">${swatches}</div>
            <button type="button" data-action="add-swatch" ${channelDisabled}>${escapeHtml(this.tr('colorPreset'))}</button>
            <p class="v4-linked-copy"><strong>${escapeHtml(this.tr('linkedStyles'))}</strong> ${linkedStyles.length ? linkedStyles.map(escapeHtml).join(' · ') : escapeHtml(this.tr('noneYet'))}</p>
          </div>` : ''}
        </div>
      `;
    }
    if (this.creatorTab === 'rules') {
      const groups = ownerRuleGroups(document);
      const definitionOptions = document.parts.flatMap((part) => [
        `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)} / ${escapeHtml(this.tr('anyItem'))}</option>`,
        ...part.items.flatMap((item) => [
          `<option value="${escapeHtml(`${part.id}::${item.id}`)}">${escapeHtml(part.name)} / ${escapeHtml(item.name)}</option>`,
          ...item.styles.map((style) => `<option value="${escapeHtml(`${part.id}::${item.id}::${style.id}`)}">${escapeHtml(part.name)} / ${escapeHtml(item.name)} / ${escapeHtml(style.name)}</option>`),
        ]),
      ]).join('');
      return `
        <div class="v4-advanced-head"><div><span>${escapeHtml(this.tr('rules'))}</span><h3>${escapeHtml(this.tr('rulesTitle'))}</h3><p>${escapeHtml(this.tr('rulesCopy'))}</p></div></div>
        <div class="v4-rule-builder">
          <label>${escapeHtml(this.tr('whenPart'))}<select id="v4RuleOwnerDefinition">${definitionOptions}</select></label>
          <label>${escapeHtml(this.tr('ruleLabel'))}<select id="v4RuleType"><option value="excludes">${escapeHtml(this.tr('cannotCombineWith'))}</option><option value="requires">${escapeHtml(this.tr('requiresLabel'))}</option></select></label>
          <label>${escapeHtml(this.tr('ruleMatchMode'))}<select id="v4RuleMatchMode"><option value="all">${escapeHtml(this.tr('ruleAllTargets'))}</option><option value="any">${escapeHtml(this.tr('ruleAnyTargets'))}</option></select></label>
          <label class="v4-rule-target-picker">${escapeHtml(this.tr('targetDefinition'))}<select id="v4RuleTargetDefinitions" multiple size="8">${definitionOptions}</select><small>${escapeHtml(this.tr('ruleMultiSelectHint'))}</small></label>
          <button type="button" data-action="add-rule">${escapeHtml(this.tr('addRule'))}</button>
        </div>
        ${this.ruleBuilderError ? `<div class="v4-rule-error" role="alert">${escapeHtml(this.ruleBuilderError)}</div>` : ''}
        <div class="v4-rule-list">${groups.map((group) => {
          const ownerStyle = group.ownerStyleId ? findStyle(document, group.ownerPartId, group.ownerItemId, group.ownerStyleId) : null;
          const logic = group.type === 'excludes'
            ? this.tr('ruleNotBadge')
            : group.rows.length > 1 ? this.tr('ruleAllBadge') : this.tr('requiresLabel');
          return `
            <div class="v4-rule-group">
              <header><span>${escapeHtml(group.ownerName)}${ownerStyle?.styleLocked ? ' 🔒' : ''}</span><b>${escapeHtml(logic)}</b></header>
              <div class="v4-rule-targets">
                ${group.rows.map((row) => {
                  const summary = ruleTargetSummary(document, row.target);
                  return `<span>${summary.any ? `<em>${escapeHtml(this.tr('ruleAnyBadge'))}</em>` : ''}<strong>${escapeHtml(summary.label)}</strong><button type="button" data-action="delete-rule" data-rule-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(this.tr('deleteRuleAria'))}" ${ownerStyle?.styleLocked ? 'disabled' : ''}>×</button></span>`;
                }).join('')}
              </div>
            </div>
          `;
        }).join('') || `<div class="v4-inline-empty"><span>${escapeHtml(this.tr('noConstraints'))}</span></div>`}</div>
      `;
    }
    if (this.creatorTab === 'expansions') {
      const drafts = document.extensions.expansionDrafts || [];
      const cards = drafts.map((pack) => {
        const result = checkExpansionPackCompatibility(document, pack);
        const enabled = this.enabledExpansionIds.has(pack.packId);
        return `
          <article class="v4-expansion-card ${result.compatible ? 'ready' : 'error'}">
            <header><div><span>${escapeHtml(pack.namespace)}</span><h4>${escapeHtml(pack.name)}</h4></div><em>${escapeHtml(pack.version)}</em></header>
            <p>${escapeHtml(this.tr('expansionStats', { parts: pack.parts.length, assets: pack.assets.length }))}</p>
            <small>${escapeHtml(this.tr(result.compatible ? 'compatibleOverlay' : 'incompatibleOverlay'))}</small>
            <div><button type="button" data-action="toggle-expansion" data-pack-id="${escapeHtml(pack.packId)}" ${result.compatible ? '' : 'disabled'}>${escapeHtml(this.tr(enabled ? 'disablePreview' : 'enablePreview'))}</button><button type="button" data-action="add-selected-to-expansion" data-pack-id="${escapeHtml(pack.packId)}" ${this.selectedItemId ? '' : 'disabled'}>${escapeHtml(this.tr('addSelectedItemCopy'))}</button><button type="button" data-action="delete-expansion" data-pack-id="${escapeHtml(pack.packId)}" class="danger">${escapeHtml(this.tr('delete'))}</button></div>
          </article>
        `;
      }).join('');
      return `
        <div class="v4-advanced-head"><div><span>${escapeHtml(this.tr('expansionPacks'))}</span><h3>${escapeHtml(this.tr('expansionTitle'))}</h3><p>${escapeHtml(this.tr('expansionCopy'))}</p></div><button type="button" data-action="add-expansion">${escapeHtml(this.tr('addExpansion'))}</button></div>
        <div class="v4-expansion-grid">${cards || `<div class="v4-inline-empty"><strong>${escapeHtml(this.tr('noExpansionPacks'))}</strong><span>${escapeHtml(this.tr('noExpansionCopy'))}</span></div>`}</div>
      `;
    }
    if (this.creatorTab === 'soul') {
      const validation = validateSoulConfig(document.livingContent, document);
      const selectedDocument = SOUL_CONFIG_DOCUMENTS.find(({ key }) => key === this.selectedSoulDocumentKey)
        || SOUL_CONFIG_DOCUMENTS[0];
      this.selectedSoulDocumentKey = selectedDocument.key;
      const selectedStatus = validation.documents[selectedDocument.key];
      const documentCopyKeys = {
        soulMd: ['soulPersonalityIdentity', 'soulPersonalityIdentityCopy'],
        memoryMd: ['soulMemory', 'soulMemoryCopy'],
        skillMd: ['soulSkills', 'soulSkillsCopy'],
      };
      const documentTabs = SOUL_CONFIG_DOCUMENTS.map((entry) => {
        const [titleKey] = documentCopyKeys[entry.key];
        const status = validation.documents[entry.key];
        return `
          <button type="button" class="${entry.key === selectedDocument.key ? 'active' : ''} ${status.valid ? 'valid' : 'invalid'}" data-action="select-soul-document" data-soul-key="${escapeHtml(entry.key)}" aria-pressed="${entry.key === selectedDocument.key}">
            <span>${escapeHtml(entry.filename)}</span>
            <strong>${escapeHtml(this.tr(titleKey))}</strong>
            <small>${escapeHtml(this.tr(status.customized ? 'soulDocumentCustomized' : 'soulDocumentDefault'))} · ${escapeHtml(this.tr(status.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}</small>
          </button>
        `;
      }).join('');
      const [, selectedCopyKey] = documentCopyKeys[selectedDocument.key];
      return `
        <div class="v4-advanced-head">
          <div><span>${escapeHtml(this.tr('soulConfig'))}</span><h3>${escapeHtml(this.tr('soulConfigTitle'))}</h3><p>${escapeHtml(this.tr('soulConfigCopy'))}</p></div>
          <button type="button" data-action="reset-all-soul">${escapeHtml(this.tr('soulRestoreAllDefaults'))}</button>
        </div>
        <div class="v4-soul-workspace">
          <nav class="v4-soul-document-list" aria-label="${escapeHtml(this.tr('soulConfig'))}">${documentTabs}</nav>
          <section class="v4-soul-editor">
            <header>
              <div><span>${escapeHtml(selectedDocument.filename)}</span><strong>${escapeHtml(this.tr(documentCopyKeys[selectedDocument.key][0]))}</strong><small>${escapeHtml(this.tr(selectedCopyKey))}</small></div>
              <button type="button" data-action="reset-soul-document" data-soul-key="${escapeHtml(selectedDocument.key)}">${escapeHtml(this.tr('soulRestoreDefault'))}</button>
            </header>
            <textarea data-action="soul-document-content" data-soul-key="${escapeHtml(selectedDocument.key)}" spellcheck="false" aria-label="${escapeHtml(selectedDocument.filename)}">${escapeHtml(validation.content[selectedDocument.key])}</textarea>
            <footer>
              <span class="${selectedStatus.valid ? 'valid' : 'invalid'}"><strong>${escapeHtml(this.tr('soulValidationStatus'))}:</strong> ${escapeHtml(this.tr(selectedStatus.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}${selectedStatus.error ? ` · ${escapeHtml(selectedStatus.error)}` : ''}</span>
              <span>${escapeHtml(this.tr('soulDocumentSize', { bytes: selectedStatus.bytes, limit: selectedStatus.maxBytes }))}</span>
              <span>${escapeHtml(this.tr('soulDraftSaveCopy'))}</span>
            </footer>
          </section>
        </div>
      `;
    }
    const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
    const warningIssues = issues.filter((issue) => issue.severity === 'warning');
    const issueRows = issues.map((issue) => {
      const severity = issue.severity === 'warning' ? 'warning' : 'error';
      const issuePath = String(issue.path || '');
      const makerInfoField = makerInfoFieldByPath(issuePath);
      const styleRecord = workspaceStyleRecords(document)
        .find((record) => record.path === issuePath);
      const focusable = Boolean(makerInfoField || (styleRecord && !styleRecord.packName));
      const [partId, itemId, styleId] = issuePath.split('/');
      const issuePart = styleRecord?.part || findPart(document, partId);
      const issueItem = styleRecord?.item || (issuePart && findItem(document, partId, itemId));
      const issueStyle = styleRecord?.style
        || issueItem?.styles.find((candidate) => candidate.id === styleId);
      const issueTrack = issueStyle && document.layerTracks.find((candidate) => candidate.id === issueStyle.layerTrackId);
      const displayPath = makerInfoField
        ? this.tr(makerInfoField.labelKey)
        : styleRecord
        ? [
            styleRecord.packName,
            issuePart?.name,
            issueItem?.name,
            issueStyle?.name,
            issueTrack?.name,
          ].filter(Boolean).join(' › ')
        : issue.path || 'Maker';
      const displayMessage = this.issueText(issue, {
        part: issuePart?.name || partId,
        item: issueItem?.name || itemId,
        style: issueStyle?.name || styleId,
      });
      return `<li class="${severity}">${focusable ? `<button type="button" data-action="focus-issue" data-issue-path="${escapeHtml(issue.path)}" title="${escapeHtml(issue.path)}"><span>${escapeHtml(displayPath)}</span><strong>${escapeHtml(displayMessage)}</strong><em>${escapeHtml(this.tr('open'))}</em></button>` : `<span>${escapeHtml(displayPath)}</span><strong>${escapeHtml(displayMessage)}</strong>`}</li>`;
    }).join('');
    return `
      <div class="v4-advanced-head"><div><span>${escapeHtml(this.tr('publishPreflight'))}</span><h3>${escapeHtml(blockingIssues.length ? this.tr(blockingIssues.length === 1 ? 'issueBlocks' : 'issuesBlock', { count: blockingIssues.length }) : warningIssues.length ? this.tr('readyWithWarnings', { count: warningIssues.length }) : this.tr('readyPublish'))}</h3><p>${escapeHtml(this.tr('preflightCopy'))}</p></div><button type="button" data-action="run-preflight">${escapeHtml(this.tr('runAgain'))}</button></div>
      ${compatibility ? `<div class="v4-compatibility ${compatibility.compatible ? 'ready' : 'breaking'}"><div><strong>${escapeHtml(this.tr(compatibility.compatible ? 'compatibleUpdate' : 'breakingUpdate'))}</strong><span>${escapeHtml(this.locale === 'en' ? compatibility.summary : this.tr('compatibilitySummary', { breaking: compatibility.breaking?.length || 0, warnings: compatibility.warnings?.length || 0, additions: compatibility.additions?.length || 0 }))}</span></div>${!compatibility.compatible && document.version.compatibility !== 'breaking' ? `<button type="button" data-action="set-version-compatibility" data-compatibility="breaking">${escapeHtml(this.tr('confirmBreakingUpdate'))}</button>` : compatibility.compatible && document.version.compatibility === 'breaking' ? `<button type="button" data-action="set-version-compatibility" data-compatibility="compatible">${escapeHtml(this.tr('useCompatibleUpdate'))}</button>` : `<em>${escapeHtml(this.tr('compatibilityConfirmed'))}</em>`}</div>` : `<div class="v4-compatibility ready"><strong>${escapeHtml(this.tr('initialVersion'))}</strong><span>${escapeHtml(this.tr('initialVersionCopy'))}</span></div>`}
      <ul class="v4-preflight-list">${issueRows || `<li class="ready"><span>${escapeHtml(this.tr('allChecks'))}</span><strong>${escapeHtml(this.tr('allChecksCopy'))}</strong></li>`}</ul>
    `;
  }

  renderImportDialog(document) {
    if (!this.pendingImport) return '';
    const trackOptions = (value) => [`<option value="">${escapeHtml(this.tr('createNewLayerTrack'))}</option>`, ...document.layerTracks.map((track) => `<option value="${escapeHtml(track.id)}" ${selected(value, track.id)}>${escapeHtml(track.name)}</option>`)].join('');
    const targetOptions = (value) => [`<option value="">${escapeHtml(this.tr('chooseItemStyle'))}</option>`, ...document.parts.flatMap((part) => part.items.flatMap((item) => item.styles.map((style) => {
      const definition = `${part.id}::${item.id}::${style.id}`;
      return `<option value="${escapeHtml(definition)}" ${selected(value, definition)} ${style.styleLocked ? 'disabled' : ''}>${escapeHtml(part.name)} / ${escapeHtml(item.name)} / ${escapeHtml(style.name)}${style.styleLocked ? ' 🔒' : ''}</option>`;
    })))].join('');
    const projectMode = this.pendingImport.mode === 'project';
    const targetCounts = new Map();
    const importTargetKey = (mapping, index) => projectMode
      ? mapping.targetDefinition
      : `new-style:${index}`;
    this.pendingImport.mapping.forEach((mapping, index) => {
      const key = importTargetKey(mapping, index);
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    });
    const hasConflicts = this.pendingImport.mapping.some((mapping, index) => targetCounts.get(importTargetKey(mapping, index)) > 1);
    return `
      <div class="v4-modal-backdrop" role="dialog" aria-modal="true" aria-label="${escapeHtml(this.tr('confirmBatchImport'))}">
        <section class="v4-import-dialog ${projectMode ? 'project-matrix' : ''}">
          <header><div><span>${escapeHtml(this.tr('confirmBatchImport'))}</span><h3>${escapeHtml(this.tr(projectMode ? 'projectImportTitle' : 'batchImportTitle'))}</h3></div><button type="button" data-action="cancel-import" aria-label="${escapeHtml(this.tr('cancel'))}">×</button></header>
          <p>${escapeHtml(this.tr(projectMode ? 'projectImportCopy' : 'batchImportCopy'))}</p>
          <div class="v4-import-list">${this.pendingImport.mapping.map((mapping, index) => `
            <div class="${targetCounts.get(importTargetKey(mapping, index)) > 1 ? 'conflict' : ''}">
              <span>${escapeHtml(mapping.fileName)}</span><em>${escapeHtml(mapping.confidence)}</em>
              ${projectMode ? `<select data-action="import-target" data-import-index="${index}">${targetOptions(mapping.targetDefinition)}</select>` : ''}
              ${projectMode ? '' : `<input data-action="import-style-name" data-import-index="${index}" value="${escapeHtml(mapping.suggestedStyleName || '')}" aria-label="${escapeHtml(this.tr('style'))}" />`}
              <select data-action="import-track" data-import-index="${index}">${trackOptions(mapping.trackId)}</select>
              ${projectMode ? '' : `<input data-action="import-track-name" data-import-index="${index}" value="${escapeHtml(mapping.suggestedTrackName)}" aria-label="${escapeHtml(this.tr('newTrackName'))}" />`}
            </div>
          `).join('')}</div>
          <footer><button type="button" data-action="cancel-import">${escapeHtml(this.tr('cancel'))}</button><button class="primary" type="button" data-action="confirm-import" ${hasConflicts || (projectMode && this.pendingImport.mapping.some((mapping) => !mapping.targetDefinition)) ? 'disabled' : ''}>${escapeHtml(hasConflicts ? this.tr('resolveDuplicateMappings') : this.tr('importPngCount', { count: this.pendingImport.mapping.length }))}</button></footer>
        </section>
      </div>
    `;
  }

  activePlayerParts(document, recipe = this.playerRecipe) {
    const selections = recipeSelectionMap(recipe);
    const visibilityContext = {
      selections: recipe.selections || [],
      colorChannels: Object.fromEntries((recipe.colors || []).map((entry) => [entry.channelId, entry.swatchId])),
    };
    return document.parts.filter((part) => {
      if (!part.menuVisible) return false;
      if (part.parentPartId) {
        const parentSelection = selections.get(part.parentPartId);
        if (!parentSelection?.itemId) return false;
        const allowedParentItemIds = Array.isArray(part.parentItemIds)
          ? part.parentItemIds
          : Array.isArray(part.parentItemKeys)
            ? part.parentItemKeys
            : [];
        if (allowedParentItemIds.length && !allowedParentItemIds.includes(parentSelection.itemId)) return false;
      }
      if (!evaluateVisibleWhen(part.visibleWhen, visibilityContext)) return false;
      return true;
    });
  }

  playerVisibleItems(part) {
    const document = this.runtimeDocument();
    const creatorPreview = this.playerCreatorPreview || this.context?.isPublished !== true;
    return (part?.items || []).filter((item) => {
      if ((item.status || 'draft') === 'public') return true;
      if (!creatorPreview) return false;
      return item.styles.some((style) => {
        if (!style.assetId || !style.layerTrackId) return false;
        const descriptor = document?.assets.find((asset) => asset.id === style.assetId);
        return Boolean(this.runtimeAsset(style.assetId) || descriptor?.url || descriptor?.legacy?.url);
      });
    });
  }

  playerOptionSettings(document = this.runtimeDocument()) {
    const creatorPreview = this.playerCreatorPreview || this.context?.isPublished !== true;
    return {
      includeNonPublicItems: creatorPreview,
      isAssetAvailable: (assetId) => {
        if (this.runtimeAsset(assetId)) return true;
        const descriptor = document?.assets?.find((asset) => asset.id === assetId);
        return Boolean(descriptor?.url || descriptor?.legacy?.url);
      },
    };
  }

  playerOptionReasonText(option, document = this.runtimeDocument()) {
    const code = option?.reasonCode;
    if (code === 'missing-style-png' || code === 'invalid-style-png') {
      return this.tr('optionMissingPng');
    }
    if (code === 'requires-rule' || code === 'excludes-rule') {
      const target = option?.reason?.details?.displayTarget
        || option?.reason?.details?.target
        || {};
      const part = findPart(document, target.partId);
      const item = target.itemId ? findItem(document, target.partId, target.itemId) : null;
      const style = target.styleId && item
        ? item.styles.find((candidate) => candidate.id === target.styleId)
        : null;
      const targetLabel = [part?.name || target.partId, item?.name, style?.name].filter(Boolean).join(' › ');
      return this.tr(code === 'requires-rule' ? 'optionRequires' : 'optionExcludes', {
        target: targetLabel || this.tr('optionUnavailable'),
      });
    }
    if (code === 'required-part') return this.tr('partRequiredCannotRemove');
    if (code === 'inactive-child-part') return this.tr('parentSelectionUnavailable');
    if ([
      'hidden-item-or-style-selected',
      'hidden-part-selected',
      'unsatisfiable-maker',
      'constraint-search-limit',
    ].includes(code)) return this.tr('ruleOptionUnavailable');
    return this.tr('optionUnavailable');
  }

  playerRenderKey(document = this.runtimeDocument(), recipe = this.playerRecipe) {
    if (!document) return '';
    return JSON.stringify({
      makerKey: this.makerKey,
      versionId: document.version?.versionId || '',
      revision: this.store?.getState().revision || 0,
      expansions: [...this.enabledExpansionIds].sort(),
      recipe: recipeWithColors(document, recipe),
    });
  }

  playerViolationText(violation = {}, document = this.runtimeDocument()) {
    const partId = violation.partId || violation.trigger?.partId || violation.target?.partId || '';
    const itemId = violation.itemId || violation.trigger?.itemId || violation.target?.itemId || '';
    const styleId = violation.styleId || violation.trigger?.styleId || violation.target?.styleId || '';
    const part = partId ? findPart(document, partId) : null;
    const item = partId && itemId ? findItem(document, partId, itemId) : null;
    const style = item && styleId ? item.styles.find((candidate) => candidate.id === styleId) : null;
    const targetSelector = violation.target || {};
    const targetPart = targetSelector.partId ? findPart(document, targetSelector.partId) : null;
    const targetItem = targetSelector.itemId && targetSelector.partId
      ? findItem(document, targetSelector.partId, targetSelector.itemId)
      : null;
    const targetStyle = targetSelector.styleId && targetItem
      ? targetItem.styles.find((candidate) => candidate.id === targetSelector.styleId)
      : null;
    const context = {
      part: part?.name || partId || this.tr('unknownPart'),
      item: item?.name || itemId || this.tr('unknownItem'),
      style: style?.name || styleId || this.tr('unknownStyle'),
      target: [
        targetPart?.name || targetSelector.partId,
        targetItem?.name || targetSelector.itemId,
        targetStyle?.name || targetSelector.styleId,
      ].filter(Boolean).join(' › ') || this.tr('optionUnavailable'),
    };
    const key = {
      'inactive-child-part': 'playerInactiveChildPart',
      'hidden-part-selected': 'playerHiddenPartSelected',
      'required-part-missing': 'playerRequiredPartMissing',
      'hidden-item-or-style-selected': 'playerHiddenSelection',
      'requires-rule': 'playerRequiresRule',
      'excludes-rule': 'playerExcludesRule',
      'missing-recipe-part': 'playerMissingRecipePart',
      'duplicate-recipe-part': 'playerDuplicateRecipePart',
      'unknown-part': 'playerUnknownPart',
      'unknown-item': 'playerUnknownItem',
      'unknown-style': 'playerUnknownStyle',
      'missing-style': 'playerMissingStyle',
      'unknown-color-channel': 'playerUnknownColorChannel',
      'unknown-color-swatch': 'playerUnknownColorSwatch',
      'missing-color-selection': 'playerMissingColorSelection',
    }[violation.code];
    return this.tr(key || 'playerInvalidCombination', context);
  }

  playerSceneIssueText(issue = {}, document = this.runtimeDocument()) {
    const path = String(issue.path || '');
    const pathIds = path.split('/').filter(Boolean);
    // Renderer diagnostics use `part/item/style`; validation/import
    // diagnostics may still use `parts/part/items/item/styles/style`.
    const verbosePath = pathIds[0] === 'parts';
    const partId = pathIds[verbosePath ? 1 : 0] || '';
    const itemId = pathIds[verbosePath ? 3 : 1] || '';
    const styleId = pathIds[verbosePath ? 5 : 2] || '';
    const part = partId ? findPart(document, partId) : null;
    const item = partId && itemId ? findItem(document, partId, itemId) : null;
    const style = item && styleId ? item.styles.find((candidate) => candidate.id === styleId) : null;
    const context = {
      part: part?.name || partId || this.tr('unknownPart'),
      item: item?.name || itemId || this.tr('unknownItem'),
      style: style?.name || styleId || this.tr('unknownStyle'),
    };
    const key = {
      'missing-styles': 'playerItemHasNoStyles',
      'unknown-style': 'playerUnknownStyle',
      'unknown-default-style': 'playerUnknownDefaultStyle',
      'style-required': 'playerStyleRequired',
      'unknown-item': 'playerUnknownItem',
      'duplicate-selection': 'playerDuplicateRecipePart',
      'unknown-layer-track': 'playerUnknownLayerTrack',
      'missing-asset-reference': 'playerMissingArtworkReference',
      'unknown-asset': 'playerMissingArtworkReference',
    }[issue.code];
    return this.tr(key || 'playerInvalidCombination', context);
  }

  playerCompletionIssues(document, recipe, {
    profile = this.playerProfile,
    livingContent = null,
  } = {}) {
    const issues = [];
    if (this.context?.walletAddress) {
      if (
        this.playerSaveErrorCode === 'PLAYER_SESSION_CONFLICT'
        || this.playerRecoveryBranches.length
      ) {
        issues.push(this.tr('playerResolveRecoveryBeforeComplete'));
      } else if (this.playerSaveState !== 'saved') {
        issues.push(this.tr('playerSaveBeforeComplete'));
      }
    }
    const name = String(profile?.name || '').trim();
    if (!name) issues.push(this.tr('playerNameRequired'));
    if (utf8Length(name) > 128) issues.push(this.tr('playerNameTooLong'));
    if (utf8Length(profile?.world) > 128) issues.push(this.tr('playerWorldTooLong'));
    if (utf8Length(profile?.description) > 2_000) issues.push(this.tr('playerDescriptionTooLong'));
    if (utf8Length(profile?.tags) > 1_000) issues.push(this.tr('playerTagsTooLong'));
    const playerLivingContent = livingContent
      ? {
          validation: validateSoulConfig(livingContent, document),
          content: livingContent,
          draft: livingContent,
        }
      : this.resolvedPlayerLivingContent(document);
    if (!playerLivingContent?.validation.valid) {
      const invalidDocument = SOUL_CONFIG_DOCUMENTS.find(
        ({ key }) => !playerLivingContent?.validation.documents[key].valid,
      );
      const error = invalidDocument
        ? this.playerSoulDocumentErrorText(playerLivingContent, invalidDocument.key)
        : this.tr('soulValidationInvalid');
      issues.push(`${this.tr('soulConfig')}: ${error}`);
    }
    const recipeResult = evaluateRecipe(document, recipe);
    if (!recipeResult.valid) issues.push(...recipeResult.violations.map((violation) => this.playerViolationText(violation, document)));
    try {
      const scene = resolveMakerScene(document, recipe, { strict: false });
      if (!scene.layers.length) issues.push(this.tr('playerNoVisibleArtwork'));
      scene.issues.forEach((issue) => issues.push(this.playerSceneIssueText(issue, document)));
      scene.layers.forEach((layer) => {
        const descriptor = document.assets.find((asset) => asset.id === layer.assetId);
        if (!this.runtimeAsset(layer.assetId) && !descriptor?.url && !descriptor?.legacy?.url) {
          const unavailablePart = findPart(document, layer.partId);
          const unavailableItem = findItem(document, layer.partId, layer.itemId);
          issues.push(this.tr('playerArtworkUnavailable', {
            part: unavailablePart?.name || layer.partId,
            item: unavailableItem?.name || layer.itemId,
          }));
        }
      });
    } catch (error) {
      issues.push(this.locale === 'en' && error?.message
        ? error.message
        : this.tr('playerCurrentOcRenderFailed'));
    }
    const renderKey = this.playerRenderKey(document, recipe);
    if (this.playerRenderState.key !== renderKey || ['idle', 'pending'].includes(this.playerRenderState.status)) {
      issues.push(this.tr('playerRenderPending'));
    } else if (this.playerRenderState.status === 'error') {
      issues.push(this.tr('playerRenderBlocked', {
        error: this.playerRenderState.error || this.tr('previewRenderFailed'),
      }));
    }
    return [...new Set(issues.filter(Boolean))];
  }

  updatePlayerCompletionUi() {
    if (!this.playerRoot || !this.store) return;
    const document = this.runtimeDocument();
    if (!document) return;
    const issues = this.playerCompletionIssues(document, this.playerRecipe);
    const status = this.playerRoot.querySelector('#v4PlayerCompletionStatus');
    if (status) {
      status.textContent = issues[0] || this.tr('playerOutputReady');
      status.dataset.state = issues.length ? 'blocked' : 'ready';
    }
    const complete = this.playerRoot.querySelector('[data-action="player-complete"]');
    if (complete) complete.disabled = issues.length > 0;
  }

  playerLivingContentContext(document = this.runtimeDocument()) {
    return {
      maker: document?.metadata || {},
      profile: {
        name: this.playerProfile.name,
        world: this.playerProfile.world,
        description: this.playerProfile.description,
        tags: String(this.playerProfile.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      },
    };
  }

  normalizePlayerLivingContent(value, document = this.runtimeDocument()) {
    if (!document) return null;
    const makerValidation = validateSoulConfig(document.livingContent, document);
    const makerDefaults = resolveLivingContent(
      makerValidation.content,
      this.playerLivingContentContext(document),
    );
    const customized = {};
    const normalized = { schemaVersion: makerDefaults.schemaVersion };
    SOUL_CONFIG_DOCUMENTS.forEach(({ key }) => {
      customized[key] = Boolean(value?.customized?.[key] && typeof value?.[key] === 'string');
      normalized[key] = customized[key] ? value[key] : makerDefaults[key];
    });
    normalized.customized = customized;
    return normalized;
  }

  playerLivingContentDraft(document = this.runtimeDocument()) {
    return this.normalizePlayerLivingContent(this.playerLivingContent, document);
  }

  setPlayerLivingDocument(key, markdown, document = this.runtimeDocument()) {
    if (!document || !SOUL_CONFIG_DOCUMENTS.some((entry) => entry.key === key)) return false;
    const current = this.playerLivingContentDraft(document);
    const value = String(markdown ?? '');
    if (current.customized[key] && current[key] === value) return false;
    this.playerLivingContent = {
      ...current,
      [key]: value,
      customized: {
        ...current.customized,
        [key]: true,
      },
    };
    return true;
  }

  resetPlayerLivingContent(key = null, document = this.runtimeDocument()) {
    if (!document) return false;
    const current = this.playerLivingContentDraft(document);
    const keys = key === null
      ? SOUL_CONFIG_DOCUMENTS.map((entry) => entry.key)
      : SOUL_CONFIG_DOCUMENTS.some((entry) => entry.key === key) ? [key] : [];
    if (!keys.length || !keys.some((entryKey) => current.customized[entryKey])) return false;
    const next = clone(current);
    keys.forEach((entryKey) => {
      next.customized[entryKey] = false;
    });
    this.playerLivingContent = this.normalizePlayerLivingContent(next, document);
    return true;
  }

  resolvedPlayerLivingContent(document = this.runtimeDocument()) {
    if (!document) return null;
    const draft = this.playerLivingContentDraft(document);
    const content = resolveLivingContent(draft, this.playerLivingContentContext(document));
    const validation = validateSoulConfig({
      ...draft,
      ...content,
    }, document);
    return {
      validation,
      content,
      draft,
    };
  }

  playerSoulDocumentErrorText(resolved, key) {
    const status = resolved?.validation?.documents?.[key];
    if (!status || status.valid) return '';
    if (!String(resolved.draft?.[key] || '').trim()) return this.tr('soulEmptyDocument');
    if (status.bytes > status.maxBytes) {
      return this.tr('soulDocumentTooLarge', { limit: status.maxBytes });
    }
    if (resolved.validation.totalBytes > resolved.validation.maxTotalBytes) {
      return this.tr('soulTotalTooLarge', { limit: resolved.validation.maxTotalBytes });
    }
    if (key === 'skillMd' && /frontmatter|lowercase name/i.test(status.error || '')) {
      return this.tr('soulSkillFrontmatter');
    }
    return status.error || this.tr('soulValidationInvalid');
  }

  renderPlayerSoulConfiguration(document) {
    const resolved = this.resolvedPlayerLivingContent(document);
    if (!resolved) return '';
    const documentCopyKeys = {
      soulMd: ['soulPersonalityIdentity', 'soulPersonalityIdentityCopy'],
      memoryMd: ['soulMemory', 'soulMemoryCopy'],
      skillMd: ['soulSkills', 'soulSkillsCopy'],
    };
    const customizedCount = SOUL_CONFIG_DOCUMENTS
      .filter((entry) => resolved.draft.customized[entry.key]).length;
    const documents = SOUL_CONFIG_DOCUMENTS.map((entry) => {
      const status = resolved.validation.documents[entry.key];
      const error = this.playerSoulDocumentErrorText(resolved, entry.key);
      const [titleKey, copyKey] = documentCopyKeys[entry.key];
      const editorId = `v4PlayerSoul-${entry.key}`;
      const statusId = `${editorId}-status`;
      return `
        <details class="v4-player-soul-document ${status.valid ? 'valid' : 'invalid'}" data-player-soul-wrapper="${escapeHtml(entry.key)}" ${entry.key === 'soulMd' ? 'open' : ''}>
          <summary>
            <span><code>${escapeHtml(entry.filename)}</code><strong>${escapeHtml(this.tr(titleKey))}</strong></span>
            <small data-player-soul-summary="${escapeHtml(entry.key)}">${escapeHtml(this.tr(status.customized ? 'playerSoulCustomized' : 'playerSoulMakerDefault'))} · ${escapeHtml(this.tr(status.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}</small>
          </summary>
          <div class="v4-player-soul-editor">
            <p>${escapeHtml(this.tr(copyKey))}</p>
            <label for="${editorId}">${escapeHtml(this.tr('playerSoulEditDocument', { filename: entry.filename }))}</label>
            <textarea id="${editorId}" data-action="player-soul-document" data-soul-key="${escapeHtml(entry.key)}" spellcheck="false" aria-invalid="${status.valid ? 'false' : 'true'}" aria-describedby="${statusId}">${escapeHtml(resolved.draft[entry.key])}</textarea>
            <footer id="${statusId}" role="status" aria-live="polite">
              <span data-player-soul-size="${escapeHtml(entry.key)}">${escapeHtml(this.tr('soulDocumentSize', { bytes: status.bytes, limit: status.maxBytes }))}</span>
              <span class="v4-player-soul-error" data-player-soul-error="${escapeHtml(entry.key)}" ${error ? '' : 'hidden'}>${escapeHtml(error)}</span>
              <button type="button" data-action="player-reset-soul-document" data-soul-key="${escapeHtml(entry.key)}" ${status.customized ? '' : 'disabled'}>${escapeHtml(this.tr('playerSoulRestoreDefault'))}</button>
            </footer>
          </div>
        </details>
      `;
    }).join('');
    return `
      <details class="v4-player-soul-card">
        <summary>
          <span><strong>${escapeHtml(this.tr('soulConfig'))}</strong><small>${escapeHtml(this.tr('soulConfigTitle'))}</small></span>
          <em data-player-soul-card-status>${escapeHtml(this.tr(resolved.validation.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}</em>
        </summary>
        <div class="v4-player-soul-intro">
          <p>${escapeHtml(this.tr('playerSoulConfigCopy'))}</p>
          <button type="button" data-action="player-reset-all-soul" ${customizedCount ? '' : 'disabled'}>${escapeHtml(this.tr('playerSoulRestoreAllDefaults'))}</button>
        </div>
        <div class="v4-player-soul-documents">${documents}</div>
        <small class="v4-player-soul-save-copy">${escapeHtml(this.tr('playerSoulDraftSaveCopy'))}</small>
      </details>
    `;
  }

  updatePlayerSoulConfigurationUi() {
    const document = this.runtimeDocument();
    const resolved = this.resolvedPlayerLivingContent(document);
    if (!resolved || !this.playerRoot?.querySelector) return;
    let customizedCount = 0;
    SOUL_CONFIG_DOCUMENTS.forEach((entry) => {
      const status = resolved.validation.documents[entry.key];
      const customized = resolved.draft.customized[entry.key];
      if (customized) customizedCount += 1;
      const editor = this.playerRoot.querySelector(`[data-action="player-soul-document"][data-soul-key="${entry.key}"]`);
      if (editor) {
        if (editor.value !== resolved.draft[entry.key]) editor.value = resolved.draft[entry.key];
        editor.setAttribute?.('aria-invalid', status.valid ? 'false' : 'true');
      }
      const wrapper = this.playerRoot.querySelector(`[data-player-soul-wrapper="${entry.key}"]`);
      wrapper?.classList?.toggle?.('valid', status.valid);
      wrapper?.classList?.toggle?.('invalid', !status.valid);
      const summary = this.playerRoot.querySelector(`[data-player-soul-summary="${entry.key}"]`);
      if (summary) {
        summary.textContent = `${this.tr(customized ? 'playerSoulCustomized' : 'playerSoulMakerDefault')} · ${this.tr(status.valid ? 'soulValidationValid' : 'soulValidationInvalid')}`;
      }
      const size = this.playerRoot.querySelector(`[data-player-soul-size="${entry.key}"]`);
      if (size) size.textContent = this.tr('soulDocumentSize', { bytes: status.bytes, limit: status.maxBytes });
      const error = this.playerRoot.querySelector(`[data-player-soul-error="${entry.key}"]`);
      if (error) {
        const message = this.playerSoulDocumentErrorText(resolved, entry.key);
        error.textContent = message;
        error.hidden = !message;
      }
      const reset = this.playerRoot.querySelector(`[data-action="player-reset-soul-document"][data-soul-key="${entry.key}"]`);
      if (reset) reset.disabled = !customized;
    });
    const cardStatus = this.playerRoot.querySelector('[data-player-soul-card-status]');
    if (cardStatus) cardStatus.textContent = this.tr(resolved.validation.valid ? 'soulValidationValid' : 'soulValidationInvalid');
    const resetAll = this.playerRoot.querySelector('[data-action="player-reset-all-soul"]');
    if (resetAll) resetAll.disabled = customizedCount === 0;
    const name = this.playerRoot.querySelector('[data-player-profile-preview="name"]');
    const world = this.playerRoot.querySelector('[data-player-profile-preview="world"]');
    if (name) name.textContent = this.playerProfile.name || this.tr('untitledOc');
    if (world) world.textContent = this.playerProfile.world || document.metadata.style || this.tr('originalCharacter');
  }

  renderPlayerExportModal(document) {
    if (!this.playerExportOpen || !this.playerExportSnapshot) return '';
    const snapshot = this.playerExportSnapshot;
    const standard = calculatePlayerExportSize(snapshot.document.canvas, { mode: 'standard' });
    const original = calculatePlayerExportSize(snapshot.document.canvas, { mode: 'original' });
    const originalSafe = isPlayerOriginalExportSafe(snapshot.document.canvas);
    const dimensions = this.playerExportDimensions
      || (this.playerExportSizeMode === 'original' ? original : standard);
    const external = this.playerExternalLinks(snapshot.document);
    const selected = recipeSelectionMap(snapshot.recipe);
    const selectedSummary = (snapshot.document.parts || []).flatMap((part) => {
      const selection = selected.get(part.id);
      const item = part.items.find((candidate) => candidate.id === selection?.itemId);
      const style = item?.styles.find((candidate) => candidate.id === selection?.styleId);
      return item ? [`${part.name}: ${item.name}${item.styles.length > 1 && style ? ` · ${style.name}` : ''}`] : [];
    });
    const shareStatus = {
      copied: this.tr('makerLinkCopied'),
      shared: this.tr('makerShared'),
      unavailable: this.tr('makerMustBePublishedToShare'),
      error: this.tr('makerShareUnavailable'),
    }[this.playerShareState] || '';
    const shareMessage = shareStatus || (external.shareUrl ? '' : this.tr('makerMustBePublishedToShare'));
    const renderStatus = this.playerExportState === 'rendering'
      ? this.tr('renderingFinalImage')
      : this.playerExportState === 'error'
        ? this.tr('finalImageFailed', { error: this.playerExportError || this.tr('previewRenderFailed') })
        : this.tr('finalImageReady');
    const canDownload = this.playerExportState === 'ready' && Boolean(this.playerExportPreviewBlob);
    const exportRendering = this.playerExportState === 'rendering';
    const completionIssues = this.playerCompletionIssues(snapshot.document, snapshot.recipe, {
      profile: snapshot.profile,
      livingContent: snapshot.livingContent,
    });
    const canComplete = canDownload && completionIssues.length === 0;
    const completeLabel = this.playerCreatorPreview
      ? this.tr('returnToCreator')
      : this.tr('continueToPublish');

    return `
      <div class="v4-modal-backdrop v4-player-export-backdrop" data-action="close-player-export-backdrop">
        <section id="makerPlayerExportDialog" class="v4-player-export-dialog" role="dialog" aria-modal="true" aria-labelledby="makerPlayerExportTitle" tabindex="-1">
          <header>
            <div>
              <span class="v4-eyebrow">${escapeHtml(this.tr('previewExport'))}</span>
              <h2 id="makerPlayerExportTitle">${escapeHtml(this.tr('finalOcPreview'))}</h2>
              <p>${escapeHtml(this.tr('finalOcPreviewCopy'))}</p>
            </div>
            <button type="button" class="v4-dialog-close" data-action="close-player-export" aria-label="${escapeHtml(this.tr('continueEditing'))}">×</button>
          </header>
          <div class="v4-player-export-body">
            <section class="v4-player-export-preview">
              <div class="v4-player-export-image ${snapshot.document.canvas.pixelMode === 'pixelated' ? 'pixelated' : ''}">
                ${this.playerExportPreviewUrl
                  ? `<img src="${escapeHtml(this.playerExportPreviewUrl)}" alt="${escapeHtml(this.tr('previewImageAlt', { name: snapshot.profile.name || this.tr('untitledOc') }))}" />`
                  : `<div class="v4-player-export-placeholder"><span aria-hidden="true">✦</span><strong>${escapeHtml(renderStatus)}</strong></div>`}
              </div>
              <div class="v4-player-export-caption">
                <div><strong>${escapeHtml(snapshot.profile.name || this.tr('untitledOc'))}</strong><span>${escapeHtml(snapshot.profile.world || snapshot.document.metadata.style || this.tr('originalCharacter'))}</span></div>
                <span>${escapeHtml(this.tr('exportDimensions', dimensions))}</span>
              </div>
              <div class="v4-player-export-selection" aria-label="${escapeHtml(this.tr('currentSelection'))}">
                ${selectedSummary.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}
              </div>
            </section>
            <aside class="v4-player-export-options">
              <fieldset>
                <legend>${escapeHtml(this.tr('exportSize'))}</legend>
                <div class="v4-player-export-choice">
                  <button type="button" data-action="player-export-size" data-size-mode="standard" aria-pressed="${this.playerExportSizeMode === 'standard'}" class="${this.playerExportSizeMode === 'standard' ? 'active' : ''}" ${exportRendering ? 'disabled' : ''}>
                    <strong>${escapeHtml(this.tr('standardSize'))}</strong>
                    <small>${escapeHtml(this.tr('exportDimensions', standard))}</small>
                  </button>
                  <button type="button" data-action="player-export-size" data-size-mode="original" aria-pressed="${this.playerExportSizeMode === 'original'}" class="${this.playerExportSizeMode === 'original' ? 'active' : ''}" ${originalSafe && !exportRendering ? '' : `disabled title="${escapeHtml(originalSafe ? this.tr('renderingFinalImage') : this.tr('originalSizeUnavailable'))}"`}>
                    <strong>${escapeHtml(this.tr('originalSize'))}</strong>
                    <small>${escapeHtml(originalSafe
                      ? this.tr('exportDimensions', original)
                      : this.tr('originalSizeUnavailable'))}</small>
                  </button>
                </div>
              </fieldset>
              <fieldset>
                <legend>${escapeHtml(this.tr('backgroundMode'))}</legend>
                <div class="v4-player-export-choice">
                  <button type="button" data-action="player-export-background" data-transparent="false" aria-pressed="${!this.playerExportTransparent}" class="${this.playerExportTransparent ? '' : 'active'}" ${exportRendering ? 'disabled' : ''}>${escapeHtml(this.tr('currentBackground'))}</button>
                  <button type="button" data-action="player-export-background" data-transparent="true" aria-pressed="${this.playerExportTransparent}" class="${this.playerExportTransparent ? 'active' : ''}" ${exportRendering ? 'disabled' : ''}>${escapeHtml(this.tr('transparentBackground'))}</button>
                </div>
              </fieldset>
              <div class="v4-player-export-status" role="status" data-state="${escapeHtml(this.playerExportState)}">
                <strong>${escapeHtml(renderStatus)}</strong>
                ${this.playerExportState === 'error' ? `<button type="button" data-action="player-export-retry">${escapeHtml(this.tr('retryRender'))}</button>` : ''}
              </div>
              <div class="v4-player-export-share">
                <strong>${escapeHtml(this.tr('shareMaker'))}</strong>
                <div>
                  <button type="button" data-action="player-copy-maker-link" ${external.shareUrl ? '' : 'disabled aria-describedby="makerPlayerShareStatus"'}>${escapeHtml(this.tr('copyMakerLink'))}</button>
                  ${typeof globalThis.navigator?.share === 'function' ? `<button type="button" data-action="player-share-maker" ${external.shareUrl ? '' : 'disabled aria-describedby="makerPlayerShareStatus"'}>${escapeHtml(this.tr('shareMaker'))}</button>` : ''}
                </div>
                <small id="makerPlayerShareStatus" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(shareMessage)}</small>
              </div>
              ${(external.creatorUrl || external.communityUrl) ? `
                <nav class="v4-player-soulidity-links" aria-label="${escapeHtml(this.tr('openSoulidity'))}">
                  ${external.creatorUrl ? `<a href="${escapeHtml(external.creatorUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(this.tr('creatorOnSoulidity'))}</a>` : ''}
                  ${external.communityUrl ? `<a href="${escapeHtml(external.communityUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(this.tr('soulidityCommunity'))}</a>` : ''}
                </nav>
              ` : ''}
              <p class="v4-player-export-license">${escapeHtml(this.tr('exportLicenseNotice'))}</p>
            </aside>
          </div>
          <footer>
            <p id="makerPlayerExportCompletionIssue" class="v4-player-export-completion-issue" ${completionIssues.length ? '' : 'hidden'}>${escapeHtml(completionIssues[0] || '')}</p>
            <button type="button" data-action="close-player-export">${escapeHtml(this.tr('continueEditing'))}</button>
            <button type="button" data-action="player-export-recipe">${escapeHtml(this.tr('downloadRecipePackage'))}</button>
            <button type="button" data-action="player-download-png" ${canDownload ? '' : 'disabled'}>${escapeHtml(this.tr('downloadPng'))}</button>
            <button type="button" class="primary" data-action="player-confirm-complete" ${canComplete ? '' : 'disabled aria-describedby="makerPlayerExportCompletionIssue"'}>${escapeHtml(completeLabel)}</button>
          </footer>
        </section>
      </div>
    `;
  }

  renderPlayer() {
    if (!this.playerRoot || !this.store) return;
    const exportScroll = this.playerExportOpen ? this.capturePlayerExportScroll() : null;
    const document = this.runtimeDocument();
    if (!document) return;
    const recipe = recipeWithColors(document, this.playerRecipe);
    const parts = this.activePlayerParts(document, recipe);
    let part = parts.find((candidate) => candidate.id === this.playerPartId) || parts[0] || null;
    this.playerPartId = part?.id || '';
    const selectionMap = recipeSelectionMap(recipe);
    const optionSettings = this.playerOptionSettings(document);
    const partOptions = part
      ? buildPlayerPartOptions(document, recipe, part.id, optionSettings)
      : { items: [] };
    const removePartOption = part
      ? evaluatePlayerRemovePartOption(document, recipe, part.id, optionSettings)
      : null;
    const clearOptionalOption = evaluatePlayerClearOptionalOption(document, recipe, optionSettings);
    const itemOptions = new Map(partOptions.items.map((option) => [option.itemId, option]));
    const visibleItems = (part?.items || []).filter((item) => itemOptions.get(item.id)?.visible);
    const currentSelection = part ? selectionMap.get(part.id) : null;
    const currentItem = visibleItems.find((item) => item.id === currentSelection?.itemId) || null;
    const itemRovingId = currentItem?.id
      || visibleItems.find((item) => itemOptions.get(item.id)?.selectable)?.id
      || visibleItems[0]?.id
      || '';
    const currentItemOption = currentItem ? itemOptions.get(currentItem.id) : null;
    const styleOptions = new Map((currentItemOption?.styles || []).map((option) => [option.styleId, option]));
    const visibleStyles = currentItem?.styles.filter((style) => styleOptions.get(style.id)?.visible) || [];
    const currentStyle = visibleStyles.find((style) => style.id === currentSelection?.styleId)
      || null;
    const styleRovingId = currentStyle?.id
      || visibleStyles.find((style) => styleOptions.get(style.id)?.selectable)?.id
      || visibleStyles[0]?.id
      || '';
    const recipeResult = evaluateRecipe(document, recipe);
    const renderKey = this.playerRenderKey(document, recipe);
    if (this.playerRenderState.key !== renderKey) {
      this.playerRenderState = { key: renderKey, status: 'pending', error: '' };
    }
    const completionIssues = this.playerCompletionIssues(document, recipe);
    const removePartReason = removePartOption?.selectable
      ? ''
      : this.playerOptionReasonText(removePartOption, document);
    const clearOptionalReason = clearOptionalOption.selectable
      ? ''
      : this.playerOptionReasonText(clearOptionalOption, document);
    const removePartReasonId = 'v4PlayerRemovePartReason';
    const clearOptionalReasonId = 'v4PlayerClearOptionalReason';
    const partButtons = parts.map((candidate) => {
      const selection = selectionMap.get(candidate.id);
      const thumbnail = this.partThumbnailUrl(candidate, selection);
      const active = candidate.id === part?.id;
      return `
        <button type="button" class="v4-player-part ${active ? 'active' : ''} ${selection?.itemId ? 'has-selection' : ''}" data-action="player-part" data-part-id="${escapeHtml(candidate.id)}" aria-current="${active ? 'true' : 'false'}">
          <span>${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />` : escapeHtml(candidate.name.slice(0, 2).toUpperCase())}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${escapeHtml(this.tr(selection?.itemId ? 'selectedState' : candidate.required ? 'required' : 'noneState'))}</small>
          ${selection?.itemId ? '<i class="v4-player-selected-mark" aria-hidden="true">✓</i>' : ''}
        </button>
      `;
    }).join('');
    const itemButtons = visibleItems.map((candidate, itemIndex) => {
      const option = itemOptions.get(candidate.id);
      const thumbnail = this.itemThumbnailUrl(candidate, option?.preferredStyleId);
      const visibleStyleCount = option?.styles.filter((style) => style.visible).length || 0;
      const reason = option?.selectable ? '' : this.playerOptionReasonText(option, document);
      const active = candidate.id === currentItem?.id;
      const reasonId = `v4-player-item-reason-${candidate.id}`;
      return `
        <button type="button" role="radio" class="v4-player-item ${active ? 'active' : ''} ${option?.selectable ? '' : 'disabled'}" data-action="player-item" data-item-id="${escapeHtml(candidate.id)}" data-player-radio-group="item" data-player-radio-index="${itemIndex}" aria-checked="${active ? 'true' : 'false'}" tabindex="${candidate.id === itemRovingId ? '0' : '-1'}" ${option?.selectable ? '' : `aria-disabled="true" aria-describedby="${escapeHtml(reasonId)}"`} title="${escapeHtml(reason || candidate.name)}">
          <span class="v4-player-option-image">${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />` : '<i>PNG</i>'}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          ${visibleStyleCount > 1 ? `<em>${escapeHtml(this.tr('styleCount', { count: visibleStyleCount }))}</em>` : ''}
          ${active ? '<i class="v4-player-selected-mark" aria-hidden="true">✓</i>' : ''}
          ${reason ? `<small id="${escapeHtml(reasonId)}" class="v4-player-option-reason">${escapeHtml(reason)}</small>` : ''}
        </button>
      `;
    }).join('') || '';
    const styleButtons = visibleStyles.map((candidate, styleIndex) => {
      const option = styleOptions.get(candidate.id);
      const reason = option?.selectable ? '' : this.playerOptionReasonText(option, document);
      const thumbnail = this.styleThumbnailUrl(candidate);
      const active = candidate.id === currentStyle?.id;
      const reasonId = `v4-player-style-reason-${candidate.id}`;
      return `
        <button type="button" role="radio" class="v4-player-style-option ${active ? 'active' : ''} ${option?.selectable ? '' : 'disabled'}" data-action="player-style" data-style-id="${escapeHtml(candidate.id)}" data-player-radio-group="style" data-player-radio-index="${styleIndex}" aria-checked="${active ? 'true' : 'false'}" tabindex="${candidate.id === styleRovingId ? '0' : '-1'}" ${option?.selectable ? '' : `aria-disabled="true" aria-describedby="${escapeHtml(reasonId)}"`} title="${escapeHtml(reason || candidate.name)}">
          <span>${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />` : '<i>PNG</i>'}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          ${active ? '<i class="v4-player-selected-mark" aria-hidden="true">✓</i>' : ''}
          ${reason ? `<small id="${escapeHtml(reasonId)}" class="v4-player-option-reason">${escapeHtml(reason)}</small>` : ''}
        </button>
      `;
    }).join('') || '';
    const usedChannelIds = resolvedPlayerColorChannelIds(document, recipe);
    const colorRows = document.colorChannels.filter((channel) => usedChannelIds.has(channel.id)).map((channel, channelIndex) => {
      const selectedColor = recipe.colors?.find((entry) => entry.channelId === channel.id)?.swatchId || channel.defaultSwatchId;
      const colorRovingId = channel.swatches.some((swatch) => swatch.id === selectedColor)
        ? selectedColor
        : channel.swatches[0]?.id;
      const colorLabelId = `v4PlayerColorGroupLabel-${channelIndex}`;
      return `
        <div class="v4-player-colors" role="radiogroup" aria-labelledby="${colorLabelId}"><span id="${colorLabelId}">${escapeHtml(channel.name)}</span><div>${channel.swatches.map((swatch, swatchIndex) => `<button type="button" role="radio" class="${swatch.id === selectedColor ? 'active' : ''}" style="--swatch:${escapeHtml(swatch.hintColor)}" data-action="player-color" data-channel-id="${escapeHtml(channel.id)}" data-swatch-id="${escapeHtml(swatch.id)}" data-player-radio-group="color-${channelIndex}" data-player-radio-index="${swatchIndex}" title="${escapeHtml(swatch.name)}" aria-label="${escapeHtml(`${channel.name}: ${swatch.name}`)}" aria-checked="${swatch.id === selectedColor ? 'true' : 'false'}" tabindex="${swatch.id === colorRovingId ? '0' : '-1'}"><i></i>${swatch.id === selectedColor ? '<b aria-hidden="true">✓</b>' : ''}</button>`).join('')}</div></div>
      `;
    }).join('');
    const colorControls = colorRows
      ? `<section class="v4-player-color-controls"><strong>${escapeHtml(this.tr('activeOcColors'))}</strong>${colorRows}</section>`
      : '';
    const packs = this.store.getState().document.extensions?.expansionDrafts || [];
    const selectedSummary = parts.map((candidate) => {
      const selectedItem = candidate.items.find((item) => item.id === selectionMap.get(candidate.id)?.itemId);
      return selectedItem ? `<span>${escapeHtml(candidate.name)}: ${escapeHtml(selectedItem.name)}</span>` : '';
    }).join('');
    const makerCoverUrl = this.makerCoverUrl(document);
    const externalLinks = this.playerExternalLinks(document);

    this.playerRoot.innerHTML = `
      <section class="v4-player-shell">
        <header class="v4-player-header">
          <div class="v4-player-maker-heading">
            ${makerCoverUrl ? `<img src="${escapeHtml(makerCoverUrl)}" alt="" />` : ''}
            <div><span class="v4-eyebrow">${escapeHtml(this.tr('characterMaker'))}</span><h1>${escapeHtml(document.metadata.name)}</h1><p>${escapeHtml(this.tr('byCreatorVersion', { creator: document.metadata.creator || this.tr('unknownCreator'), version: document.version.versionId }))}</p></div>
          </div>
          <div class="v4-player-tools">
            <button type="button" data-action="player-info">ⓘ ${escapeHtml(this.tr('infoLicense'))}</button>
            <button type="button" data-action="player-undo" aria-label="${escapeHtml(this.tr('undo'))}" ${this.playerUndo.length ? '' : 'disabled'}>↶</button>
            <button type="button" data-action="player-redo" aria-label="${escapeHtml(this.tr('redo'))}" ${this.playerRedo.length ? '' : 'disabled'}>↷</button>
            <button type="button" data-action="player-random" title="${escapeHtml(this.tr('random'))}">${escapeHtml(this.tr('random'))}</button>
            <div class="v4-player-tool-control">
              <button type="button" data-action="player-clear" ${clearOptionalOption.selectable ? '' : `aria-disabled="true" aria-describedby="${clearOptionalReasonId}"`} title="${escapeHtml(clearOptionalReason || this.tr('removeOptional'))}">${escapeHtml(this.tr('removeOptional'))}</button>
              ${clearOptionalReason ? `<small id="${clearOptionalReasonId}" class="v4-player-disabled-reason">${escapeHtml(clearOptionalReason)}</small>` : ''}
            </div>
            <button type="button" data-action="player-reset" title="${escapeHtml(this.tr('reset'))}">${escapeHtml(this.tr('reset'))}</button>
          </div>
        </header>
        <div class="v4-player-main">
          <section class="v4-player-preview">
            <div class="v4-player-canvas-wrap ${document.canvas.pixelMode === 'pixelated' ? 'pixelated' : ''}">
              <canvas id="makerV4PlayerCanvas" class="v4-runtime-canvas" aria-label="${escapeHtml(this.tr('yourOcPreview'))}"></canvas>
              <div id="v4PlayerRenderStatus" class="v4-render-status">${escapeHtml(this.tr('loadingDefaultRecipe'))}</div>
            </div>
            <div class="v4-player-nameplate"><div><strong data-player-profile-preview="name">${escapeHtml(this.playerProfile.name || this.tr('untitledOc'))}</strong><span data-player-profile-preview="world">${escapeHtml(this.playerProfile.world || document.metadata.style || this.tr('originalCharacter'))}</span></div><em>${escapeHtml(recipeResult.valid ? this.tr('validCombination') : this.tr('ruleIssueCount', { count: recipeResult.violations.length }))}</em></div>
            <div class="v4-player-recipe-strip">${selectedSummary}</div>
          </section>
          <section class="v4-player-controls">
            <div class="v4-player-part-rail">${partButtons}</div>
            <div class="v4-player-picker">
              <header><div><span>${escapeHtml(this.tr('currentPart'))}</span><h2 id="v4PlayerItemGroupLabel">${escapeHtml(part?.name || this.tr('noPlayableParts'))}</h2></div>${removePartOption?.visible ? `<div class="v4-player-remove-control"><button type="button" data-action="player-none" class="secondary" ${removePartOption.selectable ? '' : `aria-disabled="true" aria-describedby="${removePartReasonId}"`} title="${escapeHtml(removePartReason || this.tr('noneRemove'))}">${escapeHtml(this.tr('noneRemove'))}</button>${removePartReason ? `<small id="${removePartReasonId}" class="v4-player-disabled-reason">${escapeHtml(removePartReason)}</small>` : ''}</div>` : ''}</header>
              <div class="v4-player-item-grid" role="radiogroup" aria-labelledby="v4PlayerItemGroupLabel">${itemButtons || `<div class="v4-inline-empty"><span>${escapeHtml(this.tr('noAvailableItems'))}</span></div>`}</div>
              ${currentItem && visibleStyles.length > 1 ? `<div class="v4-player-style-picker" role="radiogroup" aria-labelledby="v4PlayerStyleGroupLabel"><span id="v4PlayerStyleGroupLabel">${escapeHtml(this.tr('style'))}</span>${styleButtons}</div>` : ''}
              ${colorControls}
              ${packs.length ? `<details class="v4-player-expansions"><summary>${escapeHtml(this.tr('expansionPacks'))}</summary><p>${escapeHtml(this.tr('expansionSelectionSaved'))}</p>${packs.map((pack) => {
                const compatibility = checkExpansionPackCompatibility(this.store.getState().document, pack);
                return `<label><input type="checkbox" data-action="player-expansion" value="${escapeHtml(pack.packId)}" ${checked(this.enabledExpansionIds.has(pack.packId))} ${compatibility.compatible ? '' : 'disabled'} /><span><strong>${escapeHtml(pack.name)}</strong><small>${escapeHtml(this.tr(compatibility.compatible ? 'optionalContentPack' : 'incompatibleVersion'))}</small></span></label>`;
              }).join('')}</details>` : ''}
            </div>
          </section>
        </div>
        <footer class="v4-player-finishbar">
          <div class="v4-player-profile-fields">
            <div class="v4-player-profile-heading"><span>${escapeHtml(this.tr('soulConfig'))}</span><strong>${escapeHtml(this.tr('soulPersonalityIdentity'))}</strong><small>${escapeHtml(this.tr('soulPersonalityIdentityCopy'))}</small></div>
            <label>${escapeHtml(this.tr('ocName'))}<input value="${escapeHtml(this.playerProfile.name)}" data-action="player-profile-name" maxlength="128" /></label>
            <label>${escapeHtml(this.tr('world'))}<input value="${escapeHtml(this.playerProfile.world)}" data-action="player-profile-world" maxlength="128" /></label>
            <label class="wide">${escapeHtml(this.tr('ocDescription'))}<textarea data-action="player-profile-description" maxlength="2000">${escapeHtml(this.playerProfile.description)}</textarea></label>
            <label class="wide">${escapeHtml(this.tr('ocTags'))}<input value="${escapeHtml(this.playerProfile.tags)}" data-action="player-profile-tags" maxlength="1000" placeholder="${escapeHtml(this.tr('ocTagsHint'))}" /></label>
            ${this.renderPlayerSoulConfiguration(document)}
          </div>
          ${this.renderPlayerRecoveryBranches()}
          <div>
            <span class="v4-player-finish-status"><small id="v4PlayerSaveStatus" data-state="${escapeHtml(this.playerSaveState)}">${escapeHtml(this.playerSaveStatusText())}</small><strong id="v4PlayerCompletionStatus" data-state="${completionIssues.length ? 'blocked' : 'ready'}">${escapeHtml(completionIssues[0] || this.tr('playerOutputReady'))}</strong></span>
            <button type="button" data-action="player-retry-save" ${this.playerSaveState === 'error' ? '' : 'hidden'}>${escapeHtml(this.tr('retryPlayerSave'))}</button>
            <button type="button" data-action="player-export">${escapeHtml(this.tr('recipeJson'))}</button>
            <button type="button" data-action="player-preview-export">${escapeHtml(this.tr('previewExport'))}</button>
            <button class="primary" type="button" data-action="player-complete" ${completionIssues.length ? 'disabled' : ''}>${escapeHtml(this.tr('completeOc'))}</button>
          </div>
        </footer>
        ${this.renderPlayerPublishFlow()}
      </section>
      ${this.playerIntroOpen ? `
        <div class="v4-modal-backdrop player-info">
          <section id="makerPlayerInfoDialog" class="v4-player-info-dialog" role="dialog" aria-modal="true" aria-labelledby="makerPlayerInfoTitle" tabindex="-1">
            ${makerCoverUrl ? `<img class="v4-player-info-cover" src="${escapeHtml(makerCoverUrl)}" alt="${escapeHtml(this.tr('makerCoverAlt', { name: document.metadata.name }))}" />` : ''}
            <span class="v4-eyebrow">${escapeHtml(this.tr('beforeYouMake'))}</span>
            <h2 id="makerPlayerInfoTitle">${escapeHtml(document.metadata.name)}</h2>
            <p>${escapeHtml(document.metadata.summary || this.tr('combineCreatorParts'))}</p>
            <dl><div><dt>${escapeHtml(this.tr('creator'))}</dt><dd>${escapeHtml(document.metadata.creator || this.tr('unknown'))}</dd></div><div><dt>${escapeHtml(this.tr('style'))}</dt><dd>${escapeHtml(document.metadata.style || this.tr('originalCharacter'))}</dd></div><div><dt>${escapeHtml(this.tr('license'))}</dt><dd>${escapeHtml(this.licenseText(document.metadata.license?.kind || 'personal-use'))}</dd></div><div><dt>${escapeHtml(this.tr('version'))}</dt><dd>${escapeHtml(document.version.versionId)}</dd></div></dl>
            <blockquote>${escapeHtml(document.metadata.license?.note || this.tr('followCreatorPolicy'))}</blockquote>
            ${(externalLinks.creatorUrl || externalLinks.communityUrl) ? `<nav class="v4-player-soulidity-links" aria-label="${escapeHtml(this.tr('openSoulidity'))}">${externalLinks.creatorUrl ? `<a href="${escapeHtml(externalLinks.creatorUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(this.tr('creatorOnSoulidity'))}</a>` : ''}${externalLinks.communityUrl ? `<a href="${escapeHtml(externalLinks.communityUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(this.tr('soulidityCommunity'))}</a>` : ''}</nav>` : ''}
            <button type="button" class="primary" data-action="close-player-info">${escapeHtml(this.tr('startMaking'))}</button>
          </section>
        </div>
      ` : ''}
      ${this.renderPlayerExportModal(document)}
    `;
    if (this.playerExportOpen) {
      this.restorePlayerExportScroll(exportScroll);
      this.focusPlayerExportDialog();
    } else if (this.playerIntroOpen) this.focusPlayerInfoDialog();
  }

  documentWithCreatorPreview() {
    const base = clone(this.runtimeDocument());
    if (!this.dragPreview && this.styleScalePreview == null) return base;
    const style = findStyle(base, this.selectedPartId, this.selectedItemId, this.selectedStyleId);
    if (!style) return base;
    const target = style.transform;
    if (!target) return base;
    if (this.dragPreview) {
      target.x = this.dragPreview.x;
      target.y = this.dragPreview.y;
    }
    if (this.styleScalePreview != null) target.scale = this.styleScalePreview;
    return base;
  }

  ensureAssetAlias(assetId) {
    if (this.assets.has(assetId)) return;
    const record = this.runtimeAsset(assetId);
    if (record) this.assets.set(assetId, record);
  }

  async drawCreatorCanvas() {
    const canvas = this.creatorRoot?.querySelector('#makerV4CreatorCanvas');
    if (!canvas || !this.store) return;
    this.renderAbort.creator?.abort();
    const controller = new AbortController();
    this.renderAbort.creator = controller;
    const status = this.creatorRoot.querySelector('#v4CreatorRenderStatus');
    try {
      const document = this.documentWithCreatorPreview();
      const recipe = this.creatorRecipe || this.store.getState().recipe;
      const scene = resolveMakerScene(document, recipe, { strict: false });
      const selectedStyleKey = this.currentStyleKey();
      scene.layers = scene.layers.filter((layer) => (
        !this.creatorHiddenPartIds.has(layer.partId)
        && !this.hiddenStyleKeys.has(styleSceneKey(layer.partId, layer.itemId, layer.styleId))
      ));
      const previewMode = scene.layers.length >= 2 ? this.creatorPreviewMode : 'all';
      if (previewMode === 'solo' && selectedStyleKey) {
        scene.layers = scene.layers.filter((layer) => styleSceneKey(layer.partId, layer.itemId, layer.styleId) === selectedStyleKey);
      } else if (previewMode === 'dim' && selectedStyleKey) scene.layers.forEach((layer) => {
        if (styleSceneKey(layer.partId, layer.itemId, layer.styleId) !== selectedStyleKey) layer.opacity *= 0.22;
      });
      scene.layers.forEach((layer) => this.ensureAssetAlias(layer.assetId));
      const result = await renderResolvedScene(scene, canvas, {
        signal: controller.signal,
        skipMissingAssets: true,
        resolveAsset: (assetId) => this.assetResolver.resolve(assetId),
        applyColorChannel: this.applyColorChannel,
      });
      if (controller.signal.aborted) return;
      if (status) status.textContent = result.skipped.length
        ? this.tr('creatorRenderUnavailable', { drawn: result.drawn, skipped: result.skipped.length })
        : this.tr('creatorRenderReady', { drawn: result.drawn });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (status) status.textContent = error.message || this.tr('canvasRenderFailed');
    }
  }

  async drawPlayerCanvas() {
    const canvas = this.playerRoot?.querySelector('#makerV4PlayerCanvas');
    if (!canvas || !this.store) return;
    this.renderAbort.player?.abort();
    const controller = new AbortController();
    this.renderAbort.player = controller;
    const status = this.playerRoot.querySelector('#v4PlayerRenderStatus');
    let renderKey = '';
    try {
      const document = this.runtimeDocument();
      renderKey = this.playerRenderKey(document, this.playerRecipe);
      const scene = resolveMakerScene(document, this.playerRecipe, { strict: false });
      scene.layers.forEach((layer) => this.ensureAssetAlias(layer.assetId));
      const result = await renderResolvedScene(scene, canvas, {
        signal: controller.signal,
        skipMissingAssets: true,
        resolveAsset: (assetId) => this.assetResolver.resolve(assetId),
        applyColorChannel: this.applyColorChannel,
      });
      if (controller.signal.aborted) return;
      if (this.playerRenderKey() !== renderKey) return;
      this.playerRenderState = result.skipped.length
        ? {
            key: renderKey,
            status: 'error',
            error: result.skipped[0]?.error?.message || this.tr('previewRenderFailed'),
          }
        : { key: renderKey, status: 'ready', error: '' };
      if (status) {
        status.textContent = result.skipped.length
          ? this.tr('playerRenderRetry', { skipped: result.skipped.length })
          : this.tr('playerRenderReady', { drawn: result.drawn });
        status.classList.toggle('ready', !result.skipped.length);
      }
      this.updatePlayerCompletionUi();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (status) status.textContent = error.message || this.tr('previewRenderFailed');
      if (!renderKey || this.playerRenderKey() === renderKey) {
        this.playerRenderState = {
          key: renderKey || this.playerRenderKey(),
          status: 'error',
          error: error?.message || this.tr('previewRenderFailed'),
        };
        this.updatePlayerCompletionUi();
      }
    }
  }

  setCreatorZoom(value, options = {}) {
    const nextZoom = Math.round(Math.min(2, Math.max(0.5, Number(value) || 1)) * 10) / 10;
    const previousZoom = this.creatorZoom || 1;
    const viewport = options.viewport || this.creatorRoot?.querySelector('.v4-canvas-viewport');
    const canvas = options.canvas || this.creatorRoot?.querySelector('#makerV4CreatorCanvas');
    const rect = viewport?.getBoundingClientRect?.();
    const hasFocalPoint = rect
      && Number.isFinite(options.clientX)
      && Number.isFinite(options.clientY);
    const localX = hasFocalPoint ? options.clientX - rect.left : 0;
    const localY = hasFocalPoint ? options.clientY - rect.top : 0;
    const contentX = hasFocalPoint ? Number(viewport.scrollLeft || 0) + localX : 0;
    const contentY = hasFocalPoint ? Number(viewport.scrollTop || 0) + localY : 0;

    this.creatorZoom = nextZoom;
    if (canvas?.style) canvas.style.width = `${Math.round(nextZoom * 100)}%`;
    const slider = this.creatorRoot?.querySelector('[data-action="canvas-zoom"]');
    if (slider) slider.value = String(Math.round(nextZoom * 100));

    if (hasFocalPoint && previousZoom > 0) {
      const ratio = nextZoom / previousZoom;
      viewport.scrollLeft = Math.max(0, (contentX * ratio) - localX);
      viewport.scrollTop = Math.max(0, (contentY * ratio) - localY);
    }
    return nextZoom;
  }

  attachCanvasDrag() {
    if (this.contextSwitchInProgress || this.restoreInProgress || this.restoreError) return;
    const viewport = this.creatorRoot?.querySelector('.v4-canvas-viewport');
    const canvas = this.creatorRoot?.querySelector('#makerV4CreatorCanvas');
    if (viewport && viewport.dataset.navigationReady !== 'true') {
      viewport.dataset.navigationReady = 'true';
      viewport.addEventListener('wheel', (event) => {
        if (!event.deltaY) return;
        event.preventDefault?.();
        const direction = event.deltaY < 0 ? 0.1 : -0.1;
        this.setCreatorZoom(this.creatorZoom + direction, {
          viewport,
          canvas,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }, { passive: false });
      viewport.addEventListener('pointerdown', (event) => {
        const panRequested = event.button === 1 || (event.button === 0 && this.creatorSpacePressed);
        if (!panRequested) return;
        event.preventDefault?.();
        const start = {
          clientX: event.clientX,
          clientY: event.clientY,
          left: Number(viewport.scrollLeft || 0),
          top: Number(viewport.scrollTop || 0),
        };
        viewport.setPointerCapture?.(event.pointerId);
        viewport.classList.add('panning');
        const move = (moveEvent) => {
          viewport.scrollLeft = start.left - (moveEvent.clientX - start.clientX);
          viewport.scrollTop = start.top - (moveEvent.clientY - start.clientY);
        };
        const finish = () => {
          viewport.removeEventListener('pointermove', move);
          viewport.removeEventListener('pointerup', finish);
          viewport.removeEventListener('pointercancel', finish);
          viewport.classList.remove('panning');
        };
        viewport.addEventListener('pointermove', move);
        viewport.addEventListener('pointerup', finish);
        viewport.addEventListener('pointercancel', finish);
      });
    }
    if (!canvas || canvas.dataset.dragReady === 'true') return;
    canvas.dataset.dragReady = 'true';
    canvas.addEventListener('pointerdown', (event) => {
      const { part, item, style } = this.selectedCreatorRecords();
      const styleKey = style ? styleSceneKey(part.id, item.id, style.id) : '';
      if (!part
        || !item
        || !style?.assetId
        || style.positionLocked
        || style.styleLocked
        || this.editingPositionStyleKey !== styleKey
        || this.creatorSpacePressed
        || event.button !== 0) return;
      const selection = { partId: part.id, itemId: item.id, styleId: style.id };
      const effectiveTransform = effectiveStyleTransform(this.store.getState().document, style);
      const rect = canvas.getBoundingClientRect();
      const start = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: Number(effectiveTransform.x || 0),
        y: Number(effectiveTransform.y || 0),
        ratioX: this.store.getState().document.canvas.width / Math.max(1, rect.width),
        ratioY: this.store.getState().document.canvas.height / Math.max(1, rect.height),
        pixelCoordinates: this.store.getState().document.canvas.pixelMode === 'pixelated',
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
      const move = (moveEvent) => {
        const x = start.x + ((moveEvent.clientX - start.clientX) * start.ratioX);
        const y = start.y + ((moveEvent.clientY - start.clientY) * start.ratioY);
        this.dragPreview = {
          x: start.pixelCoordinates ? Math.round(x) : Math.round(x * 10) / 10,
          y: start.pixelCoordinates ? Math.round(y) : Math.round(y * 10) / 10,
        };
        this.drawCreatorCanvas();
      };
      const finish = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', finish);
        canvas.removeEventListener('pointercancel', finish);
        canvas.classList.remove('dragging');
        const preview = this.dragPreview;
        this.dragPreview = null;
        if (!preview || (preview.x === start.x && preview.y === start.y)) return;
        this.executeDocument('Move Style on Canvas', ({ document }) => {
          const target = findStyle(document, selection.partId, selection.itemId, selection.styleId);
          if (!target || target.positionLocked || target.styleLocked) return;
          target.transform.x = preview.x;
          target.transform.y = preview.y;
          target.positionConfirmed = false;
          this.editingPositionStyleKey = styleSceneKey(selection.partId, selection.itemId, selection.styleId);
        });
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);
    });
  }

  executeDocument(label, mutator) {
    if (
      !this.store
      || this.contextSwitchInProgress
      || this.restoreInProgress
      || this.restoreError
      || this.playerSessionSwitchInProgress
      || this.documentMutationBlocked()
    ) return false;
    const published = this.context?.publishedDocument;
    this.store.execute(label, (next) => {
      if (this.context?.isPublished
        && isMakerV5Document(published)
        && next.document.version.versionId === published.version.versionId) {
        const number = Math.max(Number(next.document.version.number || 1), Number(published.version.number || 1)) + 1;
        next.document.version = {
          ...next.document.version,
          versionId: `${next.document.version.rootMakerId}-v${number}`,
          number,
          parentVersionId: published.version.versionId,
          compatibility: 'compatible',
          compatibleFrom: Number(published.version.compatibleFrom || 1),
          createdAt: null,
          changelog: '',
        };
        next.document.extensions ||= {};
        next.document.extensions.updateFromVersionId = published.version.versionId;
      }
      mutator(next);
      normalizeDocumentOrders(next.document);
      synchronizeDefaultRecipe(next.document);
      next.recipe = recipeWithColors(next.document, next.recipe);
    });
    // Detached Blob records stay available while Undo/Redo or a retained v6
    // checkpoint may still restore their asset IDs. Physical garbage collection
    // must happen only after both histories no longer reference the Blob.
    return true;
  }

  captureCreatorText(input) {
    if (this.documentMutationBlocked()) return false;
    const action = input?.dataset?.action;
    if (![
      'part-name',
      'item-name',
      'style-name',
      'track-name',
      'channel-name',
      'swatch-name',
      'soul-document-content',
      'maker-name',
      'maker-summary',
      'maker-creator',
      'maker-style',
      'maker-license-note',
    ].includes(action)) return false;
    if (['channel-name', 'swatch-name'].includes(action)
      && colorChannelHasLockedStyle(this.store?.getState().document, this.selectedChannelId)) return false;
    this.pendingCreatorText = {
      action,
      value: String(input.value || ''),
      partId: this.selectedPartId,
      itemId: this.selectedItemId,
      styleId: this.selectedStyleId,
      trackId: input.dataset.trackId || this.selectedTrackId,
      channelId: this.selectedChannelId,
      swatchId: input.dataset.swatchId || '',
      soulKey: input.dataset.soulKey || this.selectedSoulDocumentKey,
    };
    return true;
  }

  flushPendingCreatorText() {
    const pending = this.pendingCreatorText;
    this.pendingCreatorText = null;
    if (!pending || !this.store) return false;
    const currentDocument = this.store.getState().document;
    if (pending.action === 'soul-document-content') {
      const value = pending.value;
      const currentValue = validateSoulConfig(currentDocument.livingContent, currentDocument).content[pending.soulKey];
      if (value === currentValue) return false;
      this.executeDocument('Edit Soul configuration', ({ document }) => {
        document.livingContent = updateSoulConfig(document.livingContent, pending.soulKey, value, document);
      });
      return true;
    }
    const makerSettingByAction = {
      'maker-name': 'name',
      'maker-summary': 'summary',
      'maker-creator': 'creator',
      'maker-style': 'style',
      'maker-license-note': 'licenseNote',
    };
    if (makerSettingByAction[pending.action]) {
      const setting = makerSettingByAction[pending.action];
      const currentValue = setting === 'licenseNote'
        ? currentDocument.metadata.license?.note || ''
        : currentDocument.metadata[setting] || '';
      if (pending.value === currentValue) return false;
      this.updateMakerSettings({ [setting]: pending.value });
      return true;
    }
    const value = pending.value.trim();
    const currentChannel = currentDocument.colorChannels.find((candidate) => candidate.id === pending.channelId);
    if (['channel-name', 'swatch-name'].includes(pending.action)
      && colorChannelHasLockedStyle(currentDocument, pending.channelId)) return false;
    const currentValue = pending.action === 'part-name' ? findPart(currentDocument, pending.partId)?.name
      : pending.action === 'item-name' ? findItem(currentDocument, pending.partId, pending.itemId)?.name
        : pending.action === 'style-name' ? findStyle(currentDocument, pending.partId, pending.itemId, pending.styleId)?.name
          : pending.action === 'track-name' ? currentDocument.layerTracks.find((candidate) => candidate.id === pending.trackId)?.name
            : pending.action === 'channel-name' ? currentChannel?.name
              : currentChannel?.swatches.find((candidate) => candidate.id === pending.swatchId)?.name;
    if (!value || value === currentValue) return false;
    this.executeDocument({
      'part-name': 'Rename Part',
      'item-name': 'Rename Item',
      'style-name': 'Rename Style',
      'track-name': 'Rename Layer Track',
      'channel-name': 'Rename Color Channel',
      'swatch-name': 'Rename color preset',
    }[pending.action], ({ document }) => {
      if (pending.action === 'part-name') {
        const target = findPart(document, pending.partId);
        if (target && value) target.name = value;
      } else if (pending.action === 'item-name') {
        const target = findItem(document, pending.partId, pending.itemId);
        if (target && value) target.name = value;
      } else if (pending.action === 'style-name') {
        const target = findStyle(document, pending.partId, pending.itemId, pending.styleId);
        if (target && !target.styleLocked && value) target.name = value;
      } else if (pending.action === 'track-name') {
        const target = document.layerTracks.find((candidate) => candidate.id === pending.trackId);
        if (target && !target.locked && value) target.name = value;
      } else {
        const channel = document.colorChannels.find((candidate) => candidate.id === pending.channelId);
        if (colorChannelHasLockedStyle(document, pending.channelId)) return;
        if (pending.action === 'channel-name' && channel && value) channel.name = value;
        if (pending.action === 'swatch-name') {
          const swatch = channel?.swatches.find((candidate) => candidate.id === pending.swatchId);
          if (swatch && value) swatch.name = value;
        }
      }
    });
    return true;
  }

  confirmDelete(message) {
    return typeof globalThis.window?.confirm !== 'function' || globalThis.window.confirm(message);
  }

  handleCreatorClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || button.matches('input,select,textarea,label')) return;
    const action = button.dataset.action;
    if (action === 'manage-lifecycle') {
      this.callbacks.onManageLifecycle?.();
      return;
    }
    if (
      this.contextSwitchInProgress
      || this.restoreInProgress
      || this.restoreError
      || this.playerSessionSwitchInProgress
    ) {
      if (action === 'retry-workspace-restore' && this.restoreError) {
        void this.retryLocalWorkspaceRestore();
      } else if (action === 'export-emergency-recovery' && this.restoreError) {
        this.exportEmergencyRecoveryJson();
      } else if (action === 'back-library' && this.restoreError) {
        this.callbacks.onBackToLibrary?.();
      }
      return;
    }
    this.flushPendingCreatorText();
    const state = this.store?.getState();
    if (!state) return;
    const document = state.document;
    const { part, item, style } = this.selectedCreatorRecords(document);
    const mutationActions = new Set([
      'restore-checkpoint',
      'reset-soul-document',
      'reset-all-soul',
      'remove-maker-cover',
      'undo',
      'redo',
      'toggle-pixel',
      'add-part',
      'move-part',
      'copy-part',
      'delete-part',
      'add-item',
      'copy-item',
      'delete-item',
      'add-style',
      'copy-style',
      'delete-style',
      'set-default-style',
      'confirm-position',
      'add-track',
      'move-track',
      'sync-linked-track-order',
      'toggle-track-lock',
      'delete-track',
      'approve-track-alignment',
      'add-channel',
      'delete-channel',
      'add-swatch',
      'delete-swatch',
      'add-rule',
      'delete-rule',
      'add-expansion',
      'delete-expansion',
      'add-selected-to-expansion',
      'set-default-recipe',
      'set-version-compatibility',
      'confirm-import',
    ]);
    if (this.documentMutationBlocked() && mutationActions.has(action)) {
      this.callbacks.onMutationBlocked?.(this.documentMutationBlockedMessage());
      return;
    }
    if (action === 'open-version-history' || action === 'retry-version-history') {
      void this.openVersionHistory();
      return;
    }
    if (
      action === 'close-version-history'
      || (action === 'close-version-history-backdrop' && event.target === button)
    ) {
      this.closeVersionHistory();
      return;
    }
    if (action === 'restore-checkpoint') {
      void this.restoreVersionCheckpoint(button.dataset.revision);
      return;
    }
    if (action === 'creator-tab') {
      this.openCreatorTab(button.dataset.tab);
      return;
    }
    if (action === 'select-soul-document') {
      if (SOUL_CONFIG_DOCUMENTS.some(({ key }) => key === button.dataset.soulKey)) {
        this.selectedSoulDocumentKey = button.dataset.soulKey;
        this.render();
      }
      return;
    }
    if (action === 'reset-soul-document') {
      const soulKey = button.dataset.soulKey || this.selectedSoulDocumentKey;
      if (!SOUL_CONFIG_DOCUMENTS.some(({ key }) => key === soulKey)) return;
      if (!this.confirmDelete(this.tr('soulRestoreConfirm'))) return;
      this.executeDocument('Restore Soul document default', ({ document: next }) => {
        next.livingContent = resetSoulConfig(next.livingContent, soulKey, next);
      });
      return;
    }
    if (action === 'reset-all-soul') {
      if (!this.confirmDelete(this.tr('soulRestoreConfirm'))) return;
      this.executeDocument('Restore all Soul defaults', ({ document: next }) => {
        next.livingContent = resetSoulConfig(next.livingContent, null, next);
      });
      return;
    }
    if (action === 'remove-maker-cover') {
      if (!document.metadata.coverAssetId || !this.confirmDelete(this.tr('removeMakerCoverConfirm'))) return;
      this.executeDocument('Remove Maker cover', ({ document: next }) => {
        next.metadata.coverAssetId = null;
        removeUnreferencedAssetMetadata(next);
      });
      return;
    }
    if (action === 'close-tool' || (action === 'close-tool-backdrop' && event.target === button)) {
      this.openCreatorTab('structure');
      return;
    }
    if (action === 'back-library') {
      if (this.creatorPublishState.busy) {
        this.creatorPublishOpen = true;
        this.creatorPublishCloseConfirm = false;
        this.render();
        this.focusCreatorPublishDialog();
        return;
      }
      const operation = this.captureMakerOperation();
      void this.flushPendingChanges({ reason: 'back-library' }).then((result) => {
        if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
        if (!result.saved) {
          operation.store.setSaveState('error', operation.store.getState().saveMessage || this.tr('saveFailed'));
          return;
        }
        this.callbacks.onBackToLibrary?.();
      }).catch((error) => {
        if (this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
          operation.store.setSaveState('error', error.message || this.tr('saveFailed'));
        }
      });
      return;
    }
    if (action === 'select-part') {
      this.dragPreview = null;
      this.styleScalePreview = null;
      this.selectedPartId = button.dataset.partId;
      this.selectedItemId = '';
      this.selectedStyleId = '';
      this.ensureCreatorSelection(document);
      this.selectedTrackId = this.selectedCreatorRecords(document).style?.layerTrackId
        || document.layerTracks[0]?.id
        || '';
      this.syncCreatorRecipeSelection();
      this.render();
      return;
    }
    if (action === 'select-item') {
      const selectedItem = findItem(document, this.selectedPartId, button.dataset.itemId);
      if (!selectedItem) return;
      this.dragPreview = null;
      this.styleScalePreview = null;
      this.selectedItemId = selectedItem.id;
      this.selectedStyleId = selectedItem.defaultStyleId || selectedItem.styles[0]?.id || '';
      this.ensureCreatorSelection(document);
      this.selectedTrackId = this.selectedCreatorRecords(document).style?.layerTrackId
        || document.layerTracks[0]?.id
        || '';
      this.syncCreatorRecipeSelection();
      this.render();
      return;
    }
    if (action === 'select-style') {
      this.dragPreview = null;
      this.styleScalePreview = null;
      this.selectedStyleId = button.dataset.styleId;
      this.ensureCreatorSelection(document);
      this.selectedTrackId = this.selectedCreatorRecords(document).style?.layerTrackId
        || document.layerTracks[0]?.id
        || '';
      this.syncCreatorRecipeSelection();
      this.render();
      return;
    }
    if (action === 'select-track') {
      this.selectedTrackId = button.dataset.trackId;
      this.render();
      return;
    }
    if (action === 'select-style-binding') {
      const nextStyle = findStyle(
        document,
        button.dataset.partId,
        button.dataset.itemId,
        button.dataset.styleId,
      );
      if (!nextStyle) return;
      this.selectedPartId = button.dataset.partId;
      this.selectedItemId = button.dataset.itemId;
      this.selectedStyleId = button.dataset.styleId;
      this.selectedTrackId = nextStyle.layerTrackId || this.selectedTrackId;
      this.syncCreatorRecipeSelection();
      this.render();
      return;
    }
    if (action === 'select-channel') {
      this.selectedChannelId = button.dataset.channelId;
      this.render();
      return;
    }
    if (action === 'undo') return void this.store.undo();
    if (action === 'redo') return void this.store.redo();
    if (action === 'save') return void this.save();
    if (action === 'export-project') {
      void this.exportProjectArchive();
      return;
    }
    if (action === 'open-player') {
      const operation = this.captureMakerOperation();
      void this.flushPendingChanges({ reason: 'open-player' }).then((result) => {
        if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
        if (!result.saved) {
          operation.store.setSaveState('error', operation.store.getState().saveMessage || this.tr('saveFailed'));
          return;
        }
        this.playerCreatorPreview = true;
        const previewRecipe = clone(this.creatorRecipe || operation.store.getState().recipe);
        const playablePreviewRecipe = normalizePlayablePlayerRecipe(
          this.runtimeDocument(),
          previewRecipe,
          this.playerOptionSettings(),
        );
        this.playerRecipe = playablePreviewRecipe.documentRecipe;
        this.playerUndo = [];
        this.playerRedo = [];
        this.playerIntroOpen = true;
        this.callbacks.onOpenPlayer?.({ document: this.runtimeDocument(), recipe: this.playerRecipe, assets: this.assets });
        this.render();
      }).catch((error) => {
        if (this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
          operation.store.setSaveState('error', error.message || this.tr('saveFailed'));
        }
      });
      return;
    }
    if (action === 'publish') {
      this.openCreatorPublication();
      return;
    }
    if (
      action === 'close-creator-publish'
      || (action === 'close-creator-publish-backdrop' && event.target === button)
    ) {
      this.requestCloseCreatorPublish();
      return;
    }
    if (action === 'keep-creator-publish-open') {
      this.creatorPublishCloseConfirm = false;
      this.render();
      this.focusCreatorPublishDialog('[data-action="close-creator-publish"]');
      return;
    }
    if (action === 'force-close-creator-publish') {
      this.requestCloseCreatorPublish({ force: true });
      return;
    }
    if (action === 'copy-creator-publish-error') {
      void this.copyCreatorPublishError();
      return;
    }
    if (action === 'creator-publish-retry') {
      const retryAction = String(button.dataset.publishAction || '');
      if (!['resume', 'prepare', 'register', 'certify', 'onchain', 'review'].includes(retryAction)) return;
      if (retryAction === 'review' || this.creatorPublishState.error?.code === 'TRANSACTION_OUTCOME_PENDING') return;
      this.creatorPublishCopyState = 'idle';
      this.callbacks.onCreatorPublishAction?.(retryAction);
      return;
    }
    if (action === 'creator-publish-recover') {
      const recoveryAction = String(button.dataset.publishAction || '');
      if (
        this.creatorPublishState.error?.code !== 'TRANSACTION_OUTCOME_PENDING'
        || !['resume', 'register', 'certify', 'onchain'].includes(recoveryAction)
      ) return;
      this.creatorPublishCopyState = 'idle';
      this.callbacks.onCreatorPublishAction?.(recoveryAction);
      return;
    }
    const creatorPublishActions = new Set(['creator-publish-resume', 'creator-publish-prepare', 'creator-publish-register', 'creator-publish-certify', 'creator-publish-onchain', 'creator-publish-review', 'creator-publish-discard']);
    if (creatorPublishActions.has(action)) {
      this.creatorPublishOpen = true;
      this.creatorPublishCloseConfirm = false;
      this.callbacks.onCreatorPublishAction?.(action.replace('creator-publish-', ''));
      return;
    }
    if (action === 'run-preflight') {
      this.rulePreflightCache.delete(document);
      this.releasePreflightCache.delete(document);
      this.creatorTab = 'validate';
      this.render();
      return;
    }
    if (action === 'focus-issue') {
      const issuePath = String(button.dataset.issuePath || '');
      const makerInfoField = makerInfoFieldByPath(issuePath);
      if (makerInfoField) {
        this.creatorTab = 'info';
        this.render();
        const focusField = () => {
          this.creatorRoot
            ?.querySelector?.(`[data-action="${makerInfoField.action}"]`)
            ?.focus?.();
        };
        if (typeof globalThis.requestAnimationFrame === 'function') {
          globalThis.requestAnimationFrame(focusField);
        } else {
          focusField();
        }
        return;
      }
      const [partId, itemId, styleId] = issuePath.split('/');
      const target = findStyle(document, partId, itemId, styleId);
      if (!target) return;
      this.selectedPartId = partId;
      this.selectedItemId = itemId;
      this.selectedStyleId = styleId;
      this.selectedTrackId = target.layerTrackId || this.selectedTrackId;
      this.editingPositionStyleKey = target.positionLocked || target.styleLocked ? '' : styleSceneKey(partId, itemId, styleId);
      this.creatorTab = 'structure';
      this.render();
      return;
    }
    if (action === 'set-preview-mode') {
      const mode = ['all', 'dim', 'solo'].includes(button.dataset.previewMode) ? button.dataset.previewMode : 'all';
      if (mode !== 'all') {
        let visibleLayerCount = 0;
        try {
          const scene = resolveMakerScene(document, this.creatorRecipe || state.recipe, { strict: false });
          visibleLayerCount = scene.layers.filter((layer) => {
            if (this.creatorHiddenPartIds.has(layer.partId)) return false;
            if (this.hiddenStyleKeys.has(styleSceneKey(layer.partId, layer.itemId, layer.styleId))) return false;
            const descriptor = document.assets.find((asset) => asset.id === layer.assetId);
            return Boolean(layer.assetId && (this.runtimeAsset(layer.assetId) || descriptor?.url || descriptor?.legacy?.url));
          }).length;
        } catch {
          visibleLayerCount = 0;
        }
        if (!style || visibleLayerCount < 2) return;
      }
      this.creatorPreviewMode = mode;
      this.render();
      return;
    }
    if (action === 'toggle-style-hidden' && style) {
      const key = styleSceneKey(part.id, item.id, style.id);
      if (this.hiddenStyleKeys.has(key)) this.hiddenStyleKeys.delete(key);
      else this.hiddenStyleKeys.add(key);
      this.render();
      return;
    }
    if (action === 'toggle-part-preview') {
      const partId = button.dataset.partId;
      if (this.creatorHiddenPartIds.has(partId)) this.creatorHiddenPartIds.delete(partId);
      else this.creatorHiddenPartIds.add(partId);
      this.render();
      return;
    }
    if (action === 'show-all-parts') {
      this.creatorHiddenPartIds.clear();
      this.render();
      return;
    }
    if (action === 'show-current-part' && part) {
      this.creatorHiddenPartIds = new Set(document.parts.filter((candidate) => candidate.id !== part.id).map((candidate) => candidate.id));
      this.render();
      return;
    }
    if (action === 'toggle-pixel') {
      this.executeDocument('Toggle pixel art mode', ({ document: next }) => {
        next.canvas.pixelMode = next.canvas.pixelMode === 'pixelated' ? 'smooth' : 'pixelated';
      });
      return;
    }
    if (action === 'add-part') {
      this.executeDocument('Add Part', ({ document: next }) => {
        const nextPart = createPart(next, `Part ${next.parts.length + 1}`);
        const nextTrack = createLayerTrack(next, nextPart.name);
        const nextItem = createItem(nextPart, 'Default');
        nextItem.styles[0].layerTrackId = nextTrack.id;
        nextPart.items.push(nextItem);
        nextPart.defaultItemId = nextItem.id;
        next.layerTracks.push(nextTrack);
        next.parts.push(nextPart);
        this.selectedPartId = nextPart.id;
        this.selectedItemId = nextItem.id;
        this.selectedStyleId = nextItem.defaultStyleId;
        this.selectedTrackId = nextTrack.id;
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'move-part') {
      const index = document.parts.findIndex((candidate) => candidate.id === button.dataset.partId);
      const target = button.dataset.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= document.parts.length
        || partMoveCrossesLockedLinkedTrack(document, index, target)) return;
      this.executeDocument('Reorder Parts and linked Layer Tracks', ({ document: next }) => {
        if (partMoveCrossesLockedLinkedTrack(next, index, target)) return;
        moveArrayEntry(next.parts, index, target);
        synchronizeLinkedTrackOrderFromParts(next);
      });
      return;
    }
    if (action === 'copy-part' && part) {
      this.executeDocument('Duplicate Part', ({ document: next }) => {
        const duplicatesExportBackground = this.playerBackgroundPartIds(next).has(part.id);
        const duplicate = duplicatePart(next, part.id);
        if (!duplicate) return;
        if (duplicatesExportBackground) {
          next.extensions ||= {};
          const backgroundPartIds = this.playerBackgroundPartIds(next);
          backgroundPartIds.add(duplicate.id);
          next.extensions.playerExport = {
            ...(next.extensions.playerExport || {}),
            backgroundPartIds: next.parts
              .map((candidate) => candidate.id)
              .filter((partId) => backgroundPartIds.has(partId)),
          };
        }
        const duplicateItem = duplicate.items.find((candidate) => candidate.id === duplicate.defaultItemId) || duplicate.items[0] || null;
        const duplicateStyle = duplicateItem?.styles.find((candidate) => candidate.id === duplicateItem.defaultStyleId) || duplicateItem?.styles[0] || null;
        this.selectedPartId = duplicate.id;
        this.selectedItemId = duplicateItem?.id || '';
        this.selectedStyleId = duplicateStyle?.id || '';
        this.selectedTrackId = duplicateStyle?.layerTrackId || this.selectedTrackId;
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (
      action === 'delete-part'
      && part
      && !partContainsLockedStyle(part)
      && this.confirmDelete(this.tr('deletePartConfirm', { name: part.name }))
    ) {
      this.executeDocument('Delete Part', ({ document: next, recipe: nextRecipe }) => {
        const removedPart = findPart(next, part.id);
        const candidateTrackIds = new Set(partLayerTrackIds(removedPart));
        next.parts = next.parts.filter((candidate) => candidate.id !== part.id);
        if (Array.isArray(next.extensions?.playerExport?.backgroundPartIds)) {
          next.extensions.playerExport.backgroundPartIds = next.extensions.playerExport.backgroundPartIds
            .filter((partId) => partId !== part.id);
        }
        next.parts.forEach((candidate) => {
          if (candidate.parentPartId === part.id) candidate.parentPartId = null;
          candidate.requires = candidate.requires.filter((target) => target.partId !== part.id);
          candidate.excludes = candidate.excludes.filter((target) => target.partId !== part.id);
        });
        pruneDeletedDefinitionReferences(next, { partId: part.id });
        replaceRecipeSelection(nextRecipe, { partId: part.id, itemId: '' });
        const usedTrackIds = new Set(next.parts.flatMap((candidate) => partLayerTrackIds(candidate)));
        next.layerTracks = next.layerTracks.filter((track) => (
          !candidateTrackIds.has(track.id) || usedTrackIds.has(track.id) || track.locked
        ));
        removeUnreferencedAssetMetadata(next);
      });
      this.selectedPartId = '';
      this.selectedItemId = '';
      this.selectedStyleId = '';
      this.ensureCreatorSelection(this.store.getState().document);
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'add-item' && part) {
      this.executeDocument('Add Item', ({ document: next }) => {
        const targetPart = findPart(next, part.id);
        const linkage = partTrackLinkage(next, targetPart.id);
        let inheritedTrackId = linkage.mode === 'linked' ? linkage.trackId : null;
        inheritedTrackId ||= targetPart.items
          .flatMap((candidate) => candidate.styles)
          .find((candidate) => candidate.layerTrackId)?.layerTrackId || null;
        if (!inheritedTrackId) {
          const nextTrack = createLayerTrack(next, targetPart.name);
          next.layerTracks.push(nextTrack);
          inheritedTrackId = nextTrack.id;
        }
        const nextItem = createItem(targetPart, `Item ${targetPart.items.length + 1}`);
        nextItem.styles[0].layerTrackId = inheritedTrackId;
        targetPart.items.push(nextItem);
        targetPart.defaultItemId ||= nextItem.id;
        this.selectedItemId = nextItem.id;
        this.selectedStyleId = nextItem.defaultStyleId;
        this.selectedTrackId = inheritedTrackId;
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'copy-item' && item) {
      this.executeDocument('Duplicate Item', ({ document: next }) => {
        const duplicate = duplicateItem(next, part.id, item.id);
        if (!duplicate) return;
        this.selectedItemId = duplicate.id;
        this.selectedStyleId = duplicate.defaultStyleId || duplicate.styles[0]?.id || '';
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (
      action === 'delete-item'
      && item
      && !itemContainsLockedStyle(item)
      && this.confirmDelete(this.tr('deleteItemConfirm', { name: item.name }))
    ) {
      this.executeDocument('Delete Item', ({ document: next, recipe: nextRecipe }) => {
        const targetPart = findPart(next, part.id);
        targetPart.items = targetPart.items.filter((candidate) => candidate.id !== item.id);
        if (targetPart.defaultItemId === item.id) targetPart.defaultItemId = targetPart.items[0]?.id || null;
        pruneDeletedDefinitionReferences(next, { partId: part.id, itemId: item.id });
        replaceRecipeSelection(nextRecipe, { partId: part.id, itemId: '' });
        removeUnreferencedAssetMetadata(next);
      });
      this.selectedItemId = '';
      this.selectedStyleId = '';
      this.ensureCreatorSelection(this.store.getState().document);
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'add-style' && item) {
      this.executeDocument('Add Style', ({ document: next }) => {
        const targetPart = findPart(next, part.id);
        const targetItem = findItem(next, part.id, item.id);
        let inheritedTrackId = targetItem.styles.find((candidate) => candidate.id === targetItem.defaultStyleId)?.layerTrackId
          || targetItem.styles.find((candidate) => candidate.layerTrackId)?.layerTrackId
          || null;
        const linkage = partTrackLinkage(next, targetPart.id);
        inheritedTrackId ||= linkage.mode === 'linked' ? linkage.trackId : null;
        if (!inheritedTrackId) {
          const nextTrack = createLayerTrack(next, targetPart.name);
          next.layerTracks.push(nextTrack);
          inheritedTrackId = nextTrack.id;
        }
        const nextStyle = createStyle(targetItem, `Style ${targetItem.styles.length + 1}`);
        nextStyle.layerTrackId = inheritedTrackId;
        targetItem.styles.push(nextStyle);
        targetItem.defaultStyleId ||= nextStyle.id;
        this.selectedStyleId = nextStyle.id;
        this.selectedTrackId = inheritedTrackId;
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'copy-style' && style) {
      this.executeDocument('Duplicate Style', ({ document: next }) => {
        const duplicate = duplicateStyle(next, part.id, item.id, style.id);
        if (!duplicate) return;
        this.selectedStyleId = duplicate.id;
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'delete-style' && style && !style.styleLocked && this.confirmDelete(this.tr('deleteStyleConfirm', { name: style.name }))) {
      this.executeDocument('Delete Style', ({ document: next }) => {
        const targetItem = findItem(next, part.id, item.id);
        targetItem.styles = targetItem.styles.filter((candidate) => candidate.id !== style.id);
        if (targetItem.defaultStyleId === style.id) targetItem.defaultStyleId = targetItem.styles[0]?.id || null;
        pruneDeletedDefinitionReferences(next, {
          partId: part.id,
          itemId: item.id,
          styleId: style.id,
        });
        removeUnreferencedAssetMetadata(next);
        this.selectedStyleId = targetItem.defaultStyleId || targetItem.styles[0]?.id || '';
      });
      this.syncCreatorRecipeSelection();
      return;
    }
    if (action === 'set-default-style' && style && !style.styleLocked) {
      this.executeDocument('Set default Style', ({ document: next }) => {
        const targetItem = findItem(next, part.id, item.id);
        targetItem.defaultStyleId = style.id;
        const selection = next.defaultRecipe.selections.find((candidate) => candidate.partId === part.id && candidate.itemId === item.id);
        if (selection) selection.styleId = style.id;
      });
      return;
    }
    if (action === 'confirm-position' && style && !style.styleLocked && !style.positionLocked) {
      this.editingPositionStyleKey = '';
      this.executeDocument('Confirm Style position', ({ document: next }) => {
        const target = findStyle(next, part.id, item.id, style.id);
        target.positionConfirmed = true;
      });
      return;
    }
    if (action === 'edit-position' && style && !style.styleLocked && !style.positionLocked) {
      this.editingPositionStyleKey = styleSceneKey(part.id, item.id, style.id);
      this.render();
      return;
    }
    if (action === 'add-track') {
      const track = createLayerTrack(document, `Layer ${document.layerTracks.length + 1}`);
      this.selectedTrackId = track.id;
      this.executeDocument('Add Layer Track', ({ document: next }) => next.layerTracks.push(track));
      return;
    }
    if (action === 'move-track') {
      const index = document.layerTracks.findIndex((track) => track.id === button.dataset.trackId);
      const target = button.dataset.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= document.layerTracks.length
        || trackVisualOrderLocked(document, document.layerTracks[index].id)
        || trackVisualOrderLocked(document, document.layerTracks[target].id)) return;
      this.executeDocument('Reorder Layer Tracks', ({ document: next }) => {
        if (trackVisualOrderLocked(next, next.layerTracks[index]?.id)
          || trackVisualOrderLocked(next, next.layerTracks[target]?.id)) return;
        moveArrayEntry(next.layerTracks, index, target);
        synchronizeLinkedPartOrderFromTracks(next);
      });
      return;
    }
    if (action === 'sync-linked-track-order') {
      if (linkedTrackOrderSyncCrossesLock(document)) return;
      this.executeDocument('Sync linked Layer Tracks to Player menu', ({ document: next }) => {
        synchronizeLinkedTrackOrderFromParts(next);
      });
      return;
    }
    if (action === 'toggle-track-lock') {
      const trackId = button.dataset.trackId;
      this.executeDocument('Toggle Layer Track lock', ({ document: next }) => {
        const track = next.layerTracks.find((candidate) => candidate.id === trackId);
        if (track) track.locked = !track.locked;
      });
      return;
    }
    if (action === 'delete-track') {
      const trackId = button.dataset.trackId;
      const track = document.layerTracks.find((candidate) => candidate.id === trackId);
      if (!track || track.locked) return;
      const used = document.parts.some((candidate) => candidate.items.some((candidateItem) => candidateItem.styles.some((candidateStyle) => candidateStyle.layerTrackId === trackId)));
      if (!used) this.executeDocument('Delete Layer Track', ({ document: next }) => {
        const current = next.layerTracks.find((candidate) => candidate.id === trackId);
        if (!current?.locked) next.layerTracks = next.layerTracks.filter((candidate) => candidate.id !== trackId);
      });
      return;
    }
    if (action === 'approve-track-alignment') {
      const trackId = button.dataset.trackId;
      this.executeDocument('Approve Layer Track alignment exception', ({ document: next }) => {
        const track = next.layerTracks.find((candidate) => candidate.id === trackId);
        if (track) track.alignmentApproved = true;
      });
      return;
    }
    if (action === 'add-channel') {
      const channel = createGradientColorChannel(document, `Color ${document.colorChannels.length + 1}`);
      this.selectedChannelId = channel.id;
      this.executeDocument('Add Color Channel', ({ document: next }) => next.colorChannels.push(channel));
      return;
    }
    if (action === 'delete-channel') {
      const channelId = this.selectedChannelId;
      if (colorChannelHasLockedStyle(document, channelId)) return;
      this.executeDocument('Delete Color Channel', ({ document: next }) => {
        if (colorChannelHasLockedStyle(next, channelId)) return;
        next.colorChannels = next.colorChannels.filter((channel) => channel.id !== channelId);
        next.parts.forEach((candidate) => candidate.items.forEach((candidateItem) => candidateItem.styles.forEach((candidateStyle) => {
          if (candidateStyle.colorChannelId === channelId) {
            candidateStyle.colorChannelId = null;
          }
        })));
      });
      this.selectedChannelId = '';
      return;
    }
    if (action === 'add-swatch') {
      const channel = document.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      if (!channel || colorChannelHasLockedStyle(document, channel.id)) return;
      this.executeDocument('Add Color Preset', ({ document: next }) => {
        const target = next.colorChannels.find((candidate) => candidate.id === channel.id);
        if (!target || colorChannelHasLockedStyle(next, target.id)) return;
        const id = uniqueDocumentId(`color-${target.swatches.length + 1}`, [target.swatches], 'color');
        target.swatches.push({ id, name: `Color ${target.swatches.length + 1}`, hintColor: '#f06f8f', stops: target.mode === 'gradient-map' ? [{ offset: 0, color: '#3d101c' }, { offset: 0.5, color: '#f06f8f' }, { offset: 1, color: '#ffe8ef' }] : [] });
      });
      return;
    }
    if (action === 'delete-swatch') {
      const swatchId = button.dataset.swatchId;
      if (colorChannelHasLockedStyle(document, this.selectedChannelId)) return;
      this.executeDocument('Delete Color Preset', ({ document: next }) => {
        const target = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
        if (!target || target.swatches.length <= 1 || colorChannelHasLockedStyle(next, target.id)) return;
        target.swatches = target.swatches.filter((swatch) => swatch.id !== swatchId);
        if (target.defaultSwatchId === swatchId) target.defaultSwatchId = target.swatches[0]?.id || null;
      });
      return;
    }
    if (action === 'add-rule') return void this.addRuleFromBuilder();
    if (action === 'delete-rule') return void this.deleteRule(button.dataset.ruleId);
    if (action === 'add-expansion') {
      const pack = defaultExpansion(document, document.extensions.expansionDrafts.length);
      this.executeDocument('Add Expansion Pack', ({ document: next }) => {
        next.extensions.expansionDrafts.push(pack);
        next.expansionPacks.push({
          id: pack.packId,
          name: pack.name,
          version: 1,
          manifestIdentifier: MAKER_V4_MANIFEST_IDENTIFIER,
          content: {
            kind: 'embedded',
            runtime: MAKER_V4_EMBEDDED_EXPANSION_RUNTIME,
            container: MAKER_V4_EMBEDDED_EXPANSION_CONTAINER,
            packId: pack.packId,
          },
          baseMakerId: next.version.rootMakerId,
          baseMakerVersion: next.version.number,
          required: false,
        });
      });
      return;
    }
    if (action === 'toggle-expansion') {
      const packId = button.dataset.packId;
      const pack = document.extensions.expansionDrafts.find((candidate) => candidate.packId === packId);
      if (!pack || !checkExpansionPackCompatibility(document, pack).compatible) return;
      if (this.enabledExpansionIds.has(packId)) this.enabledExpansionIds.delete(packId);
      else this.enabledExpansionIds.add(packId);
      this.render();
      return;
    }
    if (action === 'delete-expansion') {
      const packId = button.dataset.packId;
      this.executeDocument('Delete Expansion Pack', ({ document: next }) => {
        next.extensions.expansionDrafts = next.extensions.expansionDrafts.filter((pack) => pack.packId !== packId);
        next.expansionPacks = next.expansionPacks.filter((pack) => pack.id !== packId);
      });
      this.enabledExpansionIds.delete(packId);
      return;
    }
    if (action === 'add-selected-to-expansion') return void this.addSelectedItemToExpansion(button.dataset.packId);
    if (action === 'set-default-recipe') {
      const creatorRecipe = clone(this.creatorRecipe || state.recipe);
      this.executeDocument('Set default recipe', ({ document: next, recipe: nextRecipe }) => {
        next.defaultRecipe = clone(creatorRecipe);
        Object.assign(nextRecipe, clone(creatorRecipe));
        const selections = recipeSelectionMap(creatorRecipe);
        next.parts.forEach((candidate) => {
          const selection = selections.get(candidate.id);
          if (!selection) return;
          candidate.defaultItemId = selection.itemId;
          const selectedItem = candidate.items.find((candidateItem) => candidateItem.id === selection.itemId);
          if (selectedItem) selectedItem.defaultStyleId = selection.styleId || selectedItem.defaultStyleId;
        });
        next.colorChannels.forEach((channel) => {
          const selection = creatorRecipe.colors?.find((entry) => entry.channelId === channel.id);
          if (selection) channel.defaultSwatchId = selection.swatchId;
        });
      });
      return;
    }
    if (action === 'set-version-compatibility') {
      const compatibility = button.dataset.compatibility === 'breaking' ? 'breaking' : 'compatible';
      this.executeDocument(`Mark update ${compatibility}`, ({ document: next }) => {
        next.version.compatibility = compatibility;
        next.version.compatibleFrom = compatibility === 'breaking'
          ? next.version.number
          : Number(this.context?.publishedDocument?.version?.compatibleFrom || 1);
      });
      return;
    }
    if (action === 'cancel-import') {
      this.pendingImport = null;
      this.render();
      return;
    }
    if (action === 'confirm-import') {
      this.confirmBatchImport();
    }
  }

  handleCreatorInput(event) {
    if (
      this.contextSwitchInProgress
      || this.restoreInProgress
      || this.restoreError
      || this.playerSessionSwitchInProgress
    ) return;
    const action = event.target.dataset.action;
    if (action === 'canvas-zoom') {
      this.setCreatorZoom(Number(event.target.value || 100) / 100);
      return;
    }
    if (this.documentMutationBlocked()) return;
    if (this.captureCreatorText(event.target)) {
      this.updateMakerInfoByteStatus(event.target);
      this.textAutosave();
      return;
    }
    if (action === 'style-scale-preview') {
      const { style } = this.selectedCreatorRecords();
      if (!style || style.positionLocked || style.styleLocked) return;
      this.styleScalePreview = Math.max(0.01, Number(event.target.value || 100) / 100);
      this.drawCreatorCanvas();
    }
  }

  async handleCreatorChange(event) {
    if (
      this.contextSwitchInProgress
      || this.restoreInProgress
      || this.restoreError
      || this.playerSessionSwitchInProgress
    ) return;
    const input = event.target;
    const action = input.dataset.action;
    if (!action || !this.store) return;
    if (this.documentMutationBlocked()) {
      this.callbacks.onMutationBlocked?.(this.documentMutationBlockedMessage());
      this.render();
      return;
    }
    if (this.captureCreatorText(input)) {
      this.updateMakerInfoByteStatus(input);
      this.flushPendingCreatorText();
      return;
    }
    const state = this.store.getState();
    const document = state.document;
    const { part, item, style } = this.selectedCreatorRecords(document);
    if (action === 'import-project' && input.files?.[0]) {
      await this.importProjectArchive(input.files[0]);
      input.value = '';
      return;
    }
    if (action === 'batch-import') {
      const files = [...(input.files || [])];
      if (!files.length || !item) return;
      const defaultStyle = item.styles.find((candidate) => candidate.id === item.defaultStyleId)
        || item.styles[0]
        || null;
      const inheritedTrackId = defaultStyle?.layerTrackId || this.selectedTrackId || document.layerTracks[0]?.id || '';
      const inheritedTrackName = document.layerTracks.find((track) => track.id === inheritedTrackId)?.name
        || `${part.name} layer`;
      this.pendingImport = {
        mode: 'item',
        partId: part.id,
        itemId: item.id,
        defaultStyleId: defaultStyle && !defaultStyle.assetId && !defaultStyle.styleLocked
          ? defaultStyle.id
          : '',
        mapping: buildAssetImportMapping(files, document.layerTracks).map((mapping, index) => ({
          ...mapping,
          trackId: inheritedTrackId,
          suggestedTrackName: inheritedTrackName,
          suggestedStyleName: safeFileName(mapping.fileName, `style-${index + 1}`).replaceAll('-', ' '),
        })),
      };
      this.render();
      return;
    }
    if (action === 'project-import') {
      const files = [...(input.files || [])].filter((file) => String(file.name || '').toLowerCase().endsWith('.png'));
      if (!files.length) return;
      this.pendingImport = {
        mode: 'project',
        mapping: buildProjectAssetImportMapping(files, document),
      };
      this.render();
      return;
    }
    if (action === 'import-target') {
      const mapping = this.pendingImport?.mapping[Number(input.dataset.importIndex)];
      if (mapping) {
        mapping.targetDefinition = input.value;
        this.render();
      }
      return;
    }
    if (action === 'import-track') {
      const mapping = this.pendingImport?.mapping[Number(input.dataset.importIndex)];
      if (mapping) {
        mapping.trackId = input.value;
        this.render();
      }
      return;
    }
    if (action === 'import-track-name') {
      const mapping = this.pendingImport?.mapping[Number(input.dataset.importIndex)];
      if (mapping) mapping.suggestedTrackName = input.value.trim() || mapping.suggestedTrackName;
      return;
    }
    if (action === 'import-style-name') {
      const mapping = this.pendingImport?.mapping[Number(input.dataset.importIndex)];
      if (mapping) mapping.suggestedStyleName = input.value.trim() || mapping.suggestedStyleName;
      return;
    }
    if (action === 'maker-cover' && input.files?.[0]) {
      const operation = this.captureMakerOperation();
      const asset = await this.importDisplayAsset(input.files[0], 'maker-cover', operation);
      input.value = '';
      if (!asset || !this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      this.executeDocument('Update Maker cover', ({ document: next }) => {
        addDocumentAsset(next, asset);
        next.metadata.coverAssetId = asset.assetId;
        removeUnreferencedAssetMetadata(next);
      });
      await this.flushCompletedAssetOperation(operation, 'maker-cover-import');
      return;
    }
    if (action === 'part-icon' && part && input.files?.[0]) {
      const operation = this.captureMakerOperation();
      const partId = part.id;
      const asset = await this.importDisplayAsset(input.files[0], 'part-icon', operation);
      if (!asset || !this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      this.executeDocument('Update Part icon', ({ document: next }) => {
        const target = findPart(next, partId);
        if (!target) return;
        addDocumentAsset(next, asset);
        target.iconAssetId = asset.assetId;
        removeUnreferencedAssetMetadata(next);
      });
      await this.flushCompletedAssetOperation(operation, 'part-icon-import');
      return;
    }
    if (action === 'item-thumbnail' && item && input.files?.[0]) {
      const operation = this.captureMakerOperation();
      const selection = { partId: part.id, itemId: item.id };
      const asset = await this.importDisplayAsset(input.files[0], 'thumbnail', operation);
      if (!asset || !this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      this.executeDocument('Update Item thumbnail', ({ document: next }) => {
        const target = findItem(next, selection.partId, selection.itemId);
        if (!target) return;
        addDocumentAsset(next, asset);
        target.thumbnailAssetId = asset.assetId;
        removeUnreferencedAssetMetadata(next);
      });
      await this.flushCompletedAssetOperation(operation, 'item-thumbnail-import');
      return;
    }
    if (action === 'style-asset' && style && !style.styleLocked && input.files?.[0]) {
      await this.replaceStyleAsset(input.files[0], { partId: part.id, itemId: item.id, styleId: style.id });
      return;
    }
    const bool = input.type === 'checkbox' ? input.checked : null;
    if (action === 'maker-license-kind') this.updateMakerSettings({ licenseKind: input.value });
    else if (action === 'part-name' && part) this.executeDocument('Rename Part', ({ document: next }) => { findPart(next, part.id).name = input.value.trim() || part.name; });
    else if (action === 'part-required' && part) this.executeDocument('Change required Part', ({ document: next }) => { findPart(next, part.id).required = bool; });
    else if (action === 'part-visible' && part) this.executeDocument('Change Part menu visibility', ({ document: next }) => { findPart(next, part.id).menuVisible = bool; });
    else if (action === 'part-export-background' && part) this.executeDocument('Change export background Part', ({ document: next }) => {
      const backgroundPartIds = this.playerBackgroundPartIds(next);
      if (bool) backgroundPartIds.add(part.id);
      else backgroundPartIds.delete(part.id);
      next.extensions ||= {};
      next.extensions.playerExport = {
        ...(next.extensions.playerExport || {}),
        backgroundPartIds: next.parts
          .map((candidate) => candidate.id)
          .filter((partId) => backgroundPartIds.has(partId)),
      };
    });
    else if (action === 'part-default' && part) this.executeDocument('Change default Item', ({ document: next }) => {
      const target = findPart(next, part.id);
      target.defaultItemId = input.value || null;
      const selectedItem = target.items.find((candidate) => candidate.id === target.defaultItemId);
      const selection = next.defaultRecipe.selections.find((candidate) => candidate.partId === target.id);
      if (selectedItem && selection) {
        selection.itemId = selectedItem.id;
        selection.styleId = selectedItem.defaultStyleId || selectedItem.styles[0]?.id;
      }
    });
    else if (action === 'item-name' && item) this.executeDocument('Rename Item', ({ document: next }) => { findItem(next, part.id, item.id).name = input.value.trim() || item.name; });
    else if (action === 'style-name' && style && !style.styleLocked) this.executeDocument('Rename Style', ({ document: next }) => { findStyle(next, part.id, item.id, style.id).name = input.value.trim() || style.name; });
    else if (action === 'style-locked' && style) {
      this.executeDocument(bool ? 'Lock Style' : 'Unlock Style', ({ document: next }) => {
        findStyle(next, part.id, item.id, style.id).styleLocked = bool;
      });
      if (bool) this.editingPositionStyleKey = '';
    } else if (action === 'style-position-locked' && style && !style.styleLocked) {
      this.executeDocument(bool ? 'Lock Style position' : 'Unlock Style position', ({ document: next }) => {
        findStyle(next, part.id, item.id, style.id).positionLocked = bool;
      });
      if (bool) this.editingPositionStyleKey = '';
    } else if (['style-x', 'style-y', 'style-scale', 'style-rotation'].includes(action) && style && !style.styleLocked && !style.positionLocked) {
      const field = action.replace('style-', '');
      this.executeDocument('Edit Style transform', ({ document: next }) => {
        const target = findStyle(next, part.id, item.id, style.id);
        if (!target || target.styleLocked || target.positionLocked) return;
        const transform = target.transform;
        if (!transform) return;
        const value = Number(input.value || (field === 'scale' ? 1 : 0));
        transform[field] = field === 'scale'
          ? Math.max(0.01, value)
          : ['x', 'y'].includes(field) && next.canvas.pixelMode === 'pixelated'
            ? Math.round(value)
            : value;
        target.positionConfirmed = false;
        this.editingPositionStyleKey = styleSceneKey(part.id, item.id, style.id);
      });
    } else if (action === 'style-scale-preview' && style && !style.styleLocked && !style.positionLocked) {
      const scale = Math.max(0.01, Number(input.value || 100) / 100);
      this.styleScalePreview = null;
      this.executeDocument('Scale Style on Canvas', ({ document: next }) => {
        const target = findStyle(next, part.id, item.id, style.id);
        if (!target || target.styleLocked || target.positionLocked) return;
        const transform = target.transform;
        if (!transform) return;
        transform.scale = scale;
        target.positionConfirmed = false;
        this.editingPositionStyleKey = styleSceneKey(part.id, item.id, style.id);
      });
    } else if (action === 'style-opacity' && style && !style.styleLocked) this.executeDocument('Change Style opacity', ({ document: next }) => { findStyle(next, part.id, item.id, style.id).opacity = Number(input.value || 0) / 100; });
    else if (action === 'style-blend' && style && !style.styleLocked) this.executeDocument('Change Style blend mode', ({ document: next }) => { findStyle(next, part.id, item.id, style.id).blendMode = input.value; });
    else if (action === 'style-channel' && style && !style.styleLocked) this.executeDocument('Link Style smart color', ({ document: next }) => {
      const target = findStyle(next, part.id, item.id, style.id);
      const channel = next.colorChannels.find((candidate) => candidate.id === input.value && candidate.mode === 'gradient-map');
      target.colorChannelId = channel?.id || null;
    });
    else if (
      action === 'style-visible-when'
      && style
      && !style.styleLocked
      && simpleVisibleWhenPartId(style.visibleWhen) !== null
    ) this.executeDocument('Change Style visibility rule', ({ document: next }) => {
      findStyle(next, part.id, item.id, style.id).visibleWhen = input.value ? { op: 'selected', partId: input.value } : null;
    });
    else if (action === 'assign-style-track' && style && !style.styleLocked) {
      const trackId = document.layerTracks.some((candidate) => candidate.id === input.value) ? input.value : null;
      this.executeDocument('Assign Style Layer Track', ({ document: next }) => {
        const target = findStyle(next, part.id, item.id, style.id);
        if (!target || target.styleLocked) return;
        target.layerTrackId = trackId;
      });
      this.selectedTrackId = trackId || this.selectedTrackId;
    }
    else if (action === 'track-name') this.executeDocument('Rename Layer Track', ({ document: next }) => {
      const track = next.layerTracks.find((candidate) => candidate.id === input.dataset.trackId);
      if (track && !track.locked) track.name = input.value.trim() || track.name;
    });
    else if (action === 'channel-name' && !colorChannelHasLockedStyle(document, this.selectedChannelId)) this.executeDocument('Rename Color Channel', ({ document: next }) => {
      const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      if (channel && !colorChannelHasLockedStyle(next, channel.id)) channel.name = input.value.trim() || channel.name;
    });
    else if (
      action === 'channel-default-swatch'
      && !colorChannelHasLockedStyle(document, this.selectedChannelId)
      && document.colorChannels
        .find((channel) => channel.id === this.selectedChannelId)
        ?.swatches.some((swatch) => swatch.id === input.value)
    ) this.executeDocument('Change default color', ({ document: next }) => {
      const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      if (
        !channel
        || colorChannelHasLockedStyle(next, channel.id)
        || !channel.swatches.some((swatch) => swatch.id === input.value)
      ) return;
      channel.defaultSwatchId = input.value;
      const selection = next.defaultRecipe.colors.find((entry) => entry.channelId === channel.id);
      if (selection) selection.swatchId = input.value;
    });
    else if (['swatch-name', 'swatch-hint', 'swatch-stop', 'swatch-mid'].includes(action)
      && !colorChannelHasLockedStyle(document, this.selectedChannelId)) {
      this.executeDocument('Edit smart color preset', ({ document: next }) => {
        const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
        if (!channel || colorChannelHasLockedStyle(next, channel.id)) return;
        const swatch = channel?.swatches.find((candidate) => candidate.id === input.dataset.swatchId);
        if (!swatch) return;
        if (action === 'swatch-name') swatch.name = input.value.trim() || swatch.name;
        else if (action === 'swatch-hint') swatch.hintColor = input.value;
        else if (action === 'swatch-stop') {
          const stop = swatch.stops[Number(input.dataset.stopIndex)];
          if (stop) stop.color = input.value;
        }
        else {
          if (!swatch.stops.length) {
            swatch.stops = [
              { offset: 0, color: input.value },
              { offset: 1, color: input.value },
            ];
            return;
          }
          if (swatch.stops.length === 1) {
            swatch.stops.push({ offset: 1, color: input.value });
            swatch.stops[0].offset = 0;
            return;
          }
          const middle = Math.floor((swatch.stops.length - 1) / 2);
          if (swatch.stops.length === 2) swatch.stops.splice(1, 0, { offset: 0.5, color: input.value });
          else swatch.stops[middle].color = input.value;
        }
      });
    }
  }

  async importDisplayAsset(file, kind, operation = this.captureMakerOperation()) {
    if (this.documentMutationBlocked()) return null;
    const mediaType = String(file?.type || '').toLowerCase();
    if (!file || !['image/png', 'image/jpeg'].includes(mediaType)) {
      throw new Error(this.tr('chooseDisplayImage'));
    }
    if (Number(file.size || 0) > 5 * 1024 * 1024) throw new Error(this.tr('displayAssetTooLarge'));
    const bitmap = await createImageBitmap(file);
    let dimensions;
    try {
      dimensions = assertMakerAssetDimensions(bitmap, file.name || kind);
    } finally {
      bitmap.close();
    }
    const { width, height } = dimensions;
    if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return null;
    const assetId = createAssetId(kind);
    const record = runtimeAssetRecord({ assetId, blob: file, fileName: file.name, width, height, source: 'local' });
    record.kind = kind;
    record.identifier = `${safeFileName(file.name, assetId)}-${assetId.slice(-8)}.${String(file.type).includes('jpeg') ? 'jpg' : 'png'}`;
    this.assets.set(assetId, record);
    this.assetResolver.clear();
    this.assetResolver = createCachedAssetResolver(this.assets);
    return record;
  }

  async exportProjectArchive() {
    if (!this.store) return;
    const operation = this.captureMakerOperation();
    const state = operation.store.getState();
    const wasDirty = state.dirty;
    const document = clone(state.document);
    const assets = new Map(this.assets);
    operation.store.setSaveState('saving', this.tr('projectPacking'));
    try {
      const blob = await createMakerProjectArchive(document, assets);
      if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = `${safeFileName(document.metadata.name, document.metadata.id)}.animacraft-maker.zip`;
      link.click();
      URL.revokeObjectURL(url);
      operation.store.setSaveState(wasDirty ? 'dirty' : 'saved', this.tr('projectBackupDownloaded'));
    } catch (error) {
      if (this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
        operation.store.setSaveState('error', error.message || this.tr('projectExportFailed'));
      }
    }
  }

  async importProjectArchive(file) {
    if (!this.store || this.documentMutationBlocked()) return;
    const operation = this.captureMakerOperation();
    operation.store.setSaveState('saving', this.tr('projectReading'));
    try {
      const imported = await readMakerProjectArchive(file);
      if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      if (!isMakerV5Document(imported.document)) throw new Error(this.tr('projectRequiresV5'));
      const document = this.normalizeDocument(imported.document);
      const styleAssetIds = new Set(workspaceStyleRecords(document)
        .map(({ style }) => String(style.assetId || ''))
        .filter(Boolean));
      const verifiedAssets = await Promise.all(imported.assets.map(async (record) => {
        if (!styleAssetIds.has(String(record.assetId || '')) || !record.blob) return record;
        // Project archives are untrusted input, including archives produced by
        // older Animacraft versions. Re-read the PNG pixels instead of trusting
        // optional dimensions/alpha flags from project.json.
        const inspection = await inspectPngAsset(record.blob, document.canvas);
        const descriptor = workspaceAssetDescriptor(document, record.assetId);
        if (descriptor) {
          descriptor.width = inspection.width;
          descriptor.height = inspection.height;
          descriptor.mediaType = 'image/png';
        }
        return {
          ...record,
          width: inspection.width,
          height: inspection.height,
          alphaBounds: inspection.alphaBounds,
          alphaAnalyzed: inspection.alphaAnalyzed,
          hasVisiblePixels: inspection.hasVisiblePixels,
        };
      }));
      if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
      this.assetResolver.clear();
      this.assets.forEach(revokeRuntimeAsset);
      this.assets = new Map(verifiedAssets.map((record) => [
        record.assetId,
        record.url && !record.blob ? { ...record } : reviveRuntimeAssetRecord(record),
      ]));
      this.assetResolver = createCachedAssetResolver(this.assets);
      const recipe = recipeWithColors(document, document.defaultRecipe);
      this.creatorRecipe = clone(recipe);
      operation.store.replace(document, recipe, { clearHistory: true, markSaved: false });
      operation.store.setSaveState('dirty', this.tr('projectImported', {
        source: imported.exportedAt || this.tr('projectAnotherWorkspace'),
      }));
      this.autosave();
      await this.flushCompletedAssetOperation(operation, 'project-archive-import');
    } catch (error) {
      if (this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
        operation.store.setSaveState('error', error.message || this.tr('projectImportFailed'));
      }
    }
  }

  async replaceStyleAsset(file, selection) {
    if (this.documentMutationBlocked()) return;
    const operation = this.captureMakerOperation();
    if (!operation.store) return;
    const selectedTrackId = this.selectedTrackId;
    const inspection = await inspectPngAsset(file, operation.store.getState().document.canvas);
    if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
    const thumbnailBlob = await createAlphaCroppedThumbnail(file);
    if (!this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) return;
    const currentStyle = findStyle(operation.store.getState().document, selection.partId, selection.itemId, selection.styleId);
    if (!currentStyle || currentStyle.styleLocked) return;
    const assetId = createAssetId(file.name);
    const record = runtimeAssetRecord({
      assetId,
      blob: file,
      fileName: file.name,
      width: inspection.width,
      height: inspection.height,
      alphaBounds: inspection.alphaBounds,
      alphaAnalyzed: inspection.alphaAnalyzed,
      hasVisiblePixels: inspection.hasVisiblePixels,
      thumbnailBlob,
    });
    record.kind = 'style';
    record.identifier = `${safeFileName(file.name, assetId)}-${assetId.slice(-8)}.png`;
    this.assets.set(assetId, record);
    this.assetResolver.clear();
    this.assetResolver = createCachedAssetResolver(this.assets);
    const keepPosition = currentStyle.positionLocked;
    this.editingPositionStyleKey = keepPosition
      ? ''
      : styleSceneKey(selection.partId, selection.itemId, selection.styleId);
    this.executeDocument('Replace Style PNG', ({ document }) => {
      addDocumentAsset(document, record);
      const style = findStyle(document, selection.partId, selection.itemId, selection.styleId);
      if (!style || style.styleLocked) return;
      const previousAssetId = style.assetId;
      style.assetId = assetId;
      if (!document.layerTracks.some((candidate) => candidate.id === style.layerTrackId)) {
        let track = document.layerTracks.find((candidate) => candidate.id === selectedTrackId)
          || document.layerTracks[0];
        if (!track) {
          track = createLayerTrack(document, 'Layer 1');
          document.layerTracks.push(track);
        }
        style.layerTrackId = track.id;
      }
      const track = document.layerTracks.find((candidate) => candidate.id === style.layerTrackId);
      if (track) {
        track.alignmentApproved = false;
        if (!track.referenceAssetId || track.referenceAssetId === previousAssetId) track.referenceAssetId = assetId;
      }
      if (!style.positionLocked) {
        style.transform = {
          x: inspection.initialTransform.x,
          y: inspection.initialTransform.y,
          scale: inspection.initialTransform.scale,
          rotation: 0,
        };
        style.positionConfirmed = false;
      }
      removeUnreferencedAssetMetadata(document);
    });
    await this.flushCompletedAssetOperation(operation, 'style-png-import');
  }

  async confirmBatchImport() {
    const pending = this.pendingImport;
    if (!pending || !this.store || this.documentMutationBlocked()) return;
    const operation = this.captureMakerOperation();
    let prepared = [];
    const createdRecords = [];
    let documentCommitted = false;
    operation.store.setSaveState('saving', this.tr('inspectingPngs', { count: pending.mapping.length }));
    try {
      if (pending.mode === 'project') {
        const targetKeys = pending.mapping.map((mapping) => mapping.targetDefinition);
        if (new Set(targetKeys).size !== targetKeys.length) {
          throw new Error(this.tr('projectDuplicateStyleMapping'));
        }
        const currentDocument = operation.store.getState().document;
        pending.mapping.forEach((mapping) => {
          const [partId, itemId, styleId] = String(mapping.targetDefinition || '').split('::');
          const targetStyle = findStyle(currentDocument, partId, itemId, styleId);
          if (!targetStyle) {
            throw new Error(this.tr('projectInvalidStyleTarget', { file: mapping.fileName }));
          }
          if (targetStyle.styleLocked) {
            throw new Error(this.tr('projectLockedStyleTarget', { style: targetStyle.name }));
          }
        });
      }
      const canvas = operation.store.getState().document.canvas;
      prepared = await Promise.all(pending.mapping.map(async (mapping) => {
        const inspection = await inspectPngAsset(mapping.file, canvas);
        const thumbnailBlob = await createAlphaCroppedThumbnail(mapping.file);
        const assetId = createAssetId(mapping.fileName);
        const record = runtimeAssetRecord({
          assetId,
          blob: mapping.file,
          fileName: mapping.fileName,
          width: inspection.width,
          height: inspection.height,
          alphaBounds: inspection.alphaBounds,
          alphaAnalyzed: inspection.alphaAnalyzed,
          hasVisiblePixels: inspection.hasVisiblePixels,
          thumbnailBlob,
        });
        record.kind = 'style';
        record.identifier = `${safeFileName(mapping.fileName, assetId)}-${assetId.slice(-8)}.png`;
        const result = { mapping, inspection, record };
        createdRecords.push(result);
        return result;
      }));
      if (
        this.pendingImport !== pending
        || !this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)
      ) {
        createdRecords.forEach(({ record }) => revokeRuntimeAsset(record));
        return;
      }
      prepared.forEach(({ record }) => this.assets.set(record.assetId, record));
      this.assetResolver.clear();
      this.assetResolver = createCachedAssetResolver(this.assets);
      this.executeDocument(`Batch import ${prepared.length} Style PNGs`, ({ document }) => {
        const newTrackByName = new Map();
        prepared.forEach(({ mapping, inspection, record }, preparedIndex) => {
          const [partId, itemId, requestedStyleId] = String(mapping.targetDefinition || `${pending.partId}::${pending.itemId}`).split('::');
          const targetItem = findItem(document, partId, itemId);
          if (!targetItem) throw new Error(this.tr('projectInvalidItemTarget', { file: mapping.fileName }));
          let targetStyle = requestedStyleId ? findStyle(document, partId, itemId, requestedStyleId) : null;
          if (
            pending.mode === 'item'
            && preparedIndex === 0
            && pending.defaultStyleId
          ) {
            const emptyDefault = findStyle(document, partId, itemId, pending.defaultStyleId);
            if (emptyDefault && !emptyDefault.assetId) targetStyle = emptyDefault;
          }
          if (pending.mode === 'project' && !targetStyle) {
            throw new Error(this.tr('projectInvalidStyleTarget', { file: mapping.fileName }));
          }
          if (targetStyle?.styleLocked) {
            throw new Error(this.tr('projectLockedStyleTarget', { style: targetStyle.name }));
          }
          if (!targetStyle) {
            targetStyle = createStyle(targetItem, mapping.suggestedStyleName || safeFileName(mapping.fileName, `Style ${targetItem.styles.length + 1}`));
            targetItem.styles.push(targetStyle);
            targetItem.defaultStyleId ||= targetStyle.id;
          }
          let trackId = mapping.trackId;
          const proposedTrackName = mapping.suggestedTrackName || `Layer ${document.layerTracks.length + 1}`;
          if (!trackId && newTrackByName.has(proposedTrackName)) trackId = newTrackByName.get(proposedTrackName);
          if (!trackId || !document.layerTracks.some((track) => track.id === trackId)) {
            const track = createLayerTrack(document, proposedTrackName);
            document.layerTracks.push(track);
            trackId = track.id;
            newTrackByName.set(proposedTrackName, trackId);
          }
          addDocumentAsset(document, record);
          targetStyle.layerTrackId = trackId;
          targetStyle.assetId = record.assetId;
          if (!targetStyle.positionLocked) {
            targetStyle.transform = {
              x: inspection.initialTransform.x,
              y: inspection.initialTransform.y,
              scale: inspection.initialTransform.scale,
              rotation: 0,
            };
            targetStyle.positionConfirmed = false;
          }
          if (!targetStyle.positionLocked) {
            this.editingPositionStyleKey = styleSceneKey(partId, itemId, targetStyle.id);
          }
          const targetTrack = document.layerTracks.find((candidate) => candidate.id === trackId);
          if (targetTrack) {
            targetTrack.alignmentApproved = false;
            targetTrack.referenceAssetId ||= record.assetId;
          }
          this.selectedPartId = partId;
          this.selectedItemId = itemId;
          this.selectedStyleId = targetStyle.id;
        });
        removeUnreferencedAssetMetadata(document);
      });
      documentCommitted = true;
      this.pendingImport = null;
      this.syncCreatorRecipeSelection();
      operation.store.setSaveState('dirty', this.tr('importedPngs', { count: prepared.length }));
      this.render();
      await this.flushCompletedAssetOperation(operation, 'batch-png-import');
    } catch (error) {
      if (!documentCommitted && createdRecords.length) {
        createdRecords.forEach(({ record }) => {
          if (this.assets.get(record.assetId) === record) this.assets.delete(record.assetId);
          revokeRuntimeAsset(record);
        });
        this.assetResolver.clear();
        this.assetResolver = createCachedAssetResolver(this.assets);
      }
      if (this.isCurrentMakerOperation(operation.makerKey, operation.store, operation.contextEpoch)) {
        operation.store.setSaveState('error', error.message || this.tr('batchImportFailed'));
      }
    }
  }

  addRuleFromBuilder() {
    const document = this.store.getState().document;
    const ownerDefinition = this.creatorRoot.querySelector('#v4RuleOwnerDefinition')?.value || this.selectedPartId;
    const requestedType = this.creatorRoot.querySelector('#v4RuleType')?.value || 'excludes';
    const type = requestedType === 'requires' ? 'requires' : 'excludes';
    const matchMode = this.creatorRoot.querySelector('#v4RuleMatchMode')?.value === 'any' ? 'any' : 'all';
    const targetPicker = this.creatorRoot.querySelector('#v4RuleTargetDefinitions');
    const legacyTarget = this.creatorRoot.querySelector('#v4RuleTargetDefinition')?.value || '';
    const definitions = targetPicker?.selectedOptions
      ? [...targetPicker.selectedOptions].map((option) => option.value).filter(Boolean)
      : [targetPicker?.value || legacyTarget].filter(Boolean);
    if (!ownerDefinition || !definitions.length) return;
    const currentOwner = ruleOwnerFromDefinition(document, ownerDefinition);
    if (!currentOwner || currentOwner.styleLocked) return;
    const selectors = definitions.map((definition) => {
      const [partId = '', itemId = '', styleId = ''] = String(definition).split('::');
      return {
        partId,
        ...(itemId ? { itemId } : {}),
        ...(styleId ? { styleId } : {}),
      };
    });
    let targets;
    try {
      targets = composeRuleTargets(selectors, matchMode);
    } catch (error) {
      this.ruleBuilderError = error?.code === 'cross-part-any-rule'
        ? this.tr('ruleAnySamePartError')
        : error?.code === 'ambiguous-any-style-rule'
          ? this.tr('ruleAnySameItemError')
          : error.message;
      this.render();
      return;
    }
    const [ownerPartId = '', ownerItemId = '', ownerStyleId = ''] = String(ownerDefinition).split('::');
    const ownerKey = ruleSelectorKey({
      partId: ownerPartId,
      ...(ownerItemId ? { itemId: ownerItemId } : {}),
      ...(ownerStyleId ? { styleId: ownerStyleId } : {}),
    });
    if (targets.some((target) => ruleSelectorKey(target) === ownerKey)) return;
    this.ruleBuilderError = '';
    this.executeDocument(`Add ${type} rule`, ({ document: next }) => {
      const owner = ruleOwnerFromDefinition(next, ownerDefinition);
      if (!owner || owner.styleLocked) return;
      owner[type] ||= [];
      const existing = new Set(owner[type].map(ruleSelectorKey));
      targets.forEach((target) => {
        const key = ruleSelectorKey(target);
        if (existing.has(key)) return;
        owner[type].push(target);
        existing.add(key);
      });
    });
  }

  deleteRule(ruleId) {
    const currentDocument = this.store.getState().document;
    const row = ownerRuleRows(currentDocument).find((candidate) => candidate.id === ruleId);
    if (!row) return;
    const currentOwnerStyle = row.ownerStyleId ? findStyle(currentDocument, row.ownerPartId, row.ownerItemId, row.ownerStyleId) : null;
    if (currentOwnerStyle?.styleLocked) return;
    this.executeDocument('Delete selection rule', ({ document }) => {
      const ownerPart = findPart(document, row.ownerPartId);
      const ownerItem = row.ownerItemId ? findItem(document, row.ownerPartId, row.ownerItemId) : null;
      const ownerStyle = row.ownerStyleId ? findStyle(document, row.ownerPartId, row.ownerItemId, row.ownerStyleId) : null;
      if (ownerStyle?.styleLocked) return;
      const owner = ownerStyle || ownerItem || ownerPart;
      owner[row.type].splice(row.index, 1);
    });
  }

  addSelectedItemToExpansion(packId) {
    const state = this.store.getState();
    const document = state.document;
    const part = findPart(document, this.selectedPartId);
    const item = findItem(document, this.selectedPartId, this.selectedItemId);
    if (!part || !item) return;
    this.executeDocument('Add Item to Expansion Pack', ({ document: next }) => {
      const pack = next.extensions.expansionDrafts.find((candidate) => candidate.packId === packId);
      if (!pack) return;
      let extension = pack.parts.find((candidate) => candidate.extendsPartId === part.id);
      if (!extension) {
        extension = { id: `extend-${part.id}`, name: `${part.name} additions`, extendsPartId: part.id, items: [] };
        pack.parts.push(extension);
      }
      const copy = clone(item);
      copy.id = uniqueDocumentId(`${item.id}-pack`, [extension.items], 'pack-item');
      copy.name = `${item.name} Pack`;
      copy.importKey = copy.id;
      rewriteExpansionOwnerSelfReferences(copy, part.id, item.id, copy.id);
      copy.styles.forEach((copiedStyle) => {
        rewriteExpansionOwnerSelfReferences(copiedStyle, part.id, item.id, copy.id);
      });
      extension.items.push(copy);
      const styles = copy.styles;
      const trackIds = new Set(styles.map((candidate) => candidate.layerTrackId).filter(Boolean));
      const assetIds = new Set(styles.map((candidate) => candidate.assetId).filter(Boolean));
      const channelIds = new Set(styles.map((candidate) => candidate.colorChannelId).filter(Boolean));
      next.layerTracks.filter((track) => trackIds.has(track.id)).forEach((track) => {
        if (!pack.layerTracks.some((candidate) => candidate.id === track.id)) pack.layerTracks.push(clone(track));
      });
      next.assets.filter((asset) => assetIds.has(asset.id)).forEach((asset) => {
        if (!pack.assets.some((candidate) => candidate.id === asset.id)) pack.assets.push(clone(asset));
      });
      next.colorChannels.filter((channel) => channelIds.has(channel.id)).forEach((channel) => {
        if (!pack.colorChannels.some((candidate) => candidate.id === channel.id)) pack.colorChannels.push(clone(channel));
      });
    });
  }

  handleDragStart(event) {
    if (this.documentMutationBlocked()) {
      event.preventDefault();
      this.dragSort = null;
      return;
    }
    const target = event.target.closest('[data-drag-kind]');
    if (!target) return;
    const document = this.store?.getState().document;
    if (target.dataset.dragKind === 'track') {
      const track = document?.layerTracks.find((candidate) => candidate.id === target.dataset.dragId);
      if (!track || trackVisualOrderLocked(document, track.id)) {
        event.preventDefault();
        this.dragSort = null;
        return;
      }
    }
    if (target.dataset.dragKind === 'style') {
      const [partId, itemId] = String(target.dataset.parentId || '').split('/');
      const style = document ? findStyle(document, partId, itemId, target.dataset.dragId) : null;
      if (!style || style.styleLocked) {
        event.preventDefault();
        this.dragSort = null;
        return;
      }
    }
    this.dragSort = {
      kind: target.dataset.dragKind,
      id: target.dataset.dragId,
      parentId: target.dataset.parentId || '',
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(this.dragSort));
  }

  handleDragOver(event) {
    if (event.target.closest('[data-drag-kind]')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  handleDrop(event) {
    if (this.documentMutationBlocked()) {
      event.preventDefault();
      this.dragSort = null;
      return;
    }
    const target = event.target.closest('[data-drag-kind]');
    if (!target || !this.dragSort || target.dataset.dragKind !== this.dragSort.kind) return;
    event.preventDefault();
    const targetId = target.dataset.dragId;
    const source = this.dragSort;
    this.dragSort = null;
    if (!targetId || targetId === source.id) return;
    if (source.kind === 'part') {
      const currentDocument = this.store.getState().document;
      const from = currentDocument.parts.findIndex((entry) => entry.id === source.id);
      const to = currentDocument.parts.findIndex((entry) => entry.id === targetId);
      if (from < 0 || to < 0 || partMoveCrossesLockedLinkedTrack(currentDocument, from, to)) return;
    } else if (source.kind === 'track' || source.kind === 'style') {
      const currentDocument = this.store.getState().document;
      let currentEntries = currentDocument.layerTracks;
      if (source.kind === 'style') {
        const [partId, itemId] = source.parentId.split('/');
        currentEntries = findItem(currentDocument, partId, itemId)?.styles || [];
      }
      const from = currentEntries.findIndex((entry) => entry.id === source.id);
      const to = currentEntries.findIndex((entry) => entry.id === targetId);
      const movedRange = currentEntries.slice(Math.min(from, to), Math.max(from, to) + 1);
      const rangeLocked = source.kind === 'track'
        ? movedRange.some((entry) => trackVisualOrderLocked(currentDocument, entry.id))
        : movedRange.some((entry) => entry.styleLocked);
      if (from < 0 || to < 0 || rangeLocked) return;
    }
    this.executeDocument(`Reorder ${source.kind}`, ({ document }) => {
      let entries = [];
      if (source.kind === 'part') entries = document.parts;
      else if (source.kind === 'track') entries = document.layerTracks;
      else if (source.kind === 'item') entries = findPart(document, source.parentId)?.items || [];
      else if (source.kind === 'style') {
        const [partId, itemId] = source.parentId.split('/');
        entries = findItem(document, partId, itemId)?.styles || [];
      }
      const from = entries.findIndex((entry) => entry.id === source.id);
      const to = entries.findIndex((entry) => entry.id === targetId);
      if (source.kind === 'part' && partMoveCrossesLockedLinkedTrack(document, from, to)) return;
      if (source.kind === 'track' || source.kind === 'style') {
        const movedRange = entries.slice(Math.min(from, to), Math.max(from, to) + 1);
        const rangeLocked = source.kind === 'track'
          ? movedRange.some((entry) => trackVisualOrderLocked(document, entry.id))
          : movedRange.some((entry) => entry.styleLocked);
        if (from < 0 || to < 0 || rangeLocked) return;
      }
      moveArrayEntry(entries, from, to);
      if (source.kind === 'part') synchronizeLinkedTrackOrderFromParts(document);
      else if (source.kind === 'track') synchronizeLinkedPartOrderFromTracks(document);
    });
  }

  playerStatePayload(document = this.runtimeDocument()) {
    return {
      document,
      recipe: this.playerRecipe,
      profile: this.playerProfile,
      livingContent: this.resolvedPlayerLivingContent(document)?.content || null,
    };
  }

  setPlayerRecipe(nextRecipe, label) {
    const normalized = recipeWithColors(this.runtimeDocument(), nextRecipe);
    if (JSON.stringify(normalized) === JSON.stringify(this.playerRecipe)) return false;
    const previous = clone(this.playerRecipe);
    this.playerUndo.push({ label, recipe: previous });
    if (this.playerUndo.length > 100) this.playerUndo.shift();
    this.playerRedo = [];
    this.playerRecipe = normalized;
    this.markPlayerSessionDirty();
    this.sessionAutosave();
    this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload());
    this.render();
    return true;
  }

  handlePlayerClick(event) {
    if (
      this.contextSwitchInProgress
      || this.restoreInProgress
      || this.restoreError
      || this.playerSessionSwitchInProgress
    ) return;
    const button = event.target.closest('[data-action]');
    if (!button || button.matches('input,select,textarea,label')) return;
    const action = button.dataset.action;
    const document = this.runtimeDocument();
    if (!document) return;
    if (
      button.disabled
      || button.matches?.(':disabled')
      || button.getAttribute?.('aria-disabled') === 'true'
    ) return;
    if (
      action === 'close-player-export'
      || (action === 'close-player-export-backdrop' && event.target === button)
    ) {
      this.closePlayerExport();
      return;
    }
    if (action === 'player-export-size') {
      const mode = button.dataset.sizeMode;
      if (!this.playerExportOpen || !['standard', 'original'].includes(mode)) return;
      if (this.playerExportState === 'rendering') return;
      if (
        mode === 'original'
        && !isPlayerOriginalExportSafe(this.playerExportSnapshot?.document?.canvas)
      ) return;
      if (this.playerExportSizeMode === mode && this.playerExportState !== 'error') return;
      this.playerExportSizeMode = mode;
      void this.preparePlayerExportPreview({
        focusSelector: `[data-action="player-export-size"][data-size-mode="${mode}"]`,
      });
      return;
    }
    if (action === 'player-export-background') {
      if (!this.playerExportOpen) return;
      if (this.playerExportState === 'rendering') return;
      const transparent = button.dataset.transparent === 'true';
      if (this.playerExportTransparent === transparent && this.playerExportState !== 'error') return;
      this.playerExportTransparent = transparent;
      void this.preparePlayerExportPreview({
        focusSelector: `[data-action="player-export-background"][data-transparent="${transparent}"]`,
      });
      return;
    }
    if (action === 'player-export-retry') {
      void this.preparePlayerExportPreview({
        focusSelector: '[data-action="player-export-retry"]',
      });
      return;
    }
    if (action === 'player-download-png') {
      this.downloadPlayerExport();
      return;
    }
    if (action === 'player-export-recipe') {
      this.exportPlayerRecipe();
      return;
    }
    if (action === 'player-copy-maker-link') {
      void this.sharePlayerMaker();
      return;
    }
    if (action === 'player-share-maker') {
      void this.sharePlayerMaker({ native: true });
      return;
    }
    if (action === 'player-confirm-complete') {
      this.completePlayerExport();
      return;
    }
    if (action === 'player-reset-soul-document') {
      const soulDocument = SOUL_CONFIG_DOCUMENTS.find(
        (entry) => entry.key === button.dataset.soulKey,
      );
      if (!soulDocument
        || !this.confirmDelete(this.tr('playerSoulRestoreDocumentConfirm', {
          filename: soulDocument.filename,
        }))
        || !this.resetPlayerLivingContent(soulDocument.key, document)) return;
      this.markPlayerSessionDirty();
      this.sessionAutosave();
      this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload(document));
      this.updatePlayerSoulConfigurationUi();
      this.updatePlayerCompletionUi();
      return;
    }
    if (action === 'player-reset-all-soul') {
      if (!this.confirmDelete(this.tr('playerSoulRestoreAllConfirm'))
        || !this.resetPlayerLivingContent(null, document)) return;
      this.markPlayerSessionDirty();
      this.sessionAutosave();
      this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload(document));
      this.updatePlayerSoulConfigurationUi();
      this.updatePlayerCompletionUi();
      return;
    }
    const parts = this.activePlayerParts(document);
    const part = parts.find((candidate) => candidate.id === this.playerPartId) || parts[0];
    const selections = recipeSelectionMap(this.playerRecipe);
    const current = selections.get(part?.id);
    const item = part?.items.find((candidate) => candidate.id === current?.itemId);
    if (action === 'player-part') {
      this.playerPartId = button.dataset.partId;
      this.render();
      return;
    }
    if (action === 'player-item' && part) {
      const nextItem = part.items.find((candidate) => candidate.id === button.dataset.itemId);
      if (!nextItem) return;
      const option = evaluatePlayerItemOption(
        document,
        this.playerRecipe,
        { partId: part.id, itemId: nextItem.id },
        this.playerOptionSettings(document),
      );
      if (!option.selectable || !option.nextRecipe) return;
      this.setPlayerRecipe(option.nextRecipe, `Choose ${nextItem.name}`);
      return;
    }
    if (action === 'player-style' && part && item) {
      const option = evaluatePlayerStyleOption(
        document,
        this.playerRecipe,
        { partId: part.id, itemId: item.id, styleId: button.dataset.styleId },
        this.playerOptionSettings(document),
      );
      if (!option.selectable || !option.nextRecipe) return;
      this.setPlayerRecipe(option.nextRecipe, `Choose style ${button.textContent.trim()}`);
      return;
    }
    if (action === 'player-none' && part && !part.required) {
      const option = evaluatePlayerRemovePartOption(
        document,
        this.playerRecipe,
        part.id,
        this.playerOptionSettings(document),
      );
      if (!option.selectable || !option.nextRecipe) return;
      this.setPlayerRecipe(option.nextRecipe, `Remove ${part.name}`);
      return;
    }
    if (action === 'player-color') {
      const next = clone(this.playerRecipe);
      next.colors ||= [];
      const index = next.colors.findIndex((entry) => entry.channelId === button.dataset.channelId);
      const selection = { channelId: button.dataset.channelId, swatchId: button.dataset.swatchId };
      if (index >= 0) next.colors[index] = selection;
      else next.colors.push(selection);
      this.setPlayerRecipe(next, 'Change color');
      return;
    }
    if (action === 'player-undo') {
      const command = this.playerUndo.pop();
      if (!command) return;
      this.playerRedo.push({ label: command.label, recipe: clone(this.playerRecipe) });
      this.playerRecipe = command.recipe;
      this.markPlayerSessionDirty();
      this.sessionAutosave();
      this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload());
      this.render();
      return;
    }
    if (action === 'player-redo') {
      const command = this.playerRedo.pop();
      if (!command) return;
      this.playerUndo.push({ label: command.label, recipe: clone(this.playerRecipe) });
      this.playerRecipe = command.recipe;
      this.markPlayerSessionDirty();
      this.sessionAutosave();
      this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload());
      this.render();
      return;
    }
    if (action === 'player-reset') {
      const playable = normalizePlayablePlayerRecipe(
        document,
        document.defaultRecipe,
        this.playerOptionSettings(document),
      );
      if (!playable.valid) {
        this.callbacks.onPlayerError?.(new Error(
          this.playerOptionReasonText({ reasonCode: playable.violations[0]?.code }, document),
        ));
        return;
      }
      this.setPlayerRecipe(playable.documentRecipe, 'Reset OC');
      return;
    }
    if (action === 'player-clear') {
      const option = evaluatePlayerClearOptionalOption(
        document,
        this.playerRecipe,
        this.playerOptionSettings(document),
      );
      if (!option.selectable || !option.nextRecipe) return;
      this.setPlayerRecipe(option.nextRecipe, 'Remove optional Parts');
      return;
    }
    if (action === 'player-random') {
      try {
        const result = generatePlayablePlayerRecipe(
          document,
          this.playerOptionSettings(document),
        );
        if (!result.valid) throw new Error(this.tr('noPlayableParts'));
        this.setPlayerRecipe(result.documentRecipe, 'Random OC');
      } catch (error) {
        this.callbacks.onPlayerError?.(error);
      }
      return;
    }
    if (action === 'player-info') {
      this.playerIntroOpen = true;
      this.render();
      return;
    }
    if (action === 'close-player-info') {
      this.closePlayerInfo();
      return;
    }
    if (action === 'player-retry-save') {
      void this.retryPlayerSessionSave();
      return;
    }
    if (action === 'player-select-recovery') {
      this.activatePlayerRecoveryBranch(button.dataset.writerId);
      return;
    }
    if (action === 'player-export-recovery') {
      this.exportPlayerRecoveryBranches();
      return;
    }
    if (action === 'player-export') {
      this.exportPlayerRecipe(null);
      return;
    }
    if (action === 'player-preview-export') {
      this.openPlayerExport('download');
      return;
    }
    if (action === 'player-complete') {
      const issues = this.playerCompletionIssues(document, this.playerRecipe);
      if (issues.length) {
        this.callbacks.onPlayerError?.(new Error(issues[0]));
        return;
      }
      this.openPlayerExport('complete');
      return;
    }
    if (
      action === 'close-player-publish'
      || (action === 'close-player-publish-backdrop' && event.target === button)
    ) {
      this.requestClosePlayerPublish();
      return;
    }
    if (action === 'keep-player-publish-open') {
      this.playerPublishCloseConfirm = false;
      this.render();
      this.focusPlayerPublishDialog('[data-action="close-player-publish"]');
      return;
    }
    if (action === 'force-close-player-publish') {
      this.requestClosePlayerPublish({ force: true });
      return;
    }
    if (action === 'copy-player-publish-error') {
      void this.copyPlayerPublishError();
      return;
    }
    if (action === 'player-publish-retry') {
      const retryAction = String(button.dataset.publishAction || '');
      if (!['resume', 'prepare', 'register', 'certify', 'onchain', 'review'].includes(retryAction)) return;
      if (retryAction === 'review' || this.playerPublishState.error?.code === 'TRANSACTION_OUTCOME_PENDING') return;
      this.playerPublishCopyState = 'idle';
      this.callbacks.onPlayerPublishAction?.(retryAction);
      return;
    }
    if (action === 'player-publish-recover') {
      const recoveryAction = String(button.dataset.publishAction || '');
      if (
        this.playerPublishState.error?.code !== 'TRANSACTION_OUTCOME_PENDING'
        || !['resume', 'register', 'certify', 'onchain'].includes(recoveryAction)
      ) return;
      this.playerPublishCopyState = 'idle';
      this.callbacks.onPlayerPublishAction?.(recoveryAction);
      return;
    }
    const playerPublishActions = new Set(['player-publish-resume', 'player-publish-prepare', 'player-publish-register', 'player-publish-certify', 'player-publish-onchain', 'player-publish-review', 'player-publish-discard']);
    if (playerPublishActions.has(action)) {
      this.playerPublishOpen = true;
      this.playerPublishCloseConfirm = false;
      this.callbacks.onPlayerPublishAction?.(action.replace('player-publish-', ''));
    }
  }

  handlePlayerChange(event) {
    if (
      this.contextSwitchInProgress
      || this.restoreInProgress
      || this.restoreError
      || this.playerSessionSwitchInProgress
    ) return;
    const input = event.target;
    const action = input.dataset.action;
    if (!action) return;
    let changed = false;
    if (action === 'player-profile-name') {
      if (this.playerProfile.name === input.value) return;
      this.playerProfile.name = input.value;
      changed = true;
    } else if (action === 'player-profile-world') {
      if (this.playerProfile.world === input.value) return;
      this.playerProfile.world = input.value;
      changed = true;
    } else if (action === 'player-profile-description') {
      if (this.playerProfile.description === input.value) return;
      this.playerProfile.description = input.value;
      changed = true;
    } else if (action === 'player-profile-tags') {
      if (this.playerProfile.tags === input.value) return;
      this.playerProfile.tags = input.value;
      changed = true;
    } else if (action === 'player-soul-document') {
      changed = this.setPlayerLivingDocument(input.dataset.soulKey, input.value);
    } else if (action === 'player-expansion') {
      const baseDocument = this.store?.getState().document;
      const pack = baseDocument?.extensions?.expansionDrafts?.find(
        (candidate) => candidate.packId === input.value,
      );
      if (!pack || !checkExpansionPackCompatibility(baseDocument, pack).compatible) return;
      const wasEnabled = this.enabledExpansionIds.has(input.value);
      if (Boolean(input.checked) === wasEnabled) return;
      if (input.checked) this.enabledExpansionIds.add(input.value);
      else this.enabledExpansionIds.delete(input.value);
      const runtimeDocument = this.runtimeDocument();
      const normalized = normalizePlayablePlayerRecipe(
        runtimeDocument,
        this.playerRecipe,
        this.playerOptionSettings(runtimeDocument),
      );
      if (!normalized.valid) {
        if (wasEnabled) this.enabledExpansionIds.add(input.value);
        else this.enabledExpansionIds.delete(input.value);
        this.callbacks.onPlayerError?.(new Error(
          this.playerOptionReasonText({ reasonCode: normalized.violations[0]?.code }, runtimeDocument),
        ));
        this.render();
        return;
      }
      this.playerRecipe = normalized.documentRecipe;
      // Undo entries are scoped to the runtime Maker graph. A Pack toggle can
      // add or remove ids, so replaying older entries could resurrect a Recipe
      // that no longer exists in the current runtime document.
      this.playerUndo = [];
      this.playerRedo = [];
      changed = true;
    }
    if (!changed) return;
    this.markPlayerSessionDirty();
    this.sessionAutosave();
    this.callbacks.onPlayerRecipeChange?.(this.playerStatePayload());
    if (action === 'player-expansion') this.render();
    else {
      this.updatePlayerSoulConfigurationUi();
      this.updatePlayerCompletionUi();
    }
  }

  destroy() {
    void this.flushPendingChanges({ reason: 'destroy' });
    void this.sessionAutosave.flush();
    this.resetPlayerExport();
    this.unsubscribe?.();
    this.creatorRoot?.removeEventListener('click', this.boundCreatorClick);
    this.creatorRoot?.removeEventListener('change', this.boundCreatorChange);
    this.creatorRoot?.removeEventListener('input', this.boundCreatorInput);
    this.creatorRoot?.removeEventListener('focusout', this.boundCreatorFocusout);
    this.creatorRoot?.removeEventListener('keydown', this.boundCreatorKeydown);
    this.creatorRoot?.removeEventListener('keyup', this.boundCreatorKeyup);
    this.playerRoot?.removeEventListener('click', this.boundPlayerClick);
    this.playerRoot?.removeEventListener('change', this.boundPlayerChange);
    this.playerRoot?.removeEventListener('input', this.boundPlayerChange);
    this.playerRoot?.removeEventListener('keydown', this.boundPlayerKeydown);
    this.assetResolver.clear();
    this.assets.forEach(revokeRuntimeAsset);
    this.renderAbort.creator?.abort();
    this.renderAbort.player?.abort();
  }
}

export function createMakerWorkspace(options) {
  return new MakerWorkspace(options);
}
