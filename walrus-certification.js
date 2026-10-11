import { toBase64 } from '@mysten/bcs';

export const WALRUS_CERTIFICATION_VISIBILITY_DELAYS_MS = Object.freeze([
  0,
  500,
  1_000,
  2_000,
  4_000,
]);

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function walrusCertificationError(code, message, cause = null) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizedBlobId(blobId) {
  const value = String(blobId || '');
  if (!/^\d+$/.test(value)) return value;
  let remaining = BigInt(value);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  if (remaining !== 0n) return value;
  return toBase64(bytes)
    .replace(/=*$/, '')
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

function assertBlobIdentity(blobObject, {
  blobObjectId,
  expectedBlobId,
}) {
  const actualObjectId = String(blobObject?.id || '');
  if (actualObjectId.toLowerCase() !== blobObjectId.toLowerCase()) {
    throw walrusCertificationError(
      'WALRUS_BLOB_OBJECT_MISMATCH',
      `Walrus returned Blob object ${actualObjectId || '(missing)'} while Animacraft was refreshing ${blobObjectId}.`,
    );
  }
  if (expectedBlobId && normalizedBlobId(blobObject?.blob_id) !== expectedBlobId) {
    throw walrusCertificationError(
      'WALRUS_BLOB_OBJECT_MISMATCH',
      `Walrus Blob object ${blobObjectId} belongs to ${String(blobObject?.blob_id || '(missing)')} instead of the uploaded Quilt ${expectedBlobId}.`,
    );
  }
}

/**
 * Read a Blob object after its certification transaction has already succeeded.
 *
 * WalrusClient caches Blob objects by object ID. Animacraft may have read the
 * same object before certification, so every attempt must clear that cache
 * before querying Sui again. This helper is read-only: it never builds, signs,
 * or broadcasts a transaction.
 */
export async function waitForCertifiedWalrusBlobObject(client, blobObjectId, {
  certifyDigest = '',
  expectedBlobId = '',
  delays = WALRUS_CERTIFICATION_VISIBILITY_DELAYS_MS,
  sleep = delay,
} = {}) {
  const objectId = String(blobObjectId || '').trim();
  if (!objectId) {
    throw new TypeError('A Walrus Blob object ID is required to refresh certification.');
  }
  if (
    typeof client?.walrus?.reset !== 'function'
    || typeof client?.walrus?.getBlobObject !== 'function'
  ) {
    throw new TypeError('The Walrus client must support reset() and getBlobObject().');
  }

  const attemptDelays = Array.isArray(delays) && delays.length > 0
    ? delays.map((value) => Math.max(0, Number(value) || 0))
    : WALRUS_CERTIFICATION_VISIBILITY_DELAYS_MS;
  let lastCause = null;

  for (const waitMs of attemptDelays) {
    if (waitMs > 0) await sleep(waitMs);
    try {
      await client.walrus.reset();
      const blobObject = await client.walrus.getBlobObject(objectId);
      assertBlobIdentity(blobObject, {
        blobObjectId: objectId,
        expectedBlobId: String(expectedBlobId || ''),
      });
      lastCause = null;
      if (blobObject.certified_epoch != null) return blobObject;
    } catch (error) {
      if (error?.code === 'WALRUS_BLOB_OBJECT_MISMATCH') throw error;
      lastCause = error;
    }
  }

  const digest = String(certifyDigest || '').trim();
  throw walrusCertificationError(
    'WALRUS_CERTIFICATION_NOT_VISIBLE',
    `Walrus certification ${digest || '(confirmed transaction)'} is confirmed, but Blob object ${objectId} is not visible as certified after ${attemptDelays.length} refreshed queries. No replacement transaction will be signed; retry only refreshes chain state.`,
    lastCause,
  );
}
