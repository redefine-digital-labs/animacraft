import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { toBase58, fromBase64, deriveDynamicFieldID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import { createMakerV8PackReadbackV8 } from '../maker-v8-pack-publication-adapters.js';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';
import { MAKER_V8_PACK_DEFINITIONS_BCS, MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS,
  MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 } from '../maker-v8-pack-definition-wire.js';
import { MAKER_V8_TRANSACTION_LIMITS } from '../maker-v8-compiler.js';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { packPublicationAuthoringContent } from '../maker-v8-pack-authoring.js';
import { compileMakerV8PackDefinitionRowsV8, buildMakerV8PackDefinitionRegistrationV8,
  planMakerV8PackDefinitionRegistrationV8, buildMakerV8PackDefinitionStepV8 } from '../maker-v8-pack-compiler.js';
import { MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2 } from '../maker-v8-pack-definitions-compiler.js';
import { compileMakerV8VisibilityV1 } from '../maker-v8-base-rows.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const ref = n => ({ objectId: id(n), version: '1', digest: toBase58(new Uint8Array(32).fill(n)) });
const options = () => ({ corePackageId: id(1), coreOriginalPackageId: id(2), runtimePackageId: id(3),
  signer: id(4), paymentCoinType: '0x2::sui::SUI', releaseRef: { objectId: id(34), initialSharedVersion: '5' }, adminCapRef: ref(6),
  baseRegistryRef: { objectId: id(7), initialSharedVersion: '9' }, releaseContentCommitment: '01'.repeat(32) });
function fixture(owned = true, published = false) {
  const parent = createCreatorCharacterStarter();
  parent.assets.push({ id: 'base-image', kind: 'layer', mediaType: 'image/png', byteLength: 3 });
  for (const part of parent.parts) part.items[0].styles[0].assetId = 'base-image';
  const document = structuredClone(parent);
  if (owned) {
    document.tracks.push({ key: 'overlay', label: 'Overlay', renderOrder: 99, locked: false });
    document.colors.push({ key: 'tint', label: 'Tint', defaultSwatchKey: 'red',
      swatches: [{ key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] }] });
    document.parts.push({ ...structuredClone(parent.parts[0]), key: 'own', label: 'Own', renderOrder: 99,
      menuOrder: 99, wardrobeMode: 'FIXED', capacity: 2, items: [] });
    document.rules.push({ key: 'require-base', kind: 'REQUIRE', trigger: {
      source: 'BASE', sourceKey: null, partKey: 'own', itemKey: null, styleKey: null }, targetMode: 'ALL',
      targets: [{ source: 'BASE', sourceKey: null, partKey: parent.parts[0].key, itemKey: null, styleKey: null }], payload: {} });
  }
  const styles = [];
  if (published) {
    const part = document.parts[0], inherited = part.items[0];
    const fresh = { ...structuredClone(inherited), key: 'pack-item', defaultStyleKey: 'fresh', styles: [] };
    part.items.push(fresh);
    for (const [index, [item, styleKey]] of [[inherited, 'extra-one'], [inherited, 'extra-two'], [fresh, 'fresh']].entries()) {
      styles.push({ sequence: String(index), partKey: part.key, itemKey: item.key, styleKey,
        layerTrackKey: parent.tracks[0].key, colorChannelKey: null, defaultSwatchKey: null,
        asset: { assetId: `pack-art-${index}`, contentCommitment: '22'.repeat(32), protected: false,
          mediaType: 'image/png', byteLength: 3 } });
    }
  }
  return packPublicationAuthoringContent({ styles, authoring: document, bindings: { kind: 'LOCAL_DRAFT',
    parent: { draft: { document: parent }, assets: [{ assetId: 'base-image', kind: 'layer',
      mediaType: 'image/png', byteLength: 3, sha256: '11'.repeat(32) }] } } });
}
const compile = input => compileMakerV8PackDefinitionRowsV8(input.content,
  { expectedParent: input.content.parent, semanticPackId: 'extras' });

