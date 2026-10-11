import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bcs } from '@mysten/sui/bcs';
import {
  SOULIDITY_COMPLETION_RECEIPT_V5_SCHEMA,
  parseSoulidityCompletionMessageV5,
  verifySoulidityCompletionReceiptV5,
} from '../completion-receipt-v5.js';

const id = (digit) => `0x${digit.repeat(64)}`;
const bytes = (digit) => `0x${digit.repeat(64)}`;
const byteVector = (value) => Uint8Array.from(
  String(value).slice(2).match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)),
);
const expected = Object.freeze({
  returnNonce: bytes('1'),
  exportKey: 'exact-export-key',
  wallet: id('2'),
  rootObjectId: id('3'),
  completeOutputsTableId: id('0'),
  legacyMakerObjectId: id('4'),
  makerTreasuryObjectId: id('5'),
  profileBlobId: 'profile-patch',
  imageBlobId: 'ciphertext-patch',
  imageUrl: 'https://aggregator.example/v1/blobs/quilt?blobId=preview-patch',
  recipeHash: bytes('6'),
  outputSealId: bytes('7'),
  outputNonce: bytes('8'),
  outputDigest: bytes('9'),
});
const message = Object.freeze({
  schemaVersion: SOULIDITY_COMPLETION_RECEIPT_V5_SCHEMA,
  returnNonce: expected.returnNonce,
  txDigest: '9FhhUsXLV4m5QVMWfVx8jPvBsr6f7sCqF1MrhwnHzQ2W',
  soulObjectId: id('a'),
  provenanceObjectId: id('b'),
  outputProvenanceObjectId: id('e'),
});
const commercePackage = id('c');
const soulidityPackage = id('d');

const CompleteOutputRecordV5Bcs = bcs.struct('CompleteOutputRecordV5', {
  seal_id: bcs.byteVector(),
  payer: bcs.Address,
  recipe_hash: bcs.byteVector(),
  output_nonce: bcs.byteVector(),
  output_digest: bcs.byteVector(),
  ciphertext_blob_id: bcs.string(),
  bound_soul_id: bcs.option(bcs.Address),
});

test('Web verification stays pinned to the actual CompleteAuthorizedV5 ABI', async () => {
  const move = await readFile(
    new URL('../move/animacraft/sources/commerce_v5.move', import.meta.url),
    'utf8',
  );
  const body = move.match(
    /public struct CompleteAuthorizedV5 has copy, drop \{([\s\S]*?)\n\}/,
  )?.[1] || '';
  const fields = [...body.matchAll(/^\s*([a-z0-9_]+):/gm)]
    .map((match) => match[1]);
  assert.deepEqual(fields, [
    'root_id',
    'legacy_maker_id',
    'payer',
    'creator_charge_atomic',
    'protocol_percentage_atomic',
    'fixed_protocol_fee_atomic',
    'total_paid_atomic',
    'ownership_epoch',
    'output_seal_id',
    'output_nonce',
    'output_digest',
    'ciphertext_blob_id',
  ]);
  assert.doesNotMatch(
    verifySoulidityCompletionReceiptV5.toString(),
    /field\(complete, 'recipe_hash'/,
  );
  assert.match(move, /CompleteOutputRecordV5 \{[\s\S]*?recipe_hash:/);
});

function clientFixture({
  payer = expected.wallet,
  outputDigest = expected.outputDigest,
  provenanceMakerId = expected.rootObjectId,
  provenanceOwner = 'Immutable',
  provenanceRecipeHash = expected.recipeHash,
  recordRecipeHash = expected.recipeHash,
  recordBoundSoulId = message.soulObjectId,
  recordCiphertextBlobId = expected.imageBlobId,
  outputRecordAvailable = true,
} = {}) {
  const complete = {
    root_id: expected.rootObjectId,
    legacy_maker_id: expected.legacyMakerObjectId,
    payer,
    output_seal_id: expected.outputSealId,
    output_nonce: expected.outputNonce,
    output_digest: outputDigest,
    ciphertext_blob_id: expected.imageBlobId,
  };
  const provenance = {
    provenance_id: message.provenanceObjectId,
    soul_id: message.soulObjectId,
    maker_id: provenanceMakerId,
    maker_treasury_id: expected.makerTreasuryObjectId,
    payer,
  };
  const completeOutputRecordBytes = CompleteOutputRecordV5Bcs.serialize({
    seal_id: byteVector(expected.outputSealId),
    payer,
    recipe_hash: byteVector(recordRecipeHash),
    output_nonce: byteVector(expected.outputNonce),
    output_digest: byteVector(outputDigest),
    ciphertext_blob_id: recordCiphertextBlobId,
    bound_soul_id: recordBoundSoulId,
  }).toBytes();
  return {
    async getTransaction({ digest, include }) {
      assert.equal(digest, message.txDigest);
      assert.deepEqual(include, {
        effects: true,
        events: true,
        transaction: true,
      });
      return {
        $kind: 'Transaction',
        Transaction: {
          digest: message.txDigest,
          status: { success: true, error: null },
          effects: { status: { success: true, error: null } },
          transaction: { sender: payer },
          events: [
            {
              eventType:
                `${commercePackage}::commerce_v5::CompleteAuthorizedV5`,
              json: complete,
            },
            {
              eventType:
                `${commercePackage}::commerce_v5::CompleteOutputBoundToSoulV5`,
              json: {
                root_id: expected.rootObjectId,
                seal_id: expected.outputSealId,
                soul_id: message.soulObjectId,
                payer,
              },
            },
            {
              eventType:
                `${soulidityPackage}::animacraft_provenance::AnimacraftProvenanceCreated`,
              json: {
                ...provenance,
                state_id: id('f'),
              },
            },
            {
              eventType:
                `${soulidityPackage}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5Created`,
              json: {
                output_provenance_id: message.outputProvenanceObjectId,
                base_provenance_id: message.provenanceObjectId,
                soul_id: message.soulObjectId,
                state_id: id('f'),
                maker_root_id: expected.rootObjectId,
                complete_output_seal_id: expected.outputSealId,
              },
            },
          ],
        },
      };
    },
    async getObject({ objectId, include }) {
      assert.deepEqual(include, { json: true });
      if (objectId === message.outputProvenanceObjectId) {
        return {
          object: {
            type: `${soulidityPackage}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5`,
            owner: { $kind: 'Immutable' },
            json: {
              version: '1',
              soul_id: message.soulObjectId,
              base_provenance_id: message.provenanceObjectId,
              maker_root_id: expected.rootObjectId,
              complete_output_seal_id: expected.outputSealId,
            },
          },
        };
      }
      return {
        object: {
          type: `${soulidityPackage}::animacraft_provenance::AnimacraftProvenance`,
          owner: provenanceOwner,
          json: {
            animacraft_version: '5',
            soul_id: message.soulObjectId,
            maker_id: provenanceMakerId,
            maker_treasury_id: expected.makerTreasuryObjectId,
            payer,
            profile_json_blob_id: expected.profileBlobId,
            image_blob_id: expected.imageBlobId,
            image_url: expected.imageUrl,
            recipe_hash: [...byteVector(provenanceRecipeHash)],
          },
        },
      };
    },
    async getDynamicField({ parentId, name }) {
      assert.equal(parentId, expected.completeOutputsTableId);
      assert.equal(name.type, 'vector<u8>');
      assert.deepEqual(
        [...bcs.byteVector().parse(name.bcs)],
        [...Uint8Array.from({ length: 32 }, () => 0x77)],
      );
      if (!outputRecordAvailable) throw new Error('record not found');
      return {
        dynamicField: {
          value: { bcs: completeOutputRecordBytes },
        },
      };
    },
  };
}

test('parses only the versioned exact completion message', () => {
  assert.deepEqual(parseSoulidityCompletionMessageV5(message), {
    ...message,
    soulObjectId: id('a'),
    provenanceObjectId: id('b'),
    outputProvenanceObjectId: id('e'),
  });
  assert.throws(
    () => parseSoulidityCompletionMessageV5({ ...message, returnNonce: bytes('f').slice(0, -2) }),
    /exactly 32 bytes/,
  );
  assert.throws(
    () => parseSoulidityCompletionMessageV5({
      ...message,
      outputProvenanceObjectId: '',
    }),
    /completed-output provenance object ID/,
  );
});

test('verifies the actual Complete event plus exact output and provenance records', async () => {
  const receipt = await verifySoulidityCompletionReceiptV5({
    suiClient: clientFixture(),
    message,
    expected,
    commerceTypeOriginPackageId: commercePackage,
    soulidityTypeOriginPackageId: soulidityPackage,
  });
  assert.equal(receipt.confirmed, true);
  assert.equal(receipt.digest, message.txDigest);
  assert.equal(receipt.outputSealId, expected.outputSealId);
  assert.equal(
    receipt.outputProvenanceObjectId,
    message.outputProvenanceObjectId,
  );
});

test('rejects a Complete output record for another Recipe hash', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({ recordRecipeHash: bytes('f') }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /Complete output record does not match this exact Soul and OC output/,
  );
});

test('rejects a receipt whose exact Complete output record is unavailable', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({ outputRecordAvailable: false }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /exact on-chain Commerce v5 Complete output record is unavailable/,
  );
});

