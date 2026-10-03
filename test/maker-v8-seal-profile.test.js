import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE as PROFILE, assertMakerV8SealEncryptionProfile } from '../maker-v8-seal-profile.js';

test('fresh Seal profile matches actual Move initializer and rejects alternate declarations', async () => {
  const move = await readFile(new URL('../move/animacraft_v8_seal/sources/seal_v8.move', import.meta.url), 'utf8');
  const names = { cipherSuite: 'CIPHER_SUITE', keyDerivation: 'KEY_DERIVATION', ciphertextFormat: 'CIPHERTEXT_FORMAT' };
  for (const [key, name] of Object.entries(names)) {
    assert.equal(move.match(new RegExp(`const ${name}: vector<u8> = b"([^"]+)";`))?.[1], PROFILE[key]);
    assert.throws(() => assertMakerV8SealEncryptionProfile({ ...PROFILE, [key]: 'unsupported' }), { code: 'MAKER_V8_SEAL_PROFILE_UNSUPPORTED' });
  }
  assert.deepEqual(assertMakerV8SealEncryptionProfile(PROFILE), PROFILE);
  assert.throws(() => assertMakerV8SealEncryptionProfile(undefined), { code: 'MAKER_V8_SEAL_PROFILE_UNSUPPORTED' });
});
