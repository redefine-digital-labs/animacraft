import assert from 'node:assert/strict';
import test from 'node:test';

import { makerWorkspaceText } from '../maker-workspace-i18n.js';

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
