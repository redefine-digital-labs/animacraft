import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

function staticObjectFromSource(source, declarationName) {
  const declaration = `const ${declarationName} =`;
  const declarationIndex = source.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `missing ${declarationName} declaration`);
  const start = source.indexOf('{', declarationIndex + declaration.length);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      return runInNewContext(`(${source.slice(start, index + 1)})`);
    }
  }
  assert.fail(`unterminated ${declarationName} object`);
}

test('the live canvas empty state obeys the HTML hidden contract', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="creatorCanvasEmpty" class="creator-canvas-empty"/);
  assert.match(app, /\$\('creatorCanvasEmpty'\)\.hidden = images\.length > 0;/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('the player workbench constrains the canvas and scrolls its side panels', async () => {
  const [html, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /class="avatar-viewport">\s*<div id="avatar" class="avatar"/);
  assert.match(styles, /\.maker-layout\s*\{[^}]*height:\s*clamp\(520px,\s*calc\(100dvh - 222px\),\s*760px\);/s);
  assert.match(styles, /\.canvas-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.parts-panel\s*\{[^}]*overflow-y:\s*auto;/s);
});

test('the certified OC handoff uses the dedicated Soulidity adapter for free and paid Makers', async () => {
  const [html, app, runtime] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../runtime-config.js', import.meta.url), 'utf8'),
  ]);

  assert.match(runtime, /soulidityIntegrationPath:\s*'\/integrations\/animacraft'/);
  assert.match(app, /soulidityAppLink\(runtimeConfig\.soulidityIntegrationPath/);
  assert.match(app, /profileBlob:\s*state\.ocProfilePatchId/);
  assert.match(app, /imageBlob:\s*state\.ocImagePatchId/);
  assert.match(app, /recipeHash:\s*certifiedRecipeHash/);
  assert.match(app, /const adapterReady = canonicalSoulMintEnabled;/);
  assert.match(app, /if \(!canonicalSoulMintEnabled\) throw new Error\(t\('canonicalMintDisabled'\)\);/);
  assert.doesNotMatch(app, /&& !activeTemplate\(\)\?\.mintFeeEnabled && ocRecipeIssues/);
  assert.match(html, /id="soulidityMySoulsLink" data-soulidity-auth/);
  assert.match(html, /<strong[^>]*data-i18n="docsHandoffTitle"[^>]*>Dedicated handoff<\/strong>/);
  assert.doesNotMatch(html, /<strong>Temporary Import Kit<\/strong>/);
});

