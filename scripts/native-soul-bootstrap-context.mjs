import { isDeepStrictEqual } from 'node:util';
import {
  MAINNET_V8_RELEASE_STEPS, MAINNET_V8_RELEASE_RUNNER_SCHEMA,
  assertMainnetV8FinalManifestContents, mainnetV8CatalogCommitmentsFromFinalManifest,
  nativeSoulBootstrapInputFromStageData,
} from './mainnet-v8-release-lib.mjs';
import { nativeSoulBootstrapPriorKinds } from './native-soul-bootstrap-loader.mjs';
import { decodeNativeSoulBootstrapHistoryObject } from './native-soul-bootstrap-history.mjs';
import { validateNativeSoulBootstrapStageRelations } from './native-soul-bootstrap-relations.mjs';
import { buildNativeSoulBootstrapTransaction, NATIVE_SOUL_BOOTSTRAP_STAGES } from './native-soul-bootstrap-transactions.mjs';
import { NATIVE_SOUL_BOOTSTRAP_USDC_TYPE } from './native-soul-bootstrap-readback.mjs';

function check(value, label) {
  if (!value) { const error = new Error(`Invalid native bootstrap context: ${label}`);
    error.code = 'NATIVE_SOUL_BOOTSTRAP_CONTEXT_INVALID'; throw error; }
}
function exact(value, keys, label) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), label);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function coreEnvelope(output) {
  check(output && output.owner && typeof output.owner === 'object', 'Core historical owner');
  const raw = output.owner;
  let owner;
  if (Object.hasOwn(raw, 'Shared')) {
    exact(raw, ['Shared'], 'Core shared owner'); exact(raw.Shared, ['initial_shared_version'], 'Core shared birth');
    owner = { kind: 'shared', initialSharedVersion: raw.Shared.initial_shared_version };
  } else {
    exact(raw, ['AddressOwner'], 'Core admin owner'); owner = { kind: 'address', address: raw.AddressOwner };
  }
  return { reference: output.reference, type: output.type, owner,
    previousTransaction: output.previousTransaction, objectBcsBase64: output.objectBcsBase64 };
}

/** Pure context projection over ALREADY certified publication/native readbacks.
 * Validates full Object BCS and predecessor continuity, not signatures,
 * checkpoint finality, effects or package publication certificates. Callers must
 * establish those before supplying this inventory. No RPC, READY or execution.
 * The sole release schedule is read at call time (safe in the lib import cycle).
 */
