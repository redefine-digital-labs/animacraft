import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { EncryptedObject, DemType } from '@mysten/seal';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE, MAKER_V8_SEAL_KEM_TYPE } from '../maker-v8-seal-profile.js';
import { bcs } from '@mysten/sui/bcs';

import {
  MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
  MAKER_V8_PROTECTED_RENDER_SCHEMA,
  assertMakerV8ProtectedRenderV8,
  createMakerV8ProtectedRenderServiceV8,
  deriveMakerV8SealEncryptionIdentityV8,
  assertMakerV8SealCiphertextV8,
} from '../maker-v8-protected-transport.js';

const id = (value) => `0x${value.toString(16).padStart(64, '0')}`;
const hex = (bytes) => [...bytes]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const SIGNER = id(2);
const policy = { threshold: 1, serverConfigs: [{ objectId: id(90), weight: 1 }],
  maxPlaintextBytes: 3 * 1024 * 1024, encryptionProfile: MAKER_V8_SEAL_ENCRYPTION_PROFILE };

test('local encryption failure clears its owned decoded plaintext buffer', async () => {
  let bytes;
  const service = createMakerV8ProtectedRenderServiceV8({
    async verifyIdentity(value) { return { certified: true, identity: value, ...policy }; },
    async encrypt(input) { bytes = input.data; throw Error('provider unavailable'); },
  });
  await assert.rejects(service.protect({ schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
    identity: identity(), render: render() }), /provider unavailable/);
  assert.deepEqual([...bytes], [0, 0, 0, 0]);
});

test('two independent identities bind exact 2-of-2 ciphertext without lowering threshold or substituting keys', () => {
  const derived = deriveMakerV8SealEncryptionIdentityV8(identity());
  const parsed = EncryptedObject.parse(ciphertext({ packageId: derived.packageId,
    sealId: derived.sealId, aad: fromBase64(derived.aadBase64) }));
  parsed.threshold = 2;
  parsed.services = [[id(90), 1], [id(91), 2]];
  parsed.encryptedShares.BonehFranklinBLS12381.encryptedShares.push(new Uint8Array(32).fill(3));
  const bytes = EncryptedObject.serialize(parsed).toBytes();
  const expected = { ...derived, ...policy, threshold: 2,
    serverConfigs: [{ objectId: id(90), weight: 1 }, { objectId: id(91), weight: 1 }] };
  assert.doesNotThrow(() => assertMakerV8SealCiphertextV8(bytes, expected));
  for (const change of [{ threshold: 1 },
    { serverConfigs: [{ objectId: id(90), weight: 2 }] },
    { serverConfigs: [{ objectId: id(90), weight: 1 }, { objectId: id(92), weight: 1 }] }]) {
    assert.throws(() => assertMakerV8SealCiphertextV8(bytes, { ...expected, ...change }));
  }
});

function ciphertext({ packageId, sealId, aad }) {
  return EncryptedObject.serialize({
    version: 0,
    packageId,
    id: sealId,
    services: [[id(90), 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96).fill(7),
        encryptedShares: [new Uint8Array(32).fill(8)],
        encryptedRandomness: new Uint8Array(32).fill(9),
      },
    },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(20).fill(5), aad } },
  }).toBytes();
}

function identity(overrides = {}) {
  return {
    schemaVersion: 'animacraft.maker-v8-protected-render-identity.v1',
    rootId: id(1),
    makerVersion: '7',
    rootContentCommitment: '1'.repeat(64),
    signer: SIGNER,
    outputKey: 'portrait',
    scopeKey: 'complete/portrait',
    assetKey: `receipt-${SIGNER.slice(2)}-11`,
    releasePackageId: id(3),
    productBindingCommitment: '2'.repeat(64),
    policyCommitment: '3'.repeat(64),
    sealPolicyConfigId: id(4),
    sealRegistryId: id(5),
    sealRuntimeRevision: '9',
    ...overrides,
  };
}

function render() {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  return {
    mediaType: 'image/png',
    bytesBase64: toBase64(bytes),
    byteLength: bytes.length,
    sha256: hex(sha256(bytes)),
  };
}