test('rejects a Complete output record bound to another Soul', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({ recordBoundSoulId: id('f') }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /Complete output record does not match this exact Soul and OC output/,
  );
});

test('rejects immutable provenance for another Recipe hash', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({ provenanceRecipeHash: bytes('f') }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /provenance object does not match this exact OC output/,
  );
});

test('rejects a valid transaction for a different output digest', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({ outputDigest: bytes('f') }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /does not match this exact OC output/,
  );
});

test('rejects a callback signed by another wallet', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({ payer: id('e') }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /signed by another wallet/,
  );
});

test('rejects legacy Maker provenance where commerce v5 requires the stable root', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({
        provenanceMakerId: expected.legacyMakerObjectId,
      }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /exact Soulidity provenance event/,
  );
});

test('rejects a mutable base provenance object', async () => {
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: clientFixture({
        provenanceOwner: { AddressOwner: expected.wallet },
      }),
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /canonical Animacraft provenance object is unavailable/,
  );
});

test('rejects a successful mint that did not atomically bind the output to this Soul', async () => {
  const client = clientFixture();
  const original = client.getTransaction;
  client.getTransaction = async (input) => {
    const result = await original(input);
    result.Transaction.events = result.Transaction.events.filter(
      (event) => !String(event.eventType).endsWith(
        '::CompleteOutputBoundToSoulV5',
      ),
    );
    return result;
  };
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: client,
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /did not atomically bind/,
  );
});

test('rejects a callback without the frozen completed-output provenance event', async () => {
  const client = clientFixture();
  const original = client.getTransaction;
  client.getTransaction = async (input) => {
    const result = await original(input);
    result.Transaction.events = result.Transaction.events.filter(
      (event) => !String(event.eventType).endsWith(
        '::AnimacraftOutputProvenanceV5Created',
      ),
    );
    return result;
  };
  await assert.rejects(
    verifySoulidityCompletionReceiptV5({
      suiClient: client,
      message,
      expected,
      commerceTypeOriginPackageId: commercePackage,
      soulidityTypeOriginPackageId: soulidityPackage,
    }),
    /completed-output provenance event/,
  );
});
