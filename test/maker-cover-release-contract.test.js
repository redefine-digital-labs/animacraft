import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  expansionPackIds,
  makerCommerceV5RequiresRelease,
} from '../maker-commerce-v5.js';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

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

function coverHarness(runtimeRecords = [], template = {}, decodeBitmap = async (blob) => {
  if ((await blob.text()).includes('broken-image')) throw new Error('decode failed');
  return { width: 1200, height: 630, close() {} };
}, commerceV5ReleaseEnabled = false) {
  const functions = [
    'makerV4AssetDescriptor',
    'makerV4RuntimeAssetRecord',
    'makerV4RuntimeAssetSource',
    'makerV4HasUsableCover',
    'makerV4ReleaseCoverIsGenerated',
    'makerV4ReleaseCoverBlob',
    'verifyMakerV4ReleaseCoverBlob',
    'makerV4DocumentForRelease',
    'makerV4RuntimeAssetsForRelease',
  ].map(functionSource).join('\n');
  return new Function('runtimeRecords', 'template', 'decodeBitmap', 'commerceV5ReleaseEnabled', 'makerCommerceV5RequiresRelease', 'expansionPackIds', `
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
      commerceV5ReleaseEnabled,
    };
    const prepareMakerV4ProjectionV2Document = (document) => document;
    const walrusQuiltFileUrl = (quiltId, identifier) => \`https://example.test/\${quiltId}/\${identifier}\`;
    const fetchWalrusWithBackoff = async () => { throw new Error('unexpected network request'); };
    const responseBlobWithinLimit = async () => { throw new Error('unexpected network response'); };
    const inspectPngAsset = async () => ({ alphaAnalyzed: true, hasVisiblePixels: true });
    const createImageBitmap = decodeBitmap;
    const t = (key) => key;
    ${functions}
    return {
      makerV4HasUsableCover,
      makerV4ReleaseCoverIsGenerated,
      makerV4ReleaseCoverBlob,
      verifyMakerV4ReleaseCoverBlob,
      makerV4DocumentForRelease,
      makerV4RuntimeAssetsForRelease,
    };
  `)(
    runtimeRecords,
    template,
    decodeBitmap,
    commerceV5ReleaseEnabled,
    makerCommerceV5RequiresRelease,
    expansionPackIds,
  );
}

function chainCoverHarness() {
  const functions = [
    'makerManifestCoverUrl',
    'makerManifestCoverIsGenerated',
    'hydratedMakerCoverUrl',
    'certifiedMakerCoverUrl',
    'assertSuiMakerCoverUrl',
  ].map(functionSource).join('\n');
  return new Function(`
    const isMakerV4Document = (manifest) => Boolean(manifest?.metadata && Array.isArray(manifest?.assets));
    const utf8Length = (value) => new TextEncoder().encode(String(value || '')).length;
    const t = (key, variables) => \`\${key}:\${variables.bytes}/\${variables.maximum}\`;
    const walrusQuiltFileUrl = (quiltId, identifier) => (
      quiltId && identifier
        ? \`https://aggregator.test/v1/blobs/by-quilt-id/\${encodeURIComponent(quiltId)}/\${encodeURIComponent(identifier)}\`
        : ''
    );
    const safeExternalUrl = (value) => {
      try {
        const url = new URL(String(value || ''), 'https://animacraft.test');
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch {
        return '';
      }
    };
    const suiField = (fields, snake, camel) => fields?.[snake] ?? fields?.[camel];
    ${functions}
    return { makerManifestCoverUrl, makerManifestCoverIsGenerated, hydratedMakerCoverUrl, certifiedMakerCoverUrl, assertSuiMakerCoverUrl };
  `)();
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
    sourceDocument: source,
  });
  assert.equal(release.metadata.coverAssetId, 'custom-cover');
  assert.equal(release.assets.length, 1);
  assert.equal(release.assets[0].identifier, 'creator-cover.jpg');

  const runtimeAssets = await harness.makerV4RuntimeAssetsForRelease(release);
  assert.equal(harness.makerV4ReleaseCoverBlob(release, runtimeAssets), creatorCover);
});

test('Maker v4 release never replaces an unavailable creator cover with an OC composite', async () => {
  const harness = coverHarness();
  const source = minimalDocument();

  assert.equal(harness.makerV4HasUsableCover(source), false);
  const release = harness.makerV4DocumentForRelease({
    sourceDocument: source,
  });
  assert.equal(release.metadata.coverAssetId, 'custom-cover');
  assert.equal(release.assets.length, 1);
  assert.equal(harness.makerV4ReleaseCoverIsGenerated(release), false);
  await assert.rejects(
    () => harness.makerV4RuntimeAssetsForRelease(release),
    /makerExplicitCoverRequired/,
  );
});

