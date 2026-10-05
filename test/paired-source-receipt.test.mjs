import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairReceipt, writeReceipt } from '../scripts/write-pair-receipt.mjs';

const ac = 'a'.repeat(40), so = 'b'.repeat(40);
const env = { GITHUB_SHA: ac, SOULIDITY_COMMIT_SHA: so, GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'workflow_dispatch' };

test('paired receipt binds actual checkouts, run attempt and event', () => {
  const receipt = pairReceipt({ site: 'ac', ac, so, env });
  assert.deepEqual(receipt.pair, { ac, so });
  assert.equal(receipt.attempt, '2');
  assert.equal(receipt.event, 'workflow_dispatch');
  assert.equal(pairReceipt({ site: 'so', ac, so, env: { ...env, GITHUB_SHA: so, ANIMACRAFT_COMMIT_SHA: ac } }).site, 'so');
});

test('old peer, different own source, branch names and absent CI identity fail', () => {
  for (const change of [{ SOULIDITY_COMMIT_SHA: 'c'.repeat(40) }, { GITHUB_SHA: 'c'.repeat(40) },
    { GITHUB_RUN_ATTEMPT: '' }, { GITHUB_RUN_ID: '' }]) {
    assert.throws(() => pairReceipt({ site: 'ac', ac, so, env: { ...env, ...change } }));
  }
  assert.throws(() => pairReceipt({ site: 'ac', ac: 'main', so, env }));
});

test('receipt CLI cannot attest modified tracked source or overwrite an earlier attempt', () => {
  const root = mkdtempSync(join(tmpdir(), 'pair-receipt-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init'); writeFileSync(join(root, 'source.txt'), 'reviewed'); git('add', 'source.txt');
    git('-c', 'user.name=Receipt test', '-c', 'user.email=receipt@example.invalid', 'commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD'), output = join(root, 'receipt.json');
    const args = { site: 'ac', acRoot: root, soRoot: root, output,
      env: { ...env, GITHUB_SHA: sha, SOULIDITY_COMMIT_SHA: sha } };
    writeReceipt(args);
    assert.throws(() => writeReceipt(args), /EEXIST/);
    writeFileSync(join(root, 'source.txt'), 'unreviewed');
    assert.throws(() => writeReceipt({ ...args, output: join(root, 'other.json') }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
