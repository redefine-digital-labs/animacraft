#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { scanV8HistoryWindow } from './expansion-pack-v8-free-readiness.mjs';
import { queryIndependentExtensionLockV5 } from '../expansion-pack-publication-v8-app.js';

import {
  buildBindMakerReleaseEvidenceV5,
  buildConfigureMakerV5,
  buildFinalizeIndependentExtensionRootV5,
  parseCommerceV5Event,
  parseCommerceProtocolConfigV5,
  parseCommerceProtocolTreasuryV5,
  parseMakerControlCapV5,
  parseIndependentExtensionAuthorityV5,
  parseMakerRootV5,
  parseMakerTreasuryV5,
  queryPackRecordsV5,
  queryStyleBindingsV5,
} from '../chain-commerce-v5.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const INTENT_URL = new URL(
  '../deployments/expansion-pack-v8-free-wallet-test.intent.json',
  import.meta.url,
);
const DEFAULT_READINESS_PATH = resolve(
  REPO_ROOT,
  '../../docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation/pre-sign-readiness.json',
);
const DEFAULT_MIGRATION_PATH = resolve(
  REPO_ROOT,
  '../../docs/codex/assets/animacraft-expansion-pack-v8-wallet-test-activation/parent-migration-result.json',
);
const STAGES = new Set(['policy', 'evidence', 'finalize']);
const STAGE_INTENT = Object.freeze({
  policy: 'parentPolicy',
  evidence: 'parentEvidence',
  finalize: 'parentFinalize',
});

function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  throw error;
}

function text(value) {
  return String(value ?? '').trim();
}

function exactId(value, label) {
  try {
    return normalizeSuiAddress(text(value));
  } catch {
    return fail(`${label} is not an exact Sui ID.`, { label, value });
  }
}

export function requireIndependentExtensionTypeOrigin(intent) {
  const origin = exactId(
    intent?.protocol?.independentExtensionV5TypeOriginPackageId,
    'Independent extension TypeOrigin',
  );
  if (origin === normalizeSuiAddress('0x0')) {
    fail('Independent extension TypeOrigin must be populated before atomic finalization.');
  }
  return origin;
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value, space = 0) {
  return JSON.stringify(stableValue(value), null, space);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const args = {
    mode: 'lock',
    stage: '',
    readiness: DEFAULT_READINESS_PATH,
    migration: DEFAULT_MIGRATION_PATH,
    prior: '',
    lock: '',
    output: '',
    expectedLock: '',
    result: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--lock-only') args.mode = 'lock';
    else if (argument === '--execute') args.mode = 'execute';
    else if (['--stage', '--readiness', '--migration', '--prior', '--lock', '--output', '--expected-lock', '--result'].includes(argument)) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = text(argv[index + 1]);
      index += 1;
      if (!args[key]) fail(`${argument} requires a value.`);
    } else fail(`Unsupported argument: ${argument}`);
  }
  if (!STAGES.has(args.stage)) fail('--stage must be policy, evidence, or finalize.');
  if (args.mode === 'lock' && !args.output) fail('--output is required for lock-only mode.');
  if (args.mode === 'execute' && (!args.lock || !args.expectedLock || !args.result)) {
    fail('--lock, --expected-lock, and --result are required for execute mode.');
  }
  return args;
}

function objectFingerprint(object) {
  if (!object || object instanceof Error || object.$kind === 'Error' || object.error) {
    fail('A required Mainnet object is unavailable.', { object: stableValue(object) });
  }
  const json = object.json || object.data?.json || object.content?.fields || {};
  const owner = object.owner || object.data?.owner || null;
  const normalizedOwner = owner?.$kind && owner[owner.$kind] !== undefined
    ? { kind: owner.$kind, value: stableValue(owner[owner.$kind]) }
    : stableValue(owner);
  return {
    objectId: exactId(object.objectId || object.id || object.data?.objectId, 'Object ID'),
    version: text(object.version || object.data?.version),
    digest: text(object.digest || object.data?.digest),
    type: normalizeStructTag(text(object.type || object.data?.type)),
    owner: normalizedOwner,
    jsonSha256: sha256(stableJson(json)),
  };
}

function ownerSummary(owner) {
  if (!owner || typeof owner !== 'object') return stableValue(owner);
  if (owner.$kind && owner[owner.$kind] !== undefined) {
    return { kind: owner.$kind, value: stableValue(owner[owner.$kind]) };
  }
  return stableValue(owner);
}

function isSharedObject(object) {
  const owner = ownerSummary(object?.owner || object?.data?.owner);
  return owner?.kind === 'Shared' || Boolean(owner?.Shared || owner?.shared);
}

