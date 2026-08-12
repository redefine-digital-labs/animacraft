import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress, SUI_TYPE_ARG } from '@mysten/sui/utils';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { WalrusFile, walrus } from '@mysten/walrus';
import { waitForCertifiedWalrusBlobObject } from '../../walrus-certification.js';

import { materializeExpansionPackPublicationCandidate } from '../../expansion-pack-publication-recovery.js';
import {
  readExpansionPackV8Submission,
  transactionFromExpansionPackV8PublicationAction,
  verifyExpansionPackV8ParentAction,
} from '../../expansion-pack-publication-v8-app.js';
import {
  assertWalrusCheckpoint,
  candidateFileBytes,
  sha256,
  stableJson,
} from './expansion-pack-v8-pack-ceremony.mjs';

const execFileAsync = promisify(execFile);
function text(value) { return String(value ?? '').trim(); }
function stable(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined)
    .sort().map((key) => [key, stable(value[key])]));
}
function fail(message, code = 'PACK_CEREMONY_ADAPTER_FAILED', details = {}) {
  const error = new Error(message); error.code = code; error.details = details; throw error;
}
function result(value) { return value?.Transaction || value?.transaction || value; }
function exactId(value) { return normalizeSuiAddress(text(value)); }
function simulation(value) {
  const tx = result(value);
  const effectsStatus = tx?.effects?.status;
  const success = effectsStatus?.success === true && effectsStatus?.error == null
    || text(effectsStatus?.status || effectsStatus || tx?.status).toLowerCase() === 'success';
  if (!tx || value?.FailedTransaction || value?.$kind === 'FailedTransaction'
    || !success) {
    fail('Transaction simulation failed.', 'PACK_CEREMONY_SIMULATION_FAILED', { value: stable(value) });
  }
  return stable({ success, digest: tx.digest, effects: tx.effects,
    events: tx.events, objectTypes: tx.objectTypes, commandResults: tx.commandResults });
}

async function runtimeFor(state) {
  const publicSource = await readFile(`${state.repoRoot}/public/config.js`, 'utf8');
  const field = (name) => text(publicSource.match(new RegExp(`${name}:\\s*['\"]([^'\"]+)['\"]`))?.[1]);
  return {
    grpcUrl: state.plan.context.grpcUrl || field('grpcUrl'),
    walrusAggregatorUrl: state.plan.context.walrusAggregatorUrl || field('walrusAggregatorUrl'),
    walrusUploadRelayUrl: state.plan.context.walrusUploadRelayUrl || field('walrusUploadRelayUrl'),
    expansionPackV8ReleaseEnabled: true,
    ...state.plan.context,
  };
}
async function clientFor(state) {
  const runtime = await runtimeFor(state);
  return { runtime, client: new SuiGrpcClient({ network: 'mainnet', baseUrl: runtime.grpcUrl }) };
}

function exactGas(transaction, action, options) {
  const gasPrice = text(options.gasPrice);
  const gasBudget = text(options.gasBudget);
  const minEpoch = text(options.minEpoch);
  const maxEpoch = text(options.maxEpoch);
  const chain = text(options.chain);
  const nonce = Number(options.nonce);
  if (!/^\d+$/.test(gasPrice) || !/^\d+$/.test(gasBudget)
    || !/^\d+$/.test(minEpoch) || !/^\d+$/.test(maxEpoch) || !chain
    || !Number.isSafeInteger(nonce) || nonce < 0) {
    fail('Sui lock requires --gas-price/--gas-budget/--min-epoch/--max-epoch/--chain/--nonce.',
      'PACK_CEREMONY_GAS_OPTIONS_MISSING');
  }
  transaction.setSender(exactId(action.authority.signer));
  transaction.setGasOwner(exactId(action.authority.signer));
  transaction.setGasPrice(gasPrice);
  transaction.setGasBudget(gasBudget);
  transaction.setGasPayment([]);
  transaction.setExpiration({ ValidDuring: { minEpoch, maxEpoch,
    minTimestamp: null, maxTimestamp: null, chain, nonce } });
}

