import { createHash, randomBytes } from 'node:crypto';
import {
  lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase58, toBase58 } from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { assertNativeSoulSourceRevision, NATIVE_SOUL_SOURCE_ORDER, NATIVE_SOUL_SOURCE_NAMES,
  NATIVE_SOUL_KIOSK_DEPENDENCY } from './native-soul-source-cas.mjs';
import { verifyNativeSoulPublicationOutputs } from './native-soul-publication-outputs.mjs';
import { assertNativeSoulExternalPublicationEntries, NATIVE_SOUL_EXTERNAL_PUBLICATIONS } from './native-soul-external-publications.mjs';
import { buildNativeSoulBootstrapTransaction } from './native-soul-bootstrap-transactions.mjs';
import { validateNativeSoulBootstrapHistory } from './native-soul-bootstrap-history.mjs';
import { deriveMakerV8ProtocolConfigCommitment } from '../maker-v8-protocol-commitment.js';
import { assertMakerV8CatalogCommitments } from '../maker-v8-catalog-commitments.js';
import { assertMakerV8SealPolicyCommitments } from '../maker-v8-seal-policy-commitments.js';
import { assertNativeSoulBootstrapEvents } from './native-soul-bootstrap-events.mjs';
import { deriveNativeSoulBootstrapStageData } from './native-soul-bootstrap-context.mjs';
import { buildNativeSoulMarketActivationTransaction, deriveNativeSoulMarketActivationInput,
  validateNativeSoulMarketActivationHistory } from './native-soul-market-activation.mjs';

export const MAINNET_V8_RELEASE_PLAN_SCHEMA = 'animacraft.mainnet-v8-release-plan.v3';
export const MAINNET_V8_RELEASE_WAL_SCHEMA = 'animacraft.mainnet-v8-release-wal.v2';
export const MAINNET_V8_WAL_EVIDENCE_SCHEMA = 'animacraft.mainnet-v8-release-evidence.v1';
export const MAINNET_V8_FINAL_MANIFEST_SCHEMA = 'animacraft.mainnet-v8-final-manifest.v1';
export const MAINNET_V8_TRANSACTION_BINDING_DOMAIN = 'animacraft-v8/ready-transaction-binding/v1';
export const MAINNET_V8_RELEASE_RUNNER_SCHEMA = 'animacraft.mainnet-v8-release-runner.v1';
export const MAINNET_V8_SEAL_POLICY_TEMPLATE_SCHEMA = 'animacraft.mainnet-v8-seal-policy-template.v1';
export const MAINNET_V8_SEAL_POLICY_SCHEMA = 'animacraft.mainnet-v8-seal-policy.v2';
export const MAINNET_V8_SOURCE_ARTIFACT_DOMAIN = 'animacraft-v8/source-artifact/v2';
export const MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN = 'animacraft-v8/package-artifact/v1';
export const MAINNET_V8_ABI_ARTIFACT_DOMAIN = 'animacraft-v8/abi-artifact/v1';
export const MAINNET_V8_KEY_SERVER_SET_DOMAIN = 'animacraft-v8/seal-key-server-set/v1';
export const MAINNET_V8_ENCRYPTION_POLICY_DOMAIN = 'animacraft-v8/seal-encryption-policy/v1';

export const MAINNET_V8_CHAIN_IDENTIFIER = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
export const MAINNET_V8_LEGACY_CHAIN_IDENTIFIER = '35834a8a';
export const MAINNET_V8_PAYMENT_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const MAINNET_V8_SUI_VERSION = '1.80.1';
export const MAINNET_V8_SUI_VERSION_OUTPUT = 'sui 1.80.1-671ba71e69c7';
export const MAINNET_V8_SUI_SOURCE_COMMIT = '671ba71e69c711ded76a11ef90297c4f2d5ac474';
export const MAINNET_V8_SUI_BINARY_SHA256 = '1d7baa7c7314113671415acfa20279b1eedb6ae6d04f286988a00da285e769c3';
export const MAINNET_V8_FRAMEWORK_REVISION = '722ac4fcf4841346c91775f596c4ce23fb7fbd0f';
export const MAINNET_V8_RELEASE_SIGNER = '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f';
export const MAINNET_V8_BROWSER_KEY_SERVER_TYPE = '0x9636e0c761e7476b8579cb13d543838e3732ca482dc0a64f086f57b60c024e23::key_server::KeyServer';
// Public Mainnet identity pins, independently read from raw BCS. This is the
// sole new-release topology; it grants no application access permissions.
export const MAINNET_V8_BROWSER_KEY_SERVERS = Object.freeze([
  Object.freeze({
    objectId: '0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6',
    owner: '0x02189430bd03a05813f0b5998dd6e400d21e831d31f609bb0142b869e0fa020b',
    contentSha256: '0e67a28214d9fb8efda434666a9c1d32f92c885f5df8b75e32c4377e45c8354a',
    url: 'https://seal-mainnet-open.overclock.run',
  }),
  Object.freeze({
    objectId: '0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10',
    owner: '0x13cdcfab1a3db17a9723c165fefa68d44066f8f846b06c8045d6c86353b7c2b0',
    contentSha256: 'ea78f93d1f18b83d4524e21fb25e4f0ea9e2cfbf2b9777f9af3119fda4a46aa8',
    url: 'https://open.key-server.mainnet.seal.mirai.cloud',
  }),
]);
export const MAINNET_V8_BROWSER_SEAL_THRESHOLD = '2';
export const MAINNET_V8_PROTOCOL_PROFILE = Object.freeze({
  protocolVersion: '137',
  objectRuntimeMaxNumCachedObjects: '1000',
  objectRuntimeMaxNumStoreEntries: '1000',
});

export const MAINNET_V8_ROLE_ORDER = Object.freeze([
  'core', 'seal', 'runtime', 'output', 'physical', 'market', 'release',
]);

// Publication identity includes Soulidity; Catalog commitments remain seven roles.
export const MAINNET_V8_PUBLISH_ORDER = NATIVE_SOUL_SOURCE_ORDER;
export const MAINNET_V8_PUBLISH_PACKAGE_NAMES = NATIVE_SOUL_SOURCE_NAMES;

// Catalog roles are not a source or publication dependency graph. Source edges
// come from the authenticated eight-package snapshot; exact publish dependencies
// come from the compiler output bound into each package artifact.

export const MAINNET_V8_PACKAGE_NAMES = Object.freeze(Object.fromEntries(
  MAINNET_V8_ROLE_ORDER.map((role) => [role, `animacraft_v8_${role}`]),
));

export const MAINNET_V8_RELEASE_STEPS = Object.freeze([
  ...MAINNET_V8_PUBLISH_ORDER.map((role, ordinal) => Object.freeze({
    ordinal: String(ordinal), kind: 'PUBLISH', role,
  })),
  Object.freeze({ ordinal: '8', kind: 'INITIALIZE_PROTOCOL', role: 'core' }),
  Object.freeze({ ordinal: '9', kind: 'SETUP_RELEASE', role: 'release' }),
  Object.freeze({ ordinal: '10', kind: 'BEGIN_BOOTSTRAP', role: 'core' }),
  Object.freeze({ ordinal: '11', kind: 'FINALIZE_BOOTSTRAP', role: 'core' }),
  Object.freeze({ ordinal: '12', kind: 'ACTIVATE_SOULIDITY_MARKET', role: 'soulidity' }),
  Object.freeze({ ordinal: '13', kind: 'VERIFY_AND_EXPORT', role: null }),
]);

export const MAINNET_V8_WAL_STATUSES = Object.freeze([
  'READY', 'SIGNED', 'OUTCOME_PENDING', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN',
  'FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE',
  'EXPIRED_NOT_FOUND', 'INCIDENT_STOPPED', 'FINAL_MANIFEST_SEALED', 'RELEASE_ABANDONED',
]);

export const MAINNET_V8_REPAIRABLE_READBACK_INCIDENTS = Object.freeze([
  'MAINNET_V8_CREATED_OUTPUT_INVALID', 'MAINNET_V8_PACKAGE_BYTES_DRIFT',
  'MAINNET_V8_INIT_WRITE_SET_INVALID', 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID',
  'NATIVE_SOUL_BOOTSTRAP_EFFECTS_INVALID', 'NATIVE_SOUL_BOOTSTRAP_RELATION_INVALID',
  'NATIVE_SOUL_BOOTSTRAP_WRITE_SET_INVALID', 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID',
  'NATIVE_SOUL_MARKET_ACTIVATION_INVALID',
]);

export const MAINNET_V8_SEAL_APPROVALS = Object.freeze([
  Object.freeze({ scope: 'BASE', function: 'seal_approve_base_v8' }),
  Object.freeze({ scope: 'PACK', function: 'seal_approve_pack_v8' }),
  Object.freeze({ scope: 'COMPLETE', function: 'seal_approve_complete_v8' }),
]);

const HASH = /^[0-9a-f]{64}$/;
const FULL_ID = /^0x[0-9a-f]{64}$/;
const GIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A complete ten-ordinal release intentionally retains every READY artifact,
// package ABI certificate, and its immediate predecessor certificate.  The
// seven package boundary can therefore exceed 200k nodes while remaining
// bounded by the fixed release topology and the per-artifact limits below.
const MAX_JSON_NODES = 500_000;
const MAX_JSON_DEPTH = 128;
const MAX_CANONICAL_BYTES = 128 * 1024 * 1024;
const ZERO_HASH = '0'.repeat(64);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const encoder = new TextEncoder();
const MAINNET_LEDGER_SERVICE = 'sui.rpc.v2.LedgerService';
const MAINNET_GET_TRANSACTION = 'GetTransaction';
const SUI_EVENT_BCS = bcs.struct('MainnetV8ReleaseLibSuiEvent', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const SUI_TRANSACTION_EVENTS_BCS = bcs.struct('MainnetV8ReleaseLibTransactionEvents', {
  data: bcs.vector(SUI_EVENT_BCS),
});
const UPGRADE_CAP_BCS = bcs.struct('MainnetV8ReleaseLibUpgradeCap', {
  id: bcs.Address,
  package: bcs.Address,
  version: bcs.u64(),
  policy: bcs.u8(),
});
const PROTOCOL_CONFIG_BCS = bcs.struct('MainnetV8ReleaseLibProtocolConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address,
  revision: bcs.u64(),
  treasury_id: bcs.option(bcs.Address),
  payment_coin_type: bcs.string(),
  primary_content_fee_bps: bcs.u16(),
  fixed_complete_fee_atomic: bcs.u64(),
  maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const PROTOCOL_ADMIN_CAP_BCS = bcs.struct('MainnetV8ReleaseLibProtocolAdminCap', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
});

const SOURCE_FIELDS = Object.freeze([
  'domain', 'role', 'packageName', 'release', 'toolchain', 'originalFiles', 'files',
]);
const SOURCE_RELEASE_FIELDS = Object.freeze(['snapshotSha256', 'repository', 'baseGitCommit', 'baseGitTree']);
const TOOLCHAIN_FIELDS = Object.freeze([
  'suiVersion', 'suiVersionOutput', 'suiSourceCommit', 'suiBinarySha256', 'frameworkRevision',
]);
const SOURCE_FILE_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const PACKAGE_FIELDS = Object.freeze(['domain', 'role', 'modules', 'dependencies', 'buildDigest']);
const PACKAGE_MODULE_FIELDS = Object.freeze(['name', 'bytesBase64', 'byteLength', 'sha256']);
const ABI_FIELDS = Object.freeze(['domain', 'role', 'modules']);
const ABI_MODULE_FIELDS = Object.freeze(['name', 'datatypes', 'functions']);
const SEAL_POLICY_FIELDS = Object.freeze([
  'schemaVersion', 'keyServers', 'threshold', 'keyServerSetArtifact',
  'keyServerSetCommitment', 'encryptionPolicyArtifact', 'encryptionPolicyCommitment',
]);
const SEAL_POLICY_TEMPLATE_FIELDS = Object.freeze([
  'schemaVersion', 'keyServers', 'threshold', 'keyServerSetArtifact',
  'keyServerSetCommitment',
]);
const KEY_SERVER_FIELDS = Object.freeze(['objectId', 'weight']);
const KEY_SERVER_SET_FIELDS = Object.freeze(['domain', 'chainIdentifier', 'keyServers', 'threshold']);
const ENCRYPTION_FIELDS = Object.freeze([
  'domain', 'version', 'module', 'approvalFunctions', 'holderReadLifecycle',
  'sealPackageCommitment', 'sealAbiCommitment',
]);
const APPROVAL_FIELDS = Object.freeze(['scope', 'function']);
const PLAN_FIELDS = Object.freeze([
  'schemaVersion', 'chain', 'sender', 'sourceRevision', 'toolchain',
  'protocolProfile', 'paymentCoinType', 'sealPolicy', 'packages', 'steps', 'executionPlanId',
]);
const CHAIN_FIELDS = Object.freeze(['network', 'chainIdentifier', 'legacyChainIdentifier']);
const PLAN_PACKAGE_FIELDS = Object.freeze([
  'role', 'packageName', 'sourceArtifact', 'sourceCommitment',
]);
const STEP_FIELDS = Object.freeze(['ordinal', 'kind', 'role']);
const WAL_FIELDS = Object.freeze([
  'schemaVersion', 'executionPlanId', 'releaseId', 'finalManifest', 'plan',
  'revision', 'headEventSha256', 'events', 'walSha256',
]);
const WAL_EVENT_FIELDS = Object.freeze([
  'executionPlanId', 'releaseId', 'revision', 'ordinal', 'attempt', 'status', 'evidence', 'recordedAt',
  'previousEventSha256', 'eventSha256',
]);
const WAL_CURSOR_FIELDS = Object.freeze(['ordinal', 'attempt']);
const WAL_READY_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'cursor', 'readyArtifact', 'readyArtifactSha256',
  'unsignedEnvelope', 'transactionBindingSha256',
]);
const WAL_SIGNED_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'cursor', 'readyArtifactSha256',
  'signedArtifact', 'signedArtifactSha256',
]);
const WAL_OUTCOME_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'cursor', 'readyArtifactSha256',
  'signedArtifact', 'signedArtifactSha256', 'digest', 'observation', 'observationSha256',
]);
const WAL_VERIFY_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'cursor', 'readyArtifactSha256',
  'observation', 'observationSha256',
]);
const WAL_MANIFEST_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'cursor', 'finalManifest', 'releaseId',
]);
const WAL_ABANDON_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'cursor', 'releaseId', 'finalManifestSha256',
  'reason', 'reasonSha256',
]);
const WAL_ABANDON_REASON_FIELDS = Object.freeze([
  'code', 'failedOrdinal', 'errorCode', 'moveAbort',
]);
const WAL_ABANDON_MOVE_ABORT_FIELDS = Object.freeze([
  'packageId', 'module', 'function', 'abortCode',
]);
const FINAL_MANIFEST_FIELDS = Object.freeze([
  'schemaVersion', 'executionPlanId', 'chainIdentifier', 'sender', 'packages',
  'sealPolicy', 'releaseId',
]);
const FINAL_MANIFEST_PACKAGE_FIELDS = Object.freeze([
  'role', 'packageId', 'packageDigest', 'packageVersion', 'upgradeCapId',
  'publishDigest', 'sourceCommitment', 'packageCommitment', 'abiCommitment',
  'finalityEvidenceSha256', 'readbackSha256',
]);
const SIGNED_ARTIFACT_FIELDS = Object.freeze([
  'transactionBase64', 'transactionSha256', 'transactionKindBase64',
  'transactionKindSha256', 'digest', 'signature', 'signatureSha256',
  'senderSignedDataBase64', 'senderSignedDataSha256', 'signer',
]);
const UNSIGNED_ENVELOPE_FIELDS = Object.freeze([
  'transactionBase64', 'transactionByteLength', 'transactionSha256',
  'transactionKindBase64', 'transactionKindSha256', 'digest', 'sender',
  'gasOwner', 'gasBudget', 'gasPrice', 'expiration',
]);
const PUBLISH_READY_FIELDS = Object.freeze([
  'kind', 'role', 'packageArtifact', 'packageCommitment',
  'modules', 'dependencies', 'publishedTomlSha256', 'simulation',
  'gasFunding', 'protocolProfile', 'predecessorReadback',
]);
const STAGE_READY_FIELDS = Object.freeze([
  'kind', 'stageData', 'stageDataSha256', 'publishedTomlSha256',
  'simulation', 'gasFunding', 'protocolProfile', 'predecessorReadback',
]);
const PROTOCOL_PROFILE_FIELDS = Object.freeze([
  'chainIdentifier', 'protocolVersion', 'epoch', 'gasPrice', 'attributes',
]);
const PROTOCOL_ATTRIBUTES_FIELDS = Object.freeze([
  'objectRuntimeMaxNumCachedObjects', 'objectRuntimeMaxNumStoreEntries',
]);
const SIMULATION_FIELDS = Object.freeze([
  'digest', 'effectsTransactionDigest', 'effectsBcsBase64', 'gasUsed', 'recommendedGasBudget',
  'changedObjects', 'objectTypes',
]);
const GAS_USED_FIELDS = Object.freeze([
  'computationCost', 'storageCost', 'storageRebate', 'nonRefundableStorageFee',
]);
const GAS_FUNDING_FIELDS = Object.freeze([
  'coinType', 'addressBalance', 'coinBalance', 'checkedAtEpoch',
]);
const PREDECESSOR_READBACK_FIELDS = Object.freeze([
  'ordinal', 'certificate', 'certificateSha256',
]);
const OBSERVATION_FIELDS = Object.freeze(['kind', 'details', 'detailsSha256']);
const BROADCAST_INTENT_FIELDS = Object.freeze([
  'firstQuery', 'firstQuerySha256', 'watermark', 'secondQuery', 'secondQuerySha256',
]);
const WATERMARK_FIELDS = Object.freeze(['epoch', 'checkpointSequence', 'checkpointDigest']);
const NOT_FOUND_QUERY_FIELDS = Object.freeze([
  'kind', 'code', 'service', 'method', 'digest', 'signedArtifactSha256',
  'chainIdentifier', 'endpoint', 'observedAt', 'afterWatermark',
]);
const VALID_DURING_FIELDS = Object.freeze([
  'minEpoch', 'maxEpoch', 'minTimestamp', 'maxTimestamp', 'chain', 'nonce',
]);
const FINALITY_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'digest', 'checkpoint', 'epoch', 'transactionBase64',
  'transactionSha256', 'signature', 'signatureSha256', 'effectsBcsBase64',
  'effectsSha256', 'effectsDigest', 'effectsStatus', 'eventsDigest', 'transactionEvents',
]);
const FINALITY_CERTIFICATE_FIELDS = Object.freeze([
  'finalityEvidence', 'finalityEvidenceSha256', 'readback', 'readbackSha256',
]);
const VERIFY_CERTIFICATE_FIELDS = Object.freeze([
  'verification', 'verificationSha256', 'exports', 'exportsSha256',
]);
const BROADCAST_RESPONSE_FIELDS = Object.freeze(['digest', 'status', 'effectsBcsBase64']);
const RPC_ERROR_FIELDS = Object.freeze(['code', 'message', 'service', 'method', 'details']);
const INCIDENT_FIELDS = Object.freeze(['code', 'message', 'details']);
const VERIFY_INCIDENT_CONTEXT_FIELDS = Object.freeze([
  'executionPlanId', 'releaseId', 'finalManifestSha256', 'bootstrapCertificateSha256',
  'marketActivationCertificateSha256',
  'check', 'expectedSha256', 'observedSha256',
]);
const EXPIRATION_CERTIFICATE_FIELDS = Object.freeze([
  'kind', 'digest', 'firstQuery', 'watermark', 'secondQuery', 'expiration',
]);
const EFFECT_REFERENCE_FIELDS = Object.freeze([
  'operation', 'objectId', 'version', 'digest', 'owner',
]);
const OBJECT_REFERENCE_FIELDS = Object.freeze(['objectId', 'version', 'digest']);
const MOVE_OUTPUT_FIELDS = Object.freeze([
  'reference', 'type', 'owner', 'previousTransaction', 'fields',
  'contentBcsBase64', 'contentBcsSha256', 'objectBcsBase64', 'objectBcsSha256',
]);
const UPGRADE_CAP_MOVE_FIELDS = Object.freeze(['id', 'package', 'policy', 'version']);
const PROTOCOL_CONFIG_MOVE_FIELDS = Object.freeze([
  'id', 'version', 'core_original_package_id', 'core_callable_package_id',
  'revision', 'treasury_id', 'payment_coin_type', 'primary_content_fee_bps',
  'fixed_complete_fee_atomic', 'maker_market_fee_bps', 'soul_market_fee_bps',
  'enabled', 'commitment',
]);
const PROTOCOL_ADMIN_MOVE_FIELDS = Object.freeze(['id', 'version', 'config_id']);
const PACKAGE_PUBLISH_CERTIFICATE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'role', 'transactionDigest', 'package',
  'upgradeCap', 'protocolConfig', 'protocolAdminCap', 'soulidityInitialization',
]);
const PACKAGE_READBACK_FIELDS = Object.freeze([
  'schemaVersion', 'role', 'transactionDigest', 'reference', 'moduleMapSha256',
  'objectBcsSha256', 'objectBcsBase64', 'dependencyPackages', 'typeOrigins', 'linkage', 'descriptor', 'abiArtifact',
]);
const PACKAGE_TYPE_ORIGIN_FIELDS = Object.freeze(['moduleName', 'datatypeName', 'package']);
const PACKAGE_LINKAGE_FIELDS = Object.freeze(['originalId', 'upgradedId', 'upgradedVersion']);
const VERIFY_RECORD_FIELDS = Object.freeze([
  'kind', 'executionPlanId', 'releaseId', 'finalManifestSha256',
  'packageVerification', 'packageVerificationSha256', 'runtimeAttestationSha256',
  'marketActivationCertificateSha256',
]);
const FINAL_PACKAGE_VERIFICATION_FIELDS = Object.freeze([
  'kind', 'executionPlanId', 'releaseId', 'packages',
]);
const FINAL_PACKAGE_VERIFICATION_ROW_FIELDS = Object.freeze([
  'role', 'packageId', 'packageDigest', 'packageVersion', 'publishDigest',
  'sourceCommitment', 'packageCommitment', 'abiCommitment',
  'moduleMapSha256', 'objectBcsSha256', 'readbackSha256',
]);
const VERIFY_EXPORT_FIELDS = Object.freeze([
  'filename', 'sha256', 'protectedDecryptionReady',
]);
const VERIFY_STAGE_DATA_FIELDS = Object.freeze([
  'releaseId', 'finalManifestSha256', 'bootstrapCertificateSha256', 'exportFilename',
  'marketActivationCertificateSha256',
]);
const NATIVE_BOOTSTRAP_STAGE_KINDS = Object.freeze([
  'INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP',
]);
const KEY_SERVER_CERTIFICATE_FIELDS = Object.freeze([
  'objectId', 'type', 'version', 'digest', 'owner', 'previousTransaction', 'contentSha256',
]);
const SECRET_FIELD = /^(?:api[-_]?key(?:[-_]?(?:header|value))?|x[-_]?api[-_]?key|authorization|credentials?|bearer|(?:access|auth|bearer|github|vercel|enoki)[-_]?token|token|password|passwd|mnemonic|private[-_]?key|client[-_]?secret|secret|secret[-_]?access[-_]?key|access[-_]?key[-_]?id|(?:sui[-_]?)?keystore|cookie|session[-_]?cookie)$/i;

const ABI_STRIPPED_KEYS = new Set([
  'doc', 'docs', 'documentation', 'source', 'sourcemap', 'sourcefile',
  'sourcefiles', 'sourcelocation', 'sourcelocations', 'location', 'locations',
  'file', 'filename', 'line', 'column', 'span', 'start', 'end',
]);

export class MainnetV8ReleaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MainnetV8ReleaseError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new MainnetV8ReleaseError(code, message, details);
}

function isPlain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, expected, label) {
  if (!isPlain(value)) fail('MAINNET_V8_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort(compareMainnetV8Text);
  const fields = [...expected].sort(compareMainnetV8Text);
  if (actual.length !== fields.length
    || actual.some((field, index) => field !== fields[index])) {
    fail('MAINNET_V8_FIELDS_INVALID', `${label} has fields outside its exact schema.`, {
      actual, expected: fields,
    });
  }
  return value;
}

function assertNoSecretFields(value, label) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isPlain(current)) continue;
    for (const [key, entry] of Object.entries(current)) {
      if (SECRET_FIELD.test(key)) {
        fail('MAINNET_V8_SECRET_MATERIAL_FORBIDDEN', `${label} contains forbidden credential field ${key}.`);
      }
      if (entry && typeof entry === 'object') pending.push(entry);
    }
  }
  return value;
}

function boundedText(value, label, maximum = 4096, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)
    || encoder.encode(value).length > maximum) {
    fail('MAINNET_V8_TEXT_INVALID', `${label} must be bounded UTF-8 text.`);
  }
  return value;
}

export function compareMainnetV8Text(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertMainnetV8DeterministicJson(value, label = 'Value') {
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (entry, path, depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} exceeds the deterministic JSON budget.`, { path });
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry) || Object.is(entry, -0)) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-canonical number.`, { path });
      }
      return;
    }
    if (typeof entry !== 'object') {
      fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-JSON value.`, { path });
    }
    if (seen.has(entry)) fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a cycle.`, { path });
    seen.add(entry);
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype
        || Object.getOwnPropertySymbols(entry).length > 0) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-plain array.`, { path });
      }
      const keys = Object.keys(entry);
      const ownKeys = Reflect.ownKeys(entry);
      if (keys.length !== entry.length || keys.some((key, index) => key !== String(index))
        || ownKeys.length !== entry.length + 1 || ownKeys.at(-1) !== 'length') {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a sparse or decorated array.`, { path });
      }
      for (let index = 0; index < entry.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains an array accessor.`, { path: `${path}[${index}]` });
        }
        visit(descriptor.value, `${path}[${index}]`, depth + 1);
      }
    } else {
      if (!isPlain(entry) || Object.getOwnPropertySymbols(entry).length > 0) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-plain record.`, { path });
      }
      const keys = Object.keys(entry);
      if (Reflect.ownKeys(entry).length !== keys.length) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains hidden record data.`, { path });
      }
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a record accessor.`, { path: `${path}.${key}` });
        }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(entry);
  };
  visit(value, '$', 0);
  return value;
}

function canonicalJsonUnchecked(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonUnchecked).join(',')}]`;
  return `{${Object.keys(value).sort(compareMainnetV8Text)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonUnchecked(value[key])}`).join(',')}}`;
}

export function canonicalMainnetV8Json(value) {
  assertMainnetV8DeterministicJson(value, 'Canonical JSON value');
  const canonical = canonicalJsonUnchecked(value);
  if (encoder.encode(canonical).length > MAX_CANONICAL_BYTES) {
    fail('MAINNET_V8_CANONICAL_BYTES_EXCEEDED', 'Canonical JSON exceeds its byte budget.');
  }
  return canonical;
}

function asBytes(value, label = 'Bytes') {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  fail('MAINNET_V8_BYTES_INVALID', `${label} must be UTF-8 text or Uint8Array.`);
}

export function sha256MainnetV8Bytes(value) {
  return createHash('sha256').update(asBytes(value)).digest('hex');
}

export function sha256MainnetV8Json(value) {
  return sha256MainnetV8Bytes(canonicalMainnetV8Json(value));
}

export function mainnetV8TypedDigest(name, value) {
  boundedText(name, 'Typed digest name', 128);
  const bytes = asBytes(value, `${name} typed digest bytes`);
  const domain = encoder.encode(`${name}::`);
  const input = new Uint8Array(domain.length + bytes.length);
  input.set(domain);
  input.set(bytes, domain.length);
  return toBase58(blake2b(input, { dkLen: 32 }));
}

export function assertMainnetV8Decimal(value, label = 'Decimal', options = {}) {
  const { positive = false, maximum = null } = options;
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    fail('MAINNET_V8_DECIMAL_INVALID', `${label} must be a canonical decimal string.`);
  }
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || (maximum !== null && parsed > BigInt(maximum))) {
    fail('MAINNET_V8_DECIMAL_INVALID', `${label} is outside its allowed range.`, { value });
  }
  return parsed;
}

function decimalInput(value, label, options) {
  if (typeof value === 'bigint') value = value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) value = String(value);
  assertMainnetV8Decimal(value, label, options);
  return value;
}

export function normalizeMainnetV8ObjectId(value, label = 'Sui object ID') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    fail('MAINNET_V8_OBJECT_ID_INVALID', `${label} must be a Sui object ID.`);
  }
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
}

function assertFullId(value, label) {
  if (!FULL_ID.test(value) || value === `0x${ZERO_HASH}`) {
    fail('MAINNET_V8_OBJECT_ID_INVALID', `${label} must be one nonzero canonical 32-byte Sui ID.`);
  }
  return value;
}