test('definition publication readback certifies outer rows and nested color history together', async () => {
  const { config } = currentRuntimeAuthorityFixture();
  const opts = { ...options(), paymentCoinType: config.paymentCoinType, corePackageId: config.roles.core.callablePackageId,
    coreOriginalPackageId: config.roles.core.typeOriginPackageId, runtimePackageId: config.roles.runtime.callablePackageId };
  const source = fixture(true, true);
  for (let i = 0; i < 200; i++) source.content.document.colors.find(row => row.key === 'tint').swatches
    .push({ key: `shade-${i}`, label: 'x'.repeat(120), rgba: '#ff0000ff', stops: [] });
  const value = await compile(source);
  const plan = await planMakerV8PackDefinitionRegistrationV8(value, opts, { maxRowsPerChunk: 1 });
  let history, pending, response, expectedKind, txDigest;
  let reads = 0;
  const client = { async getHistoricalObject(input) {
    reads++;
    const object = input.objectId === pending?.objectId ? pending : history;
    assert.deepEqual(input, { objectId: object.objectId, version: BigInt(object.version) });
    return object;
  } };
  const reader = createMakerV8PackReadbackV8({ runtime: config, client, assertTransport() {},
    async readFinalized(actualClient, digest, transaction) {
      assert.equal(actualClient, client); assert.equal(digest, txDigest);
      assert.equal(transaction.getData().sender, opts.signer);
      assert.deepEqual(await transaction.build({ onlyTransactionKind: true }), fromBase64(expectedKind));
      return response;
    } });
  for (let ordinal = 0; ordinal < plan.steps.length; ordinal++) {
    pending = null;
    const step = plan.steps[ordinal], final = step.stage === 'FINALIZE';
    txDigest = toBase58(new Uint8Array(32).fill(ordinal + 1));
    expectedKind = (await buildMakerV8PackDefinitionStepV8(value, plan, ordinal, opts)).kindBytesBase64;
    const origin = config.roles.runtime.typeOriginPackageId;
    const key = `${origin}::runtime_v8::PackDefinitions${final ? '' : 'Draft'}KeyV8`;
    const type = `0x2::dynamic_field::Field<${key},${origin}::runtime_v8::PackDefinitions${final ? '' : 'Draft'}V8>`;
    const fieldId = deriveDynamicFieldID(opts.releaseRef.objectId, key, Uint8Array.of(0));
    const kinds = ['tracks', 'colors', 'parts', 'rules', 'visibility'];
    let remaining = step.end;
    const rows = { semantic_pack_id: value.rows.semantic_pack_id };
    for (const kind of kinds) {
      rows[kind] = value.rows[kind].slice(0, remaining); remaining -= rows[kind].length;
    }
    const commitment = Array.from(Buffer.from(plan.definitionCommitment, 'hex'));
    const stored = final ? { version: '8', release_id: opts.releaseRef.objectId,
      release_content_commitment: Array(32).fill(1), rows, commitment }
      : { next_chunk: step.stage === 'BEGIN' ? 0 : step.chunkIndex + 1, expected_commitment: commitment, rows };
    const schema = bcs.struct('HistoricalField', { id: bcs.Address, name: bcs.bool(),
      value: final ? MAKER_V8_PACK_DEFINITIONS_BCS : MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS });
    const encode = data => schema.serialize({ id: fieldId, name: false, value: data }).toBytes();
    const fieldRef = { objectId: fieldId, version: String(ordinal + 10), digest: toBase58(new Uint8Array(32).fill(90)) };
    history = { ...fieldRef, type, owner: { ObjectOwner: opts.releaseRef.objectId }, previousTransaction: txDigest,
      parsed: {}, contentBcs: encode(stored), objectBcs: Uint8Array.of(1) };
    response = { objectChanges: [{ ...fieldRef, type: step.stage === 'APPEND' ? 'mutated' : 'created', objectType: type }],
      compilerEffectsOutputRefs: [fieldRef], events: [],
      compilerTransactionKindProof: { transactionKindSha256: createHash('sha256').update(fromBase64(expectedKind)).digest('hex') } };
    if (step.stage === 'COLOR_BEGIN' || step.stage === 'COLOR_APPEND') {
      const colorKey = `${origin}::runtime_v8::PackColorDraftKeyV8`;
      const colorId = deriveDynamicFieldID(opts.releaseRef.objectId, colorKey, Uint8Array.of(0));
      const colorType = `0x2::dynamic_field::Field<${colorKey},${opts.coreOriginalPackageId}::base_registry_v8::ColorChannelDraftV2>`;
      const row = value.rows.colors[step.start - value.rows.tracks.length];
      const colorSchema = bcs.struct('ColorField', { id: bcs.Address, name: bcs.bool(), value: MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 });
      pending = { ...history, objectId: colorId, type: colorType, contentBcs: colorSchema.serialize({ id: colorId, name: false,
        value: { ...row, expected_swatches: row.swatches.length, swatches: row.swatches.slice(0, step.swatchEnd) } }).toBytes() };
      response.objectChanges.push({ ...fieldRef, objectId: colorId, type: step.stage === 'COLOR_BEGIN' ? 'created' : 'mutated', objectType: colorType });
      response.compilerEffectsOutputRefs.push({ ...fieldRef, objectId: colorId });
    }
    const input = { value, plan, ordinal, options: opts, query: { status: 'FINALIZED_SUCCESS', digest: txDigest } };
    const result = await reader.certifyDefinitionStep(input);
    assert.equal(result.stage, step.stage); assert.equal(result.observedRows, step.end);
    assert.deepEqual(result.field, fieldRef);
    for (const mutate of [
      () => { history.owner.ObjectOwner = id(999); },
      () => { history.contentBcs = new Uint8Array([...history.contentBcs, 0]); },
      () => { history.previousTransaction = toBase58(new Uint8Array(32).fill(99)); },
      () => { response.compilerEffectsOutputRefs[0].version = '999'; },
      () => { response.compilerTransactionKindProof.transactionKindSha256 = 'ff'.repeat(32); },
      () => { response.objectChanges.push(structuredClone(response.objectChanges[0])); },
      () => { history.contentBcs = encode(final ? { ...stored, commitment: Array(32).fill(0) }
        : { ...stored, next_chunk: Number(stored.next_chunk) + 1 }); },
      () => { history.contentBcs = encode({ ...stored, rows: { ...rows, semantic_pack_id: 'foreign' } }); },
      () => { response.events.push({ type: 'unexpected' }); },
      ...(step.end ? [() => {
        const missing = structuredClone(rows);
        missing[kinds.find(kind => missing[kind].length)].pop();
        history.contentBcs = encode({ ...stored, rows: missing });
      }] : []),
    ]) {
      const savedHistory = structuredClone(history), savedResponse = structuredClone(response);
      mutate();
      await assert.rejects(reader.certifyDefinitionStep(input));
      history = savedHistory; response = savedResponse;
    }
    if (pending) {
      for (const mutate of [() => { pending.contentBcs = Uint8Array.of(0); },
        () => { pending.owner.ObjectOwner = id(999); },
        () => { pending.previousTransaction = toBase58(new Uint8Array(32).fill(99)); },
        () => { response.compilerEffectsOutputRefs.pop(); }]) {
        const saved = structuredClone(pending), savedResponse = structuredClone(response);
        mutate(); await assert.rejects(reader.certifyDefinitionStep(input));
        pending = saved; response = savedResponse;
      }
    }
    const before = reads;
    await assert.rejects(reader.certifyDefinitionStep({ ...input, plan: structuredClone(plan) }), /authority differs/);
    await assert.rejects(reader.certifyDefinitionStep({ ...input, query: { ...input.query, status: 'UNKNOWN' } }));
    assert.equal(reads, before, 'untrusted plan/unknown finality cannot reach historical reads');
  }
});