async function suiLock({ action, options, state }) {
  const { client } = await clientFor(state);
  const [chain, system, balance] = await Promise.all([
    client.core.getChainIdentifier(), client.core.getCurrentSystemState(),
    client.core.getBalance({ owner: action.authority.signer }),
  ]);
  if (text(chain.chainIdentifier) !== text(options.chain)) fail('Mainnet chain identifier drifted.');
  if (text(system.systemState.referenceGasPrice) !== text(options.gasPrice)) fail('Reference gas price drifted.');
  const epoch = BigInt(system.systemState.epoch);
  if (epoch < BigInt(options.minEpoch) || epoch > BigInt(options.maxEpoch)) fail('ValidDuring epoch is not current.');
  if (balance.balance.addressBalance == null
    || BigInt(balance.balance.addressBalance) < BigInt(options.gasBudget)) {
    fail('Address Balance evidence cannot cover gas budget.');
  }
  const transaction = transactionFromExpansionPackV8PublicationAction(action);
  exactGas(transaction, action, options);
  const bytes = await transaction.build({ client });
  if (!transaction.isFullyResolved()) fail('Sui transaction is not fully resolved.');
  const data = stable(transaction.getData());
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const simulated = await client.core.simulateTransaction({ transaction: bytes, checksEnabled: true,
    include: { effects: true, events: true, objectTypes: true, commandResults: true } });
  return {
    gasMode: 'address-balance', payment: [],
    addressBalance: stable(balance.balance), objects: stable(data.inputs || []),
    network: { chainIdentifier: text(chain.chainIdentifier), epoch: text(epoch),
      referenceGasPrice: text(system.systemState.referenceGasPrice) },
    transaction: { bytesBase64: Buffer.from(bytes).toString('base64'), bytesSha256: sha256(bytes),
      byteLength: bytes.byteLength, digest, data }, simulation: simulation(simulated),
  };
}

async function signerEntry(state) {
  const signer = state.plan.context.owner;
  const alias = state.readiness && JSON.parse(await readFile(state.readiness.path, 'utf8')).lock.signer.alias;
  const listed = JSON.parse((await execFileAsync('sui', ['keytool', 'list', '--json'], {
    cwd: state.repoRoot, maxBuffer: 10 * 1024 * 1024,
  })).stdout);
  const entry = listed.find((candidate) => candidate.alias === alias);
  if (!entry || exactId(entry.suiAddress) !== exactId(signer)) fail('Keystore alias/signer drifted.');
  return { alias, signer };
}

async function signSui({ state, lock }) {
  const { alias, signer } = await signerEntry(state);
  const { stdout } = await execFileAsync('sui', ['keytool', 'sign', '--address', alias,
    '--data', lock.transaction.bytesBase64, '--json'], { cwd: state.repoRoot, maxBuffer: 10 * 1024 * 1024 });
  const signed = JSON.parse(stdout);
  if (exactId(signed.suiAddress) !== exactId(signer)
    || text(signed.rawTxData) !== lock.transaction.bytesBase64
    || stableJson(signed.intent) !== stableJson({ scope: 0, version: 0, app_id: 0 })) {
    fail('Keytool returned a different signer, bytes, or intent.');
  }
  const signature = text(signed.suiSignature);
  if (!signature) fail('Keytool returned no serialized signature.');
  const bytes = Buffer.from(lock.transaction.bytesBase64, 'base64');
  await verifyTransactionSignature(bytes, signature, { address: signer });
  return { bytesBase64: lock.transaction.bytesBase64, signature,
    submission: { transactionDigest: lock.transaction.digest, digest: lock.transaction.digest,
      bytesBase64: lock.transaction.bytesBase64, bytesSha256: lock.transaction.bytesSha256,
      signature, signatureVerifiedLocally: true } };
}

