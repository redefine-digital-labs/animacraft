import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import {
  expansionPackV8Declared,
  inspectExpansionPackV8PackageAbi,
  inspectExpansionPackV8ActivationEvidence,
  inspectExpansionPackV8LiveActivation,
  inspectExpansionPackV8PostClaimEvidence,
  inspectExpansionPackV8Deployment,
  inspectExpansionPackV8ParentFinalizationEvidence,
  inspectCompositionV6RetirementEvidence,
} from '../scripts/mainnet-preflight.mjs';

const CALLABLE = '0x8888';
const TYPE_ORIGIN = '0x8008';
const LEGACY_TYPE_ORIGIN = '0x7007';
const COMMERCE_TYPE_ORIGIN = '0x5005';
const INDEPENDENT_EXTENSION_TYPE_ORIGIN = '0x6006';
const TYPE_ORIGINS = Object.freeze({
  originalPackageId: LEGACY_TYPE_ORIGIN,
  commerceV5TypeOriginPackageId: COMMERCE_TYPE_ORIGIN,
  independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN,
  legacyLogicalV5TypeOriginPackageId: CALLABLE,
});
const UPGRADE_DIGEST = '1'.repeat(43);
const PACKAGE_DIGEST = '2'.repeat(43);
const SOURCE_COMMIT = 'a'.repeat(40);
const SOURCE_TREE = 'b'.repeat(40);
const AUTHORITY = '0xa888';
const MAINNET_V8 = Object.freeze({
  packageId: '0x1a797e32f594c53abab3e5bc0df9368c60deb4564e7947bea42db00d32dbe9ee',
  typeOriginPackageId: '0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a',
  upgradeTxDigest: 'GFJYxZ6hc83ma5itvJ5CN2ZAtTAqjizrgi9o2jKuTwZt',
  upgradeCheckpoint: '309752508',
  upgradedAtMs: '1786519008669',
  sourceCommit: '3c2ffeeb86be6df2cd1f278454a72f5d02c796ea',
  sourceTree: '0872c4142ee5e811594efbadba032b7b21e5b57c',
  packageDigest: 'D9vH1VMhqckfGKP6kxbCzZsFuQa4gGhrdhNntAxCfaqe',
  authorityId: '0xc2b39910070116bc9614f4f55b6b1013377fc86ba6273630f5cee83111bd8e19',
  parentFinalizationTxDigest: '9k3Zz7vyApXSCLWxFoJxqoMVxVN6vtwoBYp1BsHU5WCb',
  parentFinalizationCheckpoint: '309767464',
});

function parentFinalization(overrides = {}) {
  return {
    status: 'success',
    chainIdentifier: 'test-mainnet-chain',
    transactionDigest: '3'.repeat(43),
    checkpoint: '400000001',
    checkpointDigest: '4'.repeat(43),
    finalizedAtMs: '1800000000001',
    rootId: '0xb001',
    treasuryId: '0xb002',
    legacyMakerId: '0xb003',
    owner: '0xb004',
    protocolConfigId: '0xb005',
    protocolAdminCapId: '0xb006',
    authorityId: AUTHORITY,
    authorityTypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN,
    retiredControlCap: {
      id: '0xb007',
      deletionEffect: 'Deleted',
      readbackStatus: 'unavailable',
    },
    lifecycle: 'PAUSED',
    lifecycleCode: 1,
    retiredControlCapEpoch: '0',
    ownershipEpoch: '1',
    styleCounts: { visual: 19, logicalNone: 3, logicalColor: 4, total: 26 },
    styleRegistrySealed: true,
    packCount: 0,
    paidPackCount: 0,
    completeOutputCount: 0,
    activeListingId: '',
    treasuryBalanceAtomic: '0',
    requiresSealPolicy: false,
    sealPolicyBound: false,
    auditHash: '5'.repeat(64),
    lockFingerprintSha256: '6'.repeat(64),
    resultPath: 'test/fixtures/parent-finalize-result.json',
    resultSha256: '7'.repeat(64),
    authorityShared: true,
    gasUsedMist: '250',
    gasComputationCostMist: '100',
    gasStorageCostMist: '200',
    gasStorageRebateMist: '50',
    gasNonRefundableStorageFeeMist: '10',
    legacyLogicalEventCount: 7,
    finalizedEventCount: 1,
    zeroHistoryTrustedClear: true,
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    expansionPackV8CallablePackageId: CALLABLE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN,
    independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN,
    legacyLogicalV5TypeOriginPackageId: CALLABLE,
    independentExtensionAuthorityV5Id: AUTHORITY,
    expansionPackV8ReleaseEnabled: true,
    ...overrides,
  };
}

function deployment(overrides = {}) {
  return {
    expansionPackProtocolVersion: 8,
    expansionPackV8CallablePackageId: CALLABLE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN,
    independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN,
    legacyLogicalV5TypeOriginPackageId: CALLABLE,
    independentExtensionAuthorityV5Id: AUTHORITY,
    expansionPackV8ReleaseEnabled: true,
    upgradeTxDigest: UPGRADE_DIGEST,
    upgradeCheckpoint: '400000000',
    upgradedAtMs: '1800000000000',
    source: {
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
    },
    releases: {
      expansionPackV8: {
        callablePackageId: CALLABLE,
        typeOriginPackageId: TYPE_ORIGIN,
        independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN,
        legacyLogicalV5TypeOriginPackageId: CALLABLE,
        packageVersion: 7,
        packageObjectVersion: '7',
        upgradeTxDigest: UPGRADE_DIGEST,
        upgradeCheckpoint: '400000000',
        upgradedAtMs: '1800000000000',
        sourceCommit: SOURCE_COMMIT,
        sourceTree: SOURCE_TREE,
        packageDigest: PACKAGE_DIGEST,
        packageObjectDigest: PACKAGE_DIGEST,
        upgradeCapPackageVersion: '7',
        upgradePolicy: 0,
        parentFinalization: parentFinalization(),
        enabled: true,
      },
    },
    verification: {
      packageDigest: PACKAGE_DIGEST,
      expansionPackV8UpgradeTransactionStatus: 'success',
      expansionPackV8SourceStatus: 'success',
      expansionPackV8PackageReadBack: true,
      expansionPackV8ParentFinalizationStatus: 'success',
      expansionPackV8ParentFinalizationReadBack: true,
      expansionPackV8ParentAuthorityShared: true,
      expansionPackV8ParentControlCapDeleted: true,
      expansionPackV8ParentZeroHistoryClear: true,
      expansionPackV8Enabled: true,
    },
    ...overrides,
  };
}

function signature(reference, body) {
  return { reference, body };
}

function primitive(kind, reference = null) {
  return signature(reference, { $kind: kind });
}

function vector(body, reference = null) {
  return signature(reference, { $kind: 'vector', vector: body });
}

function typeParameter(index) {
  return { $kind: 'typeParameter', index };
}

function moveDatatype(typeName, typeParameters = [], reference = null) {
  return signature(reference, {
    $kind: 'datatype',
    datatype: { typeName, typeParameters },
  });
}

const ABI_FUNCTION_SPECS = Object.freeze({
  version_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 0, returns: 'u64' },
  create_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 1, parameters: 13 },
  bind_expansion_pack_manifest_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 5 },
  register_style_asset_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 9 },
  seal_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 4 },
  bind_expansion_pack_seal_policy_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 3 },
  admit_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 5 },
  admit_expansion_pack_with_authority_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 5 },
  activate_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 5 },
  pause_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 3 },
  resume_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 5 },
  archive_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 3 },
  claim_free_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 5 },
  purchase_expansion_pack_v8: { moduleName: 'expansion_pack_v8', typeParameters: 1, parameters: 8 },
  withdraw_expansion_pack_revenue_v8: { moduleName: 'expansion_pack_v8', typeParameters: 1, parameters: 6 },
  verify_style_access_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 6, returns: 'proof' },
  seal_approve_style_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 4 },
  check_style_seal_access_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 4, returns: 'bool' },
  complete_bridge_enabled_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 0, returns: 'bool' },
  physical_bridge_enabled_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 0, returns: 'bool' },
  assert_complete_bridge_enabled_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 0 },
  assert_physical_bridge_enabled_v8: { moduleName: 'expansion_pack_v8', typeParameters: 0, parameters: 0 },
  companion_proof_version_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 0, returns: 'u64' },
  companion_proof_available_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 0, returns: 'bool' },
  begin_expansion_pack_complete_authorization_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 3, returns: 'completeAuthorization' },
  append_expansion_pack_complete_style_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 7 },
  seal_expansion_pack_complete_authorization_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 1 },
  authenticate_expansion_pack_complete_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 5, returns: 'completeBinding' },
  bind_expansion_pack_complete_to_soul_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 1, parameters: 5, returns: 'type0' },
  authorization_pack_selection_commitment_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 1, returns: 'bytesRef' },
  authorization_selection_count_v8: { moduleName: 'expansion_pack_complete_v8', typeParameters: 0, parameters: 1, returns: 'u64' },
  bind_maker_release_evidence_v5: { moduleName: 'commerce_v5', typeParameters: 0, parameters: 7 },
  finalize_independent_extension_root_v5: { moduleName: 'commerce_v5', typeParameters: 1, parameters: 12 },
});

