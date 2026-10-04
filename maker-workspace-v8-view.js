import {
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
} from './maker-v8-document.js';
import { createDefaultMakerV8LivingContentV8, assertMakerV8LivingContentPublishableV8 } from './maker-v8-living-content.js';
import { creatorStyleEditorState } from './maker-v8-creator-style.js';
import { creatorColorStops } from './maker-v8-creator-colors.js';
import { makerV8VisibilityEditorModel } from './maker-v8-visibility.js';
import { creatorTrackState, creatorLinkedTrackSyncState, creatorPartMoveAllowed } from './maker-v8-creator-tracks.js';
import { MAKER_V8_BLEND_MODES } from './maker-v8-render-core.js';
import {
  createMakerPartListModel,
  renderMakerPartList,
} from './maker-definition-editor.js';
import {
  renderDefinitionCombinationRuleControl,
  renderSharedRuleListEditor,
  renderSharedRuleTargetTree,
} from './maker-definition-rule-control.js';
import {
  MAKER_WORKSPACE_LOCALES,
  makerWorkspaceText,
  makerPublicationStageText,
} from './maker-workspace-i18n.js';

/**
 * Pure Fresh-v8 projection for the approved Creator renderer.
 *
 * This module owns no event listeners, persistence, publication, wallet, or
 * execution behavior. The host supplies every control capability explicitly;
 * an omitted capability is disabled. The DOM and class vocabulary below are
 * extracted from the approved aac90dbc Creator renderer.
 */

export const MAKER_V8_APPROVED_VIEW_SCHEMA = 'animacraft.maker-v8-approved-view.v1';

export const MAKER_V8_APPROVED_CREATOR_TABS = Object.freeze([
  Object.freeze({ id: 'structure', label: 'Parts & Items' }),
  Object.freeze({ id: 'info', label: 'Maker Info' }),
  Object.freeze({ id: 'layers', label: 'Layer Tracks' }),
  Object.freeze({ id: 'colors', label: 'Smart Color' }),
  Object.freeze({ id: 'rules', label: 'Rules' }),
  Object.freeze({ id: 'expansions', label: 'Expansion Packs' }),
  Object.freeze({ id: 'composable', label: 'Composable Items' }),
  Object.freeze({ id: 'commerce', label: 'Commerce & Rights' }),
  Object.freeze({ id: 'soul', label: 'Soul Configuration' }),
  Object.freeze({ id: 'validate', label: 'Preflight' }),
]);

