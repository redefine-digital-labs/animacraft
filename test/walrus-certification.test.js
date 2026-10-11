import assert from 'node:assert/strict';
import test from 'node:test';

import {
  waitForCertifiedWalrusBlobObject,
  WALRUS_CERTIFICATION_VISIBILITY_DELAYS_MS,
} from '../walrus-certification.js';

const BLOB_OBJECT_ID = `0x${'a'.repeat(64)}`;
const BLOB_ID = 'test-quilt-blob-id';

function blobObject(certifiedEpoch = null, overrides = {}) {
  return {
    id: BLOB_OBJECT_ID,
    blob_id: BLOB_ID,
    certified_epoch: certifiedEpoch,
    ...overrides,
  };
}

test('clears the SDK object cache before reading a confirmed certification', async () => {
  let chainEpoch = null;
  let cached;
  let networkReads = 0;
  let resets = 0;
  const client = {
    walrus: {
      reset() {
        resets += 1;
        cached = undefined;
      },
      async getBlobObject() {
        if (cached === undefined) {
          networkReads += 1;
          cached = blobObject(chainEpoch);
        }
        return cached;
      },
    },
  };

  assert.equal((await client.walrus.getBlobObject(BLOB_OBJECT_ID)).certified_epoch, null);
  chainEpoch = 42;
  assert.equal((await client.walrus.getBlobObject(BLOB_OBJECT_ID)).certified_epoch, null);

  const result = await waitForCertifiedWalrusBlobObject(client, BLOB_OBJECT_ID, {
    certifyDigest: 'confirmed-digest',
    expectedBlobId: BLOB_ID,
    delays: [0],
  });

  assert.equal(result.certified_epoch, 42);
  assert.equal(resets, 1);
  assert.equal(networkReads, 2);
});

test('uses bounded read-only polling for genuine node visibility delay', async () => {
  const epochs = [null, null, 18];
  const events = [];
  const client = {
    walrus: {
      reset() {
        events.push('reset');
      },
      async getBlobObject() {
        events.push('get');
        return blobObject(epochs.shift());
      },
    },
  };

  const result = await waitForCertifiedWalrusBlobObject(client, BLOB_OBJECT_ID, {
    expectedBlobId: BLOB_ID,
    delays: [0, 25, 75],
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
    },
  });

  assert.equal(result.certified_epoch, 18);
  assert.deepEqual(events, [
    'reset',
    'get',
    'sleep:25',
    'reset',
    'get',
    'sleep:75',
    'reset',
    'get',
  ]);
});

test('retries a transient query failure without constructing another transaction', async () => {
  let reads = 0;
  const accessed = [];
  const walrus = new Proxy({
    reset() {
      accessed.push('reset');
    },
    async getBlobObject() {
      accessed.push('getBlobObject');
      reads += 1;
      if (reads === 1) throw new Error('temporary RPC unavailable');
      return blobObject(8);
    },
  }, {
    get(target, property, receiver) {
      accessed.push(`property:${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });

  const result = await waitForCertifiedWalrusBlobObject({ walrus }, BLOB_OBJECT_ID, {
    delays: [0, 0],
    sleep: async () => {},
  });

  assert.equal(result.certified_epoch, 8);
  assert.equal(accessed.some((entry) => /transaction|sign|execute/i.test(entry)), false);
});

test('exhaustion preserves a dedicated recoverable code and confirmed digest', async () => {
  let resets = 0;
  let reads = 0;
  const client = {
    walrus: {
      reset() {
        resets += 1;
      },
      async getBlobObject() {
        reads += 1;
        return blobObject(null);
      },
    },
  };

  await assert.rejects(
    waitForCertifiedWalrusBlobObject(client, BLOB_OBJECT_ID, {
      certifyDigest: 'confirmed-digest',
      expectedBlobId: BLOB_ID,
      delays: [0, 0, 0],
      sleep: async () => {},
    }),
    (error) => {
      assert.equal(error.code, 'WALRUS_CERTIFICATION_NOT_VISIBLE');
      assert.match(error.message, /confirmed-digest/);
      assert.match(error.message, /No replacement transaction will be signed/);
      assert.match(error.message, /retry only refreshes chain state/i);
      return true;
    },
  );
  assert.equal(resets, 3);
  assert.equal(reads, 3);
});

test('rejects a mismatched Blob identity instead of accepting unrelated data', async () => {
  const client = {
    walrus: {
      reset() {},
      async getBlobObject() {
        return blobObject(9, { blob_id: 'different-blob' });
      },
    },
  };

  await assert.rejects(
    waitForCertifiedWalrusBlobObject(client, BLOB_OBJECT_ID, {
      expectedBlobId: BLOB_ID,
      delays: [0],
    }),
    (error) => error.code === 'WALRUS_BLOB_OBJECT_MISMATCH',
  );
});

test('accepts the decimal u256 Blob ID returned by Sui for a URL-safe Walrus Blob ID', async () => {
  const client = {
    walrus: {
      reset() {},
      async getBlobObject() {
        return blobObject(9, { blob_id: '1' });
      },
    },
  };

  const result = await waitForCertifiedWalrusBlobObject(client, BLOB_OBJECT_ID, {
    expectedBlobId: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    delays: [0],
  });

  assert.equal(result.certified_epoch, 9);
});

test('the production visibility schedule is bounded', () => {
  assert.deepEqual(WALRUS_CERTIFICATION_VISIBILITY_DELAYS_MS, [0, 500, 1_000, 2_000, 4_000]);
  assert.equal(
    WALRUS_CERTIFICATION_VISIBILITY_DELAYS_MS.reduce((total, value) => total + value, 0),
    7_500,
  );
});
