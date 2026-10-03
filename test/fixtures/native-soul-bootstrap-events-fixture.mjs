import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { NativeSoulBootstrapBcs } from '../../scripts/native-soul-bootstrap-readback.mjs';
import { mainnetV8TypedDigest } from '../../scripts/mainnet-v8-release-lib.mjs';
import { bootstrapProtocolCommitment } from './native-soul-bootstrap-fixture.mjs';

// Independent event schemas in actual Move declaration order. Encoded local
// fixtures are not evidence of an executed checkpoint or a valid signature.
const bytes = bcs.vector(bcs.u8());
const Events = bcs.struct('FixtureNativeBootstrapEvents', { data: bcs.vector(bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  event_type: bcs.StructTag, contents: bytes,
})) });
const Treasury = bcs.struct('FixtureTreasuryEvent', { config_id: bcs.Address, treasury_id: bcs.Address,
  revision: bcs.u64(), commitment: bytes });
const Enabled = bcs.struct('FixtureEnabledEvent', { config_id: bcs.Address, revision: bcs.u64(),
  enabled: bcs.bool(), commitment: bytes });
const Seal = bcs.struct('FixtureSealEvent', { config_id: bcs.Address, catalog_id: bcs.Address,
  threshold: bcs.u16(), key_server_set_commitment: bytes, commitment: bytes });

export function bootstrapFinalityEvents({ stage, input, sender, objects }) {
  const fields = kind => NativeSoulBootstrapBcs[kind].parse(Uint8Array.from(
    bcs.Object.parse(fromBase64(objects[kind].objectBcsBase64)).data.Move.contents));
  const rows = [];
  const add = (role, module, name, codec, value) => rows.push({ package_id: input.packageIds[role],
    transaction_module: module, sender, event_type: { address: input.packageIds[role], module, name, typeParams: [] },
    contents: codec.serialize(value).toBytes() });
  if (stage === 'INITIALIZE_PROTOCOL') {
    const p = fields('protocol'), t = fields('protocolTreasury');
    add('core', 'protocol_config_v8', 'ProtocolTreasuryV8Initialized', Treasury,
      { config_id: p.id, treasury_id: t.id, revision: '1',
        commitment: bootstrapProtocolCommitment({ ...p, revision: '1', enabled: false }) });
    add('core', 'protocol_config_v8', 'ProtocolV8EnabledChanged', Enabled,
      { config_id: p.id, revision: '2', enabled: true, commitment: p.commitment });
  } else if (stage === 'SETUP_RELEASE') {
    const s = fields('sealConfig');
    add('seal', 'seal_v8', 'SealPolicyCreatedV8', Seal, { config_id: s.id, catalog_id: s.catalog_id,
      threshold: s.threshold, key_server_set_commitment: s.key_server_set_commitment, commitment: s.commitment });
  } else if (!['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'].includes(stage)) throw new Error('Unknown fixture stage');
  if (rows.length === 0) return { eventsDigest: null, transactionEvents: null };
  const wire = Events.serialize({ data: rows }).toBytes(), digest = mainnetV8TypedDigest('TransactionEvents', wire);
  return { eventsDigest: digest, transactionEvents: { digest, bcsBase64: toBase64(wire), eventCount: String(rows.length) } };
}