const TAB_IDS = new Set(MAKER_V8_APPROVED_CREATOR_TABS.map((tab) => tab.id));
const SAVE_PHASES = new Set(['saved', 'saving', 'dirty', 'error']);
const LIFECYCLE_CLASSES = new Set([
  'draft', 'publishing', 'recoverable', 'active', 'paused', 'archived', 'version-draft',
]);
const PREVIEW_MODES = new Set(['all', 'dim', 'solo']);
const HISTORY_PHASES = new Set(['idle', 'loading', 'ready', 'empty', 'error', 'restoring']);
const LOCALES = new Set(MAKER_WORKSPACE_LOCALES);
const TAB_COPY_KEYS = Object.freeze({
  structure: 'partsItems',
  info: 'makerInfo',
  layers: 'layerTracks',
  colors: 'smartColor',
  rules: 'rules',
  expansions: 'expansionPacks',
  composable: 'composableItems',
  commerce: 'commerceRights',
  soul: 'soulConfig',
  validate: 'preflightReady',
});
const MAKER_INFO_FIELD_SPECS = Object.freeze({
  'maker-name': Object.freeze({ labelKey: 'makerName', limit: 128 }),
  'maker-creator': Object.freeze({ labelKey: 'makerCreator', limit: 128 }),
  'maker-summary': Object.freeze({ labelKey: 'makerIntroduction', limit: 2_000 }),
  'maker-style': Object.freeze({ labelKey: 'makerWorldStyle', limit: 128 }),
  'maker-license-note': Object.freeze({ labelKey: 'makerLicenseNote', limit: 2_000 }),
});
const SOUL_DOCUMENTS = Object.freeze([
  Object.freeze({ key: 'soulMd', filename: 'soul.md', titleKey: 'soulPersonalityIdentity', copyKey: 'soulPersonalityIdentityCopy' }),
  Object.freeze({ key: 'memoryMd', filename: 'memory.md', titleKey: 'soulMemory', copyKey: 'soulMemoryCopy' }),
  Object.freeze({ key: 'skillMd', filename: 'SKILL.md', titleKey: 'soulSkills', copyKey: 'soulSkillsCopy' }),
]);
const SOUL_DOCUMENT_MAX_BYTES = 64 * 1024;
const DONOR_BLEND_MODES = MAKER_V8_BLEND_MODES;
const BLEND_COPY_KEYS = Object.freeze({
  normal: 'blendNormal',
  multiply: 'blendMultiply',
  screen: 'blendScreen',
  overlay: 'blendOverlay',
  darken: 'blendDarken',
  lighten: 'blendLighten',
  'color-dodge': 'blendColorDodge',
  'color-burn': 'blendColorBurn',
  'hard-light': 'blendHardLight',
  'soft-light': 'blendSoftLight',
  difference: 'blendDifference',
  exclusion: 'blendExclusion',
  hue: 'blendHue',
  saturation: 'blendSaturation',
  color: 'blendColor',
  luminosity: 'blendLuminosity',
  'linear-dodge': 'blendLinearDodge',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function checked(value) {
  return value === true ? 'checked' : '';
}

function selected(value, expected) {
  return value === expected ? 'selected' : '';
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function capabilityEntry(value) {
  if (typeof value === 'boolean') return { enabled: value, reason: '' };
  if (!plain(value) || typeof value.enabled !== 'boolean') return null;
  return {
    enabled: value.enabled,
    reason: String(value.reason || ''),
  };
}

function normalizeCapabilities(value) {
  const source = plain(value) ? value : {};
  const entries = {};
  const add = (record) => {
    if (!plain(record)) return;
    Object.entries(record).forEach(([key, candidate]) => {
      if (['actions', 'controls', 'default'].includes(key)) return;
      const normalized = capabilityEntry(candidate);
      if (normalized) entries[String(key)] = normalized;
    });
  };
  add(source);
  add(source.actions);
  add(source.controls);
  const fallback = capabilityEntry(source.default)
    || capabilityEntry(source.controls?.['*'])
    || capabilityEntry(source.actions?.['*'])
    || capabilityEntry(source['*'])
    || { enabled: false, reason: '' };
  return deepFreeze({ fallback, entries });
}

function resolveCapability(capabilities, action, subject = '') {
  const scoped = subject ? `${action}:${subject}` : '';
  return capabilities.entries[scoped]
    || capabilities.entries[action]
    || capabilities.fallback;
}

function controlAttributes(view, action, subject = '', fallbackReason = '') {
  const capability = resolveCapability(view.capabilities, action, subject);
  const binding = visibilityControlBinding(view, action);
  if (capability.enabled) return binding;
  const reason = capability.reason || fallbackReason;
  return `${binding} disabled aria-disabled="true"${reason ? ` title="${escapeHtml(reason)}"` : ''}`;
}

function visibilityControlBinding(view, action) {
  if (!action.includes('visibility') && action !== 'rules-editor-intent') return '';
  const { partKey, itemKey, styleKey } = view.selection;
  return ` data-creator-generation="${view.creatorGeneration}" data-visibility-draft="${escapeHtml(view.draftId)}" data-visibility-subject="${escapeHtml([partKey, itemKey, styleKey].join('/'))}"`;
}

function disabledClass(view, action, subject = '') {
  return resolveCapability(view.capabilities, action, subject).enabled ? '' : ' disabled';
}

function controlDisabled(view, action, subject = '', forced = false) {
  return forced || !resolveCapability(view.capabilities, action, subject).enabled;
}

function forcedControlAttributes(view, action, subject = '', forced = false) {
  if (!forced) return controlAttributes(view, action, subject);
  return `${visibilityControlBinding(view, action)} disabled aria-disabled="true"`;
}

function makerInfoByteStatus(action, value) {
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

function styleSceneKey(partKey, itemKey, styleKey) {
  return `${String(partKey || '')}/${String(itemKey || '')}/${String(styleKey || '')}`;
}

function disableRenderedButton(markup, action, recordId) {
  const marker = `data-action="${action}" data-part-id="${escapeHtml(recordId)}"`;
  const markerIndex = markup.indexOf(marker);
  if (markerIndex < 0) return markup;
  const start = markup.lastIndexOf('<button', markerIndex);
  const end = markup.indexOf('>', markerIndex);
  if (start < 0 || end < 0) return markup;
  const tag = markup.slice(start, end + 1);
  const disabledTag = /\sdisabled(?:\s|>)/.test(tag)
    ? tag.replace('>', ' aria-disabled="true">')
    : tag.replace('>', ' disabled aria-disabled="true">');
  return `${markup.slice(0, start)}${disabledTag}${markup.slice(end + 1)}`;
}

function tr(view, key, variables = {}) {
  return makerWorkspaceText(view.locale, key, variables);
}

function safeAssetUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (source.startsWith('blob:')) return source;
  try {
    const url = new URL(source, 'https://animacraft.soulidity.ai');
    return ['http:', 'https:'].includes(url.protocol) ? source : '';
  } catch {
    return '';
  }
}

function assetCandidate(state, assetId) {
  const collections = [state.assetUrls, state.assetSources, state.assets];
  for (const collection of collections) {
    if (collection instanceof Map && collection.has(assetId)) return collection.get(assetId);
    if (Array.isArray(collection)) {
      const row = collection.find((candidate) => (
        String(candidate?.id || candidate?.assetId || '') === assetId
      ));
      if (row) return row;
    }
    if (plain(collection) && Object.hasOwn(collection, assetId)) return collection[assetId];
  }
  return null;
}

function projectAssetUrls(document, state) {
  const result = {};
  document.assets.forEach((asset) => {
    const candidate = assetCandidate(state, asset.id);
    const url = typeof candidate === 'string'
      ? candidate
      : candidate?.thumbnailUrl || candidate?.url || '';
    result[asset.id] = safeAssetUrl(url);
  });
  return result;
}

function safeDateTime(value, fallback = '') {
  const date = new Date(value ?? NaN);
  if (!Number.isFinite(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

// Copied from the approved donor's display-only Commerce formatter.
function atomicToCoin(value, decimals = 6) {
  const atomic = Number.isSafeInteger(Number(value)) && Number(value) >= 0
    ? Number(value)
    : 0;
  const scale = 10 ** decimals;
  return (atomic / scale).toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

function safeTime(value) {
  const date = new Date(value ?? NaN);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '';
  }
}

function stateSet(value) {
  if (value instanceof Set) return new Set([...value].map(String));
  if (plain(value)) return new Set(Object.entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => String(key)));
  return new Set(Array.isArray(value) ? value.map(String) : []);
}

function selectedRecords(document, state) {
  const part = document.parts.find((row) => row.key === String(state.selectedPartKey || ''))
    || document.parts[0]
    || null;
  const recipeSelection = document.defaultRecipe.selections.find(row => row.partKey === part?.key);
  const item = part?.items.find((row) => row.key === String(state.selectedItemKey || ''))
    || part?.items.find((row) => row.key === recipeSelection?.itemKey)
    || part?.items[0]
    || null;
  const style = item?.styles.find((row) => row.key === String(state.selectedStyleKey || ''))
    || item?.styles.find((row) => item.key === recipeSelection?.itemKey && row.key === recipeSelection.styleKey)
    || item?.styles.find((row) => row.key === item.defaultStyleKey)
    || item?.styles[0]
    || null;
  return { part, item, style };
}

function partTrackLabel(document, part, locale) {
  const trackKeys = new Set();
  part.items.forEach((item) => item.styles.forEach((style) => {
    if (style.trackKey) trackKeys.add(style.trackKey);
  }));
  if (!trackKeys.size) {
    return { label: makerWorkspaceText(locale, 'partTrackUnassigned'), mode: 'unassigned' };
  }
  if (trackKeys.size > 1) {
    return {
      label: makerWorkspaceText(locale, 'partCustomStacking', { count: trackKeys.size }),
      mode: 'custom',
    };
  }
  const [trackKey] = trackKeys;
  const track = document.tracks.find((candidate) => candidate.key === trackKey);
  if (!creatorTrackState(document, trackKey).linked) {
    return { label: makerWorkspaceText(locale, 'partCustomStacking', { count: trackKeys.size }), mode: 'custom' };
  }
  return {
    label: makerWorkspaceText(locale, 'partLinkedTrack', { track: track?.label || trackKey }),
    mode: 'linked',
  };
}

function defaultItemKey(document, partKey) {
  return document.defaultRecipe.selections.find((row) => row.partKey === partKey)?.itemKey || '';
}

function defaultStyleForItem(item) {
  return item.styles.find((style) => style.key === item.defaultStyleKey)
    || item.styles[0]
    || null;
}

function projectParts(document, state, assetUrls, locale) {
  const hidden = stateSet(state.hiddenPartKeys);
  const hiddenStyles = stateSet(state.hiddenStyleKeys);
  const styleLocks = stateSet(state.styleLockedKeys || state.styleLocks);
  const positionLocks = stateSet(state.positionLockedKeys || state.positionLocks);
  const unconfirmedPositions = stateSet(
    state.unconfirmedPositionStyleKeys || state.unconfirmedPositions,
  );
  return [...document.parts]
    .sort((left, right) => left.menuOrder - right.menuOrder || left.key.localeCompare(right.key))
    .map((part) => {
      const linkage = partTrackLabel(document, part, locale);
      const items = [...part.items]
        .sort((left, right) => left.displayOrder - right.displayOrder || left.key.localeCompare(right.key))
        .map((item) => {
          const styles = [...item.styles]
            .sort((left, right) => left.displayOrder - right.displayOrder || left.key.localeCompare(right.key))
            .map((style) => {
              const key = styleSceneKey(part.key, item.key, style.key);
              const editor = creatorStyleEditorState(style);
              const styleLocked = styleLocks.has(key) || editor.styleLocked;
              return {
                ...structuredClone(style),
                assetUrl: assetUrls[style.assetId] || '',
                styleLocked,
                positionLocked: styleLocked || positionLocks.has(key) || editor.positionLocked,
                positionConfirmed: !unconfirmedPositions.has(key) && editor.positionConfirmed,
                hidden: hiddenStyles.has(key),
              };
            });
          const thumbnailStyle = styles.find((style) => style.key === item.defaultStyleKey)
            || styles[0]
            || null;
          return {
            ...structuredClone(item),
            styles,
            thumbnailUrl: thumbnailStyle?.assetUrl || '',
            containsLockedStyle: styles.some((style) => style.styleLocked),
          };
        });
      const thumbnailItem = items.find((item) => item.key === defaultItemKey(document, part.key))
        || items[0]
        || null;
      return {
        ...structuredClone(part),
        items,
        hidden: hidden.has(part.key),
        containsLockedStyle: items.some((item) => item.containsLockedStyle),
        trackLabel: linkage.label,
        trackMode: linkage.mode,
        thumbnailUrl: thumbnailItem?.thumbnailUrl || '',
      };
    });
}

function normalizeSoulConfiguration(document, state) {
  const source = document.livingContent;
  const defaults = createDefaultMakerV8LivingContentV8(document.metadata);
  const requestedKey = String(
    state.selectedSoulDocumentKey
    || source.selectedKey
    || SOUL_DOCUMENTS[0].key,
  );
  const selectedKey = SOUL_DOCUMENTS.some((entry) => entry.key === requestedKey)
    ? requestedKey
    : SOUL_DOCUMENTS[0].key;
  const documents = SOUL_DOCUMENTS.map((entry) => {
    const content = String(source[entry.key] ?? '');
    const bytes = utf8Length(content);
    const maxBytes = SOUL_DOCUMENT_MAX_BYTES;
    let error = '';
    try { assertMakerV8LivingContentPublishableV8({ ...defaults, [entry.key]: content }); }
    catch (cause) { error = String(cause?.message || 'Invalid Soul document.'); }
    return {
      ...entry,
      content,
      customized: source.customized[entry.key],
      valid: !error,
      error,
      bytes,
      maxBytes,
    };
  });
  return { selectedKey, documents };
}

function normalizeMakerInfo(document, state) {
  const source = plain(state.makerInfo) ? state.makerInfo : {};
  const coverSource = plain(source.cover)
    ? source.cover
    : plain(state.makerCover) ? state.makerCover : {};
  const saveState = String(coverSource.saveState || state.makerCoverSaveState || 'idle');
  return {
    creator: String(document.metadata.creator ?? ''),
    style: String(document.metadata.style ?? ''),
    cover: {
      saveState,
      saving: ['processing', 'saving'].includes(saveState),
      message: String(coverSource.message || state.makerCoverSaveMessage || ''),
    },
    values: {
      'maker-name': document.metadata.name,
      'maker-creator': String(document.metadata.creator ?? ''),
      'maker-summary': document.metadata.summary,
      'maker-style': String(document.metadata.style ?? ''),
      'maker-license-note': document.metadata.license?.note || '',
    },
  };
}

function normalizeRuleEditor(document, state, selected) {
  const source = plain(state.ruleEditor) ? state.ruleEditor : {};
  const intentValue = String(source.intent || state.rulesEditorIntent || 'availability');
  const owner = [selected.part?.key, selected.item?.key, selected.style?.key]
    .filter(Boolean)
    .join('::');
  const builder = plain(source.builder) ? source.builder : plain(state.ruleBuilderDraft)
    ? state.ruleBuilderDraft : {};
  const persistedVisibility = makerV8VisibilityEditorModel(selected.style?.visibleWhen, { parts: document.parts });
  const visibility = plain(source.visibility) && source.visibilitySubject === [selected.part?.key || '', selected.item?.key || '', selected.style?.key || ''].join('/')
    ? source.visibility : plain(state.visibilityBuilderDraft) ? state.visibilityBuilderDraft : persistedVisibility;
  return {
    intent: intentValue === 'visibility' ? 'visibility' : 'availability',
    ownerQuery: String(source.ownerQuery || state.ruleOwnerQuery || ''),
    targetQuery: String(source.targetQuery || state.ruleTargetQuery || ''),
    visibilityQuery: String(source.visibilityQuery || state.visibilityTargetQuery || ''),
    error: String(source.error || state.ruleBuilderError || ''),
    visibilityError: String(source.visibilityError || state.visibilityBuilderError || ''),
    builder: {
      ownerDefinition: String(builder.ownerDefinition || owner),
      type: String(builder.type) === 'requires' ? 'requires' : 'excludes',
      matchMode: String(builder.matchMode) === 'any' ? 'any' : 'all',
      definitions: Array.isArray(builder.definitions) ? builder.definitions.map(String) : [],
    },
    visibility: {
      advanced: visibility.advanced === true,
      logic: String(visibility.logic) === 'any' ? 'any' : 'all',
      polarity: String(visibility.polarity) === 'not-selected' ? 'not-selected' : 'selected',
      definitions: Array.isArray(visibility.definitions)
        ? visibility.definitions.map(String)
        : [],
    },
  };
}

function normalizeVersionHistory(state, locale) {
  const source = plain(state.versionHistory) ? state.versionHistory : state;
  const statusValue = String(source.status || state.versionHistoryStatus || 'idle');
  const entriesValue = source.entries || state.versionEntries;
  return {
    open: source.open === true || state.versionHistoryOpen === true,
    status: HISTORY_PHASES.has(statusValue) ? statusValue : 'idle',
    entries: (Array.isArray(entriesValue) ? entriesValue : []).map((entry) => ({
      revision: Number(entry?.revision),
      name: String(entry?.name || entry?.document?.metadata?.name
        || makerWorkspaceText(locale, 'versionHistoryUnknownName')),
      updatedAt: entry?.updatedAt ?? entry?.savedAt ?? null,
    })).filter((entry) => Number.isSafeInteger(entry.revision) && entry.revision >= 0),
    error: String(source.error || state.versionHistoryError || ''),
    message: String(source.message || state.versionHistoryMessage || ''),
    chainVersions: Array.isArray(state.chainVersions) ? state.chainVersions : [],
    chainStatus: String(state.chainVersionStatus || ''),
    archiveReview: state.chainVersionReview || null,
    restoringRevision: Number.isSafeInteger(source.restoringRevision)
      ? source.restoringRevision
      : Number.isSafeInteger(state.restoringCheckpointRevision)
        ? state.restoringCheckpointRevision
        : null,
    currentRevision: Number.isSafeInteger(source.currentRevision)
      ? source.currentRevision
      : Number.isSafeInteger(state.persistedRevision)
        ? state.persistedRevision
        : Number.isSafeInteger(state.revision) ? state.revision : null,
  };
}

function uniqueIssues(document, state, soul) {
  const combined = [
    ...collectMakerV8DocumentIssues(document, { mode: 'compile' }),
    // Unfinished text stays saveable; review must still report the same
    // publication errors as the original Soul editor, including every file.
    ...soul.documents.filter(entry => !entry.valid).map(entry => ({
      code: 'MAKER_V8_LIVING_CONTENT_INVALID',
      path: `livingContent.${entry.key}`,
      message: entry.error,
    })),
    ...(Array.isArray(state.issues) ? state.issues : []),
  ].map((issue) => ({
    code: String(issue?.code || 'MAKER_V8_VIEW_ISSUE'),
    path: String(issue?.path || ''),
    message: String(issue?.message || issue?.code || 'Maker v8 issue'),
  }));
  return combined.filter((issue, index, rows) => rows.findIndex((candidate) => (
    candidate.code === issue.code
    && candidate.path === issue.path
    && candidate.message === issue.message
  )) === index);
}

export function projectMakerV8WorkspaceView(documentValue, stateValue = {}, capabilitiesValue = {}) {
  assertMakerV8Document(documentValue, { mode: 'draft' });
  const document = structuredClone(documentValue);
  const state = plain(stateValue) ? stateValue : {};
  const capabilities = normalizeCapabilities(capabilitiesValue);
  const locale = LOCALES.has(String(state.locale)) ? String(state.locale) : 'en';
  const assetUrls = projectAssetUrls(document, state);
  const selected = selectedRecords(document, state);
  const parts = projectParts(document, state, assetUrls, locale);
  const previewMode = PREVIEW_MODES.has(String(state.previewMode))
    ? String(state.previewMode)
    : 'all';
  const activeTab = TAB_IDS.has(String(state.creatorTab)) ? String(state.creatorTab) : 'structure';
  const previewLayerCount = Number.isSafeInteger(state.previewLayerCount)
    ? Math.max(0, state.previewLayerCount)
    : document.defaultRecipe.selections.filter((selection) => {
      const part = document.parts.find((candidate) => candidate.key === selection.partKey);
      const item = part?.items.find((candidate) => candidate.key === selection.itemKey);
      const style = item?.styles.find((candidate) => candidate.key === selection.styleKey);
      return Boolean(style?.assetId && assetUrls[style.assetId]);
    }).length;
  const savePhase = SAVE_PHASES.has(String(state.saveState)) ? String(state.saveState) : 'saved';
  const lifecycleSource = plain(state.lifecycle) ? state.lifecycle : {};
  const lifecycleClass = LIFECYCLE_CLASSES.has(String(lifecycleSource.badgeClass))
    ? String(lifecycleSource.badgeClass)
    : 'draft';
  const soul = normalizeSoulConfiguration(document, state);
  const issues = uniqueIssues(document, state, soul);
  const tabRows = MAKER_V8_APPROVED_CREATOR_TABS.map((tab) => ({
    id: tab.id,
    label: tab.id === 'validate'
      ? makerWorkspaceText(locale, issues.length ? 'preflightCount' : 'preflightReady', { count: issues.length })
      : makerWorkspaceText(locale, TAB_COPY_KEYS[tab.id]),
  }));
  return deepFreeze({
    schemaVersion: MAKER_V8_APPROVED_VIEW_SCHEMA,
    locale,
    document,
    capabilities,
    activeTab,
    tabs: tabRows,
    selection: {
      partKey: selected.part?.key || '',
      itemKey: selected.item?.key || '',
      styleKey: selected.style?.key || '',
    },
    parts,
    assetUrls,
    issues,
    preview: {
      mode: previewMode,
      zoom: Number.isFinite(state.zoom) ? Math.min(2, Math.max(0.5, Number(state.zoom))) : 1,
      layerCount: previewLayerCount,
      status: String(state.previewStatus || makerWorkspaceText(locale, 'creatorRenderReady', {
        drawn: previewLayerCount,
      })),
    },
    save: {
      phase: savePhase,
      label: String(state.saveLabel || (savePhase === 'saving'
        ? makerWorkspaceText(locale, 'saving')
        : safeTime(state.savedAt)
          ? makerWorkspaceText(locale, 'savedAtTime', { time: safeTime(state.savedAt) })
          : makerWorkspaceText(locale, 'savedStatus'))),
    },
    toolbar: {
      recoveryAvailable: state.creatorRecoveryAvailable === true,
      canUndo: state.canUndo === true,
      canRedo: state.canRedo === true,
      previewAssetCount: Object.values(assetUrls).filter(Boolean).length,
    },
    lifecycle: {
      label: String(lifecycleSource.label || makerWorkspaceText(locale, 'publishMainnet')),
      manageLabel: String(
        lifecycleSource.manageLabel
        || lifecycleSource.label
        || makerWorkspaceText(locale, 'publishMainnet'),
      ),
      badgeClass: lifecycleClass,
    },
    revision: Number.isSafeInteger(state.revision) ? state.revision : null,
    draftId: String(state.draftId || document.lineage.makerKey),
    notice: String(state.notice || ''),
    backgroundPartKeys: document.parts.filter(part => part.exportBackground === true).map(part => part.key),
    selectedTrackKey: String(document.tracks.some(track => track.key === state.selectedTrackKey)
      ? state.selectedTrackKey : selected.style?.trackKey || document.tracks[0]?.key || ''),
    selectedColorKey: String(state.selectedColorKey || selected.style?.colorChannelKey || document.colors[0]?.key || ''),
    openGradientKeys: [...stateSet(state.creatorOpenGradients)],
    creatorGeneration: Number.isSafeInteger(state.creatorDraftGeneration) ? state.creatorDraftGeneration : 0,
    editingPositionStyleKey: String(state.editingPositionStyleKey || ''),
    makerInfo: normalizeMakerInfo(document, state),
    soul,
    ruleEditor: normalizeRuleEditor(document, state, selected),
    composableInventory: state.composableInventory || null,
    composableOperations: state.composableOperations || null,
    composableTargets: state.composableTargets || null,
    composableAdmission: state.composableAdmission || null,
    composableArtwork: state.composableArtwork || null,
    composableUploadHistory: state.composableUploadHistory || null,
    composableUploadWriteEnabled: state.composableUploadWriteEnabled === true,
    commerceProtocol: {
      enabled: state.commerceProtocol?.enabled === true,
      primaryContentFeeBps: Number.isSafeInteger(state.commerceProtocol?.primaryContentFeeBps)
        ? state.commerceProtocol.primaryContentFeeBps
        : 1_000,
      fixedCompleteFeeAtomic: Number.isSafeInteger(state.commerceProtocol?.fixedCompleteFeeAtomic)
        ? state.commerceProtocol.fixedCompleteFeeAtomic
        : 0,
    },
    commerceRightsLocked: state.commerceRightsLocked === true,
    commerceCanWithdrawRightsConfirmation: state.commerceCanWithdrawRightsConfirmation === true,
    currentReleaseSealed: state.currentReleaseSealed === true,
    expansionPacks: (Array.isArray(state.expansionPacks) ? state.expansionPacks : []).map((pack) => ({
      key: String(pack?.key || pack?.packId || ''),
      name: String(pack?.name || pack?.label || pack?.packId || 'Expansion Pack'),
      status: String(pack?.status || 'Draft'),
      packId: String(pack?.packId || pack?.key || ''),
      namespace: String(pack?.namespace || ''),
      version: String(pack?.version || pack?.parentVersion || ''),
      revision: Number.isSafeInteger(pack?.revision) ? pack.revision : 0,
      chainOnly: pack?.chainOnly === true,
      publishable: pack?.publishable === true,
      parentBindingIdentity: String(pack?.parentBindingIdentity || ''),
      lifecycle: {
        badgeClass: String(pack?.lifecycle?.badgeClass || pack?.badgeClass || 'draft'),
        label: String(pack?.lifecycle?.label || pack?.status || 'Draft'),
      },
      commerce: plain(pack?.commerce) ? structuredClone(pack.commerce) : {},
      packPolicy: plain(pack?.packPolicy) ? structuredClone(pack.packPolicy) : null,
    })),
    expansionPacksStatus: String(state.expansionPacksStatus || state.expansionPackProjectsStatus || 'ready'),
    expansionPacksError: String(state.expansionPacksError || state.expansionPackProjectsError || ''),
    expansionPackNotice: String(state.expansionPackNotice || state.expansionPackProjectNotice || ''),
    versionHistory: normalizeVersionHistory(state, locale),
    publicationReview: state.publicationReview || null,
    publicationSigningEnabled: state.publicationSigningEnabled === true,
    publicationBroadcastEnabled: state.publicationBroadcastEnabled === true,
  });
}

function renderApprovedShell(model, view) {
  const tabs = model.tabs.map((tab) => {
    const active = tab.id === model.activeTab;
    return `<button type="button" role="tab" id="makerV4Tab-${escapeHtml(tab.id)}" class="${active ? 'active' : ''}" data-action="creator-tab" data-tab="${escapeHtml(tab.id)}" aria-selected="${active}" aria-pressed="${active}" tabindex="${active ? '0' : '-1'}"${tab.id === 'structure' ? ' aria-controls="makerV4ToolPanel"' : ''}${controlAttributes(view, 'creator-tab', tab.id)}>${escapeHtml(tab.label)}</button>`;
  }).join('');
  return `
    <section class="v4-studio-shell" data-maker-editor-shell="maker">
      <header class="v4-studio-topbar">
        <div class="v4-studio-title"><span class="v4-eyebrow">${escapeHtml(tr(view, 'studio'))}</span><div>${model.titleHtml}</div></div>
        <div class="v4-save-indicator ${escapeHtml(view.save.phase)}" data-save-phase="${escapeHtml(view.save.phase)}" aria-live="polite"><i></i><span>${escapeHtml(view.save.label)}</span></div>
        <div class="v4-top-actions">${model.actionsHtml}</div>
      </header>
      ${model.noticesHtml}
      <nav class="v4-studio-tabs" role="tablist" aria-label="${escapeHtml(tr(view, 'makerToolsLabel'))}">${tabs}</nav>
      <div id="makerV4ToolPanel" class="v4-studio-workspace">
        <aside class="v4-parts-browser">${model.leftHtml}</aside>
        <main class="v4-canvas-column">${model.centerHtml}</main>
        <aside class="v4-inspector">${model.rightHtml}</aside>
      </div>
      ${model.overlayHtml}
    </section>
    ${model.afterHtml}`;
}

function reviewIdentity(view) {
  return ` data-review-draft="${escapeHtml(view.draftId)}" data-creator-generation="${view.creatorGeneration}"`;
}

function toolbar(view) {
  const reviewAction = view.issues.length ? 'review-preflight' : 'publish';
  const issueLabel = view.issues.length
    ? tr(view, view.issues.length === 1 ? 'reviewIssue' : 'reviewIssues', { count: view.issues.length })
    : tr(view, 'publishMainnet');
  return `
    <button type="button" class="maker-lifecycle-badge ${escapeHtml(view.lifecycle.badgeClass)}" data-action="manage-lifecycle" aria-label="${escapeHtml(view.lifecycle.manageLabel)}"${controlAttributes(view, 'manage-lifecycle')}>${escapeHtml(view.lifecycle.label)}</button>
    <button type="button" data-action="back-library"${controlAttributes(view, 'back-library')}>${escapeHtml(tr(view, 'backToLibrary'))}</button>
    <button type="button" data-action="undo"${forcedControlAttributes(view, 'undo', '', !view.toolbar.canUndo)} title="${escapeHtml(tr(view, view.toolbar.canUndo ? 'undoHint' : 'undoUnavailable'))}">↶ ${escapeHtml(tr(view, 'undo'))}</button>
    <button type="button" data-action="redo"${forcedControlAttributes(view, 'redo', '', !view.toolbar.canRedo)} title="${escapeHtml(tr(view, view.toolbar.canRedo ? 'redoHint' : 'redoUnavailable'))}">↷ ${escapeHtml(tr(view, 'redo'))}</button>
    <button type="button" data-action="save" title="${escapeHtml(tr(view, 'saveHint'))}"${controlAttributes(view, 'save')}>${escapeHtml(tr(view, view.save.phase === 'saving' ? 'saving' : 'save'))}</button>
    ${view.toolbar.recoveryAvailable ? `<button type="button" data-action="save-recovery-copy" title="${escapeHtml(tr(view, 'saveRecoveryCopyHint'))}"${controlAttributes(view, 'save-recovery-copy')}>${escapeHtml(tr(view, 'saveRecoveryCopy'))}</button>` : ''}
    <button type="button" data-action="open-version-history"${controlAttributes(view, 'open-version-history')}>${escapeHtml(tr(view, 'versionHistory'))}</button>
    <button type="button" data-action="export-project"${controlAttributes(view, 'export-project')}>${escapeHtml(tr(view, 'projectZip'))}</button>
    <label class="v4-file-button compact${disabledClass(view, 'import-project')}">${escapeHtml(tr(view, 'importZip'))}<input type="file" accept=".zip,application/zip" data-action="import-project"${controlAttributes(view, 'import-project')} /></label>
    <button type="button" data-action="open-player" title="${escapeHtml(tr(view, view.toolbar.previewAssetCount ? 'playerTestHint' : 'playerTestBlocked'))}"${controlAttributes(view, 'open-player')}>▶ ${escapeHtml(tr(view, 'playerTest'))}</button>
    <button class="primary" type="button" data-action="${reviewAction}"${reviewIdentity(view)}${controlAttributes(view, reviewAction, '', tr(view, 'publicationUnavailable'))}>${escapeHtml(issueLabel)}</button>`;
}

function renderParts(view) {
  const records = view.parts.map((part) => {
    const wardrobeEnabled = view.document.composition.mode === 'COMPOSABLE';
    const targetMode = part.wardrobeMode === 'SLOT' ? 'FIXED' : 'SLOT';
    const slotAction = wardrobeEnabled ? 'wardrobe-part-mode' : 'open-part-slot-settings';
    const slotSubject = wardrobeEnabled ? `${part.key}:${targetMode}` : part.key;
    return {
      id: part.key,
      name: part.label,
      thumbnailUrl: part.thumbnailUrl,
      thumbnailText: part.label.slice(0, 2).toUpperCase(),
      itemCount: part.items.length,
      required: part.required,
      trackLabel: part.trackLabel,
      trackMode: part.trackMode,
      hidden: part.hidden,
      draggable: resolveCapability(view.capabilities, 'move-part', part.key).enabled,
      capabilities: {
        select: resolveCapability(view.capabilities, 'select-part', part.key).enabled,
        // Keep the approved controls in the DOM; explicit capabilities below
        // choose enabled/disabled state instead of creating a second layout.
        preview: true,
        slot: true,
        moveUp: creatorPartMoveAllowed(view.document, part.key, { direction: 'up' })
          && resolveCapability(view.capabilities, 'move-part', `${part.key}:up`).enabled,
        moveDown: creatorPartMoveAllowed(view.document, part.key, { direction: 'down' })
          && resolveCapability(view.capabilities, 'move-part', `${part.key}:down`).enabled,
        duplicate: resolveCapability(view.capabilities, 'copy-part', part.key).enabled,
        delete: !part.containsLockedStyle
          && resolveCapability(view.capabilities, 'delete-part', part.key).enabled,
      },
      slot: {
        active: part.wardrobeMode === 'SLOT',
        action: slotAction,
        mode: wardrobeEnabled ? targetMode : '',
        disabled: !resolveCapability(view.capabilities, slotAction, slotSubject).enabled,
        label: tr(view, !wardrobeEnabled
          ? 'partSlotOpenSettings'
          : part.wardrobeMode === 'SLOT'
            ? 'partSlotKeepFixed'
            : 'partSlotMakeSlot', { part: part.label }),
      },
    };
  });
  let markup = renderMakerPartList(createMakerPartListModel(records, {
    selectedId: view.selection.partKey,
    listLabel: tr(view, 'parts'),
    actionBarLabel: tr(view, 'selectedPartActions', {
      part: records.find((row) => row.id === view.selection.partKey)?.name || '',
    }),
    emptyLabel: tr(view, 'createFirstPart'),
  }), {
    itemCount: tr(view, 'partItemCount', { count: '{count}' }),
    required: tr(view, 'required'),
    optional: tr(view, 'optional'),
    selectPart: tr(view, 'selectNamedPart', { part: '{part}' }),
    selectedPart: tr(view, 'selectedNamedPart', { part: '{part}' }),
    stateActions: tr(view, 'partStateActions'),
    showPreview: tr(view, 'showPartPreview'),
    hidePreview: tr(view, 'hidePartPreview'),
    moveUp: tr(view, 'movePartUp'),
    moveDown: tr(view, 'movePartDown'),
    duplicate: tr(view, 'duplicate'),
    delete: tr(view, 'delete'),
  });
  view.parts.forEach((part) => {
    if (!resolveCapability(view.capabilities, 'toggle-part-preview', part.key).enabled) {
      markup = disableRenderedButton(markup, 'toggle-part-preview', part.key);
    }
    const wardrobeEnabled = view.document.composition.mode === 'COMPOSABLE';
    const slotAction = wardrobeEnabled ? 'wardrobe-part-mode' : 'open-part-slot-settings';
    const slotSubject = wardrobeEnabled
      ? `${part.key}:${part.wardrobeMode === 'SLOT' ? 'FIXED' : 'SLOT'}`
      : part.key;
    if (!resolveCapability(view.capabilities, slotAction, slotSubject).enabled) {
      markup = disableRenderedButton(markup, slotAction, part.key);
    }
  });
  return markup;
}

function selectedViewRecords(view) {
  const part = view.parts.find((row) => row.key === view.selection.partKey) || null;
  const item = part?.items.find((row) => row.key === view.selection.itemKey) || null;
  const style = item?.styles.find((row) => row.key === view.selection.styleKey) || null;
  return { part, item, style };
}

function itemRows(view, part) {
  if (!part?.items.length) {
    return `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noItemsYet'))}</strong><span>${escapeHtml(tr(view, 'noItemsCopy'))}</span></div>`;
  }
  return part.items.map((item) => {
    const subject = `${part.key}/${item.key}`;
    return `
      <article class="v4-record-entry v4-item-entry" draggable="${resolveCapability(view.capabilities, 'move-item', subject).enabled}" data-drag-kind="item" data-parent-id="${escapeHtml(part.key)}" data-drag-id="${escapeHtml(item.key)}">
        <button class="v4-item-card ${item.key === view.selection.itemKey ? 'active' : ''}" type="button" data-action="select-item" data-item-id="${escapeHtml(item.key)}"${controlAttributes(view, 'select-item', subject)}>
          <span class="v4-item-thumb">${item.thumbnailUrl ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="" />` : '<i>PNG</i>'}</span>
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(tr(view, 'styleCount', { count: item.styles.length }))}</small>
        </button>
        <div class="v4-record-actions">
          <button type="button" data-action="copy-item" data-part-id="${escapeHtml(part.key)}" data-item-id="${escapeHtml(item.key)}"${controlAttributes(view, 'copy-item', subject)}>${escapeHtml(tr(view, 'duplicate'))}</button>
          <button type="button" class="danger" data-action="delete-item" data-part-id="${escapeHtml(part.key)}" data-item-id="${escapeHtml(item.key)}"${forcedControlAttributes(view, 'delete-item', subject, item.containsLockedStyle)}>${escapeHtml(tr(view, 'delete'))}</button>
        </div>
      </article>`;
  }).join('');
}

function styleRows(view, part, item) {
  if (!item?.styles.length) return `<span class="v4-style-empty">${escapeHtml(tr(view, 'noStylesYet'))}</span>`;
  return item.styles.map((style) => {
    const subject = `${part.key}/${item.key}/${style.key}`;
    return `
      <article class="v4-record-entry v4-style-entry" draggable="${!style.styleLocked && resolveCapability(view.capabilities, 'move-style', subject).enabled}" data-drag-kind="style" data-parent-id="${escapeHtml(`${part.key}/${item.key}`)}" data-drag-id="${escapeHtml(style.key)}">
        <button class="v4-style-chip ${style.key === view.selection.styleKey ? 'active' : ''} ${style.hidden ? 'muted' : ''}" type="button" data-action="select-style" data-style-id="${escapeHtml(style.key)}"${controlAttributes(view, 'select-style', subject)}>
          <span class="v4-style-chip-thumb">${style.assetUrl ? `<img src="${escapeHtml(style.assetUrl)}" alt="" />` : '<i>PNG</i>'}</span>
          <span><strong>${escapeHtml(style.label)}</strong><small>${escapeHtml(item.defaultStyleKey === style.key ? tr(view, 'defaultStyle') : tr(view, 'style'))}</small></span>
          ${style.styleLocked ? '<em>🔒</em>' : style.positionLocked ? '<em>⌖</em>' : ''}
        </button>
        <div class="v4-record-actions">
          <button type="button" data-action="copy-style" data-part-id="${escapeHtml(part.key)}" data-item-id="${escapeHtml(item.key)}" data-style-id="${escapeHtml(style.key)}"${controlAttributes(view, 'copy-style', subject)}>${escapeHtml(tr(view, 'duplicate'))}</button>
          <button type="button" class="danger" data-action="delete-style" data-part-id="${escapeHtml(part.key)}" data-item-id="${escapeHtml(item.key)}" data-style-id="${escapeHtml(style.key)}"${forcedControlAttributes(view, 'delete-style', subject, style.styleLocked)}>${escapeHtml(tr(view, 'delete'))}</button>
        </div>
      </article>`;
  }).join('');
}

function previewAndItems(view, part, item, style) {
  const styleSubject = style ? `${part.key}/${item.key}/${style.key}` : '';
  const styleMarkup = styleRows(view, part, item);
  return `
    <div class="v4-canvas-toolbar">
      <div><strong>${escapeHtml(tr(view, 'runtimePreview'))}</strong><span id="v4CreatorRenderStatus">${escapeHtml(view.preview.status || tr(view, 'runtimePreviewCopy'))}</span></div>
      <div class="v4-canvas-tools">
        <div class="v4-preview-mode" role="group" aria-label="${escapeHtml(tr(view, 'previewModeLabel'))}">
          <button type="button" class="${view.preview.mode === 'all' ? 'active' : ''}" data-action="set-preview-mode" data-preview-mode="all" aria-pressed="${view.preview.mode === 'all'}"${controlAttributes(view, 'set-preview-mode', 'all')}>${escapeHtml(tr(view, 'previewShowAll'))}</button>
          <button type="button" class="${view.preview.mode === 'dim' ? 'active' : ''}" data-action="set-preview-mode" data-preview-mode="dim" aria-pressed="${view.preview.mode === 'dim'}"${controlAttributes(view, 'set-preview-mode', 'dim')}>${escapeHtml(tr(view, 'previewDimOthers'))}</button>
          <button type="button" class="${view.preview.mode === 'solo' ? 'active' : ''}" data-action="set-preview-mode" data-preview-mode="solo" aria-pressed="${view.preview.mode === 'solo'}"${controlAttributes(view, 'set-preview-mode', 'solo')}>${escapeHtml(tr(view, 'previewSoloCurrent'))}</button>
        </div>
        <button type="button" data-action="show-all-parts"${controlAttributes(view, 'show-all-parts')}>${escapeHtml(tr(view, 'showAllParts'))}</button>
        <button type="button" data-action="show-current-part"${controlAttributes(view, 'show-current-part', part?.key || '')}>${escapeHtml(tr(view, 'showCurrentPart'))}</button>
        <label>${escapeHtml(tr(view, 'zoom'))} <input type="range" min="50" max="200" step="10" value="${Math.round(view.preview.zoom * 100)}" data-action="canvas-zoom"${controlAttributes(view, 'canvas-zoom')} /></label>
        <button type="button" class="${view.document.canvas.pixelMode === 'pixelated' ? 'active' : ''}" data-action="toggle-pixel" aria-pressed="${view.document.canvas.pixelMode === 'pixelated'}"${controlAttributes(view, 'toggle-pixel')}>${escapeHtml(tr(view, 'pixelMode'))}</button>
      </div>
    </div>
    <div class="v4-canvas-viewport ${view.document.canvas.pixelMode === 'pixelated' ? 'pixelated' : ''}">
      <div class="v4-canvas-ruler"><span>0,0</span><span>${view.document.canvas.width},${view.document.canvas.height}</span></div>
      <canvas id="makerV4CreatorCanvas" class="v4-runtime-canvas" style="width:${Math.round(view.preview.zoom * 100)}%" tabindex="0" aria-label="${escapeHtml(tr(view, 'makerCanvasLabel'))}"></canvas>
      ${!style?.assetUrl ? `<div class="v4-canvas-empty"><strong>${escapeHtml(tr(view, 'selectVisualStyle'))}</strong><span>${escapeHtml(tr(view, 'selectVisualStyleCopy'))}</span></div>` : ''}
    </div>
    <div class="v4-items-dock">
      <div class="v4-panel-head">
        <div><span>${escapeHtml(tr(view, 'items'))}</span><strong>${escapeHtml(part?.label || tr(view, 'selectPart'))}</strong></div>
        <div>
          <button type="button" data-action="add-item"${controlAttributes(view, 'add-item', part?.key || '')}>${escapeHtml(tr(view, 'addItem'))}</button>
          <label class="v4-file-button${disabledClass(view, 'batch-import-items', part?.key || '')}">${escapeHtml(tr(view, 'batchImportItems'))}<input type="file" accept="image/png" multiple data-action="batch-import-items"${controlAttributes(view, 'batch-import-items', part?.key || '')} /></label>
          <label class="v4-file-button${disabledClass(view, 'project-import')}">${escapeHtml(tr(view, 'importMatrixFolder'))}<input type="file" accept="image/png" multiple webkitdirectory directory data-action="project-import"${controlAttributes(view, 'project-import')} /></label>
        </div>
      </div>
      <div class="v4-item-grid">${itemRows(view, part)}</div>
      ${item ? `<div class="v4-style-row"><span>${escapeHtml(tr(view, 'styles'))}</span>${styleMarkup}<button type="button" data-action="add-style"${controlAttributes(view, 'add-style', `${part.key}/${item.key}`)}>${escapeHtml(tr(view, 'addStyle'))}</button><label class="v4-file-button${disabledClass(view, 'batch-import-styles', `${part.key}/${item.key}`)}">${escapeHtml(tr(view, 'batchImportStyles'))}<input type="file" accept="image/png" multiple data-action="batch-import-styles"${controlAttributes(view, 'batch-import-styles', `${part.key}/${item.key}`)} /></label></div>` : ''}
    </div>`;
}

function inspector(view, part, item, style) {
  if (!part) {
    return `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noPartSelected'))}</strong><span>${escapeHtml(tr(view, 'noPartSelectedCopy'))}</span></div>`;
  }
  const partSubject = part.key;
  const itemSubject = item ? `${part.key}/${item.key}` : '';
  const styleSubject = style ? `${itemSubject}/${style.key}` : '';
  const defaultKey = defaultItemKey(view.document, part.key);
  const defaultOptions = part.items.map((candidate) => (
    `<option value="${escapeHtml(candidate.key)}" ${selected(defaultKey, candidate.key)}>${escapeHtml(candidate.label)}</option>`
  )).join('');
  const transform = style?.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
  const colorOptions = [
    `<option value="">${escapeHtml(tr(view, 'noSmartColor'))}</option>`,
    ...view.document.colors.map((channel) => `<option value="${escapeHtml(channel.key)}" ${selected(style?.colorChannelKey, channel.key)}>${escapeHtml(channel.label)}</option>`),
  ].join('');
  const ruleCount = (definition, ownerType) => {
    const [partKey = '', itemKey = '', styleKey = ''] = definition.split('::');
    return view.document.rules.filter((rule) => [rule.trigger, ...rule.targets].some((selector) => (
      selector.partKey === partKey
      && (ownerType === 'part' || ['BASE', 'ANY'].includes(selector.source)
        && selector.itemKey === itemKey
        && (ownerType !== 'style' || selector.styleKey === styleKey))
    ))).length;
  };
  const combinationRuleEntry = (definition, ownerType) => {
    const count = ruleCount(definition, ownerType);
    return renderDefinitionCombinationRuleControl({
      definition,
      ownerType,
      count,
      title: tr(view, 'combinationRules'),
      countLabel: tr(view, 'combinationRuleCount', { count }),
      actionLabel: tr(view, count ? 'editCombinationRules' : 'addCombinationRule'),
      action: 'edit-selection-rules',
      disabled: controlDisabled(view, 'edit-selection-rules', definition),
    });
  };
  const styleLocked = style?.styleLocked === true;
  const positionLocked = styleLocked || style?.positionLocked === true;
  const positionEditorOpen = Boolean(
    style
    && !positionLocked
    && (style.positionConfirmed === false || view.editingPositionStyleKey === styleSubject),
  );
  const pixelCoordinates = view.document.canvas.pixelMode === 'pixelated';
  const positionAttributes = (action) => {
    if (controlDisabled(view, action, styleSubject)) return ' disabled aria-disabled="true"';
    return positionLocked ? ' readonly aria-readonly="true"' : '';
  };
  const visibility = style?.visibleWhen == null ? null : makerV8VisibilityEditorModel(style.visibleWhen, { parts: view.document.parts });
  const visibilityLabels = visibility?.definitions.map(definition => {
    const [partKey, itemKey, styleKey] = definition.split('::');
    const targetPart = view.document.parts.find(row => row.key === partKey);
    const targetItem = targetPart?.items.find(row => row.key === itemKey);
    const targetStyle = targetItem?.styles.find(row => row.key === styleKey);
    return [targetPart?.label, targetItem?.label, targetStyle?.label].filter(Boolean).join(' / ') || definition;
  }) || [];
  const visibilityTargets = visibilityLabels.join(
    visibility?.logic === 'any' ? tr(view, 'visibilityOrSeparator') : tr(view, 'visibilityAndSeparator'),
  );
  const visibilityText = !visibility
    ? tr(view, 'alwaysVisible')
    : visibility?.advanced === true
      ? tr(view, 'visibilityAdvancedSummary')
      : visibility?.polarity === 'not-selected'
        ? tr(view, visibility?.logic === 'any'
          ? 'visibilityAnyNotSelectedSummary'
          : 'visibilityAllNotSelectedSummary', { targets: visibilityTargets })
        : tr(view, visibility?.logic === 'any'
          ? 'visibilityAnySelectedSummary'
          : 'visibilityAllSelectedSummary', { targets: visibilityTargets });
  return `
    <div class="v4-inspector-section">
      <span class="v4-inspector-label">${escapeHtml(tr(view, 'part'))}</span>
      <label>${escapeHtml(tr(view, 'name'))}<input value="${escapeHtml(part.label)}" data-action="part-name" maxlength="128"${controlAttributes(view, 'part-name', partSubject)} /></label>
      <div class="v4-toggle-grid">
        <label><input type="checkbox" ${checked(part.required)} data-action="part-required"${controlAttributes(view, 'part-required', partSubject)} /> ${escapeHtml(tr(view, 'required'))}</label>
        <label><input type="checkbox" ${checked(part.visible)} data-action="part-visible"${controlAttributes(view, 'part-visible', partSubject)} /> ${escapeHtml(tr(view, 'playerMenu'))}</label>
        <label><input type="checkbox" ${checked(view.backgroundPartKeys.includes(part.key))} data-action="part-export-background" data-part-id="${escapeHtml(part.key)}"${reviewIdentity(view)}${controlAttributes(view, 'part-export-background', partSubject)} /> ${escapeHtml(tr(view, 'exportBackgroundPart'))}</label>
      </div>
      <label>${escapeHtml(tr(view, 'defaultItem'))}<select data-action="part-default"${forcedControlAttributes(view, 'part-default', partSubject, !part.items.length)}><option value="">${escapeHtml(tr(view, 'none'))}</option>${defaultOptions}</select></label>
      ${combinationRuleEntry(part.key, 'part')}
      <label class="v4-file-button wide${disabledClass(view, 'part-icon', partSubject)}">${escapeHtml(tr(view, 'uploadPartIcon'))}<input type="file" accept="image/png,image/jpeg" data-action="part-icon"${controlAttributes(view, 'part-icon', partSubject)} /></label>
    </div>
    ${item ? `
      <div class="v4-inspector-section">
        <span class="v4-inspector-label">${escapeHtml(tr(view, 'item'))}</span>
        <label>${escapeHtml(tr(view, 'name'))}<input value="${escapeHtml(item.label)}" data-action="item-name" maxlength="128"${controlAttributes(view, 'item-name', itemSubject)} /></label>
        ${combinationRuleEntry(`${part.key}::${item.key}`, 'item')}
        <label class="v4-file-button wide${disabledClass(view, 'item-thumbnail', itemSubject)}">${escapeHtml(tr(view, 'customThumbnail'))}<input type="file" accept="image/png,image/jpeg" data-action="item-thumbnail"${controlAttributes(view, 'item-thumbnail', itemSubject)} /></label>
      </div>
      <div class="v4-inspector-section">
        <span class="v4-inspector-label">${escapeHtml(tr(view, 'style'))}</span>
        <p class="v4-style-concept">${escapeHtml(tr(view, 'stylePngCopy'))}</p>
        ${style ? `
          <label>${escapeHtml(tr(view, 'name'))}<input value="${escapeHtml(style.label)}" data-action="style-name" maxlength="128"${forcedControlAttributes(view, 'style-name', styleSubject, styleLocked)} /></label>
          ${combinationRuleEntry(`${part.key}::${item.key}::${style.key}`, 'style')}
          <div class="v4-inline-actions"><button type="button" data-action="set-default-style"${forcedControlAttributes(view, 'set-default-style', styleSubject, styleLocked || item.defaultStyleKey === style.key)}>${escapeHtml(item.defaultStyleKey === style.key ? tr(view, 'defaultStyle') : tr(view, 'setDefaultStyle'))}</button></div>
          <div class="v4-style-locks">
            <label><input type="checkbox" ${checked(style.positionLocked)} data-action="style-position-locked"${forcedControlAttributes(view, 'style-position-locked', styleSubject, styleLocked)} /> ${escapeHtml(tr(view, 'positionLock'))}</label>
            <label><input type="checkbox" ${checked(style.styleLocked)} data-action="style-locked"${controlAttributes(view, 'style-locked', styleSubject)} /> ${escapeHtml(tr(view, 'styleLock'))}</label>
          </div>
          <label class="v4-file-button wide${styleLocked || controlDisabled(view, 'style-asset', styleSubject) ? ' disabled' : ''}">${escapeHtml(tr(view, style.assetId ? 'replaceStylePng' : 'uploadStylePng'))}<input type="file" accept="image/png" data-action="style-asset"${forcedControlAttributes(view, 'style-asset', styleSubject, styleLocked)} /></label>
          <div class="v4-position-row">
            <p class="v4-position-summary">X ${Number(transform.x).toFixed(1)} · Y ${Number(transform.y).toFixed(1)} · ${escapeHtml(tr(view, 'scale'))} ${Number(transform.scale).toFixed(2)} · ${escapeHtml(tr(view, 'rotate'))} ${Number(transform.rotation).toFixed(1)}°</p>
            ${positionEditorOpen
              ? `<button type="button" class="primary" data-action="confirm-position"${forcedControlAttributes(view, 'confirm-position', styleSubject, !style.assetId)}>${escapeHtml(tr(view, 'confirmPosition'))}</button>`
              : `<button type="button" data-action="edit-position"${forcedControlAttributes(view, 'edit-position', styleSubject, positionLocked || !style.assetId)}>${escapeHtml(tr(view, 'adjustPosition'))}</button>`}
          </div>
          <div class="v4-number-grid">
            <label>X<input type="number" step="${pixelCoordinates ? '1' : '0.1'}" value="${Number(transform.x)}" data-action="style-x"${positionAttributes('style-x')} /></label>
            <label>Y<input type="number" step="${pixelCoordinates ? '1' : '0.1'}" value="${Number(transform.y)}" data-action="style-y"${positionAttributes('style-y')} /></label>
            <label>${escapeHtml(tr(view, 'scale'))}<input type="number" min="0.01" max="100" step="0.01" value="${Number(transform.scale)}" data-action="style-scale"${positionAttributes('style-scale')} /></label>
            <label>${escapeHtml(tr(view, 'rotate'))}<input type="number" step="1" value="${Number(transform.rotation)}" data-action="style-rotation"${positionAttributes('style-rotation')} /></label>
          </div>
          <label>${escapeHtml(tr(view, 'scaleOnCanvas'))}<input type="range" min="5" max="400" value="${Math.round(Number(transform.scale) * 100)}" data-action="style-scale-preview"${forcedControlAttributes(view, 'style-scale-preview', styleSubject, positionLocked)} /></label>
          <label>${escapeHtml(tr(view, 'opacity'))}<input type="range" min="0" max="100" value="${Math.round(style.opacity * 100)}" data-action="style-opacity"${forcedControlAttributes(view, 'style-opacity', styleSubject, styleLocked)} /></label>
          <label>${escapeHtml(tr(view, 'blendMode'))}<select data-action="style-blend"${forcedControlAttributes(view, 'style-blend', styleSubject, styleLocked)}>${DONOR_BLEND_MODES.map((mode) => `<option value="${mode}" ${selected(style.blendMode, mode)}>${escapeHtml(tr(view, BLEND_COPY_KEYS[mode]))}</option>`).join('')}</select></label>
          <label>${escapeHtml(tr(view, 'smartColor'))}<select data-action="style-channel"${forcedControlAttributes(view, 'style-channel', styleSubject, styleLocked)}>${colorOptions}</select></label>
          <section class="v4-visibility-summary">
            <span>${escapeHtml(tr(view, 'showThisStyle'))}</span>
            <strong>${escapeHtml(visibilityText)}</strong>
            <small>${escapeHtml(tr(view, 'visibilityDoesNotChangeRecipe'))}</small>
            <div>
              <button type="button" data-action="edit-style-visibility"${forcedControlAttributes(view, 'edit-style-visibility', styleSubject, styleLocked)}>${escapeHtml(tr(view, 'editVisibilityCondition'))}</button>
              <button type="button" data-action="clear-style-visibility"${forcedControlAttributes(view, 'clear-style-visibility', styleSubject, styleLocked || !visibility)}>${escapeHtml(tr(view, 'setAlwaysVisible'))}</button>
            </div>
          </section>
          <div class="v4-inline-actions"><button type="button" data-action="toggle-style-hidden"${controlAttributes(view, 'toggle-style-hidden', styleSubject)}>${escapeHtml(tr(view, style.hidden ? 'showStyle' : 'hideStyle'))}</button></div>
          ${positionEditorOpen ? `<small>${escapeHtml(tr(view, 'dragPositionCopy'))}</small>` : ''}
        ` : `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noStylesYet'))}</strong><span>${escapeHtml(tr(view, 'addStyleCopy'))}</span></div>`}
      </div>` : ''}`;
}

function advancedTitle(view) {
  return view.tabs.find((tab) => tab.id === view.activeTab)?.label || tr(view, 'partsItems');
}

function makerInfo(view) {
  const document = view.document;
  const coverUrl = document.metadata.coverAssetId ? view.assetUrls[document.metadata.coverAssetId] : '';
  const initials = document.metadata.name.trim().slice(0, 2).toUpperCase() || 'MA';
  const cover = view.makerInfo.cover;
  const coverStatusMessage = cover.message
    || (cover.saveState === 'saved' ? tr(view, 'makerCoverSaved') : '');
  const licenseKeys = {
    'personal-use': 'licensePersonalUse',
    'free-remix': 'licenseFreeRemix',
    'paid-commercial': 'licensePaidCommercial',
    'exclusive-commission': 'licenseExclusiveCommission',
  };
  const makerInfoControl = (action, value, { wide = false, textarea = false } = {}) => {
    const status = makerInfoByteStatus(action, value);
    const attributes = `data-action="${action}" maxlength="${status.limit}" aria-describedby="${status.statusId}" aria-invalid="${status.valid ? 'false' : 'true'}"${controlAttributes(view, action)}`;
    const control = textarea
      ? `<textarea ${attributes}>${escapeHtml(value)}</textarea>`
      : `<input value="${escapeHtml(value)}" ${attributes} />`;
    const count = tr(view, 'makerInfoByteCount', { bytes: status.bytes, limit: status.limit });
    const statusText = status.valid
      ? count
      : `${count} · ${tr(view, 'makerInfoByteExceeded', { over: status.over })}`;
    return `<label class="${wide ? 'wide' : ''}">${escapeHtml(tr(view, status.labelKey))}${control}<small id="${status.statusId}" data-maker-byte-status="${action}" class="v4-maker-info-byte-status ${status.valid ? '' : 'invalid'}">${escapeHtml(statusText)}</small></label>`;
  };
  return `
    <div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'makerInfo'))}</span><h3>${escapeHtml(tr(view, 'makerInfoTitle'))}</h3><p>${escapeHtml(tr(view, 'makerInfoCopy'))}</p></div></div>
    <div class="v4-maker-info-workspace">
      <section class="v4-maker-cover-editor">
        <div class="v4-maker-cover-preview ${coverUrl ? 'has-image' : ''}">${coverUrl ? `<img data-maker-cover-preview-image src="${escapeHtml(coverUrl)}" alt="${escapeHtml(tr(view, 'makerCoverAlt', { name: document.metadata.name }))}" /><span data-maker-cover-preview-fallback hidden aria-hidden="true">${escapeHtml(initials)}</span>` : `<span aria-hidden="true">${escapeHtml(initials)}</span>`}</div>
        <div><strong>${escapeHtml(tr(view, 'makerCover'))}</strong><p>${escapeHtml(tr(view, 'makerCoverCopy'))}</p><div class="v4-inline-actions"><label class="v4-file-button${cover.saving || controlDisabled(view, 'maker-cover') ? ' disabled' : ''}">${escapeHtml(tr(view, coverUrl ? 'replaceMakerCover' : 'uploadMakerCover'))}<input type="file" accept="image/png,image/jpeg" data-action="maker-cover"${forcedControlAttributes(view, 'maker-cover', '', cover.saving)} /></label><button type="button" class="danger" data-action="remove-maker-cover"${forcedControlAttributes(view, 'remove-maker-cover', '', !document.metadata.coverAssetId || cover.saving)}>${escapeHtml(tr(view, 'removeMakerCover'))}</button></div>${coverStatusMessage ? `<p class="v4-maker-cover-save-status ${escapeHtml(cover.saveState)}" role="status" aria-live="polite"><i aria-hidden="true"></i><span>${escapeHtml(coverStatusMessage)}</span></p>` : ''}<small>${escapeHtml(tr(view, 'makerCoverRequirements'))}</small></div>
      </section>
      <section class="v4-maker-info-form">
        ${makerInfoControl('maker-name', view.makerInfo.values['maker-name'])}
        ${makerInfoControl('maker-creator', view.makerInfo.values['maker-creator'])}
        ${makerInfoControl('maker-summary', view.makerInfo.values['maker-summary'], { wide: true, textarea: true })}
        ${makerInfoControl('maker-style', view.makerInfo.values['maker-style'])}
        <label>${escapeHtml(tr(view, 'makerLicense'))}<select data-action="maker-license-kind"${controlAttributes(view, 'maker-license-kind')}>${Object.entries(licenseKeys).map(([kind, key]) => `<option value="${kind}" ${selected(document.metadata.license.kind, kind)}>${escapeHtml(tr(view, key))}</option>`).join('')}</select></label>
        ${makerInfoControl('maker-license-note', view.makerInfo.values['maker-license-note'], { wide: true, textarea: true })}
      </section>
      <dl class="v4-maker-info-facts"><div><dt>${escapeHtml(tr(view, 'makerId'))}</dt><dd><code>${escapeHtml(document.lineage.makerKey)}</code></dd></div><div><dt>${escapeHtml(tr(view, 'version'))}</dt><dd><code>v${document.lineage.version}</code></dd></div><div><dt>${escapeHtml(tr(view, 'makerCanvas'))}</dt><dd>${document.canvas.width} × ${document.canvas.height}</dd></div></dl>
    </div>`;
}

function layerTracks(view) {
  const { part, item, style } = selectedViewRecords(view);
  const sync = creatorLinkedTrackSyncState(view.document);
  const trackOptions = [`<option value="">${escapeHtml(tr(view, 'noLayerTrack'))}</option>`, ...view.document.tracks.map((track) => `<option value="${escapeHtml(track.key)}" ${selected(style?.trackKey, track.key)}>${escapeHtml(track.label)}</option>`)].join('');
  const rows = [...view.document.tracks]
    .sort((left, right) => left.renderOrder - right.renderOrder || left.key.localeCompare(right.key))
    .map((track) => {
      const subject = track.key;
      const trackState = creatorTrackState(view.document, track.key);
      const bindings = view.parts.flatMap((candidatePart) => candidatePart.items.flatMap((candidateItem) => candidateItem.styles.filter((candidateStyle) => candidateStyle.trackKey === track.key).map((candidateStyle) => ({
        part: candidatePart,
        item: candidateItem,
        style: candidateStyle,
      }))));
      const owners = [...new Set(bindings.map((binding) => binding.part.key))];
      const placement = trackState.linked
        ? tr(view, 'trackFollowsPart', { part: bindings[0].part.label })
        : owners.length > 0
          ? tr(view, 'trackCustomOwners', { count: owners.length })
          : tr(view, 'trackUnassigned');
      return `<div class="v4-track-row ${track.key === view.selectedTrackKey ? 'active' : ''} ${trackState.linked ? 'linked-part' : 'custom-track'} ${track.locked ? 'locked' : ''}" draggable="${!trackState.orderLocked && resolveCapability(view.capabilities, 'move-track', subject).enabled}" data-drag-kind="track" data-drag-id="${escapeHtml(track.key)}" data-drop-kind="track"><button type="button" data-action="select-track" data-track-id="${escapeHtml(track.key)}"${controlAttributes(view, 'select-track', subject)}><span>⋮⋮</span><strong>${escapeHtml(track.label)}</strong><small>${escapeHtml(tr(view, 'trackStyleCount', { count: bindings.length }))}</small></button><input value="${escapeHtml(track.label)}" data-action="track-name" data-track-id="${escapeHtml(track.key)}" maxlength="128"${forcedControlAttributes(view, 'track-name', subject, !trackState.canRename)} /><span class="v4-track-placement">${escapeHtml(placement)}${track.locked ? ` · ${escapeHtml(tr(view, 'trackLocked'))}` : ''}</span><div><button type="button" data-action="toggle-track-lock" data-track-id="${escapeHtml(track.key)}"${controlAttributes(view, 'toggle-track-lock', subject)}>${escapeHtml(tr(view, track.locked ? 'unlockTrack' : 'lockTrack'))}</button><button type="button" data-action="move-track" data-track-id="${escapeHtml(track.key)}" data-direction="up" aria-label="${escapeHtml(tr(view, 'moveTrackBack'))}" title="${escapeHtml(tr(view, 'moveTrackBack'))}"${forcedControlAttributes(view, 'move-track', `${subject}:up`, !trackState.canMoveBack)}>↑</button><button type="button" data-action="move-track" data-track-id="${escapeHtml(track.key)}" data-direction="down" aria-label="${escapeHtml(tr(view, 'moveTrackFront'))}" title="${escapeHtml(tr(view, 'moveTrackFront'))}"${forcedControlAttributes(view, 'move-track', `${subject}:down`, !trackState.canMoveFront)}>↓</button><button type="button" data-action="delete-track" data-track-id="${escapeHtml(track.key)}" aria-label="${escapeHtml(tr(view, 'deleteTrackAria'))}"${forcedControlAttributes(view, 'delete-track', subject, !trackState.canDelete)}>×</button></div><div class="v4-track-bindings"><strong>${escapeHtml(tr(view, 'trackBindings'))}</strong>${bindings.length ? bindings.map((binding) => `<button type="button" data-action="select-style-binding" data-part-id="${escapeHtml(binding.part.key)}" data-item-id="${escapeHtml(binding.item.key)}" data-style-id="${escapeHtml(binding.style.key)}" title="${escapeHtml(tr(view, 'openStyleBinding'))}"${controlAttributes(view, 'select-style-binding', `${binding.part.key}/${binding.item.key}/${binding.style.key}`)}>${escapeHtml(binding.part.label)} › ${escapeHtml(binding.item.label)} › ${escapeHtml(binding.style.label)}</button>`).join('') : `<span>${escapeHtml(tr(view, 'noTrackBindings'))}</span>`}</div></div>`;
    }).join('');
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'layerTracks'))}</span><h3>${escapeHtml(tr(view, 'layerOrderTitle'))}</h3><p>${escapeHtml(tr(view, 'layerOrderCopy'))}</p></div><div><button type="button" data-action="sync-linked-track-order"${forcedControlAttributes(view, 'sync-linked-track-order', '', sync.matches || sync.blocked)}>${escapeHtml(tr(view, sync.matches ? 'linkedOrderSynced' : 'syncLinkedOrder'))}</button><button type="button" data-action="add-track"${controlAttributes(view, 'add-track')}>${escapeHtml(tr(view, 'addTrack'))}</button></div></div>${style ? `<div class="v4-track-assignment"><div><span>${escapeHtml(tr(view, 'currentStyle'))}</span><strong>${escapeHtml([part?.label, item?.label, style.label].filter(Boolean).join(' › '))}</strong></div><label>${escapeHtml(tr(view, 'layerTrack'))}<select data-action="assign-style-track"${forcedControlAttributes(view, 'assign-style-track', `${part.key}/${item.key}/${style.key}`, creatorStyleEditorState(style).styleLocked)}>${trackOptions}</select></label></div>` : ''}<div class="v4-track-list">${rows || `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'emptyTracks'))}</span></div>`}</div>`;
}

function smartColor(view) {
  const selectedChannel = view.document.colors.find((channel) => channel.key === view.selectedColorKey)
    || view.document.colors[0]
    || null;
  const channelLocked = selectedChannel && view.parts.some(part => part.items.some(item => item.styles.some(style =>
    style.colorChannelKey === selectedChannel.key && creatorStyleEditorState(style).styleLocked)));
  const colorControl = (currentView, action, subject = '') => {
    if (['select-channel', 'add-channel'].includes(action)) return controlAttributes(currentView, action, subject);
    const channelAttribute = ['channel-name', 'channel-default-swatch', 'delete-channel', 'add-swatch', 'delete-swatch'].includes(action)
      ? ` data-channel-id="${escapeHtml(selectedChannel?.key || '')}"` : '';
    return channelAttribute + forcedControlAttributes(currentView, action, subject,
      channelLocked || (action === 'delete-swatch' && selectedChannel.swatches.length <= 1));
  };
  const channels = view.document.colors.map((channel) => `<button type="button" class="v4-color-channel-card ${selectedChannel?.key === channel.key ? 'active' : ''}" data-action="select-channel" data-channel-id="${escapeHtml(channel.key)}"${colorControl(view, 'select-channel', channel.key)}><span style="--swatch:${escapeHtml(channel.swatches.find((swatch) => swatch.key === channel.defaultSwatchKey)?.rgba.slice(0, 7) || '#7b5cff')}"></span><strong>${escapeHtml(channel.label)}</strong><small>${escapeHtml(tr(view, 'colorCountMode', { count: channel.swatches.length, mode: tr(view, 'gradientMap') }))}</small></button>`).join('');
  const linkedStyles = selectedChannel ? view.parts.flatMap((candidatePart) => candidatePart.items.flatMap((candidateItem) => candidateItem.styles.filter((candidateStyle) => candidateStyle.colorChannelKey === selectedChannel.key).map((candidateStyle) => `${candidatePart.label} / ${candidateItem.label} / ${candidateStyle.label}`))) : [];
  const swatches = selectedChannel?.swatches.map((swatch) => {
    const subject = `${selectedChannel.key}/${swatch.key}`;
    const stops = creatorColorStops(swatch);
    const middle = stops.length === 2 ? swatch.rgba : stops[Math.floor((stops.length - 1) / 2)].rgba;
    return `<div class="v4-swatch-editor ${swatch.key === selectedChannel.defaultSwatchKey ? 'default' : ''}"><input type="radio" name="v4-default-swatch" value="${escapeHtml(swatch.key)}" ${checked(swatch.key === selectedChannel.defaultSwatchKey)} data-action="channel-default-swatch" title="${escapeHtml(tr(view, 'defaultColor'))}"${colorControl(view, 'channel-default-swatch', subject)} /><label class="v4-swatch-name"><span>${escapeHtml(tr(view, 'playerColorPresetName'))}</span><input value="${escapeHtml(swatch.label)}" data-action="swatch-name" data-channel-id="${escapeHtml(selectedChannel.key)}" data-swatch-id="${escapeHtml(swatch.key)}" maxlength="128"${colorControl(view, 'swatch-name', subject)} /></label><label class="v4-swatch-primary">${escapeHtml(tr(view, 'primaryColor'))}<input type="color" value="${escapeHtml(swatch.rgba.slice(0, 7))}" data-action="swatch-hint" data-channel-id="${escapeHtml(selectedChannel.key)}" data-swatch-id="${escapeHtml(swatch.key)}"${colorControl(view, 'swatch-hint', subject)} /></label><details class="v4-swatch-gradient" data-creator-generation="${view.creatorGeneration}" data-creator-gradient="${escapeHtml(JSON.stringify([selectedChannel.key, swatch.key]))}"${view.openGradientKeys.includes(JSON.stringify([selectedChannel.key, swatch.key])) ? ' open' : ''}><summary>${escapeHtml(tr(view, 'advancedGradient'))}</summary><div><label>${escapeHtml(tr(view, 'shadow'))}<input type="color" value="${escapeHtml(stops[0].rgba.slice(0, 7))}" data-action="swatch-stop" data-channel-id="${escapeHtml(selectedChannel.key)}" data-swatch-id="${escapeHtml(swatch.key)}" data-stop-index="0"${colorControl(view, 'swatch-stop', `${subject}/0`)} /></label><label>${escapeHtml(tr(view, 'mid'))}<input type="color" value="${escapeHtml(middle.slice(0, 7))}" data-action="swatch-mid" data-channel-id="${escapeHtml(selectedChannel.key)}" data-swatch-id="${escapeHtml(swatch.key)}"${colorControl(view, 'swatch-mid', subject)} /></label><label>${escapeHtml(tr(view, 'light'))}<input type="color" value="${escapeHtml(stops.at(-1).rgba.slice(0, 7))}" data-action="swatch-stop" data-channel-id="${escapeHtml(selectedChannel.key)}" data-swatch-id="${escapeHtml(swatch.key)}" data-stop-index="${(stops.length - 1)}"${colorControl(view, 'swatch-stop', `${subject}/${(stops.length - 1)}`)} /></label></div></details><button type="button" data-action="delete-swatch" data-swatch-id="${escapeHtml(swatch.key)}" aria-label="${escapeHtml(tr(view, 'deleteColorPresetAria'))}"${colorControl(view, 'delete-swatch', subject)}>×</button></div>`;
  }).join('') || '';
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'smartColor'))}</span><h3>${escapeHtml(tr(view, 'smartColorTitle'))}</h3><p>${escapeHtml(tr(view, 'smartColorCopy'))}</p></div><button type="button" data-action="add-channel"${colorControl(view, 'add-channel')}>${escapeHtml(tr(view, 'addChannel'))}</button></div><div class="v4-color-workspace"><div class="v4-color-channel-list">${channels || `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'createChannelCopy'))}</span></div>`}</div>${selectedChannel ? `<div class="v4-color-detail"><div class="v4-form-row"><label>${escapeHtml(tr(view, 'name'))}<input value="${escapeHtml(selectedChannel.label)}" data-action="channel-name"${colorControl(view, 'channel-name', selectedChannel.key)} /></label><span>${escapeHtml(tr(view, 'gradientMap'))}</span><button type="button" class="danger" data-action="delete-channel"${colorControl(view, 'delete-channel', selectedChannel.key)}>${escapeHtml(tr(view, 'delete'))}</button></div><p class="v4-color-preset-copy">${escapeHtml(tr(view, 'playerSelectableColorPresets'))}</p><div class="v4-swatch-list">${swatches}</div><button type="button" data-action="add-swatch"${colorControl(view, 'add-swatch', selectedChannel.key)}>${escapeHtml(tr(view, 'colorPreset'))}</button><p class="v4-linked-copy"><strong>${escapeHtml(tr(view, 'linkedStyles'))}</strong> ${linkedStyles.length ? linkedStyles.map(escapeHtml).join(' · ') : escapeHtml(tr(view, 'noneYet'))}</p></div>` : ''}</div>`;
}

