import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { packDefinitionCommitmentV8 } from './maker-v8-pack-definition-wire.js';
export { MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2, MAKER_V8_PACK_DEFINITION_ROWS_BCS } from './maker-v8-pack-definition-wire.js';
import { assertPublicPackAuthoringContent } from './maker-v8-pack-authoring.js';
import { compileMakerV8CoreDefinitionRowsV2, buildMakerV8CoreRowCommandsV2,
  compileMakerV8VisibilityV1, buildMakerV8VisibilityProgramCommandsV1 } from './maker-v8-base-rows.js';
import { compileMakerV8RuleRows, buildMakerV8RuleRowCommands,
  MAKER_V8_TRANSACTION_LIMITS } from './maker-v8-compiler.js';
const compiled = new WeakSet();
const plans = new WeakMap();
const categories = ['tracks', 'colors', 'parts', 'rules', 'visibility'];
const hex = value => [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
function fail(message) { throw Object.assign(new Error(message), { code: 'MAKER_V8_PACK_DEFINITIONS_INVALID' }); }
function exactId(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) fail('Exact nonzero object/package ID required.');
  return value;
}
function hash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) fail('Exact nonzero content hash required.');
  return [...value.match(/../g)].map(byte => parseInt(byte, 16));
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Offline definition projection, NOT release authorization. Parent certification
 * remains the caller's responsibility; existing full-publication guards remain. */
export async function compileMakerV8PackDefinitionRowsV8(authoring, { expectedParent, semanticPackId } = {}) {
  if (typeof semanticPackId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(semanticPackId)) fail('Invalid semantic Pack ID.');
  const checked = assertPublicPackAuthoringContent(authoring, { expectedParent });
  const projected = await compileMakerV8CoreDefinitionRowsV2(checked.content.document,
    { definitionSource: 2, definitionSourceKey: semanticPackId });
  const own = (kind, key) => new Set(checked.definitions[kind].map(row => row[key]));
  const select = (rows, keys) => rows.filter(row => keys.has(row.key))
    .map((row, index) => ({ ...row, sequence: BigInt(index) }));
  const rules = await compileMakerV8RuleRows(checked.definitions.rules);
  const visibility = [], itemKeys = new Set();
  for (const style of checked.content.styles) {
    const part = checked.content.document.parts.find(part => part.key === style.partKey);
    const item = part.items.find(item => item.key === style.itemKey);
    const authored = item.styles.find(row => row.key === style.styleKey);
    const itemKey = `${style.partKey}/${style.itemKey}`;
    if (!itemKeys.has(itemKey)) {
      itemKeys.add(itemKey);
      const inherited = checked.content.parent.document.parts.find(part => part.key === style.partKey)
        ?.items.some(item => item.key === style.itemKey);
      const source = inherited ? 1 : 2;
      visibility.push({ subject: 1, definition_source: source, part_key: style.partKey, item_key: style.itemKey,
        style_key: null, ...await compileMakerV8VisibilityV1(1, style.partKey, style.itemKey, null, null,
          source, inherited ? null : semanticPackId) });
    }
    visibility.push({ subject: 2, definition_source: 2, part_key: style.partKey, item_key: style.itemKey,
      style_key: style.styleKey, ...await compileMakerV8VisibilityV1(2, style.partKey, style.itemKey,
        style.styleKey, authored.visibleWhen, 2, semanticPackId) });
  }
  const partRows = select(projected.part, own('parts', 'key'));
  const result = freeze({ authoringCommitment: checked.commitment,
    // Retain the validated per-namespace references for product consumers.
    // These are derived metadata, not additional on-chain commitment bytes.
    styleReferences: checked.definitions.styles,
    ownedParts: partRows.map(row => checked.definitions.parts.find(part => part.key === row.key)),
    rules: checked.definitions.rules,
    rows: { semantic_pack_id: semanticPackId,
      tracks: select(projected.track, own('tracks', 'key')),
      colors: select(projected.color, own('colors', 'key')),
      parts: partRows,
      // Preserve declared selectors for the Runtime's scoped reference resolver.
      rules: rules.map(entry => entry.row),
      visibility,
    } });
  compiled.add(result);
  return result;
}

/** Constructs a real unsigned registration PTB for the shared draft Release.
 * Publication recovery uses the same row builders below. Authored signing and
 * upload remain gated pending full publication and consumer acceptance. */
