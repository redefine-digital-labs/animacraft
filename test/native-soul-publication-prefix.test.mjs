import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAINNET_V8_ROLE_ORDER, MAINNET_V8_PUBLISH_ORDER, MAINNET_V8_PUBLISH_PACKAGE_NAMES,
  renderMainnetV8PublishedToml, parseMainnetV8PublishedToml,
  buildMainnetV8AbiArtifact, assertMainnetV8AbiArtifact, mainnetV8AbiCommitment,
} from '../scripts/mainnet-v8-release-lib.mjs';
import { publishedPrefixSnapshot } from '../scripts/mainnet-v8-release.mjs';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS } from '../scripts/native-soul-external-publications.mjs';

const order = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'soulidity', 'release'];
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const root = '/tmp/native-publication-prefix-test';
const names = order.map(role => role === 'soulidity' ? role : `animacraft_v8_${role}`);
const entries = names.map((packageName, index) => ({
  packageName, source: `${root}/move/${packageName}`,
  publishedAt: id(index + 1), originalId: id(index + 1), version: '1',
  toolchainVersion: '1.80.1', buildConfig: { flavor: 'sui', edition: '2024' },
  upgradeCapability: id(index + 101),
}));
const externalEntries = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(pin => ({ packageName: pin.packageName,
  source: `/tmp/frozen-external-cache/${pin.rev}/${pin.subdir}`, publishedAt: pin.publishedAt,
  originalId: pin.originalId, version: pin.version }));
const prefix = (value, directory, count = 8) => publishedPrefixSnapshot(value, directory, count, externalEntries);
const file = length => ({ buildEnv: 'mainnet', chainId: '35834a8a', entries: structuredClone(entries.slice(0, length)),
  externalEntries: structuredClone(externalEntries) });
const wal = length => ({ executionPlanId: 'a'.repeat(64), events: order.slice(0, length).map((role, i) => ({
  ordinal: String(i), status: 'FINALIZED_SUCCESS', evidence: { observation: { details: { certificate: {
    readback: { role, package: { reference: { objectId: id(i + 1) } }, upgradeCap: { reference: { objectId: id(i + 101) } } },
  } } } },
})) });

test('eight publish packages do not add a Soulidity Catalog role or enable incomplete execution', () => {
  assert.deepEqual(MAINNET_V8_PUBLISH_ORDER, order);
  assert.deepEqual(order.map(role => MAINNET_V8_PUBLISH_PACKAGE_NAMES[role]), names);
  assert.deepEqual(MAINNET_V8_ROLE_ORDER, order.filter(role => role !== 'soulidity'));
});
for (let length = 0; length <= 8; length++) {
  test(`actual Published.toml serializer and runner retain exact prefix length ${length}`, () => {
    const value = file(length), text = renderMainnetV8PublishedToml(value);
    assert.deepEqual(parseMainnetV8PublishedToml(text), value);
    const snapshot = prefix(wal(length), root);
    assert.equal(snapshot.text, text);
    assert.deepEqual(snapshot.entries, value.entries);
    const relocated = prefix(wal(length), `${root}-relocated`);
    assert.equal(relocated.sha256, snapshot.sha256, 'durable prefix does not depend on temporary checkout root');
    if (length) assert.notEqual(relocated.rawSha256, snapshot.rawSha256);
  });
}
test('old seven-package prefix, swapped packages, extra entries and malformed paths reject', () => {
  const legacy = file(8); legacy.entries.splice(6, 1);
  assert.throws(() => renderMainnetV8PublishedToml(legacy));
  const swapped = file(8); [swapped.entries[6], swapped.entries[7]] = [swapped.entries[7], swapped.entries[6]];
  assert.throws(() => renderMainnetV8PublishedToml(swapped));
  const extra = file(8); extra.entries.push(entries[0]);
  assert.throws(() => renderMainnetV8PublishedToml(extra));
  const relative = file(8); relative.entries[6].source = 'move/soulidity';
  assert.throws(() => renderMainnetV8PublishedToml(relative));
  const corrupt = renderMainnetV8PublishedToml(file(8)).replace('/move/soulidity', '/move/unknown');
  assert.throws(() => parseMainnetV8PublishedToml(corrupt));
});
test('runner cannot silently omit Soulidity, accept reordered readbacks or skip a predecessor', () => {
  const swapped = wal(8); swapped.events[6].evidence.observation.details.certificate.readback.role = 'release';
  assert.throws(() => prefix(swapped, root), { code: 'MAINNET_V8_PUBLISHED_PREFIX_INVALID' });
  const missing = wal(8); missing.events.splice(6, 1);
  assert.throws(() => prefix(missing, root), { code: 'MAINNET_V8_PUBLISHED_PREFIX_INVALID' });
  const full = wal(8);
  full.events.push({ ordinal: '8', status: 'FINALIZED_SUCCESS' });
  assert.equal(prefix(full, root).entries.length, 8, 'bootstrap output is never a ninth package');
  assert.equal(prefix(full, root, 6).entries.length, 6, 'historical build only receives predecessors');
  assert.throws(() => prefix(full, root, 9));
});
test('Soulidity ABI passes the same normalization and content commitment as every published package', () => {
  const descriptor = { modules: [{ name: 'soul', datatypes: [], functions: [] }] };
  for (const role of order) {
    const artifact = buildMainnetV8AbiArtifact({ role, descriptor });
    assertMainnetV8AbiArtifact(artifact);
    assert.equal(artifact.role, role);
    assert.match(mainnetV8AbiCommitment(artifact), /^[0-9a-f]{64}$/);
  }
  assert.throws(() => buildMainnetV8AbiArtifact({ role: 'unknown', descriptor }));
  const artifact = structuredClone(buildMainnetV8AbiArtifact({ role: 'soulidity', descriptor }));
  artifact.modules[0].functions.push({ name: 'mint', sourceLocation: 'not-canonical' });
  assert.throws(() => assertMainnetV8AbiArtifact(artifact));
});