function assertHash(value, label) {
  if (!HASH.test(value)) fail('MAINNET_V8_HASH_INVALID', `${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function assertSuiDigest(value, label) {
  try {
    if (typeof value !== 'string' || !BASE58.test(value)) throw new Error('shape');
    const bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('canonical');
    return value;
  } catch {
    fail('MAINNET_V8_SUI_DIGEST_INVALID', `${label} must be one canonical 32-byte Sui digest.`);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function cloneJson(value) {
  assertMainnetV8DeterministicJson(value);
  return JSON.parse(canonicalJsonUnchecked(value));
}

function decodeCanonicalBase64(value, label) {
  boundedText(value, label, 16 * 1024 * 1024);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('MAINNET_V8_BASE64_INVALID', `${label} is not canonical Base64.`);
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== value) {
    fail('MAINNET_V8_BASE64_INVALID', `${label} is not canonical Base64.`);
  }
  return bytes;
}

function assertGitId(value, label) {
  if (!GIT_ID.test(value)) fail('MAINNET_V8_GIT_ID_INVALID', `${label} must be a lowercase Git object ID.`);
  return value;
}

function assertToolchain(toolchain, label = 'toolchain') {
  exactFields(toolchain, TOOLCHAIN_FIELDS, label);
  if (toolchain.suiVersion !== MAINNET_V8_SUI_VERSION) {
    fail('MAINNET_V8_TOOLCHAIN_INVALID', `${label}.suiVersion must be the exact official release version.`, {
      expected: MAINNET_V8_SUI_VERSION,
      observed: toolchain.suiVersion,
    });
  }
  if (toolchain.suiVersionOutput !== MAINNET_V8_SUI_VERSION_OUTPUT
    || toolchain.suiSourceCommit !== MAINNET_V8_SUI_SOURCE_COMMIT) {
    fail('MAINNET_V8_TOOLCHAIN_INVALID', `${label} does not bind the exact Sui source release identity.`, {
      expectedVersionOutput: MAINNET_V8_SUI_VERSION_OUTPUT,
      observedVersionOutput: toolchain.suiVersionOutput,
      expectedSourceCommit: MAINNET_V8_SUI_SOURCE_COMMIT,
      observedSourceCommit: toolchain.suiSourceCommit,
    });
  }
  assertHash(toolchain.suiBinarySha256, `${label}.suiBinarySha256`);
  if (toolchain.suiBinarySha256 !== MAINNET_V8_SUI_BINARY_SHA256) {
    fail('MAINNET_V8_TOOLCHAIN_INVALID', `${label}.suiBinarySha256 is not the reviewed release binary.`, {
      expected: MAINNET_V8_SUI_BINARY_SHA256,
      observed: toolchain.suiBinarySha256,
    });
  }
  if (toolchain.frameworkRevision !== MAINNET_V8_FRAMEWORK_REVISION) {
    fail('MAINNET_V8_TOOLCHAIN_INVALID', `${label}.frameworkRevision must match the exact Move.toml framework pin.`, {
      expected: MAINNET_V8_FRAMEWORK_REVISION,
      observed: toolchain.frameworkRevision,
    });
  }
  return toolchain;
}

function assertSourcePath(value, label) {
  boundedText(value, label, 4096);
  if (value.includes('\\') || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')
    || !['Move.toml', 'Move.lock'].includes(value)
      && !/^sources\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z_][A-Za-z0-9_]*\.move$/.test(value)) {
    fail('MAINNET_V8_SOURCE_PATH_INVALID', `${label} is outside the exact Move source artifact set.`, { value });
  }
  return value;
}

export function mainnetV8SourceFileRecord(path, bytes) {
  assertSourcePath(path, 'Source file path');
  const content = asBytes(bytes, `Source file ${path}`);
  return deepFreeze({
    path,
    byteLength: String(content.length),
    sha256: sha256MainnetV8Bytes(content),
  });
}

export function assertMainnetV8SourceArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'Source artifact');
  exactFields(artifact, SOURCE_FIELDS, 'Source artifact');
  if (artifact.domain !== MAINNET_V8_SOURCE_ARTIFACT_DOMAIN) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact domain is invalid.');
  }
  if (!NATIVE_SOUL_SOURCE_ORDER.includes(artifact.role) || artifact.packageName !== NATIVE_SOUL_SOURCE_NAMES[artifact.role]) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact does not identify one current source package.');
  }
  exactFields(artifact.release, SOURCE_RELEASE_FIELDS, 'Source artifact release');
  assertGitId(artifact.release.baseGitCommit, 'Source artifact release.baseGitCommit');
  assertGitId(artifact.release.baseGitTree, 'Source artifact release.baseGitTree');
  assertHash(artifact.release.snapshotSha256, 'Source artifact snapshotSha256');
  if (artifact.release.repository !== (artifact.role === 'soulidity' ? 'soulidity' : 'animacraft')) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact repository is incorrect.');
  }
  assertToolchain(artifact.toolchain, 'Source artifact toolchain');
  for (const list of [artifact.originalFiles, artifact.files]) {
    if (!Array.isArray(list) || list.length < 3 || list.length > 2000) fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Bounded original/build inventory required.');
    list.forEach((file, index) => {
      exactFields(file, SOURCE_FILE_FIELDS, 'Source file'); assertSourcePath(file.path, 'Source file path');
      assertHash(file.sha256, 'Source file sha256'); assertMainnetV8Decimal(file.byteLength, 'Source byteLength');
      if (BigInt(file.byteLength) > 4n * 1024n * 1024n || (index > 0 && list[index - 1].path >= file.path)) {
        fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source bounds/order invalid.');
      }
    });
  }
  if (canonicalMainnetV8Json(artifact.originalFiles.map(row => row.path)) !== canonicalMainnetV8Json(artifact.files.map(row => row.path))
    || artifact.files.some((row, index) => row.path.startsWith('sources/') && canonicalMainnetV8Json(row) !== canonicalMainnetV8Json(artifact.originalFiles[index]))) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Original/build source files differ outside manifests.');
  }
  if (!Array.isArray(artifact.files) || artifact.files.length < 3) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact must contain Move.toml, Move.lock, and Move sources.');
  }
  const paths = new Set();
  artifact.files.forEach((file, index) => {
    exactFields(file, SOURCE_FILE_FIELDS, `Source artifact files[${index}]`);
    assertSourcePath(file.path, `Source artifact files[${index}].path`);
    assertMainnetV8Decimal(file.byteLength, `Source artifact files[${index}].byteLength`);
    assertHash(file.sha256, `Source artifact files[${index}].sha256`);
    if (paths.has(file.path)) fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact contains a duplicate path.', { path: file.path });
    paths.add(file.path);
    if (index > 0 && compareMainnetV8Text(artifact.files[index - 1].path, file.path) >= 0) {
      fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact files are not strictly protocol-sorted.');
    }
  });
  if (!paths.has('Move.toml') || !paths.has('Move.lock')
    || !artifact.files.some(({ path }) => path.startsWith('sources/'))) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact omits required Move sources.');
  }
  return artifact;
}

export function buildMainnetV8SourceArtifact(input) {
  const role = input?.role;
  const artifact = {
    domain: MAINNET_V8_SOURCE_ARTIFACT_DOMAIN,
    role,
    packageName: input.packageName ?? NATIVE_SOUL_SOURCE_NAMES[role],
    release: cloneJson(input.release),
    toolchain: cloneJson(input.toolchain),
    originalFiles: cloneJson(input.originalFiles),
    files: input.files.map((file) => cloneJson(file)).sort((left, right) => compareMainnetV8Text(left.path, right.path)),
  };
  assertMainnetV8SourceArtifact(artifact);
  return deepFreeze(artifact);
}

export function mainnetV8SourceCommitment(artifact) {
  assertMainnetV8SourceArtifact(artifact);
  return sha256MainnetV8Json(artifact);
}

export function mainnetV8PackageModuleRecord(name, bytes) {
  if (!MODULE_NAME.test(name)) fail('MAINNET_V8_MODULE_NAME_INVALID', 'Move module name is invalid.', { name });
  const content = typeof bytes === 'string'
    ? decodeCanonicalBase64(bytes, `Module ${name} bytes`)
    : asBytes(bytes, `Module ${name} bytes`);
  if (content.length === 0) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Move module bytes cannot be empty.', { name });
  return deepFreeze({
    name,
    bytesBase64: Buffer.from(content).toString('base64'),
    byteLength: String(content.length),
    sha256: sha256MainnetV8Bytes(content),
  });
}

function normalizeBuildDigest(value) {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = Uint8Array.from(value);
    if (bytes.length !== 32) fail('MAINNET_V8_BUILD_DIGEST_INVALID', 'Build digest must be exactly 32 bytes.');
    return Buffer.from(bytes).toString('hex');
  }
  if (!HASH.test(value)) fail('MAINNET_V8_BUILD_DIGEST_INVALID', 'Build digest must be lowercase 32-byte hex.');
  return value;
}

export function assertMainnetV8PackageArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'Package artifact');
  exactFields(artifact, PACKAGE_FIELDS, 'Package artifact');
  if (artifact.domain !== MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN) {
    fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact domain is invalid.');
  }
  if (!NATIVE_SOUL_SOURCE_ORDER.includes(artifact.role)) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Unknown current build package.');
  if (!Array.isArray(artifact.modules) || artifact.modules.length === 0) {
    fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact has no modules.');
  }
  const modules = new Set();
  artifact.modules.forEach((module, index) => {
    exactFields(module, PACKAGE_MODULE_FIELDS, `Package artifact modules[${index}]`);
    if (!MODULE_NAME.test(module.name) || modules.has(module.name)) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact module names are invalid or duplicated.');
    }
    modules.add(module.name);
    if (index > 0 && compareMainnetV8Text(artifact.modules[index - 1].name, module.name) >= 0) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact modules are not strictly protocol-sorted.');
    }
    const bytes = decodeCanonicalBase64(module.bytesBase64, `Package artifact modules[${index}].bytesBase64`);
    assertMainnetV8Decimal(module.byteLength, `Package artifact modules[${index}].byteLength`, { positive: true });
    assertHash(module.sha256, `Package artifact modules[${index}].sha256`);
    if (module.byteLength !== String(bytes.length) || module.sha256 !== sha256MainnetV8Bytes(bytes)) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package module content address does not match its bytes.', { name: module.name });
    }
  });
  if (!Array.isArray(artifact.dependencies)) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package dependencies must be an array.');
  artifact.dependencies.forEach((dependency, index) => {
    assertFullId(dependency, `Package dependency ${index}`);
    if (index > 0 && compareMainnetV8Text(artifact.dependencies[index - 1], dependency) >= 0) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package dependencies are not strictly sorted and unique.');
    }
  });
  assertHash(artifact.buildDigest, 'Package buildDigest');
  return artifact;
}

export function buildMainnetV8PackageArtifact(input) {
  const role = input?.role;
  if (!NATIVE_SOUL_SOURCE_ORDER.includes(role)) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Unknown current build package.');
  const modules = input.modules.map((module) => {
    if (module instanceof Uint8Array) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Module records require an explicit name.');
    if (Object.hasOwn(module, 'bytes')) return mainnetV8PackageModuleRecord(module.name, module.bytes);
    if (Object.hasOwn(module, 'bytesBase64') && !Object.hasOwn(module, 'sha256')) {
      return mainnetV8PackageModuleRecord(module.name, module.bytesBase64);
    }
    return cloneJson(module);
  }).sort((left, right) => compareMainnetV8Text(left.name, right.name));
  const dependencies = input.dependencies
    .map((value, index) => normalizeMainnetV8ObjectId(value, `Dependency ${index}`))
    .sort(compareMainnetV8Text);
  const artifact = {
    domain: MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN,
    role,
    modules,
    dependencies,
    buildDigest: normalizeBuildDigest(input.buildDigest),
  };
  assertMainnetV8PackageArtifact(artifact);
  return deepFreeze(artifact);
}

export function mainnetV8PackageCommitment(artifact) {
  assertMainnetV8PackageArtifact(artifact);
  return sha256MainnetV8Json(artifact);
}

/** Shared by live readback and cold WAL replay: only Sui's self-address rewrite. */
export function assertMainnetV8PublishedModuleBytes({ role, moduleName, packageId, sourceBase64, publishedBase64 }) {
  const label = `${role}.${moduleName}`;
  const source = decodeCanonicalBase64(sourceBase64, `${label}.source`);
  const published = decodeCanonicalBase64(publishedBase64, `${label}.published`);
  const publishedAddress = Buffer.from(assertFullId(packageId, `${label}.packageId`).slice(2), 'hex');
  if (source.length !== published.length) {
    fail('MAINNET_V8_PACKAGE_BYTES_DRIFT', `${label} published module length is invalid.`);
  }
  const firstDifference = source.findIndex((byte, index) => byte !== published[index]);
  // Zero address bytes do not differ from the original zero self-address.
  const firstAddressByte = publishedAddress.findIndex(byte => byte !== 0);
  const start = firstDifference - firstAddressByte;
  if (firstDifference < 0 || firstAddressByte < 0 || start < 0 || start + 32 > source.length
    || source.subarray(start, start + 32).some(byte => byte !== 0)) {
    fail('MAINNET_V8_PACKAGE_BYTES_DRIFT', `${label} differs beyond the one Sui self-address publication substitution.`);
  }
  const expectedPublished = Uint8Array.from(source);
  expectedPublished.set(publishedAddress, start);
  if (expectedPublished.some((byte, index) => byte !== published[index])) {
    fail('MAINNET_V8_PACKAGE_BYTES_DRIFT', `${label} published module bytes are invalid.`);
  }
  return Object.freeze({ sourceSha256: sha256MainnetV8Bytes(source),
    publishedSha256: sha256MainnetV8Bytes(published), selfAddressOffset: String(start) });
}

function strippedAbiKey(key) {
  return ABI_STRIPPED_KEYS.has(key.replaceAll(/[-_]/g, '').toLowerCase());
}

function normalizeAbiValue(value, path = '$', depth = 0) {
  if (depth > MAX_JSON_DEPTH) fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor is too deep.', { path });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor contains a non-canonical number.', { path });
    }
    return String(value);
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map((entry, index) => normalizeAbiValue(entry, `${path}[${index}]`, depth + 1));
  if (!isPlain(value)) fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor contains a non-plain value.', { path });
  const result = {};
  for (const key of Object.keys(value).sort(compareMainnetV8Text)) {
    if (strippedAbiKey(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor contains an accessor.', { path: `${path}.${key}` });
    }
    result[key] = normalizeAbiValue(descriptor.value, `${path}.${key}`, depth + 1);
  }
  return result;
}

function namedAbiEntries(value, label) {
  let entries;
  if (Array.isArray(value)) entries = value.map((entry) => normalizeAbiValue(entry));
  else if (isPlain(value)) {
    entries = Object.entries(value).map(([name, entry]) => {
      const normalized = normalizeAbiValue(entry);
      if (!isPlain(normalized)) fail('MAINNET_V8_ABI_INVALID', `${label}.${name} must be a record.`);
      if (Object.hasOwn(normalized, 'name') && normalized.name !== name) {
        fail('MAINNET_V8_ABI_INVALID', `${label}.${name} has a conflicting name.`);
      }
      return { name, ...normalized };
    });
  } else fail('MAINNET_V8_ABI_INVALID', `${label} must be an array or name map.`);
  const names = new Set();
  for (const entry of entries) {
    if (!isPlain(entry) || !MODULE_NAME.test(entry.name) || names.has(entry.name)) {
      fail('MAINNET_V8_ABI_INVALID', `${label} contains an invalid or duplicate name.`);
    }
    names.add(entry.name);
  }
  return entries.sort((left, right) => compareMainnetV8Text(left.name, right.name)
    || compareMainnetV8Text(canonicalMainnetV8Json(left), canonicalMainnetV8Json(right)));
}

function descriptorModules(descriptor) {
  const modules = descriptor?.modules;
  if (Array.isArray(modules)) return modules.map((entry) => normalizeAbiValue(entry));
  if (isPlain(modules)) {
    return Object.entries(modules).map(([name, entry]) => {
      const normalized = normalizeAbiValue(entry);
      if (!isPlain(normalized)) fail('MAINNET_V8_ABI_INVALID', `ABI module ${name} must be a record.`);
      if (Object.hasOwn(normalized, 'name') && normalized.name !== name) {
        fail('MAINNET_V8_ABI_INVALID', `ABI module ${name} has a conflicting name.`);
      }
      return { name, ...normalized };
    });
  }
  fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor modules must be an array or name map.');
}

function assertNoStrippedAbiKeys(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoStrippedAbiKeys(entry, `${path}[${index}]`));
  if (typeof value === 'number' || typeof value === 'bigint') {
    fail('MAINNET_V8_ABI_INVALID', 'ABI artifact integers must be canonical decimal strings.', { path });
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (strippedAbiKey(key)) fail('MAINNET_V8_ABI_INVALID', 'ABI artifact retains documentation or source locations.', { path: `${path}.${key}` });
    assertNoStrippedAbiKeys(entry, `${path}.${key}`);
  }
}

export function assertMainnetV8AbiArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'ABI artifact');
  exactFields(artifact, ABI_FIELDS, 'ABI artifact');
  if (artifact.domain !== MAINNET_V8_ABI_ARTIFACT_DOMAIN) fail('MAINNET_V8_ABI_INVALID', 'ABI artifact domain is invalid.');
  if (!MAINNET_V8_PUBLISH_ORDER.includes(artifact.role)) {
    fail('MAINNET_V8_ROLE_INVALID', 'ABI artifact role is not a current publication package.');
  }
  if (!Array.isArray(artifact.modules) || artifact.modules.length === 0) fail('MAINNET_V8_ABI_INVALID', 'ABI artifact has no modules.');
  const modules = new Set();
  artifact.modules.forEach((module, index) => {
    exactFields(module, ABI_MODULE_FIELDS, `ABI artifact modules[${index}]`);
    if (!MODULE_NAME.test(module.name) || modules.has(module.name)) fail('MAINNET_V8_ABI_INVALID', 'ABI module name is invalid or duplicated.');
    modules.add(module.name);
    if (index > 0 && compareMainnetV8Text(artifact.modules[index - 1].name, module.name) >= 0) {
      fail('MAINNET_V8_ABI_INVALID', 'ABI modules are not strictly sorted.');
    }
    for (const field of ['datatypes', 'functions']) {
      if (!Array.isArray(module[field])) fail('MAINNET_V8_ABI_INVALID', `ABI ${field} must be an array.`);
      let prior = null;
      const names = new Set();
      module[field].forEach((entry) => {
        if (!isPlain(entry) || !MODULE_NAME.test(entry.name) || names.has(entry.name)) {
          fail('MAINNET_V8_ABI_INVALID', `ABI ${field} name is invalid or duplicated.`);
        }
        names.add(entry.name);
        if (prior !== null && compareMainnetV8Text(prior, entry.name) >= 0) fail('MAINNET_V8_ABI_INVALID', `ABI ${field} are not sorted.`);
        prior = entry.name;
      });
    }
  });
  assertNoStrippedAbiKeys(artifact);
  return artifact;
}

export function buildMainnetV8AbiArtifact(input) {
  const role = input?.role;
  if (!MAINNET_V8_PUBLISH_ORDER.includes(role)) {
    fail('MAINNET_V8_ROLE_INVALID', 'ABI artifact role is not a current publication package.');
  }
  const modules = descriptorModules(input.descriptor).map((module) => {
    if (!MODULE_NAME.test(module.name)) fail('MAINNET_V8_ABI_INVALID', 'ABI module name is invalid.');
    const datatypes = module.datatypes ?? module.dataTypes ?? module.structs;
    const functions = module.functions;
    if (datatypes === undefined || functions === undefined) {
      fail('MAINNET_V8_ABI_INVALID', `ABI module ${module.name} omits datatypes or functions.`);
    }
    return {
      name: module.name,
      datatypes: namedAbiEntries(datatypes, `${module.name}.datatypes`),
      functions: namedAbiEntries(functions, `${module.name}.functions`),
    };
  }).sort((left, right) => compareMainnetV8Text(left.name, right.name));
  const artifact = { domain: MAINNET_V8_ABI_ARTIFACT_DOMAIN, role, modules };
  assertMainnetV8AbiArtifact(artifact);
  return deepFreeze(artifact);
}

export function mainnetV8AbiCommitment(artifact) {
  assertMainnetV8AbiArtifact(artifact);
  return sha256MainnetV8Json(artifact);
}

function assertKeyServerSetArtifact(artifact) {
  exactFields(artifact, KEY_SERVER_SET_FIELDS, 'Seal key-server-set artifact');
  if (artifact.domain !== MAINNET_V8_KEY_SERVER_SET_DOMAIN
    || artifact.chainIdentifier !== MAINNET_V8_CHAIN_IDENTIFIER) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Key-server-set domain or Mainnet identity is invalid.');
  }
  if (!Array.isArray(artifact.keyServers) || artifact.keyServers.length < 1 || artifact.keyServers.length > 64) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy requires 1 to 64 key servers.');
  }
  let total = 0n;
  artifact.keyServers.forEach((server, index) => {
    exactFields(server, KEY_SERVER_FIELDS, `Seal keyServers[${index}]`);
    assertFullId(server.objectId, `Seal keyServers[${index}].objectId`);
    const weight = assertMainnetV8Decimal(server.weight, `Seal keyServers[${index}].weight`, { positive: true, maximum: 65_535n });
    total += weight;
    if (index > 0 && compareMainnetV8Text(artifact.keyServers[index - 1].objectId, server.objectId) >= 0) {
      fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal key-server IDs must be strictly byte-sorted and unique.');
    }
  });
  const threshold = assertMainnetV8Decimal(artifact.threshold, 'Seal threshold', { positive: true, maximum: 65_535n });
  if (threshold > total) fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal threshold exceeds total key-server weight.');
  const approved = MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' }));
  if (canonicalMainnetV8Json(artifact.keyServers) !== canonicalMainnetV8Json(approved)
    || artifact.threshold !== MAINNET_V8_BROWSER_SEAL_THRESHOLD) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy differs from the reviewed two-of-two no-secret Mainnet topology.');
  }
  return artifact;
}

function assertEncryptionPolicyArtifact(artifact) {
  exactFields(artifact, ENCRYPTION_FIELDS, 'Seal encryption-policy artifact');
  if (artifact.domain !== MAINNET_V8_ENCRYPTION_POLICY_DOMAIN
    || artifact.version !== '8' || artifact.module !== 'seal_v8') {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal encryption-policy binding is invalid.');
  }
  if (canonicalMainnetV8Json(artifact.approvalFunctions)
    !== canonicalMainnetV8Json(MAINNET_V8_SEAL_APPROVALS)
    || canonicalMainnetV8Json(artifact.holderReadLifecycle)
      !== canonicalMainnetV8Json(['ACTIVE', 'PAUSED', 'ARCHIVED'])) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal approval entry functions differ from the frozen v8 policy.');
  }
  artifact.approvalFunctions.forEach((entry, index) => exactFields(entry, APPROVAL_FIELDS, `Seal approval[${index}]`));
  assertHash(artifact.sealPackageCommitment, 'Seal encryption sealPackageCommitment');
  assertHash(artifact.sealAbiCommitment, 'Seal encryption sealAbiCommitment');
  return artifact;
}

export function assertMainnetV8SealPolicyTemplate(policy) {
  assertMainnetV8DeterministicJson(policy, 'Seal policy template');
  exactFields(policy, SEAL_POLICY_TEMPLATE_FIELDS, 'Seal policy template');
  if (policy.schemaVersion !== MAINNET_V8_SEAL_POLICY_TEMPLATE_SCHEMA) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy template schema is invalid.');
  }
  assertKeyServerSetArtifact(policy.keyServerSetArtifact);
  if (canonicalMainnetV8Json(policy.keyServers) !== canonicalMainnetV8Json(policy.keyServerSetArtifact.keyServers)
    || policy.threshold !== policy.keyServerSetArtifact.threshold) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy arguments differ from their commitment artifact.');
  }
  assertHash(policy.keyServerSetCommitment, 'Seal keyServerSetCommitment');
  if (policy.keyServerSetCommitment !== sha256MainnetV8Json(policy.keyServerSetArtifact)) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal key-server-set commitment does not match its canonical artifact.');
  }
  return policy;
}

export function assertMainnetV8FinalSealPolicy(policy, template = null) {
  assertMainnetV8DeterministicJson(policy, 'Final Seal policy');
  exactFields(policy, SEAL_POLICY_FIELDS, 'Final Seal policy');
  if (policy.schemaVersion !== MAINNET_V8_SEAL_POLICY_SCHEMA) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Final Seal policy schema is invalid.');
  }
  assertKeyServerSetArtifact(policy.keyServerSetArtifact);
  if (canonicalMainnetV8Json(policy.keyServers) !== canonicalMainnetV8Json(policy.keyServerSetArtifact.keyServers)
    || policy.threshold !== policy.keyServerSetArtifact.threshold
    || policy.keyServerSetCommitment !== sha256MainnetV8Json(policy.keyServerSetArtifact)) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Final Seal key-server binding is invalid.');
  }
  if (template !== null) {
    assertMainnetV8SealPolicyTemplate(template);
    for (const field of ['keyServers', 'threshold', 'keyServerSetArtifact', 'keyServerSetCommitment']) {
      if (canonicalMainnetV8Json(policy[field]) !== canonicalMainnetV8Json(template[field])) {
        fail('MAINNET_V8_SEAL_POLICY_INVALID', `Final Seal policy differs from template field ${field}.`);
      }
    }
  }
  assertEncryptionPolicyArtifact(policy.encryptionPolicyArtifact);
  assertHash(policy.encryptionPolicyCommitment, 'Seal encryptionPolicyCommitment');
  if (policy.encryptionPolicyCommitment !== sha256MainnetV8Json(policy.encryptionPolicyArtifact)) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal encryption-policy commitment does not match its canonical artifact.');
  }
  return policy;
}

export function buildMainnetV8SealPolicyTemplate(input) {
  if (!Array.isArray(input?.keyServers)) fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal keyServers must be an array.');
  const keyServers = input.keyServers.map((server, index) => ({
    objectId: normalizeMainnetV8ObjectId(server.objectId, `Seal keyServers[${index}].objectId`),
    weight: decimalInput(server.weight, `Seal keyServers[${index}].weight`, { positive: true, maximum: 65_535n }),
  })).sort((left, right) => compareMainnetV8Text(left.objectId, right.objectId));
  const threshold = decimalInput(input.threshold, 'Seal threshold', { positive: true, maximum: 65_535n });
  const keyServerSetArtifact = {
    domain: MAINNET_V8_KEY_SERVER_SET_DOMAIN,
    chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER,
    keyServers,
    threshold,
  };
  assertKeyServerSetArtifact(keyServerSetArtifact);
  const keyServerSetCommitment = sha256MainnetV8Json(keyServerSetArtifact);
  const policy = {
    schemaVersion: MAINNET_V8_SEAL_POLICY_TEMPLATE_SCHEMA,
    keyServers: keyServers.map((entry) => ({ ...entry })),
    threshold,
    keyServerSetArtifact,
    keyServerSetCommitment,
  };
  assertMainnetV8SealPolicyTemplate(policy);
  return deepFreeze(policy);
}

export function buildMainnetV8FinalSealPolicy({
  template, sealPackageCommitment, sealAbiCommitment,
}) {
  assertMainnetV8SealPolicyTemplate(template);
  assertHash(sealPackageCommitment, 'Final Seal package commitment');
  assertHash(sealAbiCommitment, 'Final Seal ABI commitment');
  const encryptionPolicyArtifact = {
    domain: MAINNET_V8_ENCRYPTION_POLICY_DOMAIN,
    version: '8',
    module: 'seal_v8',
    approvalFunctions: MAINNET_V8_SEAL_APPROVALS.map((entry) => ({ ...entry })),
    holderReadLifecycle: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
    sealPackageCommitment,
    sealAbiCommitment,
  };
  const policy = {
    schemaVersion: MAINNET_V8_SEAL_POLICY_SCHEMA,
    keyServers: cloneJson(template.keyServers),
    threshold: template.threshold,
    keyServerSetArtifact: cloneJson(template.keyServerSetArtifact),
    keyServerSetCommitment: template.keyServerSetCommitment,
    encryptionPolicyArtifact,
    encryptionPolicyCommitment: sha256MainnetV8Json(encryptionPolicyArtifact),
  };
  assertMainnetV8FinalSealPolicy(policy, template);
  return deepFreeze(policy);
}

// The preflight-facing name intentionally builds only the immutable template.
export const buildMainnetV8SealPolicy = buildMainnetV8SealPolicyTemplate;
export function assertMainnetV8SealPolicy(policy) {
  if (policy?.schemaVersion === MAINNET_V8_SEAL_POLICY_TEMPLATE_SCHEMA) {
    return assertMainnetV8SealPolicyTemplate(policy);
  }
  if (policy?.schemaVersion === MAINNET_V8_SEAL_POLICY_SCHEMA) {
    return assertMainnetV8FinalSealPolicy(policy);
  }
  fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy schema is neither a preflight template nor final policy.');
}

function assertProtocolProfile(profile) {
  exactFields(profile, Object.keys(MAINNET_V8_PROTOCOL_PROFILE), 'Protocol profile');
  if (canonicalMainnetV8Json(profile) !== canonicalMainnetV8Json(MAINNET_V8_PROTOCOL_PROFILE)) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan protocol profile is not the measured protocol 137 profile.');
  }
}

function artifactPackage(role, entry, index) {
  exactFields(entry, PLAN_PACKAGE_FIELDS, `Release package[${index}]`);
  if (entry.role !== role) fail('MAINNET_V8_PLAN_INVALID', 'Release packages are outside exact role order.');
  if (entry.packageName !== NATIVE_SOUL_SOURCE_NAMES[role]) fail('MAINNET_V8_PLAN_INVALID', 'Incorrect source package name.');
  assertMainnetV8SourceArtifact(entry.sourceArtifact);
  if (entry.sourceArtifact.role !== role || entry.sourceArtifact.packageName !== entry.packageName) {
    fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} artifact roles disagree.`);
  }
  assertHash(entry.sourceCommitment, `Release package ${role} sourceCommitment`);
  if (entry.sourceCommitment !== mainnetV8SourceCommitment(entry.sourceArtifact)) {
    fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} source commitment does not match its artifact.`);
  }
}

/** Source identity only: never a READY/publication authorization. */
export function assertMainnetV8SourcePlan(plan) {
  assertNativeSoulSourceRevision(plan.sourceRevision);
  assertToolchain(plan.toolchain);
  if (!Array.isArray(plan.packages) || plan.packages.length !== NATIVE_SOUL_SOURCE_ORDER.length) {
    fail('MAINNET_V8_PLAN_INVALID', 'Source plan requires all eight current packages.');
  }
  plan.packages.forEach((entry, index) => {
    const role = NATIVE_SOUL_SOURCE_ORDER[index], source = plan.sourceRevision.packages[index];
    artifactPackage(role, entry, index);
    const expected = { snapshotSha256: plan.sourceRevision.snapshotSha256, repository: source.repository,
      ...plan.sourceRevision.repositories[source.repository] };
    if (canonicalMainnetV8Json(entry.sourceArtifact.release) !== canonicalMainnetV8Json(expected)
      || canonicalMainnetV8Json(entry.sourceArtifact.toolchain) !== canonicalMainnetV8Json(plan.toolchain)
      || canonicalMainnetV8Json(entry.sourceArtifact.originalFiles) !== canonicalMainnetV8Json(source.originalFiles)
      || canonicalMainnetV8Json(entry.sourceArtifact.files) !== canonicalMainnetV8Json(source.files)) {
      fail('MAINNET_V8_PLAN_INVALID', 'Source artifact differs from exact dual-repository snapshot.');
    }
  });
  return plan;
}

function executionPlanIdPayload(plan) {
  const payload = { ...plan };
  delete payload.executionPlanId;
  return payload;
}

export function assertMainnetV8ReleasePlan(plan) {
  assertMainnetV8ReleasePlanContents(plan);
  return plan;
}

/** Pure immutable plan validation, not authority to create WAL, sign or publish.
 * The guarded execution entry point above uses this exact validation body. */
export function assertMainnetV8ReleasePlanContents(plan) {
  assertMainnetV8DeterministicJson(plan, 'Release plan');
  exactFields(plan, PLAN_FIELDS, 'Release plan');
  if (plan.schemaVersion !== MAINNET_V8_RELEASE_PLAN_SCHEMA) fail('MAINNET_V8_PLAN_INVALID', 'Release plan schema is invalid.');
  exactFields(plan.chain, CHAIN_FIELDS, 'Release chain');
  if (plan.chain.network !== 'mainnet' || plan.chain.chainIdentifier !== MAINNET_V8_CHAIN_IDENTIFIER
    || plan.chain.legacyChainIdentifier !== MAINNET_V8_LEGACY_CHAIN_IDENTIFIER) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan is not bound to exact Sui Mainnet.');
  }
  assertFullId(plan.sender, 'Release sender');
  if (plan.sender !== MAINNET_V8_RELEASE_SIGNER) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release sender is not the reviewed Mainnet release signer.', {
      expected: MAINNET_V8_RELEASE_SIGNER,
      observed: plan.sender,
    });
  }
  assertMainnetV8SourcePlan(plan);
  assertToolchain(plan.toolchain, 'Release toolchain');
  assertProtocolProfile(plan.protocolProfile);
  if (plan.paymentCoinType !== MAINNET_V8_PAYMENT_COIN_TYPE) fail('MAINNET_V8_PLAN_INVALID', 'Release payment coin is not Mainnet native USDC.');
  assertMainnetV8SealPolicyTemplate(plan.sealPolicy);
  if (!Array.isArray(plan.steps) || plan.steps.length !== MAINNET_V8_RELEASE_STEPS.length) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan steps are incomplete.');
  }
  plan.steps.forEach((step, index) => exactFields(step, STEP_FIELDS, `Release step[${index}]`));
  if (canonicalMainnetV8Json(plan.steps) !== canonicalMainnetV8Json(MAINNET_V8_RELEASE_STEPS)) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan steps differ from the exact native publication/bootstrap schedule.');
  }
  assertHash(plan.executionPlanId, 'Release executionPlanId');
  const expected = sha256MainnetV8Json(executionPlanIdPayload(plan));
  if (plan.executionPlanId !== expected) {
    fail('MAINNET_V8_PLAN_INVALID', 'executionPlanId does not match the immutable preflight plan.', { expected });
  }
  return plan;
}

export function buildMainnetV8ReleasePlan(input) {
  const plan = buildMainnetV8ReleasePlanContents(input);
  return plan;
}

/** Build detached plan data for offline verification. Execution remains gated. */
export function buildMainnetV8ReleasePlanContents(input) {
  const packages = input.packages.map((entry) => ({
    role: entry.role,
    packageName: entry.packageName ?? NATIVE_SOUL_SOURCE_NAMES[entry.role],
    sourceArtifact: cloneJson(entry.sourceArtifact),
    sourceCommitment: entry.sourceCommitment ?? mainnetV8SourceCommitment(entry.sourceArtifact),
  }));
  const plan = {
    schemaVersion: MAINNET_V8_RELEASE_PLAN_SCHEMA,
    chain: {
      network: 'mainnet',
      chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER,
      legacyChainIdentifier: MAINNET_V8_LEGACY_CHAIN_IDENTIFIER,
    },
    sender: normalizeMainnetV8ObjectId(input.sender, 'Release sender'),
    sourceRevision: cloneJson(input.sourceRevision),
    toolchain: cloneJson(input.toolchain),
    protocolProfile: { ...MAINNET_V8_PROTOCOL_PROFILE },
    paymentCoinType: MAINNET_V8_PAYMENT_COIN_TYPE,
    sealPolicy: cloneJson(input.sealPolicy),
    packages,
    steps: MAINNET_V8_RELEASE_STEPS.map((step) => ({ ...step })),
  };
  plan.executionPlanId = sha256MainnetV8Json(plan);
  assertMainnetV8ReleasePlanContents(plan);
  return deepFreeze(plan);
}

function finalManifestPayload(manifest) {
  const payload = { ...manifest };
  delete payload.releaseId;
  return payload;
}

export function assertMainnetV8FinalManifest(manifest, plan) {
  assertMainnetV8ReleasePlan(plan);
  return assertMainnetV8FinalManifestContents(manifest, plan);
}

function assertFinalManifestSourceIdentity(plan) {
  // Data-layer validation, not authorization to run an incomplete release plan.
  // Public execution/WAL entry points still call assertMainnetV8ReleasePlan.
  assertMainnetV8SourcePlan(plan);
  exactFields(plan.chain, CHAIN_FIELDS, 'Final manifest source chain');
  if (plan.chain.network !== 'mainnet' || plan.chain.chainIdentifier !== MAINNET_V8_CHAIN_IDENTIFIER
    || plan.chain.legacyChainIdentifier !== MAINNET_V8_LEGACY_CHAIN_IDENTIFIER
    || plan.sender !== MAINNET_V8_RELEASE_SIGNER) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest source identity is not the approved Mainnet target.');
  }
  assertHash(plan.executionPlanId, 'Final manifest executionPlanId');
  if (plan.executionPlanId !== sha256MainnetV8Json(executionPlanIdPayload(plan))) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest execution plan identity does not bind its complete source plan.');
  }
  assertMainnetV8SealPolicyTemplate(plan.sealPolicy);
}

/** Pure final-publication artifact validation. It does not validate a runnable
 * schedule, prove finality, create READY/WAL, or enable the native pipeline. */
export function assertMainnetV8FinalManifestContents(manifest, plan) {
  assertFinalManifestSourceIdentity(plan);
  assertMainnetV8DeterministicJson(manifest, 'Final release manifest');
  exactFields(manifest, FINAL_MANIFEST_FIELDS, 'Final release manifest');
  if (manifest.schemaVersion !== MAINNET_V8_FINAL_MANIFEST_SCHEMA
    || manifest.executionPlanId !== plan.executionPlanId
    || manifest.chainIdentifier !== plan.chain.chainIdentifier
    || manifest.sender !== plan.sender) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest identity differs from the immutable execution plan.');
  }
  if (!Array.isArray(manifest.packages)
    || manifest.packages.length !== MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest must bind exactly eight native publications.');
  }
  const packageIds = new Set();
  const upgradeCaps = new Set();
  manifest.packages.forEach((entry, index) => {
    exactFields(entry, FINAL_MANIFEST_PACKAGE_FIELDS, `Final manifest package[${index}]`);
    const role = MAINNET_V8_PUBLISH_ORDER[index];
    if (entry.role !== role || entry.sourceCommitment !== plan.packages[index].sourceCommitment) {
      fail('MAINNET_V8_FINAL_MANIFEST_INVALID', `Final manifest package ${role} differs from its source plan.`);
    }
    assertFullId(entry.packageId, `Final manifest ${role}.packageId`);
    assertSuiDigest(entry.packageDigest, `Final manifest ${role}.packageDigest`);
    assertMainnetV8Decimal(entry.packageVersion, `Final manifest ${role}.packageVersion`, { positive: true });
    if (entry.packageVersion !== '1') {
      fail('MAINNET_V8_FINAL_MANIFEST_INVALID', `Final manifest ${role} is not a fresh package version 1.`);
    }
    assertFullId(entry.upgradeCapId, `Final manifest ${role}.upgradeCapId`);
    assertSuiDigest(entry.publishDigest, `Final manifest ${role}.publishDigest`);
    for (const field of [
      'sourceCommitment', 'packageCommitment', 'abiCommitment',
      'finalityEvidenceSha256', 'readbackSha256',
    ]) assertHash(entry[field], `Final manifest ${role}.${field}`);
    if (entry.packageId === entry.upgradeCapId || packageIds.has(entry.packageId) || upgradeCaps.has(entry.upgradeCapId)
      || packageIds.has(entry.upgradeCapId) || upgradeCaps.has(entry.packageId)) {
      fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest package/cap identities must be unique.');
    }
    packageIds.add(entry.packageId);
    upgradeCaps.add(entry.upgradeCapId);
  });
  assertMainnetV8FinalSealPolicy(manifest.sealPolicy, plan.sealPolicy);
  const seal = manifest.packages[MAINNET_V8_PUBLISH_ORDER.indexOf('seal')];
  if (manifest.sealPolicy.encryptionPolicyArtifact.sealPackageCommitment !== seal.packageCommitment
    || manifest.sealPolicy.encryptionPolicyArtifact.sealAbiCommitment !== seal.abiCommitment) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final Seal policy differs from published Seal artifacts.');
  }
  assertHash(manifest.releaseId, 'Final manifest releaseId');
  const expected = sha256MainnetV8Json(finalManifestPayload(manifest));
  if (manifest.releaseId !== expected) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'releaseId does not match the sealed final manifest.', { expected });
  }
  return manifest;
}

export function buildMainnetV8FinalManifest({ plan, packages, sealPolicy = null }) {
  assertMainnetV8ReleasePlan(plan);
  return buildMainnetV8FinalManifestContents({ plan, packages, sealPolicy });
}

/** Builds only the deterministic artifact consumed by the guarded builder. */
export function buildMainnetV8FinalManifestContents({ plan, packages, sealPolicy = null }) {
  assertFinalManifestSourceIdentity(plan);
  if (!Array.isArray(packages) || packages.length !== MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest builder requires eight publication rows.');
  }
  const seal = packages[MAINNET_V8_PUBLISH_ORDER.indexOf('seal')];
  const derivedSealPolicy = buildMainnetV8FinalSealPolicy({
    template: plan.sealPolicy,
    sealPackageCommitment: seal.packageCommitment,
    sealAbiCommitment: seal.abiCommitment,
  });
  if (sealPolicy !== null
    && canonicalMainnetV8Json(sealPolicy) !== canonicalMainnetV8Json(derivedSealPolicy)) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Caller-provided Seal policy differs from published Seal artifacts.');
  }
  const manifest = {
    schemaVersion: MAINNET_V8_FINAL_MANIFEST_SCHEMA,
    executionPlanId: plan.executionPlanId,
    chainIdentifier: plan.chain.chainIdentifier,
    sender: plan.sender,
    packages: packages.map((entry) => cloneJson(entry)),
    sealPolicy: cloneJson(derivedSealPolicy),
  };
  manifest.releaseId = sha256MainnetV8Json(manifest);
  assertMainnetV8FinalManifestContents(manifest, plan);
  return deepFreeze(manifest);
}

/** Soulidity is a publication dependency, not an eighth Catalog role. */
export function mainnetV8CatalogCommitmentsFromFinalManifest(manifest, plan) {
  assertMainnetV8FinalManifestContents(manifest, plan);
  return deepFreeze(Object.fromEntries(MAINNET_V8_ROLE_ORDER.map(role => {
    const entry = manifest.packages[MAINNET_V8_PUBLISH_ORDER.indexOf(role)];
    return [role, { source: entry.sourceCommitment, package: entry.packageCommitment, abi: entry.abiCommitment }];
  })));
}

function tomlString(value, label) {
  boundedText(value, label, 16 * 1024);
  return JSON.stringify(value);
}

function parseTomlString(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'string' || JSON.stringify(parsed) !== value) throw new Error('noncanonical');
    return boundedText(parsed, label, 16 * 1024);
  } catch {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `${label} is not one canonical TOML basic string.`);
  }
}

function assertPublishedEntry(entry, index) {
  exactFields(entry, [
    'packageName', 'source', 'publishedAt', 'originalId', 'version',
    'toolchainVersion', 'buildConfig', 'upgradeCapability',
  ], `Published entry[${index}]`);
  const role = MAINNET_V8_PUBLISH_ORDER[index];
  if (!role || entry.packageName !== MAINNET_V8_PUBLISH_PACKAGE_NAMES[role]) {
    fail('MAINNET_V8_PACKAGE_NAME_INVALID', `Published entry[${index}] is outside the exact publication order.`);
  }
  boundedText(entry.source, `Published entry[${index}].source`, 16 * 1024);
  if (resolve(entry.source) !== entry.source || basename(entry.source) !== entry.packageName) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `Published entry ${index} source is not its absolute package directory.`);
  }
  assertFullId(entry.publishedAt, `Published entry[${index}].publishedAt`);
  assertFullId(entry.originalId, `Published entry[${index}].originalId`);
  assertMainnetV8Decimal(entry.version, `Published entry[${index}].version`, { positive: true });
  boundedText(entry.toolchainVersion, `Published entry[${index}].toolchainVersion`, 256);
  exactFields(entry.buildConfig, ['flavor', 'edition'], `Published entry[${index}].buildConfig`);
  if (entry.buildConfig.flavor !== 'sui' || entry.buildConfig.edition !== '2024') {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published build config is not exact Sui 2024.');
  }
  assertFullId(entry.upgradeCapability, `Published entry[${index}].upgradeCapability`);
}

function assertPublishedFile(value) {
  exactFields(value, ['buildEnv', 'chainId', 'entries', 'externalEntries'], 'Published.toml value');
  if (value.buildEnv !== 'mainnet' || value.chainId !== MAINNET_V8_LEGACY_CHAIN_IDENTIFIER
    || !Array.isArray(value.entries) || value.entries.length > MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml is not an exact Mainnet v8 prefix.');
  }
  value.entries.forEach(assertPublishedEntry);
  assertNativeSoulExternalPublicationEntries(value.externalEntries);
  if (new Set([...value.entries, ...value.externalEntries].map(entry => entry.source)).size
    !== value.entries.length + value.externalEntries.length) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Native and external sources overlap.');
  }
  return value;
}

export function renderMainnetV8PublishedToml(value) {
  assertMainnetV8DeterministicJson(value, 'Published.toml value');
  assertPublishedFile(value);
  const lines = [
    '# generated by Move',
    '# this file contains metadata from ephemeral publications',
    '# this file should not be committed to source control',
    '',
    `build-env = ${tomlString(value.buildEnv, 'build-env')}`,
    `chain-id = ${tomlString(value.chainId, 'chain-id')}`,
    '',
  ];
  value.entries.forEach((entry, index) => {
    if (index > 0) lines.push('');
    lines.push(
      '[[published]]',
      `source = { local = ${tomlString(entry.source, 'published source')} }`,
      `published-at = ${tomlString(entry.publishedAt, 'published-at')}`,
      `original-id = ${tomlString(entry.originalId, 'original-id')}`,
      `version = ${entry.version}`,
      `toolchain-version = ${tomlString(entry.toolchainVersion, 'toolchain-version')}`,
      `build-config = { flavor = ${tomlString(entry.buildConfig.flavor, 'flavor')}, edition = ${tomlString(entry.buildConfig.edition, 'edition')} }`,
      `upgrade-capability = ${tomlString(entry.upgradeCapability, 'upgrade-capability')}`,
    );
  });
  value.externalEntries.forEach((entry, index) => {
    if (value.entries.length || index) lines.push('');
    lines.push(
      '[[published]]',
      `source = { local = ${tomlString(entry.source, 'external source')} }`,
      `published-at = ${tomlString(entry.publishedAt, 'external published-at')}`,
      `original-id = ${tomlString(entry.originalId, 'external original-id')}`,
      `version = ${entry.version}`,
    );
  });
  return `${lines.join('\n')}\n`;
}

export function parseMainnetV8PublishedToml(text) {
  boundedText(text, 'Published.toml', 1024 * 1024);
  if (text.includes('\r')) fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml must use canonical LF lines.');
  const lines = text.split('\n');
  if (lines.at(-1) !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml must end with LF.');
  lines.pop();
  const expectedHeader = [
    '# generated by Move',
    '# this file contains metadata from ephemeral publications',
    '# this file should not be committed to source control',
    '',
  ];
  if (lines.slice(0, 4).some((line, index) => line !== expectedHeader[index])) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml generated header is invalid.');
  }
  const buildMatch = /^build-env = (".*")$/.exec(lines[4] ?? '');
  const chainMatch = /^chain-id = (".*")$/.exec(lines[5] ?? '');
  if (!buildMatch || !chainMatch || lines[6] !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml root fields are invalid.');
  const result = {
    buildEnv: parseTomlString(buildMatch[1], 'build-env'),
    chainId: parseTomlString(chainMatch[1], 'chain-id'),
    entries: [],
    externalEntries: [],
  };
  let index = 7;
  while (index < lines.length) {
    if (result.entries.length + result.externalEntries.length > 0) {
      if (lines[index] !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml entries need one blank separator.');
      index += 1;
    }
    if (lines[index] !== '[[published]]') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml entry header is invalid.');
    const source = /^source = \{ local = (".*") \}$/.exec(lines[index + 1] ?? '');
    const publishedAt = /^published-at = (".*")$/.exec(lines[index + 2] ?? '');
    const originalId = /^original-id = (".*")$/.exec(lines[index + 3] ?? '');
    const version = /^version = ([0-9]+)$/.exec(lines[index + 4] ?? '');
    if (!source || !publishedAt || !originalId || !version) {
      fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published object metadata is malformed.');
    }
    const sourcePath = parseTomlString(source[1], 'published source');
    const external = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.find(pin => basename(pin.subdir) === basename(sourcePath));
    if (external) {
      result.externalEntries.push({ packageName: external.packageName, source: sourcePath,
        publishedAt: parseTomlString(publishedAt[1], 'published-at'),
        originalId: parseTomlString(originalId[1], 'original-id'), version: version[1] });
      index += 5;
      continue;
    }
    if (result.externalEntries.length) fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Native entries cannot follow external dependencies.');
    const toolchainVersion = /^toolchain-version = (".*")$/.exec(lines[index + 5] ?? '');
    const build = /^build-config = \{ flavor = (".*"), edition = (".*") \}$/.exec(lines[index + 6] ?? '');
    const cap = /^upgrade-capability = (".*")$/.exec(lines[index + 7] ?? '');
    if (!source || !publishedAt || !originalId || !version || !toolchainVersion || !build || !cap) {
      fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `Published.toml entry ${result.entries.length} is malformed.`);
    }
    result.entries.push({
      packageName: basename(sourcePath),
      source: sourcePath,
      publishedAt: parseTomlString(publishedAt[1], 'published-at'),
      originalId: parseTomlString(originalId[1], 'original-id'),
      version: version[1],
      toolchainVersion: parseTomlString(toolchainVersion[1], 'toolchain-version'),
      buildConfig: {
        flavor: parseTomlString(build[1], 'build flavor'),
        edition: parseTomlString(build[2], 'build edition'),
      },
      upgradeCapability: parseTomlString(cap[1], 'upgrade-capability'),
    });
    index += 8;
  }
  assertPublishedFile(result);
  if (renderMainnetV8PublishedToml(result) !== text) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml is not in deterministic canonical form.');
  }
  return deepFreeze(result);
}

function walCursor(ordinal, attempt) {
  const cursor = {
    ordinal: decimalInput(ordinal, 'WAL cursor ordinal'),
    attempt: decimalInput(attempt, 'WAL cursor attempt'),
  };
  if (BigInt(cursor.ordinal) >= BigInt(MAINNET_V8_RELEASE_STEPS.length)) {
    fail('MAINNET_V8_WAL_INVALID', 'WAL cursor ordinal is outside the release plan.');
  }
  return cursor;
}

function assertEvidenceCursor(cursor, event, label) {
  exactFields(cursor, WAL_CURSOR_FIELDS, `${label} cursor`);
  assertMainnetV8Decimal(cursor.ordinal, `${label} cursor.ordinal`);
  assertMainnetV8Decimal(cursor.attempt, `${label} cursor.attempt`);
  if (cursor.ordinal !== event.ordinal || cursor.attempt !== event.attempt) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} cursor differs from its WAL event.`);
  }
}

