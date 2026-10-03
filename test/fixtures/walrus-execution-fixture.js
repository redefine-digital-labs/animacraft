import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { fromHex, toHex, toBase58, toBase64 } from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID as ORIGINAL, MAKER_V8_WALRUS_SYSTEM_ID as SYSTEM,
  MAKER_V8_WALRUS_EXECUTION_SCHEMA, MakerV8WalrusSystemBcs } from '../../maker-v8-walrus-execution.js';

export const WALRUS_MINIMUM_DEPENDENCY_FIXTURE = Object.freeze({ originalPackageId: ORIGINAL,
  publishedAt: '0xfa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e', version: '2' });
export const WALRUS_V3_PACKAGE_FIXTURE = '0x98da433aa0139512c210597b1c5e3df6cd121d8d77f8652691bb66fadfc8aa1b';
// Synthetic module identity tables only. These fixtures establish cold evidence
// parsing, not a verified executable package or real Mainnet authorization.
export function moveModuleIdentityBytesFixture(name, originalId = ORIGINAL) {
  const names = new TextEncoder().encode(name);
  return Uint8Array.from([0xa1,0x1c,0xeb,0x0b,6,0,0,0,3,
    1,0,2,7,2,names.length+1,8,names.length+3,32,
    0,0,names.length,...names,...fromHex(originalId),0]);
}
export function walrusExecutionObjectFixture(object) {
  const bytes = bcs.Object.serialize(object).toBytes();
  const domain = new TextEncoder().encode('Object::');
  const typed = new Uint8Array(domain.length + bytes.length); typed.set(domain); typed.set(bytes, domain.length);
  const contents = object.data.Move;
  return { reference: { objectId: contents ? `0x${toHex(contents.contents.slice(0,32))}` : object.data.Package.id,
    version: contents ? String(contents.version) : String(object.data.Package.version),
    digest: toBase58(blake2b(typed, { dkLen: 32 })) }, objectBcsBase64: toBase64(bytes) };
}
export function makerV8WalrusExecutionFixture({ systemVersion = '3', systemObjectVersion = '2', initialSharedVersion = '1',
  packageId = systemVersion === '2' ? WALRUS_MINIMUM_DEPENDENCY_FIXTURE.publishedAt : WALRUS_V3_PACKAGE_FIXTURE } = {}) {
  const systemFields = { id: SYSTEM, version: systemVersion, package_id: packageId, new_package_id: null };
  const metadata = { previousTransaction: toBase58(new Uint8Array(32).fill(9)), storageRebate: '0' };
  const systemObject = { data: { Move: {
    type: { Other: TypeTagSerializer.parseFromStr(`${ORIGINAL}::system::System`, true).struct },
    version: systemObjectVersion, hasPublicTransfer: false, contents: MakerV8WalrusSystemBcs.serialize(systemFields).toBytes(),
  } }, owner: { Shared: { initialSharedVersion } }, ...metadata };
  const modules = [['blob','Blob'],['system','System'],['system_state_inner','SystemStateInnerV1']];
  const packageObject = { data: { Package: {
    id: packageId, version: systemVersion, moduleMap: new Map(modules.map(([name]) => [name, moveModuleIdentityBytesFixture(name)])),
    typeOriginTable: modules.map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, package: ORIGINAL })), linkageTable: new Map(),
  } }, owner: { Immutable: true }, ...metadata };
  return { schemaVersion: MAKER_V8_WALRUS_EXECUTION_SCHEMA,
    system: walrusExecutionObjectFixture(systemObject), package: walrusExecutionObjectFixture(packageObject) };
}