export function unavailableObjectResult(value, expectedId, {
  allowMessage = true,
  requireReportedId = false,
} = {}) {
  const source = value instanceof Error ? value : value?.error || value;
  if (!source || typeof source !== 'object') return '';
  const code = text(source.code || source.status).replace(/[^a-z]/gi, '').toLowerCase();
  const message = text(source.message || source.error);
  if (!['deleted', 'notexists', 'notfound', 'objectdeleted', 'objectnotexists', 'objectnotfound'].includes(code)
    && (!allowMessage
      || !/\b(?:deleted|not[ -]?found|does not exist|not exists)\b/i.test(message))) {
    return '';
  }
  const reportedId = text(source.objectId || source.object_id || source.details?.objectId || source.details?.object_id);
  if (reportedId && exactId(reportedId, 'Unavailable object ID') !== exactId(expectedId, 'Expected unavailable object ID')) {
    return '';
  }
  const messageIds = [...message.matchAll(/0x[0-9a-f]{1,64}/ig)].map(([entry]) => entry);
  const messageReportsExpectedId = messageIds.some(
    (entry) => exactId(entry, 'Unavailable message object ID') === exactId(expectedId, 'Expected unavailable object ID'),
  );
  if (!reportedId && messageIds.length > 0 && !messageReportsExpectedId) return '';
  if (requireReportedId && !reportedId && !messageReportsExpectedId) return '';
  return code || 'unavailable';
}

async function readObjects(client, ids) {
  const response = await client.core.getObjects({ objectIds: ids, include: { json: true } });
  const objects = response.objects || [];
  if (objects.length !== ids.length || objects.some((object) => object instanceof Error || object?.error)) {
    fail('Sui did not return every exact stage object.', { objects: stableValue(objects) });
  }
  return {
    objects,
    fingerprints: objects.map(objectFingerprint),
    byId: new Map(objects.map((object) => [
      exactId(object.objectId || object.id, 'Returned object ID'),
      object,
    ])),
  };
}

function simulationEnvelope(result, label) {
  if (result?.$kind === 'FailedTransaction' || result?.FailedTransaction) {
    fail(`${label} failed.`, { simulation: stableValue(result) });
  }
  const value = result?.Transaction || result;
  return {
    digest: text(value?.digest || result?.digest),
    effects: stableValue(value?.effects || result?.effects || {}),
    events: stableValue(value?.events || result?.events || []),
    objectTypes: stableValue(value?.objectTypes || result?.objectTypes || {}),
    commandResults: stableValue(value?.commandResults || result?.commandResults || []),
  };
}

function gasUsed(simulation) {
  const gas = simulation.effects?.gasUsed || simulation.effects?.gas_used || {};
  return {
    computationCostMist: text(gas.computationCost || gas.computation_cost),
    storageCostMist: text(gas.storageCost || gas.storage_cost),
    storageRebateMist: text(gas.storageRebate || gas.storage_rebate),
    nonRefundableStorageFeeMist: text(
      gas.nonRefundableStorageFee || gas.non_refundable_storage_fee,
    ),
  };
}

function expectedStyleRows(plan) {
  return plan.configuration.styleBindings.map((binding) => ({
    partKey: text(binding.partKey),
    itemKey: text(binding.itemKey),
    styleKey: text(binding.styleKey),
    packKey: text(binding.packKey),
    rowKind: Number(binding.rowKind),
  }));
}

function styleIdentity(row) {
  return `${row.partKey}\u0000${row.itemKey}\u0000${row.styleKey}`;
}

function assertStyleRows(actual, plan) {
  const expected = expectedStyleRows(plan);
  const expectedVisual = expected.filter((row) => row.rowKind === 0);
  const expectedCompatLogical = expected.filter((row) => row.rowKind === 1 || row.rowKind === 2);
  if (expected.length !== 26
    || expectedVisual.length !== 19
    || expectedCompatLogical.length !== 7
    || expected.some((row) => row.packKey || ![0, 1, 2].includes(row.rowKind))) {
    fail('The reviewed parent projection must be exactly 19 ordinary visual and 7 compatibility logical Base rows.');
  }
  const actualByKey = new Map(actual.map((row) => [styleIdentity(row), row]));
  if (actual.length !== expected.length || actualByKey.size !== expected.length) {
    fail('The chain Style registry count drifted from the reviewed 26-row plan.');
  }
  for (const row of expected) {
    const chain = actualByKey.get(styleIdentity(row));
    if (!chain || Number(chain.rowKind) !== row.rowKind || text(chain.packKey) !== row.packKey) {
      fail(`Style ${styleIdentity(row)} drifted from the reviewed parent projection.`, {
        expected: row,
        actual: stableValue(chain),
      });
    }
  }
}

function assertAtomicFinalizerCommand(transaction) {
  const commands = transaction.getData().commands;
  const call = commands[0]?.MoveCall;
  if (commands.length !== 1
    || text(call?.function || call?.functionName)
      !== 'finalize_independent_extension_root_v5') {
    fail('Finalization must be one atomic 19+7 registration, seal, lock, epoch-bump, and ControlCap-retirement call.');
  }
}