function readyStageKind(ordinal) {
  const index = Number(BigInt(ordinal));
  return MAINNET_V8_RELEASE_STEPS[index]?.kind;
}

function sameBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertReadyProtocolProfile(profile, envelope, label = 'READY protocolProfile') {
  exactFields(profile, PROTOCOL_PROFILE_FIELDS, label);
  exactFields(profile.attributes, PROTOCOL_ATTRIBUTES_FIELDS, `${label}.attributes`);
  if (profile.chainIdentifier !== MAINNET_V8_CHAIN_IDENTIFIER
    || profile.protocolVersion !== MAINNET_V8_PROTOCOL_PROFILE.protocolVersion
    || profile.attributes.objectRuntimeMaxNumCachedObjects
      !== MAINNET_V8_PROTOCOL_PROFILE.objectRuntimeMaxNumCachedObjects
    || profile.attributes.objectRuntimeMaxNumStoreEntries
      !== MAINNET_V8_PROTOCOL_PROFILE.objectRuntimeMaxNumStoreEntries) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} differs from the approved Mainnet protocol profile.`);
  }
  assertMainnetV8Decimal(profile.epoch, `${label}.epoch`);
  assertMainnetV8Decimal(profile.gasPrice, `${label}.gasPrice`, { positive: true });
  if (envelope !== null && profile.gasPrice !== envelope.gasPrice) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.gasPrice differs from the unsigned transaction.`);
  }
  if (envelope !== null) {
    exactFields(envelope.expiration, ['$kind', 'ValidDuring'], 'READY transaction expiration');
    const window = envelope.expiration.ValidDuring;
    exactFields(window, VALID_DURING_FIELDS, 'READY transaction ValidDuring expiration');
    assertMainnetV8Decimal(window.minEpoch, 'READY transaction expiration.minEpoch');
    assertMainnetV8Decimal(window.maxEpoch, 'READY transaction expiration.maxEpoch');
    if (envelope.expiration.$kind !== 'ValidDuring' || window.minEpoch !== profile.epoch
      || BigInt(window.maxEpoch) !== BigInt(profile.epoch) + 1n
      || window.minTimestamp !== null || window.maxTimestamp !== null
      || window.chain !== MAINNET_V8_CHAIN_IDENTIFIER
      || !Number.isSafeInteger(window.nonce) || window.nonce < 0 || window.nonce > 0xffff_ffff) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'READY transaction expiration is outside the profiled Mainnet epoch window.');
    }
  }
  return profile;
}

function parseTransactionEffects(bytes, expectedDigest, expectedSuccess, label) {
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionEffects.parse(bytes);
    roundtrip = bcs.TransactionEffects.serialize(parsed, { maxSize: 512 * 1024 }).toBytes();
  } catch {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not canonical TransactionEffects BCS.`);
  }
  const value = parsed.V1 ?? parsed.V2;
  const succeeded = value?.status?.$kind === 'Success';
  if (!value || !sameBytes(bytes, roundtrip) || value.transactionDigest !== expectedDigest
    || succeeded !== expectedSuccess) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} status or digest differs from its transaction.`);
  }
  exactFields(value.gasUsed, GAS_USED_FIELDS, `${label}.gasUsed`);
  GAS_USED_FIELDS.forEach((field) => assertMainnetV8Decimal(
    String(value.gasUsed[field]), `${label}.gasUsed.${field}`,
  ));
  return { parsed, value, succeeded };
}

function effectsChangedObjectCount(parsed, value) {
  if (parsed.$kind === 'V1') {
    return ['created', 'mutated', 'unwrapped', 'deleted', 'unwrappedThenDeleted', 'wrapped']
      .reduce((total, field) => total + value[field].length, 0);
  }
  return value.changedObjects.length;
}

function assertSimulation(simulation, envelope, profile, label = 'READY simulation') {
  exactFields(simulation, SIMULATION_FIELDS, label);
  assertSuiDigest(simulation.digest, `${label}.digest`);
  assertSuiDigest(simulation.effectsTransactionDigest, `${label}.effectsTransactionDigest`);
  const effects = decodeCanonicalBase64(simulation.effectsBcsBase64, `${label}.effectsBcsBase64`);
  if (effects.length === 0) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} must bind non-empty effects BCS.`);
  const parsedEffects = parseTransactionEffects(
    effects,
    simulation.effectsTransactionDigest,
    true,
    `${label}.effectsBcsBase64`,
  );
  exactFields(simulation.gasUsed, GAS_USED_FIELDS, `${label}.gasUsed`);
  GAS_USED_FIELDS.forEach((field) => assertMainnetV8Decimal(
    simulation.gasUsed[field], `${label}.gasUsed.${field}`,
  ));
  assertMainnetV8Decimal(simulation.recommendedGasBudget, `${label}.recommendedGasBudget`, { positive: true });
  if (!Array.isArray(simulation.changedObjects) || !isPlain(simulation.objectTypes)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} changedObjects/objectTypes are malformed.`);
  }
  assertMainnetV8DeterministicJson(simulation.changedObjects, `${label}.changedObjects`);
  assertMainnetV8DeterministicJson(simulation.objectTypes, `${label}.objectTypes`);
  if (simulation.digest !== envelope.digest
    || String(parsedEffects.value.executedEpoch) !== profile.epoch
    || canonicalMainnetV8Json(simulation.gasUsed)
      !== canonicalMainnetV8Json(parsedEffects.value.gasUsed)
    || simulation.changedObjects.length
      !== effectsChangedObjectCount(parsedEffects.parsed, parsedEffects.value)
    || BigInt(simulation.recommendedGasBudget) > BigInt(envelope.gasBudget)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not the final successful simulation for the unsigned transaction.`);
  }
  return simulation;
}

function assertGasFunding(funding, envelope, profile, label = 'READY gasFunding') {
  exactFields(funding, GAS_FUNDING_FIELDS, label);
  const suiType = `${normalizeMainnetV8ObjectId('0x2')}::sui::SUI`;
  if (funding.coinType !== suiType) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.coinType must be canonical Mainnet SUI.`);
  }
  assertMainnetV8Decimal(funding.addressBalance, `${label}.addressBalance`);
  assertMainnetV8Decimal(funding.coinBalance, `${label}.coinBalance`);
  assertMainnetV8Decimal(funding.checkedAtEpoch, `${label}.checkedAtEpoch`);
  if (funding.checkedAtEpoch !== profile.epoch
    || BigInt(funding.addressBalance) < BigInt(envelope.gasBudget)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} does not cover the exact gas budget at the profiled epoch.`);
  }
  return funding;
}

function assertPredecessorReadback(readback, ordinal, label = 'READY predecessorReadback') {
  const index = BigInt(ordinal);
  if (index === 0n) {
    if (readback !== null) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} must be null for ordinal 0.`);
    }
    return readback;
  }
  exactFields(readback, PREDECESSOR_READBACK_FIELDS, label);
  assertMainnetV8Decimal(readback.ordinal, `${label}.ordinal`);
  if (BigInt(readback.ordinal) + 1n !== index || !isPlain(readback.certificate)
    || Object.keys(readback.certificate).length === 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} must contain the immediately preceding ordinal certificate.`);
  }
  assertMainnetV8DeterministicJson(readback.certificate, `${label}.certificate`);
  assertHash(readback.certificateSha256, `${label}.certificateSha256`);
  if (readback.certificateSha256 !== sha256MainnetV8Json(readback.certificate)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} certificate hash is invalid.`);
  }
  return readback;
}

function assertReadyGates(artifact, ordinal, envelope) {
  assertHash(artifact.publishedTomlSha256, 'READY publishedTomlSha256');
  assertReadyProtocolProfile(artifact.protocolProfile, envelope);
  assertPredecessorReadback(artifact.predecessorReadback, ordinal);
  if (readyStageKind(ordinal) === 'VERIFY_AND_EXPORT') {
    if (artifact.simulation !== null || artifact.gasFunding !== null) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT cannot carry transaction simulation or gas funding.');
    }
  } else {
    assertSimulation(artifact.simulation, envelope, artifact.protocolProfile);
    assertGasFunding(artifact.gasFunding, envelope, artifact.protocolProfile);
  }
}

