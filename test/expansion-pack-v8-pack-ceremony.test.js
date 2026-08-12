import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ALLOWED_UNTRACKED,
  assertExactSuiLock,
  assertWalrusCheckpoint,
  atomicWriteJson0600,
  sha256,
  stableJson,
  validateWorktreeStatus,
} from '../scripts/lib/expansion-pack-v8-pack-ceremony.mjs';

const SIGNER = '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f';

test('persists ceremony and signed envelopes atomically with mode 0600 and exact readback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pack-ceremony-test-'));
  const path = join(directory, 'ceremony.json');
  const value = { schemaVersion: 'test', signed: { bytesBase64: 'AA==', signature: 'exact-signature' } };
  const persisted = await atomicWriteJson0600(path, value);
  assert.deepEqual(persisted, value);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), value);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('worktree validation permits only the exact parent-migration untracked path', () => {
  assert.deepEqual(validateWorktreeStatus(`?? ${ALLOWED_UNTRACKED[0]}`), [...ALLOWED_UNTRACKED]);
  assert.throws(() => validateWorktreeStatus(' M public/config.js'), /only the reviewed parent-migration/);
  assert.throws(() => validateWorktreeStatus('?? scripts/not-reviewed.mjs'), /only the reviewed parent-migration/);
});

test('Sui lock requires exact bytes plus Address Balance payment=[] and ValidDuring gas', () => {
  const bytes = Buffer.from('exact-transaction-bytes');
  const base = {
    gasMode: 'address-balance', payment: [], objects: [{ objectId: '0x1', version: '7', digest: 'object-digest' }],
    simulation: { success: true, commandCount: 1 },
    transaction: {
      bytesBase64: bytes.toString('base64'), bytesSha256: sha256(bytes), digest: 'transaction-digest',
      data: { gasData: { owner: SIGNER, price: '100', budget: '20000000', payment: [] },
        expiration: { ValidDuring: { minEpoch: '1', maxEpoch: '2', chain: 'mainnet', nonce: 7 } } },
    },
  };
  assert.equal(assertExactSuiLock(base, { authority: { signer: SIGNER } }), base);
  assert.throws(() => assertExactSuiLock({ ...base, payment: [{ objectId: '0x2' }] },
    { authority: { signer: SIGNER } }), /payment=\[\]/);
  assert.throws(() => assertExactSuiLock({ ...base, transaction: { ...base.transaction,
    bytesSha256: '0'.repeat(64) } }, { authority: { signer: SIGNER } }), /missing exact bytes/);
  assert.throws(() => assertExactSuiLock({ ...base, transaction: { ...base.transaction,
    data: { ...base.transaction.data, expiration: null } } }, { authority: { signer: SIGNER } }), /ValidDuring/);
});

test('Walrus recovery requires uploaded certificate and certified exact-readback checkpoints', () => {
  const uploaded = { stage: 'uploaded', uploadSessionId: 'session', quiltBlobId: 'quilt',
    blobObjectId: '0xblob', certificate: { encoded: true }, registerDigest: 'register' };
  assert.equal(assertWalrusCheckpoint(uploaded, 'uploaded'), uploaded);
  assert.throws(() => assertWalrusCheckpoint({ ...uploaded, certificate: null }, 'uploaded'), /certificate/);
  const certified = { ...uploaded, stage: 'certified', certifyDigest: 'certify',
    filePatchIds: { manifest: 'patch-1', asset: 'patch-2' }, certificationVisible: true,
    fileReadbacksVerified: true };
  assert.equal(assertWalrusCheckpoint(certified, 'certified'), certified);
  assert.throws(() => assertWalrusCheckpoint({ ...certified, fileReadbacksVerified: false }, 'certified'),
    /readback evidence/);
});

test('CLI source keeps actual gates false, uses only an in-memory action overlay, and queries before broadcast', async () => {
  const source = await readFile(new URL('../scripts/lib/expansion-pack-v8-pack-ceremony.mjs', import.meta.url), 'utf8');
  assert.match(source, /actualExpansionPackV8ReleaseEnabled: false/);
  assert.match(source, /overlayExpansionPackV8ReleaseEnabled: true/);
  assert.match(source, /expansionPackV8ReleaseEnabled: true/);
  assert.doesNotMatch(source, /writeFile\([^\n]*(?:public\/config|runtime-config|deployments\/mainnet)/);
  const query = source.indexOf('await adapters.querySui');
  const broadcast = source.indexOf('await adapters.broadcastSui');
  assert.ok(query > 0 && broadcast > query, 'query-first must precede broadcast');
  const persist = source.indexOf('await persistSubmitted');
  const recover = source.indexOf('return recoverSubmittedAction', persist);
  assert.ok(persist > 0 && recover > persist, 'signed bytes must persist before recovery can broadcast');
});

test('default Walrus adapter uses certifyBlobTransaction and per-file aggregator SHA readback', async () => {
  const source = await readFile(new URL('../scripts/lib/expansion-pack-v8-pack-ceremony-adapters.mjs', import.meta.url), 'utf8');
  assert.match(source, /certifyBlobTransaction\(\{/);
  assert.match(source, /await flow\.listFiles\(\)/);
  assert.match(source, /by-quilt-patch-id/);
  assert.match(source, /sha256\(bytes\) !== descriptor\.sha256/);
  assert.match(source, /await checkpoint\([\s\S]*signedPersisted: true/);
});

test('stable authorization hashing is deterministic', () => {
  const left = { overlay: true, actual: false, plan: { z: 2, a: 1 } };
  const right = { plan: { a: 1, z: 2 }, actual: false, overlay: true };
  assert.equal(stableJson(left), stableJson(right));
  assert.equal(sha256(stableJson(left)), sha256(stableJson(right)));
});