async function currentState({ client, intent, migration }) {
  const event = migration.event;
  const ids = [
    intent.protocol.commerceProtocolConfigV5Id,
    intent.protocol.commerceProtocolTreasuryV5Id,
    event.root_id,
    event.treasury_id,
    event.control_cap_id,
    intent.parent.legacyMakerId,
  ].map((id, index) => exactId(id, `Stage object ${index + 1}`));
  const objects = await readObjects(client, ids);
  const protocol = parseCommerceProtocolConfigV5(objects.byId.get(ids[0]));
  const protocolTreasury = parseCommerceProtocolTreasuryV5(objects.byId.get(ids[1]));
  const root = parseMakerRootV5(objects.byId.get(ids[2]));
  const makerTreasury = parseMakerTreasuryV5(objects.byId.get(ids[3]));
  const controlCap = parseMakerControlCapV5(objects.byId.get(ids[4]));
  if (!protocol.enabled
    || exactId(root.currentOwner, 'Root owner') !== exactId(intent.signer.address, 'Signer')
    || exactId(root.currentControlCapId, 'Root ControlCap') !== exactId(controlCap.objectId, 'ControlCap')
    || root.ownershipEpoch !== controlCap.ownershipEpoch
    || exactId(root.legacyMakerId, 'Root legacy Maker') !== exactId(intent.parent.legacyMakerId, 'Parent legacy Maker')
    || exactId(root.treasuryId, 'Root treasury') !== exactId(makerTreasury.objectId, 'Maker treasury')
    || exactId(protocol.treasuryId, 'Protocol treasury') !== exactId(protocolTreasury.objectId, 'Protocol treasury object')) {
    fail('The migrated v5 parent tuple drifted from its authoritative links.');
  }
  const [packs, styles] = await Promise.all([
    queryPackRecordsV5(client.core, root),
    queryStyleBindingsV5(client.core, root),
  ]);
  return { ids, objects, protocol, protocolTreasury, root, makerTreasury, controlCap, packs, styles };
}