test('Player completion, Walrus profile and final Soulidity handoff share one immutable OC snapshot', async () => {
  const [app, handoff] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../oc-handoff.js', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /playerCompletionSnapshotV4:\s*null/);
  assert.match(app, /syncPlayerV4State\(payload,\s*\{\s*completed:\s*true\s*\}\)/);
  assert.match(app, /createPlayerCompletionSnapshot\(\{/);
  assert.match(app, /completion\?\.livingContent \|\| documentV4\.livingContent/);
  assert.match(app, /canonicalOcPackageFingerprint\(oc\)/);
  assert.match(app, /certifiedLivingContentSource\(oc\)/);
  assert.doesNotMatch(
    app.slice(app.indexOf('async function mintCurrentOc()'), app.indexOf('\nasync function restoreMakerDraft')),
    /createSoulidityImport(?:Json|Bundle)\(state\.livingContent/,
  );
  assert.match(
    app,
    /documentV4\.livingContent = normalizeLivingContent\(documentV4\.livingContent, documentV4\.metadata\)/,
  );
  assert.match(handoff, /Maker\/version\/Quilt provenance, resolved Living/);
});

test('Maker v5 mounts separate Creator and Player workspaces on one renderer', async () => {
  const [html, app, workspace, workspaceI18n, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace-i18n.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="makerV4CreatorMount"/);
  assert.match(html, /styles\.css\?v=animacraft-player-palette-v2/);
  assert.match(html, /app\.js\?v=animacraft-player-palette-v2/);
  assert.match(html, /id="makerV4PlayerMount"/);
  assert.match(html, /id="legacyPlayerEditor"[^>]*hidden/);
  assert.match(app, /buildMakerV4PublicationBundle/);
  assert.match(app, /makerWorkspace\.renderRecipeToBlob\(recipe\)/);
  assert.match(workspace, /renderResolvedScene\(scene, canvas/);
  assert.match(workspace, /data-action="player-none"/);
  assert.match(workspace, /data-action="player-preview-export"/);
  assert.match(workspace, /id="makerPlayerExportDialog"/);
  assert.match(workspace, /data-action="player-download-png"/);
  assert.match(workspace, /data-action="player-export-size"/);
  assert.match(workspace, /data-action="player-export-background"/);
  assert.match(workspace, /data-action="player-copy-maker-link"/);
  assert.match(workspace, /data-action="player-palette"/);
  assert.match(workspace, /role="tab"/);
  assert.match(workspace, /aria-selected="\$\{active \? 'true' : 'false'\}"/);
  assert.match(workspace, /id="v4PlayerPickerPanel"/);
  assert.match(workspace, /class="v4-player-style-option/);
  assert.match(workspace, /class="v4-player-item-grid" role="radiogroup"/);
  assert.match(workspace, /type="button" role="radio" class="v4-player-item/);
  assert.match(workspace, /class="v4-player-style-picker" role="radiogroup"/);
  assert.match(workspace, /data-player-radio-group="style"/);
  assert.match(workspace, /class="v4-player-colors" role="radiogroup"/);
  assert.match(workspace, /handlePlayerTabKeydown\(event\)/);
  assert.match(workspace, /handlePlayerRadioKeydown\(event\)/);
  assert.match(workspace, /this\.restorePlayerPickerViewState\(pickerViewState\)/);
  assert.match(workspace, /const removePartReasonId = 'v4PlayerRemovePartReason'/);
  assert.match(workspace, /const clearOptionalReasonId = 'v4PlayerClearOptionalReason'/);
  assert.match(
    workspace,
    /id="makerPlayerShareStatus" role="status" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(
    workspace,
    /data-action="player-copy-maker-link" \$\{external\.shareUrl \? '' : 'disabled aria-describedby="makerPlayerShareStatus"'\}/,
  );
  assert.doesNotMatch(workspace, /v4-player-export-placeholder" role="status"/);
  assert.match(workspace, /this\.restorePlayerExportScroll\(exportScroll\)/);
  assert.match(workspace, /v4-player-selected-mark" aria-hidden="true"/);
  assert.doesNotMatch(workspace, /v4-player-selected-mark" aria-label=/);
  assert.match(workspace, /\['info', this\.tr\('makerInfo'\)\]/);
  assert.match(workspace, /makerInfoControl\('maker-name'/);
  assert.match(workspace, /makerInfoControl\('maker-creator'/);
  assert.match(workspace, /makerInfoControl\('maker-summary'/);
  assert.match(workspace, /makerInfoControl\('maker-style'/);
  assert.match(workspace, /data-action="maker-license-kind"/);
  assert.match(workspace, /makerInfoControl\('maker-license-note'/);
  assert.match(workspace, /data-action="maker-cover"/);
  assert.match(styles, /\.v4-studio-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(8,\s*minmax\(100px,\s*1fr\)\);/s);
  assert.match(workspaceI18n, /Upload at least one Style PNG before player testing/);
  assert.match(workspace, /this\.tr\(blockingIssues\.length === 1 \? 'reviewIssue' : 'reviewIssues'/);
  assert.match(workspaceI18n, /reviewIssues: 'Review \{count\} issues'/);
  assert.match(workspace, /class="v4-tool-modal-backdrop" data-action="close-tool-backdrop"/);
  assert.match(workspace, /id="makerV4ToolDialog" class="v4-advanced-panel primary-tool" role="dialog" aria-modal="true"/);
  assert.match(workspace, /renderPublicationFlow\(kind\)/);
  assert.match(workspace, /const dialogId = creator \? 'makerCreatorPublishDialog' : 'makerPlayerPublishDialog'/);
  assert.match(workspace, /data-action="copy-\$\{prefix\}-publish-error"/);
  assert.match(workspace, /data-action="force-close-\$\{prefix\}-publish"/);
  assert.match(styles, /\.v4-chain-flow-backdrop\s*\{[^}]*z-index:\s*1500;/s);
  assert.match(styles, /\.v4-player-export-backdrop\s*\{[^}]*z-index:\s*1450;/s);
  assert.match(
    styles,
    /\.v4-player-export-body\s*\{[^}]*overflow:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
  );
  assert.match(styles, /\.v4-player-export-image\s*\{[^}]*background:/s);
  assert.match(styles, /\.v4-player-part\.active\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /\.v4-chain-flow button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.v4-chain-status > i\s*\{[^}]*animation:\s*none;/);
  assert.match(workspace, /role="tab" aria-selected=/);
  assert.match(workspace, /else if \(style\.positionConfirmed === false\)/);
  assert.match(workspace, /data-action="focus-issue"/);
  assert.match(workspace, /data-action="style-asset"/);
  assert.match(workspace, /this\.contextEpoch = 0/);
  assert.match(workspace, /this\.contextEpoch !== contextEpoch/);
  assert.match(workspace, /this\.store\.replace\(incoming, incomingRecipe/);
  assert.match(
    workspace,
    /const nextAssets = this\.runtimeAssetsForContext\(context, incoming\);[\s\S]*?this\.replaceRuntimeAssets\(nextAssets\)/,
  );
  assert.match(styles, /\.maker-v4-mount\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(styles, /\.v4-canvas-column\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;[^}]*padding:\s*0;/s);
  assert.match(styles, /@media \(max-width:\s*820px\)[\s\S]*?\.creator-function-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(styles, /@media \(max-width:\s*560px\)[\s\S]*?\.v4-studio-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.v4-player-header\s*\{\s*position:\s*relative;/s);
  assert.match(
    workspace,
    /<textarea id="\$\{editorId\}" data-action="player-soul-document" data-soul-key="\$\{escapeHtml\(entry\.key\)\}"[^>]*aria-invalid=/,
  );
  assert.match(workspace, /data-action="player-reset-soul-document"/);
  assert.match(workspace, /data-action="player-reset-all-soul"/);
  assert.doesNotMatch(workspace, /<pre data-player-soul-document=/);
  assert.match(
    styles,
    /\.v4-player-soul-editor textarea\s*\{[^}]*min-height:\s*220px;[^}]*resize:\s*vertical;/s,
  );
  assert.match(
    workspace,
    /id="\$\{statusId\}" role="status" aria-live="polite"/,
  );
});

test('every Creator release entry opens the shared modal without a legacy inline flow', async () => {
  const [html, app, workspace] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
  ]);

  assert.equal((html.match(/data-open-maker-release/g) || []).length, 3);
  assert.doesNotMatch(html, /data-editor-panel="publish"/);
  assert.doesNotMatch(html, /id="(?:makerPublishAction|resumeMakerUpload|prepareMakerUpload|registerMakerUpload|certifyMakerUpload|publishMakerOnchain|reviewPendingMakerPublication)"/);
  assert.match(
    app,
    /document\.querySelectorAll\('\[data-open-maker-release\]'\)[\s\S]*?setEditorPanel\('parts'\);[\s\S]*?makerWorkspace\?\.openCreatorPublication\?\.\(\);/,
  );
  assert.match(workspace, /openCreatorPublication\(\) \{[\s\S]*?this\.creatorPublishOpen = true;/);
  assert.match(workspace, /if \(action === 'publish'\) \{\s*this\.openCreatorPublication\(\);/);
});

test('every static editor translation hook is backed by the application dictionary', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
  ]);
  const editorStart = html.indexOf('class="creator-view active"');
  const editorEnd = html.indexOf('id="makerRegistrationModal"');
  const editorHtml = html.slice(editorStart, editorEnd);
  const keys = [...new Set([...editorHtml.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)].map((match) => match[1]))];

  assert.ok(keys.length >= 70, 'Creator Studio should expose detailed translation hooks');
  keys.forEach((key) => assert.match(app, new RegExp(`\\b${key}:`), `missing application translation key: ${key}`));
  ['zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    assert.match(app, new RegExp(`${locale}: \\{[\\s\\S]*?publishMakerStep:`), `${locale} must translate the publication flow`);
    assert.match(app, new RegExp(`${locale}: \\{[\\s\\S]*?livingContentCopy:`), `${locale} must translate Living Content`);
  });
});

test('production wallet, chain and Player release states use the five-language runtime dictionary', async () => {
  const [app, workspace] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
  ]);

  ['en', 'zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    assert.match(
      app,
      new RegExp(`${locale}: \\{[\\s\\S]*?transparentStylePng:`),
      `${locale} must translate transparent PNG publication failures`,
    );
    assert.match(
      app,
      new RegExp(`${locale}: \\{[\\s\\S]*?walletConnectedAs:`),
      `${locale} must translate wallet state`,
    );
    assert.match(
      app,
      new RegExp(`${locale}: \\{[\\s\\S]*?ocWaitingCertification:`),
      `${locale} must translate the Walrus/Soulidity release flow`,
    );
  });

  assert.match(app, /return t\('canonicalMintGateClosed'\)/);
  assert.match(app, /t\('walletConnectedAs', \{ address: displayAddress \}\)/);
  assert.match(app, /state\.chainMakersLoading \? t\('syncingMakers'\) : t\('refreshMakers'\)/);
  assert.match(workspace, /this\.playerViolationText\(violation, document\)/);
  assert.match(workspace, /this\.playerSceneIssueText\(issue, document\)/);
  assert.doesNotMatch(app, /\.textContent = 'Wallet not connected'/);
  assert.doesNotMatch(app, /\.textContent = 'Finished characters are Soulidity Souls/);
  assert.doesNotMatch(workspace, /issues\.push\('The current OC has no visible artwork\.'\)/);
});

test('every application dictionary group has exact five-language key and interpolation parity', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const groups = [
    'i18n',
    'editorShellI18n',
    'editorDetailI18n',
    'makerLifecycleStatusI18n',
    'licenseOptionI18n',
    'livingStatusI18n',
    'draftRecoveryI18n',
    'productionRuntimeI18n',
    'archiveConfirmationI18n',
    'productionSurfaceI18n',
    'productionErrorI18n',
    'productionTerminologyI18n',
    'productionPublicationRecoveryI18n',
    'staticProductionPageI18n',
    'docsPageI18n',
    'draftRecoveryProductionI18n',
    'visualThemeI18n',
  ];
  const tokens = (value) => [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();

  groups.forEach((groupName) => {
    const group = staticObjectFromSource(app, groupName);
    assert.deepEqual(Object.keys(group), ['en', 'zh', 'ja', 'ko', 'vi']);
    const englishKeys = Object.keys(group.en).sort();
    ['zh', 'ja', 'ko', 'vi'].forEach((locale) => {
      assert.deepEqual(
        Object.keys(group[locale]).sort(),
        englishKeys,
        `${groupName}.${locale} must have exact key parity`,
      );
      englishKeys.forEach((key) => {
        assert.ok(String(group[locale][key]).trim(), `${groupName}.${locale}.${key} must not be blank`);
        assert.deepEqual(
          tokens(group[locale][key]),
          tokens(group.en[key]),
          `${groupName}.${locale}.${key} must preserve interpolation tokens`,
        );
      });
    });
  });
});

test('confirmed Walrus certification visibility waits are not reported as Maker or OC failures', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(
    app,
    /const classified = recordMakerPublishError\(error, 'certify', 'certificationFailed'\);[\s\S]*?classified\.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE'[\s\S]*?state\.publishStatus = t\('certificationSyncing'\)/,
  );
  assert.match(
    app,
    /const recheckingCertificationVisibility = state\.makerPublishError\?\.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE';[\s\S]*?state\.publishStatus = t\(recheckingCertificationVisibility \? 'certificationSyncing' : 'certifyingQuilt'\)/,
  );
  assert.match(
    app,
    /const classified = recordOcPublishError\(error, 'certify', 'ocCertificationFailed'\);[\s\S]*?classified\.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE'[\s\S]*?state\.mintStatus = t\('ocCertificationSyncing'\)/,
  );
  assert.match(
    app,
    /const recheckingCertificationVisibility = state\.ocPublishError\?\.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE';[\s\S]*?state\.mintStatus = t\(recheckingCertificationVisibility \? 'ocCertificationSyncing' : 'ocWaitingCertification'\)/,
  );
  assert.match(
    app,
    /function restoredCertificationVisibilityError\(certifyDigest\)[\s\S]*?code: 'WALRUS_CERTIFICATION_NOT_VISIBLE'[\s\S]*?action: 'certify'/,
  );
  assert.match(
    app,
    /const certificationStateSyncing = uploadStage === 'uploaded' && Boolean\(uploadSession\.certifyDigest\);[\s\S]*?state\.makerPublishError = restoredCertificationVisibilityError\(uploadSession\.certifyDigest\);[\s\S]*?state\.publishStatus = t\('certificationSyncing'\)/,
  );
  assert.match(
    app,
    /const certificationStateSyncing = uploadStage === 'uploaded' && Boolean\(uploadSession\.certifyDigest\);[\s\S]*?state\.ocPublishError = restoredCertificationVisibilityError\(uploadSession\.certifyDigest\);[\s\S]*?state\.mintStatus = t\('ocCertificationSyncing'\)/,
  );

  const productionErrors = staticObjectFromSource(app, 'productionErrorI18n');
  ['en', 'zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    assert.ok(productionErrors[locale].certificationSyncing);
    assert.ok(productionErrors[locale].ocCertificationSyncing);
  });
});

test('non-English application copy only matches English for intentional product names', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const groups = [
    'i18n',
    'editorShellI18n',
    'editorDetailI18n',
    'makerLifecycleStatusI18n',
    'licenseOptionI18n',
    'livingStatusI18n',
    'draftRecoveryI18n',
    'productionRuntimeI18n',
    'archiveConfirmationI18n',
    'productionSurfaceI18n',
    'productionErrorI18n',
    'productionTerminologyI18n',
    'productionPublicationRecoveryI18n',
    'staticProductionPageI18n',
    'docsPageI18n',
    'draftRecoveryProductionI18n',
    'visualThemeI18n',
  ];
  const intentional = {
    i18n: {
      zh: ['brandTagline'],
      ja: ['brandTagline'],
      ko: ['brandTagline'],
      vi: ['brandTagline', 'filterChibi'],
    },
    productionRuntimeI18n: {
      zh: ['walrusLabel'],
      ja: ['walrusLabel'],
      ko: ['walrusLabel'],
      vi: ['walrusLabel'],
    },
    visualThemeI18n: {
      zh: ['themeAnimacraft', 'themeSoulidity'],
      ja: ['themeAnimacraft', 'themeSoulidity'],
      ko: ['themeAnimacraft', 'themeSoulidity'],
      vi: ['themeAnimacraft', 'themeSoulidity'],
    },
  };

  groups.forEach((groupName) => {
    const group = staticObjectFromSource(app, groupName);
    ['zh', 'ja', 'ko', 'vi'].forEach((locale) => {
      const matching = Object.keys(group.en)
        .filter((key) => group[locale][key] === group.en[key])
        .sort();
      assert.deepEqual(
        matching,
        [...(intentional[groupName]?.[locale] || [])].sort(),
        `${groupName}.${locale} has unexpected English fallback copy`,
      );
    });
  });
});

test('production static pages and accessibility labels are fully wired to five-language copy', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
  ]);
  const keys = [...new Set(
    [...html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)]
      .map((match) => match[1]),
  )];

  keys.forEach((key) => {
    assert.match(app, new RegExp(`\\b${key}:`), `missing application translation key: ${key}`);
  });
  assert.ok(app.includes("document.querySelectorAll('[data-i18n-aria-label]')"));
  assert.match(html, /data-i18n="docsHierarchyToken">Maker → Part → Item → Style → PNG/);
  assert.doesNotMatch(html, />Part → Item → Image</);
  assert.match(html, /The separate Layer Tracks panel only controls global back-to-front order/);
  assert.doesNotMatch(html, /One Style owns one PNG on one LayerTrack/);
  assert.match(app, /titleKey: 'chainActionWalletTitle'/);
  assert.match(app, /escapeHtml\(t\(action\.titleKey\)\)/);
  assert.match(app, /\['01', 'docsProtocolStep1Title', 'docsProtocolStep1Copy'\]/);
  assert.match(app, /escapeHtml\(t\(titleKey\)\)/);
});

test('production terminology stays native and consistent in all five application languages', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const terms = staticObjectFromSource(app, 'productionTerminologyI18n');

  assert.equal(terms.zh.partsLabel, '部位');
  assert.equal(terms.zh.itemsLabel, '部件');
  assert.equal(terms.zh.choosePart, '选择部位');
  assert.equal(terms.ja.partsLabel, 'パーツ');
  assert.equal(terms.ko.itemsLabel, '아이템');
  assert.equal(terms.vi.partsLabel, 'Bộ phận');
  assert.equal(terms.vi.itemsLabel, 'Vật phẩm');

  ['zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    assert.doesNotMatch(
      [
        terms[locale].creatorStudioCopy,
        terms[locale].partsLabel,
        terms[locale].itemsLabel,
        terms[locale].currentSlot,
        terms[locale].choosePart,
        terms[locale].rulesRecordCopy,
        terms[locale].recipeIntegrityCopy,
      ].join(' '),
      /\b(?:Creator|Player|Part|Item|Style|Studio)\b/,
      `${locale} must not leak English editor hierarchy terms`,
    );
  });
});

