#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { WalrusFile, walrus } from '@mysten/walrus';

import {
  parseCommerceProtocolConfigV5,
  parseCommerceProtocolTreasuryV5,
  parseMakerControlCapV5,
  parseMakerRootV5,
  parseMakerTreasuryV5,
  queryStyleBindingsV5,
} from '../chain-commerce-v5.js';
import { buildMakerCommerceV5DeploymentPlan } from '../maker-commerce-chain-v5.js';
import {
  addExpansionPackStyle,
  createExpansionPackProject,
  preflightExpansionPackProject,
} from '../expansion-pack-project.js';
import {
  EXPANSION_PACK_MANIFEST_IDENTIFIER,
  buildExpansionPackPublicationCandidate,
  canonicalExpansionPackJson,
} from '../expansion-pack-publication.js';
import { normalizeRuntimeConfig } from '../runtime-config.js';

const execFileAsync = promisify(execFile);
const INTENT_URL = new URL(
  '../deployments/expansion-pack-v8-free-wallet-test.intent.json',
  import.meta.url,
);
const DEPLOYMENT_URL = new URL('../deployments/mainnet.json', import.meta.url);
const PUBLIC_CONFIG_URL = new URL('../public/config.js', import.meta.url);
const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const SUI_TYPE = normalizeStructTag('0x2::sui::SUI');

const CORRECTIVE_V7 = Object.freeze({
  sourceCommit: '3c2ffeeb86be6df2cd1f278454a72f5d02c796ea',
  sourceTree: '0872c4142ee5e811594efbadba032b7b21e5b57c',
  transactionDigest: 'GFJYxZ6hc83ma5itvJ5CN2ZAtTAqjizrgi9o2jKuTwZt',
  callablePackageId: normalizeSuiAddress(
    '0x1a797e32f594c53abab3e5bc0df9368c60deb4564e7947bea42db00d32dbe9ee',
  ),
  stableV8TypeOriginPackageId: normalizeSuiAddress(
    '0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a',
  ),
  packageVersion: '7',
});
const CORRECTIVE_V7_ABI_FUNCTIONS = Object.freeze([
  ['commerce_v5', 'finalize_independent_extension_root_v5', 12, 0],
  ['expansion_pack_v8', 'admit_expansion_pack_with_authority_v8', 5, 0],
  ['expansion_pack_v8', 'complete_bridge_enabled_v8', 0, 1],
  ['expansion_pack_v8', 'physical_bridge_enabled_v8', 0, 1],
  ['expansion_pack_v8', 'assert_complete_bridge_enabled_v8', 0, 0],
  ['expansion_pack_v8', 'assert_physical_bridge_enabled_v8', 0, 0],
  ['expansion_pack_complete_v8', 'companion_proof_available_v8', 0, 1],
  ['expansion_pack_complete_v8', 'begin_expansion_pack_complete_authorization_v8', 3, 1],
]);
const CORRECTIVE_V7_NEW_ORIGIN_DATATYPES = Object.freeze([
  ['commerce_v5', 'IndependentExtensionLockStateV5'],
  ['commerce_v5', 'IndependentExtensionAuthorityV5'],
  ['commerce_v5', 'IndependentExtensionRootFinalizedV5'],
  ['commerce_v5', 'LegacyLogicalCompatibilityStateV5'],
  ['commerce_v5', 'LegacyLogicalStyleApprovalKeyV5'],
  ['commerce_v5', 'LegacyLogicalStyleApprovalV5'],
  ['commerce_v5', 'LegacyLogicalStyleRegisteredV5'],
]);
const CORRECTIVE_V7_STABLE_ORIGIN_DATATYPES = Object.freeze([
  ['expansion_pack_v8', 'ExpansionPackReleaseV8'],
  ['expansion_pack_v8', 'ExpansionPackPassV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteAuthorizationV8'],
  ['commerce_v5', 'MakerReleaseEvidenceV5'],
]);
const ALLOWED_UNTRACKED_READINESS_PATHS = Object.freeze(new Set([
  'scripts/expansion-pack-v8-parent-migration.mjs',
]));

function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  throw error;
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

const ZERO_V8_HISTORY_DOMAIN = 'animacraft.independent-extension-zero-v8-history.v1';
const ZERO_V8_HISTORY_EVENT_NAMES = Object.freeze([
  'ExpansionPackAdmittedV8',
  'ExpansionPackEntitlementGrantedV8',
]);
const ZERO_V8_HISTORY_QUERY = `
  query ExpansionPackV8ZeroHistory(
    $type: String!
    $afterCheckpoint: UInt53
    $beforeCheckpoint: UInt53
    $first: Int!
    $after: String
  ) {
    events(
      filter: {
        type: $type
        afterCheckpoint: $afterCheckpoint
        beforeCheckpoint: $beforeCheckpoint
      }
      first: $first
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sequenceNumber
        timestamp
        transaction {
          digest
          effects { checkpoint { sequenceNumber digest timestamp } }
        }
        contents { type { repr } json bcs }
      }
    }
  }
`;
const ZERO_V8_HISTORY_CUTOFF_QUERY = `
  query ExpansionPackV8ZeroHistoryCutoff {
    chainIdentifier
    checkpoint { sequenceNumber digest timestamp }
  }
`;
const ZERO_V8_HISTORY_ANCHOR_QUERY = `
  query ExpansionPackV8ZeroHistoryAnchor($sequenceNumber: UInt53!) {
    chainIdentifier
    checkpoint(sequenceNumber: $sequenceNumber) { sequenceNumber digest timestamp }
  }
`;
const ZERO_V8_HISTORY_OBJECT_QUERY = `
  query ExpansionPackV8ZeroHistoryObjects($type: String!, $first: Int!, $after: String) {
    objects(filter: { type: $type }, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        version
        digest
        asMoveObject { contents { type { repr } json bcs } }
        previousTransaction {
          digest
          effects { checkpoint { sequenceNumber digest timestamp } }
        }
      }
    }
  }
`;

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

function exactNonzeroId(value, label) {
  const id = exactId(value, label);
  if (id === normalizeSuiAddress('0x0')) {
    fail(`${label} must be populated with a nonzero Sui ID.`);
  }
  return id;
}

function parseArgs(argv) {
  const result = { json: false, output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') result.json = true;
    else if (argument === '--output') {
      result.output = text(argv[index + 1]);
      index += 1;
      if (!result.output) fail('--output requires a path.');
    } else fail(`Unsupported argument: ${argument}`);
  }
  return result;
}

async function loadPublicConfig() {
  const source = await readFile(PUBLIC_CONFIG_URL, 'utf8');
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename: 'public/config.js' }).runInContext(context, {
    timeout: 1_000,
  });
  return normalizeRuntimeConfig(context.window.ANIMACRAFT_CONFIG || {});
}

async function gitValue(...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: REPO_ROOT });
  return text(stdout);
}

function sameText(actual, expected, label) {
  if (text(actual) !== text(expected)) {
    fail(`${label} drifted from the reviewed corrective v7 evidence.`, {
      expected: text(expected),
      actual: text(actual),
    });
  }
}

function sameId(actual, expected, label) {
  const normalizedActual = exactNonzeroId(actual, label);
  const normalizedExpected = exactNonzeroId(expected, `${label} expectation`);
  if (normalizedActual !== normalizedExpected) {
    fail(`${label} drifted from the reviewed corrective v7 evidence.`, {
      expected: normalizedExpected,
      actual: normalizedActual,
    });
  }
}

function requireSha256(value, label) {
  const normalized = text(value).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) fail(`${label} must be an exact SHA-256.`);
  return normalized;
}

function statusEntry(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
  return { line, status, path };
}

export function validateReadinessWorktree(sourceStatus = '') {
  const entries = text(sourceStatus) ? text(sourceStatus).split('\n').map(statusEntry) : [];
  const trackedDirty = entries.filter(({ status }) => status !== '??');
  const disallowedUntracked = entries.filter(
    ({ status, path }) => status === '??' && !ALLOWED_UNTRACKED_READINESS_PATHS.has(path),
  );
  if (trackedDirty.length || disallowedUntracked.length) {
    fail('The readiness worktree contains unreviewed changes.', {
      trackedDirty: trackedDirty.map(({ line }) => line),
      disallowedUntracked: disallowedUntracked.map(({ line }) => line),
      allowedUntracked: [...ALLOWED_UNTRACKED_READINESS_PATHS],
    });
  }
  return Object.freeze({
    cleanForReadiness: true,
    allowedUntracked: entries.filter(({ status }) => status === '??').map(({ path }) => path),
  });
}

