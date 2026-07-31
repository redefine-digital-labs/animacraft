import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceComposableV6Publication,
  discoverComposableV6ValidatorAuthority,
  readComposableV6PublicationSubmission,
  transactionFromComposableV6PublicationAction,
} from '../maker-composable-publication-v6-app.js';
import {
  createMakerComposableV6PublicationCheckpoint,
} from '../maker-composable-publication-v6.js';
import { transactionFromComposableV6Plan } from '../maker-composable-player-v6-app.js';

const plan = Object.freeze({
  schema: 'animacraft.maker-composable-release-plan.v6',
  version: 1,
  binding: Object.freeze({ makerKey: 'fixture' }),
  bindingIdentity: 'binding-fixture',
  planIdentity: 'plan-fixture',
  context: Object.freeze({}),
  companion: Object.freeze({ manifestHash: '00'.repeat(32) }),
  actions: Object.freeze([Object.freeze({
    id: 'walrus.companion.upload',
    stage: 'WALRUS_UPLOADING',
    transport: 'WALRUS',
    authority: Object.freeze({ role: 'MAKER', signer: '0x1', capability: null }),
    target: 'walrus:register-and-upload',
    inputs: Object.freeze({}),
    outputs: Object.freeze(['blobId']),
    policy: null,
  })]),
});

test('closed v6 publication gate performs zero network writes and signatures', async () => {
  const checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'fixture-checkpoint-0001',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
  let touched = 0;
  const result = await advanceComposableV6Publication({
    publication: { key: 'fixture', plan, checkpoint },
    runtime: { compositionV6ReleaseEnabled: false },
    executeWalrusAction() { touched += 1; },
    executeSuiAction() { touched += 1; },
    confirmAction() { touched += 1; },
  });
  assert.equal(result.gated, true);
  assert.equal(result.completed, false);
  assert.equal(touched, 0);
});

test('paid Item PTB splits the exact price from a sufficient USDC Coin', () => {
  const transaction = transactionFromComposableV6Plan({
    context: { paymentCoinId: '0x1', priceAtomic: '4534560' },
    action: {
      calls: [{
        id: 'purchase',
        target: '0x2::composition_v6::purchase_account_item_v6',
        inputOrder: ['payment'],
        inputs: { payment: { kind: 'OBJECT', objectId: '0x1' } },
      }],
    },
  });
  const commands = transaction.getData().commands;
  assert.equal(commands[0].$kind, 'SplitCoins');
  assert.deepEqual(commands[1].MoveCall.arguments[0].NestedResult, [0, 0]);
});

const id = (digit) => `0x${digit}`;
const hash = (digit = '1') => digit.repeat(64);
const baseInputs = {
  rootId: id(1),
  makerControlCapId: id(2),
  compositionProtocolConfigV6Id: id(3),
  commerceProtocolConfigV5Id: id(4),
  compositionRegistryV6Id: id(5),
  profileId: id(6),
  productId: id(7),
  validatorCapId: id(8),
  validatorAttestationId: id(9),
  clockObjectId: '0x6',
  mode: 1,
  itemAssetization: true,
  thirdPartyPolicy: 2,
  slotSchemaCommitment: hash('1'),
  rendererCommitment: hash('2'),
  companionManifestBlobId: 'walrus-blob',
  companionManifestHash: hash('3'),
  extensionsHash: hash('4'),
  familyCommitment: hash('5'),
  definitionCommitment: hash('6'),
  assetCommitment: hash('7'),
  slotKey: 'hair.front',
  originKind: 2,
  rightsOrigin: 0,
  accessKind: 2,
  bindingKind: 1,
  priceAtomic: '1000000',
  makerEcosystemFeeBps: 9000,
  transferable: true,
  requiredProductIds: [id('a')],
  excludedProductIds: [id('b')],
};

for (const [functionName, expectedArguments] of Object.entries({
  create_maker_profile_v6: 13,
  publish_official_item_product_v6: 17,
  publish_external_item_product_v6: 17,
  publish_validator_attestation_v6: 6,
  seal_maker_profile_v6: 5,
  admit_official_item_v6: 8,
  admit_certified_item_v6: 8,
  admit_open_item_v6: 6,
})) {
  test(`publication PTB builds audited ${functionName}`, () => {
    const tx = transactionFromComposableV6PublicationAction({
      id: `fixture.${functionName}`,
      transport: 'SUI',
      target: `0xcafe::composition_v6::${functionName}`,
      inputs: baseInputs,
    });
    const command = tx.getData().commands[0].MoveCall;
    assert.equal(command.function, functionName);
    assert.equal(command.arguments.length, expectedArguments);
  });
}

