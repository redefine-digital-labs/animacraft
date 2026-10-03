import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareNativeSoulExternalSources } from '../scripts/prepare-native-soul-external-sources.mjs';

test('external source preparation requires an explicit exact dedicated absolute directory', () => {
  for (const input of [undefined, '', '.', '.move', '/', '/tmp/a/../cache', '/tmp/cache\n']) {
    assert.throws(() => prepareNativeSoulExternalSources(input), /exact absolute dedicated/);
  }
});
test('existing incomplete external cache is rejected without fetching, repairing or overwriting it', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'external-preparation-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'preserved'), 'user cache evidence');
  assert.throws(() => prepareNativeSoulExternalSources(directory), { code: 'ENOENT' });
  assert.deepEqual(readdirSync(directory), ['preserved']);
  assert.equal(readFileSync(path.join(directory, 'preserved'), 'utf8'), 'user cache evidence');
});
test('preparation refuses a symlink cache root without changing its target', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'external-preparation-link-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const link = path.join(directory, 'cache'); symlinkSync(directory, link);
  assert.throws(() => prepareNativeSoulExternalSources(link), /real directory/);
  assert.deepEqual(readdirSync(directory), ['cache']);
});
