import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

import {
  MARKET_V8_LIFECYCLES,
  MARKET_V8_QUOTE_KINDS,
  createMarketV8Client,
  createMarketV8RecoveryEvidenceV8,
  inspectMarketActionOnChainV8,
} from '../maker-v8-market.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
} from '../maker-v8-chain.js';
import { MAKER_V8_TRANSACTION_ABSENCE_SCHEMA } from '../maker-v8-actions.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MAKER_V8_RECOVERY_ERROR,
  MAKER_V8_RECOVERY_ERROR_LAYER,
  MAKER_V8_RECOVERY_STATE,
  MAKER_V8_SIGNATURE_DISPOSITION,
  MakerV8RecoveryError,
  canonicalMakerV8RecoveryIdentity,
  canonicalMakerV8RecoveryScope,
  createMakerV8RecoveryController,
  createMakerV8RecoveryMemoryAdapter,
  createMakerV8RecoverySessionId,
  makerV8RecoveryIdentityKey,
  makerV8RecoveryScopeKey,
  makerV8RecoveryScopeLookupKey,
} from '../maker-v8-recovery.js';
import { CORE_BASE_REGISTRY_MODULE_BASE64 } from './fixtures/maker-v8-runtime-attestation.js';

const packageId = (digit) => `0x${digit.repeat(64)}`;
const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const bytes32 = (value) => Array(32).fill(value);
const digest = '11111111111111111111111111111111';
const NETWORK = 'mainnet';
const FINALIZED_EPOCH = '77';
const EFFECTS_FINGERPRINT = `0x${'ab'.repeat(32)}`;
const EVENTS_DIGEST = '22222222222222222222222222222222';

function absentTransactionResult(transactionDigest, {
  watermarkEpoch = '0',
  watermarkCheckpointSequence = '1',
  watermarkCheckpointDigest = digest,
} = {}) {
  return {
    status: 'NOT_FOUND',
    digest: transactionDigest,
    absence: {
      schemaVersion: MAKER_V8_TRANSACTION_ABSENCE_SCHEMA,
      kind: 'SUI_JSON_RPC_TRANSACTION_NOT_FOUND',
      rpcCode: -32602,
      rpcType: 'InvalidParams',
      requestedDigest: transactionDigest,
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      watermarkEpoch,
      watermarkCheckpointSequence,
      watermarkCheckpointDigest,
    },
  };
}

const runtimeInput = Object.freeze({
  schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
  protocolVersion: 8,
  enabled: true,
  catalogId: id(800),
  protocolConfigId: id(801),
  protocolTreasuryId: id(802),
  paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
  clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
  roles: Object.freeze({
    core: { typeOriginPackageId: packageId('1'), callablePackageId: packageId('1') },
    seal: { typeOriginPackageId: packageId('6'), callablePackageId: packageId('6') },
    runtime: { typeOriginPackageId: packageId('4'), callablePackageId: packageId('4') },
    output: { typeOriginPackageId: packageId('2'), callablePackageId: packageId('2') },
    physical: { typeOriginPackageId: packageId('3'), callablePackageId: packageId('3') },
    market: { typeOriginPackageId: packageId('9'), callablePackageId: packageId('9') },
    release: { typeOriginPackageId: packageId('7'), callablePackageId: packageId('7') },
  }),
  roleConfigIds: Object.freeze({
    seal: id(803),
    runtime: id(804),
    output: id(805),
    physical: id(806),
    market: id(807),
    release: id(808),
  }),
  makerBindings: Object.freeze([]),
});

function runtimeAttestationRpc(runtime) {
  const runtimeRoles = Object.keys(runtime.roles);
  const roles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const authority = Object.fromEntries(roles.map((role, index) => [role, id(900 + index)]));
  const roleCommitment = Object.fromEntries(
    Object.keys(runtime.roles).map((role, index) => [role, bytes32(40 + index)]),
  );
  const productCommitment = bytes32(60);
  const callSetCommitment = bytes32(61);
  const objectResponse = (type, objectId, fields) => ({
    data: {
      objectId,
      version: '1',
      digest,
      type,
      owner: { Shared: { initial_shared_version: '1' } },
      content: {
        dataType: 'moveObject',
        type,
        fields: { id: { id: objectId }, ...fields },
      },
    },
  });
  const binding = Object.fromEntries(
    Object.entries(runtime.roles).map(([role, identity], index) => [role, { fields: {
      original_package_id: identity.typeOriginPackageId,
      callable_package_id: identity.callablePackageId,
      source_commitment: bytes32(10 + index),
      package_commitment: bytes32(20 + index),
      abi_commitment: bytes32(30 + index),
      commitment: roleCommitment[role],
    } }]),
  );
  const catalog = objectResponse(
    `${runtime.roles.core.typeOriginPackageId}::package_binding_v8::ProductReleaseCatalogV8`,
    runtime.catalogId,
    {
      version: '8',
      protocol_config_id: runtime.protocolConfigId,
      protocol_config_revision: '7',
      protocol_config_commitment: bytes32(4),
      binding: { fields: {
        version: '8',
        native_capability_mask: '127',
        ...binding,
        commitment: productCommitment,
      } },
      call_cap_set: { fields: {
        version: '8',
        catalog_id: runtime.catalogId,
        product_binding_commitment: productCommitment,
        ...Object.fromEntries(roles.map((role) => [`${role}_authority_id`, authority[role]])),
        commitment: callSetCommitment,
      } },
      ...Object.fromEntries(roles.map((role) => [`${role}_call_cap`, null])),
    },
  );
  const typeNames = {
    seal: ['seal_v8', 'SealPolicyConfigV8'],
    runtime: ['runtime_binding_v8', 'RuntimePackageConfigV8'],
    output: ['output_v8', 'OutputPackageConfigV8'],
    physical: ['physical_v8', 'PhysicalPackageConfigV8'],
    market: ['market_v8', 'MarketPackageConfigV8'],
    release: ['release_v8', 'ReleasePackageConfigV8'],
  };
  const configs = Object.fromEntries(roles.map((role) => {
    const [moduleName, typeName] = typeNames[role];
    return [role, objectResponse(
      `${runtime.roles[role].typeOriginPackageId}::${moduleName}::${typeName}`,
      runtime.roleConfigIds[role],
      {
        version: '8',
        catalog_id: runtime.catalogId,
        product_binding_commitment: productCommitment,
        call_cap_set_commitment: callSetCommitment,
        [`${role}_call_cap`]: { fields: {
          version: '8',
          authority_id: authority[role],
          catalog_id: runtime.catalogId,
          product_binding_commitment: productCommitment,
          role_binding_commitment: roleCommitment[role],
          call_cap_set_commitment: callSetCommitment,
        } },
      },
    )];
  }));
  return {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getObject({ id: objectId }) {
      if (objectId === runtime.catalogId) return catalog;
      const packageIndex = runtimeRoles.findIndex((role) => runtime.roles[role].callablePackageId === objectId);
      if (packageIndex >= 0) return {
        data: {
          objectId,
          version: '1',
          digest: String(packageIndex + 2).repeat(44),
          owner: { Immutable: true },
          bcs: { dataType: 'package', id: objectId, version: '1', moduleMap: packageIndex === 0 ? { base_registry_v8: CORE_BASE_REGISTRY_MODULE_BASE64 } : {} },
        },
      };
      const role = roles.find((candidate) => runtime.roleConfigIds[candidate] === objectId);
      return configs[role];
    },
  };
}