function registrationContext(value, options) {
  if (!compiled.has(value)) fail('Compiler-produced immutable definition input required.');
  const { corePackageId, coreOriginalPackageId, runtimePackageId, paymentCoinType,
    releaseRef, adminCapRef, baseRegistryRef, signer, releaseContentCommitment } = structuredClone(options);
  [corePackageId, coreOriginalPackageId, runtimePackageId, signer, releaseRef?.objectId,
    adminCapRef?.objectId, baseRegistryRef?.objectId].forEach(exactId);
  for (const [label, ref] of [['Release', releaseRef], ['Base registry', baseRegistryRef]]) {
    if (typeof ref.initialSharedVersion !== 'string'
      || !/^[1-9][0-9]*$/.test(ref.initialSharedVersion)
      || BigInt(ref.initialSharedVersion) > 18446744073709551615n) {
      fail(`Exact ${label} initial shared version required.`);
    }
  }
  const commitment = packDefinitionCommitmentV8(releaseRef.objectId, hash(releaseContentCommitment), value.rows);
  return { corePackageId, coreOriginalPackageId, runtimePackageId, paymentCoinType,
    releaseRef, adminCapRef, baseRegistryRef, signer, releaseContentCommitment, commitment };
}

function colorSwatches(transaction, corePackageId, swatches) {
  return transaction.moveCall({ target: `${corePackageId}::base_registry_v8::new_color_swatches_v2`, arguments: [
    transaction.pure.vector('string', swatches.map(swatch => swatch.key)),
    transaction.pure.vector('string', swatches.map(swatch => swatch.label)),
    transaction.pure.vector('u32', swatches.map(swatch => swatch.rgba)),
    transaction.pure(bcs.vector(bcs.vector(bcs.u64())).serialize(swatches.map(swatch => swatch.stops.map(stop => stop.offset_ppm)))),
    transaction.pure(bcs.vector(bcs.vector(bcs.u32())).serialize(swatches.map(swatch => swatch.stops.map(stop => stop.rgba)))),
  ] });
}

function definitionVectors(transaction, rows, core) {
  const { corePackageId, coreOriginalPackageId } = core;
  const elements = {};
  for (const [plural, kind] of [['tracks', 'track'], ['parts', 'part']]) {
    elements[plural] = rows[plural].map(row => buildMakerV8CoreRowCommandsV2(transaction, { ...core, kind, row }));
  }
  elements.colors = rows.colors.map(row => {
    const swatches = colorSwatches(transaction, corePackageId, row.swatches);
    return transaction.moveCall({ target: `${corePackageId}::base_registry_v8::new_color_channel_row_v2`, arguments: [
      transaction.pure.u64(row.sequence), transaction.pure.string(row.key), transaction.pure.string(row.label),
      transaction.pure.string(row.default_swatch_key), swatches,
    ] });
  });
  elements.rules = rows.rules.map(row => buildMakerV8RuleRowCommands(transaction, { ...core, row }));
  elements.visibility = rows.visibility.map(row => {
    const program = buildMakerV8VisibilityProgramCommandsV1(transaction, { corePackageId, tokens: row.visibility_tokens });
    return transaction.moveCall({ target: `${corePackageId}::base_registry_v8::new_pack_visibility_row_v2`, arguments: [
      transaction.pure.u8(row.subject), transaction.pure.u8(row.definition_source),
      transaction.pure.string(row.part_key), transaction.pure.string(row.item_key),
      transaction.pure.option('string', row.style_key), program, transaction.pure.vector('u8', row.visibility_commitment),
    ] });
  });
  const vector = (name, rows) => transaction.makeMoveVec({ type: `${coreOriginalPackageId}::base_registry_v8::${name}`, elements: rows });
  return [vector('TrackRowV2', elements.tracks), vector('ColorChannelRowV2', elements.colors),
    vector('PartRowV2', elements.parts), vector('RuleRowV2', elements.rules), vector('PackVisibilityRowV2', elements.visibility)];
}

