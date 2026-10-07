import {
  MAKER_WORKSPACE_LOCALES,
  makerWorkspaceText,
} from './maker-workspace-i18n.js';
import {
  MAKER_V8_PLAYER_LOADOUT_SCHEMA,
  MAKER_V8_PLAYER_RECIPE_SCHEMA,
  makerV8PlayerRecipeCommitmentV8,
} from './maker-v8-player-controller.js';
import { assertMakerV8LocalPlayerSnapshot } from './maker-v8-local-player.js';
import { assertMakerV8EnabledPackReleaseIds } from './maker-v8-player-pack-preferences.js';
import { makerV8PlayerRecipeLayout } from './maker-v8-player-slot-layout.js';
import { makerV8PlayerTrack, makerV8PlayerPart, makerV8PlayerPartUiKey, makerV8PlayerColor } from './maker-v8-player-definition-resolution.js';
import { makerV8PlayerColorFields, makerV8PlayerColorMap, makerV8PlayerSwatchKey, makerV8PlayerColorEntry, makerV8PlayerColorControlKey } from './maker-v8-player-colors.js';
import { makerV8PlayerRecipeConstraintIssue } from './maker-v8-player-recipe-constraints.js';
import { makerV8RecipeConstraintIssue, makerV8LocalRecipeTransitionIssue } from './maker-v8-recipe-constraints.js';

/**
 * Pure Fresh-v8 projection for the approved aac90dbc Player renderer.
 *
 * The module owns no listeners, wallet, transaction, persistence, transport,
 * asset loading, canvas drawing, or route. The host supplies capabilities and
 * already-certified display URLs. Omitted capabilities fail closed while the
 * donor control remains in its original Player location.
 */

export const MAKER_V8_APPROVED_PLAYER_VIEW_SCHEMA =
  'animacraft.maker-v8-approved-player-view.v1';

