import {
  MakerV8PlayerJourneyError,
  colorizeMakerV8ImageSourceV8,
  renderResolvedMakerV8RecipePngV8,
} from './maker-v8-render-core.js';
export {
  MakerV8PlayerJourneyError,
  mapMakerV8SmartColorPixelsV8,
  colorizeMakerV8ImageSourceV8,
} from './maker-v8-render-core.js';

import { sha256 } from '@noble/hashes/sha2.js';
import { exactMakerV8ExportOptions, makerV8ExportSizes } from './maker-v8-render-core.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_PLAYER_ACTIONS,
  MAKER_V8_PLAYER_LOADOUT_SCHEMA,
  MAKER_V8_PLAYER_RECIPE_SCHEMA,
  makerV8PlayerRecipeCommitmentV8,
} from './maker-v8-player-controller.js';
import { assertMakerV8Document } from './maker-v8-document.js';
import { evaluateMakerV8Visibility } from './maker-v8-visibility.js';
import { assertMakerV8NativeCompletionInputV8 } from './maker-v8-native-completion.js';
import { canonicalMakerV8Json } from './maker-v8-compiler.js';
import { makerV8PlayerRecipeLayout } from './maker-v8-player-slot-layout.js';
import { makerV8PlayerTrack, makerV8PlayerPart, makerV8PlayerColor, makerV8PlayerSelectorMatcher } from './maker-v8-player-definition-resolution.js';
import { makerV8PlayerColorFields, makerV8PlayerColorKey, makerV8PlayerColorMap, makerV8PlayerSwatchKey } from './maker-v8-player-colors.js';
import { assertMakerV8CertifiedAsset } from './maker-v8-manifest-adapter.js';
import {
  MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
  assertMakerV8ProtectedRenderV8,
} from './maker-v8-protected-transport.js';

export const MAKER_V8_PLAYER_JOURNEY_SCHEMA =
  'animacraft.maker-v8-player-journey.v1';

const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
import { assertMakerV8EnabledPackReleaseIds } from './maker-v8-player-pack-preferences.js';

const FINAL_SUCCESS = 'FINALIZED_SUCCESS';
const encoder = new TextEncoder();
const LOCAL_PLAYER_PROJECT_SCHEMA = 'animacraft.local-player-project.v8';
const RENDER_SCHEMA = 'animacraft.maker-v8-player-render.v1';
const RECIPE_FIELDS = Object.freeze([
  'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment',
  'selections', 'colors', 'outputKey',
]);
const SELECTION_FIELDS = Object.freeze([
  'source', 'partKey', 'itemKey', 'styleKey', 'trackKey', 'colorChannelKey',
  'defaultSwatchKey', 'releaseId', 'semanticPackId', 'externalProductId',
  'ownedExternalItemId',
]);
const LOADOUT_FIELDS = Object.freeze([
  'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment',
  'outputKey', 'selections', 'usedPacks', 'recipeCommitment',
]);
const LOADOUT_SELECTION_FIELDS = Object.freeze([
  'selectionIndex', ...SELECTION_FIELDS, 'swatchKey',
]);
const USED_PACK_FIELDS = Object.freeze(['releaseId', 'semanticPackId']);
const PROJECT_FIELDS = Object.freeze([
  'schemaVersion', 'profile', 'soul', 'recipe', 'loadout', 'render', 'imageExport', 'enabledPackReleaseIds',
]);
const PROJECT_RENDER_FIELDS = Object.freeze([
  'schemaVersion', 'mediaType', 'width', 'height', 'byteLength', 'sha256',
]);
const CONTEXTUAL_CHOICE_BUNDLE_FIELDS = Object.freeze([
  'schemaVersion', 'address', 'rootId', 'baseEntitlements', 'packStyles',
  'externalStyles', 'certifiedAssets', 'diagnostics',
]);

function fail(code, message, layer, details) {
  throw new MakerV8PlayerJourneyError(code, message, layer, details);
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

function requireMethod(value, name, label) {
  if (typeof value?.[name] !== 'function') {
    fail('MAKER_V8_PLAYER_JOURNEY_ADAPTER_INVALID', `${label}.${name} is required.`, 'CONFIGURATION');
  }
  return value[name].bind(value);
}

function compareProtocolText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function exactRecord(value, fields, label, code = 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID') {
  if (!plain(value)) fail(code, `${label} must be one exact record.`, 'PLAYER');
  const actual = Object.keys(value).sort(compareProtocolText);
  const expected = [...fields].sort(compareProtocolText);
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    fail(code, `${label} field set is invalid.`, 'PLAYER');
  }
  return value;
}

function sameCanonical(left, right) {
  return canonicalMakerV8Json(left) === canonicalMakerV8Json(right);
}

function assertRenderAssetDescriptor(asset, label) {
  try {
    return assertMakerV8CertifiedAsset(asset, label);
  } catch (cause) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_INVALID',
      `${label} is not one exact certified asset descriptor.`,
      'RENDER',
      {
        causeCode: typeof cause?.code === 'string' ? cause.code : null,
        cause: String(cause?.message ?? cause ?? 'unknown'),
      },
    );
  }
}

function exactRenderAssetPointers(playerAssets, contextualAssets) {
  if (!Array.isArray(playerAssets) || !Array.isArray(contextualAssets)) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_INVALID',
      'Player and live contextual certified assets must be exact arrays.',
      'RENDER',
    );
  }
  const pointers = new Map();
  for (const [source, assets] of [
    ['player.certifiedAssets', playerAssets],
    ['choices.certifiedAssets', contextualAssets],
  ]) {
    for (const [index, asset] of assets.entries()) {
      const checked = assertRenderAssetDescriptor(asset, `${source}[${index}]`);
      const current = pointers.get(checked.assetId);
      if (current && !sameCanonical(current, checked)) {
        fail(
          'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_COLLISION',
          'One certified asset ID has conflicting canonical evidence.',
          'RENDER',
          { assetId: checked.assetId },
        );
      }
      if (!current) pointers.set(checked.assetId, checked);
    }
  }
  return pointers;
}

function sameSelectionAuthority(left, right) {
  return SELECTION_FIELDS.every((field) => (
    Object.hasOwn(left ?? {}, field)
    && Object.hasOwn(right ?? {}, field)
    && left[field] === right[field]
  ));
}

function assertSelectionRecord(selection, label = 'Player selection') {
  exactRecord(selection, SELECTION_FIELDS, label);
  const baseIdsEmpty = selection.releaseId === null
    && selection.semanticPackId === null
    && selection.externalProductId === null
    && selection.ownedExternalItemId === null;
  if (selection.source === 'BASE' && baseIdsEmpty) return selection;
  if (selection.source === 'PACK'
    && EXACT_ID.test(selection.releaseId ?? '')
    && typeof selection.semanticPackId === 'string' && selection.semanticPackId.length > 0
    && selection.externalProductId === null && selection.ownedExternalItemId === null) return selection;
  if (selection.source === 'EXTERNAL'
    && selection.releaseId === null && selection.semanticPackId === null
    && EXACT_ID.test(selection.externalProductId ?? '')
    && EXACT_ID.test(selection.ownedExternalItemId ?? '')) return selection;
  fail(
    'MAKER_V8_PLAYER_JOURNEY_SELECTION_AUTHORITY_INVALID',
    `${label} has an invalid source authority binding.`,
    'RENDER',
  );
}

function baseSelectionAuthority(part, item, style) {
  return {
    source: 'BASE',
    partKey: part.key,
    itemKey: item.key,
    styleKey: style.key,
    trackKey: style.trackKey,
    colorChannelKey: style.colorChannelKey ?? null,
    defaultSwatchKey: style.defaultSwatchKey ?? null,
    releaseId: null,
    semanticPackId: null,
    externalProductId: null,
    ownedExternalItemId: null,
  };
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalRows(rows) {
  if (!Array.isArray(rows)) {
    fail('MAKER_V8_PLAYER_JOURNEY_SELECTIONS_INVALID', 'The current Player selections are required.');
  }
  return rows.map((row, index) => {
    assertSelectionRecord(row, `visible selections[${index}]`);
    return {
      source: row.source,
      partKey: row.partKey,
      itemKey: row.itemKey,
      styleKey: row.styleKey,
      trackKey: row.trackKey,
      colorChannelKey: row.colorChannelKey,
      defaultSwatchKey: row.defaultSwatchKey,
      releaseId: row.releaseId,
      semanticPackId: row.semanticPackId,
      externalProductId: row.externalProductId,
      ownedExternalItemId: row.ownedExternalItemId,
    };
  });
}

function sameSelections(left, right) {
  return JSON.stringify(canonicalRows(left)) === JSON.stringify(canonicalRows(right));
}

function styleFor(document, selection) {
  const part = document.parts.find((entry) => entry.key === selection.partKey);
  const item = part?.items.find((entry) => entry.key === selection.itemKey);
  const style = item?.styles.find((entry) => entry.key === selection.styleKey);
  if (!part || !item || !style) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_STYLE_INVALID',
      'The Player recipe references a missing certified Base Style.',
      'RENDER',
      { partKey: selection.partKey, itemKey: selection.itemKey, styleKey: selection.styleKey },
    );
  }
  return { part, item, style };
}