export function validateCorrectiveV7Evidence({
  intent,
  deployment,
  resultBytes,
  abiBytes,
} = {}) {
  const expected = intent?.protocol?.correctiveUpgradeEvidence;
  if (!expected || typeof expected !== 'object') {
    fail('The intent is missing corrective v7 upgrade evidence expectations.');
  }
  const resultSha256 = sha256(resultBytes);
  const abiSha256 = sha256(abiBytes);
  sameText(resultSha256, requireSha256(expected.resultSha256, 'Corrective result SHA-256'),
    'Corrective result SHA-256');
  sameText(abiSha256, requireSha256(expected.abiSha256, 'Corrective ABI SHA-256'),
    'Corrective ABI SHA-256');

  let result;
  let abi;
  try {
    result = JSON.parse(resultBytes);
    abi = JSON.parse(abiBytes);
  } catch (error) {
    fail('The corrective v7 evidence is not valid JSON.', { cause: error.message });
  }
  for (const [field, reviewed] of Object.entries(CORRECTIVE_V7)) {
    sameText(expected[field], reviewed, `Intent corrective evidence ${field}`);
  }
  sameId(intent?.protocol?.callablePackageId, expected.callablePackageId,
    'Intent v8 callable package');
  sameId(intent?.protocol?.commerceV5CallablePackageId, expected.callablePackageId,
    'Intent Commerce callable package');
  sameId(intent?.protocol?.typeOriginPackageId, expected.stableV8TypeOriginPackageId,
    'Intent stable v8 TypeOrigin');
  sameId(intent?.protocol?.independentExtensionV5TypeOriginPackageId,
    expected.independentExtensionV5TypeOriginPackageId,
    'Intent independent-extension TypeOrigin');
  sameId(intent?.protocol?.legacyLogicalV5TypeOriginPackageId,
    expected.legacyLogicalV5TypeOriginPackageId,
    'Intent legacy-logical TypeOrigin');
  sameText(expected.independentExtensionV5TypeOriginPackageId,
    CORRECTIVE_V7.callablePackageId, 'Intent independent-extension TypeOrigin');
  sameText(expected.legacyLogicalV5TypeOriginPackageId,
    CORRECTIVE_V7.callablePackageId, 'Intent legacy-logical TypeOrigin');

  const release = deployment?.releases?.expansionPackV8 || {};
  const verification = deployment?.verification || {};
  const deploymentChecks = [
    [deployment?.source?.sourceCommit, expected.sourceCommit, 'Deployment source commit'],
    [deployment?.source?.sourceTree, expected.sourceTree, 'Deployment source tree'],
    [release.sourceCommit, expected.sourceCommit, 'Deployment release source commit'],
    [release.sourceTree, expected.sourceTree, 'Deployment release source tree'],
    [deployment?.upgradeTxDigest, expected.transactionDigest, 'Deployment upgrade transaction'],
    [release.upgradeTxDigest, expected.transactionDigest, 'Deployment release transaction'],
    [release.packageVersion, expected.packageVersion, 'Deployment release package version'],
    [release.packageObjectVersion, expected.packageVersion, 'Deployment package object version'],
    [verification.expansionPackV8UpgradeTransactionStatus, 'success', 'Deployment upgrade status'],
    [verification.expansionPackV8SourceStatus, 'success', 'Deployment source status'],
    [verification.expansionPackV8PackageReadBack, true, 'Deployment package readback'],
  ];
  for (const [actual, reviewed, label] of deploymentChecks) sameText(actual, reviewed, label);
  const deploymentIds = [
    [deployment?.expansionPackV8CallablePackageId, expected.callablePackageId,
      'Deployment v8 callable package'],
    [deployment?.commerceV5CallablePackageId, expected.callablePackageId,
      'Deployment Commerce callable package'],
    [release.callablePackageId, expected.callablePackageId, 'Deployment release callable package'],
    [deployment?.expansionPackV8TypeOriginPackageId, expected.stableV8TypeOriginPackageId,
      'Deployment stable v8 TypeOrigin'],
    [release.typeOriginPackageId, expected.stableV8TypeOriginPackageId,
      'Deployment release stable v8 TypeOrigin'],
    [deployment?.independentExtensionV5TypeOriginPackageId,
      expected.independentExtensionV5TypeOriginPackageId,
      'Deployment independent-extension TypeOrigin'],
    [release.independentExtensionV5TypeOriginPackageId,
      expected.independentExtensionV5TypeOriginPackageId,
      'Deployment release independent-extension TypeOrigin'],
    [deployment?.legacyLogicalV5TypeOriginPackageId,
      expected.legacyLogicalV5TypeOriginPackageId,
      'Deployment legacy-logical TypeOrigin'],
    [release.legacyLogicalV5TypeOriginPackageId,
      expected.legacyLogicalV5TypeOriginPackageId,
      'Deployment release legacy-logical TypeOrigin'],
  ];
  for (const [actual, reviewed, label] of deploymentIds) sameId(actual, reviewed, label);

  sameText(result?.source?.commit, expected.sourceCommit, 'Corrective result source commit');
  sameText(result?.source?.tree, expected.sourceTree, 'Corrective result source tree');
  sameText(result?.transactionDigest, expected.transactionDigest,
    'Corrective result transaction digest');
  sameText(result?.status?.success, true, 'Corrective result transaction status');
  sameId(result?.expectedNewPackageId, expected.callablePackageId,
    'Corrective result expected package');
  sameId(result?.packageObject?.objectId, expected.callablePackageId,
    'Corrective result package object');
  sameText(result?.packageObject?.version, expected.packageVersion,
    'Corrective result package version');
  sameId(result?.upgradeCapPost?.package, expected.callablePackageId,
    'Corrective result UpgradeCap package');
  sameText(result?.upgradeCapPost?.packageVersion, expected.packageVersion,
    'Corrective result UpgradeCap package version');
  if (!Array.isArray(result?.events) || result.events.length !== 0) {
    fail('The corrective result must contain zero Move events.');
  }

  sameId(abi?.packageId, expected.callablePackageId, 'Corrective ABI package');
  for (const [moduleName, name, parameterCount, returnCount] of CORRECTIVE_V7_ABI_FUNCTIONS) {
    const found = abi?.functions?.find(
      (entry) => entry?.module === moduleName && entry?.name === name,
    );
    if (!found
      || found.visibility !== 'public'
      || found.isEntry !== false
      || Number(found.parameterCount) !== parameterCount
      || Number(found.returnCount) !== returnCount) {
      fail(`Corrective ABI readback drifted for ${moduleName}::${name}.`, {
        expected: { visibility: 'public', isEntry: false, parameterCount, returnCount },
        actual: stableValue(found),
      });
    }
  }
  const requireDatatypeOrigin = (moduleName, name, origin) => {
    const found = abi?.datatypes?.find(
      (entry) => entry?.module === moduleName && entry?.name === name,
    );
    if (!found || found.matches !== true) {
      fail(`Corrective ABI readback drifted for ${moduleName}::${name}.`, {
        actual: stableValue(found),
      });
    }
    sameId(found.definingId, origin, `Corrective ABI ${moduleName}::${name} origin`);
    sameId(found.expected, origin, `Corrective ABI ${moduleName}::${name} expectation`);
  };
  for (const [moduleName, name] of CORRECTIVE_V7_NEW_ORIGIN_DATATYPES) {
    requireDatatypeOrigin(moduleName, name, expected.independentExtensionV5TypeOriginPackageId);
  }
  for (const [moduleName, name] of CORRECTIVE_V7_STABLE_ORIGIN_DATATYPES) {
    requireDatatypeOrigin(moduleName, name, expected.stableV8TypeOriginPackageId);
  }
  return Object.freeze({
    deployedSourceCommit: expected.sourceCommit,
    deployedSourceTree: expected.sourceTree,
    transactionDigest: expected.transactionDigest,
    callablePackageId: exactId(expected.callablePackageId, 'Corrective callable package'),
    stableV8TypeOriginPackageId: exactId(
      expected.stableV8TypeOriginPackageId,
      'Corrective stable v8 TypeOrigin',
    ),
    independentExtensionV5TypeOriginPackageId: exactId(
      expected.independentExtensionV5TypeOriginPackageId,
      'Corrective independent-extension TypeOrigin',
    ),
    legacyLogicalV5TypeOriginPackageId: exactId(
      expected.legacyLogicalV5TypeOriginPackageId,
      'Corrective legacy-logical TypeOrigin',
    ),
    resultPath: text(expected.resultPath),
    resultSha256,
    abiReadbackPath: text(expected.abiReadbackPath),
    abiSha256,
  });
}

async function correctiveV7Evidence(intent, deployment) {
  const expected = intent?.protocol?.correctiveUpgradeEvidence || {};
  if (!text(expected.resultPath) || !text(expected.abiReadbackPath)) {
    fail('The intent must name both corrective v7 durable evidence files.');
  }
  const [resultBytes, abiBytes] = await Promise.all([
    readFile(resolve(REPO_ROOT, expected.resultPath)),
    readFile(resolve(REPO_ROOT, expected.abiReadbackPath)),
  ]);
  return validateCorrectiveV7Evidence({ intent, deployment, resultBytes, abiBytes });
}

function ownerSummary(owner) {
  if (!owner || typeof owner !== 'object') return stableValue(owner);
  if (owner.$kind && owner[owner.$kind] !== undefined) {
    return { kind: owner.$kind, value: stableValue(owner[owner.$kind]) };
  }
  return stableValue(owner);
}

function addressOwner(owner) {
  const summary = ownerSummary(owner);
  if (!summary || typeof summary !== 'object') return '';
  if (summary.kind === 'AddressOwner') return text(summary.value);
  return text(summary.AddressOwner || summary.addressOwner);
}

function isSharedOwner(owner) {
  const summary = ownerSummary(owner);
  return summary?.kind === 'Shared' || Boolean(summary?.Shared || summary?.shared);
}

