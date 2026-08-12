import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, symlink } from 'node:fs/promises';
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
import {
  encodeCeremonyQuiltPatchId,
  ceremonyRuntimeFor,
  recoverWalrusFromCheckpoint,
} from '../scripts/lib/expansion-pack-v8-pack-ceremony-adapters.mjs';

const SIGNER = '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f';

test('persists ceremony and signed envelopes atomically with mode 0600 and exact readback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pack-ceremony-test-'));
  const path = join(directory, 'ceremony.json');
  const value = { schemaVersion: 'test', signed: { bytesBase64: 'AA==', signature: 'exact-signature' } };
  const persisted = await atomicWriteJson0600(path, value);
  assert.deepEqual(persisted, value);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), value);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(path)).isFile(), true);
});

test('worktree validation permits only the exact parent-migration untracked path', () => {
  assert.deepEqual(validateWorktreeStatus(`?? ${ALLOWED_UNTRACKED[0]}`), [...ALLOWED_UNTRACKED]);
  assert.throws(() => validateWorktreeStatus(' M public/config.js'), /only the reviewed parent-migration/);
  assert.throws(() => validateWorktreeStatus('?? scripts/not-reviewed.mjs'), /only the reviewed parent-migration/);
});

test('Sui lock requires exact bytes plus Address Balance payment=[] and ValidDuring gas', async () => {
  const bytes = Buffer.from('exact-transaction-bytes');
  const digest = (await import('@mysten/sui/transactions')).TransactionDataBuilder.getDigestFromBytes(bytes);
  const base = {
    gasMode: 'address-balance', payment: [], objects: [{ objectId: '0x1', version: '7', digest: 'object-digest' }],
    addressBalance: { addressBalance: '9999999999' },
    simulation: { success: true, effects: { status: { status: 'success' } } },
    transaction: { bytesBase64: bytes.toString('base64'), bytesSha256: sha256(bytes),
      byteLength: bytes.byteLength, digest,
      data: { sender: SIGNER, gasData: { owner: SIGNER, price: '100', budget: '20000000', payment: [] },
        expiration: { ValidDuring: { minEpoch: '1', maxEpoch: '2', minTimestamp: null,
          maxTimestamp: null, chain: 'mainnet', nonce: 7 } } } },
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
  const adapterSource = await readFile(new URL('../scripts/lib/expansion-pack-v8-pack-ceremony-adapters.mjs', import.meta.url), 'utf8');
  assert.match(source, /actualExpansionPackV8ReleaseEnabled: false/);
  assert.match(source, /overlayExpansionPackV8ReleaseEnabled: true/);
  assert.match(source, /expansionPackV8ReleaseEnabled: true/);
  assert.match(adapterSource, /Transaction \$\{signed\.submission\.transactionDigest\} not found/);
  assert.doesNotMatch(adapterSource, /not found\|could not find\|unknown transaction/);
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
  assert.doesNotMatch(source, /await flow\.listFiles\(\)/);
  assert.match(source, /waitForCertifiedWalrusBlobObject/);
  assert.match(source, /encodeWithIndex/);
  assert.match(source, /by-quilt-patch-id/);
  assert.match(source, /sha256\(bytes\) !== descriptor\.sha256/);
  assert.match(source, /await checkpoint\([\s\S]*signedPersisted: true/);
});

test('SDK-compatible Quilt patch IDs use the exact BlobId and u16 patch layout', async () => {
  const quiltId = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(await encodeCeremonyQuiltPatchId(quiltId, { startIndex: 0x1234, endIndex: 0xabcd }),
    'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNBLNqw');
});

test('atomic persistence rejects a symlink state target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pack-ceremony-symlink-'));
  const target = join(directory, 'target.json');
  await atomicWriteJson0600(target, { ok: true });
  const alias = join(directory, 'alias.json');
  await symlink(target, alias);
  await assert.rejects(atomicWriteJson0600(alias, { ok: false }), /never a symlink/);
});

test('submitted Walrus terminal checkpoints recover confirmation without signing or broadcasting', async () => {
  const action = { id: 'walrus.pack.register-upload' };
  const progress = { stage: 'uploaded', uploadSessionId: 'session', quiltBlobId: 'quilt',
    blobObjectId: '0xblob', certificate: 'certificate', registerDigest: 'register',
    checkpoint: { step: 'uploaded', blobId: 'quilt', rootHash: 'root', unencodedSize: 7, nonce: 'nonce' } };
  const state = { locks: { [action.id]: { lock: { quiltBlobId: 'quilt',
    checkpoint: { ...progress.checkpoint, step: 'encoded' } } } },
    recovery: { currentActionIndex: 0, actions: [{ status: 'SUBMITTED',
      submission: { registerDigest: 'register' } }] } };
  let signatures = 0; let broadcasts = 0;
  const result = await recoverWalrusFromCheckpoint({ action, state, progress,
    sign: () => { signatures += 1; }, broadcast: () => { broadcasts += 1; } });
  assert.equal(result.confirmation.registerDigest, 'register');
  assert.equal(result.confirmation.uploaded, true);
  assert.equal(signatures, 0);
  assert.equal(broadcasts, 0);
});

test('ceremony verifier runtime preserves complete normalized Mainnet identities', async () => {
  const repoRoot = join(new URL('..', import.meta.url).pathname);
  const runtime = await ceremonyRuntimeFor({ repoRoot, plan: { context: {} } });
  const publicSource = await readFile(join(repoRoot, 'public/config.js'), 'utf8');
  for (const field of ['commerceV5TypeOriginPackageId', 'commerceV5CallablePackageId',
    'originalPackageId', 'protocolFeePackageId', 'protocolFeeConfigId',
    'protocolTreasuryId', 'protocolFeeAdminCapId']) {
    const expected = publicSource.match(new RegExp(`${field}:\\s*['\"]([^'\"]+)['\"]`))?.[1];
    assert.ok(expected, `${field} must exist in public config`);
    assert.equal(runtime[field], expected);
  }
  assert.equal(runtime.commerceV5ReleaseEnabled, false);
  assert.equal(runtime.expansionPackV8ReleaseEnabled, true);
});

test('stable authorization hashing is deterministic', () => {
  const left = { overlay: true, actual: false, plan: { z: 2, a: 1 } };
  const right = { plan: { a: 1, z: 2 }, actual: false, overlay: true };
  assert.equal(stableJson(left), stableJson(right));
  assert.equal(sha256(stableJson(left)), sha256(stableJson(right)));
});