export function deriveNativeSoulBootstrapStageData(args) {
  check(args && Object.getPrototypeOf(args) === Object.prototype, 'arguments');
  const stage = args.stage;
  const schedule = MAINNET_V8_RELEASE_STEPS.filter(row => NATIVE_SOUL_BOOTSTRAP_STAGES.includes(row.kind));
  const index = schedule.findIndex(row => row.kind === stage);
  check(index >= 0, 'native stage');
  exact(args, ['stage', 'manifest', 'plan', 'priorReadbacks', ...(stage === 'SETUP_RELEASE'
    ? ['keyServerCertificates', 'walrusSystem', 'walrusExecution'] : [])], 'stage arguments/external evidence');
  const { manifest, plan, priorReadbacks, keyServerCertificates, walrusSystem, walrusExecution } = structuredClone(args);
  assertMainnetV8FinalManifestContents(manifest, plan);
  check(isDeepStrictEqual(plan.steps, MAINNET_V8_RELEASE_STEPS), 'plan differs from sole release schedule');
  const earlier = schedule.slice(0, index).map(row => row.kind);
  exact(priorReadbacks, ['core', ...earlier], 'exact earlier readbacks');
  const packageIds = Object.fromEntries(manifest.packages.map(row => [row.role, row.packageId]));
  const commitments = mainnetV8CatalogCommitmentsFromFinalManifest(manifest, plan);
  const sender = plan.sender, core = priorReadbacks.core;
  const corePackage = manifest.packages.find(row => row.role === 'core');
  check(core?.schemaVersion === MAINNET_V8_RELEASE_RUNNER_SCHEMA && core.kind === 'PACKAGE_PUBLISH_CERTIFICATE'
    && core.role === 'core' && core.package?.reference?.objectId === packageIds.core
    && core.transactionDigest === corePackage.publishDigest, 'certified Core publication identity');
  const latest = { protocol: coreEnvelope(core.protocolConfig), protocolAdmin: coreEnvelope(core.protocolAdminCap) };
  const decode = (kind, evidence) => decodeNativeSoulBootstrapHistoryObject(evidence, { kind, packageIds });
  const protocol = decode('protocol', latest.protocol), admin = decode('protocolAdmin', latest.protocolAdmin);
  check(protocol.previousTransaction === core.transactionDigest && admin.previousTransaction === core.transactionDigest,
    'Core initialization transaction');
  check(protocol.fields.version === '8' && protocol.fields.core_original_package_id === packageIds.core
    && protocol.fields.core_callable_package_id === packageIds.core && protocol.fields.revision === '0'
    && protocol.fields.enabled === false && protocol.fields.treasury_id === null
    && protocol.fields.payment_coin_type === NATIVE_SOUL_BOOTSTRAP_USDC_TYPE
    && admin.fields.version === '8' && admin.fields.config_id === protocol.reference.objectId
    && admin.object.owner.address === sender, 'fresh Core protocol/admin binding');
  const project = kind => Object.fromEntries(nativeSoulBootstrapPriorKinds(kind).map(key => {
    check(Object.hasOwn(latest, key), `missing predecessor ${key}`);
    decode(key, latest[key]); return [key, latest[key]];
  }));
  const shared = kind => {
    const value = decode(kind, latest[kind]); check(value.object.owner.kind === 'shared', `${kind} shared reference`);
    return { objectId: value.reference.objectId, initialSharedVersion: value.object.owner.initialSharedVersion };
  };
  const owned = kind => {
    const value = decode(kind, latest[kind]);
    check(kind === 'replacement' ? value.object.owner.kind === 'immutable'
      : value.object.owner.kind === 'address' && value.object.owner.address === sender, `${kind} immutable/owned reference`);
    return { ...value.reference };
  };
  const derive = (kind, system, execution) => {
    const input = { packageIds, protocolConfig: shared('protocol'), protocolAdminCap: owned('protocolAdmin') };
    if (kind === 'SETUP_RELEASE') Object.assign(input, { commitments, sealPolicy: manifest.sealPolicy, walrusSystem: system,
      walrusExecution: execution });
    if (kind === 'BEGIN_BOOTSTRAP' || kind === 'FINALIZE_BOOTSTRAP') Object.assign(input,
      { catalog: shared('catalog'), replacement: owned('replacement') });
    if (kind === 'FINALIZE_BOOTSTRAP') Object.assign(input, { bootstrapAdmin: owned('bootstrapAdmin'),
      outputConfig: shared('outputConfig'), marketConfig: shared('marketConfig') });
    buildNativeSoulBootstrapTransaction(kind, input);
    return input;
  };
  for (const previous of earlier) {
    const readback = priorReadbacks[previous];
    exact(readback, ['schema', 'stage', 'input', 'objects', 'priorObjects', 'consensusObjects'], 'native predecessor fields');
    check(readback.schema === 'native-soul-bootstrap-history-v1' && readback.stage === previous, 'native predecessor stage');
    check(isDeepStrictEqual(readback.priorObjects, project(previous)), 'certified predecessor continuity');
    check(isDeepStrictEqual(readback.input, derive(previous, readback.input?.walrusSystem, readback.input?.walrusExecution)), 'predecessor stage input');
    check(readback.objects && Object.getPrototypeOf(readback.objects) === Object.prototype, 'native output map');
    const decoded = Object.fromEntries(Object.entries(readback.objects).map(([kind, evidence]) => [kind, decode(kind, evidence).object]));
    validateNativeSoulBootstrapStageRelations({ stage: previous, input: readback.input, sender, objects: decoded });
    Object.assign(latest, readback.objects);
  }
  const priorObjects = project(stage), stageData = derive(stage, walrusSystem, walrusExecution);
  if (stage === 'SETUP_RELEASE') stageData.keyServerCertificates = keyServerCertificates;
  nativeSoulBootstrapInputFromStageData(stage, stageData);
  return freeze({ stageData, priorObjects });
}

/** Final export inventory from certified stage journals, not a latest-RPC guess.
 * The caller still proves checkpoint finality and successful WAL evidence.
 */
export function deriveNativeSoulFinalBootstrapObjects(args) {
  exact(args, ['manifest', 'plan', 'priorReadbacks', 'finalReadback'], 'final export arguments');
  const { manifest, plan, priorReadbacks, finalReadback } = structuredClone(args);
  const stage = 'FINALIZE_BOOTSTRAP';
  const expected = deriveNativeSoulBootstrapStageData({ stage, manifest, plan, priorReadbacks });
  exact(finalReadback, ['schema', 'stage', 'input', 'objects', 'priorObjects', 'consensusObjects'], 'final journal fields');
  check(finalReadback.schema === 'native-soul-bootstrap-history-v1' && finalReadback.stage === stage, 'final journal identity');
  check(isDeepStrictEqual(finalReadback.input, expected.stageData)
    && isDeepStrictEqual(finalReadback.priorObjects, expected.priorObjects), 'final journal predecessor continuity');
  const packageIds = expected.stageData.packageIds;
  const decode = (kind, evidence) => decodeNativeSoulBootstrapHistoryObject(evidence, { kind, packageIds });
  check(finalReadback.objects && Object.getPrototypeOf(finalReadback.objects) === Object.prototype, 'final object inventory');
  validateNativeSoulBootstrapStageRelations({ stage, input: finalReadback.input, sender: plan.sender,
    objects: Object.fromEntries(Object.entries(finalReadback.objects).map(([kind, evidence]) => [kind, decode(kind, evidence).object])) });
  const objects = {};
  for (const row of MAINNET_V8_RELEASE_STEPS) {
    if (!NATIVE_SOUL_BOOTSTRAP_STAGES.includes(row.kind)) continue;
    Object.assign(objects, row.kind === stage ? finalReadback.objects : priorReadbacks[row.kind].objects);
  }
  // The final transaction consumes BootstrapAdmin; never export its stale ref.
  delete objects.bootstrapAdmin;
  const decoded = Object.fromEntries(Object.entries(objects).map(([kind, evidence]) => [kind, decode(kind, evidence)]));
  return freeze({ packageIds, objects, decoded, finalReadback });
}