async function checkedKind(transaction) {
  const data = transaction.getData(), limits = MAKER_V8_TRANSACTION_LIMITS;
  if (data.commands.length > limits.maxCommands || data.inputs.length > limits.maxInputs
    || data.inputs.some(input => input.Pure && fromBase64(input.Pure.bytes).length > limits.maxPureArgumentBytes)) return null;
  const kind = await transaction.build({ onlyTransactionKind: true });
  return kind.length <= limits.maxKindBytes ? toBase64(kind) : null;
}

export async function buildMakerV8PackDefinitionRegistrationV8(value, options) {
  const context = registrationContext(value, options);
  const { corePackageId, runtimePackageId, paymentCoinType, releaseRef, adminCapRef, baseRegistryRef, signer, commitment } = context;
  const transaction = new Transaction(); transaction.setSender(signer);
  const vectors = definitionVectors(transaction, value.rows, context);
  const rows = transaction.moveCall({ target: `${corePackageId}::base_registry_v8::new_pack_definition_rows_v2`, arguments: [
    transaction.pure.string(value.rows.semantic_pack_id), ...vectors,
  ] });
  transaction.moveCall({ target: `${runtimePackageId}::runtime_v8::register_pack_definitions_v8`,
    typeArguments: [paymentCoinType], arguments: [transaction.sharedObjectRef({ objectId: releaseRef.objectId,
      initialSharedVersion: releaseRef.initialSharedVersion, mutable: true }), transaction.objectRef(adminCapRef),
      transaction.sharedObjectRef({ objectId: baseRegistryRef.objectId,
        initialSharedVersion: baseRegistryRef.initialSharedVersion, mutable: false }),
      rows, transaction.pure.vector('u8', [...commitment])] });
  const kindBytesBase64 = await checkedKind(transaction);
  if (kindBytesBase64 === null) fail('Definition registration exceeds one-transaction budget; chunked registration is required.');
  return { transaction, kindBytesBase64, definitionCommitment: hex(commitment) };
}

function binding(context) {
  return JSON.stringify([context.corePackageId, context.coreOriginalPackageId, context.runtimePackageId,
    context.paymentCoinType, context.signer, context.releaseRef.objectId, context.releaseRef.initialSharedVersion, context.adminCapRef.objectId,
    context.baseRegistryRef.objectId, context.baseRegistryRef.initialSharedVersion, context.releaseContentCommitment]);
}

function chunkTransaction(value, context, step) {
  const transaction = new Transaction(); transaction.setSender(context.signer);
  const common = [transaction.sharedObjectRef({ objectId: context.releaseRef.objectId,
    initialSharedVersion: context.releaseRef.initialSharedVersion, mutable: true }), transaction.objectRef(context.adminCapRef)];
  let fn, args;
  if (step.stage === 'BEGIN') {
    fn = 'begin_pack_definitions_v8'; args = [...common, transaction.pure.vector('u8', [...context.commitment])];
  } else if (step.stage.startsWith('COLOR_')) {
    const row = value.rows.colors[step.start - value.rows.tracks.length];
    const chunk = transaction.pure.u64(step.chunkIndex);
    if (step.stage === 'COLOR_BEGIN') {
      fn = 'begin_pack_color_v8'; args = [...common, chunk, transaction.pure.u64(row.sequence),
        transaction.pure.string(row.key), transaction.pure.string(row.label), transaction.pure.string(row.default_swatch_key),
        transaction.pure.u64(row.swatches.length)];
    } else if (step.stage === 'COLOR_APPEND') {
      fn = 'append_pack_color_v8'; args = [...common, chunk, transaction.pure.u64(step.swatchStart),
        colorSwatches(transaction, context.corePackageId, row.swatches.slice(step.swatchStart, step.swatchEnd))];
    } else {
      fn = 'finish_pack_color_v8'; args = [...common, chunk];
    }
  } else if (step.stage === 'APPEND') {
    const flat = categories.flatMap(kind => value.rows[kind].map(row => ({ kind, row })));
    const rows = Object.fromEntries(categories.map(kind => [kind, flat.slice(step.start, step.end)
      .filter(entry => entry.kind === kind).map(entry => entry.row)]));
    fn = 'append_pack_definitions_v8';
    args = [...common, transaction.pure.u64(step.chunkIndex), ...definitionVectors(transaction, rows, context)];
  } else {
    fn = 'finalize_pack_definitions_v8'; args = [...common,
      transaction.sharedObjectRef({ objectId: context.baseRegistryRef.objectId,
        initialSharedVersion: context.baseRegistryRef.initialSharedVersion, mutable: false }), transaction.pure.u64(step.chunkIndex)];
  }
  transaction.moveCall({ target: `${context.runtimePackageId}::runtime_v8::${fn}`, typeArguments: [context.paymentCoinType], arguments: args });
  return transaction;
}