function exactContextualChoice(rows, selection, label) {
  const matches = rows.filter((row) => (
    plain(row) && sameSelectionAuthority(row, selection)
  ));
  if (matches.length !== 1 || typeof matches[0].assetId !== 'string' || !matches[0].assetId) {
    fail(
      `MAKER_V8_PLAYER_JOURNEY_${label}_STYLE_INVALID`,
      `The selected ${label} Style lacks one exact live authority and asset binding.`,
      'RENDER',
    );
  }
  if (matches[0].access?.accessible !== true || matches[0].access?.canEquip !== true) {
    fail('MAKER_V8_PLAYER_JOURNEY_COMPONENT_UNAVAILABLE',
      matches[0].access?.reason || 'The selected component lacks current access and equip permission.',
      'RENDER');
  }
  return matches[0];
}

function selectedColorMap(recipe, player) {
  try { return makerV8PlayerColorMap(player, recipe.colors ?? []); }
  catch { fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_RECIPE_INVALID', 'Recipe Smart Color selections are invalid.', 'RENDER'); }
}

function selectedSwatchFor(player, selectedColors, selection) {
  if (selection.colorChannelKey === null) return null;
  const channel = makerV8PlayerColor(player, selection)?.definition;
  const swatchKey = channel ? makerV8PlayerSwatchKey(player, selectedColors, selection) : null;
  const swatch = channel?.swatches?.find((entry) => entry.key === swatchKey);
  if (!swatch) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_RECIPE_INVALID',
      'Recipe Smart Color does not resolve to one certified channel swatch.',
      'RENDER',
      { channelKey: selection.colorChannelKey, swatchKey },
    );
  }
  return swatch;
}

/**
 * Render the exact active v8 Recipe into one PNG. This is product logic only;
 * it creates no UI and accepts no uncertified asset URL.
 */
