import { assertMakerV8Document, createMakerV8Document } from './maker-v8-document.js';

/** The existing New Maker authoring skeleton: creators supply all artwork. */
export function createCreatorCharacterStarter(options = {}) {
  const document = structuredClone(createMakerV8Document(options));
  const definitions = [
    ['background', 'Background', false],
    ['back-hair', 'Back Hair', false],
    ['skin-base', 'Skin & Base', true],
    ['outfit', 'Outfit', false],
    ['eyes', 'Eyes', true],
    ['mouth', 'Mouth', false],
    ['front-hair', 'Front Hair', false],
    ['accessory', 'Accessory', false],
  ];
  definitions.forEach(([key, label, required], order) => {
    const part = {
      key, label, kind: required ? 'LAST_BASTION' : 'STANDARD',
      renderOrder: order, menuOrder: order, visible: true, required,
      wardrobeMode: 'FIXED', capacity: 1, items: [], payload: {},
    };
    const item = createItem(part, createTrack(document, part), true);
    item.key = `${key}-default`;
    item.styles[0].payload.animacraftEditor = {
      positionConfirmed: false, positionLocked: false, styleLocked: false,
    };
    part.items.push(item);
    document.parts.push(part);
    document.defaultRecipe.selections.push({ partKey: key, itemKey: item.key, styleKey: item.defaultStyleKey });
  });
  assertMakerV8Document(document, { mode: 'draft' });
  return document;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function uniqueKey(preferred, rows) {
  const used = new Set(rows.map((row) => row.key));
  let key = preferred.slice(0, 128);
  for (let suffix = 2; used.has(key); suffix += 1) {
    const tail = `-${suffix}`;
    key = `${preferred.slice(0, 128 - tail.length)}${tail}`;
  }
  return key;
}

function appendOrder(rows, field) {
  const order = Math.max(-1, ...rows.map((row) => row[field])) + 1;
  if (!Number.isSafeInteger(order)) fail('MAKER_V8_CREATOR_ORDER_INVALID', 'No append position is available.');
  return order;
}

function createTrack(document, part) {
  const track = {
    key: uniqueKey(`${part.key}-track`, document.tracks), label: part.label,
    renderOrder: appendOrder(document.tracks, 'renderOrder'), locked: false,
  };
  document.tracks.push(track);
  return track.key;
}

function defaultStyle(item) {
  return item?.styles.find((style) => style.key === item.defaultStyleKey) || item?.styles[0];
}

function partTrack(document, part) {
  const defaultItemKey = document.defaultRecipe.selections.find((row) => row.partKey === part.key)?.itemKey;
  const item = part.items.find((row) => row.key === defaultItemKey) || part.items[0];
  return defaultStyle(item)?.trackKey || part.items.flatMap((row) => row.styles).find((row) => row.trackKey)?.trackKey;
}

function createStyle(item, trackKey, initial = false) {
  const label = initial ? 'Default Style' : `Style ${item.styles.length + 1}`;
  return {
    key: uniqueKey(initial ? 'default-style' : `style-${item.styles.length + 1}`, item.styles),
    label, displayOrder: appendOrder(item.styles, 'displayOrder'), trackKey,
    colorChannelKey: null, defaultSwatchKey: null, assetId: null, protected: false,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    opacity: 1, blendMode: 'normal', physical: null, payload: {},
  };
}

function createItem(part, trackKey, initial = false) {
  const item = {
    key: uniqueKey(initial ? 'default' : `item-${part.items.length + 1}`, part.items),
    label: initial ? 'Default' : `Item ${part.items.length + 1}`,
    status: 'PUBLIC', displayOrder: appendOrder(part.items, 'displayOrder'),
    defaultStyleKey: 'default-style', styles: [], payload: {},
  };
  item.styles.push(createStyle(item, trackKey, true));
  return item;
}

function selectionFor(document, selection = {}) {
  const selectedPart = document.parts.find((row) => row.key === selection.partKey);
  const part = selectedPart || document.parts[0];
  const preferred = document.defaultRecipe.selections.find((row) => row.partKey === part?.key);
  const selectedItem = selectedPart?.items.find((row) => row.key === selection.itemKey);
  const item = selectedItem
    || part?.items.find((row) => row.key === preferred?.itemKey) || part?.items[0];
  const style = selectedItem?.styles.find((row) => row.key === selection.styleKey) || defaultStyle(item);
  return { partKey: part?.key || '', itemKey: item?.key || '', styleKey: style?.key || '' };
}

function copyLabel(label) {
  return `${label.slice(0, 251)} Copy`;
}

function localSelector(selector) {
  return selector.source === 'BASE' || selector.source === 'ANY';
}

function containsSelector(selector, { partKey, itemKey, styleKey }) {
  return selector.partKey === partKey
    && (!itemKey || localSelector(selector) && selector.itemKey === itemKey)
    && (!styleKey || selector.styleKey === styleKey);
}

// Match the original Creator's reference repair: removed leaves disappear,
// empty subtrees become always-visible, surviving predicates keep their order.
function pruneVisibility(condition, scope) {
  if (condition == null) return condition;
  if (condition.op === 'selected') return containsSelector(condition, scope) ? null : condition;
  if (condition.op === 'not') {
    const child = pruneVisibility(condition.condition, scope);
    return child === null ? null : { ...condition, condition: child };
  }
  const conditions = condition.conditions.map(child => pruneVisibility(child, scope)).filter(child => child !== null);
  return conditions.length ? { ...condition, conditions } : null;
}

function copyStructure(document, action, sourcePart, sourceItem, sourceStyle) {
  const copiesPart = action === 'copy-part';
  const copiesItem = action === 'copy-item';
  const source = copiesPart ? sourcePart : copiesItem ? sourceItem : sourceStyle;
  const siblings = copiesPart ? document.parts : copiesItem ? sourcePart.items : sourceItem.styles;
  const copy = structuredClone(source);
  copy.key = uniqueKey(`${source.key}-copy`, siblings);
  copy.label = copyLabel(source.label);
  for (const field of copiesPart ? ['renderOrder', 'menuOrder'] : ['displayOrder']) copy[field] = appendOrder(siblings, field);
  const itemKeys = new Map();
  const styleKeys = new Map();
  const copiedItems = copiesPart ? copy.items : copiesItem ? [copy] : [];
  const originalItems = copiesPart ? sourcePart.items : copiesItem ? [sourceItem] : [];
  copiedItems.forEach((item, index) => {
    const original = originalItems[index];
    if (copiesPart) item.key = uniqueKey(`${original.key}-copy`, [...sourcePart.items, ...copiedItems.slice(0, index)]);
    itemKeys.set(original.key, item.key);
    item.styles.forEach((style, styleIndex) => {
      const originalStyle = original.styles[styleIndex];
      style.key = uniqueKey(`${originalStyle.key}-copy`, [...original.styles, ...item.styles.slice(0, styleIndex)]);
      styleKeys.set(`${original.key}/${originalStyle.key}`, style.key);
    });
    item.defaultStyleKey = original.defaultStyleKey === null ? null : styleKeys.get(`${original.key}/${original.defaultStyleKey}`);
  });
  if (!copiesPart && !copiesItem) styleKeys.set(`${sourceItem.key}/${sourceStyle.key}`, copy.key);

  if (copiesPart) {
    const trackKeys = new Map();
    for (const trackKey of new Set(sourcePart.items.flatMap((item) => item.styles.map((style) => style.trackKey)))) {
      if (trackKey === null) continue;
      const track = document.tracks.find((row) => row.key === trackKey);
      const clonedTrack = { ...structuredClone(track), key: uniqueKey(`${track.key}-copy`, document.tracks),
        label: copyLabel(track.label), renderOrder: appendOrder(document.tracks, 'renderOrder') };
      document.tracks.push(clonedTrack);
      trackKeys.set(trackKey, clonedTrack.key);
    }
    copy.items.forEach((item) => item.styles.forEach((style) => { style.trackKey = style.trackKey === null ? null : trackKeys.get(style.trackKey); }));
  }

  const scope = { partKey: sourcePart.key, itemKey: copiesPart ? null : sourceItem.key,
    styleKey: copiesPart || copiesItem ? null : sourceStyle.key };
  const rewrite = (selector) => {
    if (!containsSelector(selector, scope)) return structuredClone(selector);
    return { ...selector, partKey: copiesPart ? copy.key : selector.partKey,
      itemKey: localSelector(selector) ? itemKeys.get(selector.itemKey) || selector.itemKey : selector.itemKey,
      styleKey: localSelector(selector) ? styleKeys.get(`${selector.itemKey}/${selector.styleKey}`) || selector.styleKey : selector.styleKey };
  };
  // Rules belong to their trigger. Incoming rules on other definitions retain
  // their authored meaning; only the copied owners get independent rule rows.
  for (const rule of [...document.rules]) {
    if (!containsSelector(rule.trigger, scope)) continue;
    document.rules.push({ ...structuredClone(rule), key: uniqueKey(`${rule.key}-copy`, document.rules),
      trigger: rewrite(rule.trigger), targets: rule.targets.map(rewrite) });
  }
  siblings.push(copy);
  if (copiesPart) {
    const defaults = document.defaultRecipe.selections.filter((row) => row.partKey === sourcePart.key);
    document.defaultRecipe.selections.push(...defaults.map((row) => ({ partKey: copy.key,
      itemKey: itemKeys.get(row.itemKey), styleKey: styleKeys.get(`${row.itemKey}/${row.styleKey}`) })));
  }
  return selectionFor(document, { partKey: copiesPart ? copy.key : sourcePart.key,
    itemKey: copiesPart ? undefined : copiesItem ? copy.key : sourceItem.key,
    styleKey: copiesPart || copiesItem ? undefined : copy.key });
}

function deleteStructure(document, action, part, item, style, selection, styleLockedKeys) {
  const scope = { partKey: part.key, itemKey: action === 'delete-part' ? null : item.key,
    styleKey: action === 'delete-style' ? style.key : null };
  const removedStyles = action === 'delete-part' ? part.items.flatMap((row) => row.styles.map((entry) => ({ itemKey: row.key, style: entry })))
    : action === 'delete-item' ? item.styles.map((entry) => ({ itemKey: item.key, style: entry }))
      : [{ itemKey: item.key, style }];
  const locks = new Set(styleLockedKeys);
  if (removedStyles.some((row) => locks.has(`${part.key}/${row.itemKey}/${row.style.key}`)
    || row.style.payload?.animacraftEditor?.styleLocked === true)) {
    fail('MAKER_V8_CREATOR_STYLE_LOCKED', 'Unlock the affected Styles before deleting.');
  }
  for (const targetPart of document.parts) for (const targetItem of targetPart.items) for (const targetStyle of targetItem.styles) {
    if (targetStyle.visibleWhen == null) continue;
    const next = pruneVisibility(targetStyle.visibleWhen, scope);
    if (JSON.stringify(next) === JSON.stringify(targetStyle.visibleWhen)) continue;
    if (locks.has(`${targetPart.key}/${targetItem.key}/${targetStyle.key}`)
      || targetStyle.payload?.animacraftEditor?.styleLocked === true) {
      fail('MAKER_V8_CREATOR_STYLE_LOCKED', 'Unlock Styles whose visibility references this definition before deleting.');
    }
    targetStyle.visibleWhen = next;
  }
  if (action === 'delete-part') document.parts = document.parts.filter((row) => row.key !== part.key);
  else if (action === 'delete-item') part.items = part.items.filter((row) => row.key !== item.key);
  else {
    item.styles = item.styles.filter((row) => row.key !== style.key);
    if (item.defaultStyleKey === style.key) item.defaultStyleKey = item.styles[0]?.key || null;
  }
  document.rules = document.rules.flatMap((rule) => {
    if (containsSelector(rule.trigger, scope)) return [];
    const targets = rule.targets.filter((target) => !containsSelector(target, scope));
    return targets.length ? [{ ...rule, targets }] : [];
  });

  document.defaultRecipe.selections = document.defaultRecipe.selections.flatMap((row) => {
    if (row.partKey !== scope.partKey || scope.itemKey && row.itemKey !== scope.itemKey
      || scope.styleKey && row.styleKey !== scope.styleKey) return [row];
    if (action === 'delete-part') return [];
    const survivingItem = part.items.find((entry) => entry.key === row.itemKey);
    const survivingStyle = defaultStyle(survivingItem);
    return survivingStyle ? [{ ...row, styleKey: survivingStyle.key }] : [];
  });
  if (action !== 'delete-part' && part.required
    && !document.defaultRecipe.selections.some((row) => row.partKey === part.key)) {
    const replacement = part.items.find((row) => row.status === 'PUBLIC' && row.styles.length);
    if (replacement) document.defaultRecipe.selections.push({ partKey: part.key,
      itemKey: replacement.key, styleKey: defaultStyle(replacement).key });
  }
  const candidateTracks = new Set(removedStyles.map((row) => row.style.trackKey));
  const usedTracks = new Set(document.parts.flatMap((row) => row.items.flatMap((entry) => entry.styles.map((s) => s.trackKey))));
  document.tracks = document.tracks.filter((track) => !candidateTracks.has(track.key) || usedTracks.has(track.key) || track.locked);
  // Payloads are open author data. Preserve every exact asset reference there,
  // as well as cover, rights evidence, and shared Style references.
  const references = new Set();
  const collect = (value) => {
    if (typeof value === 'string') references.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  Object.entries(document).forEach(([key, value]) => { if (key !== 'assets') collect(value); });
  document.assets = document.assets.filter((asset) => references.has(asset.id));
  return selectionFor(document, selection);
}

/** Pure draft preparation; selection belongs to the editor, while existing
 * default recipe choices remain unchanged when adding alternatives. */
export function prepareCreatorStructure({ document, action, partKey, itemKey, styleKey,
  selection = { partKey, itemKey, styleKey }, styleLockedKeys = [] }) {
  assertMakerV8Document(document, { mode: 'draft' });
  if (!['add-part', 'add-item', 'add-style', 'copy-part', 'copy-item', 'copy-style',
    'delete-part', 'delete-item', 'delete-style'].includes(action)) {
    fail('MAKER_V8_CREATOR_STRUCTURE_ACTION_INVALID', 'Unknown Creator structure action.');
  }
  const next = structuredClone(document);
  let part = next.parts.find((row) => row.key === partKey);
  let item;
  let style;
  if (action.startsWith('copy-') || action.startsWith('delete-')) {
    if (!part) fail('MAKER_V8_CREATOR_PART_NOT_FOUND', 'Select an existing Part first.');
    item = part.items.find((row) => row.key === itemKey);
    if (!action.endsWith('-part') && !item) fail('MAKER_V8_CREATOR_ITEM_NOT_FOUND', 'Select an existing Item first.');
    style = item?.styles.find((row) => row.key === styleKey);
    if (action.endsWith('-style') && !style) fail('MAKER_V8_CREATOR_STYLE_NOT_FOUND', 'Select an existing Style first.');
    const nextSelection = action.startsWith('copy-') ? copyStructure(next, action, part, item, style)
      : deleteStructure(next, action, part, item, style, selection, styleLockedKeys);
    assertMakerV8Document(next, { mode: 'draft' });
    return { document: next, selection: nextSelection };
  }
  if (action === 'add-part') {
    part = {
      key: uniqueKey(`part-${next.parts.length + 1}`, next.parts),
      label: `Part ${next.parts.length + 1}`, kind: 'STANDARD',
      renderOrder: appendOrder(next.parts, 'renderOrder'),
      menuOrder: appendOrder(next.parts, 'menuOrder'), visible: true, required: false,
      wardrobeMode: 'FIXED', capacity: 1, items: [], payload: {},
    };
    item = createItem(part, createTrack(next, part), true);
    part.items.push(item);
    next.parts.push(part);
    next.defaultRecipe.selections.push({ partKey: part.key, itemKey: item.key, styleKey: item.defaultStyleKey });
  } else {
    if (!part) fail('MAKER_V8_CREATOR_PART_NOT_FOUND', 'Select an existing Part first.');
    if (action === 'add-item') {
      item = createItem(part, partTrack(next, part) || createTrack(next, part));
      part.items.push(item);
      if ((part.items.length === 1 || part.required) && !next.defaultRecipe.selections.some((row) => row.partKey === part.key)) {
        next.defaultRecipe.selections.push({ partKey: part.key, itemKey: item.key, styleKey: item.defaultStyleKey });
      }
    } else {
      item = part.items.find((row) => row.key === itemKey);
      if (!item) fail('MAKER_V8_CREATOR_ITEM_NOT_FOUND', 'Select an existing Item first.');
      const trackKey = defaultStyle(item)?.trackKey || partTrack(next, part) || createTrack(next, part);
      style = createStyle(item, trackKey);
      item.styles.push(style);
      if (item.defaultStyleKey === null) item.defaultStyleKey = style.key;
      if (part.required && !next.defaultRecipe.selections.some((row) => row.partKey === part.key) && item.status === 'PUBLIC') {
        next.defaultRecipe.selections.push({ partKey: part.key, itemKey: item.key, styleKey: style.key });
      }
    }
  }
  style ||= defaultStyle(item);
  assertMakerV8Document(next, { mode: 'draft' });
  return { document: next, selection: { partKey: part.key, itemKey: item.key, styleKey: style.key } };
}
