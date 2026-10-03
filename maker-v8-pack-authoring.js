import { assertMakerV8Document, projectPublicMakerV8Document } from './maker-v8-document.js';
import { prepareCreatorStructure } from './maker-v8-creator-structure.js';
import { prepareCreatorStyleChange, creatorStyleEditorState } from './maker-v8-creator-style.js';
import { makerV8VisibilityFromBuilder } from './maker-v8-visibility.js';
import { makerV8RuleFromBuilder } from './maker-v8-rules.js';
import { prepareCreatorTrackChange } from './maker-v8-creator-tracks.js';
import { prepareCreatorColorChange } from './maker-v8-creator-colors.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalMakerV8PackJson } from './maker-v8-pack-controller.js';
import { bindMakerV8SourceAssets } from './maker-v8-source-asset.js';

function fail(message) {
  const error = new TypeError(message);
  error.code = 'MAKER_V8_PACK_AUTHORING_INVALID';
  throw error;
}

const json = value => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const without = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const same = (a, b) => json(a) === json(b);
const identity = (part, item, style) => `${part}/${item}/${style}`;

export function packAuthoringParent(pack) {
  const parent = pack.bindings?.kind === 'LOCAL_DRAFT' ? pack.bindings.parent : pack.authoringParent;
  if (!parent?.draft?.document) fail('Authoring requires its retained authenticated parent snapshot.');
  return parent;
}
function parentDocument(pack) { return packAuthoringParent(pack).draft.document; }

/** Complete author intent, independent of local revision and transport location.
 * This is NOT a release commitment or proof of a published parent. The final
 * release must bind this content to certified Root identity before signing. */
export function packAuthoringContent(pack) {
  const document = packAuthoringDocument(pack);
  assertPackAuthoring({ ...pack, authoring: document });
  const parent = packAuthoringParent(pack);
  const assets = parent.assets.map(asset => ({ assetId: asset.assetId, kind: asset.kind,
    mediaType: asset.mediaType, byteLength: asset.byteLength, sha256: asset.sha256 }));
  const content = {
    schemaVersion: 'animacraft.maker-v8-pack-authoring-content.v1',
    parent: { document: structuredClone(parent.draft.document), assets: assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0) },
    document,
    styles: pack.styles.map(row => ({ sequence: row.sequence, partKey: row.partKey,
      itemKey: row.itemKey, styleKey: row.styleKey, layerTrackKey: row.layerTrackKey,
      colorChannelKey: row.colorChannelKey, defaultSwatchKey: row.defaultSwatchKey,
      asset: { assetId: row.asset.assetId, contentCommitment: row.asset.contentCommitment,
        protected: row.asset.protected } })),
  };
  return assertPackAuthoringContent(content, { expectedParent: content.parent });
}

/** The release carries public definitions only; the local draft remains whole. */
export function packPublicationAuthoringContent(pack) {
  const snapshot = packAuthoringParent(pack);
  const authored = packAuthoringDocument(pack);
  assertPackAuthoring({ ...pack, authoring: authored });
  const parentProjection = projectPublicMakerV8Document(parentDocument(pack));
  const documentProjection = projectPublicMakerV8Document(authored);
  // Reuse Maker publication normalization. These identities are retained from
  // validated local parent bytes and Pack asset writes, not ciphertext records.
  // Both sides must gain the same inherited metadata; never erase it to match.
  const sourceAssets = [
    ...snapshot.assets,
    ...pack.styles.map(row => ({ assetId: row.asset.assetId, sha256: row.asset.contentCommitment,
      mediaType: row.asset.mediaType, byteLength: row.asset.byteLength })),
  ];
  const parent = bindMakerV8SourceAssets(parentProjection, snapshot.assets);
  const document = bindMakerV8SourceAssets(documentProjection, sourceAssets);
  const publicStyles = new Set(document.parts.flatMap(part => part.items.flatMap(item =>
    item.styles.map(style => identity(part.key, item.key, style.key)))));
  const parentAssetIds = new Set(parent.assets.map(asset => asset.id));
  return packAuthoringContent({ ...pack,
    bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: parent },
      assets: snapshot.assets.filter(asset => parentAssetIds.has(asset.assetId)) } },
    authoring: document,
    styles: pack.styles.filter(row => publicStyles.has(identity(row.partKey, row.itemKey, row.styleKey)))
      .map((row, index) => ({ ...row, sequence: String(index) })),
  });
}