export async function renderMakerV8PlayerRecipePngV8({
  player,
  recipe,
  signer,
  exportOptions = null,
  productRuntime,
  canvasFactory,
  decodeImage,
  colorizeImage = colorizeMakerV8ImageSourceV8,
  decryptProtectedSelection = null,
} = {}) {
  const exactSigner = typeof signer === 'string' && EXACT_ID.test(signer);
  if (!plain(player) || !plain(player.document) || !plain(recipe)
    || !EXACT_ID.test(player.rootId ?? '') || player.rootId !== recipe.rootId
    || !exactSigner) {
    fail('MAKER_V8_PLAYER_JOURNEY_RENDER_INPUT_INVALID', 'An exact active Player, Recipe, and signer are required for a live authority render.', 'RENDER');
  }
  const loadAsset = requireMethod(productRuntime?.assets, 'load', 'productRuntime.assets');
  const exportSettings = exportOptions === null ? null : exactMakerV8ExportOptions(player.document.canvas, exportOptions);
  // This public renderer never accepts a caller-asserted choice bundle. Every
  // render point-reads the signer/Root-bound authority immediately before it
  // resolves layers, so a stale or forged external bundle cannot skip Runtime.
  const contextInput = {
    address: signer,
    rootId: player.rootId,
  };
  const liveContext = typeof productRuntime?.playerContext?.load === 'function'
    ? await productRuntime.playerContext.load(contextInput) : null;
  const choices = liveContext ? liveContext.choices
    : await requireMethod(productRuntime?.choices, 'load', 'productRuntime.choices')(contextInput);
  const definitionPlayer = { ...player, contextualChoices: choices,
    definitionContext: liveContext?.definitions };
  const contextualRows = [
    choices?.baseEntitlements,
    choices?.packStyles,
    choices?.externalStyles,
    choices?.certifiedAssets,
    choices?.diagnostics,
  ];
  const choiceFields = plain(choices) ? Object.keys(choices).sort(compareProtocolText) : [];
  const expectedChoiceFields = [...CONTEXTUAL_CHOICE_BUNDLE_FIELDS].sort(compareProtocolText);
  if (!plain(choices)
    || choiceFields.length !== expectedChoiceFields.length
    || choiceFields.some((field, index) => field !== expectedChoiceFields[index])
    || choices.schemaVersion !== 'animacraft.maker-v8-contextual-choices.v1'
    || choices.rootId !== player.rootId
    || !contextualRows.every(Array.isArray)
    || choices.diagnostics.length !== 0
    || choices.address !== signer) {
    fail('MAKER_V8_PLAYER_JOURNEY_CONTEXT_DRIFT', 'Render choices differ from the exact Player Root or signer.', 'RENDER');
  }
  const packChoices = Array.isArray(choices?.packStyles) ? choices.packStyles : [];
  const externalChoices = Array.isArray(choices?.externalStyles) ? choices.externalStyles : [];
  const pointers = exactRenderAssetPointers(
    player.certifiedAssets,
    choices.certifiedAssets,
  );
  const trackOrder = new Map(player.document.tracks.map((track) => [track.key, track.renderOrder]));
  const selectedColors = selectedColorMap(recipe, definitionPlayer);
  const selectedSwatch = (selection) => selectedSwatchFor(
    definitionPlayer,
    selectedColors,
    selection,
  );
  const layers = [];
  for (const [selectionIndex, selection] of recipe.selections.entries()) {
    assertSelectionRecord(selection, `recipe.selections[${selectionIndex}]`);
    if (selection.source === 'EXTERNAL') {
      let exact;
      try {
        exact = exactContextualChoice(externalChoices, selection, 'EXTERNAL');
      } catch (cause) {
        if (cause?.code !== 'MAKER_V8_PLAYER_JOURNEY_EXTERNAL_STYLE_INVALID') throw cause;
        fail(
          'MAKER_V8_EXTERNAL_ASSET_RENDER_METADATA_UNAVAILABLE',
          'This admitted external Item cannot be rendered because its live authority or certified media metadata differs.',
          'CONTRACT',
          { externalProductId: selection.externalProductId },
        );
      }
      layers.push({
        selectionIndex,
        selection,
        asset: pointers.get(exact.assetId),
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
        displayOrder: 0,
        trackOrder: trackOrder.get(selection.trackKey),
        swatch: selectedSwatch(selection),
        protected: false,
      });
      continue;
    }
    if (selection.source === 'PACK') {
      const exact = exactContextualChoice(packChoices, selection, 'PACK');
      const authored = exact.render;
      // Definition identity is independent of the selected artwork's Release.
      // Parts and Tracks resolve from the current certified Release context.
      // Colors resolve in the same exact Release context as Parts and Tracks.
      const scope = exact.definitionScope;
      if (authored || scope !== undefined) {
        const expected = {
          part: scope?.part,
          track: scope?.track,
          color: selection.colorChannelKey === null ? null : scope?.color,
        };
        if (!plain(scope) || !plain(scope.part) || !plain(scope.track) || !sameCanonical(scope, expected)
          || !makerV8PlayerPart(definitionPlayer, selection) || !makerV8PlayerTrack(definitionPlayer, selection)
          || (selection.colorChannelKey !== null && !makerV8PlayerColor(definitionPlayer, selection))) {
          fail('MAKER_V8_PLAYER_JOURNEY_PACK_DEFINITION_SCOPE_INVALID',
            'Pack rendering requires exact supported Part, Track and Color definition identities.', 'RENDER');
        }
      }
      if (authored && exact.protected && !authored.sourceAsset) {
        fail('MAKER_V8_PLAYER_PROTECTED_SOURCE_INVALID', 'Authored Pack requires its certified original artwork identity.', 'PROTECTION');
      }
      if (authored && !evaluateMakerV8Visibility(authored.visibleWhen, recipe.selections,
        makerV8PlayerSelectorMatcher(definitionPlayer, selection.releaseId))) continue;
      layers.push({
        selectionIndex,
        selection,
        asset: pointers.get(exact.assetId),
        transform: authored ? authored.transform : { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: authored ? authored.opacity : 1,
        blendMode: authored ? authored.blendMode : 'normal',
        displayOrder: authored ? authored.displayOrder : 0,
        sourceAsset: authored?.sourceAsset ?? null,
        trackOrder: makerV8PlayerTrack(definitionPlayer, selection)?.renderOrder,
        swatch: selectedSwatch(selection),
        protected: exact.protected === true,
      });
      continue;
    }
    if (selection.source !== 'BASE') {
      fail(
        'MAKER_V8_PLAYER_JOURNEY_SELECTION_AUTHORITY_INVALID',
        'The Recipe contains an unknown selection source.',
        'RENDER',
      );
    }
    const resolved = styleFor(player.document, selection);
    if (!sameSelectionAuthority(selection, baseSelectionAuthority(
      resolved.part,
      resolved.item,
      resolved.style,
    ))) {
      fail(
        'MAKER_V8_PLAYER_JOURNEY_BASE_STYLE_INVALID',
        'The selected Base Style differs from its exact Track, Color, default, or source authority.',
        'RENDER',
      );
    }
    if (!evaluateMakerV8Visibility(resolved.style.visibleWhen, recipe.selections,
      makerV8PlayerSelectorMatcher(definitionPlayer))) continue;
    layers.push({
      selectionIndex,
      selection,
      asset: pointers.get(resolved.style.assetId),
      transform: resolved.style.transform,
      opacity: resolved.style.opacity,
      blendMode: resolved.style.blendMode,
      displayOrder: resolved.style.displayOrder,
      trackOrder: trackOrder.get(resolved.style.trackKey),
      swatch: selectedSwatch(selection),
      protected: resolved.style.protected === true,
      sourceAsset: resolved.style.payload?.animacraftSourceAsset ?? null,
    });
  }
  if (layers.some((layer) => !layer.asset || !Number.isSafeInteger(layer.trackOrder))) {
    fail('MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_INVALID', 'The Recipe lacks exact certified render assets or Tracks.', 'RENDER');
  }
  return renderResolvedMakerV8RecipePngV8({
    document: player.document,
    layers: exportSettings?.transparent
      ? layers.filter(layer => !makerV8PlayerPart(definitionPlayer, layer.selection)?.definition.exportBackground)
      : layers,
    exportSizeMode: exportSettings?.sizeMode ?? null,
    loadAsset,
    canvasFactory,
    decodeImage,
    colorizeImage,
    decryptProtectedSelection,
  });
}

/** Render one local Creator draft through the exact same core as Player. */
export async function renderMakerV8DraftRecipePngV8({
  document,
  assets,
  recipe = document?.defaultRecipe,
  exportOptions = null,
  canvasFactory,
  decodeImage,
  colorizeImage = colorizeMakerV8ImageSourceV8,
} = {}) {
  try {
    assertMakerV8Document(document, { mode: 'draft' });
  } catch (cause) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_DRAFT_INVALID',
      'Creator preview requires one exact Maker v8 draft document.',
      'RENDER',
      { cause: String(cause?.message || cause) },
    );
  }
  if (!plain(recipe) || !Array.isArray(recipe.selections) || !Array.isArray(recipe.colors)
    || !Array.isArray(assets)) {
    fail('MAKER_V8_PLAYER_JOURNEY_DRAFT_INVALID', 'Creator preview requires one exact local Recipe and asset set.', 'RENDER');
  }
  const descriptors = new Map(document.assets.map((asset) => [asset.id, asset]));
  const exportSettings = exportOptions === null ? null : exactMakerV8ExportOptions(document.canvas, exportOptions);
  const localAssets = new Map();
  for (const asset of assets) {
    if (!plain(asset) || typeof asset.assetId !== 'string' || localAssets.has(asset.assetId)) {
      fail('MAKER_V8_PLAYER_JOURNEY_DRAFT_ASSET_DRIFT', 'Creator preview assets are invalid or duplicated.', 'RENDER');
    }
    const descriptor = descriptors.get(asset.assetId);
    if (!descriptor || descriptor.kind !== asset.kind || descriptor.mediaType !== asset.mediaType
      || descriptor.byteLength !== asset.byteLength) {
      fail('MAKER_V8_PLAYER_JOURNEY_DRAFT_ASSET_DRIFT', 'Creator preview asset metadata differs from the draft document.', 'RENDER');
    }
    localAssets.set(asset.assetId, asset);
  }
  if (localAssets.size !== descriptors.size
    || [...descriptors.keys()].some((assetId) => !localAssets.has(assetId))) {
    fail('MAKER_V8_PLAYER_JOURNEY_DRAFT_ASSET_DRIFT', 'Creator preview requires exact bytes for every draft asset.', 'RENDER');
  }
  const selectedColors = selectedColorMap(recipe, { document });
  const trackOrder = new Map(document.tracks.map((track) => [track.key, track.renderOrder]));
  const layers = recipe.selections.map((selection, selectionIndex) => {
    const resolved = styleFor(document, selection);
    // Pending artwork or an explicitly unassigned Track has no visible layer.
    // Declared assets must still pass durable-byte validation above.
    if (resolved.style.assetId === null || resolved.style.trackKey === null) return null;
    if (!evaluateMakerV8Visibility(resolved.style.visibleWhen, recipe.selections)) return null;
    return {
      selectionIndex,
      selection: {
        source: 'BASE',
        partKey: resolved.part.key,
        itemKey: resolved.item.key,
        styleKey: resolved.style.key,
      },
      asset: localAssets.get(resolved.style.assetId),
      transform: resolved.style.transform,
      opacity: resolved.style.opacity,
      blendMode: resolved.style.blendMode,
      displayOrder: resolved.style.displayOrder,
      trackOrder: trackOrder.get(resolved.style.trackKey),
      swatch: selectedSwatchFor({ document }, selectedColors, {
        colorChannelKey: resolved.style.colorChannelKey,
        defaultSwatchKey: resolved.style.defaultSwatchKey,
      }),
      // Draft assets are the creator's local plaintext source. Protection is
      // enforced when certified ciphertext is consumed in Player.
      protected: false,
    };
  }).filter(layer => layer !== null);
  if (layers.some((layer) => !layer.asset || !Number.isSafeInteger(layer.trackOrder))) {
    fail('MAKER_V8_PLAYER_JOURNEY_DRAFT_ASSET_DRIFT', 'Creator preview Recipe lacks exact local assets or Tracks.', 'RENDER');
  }
  return renderResolvedMakerV8RecipePngV8({
    document,
    // Resolve conditions/identity against the complete recipe before hiding
    // explicitly authored background Parts for this download only.
    layers: exportSettings?.transparent
      ? layers.filter(layer => !document.parts.find(part => part.key === layer.selection.partKey)?.exportBackground)
      : layers,
    loadAsset: async (asset) => asset,
    exportSizeMode: exportSettings?.sizeMode ?? null,
    canvasFactory,
    decodeImage,
    colorizeImage,
  });
}

function assertExactRecipe(recipe, label) {
  exactRecord(recipe, RECIPE_FIELDS, label);
  if (recipe.schemaVersion !== MAKER_V8_PLAYER_RECIPE_SCHEMA
    || !EXACT_ID.test(recipe.rootId ?? '')
    || !/^[1-9][0-9]*$/.test(String(recipe.makerVersion ?? ''))
    || !HASH.test(recipe.rootContentCommitment ?? '')
    || !Array.isArray(recipe.selections) || !Array.isArray(recipe.colors)
    || typeof recipe.outputKey !== 'string' || !recipe.outputKey) {
    fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', `${label} identity is invalid.`, 'PLAYER');
  }
  recipe.selections.forEach((selection, index) => (
    assertSelectionRecord(selection, `${label}.selections[${index}]`)
  ));
  recipe.colors.forEach((color, index) => {
    exactRecord(color, makerV8PlayerColorFields(color), `${label}.colors[${index}]`);
    if (typeof color.channelKey !== 'string' || !color.channelKey
      || typeof color.swatchKey !== 'string' || !color.swatchKey) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', `${label} Color is invalid.`, 'PLAYER');
    }
  });
  return recipe;
}

function assertExactLoadout(loadout, label) {
  exactRecord(loadout, LOADOUT_FIELDS, label);
  if (loadout.schemaVersion !== MAKER_V8_PLAYER_LOADOUT_SCHEMA
    || !Array.isArray(loadout.selections) || !Array.isArray(loadout.usedPacks)
    || !HASH.test(loadout.recipeCommitment ?? '')) {
    fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', `${label} identity is invalid.`, 'PLAYER');
  }
  loadout.selections.forEach((selection, index) => {
    exactRecord(selection, LOADOUT_SELECTION_FIELDS, `${label}.selections[${index}]`);
    assertSelectionRecord(
      Object.fromEntries(SELECTION_FIELDS.map((field) => [field, selection[field]])),
      `${label}.selections[${index}]`,
    );
    if (!Number.isSafeInteger(selection.selectionIndex) || selection.selectionIndex < 0
      || !(selection.swatchKey === null || typeof selection.swatchKey === 'string')) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', `${label} selection is invalid.`, 'PLAYER');
    }
  });
  loadout.usedPacks.forEach((pack, index) => {
    exactRecord(pack, USED_PACK_FIELDS, `${label}.usedPacks[${index}]`);
  });
  return loadout;
}