test('definition chunk plan preserves exact commitment, global rows and refreshed object references', async () => {
  const value = await compile(fixture(true, true)), opts = options();
  const plan = await planMakerV8PackDefinitionRegistrationV8(value, opts, { maxRowsPerChunk: 1 });
  assert.equal(plan.steps.length, plan.rowCount + 2);
  assert.equal(plan.definitionCommitment, (await buildMakerV8PackDefinitionRegistrationV8(value, opts)).definitionCommitment);
  assert.deepEqual(plan.steps.filter(row => row.stage === 'APPEND').map(row => [row.start, row.end, row.chunkIndex]),
    Array.from({ length: plan.rowCount }, (_, i) => [i, i + 1, i]));
  const functions = [];
  for (let ordinal = 0; ordinal < plan.steps.length; ordinal++) {
    const updated = { ...opts, adminCapRef: { ...opts.adminCapRef, version: String(ordinal + 1) } };
    const built = await buildMakerV8PackDefinitionStepV8(value, plan, ordinal, updated);
    const data = built.transaction.getData();
    functions.push(data.commands.at(-1).MoveCall.function);
    assert.deepEqual(data.inputs.find(row => row.Object?.SharedObject?.objectId === opts.releaseRef.objectId).Object.SharedObject,
      { ...opts.releaseRef, mutable: true });
    assert.equal(data.inputs.find(row => row.Object?.ImmOrOwnedObject?.objectId === opts.adminCapRef.objectId).Object.ImmOrOwnedObject.version, String(ordinal + 1));
  }
  assert.deepEqual(functions, ['begin_pack_definitions_v8', ...Array(plan.rowCount).fill('append_pack_definitions_v8'), 'finalize_pack_definitions_v8']);
  assert.deepEqual(await planMakerV8PackDefinitionRegistrationV8(value, opts, { maxRowsPerChunk: 1 }), plan);
  for (const changed of [{ ...opts, signer: id(99) },
    { ...opts, releaseRef: { ...opts.releaseRef, objectId: id(99) } },
    { ...opts, releaseRef: { ...opts.releaseRef, initialSharedVersion: '6' } },
    { ...opts, releaseContentCommitment: 'ff'.repeat(32) }]) {
    await assert.rejects(buildMakerV8PackDefinitionStepV8(value, plan, 0, changed), /authority differs/);
  }
  await assert.rejects(buildMakerV8PackDefinitionStepV8(value, structuredClone(plan), 0, opts), /authority differs/);
  await assert.rejects(buildMakerV8PackDefinitionStepV8(value, plan, plan.steps.length, opts), /authority differs/);
});

