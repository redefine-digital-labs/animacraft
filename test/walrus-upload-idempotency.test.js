import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8');

function section(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function compiledSignedTransactionHelpers({ client, digest = 'derived-digest' } = {}) {
  const normalization = section(
    'function normalizedSignedTransaction',
    'function transactionNotFound',
  );
  const execution = section(
    'export async function executeSignedTransactionAndWait',
    'function moveTarget',
  ).replace('export async function', 'async function');
  const unwrapping = section(
    'function finalizedTransactionFailure',
    'function licenseKind',
  );
  const normalizedSignedTransaction = new Function(
    'toBase64',
    'fromBase64',
    'TransactionDataBuilder',
    `${normalization}; return normalizedSignedTransaction;`,
  )(
    (bytes) => Buffer.from(bytes).toString('base64'),
    (bytes) => bytes,
    { getDigestFromBytes: () => digest },
  );
  const executeSignedTransactionAndWait = new Function(
    'normalizedSignedTransaction',
    'getSuiClient',
    'unwrapTransaction',
    'transactionNotFound',
    'fromBase64',
    `${execution}; return executeSignedTransactionAndWait;`,
  )(
    normalizedSignedTransaction,
    () => client,
    new Function(`${unwrapping}; return unwrapTransaction;`)(),
    (error) => /not found/i.test(String(error?.message || error)),
    (bytes) => bytes,
  );
  return { normalizedSignedTransaction, executeSignedTransactionAndWait };
}

function compiledWalrusSettlement() {
  const settlement = section(
    'function sameWalrusFinalizedFailure',
    'async function executePendingTransaction',
  );
  const unwrapping = section(
    'function finalizedTransactionFailure',
    'function licenseKind',
  );
  const helpers = new Function(
    `${unwrapping}; return { finalizedTransactionFailure, unwrapTransaction };`,
  )();
  const walrusStateError = (code, message, cause) => {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = code;
    return error;
  };
  const settlePendingTransaction = new Function(
    'finalizedTransactionFailure',
    'unwrapTransaction',
    'walrusStateError',
    'checkpointWalrusSession',
    `${settlement}; return settlePendingTransaction;`,
  )(
    helpers.finalizedTransactionFailure,
    helpers.unwrapTransaction,
    walrusStateError,
    async (session, onCheckpoint) => onCheckpoint?.(session),
  );
  return { settlePendingTransaction };
}

function compiledWalrusPendingExecution({ client, querySignedTransaction }) {
  const sourceText = section(
    'function sameWalrusFinalizedFailure',
    'async function signWalrusTransaction',
  );
  const unwrapping = section(
    'function finalizedTransactionFailure',
    'function licenseKind',
  );
  const helpers = new Function(
    `${unwrapping}; return { finalizedTransactionFailure, unwrapTransaction };`,
  )();
  const walrusStateError = (code, message, cause) => {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = code;
    return error;
  };
  return new Function(
    'finalizedTransactionFailure',
    'unwrapTransaction',
    'walrusStateError',
    'checkpointWalrusSession',
    'querySignedTransaction',
    'suiClient',
    'fromBase64',
    `${sourceText}; return executePendingTransaction;`,
  )(
    helpers.finalizedTransactionFailure,
    helpers.unwrapTransaction,
    walrusStateError,
    async (session, onCheckpoint) => onCheckpoint?.(session),
    querySignedTransaction,
    client,
    (bytes) => bytes,
  );
}

function failedResult(digest = 'derived-digest', overrides = {}) {
  return {
    FailedTransaction: {
      digest,
      status: {
        success: false,
        error: {
          $kind: 'MoveAbort',
          message: 'MoveAbort EInvalidLifecycle',
          command: 2,
          MoveAbort: { abortCode: '17' },
          ...overrides,
        },
      },
    },
  };
}

test('prepare exposes a timestamped relay and complete WAL/FROST quote', () => {
  const prepare = section(
    'export async function prepareWalrusUpload',
    'export async function resumeWalrusUpload',
  );

  assert.match(prepare, /calculateUploadRelayTip/);
  assert.match(prepare, /storageCost\(encoded\.unencodedSize,\s*walrusStorageEpochs\(\)\)/);
  for (const field of [
    'relayTipMist',
    'relayTipQuotedAt',
    'walrusStorageCostFrost',
    'walrusWriteCostFrost',
    'walrusTotalCostFrost',
    'walletSuiBalanceMist',
    'walletWalBalanceFrost',
  ]) {
    assert.match(source, new RegExp(`session\\.${field}\\s*=`), `missing session quote field ${field}`);
  }
  assert.match(source, /String\(costs\.storageCost\)/);
  assert.match(source, /String\(costs\.writeCost\)/);
  assert.match(source, /String\(costs\.totalCost\)/);
});

test('registration refreshes pricing with a fresh client and exact confirmed tip ceiling', () => {
  const refresh = section(
    'async function refreshedRegistrationFlow',
    'function normalizedSignedTransaction',
  );

  assert.match(refresh, /createWalrusRuntime\(walrusRelayTipCapMist\(\)\)/);
  assert.match(refresh, /const exactRelayTipMist = assertWalrusRelayTipWithinPolicy\(quote\.relayTipMist\)/);
  assert.match(refresh, /createWalrusRuntime\(exactRelayTipMist\)/);
  assert.match(refresh, /walrusQuoteAmountsChanged\(session,\s*quote\)/);
  assert.match(refresh, /walrusQuoteAmountsChanged\(session,\s*exactQuote\)/);
  assert.match(refresh, /'UPLOAD_QUOTE_CHANGED'/);
  assert.match(refresh, /await checkpointWalrusSession\(session,\s*onCheckpoint\)/);
});

test('relay policy uses BigInt before constructing the exact quote client', () => {
  const policy = section(
    'function nonNegativeIntegerBigInt',
    'function walrusStorageEpochs',
  );
  const refresh = section(
    'async function refreshedRegistrationFlow',
    'function normalizedSignedTransaction',
  );

  assert.match(policy, /BigInt\(String\(value\)\)/);
  assert.match(policy, /function assertWalrusRelayTipWithinPolicy/);
  assert.match(policy, /if \(tip > cap\)/);
  assert.match(policy, /'TIP_TOO_HIGH'/);
  assert.ok(
    refresh.indexOf('assertWalrusRelayTipWithinPolicy(quote.relayTipMist)')
      < refresh.indexOf('createWalrusRuntime(exactRelayTipMist)'),
    'the confirmed relay tip must pass the BigInt policy check before client construction',
  );
});

test('WAL balance discovery introspects staking::stake_with_pool instead of guessing from Blob', () => {
  const discovery = section(
    'async function walCoinTypeForClient',
    'async function walrusWalletBalances',
  );
  const balances = section(
    'async function walrusWalletBalances',
    'function applyWalrusWalletBalances',
  );

  assert.match(discovery, /client\.core\.getMoveFunction/);
  assert.match(discovery, /moduleName:\s*'staking'/);
  assert.match(discovery, /name:\s*'stake_with_pool'/);
  assert.match(discovery, /parameters\?\.\[1\]/);
  assert.match(discovery, /typeParameters\?\.\[0\]/);
  assert.match(discovery, /normalizeStructTag\(toStakeCoinType\.datatype\.typeName\)/);
  assert.match(discovery, /walCoinTypeByStakingPackage/);
  assert.doesNotMatch(discovery, /::wal::WAL/);
  assert.match(balances, /await walCoinTypeForClient\(client\)/);
});

test('prepare and resume preserve a stable upload session identity and recovery revision', () => {
  const prepare = section(
    'export async function prepareWalrusUpload',
    'export async function resumeWalrusUpload',
  );
  const resume = section(
    'export async function resumeWalrusUpload',
    'export async function registerAndUploadWalrus',
  );

  assert.match(prepare, /uploadSessionId:\s*createUploadSessionId\(\)/);
  assert.match(prepare, /recoveryRevision:\s*0/);
  assert.match(resume, /uploadSessionId:\s*String\(recovery\.uploadSessionId/);
  assert.match(resume, /\|\| legacyUploadSessionId\(recovery\)/);
  assert.match(resume, /recoveryRevision:\s*recoveryRevision\(recovery\)/);
  assert.match(prepare, /finalizedFailures:\s*\[\]/);
  assert.match(resume, /finalizedFailures:\s*normalizedWalrusFinalizedFailures/);
});

test('Walrus archives definitive failed digests before clearing replay bytes', async () => {
  const { settlePendingTransaction } = compiledWalrusSettlement();
  const pending = {
    digest: 'walrus-register-digest',
    bytes: 'signed-bytes',
    signature: 'signature',
  };
  const session = {
    stage: 'encoded',
    registerDigest: '',
    pendingRegisterTransaction: pending,
    finalizedFailures: [],
  };
  const checkpoints = [];
  await assert.rejects(
    settlePendingTransaction(session, {
      pendingKey: 'pendingRegisterTransaction',
      digestKey: 'registerDigest',
      successStage: 'registered',
      failureStage: 'encoded',
      result: failedResult('walrus-register-digest'),
      onCheckpoint(snapshot) {
        checkpoints.push(structuredClone(snapshot));
      },
    }),
    (error) => error?.code === 'WALRUS_TRANSACTION_FAILED'
      && error?.digest === 'walrus-register-digest'
      && error?.finalizedFailure?.transactionKind === 'REGISTER'
      && error?.finalizedFailure?.executionStatus === 'FAILURE',
  );
  assert.equal(session.pendingRegisterTransaction, null);
  assert.equal(session.registerDigest, '');
  assert.equal(session.stage, 'encoded');
  assert.equal(session.finalizedFailures.length, 1);
  assert.equal(session.finalizedFailures[0].transactionDigest, 'walrus-register-digest');
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].pendingRegisterTransaction, null);
  assert.equal(checkpoints[0].finalizedFailures.length, 1);

  const unsafeSession = {
    stage: 'encoded',
    registerDigest: '',
    pendingRegisterTransaction: structuredClone(pending),
    finalizedFailures: [],
  };
  await assert.rejects(
    settlePendingTransaction(unsafeSession, {
      pendingKey: 'pendingRegisterTransaction',
      digestKey: 'registerDigest',
      successStage: 'registered',
      failureStage: 'encoded',
      result: failedResult('walrus-register-digest'),
      async onCheckpoint() {
        throw new Error('checkpoint unavailable');
      },
    }),
    /checkpoint unavailable/,
  );
  assert.deepEqual(unsafeSession.pendingRegisterTransaction, pending);
  assert.equal(unsafeSession.finalizedFailures.length, 0);
});

