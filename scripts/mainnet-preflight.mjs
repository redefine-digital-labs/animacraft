import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { walrus } from '@mysten/walrus';
import {
  ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES,
  normalizeRuntimeConfig,
  validateRuntimeConfig,
} from '../runtime-config.js';
import {
  parseIndependentExtensionAuthorityV5,
  parseMakerRootV5,
  parseMakerTreasuryV5,
  queryStyleBindingsV5,
} from '../chain-commerce-v5.js';
import { queryIndependentExtensionLockV5 } from '../expansion-pack-publication-v8-app.js';
import {
  EXPANSION_PACK_V8_ACCESS,
  EXPANSION_PACK_V8_LIFECYCLE,
  parseExpansionPackAdminCapV8,
  parseExpansionPackPassV8,
  parseExpansionPackReleaseV8,
  parseExpansionPackTreasuryV8,
  queryExpansionPackStyleRecordsV8,
} from '../expansion-pack-publication-v8-app.js';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const network = args.has('--network');
const requireSoulidity = args.has('--require-soulidity');
// Every strict Mainnet rehearsal after v6 ships must prove the complete tuple.
// The explicit flag also lets CI exercise this fail-closed path without making
// network calls.
const expansionPackV8Only = args.has('--expansion-pack-v8-only');
const requireCompositionV6 = args.has('--require-composition-v6')
  || (strict && network && !expansionPackV8Only);
const allowCompositionV6Enabled = args.has('--allow-v6-enabled');
const requireExpansionPackV8 = args.has('--require-expansion-pack-v8')
  || expansionPackV8Only
  || args.has('--require-expansion-pack-v8-post-claim');
const requireExpansionPackV8PostClaim = args.has('--require-expansion-pack-v8-post-claim');
const json = args.has('--json');
const checks = [];
const ZERO_SUI_ADDRESS = normalizeSuiAddress('0x0');

export const COMPOSITION_V6_CORE_RUNTIME_FIELDS = Object.freeze([
  'compositionV6TypeOriginPackageId',
  'compositionProtocolConfigV6Id',
  'compositionProtocolTreasuryV6Id',
  'compositionRegistryV6Id',
  'compositionAdminCapV6Id',
  'compositionAdminCapV6Owner',
  'compositionValidatorCapV6Id',
  'compositionValidatorCapV6Owner',
  'compositionValidatorEpochV6',
  'compositionValidatorPolicyCommitmentV6',
]);

export const COMPOSITION_V6_BINDING_RUNTIME_FIELDS = Object.freeze([
  'compositionV6SoulOwnerProofType',
]);

export const COMPOSITION_V6_RUNTIME_FIELDS = Object.freeze([
  ...COMPOSITION_V6_CORE_RUNTIME_FIELDS,
  ...COMPOSITION_V6_BINDING_RUNTIME_FIELDS,
]);

export const COMPOSITION_V6_CORE_DEPENDENCY_FIELDS = Object.freeze([
  'commerceV5TypeOriginPackageId',
  'commerceProtocolConfigV5Id',
  'protocolFeeAdminCapId',
  'paymentCoinType',
]);

export const COMPOSITION_V6_BINDING_DEPENDENCY_FIELDS = Object.freeze([
  'compositionV6SoulOwnerProofTypeOriginPackageId',
]);

export const COMPOSITION_V6_DEPENDENCY_FIELDS = Object.freeze([
  ...COMPOSITION_V6_CORE_DEPENDENCY_FIELDS,
  ...COMPOSITION_V6_BINDING_DEPENDENCY_FIELDS,
]);

export const EXPANSION_PACK_V8_RUNTIME_FIELDS = Object.freeze([
  'expansionPackV8CallablePackageId',
  'expansionPackV8TypeOriginPackageId',
  'independentExtensionV5TypeOriginPackageId',
  'legacyLogicalV5TypeOriginPackageId',
  'independentExtensionAuthorityV5Id',
  'expansionPackV8ReleaseEnabled',
]);

export const EXPANSION_PACK_V8_RELEASE_EVIDENCE_FIELDS = Object.freeze([
  'callablePackageId',
  'typeOriginPackageId',
  'packageVersion',
  'packageObjectVersion',
  'upgradeTxDigest',
  'upgradeCheckpoint',
  'upgradedAtMs',
  'sourceCommit',
  'sourceTree',
  'packageDigest',
  'packageObjectDigest',
  'independentExtensionV5TypeOriginPackageId',
  'legacyLogicalV5TypeOriginPackageId',
  'upgradeCapPackageVersion',
  'upgradePolicy',
  'enabled',
]);

export const EXPANSION_PACK_V8_VERIFICATION_FIELDS = Object.freeze([
  'expansionPackV8UpgradeTransactionStatus',
  'expansionPackV8SourceStatus',
  'expansionPackV8PackageReadBack',
  'expansionPackV8ParentFinalizationStatus',
  'expansionPackV8ParentFinalizationReadBack',
  'expansionPackV8ParentAuthorityShared',
  'expansionPackV8ParentControlCapDeleted',
  'expansionPackV8ParentZeroHistoryClear',
  'expansionPackV8Enabled',
]);

export const EXPANSION_PACK_V8_PARENT_FINALIZATION_FIELDS = Object.freeze([
  'status',
  'chainIdentifier',
  'transactionDigest',
  'checkpoint',
  'checkpointDigest',
  'finalizedAtMs',
  'rootId',
  'treasuryId',
  'legacyMakerId',
  'owner',
  'protocolConfigId',
  'protocolAdminCapId',
  'authorityId',
  'authorityTypeOriginPackageId',
  'retiredControlCap.id',
  'retiredControlCap.deletionEffect',
  'retiredControlCap.readbackStatus',
  'lifecycle',
  'lifecycleCode',
  'retiredControlCapEpoch',
  'ownershipEpoch',
  'styleCounts.visual',
  'styleCounts.logicalNone',
  'styleCounts.logicalColor',
  'styleCounts.total',
  'styleRegistrySealed',
  'packCount',
  'paidPackCount',
  'completeOutputCount',
  'activeListingId',
  'treasuryBalanceAtomic',
  'requiresSealPolicy',
  'sealPolicyBound',
  'auditHash',
  'lockFingerprintSha256',
  'resultPath',
  'resultSha256',
  'publicEvidencePath',
  'publicEvidenceSha256',
  'authorityShared',
  'gasUsedMist',
  'gasComputationCostMist',
  'gasStorageCostMist',
  'gasStorageRebateMist',
  'gasNonRefundableStorageFeeMist',
  'legacyLogicalEventCount',
  'finalizedEventCount',
  'zeroHistoryTrustedClear',
]);

export const EXPANSION_PACK_V8_ACTIVATION_FIELDS = Object.freeze([
  'schemaVersion',
  'status',
  'chainIdentifier',
  'transactionDigest',
  'checkpoint',
  'checkpointDigest',
  'activatedAtMs',
  'activatedAtUtc',
  'releaseId',
  'releaseObjectVersion',
  'releaseObjectDigest',
  'adminCapId',
  'adminCapObjectVersion',
  'adminCapObjectDigest',
  'treasuryId',
  'treasuryObjectVersion',
  'treasuryObjectDigest',
  'packId',
  'namespace',
  'version',
  'creator',
  'parentRootId',
  'parentLegacyMakerId',
  'admittedBy',
  'admittedParentOwnershipEpoch',
  'accessMode',
  'accessKind',
  'purchasePriceAtomic',
  'lifecycle',
  'lifecycleCode',
  'manifestBlobId',
  'manifestSha256',
  'contentCommitment',
  'styleRegistryCommitment',
  'styleCount',
  'entitlementCount',
  'passCountForTestWallet',
  'sealPolicyId',
  'sealPackageId',
  'sealReleaseCommitment',
  'treasuryBalanceAtomic',
  'treasuryTotalCollectedAtomic',
  'treasuryTotalWithdrawnAtomic',
  'style.partKey',
  'style.itemKey',
  'style.styleKey',
  'style.assetBlobId',
  'style.assetSha256',
  'style.assetSealId',
  'walrus.blobObjectId',
  'walrus.blobObjectVersion',
  'walrus.blobObjectDigest',
  'walrus.registeredEpoch',
  'walrus.certifiedEpoch',
  'walrus.storageStartEpoch',
  'walrus.storageEndEpoch',
  'walrus.deletable',
  'walrus.manifestPatchId',
  'walrus.assetPatchId',
  'walrus.files',
  'receiptEvidence.path',
  'receiptEvidence.fileSha256',
  'receiptEvidence.contentSha256',
  'readbackEvidence.path',
  'readbackEvidence.fileSha256',
]);

// Activation evidence is a frozen pre-claim artifact. A claim mutates the
// shared Release object, so all mutable post-claim values and wallet acceptance
// evidence live in this separate, optional block.
export const EXPANSION_PACK_V8_POST_CLAIM_FIELDS = Object.freeze([
  'schemaVersion',
  'status',
  'chainIdentifier',
  'transactionDigest',
  'checkpoint',
  'checkpointDigest',
  'claimedAtMs',
  'claimedAtUtc',
  'releaseId',
  'releaseObjectVersion',
  'releaseObjectDigest',
  'entitlementCount',
  'walletAddress',
  'passId',
  'passObjectVersion',
  'passObjectDigest',
  'holder',
  'parentRootId',
  'paidAtomic',
  'issuedAtMs',
  'admittedParentOwnershipEpoch',
  'contentCommitment',
  'createdPassCount',
  'entitlementEventCount',
  'passCountForTestWallet',
  'receiptEvidence.path',
  'receiptEvidence.fileSha256',
  'receiptEvidence.contentSha256',
  'readbackEvidence.path',
  'readbackEvidence.fileSha256',
  'walletAcceptanceEvidence.path',
  'walletAcceptanceEvidence.fileSha256',
  'renderEvidence.path',
  'renderEvidence.fileSha256',
  'renderEvidence.artifactPath',
  'renderEvidence.artifactSha256',
]);

export const EXPANSION_PACK_V8_POST_CLAIM_VERIFICATION_FIELDS = Object.freeze([
  'expansionPackV8FreeClaimTransactionStatus',
  'expansionPackV8FreeClaimReadBack',
  'expansionPackV8FreeClaimPassReadBack',
  'expansionPackV8FreeClaimEventReadBack',
  'expansionPackV8FreeClaimCreatedPassCount',
  'expansionPackV8FreeClaimPaidAtomic',
  'expansionPackV8WalletAcceptance',
  'expansionPackV8RenderAcceptance',
]);

const SUI_TRANSACTION_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const COMPOSITION_V6_RETIRED_ENTRY_POINTS = Object.freeze([
  'create_maker_profile_v6',
  'seal_maker_profile_v6',
  'publish_official_item_product_v6',
  'publish_external_item_product_v6',
  'publish_validator_attestation_v6',
  'admit_official_item_v6',
  'admit_certified_item_v6',
  'admit_open_item_v6',
  'reactivate_item_admission_v6',
  'claim_free_wallet_item_v6',
  'claim_free_soul_item_v6',
  'purchase_wallet_item_v6',
  'purchase_soul_item_v6',
  'transfer_owned_item_v6',
  'lock_owned_item_to_soul_v6',
  'authorize_loadout_v6',
  'authorize_initial_loadout_v6',
  'claim_free_owned_item_for_physical_v7',
  'purchase_owned_item_for_physical_v7',
]);