test('definition registration requires the Release shared by publication INIT, never an owned ref', async () => {
  const value = await compile(fixture(false));
  for (const releaseRef of [ref(34),
    { objectId: id(34), initialSharedVersion: '0' },
    { objectId: id(34), initialSharedVersion: 5 },
    { objectId: id(34), initialSharedVersion: '18446744073709551616' }]) {
    const opts = { ...options(), releaseRef };
    await assert.rejects(buildMakerV8PackDefinitionRegistrationV8(value, opts), /Exact Release initial shared version/);
    await assert.rejects(planMakerV8PackDefinitionRegistrationV8(value, opts), /Exact Release initial shared version/);
  }
});

test('empty authored definitions have begin and finalize only, never an empty append', async () => {
  const value = await compile(fixture(false));
  const plan = await planMakerV8PackDefinitionRegistrationV8(value, options());
  assert.deepEqual(plan.steps.map(row => [row.stage, row.chunkIndex]), [['BEGIN', 0], ['FINALIZE', 0]]);
});

test('Pack visibility BCS follows the exact Core field order', () => {
  const bytes = MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2.serialize({ subject: 1, definition_source: 1,
    part_key: 'p', item_key: 'i', style_key: null, visibility_tokens: [], visibility_commitment: Array(32).fill(1) }).toBytes();
  assert.equal(Buffer.from(bytes).toString('hex'), '010101700169000020' + '01'.repeat(32));
});

