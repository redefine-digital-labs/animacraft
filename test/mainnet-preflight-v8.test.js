import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  expansionPackV8Declared,
  inspectExpansionPackV8PackageAbi,
  inspectExpansionPackV8Deployment,
} from '../scripts/mainnet-preflight.mjs';

const CALLABLE = '0x8888';
const TYPE_ORIGIN = '0x8008';
const LEGACY_TYPE_ORIGIN = '0x7007';
const COMMERCE_TYPE_ORIGIN = '0x5005';
const TYPE_ORIGINS = Object.freeze({
  originalPackageId: LEGACY_TYPE_ORIGIN,
  commerceV5TypeOriginPackageId: COMMERCE_TYPE_ORIGIN,
});
const UPGRADE_DIGEST = '1'.repeat(43);
const PACKAGE_DIGEST = '2'.repeat(43);
const SOURCE_COMMIT = 'a'.repeat(40);
const SOURCE_TREE = 'b'.repeat(40);
const MAINNET_V8 = Object.freeze({
  packageId: '0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a',
  upgradeTxDigest: '2ef2pUjBBuhGDTuzVHZwo3ZkqgkqzUc6A2mNnjZeLLTF',
  upgradeCheckpoint: '309641036',
  upgradedAtMs: '1786494456691',
  sourceCommit: '59cae42a8602f54a7b7902aee77971a1dff8a270',
  sourceTree: '794b18902c5d758889baf80431a3f99f59e4a8aa',
  packageDigest: 'Mquf4qbGQ5nFAJhS8MyzGZZbK6bgAnxqUF4jQVdA7kw',
});

function runtime(overrides = {}) {
  return {
    expansionPackV8CallablePackageId: CALLABLE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN,
    expansionPackV8ReleaseEnabled: true,
    ...overrides,
  };
}

function deployment(overrides = {}) {
  return {
    expansionPackProtocolVersion: 8,
    expansionPackV8CallablePackageId: CALLABLE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN,
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
        packageVersion: 6,
        upgradeTxDigest: UPGRADE_DIGEST,
        upgradeCheckpoint: '400000000',
        upgradedAtMs: '1800000000000',
        sourceCommit: SOURCE_COMMIT,
        sourceTree: SOURCE_TREE,
        packageDigest: PACKAGE_DIGEST,
        enabled: true,
      },
    },
    verification: {
      packageDigest: PACKAGE_DIGEST,
      expansionPackV8UpgradeTransactionStatus: 'success',
      expansionPackV8SourceStatus: 'success',
      expansionPackV8PackageReadBack: true,
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
  ['commerce_v5', 'MakerReleaseEvidenceV5'],
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
  const control = () => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'MakerControlCapV5',
  );
  const maker = () => defined(LEGACY_TYPE_ORIGIN, 'animacraft', 'OCMaker');
  const config = () => defined(
    LEGACY_TYPE_ORIGIN,
    'commerce_v5',
    'CommerceProtocolConfigV5',
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
          const known = ABI_DATATYPES.some(([moduleName, name]) => (
            moduleName === request.moduleName && name === request.name
          ));
          if (!known) return { response: { datatype: null } };
          return {
            response: {
              datatype: { definingId: request.name === driftDatatype
                ? CALLABLE
                : request.name === 'ExpansionPackReleaseV8'
                  ? releaseTypeOrigin
                  : TYPE_ORIGIN },
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

test('current Mainnet v8 tuple is fully evidenced while intentionally disabled', async () => {
  const current = await currentMainnetTuple();
  assert.equal(current.config.expansionPackV8CallablePackageId, MAINNET_V8.packageId);
  assert.equal(current.config.expansionPackV8TypeOriginPackageId, MAINNET_V8.packageId);
  assert.equal(current.config.expansionPackV8ReleaseEnabled, false);
  assert.equal(current.deployment.expansionPackV8CallablePackageId, MAINNET_V8.packageId);
  assert.equal(current.deployment.expansionPackV8TypeOriginPackageId, MAINNET_V8.packageId);
  assert.equal(current.deployment.expansionPackV8ReleaseEnabled, false);
  assert.equal(current.deployment.releases.expansionPackV8.callablePackageId, MAINNET_V8.packageId);
  assert.equal(current.deployment.releases.expansionPackV8.typeOriginPackageId, MAINNET_V8.packageId);
  assert.equal(current.deployment.releases.expansionPackV8.upgradeTxDigest, MAINNET_V8.upgradeTxDigest);
  assert.equal(current.deployment.releases.expansionPackV8.upgradeCheckpoint, MAINNET_V8.upgradeCheckpoint);
  assert.equal(current.deployment.releases.expansionPackV8.upgradedAtMs, MAINNET_V8.upgradedAtMs);
  assert.equal(current.deployment.releases.expansionPackV8.sourceCommit, MAINNET_V8.sourceCommit);
  assert.equal(current.deployment.releases.expansionPackV8.sourceTree, MAINNET_V8.sourceTree);
  assert.equal(current.deployment.releases.expansionPackV8.packageDigest, MAINNET_V8.packageDigest);
  assert.equal(current.deployment.releases.expansionPackV8.enabled, false);
  assert.equal(current.deployment.verification.expansionPackV8PackageReadBack, true);
  assert.equal(current.deployment.verification.expansionPackV8Enabled, false);
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

test('required v8 ceremony accepts the fully evidenced gate-false record', async () => {
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

test('a fully evidenced v8 deployment may remain gated off', () => {
  const config = runtime({ expansionPackV8ReleaseEnabled: false });
  const record = deployment({ expansionPackV8ReleaseEnabled: false });
  record.releases.expansionPackV8.enabled = false;
  record.verification.expansionPackV8Enabled = false;
  const status = inspectExpansionPackV8Deployment(config, record);
  assert.equal(status.declared, true);
  assert.equal(status.ready, true, JSON.stringify(status, null, 2));
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
    ABI_DATATYPES.map(([moduleName, name]) => ({
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
    packageAbiClient({ missingFunction: 'purchase_expansion_pack_v8' }),
    packageAbiClient({ driftVisibilityFunction: 'purchase_expansion_pack_v8' }),
    packageAbiClient({ driftEntryFunction: 'seal_approve_style_v8' }),
    packageAbiClient({ driftEntryFunction: 'purchase_expansion_pack_v8' }),
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
      assert.match(error.message, /ABI is missing/);
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
  assert.deepEqual(status.runtimeMissing, ['expansionPackV8TypeOriginPackageId']);
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
