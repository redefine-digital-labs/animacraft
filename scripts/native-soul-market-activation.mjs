import { isDeepStrictEqual } from 'node:util';
import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils';
import { NativeSoulPublicationBcs } from './native-soul-publication-outputs.mjs';
import { decodeNativeSoulBootstrapHistoryObject } from './native-soul-bootstrap-history.mjs';
import { assertNativeSoulBootstrapGasEffects } from './native-soul-bootstrap-effects.mjs';

const KEYS = ['marketConfigV2', 'marketAdminCapV2'];
const ZERO = `0x${'0'.repeat(64)}`;
function check(value, label) {
  if (!value) { const error = new Error(`Invalid native Soul Market activation: ${label}`);
    error.code = 'NATIVE_SOUL_MARKET_ACTIVATION_INVALID'; throw error; }
}
function exact(value, keys, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), label);
}
function id(value) { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value !== ZERO, 'canonical nonzero ID'); }
function version(value) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 20
    && BigInt(value) <= 18446744073709551615n, 'positive u64 version');
  return BigInt(value);
}
function digest(value) {
  try { check(typeof value === 'string' && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'digest'); }
  catch { check(false, 'digest'); }
}
function canonical(codec, bytes, label) {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, `${label} bounded bytes`);
  let result;
  try { result = codec.parse(bytes);
    check(toBase64(codec.serialize(result, { maxSize: 8 * 1024 * 1024 }).toBytes()) === toBase64(bytes), `${label} canonical BCS`);
  } catch { check(false, `${label} canonical BCS`); }
  return result;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function validateInput(input) {
  exact(input, ['packageId', 'marketConfig', 'marketAdminCap'], 'input fields'); id(input.packageId);
  exact(input.marketConfig, ['objectId', 'initialSharedVersion'], 'shared config reference');
  id(input.marketConfig.objectId); version(input.marketConfig.initialSharedVersion);
  exact(input.marketAdminCap, ['objectId', 'version', 'digest'], 'admin reference');
  id(input.marketAdminCap.objectId); version(input.marketAdminCap.version); digest(input.marketAdminCap.digest);
  check(new Set([input.packageId, input.marketConfig.objectId, input.marketAdminCap.objectId]).size === 3, 'identity collision');
}

/** Exact existing ABI; no gas, signer, network, or execution policy is chosen. */
export function buildNativeSoulMarketActivationTransaction(input) {
  validateInput(input);
  const tx = new Transaction(), config = tx.sharedObjectRef({ ...input.marketConfig, mutable: true });
  const admin = tx.objectRef(input.marketAdminCap);
  for (const gate of ['primary', 'secondary']) tx.moveCall({
    target: `${input.packageId}::market::update_config_v2_${gate}_enabled`, arguments: [config, admin, tx.pure.bool(true)],
  });
  return tx;
}
function decodeObjects(objects, packageId) {
  exact(objects, KEYS, 'exact market object inventory'); id(packageId);
  return Object.fromEntries(KEYS.map(kind => {
    const decoded = decodeNativeSoulBootstrapHistoryObject(objects[kind]);
    check(decoded.object.type === `${packageId}::market::${NativeSoulPublicationBcs[kind].name}`, `${kind} exact type origin`);
    const fields = canonical(NativeSoulPublicationBcs[kind], fromBase64(decoded.object.bcsBase64), `${kind} content`);
    check(fields.id === decoded.reference.objectId, `${kind} UID`);
    const full = bcs.Object.parse(fromBase64(objects[kind].objectBcsBase64));
    check(full.data.Move.hasPublicTransfer === (kind === 'marketAdminCapV2'), `${kind} public transfer ability`);
    return [kind, { ...decoded, fields }];
  }));
}
function derive(packageId, sender, priorObjects) {
  id(sender);
  const prior = decodeObjects(priorObjects, packageId), config = prior.marketConfigV2, admin = prior.marketAdminCapV2;
  check(config.object.owner.kind === 'shared' && version(config.reference.version) >= version(config.object.owner.initialSharedVersion), 'shared config birth');
  check(admin.object.owner.kind === 'address' && admin.object.owner.address === sender && admin.fields.config_id === config.fields.id, 'exact signer admin authority');
  check(config.fields.version === '2' && config.fields.legacy_config_id === ZERO && config.fields.fee_recipient === sender
    && config.fields.platform_fee_bps === 250 && config.fields.primary_enabled === false && config.fields.secondary_enabled === false,
  'fresh disabled MarketConfigV2');
  const input = { packageId, marketConfig: { objectId: config.reference.objectId, initialSharedVersion: config.object.owner.initialSharedVersion },
    marketAdminCap: { ...admin.reference } };
  validateInput(input); return { input, prior };
}

/** The caller supplies already-certified SO publication/predecessor envelopes.
 * This validates BCS and authority but does not certify their chain finality. */