export function inspectCompositionV6RetirementEvidence(deployment = {}) {
  const evidence = deployment.verification || {};
  const ready = evidence.compositionV6RetiredOperationCount
      === COMPOSITION_V6_RETIRED_ENTRY_POINTS.length
    && evidence.compositionV6RetirementAbortCode === 1
    && positiveInteger(evidence.compositionV6RetirementEvidenceCheckpoint)
    && /^[0-9a-f]{64}$/.test(
      String(evidence.compositionV6RetirementEvidenceSha256 || ''),
    );
  return {
    ready,
    retiredEntryPoints: [...COMPOSITION_V6_RETIRED_ENTRY_POINTS],
    detail: ready
      ? 'Pre-upgrade zero-state evidence authorizes exactly 19 Composition v6 writes to abort EProtocolDisabled=1; six recovery/compatibility paths remain callable.'
      : 'Composition v6 retirement evidence must record 19 operations, abort code 1, checkpoint, and exact evidence SHA-256.',
  };
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function normalizeBytes32(value) {
  let bytes = value;
  if (bytes && typeof bytes === 'object' && !Array.isArray(bytes)) {
    bytes = bytes.bytes ?? bytes.vec ?? bytes.fields ?? bytes.value;
  }
  if (Array.isArray(bytes)) {
    if (bytes.length !== 32 || bytes.some((entry) => (
      !Number.isInteger(Number(entry)) || Number(entry) < 0 || Number(entry) > 255
    ))) return '';
    return `0x${bytes.map((entry) => Number(entry).toString(16).padStart(2, '0')).join('')}`;
  }
  const serialized = String(bytes || '').trim();
  const normalized = serialized.toLowerCase();
  const hex = normalized.startsWith('0x') ? normalized.slice(2) : normalized;
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;
  // Sui gRPC JSON currently serializes vector<u8> values as base64 while
  // other client surfaces expose an integer array. Accept both exact forms.
  if (/^[a-z0-9+/]{43}=$/i.test(serialized)) {
    const decoded = Buffer.from(serialized, 'base64');
    if (decoded.length === 32) return `0x${decoded.toString('hex')}`;
  }
  return '';
}

export function compositionV6Declared(config = {}) {
  return config.compositionV6ReleaseEnabled === true
    || COMPOSITION_V6_RUNTIME_FIELDS.some((field) => present(config[field]));
}

function nestedValue(value, path) {
  return String(path).split('.').reduce(
    (current, field) => (current && typeof current === 'object'
      ? current[field]
      : undefined),
    value,
  );
}

function positiveInteger(value) {
  if (value === '' || value === undefined || value === null) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function validSuiId(value) {
  try {
    return normalizeSuiAddress(String(value || '')) !== ZERO_SUI_ADDRESS;
  } catch {
    return false;
  }
}

export function expansionPackV8Declared(config = {}, deployment = {}) {
  const release = deployment.releases?.expansionPackV8;
  const verification = deployment.verification || {};
  return config.expansionPackV8ReleaseEnabled === true
    || present(config.expansionPackV8CallablePackageId)
    || present(config.expansionPackV8TypeOriginPackageId)
    || present(config.independentExtensionV5TypeOriginPackageId)
    || present(config.legacyLogicalV5TypeOriginPackageId)
    || present(config.independentExtensionAuthorityV5Id)
    || deployment.expansionPackV8ReleaseEnabled === true
    || present(deployment.expansionPackV8CallablePackageId)
    || present(deployment.expansionPackV8TypeOriginPackageId)
    || present(deployment.independentExtensionV5TypeOriginPackageId)
    || present(deployment.legacyLogicalV5TypeOriginPackageId)
    || Boolean(release && typeof release === 'object' && Object.keys(release).length)
    || EXPANSION_PACK_V8_VERIFICATION_FIELDS.some((field) => (
      present(verification[field])
    ));
}

export function inspectExpansionPackV8Deployment(
  config = {},
  deployment = {},
  { required = false, requirePostClaim = false } = {},
) {
  const declared = required || expansionPackV8Declared(config, deployment);
  if (!declared) {
    return {
      declared: false,
      ready: true,
      runtimeMissing: [],
      runtimeInvalid: [],
      deploymentMissing: [],
      deploymentInvalid: [],
      mismatches: [],
    };
  }

  const release = deployment.releases?.expansionPackV8 || {};
  const verification = deployment.verification || {};
  const parentFinalization = release.parentFinalization || {};
  const parentFinalizationDeclared = Boolean(
    parentFinalization && typeof parentFinalization === 'object'
      && Object.keys(parentFinalization).length,
  );
  const activation = release.activation || {};
  const activationDeclared = Boolean(
    activation && typeof activation === 'object' && Object.keys(activation).length,
  );
  const postClaim = release.postClaim || {};
  const postClaimDeclared = Boolean(
    postClaim && typeof postClaim === 'object' && Object.keys(postClaim).length,
  );
  // The file-level inspector validates any block that is present. The command
  // runner separately makes external activation evidence mandatory when the
  // public runtime gate is true, which keeps synthetic package-only fixtures
  // useful without weakening the production gate.
  const activationRequired = false;
  const runtimeMissing = EXPANSION_PACK_V8_RUNTIME_FIELDS.filter((field) => (
    field === 'expansionPackV8ReleaseEnabled'
      ? typeof config[field] !== 'boolean'
      : !present(config[field])
  ));
  const runtimeInvalid = [
    'expansionPackV8CallablePackageId',
    'expansionPackV8TypeOriginPackageId',
    'independentExtensionV5TypeOriginPackageId',
    'legacyLogicalV5TypeOriginPackageId',
    'independentExtensionAuthorityV5Id',
  ].filter((field) => present(config[field]) && !validSuiId(config[field]));

  const deploymentPaths = [
    'expansionPackProtocolVersion',
    'expansionPackV8CallablePackageId',
    'expansionPackV8TypeOriginPackageId',
    'independentExtensionV5TypeOriginPackageId',
    'legacyLogicalV5TypeOriginPackageId',
    'independentExtensionAuthorityV5Id',
    'expansionPackV8ReleaseEnabled',
    ...EXPANSION_PACK_V8_RELEASE_EVIDENCE_FIELDS.map(
      (field) => `releases.expansionPackV8.${field}`,
    ),
    ...EXPANSION_PACK_V8_VERIFICATION_FIELDS.map(
      (field) => `verification.${field}`,
    ),
    ...EXPANSION_PACK_V8_PARENT_FINALIZATION_FIELDS.map(
      (field) => `releases.expansionPackV8.parentFinalization.${field}`,
    ),
    ...((activationDeclared || activationRequired)
      ? EXPANSION_PACK_V8_ACTIVATION_FIELDS.map(
        (field) => `releases.expansionPackV8.activation.${field}`,
      )
      : []),
    ...((postClaimDeclared || requirePostClaim)
      ? [
          ...EXPANSION_PACK_V8_POST_CLAIM_FIELDS.map(
            (field) => `releases.expansionPackV8.postClaim.${field}`,
          ),
          ...EXPANSION_PACK_V8_POST_CLAIM_VERIFICATION_FIELDS.map(
            (field) => `verification.${field}`,
          ),
        ]
      : []),
  ];
  const booleanPaths = new Set([
    'expansionPackV8ReleaseEnabled',
    'releases.expansionPackV8.enabled',
    'verification.expansionPackV8PackageReadBack',
    'verification.expansionPackV8Enabled',
    'releases.expansionPackV8.parentFinalization.styleRegistrySealed',
    'releases.expansionPackV8.parentFinalization.requiresSealPolicy',
    'releases.expansionPackV8.parentFinalization.sealPolicyBound',
    'releases.expansionPackV8.parentFinalization.authorityShared',
    'releases.expansionPackV8.parentFinalization.zeroHistoryTrustedClear',
    'releases.expansionPackV8.activation.walrus.deletable',
    'verification.expansionPackV8FreeClaimReadBack',
    'verification.expansionPackV8FreeClaimPassReadBack',
    'verification.expansionPackV8FreeClaimEventReadBack',
    'verification.expansionPackV8WalletAcceptance',
    'verification.expansionPackV8RenderAcceptance',
  ]);
  const deploymentMissing = deploymentPaths.filter((path) => {
    const value = nestedValue(deployment, path);
    if (path === 'releases.expansionPackV8.parentFinalization.activeListingId') {
      return typeof value !== 'string';
    }
    if ([
      'releases.expansionPackV8.activation.sealPolicyId',
      'releases.expansionPackV8.activation.sealPackageId',
      'releases.expansionPackV8.activation.sealReleaseCommitment',
      'releases.expansionPackV8.activation.style.assetSealId',
    ].includes(path)) return typeof value !== 'string';
    return booleanPaths.has(path) ? typeof value !== 'boolean' : !present(value);
  });

  const deploymentInvalid = [];
  if (present(deployment.expansionPackProtocolVersion)
    && Number(deployment.expansionPackProtocolVersion) !== 8) {
    deploymentInvalid.push('expansionPackProtocolVersion');
  }
  [
    ['expansionPackV8CallablePackageId', deployment.expansionPackV8CallablePackageId],
    ['expansionPackV8TypeOriginPackageId', deployment.expansionPackV8TypeOriginPackageId],
    ['independentExtensionV5TypeOriginPackageId', deployment.independentExtensionV5TypeOriginPackageId],
    ['legacyLogicalV5TypeOriginPackageId', deployment.legacyLogicalV5TypeOriginPackageId],
    ['independentExtensionAuthorityV5Id', deployment.independentExtensionAuthorityV5Id],
    ['releases.expansionPackV8.callablePackageId', release.callablePackageId],
    ['releases.expansionPackV8.typeOriginPackageId', release.typeOriginPackageId],
    ['releases.expansionPackV8.independentExtensionV5TypeOriginPackageId', release.independentExtensionV5TypeOriginPackageId],
    ['releases.expansionPackV8.legacyLogicalV5TypeOriginPackageId', release.legacyLogicalV5TypeOriginPackageId],
  ].forEach(([path, value]) => {
    if (present(value) && !validSuiId(value)) deploymentInvalid.push(path);
  });
  if (present(release.packageVersion) && Number(release.packageVersion) !== 7) {
    deploymentInvalid.push('releases.expansionPackV8.packageVersion');
  }
  if (present(release.packageObjectVersion)
    && Number(release.packageObjectVersion) !== 7) {
    deploymentInvalid.push('releases.expansionPackV8.packageObjectVersion');
  }
  if (present(release.upgradeCapPackageVersion)
    && Number(release.upgradeCapPackageVersion) !== 7) {
    deploymentInvalid.push('releases.expansionPackV8.upgradeCapPackageVersion');
  }
  if (present(release.upgradePolicy) && Number(release.upgradePolicy) !== 0) {
    deploymentInvalid.push('releases.expansionPackV8.upgradePolicy');
  }
  if (present(release.upgradeTxDigest)
    && !SUI_TRANSACTION_DIGEST.test(String(release.upgradeTxDigest))) {
    deploymentInvalid.push('releases.expansionPackV8.upgradeTxDigest');
  }
  if (present(release.upgradeCheckpoint) && !positiveInteger(release.upgradeCheckpoint)) {
    deploymentInvalid.push('releases.expansionPackV8.upgradeCheckpoint');
  }
  if (present(release.upgradedAtMs) && !positiveInteger(release.upgradedAtMs)) {
    deploymentInvalid.push('releases.expansionPackV8.upgradedAtMs');
  }
  for (const field of ['sourceCommit', 'sourceTree']) {
    if (present(release[field]) && !GIT_OBJECT_ID.test(String(release[field]))) {
      deploymentInvalid.push(`releases.expansionPackV8.${field}`);
    }
  }
  if (present(release.packageDigest)
    && !SUI_TRANSACTION_DIGEST.test(String(release.packageDigest))) {
    deploymentInvalid.push('releases.expansionPackV8.packageDigest');
  }
  if (present(release.packageObjectDigest)
    && !SUI_TRANSACTION_DIGEST.test(String(release.packageObjectDigest))) {
    deploymentInvalid.push('releases.expansionPackV8.packageObjectDigest');
  }
  if (present(verification.expansionPackV8UpgradeTransactionStatus)
    && verification.expansionPackV8UpgradeTransactionStatus !== 'success') {
    deploymentInvalid.push('verification.expansionPackV8UpgradeTransactionStatus');
  }
  if (present(verification.expansionPackV8SourceStatus)
    && verification.expansionPackV8SourceStatus !== 'success') {
    deploymentInvalid.push('verification.expansionPackV8SourceStatus');
  }
  if (typeof verification.expansionPackV8PackageReadBack === 'boolean'
    && verification.expansionPackV8PackageReadBack !== true) {
    deploymentInvalid.push('verification.expansionPackV8PackageReadBack');
  }
  for (const [field, expected] of [
    ['expansionPackV8ParentFinalizationStatus', 'success'],
    ['expansionPackV8ParentFinalizationReadBack', true],
    ['expansionPackV8ParentAuthorityShared', true],
    ['expansionPackV8ParentControlCapDeleted', true],
    ['expansionPackV8ParentZeroHistoryClear', true],
  ]) {
    if (present(verification[field]) && verification[field] !== expected) {
      deploymentInvalid.push(`verification.${field}`);
    }
  }
  if (parentFinalizationDeclared) {
    const invalidParent = (field) => deploymentInvalid.push(
      `releases.expansionPackV8.parentFinalization.${field}`,
    );
    const exactIds = [
      'rootId', 'treasuryId', 'legacyMakerId', 'owner', 'protocolConfigId',
      'protocolAdminCapId', 'authorityId', 'authorityTypeOriginPackageId',
      'retiredControlCap.id',
    ];
    for (const field of exactIds) {
      const value = nestedValue(parentFinalization, field);
      if (present(value) && !validSuiId(value)) invalidParent(field);
    }
    if (parentFinalization.status !== 'success') invalidParent('status');
    if (present(parentFinalization.transactionDigest)
      && !SUI_TRANSACTION_DIGEST.test(String(parentFinalization.transactionDigest))) {
      invalidParent('transactionDigest');
    }
    for (const field of ['checkpoint', 'finalizedAtMs']) {
      if (present(parentFinalization[field]) && !positiveInteger(parentFinalization[field])) {
        invalidParent(field);
      }
    }
    if (present(parentFinalization.checkpoint)
      && present(release.upgradeCheckpoint)
      && BigInt(parentFinalization.checkpoint) < BigInt(release.upgradeCheckpoint)) {
      invalidParent('checkpoint');
    }
    for (const field of [
      'checkpointDigest', 'rootObjectDigest', 'authorityObjectDigest',
    ]) {
      if (present(parentFinalization[field])
        && !SUI_TRANSACTION_DIGEST.test(String(parentFinalization[field]))) invalidParent(field);
    }
    for (const field of [
      'auditHash', 'lockFingerprintSha256', 'lockEvidenceSha256',
      'resultSha256', 'publicEvidenceSha256', 'zeroHistoryAuditHash',
    ]) {
      if (present(parentFinalization[field])
        && !SHA256.test(String(parentFinalization[field]))) invalidParent(field);
    }
    const exactValues = [
      ['lifecycle', 'PAUSED'],
      ['lifecycleCode', 1],
      ['retiredControlCapEpoch', '0'],
      ['ownershipEpoch', '1'],
      ['styleCounts.visual', 19],
      ['styleCounts.logicalNone', 3],
      ['styleCounts.logicalColor', 4],
      ['styleCounts.total', 26],
      ['styleRegistrySealed', true],
      ['packCount', 0],
      ['paidPackCount', 0],
      ['completeOutputCount', 0],
      ['activeListingId', ''],
      ['treasuryBalanceAtomic', '0'],
      ['requiresSealPolicy', false],
      ['sealPolicyBound', false],
      ['retiredControlCap.deletionEffect', 'Deleted'],
      ['retiredControlCap.readbackStatus', 'unavailable'],
      ['authorityShared', true],
      ['legacyLogicalEventCount', 7],
      ['finalizedEventCount', 1],
      ['zeroHistoryTrustedClear', true],
    ];
    for (const [field, expected] of exactValues) {
      if (nestedValue(parentFinalization, field) !== expected) invalidParent(field);
    }
    for (const field of [
      'gasUsedMist', 'gasComputationCostMist', 'gasStorageCostMist',
      'gasStorageRebateMist', 'gasNonRefundableStorageFeeMist',
    ]) {
      if (present(parentFinalization[field])
        && (!/^\d+$/.test(String(parentFinalization[field])))) invalidParent(field);
    }
    if ([
      parentFinalization.gasUsedMist,
      parentFinalization.gasComputationCostMist,
      parentFinalization.gasStorageCostMist,
      parentFinalization.gasStorageRebateMist,
    ].every(present)) {
      const net = BigInt(parentFinalization.gasComputationCostMist)
        + BigInt(parentFinalization.gasStorageCostMist)
        - BigInt(parentFinalization.gasStorageRebateMist);
      if (net !== BigInt(parentFinalization.gasUsedMist)) invalidParent('gasUsedMist');
    }
  }
  if (activationDeclared || activationRequired) {
    const invalidActivation = (field) => deploymentInvalid.push(
      `releases.expansionPackV8.activation.${field}`,
    );
    if (activation.schemaVersion !== 'animacraft.expansion-pack-v8-activation-evidence.v1') {
      invalidActivation('schemaVersion');
    }
    const activationIds = [
      'releaseId', 'adminCapId', 'treasuryId', 'creator', 'parentRootId',
      'parentLegacyMakerId', 'admittedBy', 'walrus.blobObjectId',
    ];
    for (const field of activationIds) {
      const value = nestedValue(activation, field);
      if (present(value) && !validSuiId(value)) invalidActivation(field);
    }
    for (const field of [
      'transactionDigest', 'checkpointDigest', 'releaseObjectDigest',
      'adminCapObjectDigest', 'treasuryObjectDigest', 'walrus.blobObjectDigest',
    ]) {
      if (present(nestedValue(activation, field))
        && !SUI_TRANSACTION_DIGEST.test(String(nestedValue(activation, field)))) {
        invalidActivation(field);
      }
    }
    for (const field of [
      'checkpoint', 'activatedAtMs', 'releaseObjectVersion', 'adminCapObjectVersion',
      'treasuryObjectVersion', 'walrus.blobObjectVersion', 'walrus.registeredEpoch',
      'walrus.certifiedEpoch', 'walrus.storageStartEpoch', 'walrus.storageEndEpoch',
    ]) {
      if (present(nestedValue(activation, field))
        && !positiveInteger(nestedValue(activation, field))) invalidActivation(field);
    }
    for (const field of [
      'manifestSha256', 'contentCommitment', 'styleRegistryCommitment',
      'style.assetSha256', 'receiptEvidence.fileSha256',
      'receiptEvidence.contentSha256', 'readbackEvidence.fileSha256',
    ]) {
      if (present(nestedValue(activation, field))
        && !SHA256.test(String(nestedValue(activation, field)))) invalidActivation(field);
    }
    const activationExact = [
      ['status', 'success'],
      ['chainIdentifier', parentFinalization.chainIdentifier],
      ['releaseId', '0x8c2af3a0c7eb4bfe88bf5ed9e7b56cb407edae12f672a3331a09e41d046e071b'],
      ['adminCapId', '0x04d453148397779bc881ec25202cf0a1c881b04f673417deb1a25ee3e5626098'],
      ['treasuryId', '0x34a053862bf758074bfecf39150a09b5013f06e3546396dc08cef18708dbf001'],
      ['packId', 'astral-courier-quiet-orbit-v8-test'],
      ['namespace', 'quiet-orbit-v8'],
      ['version', '1.0.0'],
      ['creator', parentFinalization.owner],
      ['parentRootId', parentFinalization.rootId],
      ['parentLegacyMakerId', parentFinalization.legacyMakerId],
      ['admittedBy', parentFinalization.owner],
      ['admittedParentOwnershipEpoch', parentFinalization.ownershipEpoch],
      ['accessMode', 'FREE'],
      ['accessKind', 0],
      ['purchasePriceAtomic', '0'],
      ['lifecycle', 'ACTIVE'],
      ['lifecycleCode', 3],
      ['manifestBlobId', 'We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWE'],
      ['manifestSha256', '036b8806d432a688d763b9668574cfddfa2ac765af54366844e787171be5a15c'],
      ['contentCommitment', 'c517e3dcc7bd840604fa56f2fa0286fccc1a45d8924a3dd504b703391ff0a673'],
      ['styleRegistryCommitment', '0a6f411a79ce3431087217b32247326c002ed05cec4e78fccfbea09ee97b6e9e'],
      ['styleCount', 1],
      ['entitlementCount', 0],
      ['passCountForTestWallet', 0],
      ['sealPolicyId', ''],
      ['sealPackageId', ''],
      ['sealReleaseCommitment', ''],
      ['treasuryBalanceAtomic', '0'],
      ['treasuryTotalCollectedAtomic', '0'],
      ['treasuryTotalWithdrawnAtomic', '0'],
      ['style.partKey', 'background'],
      ['style.itemKey', 'background-default'],
      ['style.styleKey', 'quiet-orbit-style'],
      ['style.assetBlobId', 'We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWEBBwBoAg'],
      ['style.assetSha256', '11bd408b5f96a4a32c48d86fefa1e98204f72df8bcc03c8ec9566369e29cc28e'],
      ['style.assetSealId', ''],
      ['walrus.blobObjectId', '0x425f023e44b015f24eba8f186bf737b45dc710696c5f3d7745e26e476a315161'],
      ['walrus.deletable', false],
      ['walrus.manifestPatchId', 'We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWEBAQAHAA'],
      ['walrus.assetPatchId', 'We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWEBBwBoAg'],
      ['receiptEvidence.fileSha256', '4380b0708f64570e789ece49a96f732515ec49c23a4cb436993789413a96ef96'],
      ['receiptEvidence.contentSha256', '078c15e59c3b594c448271f21d5829feb2a4de35df2d6b75d9a6d79c50fcf10f'],
      ['readbackEvidence.fileSha256', '1033348b92de24a81801dcb257fd6eee3920ef412e16c2cf9a474cab3d25fa6a'],
    ];
    for (const [field, expected] of activationExact) {
      if (nestedValue(activation, field) !== expected) invalidActivation(field);
    }
    const expectedFiles = [
      {
        identifier: 'animacraft-expansion-pack-manifest.json',
        patchId: activation.walrus?.manifestPatchId,
        byteLength: 3721,
        sha256: activation.manifestSha256,
      },
      {
        identifier: 'assets/quiet-orbit.png',
        patchId: activation.walrus?.assetPatchId,
        byteLength: 406546,
        sha256: activation.style?.assetSha256,
      },
    ];
    if (JSON.stringify(activation.walrus?.files) !== JSON.stringify(expectedFiles)) {
      invalidActivation('walrus.files');
    }
    if (present(activation.checkpoint) && present(parentFinalization.checkpoint)
      && BigInt(activation.checkpoint) <= BigInt(parentFinalization.checkpoint)) {
      invalidActivation('checkpoint');
    }
    if (present(activation.checkpoint) && present(deployment.observedChainState?.observedThroughCheckpoint)
      && BigInt(deployment.observedChainState.observedThroughCheckpoint) < BigInt(activation.checkpoint)) {
      invalidActivation('checkpoint');
    }
    if (present(activation.walrus?.registeredEpoch)
      && present(activation.walrus?.certifiedEpoch)
      && Number(activation.walrus.certifiedEpoch) < Number(activation.walrus.registeredEpoch)) {
      invalidActivation('walrus.certifiedEpoch');
    }
    if (present(activation.walrus?.storageStartEpoch)
      && present(activation.walrus?.storageEndEpoch)
      && Number(activation.walrus.storageEndEpoch) <= Number(activation.walrus.storageStartEpoch)) {
      invalidActivation('walrus.storageEndEpoch');
    }
    for (const [field, expected] of [
      ['expansionPackV8ActivationTransactionStatus', 'success'],
      ['expansionPackV8ActivationReadBack', true],
      ['expansionPackV8ReleaseActive', true],
      ['expansionPackV8ReleaseFree', true],
      ['expansionPackV8AdminCapReadBack', true],
      ['expansionPackV8TreasuryReadBack', true],
      ['expansionPackV8StyleReadBack', true],
      ['expansionPackV8ManifestReadBack', true],
      ['expansionPackV8WalrusCertified', true],
      ['expansionPackV8NoSealPolicy', true],
      ['expansionPackV8ObjectsCreated', 3],
      ['expansionPackV8MoveEventsObserved', 8],
      ['expansionPackV8SealWritesObserved', false],
      ['expansionPackV8WalrusWritesObserved', true],
    ]) {
      if (verification[field] !== expected) deploymentInvalid.push(`verification.${field}`);
    }
  }
  if (postClaimDeclared || requirePostClaim) {
    const invalidPostClaim = (field) => deploymentInvalid.push(
      `releases.expansionPackV8.postClaim.${field}`,
    );
    if (postClaim.schemaVersion
      !== 'animacraft.expansion-pack-v8-post-claim-evidence.v1') {
      invalidPostClaim('schemaVersion');
    }
    for (const field of [
      'releaseId', 'walletAddress', 'passId', 'holder', 'parentRootId',
    ]) {
      const value = nestedValue(postClaim, field);
      if (present(value) && !validSuiId(value)) invalidPostClaim(field);
    }
    for (const field of [
      'transactionDigest', 'checkpointDigest', 'releaseObjectDigest',
      'passObjectDigest',
    ]) {
      const value = nestedValue(postClaim, field);
      if (present(value) && !SUI_TRANSACTION_DIGEST.test(String(value))) {
        invalidPostClaim(field);
      }
    }
    for (const field of [
      'checkpoint', 'claimedAtMs', 'releaseObjectVersion', 'entitlementCount',
      'passObjectVersion', 'issuedAtMs', 'createdPassCount',
      'entitlementEventCount', 'passCountForTestWallet',
    ]) {
      const value = nestedValue(postClaim, field);
      if (present(value) && !positiveInteger(value)) invalidPostClaim(field);
    }
    for (const field of [
      'contentCommitment', 'receiptEvidence.fileSha256',
      'receiptEvidence.contentSha256', 'readbackEvidence.fileSha256',
      'walletAcceptanceEvidence.fileSha256', 'renderEvidence.fileSha256',
      'renderEvidence.artifactSha256',
    ]) {
      const value = nestedValue(postClaim, field);
      if (present(value) && !SHA256.test(String(value))) invalidPostClaim(field);
    }
    const exactPostClaim = [
      ['status', 'success'],
      ['chainIdentifier', activation.chainIdentifier],
      ['releaseId', activation.releaseId],
      ['holder', postClaim.walletAddress],
      ['parentRootId', activation.parentRootId],
      ['paidAtomic', '0'],
      ['admittedParentOwnershipEpoch', activation.admittedParentOwnershipEpoch],
      ['contentCommitment', activation.contentCommitment],
      ['entitlementCount', 1],
      ['createdPassCount', 1],
      ['entitlementEventCount', 1],
      ['passCountForTestWallet', 1],
    ];
    for (const [field, expected] of exactPostClaim) {
      if (nestedValue(postClaim, field) !== expected) invalidPostClaim(field);
    }
    if (present(postClaim.claimedAtMs) && present(postClaim.issuedAtMs)
      && String(postClaim.claimedAtMs) !== String(postClaim.issuedAtMs)) {
      invalidPostClaim('issuedAtMs');
    }
    if (present(postClaim.claimedAtMs) && present(postClaim.claimedAtUtc)) {
      let expectedUtc = '';
      try {
        expectedUtc = new Date(Number(postClaim.claimedAtMs)).toISOString();
      } catch {
        expectedUtc = '';
      }
      if (expectedUtc !== postClaim.claimedAtUtc) invalidPostClaim('claimedAtUtc');
    }
    if (present(postClaim.checkpoint) && present(activation.checkpoint)
      && BigInt(postClaim.checkpoint) <= BigInt(activation.checkpoint)) {
      invalidPostClaim('checkpoint');
    }
    if (present(postClaim.releaseObjectVersion)
      && present(activation.releaseObjectVersion)
      && BigInt(postClaim.releaseObjectVersion) <= BigInt(activation.releaseObjectVersion)) {
      invalidPostClaim('releaseObjectVersion');
    }
    if (present(postClaim.checkpoint)
      && present(deployment.observedChainState?.observedThroughCheckpoint)
      && BigInt(deployment.observedChainState.observedThroughCheckpoint)
        < BigInt(postClaim.checkpoint)) {
      invalidPostClaim('checkpoint');
    }
    for (const [field, expected] of [
      ['expansionPackV8FreeClaimTransactionStatus', 'success'],
      ['expansionPackV8FreeClaimReadBack', true],
      ['expansionPackV8FreeClaimPassReadBack', true],
      ['expansionPackV8FreeClaimEventReadBack', true],
      ['expansionPackV8FreeClaimCreatedPassCount', 1],
      ['expansionPackV8FreeClaimPaidAtomic', '0'],
      ['expansionPackV8WalletAcceptance', true],
      ['expansionPackV8RenderAcceptance', true],
    ]) {
      if (verification[field] !== expected) {
        deploymentInvalid.push(`verification.${field}`);
      }
    }
  }

  const mismatches = [];
  const compareId = (path, actual, expected) => {
    if (!present(actual) || !present(expected)) return;
    if (!validSuiId(actual) || !validSuiId(expected)) return;
    if (normalizeSuiAddress(String(actual)) !== normalizeSuiAddress(String(expected))) {
      mismatches.push(path);
    }
  };
  compareId(
    'expansionPackV8CallablePackageId',
    deployment.expansionPackV8CallablePackageId,
    config.expansionPackV8CallablePackageId,
  );
  compareId(
    'expansionPackV8TypeOriginPackageId',
    deployment.expansionPackV8TypeOriginPackageId,
    config.expansionPackV8TypeOriginPackageId,
  );
  compareId(
    'independentExtensionV5TypeOriginPackageId',
    deployment.independentExtensionV5TypeOriginPackageId,
    config.independentExtensionV5TypeOriginPackageId,
  );
  compareId(
    'legacyLogicalV5TypeOriginPackageId',
    deployment.legacyLogicalV5TypeOriginPackageId,
    config.legacyLogicalV5TypeOriginPackageId,
  );
  compareId(
    'independentExtensionAuthorityV5Id',
    deployment.independentExtensionAuthorityV5Id,
    config.independentExtensionAuthorityV5Id,
  );
  if (parentFinalizationDeclared) {
    compareId(
      'releases.expansionPackV8.parentFinalization.authorityId',
      parentFinalization.authorityId,
      config.independentExtensionAuthorityV5Id,
    );
    compareId(
      'releases.expansionPackV8.parentFinalization.authorityTypeOriginPackageId',
      parentFinalization.authorityTypeOriginPackageId,
      config.independentExtensionV5TypeOriginPackageId,
    );
    compareId(
      'releases.expansionPackV8.parentFinalization.protocolConfigId',
      parentFinalization.protocolConfigId,
      config.commerceProtocolConfigV5Id,
    );
    compareId(
      'releases.expansionPackV8.parentFinalization.protocolAdminCapId',
      parentFinalization.protocolAdminCapId,
      config.protocolFeeAdminCapId,
    );
    compareId(
      'releases.expansionPackV8.parentFinalization.owner',
      parentFinalization.owner,
      config.protocolFeeAdminCapOwner,
    );
    compareId(
      'releases.expansionPackV8.parentFinalization.authorityId:deployment',
      parentFinalization.authorityId,
      deployment.independentExtensionAuthorityV5Id,
    );
  }
  compareId(
    'releases.expansionPackV8.callablePackageId',
    release.callablePackageId,
    config.expansionPackV8CallablePackageId,
  );
  compareId(
    'releases.expansionPackV8.typeOriginPackageId',
    release.typeOriginPackageId,
    config.expansionPackV8TypeOriginPackageId,
  );
  compareId(
    'releases.expansionPackV8.independentExtensionV5TypeOriginPackageId',
    release.independentExtensionV5TypeOriginPackageId,
    config.independentExtensionV5TypeOriginPackageId,
  );
  compareId(
    'releases.expansionPackV8.legacyLogicalV5TypeOriginPackageId',
    release.legacyLogicalV5TypeOriginPackageId,
    config.legacyLogicalV5TypeOriginPackageId,
  );
  if (typeof deployment.expansionPackV8ReleaseEnabled === 'boolean'
    && typeof config.expansionPackV8ReleaseEnabled === 'boolean'
    && deployment.expansionPackV8ReleaseEnabled !== config.expansionPackV8ReleaseEnabled) {
    mismatches.push('expansionPackV8ReleaseEnabled');
  }
  if (typeof release.enabled === 'boolean'
    && typeof config.expansionPackV8ReleaseEnabled === 'boolean'
    && release.enabled !== config.expansionPackV8ReleaseEnabled) {
    mismatches.push('releases.expansionPackV8.enabled');
  }
  if (typeof verification.expansionPackV8Enabled === 'boolean'
    && typeof config.expansionPackV8ReleaseEnabled === 'boolean'
    && verification.expansionPackV8Enabled !== config.expansionPackV8ReleaseEnabled) {
    mismatches.push('verification.expansionPackV8Enabled');
  }
  const evidenceComparisons = [
    ['releases.expansionPackV8.upgradeTxDigest', release.upgradeTxDigest, deployment.upgradeTxDigest],
    ['releases.expansionPackV8.upgradeCheckpoint', release.upgradeCheckpoint, deployment.upgradeCheckpoint],
    ['releases.expansionPackV8.upgradedAtMs', release.upgradedAtMs, deployment.upgradedAtMs],
    ['releases.expansionPackV8.sourceCommit', release.sourceCommit, deployment.source?.sourceCommit],
    ['releases.expansionPackV8.sourceTree', release.sourceTree, deployment.source?.sourceTree],
    ['releases.expansionPackV8.packageDigest', release.packageDigest, verification.packageDigest],
  ];
  evidenceComparisons.forEach(([path, releaseValue, canonicalValue]) => {
    if (present(releaseValue) && present(canonicalValue)
      && String(releaseValue) !== String(canonicalValue)) {
      mismatches.push(path);
    }
  });

  return {
    declared: true,
    ready: runtimeMissing.length === 0
      && runtimeInvalid.length === 0
      && deploymentMissing.length === 0
      && deploymentInvalid.length === 0
      && mismatches.length === 0,
    runtimeMissing,
    runtimeInvalid,
    deploymentMissing,
    deploymentInvalid,
    mismatches,
  };
}

export async function inspectExpansionPackV8ParentFinalizationEvidence(deployment = {}) {
  const evidence = deployment.releases?.expansionPackV8?.parentFinalization || {};
  const failures = [];
  const failEvidence = (message) => failures.push(message);
  const relativePath = String(evidence.publicEvidencePath || '');
  const canonicalPublicEvidencePath =
    'deployments/expansion-pack-v8-parent-finalization-public-evidence.json';
  if (relativePath !== canonicalPublicEvidencePath) {
    failEvidence('public parent-finalization evidence path mismatch');
  }
  let result;
  let bytes;
  if (relativePath === canonicalPublicEvidencePath) {
    try {
      const resultUrl = new URL(relativePath, new URL('../', import.meta.url));
      bytes = await readFile(resultUrl);
      result = JSON.parse(bytes);
    } catch (error) {
      failEvidence(`public parent-finalization evidence unavailable: ${error.message}`);
    }
  }
  if (bytes) {
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== evidence.publicEvidenceSha256) {
      failEvidence('public parent-finalization evidence SHA-256 mismatch');
    }
  }
  if (result) {
    const forbiddenFields = [];
    const inspectPublicFields = (value, path = []) => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => inspectPublicFields(entry, [...path, String(index)]));
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (/signature|signed|raw.?tx|bytes|bcs|certificate|token|secret|private|mnemonic|keypair/i.test(key)) {
          forbiddenFields.push(nextPath.join('.'));
        }
        inspectPublicFields(entry, nextPath);
      }
    };
    inspectPublicFields(result);
    if (forbiddenFields.length) {
      failEvidence(`public evidence contains forbidden operational fields: ${forbiddenFields.join(', ')}`);
    }
    const gas = result.finalized?.effects?.gasUsed || {};
    const expectedGas = {
      computationCost: evidence.gasComputationCostMist,
      storageCost: evidence.gasStorageCostMist,
      storageRebate: evidence.gasStorageRebateMist,
      nonRefundableStorageFee: evidence.gasNonRefundableStorageFeeMist,
    };
    const checks = [
      [result.schemaVersion,
        'animacraft.expansion-pack-v8-parent-finalization-public-evidence.v1', 'schema'],
      [result.stage, 'finalize', 'stage'],
      [result.transactionDigest, evidence.transactionDigest, 'transaction digest'],
      [result.checkpoint?.sequenceNumber, evidence.checkpoint, 'checkpoint'],
      [result.checkpoint?.digest, evidence.checkpointDigest, 'checkpoint digest'],
      [result.finalized?.effects?.status?.success, true, 'transaction status'],
      [result.postState?.root?.objectId, evidence.rootId, 'Root ID'],
      [result.postState?.root?.treasuryId, evidence.treasuryId, 'Treasury ID'],
      [result.postState?.root?.legacyMakerId, evidence.legacyMakerId, 'legacy Maker ID'],
      [result.postState?.root?.currentOwner, evidence.owner, 'Root owner'],
      [result.postState?.root?.protocolConfigId, evidence.protocolConfigId, 'protocol Config ID'],
      [result.postState?.root?.ownershipEpoch, evidence.ownershipEpoch, 'ownership epoch'],
      [result.postState?.root?.lifecycle, evidence.lifecycleCode, 'Root lifecycle'],
      [result.postState?.root?.styleRegistrySealed, true, 'registry sealed'],
      [result.postState?.root?.styleCount, String(evidence.styleCounts?.total), 'style count'],
      [result.postState?.root?.packCount, String(evidence.packCount), 'pack count'],
      [result.postState?.root?.activeListingId, evidence.activeListingId, 'active listing'],
      [result.postState?.root?.requiresSealPolicy, false, 'Seal requirement'],
      [result.postState?.root?.sealPolicyBound, false, 'Seal policy'],
      [result.postState?.makerTreasury?.balanceAtomic, evidence.treasuryBalanceAtomic, 'treasury balance'],
      [result.postState?.authority?.objectId, evidence.authorityId, 'Authority ID'],
      [result.postState?.authority?.protocolAdminCapId, evidence.protocolAdminCapId, 'protocol AdminCap'],
      [result.postState?.authority?.rootId, evidence.rootId, 'Authority Root'],
      [result.postState?.authority?.legacyMakerId, evidence.legacyMakerId, 'Authority legacy Maker'],
      [result.postState?.authority?.protocolConfigId, evidence.protocolConfigId, 'Authority protocol Config'],
      [result.postState?.authority?.owner, evidence.owner, 'Authority owner'],
      [result.postState?.authority?.retiredControlCapId, evidence.retiredControlCap?.id, 'Authority retired cap'],
      [result.postState?.authority?.retiredControlCapEpoch, evidence.retiredControlCapEpoch, 'Authority retired epoch'],
      [result.postState?.authority?.lockedOwnershipEpoch, evidence.ownershipEpoch, 'Authority locked epoch'],
      [result.postState?.authority?.auditHash?.replace(/^0x/, ''), evidence.auditHash, 'audit hash'],
      [result.postState?.lock?.finalized, true, 'Root lock finalized'],
      [result.postState?.lock?.rootId, evidence.rootId, 'lock Root'],
      [result.postState?.lock?.authorityId, evidence.authorityId, 'lock Authority'],
      [result.postState?.lock?.legacyMakerId, evidence.legacyMakerId, 'lock legacy Maker'],
      [result.postState?.lock?.protocolConfigId, evidence.protocolConfigId, 'lock protocol Config'],
      [result.postState?.lock?.protocolAdminCapId, evidence.protocolAdminCapId, 'lock protocol AdminCap'],
      [result.postState?.lock?.owner, evidence.owner, 'lock owner'],
      [result.postState?.lock?.retiredControlCapId, evidence.retiredControlCap?.id, 'lock retired cap'],
      [result.postState?.lock?.retiredControlCapEpoch, evidence.retiredControlCapEpoch, 'lock retired epoch'],
      [result.postState?.lock?.lockedOwnershipEpoch, evidence.ownershipEpoch, 'lock ownership epoch'],
      [result.postState?.lock?.auditHash?.replace(/^0x/, ''), evidence.auditHash, 'lock audit hash'],
      [result.postState?.retiredControlCap?.objectId, evidence.retiredControlCap?.id, 'retired cap ID'],
      [result.postState?.retiredControlCap?.deletionEffect?.idOperation, evidence.retiredControlCap?.deletionEffect, 'cap deletion effect'],
      [result.postState?.retiredControlCap?.status, evidence.retiredControlCap?.readbackStatus, 'cap readback'],
      [result.lockFingerprintSha256, evidence.lockFingerprintSha256, 'lock fingerprint'],
      [result.zeroHistoryContinuityEvidence?.trustedHistoryClear, true, 'zero-history continuation'],
      [result.zeroHistoryContinuityEvidence?.auditHash, evidence.zeroHistoryAuditHash, 'zero-history audit hash'],
      [result.zeroHistoryContinuityEvidence?.cutoff?.sequenceNumber, evidence.zeroHistoryCutoffCheckpoint, 'zero-history cutoff'],
      [result.zeroHistoryContinuityEvidence?.chainIdentifier, evidence.chainIdentifier, 'chain identifier'],
      [gas.computationCost, expectedGas.computationCost, 'gas computation'],
      [gas.storageCost, expectedGas.storageCost, 'gas storage'],
      [gas.storageRebate, expectedGas.storageRebate, 'gas rebate'],
      [gas.nonRefundableStorageFee, expectedGas.nonRefundableStorageFee, 'gas non-refundable fee'],
    ];
    checks.push(
      [result.source?.resultSha256, evidence.resultSha256, 'source result SHA-256'],
      [result.source?.lockEvidenceSha256, evidence.lockEvidenceSha256,
        'source lock evidence SHA-256'],
      [result.source?.lockFingerprintSha256, evidence.lockFingerprintSha256,
        'source lock fingerprint'],
    );
    for (const [actual, expected, label] of checks) {
      if (String(actual) !== String(expected)) failEvidence(`${label} mismatch`);
    }
    const rows = Array.isArray(result.postState?.styles) ? result.postState.styles : [];
    const rowCounts = rows.reduce((counts, row) => {
      const key = Number(row.rowKind);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    if (rowCounts[0] !== evidence.styleCounts?.visual
      || rowCounts[1] !== evidence.styleCounts?.logicalNone
      || rowCounts[2] !== evidence.styleCounts?.logicalColor
      || rows.length !== evidence.styleCounts?.total) {
      failEvidence('style split mismatch');
    }
  }
  return {
    ready: failures.length === 0,
    failures,
    detail: failures.length
      ? failures.join('; ')
      : 'Parent finalizer result hash, exact transaction, Root, Authority, lock, deleted ControlCap, 19/3/4 registry and zero-history continuation agree.',
  };
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => (
    [key, stableJsonValue(value[key])]
  )));
}

