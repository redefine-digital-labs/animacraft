import { bcs } from '@mysten/sui/bcs';
import { fromBase64, fromHex, toBase64, toBase58, normalizeStructTag, deriveDynamicFieldID } from '@mysten/sui/utils';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../../maker-v8-chain.js';
import { currentRuntimeAuthorityFixture } from './maker-v8-current-runtime-authority.js';
import { moveModuleIdentityBytesFixture } from './walrus-execution-fixture.js';

const sid = number => `0x${number.toString(16).padStart(64, '0')}`;
const mainnetRpc = methods => ({ async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; }, ...methods });

// Synthetic immutable package/object responses for tests; no attestation brand is fabricated.
export function nativeBindingFixture(runtimeInput) {
  const config = structuredClone(runtimeInput);
  const keyType = `${config.roles.core.typeOriginPackageId}::protocol_config_v8::SoulidityBindingSlotKeyV8`;
  const valueType = `${config.roles.core.typeOriginPackageId}::protocol_config_v8::SoulidityBindingV8`;
  const type = bcs.struct('TypeName', { name: bcs.string() });
  const schema = bcs.struct('SoulidityBindingV8', { config_id: bcs.Address, soul_original: type, soul_defining: type, mint_original: type, mint_defining: type, owner_original: type, owner_defining: type });
  const keySchema = bcs.struct('SoulidityBindingSlotKeyV8', { dummy_field: bcs.bool() });
  const keyBytes = keySchema.serialize({ dummy_field: false }).toBytes();
  const fieldSchema = bcs.struct('Field', { id: bcs.Address, name: keySchema, value: schema });
  const name = (packageId, suffix) => ({ name: `${packageId.slice(2)}::${suffix}` });
  const fields = {
    config_id: config.protocolConfigId,
    soul_original: name(sid(71), 'soul::Soul'), soul_defining: name(sid(71), 'soul::Soul'),
    mint_original: name(sid(71), 'animacraft_v8_binding::MintBindingWitnessV8'),
    mint_defining: name(sid(72), 'animacraft_v8_binding::MintBindingWitnessV8'),
    owner_original: name(sid(71), 'animacraft_v8_binding::SoulOwnerWitnessV8'),
    owner_defining: name(sid(72), 'animacraft_v8_binding::SoulOwnerWitnessV8'),
  };
  const field = {
    kind: 'DynamicField', childId: null,
    fieldId: deriveDynamicFieldID(config.protocolConfigId, keyType, keyBytes),
    name: { type: keyType, bcsBase64: toBase64(keyBytes) },
    value: { type: valueType, bcsBase64: toBase64(schema.serialize(fields).toBytes()) },
    type: `0x2::dynamic_field::Field<${keyType},${valueType}>`,
  };
  return { config, fields, field, schema, keyType, keySchema, fieldSchema };
}

