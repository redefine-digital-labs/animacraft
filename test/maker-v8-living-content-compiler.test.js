import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createCharacterMakerV8Starter, projectPublicMakerV8Document } from '../maker-v8-document.js';
import { compileMakerV8LivingContentV8, deriveMakerV8LivingContentBindingV8 } from '../maker-v8-living-content-compiler.js';

const sha = bytes => createHash('sha256').update(bytes).digest();
const uleb = value => { const bytes = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value); return Buffer.from(bytes); };
const vec = bytes => Buffer.concat([uleb(bytes.length), Buffer.from(bytes)]);
const str = value => vec(Buffer.from(value, 'utf8'));
const u64 = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
const records = (values, keys) => Buffer.concat([uleb(values.length), ...values.flatMap(value => keys.map(key => str(value[key])))]);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function document() {
  const value = structuredClone(createCharacterMakerV8Starter({ makerKey: 'living-maker', name: 'Living Maker' }));
  value.livingContent = { schemaVersion: 'animacraft.living-content.v1', soulMd: '# Soul\r\n你好 {{OC_NAME}}\n',
    memoryMd: '# Memory\n', skillMd: '---\nname: living\n---\n# Skill\n',
    customized: { soulMd: true, memoryMd: false, skillMd: true } };
  return value;
}
function manual(value) {
  const texts = ['soulMd', 'memoryMd', 'skillMd'].map(key => Buffer.from(value.livingContent[key], 'utf8'));
  const defaults = sha(Buffer.concat([
    str('animacraft-fresh-v8/core/creator-defaults/v1'), u64(1),
    records(value.defaultRecipe.selections, ['partKey', 'itemKey', 'styleKey']),
    records(value.defaultRecipe.colors, ['channelKey', 'swatchKey']), str(value.outputs[0].key),
    ...texts.map(text => vec(sha(text))),
  ]));
  const bytes = Buffer.concat([str('animacraft-fresh-v8/output/living-content-bundle/v1'),
    u64(1), vec(defaults), ...texts.map(vec)]);
  return { defaults, bytes, bundle: sha(bytes) };
}

test('living compiler matches independent hand-written BCS and complete public JSON', async () => {
  const value = document(); const before = JSON.stringify(value);
  const result = await compileMakerV8LivingContentV8(value); const expected = manual(value);
  assert.equal(result.makerDocumentCommitment, '6afb86f4ecc6230d0be2fa67a70145ad491ee6e72df8181516b042d71d87cf60');
  assert.equal(result.creatorDefaultsCommitment, 'a275b961a5d2e6939f9306a3a1833cf94e590e4a1b6f9f1f57ddf77a50e8a50f');
  assert.equal(result.bundleCommitment, '1a3be5551c981c442a1134b80a482d8a9df0bc2266d399998f8bcc15acbbf963');
  assert.equal(result.byteLength, 161);
  assert.deepEqual(result.bytes, [...expected.bytes]);
  assert.equal(result.creatorDefaultsCommitment, expected.defaults.toString('hex'));
  assert.equal(result.bundleCommitment, expected.bundle.toString('hex'));
  assert.equal(result.sha256, sha(Buffer.from(result.bytes)).toString('hex'));
  assert.equal(result.byteLength, result.bytes.length);
  assert.equal(result.makerDocumentCommitment, sha(Buffer.from(JSON.stringify(canonical({
    schemaVersion: 'animacraft.maker-v8-document-commitment.v2', document: projectPublicMakerV8Document(value),
  })))).toString('hex'));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.bytes));
  assert.equal(JSON.stringify(value), before);
});

test('all three exact texts bind defaults and bundle, without resolving tokens or line endings', async () => {
  const baseline = await compileMakerV8LivingContentV8(document());
  for (const key of ['soulMd', 'memoryMd', 'skillMd']) {
    const value = document(); value.livingContent[key] += '\nChanged';
    const next = await compileMakerV8LivingContentV8(value);
    assert.notEqual(next.makerDocumentCommitment, baseline.makerDocumentCommitment);
    assert.notEqual(next.creatorDefaultsCommitment, baseline.creatorDefaultsCommitment);
    assert.notEqual(next.bundleCommitment, baseline.bundleCommitment);
  }
  assert.ok(Buffer.from(baseline.bytes).includes(Buffer.from('{{OC_NAME}}')));
  assert.ok(Buffer.from(baseline.bytes).includes(Buffer.from('\r\n')));
  const flags = document(); flags.livingContent.customized.memoryMd = true;
  const flagResult = await compileMakerV8LivingContentV8(flags);
  assert.notEqual(flagResult.makerDocumentCommitment, baseline.makerDocumentCommitment);
  assert.equal(flagResult.creatorDefaultsCommitment, baseline.creatorDefaultsCommitment);
});

