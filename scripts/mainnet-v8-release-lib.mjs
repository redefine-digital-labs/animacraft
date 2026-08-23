import { createHash, randomBytes } from 'node:crypto';
import {
  link, mkdir, open, readFile, rename, unlink,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase58, toBase58 } from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';

export const MAINNET_V8_RELEASE_PLAN_SCHEMA = 'animacraft.mainnet-v8-release-plan.v2';
export const MAINNET_V8_RELEASE_WAL_SCHEMA = 'animacraft.mainnet-v8-release-wal.v2';
export const MAINNET_V8_WAL_EVIDENCE_SCHEMA = 'animacraft.mainnet-v8-release-evidence.v1';
export const MAINNET_V8_FINAL_MANIFEST_SCHEMA = 'animacraft.mainnet-v8-final-manifest.v1';
export const MAINNET_V8_TRANSACTION_BINDING_DOMAIN = 'animacraft-v8/ready-transaction-binding/v1';
export const MAINNET_V8_RELEASE_RUNNER_SCHEMA = 'animacraft.mainnet-v8-release-runner.v1';
export const MAINNET_V8_WAL_LOCK_SCHEMA = 'animacraft.mainnet-v8-release-lock.v1';
export const MAINNET_V8_SEAL_POLICY_TEMPLATE_SCHEMA = 'animacraft.mainnet-v8-seal-policy-template.v1';
export const MAINNET_V8_SEAL_POLICY_SCHEMA = 'animacraft.mainnet-v8-seal-policy.v2';
export const MAINNET_V8_SOURCE_ARTIFACT_DOMAIN = 'animacraft-v8/source-artifact/v1';
export const MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN = 'animacraft-v8/package-artifact/v1';
export const MAINNET_V8_ABI_ARTIFACT_DOMAIN = 'animacraft-v8/abi-artifact/v1';
export const MAINNET_V8_KEY_SERVER_SET_DOMAIN = 'animacraft-v8/seal-key-server-set/v1';
export const MAINNET_V8_ENCRYPTION_POLICY_DOMAIN = 'animacraft-v8/seal-encryption-policy/v1';

export const MAINNET_V8_CHAIN_IDENTIFIER = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
export const MAINNET_V8_LEGACY_CHAIN_IDENTIFIER = '35834a8a';
export const MAINNET_V8_PAYMENT_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const MAINNET_V8_SUI_VERSION = '1.77.2';
export const MAINNET_V8_SUI_VERSION_OUTPUT = 'sui 1.77.2-51d177ad7d65';
export const MAINNET_V8_SUI_SOURCE_COMMIT = '51d177ad7d65102fc368b582408f466d97b31548';
export const MAINNET_V8_SUI_BINARY_SHA256 = '91ec4642a3650d65af334728c09e19972833c12f27eafeccc3ce8cc2ac3e007c';
export const MAINNET_V8_FRAMEWORK_REVISION = '73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1';
export const MAINNET_V8_RELEASE_SIGNER = '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f';
export const MAINNET_V8_DEFAULT_COMMITTEE = '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595';
export const MAINNET_V8_DEFAULT_COMMITTEE_TYPE = '0x9636e0c761e7476b8579cb13d543838e3732ca482dc0a64f086f57b60c024e23::key_server::KeyServer';
export const MAINNET_V8_DEFAULT_COMMITTEE_OWNER = '0x9606ed8c994ac43bc9bf03378e5cbec269050311a47699121245e829f688bfae';
export const MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256 = '8573bed5b646dab4f03b12c212eab74ad02cd1bd4d4996191ac9c815fccc8203';
export const MAINNET_V8_PROTOCOL_PROFILE = Object.freeze({
  protocolVersion: '133',
  objectRuntimeMaxNumCachedObjects: '1000',
  objectRuntimeMaxNumStoreEntries: '1000',
});

export const MAINNET_V8_ROLE_ORDER = Object.freeze([
  'core', 'seal', 'runtime', 'output', 'physical', 'market', 'release',
]);

export const MAINNET_V8_ROLE_DEPENDENCIES = Object.freeze({
  core: Object.freeze([]),
  seal: Object.freeze(['core']),
  runtime: Object.freeze(['core', 'seal']),
  output: Object.freeze(['core', 'seal', 'runtime']),
  physical: Object.freeze(['core', 'output', 'runtime']),
  market: Object.freeze(['core', 'output', 'physical', 'runtime']),
  release: Object.freeze(['core', 'seal', 'runtime', 'output', 'physical']),
});
// Exact product package IDs encoded in each publish TransactionKind.  This is
// deliberately distinct from the Move.toml source DAG: the compiler omits a
// declared package when production bytecode never references it (Release
// declares Physical for source/test closure but does not link it on chain).
export const MAINNET_V8_ROLE_PUBLISH_DEPENDENCIES = Object.freeze({
  core: Object.freeze([]),
  seal: Object.freeze(['core']),
  runtime: Object.freeze(['core', 'seal']),
  output: Object.freeze(['core', 'seal', 'runtime']),
  physical: Object.freeze(['core', 'seal', 'runtime', 'output']),
  market: Object.freeze(['core', 'seal', 'runtime', 'output', 'physical']),
  release: Object.freeze(['core', 'seal', 'runtime', 'output']),
});

export const MAINNET_V8_PACKAGE_NAMES = Object.freeze(Object.fromEntries(
  MAINNET_V8_ROLE_ORDER.map((role) => [role, `animacraft_v8_${role}`]),
));

export const MAINNET_V8_RELEASE_STEPS = Object.freeze([
  ...MAINNET_V8_ROLE_ORDER.map((role, ordinal) => Object.freeze({
    ordinal: String(ordinal), kind: 'PUBLISH', role,
  })),
  Object.freeze({ ordinal: '7', kind: 'INITIALIZE_PROTOCOL', role: 'core' }),
  Object.freeze({ ordinal: '8', kind: 'BOOTSTRAP_RELEASE', role: 'release' }),
  Object.freeze({ ordinal: '9', kind: 'VERIFY_AND_EXPORT', role: null }),
]);

export const MAINNET_V8_WAL_STATUSES = Object.freeze([
  'READY', 'SIGNED', 'OUTCOME_PENDING', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN',
  'FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE',
  'EXPIRED_NOT_FOUND', 'INCIDENT_STOPPED', 'FINAL_MANIFEST_SEALED', 'RELEASE_ABANDONED',
]);

export const MAINNET_V8_SEAL_APPROVALS = Object.freeze([
  Object.freeze({ scope: 'BASE', function: 'seal_approve_base_v8' }),
  Object.freeze({ scope: 'PACK', function: 'seal_approve_pack_v8' }),
  Object.freeze({ scope: 'COMPLETE', function: 'seal_approve_complete_v8' }),
]);

export const MAINNET_V8_WAL_LOCK_LEASE_MS = 5 * 60_000;

const HASH = /^[0-9a-f]{64}$/;
const FULL_ID = /^0x[0-9a-f]{64}$/;
const GIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELEASE_ROLE = new Set(MAINNET_V8_ROLE_ORDER);
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
const PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS = bcs.struct('MainnetV8ReleaseLibProtocolCommitment', {
  domain: bcs.byteVector(),
  version: bcs.u64(),
  config_id: bcs.Address,
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
});
const PROTOCOL_TREASURY_INITIALIZED_EVENT_BCS = bcs.struct('MainnetV8ReleaseLibTreasuryInitialized', {
  config_id: bcs.Address,
  treasury_id: bcs.Address,
  revision: bcs.u64(),
  commitment: bcs.byteVector(),
});
const PROTOCOL_ENABLED_CHANGED_EVENT_BCS = bcs.struct('MainnetV8ReleaseLibProtocolEnabled', {
  config_id: bcs.Address,
  revision: bcs.u64(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const SEAL_POLICY_CREATED_EVENT_BCS = bcs.struct('MainnetV8ReleaseLibSealPolicyCreated', {
  config_id: bcs.Address,
  catalog_id: bcs.Address,
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
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
const PROTOCOL_BALANCE_BCS = bcs.struct('MainnetV8ReleaseLibProtocolBalance', {
  value: bcs.u64(),
});
const PROTOCOL_TREASURY_BCS = bcs.struct('MainnetV8ReleaseLibProtocolTreasury', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
  revenue: PROTOCOL_BALANCE_BCS,
  total_collected: bcs.u128(),
  total_withdrawn: bcs.u128(),
});
const PACKAGE_CALL_CAP_BCS = bcs.struct('MainnetV8ReleaseLibPackageCallCap', {
  version: bcs.u64(),
  authority_id: bcs.Address,
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  role_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
});
const EXACT_PACKAGE_BINDING_BCS = bcs.struct('MainnetV8ReleaseLibExactPackageBinding', {
  original_package_id: bcs.Address,
  callable_package_id: bcs.Address,
  source_commitment: bcs.byteVector(),
  package_commitment: bcs.byteVector(),
  abi_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const PRODUCT_RELEASE_BINDING_BCS = bcs.struct('MainnetV8ReleaseLibProductReleaseBinding', {
  version: bcs.u64(),
  native_capability_mask: bcs.u64(),
  core: EXACT_PACKAGE_BINDING_BCS,
  seal: EXACT_PACKAGE_BINDING_BCS,
  runtime: EXACT_PACKAGE_BINDING_BCS,
  output: EXACT_PACKAGE_BINDING_BCS,
  physical: EXACT_PACKAGE_BINDING_BCS,
  market: EXACT_PACKAGE_BINDING_BCS,
  release: EXACT_PACKAGE_BINDING_BCS,
  commitment: bcs.byteVector(),
});
const PACKAGE_CALL_CAP_SET_BCS = bcs.struct('MainnetV8ReleaseLibPackageCallCapSet', {
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  runtime_authority_id: bcs.Address,
  output_authority_id: bcs.Address,
  physical_authority_id: bcs.Address,
  market_authority_id: bcs.Address,
  release_authority_id: bcs.Address,
  commitment: bcs.byteVector(),
});
const PRODUCT_RELEASE_CATALOG_BCS = bcs.struct('MainnetV8ReleaseLibProductReleaseCatalog', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  protocol_config_commitment: bcs.byteVector(),
  binding: PRODUCT_RELEASE_BINDING_BCS,
  call_cap_set: PACKAGE_CALL_CAP_SET_BCS,
  seal_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  runtime_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  output_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  physical_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  market_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  release_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
});
const SEAL_KEY_SERVER_BINDING_BCS = bcs.struct('MainnetV8ReleaseLibSealKeyServerBinding', {
  key_server_id: bcs.Address,
  weight: bcs.u16(),
});
const SEAL_POLICY_CONFIG_BCS = bcs.struct('MainnetV8ReleaseLibSealPolicyConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_original_package_id: bcs.Address,
  seal_callable_package_id: bcs.Address,
  seal_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  call_cap_set_commitment: bcs.byteVector(),
  seal_call_cap: PACKAGE_CALL_CAP_BCS,
  key_servers: bcs.vector(SEAL_KEY_SERVER_BINDING_BCS),
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  encryption_policy_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const SIMPLE_PACKAGE_CONFIG_BCS = bcs.struct('MainnetV8ReleaseLibSimplePackageConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  call_cap: PACKAGE_CALL_CAP_BCS,
});
const BOUND_PACKAGE_CONFIG_BCS = bcs.struct('MainnetV8ReleaseLibBoundPackageConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
  call_cap: PACKAGE_CALL_CAP_BCS,
});

const SOURCE_FIELDS = Object.freeze([
  'domain', 'role', 'packageName', 'release', 'toolchain', 'files',
]);
const SOURCE_RELEASE_FIELDS = Object.freeze(['gitCommit', 'gitTree']);
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
const SOURCE_REVISION_FIELDS = Object.freeze(['gitCommit', 'gitTree', 'clean']);
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
const PROTOCOL_TREASURY_MOVE_FIELDS = Object.freeze([
  'id', 'version', 'config_id', 'revenue', 'total_collected', 'total_withdrawn',
]);
const PRODUCT_RELEASE_CATALOG_MOVE_FIELDS = Object.freeze([
  'id', 'version', 'protocol_config_id', 'protocol_config_revision',
  'protocol_config_commitment', 'binding', 'call_cap_set', 'seal_call_cap',
  'runtime_call_cap', 'output_call_cap', 'physical_call_cap', 'market_call_cap',
  'release_call_cap',
]);
const PRODUCT_BINDING_MOVE_FIELDS = Object.freeze([
  'version', 'native_capability_mask', ...MAINNET_V8_ROLE_ORDER, 'commitment',
]);
const EXACT_BINDING_MOVE_FIELDS = Object.freeze([
  'original_package_id', 'callable_package_id', 'source_commitment',
  'package_commitment', 'abi_commitment', 'commitment',
]);
const CALL_CAP_SET_MOVE_FIELDS = Object.freeze([
  'version', 'catalog_id', 'product_binding_commitment',
  ...MAINNET_V8_ROLE_ORDER.slice(1).map((role) => `${role}_authority_id`), 'commitment',
]);
const PACKAGE_CALL_CAP_MOVE_FIELDS = Object.freeze([
  'version', 'authority_id', 'catalog_id', 'product_binding_commitment',
  'role_binding_commitment', 'call_cap_set_commitment',
]);
const SEAL_CONFIG_MOVE_FIELDS = Object.freeze([
  'id', 'version', 'protocol_config_id', 'protocol_config_revision', 'catalog_id',
  'product_binding_commitment', 'seal_original_package_id', 'seal_callable_package_id',
  'seal_binding_commitment', 'seal_authority_id', 'call_cap_set_commitment',
  'seal_call_cap', 'key_servers', 'threshold', 'key_server_set_commitment',
  'encryption_policy_commitment', 'commitment',
]);
const SIMPLE_CONFIG_MOVE_FIELDS = Object.freeze([
  'id', 'version', 'catalog_id', 'product_binding_commitment',
]);
const MOVE_KEY_SERVER_FIELDS = Object.freeze(['key_server_id', 'weight']);
const PACKAGE_PUBLISH_CERTIFICATE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'role', 'transactionDigest', 'package',
  'upgradeCap', 'protocolConfig', 'protocolAdminCap',
]);
const PACKAGE_READBACK_FIELDS = Object.freeze([
  'schemaVersion', 'role', 'transactionDigest', 'reference', 'moduleMapSha256',
  'objectBcsSha256', 'typeOrigins', 'linkage', 'descriptor', 'abiArtifact',
]);
const PACKAGE_TYPE_ORIGIN_FIELDS = Object.freeze(['moduleName', 'datatypeName', 'package']);
const PACKAGE_LINKAGE_FIELDS = Object.freeze(['originalId', 'upgradedId', 'upgradedVersion']);
const PROTOCOL_INIT_CERTIFICATE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'transactionDigest', 'protocolConfig',
  'protocolAdminCap', 'protocolTreasury', 'events',
]);
const PROTOCOL_INIT_EVENTS_FIELDS = Object.freeze([
  'treasuryInitialized', 'enabledChanged', 'intermediateCommitment', 'finalCommitment',
]);
const BOOTSTRAP_CERTIFICATE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'transactionDigest', 'runtimeConfig', 'catalog',
  'configs', 'releaseCommitments', 'sealPolicyCommitment', 'events', 'attestation',
]);
const RELEASE_COMMITMENTS_FIELDS = Object.freeze([
  'roles', 'authorities', 'productBindingCommitment', 'callCapSetCommitment',
]);
const RELEASE_COMMITMENT_ROLE_FIELDS = Object.freeze([
  'originalPackageId', 'callablePackageId', 'sourceCommitment', 'packageCommitment',
  'abiCommitment', 'bindingCommitment', 'originalMarkerType', 'callableMarkerType',
]);
const SEAL_POLICY_EVENT_FIELDS = Object.freeze([
  'config_id', 'catalog_id', 'threshold', 'key_server_set_commitment', 'commitment',
]);
const RUNTIME_CONFIG_FIELDS = Object.freeze([
  'schemaVersion', 'protocolVersion', 'enabled', 'catalogId', 'protocolConfigId',
  'protocolTreasuryId', 'paymentCoinType', 'clockObjectId', 'roles',
  'roleConfigIds', 'makerBindings',
]);
const RUNTIME_ROLE_FIELDS = Object.freeze(['typeOriginPackageId', 'callablePackageId']);
const ATTESTATION_FIELDS = Object.freeze(['catalog', 'configs', 'packageTuple', 'coreArtifact']);
const ATTESTED_CATALOG_FIELDS = Object.freeze([
  'schemaVersion', 'network', 'objectId', 'version', 'digest', 'type', 'owner',
  'fields', 'objectRef', 'protocolConfigRevision', 'protocolConfigCommitment',
  'productBindingCommitment', 'callCapSetCommitment', 'roles', 'authorities',
]);
const ATTESTED_CONFIG_FIELDS = Object.freeze([
  'schemaVersion', 'network', 'objectId', 'version', 'digest', 'type', 'owner',
  'fields', 'objectRef', 'role',
]);
const ATTESTED_ROLE_FIELDS = Object.freeze([
  'role', 'originalPackageId', 'callablePackageId', 'sourceCommitment',
  'packageCommitment', 'abiCommitment', 'commitment',
]);
const PACKAGE_TUPLE_FIELDS = Object.freeze([
  'role', 'originalPackageId', 'callablePackageId', 'packageDigest',
]);
const CORE_ARTIFACT_FIELDS = Object.freeze([
  'callablePackageId', 'packageDigest', 'baseRegistryModuleSha256',
]);
const VERIFY_RECORD_FIELDS = Object.freeze([
  'kind', 'executionPlanId', 'releaseId', 'finalManifestSha256',
  'packageVerification', 'packageVerificationSha256', 'runtimeAttestationSha256',
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
]);
const INIT_STAGE_DATA_FIELDS = Object.freeze(['packageIds', 'protocolConfig', 'protocolAdminCap']);
const BOOTSTRAP_STAGE_DATA_FIELDS = Object.freeze([
  'packageIds', 'protocolConfig', 'protocolAdminCap', 'commitments',
  'sealPolicy', 'keyServerCertificates',
]);
const SHARED_INPUT_REFERENCE_FIELDS = Object.freeze(['objectId', 'initialSharedVersion']);
const OWNED_INPUT_REFERENCE_FIELDS = Object.freeze(['objectId', 'version', 'digest']);
const STAGE_COMMITMENT_FIELDS = Object.freeze(['source', 'package', 'abi']);
const KEY_SERVER_CERTIFICATE_FIELDS = Object.freeze([
  'objectId', 'type', 'version', 'digest', 'owner', 'previousTransaction', 'contentSha256',
]);
const LOCK_FIELDS = Object.freeze(['pid', 'hostname', 'createdAt', 'nonce']);
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