const attestedRuntime = (await attestMakerV8Runtime(
  runtimeAttestationRpc(runtimeInput),
  runtimeInput,
)).runtime;
const marketClient = createMarketV8Client(attestedRuntime, { network: NETWORK });
const { types } = marketClient;

function moveObject(type, objectId, fields) {
  return {
    data: {
      objectId,
      version: '7',
      digest,
      content: {
        dataType: 'moveObject',
        type,
        hasPublicTransfer: false,
        fields: { id: { id: objectId }, ...fields },
      },
    },
  };
}

const quoteBcs = bcs.struct('MarketQuoteV8RecoveryTest', {
  quote_kind: bcs.u8(),
  root_id: bcs.Address,
  maker_version: bcs.u64(),
  root_content_commitment: bcs.vector(bcs.u8()),
  economics_commitment: bcs.vector(bcs.u8()),
  rights_commitment: bcs.vector(bcs.u8()),
  gross_atomic: bcs.u64(),
  protocol_atomic: bcs.u64(),
  creator_atomic: bcs.u64(),
  source_atomic: bcs.u64(),
  seller_atomic: bcs.u64(),
  commitment: bcs.vector(bcs.u8()),
});

const hexVector = (value) => Uint8Array.from(
  value.slice(2).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)),
);

function quoteBytes(quote) {
  return quoteBcs.serialize({
    quote_kind: quote.quoteKind,
    root_id: quote.rootId,
    maker_version: quote.makerVersion,
    root_content_commitment: hexVector(quote.rootContentCommitment),
    economics_commitment: hexVector(quote.economicsCommitment),
    rights_commitment: hexVector(quote.rightsCommitment),
    gross_atomic: quote.grossAtomic,
    protocol_atomic: quote.protocolAtomic,
    creator_atomic: quote.creatorAtomic,
    source_atomic: quote.sourceAtomic,
    seller_atomic: quote.sellerAtomic,
    commitment: hexVector(quote.commitment),
  }).toBytes();
}

const object = (objectId, type, extra = {}) => ({
  objectId,
  network: NETWORK,
  type,
  ...extra,
});
const wallet = (address) => ({ address, network: NETWORK });
const objectRef = (objectId, version = '7', objectDigest = digest) => ({
  id: objectId,
  version,
  digest: objectDigest,
});

async function makeFixture({ offset = 0, grossAtomic = 1_000_000n, currentEpoch = '100' } = {}) {
  const IDs = {
    registry: id(100 + offset),
    treasury: id(101 + offset),
    root: id(104 + offset),
    admin: id(107 + offset),
    makerTreasury: id(108 + offset),
    seller: id(200 + offset),
  };
  const registryFields = {
    catalog_id: runtimeInput.catalogId,
    package_config_id: runtimeInput.roleConfigIds.market,
    product_binding_commitment: bytes32(1),
    call_cap_set_commitment: bytes32(2),
    root_id: IDs.root,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    protocol_config_id: runtimeInput.protocolConfigId,
    protocol_config_revision: '7',
    protocol_config_commitment: bytes32(0xdd),
    economics_commitment: bytes32(0xbb),
    rights_commitment: bytes32(0xcc),
    maker_market_fee_bps: '250',
    soul_market_fee_bps: '300',
    soul_creator_royalty_bps: '500',
    maker_source_royalty_bps: '200',
    maker_resale_royalty_bps: '400',
    treasury_id: IDs.treasury,
    sealed: true,
    revision: '4',
    listing_count: '4',
    escrow_count: '4',
    completed_sale_count: '0',
    canceled_sale_count: '0',
    recovered_sale_count: '0',
    gross_volume_atomic: '0',
    protocol_paid_atomic: '0',
    creator_paid_atomic: '0',
    source_paid_atomic: '0',
    seller_paid_atomic: '0',
    zero_state_commitment: bytes32(3),
  };
  const treasuryFields = {
    version: '8',
    catalog_id: runtimeInput.catalogId,
    package_config_id: runtimeInput.roleConfigIds.market,
    root_id: IDs.root,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    escrow: { value: '0' },
    gross_escrowed_atomic: '0',
    gross_released_atomic: '0',
  };
  const registry = marketClient.parseRegistry(
    moveObject(types.marketRegistry, IDs.registry, registryFields),
  );
  const treasury = marketClient.parseTreasury(
    moveObject(types.marketTreasury, IDs.treasury, treasuryFields),
  );
  const root = object(IDs.root, types.makerRoot, {
    adminCapId: IDs.admin,
    ownerAddress: IDs.seller,
    creatorAddress: IDs.seller,
    controlEpoch: '9',
    binding: Object.freeze({
      makerTreasuryId: IDs.makerTreasury,
      marketRegistryId: IDs.registry,
      marketTreasuryId: IDs.treasury,
    }),
    lifecycleCode: MARKET_V8_LIFECYCLES.PAUSED,
  });
  const localQuote = marketClient.quoteMakerResale(registry, grossAtomic);
  const chainQuote = await marketClient.inspectQuoteOnChain({
    async simulateTransaction() {
      return {
        $kind: 'Transaction',
        commandResults: [{ returnValues: [{ bcs: quoteBytes(localQuote) }] }],
      };
    },
  }, {
    registry,
    treasury,
    root,
    wallet: wallet(IDs.seller),
    quoteKind: MARKET_V8_QUOTE_KINDS.MAKER_RESALE,
    grossAtomic,
  });
  const builtAction = marketClient.buildListMakerControl({
    registry,
    treasury,
    root,
    catalog: object(runtimeInput.catalogId, types.catalog),
    config: object(runtimeInput.roleConfigIds.market, types.marketConfig),
    protocolConfig: object(runtimeInput.protocolConfigId, types.protocolConfig, {
      enabled: true,
      revision: registry.fields.protocolConfigRevision,
      commitment: registry.fields.protocolConfigCommitment,
    }),
    wallet: wallet(IDs.seller),
    admin: object(IDs.admin, types.makerAdmin),
    makerTreasury: object(IDs.makerTreasury, types.makerTreasury, { balanceAtomic: 0n }),
    chainQuote,
    grossAtomic,
    expectedRegistryRevision: registry.fields.revision,
  });
  const descriptor = builtAction.descriptor;
  const identity = {
    chain: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    wallet: descriptor.sender,
    lane: 'MAKER',
    action: descriptor.action,
    packageTuple: descriptor.packageTuple.map((entry) => ({
      role: entry.role.toUpperCase(),
      originalPackageId: entry.originalPackageId,
      callablePackageId: entry.callablePackageId,
      packageDigest: entry.packageDigest,
    })),
    paymentCoin: descriptor.typeArguments[0],
    listing: objectRef(IDs.admin),
    root: objectRef(IDs.root),
    registry: objectRef(IDs.registry),
    treasury: objectRef(IDs.treasury),
    rootContentCommitment: descriptor.rootContentCommitment,
    protocolRevision: descriptor.protocolRevision,
    listingRevision: descriptor.expectation.listingRevision,
    quoteCommitment: descriptor.expectation.quoteCommitment,
    authority: { kind: 'MAKER_ADMIN', refs: [objectRef(IDs.admin)] },
  };
  const simulationClient = {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: currentEpoch } }; },
      async simulateTransaction({ transaction, include }) {
        assert.ok(transaction instanceof Uint8Array);
        assert.deepEqual(include, { effects: true, events: true, commandResults: true });
        const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transaction);
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: transactionDigest,
            status: { success: true, error: null },
            effects: {
              transactionDigest,
              status: { success: true, error: null },
            },
          },
        };
      },
      async getBalance({ coinType }) {
        return {
          balance: {
            balance: '1000000',
            coinBalance: '800000',
            addressBalance: '20000000',
            coinType,
          },
        };
      },
      async listCoins({ coinType }) {
        return {
          objects: [{
            objectId: id(998), version: '1', digest, balance: '1000000', coinType,
          }],
          hasNextPage: false,
          cursor: null,
        };
      },
      resolveTransactionPlugin() {
        return async (transactionData, _options, next) => {
          transactionData.inputs = transactionData.inputs.map((input) => {
            if (!input.UnresolvedObject) return input;
            return Inputs.SharedObjectRef({
              objectId: input.UnresolvedObject.objectId,
              initialSharedVersion: '1',
              mutable: true,
            });
          });
          transactionData.gasData = {
            budget: '10000000',
            price: '1000',
            owner: transactionData.sender,
            payment: Array.from({ length: 20 }, (_, index) => ({
              objectId: id(999 + index), version: '1', digest,
            })),
          };
          await next();
        };
      },
    },
  };
  async function issueEvidence() {
    const proof = await inspectMarketActionOnChainV8(simulationClient, builtAction);
    return createMarketV8RecoveryEvidenceV8(builtAction, proof);
  }
  const seedEvidence = await issueEvidence();
  const transactionBytes = seedEvidence.transactionBytes;
  const transactionDigest = seedEvidence.transactionDigest;
  const plan = {
    transactionBytes,
    transactionDigest,
    stage: 'MARKET_LIST',
    sequence: descriptor.expectation.listingRevision,
    signer: descriptor.sender,
    epochWindow: seedEvidence.epochWindow,
    gas: seedEvidence.gasData,
    expiration: seedEvidence.expiration,
    sourceSnapshot: {
      schema: 'animacraft.market-source-snapshot.v8',
      fingerprint: seedEvidence.sourceFingerprint,
      descriptor: seedEvidence.descriptor,
    },
  };
  return {
    builtAction,
    identity,
    plan,
    transactionBytes,
    transactionDigest,
    IDs,
    async freshEvidence() {
      const evidence = await issueEvidence();
      assert.equal(evidence.transactionBytes, transactionBytes);
      return evidence;
    },
  };
}