/** Deterministic unsigned plan. Rebuild from certified source after recovery;
 * never interpret a caller-supplied serialized plan as authorization. */
export async function planMakerV8PackDefinitionRegistrationV8(value, options, { maxRowsPerChunk = MAKER_V8_TRANSACTION_LIMITS.maxRowsPerChunk } = {}) {
  const context = registrationContext(value, options);
  if (!Number.isSafeInteger(maxRowsPerChunk) || maxRowsPerChunk < 1
    || maxRowsPerChunk > MAKER_V8_TRANSACTION_LIMITS.maxRowsPerChunk) fail('Invalid definition chunk row limit.');
  const count = categories.reduce((sum, kind) => sum + value.rows[kind].length, 0);
  const steps = [{ stage: 'BEGIN', chunkIndex: 0, start: 0, end: 0 }];
  let start = 0, chunkIndex = 0;
  while (start < count) {
    let low = 1, high = Math.min(maxRowsPerChunk, count - start), fit = 0;
    while (low <= high) {
      const size = Math.floor((low + high) / 2);
      const transaction = chunkTransaction(value, context, { stage: 'APPEND', chunkIndex, start, end: start + size });
      if (await checkedKind(transaction) !== null) { fit = size; low = size + 1; } else high = size - 1;
    }
    if (fit === 0) {
      const row = value.rows.colors[start - value.rows.tracks.length];
      if (!row) fail(`Definition row ${start} exceeds one-transaction budget.`);
      steps.push({ stage: 'COLOR_BEGIN', chunkIndex: chunkIndex++, start, end: start, swatchStart: 0, swatchEnd: 0 });
      let swatchStart = 0;
      while (swatchStart < row.swatches.length) {
        let low = 1, high = row.swatches.length - swatchStart, fit = 0;
        while (low <= high) {
          const size = Math.floor((low + high) / 2);
          const step = { stage: 'COLOR_APPEND', chunkIndex, start, end: start, swatchStart, swatchEnd: swatchStart + size };
          if (await checkedKind(chunkTransaction(value, context, step)) !== null) { fit = size; low = size + 1; } else high = size - 1;
        }
        if (fit === 0) fail(`Color swatch ${swatchStart} exceeds one-transaction budget.`);
        steps.push({ stage: 'COLOR_APPEND', chunkIndex: chunkIndex++, start, end: start, swatchStart, swatchEnd: swatchStart + fit });
        swatchStart += fit;
      }
      steps.push({ stage: 'COLOR_FINISH', chunkIndex: chunkIndex++, start, end: start + 1,
        swatchStart: row.swatches.length, swatchEnd: row.swatches.length });
      start++;
      continue;
    }
    steps.push({ stage: 'APPEND', chunkIndex: chunkIndex++, start, end: start + fit }); start += fit;
  }
  steps.push({ stage: 'FINALIZE', chunkIndex, start: count, end: count });
  for (const step of steps.filter(step => step.stage !== 'APPEND' && step.stage !== 'COLOR_APPEND')) {
    if (await checkedKind(chunkTransaction(value, context, step)) === null) fail('Definition boundary step exceeds transaction budget.');
  }
  const plan = freeze({ definitionCommitment: hex(context.commitment), rowCount: count, steps });
  plans.set(plan, { value, binding: binding(context) });
  return plan;
}

export async function buildMakerV8PackDefinitionStepV8(value, plan, ordinal, options) {
  const context = registrationContext(value, options), proof = plans.get(plan);
  if (!proof || proof.value !== value || proof.binding !== binding(context)
    || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= plan.steps.length) fail('Definition plan or stage authority differs.');
  const transaction = chunkTransaction(value, context, plan.steps[ordinal]);
  const kindBytesBase64 = await checkedKind(transaction);
  if (kindBytesBase64 === null) fail('Definition step exceeds transaction budget.');
  return { transaction, kindBytesBase64, definitionCommitment: plan.definitionCommitment, step: plan.steps[ordinal] };
}
