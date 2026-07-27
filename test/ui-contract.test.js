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
  assert.match(html, /styles\.css\?v=animacraft-dual-theme-v1/);
  assert.match(html, /app\.js\?v=animacraft-dual-theme-v1/);
  assert.match(html, /id="makerV4PlayerMount"/);
  assert.match(html, /id="legacyPlayerEditor"[^>]*hidden/);
  assert.match(app, /buildMakerV4PublicationBundle/);
  assert.match(app, /makerWorkspace\.renderRecipeToBlob\(recipe\)/);
  assert.match(workspace, /renderResolvedScene\(scene, canvas/);
  assert.match(workspace, /data-action="player-none"/);
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
  assert.match(styles, /\.v4-chain-flow button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.v4-chain-status > i\s*\{[^}]*animation:\s*none;/);
  assert.match(workspace, /role="tab" aria-selected=/);
  assert.match(workspace, /else if \(style\.positionConfirmed === false\)/);
  assert.match(workspace, /data-action="focus-issue"/);
  assert.match(workspace, /data-action="style-asset"/);
  assert.match(workspace, /this\.contextEpoch = 0/);
  assert.match(workspace, /this\.contextEpoch !== contextEpoch/);
  assert.match(workspace, /this\.store\.replace\(incoming, context\.recipe \|\| incoming\.defaultRecipe/);
  assert.match(styles, /\.maker-v4-mount\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(styles, /\.v4-canvas-column\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;[^}]*padding:\s*0;/s);
  assert.match(styles, /@media \(max-width:\s*820px\)[\s\S]*?\.creator-function-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(styles, /@media \(max-width:\s*560px\)[\s\S]*?\.v4-studio-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.v4-player-header\s*\{\s*position:\s*relative;/s);
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
  assert.match(app, /state\.makerArchived\s*\?\s*t\('archivedMakerImmutable'\)\s*:\s*t\('publishedMakerImmutable'\)/);
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

  const authorityStart = app.indexOf('async function refreshMakerLifecycleAuthority(operation)');
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
  assert.ok((archiveAction.match(/refreshMakerLifecycleAuthority\(operation\)/g) || []).length >= 2);

  const economicsStart = app.indexOf("$('updateMakerEconomics')?.addEventListener('click'");
  const economicsEnd = app.indexOf("$('withdrawMakerRevenue')?.addEventListener('click'", economicsStart);
  const economicsAction = app.slice(economicsStart, economicsEnd);
  assert.ok(economicsAction.indexOf('await refreshMakerLifecycleAuthority(operation)') < economicsAction.indexOf('await configureMakerEconomics({'));
  assert.ok((economicsAction.match(/refreshMakerLifecycleAuthority\(operation\)/g) || []).length >= 2);

  const withdrawStart = economicsEnd;
  const withdrawEnd = app.indexOf("$('deleteMakerDraft')?.addEventListener", withdrawStart);
  const withdrawAction = app.slice(withdrawStart, withdrawEnd);
  assert.ok(withdrawAction.indexOf('await refreshMakerLifecycleAuthority(operation)') < withdrawAction.indexOf('await withdrawMakerRevenue({'));

  assert.match(html, /id="makerRetirementNotice"[^>]*data-i18n="retirementProtocolUpgrade"/);
  assert.doesNotMatch(html, /id="(?:retire|supersede)Maker/i);
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