function assertRole(role, label = 'role') {
  if (!RELEASE_ROLE.has(role)) fail('MAINNET_V8_ROLE_INVALID', `${label} is not one v8 package role.`);
  return role;
}

function assertPackageName(role, packageName, label = 'packageName') {
  if (packageName !== MAINNET_V8_PACKAGE_NAMES[role]) {
    fail('MAINNET_V8_PACKAGE_NAME_INVALID', `${label} does not match its exact role.`, { role, packageName });
  }
  return packageName;
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
  assertRole(artifact.role, 'Source artifact role');
  assertPackageName(artifact.role, artifact.packageName, 'Source artifact packageName');
  exactFields(artifact.release, SOURCE_RELEASE_FIELDS, 'Source artifact release');
  assertGitId(artifact.release.gitCommit, 'Source artifact release.gitCommit');
  assertGitId(artifact.release.gitTree, 'Source artifact release.gitTree');
  assertToolchain(artifact.toolchain, 'Source artifact toolchain');
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
  const role = assertRole(input?.role);
  const artifact = {
    domain: MAINNET_V8_SOURCE_ARTIFACT_DOMAIN,
    role,
    packageName: input.packageName ?? MAINNET_V8_PACKAGE_NAMES[role],
    release: cloneJson(input.release),
    toolchain: cloneJson(input.toolchain),
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
  assertRole(artifact.role, 'Package artifact role');
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
  const role = assertRole(input?.role);
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
  assertRole(artifact.role, 'ABI artifact role');
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
  const role = assertRole(input?.role);
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
  const approved = [{ objectId: MAINNET_V8_DEFAULT_COMMITTEE, weight: '1' }];
  if (canonicalMainnetV8Json(artifact.keyServers) !== canonicalMainnetV8Json(approved)
    || artifact.threshold !== '1') {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy is outside the only reviewed Mainnet committee snapshot.');
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
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan protocol profile is not the measured protocol 133 profile.');
  }
}

function artifactPackage(role, entry, index) {
  exactFields(entry, PLAN_PACKAGE_FIELDS, `Release package[${index}]`);
  if (entry.role !== role) fail('MAINNET_V8_PLAN_INVALID', 'Release packages are outside exact role order.');
  assertPackageName(role, entry.packageName, `Release package[${index}].packageName`);
  assertMainnetV8SourceArtifact(entry.sourceArtifact);
  if (entry.sourceArtifact.role !== role || entry.sourceArtifact.packageName !== entry.packageName) {
    fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} artifact roles disagree.`);
  }
  assertHash(entry.sourceCommitment, `Release package ${role} sourceCommitment`);
  if (entry.sourceCommitment !== mainnetV8SourceCommitment(entry.sourceArtifact)) {
    fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} source commitment does not match its artifact.`);
  }
}

function executionPlanIdPayload(plan) {
  const payload = { ...plan };
  delete payload.executionPlanId;
  return payload;
}

export function assertMainnetV8ReleasePlan(plan) {
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
  exactFields(plan.sourceRevision, SOURCE_REVISION_FIELDS, 'Release sourceRevision');
  assertGitId(plan.sourceRevision.gitCommit, 'Release sourceRevision.gitCommit');
  assertGitId(plan.sourceRevision.gitTree, 'Release sourceRevision.gitTree');
  if (plan.sourceRevision.clean !== true) fail('MAINNET_V8_PLAN_INVALID', 'Release source must be a clean Git tree.');
  assertToolchain(plan.toolchain, 'Release toolchain');
  assertProtocolProfile(plan.protocolProfile);
  if (plan.paymentCoinType !== MAINNET_V8_PAYMENT_COIN_TYPE) fail('MAINNET_V8_PLAN_INVALID', 'Release payment coin is not Mainnet native USDC.');
  assertMainnetV8SealPolicyTemplate(plan.sealPolicy);
  if (!Array.isArray(plan.packages) || plan.packages.length !== MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan must bind exactly seven source artifacts.');
  }
  plan.packages.forEach((entry, index) => {
    const role = MAINNET_V8_ROLE_ORDER[index];
    artifactPackage(role, entry, index);
    if (entry.sourceArtifact.release.gitCommit !== plan.sourceRevision.gitCommit
      || entry.sourceArtifact.release.gitTree !== plan.sourceRevision.gitTree
      || canonicalMainnetV8Json(entry.sourceArtifact.toolchain) !== canonicalMainnetV8Json(plan.toolchain)) {
      fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} is bound to a different source or toolchain.`);
    }
  });
  if (!Array.isArray(plan.steps) || plan.steps.length !== MAINNET_V8_RELEASE_STEPS.length) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan steps are incomplete.');
  }
  plan.steps.forEach((step, index) => exactFields(step, STEP_FIELDS, `Release step[${index}]`));
  if (canonicalMainnetV8Json(plan.steps) !== canonicalMainnetV8Json(MAINNET_V8_RELEASE_STEPS)) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan steps differ from the frozen ten-step release.');
  }
  assertHash(plan.executionPlanId, 'Release executionPlanId');
  const expected = sha256MainnetV8Json(executionPlanIdPayload(plan));
  if (plan.executionPlanId !== expected) {
    fail('MAINNET_V8_PLAN_INVALID', 'executionPlanId does not match the immutable preflight plan.', { expected });
  }
  return plan;
}

export function buildMainnetV8ReleasePlan(input) {
  const packages = input.packages.map((entry) => ({
    role: entry.role,
    packageName: entry.packageName ?? MAINNET_V8_PACKAGE_NAMES[entry.role],
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
  assertMainnetV8ReleasePlan(plan);
  return deepFreeze(plan);
}

function finalManifestPayload(manifest) {
  const payload = { ...manifest };
  delete payload.releaseId;
  return payload;
}

export function assertMainnetV8FinalManifest(manifest, plan) {
  assertMainnetV8ReleasePlan(plan);
  assertMainnetV8DeterministicJson(manifest, 'Final release manifest');
  exactFields(manifest, FINAL_MANIFEST_FIELDS, 'Final release manifest');
  if (manifest.schemaVersion !== MAINNET_V8_FINAL_MANIFEST_SCHEMA
    || manifest.executionPlanId !== plan.executionPlanId
    || manifest.chainIdentifier !== plan.chain.chainIdentifier
    || manifest.sender !== plan.sender) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest identity differs from the immutable execution plan.');
  }
  if (!Array.isArray(manifest.packages)
    || manifest.packages.length !== MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest must bind exactly seven published packages.');
  }
  const packageIds = new Set();
  const upgradeCaps = new Set();
  manifest.packages.forEach((entry, index) => {
    exactFields(entry, FINAL_MANIFEST_PACKAGE_FIELDS, `Final manifest package[${index}]`);
    const role = MAINNET_V8_ROLE_ORDER[index];
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
    if (packageIds.has(entry.packageId) || upgradeCaps.has(entry.upgradeCapId)) {
      fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest package/cap identities must be unique.');
    }
    packageIds.add(entry.packageId);
    upgradeCaps.add(entry.upgradeCapId);
  });
  assertMainnetV8FinalSealPolicy(manifest.sealPolicy, plan.sealPolicy);
  const seal = manifest.packages[MAINNET_V8_ROLE_ORDER.indexOf('seal')];
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
  if (!Array.isArray(packages) || packages.length !== MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest builder requires seven package rows.');
  }
  const seal = packages[MAINNET_V8_ROLE_ORDER.indexOf('seal')];
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
  assertMainnetV8FinalManifest(manifest, plan);
  return deepFreeze(manifest);
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
  const role = MAINNET_V8_ROLE_ORDER[index];
  assertPackageName(role, entry.packageName, `Published entry[${index}].packageName`);
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
  exactFields(value, ['buildEnv', 'chainId', 'entries'], 'Published.toml value');
  if (value.buildEnv !== 'mainnet' || value.chainId !== MAINNET_V8_LEGACY_CHAIN_IDENTIFIER
    || !Array.isArray(value.entries) || value.entries.length > MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml is not an exact Mainnet v8 prefix.');
  }
  value.entries.forEach(assertPublishedEntry);
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
  };
  let index = 7;
  while (index < lines.length) {
    if (result.entries.length > 0) {
      if (lines[index] !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml entries need one blank separator.');
      index += 1;
    }
    if (lines[index] !== '[[published]]') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml entry header is invalid.');
    const source = /^source = \{ local = (".*") \}$/.exec(lines[index + 1] ?? '');
    const publishedAt = /^published-at = (".*")$/.exec(lines[index + 2] ?? '');
    const originalId = /^original-id = (".*")$/.exec(lines[index + 3] ?? '');
    const version = /^version = ([0-9]+)$/.exec(lines[index + 4] ?? '');
    const toolchainVersion = /^toolchain-version = (".*")$/.exec(lines[index + 5] ?? '');
    const build = /^build-config = \{ flavor = (".*"), edition = (".*") \}$/.exec(lines[index + 6] ?? '');
    const cap = /^upgrade-capability = (".*")$/.exec(lines[index + 7] ?? '');
    if (!source || !publishedAt || !originalId || !version || !toolchainVersion || !build || !cap) {
      fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `Published.toml entry ${result.entries.length} is malformed.`);
    }
    const sourcePath = parseTomlString(source[1], 'published source');
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
  if (index < MAINNET_V8_ROLE_ORDER.length) return 'PUBLISH';
  return ['INITIALIZE_PROTOCOL', 'BOOTSTRAP_RELEASE', 'VERIFY_AND_EXPORT'][index - 7];
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
  if (ordinal === '9') {
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
  const role = MAINNET_V8_ROLE_ORDER[index];
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

function assertStagePackageIds(packageIds, label) {
  exactFields(packageIds, MAINNET_V8_ROLE_ORDER, label);
  const values = MAINNET_V8_ROLE_ORDER.map((role) => assertFullId(
    packageIds[role], `${label}.${role}`,
  ));
  if (new Set(values).size !== values.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} contains colliding package IDs.`);
  }
  return packageIds;
}