export function assertPublicPackAuthoringContent(content, options) {
  const checked = assertPackAuthoringContent(content, options);
  if (!same(projectPublicMakerV8Document(checked.content.parent.document), checked.content.parent.document)
    || !same(projectPublicMakerV8Document(checked.content.document), checked.content.document)) {
    fail('Published Pack authoring must not contain private definitions or unused assets.');
  }
  return checked;
}

/** Validate decoded content against an independently authenticated parent.
 * Parent authenticity and outer release identity are the caller's responsibility. */
export function assertPackAuthoringContent(value, { expectedParent, expectedCommitment } = {}) {
  const exact = (row, keys) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !same(Object.keys(row).sort(), [...keys].sort())) fail('Authoring content has missing or unknown fields.');
  };
  exact(value, ['schemaVersion', 'parent', 'document', 'styles']);
  if (value.schemaVersion !== 'animacraft.maker-v8-pack-authoring-content.v1') fail('Unknown Pack authoring content schema.');
  exact(value.parent, ['document', 'assets']);
  if (!expectedParent || !same(value.parent, expectedParent)) fail('Pack authoring parent differs from authenticated parent content.');
  assertMakerV8Document(value.parent.document, { mode: 'draft' });
  assertMakerV8Document(value.document, { mode: 'draft' });
  const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  if (!Array.isArray(value.parent.assets) || value.parent.assets.length !== value.parent.document.assets.length) fail('Parent asset inventory differs.');
  let previousId = null;
  for (const asset of value.parent.assets) {
    exact(asset, ['assetId', 'kind', 'mediaType', 'byteLength', 'sha256']);
    if (typeof asset.assetId !== 'string' || previousId !== null && previousId >= asset.assetId || !hash(asset.sha256)) fail('Parent asset identity/hash is invalid.');
    previousId = asset.assetId;
    const descriptor = value.parent.document.assets.find(row => row.id === asset.assetId);
    if (!descriptor || !same(descriptor, { id: asset.assetId, kind: asset.kind, mediaType: asset.mediaType, byteLength: asset.byteLength })) fail('Parent asset descriptor differs.');
  }
  if (!Array.isArray(value.styles) || value.styles.length > 10000) fail('Invalid authoring Style inventory.');
  const identities = new Set(), assetIds = new Set();
  const styles = value.styles.map((row, index) => {
    exact(row, ['sequence', 'partKey', 'itemKey', 'styleKey', 'layerTrackKey', 'colorChannelKey', 'defaultSwatchKey', 'asset']);
    exact(row.asset, ['assetId', 'contentCommitment', 'protected']);
    const key = identity(row.partKey, row.itemKey, row.styleKey);
    if (row.sequence !== String(index) || identities.has(key) || assetIds.has(row.asset.assetId)
      || !hash(row.asset.contentCommitment) || typeof row.asset.protected !== 'boolean') fail('Invalid or duplicate authoring Style/asset identity.');
    identities.add(key); assetIds.add(row.asset.assetId);
    const asset = value.document.assets.find(asset => asset.id === row.asset.assetId);
    if (!asset || asset.kind !== 'layer' || value.parent.assets.some(parent => parent.assetId === asset.id)) fail('Pack asset must be an independent layer.');
    return { ...row, asset: { ...row.asset, mediaType: asset.mediaType, byteLength: asset.byteLength } };
  });
  assertPackAuthoring({ authoring: value.document, styles,
    bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: value.parent.document } } } });
  const canonical = canonicalMakerV8PackJson(value);
  const commitment = [...sha256(new TextEncoder().encode(canonical))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (expectedCommitment !== undefined && (!hash(expectedCommitment) || commitment !== expectedCommitment)) fail('Pack authoring content commitment differs.');
  const content = JSON.parse(canonical);
  return { content, commitment, definitions: structuredClone(scopedDefinitions(content)) };
}