async function querySui({ state, signed }) {
  const { client } = await clientFor(state);
  try {
    return await client.core.getTransaction({ digest: signed.submission.transactionDigest,
      include: { effects: true, events: true, objectTypes: true, balanceChanges: true } });
  } catch (error) {
    if (error?.code === 'NOT_FOUND' || error?.status === 404
      || error?.cause?.code === 'NOT_FOUND' || error?.cause?.status === 404
      || text(error?.message) === `Transaction ${signed.submission.transactionDigest} not found`) return null;
    throw error;
  }
}
async function broadcastSui({ state, signed }) {
  const { client } = await clientFor(state);
  return client.core.executeTransaction({ transaction: Buffer.from(signed.bytesBase64, 'base64'),
    signatures: [signed.signature], include: { effects: true, events: true, objectTypes: true, balanceChanges: true } });
}
async function waitSui({ state, signed, indexed }) {
  const { client } = await clientFor(state);
  return client.core.waitForTransaction({ result: indexed, digest: signed.submission.transactionDigest,
    timeout: 60_000, include: { effects: true, events: true, objectTypes: true, balanceChanges: true } });
}
function assertSuccessfulFinality(value, expectedDigest, label) {
  const tx = result(value);
  const digest = text(tx?.digest || tx?.transaction?.digest || tx?.effects?.transactionDigest);
  const effectsStatus = tx?.effects?.status;
  const success = effectsStatus?.success === true && effectsStatus?.error == null
    || text(effectsStatus?.status || effectsStatus || tx?.status).toLowerCase() === 'success';
  if (digest !== expectedDigest || !success) {
    fail(`${label} did not finalize with the exact successful digest.`, 'PACK_CEREMONY_FINALITY_FAILED',
      { expectedDigest, digest, success });
  }
  return value;
}
async function readbackSui({ action, state, signed, finalized }) {
  assertSuccessfulFinality(finalized, signed.submission.transactionDigest, action.id);
  const { client, runtime } = await clientFor(state);
  return readExpansionPackV8Submission({ action,
    submission: { transactionDigest: signed.submission.transactionDigest, indexed: finalized },
    suiClient: client.core, runtime });
}

async function filesAndFlow(state, quoteMax = null, resume = undefined) {
  const { client, runtime } = await clientFor(state);
  const readiness = JSON.parse(await readFile(state.readiness.path, 'utf8'));
  const exact = await candidateFileBytes(state, readiness, state.repoRoot);
  const files = exact.map((entry) => WalrusFile.from({ contents: entry.bytes,
    identifier: entry.identifier, tags: { 'content-type': entry.mediaType, 'animacraft-kind': entry.kind } }));
  const relay = quoteMax == null ? Number.MAX_SAFE_INTEGER : Number(quoteMax);
  const extended = client.$extend(walrus({ uploadRelay: { host: runtime.walrusUploadRelayUrl,
    sendTip: { max: relay } } }));
  const flow = extended.walrus.writeFilesFlow({ files, ...(resume ? { resume } : {}) });
  return { client, runtime, extended, flow, exact };
}

