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

test('register, upload, listFiles and certify expose awaited durable checkpoints', () => {
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
  const listFiles = register.indexOf('session.flow.listFiles', upload);
  assert.ok(uploadedCheckpoint > upload && uploadedCheckpoint < listFiles);
  assert.ok(register.indexOf('await checkpointWalrusSession(session, onCheckpoint)', listFiles) > listFiles);

  assert.match(certify, /pendingCertifyTransaction/);
  assert.match(certify, /getBlobObject/);
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