const ABI_DATATYPES = Object.freeze([
  ['expansion_pack_v8', 'ExpansionPackReleaseV8'],
  ['expansion_pack_v8', 'ExpansionPackAdminCapV8'],
  ['expansion_pack_v8', 'ExpansionPackTreasuryV8'],
  ['expansion_pack_v8', 'ExpansionPackPassV8'],
  ['expansion_pack_v8', 'ExpansionPackStyleAccessProofV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteStyleSelectionV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackSelectionHashInputV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteHashInputV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteAuthorizationV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteSoulBindingV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteProvenanceV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteAuthenticatedV8'],
  ['expansion_pack_complete_v8', 'ExpansionPackCompleteBoundToSoulV8'],
]);

const ABI_UPGRADE_DATATYPES = Object.freeze([
  ['commerce_v5', 'LegacyLogicalCompatibilityStateV5'],
  ['commerce_v5', 'LegacyLogicalStyleApprovalKeyV5'],
  ['commerce_v5', 'LegacyLogicalStyleApprovalV5'],
  ['commerce_v5', 'LegacyLogicalStyleRegisteredV5'],
]);

const ABI_INDEPENDENT_EXTENSION_DATATYPES = Object.freeze([
  ['commerce_v5', 'IndependentExtensionLockStateV5'],
  ['commerce_v5', 'IndependentExtensionAuthorityV5'],
  ['commerce_v5', 'IndependentExtensionRootFinalizedV5'],
]);

function functionParameters(name, count) {
  const defined = (
    packageId,
    moduleName,
    typeName,
    typeParameters = [],
    reference = 'immutable',
  ) => (
    moveDatatype(
      `${packageId}::${moduleName}::${typeName}`,
      typeParameters,
      reference,
    )
  );
  const release = (reference = 'immutable') => defined(
    LEGACY_TYPE_ORIGIN,
    'expansion_pack_v8',
    'ExpansionPackReleaseV8',
    [],
    reference,
  );
  const admin = () => defined(
    LEGACY_TYPE_ORIGIN,
    'expansion_pack_v8',
    'ExpansionPackAdminCapV8',
  );
  const root = (reference = 'immutable') => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'MakerRootV5',
    [],
    reference,
  );
  const control = (reference = 'immutable') => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'MakerControlCapV5',
    [],
    reference,
  );
  const maker = () => defined(LEGACY_TYPE_ORIGIN, 'animacraft', 'OCMaker');
  const protocolFeeAdmin = () => defined(
    LEGACY_TYPE_ORIGIN,
    'animacraft',
    'ProtocolFeeAdminCap',
  );
  const config = () => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'CommerceProtocolConfigV5',
  );
  const makerTreasury = () => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'MakerTreasuryV5',
    [typeParameter(0)],
  );
  const independentExtensionAuthority = () => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'IndependentExtensionAuthorityV5',
  );
  const commerceAuthorization = () => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'CommerceV5SoulMintAuthorization',
  );
  const completeAuthorization = (reference = null) => defined(
    LEGACY_TYPE_ORIGIN,
    'expansion_pack_complete_v8',
    'ExpansionPackCompleteAuthorizationV8',
    [],
    reference,
  );
  const completeBinding = (reference = null) => defined(
    LEGACY_TYPE_ORIGIN,
    'expansion_pack_complete_v8',
    'ExpansionPackCompleteSoulBindingV8',
    [],
    reference,
  );
  const objectId = () => moveDatatype('0x2::object::ID', [], null);
  const string = () => moveDatatype('0x1::string::String');
  const bytes = () => vector({ $kind: 'u8' });
  const context = (reference = 'immutable') => moveDatatype(
    '0x2::tx_context::TxContext',
    [],
    reference,
  );
  const clock = () => moveDatatype('0x2::clock::Clock', [], 'immutable');
  const paymentCoin = typeParameter(0);
  const typeParameterValue = (index) => signature(null, typeParameter(index));
  const exact = {
    version_v8: [],
    create_expansion_pack_v8: [
      root(), maker(), config(),
      string(), string(), bytes(), string(), string(), string(), bytes(),
      primitive('u8'), primitive('u64'), context('mutable'),
    ],
    bind_expansion_pack_manifest_v8: [
      release('mutable'), admin(), string(), bytes(), context(),
    ],
    register_style_asset_v8: [
      release('mutable'), admin(), string(), string(), string(), string(),
      bytes(), bytes(), context(),
    ],
    seal_expansion_pack_v8: [
      release('mutable'), admin(), bytes(), context(),
    ],
    bind_expansion_pack_seal_policy_v8: [
      release('mutable'), admin(), context(),
    ],
    admit_expansion_pack_v8: [
      release('mutable'), root(), maker(), control(), context(),
    ],
    admit_expansion_pack_with_authority_v8: [
      release('mutable'), root(), maker(), independentExtensionAuthority(),
      context(),
    ],
    activate_expansion_pack_v8: [
      release('mutable'), admin(), root(), config(), context(),
    ],
    pause_expansion_pack_v8: [release('mutable'), admin(), context()],
    resume_expansion_pack_v8: [
      release('mutable'), admin(), root(), config(), context(),
    ],
    archive_expansion_pack_v8: [release('mutable'), admin(), context()],
    claim_free_expansion_pack_v8: [
      release('mutable'), root(), config(), clock(), context('mutable'),
    ],
    purchase_expansion_pack_v8: [
      release('mutable'),
      defined(
        LEGACY_TYPE_ORIGIN,
        'expansion_pack_v8',
        'ExpansionPackTreasuryV8',
        [paymentCoin],
        'mutable',
      ),
      root(),
      config(),
      defined(
        LEGACY_TYPE_ORIGIN,
        'commerce_v5',
        'CommerceProtocolTreasuryV5',
        [paymentCoin],
        'mutable',
      ),
      moveDatatype('0x2::coin::Coin', [paymentCoin]),
      clock(),
      context('mutable'),
    ],
    withdraw_expansion_pack_revenue_v8: [
      release(),
      defined(
        LEGACY_TYPE_ORIGIN,
        'expansion_pack_v8',
        'ExpansionPackTreasuryV8',
        [paymentCoin],
        'mutable',
      ),
      admin(), primitive('u64'), primitive('address'), context('mutable'),
    ],
    verify_style_access_v8: [
      release(), root(), string(), string(), string(), context(),
    ],
    seal_approve_style_v8: [bytes(), release(), root(), context()],
    check_style_seal_access_v8: [
      bytes(), release(), root(), primitive('address'),
    ],
    complete_bridge_enabled_v8: [],
    physical_bridge_enabled_v8: [],
    assert_complete_bridge_enabled_v8: [],
    assert_physical_bridge_enabled_v8: [],
    companion_proof_version_v8: [],
    companion_proof_available_v8: [],
    begin_expansion_pack_complete_authorization_v8: [
      root(), bytes(), context(),
    ],
    append_expansion_pack_complete_style_v8: [
      completeAuthorization('mutable'), release(), root(),
      string(), string(), string(), context(),
    ],
    seal_expansion_pack_complete_authorization_v8: [
      completeAuthorization('mutable'),
    ],
    authenticate_expansion_pack_complete_v8: [
      completeAuthorization(), commerceAuthorization(), root(), config(), context(),
    ],
    bind_expansion_pack_complete_to_soul_v8: [
      completeBinding(), config(), objectId(), typeParameterValue(0),
      context('mutable'),
    ],
    authorization_pack_selection_commitment_v8: [completeAuthorization('immutable')],
    authorization_selection_count_v8: [completeAuthorization('immutable')],
    bind_maker_release_evidence_v5: [
      root('mutable'), control(), maker(), string(), string(), bytes(), context(),
    ],
    finalize_independent_extension_root_v5: [
      root('mutable'), makerTreasury(), control(null), maker(), config(),
      protocolFeeAdmin(), vector(string().body), vector(string().body),
      vector(string().body), bytes(), bytes(), context('mutable'),
    ],
  };
  const parameters = exact[name];
  assert.ok(parameters, `${name} mock ABI is missing`);
  if (count <= parameters.length) return parameters.slice(0, count);
  return parameters.concat(
    Array.from({ length: count - parameters.length }, () => primitive('u64')),
  );
}

