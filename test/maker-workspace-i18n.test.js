import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_WORKSPACE_KEYS,
  MAKER_WORKSPACE_LOCALES,
  makerWorkspaceDictionary,
  makerWorkspaceText,
} from '../maker-workspace-i18n.js';
import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { createMakerWorkspace } from '../maker-workspace.js';

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

test('Chinese editor terminology distinguishes Part 部位, Item 部件 and Style 样式', () => {
  assert.equal(makerWorkspaceText('zh', 'part'), '部位');
  assert.equal(makerWorkspaceText('zh', 'item'), '部件');
  assert.equal(makerWorkspaceText('zh', 'style'), '样式');
  assert.equal(makerWorkspaceText('zh', 'partsItems'), '部位与部件');
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
  assert.ok(!MAKER_WORKSPACE_KEYS.includes('separateAssets'));
  assert.ok(!MAKER_WORKSPACE_KEYS.includes('assetPerSwatchCopy'));

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

test('all five Maker Studio languages preserve every interpolation token', () => {
  const english = makerWorkspaceDictionary('en');
  const tokens = (value) => [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    MAKER_WORKSPACE_KEYS.forEach((key) => {
      assert.deepEqual(
        tokens(dictionary[key]),
        tokens(english[key]),
        `${locale}.${key} must preserve the English interpolation contract`,
      );
    });
  });
});

test('critical nested editor details do not fall back to English outside English', () => {
  const keys = [
    'noPartSelected',
    'noStylesYet',
    'addStyleCopy',
    'uploadStylePng',
    'replaceStylePng',
    'stylePngCopy',
    'positionLock',
    'styleLock',
    'hideStyle',
    'showPartPreview',
    'blendMode',
    'batchImportTitle',
    'ownerScope',
    'compatibleUpdate',
    'infoLicense',
    'activeOcColors',
    'expansionSelectionSaved',
    'ocDescription',
    'ocTags',
    'playerDraftSaving',
    'playerDraftSavedAt',
    'playerDraftSaveFailed',
    'playerRenderPending',
    'playerRenderBlocked',
    'playerOutputReady',
    'trackBindings',
    'noTrackBindings',
    'moveTrackBack',
    'moveTrackFront',
    'advancedVisibilityCondition',
    'advancedVisibilityPreserved',
    'publishMakerStep',
    'prepareQuilt',
    'registerAndUpload',
    'finishOcStep',
    'continueToSoulidity',
    'readyWithWarnings',
    'backToLibrary',
    'playerInvalidCombination',
    'playerRequiredPartMissing',
    'playerUnknownStyle',
    'playerMissingArtworkReference',
    'playerNoVisibleArtwork',
    'playerArtworkUnavailable',
    'playerCurrentOcRenderFailed',
    'completeOc',
    'issueMissingReference',
  ];
  const english = makerWorkspaceDictionary('en');

  ['zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    keys.forEach((key) => assert.notEqual(dictionary[key], english[key], `${locale}.${key} must be localized`));
  });
});

test('Player completion converts recipe and renderer issue codes into all five UI languages', () => {
  const document = createCharacterMakerV5Starter({
    makerId: 'localized-player-errors',
    name: 'Localized Player Errors',
  });
  const part = document.parts[0];
  const item = part.items[0];
  const style = item.styles[0];
  const englishWorkspace = createMakerWorkspace({ locale: 'en', callbacks: {} });
  const englishRequired = englishWorkspace.playerViolationText({
    code: 'required-part-missing',
    partId: part.id,
  }, document);
  const englishArtwork = englishWorkspace.playerSceneIssueText({
    code: 'missing-asset-reference',
    path: `${part.id}/${item.id}/${style.id}`,
  }, document);
  englishWorkspace.destroy();

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const workspace = createMakerWorkspace({ locale, callbacks: {} });
    const required = workspace.playerViolationText({
      code: 'required-part-missing',
      partId: part.id,
    }, document);
    const artwork = workspace.playerSceneIssueText({
      code: 'missing-asset-reference',
      path: `${part.id}/${item.id}/${style.id}`,
    }, document);

    assert.ok(required.includes(part.name), `${locale} required-Part error must name the affected Part`);
    assert.ok(artwork.includes(style.name), `${locale} artwork error must name the affected Style`);
    assert.doesNotMatch(required, /required-part-missing/);
    assert.doesNotMatch(artwork, /missing-asset-reference/);
    if (locale !== 'en') {
      assert.notEqual(required, englishRequired, `${locale} recipe errors must not fall back to English`);
      assert.notEqual(artwork, englishArtwork, `${locale} renderer errors must not fall back to English`);
    }
    workspace.destroy();
  });
});