function rules(view) {
  const { part: selectedPart, item: selectedItem, style: selectedStyle } = selectedViewRecords(view);
  const editor = view.ruleEditor;
  const definitions = view.parts.flatMap((part) => [
    { kind: 'part', partKey: part.key, value: part.key, path: part.label, label: tr(view, 'wholePartSelection', { part: part.label }) },
    ...part.items.flatMap((item) => [
      { kind: 'item', partKey: part.key, itemKey: item.key, value: `${part.key}::${item.key}`, path: `${part.label} / ${item.label}`, label: item.label },
      ...item.styles.map((style) => ({
        kind: 'style',
        partKey: part.key,
        itemKey: item.key,
        styleKey: style.key,
        value: `${part.key}::${item.key}::${style.key}`,
        path: `${part.label} / ${item.label} / ${style.label}`,
        label: style.label,
        locked: style.styleLocked,
      })),
    ]),
  ]);
  const ownerDefinition = definitions.some((record) => record.value === editor.builder.ownerDefinition)
    ? editor.builder.ownerDefinition
    : selectedItem ? `${selectedPart.key}::${selectedItem.key}` : selectedPart?.key || '';
  const ownerPartKey = definitions.find((record) => record.value === ownerDefinition)?.partKey || '';
  const ownerLocked = definitions.find(record => record.value === ownerDefinition)?.locked === true;
  const ownerOptions = view.parts.map((part) => {
    const records = definitions.filter((record) => record.partKey === part.key);
    return `<optgroup label="${escapeHtml(part.label)}">${records.map((record) => `<option value="${escapeHtml(record.value)}" data-rule-owner-option="${escapeHtml(record.path)}" data-rule-owner-locked="${record.locked ? 'true' : 'false'}" ${selected(record.value, ownerDefinition)} ${record.locked ? 'disabled' : ''}>${escapeHtml(record.label)}${record.locked ? ` · ${escapeHtml(tr(view, 'styleLock'))}` : ''}</option>`).join('')}</optgroup>`;
  }).join('');
  const targetGroups = (action, definitionsValue, kind, excludedPartKey = ownerPartKey) => view.parts
    .filter((part) => part.key !== excludedPartKey)
    .map((part) => {
      const records = definitions.filter((record) => record.partKey === part.key);
      return {
        label: part.label,
        meta: tr(view, kind === 'visibility' ? 'visibilityDependency' : 'part'),
        open: records.some((record) => definitionsValue.includes(record.value)),
        records: records.map((record) => ({
          kind: record.kind,
          searchText: `${record.path} ${record.kind}`,
          value: record.value,
          checked: definitionsValue.includes(record.value),
          disabled: controlDisabled(view, action, record.value, kind === 'visibility' && selectedStyle?.styleLocked),
          label: record.kind === 'part'
            ? tr(view, 'anyItemInPart', { part: part.label })
            : record.label,
          detail: tr(view, `ruleTarget${record.kind[0].toUpperCase()}${record.kind.slice(1)}`),
          action,
          data: kind === 'visibility' ? { visibilityTarget: 'true', creatorGeneration: String(view.creatorGeneration),
            visibilityDraft: view.draftId, visibilitySubject: [view.selection.partKey, view.selection.itemKey, view.selection.styleKey].join('/') } : { ruleTarget: 'true' },
        })),
      };
    });
  const availabilityGroups = targetGroups(
    'rule-target-choice',
    editor.builder.definitions,
    'availability',
  );
  const selectorLabel = (selector) => {
    const part = view.parts.find((candidate) => candidate.key === selector.partKey);
    // Remote keys are scoped to their own definitions, not local namesakes.
    const item = ['BASE', 'ANY'].includes(selector.source)
      ? part?.items.find((candidate) => candidate.key === selector.itemKey) : null;
    const style = item?.styles.find((candidate) => candidate.key === selector.styleKey);
    const path = [part?.label || selector.partKey];
    if (selector.itemKey !== null) path.push(item?.label || selector.itemKey);
    if (selector.styleKey !== null) path.push(style?.label || selector.styleKey);
    const level = selector.styleKey !== null ? 'ruleTargetStyle' : selector.itemKey !== null ? 'ruleTargetItem' : 'ruleTargetPart';
    const scope = selector.sourceKey === null ? selector.source : `${selector.source}: ${selector.sourceKey}`;
    return `[${scope}] ${path.join(' / ')} · ${tr(view, level)}`;
  };
  const ruleGroups = view.document.rules.map((rule) => {
    const lockedOwner = ['BASE', 'ANY'].includes(rule.trigger.source) && rule.trigger.styleKey !== null
      && definitions.some(record => record.locked
        && record.value === [rule.trigger.partKey, rule.trigger.itemKey, rule.trigger.styleKey].join('::'));
    return {
      eyebrow: tr(view, 'ruleWhenSelection'),
      ownerLabel: selectorLabel(rule.trigger),
      badge: tr(view, rule.kind === 'REQUIRE' ? 'requiresLabel' : 'ruleNotBadge'),
      rows: [{
        typeLabel: rule.kind === 'EXCLUDE'
          ? `${tr(view, 'ruleConflictShort')} (ANY)`
          : tr(view, rule.targetMode === 'ANY' ? 'ruleAnyTargets' : 'ruleAllTargets'),
        targetLabel: rule.targets.map(selectorLabel).join(' · '),
        deleteAction: 'delete-rule',
        data: { ruleId: rule.key },
        deleteLabel: tr(view, 'deleteRuleAria'),
        deleteDisabled: lockedOwner || controlDisabled(view, 'delete-rule', rule.key),
      }],
    };
  });
  const availabilityPanel = `
    <section id="v4RuleAvailabilityPanel" class="v4-rule-editor-panel" role="tabpanel" aria-labelledby="v4RuleAvailabilityTab" ${editor.intent === 'availability' ? '' : 'hidden'}>
      <div class="v4-rule-builder">
        <div class="v4-rule-owner-picker">
          <label>${escapeHtml(tr(view, 'ruleSearchOwner'))}<input type="search" data-action="rule-owner-search" value="${escapeHtml(editor.ownerQuery)}" placeholder="${escapeHtml(tr(view, 'ruleSearchPlaceholder'))}"${controlAttributes(view, 'rule-owner-search')} /></label>
          <label>${escapeHtml(tr(view, 'ruleWhenSelection'))}<select id="v4RuleOwnerDefinition" data-action="rule-owner-choice"${controlAttributes(view, 'rule-owner-choice')}>${ownerOptions}</select></label>
          <small data-rule-owner-search-count>${escapeHtml(tr(view, 'ruleSearchResultCount', { count: definitions.length }))}</small>
        </div>
        <fieldset class="v4-rule-type-picker">
          <legend>${escapeHtml(tr(view, 'ruleResult'))}</legend>
          <label><input type="radio" name="v4-rule-type" value="excludes" data-action="rule-type-choice" ${checked(editor.builder.type === 'excludes')}${controlAttributes(view, 'rule-type-choice', 'excludes')} /> <span><strong>${escapeHtml(tr(view, 'cannotCombineWith'))}</strong><small>${escapeHtml(tr(view, 'ruleConflictShort'))}</small></span></label>
          <label><input type="radio" name="v4-rule-type" value="requires" data-action="rule-type-choice" ${checked(editor.builder.type === 'requires')}${controlAttributes(view, 'rule-type-choice', 'requires')} /> <span><strong>${escapeHtml(tr(view, 'requiresLabel'))}</strong><small>${escapeHtml(tr(view, 'ruleRequiresShort'))}</small></span></label>
          <select id="v4RuleType" aria-hidden="true" tabindex="-1"><option value="excludes">excludes</option><option value="requires">requires</option></select>
        </fieldset>
        ${editor.builder.type === 'requires' ? `<label class="v4-rule-match-mode">${escapeHtml(tr(view, 'ruleMatchMode'))}<select id="v4RuleMatchMode" data-action="rule-match-choice"${controlAttributes(view, 'rule-match-choice')}><option value="all" ${selected(editor.builder.matchMode, 'all')}>${escapeHtml(tr(view, 'ruleAllTargets'))}</option><option value="any" ${selected(editor.builder.matchMode, 'any')}>${escapeHtml(tr(view, 'ruleAnyTargets'))}</option></select><small>${escapeHtml(tr(view, 'ruleLogicHelp'))}</small></label>` : ''}
        <div class="v4-rule-target-picker">
          <span>${escapeHtml(tr(view, 'targetDefinition'))}</span><small>${escapeHtml(tr(view, 'ruleTreeHint'))}</small>
          <label class="v4-rule-search">${escapeHtml(tr(view, 'ruleSearchTargets'))}<input type="search" data-action="rule-target-search" value="${escapeHtml(editor.targetQuery)}" placeholder="${escapeHtml(tr(view, 'ruleSearchPlaceholder'))}"${controlAttributes(view, 'rule-target-search')} /></label>
          <small data-rule-search-count>${escapeHtml(tr(view, 'ruleSearchResultCount', { count: definitions.filter((record) => record.partKey !== ownerPartKey).length }))}</small>
          ${renderSharedRuleTargetTree({ groups: availabilityGroups, kind: 'availability', tailHtml: `<div class="v4-inline-empty" data-rule-search-empty hidden><span>${escapeHtml(tr(view, 'ruleSearchEmpty'))}</span></div>` })}
        </div>
        <button class="primary" type="button" data-action="add-rule"${forcedControlAttributes(view, 'add-rule', ownerDefinition, ownerLocked)}>${escapeHtml(tr(view, 'addRule'))}</button>
      </div>
      ${editor.error ? `<div class="v4-rule-error" role="alert">${escapeHtml(editor.error)}</div>` : ''}
      ${renderSharedRuleListEditor({ groups: ruleGroups, emptyHtml: `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noConstraints'))}</strong><span>${escapeHtml(tr(view, 'noConstraintsHelp'))}</span></div>` })}
    </section>`;
  const visibilityDefinitions = editor.visibility.definitions;
  const visibilityGroups = targetGroups(
    'visibility-target-choice',
    visibilityDefinitions,
    'visibility',
    selectedPart?.key || '',
  );
  const visibilityLabels = visibilityDefinitions.map((definition) => (
    definitions.find((record) => record.value === definition)?.path || definition
  ));
  const visibilityTargets = visibilityLabels.join(
    editor.visibility.logic === 'any' ? tr(view, 'visibilityOrSeparator') : tr(view, 'visibilityAndSeparator'),
  );
  const visibilityText = editor.visibility.advanced ? tr(view, 'visibilityAdvancedSummary') : !visibilityLabels.length
    ? tr(view, 'visibilityPreviewEmpty')
    : editor.visibility.polarity === 'not-selected'
      ? tr(view, editor.visibility.logic === 'any' ? 'visibilityAnyNotSelectedSummary' : 'visibilityAllNotSelectedSummary', { targets: visibilityTargets })
      : tr(view, editor.visibility.logic === 'any' ? 'visibilityAnySelectedSummary' : 'visibilityAllSelectedSummary', { targets: visibilityTargets });
  const selectedStyleSubject = selectedStyle
    ? `${selectedPart.key}/${selectedItem.key}/${selectedStyle.key}`
    : '';
  const visibilityPanel = `
    <section id="v4RuleVisibilityPanel" class="v4-rule-editor-panel" role="tabpanel" aria-labelledby="v4RuleVisibilityTab" ${editor.intent === 'visibility' ? '' : 'hidden'}>
      ${selectedStyle ? `
        <header class="v4-visibility-current"><div><span>${escapeHtml(tr(view, 'currentStyle'))}</span><strong>${escapeHtml(`${selectedPart.label} › ${selectedItem.label} › ${selectedStyle.label}`)}</strong></div><small>${escapeHtml(tr(view, 'visibilityDoesNotChangeRecipe'))}</small></header>
        ${selectedStyle.styleLocked ? `<div id="v4VisibilityLockedHint" class="v4-rule-warning"><strong>${escapeHtml(tr(view, 'styleLock'))}</strong><span>${escapeHtml(tr(view, 'visibilityLockedHelp'))}</span></div>` : ''}
        ${makerV8VisibilityEditorModel(selectedStyle.visibleWhen, { parts: view.document.parts }).advanced ? `<div class="v4-rule-warning"><strong>${escapeHtml(tr(view, 'visibilityAdvancedSummary'))}</strong><span>${escapeHtml(tr(view, 'visibilityAdvancedReplaceHelp'))}</span></div>` : ''}
        <fieldset class="v4-visibility-builder" ${selectedStyle.styleLocked ? 'disabled aria-describedby="v4VisibilityLockedHint"' : ''}>
          <label>${escapeHtml(tr(view, 'visibilityLogic'))}<select id="v4VisibilityMatchMode" data-action="visibility-match-choice"${forcedControlAttributes(view, 'visibility-match-choice', selectedStyleSubject, selectedStyle.styleLocked)}><option value="all" ${selected(editor.visibility.logic, 'all')}>${escapeHtml(tr(view, 'visibilityAllTargets'))}</option><option value="any" ${selected(editor.visibility.logic, 'any')}>${escapeHtml(tr(view, 'visibilityAnyTargets'))}</option></select></label>
          <label>${escapeHtml(tr(view, 'visibilityState'))}<select id="v4VisibilityPolarity" data-action="visibility-polarity-choice"${forcedControlAttributes(view, 'visibility-polarity-choice', selectedStyleSubject, selectedStyle.styleLocked)}><option value="selected" ${selected(editor.visibility.polarity, 'selected')}>${escapeHtml(tr(view, 'visibilityWhenSelected'))}</option><option value="not-selected" ${selected(editor.visibility.polarity, 'not-selected')}>${escapeHtml(tr(view, 'visibilityWhenNotSelected'))}</option></select></label>
          <div class="v4-rule-target-picker"><span>${escapeHtml(tr(view, 'visibilityTargets'))}</span><small>${escapeHtml(tr(view, 'visibilityTreeHint'))}</small><label class="v4-rule-search">${escapeHtml(tr(view, 'ruleSearchTargets'))}<input type="search" data-action="visibility-target-search" value="${escapeHtml(editor.visibilityQuery)}" placeholder="${escapeHtml(tr(view, 'ruleSearchPlaceholder'))}"${forcedControlAttributes(view, 'visibility-target-search', selectedStyleSubject, selectedStyle.styleLocked)} /></label><small data-rule-search-count>${escapeHtml(tr(view, 'ruleSearchResultCount', { count: definitions.filter((record) => record.partKey !== selectedPart.key).length }))}</small>${renderSharedRuleTargetTree({ groups: visibilityGroups, kind: 'visibility', emptyHtml: `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'visibilityNoOtherParts'))}</span></div>`, tailHtml: `<div class="v4-inline-empty" data-rule-search-empty hidden><span>${escapeHtml(tr(view, 'ruleSearchEmpty'))}</span></div>` })}</div>
          <div class="v4-visibility-footer"><p class="v4-visibility-preview" aria-live="polite"><span>${escapeHtml(tr(view, 'visibilityPreview'))}</span><strong>${escapeHtml(visibilityText)}</strong></p><div class="v4-inline-actions"><button class="primary" type="button" data-action="apply-style-visibility"${forcedControlAttributes(view, 'apply-style-visibility', selectedStyleSubject, selectedStyle.styleLocked)}>${escapeHtml(tr(view, 'applyVisibilityCondition'))}</button><button type="button" data-action="clear-style-visibility"${forcedControlAttributes(view, 'clear-style-visibility', selectedStyleSubject, selectedStyle.styleLocked || !selectedStyle.visibleWhen)}>${escapeHtml(tr(view, 'setAlwaysVisible'))}</button></div></div>
        </fieldset>
        ${editor.visibilityError ? `<div class="v4-rule-error" role="alert">${escapeHtml(editor.visibilityError)}</div>` : ''}
      ` : `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noStyleForVisibility'))}</strong><span>${escapeHtml(tr(view, 'noStyleForVisibilityHelp'))}</span></div>`}
    </section>`;
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'rules'))}</span><h3>${escapeHtml(tr(view, 'rulesTitle'))}</h3><p>${escapeHtml(tr(view, 'rulesCopy'))}</p></div></div><nav class="v4-rule-intents" role="tablist" aria-label="${escapeHtml(tr(view, 'rules'))}"><button type="button" id="v4RuleAvailabilityTab" class="${editor.intent === 'availability' ? 'active' : ''}" data-action="rules-editor-intent" data-intent="availability" role="tab" aria-controls="v4RuleAvailabilityPanel" aria-selected="${editor.intent === 'availability'}" tabindex="${editor.intent === 'availability' ? '0' : '-1'}"${controlAttributes(view, 'rules-editor-intent', 'availability')}><strong>${escapeHtml(tr(view, 'combinationRules'))}</strong><small>${escapeHtml(tr(view, 'combinationRulesCopy'))}</small></button><button type="button" id="v4RuleVisibilityTab" class="${editor.intent === 'visibility' ? 'active' : ''}" data-action="rules-editor-intent" data-intent="visibility" role="tab" aria-controls="v4RuleVisibilityPanel" aria-selected="${editor.intent === 'visibility'}" tabindex="${editor.intent === 'visibility' ? '0' : '-1'}"${controlAttributes(view, 'rules-editor-intent', 'visibility')}><strong>${escapeHtml(tr(view, 'styleVisibilityRules'))}</strong><small>${escapeHtml(tr(view, 'styleVisibilityRulesCopy'))}</small></button></nav>${availabilityPanel}${visibilityPanel}`;
}