test('pre-encryption Seal identity is deterministic and excludes ciphertext/Walrus fields', () => {
  const first = deriveMakerV8SealEncryptionIdentityV8(identity());
  const second = deriveMakerV8SealEncryptionIdentityV8(identity());
  assert.deepEqual(first, second);
  assert.equal(first.packageId, id(3));
  assert.match(first.sealId, /^[0-9a-f]{64}$/);
  assert.equal(first.sealId, first.aadSha256);
  const schema = bcs.struct('IndependentCurrentSealId', { domain: bcs.string(), schema_revision: bcs.u64(), product_binding_commitment: bcs.byteVector(), policy_commitment: bcs.byteVector(), root_content_commitment: bcs.byteVector(), maker_version: bcs.u64(), scope_kind: bcs.u8(), scope_key: bcs.string(), asset_key: bcs.string() });
  const decoded = schema.parse(fromBase64(first.aadBase64));
  assert.equal(decoded.domain, 'animacraft-fresh-v8/seal/ciphertext-id/v2');
  assert.equal(decoded.schema_revision, '2');
  assert.equal(hex(sha256(schema.serialize(decoded).toBytes())), first.sealId);
  assert.equal(Object.hasOwn(first, 'blobId'), false);
  assert.equal(Object.hasOwn(first, 'ciphertextSha256'), false);

  const changed = deriveMakerV8SealEncryptionIdentityV8(identity({ makerVersion: '8' }));
  assert.notEqual(changed.sealId, first.sealId);
});

test('local service certifies exact live identity before encrypting and never returns the symmetric key', async () => {
  const calls = [];
  const service = createMakerV8ProtectedRenderServiceV8({
    async verifyIdentity(value) {
      calls.push(['verify', value]);
      return { certified: true, identity: value, ...policy };
    },
    async encrypt(input) {
      calls.push(['encrypt', input]);
      return {
        encryptedObject: ciphertext({
          packageId: input.packageId,
          sealId: input.id,
          aad: input.aad,
        }),
        key: Uint8Array.from({ length: 32 }, () => 4),
      };
    },
  });
  const request = {
    schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
    identity: identity(),
    render: render(),
  };
  const result = await service.protect(request);
  const checked = assertMakerV8ProtectedRenderV8(result, request.identity);
  assert.equal(checked.schemaVersion, MAKER_V8_PROTECTED_RENDER_SCHEMA);
  assert.equal(Object.hasOwn(result, 'key'), false);
  assert.equal(calls[0][0], 'verify');
  assert.equal(calls[1][0], 'encrypt');
  assert.equal(calls[1][1].id, result.sealId);
  assert.equal(calls[1][1].packageId, id(3));
  assert.equal(calls[1][1].kemType, MAKER_V8_SEAL_KEM_TYPE);
  assert.equal(calls[1][1].demType, DemType.AesGcm256);
});

test('identity drift and plaintext-equivalent encryption fail closed', async () => {
  const request = {
    schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
    identity: identity(),
    render: render(),
  };
  const drifted = createMakerV8ProtectedRenderServiceV8({
    async verifyIdentity(value) {
      return { certified: true, identity: { ...value, sealRuntimeRevision: '10' }, threshold: 1 };
    },
    async encrypt() { throw new Error('not reached'); },
  });
  await assert.rejects(
    drifted.protect(request),
    (error) => error.code === 'MAKER_V8_PROTECTED_IDENTITY_UNCERTIFIED',
  );

  const plaintext = createMakerV8ProtectedRenderServiceV8({
    async verifyIdentity(value) { return { certified: true, identity: value, ...policy }; },
    async encrypt() { return { encryptedObject: Uint8Array.from([1, 2, 3, 4]), key: new Uint8Array(32) }; },
  });
  await assert.rejects(
    plaintext.protect(request),
    (error) => error.code === 'MAKER_V8_PROTECTED_ENCRYPTION_INVALID',
  );
});


