import { readFile } from 'node:fs/promises';
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

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const network = args.has('--network');
const requireSoulidity = args.has('--require-soulidity');
// Every strict Mainnet rehearsal after v6 ships must prove the complete tuple.
// The explicit flag also lets CI exercise this fail-closed path without making
// network calls.
const requireCompositionV6 = args.has('--require-composition-v6')
  || (strict && network);
const allowCompositionV6Enabled = args.has('--allow-v6-enabled');
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
  'soulidityTypeOriginPackageId',
]);

export const COMPOSITION_V6_DEPENDENCY_FIELDS = Object.freeze([
  ...COMPOSITION_V6_CORE_DEPENDENCY_FIELDS,
  ...COMPOSITION_V6_BINDING_DEPENDENCY_FIELDS,
]);

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

async function simulateProtocolVersion(client, packageId, moduleName = 'animacraft') {
  return simulateU64Function(client, packageId, moduleName, 'protocol_version');
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
    `${suiId(config.soulidityTypeOriginPackageId)}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
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

async function checkNetwork(config, validation, compositionDeploymentStatus) {
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
      || config.compositionV6ReleaseEnabled === true
      || Boolean(config.compositionV6SoulOwnerProofType);
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
  }
  const compositionDeploymentStatus = inspectCompositionV6Deployment(
    config,
    deployment,
    { required: requireCompositionV6 },
  );
  recordCompositionV6Deployment(compositionDeploymentStatus, config);

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
    await checkNetwork(config, validation, compositionDeploymentStatus);
  }

  const failed = checks.filter((check) => !check.ok);
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: failed.length === 0,
      strict,
      network,
      requireCompositionV6,
      allowCompositionV6Enabled,
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
