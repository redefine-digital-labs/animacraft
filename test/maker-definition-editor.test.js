import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_DEFINITION_EDITOR_SECTION_IDS,
  MAKER_DEFINITION_EDITOR_SECTIONS,
  createMakerPartListModel,
  makerDefinitionEditorSections,
  normalizeMakerDefinitionEditorSection,
  renderMakerPartList,
} from '../maker-definition-editor.js';

test('Maker and Expansion Pack editors share one ordered definition vocabulary', () => {
  assert.deepEqual(
    MAKER_DEFINITION_EDITOR_SECTIONS.map((section) => section.id),
    ['structure', 'layers', 'colors', 'rules', 'wardrobe'],
  );
  const maker = makerDefinitionEditorSections((key) => `maker:${key}`);
  const pack = makerDefinitionEditorSections((key) => `pack:${key}`, { scope: 'pack' });
  assert.deepEqual(maker.map((section) => section.id), pack.map((section) => section.id));
  assert.deepEqual(maker.map((section) => section.route), [
    'structure',
    'layers',
    'colors',
    'rules',
    'composable',
  ]);
  assert.deepEqual(pack.map((section) => section.route), [
    'structure',
    'layers',
    'colors',
    'rules',
    'wardrobe',
  ]);
  assert.equal(maker.at(-1).label, 'maker:composableItems');
  assert.equal(pack.at(-1).label, 'pack:composableItems');
});

test('definition editor section normalization is fail-closed', () => {
  assert.equal(
    normalizeMakerDefinitionEditorSection(MAKER_DEFINITION_EDITOR_SECTION_IDS.COLORS),
    'colors',
  );
  assert.equal(normalizeMakerDefinitionEditorSection('commerce'), 'structure');
  assert.equal(normalizeMakerDefinitionEditorSection('unknown', 'rules'), 'rules');
  assert.equal(normalizeMakerDefinitionEditorSection('unknown', 'also-unknown'), 'structure');
});

test('shared Part list renders one selected action bar and keeps full labels in row text', () => {
  const fullLabel = 'Back Hair With Ceremonial Ribbons';
  const model = createMakerPartListModel([
    {
      id: 'background',
      name: 'Background',
      itemCount: 2,
      required: false,
      trackLabel: 'Linked Track · Background',
      trackMode: 'linked',
      capabilities: { slot: true, moveUp: false },
      slot: {
        action: 'open-part-slot-settings',
        label: 'Open wardrobe settings for Background',
      },
    },
    {
      id: 'back-hair',
      name: fullLabel,
      itemCount: 7,
      required: true,
      trackLabel: 'Custom stacking · 2 Tracks',
      trackMode: 'custom',
      capabilities: { slot: true, moveDown: false },
      slot: {
        active: true,
        action: 'wardrobe-part-mode',
        mode: 'FIXED',
        label: 'Keep Back Hair fixed',
      },
    },
  ], {
    selectedId: 'back-hair',
    listLabel: 'Parts',
    actionBarLabel: 'Actions for selected Part',
  });
  const html = renderMakerPartList(model, {
    itemCount: '{count} items',
    required: 'Required',
    optional: 'Optional',
  });

  assert.equal(model.rows.length, 2);
  assert.equal(model.selectedRow.id, 'back-hair');
  assert.equal((html.match(/data-part-row/g) || []).length, 2);
  assert.equal((html.match(/data-part-actions/g) || []).length, 1);
  assert.match(html, new RegExp(`<strong>${fullLabel}<\\/strong>`));
  assert.match(html, /7 items · Required · Custom stacking · 2 Tracks/);
  assert.match(html, /data-part-actions data-part-id="back-hair" role="toolbar"/);
  assert.match(html, /data-action="move-part" data-part-id="back-hair"[^>]*data-direction="down"[^>]*disabled/);
  assert.doesNotMatch(html, /data-part-actions data-part-id="background"/);
  assert.doesNotMatch(html, /title="Back Hair With Ceremonial Ribbons"/);
});

test('shared Part list adapter isolates inherited readonly and Pack-owned actions', () => {
  const model = createMakerPartListModel([
    {
      id: 'body',
      name: 'Inherited Body',
      itemCount: 3,
      required: true,
      readonly: true,
      draggable: false,
      actions: {
        select: 'select-pack-part',
        preview: '',
        move: '',
        duplicate: '',
        delete: '',
      },
      capabilities: { preview: false },
    },
    {
      id: 'hat',
      name: 'Pack Hat',
      itemCount: 1,
      actions: {
        select: 'select-pack-part',
        preview: 'toggle-pack-part-preview',
        slot: 'set-pack-part-mode',
        move: 'move-pack-part',
        duplicate: 'duplicate-pack-part',
        delete: 'delete-pack-part',
      },
      capabilities: { slot: true },
      slot: {
        action: 'set-pack-part-mode',
        mode: 'SLOT',
        label: 'Make Pack Hat a wardrobe slot',
      },
    },
  ], {
    selectedId: 'hat',
    actions: {
      select: 'select-pack-part',
      preview: 'toggle-pack-part-preview',
      slot: 'set-pack-part-mode',
      move: 'move-pack-part',
      duplicate: 'duplicate-pack-part',
      delete: 'delete-pack-part',
    },
  });
  const html = renderMakerPartList(model, { readonly: 'Inherited · read only' });

  assert.equal(model.rows[0].readonly, true);
  assert.equal(model.rows[0].draggable, false);
  assert.equal(model.rows[0].capabilities.delete, false);
  assert.match(html, /Inherited Body/);
  assert.match(html, /Inherited · read only/);
  assert.match(html, /data-action="select-pack-part" data-part-id="body"/);
  assert.doesNotMatch(html, /data-action="select-part"/);
  assert.doesNotMatch(html, /data-action="move-part"/);
  assert.match(html, /data-action="move-pack-part" data-part-id="hat"/);
  assert.match(html, /data-action="duplicate-pack-part" data-part-id="hat"/);
  assert.match(html, /data-action="delete-pack-part" data-part-id="hat"/);
  assert.match(html, /data-action="set-pack-part-mode" data-part-id="hat"[^>]*data-mode="SLOT" aria-pressed="false"/);
  assert.doesNotMatch(html, /data-part-id="body" draggable=/);
});

test('shared Part list escapes content and rejects rows without stable ids', () => {
  assert.throws(
    () => createMakerPartListModel([{ name: 'Missing id' }]),
    /requires an id/,
  );
  const html = renderMakerPartList(createMakerPartListModel([{
    id: 'safe-id',
    name: '<img src=x onerror=alert(1)>',
    thumbnailUrl: 'javascript:alert(1)',
    trackLabel: '<script>bad</script>',
  }], { selectedId: 'safe-id' }));
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
});