test('Walrus never re-queries a digest after its finalized failure is archived', async () => {
  let queries = 0;
  const executePendingTransaction = compiledWalrusPendingExecution({
    client: {
      async executeTransaction() {
        return failedResult('walrus-register-digest');
      },
    },
    async querySignedTransaction() {
      queries += 1;
      return { found: true, result: failedResult('walrus-register-digest') };
    },
  });
  const session = {
    stage: 'encoded',
    registerDigest: '',
    pendingRegisterTransaction: {
      digest: 'walrus-register-digest',
      bytes: 'signed-bytes',
      signature: 'signature',
    },
    finalizedFailures: [],
  };
  const checkpoints = [];
  await assert.rejects(
    executePendingTransaction(session, {
      pendingKey: 'pendingRegisterTransaction',
      digestKey: 'registerDigest',
      successStage: 'registered',
      failureStage: 'encoded',
      onCheckpoint(snapshot) {
        checkpoints.push(structuredClone(snapshot));
      },
    }),
    (error) => error?.code === 'WALRUS_TRANSACTION_FAILED'
      && error?.finalizedFailure?.transactionDigest === 'walrus-register-digest',
  );
  assert.equal(queries, 0);
  assert.equal(session.pendingRegisterTransaction, null);
  assert.equal(session.finalizedFailures.length, 1);
  assert.equal(checkpoints.filter((entry) => entry.finalizedFailures.length === 1).length, 1);
});