function assertSharedInputReference(reference, label) {
  exactFields(reference, SHARED_INPUT_REFERENCE_FIELDS, label);
  assertFullId(reference.objectId, `${label}.objectId`);
  assertMainnetV8Decimal(reference.initialSharedVersion, `${label}.initialSharedVersion`, {
    positive: true,
  });
  return reference;
}

function assertOwnedInputReference(reference, label) {
  exactFields(reference, OWNED_INPUT_REFERENCE_FIELDS, label);
  assertObjectReference(reference, label);
  return reference;
}

function assertInitStageData(stageData) {
  const label = 'INITIALIZE_PROTOCOL stageData';
  exactFields(stageData, INIT_STAGE_DATA_FIELDS, label);
  assertStagePackageIds(stageData.packageIds, `${label}.packageIds`);
  assertSharedInputReference(stageData.protocolConfig, `${label}.protocolConfig`);
  assertOwnedInputReference(stageData.protocolAdminCap, `${label}.protocolAdminCap`);
  return stageData;
}

function assertBootstrapStageData(stageData) {
  const label = 'BOOTSTRAP_RELEASE stageData';
  exactFields(stageData, BOOTSTRAP_STAGE_DATA_FIELDS, label);
  assertStagePackageIds(stageData.packageIds, `${label}.packageIds`);
  assertSharedInputReference(stageData.protocolConfig, `${label}.protocolConfig`);
  assertOwnedInputReference(stageData.protocolAdminCap, `${label}.protocolAdminCap`);
  exactFields(stageData.commitments, MAINNET_V8_ROLE_ORDER, `${label}.commitments`);
  MAINNET_V8_ROLE_ORDER.forEach((role) => {
    const commitment = stageData.commitments[role];
    exactFields(commitment, STAGE_COMMITMENT_FIELDS, `${label}.commitments.${role}`);
    STAGE_COMMITMENT_FIELDS.forEach((field) => assertHash(
      commitment[field], `${label}.commitments.${role}.${field}`,
    ));
  });
  assertMainnetV8FinalSealPolicy(stageData.sealPolicy);
  if (!Array.isArray(stageData.keyServerCertificates)
    || stageData.keyServerCertificates.length !== stageData.sealPolicy.keyServers.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} key-server certificate cardinality drifted.`);
  }
  stageData.keyServerCertificates.forEach((certificate, index) => {
    exactFields(certificate, KEY_SERVER_CERTIFICATE_FIELDS, `${label}.keyServerCertificates[${index}]`);
    if (certificate.objectId !== stageData.sealPolicy.keyServers[index].objectId
      || certificate.objectId !== MAINNET_V8_DEFAULT_COMMITTEE
      || certificate.type !== MAINNET_V8_DEFAULT_COMMITTEE_TYPE
      || certificate.owner !== MAINNET_V8_DEFAULT_COMMITTEE_OWNER
      || certificate.contentSha256 !== MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256) {
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

function assertVerifyStageData(stageData) {
  const label = 'VERIFY_AND_EXPORT stageData';
  exactFields(stageData, VERIFY_STAGE_DATA_FIELDS, label);
  assertHash(stageData.releaseId, `${label}.releaseId`);
  assertHash(stageData.finalManifestSha256, `${label}.finalManifestSha256`);
  assertHash(stageData.bootstrapCertificateSha256, `${label}.bootstrapCertificateSha256`);
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
  if (ordinal === '7') assertInitStageData(artifact.stageData);
  else if (ordinal === '8') assertBootstrapStageData(artifact.stageData);
  else assertVerifyStageData(artifact.stageData);
  assertReadyGates(artifact, ordinal, envelope);
  return artifact;
}

function assertReadyArtifact(artifact, ordinal, envelope) {
  if (!isPlain(artifact)) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'READY artifact must be a plain record.');
  return BigInt(ordinal) < BigInt(MAINNET_V8_ROLE_ORDER.length)
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
    && BigInt(ordinal) >= BigInt(MAINNET_V8_ROLE_ORDER.length)) {
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

function assertProtocolTreasuryOutput(output, corePackageId, configId, transactionDigest, label) {
  assertMoveOutput(output, label, transactionDigest);
  if (output.type !== `${corePackageId}::protocol_config_v8::ProtocolTreasuryV8<${MAINNET_V8_PAYMENT_COIN_TYPE}>`
    || !Object.hasOwn(output.owner, 'Shared')) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} type or shared owner is invalid.`);
  }
  exactFields(output.fields, PROTOCOL_TREASURY_MOVE_FIELDS, `${label}.fields`);
  exactFields(output.fields.revenue, ['value'], `${label}.fields.revenue`);
  if (moveObjectId(output.fields.id, `${label}.fields.id`) !== output.reference.objectId
    || moveDecimal(output.fields.version, `${label}.fields.version`) !== '8'
    || moveObjectId(output.fields.config_id, `${label}.fields.config_id`) !== configId
    || moveDecimal(output.fields.revenue.value, `${label}.fields.revenue.value`) !== '0'
    || moveDecimal(output.fields.total_collected, `${label}.fields.total_collected`) !== '0'
    || moveDecimal(output.fields.total_withdrawn, `${label}.fields.total_withdrawn`) !== '0') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} fields differ from a fresh protocol treasury.`);
  }
  const parsed = parseExactMoveContent(output, PROTOCOL_TREASURY_BCS, label);
  if (parsed.id !== output.reference.objectId || String(parsed.version) !== '8'
    || parsed.config_id !== configId || String(parsed.revenue.value) !== '0'
    || String(parsed.total_collected) !== '0' || String(parsed.total_withdrawn) !== '0') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return output;
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
    if (entry.originalId !== entry.upgradedId || priorLink !== null
      && compareMainnetV8Text(priorLink, entry.originalId) >= 0) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.linkage is upgraded, duplicated, or unsorted.`);
    }
    priorLink = entry.originalId;
    observedDependencies.push(entry.originalId);
  });
  if (canonicalMainnetV8Json(observedDependencies)
    !== canonicalMainnetV8Json(details.packageArtifact.dependencies)) {
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

function assertPackagePublishCertificate(readback, ordinal, finalityEvidence, details, signer = null) {
  const index = Number(BigInt(ordinal));
  const role = MAINNET_V8_ROLE_ORDER[index];
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
  const moduleMap = Object.fromEntries(details.packageArtifact.modules.map((module) => [
    module.name, module.bytesBase64,
  ]));
  if (packageCertificate.moduleMapSha256 !== sha256MainnetV8Json(moduleMap)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} module-map hash differs from frozen package bytes.`);
  }
  const writes = finalityWrites(finalityEvidence);
  const expectedCount = role === 'core' ? 4 : 2;
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
  const outputIds = [
    packageCertificate.reference.objectId,
    readback.upgradeCap.reference.objectId,
    ...(role === 'core' ? [
      readback.protocolConfig.reference.objectId, readback.protocolAdminCap.reference.objectId,
    ] : []),
  ];
  if (new Set(outputIds).size !== expectedCount
    || new Set(writes.map(({ objectId }) => objectId)).size !== expectedCount) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} output identities collide.`);
  }
  return readback;
}

function canonicalBcsJson(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(canonicalBcsJson);
  if (isPlain(value)) return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, canonicalBcsJson(entry)]),
  );
  return value;
}

function parsedFinalityEvents(finalityEvidence, label) {
  if (finalityEvidence.eventsDigest === null || finalityEvidence.transactionEvents === null) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} requires durable TransactionEvents.`);
  }
  const bytes = decodeCanonicalBase64(
    finalityEvidence.transactionEvents.bcsBase64, `${label}.transactionEvents.bcsBase64`,
  );
  const envelope = SUI_TRANSACTION_EVENTS_BCS.parse(bytes);
  return envelope.data;
}

function assertEventEnvelope(event, { packageId, signer, module, name }, label) {
  if (event.package_id !== packageId || event.transaction_module !== module
    || signer !== null && event.sender !== signer
    || event.event_type?.address !== packageId || event.event_type?.module !== module
    || event.event_type?.name !== name || !Array.isArray(event.event_type?.typeParams)
    || event.event_type.typeParams.length !== 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} envelope is invalid.`);
  }
}

function deriveProtocolConfigCommitment({
  configId, corePackageId, revision, treasuryId, enabled,
}) {
  const bytes = PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS.serialize({
    domain: encoder.encode('animacraft-v8/protocol-config'),
    version: '8',
    config_id: configId,
    core_original_package_id: corePackageId,
    core_callable_package_id: corePackageId,
    revision,
    treasury_id: treasuryId,
    payment_coin_type: MAINNET_V8_PAYMENT_COIN_TYPE,
    primary_content_fee_bps: 1000,
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: 250,
    soul_market_fee_bps: 250,
    enabled,
  }).toBytes();
  return sha256MainnetV8Bytes(bytes);
}

function assertProtocolInitEvents(readback, finalityEvidence, corePackageId, signer) {
  exactFields(readback.events, PROTOCOL_INIT_EVENTS_FIELDS, 'Protocol init readback.events');
  const events = parsedFinalityEvents(finalityEvidence, 'Protocol init');
  if (events.length !== 2) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Protocol init must contain exactly two events.');
  }
  const specs = [
    {
      field: 'treasuryInitialized', name: 'ProtocolTreasuryV8Initialized',
      schema: PROTOCOL_TREASURY_INITIALIZED_EVENT_BCS,
    },
    {
      field: 'enabledChanged', name: 'ProtocolV8EnabledChanged',
      schema: PROTOCOL_ENABLED_CHANGED_EVENT_BCS,
    },
  ];
  const parsed = specs.map((spec, index) => {
    assertEventEnvelope(events[index], {
      packageId: corePackageId, signer, module: 'protocol_config_v8', name: spec.name,
    }, `Protocol init ${spec.name}`);
    const contents = Uint8Array.from(events[index].contents);
    let value;
    let roundtrip;
    try {
      value = spec.schema.parse(contents);
      roundtrip = spec.schema.serialize(value).toBytes();
    } catch {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Protocol init ${spec.name} contains invalid BCS.`);
    }
    if (!sameBytes(contents, roundtrip)
      || canonicalMainnetV8Json(canonicalBcsJson(value))
        !== canonicalMainnetV8Json(readback.events[spec.field])) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Protocol init ${spec.name} summary differs from raw BCS.`);
    }
    return value;
  });
  const configId = readback.protocolConfig.reference.objectId;
  const treasuryId = readback.protocolTreasury.reference.objectId;
  const intermediate = deriveProtocolConfigCommitment({
    configId, corePackageId, revision: '1', treasuryId, enabled: false,
  });
  const final = deriveProtocolConfigCommitment({
    configId, corePackageId, revision: '2', treasuryId, enabled: true,
  });
  assertHash(readback.events.intermediateCommitment, 'Protocol init intermediateCommitment');
  assertHash(readback.events.finalCommitment, 'Protocol init finalCommitment');
  if (parsed[0].config_id !== configId || parsed[0].treasury_id !== treasuryId
    || String(parsed[0].revision) !== '1'
    || Buffer.from(parsed[0].commitment).toString('hex') !== intermediate
    || parsed[1].config_id !== configId || String(parsed[1].revision) !== '2'
    || parsed[1].enabled !== true
    || Buffer.from(parsed[1].commitment).toString('hex') !== final
    || readback.events.intermediateCommitment !== intermediate
    || readback.events.finalCommitment !== final
    || moveHash(readback.protocolConfig.fields.commitment, 'Protocol init config commitment') !== final) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Protocol init events do not bind exact config commitments.');
  }
}

