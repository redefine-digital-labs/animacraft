import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createCharacterMakerV8Starter, createMakerV8Document, assertMakerV8Document,
  projectPublicMakerV8Document, upgradeAuthorMakerV8LivingContentV8,
} from '../maker-v8-document.js';
import {
  createDefaultMakerV8LivingContentV8, assertMakerV8LivingContentPublishableV8,
} from '../maker-v8-living-content.js';

test('new Maker uses the exact original Creator Soul templates', () => {
  // Independent snapshots measured against the original living-content.js.
  for (const [metadata, expected] of [
    [{}, 'a48a3ba851eda9fab16d8127c54b9cebff5c8e136c9688eb502aa2d7ba5e928e'],
    [{ name: '  Test Maker  ', style: 'Ink', creator: 'Ada', summary: 'A test character.' },
      'e79f73542c614138e52637c85a1436ba71d68cc606cc7fbc7a60a42bcaabf4c3'],
  ]) {
    const value = createDefaultMakerV8LivingContentV8(metadata);
    assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), expected);
    assert.equal(assertMakerV8LivingContentPublishableV8(value), value);
  }
  const document = createMakerV8Document({ name: 'Test Maker' });
  assert.deepEqual(document.livingContent, createDefaultMakerV8LivingContentV8(document.metadata));
  assert.ok(Object.isFrozen(document.livingContent.customized));
});

test('exact author Markdown and customized flags survive draft and public projection', () => {
  const livingContent = {
    schemaVersion: 'animacraft.living-content.v1',
    soulMd: '  # Soul\r\n{{OC_NAME}}\n', memoryMd: '', skillMd: 'unfinished\n',
    customized: { soulMd: true, memoryMd: true, skillMd: false },
  };
  const document = structuredClone(createCharacterMakerV8Starter({ livingContent }));
  document.metadata.name = 'Renamed without rewriting Soul';
  assertMakerV8Document(document);
  assertMakerV8Document(document, { mode: 'compile' });
  assert.deepEqual(projectPublicMakerV8Document(document).livingContent, livingContent);
  assert.deepEqual(upgradeAuthorMakerV8LivingContentV8(document).livingContent, livingContent);
  assert.throws(() => assertMakerV8LivingContentPublishableV8(livingContent));
});

test('missing livingContent upgrades only at the explicit author boundary', () => {
  const old = structuredClone(createCharacterMakerV8Starter({ name: 'Existing draft' }));
  delete old.livingContent;
  const before = JSON.stringify(old);
  assert.throws(() => assertMakerV8Document(old), { code: 'MAKER_V8_FIELD_REQUIRED' });
  assert.throws(() => assertMakerV8Document(old, { mode: 'compile' }));
  const upgraded = upgradeAuthorMakerV8LivingContentV8(old);
  assert.deepEqual(upgraded.livingContent, createDefaultMakerV8LivingContentV8(old.metadata));
  assert.equal(JSON.stringify(old), before);
  const withoutLiving = structuredClone(upgraded); delete withoutLiving.livingContent;
  assert.deepEqual(withoutLiving, old);
  assert.deepEqual(upgradeAuthorMakerV8LivingContentV8(upgraded), upgraded);
});

test('author upgrade never repairs malformed existing data or hides other document errors', () => {
  for (const mutate of [
    d => { d.livingContent = null; },
    d => { delete d.livingContent.memoryMd; },
    d => { d.livingContent.customized.soulMd = 'true'; },
    d => { d.livingContent.schemaVersion = 'unknown'; },
    d => { d.livingContent.unknown = ''; },
    d => { d.livingContent.customized.unknown = false; },
    d => { delete d.livingContent; d.parts[0].key = ''; },
  ]) {
    const document = structuredClone(createCharacterMakerV8Starter()); mutate(document);
    assert.throws(() => upgradeAuthorMakerV8LivingContentV8(document));
  }
  const document = structuredClone(createCharacterMakerV8Starter()); delete document.livingContent;
  Object.defineProperty(document, 'trap', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => upgradeAuthorMakerV8LivingContentV8(document));
});

test('publication checks original byte and SKILL constraints without mutating drafts', () => {
  const value = createDefaultMakerV8LivingContentV8();
  value.soulMd = '😀'.repeat(16385);
  const document = createMakerV8Document({ livingContent: value });
  assertMakerV8Document(document);
  assert.throws(() => assertMakerV8LivingContentPublishableV8(value), /64 KiB/);
  const invalidSkill = createDefaultMakerV8LivingContentV8(); invalidSkill.skillMd = '# no frontmatter';
  assert.throws(() => assertMakerV8LivingContentPublishableV8(invalidSkill), /frontmatter/);
  assert.equal(invalidSkill.skillMd, '# no frontmatter');
});
