import { bcs } from '@mysten/sui/bcs';
import { blake2b } from '@noble/hashes/blake2.js';
import { fromBase64, fromHex, toBase64, toBase58 } from '@mysten/sui/utils';
import { deriveMakerV8ProtocolConfigCommitment } from '../maker-v8-protocol-commitment.js';

const vector = bcs.vector(bcs.u8());
const Events = bcs.struct('NativeBootstrapTransactionEvents', { data: bcs.vector(bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  event_type: bcs.StructTag, contents: vector,
})) });
const TreasuryInitialized = bcs.struct('ProtocolTreasuryV8Initialized', {
  config_id: bcs.Address, treasury_id: bcs.Address, revision: bcs.u64(), commitment: vector,
});
const EnabledChanged = bcs.struct('ProtocolV8EnabledChanged', {
  config_id: bcs.Address, revision: bcs.u64(), enabled: bcs.bool(), commitment: vector,
});
const SealPolicyCreated = bcs.struct('SealPolicyCreatedV8', {
  config_id: bcs.Address, catalog_id: bcs.Address, threshold: bcs.u16(),
  key_server_set_commitment: vector, commitment: vector,
});
const STAGES = ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'];
const equalBytes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
function check(condition, label) {
  if (!condition) throw Object.assign(new Error(`Invalid native bootstrap events: ${label}`), {
    code: 'NATIVE_SOUL_BOOTSTRAP_EVENTS_INVALID',
  });
}
function canonical(base64, schema, label, maximum) {
  check(typeof base64 === 'string' && base64.length > 0
    && base64.length <= Math.ceil(maximum / 3) * 4, `${label} bytes bound`);
  try {
    const bytes = fromBase64(base64);
    check(bytes.length <= maximum && toBase64(bytes) === base64, `${label} canonical base64`);
    const parsed = schema.parse(bytes);
    check(equalBytes(bytes, schema.serialize(parsed, { maxSize: maximum }).toBytes()), `${label} canonical BCS`);
    return { bytes, parsed };
  } catch (cause) {
    if (cause?.code === 'NATIVE_SOUL_BOOTSTRAP_EVENTS_INVALID') throw cause;
    check(false, `${label} malformed BCS`);
  }
}
function protocolCommitment(p, revision, enabled) {
  return fromHex(deriveMakerV8ProtocolConfigCommitment({ configId: p.id,
    coreOriginalPackageId: p.core_original_package_id, coreCallablePackageId: p.core_callable_package_id,
    revision, treasuryId: p.treasury_id, enabled, paymentCoinType: p.payment_coin_type,
    primaryContentFeeBps: p.primary_content_fee_bps, fixedCompleteFeeAtomic: p.fixed_complete_fee_atomic,
    makerMarketFeeBps: p.maker_market_fee_bps, soulMarketFeeBps: p.soul_market_fee_bps }));
}

/** Event semantics for the exact four current bootstrap transactions. Objects
 * must come from validateNativeSoulBootstrapHistory, not latest JSON. Callers
 * retain source, checkpoint/signature, object/commitment and WAL-context checks.
 * These transactions emit 2/1/0/0 events respectively; there is no event fallback.
 */
export function assertNativeSoulBootstrapEvents({ stage, input, sender, finalityEvidence, objects }) {
  check(STAGES.includes(stage), 'unknown stage');
  const { parsed: effects } = canonical(finalityEvidence.effectsBcsBase64, bcs.TransactionEffects,
    'effects', 2 * 1024 * 1024);
  check(effects.$kind === 'V2', 'current effects version');
  const actualDigest = effects.V2.eventsDigest;
  if (stage === 'BEGIN_BOOTSTRAP' || stage === 'FINALIZE_BOOTSTRAP') {
    check(actualDigest === null && finalityEvidence.eventsDigest === null
      && finalityEvidence.transactionEvents === null, 'unexpected events in event-free stage');
    return finalityEvidence.transactionEvents;
  }
  const envelope = finalityEvidence.transactionEvents;
  check(envelope && Object.getPrototypeOf(envelope) === Object.prototype
    && Object.keys(envelope).length === 3
    && ['digest', 'bcsBase64', 'eventCount'].every(key => Object.hasOwn(envelope, key)), 'required event envelope');
  const { bytes, parsed } = canonical(envelope.bcsBase64, Events, 'events', 4096);
  const digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'), ...bytes]), { dkLen: 32 }));
  check(digest === actualDigest && digest === finalityEvidence.eventsDigest && digest === envelope.digest,
    'event digest differs from exact effects');
  const expected = [];
  const add = (role, module, name, schema, fields) => expected.push({ role, module, name, schema, fields });
  if (stage === 'INITIALIZE_PROTOCOL') {
    const p = objects.protocol.fields, treasury = objects.protocolTreasury.fields;
    check(p.revision === '2' && p.enabled === true && treasury.id === p.treasury_id,
      'initialized protocol state');
    const final = protocolCommitment(p, '2', true);
    check(equalBytes(final, p.commitment), 'final protocol commitment');
    add('core', 'protocol_config_v8', 'ProtocolTreasuryV8Initialized', TreasuryInitialized,
      { config_id: p.id, treasury_id: treasury.id, revision: '1', commitment: protocolCommitment(p, '1', false) });
    add('core', 'protocol_config_v8', 'ProtocolV8EnabledChanged', EnabledChanged,
      { config_id: p.id, revision: '2', enabled: true, commitment: final });
  } else {
    const s = objects.sealConfig.fields;
    check(s.catalog_id === objects.catalog.fields.id && s.threshold === Number(input.sealPolicy.threshold),
      'Seal prepared state');
    add('seal', 'seal_v8', 'SealPolicyCreatedV8', SealPolicyCreated,
      { config_id: s.id, catalog_id: s.catalog_id, threshold: s.threshold,
        key_server_set_commitment: s.key_server_set_commitment, commitment: s.commitment });
  }
  check(parsed.data.length === expected.length && envelope.eventCount === String(expected.length), 'event cardinality');
  expected.forEach(({ role, module, name, schema, fields }, index) => {
    const event = parsed.data[index], type = event.event_type;
    check(event.package_id === input.packageIds[role] && event.transaction_module === module
      && event.sender === sender && type.address === input.packageIds[role] && type.module === module
      && type.name === name && Array.isArray(type.typeParams) && type.typeParams.length === 0,
    `event ${index} package/module/sender/type/order`);
    check(equalBytes(Uint8Array.from(event.contents), schema.serialize(fields).toBytes()),
      `event ${index} exact state payload`);
  });
  return finalityEvidence.transactionEvents;
}