function assertPublishReadyArtifact(artifact, ordinal, envelope) {
  exactFields(artifact, PUBLISH_READY_FIELDS, 'Publish READY artifact');
  const index = Number(BigInt(ordinal));
  const role = MAINNET_V8_PUBLISH_ORDER[index];
  if (artifact.kind !== 'PUBLISH' || artifact.role !== role) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publish READY artifact role or kind differs from its ordinal.');
  }
  assertMainnetV8PackageArtifact(artifact.packageArtifact);
  assertHash(artifact.packageCommitment, 'Publish READY packageCommitment');
  if (artifact.packageArtifact.role !== role
    || artifact.packageCommitment !== mainnetV8PackageCommitment(artifact.packageArtifact)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publish READY package commitment is invalid.');
  }
  if (!Array.isArray(artifact.modules) || artifact.modules.length === 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publish READY modules must be a non-empty array.');
  }
  const moduleHashes = artifact.modules.map((module, indexValue) => {
    const bytes = decodeCanonicalBase64(module, `Publish READY modules[${indexValue}]`);
    if (bytes.length === 0) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publish READY module bytes cannot be empty.');
    return sha256MainnetV8Bytes(bytes);
  }).sort(compareMainnetV8Text);
  const expectedModuleHashes = artifact.packageArtifact.modules
    .map(({ sha256 }) => sha256).sort(compareMainnetV8Text);
  if (canonicalMainnetV8Json(moduleHashes) !== canonicalMainnetV8Json(expectedModuleHashes)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publish READY module bytes differ from the package artifact.');
  }
  if (!Array.isArray(artifact.dependencies)
    || canonicalMainnetV8Json(artifact.dependencies) !== canonicalMainnetV8Json(artifact.packageArtifact.dependencies)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publish READY dependencies differ from the package artifact.');
  }
  assertHash(artifact.publishedTomlSha256, 'Publish READY publishedTomlSha256');
  assertReadyGates(artifact, ordinal, envelope);
  return artifact;
}

function assertSetupKeyServerCertificates(stageData) {
  const label = 'SETUP_RELEASE stageData';
  if (!Array.isArray(stageData.keyServerCertificates)
    || stageData.keyServerCertificates.length !== stageData.sealPolicy.keyServers.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} key-server certificate cardinality drifted.`);
  }
  stageData.keyServerCertificates.forEach((certificate, index) => {
    exactFields(certificate, KEY_SERVER_CERTIFICATE_FIELDS, `${label}.keyServerCertificates[${index}]`);
    const approved = MAINNET_V8_BROWSER_KEY_SERVERS[index];
    if (certificate.objectId !== stageData.sealPolicy.keyServers[index].objectId
      || !approved || certificate.objectId !== approved.objectId
      || certificate.type !== MAINNET_V8_BROWSER_KEY_SERVER_TYPE
      || certificate.owner !== approved.owner
      || certificate.contentSha256 !== approved.contentSha256) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} key-server certificate identity drifted.`);
    }
    assertMainnetV8Decimal(certificate.version, `${label}.keyServerCertificates[${index}].version`, {
      positive: true,
    });
    assertSuiDigest(certificate.digest, `${label}.keyServerCertificates[${index}].digest`);
    assertFullId(certificate.owner, `${label}.keyServerCertificates[${index}].owner`);
    assertSuiDigest(
      certificate.previousTransaction, `${label}.keyServerCertificates[${index}].previousTransaction`,
    );
    assertHash(certificate.contentSha256, `${label}.keyServerCertificates[${index}].contentSha256`);
  });
  return stageData;
}

/** Flat READY metadata -> the exact pure native builder input. No network,
 * signer, gas or ctx is accepted; historical object/finality checks are separate.
 * The sole metadata-only field is SETUP_RELEASE.keyServerCertificates. */
export function nativeSoulBootstrapInputFromStageData(kind, stageData) {
  if (!NATIVE_BOOTSTRAP_STAGE_KINDS.includes(kind)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Unsupported native bootstrap stage kind.');
  }
  assertMainnetV8DeterministicJson(stageData, `${kind} stageData`);
  if (!isPlain(stageData)) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Native stageData must be a plain flat input.');
  const input = cloneJson(stageData);
  if (kind === 'SETUP_RELEASE') delete input.keyServerCertificates;
  try {
    // Calling the actual builder exercises its exact field, ID/ref, role-set,
    // Walrus and policy checks without RPC or Transaction.build resolution.
    buildNativeSoulBootstrapTransaction(kind, input);
  } catch (cause) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${kind} input differs from the native transaction ABI.`,
      { cause: String(cause?.message ?? cause) });
  }
  if (kind === 'SETUP_RELEASE') assertSetupKeyServerCertificates(stageData);
  return deepFreeze(input);
}

export function nativeSoulMarketActivationInputFromStageData(stageData) {
  assertMainnetV8DeterministicJson(stageData, 'Market activation stageData');
  const input = cloneJson(stageData);
  buildNativeSoulMarketActivationTransaction(input);
  return deepFreeze(input);
}

function assertVerifyStageData(stageData) {
  const label = 'VERIFY_AND_EXPORT stageData';
  exactFields(stageData, VERIFY_STAGE_DATA_FIELDS, label);
  assertHash(stageData.releaseId, `${label}.releaseId`);
  assertHash(stageData.finalManifestSha256, `${label}.finalManifestSha256`);
  assertHash(stageData.bootstrapCertificateSha256, `${label}.bootstrapCertificateSha256`);
  assertHash(stageData.marketActivationCertificateSha256, `${label}.marketActivationCertificateSha256`);
  boundedText(stageData.exportFilename, `${label}.exportFilename`, 255);
  if (basename(stageData.exportFilename) !== stageData.exportFilename
    || stageData.exportFilename === '.' || stageData.exportFilename === '..') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.exportFilename must be one safe basename.`);
  }
  return stageData;
}

function assertStageReadyArtifact(artifact, ordinal, envelope) {
  exactFields(artifact, STAGE_READY_FIELDS, 'Release stage READY artifact');
  const expectedKind = readyStageKind(ordinal);
  if (artifact.kind !== expectedKind || !isPlain(artifact.stageData)
    || Object.keys(artifact.stageData).length === 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${expectedKind} READY stageData must be one non-empty exact record.`);
  }
  assertMainnetV8DeterministicJson(artifact.stageData, `${expectedKind} READY stageData`);
  assertHash(artifact.stageDataSha256, `${expectedKind} READY stageDataSha256`);
  if (artifact.stageDataSha256 !== sha256MainnetV8Json(artifact.stageData)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${expectedKind} READY stageData hash is invalid.`);
  }
  if (NATIVE_BOOTSTRAP_STAGE_KINDS.includes(expectedKind)) nativeSoulBootstrapInputFromStageData(expectedKind, artifact.stageData);
  else if (expectedKind === 'ACTIVATE_SOULIDITY_MARKET') nativeSoulMarketActivationInputFromStageData(artifact.stageData);
  else if (expectedKind === 'VERIFY_AND_EXPORT') assertVerifyStageData(artifact.stageData);
  else fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Unknown nonpublication READY stage.');
  assertReadyGates(artifact, ordinal, envelope);
  return artifact;
}

function assertReadyArtifact(artifact, ordinal, envelope) {
  if (!isPlain(artifact)) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'READY artifact must be a plain record.');
  return readyStageKind(ordinal) === 'PUBLISH'
    ? assertPublishReadyArtifact(artifact, ordinal, envelope)
    : assertStageReadyArtifact(artifact, ordinal, envelope);
}

export function computeMainnetV8TransactionBinding({
  ordinal, attempt = '0', readyArtifact, unsignedEnvelope = null,
}) {
  const cursor = walCursor(ordinal, attempt);
  assertMainnetV8DeterministicJson(readyArtifact, 'Transaction binding readyArtifact');
  if (unsignedEnvelope !== null) {
    assertMainnetV8DeterministicJson(unsignedEnvelope, 'Transaction binding unsignedEnvelope');
  }
  return sha256MainnetV8Json({
    domain: MAINNET_V8_TRANSACTION_BINDING_DOMAIN,
    cursor,
    readyArtifact,
    unsignedEnvelope,
  });
}

export function assertMainnetV8UnsignedEnvelope(envelope) {
  assertMainnetV8DeterministicJson(envelope, 'Unsigned transaction envelope');
  exactFields(envelope, UNSIGNED_ENVELOPE_FIELDS, 'Unsigned transaction envelope');
  const transactionBytes = decodeCanonicalBase64(envelope.transactionBase64, 'Unsigned transactionBase64');
  const transactionKindBytes = decodeCanonicalBase64(envelope.transactionKindBase64, 'Unsigned transactionKindBase64');
  if (transactionBytes.length === 0 || transactionBytes.length > 128 * 1024
    || transactionKindBytes.length === 0 || transactionKindBytes.length > 128 * 1024) {
    fail('MAINNET_V8_UNSIGNED_ENVELOPE_INVALID', 'Unsigned transaction bytes exceed their exact bounds.');
  }
  assertMainnetV8Decimal(envelope.transactionByteLength, 'Unsigned transactionByteLength', { positive: true });
  assertHash(envelope.transactionSha256, 'Unsigned transactionSha256');
  assertHash(envelope.transactionKindSha256, 'Unsigned transactionKindSha256');
  assertSuiDigest(envelope.digest, 'Unsigned digest');
  assertFullId(envelope.sender, 'Unsigned sender');
  assertFullId(envelope.gasOwner, 'Unsigned gasOwner');
  assertMainnetV8Decimal(envelope.gasBudget, 'Unsigned gasBudget', { positive: true });
  assertMainnetV8Decimal(envelope.gasPrice, 'Unsigned gasPrice', { positive: true });
  assertMainnetV8DeterministicJson(envelope.expiration, 'Unsigned expiration');
  let parsed;
  let roundtrip;
  let derivedKindBytes;
  let derivedDigest;
  try {
    parsed = bcs.TransactionData.parse(transactionBytes);
    roundtrip = bcs.TransactionData.serialize(parsed, { maxSize: 128 * 1024 }).toBytes();
    derivedKindBytes = bcs.TransactionKind.serialize(parsed.V1.kind, { maxSize: 128 * 1024 }).toBytes();
    derivedDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  } catch {
    fail('MAINNET_V8_UNSIGNED_ENVELOPE_INVALID', 'Unsigned transaction bytes are not canonical TransactionData.');
  }
  if (parsed?.$kind !== 'V1' || !parsed.V1 || !sameBytes(transactionBytes, roundtrip)
    || !sameBytes(transactionKindBytes, derivedKindBytes)
    || !Array.isArray(parsed.V1.gasData.payment) || parsed.V1.gasData.payment.length !== 0
    || envelope.transactionByteLength !== String(transactionBytes.length)
    || envelope.transactionSha256 !== sha256MainnetV8Bytes(transactionBytes)
    || envelope.transactionKindSha256 !== sha256MainnetV8Bytes(transactionKindBytes)
    || envelope.digest !== derivedDigest
    || envelope.sender !== parsed.V1.sender
    || envelope.gasOwner !== parsed.V1.gasData.owner
    || envelope.sender !== envelope.gasOwner
    || envelope.sender !== MAINNET_V8_RELEASE_SIGNER
    || envelope.gasBudget !== String(parsed.V1.gasData.budget)
    || envelope.gasPrice !== String(parsed.V1.gasData.price)
    || canonicalMainnetV8Json(envelope.expiration)
      !== canonicalMainnetV8Json(parsed.V1.expiration)) {
    fail('MAINNET_V8_UNSIGNED_ENVELOPE_INVALID', 'Unsigned envelope differs from canonical payment-free TransactionData.');
  }
  return envelope;
}

export function assertMainnetV8SignedArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'Signed artifact');
  exactFields(artifact, SIGNED_ARTIFACT_FIELDS, 'Signed artifact');
  const transactionBytes = decodeCanonicalBase64(artifact.transactionBase64, 'Signed transactionBase64');
  const transactionKindBytes = decodeCanonicalBase64(artifact.transactionKindBase64, 'Signed transactionKindBase64');
  const signatureBytes = decodeCanonicalBase64(artifact.signature, 'Signed signature');
  const senderSignedDataBytes = decodeCanonicalBase64(artifact.senderSignedDataBase64, 'Signed senderSignedDataBase64');
  if (transactionBytes.length === 0 || transactionBytes.length > 128 * 1024
    || transactionKindBytes.length === 0 || transactionKindBytes.length > 128 * 1024
    || signatureBytes.length === 0 || signatureBytes.length > 64 * 1024
    || senderSignedDataBytes.length === 0 || senderSignedDataBytes.length > 256 * 1024) {
    fail('MAINNET_V8_SIGNED_ARTIFACT_INVALID', 'Signed artifact bytes exceed their exact bounds.');
  }
  assertHash(artifact.transactionSha256, 'Signed transactionSha256');
  assertHash(artifact.transactionKindSha256, 'Signed transactionKindSha256');
  assertHash(artifact.signatureSha256, 'Signed signatureSha256');
  assertHash(artifact.senderSignedDataSha256, 'Signed senderSignedDataSha256');
  assertSuiDigest(artifact.digest, 'Signed digest');
  assertFullId(artifact.signer, 'Signed signer');
  let parsed;
  let roundtrip;
  let derivedKindBytes;
  let senderSignedData;
  let senderSignedRoundtrip;
  let derivedDigest;
  try {
    parsed = bcs.TransactionData.parse(transactionBytes);
    roundtrip = bcs.TransactionData.serialize(parsed, { maxSize: 128 * 1024 }).toBytes();
    derivedKindBytes = bcs.TransactionKind.serialize(parsed.V1.kind, { maxSize: 128 * 1024 }).toBytes();
    senderSignedData = bcs.SenderSignedData.parse(senderSignedDataBytes);
    senderSignedRoundtrip = bcs.SenderSignedData.serialize(
      senderSignedData, { maxSize: 256 * 1024 },
    ).toBytes();
    derivedDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  } catch {
    fail('MAINNET_V8_SIGNED_ARTIFACT_INVALID', 'Signed transaction bytes are not canonical TransactionData.');
  }
  const senderTransaction = senderSignedData?.[0];
  let senderTransactionBytes = null;
  try {
    if (senderTransaction) {
      senderTransactionBytes = bcs.TransactionData.serialize(
        senderTransaction.intentMessage.value, { maxSize: 128 * 1024 },
      ).toBytes();
    }
  } catch {
    fail('MAINNET_V8_SIGNED_ARTIFACT_INVALID', 'SenderSignedData contains invalid TransactionData.');
  }
  if (parsed?.$kind !== 'V1' || !parsed.V1 || !sameBytes(transactionBytes, roundtrip)
    || !sameBytes(transactionKindBytes, derivedKindBytes)
    || parsed.V1.sender !== artifact.signer || parsed.V1.gasData.owner !== artifact.signer
    || artifact.signer !== MAINNET_V8_RELEASE_SIGNER
    || !Array.isArray(parsed.V1.gasData.payment) || parsed.V1.gasData.payment.length !== 0
    || !sameBytes(senderSignedDataBytes, senderSignedRoundtrip)
    || senderSignedData.length !== 1
    || senderTransaction.intentMessage.intent.scope?.$kind !== 'TransactionData'
    || senderTransaction.intentMessage.intent.version?.$kind !== 'V0'
    || senderTransaction.intentMessage.intent.appId?.$kind !== 'Sui'
    || senderTransaction.txSignatures.length !== 1
    || senderTransaction.txSignatures[0] !== artifact.signature
    || !sameBytes(senderTransactionBytes, transactionBytes)
    || artifact.transactionSha256 !== sha256MainnetV8Bytes(transactionBytes)
    || artifact.transactionKindSha256 !== sha256MainnetV8Bytes(transactionKindBytes)
    || artifact.signatureSha256 !== sha256MainnetV8Bytes(signatureBytes)
    || artifact.senderSignedDataSha256 !== sha256MainnetV8Bytes(senderSignedDataBytes)
    || artifact.digest !== derivedDigest) {
    fail('MAINNET_V8_SIGNED_ARTIFACT_INVALID', 'Signed artifact, SenderSignedData, or transaction continuity drifted.');
  }
  return artifact;
}

function observationKind(status, ordinal) {
  if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND', 'INCIDENT_STOPPED'].includes(status)
    && readyStageKind(ordinal) !== 'PUBLISH') {
    return `${readyStageKind(ordinal)}_${status}`;
  }
  return status;
}

function assertHashedRecord(details, valueField, hashField, label) {
  const value = details[valueField];
  if (!isPlain(value) || Object.keys(value).length === 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.${valueField} must be a non-empty record.`);
  }
  assertMainnetV8DeterministicJson(value, `${label}.${valueField}`);
  assertHash(details[hashField], `${label}.${hashField}`);
  if (details[hashField] !== sha256MainnetV8Json(value)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.${hashField} does not bind ${valueField}.`);
  }
}

function assertTypedNotFoundQuery(query, label) {
  exactFields(query, NOT_FOUND_QUERY_FIELDS, label);
  if (query.kind !== 'TYPED_NOT_FOUND' || query.code !== 'NOT_FOUND') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not a typed NOT_FOUND result.`);
  }
  if (query.service !== MAINNET_LEDGER_SERVICE || query.method !== MAINNET_GET_TRANSACTION) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not LedgerService/GetTransaction NOT_FOUND.`);
  }
  assertSuiDigest(query.digest, `${label}.digest`);
  assertHash(query.signedArtifactSha256, `${label}.signedArtifactSha256`);
  if (query.chainIdentifier !== MAINNET_V8_CHAIN_IDENTIFIER) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not bound to Sui Mainnet.`);
  }
  boundedText(query.endpoint, `${label}.endpoint`, 4096);
  let endpoint;
  try { endpoint = new URL(query.endpoint); } catch {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.endpoint is not an absolute URL.`);
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.endpoint must be one credential-free HTTPS endpoint.`);
  }
  assertRecordedAt(query.observedAt);
  if (query.afterWatermark !== null) {
    exactFields(query.afterWatermark, WATERMARK_FIELDS, `${label}.afterWatermark`);
    assertMainnetV8Decimal(query.afterWatermark.epoch, `${label}.afterWatermark.epoch`);
    assertMainnetV8Decimal(
      query.afterWatermark.checkpointSequence, `${label}.afterWatermark.checkpointSequence`,
    );
    assertSuiDigest(query.afterWatermark.checkpointDigest, `${label}.afterWatermark.checkpointDigest`);
  }
  return query;
}

function assertNotFoundBroadcastIntent(details) {
  exactFields(details, BROADCAST_INTENT_FIELDS, 'BROADCAST_INTENT details');
  assertTypedNotFoundQuery(details.firstQuery, 'BROADCAST_INTENT firstQuery');
  assertTypedNotFoundQuery(details.secondQuery, 'BROADCAST_INTENT secondQuery');
  assertHash(details.firstQuerySha256, 'BROADCAST_INTENT firstQuerySha256');
  assertHash(details.secondQuerySha256, 'BROADCAST_INTENT secondQuerySha256');
  if (details.firstQuerySha256 !== sha256MainnetV8Json(details.firstQuery)
    || details.secondQuerySha256 !== sha256MainnetV8Json(details.secondQuery)
    || details.firstQuerySha256 === details.secondQuerySha256) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'BROADCAST_INTENT requires two distinct typed-NOT_FOUND query records.');
  }
  exactFields(details.watermark, WATERMARK_FIELDS, 'BROADCAST_INTENT watermark');
  assertMainnetV8Decimal(details.watermark.epoch, 'BROADCAST_INTENT watermark.epoch');
  assertMainnetV8Decimal(
    details.watermark.checkpointSequence, 'BROADCAST_INTENT watermark.checkpointSequence',
  );
  assertSuiDigest(details.watermark.checkpointDigest, 'BROADCAST_INTENT watermark.checkpointDigest');
  if (details.firstQuery.afterWatermark !== null
    || canonicalMainnetV8Json(details.secondQuery.afterWatermark)
      !== canonicalMainnetV8Json(details.watermark)
    || new Date(details.firstQuery.observedAt).valueOf()
      >= new Date(details.secondQuery.observedAt).valueOf()) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'BROADCAST_INTENT query ordering or watermark binding is invalid.');
  }
}

function assertBroadcastResponse(response, label = 'Broadcast accepted response') {
  exactFields(response, BROADCAST_RESPONSE_FIELDS, label);
  assertSuiDigest(response.digest, `${label}.digest`);
  if (!['ACCEPTED_SUCCESS', 'ACCEPTED_FAILURE'].includes(response.status)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.status is invalid.`);
  }
  if (response.effectsBcsBase64 !== null) {
    const bytes = decodeCanonicalBase64(response.effectsBcsBase64, `${label}.effectsBcsBase64`);
    if (bytes.length === 0) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} effects cannot be empty.`);
    parseTransactionEffects(
      bytes, response.digest, response.status === 'ACCEPTED_SUCCESS', `${label}.effectsBcsBase64`,
    );
  }
  return response;
}

function assertRpcErrorRecord(error, label = 'RPC error') {
  exactFields(error, RPC_ERROR_FIELDS, label);
  boundedText(error.code, `${label}.code`, 512);
  boundedText(error.message, `${label}.message`, 16 * 1024);
  for (const field of ['service', 'method']) {
    if (error[field] !== null) boundedText(error[field], `${label}.${field}`, 1024);
  }
  if (!isPlain(error.details)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.details must be one exact record.`);
  }
  assertMainnetV8DeterministicJson(error.details, `${label}.details`);
  assertNoSecretFields(error.details, `${label}.details`);
  return error;
}

function assertIncidentRecord(incident, label = 'Release incident') {
  exactFields(incident, INCIDENT_FIELDS, label);
  boundedText(incident.code, `${label}.code`, 512);
  boundedText(incident.message, `${label}.message`, 16 * 1024);
  if (!isPlain(incident.details)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.details must be one exact record.`);
  }
  assertMainnetV8DeterministicJson(incident.details, `${label}.details`);
  assertNoSecretFields(incident.details, `${label}.details`);
  return incident;
}

function assertVerifyIncidentRecord(incident) {
  assertIncidentRecord(incident, 'VERIFY_AND_EXPORT incident');
  exactFields(incident.details, VERIFY_INCIDENT_CONTEXT_FIELDS, 'VERIFY_AND_EXPORT incident.details');
  for (const field of [
    'executionPlanId', 'releaseId', 'finalManifestSha256', 'bootstrapCertificateSha256',
    'marketActivationCertificateSha256',
    'expectedSha256', 'observedSha256',
  ]) assertHash(incident.details[field], `VERIFY_AND_EXPORT incident.details.${field}`);
  boundedText(incident.details.check, 'VERIFY_AND_EXPORT incident.details.check', 1024);
  if (incident.details.expectedSha256 === incident.details.observedSha256) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT incident does not record an observed mismatch.');
  }
  return incident;
}

function assertExpirationCertificate(record, label = 'Expired not-found certificate') {
  exactFields(record, EXPIRATION_CERTIFICATE_FIELDS, label);
  if (record.kind !== 'EXPIRED_NOT_FOUND') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.kind is invalid.`);
  }
  assertSuiDigest(record.digest, `${label}.digest`);
  assertTypedNotFoundQuery(record.firstQuery, `${label}.firstQuery`);
  assertTypedNotFoundQuery(record.secondQuery, `${label}.secondQuery`);
  exactFields(record.watermark, WATERMARK_FIELDS, `${label}.watermark`);
  assertMainnetV8Decimal(record.watermark.epoch, `${label}.watermark.epoch`);
  assertMainnetV8Decimal(record.watermark.checkpointSequence, `${label}.watermark.checkpointSequence`);
  assertSuiDigest(record.watermark.checkpointDigest, `${label}.watermark.checkpointDigest`);
  exactFields(record.expiration, ['$kind', 'ValidDuring'], `${label}.expiration`);
  exactFields(record.expiration.ValidDuring, VALID_DURING_FIELDS, `${label}.expiration.ValidDuring`);
  const expiration = record.expiration.ValidDuring;
  assertMainnetV8Decimal(expiration.minEpoch, `${label}.expiration.minEpoch`);
  assertMainnetV8Decimal(expiration.maxEpoch, `${label}.expiration.maxEpoch`);
  if (record.expiration.$kind !== 'ValidDuring'
    || expiration.minTimestamp !== null || expiration.maxTimestamp !== null
    || expiration.chain !== MAINNET_V8_CHAIN_IDENTIFIER
    || !Number.isSafeInteger(expiration.nonce) || expiration.nonce < 0 || expiration.nonce > 0xffff_ffff
    || record.firstQuery.afterWatermark !== null
    || canonicalMainnetV8Json(record.secondQuery.afterWatermark)
      !== canonicalMainnetV8Json(record.watermark)
    || record.firstQuery.digest !== record.digest || record.secondQuery.digest !== record.digest
    || new Date(record.firstQuery.observedAt).valueOf()
      >= new Date(record.secondQuery.observedAt).valueOf()
    || BigInt(record.watermark.epoch) <= BigInt(expiration.maxEpoch)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} does not prove post-expiration typed NOT_FOUND.`);
  }
  const common = ['digest', 'signedArtifactSha256', 'service', 'method', 'endpoint', 'chainIdentifier'];
  if (common.some((field) => record.firstQuery[field] !== record.secondQuery[field])) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} query pair is not bound to one signed Mainnet transaction.`);
  }
  return record;
}

function assertFinalityEvidence(evidence, expectedSuccess, label = 'Finality evidence') {
  exactFields(evidence, FINALITY_EVIDENCE_FIELDS, label);
  if (evidence.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} schema is invalid.`);
  }
  assertSuiDigest(evidence.digest, `${label}.digest`);
  assertMainnetV8Decimal(evidence.checkpoint, `${label}.checkpoint`);
  assertMainnetV8Decimal(evidence.epoch, `${label}.epoch`);
  const transactionBytes = decodeCanonicalBase64(evidence.transactionBase64, `${label}.transactionBase64`);
  const signatureBytes = decodeCanonicalBase64(evidence.signature, `${label}.signature`);
  const effectsBytes = decodeCanonicalBase64(evidence.effectsBcsBase64, `${label}.effectsBcsBase64`);
  assertHash(evidence.transactionSha256, `${label}.transactionSha256`);
  assertHash(evidence.signatureSha256, `${label}.signatureSha256`);
  assertHash(evidence.effectsSha256, `${label}.effectsSha256`);
  assertSuiDigest(evidence.effectsDigest, `${label}.effectsDigest`);
  if (evidence.transactionSha256 !== sha256MainnetV8Bytes(transactionBytes)
    || evidence.signatureSha256 !== sha256MainnetV8Bytes(signatureBytes)
    || evidence.effectsSha256 !== sha256MainnetV8Bytes(effectsBytes)
    || evidence.effectsDigest !== mainnetV8TypedDigest('TransactionEffects', effectsBytes)
    || TransactionDataBuilder.getDigestFromBytes(transactionBytes) !== evidence.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} byte hashes or transaction digest drifted.`);
  }
  const parsedEffects = parseTransactionEffects(
    effectsBytes, evidence.digest, expectedSuccess, `${label}.effectsBcsBase64`,
  );
  exactFields(evidence.effectsStatus, ['success', 'error'], `${label}.effectsStatus`);
  if (evidence.effectsStatus.success !== expectedSuccess
    || String(parsedEffects.value.executedEpoch) !== evidence.epoch
    || expectedSuccess && evidence.effectsStatus.error !== null
    || !expectedSuccess && (!isPlain(evidence.effectsStatus.error)
      || Object.keys(evidence.effectsStatus.error).length === 0)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} status or epoch differs from TransactionEffects BCS.`);
  }
  if (evidence.eventsDigest === null) {
    if (parsedEffects.value.eventsDigest !== null || evidence.transactionEvents !== null) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} omits events declared by TransactionEffects.`);
    }
  } else {
    assertSuiDigest(evidence.eventsDigest, `${label}.eventsDigest`);
    if (parsedEffects.value.eventsDigest !== evidence.eventsDigest || evidence.transactionEvents === null) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} events digest differs from TransactionEffects.`);
    }
    exactFields(evidence.transactionEvents, ['digest', 'bcsBase64', 'eventCount'], `${label}.transactionEvents`);
    assertSuiDigest(evidence.transactionEvents.digest, `${label}.transactionEvents.digest`);
    const eventBytes = decodeCanonicalBase64(
      evidence.transactionEvents.bcsBase64, `${label}.transactionEvents.bcsBase64`,
    );
    assertMainnetV8Decimal(evidence.transactionEvents.eventCount, `${label}.transactionEvents.eventCount`, {
      positive: true,
    });
    let events;
    let eventRoundtrip;
    try {
      events = SUI_TRANSACTION_EVENTS_BCS.parse(eventBytes);
      eventRoundtrip = SUI_TRANSACTION_EVENTS_BCS.serialize(events, { maxSize: 512 * 1024 }).toBytes();
    } catch {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} transaction events are not canonical BCS.`);
    }
    if (eventBytes.length === 0 || !sameBytes(eventBytes, eventRoundtrip)
      || evidence.transactionEvents.digest !== evidence.eventsDigest
      || evidence.eventsDigest !== mainnetV8TypedDigest('TransactionEvents', eventBytes)
      || evidence.transactionEvents.eventCount !== String(events.data.length)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} transaction events are malformed.`);
    }
  }
  return evidence;
}

function assertEffectOwner(owner, label) {
  if (!isPlain(owner) || typeof owner.kind !== 'string') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not one exact effects owner.`);
  }
  if (owner.kind === 'Immutable') {
    exactFields(owner, ['kind'], label);
  } else if (['AddressOwner', 'ObjectOwner'].includes(owner.kind)) {
    exactFields(owner, ['kind', 'address'], label);
    assertFullId(owner.address, `${label}.address`);
  } else if (owner.kind === 'Shared') {
    exactFields(owner, ['kind', 'initialSharedVersion'], label);
    assertMainnetV8Decimal(owner.initialSharedVersion, `${label}.initialSharedVersion`, { positive: true });
  } else {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} has an unsupported effects owner kind.`);
  }
  return owner;
}

function assertCanonicalOwner(owner, label) {
  if (!isPlain(owner) || Object.keys(owner).length !== 1) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not one exact object owner.`);
  }
  if (typeof owner.AddressOwner === 'string') assertFullId(owner.AddressOwner, `${label}.AddressOwner`);
  else if (typeof owner.ObjectOwner === 'string') assertFullId(owner.ObjectOwner, `${label}.ObjectOwner`);
  else if (owner.Immutable === true) exactFields(owner, ['Immutable'], label);
  else if (isPlain(owner.Shared)) {
    exactFields(owner.Shared, ['initial_shared_version'], `${label}.Shared`);
    assertMainnetV8Decimal(
      owner.Shared.initial_shared_version, `${label}.Shared.initial_shared_version`, { positive: true },
    );
  } else fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} has an unsupported object owner kind.`);
  return owner;
}

function effectOwnerFromBcs(owner, label) {
  if (owner?.$kind === 'Immutable' && owner.Immutable === true) return { kind: 'Immutable' };
  if (owner?.$kind === 'AddressOwner') {
    return { kind: 'AddressOwner', address: assertFullId(owner.AddressOwner, `${label}.AddressOwner`) };
  }
  if (owner?.$kind === 'ObjectOwner') {
    return { kind: 'ObjectOwner', address: assertFullId(owner.ObjectOwner, `${label}.ObjectOwner`) };
  }
  if (owner?.$kind === 'Shared') {
    return {
      kind: 'Shared',
      initialSharedVersion: String(owner.Shared?.initialSharedVersion),
    };
  }
  fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not one supported BCS owner.`);
}