function objectJson(object) {
  return object?.json || object?.data?.json || object?.content?.fields || {};
}

function jsonField(value, ...names) {
  const fields = value?.fields && typeof value.fields === 'object' ? value.fields : value;
  for (const name of names) {
    if (fields?.[name] !== undefined) return fields[name];
  }
  return undefined;
}

function jsonId(value) {
  if (typeof value === 'string' && /^0x[0-9a-f]{1,64}$/i.test(value.trim())) {
    return exactId(value, 'Object linkage ID');
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = jsonId(entry);
      if (found) return found;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  for (const key of ['bytes', 'objectId', 'object_id', 'id', 'address', 'some', 'vec', 'fields']) {
    const found = jsonId(value[key]);
    if (found) return found;
  }
  return '';
}

function exactObjectType(object, expected, label) {
  const actual = normalizeStructTag(text(object?.type || object?.data?.type));
  const normalizedExpected = normalizeStructTag(expected);
  if (actual !== normalizedExpected) {
    fail(`${label} has the wrong exact Move type.`, { expected: normalizedExpected, actual });
  }
}

function objectFingerprint(object) {
  if (!object || object instanceof Error || object.$kind === 'Error' || object.error) {
    fail('One of the required Mainnet objects is unavailable.', {
      object: stableValue(object),
    });
  }
  const json = object.json || object.data?.json || object.content?.fields || {};
  const objectId = exactId(
    object.objectId || object.id || object.data?.objectId,
    'Mainnet object ID',
  );
  return {
    objectId,
    version: text(object.version || object.data?.version),
    digest: text(object.digest || object.data?.digest),
    type: normalizeStructTag(text(object.type || object.data?.type)),
    owner: ownerSummary(object.owner || object.data?.owner),
    previousTransaction: text(
      object.previousTransaction
      || object.previousTransactionDigest
      || object.data?.previousTransaction,
    ),
    jsonSha256: sha256(stableJson(json)),
  };
}

function simulationEnvelope(result, label) {
  const kind = text(result?.$kind) || (result?.FailedTransaction ? 'FailedTransaction' : 'Transaction');
  const failure = kind === 'FailedTransaction' || Boolean(result?.FailedTransaction);
  if (failure) {
    fail(`${label} failed.`, {
      simulation: stableValue(result),
    });
  }
  const value = result?.Transaction || result;
  const effects = value?.effects || result?.effects || {};
  const events = value?.events || result?.events || [];
  const objectTypes = value?.objectTypes || result?.objectTypes || {};
  const commandResults = value?.commandResults || result?.commandResults || [];
  return {
    kind,
    digest: text(value?.digest || result?.digest),
    effects: stableValue(effects),
    events: stableValue(events),
    objectTypes: stableValue(objectTypes),
    commandResults: stableValue(commandResults),
  };
}

function parentStyleProduct(item) {
  const projectionKind = text(item?.projectionKind);
  if (projectionKind === 'style') {
    return {
      partKey: text(item.partKey),
      itemKey: text(item.itemKey),
      styleKey: text(item.sourceStyleId),
      packId: null,
      rowKind: 'VISUAL',
    };
  }
  if (projectionKind === 'none') {
    return {
      partKey: text(item.partKey),
      itemKey: text(item.itemKey),
      styleKey: '__animacraft_none__',
      packId: null,
      rowKind: 'LOGICAL_NONE',
    };
  }
  if (projectionKind === 'color-swatch') {
    return {
      partKey: text(item.partKey),
      itemKey: text(item.itemKey),
      styleKey: `__animacraft_color__:${text(item.sourceSwatchId)}`,
      packId: null,
      rowKind: 'LOGICAL_COLOR',
    };
  }
  return fail(`Unsupported parent projection kind: ${projectionKind || '(empty)'}.`, {
    item: stableValue(item),
  });
}

function commerceProjection(parentManifest, intent) {
  const items = parentManifest?.moveProjectionV2?.items;
  if (!Array.isArray(items) || items.length !== intent.parent.expectedStyleCount) {
    fail('The parent Move projection no longer has the reviewed Style count.', {
      expected: intent.parent.expectedStyleCount,
      actual: Array.isArray(items) ? items.length : null,
    });
  }
  const styleProducts = items.map(parentStyleProduct);
  const counts = {
    visual: styleProducts.filter((row) => row.rowKind === 'VISUAL').length,
    logicalNone: styleProducts.filter((row) => row.rowKind === 'LOGICAL_NONE').length,
    logicalColor: styleProducts.filter((row) => row.rowKind === 'LOGICAL_COLOR').length,
  };
  const expected = intent.parent.expectedStyleCounts;
  if (counts.visual !== expected.visual
    || counts.logicalNone !== expected.logicalNone
    || counts.logicalColor !== expected.logicalColor
    || counts.logicalNone + counts.logicalColor !== expected.compatibilityLogical
    || styleProducts.length !== expected.total) {
    fail('The parent projection is not the reviewed 19 visual + 3 none + 4 color route set.', {
      expected: stableValue(expected),
      actual: { ...counts, total: styleProducts.length },
    });
  }
  return {
    ...structuredClone(parentManifest.moveProjectionV2),
    commerce: {
      rightsOrigin: intent.parent.rightsOrigin,
      rightsOriginConfirmed: true,
      logicalAuxiliaryBlobId: intent.protocol.logicalAuxiliaryBlobId,
      makerAccess: {
        mode: intent.parent.baseAccess.kind,
        purchasePriceAtomic: intent.parent.baseAccess.purchasePriceAtomic,
      },
      baseCompletion: structuredClone(intent.parent.baseCompletion),
      packPolicies: [],
      royalties: {
        soulCreatorBps: intent.parent.soulCreatorRoyaltyBps,
        makerResaleBps: intent.parent.makerResaleRoyaltyBps,
      },
      styleProducts,
      counts: { packs: 0, styles: styleProducts.length },
    },
  };
}

export function orderedIndependentExtensionStyleBindings(commercePlan) {
  const rows = commercePlan?.configuration?.styleBindings;
  if (!Array.isArray(rows)) fail('The Commerce plan has no Style route rows.');
  const grouped = new Map([[0, []], [1, []], [2, []]]);
  rows.forEach((row, index) => {
    const rowKind = Number(row?.rowKind);
    if (!grouped.has(rowKind)) fail(`Route row ${index + 1} has an unsupported kind.`);
    grouped.get(rowKind).push(row);
  });
  return [0, 1, 2].flatMap((rowKind) => grouped.get(rowKind));
}

export function buildParentRoutePlan(commercePlan, intent) {
  const rows = orderedIndependentExtensionStyleBindings(commercePlan);
  const routePlan = rows.map((row, index) => {
    const rowKind = Number(row.rowKind);
    const route = rowKind === 0 ? 'VISUAL' : 'LEGACY_LOGICAL_COMPATIBILITY';
    const logicalKind = rowKind === 1 ? 'NONE' : rowKind === 2 ? 'COLOR' : null;
    return {
      line: index + 1,
      partKey: text(row.partKey),
      itemKey: text(row.itemKey),
      styleKey: text(row.styleKey),
      packKey: text(row.packKey),
      rowKind,
      route,
      logicalKind,
      function: 'finalize_independent_extension_root_v5',
      command: 0,
      authority: {
        retiredMakerControlCapId: exactId(
          intent.parent.currentV5.controlCapId,
          'Current ControlCap',
        ),
        protocolFeeAdminCapId: exactId(
          intent.protocol.protocolFeeAdminCapId,
          'ProtocolFeeAdminCap',
        ),
      },
    };
  });
  const counts = {
    visual: routePlan.filter((row) => row.route === 'VISUAL').length,
    logicalNone: routePlan.filter((row) => row.logicalKind === 'NONE').length,
    logicalColor: routePlan.filter((row) => row.logicalKind === 'COLOR').length,
    compatibilityLogical: routePlan.filter(
      (row) => row.route === 'LEGACY_LOGICAL_COMPATIBILITY',
    ).length,
    total: routePlan.length,
  };
  if (stableJson(counts) !== stableJson(intent.parent.expectedStyleCounts)) {
    fail('The line-by-line route plan drifted from the reviewed 19 + 7 split.', {
      expected: stableValue(intent.parent.expectedStyleCounts),
      actual: counts,
    });
  }
  return {
    counts,
    rows: routePlan,
    rowsSha256: sha256(stableJson(routePlan)),
  };
}

function assertAddressOwner(object, expected, label) {
  const actual = exactId(addressOwner(object?.owner || object?.data?.owner), `${label} owner`);
  if (actual !== exactId(expected, `${label} expected owner`)) {
    fail(`${label} is not owned by the reviewed signer.`, { expected, actual });
  }
}

function assertShared(object, label) {
  if (!isSharedOwner(object?.owner || object?.data?.owner)) {
    fail(`${label} must be a shared object.`, { owner: ownerSummary(object?.owner || object?.data?.owner) });
  }
}

export function validateCurrentParentState({ objects, intent }) {
  const v4Package = exactId(intent.protocol.protocolFeePackageId, 'v4 ProtocolFee package');
  const v5Package = exactId(intent.protocol.commerceV5TypeOriginPackageId, 'Commerce v5 TypeOrigin');
  const payment = normalizeStructTag(intent.protocol.paymentCoinType);
  const ids = {
    v4Config: exactId(intent.protocol.protocolFeeConfigId, 'v4 ProtocolFeeConfig'),
    v4Admin: exactId(intent.protocol.protocolFeeAdminCapId, 'v4 ProtocolFeeAdminCap'),
    v5Config: exactId(intent.protocol.commerceProtocolConfigV5Id, 'v5 protocol config'),
    v5Treasury: exactId(intent.protocol.commerceProtocolTreasuryV5Id, 'v5 protocol treasury'),
    root: exactId(intent.parent.currentV5.rootId, 'current MakerRootV5'),
    treasury: exactId(intent.parent.currentV5.treasuryId, 'current MakerTreasuryV5'),
    vault: exactId(intent.parent.currentV5.controlVaultId, 'current MakerControlVaultV5'),
    cap: exactId(intent.parent.currentV5.controlCapId, 'current MakerControlCapV5'),
  };
  const get = (id, label) => {
    const object = objects.get(id);
    if (!object || object instanceof Error || object?.error || object?.$kind === 'Error') {
      fail(`${label} is unavailable from Sui.`, { id, object: stableValue(object) });
    }
    return object;
  };
  const current = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, get(id, key)]));
  exactObjectType(current.v4Config, `${v4Package}::animacraft::ProtocolFeeConfig`, 'v4 ProtocolFeeConfig');
  exactObjectType(current.v4Admin, `${v4Package}::animacraft::ProtocolFeeAdminCap`, 'v4 ProtocolFeeAdminCap');
  exactObjectType(current.v5Config, `${v5Package}::commerce_v5::CommerceProtocolConfigV5`, 'v5 config');
  exactObjectType(current.v5Treasury, `${v5Package}::commerce_v5::CommerceProtocolTreasuryV5<${payment}>`, 'v5 protocol treasury');
  exactObjectType(current.root, `${v5Package}::commerce_v5::MakerRootV5`, 'MakerRootV5');
  exactObjectType(current.treasury, `${v5Package}::commerce_v5::MakerTreasuryV5<${payment}>`, 'MakerTreasuryV5');
  exactObjectType(current.vault, `${v5Package}::commerce_v5::MakerControlVaultV5`, 'MakerControlVaultV5');
  exactObjectType(current.cap, `${v5Package}::commerce_v5::MakerControlCapV5`, 'MakerControlCapV5');
  for (const [key, object] of Object.entries(current)) {
    if (key === 'v4Admin' || key === 'cap') assertAddressOwner(object, intent.signer.address, key);
    else assertShared(object, key);
  }

  const v4ConfigJson = objectJson(current.v4Config);
  const v4AdminJson = objectJson(current.v4Admin);
  const v4ConfigId = exactId(ids.v4Config, 'v4 config');
  const v4TreasuryId = jsonId(jsonField(v4ConfigJson, 'treasury_id', 'treasuryId'));
  if (Number(jsonField(v4ConfigJson, 'version')) !== 4
    || Number(jsonField(v4AdminJson, 'version')) !== 4
    || jsonId(jsonField(v4AdminJson, 'config_id', 'configId')) !== v4ConfigId
    || !v4TreasuryId
    || jsonId(jsonField(v4AdminJson, 'treasury_id', 'treasuryId')) !== v4TreasuryId) {
    fail('The v4 ProtocolFeeConfig/AdminCap linkage drifted.');
  }

  const protocol = parseCommerceProtocolConfigV5(current.v5Config);
  const protocolTreasury = parseCommerceProtocolTreasuryV5(current.v5Treasury);
  const root = parseMakerRootV5(current.root);
  const makerTreasury = parseMakerTreasuryV5(current.treasury);
  const controlCap = parseMakerControlCapV5(current.cap);
  const vaultJson = objectJson(current.vault);
  if (protocol.legacyConfigId !== ids.v4Config
    || protocol.legacyAdminCapId !== ids.v4Admin
    || protocol.treasuryId !== ids.v5Treasury
    || protocolTreasury.configId !== ids.v5Config
    || root.protocolConfigId !== ids.v5Config
    || root.legacyMakerId !== exactId(intent.parent.legacyMakerId, 'legacy Maker')
    || root.legacyTreasuryId !== exactId(intent.parent.legacyTreasuryId, 'legacy treasury history')
    || root.controlVaultId !== ids.vault
    || root.treasuryId !== ids.treasury
    || root.currentControlCapId !== ids.cap
    || root.currentOwner !== exactId(intent.signer.address, 'signer')
    || root.ownershipEpoch !== controlCap.ownershipEpoch
    || makerTreasury.rootId !== ids.root
    || controlCap.rootId !== ids.root
    || jsonId(jsonField(vaultJson, 'root_id', 'rootId')) !== ids.root
    || jsonId(jsonField(vaultJson, 'legacy_maker_id', 'legacyMakerId'))
      !== exactId(intent.parent.legacyMakerId, 'legacy Maker')
    || root.lifecycle !== intent.parent.expectedLifecycleCode) {
    fail('The current migrated PAUSED parent authority tuple drifted.', {
      protocol: stableValue(protocol), root: stableValue(root), makerTreasury: stableValue(makerTreasury),
      controlCap: stableValue(controlCap), vault: stableValue(vaultJson),
    });
  }
  return { ids, current, protocol, protocolTreasury, root, makerTreasury, controlCap };
}

