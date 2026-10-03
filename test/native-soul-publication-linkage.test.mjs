import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { GrpcTypes } from '@mysten/sui/grpc';
import { toBase58 } from '@mysten/sui/utils';
import { readMainnetV8PackageCertificate } from '../scripts/mainnet-v8-release.mjs';
import { assertMainnetV8PackageDependencyLinkage, assertMainnetV8PackageReadbackBcs,
  readMainnetV8MoveModuleIdentity, mainnetV8TypedDigest } from '../scripts/mainnet-v8-release-lib.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const transactionDigest = toBase58(new Uint8Array(32).fill(7));
const OLD_TRANSACTION = toBase58(new Uint8Array(32).fill(8));
const KIOSK_ORIGINAL = '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879';
const KIOSK_TARGET = '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3';
// Exact kiosk_lock_rule.mv from the existing pinned Kiosk dependency's local
// production compilation. Real Move bytecode, not a guessed datatype origin.
// Object envelopes below are synthetic offline evidence, not a mainnet read.
const KIOSK_MODULE = Buffer.from('oRzrCwcAAAUKAQAIAggiAyorBFUGBVtXB7IBtgEI6AJABqgDCgqyAwoMvANOAA8BDgEQARIAAwIAAAAGAAECDAACAQcAAwQMAQABAwUMAQABAwYAAQABAAcAAQEAABECAQEAAQsJCgABDAkKAAMIDAECAAIDCQQBAwACBgMNBwgBAAUDBgYECwIHCwQBCQAGCwUBCQAAAgcLBgEJAAYIAgMJAAgACAEECQEHCwQBCQAGCwUBCQAJAgIBCAMBCQABBgsGAQkAAQgDAgYIAggDAQECCQAIAAIJAQcLBgEJAAZDb25maWcCSUQFS2lvc2sEUnVsZQ5UcmFuc2ZlclBvbGljeRFUcmFuc2ZlclBvbGljeUNhcA9UcmFuc2ZlclJlcXVlc3QDYWRkC2FkZF9yZWNlaXB0CGFkZF9ydWxlC2R1bW15X2ZpZWxkCGhhc19pdGVtCWlzX2xvY2tlZARpdGVtBWtpb3NrD2tpb3NrX2xvY2tfcnVsZQZvYmplY3QFcHJvdmUPdHJhbnNmZXJfcG9saWN5Q0tb2PansF/t4P9GxuUR1x6jJu04BW47zWgdLXwqeHkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgMIAAAAAAAAAAAAAgEKAQECAQoBAAEAAAEICRIACwALAQkSATgAAgABAQAABR0KAC44AQwDCgEKAxECBA0LAQsDEQMMAgURCwEBCQwCCwIEFAUYCwABBwAnCRIACwA4AgIAAA==', 'base64');