test('Pack compiler uses only owned rows, local sequences and real Core constructors', async () => {
  const input = fixture(), original = structuredClone(input.content), result = await compile(input);
  assert.deepEqual(Object.fromEntries(['tracks', 'colors', 'parts', 'rules'].map(kind => [kind, result.rows[kind].length])),
    { tracks: 1, colors: 1, parts: 1, rules: 1 });
  assert.equal(result.rows.parts[0].sequence, 0n);
  assert.equal(result.rows.parts[0].capacity, 2n);
  assert.equal(result.rows.rules[0].trigger.source, 1, 'Declared selectors remain intact pending contextual Runtime resolution');
  assert.deepEqual(input.content, original);
  assert.throws(() => { result.rows.parts[0].capacity = 3n; });
  const built = await buildMakerV8PackDefinitionRegistrationV8(result, options());
  const calls = built.transaction.getData().commands.filter(row => row.MoveCall).map(row => row.MoveCall);
  assert.ok(calls.some(row => row.function === 'new_color_channel_row_v2'));
  assert.ok(calls.some(row => row.function === 'new_part_row_v2'));
  assert.ok(calls.some(row => row.function === 'new_rule_row_v2'));
  assert.equal(calls.at(-2).function, 'new_pack_definition_rows_v2');
  assert.equal(calls.at(-2).arguments.length, 6);
  assert.equal(calls.at(-1).function, 'register_pack_definitions_v8');
  assert.equal(calls.at(-1).arguments.length, 5);
  const registryInput = built.transaction.getData().inputs[calls.at(-1).arguments[2].Input];
  const releaseInput = built.transaction.getData().inputs[calls.at(-1).arguments[0].Input];
  assert.deepEqual(releaseInput.Object.SharedObject, { ...options().releaseRef, mutable: true });
  assert.deepEqual(registryInput.Object.SharedObject,
    { objectId: id(7), initialSharedVersion: '9', mutable: false });
  assert.ok(!calls.some(row => /^(append_|seal_|admit_)/.test(row.function)));
  assert.match(built.definitionCommitment, /^[0-9a-f]{64}$/);
  await assert.rejects(buildMakerV8PackDefinitionRegistrationV8(structuredClone(result), options()), /Compiler-produced/);
});

test('Player-owned Part projection follows published row order, not author insertion order', async () => {
  const input = fixture();
  const own = input.content.document.parts.find(row => row.key === 'own');
  input.content.document.parts.push({ ...structuredClone(own), key: 'earlier', menuOrder: own.menuOrder - 1 });
  const result = await compile(input);
  assert.deepEqual(result.rows.parts.map(row => row.key), ['earlier', 'own']);
  assert.deepEqual(result.ownedParts.map(row => row.key), result.rows.parts.map(row => row.key));
});

test('definition commitment matches independent BCS preimage and exact Release identity', async () => {
  const result = await compile(fixture(false));
  const built = await buildMakerV8PackDefinitionRegistrationV8(result, options());
  const domain = Buffer.from('animacraft-v8/runtime/pack-definitions');
  const preimage = Buffer.concat([Buffer.from([domain.length]), domain, Buffer.from('0800000000000000', 'hex'),
    Buffer.from(id(34).slice(2), 'hex'), Buffer.from([32]), Buffer.alloc(32, 1),
    Buffer.from([6]), Buffer.from('extras'), Buffer.from([0, 0, 0, 0, 0])]);
  assert.equal(built.definitionCommitment, createHash('sha256').update(preimage).digest('hex'));
  assert.equal(built.definitionCommitment, 'f1adc4b85ba61f64a2061b721acaa691b3b20d01772b76d85860e6a7b65d82d4');
  const changed = await buildMakerV8PackDefinitionRegistrationV8(result,
    { ...options(), releaseRef: { ...options().releaseRef, objectId: id(35) } });
  assert.notEqual(changed.definitionCommitment, built.definitionCommitment);
});