const PLAYER_SESSION_SCHEMA = 'animacraft.maker-v8-player-session.v1';
const EXACT_ROOT_ID = /^0x[0-9a-f]{64}$/;
const EXACT_COMMITMENT = /^[0-9a-f]{64}$/;
const LOCALES = new Set(MAKER_WORKSPACE_LOCALES);
const PICKER_PANELS = new Set(['parts', 'colors']);
const SAVE_STATES = new Set(['idle', 'dirty', 'saving', 'saved', 'error']);
const EXPORT_STATES = new Set(['idle', 'rendering', 'ready', 'error']);
const SOUL_DOCUMENTS = Object.freeze([
  Object.freeze({ key: 'soulMd', filename: 'soul.md', titleKey: 'soulPersonalityIdentity', copyKey: 'soulPersonalityIdentityCopy' }),
  Object.freeze({ key: 'memoryMd', filename: 'memory.md', titleKey: 'soulMemory', copyKey: 'soulMemoryCopy' }),
  Object.freeze({ key: 'skillMd', filename: 'SKILL.md', titleKey: 'soulSkills', copyKey: 'soulSkillsCopy' }),
]);
const SOUL_DOCUMENT_MAX_BYTES = 64 * 1024;
const RECIPE_FIELDS = Object.freeze([
  'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment',
  'selections', 'colors', 'outputKey',
]);
const RECIPE_SELECTION_FIELDS = Object.freeze([
  'source', 'partKey', 'itemKey', 'styleKey', 'trackKey', 'colorChannelKey',
  'defaultSwatchKey', 'releaseId', 'semanticPackId', 'externalProductId',
  'ownedExternalItemId',
]);
const LOADOUT_FIELDS = Object.freeze([
  'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment',
  'outputKey', 'selections', 'usedPacks', 'recipeCommitment',
]);
const LOADOUT_SELECTION_FIELDS = Object.freeze([
  'selectionIndex', ...RECIPE_SELECTION_FIELDS, 'swatchKey',
]);
const USED_PACK_FIELDS = Object.freeze(['releaseId', 'semanticPackId']);
const CONTEXTUAL_CHOICE_BUNDLE_FIELDS = Object.freeze([
  'schemaVersion', 'address', 'rootId', 'baseEntitlements', 'packStyles',
  'externalStyles', 'certifiedAssets', 'diagnostics',
]);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function exactFields(value, expected, label) {
  if (!plain(value)) throw new TypeError(`${label} must be an exact record.`);
  const actual = Object.keys(value).sort(compareProtocolText);
  const canonical = [...expected].sort(compareProtocolText);
  if (actual.length !== canonical.length
    || actual.some((field, index) => field !== canonical[index])) {
    throw new TypeError(`${label} field set is invalid.`);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
  if (source.startsWith('blob:')) return source;
  try {
    const url = new URL(source, 'https://animacraft.soulidity.ai');
    return ['http:', 'https:'].includes(url.protocol) ? source : '';
  } catch {
    return '';
  }
}

function tr(view, key, variables = {}) {
  return makerWorkspaceText(view.locale, key, variables);
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function capabilityEntry(value) {
  if (typeof value === 'boolean') return { enabled: value, reason: '' };
  if (!plain(value) || typeof value.enabled !== 'boolean') return null;
  return { enabled: value.enabled, reason: String(value.reason || '') };
}

function normalizeCapabilities(value) {
  const source = plain(value) ? value : {};
  const entries = {};
  const add = (record) => {
    if (!plain(record)) return;
    Object.entries(record).forEach(([key, candidate]) => {
      if (['actions', 'controls', 'default'].includes(key)) return;
      const entry = capabilityEntry(candidate);
      if (entry) entries[String(key)] = entry;
    });
  };
  add(source);
  add(source.actions);
  add(source.controls);
  const fallback = capabilityEntry(source.default)
    || capabilityEntry(source.actions?.['*'])
    || capabilityEntry(source.controls?.['*'])
    || capabilityEntry(source['*'])
    || { enabled: false, reason: '' };
  return { entries, fallback };
}

function resolveCapability(view, action, subject = '') {
  const scoped = subject ? `${action}:${subject}` : '';
  return view.capabilities.entries[scoped]
    || view.capabilities.entries[action]
    || view.capabilities.fallback;
}

function capabilityReason(view, action, subject = '') {
  const capability = resolveCapability(view, action, subject);
  return capability.reason || view.boundaryReason;
}

function controlAttributes(view, action, subject = '', forcedReason = '') {
  const capability = resolveCapability(view, action, subject);
  const reason = forcedReason || (capability.enabled ? '' : capabilityReason(view, action, subject));
  if (capability.enabled && !forcedReason) return '';
  return ` disabled aria-disabled="true" title="${escapeHtml(reason)}"`;
}

function pressed(value) {
  return value === true ? 'true' : 'false';
}

const SELECTION_BINDING_FIELDS = Object.freeze([
  'source', 'partKey', 'itemKey', 'styleKey', 'trackKey', 'colorChannelKey',
  'defaultSwatchKey', 'releaseId', 'semanticPackId', 'externalProductId',
  'ownedExternalItemId',
]);

function sameSelectionBinding(left, right) {
  return SELECTION_BINDING_FIELDS.every((field) => (
    Object.hasOwn(left ?? {}, field)
    && Object.hasOwn(right ?? {}, field)
    && left[field] === right[field]
  ));
}

function baseSelectionAuthority(part, item, style) {
  return {
    source: 'BASE',
    partKey: part.key,
    itemKey: item.key,
    styleKey: style.key,
    trackKey: style.trackKey,
    colorChannelKey: style.colorChannelKey,
    defaultSwatchKey: style.defaultSwatchKey,
    releaseId: null,
    semanticPackId: null,
    externalProductId: null,
    ownedExternalItemId: null,
  };
}

function assertSelectionSourceAuthority(selection) {
  const baseIdsEmpty = selection.releaseId === null
    && selection.semanticPackId === null
    && selection.externalProductId === null
    && selection.ownedExternalItemId === null;
  if (selection.source === 'BASE' && baseIdsEmpty) return;
  if (selection.source === 'PACK'
    && EXACT_ROOT_ID.test(String(selection.releaseId || ''))
    && typeof selection.semanticPackId === 'string' && selection.semanticPackId.length > 0
    && selection.externalProductId === null && selection.ownedExternalItemId === null) return;
  if (selection.source === 'EXTERNAL'
    && selection.releaseId === null && selection.semanticPackId === null
    && EXACT_ROOT_ID.test(String(selection.externalProductId || ''))
    && EXACT_ROOT_ID.test(String(selection.ownedExternalItemId || ''))) return;
  throw new TypeError('Fresh-v8 Player selection source authority is invalid.');
}

function assertSelectionColorAuthority(player, selection) {
  if (selection.colorChannelKey === null && selection.defaultSwatchKey === null) return;
  const channel = makerV8PlayerColor(player, selection)?.definition;
  if (selection.colorChannelKey === null || selection.defaultSwatchKey === null
    || !channel?.swatches?.some((swatch) => swatch.key === selection.defaultSwatchKey)) {
    throw new TypeError('Fresh-v8 Player selection Color authority is invalid.');
  }
}

function assertSelectionAssetAuthority(player, assetId) {
  const matches = (player.certifiedAssets || []).filter((asset) => asset?.assetId === assetId);
  if (typeof assetId !== 'string' || !assetId || matches.length !== 1) {
    throw new TypeError('Fresh-v8 Player selection asset authority is invalid.');
  }
  return matches[0];
}

function compareProtocolText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function exactRecipeLoadoutAuthority(session) {
  const { player, recipe, loadout } = session;
  const document = player.document;
  exactFields(recipe, RECIPE_FIELDS, 'Fresh-v8 Player Recipe');
  exactFields(loadout, LOADOUT_FIELDS, 'Fresh-v8 Player Loadout');
  if (recipe.schemaVersion !== MAKER_V8_PLAYER_RECIPE_SCHEMA
    || loadout.schemaVersion !== MAKER_V8_PLAYER_LOADOUT_SCHEMA) {
    throw new TypeError('Fresh-v8 Player Recipe or Loadout schema is invalid.');
  }
  if (!Array.isArray(recipe.colors) || !Array.isArray(loadout.usedPacks)) {
    throw new TypeError('Fresh-v8 Player Recipe Colors are invalid.');
  }
  recipe.selections.forEach((selection, index) => {
    exactFields(selection, RECIPE_SELECTION_FIELDS, `Fresh-v8 Player Recipe selection ${index}`);
  });
  recipe.colors.forEach((entry, index) => {
    exactFields(entry, makerV8PlayerColorFields(entry), `Fresh-v8 Player Recipe Color ${index}`);
  });
  loadout.selections.forEach((selection, index) => {
    exactFields(selection, LOADOUT_SELECTION_FIELDS, `Fresh-v8 Player Loadout selection ${index}`);
  });
  loadout.usedPacks.forEach((pack, index) => {
    exactFields(pack, USED_PACK_FIELDS, `Fresh-v8 Player Loadout used Pack ${index}`);
  });
  const recipeCommitment = makerV8PlayerRecipeCommitmentV8(recipe);
  if (!EXACT_COMMITMENT.test(String(loadout.recipeCommitment || ''))
    || loadout.recipeCommitment !== recipeCommitment) {
    throw new TypeError('Fresh-v8 Player Loadout Recipe commitment is invalid.');
  }
  if (typeof recipe.outputKey !== 'string'
    || !document.outputs?.some((output) => output.key === recipe.outputKey)
    || loadout.outputKey !== recipe.outputKey) {
    throw new TypeError('Fresh-v8 Player Output binding is invalid.');
  }
  const output = document.outputs.find((entry) => entry.key === recipe.outputKey);
  const selectedSemanticPacks = new Set(recipe.selections
    .filter((selection) => selection.source === 'PACK')
    .map((selection) => selection.semanticPackId));
  if (output.allowedPackPolicy?.kind === 'ALLOWLIST'
    && [...selectedSemanticPacks].some((packId) => (
      !output.allowedPackPolicy.packIds?.includes(packId)
    ))) {
    throw new TypeError('Fresh-v8 Player Output Pack authority is invalid.');
  }
  const packChoices = Array.isArray(player.contextualChoices?.packStyles)
    ? player.contextualChoices.packStyles : [];
  const externalChoices = Array.isArray(player.contextualChoices?.externalStyles)
    ? player.contextualChoices.externalStyles : [];
  recipe.selections.forEach((selection) => {
    assertSelectionSourceAuthority(selection);
    assertSelectionColorAuthority(player, selection);
    let authority = null;
    if (selection.source === 'BASE') {
      const part = document.parts?.find((entry) => entry.key === selection.partKey);
      const item = part?.items?.find((entry) => (
        entry.key === selection.itemKey && entry.status === 'PUBLIC'
      ));
      const style = item?.styles?.find((entry) => entry.key === selection.styleKey) || null;
      authority = style && sameSelectionBinding(
        selection,
        baseSelectionAuthority(part, item, style),
      ) ? style : null;
    } else if (selection.source === 'PACK' || selection.source === 'EXTERNAL') {
      const sourceChoices = selection.source === 'PACK' ? packChoices : externalChoices;
      const matches = sourceChoices.filter((choice) => (
        plain(choice) && sameSelectionBinding(choice, selection)
      ));
      authority = matches.length === 1 ? matches[0] : null;
    }
    if (!authority) {
      throw new TypeError('Fresh-v8 Player selection authority binding is invalid.');
    }
    if (!makerV8PlayerTrack(player, selection)) {
      throw new TypeError('Fresh-v8 Player selection Track authority is invalid.');
    }
    assertSelectionAssetAuthority(player, authority.assetId);
  });
  let selectedColors;
  try { selectedColors = makerV8PlayerColorMap(player, recipe.colors); }
  catch { throw new TypeError('Fresh-v8 Player Recipe Color authority is invalid.'); }
  const layout = makerV8PlayerRecipeLayout(player, recipe.selections);
  const partOffsets = new Map();
  let priorPartOrder = -1;
  loadout.selections.forEach((selection, index) => {
    const recipeSelection = recipe.selections[index];
    if (!recipeSelection || !sameSelectionBinding(selection, recipeSelection)) {
      throw new TypeError('Fresh-v8 Player Loadout selection binding is invalid.');
    }
    const scopedKey = layout.scopeKey(recipeSelection);
    const slot = layout.slot(recipeSelection);
    const currentPartOrder = slot.start;
    const offset = partOffsets.get(scopedKey) || 0;
    const expectedSelectionIndex = slot.start + offset;
    if (offset >= slot.capacity) throw new TypeError('Fresh-v8 Player Recipe exceeds its exact Part capacity.');
    if (!Number.isSafeInteger(currentPartOrder) || currentPartOrder < priorPartOrder
      || !Number.isSafeInteger(selection.selectionIndex)
      || selection.selectionIndex !== expectedSelectionIndex) {
      throw new TypeError('Fresh-v8 Player Loadout selection index is invalid.');
    }
    priorPartOrder = currentPartOrder;
    partOffsets.set(scopedKey, offset + 1);
    const expectedSwatch = makerV8PlayerSwatchKey(player, selectedColors, recipeSelection);
    if (selection.swatchKey !== expectedSwatch) {
      throw new TypeError('Fresh-v8 Player Loadout Color binding is invalid.');
    }
  });
  const expectedPacks = [...new Map(recipe.selections
    .filter((selection) => selection.source === 'PACK')
    .map((selection) => [selection.releaseId, {
      releaseId: selection.releaseId,
      semanticPackId: selection.semanticPackId,
    }])).values()].sort((left, right) => (
    compareProtocolText(left.semanticPackId, right.semanticPackId)
    || compareProtocolText(left.releaseId, right.releaseId)
  ));
  if (loadout.usedPacks.length !== expectedPacks.length
    || loadout.usedPacks.some((pack, index) => (
      pack.releaseId !== expectedPacks[index]?.releaseId
      || pack.semanticPackId !== expectedPacks[index]?.semanticPackId
    ))) {
    throw new TypeError('Fresh-v8 Player Loadout Pack binding is invalid.');
  }
}

function exactSession(session) {
  if (!plain(session)) throw new TypeError('Fresh-v8 Player session must be a record.');
  if (session.schemaVersion !== PLAYER_SESSION_SCHEMA || session.status !== 'READY') {
    throw new TypeError('Fresh-v8 Player session must be READY and use the exact v1 schema.');
  }
  if (!plain(session.player) || !plain(session.player.document)) {
    throw new TypeError('Fresh-v8 Player session must contain player.document.');
  }
  if (!plain(session.recipe) || !Array.isArray(session.recipe.selections)) {
    throw new TypeError('Fresh-v8 Player session must contain one exact recipe.');
  }
  if (!plain(session.loadout) || !Array.isArray(session.loadout.selections)) {
    throw new TypeError('Fresh-v8 Player session must contain one exact loadout.');
  }
  if (!plain(session.execution)) {
    throw new TypeError('Fresh-v8 Player session must contain execution state.');
  }
  const rootIds = [
    session.rootId,
    session.player.id,
    session.player.rootId,
    session.player.evidence?.rootId,
    session.recipe.rootId,
    session.loadout.rootId,
  ];
  if (rootIds.some((value) => !EXACT_ROOT_ID.test(String(value || '')))
    || new Set(rootIds).size !== 1) {
    throw new TypeError('Fresh-v8 Player session Root identity closure is invalid.');
  }
  const contentCommitments = [
    session.player.evidence?.contentCommitment,
    session.recipe.rootContentCommitment,
    session.loadout.rootContentCommitment,
    ...(Object.hasOwn(session, 'rootContentCommitment')
      ? [session.rootContentCommitment] : []),
    ...(Object.hasOwn(session.player, 'rootContentCommitment')
      ? [session.player.rootContentCommitment] : []),
  ];
  if (contentCommitments.some((value) => !EXACT_COMMITMENT.test(String(value || '')))
    || new Set(contentCommitments).size !== 1) {
    throw new TypeError('Fresh-v8 Player session Root content commitment closure is invalid.');
  }
  const makerVersions = [
    session.player.makerVersion,
    session.player.evidence?.makerVersion,
    session.recipe.makerVersion,
    session.loadout.makerVersion,
    session.player.document.lineage?.version,
    ...(Object.hasOwn(session, 'makerVersion') ? [session.makerVersion] : []),
  ].map((value) => String(value ?? ''));
  if (makerVersions.some((value) => !/^[1-9][0-9]*$/.test(value))
    || new Set(makerVersions).size !== 1) {
    throw new TypeError('Fresh-v8 Player session Maker version closure is invalid.');
  }
  if (Object.hasOwn(session.player, 'contextualChoices')) {
    const choices = session.player.contextualChoices;
    const choiceFields = plain(choices) ? Object.keys(choices).sort(compareProtocolText) : [];
    const expectedChoiceFields = [...CONTEXTUAL_CHOICE_BUNDLE_FIELDS].sort(compareProtocolText);
    if (!plain(choices)
      || choiceFields.length !== expectedChoiceFields.length
      || choiceFields.some((field, index) => field !== expectedChoiceFields[index])
      || choices.schemaVersion !== 'animacraft.maker-v8-contextual-choices.v1'
      || !EXACT_ROOT_ID.test(String(choices.address || ''))
      || choices.rootId !== session.rootId
      || !Array.isArray(choices.baseEntitlements)
      || !Array.isArray(choices.packStyles)
      || !Array.isArray(choices.externalStyles)
      || !Array.isArray(choices.certifiedAssets)
      || !Array.isArray(choices.diagnostics)
      || choices.diagnostics.length !== 0) {
      throw new TypeError('Fresh-v8 Player contextual choices lack exact wallet and Root authority.');
    }
  }
  exactRecipeLoadoutAuthority(session);
  const recipeSelections = new Map();
  session.recipe.selections.forEach((selection) => {
    const key = selectionKey(selection);
    recipeSelections.set(key, (recipeSelections.get(key) || 0) + 1);
  });
  const loadoutSelections = new Map();
  session.loadout.selections.forEach((selection) => {
    const key = selectionKey(selection);
    loadoutSelections.set(key, (loadoutSelections.get(key) || 0) + 1);
  });
  if (recipeSelections.size !== loadoutSelections.size
    || [...recipeSelections].some(([key, count]) => loadoutSelections.get(key) !== count)) {
    throw new TypeError('Fresh-v8 Player Recipe and Loadout selection closure is invalid.');
  }
  return clone(session);
}

function selectionKey(selection) {
  return SELECTION_BINDING_FIELDS
    .map((field) => {
      if (!Object.hasOwn(selection ?? {}, field)) return `${field}=!missing`;
      return `${field}=${selection[field] === null ? '!null' : String(selection[field])}`;
    })
    .join('\u0000');
}

function pickerItemKey(choice) {
  // Item keys are local to a release/product, not wallet-wide identities.
  // Keep styles of one owned instance together without folding other instances.
  return JSON.stringify([
    choice.source, choice.partKey, choice.itemKey, choice.releaseId ?? null,
    choice.semanticPackId ?? null, choice.externalProductId ?? null,
    choice.ownedExternalItemId ?? null,
  ]);
}

// Preview the host's exact remove/replace/add operation without changing the
// recipe. Rule matching stays in the shared local/certified constraint helper.
function candidateSelections(player, selections, part, choice, canRemove) {
  const exactIndex = selections.findIndex(entry => sameSelectionBinding(entry, choice));
  if (exactIndex >= 0) return canRemove
    ? selections.filter((_, index) => index !== exactIndex) : selections;
  const itemIndex = selections.findIndex(entry => pickerItemKey(entry) === pickerItemKey(choice));
  const replacementIndex = itemIndex >= 0 ? itemIndex : part.capacity === 1
    ? selections.findIndex(entry => makerV8PlayerPartUiKey(player, entry) === part.key) : -1;
  return replacementIndex >= 0
    ? selections.map((entry, index) => index === replacementIndex ? choice : entry)
    : [...selections, choice];
}

function projectAssets(player, state, assetRecords = player.certifiedAssets) {
  const urls = plain(state.assetUrls) ? state.assetUrls : {};
  const records = Array.isArray(assetRecords) ? assetRecords : [];
  return Object.fromEntries(records.map((asset) => [String(asset.assetId || ''), {
    ...asset,
    url: safeUrl(urls[asset.assetId] || asset.dataUrl || ''),
  }]));
}

function projectBaseChoices(document) {
  return (document.parts || []).flatMap((part) => (part.items || []).flatMap((item) => (
    item.status === 'PUBLIC' ? (item.styles || []).map((style) => ({
      id: `base:${part.key}:${item.key}:${style.key}`,
      source: 'BASE',
      label: item.styles.length > 1 ? `${item.label} · ${style.label}` : item.label,
      partKey: part.key,
      itemKey: item.key,
      styleKey: style.key,
      trackKey: style.trackKey,
      colorChannelKey: style.colorChannelKey,
      defaultSwatchKey: style.defaultSwatchKey,
      releaseId: null,
      semanticPackId: null,
      externalProductId: null,
      ownedExternalItemId: null,
      assetId: style.assetId,
      protected: style.protected === true,
      contextual: false,
      owned: false,
    })) : []
  )));
}

function projectContextualChoices(player) {
  const contextual = plain(player.contextualChoices) ? player.contextualChoices : {};
  return [
    ...(Array.isArray(contextual.packStyles) ? contextual.packStyles : []),
    ...(Array.isArray(contextual.externalStyles) ? contextual.externalStyles : []),
  ].map((choice) => {
    const suppliedAccess = plain(choice.access) ? choice.access : {};
    const owned = typeof choice.owned === 'boolean'
      ? choice.owned
      : choice.source === 'PACK'
        ? Boolean(choice.releaseId)
        : choice.source === 'EXTERNAL' && Boolean(choice.ownedExternalItemId);
    // Custody IDs alone do not prove admission or that an instance is free to equip.
    const accessible = suppliedAccess.accessible === true;
    return {
      ...choice,
      id: String(choice.id || selectionKey(choice)),
      label: String(choice.label || `${choice.itemKey || ''} · ${choice.styleKey || ''}`),
      contextual: true,
      owned,
      access: {
        accessible,
        canEquip: accessible && suppliedAccess.canEquip === true,
        enabled: suppliedAccess.enabled === true || choice.enabled === true,
        availableForAcquire: suppliedAccess.availableForAcquire === true
          || choice.availableForAcquire === true,
        canRetryRuntime: suppliedAccess.canRetryRuntime === true
          || choice.canRetryRuntime === true,
        ownedLockAvailable: suppliedAccess.ownedLockAvailable === true
          || choice.ownedLockAvailable === true,
        lockedToSoul: suppliedAccess.lockedToSoul === true
          || choice.lockedToSoul === true,
        reason: String(
          suppliedAccess.reason
          || choice.acquisitionBlockedReason
          || choice.disabledReason
          || '',
        ),
      },
    };
  });
}

function soulDocumentState(state, entry) {
  const source = plain(state.soul) ? state.soul : {};
  const defaults = plain(source.defaults) ? source.defaults : {};
  const documents = plain(source.documents) ? source.documents : source;
  const value = String(documents[entry.key] ?? defaults[entry.key] ?? '');
  const bytes = byteLength(value);
  const customized = Object.hasOwn(documents, entry.key)
    && String(documents[entry.key]) !== String(defaults[entry.key] ?? '');
  const supplied = plain(source.validation?.documents?.[entry.key])
    ? source.validation.documents[entry.key] : null;
  const valid = supplied?.valid === true || (!supplied && Boolean(value.trim()) && bytes <= SOUL_DOCUMENT_MAX_BYTES);
  return {
    ...entry,
    value,
    bytes,
    maxBytes: Number.isSafeInteger(supplied?.maxBytes) ? supplied.maxBytes : SOUL_DOCUMENT_MAX_BYTES,
    valid,
    customized,
    error: valid ? '' : String(supplied?.error || ''),
  };
}

function saveStatus(view) {
  const state = view.save.state;
  if (state === 'saving') return tr(view, 'playerDraftSaving');
  if (state === 'dirty') return tr(view, 'playerDraftUnsaved');
  if (state === 'error') return tr(view, 'playerDraftSaveFailed', {
    error: view.save.error || tr(view, 'saveFailed'),
  });
  if (state === 'saved') return view.save.savedAt
    ? tr(view, 'playerDraftSavedAt', { time: view.save.savedAt })
    : tr(view, 'draftAutosaved');
  return tr(view, 'playerDraftNotSaved');
}

export function projectMakerV8PlayerView(session, state = {}, capabilities = {}) {
  return projectPlayerPresentation(exactSession(session), state, capabilities);
}

const LOCAL_PLAYER_ACTIONS = new Set([
  'player-part', 'player-item', 'player-style', 'player-none', 'player-palette',
  'player-close-palette', 'player-color', 'player-output', 'player-info', 'close-player-info',
  'close-player-info-backdrop', 'player-reset', 'player-undo', 'player-redo',
  'player-random', 'player-clear', 'player-profile-name', 'player-profile-world',
  'player-profile-description', 'player-profile-tags', 'player-soul-document',
  'player-reset-soul-document', 'player-reset-all-soul', 'player-export',
  'player-preview-export', 'close-player-export', 'close-player-export-backdrop',
  'player-export-retry', 'player-export-recipe', 'player-download-png',
  'player-export-size', 'player-export-background',
  'player-retry-save',
]);

/** Same approved DOM, distinct local input boundary; never a certified session. */
export function projectMakerV8LocalPlayerView(snapshot, state = {}, capabilities = {}) {
  const local = assertMakerV8LocalPlayerSnapshot(snapshot);
  const supplied = normalizeCapabilities(capabilities);
  const controls = {};
  for (const action of LOCAL_PLAYER_ACTIONS) controls[action] = supplied.entries[action] || supplied.fallback;
  for (const [action, capability] of Object.entries(supplied.entries)) {
    if (LOCAL_PLAYER_ACTIONS.has(action.split(':')[0])) controls[action] = capability;
  }
  const document = local.document;
  const localUrl = (value) => {
    const url = safeUrl(value);
    return url.startsWith('blob:') || url.startsWith('data:image/') ? url : '';
  };
  const selections = local.recipe.selections.map((selection) => {
    const part = document.parts.find((row) => row.key === selection.partKey);
    const item = part.items.find((row) => row.key === selection.itemKey);
    const style = item.styles.find((row) => row.key === selection.styleKey);
    return baseSelectionAuthority(part, item, style);
  });
  const reason = makerWorkspaceText(LOCALES.has(state.locale) ? state.locale : 'en', 'playerPurchaseUnavailable');
  return projectPlayerPresentation({
    mode: 'LOCAL_DRAFT', draftId: local.draftId, draftRevision: local.draftRevision,
    player: { document, makerVersion: document.lineage.version },
    recipe: { ...local.recipe, selections },
    execution: { writeEnabled: false, completeEnabled: false, disabledReason: reason },
  }, {
    ...state, recipeValid: !makerV8RecipeConstraintIssue(document, local.recipe.selections), undoDepth: local.undoDepth, redoDepth: local.redoDepth,
    profile: local.profile,
    soul: { defaults: document.livingContent, documents: local.soulDocuments },
    assetUrls: Object.fromEntries(document.assets.map((asset) => [asset.id, localUrl(state.assetUrls?.[asset.id])])),
    makerAccess: { accessible: true }, completionIssues: [reason],
    publishFlow: { open: false }, recoveryBranches: [], selectedRecoveryWriterId: '', completionConfirmation: null, completedSoul: null, envelopeRecoveryAvailable: false,
    save: state.localSave || { state: 'idle' },
    export: { ...state.export, previewUrl: localUrl(state.export?.previewUrl), completionConfirmed: false, shareUrl: '', shareState: '' },
  }, { default: false, controls }, document.assets.map((asset) => ({
    assetId: asset.id, kind: asset.kind, mediaType: asset.mediaType, byteLength: asset.byteLength,
  })));
}

function projectPlayerPresentation(exact, state, capabilities, assetRecords) {
  const player = exact.player;
  const document = player.document;
  const locale = LOCALES.has(state.locale) ? state.locale : 'en';
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  const boundaryReason = String(
    state.capabilityReason
    || exact.execution.disabledReason
    || makerWorkspaceText(locale, 'playerControlUnavailable'),
  );
  const contextualChoices = projectContextualChoices(player);
  const enabledPackReleaseIds = [...assertMakerV8EnabledPackReleaseIds(state.enabledPackReleaseIds ?? [], exact.recipe)];
  const allChoices = [...projectBaseChoices(document), ...contextualChoices.filter(choice => (
    choice.source !== 'PACK' || enabledPackReleaseIds.includes(choice.releaseId)
  ))];
  const selected = new Map();
  exact.recipe.selections.forEach((selection) => {
    const key = makerV8PlayerPartUiKey(player, selection);
    if (!selected.has(key)) selected.set(key, []);
    selected.get(key).push(selection);
  });
  // Only the projected UI key is namespaced. Source documents and choices keep
  // their protocol keys, and certified resolution supplies each owned Part.
  const definitions = new Map((document.parts || []).map(part => [part.key, {
    ...part, partKey: part.key, sourceId: player.rootId,
  }]));
  for (const choice of allChoices) {
    const resolved = makerV8PlayerPart(player, choice);
    const key = makerV8PlayerPartUiKey(player, choice);
    if (!resolved || definitions.has(key)) continue;
    definitions.set(key, { ...resolved.definition, key,
      partKey: resolved.definition.key, sourceId: resolved.sourceId,
      label: `${resolved.definition.label || resolved.definition.key} · ${choice.semanticPackId} (${resolved.sourceId.slice(0, 8)}…${resolved.sourceId.slice(-4)})` });
  }
  const parts = [...definitions.values()].filter(part => part.visible === true).map((part) => {
    const choices = allChoices.filter((choice) => makerV8PlayerPartUiKey(player, choice) === part.key);
    const selections = selected.get(part.key) || [];
    return {
      ...part,
      choices,
      selections,
      // Keep the approved single-capacity projection stable while exposing the
      // complete Fresh loadout for capacity > 1 Parts.
      selected: selections[0] || null,
    };
  });
  const requestedPartKey = String(state.selectedPartKey || '');
  const candidateIssue = selections => exact.mode === 'LOCAL_DRAFT'
    ? makerV8LocalRecipeTransitionIssue(document, selections, exact.recipe.selections)
    : makerV8PlayerRecipeConstraintIssue(exact.player, selections);
  const restrict = (action, subject, reason) => {
    const host = resolveCapability({ capabilities: normalizedCapabilities }, action, subject);
    normalizedCapabilities.entries[`${action}:${subject}`] = {
      enabled: false,
      reason: !host.enabled ? host.reason || boundaryReason : reason,
    };
  };
  for (const part of parts) {
    for (const choice of part.choices) {
      const selected = part.selections.some((entry) => sameSelectionBinding(entry, choice));
      const canRemove = selected && (part.selections.length > 1
        || (part.required !== true && part.kind !== 'LAST_BASTION'));
      const sameItemSelected = part.selections.some((entry) => pickerItemKey(entry) === pickerItemKey(choice));
      const full = part.capacity > 1 && part.selections.length >= part.capacity && !sameItemSelected;
      const blockedAccess = choice.contextual && !choice.access.canEquip && !canRemove;
      const constraintIssue = candidateIssue(candidateSelections(player, exact.recipe.selections, part, choice, canRemove));
      if (!full && !blockedAccess && !constraintIssue) continue;
      const reason = blockedAccess ? choice.access.reason || boundaryReason
        : full ? tr({ locale }, 'playerSlotCapacityFull', { capacity: part.capacity })
          : constraintIssue.message;
      for (const action of ['player-item', 'player-style']) {
        restrict(action, choice.id, reason);
      }
    }
    if (part.required !== true && part.kind !== 'LAST_BASTION') {
      const removalIssue = candidateIssue(exact.recipe.selections.filter(selection => makerV8PlayerPartUiKey(player, selection) !== part.key));
      if (removalIssue) restrict('player-none', part.key, removalIssue.message);
    }
  }
  const selectedPartKey = parts.some((part) => part.key === requestedPartKey)
    ? requestedPartKey : parts[0]?.key || '';
  const soulDocuments = SOUL_DOCUMENTS.map((entry) => soulDocumentState(state, entry));
  const profile = {
    name: String(state.profile?.name || ''),
    world: String(state.profile?.world || ''),
    description: String(state.profile?.description || ''),
    tags: String(state.profile?.tags || ''),
  };
  const validationKnown = typeof state.recipeValid === 'boolean';
  const recipeValid = validationKnown && state.recipeValid;
  const renderReady = state.render?.state === 'ready';
  const completionIssues = Array.isArray(state.completionIssues)
    ? state.completionIssues.map(String)
    : [boundaryReason];
  if (!recipeValid && validationKnown && !completionIssues.length) {
    completionIssues.push(tr({ locale }, 'fixRuleConflict'));
  }
  const executionReady = exact.execution.writeEnabled === true
    || exact.execution.completeEnabled === true;
  const completeReady = recipeValid && renderReady && executionReady && completionIssues.length === 0;
  const makerAccess = plain(state.makerAccess)
    && typeof state.makerAccess.accessible === 'boolean'
    ? {
        known: true,
        accessible: state.makerAccess.accessible,
        reason: String(state.makerAccess.reason || ''),
      }
    : { known: false, accessible: false, reason: boundaryReason };
  const executionDenied = !executionReady && (exact.execution.writeEnabled === false
    || exact.execution.completeEnabled === false);
  const accessBoundaryReason = makerAccess.known && !makerAccess.accessible
    ? makerAccess.reason || boundaryReason
    : executionDenied ? String(exact.execution.disabledReason || boundaryReason) : '';
  let packBoundaryReason = '';
  for (const choice of contextualChoices.filter((entry) => entry.source === 'PACK')) {
    const action = choice.access.accessible
      ? 'player-expansion-v8'
      : choice.access.availableForAcquire || choice.access.canRetryRuntime
        ? 'player-acquire-expansion-v8' : '';
    const capability = action
      ? resolveCapability({ capabilities: normalizedCapabilities }, action, choice.releaseId)
      : null;
    if (!action || capability?.enabled !== true) {
      packBoundaryReason = choice.access.reason || capability?.reason || boundaryReason;
      break;
    }
  }
  const boundaryActions = new Set([
    // openPlayerSession does not expose donor access-gate or legacy embedded
    // expansion state. Record the boundary instead of inventing authority.
    'player-unlock-maker',
    'player-expansion',
    'player-unlock-pack',
    ...Object.entries(normalizedCapabilities.entries)
      .filter(([, capability]) => !capability.enabled)
      .map(([action]) => action),
  ]);
  if (!validationKnown) boundaryActions.add('player-complete');
  if (!executionReady) boundaryActions.add('player-confirm-complete');
  if (!state.export?.previewUrl) boundaryActions.add('player-download-png');
  const boundaries = [...boundaryActions].sort().map((action) => ({
    code: 'FRESH_PLAYER_CAPABILITY_UNAVAILABLE',
    action,
    reason: normalizedCapabilities.entries[action]?.reason || boundaryReason,
  }));
  return deepFreeze({
    schemaVersion: MAKER_V8_APPROVED_PLAYER_VIEW_SCHEMA,
    locale,
    ...(exact.mode === 'LOCAL_DRAFT'
      ? { mode: exact.mode, draftId: exact.draftId, draftRevision: exact.draftRevision }
      : { rootId: exact.rootId, loadout: exact.loadout }),
    player,
    document,
    recipe: exact.recipe,
    execution: exact.execution,
    parts,
    selectedPartKey,
    pickerPanel: PICKER_PANELS.has(state.pickerPanel) ? state.pickerPanel : 'parts',
    contextualChoices,
    enabledPackReleaseIds,
    packAcquisition: plain(state.packAcquisition) ? structuredClone(state.packAcquisition) : null,
    completionConfirmation: plain(state.completionConfirmation) ? clone(state.completionConfirmation) : null,
    completedSoul: plain(state.completedSoul) ? clone(state.completedSoul) : null,
    envelopeRecoveryAvailable: state.envelopeRecoveryAvailable === true,
    assets: projectAssets(player, state, assetRecords),
    profile,
    soulDocuments,
    recipeValid,
    validationKnown,
    render: {
      state: String(state.render?.state || 'pending'),
      message: String(state.render?.message || makerWorkspaceText(locale, 'loadingDefaultRecipe')),
    },
    playerTest: {
      state: String(state.playerTest?.state || 'idle'),
      message: String(state.playerTest?.message || ''),
    },
    save: {
      state: SAVE_STATES.has(state.save?.state) ? state.save.state : 'idle',
      savedAt: String(state.save?.savedAt || ''),
      error: String(state.save?.error || ''),
    },
    undoDepth: Number.isSafeInteger(state.undoDepth) ? Math.max(0, state.undoDepth) : 0,
    redoDepth: Number.isSafeInteger(state.redoDepth) ? Math.max(0, state.redoDepth) : 0,
    introOpen: state.introOpen === true,
    export: {
      open: state.export?.open === true,
      state: EXPORT_STATES.has(state.export?.state) ? state.export.state : 'idle',
      error: String(state.export?.error || ''),
      previewUrl: safeUrl(state.export?.previewUrl),
      sizeMode: state.export?.sizeMode === 'original' ? 'original' : 'standard',
      transparent: state.export?.transparent === true,
      standard: plain(state.export?.standard) ? state.export.standard : { width: 1024, height: 1024 },
      original: plain(state.export?.original) ? state.export.original : {
        width: document.canvas?.width || 1024,
        height: document.canvas?.height || 1024,
      },
      originalSafe: state.export?.originalSafe === true,
      completionConfirmed: state.export?.completionConfirmed === true,
      shareUrl: safeUrl(state.export?.shareUrl),
      shareState: String(state.export?.shareState || ''),
    },
    recoveryBranches: Array.isArray(state.recoveryBranches)
      ? state.recoveryBranches.map((branch) => clone(branch)) : [],
    selectedRecoveryWriterId: String(state.selectedRecoveryWriterId || ''),
    publishFlow: plain(state.publishFlow) ? clone(state.publishFlow) : { open: false },
    completionIssues,
    completeReady,
    makerAccess,
    accessBoundaryReason,
    packBoundaryReason,
    capabilities: normalizedCapabilities,
    boundaryReason,
    boundaries,
  });
}

function selectedChoice(view, part) {
  return selectedChoices(view, part)[0] || null;
}

function selectedChoices(view, part) {
  if (!Array.isArray(part?.selections)) return [];
  return part.selections.flatMap((selection) => {
    const choice = part.choices.find((candidate) => (
      selectionKey(candidate) === selectionKey(selection)
    ));
    return choice ? [choice] : [];
  });
}

function choiceThumbnail(view, choice) {
  if (choice.contextual && choice.protected && !choice.access.accessible) return '<i>PNG</i>';
  const url = view.assets[choice.assetId]?.url || '';
  return url
    ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" />`
    : '<i>PNG</i>';
}

function renderSoulConfiguration(view) {
  const documents = view.soulDocuments.map((entry) => {
    const editorId = `v4PlayerSoul-${entry.key}`;
    const statusId = `${editorId}-status`;
    const error = entry.valid ? '' : entry.error || tr(view, entry.value.trim() ? 'soulValidationInvalid' : 'soulEmptyDocument');
    return `
      <details class="v4-player-soul-document ${entry.valid ? 'valid' : 'invalid'}" data-player-soul-wrapper="${escapeHtml(entry.key)}" ${entry.key === 'soulMd' ? 'open' : ''}>
        <summary>
          <span><code>${escapeHtml(entry.filename)}</code><strong>${escapeHtml(tr(view, entry.titleKey))}</strong></span>
          <small data-player-soul-summary="${escapeHtml(entry.key)}">${escapeHtml(tr(view, entry.customized ? 'playerSoulCustomized' : 'playerSoulMakerDefault'))} · ${escapeHtml(tr(view, entry.valid ? 'soulValidationValid' : 'soulValidationInvalid'))}</small>
        </summary>
        <div class="v4-player-soul-editor">
          <p>${escapeHtml(tr(view, entry.copyKey))}</p>
          <label for="${editorId}">${escapeHtml(tr(view, 'playerSoulEditDocument', { filename: entry.filename }))}</label>
          <textarea id="${editorId}" data-action="player-soul-document" data-soul-key="${escapeHtml(entry.key)}" spellcheck="false" aria-invalid="${entry.valid ? 'false' : 'true'}" aria-describedby="${statusId}"${controlAttributes(view, 'player-soul-document', entry.key)}>${escapeHtml(entry.value)}</textarea>
          <footer id="${statusId}" role="status" aria-live="polite">
            <span data-player-soul-size="${escapeHtml(entry.key)}">${escapeHtml(tr(view, 'soulDocumentSize', { bytes: entry.bytes, limit: entry.maxBytes }))}</span>
            <span class="v4-player-soul-error" data-player-soul-error="${escapeHtml(entry.key)}" ${error ? '' : 'hidden'}>${escapeHtml(error)}</span>
            <button type="button" data-action="player-reset-soul-document" data-soul-key="${escapeHtml(entry.key)}"${controlAttributes(view, 'player-reset-soul-document', entry.key, entry.customized ? '' : tr(view, 'playerSoulMakerDefault'))}>${escapeHtml(tr(view, 'playerSoulRestoreDefault'))}</button>
          </footer>
        </div>
      </details>`;
  }).join('');
  const allValid = view.soulDocuments.every((entry) => entry.valid);
  const customized = view.soulDocuments.some((entry) => entry.customized);
  return `
    <details class="v4-player-soul-card">
      <summary><span><strong>${escapeHtml(tr(view, 'soulConfig'))}</strong><small>${escapeHtml(tr(view, 'soulConfigTitle'))}</small></span><em data-player-soul-card-status>${escapeHtml(tr(view, allValid ? 'soulValidationValid' : 'soulValidationInvalid'))}</em></summary>
      <div class="v4-player-soul-intro"><p>${escapeHtml(tr(view, 'playerSoulConfigCopy'))}</p><button type="button" data-action="player-reset-all-soul"${controlAttributes(view, 'player-reset-all-soul', '', customized ? '' : tr(view, 'playerSoulMakerDefault'))}>${escapeHtml(tr(view, 'playerSoulRestoreAllDefaults'))}</button></div>
      <div class="v4-player-soul-documents">${documents}</div>
      <small class="v4-player-soul-save-copy">${escapeHtml(tr(view, 'playerSoulDraftSaveCopy'))}</small>
    </details>`;
}

function renderPalette(view, part) {
  const choice = selectedChoice(view, part);
  const channel = choice?.colorChannelKey
    ? makerV8PlayerColor(view.player, choice)?.definition : null;
  const selectedColors = makerV8PlayerColorMap(view.player, view.recipe.colors || []);
  const rows = channel ? `
    <article class="v4-player-color-channel-card">
      <header><div><strong>${escapeHtml(channel.label)}</strong><small>${escapeHtml(tr(view, 'playerPaletteChannelCount', { count: 1 }))}</small></div></header>
      <div class="v4-player-colors" role="radiogroup" aria-label="${escapeHtml(channel.label)}">
        <div>${(channel.swatches || []).map((swatch) => {
          const active = makerV8PlayerSwatchKey(view.player, selectedColors, choice) === swatch.key;
          const entry = makerV8PlayerColorEntry(view.player, choice, swatch.key);
          return `<button type="button" class="${active ? 'active' : ''}" data-action="player-color" data-channel-id="${escapeHtml(channel.key)}" data-swatch-id="${escapeHtml(swatch.key)}"${entry.releaseId ? ` data-release-id="${escapeHtml(entry.releaseId)}"` : ''} role="radio" aria-checked="${active}" aria-label="${escapeHtml(tr(view, 'playerPaletteSwatchLabel', { channel: channel.label, swatch: swatch.label }))}" title="${escapeHtml(swatch.label)}" style="--swatch:${escapeHtml(swatch.rgba || swatch.hintColor || '#808080')}"${controlAttributes(view, 'player-color', makerV8PlayerColorControlKey(entry))}><i aria-hidden="true"></i><span>${escapeHtml(swatch.label)}</span>${active ? '<b aria-hidden="true">✓</b>' : ''}</button>`;
        }).join('')}</div>
      </div>
    </article>` : '';
  return `
    <section class="v4-player-palette-panel">
      <header><div><span>${escapeHtml(tr(view, 'smartColor'))}</span><h2>${escapeHtml(tr(view, 'currentPartColors', { part: part?.label || tr(view, 'currentPart') }))}</h2><p>${escapeHtml(tr(view, 'playerPaletteContextCopy'))} ${escapeHtml(tr(view, 'playerPaletteReturnHint'))}</p></div><div class="v4-player-palette-actions"><strong>${escapeHtml(tr(view, 'playerPaletteSummary', { channels: channel ? 1 : 0, presets: channel?.swatches?.length || 0 }))}</strong><button type="button" data-action="player-close-palette" aria-label="${escapeHtml(tr(view, 'playerPaletteReturnForPart', { part: part?.label || tr(view, 'currentPart') }))}" title="${escapeHtml(tr(view, 'playerPaletteReturnForPart', { part: part?.label || tr(view, 'currentPart') }))}"${controlAttributes(view, 'player-close-palette')}>← ${escapeHtml(tr(view, 'returnToCurrentPart'))}</button></div></header>
      <div class="v4-player-color-channel-grid">${rows || `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'playerPaletteUnavailable'))}</span></div>`}</div>
    </section>`;
}

