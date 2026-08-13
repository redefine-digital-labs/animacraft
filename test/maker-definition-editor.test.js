import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_DEFINITION_EDITOR_SECTION_IDS,
  MAKER_DEFINITION_EDITOR_SECTIONS,
  makerDefinitionEditorSections,
  normalizeMakerDefinitionEditorSection,
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