test('production gallery is chain-derived and creator packs are local test fixtures only', async () => {
  const [app, html, runtime] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /if \(!localUiTest\) return;\s*if \(bundledMakersLoaded\) return;/);
  assert.match(app, /template\.source !== 'chain' && !\(localUiTest && template\.source === 'creator-pack'\)/);
  assert.match(app, /\/makers\/astral-courier\/animacraft-maker-v5\.json/);
  assert.match(app, /\/makers\/hanamori-spirit\/animacraft-maker-v5\.json/);
  assert.match(app, /localUiTest && template\.source === 'creator-pack' && makerModels\.has\(template\.id\)/);
  assert.match(app, /template\.source === 'chain' && !makerModels\.get\(template\.id\)\?\.makerArchived/);
  assert.match(app, /data-create-first-maker/);
  assert.match(app, /walletAllowedPage === 'make' && !canOpenPlayer\(\) \? 'templates'/);
  assert.match(app, /templateId === 'daily-starlit' \? localStorage\.getItem\('animacraft-maker-draft-v1'\) : null/);
  assert.match(app, /template\.source === 'chain'/);
  assert.match(html, /id="accountMakeOc" data-page="make"/);
  assert.doesNotMatch(html, /data-editor-panel-button="rules"/);
  assert.doesNotMatch(html, /data-editor-panel-button="palette"/);
  assert.doesNotMatch(html, /data-editor-panel-button="preview"/);
  assert.match(html, /id="publicMakerCount">0</);
  assert.match(runtime, /last: Math\.min\(50, limit - ids\.length\)/);
  assert.doesNotMatch(runtime, /last: Math\.min\(100, limit - ids\.length\)/);
});

test('Maker v5 exposes the four-level P0 creator workflow without legacy visual sublayers', async () => {
  const [html, app, workspace, workspaceI18n, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace-i18n.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /every Style directly owns one PNG plus its position and render settings/);
  assert.match(app, /classList\.toggle\('v4-parts-active', state\.editorPanel === 'parts'\)/);
  assert.match(app, /const items = Array\.isArray\(part\.items\) \? part\.items : \[\];/);
  assert.match(app, /const styles = items\.flatMap\(\(item\) => item\.styles \|\| \[\]\);/);
  assert.match(styles, /\.creator-view\[data-creator-view="edit"\]\.v4-parts-active \.creator-editor-header\s*\{\s*display:\s*none;/s);
  assert.match(workspace, /this\.tr\('importMatrixFolder'\)/);
  assert.match(workspace, /this\.tr\('projectZip'\)/);
  assert.match(
    workspace,
    /new Set\(\['structure', 'info', 'layers', 'colors', 'rules', 'expansions', 'soul', 'validate'\]\)/,
  );
  assert.doesNotMatch(workspace, /this\.tr\('generateCompositeThumbnail'\)/);
  assert.doesNotMatch(workspace, /this\.tr\('parentPart'\)/);
  assert.match(workspace, /\['soul', this\.tr\('soulConfig'\)\]/);
  assert.match(workspace, /data-action="add-style"/);
  assert.match(workspace, /data-action="copy-style"/);
  assert.match(workspace, /data-action="style-asset"/);
  assert.match(workspace, /data-action="style-channel"/);
  assert.match(workspace, /data-action="style-position-locked"/);
  assert.match(workspace, /data-action="style-locked"/);
  assert.match(workspace, /data-action="toggle-part-preview"/);
  assert.match(workspace, /data-action="player-style"/);
  assert.match(workspace, /selection\.styleId/);
  assert.doesNotMatch(workspace, /\b(?:LayerBinding|bindingId|variantId|defaultVariantId)\b/);
  assert.doesNotMatch(workspace, /Empty LayerBinding|Selected Layer/);
  assert.doesNotMatch(workspace, /data-action="(?:select-binding|add-binding|binding-[^"]+)"/);
  assert.doesNotMatch(workspace, /data-action="style-swatch-asset"/);
  assert.doesNotMatch(workspace, /<option value="asset-map"/);
  assert.doesNotMatch(workspace, /\bassetsBySwatch\b/);
  assert.doesNotMatch(workspaceI18n, /Separate assets/);
  assert.match(workspace, /data-action="open-player"/);
});

test('Maker v5 keeps the mobile player preview visible and blocks incomplete OC output', async () => {
  const [workspace, styles] = await Promise.all([
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /playerCompletionIssues/);
  assert.match(workspace, /data-action="player-complete" \$\{completionIssues\.length \? 'disabled' : ''\}/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.v4-player-preview\s*\{[^}]*position:\s*sticky;[^}]*max-height:\s*58vh;/s);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.v4-player-preview\s*\{[^}]*grid-template-rows:\s*minmax\(220px,\s*38vh\) auto;[^}]*max-height:\s*52vh;/s);
});

test('Creator Library exposes a non-destructive current and legacy Draft Recovery Center', async () => {
  const [html, app, workspace, initializer, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-storage-initializer.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="openDraftRecovery"/);
  assert.match(html, /id="draftRecoveryModal"/);
  assert.match(app, /scanLegacyMakerDrafts\(\)/);
  assert.match(app, /makerWorkspace\?\.listDraftProjects\(\{\}\)/);
  assert.match(app, /commitRecoveredDraftCopy/);
  assert.match(app, /persistLocalMakerIndex\(requestedWallet\)/);
  assert.match(workspace, /this\.tr\('recoveryReadbackFailed'\)/);
  assert.doesNotMatch(initializer, /\.deleteDatabase\(/);
  assert.doesNotMatch(initializer, /\.clear\(/);
  assert.doesNotMatch(initializer, /\.removeItem\(/);
  assert.match(styles, /\.draft-recovery-card\s*\{/);
});

test('Draft Recovery and current Maker workspace do not leak English-only operational UI', async () => {
  const [app, workspace] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
  ]);

  [
    'draftRecoveryV6Missing',
    'draftRecoveryConnectOwnerWallet',
    'draftRecoverySaveCurrentFirst',
    'draftRecoveryWalletChanged',
    'draftRecoveryWalletChangedAfterSave',
    'draftRecoveryIdentityFailed',
  ].forEach((key) => assert.match(app, new RegExp(`t\\('${key}'`)));
  assert.doesNotMatch(app, /throw new Error\('Connect the wallet that owns this draft before saving it\.'\)/);
  assert.match(app, /throw new Error\(t\('makerDraftOwnerWalletRequired'\)\)/);

  [
    'projectPacking',
    'projectBackupDownloaded',
    'projectExportFailed',
    'projectReading',
    'projectImported',
    'projectImportFailed',
    'projectDuplicateStyleMapping',
    'projectInvalidStyleTarget',
    'projectLockedStyleTarget',
    'projectInvalidItemTarget',
  ].forEach((key) => assert.match(workspace, new RegExp(`this\\.tr\\('${key}'`)));
  assert.doesNotMatch(workspace, /setSaveState\([^)]*'Packing Maker project…'/);
  assert.match(workspace, /data-action="add-part" aria-label="\$\{escapeHtml\(this\.tr\('addPartAria'\)\)\}"/);
  assert.match(workspace, /data-action="delete-track"[\s\S]*?aria-label="\$\{escapeHtml\(this\.tr\('deleteTrackAria'\)\)\}"/);
  assert.match(workspace, /data-action="delete-swatch"[\s\S]*?aria-label="\$\{escapeHtml\(this\.tr\('deleteColorPresetAria'\)\)\}"/);
  assert.match(workspace, /data-action="delete-rule"[\s\S]*?aria-label="\$\{escapeHtml\(this\.tr\('deleteRuleAria'\)\)\}"/);
});

test('pending publication review and explicit clear confirmation have complete five-language copy', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const group = staticObjectFromSource(app, 'productionPublicationRecoveryI18n');
  const keys = [
    'publicationPendingReview',
    'reviewPendingPublication',
    'clearPendingPublicationTitle',
    'clearPendingPublicationMessage',
    'clearPendingPublicationConfirm',
    'archivedMakerImmutable',
    'publishedMakerImmutable',
  ];

  ['en', 'zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    keys.forEach((key) => {
      assert.ok(group[locale][key]?.trim(), `${locale}.${key} must be translated`);
      if (locale !== 'en') {
        assert.notEqual(group[locale][key], group.en[key], `${locale}.${key} must not fall back to English`);
      }
    });
  });
  assert.match(group.zh.publicationPendingReview, /阻止再次签名/);
  assert.match(group.zh.clearPendingPublicationMessage, /确认钱包已拒绝请求/);
  assert.match(group.zh.clearPendingPublicationMessage, /链上不存在该交易/);
  const editableGuard = app.slice(
    app.indexOf('function ensureMakerEditable'),
    app.indexOf('\nfunction localMakerIndexKey'),
  );
  assert.doesNotMatch(editableGuard, /beginNextVersion/);
  assert.match(
    editableGuard,
    /makerPublishedLineageFork\(\)[\s\S]*?makerVersionLineageForkMessage\(\)[\s\S]*?t\('makerLifecycleStartVersionCopy'\)/,
  );
});

