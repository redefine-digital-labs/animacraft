import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { deriveMakerV8SealKeyServerSetCommitment as keyHash,
  deriveMakerV8SealEncryptionPolicyCommitment as encryptionHash,
  deriveMakerV8SealPolicyCommitment as policyHash,
  assertMakerV8SealPolicyCommitments as assertPolicy } from '../maker-v8-seal-policy-commitments.js';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE as PROFILE } from '../maker-v8-seal-profile.js';
import { nativeSoulBootstrapFixture } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { nativeSoulStageOutcomeFixture } from './fixtures/native-soul-native-stage-ready-fixture.mjs';
import { rewriteHistoricalObject } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
import { bootstrapFinalityEvents } from './fixtures/native-soul-bootstrap-events-fixture.mjs';
import { NativeSoulBootstrapBcs as B } from '../scripts/native-soul-bootstrap-readback.mjs';
import { validateNativeSoulBootstrapHistory } from '../scripts/native-soul-bootstrap-history.mjs';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const keyInput = { keyServers: [{ objectId: id(1), weight: '2' }, { objectId: id(2), weight: '3' }], threshold: '4' };
const encryptionInput = { ...PROFILE, maxPlaintextBytes: '3145728' };
const policyInput = { policyId: id(10), catalogId: id(11), packageTupleCommitment: '11'.repeat(32),
  callCapSetCommitment: '22'.repeat(32), keyServerSetCommitment: '33'.repeat(32), encryptionPolicyCommitment: '44'.repeat(32) };
