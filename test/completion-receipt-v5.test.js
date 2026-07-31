import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOULIDITY_COMPLETION_RECEIPT_V5_SCHEMA,
  parseSoulidityCompletionMessageV5,
  verifySoulidityCompletionReceiptV5,
} from '../completion-receipt-v5.js';

const id = (digit) => `0x${digit.repeat(64)}`;
const bytes = (digit) => `0x${digit.repeat(64)}`;
const expected = Object.freeze({
  returnNonce: bytes('1'),
  exportKey: 'exact-export-key',
  wallet: id('2'),
  rootObjectId: id('3'),
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

function clientFixture({
  payer = expected.wallet,
  outputDigest = expected.outputDigest,
  provenanceMakerId = expected.rootObjectId,
  provenanceOwner = 'Immutable',
} = {}) {
  const complete = {
    root_id: expected.rootObjectId,
    legacy_maker_id: expected.legacyMakerObjectId,
    payer,
    recipe_hash: expected.recipeHash,
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
  return {
    async getTransactionBlock() {
      return {
        effects: { status: { status: 'success' } },
        transaction: { data: { sender: payer } },
        events: [
          {
            type: `${commercePackage}::commerce_v5::CompleteAuthorizedV5`,
            parsedJson: complete,
          },
          {
            type: `${commercePackage}::commerce_v5::CompleteOutputBoundToSoulV5`,
            parsedJson: {
              root_id: expected.rootObjectId,
              seal_id: expected.outputSealId,
              soul_id: message.soulObjectId,
              payer,
            },
          },
          {
            type: `${soulidityPackage}::animacraft_provenance::AnimacraftProvenanceCreated`,
            parsedJson: {
              ...provenance,
              state_id: id('f'),
            },
          },
          {
            type: `${soulidityPackage}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5Created`,
            parsedJson: {
              output_provenance_id: message.outputProvenanceObjectId,
              base_provenance_id: message.provenanceObjectId,
              soul_id: message.soulObjectId,
              state_id: id('f'),
              maker_root_id: expected.rootObjectId,
              complete_output_seal_id: expected.outputSealId,
            },
          },
        ],
      };
    },
    async getObject({ id: objectId }) {
      if (objectId === message.outputProvenanceObjectId) {
        return {
          data: {
            type: `${soulidityPackage}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5`,
            owner: 'Immutable',
            content: {
              dataType: 'moveObject',
              fields: {
                version: '1',
                soul_id: message.soulObjectId,
                base_provenance_id: message.provenanceObjectId,
                maker_root_id: expected.rootObjectId,
                complete_output_seal_id: expected.outputSealId,
              },
            },
          },
        };
      }
      return {
        data: {
          type: `${soulidityPackage}::animacraft_provenance::AnimacraftProvenance`,
          owner: provenanceOwner,
          content: {
            dataType: 'moveObject',
            fields: {
              animacraft_version: '5',
              soul_id: message.soulObjectId,
              maker_id: provenanceMakerId,
              maker_treasury_id: expected.makerTreasuryObjectId,
              payer,
              profile_json_blob_id: expected.profileBlobId,
              image_blob_id: expected.imageBlobId,
              image_url: expected.imageUrl,
              recipe_hash: [...Uint8Array.from({ length: 32 }, () => 0x66)],
            },
          },
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

test('verifies the exact successful Complete event and frozen provenance object', async () => {
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
  const original = client.getTransactionBlock;
  client.getTransactionBlock = async () => {
    const result = await original();
    result.events = result.events.filter(
      (event) => !String(event.type).endsWith('::CompleteOutputBoundToSoulV5'),
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
  const original = client.getTransactionBlock;
  client.getTransactionBlock = async () => {
    const result = await original();
    result.events = result.events.filter(
      (event) => !String(event.type).endsWith(
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