function sameCheckpoint(actual, expected, label) {
  for (const key of ['step', 'blobId', 'rootHash', 'unencodedSize', 'nonce']) {
    if (stableJson(actual?.[key]) !== stableJson(expected?.[key])) {
      fail(`${label} encoding checkpoint drifted at ${key}.`, 'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
    }
  }
}

function sameEncodingIdentity(actual, expected, label) {
  for (const key of ['blobId', 'rootHash', 'unencodedSize', 'nonce']) {
    if (stableJson(actual?.[key]) !== stableJson(expected?.[key])) {
      fail(`${label} encoding identity drifted at ${key}.`, 'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
    }
  }
}

async function encodeWithIndex(extended, exact) {
  return extended.walrus.encodeQuilt({ blobs: exact.map(({ bytes, identifier, mediaType, kind }) => ({
    contents: bytes, identifier, tags: { 'content-type': mediaType, 'animacraft-kind': kind },
  })) });
}

export function encodeCeremonyQuiltPatchId(quiltId, patch) {
  // Equivalent to the SDK's internal encodeQuiltPatchId, using its public BCS dependency.
  return import('@mysten/bcs').then(({ bcs, toBase64 }) => {
    const bytes = bcs.struct('QuiltPatchId', { quiltId: bcs.u256(), patchId: bcs.struct('Patch', {
      version: bcs.u8(), startIndex: bcs.u16(), endIndex: bcs.u16(),
    }) }).serialize({ quiltId: BigInt(bcs.u256().fromBase64(quiltId.replaceAll('-', '+').replaceAll('_', '/'))),
      patchId: { version: 1, startIndex: patch.startIndex, endIndex: patch.endIndex } }).toBytes();
    return toBase64(bytes).replace(/=*$/, '').replaceAll('+', '-').replaceAll('/', '_');
  });
}

async function balances(client, owner) {
  const rows = []; let cursor = null;
  do {
    const page = await client.core.listBalances({ owner, cursor, limit: 200 });
    rows.push(...(page.balances || [])); cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return stable(rows);
}

async function transactionEvidence(transaction, action, options, client, extraMist = '0') {
  exactGas(transaction, action, options);
  const balance = await client.core.getBalance({ owner: action.authority.signer });
  const required = BigInt(options.gasBudget) + BigInt(extraMist);
  if (balance.balance.addressBalance == null || BigInt(balance.balance.addressBalance) < required) {
    fail('Address Balance evidence cannot cover exact gas budget plus relay tip.', 'PACK_CEREMONY_GAS_INVALID');
  }
  const bytes = await transaction.build({ client });
  if (!transaction.isFullyResolved()) fail('Walrus Sui transaction is not fully resolved.');
  const simulated = await client.core.simulateTransaction({ transaction: bytes, checksEnabled: true,
    include: { effects: true, events: true, objectTypes: true, commandResults: true } });
  return { gasMode: 'address-balance', payment: [], addressBalance: stable(balance.balance),
    requiredAddressBalanceMist: text(required), objects: stable(transaction.getData().inputs || []),
    transaction: { bytesBase64: Buffer.from(bytes).toString('base64'), bytesSha256: sha256(bytes),
      byteLength: bytes.byteLength, digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      data: stable(transaction.getData()) }, simulation: simulation(simulated) };
}

async function walrusLock({ action, state, options }) {
  const readiness = JSON.parse(await readFile(state.readiness.path, 'utf8'));
  const prepared = state.walrus['walrus.pack.prepare'];
  const isPrepare = action.id === 'walrus.pack.prepare';
  const base = await filesAndFlow(state, isPrepare ? null : prepared?.quote?.relayTipMist,
    isPrepare ? readiness.lock.walrus.checkpoint : prepared?.checkpoint);
  const encoded = await base.flow.encode();
  sameCheckpoint(encoded, isPrepare ? readiness.lock.walrus.checkpoint : prepared?.checkpoint,
    isPrepare ? 'Readiness' : 'Persisted prepare');
  if (encoded.blobId !== readiness.lock.walrus.quiltBlobId) fail('Walrus Quilt ID differs from readiness.');
  let tip = prepared?.quote?.relayTipMist; let costs = prepared?.quote; let wallet = [];
  if (isPrepare) {
    [tip, costs, wallet] = await Promise.all([
      base.extended.walrus.calculateUploadRelayTip({ size: encoded.unencodedSize }),
      base.extended.walrus.storageCost(encoded.unencodedSize, readiness.lock.walrus.quote.epochs),
      balances(base.client, state.plan.context.owner),
    ]);
  }
  if (isPrepare && BigInt(tip) > BigInt(readiness.lock.pack.intent?.walrusRelayTipCapMist
      || readiness.lock.walrus.quote.relayTipCapMist || '100000000')) {
    fail('Fresh Walrus relay quote exceeds the reviewed cap.');
  }
  const expectedWalType = text(readiness.lock.walrus.quote.walCoinType);
  const balanceByType = new Map(wallet.map((entry) => [normalizeStructTag(text(entry.coinType)), BigInt(entry.balance)]));
  if (isPrepare && expectedWalType
    && (balanceByType.get(normalizeStructTag(expectedWalType)) || 0n) < BigInt(costs.totalCost)) {
    fail('Fresh wallet WAL balance cannot cover the exact Quilt cost.');
  }
  const sui = wallet.find((entry) => normalizeStructTag(text(entry.coinType)) === normalizeStructTag(SUI_TYPE_ARG));
  if (isPrepare && BigInt(sui?.balance || 0) < BigInt(tip)) fail('Fresh wallet SUI balance cannot cover relay tip before gas.');
  let transaction = {};
  if (action.id === 'walrus.pack.register-upload') {
    transaction = await transactionEvidence(base.flow.register({
      epochs: readiness.lock.walrus.quote.epochs, owner: state.plan.context.owner, deletable: false,
    }), action, options, base.client, prepared.quote.relayTipMist);
  } else if (action.id === 'walrus.pack.certify') {
    const uploaded = assertWalrusCheckpoint(state.walrus['walrus.pack.register-upload'], 'uploaded');
    transaction = await transactionEvidence(base.extended.walrus.certifyBlobTransaction({
      blobId: uploaded.quiltBlobId, blobObjectId: uploaded.blobObjectId,
      certificate: uploaded.certificate, deletable: false,
    }), action, options, base.client);
  }
  return { fileCount: 2, files: base.exact.map(({ bytes, ...entry }) => ({ ...entry,
    byteLength: bytes.byteLength, sha256: sha256(bytes) })), quiltBlobId: encoded.blobId,
    checkpoint: stable(encoded), quote: isPrepare ? { relayTipMist: text(tip), storageCostFrost: text(costs.storageCost),
      writeCostFrost: text(costs.writeCost), totalCostFrost: text(costs.totalCost) } : stable(prepared.quote),
    balances: isPrepare ? wallet : [],
    actionKind: action.id, ...transaction };
}

async function executeLocal({ action, state }) {
  const { client, runtime } = await clientFor(state);
  if (action.id === 'parent.release.verify') return verifyExpansionPackV8ParentAction({ action,
    suiClient: client.core, runtime, async manifestReadback() {
      const readiness = JSON.parse(await readFile(state.readiness.path, 'utf8'));
      const url = `${runtime.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-id/${action.inputs.parentManifestBlobId}/${readiness.lock.parent.manifestIdentifier}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) fail(`Parent manifest readback returned HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== action.inputs.parentManifestSha256) fail('Parent manifest bytes drifted.');
      return { sha256: action.inputs.parentManifestSha256, version: action.inputs.parentVersion,
        versionId: action.inputs.parentVersionId, identity: action.inputs.parentIdentity,
        readinessFingerprint: readiness.lockFingerprintSha256 };
    } });
  if (action.id === 'local.pack.materialize') return materializeExpansionPackPublicationCandidate({
    candidate: state.plan.candidate && JSON.parse(await readFile(state.readiness.path, 'utf8')).lock.pack.candidate,
    context: state.plan.context, runtime, releaseId: action.inputs.packReleaseId,
  });
  fail(`Unsupported local/readback action ${action.id}.`);
}

async function signAndPersistWalrusTransaction({ action, state, checkpoint, kind, lock }) {
  const existing = state.walrus[action.id];
  let signed = existing?.pendingTransaction ? {
    bytesBase64: existing.pendingTransaction.bytesBase64,
    signature: existing.pendingTransaction.signature,
    submission: existing.pendingTransaction,
  } : null;
  if (!signed) signed = await signSui({ state, lock });
  const signedBytes = Buffer.from(text(signed.bytesBase64), 'base64');
  if (text(signed.bytesBase64) !== lock.transaction.bytesBase64
    || text(signed.submission?.bytesBase64) !== lock.transaction.bytesBase64
    || sha256(signedBytes) !== lock.transaction.bytesSha256
    || text(signed.submission?.bytesSha256) !== lock.transaction.bytesSha256
    || TransactionDataBuilder.getDigestFromBytes(signedBytes) !== lock.transaction.digest
    || text(signed.submission?.transactionDigest) !== lock.transaction.digest
    || text(signed.signature) !== text(signed.submission?.signature)) {
    fail('Persisted Walrus signature envelope drifted from its exact lock.',
      'PACK_CEREMONY_SIGNED_BYTES_MISMATCH');
  }
  await verifyTransactionSignature(signedBytes, signed.signature, { address: state.plan.context.owner });
  const digest = signed.submission.transactionDigest;
  // Critical boundary: the callback atomically persists signed bytes before any query/broadcast.
  if (!existing?.pendingTransaction) await checkpoint({ ...assertWalrusCheckpoint({ uploadSessionId: action.inputs.uploadSessionId || `walrus-${digest}`,
    quiltBlobId: action.inputs.quiltBlobId, stage: kind === 'register' ? 'encoded' : 'uploaded',
    ...(kind === 'certify' ? state.walrus['walrus.pack.register-upload'] : {}),
    pendingTransaction: signed.submission, pendingKind: kind }, kind === 'register' ? 'encoded' : 'uploaded'),
    signedPersisted: true });
  let indexed = await querySui({ state, signed });
  if (!indexed) indexed = await broadcastSui({ state, signed });
  const finalized = await waitSui({ state, signed, indexed });
  assertSuccessfulFinality(finalized, digest, `Walrus ${kind}`);
  return { digest, signed };
}

async function executeWalrus({ action, state, checkpoint }) {
  const locked = state.locks[action.id].lock;
  const sessionId = action.inputs.uploadSessionId || `walrus-${locked.quiltBlobId}`;
  if (action.id === 'walrus.pack.prepare') {
    const existing = state.walrus[action.id];
    if (existing?.stage === 'encoded') {
      return { submission: { actionId: action.id, local: true }, confirmation: {
        uploadSessionId: existing.uploadSessionId, quiltBlobId: existing.quiltBlobId,
        walrusRecovery: existing } };
    }
    const progress = assertWalrusCheckpoint({ stage: 'encoded', uploadSessionId: sessionId,
      quiltBlobId: locked.quiltBlobId, checkpoint: locked.checkpoint, quote: locked.quote,
      files: locked.files }, 'encoded');
    await checkpoint(progress);
    const confirmation = { uploadSessionId: sessionId, quiltBlobId: locked.quiltBlobId,
      walrusRecovery: progress };
    return { submission: { actionId: action.id, local: true }, confirmation };
  }
  const resumeCheckpoint = action.id === 'walrus.pack.certify'
    ? state.walrus['walrus.pack.register-upload']?.checkpoint
    : locked.checkpoint;
  const flowData = await filesAndFlow(state, locked.quote.relayTipMist, resumeCheckpoint);
  const flow = flowData.flow;
  const resumedEncoding = await flow.encode();
  sameCheckpoint(resumedEncoding, locked.checkpoint, action.id);
  if (action.id === 'walrus.pack.register-upload') {
    const existing = state.walrus[action.id];
    if (existing?.stage === 'uploaded') return { submission: { registerDigest: existing.registerDigest },
      confirmation: { uploadSessionId: existing.uploadSessionId, quiltBlobId: existing.quiltBlobId,
        blobObjectId: existing.blobObjectId, registerDigest: existing.registerDigest,
        uploaded: true, walrusRecovery: existing } };
    const registered = await signAndPersistWalrusTransaction({ action, state, checkpoint,
      kind: 'register', lock: locked });
    const uploaded = await flow.upload({ digest: registered.digest });
    const progress = assertWalrusCheckpoint({ stage: 'uploaded', uploadSessionId: sessionId,
      quiltBlobId: locked.quiltBlobId, blobObjectId: uploaded.blobObjectId,
      certificate: uploaded.certificate, registerDigest: registered.digest,
      checkpoint: { ...stable(locked.checkpoint), ...stable(uploaded), step: 'uploaded' } }, 'uploaded');
    await checkpoint(progress);
    return { submission: { registerDigest: registered.digest }, confirmation: {
      uploadSessionId: sessionId, quiltBlobId: locked.quiltBlobId,
      blobObjectId: uploaded.blobObjectId, registerDigest: registered.digest,
      uploaded: true, walrusRecovery: progress } };
  }
  if (action.id === 'walrus.pack.certify') {
    const existing = state.walrus[action.id];
    if (existing?.stage === 'certified') {
      const manifestIdentifier = action.inputs.manifestIdentifier;
      const registryRows = action.inputs.styles.map((style) => ({ partKey: style.partKey,
        itemKey: style.itemKey, styleKey: style.styleKey,
        assetBlobId: existing.filePatchIds[style.assetIdentifier], assetSha256: style.assetSha256,
        assetSealId: style.assetSealId }));
      return { submission: { certifyDigest: existing.certifyDigest }, confirmation: {
        uploadSessionId: existing.uploadSessionId, quiltBlobId: existing.quiltBlobId,
        blobObjectId: existing.blobObjectId, certifyDigest: existing.certifyDigest,
        certified: true, certificationVisible: true,
        manifestQuiltPatchId: existing.filePatchIds[manifestIdentifier], manifestIdentifier,
        manifestSha256: action.inputs.manifestSha256, filePatchIds: existing.filePatchIds,
        styleRegistryCommitment: sha256(stableJson(registryRows)), walrusRecovery: existing } };
    }
    const uploaded = assertWalrusCheckpoint(state.walrus['walrus.pack.register-upload'], 'uploaded');
    const certifiedTx = await signAndPersistWalrusTransaction({ action, state, checkpoint,
      kind: 'certify', lock: locked });
    await waitForCertifiedWalrusBlobObject(flowData.extended, uploaded.blobObjectId, {
      certifyDigest: certifiedTx.digest, expectedBlobId: uploaded.quiltBlobId,
    });
    const readiness = JSON.parse(await readFile(state.readiness.path, 'utf8'));
    const { index } = await encodeWithIndex(flowData.extended, flowData.exact);
    if (index.patches.length !== readiness.lock.walrus.files.length) fail('Walrus Quilt index count drifted.');
    const patches = new Map(index.patches.map((patch) => [patch.identifier, patch]));
    const patchIds = Object.fromEntries(await Promise.all(readiness.lock.walrus.files.map(async (descriptor) => {
      const patch = patches.get(descriptor.identifier);
      if (!patch) fail(`Walrus Quilt index is missing ${descriptor.identifier}.`);
      return [descriptor.identifier, await encodeCeremonyQuiltPatchId(uploaded.quiltBlobId, patch)];
    })));
    const readbacks = [];
    for (const descriptor of readiness.lock.walrus.files) {
      const url = `${flowData.runtime.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-patch-id/${patchIds[descriptor.identifier]}`;
      let bytes = null; let lastStatus = 0;
      for (const delayMs of [0, 500, 1_000, 2_000, 4_000]) {
        if (delayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
        const response = await fetch(url, { cache: 'no-store' }); lastStatus = response.status;
        if (response.ok) { bytes = Buffer.from(await response.arrayBuffer()); break; }
        if (![404, 408, 425, 429, 500, 502, 503, 504].includes(response.status)) break;
      }
      const expected = flowData.exact.find((entry) => entry.identifier === descriptor.identifier)?.bytes;
      if (!bytes || !expected || bytes.byteLength !== descriptor.byteLength
        || bytes.byteLength !== expected.byteLength || !bytes.equals(Buffer.from(expected))
        || sha256(bytes) !== descriptor.sha256) {
        fail(`Walrus exact file readback failed for ${descriptor.identifier}.`,
          'PACK_CEREMONY_WALRUS_READBACK_FAILED', { status: lastStatus });
      }
      readbacks.push({ identifier: descriptor.identifier, patchId: patchIds[descriptor.identifier],
        byteLength: bytes.byteLength, sha256: sha256(bytes) });
    }
    const progress = assertWalrusCheckpoint({ stage: 'certified', uploadSessionId: sessionId,
      quiltBlobId: uploaded.quiltBlobId, blobObjectId: uploaded.blobObjectId,
      certifyDigest: certifiedTx.digest, filePatchIds: patchIds,
      certificationVisible: true, fileReadbacksVerified: true, readbacks }, 'certified');
    await checkpoint(progress);
    const manifestIdentifier = action.inputs.manifestIdentifier;
    const registryRows = action.inputs.styles.map((style) => ({ partKey: style.partKey,
      itemKey: style.itemKey, styleKey: style.styleKey,
      assetBlobId: patchIds[style.assetIdentifier], assetSha256: style.assetSha256,
      assetSealId: style.assetSealId }));
    return { submission: { certifyDigest: certifiedTx.digest }, confirmation: {
      uploadSessionId: sessionId, quiltBlobId: uploaded.quiltBlobId,
      blobObjectId: uploaded.blobObjectId, certifyDigest: certifiedTx.digest,
      certified: true, certificationVisible: true,
      manifestQuiltPatchId: patchIds[manifestIdentifier], manifestIdentifier,
      manifestSha256: action.inputs.manifestSha256, filePatchIds: patchIds,
      styleRegistryCommitment: sha256(stableJson(registryRows)), walrusRecovery: progress } };
  }
  fail(`Unsupported Walrus action ${action.id}.`);
}

function certifiedConfirmation(action, progress) {
  const manifestIdentifier = action.inputs.manifestIdentifier;
  const registryRows = action.inputs.styles.map((style) => ({ partKey: style.partKey,
    itemKey: style.itemKey, styleKey: style.styleKey,
    assetBlobId: progress.filePatchIds[style.assetIdentifier], assetSha256: style.assetSha256,
    assetSealId: style.assetSealId }));
  return { uploadSessionId: progress.uploadSessionId, quiltBlobId: progress.quiltBlobId,
    blobObjectId: progress.blobObjectId, certifyDigest: progress.certifyDigest,
    certified: true, certificationVisible: true,
    manifestQuiltPatchId: progress.filePatchIds[manifestIdentifier], manifestIdentifier,
    manifestSha256: action.inputs.manifestSha256, filePatchIds: progress.filePatchIds,
    styleRegistryCommitment: sha256(stableJson(registryRows)), walrusRecovery: progress };
}

export async function recoverWalrusFromCheckpoint({ action, state, progress }) {
  const lock = state.locks?.[action.id]?.lock;
  if (!lock || progress?.quiltBlobId !== lock.quiltBlobId) {
    fail('Walrus terminal checkpoint differs from the exact action lock.',
      'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
  }
  const expectedStage = action.id === 'walrus.pack.prepare' ? 'encoded'
    : action.id === 'walrus.pack.register-upload' ? 'uploaded'
      : action.id === 'walrus.pack.certify' ? 'certified' : '';
  assertWalrusCheckpoint(progress, expectedStage);
  const checkpoint = progress.checkpoint || lock.checkpoint;
  if (expectedStage === 'encoded') sameCheckpoint(checkpoint, lock.checkpoint, action.id);
  else {
    if (checkpoint.step !== 'uploaded') fail('Walrus uploaded checkpoint has the wrong SDK step.',
      'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
    sameEncodingIdentity(checkpoint, lock.checkpoint, action.id);
  }
  if (expectedStage === 'encoded') return { confirmation: { uploadSessionId: progress.uploadSessionId,
    quiltBlobId: progress.quiltBlobId, walrusRecovery: progress } };
  if (expectedStage === 'uploaded') {
    if (text(progress.registerDigest) !== text(state.recovery.actions[state.recovery.currentActionIndex]
      ?.submission?.registerDigest)) fail('Walrus register digest drifted from the submitted recovery state.',
      'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
    return { confirmation: { uploadSessionId: progress.uploadSessionId,
      quiltBlobId: progress.quiltBlobId, blobObjectId: progress.blobObjectId,
      registerDigest: progress.registerDigest, uploaded: true, walrusRecovery: progress } };
  }
  if (text(progress.certifyDigest) !== text(state.recovery.actions[state.recovery.currentActionIndex]
    ?.submission?.certifyDigest)) fail('Walrus certify digest drifted from the submitted recovery state.',
    'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
  const readiness = JSON.parse(await readFile(state.readiness.path, 'utf8'));
  if (progress.readbacks?.length !== readiness.lock.walrus.files.length) {
    fail('Walrus certified checkpoint is missing exact readbacks.', 'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
  }
  for (const descriptor of readiness.lock.walrus.files) {
    const readback = progress.readbacks.find((entry) => entry.identifier === descriptor.identifier);
    if (!readback || readback.patchId !== progress.filePatchIds[descriptor.identifier]
      || readback.sha256 !== descriptor.sha256 || readback.byteLength !== descriptor.byteLength) {
      fail(`Walrus certified readback drifted for ${descriptor.identifier}.`,
        'PACK_CEREMONY_WALRUS_CHECKPOINT_DRIFT');
    }
  }
  return { confirmation: certifiedConfirmation(action, progress) };
}

export function createDefaultCeremonyAdapters() {
  return { lockSui: suiLock, lockWalrus: walrusLock,
    lockLocal: async ({ action }) => ({ kind: action.transport, actionId: action.id }),
    rebuild: async ({ action, options, state }) => (
      action.transport === 'SUI' ? suiLock({ action, options, state })
        : action.transport === 'WALRUS' ? walrusLock({ action, options, state })
          : { kind: action.transport, actionId: action.id }),
    executeLocal, signSui,
    verifySigned: async ({ state, lock, signed }) => verifyTransactionSignature(
      Buffer.from(lock.transaction.bytesBase64, 'base64'), signed.signature,
      { address: state.plan.context.owner }),
    querySui, broadcastSui, waitSui, readbackSui,
    executeWalrus, recoverWalrus: recoverWalrusFromCheckpoint,
  };
}