function canonicalOwnerFromEffect(owner) {
  if (owner.kind === 'Immutable') return { Immutable: true };
  if (owner.kind === 'AddressOwner') return { AddressOwner: owner.address };
  if (owner.kind === 'ObjectOwner') return { ObjectOwner: owner.address };
  return { Shared: { initial_shared_version: owner.initialSharedVersion } };
}

function assertEffectReference(reference, label) {
  exactFields(reference, EFFECT_REFERENCE_FIELDS, label);
  if (!['CREATED', 'MUTATED'].includes(reference.operation)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.operation is invalid.`);
  }
  assertFullId(reference.objectId, `${label}.objectId`);
  assertMainnetV8Decimal(reference.version, `${label}.version`, { positive: true });
  assertSuiDigest(reference.digest, `${label}.digest`);
  assertEffectOwner(reference.owner, `${label}.owner`);
  return reference;
}

function finalityWrites(finalityEvidence) {
  const effectsBytes = decodeCanonicalBase64(
    finalityEvidence.effectsBcsBase64, 'Finality effects for output certification',
  );
  const parsed = bcs.TransactionEffects.parse(effectsBytes);
  const value = parsed.V1 ?? parsed.V2;
  if (parsed.$kind === 'V1') {
    const rows = [];
    for (const [operation, entries] of [
      ['CREATED', value.created], ['MUTATED', value.mutated], ['MUTATED', value.unwrapped],
    ]) {
      entries.forEach(([reference, owner], index) => rows.push({
        operation,
        objectId: reference.objectId,
        version: String(reference.version),
        digest: reference.digest,
        owner: effectOwnerFromBcs(owner, `Finality ${operation}[${index}].owner`),
      }));
    }
    rows.forEach((entry, index) => assertEffectReference(entry, `Finality write[${index}]`));
    return rows;
  }
  const version = String(value.lamportVersion);
  const rows = value.changedObjects.flatMap(([objectId, change], index) => {
    const operation = change.idOperation?.$kind === 'Created' ? 'CREATED' : 'MUTATED';
    if (change.outputState?.$kind === 'ObjectWrite') {
      const [digest, owner] = change.outputState.ObjectWrite;
      return [{
        operation, objectId, version, digest,
        owner: effectOwnerFromBcs(owner, `Finality changedObjects[${index}].owner`),
      }];
    }
    if (change.outputState?.$kind === 'PackageWrite') {
      const [packageVersion, packageDigest] = change.outputState.PackageWrite;
      return [{
        operation, objectId, version: String(packageVersion), digest: packageDigest,
        owner: { kind: 'Immutable' },
      }];
    }
    return [];
  });
  rows.forEach((entry, index) => assertEffectReference(entry, `Finality write[${index}]`));
  return rows;
}

function assertObjectReference(reference, label) {
  exactFields(reference, OBJECT_REFERENCE_FIELDS, label);
  assertFullId(reference.objectId, `${label}.objectId`);
  assertMainnetV8Decimal(reference.version, `${label}.version`, { positive: true });
  assertSuiDigest(reference.digest, `${label}.digest`);
  return reference;
}

function assertMoveOutput(output, label, transactionDigest) {
  exactFields(output, MOVE_OUTPUT_FIELDS, label);
  assertObjectReference(output.reference, `${label}.reference`);
  boundedText(output.type, `${label}.type`, 16 * 1024);
  if (/\s/.test(output.type)) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.type is not canonical.`);
  assertCanonicalOwner(output.owner, `${label}.owner`);
  assertSuiDigest(output.previousTransaction, `${label}.previousTransaction`);
  if (output.previousTransaction !== transactionDigest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} belongs to another transaction.`);
  }
  if (!isPlain(output.fields) || Object.keys(output.fields).length === 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.fields must be one non-empty Move field record.`);
  }
  assertMainnetV8DeterministicJson(output.fields, `${label}.fields`);
  for (const [bytesField, hashField] of [
    ['contentBcsBase64', 'contentBcsSha256'], ['objectBcsBase64', 'objectBcsSha256'],
  ]) {
    const bytes = decodeCanonicalBase64(output[bytesField], `${label}.${bytesField}`);
    if (bytes.length === 0) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.${bytesField} cannot be empty.`);
    assertHash(output[hashField], `${label}.${hashField}`);
    if (output[hashField] !== sha256MainnetV8Bytes(bytes)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.${hashField} does not bind ${bytesField}.`);
    }
  }
  return output;
}

function parseExactMoveContent(output, schema, label) {
  const bytes = decodeCanonicalBase64(output.contentBcsBase64, `${label}.contentBcsBase64`);
  let parsed;
  let roundtrip;
  try {
    parsed = schema.parse(bytes);
    roundtrip = schema.serialize(parsed, { maxSize: 1024 * 1024 }).toBytes();
  } catch {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} content is not the expected Move BCS.`);
  }
  if (!sameBytes(bytes, roundtrip)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} content is not canonical Move BCS.`);
  }
  return parsed;
}

function moveObjectId(value, label) {
  if (isPlain(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'id')) {
    return moveObjectId(value.id, label);
  }
  return assertFullId(value, label);
}

function moveDecimal(value, label) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    && !Object.is(value, -0) ? String(value) : value;
  assertMainnetV8Decimal(normalized, label);
  return normalized;
}

function moveHash(value, label) {
  if ((value instanceof Uint8Array || Array.isArray(value)) && value.length === 32
    && [...value].every((entry) => Number.isSafeInteger(entry) && entry >= 0 && entry <= 255)) {
    return [...value].map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const decoded = decodeCanonicalBase64(value, label);
    if (decoded.length === 32) return Buffer.from(decoded).toString('hex');
  }
  const normalized = typeof value === 'string' ? value.replace(/^0x/, '') : value;
  return assertHash(normalized, label);
}

function moveOptionId(value, label) {
  if (value === null) return null;
  if (typeof value === 'string') return moveObjectId(value, label);
  fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} must be exact gRPC Move Option<ID> JSON.`);
}

function findWrite(writes, output, operation, label) {
  const matches = writes.filter((entry) => entry.operation === operation
    && entry.objectId === output.reference.objectId
    && entry.version === output.reference.version
    && entry.digest === output.reference.digest
    && canonicalMainnetV8Json(canonicalOwnerFromEffect(entry.owner))
      === canonicalMainnetV8Json(output.owner));
  if (matches.length !== 1) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not the exact ${operation} output in TransactionEffects.`);
  }
  return matches[0];
}

function assertProtocolConfigOutput(output, {
  corePackageId, transactionDigest, enabled, revision, treasuryId,
}, label) {
  assertMoveOutput(output, label, transactionDigest);
  if (output.type !== `${corePackageId}::protocol_config_v8::ProtocolConfigV8`
    || !Object.hasOwn(output.owner, 'Shared')) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} type or shared owner is invalid.`);
  }
  exactFields(output.fields, PROTOCOL_CONFIG_MOVE_FIELDS, `${label}.fields`);
  const fields = output.fields;
  if (moveObjectId(fields.id, `${label}.fields.id`) !== output.reference.objectId
    || moveDecimal(fields.version, `${label}.fields.version`) !== '8'
    || moveObjectId(fields.core_original_package_id, `${label}.fields.core_original_package_id`) !== corePackageId
    || moveObjectId(fields.core_callable_package_id, `${label}.fields.core_callable_package_id`) !== corePackageId
    || moveDecimal(fields.revision, `${label}.fields.revision`) !== revision
    || moveOptionId(fields.treasury_id, `${label}.fields.treasury_id`) !== treasuryId
    || fields.payment_coin_type !== MAINNET_V8_PAYMENT_COIN_TYPE
    || moveDecimal(fields.primary_content_fee_bps, `${label}.fields.primary_content_fee_bps`) !== '1000'
    || moveDecimal(fields.fixed_complete_fee_atomic, `${label}.fields.fixed_complete_fee_atomic`) !== '0'
    || moveDecimal(fields.maker_market_fee_bps, `${label}.fields.maker_market_fee_bps`) !== '250'
    || moveDecimal(fields.soul_market_fee_bps, `${label}.fields.soul_market_fee_bps`) !== '250'
    || fields.enabled !== enabled) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} fields differ from the exact protocol state.`);
  }
  const expectedCommitment = deriveProtocolConfigCommitment({
    configId: output.reference.objectId,
    corePackageId,
    revision,
    treasuryId,
    enabled,
  });
  if (moveHash(fields.commitment, `${label}.fields.commitment`) !== expectedCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} commitment is not derived from exact fields.`);
  }
  const parsed = parseExactMoveContent(output, PROTOCOL_CONFIG_BCS, label);
  if (parsed.id !== output.reference.objectId
    || String(parsed.version) !== '8'
    || parsed.core_original_package_id !== corePackageId
    || parsed.core_callable_package_id !== corePackageId
    || String(parsed.revision) !== revision
    || parsed.treasury_id !== treasuryId
    || parsed.payment_coin_type !== MAINNET_V8_PAYMENT_COIN_TYPE
    || parsed.primary_content_fee_bps !== 1000
    || String(parsed.fixed_complete_fee_atomic) !== '0'
    || parsed.maker_market_fee_bps !== 250
    || parsed.soul_market_fee_bps !== 250
    || parsed.enabled !== enabled
    || Buffer.from(parsed.commitment).toString('hex') !== expectedCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return output;
}

function assertUpgradeCapOutput(output, packageId, transactionDigest, signer, label) {
  assertMoveOutput(output, label, transactionDigest);
  const framework = normalizeMainnetV8ObjectId('0x2');
  if (output.type !== `${framework}::package::UpgradeCap`
    || !Object.hasOwn(output.owner, 'AddressOwner')
    || signer !== null && output.owner.AddressOwner !== signer) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} type or signer owner is invalid.`);
  }
  exactFields(output.fields, UPGRADE_CAP_MOVE_FIELDS, `${label}.fields`);
  if (moveObjectId(output.fields.id, `${label}.fields.id`) !== output.reference.objectId
    || moveObjectId(output.fields.package, `${label}.fields.package`) !== packageId
    || moveDecimal(output.fields.policy, `${label}.fields.policy`) !== '0'
    || moveDecimal(output.fields.version, `${label}.fields.version`) !== '1') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} does not bind a fresh compatible package.`);
  }
  const parsed = parseExactMoveContent(output, UPGRADE_CAP_BCS, label);
  if (parsed.id !== output.reference.objectId || parsed.package !== packageId
    || String(parsed.version) !== '1' || parsed.policy !== 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return output;
}

function assertProtocolAdminOutput(output, corePackageId, configId, transactionDigest, signer, label) {
  assertMoveOutput(output, label, transactionDigest);
  if (output.type !== `${corePackageId}::protocol_config_v8::ProtocolAdminCapV8`
    || !Object.hasOwn(output.owner, 'AddressOwner')
    || signer !== null && output.owner.AddressOwner !== signer) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} type or signer owner is invalid.`);
  }
  exactFields(output.fields, PROTOCOL_ADMIN_MOVE_FIELDS, `${label}.fields`);
  if (moveObjectId(output.fields.id, `${label}.fields.id`) !== output.reference.objectId
    || moveDecimal(output.fields.version, `${label}.fields.version`) !== '8'
    || moveObjectId(output.fields.config_id, `${label}.fields.config_id`) !== configId) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} differs from its protocol config binding.`);
  }
  const parsed = parseExactMoveContent(output, PROTOCOL_ADMIN_CAP_BCS, label);
  if (parsed.id !== output.reference.objectId || String(parsed.version) !== '8'
    || parsed.config_id !== configId) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return output;
}


// This bounded identity reader follows Move binary-format's header/table layout,
// not a byte-pattern search. It does not replace the chain's bytecode verifier.
// MovePackage::original_package_id uses the module self handle for upgrades.
export function readMainnetV8MoveModuleIdentity(bytes) {
  const invalid = () => fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', 'Invalid dependency Move module identity.');
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > 16 * 1024 * 1024
    || ![0xa1, 0x1c, 0xeb, 0x0b].every((value, index) => bytes[index] === value)) invalid();
  const rawVersion = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const version = rawVersion & 0x00ffffff;
  if (version < 1 || version > 7 || (version < 7 ? rawVersion !== version : rawVersion >>> 24 !== 5)) invalid();
  let offset = 8;
  const uint = (maximum, end = bytes.length) => {
    let value = 0, shift = 0;
    for (let count = 0; count < 5; count += 1) {
      if (offset >= end) return invalid();
      const byte = bytes[offset++]; value += (byte & 0x7f) * (2 ** shift);
      if (value > maximum) return invalid();
      if (!(byte & 0x80)) {
        if (count > 0 && byte === 0) return invalid();
        return value;
      }
      shift += 7;
    }
    return invalid();
  };
  const count = uint(255), tables = [];
  const kinds = new Set();
  for (let index = 0; index < count; index += 1) {
    if (offset >= bytes.length) invalid();
    const kind = bytes[offset++], start = uint(0xffffffff), size = uint(0xffffffff);
    if (![1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].includes(kind)
      || kinds.has(kind) || size === 0) invalid();
    kinds.add(kind); tables.push({ kind, start, size });
  }
  const dataStart = offset;
  let total = 0;
  for (const table of tables.sort((a, b) => a.start - b.start)) {
    if (table.start !== total) invalid();
    total += table.size;
    if (dataStart + total >= bytes.length) invalid();
  }
  offset = dataStart + total;
  const self = uint(65535);
  if (offset !== bytes.length) invalid();
  const handles = tables.find(row => row.kind === 1), names = tables.find(row => row.kind === 7);
  const addresses = tables.find(row => row.kind === 8);
  if (!handles || !names || !addresses || addresses.size % 32 !== 0) invalid();
  offset = dataStart + handles.start;
  const handleRows = [], handleEnd = offset + handles.size;
  while (offset < handleEnd) handleRows.push([uint(65535, handleEnd), uint(65535, handleEnd)]);
  const handle = handleRows[self];
  if (!handle || handle[0] >= addresses.size / 32) invalid();
  offset = dataStart + names.start;
  const nameRows = [], nameEnd = offset + names.size;
  while (offset < nameEnd) {
    const size = uint(65535, nameEnd);
    if (offset + size > nameEnd || size === 0) invalid();
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + size)); }
    catch { invalid(); }
    if (!MODULE_NAME.test(name)) invalid();
    nameRows.push(name); offset += size;
  }
  if (!nameRows[handle[1]]) invalid();
  const start = dataStart + addresses.start + handle[0] * 32;
  return Object.freeze({ originalId: `0x${Buffer.from(bytes.subarray(start, start + 32)).toString('hex')}`, moduleName: nameRows[handle[1]] });
}

function exactPackageObject(evidence, label) {
  exactFields(evidence, ['reference', 'objectBcsBase64'], label);
  exactFields(evidence.reference, ['objectId', 'version', 'digest'], `${label}.reference`);
  const ref = evidence.reference;
  assertFullId(ref.objectId, `${label}.objectId`);
  assertMainnetV8Decimal(ref.version, `${label}.version`, { positive: true });
  assertSuiDigest(ref.digest, `${label}.digest`);
  const bytes = decodeCanonicalBase64(evidence.objectBcsBase64, `${label}.objectBcsBase64`);
  if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${label} exceeds package evidence bounds.`);
  }
  let object;
  try { object = bcs.Object.parse(bytes); }
  catch { fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${label} has invalid Object BCS.`); }
  if (!Buffer.from(bcs.Object.serialize(object).toBytes()).equals(Buffer.from(bytes))
    || mainnetV8TypedDigest('Object', bytes) !== ref.digest || object.owner.$kind !== 'Immutable'
    || object.data.$kind !== 'Package' || object.data.Package.id !== ref.objectId
    || String(object.data.Package.version) !== ref.version) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${label} Object BCS differs from its immutable exact reference.`);
  }
  const pkg = object.data.Package;
  if (!(pkg.moduleMap instanceof Map) || pkg.moduleMap.size === 0 || pkg.moduleMap.size > 4096) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${label} has no bounded module inventory.`);
  }
  // BCS map ordering is lexicographic over serialized key bytes (including a
  // string's ULEB length prefix), not JS string order. The exact reserialization
  // above uses the SDK's canonical map serializer and rejects wrong wire order.
  return { object, pkg, bytes };
}

/** The dependency target IDs come from the frozen publish bytes. Historical
 * immutable Objects establish their original addresses and exact versions;
 * neither caller-supplied original IDs nor a latest-package lookup is authority. */
export function assertMainnetV8PackageDependencyLinkage({ dependencies, linkage, dependencyPackages }) {
  const invalid = () => fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', 'Package linkage differs from frozen dependency evidence.');
  if (!Array.isArray(dependencies) || dependencies.length > 4096 || !Array.isArray(linkage)
    || !Array.isArray(dependencyPackages) || linkage.length !== dependencies.length
    || dependencyPackages.length !== dependencies.length) invalid();
  dependencies.forEach(id => assertFullId(id, 'frozen dependency target'));
  if (new Set(dependencies).size !== dependencies.length) invalid();
  const expected = [];
  let previousTarget = null;
  for (const [index, evidence] of dependencyPackages.entries()) {
    const { pkg } = exactPackageObject(evidence, `dependencyPackages[${index}]`);
    if (previousTarget !== null && compareMainnetV8Text(previousTarget, pkg.id) >= 0) invalid();
    previousTarget = pkg.id;
    const identities = [...pkg.moduleMap].map(([name, bytes]) => {
      const identity = readMainnetV8MoveModuleIdentity(bytes);
      if (identity.moduleName !== name) invalid();
      return identity.originalId;
    });
    const originalId = String(pkg.version) === '1' ? pkg.id : identities[0];
    assertFullId(originalId, 'dependency originalId');
    if (identities.some(id => id !== originalId)) invalid();
    expected.push({ originalId, upgradedId: pkg.id, upgradedVersion: String(pkg.version) });
  }
  if (canonicalMainnetV8Json(dependencyPackages.map(row => row.reference.objectId))
    !== canonicalMainnetV8Json([...dependencies].sort(compareMainnetV8Text))) invalid();
  expected.sort((a, b) => compareMainnetV8Text(a.originalId, b.originalId));
  if (new Set(expected.map(row => row.originalId)).size !== expected.length) invalid();
  linkage.forEach((row, index) => exactFields(row, PACKAGE_LINKAGE_FIELDS, `linkage[${index}]`));
  if (canonicalMainnetV8Json(linkage) !== canonicalMainnetV8Json(expected)) invalid();
  return Object.freeze(expected.map(row => Object.freeze(row)));
}

export function assertMainnetV8PackageReadbackBcs(packageCertificate, dependencies, modules) {
  const ref = packageCertificate.reference;
  const { object, pkg, bytes } = exactPackageObject({
    reference: { objectId: ref.objectId, version: ref.version, digest: ref.digest },
    objectBcsBase64: packageCertificate.objectBcsBase64,
  }, 'published package');
  const origins = [...pkg.typeOriginTable].sort((a, b) => compareMainnetV8Text(canonicalMainnetV8Json(a), canonicalMainnetV8Json(b)));
  const links = [...pkg.linkageTable].sort(([a], [b]) => compareMainnetV8Text(a, b)).map(([originalId, row]) => ({
    originalId, upgradedId: row.upgradedId, upgradedVersion: String(row.upgradedVersion),
  }));
  if (sha256MainnetV8Bytes(bytes) !== packageCertificate.objectBcsSha256
    || object.previousTransaction !== packageCertificate.transactionDigest
    || packageCertificate.descriptor?.storageId !== pkg.id
    || packageCertificate.descriptor?.originalId !== pkg.id
    || packageCertificate.descriptor?.version !== String(pkg.version)
    || canonicalMainnetV8Json(origins) !== canonicalMainnetV8Json(packageCertificate.typeOrigins)
    || canonicalMainnetV8Json(links) !== canonicalMainnetV8Json(packageCertificate.linkage)) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', 'Published package full Object BCS differs from its certificate tables/hash.');
  }
  assertMainnetV8PackageDependencyLinkage({ dependencies, linkage: links, dependencyPackages: packageCertificate.dependencyPackages });
  if (!Array.isArray(modules) || modules.length === 0
    || new Set(modules.map(row => row.name)).size !== modules.length
    || canonicalMainnetV8Json([...pkg.moduleMap.keys()].sort(compareMainnetV8Text))
      !== canonicalMainnetV8Json(modules.map(row => row.name).sort(compareMainnetV8Text))) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Historical module set differs from frozen build.');
  }
  for (const module of modules) {
    assertMainnetV8PublishedModuleBytes({ role: packageCertificate.role, moduleName: module.name, packageId: ref.objectId,
      sourceBase64: module.bytesBase64, publishedBase64: Buffer.from(pkg.moduleMap.get(module.name)).toString('base64') });
  }
  return pkg;
}

function assertPackageDescriptorTables(packageCertificate, details, role, label) {
  const packageId = packageCertificate.reference.objectId;
  let priorOrigin = null;
  const originKeys = new Set();
  packageCertificate.typeOrigins.forEach((entry, index) => {
    exactFields(entry, PACKAGE_TYPE_ORIGIN_FIELDS, `${label}.typeOrigins[${index}]`);
    if (!MODULE_NAME.test(entry.moduleName) || !MODULE_NAME.test(entry.datatypeName)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.typeOrigins[${index}] names are invalid.`);
    }
    assertFullId(entry.package, `${label}.typeOrigins[${index}].package`);
    const key = canonicalMainnetV8Json(entry);
    if (originKeys.has(key) || priorOrigin !== null && compareMainnetV8Text(priorOrigin, key) >= 0) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.typeOrigins are not strictly canonical-sorted and unique.`);
    }
    originKeys.add(key);
    priorOrigin = key;
  });
  const expectedOrigins = packageCertificate.abiArtifact.modules.flatMap((module) => (
    module.datatypes.map((datatype) => {
      if (!Object.hasOwn(datatype, 'definingId')) {
        fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} ABI datatype omits its defining package ID.`);
      }
      return {
        moduleName: module.name,
        datatypeName: datatype.name,
        package: normalizeMainnetV8ObjectId(
          datatype.definingId, `${label}.${module.name}.${datatype.name}.definingId`,
        ),
      };
    })
  )).sort((left, right) => compareMainnetV8Text(
    canonicalMainnetV8Json(left), canonicalMainnetV8Json(right),
  ));
  if (expectedOrigins.some((entry) => entry.package !== packageId)
    || canonicalMainnetV8Json(packageCertificate.typeOrigins)
      !== canonicalMainnetV8Json(expectedOrigins)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.typeOrigins differ from exact fresh-package ABI definitions.`);
  }

  let priorLink = null;
  const observedDependencies = [];
  packageCertificate.linkage.forEach((entry, index) => {
    exactFields(entry, PACKAGE_LINKAGE_FIELDS, `${label}.linkage[${index}]`);
    assertFullId(entry.originalId, `${label}.linkage[${index}].originalId`);
    assertFullId(entry.upgradedId, `${label}.linkage[${index}].upgradedId`);
    assertMainnetV8Decimal(
      entry.upgradedVersion, `${label}.linkage[${index}].upgradedVersion`, { positive: true },
    );
    if (priorLink !== null
      && compareMainnetV8Text(priorLink, entry.originalId) >= 0) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.linkage is duplicated or unsorted.`);
    }
    priorLink = entry.originalId;
    observedDependencies.push(entry.upgradedId);
  });
  if (canonicalMainnetV8Json(observedDependencies.sort(compareMainnetV8Text))
    !== canonicalMainnetV8Json([...details.packageArtifact.dependencies].sort(compareMainnetV8Text))) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.linkage differs from frozen package dependencies.`);
  }
  const moduleNames = packageCertificate.abiArtifact.modules.map(({ name }) => name);
  const packageModuleNames = details.packageArtifact.modules.map(({ name }) => name);
  if (canonicalMainnetV8Json(moduleNames) !== canonicalMainnetV8Json(packageModuleNames)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} ABI module set differs from frozen package bytes.`);
  }
  if (packageCertificate.abiArtifact.role !== role) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} ABI role differs from package role.`);
  }
}

/** Origins are read from the exact linked immutable dependency Object BCS,
 * including Config's own origin. This helper never reads a latest descriptor. */
export function deriveMainnetV8SoulidityKioskOrigins(packageCertificate) {
  const expected = NATIVE_SOUL_KIOSK_DEPENDENCY;
  const links = packageCertificate.linkage;
  if (!Array.isArray(links)) fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', 'Soulidity linkage is missing.');
  assertMainnetV8PackageDependencyLinkage({ dependencies: links.map(row => row.upgradedId),
    linkage: links, dependencyPackages: packageCertificate.dependencyPackages });
  const matches = links.filter(row => row.originalId === expected.original || row.upgradedId === expected.callable);
  if (matches.length !== 1 || matches[0].originalId !== expected.original || matches[0].upgradedId !== expected.callable) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', 'Soulidity must link the exact approved Kiosk original/callable pair.');
  }
  const evidence = packageCertificate.dependencyPackages.filter(row => row.reference.objectId === expected.callable);
  if (evidence.length !== 1 || evidence[0].reference.version !== matches[0].upgradedVersion) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', 'Exact historical Kiosk dependency is missing.');
  }
  const { pkg } = exactPackageObject(evidence[0], 'Soulidity Kiosk dependency');
  return Object.freeze(Object.fromEntries([
    ['kioskLockRule', 'kiosk_lock_rule', 'Rule'], ['kioskLockConfig', 'kiosk_lock_rule', 'Config'],
    ['personalKioskRule', 'personal_kiosk_rule', 'Rule'], ['witnessRule', 'witness_rule', 'Rule'],
  ].map(([key, moduleName, datatypeName]) => {
    const rows = pkg.typeOriginTable.filter(row => row.moduleName === moduleName && row.datatypeName === datatypeName);
    if (!pkg.moduleMap.has(moduleName) || rows.length !== 1) {
      fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `Exact Kiosk ${moduleName}::${datatypeName} origin is missing or ambiguous.`);
    }
    return [key, assertFullId(rows[0].package, `Kiosk ${key} origin`)];
  })));
}

// Shared by live certification and cold evidence replay. A derived export map
// is never trusted from stored JSON: replay recomputes it from all Object BCS.
export function certifyMainnetV8SoulidityInitialization({ packageCertificate, writes, moveOutputs, signer, transactionDigest }) {
  assertFullId(signer, 'Soulidity publication signer');
  if (packageCertificate.role !== 'soulidity' || packageCertificate.transactionDigest !== transactionDigest
    || !Array.isArray(moveOutputs) || moveOutputs.some(output => output.previousTransaction !== transactionDigest)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Soulidity init outputs must belong to this exact finalized publication.');
  }
  return verifyNativeSoulPublicationOutputs({ packageId: packageCertificate.reference.objectId, signer,
    kioskTypeOrigins: deriveMainnetV8SoulidityKioskOrigins(packageCertificate), created: writes, moveOutputs });
}

/** Narrow cold publication validator, not the still-blocked full WAL pipeline. */
export function assertPackagePublishCertificate(readback, ordinal, finalityEvidence, details, signer = null) {
  // The enclosing WAL proves checkpoint finality. This narrow entry still
  // binds canonical effects to the exact successful transaction it replays.
  const effectsBytes = decodeCanonicalBase64(finalityEvidence.effectsBcsBase64, 'publication effects');
  const effects = bcs.TransactionEffects.parse(effectsBytes);
  const effectValue = effects.V1 ?? effects.V2;
  if (!sameBytes(bcs.TransactionEffects.serialize(effects).toBytes(), effectsBytes)
    || effectValue?.transactionDigest !== finalityEvidence.digest || effectValue.status?.$kind !== 'Success') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Publication effects do not bind one exact successful transaction.');
  }
  const index = Number(BigInt(ordinal));
  const role = MAINNET_V8_PUBLISH_ORDER[index];
  const label = `${role} package publish readback`;
  exactFields(readback, PACKAGE_PUBLISH_CERTIFICATE_FIELDS, label);
  if (readback.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA
    || readback.kind !== 'PACKAGE_PUBLISH_CERTIFICATE' || readback.role !== role
    || readback.transactionDigest !== finalityEvidence.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} identity differs from its ordinal/finality.`);
  }
  exactFields(readback.package, PACKAGE_READBACK_FIELDS, `${label}.package`);
  const packageCertificate = readback.package;
  if (packageCertificate.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA
    || packageCertificate.role !== role
    || packageCertificate.transactionDigest !== finalityEvidence.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.package identity is invalid.`);
  }
  assertEffectReference(packageCertificate.reference, `${label}.package.reference`);
  if (packageCertificate.reference.operation !== 'CREATED'
    || packageCertificate.reference.owner.kind !== 'Immutable'
    || packageCertificate.reference.version !== '1') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not one fresh immutable package.`);
  }
  assertHash(packageCertificate.moduleMapSha256, `${label}.package.moduleMapSha256`);
  assertHash(packageCertificate.objectBcsSha256, `${label}.package.objectBcsSha256`);
  if (!Array.isArray(packageCertificate.typeOrigins) || !Array.isArray(packageCertificate.linkage)
    || !isPlain(packageCertificate.descriptor)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.package descriptor tables are invalid.`);
  }
  assertMainnetV8DeterministicJson(packageCertificate.typeOrigins, `${label}.package.typeOrigins`);
  assertMainnetV8DeterministicJson(packageCertificate.linkage, `${label}.package.linkage`);
  assertMainnetV8DeterministicJson(packageCertificate.descriptor, `${label}.package.descriptor`);
  assertMainnetV8AbiArtifact(packageCertificate.abiArtifact);
  const rebuiltAbi = buildMainnetV8AbiArtifact({ role, descriptor: packageCertificate.descriptor });
  if (canonicalMainnetV8Json(rebuiltAbi) !== canonicalMainnetV8Json(packageCertificate.abiArtifact)
    || canonicalMainnetV8Json(packageCertificate.abiArtifact) !== canonicalMainnetV8Json(details.abiArtifact)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} ABI differs from its descriptor/finalized commitment.`);
  }
  assertPackageDescriptorTables(packageCertificate, details, role, `${label}.package`);
  assertMainnetV8PackageReadbackBcs(packageCertificate, details.packageArtifact.dependencies, details.packageArtifact.modules);
  const moduleMap = Object.fromEntries(details.packageArtifact.modules.map((module) => [
    module.name, module.bytesBase64,
  ]));
  if (packageCertificate.moduleMapSha256 !== sha256MainnetV8Json(moduleMap)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} module-map hash differs from frozen package bytes.`);
  }
  const writes = finalityWrites(finalityEvidence);
  const expectedCount = role === 'soulidity' ? 33 : role === 'core' ? 4 : 2;
  if (writes.length !== expectedCount || writes.some((entry) => entry.operation !== 'CREATED')) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} TransactionEffects write set is not exact.`);
  }
  const packageWrite = writes.find((entry) => entry.objectId === packageCertificate.reference.objectId);
  if (!packageWrite
    || canonicalMainnetV8Json(packageWrite) !== canonicalMainnetV8Json(packageCertificate.reference)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.package.reference differs from TransactionEffects.`);
  }
  assertUpgradeCapOutput(
    readback.upgradeCap, packageCertificate.reference.objectId,
    finalityEvidence.digest, signer, `${label}.upgradeCap`,
  );
  findWrite(writes, readback.upgradeCap, 'CREATED', `${label}.upgradeCap`);
  if (role === 'core') {
    assertProtocolConfigOutput(readback.protocolConfig, {
      corePackageId: packageCertificate.reference.objectId,
      transactionDigest: finalityEvidence.digest,
      enabled: false,
      revision: '0',
      treasuryId: null,
    }, `${label}.protocolConfig`);
    findWrite(writes, readback.protocolConfig, 'CREATED', `${label}.protocolConfig`);
    assertProtocolAdminOutput(
      readback.protocolAdminCap, packageCertificate.reference.objectId,
      readback.protocolConfig.reference.objectId, finalityEvidence.digest, signer,
      `${label}.protocolAdminCap`,
    );
    findWrite(writes, readback.protocolAdminCap, 'CREATED', `${label}.protocolAdminCap`);
  } else if (readback.protocolConfig !== null || readback.protocolAdminCap !== null) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} cannot claim Core-only outputs.`);
  }
  if (role === 'soulidity') {
    if (!isPlain(readback.soulidityInitialization?.objects)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} lacks exact fresh initialization evidence.`);
    }
    const expected = certifyMainnetV8SoulidityInitialization({ packageCertificate, writes,
      moveOutputs: Object.values(readback.soulidityInitialization.objects), signer, transactionDigest: finalityEvidence.digest });
    if (canonicalMainnetV8Json(expected) !== canonicalMainnetV8Json(readback.soulidityInitialization)
      || canonicalMainnetV8Json(expected.objects.upgradeCap) !== canonicalMainnetV8Json(readback.upgradeCap)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} stored init/export map differs from canonical BCS.`);
    }
  } else if (readback.soulidityInitialization !== null) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} cannot claim Soulidity initialization outputs.`);
  }
  const outputIds = [
    packageCertificate.reference.objectId,
    readback.upgradeCap.reference.objectId,
    ...(role === 'core' ? [
      readback.protocolConfig.reference.objectId, readback.protocolAdminCap.reference.objectId,
    ] : []),
    ...(role === 'soulidity' ? Object.values(readback.soulidityInitialization.objects)
      .filter(output => output.reference.objectId !== readback.upgradeCap.reference.objectId)
      .map(output => output.reference.objectId) : []),
  ];
  if (new Set(outputIds).size !== expectedCount
    || new Set(writes.map(({ objectId }) => objectId)).size !== expectedCount) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} output identities collide.`);
  }
  return readback;
}

