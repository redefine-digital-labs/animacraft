import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL(
  '../move/animacraft/sources/commerce_v5.move',
  import.meta.url,
);

function structFieldNames(source, name) {
  const match = source.match(new RegExp(
    `public struct ${name} has [^{]+\\{([\\s\\S]*?)\\n\\}`,
  ));
  assert.ok(match, `${name} must remain declared in commerce_v5`);
  return [...match[1].matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):/gm)]
    .map((entry) => entry[1]);
}

test('MakerRootV5 remains below the Mainnet protocol-130 struct field limit', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const rootFields = structFieldNames(source, 'MakerRootV5');
  const releaseFields = structFieldNames(source, 'MakerRootReleaseStateV5');
  const publishedStructs = [...source.matchAll(
    /public struct ([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)? has [^{]+\{([\s\S]*?)\n\}/g,
  )];

  assert.ok(publishedStructs.length > 0);
  for (const [, name, body] of publishedStructs) {
    const count = [...body.matchAll(/^\s{4}[A-Za-z_][A-Za-z0-9_]*:/gm)].length;
    assert.ok(count <= 32, `${name} has ${count} fields; Mainnet allows at most 32`);
  }

  assert.equal(rootFields.length, 30);
  assert.ok(rootFields.length <= 32);
  assert.ok(rootFields.includes('release'));
  assert.equal(releaseFields.length, 9);
  assert.ok(releaseFields.length <= 32);
  assert.deepEqual(releaseFields, [
    'pack_count',
    'paid_pack_count',
    'style_count',
    'style_registry_sealed',
    'protected_style_count',
    'seal_policy_id',
    'seal_release_commitment',
    'complete_output_count',
    'total_completes',
  ]);
});
