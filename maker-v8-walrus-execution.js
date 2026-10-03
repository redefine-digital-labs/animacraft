import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { fromBase64, toBase64, toBase58, fromBase58, toHex, normalizeStructTag } from '@mysten/sui/utils';
import { MAINNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { blake2b } from '@noble/hashes/blake2.js';

export const MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77';
export const MAKER_V8_WALRUS_SYSTEM_ID = MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId;
export const MAKER_V8_WALRUS_EXECUTION_SCHEMA = 'animacraft.walrus-execution.v1';
export const MAKER_V8_WALRUS_MINIMUM_DEPENDENCY = Object.freeze({
  originalPackageId: MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID,
  publishedAt: '0xfa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e', version: '2',
});
export const MakerV8WalrusSystemBcs = bcs.struct('System', {
  id: bcs.Address, version: bcs.u64(), package_id: bcs.Address, new_package_id: bcs.option(bcs.Address),
});
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function check(ok, label) {
  if (!ok) throw Object.assign(new Error(`Invalid Walrus execution evidence: ${label}`), { code: 'MAKER_V8_WALRUS_EXECUTION_INVALID' });
}
function exact(value, keys, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'), label);
}
function id(value) {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'canonical ID');
  return value;
}
function uint(value) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) < 2n ** 64n, 'positive canonical u64');
  return value;
}
function decode(codec, encoded, maximum) {
  check(typeof encoded === 'string' && encoded.length <= Math.ceil(maximum / 3) * 4, 'bounded BCS');
  const bytes = fromBase64(encoded);
  check(bytes.length <= maximum && toBase64(bytes) === encoded, 'canonical base64');
  const parsed = codec.parse(bytes);
  check(toBase64(codec.serialize(parsed).toBytes()) === encoded, 'canonical BCS roundtrip');
  return { bytes, parsed };
}
function fullObject(value) {
  exact(value, ['reference', 'objectBcsBase64'], 'object evidence');
  exact(value.reference, ['objectId', 'version', 'digest'], 'object reference');
  id(value.reference.objectId); uint(value.reference.version);
  const digest = value.reference.digest;
  check(typeof digest === 'string' && fromBase58(digest).length === 32 && toBase58(fromBase58(digest)) === digest, 'digest');
  const { bytes, parsed } = decode(bcs.Object, value.objectBcsBase64, 16 * 1024 * 1024);
  const domain = new TextEncoder().encode('Object::');
  const preimage = new Uint8Array(domain.length + bytes.length);
  preimage.set(domain); preimage.set(bytes, domain.length);
  check(toBase58(blake2b(preimage, { dkLen: 32 })) === digest, 'Object digest');
  return parsed;
}

// Bounded Move binary header/table reader, matching MovePackage's self handle
// identity rule. This is not a replacement for the chain bytecode verifier.
export function readMakerV8MoveModuleIdentity(bytes) {
  const invalid = () => check(false, 'Move module identity');
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > 16 * 1024 * 1024
    || ![0xa1, 0x1c, 0xeb, 0x0b].every((v, i) => bytes[i] === v)) invalid();
  const rawVersion = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const version = rawVersion & 0x00ffffff;
  if (version < 1 || version > 7 || (version < 7 ? rawVersion !== version : rawVersion >>> 24 !== 5)) invalid();
  let offset = 8;
  const read = (maximum, end = bytes.length) => {
    let value = 0, shift = 0;
    for (let count = 0; count < 5; count++) {
      if (offset >= end) return invalid();
      const byte = bytes[offset++]; value += (byte & 0x7f) * 2 ** shift;
      if (value > maximum) return invalid();
      if (!(byte & 0x80)) { if (count > 0 && byte === 0) return invalid(); return value; }
      shift += 7;
    }
    return invalid();
  };
  const count = read(255), tables = [], kinds = new Set();
  for (let i = 0; i < count; i++) {
    if (offset >= bytes.length) invalid();
    const kind = bytes[offset++], start = read(0xffffffff), size = read(0xffffffff);
    if (![1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20].includes(kind) || kinds.has(kind) || size === 0) invalid();
    kinds.add(kind); tables.push({ kind, start, size });
  }
  const dataStart = offset;
  let total = 0;
  for (const table of tables.sort((a, b) => a.start - b.start)) {
    if (table.start !== total) invalid();
    total += table.size;
    if (dataStart + total >= bytes.length) invalid();
  }
  offset = dataStart + total;
  const self = read(65535);
  if (offset !== bytes.length) invalid();
  const handles = tables.find(r => r.kind === 1), names = tables.find(r => r.kind === 7), addresses = tables.find(r => r.kind === 8);
  if (!handles || !names || !addresses || addresses.size % 32 !== 0) invalid();
  offset = dataStart + handles.start;
  const rows = [], end = offset + handles.size;
  while (offset < end) rows.push([read(65535, end), read(65535, end)]);
  const handle = rows[self];
  if (!handle || handle[0] >= addresses.size / 32) invalid();
  offset = dataStart + names.start;
  const identifiers = [], nameEnd = offset + names.size;
  while (offset < nameEnd) {
    const size = read(65535, nameEnd);
    if (size === 0 || offset + size > nameEnd) invalid();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + size));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) invalid();
    identifiers.push(name); offset += size;
  }
  if (!identifiers[handle[1]]) invalid();
  const start = dataStart + addresses.start + handle[0] * 32;
  return { originalId: `0x${toHex(bytes.subarray(start, start + 32))}`, moduleName: identifiers[handle[1]] };
}

/** Cold validation binds actual execution to full Object bytes, independently of
 * the package's immutable static dependency minimum. No latest-ID substitution. */
