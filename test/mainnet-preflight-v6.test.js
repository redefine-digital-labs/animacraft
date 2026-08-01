import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMPOSITION_V6_DEPENDENCY_FIELDS,
  COMPOSITION_V6_RUNTIME_FIELDS,
  inspectCompositionV6Deployment,
  inspectCompositionV6ObjectState,
  normalizeBytes32,
} from '../scripts/mainnet-preflight.mjs';

const POLICY = `0x${'2a'.repeat(32)}`;

test('v6 Mainnet ABI preflight covers the production surface and every stable core type', async () => {
  const source = await readFile(
    new URL('../scripts/mainnet-preflight.mjs', import.meta.url),
    'utf8',
  );
  [
    'initialize_composition_protocol_v6',
    'bind_soul_owner_proof_type_v6',
    'update_protocol_enabled_v6',
    'rotate_validator_v6',
    'transfer_composition_admin_cap_v6',
    'transfer_validator_cap_v6',
    'create_maker_profile_v6',
    'publish_official_item_product_v6',
    'publish_external_item_product_v6',
    'publish_validator_attestation_v6',
    'admit_official_item_v6',
    'admit_certified_item_v6',
    'admit_open_item_v6',
    'purchase_wallet_item_v6',
    'purchase_soul_item_v6',
    'authorize_initial_loadout_v6',
    'authorize_loadout_v6',
    'assert_secondary_market_loadout_v6',
  ].forEach((name) => assert.match(source, new RegExp(`'${name}'`)));
  [
    'CompositionProtocolConfigV6',
    'CompositionProtocolTreasuryV6',
    'CompositionRegistryV6',
    'CompositionAdminCapV6',
    'ValidatorCapV6',
    'MakerProfileV6',
    'ItemProductV6',
    'ValidatorAttestationV6',
    'OwnedItemV6',
    'LoadoutAuthorizationV6',
    'InitialLoadoutAuthorizationV6',
  ].forEach((name) => assert.match(source, new RegExp(`'${name}'`)));
  assert.match(source, /datatypes\.every\(\(datatype\) => \(\s*datatypeHasTypeOrigin/);
  assert.match(source, /strict && network/);
  assert.match(source, /--allow-v6-enabled/);
});

function runtimeConfig() {
  return {
    callablePackageId: '0x66',
    paymentCoinType: '0xd::usdc::USDC',
    soulidityTypeOriginPackageId: '0xabcd',
    protocolFeeAdminCapId: '0xcafe',
    commerceV5TypeOriginPackageId: '0x55',
    commerceProtocolConfigV5Id: '0xc055',
    commerceV5ReleaseEnabled: false,
    compositionV6TypeOriginPackageId: '0x66',
    compositionProtocolConfigV6Id: '0xc066',
    compositionProtocolTreasuryV6Id: '0x7ea6',
    compositionRegistryV6Id: '0xae66',
    compositionAdminCapV6Id: '0xad66',
    compositionAdminCapV6Owner: '0xadea',
    compositionValidatorCapV6Id: '0x7a66',
    compositionValidatorCapV6Owner: '0xbeef',
    compositionValidatorEpochV6: 0,
    compositionValidatorPolicyCommitmentV6: POLICY,
    compositionV6SoulOwnerProofType:
      '0xabcd::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6',
    compositionV6ReleaseEnabled: false,
  };
}

function deployment(config = runtimeConfig()) {
  return Object.fromEntries([
    ['callablePackageId', config.callablePackageId],
    ...COMPOSITION_V6_RUNTIME_FIELDS.map((field) => [field, config[field]]),
    ...COMPOSITION_V6_DEPENDENCY_FIELDS.map((field) => [field, config[field]]),
  ]);
}

function objectTuple(config = runtimeConfig()) {
  const v6 = config.compositionV6TypeOriginPackageId;
  const v5 = config.commerceV5TypeOriginPackageId;
  const payment = config.paymentCoinType;
  return [
    {
      type: `${v6}::composition_v6::CompositionProtocolConfigV6`,
      owner: { $kind: 'Shared' },
      json: {
        version: 6,
        v5_config_id: config.commerceProtocolConfigV5Id,
        v5_admin_cap_id: config.protocolFeeAdminCapId,
        treasury_id: config.compositionProtocolTreasuryV6Id,
        registry_id: config.compositionRegistryV6Id,
        validator_cap_id: config.compositionValidatorCapV6Id,
        validator_epoch: config.compositionValidatorEpochV6,
        payment_coin_type: payment,
        primary_protocol_fee_bps: 1_000,
        validator_policy_commitment: Array(32).fill(0x2a),
        soul_owner_proof_type: config.compositionV6SoulOwnerProofType,
        enabled: config.compositionV6ReleaseEnabled,
      },
    },
    {
      type: `${v6}::composition_v6::CompositionProtocolTreasuryV6<${payment}>`,
      owner: { $kind: 'Shared' },
      json: {
        version: 6,
        config_id: config.compositionProtocolConfigV6Id,
        revenue: { value: '0' },
        total_collected: '0',
        total_withdrawn: '0',
      },
    },
    {
      type: `${v6}::composition_v6::CompositionRegistryV6`,
      owner: { $kind: 'Shared' },
      json: {
        version: 6,
        config_id: config.compositionProtocolConfigV6Id,
      },
    },
    {
      type: `${v6}::composition_v6::CompositionAdminCapV6`,
      owner: { AddressOwner: config.compositionAdminCapV6Owner },
      json: {
        version: 6,
        config_id: config.compositionProtocolConfigV6Id,
      },
    },
    {
      type: `${v6}::composition_v6::ValidatorCapV6`,
      owner: { AddressOwner: config.compositionValidatorCapV6Owner },
      json: {
        version: 6,
        config_id: config.compositionProtocolConfigV6Id,
        validator_epoch: config.compositionValidatorEpochV6,
      },
    },
    {
      type: `${v5}::commerce_v5::CommerceProtocolConfigV5`,
      owner: { $kind: 'Shared' },
      json: {
        version: 5,
        legacy_admin_cap_id: config.protocolFeeAdminCapId,
        payment_coin_type: payment,
        primary_protocol_fee_bps: 1_000,
        enabled: config.commerceV5ReleaseEnabled,
      },
    },
  ];
}

test('normalizes one exact SHA-256 commitment and rejects malformed values', () => {
  assert.equal(normalizeBytes32(Array(32).fill(0x2a)), POLICY);
  assert.equal(normalizeBytes32(POLICY.toUpperCase().replace('0X', '0x')), POLICY);
  assert.equal(normalizeBytes32(Array(31).fill(0x2a)), '');
  assert.equal(normalizeBytes32(Array(32).fill(256)), '');
  assert.equal(normalizeBytes32('0x1234'), '');
});

test('v6 ceremony fails closed on an incomplete or divergent runtime/deployment tuple', () => {
  const config = runtimeConfig();
  const exact = inspectCompositionV6Deployment(config, deployment(config), {
    required: true,
  });
  assert.equal(exact.ready, true);

  const incompleteConfig = { ...config, compositionAdminCapV6Id: '' };
  const incomplete = inspectCompositionV6Deployment(
    incompleteConfig,
    deployment(config),
    { required: true },
  );
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.runtimeMissing, ['compositionAdminCapV6Id']);

  const divergentDeployment = deployment(config);
  divergentDeployment.compositionValidatorCapV6Owner = '0xdead';
  const divergent = inspectCompositionV6Deployment(
    config,
    divergentDeployment,
    { required: true },
  );
  assert.equal(divergent.ready, false);
  assert.deepEqual(divergent.mismatches, ['compositionValidatorCapV6Owner']);

  const invalid = inspectCompositionV6Deployment(
    { ...config, compositionValidatorPolicyCommitmentV6: '0x1234' },
    deployment(config),
    { required: true },
  );
  assert.equal(invalid.ready, false);
  assert.deepEqual(invalid.runtimeInvalid, [
    'compositionValidatorPolicyCommitmentV6',
  ]);

  const zeroCustodian = inspectCompositionV6Deployment(
    { ...config, compositionAdminCapV6Owner: '0x0' },
    deployment(config),
    { required: true },
  );
  assert.equal(zeroCustodian.ready, false);
  assert.deepEqual(zeroCustodian.runtimeInvalid, [
    'compositionAdminCapV6Owner',
  ]);
});

test('v6 object read-back pins TypeOrigin, custody, linkage, validator policy and disabled gate', () => {
  const config = runtimeConfig();
  const exact = inspectCompositionV6ObjectState(objectTuple(config), config);
  assert.equal(exact.ready, true, exact.failures.join('\n'));

  const wrongOwner = objectTuple(config);
  wrongOwner[4].owner = { AddressOwner: '0xdead' };
  const custody = inspectCompositionV6ObjectState(wrongOwner, config);
  assert.equal(custody.ready, false);
  assert.match(custody.failures.join(' '), /ValidatorCap owner/);

  const wrongPolicy = objectTuple(config);
  wrongPolicy[0].json.validator_policy_commitment = Array(32).fill(0x2b);
  const policy = inspectCompositionV6ObjectState(wrongPolicy, config);
  assert.equal(policy.ready, false);
  assert.match(policy.failures.join(' '), /policy commitment/);

  const wrongV5 = objectTuple(config);
  wrongV5[0].json.v5_config_id = '0xdead';
  const linkage = inspectCompositionV6ObjectState(wrongV5, config);
  assert.equal(linkage.ready, false);
  assert.match(linkage.failures.join(' '), /Commerce v5 config/);

  const enabledConfig = {
    ...config,
    commerceV5ReleaseEnabled: true,
    compositionV6ReleaseEnabled: true,
  };
  const enabledObjects = objectTuple(enabledConfig);
  const initialCeremony = inspectCompositionV6ObjectState(
    enabledObjects,
    enabledConfig,
  );
  assert.equal(initialCeremony.ready, false);
  assert.match(initialCeremony.failures.join(' '), /must remain disabled/);
  const postActivationAudit = inspectCompositionV6ObjectState(
    enabledObjects,
    enabledConfig,
    { allowEnabled: true },
  );
  assert.equal(postActivationAudit.ready, true, postActivationAudit.failures.join('\n'));
});