function expansionPacks(view) {
  const rows = view.expansionPacks.map((pack) => {
    const details = pack.chainOnly
      ? tr(view, 'expansionPackLifecycleChainOnly')
      : `${pack.namespace} · ${pack.version} · ${tr(view, 'packSavedRevision', { revision: pack.revision })}`;
    return `<article class="v4-pack-project-row" data-pack-project-key="${escapeHtml(pack.key)}" data-pack-chain-only="${pack.chainOnly}"><span class="v4-pack-project-summary"><strong>${escapeHtml(pack.name)}</strong><small>${escapeHtml(details)}</small><em>${escapeHtml(tr(view, pack.publishable ? 'packExactParentStatus' : 'packLocalParentStatus'))}</em></span><span class="v4-pack-project-actions"><span class="maker-lifecycle-badge ${escapeHtml(pack.lifecycle.badgeClass)}" data-pack-lifecycle-badge>${escapeHtml(pack.lifecycle.label)}</span><button type="button" data-action="open-expansion-pack-studio" data-pack-project-key="${escapeHtml(pack.key)}" data-pack-id="${escapeHtml(pack.packId)}" data-parent-binding-identity="${escapeHtml(pack.parentBindingIdentity)}"${forcedControlAttributes(view, 'open-expansion-pack-studio', pack.key, pack.chainOnly)}>${escapeHtml(tr(view, pack.chainOnly ? 'expansionPackLifecycleInspect' : 'expansionPackLifecycleOpen'))}</button><button type="button" data-action="manage-expansion-pack-lifecycle" data-pack-project-key="${escapeHtml(pack.key)}" aria-label="${escapeHtml(tr(view, 'expansionPackLifecycleManageAria', { name: pack.name }))}"${controlAttributes(view, 'manage-expansion-pack-lifecycle', pack.key)}>${escapeHtml(tr(view, 'expansionPackLifecycleManage'))}</button></span></article>`;
  }).join('');
  const status = view.expansionPacksStatus === 'loading'
    ? `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'packLoading'))}</span></div>`
    : view.expansionPacksStatus === 'wallet-required'
      ? `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'packWalletRequired'))}</strong></div>`
      : view.expansionPacksStatus === 'error'
        ? `<div class="v4-rule-error" role="alert">${escapeHtml(view.expansionPacksError || tr(view, 'packLoadFailed'))}</div>`
        : '';
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'expansionPacks'))}</span><h3>${escapeHtml(tr(view, 'packIndependentTitle'))}</h3><p>${escapeHtml(tr(view, 'packIndependentCopy'))}</p></div><button type="button" data-action="add-expansion"${controlAttributes(view, 'add-expansion')}>${escapeHtml(tr(view, 'addExpansion'))}</button></div>${view.expansionPackNotice ? `<div class="v4-rule-warning" role="status"><span>${escapeHtml(view.expansionPackNotice)}</span></div>` : ''}${status}<div class="v4-pack-project-list" data-pack-project-list>${rows || `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noExpansionPacks'))}</strong><span>${escapeHtml(tr(view, 'packEmptyProjectCopy'))}</span></div>`}</div>`;
}

function composableMakerTargets(view) {
  const guidance = {
    en: 'To create an external Product, read published Makers, inspect a Maker, then select an eligible Part and add your artwork. A local draft is not a published target. If no targets are listed, a compatible Maker must be published first.',
    zh: '创建外部 Product：先读取已发布 Maker，查看目标 Maker 的部位，再选择可用部位并添加素材。本地草稿不是已发布目标；如果列表为空，需要先发布兼容的 Maker。',
    ja: '外部 Product を作成するには、公開済み Maker を読み込み、Maker の Part を確認して、対象の Part と素材を選びます。ローカル下書きは公開済みの対象ではありません。一覧が空の場合は、先に対応する Maker の公開が必要です。',
    ko: '외부 Product를 만들려면 게시된 Maker를 읽고 Part를 확인한 다음, 사용 가능한 Part와 작품을 선택하세요. 로컬 초안은 게시된 대상이 아닙니다. 목록이 비어 있으면 호환되는 Maker를 먼저 게시해야 합니다.',
    vi: 'Để tạo Product bên ngoài, đọc Maker đã phát hành, xem Part của Maker, rồi chọn Part phù hợp và thêm hình ảnh. Bản nháp cục bộ không phải mục tiêu đã phát hành. Nếu danh sách trống, cần phát hành Maker tương thích trước.',
  };
  const words = {
    en: ['Published Maker targets', 'Read published Makers', 'No published Makers found.', 'No Parts admit external Items.', 'Inspect Parts', 'Loading…', 'Not loaded.'],
    zh: ['已发布 Maker 目标', '读取已发布 Maker', '尚无已发布 Maker。', '没有允许外部物品的部位。', '查看部位', '读取中…', '尚未读取。'],
    ja: ['公開済み Maker', '公開済み Maker を読む', '公開済み Maker はありません。', '外部 Item を許可する Part はありません。', 'Part を確認', '読み込み中…', '未読み込み。'],
    ko: ['게시된 Maker 대상', '게시된 Maker 읽기', '게시된 Maker가 없습니다.', '외부 Item을 허용하는 Part가 없습니다.', 'Part 확인', '읽는 중…', '아직 읽지 않았습니다.'],
    vi: ['Maker đã phát hành', 'Đọc Maker đã phát hành', 'Chưa có Maker đã phát hành.', 'Không có Part nhận Item bên ngoài.', 'Xem Part', 'Đang đọc…', 'Chưa đọc.'],
  };
  const copy = words[view.locale] || words.en, data = view.composableTargets;
  const busy = data?.status === 'loading', rows = data?.makers || [];
  const message = busy ? copy[5] : data?.status === 'error' ? data.error
    : data?.status === 'ready' ? (rows.length ? '' : copy[2]) : copy[6];
  const target = data?.target;
  const help = `<p data-composable-create-guidance>${escapeHtml(guidance[view.locale] || guidance.en)}</p>`;
  return `<section class="v4-composable-compatibility" data-composable-makers><h3>${escapeHtml(copy[0])}</h3>${help}<button type="button" data-action="refresh-composable-makers"${forcedControlAttributes(view, 'refresh-composable-makers', '', busy)}>${escapeHtml(copy[1])}</button><p role="status">${escapeHtml(message)}</p>${rows.map(row => `<article><strong>${escapeHtml(row.title)}</strong><p>Root: ${escapeHtml(row.rootId)}</p><button type="button" data-action="inspect-composable-maker" data-root-id="${escapeHtml(row.rootId)}"${forcedControlAttributes(view, 'inspect-composable-maker', row.rootId, busy)}>${escapeHtml(copy[4])}</button></article>`).join('')}${target ? `<p>Root: ${escapeHtml(target.rootId)} · ${escapeHtml(target.admission)}</p>${target.parts.length ? target.parts.map(part => `<p>${escapeHtml(part.label)} · capacity ${part.capacity}</p>`).join('') : `<p role="status">${escapeHtml(copy[3])}</p>`}` : ''}</section>`;
}

function composableProductSettings(view) {
  const art = view.composableArtwork, target = view.composableTargets?.target;
  if (!art?.sha256 || !art.settings || !target || art.binding.rootId !== target.rootId
    || art.binding.contentCommitment !== target.contentCommitment) return '';
  const settings = art.settings, disabled = art.status !== 'saved';
  const attrs = field => `data-action="composable-product-setting" data-field="${field}"${forcedControlAttributes(view, 'composable-product-setting', field, disabled)}`;
  const pair = JSON.stringify([settings.colorChannelKey, settings.defaultSwatchKey]);
  const text = {
    en: ['Product settings', 'Save product settings'], zh: ['产品参数', '保存产品参数'],
    ja: ['製品設定', '製品設定を保存'], ko: ['제품 설정', '제품 설정 저장'], vi: ['Cấu hình sản phẩm', 'Lưu cấu hình sản phẩm'],
  }[view.locale] || ['Product settings', 'Save product settings'];
  return `<section class="v4-composable-compatibility" data-composable-settings><h3>${escapeHtml(text[0])}</h3><label>Item key<input type="text" maxlength="128" value="${escapeHtml(settings.itemKey)}" ${attrs('itemKey')}></label><label>Style key<input type="text" maxlength="128" value="${escapeHtml(settings.styleKey)}" ${attrs('styleKey')}></label><label>Layer Track<select ${attrs('layerTrackKey')}><option value="">—</option>${(target.tracks || []).map(track => `<option value="${escapeHtml(track.key)}" ${selected(settings.layerTrackKey, track.key)}>${escapeHtml(track.label)}</option>`).join('')}</select></label><label>Color / Swatch<select ${attrs('color')}><option value="[null,null]" ${selected(pair, '[null,null]')}>—</option>${(target.colors || []).flatMap(channel => channel.swatches.map(swatch => { const value = JSON.stringify([channel.key, swatch.key]); return `<option value="${escapeHtml(value)}" ${selected(pair, value)}>${escapeHtml(channel.label)} / ${escapeHtml(swatch.label)}</option>`; })).join('')}</select></label><label><input type="checkbox" ${checked(settings.transferable)} ${attrs('transferable')}>Transferable</label><button type="button" data-action="save-composable-settings"${forcedControlAttributes(view, 'save-composable-settings', '', disabled)}>${escapeHtml(text[1])}</button></section>`;
}

function composableUploadHistory(view) {
  const texts = {
    en: ['Read upload history', 'Wallet-local external artwork uploads, including earlier source revisions.', 'No saved uploads.', 'Not loaded.', 'Loading…'],
    zh: ['读取上传历史', '当前钱包的本地外部素材上传记录，包括旧素材版本。', '没有已保存的上传记录。', '尚未读取。', '读取中…'],
    ja: ['アップロード履歴', '旧素材版を含む、このウォレットの外部素材アップロード記録。', '保存済みアップロードなし。', '未読み込み。', '読み込み中…'],
    ko: ['업로드 기록 읽기', '이전 원본 버전을 포함한 현재 지갑의 로컬 외부 소재 업로드 기록입니다.', '저장된 업로드가 없습니다.', '아직 읽지 않았습니다.', '읽는 중…'],
    vi: ['Đọc lịch sử tải lên', 'Bản ghi tải lên nguồn bên ngoài của ví, gồm các phiên bản nguồn cũ.', 'Chưa có bản ghi tải lên.', 'Chưa đọc.', 'Đang đọc…'],
  };
  const copy = texts[view.locale] || texts.en, history = view.composableUploadHistory;
  const rows = history?.rows || [], busy = history?.status === 'loading' || history?.busy;
  const status = busy ? copy[4] : history?.status === 'error' ? history.error : history?.status === 'ready' ? (rows.length ? '' : copy[2]) : copy[3];
  const actionControl = row => {
    if (row.status === 'COMPLETE' && row.stage === 'COMPLETE' && !row.error) {
      const review = history?.productReview?.requestId === row.uploadId ? history.productReview : null;
      const attempt = row.productAttempt;
      if (row.productError) return `<p role="alert">${escapeHtml(row.productError)}</p>`;
      if (attempt) {
        return `<p role="status">Product: ${escapeHtml(attempt.status)}</p>${attempt.ticket ? `<p>Transaction: ${escapeHtml(attempt.ticket.digest)}</p>` : ''}${attempt.readback?.productId ? `<p>Product ID: ${escapeHtml(attempt.readback.productId)}</p>` : ''}${attempt.status === 'ACTIVE' ? `<button type="button" data-action="${attempt.ticket ? 'recover-composable-product' : 'create-composable-product'}" data-upload-id="${escapeHtml(row.uploadId)}"${forcedControlAttributes(view, attempt.ticket ? 'recover-composable-product' : 'create-composable-product', '', busy || !view.composableUploadWriteEnabled)}>${attempt.ticket ? 'Recover Product transaction (no new signature)' : 'Sign saved Product transaction'}</button>` : ''}`;
      }
      const create = review ? `<p>Creates one external Product definition, not an owned Item. Wallet signing and gas payment required.</p><button type="button" data-action="create-composable-product" data-upload-id="${escapeHtml(row.uploadId)}"${forcedControlAttributes(view, 'create-composable-product', '', busy || !view.composableUploadWriteEnabled)}>Sign &amp; create external Product</button>` : '';
      return `<button type="button" data-action="review-composable-upload" data-upload-id="${escapeHtml(row.uploadId)}"${forcedControlAttributes(view, 'review-composable-upload', '', busy)}>Review external Product (no signature)</button>${review ? `<p role="status">Product review ready. Not issued.</p><p>Item: ${escapeHtml(review.payload.itemKey)} · Style: ${escapeHtml(review.payload.styleKey)} · Track: ${escapeHtml(review.payload.layerTrackKey)}</p><p>PNG: ${escapeHtml(review.payload.assetBlobId)} · SHA-256: ${escapeHtml(review.payload.assetSha256)}</p>` : ''}${create}`;
    }
    const sign = row.status === 'SIGNATURE_REQUIRED' && ['REGISTER', 'CERTIFY'].includes(row.stage);
    const recover = row.status === 'RECOVERY_REQUIRED' || row.status === 'REGISTER_FINALIZED';
    if (row.error || (!sign && !recover)) return '';
    const label = sign ? (row.stage === 'REGISTER' ? 'Sign storage registration & upload PNG' : 'Sign uploaded PNG certification') : 'Recover saved upload (no new signature)';
    return `<p>${sign ? 'This wallet action can spend storage/gas fees and broadcast a transaction. It does not issue a Product.' : 'Queries the saved transaction first; may rebroadcast its exact bytes or resume the PNG upload.'}</p><button type="button" data-action="continue-composable-upload" data-upload-id="${escapeHtml(row.uploadId)}" data-upload-action="${sign ? 'SIGN' : 'RECOVER'}"${forcedControlAttributes(view, 'continue-composable-upload', '', busy || !view.composableUploadWriteEnabled)}>${escapeHtml(label)}</button>${!view.composableUploadWriteEnabled ? '<p>Signing and broadcast are disabled by the current execution gates.</p>' : ''}`;
  };
  return `<section class="v4-composable-compatibility" data-composable-upload-history><button type="button" data-action="read-composable-upload-history"${forcedControlAttributes(view, 'read-composable-upload-history', '', busy)}>${escapeHtml(copy[0])}</button><p>${escapeHtml(copy[1])}</p><p role="status">${escapeHtml(status)}</p>${history?.actionError ? `<p role="alert">${escapeHtml(history.actionError)}</p>` : ''}${rows.map(row => `<article><p>${escapeHtml(row.uploadId)} · r${row.artworkRevision}</p><p>Root: ${escapeHtml(row.binding.rootId)} · Part: ${escapeHtml(row.binding.partKey)}</p><p role="status">${escapeHtml(row.error || `${row.status} · ${row.stage || ''}`)}</p>${row.transactionDigest ? `<p>Transaction: ${escapeHtml(row.transactionDigest)}</p>` : ''}${actionControl(row)}</article>`).join('')}</section>`;
}

function composableStorage(view) {
  const art = view.composableArtwork, target = view.composableTargets?.target;
  if (!art?.sha256 || !target || art.binding.rootId !== target.rootId || art.binding.contentCommitment !== target.contentCommitment) return '';
  const labels = {
    en: ['Prepare storage', 'Prepares an exact local upload record only. No signature or upload.'],
    zh: ['准备存储', '仅准备准确的本地上传记录，不签名、不上传。'],
    ja: ['ストレージ準備', '正確なローカルアップロード記録のみ準備。署名・アップロードは行いません。'],
    ko: ['저장 준비', '정확한 로컬 업로드 기록만 준비합니다. 서명하거나 업로드하지 않습니다.'],
    vi: ['Chuẩn bị lưu trữ', 'Chỉ chuẩn bị bản ghi tải lên cục bộ. Không ký hoặc tải lên.'],
  };
  const copy = labels[view.locale] || labels.en;
  const stageCopy = {
    en: { REGISTER: 'Registration: a wallet signature will register paid storage; after confirmation, the PNG is uploaded. Certification requires a separate signature.', CERTIFY: 'Certification: a separate wallet signature certifies the uploaded PNG. This does not issue an external Product.', UPLOAD: 'Registration finalized; upload recovery is pending.', COMPLETE: 'Storage certified; external Product issuance is still separate.' },
    zh: { REGISTER: '注册阶段：钱包签名将注册付费存储，交易确认后上传 PNG；认证需另一次签名。', CERTIFY: '认证阶段：需单独钱包签名认证已上传 PNG，不会发行外部产品。', UPLOAD: '注册已确认，等待恢复素材上传。', COMPLETE: '存储已认证；外部产品仍需单独发行。' },
  };
  const storageNote = art.storage ? (stageCopy[view.locale] || stageCopy.en)[art.storage.stage] || '' : '';
  return `<section class="v4-composable-compatibility"><button type="button" data-action="prepare-composable-storage"${forcedControlAttributes(view, 'prepare-composable-storage', '', art.status !== 'saved' || art.settingsDirty || !art.settings?.itemKey || !art.settings?.layerTrackKey)}>${escapeHtml(copy[0])}</button><p>${escapeHtml(copy[1])}</p>${art.storage ? `<p role="status">${escapeHtml(art.storage.status)} · ${escapeHtml(art.storage.stage || '')}</p><p>${escapeHtml(storageNote)}</p><p>${escapeHtml(art.storage.uploadId)}</p>${art.storage.transactionDigest ? `<p>Transaction: ${escapeHtml(art.storage.transactionDigest)}</p>` : ''}` : ''}</section>`;
}

function composableArtwork(view) {
  const target = view.composableTargets?.target;
  if (!target?.parts.length) return '';
  const labels = {
    en: ['Choose a Part for your PNG', 'Upload your PNG', 'Local source only; not uploaded or issued.', 'Select the Part again to reload after an error.'],
    zh: ['为你的 PNG 选择部位', '上传你的 PNG', '仅保存本地源文件，尚未上传存储网络或发行。', '发生错误后，重新选择部位以重新读取。'],
    ja: ['PNG の Part を選択', '自分の PNG を追加', 'ローカル素材のみ。未アップロード・未発行。', 'エラー後は Part を再選択して読み直してください。'],
    ko: ['PNG의 Part 선택', '내 PNG 추가', '로컬 원본만 저장합니다. 업로드 및 발행 전입니다.', '오류 후 Part를 다시 선택하여 읽으세요.'],
    vi: ['Chọn Part cho PNG của bạn', 'Thêm PNG của bạn', 'Chỉ lưu nguồn cục bộ; chưa tải lên mạng hoặc phát hành.', 'Chọn lại Part để đọc lại sau lỗi.'],
  };
  const copy = labels[view.locale] || labels.en, art = view.composableArtwork;
  const current = art?.binding.rootId === target.rootId && art.binding.contentCommitment === target.contentCommitment ? art : null;
  const busy = ['loading', 'saving'].includes(current?.status);
  return `<section class="v4-composable-compatibility" data-composable-artwork><h3>${escapeHtml(copy[0])}</h3>${target.parts.map(part => `<button type="button" data-action="select-composable-part" data-part-key="${escapeHtml(part.key)}" aria-pressed="${current?.binding.partKey === part.key}"${forcedControlAttributes(view, 'select-composable-part', part.key, busy)}>${escapeHtml(part.label)}</button>`).join('')}<p>${escapeHtml(copy[2])}</p>${current ? `<p role="status" data-composable-artwork-status>${escapeHtml(current.error || (current.settingsDirty ? tr(view, 'unsavedChanges') : current.status))} · r${current.revision}</p>${current.sha256 ? `<p>SHA-256: ${escapeHtml(current.sha256)}</p>` : ''}<label>${escapeHtml(copy[1])}<input type="file" accept="image/png" data-action="composable-artwork"${forcedControlAttributes(view, 'composable-artwork', '', !['empty', 'saved'].includes(current.status))}></label>${current.status === 'error' ? `<p>${escapeHtml(copy[3])}</p>` : ''}` : ''}</section>`;
}

function composableAdmissionPanel(view) {
  const target = view.composableTargets?.target;
  if (!target) return '';
  const state = view.composableAdmission;
  const copy = {
    en: ['Maker admission management', 'External Product ID', 'Review open admission', 'Review certified admission', 'Review revocation', 'Save reviewed request (no signature)', 'Review only; not applied. Maker control is required.'],
    zh: ['Maker 准入管理', '外部产品 ID', '审阅开放准入', '审阅认证准入', '审阅撤销准入', '保存审阅请求（不签名）', '仅审阅，尚未生效；需要 Maker 管理权。'],
    ja: ['Maker の受け入れ管理', '外部 Product ID', 'オープン受け入れ確認', '認証受け入れ確認', '取り消し確認', '確認済み要求を保存（署名なし）', '確認のみ、未適用。Maker 管理権限が必要です。'],
    ko: ['Maker 허용 관리', '외부 Product ID', '오픈 허용 검토', '인증 허용 검토', '허용 취소 검토', '검토 요청 저장 (서명 없음)', '검토만 완료되었으며 적용되지 않았습니다. Maker 관리 권한이 필요합니다.'],
    vi: ['Quản lý chấp nhận Maker', 'ID Product bên ngoài', 'Xem xét chấp nhận mở', 'Xem xét chấp nhận chứng nhận', 'Xem xét thu hồi', 'Lưu yêu cầu đã xem xét (không ký)', 'Chỉ xem xét, chưa áp dụng. Cần quyền quản lý Maker.'],
  }[view.locale] || ['Maker admission management', 'External Product ID', 'Review open admission', 'Review certified admission', 'Review revocation', 'Save reviewed request (no signature)', 'Review only; not applied. Maker control is required.'];
  const actions = ['ADMIT_OPEN', 'ADMIT_CERTIFIED', 'REVOKE_ADMISSION'];
  return `<section class="v4-composable-compatibility" data-composable-admission><h3>${escapeHtml(copy[0])}</h3><p>Root: ${escapeHtml(target.rootId)}</p><label>${escapeHtml(copy[1])}<input type="text" maxlength="66" data-action="admission-product-id" value="${escapeHtml(state?.productId || '')}"${forcedControlAttributes(view, 'admission-product-id', '', state?.busy)}></label>${actions.map((action, index) => `<button type="button" data-action="review-composable-admission" data-admission-action="${action}"${forcedControlAttributes(view, 'review-composable-admission', '', state?.busy || !/^0x[0-9a-f]{64}$/.test(state?.productId || '') || (action === 'ADMIT_OPEN' && target.admission !== 'OPEN') || (action === 'ADMIT_CERTIFIED' && target.admission === 'DISABLED'))}>${escapeHtml(copy[index + 2])}</button>`).join('')}${state?.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ''}${state?.review ? `<p role="status">${escapeHtml(copy[6])}</p><p>${escapeHtml(state.review.action)} · ${escapeHtml(state.review.product.productId)}</p><button type="button" data-action="stage-composable-admission"${forcedControlAttributes(view, 'stage-composable-admission', '', view.composableOperations?.busy)}>${escapeHtml(copy[5])}</button>` : ''}</section>`;
}

function composableProductInventory(view) {
  const copy = {
    en: ['Wallet external Products', 'Read external Products', 'Not limited to this local draft. Products are definitions; issued Items are separate assets.', 'Loading…', 'No controlled external Products found.', 'Not loaded.'],
    zh: ['钱包中的外部产品', '读取外部产品', '不限于当前本地草稿。产品是定义，已发行物品是独立资产。', '读取中…', '未找到由此钱包控制的外部产品。', '尚未读取。'],
    ja: ['ウォレットの外部製品', '外部製品を読み込む', 'このローカル下書きだけではありません。製品定義と発行済み Item は別の資産です。', '読み込み中…', '管理する外部製品はありません。', '未読み込み。'],
    ko: ['지갑의 외부 제품', '외부 제품 읽기', '현재 로컬 초안에 한정되지 않습니다. 제품 정의와 발행된 Item은 별개 자산입니다.', '읽는 중…', '이 지갑이 관리하는 외부 제품이 없습니다.', '아직 읽지 않았습니다.'],
    vi: ['Sản phẩm bên ngoài của ví', 'Đọc sản phẩm bên ngoài', 'Không chỉ bản nháp này. Định nghĩa sản phẩm và Item đã phát hành là tài sản riêng.', 'Đang đọc…', 'Không tìm thấy sản phẩm bên ngoài do ví quản lý.', 'Chưa đọc.'],
  }[view.locale] || ['Wallet external Products', 'Read external Products', 'Products are definitions; issued Items are separate assets.', 'Loading…', 'No controlled external Products found.', 'Not loaded.'];
  const inventory = view.composableInventory;
  const controlCopy = {
    en: ['Review pause', 'Review resume', 'Review permanent archive', 'Review control transfer', 'New controller wallet', 'Review only. Not executed.'],
    zh: ['审阅暂停', '审阅恢复', '审阅永久归档', '审阅控制权转移', '新控制者钱包', '仅审阅，尚未执行。'],
    ja: ['一時停止を確認', '再開を確認', '永久アーカイブを確認', '管理権移転を確認', '新しい管理者ウォレット', '確認のみ。未実行です。'],
    ko: ['일시 중지 검토', '재개 검토', '영구 보관 검토', '관리 권한 이전 검토', '새 관리자 지갑', '검토만 완료되었으며 실행되지 않았습니다.'],
    vi: ['Xem xét tạm dừng', 'Xem xét tiếp tục', 'Xem xét lưu trữ vĩnh viễn', 'Xem xét chuyển quyền', 'Ví quản lý mới', 'Chỉ xem xét, chưa thực hiện.'],
  }[view.locale] || ['Review pause', 'Review resume', 'Review permanent archive', 'Review control transfer', 'New controller wallet', 'Review only. Not executed.'];
  const productControls = row => {
    const actions = ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL'];
    const allowed = [[0], [1], [0, 1], [0, 1, 2]];
    return `<label>${escapeHtml(controlCopy[4])}<input type="text" maxlength="66" data-action="product-control-recipient" data-product-id="${escapeHtml(row.id)}" value="${escapeHtml(inventory?.recipients?.[row.id] || '')}"${forcedControlAttributes(view, 'product-control-recipient', '', inventory?.busy)}></label>${actions.map((action, index) => `<button type="button" data-action="review-composable-product" data-product-id="${escapeHtml(row.id)}" data-product-action="${action}"${forcedControlAttributes(view, 'review-composable-product', '', inventory?.busy || !allowed[index].includes(row.lifecycle))}>${escapeHtml(controlCopy[index])}</button>`).join('')}`;
  };
  const operationCopy = {
    en: ['Save reviewed request (no signature)', 'Read issuance & admission operations', 'Sign saved operation', 'Recover operation (no new signature)', 'No saved operations.'],
    zh: ['保存审阅请求（不签名）', '读取发行与准入记录', '签名执行已保存操作', '恢复操作（不重新签名）', '没有已保存的操作记录。'],
    ja: ['確認済み要求を保存（署名なし）', '発行・受け入れ記録を読む', '保存済み操作に署名', '操作を復旧（新規署名なし）', '保存済み発行記録はありません。'],
    ko: ['검토 요청 저장 (서명 없음)', '발행 및 허용 기록 읽기', '저장된 작업 서명', '작업 복구 (새 서명 없음)', '저장된 발행 기록이 없습니다.'],
    vi: ['Lưu yêu cầu đã xem xét (không ký)', 'Đọc lịch sử phát hành và chấp nhận', 'Ký thao tác đã lưu', 'Khôi phục (không ký mới)', 'Chưa có yêu cầu phát hành đã lưu.'],
  }[view.locale] || ['Save reviewed request (no signature)', 'Read issuance & admission operations', 'Sign saved operation', 'Recover operation (no new signature)', 'No saved operations.'];
  const operations = view.composableOperations;
  const resultCopy = {
    en: ['Product state', 'Controller', 'Control epoch', 'Admission revision', 'Active', 'Paused', 'Archived'],
    zh: ['产品状态', '控制者', '控制权版本', '准入修订', '有效', '已暂停', '已归档'],
    ja: ['製品状態', '管理者', '管理権版', '受け入れ改訂', '有効', '一時停止', 'アーカイブ済み'],
    ko: ['제품 상태', '관리자', '관리 권한 버전', '허용 개정', '활성', '일시 중지', '보관됨'],
    vi: ['Trạng thái sản phẩm', 'Người quản lý', 'Phiên bản quyền quản lý', 'Bản sửa đổi chấp nhận', 'Hoạt động', 'Tạm dừng', 'Đã lưu trữ'],
  }[view.locale] || ['Product state', 'Controller', 'Control epoch', 'Admission revision', 'Active', 'Paused', 'Archived'];
  const operationResult = row => {
    if (row.status !== 'COMPLETE' || !row.readback) return '';
    const readback = row.readback, values = [];
    if ([0, 1, 2].includes(Number(readback.lifecycle)) && readback.lifecycle != null) values.push([resultCopy[0], resultCopy[4 + Number(readback.lifecycle)]]);
    if (readback.owner) values.push([resultCopy[1], readback.owner]);
    if (readback.controlEpoch != null) values.push([resultCopy[2], readback.controlEpoch]);
    if (readback.packRegistryRevision != null) values.push([resultCopy[3], readback.packRegistryRevision]);
    return values.map(([label, value]) => `<p>${escapeHtml(label)}: ${escapeHtml(value)}</p>`).join('');
  };
  const operationHtml = `<section data-composable-item-operations><button type="button" data-action="read-composable-item-operations"${forcedControlAttributes(view, 'read-composable-item-operations', '', operations?.busy)}>${escapeHtml(operationCopy[1])}</button>${operations?.error ? `<p role="alert">${escapeHtml(operations.error)}</p>` : ''}${operations?.status === 'ready' && !operations.rows.length ? `<p role="status">${escapeHtml(operationCopy[4])}</p>` : ''}${(operations?.rows || []).map(row => `<article><p>${escapeHtml(row.request.action)} · ${escapeHtml(row.request.requestId)} · ${escapeHtml(row.status)}</p><p>Product: ${escapeHtml(row.request.product.productId)} · ${escapeHtml(row.request.payload.recipient)}</p>${row.ticket ? `<p>Transaction: ${escapeHtml(row.ticket.digest)}</p>` : ''}${operationResult(row)}${row.readback?.itemRef ? `<p>Item ID: ${escapeHtml(row.readback.itemRef.objectId)}</p>` : ''}${row.status === 'ACTIVE' ? `<button type="button" data-action="continue-composable-item" data-request-id="${escapeHtml(row.request.requestId)}" data-mode="${row.ticket ? 'RECOVER' : 'SIGN'}"${forcedControlAttributes(view, 'continue-composable-item', '', operations?.busy || !view.composableUploadWriteEnabled)}>${escapeHtml(operationCopy[row.ticket ? 3 : 2])}</button>` : ''}</article>`).join('')}</section>`;
  const itemCopy = {
    en: ['Review Item issuance to this wallet', 'Read-only review. No Item has been issued.', 'Recipient'],
    zh: ['审阅向当前钱包发行物品', '只读审阅，尚未发行物品。', '接收钱包'],
    ja: ['このウォレットへのアイテム発行を確認', '読み取り専用の確認です。未発行です。', '受取先'],
    ko: ['현재 지갑으로 아이템 발행 검토', '읽기 전용 검토입니다. 아직 발행되지 않았습니다.', '받는 지갑'],
    vi: ['Xem xét phát hành vật phẩm vào ví này', 'Chỉ xem xét, chưa phát hành vật phẩm.', 'Ví nhận'],
  }[view.locale] || ['Review Item issuance to this wallet', 'Read-only review. No Item has been issued.', 'Recipient'];
  const itemControls = row => `<button type="button" data-action="review-composable-item" data-product-id="${escapeHtml(row.id)}"${forcedControlAttributes(view, 'review-composable-item', '', inventory?.busy || row.lifecycle !== 0)}>${escapeHtml(itemCopy[0])}</button>${inventory?.itemReview?.product?.productId === row.id ? `<p role="status">${escapeHtml(inventory.itemReview.action === 'MINT_ITEM' ? itemCopy[1] : controlCopy[5])} · ${escapeHtml(inventory.itemReview.action)}</p><p>${escapeHtml(itemCopy[2])}: ${escapeHtml(inventory.itemReview.payload.recipient)}</p><button type="button" data-action="stage-composable-item"${forcedControlAttributes(view, 'stage-composable-item', '', operations?.busy)}>${escapeHtml(operationCopy[0])}</button>` : ''}`;
  const rows = inventory?.status === 'ready' ? inventory.products : [];
  const message = inventory?.status === 'loading' ? copy[3] : inventory?.status === 'error'
    ? inventory.error : inventory?.status === 'ready' ? (rows.length ? '' : copy[4]) : copy[5];
  return `<section class="v4-composable-compatibility" data-composable-products><h3>${escapeHtml(copy[0])}</h3><p>${escapeHtml(copy[2])}</p><button type="button" data-action="refresh-composable-products"${forcedControlAttributes(view, 'refresh-composable-products', '', inventory?.status === 'loading' || inventory?.busy)}>${escapeHtml(copy[1])}</button><p role="status">${escapeHtml(message)}</p>${inventory?.actionError ? `<p role="alert">${escapeHtml(inventory.actionError)}</p>` : ''}${rows.map(row => `<article><strong>${escapeHtml(row.makerKey)}</strong><p>Root: ${escapeHtml(row.rootId)}</p><p>Product: ${escapeHtml(row.id)}</p>${itemControls(row)}${productControls(row)}</article>`).join('')}${operationHtml}</section>`;
}

function composableItems(view) {
  const composable = view.document.composition.mode === 'COMPOSABLE';
  const parts = view.parts.map((part) => {
    const slot = part.wardrobeMode === 'SLOT';
    return `<article class="v7-wardrobe-part ${slot ? 'slot' : 'fixed'}" data-wardrobe-part-id="${escapeHtml(part.key)}"><div><strong>${escapeHtml(part.label)}</strong><small>${escapeHtml(tr(view, part.required ? 'wardrobePartRequired' : 'wardrobePartOptional'))}</small></div><div class="v7-wardrobe-choice" role="group" aria-label="${escapeHtml(tr(view, 'wardrobePartChoiceLabel', { part: part.label }))}"><button type="button" class="${slot ? '' : 'active'}" aria-pressed="${!slot}" data-action="wardrobe-part-mode" data-part-id="${escapeHtml(part.key)}" data-mode="FIXED"${controlAttributes(view, 'wardrobe-part-mode', `${part.key}:FIXED`)}><i aria-hidden="true">${slot ? '' : '✓'}</i><span>${escapeHtml(tr(view, 'wardrobePartFixed'))}</span></button><button type="button" class="${slot ? 'active' : ''}" aria-pressed="${slot}" data-action="wardrobe-part-mode" data-part-id="${escapeHtml(part.key)}" data-mode="SLOT"${controlAttributes(view, 'wardrobe-part-mode', `${part.key}:SLOT`)}><i aria-hidden="true">${slot ? '✓' : ''}</i><span>${escapeHtml(tr(view, 'wardrobePartSlot'))}</span></button></div><small class="v7-wardrobe-part-copy">${escapeHtml(tr(view, slot ? 'wardrobePartSlotCopy' : 'wardrobePartFixedCopy'))}</small><label data-fresh-v8-field="parts[].capacity"><code>capacity</code><input type="number" min="1" value="${part.capacity}" data-action="part-capacity" data-part-id="${escapeHtml(part.key)}"${controlAttributes(view, 'part-capacity', part.key)} /></label></article>`;
  }).join('');
  const admissionKeys = { DISABLED: 'admissionDisabled', CERTIFIED: 'admissionCertified', OPEN: 'admissionOpen' };
  const slotCount = view.parts.filter((part) => part.wardrobeMode === 'SLOT').length;
  const styleCount = view.parts.filter((part) => part.wardrobeMode === 'SLOT').reduce((count, part) => count + part.items.reduce((itemCount, item) => itemCount + item.styles.length, 0), 0);
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'wardrobeSetup'))}</span><h3>${escapeHtml(tr(view, 'wardrobeSetupTitle'))}</h3><p>${escapeHtml(tr(view, 'wardrobeSetupCopy'))}</p></div></div><div class="v4-composable-workspace"><section class="v7-wardrobe-toggle ${composable ? 'enabled' : 'disabled'}"><div><span>${escapeHtml(tr(view, composable ? 'wardrobeEnabled' : 'wardrobeDisabled'))}</span><strong>${escapeHtml(tr(view, 'wardrobeToggleLabel'))}</strong><small>${escapeHtml(tr(view, composable ? 'wardrobeEnabledCopy' : 'wardrobeDisabledCopy'))}</small></div><button type="button" role="switch" aria-checked="${composable}" aria-label="${escapeHtml(tr(view, composable ? 'turnWardrobeOff' : 'turnWardrobeOn'))}" title="${escapeHtml(tr(view, composable ? 'turnWardrobeOff' : 'turnWardrobeOn'))}" data-action="composable-mode" data-mode="${composable ? 'FIXED' : 'COMPOSABLE'}"${controlAttributes(view, 'composable-mode')}><i></i><span>${escapeHtml(tr(view, composable ? 'wardrobeToggleOnState' : 'wardrobeToggleOffState'))}</span></button></section><!-- Fresh-v8 additive composition fields in the approved Composable workspace. --><section class="v4-composable-compatibility draft" data-fresh-v8-field="composition"><header><div><span>${escapeHtml(tr(view, 'makerCompositionMode'))}</span><strong>${escapeHtml(tr(view, composable ? 'composableMaker' : 'fixedMaker'))}</strong></div></header><p>${escapeHtml(tr(view, composable ? 'composableMakerCopy' : 'fixedMakerCopy'))}</p><label>${escapeHtml(tr(view, 'thirdPartyAdmission'))}<select data-action="third-party-admission" data-fresh-v8-field="composition.thirdPartyAdmission"${controlAttributes(view, 'third-party-admission')}>${Object.entries(admissionKeys).map(([mode, key]) => `<option value="${mode}" ${selected(view.document.composition.thirdPartyAdmission, mode)}>${escapeHtml(tr(view, key))}</option>`).join('')}</select><small>${escapeHtml(tr(view, 'admissionCopy'))}</small></label><label><input type="checkbox" ${checked(view.document.composition.itemAssetization)} data-action="item-assetization" data-fresh-v8-field="composition.itemAssetization"${controlAttributes(view, 'item-assetization')} /> ${escapeHtml(tr(view, 'itemAssetization'))}</label></section>${composable ? `<section class="v7-wardrobe-parts"><header><div><strong>${escapeHtml(tr(view, 'wardrobePartPolicyTitle'))}</strong><small>${escapeHtml(tr(view, 'wardrobePartPolicyCopy'))}</small></div></header><div class="v7-wardrobe-part-list">${parts}</div></section><section class="v7-wardrobe-summary"><div><strong>${slotCount}</strong><span>${escapeHtml(tr(view, 'wardrobeSlots'))}</span></div><div><strong>${styleCount}</strong><span>${escapeHtml(tr(view, 'wardrobeStyles'))}</span></div><div><strong>${view.issues.length}</strong><span>${escapeHtml(tr(view, 'wardrobeNeedsReview'))}</span></div></section>` : ''}</div>`;
}

