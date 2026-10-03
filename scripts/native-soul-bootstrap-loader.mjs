import { isDeepStrictEqual } from 'node:util';
import { NativeSoulBootstrapBcs, decodeNativeSoulBootstrapObject } from './native-soul-bootstrap-readback.mjs';
import { assertNativeSoulBootstrapGasEffects, decodeNativeSoulBootstrapEffectsSync } from './native-soul-bootstrap-effects.mjs';
import { decodeNativeSoulBootstrapHistoryObject, validateNativeSoulBootstrapHistory } from './native-soul-bootstrap-history.mjs';

// Scheduling/inventory only. The existing transaction builder, codecs,
// relationship/write-set and historical validators remain the authorities.
const PLANS = Object.freeze({
  INITIALIZE_PROTOCOL: { prior: ['protocol', 'protocolAdmin'], read: [], writes: 3, consensus: 0 },
  SETUP_RELEASE: { prior: ['protocol', 'protocolAdmin'], read: [], writes: 15, consensus: 1 },
  BEGIN_BOOTSTRAP: { prior: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot'],
    read: ['protocol', 'replacement'], writes: 4, consensus: 1 },
  FINALIZE_BOOTSTRAP: { prior: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot',
    'outputConfig', 'marketConfig', 'bootstrapAdmin'], read: ['protocol', 'protocolAdmin', 'replacement'], writes: 5, consensus: 1 },
});
const KINDS = Object.freeze(Object.keys(NativeSoulBootstrapBcs));
const CONCURRENCY = 4;
function check(value, label) {
  if (!value) { const error = new Error(`Invalid native bootstrap historical load: ${label}`);
    error.code = 'NATIVE_SOUL_BOOTSTRAP_LOADER_INVALID'; throw error; }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Exact predecessor projection for an already-certified journal. This is an
 * inventory helper, not certification of the supplied predecessor objects. */
export function nativeSoulBootstrapPriorKinds(stage) {
  check(typeof stage === 'string' && Object.hasOwn(PLANS, stage), 'unknown stage');
  return Object.freeze([...PLANS[stage].prior]);
}
function exactInventory(value, expected, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort()), label);
}
function classify(object, packageIds) {
  const matches = [];
  for (const kind of KINDS) {
    try { decodeNativeSoulBootstrapObject(kind, object, packageIds); matches.push(kind); }
    catch (error) { if (error?.code !== 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID') throw error; }
  }
  check(matches.length === 1, 'written object has unknown or ambiguous exact type/layout');
  return matches[0];
}

/** Load only effect-selected historical refs. The callback must perform a
 * versioned read; it receives {objectId, version:string, digest} and returns the
 * existing history envelope {reference,type,owner,previousTransaction,
 * objectBcsBase64}. It must not substitute a latest object. RPC deadlines belong
 * to the injected transport; this function neither signs nor broadcasts.
 *
 * priorObjects MUST come from certified predecessor journal entries. All caller
 * data is snapshotted before the first await. objects/priorObjects/
 * consensusObjects are JSON-safe journal evidence; history is the existing
 * verifier's derived result and can be discarded/recomputed by cold replay.
 * Neither this loader nor its derived history proves checkpoint finality.
 */
export async function certifyNativeSoulBootstrapHistory({ stage, input, sender,
  transactionBytes, effectsBytes, priorObjects, readHistoricalObject }) {
  check(typeof readHistoricalObject === 'function', 'exact historical reader callback required');
  check(Object.hasOwn(PLANS, stage), 'unknown stage');
  check(transactionBytes instanceof Uint8Array && effectsBytes instanceof Uint8Array, 'transaction/effects bytes required');
  const snapshot = structuredClone({ stage, input, sender, transactionBytes, effectsBytes, priorObjects });
  const plan = PLANS[stage];
  const effects = decodeNativeSoulBootstrapEffectsSync(snapshot);
  exactInventory(snapshot.priorObjects, plan.prior, 'exact certified predecessor inventory');
  const prior = Object.fromEntries(plan.prior.map(kind => [kind,
    decodeNativeSoulBootstrapHistoryObject(snapshot.priorObjects[kind], { kind, packageIds: snapshot.input.packageIds })]));
  check(new Set(Object.values(prior).map(row => row.reference.objectId)).size === plan.prior.length,
    'predecessor identity collision');
  // Bound RPC work before calling the reader. The authoritative write-set
  // validator below also checks exact kinds, operations, gas and deletion refs.
  check(effects.writes.length === plan.writes && effects.unchangedConsensusObjects.length === plan.consensus,
    'stage write/consensus count');
  check(effects.wrapped.length === 0, 'unsupported wrap');
  assertNativeSoulBootstrapGasEffects({ sender: snapshot.sender, effects });
  check(effects.deleted.length === (stage === 'FINALIZE_BOOTSTRAP' ? 1 : 0), 'stage deletion count');
  if (stage === 'FINALIZE_BOOTSTRAP') {
    check(isDeepStrictEqual(effects.deleted[0].before, { ...prior.bootstrapAdmin.reference, owner: prior.bootstrapAdmin.object.owner })
      && effects.deleted[0].objectId === snapshot.input.bootstrapAdmin.objectId, 'exact bootstrap admin deletion');
  }
  const requests = effects.writes.map(write => ({ kind: 'write', reference: {
    objectId: write.objectId, version: write.version, digest: write.digest,
  } }));
  for (const [objectId, state] of effects.unchangedConsensusObjects) {
    check(state.$kind === 'ReadOnlyRoot' && Array.isArray(state.ReadOnlyRoot) && state.ReadOnlyRoot.length === 2,
      'only exact read-only consensus roots supported');
    requests.push({ kind: 'consensus', reference: { objectId, version: state.ReadOnlyRoot[0], digest: state.ReadOnlyRoot[1] } });
  }
  check(new Set(requests.map(row => row.reference.objectId)).size === requests.length, 'duplicate requested identity');
  const results = new Array(requests.length);
  let next = 0, failed = false, failure;
  // All started requests are awaited on failure; no detached read can outlive
  // this loader's completion, and no further requests start after a rejection.
  const worker = async () => {
    while (!failed && next < requests.length) {
      const index = next++, request = requests[index];
      try {
        const evidence = structuredClone(await readHistoricalObject(freeze(structuredClone(request.reference))));
        const decoded = decodeNativeSoulBootstrapHistoryObject(evidence);
        check(isDeepStrictEqual(decoded.reference, request.reference), 'historical response differs from requested ID/version/digest');
        if (request.kind === 'write') check(decoded.previousTransaction === effects.transactionDigest,
          'written object is not from this exact transaction');
        results[index] = { evidence, kind: request.kind === 'write' ? classify(decoded.object, snapshot.input.packageIds) : null };
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, requests.length) }, worker));
  if (failed) throw failure;
  const objects = Object.fromEntries(plan.read.map(kind => [kind, snapshot.priorObjects[kind]]));
  const consensusObjects = {};
  for (const [index, request] of requests.entries()) {
    const row = results[index];
    if (request.kind === 'consensus') consensusObjects[request.reference.objectId] = row.evidence;
    else {
      check(!Object.hasOwn(objects, row.kind), 'duplicate written/read-only kind');
      objects[row.kind] = row.evidence;
    }
  }
  const history = validateNativeSoulBootstrapHistory({ ...snapshot, objects, consensusObjects });
  return freeze({ schema: 'native-soul-bootstrap-history-v1', stage, input: snapshot.input,
    objects, priorObjects: snapshot.priorObjects, consensusObjects, history });
}
