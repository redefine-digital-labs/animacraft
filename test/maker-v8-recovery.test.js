import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_RECOVERY_ERROR,
  MAKER_V8_RECOVERY_ERROR_LAYER,
  MAKER_V8_RECOVERY_STATE,
  MakerV8RecoveryError,
  canonicalMakerV8RecoveryIdentity,
  createMakerV8RecoveryController,
  createMakerV8RecoveryMemoryAdapter,
  makerV8RecoveryIdentityKey,
  makerV8RecoveryScopeKey,
} from '../maker-v8-recovery.js';

function id(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function objectRef(value, version = 1, digest = `obj-${value}`) {
  return { id: id(value), version, digest };
}

function identity(overrides = {}) {
  return {
    chain: 'SUI:MAINNET',
    wallet: id(1),
    lane: 'market-maker',
    action: 'purchase',
    packageTuple: [
      {
        role: 'MARKET',
        originalPackageId: id(102),
        callablePackageId: id(202),
        packageDigest: 'market-package-digest',
        abiCommitment: 'market-abi',
      },
      {
        role: 'CORE',
        originalPackageId: id(101),
        callablePackageId: id(201),
        packageDigest: 'core-package-digest',
        abiCommitment: 'core-abi',
      },
    ],
    paymentCoin: `${id(300)}::usdc::USDC`,
    listing: objectRef(10),
    root: objectRef(11),
    registry: objectRef(12),
    treasury: objectRef(13),
    rootContentCommitment: 'root-content-1',
    protocolRevision: 7,
    listingRevision: 4,
    quoteCommitment: 'quote-1',
    authority: {
      kind: 'seller-cap',
      ref: objectRef(14),
      seller: id(1),
    },
    ...overrides,
  };
}

function digestFor(bytes) {
  return `digest:${bytes}`;
}

function plan(identityValue, bytes = 'base64-transaction-A', overrides = {}) {
  return {
    transactionBytes: bytes,
    transactionDigest: digestFor(bytes),
    stage: 'MARKET_PURCHASE',
    sequence: 9,
    signer: identityValue.wallet,
    epochWindow: { start: 100, end: 105 },
    gas: {
      budget: '50000000',
      price: '1000',
      payment: [objectRef(90)],
    },
    sourceSnapshot: {
      sourceCommit: 'source-commit-1',
      sourceTree: 'source-tree-1',
      quote: 'quote-1',
    },
    ...overrides,
  };
}

function signatureFor({ bytes, digest, signer }) {
  return `signature:${bytes}:${digest}:${signer}`;
}

function forwardingAdapter(base, compareAndSwap) {
  return {
    load: (...args) => base.load(...args),
    compareAndSwap: compareAndSwap || ((...args) => base.compareAndSwap(...args)),
    loadReceipt: (...args) => base.loadReceipt(...args),
    loadFinalizedFailure: (...args) => base.loadFinalizedFailure(...args),
    listFinalizedFailures: (...args) => base.listFinalizedFailures(...args),
  };
}

function harness({
  identityValue = identity(),
  persist = createMakerV8RecoveryMemoryAdapter(),
  sessionId = 'session-alpha-0001',
  clockState = { value: 1_000 },
  sign,
  query,
  broadcast,
  readback,
  verifySignature,
} = {}) {
  const calls = [];
  let currentIdentity = identityValue;
  const controller = createMakerV8RecoveryController({
    persist,
    sessionId,
    clock: () => clockState.value++,
    deriveTransactionDigest: async (bytes) => digestFor(bytes),
    verifySignature: verifySignature || (async ({ bytes, signature, digest, signer }) => ({
      verified: signature === signatureFor({ bytes, digest, signer }),
      bytes,
      digest,
      signer,
    })),
    getContext: async () => {
      calls.push({ kind: 'context' });
      return currentIdentity;
    },
    sign: sign || (async (request) => {
      calls.push({ kind: 'sign', request });
      return {
        bytes: request.bytes,
        signature: signatureFor(request),
        digest: request.digest,
        signer: request.signer,
      };
    }),
    query: query || (async (request) => {
      calls.push({ kind: 'query', request });
      return { status: 'NOT_FOUND' };
    }),
    broadcast: broadcast || (async (request) => {
      calls.push({ kind: 'broadcast', request });
      return { digest: request.digest, accepted: true };
    }),
    readback: readback || (async (request) => {
      calls.push({ kind: 'readback', request });
      return {
        verified: true,
        digest: request.digest,
        identity: request.identity,
        checkpoint: request.outcome.checkpoint,
        evidence: { event: 'exact-event', objectReadback: true },
      };
    }),
  });
  return {
    controller,
    persist,
    calls,
    clockState,
    setContext(next) { currentIdentity = next; },
  };
}

async function prepareAndSign(setup, identityValue = identity(), bytes = 'base64-transaction-A') {
  await setup.controller.prepare(identityValue, plan(identityValue, bytes));
  return setup.controller.requestSignature(identityValue);
}

function errorIs(code, layer) {
  return (error) => error instanceof MakerV8RecoveryError
    && error.code === code
    && (layer === undefined || error.layer === layer);
}

test('canonical identity binds every immutable v8 transaction authority input', () => {
  const raw = identity();
  const canonical = canonicalMakerV8RecoveryIdentity(raw);
  const reordered = identity({ packageTuple: [...raw.packageTuple].reverse() });

  assert.equal(canonical.chain, 'sui:mainnet');
  assert.equal(canonical.wallet, `0x${'0'.repeat(63)}1`);
  assert.deepEqual(canonical.packageTuple.map((entry) => entry.role), ['CORE', 'MARKET']);
  assert.equal(canonical.paymentCoin, `${id(300).replace('0x', `0x${'0'.repeat(61)}`)}::usdc::USDC`);
  assert.equal(canonical.listing.version, '1');
  assert.equal(canonical.protocolRevision, '7');
  assert.equal(canonical.authority.kind, 'SELLER-CAP');
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(Object.isFrozen(canonical.root), true);
  assert.equal(Object.isFrozen(canonical.authority.ref), true);
  assert.equal(makerV8RecoveryIdentityKey(raw), makerV8RecoveryIdentityKey(reordered));

  const changedQuote = identity({ quoteCommitment: 'quote-2' });
  assert.notEqual(makerV8RecoveryIdentityKey(raw), makerV8RecoveryIdentityKey(changedQuote));
  assert.equal(makerV8RecoveryScopeKey(raw), makerV8RecoveryScopeKey(changedQuote));
  assert.throws(
    () => canonicalMakerV8RecoveryIdentity({
      ...raw,
      listing: { ...raw.listing, mutableOwnerHint: id(99) },
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID),
  );
});

test('signed bytes are durably persisted before query/broadcast and replay is byte-identical', async () => {
  const base = createMakerV8RecoveryMemoryAdapter();
  const order = [];
  const persist = forwardingAdapter(base, async (...args) => {
    const next = args[2];
    order.push(`persist:${next?.state || 'CLEANUP'}`);
    return base.compareAndSwap(...args);
  });
  const idValue = identity();
  const setup = harness({
    identityValue: idValue,
    persist,
    query: async (request) => {
      order.push('query');
      setup.calls.push({ kind: 'query', request });
      return { status: 'NOT_FOUND' };
    },
    broadcast: async (request) => {
      order.push('broadcast');
      setup.calls.push({ kind: 'broadcast', request });
      return { digest: request.digest };
    },
  });

  const signed = await prepareAndSign(setup, idValue);
  assert.equal(signed.state, MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE);
  assert.deepEqual(signed.signed, {
    bytes: 'base64-transaction-A',
    signature: signatureFor({
      bytes: 'base64-transaction-A',
      digest: digestFor('base64-transaction-A'),
      signer: canonicalMakerV8RecoveryIdentity(idValue).wallet,
    }),
    digest: digestFor('base64-transaction-A'),
    signer: canonicalMakerV8RecoveryIdentity(idValue).wallet,
    signedAt: signed.signed.signedAt,
  });
  const pending = await setup.controller.broadcastSigned(idValue);
  assert.equal(pending.state, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING);
  const sent = setup.calls.find((entry) => entry.kind === 'broadcast').request;
  assert.equal(sent.bytes, signed.signed.bytes);
  assert.equal(sent.signature, signed.signed.signature);
  assert.equal(sent.digest, signed.signed.digest);
  assert.ok(order.indexOf('persist:SIGNED_DURABLE') < order.indexOf('query'));
  assert.ok(order.indexOf('query') < order.indexOf('persist:BROADCASTING'));
  assert.ok(order.indexOf('persist:BROADCASTING') < order.indexOf('broadcast'));
});

test('wallet-returned byte, digest, signer, and signature alterations fail before broadcast', async (t) => {
  const cases = [
    {
      name: 'bytes',
      mutate: (request) => ({ ...request, bytes: 'different-bytes', signature: signatureFor(request) }),
      code: MAKER_V8_RECOVERY_ERROR.SIGNED_BYTES_MISMATCH,
    },
    {
      name: 'digest',
      mutate: (request) => ({ ...request, digest: 'different-digest', signature: signatureFor(request) }),
      code: MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH,
    },
    {
      name: 'signer',
      mutate: (request) => ({ ...request, signer: id(999), signature: signatureFor(request) }),
      code: MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
    },
    {
      name: 'signature',
      mutate: (request) => ({ ...request, signature: 'forged-signature' }),
      code: MAKER_V8_RECOVERY_ERROR.SIGNATURE_INVALID,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let broadcasts = 0;
      const idValue = identity();
      const setup = harness({
        identityValue: idValue,
        sign: async (request) => entry.mutate(request),
        broadcast: async () => { broadcasts += 1; return { digest: 'never' }; },
      });
      await setup.controller.prepare(idValue, plan(idValue));
      await assert.rejects(setup.controller.requestSignature(idValue), errorIs(entry.code));
      assert.equal((await setup.controller.load(idValue)).state,
        MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE);
      assert.equal(broadcasts, 0);
    });
  }
});

test('CAS isolates signing sessions and stale writers never invoke a second wallet signature', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const idValue = identity();
  let releaseSignature;
  const signatureGate = new Promise((resolve) => { releaseSignature = resolve; });
  let aSignCalls = 0;
  let bSignCalls = 0;
  let aEntered;
  const aEnteredSignature = new Promise((resolve) => { aEntered = resolve; });
  const first = harness({
    identityValue: idValue,
    persist,
    sessionId: 'session-first-0001',
    sign: async (request) => {
      aSignCalls += 1;
      aEntered();
      await signatureGate;
      return { ...request, signature: signatureFor(request) };
    },
  });
  const second = harness({
    identityValue: idValue,
    persist,
    sessionId: 'session-second-0002',
    sign: async (request) => {
      bSignCalls += 1;
      return { ...request, signature: signatureFor(request) };
    },
  });

  await first.controller.prepare(idValue, plan(idValue));
  const signing = first.controller.requestSignature(idValue);
  await aEnteredSignature;
  await assert.rejects(
    second.controller.requestSignature(idValue),
    errorIs(MAKER_V8_RECOVERY_ERROR.SESSION_CONFLICT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY),
  );
  releaseSignature();
  assert.equal((await signing).state, MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE);
  assert.equal(aSignCalls, 1);
  assert.equal(bSignCalls, 0);

  const stale = await persist.load(makerV8RecoveryScopeKey(idValue));
  const winner = { ...stale, revision: stale.revision + 1 };
  await persist.compareAndSwap(stale.scopeKey, stale.revision, winner);
  await assert.rejects(
    persist.compareAndSwap(stale.scopeKey, stale.revision, winner),
    errorIs(MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY),
  );
});

