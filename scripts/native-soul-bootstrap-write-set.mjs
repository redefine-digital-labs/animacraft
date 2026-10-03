import { fromBase58, toBase58 } from '@mysten/sui/utils';
import { isDeepStrictEqual } from 'node:util';
import { buildNativeSoulBootstrapTransaction } from './native-soul-bootstrap-transactions.mjs';
import { decodeNativeSoulBootstrapObject } from './native-soul-bootstrap-readback.mjs';
import { assertNativeSoulBootstrapGasEffects } from './native-soul-bootstrap-effects.mjs';

const PLANS = {
  INITIALIZE_PROTOCOL: { created: ['protocolTreasury'], mutated: ['protocol', 'protocolAdmin'], read: [] },
  SETUP_RELEASE: { created: ['catalog', 'sealConfig', 'runtimeConfig', 'outputConfig', 'physicalConfig',
    'marketConfig', 'releaseConfig', 'replacement', 'bootstrapSlot', 'walrusPolicy', 'walrusPolicySlot',
    'nativeSoulBinding', 'protocolCatalogSlot'], mutated: ['protocol', 'protocolAdmin'], read: [] },
  BEGIN_BOOTSTRAP: { created: ['bootstrapAdmin'], mutated: ['protocolAdmin', 'catalog', 'bootstrapSlot'],
    read: ['protocol', 'replacement'] },
  FINALIZE_BOOTSTRAP: { created: ['bootstrapCertificate'], mutated: ['catalog', 'outputConfig', 'marketConfig',
    'bootstrapSlot'], read: ['protocol', 'protocolAdmin', 'replacement'] },
};
const INPUT_KEYS = { protocol: 'protocolConfig', protocolAdmin: 'protocolAdminCap', catalog: 'catalog',
  outputConfig: 'outputConfig', marketConfig: 'marketConfig', replacement: 'replacement' };
function check(value, label) {
  if (!value) { const error = new Error(`Invalid native bootstrap write set: ${label}`);
    error.code = 'NATIVE_SOUL_BOOTSTRAP_WRITE_SET_INVALID'; throw error; }
}
function id(value) {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'object ID');
  return value;
}
function version(value) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 20
    && BigInt(value) <= 18446744073709551615n, 'object version');
  return BigInt(value);
}
function digest(value) {
  let bytes;
  try { bytes = fromBase58(value); } catch { check(false, 'object digest'); }
  check(bytes.length === 32 && toBase58(bytes) === value, 'object digest');
}
function exactKeys(value, keys, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), label);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Exact business effects for the four current bootstrap PTBs. Requires output
 * from decodeNativeSoulBootstrapEffects (which binds bytes, sender and gas).
 * This does NOT prove checkpoint finality, historical object digests or content
 * relationships. Shared inputs contain only initialSharedVersion: their precise
 * historical before version/digest must additionally be verified by the loader.
 */