async function buildPackCandidate(parentManifest, intent, assetBytes) {
  const pack = intent.pack;
  let project = createExpansionPackProject(parentManifest, {
    packId: pack.id,
    namespace: pack.namespace,
    name: pack.name,
    version: pack.version,
    walletAddress: intent.signer.address,
    projectId: pack.id,
    parentRelease: {
      identityVerified: true,
      rootMakerId: intent.parent.rootMakerId,
      releaseId: intent.parent.legacyMakerId,
      versionId: intent.parent.versionId,
      versionNumber: intent.parent.versionNumber,
      manifestBlobId: intent.parent.manifestQuiltId,
      manifestHash: intent.parent.manifestSha256,
    },
    now: 0,
  });
  project = addExpansionPackStyle(project, {
    partId: pack.target.partId,
    itemId: pack.target.itemId,
    assets: [{
      id: pack.asset.id,
      identifier: pack.asset.identifier,
      kind: 'layer',
      mediaType: pack.asset.mediaType,
      sha256: pack.asset.sha256,
      byteLength: pack.asset.byteLength,
      width: pack.asset.width,
      height: pack.asset.height,
      blob: new Blob([assetBytes], { type: pack.asset.mediaType }),
    }],
    style: {
      id: pack.target.styleId,
      name: 'Quiet Orbit',
      assetId: pack.asset.id,
      layerTrackId: pack.target.layerTrackId,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      opacity: 1,
      blendMode: 'normal',
    },
  }, { now: 0 });
  const preflight = preflightExpansionPackProject(project);
  if (!preflight.valid || !preflight.publishable) {
    fail('The reviewed FREE Expansion Pack project failed deterministic preflight.', {
      preflight: stableValue(preflight),
    });
  }
  const candidate = await buildExpansionPackPublicationCandidate(project, {
    commerce: { accessMode: 'FREE', purchasePriceAtomic: '0' },
    rights: {
      origin: 'INHERIT_PARENT',
      declaration: 'One FREE additive Style; parent personal-use terms remain authoritative.',
    },
  });
  if (candidate.manifestIdentifier !== EXPANSION_PACK_MANIFEST_IDENTIFIER
    || candidate.files.length !== intent.walrus.expectedFileCount
    || candidate.manifest?.commerce?.accessMode !== 'FREE'
    || candidate.manifest?.transportProtection
    || candidate.transportProtected === true) {
    fail('The generated FREE candidate crossed its reviewed publication boundary.', {
      candidate: stableValue(candidate),
    });
  }
  return { project, preflight, candidate };
}

async function listBalances(client, owner) {
  const balances = [];
  let cursor = null;
  do {
    const page = await client.core.listBalances({ owner, cursor, limit: 200 });
    balances.push(...(page.balances || []));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && balances.length < 1_000);
  return balances;
}

function balanceSummary(balances) {
  return balances.map((entry) => ({
    coinType: normalizeStructTag(entry.coinType),
    balance: text(entry.balance),
  })).sort((left, right) => left.coinType.localeCompare(right.coinType));
}

function findBalance(balances, predicate) {
  const found = balances.find((balance) => predicate(normalizeStructTag(balance.coinType)));
  return text(found?.balance || '0');
}

async function walCoinType(client, blobType) {
  const stakingPackageId = normalizeStructTag(blobType).split('::')[0];
  const response = await client.core.getMoveFunction({
    packageId: stakingPackageId,
    moduleName: 'staking',
    name: 'stake_with_pool',
  });
  const toStake = response.function?.parameters?.[1];
  const toStakeCoin = toStake?.body?.$kind === 'datatype'
    ? toStake.body.datatype
    : null;
  const typeParameter = toStakeCoin?.typeParameters?.[0]?.$kind === 'datatype'
    ? toStakeCoin.typeParameters[0]
    : null;
  if (typeParameter?.$kind !== 'datatype') {
    fail('Could not discover the exact Mainnet WAL coin type.');
  }
  return normalizeStructTag(typeParameter.datatype.typeName);
}