test('producer rejects missing or unsupported verified profile before encryption', async () => {
  for (const profile of [undefined, ...Object.keys(MAKER_V8_SEAL_ENCRYPTION_PROFILE).map((key) => ({
    ...MAKER_V8_SEAL_ENCRYPTION_PROFILE, [key]: 'unsupported',
  }))]) {
    let calls = 0;
    const service = createMakerV8ProtectedRenderServiceV8({
      async verifyIdentity(value) { return { certified: true, identity: value, threshold: 1, encryptionProfile: profile }; },
      async encrypt() { calls += 1; throw new Error('not reached'); },
    });
    await assert.rejects(service.protect({ schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
      identity: identity(), render: render() }), { code: 'MAKER_V8_SEAL_PROFILE_UNSUPPORTED' });
    assert.equal(calls, 0);
  }
});

test('producer rejects returned HMAC ciphertext despite correct identity and declared AES profile', async () => {
  const service = createMakerV8ProtectedRenderServiceV8({
    async verifyIdentity(value) { return { certified: true, identity: value, ...policy }; },
    async encrypt(input) {
      const parsed = EncryptedObject.parse(ciphertext({ packageId: input.packageId, sealId: input.id, aad: input.aad }));
      parsed.ciphertext = { Hmac256Ctr: { blob: new Uint8Array([9]), aad: input.aad, mac: new Uint8Array(32) } };
      return { encryptedObject: EncryptedObject.serialize(parsed).toBytes() };
    },
  });
  await assert.rejects(service.protect({ schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
    identity: identity(), render: render() }), { code: 'MAKER_V8_PROTECTED_CIPHERTEXT_INVALID' });
});

test('shared ciphertext preflight enforces exact weighted services, indices, AAD hash and plaintext bound', () => {
  const derived = deriveMakerV8SealEncryptionIdentityV8(identity());
  const bytes = ciphertext({ packageId: derived.packageId, sealId: derived.sealId, aad: fromBase64(derived.aadBase64) });
  const expected = { ...derived, ...policy };
  assert.equal(assertMakerV8SealCiphertextV8(bytes, expected).ciphertext.$kind, 'Aes256Gcm');
  for (const override of [
    { packageId: id(99) }, { sealId: 'ab'.repeat(32) }, { aadBase64: toBase64(new Uint8Array([1])) },
    { threshold: 2 }, { serverConfigs: [{ objectId: id(99), weight: 1 }] },
    { serverConfigs: [{ objectId: id(90), weight: 255 }] },
    { maxPlaintextBytes: 3 }, { maxPlaintextBytes: 3 * 1024 * 1024 + 1 },
  ]) assert.throws(() => assertMakerV8SealCiphertextV8(bytes, { ...expected, ...override }), { code: 'MAKER_V8_PROTECTED_CIPHERTEXT_INVALID' });
  const weighted = EncryptedObject.parse(bytes);
  weighted.services = [[id(90), 1], [id(90), 2]];
  weighted.encryptedShares.BonehFranklinBLS12381.encryptedShares.push(new Uint8Array(32));
  const two = { ...expected, threshold: 2, serverConfigs: [{ objectId: id(90), weight: 2 }] };
  weighted.threshold = 2;
  assertMakerV8SealCiphertextV8(EncryptedObject.serialize(weighted).toBytes(), two);
  for (const mutate of [
    p => { p.services[1][1] = 1; },
    p => { p.services[1][1] = 0; },
    p => { p.services[1][1] = 3; },
    p => { p.services[1][0] = id(91); },
    p => { p.encryptedShares.BonehFranklinBLS12381.encryptedShares.pop(); },
    p => { p.version = 1; },
    p => { p.ciphertext.Aes256Gcm.blob = new Uint8Array(16); },
  ]) {
    const value = EncryptedObject.parse(EncryptedObject.serialize(weighted).toBytes()); mutate(value);
    assert.throws(() => assertMakerV8SealCiphertextV8(EncryptedObject.serialize(value).toBytes(), two), { code: 'MAKER_V8_PROTECTED_CIPHERTEXT_INVALID' });
  }
  assert.throws(() => assertMakerV8SealCiphertextV8(new Uint8Array([...bytes, 0]), expected), { code: 'MAKER_V8_PROTECTED_CIPHERTEXT_INVALID' });
});