test('published Styles bind deduplicated inherited/new Item visibility and Pack-scoped Style conditions', async () => {
  const input = fixture(false, true);
  const part = input.content.document.parts[0], item = part.items[0];
  const style = item.styles.find(style => style.key === 'extra-one');
  style.visibleWhen = { op: 'selected', source: 'BASE', sourceKey: null, partKey: input.content.document.parts[1].key, itemKey: null, styleKey: null };
  const result = await compile(input), rows = result.rows.visibility;
  assert.deepEqual(rows.map(row => [row.subject, row.definition_source, row.item_key, row.style_key]), [
    [1, 1, item.key, null], [2, 2, item.key, 'extra-one'], [2, 2, item.key, 'extra-two'],
    [1, 2, 'pack-item', null], [2, 2, 'pack-item', 'fresh'],
  ]);
  assert.deepEqual(rows[0].visibility_tokens, []);
  assert.deepEqual(rows[2].visibility_tokens, []);
  assert.equal(rows[1].visibility_tokens[0].selector.source, 1, 'Source of the condition stays independently declared');
  assert.deepEqual(rows[0].visibility_commitment,
    (await compileMakerV8VisibilityV1(1, part.key, item.key)).visibility_commitment);
  assert.deepEqual(rows[1].visibility_commitment,
    (await compileMakerV8VisibilityV1(2, part.key, item.key, 'extra-one', style.visibleWhen, 2, 'extras')).visibility_commitment);
  for (const row of rows) {
    const parsed = MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2.parse(MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2.serialize(row).toBytes());
    assert.deepEqual(parsed, row);
  }
  const built = await buildMakerV8PackDefinitionRegistrationV8(result, options());
  const calls = built.transaction.getData().commands.filter(row => row.MoveCall).map(row => row.MoveCall);
  assert.equal(calls.filter(row => row.function === 'new_pack_visibility_row_v2').length, 5);
  assert.ok(calls.filter(row => row.function === 'new_pack_visibility_row_v2').every(row => row.arguments.length === 7));
  assert.equal(calls.at(-2).arguments.length, 6);
  delete style.visibleWhen;
  const changed = await buildMakerV8PackDefinitionRegistrationV8(await compile(input), options());
  assert.notEqual(changed.definitionCommitment, built.definitionCommitment);
});

test('Style references retain independent Base and Pack-owned definition namespaces', async () => {
  const input = fixture(true, true);
  const document = input.content.document;
  const part = document.parts[0];
  const style = part.items[0].styles.find(row => row.key === 'extra-one');
  Object.assign(style, { trackKey: 'overlay', colorChannelKey: 'tint', defaultSwatchKey: 'red' });
  Object.assign(input.content.styles[0], { layerTrackKey: 'overlay', colorChannelKey: 'tint', defaultSwatchKey: 'red' });
  const own = document.parts.find(row => row.key === 'own');
  const fresh = part.items.find(row => row.key === 'pack-item');
  part.items = part.items.filter(row => row !== fresh);
  own.items.push(fresh);
  input.content.styles[2].partKey = 'own';
  const original = structuredClone(input.content);
  const result = await compile(input);
  assert.deepEqual(result.styleReferences[0], {
    sequence: '0', part: { scope: 'BASE', key: part.key }, itemKey: part.items[0].key,
    styleKey: 'extra-one', track: { scope: 'PACK_SELF', key: 'overlay' },
    color: { scope: 'PACK_SELF', key: 'tint' }, defaultSwatchKey: 'red',
  });
  assert.deepEqual(result.styleReferences[2].part, { scope: 'PACK_SELF', key: 'own' });
  assert.deepEqual(result.styleReferences[2].track, { scope: 'BASE', key: input.content.parent.document.tracks[0].key });
  assert.equal(result.styleReferences[2].color, null);
  assert.ok(Object.isFrozen(result.styleReferences[0].track));
  assert.deepEqual(input.content, original);
});

test('untrusted parent and invalid scope reject before transaction construction', async () => {
  const input = fixture();
  await assert.rejects(compileMakerV8PackDefinitionRowsV8(input.content, { semanticPackId: 'extras' }), /authenticated parent/);
  await assert.rejects(compileMakerV8PackDefinitionRowsV8(input.content,
    { expectedParent: input.content.parent, semanticPackId: '' }), /semantic/);
  const result = await compile(input);
  await assert.rejects(buildMakerV8PackDefinitionRegistrationV8(result,
    { ...options(), releaseContentCommitment: '00'.repeat(32) }), /nonzero content/);
});