function deriveProtocolConfigCommitment({
  configId, corePackageId, revision, treasuryId, enabled,
}) {
  return deriveMakerV8ProtocolConfigCommitment({ configId, coreOriginalPackageId: corePackageId,
    coreCallablePackageId: corePackageId, revision, treasuryId, enabled,
    paymentCoinType: MAINNET_V8_PAYMENT_COIN_TYPE, primaryContentFeeBps: 1000,
    fixedCompleteFeeAtomic: '0', makerMarketFeeBps: 250, soulMarketFeeBps: 250 });
}


/** Cold data validation only: finality and READY/predecessor WAL linkage remain
 * the responsibility of the enclosing certificate/context validators. */
export function assertMainnetV8NativeBootstrapReadback(readback, stage, finalityEvidence, signer) {
  exactFields(readback, ['schema', 'stage', 'input', 'objects', 'priorObjects', 'consensusObjects'],
    'Native bootstrap history readback');
  if (readback.schema !== 'native-soul-bootstrap-history-v1'
    || readback.stage !== stage || !NATIVE_BOOTSTRAP_STAGE_KINDS.includes(stage)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Native bootstrap history stage/schema mismatch.');
  }
  assertMainnetV8DeterministicJson(readback, 'Native bootstrap history readback');
  assertFullId(signer, 'Native bootstrap transaction sender');
  const proof = validateNativeSoulBootstrapHistory({ stage, input: readback.input, sender: signer,
    transactionBytes: decodeCanonicalBase64(finalityEvidence.transactionBase64, 'Native bootstrap transaction bytes'),
    effectsBytes: decodeCanonicalBase64(finalityEvidence.effectsBcsBase64, 'Native bootstrap effects bytes'),
    objects: readback.objects, priorObjects: readback.priorObjects, consensusObjects: readback.consensusObjects });
  const fields = proof.objects.protocol.fields;
  const commitment = deriveProtocolConfigCommitment({ configId: fields.id,
    corePackageId: fields.core_callable_package_id, revision: fields.revision,
    treasuryId: fields.treasury_id, enabled: fields.enabled });
  if (moveHash(fields.commitment, 'Native bootstrap protocol commitment') !== commitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Native bootstrap protocol commitment differs from its exact state.');
  }
  if (proof.objects.catalog) assertMakerV8CatalogCommitments(proof.objects.catalog.fields);
  if (proof.objects.sealConfig) assertMakerV8SealPolicyCommitments(proof.objects.sealConfig.fields);
  assertNativeSoulBootstrapEvents({ stage, input: readback.input, sender: signer,
    finalityEvidence, objects: proof.objects });
  return readback;
}

function assertStageReadback(readback, ordinal, finalityEvidence, details, signer = null) {
  const kind = readyStageKind(ordinal);
  if (kind === 'PUBLISH') {
    return assertPackagePublishCertificate(readback, ordinal, finalityEvidence, details, signer);
  }
  if (NATIVE_BOOTSTRAP_STAGE_KINDS.includes(kind)) {
    return assertMainnetV8NativeBootstrapReadback(readback, kind, finalityEvidence, signer);
  }
  if (kind === 'ACTIVATE_SOULIDITY_MARKET') {
    exactFields(readback, ['schema', 'stage', 'input', 'priorObjects', 'objects'], 'Market activation history');
    if (readback.schema !== 'native-soul-market-activation-history-v1' || readback.stage !== kind) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Market activation readback schema/stage mismatch.');
    }
    validateNativeSoulMarketActivationHistory({ input: readback.input, sender: signer,
      transactionBytes: decodeCanonicalBase64(finalityEvidence.transactionBase64, 'Market activation transaction bytes'),
      effectsBytes: decodeCanonicalBase64(finalityEvidence.effectsBcsBase64, 'Market activation effects bytes'),
      priorObjects: readback.priorObjects, objects: readback.objects });
    return readback;
  }
  fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Ordinal ${ordinal} has no transaction readback certificate.`);
}

function assertFinalityCertificate(certificate, expectedSuccess, label, ordinal, details) {
  exactFields(certificate, FINALITY_CERTIFICATE_FIELDS, label);
  assertFinalityEvidence(certificate.finalityEvidence, expectedSuccess, `${label}.finalityEvidence`);
  assertHash(certificate.finalityEvidenceSha256, `${label}.finalityEvidenceSha256`);
  if (certificate.finalityEvidenceSha256 !== sha256MainnetV8Json(certificate.finalityEvidence)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} finality evidence hash is invalid.`);
  }
  if (expectedSuccess) {
    if (!isPlain(certificate.readback) || Object.keys(certificate.readback).length === 0) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.readback must be a non-empty certified record.`);
    }
    assertMainnetV8DeterministicJson(certificate.readback, `${label}.readback`);
    assertHash(certificate.readbackSha256, `${label}.readbackSha256`);
    if (certificate.readbackSha256 !== sha256MainnetV8Json(certificate.readback)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} readback hash is invalid.`);
    }
    const transactionBytes = decodeCanonicalBase64(certificate.finalityEvidence.transactionBase64, `${label}.transactionBase64`);
    const transaction = bcs.TransactionData.parse(transactionBytes);
    if (transaction.$kind !== 'V1' || !sameBytes(bcs.TransactionData.serialize(transaction).toBytes(), transactionBytes)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} transaction sender has no canonical TransactionData.`);
    }
    // assertFinalityEvidence above binds these exact transaction bytes/digest.
    // Never recover signer authority from an output's claimed owner.
    assertStageReadback(certificate.readback, ordinal, certificate.finalityEvidence, details,
      assertFullId(transaction.V1.sender, `${label}.transaction sender`));
  } else if (certificate.readback !== null || certificate.readbackSha256 !== null) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} failure cannot claim successful readback.`);
  }
  return certificate;
}

export function assertMainnetV8FinalPackageVerification(value, label = 'Final package verification') {
  exactFields(value, FINAL_PACKAGE_VERIFICATION_FIELDS, label);
  if (value.kind !== 'FINAL_PACKAGE_REBUILD_VERIFICATION') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.kind is invalid.`);
  }
  assertHash(value.executionPlanId, `${label}.executionPlanId`);
  assertHash(value.releaseId, `${label}.releaseId`);
  if (!Array.isArray(value.packages) || value.packages.length !== MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.packages must contain exactly eight publications.`);
  }
  const ids = new Set();
  value.packages.forEach((entry, index) => {
    exactFields(entry, FINAL_PACKAGE_VERIFICATION_ROW_FIELDS, `${label}.packages[${index}]`);
    if (entry.role !== MAINNET_V8_PUBLISH_ORDER[index]) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.packages[${index}].role is invalid.`);
    }
    assertFullId(entry.packageId, `${label}.packages[${index}].packageId`);
    if (ids.has(entry.packageId)) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} repeats a published package ID.`);
    ids.add(entry.packageId);
    assertSuiDigest(entry.packageDigest, `${label}.packages[${index}].packageDigest`);
    assertMainnetV8Decimal(
      entry.packageVersion,
      `${label}.packages[${index}].packageVersion`,
      { positive: true },
    );
    if (entry.packageVersion !== '1') {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.packages[${index}] is not fresh version 1.`);
    }
    assertSuiDigest(entry.publishDigest, `${label}.packages[${index}].publishDigest`);
    for (const field of [
      'sourceCommitment', 'packageCommitment', 'abiCommitment',
      'moduleMapSha256', 'objectBcsSha256', 'readbackSha256',
    ]) assertHash(entry[field], `${label}.packages[${index}].${field}`);
  });
  return value;
}

const assertFinalPackageVerification = assertMainnetV8FinalPackageVerification;

function assertVerifyCertificate(certificate, label) {
  exactFields(certificate, VERIFY_CERTIFICATE_FIELDS, label);
  exactFields(certificate.verification, VERIFY_RECORD_FIELDS, `${label}.verification`);
  if (certificate.verification.kind !== 'VERIFY_AND_EXPORT') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.verification kind is invalid.`);
  }
  assertHash(certificate.verification.executionPlanId, `${label}.verification.executionPlanId`);
  assertHash(certificate.verification.releaseId, `${label}.verification.releaseId`);
  assertHash(certificate.verification.finalManifestSha256, `${label}.verification.finalManifestSha256`);
  assertFinalPackageVerification(
    certificate.verification.packageVerification,
    `${label}.verification.packageVerification`,
  );
  assertHash(
    certificate.verification.packageVerificationSha256,
    `${label}.verification.packageVerificationSha256`,
  );
  if (certificate.verification.packageVerificationSha256
    !== sha256MainnetV8Json(certificate.verification.packageVerification)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.verification package verification hash is invalid.`);
  }
  assertHash(certificate.verification.runtimeAttestationSha256, `${label}.verification.runtimeAttestationSha256`);
  assertHash(certificate.verification.marketActivationCertificateSha256, `${label}.verification.marketActivationCertificateSha256`);
  exactFields(certificate.exports, VERIFY_EXPORT_FIELDS, `${label}.exports`);
  boundedText(certificate.exports.filename, `${label}.exports.filename`, 255);
  if (basename(certificate.exports.filename) !== certificate.exports.filename
    || certificate.exports.filename === '.' || certificate.exports.filename === '..') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.exports.filename must be a safe basename.`);
  }
  assertHash(certificate.exports.sha256, `${label}.exports.sha256`);
  if (certificate.exports.protectedDecryptionReady !== false) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} cannot claim unprovisioned protected decryption.`);
  }
  assertHashedRecord(certificate, 'verification', 'verificationSha256', label);
  assertHashedRecord(certificate, 'exports', 'exportsSha256', label);
  return certificate;
}

function assertFinalObservationDetails(details, status, ordinal) {
  const publish = readyStageKind(ordinal) === 'PUBLISH';
  if (status === 'FINALIZED_SUCCESS') {
    if (readyStageKind(ordinal) === 'VERIFY_AND_EXPORT') {
      exactFields(details, ['certificate', 'certificateSha256'], `${observationKind(status, ordinal)} details`);
      assertVerifyCertificate(details.certificate, 'VERIFY_AND_EXPORT certificate');
      assertHash(details.certificateSha256, 'VERIFY_AND_EXPORT certificateSha256');
      if (details.certificateSha256 !== sha256MainnetV8Json(details.certificate)) {
        fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT certificate hash is invalid.');
      }
      return;
    }
    exactFields(details, publish ? [
      'packageArtifact', 'packageCommitment', 'abiArtifact', 'abiCommitment',
      'certificate', 'certificateSha256',
    ] : ['certificate', 'certificateSha256'], `${observationKind(status, ordinal)} details`);
    assertFinalityCertificate(
      details.certificate, true, 'Finalized success certificate', ordinal, details,
    );
    assertHash(details.certificateSha256, 'Finalized success certificateSha256');
    if (details.certificateSha256 !== sha256MainnetV8Json(details.certificate)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Finalized success certificate hash is invalid.');
    }
    if (publish) assertMainnetV8PublishPackageEvidence(details, ordinal, { requireAbi: true });
    return;
  }
  if (status === 'FINALIZED_FAILURE') {
    exactFields(details, publish
      ? ['packageArtifact', 'packageCommitment', 'certificate', 'certificateSha256']
      : ['certificate', 'certificateSha256'], `${observationKind(status, ordinal)} details`);
    assertFinalityCertificate(
      details.certificate, false, 'Finalized failure certificate', ordinal, details,
    );
    assertHash(details.certificateSha256, 'Finalized failure certificateSha256');
    if (details.certificateSha256 !== sha256MainnetV8Json(details.certificate)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Finalized failure certificate hash is invalid.');
    }
    if (publish) assertMainnetV8PublishPackageEvidence(details, ordinal);
    return;
  }
  exactFields(details, ['expiration', 'expirationSha256'], `${observationKind(status, ordinal)} details`);
  assertExpirationCertificate(details.expiration);
  assertHash(details.expirationSha256, 'Expired not-found expirationSha256');
  if (details.expirationSha256 !== sha256MainnetV8Json(details.expiration)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Expired not-found certificate hash is invalid.');
  }
}

function assertObservationDetails(kind, details, status, ordinal) {
  if (kind === 'QUERY_INTENT') {
    exactFields(details, [], 'QUERY_INTENT details');
    return;
  }
  if (kind === 'BROADCAST_INTENT') {
    assertNotFoundBroadcastIntent(details);
    return;
  }
  if (status === 'BROADCAST_ACCEPTED') {
    exactFields(details, ['response', 'responseSha256'], 'BROADCAST_ACCEPTED details');
    assertBroadcastResponse(details.response);
    assertHash(details.responseSha256, 'Broadcast accepted responseSha256');
    if (details.responseSha256 !== sha256MainnetV8Json(details.response)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Broadcast accepted response hash is invalid.');
    }
    return;
  }
  if (status === 'OUTCOME_UNKNOWN') {
    exactFields(details, ['error', 'errorSha256'], 'OUTCOME_UNKNOWN details');
    assertRpcErrorRecord(details.error, 'Outcome unknown error');
    assertHash(details.errorSha256, 'Outcome unknown errorSha256');
    if (details.errorSha256 !== sha256MainnetV8Json(details.error)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome unknown error hash is invalid.');
    }
    return;
  }
  if (status === 'FINALIZED_SUCCESS_PENDING_READBACK') {
    exactFields(details, ['finalityEvidence', 'finalityEvidenceSha256'], 'Pending readback details');
    assertFinalityEvidence(details.finalityEvidence, true, 'Pending readback finalityEvidence');
    assertHash(details.finalityEvidenceSha256, 'Pending readback finalityEvidenceSha256');
    if (details.finalityEvidenceSha256 !== sha256MainnetV8Json(details.finalityEvidence)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Pending readback finality hash is invalid.');
    }
    return;
  }
  if (status === 'INCIDENT_STOPPED') {
    if (readyStageKind(ordinal) === 'VERIFY_AND_EXPORT') {
      exactFields(details, ['incident', 'incidentSha256'], 'VERIFY_AND_EXPORT incident details');
      assertVerifyIncidentRecord(details.incident);
      assertHash(details.incidentSha256, 'VERIFY_AND_EXPORT incidentSha256');
      if (details.incidentSha256 !== sha256MainnetV8Json(details.incident)) {
        fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT incident hash is invalid.');
      }
      return;
    }
    exactFields(details, [
      'finalityEvidence', 'finalityEvidenceSha256', 'incident', 'incidentSha256',
    ], 'Incident stopped details');
    assertFinalityEvidence(details.finalityEvidence, true, 'Incident stopped finalityEvidence');
    assertHash(details.finalityEvidenceSha256, 'Incident stopped finalityEvidenceSha256');
    if (details.finalityEvidenceSha256 !== sha256MainnetV8Json(details.finalityEvidence)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Incident stopped finality hash is invalid.');
    }
    assertIncidentRecord(details.incident, 'Incident stopped incident');
    assertHash(details.incidentSha256, 'Incident stopped incidentSha256');
    if (details.incidentSha256 !== sha256MainnetV8Json(details.incident)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Incident stopped incident hash is invalid.');
    }
    return;
  }
  if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(status)) {
    assertFinalObservationDetails(details, status, ordinal);
    return;
  }
  fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Unsupported observation kind ${kind}.`);
}

function normalizeObservationInput(status, ordinal, input) {
  if (status === 'OUTCOME_PENDING') {
    exactFields(input, ['kind', 'details'], 'OUTCOME_PENDING observation input');
    if (!['QUERY_INTENT', 'BROADCAST_INTENT'].includes(input.kind)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'OUTCOME_PENDING must record QUERY_INTENT or BROADCAST_INTENT.');
    }
    return input;
  }
  const expectedKind = observationKind(status, ordinal);
  if (isPlain(input) && Object.keys(input).length === 2
    && Object.hasOwn(input, 'kind') && Object.hasOwn(input, 'details')) {
    if (input.kind !== expectedKind) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome observation input kind differs from its status.');
    }
    return input;
  }
  return { kind: expectedKind, details: input };
}

function buildObservation(status, ordinal, input) {
  const { kind, details } = normalizeObservationInput(status, ordinal, input);
  if (!isPlain(details)) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome observation details must be a plain record.');
  assertMainnetV8DeterministicJson(details, 'Outcome observation details');
  assertNoSecretFields(details, 'Outcome observation details');
  assertObservationDetails(kind, details, status, ordinal);
  return {
    kind,
    details: cloneJson(details),
    detailsSha256: sha256MainnetV8Json(details),
  };
}

function assertObservation(observation, status, ordinal) {
  exactFields(observation, OBSERVATION_FIELDS, 'Outcome observation');
  const validKind = status === 'OUTCOME_PENDING'
    ? ['QUERY_INTENT', 'BROADCAST_INTENT'].includes(observation.kind)
    : observation.kind === observationKind(status, ordinal);
  if (!validKind || !isPlain(observation.details)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome observation kind or details are invalid.');
  }
  assertMainnetV8DeterministicJson(observation.details, 'Outcome observation details');
  assertNoSecretFields(observation.details, 'Outcome observation details');
  assertObservationDetails(observation.kind, observation.details, status, ordinal);
  assertHash(observation.detailsSha256, 'Outcome observation detailsSha256');
  if (observation.detailsSha256 !== sha256MainnetV8Json(observation.details)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome observation details hash is invalid.');
  }
  return observation;
}

export function buildMainnetV8ReadyEvidence({
  ordinal, attempt = '0', readyArtifact, unsignedEnvelope = null,
}) {
  const cursor = walCursor(ordinal, attempt);
  if (readyStageKind(cursor.ordinal) === 'VERIFY_AND_EXPORT') {
    if (unsignedEnvelope !== null) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT READY cannot carry transaction bytes.');
    }
  } else {
    assertMainnetV8UnsignedEnvelope(unsignedEnvelope);
  }
  assertReadyArtifact(readyArtifact, cursor.ordinal, unsignedEnvelope);
  const evidence = {
    schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
    kind: 'READY',
    cursor,
    readyArtifact: cloneJson(readyArtifact),
    readyArtifactSha256: sha256MainnetV8Json(readyArtifact),
    unsignedEnvelope: unsignedEnvelope === null ? null : cloneJson(unsignedEnvelope),
    transactionBindingSha256: computeMainnetV8TransactionBinding({
      ordinal: cursor.ordinal,
      attempt: cursor.attempt,
      readyArtifact,
      unsignedEnvelope,
    }),
  };
  return deepFreeze(evidence);
}

export function buildMainnetV8SignedEvidence({
  ordinal, attempt, readyArtifactSha256, signedArtifact,
}) {
  const cursor = walCursor(ordinal, attempt);
  assertHash(readyArtifactSha256, 'SIGNED readyArtifactSha256');
  assertMainnetV8SignedArtifact(signedArtifact);
  return deepFreeze({
    schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
    kind: 'SIGNED',
    cursor,
    readyArtifactSha256,
    signedArtifact: cloneJson(signedArtifact),
    signedArtifactSha256: sha256MainnetV8Json(signedArtifact),
  });
}

export function buildMainnetV8OutcomeEvidence({
  status, ordinal, attempt, readyArtifactSha256, signedArtifact, signedArtifactSha256,
  digest, observation,
}) {
  if (!MAINNET_V8_WAL_STATUSES.includes(status) || ['READY', 'SIGNED'].includes(status)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome evidence status is invalid.');
  }
  const cursor = walCursor(ordinal, attempt);
  assertHash(readyArtifactSha256, 'Outcome readyArtifactSha256');
  const observed = buildObservation(status, cursor.ordinal, observation);
  if (['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(status)
    && readyStageKind(cursor.ordinal) === 'VERIFY_AND_EXPORT') {
    if (signedArtifact !== undefined && signedArtifact !== null
      || signedArtifactSha256 !== undefined && signedArtifactSha256 !== null
      || digest !== undefined && digest !== null) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT terminal evidence cannot carry signing or broadcast bytes.');
    }
    return deepFreeze({
      schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
      kind: status,
      cursor,
      readyArtifactSha256,
      observation: observed,
      observationSha256: sha256MainnetV8Json(observed),
    });
  }
  assertMainnetV8SignedArtifact(signedArtifact);
  assertHash(signedArtifactSha256, 'Outcome signedArtifactSha256');
  assertSuiDigest(digest, 'Outcome digest');
  if (signedArtifactSha256 !== sha256MainnetV8Json(signedArtifact)
    || digest !== signedArtifact.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Outcome signed artifact hash or digest is invalid.');
  }
  return deepFreeze({
    schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
    kind: status,
    cursor,
    readyArtifactSha256,
    signedArtifact: cloneJson(signedArtifact),
    signedArtifactSha256,
    digest,
    observation: observed,
    observationSha256: sha256MainnetV8Json(observed),
  });
}

export function buildMainnetV8ManifestEvidence(input) {
  assertMainnetV8ReleasePlan(input.plan);
  return buildMainnetV8ManifestEvidenceContents(input);
}

/** Offline seal-event data, not authorization to seal or execute a release. */
export function buildMainnetV8ManifestEvidenceContents({
  ordinal = String(MAINNET_V8_PUBLISH_ORDER.length - 1), attempt = '0', finalManifest, plan,
}) {
  const cursor = walCursor(ordinal, attempt);
  if (cursor.ordinal !== String(MAINNET_V8_PUBLISH_ORDER.length - 1)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Final manifest can only be sealed after the last publication.');
  }
  assertMainnetV8ReleasePlanContents(plan);
  assertMainnetV8FinalManifestContents(finalManifest, plan);
  return deepFreeze({
    schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
    kind: 'FINAL_MANIFEST_SEALED',
    cursor,
    finalManifest: cloneJson(finalManifest),
    releaseId: finalManifest.releaseId,
  });
}

export function buildMainnetV8AbandonEvidence({
  ordinal = String(MAINNET_V8_PUBLISH_ORDER.length - 1), attempt = '0', finalManifest, plan, reason,
}) {
  const cursor = walCursor(ordinal, attempt);
  if (cursor.ordinal !== String(MAINNET_V8_PUBLISH_ORDER.length - 1)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'A sealed release can only be abandoned after the last publication.');
  }
  assertMainnetV8FinalManifest(finalManifest, plan);
  exactFields(reason, WAL_ABANDON_REASON_FIELDS, 'RELEASE_ABANDONED reason');
  exactFields(reason.moveAbort, WAL_ABANDON_MOVE_ABORT_FIELDS, 'RELEASE_ABANDONED moveAbort');
  if (reason.code !== 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH'
    || reason.failedOrdinal !== nativeStageOrdinal('INITIALIZE_PROTOCOL')
    || reason.errorCode !== 'MAINNET_V8_SIMULATION_FAILED'
    || reason.moveAbort.module !== 'protocol_config_v8'
    || reason.moveAbort.function !== 'initialize_protocol_treasury_v8'
    || reason.moveAbort.abortCode !== '3') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Release abandonment reason is not the approved pre-sign init incident.');
  }
  assertFullId(reason.moveAbort.packageId, 'RELEASE_ABANDONED moveAbort.packageId');
  const canonicalReason = cloneJson(reason);
  return deepFreeze({
    schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
    kind: 'RELEASE_ABANDONED',
    cursor,
    releaseId: finalManifest.releaseId,
    finalManifestSha256: sha256MainnetV8Json(finalManifest),
    reason: canonicalReason,
    reasonSha256: sha256MainnetV8Json(canonicalReason),
  });
}