const primary = await makeFixture();
const changedQuote = await makeFixture({ grossAtomic: 2_000_000n });
const otherScope = await makeFixture({ offset: 2_000 });
const epochDrift = await makeFixture({ currentEpoch: '101' });

function transactionDigest(bytes) {
  return TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes));
}

function mutateTransactionBytes(bytes, mutate) {
  const snapshot = TransactionDataBuilder.fromBytes(fromBase64(bytes)).snapshot();
  mutate(snapshot);
  return toBase64(TransactionDataBuilder.restore(snapshot).build());
}

function signatureFor({ digest: transactionDigestValue, signer }) {
  return `signature:${transactionDigestValue}:${signer}`;
}

function forwardingAdapter(base, compareAndSwap, load = undefined) {
  return {
    load: load || ((...args) => base.load(...args)),
    compareAndSwap: compareAndSwap || ((...args) => base.compareAndSwap(...args)),
    loadReceipt: (...args) => base.loadReceipt(...args),
    loadFinalizedFailure: (...args) => base.loadFinalizedFailure(...args),
    listFinalizedFailures: (...args) => base.listFinalizedFailures(...args),
    loadExpiredNotFound: (...args) => base.loadExpiredNotFound(...args),
    listExpiredNotFound: (...args) => base.listExpiredNotFound(...args),
  };
}

function harness({
  fixture = primary,
  persist = createMakerV8RecoveryMemoryAdapter(),
  sessionId = createMakerV8RecoverySessionId(),
  clock = Date.now,
  evidenceMaxAgeMs,
  signatureLeaseMs,
  confirmNoSignedArtifact,
  currentEpoch = fixture.plan.epochWindow.start,
  sign,
  query,
  broadcast,
  readback,
  verifySignature,
} = {}) {
  const calls = [];
  let currentIdentity = fixture.identity;
  const controller = createMakerV8RecoveryController({
    persist,
    sessionId,
    clock,
    ...(evidenceMaxAgeMs === undefined ? {} : { evidenceMaxAgeMs }),
    ...(signatureLeaseMs === undefined ? {} : { signatureLeaseMs }),
    ...(confirmNoSignedArtifact === undefined ? {} : { confirmNoSignedArtifact }),
    deriveTransactionDigest: async (bytes) => transactionDigest(bytes),
    verifySignature: verifySignature || (async ({ signature, digest: signedDigest, signer }) => ({
      verified: signature === signatureFor({ digest: signedDigest, signer }),
      digest: signedDigest,
      signer,
    })),
    getContext: async () => {
      calls.push({ kind: 'context' });
      return {
        identity: currentIdentity,
        currentEpoch: typeof currentEpoch === 'function' ? currentEpoch() : currentEpoch,
      };
    },
    getCurrentEpoch: async () => (
      typeof currentEpoch === 'function' ? currentEpoch() : currentEpoch
    ),
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
      return absentTransactionResult(request.digest);
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
        planHash: request.planHash,
        epoch: request.outcome.epoch,
        effectsFingerprint: request.outcome.effectsFingerprint,
        eventsDigest: request.outcome.eventsDigest,
        evidence: { event: 'exact-event', objectReadback: true },
      };
    }),
  });
  return {
    controller,
    persist,
    calls,
    setContext(next) { currentIdentity = next; },
  };
}

async function prepare(setup, fixture = primary, prepareOptions = undefined) {
  return setup.controller.prepare({
    identity: fixture.identity,
    plan: fixture.plan,
    evidence: await fixture.freshEvidence(),
    options: { afterFinalizedFailure: prepareOptions?.afterFinalizedFailure === true },
  });
}

async function prepareAndSign(setup, fixture = primary) {
  await prepare(setup, fixture);
  return requestSignatureWithFreshBinding(setup, fixture);
}

async function freshSigningBinding(setup, fixture = primary, evidence = undefined) {
  const record = await setup.controller.load(fixture.identity);
  return {
    identity: fixture.identity,
    liveIdentity: fixture.identity,
    plan: fixture.plan,
    expectedRevision: record.revision,
    expectedPlanHash: record.plan.fingerprint,
    evidence: evidence ?? await fixture.freshEvidence(),
  };
}