function commerce(view) {
  const commerceValue = view.document.commerce;
  const completeModes = {
    UNLIMITED_FREE: 'completeUnlimitedFree',
    FREE_QUOTA_THEN_PAID: 'completeQuotaThenPaid',
    PAID_EVERY_TIME: 'completePaidEveryTime',
    FREE_QUOTA_THEN_BLOCK: 'completeQuotaThenBlock',
  };
  const royaltyOptions = (value) => Array.from({ length: 11 }, (_, index) => index * 50)
    .map((bps) => `<option value="${bps}" ${selected(value, bps)}>${bps / 100}%</option>`)
    .join('');
  const completionFields = (policy, scope, packId = '') => {
    const quotaMode = ['FREE_QUOTA_THEN_PAID', 'FREE_QUOTA_THEN_BLOCK'].includes(policy.mode);
    const paidMode = ['FREE_QUOTA_THEN_PAID', 'PAID_EVERY_TIME'].includes(policy.mode);
    const data = packId ? ` data-pack-id="${escapeHtml(packId)}"` : '';
    const subject = packId || '';
    return `<label>${escapeHtml(tr(view, 'completePolicy'))}<select data-action="commerce-${scope}-complete-mode"${data}${controlAttributes(view, `commerce-${scope}-complete-mode`, subject)}>${Object.entries(completeModes).map(([mode, key]) => `<option value="${mode}" ${selected(policy.mode, mode)}>${escapeHtml(tr(view, key))}</option>`).join('')}</select></label><label>${escapeHtml(tr(view, 'freeCompleteQuota'))}<input type="number" min="1" step="1" value="${quotaMode ? escapeHtml(policy.freeQuotaPerWallet) : ''}" data-action="commerce-${scope}-complete-quota"${data}${forcedControlAttributes(view, `commerce-${scope}-complete-quota`, subject, !quotaMode)} /></label><label>${escapeHtml(tr(view, 'completePriceUsdc'))}<input type="number" min="0.000001" step="0.000001" value="${paidMode ? escapeHtml(atomicToCoin(policy.priceAtomic)) : ''}" data-action="commerce-${scope}-complete-price"${data}${forcedControlAttributes(view, `commerce-${scope}-complete-price`, subject, !paidMode)} /></label><label>${escapeHtml(tr(view, 'globalCompleteCap'))}<input type="number" min="1" step="1" value="${escapeHtml(policy.totalCap ?? '')}" placeholder="${escapeHtml(tr(view, 'unlimited'))}" data-action="commerce-${scope}-complete-cap"${data}${controlAttributes(view, `commerce-${scope}-complete-cap`, subject)} /></label>`;
  };
  const packCards = view.expansionPacks.map((pack) => {
    const policy = pack.commerce;
    const accessMode = String(policy.accessMode || 'FREE');
    const paid = accessMode === 'PAID_ONCE';
    return `<article class="v4-commerce-pack-card v4-independent-pack-commerce-card"><header><div><span>${escapeHtml(tr(view, 'independentExpansionPack'))}</span><h4>${escapeHtml(pack.name)}</h4></div><code>${escapeHtml(pack.packId)}</code></header><p>${escapeHtml(tr(view, 'independentPackCommerceScope', { version: pack.version, revision: pack.revision }))}</p><div class="v4-commerce-fields"><label>${escapeHtml(tr(view, 'packAccess'))}<select data-action="independent-pack-commerce" data-independent-pack-commerce-field="accessMode" data-independent-pack-key="${escapeHtml(pack.key)}"${controlAttributes(view, 'independent-pack-commerce', `${pack.key}:accessMode`)}><option value="FREE" ${selected(accessMode, 'FREE')}>${escapeHtml(tr(view, 'accessFree'))}</option><option value="PAID_ONCE" ${selected(accessMode, 'PAID_ONCE')}>${escapeHtml(tr(view, 'accessPaidOnce'))}</option></select></label><label>${escapeHtml(tr(view, 'packPriceUsdc'))}<input type="number" inputmode="decimal" min="0.000001" step="0.000001" value="${paid ? escapeHtml(policy.priceDecimal || '') : ''}" data-action="independent-pack-commerce" data-independent-pack-commerce-field="priceDecimal" data-independent-pack-key="${escapeHtml(pack.key)}"${forcedControlAttributes(view, 'independent-pack-commerce', `${pack.key}:priceDecimal`, !paid)} /></label></div></article>`;
  }).join('');
  const legacyPackCards = view.expansionPacks.filter((pack) => pack.packPolicy).map((pack) => {
    const policy = pack.packPolicy;
    const accessMode = String(policy.accessMode || 'FREE');
    const paid = accessMode === 'ONE_TIME_PAID';
    const completion = plain(policy.completion) ? policy.completion : {
      mode: 'UNLIMITED_FREE', freeQuotaPerWallet: 0, priceAtomic: 0, totalCap: null,
    };
    return `<article class="v4-commerce-pack-card"><header><div><span>${escapeHtml(tr(view, 'expansionPack'))}</span><h4>${escapeHtml(pack.name)}</h4></div><code>${escapeHtml(pack.packId)}</code></header><div class="v4-commerce-fields"><label>${escapeHtml(tr(view, 'packAccess'))}<select data-action="commerce-pack-access" data-pack-id="${escapeHtml(pack.packId)}"${controlAttributes(view, 'commerce-pack-access', pack.packId)}><option value="FREE" ${selected(accessMode, 'FREE')}>${escapeHtml(tr(view, 'accessFree'))}</option><option value="ONE_TIME_PAID" ${selected(accessMode, 'ONE_TIME_PAID')}>${escapeHtml(tr(view, 'accessPaidOnce'))}</option><option value="REQUIRED_CORE" ${selected(accessMode, 'REQUIRED_CORE')}>${escapeHtml(tr(view, 'accessIncludedCore'))}</option></select></label><label>${escapeHtml(tr(view, 'packPriceUsdc'))}<input type="number" min="0.000001" step="0.000001" value="${paid ? escapeHtml(atomicToCoin(policy.purchasePriceAtomic)) : ''}" data-action="commerce-pack-price" data-pack-id="${escapeHtml(pack.packId)}"${forcedControlAttributes(view, 'commerce-pack-price', pack.packId, !paid)} /></label>${completionFields(completion, 'pack', pack.packId)}</div></article>`;
  }).join('');
  const packContent = view.expansionPacksStatus === 'loading'
    ? `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'packLoading'))}</span></div>`
    : view.expansionPacksStatus === 'error'
      ? `<div class="v4-rule-warning" role="alert"><strong>${escapeHtml(tr(view, 'independentPackCommerceNeedsAttention'))}</strong><span>${escapeHtml(view.expansionPacksError)}</span></div>`
      : packCards || `<div class="v4-inline-empty"><strong>${escapeHtml(tr(view, 'noIndependentExpansionPacks'))}</strong><span>${escapeHtml(tr(view, 'independentPackCommerceEmpty'))}</span></div>`;
  const protocol = view.commerceProtocol;
  const commerceIssues = view.issues.filter((issue) => issue.path === 'commerce' || issue.path.startsWith('commerce.'));
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'commerceRights'))}</span><h3>${escapeHtml(tr(view, 'commerceTitle'))}</h3><p>${escapeHtml(tr(view, 'commerceCopy'))}</p></div></div><div class="v4-commerce-workspace">
    <section class="v4-commerce-section"><header><div><span>01</span><h4>${escapeHtml(tr(view, 'rightsOrigin'))}</h4></div><em>${escapeHtml(tr(view, view.commerceRightsLocked ? 'immutableAfterFirstPublish' : commerceValue.rightsOriginConfirmed ? 'rightsOriginConfirmed' : 'rightsOriginConfirmationRequired'))}</em></header><div class="v4-commerce-choice-grid"><label class="${commerceValue.rightsOriginConfirmed && commerceValue.rightsOrigin === 'ONCHAIN_NATIVE' ? 'active' : ''}"><input type="radio" name="commerce-rights-origin" value="ONCHAIN_NATIVE" data-action="commerce-rights-origin" ${checked(commerceValue.rightsOriginConfirmed && commerceValue.rightsOrigin === 'ONCHAIN_NATIVE')}${forcedControlAttributes(view, 'commerce-rights-origin', 'ONCHAIN_NATIVE', view.commerceRightsLocked)} /><span><strong>${escapeHtml(tr(view, 'rightsOnchainNative'))}</strong><small>${escapeHtml(tr(view, 'rightsOnchainNativeCopy'))}</small></span></label><label class="${commerceValue.rightsOriginConfirmed && commerceValue.rightsOrigin === 'LICENSE_WRAPPED' ? 'active' : ''}"><input type="radio" name="commerce-rights-origin" value="LICENSE_WRAPPED" data-action="commerce-rights-origin" ${checked(commerceValue.rightsOriginConfirmed && commerceValue.rightsOrigin === 'LICENSE_WRAPPED')}${forcedControlAttributes(view, 'commerce-rights-origin', 'LICENSE_WRAPPED', view.commerceRightsLocked)} /><span><strong>${escapeHtml(tr(view, 'rightsLicenseWrapped'))}</strong><small>${escapeHtml(tr(view, 'rightsLicenseWrappedCopy'))}</small></span></label></div>${view.commerceCanWithdrawRightsConfirmation ? `<div class="v4-rule-warning" role="status"><span>${escapeHtml(tr(view, 'withdrawLegacyRightsConfirmationCopy'))}</span><button type="button" data-action="withdraw-legacy-rights-confirmation"${controlAttributes(view, 'withdraw-legacy-rights-confirmation')}>${escapeHtml(tr(view, 'withdrawLegacyRightsConfirmation'))}</button></div>` : ''}</section>
    <section class="v4-commerce-section"><header><div><span>02</span><h4>${escapeHtml(tr(view, 'makerAccessAndComplete'))}</h4></div><em>${escapeHtml(tr(view, 'defaultFreeUnlimited'))}</em></header><div class="v4-commerce-fields"><label>${escapeHtml(tr(view, 'makerAccess'))}<select data-action="commerce-maker-access"${controlAttributes(view, 'commerce-maker-access')}><option value="FREE" ${selected(commerceValue.makerAccess.mode, 'FREE')}>${escapeHtml(tr(view, 'accessFree'))}</option><option value="ONE_TIME_PAID" ${selected(commerceValue.makerAccess.mode, 'ONE_TIME_PAID')}>${escapeHtml(tr(view, 'accessPaidOnce'))}</option></select></label><label>${escapeHtml(tr(view, 'makerAccessPriceUsdc'))}<input type="number" min="0.000001" step="0.000001" value="${commerceValue.makerAccess.mode === 'ONE_TIME_PAID' ? escapeHtml(atomicToCoin(commerceValue.makerAccess.purchasePriceAtomic)) : ''}" data-action="commerce-maker-access-price"${forcedControlAttributes(view, 'commerce-maker-access-price', '', commerceValue.makerAccess.mode !== 'ONE_TIME_PAID')} /></label>${completionFields(commerceValue.baseCompletion, 'base')}</div></section>
    <section class="v4-commerce-section"><header><div><span>03</span><h4>${escapeHtml(tr(view, 'packCommerce'))}</h4></div><em>${escapeHtml(tr(view, 'onePassPermanent'))}</em></header><div class="v4-commerce-pack-group"><div><strong>${escapeHtml(tr(view, 'independentExpansionPacks'))}</strong><small>${escapeHtml(tr(view, 'independentPackCommerceCopy'))}</small></div><div class="v4-commerce-pack-grid">${packContent}</div></div>${legacyPackCards ? `<div class="v4-commerce-pack-group legacy"><div><strong>${escapeHtml(tr(view, 'embeddedLegacyPacks'))}</strong><small>${escapeHtml(tr(view, 'embeddedLegacyPacksCopy'))}</small></div><div class="v4-commerce-pack-grid">${legacyPackCards}</div></div>` : ''}</section>
    <section class="v4-commerce-section"><header><div><span>04</span><h4>${escapeHtml(tr(view, 'secondaryRoyalties'))}</h4></div><em>0–5%</em></header><div class="v4-commerce-fields"><label>${escapeHtml(tr(view, 'soulCreatorRoyalty'))}<select data-action="commerce-soul-creator-royalty"${controlAttributes(view, 'commerce-soul-creator-royalty')}>${royaltyOptions(commerceValue.soulCreatorRoyaltyBps)}</select></label><label>${escapeHtml(tr(view, 'makerSourceRoyalty'))}<select data-action="commerce-maker-source-royalty"${controlAttributes(view, 'commerce-maker-source-royalty')}>${royaltyOptions(commerceValue.makerSourceRoyaltyBps)}</select></label><label>${escapeHtml(tr(view, 'makerResaleRoyalty'))}<select data-action="commerce-maker-resale-royalty"${forcedControlAttributes(view, 'commerce-maker-resale-royalty', '', view.currentReleaseSealed)} ${view.currentReleaseSealed ? 'aria-describedby="makerResaleRoyaltyLock"' : ''}>${royaltyOptions(commerceValue.makerResaleRoyaltyBps)}</select>${view.currentReleaseSealed ? `<small id="makerResaleRoyaltyLock">${escapeHtml(tr(view, 'immutableReleasedRoyalty'))}</small>` : ''}</label></div></section>
    <section class="v4-commerce-protocol"><div><strong>${escapeHtml(tr(view, 'primarySplit'))}</strong><span>${escapeHtml(tr(view, 'primarySplitValue', { maker: (10_000 - protocol.primaryContentFeeBps) / 100, protocol: protocol.primaryContentFeeBps / 100 }))}</span></div><div><strong>${escapeHtml(tr(view, 'fixedCompleteProtocolFee'))}</strong><span>${escapeHtml(atomicToCoin(protocol.fixedCompleteFeeAtomic))} USDC</span></div><div><strong>${escapeHtml(tr(view, 'networkCosts'))}</strong><span>${escapeHtml(tr(view, 'networkCostsSeparate'))}</span></div><div><strong>${escapeHtml(tr(view, 'productionGate'))}</strong><span class="${protocol.enabled ? 'enabled' : 'disabled'}">${escapeHtml(tr(view, protocol.enabled ? 'enabled' : 'disabled'))}</span></div></section>
    ${commerceIssues.length ? `<div class="v4-rule-warning" role="alert"><strong>${escapeHtml(tr(view, 'commerceNeedsAttention', { count: commerceIssues.length }))}</strong><span>${escapeHtml(commerceIssues[0].message)}</span></div>` : ''}
  </div>`;
}

function soulConfiguration(view) {
  const selectedDocument = view.soul.documents.find((entry) => entry.key === view.soul.selectedKey)
    || view.soul.documents[0];
  const tabs = view.soul.documents.map((entry) => `<button type="button" class="${entry.key === selectedDocument.key ? 'active' : ''} ${entry.valid ? 'valid' : 'invalid'}" data-action="select-soul-document" data-soul-key="${escapeHtml(entry.key)}" aria-pressed="${entry.key === selectedDocument.key}"${controlAttributes(view, 'select-soul-document', entry.key)}><span>${escapeHtml(entry.filename)}</span><strong>${escapeHtml(tr(view, entry.titleKey))}</strong><small>${escapeHtml(tr(view, entry.customized ? 'soulDocumentCustomized' : 'soulDocumentDefault'))} · ${escapeHtml(tr(view, entry.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}</small></button>`).join('');
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'soulConfig'))}</span><h3>${escapeHtml(tr(view, 'soulConfigTitle'))}</h3><p>${escapeHtml(tr(view, 'soulConfigCopy'))}</p></div><button type="button" data-action="reset-all-soul"${controlAttributes(view, 'reset-all-soul')}>${escapeHtml(tr(view, 'soulRestoreAllDefaults'))}</button></div><div class="v4-soul-workspace"><nav class="v4-soul-document-list" aria-label="${escapeHtml(tr(view, 'soulConfig'))}">${tabs}</nav><section class="v4-soul-editor"><header><div><span>${escapeHtml(selectedDocument.filename)}</span><strong>${escapeHtml(tr(view, selectedDocument.titleKey))}</strong><small>${escapeHtml(tr(view, selectedDocument.copyKey))}</small></div><button type="button" data-action="reset-soul-document" data-soul-key="${escapeHtml(selectedDocument.key)}"${controlAttributes(view, 'reset-soul-document', selectedDocument.key)}>${escapeHtml(tr(view, 'soulRestoreDefault'))}</button></header><textarea data-action="soul-document-content" data-soul-key="${escapeHtml(selectedDocument.key)}" spellcheck="false" aria-label="${escapeHtml(selectedDocument.filename)}"${controlAttributes(view, 'soul-document-content', selectedDocument.key)}>${escapeHtml(selectedDocument.content)}</textarea><footer><span class="${selectedDocument.valid ? 'valid' : 'invalid'}"><strong>${escapeHtml(tr(view, 'soulValidationStatus'))}:</strong> ${escapeHtml(tr(view, selectedDocument.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}${selectedDocument.error ? ` · ${escapeHtml(selectedDocument.error)}` : ''}</span><span>${escapeHtml(tr(view, 'soulDocumentSize', { bytes: selectedDocument.bytes, limit: selectedDocument.maxBytes }))}</span><span>${escapeHtml(tr(view, 'soulDraftSaveCopy'))}</span></footer></section></div>`;
}

function preflight(view) {
  const rows = view.issues.map((issue) => `<li class="error"><span>${escapeHtml(issue.path || 'Maker')}</span><strong>${escapeHtml(issue.message)}</strong></li>`).join('');
  const heading = view.issues.length
    ? tr(view, view.issues.length === 1 ? 'issueBlocks' : 'issuesBlock', { count: view.issues.length })
    : tr(view, 'readyPublish');
  return `<div class="v4-advanced-head"><div><span>${escapeHtml(tr(view, 'publishPreflight'))}</span><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(tr(view, 'preflightCopy'))}</p></div><button type="button" data-action="run-preflight"${reviewIdentity(view)}${controlAttributes(view, 'run-preflight')}>${escapeHtml(tr(view, 'runAgain'))}</button></div><ul class="v4-preflight-list">${rows || `<li class="ready"><span>${escapeHtml(tr(view, 'allChecks'))}</span><strong>${escapeHtml(tr(view, 'allChecksCopy'))}</strong></li>`}</ul>`;
}

function advancedBody(view) {
  if (view.activeTab === 'info') return makerInfo(view);
  if (view.activeTab === 'layers') return layerTracks(view);
  if (view.activeTab === 'colors') return smartColor(view);
  if (view.activeTab === 'rules') return rules(view);
  if (view.activeTab === 'expansions') return expansionPacks(view);
  if (view.activeTab === 'composable') return composableItems(view) + composableProductInventory(view) + composableMakerTargets(view) + composableAdmissionPanel(view) + composableArtwork(view) + composableProductSettings(view) + composableStorage(view) + composableUploadHistory(view);
  if (view.activeTab === 'commerce') return commerce(view);
  if (view.activeTab === 'soul') return soulConfiguration(view);
  if (view.activeTab === 'validate') return preflight(view);
  return '';
}

function overlay(view) {
  if (view.activeTab === 'structure') return '';
  return `<div class="v4-tool-modal-backdrop" data-action="close-tool-backdrop"><section id="makerV4ToolDialog" class="v4-advanced-panel primary-tool" role="dialog" aria-modal="true" aria-labelledby="makerV4ToolTitle" tabindex="-1"><header class="v4-tool-context"><div><span>${escapeHtml(advancedTitle(view))}</span><strong id="makerV4ToolTitle">${escapeHtml(view.document.metadata.name)}</strong></div><button type="button" data-action="close-tool" aria-label="${escapeHtml(tr(view, 'close'))}"${controlAttributes(view, 'close-tool')}>×</button></header><div class="v4-tool-body">${advancedBody(view)}</div></section></div>`;
}

function publicationReview(view) {
  const state = view.publicationReview;
  if (!state) return '';
  const review = state.review, step = review?.step;
  const scope = review?.scope || {};
  const value = input => escapeHtml(input == null ? tr(view, 'publicationUnknown') : String(input));
  const row = (label, input) => '<p><strong>' + escapeHtml(tr(view, label)) + '</strong><br><span style="overflow-wrap:anywhere">' + value(input) + '</span></p>';
  const complete = review?.status === 'COMPLETE' && Boolean(review.rootId);
  const progress = review?.progress;
  const exactProgress = Number.isSafeInteger(progress?.completed) && Number.isSafeInteger(progress?.total)
    && progress.total > 0 && progress.completed >= 0 && progress.completed <= progress.total;
  const storageComplete = complete || (exactProgress && progress.completed === progress.total);
  const onchain = ['SCAFFOLD', 'BASE_CHUNK', 'COMPANION_OBJECTS', 'ACTIVATION_CHUNK'].includes(review?.stage);
  const phase = complete || onchain ? 4 : step?.stage === 'CERTIFY' ? 3
    : ['REGISTER', 'UPLOAD'].includes(step?.stage) ? 2 : 1;
  const stages = ['prepareFiles', 'registerAndUpload', 'certifyWalrus', 'publishOnSui'].map((key, index) => {
    const number = index + 1;
    const done = complete || (number === 1 && phase > 1) || (number < 4 && storageComplete);
    const current = !complete && number === phase;
    const inProgress = !done && !current && number < phase;
    return '<li class="' + (done ? 'completed' : current ? 'current' : 'pending') + '" data-publication-stage="' + number + '"'
      + (current ? ' aria-current="step"' : '') + '><span>' + number + '</span><strong>' + escapeHtml(tr(view, key))
      + '</strong><small>' + escapeHtml(tr(view, done ? 'publishStepCompleted' : current ? 'publishStepCurrent'
        : inProgress ? 'publicationInProgress' : 'publishStepPending')) + '</small></li>';
  }).join('');
  const quote = step?.quote?.verified === true ? step.quote : null;
  const amount = (input, atomicUnit, tokenUnit) => {
    if (!quote || (typeof input !== 'string' && !Number.isSafeInteger(input))
      || !/^(0|[1-9]\d*)$/.test(String(input ?? ''))) return '<strong>' + escapeHtml(tr(view, 'publishQuoteUnavailable')) + '</strong>';
    const atomic = BigInt(input), fraction = (atomic % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
    const token = (atomic / 1000000000n).toString() + (fraction ? '.' + fraction : '');
    return '<strong>' + atomic + ' ' + atomicUnit + '</strong><small>' + token + ' ' + tokenUnit + '</small>';
  };
  const date = quote?.quotedAt == null ? null : new Date(quote.quotedAt);
  const quoteTime = date && Number.isFinite(date.getTime())
    ? '<time datetime="' + escapeHtml(date.toISOString()) + '">' + escapeHtml(tr(view, 'publishQuoteAt', {
      time: new Intl.DateTimeFormat(view.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date),
    })) + '</time>' : '';
  const quoteRows = [
    ['relayTipEstimate', 'relayTipMist', 'MIST', 'SUI'],
    ['walrusStorageEstimate', 'walrusStorageCostFrost', 'FROST', 'WAL'],
    ['walrusWriteEstimate', 'walrusWriteCostFrost', 'FROST', 'WAL'],
    ['walrusTotalEstimate', 'walrusTotalCostFrost', 'FROST', 'WAL'],
  ].map(([label, field, atomic, token], index) => '<div' + (index === 3 ? ' class="total"' : '') + '><dt>'
    + escapeHtml(tr(view, label)) + '</dt><dd>' + amount(quote?.[field], atomic, token) + '</dd></div>').join('');
  const gasPanel = !complete && step && onchain ? '<aside class="v4-chain-fee">' + row('publicationGas', step.gasBudgetMist)
    + '<p class="v4-chain-fee-warning">' + escapeHtml(tr(view, 'publicationCopy')) + '</p></aside>' : '';
  const quotePanel = !complete && step && !onchain ? '<aside class="v4-chain-fee" aria-labelledby="makerCreatorPublishQuoteTitle">'
    + '<div class="v4-chain-fee-heading"><span id="makerCreatorPublishQuoteTitle">' + escapeHtml(tr(view, 'publishQuoteTitle'))
    + '</span><small>' + escapeHtml(tr(view, 'publicationQuoteScope')) + '</small>' + quoteTime + '</div><dl>' + quoteRows
    + '</dl>' + row('publicationGas', step.gasBudgetMist) + '<p class="v4-chain-fee-warning">'
    + escapeHtml(tr(view, 'publishQuoteGasWarning')) + '</p></aside>' : '';
  const info = state.errorInfo || (state.error ? { message: state.error } : null);
  const errorTitles = {
    TIP_TOO_HIGH: 'publishErrorTipTitle', WALLET_REJECTED: 'publishErrorRejectedTitle',
    INSUFFICIENT_GAS: 'publishErrorGasTitle', INSUFFICIENT_WAL_BALANCE: 'publishErrorWalBalanceTitle',
    INSUFFICIENT_SUI_BALANCE: 'publishErrorSuiBalanceTitle', NETWORK_UNAVAILABLE: 'publishErrorNetworkTitle',
    UPLOAD_QUOTE_CHANGED: 'publishErrorQuoteChangedTitle', WALRUS_QUOTE_EXPIRED: 'publishErrorQuoteChangedTitle',
    WALRUS_CERTIFICATION_NOT_VISIBLE: 'publishErrorCertificationSyncTitle',
    TRANSACTION_OUTCOME_PENDING: 'publishErrorPendingTitle', UPLOAD_RECOVERY_MISMATCH: 'publishErrorRecoveryMismatchTitle',
  };
  const copyLabel = state.copyState === 'copied' ? 'errorDetailsCopied' : state.copyState === 'error' ? 'errorDetailsCopyFailed' : 'copyErrorDetails';
  const errorPanel = info ? '<aside class="v4-chain-error" role="alert" aria-live="assertive"><div><span>' + value(info.code || 'CHAIN_ACTION_FAILED')
    + '</span><strong>' + escapeHtml(tr(view, errorTitles[info.code] || 'publishErrorTitle')) + '</strong></div><p>'
    + escapeHtml(tr(view, 'publicationRecoveryCopy')) + '</p><details><summary>' + escapeHtml(tr(view, 'technicalDetails'))
    + '</summary><pre>' + value([...new Set([info.message, info.diagnostic].filter(Boolean))].join('\n')) + '</pre></details>'
    + '<div class="v4-chain-error-actions"><button type="button" data-action="publication-copy-error">' + escapeHtml(tr(view, copyLabel)) + '</button></div></aside>' : '';
  const technical = review ? '<details><summary>' + escapeHtml(tr(view, 'technicalDetails')) + '</summary>'
    + row('publicationWallet', scope.signerAddress) + row('publicationStage', makerPublicationStageText(view.locale, review.stage)
      + ' / ' + makerPublicationStageText(view.locale, review.status))
    + '<p style="overflow-wrap:anywhere">' + value(scope.draftId) + ' · ' + value(scope.draftRevision) + '<br>'
    + value(scope.contentSha256) + '</p>' + row('publicationAssets', review.assetCount)
    + (step ? '<p style="overflow-wrap:anywhere">' + value(step.id) + ' · ' + value(step.revision) + '<br>' + value(step.digest) + '</p>'
      + row('publicationGasPrice', step.gasPriceMist)
      + row('publicationTerms', [step.storageEpochs ?? tr(view, 'publicationUnknown'), step.deletable ?? tr(view, 'publicationUnknown')].join(' / ')) : '') + '</details>' : '';
  const resourceKind = makerPublicationStageText(view.locale, progress?.currentKind || review?.stage);
  const resource = progress?.currentLabel ? resourceKind + ' · ' + progress.currentLabel : resourceKind;
  const resourceProgress = review && !complete ? '<p style="overflow-wrap:anywhere">' + value(resource) + '</p><p>'
    + escapeHtml(tr(view, 'publicationResourceProgress', { completed: exactProgress ? progress.completed : tr(view, 'publicationUnknown'),
      total: exactProgress ? progress.total : tr(view, 'publicationUnknown') })) + '</p>' : '';
  const disabled = state.busy ? ' disabled aria-disabled="true"' : '';
  const signable = ['READY', 'TRANSPORT_SIGNATURE_REQUIRED'].includes(review?.status);
  const action = !info && !complete && (review?.nextAction === 'SIGN' && signable ? 'publication-sign' : review?.nextAction === 'CONTINUE' ? 'publication-continue' : null);
  const actionLabel = action === 'publication-continue' ? 'publicationContinue'
    : onchain ? 'publishMakerStepButton' : step?.stage === 'CERTIFY' ? 'certifyStep'
      : step?.stage === 'REGISTER' ? quote ? 'confirmRegisterUploadStep' : 'registerUploadStep' : 'publicationSign';
  const actionDisabled = state.busy || (action === 'publication-sign' ? !view.publicationSigningEnabled : !view.publicationBroadcastEnabled)
    ? ' disabled aria-disabled="true" title="' + escapeHtml(tr(view, 'publicationUnavailable')) + '"' : '';
  const success = complete ? '<strong class="v4-chain-published">' + escapeHtml(tr(view, 'publishedDone')) + '</strong>'
    + row('publicationComplete', review.rootId + ' / ' + review.makerVersion)
    + '<button type="button" data-action="publication-open" data-publication-review="' + value(review.reviewId) + '">' + escapeHtml(tr(view, 'publicationOpen')) + '</button>'
    + '<button type="button" data-action="publication-versions">' + escapeHtml(tr(view, 'chainHistory')) + '</button>'
    : review?.status === 'NEW_VERSION_REQUIRED' ? '<aside role="status"><strong>' + escapeHtml(tr(view, 'chainCurrentUnpublished')) + '</strong><p>'
      + escapeHtml(tr(view, 'chainCopy')) + '</p><p>' + escapeHtml(tr(view, 'chainRevisions', { published: scope.draftRevision, current: scope.currentSavedRevision }))
      + '</p><button type="button" data-action="publication-versions">' + escapeHtml(tr(view, 'chainNext')) + '</button></aside>' : '';
  const confirmId = 'makerCreatorPublishCloseConfirm';
  const close = state.closeConfirm ? '<aside id="' + confirmId + '" class="v4-chain-close-confirm" role="alertdialog" aria-labelledby="'
    + confirmId + 'Title" aria-describedby="' + confirmId + 'Copy" tabindex="-1"><strong id="' + confirmId + 'Title">'
    + escapeHtml(tr(view, 'publishCloseConfirmTitle')) + '</strong><p id="' + confirmId + 'Copy">' + escapeHtml(tr(view, 'publishCloseConfirmCopy'))
    + '</p><div><button class="primary" type="button" data-action="publication-keep-open">' + escapeHtml(tr(view, 'keepPublishOpen'))
    + '</button><button type="button" data-action="publication-force-close">' + escapeHtml(tr(view, 'closePublishAnyway')) + '</button></div></aside>' : '';
  return '<div class="v4-modal-backdrop v4-chain-flow-backdrop"><section id="makerCreatorPublishDialog" class="v4-chain-flow creator" role="dialog" aria-modal="true" aria-labelledby="'
    + (state.closeConfirm ? confirmId + 'Title' : 'makerCreatorPublishTitle') + '" aria-describedby="'
    + (state.closeConfirm ? confirmId + 'Copy' : 'makerCreatorPublishCopy') + '" aria-busy="' + Boolean(state.busy) + '" tabindex="-1">'
    + '<div class="v4-chain-flow-content"' + (state.closeConfirm ? ' inert aria-hidden="true"' : '') + '><header><div><span class="v4-eyebrow">'
    + escapeHtml(tr(view, 'creatorReleaseEyebrow')) + '</span><h3 id="makerCreatorPublishTitle">' + escapeHtml(tr(view, 'publishMakerStep', { step: phase }))
    + '</h3><p id="makerCreatorPublishCopy">' + escapeHtml(tr(view, 'publicationFlowCopy')) + '</p><p>'
    + escapeHtml(tr(view, 'publishDialogCopy')) + '</p></div><button type="button" data-action="publication-close" aria-label="'
    + escapeHtml(tr(view, 'close')) + '">×</button></header><ol>' + stages + '</ol>'
    + (review ? '<p style="overflow-wrap:anywhere"><strong>' + value(review.frozenMakerName) + '</strong></p>' : '')
    + (scope.publishingEarlierRevision ? '<p role="alert">' + escapeHtml(tr(view, 'publicationEarlier', { frozen: scope.draftRevision, current: scope.currentSavedRevision })) + '</p>' : '')
    + resourceProgress + quotePanel + gasPanel + '<div class="v4-chain-status' + (state.busy ? ' busy' : '') + '" role="status" aria-live="polite">'
    + (state.busy ? '<i aria-hidden="true"></i>' : '') + '<span>' + escapeHtml(state.busy ? tr(view, 'publicationLoading')
      : makerPublicationStageText(view.locale, review?.status)) + '</span>'
    + (state.busy ? '<small>' + escapeHtml(tr(view, 'publishWorking')) + '</small>' : '') + '</div>'
    + errorPanel + technical + '<footer><button type="button" data-action="publication-refresh"' + disabled + '>'
    + escapeHtml(tr(view, 'publicationRefresh')) + '</button>' + (action ? '<button type="button" class="primary" data-action="' + action
      + '" data-publication-review="' + value(review.reviewId) + '"' + actionDisabled + '>'
      + escapeHtml(tr(view, actionLabel)) + '</button>'
      + (action === 'publication-sign' ? '<small>' + escapeHtml(tr(view, 'publicationSign')) + '</small>' : '') : '')
    + success + '</footer></div>' + close + '</section></div>';
}

function versionHistory(view) {
  const history = view.versionHistory;
  if (!history.open) return '';
  const busy = ['loading', 'restoring'].includes(history.status);
  const list = history.entries.length ? `<ol class="v4-version-history-list">${history.entries.map((entry) => {
    const current = entry.revision === history.currentRevision;
    const restoring = history.restoringRevision === entry.revision;
    return `<li class="${current ? 'current' : ''}"><div><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(tr(view, 'versionHistoryRevision', { revision: entry.revision }))}</span><time>${escapeHtml(safeDateTime(entry.updatedAt, tr(view, 'versionHistoryUnknownTime')))}</time></div>${current ? `<em>${escapeHtml(tr(view, 'versionHistoryCurrent'))}</em>` : `<button type="button" data-action="restore-checkpoint" data-revision="${entry.revision}"${forcedControlAttributes(view, 'restore-checkpoint', String(entry.revision), busy)}>${escapeHtml(tr(view, restoring ? 'versionHistoryRestoring' : 'versionHistoryRestore'))}</button>`}</li>`;
  }).join('')}</ol>` : '';
  let content = list;
  if (history.status === 'loading') content = `<div class="v4-version-history-state loading"><i></i><strong>${escapeHtml(tr(view, 'versionHistoryLoading'))}</strong><span>${escapeHtml(tr(view, 'versionHistoryLoadingCopy'))}</span></div>`;
  else if (history.status === 'empty') content = `<div class="v4-version-history-state"><strong>${escapeHtml(tr(view, 'versionHistoryEmpty'))}</strong><span>${escapeHtml(tr(view, 'versionHistoryEmptyCopy'))}</span></div>`;
  else if (history.status === 'error') content = `<div class="v4-version-history-state error"><strong>${escapeHtml(tr(view, 'versionHistoryFailed'))}</strong><span>${escapeHtml(history.error || tr(view, 'versionHistoryRestoreFailed'))}</span><button type="button" data-action="retry-version-history"${controlAttributes(view, 'retry-version-history')}>${escapeHtml(tr(view, 'versionHistoryRetry'))}</button></div>${list}`;
  else if (history.status === 'restoring') content = `<div class="v4-version-history-notice">${escapeHtml(tr(view, 'versionHistoryRestoring'))}</div>${list}`;
  else if (history.message) content = `<div class="v4-version-history-notice success">${escapeHtml(history.message)}</div>${list}`;
  const chain = '<h4>' + escapeHtml(tr(view, 'chainHistory')) + '</h4><p>' + escapeHtml(tr(view, 'chainCopy')) + '</p>'
    + history.chainVersions.map(row => {
      const root = escapeHtml(row.rootId), allowed = row.canManage === true;
      const button = (action, label, enabled) => `<button type="button" data-action="${action}" data-chain-root="${root}"${enabled && !busy ? '' : ' disabled'}>${label}</button>`;
      return `<article><strong>Chain version ${escapeHtml(row.makerVersion)} · ${escapeHtml(row.lifecycle)}</strong><p style="overflow-wrap:anywhere">${root}</p>`
        + button('chain-archive-review', escapeHtml(tr(view, 'chainArchiveReview')), allowed && ['ACTIVE', 'PAUSED'].includes(row.lifecycle))
        + button('chain-archive-recover', escapeHtml(tr(view, 'chainArchiveRecover')), allowed)
        + button('chain-successor', escapeHtml(tr(view, 'chainSuccessor')), allowed && row.lifecycle === 'ARCHIVED')
        + (history.archiveReview?.rootId === row.rootId ? `<p>${escapeHtml(tr(view, 'chainArchiveDigest'))}: ${escapeHtml(history.archiveReview.digest)}</p>`
          + button('chain-archive-sign', escapeHtml(tr(view, 'chainArchiveSign')), allowed && view.publicationSigningEnabled) : '') + '</article>';
    }).join('') + `<p role="status">${escapeHtml(history.chainStatus)}</p><h4>${escapeHtml(tr(view, 'chainLocal'))}</h4>`;
  content = chain + content;
  return `<div class="v4-modal-backdrop v4-version-history-backdrop" data-action="close-version-history-backdrop"><section class="v4-version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="makerVersionHistoryTitle"><header><div><span class="v4-eyebrow">${escapeHtml(tr(view, 'versionHistory'))}</span><h3 id="makerVersionHistoryTitle">${escapeHtml(tr(view, 'versionHistoryTitle'))}</h3><p>${escapeHtml(tr(view, 'versionHistoryCopy'))}</p></div><button type="button" data-action="close-version-history" aria-label="${escapeHtml(tr(view, 'close'))}"${forcedControlAttributes(view, 'close-version-history', '', history.status === 'restoring')}>×</button></header><div class="v4-version-history-content">${content}</div></section></div>`;
}

export function renderApprovedMakerV8Workspace(view) {
  if (!plain(view) || view.schemaVersion !== MAKER_V8_APPROVED_VIEW_SCHEMA) {
    throw new TypeError('An approved Maker v8 workspace view is required.');
  }
  const { part, item, style } = selectedViewRecords(view);
  const title = view.draftId;
  return renderApprovedShell({
    activeTab: view.activeTab,
    tabs: view.tabs,
    titleHtml: `<h2>${escapeHtml(view.document.metadata.name)}</h2><span class="v4-version-badge">${escapeHtml(title)} · ${view.document.canvas.width}×${view.document.canvas.height}</span>`,
    actionsHtml: toolbar(view),
    noticesHtml: view.notice ? `<div class="v4-version-history-notice" role="status" aria-live="polite">${escapeHtml(view.notice)}</div>` : '',
    leftHtml: `<div class="v4-panel-head"><div><span>${escapeHtml(tr(view, 'parts'))}</span><strong>${escapeHtml(tr(view, 'playerMenuLinkedOrder'))}</strong><small>${escapeHtml(tr(view, 'playerMenuLinkedOrderCopy'))}</small></div><button type="button" data-action="add-part" aria-label="${escapeHtml(tr(view, 'addPartAria'))}"${controlAttributes(view, 'add-part')}>＋</button></div>${renderParts(view)}`,
    centerHtml: previewAndItems(view, part, item, style),
    rightHtml: `<div class="v4-panel-head v4-inspector-context"><div><span>${escapeHtml(tr(view, 'currentStyle'))}</span><strong>${escapeHtml([part?.label || '—', item?.label || '—', style?.label || '—'].join(' › '))}</strong></div></div>${inspector(view, part, item, style)}`,
    overlayHtml: overlay(view),
    afterHtml: versionHistory(view) + publicationReview(view),
  }, view);
}