function deriveCanonicalLoadout(player, recipe) {
  const document = player?.document;
  if (!plain(document) || !Array.isArray(document.parts)
    || !Array.isArray(document.tracks) || !Array.isArray(document.outputs)) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID',
      'Completion requires the exact certified Maker document.',
      'PLAYER',
    );
  }
  const tracks = new Set();
  for (const track of document.tracks) {
    if (typeof track?.key !== 'string' || !track.key || tracks.has(track.key)) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Certified Track authority is invalid.', 'PLAYER');
    }
    tracks.add(track.key);
  }
  const parts = new Map();
  const orderedParts = [...document.parts].sort((left, right) => (
    left.menuOrder - right.menuOrder || compareProtocolText(left.key, right.key)
  ));
  const layout = makerV8PlayerRecipeLayout(player, recipe.selections);
  for (const part of orderedParts) {
    if (typeof part?.key !== 'string' || !part.key || parts.has(part.key)
      || !Number.isSafeInteger(part.menuOrder)
      || !Number.isSafeInteger(part.capacity) || part.capacity < 1) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Certified Part slot authority is invalid.', 'PLAYER');
    }
    parts.set(part.key, part);
  }
  const colors = new Map();
  for (const channel of document.colors ?? []) {
    if (typeof channel?.key !== 'string' || !channel.key || colors.has(channel.key)
      || !Array.isArray(channel.swatches)) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Certified Color authority is invalid.', 'PLAYER');
    }
    colors.set(channel.key, channel);
  }
  let selectedColors;
  try { selectedColors = makerV8PlayerColorMap(player, recipe.colors); }
  catch { fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Recipe Color authority is invalid.', 'PLAYER'); }
  let priorChannelKey = null;
  for (const color of recipe.colors) {
    const key = makerV8PlayerColorKey(color);
    if (priorChannelKey !== null && compareProtocolText(priorChannelKey, key) >= 0) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Recipe Color authority is invalid.', 'PLAYER');
    }
    priorChannelKey = key;
  }
  if (document.outputs.filter((output) => output?.key === recipe.outputKey).length !== 1) {
    fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Recipe Output authority is invalid.', 'PLAYER');
  }

  const partOffsets = new Map();
  const packBindings = new Map();
  let priorPartOrder = -1;
  const selections = recipe.selections.map((selection, selectionIndex) => {
    const part = makerV8PlayerPart(player, selection)?.definition;
    const scopedKey = layout.scopeKey(selection);
    const currentPartOrder = layout.slot(selection).start;
    const offset = partOffsets.get(scopedKey) ?? 0;
    if (!part || !Number.isSafeInteger(currentPartOrder) || currentPartOrder < priorPartOrder
      || offset >= part.capacity || !makerV8PlayerTrack(player, selection)) {
      fail(
        'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID',
        'Recipe Part, slot order, capacity, or Track authority is invalid.',
        'PLAYER',
      );
    }
    priorPartOrder = currentPartOrder;
    partOffsets.set(scopedKey, offset + 1);
    if ((selection.colorChannelKey === null) !== (selection.defaultSwatchKey === null)) {
      fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Recipe selection Color authority is invalid.', 'PLAYER');
    }
    if (selection.colorChannelKey !== null) {
      const channel = makerV8PlayerColor(player, selection)?.definition;
      if (!channel?.swatches.some((swatch) => swatch.key === selection.defaultSwatchKey)) {
        fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Recipe selection default Color is invalid.', 'PLAYER');
      }
    }
    if (selection.source === 'BASE') {
      const item = part.items?.find((candidate) => (
        candidate.key === selection.itemKey && candidate.status === 'PUBLIC'
      ));
      const style = item?.styles?.find((candidate) => candidate.key === selection.styleKey);
      if (!style || !sameSelectionAuthority(
        selection,
        baseSelectionAuthority(part, item, style),
      )) {
        fail(
          'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID',
          'Recipe Base Track, Color, default, or source authority is invalid.',
          'PLAYER',
        );
      }
    }
    if (selection.source === 'PACK') {
      const priorSemanticPackId = packBindings.get(selection.releaseId);
      if (priorSemanticPackId && priorSemanticPackId !== selection.semanticPackId) {
        fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'Recipe Pack authority is inconsistent.', 'PLAYER');
      }
      packBindings.set(selection.releaseId, selection.semanticPackId);
    }
    return {
      selectionIndex: currentPartOrder + offset,
      ...structuredClone(selection),
      swatchKey: makerV8PlayerSwatchKey(player, selectedColors, selection),
    };
  });
  const usedPacks = [...packBindings.entries()].map(([releaseId, semanticPackId]) => ({
    releaseId,
    semanticPackId,
  })).sort((left, right) => (
    compareProtocolText(left.semanticPackId, right.semanticPackId)
    || compareProtocolText(left.releaseId, right.releaseId)
  ));
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_LOADOUT_SCHEMA,
    rootId: recipe.rootId,
    makerVersion: recipe.makerVersion,
    rootContentCommitment: recipe.rootContentCommitment,
    outputKey: recipe.outputKey,
    selections,
    usedPacks,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
  });
}

function assertCompleteVisibleIntent({ selections, project, snapshot }) {
  exactRecord(project, PROJECT_FIELDS, 'project');
  if (project.schemaVersion !== LOCAL_PLAYER_PROJECT_SCHEMA
    || !plain(project.profile) || !plain(project.soul) || !plain(project.render)) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID',
      'Completion requires the exact visible local Player project.',
      'PLAYER',
    );
  }
  const recipe = assertExactRecipe(snapshot?.recipe, 'controller Recipe');
  const loadout = assertExactLoadout(snapshot?.loadout, 'controller Loadout');
  assertExactRecipe(project.recipe, 'project Recipe');
  assertMakerV8EnabledPackReleaseIds(project.enabledPackReleaseIds, project.recipe);
  assertExactLoadout(project.loadout, 'project Loadout');
  canonicalRows(selections);
  const canonicalLoadout = deriveCanonicalLoadout(snapshot.player, recipe);
  if (!sameSelections(selections, recipe.selections)
    || !sameCanonical(project.recipe, recipe)
    || !sameCanonical(loadout, canonicalLoadout)
    || !sameCanonical(project.loadout, canonicalLoadout)) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
      'The visible Recipe or Loadout differs from the exact controller intent.',
      'PLAYER',
    );
  }
  const recipeCommitment = makerV8PlayerRecipeCommitmentV8(recipe);
  if (snapshot.player?.rootId !== recipe.rootId
    || String(snapshot.player?.makerVersion ?? '') !== String(recipe.makerVersion)
    || snapshot.player?.evidence?.contentCommitment !== recipe.rootContentCommitment
    || loadout.rootId !== recipe.rootId
    || String(loadout.makerVersion) !== String(recipe.makerVersion)
    || loadout.rootContentCommitment !== recipe.rootContentCommitment
    || loadout.outputKey !== recipe.outputKey
    || loadout.selections.length !== recipe.selections.length
    || loadout.selections.some((selection, index) => (
      !sameSelectionAuthority(selection, recipe.selections[index])
    ))
    || loadout.recipeCommitment !== recipeCommitment
    || project.loadout.recipeCommitment !== recipeCommitment) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
      'The visible Loadout does not close over the exact Recipe commitment.',
      'PLAYER',
    );
  }
  exactRecord(project.render, PROJECT_RENDER_FIELDS, 'project.render');
  const exportOptions = exactMakerV8ExportOptions(snapshot.player.document.canvas, project.imageExport);
  if (!sameCanonical(exportOptions, project.imageExport)) {
    fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID', 'The final image export settings must be exact.', 'PLAYER');
  }
  const dimensions = makerV8ExportSizes(snapshot.player.document.canvas)[exportOptions.sizeMode];
  if (project.render.schemaVersion !== RENDER_SCHEMA
    || project.render.mediaType !== 'image/png'
    || project.render.width !== dimensions.width
    || project.render.height !== dimensions.height
    || !Number.isSafeInteger(project.render.byteLength) || project.render.byteLength < 1
    || project.render.byteLength > 12 * 1024 * 1024
    || !HASH.test(project.render.sha256 ?? '')) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID',
      'The visible project render evidence is invalid.',
      'PLAYER',
    );
  }
  return freeze({
    recipe: structuredClone(recipe),
    loadout: structuredClone(canonicalLoadout),
    render: structuredClone(project.render),
    exportOptions,
  });
}