test('signed Walrus transactions are serializable and digest-stable before broadcast', () => {
  const signing = section(
    'function normalizedSignedTransaction',
    'function transactionNotFound',
  );
  const pendingExecution = section(
    'async function executePendingTransaction',
    'async function signWalrusTransaction',
  );
  const signer = section(
    'async function signWalrusTransaction',
    'function parseWalrusCertificate',
  );

  assert.match(signing, /TransactionDataBuilder\.getDigestFromBytes\(fromBase64\(bytes\)\)/);
  assert.match(signing, /bytes,\s*signature,\s*digest:/s);
  assert.match(signing, /signedAt:/);
  assert.match(signer, /dAppKit\.signTransaction/);
  assert.doesNotMatch(signer, /signAndExecuteTransaction/);
  assert.match(signer, /session\[pendingKey\]\s*=\s*signed/);
  assert.match(signer, /await checkpointWalrusSession\(session,\s*onCheckpoint\)/);

  const persistAttempt = pendingExecution.indexOf('await checkpointWalrusSession(session, onCheckpoint)');
  const broadcast = pendingExecution.indexOf('suiClient.executeTransaction');
  assert.ok(persistAttempt >= 0 && persistAttempt < broadcast, 'signed bytes must checkpoint before broadcast');
  assert.match(pendingExecution, /transaction:\s*fromBase64\(pending\.bytes\)/);
  assert.match(pendingExecution, /signatures:\s*\[pending\.signature\]/);
});