test('oversized definition registration fails locally without emitting an executable stage', async () => {
  const input = fixture();
  for (let index = 0; index < 65; index++) input.content.document.tracks.push({
    key: `extra-${index}`, label: `Extra ${index}`, renderOrder: 100 + index, locked: false,
  });
  const result = await compile(input);
  await assert.rejects(buildMakerV8PackDefinitionRegistrationV8(result, options()), /chunked registration is required/);
  const plan = await planMakerV8PackDefinitionRegistrationV8(result, options());
  assert.ok(plan.steps.filter(step => step.stage === 'APPEND').length > 1);
  const sequences = [];
  for (let ordinal = 0; ordinal < plan.steps.length; ordinal++) {
    const built = await buildMakerV8PackDefinitionStepV8(result, plan, ordinal, options());
    const data = built.transaction.getData();
    assert.ok(data.commands.length <= MAKER_V8_TRANSACTION_LIMITS.maxCommands);
    assert.ok(data.inputs.length <= MAKER_V8_TRANSACTION_LIMITS.maxInputs);
    assert.ok(fromBase64(built.kindBytesBase64).length <= MAKER_V8_TRANSACTION_LIMITS.maxKindBytes);
    assert.ok(built.step.end - built.step.start <= MAKER_V8_TRANSACTION_LIMITS.maxRowsPerChunk);
    for (const { MoveCall: call } of data.commands) {
      if (call?.function !== 'new_track_row_v2') continue;
      sequences.push(Number(Buffer.from(fromBase64(data.inputs[call.arguments[0].Input].Pure.bytes)).readBigUInt64LE()));
    }
  }
  assert.deepEqual(sequences, result.rows.tracks.map(row => Number(row.sequence)), 'Never rebase row sequence at a batch boundary');
});

test('large color palette uses compact columns instead of exceeding the command budget', async () => {
  const input = fixture();
  const color = input.content.document.colors.find(row => row.key === 'tint');
  for (let i = 0; i < 80; i++) color.swatches.push({ key: `shade-${i}`, label: `Shade ${i}`, rgba: '#ff0000ff', stops: [] });
  color.swatches[0].stops = [{ offset: 0.5, rgba: '#ff0000ff' }, { offset: 0.5, rgba: '#0000ffff' }];
  const result = await compile(input);
  const plan = await planMakerV8PackDefinitionRegistrationV8(result, options());
  let found = false;
  for (let ordinal = 0; ordinal < plan.steps.length; ordinal++) {
    const built = await buildMakerV8PackDefinitionStepV8(result, plan, ordinal, options());
    const data = built.transaction.getData();
    assert.ok(data.commands.length <= MAKER_V8_TRANSACTION_LIMITS.maxCommands);
    assert.ok(data.inputs.length <= MAKER_V8_TRANSACTION_LIMITS.maxInputs);
    assert.ok(data.inputs.every(input => !input.Pure || fromBase64(input.Pure.bytes).length <= MAKER_V8_TRANSACTION_LIMITS.maxPureArgumentBytes));
    assert.ok(fromBase64(built.kindBytesBase64).length <= MAKER_V8_TRANSACTION_LIMITS.maxKindBytes);
    const call = data.commands.find(command => command.MoveCall?.function === 'new_color_swatches_v2')?.MoveCall;
    if (call) {
      found = true;
      const values = call.arguments.map(arg => fromBase64(data.inputs[arg.Input].Pure.bytes));
      assert.deepEqual(bcs.vector(bcs.string()).parse(values[0]), result.rows.colors[0].swatches.map(swatch => swatch.key));
      assert.deepEqual(bcs.vector(bcs.string()).parse(values[1]), result.rows.colors[0].swatches.map(swatch => swatch.label));
      assert.equal(bcs.vector(bcs.u32()).parse(values[2]).length, 81);
      assert.deepEqual(bcs.vector(bcs.vector(bcs.u64())).parse(values[3]),
        result.rows.colors[0].swatches.map(swatch => swatch.stops.map(stop => String(stop.offset_ppm))));
      assert.deepEqual(bcs.vector(bcs.vector(bcs.u32())).parse(values[4]),
        result.rows.colors[0].swatches.map(swatch => swatch.stops.map(stop => stop.rgba)));
      assert.ok(!data.commands.some(command => command.MoveCall?.function === 'new_color_swatch_v2'));
    }
  }
  assert.ok(found);
  assert.equal(plan.definitionCommitment, (await buildMakerV8PackDefinitionRegistrationV8(result, options())).definitionCommitment);
});