async function requestSignatureWithFreshBinding(
  setup,
  fixture = primary,
  evidence = undefined,
) {
  return setup.controller.requestSignature(
    await freshSigningBinding(setup, fixture, evidence),
  );
}

async function reclaimDurableUnsigned(setup, fixture = primary) {
  const record = await setup.controller.load(fixture.identity);
  return setup.controller.reclaimAwaitingSignature({
    identity: record.identity,
    expectedRevision: record.revision,
    expectedPlanHash: record.plan.fingerprint,
  });
}

function errorIs(code, layer) {
  return (error) => error instanceof MakerV8RecoveryError
    && error.code === code
    && (layer === undefined || error.layer === layer);
}

test('canonical identity and public scope bind Mainnet plus the exact seven-role tuple', () => {
  const raw = primary.identity;
  const canonical = canonicalMakerV8RecoveryIdentity(raw);
  const reordered = { ...raw, packageTuple: [...raw.packageTuple].reverse() };
  assert.equal(canonical.chain, MAKER_V8_MAINNET_CHAIN_IDENTIFIER);
  assert.deepEqual(canonical.packageTuple.map((entry) => entry.role), [
    'CORE', 'MARKET', 'OUTPUT', 'PHYSICAL', 'RELEASE', 'RUNTIME', 'SEAL',
  ]);
  assert.equal(canonical.authority.kind, 'MAKER_ADMIN');
  assert.equal(Object.isFrozen(canonical.authority.refs[0]), true);
  assert.equal(makerV8RecoveryIdentityKey(raw), makerV8RecoveryIdentityKey(reordered));
  assert.notEqual(
    makerV8RecoveryIdentityKey(raw),
    makerV8RecoveryIdentityKey(changedQuote.identity),
  );
  assert.equal(makerV8RecoveryScopeKey(raw), makerV8RecoveryScopeKey(changedQuote.identity));
  const scope = canonicalMakerV8RecoveryScope({
    chain: raw.chain,
    rootId: raw.root.id,
  });
  assert.equal(makerV8RecoveryScopeLookupKey(scope), makerV8RecoveryScopeKey(raw));
  assert.throws(
    () => canonicalMakerV8RecoveryIdentity({ ...raw, chain: 'sui:mainnet' }),
    errorIs(MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID),
  );
  assert.throws(
    () => canonicalMakerV8RecoveryIdentity({
      ...raw,
      packageTuple: raw.packageTuple.map((entry, index) => (
        index === 0 ? { ...entry, packageDigest: 'caller-hash' } : entry
      )),
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID),
  );
});

test('prepare and requestSignature consume separate fresh branded Mainnet evidence', async () => {
  const setup = harness();
  const prepareEvidence = await primary.freshEvidence();
  const ready = await setup.controller.prepare({
    identity: primary.identity,
    plan: primary.plan,
    evidence: prepareEvidence,
    options: { afterFinalizedFailure: false },
  });
  assert.equal(ready.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(ready.plan.transactionBytes, primary.transactionBytes);
  assert.ok(ready.plan.transactionBytes.length > 2_048);
  assert.equal(ready.plan.market.descriptor.target, primary.builtAction.descriptor.target);
  await assert.rejects(
    requestSignatureWithFreshBinding(setup, primary, prepareEvidence),
    errorIs(MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_REPLAY),
  );
  const cloned = { ...await primary.freshEvidence() };
  await assert.rejects(
    requestSignatureWithFreshBinding(setup, primary, cloned),
    errorIs(MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_REQUIRED),
  );
  const signed = await requestSignatureWithFreshBinding(setup);
  assert.equal(signed.state, MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE);
});

test('requestSignature atomically binds live identity, full plan hash, revision, and one proof', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const prepared = harness({ persist });
  await prepare(prepared);
  const evidence = await primary.freshEvidence();
  const binding = await freshSigningBinding(prepared, primary, evidence);
  binding.expectedRevision += 1;
  await assert.rejects(
    prepared.controller.requestSignature(binding),
    errorIs(MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT, MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY),
  );
  binding.expectedRevision -= 1;
  const expectedHash = binding.expectedPlanHash;
  binding.expectedPlanHash = `0x${'77'.repeat(32)}`;
  await assert.rejects(
    prepared.controller.requestSignature(binding),
    errorIs(MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT, MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY),
  );
  binding.expectedPlanHash = expectedHash;
  assert.equal((await prepared.controller.requestSignature(binding)).state,
    MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE);

  const racePersist = createMakerV8RecoveryMemoryAdapter();
  let walletEntries = 0;
  const left = harness({
    persist: racePersist,
    sessionId: createMakerV8RecoverySessionId(),
    sign: async (request) => {
      walletEntries += 1;
      return { ...request, signature: signatureFor(request) };
    },
  });
  const right = harness({
    persist: racePersist,
    sessionId: createMakerV8RecoverySessionId(),
    sign: async (request) => {
      walletEntries += 1;
      return { ...request, signature: signatureFor(request) };
    },
  });
  await prepare(left);
  const [leftBinding, rightBinding] = await Promise.all([
    freshSigningBinding(left),
    freshSigningBinding(right),
  ]);
  const outcomes = await Promise.allSettled([
    left.controller.requestSignature(leftBinding),
    right.controller.requestSignature(rightBinding),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((entry) => entry.status === 'rejected');
  assert.equal(errorIs(MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT)(rejected.reason), true);
  assert.equal(walletEntries, 1);
});

test('signed bytes become durable before query and byte-identical query-first replay', async () => {
  const base = createMakerV8RecoveryMemoryAdapter();
  const order = [];
  const persist = forwardingAdapter(base, async (...args) => {
    order.push(`persist:${args[2].state}`);
    return base.compareAndSwap(...args);
  });
  const setup = harness({
    persist,
    query: async (request) => {
      order.push('query');
      setup.calls.push({ kind: 'query', request });
      return absentTransactionResult(request.digest);
    },
    broadcast: async (request) => {
      order.push('broadcast');
      setup.calls.push({ kind: 'broadcast', request });
      return { digest: request.digest };
    },
  });
  const signed = await prepareAndSign(setup);
  const walletRequest = setup.calls.find((entry) => entry.kind === 'sign').request;
  assert.equal(walletRequest.recovery.planHash, signed.plan.fingerprint);
  assert.equal(walletRequest.recovery.revision, signed.revision - 1);
  assert.equal(walletRequest.recovery.scopeKey, signed.scopeKey);
  const pending = await setup.controller.broadcastSigned(primary.identity);
  assert.equal(pending.state, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING);
  const sent = setup.calls.find((entry) => entry.kind === 'broadcast').request;
  assert.equal(sent.bytes, signed.signed.bytes);
  assert.equal(sent.signature, signed.signed.signature);
  assert.equal(sent.digest, primary.transactionDigest);
  assert.ok(order.indexOf('persist:SIGNED_DURABLE') < order.indexOf('query'));
  assert.ok(order.indexOf('query') < order.indexOf('persist:BROADCASTING'));
  assert.ok(order.indexOf('persist:BROADCASTING') < order.indexOf('broadcast'));
});

test('wallet byte, digest, signer, and signature alterations never become durable', async (t) => {
  const cases = [
    ['bytes', (request) => ({ ...request, bytes: changedQuote.transactionBytes,
      signature: signatureFor(request) }), MAKER_V8_RECOVERY_ERROR.SIGNED_BYTES_MISMATCH],
    ['digest', (request) => ({ ...request, digest: changedQuote.transactionDigest,
      signature: signatureFor(request) }), MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH],
    ['signer', (request) => ({ ...request, signer: id(9999),
      signature: signatureFor(request) }), MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT],
    ['signature', (request) => ({ ...request, signature: 'forged' }),
      MAKER_V8_RECOVERY_ERROR.SIGNATURE_INVALID],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      const setup = harness({ sign: async (request) => mutate(request) });
      await prepare(setup);
      await assert.rejects(
        requestSignatureWithFreshBinding(setup),
        errorIs(code),
      );
      const record = await setup.controller.load(primary.identity);
      assert.equal(record.state, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE);
      assert.equal(record.signed, null);
      assert.equal(setup.calls.some((entry) => entry.kind === 'broadcast'), false);
    });
  }
});

test('wallet rejection survives reload; explicit reclaim CAS permits only a new proof', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const rejected = harness({
    persist,
    sessionId: 'session-rejected-0001',
    signatureLeaseMs: 1_000,
    sign: async () => {
      const error = new Error('wallet user rejected');
      error.definitiveRejection = true;
      error.signedArtifactCreated = false;
      throw error;
    },
  });
  await prepare(rejected);
  await assert.rejects(
    requestSignatureWithFreshBinding(rejected),
    errorIs(MAKER_V8_RECOVERY_ERROR.SIGNING_FAILED, MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING),
  );
  const stranded = await rejected.controller.loadByScope({
    chain: primary.identity.chain,
    rootId: primary.identity.root.id,
  });
  assert.equal(stranded.state, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE);
  assert.equal(stranded.signed, null);
  let now = stranded.signatureLease.expiresAtMs - 1;
  const reloaded = harness({
    persist,
    sessionId: 'session-reloaded-0002',
    signatureLeaseMs: 1_000,
    clock: () => now,
    confirmNoSignedArtifact: async (request) => ({
      confirmedUnsigned: true,
      scopeKey: request.scopeKey,
      identityKey: request.identityKey,
      planHash: request.planHash,
      sessionId: request.sessionId,
      leaseExpiresAtMs: request.leaseExpiresAtMs,
      checkedAtMs: request.checkedAtMs,
    }),
  });
  const premature = await primary.freshEvidence();
  await assert.rejects(
    requestSignatureWithFreshBinding(reloaded, primary, premature),
    errorIs(MAKER_V8_RECOVERY_ERROR.SIGNATURE_REPLACEMENT_FORBIDDEN),
  );
  await assert.rejects(
    reclaimDurableUnsigned(reloaded, primary),
    errorIs(MAKER_V8_RECOVERY_ERROR.SIGNATURE_LEASE_ACTIVE),
  );
  now = stranded.signatureLease.expiresAtMs;
  const ready = await reclaimDurableUnsigned(reloaded, primary);
  assert.equal(ready.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(ready.revision, stranded.revision + 1);
});

test('unknown wallet outcome survives reload and requires an exact expired-lease confirmation', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const prepareEvidence = await primary.freshEvidence();
  let now = prepareEvidence.dryRunAtMs;
  const oldSessionId = createMakerV8RecoverySessionId();
  const newSessionId = createMakerV8RecoverySessionId();
  assert.notEqual(oldSessionId, newSessionId);
  const crashed = harness({
    persist,
    sessionId: oldSessionId,
    signatureLeaseMs: 1_000,
    clock: () => now,
    sign: async () => { throw new Error('wallet transport vanished after request'); },
  });
  await crashed.controller.prepare({
    identity: primary.identity,
    plan: primary.plan,
    evidence: prepareEvidence,
    options: { afterFinalizedFailure: false },
  });
  const requestEvidence = await primary.freshEvidence();
  now = requestEvidence.dryRunAtMs;
  await assert.rejects(
    requestSignatureWithFreshBinding(crashed, primary, requestEvidence),
    errorIs(MAKER_V8_RECOVERY_ERROR.SIGNING_FAILED),
  );
  const stranded = await crashed.controller.load(primary.identity);
  assert.equal(stranded.signatureDisposition, MAKER_V8_SIGNATURE_DISPOSITION.OUTCOME_UNKNOWN);
  assert.equal(stranded.signatureLease.sessionId, oldSessionId);
  assert.equal(stranded.signatureLease.planHash, stranded.plan.fingerprint);

  const proof = await primary.freshEvidence();
  now = proof.dryRunAtMs;
  const reloaded = harness({
    persist,
    sessionId: newSessionId,
    signatureLeaseMs: 1_000,
    clock: () => now,
  });
  await assert.rejects(
    reloaded.controller.discardUnsigned(primary.identity),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN),
  );
  await assert.rejects(
    reclaimDurableUnsigned(reloaded, primary),
    errorIs(MAKER_V8_RECOVERY_ERROR.SIGNATURE_LEASE_ACTIVE),
  );
  now = stranded.signatureLease.expiresAtMs;
  await assert.rejects(
    reclaimDurableUnsigned(reloaded, primary),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_REQUIRED),
  );

  const malformed = harness({
    persist,
    sessionId: newSessionId,
    signatureLeaseMs: 1_000,
    clock: () => now,
    confirmNoSignedArtifact: async (request) => ({
      confirmedUnsigned: true,
      scopeKey: request.scopeKey,
      identityKey: request.identityKey,
      planHash: request.planHash,
      sessionId: newSessionId,
      leaseExpiresAtMs: request.leaseExpiresAtMs,
      checkedAtMs: now,
    }),
  });
  await assert.rejects(
    reclaimDurableUnsigned(malformed, primary),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_INVALID),
  );

  const confirmed = harness({
    persist,
    sessionId: newSessionId,
    signatureLeaseMs: 1_000,
    clock: () => now,
    confirmNoSignedArtifact: async (request) => ({
      confirmedUnsigned: true,
      scopeKey: request.scopeKey,
      identityKey: request.identityKey,
      planHash: request.planHash,
      sessionId: request.sessionId,
      leaseExpiresAtMs: request.leaseExpiresAtMs,
      checkedAtMs: now,
    }),
  });
  confirmed.setContext(changedQuote.identity);
  const ready = await reclaimDurableUnsigned(confirmed, primary);
  assert.equal(ready.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(ready.revision, stranded.revision + 1);
  assert.equal(ready.signatureSessionId, null);
  assert.equal(ready.signatureLease, null);
});

