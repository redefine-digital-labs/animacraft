import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readApprovedUiDonor } from '../test/fixtures/approved-ui-donors/read-donor.mjs';

const root = new URL('../', import.meta.url);
export function localeDeltas(before, after) {
  return {
    added: Object.keys(after).filter(k => !(k in before)).sort(),
    changed: Object.keys(before).filter(k => k in after && before[k] !== after[k]).sort(),
    removed: Object.keys(before).filter(k => !(k in after)).sort(),
  };
}

export function validateLocaleDeltas(historical, current, approved) {
  assert.equal(approved.schema, 1);
  assert.deepEqual(current.MAKER_WORKSPACE_LOCALES, historical.MAKER_WORKSPACE_LOCALES);
  for (const kind of ['added', 'changed', 'removed']) {
    assert.equal(new Set(approved[kind]).size, approved[kind].length, `Duplicate ${kind} key`);
  }
  const expected = Object.fromEntries(['added', 'changed', 'removed'].map(k => [k, [...approved[k]].sort()]));
  const placeholders = text => [...text.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();
  for (const locale of historical.MAKER_WORKSPACE_LOCALES) {
    const before = historical.makerWorkspaceDictionary(locale), after = current.makerWorkspaceDictionary(locale);
    assert.deepEqual(localeDeltas(before, after), expected, `Unreviewed or missing ${locale} workflow delta`);
    assert.match(after.versionHistoryCopy, /100/, 'Retained checkpoint limit stays visible');
    for (const key of [...approved.changed, ...approved.added]) {
      assert.equal(typeof after[key], 'string');
      assert.ok(after[key].trim().length, `${locale}/${key} is blank`);
      assert.deepEqual(placeholders(after[key]), placeholders(current.makerWorkspaceDictionary('en')[key]),
        `${locale}/${key} placeholders`);
    }
  }
}

export async function loadDictionaries() {
  const approved = JSON.parse(readFileSync(new URL('test/fixtures/approved-ui-donors/workflow-locale-deltas.json', root)));
  const source = readApprovedUiDonor('maker-workspace-i18n.js');
  assert.equal(createHash('sha256').update(source).digest('hex'), approved.historicalSha256);
  const historicalSource = source.replace("'./expansion-pack-lifecycle-i18n.js'",
    JSON.stringify(new URL('expansion-pack-lifecycle-i18n.js', root).href));
  const historical = await import(`data:text/javascript;base64,${Buffer.from(historicalSource).toString('base64')}`);
  const current = await import(new URL('maker-workspace-i18n.js', root).href);
  return { historical, current, approved };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { historical, current, approved } = await loadDictionaries();
  if (process.argv[2] === '--print-delta') {
    // Generate a review proposal only. Never silently rewrite approved UI keys.
    console.log(JSON.stringify(localeDeltas(historical.makerWorkspaceDictionary('en'), current.makerWorkspaceDictionary('en')), null, 2));
  } else if (process.argv[2] === '--check') {
    validateLocaleDeltas(historical, current, approved);
    console.log('PASS: approved workflow delta and all locale placeholders');
  } else throw new Error('Use --check or --print-delta (read-only)');
}