export function assertMakerV8WalrusExecutionV1(evidence, { minimumDependency } = {}) {
  try {
    const e = structuredClone(evidence), minimum = structuredClone(minimumDependency);
    exact(minimum, ['originalPackageId', 'publishedAt', 'version'], 'dependency minimum');
    check(id(minimum.originalPackageId) === MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID, 'Walrus original identity');
    id(minimum.publishedAt); uint(minimum.version);
    exact(e, ['schemaVersion', 'system', 'package'], 'execution evidence');
    check(e.schemaVersion === MAKER_V8_WALRUS_EXECUTION_SCHEMA, 'schema');
    const systemObject = fullObject(e.system), packageObject = fullObject(e.package);
    check(e.system.reference.objectId === MAKER_V8_WALRUS_SYSTEM_ID, 'real Mainnet System');
    check(systemObject.data.$kind === 'Move' && systemObject.owner.$kind === 'Shared', 'System kind/owner');
    const move = systemObject.data.Move;
    check(BigInt(uint(systemObject.owner.Shared.initialSharedVersion)) <= BigInt(e.system.reference.version), 'shared birth precedes Object version');
    check(move.version === e.system.reference.version && move.hasPublicTransfer === false && move.type.$kind === 'Other'
      && normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other }))
        === normalizeStructTag(`${MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID}::system::System`), 'System type/version');
    const system = decode(MakerV8WalrusSystemBcs, toBase64(move.contents), 256).parsed;
    check(system.id === e.system.reference.objectId && ['2', '3'].includes(system.version), 'supported System schema');
    id(system.package_id);
    if (system.new_package_id !== null) id(system.new_package_id);
    check(packageObject.data.$kind === 'Package' && packageObject.owner.$kind === 'Immutable', 'immutable Package');
    const pkg = packageObject.data.Package;
    check(pkg.id === e.package.reference.objectId && pkg.version === e.package.reference.version
      && pkg.id === system.package_id && pkg.version === system.version
      && BigInt(pkg.version) >= BigInt(minimum.version)
      && (pkg.version !== minimum.version || pkg.id === minimum.publishedAt), 'effective package/version minimum');
    check(pkg.moduleMap.size > 0, 'package modules');
    for (const [name, bytes] of pkg.moduleMap) {
      const identity = readMakerV8MoveModuleIdentity(bytes);
      check(identity.originalId === minimum.originalPackageId && identity.moduleName === name, 'package original/self identity');
    }
    for (const [module, name] of [['system', 'System'], ['blob', 'Blob'], ['system_state_inner', 'SystemStateInnerV1']]) {
      const rows = pkg.typeOriginTable.filter(row => row.moduleName === module && row.datatypeName === name);
      check(rows.length === 1 && rows[0].package === minimum.originalPackageId && pkg.moduleMap.has(module), 'required original TypeOrigin');
    }
    return freeze({ packageId: pkg.id, packageVersion: pkg.version, systemVersion: system.version,
      system: { objectId: system.id, initialSharedVersion: uint(systemObject.owner.Shared.initialSharedVersion) } });
  } catch (error) {
    if (error?.code === 'MAKER_V8_WALRUS_EXECUTION_INVALID') throw error;
    check(false, 'malformed evidence');
  }
}

export async function readMakerV8WalrusExecutionV1({ transport, minimumDependency }) {
  const minimum = structuredClone(minimumDependency);
  check(typeof transport?.getObject === 'function' && typeof transport?.getHistoricalObject === 'function', 'historical transport');
  const readSystem = async () => {
    const current = await transport.getObject({ id: MAKER_V8_WALRUS_SYSTEM_ID, options: { showBcs: true } });
    check(current?.data?.objectId === MAKER_V8_WALRUS_SYSTEM_ID && !current.error, 'current System');
    const ref = { objectId: current.data.objectId, version: uint(String(current.data.version)), digest: current.data.digest };
    const historical = await transport.getHistoricalObject({ objectId: ref.objectId, version: BigInt(ref.version) });
    check(historical.objectId === ref.objectId && historical.version === ref.version && historical.digest === ref.digest, 'current/historical System reference');
    return historical;
  };
  const system = await readSystem();
  const proof = value => ({ reference: { objectId: value.objectId, version: value.version, digest: value.digest }, objectBcsBase64: toBase64(value.objectBcs) });
  const provenSystem = fullObject(proof(system));
  check(provenSystem.data.$kind === 'Move', 'System Move contents');
  const systemFields = MakerV8WalrusSystemBcs.parse(provenSystem.data.Move.contents);
  const packageId = id(systemFields.package_id), packageVersion = uint(systemFields.version);
  const pkg = await transport.getHistoricalObject({ objectId: packageId, version: BigInt(packageVersion) });
  check(pkg.objectId === packageId && pkg.version === packageVersion, 'requested execution Package');
  const evidence = { schemaVersion: MAKER_V8_WALRUS_EXECUTION_SCHEMA, system: proof(system), package: proof(pkg) };
  const target = assertMakerV8WalrusExecutionV1(evidence, { minimumDependency: minimum });
  // Epoch/object-version advances are normal; an execution-package/schema or
  // shared-birth change during this read is not. Revalidate full bytes, not JSON.
  const latestSystem = await readSystem();
  check(BigInt(latestSystem.version) >= BigInt(system.version)
    && (latestSystem.version !== system.version || latestSystem.digest === system.digest), 'System reference regression/fork');
  evidence.system = proof(latestSystem);
  const currentTarget = assertMakerV8WalrusExecutionV1(evidence, { minimumDependency: minimum });
  check(JSON.stringify(target) === JSON.stringify(currentTarget), 'execution target changed during read');
  return freeze(structuredClone(evidence));
}
