import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { compileMakerV8BaseRowsV2, compileMakerV8CoreDefinitionRowsV2, buildMakerV8CoreRowCommandsV2, appendMakerV8BaseRowCommandsV2, MAKER_V8_BASE_ROW_BCS_V2, MAKER_V8_BASE_CATEGORIES_V2 } from '../maker-v8-base-rows.js';

test('shared Core definitions preserve Base bytes and bind Pack Part visibility to its semantic source', async () => {
  const { document, assets } = fixture();
  const before = structuredClone(document);
  const base = await compileMakerV8BaseRowsV2(document, assets);
  const definitions = await compileMakerV8CoreDefinitionRowsV2(document);
  assert.deepEqual(Object.keys(definitions), ['track', 'color', 'part']);
  for (const kind of Object.keys(definitions)) assert.deepEqual(definitions[kind], base.rows[kind]);
  const pack = await compileMakerV8CoreDefinitionRowsV2(document, { definitionSource: 2, definitionSourceKey: 'own-pack' });
  assert.deepEqual(pack.track, definitions.track);
  assert.deepEqual(pack.color, definitions.color);
  const expected = createHash('sha256').update(join(string('animacraft-fresh-v8/core/visibility-program/v1'), n(1), n(2, 1), option('own-pack'), n(0, 1), string(pack.part[0].key), option(null), option(null), n(0, 1))).digest();
  assert.deepEqual(Buffer.from(pack.part[0].visibility_commitment), expected);
  assert.deepEqual({ ...pack.part[0], visibility_commitment: definitions.part[0].visibility_commitment }, definitions.part[0]);
  assert.deepEqual(document, before);
  for (const options of [{ definitionSource: 0 }, { definitionSource: 1, definitionSourceKey: 'pack' },
    { definitionSource: 2 }, { definitionSource: 2, definitionSourceKey: '' },
    { definitionSource: 2, definitionSourceKey: 'unsafe/key' }, { definitionSource: 2, definitionSourceKey: `0x${'ab'.repeat(32)}` }]) {
    await assert.rejects(compileMakerV8CoreDefinitionRowsV2(document, options), { code: 'MAKER_V8_DEFINITION_SOURCE_INVALID' });
  }
  const invalid = structuredClone(document); invalid.parts[0].capacity = -1;
  await assert.rejects(compileMakerV8CoreDefinitionRowsV2(invalid));
});

test('Core definition constructor returns a Move value without appending registry state', async () => {
  const { document } = fixture();
  const definitions = await compileMakerV8CoreDefinitionRowsV2(document);
  for (const [kind, rows] of Object.entries(definitions)) {
    const tx = new Transaction();
    const result = buildMakerV8CoreRowCommandsV2(tx, { corePackageId: '0xc0', coreOriginalPackageId: '0xc1', kind, row: rows[0] });
    const commands = tx.getData().commands;
    assert.equal(result.Result, commands.length - 1);
    assert.equal(commands.at(-1).MoveCall.function, `new_${kind === 'color' ? 'color_channel' : kind}_row_v2`);
    assert.ok(!commands.some(command => command.MoveCall?.function.startsWith('append_')));
    assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0);
  }
});