// A minimal table-encoded module with a real self handle and identifier table.
function moduleBytes(address, name = 'sample') {
  const names = Buffer.concat([Buffer.from([name.length]), Buffer.from(name)]);
  return Buffer.concat([Buffer.from([0xa1, 0x1c, 0xeb, 0x0b, 6, 0, 0, 0, 3,
    1, 0, 2, 7, 2, names.length, 8, 2 + names.length, 32, 0, 0]), names,
  Buffer.from(address.slice(2), 'hex'), Buffer.from([0])]);
}
function objectEvidence({ target, version = '1', modules = new Map([['sample', moduleBytes(target)]]),
  links = [], previousTransaction = OLD_TRANSACTION, owner = { Immutable: true }, typeOrigins = [] }) {
  const value = { data: { Package: { id: target, version, moduleMap: modules,
    typeOriginTable: typeOrigins, linkageTable: new Map(links.map(row => [row.originalId,
      { upgradedId: row.upgradedId, upgradedVersion: row.upgradedVersion }])) } },
  owner, previousTransaction, storageRebate: '0' };
  return encodeObject(value);
}
function encodeObject(value) {
  const bytes = bcs.Object.serialize(value).toBytes();
  const pkg = value.data.Package;
  return { reference: { objectId: pkg.id, version: String(pkg.version), digest: mainnetV8TypedDigest('Object', bytes) },
    objectBcsBase64: Buffer.from(bytes).toString('base64') };
}
function mutateObject(evidence, change) {
  const object = bcs.Object.parse(Buffer.from(evidence.objectBcsBase64, 'base64'));
  change(object); return encodeObject(object);
}
function fixture({ upgraded = true, system = false, dependency } = {}) {
  const target = system ? id(2) : upgraded ? KIOSK_TARGET : KIOSK_ORIGINAL;
  const dep = dependency ?? objectEvidence({ target, version: system ? '70' : upgraded ? '3' : '1',
    modules: system ? new Map([['sample', moduleBytes(id(2))]]) : new Map([['kiosk_lock_rule', KIOSK_MODULE]]) });
  const linkage = [{ originalId: system ? id(2) : KIOSK_ORIGINAL, upgradedId: target, upgradedVersion: dep.reference.version }];
  const source = moduleBytes(id(0)), published = moduleBytes(id(90));
  const current = objectEvidence({ target: id(90), modules: new Map([['sample', published]]), links: linkage, previousTransaction: transactionDigest });
  const reference = { operation: 'CREATED', ...current.reference, owner: { kind: 'Immutable' } };
  const descriptor = GrpcTypes.Package.fromJson({ storageId: id(90), originalId: id(90), version: '1', modules: [{ name: 'sample', datatypes: [], functions: [] }] });
  const reads = [];
  const histories = new Map([[id(90), current], [target, dep]]);
  const transport = {
    async getHistoricalObject(request) {
      reads.push(structuredClone(request));
      const item = histories.get(request.objectId); assert.ok(item, 'No guessed package target');
      return { ...item.reference, type: 'package', owner: { Immutable: true },
        previousTransaction: bcs.Object.parse(Buffer.from(item.objectBcsBase64, 'base64')).previousTransaction,
        objectBcs: Buffer.from(item.objectBcsBase64, 'base64') };
    },
    async getObject({ id: objectId }) {
      assert.equal(objectId, id(90), 'Dependency reads must never use latest');
      return { data: { version: '1', digest: current.reference.digest, previousTransaction: transactionDigest,
        bcs: { moduleMap: { sample: published.toString('base64') } } } };
    },
  };
  const client = { movePackageService: { getPackage({ packageId }) {
    assert.equal(packageId, id(90), 'Dependency descriptor is not historical authority');
    return { response: Promise.resolve({ package: descriptor }) };
  } } };
  const input = { client, transport, role: 'soulidity',
    build: { packageArtifact: { dependencies: [target] }, modules: [{ name: 'sample', base64: source.toString('base64') }] }, reference, transactionDigest };
  return { input, reads, histories, dep, current, linkage, target,
    frozenModules: [{ name: 'sample', bytesBase64: source.toString('base64') }] };
}