test('validator authority is discovered from config and current Cap owner', async () => {
  const calls = [];
  const authority = await discoverComposableV6ValidatorAuthority({
    configId: '0x33',
    suiClient: {
      async getObjects(request) {
        calls.push(request);
        if (calls.length === 1) return {
          objects: [{ json: { fields: { validator_cap_id: '0x44' } } }],
        };
        return { objects: [{ objectId: '0x44', owner: { AddressOwner: '0x55' } }] };
      },
    },
  });
  assert.deepEqual(authority, { validatorCapId: '0x44', validatorAddress: '0x55' });
  assert.equal(calls.length, 2);
});

test('validator discovery fails before any incomplete plan can be locked', async () => {
  await assert.rejects(
    discoverComposableV6ValidatorAuthority({
      configId: '0x33',
      suiClient: { async getObjects() { return { objects: [] }; } },
    }),
    (error) => error.code === 'COMPOSABLE_V6_VALIDATOR_AUTHORITY_UNAVAILABLE',
  );
});

test('Sui readback verifies profile companion evidence and admission event', async () => {
  const profile = await readComposableV6PublicationSubmission({
    action: {
      id: 'chain.profile.create',
      inputs: { rootId: '0x1' },
    },
    submission: { transactionDigest: 'profile-digest' },
    suiClient: {
      async getTransaction() {
        return { events: [{
          type: '0xcafe::composition_v6::MakerProfileCreatedV6',
          parsedJson: {
            profile_id: '0x6',
            root_id: '0x1',
            companion_manifest_blob_id: 'walrus-blob',
            companion_manifest_hash: Array(32).fill(3),
          },
        }] };
      },
    },
  });
  assert.equal(profile.profileId, '0x6');
  assert.equal(profile.companionManifestHash, '03'.repeat(32));

  const published = await readComposableV6PublicationSubmission({
    action: {
      id: 'chain.product.publish.fixture',
      authority: { signer: '0xb0b' },
      inputs: {
        originKind: 2,
        accessKind: 1,
        bindingKind: 1,
        priceAtomic: '0',
        makerEcosystemFeeBps: 0,
        transferable: false,
      },
    },
    submission: { transactionDigest: 'publish-digest' },
    suiClient: {
      async getTransaction() {
        return { events: [{
          type: '0xcafe::composition_v6::ItemProductPublishedV6',
          parsedJson: {
            product_id: '0x7',
            publisher: '0xb0b',
            origin_kind: 2,
            access_kind: 1,
            binding_kind: 1,
            price_atomic: '0',
            maker_ecosystem_fee_bps: 0,
            transferable: false,
          },
        }] };
      },
    },
  });
  assert.equal(published.productId, '0x7');

  const admitted = await readComposableV6PublicationSubmission({
    action: {
      id: 'chain.product.admit.fixture',
      inputs: {
        profileId: '0x6',
        productId: '0x7',
        validatorAttestationId: '0x9',
        originKind: 2,
      },
    },
    submission: { transactionDigest: 'admit-digest' },
    suiClient: {
      async getTransaction() {
        return { events: [{
          type: '0xcafe::composition_v6::ItemAdmittedV6',
          parsedJson: {
            profile_id: '0x6',
            product_id: '0x7',
            attestation_id: '0x9',
            source_kind: 2,
          },
        }] };
      },
    },
  });
  assert.equal(admitted.admissionReadback, true);
});

test('validator attestation readback requires exactly one created object', async () => {
  const confirmation = await readComposableV6PublicationSubmission({
    action: {
      id: 'chain.product.attest.fixture',
      inputs: {
        compositionProtocolConfigV6Id: '0x3',
        profileId: '0x6',
        productId: '0x7',
      },
    },
    submission: { transactionDigest: 'attest-digest' },
    suiClient: {
      async getTransaction() {
        return { objectTypes: {
          '0x99': '0xcafe::composition_v6::ValidatorAttestationV6',
        } };
      },
      async getObjects() {
        return { objects: [{ json: { fields: {
          config_id: '0x3',
          profile_id: '0x6',
          product_id: '0x7',
        } } }] };
      },
    },
  });
  assert.equal(confirmation.attestationId, '0x99');
});
