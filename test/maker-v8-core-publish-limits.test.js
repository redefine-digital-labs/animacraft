import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE_DIRECTORY = new URL('../move/animacraft_v8_core/sources/', import.meta.url);
const MAX_SUI_STRUCT_FIELDS = 32;

function sourceStructs(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...withoutComments.matchAll(
    /\b(?:public\s+)?struct\s+(\w+)(?:<[^>{]*>)?(?:\s+has\s+[^\{]+)?\s*\{([\s\S]*?)\}/g,
  )].map((match) => ({
    name: match[1],
    fields: [...match[2].matchAll(/(?:^|,)\s*[A-Za-z_]\w*\s*:/g)].length,
  }));
}

test('every Core v8 struct stays within the Sui publish verifier field limit', () => {
  const structs = readdirSync(SOURCE_DIRECTORY)
    .filter((name) => name.endsWith('.move'))
    .flatMap((name) => sourceStructs(readFileSync(new URL(name, SOURCE_DIRECTORY), 'utf8'))
      .map((entry) => ({ ...entry, source: name })));

  assert.ok(structs.length > 0);
  for (const entry of structs) {
    assert.ok(
      entry.fields <= MAX_SUI_STRUCT_FIELDS,
      `${entry.source}::${entry.name} has ${entry.fields} fields; Sui permits at most ${MAX_SUI_STRUCT_FIELDS}.`,
    );
  }

  const makerRoot = structs.find((entry) => entry.name === 'MakerRootV8');
  assert.deepEqual(
    makerRoot,
    { name: 'MakerRootV8', fields: 31, source: 'maker_v8.move' },
  );
});