function fixture() {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.tracks.push({ key: 'over', label: 'Over', renderOrder: 3, locked: false });
  document.colors = [{ key: 'skin', label: 'Skin', defaultSwatchKey: 'z', swatches: [
    { key: 'z', label: 'Default', rgba: '#112233ff', stops: [] },
    { key: 'a', label: 'Gradient', rgba: '#abcdef80', stops: [{ offset: 0, rgba: '#00000000' }, { offset: 0.123456, rgba: '#ffeeddcc' }, { offset: 1, rgba: '#ffffffff' }] },
  ] }];
  const style = document.parts[0].items[0].styles[0];
  Object.assign(style, { colorChannelKey: 'skin', defaultSwatchKey: 'a', transform: { x: -12.345, y: -0, scale: 1.234567, rotation: 5.678 }, opacity: 0.987654, blendMode: 'overlay', physical: { material: 'print', issuance: 'PROOF_MATERIALIZE', proof: 'CANONICAL_SOUL', priceAtomic: '0', maxSupply: '9', transferable: false } });
  const protectedStyle = { ...structuredClone(style), key: 'protected', displayOrder: 2, trackKey: 'over', assetId: 'secret', protected: true, physical: null };
  document.parts[0].items[0].styles.push(protectedStyle);
  document.assets.push({ id: 'secret', kind: 'layer', mediaType: 'image/png', byteLength: 2 });
  document.parts[0].items.push({ key: 'private', label: 'Private', status: 'PRIVATE', displayOrder: 1, defaultStyleKey: 'private', payload: {}, styles: [{ ...structuredClone(style), key: 'private', assetId: 'private' }] });
  document.assets.push({ id: 'private', kind: 'layer', mediaType: 'image/png', byteLength: 3 });
  return { document, assets: {
    'base-default': { blobId: 'real-public-blob', byteLength: 1, mediaType: 'image/png', sha256: 'ab'.repeat(32) },
    secret: { blobId: 'real-ciphertext-blob', byteLength: 50, mediaType: 'application/vnd.animacraft.seal-ciphertext', sha256: 'cd'.repeat(32) },
  } };
}
const join = (...values) => Buffer.concat(values);

test('all original blend names compile to exact u8 codes shared with the Move constants', async () => {
  const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity', 'linear-dodge'];
  const move = await readFile(new URL('../move/animacraft_v8_core/sources/base_registry_v8.move', import.meta.url), 'utf8');
  for (const [code, mode] of modes.entries()) {
    const { document, assets } = fixture();
    document.parts[0].items[0].styles[0].blendMode = mode;
    const { rows } = await compileMakerV8BaseRowsV2(document, assets);
    assert.equal(rows.style[0].blend_mode, code, mode);
    const encoded = MAKER_V8_BASE_ROW_BCS_V2.style.serialize(rows.style[0]).toBytes();
    assert.equal(MAKER_V8_BASE_ROW_BCS_V2.style.parse(encoded).blend_mode, code);
    assert.deepEqual(Buffer.from(encoded), independent.style(rows.style[0]));
    assert.match(move, new RegExp(`const BLEND_${mode.replaceAll('-', '_').toUpperCase()}: u8 = ${code};`));
  }
  const { document, assets } = fixture();
  document.parts[0].items[0].styles[0].blendMode = 'unknown';
  await assert.rejects(compileMakerV8BaseRowsV2(document, assets));
});

test('an optional empty wardrobe slot compiles its real Part with no fabricated track or Item', async () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.parts[0].kind = 'STANDARD';
  document.parts[0].required = false;
  document.parts[0].items = [];
  document.defaultRecipe.selections = [];
  const { rows } = await compileMakerV8BaseRowsV2(document, {});
  assert.equal(rows.part.length, 1);
  assert.deepEqual(rows.part[0].track_keys, []);
  assert.equal(rows.item.length, 0);
  assert.equal(rows.style.length, 0);
  assert.equal(rows.asset.length, 0);
});
const n = (value, size = 8) => { const result = Buffer.alloc(size); let v = BigInt(value); for (let i = 0; i < size; i++) { result[i] = Number(v & 255n); v >>= 8n; } return result; };
const len = value => { const result = []; do { result.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value); return Buffer.from(result); };
const vector = (values, encode = value => n(value, 1)) => join(len(values.length), ...values.map(encode));
const string = value => { const b = Buffer.from(value); return join(len(b.length), b); };
const bool = value => n(value ? 1 : 0, 1);
const option = (value, encode = string) => value === null ? n(0, 1) : join(n(1, 1), encode(value));
const signed = value => join(bool(value.negative), n(value.magnitude));
const physical = value => join(string(value.material), n(value.issuance, 1), n(value.proof, 1), n(value.price_atomic), n(value.max_supply), bool(value.transferable));
const selectorBytes = s => join(n(s.source, 1), option(s.source_key), string(s.part_key), option(s.item_key), option(s.style_key));
const visibilityBytes = t => join(n(t.opcode, 1), option(t.selector, selectorBytes), n(t.arity, 2));
const tail = row => join(vector(row.visibility_tokens, visibilityBytes), vector(row.visibility_commitment), vector(row.payload_commitment));
const independent = {
  track: r => join(n(r.sequence), string(r.key), string(r.label), n(r.render_order), bool(r.locked)),
  color: r => join(n(r.sequence), string(r.key), string(r.label), string(r.default_swatch_key), vector(r.swatches, s => join(string(s.key), string(s.label), n(s.rgba, 4), vector(s.stops, stop => join(n(stop.offset_ppm), n(stop.rgba, 4)))))),
  part: r => join(n(r.sequence), string(r.key), string(r.label), n(r.kind, 1), n(r.render_order), n(r.menu_order), bool(r.visible), bool(r.required), n(r.slot_mode, 1), n(r.capacity), vector(r.track_keys, string), tail(r)),
  item: r => join(n(r.sequence), string(r.part_key), string(r.item_key), string(r.label), n(r.status, 1), n(r.display_order), string(r.default_style_key), tail(r)),
  style: r => join(n(r.sequence), string(r.part_key), string(r.item_key), string(r.style_key), string(r.label), n(r.display_order), string(r.track_key), option(r.color_channel_key), option(r.default_swatch_key), string(r.asset_id), string(r.asset_blob_id), vector(r.asset_sha256), bool(r.protected), signed(r.transform.x_milli), signed(r.transform.y_milli), n(r.transform.scale_ppm), signed(r.transform.rotation_millidegrees), n(r.opacity_ppm), n(r.blend_mode, 1), option(r.physical, physical), tail(r)),
  asset: r => join(n(r.sequence), string(r.asset_id), string(r.kind), string(r.media_type), n(r.byte_length), vector(r.sha256)),
};