async function readFinalizedState({
  client, intent, migration, readiness, finalizedEnvelope,
}) {
  const expectedAuditHash = `0x${text(readiness.lock.parent.zeroV8History?.auditHash)
    .replace(/^0x/i, '').toLowerCase()}`;
  const expectedOrigin = requireIndependentExtensionTypeOrigin(intent);
  const expectedRootId = exactId(migration.event.root_id, 'Finalized root ID');
  const expectedMakerId = exactId(intent.parent.legacyMakerId, 'Finalized legacy Maker ID');
  const expectedConfigId = exactId(
    intent.protocol.commerceProtocolConfigV5Id,
    'Finalized Commerce config ID',
  );
  const expectedAdminId = exactId(
    intent.protocol.protocolFeeAdminCapId,
    'Finalized protocol admin ID',
  );
  const expectedRetiredCapId = exactId(
    migration.event.control_cap_id,
    'Retired MakerControlCapV5 ID',
  );
  const finalizedEvents = finalizedEnvelope.events
    .map((event) => parseCommerceV5Event(event))
    .filter((event) => event?.name === 'IndependentExtensionRootFinalizedV5');
  if (finalizedEvents.length !== 1) {
    fail('Finalization did not emit exactly one IndependentExtensionRootFinalizedV5 event.', {
      events: stableValue(finalizedEnvelope.events),
    });
  }
  const event = finalizedEvents[0];
  const authorityId = exactId(event.authorityId, 'Finalized authority ID');
  for (const [actual, expected, label] of [
    [event.rootId, expectedRootId, 'root'],
    [event.legacyMakerId, expectedMakerId, 'legacy Maker'],
    [event.protocolConfigId, expectedConfigId, 'Commerce config'],
    [event.protocolAdminCapId, expectedAdminId, 'protocol admin'],
    [event.owner, intent.signer.address, 'owner'],
    [event.retiredControlCapId, expectedRetiredCapId, 'retired ControlCap'],
  ]) {
    if (exactId(actual, `Finalized ${label}`) !== exactId(expected, `Expected ${label}`)) {
      fail(`Finalized ${label} event field drifted.`, { actual, expected });
    }
  }
  if (event.retiredControlCapEpoch !== 0n
    || event.lockedOwnershipEpoch !== 1n
    || text(event.auditHash).toLowerCase() !== expectedAuditHash) {
    fail('Finalized epoch or audit hash drifted.', {
      event: stableValue(event), expectedAuditHash,
    });
  }

  const expectedIds = [expectedRootId, migration.event.treasury_id, authorityId]
    .map((id, index) => exactId(id, `Post-finalize object ${index + 1}`));
  const objects = await readObjects(client, expectedIds);
  const root = parseMakerRootV5(objects.byId.get(expectedIds[0]));
  const makerTreasury = parseMakerTreasuryV5(objects.byId.get(expectedIds[1]));
  const authorityObject = objects.byId.get(expectedIds[2]);
  const authority = parseIndependentExtensionAuthorityV5(authorityObject);
  if (!isSharedObject(authorityObject)) fail('IndependentExtensionAuthorityV5 is not shared.');
  const [packs, styles] = await Promise.all([
    queryPackRecordsV5(client.core, root),
    queryStyleBindingsV5(client.core, root),
  ]);
  const lock = await queryIndependentExtensionLockV5(client.core, {
    runtime: { independentExtensionV5TypeOriginPackageId: expectedOrigin },
    rootId: expectedRootId,
  });
  assertStyleRows(styles, readiness.lock.parent.commercePlan);
  if (root.lifecycle !== 1
    || root.styleCount !== 26n
    || !root.styleRegistrySealed
    || root.packCount !== 0n
    || root.activeListingId
    || exactId(root.currentControlCapId, 'Root ControlCap tombstone') !== expectedRetiredCapId
    || root.ownershipEpoch !== 1n
    || makerTreasury.balanceAtomic !== 0n
    || packs.length !== 0
    || normalizeStructTag(authority.type)
      !== normalizeStructTag(`${expectedOrigin}::commerce_v5::IndependentExtensionAuthorityV5`)
    || authority.rootId !== expectedRootId
    || authority.legacyMakerId !== expectedMakerId
    || authority.protocolConfigId !== expectedConfigId
    || authority.protocolAdminCapId !== expectedAdminId
    || authority.owner !== exactId(intent.signer.address, 'Signer')
    || authority.retiredControlCapId !== expectedRetiredCapId
    || authority.retiredControlCapEpoch !== 0n
    || authority.lockedOwnershipEpoch !== 1n
    || text(authority.auditHash).toLowerCase() !== expectedAuditHash
    || lock.finalized !== true
    || lock.authorityId !== authority.objectId
    || lock.legacyMakerId !== expectedMakerId
    || lock.protocolConfigId !== expectedConfigId
    || lock.protocolAdminCapId !== expectedAdminId
    || lock.owner !== exactId(intent.signer.address, 'Signer')
    || lock.retiredControlCapId !== expectedRetiredCapId
    || lock.retiredControlCapEpoch !== 0n
    || lock.lockedOwnershipEpoch !== 1n
    || text(lock.auditHash).toLowerCase() !== expectedAuditHash) {
    fail('Finalized Root/Authority/tombstone readback drifted.', {
      root: stableValue(root),
      makerTreasury: stableValue(makerTreasury),
      authority: stableValue(authority),
      lock: stableValue(lock),
      packs: stableValue(packs),
      styles: stableValue(styles),
      expectedAuditHash,
    });
  }
  let retiredResult;
  try {
    retiredResult = await client.core.getObjects({
      objectIds: [expectedRetiredCapId],
      include: { json: true },
    });
  } catch (error) {
    const status = unavailableObjectResult(error, expectedRetiredCapId, {
      allowMessage: false,
      requireReportedId: true,
    });
    if (!status) {
      fail('Sui did not prove that the retired MakerControlCapV5 is unavailable.', {
        retiredResult: stableValue(error),
      });
    }
    retiredResult = { objects: [{ error: { code: status, objectId: expectedRetiredCapId } }] };
  }
  const retiredEntries = retiredResult?.objects || [];
  const retiredControlCapStatus = retiredEntries.length === 1
    ? unavailableObjectResult(retiredEntries[0], expectedRetiredCapId, {
      allowMessage: false,
      requireReportedId: true,
    })
    : '';
  if (!retiredControlCapStatus) {
    fail('The retired MakerControlCapV5 still exists or its deletion is unproven.', {
      retiredResult: stableValue(retiredResult),
    });
  }
  return {
    event: stableValue(event),
    root: stableValue(root),
    makerTreasury: stableValue(makerTreasury),
    authority: stableValue(authority),
    lock: stableValue(lock),
    packs: stableValue(packs),
    styles: stableValue(styles),
    objectFingerprints: objects.fingerprints,
    retiredControlCap: {
      objectId: expectedRetiredCapId,
      status: retiredControlCapStatus,
    },
  };
}

function assertPrecondition(stage, state, plan) {
  const { root, styles, packs } = state;
  if (packs.length !== 0 || root.packCount !== 0n || root.requiresSealPolicy || root.sealPolicyBound) {
    fail('The FREE parent unexpectedly requires a Pack or Seal policy.');
  }
  if (root.lifecycle !== 1) fail(`Stage ${stage} requires the parent to remain PAUSED.`);
  if (stage === 'policy') {
    if (root.styleCount !== 0n || root.styleRegistrySealed) fail('Policy stage requires a pristine migrated Root.');
  } else if (stage === 'finalize' || stage === 'evidence') {
    if (styles.length !== 0 || root.styleCount !== 0n || root.styleRegistrySealed) {
      fail(`${stage} stage requires the exact empty, unsealed PAUSED parent; all 26 rows and sealing occur only inside the atomic finalizer.`);
    }
  }
}