test('unsigned READY can be discarded; AWAITING must be explicitly reclaimed first', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const setup = harness({ persist });
  const ready = await prepare(setup);
  assert.equal(await setup.controller.discardUnsigned(primary.identity), null);
  assert.equal(await setup.controller.loadByScope({
    chain: primary.identity.chain,
    rootId: primary.identity.root.id,
  }), null);
  const discarded = await persist.load(makerV8RecoveryScopeKey(primary.identity));
  assert.equal(discarded.state, MAKER_V8_RECOVERY_STATE.DISCARDED);
  assert.equal(discarded.revision, ready.revision + 1);
  setup.setContext(changedQuote.identity);
  const rebuilt = await prepare(setup, changedQuote);
  assert.equal(rebuilt.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(rebuilt.revision, discarded.revision + 1);

  const pending = harness({
    fixture: changedQuote,
    persist,
    sessionId: createMakerV8RecoverySessionId(),
    signatureLeaseMs: 1_000,
    sign: async () => {
      const error = new Error('wallet canceled without signing');
      error.definitiveRejection = true;
      error.signedArtifactCreated = false;
      throw error;
    },
  });
  await assert.rejects(
    requestSignatureWithFreshBinding(pending, changedQuote),
    errorIs(MAKER_V8_RECOVERY_ERROR.SIGNING_FAILED),
  );
  assert.equal((await pending.controller.load(changedQuote.identity)).signatureDisposition,
    MAKER_V8_SIGNATURE_DISPOSITION.DEFINITIVE_REJECTION);
  const awaiting = await pending.controller.load(changedQuote.identity);
  let now = awaiting.signatureLease.expiresAtMs;
  const disposer = harness({
    fixture: changedQuote,
    persist,
    sessionId: createMakerV8RecoverySessionId(),
    signatureLeaseMs: 1_000,
    clock: () => now,
    confirmNoSignedArtifact: async (request) => ({
      confirmedUnsigned: true,
      scopeKey: request.scopeKey,
      identityKey: request.identityKey,
      planHash: request.planHash,
      sessionId: request.sessionId,
      leaseExpiresAtMs: request.leaseExpiresAtMs,
      checkedAtMs: request.checkedAtMs,
    }),
  });
  await assert.rejects(
    disposer.controller.discardUnsigned(changedQuote.identity),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN),
  );
  assert.equal((await reclaimDurableUnsigned(disposer, changedQuote)).state,
    MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(await disposer.controller.discardUnsigned(changedQuote.identity), null);
  assert.equal(await disposer.controller.load(changedQuote.identity), null);
});

