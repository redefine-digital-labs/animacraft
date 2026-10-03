import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64, fromBase58, toHex, normalizeStructTag, deriveDynamicFieldID } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { attestMakerV8Runtime, attestMakerV8NativeSoulCompletionRecovery } from './maker-v8-chain.js';
import { isMakerV8SuiGrpcNotFoundError } from './maker-v8-sui-grpc.js';
import { MakerV8DAppKitWalletError } from './maker-v8-dapp-kit-wallet.js';
import { CONTENT_ENVELOPE_SCHEMA, contentEnvelopeKey, encodeContentEnvelope } from './maker-v8-native-envelope-codec.js';

const SCHEMA = 'animacraft.native-envelope-operation.v1';
const enc = new TextEncoder(); const dec = new TextDecoder('utf-8', { fatal: true });
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
function check(value, reason = 'INVALID') { if (!value) throw Object.assign(new Error(`MAKER_V8_NATIVE_ENVELOPE_${reason}`), { code: `MAKER_V8_NATIVE_ENVELOPE_${reason}` }); }
function digest(value) { check(typeof value === 'string' && fromBase58(value).length === 32, 'DIGEST_INVALID'); return value; }
function bytes(value) { check(typeof value === 'string' && toBase64(fromBase64(value)) === value, 'BYTES_INVALID'); return fromBase64(value); }
const pending = reason => Object.freeze({ status: 'RECOVERY_REQUIRED', reason });
const exact = (value, fields) => check(value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)), 'RECORD_DRIFT');
const rank = record => ({ PREPARED: 0, SIGNING: 1, SIGNED: 2, FINALIZED_FAILURE: 3, FINALIZED_SUCCESS: 3 })[record.status];
const samePreparation = (left, right) => equal(
  [left.schema, left.scope, left.intent, left.snapshot, left.keys, left.bytes, left.digest, left.history],
  [right.schema, right.scope, right.intent, right.snapshot, right.keys, right.bytes, right.digest, right.history]);
function referenceSnapshot(snapshot) {
  return Object.fromEntries(['market', 'state'].map(key => [key, { data: { owner: { Shared: {
    initial_shared_version: snapshot?.[key]?.data?.owner?.Shared?.initial_shared_version,
  } } } }]));
}
const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
const State = bcs.struct('SoulState', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address,
  creator: bcs.Address, creator_royalty_bps: bcs.u16(), current_owner: bcs.Address, current_kiosk_id: bcs.Address,
  ownership_epoch: bcs.u64(), grant_capacity: bcs.u64(), active_grants: table, active_grant_ids: table,
  active_grant_count: bcs.u64(), content_id: bcs.option(bcs.Address), config_ext: table,
  collection_id: bcs.option(bcs.Address), access_list_id: bcs.option(bcs.Address), is_listed: bcs.bool() });
const Market = bcs.struct('MarketConfigV2', { id: bcs.Address, version: bcs.u64(), legacy_config_id: bcs.Address,
  fee_recipient: bcs.Address, platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool() });
const Content = bcs.struct('SoulContent', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address,
  items: table, count_by_kind: table, active: table });
const ContentKey = bcs.struct('ContentKey', { kind: bcs.u32(), name: bcs.string() });
const ContentSlot = bcs.struct('ContentSlot', { version: bcs.u64(), kind: bcs.u32(), blob_object_id: bcs.Address,
  is_public: bcs.bool(), deleted: bcs.bool(), purged: bcs.bool(), download_policy: bcs.u8(), grant_scope_mask: bcs.u64(),
  read_mode_mask: bcs.u64(), op_mask: bcs.u64(), seal_encrypted: bcs.bool(), created_at_ms: bcs.u64() });
const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() });

