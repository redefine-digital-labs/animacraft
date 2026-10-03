import assert from 'node:assert/strict';
import test from 'node:test';
import { bindMakerV8SourceAssets, assertMakerV8PublishedSources } from '../maker-v8-source-asset.js';
import { assertMakerV8Document, createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { compileMakerV8BaseRowsV2 } from '../maker-v8-base-rows.js';

const entries = [{ assetId: 'base-default', mediaType: 'image/png', byteLength: 1, sha256: 'ab'.repeat(32) }];
const starter = () => structuredClone(createCharacterMakerV8Starter({ makerKey: 'source', name: 'Source' }));

test('source binding is immutable, idempotent and changes existing Style commitment', async () => {
  const original = starter();
  const document = bindMakerV8SourceAssets(original, entries);
  assert.deepEqual(original.parts[0].items[0].styles[0].payload, {});
  assert.deepEqual(bindMakerV8SourceAssets(document, entries, { requireExisting: true }), document);
  assertMakerV8Document(document, { mode: 'compile' });
  const alternate = bindMakerV8SourceAssets(original, [{ ...entries[0], sha256: 'cd'.repeat(32) }]);
  const certified = Object.fromEntries(entries.map(row => [row.assetId, { ...row, blobId: 'source-test' }]));
  const first = await compileMakerV8BaseRowsV2(document, certified);
  const second = await compileMakerV8BaseRowsV2(alternate, certified);
  assert.notDeepEqual(first.rows.style[0].payload_commitment, second.rows.style[0].payload_commitment);
  assert.throws(() => bindMakerV8SourceAssets(document, [{ ...entries[0], sha256: 'cd'.repeat(32) }]), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
  assert.throws(() => bindMakerV8SourceAssets(original, entries, { requireExisting: true }), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
});

test('publication readback rejects missing protected source and public source substitution', () => {
  const document = bindMakerV8SourceAssets(starter(), entries);
  assertMakerV8PublishedSources(document, entries);
  assert.throws(() => assertMakerV8PublishedSources(document, [{ ...entries[0], sha256: 'cd'.repeat(32) }]), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
  const style = document.parts[0].items[0].styles[0];
  style.protected = true;
  assertMakerV8PublishedSources(document, [{ ...entries[0], sha256: 'cd'.repeat(32), mediaType: 'application/vnd.animacraft.seal-ciphertext', byteLength: 200 }]);
  delete style.payload.animacraftSourceAsset;
  assert.throws(() => assertMakerV8PublishedSources(document, entries), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
});

test('reserved payload is exact and cannot open arbitrary authority paths', () => {
  for (const value of [null, {}, { sha256: 'ab'.repeat(32) }, { ...entries[0] },
    { sha256: 'AB'.repeat(32), mediaType: 'image/png', byteLength: 1 },
    { sha256: 'ab'.repeat(32), mediaType: 'image/png', byteLength: 1, rootId: 'injected' }]) {
    const document = starter();
    document.parts[0].items[0].styles[0].payload.animacraftSourceAsset = value;
    assert.throws(() => assertMakerV8Document(document));
  }
  const document = bindMakerV8SourceAssets(starter(), entries);
  document.parts[0].payload.animacraftSourceAsset = structuredClone(document.parts[0].items[0].styles[0].payload.animacraftSourceAsset);
  assert.throws(() => assertMakerV8Document(document));
});