function packageAbiClient({
  version = 8,
  companionVersion = 8,
  completeBridgeEnabled = false,
  physicalBridgeEnabled = false,
  companionProofAvailable = false,
  completeBridgeAssertionAborts = true,
  physicalBridgeAssertionAborts = true,
  releaseTypeOrigin = TYPE_ORIGIN,
  driftDatatype = '',
  missingDatatype = '',
  createParameterCount = 13,
  missingFunction = '',
  driftFunction = '',
  driftParameterIndex = -1,
  driftParameterValue = null,
  driftReturnFunction = '',
  driftTypeParameterFunction = '',
  driftVisibilityFunction = '',
  driftEntryFunction = '',
} = {}) {
  const requests = [];
  return {
    requests,
    client: {
      core: {
        async getMoveFunction(request) {
          requests.push({ kind: 'function', ...request });
          if (request.name === missingFunction) return { function: null };
          const spec = ABI_FUNCTION_SPECS[request.name];
          if (!spec || request.moduleName !== spec.moduleName) return { function: null };
          const parameterCount = request.name === 'create_expansion_pack_v8'
            ? createParameterCount
            : spec.parameters;
          const parameters = functionParameters(request.name, parameterCount);
          if (request.name === driftFunction && driftParameterIndex >= 0) {
            parameters[driftParameterIndex] = driftParameterValue
              || moveDatatype(`${TYPE_ORIGIN}::wrong::WrongType`);
          }
          const expectedConstraints = request.name
            === 'bind_expansion_pack_complete_to_soul_v8'
            ? ['drop']
            : [];
          const typeParameters = Array.from({ length: spec.typeParameters }, () => ({
            isPhantom: false,
            constraints: expectedConstraints,
          }));
          if (request.name === driftTypeParameterFunction && typeParameters[0]) {
            typeParameters[0].constraints = ['store'];
          }
          const returnValues = {
            u64: [primitive('u64')],
            bool: [primitive('bool')],
            proof: [moveDatatype(`${LEGACY_TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackStyleAccessProofV8`)],
            completeAuthorization: [moveDatatype(
              `${LEGACY_TYPE_ORIGIN}::expansion_pack_complete_v8::ExpansionPackCompleteAuthorizationV8`,
            )],
            completeBinding: [moveDatatype(
              `${LEGACY_TYPE_ORIGIN}::expansion_pack_complete_v8::ExpansionPackCompleteSoulBindingV8`,
            )],
            type0: [signature(null, typeParameter(0))],
            bytesRef: [vector({ $kind: 'u8' }, 'immutable')],
          };
          const returns = returnValues[spec.returns] || [];
          if (request.name === driftReturnFunction && returns[0]) {
            returns[0] = primitive('u8');
          }
          const expectedEntry = request.name === 'seal_approve_style_v8';
          return {
            function: {
              visibility: request.name === driftVisibilityFunction
                ? 'friend'
                : expectedEntry ? 'private' : 'public',
              isEntry: request.name === driftEntryFunction
                ? !expectedEntry
                : expectedEntry,
              typeParameters,
              parameters,
              returns,
            },
          };
        },
        async simulateTransaction(request) {
          const moveCall = request.transaction.getData().commands[0]?.MoveCall;
          const functionName = moveCall?.function || '';
          requests.push({
            kind: 'simulation',
            checksEnabled: request.checksEnabled,
            moduleName: moveCall?.module,
            functionName,
          });
          if (functionName === 'assert_complete_bridge_enabled_v8') {
            if (!completeBridgeAssertionAborts) {
              return { $kind: 'ExecutedTransaction', commandResults: [] };
            }
            return {
              $kind: 'FailedTransaction',
              FailedTransaction: { status: { error: { message: 'MoveAbort 17' } } },
            };
          }
          if (functionName === 'assert_physical_bridge_enabled_v8') {
            if (!physicalBridgeAssertionAborts) {
              return { $kind: 'ExecutedTransaction', commandResults: [] };
            }
            return {
              $kind: 'FailedTransaction',
              FailedTransaction: { status: { error: { message: 'MoveAbort 17' } } },
            };
          }
          const boolValues = {
            complete_bridge_enabled_v8: completeBridgeEnabled,
            physical_bridge_enabled_v8: physicalBridgeEnabled,
            companion_proof_available_v8: companionProofAvailable,
          };
          if (Object.hasOwn(boolValues, functionName)) {
            return {
              $kind: 'ExecutedTransaction',
              commandResults: [{ returnValues: [{
                bcs: [boolValues[functionName] ? 1 : 0],
              }] }],
            };
          }
          const simulatedVersion = functionName === 'companion_proof_version_v8'
            ? companionVersion
            : version;
          return {
            $kind: 'ExecutedTransaction',
            commandResults: [{
              returnValues: [{
                bcs: [simulatedVersion, 0, 0, 0, 0, 0, 0, 0],
              }],
            }],
          };
        },
      },
      movePackageService: {
        async getDatatype(request) {
          requests.push({ kind: 'datatype', ...request });
          if (request.name === missingDatatype) {
            return { response: { datatype: null } };
          }
          const known = [
            ...ABI_DATATYPES,
            ...ABI_UPGRADE_DATATYPES,
            ...ABI_INDEPENDENT_EXTENSION_DATATYPES,
            ['commerce_v5', 'MakerReleaseEvidenceV5'],
          ].some(([moduleName, name]) => (
            moduleName === request.moduleName && name === request.name
          ));
          if (!known) return { response: { datatype: null } };
          const expectedTypeOrigin = request.name === 'ExpansionPackReleaseV8'
            ? releaseTypeOrigin
            : ABI_INDEPENDENT_EXTENSION_DATATYPES.some(
              ([, name]) => name === request.name
            )
              ? INDEPENDENT_EXTENSION_TYPE_ORIGIN
              : ABI_UPGRADE_DATATYPES.some(([, name]) => name === request.name)
                ? CALLABLE
                : TYPE_ORIGIN;
          return {
            response: {
              datatype: { definingId: request.name === driftDatatype
                ? expectedTypeOrigin === CALLABLE ? TYPE_ORIGIN : CALLABLE
                : expectedTypeOrigin },
            },
          };
        },
      },
    },
  };
}

async function currentMainnetTuple() {
  const [deploymentSource, configSource] = await Promise.all([
    readFile(new URL('../deployments/mainnet.json', import.meta.url), 'utf8'),
    readFile(new URL('../public/config.js', import.meta.url), 'utf8'),
  ]);
  const context = vm.createContext({ window: {} });
  new vm.Script(configSource, { filename: 'public/config.js' }).runInContext(context);
  return {
    config: context.window.ANIMACRAFT_CONFIG,
    deployment: JSON.parse(deploymentSource),
  };
}

function postClaim(activation, overrides = {}) {
  return {
    schemaVersion: 'animacraft.expansion-pack-v8-post-claim-evidence.v1',
    status: 'success',
    chainIdentifier: activation.chainIdentifier,
    transactionDigest: '5'.repeat(43),
    checkpoint: String(BigInt(activation.checkpoint) + 1n),
    checkpointDigest: '6'.repeat(43),
    claimedAtMs: '1800000000000',
    claimedAtUtc: '2027-01-15T08:00:00.000Z',
    releaseId: activation.releaseId,
    releaseObjectVersion: String(BigInt(activation.releaseObjectVersion) + 1n),
    releaseObjectDigest: '7'.repeat(43),
    entitlementCount: 1,
    walletAddress: activation.creator,
    passId: '0xc001',
    passObjectVersion: String(BigInt(activation.releaseObjectVersion) + 1n),
    passObjectDigest: '8'.repeat(43),
    holder: activation.creator,
    parentRootId: activation.parentRootId,
    paidAtomic: '0',
    issuedAtMs: '1800000000000',
    admittedParentOwnershipEpoch: activation.admittedParentOwnershipEpoch,
    contentCommitment: activation.contentCommitment,
    createdPassCount: 1,
    entitlementEventCount: 1,
    passCountForTestWallet: 1,
    receiptEvidence: { path: 'claim.json', fileSha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64) },
    readbackEvidence: { path: 'readback.json', fileSha256: 'c'.repeat(64) },
    walletAcceptanceEvidence: { path: 'wallet.json', fileSha256: 'd'.repeat(64) },
    renderEvidence: {
      path: 'render.json', fileSha256: 'e'.repeat(64),
      artifactPath: 'render.png', artifactSha256: 'f'.repeat(64),
    },
    ...overrides,
  };
}

