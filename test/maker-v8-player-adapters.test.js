import assert from 'node:assert/strict';
import test from 'node:test';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { createMakerV8SuiGrpcTransport } from '../maker-v8-sui-grpc.js';
import { TestTransport } from '@protobuf-ts/runtime-rpc';
import { MAKER_V8_PACK_DEFINITIONS_BCS, packDefinitionCommitmentV8 } from '../maker-v8-pack-definition-wire.js';
import { deriveMakerV8PackProfiles } from '../maker-v8-profile-wire.js';

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { deriveMakerV8NativeContentIdV8 } from '../maker-v8-native-content-identity.js';
import { nativeInitialInputFixture } from './fixtures/native-initial-content.js';
import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase58, toBase64, deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils';
import { IDBFactory } from 'fake-indexeddb';
import { EncryptedObject } from '@mysten/seal';
import { sha256 } from '@noble/hashes/sha2.js';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE } from '../maker-v8-seal-profile.js';
import { deriveMakerV8ProtectedAssetSealIdentityV8, MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA }
  from '../maker-v8-protected-transport.js';

import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  MAKER_V8_MAINNET_GENESIS_DIGEST,
  makerV8AttestedReplacement,
  makerV8ChainTypes,
  attestMakerV8Runtime,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_PLAYER_ACTIONS,
  MAKER_V8_PLAYER_CONTEXT_SCHEMA,
  makerV8PlayerRecipeCommitmentV8,
} from '../maker-v8-player-controller.js';
import {
  MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
  makerV8PlayerSelectionDependenciesV8,
  makerV8PlayerRequiresMakerAccessV8,
  assertMakerV8PlayerCompleteReadbackV8,
  certifyMakerV8PlayerFinalizedEventV8,
  assertMakerV8PlayerOwnedItemReadbackV8,
  assertMakerV8PlayerLoadoutLayoutV8,
  createProductionMakerV8PlayerAdaptersV8,
  createMakerV8PlayerBoundaryAdapterV8,
  createMakerV8PlayerCompilerAdapterV8,
  createMakerV8PlayerCustodyAdapterV8,
  createMakerV8PlayerPersistenceV8,
  createMakerV8PlayerProtectedContentAdapterV8,
  readMakerV8CompleteCountersV8,
  readMakerV8ExternalAdmissionsV8,
  readMakerV8PackStylesV8,
  readMakerV8PhysicalPolicyV8,
} from '../maker-v8-player-adapters.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
  makerV8StableType,
} from '../maker-v8-runtime.js';
import { nativeIntegrationFixture } from './fixtures/maker-v8-native-integration.js';
import { MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, deriveMakerV8NativeKioskItemIdV8 } from '../maker-v8-native-completion.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const MAKER_V8_MAINNET_SEAL_COMMITTEE = id(90); // Synthetic independent policy.
const digest = (fill) => toBase58(new Uint8Array(32).fill(fill));
const commitment = (fill) => fill.repeat(64);
const gasId = id(9_900);
const gasDigest = digest(9);
const nativeFixture = nativeIntegrationFixture(rawRuntime());
const runtime = (await attestMakerV8Runtime(nativeFixture.rpc, nativeFixture.config)).runtime;
const keypair = new Ed25519Keypair();
const signer = keypair.toSuiAddress();
const rootId = id(300);
const nativeInput = () => nativeInitialInputFixture({ name: 'Native Soul', description: 'Native Complete',
  mintNonce: '12'.repeat(16), expectedContentObjectId: deriveMakerV8NativeContentIdV8(runtime.nativeSoulIntegration, signer, '12'.repeat(16)),
  currentKioskId: null, currentKioskCapOnChainId: null, initialStateConfig: [],
  initialContent: [
    { kind: 0, name: 'soul', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(810), expectedVersionIndex: '0', encryptedEnvelope: 'ciphertext' },
    { kind: 1, name: 'default', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(811), expectedVersionIndex: '0', encryptedEnvelope: 'ciphertext' },
  ] }, runtime.nativeSoulIntegration.soulidityOriginalPackageId);

function protectedCipherFixture() {
  const identity = deriveMakerV8ProtectedAssetSealIdentityV8({
    schemaVersion: MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
    signer, scopeKind: 0, scopeKey: 'maker/base', assetKey: 'body/default/default',
    rootContentCommitment: commitment('2'), makerVersion: '1',
    releasePackageId: runtime.roles.release.typeOriginPackageId,
    productBindingCommitment: commitment('4'), policyCommitment: commitment('5'),
    sealPolicyConfigId: runtime.roleConfigIds.seal, assetContentCommitment: commitment('3'),
  });
  const ciphertextBytes = EncryptedObject.serialize({ version: 0, packageId: identity.packageId,
    id: identity.sealId, services: [[MAKER_V8_MAINNET_SEAL_COMMITTEE, 1]], threshold: 1,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96).fill(7),
      encryptedShares: [new Uint8Array(32).fill(8)], encryptedRandomness: new Uint8Array(32).fill(9) } },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(19).fill(5), aad: fromBase64(identity.aadBase64) } },
  }).toBytes();
  const ciphertextHash = Buffer.from(sha256(ciphertextBytes)).toString('hex');
  return { identity, ciphertextBytes, ciphertextHash, approval: {
    ...identity, selectionIndex: 0, source: 'BASE', signer,
    threshold: 1, serverConfigs: [{ objectId: MAKER_V8_MAINNET_SEAL_COMMITTEE, weight: 1 }],
    maxPlaintextBytes: 3 * 1024 * 1024, encryptionProfile: MAKER_V8_SEAL_ENCRYPTION_PROFILE,
    ciphertextBlobId: 'ciphertext-one', ciphertextSha256: ciphertextHash,
    transactionKindBytesBase64: toBase64(Uint8Array.from([1, 0, 0])),
    transactionKindSha256: commitment('9'), targets: [],
  }, ciphertext: { blobId: 'ciphertext-one', bytesBase64: toBase64(ciphertextBytes),
    byteLength: ciphertextBytes.length, sha256: ciphertextHash } };
}

test('protected Player decryptor binds live approval, wallet session, direct transport, and exact ciphertext', async () => {
  const { ciphertextBytes, ciphertextHash, approval } = protectedCipherFixture();
  const plaintext = Uint8Array.from([1, 2, 3]);
  const expectedPlaintext = toBase64(plaintext);
  const calls = [];
  const session = {
    getPersonalMessage: () => Uint8Array.from([4, 5, 6]),
    async setPersonalMessageSignature(value) { calls.push(['session-signature', value]); },
  };
  const adapter = createMakerV8PlayerProtectedContentAdapterV8({
    client: {},
    custody: {
      async resolveProtectedSelectionApproval(input) {
        calls.push(['approval', input.selectionIndex]);
        return approval;
      },
    },
    wallet: {
      async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
      subscribe(listener) { listener({ revision: 1 }); return () => {}; },
      async signExactPersonalMessage({ message, signer: requestedSigner }) {
        calls.push(['wallet', [...message], requestedSigner]);
        return { bytes: toBase64(message), signature: 'exact-personal-signature', signer: requestedSigner };
      },
    },
    async fetcher() { throw new Error('Injected Seal fixture should not contact the network'); },
    async createSessionKey(input) {
      calls.push(['session', input.address, input.packageId]);
      return session;
    },
    createSealClient({ sealFetch, serverConfigs }) {
      assert.equal(typeof sealFetch, 'function');
      assert.equal(serverConfigs[0].weight, 1);
      return {
        async getKeyServers() { calls.push(['servers']); },
        async decrypt({ data, sessionKey, txBytes, checkShareConsistency }) {
          calls.push(['decrypt', [...data], sessionKey === session, [...txBytes], checkShareConsistency]);
          return plaintext;
        },
      };
    },
  });
  const result = await adapter.decrypt({
    request: { action: 'PLAYER' },
    selectionIndex: 0,
    ciphertext: {
      blobId: 'ciphertext-one',
      bytesBase64: toBase64(ciphertextBytes),
      byteLength: ciphertextBytes.length,
      sha256: ciphertextHash,
    },
  });
  assert.equal(result.bytesBase64, expectedPlaintext);
  assert.deepEqual([...plaintext], [0, 0, 0]);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'approval', 'servers', 'session', 'approval', 'wallet', 'session-signature', 'approval', 'decrypt', 'approval',
  ]);

  await assert.rejects(
    adapter.decrypt({
      request: { action: 'PLAYER' },
      selectionIndex: 0,
      ciphertext: {
        blobId: 'ciphertext-one',
        bytesBase64: toBase64(Uint8Array.from([0, 8, 7, 6])),
        byteLength: ciphertextBytes.length,
        sha256: ciphertextHash,
      },
    }),
    { code: 'MAKER_V8_PLAYER_PROTECTED_CIPHERTEXT_DRIFT' },
  );
});

test('protected Player rejects the credential committee before Seal, session, or wallet prompt', async () => {
  const fixture = protectedCipherFixture();
  const committee = '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595';
  const parsed = EncryptedObject.parse(fixture.ciphertextBytes);
  parsed.services = [[committee, 1]];
  const bytes = EncryptedObject.serialize(parsed).toBytes();
  const hash = Buffer.from(sha256(bytes)).toString('hex');
  const approval = { ...fixture.approval, serverConfigs: [{ objectId: committee, weight: 1 }],
    ciphertextSha256: hash };
  let sideEffects = 0;
  const unexpected = () => { sideEffects++; throw Error('unexpected side effect'); };
  const adapter = createMakerV8PlayerProtectedContentAdapterV8({ client: {},
    custody: { async resolveProtectedSelectionApproval() { return approval; } },
    wallet: { async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
      subscribe(listener) { listener({ revision: 1 }); return () => {}; },
      signExactPersonalMessage: unexpected },
    createSessionKey: unexpected, createSealClient: unexpected, fetcher: unexpected,
  });
  await assert.rejects(adapter.decrypt({ request: {}, selectionIndex: 0,
    ciphertext: { ...fixture.ciphertext, bytesBase64: toBase64(bytes), byteLength: bytes.length, sha256: hash } }),
  { code: 'MAKER_V8_PROTECTED_BROWSER_TOPOLOGY_UNAVAILABLE' });
  assert.equal(sideEffects, 0);
});

test('protected Player rejects invalid ciphertext before any session or wallet prompt', async () => {
  for (const field of ['packageId', 'sealId', 'threshold', 'maxPlaintextBytes', 'encryptionProfile']) {
    const fixture = protectedCipherFixture();
    const bad = { ...fixture.approval, [field]: ({ packageId: runtime.roles.release.callablePackageId,
      sealId: commitment('0'), threshold: 2, maxPlaintextBytes: 2,
      encryptionProfile: { ...MAKER_V8_SEAL_ENCRYPTION_PROFILE, cipherSuite: 'wrong' } })[field] };
    let prompts = 0;
    const adapter = createMakerV8PlayerProtectedContentAdapterV8({ client: {},
      custody: { async resolveProtectedSelectionApproval() { return bad; } },
      wallet: { async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
        subscribe(listener) { listener({ revision: 1 }); return () => {}; },
        async signExactPersonalMessage() { prompts++; throw Error('unexpected prompt'); } },
      createSessionKey() { prompts++; throw Error('unexpected session'); },
    });
    await assert.rejects(adapter.decrypt({ request: {}, selectionIndex: 0, ciphertext: fixture.ciphertext }));
    assert.equal(prompts, 0, field);
  }
});

test('protected Player rereads before signing/decrypt/display and clears drifted or cancelled plaintext', async () => {
  for (const scenario of ['before-prompt', 'after-sign', 'after-decrypt', 'wallet-change', 'abort', 'reject-retry']) {
    const fixture = protectedCipherFixture();
    const plaintext = Uint8Array.from([1, 2, 3]);
    let reads = 0, signatures = 0, decrypts = 0, listener;
    const controller = new AbortController();
    const adapter = createMakerV8PlayerProtectedContentAdapterV8({ client: {},
      custody: { async resolveProtectedSelectionApproval() {
        reads++;
        const driftAt = { 'before-prompt': 2, 'after-sign': 3, 'after-decrypt': 4 }[scenario];
        return { ...fixture.approval, ...(reads === driftAt ? { transactionKindSha256: commitment('a') } : {}) };
      } },
      wallet: { async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
        subscribe(fn) { listener = fn; fn({ revision: 1 }); return () => { listener = null; }; },
        async signExactPersonalMessage() {
          signatures++;
          if (scenario === 'reject-retry' && signatures === 1) throw Object.assign(Error('rejected'), { code: 'REJECTED' });
          return { signature: 'signature' };
        } },
      createSessionKey() { return { getPersonalMessage: () => new Uint8Array([1]),
        async setPersonalMessageSignature() {} }; },
      createSealClient() { return { async getKeyServers() {}, async decrypt() {
        decrypts++;
        if (scenario === 'wallet-change') listener({ revision: 2 });
        if (scenario === 'abort') controller.abort();
        return plaintext;
      } }; },
    });
    await assert.rejects(adapter.decrypt({ request: {}, selectionIndex: 0,
      ciphertext: fixture.ciphertext, signal: controller.signal }), {
      code: scenario === 'reject-retry' ? 'REJECTED'
        : ['wallet-change', 'abort'].includes(scenario) ? 'MAKER_V8_PLAYER_PROTECTED_CANCELLED'
          : 'MAKER_V8_PLAYER_PROTECTED_APPROVAL_DRIFT',
    });
    assert.equal(listener, null);
    if (scenario === 'before-prompt') assert.equal(signatures, 0);
    if (scenario === 'after-sign') assert.equal(decrypts, 0);
    if (decrypts > 0) assert.deepEqual([...plaintext], [0, 0, 0]);
    if (scenario === 'reject-retry') {
      const result = await adapter.decrypt({ request: {}, selectionIndex: 0, ciphertext: fixture.ciphertext });
      assert.equal(result.bytesBase64, toBase64(new Uint8Array([1, 2, 3])));
      assert.equal(signatures, 2);
    }
  }
});

function rawRuntime() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: id(100 + index * 2),
        callablePackageId: id(101 + index * 2),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(200),
    protocolConfigId: id(201),
    protocolTreasuryId: id(202),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: id(210), runtime: id(211), output: id(212), physical: id(213),
      market: id(214), release: id(215),
    },
    makerBindings: [],
  };
}

function shared(objectId, fields = {}) {
  return {
    objectId,
    version: '7',
    digest: digest(Number(BigInt(objectId) % 200n) + 1),
    type: `${id(1)}::fixture::Shared`,
    owner: { kind: 'SHARED', initialSharedVersion: '1' },
    fields,
  };
}

function owned(objectId, fields = {}) {
  return {
    objectId,
    version: '7',
    digest: digest(Number(BigInt(objectId) % 200n) + 1),
    type: `${id(1)}::fixture::Owned`,
    owner: { kind: 'ADDRESS', address: signer },
    fields,
  };
}

const baseSelection = Object.freeze({
  selectionIndex: 0,
  source: 'BASE',
  partKey: 'body',
  itemKey: 'default',
  styleKey: 'default',
  trackKey: 'body-track',
  colorChannelKey: null,
  defaultSwatchKey: null,
  swatchKey: null,
  releaseId: null,
  semanticPackId: null,
  externalProductId: null,
  ownedExternalItemId: null,
});
const recipe = Object.freeze({
  schemaVersion: 'animacraft.maker-v8-player-recipe.v2',
  rootId,
  makerVersion: '1',
  rootContentCommitment: commitment('2'),
  selections: [baseSelection],
  colors: [],
  outputKey: 'portrait',
});
const loadout = Object.freeze({
  schemaVersion: 'animacraft.maker-v8-player-loadout.v2',
  rootId,
  makerVersion: '1',
  rootContentCommitment: commitment('2'),
  outputKey: 'portrait',
  selections: [Object.freeze({ ...baseSelection })],
  usedPacks: [],
  recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
});

function playerState({ makerLoadout = null, action, physical = false } = {}) {
  if (makerLoadout && makerLoadout.fields.commitment === undefined) {
    makerLoadout.fields.commitment = commitment('7');
  }
  if (makerLoadout) makerLoadout.fields.attached_pack_definitions ??= [];
  const makerAccess = owned(id(360), {
    root_id: rootId,
    maker_version: '1',
    root_content_commitment: commitment('2'),
    holder: signer,
  });
  const objects = {
    root: shared(rootId, { creator: signer, rights: {
      origin: 0, creator: signer, creator_confirmed: true, evidence_certified: false,
      certification_catalog_id: null, certification_binding_commitment: null,
      evidence_locator: '', evidence_blob_id: '', evidence_sha256: [], terms_commitment: [],
      commitment: commitment('a'), soul_creator_royalty_bps: '50',
      maker_source_royalty_bps: '25', maker_resale_royalty_bps: '100',
    } }),
    catalog: shared(runtime.catalogId),
    clock: shared(runtime.clockObjectId),
    protocolConfig: shared(runtime.protocolConfigId),
    protocolTreasury: shared(runtime.protocolTreasuryId),
    baseRegistry: shared(id(301)),
    makerTreasury: shared(id(302)),
    sealConfig: shared(runtime.roleConfigIds.seal),
    sealRegistry: shared(id(303), { runtime_revision: '0' }),
    runtimeConfig: shared(runtime.roleConfigIds.runtime),
    runtimeDefinitions: shared(id(304), {
      item_assetization: action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM,
    }),
    packRegistry: shared(id(305)),
    outputConfig: shared(runtime.roleConfigIds.output),
    outputRegistry: shared(id(307), { total_complete_count: '0' }),
    soulRegistry: shared(id(308)),
    physicalConfig: shared(runtime.roleConfigIds.physical),
    physicalRegistry: shared(id(309)),
    releaseConfig: shared(runtime.roleConfigIds.release),
    makerAccess: action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS ? null : makerAccess,
    ownedBaseItems: [],
    ownedExternalItems: [],
    externalProducts: [],
    makerLoadout,
    releases: [],
    packPasses: [],
    packTreasuries: [],
    soulBundle: null,
  };
  return {
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    rootInfo: {
      binding: {
        baseRegistryId: id(301), makerTreasuryId: id(302),
        sealPolicyConfigId: runtime.roleConfigIds.seal, sealRegistryId: id(303),
        runtimeDefinitionsId: id(304), packRegistryId: id(305), outputRegistryId: id(307),
        soulRegistryId: id(308), physicalRegistryId: id(309),
      },
      economics: {
        makerAccess: 0,
        makerPriceAtomic: '0',
        completeMode: 0,
        completePriceAtomic: '0',
        completeQuota: '0',
        completeTotalCap: '0',
        fixedCompleteFeeAtomic: '0',
      },
    },
    objects,
    currentSelections: makerLoadout ? [{
      selectionIndex: 0,
      partKey: 'body', itemKey: 'default', styleKey: 'default',
      swatchKey: null,
      sourceClass: 0, sourceDefinitionId: rootId, sourceSemanticId: '',
      accessSubject: id(360), sourceEpoch: '0',
      protected: false, assetContentCommitment: commitment('3'),
    }] : [],
    packStyles: [],
    protectedAssets: [],
    externalAdmissions: [],
    counters: { baseOrdinal: '0', packOrdinals: {} },
    physicalPolicy: physical ? {
      source: 'BASE', selectionIndex: 0, issuanceKind: 0, priceAtomic: '0',
      expectedIssuedCount: '0', policyCommitment: commitment('4'),
    } : null,
    protectedOutput: false,
    protectedSelections: false,
    protectedRequired: false,
  };
}

