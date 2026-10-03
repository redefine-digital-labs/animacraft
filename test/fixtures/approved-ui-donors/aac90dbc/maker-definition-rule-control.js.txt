/**
 * Host-neutral renderer for the compact Combination Rules control used by
 * Maker Studio inspectors. Expansion Pack Studio uses the same DOM contract
 * while supplying a namespaced action so the two event adapters stay apart.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderDefinitionCombinationRuleControl({
  definition = '',
  ownerType = '',
  count = 0,
  title = 'Combination Rules',
  countLabel = `${Number(count) || 0} rule(s)`,
  actionLabel = Number(count) > 0 ? 'Edit Rules' : 'Add Rule',
  action = 'edit-selection-rules',
  disabled = false,
  readonly = false,
  disabledLabel = '',
} = {}) {
  const renderedActionLabel = (disabled || readonly) && String(disabledLabel || '').trim()
    ? String(disabledLabel).trim()
    : actionLabel;
  return `
    <div class="v4-object-rule-entry" data-shared-definition-rule-control data-rule-owner-type="${escapeHtml(ownerType)}"${readonly ? ' data-rule-readonly="true"' : ''}>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(countLabel)}</small></span>
      <button type="button" data-action="${escapeHtml(action)}" data-rule-owner="${escapeHtml(definition)}" data-rule-owner-type="${escapeHtml(ownerType)}" ${disabled || readonly ? 'disabled' : ''}>${escapeHtml(renderedActionLabel)}</button>
    </div>
  `;
}

function safeAction(value) {
  const action = String(value || '').trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(action) ? action : '';
}

function dataAttributes(values = {}) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ` data-${String(key).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}="${escapeHtml(value)}"`)
    .join('');
}

/**
 * Shared Part -> Item -> Style checkbox tree used by both rule hosts.
 * Hosts keep their own commands and pass namespaced action/data attributes.
 */
export function renderSharedRuleTargetTree({
  groups = [],
  kind = '',
  emptyHtml = '',
  tailHtml = '',
} = {}) {
  const renderedGroups = groups.map((group) => {
    const records = Array.isArray(group?.records) ? group.records : [];
    return `
      <details class="v4-rule-target-group" data-rule-target-group${group?.open ? ' open' : ''}>
        <summary><strong>${escapeHtml(group?.label)}</strong><span>${escapeHtml(group?.meta)}</span></summary>
        ${records.map((record) => {
          const action = safeAction(record?.action);
          const disabledReason = String(record?.disabledReason || '').trim();
          return `<label class="${escapeHtml(record?.kind || '')} ${record?.disabled ? 'disabled' : ''}" data-rule-search-record="${escapeHtml(record?.searchText || record?.label || '')}"${disabledReason ? ` title="${escapeHtml(disabledReason)}"` : ''}>
            <input type="checkbox"${action ? ` data-action="${escapeHtml(action)}"` : ''}${dataAttributes(record?.data)} value="${escapeHtml(record?.value)}" ${record?.checked ? 'checked' : ''} ${record?.disabled ? 'disabled' : ''} />
            <span><strong>${escapeHtml(record?.label)}</strong><small>${escapeHtml(disabledReason || record?.detail || '')}</small></span>
          </label>`;
        }).join('')}
      </details>`;
  }).join('');
  return `<div class="v4-rule-target-tree" data-shared-rule-target-tree${kind ? ` data-rule-target-tree="${escapeHtml(kind)}"` : ''}>${renderedGroups || emptyHtml}${tailHtml}</div>`;
}

/**
 * Compact rule summaries shared by Maker Studio and Expansion Pack Studio.
 * This intentionally is a list, not a second set of inspector-sized cards.
 */
export function renderSharedRuleList({ groups = [], emptyHtml = '' } = {}) {
  const rows = groups.map((group) => {
    const targets = Array.isArray(group?.rows) ? group.rows : [];
    const editAction = safeAction(group?.editAction);
    return `
      <div class="v4-rule-summary-row" data-rule-summary-row${dataAttributes(group?.data)}>
        <div class="v4-rule-summary-owner"><span>${escapeHtml(group?.eyebrow)}</span><strong>${escapeHtml(group?.ownerLabel)}</strong></div>
        ${group?.badge ? `<b>${escapeHtml(group.badge)}</b>` : ''}
        <div class="v4-rule-summary-targets">
          ${targets.map((row) => {
            const deleteAction = safeAction(row?.deleteAction);
            return `<span${row?.advanced ? ' data-rule-advanced="true"' : ''}>${row?.typeLabel ? `<em>${escapeHtml(row.typeLabel)}</em>` : ''}${row?.any ? `<em>${escapeHtml(row.anyLabel || 'ANY')}</em>` : ''}<strong>${escapeHtml(row?.targetLabel)}</strong>${deleteAction ? `<button type="button" data-action="${escapeHtml(deleteAction)}"${dataAttributes(row?.data)} aria-label="${escapeHtml(row?.deleteLabel || 'Delete rule')}" ${row?.deleteDisabled ? 'disabled' : ''}>×</button>` : ''}</span>`;
          }).join('')}
        </div>
        ${editAction ? `<button type="button" class="v4-rule-summary-edit" data-action="${escapeHtml(editAction)}"${dataAttributes(group?.editData)} ${group?.editDisabled ? 'disabled' : ''}>${escapeHtml(group?.editLabel || 'Edit rules')}</button>` : ''}
      </div>`;
  }).join('');
  return `<div class="v4-rule-list" data-shared-rule-list>${rows || emptyHtml}</div>`;
}

/** One host-neutral shell for the rule builder and its compact result list. */
export function renderSharedRuleListEditor({
  builderHtml = '',
  groups = [],
  emptyHtml = '',
  attributes = {},
} = {}) {
  return `<section class="v4-shared-rule-editor" data-shared-rule-editor${dataAttributes(attributes)}>${builderHtml ? `<div class="v4-shared-rule-builder-slot">${builderHtml}</div>` : ''}${renderSharedRuleList({ groups, emptyHtml })}</section>`;
}
