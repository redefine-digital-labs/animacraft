import { Transaction } from '@mysten/sui/transactions';
import { fromBase58, toBase58 } from '@mysten/sui/utils';
import { MAINNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { assertMainnetV8FinalSealPolicy, MAINNET_V8_PAYMENT_COIN_TYPE } from './mainnet-v8-release-lib.mjs';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE } from '../maker-v8-seal-profile.js';
import { assertMakerV8WalrusExecutionV1 } from '../maker-v8-walrus-execution.js';
import { NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY } from './native-soul-external-publications.mjs';

const ROLES = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const MODULES = { core: 'protocol_config_v8', seal: 'seal_v8', runtime: 'runtime_binding_v8',
  output: 'output_v8', physical: 'physical_v8', market: 'market_v8', release: 'release_v8' };
const COMMON = ['packageIds', 'protocolConfig', 'protocolAdminCap'];
const EXTRA = {
  INITIALIZE_PROTOCOL: [],
  SETUP_RELEASE: ['commitments', 'sealPolicy', 'walrusSystem', 'walrusExecution'],
  BEGIN_BOOTSTRAP: ['catalog', 'replacement'],
  FINALIZE_BOOTSTRAP: ['catalog', 'replacement', 'bootstrapAdmin', 'outputConfig', 'marketConfig'],
};
export const NATIVE_SOUL_BOOTSTRAP_STAGES = Object.freeze(Object.keys(EXTRA));
const MAX_U64 = (1n << 64n) - 1n;
const fail = message => { throw new Error('NATIVE_SOUL_BOOTSTRAP: ' + message); };
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(label + ' fields');
}
function id(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) fail(label + ' ID');
  return value;
}
function version(value, label) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > MAX_U64) fail(label + ' version');
  return value;
}
function shared(value, label) {
  exact(value, ['objectId', 'initialSharedVersion'], label);
  return { objectId: id(value.objectId, label), initialSharedVersion: version(value.initialSharedVersion, label) };
}
function owned(value, label) {
  exact(value, ['objectId', 'version', 'digest'], label);
  id(value.objectId, label); version(value.version, label);
  try {
    if (typeof value.digest !== 'string' || fromBase58(value.digest).length !== 32
      || toBase58(fromBase58(value.digest)) !== value.digest) fail(label + ' digest');
  } catch { fail(label + ' digest'); }
  return { ...value };
}
function hash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) fail(label + ' hash');
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
}

/**
 * Pure, offline TransactionKind builder. The caller owns authoritative readback,
 * signer/network checks and durable execution. No ctx, gas, sender, wallet, or
 * RPC is accepted here. References use canonical IDs and decimal-string versions.
 * INITIALIZE_PROTOCOL consumes the fresh Core publish/init config + admin; it
 * initializes its USDC treasury and enables it, not another protocol issuer.
 */