export function assertWalEvidence(event) {
  const evidence = event.evidence;
  if (evidence.schemaVersion !== MAINNET_V8_WAL_EVIDENCE_SCHEMA || evidence.kind !== event.status) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'WAL evidence schema or kind differs from its status.');
  }
  if (event.status === 'READY') {
    exactFields(evidence, WAL_READY_EVIDENCE_FIELDS, 'READY evidence');
    assertEvidenceCursor(evidence.cursor, event, 'READY evidence');
    assertHash(evidence.readyArtifactSha256, 'READY readyArtifactSha256');
    assertHash(evidence.transactionBindingSha256, 'READY transactionBindingSha256');
    if (evidence.readyArtifactSha256 !== sha256MainnetV8Json(evidence.readyArtifact)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'READY artifact hash is invalid.');
    }
    if (readyStageKind(event.ordinal) === 'VERIFY_AND_EXPORT') {
      if (evidence.unsignedEnvelope !== null) {
        fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT READY cannot carry transaction bytes.');
      }
    } else {
      assertMainnetV8UnsignedEnvelope(evidence.unsignedEnvelope);
    }
    assertReadyArtifact(evidence.readyArtifact, event.ordinal, evidence.unsignedEnvelope);
    if (evidence.transactionBindingSha256 !== computeMainnetV8TransactionBinding({
      ordinal: event.ordinal,
      attempt: event.attempt,
      readyArtifact: evidence.readyArtifact,
      unsignedEnvelope: evidence.unsignedEnvelope,
    })) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'READY transaction binding is invalid.');
    }
    return;
  }
  if (event.status === 'FINAL_MANIFEST_SEALED') {
    exactFields(evidence, WAL_MANIFEST_EVIDENCE_FIELDS, 'FINAL_MANIFEST_SEALED evidence');
    assertEvidenceCursor(evidence.cursor, event, 'FINAL_MANIFEST_SEALED evidence');
    assertHash(evidence.releaseId, 'FINAL_MANIFEST_SEALED releaseId');
    assertMainnetV8DeterministicJson(evidence.finalManifest, 'FINAL_MANIFEST_SEALED finalManifest');
    if (evidence.releaseId !== evidence.finalManifest?.releaseId) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Final manifest evidence releaseId is inconsistent.');
    }
    return;
  }
  if (event.status === 'RELEASE_ABANDONED') {
    exactFields(evidence, WAL_ABANDON_EVIDENCE_FIELDS, 'RELEASE_ABANDONED evidence');
    assertEvidenceCursor(evidence.cursor, event, 'RELEASE_ABANDONED evidence');
    assertHash(evidence.releaseId, 'RELEASE_ABANDONED releaseId');
    assertHash(evidence.finalManifestSha256, 'RELEASE_ABANDONED finalManifestSha256');
    exactFields(evidence.reason, WAL_ABANDON_REASON_FIELDS, 'RELEASE_ABANDONED reason');
    exactFields(evidence.reason.moveAbort, WAL_ABANDON_MOVE_ABORT_FIELDS, 'RELEASE_ABANDONED moveAbort');
    assertFullId(evidence.reason.moveAbort.packageId, 'RELEASE_ABANDONED moveAbort.packageId');
    assertHash(evidence.reasonSha256, 'RELEASE_ABANDONED reasonSha256');
    if (evidence.reasonSha256 !== sha256MainnetV8Json(evidence.reason)
      || evidence.reason.code !== 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH'
      || evidence.reason.failedOrdinal !== nativeStageOrdinal('INITIALIZE_PROTOCOL')
      || evidence.reason.errorCode !== 'MAINNET_V8_SIMULATION_FAILED'
      || evidence.reason.moveAbort.module !== 'protocol_config_v8'
      || evidence.reason.moveAbort.function !== 'initialize_protocol_treasury_v8'
      || evidence.reason.moveAbort.abortCode !== '3') {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'RELEASE_ABANDONED evidence is not the approved pre-sign init incident.');
    }
    return;
  }
  if (event.status === 'SIGNED') {
    exactFields(evidence, WAL_SIGNED_EVIDENCE_FIELDS, 'SIGNED evidence');
    assertEvidenceCursor(evidence.cursor, event, 'SIGNED evidence');
    assertHash(evidence.readyArtifactSha256, 'SIGNED readyArtifactSha256');
    assertMainnetV8SignedArtifact(evidence.signedArtifact);
    assertHash(evidence.signedArtifactSha256, 'SIGNED signedArtifactSha256');
    if (evidence.signedArtifactSha256 !== sha256MainnetV8Json(evidence.signedArtifact)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'SIGNED artifact hash is invalid.');
    }
    return;
  }
  if (['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(event.status)
    && readyStageKind(event.ordinal) === 'VERIFY_AND_EXPORT') {
    exactFields(evidence, WAL_VERIFY_EVIDENCE_FIELDS, 'VERIFY_AND_EXPORT terminal evidence');
    assertEvidenceCursor(evidence.cursor, event, 'VERIFY_AND_EXPORT terminal evidence');
    assertHash(evidence.readyArtifactSha256, 'VERIFY_AND_EXPORT terminal readyArtifactSha256');
    assertObservation(evidence.observation, event.status, event.ordinal);
    assertHash(evidence.observationSha256, 'VERIFY_AND_EXPORT terminal observationSha256');
    if (evidence.observationSha256 !== sha256MainnetV8Json(evidence.observation)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'VERIFY_AND_EXPORT terminal observation hash is invalid.');
    }
    return;
  }
  exactFields(evidence, WAL_OUTCOME_EVIDENCE_FIELDS, `${event.status} evidence`);
  assertEvidenceCursor(evidence.cursor, event, `${event.status} evidence`);
  assertHash(evidence.readyArtifactSha256, `${event.status} readyArtifactSha256`);
  assertMainnetV8SignedArtifact(evidence.signedArtifact);
  assertHash(evidence.signedArtifactSha256, `${event.status} signedArtifactSha256`);
  assertSuiDigest(evidence.digest, `${event.status} digest`);
  assertObservation(evidence.observation, event.status, event.ordinal);
  assertHash(evidence.observationSha256, `${event.status} observationSha256`);
  if (evidence.observationSha256 !== sha256MainnetV8Json(evidence.observation)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${event.status} observation hash is invalid.`);
  }
  if (evidence.signedArtifactSha256 !== sha256MainnetV8Json(evidence.signedArtifact)
    || evidence.digest !== evidence.signedArtifact.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${event.status} signed artifact or digest drifted.`);
  }
  if (event.status === 'OUTCOME_PENDING' && evidence.observation.kind === 'BROADCAST_INTENT') {
    const { firstQuery, secondQuery, watermark } = evidence.observation.details;
    const fields = ['digest', 'signedArtifactSha256', 'service', 'method', 'endpoint', 'chainIdentifier'];
    if (fields.some((field) => firstQuery[field] !== secondQuery[field])
      || firstQuery.digest !== evidence.digest
      || firstQuery.signedArtifactSha256 !== evidence.signedArtifactSha256) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'BROADCAST_INTENT queries differ from the durable signed artifact.');
    }
    const transaction = bcs.TransactionData.parse(decodeCanonicalBase64(
      evidence.signedArtifact.transactionBase64, 'BROADCAST_INTENT transactionBase64',
    ));
    const expiration = transaction.V1.expiration.ValidDuring;
    if (transaction.V1.expiration.$kind !== 'ValidDuring'
      || BigInt(watermark.epoch) < BigInt(expiration.minEpoch)
      || BigInt(watermark.epoch) > BigInt(expiration.maxEpoch)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'BROADCAST_INTENT watermark is outside transaction validity.');
    }
  }
  if (event.status === 'BROADCAST_ACCEPTED'
    && evidence.observation.details.response.digest !== evidence.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'BROADCAST_ACCEPTED response differs from the durable signed digest.');
  }
  if (event.status === 'EXPIRED_NOT_FOUND') {
    const expiration = evidence.observation.details.expiration;
    const transaction = bcs.TransactionData.parse(decodeCanonicalBase64(
      evidence.signedArtifact.transactionBase64, 'EXPIRED_NOT_FOUND transactionBase64',
    ));
    if (expiration.digest !== evidence.digest
      || expiration.firstQuery.signedArtifactSha256 !== evidence.signedArtifactSha256
      || expiration.secondQuery.signedArtifactSha256 !== evidence.signedArtifactSha256
      || canonicalMainnetV8Json(expiration.expiration)
        !== canonicalMainnetV8Json(transaction.V1.expiration)) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'EXPIRED_NOT_FOUND differs from the exact signed transaction.');
    }
  }
  if (['FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'INCIDENT_STOPPED']
    .includes(event.status) && readyStageKind(event.ordinal) !== 'VERIFY_AND_EXPORT') {
    const finality = ['FINALIZED_SUCCESS_PENDING_READBACK', 'INCIDENT_STOPPED'].includes(event.status)
      ? evidence.observation.details.finalityEvidence
      : evidence.observation.details.certificate.finalityEvidence;
    if (finality.digest !== evidence.digest
      || finality.transactionBase64 !== evidence.signedArtifact.transactionBase64
      || finality.transactionSha256 !== evidence.signedArtifact.transactionSha256
      || finality.signature !== evidence.signedArtifact.signature
      || finality.signatureSha256 !== evidence.signedArtifact.signatureSha256) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${event.status} finality certificate differs from the signed artifact.`);
    }
  }
  if (readyStageKind(event.ordinal) === 'PUBLISH'
    && ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(event.status)) {
    assertMainnetV8PublishPackageEvidence(evidence.observation.details, event.ordinal, {
      requireAbi: event.status === 'FINALIZED_SUCCESS',
    });
  }
  if (event.status === 'FINALIZED_SUCCESS' && readyStageKind(event.ordinal) !== 'VERIFY_AND_EXPORT') {
    assertStageReadback(
      evidence.observation.details.certificate.readback,
      event.ordinal,
      evidence.observation.details.certificate.finalityEvidence,
      evidence.observation.details,
      evidence.signedArtifact.signer,
    );
  }
}

function eventHash(event) {
  const payload = { ...event };
  delete payload.eventSha256;
  return sha256MainnetV8Json(payload);
}

function walHash(wal) {
  const payload = { ...wal };
  delete payload.walSha256;
  return sha256MainnetV8Json(payload);
}

function assertRecordedAt(value) {
  boundedText(value, 'WAL recordedAt', 64);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== value) {
    fail('MAINNET_V8_WAL_INVALID', 'WAL recordedAt must be one canonical ISO-8601 instant.');
  }
}

export function assertWalTransition(previous, current) {
  if (!previous) {
    if (current.revision !== '1' || current.ordinal !== '0' || current.attempt !== '0'
      || current.status !== 'READY'
      || current.previousEventSha256 !== ZERO_HASH) {
      fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'The first WAL event must be revision 1, ordinal 0, attempt 0 READY.');
    }
    return;
  }
  if (BigInt(current.revision) !== BigInt(previous.revision) + 1n
    || current.previousEventSha256 !== previous.eventSha256) {
    fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'WAL revision or hash link is discontinuous.');
  }
  const sameCursor = current.ordinal === previous.ordinal && current.attempt === previous.attempt;
  const nextOrdinal = BigInt(current.ordinal) === BigInt(previous.ordinal) + 1n
    && current.attempt === '0';
  const previousIntent = previous.status === 'OUTCOME_PENDING'
    ? previous.evidence.observation.kind : null;
  const currentIntent = current.status === 'OUTCOME_PENDING'
    ? current.evidence.observation.kind : null;
  const previousIncident = previous.status === 'INCIDENT_STOPPED'
    ? previous.evidence.observation.details : null;
  const currentPending = current.status === 'FINALIZED_SUCCESS_PENDING_READBACK'
    ? current.evidence.observation.details : null;
  const repairsKnownReadbackIncident = previousIncident !== null
    && currentPending !== null
    && readyStageKind(previous.ordinal) !== 'VERIFY_AND_EXPORT'
    && MAINNET_V8_REPAIRABLE_READBACK_INCIDENTS.includes(previousIncident.incident.code)
    && previousIncident.finalityEvidenceSha256 === currentPending.finalityEvidenceSha256
    && canonicalMainnetV8Json(previousIncident.finalityEvidence)
      === canonicalMainnetV8Json(currentPending.finalityEvidence);
  const valid = previous.status === 'READY' && readyStageKind(previous.ordinal) !== 'VERIFY_AND_EXPORT'
      && current.status === 'SIGNED' && sameCursor
    || previous.status === 'READY' && readyStageKind(previous.ordinal) === 'VERIFY_AND_EXPORT'
      && ['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(current.status) && sameCursor
    || previous.status === 'SIGNED' && current.status === 'OUTCOME_PENDING'
      && currentIntent === 'QUERY_INTENT' && sameCursor
    || previous.status === 'OUTCOME_PENDING' && previousIntent === 'QUERY_INTENT'
      && current.status === 'OUTCOME_PENDING' && currentIntent === 'BROADCAST_INTENT' && sameCursor
    || previous.status === 'OUTCOME_PENDING' && previousIntent === 'QUERY_INTENT'
      && ['OUTCOME_UNKNOWN', 'FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND']
        .includes(current.status) && sameCursor
    || previous.status === 'OUTCOME_PENDING' && previousIntent === 'BROADCAST_INTENT'
      && ['BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN', 'FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_FAILURE']
        .includes(current.status) && sameCursor
    || previous.status === 'OUTCOME_PENDING' && previousIntent === 'BROADCAST_INTENT'
      && current.status === 'OUTCOME_PENDING' && currentIntent === 'QUERY_INTENT' && sameCursor
    || ['BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN'].includes(previous.status)
      && current.status === 'OUTCOME_PENDING' && currentIntent === 'QUERY_INTENT' && sameCursor
    || previous.status === 'FINALIZED_SUCCESS_PENDING_READBACK'
      && ['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(current.status) && sameCursor
    || previous.status === 'INCIDENT_STOPPED'
      && current.status === 'FINALIZED_SUCCESS_PENDING_READBACK'
      && repairsKnownReadbackIncident && sameCursor
    || previous.status === 'FINALIZED_SUCCESS' && previous.ordinal === String(MAINNET_V8_PUBLISH_ORDER.length - 1)
      && current.status === 'FINAL_MANIFEST_SEALED' && sameCursor
    || previous.status === 'FINAL_MANIFEST_SEALED'
      && current.status === 'RELEASE_ABANDONED' && sameCursor
    || previous.status === 'FINAL_MANIFEST_SEALED' && current.status === 'READY'
      && current.ordinal === nativeStageOrdinal('INITIALIZE_PROTOCOL') && current.attempt === '0'
    || previous.status === 'FINALIZED_SUCCESS' && previous.ordinal !== String(MAINNET_V8_PUBLISH_ORDER.length - 1)
      && current.status === 'READY' && nextOrdinal
      && BigInt(current.ordinal) < BigInt(MAINNET_V8_RELEASE_STEPS.length);
  if (!valid) fail('MAINNET_V8_WAL_TRANSITION_INVALID', `Invalid WAL transition ${previous.status} -> ${current.status}.`);
}

export function assertMainnetV8PublishPackageEvidence(evidence, ordinal, options = {}) {
  const { requireAbi = false } = options;
  if (!isPlain(evidence)) fail('MAINNET_V8_WAL_INVALID', 'Publish evidence must be a plain record.');
  assertMainnetV8DeterministicJson(evidence, 'Publish evidence');
  const index = Number(assertMainnetV8Decimal(
    typeof ordinal === 'number' ? String(ordinal) : ordinal,
    'Publish ordinal',
  ));
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_WAL_INVALID', 'Publish evidence ordinal is outside the eight publication packages.');
  }
  const role = MAINNET_V8_PUBLISH_ORDER[index];
  if (!Object.hasOwn(evidence, 'packageArtifact') || !Object.hasOwn(evidence, 'packageCommitment')) {
    fail('MAINNET_V8_WAL_INVALID', `Publish ${role} evidence omits its frozen package artifact.`);
  }
  assertMainnetV8PackageArtifact(evidence.packageArtifact);
  assertHash(evidence.packageCommitment, `Publish ${role} packageCommitment`);
  if (evidence.packageArtifact.role !== role
    || evidence.packageCommitment !== mainnetV8PackageCommitment(evidence.packageArtifact)) {
    fail('MAINNET_V8_WAL_INVALID', `Publish ${role} package artifact binding is invalid.`);
  }
  if (requireAbi) {
    if (!Object.hasOwn(evidence, 'abiArtifact') || !Object.hasOwn(evidence, 'abiCommitment')) {
      fail('MAINNET_V8_WAL_INVALID', `Finalized publish ${role} evidence omits its post-publish ABI artifact.`);
    }
    assertMainnetV8AbiArtifact(evidence.abiArtifact);
    assertHash(evidence.abiCommitment, `Publish ${role} abiCommitment`);
    if (evidence.abiArtifact.role !== role
      || evidence.abiCommitment !== mainnetV8AbiCommitment(evidence.abiArtifact)) {
      fail('MAINNET_V8_WAL_INVALID', `Finalized publish ${role} ABI binding is invalid.`);
    }
  }
  return evidence;
}

function assertWalEvent(event, index, previous) {
  exactFields(event, WAL_EVENT_FIELDS, `WAL event[${index}]`);
  assertHash(event.executionPlanId, `WAL event[${index}].executionPlanId`);
  if (event.releaseId !== null) assertHash(event.releaseId, `WAL event[${index}].releaseId`);
  assertMainnetV8Decimal(event.revision, `WAL event[${index}].revision`, { positive: true });
  assertMainnetV8Decimal(event.ordinal, `WAL event[${index}].ordinal`);
  assertMainnetV8Decimal(event.attempt, `WAL event[${index}].attempt`);
  if (BigInt(event.ordinal) >= BigInt(MAINNET_V8_RELEASE_STEPS.length)
    || !MAINNET_V8_WAL_STATUSES.includes(event.status)) {
    fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} status or ordinal is invalid.`);
  }
  if (!isPlain(event.evidence)) fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} evidence must be a record.`);
  assertMainnetV8DeterministicJson(event.evidence, `WAL event[${index}].evidence`);
  assertWalEvidence(event);
  assertRecordedAt(event.recordedAt);
  assertHash(event.previousEventSha256, `WAL event[${index}].previousEventSha256`);
  assertHash(event.eventSha256, `WAL event[${index}].eventSha256`);
  if (event.eventSha256 !== eventHash(event)) fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} hash is invalid.`);
  assertWalTransition(previous, event);
}

function assertManifestMatchesPublishEvidence(manifest, plan, successfulCertificates) {
  assertMainnetV8FinalManifestContents(manifest, plan);
  manifest.packages.forEach((entry, index) => {
    const successful = successfulCertificates.get(String(index));
    const details = successful?.details;
    const certificate = details?.certificate;
    const finality = certificate?.finalityEvidence;
    const readback = certificate?.readback;
    const packageReference = readback?.package?.reference;
    const upgradeCapReference = readback?.upgradeCap?.reference;
    if (details && certificate && finality && readback) {
      assertPackagePublishCertificate(readback, String(index), finality, details, plan.sender);
    }
    if (!details || !certificate || !finality || !readback
      || entry.role !== MAINNET_V8_PUBLISH_ORDER[index]
      || entry.packageId !== packageReference?.objectId
      || entry.packageDigest !== packageReference?.digest
      || entry.packageVersion !== packageReference?.version
      || entry.upgradeCapId !== upgradeCapReference?.objectId
      || entry.publishDigest !== finality.digest
      || entry.sourceCommitment !== plan.packages[index].sourceCommitment
      || entry.packageCommitment !== details.packageCommitment
      || entry.abiCommitment !== details.abiCommitment
      || entry.finalityEvidenceSha256 !== certificate.finalityEvidenceSha256
      || entry.readbackSha256 !== certificate.readbackSha256) {
      fail('MAINNET_V8_FINAL_MANIFEST_INVALID', `Final manifest package ordinal ${index} differs from finalized evidence.`);
    }
  });
}

function nativeStageOrdinal(kind) {
  const step = MAINNET_V8_RELEASE_STEPS.find(row => row.kind === kind);
  if (!step) fail('MAINNET_V8_WAL_INVALID', `Unknown native stage ${kind}.`);
  return step.ordinal;
}

function nativePriorReadbacks(stage, successfulCertificates) {
  const core = successfulCertificates.get('0')?.details?.certificate?.readback;
  if (!core) fail('MAINNET_V8_WAL_INVALID', 'Native stage has no certified Core publication.');
  const prior = { core };
  for (const step of MAINNET_V8_RELEASE_STEPS) {
    if (step.kind === stage) break;
    if (!NATIVE_BOOTSTRAP_STAGE_KINDS.includes(step.kind)) continue;
    const readback = successfulCertificates.get(step.ordinal)?.details?.certificate?.readback;
    if (!readback) fail('MAINNET_V8_WAL_INVALID', `Native stage has no certified ${step.kind} predecessor.`);
    prior[step.kind] = readback;
  }
  return prior;
}

function deriveNativeWalStage(stage, stageData, wal, manifest, successfulCertificates) {
  return deriveNativeSoulBootstrapStageData({
    stage, manifest, plan: wal.plan, priorReadbacks: nativePriorReadbacks(stage, successfulCertificates),
    ...(stage === 'SETUP_RELEASE' ? {
      keyServerCertificates: stageData.keyServerCertificates, walrusSystem: stageData.walrusSystem,
      walrusExecution: stageData.walrusExecution,
    } : {}),
  });
}

/** Input projection from already certified SO publication + final bootstrap.
 * It preserves the exact published full Object packets, not latest RPC state. */
export function deriveMainnetV8MarketActivationWalContext({ plan, manifest, successfulCertificates }) {
  assertMainnetV8FinalManifestContents(manifest, plan);
  const index = MAINNET_V8_PUBLISH_ORDER.indexOf('soulidity'), row = manifest.packages[index];
  const publication = successfulCertificates.get(String(index))?.details?.certificate?.readback;
  const bootstrap = successfulCertificates.get(nativeStageOrdinal('FINALIZE_BOOTSTRAP'))?.details?.certificate?.readback;
  if (!publication || publication.role !== 'soulidity'
    || publication.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA || publication.kind !== 'PACKAGE_PUBLISH_CERTIFICATE'
    || publication.package?.reference?.objectId !== row.packageId
    || publication.package.reference.digest !== row.packageDigest || publication.package.reference.version !== row.packageVersion
    || publication.transactionDigest !== row.publishDigest
    || publication.soulidityInitialization?.packageId !== row.packageId
    || !bootstrap || bootstrap.schema !== 'native-soul-bootstrap-history-v1' || bootstrap.stage !== 'FINALIZE_BOOTSTRAP') {
    fail('MAINNET_V8_WAL_INVALID', 'Market activation lacks exact Soulidity publication or finalized bootstrap.');
  }
  const priorObjects = Object.fromEntries(['marketConfigV2', 'marketAdminCapV2'].map(kind => {
    const output = publication.soulidityInitialization.objects?.[kind];
    if (!output || output.previousTransaction !== publication.transactionDigest) {
      fail('MAINNET_V8_WAL_INVALID', 'Market activation history differs from Soulidity publication.');
    }
    let owner;
    if (kind === 'marketConfigV2') {
      exactFields(output.owner, ['Shared'], 'Published market config owner');
      exactFields(output.owner.Shared, ['initial_shared_version'], 'Published market config shared birth');
      owner = { kind: 'shared', initialSharedVersion: output.owner.Shared.initial_shared_version };
    } else {
      exactFields(output.owner, ['AddressOwner'], 'Published market admin owner');
      owner = { kind: 'address', address: output.owner.AddressOwner };
    }
    return [kind, { reference: cloneJson(output.reference), type: output.type, owner,
      previousTransaction: output.previousTransaction, objectBcsBase64: output.objectBcsBase64 }];
  }));
  const stageData = deriveNativeSoulMarketActivationInput({ packageId: row.packageId, sender: plan.sender, priorObjects });
  return deepFreeze({ stageData, priorObjects });
}

/** Exact context checks used by the full guarded WAL parser. The caller supplies
 * already validated preceding certificates; this is not a finality authority. */
export function assertStageReadyWalContext(event, wal, sealedManifest, successfulCertificates) {
  const kind = readyStageKind(event.ordinal);
  if (kind === 'PUBLISH') {
    const ordinal = Number(event.ordinal), artifact = event.evidence.readyArtifact;
    const planned = wal.plan.packages[ordinal];
    if (!planned || artifact.role !== planned.role || artifact.packageArtifact.role !== planned.role) {
      fail('MAINNET_V8_WAL_INVALID', 'Publish READY differs from its immutable source-plan role.');
    }
    for (let index = 0; index < ordinal; index++) {
      if (!successfulCertificates.get(String(index))?.details?.certificate?.readback?.package?.reference) {
        fail('MAINNET_V8_WAL_INVALID', 'Publish READY has an incomplete finalized native prefix.');
      }
    }
    // Exact source-CAS/approved compiler output, READY bytes and historical
    // linkage validate dependencies. Do not infer an eight-package DAG from
    // retired seven-role source declarations. Cold WAL knows future target IDs.
    const unavailable = (wal.finalManifest?.packages ?? []).slice(ordinal).map(row => row.packageId);
    if (artifact.dependencies.some(id => unavailable.includes(id))) {
      fail('MAINNET_V8_WAL_INVALID', 'Publish READY references its own or a future native target.');
    }
    return;
  }
  if (!sealedManifest || wal.releaseId !== sealedManifest.releaseId) {
    fail('MAINNET_V8_WAL_INVALID', `READY ordinal ${event.ordinal} has no sealed final manifest.`);
  }
  const stageData = event.evidence.readyArtifact.stageData;
  if (kind === 'VERIFY_AND_EXPORT') {
    const bootstrap = successfulCertificates.get(nativeStageOrdinal('FINALIZE_BOOTSTRAP'))?.details?.certificate;
    const market = successfulCertificates.get(nativeStageOrdinal('ACTIVATE_SOULIDITY_MARKET'))?.details?.certificate;
    const expected = {
      releaseId: wal.releaseId, finalManifestSha256: sha256MainnetV8Json(sealedManifest),
      bootstrapCertificateSha256: bootstrap?.readbackSha256, exportFilename: stageData.exportFilename,
      marketActivationCertificateSha256: market?.readbackSha256,
    };
    if (!bootstrap || !market || canonicalMainnetV8Json(stageData) !== canonicalMainnetV8Json(expected)) {
      fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT READY differs from sealed native bootstrap evidence.');
    }
    return;
  }
  const derived = kind === 'ACTIVATE_SOULIDITY_MARKET'
    ? deriveMainnetV8MarketActivationWalContext({ plan: wal.plan, manifest: sealedManifest, successfulCertificates })
    : deriveNativeWalStage(kind, stageData, wal, sealedManifest, successfulCertificates);
  if (canonicalMainnetV8Json(stageData) !== canonicalMainnetV8Json(derived.stageData)) {
    fail('MAINNET_V8_WAL_INVALID', `${kind} READY differs from exact predecessor-derived inputs.`);
  }
}

export function assertStageSuccessContext(event, ready, wal, sealedManifest, successfulCertificates) {
  const kind = readyStageKind(event.ordinal);
  const details = event.evidence.observation.details;
  if (kind === 'ACTIVATE_SOULIDITY_MARKET') {
    if (!ready?.readyArtifact?.stageData || !sealedManifest || wal.releaseId !== sealedManifest.releaseId) {
      fail('MAINNET_V8_WAL_INVALID', 'Market activation success has no sealed READY context.');
    }
    const derived = deriveMainnetV8MarketActivationWalContext({ plan: wal.plan, manifest: sealedManifest, successfulCertificates });
    const readback = details.certificate.readback;
    if (canonicalMainnetV8Json(ready.readyArtifact.stageData) !== canonicalMainnetV8Json(derived.stageData)
      || readback.schema !== 'native-soul-market-activation-history-v1' || readback.stage !== kind
      || canonicalMainnetV8Json(readback.input) !== canonicalMainnetV8Json(derived.stageData)
      || canonicalMainnetV8Json(readback.priorObjects) !== canonicalMainnetV8Json(derived.priorObjects)) {
      fail('MAINNET_V8_WAL_INVALID', 'Market activation success differs from READY or exact publication history.');
    }
    return;
  }
  if (NATIVE_BOOTSTRAP_STAGE_KINDS.includes(kind)) {
    const stageData = ready?.readyArtifact?.stageData;
    if (!stageData || !sealedManifest || wal.releaseId !== sealedManifest.releaseId) {
      fail('MAINNET_V8_WAL_INVALID', 'Native success has no sealed READY context.');
    }
    const derived = deriveNativeWalStage(kind, stageData, wal, sealedManifest, successfulCertificates);
    const readback = details.certificate.readback;
    const input = nativeSoulBootstrapInputFromStageData(kind, stageData);
    if (canonicalMainnetV8Json(stageData) !== canonicalMainnetV8Json(derived.stageData)
      || readback.stage !== kind
      || canonicalMainnetV8Json(readback.input) !== canonicalMainnetV8Json(input)
      || canonicalMainnetV8Json(readback.priorObjects) !== canonicalMainnetV8Json(derived.priorObjects)) {
      fail('MAINNET_V8_WAL_INVALID', 'Native success differs from READY or exact predecessor history.');
    }
    return;
  }
  if (kind === 'VERIFY_AND_EXPORT') {
    const certificate = details.certificate;
    const verification = certificate.verification;
    const bootstrap = successfulCertificates.get(nativeStageOrdinal('FINALIZE_BOOTSTRAP'))?.details?.certificate;
    const market = successfulCertificates.get(nativeStageOrdinal('ACTIVATE_SOULIDITY_MARKET'))?.details?.certificate;
    const stageData = ready?.readyArtifact?.stageData;
    if (!bootstrap || !market || !sealedManifest) {
      fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT has no sealed bootstrap predecessor.');
    }
    const packageVerification = verification.packageVerification;
    const packageVerificationMatches = packageVerification.executionPlanId === wal.executionPlanId
      && packageVerification.releaseId === wal.releaseId
      && packageVerification.packages.every((entry, index) => {
        const sealed = sealedManifest.packages[index];
        const published = successfulCertificates.get(String(index))?.details?.certificate?.readback?.package;
        return entry.role === sealed.role
          && entry.packageId === sealed.packageId
          && entry.packageDigest === sealed.packageDigest
          && entry.packageVersion === sealed.packageVersion
          && entry.publishDigest === sealed.publishDigest
          && entry.sourceCommitment === sealed.sourceCommitment
          && entry.packageCommitment === sealed.packageCommitment
          && entry.abiCommitment === sealed.abiCommitment
          && entry.readbackSha256 === sealed.readbackSha256
          && entry.moduleMapSha256 === published?.moduleMapSha256
          && entry.objectBcsSha256 === published?.objectBcsSha256;
      });
    exactFields(stageData, VERIFY_STAGE_DATA_FIELDS, 'VERIFY_AND_EXPORT READY stageData');
    if (stageData.releaseId !== wal.releaseId
      || stageData.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
      || stageData.bootstrapCertificateSha256 !== bootstrap.readbackSha256
      || stageData.marketActivationCertificateSha256 !== market.readbackSha256
      || stageData.exportFilename !== certificate.exports.filename
      || verification.executionPlanId !== wal.executionPlanId
      || verification.releaseId !== wal.releaseId
      || verification.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
      || verification.marketActivationCertificateSha256 !== market.readbackSha256
      || !packageVerificationMatches
      || verification.runtimeAttestationSha256
        !== sha256MainnetV8Json(bootstrap.readback)) {
      fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT certificate differs from sealed release/bootstrap inputs.');
    }
  }
}