test('Maker v4 release rejects a Style or background PNG referenced as the cover', async () => {
  const creatorCover = new Blob(['style-artwork'], { type: 'image/jpeg' });
  const harness = coverHarness([{
    assetId: 'custom-cover',
    blob: creatorCover,
    file: creatorCover,
  }]);
  const source = minimalDocument();
  source.assets[0].kind = 'style';

  assert.equal(harness.makerV4HasUsableCover(source), false);
  await assert.rejects(
    () => harness.makerV4RuntimeAssetsForRelease(source),
    /makerExplicitCoverRequired/,
  );
});

test('Maker v4 release verifies the real cover Blob MIME and decodes its pixels', async () => {
  const htmlBlob = new Blob(['<html>not an image</html>'], { type: 'text/html' });
  const htmlHarness = coverHarness([{
    assetId: 'custom-cover',
    blob: htmlBlob,
    file: htmlBlob,
  }]);
  await assert.rejects(
    () => htmlHarness.makerV4RuntimeAssetsForRelease(minimalDocument()),
    /makerExplicitCoverRequired/,
  );

  const brokenImage = new Blob(['broken-image'], { type: 'image/jpeg' });
  const brokenHarness = coverHarness([{
    assetId: 'custom-cover',
    blob: brokenImage,
    file: brokenImage,
  }]);
  await assert.rejects(
    () => brokenHarness.makerV4RuntimeAssetsForRelease(minimalDocument()),
    /makerExplicitCoverRequired/,
  );
});

test('chain hydration trusts the manifest cover Asset when the Sui cover URL is stale', () => {
  const harness = chainCoverHarness();
  const manifest = minimalDocument();
  manifest.assets.unshift({
    id: 'unrelated-image',
    identifier: 'wrong-cover.png',
    kind: 'maker-cover',
    mediaType: 'image/png',
  });

  assert.equal(
    harness.hydratedMakerCoverUrl(manifest, 'certified-quilt', {
      cover_url: 'https://old.example/stale-cover.png',
    }),
    'https://aggregator.test/v1/blobs/by-quilt-id/certified-quilt/creator-cover.jpg',
  );
  manifest.assets.find((asset) => asset.id === manifest.metadata.coverAssetId).kind = 'style';
  assert.equal(
    harness.hydratedMakerCoverUrl(manifest, 'certified-quilt', {
      cover_url: 'https://old.example/style-artwork.png',
    }),
    '',
  );
});