test('tombstone revisions prevent late-wallet ABA overwrite after same-scope replacement', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const oldSessionId = createMakerV8RecoverySessionId();
  const newSessionId = createMakerV8RecoverySessionId();
  assert.notEqual(oldSessionId, newSessionId);
  let enteredA;
  let releaseA;
  const aEntered = new Promise((resolve) => { enteredA = resolve; });
  const aGate = new Promise((resolve) => { releaseA = resolve; });
  const first = harness({
    persist,
    sessionId: oldSessionId,
    signatureLeaseMs: 1_000,
    sign: async (request) => {
      enteredA();
      await aGate;
      return { ...request, signature: signatureFor(request) };
    },
  });
  await prepare(first);
  const staleSigning = requestSignatureWithFreshBinding(first);
  await aEntered;
  const winner = harness({
    fixture: changedQuote,
    persist,
    sessionId: newSessionId,
    signatureLeaseMs: 1_000,
    confirmNoSignedArtifact: async (request) => ({
      confirmedUnsigned: true,
      scopeKey: request.scopeKey,
      identityKey: request.identityKey,
      planHash: request.planHash,
      sessionId: request.sessionId,
      leaseExpiresAtMs: request.leaseExpiresAtMs,
      checkedAtMs: Date.now(),
    }),
  });
  const stranded = await first.controller.load(primary.identity);
  const remainingLeaseMs = Math.max(0, stranded.signatureLease.expiresAtMs - Date.now());
  await new Promise((resolve) => setTimeout(resolve, remainingLeaseMs + 5));
  winner.setContext(changedQuote.identity);
  const reclaimed = await reclaimDurableUnsigned(winner);
  assert.equal(reclaimed.revision, stranded.revision + 1);
  await winner.controller.discardUnsigned(primary.identity);
  await prepare(winner, changedQuote);
  const signedNew = await requestSignatureWithFreshBinding(winner, changedQuote);
  releaseA();
  await assert.rejects(staleSigning, errorIs(MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT));
  const durable = await winner.controller.load(changedQuote.identity);
  assert.equal(durable.state, MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE);
  assert.equal(durable.signed.digest, signedNew.signed.digest);
  assert.equal(durable.identityKey, makerV8RecoveryIdentityKey(changedQuote.identity));
});

test('signed records cannot be discarded through controller or persistence adapter', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const setup = harness({ persist });
  const signed = await prepareAndSign(setup);
  await assert.rejects(
    setup.controller.discardUnsigned(primary.identity),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN),
  );
  const forbidden = {
    ...signed,
    revision: signed.revision + 1,
    state: MAKER_V8_RECOVERY_STATE.DISCARDED,
    plan: null,
    signed: null,
    signatureSessionId: null,
    queryOutcome: null,
    lastError: null,
    receipt: null,
    failure: null,
  };
  await assert.rejects(
    persist.compareAndSwap(signed.scopeKey, signed.revision, forbidden, {
      discardUnsigned: true,
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN),
  );
  await assert.rejects(
    persist.compareAndSwap(signed.scopeKey, signed.revision, null),
    errorIs(MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID),
  );
});

