import { bcs } from '@mysten/sui/bcs';
import { GrpcTypes } from '@mysten/sui/grpc';
import { fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils';
import { isDeepStrictEqual } from 'node:util';
import { normalizeMakerV8HistoricalObject } from '../maker-v8-sui-grpc.js';
import { decodeNativeSoulBootstrapObject } from './native-soul-bootstrap-readback.mjs';
import { decodeNativeSoulBootstrapEffectsSync } from './native-soul-bootstrap-effects.mjs';
import { validateNativeSoulBootstrapStageRelations } from './native-soul-bootstrap-relations.mjs';
import { validateNativeSoulBootstrapWriteSet } from './native-soul-bootstrap-write-set.mjs';
import { assertMakerV8WalrusExecutionV1 } from '../maker-v8-walrus-execution.js';
import { NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY } from './native-soul-external-publications.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const PRIOR = {
  INITIALIZE_PROTOCOL: ['protocol', 'protocolAdmin'],
  SETUP_RELEASE: ['protocol', 'protocolAdmin'],
  BEGIN_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot'],
  FINALIZE_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot',
    'outputConfig', 'marketConfig', 'bootstrapAdmin'],
};
function check(value, label) {
  if (!value) { const error = new Error(`Invalid native bootstrap history: ${label}`);
    error.code = 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID'; throw error; }
}
function exact(value, keys, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), label);
}
function decimal(value) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 20
    && BigInt(value) <= 18446744073709551615n, 'positive u64');
  return BigInt(value);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function grpcOwner(value) {
  switch (value?.kind) {
    case 'address': exact(value, ['kind', 'address'], 'address owner'); return GrpcTypes.Owner.create({ kind: 1, address: value.address });
    case 'object': exact(value, ['kind', 'objectId'], 'object owner'); return GrpcTypes.Owner.create({ kind: 2, address: value.objectId });
    case 'shared': exact(value, ['kind', 'initialSharedVersion'], 'shared owner'); return GrpcTypes.Owner.create({ kind: 3, version: decimal(value.initialSharedVersion) });
    case 'immutable': exact(value, ['kind'], 'immutable owner'); return GrpcTypes.Owner.create({ kind: 4 });
    default: check(false, 'owner kind');
  }
}

/** Reuses the production transport's full Object digest/BCS validation offline.
 * The SDK message is reconstructed from journal bytes, not treated as network
 * evidence. A valid object digest does not itself establish checkpoint finality.
 */
export function decodeNativeSoulBootstrapHistoryObject(evidence, { kind, packageIds } = {}) {
  exact(evidence, ['reference', 'type', 'owner', 'previousTransaction', 'objectBcsBase64'], 'history envelope');
  exact(evidence.reference, ['objectId', 'version', 'digest'], 'history reference');
  const version = decimal(evidence.reference.version);
  check(typeof evidence.type === 'string' && evidence.type.length <= 4096
    && normalizeStructTag(evidence.type) === evidence.type, 'canonical Move type');
  check(typeof evidence.objectBcsBase64 === 'string' && evidence.objectBcsBase64.length > 0
    && evidence.objectBcsBase64.length <= Math.ceil(MAX_BYTES / 3) * 4, 'object bytes bound');
  const wire = fromBase64(evidence.objectBcsBase64);
  check(wire.length <= MAX_BYTES && toBase64(wire) === evidence.objectBcsBase64, 'canonical object base64');
  const parsed = bcs.Object.parse(wire);
  check(parsed.data.$kind === 'Move', 'Move object required');
  const move = parsed.data.Move;
  const raw = GrpcTypes.Object.create({ ...evidence.reference, version,
    objectType: evidence.type, owner: grpcOwner(evidence.owner),
    previousTransaction: evidence.previousTransaction, storageRebate: BigInt(parsed.storageRebate),
    hasPublicTransfer: move.hasPublicTransfer,
    bcs: GrpcTypes.Bcs.create({ name: 'Object', value: wire }),
    contents: GrpcTypes.Bcs.create({ name: evidence.type, value: Uint8Array.from(move.contents) }),
  });
  const verified = normalizeMakerV8HistoricalObject(raw, { objectId: evidence.reference.objectId, version });
  const object = { objectId: verified.objectId, type: verified.type,
    owner: structuredClone(evidence.owner), bcsBase64: toBase64(verified.contentBcs) };
  const fields = kind === undefined ? null : decodeNativeSoulBootstrapObject(kind, object, packageIds);
  return freeze({ reference: { objectId: verified.objectId, version: verified.version, digest: verified.digest },
    previousTransaction: verified.previousTransaction, object, fields });
}