export function validateNativeSoulBootstrapWriteSet({ stage, input, sender, effects, objects }) {
  buildNativeSoulBootstrapTransaction(stage, input);
  id(sender);
  const plan = PLANS[stage];
  const kinds = [...plan.created, ...plan.mutated, ...plan.read];
  exactKeys(objects, kinds, 'exact object inventory');
  const decoded = Object.fromEntries(kinds.map(kind => [kind,
    decodeNativeSoulBootstrapObject(kind, objects[kind], input.packageIds)]));
  check(new Set(kinds.map(kind => decoded[kind].id)).size === kinds.length, 'object identity collision');
  const inputIds = new Set([...Object.values(input.packageIds), ...Object.values(input)
    .filter(value => value && typeof value === 'object' && 'objectId' in value).map(value => value.objectId)]);
  for (const kind of plan.created) check(!inputIds.has(decoded[kind].id), 'created object aliases existing input/package');
  for (const kind of kinds) {
    const ref = input[INPUT_KEYS[kind]];
    if (ref) {
      check(decoded[kind].id === ref.objectId, `${kind} exact input identity`);
      if ('initialSharedVersion' in ref) check(objects[kind].owner.initialSharedVersion === ref.initialSharedVersion,
        `${kind} initial shared version`);
    }
    if (['protocolAdmin', 'bootstrapAdmin'].includes(kind)) check(objects[kind].owner.address === sender, `${kind} owner`);
  }
  // Only object-owned fields under the exact current parent are business writes.
  for (const kind of ['bootstrapSlot', 'walrusPolicySlot', 'nativeSoulBinding', 'protocolCatalogSlot']) {
    if (!objects[kind]) continue;
    const parent = ['nativeSoulBinding', 'protocolCatalogSlot'].includes(kind) ? decoded.protocol.id : decoded.catalog.id;
    check(objects[kind].owner.objectId === parent, `${kind} parent`);
  }
  check(effects && typeof effects === 'object', 'decoded effects');
  for (const key of ['writes', 'deleted', 'wrapped', 'accumulators', 'gas', 'unchangedConsensusObjects']) {
    check(Array.isArray(effects[key]), `${key} array`);
  }
  check(effects.wrapped.length === 0, 'unsupported wrap');
  assertNativeSoulBootstrapGasEffects({ sender, effects });
  const lamport = version(effects.lamportVersion);
  const writesByKind = {}, deletedByKind = {}, readOnlyConsensusById = {};
  check(effects.writes.length === plan.created.length + plan.mutated.length, 'write cardinality');
  const seen = new Set();
  const before = (row, owner, ref) => {
    exactKeys(row.before, ['objectId', 'version', 'digest', 'owner'], 'before reference');
    check(row.before.objectId === row.objectId && isDeepStrictEqual(row.before.owner, owner), 'before identity/owner');
    const prior = version(row.before.version); digest(row.before.digest);
    check(prior < lamport, 'before version must advance');
    if (owner.kind === 'shared') check(prior >= version(owner.initialSharedVersion), 'before shared birth');
    if (ref && 'version' in ref) check(row.before.version === ref.version && row.before.digest === ref.digest,
      'exact owned before reference');
  };
  for (const row of effects.writes) {
    exactKeys(row, ['operation', 'objectId', 'version', 'digest', 'owner', 'before'], 'write fields');
    id(row.objectId); check(!seen.has(row.objectId), 'duplicate write'); seen.add(row.objectId);
    const kind = kinds.find(k => decoded[k].id === row.objectId);
    check(kind && !plan.read.includes(kind), 'unexpected write');
    const created = plan.created.includes(kind);
    check(row.operation === (created ? 'CREATED' : 'MUTATED'), `${kind} operation`);
    check(version(row.version) === lamport, 'write Lamport version'); digest(row.digest);
    check(isDeepStrictEqual(row.owner, objects[kind].owner), `${kind} output owner`);
    if (created) {
      check(row.before === null, 'created object prior state');
      if (row.owner.kind === 'shared') check(row.owner.initialSharedVersion === row.version, 'shared creation version');
    } else before(row, objects[kind].owner, input[INPUT_KEYS[kind]]);
    writesByKind[kind] = row;
  }
  const final = stage === 'FINALIZE_BOOTSTRAP';
  check(effects.deleted.length === (final ? 1 : 0), 'deletion cardinality');
  if (final) {
    const row = effects.deleted[0]; exactKeys(row, ['objectId', 'before'], 'deletion fields');
    check(row.objectId === input.bootstrapAdmin.objectId && !seen.has(row.objectId), 'exact bootstrap admin deletion');
    before(row, { kind: 'address', address: sender }, input.bootstrapAdmin);
    deletedByKind.bootstrapAdmin = row; seen.add(row.objectId);
  }
  // ReadOnlyRoot is the actual V2 effects variant for shared immutable inputs.
  // FINAL's protocolAdmin readback is not an input; immutable replacement is not
  // a consensus input either. Walrus dynamic children are not consensus roots.
  const consensus = stage === 'SETUP_RELEASE' ? [input.walrusSystem]
    : ['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'].includes(stage) ? [input.protocolConfig] : [];
  check(effects.unchangedConsensusObjects.length === consensus.length, 'consensus read cardinality');
  for (const pair of effects.unchangedConsensusObjects) {
    check(Array.isArray(pair) && pair.length === 2, 'consensus row');
    const [objectId, state] = pair, ref = consensus.find(r => r.objectId === objectId);
    check(ref && !readOnlyConsensusById[objectId] && !seen.has(objectId), 'exact consensus read');
    exactKeys(state, ['$kind', 'ReadOnlyRoot'], 'consensus variant');
    check(state.$kind === 'ReadOnlyRoot' && Array.isArray(state.ReadOnlyRoot) && state.ReadOnlyRoot.length === 2,
      'read-only consensus root');
    check(version(state.ReadOnlyRoot[0]) >= version(ref.initialSharedVersion)
      && version(state.ReadOnlyRoot[0]) < lamport, 'consensus version'); digest(state.ReadOnlyRoot[1]);
    readOnlyConsensusById[objectId] = state;
  }
  const reserved = new Set([...kinds.map(kind => decoded[kind].id), ...Object.values(input)
    .filter(value => value && typeof value === 'object' && 'objectId' in value).map(value => value.objectId),
  ...Object.values(input.packageIds)]);
  const gasIds = new Set();
  for (const row of effects.gas) {
    id(row.objectId);
    check(!reserved.has(row.objectId) && !seen.has(row.objectId) && !gasIds.has(row.objectId), 'gas/business collision');
    gasIds.add(row.objectId);
  }
  for (const row of effects.accumulators) check(!reserved.has(row.objectId) && !seen.has(row.objectId)
    && !gasIds.has(row.objectId), 'gas accumulator/business collision');
  return freeze(structuredClone({ writesByKind, deletedByKind, readOnlyConsensusById }));
}