test('publication writes the configured manifest cover Quilt URL, not an unrelated patch URL', () => {
  const harness = chainCoverHarness();
  const manifest = minimalDocument();
  const locations = new Map([
    ['custom-cover', {
      id: 'patch-id-must-not-become-the-cover-source',
      blobId: 'certified-cover-quilt',
    }],
  ]);

  assert.equal(
    harness.certifiedMakerCoverUrl(manifest, 'checkpoint-quilt', locations),
    'https://aggregator.test/v1/blobs/by-quilt-id/certified-cover-quilt/creator-cover.jpg',
  );
  assert.throws(
    () => harness.certifiedMakerCoverUrl(manifest, 'checkpoint-quilt', new Map()),
    /missing the configured Maker cover/,
  );

  const publication = functionSource('publishCurrentMaker');
  assert.match(publication, /publishedCoverUrl\s*=\s*assertSuiMakerCoverUrl\(certifiedMakerCoverUrl\(/);
  assert.match(publication, /coverUrl:\s*publishedCoverUrl/);
});

test('publication blocks an encoded cover URL that exceeds the Sui 512-byte URI cap', () => {
  const harness = chainCoverHarness();
  const manifest = minimalDocument();
  manifest.assets[0].identifier = `${'封'.repeat(60)}.png`;
  assert.ok(
    new TextEncoder().encode(manifest.assets[0].identifier).length <= 512,
    'the Asset identifier itself remains legal for Walrus',
  );
  const coverUrl = harness.makerManifestCoverUrl(manifest, 'certified-quilt');
  assert.ok(new TextEncoder().encode(coverUrl).length > 512);

  assert.throws(
    () => harness.assertSuiMakerCoverUrl(coverUrl),
    (error) => (
      error.code === 'MAKER_COVER_URI_TOO_LONG'
      && error.details.bytes > error.details.maximum
      && error.details.maximum === 512
    ),
  );

  const prepare = appSource.slice(
    appSource.indexOf('async function prepareMakerUpload'),
    appSource.indexOf('\nasync function registerMakerUpload'),
  );
  const checkIndex = prepare.indexOf('assertSuiMakerCoverUrl(makerManifestCoverUrl(');
  const uploadIndex = prepare.indexOf('state.makerUploadSession = uploadSession');
  assert.ok(checkIndex > -1 && checkIndex < uploadIndex, 'the exact URL must fail before an upload session can advance');
  const publish = appSource.slice(
    appSource.indexOf('async function publishCurrentMaker'),
    appSource.indexOf('\nfunction onChainMakerAction'),
  );
  assert.match(publish, /publishedCoverUrl\s*=\s*assertSuiMakerCoverUrl\(certifiedMakerCoverUrl\(/);
});

test('old Maker manifests retain safe cover fallbacks', () => {
  const harness = chainCoverHarness();
  const legacyWithIdentifier = {
    template: {
      coverIdentifier: 'legacy cover.png',
      coverUrl: 'https://legacy.example/direct-cover.png',
    },
  };
  assert.equal(
    harness.hydratedMakerCoverUrl(legacyWithIdentifier, 'legacy-quilt', {
      cover_url: 'https://chain.example/old-cover.png',
    }),
    'https://aggregator.test/v1/blobs/by-quilt-id/legacy-quilt/legacy%20cover.png',
  );

  assert.equal(
    harness.hydratedMakerCoverUrl({
      template: { coverUrl: 'https://legacy.example/direct-cover.png' },
    }, 'legacy-quilt', {
      cover_url: 'https://chain.example/old-cover.png',
    }),
    'https://legacy.example/direct-cover.png',
  );
  assert.equal(
    harness.hydratedMakerCoverUrl({ template: {} }, 'legacy-quilt', {
      cover_url: 'https://chain.example/old-cover.png',
    }),
    'https://chain.example/old-cover.png',
  );
});

test('historical generated OC composites are not presented as public Maker covers', () => {
  const harness = chainCoverHarness();
  const manifest = minimalDocument();
  manifest.metadata.coverAssetId = 'maker-release-cover';
  manifest.assets = [{
    id: 'maker-release-cover',
    identifier: 'maker-cover.png',
    kind: 'maker-cover',
    mediaType: 'image/png',
  }];

  assert.equal(harness.makerManifestCoverIsGenerated(manifest), true);
  assert.equal(
    harness.hydratedMakerCoverUrl(manifest, 'legacy-generated-quilt', {
      cover_url: 'https://chain.example/generated-default-oc.png',
    }),
    '',
  );
  const legacyManifest = {
    template: {
      coverIdentifier: 'maker-cover.png',
      coverUrl: 'https://chain.example/generated-legacy-oc.png',
    },
  };
  assert.equal(harness.makerManifestCoverIsGenerated(legacyManifest), true);
  assert.equal(
    harness.hydratedMakerCoverUrl(legacyManifest, 'legacy-v3-quilt', {
      cover_url: 'https://chain.example/generated-legacy-oc.png',
    }),
    '',
  );
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
  assert.equal((sync.match(/draftCoverUrl:\s*coverUrl/g) || []).length, 2);
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

test('Commerce v5 release disables every legacy v4 mint surface in the immutable document', () => {
  const source = minimalDocument();
  source.publication = {
    mintingEnabled: true,
    mintFeeEnabled: true,
    mintPriceAtomic: 99_000_000,
  };
  const release = coverHarness([], {}, undefined, true)
    .makerV4DocumentForRelease({ sourceDocument: source });

  assert.equal(release.publication.mintingEnabled, false);
  assert.equal(release.publication.mintFeeEnabled, false);
  assert.equal(release.publication.mintPriceAtomic, 0);
});

test('publication never renders an internal OC composite as a Maker cover', () => {
  const prepare = appSource.slice(
    appSource.indexOf('async function prepareMakerUpload'),
    appSource.indexOf('\nasync function registerMakerUpload'),
  );
  assert.doesNotMatch(prepare, /generatedCoverBlob|renderOcImageBlob/);
  assert.match(prepare, /makerV4RuntimeAssetsForRelease\(documentV4\)/);
  assert.match(prepare, /state\.pendingMakerCoverBlob = coverBlob/);
  assert.match(prepare, /LEGACY_MAKER_MIGRATION_REQUIRED/);
  const uploadManifest = functionSource('creatorUploadManifest');
  assert.match(uploadManifest, /LEGACY_MAKER_MIGRATION_REQUIRED/);
  assert.doesNotMatch(uploadManifest, /coverIdentifier/);
  assert.doesNotMatch(appSource, /function makerCoverAsset/);
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
  assert.match(indexPersistence, /draftCoverUrl:\s*stableMakerCoverUrl\(template\.draftCoverUrl\)/);
  assert.match(indexPersistence, /publishedCoverUrl:\s*stableMakerCoverUrl\(template\.publishedCoverUrl\)/);
  assert.match(indexPersistence, /coverUrl:\s*objectId\s*\?\s*''\s*:\s*stableMakerCoverUrl\(record\.coverUrl\)/);
  assert.match(indexPersistence, /publishedCoverUrl:\s*objectId[\s\S]*stableMakerCoverUrl\(record\.publishedCoverUrl\)/);
});

test('session cover object URLs are reused, replaced and revoked by explicit ownership', () => {
  const revoked = [];
  let sequence = 0;
  const template = { id: 'local-maker', coverUrl: '', draftCoverUrl: '', publishedCoverUrl: '' };
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
  assert.equal(template.draftCoverUrl, secondUrl);
  assert.equal(template.publishedCoverUrl, '');

  harness.revokeLocalMakerCoverObjectUrl(template.id);
  assert.deepEqual(revoked, ['blob:session-1', 'blob:session-2']);
  assert.equal(template.draftCoverUrl, '');
});

test('public chain cards and Creator Library use separate published and draft cover fields', () => {
  const coverUrlHarness = new Function(`
    const location = { origin: 'https://animacraft.test' };
    ${functionSource('safeExternalUrl')}
    ${functionSource('displayMakerCoverUrl')}
    ${functionSource('templatePublishedCoverUrl')}
    return { displayMakerCoverUrl, templatePublishedCoverUrl };
  `)();
  const publicRender = appSource.slice(
    appSource.indexOf('function renderTemplates'),
    appSource.indexOf('\nfunction openTemplateDetail'),
  );
  const detailRender = functionSource('renderTemplateDetail');
  const creatorRender = functionSource('renderImageMakerList');
  const hydration = functionSource('hydrateChainMaker');
  const workspaceSync = functionSource('syncV4WorkspaceState');

  assert.match(publicRender, /templatePublishedCoverUrl\(template\)/);
  assert.match(detailRender, /templatePublishedCoverUrl\(template\)/);
  assert.match(creatorRender, /templateLibraryCoverUrl\(template\)/);
  assert.match(creatorRender, /data-maker-cover-image/);
  assert.match(creatorRender, /bindTemplateCoverImageFallbacks/);
  assert.match(hydration, /publishedCoverUrl:\s*hydratedMakerCoverUrl/);
  assert.equal((workspaceSync.match(/draftCoverUrl:\s*coverUrl/g) || []).length, 2);
  assert.doesNotMatch(workspaceSync, /publishedCoverUrl:\s*coverUrl/);
  assert.equal(coverUrlHarness.displayMakerCoverUrl(''), '');
  assert.equal(
    coverUrlHarness.templatePublishedCoverUrl({
      source: 'chain',
      publishedCoverUrl: '',
      draftCoverUrl: 'blob:https://animacraft.test/private-draft-cover',
    }),
    '',
  );
  assert.equal(
    coverUrlHarness.templatePublishedCoverUrl({
      source: 'chain',
      publishedCoverUrl: 'https://aggregator.test/real-maker-cover.png',
    }),
    'https://aggregator.test/real-maker-cover.png',
  );
});

test('a failed public cover request reveals the stable Maker placeholder', () => {
  let errorHandler = null;
  const fallback = {
    hidden: true,
    matches: (selector) => selector === '[data-maker-cover-fallback]',
  };
  const image = {
    hidden: false,
    nextElementSibling: fallback,
    addEventListener: (type, handler) => {
      if (type === 'error') errorHandler = handler;
    },
  };
  const bind = new Function(`
    ${functionSource('bindTemplateCoverImageFallbacks')}
    return bindTemplateCoverImageFallbacks;
  `)();

  bind({ querySelectorAll: () => [image] });
  assert.equal(typeof errorHandler, 'function');
  errorHandler();
  assert.equal(image.hidden, true);
  assert.equal(fallback.hidden, false);
  assert.match(stylesSource, /\.published-cover-placeholder\[hidden\][\s\S]*display:\s*none/);
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