test('defaults preserve actual selection/color order and first Output choice', async () => {
  const value = document();
  const part = structuredClone(value.parts[0]); part.key = 'second'; value.parts.push(part);
  value.defaultRecipe.selections.push({ partKey: 'second', itemKey: 'default', styleKey: 'default' });
  value.colors = ['first', 'second'].map(key => ({ key, label: key, defaultSwatchKey: 'red',
    swatches: [{ key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] }] }));
  value.defaultRecipe.colors = value.colors.map(({ key }) => ({ channelKey: key, swatchKey: 'red' }));
  const baseline = await compileMakerV8LivingContentV8(value);
  assert.equal(baseline.creatorDefaultsCommitment, manual(value).defaults.toString('hex'));
  for (const kind of ['selections', 'colors']) {
    const changed = structuredClone(value); changed.defaultRecipe[kind].reverse();
    assert.notEqual((await compileMakerV8LivingContentV8(changed)).creatorDefaultsCommitment, baseline.creatorDefaultsCommitment);
  }
  const changed = structuredClone(value); changed.outputs[0].key = 'alternate';
  const next = await compileMakerV8LivingContentV8(changed);
  assert.equal(next.outputKey, 'alternate');
  assert.notEqual(next.creatorDefaultsCommitment, baseline.creatorDefaultsCommitment);
});

test('public document hash excludes private Item rows and ignores object member insertion order', async () => {
  const value = document(); const baseline = await compileMakerV8LivingContentV8(value);
  const privateItem = structuredClone(value.parts[0].items[0]); privateItem.key = 'private'; privateItem.status = 'PRIVATE';
  value.parts[0].items.push(privateItem);
  assert.equal((await compileMakerV8LivingContentV8(value)).makerDocumentCommitment, baseline.makerDocumentCommitment);
  const reordered = Object.fromEntries(Object.entries(document()).reverse());
  assert.equal((await compileMakerV8LivingContentV8(reordered)).makerDocumentCommitment, baseline.makerDocumentCommitment);
});

test('transport binding matches exact Core BCS and binds every supplied fact', async () => {
  const compiled = await compileMakerV8LivingContentV8(document());
  const input = { creatorDefaultsCommitment: compiled.creatorDefaultsCommitment, blobId: 'actual-walrus-blob',
    sha256: compiled.sha256, byteLength: compiled.byteLength, bundleCommitment: compiled.bundleCommitment };
  const expected = sha(Buffer.concat([str('animacraft-fresh-v8/output/living-content-binding/v1'), u64(1),
    vec(Buffer.from(input.creatorDefaultsCommitment, 'hex')), str(input.blobId),
    vec(Buffer.from(input.sha256, 'hex')), u64(input.byteLength), vec(Buffer.from(input.bundleCommitment, 'hex'))])).toString('hex');
  assert.equal(deriveMakerV8LivingContentBindingV8(input), expected);
  for (const key of ['creatorDefaultsCommitment', 'sha256', 'bundleCommitment', 'blobId', 'byteLength']) {
    const next = { ...input, [key]: key === 'blobId' ? 'other-blob' : key === 'byteLength' ? input.byteLength + 1 : 'ab'.repeat(32) };
    assert.notEqual(deriveMakerV8LivingContentBindingV8(next), expected);
  }
  for (const byteLength of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, '01', '18446744073709551616']) {
    assert.throws(() => deriveMakerV8LivingContentBindingV8({ ...input, byteLength }));
  }
  for (const sha256 of ['0'.repeat(64), 'zz'.repeat(32), '0x' + input.sha256, input.sha256.toUpperCase()]) {
    assert.throws(() => deriveMakerV8LivingContentBindingV8({ ...input, sha256 }));
  }
  assert.throws(() => deriveMakerV8LivingContentBindingV8({ ...input, blobId: '😀'.repeat(129) }));
  assert.throws(() => deriveMakerV8LivingContentBindingV8({ ...input, extra: true }));
});

test('compile rejects absent/unfinished living docs and invalid actual default references', async () => {
  for (const mutate of [d => { delete d.livingContent; }, d => { d.livingContent.memoryMd = ''; },
    d => { d.livingContent.skillMd = '# unfinished'; },
    d => { d.defaultRecipe.selections[0].styleKey = 'missing'; }]) {
    const value = document(); mutate(value); await assert.rejects(compileMakerV8LivingContentV8(value));
  }
});
