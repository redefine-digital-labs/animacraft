import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { assertMakerV8WalrusExecutionV1 as validate, readMakerV8WalrusExecutionV1 as read,
  MakerV8WalrusSystemBcs, MAKER_V8_WALRUS_MINIMUM_DEPENDENCY as minimumDependency } from '../maker-v8-walrus-execution.js';
import { makerV8WalrusExecutionFixture as fixture, walrusExecutionObjectFixture as proof } from './fixtures/walrus-execution-fixture.js';
const options = { minimumDependency };
const object = entry => bcs.Object.parse(fromBase64(entry.objectBcsBase64));
const rejects = operation => assert.throws(operation, { code: 'MAKER_V8_WALRUS_EXECUTION_INVALID' });

test('cold Walrus proof accepts old static minimum and separately binds effective v3 target', () => {
  const evidence = fixture();
  const target = validate(evidence, options);
  assert.equal(target.packageVersion, '3'); assert.equal(target.systemVersion, '3');
  assert.notEqual(target.packageId, minimumDependency.publishedAt);
  assert(Object.isFrozen(target.system));
  evidence.system.reference.version = '999';
  assert.equal(target.system.initialSharedVersion, '1');
  assert.equal(validate(fixture({ systemVersion: '2' }), options).packageId, minimumDependency.publishedAt);
});

for (const issue of ['digest', 'uid', 'owner', 'type', 'ref-version', 'package-owner', 'package-id', 'package-version',
  'origin', 'missing-origin', 'duplicate-origin', 'module-self', 'unsupported-version', 'trailing-bcs', 'system-shape', 'shared-birth']) {
  test(`cold Walrus proof rejects ${issue}, including rehashed full objects`, () => {
    const e = fixture(); const s = object(e.system), p = object(e.package);
    const fields = MakerV8WalrusSystemBcs.parse(s.data.Move.contents);
    if (issue === 'uid') fields.id = `0x${'42'.repeat(32)}`;
    if (issue === 'owner') s.owner = { AddressOwner: minimumDependency.publishedAt };
    if (issue === 'shared-birth') s.owner.Shared.initialSharedVersion = '3';
    if (issue === 'type') s.data.Move.type.Other.name = 'OtherSystem';
    if (issue === 'package-owner') p.owner = { ObjectOwner: minimumDependency.publishedAt };
    if (issue === 'package-id') p.data.Package.id = minimumDependency.publishedAt;
    if (issue === 'package-version') p.data.Package.version = '2';
    if (issue === 'origin') p.data.Package.typeOriginTable[0].package = minimumDependency.publishedAt;
    if (issue === 'missing-origin') p.data.Package.typeOriginTable.pop();
    if (issue === 'duplicate-origin') p.data.Package.typeOriginTable.push(p.data.Package.typeOriginTable[0]);
    if (issue === 'module-self') p.data.Package.moduleMap.get('blob').fill(0, -33, -1);
    if (issue === 'unsupported-version') { fields.version = '4'; p.data.Package.version = '4'; }
    s.data.Move.contents = MakerV8WalrusSystemBcs.serialize(fields).toBytes();
    if (issue === 'system-shape') s.data.Move.contents = new Uint8Array([...s.data.Move.contents, 0]);
    e.package = proof(p);
    e.system = proof(s);
    if (issue === 'digest') e.package.reference.digest = e.system.reference.digest;
    if (issue === 'ref-version') e.system.reference.version = '77';
    if (issue === 'trailing-bcs') e.package.objectBcsBase64 = toBase64(new Uint8Array([...fromBase64(e.package.objectBcsBase64), 0]));
    rejects(() => validate(e, options));
  });
}

test('minimum identity and monotonic package version are mandatory', () => {
  for (const minimum of [undefined, { ...minimumDependency, version: '4' }, { ...minimumDependency, version: '03' },
    { ...minimumDependency, originalPackageId: minimumDependency.publishedAt },
    { ...minimumDependency, version: '3', publishedAt: minimumDependency.publishedAt }]) {
    rejects(() => validate(fixture(), { minimumDependency: minimum }));
  }
});

function sequenceTransport(first, last = first, { staleHistory = false, falseContent = false } = {}) {
  let currentRead = 0;
  const historical = row => ({ ...row.reference, objectBcs: fromBase64(row.objectBcsBase64),
    contentBcs: falseContent ? new Uint8Array([0]) : object(row).data.Move?.contents ?? null });
  return {
    async getObject() { return { data: structuredClone((++currentRead === 1 ? first : last).system.reference) }; },
    async getHistoricalObject({ objectId }) {
      if (objectId === first.system.reference.objectId) return historical(staleHistory || currentRead === 1 ? first.system : last.system);
      return historical(first.package);
    },
  };
}

test('reader accepts ordinary object-version growth and ignores unbound contentBcs', async () => {
  const first = fixture(), latest = fixture({ systemObjectVersion: '3' });
  const actual = await read({ transport: sequenceTransport(first, latest, { falseContent: true }), minimumDependency });
  assert.deepEqual(actual, latest);
});

for (const issue of ['stale-history', 'package-switch', 'schema-switch', 'shared-birth-switch', 'reference-regression']) {
  test(`reader rejects ${issue} during observation`, async () => {
    const first = fixture({ systemObjectVersion: '3' });
    const latest = fixture({ systemObjectVersion: '4',
      ...(issue === 'package-switch' ? { packageId: `0x${'42'.repeat(32)}` } : {}),
      ...(issue === 'schema-switch' ? { systemVersion: '2' } : {}),
      ...(issue === 'shared-birth-switch' ? { initialSharedVersion: '2' } : {}),
      ...(issue === 'reference-regression' ? { systemObjectVersion: '2' } : {}),
    });
    await assert.rejects(read({ transport: sequenceTransport(first, latest, { staleHistory: issue === 'stale-history' }), minimumDependency }),
      { code: 'MAKER_V8_WALRUS_EXECUTION_INVALID' });
  });
}

test('reader returns detached frozen historical evidence with no signature/broadcast path', async () => {
  const e = fixture(); const calls = [];
  const transport = {
    async getObject(q) { calls.push(q); return { data: e.system.reference }; },
    async getHistoricalObject(q) {
      calls.push(q);
      const row = q.objectId === e.system.reference.objectId ? e.system : e.package;
      const parsed = object(row);
      return { ...row.reference, objectBcs: fromBase64(row.objectBcsBase64), contentBcs: parsed.data.Move?.contents ?? null };
    },
  };
  const result = await read({ transport, minimumDependency });
  assert.deepEqual(result, e); assert(Object.isFrozen(result.package.reference));
  assert.equal(calls.length, 5); assert.equal(calls[2].version, 3n);
});