test('real pinned Kiosk module self address is original, not its upgraded storage ID or first datatype', () => {
  assert.deepEqual(readMainnetV8MoveModuleIdentity(KIOSK_MODULE), { originalId: KIOSK_ORIGINAL, moduleName: 'kiosk_lock_rule' });
  assert.notEqual(KIOSK_ORIGINAL, KIOSK_TARGET);
});
for (const upgraded of [true, false]) test(`actual publication certificate and cold replay accept ${upgraded ? 'upgraded' : 'fresh'} Kiosk`, async () => {
  const f = fixture({ upgraded }), result = await readMainnetV8PackageCertificate(f.input);
  assert.deepEqual(result.linkage, f.linkage);
  assert.deepEqual(result.dependencyPackages, [f.dep]);
  assert.equal(result.objectBcsBase64, f.current.objectBcsBase64);
  assert.deepEqual(f.reads, [{ objectId: id(90), version: 1n }, { objectId: f.target, version: BigInt(f.dep.reference.version) }]);
  const cold = JSON.parse(JSON.stringify(result));
  assert.doesNotThrow(() => assertMainnetV8PackageReadbackBcs(cold, [f.target], f.frozenModules));
});
test('same-ID system package uses exact historical version, never a current descriptor', async () => {
  const f = fixture({ system: true }), result = await readMainnetV8PackageCertificate(f.input);
  assert.deepEqual(f.reads, [{ objectId: id(90), version: 1n }, { objectId: id(2), version: 70n }]);
  // A current system descriptor could now be v71; neither reader nor cold
  // validator asks for it, and the precise historical v70 evidence remains valid.
  assert.doesNotThrow(() => assertMainnetV8PackageReadbackBcs(JSON.parse(JSON.stringify(result)), [id(2)], f.frozenModules));
});
for (const [name, change] of [
  ['original', f => { f.linkage[0].originalId = id(41); }],
  ['target', f => { f.linkage[0].upgradedId = id(41); }],
  ['version', f => { f.linkage[0].upgradedVersion = '4'; }],
  ['frozen original used instead of target', f => { f.dependencies = [KIOSK_ORIGINAL]; }],
  ['missing evidence', f => { f.dependencyPackages = []; }],
  ['duplicate target', f => { f.dependencies.push(f.target); }],
  ['extra evidence', f => { f.dependencyPackages.push(f.dep); }],
  ['wrong digest', f => { f.dep.reference.digest = transactionDigest; }],
  ['wrong ref version', f => { f.dep.reference.version = '4'; }],
  ['wrong ref target', f => { f.dep.reference.objectId = id(55); }],
  ['trailing BCS', f => { f.dep.objectBcsBase64 = Buffer.concat([Buffer.from(f.dep.objectBcsBase64, 'base64'), Buffer.from([0])]).toString('base64'); }],
  ['missing BCS', f => { delete f.dep.objectBcsBase64; }],
  ['unknown descriptor evidence', f => { f.dep.latestDescriptor = {}; }],
]) test(`cold dependency rejects ${name}`, () => {
  const f = fixture(); f.dependencies = [f.target]; f.dependencyPackages = [f.dep]; change(f);
  assert.throws(() => assertMainnetV8PackageDependencyLinkage(f));
});
for (const [name, change] of [
  ['nonimmutable owner', object => { object.owner = { AddressOwner: id(5) }; }],
  ['changed module original even after digest rehash', object => { object.data.Package.moduleMap = new Map([['sample', moduleBytes(id(55))]]); }],
  ['wrong module name', object => { object.data.Package.moduleMap = new Map([['wrong', KIOSK_MODULE]]); }],
  ['malformed module self handle', object => { const bytes = Buffer.from(KIOSK_MODULE); bytes[bytes.length - 1] = 127; object.data.Package.moduleMap = new Map([['kiosk_lock_rule', bytes]]); }],
  ['mixed package origins', object => { object.data.Package.moduleMap.set('sample', moduleBytes(id(55))); }],
]) test(`fully rehashed dependency Object rejects ${name}`, () => {
  const f = fixture(), changed = mutateObject(f.dep, change);
  assert.throws(() => assertMainnetV8PackageDependencyLinkage({ dependencies: [f.target], linkage: f.linkage, dependencyPackages: [changed] }));
});
test('duplicate original families cannot substitute two exact targets', () => {
  const f = fixture(), second = objectEvidence({ target: id(91), version: '4', modules: new Map([['kiosk_lock_rule', KIOSK_MODULE]]) });
  const packages = [f.dep, second].sort((a, b) => a.reference.objectId.localeCompare(b.reference.objectId));
  assert.throws(() => assertMainnetV8PackageDependencyLinkage({ dependencies: packages.map(p => p.reference.objectId),
    linkage: [f.linkage[0], { originalId: KIOSK_ORIGINAL, upgradedId: id(91), upgradedVersion: '4' }], dependencyPackages: packages }));
});
for (const [name, change] of [
  ['altered linkage JSON', result => { result.linkage[0].originalId = id(77); }],
  ['altered typeOrigins JSON', result => { result.typeOrigins.push({ moduleName: 'sample', datatypeName: 'Fake', package: id(90) }); }],
  ['altered own digest', result => { result.reference.digest = transactionDigest; }],
  ['altered own BCS hash', result => { result.objectBcsSha256 = '0'.repeat(64); }],
  ['altered descriptor version', result => { result.descriptor.version = '2'; }],
  ['altered descriptor original', result => { result.descriptor.originalId = id(91); }],
  ['altered descriptor target', result => { result.descriptor.storageId = id(91); }],
  ['altered previous transaction', result => { result.transactionDigest = OLD_TRANSACTION; }],
  ['only SHA but no bytes', result => { delete result.objectBcsBase64; }],
]) test(`cold full publication rejects ${name}`, async () => {
  const f = fixture(), result = JSON.parse(JSON.stringify(await readMainnetV8PackageCertificate(f.input)));
  change(result); assert.throws(() => assertMainnetV8PackageReadbackBcs(result, [f.target], f.frozenModules));
});
test('real runner rejects historical version mismatch and cannot accept a different frozen dependency', async () => {
  const f = fixture(); f.dep.reference.version = '4';
  await assert.rejects(readMainnetV8PackageCertificate(f.input));
  const other = fixture(); other.input.build.packageArtifact.dependencies = [KIOSK_ORIGINAL];
  await assert.rejects(readMainnetV8PackageCertificate(other.input));
  assert.equal(other.reads.length, 1, 'No undeclared dependency read');
});
test('cold WAL publication verifier consumes full BCS and the same exact dependency validator', () => {
  const source = readFileSync(new URL('../scripts/mainnet-v8-release-lib.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function assertPackagePublishCertificate('), source.indexOf('function canonicalBcsJson('));
  assert.match(body, /assertMainnetV8PackageReadbackBcs\(packageCertificate, details\.packageArtifact\.dependencies, details\.packageArtifact\.modules\)/);
  // The mandatory shared call above now executes the byte/set loop directly in
  // the dynamic cases below; this assertion only pins the WAL call-site wiring.
});
test('minimal module identity handles nonzero self index and rejects malformed canonical integers', () => {
  assert.deepEqual(readMainnetV8MoveModuleIdentity(moduleBytes(id(9))), { originalId: id(9), moduleName: 'sample' });
  const names = Buffer.from([7, ...Buffer.from('foreign'), 6, ...Buffer.from('sample')]);
  const nonzeroSelf = Buffer.concat([Buffer.from([0xa1, 0x1c, 0xeb, 0x0b, 6, 0, 0, 0, 3,
    1, 0, 4, 7, 4, names.length, 8, 4 + names.length, 64, 0, 0, 1, 1]), names,
  Buffer.from(id(44).slice(2), 'hex'), Buffer.from(id(9).slice(2), 'hex'), Buffer.from([1])]);
  assert.deepEqual(readMainnetV8MoveModuleIdentity(nonzeroSelf), { originalId: id(9), moduleName: 'sample' });
  for (const input of [new Uint8Array(), Buffer.concat([moduleBytes(id(9)), Buffer.from([0])]),
    Buffer.from([0xa1, 0x1c, 0xeb, 0x0b, 6, 0, 0, 0, 0x83, 0])]) {
    assert.throws(() => readMainnetV8MoveModuleIdentity(input));
  }
  assert.equal(sha(KIOSK_MODULE).length, 64);
});

