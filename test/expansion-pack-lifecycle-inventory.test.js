import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyExpansionPackLifecycleRecovery,
  expansionPackLifecycleInventoryIdentity,
  mergeExpansionPackLifecycleInventory,
} from '../expansion-pack-lifecycle-inventory.js';

const local = (overrides = {}) => ({
  key: 'local:moon',
  identity: {
    walletAddress: '0x09',
    parentReleaseId: '0x02',
    parentVersion: '1',
    parentVersionId: 'parent-v1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestHash: 'aa'.repeat(32),
    packId: 'moon',
  },
  packId: 'moon',
  version: '1.0.0',
  namespace: 'maker.moon',
  project: {},
  ...overrides,
});

test('recovery overlay is independently usable by inventory discovery wiring', () => {
  const failed = applyExpansionPackLifecycleRecovery(chain(), {
    pending: [], finalizedFailures: [{ key: 'failure' }],
  });
  assert.equal(failed.state, 'finalized-failure');
  assert.deepEqual(failed.allowedActions, []);
});

const chain = (overrides = {}) => ({
  state: 'ACTIVE',
  lifecycle: 3,
  authorityReady: true,
  allowedActions: ['pause'],
  readbackVerified: true,
  release: {
    objectId: '0x03',
    creator: '0x9',
    parentRootId: '0x01',
    parentLegacyMakerId: '0x2',
    parentVersion: '1',
    parentVersionId: 'parent-v1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: 'aa'.repeat(32),
    packId: 'moon',
    packVersion: '1.0.0',
    namespace: 'maker.moon',
    ...overrides,
  },
});

test('fresh chain descriptor authoritatively replaces local draft status', () => {
  const result = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    chainDescriptors: [chain()],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'local:moon');
  assert.equal(result[0].lifecycle.state, 'ACTIVE');
  assert.equal(result[0].lifecycle.allowedActions[0], 'pause');
});

test('pending and exact finalized failure discovery suppress all signable actions', () => {
  const pendingResult = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    chainDescriptors: [{
      ...chain(),
      lifecycleRecovery: { pending: [{ key: 'pending' }], finalizedFailures: [] },
    }],
  });
  assert.equal(pendingResult[0].lifecycle.state, 'recoverable');
  assert.deepEqual(pendingResult[0].lifecycle.allowedActions, []);

  const failedResult = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    chainDescriptors: [{
      ...chain(),
      lifecycleRecovery: { pending: [], finalizedFailures: [{ key: 'failure' }] },
    }],
  });
  assert.equal(failedResult[0].lifecycle.state, 'finalized-failure');
  assert.deepEqual(failedResult[0].lifecycle.allowedActions, []);
});

test('unmatched admitted releases remain visible as chain-only entries', () => {
  const result = mergeExpansionPackLifecycleInventory({
    summaries: [],
    chainDescriptors: [chain()],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'chain:0x3');
  assert.equal(result[0].chainOnly, true);
  assert.equal(result[0].lifecycle.state, 'ACTIVE');
});

test('wallet, parent evidence, Pack version and namespace must all match', () => {
  for (const release of [
    { creator: '0xa' },
    { parentLegacyMakerId: '0x4' },
    { parentManifestSha256: 'bb'.repeat(32) },
    { packVersion: '2.0.0' },
    { namespace: 'maker.other' },
  ]) {
    const result = mergeExpansionPackLifecycleInventory({
      summaries: [local()],
      chainDescriptors: [chain(release)],
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].lifecycle.state, 'local-draft');
    assert.equal(result[1].chainOnly, true);
  }
});

test('ambiguous exact chain matches fail closed without consuming either Release', () => {
  const result = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    chainDescriptors: [chain(), chain({ objectId: '0x04' })],
  });
  assert.equal(result[0].lifecycle.state, 'unknown');
  assert.match(result[0].lifecycle.error, /more than one/i);
  assert.equal(result.filter((entry) => entry.chainOnly).length, 2);
});

test('publication checkpoint states are subordinate fallbacks and errors never become drafts', () => {
  const publishing = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    publicationByKey: new Map([['local:moon', { started: true, recoverable: false }]]),
  });
  assert.equal(publishing[0].lifecycle.state, 'publishing');
  const recoverable = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    publicationByKey: new Map([['local:moon', { checkpoint: {}, recoverable: true }]]),
  });
  assert.equal(recoverable[0].lifecycle.state, 'recoverable');
  const failed = mergeExpansionPackLifecycleInventory({
    summaries: [local()],
    publicationByKey: new Map([['local:moon', { error: new Error('IndexedDB unavailable') }]]),
  });
  assert.equal(failed[0].lifecycle.state, 'unknown');
  assert.match(failed[0].lifecycle.error, /indexeddb/i);
});

test('identity normalization preserves exact semantic tuple', () => {
  assert.deepEqual(
    expansionPackLifecycleInventoryIdentity(local()),
    {
      walletAddress: '0x9',
      parentReleaseId: '0x2',
      parentVersion: '1',
      parentVersionId: 'parent-v1',
      parentManifestBlobId: 'parent-quilt',
      parentManifestSha256: 'aa'.repeat(32),
      packId: 'moon',
      packVersion: '1.0.0',
      namespace: 'maker.moon',
    },
  );
});
