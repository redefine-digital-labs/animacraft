import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex } from '@mysten/sui/utils';
import { assertMakerV8Document, projectPublicMakerV8Document, compareMakerV8ProtocolText } from './maker-v8-document.js';
import { assertMakerV8LivingContentPublishableV8 } from './maker-v8-living-content.js';

const utf8 = new TextEncoder();
const bytes = bcs.vector(bcs.u8());
const header = { domain: bcs.string(), schema_revision: bcs.u64() };
const Defaults = bcs.struct('CreatorDefaultsCommitmentInputV1', {
  ...header,
  ordered_recipe_selections: bcs.vector(bcs.struct('CreatorDefaultSelectionV1', {
    part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(),
  })),
  ordered_recipe_colors: bcs.vector(bcs.struct('CreatorDefaultColorV1', {
    channel_key: bcs.string(), swatch_key: bcs.string(),
  })),
  output_key: bcs.string(), soul_md_sha256: bytes, memory_md_sha256: bytes, skill_md_sha256: bytes,
});
const Bundle = bcs.struct('LivingContentBundleCommitmentInputV1', {
  ...header, creator_defaults_commitment: bytes,
  soul_md_bytes: bytes, memory_md_bytes: bytes, skill_md_bytes: bytes,
});
const Binding = bcs.struct('LivingContentBindingCommitmentInputV1', {
  ...header, creator_defaults_commitment: bytes, blob_id: bcs.string(),
  sha256: bytes, byte_length: bcs.u64(), bundle_commitment: bytes,
});

// Validated JSON only; preserve array order and the existing protocol's UTF-16
// member ordering. Text is data: no interpolation, normalization or Markdown execution.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareMakerV8ProtocolText)
      .map(key => [key, canonical(value[key])]));
  }
  return value;
}

export async function compileMakerV8LivingContentV8(document) {
  assertMakerV8Document(document, { mode: 'compile' });
  assertMakerV8LivingContentPublishableV8(document.livingContent);
  const publicDocument = projectPublicMakerV8Document(document);
  const makerDocumentCommitment = toHex(sha256(utf8.encode(JSON.stringify(canonical({
    schemaVersion: 'animacraft.maker-v8-document-commitment.v2', document: publicDocument,
  })))));
  const outputKey = publicDocument.outputs[0].key;
  const soul = utf8.encode(publicDocument.livingContent.soulMd);
  const memory = utf8.encode(publicDocument.livingContent.memoryMd);
  const skill = utf8.encode(publicDocument.livingContent.skillMd);
  const defaultsBytes = Defaults.serialize({
    domain: 'animacraft-fresh-v8/core/creator-defaults/v1', schema_revision: 1,
    ordered_recipe_selections: publicDocument.defaultRecipe.selections.map(selection => ({
      part_key: selection.partKey, item_key: selection.itemKey, style_key: selection.styleKey,
    })),
    ordered_recipe_colors: publicDocument.defaultRecipe.colors.map(color => ({
      channel_key: color.channelKey, swatch_key: color.swatchKey,
    })),
    output_key: outputKey,
    soul_md_sha256: sha256(soul), memory_md_sha256: sha256(memory), skill_md_sha256: sha256(skill),
  }).toBytes();
  const defaultsCommitment = sha256(defaultsBytes);
  const bundleBytes = Bundle.serialize({
    domain: 'animacraft-fresh-v8/output/living-content-bundle/v1', schema_revision: 1,
    creator_defaults_commitment: defaultsCommitment,
    soul_md_bytes: soul, memory_md_bytes: memory, skill_md_bytes: skill,
  }).toBytes();
  const bundleCommitment = toHex(sha256(bundleBytes));
  return Object.freeze({
    makerDocumentCommitment,
    creatorDefaultsCommitment: toHex(defaultsCommitment),
    bundleCommitment,
    bytes: Object.freeze(Array.from(bundleBytes)),
    sha256: bundleCommitment,
    byteLength: bundleBytes.length,
    outputKey,
  });
}

function invalid(message) {
  const error = new TypeError(message);
  error.code = 'MAKER_V8_LIVING_CONTENT_BINDING_INVALID';
  throw error;
}
function digest(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) {
    invalid(`${name} must be a canonical nonzero SHA-256 commitment.`);
  }
  return fromHex(value);
}

/** Exact Core LivingContentBindingCommitmentInputV1, after real bundle upload. */
export function deriveMakerV8LivingContentBindingV8(value) {
  const keys = ['creatorDefaultsCommitment', 'blobId', 'sha256', 'byteLength', 'bundleCommitment'];
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length
    || !keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })) invalid('Living Content binding requires exactly five data fields.');
  const length = value.byteLength;
  if (!['number', 'string', 'bigint'].includes(typeof length)
    || (typeof length === 'number' && !Number.isSafeInteger(length))
    || !/^[1-9][0-9]*$/.test(String(length)) || BigInt(length) > (1n << 64n) - 1n) {
    invalid('byteLength must be an exact positive u64.');
  }
  if (typeof value.blobId !== 'string' || utf8.encode(value.blobId).length === 0
    || utf8.encode(value.blobId).length > 512) invalid('blobId must contain 1–512 UTF-8 bytes.');
  return toHex(sha256(Binding.serialize({
    domain: 'animacraft-fresh-v8/output/living-content-binding/v1', schema_revision: 1,
    creator_defaults_commitment: digest(value.creatorDefaultsCommitment, 'creatorDefaultsCommitment'),
    blob_id: value.blobId, sha256: digest(value.sha256, 'sha256'),
    byte_length: BigInt(length), bundle_commitment: digest(value.bundleCommitment, 'bundleCommitment'),
  }).toBytes()));
}
