import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBase64 } from '@mysten/sui/utils';
import { buildMakerV8NativeContentIntentV8, buildMakerV8NativePublicPreviewV8 } from '../maker-v8-native-content-intent.js';
import { decodeMakerV8ProjectZip } from '../maker-v8-project-zip.js';

const project = () => ({ schemaVersion: 'animacraft.local-player-project.v8',
  imageExport: { sizeMode: 'standard', transparent: false },
  profile: { name: 'Nova', description: '', world: '地球', tags: 'oc' },
  soul: { defaults: { soulMd: '  身份 {{OC_NAME}}\r\n', memoryMd: '# 最初记忆\n',
    skillMd: '---\nname: nova-companion\n---\n# 技能\n' }, documents: {} },
  recipe: { outputKey: 'portrait' }, render: { sha256: 'a'.repeat(64) } });

test('native content uses literal visible overrides/defaults and an actual SKILL.md ZIP', () => {
  const input = project();
  input.soul.documents.memoryMd = '  用户改的记忆\r\n';
  const result = buildMakerV8NativeContentIntentV8(input);
  assert.equal(result.description, '');
  assert.deepEqual(result.publicPreview, { schema: 'soulidity.soul-public-preview.v1', tags: ['oc'], previewImages: [] });
  assert.equal(new TextDecoder().decode(fromBase64(result.files[0].bytesBase64)), input.soul.defaults.soulMd);
  assert.equal(new TextDecoder().decode(fromBase64(result.files[1].bytesBase64)), input.soul.documents.memoryMd);
  assert.equal(result.files[2].name, 'nova-companion');
  const zip = fromBase64(result.files[2].bytesBase64);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLength = view.getUint16(26, true);
  assert.equal(new TextDecoder().decode(zip.subarray(30, 30 + nameLength)), 'SKILL.md');
  assert.equal(new TextDecoder().decode(zip.subarray(30 + nameLength, 30 + nameLength + view.getUint32(22, true))), input.soul.defaults.skillMd);
  assert.throws(() => decodeMakerV8ProjectZip(zip), { code: 'MAKER_V8_PROJECT_ZIP_ENTRY_INVALID' });
  assert.equal(buildMakerV8NativeContentIntentV8(input).commitment, result.commitment);
  input.recipe.outputKey = 'different';
  assert.notEqual(buildMakerV8NativeContentIntentV8(input).commitment, result.commitment);
});

test('native content binds export settings even when the rendered pixels are identical', () => {
  const input = project();
  const standard = buildMakerV8NativeContentIntentV8(input);
  input.imageExport.sizeMode = 'original';
  const original = buildMakerV8NativeContentIntentV8(input);
  assert.notEqual(original.commitment, standard.commitment);
  assert.deepEqual(original.files, standard.files);
  input.imageExport.transparent = true;
  assert.notEqual(buildMakerV8NativeContentIntentV8(input).commitment, original.commitment);
  for (const options of [undefined, null, {}, { sizeMode: 'standard' }, { sizeMode: 'standard', transparent: 0 },
    { sizeMode: 'standard', transparent: false, extra: 1 }, Object.assign(Object.create(null), { sizeMode: 'standard', transparent: false }),
    Object.defineProperty({ transparent: false }, 'sizeMode', { enumerable: true, get() { assert.fail('Must not invoke accessors'); } })]) {
    assert.throws(() => buildMakerV8NativeContentIntentV8({ ...input, imageExport: options }), { code: 'MAKER_V8_NATIVE_CONTENT_INTENT_INVALID' });
  }
});

test('public preview preserves actual normalized Player tags without exposing render or private content', () => {
  const input = project(); input.profile.tags = ' OC, 猫,oc, , New '; input.render = { privateUrl: 'https://private.example/secret' };
  const intent = buildMakerV8NativeContentIntentV8(input);
  assert.deepEqual(intent.publicPreview, { schema: 'soulidity.soul-public-preview.v1', tags: ['oc', '猫', 'new'], previewImages: [] });
  assert.equal(JSON.stringify(intent.publicPreview).includes('private'), false);
  assert.deepEqual(buildMakerV8NativePublicPreviewV8({ tags: '' }).tags, []);
  input.profile.tags = 'different';
  assert.notEqual(buildMakerV8NativeContentIntentV8(input).commitment, intent.commitment);
  for (const tags of [undefined, [], 'x'.repeat(51), Array.from({ length: 13 }, (_, i) => String(i)).join(','), '\ud800', 'İ'.repeat(50), 'oc\nprivate']) {
    assert.throws(() => buildMakerV8NativePublicPreviewV8({ tags }), { code: 'MAKER_V8_NATIVE_CONTENT_INTENT_INVALID' });
  }
});

test('native content refuses empty edits, invalid skill names, oversize and lossy text before upload', () => {
  for (const change of [
    p => { p.soul.documents.soulMd = ''; },
    p => { p.soul.defaults.skillMd = '---\nno_name: bad\n---\nname: outside\n'; },
    p => { p.soul.documents.memoryMd = 'x'.repeat(65537); },
    p => { p.soul.documents.soulMd = '\ud800'; },
  ]) { const input = project(); change(input); assert.throws(() => buildMakerV8NativeContentIntentV8(input), { code: 'MAKER_V8_NATIVE_CONTENT_INTENT_INVALID' }); }
});
