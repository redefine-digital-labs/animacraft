import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCS_CONTENT,
  DOCS_LOCALES,
  DOCS_VERSION,
} from '../docs-center-content.js';
import { validateDocsContent } from '../docs-center.js';

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
  assert.equal(DOCS_VERSION, '0.8.1');
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
