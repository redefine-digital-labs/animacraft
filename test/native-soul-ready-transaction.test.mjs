import test from 'node:test';
import assert from 'node:assert/strict';
import { toBase58, toBase64 } from '@mysten/sui/utils';
import { bootstrapStages, nativeSoulBootstrapFixture } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { buildNativeSoulBootstrapTransaction } from '../scripts/native-soul-bootstrap-transactions.mjs';
import { buildMainnetV8ReadyTransaction, inspectMainnetV8Transaction, buildMainnetV8InitTransaction } from '../scripts/mainnet-v8-release.mjs';
import {
  MAINNET_V8_RELEASE_STEPS, MAINNET_V8_RELEASE_SIGNER, MAINNET_V8_CHAIN_IDENTIFIER,
  MAINNET_V8_DEFAULT_COMMITTEE, MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_DEFAULT_COMMITTEE_OWNER, MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
} from '../scripts/mainnet-v8-release-lib.mjs';

const ctx = { sender: MAINNET_V8_RELEASE_SIGNER, gasPrice: '100', gasBudget: '100000000',
  epoch: '1242', chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER, nonce: 123 };
const digest = toBase58(new Uint8Array(32).fill(8));
function artifact(stage) {
  const { input } = nativeSoulBootstrapFixture(stage);
  const stageData = structuredClone(input);
  if (stage === 'SETUP_RELEASE') stageData.keyServerCertificates = [{
    objectId: MAINNET_V8_DEFAULT_COMMITTEE, type: MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
    owner: MAINNET_V8_DEFAULT_COMMITTEE_OWNER, contentSha256: MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
    version: '1', digest, previousTransaction: digest,
  }];
  return { kind: stage, stageData };
}
// Offline actual runner compilation. No RPC, wallet, simulation or finality.
for (const [i, stage] of bootstrapStages.entries()) {
  test(`runner compiles exact ${stage} at native ordinal ${i + 8}`, async () => {
    const readyArtifact = artifact(stage);
    const result = await inspectMainnetV8Transaction(buildMainnetV8ReadyTransaction({
      ordinal: String(i + 8), readyArtifact, transactionContext: ctx,
    }));
    const { input } = nativeSoulBootstrapFixture(stage);
    const expectedKind = await buildNativeSoulBootstrapTransaction(stage, input).build({ onlyTransactionKind: true });
    assert.equal(result.transactionKindBase64, toBase64(expectedKind));
    assert.equal(result.sender, ctx.sender); assert.equal(result.gasOwner, ctx.sender);
    assert.equal(result.gasBudget, ctx.gasBudget); assert.equal(result.gasPrice, ctx.gasPrice);
    assert.equal(result.expiration.ValidDuring.nonce, ctx.nonce);
    assert.equal(result.expiration.ValidDuring.chain, MAINNET_V8_CHAIN_IDENTIFIER);
    if (stage === 'INITIALIZE_PROTOCOL') {
      const existing = await inspectMainnetV8Transaction(buildMainnetV8InitTransaction({ ...input, transactionContext: ctx }));
      assert.equal(existing.transactionBase64, result.transactionBase64);
    }
    const changed = await inspectMainnetV8Transaction(buildMainnetV8ReadyTransaction({
      ordinal: i + 8, readyArtifact, transactionContext: { ...ctx, nonce: ctx.nonce + 1 },
    }));
    assert.notEqual(result.digest, changed.digest);
    assert.equal(result.transactionKindBase64, changed.transactionKindBase64);
  });
  test(`runner rejects misrouted or extra ${stage} data`, () => {
    const readyArtifact = artifact(stage), ordinal = i + 8;
    assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal: ordinal === 11 ? 8 : ordinal + 1,
      readyArtifact, transactionContext: ctx }));
    readyArtifact.stageData.sender = ctx.sender;
    assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal, readyArtifact, transactionContext: ctx }));
  });
}
test('all eight actual publication ordinals dispatch as publications; ordinal7 is Release', async () => {
  const steps = MAINNET_V8_RELEASE_STEPS.filter(step => step.kind === 'PUBLISH');
  assert.equal(steps.length, 8);
  for (const step of steps) {
    const readyArtifact = { kind: 'PUBLISH', role: step.role, modules: [toBase64(Uint8Array.of(1, 2, 3))], dependencies: [] };
    const result = await inspectMainnetV8Transaction(buildMainnetV8ReadyTransaction({
      ordinal: step.ordinal, readyArtifact, transactionContext: ctx,
    }));
    assert.equal(result.sender, ctx.sender);
    assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal: step.ordinal,
      readyArtifact: { ...readyArtifact, role: 'wrong' }, transactionContext: ctx }));
  }
  assert.equal(steps[6].role, 'soulidity'); assert.equal(steps[7].role, 'release');
});
test('no obsolete monolithic bootstrap, verify transaction or out-of-range ordinal is compiled', () => {
  for (const ordinal of [-1, 13, 14, '999999999999999999999999999999999999', '08']) {
    assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal, readyArtifact: artifact('INITIALIZE_PROTOCOL'), transactionContext: ctx }));
  }
  assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal: 9,
    readyArtifact: { ...artifact('SETUP_RELEASE'), kind: 'BOOTSTRAP_RELEASE' }, transactionContext: ctx }));
});
test('SETUP cannot compile with missing or altered key-server authority metadata', () => {
  for (const mutate of [a => delete a.stageData.keyServerCertificates,
    a => { a.stageData.keyServerCertificates[0].contentSha256 = 'f'.repeat(64); },
    a => { a.stageData.keyServerCertificates[0].owner = ctx.sender; }]) {
    const readyArtifact = artifact('SETUP_RELEASE'); mutate(readyArtifact);
    assert.throws(() => buildMainnetV8ReadyTransaction({ ordinal: 9, readyArtifact, transactionContext: ctx }));
  }
});