function assertProtocolInitCertificate(readback, finalityEvidence, signer = null) {
  const label = 'Protocol init readback';
  exactFields(readback, PROTOCOL_INIT_CERTIFICATE_FIELDS, label);
  if (readback.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA
    || readback.kind !== 'PROTOCOL_INIT_CERTIFICATE'
    || readback.transactionDigest !== finalityEvidence.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} identity differs from finality.`);
  }
  const match = /^(0x[0-9a-f]{64})::protocol_config_v8::ProtocolConfigV8$/.exec(
    readback.protocolConfig?.type ?? '',
  );
  if (!match) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} has no canonical Core package type.`);
  const corePackageId = match[1];
  assertProtocolTreasuryOutput(
    readback.protocolTreasury, corePackageId, readback.protocolConfig.reference.objectId,
    finalityEvidence.digest, `${label}.protocolTreasury`,
  );
  assertProtocolConfigOutput(readback.protocolConfig, {
    corePackageId,
    transactionDigest: finalityEvidence.digest,
    enabled: true,
    revision: '2',
    treasuryId: readback.protocolTreasury.reference.objectId,
  }, `${label}.protocolConfig`);
  assertProtocolAdminOutput(
    readback.protocolAdminCap,
    corePackageId,
    readback.protocolConfig.reference.objectId,
    finalityEvidence.digest,
    signer,
    `${label}.protocolAdminCap`,
  );
  const writes = finalityWrites(finalityEvidence);
  if (writes.length !== 3) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} write set is not exact.`);
  findWrite(writes, readback.protocolConfig, 'MUTATED', `${label}.protocolConfig`);
  findWrite(writes, readback.protocolAdminCap, 'MUTATED', `${label}.protocolAdminCap`);
  findWrite(writes, readback.protocolTreasury, 'CREATED', `${label}.protocolTreasury`);
  assertProtocolInitEvents(readback, finalityEvidence, corePackageId, signer);
  return readback;
}

function assertAttestedObject(object, fields, label) {
  exactFields(object, fields, label);
  boundedText(object.schemaVersion, `${label}.schemaVersion`, 256);
  if (object.network !== 'mainnet') fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not Mainnet.`);
  assertFullId(object.objectId, `${label}.objectId`);
  assertMainnetV8Decimal(object.version, `${label}.version`, { positive: true });
  assertSuiDigest(object.digest, `${label}.digest`);
  boundedText(object.type, `${label}.type`, 16 * 1024);
  assertMainnetV8DeterministicJson(object.owner, `${label}.owner`);
  if (!isPlain(object.fields) || !isPlain(object.objectRef)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} fields/objectRef are invalid.`);
  }
  assertObjectReference(object.objectRef, `${label}.objectRef`);
  if (object.objectRef.objectId !== object.objectId || object.objectRef.version !== object.version
    || object.objectRef.digest !== object.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.objectRef differs from its object identity.`);
  }
}

function moveStructFields(value, label) {
  const fields = isPlain(value?.fields) ? value.fields : value;
  if (!isPlain(fields)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} is not one exact Move struct field record.`);
  }
  return fields;
}

function rawBridgeFields(value, label, fromMove) {
  if (fromMove) return moveStructFields(value, label);
  if (!isPlain(value)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw BCS is not one exact struct.`);
  }
  return value;
}

function rawBridgeId(value, label, fromMove) {
  return fromMove ? moveObjectId(value, label) : assertFullId(value, label);
}

function rawBridgeDecimal(value, label, fromMove) {
  if (fromMove) return moveDecimal(value, label);
  const normalized = String(value);
  assertMainnetV8Decimal(normalized, label);
  return normalized;
}

function normalizeRawCallCap(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    version: rawBridgeDecimal(fields.version, `${label}.version`, fromMove),
    authorityId: rawBridgeId(fields.authority_id, `${label}.authority_id`, fromMove),
    catalogId: rawBridgeId(fields.catalog_id, `${label}.catalog_id`, fromMove),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment, `${label}.product_binding_commitment`,
    ),
    roleBindingCommitment: moveHash(
      fields.role_binding_commitment, `${label}.role_binding_commitment`,
    ),
    callCapSetCommitment: moveHash(
      fields.call_cap_set_commitment, `${label}.call_cap_set_commitment`,
    ),
  };
}

function normalizeRawExactBinding(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    originalPackageId: rawBridgeId(
      fields.original_package_id, `${label}.original_package_id`, fromMove,
    ),
    callablePackageId: rawBridgeId(
      fields.callable_package_id, `${label}.callable_package_id`, fromMove,
    ),
    sourceCommitment: moveHash(fields.source_commitment, `${label}.source_commitment`),
    packageCommitment: moveHash(fields.package_commitment, `${label}.package_commitment`),
    abiCommitment: moveHash(fields.abi_commitment, `${label}.abi_commitment`),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  };
}

function normalizeRawProductBinding(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    version: rawBridgeDecimal(fields.version, `${label}.version`, fromMove),
    nativeCapabilityMask: rawBridgeDecimal(
      fields.native_capability_mask, `${label}.native_capability_mask`, fromMove,
    ),
    roles: Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role) => [
      role, normalizeRawExactBinding(fields[role], `${label}.${role}`, fromMove),
    ])),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  };
}

function normalizeRawCallCapSet(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    version: rawBridgeDecimal(fields.version, `${label}.version`, fromMove),
    catalogId: rawBridgeId(fields.catalog_id, `${label}.catalog_id`, fromMove),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment, `${label}.product_binding_commitment`,
    ),
    authorities: Object.fromEntries(MAINNET_V8_ROLE_ORDER.slice(1).map((role) => [
      role,
      rawBridgeId(fields[`${role}_authority_id`], `${label}.${role}_authority_id`, fromMove),
    ])),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  };
}

function normalizeRawOptionalCallCap(value, label, fromMove) {
  if (!fromMove) return value === null ? null : normalizeRawCallCap(value, label, false);
  if (!Array.isArray(value) || value.length > 1) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} must be one exact Move Option<PackageCallCapV8>.`);
  }
  return value.length === 0 ? null : normalizeRawCallCap(value[0], label, true);
}

function normalizeRawCatalog(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    id: rawBridgeId(fields.id, `${label}.id`, fromMove),
    version: rawBridgeDecimal(fields.version, `${label}.version`, fromMove),
    protocolConfigId: rawBridgeId(
      fields.protocol_config_id, `${label}.protocol_config_id`, fromMove,
    ),
    protocolConfigRevision: rawBridgeDecimal(
      fields.protocol_config_revision, `${label}.protocol_config_revision`, fromMove,
    ),
    protocolConfigCommitment: moveHash(
      fields.protocol_config_commitment, `${label}.protocol_config_commitment`,
    ),
    binding: normalizeRawProductBinding(fields.binding, `${label}.binding`, fromMove),
    callCapSet: normalizeRawCallCapSet(fields.call_cap_set, `${label}.call_cap_set`, fromMove),
    callCaps: Object.fromEntries(MAINNET_V8_ROLE_ORDER.slice(1).map((role) => [
      role,
      normalizeRawOptionalCallCap(
        fields[`${role}_call_cap`], `${label}.${role}_call_cap`, fromMove,
      ),
    ])),
  };
}

function assertBootstrapCatalogRawBcs(output) {
  const label = 'Bootstrap ProductReleaseCatalogV8';
  const parsed = parseExactMoveContent(output, PRODUCT_RELEASE_CATALOG_BCS, label);
  const fromBcs = normalizeRawCatalog(parsed, `${label}.bcs`, false);
  const fromMove = normalizeRawCatalog(output.fields, `${label}.fields`, true);
  if (fromBcs.id !== output.reference.objectId
    || canonicalMainnetV8Json(fromBcs) !== canonicalMainnetV8Json(fromMove)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return fromBcs;
}

function normalizeRawConfigBase(value, label, fromMove, callCapSet) {
  const fields = rawBridgeFields(value, label, fromMove);
  const normalized = {
    id: rawBridgeId(fields.id, `${label}.id`, fromMove),
    version: rawBridgeDecimal(fields.version, `${label}.version`, fromMove),
    catalogId: rawBridgeId(fields.catalog_id, `${label}.catalog_id`, fromMove),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment, `${label}.product_binding_commitment`,
    ),
  };
  if (callCapSet) {
    normalized.callCapSetCommitment = moveHash(
      fields.call_cap_set_commitment, `${label}.call_cap_set_commitment`,
    );
  }
  return { fields, normalized };
}

function assertBootstrapCompanionRawBcs(output, role) {
  const label = `Bootstrap ${role} package config`;
  const simple = ['runtime', 'output'].includes(role);
  const schema = simple ? SIMPLE_PACKAGE_CONFIG_BCS : BOUND_PACKAGE_CONFIG_BCS;
  const parsed = parseExactMoveContent(output, schema, label);
  const bcsBase = normalizeRawConfigBase(parsed, `${label}.bcs`, false, !simple);
  const moveBase = normalizeRawConfigBase(output.fields, `${label}.fields`, true, !simple);
  const fromBcs = {
    ...bcsBase.normalized,
    callCap: normalizeRawCallCap(parsed.call_cap, `${label}.bcs.${role}_call_cap`, false),
  };
  const fromMove = {
    ...moveBase.normalized,
    callCap: normalizeRawCallCap(
      moveBase.fields[`${role}_call_cap`], `${label}.fields.${role}_call_cap`, true,
    ),
  };
  if (fromBcs.id !== output.reference.objectId
    || canonicalMainnetV8Json(fromBcs) !== canonicalMainnetV8Json(fromMove)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return fromBcs;
}

function normalizeRawKeyServer(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    objectId: rawBridgeId(fields.key_server_id, `${label}.key_server_id`, fromMove),
    weight: rawBridgeDecimal(fields.weight, `${label}.weight`, fromMove),
  };
}

function normalizeRawSealConfig(value, label, fromMove) {
  const fields = rawBridgeFields(value, label, fromMove);
  return {
    id: rawBridgeId(fields.id, `${label}.id`, fromMove),
    version: rawBridgeDecimal(fields.version, `${label}.version`, fromMove),
    protocolConfigId: rawBridgeId(
      fields.protocol_config_id, `${label}.protocol_config_id`, fromMove,
    ),
    protocolConfigRevision: rawBridgeDecimal(
      fields.protocol_config_revision, `${label}.protocol_config_revision`, fromMove,
    ),
    catalogId: rawBridgeId(fields.catalog_id, `${label}.catalog_id`, fromMove),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment, `${label}.product_binding_commitment`,
    ),
    sealOriginalPackageId: rawBridgeId(
      fields.seal_original_package_id, `${label}.seal_original_package_id`, fromMove,
    ),
    sealCallablePackageId: rawBridgeId(
      fields.seal_callable_package_id, `${label}.seal_callable_package_id`, fromMove,
    ),
    sealBindingCommitment: moveHash(
      fields.seal_binding_commitment, `${label}.seal_binding_commitment`,
    ),
    sealAuthorityId: rawBridgeId(
      fields.seal_authority_id, `${label}.seal_authority_id`, fromMove,
    ),
    callCapSetCommitment: moveHash(
      fields.call_cap_set_commitment, `${label}.call_cap_set_commitment`,
    ),
    callCap: normalizeRawCallCap(fields.seal_call_cap, `${label}.seal_call_cap`, fromMove),
    keyServers: fields.key_servers.map((entry, index) => normalizeRawKeyServer(
      entry, `${label}.key_servers[${index}]`, fromMove,
    )),
    threshold: rawBridgeDecimal(fields.threshold, `${label}.threshold`, fromMove),
    keyServerSetCommitment: moveHash(
      fields.key_server_set_commitment, `${label}.key_server_set_commitment`,
    ),
    encryptionPolicyCommitment: moveHash(
      fields.encryption_policy_commitment, `${label}.encryption_policy_commitment`,
    ),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  };
}

function assertBootstrapSealRawBcs(output) {
  const label = 'Bootstrap SealPolicyConfigV8';
  const parsed = parseExactMoveContent(output, SEAL_POLICY_CONFIG_BCS, label);
  const fromBcs = normalizeRawSealConfig(parsed, `${label}.bcs`, false);
  const fromMove = normalizeRawSealConfig(output.fields, `${label}.fields`, true);
  if (fromBcs.id !== output.reference.objectId
    || canonicalMainnetV8Json(fromBcs) !== canonicalMainnetV8Json(fromMove)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} raw historical BCS differs from decoded fields.`);
  }
  return fromBcs;
}