function renderExpansionPacks(view) {
  const releases = new Map();
  view.contextualChoices.filter((choice) => choice.source === 'PACK').forEach((choice) => {
    const key = String(choice.releaseId || choice.semanticPackId || choice.id);
    if (!releases.has(key)) releases.set(key, []);
    releases.get(key).push(choice);
  });
  const pendingRelease = view.packAcquisition?.releaseId;
  if (pendingRelease && !releases.has(pendingRelease)) {
    // A suspended/revoked Pack is not a catalog choice. Keep only its durable
    // transaction prompt reachable; this row grants no Style/asset authority.
    releases.set(pendingRelease, [{ label: `${tr(view, 'playerPackRecover')} · ${pendingRelease}`,
      access: { accessible: false, availableForAcquire: false, canRetryRuntime: false } }]);
  }
  if (!releases.size) return '';
  const cards = [...releases.entries()].map(([releaseId, choices]) => {
    const access = choices[0].access;
    const accessDrift = choices.some((choice) => (
      choice.access.accessible !== access.accessible
      || choice.access.availableForAcquire !== access.availableForAcquire
      || choice.access.canRetryRuntime !== access.canRetryRuntime
    ));
    const exactAccess = accessDrift ? {
      accessible: false,
      availableForAcquire: false,
      canRetryRuntime: false,
      reason: view.boundaryReason,
    } : access;
    const enabled = view.enabledPackReleaseIds.includes(releaseId);
    const status = exactAccess.accessible
      ? tr(view, 'playerPackOwned')
      : exactAccess.canRetryRuntime
        ? tr(view, 'playerPackArtworkNeedsRetry')
        : exactAccess.availableForAcquire
          ? choices[0].entry?.kind === 0 ? tr(view, 'playerPackFree')
            : choices[0].entry?.kind === 2 ? tr(view, 'playerPackIncluded') : tr(view, 'playerPackPaid')
          : tr(view, 'playerPurchaseUnavailable');
    const blockedReason = exactAccess.reason || view.boundaryReason;
    let control = exactAccess.accessible
      ? `<label class="v4-player-expansion-toggle"><input type="checkbox" data-action="player-expansion-v8" value="${escapeHtml(releaseId)}" ${enabled ? 'checked' : ''}${controlAttributes(view, 'player-expansion-v8', releaseId)} /><span aria-hidden="true"></span></label>`
      : exactAccess.availableForAcquire || exactAccess.canRetryRuntime
        ? `<button type="button" class="v4-player-expansion-unlock" data-action="player-acquire-expansion-v8" data-release-id="${escapeHtml(releaseId)}"${controlAttributes(view, 'player-acquire-expansion-v8', releaseId)}>${escapeHtml(exactAccess.canRetryRuntime ? tr(view, 'playerRetryPackArtwork') : tr(view, 'playerUnlockPack'))}<small>${escapeHtml(status)}</small></button>`
        : `<button type="button" class="v4-player-expansion-unlock" disabled aria-disabled="true" title="${escapeHtml(blockedReason)}">${escapeHtml(tr(view, 'playerPurchaseUnavailable'))}</button>`;
    const acquisition = view.packAcquisition?.releaseId === releaseId ? view.packAcquisition : null;
    if (acquisition) {
      const record = acquisition.record;
      const quote = record?.packEntryQuote;
      const attributes = `data-release-id="${escapeHtml(releaseId)}" data-action-id="${escapeHtml(record?.actionId || '')}"`;
      const button = (action, label) => `<button type="button" data-action="${action}" ${attributes}${controlAttributes(view, action)}>${escapeHtml(tr(view, label))}</button>`;
      const price = quote?.kind === 1
        ? `${quote.priceAtomic} ${tr(view, 'playerPackAtomicUnits')} · ${quote.paymentCoinType}`
        : quote?.kind === 2 ? tr(view, 'playerPackIncluded') : tr(view, 'playerPackFree');
      control = `<div class="v4-player-commerce-error" role="status">
        ${acquisition.pending ? escapeHtml(tr(view, 'playerPurchasePending'))
          : `${quote ? `<p>${escapeHtml(price)}</p><small>${escapeHtml(tr(view, 'playerPackEntryOnly'))}</small>` : ''}
            ${acquisition.error ? `<p>${escapeHtml(acquisition.error)}</p>` : ''}
            ${record && record.status !== 'PREPARED' && record.status !== 'FINALIZED_SUCCESS'
              ? `<p>${escapeHtml(record.status)}</p>` : ''}
            ${record?.status === 'FINALIZED_SUCCESS' ? escapeHtml(tr(view, 'playerPackTransactionFinalized'))
              : record?.status === 'PREPARED' && !acquisition.error && quote
                ? button('player-confirm-pack-v8', 'playerPackConfirm')
                : record && !['FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(record.status)
                  ? button('player-recover-pack-v8', 'playerPackRecover') : ''}
            ${button('player-cancel-pack-v8', 'playerPackDismiss')}`}
      </div>`;
    }
    return `
      <article class="v4-player-expansion-card independent-v8 ${exactAccess.accessible ? 'accessible' : 'locked'} ${enabled ? 'enabled' : ''}" data-release-id="${escapeHtml(releaseId)}">
        <div><strong>${escapeHtml(choices[0].label)}</strong><small>${escapeHtml(status)}</small></div>
        ${control}
      </article>`;
  }).join('');
  const notice = view.packBoundaryReason
    ? `<div class="v4-player-commerce-error" role="status">${escapeHtml(view.packBoundaryReason)}</div>`
    : '';
  return `<details class="v4-player-expansions"><summary>${escapeHtml(tr(view, 'expansionPacks'))}</summary><p>${escapeHtml(tr(view, 'expansionSelectionSaved'))}</p>${notice}<div class="v4-player-expansion-grid">${cards}</div></details>`;
}

function renderPartPicker(view, part) {
  if (!part) return `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'noPlayableParts'))}</span></div>`;
  const multiCapacity = part.capacity > 1;
  const optionRole = multiCapacity ? 'checkbox' : 'radio';
  const groupRole = multiCapacity ? 'group' : 'radiogroup';
  const selected = selectedChoice(view, part);
  const selectedKeys = new Set(part.selections.map(selectionKey));
  const selectedItemKeys = new Set(selectedChoices(view, part)
    .map(pickerItemKey));
  const items = new Map();
  part.choices.forEach((choice) => {
    const key = pickerItemKey(choice);
    if (!items.has(key)) items.set(key, []);
    items.get(key).push(choice);
  });
  const itemButtons = [...items.values()].map((choices, index) => {
    const available = choices.filter((candidate) => resolveCapability(view, 'player-item', candidate.id).enabled);
    const choice = choices.find((candidate) => selectedKeys.has(selectionKey(candidate)))
      || available.find((candidate) => candidate.styleKey === selected?.styleKey)
      || available[0]
      || choices.find((candidate) => candidate.styleKey === selected?.styleKey)
      || choices[0];
    const active = choices.some((candidate) => selectedKeys.has(selectionKey(candidate)));
    const reasonId = `v4-player-item-reason-${encodeURIComponent(part.key)}-${index}`;
    return `<button type="button" class="v4-player-item ${active ? 'active' : ''}" data-action="player-item" data-part-id="${escapeHtml(part.key)}" data-item-id="${escapeHtml(choice.itemKey)}" data-choice-id="${escapeHtml(choice.id)}" role="${optionRole}" aria-checked="${active}" aria-describedby="${reasonId}"${controlAttributes(view, 'player-item', choice.id)}><span class="v4-player-option-image">${choiceThumbnail(view, choice)}</span><strong>${escapeHtml(choice.label)}</strong><small class="v4-player-selected-mark">${escapeHtml(tr(view, active ? 'selectedState' : 'noneState'))}</small><small id="${reasonId}" class="v4-player-option-reason">${escapeHtml(resolveCapability(view, 'player-item', choice.id).enabled ? '' : capabilityReason(view, 'player-item', choice.id))}</small></button>`;
  }).join('');
  const styleButtons = selected ? part.choices.filter((choice) => (
    selectedItemKeys.has(pickerItemKey(choice))
  )).map((choice) => {
    const active = selectedKeys.has(selectionKey(choice));
    return `<button type="button" class="v4-player-style-option ${active ? 'active' : ''}" data-action="player-style" data-part-id="${escapeHtml(part.key)}" data-item-id="${escapeHtml(choice.itemKey)}" data-style-id="${escapeHtml(choice.styleKey)}" data-choice-id="${escapeHtml(choice.id)}" role="${optionRole}" aria-checked="${active}"${controlAttributes(view, 'player-style', choice.id)}>${escapeHtml(choice.label)}</button>`;
  }).join('') : '';
  const canRemove = part.required !== true && part.kind !== 'LAST_BASTION';
  const removeReason = !canRemove ? view.boundaryReason
    : resolveCapability(view, 'player-none', part.key).enabled ? ''
      : capabilityReason(view, 'player-none', part.key);
  return `
    <header><div><span>${escapeHtml(tr(view, 'currentPart'))}</span><h2 id="v4PlayerItemGroupLabel">${escapeHtml(part.label)}</h2></div><div class="v4-player-remove-control"><button type="button" data-action="player-none" data-part-id="${escapeHtml(part.key)}" class="secondary" aria-describedby="v4PlayerRemovePartReason"${controlAttributes(view, 'player-none', part.key, removeReason)}>${escapeHtml(tr(view, 'noneRemove'))}</button><small id="v4PlayerRemovePartReason" class="v4-player-disabled-reason">${escapeHtml(removeReason)}</small></div></header>
    <div class="v4-player-item-grid" role="${groupRole}" aria-labelledby="v4PlayerItemGroupLabel">${itemButtons || `<div class="v4-inline-empty"><span>${escapeHtml(tr(view, 'noAvailableItems'))}</span></div>`}</div>
    ${styleButtons ? `<div class="v4-player-style-picker" role="${groupRole}" aria-labelledby="v4PlayerStyleGroupLabel"><span id="v4PlayerStyleGroupLabel">${escapeHtml(tr(view, 'style'))}</span>${styleButtons}</div>` : ''}
    ${renderExpansionPacks(view)}`;
}

function renderRecovery(view) {
  if (!view.recoveryBranches.length) return '';
  const branches = view.recoveryBranches.map((branch, index) => {
    const active = branch.writerId === view.selectedRecoveryWriterId;
    const name = String(branch.session?.profile?.name || tr(view, 'untitledOc'));
    const base = branch.baseRevision == null ? tr(view, 'playerRecoveryNewDraft') : branch.baseRevision;
    return `<button type="button" class="${active ? 'active' : ''}" data-action="player-select-recovery" data-writer-id="${escapeHtml(branch.writerId)}" aria-pressed="${active}"${controlAttributes(view, 'player-select-recovery', branch.writerId)}><strong>${escapeHtml(tr(view, 'playerRecoveryCopyLabel', { index: index + 1, name }))}</strong><small>${escapeHtml(tr(view, 'playerRecoveryCopyMeta', { revision: branch.revision, base }))}</small></button>`;
  }).join('');
  return `<section class="v4-player-recovery" role="region" aria-labelledby="v4PlayerRecoveryTitle"><div><strong id="v4PlayerRecoveryTitle">${escapeHtml(tr(view, 'playerRecoveryTitle', { count: view.recoveryBranches.length }))}</strong><p role="alert">${escapeHtml(tr(view, 'playerRecoveryCopy'))}</p></div><div class="v4-player-recovery-branches">${branches}</div><button type="button" data-action="player-export-recovery"${controlAttributes(view, 'player-export-recovery')}>${escapeHtml(tr(view, 'playerRecoveryExport'))}</button></section>`;
}

function renderCompletionConfirmation(view) {
  const confirmation = view.completionConfirmation;
  if (!confirmation) return '';
  const step = confirmation.step;
  const record = step.record;
  const isOverview = step.kind === 'COMPLETION_OVERVIEW';
  const stageKey = isOverview ? 'playerOverviewTitle' : step.kind === 'NATIVE_ENVELOPES' ? 'playerStepEnvelopes'
    : step.kind === 'NEW_COMPLETION' ? 'playerStepStartAnother' : step.kind === 'STORAGE_BATCH'
    ? step.review?.stage === 'REGISTER' ? 'playerStepBatchRegister' : 'playerStepBatchCertify' : step.kind === 'STORAGE_UPLOAD'
    ? step.purpose === 'RENDER' ? 'playerStepRenderUpload' : 'playerStepNativeUpload'
    : { acquireMakerAccess: 'playerStepMakerAccess', acquirePackAccess: 'playerStepPackAccess',
      acquireBaseItem: 'playerStepBaseItem', commitLoadout: 'playerStepLoadout', completeOutput: 'playerStepComplete' }[step.action];
  const row = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const atomic = value => `${value} ${tr(view, 'playerPackAtomicUnits')}`;
  const policyRows = line => {
    const modeKey = ['completeUnlimitedFree', 'completeQuotaThenPaid', 'completePaidEveryTime', 'completeQuotaThenBlock'][line.mode];
    return row(tr(view, 'completePolicy'), tr(view, modeKey))
      + ([1, 3].includes(line.mode) ? row(tr(view, 'playerStepFreeRemaining'), line.remainingFreeUses) : '')
      + row(tr(view, 'playerStepTotalRemaining'), line.remainingTotalUses === null ? tr(view, 'unlimited') : line.remainingTotalUses)
      + ([1, 2].includes(line.mode) ? row(tr(view, 'playerStepPolicyPrice'), atomic(line.priceAtomic)) : '');
  };
  let details;
  if (step.kind === 'NEW_COMPLETION') {
    details = `<p>${escapeHtml(tr(view, 'playerStepStartAnotherCopy'))}</p><dl>${row('Soul ID', step.soulId)}${row('Action ID', step.actionId)}${row('Transaction digest', step.transactionDigest)}</dl>`;
  } else if (step.kind === 'NATIVE_ENVELOPES') {
    details = `<p>${escapeHtml(tr(view, 'playerStepEnvelopesCopy'))}</p><dl>${row('Soul ID', step.soulId)}${row('State ID', step.stateId)}${row('Transaction digest', step.transactionDigest)}${row(tr(view, 'playerStepGasBudget'), `${step.gasBudgetMist} MIST`)}${row('Envelopes', step.envelopeCount)}</dl>`;
  } else if (step.kind === 'STORAGE_BATCH') {
    const review = step.review;
    details = `<p>${escapeHtml(tr(view, 'playerStepBatchCopy'))}</p><dl>${row('Files', step.memberIds.length)}${row(tr(view, 'walrusTotalEstimate'), `${review.quote.walrusTotalCostFrost} FROST`)}${row(tr(view, 'relayTipEstimate'), `${review.quote.relayTipMist} MIST`)}${row(tr(view, 'playerStepGasBudget'), `${review.gasBudgetMist} MIST`)}</dl><details><summary>${escapeHtml(tr(view, 'technicalDetails'))}</summary><dl>${row('Batch ID', step.batchKey)}${row('Transaction digest', review.digest)}${step.memberIds.map(id => row('Upload ID', id)).join('')}</dl></details>`;
  } else if (step.kind === 'STORAGE_UPLOAD') {
    details = `<p>${escapeHtml(tr(view, 'playerStepStorageCopy'))}</p><dl>${row('Upload ID', step.uploadId)}${row('Bytes', step.byteLength)}${row('SHA-256', step.byteSha256)}</dl>`;
  } else if (isOverview || step.action === 'completeOutput') {
    const quote = isOverview ? step.overview.completePaymentQuote : record.completePaymentQuote;
    const rights = quote.rights;
    details = `<dl>${row(tr(view, 'playerCommerceContentCharge'), atomic(quote.maker.contentAmountAtomic))}${row(tr(view, 'playerCommerceProtocolFee'), atomic(quote.maker.fixedFeeAtomic))}${policyRows(quote.maker)}</dl>`
      + quote.packs.map(pack => `<h3>${escapeHtml(pack.semanticPackId)}</h3><dl>${row('Release ID', pack.releaseId)}${row(tr(view, 'playerCommerceContentCharge'), atomic(pack.contentAmountAtomic))}${policyRows(pack)}</dl>`).join('')
      + `<dl>${row(tr(view, 'playerCommerceTotal'), atomic(quote.totalAmountAtomic))}${row('Coin type', quote.paymentCoinType)}</dl>`
      + `<details><summary>${escapeHtml(tr(view, 'commerceRights'))}</summary><p>${escapeHtml(tr(view, isOverview ? 'playerOverviewRightsCopy' : 'playerStepRightsCopy'))}</p><dl>${row(tr(view, 'creator'), rights.creator)}${row(tr(view, 'soulCreatorRoyalty'), `${rights.soulCreatorRoyaltyBps} bps`)}${row(tr(view, 'makerSourceRoyalty'), `${rights.makerSourceRoyaltyBps} bps`)}${row(tr(view, 'makerResaleRoyalty'), `${rights.makerResaleRoyaltyBps} bps`)}${row('Terms commitment', rights.termsCommitment ?? '—')}${row('Evidence locator', rights.evidenceLocator || '—')}${row('Rights commitment', rights.commitment)}</dl></details><p>${escapeHtml(tr(view, isOverview ? 'playerOverviewCopy' : 'playerStepQuoteCopy'))}</p>`;
    if (isOverview) {
      const entry = step.overview.entryPaymentQuote;
      const entryLine = (label, line) => `<dl>${row(label, atomic(line.required ? line.priceAtomic : '0'))}</dl><p>${escapeHtml(tr(view, line.required ? 'playerOverviewEntryNeeded' : 'playerOverviewEntryHeld'))}</p>`;
      details = `<h3>${escapeHtml(tr(view, 'playerOverviewEntry'))}</h3>`
        + entryLine(tr(view, 'playerStepMakerAccess'), entry.maker)
        + entry.packs.map(pack => `<h4>${escapeHtml(pack.semanticPackId || pack.releaseId)}</h4><dl>${row('Release ID', pack.releaseId)}</dl>${entryLine(tr(view, 'playerStepPackAccess'), pack)}`).join('')
        + entry.baseItems.map(item => `<h4>${escapeHtml(item.partKey)} / ${escapeHtml(item.itemKey)}</h4>${entryLine(tr(view, 'playerStepBaseItem'), item)}`).join('')
        + `<dl>${row(tr(view, 'playerOverviewEntry'), atomic(entry.totalAmountAtomic))}</dl>`
        + `<h3>${escapeHtml(tr(view, 'playerOverviewComplete'))}</h3>${details}`
        + `<dl>${row(tr(view, 'playerOverviewTotal'), atomic(step.overview.totalBusinessAmountAtomic))}${row('Coin type', quote.paymentCoinType)}</dl>`;
    }
  } else {
    const quote = step.action === 'acquireMakerAccess' ? record.makerEntryQuote : record.packEntryQuote;
    details = quote
      ? `<dl>${row(tr(view, 'playerCommerceTotal'), atomic(quote.priceAtomic))}${row('Coin type', quote.paymentCoinType)}</dl><p>${escapeHtml(tr(view, 'playerStepEntryCopy'))}</p>`
      : `<p>${escapeHtml(tr(view, 'playerStepNoBusinessFee'))}</p>`;
  }
  return `<section id="makerPlayerCompletionStep" class="v4-player-commerce-quote" role="region" aria-labelledby="makerPlayerCompletionStepTitle" aria-live="polite"><header><strong id="makerPlayerCompletionStepTitle">${escapeHtml(tr(view, stageKey))}</strong></header>${details}
    ${record ? `<dl>${row('Action ID', record.actionId)}${row('Transaction digest', record.transactionDigest)}</dl>` : ''}
    <small>${escapeHtml(tr(view, 'playerCommerceNetworkSeparate'))}</small><p>${escapeHtml(tr(view, 'playerStepCancelCopy'))}</p>
    <footer><button type="button" data-action="player-cancel-journey-step" data-confirmation-id="${escapeHtml(confirmation.id)}"${controlAttributes(view, 'player-cancel-journey-step')}>${escapeHtml(tr(view, 'playerStepCancel'))}</button><button type="button" class="primary" data-action="player-confirm-journey-step" data-confirmation-id="${escapeHtml(confirmation.id)}"${controlAttributes(view, 'player-confirm-journey-step')}>${escapeHtml(tr(view, isOverview ? 'playerOverviewContinue' : 'playerStepConfirm'))}</button></footer></section>`;
}

function renderExportModal(view) {
  if (!view.export.open) return '';
  const dimensions = view.export.sizeMode === 'original' ? view.export.original : view.export.standard;
  const rendering = view.export.state === 'rendering';
  const renderStatus = rendering ? tr(view, 'renderingFinalImage')
    : view.export.state === 'error'
      ? tr(view, 'finalImageFailed', { error: view.export.error || tr(view, 'previewRenderFailed') })
      : tr(view, 'finalImageReady');
  const selectedSummary = view.parts.flatMap((part) => {
    return selectedChoices(view, part).map((choice) => `${part.label}: ${choice.label}`);
  });
  const completionIssue = view.completionIssues[0] || '';
  const canDownload = view.export.state === 'ready' && view.export.previewUrl
    && (view.mode === 'LOCAL_DRAFT' || view.export.completionConfirmed);
  const canComplete = view.export.state === 'ready' && view.completeReady && !view.completionConfirmation;
  return `
    <div class="v4-modal-backdrop v4-player-export-backdrop" data-action="close-player-export-backdrop">
      <section id="makerPlayerExportDialog" class="v4-player-export-dialog" role="dialog" aria-modal="true" aria-labelledby="makerPlayerExportTitle" tabindex="-1">
        <header><div><span class="v4-eyebrow">${escapeHtml(tr(view, 'previewExport'))}</span><h2 id="makerPlayerExportTitle">${escapeHtml(tr(view, 'finalOcPreview'))}</h2><p>${escapeHtml(tr(view, 'finalOcPreviewCopy'))}</p></div><button type="button" class="v4-dialog-close" data-action="close-player-export" aria-label="${escapeHtml(tr(view, 'continueEditing'))}"${controlAttributes(view, 'close-player-export')}>×</button></header>
        <div class="v4-player-export-body">
          <section class="v4-player-export-preview"><div class="v4-player-export-image ${view.document.canvas?.pixelMode === 'pixelated' ? 'pixelated' : ''}">${view.export.previewUrl ? `<img src="${escapeHtml(view.export.previewUrl)}" alt="${escapeHtml(tr(view, 'previewImageAlt', { name: view.profile.name || tr(view, 'untitledOc') }))}" />` : `<div class="v4-player-export-placeholder"><span aria-hidden="true">✦</span><strong>${escapeHtml(renderStatus)}</strong></div>`}</div><div class="v4-player-export-caption"><div><strong>${escapeHtml(view.profile.name || tr(view, 'untitledOc'))}</strong><span>${escapeHtml(view.profile.world || view.document.metadata.style || tr(view, 'originalCharacter'))}</span></div><span>${escapeHtml(tr(view, 'exportDimensions', dimensions))}</span></div><div class="v4-player-export-selection" aria-label="${escapeHtml(tr(view, 'currentSelection'))}">${selectedSummary.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div></section>
          <aside class="v4-player-export-options">
            <fieldset><legend>${escapeHtml(tr(view, 'exportSize'))}</legend><div class="v4-player-export-choice"><button type="button" data-action="player-export-size" data-size-mode="standard" aria-pressed="${pressed(view.export.sizeMode === 'standard')}" class="${view.export.sizeMode === 'standard' ? 'active' : ''}"${controlAttributes(view, 'player-export-size', 'standard', rendering ? tr(view, 'renderingFinalImage') : '')}><strong>${escapeHtml(tr(view, 'standardSize'))}</strong><small>${escapeHtml(tr(view, 'exportDimensions', view.export.standard))}</small></button><button type="button" data-action="player-export-size" data-size-mode="original" aria-pressed="${pressed(view.export.sizeMode === 'original')}" class="${view.export.sizeMode === 'original' ? 'active' : ''}"${controlAttributes(view, 'player-export-size', 'original', !view.export.originalSafe ? tr(view, 'originalSizeUnavailable') : rendering ? tr(view, 'renderingFinalImage') : '')}><strong>${escapeHtml(tr(view, 'originalSize'))}</strong><small>${escapeHtml(view.export.originalSafe ? tr(view, 'exportDimensions', view.export.original) : tr(view, 'originalSizeUnavailable'))}</small></button></div></fieldset>
            <fieldset><legend>${escapeHtml(tr(view, 'backgroundMode'))}</legend><div class="v4-player-export-choice"><button type="button" data-action="player-export-background" data-transparent="false" aria-pressed="${pressed(!view.export.transparent)}" class="${view.export.transparent ? '' : 'active'}"${controlAttributes(view, 'player-export-background', 'opaque', rendering ? tr(view, 'renderingFinalImage') : '')}>${escapeHtml(tr(view, 'currentBackground'))}</button><button type="button" data-action="player-export-background" data-transparent="true" aria-pressed="${pressed(view.export.transparent)}" class="${view.export.transparent ? 'active' : ''}"${controlAttributes(view, 'player-export-background', 'transparent', rendering ? tr(view, 'renderingFinalImage') : '')}>${escapeHtml(tr(view, 'transparentBackground'))}</button></div></fieldset>
            <div class="v4-player-export-status" role="status" data-state="${escapeHtml(view.export.state)}"><strong>${escapeHtml(renderStatus)}</strong>${view.export.state === 'error' ? `<button type="button" data-action="player-export-retry"${controlAttributes(view, 'player-export-retry')}>${escapeHtml(tr(view, 'retryRender'))}</button>` : ''}</div>
            ${view.completionConfirmation ? renderCompletionConfirmation(view) : `<section class="v4-player-commerce-quote" aria-labelledby="v4PlayerCommerceQuoteTitle"><header><strong id="v4PlayerCommerceQuoteTitle">${escapeHtml(tr(view, 'playerCommerceQuoteTitle'))}</strong><span>${escapeHtml(view.accessBoundaryReason ? tr(view, 'playerPurchaseUnavailable') : tr(view, 'playerCommerceNotQuoted'))}</span></header><p>${escapeHtml(view.accessBoundaryReason || tr(view, 'playerCommerceNotQuoted'))}</p><small>${escapeHtml(tr(view, 'playerCommerceNetworkSeparate'))}</small></section>`}
            <div class="v4-player-export-share"><strong>${escapeHtml(tr(view, 'shareMaker'))}</strong><div><button type="button" data-action="player-copy-maker-link" aria-describedby="makerPlayerShareStatus"${controlAttributes(view, 'player-copy-maker-link', '', view.export.shareUrl ? '' : tr(view, 'makerMustBePublishedToShare'))}>${escapeHtml(tr(view, 'copyMakerLink'))}</button><button type="button" data-action="player-share-maker" aria-describedby="makerPlayerShareStatus"${controlAttributes(view, 'player-share-maker', '', view.export.shareUrl ? '' : tr(view, 'makerMustBePublishedToShare'))}>${escapeHtml(tr(view, 'shareMaker'))}</button></div><small id="makerPlayerShareStatus" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(view.export.shareUrl ? view.export.shareState : tr(view, 'makerMustBePublishedToShare'))}</small></div>
            <p class="v4-player-export-license">${escapeHtml(tr(view, 'exportLicenseNotice'))}</p>
          </aside>
        </div>
        ${view.completedSoul && !view.completionConfirmation ? `<section class="v4-player-export-status" role="status"><p>${escapeHtml(view.completedSoul.matchesProject ? tr(view, 'playerCompletionConfirmed') : tr(view, 'playerStepRecoveredOtherDraft'))}</p><p>${escapeHtml(view.completedSoul.soulId)}</p><button type="button" data-action="player-open-completed-soul" data-completed-action-id="${escapeHtml(view.completedSoul.actionId)}"${controlAttributes(view, 'player-open-completed-soul', '', view.completedSoul.handoffUrl ? '' : view.boundaryReason)}>${escapeHtml(tr(view, 'playerStepOpenSoul'))}</button><button type="button" data-action="player-start-new-completion" data-completed-action-id="${escapeHtml(view.completedSoul.actionId)}"${controlAttributes(view, 'player-start-new-completion')}>${escapeHtml(tr(view, 'playerStepStartAnother'))}</button></section>` : ''}
        ${renderEnvelopeRecovery(view)}
        <footer><p id="makerPlayerExportCompletionIssue" class="v4-player-export-completion-issue" ${completionIssue ? '' : 'hidden'}>${escapeHtml(completionIssue)}</p><button type="button" data-action="close-player-export"${controlAttributes(view, 'close-player-export')}>${escapeHtml(tr(view, 'continueEditing'))}</button><button type="button" data-action="player-export-recipe"${controlAttributes(view, 'player-export-recipe')}>${escapeHtml(tr(view, 'downloadRecipePackage'))}</button><button type="button" data-action="player-download-png"${controlAttributes(view, 'player-download-png', '', canDownload ? '' : tr(view, 'playerDownloadAfterComplete'))}>${escapeHtml(canDownload ? tr(view, 'downloadPng') : tr(view, 'playerDownloadAfterComplete'))}</button><button type="button" class="primary" data-action="player-confirm-complete" aria-describedby="makerPlayerExportCompletionIssue"${controlAttributes(view, 'player-confirm-complete', '', canComplete ? '' : completionIssue || view.boundaryReason)}>${escapeHtml(tr(view, 'continueToPublish'))}</button></footer>
      </section>
    </div>`;
}

function renderEnvelopeRecovery(view) {
  if (!resolveCapability(view, 'player-import-envelope-recovery').enabled) return '';
  return `<section class="v4-player-export-status"><p>${escapeHtml(tr(view, 'playerEnvelopeRecoveryCopy'))}</p>${view.envelopeRecoveryAvailable ? `<button type="button" data-action="player-export-envelope-recovery"${controlAttributes(view, 'player-export-envelope-recovery')}>${escapeHtml(tr(view, 'playerEnvelopeRecoveryExport'))}</button><button type="button" data-action="player-clear-envelope-recovery"${controlAttributes(view, 'player-clear-envelope-recovery')}>${escapeHtml(tr(view, 'playerEnvelopeRecoveryClear'))}</button>` : ''}<label>${escapeHtml(tr(view, 'playerEnvelopeRecoveryImport'))}<input type="file" accept="application/json,.json" data-action="player-import-envelope-recovery"${controlAttributes(view, 'player-import-envelope-recovery', '', view.completionConfirmation ? tr(view, 'playerStepCancelCopy') : '')}></label></section>`;
}

function renderPublishFlow(view) {
  if (view.publishFlow.open !== true) return '';
  const reason = String(view.publishFlow.reason || view.boundaryReason);
  const error = plain(view.publishFlow.error) ? view.publishFlow.error : null;
  const errorPanel = error ? `<aside class="v4-chain-error" role="alert" aria-live="assertive"><div><span>${escapeHtml(error.code || 'CHAIN_ACTION_FAILED')}</span><strong>${escapeHtml(error.title || reason)}</strong></div><p>${escapeHtml(error.message || reason)}</p><details><summary>${escapeHtml(tr(view, 'technicalDetails'))}</summary><pre>${escapeHtml(error.details || '')}</pre></details><div class="v4-chain-error-actions"><button type="button" data-action="copy-player-publish-error"${controlAttributes(view, 'copy-player-publish-error', '', reason)}>${escapeHtml(tr(view, 'copyErrorDetails'))}</button><button class="primary" type="button" data-action="player-publish-retry"${controlAttributes(view, 'player-publish-retry', '', reason)}>${escapeHtml(tr(view, 'retryReleaseStep'))}</button><button class="primary" type="button" data-action="player-publish-recover"${controlAttributes(view, 'player-publish-recover', '', reason)}>${escapeHtml(tr(view, 'recoverPendingRelease'))}</button><button type="button" data-action="player-publish-discard"${controlAttributes(view, 'player-publish-discard', '', reason)}>${escapeHtml(tr(view, 'discardSavedUpload'))}</button></div></aside>` : '';
  const closeConfirmation = view.publishFlow.closeConfirm === true
    ? `<aside id="makerPlayerPublishCloseConfirm" class="v4-chain-close-confirm" role="alertdialog" aria-labelledby="makerPlayerPublishCloseConfirmTitle" aria-describedby="makerPlayerPublishCloseConfirmCopy" tabindex="-1"><strong id="makerPlayerPublishCloseConfirmTitle">${escapeHtml(tr(view, 'publishCloseConfirmTitle'))}</strong><p id="makerPlayerPublishCloseConfirmCopy">${escapeHtml(tr(view, 'publishCloseConfirmCopy'))}</p><div><button class="primary" type="button" data-action="keep-player-publish-open"${controlAttributes(view, 'keep-player-publish-open')}>${escapeHtml(tr(view, 'keepPublishOpen'))}</button></div></aside>`
    : '';
  return `
    <div class="v4-modal-backdrop v4-chain-flow-backdrop" data-action="close-player-publish-backdrop">
      <section id="makerPlayerPublishDialog" class="v4-chain-flow player" role="dialog" aria-modal="true" aria-labelledby="makerPlayerPublishTitle" aria-describedby="makerPlayerPublishCopy" aria-busy="false" tabindex="-1">
        <div class="v4-chain-flow-content"><header><div><span class="v4-eyebrow">${escapeHtml(tr(view, 'playerReleaseEyebrow'))}</span><h3 id="makerPlayerPublishTitle">${escapeHtml(tr(view, 'finishOcStep', { step: 1 }))}</h3><p id="makerPlayerPublishCopy">${escapeHtml(tr(view, 'publishDialogCopy'))}</p></div><button type="button" data-action="close-player-publish" aria-label="${escapeHtml(tr(view, 'close'))}"${controlAttributes(view, 'close-player-publish')}>×</button></header><ol><li class="current" aria-current="step"><span>1</span><strong>${escapeHtml(tr(view, 'prepareFiles'))}</strong><small>${escapeHtml(tr(view, 'publishStepCurrent'))}</small></li><li class="pending"><span>2</span><strong>${escapeHtml(tr(view, 'registerAndUpload'))}</strong><small>${escapeHtml(tr(view, 'publishStepPending'))}</small></li><li class="pending"><span>3</span><strong>${escapeHtml(tr(view, 'certifyWalrus'))}</strong><small>${escapeHtml(tr(view, 'publishStepPending'))}</small></li><li class="pending"><span>4</span><strong>${escapeHtml(tr(view, 'continueToSoulidity'))}</strong><small>${escapeHtml(tr(view, 'publishStepPending'))}</small></li></ol><div class="v4-chain-status" role="status" aria-live="polite"><span>${escapeHtml(reason)}</span></div>${errorPanel}<footer><button type="button" data-action="player-publish-resume"${controlAttributes(view, 'player-publish-resume', '', reason)}>${escapeHtml(tr(view, 'resumeUpload'))}</button><button type="button" data-action="player-publish-prepare"${controlAttributes(view, 'player-publish-prepare', '', reason)}>${escapeHtml(tr(view, 'prepareOcStep'))}</button><button class="primary" type="button" data-action="player-publish-register"${controlAttributes(view, 'player-publish-register', '', reason)}>${escapeHtml(tr(view, 'registerUploadStep'))}</button><button class="primary" type="button" data-action="player-publish-certify"${controlAttributes(view, 'player-publish-certify', '', reason)}>${escapeHtml(tr(view, 'certifyStep'))}</button><button class="primary" type="button" data-action="player-publish-onchain"${controlAttributes(view, 'player-publish-onchain', '', reason)}>${escapeHtml(tr(view, 'continueSoulidityStep'))}</button><button class="primary" type="button" data-action="player-publish-review"${controlAttributes(view, 'player-publish-review', '', reason)}>${escapeHtml(tr(view, 'reviewPendingRelease'))}</button></footer></div>${closeConfirmation}
      </section>
    </div>`;
}

export function renderApprovedMakerV8Player(view) {
  if (!plain(view) || view.schemaVersion !== MAKER_V8_APPROVED_PLAYER_VIEW_SCHEMA) {
    throw new TypeError('Expected one projected approved Fresh-v8 Player view.');
  }
  const part = view.parts.find((entry) => entry.key === view.selectedPartKey) || view.parts[0] || null;
  const selectedSummary = view.parts.flatMap((entry) => (
    selectedChoices(view, entry).map((choice) => (
      `<span>${escapeHtml(entry.label)}: ${escapeHtml(choice.label)}</span>`
    ))
  )).join('');
  const hasPalette = Boolean(selectedChoice(view, part)?.colorChannelKey);
  const completionIssue = view.completionIssues[0] || '';
  const version = view.player.makerVersion || view.document.lineage?.version || '';
  const creator = view.document.metadata.creator || view.player.creatorAddress || view.player.ownerAddress || tr(view, 'unknownCreator');
  const coverUrl = view.assets[view.document.metadata.coverAssetId]?.url || '';
  const currentCompleteQuote = view.completionConfirmation?.step?.action === 'completeOutput'
    ? view.completionConfirmation.step.record.completePaymentQuote : null;
  const picker = view.pickerPanel === 'colors'
    ? renderPalette(view, part)
    : renderPartPicker(view, part);
  const partButtons = view.parts.map((entry) => {
    const active = entry.key === part?.key && view.pickerPanel === 'parts';
    return `<button type="button" id="v4PlayerPartTab-${escapeHtml(entry.key)}" role="tab" class="v4-player-part ${active ? 'active' : ''}" data-action="player-part" data-part-id="${escapeHtml(entry.key)}" aria-selected="${active}" aria-controls="v4PlayerPickerPanel" tabindex="${active ? '0' : '-1'}"${controlAttributes(view, 'player-part', entry.key)}><span>${escapeHtml(entry.label)}</span></button>`;
  }).join('');
  const paletteActive = view.pickerPanel === 'colors';
  const pickerLabel = paletteActive ? 'v4PlayerPaletteTab' : `v4PlayerPartTab-${part?.key || ''}`;
  return `
    <section class="v4-player-shell">
      <header class="v4-player-header">
        <div class="v4-player-maker-heading">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="" />` : ''}<div><span class="v4-eyebrow">${escapeHtml(tr(view, 'characterMaker'))}</span><h1>${escapeHtml(view.document.metadata.name)}</h1><p>${escapeHtml(tr(view, 'byCreatorVersion', { creator, version }))}</p></div></div>
        <div class="v4-player-tools"><button type="button" data-action="player-info"${controlAttributes(view, 'player-info')}>ⓘ ${escapeHtml(tr(view, 'infoLicense'))}</button><button type="button" data-action="player-undo" aria-label="${escapeHtml(tr(view, 'undo'))}"${controlAttributes(view, 'player-undo', '', view.undoDepth ? '' : tr(view, 'undoUnavailable'))}>↶</button><button type="button" data-action="player-redo" aria-label="${escapeHtml(tr(view, 'redo'))}"${controlAttributes(view, 'player-redo', '', view.redoDepth ? '' : tr(view, 'redoUnavailable'))}>↷</button><button type="button" data-action="player-random" title="${escapeHtml(tr(view, 'random'))}"${controlAttributes(view, 'player-random')}>${escapeHtml(tr(view, 'random'))}</button><div class="v4-player-tool-control"><button type="button" data-action="player-clear" aria-describedby="v4PlayerClearOptionalReason" title="${escapeHtml(tr(view, 'removeOptional'))}"${controlAttributes(view, 'player-clear')}>${escapeHtml(tr(view, 'removeOptional'))}</button><small id="v4PlayerClearOptionalReason" class="v4-player-disabled-reason">${escapeHtml(resolveCapability(view, 'player-clear').enabled ? '' : capabilityReason(view, 'player-clear'))}</small></div><button type="button" data-action="player-reset" title="${escapeHtml(tr(view, 'reset'))}"${controlAttributes(view, 'player-reset')}>${escapeHtml(tr(view, 'reset'))}</button></div>
      </header>
      <div class="v4-player-main">
        <section class="v4-player-preview"><div class="v4-player-canvas-wrap ${view.document.canvas?.pixelMode === 'pixelated' ? 'pixelated' : ''}"><canvas id="makerV4PlayerCanvas" class="v4-runtime-canvas" aria-label="${escapeHtml(tr(view, 'yourOcPreview'))}"></canvas><div id="v4PlayerRenderStatus" class="v4-render-status" role="status" aria-live="polite" data-state="${escapeHtml(view.render.state)}">${escapeHtml(view.playerTest.message || view.render.message)}</div></div><div class="v4-player-nameplate"><div><strong data-player-profile-preview="name">${escapeHtml(view.profile.name || tr(view, 'untitledOc'))}</strong><span data-player-profile-preview="world">${escapeHtml(view.profile.world || view.document.metadata.style || tr(view, 'originalCharacter'))}</span></div><em>${escapeHtml(view.recipeValid ? tr(view, 'validCombination') : tr(view, 'ruleIssueCount', { count: 1 }))}</em></div><div class="v4-player-recipe-strip">${selectedSummary}</div></section>
        <section class="v4-player-controls">
          <div class="v4-player-part-rail" role="tablist" aria-label="${escapeHtml(tr(view, 'playerPickerNavigation'))}"><button type="button" id="v4PlayerPaletteTab" role="tab" class="v4-player-part v4-player-palette-tab ${hasPalette ? 'available' : 'unavailable'} ${paletteActive ? 'active' : ''}" data-action="player-palette" aria-selected="${paletteActive}" aria-disabled="${!hasPalette}" aria-controls="v4PlayerPickerPanel" tabindex="${paletteActive ? '0' : '-1'}" title="${escapeHtml(tr(view, hasPalette ? 'openPlayerPaletteForPart' : 'playerPaletteUnavailableTitle', { part: part?.label || tr(view, 'currentPart') }))}"${controlAttributes(view, 'player-palette', '', hasPalette ? '' : tr(view, 'playerPaletteUnavailableTitle', { part: part?.label || tr(view, 'currentPart') }))}><span class="v4-player-palette-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>${escapeHtml(tr(view, 'playerPalette'))}</strong></button>${partButtons}</div>
          <div id="v4PlayerPickerPanel" class="v4-player-picker ${paletteActive ? 'palette-active' : ''}" role="tabpanel" data-player-picker-context="${escapeHtml(paletteActive ? 'colors' : part?.key || '')}" aria-labelledby="${escapeHtml(pickerLabel)}">${picker}</div>
        </section>
      </div>
      <footer class="v4-player-finishbar">
        ${view.document.outputs.length > 1 ? `<section class="v4-player-commerce-summary" role="radiogroup" aria-label="${escapeHtml(tr(view, 'playerOutputSelection'))}"><span>${escapeHtml(tr(view, 'playerOutputSelection'))}</span>${view.document.outputs.map(output => `<button type="button" class="${view.recipe.outputKey === output.key ? 'primary' : ''}" data-action="player-output" data-output-key="${escapeHtml(output.key)}" role="radio" aria-checked="${view.recipe.outputKey === output.key}"${controlAttributes(view, 'player-output', output.key)}>${escapeHtml(output.label || output.key)}</button>`).join('')}</section>` : ''}
        <div class="v4-player-profile-fields"><div class="v4-player-profile-heading"><span>${escapeHtml(tr(view, 'soulConfig'))}</span><strong>${escapeHtml(tr(view, 'soulPersonalityIdentity'))}</strong><small>${escapeHtml(tr(view, 'soulPersonalityIdentityCopy'))}</small></div><label>${escapeHtml(tr(view, 'ocName'))}<input value="${escapeHtml(view.profile.name)}" data-action="player-profile-name" maxlength="128"${controlAttributes(view, 'player-profile-name')} /></label><label>${escapeHtml(tr(view, 'world'))}<input value="${escapeHtml(view.profile.world)}" data-action="player-profile-world" maxlength="128"${controlAttributes(view, 'player-profile-world')} /></label><label class="wide">${escapeHtml(tr(view, 'ocDescription'))}<textarea data-action="player-profile-description" maxlength="2000"${controlAttributes(view, 'player-profile-description')}>${escapeHtml(view.profile.description)}</textarea></label><label class="wide">${escapeHtml(tr(view, 'ocTags'))}<input value="${escapeHtml(view.profile.tags)}" data-action="player-profile-tags" maxlength="1000" placeholder="${escapeHtml(tr(view, 'ocTagsHint'))}"${controlAttributes(view, 'player-profile-tags')} /></label>${renderSoulConfiguration(view)}</div>
        ${renderRecovery(view)}
        <section class="v4-player-commerce-summary" aria-label="${escapeHtml(tr(view, 'playerCommerceQuoteTitle'))}"><div><span>${escapeHtml(tr(view, 'playerCommerceQuoteTitle'))}</span><strong>${escapeHtml(currentCompleteQuote ? `${currentCompleteQuote.totalAmountAtomic} ${tr(view, 'playerPackAtomicUnits')} · ${currentCompleteQuote.paymentCoinType}` : view.accessBoundaryReason ? tr(view, 'playerPurchaseUnavailable') : tr(view, 'playerCommerceNotQuoted'))}</strong><small>${escapeHtml(view.accessBoundaryReason || tr(view, 'playerCommerceNetworkSeparate'))}</small></div></section>
        <div><span class="v4-player-finish-status"><small id="v4PlayerSaveStatus" data-state="${escapeHtml(view.save.state)}">${escapeHtml(saveStatus(view))}</small><strong id="v4PlayerCompletionStatus" data-state="${completionIssue ? 'blocked' : 'ready'}">${escapeHtml(completionIssue || tr(view, 'playerOutputReady'))}</strong></span><button type="button" data-action="player-retry-save" ${view.save.state === 'error' ? '' : 'hidden'}${controlAttributes(view, 'player-retry-save')}>${escapeHtml(tr(view, 'retryPlayerSave'))}</button><button type="button" data-action="player-export"${controlAttributes(view, 'player-export')}>${escapeHtml(tr(view, 'recipeJson'))}</button><button type="button" data-action="player-preview-export"${controlAttributes(view, 'player-preview-export')}>${escapeHtml(tr(view, 'previewExport'))}</button><button class="primary" type="button" data-action="player-complete"${controlAttributes(view, 'player-complete', '', view.completeReady ? '' : completionIssue || view.boundaryReason)}>${escapeHtml(tr(view, 'completeOc'))}</button></div>
      </footer>
      ${renderPublishFlow(view)}
    </section>
    ${view.introOpen ? `<div class="v4-modal-backdrop player-info" data-action="close-player-info-backdrop"><section id="makerPlayerInfoDialog" class="v4-player-info-dialog" role="dialog" aria-modal="true" aria-labelledby="makerPlayerInfoTitle" aria-describedby="makerPlayerInfoSummary" tabindex="-1"><div class="v4-player-info-body">${coverUrl ? `<img class="v4-player-info-cover" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(tr(view, 'makerCoverAlt', { name: view.document.metadata.name }))}" />` : ''}<span class="v4-eyebrow">${escapeHtml(tr(view, 'beforeYouMake'))}</span><h2 id="makerPlayerInfoTitle">${escapeHtml(view.document.metadata.name)}</h2><p id="makerPlayerInfoSummary">${escapeHtml(view.document.metadata.summary || tr(view, 'combineCreatorParts'))}</p><dl><div><dt>${escapeHtml(tr(view, 'creator'))}</dt><dd>${escapeHtml(creator)}</dd></div><div><dt>${escapeHtml(tr(view, 'style'))}</dt><dd>${escapeHtml(view.document.metadata.style || tr(view, 'originalCharacter'))}</dd></div><div><dt>${escapeHtml(tr(view, 'license'))}</dt><dd>${escapeHtml(view.document.metadata.license?.kind || tr(view, 'unknown'))}</dd></div><div><dt>${escapeHtml(tr(view, 'version'))}</dt><dd>${escapeHtml(version)}</dd></div></dl><blockquote>${escapeHtml(view.document.metadata.license?.note || tr(view, 'followCreatorPolicy'))}</blockquote></div><footer class="v4-player-info-actions"><button type="button" class="primary" data-action="close-player-info"${controlAttributes(view, 'close-player-info')}>${escapeHtml(tr(view, 'startMaking'))}</button></footer></section></div>` : ''}
    ${renderExportModal(view)}`;
}