function requestFor(action) {
  const committed = [
    MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL,
  ].includes(action);
  const state = playerState({
    action,
    makerLoadout: committed ? owned(id(361), { revision: '1' }) : null,
    physical: action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL,
  });
  const input = action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM
    ? { partKey: 'body', itemKey: 'default' }
    : action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS
      ? { releaseId: id(370), semanticPackId: 'pack-one' }
      : action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
      ? { nativeSoul: nativeInput(), render: { blobId: 'render-blob', sha256: commitment('5'), blobCommitment: commitment('6'), byteLength: 32 } }
      : action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL
        ? { selectionIndex: 0, soulId: id(380), materializationKey: 'print-one' }
        : {};
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS) {
    const release = shared(input.releaseId, {
      access_kind: '0', access_price_atomic: '0', treasury_id: id(371),
    });
    state.objects.releases.push(release);
    state.objects.packTreasuries.push(shared(id(371)));
  }
  const context = {
    schemaVersion: MAKER_V8_PLAYER_CONTEXT_SCHEMA,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    network: MAKER_V8_CHAIN_NETWORK,
    action,
    account: signer,
    rootId,
    makerVersion: '1',
    rootContentCommitment: commitment('2'),
    lifecycle: 'ACTIVE',
    actionEligible: true,
    protectedContentRequired: false,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
    builderInput: state,
  };
  return {
    action,
    player: { rootId, makerVersion: '1', evidence: { contentCommitment: commitment('2') } },
    recipe,
    loadout,
    input,
    account: { address: signer, network: MAKER_V8_CHAIN_NETWORK },
    context,
  };
}

async function certifiedRequest(client, action, mutateState = null, mutateRequest = null) {
  const request = requestFor(action);
  if (mutateRequest) mutateRequest(request);
  if (mutateState) mutateState(request.context.builderInput);
  const state = request.context.builderInput;
  const custody = createMakerV8PlayerCustodyAdapterV8({
    client,
    runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    loadPlayerState: async () => state,
    assertTransport() {},
  });
  const projection = {
    action: request.action,
    player: request.player,
    recipe: request.recipe,
    loadout: request.loadout,
    input: request.input,
    account: request.account,
  };
  request.context = await custody.loadPlayerContext(projection);
  await custody.assertPlayerContext({ ...projection, context: request.context });
  return request;
}

async function externalCertifiedRequest(client, action, mutateState = null) {
  const request = requestFor(action);
  const productId = id(390);
  const ownedItemId = id(391);
  const externalSelection = {
    selectionIndex: 1,
    source: 'EXTERNAL',
    partKey: 'body',
    itemKey: 'external-hat',
    styleKey: 'violet',
    trackKey: 'body-track',
    colorChannelKey: null,
    defaultSwatchKey: null,
    swatchKey: null,
    releaseId: null,
    semanticPackId: null,
    externalProductId: productId,
    ownedExternalItemId: ownedItemId,
  };
  request.recipe = {
    ...structuredClone(recipe),
    selections: [structuredClone(baseSelection), Object.fromEntries(
      Object.entries(externalSelection).filter(([key]) => key !== 'selectionIndex' && key !== 'swatchKey'),
    )],
  };
  request.loadout = {
    ...structuredClone(loadout),
    selections: [structuredClone(baseSelection), externalSelection],
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe),
  };
  const committed = action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT;
  const state = playerState({
    action,
    makerLoadout: committed ? owned(id(361), { revision: '1' }) : null,
  });
  const product = shared(productId, {
    version: '8', root_id: rootId, root_version: '1',
    root_content_commitment: commitment('2'), lifecycle: '0',
    part_key: 'body', item_key: 'external-hat', style_key: 'violet',
    layer_track_key: 'body-track', color_channel_key: null,
    default_swatch_key: null, asset_blob_id: 'external-asset',
    asset_sha256: commitment('8'), asset_media_type: 'image/png',
    asset_byte_length: '32', asset_content_commitment: commitment('8'),
    compatibility_commitment: commitment('9'), content_commitment: commitment('a'),
  });
  // Keep the requested acquisition target while swapping only recipe content.
  state.objects.releases = request.context.builderInput.objects.releases;
  state.objects.packTreasuries = request.context.builderInput.objects.packTreasuries;
  const item = owned(ownedItemId, {
    version: '8', product_id: productId,
    product_content_commitment: commitment('a'),
    asset_content_commitment: commitment('8'), holder: signer,
    ownership_epoch: '0', transferable: true, equip_lock: committed
      ? { loadout_id: id(361), equip_revision: '1', selection_index: '1' } : null,
  });
  state.objects.externalProducts = [product];
  state.objects.ownedExternalItems = [item];
  state.externalAdmissions = [{
    productId,
    compatibilityCommitment: commitment('9'),
    productContentCommitment: commitment('a'),
    attestationCommitment: null,
    admittedRevision: '1',
    admissionState: 0,
  }];
  if (mutateState) mutateState(state);
  if (committed) {
    state.currentSelections = [
      ...state.currentSelections,
      {
        selectionIndex: 1, partKey: 'body', itemKey: 'external-hat', styleKey: 'violet',
        swatchKey: null, sourceClass: 2, sourceDefinitionId: productId,
        sourceSemanticId: '', accessSubject: ownedItemId, sourceEpoch: '0',
        protected: false, assetContentCommitment: commitment('8'),
      },
    ];
  }
  const custody = createMakerV8PlayerCustodyAdapterV8({
    client,
    runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    loadPlayerState: async () => state,
    assertTransport() {},
  });
  const projection = {
    action: request.action, player: request.player, recipe: request.recipe,
    loadout: request.loadout, input: request.input, account: request.account,
  };
  request.context = await custody.loadPlayerContext(projection);
  await custody.assertPlayerContext({ ...projection, context: request.context });
  return request;
}

function clientFixture() {
  return {
    async getDynamicField(input) {
      assert.equal(input.parentId, runtime.protocolConfigId);
      assert.equal(input.name.type, nativeFixture.keyType);
      return nativeFixture.field;
    },
    async getObject({ id: objectId }) {
      if (nativeFixture.objects.has(objectId)) return structuredClone(nativeFixture.objects.get(objectId));
      if ([id(810), id(811)].includes(objectId)) return { data: {
        objectId, version: '1', digest: digest(20), type: `${id(75)}::blob::Blob`,
        owner: { AddressOwner: signer }, content: { dataType: 'moveObject', fields: {} },
      } };
      return nativeFixture.rpc.getObject({ id: objectId });
    },
    async getChainIdentifier() {
      return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST };
    },
    core: {
      resolveTransactionPlugin() {
        return async (data, _options, next) => {
          data.gasData.owner = signer;
          data.gasData.budget = '1000000';
          data.gasData.price = '1';
          data.gasData.payment = [{ objectId: gasId, version: '1', digest: gasDigest }];
          await next();
        };
      },
      async getCurrentSystemState() { return { systemState: { epoch: '41' } }; },
      async simulateTransaction({ transaction }) {
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: TransactionDataBuilder.getDigestFromBytes(transaction),
            bcs: transaction,
            status: { success: true },
            effects: { transactionDigest: digest(7), status: { success: true } },
          },
        };
      },
    },
  };
}

function overviewReadFixture({ packKind = null, ownedAccess = false, assetized = false } = {}) {
  const source = playerState({ action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT });
  const chain = makerV8ChainTypes(runtime);
  const type = (role, module, name, generic = false) => makerV8StableType(runtime, role, module, name)
    + (generic ? `<${runtime.paymentCoinType}>` : '');
  const types = { ...chain, catalog: chain.productReleaseCatalog,
    clock: normalizeStructTag('0x2::clock::Clock'),
    protocolTreasury: type('core', 'protocol_config_v8', 'ProtocolTreasuryV8', true),
    baseRegistry: type('core', 'base_registry_v8', 'BaseDefinitionRegistryV8'),
    sealRegistry: type('seal', 'seal_v8', 'SealRegistryV8'),
    runtimeDefinitions: type('runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'),
    outputRegistry: type('output', 'output_v8', 'OutputRegistryV8'),
    soulRegistry: type('output', 'output_v8', 'SoulRegistryV8'),
  };
  const rootFields = source.objects.root.fields;
  Object.assign(rootFields, { version: '8', lifecycle: '1', maker_version: '1', admin_cap_id: id(399),
    core_original_package_id: runtime.roles.core.typeOriginPackageId,
    core_callable_package_id: runtime.roles.core.callablePackageId,
    content: { content_commitment: commitment('2'), renderer_commitment: commitment('3') },
    base_registry_id: id(301), maker_treasury_id: id(302),
    publication: { catalog_id: runtime.catalogId, sealed_base_registry_commitment: commitment('4'),
      registry_ids: { seal_registry_id: id(303), runtime_definition_registry_id: id(304), pack_registry_id: id(305),
        admission_authority_id: id(306), output_registry_id: id(307), soul_registry_id: id(308),
        physical_registry_id: id(309), market_registry_id: id(310) },
      release_commitments: { product_binding_commitment: makerV8AttestedReplacement(runtime).fields.package_tuple_commitment,
        call_cap_set_commitment: makerV8AttestedReplacement(runtime).fields.call_cap_set_commitment } },
    economics: { protocol_config_id: runtime.protocolConfigId, protocol_treasury_id: runtime.protocolTreasuryId,
      maker_access: '1', maker_price_atomic: '31', complete_mode: '2', complete_price_atomic: '13',
      complete_per_wallet_quota: '0', complete_total_cap: '9', fixed_complete_fee_atomic: '7' },
  });
  Object.assign(source.objects.protocolConfig.fields, { id: runtime.protocolConfigId, version: '8', enabled: true,
    revision: '1', commitment: commitment('5'), core_original_package_id: runtime.roles.core.typeOriginPackageId,
    core_callable_package_id: runtime.roles.core.callablePackageId,
    treasury_id: runtime.protocolTreasuryId, payment_coin_type: runtime.paymentCoinType });
  Object.assign(source.objects.catalog.fields, { id: runtime.catalogId, schema_revision: '2', protocol_config_id: runtime.protocolConfigId,
    protocol_config_revision: '1', protocol_config_commitment: commitment('5') });
  source.objects.runtimeDefinitions.fields.item_assetization = assetized;
  Object.assign(source.objects.outputRegistry.fields, { total_complete_count: '2', complete_by_wallet: { id: id(750) } });
  Object.assign(source.objects.packRegistry.fields, { root_id: rootId, root_version: '1', root_content_commitment: commitment('2'),
    releases: { id: id(751) }, revision: '1' });
  const pack = shared(id(370), { version: '8', lifecycle: '2', root_id: rootId, root_version: '1',
    root_content_commitment: commitment('2'), semantic_pack_id: 'pack-one', content_commitment: commitment('6'), treasury_id: id(371),
    access_kind: String(packKind ?? 0), access_price_atomic: packKind === 1 ? '17' : '0',
    complete_mode: '1', complete_price_atomic: '4', complete_free_quota_per_wallet: '1', complete_total_cap: '5', total_complete_count: '1',
    complete_by_wallet: { id: id(752) } });
  const ownedRows = [];
  if (ownedAccess) {
    ownedRows.push({ ...source.objects.makerAccess, type: types.makerAccess });
    if (packKind !== null) ownedRows.push({ ...owned(id(372), { version: '8', holder: signer, release_id: pack.objectId,
      root_id: rootId, root_version: '1', root_content_commitment: commitment('2'), release_content_commitment: commitment('6') }), type: types.packPass });
  }
  const snapshots = Object.entries(source.objects).filter(([name, value]) => types[name] && value && !Array.isArray(value));
  const objects = new Map(snapshots.map(([name, snapshot]) => [snapshot.objectId, { ...snapshot, type: types[name] }]));
  objects.set(pack.objectId, { ...pack, type: types.packRelease });
  objects.set(id(371), { ...shared(id(371)), type: type('runtime', 'runtime_v8', 'PackTreasuryV8', true) });
  const response = snapshot => ({ data: { objectId: snapshot.objectId, version: snapshot.version, digest: snapshot.digest,
    type: snapshot.type, owner: snapshot.owner.kind === 'ADDRESS' ? { AddressOwner: snapshot.owner.address }
      : { Shared: { initialSharedVersion: snapshot.owner.initialSharedVersion } }, content: { dataType: 'moveObject', fields: structuredClone(snapshot.fields) } } });
  const reads = [];
  const controls = { admissionState: 0, malformedPage: false, pageFailure: false, ordinal: '1' };
  const field = (parentId, name, valueType, bytes) => ({ kind: 'DynamicField',
    fieldId: deriveDynamicFieldID(parentId, name.type, fromBase64(name.bcsBase64)),
    type: `0x2::dynamic_field::Field<${name.type},${valueType}>`, name, value: { type: valueType, bcsBase64: toBase64(bytes) } });
  const client = { async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getObject({ id: objectId }) { controls.onGetObject?.(objectId); reads.push(objectId); assert.ok(objects.has(objectId), 'No Native Blob, compiler or unrelated custody read'); return response(objects.get(objectId)); },
    async getOwnedObjects({ owner, filter }) {
      assert.equal(owner, signer);
      if (controls.pageFailure) throw new Error('OWNED_READ_FAILED');
      return { data: ownedRows.filter(row => row.type === filter.StructType).map(response),
        ...(controls.malformedPage ? {} : { hasNextPage: false, nextCursor: null }) };
    },
    async getDynamicField({ parentId, name }) {
      if (parentId === runtime.protocolConfigId) return field(parentId, name,
        type('core', 'protocol_config_v8', 'ProductReleaseCatalogSlotV2'), bcs.struct('slot', { catalog_id: bcs.Address }).serialize({ catalog_id: runtime.catalogId }).toBytes());
      if (parentId === id(751)) return field(parentId, name,
        type('runtime', 'runtime_v8', 'PackAdmissionRecordV8'), bcs.struct('admission', {
          release_id: bcs.Address, semantic_pack_id: bcs.string(), release_content_commitment: bcs.vector(bcs.u8()),
          admitted_revision: bcs.u64(), admission_state: bcs.u8(),
        }).serialize({ release_id: id(370), semantic_pack_id: 'pack-one', release_content_commitment: Array.from({ length: 32 }, () => 0x66),
          admitted_revision: '1', admission_state: controls.admissionState }).toBytes());
      assert.ok([id(750), id(752)].includes(parentId));
      return field(parentId, name, 'u64', bcs.u64().serialize(controls.ordinal).toBytes());
    },
  };
  const request = { player: { rootId, makerVersion: '1', evidence: { makerVersion: '1', contentCommitment: commitment('2'), rendererCommitment: commitment('3') },
    document: { parts: [{ key: 'body', items: [{ key: 'default', styles: [{ key: 'default', protected: false }] }] }], outputs: [{ key: 'portrait', protected: false }] } },
    recipe: structuredClone(recipe), loadout: structuredClone(loadout), account: { address: signer, network: 'mainnet' } };
  if (packKind !== null) {
    const selected = { ...baseSelection, selectionIndex: 1, source: 'PACK', releaseId: id(370), semanticPackId: 'pack-one' };
    request.recipe.selections.push({ ...selected }); request.loadout.selections.push({ ...selected });
    request.loadout.usedPacks.push({ releaseId: id(370), semanticPackId: 'pack-one' });
    request.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(request.recipe);
  }
  const custody = createMakerV8PlayerCustodyAdapterV8({ client, runtime, loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {},
    loadPackStyles: async ({ selections }) => selections.map(row => ({ selectionIndex: row.selectionIndex,
      releaseId: row.releaseId, semanticPackId: row.semanticPackId, partKey: row.partKey, itemKey: row.itemKey,
      styleKey: row.styleKey, trackKey: row.trackKey, swatchKey: row.swatchKey, protected: false,
      assetContentCommitment: commitment('3'), styleCommitment: commitment('4'),
      ...(controls.ownedDefinitions ? { ownedDefinitions: structuredClone(controls.ownedDefinitions) } : {}),
      definitionSources: { part: controls.ownedPart ? 2 : 1, track: controls.ownedTrack ? 2 : 1, color: row.colorChannelKey === null ? null : controls.ownedColor ? 2 : 1 } })) });
  return { custody, request, source, objects, ownedRows, types, controls, reads, client };
}

test('completion quote accepts canonical gRPC Base64 commitments without changing the quote', async () => {
  const h = overviewReadFixture({ ownedAccess: true, assetized: true });
  const expected = await h.custody.quotePlayerCompletion(h.request);
  const grpcHashes = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.includes('commitment') || key.endsWith('_sha256')) {
        if (typeof child === 'string' && /^[0-9a-f]{64}$/.test(child)) value[key] = toBase64(Buffer.from(child, 'hex'));
        else if (Array.isArray(child) && child.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) value[key] = toBase64(Uint8Array.from(child));
        else grpcHashes(child);
      } else grpcHashes(child);
    }
  };
  for (const object of h.objects.values()) grpcHashes(object.fields);
  for (const object of h.ownedRows) grpcHashes(object.fields);
  assert.deepEqual(await h.custody.quotePlayerCompletion(h.request), expected);
});

test('completion quote rejects malformed gRPC hashes and validly encoded commitment drift', async () => {
  const valid = toBase64(Buffer.alloc(32, 4));
  for (const value of [toBase64(Buffer.alloc(31)), toBase64(Buffer.alloc(33)),
    valid.slice(0, -1), ` ${valid}`, `${valid}\n`, 'not-a-hash']) {
    const h = overviewReadFixture({ ownedAccess: true });
    h.objects.get(rootId).fields.publication.sealed_base_registry_commitment = value;
    await assert.rejects(h.custody.quotePlayerCompletion(h.request), { code: 'MAKER_V8_PLAYER_HASH_INVALID' });
  }
  const h = overviewReadFixture({ ownedAccess: true });
  h.objects.get(rootId).fields.content.content_commitment = toBase64(Buffer.alloc(32, 0xff));
  await assert.rejects(h.custody.quotePlayerCompletion(h.request), { code: 'MAKER_V8_PLAYER_ROOT_DRIFT' });
});