export async function inspectExpansionPackV8ActivationEvidence(deployment = {}, {
  required = false,
} = {}) {
  const activation = deployment.releases?.expansionPackV8?.activation;
  if (!activation || typeof activation !== 'object' || !Object.keys(activation).length) {
    return {
      declared: false,
      ready: !required,
      detail: required
        ? 'Expansion Pack v8 activation evidence is required when the product gate is enabled.'
        : 'No Expansion Pack v8 activation evidence is declared.',
      failures: required ? ['activation evidence is missing'] : [],
    };
  }
  const failures = [];
  let receipt;
  let readback;
  const loadEvidence = async (descriptor, label) => {
    try {
      const url = new URL(String(descriptor?.path || ''), new URL('../', import.meta.url));
      const bytes = await readFile(url);
      const fileSha256 = createHash('sha256').update(bytes).digest('hex');
      if (fileSha256 !== descriptor.fileSha256) failures.push(`${label} file SHA-256 mismatch`);
      return JSON.parse(bytes);
    } catch (error) {
      failures.push(`${label} unavailable: ${error.message}`);
      return null;
    }
  };
  [receipt, readback] = await Promise.all([
    loadEvidence(activation.receiptEvidence, 'ceremony receipt'),
    loadEvidence(activation.readbackEvidence, 'Mainnet readback'),
  ]);
  if (receipt) {
    const semantic = { ...receipt };
    delete semantic.receiptSha256;
    const contentSha256 = createHash('sha256')
      .update(JSON.stringify(stableJsonValue(semantic)))
      .digest('hex');
    const activate = receipt.actions?.find((entry) => entry.actionId === 'chain.pack.activate');
    for (const [actual, expected, label] of [
      [receipt.schemaVersion, 'animacraft.expansion-pack-v8-pack-ceremony-receipt.v1', 'receipt schema'],
      [receipt.receiptSha256, activation.receiptEvidence.contentSha256, 'receipt content SHA-256'],
      [contentSha256, activation.receiptEvidence.contentSha256, 'computed receipt content SHA-256'],
      [receipt.packReleaseId, activation.releaseId, 'receipt release'],
      [receipt.packAdminCapId, activation.adminCapId, 'receipt AdminCap'],
      [receipt.packTreasuryId, activation.treasuryId, 'receipt Treasury'],
      [receipt.transactionDigest, activation.transactionDigest, 'receipt activation transaction'],
      [receipt.manifestBlobId, activation.manifestBlobId, 'receipt manifest Quilt'],
      [receipt.manifestSha256, activation.manifestSha256, 'receipt manifest SHA-256'],
      [activate?.submissionDigest, activation.transactionDigest, 'receipt activation action'],
      [receipt.actualExpansionPackV8ReleaseEnabled, false, 'receipt product gate'],
      [receipt.freeOnly, true, 'receipt FREE-only claim'],
      [receipt.noSealPolicy, true, 'receipt no-Seal claim'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
  }
  if (readback) {
    const activate = readback.transactions?.find((entry) => entry.action === 'activate');
    for (const [actual, expected, label] of [
      [readback.schemaVersion, 'animacraft.expansion-pack-v8-mainnet-readback.v1', 'readback schema'],
      [readback.network?.chainIdentifier, activation.chainIdentifier, 'readback chain'],
      [readback.source?.receiptFileSha256, activation.receiptEvidence.fileSha256, 'readback receipt file SHA-256'],
      [readback.source?.receiptContentSha256, activation.receiptEvidence.contentSha256, 'readback receipt content SHA-256'],
      [readback.pack?.releaseId, activation.releaseId, 'readback release'],
      [readback.pack?.adminCapId, activation.adminCapId, 'readback AdminCap'],
      [readback.pack?.treasuryId, activation.treasuryId, 'readback Treasury'],
      [readback.pack?.accessMode, activation.accessMode, 'readback access mode'],
      [readback.pack?.lifecycle, activation.lifecycle, 'readback lifecycle'],
      [readback.pack?.manifestBlobId, activation.manifestBlobId, 'readback manifest Quilt'],
      [readback.pack?.manifestSha256, activation.manifestSha256, 'readback manifest SHA-256'],
      [readback.pack?.contentCommitment, activation.contentCommitment, 'readback content commitment'],
      [readback.pack?.styleRegistryCommitment, activation.styleRegistryCommitment, 'readback Style commitment'],
      [readback.pack?.style?.assetBlobId, activation.style?.assetBlobId, 'readback Style asset'],
      [readback.pack?.style?.assetSha256, activation.style?.assetSha256, 'readback Style SHA-256'],
      [readback.pack?.style?.assetSealId, '', 'readback Style Seal'],
      [readback.walrus?.blobObjectId, activation.walrus?.blobObjectId, 'readback Walrus Blob'],
      [activate?.digest, activation.transactionDigest, 'readback activation transaction'],
      [activate?.checkpoint, activation.checkpoint, 'readback activation checkpoint'],
      [readback.productGatesObserved?.expansionPackV8ReleaseEnabled, false, 'readback product gate'],
      [readback.readbackVerified, true, 'readback verification'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
  }
  return {
    declared: true,
    ready: failures.length === 0,
    detail: failures.length
      ? failures.join('; ')
      : 'Exact ceremony receipt bytes/semantic hash and Mainnet readback bind the ACTIVE FREE release, certified Walrus content, empty Seal tuple, and pre-activation false gate.',
    failures,
  };
}

export async function inspectExpansionPackV8PostClaimEvidence(deployment = {}, {
  required = false,
  loader,
} = {}) {
  const releaseRecord = deployment.releases?.expansionPackV8 || {};
  const activation = releaseRecord.activation || {};
  const postClaim = releaseRecord.postClaim;
  if (!postClaim || typeof postClaim !== 'object' || !Object.keys(postClaim).length) {
    return {
      declared: false,
      ready: !required,
      detail: required
        ? 'Expansion Pack v8 post-claim evidence is required.'
        : 'No Expansion Pack v8 post-claim evidence is declared.',
      failures: required ? ['post-claim evidence is missing'] : [],
    };
  }
  const failures = [];
  const defaultLoader = async (descriptor, { json: parseJson = true } = {}) => {
    const url = new URL(String(descriptor?.path || ''), new URL('../', import.meta.url));
    const bytes = await readFile(url);
    return { bytes, value: parseJson ? JSON.parse(bytes) : null };
  };
  const load = loader || defaultLoader;
  const loadEvidence = async (descriptor, label, options = {}) => {
    try {
      const loaded = await load(descriptor, options);
      const bytes = Buffer.from(loaded?.bytes || []);
      const fileSha256 = createHash('sha256').update(bytes).digest('hex');
      const expectedSha256 = options.artifact
        ? descriptor?.artifactSha256
        : descriptor?.fileSha256;
      if (fileSha256 !== expectedSha256) {
        failures.push(`${label} file SHA-256 mismatch`);
      }
      return loaded?.value ?? null;
    } catch (error) {
      failures.push(`${label} unavailable: ${error.message}`);
      return null;
    }
  };
  const [receipt, readback, walletAcceptance, render] = await Promise.all([
    loadEvidence(postClaim.receiptEvidence, 'claim receipt'),
    loadEvidence(postClaim.readbackEvidence, 'post-claim Mainnet readback'),
    loadEvidence(postClaim.walletAcceptanceEvidence, 'wallet acceptance'),
    loadEvidence(postClaim.renderEvidence, 'render evidence'),
  ]);
  if (receipt) {
    const semantic = { ...receipt };
    delete semantic.receiptSha256;
    const contentSha256 = createHash('sha256')
      .update(JSON.stringify(stableJsonValue(semantic)))
      .digest('hex');
    for (const [actual, expected, label] of [
      [receipt.schemaVersion, 'animacraft.expansion-pack-v8-free-claim-receipt.v1', 'claim receipt schema'],
      [receipt.status, 'success', 'claim receipt status'],
      [receipt.receiptSha256, postClaim.receiptEvidence.contentSha256, 'claim receipt content SHA-256'],
      [contentSha256, postClaim.receiptEvidence.contentSha256, 'computed claim receipt content SHA-256'],
      [receipt.chainIdentifier, postClaim.chainIdentifier, 'claim receipt chain'],
      [receipt.transactionDigest, postClaim.transactionDigest, 'claim receipt transaction'],
      [String(receipt.checkpoint), postClaim.checkpoint, 'claim receipt checkpoint'],
      [receipt.checkpointDigest, postClaim.checkpointDigest, 'claim receipt checkpoint digest'],
      [String(receipt.claimedAtMs), postClaim.claimedAtMs, 'claim receipt timestamp'],
      [receipt.releaseId, postClaim.releaseId, 'claim receipt release'],
      [String(receipt.releaseObjectVersion), postClaim.releaseObjectVersion, 'claim receipt Release version'],
      [receipt.releaseObjectDigest, postClaim.releaseObjectDigest, 'claim receipt Release digest'],
      [Number(receipt.entitlementCount), postClaim.entitlementCount, 'claim receipt entitlement count'],
      [receipt.walletAddress, postClaim.walletAddress, 'claim receipt wallet'],
      [receipt.passId, postClaim.passId, 'claim receipt Pass'],
      [String(receipt.passObjectVersion), postClaim.passObjectVersion, 'claim receipt Pass version'],
      [receipt.passObjectDigest, postClaim.passObjectDigest, 'claim receipt Pass digest'],
      [receipt.holder, postClaim.holder, 'claim receipt holder'],
      [receipt.parentRootId, postClaim.parentRootId, 'claim receipt parent Root'],
      [String(receipt.paidAtomic), postClaim.paidAtomic, 'claim receipt paid amount'],
      [String(receipt.issuedAtMs), postClaim.issuedAtMs, 'claim receipt issue time'],
      [String(receipt.admittedParentOwnershipEpoch), postClaim.admittedParentOwnershipEpoch, 'claim receipt parent epoch'],
      [receipt.contentCommitment, postClaim.contentCommitment, 'claim receipt content commitment'],
      [Number(receipt.createdPassCount), postClaim.createdPassCount, 'claim receipt created Pass count'],
      [Number(receipt.entitlementEventCount), postClaim.entitlementEventCount, 'claim receipt event count'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
  }
  if (readback) {
    for (const [actual, expected, label] of [
      [readback.schemaVersion, 'animacraft.expansion-pack-v8-post-claim-mainnet-readback.v1', 'post-claim readback schema'],
      [readback.network?.chainIdentifier, postClaim.chainIdentifier, 'post-claim readback chain'],
      [readback.source?.claimReceiptFileSha256, postClaim.receiptEvidence.fileSha256, 'post-claim receipt file SHA-256'],
      [readback.source?.claimReceiptContentSha256, postClaim.receiptEvidence.contentSha256, 'post-claim receipt content SHA-256'],
      [readback.claim?.transactionDigest, postClaim.transactionDigest, 'post-claim transaction'],
      [String(readback.claim?.checkpoint), postClaim.checkpoint, 'post-claim checkpoint'],
      [readback.claim?.checkpointDigest, postClaim.checkpointDigest, 'post-claim checkpoint digest'],
      [String(readback.claim?.claimedAtMs), postClaim.claimedAtMs, 'post-claim timestamp'],
      [Number(readback.claim?.createdPassCount), postClaim.createdPassCount, 'post-claim created Pass count'],
      [Number(readback.claim?.entitlementEventCount), postClaim.entitlementEventCount, 'post-claim event count'],
      [readback.release?.releaseId, postClaim.releaseId, 'post-claim Release'],
      [String(readback.release?.objectVersion), postClaim.releaseObjectVersion, 'post-claim Release version'],
      [readback.release?.objectDigest, postClaim.releaseObjectDigest, 'post-claim Release digest'],
      [Number(readback.release?.entitlementCount), postClaim.entitlementCount, 'post-claim entitlement count'],
      [readback.release?.lifecycle, activation.lifecycle, 'post-claim lifecycle'],
      [readback.release?.accessMode, activation.accessMode, 'post-claim access mode'],
      [readback.pass?.passId, postClaim.passId, 'post-claim Pass'],
      [String(readback.pass?.objectVersion), postClaim.passObjectVersion, 'post-claim Pass version'],
      [readback.pass?.objectDigest, postClaim.passObjectDigest, 'post-claim Pass digest'],
      [readback.pass?.holder, postClaim.holder, 'post-claim holder'],
      [readback.pass?.releaseId, postClaim.releaseId, 'post-claim Pass release'],
      [readback.pass?.parentRootId, postClaim.parentRootId, 'post-claim Pass parent'],
      [String(readback.pass?.paidAtomic), postClaim.paidAtomic, 'post-claim paid amount'],
      [String(readback.pass?.issuedAtMs), postClaim.issuedAtMs, 'post-claim issue time'],
      [String(readback.pass?.admittedParentOwnershipEpoch), postClaim.admittedParentOwnershipEpoch, 'post-claim parent epoch'],
      [readback.pass?.contentCommitment, postClaim.contentCommitment, 'post-claim content commitment'],
      [Number(readback.passCountForTestWallet), postClaim.passCountForTestWallet, 'post-claim wallet Pass count'],
      [readback.readbackVerified, true, 'post-claim readback verification'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
  }
  if (walletAcceptance) {
    for (const [actual, expected, label] of [
      [walletAcceptance.schemaVersion, 'animacraft.expansion-pack-v8-wallet-acceptance.v1', 'wallet acceptance schema'],
      [walletAcceptance.status, 'pass', 'wallet acceptance status'],
      [walletAcceptance.chainIdentifier, postClaim.chainIdentifier, 'wallet acceptance chain'],
      [walletAcceptance.releaseId, postClaim.releaseId, 'wallet acceptance release'],
      [walletAcceptance.walletAddress, postClaim.walletAddress, 'wallet acceptance wallet'],
      [walletAcceptance.passId, postClaim.passId, 'wallet acceptance Pass'],
      [walletAcceptance.transactionDigest, postClaim.transactionDigest, 'wallet acceptance transaction'],
      [walletAcceptance.contentCommitment, postClaim.contentCommitment, 'wallet acceptance commitment'],
      [walletAcceptance.passVisible, true, 'wallet acceptance Pass visibility'],
      [walletAcceptance.packAccessible, true, 'wallet acceptance Pack access'],
      [walletAcceptance.existingPassReused, true, 'wallet acceptance duplicate-signature guard'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
  }
  if (render) {
    for (const [actual, expected, label] of [
      [render.schemaVersion, 'animacraft.expansion-pack-v8-render-evidence.v1', 'render evidence schema'],
      [render.status, 'pass', 'render evidence status'],
      [render.releaseId, postClaim.releaseId, 'render evidence release'],
      [render.walletAddress, postClaim.walletAddress, 'render evidence wallet'],
      [render.passId, postClaim.passId, 'render evidence Pass'],
      [render.contentCommitment, postClaim.contentCommitment, 'render evidence commitment'],
      [render.partKey, activation.style?.partKey, 'render evidence Part'],
      [render.itemKey, activation.style?.itemKey, 'render evidence Item'],
      [render.styleKey, activation.style?.styleKey, 'render evidence Style'],
      [render.assetSha256, activation.style?.assetSha256, 'render evidence asset'],
      [render.artifactPath, postClaim.renderEvidence.artifactPath, 'render artifact path'],
      [render.artifactSha256, postClaim.renderEvidence.artifactSha256, 'render artifact SHA-256'],
      [render.assetLoaded, true, 'render asset load'],
      [render.sceneRendered, true, 'render scene status'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
    await loadEvidence({
      path: postClaim.renderEvidence.artifactPath,
      artifactSha256: postClaim.renderEvidence.artifactSha256,
    }, 'render artifact', { json: false, artifact: true });
  }
  return {
    declared: true,
    ready: failures.length === 0,
    detail: failures.length
      ? failures.join('; ')
      : 'Claim receipt, post-claim Mainnet readback, wallet acceptance and render artifact bind the exact FREE claim, mutable Release, wallet-owned Pass and accepted Style.',
    failures,
  };
}

function transactionEnvelope(value) {
  return value?.response?.transaction
    || value?.Transaction
    || value?.FailedTransaction
    || value?.transaction
    || value;
}

function protobufJsonValue(value) {
  const kind = value?.kind;
  if (!kind?.oneofKind) return value;
  switch (kind.oneofKind) {
    case 'nullValue': return null;
    case 'numberValue': return kind.numberValue;
    case 'stringValue': return kind.stringValue;
    case 'boolValue': return kind.boolValue;
    case 'listValue': return kind.listValue.values.map(protobufJsonValue);
    case 'structValue': return Object.fromEntries(Object.entries(kind.structValue.fields)
      .map(([key, entry]) => [key, protobufJsonValue(entry)]));
    default: return undefined;
  }
}

function transactionEventJson(event) {
  const json = event?.parsedJson || event?.parsed_json || event?.json || event?.contents?.json;
  return protobufJsonValue(json) || {};
}

export async function inspectExpansionPackV8LiveActivation(
  client,
  config,
  deployment,
  { fetchImpl = fetch, readers = {} } = {},
) {
  const activation = deployment.releases?.expansionPackV8?.activation || {};
  const postClaim = deployment.releases?.expansionPackV8?.postClaim || {};
  const postClaimDeclared = Boolean(Object.keys(postClaim).length);
  const currentReleaseEvidence = postClaimDeclared ? postClaim : activation;
  const failures = [];
  const core = client?.core || client;
  const readObjects = readers.objects || (async () => {
    const response = await core.getObjects({
      objectIds: [
        activation.releaseId,
        activation.adminCapId,
        activation.treasuryId,
        ...(postClaimDeclared ? [postClaim.passId] : []),
      ],
      include: { json: true, owner: true },
    });
    const objects = response.objects || [];
    const expectedCount = postClaimDeclared ? 4 : 3;
    if (objects.length !== expectedCount || objects.some((value) => (
      !value || value instanceof Error || value.error || value.$kind === 'Error'
    ))) throw new Error('Release, AdminCap, Treasury or declared Pass is unavailable.');
    return {
      release: parseExpansionPackReleaseV8(objects[0], { runtime: config }),
      adminCap: parseExpansionPackAdminCapV8(objects[1], { runtime: config }),
      treasury: parseExpansionPackTreasuryV8(objects[2], {
        runtime: config,
        paymentCoinType: config.paymentCoinType,
      }),
      pass: postClaimDeclared
        ? parseExpansionPackPassV8(objects[3], { runtime: config })
        : null,
      raw: objects,
    };
  });
  try {
    const { release, adminCap, treasury, pass, raw = [] } = await readObjects();
    const checks = [
      [release.objectId, activation.releaseId, 'Release ID'],
      [release.adminCapId, activation.adminCapId, 'Release AdminCap'],
      [release.treasuryId, activation.treasuryId, 'Release Treasury'],
      [release.creator, activation.creator, 'Release creator'],
      [release.parentRootId, activation.parentRootId, 'Release parent Root'],
      [release.parentLegacyMakerId, activation.parentLegacyMakerId, 'Release parent Maker'],
      [release.admittedBy, activation.admittedBy, 'Release admission wallet'],
      [String(release.admittedParentOwnershipEpoch), activation.admittedParentOwnershipEpoch, 'Release admission epoch'],
      [release.packId, activation.packId, 'Pack ID'],
      [release.namespace, activation.namespace, 'Pack namespace'],
      [release.packVersion, activation.version, 'Pack version'],
      [release.accessKind, EXPANSION_PACK_V8_ACCESS.FREE, 'FREE access'],
      [String(release.purchasePriceAtomic), activation.purchasePriceAtomic, 'Pack price'],
      [release.lifecycle, EXPANSION_PACK_V8_LIFECYCLE.ACTIVE, 'ACTIVE lifecycle'],
      [release.manifestBlobId, activation.manifestBlobId, 'Manifest Quilt'],
      [release.manifestSha256, activation.manifestSha256, 'Manifest SHA-256'],
      [release.contentCommitment, activation.contentCommitment, 'Content commitment'],
      [release.styleRegistryCommitment, activation.styleRegistryCommitment, 'Style commitment'],
      [String(release.styleCount), String(activation.styleCount), 'Style count'],
      [String(release.entitlementCount), String(currentReleaseEvidence.entitlementCount), 'Entitlement count'],
      [release.sealPolicyId, '', 'Seal policy'],
      [release.sealPackageId, '', 'Seal package'],
      [release.sealReleaseCommitment, '', 'Seal commitment'],
      [adminCap.objectId, activation.adminCapId, 'AdminCap ID'],
      [adminCap.releaseId, activation.releaseId, 'AdminCap release'],
      [adminCap.creator, activation.creator, 'AdminCap creator'],
      [adminCap.owner, activation.creator, 'AdminCap owner'],
      [treasury.objectId, activation.treasuryId, 'Treasury ID'],
      [treasury.releaseId, activation.releaseId, 'Treasury release'],
      [String(treasury.balanceAtomic), activation.treasuryBalanceAtomic, 'Treasury balance'],
      [String(treasury.totalCollectedAtomic), activation.treasuryTotalCollectedAtomic, 'Treasury collected'],
      [String(treasury.totalWithdrawnAtomic), activation.treasuryTotalWithdrawnAtomic, 'Treasury withdrawn'],
    ];
    for (const [actual, expected, label] of checks) {
      if (actual !== expected) failures.push(`${label} mismatch`);
    }
    const rawChecks = [
      [raw[0]?.version, currentReleaseEvidence.releaseObjectVersion, 'Release object version'],
      [raw[0]?.digest, currentReleaseEvidence.releaseObjectDigest, 'Release object digest'],
      [raw[1]?.version, activation.adminCapObjectVersion, 'AdminCap object version'],
      [raw[1]?.digest, activation.adminCapObjectDigest, 'AdminCap object digest'],
      [raw[2]?.version, activation.treasuryObjectVersion, 'Treasury object version'],
      [raw[2]?.digest, activation.treasuryObjectDigest, 'Treasury object digest'],
    ];
    for (const [actual, expected, label] of rawChecks) {
      if (actual != null && String(actual) !== expected) failures.push(`${label} mismatch`);
    }
    if (postClaimDeclared) {
      for (const [actual, expected, label] of [
        [pass?.objectId, postClaim.passId, 'Pass ID'],
        [pass?.releaseId, postClaim.releaseId, 'Pass release'],
        [pass?.parentRootId, postClaim.parentRootId, 'Pass parent Root'],
        [pass?.holder, postClaim.holder, 'Pass holder'],
        [String(pass?.paidAtomic), postClaim.paidAtomic, 'Pass paid amount'],
        [String(pass?.issuedAtMs), postClaim.issuedAtMs, 'Pass issue time'],
        [String(pass?.admittedParentOwnershipEpoch), postClaim.admittedParentOwnershipEpoch, 'Pass parent epoch'],
        [pass?.contentCommitment, postClaim.contentCommitment, 'Pass content commitment'],
        [raw[3]?.version, postClaim.passObjectVersion, 'Pass object version'],
        [raw[3]?.digest, postClaim.passObjectDigest, 'Pass object digest'],
      ]) {
        if (actual == null || String(actual) !== String(expected)) failures.push(`${label} mismatch`);
      }
    }
    const readStyles = readers.styles || (() => queryExpansionPackStyleRecordsV8(core, {
      runtime: config,
      release,
      styles: [activation.style],
    }));
    const styles = await readStyles(release);
    if (styles.length !== 1) failures.push('Style count mismatch');
    for (const field of ['partKey', 'itemKey', 'styleKey', 'assetBlobId', 'assetSha256', 'assetSealId']) {
      if (styles[0]?.[field] !== activation.style[field]) failures.push(`Style ${field} mismatch`);
    }
  } catch (error) {
    failures.push(`Pack object readback failed: ${error.message}`);
  }
  try {
    const readTransaction = readers.transaction || (async () => {
      if (!client?.ledgerService?.getTransaction) {
        throw new Error('Sui LedgerService transaction reader is unavailable.');
      }
      return client.ledgerService.getTransaction({
        digest: activation.transactionDigest,
        readMask: { paths: ['digest', 'effects.status', 'events', 'checkpoint'] },
      });
    });
    const transaction = transactionEnvelope(await readTransaction());
    const successful = transaction?.effects?.status?.success === true
      || String(transaction?.effects?.status?.status || transaction?.effects?.status || '').toLowerCase() === 'success';
    const events = Array.isArray(transaction?.events)
      ? transaction.events
      : (transaction?.events?.events || []);
    const expectedLifecycleType = normalizeStructTag(
      `${config.expansionPackV8TypeOriginPackageId}`
      + '::expansion_pack_v8::ExpansionPackLifecycleChangedV8',
    );
    const lifecycleEvents = events.filter((event) => {
      try {
        return normalizeStructTag(String(
          event?.eventType || event?.type || event?.event_type || event?.contents?.type?.repr || '',
        )) === expectedLifecycleType;
      } catch {
        return false;
      }
    });
    const lifecycle = transactionEventJson(lifecycleEvents[0]);
    let releaseMatches = false;
    try {
      releaseMatches = normalizeSuiAddress(String(lifecycle.release_id || lifecycle.releaseId || ''))
        === normalizeSuiAddress(activation.releaseId);
    } catch {
      releaseMatches = false;
    }
    if (String(transaction?.digest || '') !== activation.transactionDigest
      || String(transaction?.checkpoint || transaction?.checkpointSequenceNumber || '') !== activation.checkpoint
      || !successful
      || lifecycleEvents.length !== 1
      || !releaseMatches
      || Number(lifecycle.previous_lifecycle ?? lifecycle.previousLifecycle) !== EXPANSION_PACK_V8_LIFECYCLE.ADMITTED
      || Number(lifecycle.lifecycle) !== EXPANSION_PACK_V8_LIFECYCLE.ACTIVE) {
      failures.push('Activation transaction mismatch');
    }
  } catch (error) {
    failures.push(`Activation transaction readback failed: ${error.message}`);
  }
  if (postClaimDeclared) {
    try {
      const readClaimTransaction = readers.claimTransaction || (async () => {
        if (!core?.getTransaction) {
          throw new Error('Sui Core transaction reader is unavailable.');
        }
        return core.getTransaction({
          digest: postClaim.transactionDigest,
          include: { effects: true, events: true, objectTypes: true },
        });
      });
      const transaction = transactionEnvelope(await readClaimTransaction());
      const successful = transaction?.effects?.status?.success === true
        || String(transaction?.effects?.status?.status
          || transaction?.effects?.status || '').toLowerCase() === 'success';
      const events = Array.isArray(transaction?.events)
        ? transaction.events
        : (transaction?.events?.events || []);
      const expectedEventType = normalizeStructTag(
        `${config.expansionPackV8TypeOriginPackageId}`
        + '::expansion_pack_v8::ExpansionPackEntitlementGrantedV8',
      );
      const entitlementEvents = events.filter((event) => {
        try {
          return normalizeStructTag(String(
            event?.eventType || event?.type || event?.event_type
              || event?.contents?.type?.repr || '',
          )) === expectedEventType;
        } catch {
          return false;
        }
      });
      const entitlement = transactionEventJson(entitlementEvents[0]);
      const expectedPassType = normalizeStructTag(
        `${config.expansionPackV8TypeOriginPackageId}`
        + '::expansion_pack_v8::ExpansionPackPassV8',
      );
      const passTypeIds = Object.entries(
        transaction?.objectTypes || transaction?.object_types || {},
      ).filter(([, type]) => {
        try {
          return normalizeStructTag(String(type)) === expectedPassType;
        } catch {
          return false;
        }
      }).map(([id]) => normalizeSuiAddress(id));
      const createdPasses = (transaction?.effects?.changedObjects || []).filter((change) => {
        try {
          return String(change?.idOperation || '').toLowerCase() === 'created'
            && passTypeIds.includes(normalizeSuiAddress(String(change?.objectId || '')));
        } catch {
          return false;
        }
      });
      const normalizeEventId = (value) => {
        try {
          return normalizeSuiAddress(String(value?.id || value?.bytes || value || ''));
        } catch {
          return '';
        }
      };
      if (String(transaction?.digest || '') !== postClaim.transactionDigest
        || String(transaction?.checkpoint || transaction?.checkpointSequenceNumber || '')
          !== postClaim.checkpoint
        || !successful
        || entitlementEvents.length !== 1
        || createdPasses.length !== 1
        || passTypeIds.length !== 1
        || normalizeEventId(entitlement.release_id || entitlement.releaseId)
          !== normalizeSuiAddress(postClaim.releaseId)
        || normalizeEventId(entitlement.parent_root_id || entitlement.parentRootId)
          !== normalizeSuiAddress(postClaim.parentRootId)
        || normalizeEventId(entitlement.pass_id || entitlement.passId)
          !== normalizeSuiAddress(postClaim.passId)
        || normalizeEventId(entitlement.holder) !== normalizeSuiAddress(postClaim.holder)
        || String(entitlement.paid_atomic ?? entitlement.paidAtomic) !== postClaim.paidAtomic
        || String(entitlement.admitted_parent_ownership_epoch
          ?? entitlement.admittedParentOwnershipEpoch)
          !== postClaim.admittedParentOwnershipEpoch
        || normalizeSuiAddress(createdPasses[0]?.objectId) !== normalizeSuiAddress(postClaim.passId)) {
        failures.push('Post-claim transaction mismatch');
      }
    } catch (error) {
      failures.push(`Post-claim transaction readback failed: ${error.message}`);
    }
  }
  try {
    const readBlob = readers.blob || (async () => {
      const walrusClient = client.$extend(walrus());
      await walrusClient.walrus.reset();
      return walrusClient.walrus.getBlobObject(activation.walrus.blobObjectId);
    });
    const blob = await readBlob();
    for (const [actual, expected, label] of [
      [String(blob?.id || ''), activation.walrus.blobObjectId, 'Walrus Blob object'],
      [String(blob?.certified_epoch ?? ''), String(activation.walrus.certifiedEpoch), 'Walrus certified epoch'],
      [String(blob?.registered_epoch ?? ''), String(activation.walrus.registeredEpoch), 'Walrus registered epoch'],
      [Boolean(blob?.deletable), false, 'Walrus deletable flag'],
    ]) if (actual !== expected) failures.push(`${label} mismatch`);
  } catch (error) {
    failures.push(`Walrus Blob readback failed: ${error.message}`);
  }
  for (const file of activation.walrus?.files || []) {
    try {
      const response = await fetchImpl(
        `${config.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-patch-id/${file.patchId}`,
        { cache: 'no-store' },
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (!response.ok || bytes.byteLength !== file.byteLength || digest !== file.sha256) {
        failures.push(`Walrus file ${file.identifier} bytes mismatch`);
      }
    } catch (error) {
      failures.push(`Walrus file ${file.identifier} readback failed: ${error.message}`);
    }
  }
  return {
    ready: failures.length === 0,
    detail: failures.length
      ? failures.join('; ')
      : postClaimDeclared
        ? 'ACTIVE FREE Release/AdminCap/Treasury/Style, exact activation and claim transactions, mutable Release, wallet-owned Pass, certified Blob, and manifest/asset bytes read back live.'
        : 'ACTIVE FREE Release/AdminCap/Treasury/Style, exact activation transaction, certified Blob, and manifest/asset bytes read back live.',
    failures,
  };
}

function normalizeDeploymentValue(field, value) {
  if (field === 'compositionValidatorEpochV6') {
    const epoch = Number(value);
    return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
  }
  if (field === 'compositionValidatorPolicyCommitmentV6') {
    return normalizeBytes32(value);
  }
  if (field === 'compositionV6SoulOwnerProofType' || field === 'paymentCoinType') {
    try {
      return normalizeStructTag(String(value || ''));
    } catch {
      return '';
    }
  }
  try {
    const normalized = normalizeSuiAddress(String(value || ''));
    return normalized === ZERO_SUI_ADDRESS ? '' : normalized;
  } catch {
    return '';
  }
}

export function inspectCompositionV6Deployment(
  config = {},
  deployment = {},
  { required = false } = {},
) {
  const declared = required || compositionV6Declared(config);
  if (!declared) {
    return {
      declared: false,
      ready: true,
      runtimeMissing: [],
      runtimeInvalid: [],
      deploymentMissing: [],
      mismatches: [],
    };
  }
  const bindingDeclared = config.compositionV6ReleaseEnabled === true
    || COMPOSITION_V6_BINDING_RUNTIME_FIELDS.some((field) => present(config[field]));
  const requiredRuntimeFields = [
    ...COMPOSITION_V6_CORE_RUNTIME_FIELDS,
    ...COMPOSITION_V6_CORE_DEPENDENCY_FIELDS,
    ...(bindingDeclared
      ? [
        ...COMPOSITION_V6_BINDING_RUNTIME_FIELDS,
        ...COMPOSITION_V6_BINDING_DEPENDENCY_FIELDS,
      ]
      : []),
  ];
  const deploymentFields = ['callablePackageId', ...requiredRuntimeFields];
  const runtimeMissing = requiredRuntimeFields.filter((field) => (
    !present(config[field])
  ));
  const runtimeInvalid = [
    ...COMPOSITION_V6_CORE_RUNTIME_FIELDS,
    ...COMPOSITION_V6_BINDING_RUNTIME_FIELDS,
    ...COMPOSITION_V6_DEPENDENCY_FIELDS,
  ]
    .filter((field) => present(config[field]))
    .filter((field) => {
      if (field === 'compositionValidatorEpochV6') {
        const epoch = Number(config[field]);
        return !Number.isSafeInteger(epoch) || epoch < 0;
      }
      if (field === 'compositionValidatorPolicyCommitmentV6') {
        return !normalizeBytes32(config[field]);
      }
      if (field === 'compositionV6SoulOwnerProofType') {
        return !normalizeDeploymentValue(field, config[field]);
      }
      return !normalizeDeploymentValue(field, config[field]);
    });
  const deploymentMissing = deploymentFields.filter((field) => (
    !present(deployment[field])
  ));
  const mismatches = deploymentFields
    .filter((field) => !deploymentMissing.includes(field))
    .filter((field) => {
      const runtimeField = field === 'callablePackageId' ? 'callablePackageId' : field;
      if (!present(config[runtimeField])) return false;
      return normalizeDeploymentValue(field, deployment[field])
        !== normalizeDeploymentValue(runtimeField, config[runtimeField]);
    });
  return {
    declared: true,
    ready: runtimeMissing.length === 0
      && runtimeInvalid.length === 0
      && deploymentMissing.length === 0
      && mismatches.length === 0,
    runtimeMissing,
    runtimeInvalid,
    deploymentMissing,
    mismatches,
  };
}

function record(name, ok, detail) {
  checks.push({ name, ok, detail: String(detail || '') });
}

function moveDatatypeName(parameter) {
  return String(parameter?.body?.datatype?.typeName || '');
}

function moveTypeEndsWith(parameter, suffix) {
  return moveDatatypeName(parameter).endsWith(suffix);
}

function jsonField(value, ...names) {
  if (!value || typeof value !== 'object') return undefined;
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
}

function suiId(value) {
  if (typeof value === 'string') {
    try {
      return normalizeSuiAddress(value);
    } catch {
      return '';
    }
  }
  if (!value || typeof value !== 'object') return '';
  return suiId(value.id || value.bytes || value.address || value.fields);
}

function addressOwner(owner) {
  return suiId(owner?.AddressOwner || owner?.addressOwner || owner?.address || '');
}

function isSharedOwner(owner) {
  return owner?.$kind === 'Shared' || Boolean(owner?.Shared || owner?.shared);
}

function optionHasValue(value) {
  if (Array.isArray(value)) return value.length === 1;
  if (!value || typeof value !== 'object') return false;
  if (value.$kind === 'Some') return true;
  if (Object.hasOwn(value, 'Some')) return true;
  if (Array.isArray(value.vec)) return value.vec.length === 1;
  // Sui gRPC's Move JSON projection unwraps Option<T> when it contains a
  // single struct. The sealed package::Publisher therefore appears directly
  // as { id, module_name, package } instead of { vec: [...] }.
  if (value.id && value.module_name && value.package) return true;
  return false;
}

function optionValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  if (!value || typeof value !== 'object') return value;
  if (value.$kind === 'Some') return value.Some;
  if (Object.hasOwn(value, 'Some')) return value.Some;
  if (Array.isArray(value.vec)) return value.vec.length === 1
    ? value.vec[0]
    : undefined;
  return value;
}

async function moveFunctionInModule(client, packageId, moduleName, name) {
  const result = await client.core.getMoveFunction({
    packageId,
    moduleName,
    name,
  });
  if (!result.function) throw new Error(`${name} ABI is missing.`);
  return result.function;
}

async function moveFunction(client, packageId, name) {
  return moveFunctionInModule(client, packageId, 'animacraft', name);
}

async function moveDatatypeInModule(client, packageId, moduleName, name) {
  const { response } = await client.movePackageService.getDatatype({
    packageId,
    moduleName,
    name,
  });
  if (!response.datatype) throw new Error(`${name} datatype is missing.`);
  return response.datatype;
}

async function moveDatatype(client, packageId, name) {
  return moveDatatypeInModule(client, packageId, 'animacraft', name);
}

function datatypeHasTypeOrigin(datatype, packageId) {
  try {
    return normalizeSuiAddress(datatype.definingId)
      === normalizeSuiAddress(packageId);
  } catch {
    return false;
  }
}

async function simulateU64Function(
  client,
  packageId,
  moduleName,
  functionName,
) {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::${moduleName}::${functionName}` });
  const result = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(
      result.FailedTransaction.status?.error?.message
        || `${functionName} simulation failed.`,
    );
  }
  const bytes = result.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bytes || bytes.length !== 8) {
    throw new Error(`${functionName} did not return one BCS u64.`);
  }
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]);
  return Number(value);
}

async function simulateBoolFunction(
  client,
  packageId,
  moduleName,
  functionName,
) {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::${moduleName}::${functionName}` });
  const result = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(
      result.FailedTransaction.status?.error?.message
        || `${functionName} simulation failed.`,
    );
  }
  const bytes = result.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bytes || bytes.length !== 1 || (bytes[0] !== 0 && bytes[0] !== 1)) {
    throw new Error(`${functionName} did not return one canonical BCS bool.`);
  }
  return bytes[0] === 1;
}

async function simulateAbortingFunction(
  client,
  packageId,
  moduleName,
  functionName,
) {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::${moduleName}::${functionName}` });
  const result = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  return result.$kind === 'FailedTransaction';
}

async function simulateProtocolVersion(client, packageId, moduleName = 'animacraft') {
  return simulateU64Function(client, packageId, moduleName, 'protocol_version');
}

export async function inspectExpansionPackV8PackageAbi(
  client,
  callablePackageId,
  typeOriginPackageId,
  {
    originalPackageId,
    commerceV5TypeOriginPackageId,
    independentExtensionV5TypeOriginPackageId,
    legacyLogicalV5TypeOriginPackageId,
  } = {},
) {
  const moduleName = 'expansion_pack_v8';
  const completeModuleName = 'expansion_pack_complete_v8';
  const typeOrigin = normalizeSuiAddress(typeOriginPackageId);
  const legacyTypeOrigin = normalizeSuiAddress(originalPackageId);
  const commerceTypeOrigin = normalizeSuiAddress(commerceV5TypeOriginPackageId);
  const independentExtensionTypeOrigin = present(independentExtensionV5TypeOriginPackageId)
    ? normalizeSuiAddress(independentExtensionV5TypeOriginPackageId)
    : '';
  const legacyLogicalTypeOrigin = present(legacyLogicalV5TypeOriginPackageId)
    ? normalizeSuiAddress(legacyLogicalV5TypeOriginPackageId)
    : '';
  // Sui function signatures use the package lineage's original namespace for
  // every module in an upgraded package. A datatype's independently stable
  // TypeOrigin is exposed by getDatatype().definingId and is verified below.
  // Do not compare signature typeName package IDs to TypeOrigin package IDs.
  const abiLineagePackage = legacyTypeOrigin;
  const stdPackage = normalizeSuiAddress('0x1');
  const suiPackage = normalizeSuiAddress('0x2');
  const signature = (reference, body) => ({ reference, body });
  const primitive = (kind, reference = null) => signature(reference, { $kind: kind });
  const vector = (body, reference = null) => signature(reference, {
    $kind: 'vector',
    vector: body,
  });
  const typeParameter = (index) => ({ $kind: 'typeParameter', index });
  const datatypeBody = (packageId, module, type, typeParameters = []) => ({
    $kind: 'datatype',
    datatype: {
      typeName: `${normalizeSuiAddress(packageId)}::${module}::${type}`,
      typeParameters,
    },
  });
  const datatype = (
    packageId,
    module,
    type,
    typeParameters = [],
    reference = null,
  ) => signature(reference, datatypeBody(
    packageId,
    module,
    type,
    typeParameters,
  ));
  const stringType = (reference = null) => datatype(
    stdPackage,
    'string',
    'String',
    [],
    reference,
  );
  const context = (reference = 'immutable') => datatype(
    suiPackage,
    'tx_context',
    'TxContext',
    [],
    reference,
  );
  const root = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'commerce_v5',
    'MakerRootV5',
    [],
    reference,
  );
  const maker = (reference = 'immutable') => datatype(
    legacyTypeOrigin,
    'animacraft',
    'OCMaker',
    [],
    reference,
  );
  const protocolFeeAdmin = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'animacraft',
    'ProtocolFeeAdminCap',
    [],
    reference,
  );
  const commerceConfig = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'commerce_v5',
    'CommerceProtocolConfigV5',
    [],
    reference,
  );
  const controlCap = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'commerce_v5',
    'MakerControlCapV5',
    [],
    reference,
  );
  const makerTreasury = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'commerce_v5',
    'MakerTreasuryV5',
    [typeParameter(0)],
    reference,
  );
  const independentExtensionAuthority = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'commerce_v5',
    'IndependentExtensionAuthorityV5',
    [],
    reference,
  );
  const release = (reference = 'immutable') => datatype(
    abiLineagePackage,
    moduleName,
    'ExpansionPackReleaseV8',
    [],
    reference,
  );
  const adminCap = (reference = 'immutable') => datatype(
    abiLineagePackage,
    moduleName,
    'ExpansionPackAdminCapV8',
    [],
    reference,
  );
  const commerceAuthorization = (reference = 'immutable') => datatype(
    abiLineagePackage,
    'commerce_v5',
    'CommerceV5SoulMintAuthorization',
    [],
    reference,
  );
  const completeAuthorization = (reference = null) => datatype(
    abiLineagePackage,
    completeModuleName,
    'ExpansionPackCompleteAuthorizationV8',
    [],
    reference,
  );
  const completeBinding = (reference = null) => datatype(
    abiLineagePackage,
    completeModuleName,
    'ExpansionPackCompleteSoulBindingV8',
    [],
    reference,
  );
  const objectId = (reference = null) => datatype(
    suiPackage,
    'object',
    'ID',
    [],
    reference,
  );
  const paymentCoinBody = typeParameter(0);
  const typeParameterValue = (index, reference = null) => signature(
    reference,
    typeParameter(index),
  );
  const functionSpecs = [
    {
      name: 'version_v8',
      typeParameters: [],
      parameters: [],
      returns: [primitive('u64')],
    },
    {
      name: 'create_expansion_pack_v8',
      typeParameters: [[]],
      parameters: [
        root(), maker(), commerceConfig(),
        stringType(), stringType(), vector({ $kind: 'u8' }),
        stringType(), stringType(), stringType(), vector({ $kind: 'u8' }),
        primitive('u8'), primitive('u64'), context('mutable'),
      ],
      returns: [],
    },
    {
      name: 'bind_expansion_pack_manifest_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), adminCap(), stringType(),
        vector({ $kind: 'u8' }), context(),
      ],
      returns: [],
    },
    {
      name: 'register_style_asset_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), adminCap(),
        stringType(), stringType(), stringType(), stringType(),
        vector({ $kind: 'u8' }), vector({ $kind: 'u8' }), context(),
      ],
      returns: [],
    },
    {
      name: 'seal_expansion_pack_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), adminCap(), vector({ $kind: 'u8' }), context(),
      ],
      returns: [],
    },
    {
      name: 'bind_expansion_pack_seal_policy_v8',
      typeParameters: [],
      parameters: [release('mutable'), adminCap(), context()],
      returns: [],
    },
    {
      name: 'admit_expansion_pack_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), root(), maker(), controlCap(), context(),
      ],
      returns: [],
    },
    {
      name: 'admit_expansion_pack_with_authority_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), root(), maker(), independentExtensionAuthority(),
        context(),
      ],
      returns: [],
    },
    {
      name: 'activate_expansion_pack_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), adminCap(), root(), commerceConfig(), context(),
      ],
      returns: [],
    },
    {
      name: 'pause_expansion_pack_v8',
      typeParameters: [],
      parameters: [release('mutable'), adminCap(), context()],
      returns: [],
    },
    {
      name: 'resume_expansion_pack_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), adminCap(), root(), commerceConfig(), context(),
      ],
      returns: [],
    },
    {
      name: 'archive_expansion_pack_v8',
      typeParameters: [],
      parameters: [release('mutable'), adminCap(), context()],
      returns: [],
    },
    {
      name: 'claim_free_expansion_pack_v8',
      typeParameters: [],
      parameters: [
        release('mutable'), root(), commerceConfig(),
        datatype(suiPackage, 'clock', 'Clock', [], 'immutable'),
        context('mutable'),
      ],
      returns: [],
    },
    {
      name: 'purchase_expansion_pack_v8',
      typeParameters: [[]],
      parameters: [
        release('mutable'),
        datatype(
          abiLineagePackage,
          moduleName,
          'ExpansionPackTreasuryV8',
          [paymentCoinBody],
          'mutable',
        ),
        root(),
        commerceConfig(),
        datatype(
          abiLineagePackage,
          'commerce_v5',
          'CommerceProtocolTreasuryV5',
          [paymentCoinBody],
          'mutable',
        ),
        datatype(suiPackage, 'coin', 'Coin', [paymentCoinBody]),
        datatype(suiPackage, 'clock', 'Clock', [], 'immutable'),
        context('mutable'),
      ],
      returns: [],
    },
    {
      name: 'withdraw_expansion_pack_revenue_v8',
      typeParameters: [[]],
      parameters: [
        release(),
        datatype(
          abiLineagePackage,
          moduleName,
          'ExpansionPackTreasuryV8',
          [paymentCoinBody],
          'mutable',
        ),
        adminCap(), primitive('u64'), primitive('address'), context('mutable'),
      ],
      returns: [],
    },
    {
      name: 'verify_style_access_v8',
      typeParameters: [],
      parameters: [
        release(), root(), stringType(), stringType(), stringType(), context(),
      ],
      returns: [datatype(
        abiLineagePackage,
        moduleName,
        'ExpansionPackStyleAccessProofV8',
      )],
    },
    {
      name: 'seal_approve_style_v8',
      typeParameters: [],
      parameters: [vector({ $kind: 'u8' }), release(), root(), context()],
      returns: [],
    },
    {
      name: 'check_style_seal_access_v8',
      typeParameters: [],
      parameters: [
        vector({ $kind: 'u8' }), release(), root(), primitive('address'),
      ],
      returns: [primitive('bool')],
    },
    {
      name: 'complete_bridge_enabled_v8',
      typeParameters: [],
      parameters: [],
      returns: [primitive('bool')],
    },
    {
      name: 'physical_bridge_enabled_v8',
      typeParameters: [],
      parameters: [],
      returns: [primitive('bool')],
    },
    {
      name: 'assert_complete_bridge_enabled_v8',
      typeParameters: [],
      parameters: [],
      returns: [],
    },
    {
      name: 'assert_physical_bridge_enabled_v8',
      typeParameters: [],
      parameters: [],
      returns: [],
    },
    {
      moduleName: completeModuleName,
      name: 'companion_proof_version_v8',
      typeParameters: [],
      parameters: [],
      returns: [primitive('u64')],
    },
    {
      moduleName: completeModuleName,
      name: 'companion_proof_available_v8',
      typeParameters: [],
      parameters: [],
      returns: [primitive('bool')],
    },
    {
      moduleName: completeModuleName,
      name: 'begin_expansion_pack_complete_authorization_v8',
      typeParameters: [],
      parameters: [root(), vector({ $kind: 'u8' }), context()],
      returns: [completeAuthorization()],
    },
    {
      moduleName: completeModuleName,
      name: 'append_expansion_pack_complete_style_v8',
      typeParameters: [],
      parameters: [
        completeAuthorization('mutable'), release(), root(),
        stringType(), stringType(), stringType(), context(),
      ],
      returns: [],
    },
    {
      moduleName: completeModuleName,
      name: 'seal_expansion_pack_complete_authorization_v8',
      typeParameters: [],
      parameters: [completeAuthorization('mutable')],
      returns: [],
    },
    {
      moduleName: completeModuleName,
      name: 'authenticate_expansion_pack_complete_v8',
      typeParameters: [],
      parameters: [
        completeAuthorization(), commerceAuthorization(), root(),
        commerceConfig(), context(),
      ],
      returns: [completeBinding()],
    },
    {
      moduleName: completeModuleName,
      name: 'bind_expansion_pack_complete_to_soul_v8',
      typeParameters: [['drop']],
      parameters: [
        completeBinding(), commerceConfig(), objectId(),
        typeParameterValue(0), context('mutable'),
      ],
      returns: [typeParameterValue(0)],
    },
    {
      moduleName: completeModuleName,
      name: 'authorization_pack_selection_commitment_v8',
      typeParameters: [],
      parameters: [completeAuthorization('immutable')],
      returns: [vector({ $kind: 'u8' }, 'immutable')],
    },
    {
      moduleName: completeModuleName,
      name: 'authorization_selection_count_v8',
      typeParameters: [],
      parameters: [completeAuthorization('immutable')],
      returns: [primitive('u64')],
    },
  ].map((spec) => ({
    visibility: 'public',
    isEntry: false,
    ...spec,
  }));
  const sealApprovalSpec = functionSpecs.find(({ name }) => (
    name === 'seal_approve_style_v8'
  ));
  sealApprovalSpec.visibility = 'private';
  sealApprovalSpec.isEntry = true;
  const parentEvidenceSpec = {
    name: 'bind_maker_release_evidence_v5',
    visibility: 'public',
    isEntry: false,
    typeParameters: [],
    parameters: [
      root('mutable'), controlCap(), maker(), stringType(), stringType(),
      vector({ $kind: 'u8' }), context(),
    ],
    returns: [],
  };
  const finalizeIndependentExtensionSpec = {
    name: 'finalize_independent_extension_root_v5',
    visibility: 'public',
    isEntry: false,
    typeParameters: [[]],
    parameters: [
      root('mutable'), makerTreasury(), controlCap(null), maker(),
      commerceConfig(), protocolFeeAdmin(), vector(datatypeBody(
        stdPackage,
        'string',
        'String',
      )), vector(datatypeBody(stdPackage, 'string', 'String')),
      vector(datatypeBody(stdPackage, 'string', 'String')),
      vector({ $kind: 'u8' }), vector({ $kind: 'u8' }), context('mutable'),
    ],
    returns: [],
  };
  const datatypeSpecs = [
    [moduleName, 'ExpansionPackReleaseV8'],
    [moduleName, 'ExpansionPackAdminCapV8'],
    [moduleName, 'ExpansionPackTreasuryV8'],
    [moduleName, 'ExpansionPackPassV8'],
    [moduleName, 'ExpansionPackStyleAccessProofV8'],
    [completeModuleName, 'ExpansionPackCompleteStyleSelectionV8'],
    [completeModuleName, 'ExpansionPackSelectionHashInputV8'],
    [completeModuleName, 'ExpansionPackCompleteHashInputV8'],
    [completeModuleName, 'ExpansionPackCompleteAuthorizationV8'],
    [completeModuleName, 'ExpansionPackCompleteSoulBindingV8'],
    [completeModuleName, 'ExpansionPackCompleteProvenanceV8'],
    [completeModuleName, 'ExpansionPackCompleteAuthenticatedV8'],
    [completeModuleName, 'ExpansionPackCompleteBoundToSoulV8'],
  ];
  const legacyLogicalDatatypeSpecs = [
    ['commerce_v5', 'LegacyLogicalCompatibilityStateV5'],
    ['commerce_v5', 'LegacyLogicalStyleApprovalKeyV5'],
    ['commerce_v5', 'LegacyLogicalStyleApprovalV5'],
    ['commerce_v5', 'LegacyLogicalStyleRegisteredV5'],
  ];
  const independentExtensionDatatypeSpecs = independentExtensionTypeOrigin
    ? [
      ['commerce_v5', 'IndependentExtensionLockStateV5'],
      ['commerce_v5', 'IndependentExtensionAuthorityV5'],
      ['commerce_v5', 'IndependentExtensionRootFinalizedV5'],
    ]
    : [];
  const queriedDatatypeSpecs = [
    ...datatypeSpecs,
    ...legacyLogicalDatatypeSpecs,
    ...independentExtensionDatatypeSpecs,
  ];
  const [
    functions,
    datatypes,
    parentEvidenceFunction,
    finalizeIndependentExtensionFunction,
    parentEvidenceDatatype,
    version,
    completeVersion,
    completeBridgeEnabled,
    physicalBridgeEnabled,
    companionProofAvailable,
    completeBridgeAssertionAborts,
    physicalBridgeAssertionAborts,
  ] = await Promise.all([
    Promise.all(functionSpecs.map(({ name, moduleName: specModule = moduleName }) => (
      moveFunctionInModule(client, callablePackageId, specModule, name)
    ))),
    Promise.all(queriedDatatypeSpecs.map(([specModule, name]) => (
      moveDatatypeInModule(client, callablePackageId, specModule, name)
    ))),
    moveFunctionInModule(
      client,
      callablePackageId,
      'commerce_v5',
      'bind_maker_release_evidence_v5',
    ),
    moveFunctionInModule(
      client,
      callablePackageId,
      'commerce_v5',
      'finalize_independent_extension_root_v5',
    ),
    moveDatatypeInModule(
      client,
      callablePackageId,
      'commerce_v5',
      'MakerReleaseEvidenceV5',
    ),
    simulateU64Function(client, callablePackageId, moduleName, 'version_v8'),
    simulateU64Function(
      client,
      callablePackageId,
      completeModuleName,
      'companion_proof_version_v8',
    ),
    simulateBoolFunction(
      client,
      callablePackageId,
      moduleName,
      'complete_bridge_enabled_v8',
    ),
    simulateBoolFunction(
      client,
      callablePackageId,
      moduleName,
      'physical_bridge_enabled_v8',
    ),
    simulateBoolFunction(
      client,
      callablePackageId,
      completeModuleName,
      'companion_proof_available_v8',
    ),
    simulateAbortingFunction(
      client,
      callablePackageId,
      moduleName,
      'assert_complete_bridge_enabled_v8',
    ),
    simulateAbortingFunction(
      client,
      callablePackageId,
      moduleName,
      'assert_physical_bridge_enabled_v8',
    ),
  ]);
  const functionsByName = Object.fromEntries(
    functionSpecs.map(({ name }, index) => [name, functions[index]]),
  );
  const canonicalDatatypeName = (value) => {
    const pieces = String(value || '').split('::');
    if (pieces.length !== 3) return '';
    try {
      return `${normalizeSuiAddress(pieces[0])}::${pieces[1]}::${pieces[2]}`;
    } catch {
      return '';
    }
  };
  const bodyMatches = (actual, expected) => {
    if (!actual || !expected || actual.$kind !== expected.$kind) return false;
    if (expected.$kind === 'vector') {
      return bodyMatches(actual.vector, expected.vector);
    }
    if (expected.$kind === 'typeParameter') {
      return actual.index === expected.index;
    }
    if (expected.$kind === 'datatype') {
      const actualParameters = actual.datatype?.typeParameters;
      const expectedParameters = expected.datatype?.typeParameters;
      return canonicalDatatypeName(actual.datatype?.typeName)
          === canonicalDatatypeName(expected.datatype?.typeName)
        && Array.isArray(actualParameters)
        && actualParameters.length === expectedParameters.length
        && expectedParameters.every((parameter, index) => (
          bodyMatches(actualParameters[index], parameter)
        ));
    }
    return true;
  };
  const signatureMatches = (actual, expected) => (
    (actual?.reference ?? null) === expected.reference
      && bodyMatches(actual?.body, expected.body)
  );
  const typeParametersMatch = (actual, expected) => (
    Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((constraints, index) => {
        const actualConstraints = actual[index]?.constraints;
        return Array.isArray(actualConstraints)
          && actualConstraints.length === constraints.length
          && constraints.every((constraint, constraintIndex) => (
            actualConstraints[constraintIndex] === constraint
          ));
      })
  );
  const functionMatches = (fn, spec) => (
    fn?.visibility === spec.visibility
      && fn?.isEntry === spec.isEntry
      && typeParametersMatch(fn?.typeParameters, spec.typeParameters)
      && Array.isArray(fn?.parameters)
      && fn.parameters.length === spec.parameters.length
      && spec.parameters.every((parameter, index) => (
        signatureMatches(fn.parameters[index], parameter)
      ))
      && Array.isArray(fn?.returns)
      && fn.returns.length === spec.returns.length
      && spec.returns.every((result, index) => (
        signatureMatches(fn.returns[index], result)
      ))
  );
  const abiMismatches = functionSpecs.filter((spec) => (
    !functionMatches(functionsByName[spec.name], spec)
  )).map(({ name, moduleName: specModule = moduleName }) => `${specModule}::${name}`);
  if (!functionMatches(parentEvidenceFunction, parentEvidenceSpec)) {
    abiMismatches.push('commerce_v5::bind_maker_release_evidence_v5');
  }
  if (!functionMatches(
    finalizeIndependentExtensionFunction,
    finalizeIndependentExtensionSpec,
  )) {
    abiMismatches.push('commerce_v5::finalize_independent_extension_root_v5');
  }
  const originEntries = [
    ...datatypeSpecs.map(([specModule, name], index) => ({
      name: `${specModule}::${name}`,
      datatype: datatypes[index],
      expectedTypeOrigin: typeOrigin,
    })),
    ...legacyLogicalDatatypeSpecs.map(([specModule, name], index) => ({
      name: `${specModule}::${name}`,
      datatype: datatypes[datatypeSpecs.length + index],
      expectedTypeOrigin: legacyLogicalTypeOrigin,
    })),
    ...independentExtensionDatatypeSpecs.map(([specModule, name], index) => ({
      name: `${specModule}::${name}`,
      datatype: datatypes[
        datatypeSpecs.length + legacyLogicalDatatypeSpecs.length + index
      ],
      expectedTypeOrigin: independentExtensionTypeOrigin,
    })),
    {
      name: 'commerce_v5::MakerReleaseEvidenceV5',
      datatype: parentEvidenceDatatype,
      expectedTypeOrigin: typeOrigin,
    },
  ];
  const originMismatches = originEntries.filter(({ datatype, expectedTypeOrigin }) => (
    !datatypeHasTypeOrigin(datatype, expectedTypeOrigin)
  )).map(({ name }) => name);
  const exactAbiReady = abiMismatches.length === 0;
  const originsReady = originMismatches.length === 0;
  const ready = version === 8
    && completeVersion === 8
    && completeBridgeEnabled === false
    && physicalBridgeEnabled === false
    && companionProofAvailable === false
    && completeBridgeAssertionAborts
    && physicalBridgeAssertionAborts
    && exactAbiReady
    && originsReady;
  const valueMismatches = [
    version === 8 ? '' : `version_v8=${version}`,
    completeVersion === 8 ? '' : `companion_proof_version_v8=${completeVersion}`,
    completeBridgeEnabled === false ? '' : `complete_bridge_enabled_v8=${completeBridgeEnabled}`,
    physicalBridgeEnabled === false ? '' : `physical_bridge_enabled_v8=${physicalBridgeEnabled}`,
    companionProofAvailable === false ? '' : `companion_proof_available_v8=${companionProofAvailable}`,
    completeBridgeAssertionAborts ? '' : 'assert_complete_bridge_enabled_v8 did not abort',
    physicalBridgeAssertionAborts ? '' : 'assert_physical_bridge_enabled_v8 did not abort',
  ].filter(Boolean);
  return {
    ready,
    detail: ready
      ? `version_v8=8; Complete/physical bridges and companion proof are false with aborting bridge assertions; exact entry/public ABI and legacy=${legacyTypeOrigin}, Commerce v5=${commerceTypeOrigin}, Expansion Pack v8=${typeOrigin}, legacy-logical=${legacyLogicalTypeOrigin}, independent extension=${independentExtensionTypeOrigin} TypeOrigins verified`
      : [
        'Required Expansion Pack v8 package read-back differs.',
        valueMismatches.length ? `Values: ${valueMismatches.join(', ')}.` : '',
        abiMismatches.length ? `ABI: ${abiMismatches.join(', ')}.` : '',
        originMismatches.length ? `TypeOrigin: ${originMismatches.join(', ')}.` : '',
      ].filter(Boolean).join(' '),
  };
}

async function checkExpansionPackV8PackageAbi(
  client,
  config,
  deploymentStatus,
) {
  if (!deploymentStatus.declared) return;
  const callablePackageId = config.expansionPackV8CallablePackageId;
  const typeOriginPackageId = config.expansionPackV8TypeOriginPackageId;
  const originalPackageId = config.originalPackageId;
  const commerceV5TypeOriginPackageId = config.commerceV5TypeOriginPackageId;
  const independentExtensionV5TypeOriginPackageId =
    config.independentExtensionV5TypeOriginPackageId;
  const legacyLogicalV5TypeOriginPackageId =
    config.legacyLogicalV5TypeOriginPackageId;
  if (!validSuiId(callablePackageId)
      || !validSuiId(typeOriginPackageId)
      || !validSuiId(originalPackageId)
      || !validSuiId(commerceV5TypeOriginPackageId)
      || !validSuiId(independentExtensionV5TypeOriginPackageId)
      || !validSuiId(legacyLogicalV5TypeOriginPackageId)) {
    record(
      'Animacraft Expansion Pack v8 package ABI',
      false,
      'Valid callable, legacy Maker, Commerce v5, Expansion Pack v8, independent-extension and legacy-logical TypeOrigins are required for chain read-back.',
    );
    return;
  }
  try {
    const status = await deadline(
      'Animacraft Expansion Pack v8 package ABI',
      () => inspectExpansionPackV8PackageAbi(
        client,
        callablePackageId,
        typeOriginPackageId,
        {
          originalPackageId,
          commerceV5TypeOriginPackageId,
          independentExtensionV5TypeOriginPackageId,
          legacyLogicalV5TypeOriginPackageId,
        },
      ),
    );
    record(
      'Animacraft Expansion Pack v8 package ABI',
      status.ready,
      status.detail,
    );
  } catch (error) {
    record('Animacraft Expansion Pack v8 package ABI', false, error.message);
  }
}

async function checkExpansionPackV8ParentObjects(client, config, deployment) {
  const evidence = deployment.releases?.expansionPackV8?.parentFinalization || {};
  try {
    const response = await deadline(
      'Animacraft Expansion Pack v8 parent objects',
      () => client.core.getObjects({
        objectIds: [evidence.rootId, evidence.treasuryId, evidence.authorityId],
        include: { json: true, owner: true },
      }),
    );
    const [rootObject, treasuryObject, authorityObject] = response.objects || [];
    if ([rootObject, treasuryObject, authorityObject].some((value) => (
      !value || value instanceof Error || value.error || value.$kind === 'Error'
    ))) throw new Error('Root, Treasury or Authority is unavailable.');
    const root = parseMakerRootV5(rootObject);
    const treasury = parseMakerTreasuryV5(treasuryObject);
    const authority = parseIndependentExtensionAuthorityV5(authorityObject);
    const lock = await queryIndependentExtensionLockV5(client.core, {
      runtime: config,
      rootId: evidence.rootId,
    });
    const styles = await queryStyleBindingsV5(client.core, root);
    const counts = styles.reduce((result, row) => {
      result[Number(row.rowKind)] = (result[Number(row.rowKind)] || 0) + 1;
      return result;
    }, {});
    let retiredCapUnavailable = false;
    try {
      const retired = await client.core.getObjects({
        objectIds: [evidence.retiredControlCap.id],
        include: { json: true, owner: true },
      });
      const entry = retired.objects?.[0];
      const message = String(entry?.message || entry?.error?.message || entry || '');
      retiredCapUnavailable = Boolean(
        entry instanceof Error
          ? message.includes(evidence.retiredControlCap.id)
            && /not found|does not exist|deleted/i.test(message)
          : entry?.error && message.includes(evidence.retiredControlCap.id)
            && /not found|does not exist|deleted/i.test(message),
      );
    } catch (error) {
      const message = String(error?.message || error);
      retiredCapUnavailable = message.includes(evidence.retiredControlCap.id)
        && /not found|does not exist|deleted/i.test(message);
    }
    const rootType = `${config.commerceV5TypeOriginPackageId}::commerce_v5::MakerRootV5`;
    const treasuryType = `${config.commerceV5TypeOriginPackageId}::commerce_v5::MakerTreasuryV5<${config.paymentCoinType}>`;
    const authorityType = `${config.independentExtensionV5TypeOriginPackageId}::commerce_v5::IndependentExtensionAuthorityV5`;
    const ready = normalizeSuiAddress(root.objectId) === normalizeSuiAddress(evidence.rootId)
      && normalizedStructTag(root.type) === normalizedStructTag(rootType)
      && normalizeSuiAddress(root.treasuryId) === normalizeSuiAddress(evidence.treasuryId)
      && normalizeSuiAddress(root.legacyMakerId) === normalizeSuiAddress(evidence.legacyMakerId)
      && normalizeSuiAddress(root.protocolConfigId) === normalizeSuiAddress(evidence.protocolConfigId)
      && normalizeSuiAddress(root.currentOwner) === normalizeSuiAddress(evidence.owner)
      && normalizeSuiAddress(root.currentControlCapId)
        === normalizeSuiAddress(evidence.retiredControlCap.id)
      && root.lifecycle === evidence.lifecycleCode
      && root.ownershipEpoch === BigInt(evidence.ownershipEpoch)
      && root.styleRegistrySealed === true
      && root.styleCount === BigInt(evidence.styleCounts.total)
      && root.packCount === 0n
      && root.paidPackCount === 0n
      && root.completeOutputCount === 0n
      && root.activeListingId === ''
      && root.requiresSealPolicy === false
      && root.sealPolicyBound === false
      && normalizeSuiAddress(treasury.objectId) === normalizeSuiAddress(evidence.treasuryId)
      && normalizedStructTag(treasury.type) === normalizedStructTag(treasuryType)
      && normalizeSuiAddress(treasury.rootId) === normalizeSuiAddress(evidence.rootId)
      && treasury.balanceAtomic === 0n
      && normalizeSuiAddress(authority.objectId) === normalizeSuiAddress(evidence.authorityId)
      && normalizedStructTag(authority.type) === normalizedStructTag(authorityType)
      && isSharedOwner(authorityObject.owner)
      && normalizeSuiAddress(authority.rootId) === normalizeSuiAddress(evidence.rootId)
      && normalizeSuiAddress(authority.legacyMakerId) === normalizeSuiAddress(evidence.legacyMakerId)
      && normalizeSuiAddress(authority.protocolConfigId)
        === normalizeSuiAddress(evidence.protocolConfigId)
      && normalizeSuiAddress(authority.protocolAdminCapId)
        === normalizeSuiAddress(evidence.protocolAdminCapId)
      && normalizeSuiAddress(authority.owner) === normalizeSuiAddress(evidence.owner)
      && normalizeSuiAddress(authority.retiredControlCapId)
        === normalizeSuiAddress(evidence.retiredControlCap.id)
      && authority.retiredControlCapEpoch === BigInt(evidence.retiredControlCapEpoch)
      && authority.lockedOwnershipEpoch === BigInt(evidence.ownershipEpoch)
      && authority.auditHash.replace(/^0x/, '') === evidence.auditHash
      && lock.finalized === true
      && lock.auditHash.replace(/^0x/, '') === evidence.auditHash
      && normalizeSuiAddress(lock.authorityId) === normalizeSuiAddress(evidence.authorityId)
      && normalizeSuiAddress(lock.rootId) === normalizeSuiAddress(evidence.rootId)
      && normalizeSuiAddress(lock.legacyMakerId) === normalizeSuiAddress(evidence.legacyMakerId)
      && normalizeSuiAddress(lock.protocolConfigId)
        === normalizeSuiAddress(evidence.protocolConfigId)
      && normalizeSuiAddress(lock.protocolAdminCapId)
        === normalizeSuiAddress(evidence.protocolAdminCapId)
      && normalizeSuiAddress(lock.owner) === normalizeSuiAddress(evidence.owner)
      && normalizeSuiAddress(lock.retiredControlCapId)
        === normalizeSuiAddress(evidence.retiredControlCap.id)
      && lock.retiredControlCapEpoch === BigInt(evidence.retiredControlCapEpoch)
      && lock.lockedOwnershipEpoch === BigInt(evidence.ownershipEpoch)
      && counts[0] === evidence.styleCounts.visual
      && counts[1] === evidence.styleCounts.logicalNone
      && counts[2] === evidence.styleCounts.logicalColor
      && styles.length === evidence.styleCounts.total
      && retiredCapUnavailable;
    record(
      'Animacraft Expansion Pack v8 parent objects',
      ready,
      ready
        ? 'Shared Authority, PAUSED epoch-1 Root, irreversible lock, deleted ControlCap, empty treasury and exact 19/3/4 sealed registry read back.'
        : 'Parent Root, Authority, lock, retired ControlCap, treasury or exact registry differs.',
    );
  } catch (error) {
    record('Animacraft Expansion Pack v8 parent objects', false, error.message);
  }
}

async function checkCommerceV5Abi(client, packageId, typeOriginPackageId) {
  if (!packageId || !typeOriginPackageId) return;
  try {
    const moduleName = 'commerce_v5';
    const functionNames = [
      'initialize_commerce_protocol_v5',
      'update_protocol_enabled_v5',
      'bind_logical_auxiliary_blob_v5',
      'bind_soul_binding_proof_type_v5',
      'migrate_legacy_maker_v5',
      'update_base_policy_v5',
      'update_base_access_v5',
      'update_maker_resale_royalty_v5',
      'add_pack_v5',
      'update_pack_v5',
      'register_base_style_v5',
      'register_base_logical_style_v5',
      'register_pack_style_v5',
      'seal_style_registry_v5',
      'activate_maker_v5',
      'pause_maker_v5',
      'archive_maker_v5',
      'purchase_base_access_v5',
      'purchase_pack_v5',
      'quote_complete_v5',
      'authorize_complete_free_v5',
      'authorize_complete_paid_v5',
      'consume_commerce_v5_soul_mint_authorization',
      'bind_complete_output_to_soul_v5',
      'withdraw_maker_revenue_v5',
      'list_maker_for_sale_v5',
      'cancel_maker_listing_v5',
      'buy_maker_v5',
    ];
    const datatypeNames = [
      'CommerceProtocolConfigV5',
      'CommerceProtocolTreasuryV5',
      'MakerRootV5',
      'MakerTreasuryV5',
      'MakerControlVaultV5',
      'MakerControlCapV5',
      'MakerAccessPassV5',
      'PackPassV5',
      'MakerListingV5',
      'StyleSelectionV5',
      'CompleteQuoteV5',
      'CompleteOutputRecordV5',
      'CompleteOutputSoulBindingV5',
      'CommerceV5SoulMintAuthorization',
    ];
    const [functions, datatypes, version] = await Promise.all([
      Promise.all(functionNames.map((name) => (
        moveFunctionInModule(client, packageId, moduleName, name)
      ))),
      Promise.all(datatypeNames.map((name) => (
        moveDatatypeInModule(client, packageId, moduleName, name)
      ))),
      simulateProtocolVersion(client, packageId, moduleName),
    ]);
    const typeOrigin = normalizeSuiAddress(typeOriginPackageId);
    const functionsByName = Object.fromEntries(
      functionNames.map((name, index) => [name, functions[index]]),
    );
    const initialize = functionsByName.initialize_commerce_protocol_v5;
    const authorizeFree = functionsByName.authorize_complete_free_v5;
    const authorizePaid = functionsByName.authorize_complete_paid_v5;
    const consumeAuthorization =
      functionsByName.consume_commerce_v5_soul_mint_authorization;
    const bindOutput = functionsByName.bind_complete_output_to_soul_v5;
    const bindAuxiliary =
      functionsByName.bind_logical_auxiliary_blob_v5;
    const bindProof =
      functionsByName.bind_soul_binding_proof_type_v5;
    const registerBase = functionsByName.register_base_style_v5;
    const registerBaseLogical =
      functionsByName.register_base_logical_style_v5;
    const registerPack = functionsByName.register_pack_style_v5;
    const functionsReady = functions.every(Boolean)
      && initialize.typeParameters.length === 1
      && initialize.parameters.length === 3
      && bindAuxiliary.typeParameters.length === 0
      && bindAuxiliary.parameters.length === 3
      && bindProof.typeParameters.length === 1
      && bindProof.parameters.length === 2
      && registerBase.typeParameters.length === 0
      && registerBase.parameters.length === 7
      && registerBaseLogical.typeParameters.length === 0
      && registerBaseLogical.parameters.length === 8
      && registerPack.typeParameters.length === 0
      && registerPack.parameters.length === 8
      && authorizeFree.typeParameters.length === 0
      && authorizeFree.parameters.length === 15
      && authorizeFree.returns.length === 1
      && moveTypeEndsWith(
        authorizeFree.returns[0],
        '::commerce_v5::CommerceV5SoulMintAuthorization',
      )
      && authorizePaid.typeParameters.length === 1
      && authorizePaid.parameters.length === 18
      && authorizePaid.returns.length === 1
      && moveTypeEndsWith(
        authorizePaid.returns[0],
        '::commerce_v5::CommerceV5SoulMintAuthorization',
      )
      && consumeAuthorization.parameters.length === 1
      && moveTypeEndsWith(
        consumeAuthorization.parameters[0],
        '::commerce_v5::CommerceV5SoulMintAuthorization',
      )
      && consumeAuthorization.returns.length === 3
      && moveTypeEndsWith(
        consumeAuthorization.returns[0],
        '::animacraft::CanonicalSoulMintAuthorization',
      )
      && consumeAuthorization.returns[1]?.body?.$kind === 'u16'
      && moveTypeEndsWith(
        consumeAuthorization.returns[2],
        '::commerce_v5::CompleteOutputSoulBindingV5',
      )
      && bindOutput.typeParameters.length === 1
      && bindOutput.parameters.length === 5
      && moveTypeEndsWith(
        bindOutput.parameters[0],
        '::commerce_v5::MakerRootV5',
      )
      && moveTypeEndsWith(
        bindOutput.parameters[1],
        '::commerce_v5::CommerceProtocolConfigV5',
      )
      && moveTypeEndsWith(
        bindOutput.parameters[2],
        '::commerce_v5::CompleteOutputSoulBindingV5',
      )
      && moveTypeEndsWith(
        bindOutput.parameters[3],
        '::object::ID',
      );
    const originsReady = datatypes.every((datatype) => (
      datatypeHasTypeOrigin(datatype, typeOrigin)
    ));
    record(
      'Animacraft commerce v5 ABI',
      version === 5 && functionsReady && originsReady,
      version === 5 && functionsReady && originsReady
        ? `protocol_version=5; publication, lifecycle, treasury, exact Style registry, entitlements, Soul-bound Complete output, and Maker market verified; TypeOrigin=${typeOrigin}`
        : 'Required v5 commerce ABI or TypeOrigin differs.',
    );
  } catch (error) {
    record('Animacraft commerce v5 ABI', false, error.message);
  }
}

async function checkCompositionV6Abi(client, packageId, typeOriginPackageId) {
  if (!packageId || !typeOriginPackageId) return;
  try {
    const moduleName = 'composition_v6';
    const functionNames = [
      'composition_protocol_version_v6',
      'initialize_composition_protocol_v6',
      'bind_soul_owner_proof_type_v6',
      'update_protocol_enabled_v6',
      'rotate_validator_v6',
      'transfer_composition_admin_cap_v6',
      'transfer_validator_cap_v6',
      'create_maker_profile_v6',
      'seal_maker_profile_v6',
      'cancel_unsealed_maker_profile_v6',
      'publish_official_item_product_v6',
      'publish_external_item_product_v6',
      'publish_validator_attestation_v6',
      'admit_official_item_v6',
      'admit_certified_item_v6',
      'admit_open_item_v6',
      'deactivate_item_admission_v6',
      'reactivate_item_admission_v6',
      'claim_free_wallet_item_v6',
      'claim_free_soul_item_v6',
      'purchase_wallet_item_v6',
      'purchase_soul_item_v6',
      'transfer_owned_item_v6',
      'lock_owned_item_to_soul_v6',
      'unlock_owned_item_from_soul_v6',
      'assert_secondary_market_loadout_v6',
      'authorize_loadout_v6',
      'consume_loadout_authorization_v6',
      'authorize_initial_loadout_v6',
      'consume_initial_loadout_authorization_v6',
    ];
    const datatypeNames = [
      'CompositionProtocolConfigV6',
      'CompositionProtocolTreasuryV6',
      'CompositionAdminCapV6',
      'ValidatorCapV6',
      'WalletEntitlementKeyV6',
      'SoulEntitlementKeyV6',
      'LoadoutNonceKeyV6',
      'EntitlementRecordV6',
      'OwnedLockRecordV6',
      'CompositionRegistryV6',
      'MakerProfileV6',
      'ItemProductV6',
      'ValidatorAttestationV6',
      'AdmissionRecordV6',
      'OwnedItemV6',
      'LoadoutSelectionV6',
      'LoadoutAuthorizationV6',
      'InitialLoadoutAuthorizationV6',
    ];
    const [functions, datatypes, version] = await Promise.all([
      Promise.all(functionNames.map((name) => (
        moveFunctionInModule(client, packageId, moduleName, name)
      ))),
      Promise.all(datatypeNames.map((name) => (
        moveDatatypeInModule(client, packageId, moduleName, name)
      ))),
      simulateU64Function(
        client,
        packageId,
        moduleName,
        'composition_protocol_version_v6',
      ),
    ]);
    const typeOrigin = normalizeSuiAddress(typeOriginPackageId);
    const functionsByName = Object.fromEntries(
      functionNames.map((name, index) => [name, functions[index]]),
    );
    const versionFn = functionsByName.composition_protocol_version_v6;
    const initialize = functionsByName.initialize_composition_protocol_v6;
    const bindProof = functionsByName.bind_soul_owner_proof_type_v6;
    const updateGate = functionsByName.update_protocol_enabled_v6;
    const rotateValidator = functionsByName.rotate_validator_v6;
    const transferAdmin = functionsByName.transfer_composition_admin_cap_v6;
    const transferValidator = functionsByName.transfer_validator_cap_v6;
    const createProfile = functionsByName.create_maker_profile_v6;
    const publishOfficial = functionsByName.publish_official_item_product_v6;
    const publishExternal = functionsByName.publish_external_item_product_v6;
    const purchaseWallet = functionsByName.purchase_wallet_item_v6;
    const purchaseSoul = functionsByName.purchase_soul_item_v6;
    const authorize = functionsByName.authorize_loadout_v6;
    const consume = functionsByName.consume_loadout_authorization_v6;
    const authorizeInitial = functionsByName.authorize_initial_loadout_v6;
    const consumeInitial = functionsByName.consume_initial_loadout_authorization_v6;
    const secondaryGuard = functionsByName.assert_secondary_market_loadout_v6;
    const functionsReady = functions.every(Boolean)
      && versionFn.parameters.length === 0
      && versionFn.returns.length === 1
      && versionFn.returns[0]?.body?.$kind === 'u64'
      && initialize.typeParameters.length === 1
      && initialize.parameters.length === 4
      && moveTypeEndsWith(
        initialize.parameters[0],
        '::commerce_v5::CommerceProtocolConfigV5',
      )
      && moveTypeEndsWith(
        initialize.parameters[1],
        '::animacraft::ProtocolFeeAdminCap',
      )
      && initialize.returns.length === 0
      && bindProof.typeParameters.length === 1
      && bindProof.parameters.length === 3
      && moveTypeEndsWith(
        bindProof.parameters[0],
        '::composition_v6::CompositionProtocolConfigV6',
      )
      && updateGate.parameters.length === 4
      && rotateValidator.parameters.length === 6
      && moveTypeEndsWith(
        rotateValidator.parameters[3],
        '::composition_v6::CompositionAdminCapV6',
      )
      && transferAdmin.parameters.length === 3
      && moveTypeEndsWith(
        transferAdmin.parameters[0],
        '::composition_v6::CompositionAdminCapV6',
      )
      && transferValidator.parameters.length === 3
      && moveTypeEndsWith(
        transferValidator.parameters[0],
        '::composition_v6::ValidatorCapV6',
      )
      && createProfile.parameters.length === 14
      && publishOfficial.parameters.length === 18
      && publishExternal.parameters.length === 18
      && purchaseWallet.typeParameters.length === 1
      && purchaseWallet.parameters.length === 10
      && moveTypeEndsWith(
        purchaseWallet.parameters[2],
        '::composition_v6::CompositionProtocolTreasuryV6',
      )
      && purchaseSoul.typeParameters.length === 2
      && purchaseSoul.parameters.length === 12
      && authorize.typeParameters.length === 1
      && authorize.parameters.length === 11
      && authorize.returns.length === 1
      && moveTypeEndsWith(
        authorize.returns[0],
        '::composition_v6::LoadoutAuthorizationV6',
      )
      && consume.parameters.length === 1
      && moveTypeEndsWith(
        consume.parameters[0],
        '::composition_v6::LoadoutAuthorizationV6',
      )
      && consume.returns.length === 10
      && authorizeInitial.typeParameters.length === 1
      && authorizeInitial.parameters.length === 11
      && authorizeInitial.returns.length === 1
      && moveTypeEndsWith(
        authorizeInitial.returns[0],
        '::composition_v6::InitialLoadoutAuthorizationV6',
      )
      && consumeInitial.parameters.length === 1
      && moveTypeEndsWith(
        consumeInitial.parameters[0],
        '::composition_v6::InitialLoadoutAuthorizationV6',
      )
      && consumeInitial.returns.length === 10
      && secondaryGuard.parameters.length === 8;
    const originsReady = datatypes.every((datatype) => (
      datatypeHasTypeOrigin(datatype, typeOrigin)
    ));
    record(
      'Animacraft composition v6 ABI',
      version === 6 && functionsReady && originsReady,
      version === 6 && functionsReady && originsReady
        ? `protocol_version=6; caps, profiles, official/certified/open Items, entitlements, ownership locks, loadout authorizations, and secondary-market guard verified; TypeOrigin=${typeOrigin}`
        : 'Required composition v6 ABI or stable TypeOrigin differs.',
    );
  } catch (error) {
    record('Animacraft composition v6 ABI', false, error.message);
  }
}

async function checkSealV5Abi(client, packageId, typeOriginPackageId) {
  if (!packageId || !typeOriginPackageId) return;
  try {
    const moduleName = 'seal_v5';
    const [
      approveStyle,
      approveTransitionalOutput,
      policyDatatype,
      identityDatatype,
    ] = await Promise.all([
      moveFunctionInModule(
        client,
        packageId,
        moduleName,
        'seal_approve_paid_style_v5',
      ),
      moveFunctionInModule(
        client,
        packageId,
        moduleName,
        'seal_approve_complete_output_v5',
      ),
      moveDatatypeInModule(
        client,
        packageId,
        moduleName,
        'MakerSealPolicyV5',
      ),
      moveDatatypeInModule(
        client,
        packageId,
        moduleName,
        'SealIdentityV5',
      ),
    ]);
    const typeOrigin = normalizeSuiAddress(typeOriginPackageId);
    const ready = approveStyle.parameters.length === 4
      && approveTransitionalOutput.parameters.length === 3
      && [policyDatatype, identityDatatype].every((datatype) => (
        datatypeHasTypeOrigin(datatype, typeOrigin)
      ));
    record(
      'Animacraft Seal v5 ABI',
      ready,
      ready
        ? `paid Style approval and pre-Soul transitional output approval verified; TypeOrigin=${typeOrigin}`
        : 'Required Seal v5 approval ABI or TypeOrigin differs.',
    );
  } catch (error) {
    record('Animacraft Seal v5 ABI', false, error.message);
  }
}

async function checkSoulidityCommerceV5Abi(
  client,
  callablePackageId,
  typeOriginPackageId,
) {
  if (!callablePackageId || !typeOriginPackageId) return;
  try {
    const [
      mint,
      approveOutput,
      outputProvenance,
      soulBindingProof,
    ] = await Promise.all([
      moveFunctionInModule(
        client,
        callablePackageId,
        'market',
        'mint_animacraft_v5_in_personal_kiosk_v2',
      ),
      moveFunctionInModule(
        client,
        callablePackageId,
        'animacraft_output_seal',
        'seal_approve_animacraft_complete_output_v5',
      ),
      moveDatatypeInModule(
        client,
        callablePackageId,
        'animacraft_output_provenance_v5',
        'AnimacraftOutputProvenanceV5',
      ),
      moveDatatypeInModule(
        client,
        callablePackageId,
        'animacraft_soul_binding_v5',
        'AnimacraftSoulBindingProofV5',
      ),
    ]);
    const typeOrigin = normalizeSuiAddress(typeOriginPackageId);
    const ready = mint.parameters.length === 14
      && moveTypeEndsWith(
        mint.parameters[6],
        '::commerce_v5::MakerRootV5',
      )
      && moveTypeEndsWith(
        mint.parameters[7],
        '::commerce_v5::CommerceProtocolConfigV5',
      )
      && moveTypeEndsWith(
        mint.parameters[8],
        '::commerce_v5::CommerceV5SoulMintAuthorization',
      )
      && mint.returns.length === 1
      && approveOutput.parameters.length === 6
      && datatypeHasTypeOrigin(outputProvenance, typeOrigin)
      && datatypeHasTypeOrigin(soulBindingProof, typeOrigin);
    record(
      'Soulidity Commerce v5 ABI',
      ready,
      ready
        ? `atomic v5 Soul mint, frozen output provenance, and current-owner Seal approval verified; TypeOrigin=${typeOrigin}`
        : 'Required Soulidity Commerce v5 mint, output provenance, approval ABI, or TypeOrigin differs.',
    );
  } catch (error) {
    record('Soulidity Commerce v5 ABI', false, error.message);
  }
}

async function checkSoulidityCompositionV6Abi(
  client,
  callablePackageId,
  ownerProofTypeOriginPackageId,
) {
  if (!callablePackageId || !ownerProofTypeOriginPackageId) return;
  try {
    const functionNames = [
      'authorize_initial_appearance_v6',
      'claim_free_soul_item_v6',
      'purchase_soul_item_v6',
      'lock_owned_item_to_soul_v6',
      'unlock_owned_item_from_soul_v6',
      'bind_initial_appearance_v6',
      'authorize_appearance_update_v6',
      'apply_authorized_appearance_update_v6',
      'assert_secondary_market_appearance_v6',
    ];
    const [functions, ownerProofDatatype] = await Promise.all([
      Promise.all(functionNames.map((name) => moveFunctionInModule(
        client,
        callablePackageId,
        'animacraft_appearance_adapter_v6',
        name,
      ))),
      moveDatatypeInModule(
        client,
        callablePackageId,
        'animacraft_soul_owner_proof_v6',
        'AnimacraftSoulOwnerProofV6',
      ),
    ]);
    const typeOrigin = normalizeSuiAddress(ownerProofTypeOriginPackageId);
    const expectedParameterCounts = [10, 9, 11, 8, 8, 5, 12, 6, 8];
    const functionsReady = functions.every((fn, index) => (
      fn && fn.parameters.length === expectedParameterCounts[index]
    ));
    const ready = functionsReady
      && datatypeHasTypeOrigin(ownerProofDatatype, typeOrigin);
    record(
      'Soulidity Composition v6 ABI',
      ready,
      ready
        ? `appearance adapter and owner proof verified; owner-proof TypeOrigin=${typeOrigin}`
        : 'Required Soulidity v6 appearance adapter ABI or owner-proof TypeOrigin differs.',
    );
  } catch (error) {
    record('Soulidity Composition v6 ABI', false, error.message);
  }
}

async function checkAnimacraftAbi(client, packageId, protocolFeePackageId) {
  try {
    const protocolFeeTypeOrigin = normalizeSuiAddress(protocolFeePackageId);
    const [
      versionFn,
      initializeFn,
      legacyFreeFn,
      freeFn,
      paidFn,
      legacyConsumeFn,
      canonicalConsumeFn,
      protocolFeeConfigDatatype,
      protocolTreasuryDatatype,
      protocolFeeAdminCapDatatype,
      canonicalAuthorizationDatatype,
      version,
    ] = await Promise.all([
      moveFunction(client, packageId, 'protocol_version'),
      moveFunction(client, packageId, 'initialize_protocol_fees'),
      moveFunction(client, packageId, 'authorize_soul_mint'),
      moveFunction(client, packageId, 'authorize_soul_mint_with_protocol_gate'),
      moveFunction(client, packageId, 'authorize_soul_mint_paid_with_protocol_fee'),
      moveFunction(client, packageId, 'consume_soul_mint_authorization'),
      moveFunction(client, packageId, 'consume_canonical_soul_mint_authorization'),
      moveDatatype(client, packageId, 'ProtocolFeeConfig'),
      moveDatatype(client, packageId, 'ProtocolTreasury'),
      moveDatatype(client, packageId, 'ProtocolFeeAdminCap'),
      moveDatatype(client, packageId, 'CanonicalSoulMintAuthorization'),
      simulateProtocolVersion(client, packageId),
    ]);
    // getMoveFunction resolves self-module datatype names through the original
    // package identity after an upgrade. getDatatype.definingId is the
    // authoritative TypeOrigin for types first introduced by v4.
    const canonicalTypeOriginsReady = [
      protocolFeeConfigDatatype,
      protocolTreasuryDatatype,
      protocolFeeAdminCapDatatype,
      canonicalAuthorizationDatatype,
    ].every((datatype) => datatypeHasTypeOrigin(datatype, protocolFeeTypeOrigin));
    const abiReady = versionFn.parameters.length === 0
      && versionFn.returns.length === 1
      && versionFn.returns[0]?.body?.$kind === 'u64'
      && initializeFn.typeParameters.length === 1
      && initializeFn.parameters.length === 2
      && moveTypeEndsWith(initializeFn.parameters[0], '::package::Publisher')
      && initializeFn.returns.length === 1
      && moveTypeEndsWith(initializeFn.returns[0], '::animacraft::ProtocolFeeAdminCap')
      && legacyFreeFn.parameters.length === 9
      && freeFn.parameters.length === 10
      && moveTypeEndsWith(freeFn.parameters[0], '::animacraft::OCMaker')
      && moveTypeEndsWith(freeFn.parameters[1], '::animacraft::ProtocolFeeConfig')
      && freeFn.returns.length === 1
      && moveTypeEndsWith(freeFn.returns[0], '::animacraft::CanonicalSoulMintAuthorization')
      && paidFn.typeParameters.length === 1
      && paidFn.parameters.length === 13
      && moveTypeEndsWith(paidFn.parameters[2], '::animacraft::ProtocolFeeConfig')
      && moveTypeEndsWith(paidFn.parameters[3], '::animacraft::ProtocolTreasury')
      && paidFn.returns.length === 1
      && moveTypeEndsWith(paidFn.returns[0], '::animacraft::CanonicalSoulMintAuthorization')
      && legacyConsumeFn.parameters.length === 1
      && moveTypeEndsWith(
        legacyConsumeFn.parameters[0],
        '::animacraft::SoulMintAuthorization',
      )
      && canonicalConsumeFn.parameters.length === 1
      && moveTypeEndsWith(
        canonicalConsumeFn.parameters[0],
        '::animacraft::CanonicalSoulMintAuthorization',
      )
      && canonicalTypeOriginsReady;
    record(
      'Animacraft v4 ABI',
      abiReady && version === 4,
      abiReady
        ? `protocol_version=${version}; canonical authorization TypeOrigin=${protocolFeeTypeOrigin}; gated free + paid ABI verified`
        : 'Required v4 canonical authorization shape or TypeOrigin differs.',
    );
  } catch (error) {
    record('Animacraft v4 ABI', false, error.message);
  }
}

async function checkProtocolFeeObjects(client, config, validation) {
  const configured = [
    config.protocolFeeConfigId,
    config.protocolTreasuryId,
    config.protocolFeeAdminCapId,
    config.protocolFeeAdminCapOwner,
  ].filter(Boolean);
  if (!configured.length) {
    if (config.canonicalSoulMintEnabled) {
      record('Animacraft protocol objects', false, 'Canonical minting is enabled without recorded protocol objects.');
    }
    return;
  }
  if (!validation.protocolFeeConfigReady
    || !validation.protocolTreasuryReady
    || !validation.protocolFeeAdminCapReady
    || !validation.protocolFeeAdminCapOwnerReady
    || !validation.protocolFeePackageReady) {
    record('Animacraft protocol objects', false, 'Protocol TypeOrigin, object IDs, and expected AdminCap owner must be recorded together.');
    return;
  }
  try {
    const result = await deadline('Animacraft protocol objects', () => client.core.getObjects({
      objectIds: [
        config.protocolFeeConfigId,
        config.protocolTreasuryId,
        config.protocolFeeAdminCapId,
      ],
      include: { json: true },
    }));
    const [configObject, treasuryObject, adminObject] = result.objects;
    if ([configObject, treasuryObject, adminObject].some((object) => object instanceof Error)) {
      throw new Error(result.objects.filter((object) => object instanceof Error).map((error) => error.message).join('; '));
    }
    const typeOrigin = normalizeSuiAddress(config.protocolFeePackageId);
    const configType = normalizeStructTag(`${typeOrigin}::animacraft::ProtocolFeeConfig`);
    const treasuryType = normalizeStructTag(
      `${typeOrigin}::animacraft::ProtocolTreasury<${normalizeStructTag(config.paymentCoinType)}>`,
    );
    const adminType = normalizeStructTag(`${typeOrigin}::animacraft::ProtocolFeeAdminCap`);
    const configJson = configObject.json || {};
    const treasuryJson = treasuryObject.json || {};
    const adminJson = adminObject.json || {};
    const configId = normalizeSuiAddress(config.protocolFeeConfigId);
    const treasuryId = normalizeSuiAddress(config.protocolTreasuryId);
    const adminOwner = normalizeSuiAddress(config.protocolFeeAdminCapOwner);
    const enabled = Boolean(jsonField(configJson, 'enabled'));
    const feeBps = Number(jsonField(configJson, 'primary_mint_fee_bps', 'primaryMintFeeBps'));
    const ready = normalizeStructTag(configObject.type) === configType
      && normalizeStructTag(treasuryObject.type) === treasuryType
      && normalizeStructTag(adminObject.type) === adminType
      && isSharedOwner(configObject.owner)
      && isSharedOwner(treasuryObject.owner)
      && addressOwner(adminObject.owner) === adminOwner
      && suiId(jsonField(configJson, 'treasury_id', 'treasuryId')) === treasuryId
      && suiId(jsonField(treasuryJson, 'config_id', 'configId')) === configId
      && suiId(jsonField(adminJson, 'config_id', 'configId')) === configId
      && suiId(jsonField(adminJson, 'treasury_id', 'treasuryId')) === treasuryId
      && Number(jsonField(configJson, 'version')) === 4
      && Number(jsonField(treasuryJson, 'version')) === 4
      && Number(jsonField(adminJson, 'version')) === 4
      && feeBps === Number(config.primaryProtocolFeeBps)
      && enabled === Boolean(config.canonicalSoulMintEnabled)
      && optionHasValue(jsonField(adminJson, 'publisher'));
    record(
      'Animacraft protocol objects',
      ready,
      `TypeOrigin=${typeOrigin}; USDC treasury; fee=${feeBps} bps; gate=${enabled}; AdminCap owner=${addressOwner(adminObject.owner) || 'unknown'}`,
    );
  } catch (error) {
    record('Animacraft protocol objects', false, error.message);
  }
}

export function inspectCommerceV5BindingState(configJson = {}, config = {}) {
  const logicalAuxiliaryBlobId = String(optionValue(jsonField(
    configJson,
    'logical_auxiliary_blob_id',
    'logicalAuxiliaryBlobId',
  )) || '');
  const soulBindingProofType = normalizedStructTag(String(optionValue(jsonField(
    configJson,
    'soul_binding_proof_type',
    'soulBindingProofType',
  )) || ''));
  const expectedLogicalAuxiliaryBlobId = String(
    config.commerceV5LogicalAuxiliaryBlobId || '',
  );
  const expectedSoulBindingProofType = normalizedStructTag(
    config.commerceV5SoulBindingProofType,
  );
  return {
    ready: logicalAuxiliaryBlobId === expectedLogicalAuxiliaryBlobId
      && soulBindingProofType === expectedSoulBindingProofType,
    logicalAuxiliaryBlobId,
    soulBindingProofType,
  };
}

async function checkCommerceV5Objects(client, config, validation) {
  const coreConfigured = [
    config.commerceV5TypeOriginPackageId,
    config.commerceProtocolConfigV5Id,
    config.commerceProtocolTreasuryV5Id,
  ].filter(Boolean);
  const bindingConfigured = [
    config.commerceV5LogicalAuxiliaryBlobId,
    config.commerceV5SoulBindingProofType,
  ].filter(Boolean);
  if (!coreConfigured.length && !bindingConfigured.length) {
    if (config.commerceV5ReleaseEnabled) {
      record('Animacraft commerce v5 objects', false, 'Commerce v5 is enabled without its canonical protocol objects.');
    }
    return;
  }
  if (!validation.commerceV5TypeOriginPackageReady
    || !validation.commerceProtocolConfigV5Ready
    || !validation.commerceProtocolTreasuryV5Ready
    || !validation.protocolFeeConfigReady
    || !validation.protocolFeeAdminCapReady
    || (config.commerceV5ReleaseEnabled
      && (!validation.commerceV5LogicalAuxiliaryBlobReady
        || !validation.commerceV5SoulBindingProofReady))) {
    record(
      'Animacraft commerce v5 objects',
      false,
      config.commerceV5ReleaseEnabled
        ? 'Enabled Commerce v5 requires its core objects, canonical logical Blob, Soulidity proof type, and legacy v4 authority together.'
        : 'Disabled Commerce v5 requires its complete core object tuple and legacy v4 authority; bind-once fields may remain empty.',
    );
    return;
  }
  try {
    const result = await deadline('Animacraft commerce v5 objects', () => (
      client.core.getObjects({
        objectIds: [
          config.commerceProtocolConfigV5Id,
          config.commerceProtocolTreasuryV5Id,
        ],
        include: { json: true },
      })
    ));
    const [configObject, treasuryObject] = result.objects;
    if ([configObject, treasuryObject].some((object) => object instanceof Error)) {
      throw new Error(
        result.objects
          .filter((object) => object instanceof Error)
          .map((error) => error.message)
          .join('; '),
      );
    }
    const typeOrigin = normalizeSuiAddress(config.commerceV5TypeOriginPackageId);
    const paymentType = normalizeStructTag(config.paymentCoinType);
    const configType = normalizeStructTag(
      `${typeOrigin}::commerce_v5::CommerceProtocolConfigV5`,
    );
    const treasuryType = normalizeStructTag(
      `${typeOrigin}::commerce_v5::CommerceProtocolTreasuryV5<${paymentType}>`,
    );
    const configJson = configObject.json || {};
    const treasuryJson = treasuryObject.json || {};
    const configId = normalizeSuiAddress(config.commerceProtocolConfigV5Id);
    const treasuryId = normalizeSuiAddress(config.commerceProtocolTreasuryV5Id);
    const enabled = Boolean(jsonField(configJson, 'enabled'));
    const primaryFeeBps = Number(jsonField(
      configJson,
      'primary_protocol_fee_bps',
      'primaryProtocolFeeBps',
    ));
    const fixedFee = Number(jsonField(
      configJson,
      'fixed_complete_fee_atomic',
      'fixedCompleteFeeAtomic',
    ));
    const marketFeeBps = Number(jsonField(
      configJson,
      'maker_market_fee_bps',
      'makerMarketFeeBps',
    ));
    const bindingState = inspectCommerceV5BindingState(configJson, config);
    const ready = normalizeStructTag(configObject.type) === configType
      && normalizeStructTag(treasuryObject.type) === treasuryType
      && isSharedOwner(configObject.owner)
      && isSharedOwner(treasuryObject.owner)
      && Number(jsonField(configJson, 'version')) === 5
      && Number(jsonField(treasuryJson, 'version')) === 5
      && suiId(jsonField(configJson, 'legacy_config_id', 'legacyConfigId'))
        === normalizeSuiAddress(config.protocolFeeConfigId)
      && suiId(jsonField(configJson, 'legacy_admin_cap_id', 'legacyAdminCapId'))
        === normalizeSuiAddress(config.protocolFeeAdminCapId)
      && suiId(jsonField(configJson, 'treasury_id', 'treasuryId')) === treasuryId
      && suiId(jsonField(treasuryJson, 'config_id', 'configId')) === configId
      && normalizedStructTag(jsonField(
        configJson,
        'payment_coin_type',
        'paymentCoinType',
      )) === paymentType
      && primaryFeeBps === 1_000
      && Number.isSafeInteger(fixedFee)
      && fixedFee >= 0
      && Number.isInteger(marketFeeBps)
      && marketFeeBps >= 0
      && marketFeeBps <= 1_000
      && bindingState.ready
      && enabled === Boolean(config.commerceV5ReleaseEnabled);
    record(
      'Animacraft commerce v5 objects',
      ready,
      `TypeOrigin=${typeOrigin}; fee=${primaryFeeBps} bps + ${fixedFee} atomic; market=${marketFeeBps} bps; logicalBlob=${bindingState.logicalAuxiliaryBlobId || 'unbound'}; proof=${bindingState.soulBindingProofType || 'unbound'}; gate=${enabled}`,
    );
  } catch (error) {
    record('Animacraft commerce v5 objects', false, error.message);
  }
}

function normalizedStructTag(value) {
  try {
    return normalizeStructTag(String(value || ''));
  } catch {
    return '';
  }
}

function u64Value(value) {
  let candidate = value;
  const visited = new Set();
  while (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
    visited.add(candidate);
    candidate = candidate.value
      ?? candidate.fields
      ?? candidate.balance
      ?? candidate.amount;
  }
  const number = Number(candidate);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function inspectCompositionV6ObjectState(
  objects,
  config,
  { allowEnabled = false } = {},
) {
  const [
    configObject,
    treasuryObject,
    registryObject,
    adminObject,
    validatorObject,
    v5ConfigObject,
  ] = objects || [];
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };
  if ([
    configObject,
    treasuryObject,
    registryObject,
    adminObject,
    validatorObject,
    v5ConfigObject,
  ].some((object) => !object || object instanceof Error)) {
    return {
      ready: false,
      failures: ['One or more v6/v5 protocol objects are missing.'],
      detail: 'Protocol object tuple is incomplete.',
    };
  }

  const typeOrigin = suiId(config.compositionV6TypeOriginPackageId);
  const v5TypeOrigin = suiId(config.commerceV5TypeOriginPackageId);
  const paymentType = normalizedStructTag(config.paymentCoinType);
  const configId = suiId(config.compositionProtocolConfigV6Id);
  const treasuryId = suiId(config.compositionProtocolTreasuryV6Id);
  const registryId = suiId(config.compositionRegistryV6Id);
  const adminId = suiId(config.compositionAdminCapV6Id);
  const validatorId = suiId(config.compositionValidatorCapV6Id);
  const v5ConfigId = suiId(config.commerceProtocolConfigV5Id);
  const v5AdminCapId = suiId(config.protocolFeeAdminCapId);
  const adminOwner = suiId(config.compositionAdminCapV6Owner);
  const validatorOwner = suiId(config.compositionValidatorCapV6Owner);
  const validatorEpoch = Number(config.compositionValidatorEpochV6);
  const policyCommitment = normalizeBytes32(
    config.compositionValidatorPolicyCommitmentV6,
  );
  const proofType = normalizedStructTag(config.compositionV6SoulOwnerProofType);
  const proofBindingRequired = config.compositionV6ReleaseEnabled === true
    || Boolean(proofType);
  const expectedProofType = normalizedStructTag(
    `${suiId(config.compositionV6SoulOwnerProofTypeOriginPackageId)}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
  );
  const configJson = configObject.json || {};
  const treasuryJson = treasuryObject.json || {};
  const registryJson = registryObject.json || {};
  const adminJson = adminObject.json || {};
  const validatorJson = validatorObject.json || {};
  const v5ConfigJson = v5ConfigObject.json || {};
  const expectedTypes = [
    `${typeOrigin}::composition_v6::CompositionProtocolConfigV6`,
    `${typeOrigin}::composition_v6::CompositionProtocolTreasuryV6<${paymentType}>`,
    `${typeOrigin}::composition_v6::CompositionRegistryV6`,
    `${typeOrigin}::composition_v6::CompositionAdminCapV6`,
    `${typeOrigin}::composition_v6::ValidatorCapV6`,
    `${v5TypeOrigin}::commerce_v5::CommerceProtocolConfigV5`,
  ].map(normalizedStructTag);
  [
    configObject,
    treasuryObject,
    registryObject,
    adminObject,
    validatorObject,
    v5ConfigObject,
  ].forEach((object, index) => {
    assert(
      normalizedStructTag(object.type) === expectedTypes[index],
      `Object ${index + 1} has the wrong stable TypeOrigin or generic type.`,
    );
  });
  assert(isSharedOwner(configObject.owner), 'Composition config is not shared.');
  assert(isSharedOwner(treasuryObject.owner), 'Composition treasury is not shared.');
  assert(isSharedOwner(registryObject.owner), 'Composition registry is not shared.');
  assert(isSharedOwner(v5ConfigObject.owner), 'Bound Commerce v5 config is not shared.');
  assert(
    addressOwner(adminObject.owner) === adminOwner,
    'Composition AdminCap owner differs from the recorded custodian.',
  );
  assert(
    addressOwner(validatorObject.owner) === validatorOwner,
    'ValidatorCap owner differs from the recorded validator custodian.',
  );
  [configJson, treasuryJson, registryJson, adminJson, validatorJson].forEach(
    (value, index) => assert(
      Number(jsonField(value, 'version')) === 6,
      `Composition object ${index + 1} is not version 6.`,
    ),
  );
  assert(
    Number(jsonField(v5ConfigJson, 'version')) === 5,
    'Bound Commerce config is not version 5.',
  );
  assert(
    suiId(jsonField(configJson, 'v5_config_id', 'v5ConfigId')) === v5ConfigId,
    'Composition config is bound to a different Commerce v5 config.',
  );
  assert(
    suiId(jsonField(configJson, 'v5_admin_cap_id', 'v5AdminCapId'))
      === v5AdminCapId,
    'Composition config is bound to a different v4/v5 protocol authority.',
  );
  assert(
    suiId(jsonField(configJson, 'treasury_id', 'treasuryId')) === treasuryId,
    'Composition config points to a different treasury.',
  );
  assert(
    suiId(jsonField(configJson, 'registry_id', 'registryId')) === registryId,
    'Composition config points to a different registry.',
  );
  assert(
    suiId(jsonField(configJson, 'validator_cap_id', 'validatorCapId'))
      === validatorId,
    'Composition config points to a different ValidatorCap.',
  );
  assert(
    suiId(jsonField(treasuryJson, 'config_id', 'configId')) === configId,
    'Composition treasury points to a different config.',
  );
  assert(
    suiId(jsonField(registryJson, 'config_id', 'configId')) === configId,
    'Composition registry points to a different config.',
  );
  assert(
    suiId(jsonField(adminJson, 'config_id', 'configId')) === configId,
    'Composition AdminCap points to a different config.',
  );
  assert(
    suiId(jsonField(validatorJson, 'config_id', 'configId')) === configId,
    'ValidatorCap points to a different config.',
  );
  assert(
    Number(jsonField(configJson, 'validator_epoch', 'validatorEpoch'))
      === validatorEpoch,
    'Composition config validator epoch differs from runtime configuration.',
  );
  assert(
    Number(jsonField(validatorJson, 'validator_epoch', 'validatorEpoch'))
      === validatorEpoch,
    'ValidatorCap epoch differs from the active config epoch.',
  );
  assert(
    normalizeBytes32(jsonField(
      configJson,
      'validator_policy_commitment',
      'validatorPolicyCommitment',
    )) === policyCommitment,
    'Validator policy commitment differs from runtime configuration.',
  );
  assert(
    normalizedStructTag(String(optionValue(jsonField(
      configJson,
      'soul_owner_proof_type',
      'soulOwnerProofType',
    )) || '')) === proofType,
    'Soul owner proof binding differs from runtime configuration.',
  );
  if (proofBindingRequired) {
    assert(
      proofType === expectedProofType,
      'Runtime Soul owner proof type does not use the stable Soulidity TypeOrigin.',
    );
  }
  assert(
    normalizedStructTag(jsonField(configJson, 'payment_coin_type', 'paymentCoinType'))
      === paymentType,
    'Composition config payment coin differs from native Sui USDC.',
  );
  assert(
    normalizedStructTag(jsonField(
      v5ConfigJson,
      'payment_coin_type',
      'paymentCoinType',
    )) === paymentType,
    'Commerce v5 config payment coin differs from the v6 payment coin.',
  );
  assert(
    suiId(jsonField(v5ConfigJson, 'legacy_admin_cap_id', 'legacyAdminCapId'))
      === v5AdminCapId,
    'Commerce v5 config is bound to a different legacy AdminCap.',
  );
  const primaryFeeBps = Number(jsonField(
    configJson,
    'primary_protocol_fee_bps',
    'primaryProtocolFeeBps',
  ));
  const v5PrimaryFeeBps = Number(jsonField(
    v5ConfigJson,
    'primary_protocol_fee_bps',
    'primaryProtocolFeeBps',
  ));
  assert(
    primaryFeeBps === v5PrimaryFeeBps,
    'Composition primary fee snapshot differs from Commerce v5.',
  );
  const enabled = jsonField(configJson, 'enabled') === true;
  const v5Enabled = jsonField(v5ConfigJson, 'enabled') === true;
  assert(
    enabled === (config.compositionV6ReleaseEnabled === true),
    'Composition on-chain gate differs from runtime configuration.',
  );
  assert(
    v5Enabled === (config.commerceV5ReleaseEnabled === true),
    'Bound Commerce v5 on-chain gate differs from runtime configuration.',
  );
  if (!allowEnabled) {
    assert(!enabled, 'Composition v6 must remain disabled during initial Mainnet preflight.');
    assert(
      config.compositionV6ReleaseEnabled === false,
      'Runtime composition v6 gate must remain disabled during initial Mainnet preflight.',
    );
  }
  const revenue = u64Value(jsonField(treasuryJson, 'revenue'));
  const collected = u64Value(jsonField(
    treasuryJson,
    'total_collected',
    'totalCollected',
  ));
  const withdrawn = u64Value(jsonField(
    treasuryJson,
    'total_withdrawn',
    'totalWithdrawn',
  ));
  assert(revenue !== null, 'Composition treasury revenue is not a valid u64.');
  assert(collected !== null, 'Composition treasury total_collected is not a valid u64.');
  assert(withdrawn !== null, 'Composition treasury total_withdrawn is not a valid u64.');
  assert(
    collected >= withdrawn,
    'Composition treasury total_withdrawn exceeds total_collected.',
  );
  assert(
    revenue !== null && collected !== null && withdrawn !== null
      && revenue === collected - withdrawn,
    'Composition treasury balance does not equal collected minus withdrawn.',
  );

  return {
    ready: failures.length === 0,
    failures,
    detail: `TypeOrigin=${typeOrigin}; config=${configId}; treasury=${treasuryId}; registry=${registryId}; AdminCap=${adminId} owner=${addressOwner(adminObject.owner) || 'unknown'}; ValidatorCap=${validatorId} owner=${addressOwner(validatorObject.owner) || 'unknown'} epoch=${validatorEpoch}; policy=${policyCommitment || 'missing'}; proof=${proofType || 'missing'}; fee=${primaryFeeBps} bps; gate=${enabled}`,
  };
}

async function checkCompositionV6Objects(
  client,
  config,
  deploymentStatus,
) {
  if (!deploymentStatus.declared) return;
  if (!deploymentStatus.ready) {
    record(
      'Animacraft composition v6 objects',
      false,
      'The complete runtime and deployment record must agree before chain read-back.',
    );
    return;
  }
  try {
    const result = await deadline('Animacraft composition v6 objects', () => (
      client.core.getObjects({
        objectIds: [
          config.compositionProtocolConfigV6Id,
          config.compositionProtocolTreasuryV6Id,
          config.compositionRegistryV6Id,
          config.compositionAdminCapV6Id,
          config.compositionValidatorCapV6Id,
          config.commerceProtocolConfigV5Id,
        ],
        include: { json: true },
      })
    ));
    const errors = result.objects.filter((object) => object instanceof Error);
    if (errors.length) {
      throw new Error(errors.map((error) => error.message).join('; '));
    }
    const status = inspectCompositionV6ObjectState(result.objects, config, {
      allowEnabled: allowCompositionV6Enabled,
    });
    record(
      'Animacraft composition v6 objects',
      status.ready,
      status.ready
        ? status.detail
        : `${status.detail} | ${status.failures.join(' ')}`,
    );
  } catch (error) {
    record('Animacraft composition v6 objects', false, error.message);
  }
}

async function deadline(label, task, timeout = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeout);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function loadPublicConfig() {
  const source = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename: 'public/config.js' }).runInContext(context, { timeout: 1_000 });
  return normalizeRuntimeConfig(context.window.ANIMACRAFT_CONFIG || {});
}

async function loadMainnetDeployment() {
  return JSON.parse(await readFile(
    new URL('../deployments/mainnet.json', import.meta.url),
    'utf8',
  ));
}

function recordCompositionV6Deployment(status, config) {
  if (!status.declared) return;
  record(
    'Animacraft composition v6 runtime tuple',
    status.runtimeMissing.length === 0 && status.runtimeInvalid.length === 0,
    status.runtimeMissing.length || status.runtimeInvalid.length
      ? [
        status.runtimeMissing.length
          ? `missing: ${status.runtimeMissing.join(', ')}`
          : '',
        status.runtimeInvalid.length
          ? `invalid: ${status.runtimeInvalid.join(', ')}`
          : '',
      ].filter(Boolean).join('; ')
      : config.compositionV6SoulOwnerProofType
        ? 'Complete disabled core and Soul owner-proof binding tuple is recorded.'
        : 'Complete disabled Config/Treasury/Registry/AdminCap/ValidatorCap, custody, epoch, and policy core is recorded; Soul owner-proof binding remains intentionally empty.',
  );
  record(
    'Animacraft composition v6 deployment record',
    status.deploymentMissing.length === 0 && status.mismatches.length === 0,
    status.deploymentMissing.length || status.mismatches.length
      ? [
        status.deploymentMissing.length
          ? `missing: ${status.deploymentMissing.join(', ')}`
          : '',
        status.mismatches.length
          ? `runtime/deployment mismatch: ${status.mismatches.join(', ')}`
          : '',
      ].filter(Boolean).join('; ')
      : config.compositionV6SoulOwnerProofType
        ? 'Runtime IDs, custodians, validator policy, epoch, proof, dependencies, and callable package match deployments/mainnet.json.'
        : 'Runtime core IDs, custodians, validator policy, epoch, dependencies, and callable package match deployments/mainnet.json; no proof is claimed.',
  );
  record(
    'Animacraft composition v6 deployment gate',
    allowCompositionV6Enabled || config.compositionV6ReleaseEnabled === false,
    allowCompositionV6Enabled
      ? 'Enabled-gate verification explicitly allowed for a post-activation audit.'
      : 'Initial Mainnet preflight requires the runtime and on-chain v6 gates to remain disabled.',
  );
}

function recordExpansionPackV8Deployment(status) {
  if (!status.declared) {
    record(
      'Animacraft Expansion Pack v8 deployment state',
      true,
      'Intentionally disabled: callable package and TypeOrigin are empty and the runtime/deployment gates are false.',
    );
    return;
  }
  record(
    'Animacraft Expansion Pack v8 runtime tuple',
    status.runtimeMissing.length === 0 && status.runtimeInvalid.length === 0,
    status.runtimeMissing.length || status.runtimeInvalid.length
      ? [
        status.runtimeMissing.length
          ? `missing: ${status.runtimeMissing.join(', ')}`
          : '',
        status.runtimeInvalid.length
          ? `invalid: ${status.runtimeInvalid.join(', ')}`
          : '',
      ].filter(Boolean).join('; ')
      : 'Callable package, stable TypeOrigin, and release gate are explicit and valid.',
  );
  record(
    'Animacraft Expansion Pack v8 deployment evidence',
    status.deploymentMissing.length === 0
      && status.deploymentInvalid.length === 0
      && status.mismatches.length === 0,
    status.deploymentMissing.length
      || status.deploymentInvalid.length
      || status.mismatches.length
      ? [
        status.deploymentMissing.length
          ? `missing: ${status.deploymentMissing.join(', ')}`
          : '',
        status.deploymentInvalid.length
          ? `invalid: ${status.deploymentInvalid.join(', ')}`
          : '',
        status.mismatches.length
          ? `runtime/deployment mismatch: ${status.mismatches.join(', ')}`
          : '',
      ].filter(Boolean).join('; ')
      : 'Exact package identities, gate, upgrade checkpoint, source, package digest, and v8-scoped verification evidence agree.',
  );
}

function recordCompositionV6RetirementEvidence(deployment) {
  const status = inspectCompositionV6RetirementEvidence(deployment);
  record('Animacraft composition v6 retirement evidence', status.ready, status.detail);
}

async function checkHttp(name, url, path) {
  try {
    const response = await deadline(name, (signal) => fetch(`${String(url).replace(/\/$/, '')}${path}`, { signal }));
    record(name, response.ok, `HTTP ${response.status}`);
  } catch (error) {
    record(name, false, error.message);
  }
}

async function checkWalrusRelayTipPolicy(client, config) {
  try {
    const capMist = Number(config.walrusRelayMaxTipMist);
    const relayClient = client.$extend(walrus({
      uploadRelay: {
        host: config.walrusUploadRelayUrl,
        sendTip: { max: capMist },
      },
    }));
    const [minimumQuote, maximumQuote] = await deadline(
      'Walrus relay tip policy',
      () => Promise.all([
        relayClient.walrus.calculateUploadRelayTip({ size: 1 }),
        relayClient.walrus.calculateUploadRelayTip({
          size: ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES,
        }),
      ]),
    );
    record(
      'Walrus relay tip policy',
      maximumQuote <= BigInt(capMist),
      `live minimum=${minimumQuote} MIST; 500 MiB ceiling quote=${maximumQuote} MIST; configured cap=${capMist} MIST`,
    );
  } catch (error) {
    record('Walrus relay tip policy', false, error.message);
  }
}

async function checkNetwork(
  config,
  validation,
  compositionDeploymentStatus,
  expansionPackV8DeploymentStatus,
  deployment,
) {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: config.grpcUrl });
  try {
    const result = await deadline('Sui gRPC', () => client.core.getChainIdentifier());
    record('Sui gRPC', Boolean(result.chainIdentifier), result.chainIdentifier || 'Missing chain identifier');
  } catch (error) {
    record('Sui gRPC', false, error.message);
  }

  try {
    const makerEventType = validation.originalPackageReady
      ? `${config.originalPackageId}::animacraft::OCMakerPublished`
      : null;
    const query = makerEventType
      ? `query PublishedAnimacraftMakers($type: String!) {
          chainIdentifier
          events(filter: { type: $type }, last: 1) {
            pageInfo { hasPreviousPage startCursor }
            nodes { contents { json } }
          }
        }`
      : '{ chainIdentifier }';
    const response = await deadline('Sui GraphQL', (signal) => fetch(config.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(makerEventType ? { variables: { type: makerEventType } } : {}),
      }),
      signal,
    }));
    const body = await response.json();
    const eventQueryReady = !makerEventType || Array.isArray(body.data?.events?.nodes);
    const detail = body.errors?.[0]?.message
      || (body.data?.chainIdentifier
        ? `${body.data.chainIdentifier}${makerEventType ? '; Maker event query OK' : ''}`
        : `HTTP ${response.status}`);
    record(
      'Sui GraphQL',
      response.ok && Boolean(body.data?.chainIdentifier) && eventQueryReady && !body.errors?.length,
      detail,
    );
  } catch (error) {
    record('Sui GraphQL', false, error.message);
  }

  await Promise.all([
    checkHttp('Walrus aggregator', config.walrusAggregatorUrl, '/v1/api'),
    checkHttp('Walrus upload relay', config.walrusUploadRelayUrl, '/v1/tip-config'),
    ...(validation.commerceV5LogicalAuxiliaryBlobReady
      ? [checkHttp(
        'Commerce v5 canonical logical Blob',
        config.walrusAggregatorUrl,
        `/v1/blobs/${encodeURIComponent(config.commerceV5LogicalAuxiliaryBlobId)}`,
      )]
      : []),
    ...(requireSoulidity
      ? [checkHttp('Soulidity Animacraft route', config.soulidityAppUrl, config.soulidityIntegrationPath)]
      : []),
  ]);
  await checkWalrusRelayTipPolicy(client, config);

  if (config.expansionPackV8ReleaseEnabled === true) {
    const activation = await inspectExpansionPackV8LiveActivation(client, config, deployment);
    record(
      'Animacraft Expansion Pack v8 live activation',
      activation.ready,
      activation.detail,
    );
  }

  if (expansionPackV8Only) {
    await checkExpansionPackV8PackageAbi(
      client,
      config,
      expansionPackV8DeploymentStatus,
    );
    await checkExpansionPackV8ParentObjects(client, config, deployment);
    return;
  }

  if (validation.callablePackageReady) {
    await checkAnimacraftAbi(
      client,
      config.callablePackageId,
      config.protocolFeePackageId,
    );
    if (validation.commerceV5TypeOriginPackageReady) {
      await checkCommerceV5Abi(
        client,
        config.callablePackageId,
        config.commerceV5TypeOriginPackageId,
      );
      await checkSealV5Abi(
        client,
        config.callablePackageId,
        config.commerceV5TypeOriginPackageId,
      );
    }
    if (
      compositionDeploymentStatus.declared
      && present(config.compositionV6TypeOriginPackageId)
    ) {
      await checkCompositionV6Abi(
        client,
        config.callablePackageId,
        config.compositionV6TypeOriginPackageId,
      );
    }
  }
  await checkExpansionPackV8PackageAbi(
    client,
    config,
    expansionPackV8DeploymentStatus,
  );
  await checkProtocolFeeObjects(client, config, validation);
  await checkCommerceV5Objects(client, config, validation);
  await checkCompositionV6Objects(
    client,
    config,
    compositionDeploymentStatus,
  );

  if (validation.soulidityReady) {
    const soulidityMintFunction = config.commerceV5ReleaseEnabled
      ? 'mint_animacraft_v5_in_personal_kiosk_v2'
      : (requireSoulidity || config.canonicalSoulMintEnabled)
        ? 'mint_animacraft_in_personal_kiosk'
        : 'mint_imported_in_personal_kiosk';
    try {
      const result = await deadline('Soulidity package', () => client.core.getMoveFunction({
        packageId: config.soulidityPackageId,
        moduleName: 'market',
        name: soulidityMintFunction,
      }));
      record(
        'Soulidity package',
        result.function?.name === soulidityMintFunction,
        `${config.soulidityPackageId}::market::${soulidityMintFunction}`,
      );
    } catch (error) {
      record('Soulidity package', false, error.message);
    }
    const soulidityCommerceV5Required = requireSoulidity
      || config.commerceV5ReleaseEnabled === true
      || Boolean(config.commerceV5SoulBindingProofType)
      || Boolean(config.soulidityTypeOriginPackageId);
    if (
      soulidityCommerceV5Required
      && validation.commerceV5TypeOriginPackageReady
      && validation.soulidityTypeOriginReady
    ) {
      await checkSoulidityCommerceV5Abi(
        client,
        config.soulidityPackageId,
        config.soulidityTypeOriginPackageId,
      );
    }
    const soulidityCompositionV6Required = config.compositionV6ReleaseEnabled === true
      || Boolean(config.compositionV6SoulOwnerProofType)
      || Boolean(config.compositionV6SoulOwnerProofTypeOriginPackageId);
    if (
      soulidityCompositionV6Required
      && validation.compositionV6SoulOwnerProofTypeOriginPackageReady
    ) {
      await checkSoulidityCompositionV6Abi(
        client,
        config.soulidityPackageId,
        config.compositionV6SoulOwnerProofTypeOriginPackageId,
      );
    }
  }

  const featuredIds = Object.values(config.featuredMakers || {});
  if (featuredIds.length) {
    try {
      const result = await deadline('Featured Makers', () => client.getObjects({ objectIds: featuredIds, include: { json: true } }));
      const failures = result.objects.filter((object) => object instanceof Error);
      record('Featured Makers', failures.length === 0, failures.length ? failures.map((error) => error.message).join('; ') : `${result.objects.length} object(s)`);
    } catch (error) {
      record('Featured Makers', false, error.message);
    }
  }
}

export async function runMainnetPreflight() {
  checks.length = 0;
  const config = await loadPublicConfig();
  let deployment = {};
  try {
    deployment = await loadMainnetDeployment();
  } catch (error) {
    if (requireCompositionV6 || compositionV6Declared(config)) {
      record(
        'Animacraft composition v6 deployment record',
        false,
        `deployments/mainnet.json could not be loaded: ${error.message}`,
      );
    }
    if (requireExpansionPackV8 || expansionPackV8Declared(config)) {
      record(
        'Animacraft Expansion Pack v8 deployment evidence',
        false,
        `deployments/mainnet.json could not be loaded: ${error.message}`,
      );
    }
  }
  const compositionDeploymentStatus = inspectCompositionV6Deployment(
    config,
    deployment,
    { required: requireCompositionV6 },
  );
  if (!expansionPackV8Only) {
    recordCompositionV6Deployment(compositionDeploymentStatus, config);
  }
  const expansionPackV8DeploymentStatus = inspectExpansionPackV8Deployment(
    config,
    deployment,
    {
      required: requireExpansionPackV8,
      requirePostClaim: requireExpansionPackV8PostClaim,
    },
  );
  recordExpansionPackV8Deployment(expansionPackV8DeploymentStatus);
  const activationRequired = config.expansionPackV8ReleaseEnabled === true;
  const activationDeclared = Boolean(
    deployment.releases?.expansionPackV8?.activation
      && Object.keys(deployment.releases.expansionPackV8.activation).length,
  );
  if (activationDeclared || activationRequired) {
    const activationEvidence = await inspectExpansionPackV8ActivationEvidence(deployment, {
      required: activationRequired,
    });
    record(
      'Animacraft Expansion Pack v8 activation evidence',
      activationEvidence.ready,
      activationEvidence.detail,
    );
  }
  const postClaimDeclared = Boolean(
    deployment.releases?.expansionPackV8?.postClaim
      && Object.keys(deployment.releases.expansionPackV8.postClaim).length,
  );
  if (postClaimDeclared || requireExpansionPackV8PostClaim) {
    const postClaimEvidence = await inspectExpansionPackV8PostClaimEvidence(deployment, {
      required: requireExpansionPackV8PostClaim,
    });
    record(
      'Animacraft Expansion Pack v8 post-claim evidence',
      postClaimEvidence.ready,
      postClaimEvidence.detail,
    );
  }
  if (requireExpansionPackV8) {
    recordCompositionV6RetirementEvidence(deployment);
    const parentEvidence = await inspectExpansionPackV8ParentFinalizationEvidence(deployment);
    record(
      'Animacraft Expansion Pack v8 parent finalization evidence',
      parentEvidence.ready,
      parentEvidence.detail,
    );
  }

  const validation = validateRuntimeConfig(config, { strict, requireSoulidity });
  validation.errors.forEach((message) => record('Runtime config', false, message));
  validation.warnings.forEach((message) => record('Runtime config warning', true, message));
  if (!validation.errors.length) {
    record(
      'Runtime config',
      true,
      strict
        ? 'Strict production fields are complete.'
        : 'Source configuration is structurally valid.',
    );
  }
  if (network) {
    await checkNetwork(
      config,
      validation,
      compositionDeploymentStatus,
      expansionPackV8DeploymentStatus,
      deployment,
    );
  }

  const failed = checks.filter((check) => !check.ok);
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: failed.length === 0,
      strict,
      network,
      requireCompositionV6,
      allowCompositionV6Enabled,
      requireExpansionPackV8,
      requireExpansionPackV8PostClaim,
      expansionPackV8Only,
      checks,
    }, null, 2)}\n`);
  } else {
    checks.forEach((check) => process.stdout.write(
      `${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}\n`,
    ));
    process.stdout.write(
      `\n${failed.length
        ? `${failed.length} preflight check(s) failed.`
        : 'Animacraft preflight passed.'}\n`,
    );
  }
  process.exitCode = failed.length ? 1 : 0;
  return { ok: failed.length === 0, checks: [...checks] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMainnetPreflight();
}