function intentOf(input, config) {
  const { rootId, signer, action, slots, contentSidecars } = input;
  check(id(rootId) && id(signer) && Array.isArray(slots) && slots.length > 0 && slots.length <= 32
    && Array.isArray(contentSidecars) && contentSidecars.length === slots.length, 'INPUT_INVALID');
  const certificate = action?.certificate; const event = certificate?.evidence?.certifiedEvent?.fields;
  check(action?.status === 'FINALIZED_SUCCESS' && action.action === 'completeOutput' && typeof action.actionId === 'string'
    && certificate?.status === 'CERTIFIED' && certificate.actionId === action.actionId
    && certificate.transactionDigest === action.transactionDigest && event?.root_id === rootId
    && event.original_holder === signer && id(event.soul_id) && id(event.soul_state_id), 'MINT_EVIDENCE_INVALID');
  const states = certificate.evidence.objects.filter(row => row.objectId === event.soul_state_id);
  check(states.length === 1 && states[0].fields?.soulId === event.soul_id && id(states[0].fields.contentId), 'MINT_EVIDENCE_INVALID');
  const entries = slots.map(slot => {
    check(slot.contentObjectId === states[0].fields.contentId, 'CONTENT_ID_DRIFT');
    const matches = contentSidecars.filter(row => row.kind === slot.kind && row.name === slot.name && String(row.versionIndex) === slot.versionIndex);
    check(matches.length === 1, 'SIDECAR_DRIFT');
    const value = encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot, sidecar: matches[0].sidecar }, config.soulidityOriginalPackageId);
    return { slot, key: contentEnvelopeKey(slot), value };
  });
  entries.sort((a, b) => a.key.localeCompare(b.key));
  check(new Set(entries.map(row => row.key)).size === entries.length, 'DUPLICATE_SLOT');
  return { rootId, signer, actionId: action.actionId, mintDigest: digest(action.transactionDigest),
    soulId: event.soul_id, stateId: event.soul_state_id, contentId: states[0].fields.contentId,
    config: clone(config), entries };
}

/** Separate post-mint wallet step. Caller owns encrypted CAS storage; no mint,
 * plaintext, DEK, permission-policy mutation or backend request exists here.
 * `action` must come from the original Player custody.readbackPlayerAction
 * (also run on recovery), not an unverified cached certificate. Its fields route
 * the fresh owner/content checks here; the read-only receiver rechecks the mint. */
