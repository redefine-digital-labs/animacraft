import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDictionaries, validateLocaleDeltas } from '../scripts/check-workflow-locales.mjs';

test('real approved dictionaries pass; an accidental old-copy change, new key or placeholder loss fails', async () => {
  const { historical, current, approved } = await loadDictionaries();
  validateLocaleDeltas(historical, current, approved);
  const oldKey = Object.keys(historical.makerWorkspaceDictionary('en'))
    .find(k => ![...approved.changed, ...approved.removed].includes(k));
  const tokenKey = [...approved.added, ...approved.changed]
    .find(k => /\{[^}]+\}/.test(current.makerWorkspaceDictionary('en')[k]));
  assert.ok(oldKey && tokenKey);
  for (const mutate of [d => { d[oldKey] += 'changed'; }, d => { d.unreviewedKey = 'new'; },
    d => { d[tokenKey] = d[tokenKey].replace(/\{[^}]+\}/g, 'lost'); }, d => { d[approved.added[0]] = ''; }]) {
    const altered = { ...current, makerWorkspaceDictionary(locale) {
      const d = { ...current.makerWorkspaceDictionary(locale) };
      if (locale !== 'en') mutate(d);
      return d;
    } };
    assert.throws(() => validateLocaleDeltas(historical, altered, approved));
  }
});