/** Derived compiler input, not a new authority or a persisted release ID.
 * PACK_SELF is bound to the actual Release ID at publication/readback. Each
 * namespace is independent: a Pack Style in a Base Part may use its own track.
 * Run only after full authoring/parent validation above; never trust supplied
 * scope flags or rewrite the original document's local authoring keys. */
function scopedDefinitions({ parent, document, styles }) {
  const reference = (kind, key) => {
    if (key === null) return null;
    const matches = document[kind].filter(row => row.key === key);
    if (matches.length !== 1) fail(`Pack ${kind} reference is missing or ambiguous.`);
    return { scope: parent.document[kind].some(row => row.key === key) ? 'BASE' : 'PACK_SELF', key };
  };
  const owned = kind => document[kind].slice(parent.document[kind].length);
  return {
    schemaVersion: 'animacraft.maker-v8-pack-definition-input.v1',
    parts: owned('parts'), tracks: owned('tracks'), colors: owned('colors'), rules: owned('rules'),
    styles: styles.map(style => ({
      sequence: style.sequence,
      part: reference('parts', style.partKey),
      itemKey: style.itemKey, styleKey: style.styleKey,
      track: reference('tracks', style.layerTrackKey),
      color: reference('colors', style.colorChannelKey),
      defaultSwatchKey: style.defaultSwatchKey,
    })),
  };
}

/** Project existing persisted artwork into the SAME Maker authoring vocabulary.
 * Pending Styles have no manifest asset row until their first successful upload. */
export function packAuthoringDocument(pack) {
  const parent = parentDocument(pack);
  const document = structuredClone(pack.authoring ?? parent);
  for (const row of pack.styles) {
    const part = document.parts.find(part => part.key === row.partKey);
    const item = part?.items.find(item => item.key === row.itemKey);
    if (!item) fail('Pack artwork refers to a missing authoring Item.');
    const inherited = parent.parts.find(part => part.key === row.partKey)?.items
      .find(item => item.key === row.itemKey)?.styles.some(style => style.key === row.styleKey);
    if (inherited) fail('Pack artwork cannot overwrite an inherited Style.');
    let style = item.styles.find(style => style.key === row.styleKey);
    if (!style) {
      style = { key: row.styleKey, label: row.styleKey,
        displayOrder: Math.max(-1, ...item.styles.map(style => style.displayOrder)) + 1,
        trackKey: row.layerTrackKey, colorChannelKey: row.colorChannelKey, defaultSwatchKey: row.defaultSwatchKey,
        assetId: null, protected: row.asset.protected,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 }, opacity: 1, blendMode: 'normal', physical: null, payload: {} };
      item.styles.push(style);
    }
    style.assetId = row.asset.assetId;
    style.trackKey = row.layerTrackKey;
    style.colorChannelKey = row.colorChannelKey;
    style.defaultSwatchKey = row.defaultSwatchKey;
    style.protected = row.asset.protected;
    const descriptor = { id: row.asset.assetId, kind: 'layer', mediaType: row.asset.mediaType, byteLength: row.asset.byteLength };
    if (parent.assets.some(asset => asset.id === descriptor.id)) fail('Pack asset IDs cannot shadow parent assets.');
    const index = document.assets.findIndex(asset => asset.id === descriptor.id);
    if (index < 0) document.assets.push(descriptor); else document.assets[index] = descriptor;
  }
  return document;
}