const invalid = { code: 'MAKER_V8_SEAL_POLICY_COMMITMENT_INVALID' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Manual BCS construction, independent of the production/fixture bcs schemas.
const uint = (n, size) => { const b = Buffer.alloc(size); let value = BigInt(n);
  for (let i = 0; i < size; i++) { b[i] = Number(value & 255n); value >>= 8n; } return b; };
const leb = n => { const out = []; do { const low = n & 127; n >>>= 7; out.push(low | (n ? 128 : 0)); } while (n); return Buffer.from(out); };
const vector = bytes => Buffer.concat([leb(bytes.length), Buffer.from(bytes)]);
const string = value => vector(Buffer.from(value, 'utf8'));
const header = name => Buffer.concat([string(`animacraft-fresh-v8/seal/${name}/v2`), uint(2, 8)]);
const address = value => Buffer.from(value.slice(2), 'hex');
const hashVector = value => vector(Buffer.from(value, 'hex'));

test('key-server V2 hash matches manual Move field order, ordered rows and u16 threshold', () => {
  const expected = sha(Buffer.concat([header('key-server-set'), leb(2), address(id(1)), uint(2, 2),
    address(id(2)), uint(3, 2), uint(4, 2)]));
  assert.equal(keyHash(keyInput), expected);
  assert.notEqual(keyHash({ ...keyInput, threshold: '3' }), expected);
  assert.notEqual(keyHash({ ...keyInput, keyServers: [{ objectId: id(1), weight: '1' }, keyInput.keyServers[1]] }), expected);
});
test('encryption V2 hash matches manual String/u64 layout and binds the permitted size', () => {
  const expected = sha(Buffer.concat([header('encryption-policy'), string(PROFILE.cipherSuite), string(PROFILE.keyDerivation),
    string(PROFILE.ciphertextFormat), uint(3145728, 8)]));
  assert.equal(encryptionHash(encryptionInput), expected);
  assert.notEqual(encryptionHash({ ...encryptionInput, maxPlaintextBytes: '1' }), expected);
});
test('policy V2 hash matches manual six-field preimage, not the retired protocol/authority preimage', () => {
  const expected = sha(Buffer.concat([header('policy'), address(policyInput.policyId), address(policyInput.catalogId),
    ...['packageTupleCommitment', 'callCapSetCommitment', 'keyServerSetCommitment', 'encryptionPolicyCommitment']
      .map(key => hashVector(policyInput[key]))]));
  assert.equal(policyHash(policyInput), expected);
  const arrays = Object.fromEntries(Object.entries(policyInput).map(([key, value]) => [key,
    key.endsWith('Commitment') ? [...Buffer.from(value, 'hex')] : value]));
  assert.equal(policyHash(arrays), expected);
  for (const key of Object.keys(policyInput)) assert.notEqual(policyHash({ ...policyInput,
    [key]: key.endsWith('Id') ? id(99) : 'ff'.repeat(32) }), expected, key);
  assert.throws(() => policyHash({ ...policyInput, protocolConfigId: id(5) }), invalid);
});

for (const [label, mutate] of [
  ['empty committee', x => { x.keyServers = []; }],
  ['too many servers', x => { x.keyServers = Array.from({ length: 65 }, (_, i) => ({ objectId: id(i + 1), weight: 1 })); }],
  ['unsorted', x => { x.keyServers.reverse(); }],
  ['duplicate', x => { x.keyServers[1].objectId = x.keyServers[0].objectId; }],
  ['zero ID', x => { x.keyServers[0].objectId = id(0); }],
  ['short ID', x => { x.keyServers[0].objectId = '0x1'; }],
  ['zero weight', x => { x.keyServers[0].weight = '0'; }],
  ['fraction weight', x => { x.keyServers[0].weight = 1.5; }],
  ['leading-zero weight', x => { x.keyServers[0].weight = '02'; }],
  ['share overflow', x => { x.keyServers[0].weight = '254'; }],
  ['u16 overflow', x => { x.keyServers[0].weight = '65536'; }],
  ['zero threshold', x => { x.threshold = 0; }],
  ['threshold over total', x => { x.threshold = 6; }],
  ['extra key', x => { x.keyServers[0].ignored = true; }],
]) test(`Seal keyset rejects ${label}`, () => { const x = structuredClone(keyInput); mutate(x); assert.throws(() => keyHash(x), invalid); });

for (const [key, value] of [['cipherSuite', 'AES-256-GCM'], ['keyDerivation', 'HKDF-SHA256'],
  ['ciphertextFormat', 'legacy-json'], ['maxPlaintextBytes', '0'], ['maxPlaintextBytes', '3145729'],
  ['maxPlaintextBytes', -0], ['maxPlaintextBytes', '18446744073709551616']]) {
  test(`Seal encryption rejects ${key}=${String(value)}`, () => assert.throws(() => encryptionHash({ ...encryptionInput, [key]: value }), invalid));
}
for (const [key, value] of [['policyId', '0x1'], ['catalogId', id(0)], ['packageTupleCommitment', 'AA'.repeat(32)],
  ['callCapSetCommitment', Array(31).fill(1)], ['keyServerSetCommitment', Array(32).fill(256)],
  ['encryptionPolicyCommitment', new Uint8Array(32)]]) {
  test(`Seal policy rejects invalid ${key}`, () => assert.throws(() => policyHash({ ...policyInput, [key]: value }), invalid));
}

test('decoded Seal config assertion is read-only and checks all three independently encoded hashes', () => {
  const fields = nativeSoulBootstrapFixture('SETUP_RELEASE').fields.sealConfig, before = structuredClone(fields);
  Object.freeze(fields);
  assert.equal(assertPolicy(fields), fields); assert.deepEqual(fields, before);
  for (const key of ['key_server_set_commitment', 'encryption_policy_commitment', 'commitment']) {
    const bad = structuredClone(fields); bad[key][0] ^= 1;
    assert.throws(() => assertPolicy(bad), invalid);
  }
});

for (const key of ['key_server_set_commitment', 'encryption_policy_commitment', 'commitment']) {
  test(`actual native outcome rejects forged ${key} even with rehashed Object/effects/event/certificate`, () => {
    const input = nativeSoulStageOutcomeFixture('SETUP_RELEASE');
    assert.equal(L.buildMainnetV8OutcomeEvidence(input).kind, 'FINALIZED_SUCCESS');
    const c = input.observation.certificate, r = c.readback, seal = r.objects.sealConfig;
    rewriteHistoricalObject(seal, raw => {
      const fields = B.sealConfig.parse(Uint8Array.from(raw.data.Move.contents)); fields[key][0] ^= 1;
      if (key !== 'commitment') fields.commitment = [...Buffer.from(policyHash({ policyId: fields.id,
        catalogId: fields.catalog_id, packageTupleCommitment: fields.product_binding_commitment,
        callCapSetCommitment: fields.call_cap_set_commitment, keyServerSetCommitment: fields.key_server_set_commitment,
        encryptionPolicyCommitment: fields.encryption_policy_commitment }), 'hex')];
      raw.data.Move.contents = B.sealConfig.serialize(fields).toBytes();
    });
    const f = c.finalityEvidence, effects = bcs.TransactionEffects.parse(fromBase64(f.effectsBcsBase64));
    effects.V2.changedObjects.find(([objectId]) => objectId === seal.reference.objectId)[1].outputState.ObjectWrite[0] = seal.reference.digest;
    Object.assign(f, bootstrapFinalityEvents({ stage: r.stage, input: r.input, sender: input.signedArtifact.signer, objects: r.objects }));
    effects.V2.eventsDigest = f.eventsDigest;
    const wire = bcs.TransactionEffects.serialize(effects).toBytes();
    Object.assign(f, { effectsBcsBase64: toBase64(wire), effectsSha256: L.sha256MainnetV8Bytes(wire),
      effectsDigest: L.mainnetV8TypedDigest('TransactionEffects', wire) });
    c.finalityEvidenceSha256 = L.sha256MainnetV8Json(f); c.readbackSha256 = L.sha256MainnetV8Json(r);
    input.observation.certificateSha256 = L.sha256MainnetV8Json(c);
    // Exact identity/relationship/effects controls still pass. Rejection is the
    // new policy recomputation, not a stale outer digest or malformed Object.
    assert.doesNotThrow(() => validateNativeSoulBootstrapHistory({ stage: r.stage, input: r.input,
      sender: input.signedArtifact.signer, transactionBytes: fromBase64(f.transactionBase64), effectsBytes: wire,
      objects: r.objects, priorObjects: r.priorObjects, consensusObjects: r.consensusObjects }));
    assert.throws(() => L.buildMainnetV8OutcomeEvidence(input), invalid);
  });
}
