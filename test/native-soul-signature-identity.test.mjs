import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256Hex } from '../scripts/mainnet-v8-release-lib.mjs';
import { verifyExactMainnetV8SignedArtifact } from '../scripts/mainnet-v8-release.mjs';
import { nativeSoulPublicationWalFixture } from './fixtures/native-soul-full-wal-fixture.mjs';

// Public, deterministic test-only key. Never consult a wallet/keystore or replace
// the immutable release plan's signer. These tests exercise the real verifier.
const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(0x17));
const prefix = await nativeSoulPublicationWalFixture();
const fixtureArtifact = prefix.publications[0].input.signedArtifact;
assert.notEqual(keypair.toSuiAddress(), prefix.plan.sender);

async function signTestBytes(transactionBase64, localSender = false) {
  const data = bcs.TransactionData.parse(fromBase64(transactionBase64));
  if (localSender) {
    data.V1.sender = keypair.toSuiAddress();
    data.V1.gasData.owner = keypair.toSuiAddress();
  }
  const transactionBytes = bcs.TransactionData.serialize(data).toBytes();
  const kind = bcs.TransactionKind.serialize(data.V1.kind).toBytes();
  const { signature } = await keypair.signTransaction(transactionBytes);
  const signedBytes = bcs.SenderSignedData.serialize([{
    intentMessage: { intent: { scope: { TransactionData: true }, version: { V0: true },
      appId: { Sui: true } }, value: data }, txSignatures: [signature],
  }]).toBytes();
  return { transactionBase64: toBase64(transactionBytes), transactionSha256: sha256Hex(transactionBytes),
    transactionKindBase64: toBase64(kind), transactionKindSha256: sha256Hex(kind),
    digest: TransactionDataBuilder.getDigestFromBytes(transactionBytes), signature,
    signatureSha256: sha256Hex(fromBase64(signature)), senderSignedDataBase64: toBase64(signedBytes),
    senderSignedDataSha256: sha256Hex(signedBytes), signer: data.V1.sender };
}

test('actual cryptographic verifier accepts the local key only for its own sender', async () => {
  const artifact = await signTestBytes(fixtureArtifact.transactionBase64, true);
  const verified = await verifyExactMainnetV8SignedArtifact(artifact);
  assert.equal(verified.signer, keypair.toSuiAddress());
  assert.notEqual(verified.signer, prefix.plan.sender);
});

test('rehashing a valid local signature cannot authorize the fixed production sender', async () => {
  const artifact = await signTestBytes(fixtureArtifact.transactionBase64);
  assert.equal(artifact.signer, prefix.plan.sender);
  assert.equal(artifact.transactionSha256, fixtureArtifact.transactionSha256);
  await assert.rejects(verifyExactMainnetV8SignedArtifact(artifact), error =>
    error.code === 'MAINNET_V8_SIGNED_ARTIFACT_DRIFT'
      && /signature belongs to another signer/.test(error.message));
});

test('connected WAL structural signatures are not production crypto acceptance', async () => {
  assert.equal(fixtureArtifact.signer, prefix.plan.sender);
  await assert.rejects(verifyExactMainnetV8SignedArtifact(fixtureArtifact), /Signature is not valid/);
});
