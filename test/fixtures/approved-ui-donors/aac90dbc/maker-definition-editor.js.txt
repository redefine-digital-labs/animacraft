/**
 * Shared Maker definition-editor sections.
 *
 * Maker Studio and Expansion Pack Studio intentionally consume this same
 * registry so Part / Item / Style structure, Layer Tracks, Smart Color,
 * combination rules and wardrobe policies keep one vocabulary and ordering.
 * Each host supplies its own permission adapter: a Maker may edit the whole
 * document, while a Pack may only edit its additive overlay.
 */

export const MAKER_DEFINITION_EDITOR_SECTION_IDS = Object.freeze({
  STRUCTURE: 'structure',
  LAYERS: 'layers',
  COLORS: 'colors',
  RULES: 'rules',
  WARDROBE: 'wardrobe',
});

const SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.STRUCTURE,
    labelKey: 'partsItems',
    makerRoute: 'structure',
    packRoute: 'structure',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.LAYERS,
    labelKey: 'layerTracks',
    makerRoute: 'layers',
    packRoute: 'layers',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.COLORS,
    labelKey: 'smartColor',
    makerRoute: 'colors',
    packRoute: 'colors',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.RULES,
    labelKey: 'rules',
    makerRoute: 'rules',
    packRoute: 'rules',
  }),
  Object.freeze({
    id: MAKER_DEFINITION_EDITOR_SECTION_IDS.WARDROBE,
    labelKey: 'composableItems',
    makerRoute: 'composable',
    packRoute: 'wardrobe',
  }),
]);

export const MAKER_DEFINITION_EDITOR_SECTIONS = SECTION_DEFINITIONS;

export function normalizeMakerDefinitionEditorSection(value, fallback = 'structure') {
  const candidate = String(value || '').trim();
  if (SECTION_DEFINITIONS.some((section) => section.id === candidate)) return candidate;
  return SECTION_DEFINITIONS.some((section) => section.id === fallback)
    ? fallback
    : MAKER_DEFINITION_EDITOR_SECTION_IDS.STRUCTURE;
}

export function makerDefinitionEditorSections(translate = (key) => key, options = {}) {
  const scope = options.scope === 'pack' ? 'pack' : 'maker';
  const routeField = scope === 'pack' ? 'packRoute' : 'makerRoute';
  return SECTION_DEFINITIONS.map((section) => Object.freeze({
    id: section.id,
    route: section[routeField],
    labelKey: section.labelKey,
    label: String(translate(section.labelKey) || section.labelKey),
  }));
}

/**
 * Shared Creator / Expansion Pack Part-list view model.
 *
 * Hosts own document mutations and provide their delegated action names. The
 * renderer only emits the common list contract, which keeps a Pack adapter
 * from accidentally invoking Maker actions when both editors share a root.
 */

const PART_LIST_ACTIONS = Object.freeze({
  select: 'select-part',
  preview: 'toggle-part-preview',
  slot: '',
  move: 'move-part',
  duplicate: 'copy-part',
  delete: 'delete-part',
});

const PART_LIST_CAPABILITIES = Object.freeze({
  select: true,
  preview: true,
  slot: false,
  moveUp: true,
  moveDown: true,
  duplicate: true,
  delete: true,
});

function partListText(value) {
  return String(value ?? '').trim();
}

function partListEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizePartListImageUrl(value) {
  const source = partListText(value);
  if (!source) return '';
  if (source.startsWith('blob:')) return source;
  try {
    const url = new URL(source, 'https://animacraft.soulidity.ai');
    return ['http:', 'https:'].includes(url.protocol) ? source : '';
  } catch {
    return '';
  }
}

function normalizePartListAction(value, fallback = '') {
  const action = partListText(value || fallback);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(action) ? action : '';
}