/** Synchronous cold-journal verification of an exact stage's historical data.
 * The caller must still verify transaction checkpoint/signature finality, source
 * artifacts and predecessor journal linkage. This function does not mark READY,
 * broadcast, choose gas, or trust current/latest RPC objects as historical ones.
 * priorObjects must be taken from certified predecessors, never freshly guessed.
 */
export function validateNativeSoulBootstrapHistory({ stage, input, sender,
  transactionBytes, effectsBytes, objects, priorObjects, consensusObjects }) {
  const effects = decodeNativeSoulBootstrapEffectsSync({ stage, input, sender, transactionBytes, effectsBytes });
  exact(priorObjects, PRIOR[stage], 'exact predecessor inventory');
  const prior = Object.fromEntries(Object.entries(priorObjects).map(([kind, evidence]) => [kind,
    decodeNativeSoulBootstrapHistoryObject(evidence, { kind, packageIds: input.packageIds })]));
  check(objects && Object.getPrototypeOf(objects) === Object.prototype, 'output inventory');
  const decoded = Object.fromEntries(Object.entries(objects).map(([kind, evidence]) => [kind,
    decodeNativeSoulBootstrapHistoryObject(evidence, { kind, packageIds: input.packageIds })]));
  const envelopes = Object.fromEntries(Object.entries(decoded).map(([kind, row]) => [kind, row.object]));
  validateNativeSoulBootstrapStageRelations({ stage, input, sender, objects: envelopes });
  const writes = validateNativeSoulBootstrapWriteSet({ stage, input, sender, effects, objects: envelopes });
  const previousById = new Map(Object.values(prior).map(row => [row.reference.objectId, row]));
  check(previousById.size === Object.keys(prior).length, 'predecessor identity collision');
  const matchBefore = change => {
    const previous = previousById.get(change.objectId);
    check(previous && isDeepStrictEqual(change.before, { ...previous.reference, owner: previous.object.owner }),
      'effects before differs from exact predecessor');
  };
  for (const [kind, row] of Object.entries(decoded)) {
    const write = writes.writesByKind[kind];
    if (write) {
      check(isDeepStrictEqual(row.reference, { objectId: write.objectId, version: write.version, digest: write.digest })
        && row.previousTransaction === effects.transactionDigest, 'historical write differs from effects');
      if (write.before) matchBefore(write);
    } else {
      check(prior[kind] && isDeepStrictEqual(row, prior[kind]), 'read-only object changed since predecessor');
    }
  }
  for (const deletion of Object.values(writes.deletedByKind)) matchBefore(deletion);
  const consensusIds = Object.keys(writes.readOnlyConsensusById);
  exact(consensusObjects, consensusIds, 'exact consensus history inventory');
  for (const objectId of consensusIds) {
    const historical = decodeNativeSoulBootstrapHistoryObject(consensusObjects[objectId]);
    const [version, digest] = writes.readOnlyConsensusById[objectId].ReadOnlyRoot;
    check(isDeepStrictEqual(historical.reference, { objectId, version, digest }), 'consensus history differs from effects');
    const reference = stage === 'SETUP_RELEASE' ? input.walrusSystem : input.protocolConfig;
    check(isDeepStrictEqual(historical.object.owner, { kind: 'shared', initialSharedVersion: reference.initialSharedVersion }),
      'consensus history owner');
    if (stage === 'SETUP_RELEASE') {
      // The exact consensus input consumed by the VM must still select the
      // effective package recorded in READY, not merely have the same System ID.
      const expected = assertMakerV8WalrusExecutionV1(input.walrusExecution,
        { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
      const preparedReference = input.walrusExecution.system.reference;
      check(BigInt(historical.reference.version) >= BigInt(preparedReference.version)
        && (historical.reference.version !== preparedReference.version
          || historical.reference.digest === preparedReference.digest), 'consensus Walrus history regressed or forked');
      const observed = assertMakerV8WalrusExecutionV1({ ...input.walrusExecution,
        system: { reference: historical.reference,
          objectBcsBase64: consensusObjects[objectId].objectBcsBase64 } },
      { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
      check(isDeepStrictEqual(observed, expected), 'consensus Walrus execution target differs from READY');
    }
    if (previousById.has(objectId)) check(isDeepStrictEqual(historical.reference, previousById.get(objectId).reference)
      && isDeepStrictEqual(historical.object, previousById.get(objectId).object), 'consensus predecessor drift');
  }
  // Immutable replacement references are not recorded in unchangedConsensusObjects.
  if (input.replacement) check(isDeepStrictEqual(prior.replacement.reference, input.replacement), 'exact immutable input');
  check(isDeepStrictEqual(prior.protocolAdmin.reference, input.protocolAdminCap), 'exact protocol admin input/readback');
  return freeze({ effects, writes, objects: decoded });
}
