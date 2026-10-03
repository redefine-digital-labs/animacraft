import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils';
import { isDeepStrictEqual } from 'node:util';
import { buildNativeSoulBootstrapTransaction } from './native-soul-bootstrap-transactions.mjs';

function check(value, label) {
  if (!value) {
    const error = new Error(`Invalid native bootstrap effects: ${label}`);
    error.code = 'NATIVE_SOUL_BOOTSTRAP_EFFECTS_INVALID';
    throw error;
  }
}
function canonical(codec, bytes, label) {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, label);
  let value;
  try {
    value = codec.parse(bytes);
    check(toBase64(codec.serialize(value, { maxSize: 8 * 1024 * 1024 }).toBytes()) === toBase64(bytes), `${label} canonical BCS`);
  } catch { check(false, `${label} canonical BCS`); }
  return value;
}
function owner(value) {
  switch (value.$kind) {
    case 'Immutable': return { kind: 'immutable' };
    case 'AddressOwner': return { kind: 'address', address: value.AddressOwner };
    case 'ObjectOwner': return { kind: 'object', objectId: value.ObjectOwner };
    case 'Shared': return { kind: 'shared', initialSharedVersion: value.Shared.initialSharedVersion };
    default: check(false, 'unsupported object owner');
  }
}
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Sui 722ac4fcf484 gas_charger::legacy_charge_gas emits exactly the net
 * Balance<SUI> delta for address payment. The four bootstrap kinds contain no
 * other balance operation. Retain the raw row; never silently discard it as gas.
 * Requires transaction-bound output from decodeNativeSoulBootstrapEffects. */
export function assertNativeSoulBootstrapGasEffects({ sender, effects }) {
  check(typeof sender === 'string' && /^0x[0-9a-f]{64}$/.test(sender) && !/^0x0+$/.test(sender), 'gas sender');
  check(effects && Array.isArray(effects.gas) && Array.isArray(effects.accumulators), 'gas evidence arrays');
  if (effects.gasPaymentKind === 'coin') {
    check(effects.gas.length > 0 && effects.accumulators.length === 0, 'coin gas cannot mix address accumulators');
    return;
  }
  check(effects.gasPaymentKind === 'address-balance' && effects.gas.length === 0, 'exact gas payment kind');
  const keys = ['computationCost', 'storageCost', 'storageRebate', 'nonRefundableStorageFee'];
  check(effects.gasUsed && isDeepStrictEqual(Object.keys(effects.gasUsed).sort(), [...keys].sort()), 'gas summary fields');
  for (const key of keys) check(typeof effects.gasUsed[key] === 'string' && /^(0|[1-9][0-9]*)$/.test(effects.gasUsed[key])
    && effects.gasUsed[key].length <= 20 && BigInt(effects.gasUsed[key]) <= 18446744073709551615n, 'gas summary u64');
  // nonRefundableStorageFee is already accounted for; do not add it again.
  const gross = BigInt(effects.gasUsed.computationCost) + BigInt(effects.gasUsed.storageCost);
  const rebate = BigInt(effects.gasUsed.storageRebate);
  // Rust net_gas_usage casts these operands to i64 before subtracting. Reject
  // values outside its non-wrapping domain instead of emulating signed casts.
  check(gross <= 9223372036854775807n && rebate <= 9223372036854775807n, 'gas summary signed arithmetic domain');
  const net = gross - rebate;
  const amount = net < 0n ? -net : net;
  check(effects.accumulators.length === (net === 0n ? 0 : 1), 'exact address gas accumulator cardinality');
  if (net === 0n) return;
  const balanceType = normalizeStructTag('0x2::balance::Balance<0x2::sui::SUI>');
  const objectId = deriveDynamicFieldID('0xacc', `0x2::accumulator::Key<${balanceType}>`, bcs.Address.serialize(sender).toBytes());
  const operation = net > 0n ? 'Split' : 'Merge';
  check(isDeepStrictEqual(effects.accumulators[0], { objectId, delta: {
    address: { address: sender, ty: balanceType },
    operation: { [operation]: true, $kind: operation }, value: { Integer: amount.toString(), $kind: 'Integer' },
  } }), 'exact sender SUI gas accumulator ID/type/direction/amount');
}

/** Decode a successful execution of the exact rebuilt stage, retaining every
 * business write/deletion/wrap/accumulator delta. This is NOT checkpoint finality
 * or semantic readiness: the caller must verify historical objects, the exact
 * stage write set and every accumulator delta before advancing its journal. */