function postClaimVerification() {
  return {
    expansionPackV8FreeClaimTransactionStatus: 'success',
    expansionPackV8FreeClaimReadBack: true,
    expansionPackV8FreeClaimPassReadBack: true,
    expansionPackV8FreeClaimEventReadBack: true,
    expansionPackV8FreeClaimCreatedPassCount: 1,
    expansionPackV8FreeClaimPaidAtomic: '0',
    expansionPackV8WalletAcceptance: true,
    expansionPackV8RenderAcceptance: true,
  };
}

test('current Mainnet v8 tuple is fully evidenced and exclusively enabled', async () => {
  const current = await currentMainnetTuple();
  assert.equal(current.config.expansionPackV8CallablePackageId, MAINNET_V8.packageId);
  assert.equal(current.config.expansionPackV8TypeOriginPackageId, MAINNET_V8.typeOriginPackageId);
  assert.equal(current.config.independentExtensionV5TypeOriginPackageId, MAINNET_V8.packageId);
  assert.equal(current.config.legacyLogicalV5TypeOriginPackageId, MAINNET_V8.packageId);
  assert.equal(current.config.independentExtensionAuthorityV5Id, MAINNET_V8.authorityId);
  assert.equal(current.config.expansionPackV8ReleaseEnabled, true);
  assert.equal(current.deployment.expansionPackV8CallablePackageId, MAINNET_V8.packageId);
  assert.equal(current.deployment.expansionPackV8TypeOriginPackageId, MAINNET_V8.typeOriginPackageId);
  assert.equal(current.deployment.expansionPackV8ReleaseEnabled, true);
  assert.equal(current.deployment.releases.expansionPackV8.callablePackageId, MAINNET_V8.packageId);
  assert.equal(current.deployment.releases.expansionPackV8.typeOriginPackageId, MAINNET_V8.typeOriginPackageId);
  assert.equal(current.deployment.releases.expansionPackV8.upgradeTxDigest, MAINNET_V8.upgradeTxDigest);
  assert.equal(current.deployment.releases.expansionPackV8.upgradeCheckpoint, MAINNET_V8.upgradeCheckpoint);
  assert.equal(current.deployment.releases.expansionPackV8.upgradedAtMs, MAINNET_V8.upgradedAtMs);
  assert.equal(current.deployment.releases.expansionPackV8.sourceCommit, MAINNET_V8.sourceCommit);
  assert.equal(current.deployment.releases.expansionPackV8.sourceTree, MAINNET_V8.sourceTree);
  assert.equal(current.deployment.releases.expansionPackV8.packageDigest, MAINNET_V8.packageDigest);
  assert.equal(
    current.deployment.releases.expansionPackV8.parentFinalization.transactionDigest,
    MAINNET_V8.parentFinalizationTxDigest,
  );
  assert.equal(
    current.deployment.releases.expansionPackV8.parentFinalization.checkpoint,
    MAINNET_V8.parentFinalizationCheckpoint,
  );
  assert.equal(
    current.deployment.releases.expansionPackV8.parentFinalization.authorityId,
    MAINNET_V8.authorityId,
  );
  assert.equal(current.deployment.releases.expansionPackV8.enabled, true);
  assert.equal(current.deployment.verification.expansionPackV8PackageReadBack, true);
  assert.equal(current.deployment.verification.expansionPackV8Enabled, true);
  assert.equal(expansionPackV8Declared(current.config, current.deployment), true);
  assert.deepEqual(inspectExpansionPackV8Deployment(
    current.config,
    current.deployment,
  ), {
    declared: true,
    ready: true,
    runtimeMissing: [],
    runtimeInvalid: [],
    deploymentMissing: [],
    deploymentInvalid: [],
    mismatches: [],
  });
});

test('required v8 preflight accepts the fully evidenced enabled record', async () => {
  const current = await currentMainnetTuple();
  const status = inspectExpansionPackV8Deployment(
    current.config,
    current.deployment,
    { required: true },
  );
  assert.equal(status.declared, true);
  assert.equal(status.ready, true, JSON.stringify(status, null, 2));
  assert.deepEqual(status.runtimeMissing, []);
  assert.deepEqual(status.runtimeInvalid, []);
  assert.deepEqual(status.deploymentMissing, []);
  assert.deepEqual(status.deploymentInvalid, []);
  assert.deepEqual(status.mismatches, []);
  const parentEvidence = await inspectExpansionPackV8ParentFinalizationEvidence(
    current.deployment,
  );
  assert.equal(parentEvidence.ready, true, parentEvidence.detail);
  const retirement = inspectCompositionV6RetirementEvidence(current.deployment);
  assert.equal(retirement.ready, true, retirement.detail);
  assert.equal(retirement.retiredEntryPoints.length, 19);
  assert.equal(new Set(retirement.retiredEntryPoints).size, 19);
});

test('current activation block binds the exact pre-gate receipt and readback', async () => {
  const current = await currentMainnetTuple();
  const activation = current.deployment.releases.expansionPackV8.activation;
  assert.equal(current.config.expansionPackV8ReleaseEnabled, true);
  assert.equal(current.deployment.releases.expansionPackV8.enabled, true);
  assert.equal(current.deployment.verification.expansionPackV8Enabled, true);
  assert.equal(activation.lifecycle, 'ACTIVE');
  assert.equal(activation.accessMode, 'FREE');
  assert.equal(activation.sealPolicyId, '');
  const status = await inspectExpansionPackV8ActivationEvidence(current.deployment);
  assert.equal(status.declared, true);
  assert.equal(status.ready, true, status.detail);
  assert.deepEqual(status.failures, []);
});

test('gate=true fails closed without activation evidence', async () => {
  const record = deployment();
  delete record.releases.expansionPackV8.activation;
  const status = await inspectExpansionPackV8ActivationEvidence(record, { required: true });
  assert.equal(status.declared, false);
  assert.equal(status.ready, false);
  assert.deepEqual(status.failures, ['activation evidence is missing']);
});

test('required post-claim evidence fails closed while the activation artifact stays valid', async () => {
  const current = await currentMainnetTuple();
  const before = structuredClone(current.deployment.releases.expansionPackV8.activation);
  const status = inspectExpansionPackV8Deployment(current.config, current.deployment, {
    required: true,
    requirePostClaim: true,
  });
  assert.equal(status.ready, false);
  assert.ok(status.deploymentMissing.includes(
    'releases.expansionPackV8.postClaim.schemaVersion',
  ));
  const external = await inspectExpansionPackV8PostClaimEvidence(current.deployment, {
    required: true,
  });
  assert.equal(external.ready, false);
  assert.deepEqual(external.failures, ['post-claim evidence is missing']);
  assert.deepEqual(current.deployment.releases.expansionPackV8.activation, before);
  assert.equal(
    (await inspectExpansionPackV8ActivationEvidence(current.deployment)).ready,
    true,
  );
});

test('post-claim schema binds the mutable Release and exact FREE wallet Pass', async () => {
  const current = await currentMainnetTuple();
  const record = structuredClone(current.deployment);
  const activation = record.releases.expansionPackV8.activation;
  record.releases.expansionPackV8.postClaim = postClaim(activation, {
    claimedAtMs: '1800000000000',
    claimedAtUtc: '2027-01-15T08:00:00.000Z',
  });
  record.observedChainState.observedThroughCheckpoint =
    record.releases.expansionPackV8.postClaim.checkpoint;
  Object.assign(record.verification, postClaimVerification());
  const status = inspectExpansionPackV8Deployment(current.config, record, {
    requirePostClaim: true,
  });
  assert.equal(status.ready, true, JSON.stringify(status, null, 2));
  assert.equal(activation.entitlementCount, 0);
  assert.equal(activation.passCountForTestWallet, 0);

  const drift = structuredClone(record);
  drift.releases.expansionPackV8.postClaim.holder = '0xbad';
  drift.releases.expansionPackV8.postClaim.paidAtomic = '1';
  drift.releases.expansionPackV8.postClaim.entitlementCount = 2;
  const rejected = inspectExpansionPackV8Deployment(current.config, drift);
  for (const field of ['holder', 'paidAtomic', 'entitlementCount']) {
    assert.ok(rejected.deploymentInvalid.includes(
      `releases.expansionPackV8.postClaim.${field}`,
    ), field);
  }
});

