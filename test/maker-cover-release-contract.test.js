import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function functionSource(name) {
  const declaration = `function ${name}`;
  const declarationIndex = appSource.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `missing ${name}`);
  const sourceStart = appSource.slice(declarationIndex - 6, declarationIndex) === 'async '
    ? declarationIndex - 6
    : declarationIndex;
  const bodyStart = appSource.indexOf(') {', declarationIndex + declaration.length) + 2;
  assert.ok(bodyStart > 1, `missing ${name} body`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const character = appSource[index];
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
    else if (character === '}' && --depth === 0) return appSource.slice(sourceStart, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

function coverHarness(runtimeRecords = [], template = {}) {
  const functions = [
    'makerV4AssetDescriptor',
    'makerV4RuntimeAssetRecord',
    'makerV4RuntimeAssetSource',
    'makerV4HasUsableCover',
    'makerV4ReleaseCoverIsGenerated',
    'makerV4ReleaseCoverBlob',
    'makerV4DocumentForRelease',
    'makerV4RuntimeAssetsForRelease',
  ].map(functionSource).join('\n');
  return new Function('runtimeRecords', 'template', `
    const currentV4RuntimeAssets = () => runtimeRecords;
    const activeTemplate = () => template;
    const state = { makerDocumentV4: null };
    const $ = () => null;
    const isMakerV4Document = (document) => Boolean(document?.metadata && document?.canvas);
    const normalizeLivingContent = (livingContent) => livingContent;
    const decimalCoinToAtomic = () => 0;
    const runtimeConfig = {
      network: 'mainnet',
      callablePackageId: '0x1',
      originalPackageId: '0x1',
      paymentCoinType: '0x2::sui::SUI',
      paymentCoinSymbol: 'SUI',
    };
    const prepareMakerV4ProjectionV2Document = (document) => document;
    const walrusQuiltFileUrl = (quiltId, identifier) => \`https://example.test/\${quiltId}/\${identifier}\`;
    const fetchWalrusWithBackoff = async () => { throw new Error('unexpected network request'); };
    const responseBlobWithinLimit = async () => { throw new Error('unexpected network response'); };
    const inspectPngAsset = async () => ({ alphaAnalyzed: true, hasVisiblePixels: true });
    const t = (key) => key;
    ${functions}
    return {
      makerV4HasUsableCover,
      makerV4ReleaseCoverIsGenerated,
      makerV4ReleaseCoverBlob,
      makerV4DocumentForRelease,
      makerV4RuntimeAssetsForRelease,
    };
  `)(runtimeRecords, template);
}

function minimalDocument() {
  return {
    metadata: {
      name: 'Maker',
      summary: 'Summary',
      creator: 'Creator',
      style: 'Style',
      license: { kind: 'personal-use', note: '' },
      coverAssetId: 'custom-cover',
    },
    canvas: { width: 1024, height: 1024 },
    assets: [{
      id: 'custom-cover',
      identifier: 'creator-cover.jpg',
      kind: 'maker-cover',
      mediaType: 'image/jpeg',
      width: 1200,
      height: 630,
      source: 'local',
    }],
    parts: [],
    publication: {},
    runtime: {},
    livingContent: {},
  };
}

test('Maker v4 release preserves a readable creator cover instead of generating a replacement', async () => {
  const creatorCover = new Blob(['creator-cover'], { type: 'image/jpeg' });
  const harness = coverHarness([{
    assetId: 'custom-cover',
    blob: creatorCover,
    file: creatorCover,
    fileName: 'creator-cover.jpg',
  }]);
  const source = minimalDocument();

  assert.equal(harness.makerV4HasUsableCover(source), true);
  const release = harness.makerV4DocumentForRelease({
    includeGeneratedCover: true,
    sourceDocument: source,
  });
  assert.equal(release.metadata.coverAssetId, 'custom-cover');
  assert.equal(release.assets.length, 1);
  assert.equal(release.assets[0].identifier, 'creator-cover.jpg');

  const runtimeAssets = await harness.makerV4RuntimeAssetsForRelease(release);
  assert.equal(harness.makerV4ReleaseCoverBlob(release, runtimeAssets), creatorCover);
});

test('Maker v4 release generates a deterministic fallback only when its configured cover is unavailable', () => {
  const harness = coverHarness();
  const source = minimalDocument();

  assert.equal(harness.makerV4HasUsableCover(source), false);
  const release = harness.makerV4DocumentForRelease({
    includeGeneratedCover: true,
    sourceDocument: source,
  });
  assert.equal(release.metadata.coverAssetId, 'maker-release-cover');
  assert.equal(release.assets.length, 2);
  assert.equal(release.assets.at(-1).source, 'generated-release');
  assert.equal(harness.makerV4ReleaseCoverIsGenerated(release), true);
});

test('a persisted recovery cover wins over a remote runtime record for byte-exact resume', async () => {
  const remoteCover = new Blob(['remote'], { type: 'image/jpeg' });
  const recoveredCover = new Blob(['recovered'], { type: 'image/jpeg' });
  const harness = coverHarness([{
    assetId: 'custom-cover',
    blob: remoteCover,
    file: remoteCover,
    url: 'https://example.test/old-cover.jpg',
  }]);
  const document = minimalDocument();

  const runtimeAssets = await harness.makerV4RuntimeAssetsForRelease(document, recoveredCover);
  assert.equal(harness.makerV4ReleaseCoverBlob(document, runtimeAssets), recoveredCover);
});

test('chain hydration and Workspace projection retain cover, license and display metadata', () => {
  const hydration = appSource.slice(
    appSource.indexOf('function makerModelFromV4Manifest'),
    appSource.indexOf('\nfunction cloneV4Recipe'),
  );
  assert.doesNotMatch(hydration, /metadata\.coverAssetId\s*=\s*null/);
  assert.doesNotMatch(hydration, /assets\s*=\s*editableDocument\.assets\.filter/);

  const sync = appSource.slice(
    appSource.indexOf('function syncV4WorkspaceState'),
    appSource.indexOf('\nfunction syncPlayerV4State'),
  );
  assert.equal((sync.match(/\bcoverUrl,/g) || []).length, 2);
  assert.equal((sync.match(/license:\s*makerV4WorkspaceLicenseLabel/g) || []).length, 2);
  assert.match(sync, /name:\s*document\.metadata\.name/);
  assert.match(sync, /summary:\s*document\.metadata\.summary/);
  assert.match(sync, /creator:\s*document\.metadata\.creator/);
});

test('Maker release metadata stays canonical and chain hydration preserves the creator display name', () => {
  const release = functionSource('makerV4DocumentForRelease');
  assert.doesNotMatch(release, /creatorTemplateName|creatorDescription|creatorName|creatorWorld|creatorLicense/);

  const source = minimalDocument();
  source.metadata = {
    ...source.metadata,
    name: 'Workspace Maker',
    summary: 'Workspace summary',
    creator: 'Human Creator',
    style: 'Workspace style',
    license: { kind: 'free-remix', note: 'Workspace license' },
  };
  const published = coverHarness([{
    assetId: 'custom-cover',
    blob: new Blob(['cover'], { type: 'image/jpeg' }),
  }]).makerV4DocumentForRelease({ sourceDocument: source });
  assert.deepEqual(published.metadata, source.metadata);

  const hydration = appSource.slice(
    appSource.indexOf('async function hydrateChainMaker'),
    appSource.indexOf('\nasync function loadChainMakers'),
  );
  assert.match(
    hydration,
    /creator:\s*String\(templateData\.creator\s*\|\|\s*suiField\(fields,\s*'creator'\)/,
  );
});

test('publication renders a composite cover only for the generated fallback path', () => {
  const prepare = appSource.slice(
    appSource.indexOf('async function prepareMakerUpload'),
    appSource.indexOf('\nasync function registerMakerUpload'),
  );
  assert.match(
    prepare,
    /const generatedCoverBlob = makerV4ReleaseCoverIsGenerated\(documentV4\)\s*\?\s*await renderOcImageBlob/,
  );
  assert.match(prepare, /makerV4RuntimeAssetsForRelease\(documentV4, generatedCoverBlob\)/);
  assert.match(prepare, /state\.pendingMakerCoverBlob = coverBlob/);
});

test('local Maker index never treats a session blob URL as durable cover metadata', () => {
  const stableMakerCoverUrl = new Function('safeExternalUrl', `
    ${functionSource('stableMakerCoverUrl')}
    return stableMakerCoverUrl;
  `)((value) => String(value || ''));

  assert.equal(stableMakerCoverUrl('blob:https://animacraft.example/session-cover'), '');
  assert.equal(
    stableMakerCoverUrl('https://aggregator.walrus.example/v1/blobs/cover'),
    'https://aggregator.walrus.example/v1/blobs/cover',
  );

  const indexPersistence = appSource.slice(
    appSource.indexOf('function persistLocalMakerIndex'),
    appSource.indexOf('\nasync function restoreLocalMakerCoverFromV6'),
  );
  assert.match(indexPersistence, /coverUrl:\s*stableMakerCoverUrl\(template\.coverUrl\)/);
  assert.match(indexPersistence, /coverUrl:\s*stableMakerCoverUrl\(record\.coverUrl\)/);
});

test('session cover object URLs are reused, replaced and revoked by explicit ownership', () => {
  const revoked = [];
  let sequence = 0;
  const template = { id: 'local-maker', coverUrl: '' };
  const harness = new Function('templates', 'urlApi', `
    const URL = urlApi;
    const localMakerCoverObjectUrls = new Map();
    ${functionSource('revokeLocalMakerCoverObjectUrl')}
    ${functionSource('localMakerCoverObjectUrl')}
    return { revokeLocalMakerCoverObjectUrl, localMakerCoverObjectUrl };
  `)([template], {
    createObjectURL: () => `blob:session-${++sequence}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  const firstBlob = new Blob(['first'], { type: 'image/png' });
  const secondBlob = new Blob(['second'], { type: 'image/png' });

  const firstUrl = harness.localMakerCoverObjectUrl(template, 'cover-a', firstBlob);
  assert.equal(firstUrl, 'blob:session-1');
  assert.equal(harness.localMakerCoverObjectUrl(template, 'cover-a', firstBlob), firstUrl);
  assert.deepEqual(revoked, []);

  const secondUrl = harness.localMakerCoverObjectUrl(template, 'cover-b', secondBlob);
  assert.equal(secondUrl, 'blob:session-2');
  assert.deepEqual(revoked, ['blob:session-1']);
  assert.equal(template.coverUrl, secondUrl);

  harness.revokeLocalMakerCoverObjectUrl(template.id);
  assert.deepEqual(revoked, ['blob:session-1', 'blob:session-2']);
  assert.equal(template.coverUrl, '');
});

test('Creator Library restores its cover lazily from the v6 document and asset repository', () => {
  const restore = appSource.slice(
    appSource.indexOf('async function restoreLocalMakerCoverFromV6'),
    appSource.indexOf('\nasync function recoverStableMakerIndex'),
  );
  assert.match(restore, /makerWorkspace\.loadDraftProject\(makerKey\)/);
  assert.match(restore, /loaded\.document\.version\?\.rootMakerId !== makerId/);
  assert.match(restore, /new Map\(\(loaded\.assets \|\| \[\]\)/);
  assert.match(restore, /makerV4WorkspaceCoverUrl\(loaded\.document, assets, currentTemplate\)/);
  assert.match(restore, /renderImageMakerList\(\)/);

  const stableRecovery = appSource.slice(
    appSource.indexOf('async function recoverStableMakerIndex'),
    appSource.indexOf('\nfunction currentDraftRecoveryRecord'),
  );
  assert.match(stableRecovery, /void restoreLocalMakerCoversFromV6\(records, owner\)/);
});
