import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE } from './maker-v8-seal-profile.js';

// Exact Seal seal_v8.move V2 preimages. SealPolicyConfigV8.version remains 8;
// the commitment preimages below all use SCHEMA_REVISION=2.
const HEADER = { domain: bcs.string(), schema_revision: bcs.u64() };
const HASH = bcs.vector(bcs.u8());
const KEY = bcs.struct('KeyServerSetCommitmentInputV2', { ...HEADER,
  ordered_key_servers: bcs.vector(bcs.struct('KeyServerRowV2', { key_server_id: bcs.Address, weight: bcs.u16() })),
  threshold: bcs.u16() });
const ENCRYPTION = bcs.struct('EncryptionPolicyCommitmentInputV2', { ...HEADER,
  cipher_suite: bcs.string(), key_derivation: bcs.string(), ciphertext_format: bcs.string(), max_plaintext_bytes: bcs.u64() });
const POLICY = bcs.struct('SealPolicyCommitmentInputV2', { ...HEADER, policy_id: bcs.Address, catalog_id: bcs.Address,
  package_tuple_commitment: HASH, call_cap_set_commitment: HASH, key_server_set_commitment: HASH, encryption_policy_commitment: HASH });
function check(ok, label) {
  if (!ok) throw Object.assign(new Error(`Invalid Seal policy commitment: ${label}`), { code: 'MAKER_V8_SEAL_POLICY_COMMITMENT_INVALID' });
}
function exact(value, keys, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)), label);
}
function id(value, label) {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), label); return value;
}
function uint(value, bits, label) {
  check(['string', 'number', 'bigint'].includes(typeof value)
    && (typeof value !== 'number' || Number.isSafeInteger(value) && !Object.is(value, -0))
    && /^(0|[1-9][0-9]*)$/.test(String(value)) && BigInt(value) < (1n << BigInt(bits)), label);
  return BigInt(value);
}
function bytes(value, label) {
  if (typeof value === 'string') {
    check(/^[0-9a-f]{64}$/.test(value), label);
    return Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  }
  check(Array.isArray(value) && value.length === 32 && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), label);
  return value;
}
const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const digest = (schema, domain, fields) => hex(sha256(schema.serialize({ domain, schema_revision: 2, ...fields }).toBytes()));

export function deriveMakerV8SealKeyServerSetCommitment(input) {
  exact(input, ['keyServers', 'threshold'], 'key-server fields');
  check(Array.isArray(input.keyServers) && input.keyServers.length > 0 && input.keyServers.length <= 64, 'key-server count');
  let total = 0n, previous = '';
  const rows = input.keyServers.map(row => {
    exact(row, ['objectId', 'weight'], 'key-server row');
    const objectId = id(row.objectId, 'key-server ID'), weight = uint(row.weight, 16, 'key-server weight');
    check(objectId > previous && weight > 0n, 'ordered unique positive key servers');
    previous = objectId; total += weight;
    return { key_server_id: objectId, weight: Number(weight) };
  });
  const threshold = uint(input.threshold, 16, 'threshold');
  check(total <= 254n && threshold > 0n && threshold <= total, 'committee share/threshold bounds');
  return digest(KEY, 'animacraft-fresh-v8/seal/key-server-set/v2', { ordered_key_servers: rows, threshold: Number(threshold) });
}

export function deriveMakerV8SealEncryptionPolicyCommitment(input) {
  exact(input, ['cipherSuite', 'keyDerivation', 'ciphertextFormat', 'maxPlaintextBytes'], 'encryption fields');
  check(Object.keys(MAKER_V8_SEAL_ENCRYPTION_PROFILE).every(key => input[key] === MAKER_V8_SEAL_ENCRYPTION_PROFILE[key]), 'encryption profile');
  const max = uint(input.maxPlaintextBytes, 64, 'max plaintext bytes');
  check(max > 0n && max <= 3n * 1024n * 1024n, 'max plaintext bound');
  return digest(ENCRYPTION, 'animacraft-fresh-v8/seal/encryption-policy/v2', { cipher_suite: input.cipherSuite,
    key_derivation: input.keyDerivation, ciphertext_format: input.ciphertextFormat, max_plaintext_bytes: max });
}

export function deriveMakerV8SealPolicyCommitment(input) {
  exact(input, ['policyId', 'catalogId', 'packageTupleCommitment', 'callCapSetCommitment',
    'keyServerSetCommitment', 'encryptionPolicyCommitment'], 'policy fields');
  return digest(POLICY, 'animacraft-fresh-v8/seal/policy/v2', { policy_id: id(input.policyId, 'policy ID'),
    catalog_id: id(input.catalogId, 'catalog ID'), package_tuple_commitment: bytes(input.packageTupleCommitment, 'tuple'),
    call_cap_set_commitment: bytes(input.callCapSetCommitment, 'cap set'),
    key_server_set_commitment: bytes(input.keyServerSetCommitment, 'key-server commitment'),
    encryption_policy_commitment: bytes(input.encryptionPolicyCommitment, 'encryption commitment') });
}

/** Recompute the three commitments of decoded SealPolicyConfigV8. This does
 * not attest owner/finality, external package bindings, configuration installation
 * or caller authority. Callers retain those independent checks. No mutation. */
export function assertMakerV8SealPolicyCommitments(fields) {
  exact(fields, ['id', 'version', 'protocol_config_id', 'protocol_config_revision', 'catalog_id',
    'product_binding_commitment', 'seal_original_package_id', 'seal_callable_package_id', 'seal_binding_commitment',
    'seal_authority_id', 'call_cap_set_commitment', 'role', 'finalized', 'key_servers', 'threshold',
    'cipher_suite', 'key_derivation', 'ciphertext_format', 'max_plaintext_bytes', 'key_server_set_commitment',
    'encryption_policy_commitment', 'commitment', 'config_commitment'], 'SealConfig fields');
  check(uint(fields.version, 64, 'config version') === 8n, 'config version');
  check(Array.isArray(fields.key_servers), 'key-server rows');
  const keyServers = fields.key_servers.map(row => {
    exact(row, ['key_server_id', 'weight'], 'decoded key-server row');
    return { objectId: row.key_server_id, weight: row.weight };
  });
  const key = deriveMakerV8SealKeyServerSetCommitment({ keyServers, threshold: fields.threshold });
  const encryption = deriveMakerV8SealEncryptionPolicyCommitment({ cipherSuite: fields.cipher_suite,
    keyDerivation: fields.key_derivation, ciphertextFormat: fields.ciphertext_format, maxPlaintextBytes: fields.max_plaintext_bytes });
  check(hex(bytes(fields.key_server_set_commitment, 'stored key-server commitment')) === key, 'key-server commitment');
  check(hex(bytes(fields.encryption_policy_commitment, 'stored encryption commitment')) === encryption, 'encryption commitment');
  const policy = deriveMakerV8SealPolicyCommitment({ policyId: fields.id, catalogId: fields.catalog_id,
    packageTupleCommitment: fields.product_binding_commitment, callCapSetCommitment: fields.call_cap_set_commitment,
    keyServerSetCommitment: key, encryptionPolicyCommitment: encryption });
  check(hex(bytes(fields.commitment, 'stored policy commitment')) === policy, 'policy commitment');
  return fields;
}