async function walrusReadiness({ client, runtime, intent, candidate, assetBytes, balances }) {
  const entries = [
    {
      identifier: candidate.manifestIdentifier,
      kind: 'manifest',
      mediaType: 'application/json',
      bytes: new TextEncoder().encode(candidate.manifestJson),
    },
    {
      identifier: intent.pack.asset.identifier,
      kind: 'layer',
      mediaType: intent.pack.asset.mediaType,
      bytes: new Uint8Array(assetBytes),
    },
  ];
  for (const entry of entries) {
    const descriptor = candidate.files.find((file) => file.identifier === entry.identifier);
    if (!descriptor || sha256(entry.bytes) !== descriptor.sha256) {
      fail(`The exact bytes for ${entry.identifier} do not match the candidate descriptor.`);
    }
  }
  const files = entries.map((entry) => WalrusFile.from({
    contents: entry.bytes,
    identifier: entry.identifier,
    tags: {
      'content-type': entry.mediaType,
      'animacraft-kind': entry.kind,
    },
  }));
  const relayCap = Number(intent.walrus.relayTipCapMist);
  const quotedClient = client.$extend(walrus({
    uploadRelay: {
      host: runtime.walrusUploadRelayUrl,
      sendTip: { max: relayCap },
    },
  }));
  const flow = quotedClient.walrus.writeFilesFlow({ files });
  const encoded = await flow.encode();
  const [relayTip, costs, blobType] = await Promise.all([
    quotedClient.walrus.calculateUploadRelayTip({ size: encoded.unencodedSize }),
    quotedClient.walrus.storageCost(encoded.unencodedSize, intent.walrus.epochs),
    quotedClient.walrus.getBlobType(),
  ]);
  if (BigInt(relayTip) > BigInt(intent.walrus.relayTipCapMist)) {
    fail('The exact Walrus relay quote exceeds the reviewed client cap.', {
      relayTip: text(relayTip),
      cap: intent.walrus.relayTipCapMist,
    });
  }
  const exactWalCoinType = await walCoinType(client, blobType);
  const walBalance = findBalance(
    balances,
    (coinType) => coinType === exactWalCoinType,
  );
  const suiBalance = findBalance(balances, (coinType) => coinType === SUI_TYPE);
  if (BigInt(walBalance) < BigInt(costs.totalCost)) {
    fail('The reviewed signer does not have enough WAL for this exact Quilt quote.', {
      walBalance,
      required: text(costs.totalCost),
    });
  }
  if (BigInt(suiBalance) < BigInt(relayTip)) {
    fail('The reviewed signer does not have enough SUI for the relay tip before gas.', {
      suiBalance,
      required: text(relayTip),
    });
  }

  // Rebuild from the exact checkpoint with the live quote as the hard maximum.
  // register() only constructs a transaction; simulateTransaction below never
  // signs, broadcasts, uploads bytes, or creates a Walrus object.
  const exactClient = client.$extend(walrus({
    uploadRelay: {
      host: runtime.walrusUploadRelayUrl,
      sendTip: { max: Number(relayTip) },
    },
  }));
  const exactFlow = exactClient.walrus.writeFilesFlow({ files, resume: encoded });
  const exactEncoded = await exactFlow.encode();
  if (exactEncoded.blobId !== encoded.blobId
    || exactEncoded.rootHash !== encoded.rootHash
    || exactEncoded.nonce !== encoded.nonce) {
    fail('The Walrus checkpoint changed while pinning the exact relay quote.', {
      encoded: stableValue(encoded),
      exactEncoded: stableValue(exactEncoded),
    });
  }
  const registerTransaction = exactFlow.register({
    epochs: intent.walrus.epochs,
    owner: intent.signer.address,
    deletable: intent.walrus.deletable,
  });
  const registerResult = await client.core.simulateTransaction({
    transaction: registerTransaction,
    include: {
      effects: true,
      events: true,
      objectTypes: true,
      commandResults: true,
    },
  });
  return {
    files: entries.map((entry) => ({
      identifier: entry.identifier,
      kind: entry.kind,
      mediaType: entry.mediaType,
      byteLength: entry.bytes.byteLength,
      sha256: sha256(entry.bytes),
    })),
    checkpoint: stableValue(encoded),
    quiltBlobId: encoded.blobId,
    unencodedSize: encoded.unencodedSize,
    quote: {
      relayTipMist: text(relayTip),
      storageCostFrost: text(costs.storageCost),
      writeCostFrost: text(costs.writeCost),
      totalCostFrost: text(costs.totalCost),
      epochs: intent.walrus.epochs,
      deletable: intent.walrus.deletable,
      walletSuiBalanceMist: suiBalance,
      walletWalBalanceFrost: walBalance,
      walCoinType: exactWalCoinType,
    },
    registerSimulation: simulationEnvelope(registerResult, 'Walrus register dry-run'),
  };
}

function transactionReadiness(intent) {
  return Object.fromEntries(Object.entries(intent.transactions).map(([name, transaction]) => {
    if (transaction.gasMode !== 'address-balance'
      || !Array.isArray(transaction.payment)
      || transaction.payment.length !== 0) {
      fail(`${name} must preserve address-balance gas with payment=[].`, {
        gasMode: transaction.gasMode,
        payment: stableValue(transaction.payment),
      });
    }
    const pendingRegeneration = !text(transaction.gasPriceMist)
      || !text(transaction.gasBudgetMist)
      || !text(transaction.expiration?.minEpoch)
      || !text(transaction.expiration?.maxEpoch)
      || !Number.isInteger(transaction.expiration?.nonce)
      || transaction.expiration.nonce === 0;
    if (pendingRegeneration && name !== 'parentFinalize') {
      fail(`${name} has incomplete locked gas/expiration inputs.`);
    }
    return [name, {
      role: name === 'parentMigration' ? 'historical-only' : 'future-stage-lock-input',
      gasPriceMist: text(transaction.gasPriceMist),
      gasBudgetMist: text(transaction.gasBudgetMist),
      gasMode: transaction.gasMode,
      payment: [],
      expiration: stableValue(transaction.expiration),
      pendingRegeneration,
    }];
  }));
}

function assertObservedStyles(styles, routePlan) {
  if (styles.length === 0) return;
  const identity = (row) => [row.partKey, row.itemKey, row.styleKey].map(text).join('\u0000');
  const expected = new Map(routePlan.rows.map((row) => [identity(row), row]));
  if (styles.length !== routePlan.rows.length) {
    fail('The current Style registry is partially populated.', {
      expected: routePlan.rows.length,
      actual: styles.length,
    });
  }
  for (const style of styles) {
    const route = expected.get(identity(style));
    if (!route || Number(style.rowKind) !== route.rowKind || text(style.packKey) !== route.packKey) {
      fail('The current Style registry drifted from its line-by-line route plan.', {
        style: stableValue(style), route: stableValue(route),
      });
    }
  }
}

function currentParentStage(root, styles) {
  if (root.lifecycle !== 1) fail('The parent is not PAUSED.');
  if (styles.length === 0 && root.styleCount === 0n && !root.styleRegistrySealed) {
    return 'evidence-then-atomic-finalize';
  }
  if (styles.length === 26 && root.styleCount === 26n && root.styleRegistrySealed) {
    return 'finalized-readback';
  }
  fail('The PAUSED parent is between reviewed stages.', {
    styleRows: styles.length,
    styleCount: root.styleCount,
    styleRegistrySealed: root.styleRegistrySealed,
  });
}

function exactMoveJsonFields(contents, expectedType, label) {
  const actualType = text(contents?.type?.repr);
  if (!actualType) fail(`${label} is missing its exact Move type.`);
  try {
    if (normalizeStructTag(actualType) !== normalizeStructTag(expectedType)) {
      fail(`${label} has the wrong Move type.`, { expectedType, actualType });
    }
  } catch (error) {
    if (error?.message?.includes('wrong Move type')) throw error;
    fail(`${label} has an invalid Move type.`, { expectedType, actualType });
  }
  const value = contents?.json;
  if (!value || typeof value !== 'object') {
    fail(`${label} is missing exact Move JSON fields.`);
  }
  return value.fields && typeof value.fields === 'object' ? value.fields : value;
}

async function exhaustiveV8EventPages(graphql, {
  eventType,
  afterCheckpoint = null,
  beforeCheckpoint,
} = {}) {
  const nodes = [];
  const cursors = [];
  let cursor = null;
  let pages = 0;
  do {
    const result = await graphql.query({
      query: ZERO_V8_HISTORY_QUERY,
      variables: {
        type: eventType,
        afterCheckpoint,
        beforeCheckpoint,
        first: 50,
        after: cursor,
      },
    });
    if (result?.errors?.length) {
      fail('The exhaustive v8 event-history query failed.', {
        eventType,
        errors: stableValue(result.errors),
      });
    }
    const connection = result?.data?.events;
    if (!connection || !Array.isArray(connection.nodes)) {
      fail('The exhaustive v8 event-history query returned an invalid response.', {
        eventType,
        response: stableValue(result),
      });
    }
    pages += 1;
    nodes.push(...connection.nodes);
    const next = connection.pageInfo?.hasNextPage === true
      ? text(connection.pageInfo?.endCursor)
      : '';
    if (connection.pageInfo?.hasNextPage === true
      && (!next || next === cursor || cursors.includes(next))) {
      fail('The exhaustive v8 event-history cursor stalled.', {
        eventType,
        page: pages,
        cursor,
        next,
      });
    }
    if (next) cursors.push(next);
    cursor = next || null;
  } while (cursor);
  return Object.freeze({ nodes, pages, cursors });
}