test('post-claim external evidence validator binds semantic hashes and acceptance artifacts', async () => {
  const current = await currentMainnetTuple();
  const record = structuredClone(current.deployment);
  const activation = record.releases.expansionPackV8.activation;
  const claim = postClaim(activation);
  record.releases.expansionPackV8.postClaim = claim;
  const receipt = {
    schemaVersion: 'animacraft.expansion-pack-v8-free-claim-receipt.v1',
    status: 'success', chainIdentifier: claim.chainIdentifier,
    transactionDigest: claim.transactionDigest, checkpoint: claim.checkpoint,
    checkpointDigest: claim.checkpointDigest, claimedAtMs: claim.claimedAtMs,
    releaseId: claim.releaseId, releaseObjectVersion: claim.releaseObjectVersion,
    releaseObjectDigest: claim.releaseObjectDigest, entitlementCount: 1,
    walletAddress: claim.walletAddress, passId: claim.passId,
    passObjectVersion: claim.passObjectVersion, passObjectDigest: claim.passObjectDigest,
    holder: claim.holder, parentRootId: claim.parentRootId, paidAtomic: '0',
    issuedAtMs: claim.issuedAtMs,
    admittedParentOwnershipEpoch: claim.admittedParentOwnershipEpoch,
    contentCommitment: claim.contentCommitment, createdPassCount: 1,
    entitlementEventCount: 1,
  };
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  };
  receipt.receiptSha256 = createHash('sha256')
    .update(JSON.stringify(stable(receipt))).digest('hex');
  claim.receiptEvidence.contentSha256 = receipt.receiptSha256;
  const readback = {
    schemaVersion: 'animacraft.expansion-pack-v8-post-claim-mainnet-readback.v1',
    network: { chainIdentifier: claim.chainIdentifier },
    source: {},
    claim: {
      transactionDigest: claim.transactionDigest, checkpoint: claim.checkpoint,
      checkpointDigest: claim.checkpointDigest, claimedAtMs: claim.claimedAtMs,
      createdPassCount: 1, entitlementEventCount: 1,
    },
    release: {
      releaseId: claim.releaseId, objectVersion: claim.releaseObjectVersion,
      objectDigest: claim.releaseObjectDigest, entitlementCount: 1,
      lifecycle: activation.lifecycle, accessMode: activation.accessMode,
    },
    pass: {
      passId: claim.passId, objectVersion: claim.passObjectVersion,
      objectDigest: claim.passObjectDigest, holder: claim.holder,
      releaseId: claim.releaseId, parentRootId: claim.parentRootId,
      paidAtomic: '0', issuedAtMs: claim.issuedAtMs,
      admittedParentOwnershipEpoch: claim.admittedParentOwnershipEpoch,
      contentCommitment: claim.contentCommitment,
    },
    passCountForTestWallet: 1,
    readbackVerified: true,
  };
  const wallet = {
    schemaVersion: 'animacraft.expansion-pack-v8-wallet-acceptance.v1',
    status: 'pass', chainIdentifier: claim.chainIdentifier,
    releaseId: claim.releaseId, walletAddress: claim.walletAddress,
    passId: claim.passId, transactionDigest: claim.transactionDigest,
    contentCommitment: claim.contentCommitment, passVisible: true,
    packAccessible: true, existingPassReused: true,
  };
  const render = {
    schemaVersion: 'animacraft.expansion-pack-v8-render-evidence.v1',
    status: 'pass', releaseId: claim.releaseId, walletAddress: claim.walletAddress,
    passId: claim.passId, contentCommitment: claim.contentCommitment,
    partKey: activation.style.partKey, itemKey: activation.style.itemKey,
    styleKey: activation.style.styleKey, assetSha256: activation.style.assetSha256,
    artifactPath: claim.renderEvidence.artifactPath,
    artifactSha256: claim.renderEvidence.artifactSha256,
    assetLoaded: true, sceneRendered: true,
  };
  const values = new Map([
    [claim.receiptEvidence.path, receipt], [claim.readbackEvidence.path, readback],
    [claim.walletAcceptanceEvidence.path, wallet], [claim.renderEvidence.path, render],
  ]);
  const bytes = new Map([...values].map(([path, value]) => [
    path, Buffer.from(JSON.stringify(value)),
  ]));
  bytes.set(claim.renderEvidence.artifactPath, Buffer.from('rendered-pixels'));
  claim.receiptEvidence.fileSha256 = createHash('sha256').update(bytes.get('claim.json')).digest('hex');
  claim.readbackEvidence.fileSha256 = createHash('sha256').update(bytes.get('readback.json')).digest('hex');
  claim.walletAcceptanceEvidence.fileSha256 = createHash('sha256').update(bytes.get('wallet.json')).digest('hex');
  claim.renderEvidence.fileSha256 = createHash('sha256').update(bytes.get('render.json')).digest('hex');
  claim.renderEvidence.artifactSha256 = createHash('sha256').update(bytes.get('render.png')).digest('hex');
  render.artifactSha256 = claim.renderEvidence.artifactSha256;
  bytes.set('render.json', Buffer.from(JSON.stringify(render)));
  claim.renderEvidence.fileSha256 = createHash('sha256').update(bytes.get('render.json')).digest('hex');
  readback.source.claimReceiptFileSha256 = claim.receiptEvidence.fileSha256;
  readback.source.claimReceiptContentSha256 = claim.receiptEvidence.contentSha256;
  bytes.set('readback.json', Buffer.from(JSON.stringify(readback)));
  claim.readbackEvidence.fileSha256 = createHash('sha256').update(bytes.get('readback.json')).digest('hex');
  const loader = async (descriptor) => ({
    bytes: bytes.get(descriptor.path), value: values.get(descriptor.path) || null,
  });
  const accepted = await inspectExpansionPackV8PostClaimEvidence(record, { loader });
  assert.equal(accepted.ready, true, accepted.detail);
  const tampered = structuredClone(record);
  tampered.releases.expansionPackV8.postClaim.passId = '0xc002';
  const rejected = await inspectExpansionPackV8PostClaimEvidence(tampered, { loader });
  assert.equal(rejected.ready, false);
  assert.ok(rejected.failures.some((failure) => /Pass mismatch/.test(failure)));
});

test('present activation evidence fails closed on external evidence drift', async () => {
  const current = await currentMainnetTuple();
  const record = structuredClone(current.deployment);
  record.releases.expansionPackV8.activation.receiptEvidence.fileSha256 = '0'.repeat(64);
  record.releases.expansionPackV8.activation.readbackEvidence.path = 'missing-readback.json';
  const status = await inspectExpansionPackV8ActivationEvidence(record);
  assert.equal(status.declared, true);
  assert.equal(status.ready, false);
  assert.ok(status.failures.includes('ceremony receipt file SHA-256 mismatch'));
  assert.ok(status.failures.some((failure) => failure.startsWith('Mainnet readback unavailable:')));
});

test('present activation schema fails closed on immutable tuple drift while gate stays false', async () => {
  const current = await currentMainnetTuple();
  const record = structuredClone(current.deployment);
  record.releases.expansionPackV8.activation.lifecycle = 'PAUSED';
  record.releases.expansionPackV8.activation.style.assetSealId = 'not-empty';
  const status = inspectExpansionPackV8Deployment(current.config, record);
  assert.equal(status.ready, false);
  assert.ok(status.deploymentInvalid.includes(
    'releases.expansionPackV8.activation.lifecycle',
  ));
  assert.ok(status.deploymentInvalid.includes(
    'releases.expansionPackV8.activation.style.assetSealId',
  ));
});

