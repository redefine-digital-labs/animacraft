// Fresh deployment's single Seal wire profile. Keep in sync with Soulidity's
// native-seal-profile.ts and seal_v8.move; cross-product tests compare values.
// H2/H3 are Seal's domain-separated SHA3-256 derivations, not HKDF.
export const MAKER_V8_SEAL_ENCRYPTION_PROFILE = Object.freeze({
  cipherSuite: 'BonehFranklinBLS12381DemCCA/AesGcm256',
  keyDerivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00',
  ciphertextFormat: 'Seal/EncryptedObject/BCS/v0',
});

// Seal exposes DemType publicly, but keeps KemType private. Its sole supported
// BonehFranklinBLS12381DemCCA enum value is 0; the SDK wire test verifies this.
export const MAKER_V8_SEAL_KEM_TYPE = 0;

export function assertMakerV8SealEncryptionProfile(value) {
  if (!value || typeof value !== 'object'
    || value.cipherSuite !== MAKER_V8_SEAL_ENCRYPTION_PROFILE.cipherSuite
    || value.keyDerivation !== MAKER_V8_SEAL_ENCRYPTION_PROFILE.keyDerivation
    || value.ciphertextFormat !== MAKER_V8_SEAL_ENCRYPTION_PROFILE.ciphertextFormat) {
    throw Object.assign(new Error('Unsupported Seal encryption profile.'), {
      code: 'MAKER_V8_SEAL_PROFILE_UNSUPPORTED', status: 409,
    });
  }
  return MAKER_V8_SEAL_ENCRYPTION_PROFILE;
}