function assertVisibleRenderEvidence(expected, actual) {
  if (!plain(actual)
    || actual.schemaVersion !== expected.schemaVersion
    || actual.mediaType !== expected.mediaType
    || actual.width !== expected.width
    || actual.height !== expected.height
    || actual.byteLength !== expected.byteLength
    || actual.sha256 !== expected.sha256
    || typeof actual.bytesBase64 !== 'string') {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_RENDER_INTENT_DRIFT',
      'The exact render differs from the visible project evidence.',
      'RENDER',
    );
  }
  return actual;
}

function soulFrom(action) {
  const objects = action?.certificate?.evidence?.objects;
  if (!Array.isArray(objects)) return null;
  const event = action?.certificate?.evidence?.certifiedEvent;
  if (!event?.type?.endsWith('::output_v8::NativeSoulBoundV8')
    || !EXACT_ID.test(event.fields?.soul_id ?? '')) return null;
  const row = objects.find((entry) => typeof entry?.type === 'string'
    && entry.type.endsWith('::soul::Soul') && entry.objectId === event.fields.soul_id);
  return row ? row.objectId : null;
}

function handoffUrl({ rootId, signer, action }) {
  const url = new URL('https://www.soulidity.ai/my-souls');
  url.searchParams.set('source', 'animacraft-v8');
  url.searchParams.set('root', rootId);
  url.searchParams.set('owner', signer);
  url.searchParams.set('digest', action.transactionDigest);
  const soulId = soulFrom(action);
  if (soulId) url.searchParams.set('soul', soulId);
  return url.toString();
}

async function protectRender({ protectedTransport, player, recipe, signer, renderResult, publisher }) {
  if (typeof protectedTransport?.protect !== 'function') {
    fail(
      'MAKER_V8_PLAYER_PROTECTED_TRANSPORT_REQUIRED',
      'Protected Output requires the server-only Seal transport; no browser credential fallback is permitted.',
      'BLOCKED_EXTERNAL_SECRET',
    );
  }
  if (typeof player.resolveProtectedOutputIdentity !== 'function') {
    fail(
      'MAKER_V8_PLAYER_PROTECTED_IDENTITY_REQUIRED',
      'Protected Output requires the exact live pre-encryption Seal identity.',
      'CONFIGURATION',
    );
  }
  const identity = await player.resolveProtectedOutputIdentity();
  if (identity?.signer !== signer || identity?.outputKey !== recipe.outputKey) {
    fail(
      'MAKER_V8_PLAYER_PROTECTED_IDENTITY_DRIFT',
      'Protected Output identity differs from the active Player recipe or signer.',
      'PROTECTION',
    );
  }
  const request = freeze({
    schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
    identity,
    render: freeze({
      mediaType: renderResult.mediaType,
      bytesBase64: renderResult.bytesBase64,
      byteLength: renderResult.byteLength,
      sha256: renderResult.sha256,
    }),
  });
  for (const method of ['loadPublicationBinding', 'savePublicationBinding']) requireMethod(publisher, method, 'walrus.publisher');
  const schemaVersion = 'animacraft.maker-v8-protected-completion-render.v1';
  const source = { identity: structuredClone(identity), mediaType: renderResult.mediaType,
    byteLength: renderResult.byteLength, sha256: renderResult.sha256 };
  const key = `protected-render:${hex(sha256(encoder.encode(canonicalMakerV8Json(source))))}`;
  let cached = await publisher.loadPublicationBinding(key);
  if (!cached) {
    const ciphertext = await protectedTransport.protect(request);
    // Verify before persisting, retaining only ciphertext and public identity.
    assertMakerV8ProtectedRenderV8(ciphertext, identity);
    try { cached = await publisher.savePublicationBinding(key, null, { schemaVersion, source, ciphertext }); }
    catch (error) {
      if (error?.code !== 'MAKER_V8_WALRUS_CAS_MISMATCH') throw error;
      cached = await publisher.loadPublicationBinding(key);
    }
  }
  if (cached?.schemaVersion !== schemaVersion || cached.key !== key || !sameCanonical(cached.source, source)) {
    fail('MAKER_V8_PLAYER_PROTECTED_TRANSPORT_INVALID', 'Saved protected render belongs to another exact intent.', 'PROTECTION');
  }
  const value = cached.ciphertext;
  try {
    const checked = assertMakerV8ProtectedRenderV8(value, identity);
    if (checked.sha256 === renderResult.sha256) {
      fail('MAKER_V8_PLAYER_PROTECTED_TRANSPORT_INVALID', 'Protected ciphertext equals the plaintext render.', 'PROTECTION');
    }
    return freeze({
      mediaType: checked.mediaType,
      bytesBase64: checked.bytesBase64,
      byteLength: checked.byteLength,
      sha256: checked.sha256,
    });
  } catch (cause) {
    if (cause instanceof MakerV8PlayerJourneyError) throw cause;
    fail(
      'MAKER_V8_PLAYER_PROTECTED_TRANSPORT_INVALID',
      'Server-only Seal transport returned invalid ciphertext or identity evidence.',
      'PROTECTION',
      { causeCode: cause?.code ?? null },
    );
  }
}