async function exhaustiveV8Objects(graphql, {
  objectType,
  objectKind,
  parentRootId,
} = {}) {
  const matches = [];
  const cursors = [];
  let cursor = null;
  let pages = 0;
  let objectsScanned = 0;
  do {
    const result = await graphql.query({
      query: ZERO_V8_HISTORY_OBJECT_QUERY,
      variables: { type: objectType, first: 50, after: cursor },
    });
    if (result?.errors?.length) {
      fail('The exhaustive v8 live-object query failed.', {
        objectType,
        errors: stableValue(result.errors),
      });
    }
    const connection = result?.data?.objects;
    if (!connection || !Array.isArray(connection.nodes)) {
      fail('The exhaustive v8 live-object query returned an invalid response.', {
        objectType,
        response: stableValue(result),
      });
    }
    pages += 1;
    objectsScanned += connection.nodes.length;
    for (const node of connection.nodes) {
      const fields = exactMoveJsonFields(
        node?.asMoveObject?.contents,
        objectType,
        `${objectKind} ${text(node?.address) || 'object'}`,
      );
      const observedRoot = jsonId(jsonField(fields, 'parent_root_id', 'parentRootId'));
      const releaseId = jsonId(jsonField(fields, 'release_id', 'releaseId'));
      if (!observedRoot || !releaseId) {
        fail(`${objectKind} is missing its exact parent Root or release ID.`, {
          objectId: text(node?.address), fields: stableValue(fields),
        });
      }
      if (observedRoot === parentRootId) {
        matches.push({
          objectKind,
          objectId: exactId(node.address, `${objectKind} object ID`),
          version: text(node.version),
          digest: text(node.digest),
          parentRootId: observedRoot,
          releaseId,
          previousTransaction: text(node?.previousTransaction?.digest),
          checkpoint: text(node?.previousTransaction?.effects?.checkpoint?.sequenceNumber),
          fields: stableValue(fields),
        });
      }
    }
    const next = connection.pageInfo?.hasNextPage === true
      ? text(connection.pageInfo?.endCursor)
      : '';
    if (connection.pageInfo?.hasNextPage === true
      && (!next || next === cursor || cursors.includes(next))) {
      fail('The exhaustive v8 live-object cursor stalled.', {
        objectType,
        page: pages,
        cursor,
        next,
      });
    }
    if (next) cursors.push(next);
    cursor = next || null;
  } while (cursor);
  return Object.freeze({
    objectKind,
    objectType,
    pages,
    objectsScanned,
    finalHasNextPage: false,
    paginationCompleted: true,
    matchingTargetRootCount: matches.length,
    matches,
    cursorTrailSha256: sha256(stableJson(cursors)),
  });
}

export async function scanV8HistoryWindow({
  runtime,
  intent,
  source,
  afterCheckpoint = null,
  expectedAuditHash = '',
  expectedCutoff = null,
  expectedChainIdentifier = '',
  graphqlClient = null,
} = {}) {
  const graphql = graphqlClient || new SuiGraphQLClient({
    network: 'mainnet',
    url: runtime.graphqlUrl,
  });
  const cutoffResult = await graphql.query({
    query: ZERO_V8_HISTORY_CUTOFF_QUERY,
    variables: {},
  });
  if (cutoffResult?.errors?.length || !cutoffResult?.data?.checkpoint) {
    fail('The zero-v8-history cutoff checkpoint is unavailable.', {
      response: stableValue(cutoffResult),
    });
  }
  const cutoff = cutoffResult.data.checkpoint;
  const reviewedChainIdentifier = text(
    intent.network?.chainIdentifier
      || intent.transactions?.parentFinalize?.expiration?.chain,
  );
  const observedChainIdentifier = text(cutoffResult.data.chainIdentifier);
  if (!reviewedChainIdentifier
    || observedChainIdentifier !== reviewedChainIdentifier
    || (expectedChainIdentifier
      && text(expectedChainIdentifier) !== reviewedChainIdentifier)) {
    fail('The zero-v8-history scan is not bound to the reviewed Mainnet chain.', {
      reviewedChainIdentifier,
      observedChainIdentifier,
      expectedChainIdentifier: text(expectedChainIdentifier),
    });
  }
  const cutoffSequence = Number(cutoff.sequenceNumber);
  if (!Number.isSafeInteger(cutoffSequence) || cutoffSequence < 0) {
    fail('The zero-v8-history cutoff checkpoint is invalid.', { cutoff });
  }
  // GraphQL EventFilter.beforeCheckpoint is strict, so use checkpoint + 1 to
  // include the exact observed cutoff while rejecting any later history.
  const beforeCheckpoint = cutoffSequence + 1;
  const lowerCheckpoint = afterCheckpoint === null || afterCheckpoint === undefined
    ? null
    : Number(afterCheckpoint);
  if (lowerCheckpoint !== null
    && (!Number.isSafeInteger(lowerCheckpoint)
      || lowerCheckpoint < 0
      || lowerCheckpoint > cutoffSequence)) {
    fail('The zero-v8-history lower checkpoint is invalid.', {
      afterCheckpoint,
      cutoffSequence,
    });
  }
  const typeOrigin = exactId(intent.protocol.typeOriginPackageId, 'v8 TypeOrigin');
  const rootId = exactId(intent.parent.currentV5.rootId, 'Parent MakerRootV5 ID');
  const scans = [];
  let totalEvents = 0;
  for (const eventName of ZERO_V8_HISTORY_EVENT_NAMES) {
    const eventType = `${typeOrigin}::expansion_pack_v8::${eventName}`;
    const page = await exhaustiveV8EventPages(graphql, {
      eventType,
      afterCheckpoint: lowerCheckpoint,
      beforeCheckpoint,
    });
    totalEvents += page.nodes.length;
    const matches = [];
    for (const node of page.nodes) {
      const fields = exactMoveJsonFields(
        node?.contents,
        eventType,
        eventName,
      );
      const releaseId = jsonId(jsonField(fields, 'release_id', 'releaseId'));
      const parentRootId = jsonId(jsonField(fields, 'parent_root_id', 'parentRootId'));
      if (!releaseId || !parentRootId) {
        fail(`${eventName} is missing its exact release or parent Root ID.`, {
          fields: stableValue(fields),
        });
      }
      if (parentRootId === rootId) {
        matches.push({
          eventName,
          eventType: text(node?.contents?.type?.repr) || eventType,
          releaseId,
          parentRootId,
          transactionDigest: text(node?.transaction?.digest),
          checkpoint: text(node?.transaction?.effects?.checkpoint?.sequenceNumber),
          sequenceNumber: text(node?.sequenceNumber),
          fields: stableValue(fields),
        });
      }
    }
    scans.push({
      eventName,
      eventType,
      pages: page.pages,
      eventsScanned: page.nodes.length,
      finalHasNextPage: false,
      paginationCompleted: true,
      matchingTargetRootCount: matches.length,
      matches,
      cursorTrailSha256: sha256(stableJson(page.cursors)),
    });
  }
  const targetMatches = scans.flatMap((scan) => scan.matches);
  const trustedEventMatches = targetMatches;
  const livePassScan = await exhaustiveV8Objects(graphql, {
    objectKind: 'ExpansionPackPassV8',
    objectType: `${typeOrigin}::expansion_pack_v8::ExpansionPackPassV8`,
    parentRootId: rootId,
  });
  if (trustedEventMatches.length !== 0
    || livePassScan.matches.length !== 0) {
    fail('The selected parent Root already has trusted Expansion Pack v8 history.', {
      rootId,
      cutoff,
      matches: trustedEventMatches,
      livePassObjects: livePassScan.matches,
    });
  }
  if (expectedAuditHash) {
    const normalizedExpectedHash = text(expectedAuditHash).replace(/^0x/i, '').toLowerCase();
    const anchoredCutoff = expectedCutoff || {};
    if (!/^[0-9a-f]{64}$/.test(normalizedExpectedHash)
      || String(anchoredCutoff.sequenceNumber) !== String(lowerCheckpoint)
      || !text(anchoredCutoff.digest)
      || !text(anchoredCutoff.timestamp)) {
      fail('The anchored zero-v8-history proof is incomplete.', {
        expectedAuditHash,
        expectedCutoff: stableValue(anchoredCutoff),
        afterCheckpoint: lowerCheckpoint,
      });
    }
    const anchorResult = await graphql.query({
      query: ZERO_V8_HISTORY_ANCHOR_QUERY,
      variables: { sequenceNumber: lowerCheckpoint },
    });
    const anchor = anchorResult?.data?.checkpoint;
    if (anchorResult?.errors?.length
      || text(anchorResult?.data?.chainIdentifier) !== reviewedChainIdentifier
      || !anchor
      || String(anchor.sequenceNumber) !== String(lowerCheckpoint)
      || text(anchor.digest) !== text(anchoredCutoff.digest)
      || text(anchor.timestamp) !== text(anchoredCutoff.timestamp)) {
      fail('The anchored zero-v8-history checkpoint no longer matches the reviewed chain.', {
        expectedCutoff: stableValue(anchoredCutoff),
        response: stableValue(anchorResult),
      });
    }
  }
  const historyProof = {
    domain: ZERO_V8_HISTORY_DOMAIN,
    chainIdentifier: reviewedChainIdentifier,
    graphqlUrl: runtime.graphqlUrl,
    cutoff: {
      sequenceNumber: String(cutoffSequence),
      digest: text(cutoff.digest),
      timestamp: text(cutoff.timestamp),
      inclusive: true,
    },
    continuationFrom: lowerCheckpoint === null ? null : {
      sequenceNumber: String(lowerCheckpoint),
      digest: text(expectedCutoff?.digest),
      timestamp: text(expectedCutoff?.timestamp),
      priorAuditHash: text(expectedAuditHash).replace(/^0x/i, '').toLowerCase(),
      exclusive: true,
    },
    typeOriginPackageId: typeOrigin,
    parentRootId: rootId,
    totalEventsScanned: totalEvents,
    targetAdmittedCount: targetMatches.filter(
      (match) => match.eventName === 'ExpansionPackAdmittedV8',
    ).length,
    targetEntitlementCount: targetMatches.filter(
      (match) => match.eventName === 'ExpansionPackEntitlementGrantedV8',
    ).length,
    targetPassCount: livePassScan.matches.length,
    trustBoundary:
      'CreatedV8 and all live Release shells are permissionless and deliberately omitted from the signing scan. '
      + 'Every trusted admission emits AdmittedV8, every entitlement/Pass emits EntitlementGrantedV8, both event types are exhaustively scanned, and every live PassV8 object is cross-checked.',
    untrustedCreatedTelemetry: {
      scanned: false,
      reason: 'Permissionless CreatedV8 volume cannot be allowed to deny finalization.',
    },
    trustedHistoryClear: true,
    passDerivation: 'Every ExpansionPackPassV8 is created atomically with ExpansionPackEntitlementGrantedV8.',
    exhaustive: true,
    scans,
    livePassScan,
  };
  const proof = lowerCheckpoint === null
    ? {
      ...historyProof,
      source: {
        headCommit: source.headCommit,
        headTree: source.headTree,
      },
      finalization: {
        callablePackageId: exactId(
          intent.protocol.commerceV5CallablePackageId,
          'Commerce callable package',
        ),
        independentExtensionV5TypeOriginPackageId: exactNonzeroId(
          intent.protocol.independentExtensionV5TypeOriginPackageId,
          'Independent extension v5 TypeOrigin',
        ),
        parentRootId: rootId,
        legacyMakerId: exactId(intent.parent.legacyMakerId, 'Legacy OCMaker ID'),
        makerTreasuryId: exactId(
          intent.parent.currentV5.treasuryId,
          'MakerTreasuryV5 ID',
        ),
        retiredControlCapId: exactId(
          intent.parent.currentV5.controlCapId,
          'MakerControlCapV5 ID',
        ),
        protocolConfigId: exactId(
          intent.protocol.commerceProtocolConfigV5Id,
          'CommerceProtocolConfigV5 ID',
        ),
        protocolAdminCapId: exactId(
          intent.protocol.protocolFeeAdminCapId,
          'ProtocolFeeAdminCap ID',
        ),
        owner: exactId(intent.signer.address, 'Finalizer signer'),
        parentVersion: text(intent.parent.versionNumber),
        parentManifestBlobId: text(intent.parent.manifestQuiltId),
        parentManifestSha256: text(intent.parent.manifestSha256).toLowerCase(),
        expectedLifecycle: 'PAUSED',
        expectedOwnershipEpoch: '0',
        lockedOwnershipEpoch: '1',
        exactStyleRouteSha256: text(intent.parent.exactStyleRouteSha256),
        exactStyleCount: intent.parent.expectedStyleCount,
        exactStyleCounts: stableValue(intent.parent.expectedStyleCounts),
        productGates: stableValue(intent.productGates),
      },
    }
    : historyProof;
  const result = Object.freeze({
    ...proof,
    auditHash: sha256(stableJson(proof)),
  });
  if (expectedAuditHash) {
    return Object.freeze({
      ...result,
      continuityVerified: true,
      anchoredAuditHash: text(expectedAuditHash).replace(/^0x/i, '').toLowerCase(),
    });
  }
  return result;
}