/** The child may append definitions, but cannot rewrite or reorder inherited rows. */
export function assertPackAuthoring(pack) {
  if (pack.authoring === undefined) return;
  const parent = parentDocument(pack), document = pack.authoring;
  assertMakerV8Document(document, { mode: 'draft' });
  if (!same(without(parent, ['parts', 'tracks', 'assets', 'colors', 'rules', 'defaultRecipe']),
    without(document, ['parts', 'tracks', 'assets', 'colors', 'rules', 'defaultRecipe']))) fail('Inherited Maker settings are read-only.');
  const prefix = (base, rows, omit = []) => {
    if (rows.length < base.length || base.some((row, index) => !same(without(row, omit), without(rows[index], omit)))) {
      fail('Inherited definitions are read-only and retain their order.');
    }
  };
  prefix(parent.parts, document.parts, ['items']);
  for (const [p, part] of parent.parts.entries()) {
    prefix(part.items, document.parts[p].items, ['styles']);
    for (const [i, item] of part.items.entries()) prefix(item.styles, document.parts[p].items[i].styles);
  }
  for (const part of document.parts.slice(parent.parts.length)) {
    if (part.required || part.kind !== 'STANDARD') fail('Pack-owned Parts must remain optional.');
  }
  prefix(parent.tracks, document.tracks);
  prefix(parent.assets, document.assets);
  prefix(parent.colors, document.colors);
  prefix(parent.rules, document.rules);
  for (const rule of document.rules.slice(parent.rules.length)) {
    const trigger = rule.trigger;
    const part = parent.parts.find(row => row.key === trigger.partKey);
    const item = part?.items.find(row => row.key === trigger.itemKey);
    const inherited = trigger.itemKey === null ? part : trigger.styleKey === null ? item : item?.styles.find(row => row.key === trigger.styleKey);
    if (inherited || !['ANY', 'BASE'].includes(trigger.source)) fail('Pack rules must be owned by an additive definition.');
  }
  prefix(parent.defaultRecipe.colors, document.defaultRecipe.colors);
  if (document.defaultRecipe.colors.slice(parent.defaultRecipe.colors.length).some(row => parent.colors.some(channel => channel.key === row.channelKey))) {
    fail('Pack color defaults cannot replace parent choices.');
  }
  if (!same(without(parent.defaultRecipe, ['selections', 'colors']), without(document.defaultRecipe, ['selections', 'colors']))) {
    fail('Inherited default colors and recipe settings are read-only.');
  }
  prefix(parent.defaultRecipe.selections, document.defaultRecipe.selections);
  const inheritedParts = new Set(parent.parts.map(part => part.key));
  if (document.defaultRecipe.selections.slice(parent.defaultRecipe.selections.length).some(row => inheritedParts.has(row.partKey))) {
    fail('Pack defaults cannot replace parent choices.');
  }
  const inheritedStyles = new Set(parent.parts.flatMap(part => part.items.flatMap(item =>
    item.styles.map(style => identity(part.key, item.key, style.key)))));
  const manifest = new Map(pack.styles.map(row => [identity(row.partKey, row.itemKey, row.styleKey), row]));
  const found = new Set();
  for (const part of document.parts) for (const item of part.items) for (const style of item.styles) {
    const key = identity(part.key, item.key, style.key);
    if (inheritedStyles.has(key)) continue;
    const row = manifest.get(key);
    if (style.assetId === null && !row) continue;
    if (!row || row.asset.assetId !== style.assetId || row.layerTrackKey !== style.trackKey
      || row.colorChannelKey !== style.colorChannelKey || row.defaultSwatchKey !== style.defaultSwatchKey
      || row.asset.protected !== style.protected) fail('Pack Style differs from its saved artwork index.');
    found.add(key);
  }
  if (found.size !== manifest.size) fail('Every saved Pack asset must have one authoring Style.');
  const expectedAssets = [...parent.assets, ...pack.styles.map(row => ({ id: row.asset.assetId,
    kind: 'layer', mediaType: row.asset.mediaType, byteLength: row.asset.byteLength }))];
  if (!same([...document.assets].sort((a,b) => a.id.localeCompare(b.id)),
    expectedAssets.sort((a,b) => a.id.localeCompare(b.id)))) fail('Pack authoring asset descriptors differ from saved artwork.');
}