test('live activation verifier accepts exact Pack, transaction, Blob and Walrus bytes', async () => {
  const current = await currentMainnetTuple();
  const activation = current.deployment.releases.expansionPackV8.activation;
  let transactionRequest;
  const client = {
    ledgerService: {
      getTransaction: async (request) => {
        transactionRequest = request;
        return { response: { transaction: {
          digest: activation.transactionDigest,
          checkpoint: BigInt(activation.checkpoint),
          effects: { status: { success: true } },
          events: { events: [{
            eventType: `${current.config.expansionPackV8TypeOriginPackageId}`
              + '::expansion_pack_v8::ExpansionPackLifecycleChangedV8',
            json: {
              kind: {
                oneofKind: 'structValue',
                structValue: { fields: {
                  release_id: { kind: { oneofKind: 'stringValue', stringValue: activation.releaseId } },
                  previous_lifecycle: { kind: { oneofKind: 'numberValue', numberValue: 2 } },
                  lifecycle: { kind: { oneofKind: 'numberValue', numberValue: 3 } },
                } },
              },
            },
          }] },
        } } };
      },
    },
  };
  const release = {
    objectId: activation.releaseId,
    adminCapId: activation.adminCapId,
    treasuryId: activation.treasuryId,
    creator: activation.creator,
    parentRootId: activation.parentRootId,
    parentLegacyMakerId: activation.parentLegacyMakerId,
    admittedBy: activation.admittedBy,
    admittedParentOwnershipEpoch: 1n,
    packId: activation.packId,
    namespace: activation.namespace,
    packVersion: activation.version,
    accessKind: 0,
    purchasePriceAtomic: 0n,
    lifecycle: 3,
    manifestBlobId: activation.manifestBlobId,
    manifestSha256: activation.manifestSha256,
    contentCommitment: activation.contentCommitment,
    styleRegistryCommitment: activation.styleRegistryCommitment,
    styleCount: 1n,
    entitlementCount: 0n,
    sealPolicyId: '', sealPackageId: '', sealReleaseCommitment: '',
  };
  const bytes = new Map(activation.walrus.files.map((file) => [
    file.patchId,
    Buffer.alloc(file.byteLength),
  ]));
  // Use the declared hashes by substituting a minimal Response-like body and
  // node crypto-compatible bytes only in the negative test below; the live
  // success path uses real durable evidence bytes tested by the file verifier.
  const status = await inspectExpansionPackV8LiveActivation(client, current.config, current.deployment, {
    readers: {
      objects: async () => ({
        release,
        adminCap: { objectId: activation.adminCapId, releaseId: activation.releaseId,
          creator: activation.creator, owner: activation.creator },
        treasury: { objectId: activation.treasuryId, releaseId: activation.releaseId,
          balanceAtomic: 0n, totalCollectedAtomic: 0n, totalWithdrawnAtomic: 0n },
      }),
      styles: async () => [activation.style],
      blob: async () => ({ id: activation.walrus.blobObjectId,
        registered_epoch: activation.walrus.registeredEpoch,
        certified_epoch: activation.walrus.certifiedEpoch, deletable: false }),
    },
    fetchImpl: async (url) => {
      const patchId = String(url).split('/').at(-1);
      const file = activation.walrus.files.find((entry) => entry.patchId === patchId);
      // Override the test descriptor to bind the deterministic mock bytes.
      const body = bytes.get(patchId);
      file.sha256 = createHash('sha256').update(body).digest('hex');
      return { ok: true, arrayBuffer: async () => body };
    },
  });
  assert.equal(status.ready, true, status.detail);
  assert.deepEqual(transactionRequest, {
    digest: activation.transactionDigest,
    readMask: { paths: ['digest', 'effects.status', 'events', 'checkpoint'] },
  });
});

test('live activation verifier rejects Pack and certified Blob drift', async () => {
  const current = await currentMainnetTuple();
  const activation = current.deployment.releases.expansionPackV8.activation;
  const status = await inspectExpansionPackV8LiveActivation(null, current.config, current.deployment, {
    readers: {
      objects: async () => { throw new Error('release drift'); },
      transaction: async () => ({
        digest: 'wrong', checkpoint: '1', effects: { status: { success: false } }, events: [],
      }),
      blob: async () => ({ id: activation.walrus.blobObjectId, registered_epoch: 37,
        certified_epoch: null, deletable: false }),
    },
    fetchImpl: async () => ({ ok: false, arrayBuffer: async () => new Uint8Array() }),
  });
  assert.equal(status.ready, false);
  assert.ok(status.failures.some((failure) => failure.includes('Pack object readback failed')));
  assert.ok(status.failures.includes('Activation transaction mismatch'));
  assert.ok(status.failures.includes('Walrus certified epoch mismatch'));
});

test('live activation verifier rejects duplicate or non-ADMITTED lifecycle events', async () => {
  const current = await currentMainnetTuple();
  const activation = current.deployment.releases.expansionPackV8.activation;
  const lifecycleEvent = (previousLifecycle) => ({
    eventType: `${current.config.expansionPackV8TypeOriginPackageId}`
      + '::expansion_pack_v8::ExpansionPackLifecycleChangedV8',
    json: {
      release_id: activation.releaseId,
      previous_lifecycle: previousLifecycle,
      lifecycle: 3,
    },
  });
  const verify = (events) => inspectExpansionPackV8LiveActivation(null, current.config, current.deployment, {
    readers: {
      objects: async () => { throw new Error('irrelevant'); },
      transaction: async () => ({
        digest: activation.transactionDigest,
        checkpoint: activation.checkpoint,
        effects: { status: { success: true } },
        events,
      }),
      blob: async () => { throw new Error('irrelevant'); },
    },
    fetchImpl: async () => { throw new Error('irrelevant'); },
  });
  const wrongTransition = await verify([lifecycleEvent(1)]);
  assert.ok(wrongTransition.failures.includes('Activation transaction mismatch'));
  const duplicate = await verify([lifecycleEvent(2), lifecycleEvent(2)]);
  assert.ok(duplicate.failures.includes('Activation transaction mismatch'));
});

test('live verifier uses post-claim Release state and proves the exact created wallet Pass', async () => {
  const current = await currentMainnetTuple();
  const record = structuredClone(current.deployment);
  const activation = record.releases.expansionPackV8.activation;
  const claim = postClaim(activation);
  record.releases.expansionPackV8.postClaim = claim;
  const release = {
    objectId: activation.releaseId, adminCapId: activation.adminCapId,
    treasuryId: activation.treasuryId, creator: activation.creator,
    parentRootId: activation.parentRootId,
    parentLegacyMakerId: activation.parentLegacyMakerId,
    admittedBy: activation.admittedBy, admittedParentOwnershipEpoch: 1n,
    packId: activation.packId, namespace: activation.namespace,
    packVersion: activation.version, accessKind: 0, purchasePriceAtomic: 0n,
    lifecycle: 3, manifestBlobId: activation.manifestBlobId,
    manifestSha256: activation.manifestSha256,
    contentCommitment: activation.contentCommitment,
    styleRegistryCommitment: activation.styleRegistryCommitment,
    styleCount: 1n, entitlementCount: 1n,
    sealPolicyId: '', sealPackageId: '', sealReleaseCommitment: '',
  };
  const pass = {
    objectId: claim.passId, releaseId: claim.releaseId,
    parentRootId: claim.parentRootId, holder: claim.holder,
    paidAtomic: 0n, issuedAtMs: BigInt(claim.issuedAtMs),
    admittedParentOwnershipEpoch: BigInt(claim.admittedParentOwnershipEpoch),
    contentCommitment: claim.contentCommitment,
  };
  const activationEvent = {
    eventType: `${current.config.expansionPackV8TypeOriginPackageId}`
      + '::expansion_pack_v8::ExpansionPackLifecycleChangedV8',
    json: { release_id: activation.releaseId, previous_lifecycle: 2, lifecycle: 3 },
  };
  const entitlementEvent = {
    eventType: `${current.config.expansionPackV8TypeOriginPackageId}`
      + '::expansion_pack_v8::ExpansionPackEntitlementGrantedV8',
    json: {
      release_id: claim.releaseId, parent_root_id: claim.parentRootId,
      holder: claim.holder, paid_atomic: '0', pass_id: claim.passId,
      admitted_parent_ownership_epoch: claim.admittedParentOwnershipEpoch,
    },
  };
  const bytes = new Map(activation.walrus.files.map((file) => [
    file.patchId, Buffer.alloc(file.byteLength),
  ]));
  const status = await inspectExpansionPackV8LiveActivation(
    null,
    current.config,
    record,
    {
      readers: {
        objects: async () => ({
          release,
          adminCap: { objectId: activation.adminCapId, releaseId: activation.releaseId,
            creator: activation.creator, owner: activation.creator },
          treasury: { objectId: activation.treasuryId, releaseId: activation.releaseId,
            balanceAtomic: 0n, totalCollectedAtomic: 0n, totalWithdrawnAtomic: 0n },
          pass,
          raw: [
            { version: claim.releaseObjectVersion, digest: claim.releaseObjectDigest },
            { version: activation.adminCapObjectVersion, digest: activation.adminCapObjectDigest },
            { version: activation.treasuryObjectVersion, digest: activation.treasuryObjectDigest },
            { version: claim.passObjectVersion, digest: claim.passObjectDigest },
          ],
        }),
        styles: async () => [activation.style],
        transaction: async () => ({ digest: activation.transactionDigest,
          checkpoint: activation.checkpoint, effects: { status: { success: true } },
          events: [activationEvent] }),
        claimTransaction: async () => ({
          digest: claim.transactionDigest, checkpoint: claim.checkpoint,
          effects: { status: { success: true }, changedObjects: [{
            objectId: claim.passId, idOperation: 'Created',
          }] },
          events: [entitlementEvent],
          objectTypes: {
            [claim.passId]: `${current.config.expansionPackV8TypeOriginPackageId}`
              + '::expansion_pack_v8::ExpansionPackPassV8',
          },
        }),
        blob: async () => ({ id: activation.walrus.blobObjectId,
          registered_epoch: activation.walrus.registeredEpoch,
          certified_epoch: activation.walrus.certifiedEpoch, deletable: false }),
      },
      fetchImpl: async (url) => {
        const patchId = String(url).split('/').at(-1);
        const body = bytes.get(patchId);
        const file = activation.walrus.files.find((entry) => entry.patchId === patchId);
        file.sha256 = createHash('sha256').update(body).digest('hex');
        return { ok: true, arrayBuffer: async () => body };
      },
    },
  );
  assert.equal(status.ready, true, status.detail);

  const stale = structuredClone(record);
  stale.releases.expansionPackV8.postClaim.releaseObjectDigest = activation.releaseObjectDigest;
  const rejected = await inspectExpansionPackV8LiveActivation(null, current.config, stale, {
    readers: {
      objects: async () => ({ release, adminCap: {}, treasury: {}, pass, raw: [
        { version: claim.releaseObjectVersion, digest: claim.releaseObjectDigest }, {}, {}, {},
      ] }),
      transaction: async () => { throw new Error('irrelevant'); },
      claimTransaction: async () => { throw new Error('irrelevant'); },
      blob: async () => { throw new Error('irrelevant'); },
      styles: async () => [],
    },
    fetchImpl: async () => { throw new Error('irrelevant'); },
  });
  assert.ok(rejected.failures.includes('Release object digest mismatch'));
});