test('non-English publication APIs return localized Preflight messages while preserving raw diagnostics', async () => {
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  const document = createCharacterMakerV5Starter({
    makerId: 'localized-publication-errors',
    name: 'Localized Publication Errors',
  });
  document.parts.forEach((part, index) => {
    const style = part.items[0].styles[0];
    style.assetId = `missing-${part.id}`;
    style.layerTrackId = document.layerTracks[index].id;
    style.positionConfirmed = true;
    document.assets.push({
      id: style.assetId,
      identifier: `${style.assetId}.png`,
      kind: 'layer',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
    });
  });
  const workspace = createMakerWorkspace({ locale: 'zh', callbacks: {} });
  try {
    await workspace.setContext({
      makerKey: 'wallet:localized-publication-errors',
      walletAddress: '',
      document,
      assets: [],
    });
    const issue = workspace.getPublicationIssues()
      .find((candidate) => candidate.code === 'runtime_asset_missing');
    assert.ok(issue);
    assert.match(issue.message, /缺少本地或远程 PNG 素材/);
    assert.match(issue.rawMessage, /missing its local or remote PNG/);
  } finally {
    workspace.destroy();
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test('rule Preflight failures have dedicated copy in all five workspace languages', () => {
  const cases = [
    ['default_recipe_rule_violation', 'issueDefaultRecipeRules'],
    ['unsatisfiable_maker_rules', 'issueUnsatisfiableRules'],
    ['unreachable_public_item_rules', 'issueUnreachableItem'],
    ['unreachable_public_style_rules', 'issueUnreachableStyle'],
    ['maker_rule_search_limit', 'issueRuleSearchLimit'],
  ];
  const variables = { part: 'Hair', item: 'Long Hair', style: 'Blue Streaks' };
  const english = makerWorkspaceDictionary('en');

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    const workspace = createMakerWorkspace({ locale, callbacks: {} });
    cases.forEach(([code, key]) => {
      const value = makerWorkspaceText(locale, key, variables);
      assert.ok(value.trim(), `${locale}.${key} must be translated`);
      assert.doesNotMatch(value, /\{(?:part|item|style)\}/);
      if (locale !== 'en') {
        assert.notEqual(dictionary[key], english[key], `${locale}.${key} must not fall back to English`);
        assert.equal(
          workspace.issueText({ code, message: 'English fallback' }, variables),
          value,
          `${locale}.${code} must use its dedicated localized Preflight copy`,
        );
      }
    });
    workspace.destroy();
  });
});

test('Soul configuration has complete five-language navigation and editor labels', () => {
  const keys = [
    'soulConfig',
    'soulConfigTitle',
    'soulConfigCopy',
    'soulPersonalityIdentity',
    'soulPersonalityIdentityCopy',
    'soulMemory',
    'soulMemoryCopy',
    'soulSkills',
    'soulSkillsCopy',
    'soulRestoreDefault',
    'soulValidationStatus',
    'soulValidationValid',
    'soulValidationInvalid',
    'soulDraftSaveCopy',
  ];
  const english = makerWorkspaceDictionary('en');

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    keys.forEach((key) => {
      assert.ok(dictionary[key]?.trim(), `${locale}.${key} must be translated`);
      if (locale !== 'en') {
        assert.notEqual(dictionary[key], english[key], `${locale}.${key} must not fall back to English`);
      }
    });
    assert.equal(
      makerWorkspaceText(locale, 'soulDocumentSize', { bytes: 512, limit: 65_536 }).includes('{'),
      false,
      `${locale}.soulDocumentSize must interpolate both counters`,
    );
  });

  assert.equal(makerWorkspaceText('zh', 'soulConfig'), 'Soul 配置');
  assert.equal(makerWorkspaceText('zh', 'soulPersonalityIdentity'), '性格与身份');
  assert.equal(makerWorkspaceText('zh', 'soulMemory'), '记忆');
  assert.equal(makerWorkspaceText('zh', 'soulSkills'), '技能');
  assert.equal(makerWorkspaceText('zh', 'soulRestoreDefault'), '恢复默认');
});