function buildStageTransaction(stage, { intent, state, plan, auditHash }) {
  const runtime = {
    commerceV5CallablePackageId: intent.protocol.commerceV5CallablePackageId,
    paymentCoinType: intent.protocol.paymentCoinType,
  };
  if (stage === 'policy') {
    return buildConfigureMakerV5({
      runtime,
      root: state.root,
      controlCap: state.controlCap,
      sender: intent.signer.address,
      ...plan.configuration,
      packs: plan.configuration.packs,
      styleBindings: [],
      sealStyleRegistry: false,
      activate: false,
    });
  }
  if (stage === 'finalize') {
    return buildFinalizeIndependentExtensionRootV5({
      runtime,
      root: state.root,
      makerTreasury: state.makerTreasury,
      controlCap: state.controlCap,
      protocol: state.protocol,
      protocolFeeAdminCapId: state.protocol.legacyAdminCapId,
      styleBindings: plan.configuration.styleBindings,
      auditHash: `0x${auditHash}`,
      sender: intent.signer.address,
    });
  }
  return buildBindMakerReleaseEvidenceV5({
    runtime,
    root: state.root,
    controlCap: state.controlCap,
    legacyMakerId: intent.parent.legacyMakerId,
    parentVersion: intent.parent.versionNumber,
    manifestBlobId: intent.parent.manifestQuiltId,
    manifestSha256: `0x${intent.parent.manifestSha256}`,
    sender: intent.signer.address,
  });
}

function setExactGas(transaction, reviewed) {
  transaction.setGasOwner(transaction.getData().sender);
  transaction.setGasPrice(reviewed.gasPriceMist);
  transaction.setGasBudget(reviewed.gasBudgetMist);
  transaction.setGasPayment([]);
  transaction.setExpiration({ ValidDuring: stableValue(reviewed.expiration) });
}

function stableSemantic(stage, simulation, intent, plan) {
  const eventTypes = simulation.events.map((event) => normalizeStructTag(text(event.eventType || event.type))).sort();
  const callable = exactId(intent.protocol.commerceV5CallablePackageId, 'Callable package');
  const expectedLegacyLogical = `${callable}::commerce_v5::LegacyLogicalStyleRegisteredV5`;
  const expectedFinalized = `${callable}::commerce_v5::IndependentExtensionRootFinalizedV5`;
  const expectedEvidence = `${exactId(intent.protocol.commerceV5TypeOriginPackageId, 'TypeOrigin')}::commerce_v5::MakerReleaseEvidenceBoundV5`;
  if (stage === 'policy' && simulation.commandResults.length !== 4) {
    fail('Policy dry-run command count drifted.');
  }
  if (stage === 'finalize' && simulation.commandResults.length !== 1) {
    fail('Atomic finalizer dry-run must contain exactly one command.');
  }
  if (stage === 'finalize'
    && eventTypes.filter((type) => type === expectedLegacyLogical).length !== 7) {
    fail('Atomic finalizer dry-run did not emit exactly 7 compatibility logical registration events.');
  }
  if (stage === 'finalize' && !eventTypes.includes(expectedFinalized)) {
    fail('Atomic finalizer dry-run did not emit IndependentExtensionRootFinalizedV5.');
  }
  if (stage === 'evidence' && !eventTypes.includes(expectedEvidence)) {
    fail('Evidence dry-run did not emit MakerReleaseEvidenceBoundV5.');
  }
  const relevantEvents = simulation.events.map((event) => ({
    eventType: normalizeStructTag(text(event.eventType || event.type)),
    json: stableValue(event.json || event.parsedJson || {}),
  })).sort((left, right) => left.eventType.localeCompare(right.eventType));
  return {
    success: true,
    gasUsed: gasUsed(simulation),
    commandCount: simulation.commandResults.length,
    relevantEvents,
    objectTypes: simulation.objectTypes,
  };
}