export async function zeroV8HistoryAudit({
  runtime, intent, source, exactStyleRouteSha256,
} = {}) {
  const auditedIntent = structuredClone(intent);
  auditedIntent.parent.exactStyleRouteSha256 = text(exactStyleRouteSha256);
  if (!/^[0-9a-f]{64}$/.test(auditedIntent.parent.exactStyleRouteSha256)) {
    fail('The finalization audit requires the exact 26-row route SHA-256.');
  }
  return scanV8HistoryWindow({ runtime, intent: auditedIntent, source });
}

async function migrationHistory(intent) {
  const relativePath = intent.parent.currentV5.migrationEvidencePath;
  const path = resolve(REPO_ROOT, relativePath);
  const bytes = await readFile(path);
  const evidence = JSON.parse(bytes);
  const event = evidence.event || {};
  const expected = {
    root_id: intent.parent.currentV5.rootId,
    treasury_id: intent.parent.currentV5.treasuryId,
    vault_id: intent.parent.currentV5.controlVaultId,
    control_cap_id: intent.parent.currentV5.controlCapId,
    legacy_maker_id: intent.parent.legacyMakerId,
    legacy_treasury_id: intent.parent.legacyTreasuryId,
    owner: intent.signer.address,
  };
  for (const [field, id] of Object.entries(expected)) {
    if (exactId(event[field], `Historical migration ${field}`) !== exactId(id, `Intent ${field}`)) {
      fail(`Historical migration evidence ${field} drifted.`);
    }
  }
  if (text(evidence.transactionDigest) !== intent.parent.currentV5.migrationTransactionDigest) {
    fail('Historical migration transaction digest drifted.');
  }
  return {
    role: 'historical-reference-only',
    path: relativePath,
    evidenceSha256: sha256(bytes),
    transactionDigest: evidence.transactionDigest,
    event: stableValue(event),
  };
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [intent, deployment, runtime, sourceCommit, sourceTree, sourceStatus] = await Promise.all([
    readFile(INTENT_URL, 'utf8').then(JSON.parse),
    readFile(DEPLOYMENT_URL, 'utf8').then(JSON.parse),
    loadPublicConfig(),
    gitValue('rev-parse', 'HEAD'),
    gitValue('rev-parse', 'HEAD^{tree}'),
    gitValue('status', '--porcelain=v1', '--untracked-files=all'),
  ]);
  const worktree = validateReadinessWorktree(sourceStatus);
  const correctiveUpgradeEvidence = await correctiveV7Evidence(intent, deployment);
  if (intent.writeBoundary.signingAllowed !== false
    || intent.writeBoundary.broadcastAllowed !== false
    || intent.writeBoundary.currentMode !== 'read-only-readiness-only') {
    fail('The readiness intent must explicitly forbid signing and broadcast.');
  }
  if ('parentActivate' in intent.transactions) {
    fail('The PAUSED readiness intent must not contain parentActivate.');
  }
  if (intent.parent.expectedLifecycle !== 'PAUSED'
    || intent.parent.expectedLifecycleCode !== 1) {
    fail('The parent readiness target must remain exactly PAUSED (1).');
  }
  if (exactId(intent.protocol.protocolFeeAdminCapOwner, 'ProtocolFee AdminCap owner')
      !== exactId(intent.signer.address, 'Signer')) {
    fail('The v4 ProtocolFee AdminCap owner must be the reviewed signer.');
  }
  const reviewedTransactions = transactionReadiness(intent);
  if (runtime.network !== 'mainnet'
    || runtime.expansionPackV8ReleaseEnabled !== false
    || runtime.commerceV5ReleaseEnabled !== false
    || runtime.canonicalSoulMintEnabled !== false
    || runtime.compositionV6ReleaseEnabled !== false
    || runtime.physicalStyleV7ReleaseEnabled !== false) {
    fail('The runtime product gates are not in the reviewed pre-sign state.');
  }
  const exactRuntimeFields = [
    ['commerceV5CallablePackageId', intent.protocol.commerceV5CallablePackageId],
    ['commerceV5TypeOriginPackageId', intent.protocol.commerceV5TypeOriginPackageId],
    ['commerceProtocolConfigV5Id', intent.protocol.commerceProtocolConfigV5Id],
    ['commerceProtocolTreasuryV5Id', intent.protocol.commerceProtocolTreasuryV5Id],
    ['commerceV5LogicalAuxiliaryBlobId', intent.protocol.logicalAuxiliaryBlobId],
    ['commerceV5SoulBindingProofType', intent.protocol.soulBindingProofType],
    ['expansionPackV8CallablePackageId', intent.protocol.callablePackageId],
    ['expansionPackV8TypeOriginPackageId', intent.protocol.typeOriginPackageId],
    ['paymentCoinType', intent.protocol.paymentCoinType],
  ];
  for (const [field, expected] of exactRuntimeFields) {
    if (text(runtime[field]).toLowerCase() !== text(expected).toLowerCase()) {
      fail(`Runtime field ${field} drifted from the reviewed intent.`, {
        expected,
        actual: runtime[field],
      });
    }
  }

  const parentUrl = `${runtime.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-id/${intent.parent.manifestQuiltId}/${intent.parent.manifestIdentifier}`;
  const parentResponse = await fetch(parentUrl, { cache: 'no-store' });
  if (!parentResponse.ok) fail(`Walrus returned HTTP ${parentResponse.status} for the parent manifest.`);
  const parentBytes = new Uint8Array(await parentResponse.arrayBuffer());
  const parentSha256 = sha256(parentBytes);
  if (parentSha256 !== intent.parent.manifestSha256) {
    fail('The immutable parent manifest SHA-256 drifted.', {
      expected: intent.parent.manifestSha256,
      actual: parentSha256,
    });
  }
  const parentManifest = JSON.parse(new TextDecoder().decode(parentBytes));
  const assetPath = resolve(REPO_ROOT, intent.pack.asset.sourcePath);
  const assetBytes = await readFile(assetPath);
  const assetSha256 = sha256(assetBytes);
  if (assetSha256 !== intent.pack.asset.sha256
    || assetBytes.byteLength !== intent.pack.asset.byteLength) {
    fail('The reviewed Pack PNG bytes drifted.', {
      expectedSha256: intent.pack.asset.sha256,
      actualSha256: assetSha256,
      expectedByteLength: intent.pack.asset.byteLength,
      actualByteLength: assetBytes.byteLength,
    });
  }

  const projection = commerceProjection(parentManifest, intent);
  const commercePlan = buildMakerCommerceV5DeploymentPlan(projection);
  const routePlan = buildParentRoutePlan(commercePlan, intent);
  const { project, preflight, candidate } = await buildPackCandidate(
    parentManifest,
    intent,
    assetBytes,
  );
  const client = new SuiGrpcClient({
    network: 'mainnet',
    baseUrl: runtime.grpcUrl,
  });
  const requiredIds = [
    intent.protocol.protocolFeeConfigId,
    intent.protocol.protocolFeeAdminCapId,
    intent.protocol.commerceProtocolConfigV5Id,
    intent.protocol.commerceProtocolTreasuryV5Id,
    intent.parent.currentV5.rootId,
    intent.parent.currentV5.treasuryId,
    intent.parent.currentV5.controlVaultId,
    intent.parent.currentV5.controlCapId,
  ].map((id, index) => exactId(id, `Required object ${index + 1}`));
  const [chain, objectResponse, balances, addressBalance, gasPrice, history] = await Promise.all([
    client.core.getChainIdentifier(),
    client.core.getObjects({ objectIds: requiredIds, include: { json: true } }),
    listBalances(client, intent.signer.address),
    client.core.getBalance({ owner: intent.signer.address }),
    client.core.getReferenceGasPrice(),
    migrationHistory(intent),
  ]);
  const objects = objectResponse.objects || [];
  if (objects.length !== requiredIds.length) {
    fail('Sui did not return every reviewed Mainnet object.', {
      expected: requiredIds.length,
      actual: objects.length,
    });
  }
  const objectById = new Map(objects.map((object) => [
    exactId(object.objectId || object.id, 'Returned object ID'),
    object,
  ]));
  const currentParent = validateCurrentParentState({ objects: objectById, intent });
  const { protocol } = currentParent;
  if (!protocol.enabled
    || protocol.logicalAuxiliaryBlobId !== intent.protocol.logicalAuxiliaryBlobId
    || protocol.soulBindingProofType !== normalizeStructTag(intent.protocol.soulBindingProofType)) {
    fail('The on-chain Commerce v5 protocol state drifted from the reviewed prerequisite.', {
      protocol: stableValue(protocol),
    });
  }
  const styles = await queryStyleBindingsV5(client.core, currentParent.root);
  assertObservedStyles(styles, routePlan);
  const parentStage = currentParentStage(currentParent.root, styles);
  const walrusState = await walrusReadiness({
    client,
    runtime,
    intent,
    candidate,
    assetBytes,
    balances,
  });

  const source = {
    headCommit: sourceCommit,
    headTree: sourceTree,
    dirty: Boolean(sourceStatus),
    dirtyPaths: sourceStatus ? sourceStatus.split('\n').filter(Boolean) : [],
    cleanForReadiness: worktree.cleanForReadiness,
    allowedUntrackedPaths: worktree.allowedUntracked,
    deployedV8SourceCommit: correctiveUpgradeEvidence.deployedSourceCommit,
    deployedV8SourceTree: correctiveUpgradeEvidence.deployedSourceTree,
  };
  const zeroV8History = await zeroV8HistoryAudit({
    runtime,
    intent,
    source,
    exactStyleRouteSha256: routePlan.rowsSha256,
  });
  const objectFingerprints = requiredIds.map((id) => objectFingerprint(objectById.get(id)));
  const lock = {
    network: {
      name: 'mainnet',
      chainIdentifier: text(chain.chainIdentifier),
      grpcUrl: runtime.grpcUrl,
      referenceGasPriceMist: text(gasPrice.referenceGasPrice || gasPrice.gasPrice || gasPrice),
    },
    signer: {
      alias: intent.signer.alias,
      address: exactId(intent.signer.address, 'Signer'),
      balances: balanceSummary(balances),
      suiAddressBalance: {
        balance: text(addressBalance?.balance?.balance),
        coinBalance: text(addressBalance?.balance?.coinBalance),
        addressBalance: text(addressBalance?.balance?.addressBalance),
      },
    },
    source,
    correctiveUpgradeEvidence,
    protocol: stableValue(intent.protocol),
    objects: objectFingerprints,
    parent: {
      ...stableValue(intent.parent),
      manifestUrl: parentUrl,
      manifestByteLength: parentBytes.byteLength,
      manifestSha256: parentSha256,
      projectionSha256: sha256(canonicalExpansionPackJson(projection)),
      styleCounts: {
        total: commercePlan.configuration.styleBindings.length,
        visual: commercePlan.configuration.styleBindings.filter((style) => style.rowKind === 0).length,
        logicalNone: commercePlan.configuration.styleBindings.filter((style) => style.rowKind === 1).length,
        logicalColor: commercePlan.configuration.styleBindings.filter((style) => style.rowKind === 2).length,
      },
      expectedLifecycle: intent.parent.expectedLifecycle,
      expectedLifecycleCode: intent.parent.expectedLifecycleCode,
      commercePlan: stableValue(commercePlan),
      routePlan,
      zeroV8History,
      currentStage: parentStage,
      currentState: {
        root: stableValue(currentParent.root),
        makerTreasury: stableValue(currentParent.makerTreasury),
        controlCap: stableValue(currentParent.controlCap),
        protocolTreasury: stableValue(currentParent.protocolTreasury),
        vault: stableValue(objectJson(currentParent.current.vault)),
        styles: stableValue(styles),
      },
      migrationEvidence: history,
    },
    migrationSimulation: null,
    migrationDisposition: 'already-migrated; current Root/ControlCap/Treasury/Vault readback is authoritative',
    transactions: reviewedTransactions,
    pack: {
      intent: stableValue(intent.pack),
      project: stableValue({
        ...project,
        pack: {
          ...project.pack,
          assets: project.pack.assets.map(({ blob, file, ...asset }) => asset),
        },
      }),
      preflight: stableValue({
        valid: preflight.valid,
        publishable: preflight.publishable,
        issues: preflight.issues,
      }),
      candidate: stableValue(candidate),
    },
    walrus: walrusState,
    productGates: stableValue(intent.productGates),
    writeBoundary: stableValue(intent.writeBoundary),
  };
  const report = {
    schemaVersion: 'animacraft.expansion-pack-v8-free-readiness.v1',
    observedAt: new Date().toISOString(),
    ready: true,
    lockFingerprintSha256: sha256(stableJson(lock)),
    lock,
  };
  if (args.output) {
    const outputPath = resolve(REPO_ROOT, args.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${stableJson(report, 2)}\n`, { flag: 'w' });
  }
  process.stdout.write(args.json
    ? `${stableJson(report, 2)}\n`
    : [
      `ready: ${report.ready}`,
      `lock: ${report.lockFingerprintSha256}`,
      `chain: ${report.lock.network.chainIdentifier}`,
      `signer: ${report.lock.signer.address}`,
      `parent styles: ${report.lock.parent.styleCounts.total}`,
      `parent lifecycle: ${report.lock.parent.expectedLifecycle}`,
      `current parent stage: ${report.lock.parent.currentStage}`,
      `route plan: ${report.lock.parent.routePlan.rowsSha256}`,
      `candidate manifest: ${candidate.manifestSha256}`,
      `candidate content: ${candidate.contentCommitment}`,
      `Walrus Quilt: ${walrusState.quiltBlobId}`,
      `Walrus relay tip: ${walrusState.quote.relayTipMist} MIST`,
      `Walrus total: ${walrusState.quote.totalCostFrost} FROST`,
      'signing: forbidden',
      'broadcast: forbidden',
    ].join('\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  const payload = {
    ready: false,
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.simulation ? { simulation: error.simulation } : {}),
  };
  process.stderr.write(`${stableJson(payload, 2)}\n`);
  process.exitCode = 1;
});
