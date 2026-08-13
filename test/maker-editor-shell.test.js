import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMakerEditorShell } from '../maker-editor-shell.js';

test('host-neutral Maker shell owns one toolbar, tabs and three-column slot contract', () => {
  const html = renderMakerEditorShell({
    instanceId: 'pack alpha',
    idPrefix: 'packAlpha',
    workspaceId: 'packAlphaPanel',
    activeTab: 'structure',
    tabAction: 'select-pack-section',
    tabDataKey: 'section',
    tabs: [
      { id: 'structure', label: 'Structure' },
      { id: 'rules', label: 'Rules' },
    ],
    title: { eyebrow: 'Pack', contentHtml: '<strong>Alpha</strong>' },
    save: { phase: 'saved', dataPhase: 'saved', label: 'Saved' },
    actionsHtml: '<button>Save</button>',
    leftHtml: '<div data-slot="left"></div>',
    centerHtml: '<div data-slot="center"></div>',
    rightHtml: '<div data-slot="right"></div>',
  });

  assert.match(html, /data-maker-editor-shell="pack-alpha"/);
  assert.equal((html.match(/class="v4-studio-topbar"/g) || []).length, 1);
  assert.equal((html.match(/class="v4-studio-tabs"/g) || []).length, 1);
  assert.equal((html.match(/class="v4-studio-workspace"/g) || []).length, 1);
  assert.equal((html.match(/class="v4-parts-browser"/g) || []).length, 1);
  assert.equal((html.match(/class="v4-canvas-column"/g) || []).length, 1);
  assert.equal((html.match(/class="v4-inspector"/g) || []).length, 1);
  assert.match(html, /id="packAlphaTab-structure"/);
  assert.match(html, /data-section="structure"/);
  assert.match(html, /data-slot="left"/);
  assert.match(html, /data-slot="center"/);
  assert.match(html, /data-slot="right"/);
});

test('shared shell escapes labels and rejects unsafe delegated action tokens', () => {
  const html = renderMakerEditorShell({
    tabsLabel: '<Unsafe>',
    activeTab: 'rules',
    tabAction: 'bad action" onclick="oops',
    tabs: [{ id: 'rules', label: '<Rules>' }],
  });
  assert.match(html, /aria-label="&lt;Unsafe&gt;"/);
  assert.match(html, />&lt;Rules&gt;<\/button>/);
  assert.doesNotMatch(html, /data-action=/);
  assert.doesNotMatch(html, /onclick=/);
});