test('fixed-slot mode preserves its independently authored capacity', async () => {
  const { document, assets } = fixture();
  document.parts[0].wardrobeMode = 'FIXED';
  document.parts[0].capacity = 2;
  const { rows } = await compileMakerV8BaseRowsV2(document, assets);
  assert.equal(rows.part[0].capacity, 2n);
  assert.equal(rows.part[0].slot_mode, 0);
});

test('six current Base layouts match independently encoded complete BCS fields', async () => {
  const { document, assets } = fixture();
  const { rows, counts, total } = await compileMakerV8BaseRowsV2(document, assets);
  assert.deepEqual(MAKER_V8_BASE_CATEGORIES_V2, { track: 0, color: 1, part: 2, item: 3, style: 4, rule: 5, asset: 6 });
  assert.deepEqual(counts, { tracks: 2n, colors: 1n, parts: 1n, items: 1n, styles: 2n, assets: 2n });
  assert.equal(total, 9n);
  for (const [kind, values] of Object.entries(rows)) {
    for (const [index, row] of values.entries()) {
      assert.equal(row.sequence, BigInt(index));
      assert.deepEqual(Buffer.from(MAKER_V8_BASE_ROW_BCS_V2[kind].serialize(row).toBytes()), independent[kind](row), kind);
    }
  }
  assert.deepEqual(rows.part[0].track_keys, ['base-track', 'over']);
  assert.equal(rows.item[0].status, 0);
  assert.equal(rows.color[0].default_swatch_key, 'z');
  assert.deepEqual(rows.color[0].swatches.map(s => s.key), ['a', 'z']);
  assert.equal(rows.color[0].swatches[0].stops[1].offset_ppm, 123456n);
  assert.deepEqual(rows.style[0].transform.x_milli, { negative: true, magnitude: 12345n });
  assert.deepEqual(rows.style[0].transform.y_milli, { negative: false, magnitude: 0n });
  assert.equal(rows.style[0].physical.proof, 1, 'Core canonical-Soul enum is one, not Physical package enum two');
  assert.equal(rows.asset[1].byte_length, 50n, 'protected asset metadata binds actual ciphertext, not claimed plaintext');
  assert.equal(rows.asset[1].media_type, assets.secret.mediaType);
  assert.ok(!rows.asset.some(r => r.asset_id === 'private'));
});

