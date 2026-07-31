import { readFile } from 'node:fs/promises';
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
const json = args.has('--json');
const checks = [];

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

async function simulateProtocolVersion(client, packageId, moduleName = 'animacraft') {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::${moduleName}::protocol_version` });
  const result = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(result.FailedTransaction.status?.error?.message || 'protocol_version simulation failed.');
  }
  const bytes = result.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bytes || bytes.length !== 8) throw new Error('protocol_version did not return one BCS u64.');
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]);
  return Number(value);
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

async function checkCommerceV5Objects(client, config, validation) {
  const configured = [
    config.commerceV5TypeOriginPackageId,
    config.commerceProtocolConfigV5Id,
    config.commerceProtocolTreasuryV5Id,
    config.commerceV5LogicalAuxiliaryBlobId,
    config.commerceV5SoulBindingProofType,
  ].filter(Boolean);
  if (!configured.length) {
    if (config.commerceV5ReleaseEnabled) {
      record('Animacraft commerce v5 objects', false, 'Commerce v5 is enabled without its canonical protocol objects.');
    }
    return;
  }
  if (!validation.commerceV5TypeOriginPackageReady
    || !validation.commerceProtocolConfigV5Ready
    || !validation.commerceProtocolTreasuryV5Ready
    || !validation.commerceV5LogicalAuxiliaryBlobReady
    || !validation.commerceV5SoulBindingProofReady
    || !validation.protocolFeeConfigReady
    || !validation.protocolFeeAdminCapReady) {
    record(
      'Animacraft commerce v5 objects',
      false,
      'Commerce v5 TypeOrigin, config, treasury, canonical logical Blob, Soulidity proof type, and legacy v4 authority must be configured together.',
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
    const logicalAuxiliaryBlobId = String(optionValue(jsonField(
      configJson,
      'logical_auxiliary_blob_id',
      'logicalAuxiliaryBlobId',
    )) || '');
    let soulBindingProofType = '';
    try {
      soulBindingProofType = normalizeStructTag(String(optionValue(jsonField(
        configJson,
        'soul_binding_proof_type',
        'soulBindingProofType',
      )) || ''));
    } catch {
      soulBindingProofType = '';
    }
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
      && String(jsonField(configJson, 'payment_coin_type', 'paymentCoinType')) === paymentType
      && primaryFeeBps === 1_000
      && Number.isSafeInteger(fixedFee)
      && fixedFee >= 0
      && Number.isInteger(marketFeeBps)
      && marketFeeBps >= 0
      && marketFeeBps <= 1_000
      && logicalAuxiliaryBlobId
        === String(config.commerceV5LogicalAuxiliaryBlobId)
      && soulBindingProofType
        === normalizeStructTag(config.commerceV5SoulBindingProofType)
      && enabled === Boolean(config.commerceV5ReleaseEnabled);
    record(
      'Animacraft commerce v5 objects',
      ready,
      `TypeOrigin=${typeOrigin}; fee=${primaryFeeBps} bps + ${fixedFee} atomic; market=${marketFeeBps} bps; logicalBlob=${logicalAuxiliaryBlobId || 'missing'}; proof=${soulBindingProofType || 'missing'}; gate=${enabled}`,
    );
  } catch (error) {
    record('Animacraft commerce v5 objects', false, error.message);
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

async function checkNetwork(config, validation) {
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
  }
  await checkProtocolFeeObjects(client, config, validation);
  await checkCommerceV5Objects(client, config, validation);

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
    if (
      validation.commerceV5TypeOriginPackageReady
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

const config = await loadPublicConfig();
const validation = validateRuntimeConfig(config, { strict, requireSoulidity });
validation.errors.forEach((message) => record('Runtime config', false, message));
validation.warnings.forEach((message) => record('Runtime config warning', true, message));
if (!validation.errors.length) record('Runtime config', true, strict ? 'Strict production fields are complete.' : 'Source configuration is structurally valid.');
if (network) await checkNetwork(config, validation);

const failed = checks.filter((check) => !check.ok);
if (json) {
  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, strict, network, checks }, null, 2)}\n`);
} else {
  checks.forEach((check) => process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}\n`));
  process.stdout.write(`\n${failed.length ? `${failed.length} preflight check(s) failed.` : 'Animacraft preflight passed.'}\n`);
}
process.exitCode = failed.length ? 1 : 0;
