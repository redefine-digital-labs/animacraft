import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_WORKSPACE_KEYS,
  MAKER_WORKSPACE_LOCALES,
  makerWorkspaceDictionary,
  makerWorkspaceText,
} from '../maker-workspace-i18n.js';

test('Maker Studio core controls have English, Chinese, Japanese, Korean and Vietnamese labels', () => {
  const locales = ['en', 'zh', 'ja', 'ko', 'vi'];
  const keys = ['partsItems', 'layerTracks', 'smartColor', 'rules', 'expansionPacks', 'preflightCount', 'playerTest', 'publishMainnet'];

  locales.forEach((locale) => {
    keys.forEach((key) => {
      const value = makerWorkspaceText(locale, key, { count: 8 });
      assert.ok(value && value !== key, `${locale}.${key} must be translated`);
      assert.doesNotMatch(value, /\{count\}/);
    });
  });
});

test('unknown Maker Studio locales and keys fall back safely', () => {
  assert.equal(makerWorkspaceText('unknown', 'save'), 'Save');
  assert.equal(makerWorkspaceText('zh', 'unknownKey'), 'unknownKey');
});

test('all 5 Maker Studio dictionaries cover every editor and player detail key', () => {
  const variables = {
    count: 3,
    items: 2,
    styles: 4,
    layers: 5,
    part: 'Hair',
    item: 'Long hair',
    creator: 'Artist',
    version: 'v2',
    name: 'Sample',
    breaking: 1,
    warnings: 2,
    additions: 3,
    parts: 2,
    assets: 8,
    drawn: 6,
    skipped: 2,
  };

  assert.deepEqual(MAKER_WORKSPACE_LOCALES, ['en', 'zh', 'ja', 'ko', 'vi']);
  assert.ok(MAKER_WORKSPACE_KEYS.length >= 250, 'the detailed workspace dictionary must stay comprehensive');

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    assert.deepEqual(Object.keys(dictionary).sort(), [...MAKER_WORKSPACE_KEYS].sort(), `${locale} must have exact key parity`);
    MAKER_WORKSPACE_KEYS.forEach((key) => {
      assert.ok(Object.hasOwn(dictionary, key), `${locale}.${key} must be owned by that locale`);
      const value = makerWorkspaceText(locale, key, variables);
      assert.ok(value.trim(), `${locale}.${key} must not be blank`);
      assert.doesNotMatch(value, /\{(?:count|items|styles|layers|part|item|creator|version|name|breaking|warnings|additions|parts|assets|drawn|skipped)\}/, `${locale}.${key} must interpolate its variables`);
    });
  });
});

test('critical nested editor details do not fall back to English outside English', () => {
  const keys = [
    'noPartSelected',
    'uploadLayerPng',
    'blendMode',
    'batchImportTitle',
    'ownerScope',
    'compatibleUpdate',
    'infoLicense',
    'completeOc',
    'issueMissingReference',
  ];
  const english = makerWorkspaceDictionary('en');

  ['zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    keys.forEach((key) => assert.notEqual(dictionary[key], english[key], `${locale}.${key} must be localized`));
  });
});