test('visibility identities and existing downstream payload hashes bind exact author semantics', async () => {
  const { document, assets } = fixture();
  const { rows } = await compileMakerV8BaseRowsV2(document, assets);
  const row = rows.style[0];
  const expected = createHash('sha256').update(join(string('animacraft-fresh-v8/core/visibility-program/v1'), n(1), n(1, 1), n(0, 1), n(2, 1), string('base'), option('default'), option('default'), n(0, 1))).digest();
  assert.deepEqual(Buffer.from(row.visibility_commitment), expected);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const s = document.parts[0].items[0].styles[0];
  const expectedPayload = createHash('sha256').update(JSON.stringify(canonical({ schemaVersion: 'animacraft.maker-v8-style-payload.v2', assetId: s.assetId, assetKind: 'layer', transform: s.transform, opacity: s.opacity, blendMode: s.blendMode, physical: s.physical, payload: s.payload }))).digest('hex');
  assert.equal(row.source.payload, expectedPayload);
  assert.equal(Buffer.from(row.payload_commitment).toString('hex'), expectedPayload);
  assert.notDeepEqual(rows.part[0].visibility_commitment, rows.item[0].visibility_commitment);
  assert.notDeepEqual(rows.style[0].visibility_commitment, rows.style[1].visibility_commitment);
});

test('Style visibility compiles postfix tokens, exact BCS and subject-bound commitments', async () => {
  const { document, assets } = fixture();
  const target = structuredClone(document.parts[0]);
  Object.assign(target, { key: 'target', kind: 'STANDARD', menuOrder: 1, renderOrder: 1 });
  target.items = [target.items[0]]; target.items[0].styles = [target.items[0].styles[0]];
  document.parts.push(target);
  document.defaultRecipe.selections.push({ partKey: 'target', itemKey: 'default', styleKey: 'default' });
  const leaf = (source, sourceKey = null) => ({ op: 'selected', source, sourceKey, partKey: 'target', itemKey: 'default', styleKey: 'default' });
  const condition = { op: 'all', conditions: [leaf('BASE'), { op: 'not', condition: leaf('PACK', 'pack-a') }, { op: 'any', conditions: [leaf('ANY'), leaf('EXTERNAL', `0x${'ab'.repeat(32)}`)] }] };
  document.parts[0].items[0].styles.forEach(style => { style.visibleWhen = structuredClone(condition); });
  const before = structuredClone(document);
  const { rows } = await compileMakerV8BaseRowsV2(document, assets);
  const selected = (source, source_key = null) => ({ opcode: 0, selector: { source, source_key, part_key: 'target', item_key: 'default', style_key: 'default' }, arity: 0 });
  const expectedTokens = [selected(1), selected(2, 'pack-a'), { opcode: 1, selector: null, arity: 1 }, selected(0), selected(3, `0x${'ab'.repeat(32)}`), { opcode: 3, selector: null, arity: 2 }, { opcode: 2, selector: null, arity: 3 }];
  assert.deepEqual(rows.style[0].visibility_tokens, expectedTokens);
  assert.deepEqual(rows.part[0].visibility_tokens, []);
  assert.deepEqual(rows.item[0].visibility_tokens, []);
  for (const row of rows.style.filter(row => row.part_key === 'base')) {
    assert.deepEqual(Buffer.from(MAKER_V8_BASE_ROW_BCS_V2.style.serialize(row).toBytes()), independent.style(row));
    const expected = createHash('sha256').update(join(string('animacraft-fresh-v8/core/visibility-program/v1'), n(1), n(1, 1), option(null), n(2, 1), string(row.part_key), option(row.item_key), option(row.style_key), vector(expectedTokens, visibilityBytes))).digest();
    assert.deepEqual(Buffer.from(row.visibility_commitment), expected);
  }
  assert.notDeepEqual(rows.style[0].visibility_commitment, rows.style[1].visibility_commitment);
  assert.deepEqual(document, before);
});