function assertAttestedOutputIdentity(attested, output, label) {
  if (attested.objectId !== output.reference.objectId
    || attested.version !== output.reference.version
    || attested.digest !== output.reference.digest
    || attested.type !== output.type
    || canonicalMainnetV8Json(attested.fields) !== canonicalMainnetV8Json(output.fields)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} differs from the exact finalized output.`);
  }
}

function assertBootstrapCatalogFields(attestation, runtimeConfig, output) {
  const catalog = attestation.catalog;
  const label = 'Bootstrap attestation.catalog.fields';
  const fields = moveStructFields(catalog.fields, label);
  exactFields(fields, PRODUCT_RELEASE_CATALOG_MOVE_FIELDS, label);
  if (moveObjectId(fields.id, `${label}.id`) !== catalog.objectId
    || moveDecimal(fields.version, `${label}.version`) !== '8'
    || moveObjectId(fields.protocol_config_id, `${label}.protocol_config_id`)
      !== runtimeConfig.protocolConfigId
    || moveDecimal(fields.protocol_config_revision, `${label}.protocol_config_revision`) !== '2') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap catalog protocol identity is invalid.');
  }
  const protocolCommitment = moveHash(
    fields.protocol_config_commitment, `${label}.protocol_config_commitment`,
  );
  if (catalog.protocolConfigRevision !== '2'
    || catalog.protocolConfigCommitment !== protocolCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap catalog protocol snapshot drifted.');
  }
  const binding = moveStructFields(fields.binding, `${label}.binding`);
  exactFields(binding, PRODUCT_BINDING_MOVE_FIELDS, `${label}.binding`);
  if (moveDecimal(binding.version, `${label}.binding.version`) !== '8'
    || moveDecimal(binding.native_capability_mask, `${label}.binding.native_capability_mask`) !== '127') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap catalog is not the complete native v8 binding.');
  }
  MAINNET_V8_ROLE_ORDER.forEach((role) => {
    const row = moveStructFields(binding[role], `${label}.binding.${role}`);
    const attested = catalog.roles[role];
    exactFields(row, EXACT_BINDING_MOVE_FIELDS, `${label}.binding.${role}`);
    if (moveObjectId(row.original_package_id, `${label}.binding.${role}.original_package_id`)
        !== attested.originalPackageId
      || moveObjectId(row.callable_package_id, `${label}.binding.${role}.callable_package_id`)
        !== attested.callablePackageId
      || moveHash(row.source_commitment, `${label}.binding.${role}.source_commitment`)
        !== attested.sourceCommitment
      || moveHash(row.package_commitment, `${label}.binding.${role}.package_commitment`)
        !== attested.packageCommitment
      || moveHash(row.abi_commitment, `${label}.binding.${role}.abi_commitment`)
        !== attested.abiCommitment
      || moveHash(row.commitment, `${label}.binding.${role}.commitment`) !== attested.commitment) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap catalog ${role} raw binding drifted.`);
    }
  });
  if (moveHash(binding.commitment, `${label}.binding.commitment`)
    !== catalog.productBindingCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap catalog product commitment drifted.');
  }
  const callCaps = moveStructFields(fields.call_cap_set, `${label}.call_cap_set`);
  exactFields(callCaps, CALL_CAP_SET_MOVE_FIELDS, `${label}.call_cap_set`);
  if (moveDecimal(callCaps.version, `${label}.call_cap_set.version`) !== '8'
    || moveObjectId(callCaps.catalog_id, `${label}.call_cap_set.catalog_id`) !== catalog.objectId
    || moveHash(callCaps.product_binding_commitment, `${label}.call_cap_set.product_binding_commitment`)
      !== catalog.productBindingCommitment
    || moveHash(callCaps.commitment, `${label}.call_cap_set.commitment`)
      !== catalog.callCapSetCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap catalog call-cap set drifted.');
  }
  const authorities = MAINNET_V8_ROLE_ORDER.slice(1).map((role) => {
    const value = moveObjectId(
      callCaps[`${role}_authority_id`], `${label}.call_cap_set.${role}_authority_id`,
    );
    if (value !== catalog.authorities[role]
      || !Array.isArray(fields[`${role}_call_cap`])
      || fields[`${role}_call_cap`].length !== 0) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap catalog ${role} authority/cap state drifted.`);
    }
    return value;
  });
  if (new Set(authorities).size !== authorities.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap catalog authority IDs collide.');
  }
  assertAttestedOutputIdentity(catalog, output, 'Bootstrap attested catalog');
}

function assertBootstrapCallCap(value, role, catalog, label) {
  const fields = moveStructFields(value, label);
  exactFields(fields, PACKAGE_CALL_CAP_MOVE_FIELDS, label);
  if (moveDecimal(fields.version, `${label}.version`) !== '8'
    || moveObjectId(fields.authority_id, `${label}.authority_id`) !== catalog.authorities[role]
    || moveObjectId(fields.catalog_id, `${label}.catalog_id`) !== catalog.objectId
    || moveHash(fields.product_binding_commitment, `${label}.product_binding_commitment`)
      !== catalog.productBindingCommitment
    || moveHash(fields.role_binding_commitment, `${label}.role_binding_commitment`)
      !== catalog.roles[role].commitment
    || moveHash(fields.call_cap_set_commitment, `${label}.call_cap_set_commitment`)
      !== catalog.callCapSetCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap ${role} installed call cap drifted.`);
  }
}

function assertBootstrapConfigFields(attestation, readback, runtimeConfig, role) {
  const entry = attestation.configs[role];
  const output = readback.configs[role];
  const label = `Bootstrap attestation.configs.${role}.fields`;
  const fields = moveStructFields(entry.fields, label);
  const simple = ['runtime', 'output'].includes(role);
  const expected = role === 'seal'
    ? SEAL_CONFIG_MOVE_FIELDS
    : [...SIMPLE_CONFIG_MOVE_FIELDS, ...(simple ? [] : ['call_cap_set_commitment']), `${role}_call_cap`];
  exactFields(fields, expected, label);
  if (moveObjectId(fields.id, `${label}.id`) !== entry.objectId
    || moveDecimal(fields.version, `${label}.version`) !== '8'
    || moveObjectId(fields.catalog_id, `${label}.catalog_id`) !== attestation.catalog.objectId
    || moveHash(fields.product_binding_commitment, `${label}.product_binding_commitment`)
      !== attestation.catalog.productBindingCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap ${role} config identity drifted.`);
  }
  if (!simple && moveHash(fields.call_cap_set_commitment, `${label}.call_cap_set_commitment`)
    !== attestation.catalog.callCapSetCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap ${role} call-cap-set binding drifted.`);
  }
  assertBootstrapCallCap(
    fields[`${role}_call_cap`], role, attestation.catalog, `${label}.${role}_call_cap`,
  );
  if (role === 'seal') {
    if (moveObjectId(fields.protocol_config_id, `${label}.protocol_config_id`)
        !== runtimeConfig.protocolConfigId
      || moveDecimal(fields.protocol_config_revision, `${label}.protocol_config_revision`) !== '2'
      || moveObjectId(fields.seal_original_package_id, `${label}.seal_original_package_id`)
        !== runtimeConfig.roles.seal.typeOriginPackageId
      || moveObjectId(fields.seal_callable_package_id, `${label}.seal_callable_package_id`)
        !== runtimeConfig.roles.seal.callablePackageId
      || moveHash(fields.seal_binding_commitment, `${label}.seal_binding_commitment`)
        !== attestation.catalog.roles.seal.commitment
      || moveObjectId(fields.seal_authority_id, `${label}.seal_authority_id`)
        !== attestation.catalog.authorities.seal
      || moveHash(fields.commitment, `${label}.commitment`) !== readback.sealPolicyCommitment) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap Seal config immutable bindings drifted.');
    }
    if (!Array.isArray(fields.key_servers) || fields.key_servers.length < 1) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap Seal config has no key-server bindings.');
    }
    fields.key_servers.forEach((value, index) => {
      const row = moveStructFields(value, `${label}.key_servers[${index}]`);
      exactFields(row, MOVE_KEY_SERVER_FIELDS, `${label}.key_servers[${index}]`);
      moveObjectId(row.key_server_id, `${label}.key_servers[${index}].key_server_id`);
      moveDecimal(row.weight, `${label}.key_servers[${index}].weight`);
    });
    moveDecimal(fields.threshold, `${label}.threshold`);
    moveHash(fields.key_server_set_commitment, `${label}.key_server_set_commitment`);
    moveHash(fields.encryption_policy_commitment, `${label}.encryption_policy_commitment`);
  }
  assertAttestedOutputIdentity(entry, output, `Bootstrap attested ${role} config`);
}

function assertRuntimeAttestation(attestation, runtimeConfig, readback) {
  exactFields(attestation, ATTESTATION_FIELDS, 'Bootstrap attestation');
  assertAttestedObject(attestation.catalog, ATTESTED_CATALOG_FIELDS, 'Bootstrap attestation.catalog');
  if (attestation.catalog.objectId !== runtimeConfig.catalogId) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap attested catalog differs from runtimeConfig.');
  }
  exactFields(attestation.catalog.roles, MAINNET_V8_ROLE_ORDER, 'Bootstrap attestation.catalog.roles');
  MAINNET_V8_ROLE_ORDER.forEach((role) => {
    const entry = attestation.catalog.roles[role];
    exactFields(entry, ATTESTED_ROLE_FIELDS, `Bootstrap attestation.catalog.roles.${role}`);
    if (entry.role !== role
      || entry.originalPackageId !== runtimeConfig.roles[role].typeOriginPackageId
      || entry.callablePackageId !== runtimeConfig.roles[role].callablePackageId) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap attested ${role} package identity drifted.`);
    }
    ['sourceCommitment', 'packageCommitment', 'abiCommitment', 'commitment']
      .forEach((field) => assertHash(entry[field], `Bootstrap attested ${role}.${field}`));
  });
  assertBootstrapCatalogFields(attestation, runtimeConfig, readback.catalog);
  const companionRoles = MAINNET_V8_ROLE_ORDER.slice(1);
  exactFields(attestation.configs, companionRoles, 'Bootstrap attestation.configs');
  companionRoles.forEach((role) => {
    const entry = attestation.configs[role];
    assertAttestedObject(entry, ATTESTED_CONFIG_FIELDS, `Bootstrap attestation.configs.${role}`);
    if (entry.role !== role || entry.objectId !== runtimeConfig.roleConfigIds[role]) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap attested ${role} config identity drifted.`);
    }
    assertBootstrapConfigFields(attestation, readback, runtimeConfig, role);
  });
  if (!Array.isArray(attestation.packageTuple)
    || attestation.packageTuple.length !== MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap attested package tuple is incomplete.');
  }
  attestation.packageTuple.forEach((entry, index) => {
    const role = MAINNET_V8_ROLE_ORDER[index];
    exactFields(entry, PACKAGE_TUPLE_FIELDS, `Bootstrap attestation.packageTuple[${index}]`);
    if (entry.role !== role
      || entry.originalPackageId !== runtimeConfig.roles[role].typeOriginPackageId
      || entry.callablePackageId !== runtimeConfig.roles[role].callablePackageId) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap package tuple ${role} identity drifted.`);
    }
    assertSuiDigest(entry.packageDigest, `Bootstrap package tuple ${role}.packageDigest`);
  });
  exactFields(attestation.coreArtifact, CORE_ARTIFACT_FIELDS, 'Bootstrap attestation.coreArtifact');
  assertHash(attestation.coreArtifact.baseRegistryModuleSha256, 'Bootstrap coreArtifact.baseRegistryModuleSha256');
  assertSuiDigest(attestation.coreArtifact.packageDigest, 'Bootstrap coreArtifact.packageDigest');
  if (attestation.coreArtifact.callablePackageId !== attestation.packageTuple[0].callablePackageId
    || attestation.coreArtifact.packageDigest !== attestation.packageTuple[0].packageDigest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap core artifact differs from its package tuple.');
  }
}

function assertReleaseCommitments(readback) {
  const commitments = readback.releaseCommitments;
  exactFields(commitments, RELEASE_COMMITMENTS_FIELDS, 'Bootstrap releaseCommitments');
  exactFields(commitments.roles, MAINNET_V8_ROLE_ORDER, 'Bootstrap releaseCommitments.roles');
  const markerTypes = {
    core: ['protocol_config_v8', 'CorePackageMarkerV8', 'CorePackageMarkerV8'],
    seal: ['seal_v8', 'SealOriginalMarkerV8', 'SealCallableMarkerV8'],
    runtime: ['runtime_v8', 'RuntimeOriginalMarkerV8', 'RuntimeCallableMarkerV8'],
    output: ['output_v8', 'OutputOriginalMarkerV8', 'OutputCallableMarkerV8'],
    physical: ['physical_v8', 'PhysicalOriginalMarkerV8', 'PhysicalCallableMarkerV8'],
    market: ['market_v8', 'MarketOriginalMarkerV8', 'MarketCallableMarkerV8'],
    release: ['release_v8', 'ReleaseOriginalMarkerV8', 'ReleaseCallableMarkerV8'],
  };
  MAINNET_V8_ROLE_ORDER.forEach((role) => {
    const entry = commitments.roles[role];
    const attested = readback.attestation.catalog.roles[role];
    exactFields(entry, RELEASE_COMMITMENT_ROLE_FIELDS, `Bootstrap releaseCommitments.roles.${role}`);
    for (const field of ['originalPackageId', 'callablePackageId']) {
      assertFullId(entry[field], `Bootstrap releaseCommitments.roles.${role}.${field}`);
    }
    for (const field of [
      'sourceCommitment', 'packageCommitment', 'abiCommitment', 'bindingCommitment',
    ]) assertHash(entry[field], `Bootstrap releaseCommitments.roles.${role}.${field}`);
    const [module, original, callable] = markerTypes[role];
    if (entry.originalPackageId !== readback.runtimeConfig.roles[role].typeOriginPackageId
      || entry.callablePackageId !== readback.runtimeConfig.roles[role].callablePackageId
      || entry.originalMarkerType !== `${entry.originalPackageId}::${module}::${original}`
      || entry.callableMarkerType !== `${entry.callablePackageId}::${module}::${callable}`
      || entry.sourceCommitment !== attested.sourceCommitment
      || entry.packageCommitment !== attested.packageCommitment
      || entry.abiCommitment !== attested.abiCommitment
      || entry.bindingCommitment !== attested.commitment) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap ${role} release commitments drifted.`);
    }
  });
  const companionRoles = MAINNET_V8_ROLE_ORDER.slice(1);
  exactFields(commitments.authorities, companionRoles, 'Bootstrap releaseCommitments.authorities');
  companionRoles.forEach((role) => {
    assertFullId(commitments.authorities[role], `Bootstrap releaseCommitments.authorities.${role}`);
    if (commitments.authorities[role] !== readback.attestation.catalog.authorities[role]) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `Bootstrap ${role} authority commitment drifted.`);
    }
  });
  assertHash(commitments.productBindingCommitment, 'Bootstrap productBindingCommitment');
  assertHash(commitments.callCapSetCommitment, 'Bootstrap callCapSetCommitment');
  if (commitments.productBindingCommitment !== readback.attestation.catalog.productBindingCommitment
    || commitments.callCapSetCommitment !== readback.attestation.catalog.callCapSetCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap aggregate release commitments drifted.');
  }
}