async function buildLock(args, intent, readiness, migration) {
  const independentExtensionV5TypeOriginPackageId = args.stage === 'finalize'
    ? requireIndependentExtensionTypeOrigin(intent)
    : '';
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: readiness.lock.network.grpcUrl });
  const [chain, system, balance] = await Promise.all([
    client.core.getChainIdentifier(),
    client.core.getCurrentSystemState(),
    client.core.getBalance({ owner: intent.signer.address }),
  ]);
  const reviewed = intent.transactions[STAGE_INTENT[args.stage]];
  if (text(chain.chainIdentifier) !== reviewed.expiration.chain
    || text(system.systemState.referenceGasPrice) !== reviewed.gasPriceMist) {
    fail('Network or reference gas price drifted from the stage lock.');
  }
  if (BigInt(system.systemState.epoch) < BigInt(reviewed.expiration.minEpoch)
    || BigInt(system.systemState.epoch) > BigInt(reviewed.expiration.maxEpoch)) {
    fail('The reviewed stage expiration is no longer valid.');
  }
  if (BigInt(balance.balance.addressBalance) < BigInt(reviewed.gasBudgetMist)) {
    fail('The signer Address Balance cannot cover the exact stage gas budget.');
  }
  const state = await currentState({ client, intent, migration });
  const plan = readiness.lock.parent.commercePlan;
  const auditHash = text(readiness.lock.parent.zeroV8History?.auditHash)
    .replace(/^0x/i, '').toLowerCase();
  if (args.stage === 'finalize' && !/^[0-9a-f]{64}$/.test(auditHash)) {
    fail('Atomic finalization requires the exact exhaustive zero-v8-history audit hash.');
  }
  let zeroHistoryContinuity = null;
  if (args.stage === 'finalize') {
    const anchored = readiness.lock.parent.zeroV8History;
    const { auditHash: anchoredAuditHash, ...anchoredProof } = anchored || {};
    if (text(anchoredAuditHash).replace(/^0x/i, '').toLowerCase() !== auditHash
      || sha256(stableJson(anchoredProof)) !== auditHash) {
      fail('The anchored zero-v8-history proof does not recompute to its finalizer audit hash.', {
        expected: auditHash,
        recomputed: sha256(stableJson(anchoredProof)),
      });
    }
    zeroHistoryContinuity = await scanV8HistoryWindow({
      runtime: { graphqlUrl: intent.network.graphqlUrl },
      intent: {
        ...intent,
        parent: {
          ...intent.parent,
          exactStyleRouteSha256: anchored?.finalization?.exactStyleRouteSha256,
        },
      },
      source: readiness.lock.source,
      afterCheckpoint: anchored?.cutoff?.sequenceNumber,
      expectedAuditHash: auditHash,
      expectedCutoff: anchored?.cutoff,
      expectedChainIdentifier: anchored?.chainIdentifier,
    });
  }
  assertPrecondition(args.stage, state, plan);
  const transaction = buildStageTransaction(args.stage, {
    intent, state, plan, auditHash,
  });
  if (args.stage === 'finalize') assertAtomicFinalizerCommand(transaction);
  setExactGas(transaction, reviewed);
  const bytes = await transaction.build({ client });
  if (!transaction.isFullyResolved()) fail('The stage transaction is not fully resolved.');
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const simulation = simulationEnvelope(await client.core.simulateTransaction({
    transaction: bytes,
    checksEnabled: true,
    include: { effects: true, events: true, objectTypes: true, commandResults: true },
  }), `Parent ${args.stage} dry-run`);
  const transactionLock = {
    digest,
    bytesSha256: sha256(bytes),
    bytesBase64: Buffer.from(bytes).toString('base64'),
    byteLength: bytes.byteLength,
    sender: exactId(intent.signer.address, 'Signer'),
    gasPriceMist: reviewed.gasPriceMist,
    gasBudgetMist: reviewed.gasBudgetMist,
    gasMode: reviewed.gasMode,
    expiration: stableValue(reviewed.expiration),
    data: stableValue(transaction.getData()),
  };
  const immutable = {
    stage: args.stage,
    readinessEvidenceSha256: sha256(await readFile(args.readiness)),
    readinessLockFingerprintSha256: readiness.lockFingerprintSha256,
    migrationResultSha256: sha256(await readFile(args.migration)),
    priorResultSha256: args.prior ? sha256(await readFile(resolve(REPO_ROOT, args.prior))) : '',
    network: stableValue(readiness.lock.network),
    protocolIdentities: args.stage === 'finalize' ? {
      independentExtensionV5TypeOriginPackageId,
    } : null,
    signer: stableValue(intent.signer),
    addressBalance: {
      balance: text(balance.balance.balance),
      coinBalance: text(balance.balance.coinBalance),
      addressBalance: text(balance.balance.addressBalance),
    },
    requiredObjectFingerprints: state.objects.fingerprints,
    preState: {
      root: stableValue(state.root),
      controlCap: stableValue(state.controlCap),
      makerTreasury: stableValue(state.makerTreasury),
      protocol: stableValue(state.protocol),
      packs: stableValue(state.packs),
      styles: stableValue(state.styles),
    },
    transaction: transactionLock,
    simulationLock: stableSemantic(args.stage, simulation, intent, plan),
    anchoredZeroHistory: args.stage === 'finalize' ? {
      auditHash,
      cutoff: stableValue(readiness.lock.parent.zeroV8History.cutoff),
      proofSha256: sha256(stableJson(readiness.lock.parent.zeroV8History)),
    } : null,
  };
  return {
    schemaVersion: 'animacraft.expansion-pack-v8-parent-stage-lock.v1',
    createdAt: new Date().toISOString(),
    lockFingerprintSha256: sha256(stableJson(immutable)),
    lock: immutable,
    simulationEvidence: simulation,
    zeroHistoryContinuityEvidence: stableValue(zeroHistoryContinuity),
  };
}

