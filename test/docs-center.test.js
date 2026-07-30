import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import {
  DOCS_CONTENT,
  DOCS_LOCALES,
  DOCS_VERSION,
} from '../docs-center-content.js';
import {
  docsArticleHref,
  docsArticleIdFromHash,
  validateDocsContent,
} from '../docs-center.js';
import {
  DOCS_ARTICLE_FIGURES,
  DOCS_FIGURE_SPECS,
  DOCS_FIGURE_TERMS,
  DOCS_FIGURE_TYPES,
} from '../docs-center-figures.js';

const REQUIRED_ARTICLES = [
  'introduction',
  'player-quick-start',
  'creator-quick-start',
  'data-model',
  'artist-source-files',
  'png-import',
  'canvas-layer-tracks',
  'smart-color',
  'rules',
  'soul-configuration',
  'player-test-preflight',
  'walrus-sui-publish',
  'lifecycle-versions',
  'expansion-packs',
  'chain-truth',
  'troubleshooting',
];

test('Docs handbook ships the complete five-language information architecture', () => {
  const report = validateDocsContent();
  assert.equal(DOCS_VERSION, '0.8.5');
  assert.deepEqual(DOCS_LOCALES, ['en', 'zh', 'ja', 'ko', 'vi']);
  assert.equal(report.locales.length, 5);
  assert.equal(report.categories, 5);
  assert.equal(report.articles, REQUIRED_ARTICLES.length);

  DOCS_LOCALES.forEach((locale) => {
    assert.deepEqual(
      DOCS_CONTENT[locale].articles.map((article) => article.id),
      REQUIRED_ARTICLES,
      `${locale} article order`,
    );
  });
});

test('Docs detail navigation is localized in all five supported languages', () => {
  const expected = {
    en: {
      backToHome: 'Back to all guides',
      onThisPage: 'On this page',
    },
    zh: {
      backToHome: '返回全部指南',
      onThisPage: '本页内容',
    },
    ja: {
      backToHome: 'すべてのガイドに戻る',
      onThisPage: 'このページの内容',
    },
    ko: {
      backToHome: '모든 가이드로 돌아가기',
      onThisPage: '이 페이지의 내용',
    },
    vi: {
      backToHome: 'Quay lại tất cả hướng dẫn',
      onThisPage: 'Trong trang này',
    },
  };

  DOCS_LOCALES.forEach((locale) => {
    assert.equal(DOCS_CONTENT[locale].ui.backToHome, expected[locale].backToHome);
    assert.equal(DOCS_CONTENT[locale].ui.onThisPage, expected[locale].onThisPage);
  });
});

test('Docs home and article detail routes use stable real hash URLs', () => {
  assert.equal(docsArticleIdFromHash('#docs'), '');
  assert.equal(docsArticleIdFromHash('#docs/'), '');
  assert.equal(docsArticleHref(''), '#docs');

  REQUIRED_ARTICLES.forEach((articleId) => {
    const href = `#docs/${articleId}`;
    assert.equal(docsArticleHref(articleId), href);
    assert.equal(docsArticleIdFromHash(href), articleId);
  });

  [
    '#docs/Introduction',
    '#docs/player-quick-start/extra',
    '#docs/player-quick-start?locale=zh',
    '#docs/../creator',
    '#creator',
  ].forEach((hash) => assert.equal(docsArticleIdFromHash(hash), '', hash));
  [
    'Introduction',
    'player quick start',
    'player-quick-start/extra',
    '../creator',
  ].forEach((articleId) => assert.equal(docsArticleHref(articleId), '#docs', articleId));
});

test('Docs describe the production Maker hierarchy and current import behavior honestly', () => {
  const english = JSON.stringify(DOCS_CONTENT.en);
  const chinese = JSON.stringify(DOCS_CONTENT.zh);
  const combined = `${english}\n${chinese}`;

  assert.match(combined, /Maker/);
  assert.match(combined, /Part/);
  assert.match(combined, /Item/);
  assert.match(combined, /Style/);
  assert.match(combined, /PNG/);
  assert.match(combined, /1:1|一比一|原样/);
  assert.match(combined, /center|居中/i);
  assert.match(combined, /scale|缩小|缩放/i);
  assert.doesNotMatch(combined, /Empty LayerBinding|Parent Part/);
});

test('Docs cover player, Rules, Smart Color, Soul, publication, lifecycle, and recovery', () => {
  const articles = new Map(DOCS_CONTENT.en.articles.map((article) => [article.id, article]));
  [
    'player-quick-start',
    'smart-color',
    'rules',
    'soul-configuration',
    'walrus-sui-publish',
    'lifecycle-versions',
    'troubleshooting',
  ].forEach((id) => assert.ok(articles.has(id), id));

  const rules = JSON.stringify(articles.get('rules'));
  assert.match(rules, /requires/i);
  assert.match(rules, /excludes/i);
  assert.match(rules, /ALL/);
  assert.match(rules, /ANY/);
  assert.match(rules, /selected/i);
  assert.match(rules, /visibility/i);

  const publication = JSON.stringify(articles.get('walrus-sui-publish'));
  assert.match(publication, /Prepare/i);
  assert.match(publication, /Register/i);
  assert.match(publication, /Certify/i);
  assert.match(publication, /Publish/i);
});