test('captured mainnet Kiosk v4 full Object passes actual publication read and cold validation with BCS map ordering', async () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/mainnet-kiosk-package-v4.json', import.meta.url), 'utf8'));
  assert.equal(captured.reference.objectId, KIOSK_TARGET);
  assert.equal(captured.reference.version, '4');
  assert.equal(captured.reference.digest, '61izUpJMF8NqqtP1tS3iJtWddp3CjRVMigqRCfoKbaMW');
  const pkg = bcs.Object.parse(Buffer.from(captured.objectBcsBase64, 'base64')).data.Package;
  assert.deepEqual([...pkg.moduleMap.keys()], ['royalty_rule', 'witness_rule', 'personal_kiosk',
    'kiosk_lock_rule', 'floor_price_rule', 'personal_kiosk_rule']);
  for (const [name, bytes] of pkg.moduleMap) assert.deepEqual(readMainnetV8MoveModuleIdentity(bytes), {
    originalId: KIOSK_ORIGINAL, moduleName: name,
  });
  assert.doesNotThrow(() => assertMainnetV8PackageDependencyLinkage({ dependencies: [KIOSK_TARGET],
    linkage: [{ originalId: KIOSK_ORIGINAL, upgradedId: KIOSK_TARGET, upgradedVersion: '4' }],
    dependencyPackages: [{ reference: captured.reference, objectBcsBase64: captured.objectBcsBase64 }] }));
  const f = fixture({ dependency: { reference: captured.reference, objectBcsBase64: captured.objectBcsBase64 } });
  const certificate = await readMainnetV8PackageCertificate(f.input);
  assert.deepEqual(f.reads.at(-1), { objectId: KIOSK_TARGET, version: 4n });
  assert.doesNotThrow(() => assertMainnetV8PackageReadbackBcs(JSON.parse(JSON.stringify(certificate)), [KIOSK_TARGET], f.frozenModules));
});
test('BCS length-prefix ordering accepts valid map and rejects altered wire order after digest recomputation', () => {
  const evidence = objectEvidence({ target: id(44), modules: new Map([
    ['aa', moduleBytes(id(44), 'aa')], ['b', moduleBytes(id(44), 'b')],
  ]) });
  const input = { dependencies: [id(44)], linkage: [{ originalId: id(44), upgradedId: id(44), upgradedVersion: '1' }], dependencyPackages: [evidence] };
  assert.doesNotThrow(() => assertMainnetV8PackageDependencyLinkage(input));
  const row = bcs.tuple([bcs.string(), bcs.byteVector()]);
  const first = Buffer.from(row.serialize(['b', moduleBytes(id(44), 'b')]).toBytes());
  const second = Buffer.from(row.serialize(['aa', moduleBytes(id(44), 'aa')]).toBytes());
  const wire = Buffer.from(evidence.objectBcsBase64, 'base64'), start = wire.indexOf(first);
  assert.ok(start > 0); assert.ok(wire.subarray(start + first.length, start + first.length + second.length).equals(second));
  const bad = Buffer.concat([wire.subarray(0, start), second, first, wire.subarray(start + first.length + second.length)]);
  input.dependencyPackages = [{ reference: { ...evidence.reference, digest: mainnetV8TypedDigest('Object', bad) }, objectBcsBase64: bad.toString('base64') }];
  assert.throws(() => assertMainnetV8PackageDependencyLinkage(input));
});
for (const kind of ['body', 'extra-module', 'renamed-module']) test(`cold mandatory frozen module verification rejects rehashed ${kind}`, async () => {
  const f = fixture(), result = JSON.parse(JSON.stringify(await readMainnetV8PackageCertificate(f.input)));
  const changed = mutateObject(f.current, object => {
    if (kind === 'body') { const bytes = Buffer.from(object.data.Package.moduleMap.get('sample')); bytes[0] ^= 1; object.data.Package.moduleMap.set('sample', bytes); }
    else if (kind === 'extra-module') object.data.Package.moduleMap.set('other', moduleBytes(id(90), 'other'));
    else { object.data.Package.moduleMap = new Map([['renamed', moduleBytes(id(90), 'renamed')]]); }
  });
  result.objectBcsBase64 = changed.objectBcsBase64;
  result.objectBcsSha256 = sha(Buffer.from(changed.objectBcsBase64, 'base64'));
  result.reference.digest = changed.reference.digest;
  assert.throws(() => assertMainnetV8PackageReadbackBcs(result, [f.target], f.frozenModules));
});
test('cold module evidence is required and cannot be omitted or duplicated', async () => {
  const f = fixture(), result = JSON.parse(JSON.stringify(await readMainnetV8PackageCertificate(f.input)));
  for (const modules of [undefined, [], [...f.frozenModules, ...f.frozenModules]]) {
    assert.throws(() => assertMainnetV8PackageReadbackBcs(result, [f.target], modules));
  }
});