test('persisted digest fields must match exact signed bytes before every network call', async () => {
  let networkCalls = 0;
  const client = {
    async getTransaction() {
      networkCalls += 1;
      throw new Error('transaction not found');
    },
    async executeTransaction() {
      networkCalls += 1;
      throw new Error('must not execute');
    },
    async waitForTransaction() {
      networkCalls += 1;
      throw new Error('must not wait');
    },
  };
  const { executeSignedTransactionAndWait } = compiledSignedTransactionHelpers({ client });

  for (const mismatch of [
    { digest: 'wrong-digest' },
    { transactionDigest: 'wrong-transaction-digest' },
    { digest: 'derived-digest', transactionDigest: 'wrong-transaction-digest' },
  ]) {
    await assert.rejects(
      executeSignedTransactionAndWait({
        bytes: 'exact-signed-bytes',
        signature: 'exact-signature',
        ...mismatch,
      }),
      (error) => error?.code === 'TRANSACTION_DIGEST_MISMATCH',
    );
  }
  assert.equal(networkCalls, 0);
});

test('an exact persisted replay queries idempotently and guards the broadcast at the final boundary', async () => {
  const events = [];
  let finalized = true;
  const client = {
    async getTransaction({ digest }) {
      events.push(`query:${digest}`);
      if (!finalized) throw new Error('transaction not found');
      return { Transaction: { digest } };
    },
    async executeTransaction() {
      events.push('execute');
      return { Transaction: { digest: 'derived-digest' } };
    },
    async waitForTransaction({ digest }) {
      events.push(`wait:${digest}`);
      return { Transaction: { digest } };
    },
  };
  const { executeSignedTransactionAndWait } = compiledSignedTransactionHelpers({ client });
  const exact = {
    bytes: 'exact-signed-bytes',
    signature: 'exact-signature',
    digest: 'derived-digest',
    transactionDigest: 'derived-digest',
  };

  const recovered = await executeSignedTransactionAndWait(exact, {
    assertBeforeExecute: () => events.push('guard'),
  });
  assert.equal(recovered.alreadySubmitted, true);
  assert.deepEqual(events, ['query:derived-digest']);

  finalized = false;
  await assert.rejects(
    executeSignedTransactionAndWait(exact, {
      assertBeforeExecute() {
        events.push('guard');
        const error = new Error('publication context changed');
        error.code = 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED';
        throw error;
      },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
  );
  assert.deepEqual(events, [
    'query:derived-digest',
    'query:derived-digest',
    'guard',
  ]);
});

test('definitive Sui failure preserves exact digest and structured execution evidence', async () => {
  const client = {
    async getTransaction() {
      return failedResult();
    },
    async executeTransaction() {
      throw new Error('must not execute a finalized digest');
    },
    async waitForTransaction() {
      throw new Error('must not wait for a finalized digest');
    },
  };
  const { executeSignedTransactionAndWait } = compiledSignedTransactionHelpers({ client });
  await assert.rejects(
    executeSignedTransactionAndWait({
      bytes: 'exact-signed-bytes',
      signature: 'exact-signature',
      digest: 'derived-digest',
    }),
    (error) => (
      error?.code === 'TRANSACTION_FINALIZED_FAILURE'
      && error.digest === 'derived-digest'
      && error.finalizedFailure?.finalized === true
      && error.finalizedFailure?.executionStatus === 'FAILURE'
      && error.finalizedFailure?.executionError?.abortCode === '17'
    ),
  );
});

test('execute and wait failures are definitive while mismatched failure digests never retire recovery', async () => {
  const exact = {
    bytes: 'exact-signed-bytes',
    signature: 'exact-signature',
    digest: 'derived-digest',
  };
  for (const failureAt of ['execute', 'wait']) {
    const client = {
      async getTransaction() {
        throw new Error('transaction not found');
      },
      async executeTransaction() {
        return failureAt === 'execute'
          ? failedResult()
          : { Transaction: { digest: 'derived-digest' } };
      },
      async waitForTransaction() {
        return failedResult();
      },
    };
    const { executeSignedTransactionAndWait } = compiledSignedTransactionHelpers({ client });
    await assert.rejects(
      executeSignedTransactionAndWait(exact),
      (error) => error?.code === 'TRANSACTION_FINALIZED_FAILURE'
        && error.digest === 'derived-digest',
      failureAt,
    );
  }

  const mismatchClient = {
    async getTransaction() {
      return failedResult('different-digest');
    },
  };
  const { executeSignedTransactionAndWait } = compiledSignedTransactionHelpers({
    client: mismatchClient,
  });
  await assert.rejects(
    executeSignedTransactionAndWait(exact),
    (error) => error?.code === 'TRANSACTION_DIGEST_MISMATCH'
      && !error.finalizedFailure,
  );
});

test('unknown transaction status retains and reuses the same signed transaction', () => {
  const pendingExecution = section(
    'async function executePendingTransaction',
    'async function signWalrusTransaction',
  );

  assert.match(pendingExecution, /if \(pending\.lastBroadcastAt\)[\s\S]*querySignedTransaction\(pending\.digest\)/);
  assert.match(pendingExecution, /pending\.broadcastAttempts\s*=\s*Number\(pending\.broadcastAttempts \|\| 0\) \+ 1/);
  assert.match(pendingExecution, /'TRANSACTION_OUTCOME_PENDING'/);
  assert.match(pendingExecution, /will not request a new signature/);

  const walrusLifecycle = section(
    'export async function registerAndUploadWalrus',
    'export function walrusFileUrl',
  );
  assert.doesNotMatch(walrusLifecycle, /signAndExecuteTransaction/);
  assert.equal(
    (walrusLifecycle.match(/signWalrusTransaction\(session,\s*'pendingRegisterTransaction'/g) || []).length,
    1,
  );
  assert.equal(
    (walrusLifecycle.match(/signWalrusTransaction\(session,\s*'pendingCertifyTransaction'/g) || []).length,
    1,
  );
});

test('registration rejects insufficient WAL or relay-tip SUI before signing', () => {
  const balances = section(
    'function assertWalrusWalletBalances',
    'function walrusQuoteFromCosts',
  );
  const refresh = section(
    'async function refreshedRegistrationFlow',
    'function normalizedSignedTransaction',
  );

  assert.match(balances, /'INSUFFICIENT_WAL_BALANCE'/);
  assert.match(balances, /'INSUFFICIENT_SUI_BALANCE'/);
  assert.match(balances, /walletWalBalanceFrost[\s\S]*walrusTotalCostFrost/);
  assert.match(balances, /walletSuiBalanceMist[\s\S]*relayTipMist/);
  assert.match(refresh, /assertWalrusWalletBalances\(session\)/);
  assert.ok(
    refresh.indexOf('assertWalrusWalletBalances(session)')
      < refresh.indexOf('writeFilesFlow'),
    'balance rejection must happen before transaction construction and wallet signing',
  );
});

test('register, upload and certify expose awaited durable checkpoints without caching an uncertified Blob', () => {
  const register = section(
    'export async function registerAndUploadWalrus',
    'export async function certifyWalrusUpload',
  );
  const certify = section(
    'export async function certifyWalrusUpload',
    'export function walrusFileUrl',
  );

  assert.match(source, /registerAndUploadWalrus\(session,\s*\{\s*onCheckpoint = null\s*\} = \{\}\)/);
  assert.match(source, /certifyWalrusUpload\(session,\s*\{\s*onCheckpoint = null\s*\} = \{\}\)/);

  const registerCheckpoint = register.indexOf('await executePendingTransaction');
  const upload = register.indexOf('session.flow.upload', registerCheckpoint);
  assert.ok(registerCheckpoint >= 0 && upload > registerCheckpoint);
  assert.ok(
    register.indexOf('await checkpointWalrusSession(session, onCheckpoint)', registerCheckpoint) < upload,
    'register digest must checkpoint before relay upload',
  );
  const uploadedCheckpoint = register.indexOf('await checkpointWalrusSession(session, onCheckpoint)', upload);
  assert.ok(uploadedCheckpoint > upload);
  assert.doesNotMatch(register, /session\.flow\.listFiles/);
  assert.match(register, /Calling listFiles\(\)[\s\S]*pre-certification Blob object/);

  assert.match(certify, /pendingCertifyTransaction/);
  assert.match(certify, /waitForCertifiedWalrusBlobObject/);
  assert.match(certify, /listQuiltFilesFromCheckpoint\(session,\s*\{\s*blobObject\s*\}\)/);
  assert.ok(
    certify.indexOf('waitForCertifiedWalrusBlobObject')
      < certify.indexOf('listQuiltFilesFromCheckpoint(session, { blobObject })'),
    'the certified Blob must be freshly read before reconstructing patch IDs',
  );
  assert.match(certify, /session\.stage\s*=\s*'certified'[\s\S]*await checkpointWalrusSession\(session,\s*onCheckpoint\)/);
});

test('one session cannot run concurrent Walrus operations', () => {
  const lock = section(
    'async function withWalrusSessionOperation',
    'function applyWalrusQuote',
  );

  assert.match(lock, /walrusSessionOperations\.has\(session\)/);
  assert.match(lock, /'WALRUS_OPERATION_IN_PROGRESS'/);
  assert.match(lock, /walrusSessionOperations\.add\(session\)/);
  assert.match(lock, /finally[\s\S]*walrusSessionOperations\.delete\(session\)/);
  assert.match(source, /withWalrusSessionOperation\(session,\s*'register\/upload'/);
  assert.match(source, /withWalrusSessionOperation\(session,\s*'certify'/);
});

test('paid and uploaded recovery paths do not fetch a current relay quote', () => {
  const resume = section(
    'export async function resumeWalrusUpload',
    'export async function registerAndUploadWalrus',
  );

  assert.match(resume, /const needsInitialQuote = session\.stage === 'encoded'/);
  assert.match(resume, /&& !session\.pendingRegisterTransaction/);
  assert.match(resume, /pendingRegisterTransaction:\s*recovery\.pendingRegisterTransaction \|\| null/);
  assert.match(resume, /pendingCertifyTransaction:\s*recovery\.pendingCertifyTransaction \|\| null/);
  assert.doesNotMatch(resume, /session\.stage\s*=\s*'registered'/);
  assert.match(resume, /session\.stage === 'certified'[\s\S]*listQuiltFilesFromCheckpoint/);
});
