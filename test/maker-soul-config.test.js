import assert from 'node:assert/strict';
import test from 'node:test';

import { createMakerV5Document, validateMakerV5Document } from '../maker-v4.js';
import {
  SOUL_CONFIG_DOCUMENT_KEYS,
  SOUL_CONFIG_DOCUMENTS,
  applySoulConfigToMakerDocument,
  normalizeSoulConfig,
  resetSoulConfig,
  updateSoulConfig,
  validateSoulConfig,
} from '../maker-soul-config.js';

const maker = {
  name: 'Moon Courier',
  creator: 'Soul Atelier',
  style: 'Quiet celestial',
  summary: 'A courier who remembers every promised delivery.',
};

test('Soul configuration exposes the three stable Maker document slots', () => {
  assert.deepEqual(SOUL_CONFIG_DOCUMENT_KEYS, ['soulMd', 'memoryMd', 'skillMd']);
  assert.deepEqual(
    SOUL_CONFIG_DOCUMENTS.map(({ key, filename }) => [key, filename]),
    [
      ['soulMd', 'soul.md'],
      ['memoryMd', 'memory.md'],
      ['skillMd', 'SKILL.md'],
    ],
  );

  const content = normalizeSoulConfig(null, maker);
  assert.match(content.soulMd, /Moon Courier/);
  assert.match(content.memoryMd, /Moon Courier/);
  assert.match(content.skillMd, /^---\nname: moon-courier-companion/m);
  assert.deepEqual(content.customized, {
    soulMd: false,
    memoryMd: false,
    skillMd: false,
  });
});

test('updating one Soul document is immutable and cannot affect its siblings', () => {
  const original = normalizeSoulConfig(null, maker);
  const updated = updateSoulConfig(original, 'memoryMd', '# A real memory', maker);

  assert.notEqual(updated, original);
  assert.equal(updated.memoryMd, '# A real memory');
  assert.equal(updated.customized.memoryMd, true);
  assert.equal(updated.soulMd, original.soulMd);
  assert.equal(updated.skillMd, original.skillMd);
  assert.equal(original.customized.memoryMd, false);
  assert.throws(() => updateSoulConfig(original, 'unknownMd', 'nope', maker), /Unknown Soul configuration document/);
});

test('reset restores one document or the complete Maker-derived defaults', () => {
  let content = normalizeSoulConfig(null, maker);
  content = updateSoulConfig(content, 'soulMd', '# Custom Soul', maker);
  content = updateSoulConfig(content, 'memoryMd', '# Custom Memory', maker);

  const oneReset = resetSoulConfig(content, 'soulMd', maker);
  assert.match(oneReset.soulMd, /Moon Courier/);
  assert.equal(oneReset.customized.soulMd, false);
  assert.equal(oneReset.memoryMd, '# Custom Memory');
  assert.equal(oneReset.customized.memoryMd, true);

  const allReset = resetSoulConfig(oneReset, undefined, maker);
  assert.match(allReset.memoryMd, /Moon Courier/);
  assert.deepEqual(allReset.customized, {
    soulMd: false,
    memoryMd: false,
    skillMd: false,
  });
});

test('validation reports whole-config and per-document state without rejecting draft edits', () => {
  const valid = validateSoulConfig(null, maker);
  assert.equal(valid.valid, true);
  assert.equal(valid.error, null);
  assert.ok(valid.totalBytes > 0);
  assert.ok(valid.maxTotalBytes >= valid.totalBytes);
  SOUL_CONFIG_DOCUMENT_KEYS.forEach((key) => {
    assert.equal(valid.documents[key].valid, true);
    assert.equal(valid.documents[key].error, null);
    assert.ok(valid.documents[key].bytes > 0);
  });

  const emptyMemory = updateSoulConfig(valid.content, 'memoryMd', '', maker);
  const invalidMemory = validateSoulConfig(emptyMemory, maker);
  assert.equal(invalidMemory.valid, false);
  assert.equal(invalidMemory.documents.memoryMd.valid, false);
  assert.match(invalidMemory.documents.memoryMd.error, /Memory cannot be empty/);
  assert.equal(invalidMemory.documents.soulMd.valid, true);

  const invalidSkill = updateSoulConfig(valid.content, 'skillMd', '# Missing frontmatter', maker);
  const invalidSkillState = validateSoulConfig(invalidSkill, maker);
  assert.equal(invalidSkillState.valid, false);
  assert.equal(invalidSkillState.documents.skillMd.valid, false);
  assert.match(invalidSkillState.documents.skillMd.error, /frontmatter/);
});

test('Soul configuration can be saved directly in Maker document.livingContent', () => {
  const document = createMakerV5Document({
    makerId: 'moon-courier',
    name: maker.name,
    creator: maker.creator,
  });
  document.metadata.style = maker.style;
  document.metadata.summary = maker.summary;

  const edited = updateSoulConfig(document.livingContent, 'soulMd', '# Patient Moon Courier', document);
  const updatedDocument = applySoulConfigToMakerDocument(document, edited);

  assert.notEqual(updatedDocument, document);
  assert.equal(document.livingContent, null);
  assert.equal(updatedDocument.livingContent.soulMd, '# Patient Moon Courier');
  assert.equal(updatedDocument.livingContent.customized.soulMd, true);
  assert.equal(validateMakerV5Document(updatedDocument, { mode: 'draft' }), updatedDocument);

  const restoredFromJson = JSON.parse(JSON.stringify(updatedDocument));
  assert.deepEqual(
    normalizeSoulConfig(restoredFromJson.livingContent, restoredFromJson),
    updatedDocument.livingContent,
  );
});
