import { bcs } from '@mysten/sui/bcs';
import { MAKER_V8_BASE_ROW_BCS_V2 } from './maker-v8-base-rows.js';

// Storage commitments are computed only after certified scaffold readback has
// supplied the real Root and registry IDs. They are not pre-creation inputs.
export const MAKER_V8_BASE_CATEGORIES_V2 = Object.freeze([
  ['track', 'tracks', 0], ['color', 'colors', 1], ['part', 'parts', 2],
  ['item', 'items', 3], ['style', 'styles', 4], ['rule', 'rules', 5],
  ['asset', 'assets', 6],
].map(Object.freeze));
const bytes = bcs.byteVector();
const prefix = { domain: bcs.string(), schema_revision: bcs.u64() };
const identity = { registry_id: bcs.Address, root_id: bcs.Address, maker_version: bcs.u64() };
const Empty = bcs.struct('RegistryEmptyCommitmentInputV2', { ...prefix, ...identity, category_tag: bcs.u8() });
const Row = bcs.struct('RegistryRowCommitmentInputV2', { ...prefix, ...identity, category_tag: bcs.u8(), sequence: bcs.u64(), row_bcs: bytes });
const Advance = bcs.struct('RegistryAdvanceCommitmentInputV2', { ...prefix, registry_id: bcs.Address, category_tag: bcs.u8(), sequence: bcs.u64(), prior_rolling_commitment: bytes, row_commitment: bytes });
const CategorySeal = bcs.struct('RegistryCategorySealCommitmentInputV2', { ...prefix, ...identity, category_tag: bcs.u8(), count: bcs.u64(), initial_commitment: bytes, final_rolling_commitment: bytes });
const Seal = bcs.struct('RegistrySealCommitmentInputV2', { ...prefix, ...identity, ordered_category_tags: bytes, ordered_category_commitments: bcs.vector(bytes), aggregate_count: bcs.u64() });
const AuthorEmpty = bcs.struct('AuthorRowsEmptyCommitmentInputV2', prefix);
const AuthorAdvance = bcs.struct('AuthorRowsAdvanceCommitmentInputV2', { ...prefix, category_tag: bcs.u8(), sequence: bcs.u64(), aggregate_sequence: bcs.u64(), prior_commitment: bytes, row_bcs: bytes });
const AuthorSeal = bcs.struct('AuthorRowsSealCommitmentInputV2', { ...prefix, ordered_counts: bcs.vector(bcs.u64()), final_rolling_commitment: bytes });
const Selector = bcs.struct('SemanticSelectorV2', { source: bcs.u8(), source_key: bcs.option(bcs.string()), part_key: bcs.string(), item_key: bcs.option(bcs.string()), style_key: bcs.option(bcs.string()) });
const Rule = bcs.struct('RuleRowV2', { sequence: bcs.u64(), key: bcs.string(), kind: bcs.u8(), trigger: Selector, target_mode: bcs.u8(), targets: bcs.vector(Selector), payload_commitment: bytes });
const SelectorHash = bcs.struct('SemanticSelectorCommitmentInputV2', { ...prefix, selector: Selector });
const RuleHash = bcs.struct('RuleRowCommitmentInputV2', { ...prefix, definition_source: bcs.u8(), definition_source_key: bcs.option(bcs.string()), sequence: bcs.u64(), key: bcs.string(), kind: bcs.u8(), trigger_selector_commitment: bytes, target_mode: bcs.u8(), ordered_target_selector_commitments: bcs.vector(bytes), payload_commitment: bytes });
const authorDomain = name => ({ domain: `animacraft-fresh-v8/compiler/author-rows-${name}/v2`, schema_revision: 2n });
const domain = name => ({ domain: `animacraft-fresh-v8/compiler/registry-${name}/v2`, schema_revision: 2n });
const hex = value => [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
function hashBytes(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Base commitment must be canonical 32-byte hex.');
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
}
async function hash(type, value) {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', type.serialize(value).toBytes())));
}
function id(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('Base storage identity requires a Sui object ID.');
  const normalized = `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
  if (/^0x0+$/.test(normalized)) throw new Error('Base storage identity cannot be zero.');
  return normalized;
}
function u64(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value) || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('Base sequence must be exact u64.');
  const result = BigInt(value);
  if (result > 18446744073709551615n) throw new Error('Base sequence exceeds u64.');
  return result;
}

function checkedEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Base rows must be an ordered array.');
  const counts = Object.fromEntries(MAKER_V8_BASE_CATEGORIES_V2.map(([, plural]) => [plural, 0n]));
  let previous = -1;
  return entries.map(entry => {
    const category = MAKER_V8_BASE_CATEGORIES_V2.find(([kind]) => kind === entry.kind);
    if (!category) throw new Error('Unknown Base row category.');
    const [, plural, tag] = category;
    const sequence = u64(entry.row?.sequence);
    if (tag < previous || sequence !== counts[plural]) throw new Error('Base rows must be ordered with contiguous category-local sequences.');
    previous = tag;
    counts[plural] += 1n;
    if (!(Array.isArray(entry.bytes) || entry.bytes instanceof Uint8Array) || entry.bytes.length === 0 || [...entry.bytes].some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Base row BCS bytes are required.');
    const encoded = Uint8Array.from(entry.bytes);
    if (encoded.length < 8 || new DataView(encoded.buffer).getBigUint64(0, true) !== sequence) throw new Error('Base row BCS sequence differs from its category sequence.');
    const schema = entry.kind === 'rule' ? Rule : MAKER_V8_BASE_ROW_BCS_V2[entry.kind];
    const decoded = schema.parse(encoded);
    if (hex(schema.serialize(decoded).toBytes()) !== hex(encoded)) throw new Error('Base row bytes are not canonical BCS.');
    return { kind: entry.kind, bytes: encoded, commitment: entry.commitment, protected: entry.kind === 'style' && decoded.protected, category: tag, plural, sequence };
  });
}

async function ruleCommitment(entry) {
  const row = Rule.parse(entry.bytes);
  if (hex(Rule.serialize(row).toBytes()) !== hex(entry.bytes)) throw new Error('Rule bytes are not canonical BCS.');
  const selectorHash = selector => hash(SelectorHash, { domain: 'animacraft-fresh-v8/core/semantic-selector/v2', schema_revision: 8n, selector });
  const commitment = await hash(RuleHash, { domain: 'animacraft-fresh-v8/core/rule-row/v2', schema_revision: 8n, definition_source: 1, definition_source_key: null, sequence: row.sequence, key: row.key, kind: row.kind, trigger_selector_commitment: hashBytes(await selectorHash(row.trigger)), target_mode: row.target_mode, ordered_target_selector_commitments: await Promise.all(row.targets.map(async selector => hashBytes(await selectorHash(selector)))), payload_commitment: row.payload_commitment });
  if (entry.commitment !== undefined && entry.commitment !== commitment) throw new Error('Rule commitment differs from its canonical row bytes.');
  return commitment;
}

/** Precomputable author intent; no transaction-created object IDs are inputs. */
export async function deriveMakerV8BaseAuthorCommitmentV2(entries) {
  const checked = checkedEntries(entries);
  const counts = Object.fromEntries(MAKER_V8_BASE_CATEGORIES_V2.map(([, plural]) => [plural, 0n]));
  const initialCommitment = await hash(AuthorEmpty, authorDomain('empty'));
  let rolling = initialCommitment;
  const checkpoints = [rolling];
  for (const [index, entry] of checked.entries()) {
    rolling = await hash(AuthorAdvance, { ...authorDomain('advance'), category_tag: entry.category, sequence: entry.sequence, aggregate_sequence: BigInt(index), prior_commitment: hashBytes(rolling), row_bcs: entry.bytes });
    counts[entry.plural] += 1n;
    checkpoints.push(rolling);
  }
  const commitment = await hash(AuthorSeal, { ...authorDomain('seal'), ordered_counts: MAKER_V8_BASE_CATEGORIES_V2.map(([, plural]) => counts[plural]), final_rolling_commitment: hashBytes(rolling) });
  return Object.freeze({ initialCommitment, rollingCommitment: rolling, commitment, checkpoints: Object.freeze(checkpoints), counts: Object.freeze(counts), total: BigInt(checked.length) });
}

/**
 * Entries are canonical row compiler results { kind, row, bytes, commitment? }.
 * Rule uses its semantic-selector commitment, exactly as append_rule_v2 does;
 * every other row uses the identity-bound RegistryRowCommitmentInputV2.
 * Returned checkpoints separate rolling values from the final sealed values.
 */
export async function deriveMakerV8BaseStorageCommitmentsV2({ registryId, rootId, makerVersion, entries }) {
  entries = checkedEntries(entries);
  const binding = { registry_id: id(registryId), root_id: id(rootId), maker_version: u64(makerVersion) };
  if (binding.registry_id === binding.root_id || binding.maker_version === 0n) throw new Error('Base storage identity is invalid.');
  if (!Array.isArray(entries)) throw new Error('Base rows must be an ordered array.');
  const categories = [...MAKER_V8_BASE_CATEGORIES_V2, ['aggregate', 'aggregate', 255]];
  const initial = {};
  for (const [, plural, category] of categories) initial[plural] = await hash(Empty, { ...domain('empty'), ...binding, category_tag: category });
  const rolling = { ...initial };
  const counts = Object.fromEntries(MAKER_V8_BASE_CATEGORIES_V2.map(([, plural]) => [plural, 0n]));
  let total = 0n;
  let previousCategory = -1;
  let protectedStyleCount = 0n;
  const checkpoint = () => Object.freeze({ nextSequence: total, observedCounts: Object.freeze({ ...counts }), rollingCommitments: Object.freeze({ ...rolling }), protectedStyleCount, sealed: false });
  const checkpoints = [checkpoint()];
  for (const entry of entries) {
    const categoryEntry = MAKER_V8_BASE_CATEGORIES_V2.find(([kind]) => kind === entry.kind);
    if (!categoryEntry) throw new Error('Unknown Base row category.');
    const [, plural, category] = categoryEntry;
    const sequence = entry.sequence;
    if (category < previousCategory || sequence !== counts[plural]) throw new Error('Base rows must be ordered with contiguous category-local sequences.');
    previousCategory = category;
    if (!(Array.isArray(entry.bytes) || entry.bytes instanceof Uint8Array) || entry.bytes.length === 0 || [...entry.bytes].some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Base row BCS bytes are required.');
    const rowCommitment = entry.kind === 'rule'
      ? await ruleCommitment(entry)
      : await hash(Row, { ...domain('row'), ...binding, category_tag: category, sequence, row_bcs: entry.bytes });
    for (const [name, tag, index] of [[plural, category, sequence], ['aggregate', 255, total]]) {
      rolling[name] = await hash(Advance, { ...domain('advance'), registry_id: binding.registry_id, category_tag: tag, sequence: index, prior_rolling_commitment: hashBytes(rolling[name]), row_commitment: hashBytes(rowCommitment) });
    }
    counts[plural] += 1n;
    total += 1n;
    if (entry.protected) protectedStyleCount += 1n;
    checkpoints.push(checkpoint());
  }
  const categorySeals = {};
  for (const [, plural, category] of categories) categorySeals[plural] = await hash(CategorySeal, { ...domain('category-seal'), ...binding, category_tag: category, count: plural === 'aggregate' ? total : counts[plural], initial_commitment: hashBytes(initial[plural]), final_rolling_commitment: hashBytes(rolling[plural]) });
  const aggregate = await hash(Seal, { ...domain('seal'), ...binding, ordered_category_tags: categories.map(([, , tag]) => tag), ordered_category_commitments: categories.map(([, plural]) => hashBytes(categorySeals[plural])), aggregate_count: total });
  return Object.freeze({ initialCommitments: Object.freeze(initial), rollingCommitments: Object.freeze(rolling), sealedCommitments: Object.freeze({ ...categorySeals, aggregate }), aggregateCategoryCommitment: categorySeals.aggregate, checkpoints: Object.freeze(checkpoints), counts: Object.freeze(counts), total });
}