test('enabled v8 requires one exact runtime, release and verification evidence tuple', () => {
  const status = inspectExpansionPackV8Deployment(runtime(), deployment());
  assert.equal(status.declared, true);
  assert.equal(status.ready, true, JSON.stringify(status, null, 2));
  assert.deepEqual(status.runtimeMissing, []);
  assert.deepEqual(status.deploymentMissing, []);
  assert.deepEqual(status.deploymentInvalid, []);
  assert.deepEqual(status.mismatches, []);
});

test('a finalized gate-false v8 deployment rejects a missing Authority', () => {
  const config = runtime({
    independentExtensionAuthorityV5Id: '',
    expansionPackV8ReleaseEnabled: false,
  });
  const record = deployment({
    independentExtensionAuthorityV5Id: '',
    expansionPackV8ReleaseEnabled: false,
  });
  record.releases.expansionPackV8.enabled = false;
  record.verification.expansionPackV8Enabled = false;
  const status = inspectExpansionPackV8Deployment(config, record);
  assert.equal(status.declared, true);
  assert.equal(status.ready, false);
  assert.ok(status.runtimeMissing.includes('independentExtensionAuthorityV5Id'));
  assert.ok(status.deploymentMissing.includes('independentExtensionAuthorityV5Id'));
});

test('a finalized gate-false v8 deployment rejects Authority and audit drift', () => {
  const record = deployment();
  record.releases.expansionPackV8.parentFinalization.authorityId = '0xa889';
  record.releases.expansionPackV8.parentFinalization.auditHash = 'z'.repeat(64);
  record.releases.expansionPackV8.enabled = false;
  record.expansionPackV8ReleaseEnabled = false;
  record.verification.expansionPackV8Enabled = false;
  const status = inspectExpansionPackV8Deployment(
    runtime({ expansionPackV8ReleaseEnabled: false }),
    record,
    { required: true },
  );
  assert.equal(status.ready, false);
  assert.ok(status.mismatches.includes(
    'releases.expansionPackV8.parentFinalization.authorityId',
  ));
  assert.ok(status.deploymentInvalid.includes(
    'releases.expansionPackV8.parentFinalization.auditHash',
  ));
});

test('a finalized gate-false v8 deployment rejects stale finalization claims', () => {
  const record = deployment();
  record.verification.expansionPackV8ParentAuthorityShared = false;
  record.verification.expansionPackV8ParentControlCapDeleted = false;
  const status = inspectExpansionPackV8Deployment(runtime(), record);
  assert.equal(status.ready, false);
  assert.ok(status.deploymentInvalid.includes(
    'verification.expansionPackV8ParentAuthorityShared',
  ));
  assert.ok(status.deploymentInvalid.includes(
    'verification.expansionPackV8ParentControlCapDeleted',
  ));
});

test('a finalized v8 deployment rejects lifecycle, registry and gas drift', () => {
  const record = deployment();
  const evidence = record.releases.expansionPackV8.parentFinalization;
  evidence.lifecycle = 'ACTIVE';
  evidence.styleCounts.total = 25;
  evidence.gasUsedMist = '251';
  const status = inspectExpansionPackV8Deployment(runtime(), record);
  assert.equal(status.ready, false);
  for (const field of [
    'releases.expansionPackV8.parentFinalization.lifecycle',
    'releases.expansionPackV8.parentFinalization.styleCounts.total',
    'releases.expansionPackV8.parentFinalization.gasUsedMist',
  ]) assert.ok(status.deploymentInvalid.includes(field), field);
});

test('required gate-false v8 fails closed without independent-extension TypeOrigin evidence', () => {
  const config = runtime({
    independentExtensionV5TypeOriginPackageId: '',
    expansionPackV8ReleaseEnabled: false,
  });
  const record = deployment({
    independentExtensionV5TypeOriginPackageId: '',
    expansionPackV8ReleaseEnabled: false,
  });
  record.releases.expansionPackV8.independentExtensionV5TypeOriginPackageId = '';
  record.releases.expansionPackV8.enabled = false;
  record.verification.expansionPackV8Enabled = false;
  const status = inspectExpansionPackV8Deployment(config, record, {
    required: true,
  });
  assert.equal(status.ready, false);
  assert.deepEqual(status.runtimeMissing, [
    'independentExtensionV5TypeOriginPackageId',
  ]);
  assert.deepEqual(status.deploymentMissing, [
    'independentExtensionV5TypeOriginPackageId',
    'releases.expansionPackV8.independentExtensionV5TypeOriginPackageId',
  ]);
});

test('enabled v8 rejects independent-extension TypeOrigin drift', () => {
  const record = deployment({
    independentExtensionV5TypeOriginPackageId: '0x6007',
  });
  const status = inspectExpansionPackV8Deployment(runtime(), record, {
    required: true,
  });
  assert.equal(status.ready, false);
  assert.deepEqual(status.mismatches, [
    'independentExtensionV5TypeOriginPackageId',
  ]);
});

test('v8 rejects an explicit false package read-back claim', () => {
  const record = deployment();
  record.verification.expansionPackV8PackageReadBack = false;
  const status = inspectExpansionPackV8Deployment(runtime(), record);
  assert.equal(status.ready, false);
  assert.deepEqual(status.deploymentMissing, []);
  assert.deepEqual(status.deploymentInvalid, [
    'verification.expansionPackV8PackageReadBack',
  ]);
});

test('v8 rejects an incorrect deployed package version', () => {
  const record = deployment();
  record.releases.expansionPackV8.packageVersion = 5;
  const status = inspectExpansionPackV8Deployment(runtime(), record);
  assert.equal(status.ready, false);
  assert.deepEqual(status.deploymentMissing, []);
  assert.deepEqual(status.deploymentInvalid, [
    'releases.expansionPackV8.packageVersion',
  ]);
});

test('v8 package ABI read-back queries the callable module and stable TypeOrigin', async () => {
  const { client, requests } = packageAbiClient();
  const status = await inspectExpansionPackV8PackageAbi(
    client,
    CALLABLE,
    TYPE_ORIGIN,
    TYPE_ORIGINS,
  );
  assert.equal(status.ready, true, status.detail);
  assert.deepEqual(
    requests
      .filter((request) => request.kind === 'function')
      .map(({ packageId, moduleName, name }) => ({ packageId, moduleName, name })),
    Object.entries(ABI_FUNCTION_SPECS).map(([name, spec]) => ({
      packageId: CALLABLE,
      moduleName: spec.moduleName,
      name,
    })),
  );
  assert.deepEqual(
    requests
      .filter((request) => request.kind === 'datatype')
      .map(({ packageId, moduleName, name }) => ({ packageId, moduleName, name })),
    [
      ...ABI_DATATYPES,
      ...ABI_UPGRADE_DATATYPES,
      ...ABI_INDEPENDENT_EXTENSION_DATATYPES,
      ['commerce_v5', 'MakerReleaseEvidenceV5'],
    ].map(([moduleName, name]) => ({
      packageId: CALLABLE,
      moduleName,
      name,
    })),
  );
});