export function deriveNativeSoulMarketActivationInput({ packageId, sender, priorObjects }) {
  return freeze(structuredClone(derive(packageId, sender, priorObjects).input));
}
function inspect({ input, sender, transactionBytes, effectsBytes, priorObjects }) {
  const { input: expected, prior } = derive(input.packageId, sender, priorObjects);
  check(isDeepStrictEqual(input, expected), 'input differs from certified predecessor references');
  const tx = canonical(bcs.TransactionData, transactionBytes, 'transaction');
  check(tx.$kind === 'V1' && tx.V1.sender === sender && tx.V1.gasData.owner === sender, 'exact sender/gas owner');
  // The sole runner uses address balances. Coin gas is explicitly unsupported
  // here, not silently reinterpreted or adopted as a fallback funding policy.
  check(tx.V1.gasData.payment.length === 0, 'address-balance gas required');
  const kind = TransactionDataBuilder.restore(buildNativeSoulMarketActivationTransaction(input).getData()).build({ onlyTransactionKind: true });
  check(toBase64(bcs.TransactionKind.serialize(tx.V1.kind).toBytes()) === toBase64(kind), 'exact two enabling calls');
  const parsed = canonical(bcs.TransactionEffects, effectsBytes, 'effects');
  check(parsed.$kind === 'V2', 'effects V2 required');
  const effects = parsed.V2, transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  check(effects.status.$kind === 'Success' && effects.transactionDigest === transactionDigest && effects.gasObjectIndex === null,
    'exact successful address-gas effects');
  check(effects.unchangedConsensusObjects.length === 0, 'no readonly consensus inputs');
  const lamport = version(effects.lamportVersion), seen = new Set(), refs = {}, accumulators = [];
  for (const [objectId, change] of effects.changedObjects) {
    check(!seen.has(objectId), 'duplicate effect ID'); seen.add(objectId);
    if (change.outputState.$kind === 'AccumulatorWriteV1') {
      check(change.inputState.$kind === 'NotExist' && change.idOperation.$kind === 'None', 'accumulator state');
      accumulators.push({ objectId, delta: change.outputState.AccumulatorWriteV1 }); continue;
    }
    const key = KEYS.find(k => prior[k].reference.objectId === objectId);
    check(key && change.inputState.$kind === 'Exist' && change.outputState.$kind === 'ObjectWrite'
      && change.idOperation.$kind === 'None', 'only exact two mutated market inputs');
    const before = prior[key], wireOwner = key === 'marketConfigV2'
      ? { Shared: { initialSharedVersion: input.marketConfig.initialSharedVersion }, $kind: 'Shared' }
      : { AddressOwner: sender, $kind: 'AddressOwner' };
    check(isDeepStrictEqual(change.inputState.Exist, [[before.reference.version, before.reference.digest], wireOwner]), 'exact historical before reference/owner');
    check(isDeepStrictEqual(change.outputState.ObjectWrite[1], wireOwner) && lamport > version(before.reference.version), 'unchanged owner and advanced version');
    refs[key] = { objectId, version: effects.lamportVersion, digest: change.outputState.ObjectWrite[0] };
  }
  // Sui 722ac4 transaction.rs::exclusive_mutable_inputs includes every non-
  // immutable owned input; temporary_store::ensure_active_inputs_mutated bumps
  // even the &MarketAdminCapV2 input. It is NOT a readonly consensus root.
  exact(refs, KEYS, 'both inputs must be mutated');
  assertNativeSoulBootstrapGasEffects({ sender, effects: { gasPaymentKind: 'address-balance', gas: [], accumulators, gasUsed: effects.gasUsed } });
  check(accumulators.every(row => row.objectId !== input.packageId && !KEYS.some(k => row.objectId === refs[k].objectId)), 'gas/business collision');
  return { refs, prior, transactionDigest };
}

/** Exact effect-selected refs for the caller's versioned historical transport.
 * No latest reads, signatures, broadcast, or events-payload claim. */
export function nativeSoulMarketActivationOutputReferences(args) {
  return freeze(inspect(structuredClone(args)).refs);
}

/** Full Object/effects proof after exact historical reads. Finality/signatures
 * and predecessor certificate linkage remain the enclosing WAL's obligation.
 * Both public setters emit events; this proof does not inspect their payloads. */
export function validateNativeSoulMarketActivationHistory(args) {
  const { input, sender, transactionBytes, effectsBytes, priorObjects, objects } = structuredClone(args);
  const checked = inspect({ input, sender, transactionBytes, effectsBytes, priorObjects });
  const outputs = decodeObjects(objects, input.packageId);
  for (const key of KEYS) {
    const output = outputs[key], previous = checked.prior[key];
    check(isDeepStrictEqual(output.reference, checked.refs[key]) && output.previousTransaction === checked.transactionDigest, 'exact effect/transaction output');
    check(isDeepStrictEqual(output.object.owner, previous.object.owner), 'output owner');
    const expected = key === 'marketConfigV2' ? { ...previous.fields, primary_enabled: true, secondary_enabled: true } : previous.fields;
    check(isDeepStrictEqual(output.fields, expected), 'only both gate flags may change');
  }
  return freeze({ schema: 'native-soul-market-activation-history-v1', stage: 'ACTIVATE_SOULIDITY_MARKET', input, priorObjects, objects });
}
