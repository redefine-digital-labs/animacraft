import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';

const ROLES = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const HASH = bcs.vector(bcs.u8());
const HEADER = { domain: bcs.string(), schema_revision: bcs.u64() };
const BINDING = { original_package_id: bcs.Address, callable_package_id: bcs.Address,
  source_commitment: HASH, package_commitment: HASH, abi_commitment: HASH };
const ROLE_HASHES = Object.fromEntries(ROLES.map(role => [`${role}_binding_commitment`, HASH]));
const AUTHORITIES = Object.fromEntries(ROLES.slice(1).map(role => [`${role}_authority_id`, bcs.Address]));
const EXACT = bcs.struct('ExactPackageBindingInputV2', { ...HEADER, role: bcs.u8(), ...BINDING });
const CAPS = bcs.struct('PackageCallCapSetCommitmentInputV2', { ...HEADER, catalog_id: bcs.Address, ...ROLE_HASHES, ...AUTHORITIES });
const TUPLE = bcs.struct('PackageTupleInputV2', { ...HEADER, catalog_id: bcs.Address,
  native_capability_mask: bcs.u64(), call_cap_set_commitment: HASH,
  ...Object.fromEntries(ROLES.map(role => [`${role}_binding`, HASH])) });
const CATALOG = bcs.struct('CatalogCommitmentInputV2', { ...HEADER, catalog_id: bcs.Address,
  protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: HASH,
  package_tuple_commitment: HASH, call_cap_set_commitment: HASH, native_capability_mask: bcs.u64(), ...AUTHORITIES });

function check(condition, label) {
  if (!condition) {
    const error = new Error(`Invalid current Catalog commitment: ${label}`);
    error.code = 'MAKER_V8_CATALOG_COMMITMENT_INVALID';
    throw error;
  }
}
function exact(value, fields, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), label);
}
function id(value, label) {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), label);
}
function uint(value, label) {
  check(['string', 'number', 'bigint'].includes(typeof value)
    && (typeof value !== 'number' || Number.isSafeInteger(value) && !Object.is(value, -0))
    && /^(0|[1-9][0-9]*)$/.test(String(value)) && BigInt(value) < (1n << 64n), label);
}
function hash(value, label) {
  check(Array.isArray(value) && value.length === 32
    && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), label);
}
function match(value, schema, fields, domain, label) {
  hash(value, label);
  const expected = sha256(schema.serialize({ domain, schema_revision: 2, ...fields }).toBytes());
  check(value.every((byte, index) => byte === expected[index]), label);
}

/** Assert the immutable four-layer V2 commitment chain of decoded Catalog BCS.
 * Does not attest object owner/finality, protocol contents, installed config
 * commitments, runtime caller capabilities, or completion of setup. Callers
 * retain those checks. The setup progress fields are not in these preimages. */
export function assertMakerV8CatalogCommitments(fields) {
  exact(fields, ['id', 'schema_revision', 'protocol_config_id', 'protocol_config_revision',
    'protocol_config_commitment', 'binding', 'authority_ids', 'call_cap_set_commitment',
    'catalog_commitment', 'next_setup_role', 'role_config_ids', 'role_config_commitments'], 'Catalog fields');
  uint(fields.schema_revision, 'schema_revision');
  check(BigInt(fields.schema_revision) === 2n, 'schema_revision');
  id(fields.id, 'Catalog ID'); id(fields.protocol_config_id, 'Protocol ID');
  uint(fields.protocol_config_revision, 'Protocol revision'); hash(fields.protocol_config_commitment, 'Protocol commitment');
  exact(fields.binding, ['bindings', 'commitment'], 'Product binding fields');
  const bindings = fields.binding.bindings;
  check(Array.isArray(bindings) && bindings.length === 7, 'seven package bindings');
  const roleHashes = {}, tupleHashes = {};
  bindings.forEach((row, index) => {
    exact(row, [...Object.keys(BINDING), 'commitment'], `${ROLES[index]} fields`);
    id(row.original_package_id, `${ROLES[index]} original ID`); id(row.callable_package_id, `${ROLES[index]} callable ID`);
    for (const key of ['source_commitment', 'package_commitment', 'abi_commitment']) hash(row[key], `${ROLES[index]} ${key}`);
    const { commitment, ...input } = row;
    match(commitment, EXACT, { role: index, ...input }, 'animacraft-fresh-v8/package/exact-binding/v2', `${ROLES[index]} binding`);
    roleHashes[`${ROLES[index]}_binding_commitment`] = commitment;
    tupleHashes[`${ROLES[index]}_binding`] = commitment;
  });
  check(new Set(bindings.map(row => row.original_package_id)).size === 7
    && new Set(bindings.map(row => row.callable_package_id)).size === 7, 'distinct package roles');
  check(Array.isArray(fields.authority_ids) && fields.authority_ids.length === 6
    && new Set(fields.authority_ids).size === 6, 'six distinct authority IDs');
  fields.authority_ids.forEach((value, index) => id(value, `${ROLES[index + 1]} authority ID`));
  const authorities = Object.fromEntries(ROLES.slice(1).map((role, index) => [`${role}_authority_id`, fields.authority_ids[index]]));
  match(fields.call_cap_set_commitment, CAPS, { catalog_id: fields.id, ...roleHashes, ...authorities },
    'animacraft-fresh-v8/package/call-cap-set/v2', 'Call cap set');
  match(fields.binding.commitment, TUPLE, { catalog_id: fields.id, native_capability_mask: 127,
    call_cap_set_commitment: fields.call_cap_set_commitment, ...tupleHashes },
  'animacraft-fresh-v8/package/product-tuple/v2', 'Product tuple');
  match(fields.catalog_commitment, CATALOG, { catalog_id: fields.id,
    protocol_config_id: fields.protocol_config_id, protocol_config_revision: fields.protocol_config_revision,
    protocol_config_commitment: fields.protocol_config_commitment, package_tuple_commitment: fields.binding.commitment,
    call_cap_set_commitment: fields.call_cap_set_commitment, native_capability_mask: 127, ...authorities },
  'animacraft-fresh-v8/core/catalog/v2', 'Catalog commitment');
}
