import { MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from './maker-v8-sui-grpc.js';

// Construct only before freezing transaction bytes. Recovery must replay those
// exact bytes, never refresh this nonce or extend an already signed envelope.
export function makerV8PublicationExpiration(epoch, crypto = globalThis.crypto) {
  if (typeof epoch !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(epoch)
    || BigInt(epoch) >= 0xffff_ffff_ffff_ffffn) {
    throw new Error('Publication epoch must be a canonical u64 with room for the next epoch.');
  }
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is required for publication expiration.');
  }
  const nonce = crypto.getRandomValues(new Uint32Array(1))[0];
  return { ValidDuring: {
    minEpoch: epoch,
    maxEpoch: (BigInt(epoch) + 1n).toString(),
    minTimestamp: null,
    maxTimestamp: null,
    chain: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
    nonce,
  } };
}
