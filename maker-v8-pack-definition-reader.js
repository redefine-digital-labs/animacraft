import { fromBase64, toBase64, deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils';
import { ObjectError } from '@mysten/sui/client';
import { MAKER_V8_PACK_DEFINITIONS_BCS, packDefinitionCommitmentV8 } from './maker-v8-pack-definition-wire.js';

const MAX_BYTES = 2 * 1024 * 1024;
const keyBytes = new Uint8Array([0]); // Empty Move struct's compiled dummy_field=false.
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
function fail() { throw Object.assign(new Error('Pack definitions differ from the exact Release binding or canonical stored bytes.'),
  { code: 'MAKER_V8_PACK_DEFINITIONS_READBACK_INVALID' }); }
function exactId(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) fail();
  return value;
}
function immutable(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Object.freeze(Array.from(value, immutable));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, immutable(entry)])));
  return value;
}

/** Read-only content proof, not access/admission authority. The caller supplies
 * the Release identity/content already authenticated by its current source read.
 * Missing definitions fail: this does not infer a legacy/Base-only fallback. */
export const readMakerV8PackDefinitions = (client, input) => readPackDefinitions(client, input, false);

/** Optional presence discovery for simple vs authored Releases. Only the exact
 * derived field's official notFound is absence; malformed data/network failure
 * and deletion never authorize a Base-only interpretation. */
export const findMakerV8PackDefinitions = (client, input) => readPackDefinitions(client, input, true);

async function readPackDefinitions(client, {
  runtimeOriginalPackageId, releaseId, contentCommitment, semanticPackId, definitionCommitment,
}, allowMissing) {
  exactId(runtimeOriginalPackageId); exactId(releaseId);
  for (const value of [contentCommitment, ...(definitionCommitment === undefined ? [] : [definitionCommitment])]) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) fail();
  }
  if (typeof semanticPackId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(semanticPackId)
    || typeof client?.getDynamicField !== 'function') fail();
  const keyType = `${runtimeOriginalPackageId}::runtime_v8::PackDefinitionsKeyV8`;
  const valueType = `${runtimeOriginalPackageId}::runtime_v8::PackDefinitionsV8`;
  const name = { type: keyType, bcsBase64: toBase64(keyBytes) };
  let field;
  try { field = await client.getDynamicField({ parentId: releaseId, name }); }
  catch (error) {
    if (allowMissing && definitionCommitment === undefined && error instanceof ObjectError
      && error.reason === 'notFound' && error.objectId === deriveDynamicFieldID(releaseId, keyType, keyBytes)) return null;
    throw error;
  }
  try {
    if (field?.kind !== 'DynamicField' || field.childId != null
      || field.fieldId !== deriveDynamicFieldID(releaseId, keyType, keyBytes)
      || normalizeStructTag(field.type) !== normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`)
      || normalizeStructTag(field.name?.type) !== keyType || field.name.bcsBase64 !== name.bcsBase64
      || normalizeStructTag(field.value?.type) !== valueType) fail();
    const encoded = field.value.bcsBase64;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(MAX_BYTES / 3) * 4) fail();
    const raw = fromBase64(encoded);
    if (raw.length > MAX_BYTES || toBase64(raw) !== encoded) fail();
    const stored = MAKER_V8_PACK_DEFINITIONS_BCS.parse(raw);
    if (toBase64(MAKER_V8_PACK_DEFINITIONS_BCS.serialize(stored).toBytes()) !== encoded
      || stored.version !== '8' || stored.release_id !== releaseId
      || hex(stored.release_content_commitment) !== contentCommitment
      || stored.rows.semantic_pack_id !== semanticPackId || stored.commitment.length !== 32) fail();
    const commitment = hex(packDefinitionCommitmentV8(releaseId, stored.release_content_commitment, stored.rows));
    if (commitment !== hex(stored.commitment)
      || (definitionCommitment !== undefined && commitment !== definitionCommitment)) fail();
    return immutable({ releaseId, contentCommitment, semanticPackId, definitionCommitment: commitment, rows: stored.rows });
  } catch { fail(); }
}