function assertBootstrapEvent(readback, finalityEvidence, signer) {
  exactFields(readback.events, SEAL_POLICY_EVENT_FIELDS, 'Bootstrap events');
  const events = parsedFinalityEvents(finalityEvidence, 'Bootstrap');
  if (events.length !== 1) fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap must contain exactly one event.');
  const sealPackageId = readback.runtimeConfig.roles.seal.callablePackageId;
  assertEventEnvelope(events[0], {
    packageId: sealPackageId, signer, module: 'seal_v8', name: 'SealPolicyCreatedV8',
  }, 'Bootstrap SealPolicyCreatedV8');
  const contents = Uint8Array.from(events[0].contents);
  let parsed;
  let roundtrip;
  try {
    parsed = SEAL_POLICY_CREATED_EVENT_BCS.parse(contents);
    roundtrip = SEAL_POLICY_CREATED_EVENT_BCS.serialize(parsed).toBytes();
  } catch {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap SealPolicyCreatedV8 contains invalid BCS.');
  }
  if (!sameBytes(contents, roundtrip)
    || canonicalMainnetV8Json(canonicalBcsJson(parsed))
      !== canonicalMainnetV8Json(readback.events)) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap SealPolicyCreatedV8 summary differs from raw BCS.');
  }
  assertHash(readback.sealPolicyCommitment, 'Bootstrap sealPolicyCommitment');
  if (parsed.config_id !== readback.configs.seal.reference.objectId
    || parsed.catalog_id !== readback.catalog.reference.objectId
    || Buffer.from(parsed.commitment).toString('hex') !== readback.sealPolicyCommitment) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap Seal policy event differs from exact outputs.');
  }
}

function assertBootstrapCertificate(readback, finalityEvidence, signer = null) {
  const label = 'Bootstrap readback';
  exactFields(readback, BOOTSTRAP_CERTIFICATE_FIELDS, label);
  if (readback.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA
    || readback.kind !== 'BOOTSTRAP_CERTIFICATE'
    || readback.transactionDigest !== finalityEvidence.digest) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} identity differs from finality.`);
  }
  exactFields(readback.runtimeConfig, RUNTIME_CONFIG_FIELDS, `${label}.runtimeConfig`);
  const runtime = readback.runtimeConfig;
  if (runtime.schemaVersion !== 'animacraft.maker-v8-runtime.v8'
    || runtime.protocolVersion !== 8 || runtime.enabled !== true
    || runtime.paymentCoinType !== MAINNET_V8_PAYMENT_COIN_TYPE
    || runtime.clockObjectId !== normalizeMainnetV8ObjectId('0x6')
    || !Array.isArray(runtime.makerBindings) || runtime.makerBindings.length !== 0) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.runtimeConfig root fields are invalid.`);
  }
  for (const field of ['catalogId', 'protocolConfigId', 'protocolTreasuryId']) {
    assertFullId(runtime[field], `${label}.runtimeConfig.${field}`);
  }
  exactFields(runtime.roles, MAINNET_V8_ROLE_ORDER, `${label}.runtimeConfig.roles`);
  MAINNET_V8_ROLE_ORDER.forEach((role) => {
    exactFields(runtime.roles[role], RUNTIME_ROLE_FIELDS, `${label}.runtimeConfig.roles.${role}`);
    assertFullId(runtime.roles[role].typeOriginPackageId, `${label}.runtimeConfig.roles.${role}.typeOriginPackageId`);
    assertFullId(runtime.roles[role].callablePackageId, `${label}.runtimeConfig.roles.${role}.callablePackageId`);
    if (runtime.roles[role].typeOriginPackageId !== runtime.roles[role].callablePackageId) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} must bind fresh identical original/callable package IDs.`);
    }
  });
  const companionRoles = MAINNET_V8_ROLE_ORDER.slice(1);
  exactFields(runtime.roleConfigIds, companionRoles, `${label}.runtimeConfig.roleConfigIds`);
  companionRoles.forEach((role) => assertFullId(
    runtime.roleConfigIds[role], `${label}.runtimeConfig.roleConfigIds.${role}`,
  ));
  assertMoveOutput(readback.catalog, `${label}.catalog`, finalityEvidence.digest);
  if (readback.catalog.reference.objectId !== runtime.catalogId
    || readback.catalog.type !== `${runtime.roles.core.callablePackageId}::package_binding_v8::ProductReleaseCatalogV8`
    || !Object.hasOwn(readback.catalog.owner, 'Shared')) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.catalog identity is invalid.`);
  }
  exactFields(readback.configs, companionRoles, `${label}.configs`);
  const configTypes = {
    seal: 'seal_v8::SealPolicyConfigV8',
    runtime: 'runtime_binding_v8::RuntimePackageConfigV8',
    output: 'output_v8::OutputPackageConfigV8',
    physical: 'physical_v8::PhysicalPackageConfigV8',
    market: 'market_v8::MarketPackageConfigV8',
    release: 'release_v8::ReleasePackageConfigV8',
  };
  companionRoles.forEach((role) => {
    const output = readback.configs[role];
    assertMoveOutput(output, `${label}.configs.${role}`, finalityEvidence.digest);
    if (output.reference.objectId !== runtime.roleConfigIds[role]
      || output.type !== `${runtime.roles[role].callablePackageId}::${configTypes[role]}`
      || !Object.hasOwn(output.owner, 'Shared')) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.configs.${role} identity is invalid.`);
    }
  });
  const outputs = [readback.catalog, ...companionRoles.map((role) => readback.configs[role])];
  const writes = finalityWrites(finalityEvidence);
  if (writes.length !== 7 || writes.some((entry) => entry.operation !== 'CREATED')) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} write set is not exact.`);
  }
  outputs.forEach((output, index) => findWrite(writes, output, 'CREATED', `${label}.outputs[${index}]`));
  if (new Set(outputs.map((output) => output.reference.objectId)).size !== 7) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} output identities collide.`);
  }
  assertRuntimeAttestation(readback.attestation, runtime, readback);
  const rawCatalog = assertBootstrapCatalogRawBcs(readback.catalog);
  const rawConfigs = Object.fromEntries(companionRoles.map((role) => [
    role,
    role === 'seal'
      ? assertBootstrapSealRawBcs(readback.configs[role])
      : assertBootstrapCompanionRawBcs(readback.configs[role], role),
  ]));
  if (rawCatalog.version !== '8' || rawCatalog.binding.version !== '8'
    || rawCatalog.binding.nativeCapabilityMask !== '127'
    || rawCatalog.callCapSet.version !== '8'
    || Object.values(rawConfigs).some((config) => config.version !== '8')) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Bootstrap raw historical BCS has an unsupported version/capability mask.');
  }
  assertReleaseCommitments(readback);
  assertBootstrapEvent(readback, finalityEvidence, signer);
  return readback;
}

function assertStageReadback(readback, ordinal, finalityEvidence, details, signer = null) {
  if (BigInt(ordinal) < BigInt(MAINNET_V8_ROLE_ORDER.length)) {
    return assertPackagePublishCertificate(readback, ordinal, finalityEvidence, details, signer);
  }
  if (ordinal === '7') return assertProtocolInitCertificate(readback, finalityEvidence, signer);
  if (ordinal === '8') return assertBootstrapCertificate(readback, finalityEvidence, signer);
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
    assertStageReadback(certificate.readback, ordinal, certificate.finalityEvidence, details);
  } else if (certificate.readback !== null || certificate.readbackSha256 !== null) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label} failure cannot claim successful readback.`);
  }
  return certificate;
}