export function preparePackStructure(pack, { action, partKey, itemKey, styleKey, direction, targetKey } = {}) {
  if (!['add-part', 'add-item', 'add-style', 'add-channel', 'add-track', 'copy-part', 'copy-item', 'copy-style', 'move-part'].includes(action)) fail('Unsupported Pack structure operation.');
  assertPackAuthoring(pack);
  if (action === 'move-part' && parentDocument(pack).parts.some(row => row.key === partKey)) fail('Inherited Parts are read-only.');
  if (action === 'move-part' && targetKey !== undefined && parentDocument(pack).parts.some(row => row.key === targetKey)) fail('Inherited Part order is read-only.');
  if (action.startsWith('copy-')) {
    const part = parentDocument(pack).parts.find(row => row.key === partKey);
    const item = part?.items.find(row => row.key === itemKey);
    const inherited = action === 'copy-part' ? part : action === 'copy-item' ? item : item?.styles.find(row => row.key === styleKey);
    if (inherited) fail('Copy a Pack-owned definition; inherited definitions are read-only.');
  }
  const prepared = ['add-track', 'move-part'].includes(action)
    ? { ...prepareCreatorTrackChange({ document: packAuthoringDocument(pack), action, partKey, direction, targetKey }), selection: { partKey, itemKey, styleKey } }
    : action === 'add-channel'
    ? { ...prepareCreatorColorChange({ document: packAuthoringDocument(pack), action }), selection: { partKey, itemKey, styleKey } }
    : prepareCreatorStructure({ document: packAuthoringDocument(pack), action, partKey, itemKey, styleKey });
  const document = { ...structuredClone(pack), authoring: prepared.document };
  const assetCopies = [];
  if (action.startsWith('copy-')) {
    const before = packAuthoringDocument(pack);
    const existing = new Set(before.parts.flatMap(part => part.items.flatMap(item => item.styles.map(style => identity(part.key, item.key, style.key)))));
    const used = new Set(before.assets.map(row => row.id));
    for (const part of document.authoring.parts) for (const item of part.items) for (const style of item.styles) {
      if (existing.has(identity(part.key, item.key, style.key)) || style.assetId === null) continue;
      const source = pack.styles.find(row => row.asset.assetId === style.assetId);
      if (!source) fail('Copied artwork must belong to this Pack.');
      let suffix = used.size + 1;
      while (used.has(`pack-copy-asset-${suffix}`)) suffix += 1;
      const assetId = `pack-copy-asset-${suffix}`;
      used.add(assetId);
      assetCopies.push({ sourceAssetId: style.assetId, assetId });
      style.assetId = assetId;
      document.styles.push({ ...structuredClone(source), sequence: String(document.styles.length),
        partKey: part.key, itemKey: item.key, styleKey: style.key, layerTrackKey: style.trackKey,
        asset: { ...structuredClone(source.asset), assetId, blobId: null, sealBindingCommitment: null } });
      document.authoring.assets.push({ id: assetId, kind: 'layer', mediaType: source.asset.mediaType, byteLength: source.asset.byteLength });
    }
  }
  assertPackAuthoring(document);
  return { document, selection: prepared.selection, assetCopies };
}