test('v8 package ABI read-back proves Complete and physical surfaces stay fail-closed', async () => {
  for (const mock of [
    packageAbiClient({ completeBridgeEnabled: true }),
    packageAbiClient({ physicalBridgeEnabled: true }),
    packageAbiClient({ companionProofAvailable: true }),
    packageAbiClient({ completeBridgeAssertionAborts: false }),
    packageAbiClient({ physicalBridgeAssertionAborts: false }),
    packageAbiClient({ companionVersion: 7 }),
    packageAbiClient({ missingFunction: 'companion_proof_available_v8' }),
    packageAbiClient({ driftDatatype: 'ExpansionPackCompleteProvenanceV8' }),
  ]) {
    try {
      const status = await inspectExpansionPackV8PackageAbi(
        mock.client,
        CALLABLE,
        TYPE_ORIGIN,
        TYPE_ORIGINS,
      );
      assert.equal(status.ready, false, status.detail);
    } catch (error) {
      assert.match(error.message, /ABI is missing/);
    }
  }
});

test('v8 package ABI read-back rejects missing entry points, critical argument drift and TypeOrigin drift', async () => {
  for (const mock of [
    packageAbiClient({ version: 7 }),
    packageAbiClient({ createParameterCount: 12 }),
    packageAbiClient({ releaseTypeOrigin: CALLABLE }),
    packageAbiClient({ driftDatatype: 'IndependentExtensionAuthorityV5' }),
    packageAbiClient({ missingDatatype: 'IndependentExtensionLockStateV5' }),
    packageAbiClient({ driftDatatype: 'LegacyLogicalStyleRegisteredV5' }),
    packageAbiClient({ missingFunction: 'purchase_expansion_pack_v8' }),
    packageAbiClient({ driftVisibilityFunction: 'purchase_expansion_pack_v8' }),
    packageAbiClient({ driftEntryFunction: 'seal_approve_style_v8' }),
    packageAbiClient({ driftEntryFunction: 'purchase_expansion_pack_v8' }),
    packageAbiClient({ missingFunction: 'finalize_independent_extension_root_v5' }),
    packageAbiClient({ driftVisibilityFunction: 'finalize_independent_extension_root_v5' }),
    packageAbiClient({ missingFunction: 'admit_expansion_pack_with_authority_v8' }),
    packageAbiClient({ driftVisibilityFunction: 'admit_expansion_pack_with_authority_v8' }),
    packageAbiClient({
      driftFunction: 'create_expansion_pack_v8',
      driftParameterIndex: 0,
      driftParameterValue: moveDatatype(
        `${TYPE_ORIGIN}::commerce_v5::MakerRootV5`,
        [],
        'immutable',
      ),
    }),
    packageAbiClient({
      driftFunction: 'create_expansion_pack_v8',
      driftParameterIndex: 1,
      driftParameterValue: moveDatatype(
        `${TYPE_ORIGIN}::animacraft::OCMaker`,
        [],
        'immutable',
      ),
    }),
    packageAbiClient({
      driftFunction: 'seal_approve_style_v8',
      driftParameterIndex: 2,
    }),
  ]) {
    try {
      const status = await inspectExpansionPackV8PackageAbi(
        mock.client,
        CALLABLE,
        TYPE_ORIGIN,
        TYPE_ORIGINS,
      );
      assert.equal(status.ready, false, status.detail);
    } catch (error) {
      assert.match(error.message, /(?:ABI|datatype) is missing/);
    }
  }
});

test('v8 package ABI read-back rejects drift in every value, framework and generic boundary', async () => {
  const drifts = [
    ['create_expansion_pack_v8', 3, 'String'],
    ['create_expansion_pack_v8', 5, 'vector<u8>'],
    ['create_expansion_pack_v8', 12, '&mut TxContext'],
    ['purchase_expansion_pack_v8', 1, '&mut ExpansionPackTreasuryV8<PaymentCoin>'],
    ['purchase_expansion_pack_v8', 4, '&mut CommerceProtocolTreasuryV5<PaymentCoin>'],
    ['purchase_expansion_pack_v8', 5, 'Coin<PaymentCoin>'],
    ['purchase_expansion_pack_v8', 6, '&Clock'],
    ['purchase_expansion_pack_v8', 7, '&mut TxContext'],
    ['withdraw_expansion_pack_revenue_v8', 4, 'address'],
    ['bind_maker_release_evidence_v5', 6, '&TxContext'],
    ['finalize_independent_extension_root_v5', 0, '&mut MakerRootV5'],
    ['finalize_independent_extension_root_v5', 1, '&MakerTreasuryV5<PaymentCoin>'],
    ['finalize_independent_extension_root_v5', 2, 'MakerControlCapV5'],
    ['finalize_independent_extension_root_v5', 6, 'vector<String>'],
    ['finalize_independent_extension_root_v5', 10, 'vector<u8>'],
    ['finalize_independent_extension_root_v5', 11, '&mut TxContext'],
    ['admit_expansion_pack_with_authority_v8', 3, '&IndependentExtensionAuthorityV5'],
    ['admit_expansion_pack_with_authority_v8', 4, '&TxContext'],
  ];
  for (const [driftFunction, driftParameterIndex, label] of drifts) {
    const mock = packageAbiClient({ driftFunction, driftParameterIndex });
    const status = await inspectExpansionPackV8PackageAbi(
      mock.client,
      CALLABLE,
      TYPE_ORIGIN,
      TYPE_ORIGINS,
    );
    assert.equal(status.ready, false, `${label} drift must fail closed`);
  }

  for (const mock of [
    packageAbiClient({ driftTypeParameterFunction: 'purchase_expansion_pack_v8' }),
    packageAbiClient({ driftTypeParameterFunction: 'finalize_independent_extension_root_v5' }),
    packageAbiClient({ driftReturnFunction: 'verify_style_access_v8' }),
    packageAbiClient({ driftReturnFunction: 'check_style_seal_access_v8' }),
  ]) {
    const status = await inspectExpansionPackV8PackageAbi(
      mock.client,
      CALLABLE,
      TYPE_ORIGIN,
      TYPE_ORIGINS,
    );
    assert.equal(status.ready, false, status.detail);
  }
});

test('any partially populated v8 tuple fails closed', () => {
  const status = inspectExpansionPackV8Deployment({
    expansionPackV8CallablePackageId: CALLABLE,
    expansionPackV8TypeOriginPackageId: '',
    expansionPackV8ReleaseEnabled: false,
  }, {
    expansionPackProtocolVersion: 8,
    expansionPackV8CallablePackageId: CALLABLE,
    expansionPackV8TypeOriginPackageId: '',
    expansionPackV8ReleaseEnabled: false,
  });
  assert.equal(status.declared, true);
  assert.equal(status.ready, false);
  assert.deepEqual(status.runtimeMissing, [
    'expansionPackV8TypeOriginPackageId',
    'independentExtensionV5TypeOriginPackageId',
    'legacyLogicalV5TypeOriginPackageId',
    'independentExtensionAuthorityV5Id',
  ]);
  assert.ok(status.deploymentMissing.includes('expansionPackV8TypeOriginPackageId'));
  assert.ok(status.deploymentMissing.includes(
    'releases.expansionPackV8.packageDigest',
  ));
});

test('v8 rejects missing scoped proof and malformed or inconsistent evidence', () => {
  const incomplete = deployment();
  delete incomplete.verification.expansionPackV8SourceStatus;
  const missing = inspectExpansionPackV8Deployment(runtime(), incomplete);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.deploymentMissing, [
    'verification.expansionPackV8SourceStatus',
  ]);

  const divergent = deployment();
  divergent.expansionPackV8TypeOriginPackageId = '0x8999';
  divergent.releases.expansionPackV8.callablePackageId = '0x8777';
  divergent.releases.expansionPackV8.upgradeTxDigest = 'not-a-digest';
  divergent.releases.expansionPackV8.sourceTree = 'c'.repeat(40);
  divergent.verification.expansionPackV8Enabled = false;
  const status = inspectExpansionPackV8Deployment(runtime(), divergent);
  assert.equal(status.ready, false);
  assert.deepEqual(status.deploymentInvalid, [
    'releases.expansionPackV8.upgradeTxDigest',
  ]);
  assert.deepEqual(status.mismatches, [
    'expansionPackV8TypeOriginPackageId',
    'releases.expansionPackV8.callablePackageId',
    'verification.expansionPackV8Enabled',
    'releases.expansionPackV8.upgradeTxDigest',
    'releases.expansionPackV8.sourceTree',
  ]);
});