function normalizePartListRow(record, index, selectedId, defaultActions) {
  const id = partListText(record?.id);
  if (!id) throw new TypeError(`Part-list row ${index + 1} requires an id.`);
  const name = partListText(record?.name) || id;
  const readonly = record?.readonly === true;
  const actions = {};
  Object.keys(PART_LIST_ACTIONS).forEach((key) => {
    actions[key] = record?.actions && Object.hasOwn(record.actions, key)
      ? normalizePartListAction(record.actions[key])
      : defaultActions[key];
  });
  const requestedCapabilities = record?.capabilities || {};
  const capabilities = {};
  Object.keys(PART_LIST_CAPABILITIES).forEach((key) => {
    const defaultValue = readonly && ['moveUp', 'moveDown', 'duplicate', 'delete', 'slot'].includes(key)
      ? false
      : PART_LIST_CAPABILITIES[key];
    capabilities[key] = requestedCapabilities[key] === undefined
      ? defaultValue
      : requestedCapabilities[key] === true;
  });
  const slot = record?.slot && typeof record.slot === 'object' ? {
    active: record.slot.active === true,
    action: normalizePartListAction(record.slot.action, actions.slot),
    mode: partListText(record.slot.mode),
    disabled: record.slot.disabled === true || !capabilities.slot,
    label: partListText(record.slot.label),
  } : null;
  return Object.freeze({
    id,
    name,
    thumbnailUrl: normalizePartListImageUrl(record?.thumbnailUrl),
    thumbnailText: partListText(record?.thumbnailText) || name.slice(0, 2).toUpperCase(),
    itemCount: Math.max(0, Number(record?.itemCount) || 0),
    required: record?.required === true,
    trackLabel: partListText(record?.trackLabel),
    trackMode: ['linked', 'custom', 'unassigned'].includes(record?.trackMode)
      ? record.trackMode
      : 'unassigned',
    selected: id === selectedId,
    hidden: record?.hidden === true,
    readonly,
    draggable: record?.draggable !== false && !readonly,
    disabled: record?.disabled === true,
    actions: Object.freeze(actions),
    capabilities: Object.freeze(capabilities),
    slot: slot ? Object.freeze(slot) : null,
  });
}

export function createMakerPartListModel(records = [], options = {}) {
  const rows = Array.isArray(records) ? records : [];
  const selectedId = partListText(options.selectedId);
  const actions = {};
  Object.keys(PART_LIST_ACTIONS).forEach((key) => {
    actions[key] = options.actions && Object.hasOwn(options.actions, key)
      ? normalizePartListAction(options.actions[key])
      : PART_LIST_ACTIONS[key];
  });
  const normalizedRows = rows.map((record, index) => (
    normalizePartListRow(record, index, selectedId, actions)
  ));
  const selectedRow = normalizedRows.find((row) => row.selected) || null;
  return Object.freeze({
    rows: Object.freeze(normalizedRows),
    selectedId: selectedRow?.id || '',
    selectedRow,
    listLabel: partListText(options.listLabel) || 'Parts',
    actionBarLabel: partListText(options.actionBarLabel) || 'Selected Part actions',
    emptyLabel: partListText(options.emptyLabel) || 'No Parts yet.',
    actions: Object.freeze(actions),
  });
}

function partListButton({
  action,
  partId,
  className = '',
  label,
  content,
  disabled = false,
  attributes = '',
}) {
  if (!action) return '';
  return `<button class="${partListEscape(className)}" type="button" data-action="${partListEscape(action)}" data-part-id="${partListEscape(partId)}"${attributes} aria-label="${partListEscape(label)}" title="${partListEscape(label)}"${disabled ? ' disabled' : ''}>${content}</button>`;
}