test('loadByScope rejects cross-scope persistence substitution', async () => {
  const firstPersist = createMakerV8RecoveryMemoryAdapter();
  const secondPersist = createMakerV8RecoveryMemoryAdapter();
  await prepare(harness({ persist: firstPersist }));
  await prepare(harness({ fixture: otherScope, persist: secondPersist }), otherScope);
  const foreignRecord = await secondPersist.load(makerV8RecoveryScopeKey(otherScope.identity));
  const substituted = forwardingAdapter(
    firstPersist,
    undefined,
    async () => foreignRecord,
  );
  const setup = harness({ persist: substituted });
  await assert.rejects(
    setup.controller.loadByScope({
      chain: primary.identity.chain,
      rootId: primary.identity.root.id,
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID),
  );
});

test('real SDK bytes and durable fields fail closed under adversarial tampering', async (t) => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  await prepare(harness({ persist }));
  const snapshot = persist.snapshot();
  const scopeKey = makerV8RecoveryScopeKey(primary.identity);
  const unrelatedCommand = {
    MoveCall: {
      package: id(7000),
      module: 'evil',
      function: 'steal',
      typeArguments: [],
      arguments: [],
    },
    $kind: 'MoveCall',
  };
  const extraBytes = mutateTransactionBytes(primary.transactionBytes, (snapshot) => {
    snapshot.commands.push(unrelatedCommand);
  });
  const gasBytes = mutateTransactionBytes(primary.transactionBytes, (snapshot) => {
    snapshot.gasData.budget = '10000001';
  });
  const cases = [
    ['record revision', (record) => { record.revision = 0; }],
    ['transaction bytes', (record) => { record.plan.transactionBytes = changedQuote.transactionBytes; }],
    ['descriptor action', (record) => { record.plan.market.descriptor.action = 'cancelMakerControl'; }],
    ['descriptor lane', (record) => { record.plan.market.descriptor.lane = 3; }],
    ['descriptor target', (record) => { record.plan.market.descriptor.target = `${id(7001)}::market_v8::list_maker_control_v8`; }],
    ['descriptor package tuple', (record) => { record.plan.market.descriptor.packageTuple[0].callablePackageId = id(7002); }],
    ['descriptor package digest', (record) => { record.plan.market.descriptor.packageTuple[0].packageDigest = 'Z'.repeat(32); }],
    ['descriptor object ref', (record) => { record.plan.market.descriptor.arguments[0].objectId = id(7003); }],
    ['descriptor quote', (record) => { record.plan.market.descriptor.expectation.quoteCommitment = `0x${'ab'.repeat(32)}`; }],
    ['runtime package tuple', (record) => { record.plan.market.runtime.roles.core.callablePackageId = id(7004); }],
    ['gas snapshot', (record) => { record.plan.gas.budget = '10000001'; }],
    ['gas payment ref', (record) => { record.plan.gas.payment[0].objectId = id(7005); }],
    ['gas funding intent', (record) => {
      record.plan.gas.funding = {
        kind: 'ADDRESS_BALANCE', addressBalance: '10000000', coinType: '0x2::sui::SUI',
      };
    }],
    ['expiration epoch', (record) => { record.plan.expiration.epoch = '102'; }],
    ['epoch window', (record) => { record.plan.epochWindow.start = '99'; }],
    ['source fingerprint', (record) => { record.plan.sourceSnapshot.fingerprint = `0x${'ef'.repeat(32)}`; }],
    ['source prestate', (record) => {
      record.plan.sourceSnapshot.descriptor.preState.root.owner = id(7006);
    }],
    ['stage', (record) => { record.plan.stage = 'MARKET_CANCEL'; }],
    ['sequence', (record) => { record.plan.sequence = '999'; }],
    ['full plan fingerprint', (record) => { record.plan.fingerprint = `0x${'ba'.repeat(32)}`; }],
    ['gas bytes', (record) => {
      record.plan.transactionBytes = gasBytes;
      record.plan.transactionDigest = transactionDigest(gasBytes);
    }],
    ['extra command', (record) => {
      record.plan.transactionBytes = extraBytes;
      record.plan.transactionDigest = transactionDigest(extraBytes);
    }],
    ['identity quote', (record) => { record.identity.quoteCommitment = `0x${'cd'.repeat(32)}`; }],
    ['scope field', (record) => { record.scopeKey = makerV8RecoveryScopeKey(otherScope.identity); }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const seeded = structuredClone(snapshot);
      mutate(seeded.active[scopeKey]);
      const setup = harness({ persist: createMakerV8RecoveryMemoryAdapter(seeded) });
      await assert.rejects(
        setup.controller.loadByScope({
          chain: primary.identity.chain,
          rootId: primary.identity.root.id,
        }),
        errorIs(MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID),
      );
    });
  }
  await assert.rejects(
    inspectMarketActionOnChainV8(
      {
        async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      },
      primary.builtAction,
      extraBytes,
    ),
    (error) => error.code === 'MARKET_V8_CALLER_TRANSACTION_BYTES_FORBIDDEN',
  );
});

