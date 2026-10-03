import { createHash } from 'node:crypto';
import { bcs } from '@mysten/sui/bcs';

// Independent current Move preimages, not expected values copied from compiler errors.
export function compilerSealPolicyFixture(context) {
  const bytes = bcs.vector(bcs.u8());
  const hash = (shape, value) => createHash('sha256').update(bcs.struct('Input', {
    domain: bcs.string(), schema_revision: bcs.u64(), ...shape,
  }).serialize({ schema_revision: 2, ...value }).toBytes()).digest('hex');
  const sf = context.configs.seal.fields;
  const keyServerSetCommitment = hash({ ordered_key_servers: bcs.vector(bcs.struct('Row', {
    key_server_id: bcs.Address, weight: bcs.u16(),
  })), threshold: bcs.u16() }, {
    domain: 'animacraft-fresh-v8/seal/key-server-set/v2',
    ordered_key_servers: sf.keyServerIds.map((key_server_id, i) => ({ key_server_id, weight: sf.weights[i] })),
    threshold: sf.threshold,
  });
  const commitment = hash({ policy_id: bcs.Address, catalog_id: bcs.Address,
    package_tuple_commitment: bytes, call_cap_set_commitment: bytes,
    key_server_set_commitment: bytes, encryption_policy_commitment: bytes }, {
    domain: 'animacraft-fresh-v8/seal/policy/v2', policy_id: context.configs.seal.reference.objectId,
    catalog_id: context.catalog.reference.objectId,
    package_tuple_commitment: Buffer.from(sf.productBindingCommitment, 'hex'),
    call_cap_set_commitment: Buffer.from(sf.callCapSetCommitment, 'hex'),
    key_server_set_commitment: Buffer.from(keyServerSetCommitment, 'hex'),
    encryption_policy_commitment: Buffer.from(sf.encryptionPolicyCommitment, 'hex'),
  });
  return { keyServerSetCommitment, commitment };
}