test('recovery survives signing/broadcast crash points and delayed indexing after reload', async () => {
  const base = createMakerV8RecoveryMemoryAdapter();
  const idValue = identity();
  let failSignedPersist = true;
  let broadcastCalls = 0;
  const signedCrashPersist = forwardingAdapter(base, async (...args) => {
    if (failSignedPersist && args[2]?.state === MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE) {
      failSignedPersist = false;
      throw new Error('simulated crash before signed commit');
    }
    return base.compareAndSwap(...args);
  });
  const beforeDurable = harness({
    identityValue: idValue,
    persist: signedCrashPersist,
    broadcast: async () => { broadcastCalls += 1; return { digest: 'never' }; },
  });
  await beforeDurable.controller.prepare(idValue, plan(idValue));
  await assert.rejects(
    beforeDurable.controller.requestSignature(idValue),
    errorIs(MAKER_V8_RECOVERY_ERROR.STORAGE_FAILED,
      MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE),
  );
  assert.equal((await base.load(makerV8RecoveryScopeKey(idValue))).state,
    MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE);
  assert.equal(broadcastCalls, 0);

  const resumeSigning = harness({
    identityValue: idValue,
    persist: base,
    sessionId: 'session-alpha-0001',
  });
  await resumeSigning.controller.requestSignature(idValue);

  let failPostBroadcastPersist = true;
  const broadcastCrashPersist = forwardingAdapter(base, async (...args) => {
    if (failPostBroadcastPersist && args[2]?.state === MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING) {
      failPostBroadcastPersist = false;
      throw new Error('simulated crash after broadcast');
    }
    return base.compareAndSwap(...args);
  });
  const beforeOutcomePersist = harness({
    identityValue: idValue,
    persist: broadcastCrashPersist,
    sessionId: 'session-reload-0002',
    query: async () => ({ status: 'NOT_FOUND' }),
    broadcast: async (request) => {
      broadcastCalls += 1;
      return { digest: request.digest };
    },
  });
  await assert.rejects(
    beforeOutcomePersist.controller.broadcastSigned(idValue),
    errorIs(MAKER_V8_RECOVERY_ERROR.STORAGE_FAILED,
      MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE),
  );
  assert.equal((await base.load(makerV8RecoveryScopeKey(idValue))).state,
    MAKER_V8_RECOVERY_STATE.BROADCASTING);
  assert.equal(broadcastCalls, 1);

  let indexed = false;
  const afterReload = harness({
    identityValue: idValue,
    persist: base,
    sessionId: 'session-reload-0003',
    query: async (request) => ({
      status: 'FINALIZED_SUCCESS',
      digest: request.digest,
      checkpoint: 808,
    }),
    readback: async (request) => {
      if (!indexed) {
        const error = Object.assign(new Error('index lag'), {
          code: 'TRANSACTION_OUTCOME_PENDING',
        });
        throw error;
      }
      return {
        verified: true,
        digest: request.digest,
        identity: request.identity,
        checkpoint: 808,
        evidence: { indexed: true, event: 'purchase' },
      };
    },
  });
  await assert.rejects(
    afterReload.controller.recover(idValue, { replayIfNotFound: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.READBACK_PENDING,
      MAKER_V8_RECOVERY_ERROR_LAYER.READBACK),
  );
  assert.equal((await afterReload.controller.load(idValue)).state,
    MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING);
  assert.equal(broadcastCalls, 1, 'a finalized digest is never replayed during indexing lag');

  indexed = true;
  const verified = await afterReload.controller.recover(idValue, { replayIfNotFound: true });
  assert.equal(verified.state, MAKER_V8_RECOVERY_STATE.VERIFIED);
  assert.equal(verified.receipt.digest, digestFor('base64-transaction-A'));
});

test('digest query runs through wallet drift but replay is stopped before network broadcast', async () => {
  const idValue = identity();
  let queries = 0;
  let broadcasts = 0;
  const setup = harness({
    identityValue: idValue,
    query: async () => { queries += 1; return { status: 'NOT_FOUND' }; },
    broadcast: async () => { broadcasts += 1; return { digest: 'never' }; },
  });
  await prepareAndSign(setup, idValue);
  setup.setContext(identity({ wallet: id(77) }));

  await assert.rejects(
    setup.controller.recover(idValue, { replayIfNotFound: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT),
  );
  assert.equal(queries, 1);
  assert.equal(broadcasts, 0);
  assert.equal((await setup.controller.load(idValue)).state,
    MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE);

  const another = identity({ root: objectRef(111), listing: objectRef(110) });
  let signCalls = 0;
  const preSignDrift = harness({
    identityValue: another,
    sign: async () => { signCalls += 1; throw new Error('must not run'); },
  });
  await preSignDrift.controller.prepare(another, plan(another, 'context-drift-bytes'));
  preSignDrift.setContext(identity({
    root: objectRef(111),
    listing: objectRef(110),
    protocolRevision: 8,
  }));
  await assert.rejects(
    preSignDrift.controller.requestSignature(another),
    errorIs(MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT),
  );
  assert.equal(signCalls, 0);
});

test('definitive failure is atomically archived before a changed identity can start', async () => {
  const idValue = identity();
  const persist = createMakerV8RecoveryMemoryAdapter();
  let queries = 0;
  const setup = harness({
    identityValue: idValue,
    persist,
    query: async (request) => {
      queries += 1;
      return {
        status: 'FINALIZED_FAILURE',
        digest: request.digest,
        checkpoint: 909,
        error: { code: 'MoveAbort', message: 'listing revision changed' },
      };
    },
  });
  await prepareAndSign(setup, idValue);
  const failed = await setup.controller.recover(idValue);
  assert.equal(failed.state, MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE);
  assert.equal(failed.failure.finalized, true);
  const archived = await setup.controller.listFinalizedFailures(idValue);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].digest, failed.signed.digest);

  await assert.rejects(
    setup.controller.recover(idValue, { replayIfNotFound: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY,
      MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL),
  );
  assert.equal(queries, 1, 'terminal replay rejects before querying');
  await assert.rejects(
    setup.controller.prepare(idValue, plan(idValue, 'replacement-same-identity'), {
      afterFinalizedFailure: true,
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY),
  );

  const changed = identity({
    listing: objectRef(10, 2, 'listing-v2'),
    listingRevision: 5,
    quoteCommitment: 'quote-2',
  });
  const next = harness({
    identityValue: changed,
    persist,
    sessionId: 'session-next-0004',
  });
  const ready = await next.controller.prepare(
    changed,
    plan(changed, 'fresh-transaction-B', {
      sourceSnapshot: {
        sourceCommit: 'source-commit-1',
        sourceTree: 'source-tree-1',
        quote: 'quote-2',
      },
    }),
    { afterFinalizedFailure: true },
  );
  assert.equal(ready.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(ready.attempt, 2);
  assert.equal((await next.controller.listFinalizedFailures(changed)).length, 1);
  await assert.rejects(
    next.controller.prepare(idValue, plan(idValue), { afterFinalizedFailure: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY),
  );
});

test('forged readback cannot verify, and a terminal receipt precedes cleanup forever', async () => {
  const idValue = identity();
  const persist = createMakerV8RecoveryMemoryAdapter();
  let forged = true;
  let queryCalls = 0;
  const setup = harness({
    identityValue: idValue,
    persist,
    query: async (request) => {
      queryCalls += 1;
      return { status: 'FINALIZED_SUCCESS', digest: request.digest, checkpoint: 1_010 };
    },
    readback: async (request) => ({
      verified: true,
      digest: request.digest,
      identity: forged ? {
        ...request.identity,
        root: { ...request.identity.root, digest: 'forged-root-digest' },
      } : request.identity,
      checkpoint: 1_010,
      evidence: { event: 'purchase', exactObjects: true },
    }),
  });
  await prepareAndSign(setup, idValue);
  await assert.rejects(
    setup.controller.recover(idValue),
    errorIs(MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.READBACK),
  );
  assert.equal((await setup.controller.load(idValue)).state,
    MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING);
  assert.equal(await setup.controller.loadReceipt(idValue), null);

  forged = false;
  const verified = await setup.controller.recover(idValue);
  assert.equal(verified.state, MAKER_V8_RECOVERY_STATE.VERIFIED);
  assert.ok(verified.receipt);
  const queriesAtTerminal = queryCalls;
  await assert.rejects(
    setup.controller.recover(idValue, { replayIfNotFound: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED),
  );
  assert.equal(queryCalls, queriesAtTerminal);

  const receipt = await setup.controller.cleanupVerified(idValue);
  assert.equal(receipt.digest, digestFor('base64-transaction-A'));
  assert.equal(await setup.controller.load(idValue), null);
  assert.deepEqual(await setup.controller.loadReceipt(idValue), receipt);
  await assert.rejects(
    setup.controller.recover(idValue, { replayIfNotFound: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED),
  );
  await assert.rejects(
    setup.controller.prepare(idValue, plan(idValue)),
    errorIs(MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED),
  );
  assert.equal(queryCalls, queriesAtTerminal);
});

test('cleanup failure leaves VERIFIED state and receipt intact for a later reload', async () => {
  const base = createMakerV8RecoveryMemoryAdapter();
  const idValue = identity({ root: objectRef(211), listing: objectRef(210) });
  let failCleanup = true;
  const flaky = forwardingAdapter(base, async (...args) => {
    if (failCleanup && args[2] === null) {
      failCleanup = false;
      throw new Error('simulated browser close during cleanup');
    }
    return base.compareAndSwap(...args);
  });
  const setup = harness({
    identityValue: idValue,
    persist: flaky,
    query: async (request) => ({
      status: 'FINALIZED_SUCCESS', digest: request.digest, checkpoint: 1_111,
    }),
  });
  await prepareAndSign(setup, idValue, 'cleanup-crash-bytes');
  await setup.controller.recover(idValue);
  await assert.rejects(
    setup.controller.cleanupVerified(idValue),
    errorIs(MAKER_V8_RECOVERY_ERROR.STORAGE_FAILED),
  );
  assert.equal((await base.load(makerV8RecoveryScopeKey(idValue))).state,
    MAKER_V8_RECOVERY_STATE.VERIFIED);
  assert.equal(await base.loadReceipt(makerV8RecoveryIdentityKey(idValue)), null);

  const reloaded = harness({
    identityValue: idValue,
    persist: base,
    sessionId: 'session-cleanup-0005',
  });
  const receipt = await reloaded.controller.cleanupVerified(idValue);
  assert.equal(receipt.verified, true);
  assert.equal(await base.load(makerV8RecoveryScopeKey(idValue)), null);
  assert.ok(await base.loadReceipt(makerV8RecoveryIdentityKey(idValue)));
});