async function writeJson(path, value) {
  const outputPath = resolve(REPO_ROOT, path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${stableJson(value, 2)}\n`, { flag: 'w' });
}

async function signerEntry(intent) {
  const { stdout } = await execFileAsync('sui', ['keytool', 'list', '--json'], {
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  const entry = JSON.parse(stdout).find((candidate) => candidate.alias === intent.signer.alias);
  if (!entry || exactId(entry.suiAddress, 'Keystore signer') !== exactId(intent.signer.address, 'Signer')) {
    fail('The reviewed keystore alias no longer resolves to the approved signer.');
  }
  return entry;
}

async function executeLock(args, intent, readiness, migration) {
  const locked = JSON.parse(await readFile(resolve(REPO_ROOT, args.lock), 'utf8'));
  if (locked.lockFingerprintSha256 !== args.expectedLock || locked.lock.stage !== args.stage) {
    fail('The supplied stage lock does not match --stage/--expected-lock.');
  }
  if (args.stage === 'finalize') requireIndependentExtensionTypeOrigin(intent);
  const rebuilt = await buildLock(args, intent, readiness, migration);
  if (rebuilt.lockFingerprintSha256 !== locked.lockFingerprintSha256) {
    fail('Stage pre-sign inputs drifted; refusing to sign.', {
      expected: locked.lockFingerprintSha256,
      actual: rebuilt.lockFingerprintSha256,
    });
  }
  // buildLock exhaustively scans (anchored cutoff, latest cutoff] before any
  // signature. The continuation evidence intentionally sits outside the
  // immutable transaction lock because the latest checkpoint advances even
  // when the transaction bytes and anchored on-chain audit hash do not.
  if (args.stage === 'finalize') {
    const trustedEventNames = new Set([
      'ExpansionPackAdmittedV8',
      'ExpansionPackEntitlementGrantedV8',
    ]);
    if (!rebuilt.zeroHistoryContinuityEvidence?.continuityVerified
      || rebuilt.zeroHistoryContinuityEvidence?.scans?.some(
        (scan) => !scan.paginationCompleted
          || (trustedEventNames.has(scan.eventName)
            && scan.matchingTargetRootCount !== 0),
      )
      || rebuilt.zeroHistoryContinuityEvidence?.targetPassCount !== 0
      || rebuilt.zeroHistoryContinuityEvidence?.trustedHistoryClear !== true) {
      fail('The final pre-sign zero-v8-history continuation proof is incomplete.');
    }
  }
  const bytes = Buffer.from(locked.lock.transaction.bytesBase64, 'base64');
  if (sha256(bytes) !== locked.lock.transaction.bytesSha256
    || TransactionDataBuilder.getDigestFromBytes(bytes) !== locked.lock.transaction.digest) {
    fail('The locked stage transaction bytes are corrupt.');
  }
  await signerEntry(intent);
  const { stdout } = await execFileAsync('sui', [
    'keytool', 'sign', '--address', intent.signer.alias,
    '--data', locked.lock.transaction.bytesBase64, '--json',
  ], { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
  const signed = JSON.parse(stdout);
  if (exactId(signed.suiAddress, 'Signed address') !== exactId(intent.signer.address, 'Signer')
    || text(signed.rawTxData) !== locked.lock.transaction.bytesBase64
    || stableJson(signed.intent) !== stableJson({ scope: 0, version: 0, app_id: 0 })) {
    fail('The keytool signature envelope does not match the exact stage transaction.');
  }
  const signature = text(signed.suiSignature);
  if (!signature) fail('Sui keytool did not return a serialized signature.');
  await verifyTransactionSignature(bytes, signature, { address: intent.signer.address });
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: locked.lock.network.grpcUrl });
  const submitted = await client.core.executeTransaction({
    transaction: bytes,
    signatures: [signature],
    include: { effects: true, events: true, objectTypes: true, balanceChanges: true },
  });
  const finalized = await client.core.waitForTransaction({
    result: submitted,
    timeout: 60_000,
    include: { effects: true, events: true, objectTypes: true, balanceChanges: true },
  });
  const envelope = simulationEnvelope(finalized, `Parent ${args.stage} execution`);
  const digest = text(finalized?.Transaction?.digest || finalized?.digest || envelope.digest);
  if (digest !== locked.lock.transaction.digest) fail('Finalized digest differs from the signed stage lock.');
  if (args.stage === 'finalize') {
    const post = await readFinalizedState({
      client,
      intent,
      migration,
      readiness,
      finalizedEnvelope: envelope,
    });
    const result = {
      schemaVersion: 'animacraft.expansion-pack-v8-parent-stage-result.v1',
      executedAt: new Date().toISOString(),
      stage: args.stage,
      lockFingerprintSha256: locked.lockFingerprintSha256,
      transactionDigest: digest,
      finalized: stableValue(envelope),
      postState: post,
      zeroHistoryContinuityEvidence: rebuilt.zeroHistoryContinuityEvidence,
      signatureRecorded: false,
      signatureVerifiedLocally: true,
    };
    await writeJson(args.result, result);
    return result;
  }
  const state = await currentState({ client, intent, migration });
  const plan = readiness.lock.parent.commercePlan;
  const post = {
    root: stableValue(state.root),
    controlCap: stableValue(state.controlCap),
    makerTreasury: stableValue(state.makerTreasury),
    protocol: stableValue(state.protocol),
    packs: stableValue(state.packs),
    styles: stableValue(state.styles),
    objectFingerprints: state.objects.fingerprints,
  };
  if (state.root.lifecycle !== 1) fail(`Parent ${args.stage} execution did not preserve PAUSED lifecycle.`);
  if (args.stage === 'policy') {
    if (state.root.baseAccess.kind !== 0
      || state.root.baseAccess.purchasePriceAtomic !== 0n
      || state.root.basePolicy.mode !== 0
      || state.root.makerResaleRoyaltyBps !== intent.parent.makerResaleRoyaltyBps) {
      fail('Policy execution readback does not match the reviewed FREE Base policy.');
    }
  } else if (args.stage === 'evidence') {
    if (state.styles.length !== 0 || state.root.styleCount !== 0n
      || state.root.styleRegistrySealed) {
      fail('Evidence readback must preserve the empty unsealed PAUSED parent before atomic finalization.');
    }
  }
  const result = {
    schemaVersion: 'animacraft.expansion-pack-v8-parent-stage-result.v1',
    executedAt: new Date().toISOString(),
    stage: args.stage,
    lockFingerprintSha256: locked.lockFingerprintSha256,
    transactionDigest: digest,
    finalized: stableValue(envelope),
    postState: post,
    signatureRecorded: false,
    signatureVerifiedLocally: true,
  };
  await writeJson(args.result, result);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [intent, readiness, migration] = await Promise.all([
    readFile(INTENT_URL, 'utf8').then(JSON.parse),
    readFile(resolve(REPO_ROOT, args.readiness), 'utf8').then(JSON.parse),
    readFile(resolve(REPO_ROOT, args.migration), 'utf8').then(JSON.parse),
  ]);
  if (intent.writeBoundary.signingAllowed !== false
    || intent.writeBoundary.broadcastAllowed !== false
    || readiness.lock.writeBoundary.signingAllowed !== false
    || readiness.lock.writeBoundary.broadcastAllowed !== false) {
    fail('The durable readiness boundary no longer forbids implicit signing.');
  }
  if (args.mode === 'lock') {
    const locked = await buildLock(args, intent, readiness, migration);
    await writeJson(args.output, locked);
    process.stdout.write(`${stableJson({
      ready: true,
      stage: args.stage,
      lockFingerprintSha256: locked.lockFingerprintSha256,
      transactionDigest: locked.lock.transaction.digest,
      transactionBytesSha256: locked.lock.transaction.bytesSha256,
      transactionByteLength: locked.lock.transaction.byteLength,
      gasBudgetMist: locked.lock.transaction.gasBudgetMist,
      gasUsed: locked.lock.simulationLock.gasUsed,
      preState: {
        lifecycle: locked.lock.preState.root.lifecycle,
        styleCount: locked.lock.preState.root.styleCount,
        sealed: locked.lock.preState.root.styleRegistrySealed,
      },
      signingPerformed: false,
      broadcastPerformed: false,
    }, 2)}\n`);
    return;
  }
  const result = await executeLock(args, intent, readiness, migration);
  process.stdout.write(`${stableJson({
    executed: true,
    stage: result.stage,
    transactionDigest: result.transactionDigest,
    lockFingerprintSha256: result.lockFingerprintSha256,
    postState: {
      lifecycle: result.postState.root.lifecycle,
      styleCount: result.postState.root.styleCount,
      sealed: result.postState.root.styleRegistrySealed,
    },
    signatureRecorded: false,
  }, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  process.stderr.write(`${stableJson({
    ready: false,
    error: error.message,
    ...(error.expected ? { expected: error.expected } : {}),
    ...(error.actual ? { actual: error.actual } : {}),
  }, 2)}\n`);
  process.exitCode = 1;
});