export function createMakerV8NativeEnvelopeOperationV8({ runtime: runtimeInput, client, wallet, locks,
  execution = {}, timeoutMs = 25000 } = {}) {
  const runtime = clone(runtimeInput); const config = runtime?.nativeSoulIntegration; const gates = clone(execution);
  check(config && ['soulidityCallablePackageId', 'soulidityOriginalPackageId', 'marketConfigV2Id'].every(key => id(config[key])), 'CONFIG_INVALID');
  digest(config.soulidityCallableDigest);
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'TIMEOUT_INVALID');
  // Never evict an artifact that contains a verified signature not yet durably
  // acknowledged. This is a same-page rescue aid, not the persistent store.
  const emergency = new Map();
  const recoveryJsonOf = value => JSON.stringify(value);
  function remember(value) {
    const prior = emergency.get(value.scope);
    if (prior) {
      check(samePreparation(prior, value) && prior.signature === value.signature, 'RECOVERY_CONFLICT');
      if (rank(prior) > rank(value)) return;
      if (rank(prior) === 3 && rank(value) === 3) check(equal(prior.finality, value.finality), 'RECOVERY_CONFLICT');
    }
    emergency.set(value.scope, clone(value));
  }
  return Object.freeze({
    exportRecovery({ rootId, signer, actionId } = {}) {
      check(id(rootId) && id(signer) && typeof actionId === 'string' && actionId.length > 0, 'INPUT_INVALID');
      const values = [...emergency.values()].filter(record => record.intent.rootId === rootId
        && record.intent.signer === signer && record.intent.actionId === actionId);
      check(values.length <= 1, 'RECOVERY_CONFLICT');
      return values.length ? recoveryJsonOf(values[0]) : null;
    },
    async persist(input, { load, write, mode = 'resume', assertBeforeSignature, reprepare = false, recoveryJson } = {}) {
    // Snapshot even before acquiring a potentially contended cross-tab lock.
    const intent = intentOf(clone(input), config);
    let imported = null;
    if (recoveryJson !== undefined) {
      check(typeof recoveryJson === 'string' && enc.encode(recoveryJson).length <= 2 * 1024 * 1024, 'RECOVERY_IMPORT_INVALID');
      imported = JSON.parse(recoveryJson);
      check(recoveryJsonOf(imported) === recoveryJson, 'RECOVERY_IMPORT_INVALID');
    }
    check(['query', 'resume'].includes(mode) && typeof load === 'function' && typeof write === 'function'
      && typeof reprepare === 'boolean', 'CALLBACK_INVALID');
    check(typeof locks?.request === 'function', 'LOCKS_REQUIRED');
    const scope = toHex(sha256(enc.encode(JSON.stringify(intent))));
    return locks.request(`animacraft-native-envelope:${intent.rootId}:${intent.signer}:${intent.actionId}`, async () => {
      let stopped = false;
      const step = async task => {
        check(!stopped, 'ABORTED'); let timer;
        try { return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
          timer = setTimeout(() => { stopped = true; reject(Object.assign(new Error('MAKER_V8_NATIVE_ENVELOPE_TIMEOUT'), { code: 'MAKER_V8_NATIVE_ENVELOPE_TIMEOUT' })); }, timeoutMs);
        })]); } finally { clearTimeout(timer); }
      };
      const selected = async () => { const account = await step(() => wallet.getCurrentAccount());
        check(account?.network === 'mainnet' && account.address === intent.signer, 'WALLET_CHANGED'); };
      let record = clone(await step(load));
      const save = async next => {
        const snapshot = clone(next);
        // Strong states reach this function only after validate(), including the
        // original exact-signature verifier. Cache before any fallible I/O.
        if (rank(snapshot) >= 2) remember(snapshot);
        try {
          check(enc.encode(JSON.stringify(snapshot)).length <= 2 * 1024 * 1024, 'RECOVERY_STORAGE_FULL');
          const result = clone(await step(() => write(clone(snapshot))));
          check(equal(result, snapshot) && equal(clone(await step(load)), snapshot), 'PERSISTENCE_FAILED');
          record = snapshot;
          const retained = emergency.get(scope);
          if (retained && samePreparation(retained, snapshot) && retained.signature === snapshot.signature
            && rank(snapshot) >= rank(retained)) emergency.delete(scope);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error('MAKER_V8_NATIVE_ENVELOPE_PERSISTENCE_FAILED');
          const retained = emergency.get(scope);
          if (retained) { failure.recoveryRecord = clone(retained); failure.recoveryJson = recoveryJsonOf(retained); }
          throw failure;
        }
      };
      const raw = async (objectId, type, codec, owner, optional = false) => {
        let response;
        try { response = await step(() => client.getObject({ id: objectId, options: { showBcs: true } })); }
        catch (error) { if (optional && error instanceof ObjectError && error.code === 'notExists'
          && error.reason === 'notFound' && error.objectId === objectId) return null; throw error; }
        const data = response?.data;
        check(data?.objectId === objectId && uint(String(data.version)) && BigInt(data.version) > 0n
          && normalizeStructTag(data.type) === normalizeStructTag(type) && data.bcs?.dataType === 'moveObject'
          && normalizeStructTag(data.bcs.type) === normalizeStructTag(type), 'OBJECT_IDENTITY_DRIFT');
        digest(data.digest); const valueBytes = bytes(data.bcs.bcsBytes); check(valueBytes.length <= 2 * 1024 * 1024, 'READ_TOO_LARGE');
        const value = codec.parse(valueBytes);
        check(value.id === objectId && toBase64(codec.serialize(value).toBytes()) === data.bcs.bcsBytes, 'BCS_DRIFT');
        if (owner === 'shared') check(uint(String(data.owner?.Shared?.initial_shared_version))
          && BigInt(data.owner.Shared.initial_shared_version) > 0n, 'OBJECT_OWNER_DRIFT');
        else check(data.owner?.ObjectOwner === owner, 'OBJECT_OWNER_DRIFT');
        return { data: clone(data), value };
      };
      const runtimeAuthority = await step(() => attestMakerV8Runtime(client, runtime));
      const authority = await step(() => attestMakerV8NativeSoulCompletionRecovery(client, runtimeAuthority.runtime));
      const origins = authority.packageEvidence.origins;
      const type = name => { check(typeof origins[name] === 'string', 'TYPE_ORIGIN_MISSING'); return origins[name]; };
      const read = async () => {
        const seen = [];
        const get = async (...args) => { const value = await raw(...args); seen.push({ args, value }); return value; };
        const state = await get(intent.stateId, type('soul::SoulState'), State, 'shared');
        check(state.value.version === '1' && state.value.soul_id === intent.soulId && state.value.content_id === intent.contentId, 'STATE_BINDING_DRIFT');
        const content = await get(intent.contentId, type('content::SoulContent'), Content, 'shared');
        check(content.value.version === '1' && content.value.soul_id === intent.soulId, 'CONTENT_BINDING_DRIFT');
        const market = await get(config.marketConfigV2Id, type('market::MarketConfigV2'), Market, 'shared');
        check(market.value.version === '2' && market.value.platform_fee_bps <= 10000, 'MARKET_DRIFT');
        const missing = [];
        for (const entry of intent.entries) {
          const key = { kind: entry.slot.kind, name: entry.slot.name }; const keyType = type('content::ContentKey');
          const fieldId = deriveDynamicFieldID(content.value.items.id, keyType, ContentKey.serialize(key).toBytes());
          const codec = bcs.struct('Field', { id: bcs.Address, name: ContentKey, value: bcs.vector(ContentSlot) });
          const field = await get(fieldId, `0x2::dynamic_field::Field<${keyType},vector<${type('content::ContentSlot')}>>`, codec, content.value.items.id);
          check(equal(field.value.name, key), 'CONTENT_KEY_DRIFT');
          const slot = BigInt(entry.slot.versionIndex) < BigInt(field.value.value.length) ? field.value.value[Number(entry.slot.versionIndex)] : null;
          check(slot?.version === '1' && slot.kind === key.kind && slot.blob_object_id === entry.slot.blobObjectId
            && !slot.deleted && !slot.purged && slot.seal_encrypted, 'CONTENT_SLOT_DRIFT');
          const nameCodec = bcs.string(); const extId = deriveDynamicFieldID(state.value.config_ext.id, '0x1::string::String', nameCodec.serialize(entry.key).toBytes());
          const ext = await get(extId, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>',
            bcs.struct('Field', { id: bcs.Address, name: nameCodec, value: bcs.vector(bcs.u8()) }), state.value.config_ext.id, true);
          if (ext) check(ext.value.name === entry.key && dec.decode(Uint8Array.from(ext.value.value)) === entry.value, 'ENVELOPE_VALUE_CONFLICT');
          else missing.push(entry);
        }
        for (const row of seen) check(equal((await raw(...row.args))?.data ?? null, row.value?.data ?? null), 'READ_DRIFT');
        return { state, market, missing };
      };
      const template = (snapshot, entries) => {
        const tx = new Transaction(); tx.setSender(intent.signer);
        const market = tx.sharedObjectRef({ objectId: config.marketConfigV2Id, initialSharedVersion: snapshot.market.data.owner.Shared.initial_shared_version, mutable: false });
        const state = tx.sharedObjectRef({ objectId: intent.stateId, initialSharedVersion: snapshot.state.data.owner.Shared.initial_shared_version, mutable: true });
        for (const entry of entries) tx.moveCall({ target: `${config.soulidityCallablePackageId}::market::set_state_config_v2`,
          arguments: [market, state, tx.pure.string(entry.key), tx.pure.vector('u8', [...enc.encode(entry.value)])] });
        return tx;
      };
      const validate = async (value, includeHistory = true) => {
        exact(value, ['schema', 'scope', 'intent', 'status', 'snapshot', 'keys', 'bytes', 'digest', 'signature', 'finality', 'history']);
        check(value?.schema === SCHEMA && value.scope === scope && equal(value.intent, intent)
          && ['PREPARED', 'SIGNING', 'SIGNED', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(value.status), 'RECORD_DRIFT');
        check(enc.encode(JSON.stringify(value)).length <= 2 * 1024 * 1024 && Array.isArray(value.history), 'RECORD_DRIFT');
        check(equal(value.snapshot, referenceSnapshot(value.snapshot))
          && ['market', 'state'].every(key => uint(value.snapshot[key].data.owner.Shared.initial_shared_version)
            && BigInt(value.snapshot[key].data.owner.Shared.initial_shared_version) > 0n), 'RECORD_DRIFT');
        check(Array.isArray(value.keys) && value.keys.length > 0 && new Set(value.keys).size === value.keys.length
          && value.keys.every(key => intent.entries.some(entry => entry.key === key)), 'RECORD_DRIFT');
        const transactionBytes = bytes(value.bytes); check(transactionBytes.length <= 128 * 1024
          && TransactionDataBuilder.getDigestFromBytes(transactionBytes) === digest(value.digest), 'TRANSACTION_DRIFT');
        const tx = Transaction.from(transactionBytes); const data = tx.getData();
        check(data.sender === intent.signer && data.gasData.owner === intent.signer && data.gasData.budget === '50000000'
          && uint(data.gasData.price) && BigInt(data.gasData.price) > 0n && data.gasData.payment?.length === 1
          && data.expiration?.$kind === 'Epoch' && Number.isSafeInteger(data.expiration.Epoch)
          && data.expiration.Epoch >= 0, 'GAS_DRIFT');
        const ref = data.gasData.payment[0]; check(id(ref.objectId) && uint(ref.version) && BigInt(ref.version) > 0n, 'GAS_DRIFT'); digest(ref.digest);
        const expected = template(value.snapshot, value.keys.map(key => intent.entries.find(entry => entry.key === key)));
        expected.setGasOwner(intent.signer); expected.setGasBudget(data.gasData.budget); expected.setGasPrice(data.gasData.price);
        expected.setGasPayment(data.gasData.payment); expected.setExpiration(data.expiration);
        check(toBase64(await expected.build()) === value.bytes, 'COMMAND_DRIFT');
        if (!['PREPARED', 'SIGNING'].includes(value.status)) {
          check(typeof value.signature === 'string', 'SIGNATURE_DRIFT');
          const verified = await step(() => wallet.verifyExactSignature({ bytes: value.bytes, digest: value.digest, signature: value.signature, signer: intent.signer }));
          check(verified?.verified === true && verified.bytes === value.bytes && verified.digest === value.digest
            && verified.signer === intent.signer, 'SIGNATURE_DRIFT');
        }
        else check(value.signature === null, 'SIGNATURE_DRIFT');
        if (value.status.startsWith('FINALIZED_')) {
          const proof = value.finality;
          exact(proof, ['digest', 'checkpoint', 'epoch', 'effectsBcsBase64', 'effectsDigest', 'success']);
          check(proof?.digest === value.digest && uint(proof.checkpoint) && uint(proof.epoch)
            && typeof proof.success === 'boolean' && proof.success === (value.status === 'FINALIZED_SUCCESS'), 'FINALITY_DRIFT');
          const effectsBytes = bytes(proof.effectsBcsBase64); const effects = bcs.TransactionEffects.parse(effectsBytes);
          const payload = effects.V1 ?? effects.V2;
          check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === proof.effectsBcsBase64
            && payload?.transactionDigest === value.digest && payload.executedEpoch === proof.epoch
            && (payload.status.$kind === 'Success') === proof.success
            && toHex(blake2b(new Uint8Array([...enc.encode('TransactionEffects::'), ...effectsBytes]), { dkLen: 32 })) === toHex(fromBase58(digest(proof.effectsDigest))), 'FINALITY_DRIFT');
        } else check(value.finality === null, 'FINALITY_DRIFT');
        if (includeHistory) {
          const priorDigests = new Set([value.digest]);
          for (const prior of value.history) {
            exact(prior, ['status', 'snapshot', 'keys', 'bytes', 'digest', 'signature', 'finality']);
            check(prior && ['PREPARED', 'FINALIZED_FAILURE'].includes(prior.status)
              && !Object.hasOwn(prior, 'history') && !Object.hasOwn(prior, 'intent')
              && !priorDigests.has(prior.digest), 'HISTORY_DRIFT');
            priorDigests.add(prior.digest);
            await validate({ ...prior, schema: SCHEMA, scope, intent, history: [] }, false);
          }
        }
      };
      const query = async () => {
        let evidence;
        try { evidence = await step(() => client.getFinalizedTransactionEvidence({ digest: record.digest })); }
        catch (error) { return isMakerV8SuiGrpcNotFoundError(error, record.digest) ? 'NOT_FOUND' : 'UNKNOWN'; }
        check(evidence.digest === record.digest && evidence.transactionBcsBase64 === record.bytes
          && evidence.sender === intent.signer && evidence.gasOwner === intent.signer
          && evidence.signatures?.length === 1 && (record.signature === null || evidence.signatures[0] === record.signature)
          && uint(evidence.checkpoint) && typeof evidence.effectsStatus?.success === 'boolean', 'FINALITY_DRIFT');
        const next = { ...record, signature: evidence.signatures[0], status: evidence.effectsStatus.success ? 'FINALIZED_SUCCESS' : 'FINALIZED_FAILURE',
          finality: { digest: evidence.digest, checkpoint: evidence.checkpoint, epoch: evidence.epoch,
            effectsBcsBase64: evidence.effectsBcsBase64, effectsDigest: evidence.effectsDigest, success: evidence.effectsStatus.success } };
        await validate(next); await save(next);
        return record.status;
      };
      const assertRecoveryDisk = candidate => {
        check(record && ['SIGNING', 'SIGNED', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(record.status), 'RECOVERY_DISK_STATE_INVALID');
        check(samePreparation(record, candidate)
          && (record.signature === null || record.signature === candidate.signature), 'RECOVERY_DISK_CONFLICT');
        if (rank(record) === 3 && rank(candidate) === 3) check(record.status === candidate.status
          && equal(record.finality, candidate.finality), 'RECOVERY_DISK_CONFLICT');
      };
      if (imported) {
        await validate(imported); check(rank(imported) >= 2, 'RECOVERY_IMPORT_INVALID');
        if (record) await validate(record);
        assertRecoveryDisk(imported); remember(imported);
      }
      const retained = emergency.get(scope);
      if (retained) {
        await validate(retained); if (record) await validate(record); assertRecoveryDisk(retained);
        // A later durable finalized record may supersede an older rescue copy;
        // never write the weaker copy back over it or discard its signature.
        const candidate = rank(record) > rank(retained) ? record : retained;
        await save(candidate);
      }
      if (record) {
        await validate(record);
        if (record.status !== 'PREPARED') {
          const result = await query();
          if (result === 'UNKNOWN') return pending('OUTCOME_UNKNOWN');
          if (result === 'FINALIZED_FAILURE' && !(mode === 'resume' && reprepare)) return pending('TRANSACTION_FAILED');
          if (result === 'NOT_FOUND' && record.status === 'SIGNING') return pending('SIGNATURE_OUTCOME_UNKNOWN');
          if (result === 'NOT_FOUND' && record.status !== 'SIGNED') return pending('FINALITY_UNAVAILABLE');
        }
      }
      let snapshot = await read();
      if (!snapshot.missing.length) return record?.status === 'SIGNED'
        ? pending('OUTCOME_PENDING') : Object.freeze({ status: 'COMPLETE' });
      if (record?.status === 'FINALIZED_SUCCESS') return pending('READBACK_PENDING');
      if (mode === 'query') return pending(record ? 'OUTCOME_PENDING' : 'SIGNATURE_REQUIRED');
      await selected();
      if (snapshot.state.value.current_owner !== intent.signer) return pending('CURRENT_OWNER_CHANGED');
      if (!snapshot.market.value.primary_enabled) return pending('PRIMARY_PAUSED');
      if (gates.allowWalletSignature !== true || gates.allowBroadcast !== true) return pending('EXECUTION_DISABLED');
      let replacing = record?.status === 'FINALIZED_FAILURE' ? record : null;
      if (record?.status === 'PREPARED' && reprepare) {
        const [system, price] = await Promise.all([step(() => client.getLatestSuiSystemState()), step(() => client.core.getReferenceGasPrice())]);
        check(uint(system.epoch) && uint(String(price.referenceGasPrice)), 'GAS_DRIFT');
        const prior = Transaction.from(bytes(record.bytes)).getData();
        if (BigInt(system.epoch) > BigInt(prior.expiration.Epoch) || String(price.referenceGasPrice) !== prior.gasData.price) replacing = record;
      }
      if (!record || replacing) {
        const tx = template(snapshot, snapshot.missing);
        tx.setGasOwner(intent.signer); tx.setGasBudget(50000000);
        const [price, system, coins] = await Promise.all([
          step(() => client.core.getReferenceGasPrice()), step(() => client.getLatestSuiSystemState()),
          step(() => client.getCoins({ owner: intent.signer, coinType: '0x2::sui::SUI', limit: 100 }))]);
        const gasPrice = String(price.referenceGasPrice); check(uint(gasPrice) && BigInt(gasPrice) > 0n && uint(system.epoch), 'GAS_DRIFT');
        const coin = coins.data.find(row => BigInt(row.balance) >= 50000000n); check(coin, 'GAS_UNAVAILABLE');
        const response = await step(() => client.getObject({ id: coin.coinObjectId, options: { showBcs: true } }));
        const data = response?.data; const gas = Coin.parse(bytes(data?.bcs?.bcsBytes));
        check(data.objectId === coin.coinObjectId && gas.id === coin.coinObjectId && data.owner?.AddressOwner === intent.signer
          && normalizeStructTag(data.type) === normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
          && data.version === coin.version && data.digest === coin.digest && gas.balance === coin.balance
          && toBase64(Coin.serialize(gas).toBytes()) === data.bcs.bcsBytes, 'GAS_DRIFT');
        tx.setGasPrice(gasPrice); tx.setGasPayment([{ objectId: coin.coinObjectId, version: coin.version, digest: coin.digest }]);
        check(BigInt(system.epoch) < BigInt(Number.MAX_SAFE_INTEGER), 'EPOCH_INVALID');
        tx.setExpiration({ Epoch: Number(system.epoch) + 1 });
        const built = await tx.build(); const next = { schema: SCHEMA, scope, intent, status: 'PREPARED',
          snapshot: referenceSnapshot(snapshot), keys: snapshot.missing.map(row => row.key),
          bytes: toBase64(built), digest: TransactionDataBuilder.getDigestFromBytes(built), signature: null, finality: null,
          history: replacing ? [...replacing.history, {
            status: replacing.status, snapshot: replacing.snapshot, keys: replacing.keys,
            bytes: replacing.bytes, digest: replacing.digest, signature: replacing.signature, finality: replacing.finality,
          }] : [] };
        if (replacing?.digest === next.digest) return pending('TRANSACTION_REPREPARE_NOT_READY');
        await validate(next); await save(next);
      }
      await validate(record);
      const fresh = async () => {
        snapshot = await read(); await selected();
        if (snapshot.state.value.current_owner !== intent.signer) return pending('CURRENT_OWNER_CHANGED');
        if (!snapshot.market.value.primary_enabled) return pending('PRIMARY_PAUSED');
        check(snapshot.market.data.owner.Shared.initial_shared_version === record.snapshot.market.data.owner.Shared.initial_shared_version
          && snapshot.state.data.owner.Shared.initial_shared_version === record.snapshot.state.data.owner.Shared.initial_shared_version, 'SHARED_BIRTH_DRIFT');
        const system = await step(() => client.getLatestSuiSystemState()); check(uint(system.epoch), 'EPOCH_INVALID');
        const data = Transaction.from(bytes(record.bytes)).getData();
        if (BigInt(system.epoch) > BigInt(data.expiration.Epoch)) return pending('EXPIRED_QUERY_ONLY');
        if (record.status === 'PREPARED') {
          const currentPrice = await step(() => client.core.getReferenceGasPrice());
          if (String(currentPrice.referenceGasPrice) !== data.gasData.price) return pending('GAS_PRICE_CHANGED');
          check(data.expiration.Epoch <= Number(system.epoch) + 1, 'EXPIRATION_DRIFT');
          const gasRef = data.gasData.payment[0];
          const gasObject = (await step(() => client.getObject({ id: gasRef.objectId, options: { showBcs: true } })))?.data;
          check(gasObject?.objectId === gasRef.objectId && gasObject.owner?.AddressOwner === intent.signer
            && gasObject.version === gasRef.version && gasObject.digest === gasRef.digest
            && normalizeStructTag(gasObject.type) === normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>'), 'GAS_DRIFT');
          const gasBytes = bytes(gasObject.bcs.bcsBytes); const coin = Coin.parse(gasBytes);
          check(coin.id === gasRef.objectId && BigInt(coin.balance) >= BigInt(data.gasData.budget)
            && toBase64(Coin.serialize(coin).toBytes()) === gasObject.bcs.bcsBytes, 'GAS_DRIFT');
        }
        return null;
      };
      let blocked = await fresh(); if (blocked) return blocked;
      if (record.status === 'PREPARED') {
        if (typeof assertBeforeSignature !== 'function') return pending('SIGNATURE_CONFIRMATION_REQUIRED');
        const simulated = await step(() => client.simulateTransaction({ transaction: bytes(record.bytes),
          checksEnabled: true, include: { effects: true, bcs: true } }));
        const simulation = simulated?.$kind === 'Transaction' ? simulated.Transaction : simulated?.FailedTransaction;
        check(simulation?.bcs instanceof Uint8Array && toBase64(simulation.bcs) === record.bytes
          && simulation.digest === record.digest && typeof simulation.status?.success === 'boolean', 'SIMULATION_DRIFT');
        if (simulated.$kind !== 'Transaction' || !simulation.status.success || simulation.effects?.status?.success !== true) return pending('SIMULATION_FAILED');
        await step(() => assertBeforeSignature(Object.freeze({ kind: 'NATIVE_ENVELOPES', soulId: intent.soulId,
          stateId: intent.stateId, transactionDigest: record.digest,
          gasBudgetMist: Transaction.from(bytes(record.bytes)).getData().gasData.budget, envelopeCount: record.keys.length })));
        blocked = await fresh(); if (blocked) return blocked;
        await save({ ...record, status: 'SIGNING' });
        let signed;
        try { signed = await step(() => wallet.signExactTransaction({ bytes: record.bytes, digest: record.digest, signer: intent.signer })); }
        catch (error) {
          if (error instanceof MakerV8DAppKitWalletError && error.code === 'MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED'
            && error.definitiveRejection === true && error.signedArtifactCreated === false) {
            await save({ ...record, status: 'PREPARED' }); return pending('SIGNATURE_REJECTED');
          }
          return pending('SIGNATURE_OUTCOME_UNKNOWN');
        }
        check(signed?.bytes === record.bytes && signed.digest === record.digest && signed.signer === intent.signer, 'SIGNATURE_DRIFT');
        const next = { ...record, status: 'SIGNED', signature: signed.signature }; await validate(next);
        await save(next);
      }
      blocked = await fresh(); if (blocked) return blocked;
      try { await step(() => client.executeTransaction({ transaction: bytes(record.bytes), signatures: [record.signature] })); }
      catch { return pending('OUTCOME_UNKNOWN'); }
      const result = await query();
      if (result !== 'FINALIZED_SUCCESS') return pending(result === 'FINALIZED_FAILURE' ? 'TRANSACTION_FAILED' : 'OUTCOME_UNKNOWN');
      snapshot = await read();
      return snapshot.missing.length ? pending('READBACK_PENDING') : Object.freeze({ status: 'COMPLETE' });
    });
  } });
}