export function renderMakerPartList(modelValue, copy = {}) {
  const model = modelValue?.rows ? modelValue : createMakerPartListModel(modelValue);
  const itemCount = (count) => partListText(copy.itemCount)?.replaceAll('{count}', String(count))
    || `${count} Item${count === 1 ? '' : 's'}`;
  const required = partListText(copy.required) || 'Required';
  const optional = partListText(copy.optional) || 'Optional';
  const readonly = partListText(copy.readonly) || 'Read only';
  const selectLabel = (name) => (partListText(copy.selectPart)?.replaceAll('{part}', name) || `Select ${name}`);
  const selectedLabel = (name) => (partListText(copy.selectedPart)?.replaceAll('{part}', name) || `${name}, selected`);
  const rows = model.rows.map((row, index) => {
    const metadataId = `makerPartMeta-${index + 1}-${row.id.replace(/[^a-z0-9_-]+/gi, '-')}`;
    const mainDisabled = row.disabled || !row.capabilities.select || !row.actions.select;
    const selectAction = row.actions.select || model.actions.select;
    const previewLabel = row.hidden
      ? partListText(copy.showPreview)?.replaceAll('{part}', row.name) || `Show ${row.name} in preview`
      : partListText(copy.hidePreview)?.replaceAll('{part}', row.name) || `Hide ${row.name} in preview`;
    const metadata = [
      itemCount(row.itemCount),
      row.required ? required : optional,
      row.readonly ? readonly : '',
      row.trackLabel,
    ].filter(Boolean).join(' · ');
    const thumbnail = row.thumbnailUrl
      ? `<img src="${partListEscape(row.thumbnailUrl)}" alt="" loading="lazy" />`
      : partListEscape(row.thumbnailText);
    const preview = row.capabilities.preview
      ? partListButton({
        action: row.actions.preview || model.actions.preview,
        partId: row.id,
        className: `v4-part-eye ${row.hidden ? '' : 'active '}maker-part-list-eye`,
        label: previewLabel,
        content: `<span aria-hidden="true">${row.hidden ? '◎' : '◉'}</span>`,
        disabled: row.disabled,
        attributes: ` aria-pressed="${!row.hidden}"`,
      })
      : '';
    const slot = row.slot && row.capabilities.slot ? partListButton({
      action: row.slot.action || row.actions.slot || model.actions.slot,
      partId: row.id,
      className: `v4-part-slot ${row.slot.active ? 'active ' : ''}maker-part-list-slot`,
      label: row.slot.label || `${row.name} slot`,
      content: '<span aria-hidden="true">▦</span>',
      disabled: row.disabled || row.slot.disabled,
      attributes: `${row.slot.mode ? ` data-mode="${partListEscape(row.slot.mode)}"` : ''} aria-pressed="${row.slot.active}"`,
    }) : '';
    return `<article class="maker-part-list-entry v4-record-entry v4-part-entry ${row.selected ? 'active' : ''} ${row.hidden ? 'preview-hidden' : ''} ${row.trackMode === 'linked' ? 'linked-track' : 'custom-track'} ${row.readonly ? 'readonly' : ''}" role="listitem" data-part-row data-part-id="${partListEscape(row.id)}"${row.draggable ? ' draggable="true" data-drag-kind="part"' : ''} data-drag-id="${partListEscape(row.id)}">
      <div class="maker-part-list-row v4-part-row ${row.selected ? 'active' : ''}">
        <span class="maker-part-list-drag v4-part-drag" aria-hidden="true">${row.draggable ? '⋮⋮' : '—'}<b>${String(index + 1).padStart(2, '0')}</b></span>
        <span class="maker-part-list-thumb v4-part-icon">${thumbnail}</span>
        <button class="maker-part-list-select v4-part-select" type="button" data-action="${partListEscape(selectAction)}" data-part-id="${partListEscape(row.id)}" aria-label="${partListEscape(row.selected ? selectedLabel(row.name) : selectLabel(row.name))}" aria-describedby="${partListEscape(metadataId)}" aria-current="${row.selected ? 'true' : 'false'}"${mainDisabled ? ' disabled' : ''}><strong>${partListEscape(row.name)}</strong></button>
        <div class="maker-part-list-state v4-part-state-actions" role="group" aria-label="${partListEscape(partListText(copy.stateActions)?.replaceAll('{part}', row.name) || `${row.name} visibility and slot`)}">${preview}${slot}</div>
        <small id="${partListEscape(metadataId)}" class="maker-part-list-meta v4-part-track-status">${partListEscape(metadata)}</small>
      </div>
    </article>`;
  }).join('');
  const row = model.selectedRow;
  const actionBarButtons = row ? [
    partListButton({ action: row.actions.move, partId: row.id, className: 'maker-part-list-move v4-part-order', label: partListText(copy.moveUp) || 'Move Part up', content: '<span aria-hidden="true">↑</span>', disabled: row.disabled || !row.capabilities.moveUp, attributes: ' data-direction="up"' }),
    partListButton({ action: row.actions.move, partId: row.id, className: 'maker-part-list-move v4-part-order', label: partListText(copy.moveDown) || 'Move Part down', content: '<span aria-hidden="true">↓</span>', disabled: row.disabled || !row.capabilities.moveDown, attributes: ' data-direction="down"' }),
    partListButton({ action: row.actions.duplicate, partId: row.id, className: 'maker-part-list-duplicate', label: partListText(copy.duplicate) || 'Duplicate', content: partListEscape(partListText(copy.duplicate) || 'Duplicate'), disabled: row.disabled || !row.capabilities.duplicate }),
    partListButton({ action: row.actions.delete, partId: row.id, className: 'maker-part-list-delete danger', label: partListText(copy.delete) || 'Delete', content: partListEscape(partListText(copy.delete) || 'Delete'), disabled: row.disabled || !row.capabilities.delete }),
  ].filter(Boolean).join('') : '';
  const actionBar = row && actionBarButtons ? `<div class="maker-part-list-actions" data-part-actions data-part-id="${partListEscape(row.id)}" role="toolbar" aria-label="${partListEscape(model.actionBarLabel)}">${actionBarButtons}</div>` : '';
  return `<div class="maker-part-list v4-parts-list" data-part-list role="list" aria-label="${partListEscape(model.listLabel)}">${rows || `<div class="v4-inline-empty"><span>${partListEscape(model.emptyLabel)}</span></div>`}</div>${actionBar}`;
}