test('Maker lifecycle states are explicit and every management action revalidates current chain authority', async () => {
  const [app, html, styles] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);
  const lifecycleCopy = staticObjectFromSource(app, 'makerLifecycleStatusI18n');
  const lifecycleKeys = [
    'makerLifecycleDraft',
    'makerLifecyclePublishing',
    'makerLifecycleRecoverable',
    'makerLifecycleActive',
    'makerLifecyclePaused',
    'makerLifecycleArchived',
    'makerLifecycleVersionDraft',
    'retirementProtocolUpgrade',
    'makerAuthorityChecking',
    'makerAuthorityChanged',
    'makerStateReadbackPending',
  ];
  ['en', 'zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    lifecycleKeys.forEach((key) => assert.ok(lifecycleCopy[locale][key]?.trim(), `${locale}.${key} is required`));
  });

  assert.match(app, /function makerLifecycleDescriptor\(template = activeTemplate\(\)\)/);
  for (const stateName of ['publishing', 'recoverable', 'version-draft', 'archived', 'paused', 'active']) {
    assert.match(app, new RegExp(`id = '${stateName.replace('-', '\\-')}'`));
  }
  assert.match(app, /let id = template\?\.source === 'local' \? 'draft' : 'starter'/);
  assert.match(app, /const pendingOnchainEconomics = economicsField && makerIsPublished\(\) && !makerHasPendingV4Version\(\)/);
  assert.match(app, /makerLifecycleDescriptor\(template\)/);
  assert.match(styles, /\.maker-lifecycle-badge\.publishing/);
  assert.match(styles, /\.maker-card-lifecycle\.paused/);

  const authorityStart = app.indexOf('async function refreshMakerLifecycleAuthority(');
  const authorityEnd = app.indexOf('\nasync function recoverPublishedMakerIndex', authorityStart);
  const authority = app.slice(authorityStart, authorityEnd);
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  assert.match(authority, /getMakerObjects\(\[makerObjectId\], \{ expectedStructName: 'OCMaker' \}\)/);
  assert.match(authority, /listOwnedMakerAdminCaps\(walletAddress\)/);
  assert.match(authority, /admin_cap_id/);
  assert.match(authority, /treasury_id/);
  assert.match(authority, /MAKER_ADMIN_CAP_NOT_OWNED/);

  const archiveStart = app.indexOf('async function updateMakerArchiveState(archived)');
  const archiveEnd = app.indexOf('\nasync function prepareOcUpload', archiveStart);
  const archiveAction = app.slice(archiveStart, archiveEnd);
  assert.ok(archiveAction.indexOf('await refreshMakerLifecycleAuthority(operation)') < archiveAction.indexOf('await setMakerArchived('));
  assert.match(archiveAction, /await refreshMakerLifecycleAuthority\(operation\)/);
  assert.match(archiveAction, /await refreshMakerLifecycleAuthorityAfterWrite\(operation,/);

  const economicsStart = app.indexOf("$('updateMakerEconomics')?.addEventListener('click'");
  const economicsEnd = app.indexOf("$('withdrawMakerRevenue')?.addEventListener('click'", economicsStart);
  const economicsAction = app.slice(economicsStart, economicsEnd);
  assert.ok(economicsAction.indexOf('await refreshMakerLifecycleAuthority(operation)') < economicsAction.indexOf('await configureMakerEconomics({'));
  assert.match(economicsAction, /await refreshMakerLifecycleAuthorityAfterWrite\(operation,/);

  const withdrawStart = economicsEnd;
  const withdrawEnd = app.indexOf("$('deleteMakerDraft')?.addEventListener", withdrawStart);
  const withdrawAction = app.slice(withdrawStart, withdrawEnd);
  assert.ok(withdrawAction.indexOf('await refreshMakerLifecycleAuthority(operation)') < withdrawAction.indexOf('await withdrawMakerRevenue({'));

  assert.match(html, /id="makerRetirementNotice"[^>]*data-i18n="retirementProtocolUpgrade"/);
  assert.doesNotMatch(html, /id="(?:retire|supersede)Maker/i);
});

test('Maker lifecycle management is reachable from Creator Studio and Library through one accessible modal', async () => {
  const [app, html, workspace] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
  ]);

  const workspaceContextStart = app.indexOf('function syncMakerWorkspaceContext(');
  const workspaceContextEnd = app.indexOf('\nfunction renderAll()', workspaceContextStart);
  const workspaceContext = app.slice(workspaceContextStart, workspaceContextEnd);
  assert.ok(workspaceContextStart >= 0 && workspaceContextEnd > workspaceContextStart);
  assert.match(
    workspaceContext,
    /const lifecycle = makerLifecycleDescriptor\(template\);[\s\S]*?lifecycle:\s*\{[\s\S]*?id:\s*lifecycle\.id,[\s\S]*?label:\s*t\(lifecycle\.labelKey\),[\s\S]*?badgeClass:\s*lifecycle\.badgeClass,[\s\S]*?manageLabel:\s*t\('makerLifecycleManage'\)/,
  );
  assert.match(
    app,
    /onManageLifecycle\(\)\s*\{\s*openMakerLifecycleManager\(\);\s*\}/,
    'Creator Studio must route its lifecycle badge to the shared manager',
  );
  assert.match(workspace, /const lifecycle = this\.context\?\.lifecycle \|\| \{\};/);
  assert.match(
    workspace,
    /data-action="manage-lifecycle" aria-label="\$\{escapeHtml\(lifecycleManageLabel\)\}"/,
  );
  assert.match(
    workspace,
    /if \(action === 'manage-lifecycle'\)\s*\{\s*this\.callbacks\.onManageLifecycle\?\.\(\);\s*return;\s*\}/,
  );

  const libraryStart = app.indexOf('function renderImageMakerList()');
  const libraryEnd = app.indexOf('\nfunction requestDeleteMaker', libraryStart);
  const library = app.slice(libraryStart, libraryEnd);
  assert.ok(libraryStart >= 0 && libraryEnd > libraryStart);
  assert.match(library, /data-manage-lifecycle="\$\{escapeHtml\(template\.id\)\}"/);
  assert.match(library, /data-edit-maker="\$\{escapeHtml\(template\.id\)\}"/);
  assert.match(
    library,
    /document\.querySelectorAll\('\[data-edit-maker\]'\)\.forEach\([\s\S]*?setCreatorView\('edit'\)/,
    'Edit must remain an independent Library action',
  );
  assert.match(
    library,
    /document\.querySelectorAll\('\[data-manage-lifecycle\]'\)\.forEach\([\s\S]*?openMakerLifecycleManager\(button\.dataset\.manageLifecycle\)/,
    'Manage status must open the lifecycle manager without entering edit mode',
  );

  assert.match(
    html,
    /id="makerLifecycleManagerModal"[^>]*aria-hidden="true"[\s\S]*?role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="makerLifecycleManagerTitle"[^>]*aria-describedby="makerLifecycleManagerCopy"/,
  );
  for (const id of [
    'makerLifecycleManagerBadge',
    'makerLifecycleManagerName',
    'makerLifecycleManagerScope',
    'makerLifecycleManagerFacts',
    'lifecycleWorkingVersionCard',
    'lifecyclePublishedVersionCard',
    'makerLifecycleVersionHistory',
    'makerLifecycleManagerActions',
    'makerLifecycleManagerNotice',
    'makerLifecycleManagerStatus',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be part of the shared lifecycle dialog`);
    assert.match(
      app,
      new RegExp(`\\$\\('${id}'\\)`),
      `${id} must be populated by lifecycle rendering`,
    );
  }
  assert.match(html, /id="makerLifecycleManagerStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*tabindex="-1"/);
  assert.match(
    app,
    /function openMakerLifecycleManager\([\s\S]*?setAttribute\('aria-hidden', 'false'\)/,
  );
  assert.match(
    app,
    /function closeMakerLifecycleManager\([\s\S]*?setAttribute\('aria-hidden', 'true'\)/,
  );
  assert.match(
    app,
    /\$\('makerLifecycleManagerModal'\)\?\.addEventListener\('click',[\s\S]*?closest\('\[data-lifecycle-action\]'\)[\s\S]*?handleMakerLifecycleAction\(actionButton\.dataset\.lifecycleAction\)/,
    'dynamically rendered lifecycle actions must use delegated handling',
  );
  assert.match(
    app,
    /\$\('makerLifecycleManagerModal'\)\?\.addEventListener\('keydown',[\s\S]*?event\.key !== 'Tab'[\s\S]*?event\.preventDefault\(\)/,
    'the lifecycle dialog must keep keyboard focus inside the modal',
  );
  assert.match(
    app,
    /const focusedLifecycleAction = focusedInsideModal[\s\S]*?focusedLifecycleAction[\s\S]*?makerLifecycleManagerStatus[\s\S]*?focus\(\{ preventScroll: true \}\)/,
    'a lifecycle redraw must restore the replaced action or move focus to its live status',
  );
  assert.match(
    app,
    /document\.addEventListener\('focusin',[\s\S]*?makerLifecycleManagerModal[\s\S]*?lifecycleModal\.contains\(event\.target\)[\s\S]*?makerLifecycleManagerStatus[\s\S]*?focus\(\{ preventScroll: true \}\)/,
    'background focus must be redirected into the active lifecycle dialog',
  );
});

test('nested lifecycle confirmations suspend the background dialog and restore its trigger focus', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(
    html,
    /id="makerLifecycleManagerDialog"[^>]*role="dialog"[^>]*aria-modal="true"/,
  );
  assert.match(
    html,
    /id="confirmActionDialog"[^>]*role="dialog"[^>]*aria-modal="true"/,
  );

  const confirmationStart = app.indexOf('function openConfirmation(');
  const confirmationEnd = app.indexOf('\nfunction revokeMakerObjectUrls', confirmationStart);
  const confirmationFlow = app.slice(confirmationStart, confirmationEnd);
  assert.ok(confirmationStart >= 0 && confirmationEnd > confirmationStart);
  assert.match(
    confirmationFlow,
    /confirmationReturnFocus = document\.activeElement instanceof HTMLElement[\s\S]*?document\.activeElement/,
    'every confirmation must capture the element that opened it',
  );
  assert.match(
    confirmationFlow,
    /confirmationSuspendedLifecycle = Boolean\(lifecycleModal\?\.classList\.contains\('active'\)\)[\s\S]*?lifecycleModal\.inert = true;[\s\S]*?setAttribute\('aria-hidden', 'true'\)[\s\S]*?makerLifecycleManagerDialog'\)\?\.setAttribute\('aria-modal', 'false'\)/,
    'a nested confirmation must hide and disable the lifecycle dialog for assistive technology',
  );
  assert.match(
    confirmationFlow,
    /if \(restoreLifecycle\)[\s\S]*?lifecycleModal\.inert = false;[\s\S]*?removeAttribute\('inert'\)[\s\S]*?makerLifecycleManagerDialog'\)\?\.setAttribute\('aria-modal', 'true'\)/,
    'closing the confirmation must restore lifecycle modal semantics and interactivity',
  );
  assert.match(
    confirmationFlow,
    /returnFocus\?\.isConnected[\s\S]*?!returnFocus\.closest\('\[inert\]'\)[\s\S]*?returnFocus\.focus\(\)/,
    'closing any confirmation must return focus to its still-available trigger',
  );
  assert.match(
    app,
    /const actionButton = event\.target\.closest\('\[data-lifecycle-action\]'\);[\s\S]*?actionButton\.focus\(\);[\s\S]*?handleMakerLifecycleAction\(actionButton\.dataset\.lifecycleAction\)/,
    'pointer and touch activation must establish the exact lifecycle action as the confirmation trigger',
  );
  assert.match(
    app,
    /\$\('confirmActionModal'\)\.addEventListener\('keydown',[\s\S]*?event\.key !== 'Tab'[\s\S]*?event\.preventDefault\(\)/,
    'the top confirmation must keep keyboard focus inside itself',
  );

  const escapeStart = app.indexOf("document.addEventListener('keydown', (event) => {");
  const escapeEnd = app.indexOf("\n$('registerMaker')", escapeStart);
  const escapeHandler = app.slice(escapeStart, escapeEnd);
  assert.ok(escapeStart >= 0 && escapeEnd > escapeStart);
  assert.ok(
    escapeHandler.indexOf("confirmActionModal').classList.contains('active')")
      < escapeHandler.indexOf("makerLifecycleManagerModal')?.classList.contains('active')"),
    'Escape must close the top confirmation before the lifecycle dialog underneath',
  );
});

test('historical lifecycle controls identify and confirm their exact immutable version', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const renderStart = app.indexOf('function renderMakerLifecycleManager()');
  const renderEnd = app.indexOf('\nfunction openMakerLifecycleManager', renderStart);
  const render = app.slice(renderStart, renderEnd);
  assert.match(render, /makerLifecycleVersionActionLabel\([^,]+, version\)/);
  assert.match(
    render,
    /data-lifecycle-action="history-restore:\$\{target\}" aria-label="\$\{escapeHtml\(makerLifecycleVersionActionLabel\(restoreLabel, version\)\)\}"/,
  );
  assert.match(
    render,
    /data-lifecycle-action="\$\{version\.mintingEnabled \? 'history-pause' : 'history-resume'\}:\$\{target\}" aria-label="\$\{escapeHtml\(makerLifecycleVersionActionLabel\(pauseOrResumeLabel, version\)\)\}"/,
  );
  assert.match(
    render,
    /data-lifecycle-action="history-archive:\$\{target\}" aria-label="\$\{escapeHtml\(makerLifecycleVersionActionLabel\(archiveLabel, version\)\)\}"/,
  );

  const handlerStart = app.indexOf('async function handleMakerLifecycleAction(action)');
  const handlerEnd = app.indexOf('\nfunction requestDeletePart', handlerStart);
  const handler = app.slice(handlerStart, handlerEnd);
  assert.match(handler, /const targetLabel = makerLifecycleVersionTargetLabel\(version\)/);
  for (const action of ['history-pause', 'history-resume', 'history-archive', 'history-restore']) {
    const start = handler.indexOf(`historyAction === '${action}'`);
    assert.notEqual(start, -1, `${action} must be handled`);
    const end = handler.indexOf("\n    if (historyAction === '", start + 1);
    const block = handler.slice(start, end === -1 ? handler.length : end);
    assert.match(block, /openConfirmation\(\{/);
    assert.match(block, /targetLabel/);
    assert.match(block, /version\.versionId/);
  }
});

test('published Maker history stays under one stable card and every historical write revalidates its target', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(
    html,
    /id="makerLifecycleVersionHistory" class="maker-lifecycle-version-history-list"/,
  );
  assert.match(
    app,
    /const id = recoveredTemplate\?\.id[\s\S]*?belongsToActiveCreatorLineage && stableRootMakerId \? stableRootMakerId/,
    'a fresh owned v5 chain Maker must use its stable root as the single Library identity',
  );
  assert.match(
    app,
    /discoveredMakerVersionSupersedesCurrent\(\{[\s\S]*?currentVersionNumber: stableCurrentVersionNumber,[\s\S]*?incomingVersionNumber,[\s\S]*?keepPersistedOrNewerCurrent = !incomingSupersedesCurrent/,
    'out-of-order hydration must deterministically promote a newer successor instead of trusting completion order',
  );
  assert.match(
    app,
    /bindingPinned: Boolean\(stableRootTemplate\?\.chainBindingPinned\)/,
    'a durable Workspace binding must take precedence over discovery ordering',
  );
  assert.match(
    app,
    /Older immutable objects[\s\S]*?setPublishedMakerVersionHistory\(stableRootTemplate,[\s\S]*?return true;/,
    'older objects must be appended to history without replacing the editor model',
  );

  const authorityStart = app.indexOf('async function refreshPublishedMakerVersionAuthority(');
  const authorityEnd = app.indexOf(
    '\nasync function refreshPublishedMakerVersionAuthorityAfterWrite',
    authorityStart,
  );
  const authority = app.slice(authorityStart, authorityEnd);
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  assert.match(authority, /operation\?\.targetMakerObjectId/);
  assert.match(authority, /getMakerObjects\(\[makerObjectId\], \{ expectedStructName: 'OCMaker' \}\)/);
  assert.match(authority, /listOwnedMakerAdminCaps\(walletAddress\)/);
  assert.match(
    authority,
    /candidate\.objectId\) === linkedAdminCapId[\s\S]*?maker_id[\s\S]*?treasury_id/,
    'the fresh AdminCap must link to the exact historical Maker and Treasury before signing',
  );

  const archiveStart = app.indexOf('async function updateHistoricalMakerArchiveState(');
  const archiveEnd = app.indexOf(
    '\nasync function updateHistoricalMakerAuthorizationState',
    archiveStart,
  );
  const archive = app.slice(archiveStart, archiveEnd);
  assert.match(
    archive,
    /refreshPublishedMakerVersionAuthority\(operation\)[\s\S]*?setMakerArchived\(\s*authority\.makerObjectId,\s*authority\.makerAdminCapObjectId/,
  );
  assert.match(
    archive,
    /refreshPublishedMakerVersionAuthorityAfterWrite\(operation,[\s\S]*?candidate\.archived === archived/,
  );

  const authorizationStart = app.indexOf(
    'async function updateHistoricalMakerAuthorizationState(',
  );
  const authorizationEnd = app.indexOf('\nasync function prepareOcUpload', authorizationStart);
  const authorization = app.slice(authorizationStart, authorizationEnd);
  assert.match(
    authorization,
    /refreshPublishedMakerVersionAuthority\(operation\)[\s\S]*?configureMakerEconomics\(\{[\s\S]*?makerId: authority\.makerObjectId,[\s\S]*?adminCapId: authority\.makerAdminCapObjectId/,
  );
  assert.match(
    authorization,
    /refreshPublishedMakerVersionAuthorityAfterWrite\(operation,[\s\S]*?candidate\.mintingEnabled === mintingEnabled/,
  );
  assert.match(
    app,
    /publishedVersions:\s*publishedMakerVersionHistory\(template\)/,
    'the local v6 index must persist every published object under its stable root',
  );
  assert.match(
    app,
    /chainBinding:[\s\S]*?currentWorkspaceChainBinding\(document\)/,
    'Workspace v6 metadata must receive the version history through the chain binding',
  );
});

test('published Maker discovery chooses the newest successor independent of hydration completion order', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function discoveredMakerVersionSupersedesCurrent(');
  const end = app.indexOf('\nfunction normalizedWorkspaceChainBinding', start);
  assert.ok(start >= 0 && end > start);
  const supersedes = runInNewContext(`(${app.slice(start, end)})`);

  const versions = [
    { number: 1, id: 'root-v1', parent: '' },
    { number: 3, id: 'root-v3', parent: 'root-v2' },
    { number: 2, id: 'root-v2', parent: 'root-v1' },
  ];
  let current = null;
  const history = [];
  for (const incoming of versions) {
    if (!current || supersedes({
      currentVersionNumber: current.number,
      currentVersionId: current.id,
      incomingVersionNumber: incoming.number,
      incomingParentVersionId: incoming.parent,
    })) {
      if (current) history.push(current);
      current = incoming;
    } else {
      history.push(incoming);
    }
  }
  assert.equal(current.id, 'root-v3');
  assert.deepEqual(
    history.map((entry) => entry.id).sort(),
    ['root-v1', 'root-v2'],
  );
  assert.equal(
    supersedes({
      bindingPinned: true,
      currentVersionNumber: 1,
      currentVersionId: 'root-v1',
      incomingVersionNumber: 3,
      incomingParentVersionId: 'root-v2',
    }),
    false,
    'a durable chain binding must not jump over a missing parent',
  );
  assert.equal(
    supersedes({
      bindingPinned: true,
      currentVersionNumber: 1,
      currentVersionId: 'root-v1',
      incomingVersionNumber: 2,
      incomingParentVersionId: 'root-v1',
    }),
    true,
    'a durable binding must advance to its direct on-chain successor from another session',
  );
  assert.equal(
    supersedes({
      bindingPinned: true,
      hasLocalVersionDraft: true,
      currentVersionNumber: 1,
      currentVersionId: 'root-v1',
      incomingVersionNumber: 2,
      incomingParentVersionId: 'root-v1',
    }),
    false,
    'a local successor draft must be preserved and surfaced as a publication conflict',
  );
  assert.equal(
    supersedes({
      currentVersionNumber: 3,
      currentVersionId: 'root-v3-a',
      currentProfileOrder: 4,
      incomingVersionNumber: 3,
      incomingParentVersionId: '',
      incomingProfileOrder: 5,
    }),
    true,
    'CreatorProfile publication order resolves otherwise equal version metadata',
  );
});

test('live history discovery preserves a paid pause snapshot unless Resume explicitly clears it', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function normalizedPausedEconomicsMutationWitness(');
  const end = app.indexOf('\nfunction currentPublishedMakerVersionRecord', start);
  assert.ok(start >= 0 && end > start);
  const helpers = runInNewContext(`(() => {
    ${app.slice(start, end)}
    return {
      mergePublishedMakerVersions,
      pausedEconomicsForLiveMaker,
      pausedEconomicsWithMutationWitness,
      pausedEconomicsWithRecoveredLocalWitness,
    };
  })()`, {
    suiJsonId: (value) => String(value || ''),
    safeDraftText: (value, fallback = '') => String(value || fallback),
    normalizedMakerUpdatedAtMs: (value) => (
      /^\d+$/.test(String(value || '')) ? String(BigInt(value)) : ''
    ),
    comparableSuiId: (value) => String(value || '').toLowerCase(),
  });
  const pausedEconomics = {
    makerObjectId: '0x1',
    mintFeeEnabled: true,
    mintPriceAtomic: 2_500_000,
    royaltyBps: 300,
    makerUpdatedAtMs: '100',
    capturedAt: '2026-07-28T00:00:00.000Z',
  };
  const persisted = {
    rootMakerId: 'root',
    versionId: 'root-v1',
    versionNumber: 1,
    makerObjectId: '0x1',
    makerAdminCapObjectId: '0xcap',
    mintingEnabled: false,
    pausedEconomics,
  };
  const liveDiscovery = {
    rootMakerId: 'root',
    versionId: 'root-v1',
    versionNumber: 1,
    makerObjectId: '0x1',
    mintingEnabled: false,
  };
  const [preserved] = helpers.mergePublishedMakerVersions(
    [persisted, liveDiscovery],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(preserved.pausedEconomics.mintFeeEnabled, true);
  assert.equal(preserved.pausedEconomics.mintPriceAtomic, 2_500_000);
  assert.equal(
    preserved.makerAdminCapObjectId,
    '0xcap',
    'a source that does not know authority must not erase a known Cap hint',
  );

  const [confirmedPause] = helpers.mergePublishedMakerVersions(
    [persisted, { ...liveDiscovery, makerUpdatedAtMs: '100' }],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(confirmedPause.pausedEconomics.mintPriceAtomic, 2_500_000);

  const pauseWitness = helpers.pausedEconomicsWithMutationWitness(
    pausedEconomics,
    {
      digest: 'pause-digest',
      kind: 'pause',
      expectedMintingEnabled: false,
      expectedArchived: false,
    },
  );
  const staleActive = helpers.pausedEconomicsForLiveMaker(pauseWitness, {
    makerObjectId: '0x1',
    mintingEnabled: true,
    makerUpdatedAtMs: '100',
    makerArchived: false,
    makerPreviousTransaction: 'before-pause',
  });
  assert.equal(staleActive.pendingMutation.digest, 'pause-digest');
  assert.equal(
    staleActive.mintPriceAtomic,
    2_500_000,
    'a stale active read after a successful Pause broadcast must preserve paid economics',
  );

  const visiblePause = helpers.pausedEconomicsForLiveMaker(pauseWitness, {
    makerObjectId: '0x1',
    mintingEnabled: false,
    makerUpdatedAtMs: '200',
    makerArchived: false,
    makerPreviousTransaction: 'pause-digest',
  });
  assert.equal(visiblePause.makerUpdatedAtMs, '200');
  assert.equal(visiblePause.pendingMutation, null);

  const archiveWitness = helpers.pausedEconomicsWithMutationWitness(
    visiblePause,
    {
      digest: 'archive-digest',
      kind: 'archive',
      expectedMintingEnabled: false,
      expectedArchived: true,
    },
  );
  const visibleArchive = helpers.pausedEconomicsForLiveMaker(archiveWitness, {
    makerObjectId: '0x1',
    mintingEnabled: false,
    makerUpdatedAtMs: '300',
    makerArchived: true,
    makerPreviousTransaction: 'archive-digest',
  });
  assert.equal(visibleArchive.makerUpdatedAtMs, '300');
  assert.equal(visibleArchive.pendingMutation, null);
  assert.equal(visibleArchive.mintPriceAtomic, 2_500_000);

  const archiveOverPendingPause = helpers.pausedEconomicsWithMutationWitness(
    pauseWitness,
    {
      digest: 'archive-after-pause-digest',
      kind: 'archive',
      expectedMintingEnabled: false,
      expectedArchived: true,
    },
  );
  const staleArchiveRead = helpers.pausedEconomicsForLiveMaker(
    archiveOverPendingPause,
    {
      makerObjectId: '0x1',
      mintingEnabled: true,
      makerUpdatedAtMs: '100',
      makerArchived: false,
      makerPreviousTransaction: 'before-pause',
    },
  );
  assert.equal(
    staleArchiveRead.pendingMutation.digest,
    'archive-after-pause-digest',
  );
  const visibleArchiveAfterPendingPause = helpers.pausedEconomicsForLiveMaker(
    archiveOverPendingPause,
    {
      makerObjectId: '0x1',
      mintingEnabled: false,
      makerUpdatedAtMs: '350',
      makerArchived: true,
      makerPreviousTransaction: 'archive-after-pause-digest',
    },
  );
  assert.equal(visibleArchiveAfterPendingPause.makerUpdatedAtMs, '350');
  assert.equal(visibleArchiveAfterPendingPause.pendingMutation, null);

  assert.equal(
    helpers.pausedEconomicsForLiveMaker(pauseWitness, {
      makerObjectId: '0x1',
      mintingEnabled: false,
      makerUpdatedAtMs: '300',
      makerArchived: false,
      makerPreviousTransaction: 'external-repause',
    }),
    null,
    'an unrelated later digest must invalidate an old pause witness',
  );

  const recoveredWitness = helpers.pausedEconomicsWithRecoveredLocalWitness(
    pausedEconomics,
    pauseWitness,
    '0x1',
  );
  assert.equal(
    recoveredWitness.pendingMutation.digest,
    'pause-digest',
    'localStorage may recover the witness when the second IndexedDB write failed',
  );
  assert.equal(
    helpers.pausedEconomicsWithRecoveredLocalWitness(null, pauseWitness, '0x1'),
    null,
    'a durable Resume tombstone must remain authoritative',
  );

  const [staleMerged] = helpers.mergePublishedMakerVersions(
    [{
      ...persisted,
      mintingEnabled: false,
      pausedEconomics: pauseWitness,
    }, {
      ...liveDiscovery,
      mintingEnabled: true,
      makerUpdatedAtMs: '100',
      makerPreviousTransaction: 'before-pause',
    }],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(staleMerged.pausedEconomics.pendingMutation.digest, 'pause-digest');

  const [externalResume] = helpers.mergePublishedMakerVersions(
    [persisted, {
      ...liveDiscovery,
      mintingEnabled: true,
      makerUpdatedAtMs: '200',
      makerPreviousTransaction: 'resume-digest',
    }],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(externalResume.pausedEconomics, null);

  const [externalRepause] = helpers.mergePublishedMakerVersions(
    [persisted, {
      ...liveDiscovery,
      makerUpdatedAtMs: '300',
      makerPreviousTransaction: 'repause-digest',
    }],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(
    externalRepause.pausedEconomics,
    null,
    'a newer pause mutation must never restore an older paid price snapshot',
  );

  const [cleared] = helpers.mergePublishedMakerVersions(
    [persisted, { ...liveDiscovery, pausedEconomics: null }],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(cleared.pausedEconomics, null);

  const [transferred] = helpers.mergePublishedMakerVersions(
    [persisted, { ...liveDiscovery, makerAdminCapObjectId: '' }],
    { rootMakerId: 'root', currentMakerObjectId: '0x1' },
  );
  assert.equal(
    transferred.makerAdminCapObjectId,
    '',
    'an explicit live authority loss must clear the stale Cap hint',
  );
});

test('Maker lifecycle manager copy has exact five-language key and interpolation parity', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const copy = staticObjectFromSource(app, 'makerLifecycleManagerI18n');
  const conflictCopy = staticObjectFromSource(
    app,
    'makerLifecycleConflictI18n',
  );
  const requiredKeys = [
    'makerLifecycleManagerKicker',
    'makerLifecycleManagerTitle',
    'makerLifecycleManagerCopy',
    'makerLifecycleManagerClose',
    'makerLifecycleManagerOpenEditor',
    'makerLifecycleManagerInspectEditor',
    'makerLifecycleManage',
    'makerLifecycleWorkingVersion',
    'makerLifecyclePublishedVersion',
    'makerLifecycleVersionHistoryTitle',
    'makerLifecycleVersionHistoryCopy',
    'makerLifecycleVersionCurrent',
    'makerLifecycleVersionPrevious',
    'makerLifecycleVersionHistoryEmpty',
    'makerLifecycleVersionHistoryNoAuthority',
    'makerLifecycleNoPublishedVersion',
    'makerLifecycleLocalScope',
    'makerLifecycleChainScope',
    'makerLifecycleVersion',
    'makerLifecycleObject',
    'makerLifecycleAuthority',
    'makerLifecycleAuthorityReady',
    'makerLifecycleAuthorityUnavailable',
    'makerLifecycleActionContinue',
    'makerLifecycleActionRelease',
    'makerLifecycleActionPublishVersion',
    'makerLifecycleActionStartVersion',
    'makerLifecycleActionDiscardVersion',
    'makerLifecycleActionPause',
    'makerLifecycleActionResume',
    'makerLifecycleActionResumeFree',
    'makerLifecycleActionArchive',
    'makerLifecycleActionRestore',
    'makerLifecycleActionDeleteDraft',
    'makerLifecycleDraftActionCopy',
    'makerLifecyclePublishingActionCopy',
    'makerLifecycleRecoverableActionCopy',
    'makerLifecycleActiveActionCopy',
    'makerLifecyclePausedActionCopy',
    'makerLifecycleArchivedActionCopy',
    'makerLifecycleVersionDraftActionCopy',
    'makerLifecycleStartVersionCopy',
    'makerLifecycleDiscardVersionTitle',
    'makerLifecycleDiscardVersionCopy',
    'makerLifecycleDiscardVersionConfirm',
    'makerLifecyclePauseTitle',
    'makerLifecyclePauseCopy',
    'makerLifecyclePauseConfirm',
    'makerLifecycleResumeTitle',
    'makerLifecycleResumeCopy',
    'makerLifecycleResumeFreeCopy',
    'makerLifecycleResumeConfirm',
    'makerLifecycleResumeFreeConfirm',
    'makerLifecycleEconomicsSnapshotSaveFailed',
    'makerLifecyclePermanentRetirementTitle',
    'makerLifecyclePermanentRetirementCopy',
    'makerLifecycleVersionWarning',
    'makerLifecycleNoAuthority',
    'makerLifecycleStatusReady',
    'makerLifecycleChainVersionImmutable',
    'makerLifecycleExistingOcSafe',
    'makerLifecycleNewVersionSeparate',
    'makerLifecycleActionUnavailable',
    'makerLifecycleVersionStarted',
    'makerLifecycleVersionDiscarded',
  ].sort();
  const interpolationTokens = (value) => [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(Object.keys(copy), ['en', 'zh', 'ja', 'ko', 'vi']);
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    assert.deepEqual(
      Object.keys(copy[locale]).sort(),
      requiredKeys,
      `${locale} must expose the complete lifecycle manager dictionary`,
    );
    requiredKeys.forEach((key) => {
      assert.ok(String(copy[locale][key]).trim(), `${locale}.${key} must not be blank`);
      assert.deepEqual(
        interpolationTokens(copy[locale][key]),
        interpolationTokens(copy.en[key]),
        `${locale}.${key} must preserve interpolation tokens`,
      );
    });
    assert.deepEqual(
      Object.keys(conflictCopy[locale] || {}).sort(),
      ['makerVersionDraftConflict', 'makerVersionLineageFork'],
    );
    assert.deepEqual(
      interpolationTokens(conflictCopy[locale].makerVersionDraftConflict),
      ['parent', 'version'],
    );
    assert.deepEqual(
      interpolationTokens(conflictCopy[locale].makerVersionLineageFork),
      ['parent', 'versions'],
    );
  }
});

test('Maker lifecycle manager preserves released-version control and maps only supported reversible actions', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  const lifecycleRenderStart = app.indexOf('function renderMakerLifecycle()');
  const lifecycleRenderEnd = app.indexOf('\nfunction lifecycleFact', lifecycleRenderStart);
  const lifecycleRender = app.slice(lifecycleRenderStart, lifecycleRenderEnd);
  assert.ok(lifecycleRenderStart >= 0 && lifecycleRenderEnd > lifecycleRenderStart);
  const chainManageableStart = lifecycleRender.indexOf('const chainManageable');
  const chainManageableEnd = lifecycleRender.indexOf('const economicsManageable', chainManageableStart);
  const chainManageable = lifecycleRender.slice(chainManageableStart, chainManageableEnd);
  assert.match(chainManageable, /!releaseLocked[\s\S]*?lifecycle\.published[\s\S]*?Boolean\(state\.makerObjectId\)/);
  assert.doesNotMatch(
    chainManageable,
    /versionDraft/,
    'a version draft must not hide Archive/Restore controls for the previous chain version',
  );
  assert.match(lifecycleRender, /const economicsManageable = chainManageable && !lifecycle\.versionDraft;/);

  const managerRenderStart = app.indexOf('function renderMakerLifecycleManager()');
  const managerRenderEnd = app.indexOf('\nfunction openMakerLifecycleManager', managerRenderStart);
  const managerRender = app.slice(managerRenderStart, managerRenderEnd);
  assert.ok(managerRenderStart >= 0 && managerRenderEnd > managerRenderStart);
  for (const action of [
    'open-release',
    'start-version',
    'discard-version',
    'pause-authorizations',
    'resume-authorizations',
    'archive-chain',
    'restore-chain',
    'delete-draft',
  ]) {
    assert.match(managerRender, new RegExp(`['"]${action}['"]`), `${action} must be rendered when applicable`);
  }
  assert.match(
    managerRender,
    /if \(lifecycle\.published\)\s*\{[\s\S]*?'restore-chain'[\s\S]*?'archive-chain'/,
    'published-version actions must remain available while a successor version draft is open',
  );

  const authorizationStart = app.indexOf('async function updateMakerSoulAuthorizationState(mintingEnabled)');
  const authorizationEnd = app.indexOf('\nasync function prepareOcUpload()', authorizationStart);
  const authorization = app.slice(authorizationStart, authorizationEnd);
  assert.ok(authorizationStart >= 0 && authorizationEnd > authorizationStart);
  const configureIndex = authorization.indexOf('await configureMakerEconomics({');
  const refreshIndexes = [...authorization.matchAll(/await refreshMakerLifecycleAuthority(?:AfterWrite)?\(operation(?:,|\))/g)]
    .map((match) => match.index);
  assert.ok(configureIndex >= 0, 'pause/resume must write through configureMakerEconomics');
  assert.ok(refreshIndexes.length >= 2, 'pause/resume must refresh authority before and after the write');
  assert.ok(refreshIndexes[0] < configureIndex, 'authority must be refreshed before configureMakerEconomics');
  assert.ok(
    refreshIndexes.some((index) => index > configureIndex),
    'confirmed chain state must be read back after configureMakerEconomics',
  );
  const workspaceSyncStart = app.indexOf('function syncV4WorkspaceState({');
  const workspaceSyncEnd = app.indexOf('\nfunction syncPlayerV4State', workspaceSyncStart);
  const workspaceSync = app.slice(workspaceSyncStart, workspaceSyncEnd);
  assert.match(
    workspaceSync,
    /const targetPublished = targetTemplate\.source === 'chain'[\s\S]*?if \(!targetPublished\)\s*\{[\s\S]*?mintingEnabled:/,
    'background Workspace saves must not replace inactive chain economics with version-draft values',
  );
  assert.match(
    workspaceSync,
    /if \(!makerIsPublished\(\)\)\s*\{[\s\S]*?mintingEnabled:/,
    'active Workspace saves must preserve the refreshed chain lifecycle state',
  );

  const handlerStart = app.indexOf('async function handleMakerLifecycleAction(action)');
  const handlerEnd = app.indexOf('\nasync function updateMakerArchiveState', handlerStart);
  const handler = app.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const mappings = [
    ['open-release', /await openMakerReleaseFromLifecycle\(\)/],
    ['start-version', /await beginMakerVersionDraft\(\)/],
    ['discard-version', /action:\s*discardMakerVersionDraft/],
    ['pause-authorizations', /action:\s*\(\) => updateMakerSoulAuthorizationState\(false\)/],
    ['resume-authorizations', /action:\s*\(\) => updateMakerSoulAuthorizationState\(true\)/],
    ['archive-chain', /action:\s*\(\) => updateMakerArchiveState\(true\)/],
    ['restore-chain', /await updateMakerArchiveState\(false\)/],
    ['delete-draft', /requestDeleteMaker\(\)/],
  ];
  mappings.forEach(([action, effect]) => {
    const actionStart = handler.indexOf(`if (action === '${action}')`);
    assert.notEqual(actionStart, -1, `${action} must have a handler`);
    const nextAction = handler.indexOf("\n  if (action === '", actionStart + 1);
    const actionBody = handler.slice(actionStart, nextAction === -1 ? handler.length : nextAction);
    assert.match(actionBody, effect, `${action} must map to its production effect`);
  });

  const retirementStart = html.indexOf('<aside id="makerLifecyclePermanentRetirement"');
  const retirementEnd = html.indexOf('</aside>', retirementStart);
  const retirement = html.slice(retirementStart, retirementEnd);
  assert.ok(retirementStart >= 0 && retirementEnd > retirementStart);
  assert.match(retirement, /\shidden(?:\s|>)/);
  assert.match(retirement, /data-i18n="makerLifecyclePermanentRetirementTitle"/);
  assert.match(retirement, /data-i18n="makerLifecyclePermanentRetirementCopy"/);
  assert.doesNotMatch(retirement, /<button|data-lifecycle-action=/);
  assert.doesNotMatch(html, /data-lifecycle-action="(?:retire|supersede)[^"]*"/i);
  assert.doesNotMatch(handler, /action === '(?:retire|supersede)[^']*'/i);
  assert.doesNotMatch(
    app,
    /\b(?:retire|supersede)Maker(?:Onchain|OnChain)?\s*\(/i,
    'permanent retirement must not expose an unreviewed write path',
  );
});

test('Maker lifecycle writes preserve paid economics and wait for visible chain convergence', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const authorizationStart = app.indexOf('async function updateMakerSoulAuthorizationState(mintingEnabled)');
  const authorizationEnd = app.indexOf('\nasync function prepareOcUpload()', authorizationStart);
  const authorization = app.slice(authorizationStart, authorizationEnd);
  const configureIndex = authorization.indexOf('transaction = await configureMakerEconomics({');
  const snapshotIndex = authorization.indexOf('pausedEconomics = setActivePausedEconomicsSnapshot({');
  const requiredSaveIndex = authorization.indexOf('await persistActiveMakerLifecycleBinding({ required: true })');
  assert.ok(snapshotIndex >= 0 && snapshotIndex < requiredSaveIndex && requiredSaveIndex < configureIndex);
  const witnessIndex = authorization.indexOf(
    'pausedEconomicsWithMutationWitness(',
    configureIndex,
  );
  const witnessSaveIndex = authorization.indexOf(
    'await persistActiveMakerLifecycleBinding({ required: true })',
    witnessIndex,
  );
  const readbackIndex = authorization.indexOf(
    'await refreshMakerLifecycleAuthorityAfterWrite(operation',
    witnessSaveIndex,
  );
  assert.ok(
    configureIndex < witnessIndex
      && witnessIndex < witnessSaveIndex
      && witnessSaveIndex < readbackIndex,
    'the Pause digest witness must be durable before the first readback poll',
  );
  assert.match(authorization, /mintFeeEnabled:\s*authority\.mintFeeEnabled/);
  assert.match(authorization, /mintPriceAtomic:\s*authority\.mintPriceAtomic/);
  assert.match(authorization, /Boolean\(pausedEconomics\?\.mintFeeEnabled\)/);
  assert.match(authorization, /Number\(pausedEconomics\?\.mintPriceAtomic \|\| 0\)/);
  assert.match(authorization, /const royaltyBps = authority\.royaltyBps/);
  assert.match(
    authorization,
    /if \(mintingEnabled\) \{\s*setActivePausedEconomicsSnapshot\(null\);\s*\}/,
  );
  assert.match(
    authorization,
    /pendingPause\?\.expectedMintingEnabled === false[\s\S]*?makerStateReadbackPending/,
    'an immediate Resume must wait while a successful Pause is not visible yet',
  );

  const manualStart = app.indexOf("$('updateMakerEconomics')?.addEventListener('click'");
  const manualEnd = app.indexOf("$('withdrawMakerRevenue')?.addEventListener('click'", manualStart);
  const manual = app.slice(manualStart, manualEnd);
  assert.match(manual, /authority\.mintingEnabled && !mintingEnabled[\s\S]*?setActivePausedEconomicsSnapshot\(\{[\s\S]*?persistActiveMakerLifecycleBinding\(\{ required: true \}\)/);
  assert.match(manual, /!authority\.mintingEnabled && mintingEnabled[\s\S]*?activePausedEconomicsSnapshot\(\)/);
  assert.match(
    manual,
    /configureMakerEconomics\(\{[\s\S]*?pausedEconomicsWithMutationWitness\([\s\S]*?persistActiveMakerLifecycleBinding\(\{ required: true \}\)[\s\S]*?refreshMakerLifecycleAuthorityAfterWrite/,
  );

  const archiveStart = app.indexOf('async function updateMakerArchiveState(archived)');
  const archiveEnd = app.indexOf(
    '\nasync function updateMakerSoulAuthorizationState',
    archiveStart,
  );
  const archive = app.slice(archiveStart, archiveEnd);
  assert.match(
    archive,
    /setMakerArchived\([\s\S]*?pausedEconomicsWithMutationWitness\([\s\S]*?persistActiveMakerLifecycleBinding\(\{ required: true \}\)[\s\S]*?refreshMakerLifecycleAuthorityAfterWrite/,
    'Archive and Restore must replace any pending Pause witness before readback',
  );
  assert.doesNotMatch(
    archive,
    /pausedEconomics\s*&&\s*!authority\.mintingEnabled/,
  );

  const historicalArchiveStart = app.indexOf(
    'async function updateHistoricalMakerArchiveState(',
  );
  const historicalArchiveEnd = app.indexOf(
    '\nasync function updateHistoricalMakerAuthorizationState',
    historicalArchiveStart,
  );
  const historicalArchive = app.slice(
    historicalArchiveStart,
    historicalArchiveEnd,
  );
  assert.match(
    historicalArchive,
    /setMakerArchived\([\s\S]*?pausedEconomicsWithMutationWitness\([\s\S]*?persistActiveMakerLifecycleBinding\(\{ required: true \}\)[\s\S]*?refreshPublishedMakerVersionAuthorityAfterWrite/,
  );
  assert.doesNotMatch(
    historicalArchive,
    /pausedEconomics\s*&&\s*!authority\.mintingEnabled/,
  );

  const historicalAuthorizationStart = app.indexOf(
    'async function updateHistoricalMakerAuthorizationState(',
  );
  const historicalAuthorizationEnd = app.indexOf(
    '\nasync function prepareOcUpload',
    historicalAuthorizationStart,
  );
  const historicalAuthorization = app.slice(
    historicalAuthorizationStart,
    historicalAuthorizationEnd,
  );
  assert.match(
    historicalAuthorization,
    /configureMakerEconomics\(\{[\s\S]*?pausedEconomicsWithMutationWitness\([\s\S]*?persistActiveMakerLifecycleBinding\(\{ required: true \}\)[\s\S]*?refreshPublishedMakerVersionAuthorityAfterWrite/,
  );
  assert.match(
    historicalAuthorization,
    /pendingPause\?\.expectedMintingEnabled === false[\s\S]*?makerStateReadbackPending/,
  );

  const readbackStart = app.indexOf('async function refreshMakerLifecycleAuthorityAfterWrite(');
  const readbackEnd = app.indexOf('\nasync function recoverPublishedMakerIndex', readbackStart);
  const readback = app.slice(readbackStart, readbackEnd);
  assert.match(readback, /matches = \(\) => true/);
  assert.match(readback, /if \(matches\(result\)\) return result/);
  assert.match(readback, /MAKER_STATE_NOT_CONFIRMED/);
  assert.match(readback, /const delays = \[0, 250, 600, 1_200, 2_400\]/);
});

test('published version drafts rebuild as one chain-bound successor after refresh', async () => {
  const [app, workspace] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /\n\s*chainBinding,\n/);
  assert.match(workspace, /publishedSnapshot:\s*publishedDocument/);
  assert.match(workspace, /metadata:\s*clone\(saved\.metadata \|\| \{\}\)/);
  assert.match(
    workspace,
    /force[\s\S]*?!stateBeforeSave\.dirty[\s\S]*?stateBeforeSave\.persistedRevision[\s\S]*?requestedStore\.replace/,
    'a metadata-only publication binding must advance the durable revision',
  );

  const stableRecovery = app.slice(
    app.indexOf('async function recoverStableMakerIndex'),
    app.indexOf('\nfunction currentDraftRecoveryRecord'),
  );
  assert.match(stableRecovery, /normalizedWorkspaceChainBinding/);
  assert.match(stableRecovery, /source:\s*chainBinding \? 'chain' : 'local'/);
  assert.match(stableRecovery, /publishedMakerDocumentV4:\s*publishedSnapshot\?\.document/);
  assert.match(stableRecovery, /comparableSuiId\(candidate\.objectId\)/);

  const hydration = app.slice(
    app.indexOf('async function hydrateChainMaker'),
    app.indexOf('\nasync function loadChainMakers'),
  );
  assert.match(hydration, /stableRootMakerId/);
  assert.match(hydration, /recoveredByStableRoot/);
  assert.match(hydration, /const isSuccessorDraft = Boolean/);
  assert.match(hydration, /makerDocumentV4:\s*recoveredDocument/);
  assert.match(hydration, /publishedMakerDocumentV4:\s*chainDocument/);
  assert.match(
    hydration,
    /hasLocalVersionDraft:\s*makerModelHasPendingV4Version\(stableRootModel\)/,
    'cross-device direct successors must advance a clean pinned binding without overwriting a local draft',
  );
  assert.match(
    app,
    /function makerVersionDraftConflict\([\s\S]*?findMakerVersionDraftConflict\([\s\S]*?currentMakerObjectId/,
    'draft conflicts must be delegated to object-identity-aware lineage logic',
  );
  assert.doesNotMatch(
    app.slice(
      app.indexOf('function makerVersionDraftConflict'),
      app.indexOf('\nfunction directPublishedMakerSuccessor'),
    ),
    /version\.versionId !== workingDocument\.version\.versionId/,
    'same deterministic version IDs from different Sui objects must still conflict',
  );
  assert.match(
    app,
    /externalPublicationIssues:\s*\[[\s\S]*?external_version_lineage_fork[\s\S]*?external_version_draft_conflict/,
    'a competing chain successor must block the Creator preflight',
  );
  const publishActions = app.slice(
    app.indexOf('function renderPublishAction'),
    app.indexOf('\nfunction renderChainStatus'),
  );
  assert.match(
    publishActions,
    /const versionDraftConflict = makerVersionDraftConflict\(\)/,
    'the certified release action must recompute the active version conflict',
  );
  assert.match(
    publishActions,
    /publish:\s*!locked[\s\S]*?&& !versionDraftConflict[\s\S]*?state\.makerUploadStage === 'certified'/,
    'a certified Quilt must not re-enable Publish Maker after a competing successor is known',
  );
  const publicationGuard = app.slice(
    app.indexOf('async function assertMakerPublicationStillValid'),
    app.indexOf('\nasync function publishCurrentMaker'),
  );
  const lineageRefresh = app.slice(
    app.indexOf('async function refreshOwnedMakerVersionLineage'),
    app.indexOf('\nasync function loadChainMakers'),
  );
  assert.match(
    lineageRefresh,
    /Promise\.all\(\[[\s\S]*?listOwnedMakerAdminCaps\(owner\)[\s\S]*?listOwnedCreatorProfiles\(owner\)/,
    'final lineage refresh must include CreatorProfile publications whose AdminCap was transferred',
  );
  assert.match(
    lineageRefresh,
    /profileMakerIds[\s\S]*?makerIdsByComparable[\s\S]*?profilePublished:\s*profileOrder !== undefined/,
    'profile-listed Maker objects must become lineage witnesses without gaining management authority',
  );
  assert.match(
    app.slice(
      app.indexOf('async function hydrateChainMaker'),
      app.indexOf('\nasync function reconcileOwnedMakerSuccessors'),
    ),
    /object\.owned \|\| object\.profilePublished[\s\S]*?keepPersistedOrNewerCurrent \|\| !object\.owned/,
    'profile-only lineage witnesses must join the stable root without replacing its controlled current object',
  );
  assert.match(
    publicationGuard,
    /refreshOwnedMakerVersionLineage\([\s\S]*?makerPublicationIssues\(\)/,
    'the final Sui signature gate must refresh owned chain lineage before rerunning preflight',
  );
  const publishFlow = app.slice(
    app.indexOf('async function publishCurrentMaker'),
    app.indexOf('\nasync function reviewPendingMakerPublication'),
  );
  assert.match(
    publishFlow,
    /await assertMakerPublicationStillValid\(operation[\s\S]*?publicationIntentSaving[\s\S]*?await publishMaker\(/,
    'the lineage/preflight guard must run before an awaiting-signature intent and wallet request are created',
  );
  const beginVersion = app.slice(
    app.indexOf('async function beginMakerVersionDraft'),
    app.indexOf('\nasync function discardMakerVersionDraft'),
  );
  assert.match(
    beginVersion,
    /await refreshOwnedMakerVersionLineage\([\s\S]*?rebindRefreshedOwnedMakerWorkspace\([\s\S]*?makerPublishedLineageFork\(\)[\s\S]*?directPublishedMakerSuccessor\(\)[\s\S]*?beginNextVersion/,
    'starting a version must sync and advance the latest known successor before cloning',
  );
  const discardVersion = app.slice(
    app.indexOf('async function discardMakerVersionDraft'),
    app.indexOf('\nasync function handleMakerLifecycleAction'),
  );
  assert.match(
    discardVersion,
    /discardVersionDraft[\s\S]*?await refreshOwnedMakerVersionLineage\([\s\S]*?rebindRefreshedOwnedMakerWorkspace/,
    'discarding a conflicting draft must rebind the workspace to the latest chain successor',
  );
  assert.match(
    workspace,
    /externalPublicationIssues[\s\S]*?external_version_draft_conflict/,
    'the shared Creator Studio must render the shell-level conflict as a blocking issue',
  );
  const reconciliation = app.slice(
    app.indexOf('async function reconcileOwnedMakerSuccessors('),
    app.indexOf('\nasync function loadChainMakers', app.indexOf('async function reconcileOwnedMakerSuccessors(')),
  );
  assert.match(
    reconciliation,
    /makerModelHasPendingV4Version\(model\)[\s\S]*?version\.parentVersionId === currentVersionId[\s\S]*?await hydrateChainMaker\(successorObject/,
    'out-of-order manifests must walk the complete direct-successor chain without overwriting a local version draft',
  );
  assert.match(
    app,
    /await reconcileOwnedMakerSuccessors\(\[\.\.\.byId\.values\(\)\]/,
  );

  const walletTransition = app.slice(
    app.indexOf('async function applyWalletConnection'),
    app.indexOf('\nlet walletConnectionApplyQueue'),
  );
  assert.match(
    walletTransition,
    /recoverStableMakerIndex\(connection\.address\)\.finally\([\s\S]*?loadChainMakers\(connection\.address\)/,
    'stable Workspace identity must hydrate before owned chain Makers are merged',
  );
  assert.match(
    app,
    /walletConnectionApplyQueue[\s\S]*?\.then\(\(\) => applyWalletConnection\(connection\)\)/,
    'wallet transitions must stay ordered while the previous Maker is flushed',
  );
  assert.match(
    app,
    /async function refreshMakerLifecycleAuthority\s*\(/,
    'persisted cap IDs remain hints; chain writes still refresh live authority',
  );
});

test('Maker lifecycle action cards isolate their tones and contain translated copy', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  const actionStart = app.indexOf('function lifecycleActionButton(');
  const actionEnd = app.indexOf('\nfunction makerLifecycleVersionTargetLabel', actionStart);
  const actionRenderer = app.slice(actionStart, actionEnd);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  assert.match(actionRenderer, /const toneAttribute = tone \? ` data-tone=/);
  assert.match(actionRenderer, /class="maker-lifecycle-manager-action"/);
  assert.doesNotMatch(
    actionRenderer,
    /class="maker-lifecycle-manager-action \$\{/,
    'lifecycle cards must not inherit global primary/danger button layout rules',
  );

  assert.match(
    styles,
    /\.maker-lifecycle-manager-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    'desktop lifecycle actions must use readable two-column cards',
  );
  assert.match(
    styles,
    /\.maker-lifecycle-manager-action,\s*\.maker-lifecycle-manager-actions > button\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    'action cards must contain and wrap long translated copy',
  );
  assert.match(
    styles,
    /\.maker-lifecycle-manager-action small,\s*\.maker-lifecycle-manager-actions > button small\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    'action descriptions must never inherit nowrap from a generic button class',
  );
  assert.match(
    styles,
    /\.maker-lifecycle-manager-action:disabled,\s*\.maker-lifecycle-manager-actions > button:disabled\s*\{[^}]*background:\s*var\(--ui-surface-muted\);[^}]*opacity:\s*1;/s,
    'disabled lifecycle actions must remain legible instead of fading the entire card',
  );
});

test('the Sui wallet selector localizes every operational state in all five languages', async () => {
  const [chainRuntime, app] = await Promise.all([
    readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
  ]);
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    assert.match(chainRuntime, new RegExp(`\\n  ${locale}: Object\\.freeze\\(\\{`));
  }
  for (const key of [
    'connect',
    'noneInstalled',
    'back',
    'close',
    'awaiting',
    'accept',
    'cancel',
    'requestCanceled',
    'canceledCopy',
    'failed',
    'failedCopy',
    'retry',
  ]) {
    assert.equal((chainRuntime.match(new RegExp(`    ${key}:`, 'g')) || []).length, 5);
  }
  assert.match(chainRuntime, /new MutationObserver\(translateWalletModal\)/);
  assert.match(chainRuntime, /export function setWalletModalLocale\(locale\)/);
  assert.equal((app.match(/setWalletModalLocale\(state\.locale\)/g) || []).length, 2);
});

test('OC publication requires a fresh completed Player snapshot in every locale', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const runtimeCopy = staticObjectFromSource(app, 'productionRuntimeI18n');
  ['en', 'zh', 'ja', 'ko', 'vi'].forEach((locale) => {
    assert.ok(
      runtimeCopy[locale].completeOcBeforePublishing?.trim(),
      `${locale}.completeOcBeforePublishing is required`,
    );
  });
  assert.match(
    app,
    /if \(requireCompletion && !completion\)[\s\S]*?error\.code = 'OC_COMPLETION_REQUIRED'/,
  );
  const prepareStart = app.indexOf('async function prepareOcUpload()');
  const prepareEnd = app.indexOf('\nasync function registerOcUpload()', prepareStart);
  const prepare = app.slice(prepareStart, prepareEnd);
  assert.equal(
    (prepare.match(/currentMakerV4OcBundle\(\{[^}]*requireCompletion: true[^}]*\}\)/g) || []).length,
    2,
  );
  assert.match(
    prepare,
    /const image = useV4 \? completion\.imageBlob : await renderOcImageBlob\(\);/,
    'Maker v5 publication must upload the exact PNG approved in the final Player preview',
  );
  assert.match(
    prepare,
    /!completion\?\.imageBlob[\s\S]*?error\.code = 'OC_COMPLETION_REQUIRED'/,
    'Maker v5 publication must fail closed when the approved PNG is absent',
  );
});