/** One recoverable orchestration behind the approved Continue to Soulidity control. */
export function createMakerV8PlayerJourneyV8({
  player,
  productRuntime,
  walrus,
  render = renderMakerV8PlayerRecipePngV8,
  protectedTransport = null,
  nativeContent = null,
  waitForBatchFinality = milliseconds => new Promise(resolve => globalThis.setTimeout(resolve, milliseconds)),
} = {}) {
  for (const name of [
    'getSnapshot', 'loadPlayer', 'setRecipe', 'preparePlayerAction',
    'executePlayerAction', 'recoverPlayerAction', 'reuseCommittedPlayerLoadout',
  ]) requireMethod(player, name, 'player');
  const loadInventory = requireMethod(productRuntime?.inventory, 'load', 'productRuntime.inventory');
  const publisher = walrus?.publisher;
  const persistence = walrus?.persistence;
  for (const name of ['prepare', 'requestSignature', 'resume', 'load']) {
    requireMethod(publisher, name, 'walrus.publisher');
  }
  requireMethod(persistence, 'load', 'walrus.persistence');
  if (typeof render !== 'function') {
    fail('MAKER_V8_PLAYER_JOURNEY_RENDERER_INVALID', 'The exact Player renderer is required.', 'CONFIGURATION');
  }

  const reload = async (rootId, recipe) => {
    const loaded = await player.loadPlayer(rootId);
    if (loaded?.status !== 'READY' || loaded.player?.rootId !== rootId) {
      fail('MAKER_V8_PLAYER_JOURNEY_PLAYER_UNAVAILABLE', 'The exact active Maker could not be reloaded.', 'PLAYER');
    }
    await player.setRecipe(recipe);
    return player.getSnapshot();
  };

  const settleAction = async (action, input, assertBeforeExecute, persistPrepared, confirmPrepared) => {
    let current = await player.preparePlayerAction({ action, input });
    if (persistPrepared) await persistPrepared(current);
    if (current.status === 'PREPARED') {
      if (assertBeforeExecute) await assertBeforeExecute();
      await confirmPrepared(action, current);
      if (assertBeforeExecute) await assertBeforeExecute();
      current = await player.executePlayerAction(current.actionId);
    }
    if (current.status === FINAL_SUCCESS) return current;
    if (current.status === 'FINALIZED_FAILURE' || current.status === 'EXPIRED_NOT_FOUND') {
      fail('MAKER_V8_PLAYER_JOURNEY_ACTION_FAILED', `The ${action} transaction did not succeed.`, 'FINALITY', { action: current });
    }
    return freeze({ pending: true, action: current });
  };

  const prepareRenderUpload = async ({ signer, renderResult, rootId }) => {
    const uploadId = `render-${hex(sha256(encoder.encode(`${rootId}\u0000${signer}\u0000${renderResult.sha256}`)))}`;
    let view = await publisher.load(uploadId);
    if (view === null) {
      await publisher.prepare({
        uploadId,
        owner: signer,
        mediaType: renderResult.mediaType,
        bytesBase64: renderResult.bytesBase64,
      });
      view = await publisher.load(uploadId);
    }
    if (view.byteSha256 !== renderResult.sha256 || view.byteLength !== renderResult.byteLength) {
      fail('MAKER_V8_PLAYER_JOURNEY_UPLOAD_DRIFT', 'Durable render transport differs from the exact PNG.', 'WALRUS');
    }
    return { uploadId, view };
  };

  const settleUpload = async ({ signer, renderResult, rootId, assertBeforeSignature = null }) => {
    const prepared = await prepareRenderUpload({ signer, renderResult, rootId });
    const { uploadId } = prepared;
    let view = prepared.view;
    for (let step = 0; step < 8 && view.status !== 'COMPLETE'; step++) {
      const previous = view;
      if (view.status === 'SIGNATURE_REQUIRED') {
        await assertBeforeSignature(freeze({
          kind: 'STORAGE_UPLOAD', purpose: 'RENDER', uploadId,
          blobId: view.blobId, byteLength: view.byteLength, byteSha256: view.byteSha256,
        }));
        await publisher.requestSignature(uploadId);
        view = await publisher.load(uploadId);
      } else if (['RECOVERY_REQUIRED', 'REGISTER_FINALIZED'].includes(view.status)) {
        view = await publisher.resume(uploadId);
      } else break;
      if (view.status === previous.status && view.revision === previous.revision) break;
    }
    if (view.status !== 'COMPLETE') return freeze({ pending: true, upload: view });
    const durable = await persistence.load(uploadId);
    const rootHash = fromBase64(durable?.encoded?.rootHash ?? '');
    const blobCommitment = hex(rootHash);
    if (rootHash.length !== 32 || !HASH.test(blobCommitment)
      || durable.encoded.blobId !== view.blobId
      || durable.byteSha256 !== renderResult.sha256) {
      fail('MAKER_V8_PLAYER_JOURNEY_UPLOAD_DRIFT', 'Certified Walrus render proof is inconsistent.', 'WALRUS');
    }
    return freeze({
      pending: false,
      render: freeze({
        blobId: view.blobId,
        sha256: renderResult.sha256,
        blobCommitment,
        byteLength: renderResult.byteLength,
      }),
    });
  };

  const settleStorageBatch = async ({ rootId, signer, renderResult, project, assertCurrent, requestConfirmation }) => {
    const { uploadId } = await prepareRenderUpload({ rootId, signer, renderResult });
    await assertCurrent();
    const native = await nativeContent.prepare({ rootId, signer, project, deferStorage: true });
    await assertCurrent();
    if (native?.status !== 'STORAGE_PREPARED' || !Array.isArray(native.uploads) || native.uploads.length !== 3
      || native.uploads.some(input => input.owner !== signer || !input.uploadId)
      || new Set([uploadId, ...native.uploads.map(input => input.uploadId)]).size !== 4) {
      fail('MAKER_V8_PLAYER_NATIVE_CONTENT_INVALID', 'Prepare all three exact native files before any storage payment.', 'WALRUS');
    }
    for (const method of ['prepareBatch', 'loadBatch', 'prepareBatchReview', 'signBatchReviewed', 'resumeBatch']) {
      requireMethod(publisher, method, 'walrus.publisher');
    }
    const batch = await publisher.prepareBatch({ rootId, owner: signer,
      uploadIds: [uploadId, ...native.uploads.map(input => input.uploadId)] });
    if (batch.status === 'LEGACY') return null; // Preserve pre-existing signed/paid individual WALs.
    let view = await publisher.loadBatch(batch.key);
    let unchangedQueries = 0;
    for (let step = 0; step < 20 && view.status !== 'COMPLETE'; step++) {
      await assertCurrent();
      const previous = view;
      if (view.status === 'SIGNATURE_REQUIRED') {
        const review = await publisher.prepareBatchReview(batch.key);
        if (!review || review.quote?.verified !== true) {
          fail('MAKER_V8_PLAYER_JOURNEY_UPLOAD_DRIFT', 'Batch needs an exact verified storage quote before confirmation.', 'WALRUS');
        }
        await assertCurrent();
        await requestConfirmation(freeze({ kind: 'STORAGE_BATCH', purpose: 'RENDER_AND_NATIVE', rootId, signer,
          batchKey: batch.key, review, memberIds: [...review.memberIds] }));
        await assertCurrent();
        view = await publisher.signBatchReviewed(batch.key, review, assertCurrent);
      } else if (view.status === 'RECOVERY_REQUIRED') view = await publisher.resumeBatch(batch.key);
      else break;
      if (view.status === previous.status && view.revision === previous.revision) {
        if (view.status !== 'RECOVERY_REQUIRED' || view.reason === 'SIGNATURE_OUTCOME_UNKNOWN' || unchangedQueries++ >= 5) break;
        // Finality/index visibility can lag a successful broadcast. Continue
        // querying this exact signed batch without asking the user to Continue.
        await waitForBatchFinality(1000);
        await assertCurrent();
      } else unchangedQueries = 0;
    }
    if (view.status === 'FAILED') fail('MAKER_V8_PLAYER_JOURNEY_UPLOAD_FAILED', 'The exact storage batch definitively failed.', 'WALRUS', { upload: view });
    return view.status === 'COMPLETE' ? null : freeze({ status: 'RECOVERY_REQUIRED', stage: 'STORAGE_BATCH', upload: view });
  };

  const finishNativeComplete = async ({ rootId, signer, project, action, recovered = false, confirmEnvelopes, recoveryJson }) => {
    const soulId = soulFrom(action);
    const bound = action?.certificate?.evidence?.certifiedEvent?.fields;
    if (!soulId || bound.root_id !== rootId || bound.original_holder !== signer) {
      fail('MAKER_V8_PLAYER_JOURNEY_SOUL_READBACK_MISSING', 'Finalized completion lacks this wallet/Root native Soul.', 'READBACK');
    }
    // Only the user's Complete/Resume journey enters here; page loads never do.
    // Unknown signed operations remain query-only inside the envelope runner.
    const synced = await nativeContent.finalize({ rootId, signer, project, action, reprepare: true, recoveryJson,
      assertBeforeSignature: async step => {
        if (step?.kind !== 'NATIVE_ENVELOPES' || step.soulId !== soulId || step.stateId !== bound.soul_state_id
          || typeof confirmEnvelopes !== 'function') {
          fail('MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_REQUIRED', 'Review the completed Soul envelope transaction before signing.', 'PLAYER');
        }
        await confirmEnvelopes(step);
      } });
    if (synced?.status !== 'COMPLETE') {
      return freeze({ status: 'RECOVERY_REQUIRED', stage: 'NATIVE_CONTENT_SYNC',
        actionId: action.actionId, soulId, transactionDigest: action.transactionDigest,
        message: 'Soul mint is complete. Resume encrypted-content finalization; do not mint again.', reason: synced?.reason ?? null });
    }
    if (synced.soulId !== soulId || synced.transactionDigest !== action.transactionDigest) {
      fail('MAKER_V8_PLAYER_NATIVE_CONTENT_INVALID', 'Native content sync refers to a different completed Soul.', 'READBACK');
    }
    // Keep the finalized pointer until an explicit new-completion confirmation.
    // A closed page or lost response must still recover this Soul, not mint again.
    return freeze({ schemaVersion: MAKER_V8_PLAYER_JOURNEY_SCHEMA, status: 'HANDOFF_READY',
      rootId, soulId, actionId: action.actionId, recovered, transactionDigest: action.transactionDigest,
      completedProjectHash: hex(sha256(encoder.encode(canonicalMakerV8Json(project)))),
      handoffUrl: handoffUrl({ rootId, signer, action }) });
  };

  return freeze({
    schemaVersion: MAKER_V8_PLAYER_JOURNEY_SCHEMA,
    isNativeCompletionConfigured() {
      return typeof nativeContent?.isConfigured === 'function' && nativeContent.isConfigured() === true
        && ['preflight', 'prepare', 'finalize', 'loadCompletion', 'saveCompletion', 'clearCompletion']
          .every(name => typeof nativeContent?.[name] === 'function');
    },
    openReception(scope) { nativeContent?.open?.(scope); },
    async exportEnvelopeRecovery(scope) { return nativeContent?.exportRecovery?.(scope) ?? null; },
    async complete({ rootId, signer, selections, project = {} } = {}, { confirmStep, signal, startNew = false, newCompletionFrom, recoveryJson } = {}) {
      if (!EXACT_ID.test(rootId ?? '') || !EXACT_ID.test(signer ?? '') || !plain(project)) {
        fail('MAKER_V8_PLAYER_JOURNEY_INPUT_INVALID', 'An exact Root, signer and project are required.');
      }
      signal?.throwIfAborted();
      // Fail before acquisition or storage costs. This dependency must upload
      // real encrypted native content and complete its post-mint Seal sidecars;
      // render-only completion or caller-provided placeholder Blob IDs is not a fallback.
      if (['preflight', 'prepare', 'finalize', 'loadCompletion', 'saveCompletion', 'clearCompletion']
        .some(name => typeof nativeContent?.[name] !== 'function')) {
        fail('MAKER_V8_PLAYER_NATIVE_CONTENT_REQUIRED',
          'Native Soul encrypted content and recovery are not configured; no acquisition or upload was attempted.', 'CONFIGURATION');
      }
      const submittedProject = freeze(structuredClone(project));
      const submittedSelections = freeze(structuredClone(selections));
      const assertSubmittedIntent = () => {
        signal?.throwIfAborted();
        if (!sameCanonical(project, submittedProject) || !sameCanonical(selections, submittedSelections)) {
          fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
            'The submitted Soul text, profile or recipe changed during completion.', 'PLAYER');
        }
      };
      const requestConfirmation = async (step) => {
        if (typeof confirmStep !== 'function') {
          fail('MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_REQUIRED',
            'Review and confirm this step before requesting a wallet signature.', 'PLAYER');
        }
        const confirmed = await confirmStep(freeze({ ...structuredClone(step), rootId, signer }));
        if (confirmed !== true) {
          fail('MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED',
            'This step was not confirmed. Prepared transactions and upload records are retained.', 'PLAYER');
        }
        assertSubmittedIntent();
      };
      const confirmPrepared = (action, record) => {
        if (startNew && action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
          && record.actionId === newCompletionFrom?.actionId) {
          fail('MAKER_V8_PLAYER_JOURNEY_COMPLETED_RECORD_REQUIRED', 'A new completion cannot reuse the previous completed action.', 'RECOVERY');
        }
        return requestConfirmation({ kind: 'PLAYER_ACTION', action, record });
      };
      const loadActiveIntent = async () => {
        let snapshot = await player.getSnapshot();
        if (snapshot?.status !== 'READY' || snapshot.player?.rootId !== rootId) {
          const loaded = await player.loadPlayer(rootId);
          if (loaded?.status !== 'READY') {
            fail('MAKER_V8_PLAYER_JOURNEY_PLAYER_UNAVAILABLE', 'The selected active Maker is unavailable.', 'PLAYER');
          }
          snapshot = await player.getSnapshot();
        }
        const visibleIntent = assertCompleteVisibleIntent({ selections, project, snapshot });
        await nativeContent.preflight(freeze({ rootId, signer, project: submittedProject }));
        assertSubmittedIntent();
        return { snapshot, visibleIntent };
      };
      // Journal is persisted before the first Complete signature. A sidecar or
      // reload retry must query that exact action, never prepare new Blob inputs
      // and accidentally change the controller's idempotency scope. Recovery
      // precedes live Maker/issuance gates: pausing new mints must not prevent
      // synchronization of an already finalized Soul.
      const pendingCompletion = await nativeContent.loadCompletion({ rootId, signer });
      if (recoveryJson !== undefined && (typeof recoveryJson !== 'string'
        || new TextEncoder().encode(recoveryJson).length > 2 * 1024 * 1024 || !pendingCompletion || startNew)) {
        fail('MAKER_V8_PLAYER_ENVELOPE_RECOVERY_INVALID', 'Envelope recovery requires the existing completion, not a new Soul.', 'RECOVERY');
      }
      if (startNew && pendingCompletion === null) {
        fail('MAKER_V8_PLAYER_JOURNEY_COMPLETED_RECORD_REQUIRED',
          'The prior completed Soul must be recovered before starting another completion.', 'RECOVERY');
      }
      if (startNew && (!plain(newCompletionFrom) || newCompletionFrom.actionId !== pendingCompletion.actionId
        || !EXACT_ID.test(newCompletionFrom.soulId ?? '') || typeof newCompletionFrom.transactionDigest !== 'string')) {
        fail('MAKER_V8_PLAYER_JOURNEY_COMPLETED_RECORD_REQUIRED', 'The prior completed Soul identity changed.', 'RECOVERY');
      }
      if (pendingCompletion !== null) {
        exactRecord(pendingCompletion, ['rootId', 'signer', 'actionId', 'project'], 'pending native completion');
        if (pendingCompletion.rootId !== rootId || pendingCompletion.signer !== signer
          || typeof pendingCompletion.actionId !== 'string' || !pendingCompletion.actionId
          || !plain(pendingCompletion.project)) {
          fail('MAKER_V8_PLAYER_NATIVE_CONTENT_INVALID', 'Pending native completion belongs to another scope.', 'RECOVERY');
        }
        let action = await player.recoverPlayerAction(pendingCompletion.actionId, { replayIfNotFound: false });
        if (action?.actionId !== pendingCompletion.actionId) {
          fail('MAKER_V8_PLAYER_NATIVE_CONTENT_INVALID', 'Recovered native completion has a different action ID.', 'RECOVERY');
        }
        if (recoveryJson !== undefined && action.status !== FINAL_SUCCESS) {
          fail('MAKER_V8_PLAYER_ENVELOPE_RECOVERY_INVALID', 'Verify the original minted Soul before restoring its envelope transaction.', 'RECOVERY');
        }
        if (startNew && action.status !== FINAL_SUCCESS) {
          fail('MAKER_V8_PLAYER_JOURNEY_COMPLETED_RECORD_REQUIRED', 'Only a finalized prior Soul can start another completion.', 'RECOVERY');
        }
        if (action.status === 'PREPARED') {
          if (!sameCanonical(submittedProject, pendingCompletion.project)) {
            await nativeContent.clearCompletion({ rootId, signer, actionId: action.actionId });
            fail('MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
              'Unsigned completion was retired because the submitted project changed; no new transaction was signed.', 'RECOVERY');
          }
          await loadActiveIntent();
          assertSubmittedIntent();
          assertCompleteVisibleIntent({ selections, project, snapshot: await player.getSnapshot() });
          await confirmPrepared(MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, action);
          assertSubmittedIntent();
          assertCompleteVisibleIntent({ selections, project, snapshot: await player.getSnapshot() });
          action = await player.executePlayerAction(action.actionId);
          if (action?.actionId !== pendingCompletion.actionId) {
            fail('MAKER_V8_PLAYER_NATIVE_CONTENT_INVALID', 'Resumed completion has a different action ID.', 'RECOVERY');
          }
        }
        if (action.status === FINAL_SUCCESS) {
          const completed = await finishNativeComplete({ rootId, signer,
            project: freeze(structuredClone(pendingCompletion.project)), action, recovered: true, confirmEnvelopes: requestConfirmation, recoveryJson });
          if (!startNew || completed.status !== 'HANDOFF_READY') return completed;
          if (newCompletionFrom.soulId !== completed.soulId
            || newCompletionFrom.transactionDigest !== completed.transactionDigest) {
            fail('MAKER_V8_PLAYER_JOURNEY_COMPLETED_RECORD_REQUIRED', 'The prior completed Soul identity changed.', 'RECOVERY');
          }
          if (typeof nativeContent.retireFinalizedCompletion !== 'function') {
            fail('MAKER_V8_PLAYER_JOURNEY_NEW_COMPLETION_UNAVAILABLE', 'Starting another Soul is not configured.', 'CONFIGURATION');
          }
          await requestConfirmation({ kind: 'NEW_COMPLETION', actionId: completed.actionId,
            soulId: completed.soulId, transactionDigest: completed.transactionDigest });
          await loadActiveIntent();
          await nativeContent.retireFinalizedCompletion({ rootId, signer, actionId: completed.actionId,
            soulId: completed.soulId, transactionDigest: completed.transactionDigest });
          assertSubmittedIntent();
        } else if (['FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(action.status)) {
          // Only the native pointer retires; the controller keeps its durable
          // signed/failed action for audit. Unknown outcomes never reach here.
          await nativeContent.clearCompletion({ rootId, signer, actionId: action.actionId });
          fail('MAKER_V8_PLAYER_JOURNEY_ACTION_FAILED',
            'The prior completion definitively failed or expired; its recovery pointer was retired.', 'FINALITY', { action });
        } else return freeze({ status: 'RECOVERY_REQUIRED', stage: 'SOUL_COMPLETION', action });
      }
      for (const method of ['prepareBatch', 'loadBatch', 'prepareBatchReview', 'signBatchReviewed', 'resumeBatch']) {
        requireMethod(publisher, method, 'walrus.publisher');
      }
      let { snapshot, visibleIntent } = await loadActiveIntent();
      const recipe = structuredClone(visibleIntent.recipe);
      const output = snapshot.player.document.outputs?.find(
        (entry) => entry.key === recipe.outputKey,
      ) ?? null;
      const outputProtected = output?.protected === true;
      if (outputProtected && typeof protectedTransport?.protect !== 'function') {
        fail(
          'MAKER_V8_PLAYER_PROTECTED_TRANSPORT_REQUIRED',
          'Protected Output requires the server-only Seal transport; no browser credential fallback is permitted.',
          'BLOCKED_EXTERNAL_SECRET',
        );
      }
      let renderResult = await render({
        player: snapshot.player,
        recipe,
        signer,
        productRuntime,
        exportOptions: visibleIntent.exportOptions,
        decryptProtectedSelection: typeof player.decryptProtectedSelection === 'function'
          ? (input) => player.decryptProtectedSelection(input)
          : null,
      });
      assertVisibleRenderEvidence(visibleIntent.render, renderResult);
      const inventoryResult = await loadInventory({ address: signer, rootId });
      if (!['READY', 'EMPTY'].includes(inventoryResult?.status)
        || Array.isArray(inventoryResult?.diagnostics) && inventoryResult.diagnostics.length > 0) {
        fail(
          'MAKER_V8_PLAYER_JOURNEY_INVENTORY_INCOMPLETE',
          'The exact contextual ownership inventory is incomplete; no acquisition or completion was attempted.',
          'INVENTORY',
          { status: inventoryResult?.status ?? null },
        );
      }
      const rows = (inventoryResult?.items ?? inventoryResult?.rows ?? inventoryResult ?? []);
      if (!Array.isArray(rows)) {
        fail('MAKER_V8_PLAYER_JOURNEY_INVENTORY_INVALID', 'Soulidity inventory projection is unavailable.', 'INVENTORY');
      }
      const inventory = rows.filter((row) => row.rootId === rootId);
      for (const selection of recipe.selections.filter((row) => row.source === 'EXTERNAL')) {
        const held = inventory.find((row) => (
          row.kind === 'OWNED_EXTERNAL_ITEM'
          && row.id === selection.ownedExternalItemId
          && row.sourceId === selection.externalProductId
          && row.partKey === selection.partKey
          && row.itemKey === selection.itemKey
          && row.styleKey === selection.styleKey
        ));
        if (!held) {
          fail(
            'MAKER_V8_PLAYER_JOURNEY_EXTERNAL_ITEM_NOT_HELD',
            'The selected external Item is not an exact holder-owned contextual choice.',
            'INVENTORY',
            {
              externalProductId: selection.externalProductId,
              ownedExternalItemId: selection.ownedExternalItemId,
            },
          );
        }
      }
      const assertCurrentVisibleIntent = async () => {
        assertSubmittedIntent();
        const current = await player.getSnapshot();
        if (current?.status !== 'READY' || current.player?.rootId !== rootId) {
          fail(
            'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
            'The active Player changed before the next recoverable action.',
            'PLAYER',
          );
        }
        try {
          visibleIntent = assertCompleteVisibleIntent({ selections, project, snapshot: current });
        } catch (cause) {
          if (cause?.code === 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_INVALID') {
            fail(
              'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
              'The active Player intent became invalid before the next recoverable action.',
              'PLAYER',
              { causeCode: cause.code },
            );
          }
          throw cause;
        }
        snapshot = current;
        return current;
      };
      if (typeof player.quotePlayerCompletion !== 'function') {
        fail('MAKER_V8_PLAYER_JOURNEY_QUOTE_REQUIRED',
          'A read-only completion overview is required before any acquisition or upload.', 'CONFIGURATION');
      }
      const overview = await player.quotePlayerCompletion();
      await assertCurrentVisibleIntent();
      if (overview?.rootId !== rootId || overview.signer !== signer
        || overview.recipeCommitment !== snapshot.loadout.recipeCommitment
        || !overview.completePaymentQuote || !overview.entryPaymentQuote) {
        fail('MAKER_V8_PLAYER_JOURNEY_QUOTE_INVALID',
          'The completion overview does not match this Maker, wallet and recipe.', 'PLAYER');
      }
      await requestConfirmation({ kind: 'COMPLETION_OVERVIEW', overview });
      await assertCurrentVisibleIntent();
      const advance = async (action, input = {}) => {
        await assertCurrentVisibleIntent();
        const result = await settleAction(action, input, assertCurrentVisibleIntent, null, confirmPrepared);
        if (result.pending) return result;
        await assertCurrentVisibleIntent();
        snapshot = await reload(rootId, recipe);
        visibleIntent = assertCompleteVisibleIntent({ selections, project, snapshot });
        return null;
      };
      if (!inventory.some((row) => row.kind === 'MAKER_ACCESS')) {
        const pending = await advance(MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS);
        if (pending) return freeze({ status: 'RECOVERY_REQUIRED', stage: 'MAKER_ACCESS', ...pending });
      }
      if (snapshot.player.document.composition.itemAssetization === true) {
        const owned = new Set(inventory.filter((row) => row.kind === 'OWNED_BASE_ITEM')
          .map((row) => `${row.partKey}\u0000${row.itemKey}`));
        for (const selection of recipe.selections.filter((row) => row.source === 'BASE')) {
          const key = `${selection.partKey}\u0000${selection.itemKey}`;
          if (owned.has(key)) continue;
          const pending = await advance(MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM, {
            partKey: selection.partKey,
            itemKey: selection.itemKey,
          });
          if (pending) return freeze({ status: 'RECOVERY_REQUIRED', stage: 'BASE_ITEM', ...pending });
          owned.add(key);
        }
      }
      const packPasses = new Set(inventory.filter((row) => row.kind === 'PACK_ACCESS')
        .map((row) => row.sourceId));
      const packs = [...new Map(recipe.selections.filter((row) => row.source === 'PACK')
        .map((row) => [row.releaseId, row])).values()];
      for (const selection of packs) {
        if (packPasses.has(selection.releaseId)) continue;
        const pending = await advance(MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS, {
          releaseId: selection.releaseId,
          semanticPackId: selection.semanticPackId,
        });
        if (pending) return freeze({ status: 'RECOVERY_REQUIRED', stage: 'PACK_ACCESS', ...pending });
        packPasses.add(selection.releaseId);
      }
      const reused = await player.reuseCommittedPlayerLoadout();
      await assertCurrentVisibleIntent();
      if (reused !== true && reused !== false) {
        fail('MAKER_V8_PLAYER_JOURNEY_LOADOUT_REUSE_INVALID', 'Committed Loadout reuse lacks exact live evidence.', 'PLAYER');
      }
      if (!reused) {
        const committed = await advance(MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT);
        if (committed) return freeze({ status: 'RECOVERY_REQUIRED', stage: 'LOADOUT', ...committed });
      }
      if (outputProtected) {
        renderResult = await protectRender({
          protectedTransport,
          player,
          recipe: snapshot.recipe,
          signer,
          renderResult,
          publisher,
        });
      }
      await assertCurrentVisibleIntent();
      const batchPending = await settleStorageBatch({ rootId, signer, renderResult, project: submittedProject,
        assertCurrent: assertCurrentVisibleIntent, requestConfirmation });
      if (batchPending) return batchPending;
      await assertCurrentVisibleIntent();
      const upload = await settleUpload({
        signer,
        renderResult,
        rootId,
        assertBeforeSignature: async (step) => {
          await assertCurrentVisibleIntent();
          await requestConfirmation(step);
          await assertCurrentVisibleIntent();
        },
      });
      if (upload.pending) return freeze({ status: 'RECOVERY_REQUIRED', stage: 'RENDER_UPLOAD', upload: upload.upload });
      await assertCurrentVisibleIntent();
      const content = await nativeContent.prepare({
        rootId, signer, project: submittedProject,
        assertBeforeSignature: async (step) => {
          await assertCurrentVisibleIntent();
          if (step?.kind !== 'STORAGE_UPLOAD' || step.purpose !== 'NATIVE_CONTENT') {
            fail('MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_REQUIRED', 'Native content upload step is missing.', 'PLAYER');
          }
          await requestConfirmation(step);
          await assertCurrentVisibleIntent();
        },
      });
      await assertCurrentVisibleIntent();
      if (content?.status === 'RECOVERY_REQUIRED') {
        return freeze({ status: 'RECOVERY_REQUIRED', stage: 'NATIVE_CONTENT' });
      }
      if (content?.status !== 'READY') {
        fail('MAKER_V8_PLAYER_NATIVE_CONTENT_INVALID', 'Native encrypted content is not ready for completion.', 'READBACK');
      }
      assertMakerV8NativeCompletionInputV8(content.nativeSoul);
      const complete = await settleAction(MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, {
        render: upload.render,
        nativeSoul: content.nativeSoul,
      }, assertCurrentVisibleIntent, (action) => nativeContent.saveCompletion(freeze({
        rootId, signer, actionId: action.actionId, project: submittedProject,
      })), confirmPrepared);
      if (complete.pending) return freeze({ status: 'RECOVERY_REQUIRED', stage: 'SOUL_COMPLETION', ...complete });
      return finishNativeComplete({ rootId, signer, project: submittedProject, action: complete, confirmEnvelopes: requestConfirmation, recoveryJson });
    },
  });
}