test('current Player custody resolves attachment-only Packs and validates their scoped slots', async () => {
  const h = overviewReadFixture({ packKind: 0, ownedAccess: true });
  h.request.recipe = structuredClone(recipe);
  h.request.loadout = structuredClone(loadout);
  const bundleRows = { semantic_pack_id: 'pack-one', tracks: [], colors: [], rules: [], visibility: [],
    parts: [{ sequence: '0', key: 'plume', label: 'Plume', kind: 0, render_order: '0', menu_order: '0', visible: true,
      required: false, slot_mode: 1, capacity: '2', track_keys: [], visibility_tokens: [],
      visibility_commitment: Array(32).fill(1), payload_commitment: Array(32).fill(2) }] };
  const content = Array(32).fill(0x66);
  const bindingHash = [...packDefinitionCommitmentV8(id(370), content, bundleRows)];
  const profile = deriveMakerV8PackProfiles({ contentCommitment: commitment('6'), rows: bundleRows }, 1)[0];
  Object.assign(h.objects.get(id(304)).fields, { version: '8', sealed: true, admission_ceiling: '1',
    root_id: rootId, root_version: '1', root_content_commitment: commitment('2'), base_registry_id: id(301) });
  const current = { ...owned(id(365), { version: '8', root_id: rootId, root_version: '1', root_content_commitment: commitment('2'),
    definition_registry_id: id(304), pack_registry_id: id(305), holder: signer, revision: '2', commitment: commitment('7'),
    attached_pack_definitions: [{ release_id: id(370), definition_commitment: bindingHash }],
    definition_slots: [
      { source_definition_id: rootId, part_key: 'body', start: '0', capacity: '1', profile_commitment: commitment('5') },
      { source_definition_id: id(370), part_key: 'plume', start: '1', capacity: '2', profile_commitment: profile.profileCommitment },
    ], selections: [null, null, null] }), type: h.types.makerLoadout };
  h.ownedRows.push(current);
  const originalDynamic = h.client.getDynamicField;
  h.client.getDynamicField = async input => {
    if (input.parentId !== id(370)) return originalDynamic(input);
    const valueType = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackDefinitionsV8`;
    return { kind: 'DynamicField', name: input.name,
      fieldId: deriveDynamicFieldID(input.parentId, input.name.type, fromBase64(input.name.bcsBase64)),
      type: `0x2::dynamic_field::Field<${input.name.type},${valueType}>`, value: { type: valueType,
        bcsBase64: toBase64(MAKER_V8_PACK_DEFINITIONS_BCS.serialize({ version: 8, release_id: id(370),
          release_content_commitment: content, rows: bundleRows, commitment: bindingHash }).toBytes()) } };
  };
  const read = () => h.custody.loadPlayerContext({ ...h.request, action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, input: {} });
  const context = await read();
  assert.equal(context.builderInput.objects.releases[0].objectId, id(370));
  assert.equal(context.builderInput.objects.packPasses.length, 1);
  assert.deepEqual(context.builderInput.currentSelections, [null, null, null]);
  assert.deepEqual(h.request.loadout.usedPacks, []);
  const original = structuredClone(current.fields);
  for (const mutate of [
    fields => { fields.definition_slots[1].profile_commitment = commitment('9'); },
    fields => { fields.definition_slots[1].source_definition_id = id(999); },
    fields => { fields.definition_slots[1].capacity = '1'; },
    fields => { fields.definition_slots.reverse(); },
  ]) {
    current.fields = structuredClone(original); mutate(current.fields);
    await assert.rejects(read(), { code: 'MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID' });
  }
  current.fields = structuredClone(original);
  current.fields.attached_pack_definitions[0].definition_commitment = commitment('9');
  await assert.rejects(read(), { code: 'MAKER_V8_PACK_DEFINITIONS_READBACK_INVALID' });
});

test('all-Base authored Style bundle survives custody and reaches the Commit attachment caller', async () => {
  const h = overviewReadFixture({ packKind: 0, ownedAccess: true });
  h.controls.ownedDefinitions = { releaseId: id(370), semanticPackId: 'pack-one', contentCommitment: commitment('6'),
    definitionCommitment: commitment('8'), rows: { parts: [] } };
  h.objects.get(id(304)).fields.admission_ceiling = '1';
  const request = { ...h.request, action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, input: {} };
  request.context = await h.custody.loadPlayerContext(request);
  assert.deepEqual(request.context.builderInput.packStyles[0].ownedDefinitions, h.controls.ownedDefinitions);
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client: clientFixture(), runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const prepared = await compiler.preparePlayerAction(request);
  const commands = Transaction.fromKind(fromBase64(prepared.plan.descriptor.kindBytes)).getData().commands;
  assert.equal(commands.filter(row => row.MoveCall?.function === 'attach_pack_definitions_v8').length, 1);
  assert.equal(prepared.plan.descriptor.expected.packDefinitionLayout.bindings[0].definitionCommitment, commitment('8'));
});

test('owned Pack readback cannot bypass the exact definition bundle requirement', async () => {
  const h = overviewReadFixture({ packKind: 0, ownedAccess: true });
  h.controls.ownedPart = true;
  h.controls.ownedDefinitions = {};
  await assert.rejects(h.custody.loadPlayerContext({ ...h.request,
    action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, input: {} }),
  { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID' });
});

test('Pack-owned Part survives custody and reaches Commit with its own slot profile', async () => {
  const h = overviewReadFixture({ packKind: 0, ownedAccess: true });
  h.controls.ownedPart = true;
  for (const row of [...h.request.recipe.selections, ...h.request.loadout.selections]) {
    if (row.source === 'PACK') row.partKey = 'plume';
  }
  h.controls.ownedDefinitions = { releaseId: id(370), semanticPackId: 'pack-one', contentCommitment: commitment('6'),
    definitionCommitment: commitment('8'), rows: { parts: [{ sequence: '0', key: 'plume',
      required: false, slot_mode: 0, capacity: '1', payload_commitment: Array(32).fill(2) }] } };
  h.objects.get(id(304)).fields.admission_ceiling = '1';
  const request = { ...h.request, action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, input: {} };
  request.context = await h.custody.loadPlayerContext(request);
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client: clientFixture(), runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const prepared = await compiler.preparePlayerAction(request);
  const commands = Transaction.fromKind(fromBase64(prepared.plan.descriptor.kindBytes)).getData().commands;
  const attached = commands.findIndex(row => row.MoveCall?.function === 'attach_pack_definitions_v8');
  assert.ok(attached >= 0 && attached < commands.findIndex(row => row.MoveCall?.function === 'select_pack_style_v8'));
  const profile = prepared.plan.descriptor.expected.packDefinitionLayout.profiles[0];
  assert.equal(profile.releaseId, id(370)); assert.equal(profile.partKey, 'plume'); assert.equal(profile.capacity, '1');
  const valid = structuredClone(h.controls.ownedDefinitions);
  for (const mutate of [
    bundle => { bundle.rows.parts = []; },
    bundle => { bundle.rows.parts.push(structuredClone(bundle.rows.parts[0])); },
    bundle => { bundle.rows.parts[0].key = 'foreign'; },
    bundle => { bundle.releaseId = id(999); },
  ]) {
    h.controls.ownedDefinitions = structuredClone(valid); mutate(h.controls.ownedDefinitions);
    await assert.rejects(h.custody.loadPlayerContext(request), { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID' });
  }
  h.controls.ownedDefinitions = structuredClone(valid);
  h.controls.ownedColor = true;
  h.controls.ownedDefinitions.rows.colors = [{ key: 'primary', swatches: [{ key: 'red' }, { key: 'blue' }] }];
  request.recipe = structuredClone(request.recipe); request.loadout = structuredClone(request.loadout);
  for (const row of [...request.recipe.selections, ...request.loadout.selections]) {
    if (row.source === 'PACK') { row.colorChannelKey = 'primary'; row.defaultSwatchKey = 'red'; row.swatchKey = 'blue'; }
  }
  request.context = await h.custody.loadPlayerContext(request);
  assert.equal(request.context.builderInput.packStyles[0].swatchKey, 'blue');
  await compiler.preparePlayerAction(request);
  h.controls.ownedDefinitions.rows.colors[0].swatches = [{ key: 'red' }];
  await assert.rejects(h.custody.loadPlayerContext(request), { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID' });
});

test('Pack-owned Track survives custody and gets attached before the real Commit selection call', async () => {
  const h = overviewReadFixture({ packKind: 0, ownedAccess: true });
  h.controls.ownedTrack = true;
  for (const row of [...h.request.recipe.selections, ...h.request.loadout.selections]) {
    if (row.source === 'PACK') row.trackKey = 'pack-overlay';
  }
  h.controls.ownedDefinitions = { releaseId: id(370), semanticPackId: 'pack-one', contentCommitment: commitment('6'),
    definitionCommitment: commitment('8'), rows: { parts: [], tracks: [{ key: 'pack-overlay' }] } };
  h.objects.get(id(304)).fields.admission_ceiling = '1';
  const request = { ...h.request, action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, input: {} };
  request.context = await h.custody.loadPlayerContext(request);
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client: clientFixture(), runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const prepared = await compiler.preparePlayerAction(request);
  const commands = Transaction.fromKind(fromBase64(prepared.plan.descriptor.kindBytes)).getData().commands;
  const attached = commands.findIndex(row => row.MoveCall?.function === 'attach_pack_definitions_v8');
  assert.ok(attached >= 0 && attached < commands.findIndex(row => row.MoveCall?.function === 'select_pack_style_v8'));
  h.controls.ownedDefinitions.rows.tracks = [];
  await assert.rejects(h.custody.loadPlayerContext(request), { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID' });
});

test('completion overview reads current unowned entry policies, exact counters and only actually used Packs without preparing a transaction', async () => {
  for (const packKind of [null, 0, 1, 2]) for (const ownedAccess of [false, true]) {
    const h = overviewReadFixture({ packKind, ownedAccess, assetized: true });
    const quote = await h.custody.quotePlayerCompletion(h.request);
    const entry = (ownedAccess ? 0n : 31n) + (!ownedAccess && packKind === 1 ? 17n : 0n);
    assert.equal(quote.entryPaymentQuote.maker.required, !ownedAccess);
    assert.equal(quote.entryPaymentQuote.maker.priceAtomic, ownedAccess ? '0' : '31');
    assert.equal(quote.entryPaymentQuote.totalAmountAtomic, entry.toString());
    assert.equal(quote.completePaymentQuote.totalAmountAtomic, packKind === null ? '20' : '24');
    assert.equal(quote.totalBusinessAmountAtomic, (entry + (packKind === null ? 20n : 24n)).toString());
    assert.deepEqual(quote.entryPaymentQuote.baseItems, [{ partKey: 'body', itemKey: 'default', required: true, priceAtomic: '0', ownedObjectId: null }]);
    assert.equal(quote.entryPaymentQuote.packs.length, packKind === null ? 0 : 1);
    if (packKind !== null) assert.equal(quote.entryPaymentQuote.packs[0].required, !ownedAccess);
    assert.equal(quote.completePaymentQuote.maker.remainingTotalUses, '7');
    assert.equal('builderInput' in quote, false);
    await assert.rejects(h.custody.assertPlayerContext({ ...h.request, action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: {}, context: quote }),
      { code: 'MAKER_V8_PLAYER_CUSTODY_PROOF_REQUIRED' });
    if (!ownedAccess) await assert.rejects(h.custody.loadPlayerContext({ ...h.request, action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: {} }));
  }
});

test('completion overview rejects incomplete owned reads, foreign ownership, revoked admission and exhausted totals', async () => {
  for (const mutate of [
    h => { h.controls.malformedPage = true; },
    h => { h.controls.pageFailure = true; },
    h => { h.ownedRows[0].owner.address = id(999); },
    h => { h.ownedRows.push(structuredClone(h.ownedRows[0])); },
    h => { h.ownedRows[0].fields.root_content_commitment = commitment('f'); },
    h => { h.controls.admissionState = 1; },
    h => { h.objects.get(id(307)).fields.total_complete_count = '9'; },
  ]) {
    const h = overviewReadFixture({ packKind: 1, ownedAccess: true }); mutate(h);
    await assert.rejects(h.custody.quotePlayerCompletion(h.request));
  }
});

test('completion overview recognizes held Base Items and refuses a price changed during its two reads', async () => {
  const h = overviewReadFixture({ ownedAccess: true, assetized: true });
  h.ownedRows.push({ ...owned(id(375), { version: '8', holder: signer, root_id: rootId, root_version: '1',
    root_content_commitment: commitment('2'), part_key: 'body', item_key: 'default' }), type: h.types.ownedBaseItem });
  const quote = await h.custody.quotePlayerCompletion(h.request);
  assert.deepEqual(quote.entryPaymentQuote.baseItems, [{ partKey: 'body', itemKey: 'default', required: false,
    priceAtomic: '0', ownedObjectId: id(375) }]);
  let rootReads = 0;
  h.controls.onGetObject = objectId => {
    if (objectId === rootId && ++rootReads === 2) h.objects.get(rootId).fields.economics.maker_price_atomic = '32';
  };
  await assert.rejects(h.custody.quotePlayerCompletion(h.request), { code: 'MAKER_V8_PLAYER_QUOTE_CHANGED' });
});

test('acquisition reads only its entitlement while recipe execution retains all ownership dependencies', () => {
  const loadout = {
    selections: [{ source: 'PACK', releaseId: id(801) }, { source: 'EXTERNAL', externalProductId: id(802) }],
    usedPacks: [{ releaseId: id(801), semanticPackId: 'unowned-preview-pack' }],
  };
  const original = structuredClone(loadout);
  for (const action of [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM]) {
    const scope = makerV8PlayerSelectionDependenciesV8(action, loadout);
    assert.equal(scope.executesSelections, false);
    assert.deepEqual(scope.selections, []);
    assert.equal(scope.releases.size, 0);
  }
  const pack = makerV8PlayerSelectionDependenciesV8(MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS, loadout,
    { releaseId: id(803), semanticPackId: 'requested-pack' });
  assert.deepEqual(pack.selections, []);
  assert.deepEqual([...pack.releases], [[id(803), 'requested-pack']]);
  for (const action of [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]) {
    const scope = makerV8PlayerSelectionDependenciesV8(action, loadout);
    assert.equal(scope.executesSelections, true);
    assert.deepEqual(scope.selections, original.selections);
    assert.deepEqual([...scope.releases], [[id(801), 'unowned-preview-pack']]);
  }
  assert.deepEqual(loadout, original);
  assert.throws(() => makerV8PlayerSelectionDependenciesV8('unknown', loadout), /Unknown Player action/);
});

test('Pack entry depends on Maker entry only for included-with-Maker policy', async () => {
  const action = MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS;
  const client = clientFixture();
  client.core.getBalance = async () => ({ balance: {
    balance: '1000', coinBalance: '1000', addressBalance: '0',
  } });
  client.core.listCoins = async () => ({ objects: [{
    objectId: id(799), version: '1', digest: digest(9), balance: '1000',
  }], hasNextPage: false, cursor: null });
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client, runtime, loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {},
  });
  for (const kind of [0, 1]) {
    assert.equal(makerV8PlayerRequiresMakerAccessV8(action, kind), false);
    const request = await certifiedRequest(client, action, state => {
      state.objects.makerAccess = null;
      state.objects.releases[0].fields.access_kind = String(kind);
      state.objects.releases[0].fields.access_price_atomic = kind === 1 ? '25' : '0';
    });
    const result = await compiler.preparePlayerAction(request);
    assert.deepEqual(result.plan.descriptor.expected.packEntryQuote, {
      releaseId: request.input.releaseId,
      kind,
      priceAtomic: kind === 1 ? '25' : '0',
      paymentCoinType: runtime.paymentCoinType,
      requiresMakerAccess: false,
    });
    assert.ok(result.plan.targets.some(target => target.endsWith(
      kind === 0 ? '::issue_free_pack_pass_v8' : '::purchase_pack_pass_v8')));
  }
  assert.equal(makerV8PlayerRequiresMakerAccessV8(action, 2), true);
  const included = await certifiedRequest(client, action, state => {
    state.objects.releases[0].fields.access_kind = '2';
  });
  const includedResult = await compiler.preparePlayerAction(included);
  assert.deepEqual(includedResult.plan.descriptor.expected.packEntryQuote, {
    releaseId: included.input.releaseId, kind: 2, priceAtomic: '0',
    paymentCoinType: runtime.paymentCoinType, requiresMakerAccess: true,
  });
  assert.ok(includedResult.plan.targets.some(target => target.endsWith('::issue_included_pack_pass_v8')));
  await assert.rejects(certifiedRequest(client, action, state => {
    state.objects.makerAccess = null;
    state.objects.releases[0].fields.access_kind = '2';
  }), error => error.code === 'MAKER_V8_PLAYER_MAKER_ACCESS_REQUIRED');
  assert.throws(() => makerV8PlayerRequiresMakerAccessV8(action, 3),
    error => error.code === 'MAKER_V8_PLAYER_PACK_ACCESS_POLICY_INVALID');
  await assert.rejects(certifiedRequest(client, action, state => {
    state.objects.releases[0].fields.access_kind = '3';
  }), error => error.code === 'MAKER_V8_PLAYER_PACK_ACCESS_POLICY_INVALID');
  for (const other of [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM,
    MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]) {
    assert.equal(makerV8PlayerRequiresMakerAccessV8(other), true);
    await assert.rejects(certifiedRequest(client, other, state => {
      state.objects.makerAccess = null;
    }), error => error.code === 'MAKER_V8_PLAYER_MAKER_ACCESS_REQUIRED');
  }
});

test('custody acquisition does not require external recipe ownership, but execution still does', async () => {
  const withoutExternalAuthority = state => {
    state.objects.externalProducts = [];
    state.objects.ownedExternalItems = [];
    state.externalAdmissions = [];
  };
  for (const action of [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]) {
    await externalCertifiedRequest(clientFixture(), action, withoutExternalAuthority);
  }
  for (const action of [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]) {
    await assert.rejects(externalCertifiedRequest(clientFixture(), action, withoutExternalAuthority),
      error => error.code === 'MAKER_V8_PLAYER_EXTERNAL_PRODUCT_REQUIRED');
  }
});

function storageManager() {
  return {
    async persisted() { return true; },
    async persist() { return true; },
    async estimate() { return { quota: 100_000_000, usage: 0 }; },
  };
}

test('production compiler emits exact multi-call v8 grammar for all six public Player actions', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client,
    runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport(value) { assert.equal(value, client); },
  });
  const expected = {
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS]: [
      'treasury_v8::claim_free_maker_access_v8',
    ],
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM]: [
      'runtime_v8::claim_owned_base_item_v8',
      'runtime_v8::transfer_new_owned_base_item_to_holder_v8',
    ],
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]: [
      'runtime_v8::issue_free_pack_pass_v8',
      'runtime_v8::transfer_pack_pass_to_holder_v8',
    ],
    [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT]: [
      'runtime_v8::create_maker_loadout_v8',
      'runtime_v8::select_base_style_v8',
      'runtime_v8::transfer_maker_loadout_to_holder_v8',
    ],
    [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]: [
      'runtime_v8::prove_base_selection_v8',
      'runtime_v8::seal_ordered_selection_proofs_v8',
      'coin::zero',
      'output_v8::begin_complete_v8',
      'release_v8::finish_unprotected_complete_v8',
      'kiosk::new', 'personal_kiosk::new', 'market::ensure_personal_kiosk_registered_v2',
      'market::new_initial_content_entry', 'market::new_initial_content_entry',
      'market::mint_animacraft_v8_in_personal_kiosk', 'market::finalize_soul_state',
      'transfer::public_share_object', 'personal_kiosk::transfer_to_sender',
    ],
    [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]: [
      'runtime_v8::prove_base_selection_v8',
      'runtime_v8::certify_physical_selection_v8',
      'physical_v8::claim_free_base_style_v8',
      'physical_v8::transfer_new_physical_asset_to_holder_v8',
    ],
  };
  for (const action of Object.values(MAKER_V8_PLAYER_ACTIONS)) {
    const request = await certifiedRequest(client, action);
    const result = await compiler.preparePlayerAction(request);
    assert.equal(result.authority, compiler.authority);
    assert.deepEqual(
      result.plan.targets.map((target) => target.split('::').slice(1).join('::')),
      expected[action],
    );
    assert.equal(result.plan.descriptor.kindSha256.length, 64);
    assert.equal(result.plan.descriptor.expected.signer, signer);
    if (action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
      assert.equal(result.plan.descriptor.expected.ownedOutputTypes.length, 6);
      assert.equal(result.plan.descriptor.expected.ownedOutputTypes.at(-1), MAKER_V8_NATIVE_KIOSK_ITEM_TYPE);
    }
    const txData = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
    const calls = txData.commands.map((command) => command.MoveCall).filter(Boolean)
      .filter((call) => Object.values(runtime.roles)
        .some((role) => role.callablePackageId === call.package));
    const nonGeneric = new Set([
      'transfer_pack_pass_to_holder_v8', 'transfer_maker_loadout_to_holder_v8',
      'transfer_new_owned_base_item_to_holder_v8',
      'clear_non_external_selection_v8', 'certify_physical_selection_v8',
      'seal_ordered_selection_proofs_v8', 'transfer_new_physical_asset_to_holder_v8',
    ]);
    for (const call of calls) {
      assert.deepEqual(
        call.typeArguments,
        nonGeneric.has(call.function) ? [] : [runtime.paymentCoinType],
        `${call.module}::${call.function} type arguments`,
      );
    }
    const objectArg = argument => {
      const object = txData.inputs[argument.Input]?.Object;
      return object?.SharedObject?.objectId ?? object?.ImmOrOwnedObject?.objectId;
    };
    if (action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
      const nativeMint = txData.commands.find(command => command.MoveCall?.function === 'mint_animacraft_v8_in_personal_kiosk').MoveCall;
      assert.equal(nativeMint.arguments.length, 18);
      assert.equal(nativeMint.package, runtime.nativeSoulIntegration.soulidityCallablePackageId);
      assert.deepEqual(nativeMint.typeArguments, [runtime.paymentCoinType]);
      assert.deepEqual([0, 1, 2, 3, 6, 7, 8, 9].map(index => objectArg(nativeMint.arguments[index])), [
        runtime.nativeSoulIntegration.marketConfigV2Id, runtime.nativeSoulIntegration.kindRegistryId,
        runtime.nativeSoulIntegration.kioskRegistryId, runtime.nativeSoulIntegration.soulTransferPolicyId,
        rootId, runtime.protocolConfigId, id(307), id(308),
      ]);
      const finish = calls.find(call => call.function === 'finish_unprotected_complete_v8');
      assert.equal(finish.arguments.length, 11);
      assert.deepEqual(finish.arguments.slice(1, 8).map(objectArg), [
        id(307), rootId, runtime.protocolConfigId, runtime.catalogId,
        makerV8AttestedReplacement(runtime).objectId, runtime.roleConfigIds.release, id(361),
      ]);
      const replacementInput = txData.inputs[finish.arguments[5].Input].Object;
      assert.deepEqual(replacementInput.ImmOrOwnedObject, {
        objectId: makerV8AttestedReplacement(runtime).objectId,
        version: makerV8AttestedReplacement(runtime).version.toString(),
        digest: makerV8AttestedReplacement(runtime).digest,
      });
    }
    if (action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL) {
      const claim = calls.find(call => call.function === 'claim_free_base_style_v8');
      assert.equal(claim.arguments.length, 9);
      assert.deepEqual(claim.arguments.slice(0, 6).map(objectArg), [
        id(309), rootId, runtime.protocolConfigId, runtime.catalogId,
        makerV8AttestedReplacement(runtime).objectId, runtime.roleConfigIds.physical,
      ]);
    }
    await assert.doesNotReject(() => compiler.assertPlayerActionFresh({
      ...request,
      plan: result.plan,
    }));
  }
});

test('Maker entry quote uses the same free or exact paid policy as its transaction', async () => {
  const client = clientFixture();
  client.core.getBalance = async () => ({ balance: { balance: '1000', coinBalance: '1000', addressBalance: '0' } });
  client.core.listCoins = async () => ({ objects: [{ objectId: id(799), version: '1', digest: digest(9), balance: '1000' }], hasNextPage: false, cursor: null });
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  for (const kind of [0, 1]) {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS, state => {
      Object.assign(state.rootInfo.economics, { makerAccess: kind, makerPriceAtomic: '17' });
    });
    const result = await compiler.preparePlayerAction(request);
    assert.deepEqual(result.plan.descriptor.expected.makerEntryQuote,
      { rootId, kind, priceAtomic: kind === 0 ? '0' : '17', paymentCoinType: runtime.paymentCoinType });
    const data = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
    const call = data.commands.map(row => row.MoveCall).find(row => row?.function === (kind === 0 ? 'claim_free_maker_access_v8' : 'purchase_maker_access_v8'));
    assert.ok(call);
    if (kind === 1) {
      const payment = call.arguments[4].NestedResult;
      const split = data.commands[payment[0]].SplitCoins;
      assert.equal(bcs.u64().parse(fromBase64(data.inputs[split.amounts[payment[1]].Input].Pure.bytes)), '17');
    }
  }
});

test('Complete transaction encodes the selected alternate Output rather than a default', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, null, request => {
    request.recipe = { ...structuredClone(request.recipe), outputKey: 'alternate-output' };
    request.loadout = { ...structuredClone(request.loadout), outputKey: 'alternate-output',
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe) };
  });
  const result = await compiler.preparePlayerAction(request);
  const data = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
  const begin = data.commands.map(row => row.MoveCall).find(row => row?.function === 'begin_complete_v8');
  assert.ok(begin);
  assert.equal(bcs.string().parse(fromBase64(data.inputs[begin.arguments[1].Input].Pure.bytes)), 'alternate-output');
});

test('Complete preparation preserves gRPC empty and populated optional rights hashes', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  for (const value of ['', toBase64(Buffer.alloc(32, 0xcc))]) {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, state => {
      Object.assign(state.objects.root.fields.rights, { evidence_sha256: value, terms_commitment: value,
        commitment: toBase64(Buffer.from(commitment('a'), 'hex')) });
    });
    const result = await compiler.preparePlayerAction(request);
    const rights = result.plan.descriptor.expected.completePaymentQuote.rights;
    assert.equal(rights.evidenceSha256, value === '' ? null : 'cc'.repeat(32));
    assert.equal(rights.termsCommitment, value === '' ? null : 'cc'.repeat(32));
    assert.equal(rights.commitment, commitment('a'));
  }
  for (const key of ['evidence_sha256', 'terms_commitment']) {
    for (const value of [undefined, null, ' ', toBase64(Buffer.alloc(31)), toBase64(Buffer.alloc(33))]) {
      const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
        state => {
          if (value === undefined) delete state.objects.root.fields.rights[key];
          else state.objects.root.fields.rights[key] = value;
        });
      await assert.rejects(compiler.preparePlayerAction(request), { code: 'MAKER_V8_PLAYER_HASH_INVALID' });
    }
  }
  const missingRequired = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    state => { state.objects.root.fields.rights.commitment = ''; });
  await assert.rejects(compiler.preparePlayerAction(missingRequired), { code: 'MAKER_V8_PLAYER_HASH_INVALID' });
});

test('Complete quote separates true total limits from wallet quota and preserves exact Root rights', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, state => {
    state.rootInfo.economics.completeTotalCap = '9007199254740993';
    state.objects.outputRegistry.fields.total_complete_count = '9007199254740992';
    Object.assign(state.objects.root.fields.rights, { origin: 1, evidence_certified: true,
      certification_catalog_id: { vec: [runtime.catalogId] },
      certification_binding_commitment: { vec: [commitment('b')] },
      evidence_locator: 'walrus://rights-evidence', evidence_blob_id: 'rights-evidence',
      evidence_sha256: commitment('c'), terms_commitment: commitment('d') });
  });
  const quote = (await compiler.preparePlayerAction(request)).plan.descriptor.expected.completePaymentQuote;
  assert.equal(quote.maker.totalCap, '9007199254740993');
  assert.equal(quote.maker.totalCompleted, '9007199254740992');
  assert.equal(quote.maker.remainingTotalUses, '1');
  assert.equal(quote.maker.remainingFreeUses, null);
  assert.deepEqual(quote.rights, { origin: 1, creator: signer, creatorConfirmed: true, evidenceCertified: true,
    certificationCatalogId: runtime.catalogId, certificationBindingCommitment: commitment('b'),
    evidenceLocator: 'walrus://rights-evidence', evidenceBlobId: 'rights-evidence',
    evidenceSha256: commitment('c'), termsCommitment: commitment('d'),
    soulCreatorRoyaltyBps: '50', makerSourceRoyaltyBps: '25', makerResaleRoyaltyBps: '100', commitment: commitment('a') });
  for (const mutate of [
    state => { state.rootInfo.economics.completeTotalCap = '1'; state.objects.outputRegistry.fields.total_complete_count = '1'; },
    state => { delete state.objects.outputRegistry.fields.total_complete_count; },
    state => { delete state.rootInfo.economics.completeTotalCap; },
    state => { delete state.objects.root.fields.rights.creator_confirmed; },
    state => { delete state.objects.root.fields.rights.terms_commitment; },
    state => { delete state.objects.root.fields.rights.certification_catalog_id; },
  ]) {
    const invalid = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, mutate);
    await assert.rejects(compiler.preparePlayerAction(invalid));
  }
  const unlimited = (await compiler.preparePlayerAction(await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT)))
    .plan.descriptor.expected.completePaymentQuote;
  assert.equal(unlimited.maker.remainingTotalUses, null);
  assert.equal(unlimited.rights.termsCommitment, null);
  assert.equal(unlimited.rights.evidenceLocator, '');
});

test('Complete payment quote shares exact policy and fixed-fee amounts with the prepared transaction', async () => {
  const client = clientFixture();
  client.core.getBalance = async () => ({ balance: { balance: '18446744073709551615', coinBalance: '18446744073709551615', addressBalance: '0' } });
  client.core.listCoins = async () => ({ objects: [{ objectId: id(799), version: '1', digest: digest(9), balance: '18446744073709551615' }], hasNextPage: false, cursor: null });
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  for (const [mode, ordinal, content, remaining] of [
    [0, '0', '0', null], [1, '1', '0', '1'],
    [1, '2', '9007199254740993', '0'], [2, '0', '9007199254740993', null],
    [3, '1', '0', '1'],
  ]) {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, state => {
      Object.assign(state.rootInfo.economics, { completeMode: mode,
        completePriceAtomic: '9007199254740993', completeQuota: '2', fixedCompleteFeeAtomic: '7' });
      state.counters.baseOrdinal = ordinal;
    });
    const result = await compiler.preparePlayerAction(request);
    const quote = result.plan.descriptor.expected.completePaymentQuote;
    assert.equal(quote.maker.contentAmountAtomic, content);
    assert.equal(quote.maker.fixedFeeAtomic, '7');
    assert.equal(quote.totalAmountAtomic, (BigInt(content) + 7n).toString());
    assert.equal(quote.maker.remainingFreeUses, remaining);
    assert.equal(quote.maker.walletCompleted, [1, 3].includes(mode) ? ordinal : null);
    assert.deepEqual(quote.packs, []);
    const data = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
    const split = data.commands.find(command => command.SplitCoins)?.SplitCoins;
    assert.ok(split, 'even free content pays its fixed fee');
    const amount = data.inputs[split.amounts[0].Input].Pure.bytes;
    assert.equal(bcs.u64().parse(fromBase64(amount)), quote.totalAmountAtomic);
  }
  const exhausted = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, state => {
    Object.assign(state.rootInfo.economics, { completeMode: 3, completeQuota: '2' });
    state.counters.baseOrdinal = '2';
  });
  await assert.rejects(compiler.preparePlayerAction(exhausted), { code: 'MAKER_V8_PLAYER_COMPLETE_QUOTA_EXHAUSTED' });
});

test('historical Loadout layout verifies persisted attachment evidence without latest-state reads', () => {
  const expected = { bindings: [370, 380].map(n => ({ releaseId: id(n), definitionCommitment: commitment('8') })),
    profiles: [370, 380].map(n => ({ releaseId: id(n), partKey: 'plume', capacity: '1', profileCommitment: commitment('9') })) };
  // Same Part name in two different Releases must remain two distinct slots.
  const fields = { rootId, attachedPackDefinitions: expected.bindings.map(row => ({
    release_id: row.releaseId, definition_commitment: row.definitionCommitment })),
    definitionSlots: [{ source_definition_id: rootId, part_key: 'body', start: '0', capacity: '1', profile_commitment: commitment('5') },
      ...expected.profiles.map((row, index) => ({ source_definition_id: row.releaseId, part_key: row.partKey,
        start: String(index + 1), capacity: row.capacity, profile_commitment: row.profileCommitment }))],
    selections: [null, null, null] };
  const coldExpected = JSON.parse(JSON.stringify(expected));
  assert.deepEqual(assertMakerV8PlayerLoadoutLayoutV8(fields, coldExpected), [null, null, null]);
  for (const mutate of [
    value => { value.attachedPackDefinitions.reverse(); },
    value => { value.attachedPackDefinitions[0].definition_commitment = commitment('7'); },
    value => { value.attachedPackDefinitions.pop(); },
    value => { value.definitionSlots[1].profile_commitment = commitment('7'); },
    value => { value.definitionSlots[2].source_definition_id = id(370); },
    value => { value.definitionSlots[1].capacity = '2'; },
    value => { value.definitionSlots[1].start = '2'; },
    value => { value.definitionSlots.pop(); value.selections.pop(); },
  ]) {
    const changed = structuredClone(fields); mutate(changed);
    assert.throws(() => assertMakerV8PlayerLoadoutLayoutV8(changed, coldExpected), { code: 'MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID' });
  }
  assert.throws(() => assertMakerV8PlayerLoadoutLayoutV8(fields, undefined), { code: 'MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID' });
});

test('Commit attaches authored Pack once before selection and preserves existing bindings', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const selected = [0, 1].map(selectionIndex => ({ ...baseSelection, selectionIndex,
    source: 'PACK', releaseId: id(370), semanticPackId: 'pack-one' }));
  const bundle = { releaseId: id(370), semanticPackId: 'pack-one',
    contentCommitment: commitment('6'), definitionCommitment: commitment('8'), rows: { parts: [] } };
  const prepare = async (existing, mismatch = false) => {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, state => {
      state.objects.releases = [shared(id(370), { content_commitment: commitment('6') })];
      state.objects.runtimeDefinitions.fields.admission_ceiling = '1';
      state.objects.packPasses = [owned(id(372), { release_id: id(370) })];
      state.packStyles = selected.map(row => ({ ...row, protected: false,
        assetContentCommitment: commitment('3'), ownedDefinitions: structuredClone(bundle) }));
      state.currentSelections = [];
      state.objects.makerLoadout = existing ? owned(id(365), { revision: '5', commitment: commitment('7'),
        definition_slots: [],
        attached_pack_definitions: [{ release_id: id(370), definition_commitment: commitment(mismatch ? '9' : '8') }] }) : null;
    }, request => {
      request.recipe = { ...recipe, selections: selected.map(row => ({ ...row })) };
      request.loadout = { ...loadout, selections: selected.map(row => ({ ...row })),
        usedPacks: [{ releaseId: id(370), semanticPackId: 'pack-one' }],
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe) };
    });
    return compiler.preparePlayerAction(request);
  };
  for (const existing of [false, true]) {
    const result = await prepare(existing);
    assert.equal(result.plan.descriptor.expected.ownedItemTransitions.finalLoadoutRevision, existing ? '7' : '3');
    assert.deepEqual(result.plan.descriptor.expected.packDefinitionLayout, {
      bindings: [{ releaseId: id(370), definitionCommitment: commitment('8') }], profiles: [],
    });
    const data = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
    const calls = data.commands.map(row => row.MoveCall).filter(Boolean);
    const attachments = calls.filter(row => row.function === 'attach_pack_definitions_v8');
    assert.equal(attachments.length, existing ? 0 : 1);
    const readU64 = argument => bcs.u64().parse(fromBase64(data.inputs[argument.Input].Pure.bytes));
    if (!existing) {
      const call = attachments[0];
      assert.deepEqual(call.typeArguments, [runtime.paymentCoinType]);
      assert.equal(call.arguments.length, 8);
      assert.equal(call.arguments[0].Result, 0);
      assert.equal(readU64(call.arguments[7]), '0');
      const objectIds = call.arguments.slice(1, 7).map(argument => {
        const object = data.inputs[argument.Input].Object;
        return (object.SharedObject ?? object.ImmOrOwnedObject).objectId;
      });
      assert.deepEqual(objectIds, [rootId, id(304), id(305), id(370), id(372), id(360)]);
      assert.ok(calls.indexOf(call) < calls.findIndex(row => row.function === 'select_pack_style_v8'));
    }
    const selections = calls.filter(row => row.function === 'select_pack_style_v8');
    assert.equal(selections.length, 2);
    assert.deepEqual(selections.map(row => readU64(row.arguments[8])), existing ? ['5', '6'] : ['1', '2']);
  }
  await assert.rejects(prepare(true, true), { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID' });
  bundle.rows.parts = [{ sequence: '0', key: 'plume', required: false, slot_mode: 1,
    capacity: '2', payload_commitment: Array(32).fill(2) }];
  const withOwnedPart = await prepare(false);
  assert.deepEqual(withOwnedPart.plan.descriptor.expected.packDefinitionLayout.profiles,
    deriveMakerV8PackProfiles(bundle, 1).map(profile => ({ ...profile, releaseId: id(370) })));
});

test('Commit orders new attachments canonically rather than by the first selection', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const selected = [0, 1].map(index => ({ ...baseSelection, selectionIndex: index, source: 'PACK',
    releaseId: id(370 + index), semanticPackId: index === 0 ? 'z-pack' : 'a-pack' }));
  const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, state => {
    state.objects.releases = selected.map(row => shared(row.releaseId, { content_commitment: commitment('6') }));
    state.objects.runtimeDefinitions.fields.admission_ceiling = '1';
    state.objects.packPasses = selected.map((row, index) => owned(id(372 + index), { release_id: row.releaseId }));
    state.packStyles = selected.map(row => ({ ...row, protected: false, assetContentCommitment: commitment('3'),
      ownedDefinitions: { releaseId: row.releaseId, semanticPackId: row.semanticPackId, contentCommitment: commitment('6'),
        definitionCommitment: commitment('8'), rows: { parts: [] } } }));
    state.currentSelections = []; state.objects.makerLoadout = null;
  }, request => {
    request.recipe = { ...recipe, selections: selected.map(row => ({ ...row })) };
    request.loadout = { ...loadout, selections: selected.map(row => ({ ...row })),
      usedPacks: [...selected].reverse().map(row => ({ releaseId: row.releaseId, semanticPackId: row.semanticPackId })),
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe) };
  });
  const prepared = await compiler.preparePlayerAction(request);
  assert.deepEqual(prepared.plan.descriptor.expected.packDefinitionLayout.bindings.map(row => row.releaseId), [id(371), id(370)]);
  const data = Transaction.fromKind(fromBase64(prepared.plan.descriptor.kindBytes)).getData();
  const attached = data.commands.filter(row => row.MoveCall?.function === 'attach_pack_definitions_v8');
  assert.deepEqual(attached.map(row => data.inputs[row.MoveCall.arguments[4].Input].Object.SharedObject.objectId), [id(371), id(370)]);
});

test('Complete proves every attachment in stored order without charging unselected Packs', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const populate = state => {
    state.objects.makerLoadout.fields.attached_pack_definitions = [392, 390].map(n => ({
      release_id: id(n), definition_commitment: Array(32).fill(n % 255),
    }));
    // Reverse inventory order deliberately: binding_index follows the Loadout,
    // not discovery order or usedPacks (which is empty in this Base recipe).
    state.objects.releases = [390, 392].map(n => shared(id(n)));
    state.objects.packPasses = [390, 392].map(n => owned(id(n + 1), { release_id: id(n) }));
  };
  const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, populate);
  const result = await compiler.preparePlayerAction(request);
  const data = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
  const calls = data.commands.map(command => command.MoveCall);
  const proofs = calls.map((call, index) => ({ call, index }))
    .filter(({ call }) => call?.function === 'prove_attached_pack_definitions_v8');
  assert.equal(proofs.length, 2);
  for (const [{ call }, releaseId, passId, bindingIndex] of [
    [proofs[0], id(392), id(393), 0], [proofs[1], id(390), id(391), 1],
  ]) {
    assert.equal(call.package, runtime.roles.runtime.callablePackageId);
    assert.deepEqual(call.typeArguments, [runtime.paymentCoinType]);
    assert.equal(call.arguments.length, 9);
    const ids = call.arguments.slice(0, 8).map(arg => {
      const object = data.inputs[arg.Input].Object;
      return (object.SharedObject ?? object.ImmOrOwnedObject).objectId;
    });
    assert.deepEqual(ids, [request.context.builderInput.objects.makerLoadout.objectId,
      id(304), id(301), rootId, id(305), releaseId, passId, id(360)]);
    assert.equal(bcs.u64().parse(fromBase64(data.inputs[call.arguments[8].Input].Pure.bytes)), String(bindingIndex));
  }
  const vecIndex = data.commands.findIndex(command => command.MakeMoveVec?.type?.includes('PackDefinitionProofV8'));
  assert.deepEqual(data.commands[vecIndex].MakeMoveVec.elements, proofs.map(({ index }) => ({ Result: index, $kind: 'Result' })));
  const seal = calls.find(call => call?.function === 'seal_ordered_selection_proofs_v8');
  assert.equal(seal.arguments[3].Result, vecIndex);
  assert.equal(calls.some(call => ['append_paid_pack_complete_v8', 'append_free_pack_complete_v8'].includes(call?.function)), false);
  for (const [mutate, code] of [
    [state => { state.objects.releases.pop(); }, 'MAKER_V8_PLAYER_RELEASE_CONTEXT_INVALID'],
    [state => { state.objects.packPasses.pop(); }, 'MAKER_V8_PLAYER_PACK_CONTEXT_INVALID'],
    [state => { state.objects.makerLoadout.fields.attached_pack_definitions.push(
      structuredClone(state.objects.makerLoadout.fields.attached_pack_definitions[0])); }, 'MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID'],
    [state => { delete state.objects.makerLoadout.fields.attached_pack_definitions; }, 'MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID'],
  ]) {
    const invalid = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
      state => { populate(state); mutate(state); });
    await assert.rejects(compiler.preparePlayerAction(invalid), { code });
  }
});

test('current Pack completion and all Physical issuance ABIs use certified replacement in exact positions', async () => {
  const client = clientFixture();
  client.core.getBalance = async () => ({ balance: { balance: '1000', coinBalance: '1000', addressBalance: '0' } });
  client.core.listCoins = async () => ({ objects: [{ objectId: id(799), version: '1', digest: digest(9), balance: '1000' }], hasNextPage: false, cursor: null });
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  const replacementId = makerV8AttestedReplacement(runtime).objectId;
  const packSelection = { ...baseSelection, source: 'PACK', releaseId: id(370), semanticPackId: 'pack-one' };
  const packRequest = request => {
    request.recipe = { ...recipe, selections: [{ ...packSelection }] };
    request.loadout = { ...loadout, selections: [{ ...packSelection }],
      usedPacks: [{ releaseId: id(370), semanticPackId: 'pack-one' }],
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe) };
  };
  const addPack = (state, paid) => {
    state.objects.releases = [shared(id(370), { treasury_id: id(371), complete_mode: paid ? '2' : '0',
      complete_price_atomic: paid ? '10' : '0', complete_free_quota_per_wallet: '0',
      complete_total_cap: '0', total_complete_count: '0' })];
    state.objects.packPasses = [owned(id(372), { release_id: id(370) })];
    state.objects.packTreasuries = [shared(id(371))];
    state.packStyles = [{ ...packSelection, protected: false, assetContentCommitment: commitment('3') }];
    state.currentSelections = [{ ...state.currentSelections[0], sourceClass: 1,
      sourceDefinitionId: id(370), sourceSemanticId: 'pack-one', accessSubject: id(372), sourceEpoch: '0' }];
    state.counters.packOrdinals = { [id(370)]: '0' };
  };
  const callData = (result, functionName) => {
    const data = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
    const call = data.commands.map(command => command.MoveCall).find(row => row?.function === functionName);
    const ids = call.arguments.map(argument => {
      const object = data.inputs[argument.Input]?.Object;
      return object?.SharedObject?.objectId ?? object?.ImmOrOwnedObject?.objectId ?? null;
    });
    return { data, call, ids };
  };
  for (const [mode, ordinal, paid] of [
    [0, '0', false], [2, '0', true], [1, '0', false], [1, '1', true], [3, '0', false],
  ]) {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
      state => {
        addPack(state, paid);
        Object.assign(state.objects.releases[0].fields, { complete_mode: String(mode),
          complete_price_atomic: mode === 0 || mode === 3 ? '0' : '10', complete_free_quota_per_wallet: '1',
          complete_total_cap: '7', total_complete_count: '5' });
        state.counters.packOrdinals[id(370)] = ordinal;
      }, packRequest);
    const result = await compiler.preparePlayerAction(request);
    const { data, call, ids } = callData(result, paid ? 'append_paid_pack_complete_v8' : 'append_free_pack_complete_v8');
    const quote = result.plan.descriptor.expected.completePaymentQuote;
    assert.equal(quote.paymentCoinType, runtime.paymentCoinType);
    assert.equal(quote.totalAmountAtomic, paid ? '10' : '0');
    assert.equal(quote.packs.length, 1);
    assert.equal(quote.packs[0].releaseId, id(370));
    assert.equal(quote.packs[0].amountAtomic, paid ? '10' : '0');
    assert.equal(quote.packs[0].totalCap, '7');
    assert.equal(quote.packs[0].totalCompleted, '5');
    assert.equal(quote.packs[0].remainingTotalUses, '2');
    assert.equal(quote.packs[0].walletCompleted, [1, 3].includes(mode) ? ordinal : null);
    assert.equal(quote.packs[0].remainingFreeUses, [1, 3].includes(mode) ? (1n - BigInt(ordinal)).toString() : null);
    assert.equal(call.arguments.length, paid ? 15 : 12);
    assert.deepEqual(ids.slice(1, paid ? 11 : 12), [runtime.roleConfigIds.output, id(307), rootId,
      runtime.catalogId, ...(!paid ? [runtime.protocolConfigId] : []), replacementId,
      runtime.roleConfigIds.runtime, id(370), id(305), id(372), id(361)]);
    if (paid) {
      assert.deepEqual(ids.slice(11, 14), [id(371), runtime.protocolConfigId, runtime.protocolTreasuryId]);
      const payment = call.arguments.at(-1).NestedResult;
      const split = data.commands[payment[0]].SplitCoins;
      assert.equal(bcs.u64().parse(fromBase64(data.inputs[split.amounts[payment[1]].Input].Pure.bytes)), quote.packs[0].amountAtomic);
    }
  }
  const unlimitedPack = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    state => addPack(state, false), packRequest);
  assert.equal((await compiler.preparePlayerAction(unlimitedPack)).plan.descriptor.expected.completePaymentQuote.packs[0].remainingTotalUses, null);
  for (const mutate of [
    state => Object.assign(state.objects.releases[0].fields, { complete_total_cap: '1', total_complete_count: '1' }),
    state => { delete state.objects.releases[0].fields.total_complete_count; },
    state => { delete state.objects.releases[0].fields.complete_total_cap; },
  ]) {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, state => {
      addPack(state, false); mutate(state);
    }, packRequest);
    await assert.rejects(compiler.preparePlayerAction(request));
  }
  for (const source of ['BASE', 'PACK']) for (const kind of [0, 1, 2]) {
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL, state => {
      if (source === 'PACK') addPack(state, false);
      state.physicalPolicy = { ...state.physicalPolicy, source, issuanceKind: kind, priceAtomic: kind === 1 ? '10' : '0' };
      if (kind === 2) state.objects.soulBundle = { receipt: owned(id(381)), soul: owned(id(380)) };
    }, source === 'PACK' ? packRequest : null);
    const result = await compiler.preparePlayerAction(request);
    const functionName = `${kind === 0 ? 'claim_free' : kind === 1 ? 'purchase' : 'materialize'}_${source.toLowerCase()}_style_v8`;
    const { call, ids } = callData(result, functionName);
    const prefix = [id(309), rootId, ...(kind !== 1 ? [runtime.protocolConfigId] : []),
      runtime.catalogId, replacementId, runtime.roleConfigIds.physical];
    assert.deepEqual(ids.slice(0, prefix.length), prefix, functionName);
    assert.equal(call.arguments.length, source === 'PACK' ? (kind === 1 ? 15 : 13) : (kind === 1 ? 12 : 9), functionName);
    if (kind === 1) assert.deepEqual(ids.slice(prefix.length, prefix.length + (source === 'PACK' ? 6 : 3)),
      source === 'PACK' ? [id(305), id(370), id(371), id(372), runtime.protocolConfigId, runtime.protocolTreasuryId]
        : [runtime.protocolConfigId, runtime.protocolTreasuryId, id(302)]);
  }
});

test('custody rejects a replacement supplied outside certified immutable runtime authority', async () => {
  await assert.rejects(certifiedRequest(clientFixture(), MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    state => { state.objects.replacement = shared(id(999)); }),
  { code: 'MAKER_V8_PLAYER_REPLACEMENT_DRIFT' });
});

test('new transaction and protected read route distinct live protocol eligibility flags', async () => {
  const client = clientFixture();
  const request = requestFor(MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT);
  const state = request.context.builderInput;
  state.protectedOutput = true; state.protectedRequired = true;
  state.objects.root.fields = { maker_version: '1', content: { content_commitment: commitment('2') } };
  state.objects.sealConfig.fields = { product_binding_commitment: commitment('4'), commitment: commitment('5') };
  const flags = [];
  const custody = createMakerV8PlayerCustodyAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {},
    loadPlayerState: async input => { flags.push(input.requireCurrentProtocol); return state; },
  });
  const context = await custody.loadPlayerContext(request);
  assert.equal(context.actionEligible, true);
  await custody.resolveProtectedOutputIdentity(request);
  assert.deepEqual(flags, [true, false]);
});

test('protected Output Complete uses the exact Release-Seal same-PTB bridge and durable identity', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  const request = await certifiedRequest(
    client,
    MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    (state) => {
      state.protectedOutput = true;
      state.protectedRequired = true;
    },
  );
  const result = await compiler.preparePlayerAction(request);
  assert.deepEqual(
    result.plan.targets.map((target) => target.split('::').slice(1).join('::')),
    [
    'runtime_v8::prove_base_selection_v8',
    'runtime_v8::seal_ordered_selection_proofs_v8',
    'coin::zero',
    'output_v8::begin_complete_v8',
    'release_v8::finish_protected_complete_v8',
    'kiosk::new', 'personal_kiosk::new', 'market::ensure_personal_kiosk_registered_v2',
    'market::new_initial_content_entry', 'market::new_initial_content_entry',
    'market::mint_animacraft_v8_in_personal_kiosk', 'market::finalize_soul_state',
    'transfer::public_share_object', 'personal_kiosk::transfer_to_sender',
    ],
  );
  assert.equal(result.plan.descriptor.expected.protectedOutput, true);
  const protectedData = Transaction.fromKind(fromBase64(result.plan.descriptor.kindBytes)).getData();
  const sealProofs = protectedData.commands.map(command => command.MoveCall)
    .find(call => call?.function === 'seal_ordered_selection_proofs_v8');
  assert.equal(sealProofs.arguments.length, 5);
  const attachmentVector = protectedData.commands[sealProofs.arguments[3].Result].MakeMoveVec;
  assert.match(attachmentVector.type, /::runtime_v8::PackDefinitionProofV8$/);
  assert.deepEqual(attachmentVector.elements, []);
  const protectedFinish = protectedData.commands.map(command => command.MoveCall)
    .find(call => call?.function === 'finish_protected_complete_v8');
  assert.equal(protectedFinish.arguments.length, 15);
  assert.equal(protectedData.inputs[protectedFinish.arguments[5].Input].Object.SharedObject.objectId,
    runtime.roleConfigIds.release);
  assert.equal(result.plan.descriptor.expected.sealRegistryId, id(303));
  assert.equal(result.plan.descriptor.expected.sealRuntimeRevision, '0');
  assert.equal(result.plan.descriptor.expected.sealScopeKey, 'complete/portrait');
  assert.equal(
    result.plan.descriptor.expected.sealAssetKey,
    `receipt-${signer.slice(2)}-0`,
  );
});

test('protected Base, owned Base and Pack approval use actual single Release Input-only ABI', async () => {
  for (const source of ['BASE', 'OWNED_BASE', 'PACK']) {
    const client = clientFixture();
    const request = requestFor(MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT);
    const state = request.context.builderInput;
    const isPack = source === 'PACK';
    const slotIndex = source === 'OWNED_BASE' ? 7 : 0;
    const selection = { ...baseSelection, selectionIndex: slotIndex, ...(isPack
      ? { source: 'PACK', releaseId: id(370), semanticPackId: 'pack-one' } : {}) };
    request.loadout = { ...request.loadout, selections: [selection] };
    state.objects.root.fields = { maker_version: '1', content: { content_commitment: commitment('2') } };
    const profile = MAKER_V8_SEAL_ENCRYPTION_PROFILE;
    state.objects.sealConfig.fields = { product_binding_commitment: commitment('4'), commitment: commitment('5'),
      threshold: '1', key_servers: [{ key_server_id: MAKER_V8_MAINNET_SEAL_COMMITTEE, weight: '1' }],
      max_plaintext_bytes: '3145728', cipher_suite: profile.cipherSuite,
      key_derivation: profile.keyDerivation, ciphertext_format: profile.ciphertextFormat };
    state.objects.runtimeDefinitions.fields.item_assetization = source === 'OWNED_BASE';
    if (source === 'OWNED_BASE') state.objects.ownedBaseItems = [owned(id(365), {
      part_key: 'body', item_key: 'default' })];
    if (isPack) {
      state.objects.releases = [shared(id(370))];
      state.objects.packPasses = [owned(id(372), { release_id: id(370) })];
      state.packStyles = [{ ...selection, protected: true }];
    }
    const scopeKind = isPack ? 1 : 0, scopeKey = isPack ? 'pack/pack-one' : 'maker/base';
    const identity = deriveMakerV8ProtectedAssetSealIdentityV8({
      schemaVersion: MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
      signer, scopeKind, scopeKey, assetKey: 'body/default/default',
      rootContentCommitment: commitment('2'), makerVersion: '1',
      releasePackageId: runtime.roles.release.typeOriginPackageId,
      productBindingCommitment: commitment('4'), policyCommitment: commitment('5'),
      sealPolicyConfigId: runtime.roleConfigIds.seal, assetContentCommitment: commitment('3'),
    });
    state.protectedAssets = [{ source: selection.source, selectionIndex: slotIndex, scopeKind, scopeKey,
      assetKey: 'body/default/default', assetContentCommitment: commitment('3'),
      ciphertextBlobId: 'ciphertext-one', ciphertextSha256: commitment('8'),
      ciphertextBlobCommitment: commitment('9'), certificationCommitment: commitment('a'), sealId: identity.sealId }];
    const custody = createMakerV8PlayerCustodyAdapterV8({ client, runtime,
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {},
      loadPlayerState: async () => state });
    const approval = await custody.resolveProtectedSelectionApproval({ ...request, selectionIndex: slotIndex });
    const data = Transaction.fromKind(fromBase64(approval.transactionKindBytesBase64)).getData();
    assert.equal(data.commands.length, 1);
    const call = data.commands[0].MoveCall;
    assert.equal(call.package, runtime.roles.release.callablePackageId);
    assert.equal(call.module, 'release_v8');
    assert.equal(call.function, `seal_approve_${source.toLowerCase()}_v8`);
    assert.deepEqual(call.typeArguments, [runtime.paymentCoinType]);
    assert.equal(call.arguments.length, { BASE: 17, OWNED_BASE: 19, PACK: 21 }[source]);
    assert.ok(call.arguments.every(argument => argument.$kind === 'Input'));
    assert.equal(Buffer.from(bcs.byteVector().parse(fromBase64(data.inputs[call.arguments[0].Input].Pure.bytes))).toString('hex'), identity.sealId);
    const objectId = argument => {
      const object = data.inputs[argument.Input].Object;
      return object?.SharedObject?.objectId ?? object?.ImmOrOwnedObject?.objectId;
    };
    assert.deepEqual(call.arguments.slice(1, isPack ? 11 : source === 'OWNED_BASE' ? 12 : 10).map(objectId),
      [runtime.roleConfigIds.release, id(361), ...(isPack
        ? [id(305), id(370), id(372), runtime.catalogId, rootId, id(360), id(303), runtime.roleConfigIds.seal]
        : [...(source === 'OWNED_BASE' ? [id(365), id(304), id(305)] : [id(304)]),
          id(301), rootId, id(360), runtime.catalogId, id(303), runtime.roleConfigIds.seal])]);
    assert.equal(approval.packageId, runtime.roles.release.typeOriginPackageId);
    assert.equal(approval.aadBase64, identity.aadBase64);
    assert.equal(approval.maxPlaintextBytes, 3145728);
    assert.equal(approval.selectionIndex, slotIndex);
    const indexPosition = isPack ? 11 : source === 'OWNED_BASE' ? 12 : 10;
    assert.equal(bcs.u64().parse(fromBase64(data.inputs[call.arguments[indexPosition].Input].Pure.bytes)), String(slotIndex));
    if (slotIndex !== 0) await assert.rejects(custody.resolveProtectedSelectionApproval({ ...request, selectionIndex: 0 }),
      { code: 'MAKER_V8_PLAYER_PROTECTED_SELECTION_INVALID' });
    state.protectedAssets[0].sealId = commitment('0');
    await assert.rejects(custody.resolveProtectedSelectionApproval({ ...request, selectionIndex: slotIndex }),
      { code: 'MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT' });
  }
});

test('every Player placement ABI binds its exact sparse Recipe slot after revision', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
  for (const [kind, functionName, targetPosition, argumentCount] of [
    ['BASE', 'select_base_style_v8', 7, 12],
    ['OWNED_BASE', 'equip_owned_base_style_v8', 8, 11],
    ['PROTECTED_BASE', 'select_protected_base_style_v8', 9, 17],
    ['PROTECTED_OWNED_BASE', 'equip_protected_owned_base_style_v8', 10, 16],
    ['PACK', 'select_pack_style_v8', 9, 14],
    ['PROTECTED_PACK', 'select_pack_style_v8', 9, 14],
  ]) {
    const isPack = kind.endsWith('PACK');
    const isOwned = kind.includes('OWNED');
    const isProtected = kind.startsWith('PROTECTED');
    const selected = { ...baseSelection, selectionIndex: 7, ...(isPack
      ? { source: 'PACK', releaseId: id(370), semanticPackId: 'pack-one' } : {}) };
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, state => {
      state.objects.runtimeDefinitions.fields.item_assetization = isOwned;
      if (isOwned) state.objects.ownedBaseItems = [owned(id(365), {
        root_id: rootId, root_version: '1', root_content_commitment: commitment('2'),
        definition_registry_id: id(304), pack_registry_id: id(305), base_registry_id: id(301),
        part_key: 'body', item_key: 'default', item_payload_commitment: commitment('3'),
        holder: signer, ownership_epoch: '0', transferable: true, equip_lock: null,
      })];
      if (isPack) {
        state.objects.releases = [shared(id(370))];
        state.objects.packPasses = [owned(id(372), { release_id: id(370) })];
        state.packStyles = [{ ...selected, protected: isProtected, assetContentCommitment: commitment('3') }];
      }
      if (isProtected) {
        state.protectedSelections = true;
        state.protectedRequired = true;
        state.protectedAssets = [{ selectionIndex: 7, source: selected.source,
          ciphertextBlobCommitment: commitment('5'), certificationCommitment: commitment('6'), sealId: commitment('7') }];
      }
    }, value => {
      value.recipe = { ...recipe, selections: [null, null, null, null, null, null, null, { ...selected }] };
      value.loadout = { ...loadout, selections: [{ ...selected }],
        usedPacks: isPack ? [{ releaseId: id(370), semanticPackId: 'pack-one' }] : [],
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(value.recipe) };
    });
    const prepared = await compiler.preparePlayerAction(request);
    const data = Transaction.fromKind(fromBase64(prepared.plan.descriptor.kindBytes)).getData();
    const call = data.commands.map(command => command.MoveCall).find(row => row?.function === functionName);
    assert.equal(call.arguments.length, argumentCount, kind);
    const pure = index => fromBase64(data.inputs[call.arguments[index].Input].Pure.bytes);
    assert.equal(bcs.u64().parse(pure(targetPosition - 1)), '0', kind);
    assert.equal(bcs.option(bcs.u64()).parse(pure(targetPosition)), '7', kind);
    assert.equal(prepared.plan.descriptor.expected.ownedItemTransitions.finalLoadoutRevision, '1');
    if (isOwned) assert.deepEqual(prepared.plan.descriptor.expected.ownedItemTransitions.items[0].expectedLock,
      { selectionIndex: '7', equipRevision: '1' });
  }
});

test('external wardrobe Items equip, unequip, and prove through exact owned-object authority', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client,
    runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  const commit = await compiler.preparePlayerAction(
    await externalCertifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT),
  );
  const commitData = Transaction.fromKind(fromBase64(commit.plan.descriptor.kindBytes)).getData();
  const externalCall = commitData.commands.map(command => command.MoveCall)
    .find(call => call?.function === 'equip_external_style_v8');
  assert.equal(externalCall.arguments.length, 9);
  assert.equal(bcs.u64().parse(fromBase64(commitData.inputs[externalCall.arguments[7].Input].Pure.bytes)), '1');
  assert.equal(bcs.option(bcs.u64()).parse(fromBase64(commitData.inputs[externalCall.arguments[8].Input].Pure.bytes)), '1');
  assert.deepEqual(
    commit.plan.targets.map((target) => target.split('::').slice(1).join('::')),
    [
      'runtime_v8::create_maker_loadout_v8',
      'runtime_v8::select_base_style_v8',
      'runtime_v8::equip_external_style_v8',
      'runtime_v8::transfer_maker_loadout_to_holder_v8',
    ],
  );
  assert.deepEqual(commit.plan.descriptor.expected.ownedItemTransitions, {
    finalLoadoutRevision: '2',
    items: [{
      kind: 'EXTERNAL',
      objectId: id(391),
      productId: id(390),
      productContentCommitment: commitment('a'),
      assetContentCommitment: commitment('8'),
      holder: signer,
      ownershipEpoch: '0',
      transferable: true,
      expectedLock: { selectionIndex: '1', equipRevision: '2' },
    }],
  });

  const complete = await compiler.preparePlayerAction(
    await externalCertifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT),
  );
  assert.equal(
    complete.plan.targets.some((target) => target.endsWith('::runtime_v8::prove_external_selection_v8')),
    true,
  );
  assert.deepEqual(complete.plan.descriptor.expected.ownedExternalItems, [{
    productId: id(390),
    ownedItemId: id(391),
    productContentCommitment: commitment('a'),
    assetContentCommitment: commitment('8'),
  }]);
});

test('external Player authority rejects missing or unsafe certified render metadata before build', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client,
    runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  for (const [label, mutate] of [
    ['media type', (state) => { state.objects.externalProducts[0].fields.asset_media_type = 'text/html'; }],
    ['byte length', (state) => { state.objects.externalProducts[0].fields.asset_byte_length = '0'; }],
    ['blob ID', (state) => { state.objects.externalProducts[0].fields.asset_blob_id = ''; }],
  ]) {
    await assert.rejects(
      externalCertifiedRequest(
        client,
        MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT,
        mutate,
      ).then((request) => compiler.preparePlayerAction(request)),
      (error) => [
        'MAKER_V8_PLAYER_EXTERNAL_ITEM_DRIFT',
        'MAKER_V8_PLAYER_MOVE_TEXT_INVALID',
      ].includes(error.code),
      label,
    );
  }
});

test('finalized owned Item readback binds exact loadout slot, revision, and content authority', () => {
  const expected = {
    kind: 'EXTERNAL', objectId: id(391), productId: id(390),
    productContentCommitment: commitment('a'),
    assetContentCommitment: commitment('8'), holder: signer,
    ownershipEpoch: '0', transferable: true,
    expectedLock: { selectionIndex: '1', equipRevision: '2' },
  };
  const output = {
    type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::OwnedExternalItemV8`,
    objectId: id(391),
    fields: {
      version: 8, productId: id(390),
      productContentCommitment: commitment('a'),
      assetContentCommitment: commitment('8'), holder: signer,
      ownershipEpoch: '0', transferable: true,
      equipLock: { loadoutId: id(361), equipRevision: '2', selectionIndex: '1' },
    },
  };
  assert.equal(assertMakerV8PlayerOwnedItemReadbackV8({
    runtime, expected, output, loadout: { objectId: id(361) },
  }), true);
  for (const mutate of [
    (value) => { value.fields.equipLock.equipRevision = '3'; },
    (value) => { value.fields.equipLock = null; },
    (value) => { value.fields.assetContentCommitment = commitment('9'); },
    (value) => { value.fields.holder = id(999); },
  ]) {
    const tampered = structuredClone(output);
    mutate(tampered);
    assert.throws(
      () => assertMakerV8PlayerOwnedItemReadbackV8({
        runtime, expected, output: tampered, loadout: { objectId: id(361) },
      }),
      (error) => [
        'MAKER_V8_PLAYER_OWNED_ITEM_LOCK_DRIFT',
        'MAKER_V8_PLAYER_OWNED_ITEM_READBACK_DRIFT',
      ].includes(error.code),
    );
  }
});