test('Docs distinguish local drafts, Walrus content, Sui verification, and the Soulidity gate', () => {
  const chainTruth = JSON.stringify(
    DOCS_CONTENT.en.articles.find((article) => article.id === 'chain-truth'),
  );
  assert.match(chainTruth, /IndexedDB|local/i);
  assert.match(chainTruth, /Walrus/);
  assert.match(chainTruth, /Sui/);
  assert.match(chainTruth, /projection/i);
  assert.match(chainTruth, /Soulidity/);
  assert.match(chainTruth, /gate|disabled/i);
});

test('Docs pin the current production boundaries instead of documenting planned behavior', () => {
  const articles = new Map(DOCS_CONTENT.en.articles.map((article) => [
    article.id,
    JSON.stringify(article),
  ]));

  assert.match(articles.get('player-quick-start'), /1,024/);
  assert.match(articles.get('player-quick-start'), /8,388,608/);
  assert.match(articles.get('player-quick-start'), /export-background/);
  assert.match(articles.get('artist-source-files'), /not a generic third-party manifest/i);
  assert.match(articles.get('png-import'), /positionLocked/);
  assert.match(articles.get('png-import'), /positionConfirmed/);
  assert.match(articles.get('png-import'), /20 MB/);
  assert.match(articles.get('canvas-layer-tracks'), /no separate appearance-only lock/i);
  assert.match(articles.get('smart-color'), /at most one channel/i);
  assert.match(articles.get('smart-color'), /browser Renderer/i);
  assert.match(articles.get('rules'), /independent conflicts/i);
  assert.match(articles.get('rules'), /fails closed/i);
  assert.match(articles.get('soul-configuration'), /animacraft-oc\.json/);
  assert.match(articles.get('walrus-sui-publish'), /53 Walrus epochs/);
  assert.match(articles.get('lifecycle-versions'), /no successor link/i);
  assert.match(articles.get('expansion-packs'), /embedded-v1/);
  assert.match(articles.get('expansion-packs'), /not a separately published on-chain object/i);
  assert.match(articles.get('chain-truth'), /does not register a player Recipe/i);

  DOCS_LOCALES.forEach((locale) => {
    const localized = JSON.stringify(DOCS_CONTENT[locale]);
    [
      'positionLocked',
      'embedded-v1',
      'animacraft-oc.json',
      '53',
      'successor',
    ].forEach((marker) => {
      assert.match(localized, new RegExp(marker.replace('.', '\\.')), `${locale}: ${marker}`);
    });
  });
});