test('visibility PTB passes bounded primitive columns to one actual Move program constructor', async () => {
  const { document, assets } = fixture();
  const { rows } = await compileMakerV8BaseRowsV2(document, assets);
  const row = rows.style[0];
  const selectors = Array.from({ length: 32 }, (_, i) => ({ source: i % 4,
    source_key: i % 4 < 2 ? null : i % 4 === 2 ? `pack-${i}`.padEnd(128, 'x') : `0x${i.toString(16).padStart(64, '0')}`,
    part_key: `part-${i}`.padEnd(128, 'p'), item_key: `item-${i}`.padEnd(128, 'i'), style_key: i % 2 ? null : `style-${i}`.padEnd(128, 's') }));
  row.visibility_tokens = selectors.flatMap(selector => [{ opcode: 0, selector, arity: 0 }, ...Array.from({ length: 6 }, () => ({ opcode: 1, selector: null, arity: 1 }))]);
  row.visibility_tokens.push({ opcode: 3, selector: null, arity: 32 });
  const tx = new Transaction();
  const refs = ['0x11', '0x12', '0x13'].map(objectId => tx.objectRef({ objectId, version: '1', digest: '11111111111111111111111111111111' }));
  appendMakerV8BaseRowCommandsV2(tx, { corePackageId: '0xc0', coreOriginalPackageId: '0xc1', paymentCoinType: '0x2::sui::SUI', registry: refs[0], root: refs[1], admin: refs[2], kind: 'style', row });
  const commands = tx.getData().commands;
  const programs = commands.filter(c => c.MoveCall?.function === 'new_visibility_program_v1').map(c => c.MoveCall);
  assert.equal(programs.length, 1);
  assert.equal(commands.filter(c => ['new_semantic_selector_v2', 'new_visibility_token_v1'].includes(c.MoveCall?.function)).length, 0);
  const inputs = tx.getData().inputs;
  const schemas = [bcs.vector(bcs.u8()), bcs.vector(bcs.u16()), bcs.vector(bcs.u8()), bcs.vector(bcs.option(bcs.string())), bcs.vector(bcs.string()), bcs.vector(bcs.option(bcs.string())), bcs.vector(bcs.option(bcs.string()))];
  const expected = [row.visibility_tokens.map(t => t.opcode), row.visibility_tokens.map(t => t.arity), ...['source', 'source_key', 'part_key', 'item_key', 'style_key'].map(key => selectors.map(s => s[key]))];
  assert.equal(programs[0].arguments.length, schemas.length);
  schemas.forEach((schema, index) => {
    const bytes = Buffer.from(inputs[programs[0].arguments[index].Input].Pure.bytes, 'base64');
    assert.deepEqual(schema.parse(bytes), expected[index]);
    assert.ok(bytes.length <= 16384);
  });
  const style = commands.find(c => c.MoveCall?.function === 'new_style_row_v2').MoveCall;
  assert.equal(commands[style.arguments[17].Result].MoveCall.function, 'new_visibility_program_v1');
  assert.ok(commands.length <= 64);
  assert.ok(inputs.length <= 256);
  assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0);
});

test('actual SDK emits nested constructors, exact original types and current append ABIs', async () => {
  const { document, assets } = fixture();
  const { rows } = await compileMakerV8BaseRowsV2(document, assets);
  for (const [kind, values] of Object.entries(rows)) for (const row of values) {
    const tx = new Transaction();
    const refs = ['0x11', '0x12', '0x13'].map(objectId => tx.objectRef({ objectId, version: '1', digest: '11111111111111111111111111111111' }));
    appendMakerV8BaseRowCommandsV2(tx, { corePackageId: '0xc0', coreOriginalPackageId: '0xc1', paymentCoinType: '0x2::sui::SUI', registry: refs[0], root: refs[1], admin: refs[2], kind, row });
    const commands = tx.getData().commands;
    const append = commands.at(-1).MoveCall;
    assert.equal(append.function, `append_${kind}_v2`);
    assert.equal(append.arguments.length, 4);
    assert.deepEqual(append.typeArguments, ['0x2::sui::SUI']);
    assert.equal(append.arguments[3].Result, commands.length - 2);
    const constructor = commands.at(-2).MoveCall;
    assert.equal(constructor.function, `new_${kind === 'color' ? 'color_channel' : kind}_row_v2`);
    assert.equal(constructor.arguments.length, { track: 5, color: 5, part: 14, item: 10, style: 20, asset: 6 }[kind]);
    assert.ok(commands.filter(c => c.MakeMoveVec).every(c => c.MakeMoveVec.type.startsWith(`0x${'c1'.padStart(64, '0')}::base_registry_v8::`)));
    if (kind === 'style') {
      assert.equal(commands.filter(c => c.MoveCall?.function === 'new_signed_milli_v1').length, 3);
      const opt = commands.find(c => ['none', 'some'].includes(c.MoveCall?.function)).MoveCall;
      assert.equal(opt.function, row.physical === null ? 'none' : 'some');
      assert.deepEqual(opt.typeArguments, [`0x${'c1'.padStart(64, '0')}::base_registry_v8::PhysicalPolicyV1`]);
    }
    assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0);
  }
});

