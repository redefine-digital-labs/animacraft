import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { assertMakerV8MainnetRpc } from './maker-v8-chain.js';

const address = bcs.Address;
const bytes = bcs.vector(bcs.u8());
const fields = {
  version: bcs.u64(), protocol_config_id: address, soul_id: address, soul_state_id: address,
  release_id: address, root_id: address, root_version: bcs.u64(),
  root_content_commitment: bytes, release_content_commitment: bytes, buyer: address,
  paid_atomic: bcs.u64(), issued_at_ms: bcs.u64(), legacy_pass_id: bcs.option(address),
};
export const SoulPackPassV1Bcs = bcs.struct('SoulPackPassV1', { id: address, ...fields, commitment: bytes });
export const SoulPackAccessKeyV1Bcs = bcs.struct('SoulPackAccessKeyV1', { soul_id: address });
export const SoulPackEntitlementV1Bcs = bcs.struct('SoulPackEntitlementV1', { release_id: address, pass_id: address });
export const SoulPackEntitlementsV1Bcs = bcs.vector(SoulPackEntitlementV1Bcs);
const commitmentBcs = bcs.struct('SoulPackPassCommitmentV1', { domain: bytes, ...fields });
const exactId = /^0x[0-9a-f]{64}$/;

function check(value, message) {
  if (!value) throw new Error(`SOUL_PACK_V1: ${message}`);
}
function id(value) {
  check(typeof value === 'string' && exactId.test(value), 'Expected an exact object ID');
  return value;
}
function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function hashBytes(value) {
  check(value instanceof Uint8Array || Array.isArray(value), 'Expected commitment bytes');
  check(value.length === 32 && [...value].every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255),
    'Expected a SHA-256 commitment');
  return [...value];
}
function canonical(schema, content) {
  const parsed = schema.parse(content);
  check(equalBytes(schema.serialize(parsed).toBytes(), content), 'Noncanonical object BCS');
  return parsed;
}

export function soulPackPassCommitmentV1(pass) {
  return sha256(commitmentBcs.serialize({ ...pass,
    domain: [...new TextEncoder().encode('animacraft/runtime/soul-pack-pass/v1')],
  }).toBytes());
}

/** Lookup is release/Soul-specific. Owner inventories cannot establish entitlement. */
export async function readSoulPackPassV1({ client, runtimeTypePackageId, releaseId, soulId,
  soulStateId, protocolConfigId, rootId, rootVersion, rootContentCommitment, releaseContentCommitment }) {
  await assertMakerV8MainnetRpc(client);
  const module = `${id(runtimeTypePackageId)}::runtime_v8`;
  const keyType = `${module}::SoulPackAccessKeyV1`;
  const key = { soul_id: id(soulId) };
  const fieldId = deriveDynamicFieldID(id(releaseId), keyType, SoulPackAccessKeyV1Bcs.serialize(key).toBytes());
  let field;
  try {
    field = (await client.core.getObject({ objectId: fieldId, include: { content: true } })).object;
  } catch (error) {
    if (error instanceof ObjectError && error.reason === 'notFound' && error.objectId === fieldId) return null;
    throw error;
  }
  const fieldType = `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`;
  check(field.objectId === fieldId && normalizeStructTag(field.type) === normalizeStructTag(fieldType)
    && field.owner.$kind === 'ObjectOwner' && field.owner.ObjectOwner === releaseId, 'Entitlement field identity mismatch');
  const row = canonical(bcs.struct('Field', { id: address, name: SoulPackAccessKeyV1Bcs, value: address }), field.content);
  check(row.id === fieldId && row.name.soul_id === soulId, 'Entitlement key mismatch');
  const passObject = (await client.core.getObject({ objectId: row.value, include: { content: true } })).object;
  check(passObject.objectId === row.value && passObject.owner.$kind === 'Shared'
    && normalizeStructTag(passObject.type) === normalizeStructTag(`${module}::SoulPackPassV1`), 'Pass type or custody mismatch');
  const pass = canonical(SoulPackPassV1Bcs, passObject.content);
  check(pass.id === row.value && pass.version === '1' && pass.soul_id === soulId
    && pass.soul_state_id === id(soulStateId) && pass.protocol_config_id === id(protocolConfigId)
    && pass.release_id === releaseId && pass.root_id === id(rootId) && pass.root_version === String(rootVersion)
    && equalBytes(pass.root_content_commitment, hashBytes(rootContentCommitment))
    && equalBytes(pass.release_content_commitment, hashBytes(releaseContentCommitment)), 'Pass target or compatibility mismatch');
  check(equalBytes(hashBytes(pass.commitment), soulPackPassCommitmentV1(pass)), 'Pass commitment mismatch');
  return { pass, fieldId, version: passObject.version, digest: passObject.digest,
    initialSharedVersion: passObject.owner.Shared.initialSharedVersion };
}

/** Caller supplies a live quote and a Coin of exactly its reviewed amount.
 * The native adapter rechecks custody, compatibility, expiry and payment on chain. */
export function appendSoulPackPurchaseV1(transaction, quote, payment) {
  check(quote.network === 'mainnet', 'Expected Sui mainnet');
  check(typeof quote.priceAtomic === 'string' && /^[1-9][0-9]*$/.test(quote.priceAtomic)
    && BigInt(quote.priceAtomic) <= 1_000_000_000_000n, 'Invalid exact Pack price');
  check(typeof quote.expiresAtMs === 'string' && /^[0-9]+$/.test(quote.expiresAtMs)
    && BigInt(quote.expiresAtMs) <= 18_446_744_073_709_551_615n, 'Invalid quote expiry');
  check(typeof quote.paymentCoinType === 'string' && normalizeStructTag(quote.paymentCoinType), 'Invalid payment coin type');
  return transaction.moveCall({
    target: `${id(quote.nativePackageId)}::animacraft_pack_adapter_v1::purchase_soul_pack_v1`,
    typeArguments: [quote.paymentCoinType],
    arguments: [quote.stateId, quote.equipmentId, quote.releaseId, quote.packRegistryId,
      quote.packTreasuryId, quote.rootId, quote.protocolConfigId, quote.protocolTreasuryId]
      .map(value => transaction.object(id(value)))
      .concat([payment, transaction.pure.u64(quote.priceAtomic), transaction.pure.u64(quote.expiresAtMs),
        transaction.object('0x6')]),
  });
}

/** The final receipt supplies the exact Soul, State and equipment to continue. */
export function soulPackPurchaseContinuationV1({ origin, soulId, releaseId }) {
  const url = new URL(`/packs/${id(releaseId)}`, origin);
  url.searchParams.set('soul', id(soulId));
  return url.toString();
}
