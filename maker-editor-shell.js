/**
 * Host-neutral Maker editor frame.
 *
 * Maker and Expansion Pack hosts own their state and delegated actions. This
 * renderer owns the canonical topbar, tab strip and Part / canvas / inspector
 * DOM so an additive editor cannot drift into a second studio layout.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function token(value, fallback) {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-');
  return normalized || fallback;
}

function actionToken(value) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(normalized) ? normalized : '';
}

function htmlSlot(value) {
  return typeof value === 'string' ? value : '';
}

export function renderMakerEditorShell(model = {}) {
  const instanceId = token(model.instanceId, 'maker-editor');
  const idPrefix = token(model.idPrefix, instanceId);
  const tabDataKey = token(model.tabDataKey, 'tab');
  const activeTab = String(model.activeTab || '');
  const tabs = Array.isArray(model.tabs) ? model.tabs : [];
  const tabMarkup = tabs.map((tab) => {
    const id = token(tab?.id, 'section');
    const selected = id === activeTab || tab?.selected === true;
    const action = actionToken(tab?.action || model.tabAction);
    const controls = token(tab?.controls, '');
    return `<button type="button" role="tab" id="${escapeHtml(idPrefix)}Tab-${escapeHtml(id)}" class="${selected ? 'active' : ''}"${action ? ` data-action="${escapeHtml(action)}"` : ''} data-${escapeHtml(tabDataKey)}="${escapeHtml(tab?.value ?? id)}" aria-selected="${selected}" aria-pressed="${selected}" tabindex="${selected ? '0' : '-1'}"${controls ? ` aria-controls="${escapeHtml(controls)}"` : ''}>${escapeHtml(tab?.label || id)}</button>`;
  }).join('');
  const save = model.save && typeof model.save === 'object' ? model.save : {};
  const title = model.title && typeof model.title === 'object' ? model.title : {};
  const shellClass = token(model.className, '');
  const workspaceId = token(model.workspaceId, `${idPrefix}ToolPanel`);
  return `
    <section class="v4-studio-shell${shellClass ? ` ${escapeHtml(shellClass)}` : ''}" data-maker-editor-shell="${escapeHtml(instanceId)}" ${htmlSlot(model.shellAttributes)}>
      <header class="v4-studio-topbar">
        <div class="v4-studio-title"><span class="v4-eyebrow">${escapeHtml(title.eyebrow || '')}</span><div>${htmlSlot(title.contentHtml)}</div></div>
        <div class="v4-save-indicator ${escapeHtml(save.phase || '')}"${save.dataPhase ? ` data-save-phase="${escapeHtml(save.dataPhase)}"` : ''} aria-live="polite"><i></i><span>${escapeHtml(save.label || '')}</span></div>
        <div class="v4-top-actions">${htmlSlot(model.actionsHtml)}</div>
      </header>
      ${htmlSlot(model.noticesHtml)}
      <nav class="v4-studio-tabs" role="tablist" aria-label="${escapeHtml(model.tabsLabel || 'Maker editor tools')}">${tabMarkup}</nav>
      <div id="${escapeHtml(workspaceId)}" class="v4-studio-workspace" ${htmlSlot(model.workspaceAttributes)}>
        <aside class="v4-parts-browser"${model.leftLabel ? ` aria-label="${escapeHtml(model.leftLabel)}"` : ''}>${htmlSlot(model.leftHtml)}</aside>
        <main class="v4-canvas-column">${htmlSlot(model.centerHtml)}</main>
        <aside class="v4-inspector"${model.rightLabel ? ` aria-label="${escapeHtml(model.rightLabel)}"` : ''}>${htmlSlot(model.rightHtml)}</aside>
      </div>
      ${htmlSlot(model.overlayHtml)}
      ${htmlSlot(model.footerHtml)}
    </section>
    ${htmlSlot(model.afterHtml)}`;
}