test('Docs figures use one trusted structure with complete five-language labels', async () => {
  const articleIds = new Set(DOCS_CONTENT.en.articles.map((article) => article.id));
  const figureTypes = new Set(DOCS_FIGURE_TYPES);
  const englishTermKeys = Object.keys(DOCS_FIGURE_TERMS.en).sort();

  assert.equal(Object.keys(DOCS_FIGURE_SPECS).length, 9);
  assert.equal(Object.keys(DOCS_ARTICLE_FIGURES).length, 12);
  assert.ok(Object.keys(DOCS_ARTICLE_FIGURES).length < REQUIRED_ARTICLES.length);

  DOCS_LOCALES.forEach((locale) => {
    assert.deepEqual(
      Object.keys(DOCS_FIGURE_TERMS[locale]).sort(),
      englishTermKeys,
      `${locale} figure terms`,
    );
    englishTermKeys.forEach((key) => {
      assert.ok(DOCS_FIGURE_TERMS[locale][key].trim(), `${locale}.${key}`);
    });
  });

  Object.entries(DOCS_ARTICLE_FIGURES).forEach(([articleId, figureId]) => {
    assert.ok(articleIds.has(articleId), articleId);
    assert.ok(DOCS_FIGURE_SPECS[figureId], figureId);
  });

  const assets = [];
  Object.values(DOCS_FIGURE_SPECS).forEach((spec) => {
    assert.ok(figureTypes.has(spec.type), spec.type);
    Object.values(spec.assets || {}).forEach((value) => {
      if (typeof value === 'string') assets.push(value);
      if (Array.isArray(value)) {
        value.forEach((entry) => assets.push(typeof entry === 'string' ? entry : entry.src));
      }
    });
  });
  assert.ok(assets.length > 0);
  assets.forEach((src) => assert.match(src, /^\/makers\/[a-z0-9/-]+\.png$/));
  await Promise.all(assets.map((src) => access(new URL(`../public${src}`, import.meta.url))));

  const expectedCover = '/makers/astral-courier/cover.png';
  const coverAssets = Object.values(DOCS_FIGURE_SPECS)
    .map((spec) => spec.assets?.cover)
    .filter(Boolean);
  assert.ok(coverAssets.length > 0);
  coverAssets.forEach((src) => assert.equal(src, expectedCover));
  assert.equal(DOCS_FIGURE_SPECS['player-surface'].assets.cover, expectedCover);
  assert.equal(DOCS_FIGURE_SPECS['master-canvas-alignment'].assets.cover, expectedCover);
  assert.ok(
    DOCS_FIGURE_SPECS['master-canvas-alignment'].assets.layers
      .includes('/makers/astral-courier/layers/background/moon-portal.png'),
    'the layer breakdown must include the background visible in the complete cover',
  );
  assert.ok(
    DOCS_FIGURE_SPECS['master-canvas-alignment'].assets.layers
      .includes('/makers/astral-courier/layers/accessory/crescent-clip.png'),
    'the layer breakdown must include the accessory visible in the complete cover',
  );

  const cover = await readFile(
    new URL('../public/makers/astral-courier/cover.png', import.meta.url),
  );
  assert.equal(cover.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(cover.readUInt32BE(16), 1024, 'Astral cover width');
  assert.equal(cover.readUInt32BE(20), 1024, 'Astral cover height');

  const astral = JSON.parse(
    await readFile(
      new URL('../public/makers/astral-courier/animacraft-maker-v5.json', import.meta.url),
      'utf8',
    ),
  );
  const hairItems = new Set(
    astral.parts.find((part) => part.name === 'Hair').items.map((item) => item.name),
  );
  DOCS_FIGURE_SPECS['player-surface'].assets.choices.forEach((choice) => {
    assert.ok(hairItems.has(choice.name), `${choice.name} must be a real Hair Item`);
  });
});

test('Docs renderer exposes accessible, lazy, captioned figures without arbitrary content HTML', async () => {
  const [renderer, styles] = await Promise.all([
    readFile(new URL('../docs-center.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(renderer, /function articleFigureMarkup\(article, locale\)/);
  assert.match(renderer, /role="img"/);
  assert.match(renderer, /<figcaption id=/);
  assert.match(renderer, /loading="lazy"/);
  assert.match(renderer, /decoding="async"/);
  assert.match(renderer, /docs-article-figure--\$\{escapeHtml\(spec\.type\)\}/);
  assert.doesNotMatch(renderer, /class="docs-article-figure docs-figure-\$\{escapeHtml\(spec\.type\)\}"/);
  assert.match(renderer, /escapeHtml\(`\$\{article\.title\}\. \$\{article\.summary\}`\)/);
  assert.match(renderer, /DOCS_FIGURE_SPECS\[figureId\]/);
  assert.doesNotMatch(renderer, />Style \$\{index \+ 1\}</);
  assert.doesNotMatch(renderer, /WHEN SELECTED|SAME GRAPH|Fit \+ Center|checkpoint · 2|>Renderer<|>Random<|>Preflight</);
  assert.doesNotMatch(renderer, /article\.figureHtml|section\.figureHtml/);
  assert.match(styles, /\.docs-article-figure \{\s*container-type: inline-size;/);
  assert.match(styles, /@container \(max-width: 760px\)/);
});

test('Docs renderer keeps home and detail pages separate without the old internal directory scroller', async () => {
  const [renderer, styles, app] = await Promise.all([
    readFile(new URL('../docs-center.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
  ]);

  assert.match(renderer, /const requestedArticleId = docsArticleIdFromHash\(\);/);
  assert.match(
    renderer,
    /root\.closest\('#docs'\)\?\.setAttribute\('data-docs-view', article \? 'detail' : 'home'\);/,
  );
  assert.match(
    renderer,
    /class="docs-guide-card"[\s\S]{0,120}href="\$\{escapeHtml\(docsArticleHref\(article\.id\)\)\}"/,
  );
  assert.match(renderer, /<a class="docs-back-link" href="#docs">/);
  assert.match(renderer, /docsArticleHref\(previous\.id\)/);
  assert.match(renderer, /docsArticleHref\(next\.id\)/);
  assert.ok(app.includes('const docsArticleHash = preserveRoute'));
  assert.ok(app.includes("&& /^#docs\\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(location.hash)"));
  assert.ok(app.includes('function syncPageFromLocation()'));
  assert.ok(app.includes('setPage(appPageFromHash(), { preserveRoute: true });'));
  assert.ok(app.includes('if (route === lastHandledBrowserRoute) return false;'));

  assert.doesNotMatch(renderer, /data-doc-article=/);
  assert.doesNotMatch(renderer, /class="docs-topic-button"/);
  assert.doesNotMatch(renderer, /class="docs-directory"/);
  assert.doesNotMatch(styles, /\.docs-directory\s*\{/);

  const internalDirectoryRules = [
    ...styles.matchAll(/\.(?:docs-home-directory|docs-detail-toc)\s*\{([^}]*)\}/g),
  ];
  assert.ok(internalDirectoryRules.length > 0);
  internalDirectoryRules.forEach(([, declarations]) => {
    assert.doesNotMatch(declarations, /overflow(?:-y)?\s*:\s*(?:auto|scroll)/i);
    assert.doesNotMatch(declarations, /max-height\s*:/i);
  });
});