export function decodeNativeSoulBootstrapEffectsSync({ stage, input, sender, transactionBytes, effectsBytes }) {
  check(typeof sender === 'string' && /^0x[0-9a-f]{64}$/.test(sender) && !/^0x0+$/.test(sender), 'sender');
  const rebuilt = buildNativeSoulBootstrapTransaction(stage, input);
  const expectedKind = TransactionDataBuilder.restore(rebuilt.getData()).build({ onlyTransactionKind: true });
  const transaction = canonical(bcs.TransactionData, transactionBytes, 'transaction');
  check(transaction.$kind === 'V1', 'transaction version');
  const tx = transaction.V1;
  check(tx.sender === sender && tx.gasData.owner === sender, 'sender/gas owner');
  check(toBase64(bcs.TransactionKind.serialize(tx.kind).toBytes()) === toBase64(expectedKind), 'stage TransactionKind');
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  const effects = canonical(bcs.TransactionEffects, effectsBytes, 'effects');
  // The current target emits V2. Never reinterpret an unsupported effects schema.
  check(effects.$kind === 'V2', 'effects version');
  const value = effects.V2;
  check(value.transactionDigest === transactionDigest && value.status.$kind === 'Success', 'exact successful transaction');
  check(BigInt(value.lamportVersion) > 0n, 'Lamport version');
  const seen = new Set();
  const writes = [], deleted = [], wrapped = [], accumulators = [];
  const rows = value.changedObjects.map(([objectId, change]) => {
    check(!seen.has(objectId), 'duplicate changed object'); seen.add(objectId);
    const before = change.inputState.$kind === 'Exist' ? {
      objectId, version: change.inputState.Exist[0][0], digest: change.inputState.Exist[0][1],
      owner: owner(change.inputState.Exist[1]),
    } : null;
    const operation = change.idOperation.$kind;
    const out = change.outputState;
    check(!(operation === 'Created' && before), 'created object already existed');
    if (out.$kind === 'ObjectWrite') {
      check(operation !== 'Deleted', 'deleted object has a write');
      check(before === null || BigInt(value.lamportVersion) > BigInt(before.version), 'write did not advance version');
      const row = { operation: operation === 'Created' ? 'CREATED' : before ? 'MUTATED' : 'UNWRAPPED',
        objectId, version: value.lamportVersion, digest: out.ObjectWrite[0], owner: owner(out.ObjectWrite[1]), before };
      writes.push(row); return { kind: 'write', row };
    }
    if (out.$kind === 'NotExist') {
      check(operation !== 'Created' && before !== null, 'absent object has no prior state');
      const row = { objectId, before };
      if (operation === 'Deleted') { deleted.push(row); return { kind: 'deleted', row }; }
      wrapped.push(row); return { kind: 'wrapped', row };
    }
    if (out.$kind === 'AccumulatorWriteV1') {
      check(operation === 'None' && before === null, 'invalid accumulator object state');
      const row = { objectId, delta: out.AccumulatorWriteV1 };
      accumulators.push(row); return { kind: 'accumulator', row };
    }
    // Bootstrap never publishes a package; retaining this as a generic write
    // would conceal an extra publishing operation at the acceptance boundary.
    check(false, 'unexpected package or unknown output');
  });
  const payment = tx.gasData.payment;
  check(new Set(payment.map(p => p.objectId)).size === payment.length, 'duplicate gas payment');
  const gas = [];
  if (payment.length === 0) {
    check(value.gasObjectIndex === null, 'address-balance gas cannot identify a gas coin');
  } else {
    check(Number.isSafeInteger(value.gasObjectIndex) && value.gasObjectIndex >= 0
      && value.gasObjectIndex < rows.length, 'gas index');
    const main = rows[value.gasObjectIndex];
    check(main.kind === 'write' && main.row.operation === 'MUTATED'
      && main.row.objectId === payment[0].objectId
      && equal(main.row.owner, { kind: 'address', address: sender }), 'exact gas coin');
    for (let index = 0; index < payment.length; index++) {
      const reference = payment[index];
      const change = rows.find(row => row.row.objectId === reference.objectId);
      check(change && change.kind === (index === 0 ? 'write' : 'deleted'), 'gas payment outcome');
      const previous = change.row.before;
      check(previous?.version === reference.version && previous.digest === reference.digest
        && equal(previous.owner, { kind: 'address', address: sender }), 'gas input reference');
      gas.push(change.row);
    }
  }
  const gasIds = new Set(gas.map(row => row.objectId));
  return freeze({ transactionDigest, executedEpoch: value.executedEpoch, lamportVersion: value.lamportVersion,
    writes: writes.filter(row => !gasIds.has(row.objectId)), deleted: deleted.filter(row => !gasIds.has(row.objectId)),
    wrapped, accumulators, gas, gasPaymentKind: payment.length === 0 ? 'address-balance' : 'coin', gasUsed: value.gasUsed,
    unchangedConsensusObjects: value.unchangedConsensusObjects });
}

/** Promise-compatible facade. Validation is deliberately identical to the
 * synchronous WAL boundary, including errors becoming rejected promises. */
export async function decodeNativeSoulBootstrapEffects(value) {
  return decodeNativeSoulBootstrapEffectsSync(value);
}
