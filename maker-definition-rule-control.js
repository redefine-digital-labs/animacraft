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
} = {}) {
  return `
    <div class="v4-object-rule-entry" data-shared-definition-rule-control data-rule-owner-type="${escapeHtml(ownerType)}"${readonly ? ' data-rule-readonly="true"' : ''}>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(countLabel)}</small></span>
      <button type="button" data-action="${escapeHtml(action)}" data-rule-owner="${escapeHtml(definition)}" data-rule-owner-type="${escapeHtml(ownerType)}" ${disabled || readonly ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>
    </div>
  `;
}
