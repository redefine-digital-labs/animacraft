import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { encryptMakerV8NativeContentV8, createMakerV8NativeContentSidecarV8 } from '../maker-v8-native-content-crypto.js';

const encoder = new TextEncoder();
const plaintext = () => encoder.encode('# Soul\n精确文本\n');
const input = () => ({ plaintext: plaintext(), mimeType: 'text/markdown', fileName: 'soul.md' });
const id = `0x${'12'.repeat(32)}`;

test('real AES-GCM-256 decrypts exactly and retries unchanged material deterministically', async () => {
  const args = input();
  const first = await encryptMakerV8NativeContentV8(args);
  const key = await crypto.subtle.importKey('raw', fromBase64(first.material.dek), 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(first.material.iv) }, key, first.ciphertext);
  assert.deepEqual(new Uint8Array(decrypted), plaintext());
  assert.deepEqual(args.plaintext, plaintext());
  assert.equal(first.ciphertext.length, plaintext().length + 16);
  const retry = await encryptMakerV8NativeContentV8({ ...input(), material: first.material });
  assert.deepEqual(retry.ciphertext, first.ciphertext);
  assert.deepEqual(retry.material, first.material);
  const independent = await encryptMakerV8NativeContentV8(input());
  assert.notEqual(independent.material.dek, first.material.dek);
  assert.notEqual(independent.material.iv, first.material.iv);
});

test('changed plaintext or metadata cannot reuse an existing AES nonce', async () => {
  const { material } = await encryptMakerV8NativeContentV8(input());
  for (const change of [{ plaintext: encoder.encode('changed') }, { mimeType: 'text/plain' }, { fileName: 'memory.md' }]) {
    await assert.rejects(encryptMakerV8NativeContentV8({ ...input(), ...change, material }), /does not match/);
  }
  for (const change of [{ dek: 'bad' }, { iv: toBase64(new Uint8Array(11)) }, { contentHash: 'zz'.repeat(32) }, { version: 2 }]) {
    await assert.rejects(encryptMakerV8NativeContentV8({ ...input(), material: { ...material, ...change } }), { code: 'MAKER_V8_NATIVE_CONTENT_CRYPTO_INVALID' });
  }
});

test('plaintext and material are snapshotted before the first asynchronous boundary', async () => {
  const initial = await encryptMakerV8NativeContentV8(input());
  const args = { ...input(), material: { ...initial.material } };
  const pending = encryptMakerV8NativeContentV8(args);
  args.plaintext.fill(0); args.material.contentHash = '0'.repeat(64); args.fileName = 'changed';
  const result = await pending;
  assert.deepEqual(result.ciphertext, initial.ciphertext);
  assert.equal(result.material.fileName, 'soul.md');
});

test('native content-version sidecar uses exact BE document ID and encrypted DEK/hash envelope only', async () => {
  const { material } = await encryptMakerV8NativeContentV8(input());
  let request; let liveBytes;
  const sidecar = await createMakerV8NativeContentSidecarV8({
    sealClient: { async encrypt(value) { request = { ...value, data: new Uint8Array(value.data) }; liveBytes = value.data; return { encryptedObject: new Uint8Array([9, 8, 7]) }; } },
    threshold: 2, sealPackageId: id, contentObjectId: id, kind: 0x01020304,
    name: '记忆', versionIndex: 0x0102030405060708n, nonce: new Uint8Array(16).fill(0xab), material,
  });
  const expectedId = `0x${Buffer.from('soul-content:').toString('hex')}01` + '01020304'
    + '12'.repeat(32) + Buffer.from('记忆').toString('hex') + '00' + '0102030405060708' + 'ab'.repeat(16);
  assert.equal(sidecar.documentId, expectedId);
  assert.equal(request.id, expectedId); assert.equal(request.packageId, id); assert.equal(request.threshold, 2);
  assert.deepEqual(request.data.slice(0, 32), fromBase64(material.dek));
  assert.equal(Buffer.from(request.data.slice(32)).toString('hex'), material.contentHash);
  assert.equal(liveBytes.every(byte => byte === 0), true);
  assert.deepEqual(Object.keys(sidecar).sort(), ['version', 'mode', 'sealPackageId', 'documentId', 'encryptedDek', 'iv', 'cipher', 'mimeType', 'fileName', 'contentHash'].sort());
  assert.equal(sidecar.encryptedDek, 'CQgH');
  assert.equal(sidecar.cipher, 'AES-GCM-256');
  assert.equal(JSON.stringify(sidecar).includes(material.dek), false);
});

test('sidecar rejects invalid u64, nonce, package and threshold before Seal; redacts Seal errors', async () => {
  const { material } = await encryptMakerV8NativeContentV8(input());
  let calls = 0;
  const base = { sealClient: { async encrypt() { calls++; throw new Error(material.dek); } },
    threshold: 1, sealPackageId: id, contentObjectId: id, kind: 0, name: 'soul', versionIndex: 0, material };
  for (const change of [{ versionIndex: 1n << 64n }, { versionIndex: Number.MAX_SAFE_INTEGER + 1 },
    { versionIndex: -1 }, { nonce: new Uint8Array(15) }, { sealPackageId: '' }, { threshold: 0 }, { threshold: 255 }]) {
    await assert.rejects(createMakerV8NativeContentSidecarV8({ ...base, ...change }), { code: 'MAKER_V8_NATIVE_CONTENT_CRYPTO_INVALID' });
  }
  assert.equal(calls, 0);
  await assert.rejects(createMakerV8NativeContentSidecarV8(base), error => !String(error).includes(material.dek) && /Seal envelope encryption failed/.test(error.message));
});

test('Seal returned symmetric key is erased after success and malformed encrypted output', async () => {
  const { material } = await encryptMakerV8NativeContentV8(input());
  for (const invalid of [false, true]) {
    const key = new Uint8Array(32).fill(5); let plaintextKey;
    const pending = createMakerV8NativeContentSidecarV8({ threshold: 1, sealPackageId: id,
      contentObjectId: id, kind: 0, name: 'soul', versionIndex: 0, material,
      sealClient: { async encrypt(input) { plaintextKey = input.data;
        return { key, encryptedObject: invalid ? new Uint8Array() : new Uint8Array([1]) }; } } });
    if (invalid) await assert.rejects(pending, /empty encrypted envelope/); else await pending;
    assert.ok(key.every(byte => byte === 0)); assert.ok(plaintextKey.every(byte => byte === 0));
  }
});