test('protected Complete readback binds Output and Receipt to the same exact Seal identity', () => {
  const selectedOutputKey = 'alternate-output';
  const outputType = `${runtime.roles.output.typeOriginPackageId}::output_v8::CompleteOutputV8`;
  const receiptType = `${runtime.roles.output.typeOriginPackageId}::output_v8::CompleteReceiptV8`;
  const soulType = runtime.nativeSoulIntegration.expectedNativeBinding.soulOriginalType;
  const outputId = id(450);
  const receiptId = id(451);
  const sealId = commitment('d');
  const expected = {
    nativeSoul: { protocolConfigId: runtime.protocolConfigId, soulRegistryId: id(308),
      makerCreator: signer, makerTreasuryId: id(302), rightsCommitment: commitment('a') },
    protectedOutput: true,
    chainLoadoutCommitment: commitment('7'),
    chainLoadoutId: id(361),
    sealScopeKey: `complete/${selectedOutputKey}`,
    sealAssetKey: `receipt-${signer.slice(2)}-0`,
  };
  const common = {
    rootId, makerVersion: '1', rootContentCommitment: commitment('2'),
    outputKey: selectedOutputKey, holder: signer,
  };
  const outputs = [{
    type: outputType,
    objectId: outputId,
    fields: {
      ...common, protected: true, loadoutId: id(361),
      loadoutCommitment: commitment('7'), renderBlobId: 'render-blob',
      renderSha256: commitment('5'), renderBlobCommitment: commitment('6'),
      scopeKey: expected.sealScopeKey, assetKey: expected.sealAssetKey,
      sealId, protectionBindingCommitment: commitment('e'),
      recipeCommitment: commitment('f'),
    },
  }, {
    type: receiptType,
    objectId: receiptId,
    fields: {
      ...common, protected: true, loadoutId: id(361),
      loadoutCommitment: commitment('7'), outputId, sealId,
      recipeCommitment: commitment('f'),
    },
  }, {
    type: soulType,
    objectId: id(452),
    fields: {
      ...common, outputId, receiptId, ownershipEpoch: '0',
      recipeCommitment: commitment('f'),
    },
  }];
  const record = {
    playerIdentity: {
      rootId, makerVersion: '1', rootContentCommitment: commitment('2'),
    },
    plan: { signer, descriptor: { expected } },
    loadout: { outputKey: selectedOutputKey },
    input: {
      nativeSoul: nativeInput(),
      render: {
        blobId: 'render-blob', sha256: commitment('5'),
        blobCommitment: commitment('6'), byteLength: 32,
      },
    },
  };
  for (const entry of outputs.slice(0, 2)) {
    entry.change = 'created'; entry.owner = { kind: 'Immutable', value: true };
    Object.assign(entry.fields, { renderCommitment: commitment('1'), outputCommitment: commitment('3'),
      outputPolicyCommitment: commitment('4'), receiptCommitment: commitment('8') });
  }
  outputs[2] = { type: soulType, objectId: id(452), change: 'created',
    owner: { kind: 'ObjectOwner', value: deriveMakerV8NativeKioskItemIdV8(id(454), id(452)) }, fields: { name: 'Native Soul', description: 'Native Complete',
      imageUrl: 'walrus://render-blob', provenanceKind: '3', creator: signer } };
  outputs.push({ type: `${runtime.nativeSoulIntegration.soulidityOriginalPackageId}::soul::SoulState`,
    objectId: id(453), change: 'created', owner: { kind: 'Shared', value: { initialSharedVersion: '1' } },
    fields: { soulId: id(452), currentKioskId: id(454), currentOwner: signer, creator: signer,
      creatorRoyaltyBps: '50', ownershipEpoch: '0', isListed: false, contentId: nativeInput().expectedContentObjectId, accessListId: id(457) } });
  outputs.push({ type: `${runtime.roles.output.typeOriginPackageId}::output_v8::NativeSoulBindingV8`,
    objectId: id(455), change: 'created', owner: { kind: 'Immutable', value: true }, fields: {
      ...common, protocolConfigId: runtime.protocolConfigId, soulRegistryId: id(308), soulId: id(452), soulStateId: id(453),
      originalHolder: signer, outputId, receiptId, authorizationCommitment: commitment('b'), recipeCommitment: commitment('f'),
      renderCommitment: commitment('1'), outputCommitment: commitment('3'), outputPolicyCommitment: commitment('4'),
      receiptCommitment: commitment('8'), makerCreator: signer, makerTreasuryId: id(302),
      rights: { commitment: commitment('a'), soul_creator_royalty_bps: '50' },
    } });
  const wrapperFields = { id: deriveMakerV8NativeKioskItemIdV8(id(454), id(452)), keyId: id(452), valueId: id(452) };
  const wrapperBcs = bcs.struct('KioskItemFieldFixture', { id: bcs.Address, keyId: bcs.Address, valueId: bcs.Address });
  outputs.push({ type: MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, objectId: wrapperFields.id, change: 'created',
    owner: { kind: 'ObjectOwner', value: id(454) }, fields: wrapperFields,
    contentBcsBase64: wrapperBcs.serialize(wrapperFields).toBase64() });
  assert.equal(assertMakerV8PlayerCompleteReadbackV8({
    runtime, record, outputs,
  }), true);
  for (const mutate of [
    rows => { rows[0].fields.outputKey = 'portrait'; },
    rows => { rows[1].fields.outputKey = 'portrait'; },
    rows => { rows[4].fields.outputKey = 'portrait'; },
    rows => { rows[2].owner = { kind: 'AddressOwner', value: signer }; },
    rows => { rows[3].fields.currentOwner = id(999); },
    rows => { rows[4].fields.soulId = id(999); },
    rows => { rows[4].owner = { kind: 'AddressOwner', value: signer }; },
    rows => { rows[4].fields.rights.commitment = commitment('c'); },
    rows => { rows[2].owner.value = id(454); }, // The old direct-Kiosk assumption is invalid.
    rows => { rows[5].owner.value = id(999); },
    rows => { rows[5].owner = { kind: 'AddressOwner', value: id(454) }; },
    rows => { rows[5].type = normalizeStructTag('0x2::dynamic_field::Field<0x2::kiosk::Item,0x2::object::ID>'); },
    rows => { rows[5].objectId = id(999); },
    rows => { rows[5].fields.keyId = id(999); },
    rows => { rows[5].contentBcsBase64 = wrapperBcs.serialize({ ...wrapperFields, valueId: id(999) }).toBase64(); },
    rows => { rows[5].contentBcsBase64 = toBase64(new Uint8Array(97)); },
    rows => { rows[5].change = 'mutated'; },
    rows => { rows.pop(); },
    rows => { rows.push(structuredClone(rows[5])); },
  ]) {
    const wrong = structuredClone(outputs); mutate(wrong);
    assert.throws(() => assertMakerV8PlayerCompleteReadbackV8({ runtime, record, outputs: wrong }));
  }
  const drifted = structuredClone(outputs);
  drifted[1].fields.sealId = commitment('9');
  assert.throws(
    () => assertMakerV8PlayerCompleteReadbackV8({
      runtime, record, outputs: drifted,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_READBACK_PROTECTION_DRIFT',
  );
});

test('native Complete refuses missing binding, wrong native config and foreign owned content', async () => {
  const absent = clientFixture();
  absent.getDynamicField = async () => { throw new Error('missing native binding'); };
  await assert.rejects(certifiedRequest(absent, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT),
    { code: 'MAKER_V8_NATIVE_SOUL_BINDING_READ_FAILED' });
  const wrong = clientFixture(); const original = wrong.getObject;
  wrong.getObject = async request => {
    const response = await original(request);
    if (request.id === runtime.nativeSoulIntegration.marketConfigV2Id) response.data.objectId = id(999);
    return response;
  };
  await assert.rejects(certifiedRequest(wrong, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT));
  const foreign = clientFixture(); const read = foreign.getObject;
  foreign.getObject = async request => {
    const response = await read(request);
    if (request.id === id(810)) response.data.owner = { AddressOwner: id(999) };
    return response;
  };
  await assert.rejects(certifiedRequest(foreign, MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT),
    { code: 'MAKER_V8_NATIVE_CONTENT_CUSTODY_INVALID' });
});

test('external admission authority is read by exact gRPC dynamic-field key and canonical record BCS', async () => {
  const productId = id(390);
  const tableId = id(399);
  const layout = bcs.struct('ExternalAdmissionRecordV8Fixture', {
    product_id: bcs.Address,
    compatibility_commitment: bcs.vector(bcs.u8()),
    product_content_commitment: bcs.vector(bcs.u8()),
    attestation_commitment: bcs.option(bcs.vector(bcs.u8())),
    admitted_revision: bcs.u64(),
    admission_state: bcs.u8(),
  });
  const valueBcs = layout.serialize({
    product_id: productId,
    compatibility_commitment: Array.from(new Uint8Array(32).fill(9)),
    product_content_commitment: Array.from(new Uint8Array(32).fill(10)),
    attestation_commitment: null,
    admitted_revision: 7n,
    admission_state: 0,
  }).toBytes();
  let request = null;
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getDynamicField(input) {
      request = input;
      return {
        kind: 'DynamicField',
        name: input.name,
        value: {
          type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::ExternalAdmissionRecordV8`,
          bcsBase64: toBase64(valueBcs),
        },
      };
    },
  };
  const rows = await readMakerV8ExternalAdmissionsV8({
    client,
    runtime,
    packRegistry: { fields: { external_admissions: tableId } },
    products: [{ objectId: productId }],
  });
  assert.equal(request.parentId, tableId);
  assert.equal(bcs.Address.parse(fromBase64(request.name.bcsBase64)), productId);
  assert.deepEqual(rows, [{
    productId,
    compatibilityCommitment: '09'.repeat(32),
    productContentCommitment: '0a'.repeat(32),
    attestationCommitment: null,
    admittedRevision: '7',
    admissionState: 0,
  }]);
});

test('Pack Style authority is point-read from its exact Release Table with canonical key/value BCS', async () => {
  const releaseId = id(370);
  const tableId = id(371);
  const keyLayout = bcs.struct('PackStyleKeyV8Fixture', {
    part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(),
  });
  const sourceLayout = bcs.struct('PackStyleDefinitionSourcesV8Fixture', {
    part: bcs.u8(), track: bcs.u8(), color: bcs.option(bcs.u8()),
  });
  assert.equal(Buffer.from(sourceLayout.serialize({ part: 1, track: 2, color: 2 }).toBytes()).toString('hex'), '01020102');
  assert.equal(Buffer.from(sourceLayout.serialize({ part: 1, track: 1, color: null }).toBytes()).toString('hex'), '010100');
  const styleLayout = bcs.struct('PackStyleV8Fixture', {
    index: bcs.u64(),
    definition_sources: sourceLayout,
    part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(),
    layer_track_key: bcs.string(),
    color_channel_key: bcs.option(bcs.string()),
    default_swatch_key: bcs.option(bcs.string()),
    asset_blob_id: bcs.string(),
    asset_sha256: bcs.vector(bcs.u8()),
    asset_content_commitment: bcs.vector(bcs.u8()),
    protected: bcs.bool(),
    seal_binding_commitment: bcs.vector(bcs.u8()),
    style_commitment: bcs.vector(bcs.u8()),
  });
  const selection = {
    selectionIndex: 2,
    releaseId,
    semanticPackId: 'pack-one',
    partKey: 'hat',
    itemKey: 'crown',
    styleKey: 'gold',
    trackKey: 'headwear',
    colorChannelKey: 'metal',
    defaultSwatchKey: 'gold',
    swatchKey: 'silver',
  };
  let valueBcs = styleLayout.serialize({
    index: 4n,
    definition_sources: { part: 1, track: 1, color: 1 },
    part_key: selection.partKey,
    item_key: selection.itemKey,
    style_key: selection.styleKey,
    layer_track_key: selection.trackKey,
    color_channel_key: selection.colorChannelKey,
    default_swatch_key: selection.defaultSwatchKey,
    asset_blob_id: 'walrus-pack-style',
    asset_sha256: Array.from(new Uint8Array(32).fill(11)),
    asset_content_commitment: Array.from(new Uint8Array(32).fill(12)),
    protected: false,
    seal_binding_commitment: [],
    style_commitment: Array.from(new Uint8Array(32).fill(13)),
  }).toBytes();
  const requests = [];
  let definitionRows;
  const ownedRelease = { objectId: releaseId, fields: { styles: tableId,
    semantic_pack_id: selection.semanticPackId, content_commitment: Array(32).fill(17) } };
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getDynamicField(input) {
      requests.push(input);
      if (input.parentId === releaseId) {
        if (!definitionRows) throw new ObjectError('NOT_FOUND', 'absent', { reason: 'notFound',
          objectId: deriveDynamicFieldID(releaseId, input.name.type, fromBase64(input.name.bcsBase64)) });
        const valueType = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackDefinitionsV8`;
        const content = Array(32).fill(17);
        return { kind: 'DynamicField', name: input.name,
          fieldId: deriveDynamicFieldID(releaseId, input.name.type, fromBase64(input.name.bcsBase64)),
          type: `0x2::dynamic_field::Field<${input.name.type},${valueType}>`,
          value: { type: valueType, bcsBase64: toBase64(MAKER_V8_PACK_DEFINITIONS_BCS.serialize({
            version: 8, release_id: releaseId, release_content_commitment: content, rows: definitionRows,
            commitment: [...packDefinitionCommitmentV8(releaseId, content, definitionRows)],
          }).toBytes()) } };
      }
      return {
        kind: 'DynamicField',
        name: input.name,
        value: {
          type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackStyleV8`,
          bcsBase64: toBase64(valueBcs),
        },
      };
    },
  };
  const rows = await readMakerV8PackStylesV8({
    client,
    runtime,
    releases: [ownedRelease],
    selections: [selection],
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].parentId, tableId);
  assert.equal(
    requests[0].name.type,
    `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackStyleKeyV8`,
  );
  assert.deepEqual(keyLayout.parse(fromBase64(requests[0].name.bcsBase64)), {
    part_key: selection.partKey,
    item_key: selection.itemKey,
    style_key: selection.styleKey,
  });
  assert.deepEqual(rows, [{
    selectionIndex: selection.selectionIndex,
    releaseId,
    semanticPackId: selection.semanticPackId,
    partKey: selection.partKey,
    itemKey: selection.itemKey,
    styleKey: selection.styleKey,
    trackKey: selection.trackKey,
    swatchKey: selection.swatchKey,
    definitionSources: { part: 1, track: 1, color: 1 },
    protected: false,
    assetContentCommitment: '0c'.repeat(32),
    styleCommitment: '0d'.repeat(32),
  }]);

  const drifted = structuredClone(selection);
  drifted.trackKey = 'wrong-track';
  await assert.rejects(
    readMakerV8PackStylesV8({
      client,
      runtime,
      releases: [ownedRelease],
      selections: [drifted],
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_PACK_STYLE_DRIFT',
  );
  const originalBytes = valueBcs;
  for (const [sources, code] of [
    [{ part: 0, track: 1, color: 1 }, 'MAKER_V8_PLAYER_PACK_DEFINITION_SOURCES_INVALID'],
    [{ part: 1, track: 1, color: null }, 'MAKER_V8_PLAYER_PACK_DEFINITION_SOURCES_INVALID'],
  ]) {
    valueBcs = styleLayout.serialize({ ...styleLayout.parse(originalBytes), definition_sources: sources }).toBytes();
    await assert.rejects(readMakerV8PackStylesV8({ client, runtime,
      releases: [ownedRelease], selections: [selection] }), { code });
  }
  const definitions = {
    semantic_pack_id: selection.semanticPackId,
    parts: [{ sequence: '0', key: 'hat', label: 'Hat', kind: 0, render_order: '1', menu_order: '1',
      visible: true, required: false, slot_mode: 1, capacity: '2', track_keys: ['headwear'],
      visibility_tokens: [], visibility_commitment: Array(32).fill(1), payload_commitment: Array(32).fill(2) }],
    tracks: [{ sequence: '0', key: 'headwear', label: 'Headwear', render_order: '1', locked: false }],
    colors: [{ sequence: '0', key: 'metal', label: 'Metal', default_swatch_key: 'gold',
      swatches: ['gold', 'silver'].map(key => ({ key, label: key, rgba: 0xffffffff, stops: [] })) }],
    rules: [], visibility: [
      { subject: 1, definition_source: 2, part_key: 'hat', item_key: 'crown', style_key: null,
        visibility_tokens: [], visibility_commitment: Array(32).fill(3) },
      { subject: 2, definition_source: 2, part_key: 'hat', item_key: 'crown', style_key: 'gold',
        visibility_tokens: [], visibility_commitment: Array(32).fill(4) },
    ],
  };
  const readOwned = (selections = [selection]) => readMakerV8PackStylesV8({ client, runtime,
    releases: [ownedRelease], selections });
  for (const sources of [{ part: 1, track: 1, color: 1 }, { part: 2, track: 1, color: 1 }, { part: 1, track: 2, color: 1 },
    { part: 1, track: 1, color: 2 }, { part: 2, track: 2, color: 2 }]) {
    definitionRows = structuredClone(definitions);
    // Base-sourced references must not accidentally resolve against Pack rows.
    if (sources.part === 1) definitionRows.parts = [];
    if (sources.track === 1) definitionRows.tracks = [];
    if (sources.color === 1) definitionRows.colors = [];
    valueBcs = styleLayout.serialize({ ...styleLayout.parse(originalBytes), definition_sources: sources }).toBytes();
    requests.length = 0;
    const result = await readOwned([selection, { ...selection, selectionIndex: 3 }]);
    assert.equal(requests.filter(row => row.parentId === releaseId).length, 1);
    assert.deepEqual(result[0].definitionSources, sources);
    assert.equal(result[0].ownedDefinitions.releaseId, releaseId);
    assert.equal(result[0].ownedDefinitions, result[1].ownedDefinitions);
    assert.ok(Object.isFrozen(result[0].ownedDefinitions.rows));
  }
  for (const mutate of [
    rows => { rows.parts = []; }, rows => { rows.tracks[0].key = 'foreign'; },
    rows => { rows.colors[0].swatches.pop(); }, rows => { rows.parts.push(rows.parts[0]); },
    rows => { rows.visibility.pop(); }, rows => { rows.visibility[0].definition_source = 1; },
  ]) {
    definitionRows = structuredClone(definitions); mutate(definitionRows);
    await assert.rejects(readOwned(), { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID' });
  }
  definitionRows = structuredClone(definitions);
  await assert.rejects(readOwned([{ ...selection, semanticPackId: 'foreign' }]),
    { code: 'MAKER_V8_PLAYER_PACK_STYLE_DRIFT' });
  const noColorSelection = { ...selection, colorChannelKey: null, defaultSwatchKey: null, swatchKey: null };
  const noColor = { ...styleLayout.parse(originalBytes), color_channel_key: null, default_swatch_key: null };
  valueBcs = styleLayout.serialize(noColor).toBytes();
  await assert.rejects(readMakerV8PackStylesV8({ client, runtime,
    releases: [ownedRelease], selections: [noColorSelection] }),
  { code: 'MAKER_V8_PLAYER_PACK_DEFINITION_SOURCES_INVALID' });
  noColor.definition_sources.color = null;
  valueBcs = styleLayout.serialize(noColor).toBytes();
  const noColorRows = await readMakerV8PackStylesV8({ client, runtime,
    releases: [ownedRelease], selections: [noColorSelection] });
  assert.deepEqual(noColorRows[0].definitionSources, { part: 1, track: 1, color: null });
  // Fresh ABI does not accept the historical layout that omitted the nested scope bytes.
  valueBcs = new Uint8Array([...originalBytes.slice(0, 8), ...originalBytes.slice(12)]);
  await assert.rejects(readMakerV8PackStylesV8({ client, runtime,
    releases: [ownedRelease], selections: [selection] }),
  { code: 'MAKER_V8_PLAYER_PACK_STYLE_BCS_INVALID' });
});

test('first Complete treats only exact SDK notFound counter objects as zero', async () => {
  const tableId = id(410), releaseId = id(412);
  const request = {
    runtime, outputRegistry: { fields: { complete_by_wallet: { id: tableId } } },
    releases: [{ objectId: releaseId, fields: { complete_by_wallet: { id: id(411) } } }],
    account: { address: signer },
  };
  let makeError = objectId => new ObjectError('notExists', 'Object not found', { reason: 'notFound', objectId });
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getDynamicField({ parentId, name }) {
      throw makeError(deriveDynamicFieldID(parentId, name.type, fromBase64(name.bcsBase64)));
    },
  };
  assert.deepEqual(await readMakerV8CompleteCountersV8({ ...request, client }), {
    baseOrdinal: '0', packOrdinals: { [releaseId]: '0' },
  });
  for (const factory of [
    objectId => Object.assign(new Error('not found'), { code: 'notExists', reason: 'notFound', objectId }),
    () => new ObjectError('notExists', 'wrong object', { reason: 'notFound', objectId: id(999) }),
    objectId => new ObjectError('notExists', 'unknown', { reason: 'unknown', objectId }),
    objectId => new ObjectError('UNAVAILABLE', 'transport failed', { reason: 'notFound', objectId }),
    () => new ObjectError('notExists', 'missing identity', { reason: 'notFound' }),
  ]) {
    let thrown;
    makeError = objectId => (thrown = factory(objectId));
    await assert.rejects(readMakerV8CompleteCountersV8({ ...request, client }), error => error === thrown);
  }
});

test('Complete quota counters are exact holder-scoped gRPC dynamic-field u64 point reads', async () => {
  const outputTableId = id(410);
  const packTableId = id(411);
  const releaseId = id(412);
  const requests = [];
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getDynamicField(input) {
      requests.push(input);
      const count = input.parentId === outputTableId ? 3n : 5n;
      return {
        kind: 'DynamicField',
        name: input.name,
        value: { type: 'u64', bcsBase64: toBase64(bcs.u64().serialize(count).toBytes()) },
      };
    },
  };
  const result = await readMakerV8CompleteCountersV8({
    client,
    runtime,
    outputRegistry: { fields: { complete_by_wallet: { id: outputTableId } } },
    releases: [{ objectId: releaseId, fields: { complete_by_wallet: { id: packTableId } } }],
    account: { address: signer },
  });
  assert.deepEqual(result, { baseOrdinal: '3', packOrdinals: { [releaseId]: '5' } });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].parentId, outputTableId);
  assert.equal(requests[1].parentId, packTableId);
  assert.equal(requests[0].name.type, `${runtime.roles.output.typeOriginPackageId}::output_v8::WalletKeyV8`);
  assert.equal(requests[1].name.type, `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::WalletKeyV8`);
});

test('Physical policy is read from exact Base policy Table BCS and rejects protected/drifted rows', async () => {
  const sourceId = id(420);
  const tableId = id(421);
  const selection = {
    source: 'BASE', selectionIndex: 0,
    partKey: 'body', itemKey: 'default', styleKey: 'default',
  };
  const keyLayout = bcs.struct('PhysicalPolicyKeyV8Fixture', {
    source_kind: bcs.u8(), source_id: bcs.Address,
    part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(),
  });
  const sourceLayout = bcs.struct('PhysicalSourceBindingV8Fixture', {
    source_kind: bcs.u8(), source_id: bcs.Address, source_semantic_id: bcs.string(),
    source_content_commitment: bcs.vector(bcs.u8()),
    source_treasury_id: bcs.option(bcs.Address), pack_registry_id: bcs.option(bcs.Address),
    pack_registry_revision: bcs.u64(), registered_pack_owner: bcs.option(bcs.Address),
    registered_pack_control_epoch: bcs.u64(), registered_pack_admin_cap_id: bcs.option(bcs.Address),
  });
  const styleLayout = bcs.struct('PhysicalStyleDescriptorV8Fixture', {
    part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(),
    layer_track_key: bcs.string(), color_channel_key: bcs.option(bcs.string()),
    default_swatch_key: bcs.option(bcs.string()), style_asset_blob_id: bcs.string(),
    style_asset_sha256: bcs.vector(bcs.u8()), style_protected: bcs.bool(),
  });
  const policyLayout = bcs.struct('PhysicalStylePolicyV8Fixture', {
    sequence: bcs.u64(), source: sourceLayout, style: styleLayout,
    style_payload_commitment: bcs.vector(bcs.u8()),
    style_seal_binding_commitment: bcs.vector(bcs.u8()),
    source_style_commitment: bcs.vector(bcs.u8()),
    style_identity_commitment: bcs.vector(bcs.u8()),
    material_policy_commitment: bcs.vector(bcs.u8()),
    issuance_kind: bcs.u8(), proof_kind: bcs.u8(), price_atomic: bcs.u64(),
    max_supply: bcs.u64(), transferable: bcs.bool(), issued_count: bcs.u64(),
    consumed_count: bcs.u64(), row_commitment: bcs.vector(bcs.u8()),
  });
  const row = {
    sequence: 0n,
    source: {
      source_kind: 0, source_id: sourceId, source_semantic_id: '',
      source_content_commitment: Array.from(new Uint8Array(32).fill(1)),
      source_treasury_id: null, pack_registry_id: null, pack_registry_revision: 0n,
      registered_pack_owner: null, registered_pack_control_epoch: 0n,
      registered_pack_admin_cap_id: null,
    },
    style: {
      part_key: selection.partKey, item_key: selection.itemKey, style_key: selection.styleKey,
      layer_track_key: 'body', color_channel_key: null, default_swatch_key: null,
      style_asset_blob_id: 'walrus-base-style',
      style_asset_sha256: Array.from(new Uint8Array(32).fill(2)), style_protected: false,
    },
    style_payload_commitment: Array.from(new Uint8Array(32).fill(3)),
    style_seal_binding_commitment: [],
    source_style_commitment: Array.from(new Uint8Array(32).fill(4)),
    style_identity_commitment: Array.from(new Uint8Array(32).fill(5)),
    material_policy_commitment: Array.from(new Uint8Array(32).fill(6)),
    issuance_kind: 0, proof_kind: 0, price_atomic: 0n, max_supply: 10n,
    transferable: true, issued_count: 2n, consumed_count: 0n,
    row_commitment: Array.from(new Uint8Array(32).fill(7)),
  };
  let valueBcs = policyLayout.serialize(row).toBytes();
  let pointRequest = null;
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getDynamicField(input) {
      pointRequest = input;
      return {
        kind: 'DynamicField', name: input.name,
        value: {
          type: `${runtime.roles.physical.typeOriginPackageId}::physical_v8::PhysicalStylePolicyV8`,
          bcsBase64: toBase64(valueBcs),
        },
      };
    },
  };
  const physicalRegistry = {
    fields: { base_registry_id: sourceId, base_policies: { id: tableId }, pack_policies: { id: id(422) } },
  };
  assert.deepEqual(await readMakerV8PhysicalPolicyV8({
    client, runtime, physicalRegistry, selection, release: null,
  }), {
    source: 'BASE', selectionIndex: 0, issuanceKind: 0, priceAtomic: '0',
    expectedIssuedCount: '2', policyCommitment: '07'.repeat(32),
  });
  assert.equal(pointRequest.parentId, tableId);
  assert.deepEqual(keyLayout.parse(fromBase64(pointRequest.name.bcsBase64)), {
    source_kind: 0, source_id: sourceId,
    part_key: selection.partKey, item_key: selection.itemKey, style_key: selection.styleKey,
  });

  valueBcs = policyLayout.serialize({ ...row, style: { ...row.style, style_protected: true } }).toBytes();
  await assert.rejects(
    readMakerV8PhysicalPolicyV8({ client, runtime, physicalRegistry, selection, release: null }),
    (error) => error.code === 'MAKER_V8_PLAYER_PHYSICAL_POLICY_DRIFT',
  );
});

test('compiler binds protected Base selection to its exact live Seal row', async () => {
  const client = clientFixture();
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  const request = await certifiedRequest(
    client,
    MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    (state) => {
      state.protectedSelections = true;
      state.protectedRequired = true;
      state.currentSelections[0].protected = true;
      state.currentSelections[0].sealBindingCommitment = commitment('f');
      state.protectedAssets = [{
        selectionIndex: 0,
        source: 'BASE',
        scopeKind: 0,
        scopeKey: 'maker/base',
        scopeCommitment: commitment('2'),
        assetKey: 'body/default/default',
        assetContentCommitment: commitment('3'),
        ciphertextBlobId: 'ciphertext-blob',
        ciphertextSha256: commitment('4'),
        ciphertextBlobCommitment: commitment('5'),
        certificationCommitment: commitment('6'),
        sealId: commitment('7'),
      }];
    },
  );
  const prepared = await compiler.preparePlayerAction(request);
  assert.equal(
    prepared.plan.targets[0].endsWith('::runtime_seal_v8::prove_protected_base_selection_v8'),
    true,
  );
});

test('IndexedDB persistence provides exact active/digest/build O(1) indices and lease reclaim', async () => {
  let checked = null;
  const persistence = createMakerV8PlayerPersistenceV8(new IDBFactory(), {
    databaseName: 'player-adapters-focused-persistence',
    storageManager: storageManager(),
    confirmNoSignedArtifact: async (request) => {
      checked = request;
      return {
        kind: 'EXTERNAL_NO_ARTIFACT', actionId: request.actionId,
        sessionId: request.sessionId, checkedAt: request.checkedAt,
      };
    },
  });
  const actionId = commitment('a');
  const scopeKey = commitment('b');
  const transactionDigest = digest(3);
  const base = {
    actionId, scopeKey, revision: 1, createdAt: 1, updatedAt: 1,
    status: 'SIGNING_UNKNOWN', signature: null,
    signatureIntent: { sessionId: commitment('c').slice(0, 32), leaseExpiresAt: 10 },
    playerIdentity: { rootId }, recipe: { value: 1 }, loadout: { value: 2 },
    input: {}, plan: { value: 3, signer },
    transaction: { digest: transactionDigest },
  };
  await persistence.create(base);
  assert.equal(await persistence.resolveActive(scopeKey), actionId);
  assert.equal((await persistence.loadByDigest(transactionDigest)).actionId, actionId);
  const reclaimed = await persistence.reclaimSignatureIntent({
    actionId, revision: 1, signatureIntent: base.signatureIntent, checkedAt: 11,
  });
  assert.equal(checked.checkedAt, 11);
  assert.equal(reclaimed.status, 'PREPARED');
  assert.equal(reclaimed.signatureIntent, null);
});

test('Player boundary accepts official gRPC address-balance gas resolution and rejects unsafe envelopes', async t => {
  // Exercise the installed official gRPC resolver, including protobuf response
  // handling, rather than pre-populating Transaction gas fields in the test.
  function addressGasResolver({ mutate = () => {} } = {}) {
    const calls = [];
    const fallback = new TestTransport();
    const transport = {
      mergeOptions: options => fallback.mergeOptions(options),
      unary(method, input, options) {
        assert.equal(method.service.typeName, 'sui.rpc.v2.TransactionExecutionService');
        assert.equal(method.name, 'SimulateTransaction');
        assert.equal(input.doGasSelection, true);
        assert.equal(input.transaction.gasPayment.budget, undefined);
        assert.equal(input.transaction.expiration.minEpoch, 41n);
        assert.equal(input.transaction.expiration.epoch, 42n);
        assert.equal(input.transaction.expiration.chain, MAKER_V8_MAINNET_GENESIS_DIGEST);
        calls.push(input);
        const transaction = { ...input.transaction,
          gasPayment: { owner: input.transaction.sender, budget: 340448n, price: 100n, objects: [] } };
        mutate(transaction);
        const response = method.O.create({ transaction: {
          transaction, effects: { status: { success: true }, epoch: 41n },
        } });
        return new TestTransport({ response }).unary(method, input, options);
      },
      serverStreaming() { throw Error('Unexpected stream'); },
      clientStreaming() { throw Error('Unexpected stream'); },
      duplex() { throw Error('Unexpected stream'); },
    };
    const grpc = new SuiGrpcClient({ network: 'mainnet', transport });
    return { calls, plugin: () => grpc.core.resolveTransactionPlugin() };
  }
  for (const mode of ['address-balance', 'owner', 'sender', 'budget', 'expiry', 'nonarray', 'reference']) await t.test(mode, async () => {
    const client = clientFixture();
    const resolver = addressGasResolver({ mutate: tx => {
      if (mode === 'owner') tx.gasPayment.owner = id(9999);
      if (mode === 'sender') tx.sender = tx.gasPayment.owner = id(9999);
      if (mode === 'budget') tx.gasPayment.budget = 500000001n;
      if (mode === 'expiry') tx.expiration.epoch = 0n;
      if (mode === 'nonarray') tx.gasPayment.objects = {};
      if (mode === 'reference') tx.gasPayment.objects = [{ objectId: gasId, version: 0n, digest: gasDigest }];
    } });
    client.core.resolveTransactionPlugin = resolver.plugin;
    const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS);
    const prepared = await compiler.preparePlayerAction(request);
    const persistence = createMakerV8PlayerPersistenceV8(new IDBFactory(), {
      databaseName: 'address-gas-'+mode, storageManager: storageManager() });
    const boundary = createMakerV8PlayerBoundaryAdapterV8({ client, runtime, compiler, persistence,
      wallet: { getCurrentAccount: async () => ({ address: signer, network: MAKER_V8_CHAIN_NETWORK }), verifyExactSignature: async () => false },
      execution: { allowWalletSignature: false, allowBroadcast: false, allowProtectedContent: false },
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
    const build = () => boundary.buildExactTransaction({ descriptor: prepared.plan.descriptor });
    if (mode === 'expiry') {
      const built = await build();
      const data = TransactionDataBuilder.fromBytes(fromBase64(built.transactionBytes));
      assert.equal(data.snapshot().expiration.ValidDuring.maxEpoch, '42', 'SDK preserves the explicitly bounded expiry over resolver data');
      data.expiration = { Epoch: 0, $kind: 'Epoch' };
      await assert.rejects(boundary.dryRunExactTransaction({ transactionBytes: toBase64(data.build()),
        descriptor: prepared.plan.descriptor }), { code: 'MAKER_V8_PLAYER_BUILD_PROOF_REQUIRED' });
      return;
    }
    if (mode !== 'address-balance') { await assert.rejects(build); return; }
    const built = await build();
    assert.equal(resolver.calls.length, 1);
    const snapshot = TransactionDataBuilder.fromBytes(fromBase64(built.transactionBytes)).snapshot();
    assert.deepEqual(snapshot.gasData.payment, []);
    assert.equal(snapshot.expiration.ValidDuring.maxEpoch, '42');
    assert.equal((await boundary.dryRunExactTransaction({ transactionBytes: built.transactionBytes,
      descriptor: prepared.plan.descriptor })).status, 'SUCCESS');
    assert.deepEqual(await build(), built, 'durable rebuild retains the exact empty-payment bytes');
    assert.equal(resolver.calls.length, 1, 'recovery does not silently replace the transaction');
  });
});

test('boundary persists one canonical V1 TransactionData and cold rebuild returns byte-identical proof', async () => {
  const client = clientFixture();
  const persistence = createMakerV8PlayerPersistenceV8(new IDBFactory(), {
    databaseName: 'player-adapters-focused-boundary',
    storageManager: storageManager(),
  });
  const makeCompiler = () => createMakerV8PlayerCompilerAdapterV8({
    client, runtime,
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  const compiler = makeCompiler();
  const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS);
  const prepared = await compiler.preparePlayerAction(request);
  const wallet = {
    async getCurrentAccount() { return { address: signer, network: MAKER_V8_CHAIN_NETWORK }; },
    async verifyExactSignature() { return { verified: true }; },
  };
  const boundary = createMakerV8PlayerBoundaryAdapterV8({
    client, runtime, compiler, persistence, wallet,
    execution: { allowWalletSignature: true, allowBroadcast: true, allowProtectedContent: false },
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  const built = await boundary.buildExactTransaction({ descriptor: prepared.plan.descriptor });
  assert.equal(TransactionDataBuilder.getDigestFromBytes(
    Buffer.from(built.transactionBytes, 'base64'),
  ), built.transactionDigest);
  assert.equal((await boundary.dryRunExactTransaction({
    transactionBytes: built.transactionBytes,
    descriptor: prepared.plan.descriptor,
  })).status, 'SUCCESS');

  const restartedCompiler = makeCompiler();
  await restartedCompiler.assertPlayerActionFresh({ ...request, plan: prepared.plan });
  const restartedBoundary = createMakerV8PlayerBoundaryAdapterV8({
    client, runtime, compiler: restartedCompiler, persistence, wallet,
    execution: { allowWalletSignature: true, allowBroadcast: true, allowProtectedContent: false },
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport() {},
  });
  const rebuilt = await restartedBoundary.buildExactTransaction({ descriptor: prepared.plan.descriptor });
  assert.deepEqual(rebuilt, built);
  const signed = await keypair.signTransaction(fromBase64(built.transactionBytes));
  await assert.rejects(
    restartedBoundary.broadcastExactTransaction({
      bytes: built.transactionBytes,
      digest: built.transactionDigest,
      signature: signed.signature,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_SIGNED_WAL_REQUIRED',
  );
  const tampered = structuredClone(prepared.plan.descriptor);
  tampered.kindSha256 = commitment('f');
  await assert.rejects(
    restartedBoundary.buildExactTransaction({ descriptor: tampered }),
    (error) => [
      'MAKER_V8_PLAYER_DESCRIPTOR_INVALID',
      'MAKER_V8_PLAYER_COMPILER_AUTHORITY_REQUIRED',
    ].includes(error.code),
  );
});

test('custody certification accepts only canonical system Clock progress and rejects real state drift', async () => {
  const check = async (mutate, accepted) => {
    const request = requestFor(MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS);
    const state = request.context.builderInput;
    state.objects.clock.type = normalizeStructTag('0x2::clock::Clock');
    state.objects.clock.fields = { id: runtime.clockObjectId, timestamp_ms: '1000' };
    let reads = 0;
    const custody = createMakerV8PlayerCustodyAdapterV8({
      client: clientFixture(), runtime, loadRuntimeAttestation: async () => ({ runtime }),
      loadPlayerState: async () => {
        const next = structuredClone(state);
        if (reads++ > 0) {
          next.objects.clock.version = '8';
          next.objects.clock.digest = digest(33);
          next.objects.clock.fields.timestamp_ms = '1001';
          mutate(next);
        }
        return next;
      }, assertTransport() {},
    });
    const { context: ignored, ...input } = request;
    const context = await custody.loadPlayerContext(input);
    const operation = custody.assertPlayerContext({ ...input, context });
    if (accepted) assert.deepEqual(await operation, { certified: true });
    else await assert.rejects(operation, { code: 'MAKER_V8_PLAYER_CUSTODY_DRIFT' });
  };
  await check(() => {}, true);
  await check(s => { s.objects.clock.fields.timestamp_ms = '1000'; }, true);
  for (const mutate of [
    s => { s.objects.clock.objectId = id(99); },
    s => { s.objects.clock.type = `${id(1)}::fake::Clock`; },
    s => { s.objects.clock.owner.initialSharedVersion = '2'; },
    s => { s.objects.clock.fields.timestamp_ms = '999'; },
    s => { s.objects.clock.fields.timestamp_ms = 'invalid'; },
    s => { delete s.objects.clock.fields.timestamp_ms; },
    s => { s.objects.clock.version = '6'; },
    s => { s.objects.clock.version = '7'; },
    s => { s.objects.clock.fields.extra = true; },
    s => { s.objects.root.fields.creator = id(99); },
    s => { s.objects.protocolConfig.version = '8'; },
    s => { s.objects.makerTreasury.digest = digest(34); },
  ]) await check(mutate, false);
});

test('Player ValidDuring envelope rejects wrong chain, unbounded validity and timestamp substitutions', async t => {
  for (const mode of ['chain', 'wide', 'reversed', 'missing-min', 'missing-max', 'timestamp']) await t.test(mode, async () => {
    const client = clientFixture();
    const original = client.core.resolveTransactionPlugin;
    client.core.resolveTransactionPlugin = () => async (data, options, next) => {
      const expiry = data.expiration.ValidDuring;
      if (mode === 'chain') expiry.chain = digest(99);
      if (mode === 'wide') expiry.maxEpoch = '43';
      if (mode === 'reversed') expiry.minEpoch = '43';
      if (mode === 'missing-min') expiry.minEpoch = null;
      if (mode === 'missing-max') expiry.maxEpoch = null;
      if (mode === 'timestamp') expiry.maxTimestamp = '1000';
      return original()(data, options, next);
    };
    const compiler = createMakerV8PlayerCompilerAdapterV8({ client, runtime,
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
    const request = await certifiedRequest(client, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS);
    const prepared = await compiler.preparePlayerAction(request);
    const boundary = createMakerV8PlayerBoundaryAdapterV8({ client, runtime, compiler,
      persistence: createMakerV8PlayerPersistenceV8(new IDBFactory()),
      wallet: { getCurrentAccount: async () => request.account, verifyExactSignature: async () => false },
      execution: { allowWalletSignature: false, allowBroadcast: false },
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
    await assert.rejects(boundary.buildExactTransaction({ descriptor: prepared.plan.descriptor }));
  });
});


test('unsigned retirement retains the original WAL and releases scope and Root atomically for cold preparation', async () => {
  const indexedDB = new IDBFactory();
  const options = { databaseName: 'player-unsigned-retirement', storageManager: storageManager() };
  const persistence = createMakerV8PlayerPersistenceV8(indexedDB, options);
  const original = { actionId: commitment('a'), scopeKey: commitment('b'), revision: 1,
    createdAt: 1, updatedAt: 1, status: 'PREPARED', signatureIntent: null, signature: null,
    broadcast: null, query: null, certificate: null, playerIdentity: { rootId },
    recipe: {}, loadout: {}, input: {}, plan: { signer, value: 3 },
    transaction: { digest: digest(3), bytes: 'original-bytes' } };
  await persistence.create(original);
  const changedBytes = { ...original, revision: 2, status: 'CANCELLED_UNSIGNED',
    transaction: { ...original.transaction, bytes: 'replacement-bytes' } };
  await assert.rejects(persistence.compareAndSwap(original.actionId, 1, changedBytes), { code: 'MAKER_V8_PLAYER_CAS_CONFLICT' });
  assert.equal(await persistence.resolveActive(original.scopeKey), original.actionId);
  assert.equal(await persistence.resolveRootActive({ rootId, signer }), original.actionId);
  const retired = { ...original, revision: 2, updatedAt: 2, status: 'CANCELLED_UNSIGNED' };
  await persistence.compareAndSwap(original.actionId, 1, retired);
  const cold = createMakerV8PlayerPersistenceV8(indexedDB, options);
  assert.deepEqual(await cold.load(original.actionId), retired);
  assert.deepEqual((await cold.loadByDigest(original.transaction.digest)).transaction, original.transaction);
  assert.equal(await cold.resolveActive(original.scopeKey), null);
  assert.equal(await cold.resolveRootActive({ rootId, signer }), null);
  const replacement = { ...original, actionId: commitment('d'), transaction: { digest: digest(4), bytes: 'new-reviewed-bytes' } };
  await cold.create(replacement);
  assert.equal(await cold.resolveActive(original.scopeKey), replacement.actionId);
  assert.equal(await cold.resolveRootActive({ rootId, signer }), replacement.actionId);
  assert.deepEqual((await cold.load(original.actionId)).transaction, original.transaction);
});

test('WAL retirement rejects signed or uncertain artifacts and preserves both active indices', async () => {
  for (const field of ['status', 'signatureIntent', 'signature', 'broadcast', 'query', 'certificate']) {
    const persistence = createMakerV8PlayerPersistenceV8(new IDBFactory(), {
      databaseName: 'player-no-retirement-'+field, storageManager: storageManager() });
    const original = { actionId: commitment('a'), scopeKey: commitment('b'), revision: 1,
      createdAt: 1, updatedAt: 1, status: 'PREPARED', signatureIntent: null, signature: null,
      broadcast: null, query: null, certificate: null, playerIdentity: { rootId },
      recipe: {}, loadout: {}, input: {}, plan: { signer }, transaction: { digest: digest(3) },
      [field]: field === 'status' ? 'SIGNING_UNKNOWN' : { artifact: true } };
    await persistence.create(original);
    await assert.rejects(persistence.compareAndSwap(original.actionId, 1,
      { ...original, revision: 2, updatedAt: 2, status: 'CANCELLED_UNSIGNED' }), { code: 'MAKER_V8_PLAYER_CAS_CONFLICT' });
    assert.deepEqual(await persistence.load(original.actionId), original);
    assert.equal(await persistence.resolveActive(original.scopeKey), original.actionId);
    assert.equal(await persistence.resolveRootActive({ rootId, signer }), original.actionId);
  }
});


test('committed Loadout reuse requires exact certified live custody and actual selection identity', async () => {
  for (const mode of ['match', 'absent', 'different', 'access', 'forged', 'drift', 'clock']) {
    const request = requestFor(MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT);
    const state = request.context.builderInput;
    if (mode !== 'absent') {
      const committed = playerState({ action: request.action, makerLoadout: owned(id(361), { revision: '1' }) });
      state.objects.makerLoadout = committed.objects.makerLoadout;
      state.currentSelections = committed.currentSelections;
    }
    if (mode === 'different') state.currentSelections[0].itemKey = 'another-item';
    if (mode === 'access') state.currentSelections[0].accessSubject = id(999);
    state.objects.clock.type = normalizeStructTag('0x2::clock::Clock');
    state.objects.clock.fields = { id: runtime.clockObjectId, timestamp_ms: '1000' };
    let reads = 0;
    const custody = createMakerV8PlayerCustodyAdapterV8({ client: clientFixture(), runtime,
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {},
      loadPlayerState: async () => {
        const next = structuredClone(state);
        if (reads++ > 0 && mode === 'drift') next.objects.makerLoadout.version = '9';
        if (reads > 1 && mode === 'clock') {
          next.objects.clock.version = '8'; next.objects.clock.digest = digest(33);
          next.objects.clock.fields.timestamp_ms = '1001';
        }
        return next;
      },
    });
    const { context: ignored, ...input } = request;
    const context = await custody.loadPlayerContext(input);
    const operation = custody.matchesCommittedPlayerLoadout({ ...input,
      context: mode === 'forged' ? structuredClone(context) : context });
    if (mode === 'forged') await assert.rejects(operation, { code: 'MAKER_V8_PLAYER_CUSTODY_PROOF_REQUIRED' });
    else if (mode === 'drift') await assert.rejects(operation, { code: 'MAKER_V8_PLAYER_CUSTODY_DRIFT' });
    else assert.equal(await operation, ['match', 'clock'].includes(mode), mode);
  }
});


test('production Player composition exposes certified committed Loadout reuse without signing', async () => {
  const fallback = new TestTransport();
  const grpc = new SuiGrpcClient({ network: 'mainnet', transport: {
    mergeOptions: options => fallback.mergeOptions(options),
    unary(method, input, options) {
      assert.equal(method.service.typeName, 'sui.rpc.v2.LedgerService');
      assert.equal(method.name, 'GetServiceInfo');
      const response = method.O.create({ chainId: MAKER_V8_MAINNET_GENESIS_DIGEST,
        chain: 'mainnet', epoch: 41n, checkpointHeight: 100n,
        lowestAvailableCheckpoint: 1n, lowestAvailableCheckpointObjects: 1n, server: 'test' });
      return new TestTransport({ response }).unary(method, input, options);
    },
    serverStreaming() { throw Error('Unexpected RPC'); },
    clientStreaming() { throw Error('Unexpected RPC'); }, duplex() { throw Error('Unexpected RPC'); },
  } });
  grpc.core.getCurrentSystemState = async () => ({ systemState: { epoch: '41' } });
  const client = createMakerV8SuiGrpcTransport({ grpcClient: grpc,
    graphqlClient: new SuiGraphQLClient({ network: 'mainnet', url: 'https://graphql.mainnet.sui.io/graphql',
      fetch: async () => { throw Error('Unexpected discovery'); } }) });
  const request = requestFor(MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT);
  const state = playerState({ action: request.action, makerLoadout: owned(id(361), { revision: '1' }) });
  let signatures = 0;
  const forbidden = async () => { signatures++; throw Error('No signing in production composition readback'); };
  const adapters = await createProductionMakerV8PlayerAdaptersV8({ client, runtime,
    productRuntime: { schemaVersion: 'animacraft.maker-v8-product-runtime.v1', runtime,
      catalog: { async loadPlayer() { throw Error('not reached'); } } },
    execution: { allowWalletSignature: true, allowBroadcast: true },
    indexedDB: new IDBFactory(), persistenceOptions: { storageManager: storageManager() },
    walletAdapter: { async getCurrentAccount() { return request.account; }, reconnect: forbidden,
      signExactTransaction: forbidden, verifyExactSignature: forbidden,
      subscribe(listener) { listener({ revision: 0, account: request.account }); return () => {}; }, dispose() {} },
    loadRuntimeAttestation: async () => ({ runtime }),
    loadPlayerState: async () => structuredClone(state),
  });
  const { context: ignored, ...input } = request;
  const context = await adapters.custody.loadPlayerContext(input);
  assert.equal(await adapters.custody.matchesCommittedPlayerLoadout({ ...input, context }), true);
  assert.equal(signatures, 0);
});


test('native Complete event binds its Soulidity mint entrypoint separately from the AC event type origin', async t => {
  const type = `${runtime.roles.output.typeOriginPackageId}::output_v8::NativeSoulBoundV8`;
  const fields = { binding_id: id(455), soul_id: id(452), soul_state_id: id(453), root_id: rootId,
    output_id: id(450), receipt_id: id(451), original_holder: signer, authorization_commitment: new Array(32).fill(11) };
  const layout = bcs.struct('NativeSoulBoundV8', { binding_id: bcs.Address, soul_id: bcs.Address,
    soul_state_id: bcs.Address, root_id: bcs.Address, output_id: bcs.Address, receipt_id: bcs.Address,
    original_holder: bcs.Address, authorization_commitment: bcs.vector(bcs.u8()) });
  const event = { type, packageId: runtime.nativeSoulIntegration.soulidityCallablePackageId,
    transactionModule: 'market', sender: signer, parsedJson: structuredClone(fields), bcs: layout.serialize(fields).toBase64() };
  const record = { action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, playerIdentity: { rootId },
    plan: { signer, descriptor: { expected: { expectedEventType: type } } } };
  const outputs = [
    { type: runtime.nativeSoulIntegration.expectedNativeBinding.soulOriginalType, objectId: fields.soul_id },
    { type: `${runtime.nativeSoulIntegration.soulidityOriginalPackageId}::soul::SoulState`, objectId: fields.soul_state_id },
    { type: `${runtime.roles.output.typeOriginPackageId}::output_v8::NativeSoulBindingV8`, objectId: fields.binding_id,
      fields: { authorizationCommitment: '0b'.repeat(32) } },
    { type: `${runtime.roles.output.typeOriginPackageId}::output_v8::CompleteOutputV8`, objectId: fields.output_id },
    { type: `${runtime.roles.output.typeOriginPackageId}::output_v8::CompleteReceiptV8`, objectId: fields.receipt_id },
  ];
  const run = events => certifyMakerV8PlayerFinalizedEventV8({ runtime, record, outputs, response: { events } });
  const certificate = run([event]);
  assert.equal(certificate.type, type);
  assert.equal(certificate.fields.authorization_commitment, '0b'.repeat(32));
  for (const [name, mutate] of Object.entries({
    wrongPackage: e => { e.packageId = id(999); },
    eventDefinitionAsEmitter: e => { e.packageId = runtime.roles.output.callablePackageId; e.transactionModule = 'output_v8'; },
    wrongModule: e => { e.transactionModule = 'soul'; },
    wrongSigner: e => { e.sender = id(999); },
    wrongType: e => { e.type = `${id(999)}::output_v8::NativeSoulBoundV8`; },
    changedJson: e => { e.parsedJson.soul_id = id(999); },
    forgedBoundSoul: e => { e.parsedJson.soul_id = id(999); e.bcs = layout.serialize(e.parsedJson).toBase64(); },
    forgedRoot: e => { e.parsedJson.root_id = id(999); e.bcs = layout.serialize(e.parsedJson).toBase64(); },
    forgedAuthorization: e => { e.parsedJson.authorization_commitment = new Array(32).fill(12); e.bcs = layout.serialize(e.parsedJson).toBase64(); },
    trailingBytes: e => { e.bcs = toBase64(new Uint8Array([...fromBase64(e.bcs), 0])); },
  })) await t.test(name, () => {
    const wrong = structuredClone(event); mutate(wrong); assert.throws(() => run([wrong]));
  });
  assert.throws(() => run([event, event]), { code: 'MAKER_V8_PLAYER_EVENT_INVALID' });
  assert.throws(() => run([]), { code: 'MAKER_V8_PLAYER_EVENT_INVALID' });
});