test('schema fields and argument counts stay anchored to actual Move declarations', async () => {
  const move = await readFile(new URL('../move/animacraft_v8_core/sources/base_registry_v8.move', import.meta.url), 'utf8');
  for (const [kind, schema] of Object.entries(MAKER_V8_BASE_ROW_BCS_V2)) {
    const name = schema.name;
    const body = move.match(new RegExp(`public struct ${name} has[^\\{]+\\{([\\s\\S]*?)\\n\\}`))[1];
    const fields = [...body.matchAll(/^\s+(\w+):/gm)].map(match => match[1]);
    const fn = `new_${kind === 'color' ? 'color_channel' : kind}_row_v2`;
    const constructor = move.match(new RegExp(`public fun ${fn}\\(([\\s\\S]*?)\\): ${name}`))[1];
    assert.deepEqual([...constructor.matchAll(/^\s+(\w+):/gm)].map(match => match[1]), fields);
    assert.match(move, new RegExp(`public fun append_${kind}_v2<PaymentCoin>\\([\\s\\S]*?row: ${name},\\n\\)`));
  }
});

test('missing certified assets and protected/public transport disagreement reject', async () => {
  const { document, assets } = fixture();
  await assert.rejects(compileMakerV8BaseRowsV2(document, {}), { code: 'MAKER_V8_CERTIFIED_ASSET_MISSING' });
  for (const mutate of [a => { a['base-default'].byteLength = 2; }, a => { a.secret.mediaType = 'image/png'; }]) {
    const changed = structuredClone(assets); mutate(changed);
    await assert.rejects(compileMakerV8BaseRowsV2(document, changed), { code: 'MAKER_V8_CERTIFIED_ASSET_METADATA_MISMATCH' });
  }
  const changed = structuredClone(assets); changed.secret.sha256 = '11';
  await assert.rejects(compileMakerV8BaseRowsV2(document, changed), { code: 'MAKER_V8_BASE_ASSET_HASH_INVALID' });
});

test('current contract precision rejects without silently changing authored values', async () => {
  const { document, assets } = fixture();
  document.parts[0].items[0].styles[0].transform.x = 0.0001;
  await assert.rejects(compileMakerV8BaseRowsV2(document, assets), { code: 'MAKER_V8_BASE_FIXED_PRECISION_UNSUPPORTED' });
});

test('gradient BCS uses stable renderer ordering without merging duplicates or mutating author data', async () => {
  const { document, assets } = fixture();
  document.colors[0].swatches[1].stops = [
    { offset: 1, rgba: '#ffffffff' }, { offset: 0.5, rgba: '#ff0000ff' },
    { offset: 0, rgba: '#000000ff' }, { offset: 0.5, rgba: '#0000ffff' },
  ];
  const before = structuredClone(document);
  const { rows } = await compileMakerV8BaseRowsV2(document, assets);
  assert.deepEqual(rows.color[0].swatches[0].stops, [
    { offset_ppm: 0n, rgba: 0x000000ff }, { offset_ppm: 500000n, rgba: 0xff0000ff },
    { offset_ppm: 500000n, rgba: 0x0000ffff }, { offset_ppm: 1000000n, rgba: 0xffffffff },
  ]);
  assert.deepEqual(Buffer.from(MAKER_V8_BASE_ROW_BCS_V2.color.serialize(rows.color[0]).toBytes()), independent.color(rows.color[0]));
  assert.deepEqual(document, before);
  document.colors[0].swatches[1].stops[0].offset = 0.0000001;
  await assert.rejects(compileMakerV8BaseRowsV2(document, assets), { code: 'MAKER_V8_BASE_FIXED_PRECISION_UNSUPPORTED' });
});
