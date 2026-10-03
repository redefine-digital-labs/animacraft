import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.schema, 'approved-ui-donor-source-v1');
assert.equal(manifest.files.length, 8);

// Historical test inputs only: never import these sources as a product runtime.
export function readApprovedUiDonor(path, revision = 'aac90dbc') {
  const row = manifest.files.find(file => file.path === path && file.revision === revision);
  assert.ok(row, `No approved UI donor fixture for ${revision}:${path}`);
  assert.match(row.commit, /^[0-9a-f]{40}$/);
  assert.ok(row.commit.startsWith(revision));
  assert.equal(row.fixture, `${revision}/${path}.txt`);
  const bytes = readFileSync(new URL(row.fixture, import.meta.url));
  assert.equal(bytes.length, row.byteLength, `Donor byte length: ${revision}:${path}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256,
    `Donor SHA-256: ${revision}:${path}`);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.gitBlob,
    `Donor Git blob: ${revision}:${path}`);
  return bytes.toString('utf8');
}
