import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import {
  createDefaultLivingContent,
  createSoulidityImportBundle,
  createSoulidityImportJson,
  normalizeLivingContent,
  resolveLivingContent,
  soulidityContentManifest,
  validateLivingContent,
} from '../living-content.js';

const maker = {
  name: 'Starlit Daily OC',
  creator: 'Mori Atelier',
  style: 'Daily fantasy',
  description: 'A gentle character maker.',
};

test('default Living Content matches Soulidity invariant slots', () => {
  const content = createDefaultLivingContent(maker);
  assert.equal(validateLivingContent(content), content);
  const manifest = soulidityContentManifest(content, {
    maker,
    makerId: '0x123',
    profile: { name: 'Hoshi', world: 'Moon Market', description: 'A patient cartographer.' },
  });
  assert.deepEqual(manifest.files.map(({ kind, name }) => [kind, name]), [[0, 'soul'], [1, 'default'], [2, 'starlit-daily-oc-companion']]);
  assert.match(manifest.content.soulMd, /Name: Hoshi/);
  assert.doesNotMatch(manifest.content.soulMd, /\{\{OC_NAME\}\}/);
});

test('normalization preserves custom documents and restores missing defaults', () => {
  const normalized = normalizeLivingContent({
    soulMd: '# Custom Soul',
    customized: { soulMd: true },
  }, maker);
  assert.equal(normalized.soulMd, '# Custom Soul');
  assert.equal(normalized.customized.soulMd, true);
  assert.match(normalized.memoryMd, /# Founding Memory/);
});

test('Soulidity bundle contains markdown and a nested valid SKILL.md zip', () => {
  const content = createDefaultLivingContent(maker);
  const { bytes } = createSoulidityImportBundle(content, {
    maker,
    profile: { name: 'Hoshi', world: 'Moon Market', description: 'A patient cartographer.' },
  });
  const files = unzipSync(bytes);
  assert.ok(files['soul.md']);
  assert.ok(files['memory.md']);
  assert.ok(files['skills.zip']);
  assert.ok(files['animacraft-import.json']);
  const skillFiles = unzipSync(files['skills.zip']);
  assert.match(strFromU8(skillFiles['SKILL.md']), /^---\nname: starlit-daily-oc-companion/m);
});

test('Living Content rejects empty or oversized documents', () => {
  const content = createDefaultLivingContent(maker);
  assert.throws(() => validateLivingContent({ ...content, memoryMd: '' }), /Memory cannot be empty/);
  assert.throws(() => validateLivingContent({ ...content, soulMd: 'x'.repeat(70 * 1024) }), /64 KiB/);
});

test('resolver uses OC profile values without mutating Maker defaults', () => {
  const content = createDefaultLivingContent(maker);
  const original = content.soulMd;
  const resolved = resolveLivingContent(content, {
    maker,
    profile: { name: 'Nia', world: 'Cloud Harbor', description: 'A courier.' },
  });
  assert.match(resolved.soulMd, /Name: Nia/);
  assert.equal(content.soulMd, original);
});

test('transitional JSON exposes fields accepted by Soulidity generic import', () => {
  const json = createSoulidityImportJson(createDefaultLivingContent(maker), {
    maker,
    imageUrl: 'https://example.com/hoshi.png',
    profile: { name: 'Hoshi', description: 'A patient cartographer.', tags: ['fantasy'] },
  });
  assert.equal(json.name, 'Hoshi');
  assert.equal(json.avatar, 'https://example.com/hoshi.png');
  assert.match(json.memory, /# Founding Memory/);
  assert.match(json.skills, /^---\nname:/);
  assert.match(json.config, /# Soul Character/);
});