function assertFinalPackageVerification(value, label) {
  exactFields(value, FINAL_PACKAGE_VERIFICATION_FIELDS, label);
  if (value.kind !== 'FINAL_PACKAGE_REBUILD_VERIFICATION') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.kind is invalid.`);
  }
  assertHash(value.executionPlanId, `${label}.executionPlanId`);
  assertHash(value.releaseId, `${label}.releaseId`);
  if (!Array.isArray(value.packages) || value.packages.length !== MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.packages must contain exactly seven roles.`);
  }
  value.packages.forEach((entry, index) => {
    exactFields(entry, FINAL_PACKAGE_VERIFICATION_ROW_FIELDS, `${label}.packages[${index}]`);
    if (entry.role !== MAINNET_V8_ROLE_ORDER[index]) {
      fail('MAINNET_V8_WAL_EVIDENCE_INVALID', `${label}.packages[${index}].role is invalid.`);
    }
    assertFullId(entry.packageId, `${label}.packages[${index}].packageId`);
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
  const publish = BigInt(ordinal) < BigInt(MAINNET_V8_ROLE_ORDER.length);
  if (status === 'FINALIZED_SUCCESS') {
    if (ordinal === '9') {
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
    if (ordinal === '9') {
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
  if (cursor.ordinal === '9') {
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
  if (['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(status) && cursor.ordinal === '9') {
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

export function buildMainnetV8ManifestEvidence({
  ordinal = '6', attempt = '0', finalManifest, plan,
}) {
  const cursor = walCursor(ordinal, attempt);
  if (cursor.ordinal !== '6') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'Final manifest can only be sealed after package ordinal 6.');
  }
  assertMainnetV8FinalManifest(finalManifest, plan);
  return deepFreeze({
    schemaVersion: MAINNET_V8_WAL_EVIDENCE_SCHEMA,
    kind: 'FINAL_MANIFEST_SEALED',
    cursor,
    finalManifest: cloneJson(finalManifest),
    releaseId: finalManifest.releaseId,
  });
}

export function buildMainnetV8AbandonEvidence({
  ordinal = '6', attempt = '0', finalManifest, plan, reason,
}) {
  const cursor = walCursor(ordinal, attempt);
  if (cursor.ordinal !== '6') {
    fail('MAINNET_V8_WAL_EVIDENCE_INVALID', 'A sealed release can only be abandoned at package ordinal 6.');
  }
  assertMainnetV8FinalManifest(finalManifest, plan);
  exactFields(reason, WAL_ABANDON_REASON_FIELDS, 'RELEASE_ABANDONED reason');
  exactFields(reason.moveAbort, WAL_ABANDON_MOVE_ABORT_FIELDS, 'RELEASE_ABANDONED moveAbort');
  if (reason.code !== 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH'
    || reason.failedOrdinal !== '7'
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

function assertWalEvidence(event) {
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
    if (event.ordinal === '9') {
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
      || evidence.reason.failedOrdinal !== '7'
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
  if (['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(event.status) && event.ordinal === '9') {
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
    .includes(event.status) && event.ordinal !== '9') {
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
  if (BigInt(event.ordinal) < BigInt(MAINNET_V8_ROLE_ORDER.length)
    && ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(event.status)) {
    assertMainnetV8PublishPackageEvidence(evidence.observation.details, event.ordinal, {
      requireAbi: event.status === 'FINALIZED_SUCCESS',
    });
  }
  if (event.status === 'FINALIZED_SUCCESS' && event.ordinal !== '9') {
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

function assertWalTransition(previous, current) {
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
    && previous.ordinal !== '9'
    && [
      'MAINNET_V8_CREATED_OUTPUT_INVALID',
      'MAINNET_V8_PACKAGE_BYTES_DRIFT',
      'MAINNET_V8_INIT_WRITE_SET_INVALID',
    ]
      .includes(previousIncident.incident.code)
    && previousIncident.finalityEvidenceSha256 === currentPending.finalityEvidenceSha256
    && canonicalMainnetV8Json(previousIncident.finalityEvidence)
      === canonicalMainnetV8Json(currentPending.finalityEvidence);
  const valid = previous.status === 'READY' && previous.ordinal !== '9'
      && current.status === 'SIGNED' && sameCursor
    || previous.status === 'READY' && previous.ordinal === '9'
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
    || previous.status === 'FINALIZED_SUCCESS' && previous.ordinal === '6'
      && current.status === 'FINAL_MANIFEST_SEALED' && sameCursor
    || previous.status === 'FINAL_MANIFEST_SEALED'
      && current.status === 'RELEASE_ABANDONED' && sameCursor
    || previous.status === 'FINAL_MANIFEST_SEALED' && current.status === 'READY'
      && current.ordinal === '7' && current.attempt === '0'
    || previous.status === 'FINALIZED_SUCCESS' && previous.ordinal !== '6'
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
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_WAL_INVALID', 'Publish evidence ordinal is outside the seven package steps.');
  }
  const role = MAINNET_V8_ROLE_ORDER[index];
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
  assertMainnetV8FinalManifest(manifest, plan);
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
      || entry.role !== MAINNET_V8_ROLE_ORDER[index]
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

function sharedReferenceFromCertifiedOutput(output, label) {
  const initialSharedVersion = output?.owner?.Shared?.initial_shared_version;
  if (initialSharedVersion === undefined) {
    fail('MAINNET_V8_WAL_INVALID', `${label} is not one certified shared object.`);
  }
  return {
    objectId: output.reference.objectId,
    initialSharedVersion,
  };
}

function ownedReferenceFromCertifiedOutput(output, label) {
  if (!output?.reference || !Object.hasOwn(output.owner ?? {}, 'AddressOwner')) {
    fail('MAINNET_V8_WAL_INVALID', `${label} is not one certified owned object.`);
  }
  return cloneJson(output.reference);
}

function assertStageReadyWalContext(event, wal, sealedManifest, successfulCertificates) {
  const ordinal = Number(event.ordinal);
  if (ordinal < 7) return;
  if (!sealedManifest || wal.releaseId !== sealedManifest.releaseId) {
    fail('MAINNET_V8_WAL_INVALID', `READY ordinal ${ordinal} has no sealed final manifest.`);
  }
  const stageData = event.evidence.readyArtifact.stageData;
  if (ordinal === 9) {
    const bootstrap = successfulCertificates.get('8')?.details?.certificate;
    const expected = {
      releaseId: wal.releaseId,
      finalManifestSha256: sha256MainnetV8Json(sealedManifest),
      bootstrapCertificateSha256: bootstrap?.readbackSha256,
      exportFilename: stageData.exportFilename,
    };
    if (!bootstrap || canonicalMainnetV8Json(stageData) !== canonicalMainnetV8Json(expected)) {
      fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT READY differs from sealed bootstrap evidence.');
    }
    return;
  }
  const packageIds = Object.fromEntries(sealedManifest.packages.map((entry) => [
    entry.role, entry.packageId,
  ]));
  const core = successfulCertificates.get('0')?.details?.certificate?.readback;
  if (!core) fail('MAINNET_V8_WAL_INVALID', 'Stage READY has no certified Core publication.');
  const protocolConfig = ordinal === 7
    ? sharedReferenceFromCertifiedOutput(core.protocolConfig, 'Core ProtocolConfig')
    : sharedReferenceFromCertifiedOutput(
        successfulCertificates.get('7')?.details?.certificate?.readback?.protocolConfig,
        'Initialized ProtocolConfig',
      );
  const protocolAdminCap = ordinal === 7
    ? ownedReferenceFromCertifiedOutput(core.protocolAdminCap, 'Core ProtocolAdminCap')
    : ownedReferenceFromCertifiedOutput(
        successfulCertificates.get('7')?.details?.certificate?.readback?.protocolAdminCap,
        'Initialized ProtocolAdminCap',
      );
  const base = {
    packageIds,
    protocolConfig,
    protocolAdminCap,
  };
  if (ordinal === 7) {
    if (canonicalMainnetV8Json(stageData) !== canonicalMainnetV8Json(base)) {
      fail('MAINNET_V8_WAL_INVALID', 'INITIALIZE_PROTOCOL READY differs from sealed package readback.');
    }
    return;
  }
  const commitments = Object.fromEntries(sealedManifest.packages.map((entry) => [
    entry.role,
    { source: entry.sourceCommitment, package: entry.packageCommitment, abi: entry.abiCommitment },
  ]));
  const expected = {
    ...base,
    commitments,
    sealPolicy: sealedManifest.sealPolicy,
    keyServerCertificates: stageData.keyServerCertificates,
  };
  if (canonicalMainnetV8Json(stageData) !== canonicalMainnetV8Json(expected)) {
    fail('MAINNET_V8_WAL_INVALID', 'BOOTSTRAP_RELEASE READY differs from sealed release inputs.');
  }
}

function assertStageSuccessContext(event, ready, wal, sealedManifest, successfulCertificates) {
  const ordinal = Number(event.ordinal);
  const details = event.evidence.observation.details;
  if (ordinal === 7) {
    const core = successfulCertificates.get('0')?.details?.certificate?.readback;
    const readback = details.certificate.readback;
    const coreManifest = sealedManifest?.packages?.[0];
    if (!core || !coreManifest
      || readback.protocolConfig.reference.objectId !== core.protocolConfig.reference.objectId
      || readback.protocolAdminCap.reference.objectId
        !== core.protocolAdminCap.reference.objectId
      || readback.protocolConfig.type
        !== `${coreManifest.packageId}::protocol_config_v8::ProtocolConfigV8`
      || readback.protocolAdminCap.type
        !== `${coreManifest.packageId}::protocol_config_v8::ProtocolAdminCapV8`) {
      fail('MAINNET_V8_WAL_INVALID', 'Protocol init readback differs from sealed Core publication.');
    }
    return;
  }
  if (ordinal === 8) {
    const init = successfulCertificates.get('7')?.details?.certificate?.readback;
    const readback = details.certificate.readback;
    if (!init || !sealedManifest
      || readback.runtimeConfig.protocolConfigId !== init.protocolConfig.reference.objectId
      || readback.runtimeConfig.protocolTreasuryId !== init.protocolTreasury.reference.objectId
      || readback.attestation.catalog.protocolConfigRevision !== '2'
      || readback.attestation.catalog.protocolConfigCommitment
        !== moveHash(init.protocolConfig.fields.commitment, 'Enabled ProtocolConfig commitment')) {
      fail('MAINNET_V8_WAL_INVALID', 'Bootstrap runtime differs from its exact init certificate.');
    }
    sealedManifest.packages.forEach((entry) => {
      const runtimeRole = readback.runtimeConfig.roles[entry.role];
      const attestedRole = readback.attestation.catalog.roles[entry.role];
      const tuple = readback.attestation.packageTuple.find((row) => row.role === entry.role);
      if (!runtimeRole || !attestedRole || !tuple
        || runtimeRole.typeOriginPackageId !== entry.packageId
        || runtimeRole.callablePackageId !== entry.packageId
        || attestedRole.originalPackageId !== entry.packageId
        || attestedRole.callablePackageId !== entry.packageId
        || attestedRole.sourceCommitment !== entry.sourceCommitment
        || attestedRole.packageCommitment !== entry.packageCommitment
        || attestedRole.abiCommitment !== entry.abiCommitment
        || tuple.originalPackageId !== entry.packageId
        || tuple.callablePackageId !== entry.packageId
        || tuple.packageDigest !== entry.packageDigest) {
        fail('MAINNET_V8_WAL_INVALID', `Bootstrap attestation differs from sealed ${entry.role} manifest evidence.`);
      }
    });
    const finalSealPolicy = sealedManifest.sealPolicy;
    const eventKeyServerCommitment = Buffer.from(decodeCanonicalBase64(
      readback.events.key_server_set_commitment,
      'Bootstrap events.key_server_set_commitment',
    )).toString('hex');
    const sealFields = readback.configs.seal.fields;
    const observedKeyServers = sealFields.key_servers.map((value, index) => {
      const row = moveStructFields(value, `Bootstrap Seal key_servers[${index}]`);
      return {
        objectId: moveObjectId(row.key_server_id, `Bootstrap Seal key_servers[${index}].key_server_id`),
        weight: moveDecimal(row.weight, `Bootstrap Seal key_servers[${index}].weight`),
      };
    });
    if (eventKeyServerCommitment !== finalSealPolicy.keyServerSetCommitment
      || String(readback.events.threshold) !== finalSealPolicy.threshold
      || canonicalMainnetV8Json(observedKeyServers)
        !== canonicalMainnetV8Json(finalSealPolicy.keyServers)
      || moveDecimal(sealFields.threshold, 'Bootstrap Seal threshold') !== finalSealPolicy.threshold
      || moveHash(sealFields.key_server_set_commitment, 'Bootstrap Seal key-server commitment')
        !== finalSealPolicy.keyServerSetCommitment
      || moveHash(sealFields.encryption_policy_commitment, 'Bootstrap Seal encryption commitment')
        !== finalSealPolicy.encryptionPolicyCommitment) {
      fail('MAINNET_V8_WAL_INVALID', 'Bootstrap Seal output/event differs from final manifest policy.');
    }
    return;
  }
  if (ordinal === 9) {
    const certificate = details.certificate;
    const verification = certificate.verification;
    const bootstrap = successfulCertificates.get('8')?.details?.certificate;
    const stageData = ready?.readyArtifact?.stageData;
    if (!bootstrap || !sealedManifest) {
      fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT has no sealed bootstrap predecessor.');
    }
    const packageVerification = verification.packageVerification;
    const packageVerificationMatches = packageVerification.executionPlanId === wal.executionPlanId
      && packageVerification.releaseId === wal.releaseId
      && packageVerification.packages.every((entry, index) => {
        const sealed = sealedManifest.packages[index];
        return entry.role === sealed.role
          && entry.packageId === sealed.packageId
          && entry.packageDigest === sealed.packageDigest
          && entry.packageVersion === sealed.packageVersion
          && entry.publishDigest === sealed.publishDigest
          && entry.sourceCommitment === sealed.sourceCommitment
          && entry.packageCommitment === sealed.packageCommitment
          && entry.abiCommitment === sealed.abiCommitment
          && entry.readbackSha256 === sealed.readbackSha256;
      });
    exactFields(stageData, VERIFY_STAGE_DATA_FIELDS, 'VERIFY_AND_EXPORT READY stageData');
    if (stageData.releaseId !== wal.releaseId
      || stageData.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
      || stageData.bootstrapCertificateSha256 !== bootstrap.readbackSha256
      || stageData.exportFilename !== certificate.exports.filename
      || verification.executionPlanId !== wal.executionPlanId
      || verification.releaseId !== wal.releaseId
      || verification.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
      || !packageVerificationMatches
      || verification.runtimeAttestationSha256
        !== sha256MainnetV8Json(bootstrap.readback.attestation)) {
      fail('MAINNET_V8_WAL_INVALID', 'VERIFY_AND_EXPORT certificate differs from sealed release/bootstrap inputs.');
    }
  }
}

export function assertMainnetV8ReleaseWal(wal) {
  assertMainnetV8DeterministicJson(wal, 'Release WAL');
  assertNoSecretFields(wal, 'Release WAL');
  exactFields(wal, WAL_FIELDS, 'Release WAL');
  if (wal.schemaVersion !== MAINNET_V8_RELEASE_WAL_SCHEMA) fail('MAINNET_V8_WAL_INVALID', 'Release WAL schema is invalid.');
  assertMainnetV8ReleasePlan(wal.plan);
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
      if (sealedManifest !== null || event.ordinal !== '6'
        || event.releaseId !== event.evidence.releaseId) {
        fail('MAINNET_V8_WAL_INVALID', 'Final manifest may be sealed exactly once after ordinal 6.');
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
      const core = sealedManifest?.packages?.[MAINNET_V8_ROLE_ORDER.indexOf('core')];
      if (!core || event.ordinal !== '6'
        || event.evidence.releaseId !== sealedManifest.releaseId
        || event.evidence.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
        || event.evidence.reason.moveAbort.packageId !== core.packageId) {
        fail('MAINNET_V8_WAL_INVALID', 'Release abandonment differs from the sealed Core/init boundary.');
      }
    }
    const ordinal = Number(BigInt(event.ordinal));
    if (ordinal >= 7 && sealedManifest === null) {
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
      if (ordinal < MAINNET_V8_ROLE_ORDER.length) {
        const planned = wal.plan.packages[ordinal];
        if (event.evidence.readyArtifact.role !== planned.role
          || event.evidence.readyArtifact.packageArtifact.role !== planned.role) {
          fail('MAINNET_V8_WAL_INVALID', `READY ordinal ${event.ordinal} differs from its immutable source-plan role.`);
        }
        const expectedRoleDependencies = MAINNET_V8_ROLE_PUBLISH_DEPENDENCIES[planned.role].map((role) => {
          const dependencyOrdinal = String(MAINNET_V8_ROLE_ORDER.indexOf(role));
          const dependency = successfulCertificates.get(dependencyOrdinal)?.details?.certificate?.readback;
          if (!dependency) {
            fail('MAINNET_V8_WAL_INVALID', `READY ${planned.role} has no finalized ${role} dependency certificate.`);
          }
          return dependency.package.reference.objectId;
        }).sort(compareMainnetV8Text);
        const priorPackageIds = MAINNET_V8_ROLE_ORDER.slice(0, ordinal).map((role, index) => {
          const dependency = successfulCertificates.get(String(index))?.details?.certificate?.readback;
          if (!dependency) {
            fail('MAINNET_V8_WAL_INVALID', `READY ${planned.role} has no finalized ${role} package certificate.`);
          }
          return dependency.package.reference.objectId;
        });
        const observedRoleDependencies = event.evidence.readyArtifact.dependencies
          .filter((dependency) => priorPackageIds.includes(dependency))
          .sort(compareMainnetV8Text);
        if (canonicalMainnetV8Json(observedRoleDependencies)
          !== canonicalMainnetV8Json(expectedRoleDependencies)) {
          fail('MAINNET_V8_WAL_INVALID', `READY ${planned.role} package dependencies differ from the frozen role DAG.`);
        }
      }
      readyEvidence.set(cursor, {
        readyArtifactSha256: event.evidence.readyArtifactSha256,
        readyArtifact: cloneJson(event.evidence.readyArtifact),
        unsignedEnvelope: event.evidence.unsignedEnvelope,
        packageCommitment: ordinal < MAINNET_V8_ROLE_ORDER.length
          ? event.evidence.readyArtifact.packageCommitment : null,
        packageArtifact: ordinal < MAINNET_V8_ROLE_ORDER.length
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
      && event.ordinal === '9';
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
        const bootstrap = successfulCertificates.get('8')?.details?.certificate;
        const stageData = ready.readyArtifact.stageData;
        if (!bootstrap
          || context.executionPlanId !== wal.executionPlanId
          || context.releaseId !== wal.releaseId
          || context.finalManifestSha256 !== sha256MainnetV8Json(sealedManifest)
          || context.bootstrapCertificateSha256 !== bootstrap.readbackSha256
          || stageData.releaseId !== context.releaseId
          || stageData.finalManifestSha256 !== context.finalManifestSha256
          || stageData.bootstrapCertificateSha256 !== context.bootstrapCertificateSha256) {
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
    if (event.ordinal !== '9' && ['FINALIZED_SUCCESS', 'INCIDENT_STOPPED'].includes(event.status)) {
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
    if (ordinal < MAINNET_V8_ROLE_ORDER.length
      && ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(event.status)) {
      const ready = readyEvidence.get(cursor);
      const details = event.evidence.observation.details;
      if (!ready || ready.packageCommitment !== details.packageCommitment
        || ready.packageArtifact !== canonicalMainnetV8Json(details.packageArtifact)) {
        fail('MAINNET_V8_WAL_INVALID', `Finalized publish ordinal ${event.ordinal} differs from its READY package artifact.`);
      }
    }
    if (event.status === 'FINALIZED_SUCCESS') {
      if (ordinal >= MAINNET_V8_ROLE_ORDER.length) {
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
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function atomicWrite(path, text) {
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
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function newLockRecord() {
  return {
    pid: String(process.pid),
    hostname: hostname(),
    createdAt: new Date().toISOString(),
    nonce: randomBytes(16).toString('hex'),
  };
}

function assertLockRecord(record, label = 'WAL lock') {
  exactFields(record, LOCK_FIELDS, label);
  assertMainnetV8Decimal(record.pid, `${label}.pid`, { positive: true });
  boundedText(record.hostname, `${label}.hostname`, 512);
  assertRecordedAt(record.createdAt);
  if (!/^[0-9a-f]{32}$/.test(record.nonce)) {
    fail('MAINNET_V8_WAL_LOCK_INVALID', `${label}.nonce must be 128-bit lowercase hex.`);
  }
  return record;
}

async function readLockRecord(path, { missing = false } = {}) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if (missing && error?.code === 'ENOENT') return null;
    throw error;
  }
  let record;
  try { record = JSON.parse(text); } catch {
    fail('MAINNET_V8_WAL_LOCK_INVALID', 'WAL lock metadata is not canonical JSON.', { path });
  }
  assertLockRecord(record);
  if (`${canonicalMainnetV8Json(record)}\n` !== text) {
    fail('MAINNET_V8_WAL_LOCK_INVALID', 'WAL lock metadata bytes are not canonical.', { path });
  }
  return record;
}

async function installLockRecord(path, record) {
  assertLockRecord(record);
  const directory = dirname(path);
  const temporary = join(directory, `.${basename(path)}.${record.nonce}.candidate`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${canonicalMainnetV8Json(record)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, path);
    await syncDirectory(directory);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function localProcessAlive(record) {
  if (record.hostname !== hostname()) return null;
  const pid = Number(record.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function releaseOwnedLock(path, record) {
  const observed = await readLockRecord(path, { missing: true });
  if (!observed || observed.nonce !== record.nonce
    || observed.pid !== record.pid || observed.hostname !== record.hostname) return false;
  try { await unlink(path); } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  await syncDirectory(dirname(path));
  return true;
}

async function reclaimDeadLock(lockPath, observed) {
  const directory = dirname(lockPath);
  const claimPath = `${lockPath}.reclaim`;
  const claim = newLockRecord();
  if (!await installLockRecord(claimPath, claim)) {
    const existingClaim = await readLockRecord(claimPath, { missing: true });
    if (existingClaim && localProcessAlive(existingClaim) === false) {
      await releaseOwnedLock(claimPath, existingClaim);
      return null;
    }
    return false;
  }
  try {
    const current = await readLockRecord(lockPath, { missing: true });
    if (!current) return null;
    if (current.nonce !== observed.nonce || current.hostname !== hostname()
      || localProcessAlive(current) !== false) return false;
    const ageMs = Date.now() - new Date(current.createdAt).valueOf();
    if (!Number.isFinite(ageMs) || ageMs < 0) return false;
    if (!await releaseOwnedLock(lockPath, current)) return null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await installLockRecord(lockPath, claim)) return claim;
      await new Promise((resolveWait) => setImmediate(resolveWait));
    }
    return false;
  } finally {
    if (!await releaseOwnedLock(claimPath, claim)) {
      fail('MAINNET_V8_WAL_LOCK_RELEASE_FAILED', 'Release WAL recovery claim ownership changed before release.', {
        claimPath,
      });
    }
  }
}

async function acquireWalLock(lockPath) {
  const directory = dirname(lockPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const reclaimPath = `${lockPath}.reclaim`;
    const existingClaim = await readLockRecord(reclaimPath, { missing: true });
    if (existingClaim) {
      const claimAlive = localProcessAlive(existingClaim);
      if (claimAlive === false) {
        await releaseOwnedLock(reclaimPath, existingClaim);
        continue;
      }
      fail('MAINNET_V8_WAL_LOCKED', 'Release WAL has an active or remote stale-lock recovery claim.', {
        lockPath,
        pid: existingClaim.pid,
        hostname: existingClaim.hostname,
        active: claimAlive,
      });
    }
    const record = newLockRecord();
    if (await installLockRecord(lockPath, record)) {
      let reclaimExists = false;
      try { await readFile(`${lockPath}.reclaim`, 'utf8'); reclaimExists = true; } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (!reclaimExists) return record;
      await releaseOwnedLock(lockPath, record);
      await new Promise((resolveWait) => setImmediate(resolveWait));
      continue;
    }
    const observed = await readLockRecord(lockPath, { missing: true });
    if (!observed) continue;
    const alive = localProcessAlive(observed);
    if (alive !== false) {
      const ageMs = Math.max(0, Date.now() - new Date(observed.createdAt).valueOf());
      fail('MAINNET_V8_WAL_LOCKED', 'Release WAL is locked by an active or remote process.', {
        lockPath,
        pid: observed.pid,
        hostname: observed.hostname,
        createdAt: observed.createdAt,
        ageMs,
        leaseMs: MAINNET_V8_WAL_LOCK_LEASE_MS,
        active: alive,
      });
    }
    const reclaimed = await reclaimDeadLock(lockPath, observed);
    if (reclaimed) return reclaimed;
    if (reclaimed === false) {
      fail('MAINNET_V8_WAL_LOCKED', 'Release WAL stale-lock recovery lost its atomic claim.', { lockPath });
    }
  }
  fail('MAINNET_V8_WAL_LOCKED', 'Release WAL lock acquisition did not converge.', { lockPath });
}

async function withWalLock(path, action) {
  const lockPath = `${path}.lock`;
  const record = await acquireWalLock(lockPath);
  let value;
  let actionError = null;
  try { value = await action(); } catch (error) { actionError = error; }
  let releaseError = null;
  try {
    if (!await releaseOwnedLock(lockPath, record)) {
      fail('MAINNET_V8_WAL_LOCK_RELEASE_FAILED', 'Release WAL lock ownership changed before release.', {
        lockPath,
      });
    }
  } catch (error) { releaseError = error; }
  if (actionError && releaseError) {
    throw new AggregateError([actionError, releaseError], 'Release WAL action and lock release both failed.');
  }
  if (actionError) throw actionError;
  if (releaseError) throw releaseError;
  return value;
}

async function readWalFile(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail('MAINNET_V8_WAL_NOT_FOUND', 'Release WAL does not exist.', { path });
    throw error;
  }
  let wal;
  try { wal = JSON.parse(text); } catch { fail('MAINNET_V8_WAL_INVALID', 'Release WAL is not JSON.'); }
  assertMainnetV8ReleaseWal(wal);
  if (`${canonicalMainnetV8Json(wal)}\n` !== text) fail('MAINNET_V8_WAL_INVALID', 'Release WAL bytes are not canonical.');
  return wal;
}

async function writeAndVerifyWal(path, wal) {
  await atomicWrite(path, `${canonicalMainnetV8Json(wal)}\n`);
  const durable = await readWalFile(path);
  if (canonicalMainnetV8Json(durable) !== canonicalMainnetV8Json(wal)) {
    fail('MAINNET_V8_WAL_INVALID', 'Release WAL cold read differs after atomic replacement.', { path });
  }
  return deepFreeze(durable);
}

export async function readMainnetV8ReleaseWal(path) {
  return deepFreeze(await readWalFile(resolve(path)));
}

export async function createMainnetV8ReleaseWal(path, plan, options = {}) {
  assertMainnetV8ReleasePlan(plan);
  const target = resolve(path);
  return withWalLock(target, async () => {
    try {
      await readFile(target, 'utf8');
      fail('MAINNET_V8_WAL_EXISTS', 'Release WAL already exists.', { path: target });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
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
    assertMainnetV8ReleaseWal(wal);
    return writeAndVerifyWal(target, wal);
  });
}

export async function appendMainnetV8ReleaseWal(path, input) {
  const target = resolve(path);
  return withWalLock(target, async () => {
    const current = await readWalFile(target);
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
    assertMainnetV8ReleaseWal(wal);
    return writeAndVerifyWal(target, wal);
  });
}

// Runner-facing stable aliases. The longer names above remain useful in tests
// because they make the Mainnet-only scope explicit, while these names keep the
// release runner compact and form the public integration contract.
export const ROLE_ORDER = MAINNET_V8_ROLE_ORDER;
export const ROLE_DEPENDENCIES = MAINNET_V8_ROLE_DEPENDENCIES;
export const ROLE_PUBLISH_DEPENDENCIES = MAINNET_V8_ROLE_PUBLISH_DEPENDENCIES;
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