export function preparePackEdits(pack, edits) {
  if (!Array.isArray(edits) || edits.length > 1000) fail('Pack edits must be a bounded list.');
  assertPackAuthoring(pack);
  const next = structuredClone(pack);
  let authoring = packAuthoringDocument(pack);
  for (const edit of edits) {
    if (edit.kind === 'track') {
      if (parentDocument(pack).tracks.some(row => row.key === edit.trackKey)) fail('Inherited Layer Tracks are read-only.');
      if (!['track-name', 'toggle-track-lock', 'move-track'].includes(edit.field)) fail('Unsupported Pack track operation.');
      if (edit.field === 'move-track' && edit.direction === 'up') {
        const tracks = [...authoring.tracks].sort((a, b) => a.renderOrder - b.renderOrder);
        const previous = tracks[tracks.findIndex(row => row.key === edit.trackKey) - 1];
        if (parentDocument(pack).tracks.some(row => row.key === previous?.key)) fail('Inherited Layer Track order is read-only.');
      }
      authoring = prepareCreatorTrackChange({ document: authoring, action: edit.field,
        trackKey: edit.trackKey, value: edit.value, direction: edit.direction }).document;
      assertPackAuthoring({ ...next, authoring });
      continue;
    }
    if (edit.kind === 'rule') {
      const index = authoring.rules.findIndex(row => row.key === edit.ruleKey);
      if (parentDocument(pack).rules.some(row => row.key === edit.ruleKey)) fail('Inherited rules are read-only.');
      if (edit.field === 'remove-rule') {
        if (index < 0) fail('The Pack rule no longer exists.');
        authoring.rules.splice(index, 1);
      } else if (edit.field === 'upsert-rule') {
        const rule = makerV8RuleFromBuilder({ ...edit.value, key: edit.ruleKey,
          payload: index < 0 ? {} : authoring.rules[index].payload });
        if (index < 0) authoring.rules.push(rule); else authoring.rules[index] = rule;
      } else fail('Unsupported Pack rule operation.');
      assertPackAuthoring({ ...next, authoring });
      continue;
    }
    const { kind, field, partKey, itemKey, styleKey, value, channelKey, swatchKey, stopIndex } = edit;
    const part = authoring.parts.find(row => row.key === partKey);
    const item = part?.items.find(row => row.key === itemKey);
    const style = item?.styles.find(row => row.key === styleKey);
    const target = kind === 'part' ? part : kind === 'item' ? item : kind === 'style' ? style
      : kind === 'color' ? authoring.colors.find(row => row.key === channelKey) : null;
    if (!target) fail('Select an existing Pack definition.');
    if (field === 'label') {
      if (typeof value !== 'string' || !value.trim()) fail('Pack definition names cannot be empty.');
      target.label = value.trim();
    } else if (kind === 'style' && ['style-x', 'style-y', 'style-scale', 'style-rotation', 'style-opacity', 'style-blend'].includes(field)) {
      authoring = prepareCreatorStyleChange({ document: authoring, partKey, itemKey, styleKey, action: field, value }).document;
    } else if (kind === 'style' && field === 'assign-style-track') {
      if (!value) fail('Choose a Layer Track for this Pack Style.');
      authoring = prepareCreatorTrackChange({ document: authoring, partKey, itemKey, styleKey, action: field, value }).document;
    } else if (kind === 'style' && field === 'assign-style-color') {
      authoring = prepareCreatorColorChange({ document: authoring, partKey, itemKey, styleKey, action: field, value }).document;
    } else if (kind === 'style' && field === 'style-visibility') {
      if (creatorStyleEditorState(style).styleLocked) fail('Unlock the whole Style before changing visibility.');
      style.visibleWhen = value === null ? null : makerV8VisibilityFromBuilder({ document: authoring,
        partKey, itemKey, styleKey, logic: value?.logic, polarity: value?.polarity, definitions: value?.definitions });
    } else if (kind === 'color' && ['channel-name', 'add-swatch', 'channel-default-swatch', 'swatch-name', 'swatch-hint', 'swatch-mid', 'swatch-stop'].includes(field)) {
      authoring = prepareCreatorColorChange({ document: authoring, channelKey, swatchKey, stopIndex,
        action: field, ...(field === 'add-swatch' ? {} : { value }) }).document;
    } else fail('Unsupported Pack property.');
    if (kind === 'style') {
      const currentStyle = authoring.parts.find(row => row.key === partKey)?.items.find(row => row.key === itemKey)?.styles.find(row => row.key === styleKey);
      const row = next.styles.find(row => row.partKey === partKey && row.itemKey === itemKey && row.styleKey === styleKey);
      if (row) { row.layerTrackKey = currentStyle.trackKey; row.colorChannelKey = currentStyle.colorChannelKey; row.defaultSwatchKey = currentStyle.defaultSwatchKey; }
    }
    // Check every operation, so two edits cannot temporarily rewrite a parent
    // row and hide the violation by subsequently restoring it.
    assertPackAuthoring({ ...next, authoring });
  }
  return { ...next, authoring };
}