export function assertMainnetV8ReleaseWal(wal) {
  assertMainnetV8WalHeader(wal);
  assertMainnetV8ReleasePlan(wal.plan);
  return assertMainnetV8ReleaseWalContents(wal);
}

function assertMainnetV8WalHeader(wal) {
  assertMainnetV8DeterministicJson(wal, 'Release WAL');
  assertNoSecretFields(wal, 'Release WAL');
  exactFields(wal, WAL_FIELDS, 'Release WAL');
  if (wal.schemaVersion !== MAINNET_V8_RELEASE_WAL_SCHEMA) fail('MAINNET_V8_WAL_INVALID', 'Release WAL schema is invalid.');
}

/** Validate the entire stored history without authorizing reads for execution,
 * file writes, signing or submission. READY byte rebuilding is a separate
 * mandatory runner check; this function is the same evidence/context traversal
 * used by the guarded public WAL validator above.
 */
export function assertMainnetV8ReleaseWalContents(wal) {
  assertMainnetV8WalHeader(wal);
  assertMainnetV8ReleasePlanContents(wal.plan);
  if (wal.executionPlanId !== wal.plan.executionPlanId) {
    fail('MAINNET_V8_WAL_INVALID', 'Release WAL is bound to another execution plan.');
  }
  if ((wal.releaseId === null) !== (wal.finalManifest === null)) {
    fail('MAINNET_V8_WAL_INVALID', 'Release WAL final manifest/releaseId presence is inconsistent.');
  }
  assertMainnetV8Decimal(wal.revision, 'WAL revision', { positive: true });
  if (!Array.isArray(wal.events) || wal.events.length === 0 || wal.revision !== String(wal.events.length)) {
    fail('MAINNET_V8_WAL_INVALID', 'WAL revision must equal its append-only event count.');
  }
  let previous = null;
  const readyEvidence = new Map();
  const signedEvidence = new Map();
  const pendingFinality = new Map();
  const successfulCertificates = new Map();
  let sealedManifest = null;
  wal.events.forEach((event, index) => {
    assertWalEvent(event, index, previous);
    if (event.executionPlanId !== wal.executionPlanId) {
      fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} differs from executionPlanId.`);
    }
    if (event.status === 'FINAL_MANIFEST_SEALED') {
      if (sealedManifest !== null || event.ordinal !== String(MAINNET_V8_PUBLISH_ORDER.length - 1)
        || event.releaseId !== event.evidence.releaseId) {
        fail('MAINNET_V8_WAL_INVALID', 'Final manifest may be sealed exactly once after the last publication.');
      }
      assertManifestMatchesPublishEvidence(event.evidence.finalManifest, wal.plan, successfulCertificates);
      sealedManifest = event.evidence.finalManifest;
    } else {
      const expectedReleaseId = sealedManifest?.releaseId ?? null;
      if (event.releaseId !== expectedReleaseId) {
        fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} releaseId is outside its sealed generation.`);
      }
    }
    if (event.status === 'RELEASE_ABANDONED') {
      const core = sealedManifest?.packages?.[MAINNET_V8_PUBLISH_ORDER.indexOf('core')];
      if (!core || event.ordinal !== String(MAINNET_V8_PUBLISH_ORDER.length - 1)
        || event.evidence.releaseId !== sealedManifest.releaseId
        || event.evidence.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
        || event.evidence.reason.moveAbort.packageId !== core.packageId) {
        fail('MAINNET_V8_WAL_INVALID', 'Release abandonment differs from the sealed Core/init boundary.');
      }
    }
    const ordinal = Number(BigInt(event.ordinal));
    if (readyStageKind(event.ordinal) !== 'PUBLISH' && sealedManifest === null) {
      fail('MAINNET_V8_WAL_INVALID', `WAL ordinal ${ordinal} cannot start before final manifest sealing.`);
    }
    const cursor = `${event.ordinal}:${event.attempt}`;
    if (event.status === 'READY') {
      const unsignedEnvelope = event.evidence.unsignedEnvelope;
      if (unsignedEnvelope !== null
        && (unsignedEnvelope.sender !== wal.plan.sender
          || unsignedEnvelope.gasOwner !== wal.plan.sender)) {
        fail('MAINNET_V8_WAL_INVALID', `READY ordinal ${event.ordinal} is not owned by the execution-plan signer.`);
      }
      const predecessor = event.evidence.readyArtifact.predecessorReadback;
      if (ordinal > 0) {
        const prior = successfulCertificates.get(String(ordinal - 1));
        if (!prior || predecessor.certificateSha256 !== prior.sha256
          || canonicalMainnetV8Json(predecessor.certificate) !== prior.canonical) {
          fail('MAINNET_V8_WAL_INVALID', `READY ordinal ${event.ordinal} does not bind the preceding finalized certificate.`);
        }
      }
      assertStageReadyWalContext(event, wal, sealedManifest, successfulCertificates);
      readyEvidence.set(cursor, {
        readyArtifactSha256: event.evidence.readyArtifactSha256,
        readyArtifact: cloneJson(event.evidence.readyArtifact),
        unsignedEnvelope: event.evidence.unsignedEnvelope,
        packageCommitment: readyStageKind(event.ordinal) === 'PUBLISH'
          ? event.evidence.readyArtifact.packageCommitment : null,
        packageArtifact: readyStageKind(event.ordinal) === 'PUBLISH'
          ? canonicalMainnetV8Json(event.evidence.readyArtifact.packageArtifact) : null,
      });
    }
    if (event.status === 'SIGNED') {
      const ready = readyEvidence.get(cursor);
      const signed = event.evidence.signedArtifact;
      if (!ready || event.evidence.readyArtifactSha256 !== ready.readyArtifactSha256) {
        fail('MAINNET_V8_WAL_INVALID', `SIGNED cursor ${cursor} differs from its READY artifact.`);
      }
      if (ready.unsignedEnvelope !== null) {
        const envelope = ready.unsignedEnvelope;
        if (signed.transactionBase64 !== envelope.transactionBase64
          || signed.transactionSha256 !== envelope.transactionSha256
          || signed.transactionKindBase64 !== envelope.transactionKindBase64
          || signed.transactionKindSha256 !== envelope.transactionKindSha256
          || signed.digest !== envelope.digest || signed.signer !== envelope.sender) {
          fail('MAINNET_V8_WAL_INVALID', `SIGNED cursor ${cursor} differs from its READY unsigned transaction.`);
        }
      }
      signedEvidence.set(cursor, {
        readyArtifactSha256: event.evidence.readyArtifactSha256,
        signedArtifactSha256: event.evidence.signedArtifactSha256,
        signedArtifact: canonicalMainnetV8Json(signed),
        digest: signed.digest,
      });
    }
    const verifyOnlyTerminal = ['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(event.status)
      && readyStageKind(event.ordinal) === 'VERIFY_AND_EXPORT';
    const manifestSeal = event.status === 'FINAL_MANIFEST_SEALED';
    const releaseAbandoned = event.status === 'RELEASE_ABANDONED';
    if (!['READY', 'SIGNED'].includes(event.status)
      && !verifyOnlyTerminal && !manifestSeal && !releaseAbandoned) {
      const signed = signedEvidence.get(cursor);
      if (!signed || event.evidence.readyArtifactSha256 !== signed.readyArtifactSha256
        || event.evidence.signedArtifactSha256 !== signed.signedArtifactSha256
        || canonicalMainnetV8Json(event.evidence.signedArtifact) !== signed.signedArtifact
        || event.evidence.digest !== signed.digest) {
        fail('MAINNET_V8_WAL_INVALID', `${event.status} cursor ${cursor} differs from its durable SIGNED artifact.`);
      }
    }
    if (verifyOnlyTerminal) {
      const ready = readyEvidence.get(cursor);
      if (!ready || event.evidence.readyArtifactSha256 !== ready.readyArtifactSha256) {
        fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT terminal evidence differs from its READY artifact.');
      }
      if (event.status === 'INCIDENT_STOPPED') {
        const context = event.evidence.observation.details.incident.details;
        const bootstrap = successfulCertificates.get(nativeStageOrdinal('FINALIZE_BOOTSTRAP'))?.details?.certificate;
        const market = successfulCertificates.get(nativeStageOrdinal('ACTIVATE_SOULIDITY_MARKET'))?.details?.certificate;
        const stageData = ready.readyArtifact.stageData;
        if (!bootstrap || !market
          || context.executionPlanId !== wal.executionPlanId
          || context.releaseId !== wal.releaseId
          || context.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
          || context.bootstrapCertificateSha256 !== bootstrap.readbackSha256
          || context.marketActivationCertificateSha256 !== market.readbackSha256
          || stageData.releaseId !== context.releaseId
          || stageData.finalManifestSha256 !== context.finalManifestSha256
          || stageData.bootstrapCertificateSha256 !== context.bootstrapCertificateSha256
          || stageData.marketActivationCertificateSha256 !== context.marketActivationCertificateSha256) {
          fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT incident differs from sealed release/bootstrap inputs.');
        }
      }
    }
    if (event.status === 'FINALIZED_SUCCESS_PENDING_READBACK') {
      const finality = event.evidence.observation.details.finalityEvidence;
      pendingFinality.set(cursor, {
        sha256: event.evidence.observation.details.finalityEvidenceSha256,
        canonical: canonicalMainnetV8Json(finality),
      });
    }
    if (readyStageKind(event.ordinal) !== 'VERIFY_AND_EXPORT' && ['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(event.status)) {
      const pending = pendingFinality.get(cursor);
      const details = event.evidence.observation.details;
      const finality = event.status === 'FINALIZED_SUCCESS'
        ? details.certificate.finalityEvidence : details.finalityEvidence;
      const finalitySha256 = event.status === 'FINALIZED_SUCCESS'
        ? details.certificate.finalityEvidenceSha256 : details.finalityEvidenceSha256;
      if (!pending || pending.sha256 !== finalitySha256
        || pending.canonical !== canonicalMainnetV8Json(finality)) {
        fail('MAINNET_V8_WAL_INVALID', `${event.status} does not inherit the exact pending-readback finality bytes.`);
      }
    }
    if (readyStageKind(event.ordinal) === 'PUBLISH'
      && ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(event.status)) {
      const ready = readyEvidence.get(cursor);
      const details = event.evidence.observation.details;
      if (!ready || ready.packageCommitment !== details.packageCommitment
        || ready.packageArtifact !== canonicalMainnetV8Json(details.packageArtifact)) {
        fail('MAINNET_V8_WAL_INVALID', `Finalized publish ordinal ${event.ordinal} differs from its READY package artifact.`);
      }
    }
    if (event.status === 'FINALIZED_SUCCESS') {
      if (readyStageKind(event.ordinal) !== 'PUBLISH') {
        assertStageSuccessContext(
          event, readyEvidence.get(cursor), wal, sealedManifest, successfulCertificates,
        );
      }
      successfulCertificates.set(event.ordinal, {
        sha256: sha256MainnetV8Json(event.evidence.observation.details),
        canonical: canonicalMainnetV8Json(event.evidence.observation.details),
        details: cloneJson(event.evidence.observation.details),
      });
    }
    previous = event;
  });
  if ((sealedManifest === null) !== (wal.finalManifest === null)
    || sealedManifest !== null && (
      canonicalMainnetV8Json(sealedManifest) !== canonicalMainnetV8Json(wal.finalManifest)
      || wal.releaseId !== sealedManifest.releaseId
    )) {
    fail('MAINNET_V8_WAL_INVALID', 'Release WAL root differs from its manifest-seal event.');
  }
  if (wal.headEventSha256 !== previous.eventSha256) fail('MAINNET_V8_WAL_INVALID', 'WAL head hash is stale.');
  assertHash(wal.walSha256, 'WAL walSha256');
  if (wal.walSha256 !== walHash(wal)) fail('MAINNET_V8_WAL_INVALID', 'WAL envelope hash is invalid.');
  return wal;
}

function makeWalEvent({
  executionPlanId, releaseId, revision, ordinal, attempt, status, evidence,
  recordedAt, previousEventSha256,
}) {
  const event = {
    executionPlanId,
    releaseId,
    revision,
    ordinal,
    attempt,
    status,
    evidence: cloneJson(evidence),
    recordedAt: recordedAt ?? new Date().toISOString(),
    previousEventSha256,
  };
  event.eventSha256 = eventHash(event);
  return event;
}

async function syncDirectory(path) {
  let handle, syncError, syncFailed = false;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) { syncFailed = true; syncError = error; }
  try { await handle?.close(); } catch (closeError) {
    if (syncFailed) throw new AggregateError([syncError, closeError], 'Directory sync and handle close both failed.');
    throw closeError;
  }
  if (syncFailed) throw syncError;
}

/** Local file replacement only: no WAL validation or release authority.
 * Guarded WAL writes below use this same implementation. Callers must hold
 * the appropriate writer lock and validate content before/after replacement. */
export async function writeMainnetV8AtomicFile(path, text) {
  if (typeof text !== 'string') throw new TypeError('Atomic file content must be an immutable string.');
  path = await storageFilePath(path, { createParent: true });
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    const errors = [error];
    try { await handle?.close(); } catch (closeError) { errors.push(closeError); }
    try { await unlink(temporary); } catch (unlinkError) {
      if (unlinkError?.code !== 'ENOENT') errors.push(unlinkError);
    }
    if (errors.length > 1) throw new AggregateError(errors, 'Atomic file replacement and cleanup failed.');
    throw error;
  }
}

// A marker name is immutable ownership metadata. No fixed record is read and
// then unlinked: rmdir of an exact never-reused marker cannot delete a successor.
const WAL_OWNER_MARKER = /^owner\.([0-9a-f]{64})\.([1-9][0-9]*)\.([0-9a-f]{32})$/;
const LOCAL_WAL_HOST = createHash('sha256').update(hostname()).digest('hex');

async function storageFilePath(value, { createParent = false } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('MAINNET_V8_WAL_PATH_INVALID', 'Storage path must be a nonempty string.');
  }
  const requested = resolve(value);
  if (createParent) await mkdir(dirname(requested), { recursive: true, mode: 0o700 });
  const directory = await realpath(dirname(requested));
  const parentInfo = await lstat(directory);
  if (!parentInfo.isDirectory() || (parentInfo.mode & 0o077) !== 0) {
    fail('MAINNET_V8_WAL_PATH_INVALID', 'Storage requires a private parent directory.', { path: directory });
  }
  const target = join(directory, basename(requested));
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.nlink !== 1) {
      fail('MAINNET_V8_WAL_PATH_INVALID', 'Storage target must be one regular file, not a link or directory.', { path: target });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return target;
}

function parseWalOwnerMarker(name) {
  const match = WAL_OWNER_MARKER.exec(name);
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) <= 0) {
    fail('MAINNET_V8_WAL_LOCK_INVALID', 'WAL lock contains an invalid owner marker.', { marker: name });
  }
  return { host: match[1], pid: Number(match[2]), nonce: match[3] };
}

function localMarkerAlive(owner) {
  if (owner.host !== LOCAL_WAL_HOST) return null;
  try { process.kill(owner.pid, 0); return true; } catch (error) {
    return error?.code === 'ESRCH' ? false : true;
  }
}

async function assertWalLockDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    fail('MAINNET_V8_WAL_LOCK_INVALID', 'WAL lock/owner marker must be a private directory, not a link or file.', { path });
  }
}

async function releaseWalOwnerMarker(lockPath, marker) {
  // Only the successfully installed unique marker is ours. Never remove a
  // fixed metadata name, a recursively populated directory, or another marker.
  try { await rmdir(join(lockPath, marker)); } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('MAINNET_V8_WAL_LOCK_RELEASE_FAILED', 'WAL owner marker disappeared before release.', { lockPath, marker });
    }
    throw error;
  }
  try { await rmdir(lockPath); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
    // A later participant can keep the parent nonempty. Its marker and parent
    // must survive this release, even if it has not scanned/acquired yet.
    try { await syncDirectory(lockPath); } catch (syncError) {
      if (syncError?.code !== 'ENOENT') throw syncError;
    }
  }
  await syncDirectory(dirname(lockPath));
}

async function acquireWalLock(lockPath) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { await mkdir(lockPath, { mode: 0o700 }); } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    try { await assertWalLockDirectory(lockPath); } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const marker = 'owner.' + LOCAL_WAL_HOST + '.' + process.pid + '.' + randomBytes(16).toString('hex');
    try { await mkdir(join(lockPath, marker), { mode: 0o700 }); } catch (error) {
      // An empty parent may have been removed before we published our marker.
      if (error?.code === 'ENOENT') continue;
      // EEXIST does not mean we own a marker, even in the same process.
      throw error;
    }
    try {
      await syncDirectory(lockPath);
      await syncDirectory(dirname(lockPath));
      for (const other of await readdir(lockPath)) {
        if (other === marker) continue;
        const owner = parseWalOwnerMarker(other);
        try { await assertWalLockDirectory(join(lockPath, other)); } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        const alive = localMarkerAlive(owner);
        if (alive !== false) {
          fail('MAINNET_V8_WAL_LOCKED', 'Release WAL has another live, remote or unknown owner.', {
            lockPath, pid: String(owner.pid), host: owner.host, active: alive,
          });
        }
        // The full nonce path is never reused. Concurrent dead-owner cleaners
        // may see ENOENT, but cannot remove a newly installed marker.
        try { await rmdir(join(lockPath, other)); } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      const remaining = await readdir(lockPath);
      if (remaining.length !== 1 || remaining[0] !== marker) {
        fail('MAINNET_V8_WAL_LOCKED', 'WAL ownership changed during acquisition; retry without entering the action.', { lockPath });
      }
      return marker;
    } catch (error) {
      try { await releaseWalOwnerMarker(lockPath, marker); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'WAL lock acquisition and cleanup both failed.');
      }
      throw error;
    }
  }
  fail('MAINNET_V8_WAL_LOCKED', 'WAL lock directory creation did not converge.', { lockPath });
}

/** Local file exclusion only, for a trusted local directory. Callback receives
 * the canonical file path, not a plan, signer, client or permission override.
 * Every participant publishes its unique marker BEFORE checking exclusivity.
 * A live marker keeps the parent nonempty; old cleaners cannot rmdir it. */
export async function withMainnetV8WalFileLock(path, action) {
  const target = await storageFilePath(path, { createParent: true });
  const lockPath = target + '.lock';
  const marker = await acquireWalLock(lockPath);
  let value, actionError, actionFailed = false;
  try { value = await action(target); } catch (error) { actionFailed = true; actionError = error; }
  try { await releaseWalOwnerMarker(lockPath, marker); } catch (releaseError) {
    if (actionFailed) throw new AggregateError([actionError, releaseError], 'Release WAL action and lock release both failed.');
    throw releaseError;
  }
  if (actionFailed) throw actionError;
  return value;
}
async function readWalFile(path) {
  let text, handle, readError, readFailed = false;
  try {
    path = await storageFilePath(path);
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) {
      fail('MAINNET_V8_WAL_PATH_INVALID', 'WAL cold read requires a single-link regular file.', { path });
    }
    text = await handle.readFile('utf8');
  } catch (error) {
    readFailed = true;
    readError = error?.code === 'ENOENT'
      ? new MainnetV8ReleaseError('MAINNET_V8_WAL_NOT_FOUND', 'Release WAL does not exist.', { path })
      : error?.code === 'ELOOP'
        ? new MainnetV8ReleaseError('MAINNET_V8_WAL_PATH_INVALID', 'WAL cold read cannot follow a symbolic link.', { path })
        : error;
  }
  try { await handle?.close(); } catch (closeError) {
    if (readFailed) throw new AggregateError([readError, closeError], 'WAL cold read and handle close both failed.');
    throw closeError;
  }
  if (readFailed) throw readError;
  let wal;
  try { wal = JSON.parse(text); } catch { fail('MAINNET_V8_WAL_INVALID', 'Release WAL is not JSON.'); }
  assertMainnetV8ReleaseWal(wal);
  if (`${canonicalMainnetV8Json(wal)}\n` !== text) fail('MAINNET_V8_WAL_INVALID', 'Release WAL bytes are not canonical.');
  return wal;
}

async function writeAndVerifyWal(path, wal) {
  await writeMainnetV8AtomicFile(path, `${canonicalMainnetV8Json(wal)}\n`);
  const durable = await readWalFile(path);
  if (canonicalMainnetV8Json(durable) !== canonicalMainnetV8Json(wal)) {
    fail('MAINNET_V8_WAL_INVALID', 'Release WAL cold read differs after atomic replacement.', { path });
  }
  return deepFreeze(durable);
}

export async function readMainnetV8ReleaseWal(path) {
  return deepFreeze(await readWalFile(resolve(path)));
}

function snapshotWalArguments(value) {
  if (!isPlain(value)) return deepFreeze(cloneJson(value));
  // Existing callers may omit the optional timestamp or pass undefined. Drop
  // only that own data property, without invoking accessors or discarding any
  // other hidden/symbol/invalid data before deterministic JSON validation.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (descriptors.recordedAt?.enumerable && 'value' in descriptors.recordedAt
    && descriptors.recordedAt.value === undefined) delete descriptors.recordedAt;
  return deepFreeze(cloneJson(Object.defineProperties({}, descriptors)));
}

/** Detached in-memory history construction shared with durable WAL writes.
 * No paths, callbacks, signers or execution authority are accepted here. */
export function buildMainnetV8InitialWalContents(plan, options = {}) {
  assertMainnetV8ReleasePlanContents(plan);
  const event = makeWalEvent({
    executionPlanId: plan.executionPlanId,
    releaseId: null,
    revision: '1',
    ordinal: '0',
    attempt: '0',
    status: 'READY',
    evidence: options.evidence ?? {},
    recordedAt: options.recordedAt,
    previousEventSha256: ZERO_HASH,
  });
  const wal = {
    schemaVersion: MAINNET_V8_RELEASE_WAL_SCHEMA,
    executionPlanId: plan.executionPlanId,
    releaseId: null,
    finalManifest: null,
    plan: cloneJson(plan),
    revision: '1',
    headEventSha256: event.eventSha256,
    events: [event],
  };
  wal.walSha256 = walHash(wal);
  assertMainnetV8ReleaseWalContents(wal);
  return deepFreeze(wal);
}

export function appendMainnetV8WalContents(current, input) {
  assertMainnetV8ReleaseWalContents(current);
  if (input.expectedRevision !== current.revision
    || input.expectedHeadEventSha256 !== current.headEventSha256) {
    fail('MAINNET_V8_WAL_CAS_MISMATCH', 'Release WAL CAS revision or head hash is stale.', {
      expectedRevision: input.expectedRevision,
      actualRevision: current.revision,
      expectedHeadEventSha256: input.expectedHeadEventSha256,
      actualHeadEventSha256: current.headEventSha256,
    });
  }
  const event = makeWalEvent({
    executionPlanId: current.executionPlanId,
    releaseId: input.status === 'FINAL_MANIFEST_SEALED'
      ? input.evidence?.releaseId : current.releaseId,
    revision: (BigInt(current.revision) + 1n).toString(),
    ordinal: decimalInput(input.ordinal, 'WAL ordinal'),
    attempt: decimalInput(input.attempt, 'WAL attempt'),
    status: input.status,
    evidence: input.evidence ?? {},
    recordedAt: input.recordedAt,
    previousEventSha256: current.headEventSha256,
  });
  const wal = {
    ...cloneJson(current),
    releaseId: input.status === 'FINAL_MANIFEST_SEALED'
      ? input.evidence.releaseId : current.releaseId,
    finalManifest: input.status === 'FINAL_MANIFEST_SEALED'
      ? cloneJson(input.evidence.finalManifest) : cloneJson(current.finalManifest),
    revision: event.revision,
    headEventSha256: event.eventSha256,
    events: [...current.events.map(cloneJson), event],
  };
  delete wal.walSha256;
  wal.walSha256 = walHash(wal);
  assertMainnetV8ReleaseWalContents(wal);
  return deepFreeze(wal);
}

export async function createMainnetV8ReleaseWal(path, plan, options = {}) {
  assertMainnetV8ReleasePlan(plan);
  const savedPlan = deepFreeze(cloneJson(plan));
  const savedOptions = snapshotWalArguments(options);
  const target = resolve(path);
  return withMainnetV8WalFileLock(target, async (lockedPath) => {
    try {
      await lstat(lockedPath);
      fail('MAINNET_V8_WAL_EXISTS', 'Release WAL already exists.', { path: lockedPath });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const wal = buildMainnetV8InitialWalContents(savedPlan, savedOptions);
    assertMainnetV8ReleaseWal(wal);
    return writeAndVerifyWal(lockedPath, wal);
  });
}

export async function appendMainnetV8ReleaseWal(path, input) {
  const savedInput = snapshotWalArguments(input);
  const target = resolve(path);
  return withMainnetV8WalFileLock(target, async (lockedPath) => {
    const current = await readWalFile(lockedPath);
    const wal = appendMainnetV8WalContents(current, savedInput);
    assertMainnetV8ReleaseWal(wal);
    return writeAndVerifyWal(lockedPath, wal);
  });
}

// Runner-facing stable aliases. The longer names above remain useful in tests
// because they make the Mainnet-only scope explicit, while these names keep the
// release runner compact and form the public integration contract.
export const ROLE_ORDER = MAINNET_V8_ROLE_ORDER;
export const ROLE_PACKAGE_NAMES = MAINNET_V8_PACKAGE_NAMES;
export const canonicalJson = canonicalMainnetV8Json;

export function sha256Bytes(value) {
  return new Uint8Array(createHash('sha256').update(asBytes(value)).digest());
}

export function sha256Hex(value) {
  return Buffer.from(sha256Bytes(value)).toString('hex');
}

export const buildSourceArtifact = buildMainnetV8SourceArtifact;
export const assertSourceArtifact = assertMainnetV8SourceArtifact;
export const computeSourceCommitment = mainnetV8SourceCommitment;
export const buildPackageArtifact = buildMainnetV8PackageArtifact;
export const assertPackageArtifact = assertMainnetV8PackageArtifact;
export const computePackageCommitment = mainnetV8PackageCommitment;
export const buildAbiArtifact = buildMainnetV8AbiArtifact;
export const assertAbiArtifact = assertMainnetV8AbiArtifact;
export const computeAbiCommitment = mainnetV8AbiCommitment;
export const buildSealPolicy = buildMainnetV8SealPolicy;
export const assertSealPolicy = assertMainnetV8SealPolicy;
export const buildSealPolicyTemplate = buildMainnetV8SealPolicyTemplate;
export const assertSealPolicyTemplate = assertMainnetV8SealPolicyTemplate;
export const buildFinalSealPolicy = buildMainnetV8FinalSealPolicy;
export const assertFinalSealPolicy = assertMainnetV8FinalSealPolicy;
export const createReleasePlan = buildMainnetV8ReleasePlan;
export const assertReleasePlan = assertMainnetV8ReleasePlan;
export const buildFinalManifest = buildMainnetV8FinalManifest;
export const assertFinalManifest = assertMainnetV8FinalManifest;
export const renderPublishedToml = renderMainnetV8PublishedToml;
export const parsePublishedToml = parseMainnetV8PublishedToml;

export function computeExecutionPlanId(planOrPayload) {
  assertMainnetV8DeterministicJson(planOrPayload, 'Execution-plan ID payload');
  const payload = cloneJson(planOrPayload);
  delete payload.executionPlanId;
  return sha256MainnetV8Json(payload);
}

export function computeReleaseId(finalManifestOrPayload) {
  assertMainnetV8DeterministicJson(finalManifestOrPayload, 'Final release ID payload');
  const payload = cloneJson(finalManifestOrPayload);
  delete payload.releaseId;
  return sha256MainnetV8Json(payload);
}

export async function createReleaseWal(pathOrOptions, plan, options = {}) {
  if (typeof pathOrOptions === 'string') {
    return createMainnetV8ReleaseWal(pathOrOptions, plan, options);
  }
  const input = pathOrOptions ?? {};
  const event = input.event ?? {};
  if (event.status !== undefined && event.status !== 'READY') {
    fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'createReleaseWal initial event must be READY.');
  }
  if (event.attempt !== undefined && decimalInput(event.attempt, 'Initial WAL attempt') !== '0') {
    fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'createReleaseWal initial attempt must be 0.');
  }
  return createMainnetV8ReleaseWal(input.path, input.plan, {
    recordedAt: event.recordedAt ?? input.recordedAt,
    evidence: event.evidence ?? input.evidence ?? {},
  });
}

export async function readReleaseWal(pathOrOptions) {
  const path = typeof pathOrOptions === 'string' ? pathOrOptions : pathOrOptions?.path;
  return readMainnetV8ReleaseWal(path);
}

export async function appendReleaseWal(options) {
  const event = options?.event ?? {};
  const expectedHeadEventSha256 = options.expectedHeadEventSha256 ?? options.expectedHeadHash;
  if (options.blobs !== undefined) {
    fail('MAINNET_V8_WAL_INVALID', 'appendReleaseWal blobs are forbidden; exact bytes belong in signedArtifact.');
  }
  return appendMainnetV8ReleaseWal(options.path, {
    expectedRevision: options.expectedRevision,
    expectedHeadEventSha256,
    ordinal: event.ordinal,
    attempt: event.attempt,
    status: event.status,
    evidence: event.evidence ?? {},
    recordedAt: event.recordedAt,
  });
}