export function buildNativeSoulBootstrapTransaction(stage, input) {
  if (!Object.hasOwn(EXTRA, stage)) fail('unknown stage');
  exact(input, [...COMMON, ...EXTRA[stage]], stage);
  exact(input.packageIds, [...ROLES, 'soulidity'], 'packageIds');
  const packages = Object.fromEntries([...ROLES, 'soulidity'].map(role => [role, id(input.packageIds[role], role)]));
  const protocol = shared(input.protocolConfig, 'protocolConfig');
  const protocolAdmin = owned(input.protocolAdminCap, 'protocolAdminCap');
  const refs = [protocol.objectId, protocolAdmin.objectId];
  const extras = {};
  for (const key of EXTRA[stage]) {
    if (['catalog', 'walrusSystem', 'outputConfig', 'marketConfig'].includes(key)) {
      extras[key] = shared(input[key], key); refs.push(extras[key].objectId);
    } else if (['replacement', 'bootstrapAdmin'].includes(key)) {
      extras[key] = owned(input[key], key); refs.push(extras[key].objectId);
    }
  }
  const allIds = [...Object.values(packages), ...refs];
  if (new Set(allIds).size !== allIds.length) fail('package/object identity collision');
  const tx = new Transaction();
  const call = (role, module, name, args = [], typeArguments = []) =>
    tx.moveCall({ target: packages[role] + '::' + module + '::' + name, arguments: args, typeArguments });
  const binding = (name, args = [], types = []) => call('core', 'package_binding_v8', name, args, types);
  const protocolArg = tx.sharedObjectRef({ ...protocol, mutable: ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE'].includes(stage) });
  const adminArg = () => tx.objectRef(protocolAdmin);
  if (stage === 'INITIALIZE_PROTOCOL') {
    const admin = adminArg();
    call('core', 'protocol_config_v8', 'initialize_protocol_treasury_v8', [protocolArg, admin], [MAINNET_V8_PAYMENT_COIN_TYPE]);
    call('core', 'protocol_config_v8', 'set_protocol_enabled_v8', [protocolArg, admin, tx.pure.bool(true)]);
    return tx;
  }
  if (stage === 'SETUP_RELEASE') {
    exact(input.commitments, ROLES, 'commitments');
    const commitments = ROLES.map(role => {
      exact(input.commitments[role], ['source', 'package', 'abi'], role + ' commitments');
      return ['source', 'package', 'abi'].map(key => hash(input.commitments[role][key], role + ' ' + key));
    });
    assertMainnetV8FinalSealPolicy(input.sealPolicy);
    const policy = input.sealPolicy;
    if (policy.encryptionPolicyArtifact.sealPackageCommitment !== input.commitments.seal.package
      || policy.encryptionPolicyArtifact.sealAbiCommitment !== input.commitments.seal.abi) fail('Seal artifact differs from role commitments');
    if (policy.keyServers.length > 64 || policy.keyServers.reduce((sum, server) => sum + BigInt(server.weight), 0n) > 254n)
      fail('Seal key-share limit');
    if (extras.walrusSystem.objectId !== MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId) fail('wrong mainnet Walrus System');
    const walrusTarget = assertMakerV8WalrusExecutionV1(input.walrusExecution,
      { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
    if (walrusTarget.system.objectId !== extras.walrusSystem.objectId
      || walrusTarget.system.initialSharedVersion !== extras.walrusSystem.initialSharedVersion) fail('Walrus execution System differs from input');
    const admin = adminArg();
    call('core', 'soulidity_binding_v8', 'install_soulidity_binding_v8', [protocolArg, admin], [
      packages.soulidity + '::soul::Soul',
      packages.soulidity + '::animacraft_v8_binding::MintBindingWitnessV8',
      packages.soulidity + '::animacraft_v8_binding::SoulOwnerWitnessV8',
    ]);
    const commitmentResults = commitments.map(values => binding('new_package_commitments_v8', values.map(bytes => tx.pure.vector('u8', bytes))));
    const markers = ROLES.flatMap(role => role === 'core'
      ? Array(2).fill(packages.core + '::protocol_config_v8::CorePackageMarkerV8')
      : ['Original', 'Callable'].map(kind => packages[role] + '::' + (role === 'runtime' ? 'runtime_v8' : MODULES[role])
        + '::' + role[0].toUpperCase() + role.slice(1) + kind + 'MarkerV8'));
    const catalog = binding('certify_product_release_catalog_v8', [protocolArg, admin, ...commitmentResults], markers);
    const configs = {};
    for (const role of ROLES.slice(1)) {
      const cap = binding('take_' + role + '_call_cap_v8', [protocolArg, admin, catalog]);
      const args = role === 'seal' ? [protocolArg, admin, catalog, cap,
        tx.pure.vector('address', policy.keyServers.map(server => server.objectId)),
        tx.pure.vector('u16', policy.keyServers.map(server => Number(server.weight))),
        tx.pure.u16(Number(policy.threshold)), tx.pure.string(MAKER_V8_SEAL_ENCRYPTION_PROFILE.cipherSuite),
        tx.pure.string(MAKER_V8_SEAL_ENCRYPTION_PROFILE.keyDerivation),
        tx.pure.string(MAKER_V8_SEAL_ENCRYPTION_PROFILE.ciphertextFormat), tx.pure.u64(3 * 1024 * 1024)]
        : [catalog, cap];
      configs[role] = call(role, MODULES[role], role === 'seal' ? 'new_seal_policy_config_v8' : 'new_' + role + '_package_config_v8', args);
    }
    binding('assert_catalog_setup_complete_v2', [catalog]);
    call('core', 'core_v8', 'bootstrap_walrus_certification_policy_v1', [protocolArg, admin, catalog,
      tx.sharedObjectRef({ ...extras.walrusSystem, mutable: false })]);
    // Public framework getter reads each actual newly allocated config Result.
    // These are not caller-supplied pure IDs or fabricated role authorities.
    const configIds = ['runtime', 'output', 'market', 'release'].map(role => tx.moveCall({
      target: '0x2::object::id', typeArguments: [packages[role] + '::' + MODULES[role] + '::'
        + role[0].toUpperCase() + role.slice(1) + 'PackageConfigV8'], arguments: [configs[role]],
    }));
    const replacementInput = binding('new_fresh_tuple_replacement_binding_input_v2', [catalog, ...configIds]);
    binding('seal_fresh_tuple_replacement_binding_v2', [protocolArg, admin, catalog, replacementInput]);
    for (const role of ROLES.slice(1)) call(role, MODULES[role],
      role === 'seal' ? 'share_seal_policy_config_v8' : 'share_' + role + '_package_config_v8', [configs[role]]);
    binding('share_product_release_catalog_v8', [catalog]);
    // An explicit public root call selects the independently certified current
    // Walrus version for every public dependency call in this PTB (Sui135).
    tx.moveCall({ target: walrusTarget.packageId + '::system::epoch',
      arguments: [tx.sharedObjectRef({ ...extras.walrusSystem, mutable: false })] });
    return tx;
  }
  const catalog = tx.sharedObjectRef({ ...extras.catalog, mutable: true });
  const replacement = tx.objectRef(extras.replacement);
  if (stage === 'BEGIN_BOOTSTRAP') {
    binding('begin_fresh_tuple_bootstrap_v2', [protocolArg, adminArg(), replacement, catalog]);
    return tx;
  }
  const bootstrapAdmin = tx.objectRef(extras.bootstrapAdmin);
  const outputConfig = tx.sharedObjectRef({ ...extras.outputConfig, mutable: true });
  const marketConfig = tx.sharedObjectRef({ ...extras.marketConfig, mutable: true });
  const [outputCaller, marketCaller] = binding('mint_runtime_caller_caps_v1', [protocolArg, bootstrapAdmin, replacement, catalog]);
  call('output', 'output_v8', 'install_output_runtime_caller_cap_v2',
    [protocolArg, catalog, replacement, bootstrapAdmin, outputConfig, outputCaller]);
  call('market', 'market_v8', 'install_market_runtime_caller_cap_v2',
    [marketConfig, protocolArg, catalog, replacement, bootstrapAdmin, marketCaller]);
  binding('finalize_fresh_tuple_bootstrap_v2', [protocolArg, bootstrapAdmin, replacement, catalog]);
  return tx;
}
