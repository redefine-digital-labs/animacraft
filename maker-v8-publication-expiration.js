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

// Only a NOT_FOUND from a node that covered the full validity window can
// retire the original digest. Older persisted absence proofs remain readable.
export function makerV8AbsenceCoversEpochWindow(absence, startEpoch) {
  const proof = absence?.retention;
  const values = [startEpoch, absence?.watermarkCheckpointSequence, proof?.startEpoch,
    proof?.firstCheckpoint, proof?.lowestAvailableCheckpoint, proof?.observedCheckpoint];
  const canonical = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= 0xffff_ffff_ffff_ffffn;
  return values.every(canonical)
    && Object.keys(proof).length === 4
    && proof.startEpoch === startEpoch
    && BigInt(proof.lowestAvailableCheckpoint) <= BigInt(proof.firstCheckpoint)
    && BigInt(proof.firstCheckpoint) <= BigInt(absence.watermarkCheckpointSequence)
    && BigInt(absence.watermarkCheckpointSequence) <= BigInt(proof.observedCheckpoint);
}