test('byte-oversized color splits into bounded swatch stages and advances outer rows only at finish', async () => {
  const input = fixture();
  const color = input.content.document.colors.find(row => row.key === 'tint');
  for (let i = 0; i < 200; i++) color.swatches.push({ key: `shade-${i}`, label: 'x'.repeat(120), rgba: '#ff0000ff', stops: [] });
  const result = await compile(input);
  const plan = await planMakerV8PackDefinitionRegistrationV8(result, options());
  const nested = plan.steps.filter(step => step.stage.startsWith('COLOR_'));
  assert.equal(nested[0].stage, 'COLOR_BEGIN'); assert.equal(nested.at(-1).stage, 'COLOR_FINISH');
  assert.ok(nested.filter(step => step.stage === 'COLOR_APPEND').length >= 2);
  let swatches = [], nextChunk = 0;
  for (let ordinal = 0; ordinal < plan.steps.length; ordinal++) {
    const step = plan.steps[ordinal];
    if (!['BEGIN', 'FINALIZE'].includes(step.stage)) assert.equal(step.chunkIndex, nextChunk++);
    const built = await buildMakerV8PackDefinitionStepV8(result, plan, ordinal, options());
    const data = built.transaction.getData();
    assert.ok(data.commands.length <= MAKER_V8_TRANSACTION_LIMITS.maxCommands);
    assert.ok(data.inputs.length <= MAKER_V8_TRANSACTION_LIMITS.maxInputs);
    assert.ok(data.inputs.every(input => !input.Pure || fromBase64(input.Pure.bytes).length <= MAKER_V8_TRANSACTION_LIMITS.maxPureArgumentBytes));
    assert.ok(fromBase64(built.kindBytesBase64).length <= MAKER_V8_TRANSACTION_LIMITS.maxKindBytes);
    if (step.stage === 'COLOR_APPEND') {
      assert.equal(step.swatchStart, swatches.length); assert.equal(step.start, step.end);
      const call = data.commands.find(command => command.MoveCall?.function === 'new_color_swatches_v2').MoveCall;
      swatches.push(...bcs.vector(bcs.string()).parse(fromBase64(data.inputs[call.arguments[0].Input].Pure.bytes)));
    }
  }
  assert.equal(nested.at(-1).end, nested[0].start + 1);
  assert.equal(plan.steps.at(-1).chunkIndex, nextChunk);
  assert.deepEqual(swatches, result.rows.colors[0].swatches.map(row => row.key));
  assert.deepEqual(await planMakerV8PackDefinitionRegistrationV8(result, options()), plan);
});

test('registration requires exact sealed-parent registry input without unresolved object lookup', async () => {
  const result = await compile(fixture());
  for (const baseRegistryRef of [undefined, { objectId: id(0), initialSharedVersion: '1' },
    { objectId: id(7), initialSharedVersion: '0' }, { objectId: id(7), initialSharedVersion: 9 },
    { objectId: id(7), initialSharedVersion: '18446744073709551616' }]) {
    await assert.rejects(buildMakerV8PackDefinitionRegistrationV8(result, { ...options(), baseRegistryRef }),
      /Exact (nonzero object|Base registry)/);
  }
});

test('unfinished empty Item is rejected before building publication rows', async () => {
  const input = fixture(false), part = input.content.document.parts[0];
  part.items.push({ ...structuredClone(part.items[0]), key: 'empty-item', styles: [], defaultStyleKey: null });
  input.content.document.rules.push({ key: 'empty-item-rule', kind: 'REQUIRE', trigger: {
    source: 'BASE', sourceKey: null, partKey: part.key, itemKey: 'empty-item', styleKey: null },
    targetMode: 'ALL', targets: [{ source: 'BASE', sourceKey: null,
      partKey: part.key, itemKey: null, styleKey: null }], payload: {} });
  await assert.rejects(compile(input), error => error.code === 'MAKER_V8_DEFAULT_STYLE_UNKNOWN');
});