test('unrelated fresh evidence, altered identity fields, and stale proof are rejected', async () => {
  const setup = harness();
  await prepare(setup);
  await assert.rejects(
    requestSignatureWithFreshBinding(setup, primary, await changedQuote.freshEvidence()),
    errorIs(MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH),
  );

  const liveDriftEvidence = await primary.freshEvidence();
  const liveDriftRequest = await freshSigningBinding(setup, primary, liveDriftEvidence);
  liveDriftRequest.liveIdentity = changedQuote.identity;
  await assert.rejects(
    setup.controller.requestSignature(liveDriftRequest),
    errorIs(MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT, MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT),
  );

  const altered = {
    ...primary.identity,
    quoteCommitment: changedQuote.identity.quoteCommitment,
  };
  const alteredSetup = harness();
  await assert.rejects(
    alteredSetup.controller.prepare({
      identity: altered,
      plan: primary.plan,
      evidence: await primary.freshEvidence(),
      options: { afterFinalizedFailure: false },
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH),
  );

  const stale = await primary.freshEvidence();
  const staleSetup = harness({
    clock: () => stale.dryRunAtMs + 60_001,
    evidenceMaxAgeMs: 60_000,
  });
  await assert.rejects(
    staleSetup.controller.prepare({
      identity: primary.identity,
      plan: primary.plan,
      evidence: stale,
      options: { afterFinalizedFailure: false },
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT),
  );
});

test('fresh evidence epoch drift blocks signing and replay still rechecks live epoch query-first', async () => {
  const preSign = harness();
  await prepare(preSign);
  await assert.rejects(
    requestSignatureWithFreshBinding(preSign, epochDrift),
    errorIs(MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH),
  );
  const stillReady = await preSign.controller.load(primary.identity);
  assert.equal(stillReady.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(preSign.calls.some((entry) => entry.kind === 'sign'), false);
  assert.equal(preSign.calls.some((entry) => entry.kind === 'context'), false);

  let currentEpoch = primary.plan.epochWindow.start;
  const replay = harness({ currentEpoch: () => currentEpoch });
  await prepareAndSign(replay);
  currentEpoch = String(BigInt(primary.plan.epochWindow.start) + 1n);
  await assert.rejects(
    replay.controller.recover(primary.identity, { replayIfNotFound: true }),
    errorIs(MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT, MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT),
  );
  assert.equal(replay.calls.some((entry) => entry.kind === 'query'), true);
  assert.equal(replay.calls.some((entry) => entry.kind === 'broadcast'), false);
});

test('query-first finalized success avoids rebroadcast and cleanup retains a receipt tombstone', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  let broadcasts = 0;
  const setup = harness({
    persist,
    query: async (request) => ({
      status: 'FINALIZED_SUCCESS',
      digest: request.digest,
      epoch: FINALIZED_EPOCH,
      effectsFingerprint: EFFECTS_FINGERPRINT,
      eventsDigest: EVENTS_DIGEST,
    }),
    broadcast: async () => {
      broadcasts += 1;
      throw new Error('must not broadcast');
    },
  });
  await prepareAndSign(setup);
  const verified = await setup.controller.recover(primary.identity, { replayIfNotFound: true });
  assert.equal(verified.state, MAKER_V8_RECOVERY_STATE.VERIFIED);
  assert.equal(broadcasts, 0);
  const readbackRequest = setup.calls.find((entry) => entry.kind === 'readback').request;
  assert.equal(readbackRequest.planHash, verified.plan.fingerprint);
  assert.deepEqual(readbackRequest.plan.sourceSnapshot.descriptor.preState,
    verified.plan.sourceSnapshot.descriptor.preState);
  assert.equal(verified.receipt.planHash, verified.plan.fingerprint);
  const receipt = await setup.controller.cleanupVerified(primary.identity);
  assert.equal(receipt.digest, primary.transactionDigest);
  assert.equal(await setup.controller.load(primary.identity), null);
  assert.deepEqual(await setup.controller.loadReceipt(primary.identity), receipt);
  const tombstone = await persist.load(makerV8RecoveryScopeKey(primary.identity));
  assert.equal(tombstone.state, MAKER_V8_RECOVERY_STATE.CLEANED);
  assert.equal(tombstone.plan, null);
  assert.equal(tombstone.signed, null);
});

test('finalized readback must echo the exact full durable plan hash', async () => {
  const setup = harness({
    query: async (request) => ({
      status: 'FINALIZED_SUCCESS',
      digest: request.digest,
      epoch: FINALIZED_EPOCH,
      effectsFingerprint: EFFECTS_FINGERPRINT,
      eventsDigest: EVENTS_DIGEST,
    }),
    readback: async (request) => ({
      verified: true,
      digest: request.digest,
      identity: request.identity,
      planHash: `0x${'55'.repeat(32)}`,
      epoch: request.outcome.epoch,
      effectsFingerprint: request.outcome.effectsFingerprint,
      eventsDigest: request.outcome.eventsDigest,
      evidence: { event: 'wrong-plan' },
    }),
  });
  await prepareAndSign(setup);
  await assert.rejects(
    setup.controller.recover(primary.identity),
    errorIs(MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.READBACK),
  );
  const pending = await setup.controller.load(primary.identity);
  assert.equal(pending.state, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING);
  assert.equal(pending.receipt, null);
});

test('finalized failure archives exact bytes but permits a fresh plan for the same identity', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  const failedSessionId = createMakerV8RecoverySessionId();
  const replacementSessionId = createMakerV8RecoverySessionId();
  assert.notEqual(failedSessionId, replacementSessionId);
  const setup = harness({
    persist,
    sessionId: failedSessionId,
    query: async (request) => ({
      status: 'FINALIZED_FAILURE',
      digest: request.digest,
      epoch: FINALIZED_EPOCH,
      effectsFingerprint: EFFECTS_FINGERPRINT,
      eventsDigest: EVENTS_DIGEST,
      error: { code: 'MOVE_ABORT', message: 'MoveAbort(8)' },
    }),
  });
  await prepareAndSign(setup);
  const failed = await setup.controller.recover(primary.identity);
  assert.equal(failed.state, MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE);
  assert.equal(failed.failure.planHash, failed.plan.fingerprint);
  assert.equal((await setup.controller.listFinalizedFailures(primary.identity)).length, 1);
  await assert.rejects(
    setup.controller.discardUnsigned(primary.identity),
    errorIs(MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN),
  );
  await assert.rejects(
    setup.controller.prepare({
      identity: primary.identity,
      plan: primary.plan,
      evidence: await primary.freshEvidence(),
      options: { afterFinalizedFailure: false },
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY),
  );
  assert.equal(makerV8RecoveryIdentityKey(epochDrift.identity),
    makerV8RecoveryIdentityKey(primary.identity));
  const reloaded = harness({
    fixture: epochDrift,
    persist,
    sessionId: replacementSessionId,
  });
  const replacement = await reloaded.controller.prepare({
    identity: epochDrift.identity,
    plan: epochDrift.plan,
    evidence: await epochDrift.freshEvidence(),
    options: { afterFinalizedFailure: true },
  });
  assert.equal(replacement.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(replacement.revision, failed.revision + 1);
  assert.equal((await reloaded.controller.listFinalizedFailures(epochDrift.identity)).length, 1);
});

test('untyped or unbound query absence never retires durable signed bytes', async (suite) => {
  const malformed = [
    ['null', null],
    ['undefined', undefined],
    ['unknown alias', { status: 'UNKNOWN', digest: primary.transactionDigest }],
    ['legacy bare not found', { status: 'NOT_FOUND', digest: primary.transactionDigest }],
    ['wrong chain', {
      ...absentTransactionResult(primary.transactionDigest),
      absence: {
        ...absentTransactionResult(primary.transactionDigest).absence,
        chainIdentifier: 'sui:testnet',
      },
    }],
  ];
  for (const [label, result] of malformed) {
    await suite.test(label, async () => {
      const persist = createMakerV8RecoveryMemoryAdapter();
      const setup = harness({ persist, query: async () => result });
      const signed = await prepareAndSign(setup);
      await assert.rejects(
        setup.controller.recover(primary.identity, { replayIfNotFound: false }),
        errorIs(MAKER_V8_RECOVERY_ERROR.QUERY_INVALID, MAKER_V8_RECOVERY_ERROR_LAYER.QUERY),
      );
      const durable = await setup.controller.load(primary.identity);
      assert.equal(durable.signed.digest, signed.signed.digest);
      assert.notEqual(durable.state, MAKER_V8_RECOVERY_STATE.EXPIRED_NOT_FOUND);
      assert.equal((await setup.controller.listExpiredNotFound(primary.identity)).length, 0);
    });
  }
});

test('authoritative NOT_FOUND past expiration is archived and releases the Root for fresh bytes', async () => {
  const persist = createMakerV8RecoveryMemoryAdapter();
  let currentEpoch = primary.plan.expiration.epoch;
  const setup = harness({
    persist,
    currentEpoch: () => currentEpoch,
    query: async (request) => absentTransactionResult(request.digest, {
      watermarkEpoch: currentEpoch,
      watermarkCheckpointSequence: '777',
    }),
  });
  await prepareAndSign(setup);
  const stillPending = await setup.controller.recover(primary.identity, { replayIfNotFound: false });
  assert.equal(stillPending.state, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING);
  currentEpoch = String(BigInt(primary.plan.expiration.epoch) + 1n);
  const expired = await setup.controller.recover(primary.identity, { replayIfNotFound: false });
  assert.equal(expired.state, MAKER_V8_RECOVERY_STATE.EXPIRED_NOT_FOUND);
  assert.equal(expired.plan, null);
  assert.equal(expired.signed, null);
  assert.equal(expired.expiration.digest, primary.transactionDigest);
  assert.equal(expired.expiration.planHash, stillPending.plan.fingerprint);
  assert.equal(await setup.controller.load(primary.identity), null);
  const archive = await setup.controller.listExpiredNotFound(primary.identity);
  assert.equal(archive.length, 1);
  assert.deepEqual(archive[0], expired.expiration);
  await assert.rejects(
    setup.controller.prepare({
      identity: primary.identity,
      plan: primary.plan,
      evidence: await primary.freshEvidence(),
      options: { afterFinalizedFailure: false },
    }),
    errorIs(MAKER_V8_RECOVERY_ERROR.EXPIRED_NOT_FOUND_REPLAY),
  );
  const replacement = await setup.controller.prepare({
    identity: epochDrift.identity,
    plan: epochDrift.plan,
    evidence: await epochDrift.freshEvidence(),
    options: { afterFinalizedFailure: false },
  });
  assert.equal(replacement.state, MAKER_V8_RECOVERY_STATE.READY);
  assert.equal(replacement.revision, expired.revision + 1);
  assert.equal((await setup.controller.listExpiredNotFound(primary.identity)).length, 1);
});