test('version history and timestamp states are localized in all five Maker Studio languages', () => {
  const keys = [
    'versionHistory',
    'versionHistoryTitle',
    'versionHistoryLoading',
    'versionHistoryEmpty',
    'versionHistoryFailed',
    'versionHistoryRetry',
    'versionHistoryRevision',
    'versionHistoryCurrent',
    'versionHistoryRestore',
    'versionHistoryRestoreConfirm',
    'versionHistoryRestoring',
    'versionHistoryRestored',
    'versionHistoryFlushFailed',
    'versionHistoryRestoreFailed',
    'savedAtTime',
  ];
  const english = makerWorkspaceDictionary('en');

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    keys.forEach((key) => {
      assert.ok(dictionary[key]?.trim(), `${locale}.${key} must be translated`);
      if (locale !== 'en') {
        assert.notEqual(dictionary[key], english[key], `${locale}.${key} must not fall back to English`);
      }
    });
    assert.equal(
      makerWorkspaceText(locale, 'versionHistoryRestoreConfirm', {
        revision: 12,
        name: 'Mira',
      }).includes('{'),
      false,
    );
    assert.equal(makerWorkspaceText(locale, 'savedAtTime', { time: '21:14' }).includes('{'), false);
  });

  assert.equal(makerWorkspaceText('zh', 'versionHistory'), '版本历史');
  assert.equal(makerWorkspaceText('zh', 'versionHistoryCurrent'), '当前版本');
});

test('project ZIP, recovery failures and icon-only controls stay localized in all five languages', () => {
  const keys = [
    'projectPacking',
    'projectBackupDownloaded',
    'projectExportFailed',
    'projectReading',
    'projectImported',
    'projectAnotherWorkspace',
    'projectImportFailed',
    'projectRequiresV5',
    'projectDuplicateStyleMapping',
    'projectInvalidStyleTarget',
    'projectLockedStyleTarget',
    'projectInvalidItemTarget',
    'recoveryMakerKeyRequired',
    'recoveryOnlyV5',
    'recoveryAssetsArray',
    'recoveryDestinationExists',
    'recoveryStorageConflict',
    'recoveryAssetIdRequired',
    'recoveryAssetDuplicated',
    'recoveryReadbackFailed',
    'recoveryRevisionChanged',
    'recoveryIdentityMismatch',
    'addPartAria',
    'deleteTrackAria',
    'deleteColorPresetAria',
    'deleteRuleAria',
  ];
  const english = makerWorkspaceDictionary('en');

  MAKER_WORKSPACE_LOCALES.forEach((locale) => {
    const dictionary = makerWorkspaceDictionary(locale);
    keys.forEach((key) => {
      assert.ok(dictionary[key]?.trim(), `${locale}.${key} must be translated`);
      if (locale !== 'en') {
        assert.notEqual(dictionary[key], english[key], `${locale}.${key} must not fall back to English`);
      }
    });
    [
      makerWorkspaceText(locale, 'projectImported', { source: '2026-07-26' }),
      makerWorkspaceText(locale, 'projectInvalidStyleTarget', { file: 'hair.png' }),
      makerWorkspaceText(locale, 'projectLockedStyleTarget', { style: 'Blue' }),
      makerWorkspaceText(locale, 'recoveryAssetDuplicated', { assetId: 'asset-1' }),
    ].forEach((value) => assert.doesNotMatch(value, /\{(?:source|file|style|assetId)\}/));
  });
});