export function nativeIntegrationFixture(runtimeInput) {
  const f = nativeBindingFixture(runtimeInput);
  const pin = { soulidityCallablePackageId: sid(80), soulidityOriginalPackageId: sid(71), soulidityCallableDigest: toBase58(Uint8Array.from({ length: 32 }, () => 7)), kioskPackageId: sid(81), walrusPackageId: sid(82), marketConfigV2Id: sid(90), kindRegistryId: sid(91), kioskRegistryId: sid(92), soulTransferPolicyId: sid(93), expectedNativeBinding: {} };
  const keys = { soul_original: 'soulOriginalType', soul_defining: 'soulDefiningType', mint_original: 'mintWitnessOriginalType', mint_defining: 'mintWitnessDefiningType', owner_original: 'ownerWitnessOriginalType', owner_defining: 'ownerWitnessDefiningType' };
  for (const [key, value] of Object.entries(keys)) pin.expectedNativeBinding[value] = `0x${f.fields[key].name}`;
  f.config.nativeSoulIntegration = pin;
  const objects = new Map();
  const pkg = (objectId, originalId, rows, linkageTable = []) => ({ data: { objectId, version: '4', digest: pin.soulidityCallableDigest, owner: { Immutable: true }, bcs: { dataType: 'package', id: objectId, version: '4', originalId: null, moduleMap: Object.fromEntries(rows.map(([module]) => [module, toBase64(moveModuleIdentityBytesFixture(module, originalId))])), typeOriginTable: rows.map(([moduleName, datatypeName, packageId]) => ({ moduleName, datatypeName, packageId })), linkageTable } } });
  objects.set(sid(80), pkg(sid(80), sid(71), [['soul', 'Soul', sid(71)], ['animacraft_v8_binding', 'MintBindingWitnessV8', sid(72)], ['animacraft_v8_binding', 'SoulOwnerWitnessV8', sid(72)], ['market', 'MarketConfigV2', sid(73)], ['market', 'KioskRegistry', sid(71)], ['kind_registry', 'KindRegistry', sid(71)]], [{ originalId: sid(74), upgradedId: sid(81), upgradedVersion: '4' }, { originalId: sid(75), upgradedId: sid(82), upgradedVersion: '4' }]));
  objects.set(sid(81), pkg(sid(81), sid(74), [['personal_kiosk', 'PersonalKioskCap', sid(74)]]));
  objects.get(sid(80)).data.bcs.typeOriginTable.push(
    { moduleName: 'market', datatypeName: 'PersonalKioskOwnerKey', packageId: sid(73) },
    { moduleName: 'market', datatypeName: 'PersonalKioskRegistration', packageId: sid(73) },
  );
  objects.set(sid(82), pkg(sid(82), sid(75), [['blob', 'Blob', sid(75)]]));
  const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
  const add = (objectId, type, fields, shape) => {
    type = normalizeStructTag(type);
    const schema = bcs.struct('NativeFixture', shape);
    objects.set(objectId, { data: { objectId, version: '3', digest: pin.soulidityCallableDigest, owner: { Shared: { initial_shared_version: '2' } }, type, content: { dataType: 'moveObject', type, fields }, bcs: { dataType: 'moveObject', type, bcsBytes: toBase64(schema.serialize(fields).toBytes()) } } });
  };
  add(sid(90), `${sid(73)}::market::MarketConfigV2`, { id: sid(90), version: '2', legacy_config_id: sid(0), fee_recipient: sid(101), platform_fee_bps: 250, primary_enabled: true, secondary_enabled: false }, { id: bcs.Address, version: bcs.u64(), legacy_config_id: bcs.Address, fee_recipient: bcs.Address, platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool() });
  add(sid(91), `${sid(71)}::kind_registry::KindRegistry`, { id: sid(91), version: '1', next_kind: 16, kinds: { id: sid(102), size: '5' }, name_to_kind: { id: sid(103), size: '5' } }, { id: bcs.Address, version: bcs.u64(), next_kind: bcs.u32(), kinds: table, name_to_kind: table });
  add(sid(92), `${sid(71)}::market::KioskRegistry`, { id: sid(92), version: '1' }, { id: bcs.Address, version: bcs.u64() });
  const policyRules = [`${sid(74).slice(2)}::personal_kiosk_rule::Rule`, `${sid(74).slice(2)}::witness_rule::Rule<${sid(71).slice(2)}::market::SoulMarketProof>`];
  add(sid(93), `0x2::transfer_policy::TransferPolicy<${sid(71)}::soul::Soul>`, { id: sid(93), balance: { value: '0' }, rules: { contents: policyRules.map(name => ({ name })) } }, { id: bcs.Address, balance: bcs.struct('Balance', { value: bcs.u64() }), rules: bcs.struct('VecSet', { contents: bcs.vector(bcs.struct('TypeName', { name: bcs.string() })) }) });
  objects.get(sid(93)).data.content.fields.balance = '0';
  objects.get(sid(93)).data.content.fields.rules.contents = policyRules;
  const authority = currentRuntimeAuthorityFixture(f.config);
  for (const role of ['core', 'output', 'runtime']) {
    const identity = f.config.roles[role];
    objects.get(sid(80)).data.bcs.linkageTable.push({ originalId: identity.typeOriginPackageId, upgradedId: identity.callablePackageId, upgradedVersion: '1' });
  }
  const rpc = mainnetRpc({
    async getDynamicField(input) { return input.name.type === f.keyType ? f.field : authority.rpc.getDynamicField(input); },
    async getObject(input) {
      if (objects.has(input.id)) return objects.get(input.id);
      const response = await authority.rpc.getObject(input);
      if (response.data.bcs.dataType === 'package') {
        const identity = Object.values(f.config.roles).find(value => value.callablePackageId === input.id);
        Object.assign(response.data.bcs, { id: input.id, version: response.data.version, originalId: null });
        if (response.data.bcs.moduleMap.base_registry_v8) {
          const bytes = fromBase64(response.data.bcs.moduleMap.base_registry_v8);
          // Published address-table self slot of the approved metered Core fixture.
          bytes.set(fromHex(identity.typeOriginPackageId), 10408);
          response.data.bcs.moduleMap.base_registry_v8 = toBase64(bytes);
        } else {
          response.data.bcs.moduleMap = { native_dependency: toBase64(moveModuleIdentityBytesFixture('native_dependency', identity.typeOriginPackageId)) };
        }
      }
      return response;
    },
  });
  return { ...f, pin, objects, rpc };
}
