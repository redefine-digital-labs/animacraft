import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MAKER_V8_COMMITMENT_FIXTURE_SCHEMA,
  MAKER_V8_COMPOSITION_BEHAVIORS,
  MAKER_V8_COMPOSITION_RULE_KINDS,
  MAKER_V8_COMPOSITION_SOURCES,
  MAKER_V8_PACK_ACCESS_KINDS,
  MAKER_V8_PHYSICAL_SOURCE_KINDS,
  MAKER_V8_ROOT_CATEGORIES,
  MakerV8CompilerError,
  advanceMakerV8CategoryCommitment,
  advanceMakerV8CompleteOutputCommitment,
  advanceMakerV8CompletePackPolicyCommitment,
  advanceMakerV8CompositionItemCommitment,
  advanceMakerV8CompositionRuleCommitment,
  advanceMakerV8CompositionSlotCommitment,
  advanceMakerV8PackReleaseCommitment,
  advanceMakerV8PackStyleCommitment,
  advanceMakerV8PhysicalCommitment,
  advanceMakerV8RequiredPackSelectionCommitment,
  advanceMakerV8SealCommitment,
  canonicalMakerV8Json,
  collectMakerV8CompilerIssues,
  compileMakerV8Publication,
  compileMakerV8RootCommitments,
  emptyMakerV8CategoryCommitment,
  emptyMakerV8CompleteCommitment,
  emptyMakerV8CompositionCommitment,
  emptyMakerV8PackRegistryCommitment,
  emptyMakerV8PackStyleCommitment,
  emptyMakerV8PhysicalCommitment,
  emptyMakerV8RequiredPackSelectionCommitment,
  emptyMakerV8SealCommitment,
  makerV8EconomicsCommitment,
  makerV8CompleteSealScope,
  makerV8MakerStyleSealScope,
  makerV8PackScopeKey,
  makerV8PackStyleSealScope,
  makerV8PayloadCommitment,
  makerV8RightsCommitment,
  makerV8SemanticCommitment,
  makerV8SoulCommitment,
  makerV8StyleAssetKey,
  makerV8VersionCommitment,
  planMakerV8PublicationCalls,
  serializeMakerV8CapabilityCommitments,
  serializeMakerV8Options,
  serializeMakerV8RootRow,
  serializeMakerV8RowCounts,
  verifyMakerV8Certification,
} from '../maker-v8-compiler.js';
import {
  collectMakerV8DocumentIssues,
  createMakerV8Document,
} from '../maker-v8-document.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/maker-v8-compiler-v1.json', import.meta.url),
  'utf8',
));
const digest = (nibble) => nibble.repeat(64);

function certification(bytes, sha256, blobId = 'walrus-asset') {
  return {
    certified: true,
    certificationVisible: true,
    blobId,
    bytes,
    sha256,
    byteLength: String(bytes.length / 2),
    mediaType: 'image/png',
  };
}

function fullRootInput() {
  const track = structuredClone(fixture.inputs.track);
  delete track.sequence;
  const style = structuredClone(fixture.inputs.style);
  delete style.sequence;
  const assetBlobId = style.assetBlobId;
  const assetSha256 = style.assetSha256;
  delete style.assetBlobId;
  delete style.assetSha256;
  style.assetCertification = certification(
    '89504e470d0a1a0a00ffe6b189',
    assetSha256,
    assetBlobId,
  );
  return {
    semanticProjection: structuredClone(fixture.inputs.semanticProjection),
    tracks: [track],
    parts: [{
      key: 'body',
      label: '身体',
      kind: 2,
      renderOrder: 7,
      required: true,
      visible: true,
      payloadProjection: {
        schemaVersion: 'animacraft.maker-v8-part-payload.v1',
        parentPartId: null,
        wardrobeMode: 'FIXED',
      },
    }],
    items: [{
      partKey: 'body',
      itemKey: 'base',
      label: '基础',
      gateKind: 1,
      payloadProjection: {
        schemaVersion: 'animacraft.maker-v8-item-payload.v1',
        requires: [],
        status: 'public',
      },
    }],
    styles: [style],
    colors: [{
      channelKey: '肤色',
      swatchKey: '暖',
      label: '暖色',
      rgba: 0x11223344,
      payloadProjection: {
        schemaVersion: 'animacraft.maker-v8-color-payload.v1',
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      },
    }],
    rules: [{
      key: 'rule-一',
      kind: 1,
      leftRef: 'body/base/默认',
      rightRef: 'body/base/alt',
      payloadProjection: {
        schemaVersion: 'animacraft.maker-v8-rule-payload.v1',
        nested: { any: ['甲', '乙'] },
      },
    }],
  };
}

function validCurrentDocument() {
  const document = structuredClone(createMakerV8Document({
    makerId: 'compiler-gap',
    name: 'Compiler Gap',
    commerce: { rightsOriginConfirmed: true },
  }));
  document.metadata.summary = 'Valid authoring document with intentionally incomplete publication semantics.';
  document.metadata.coverAssetId = 'cover';
  document.assets = [
    {
      id: 'cover', kind: 'maker-cover', mediaType: 'image/png', byteLength: 12,
    },
    {
      id: 'body-asset', kind: 'layer', mediaType: 'image/png', byteLength: 24,
    },
  ];
  document.layerTracks = [{
    id: 'base-track', name: 'Base', order: 0, locked: false, referenceAssetId: null,
  }];
  document.colorChannels = [];
  document.parts = [{
    id: 'body',
    name: 'Body',
    menuOrder: 0,
    menuVisible: true,
    required: true,
    wardrobeMode: 'FIXED',
    defaultItemId: 'base',
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items: [{
      id: 'base',
      name: 'Base',
      displayOrder: 0,
      importKey: 'base',
      status: 'public',
      thumbnailAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default',
        displayOrder: 0,
        layerTrackId: 'base-track',
        colorChannelId: null,
        assetId: 'body-asset',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        positionConfirmed: true,
        positionLocked: false,
        styleLocked: false,
        opacity: 1,
        blendMode: 'normal',
        visibleWhen: null,
        requires: [],
        excludes: [],
        seal: { protected: false },
        physical: { enabled: false },
      }],
    }],
  }];
  document.defaultRecipe = {
    selections: [{ partId: 'body', itemId: 'base', styleId: 'default' }],
    colors: [],
  };
  return document;
}

test('checked-in fixture fixes canonical UTF-8, BCS field order, u64, Options, and Root rolling bytes', async () => {
  assert.equal(fixture.schemaVersion, MAKER_V8_COMMITMENT_FIXTURE_SCHEMA);
  const semanticProjection = structuredClone(fixture.inputs.semanticProjection);
  semanticProjection.maker.revision = 18_446_744_073_709_551_615n;
  const semantic = await makerV8SemanticCommitment(semanticProjection);
  assert.deepEqual(
    { json: semantic.json, utf8Hex: semantic.utf8Hex, commitment: semantic.commitment },
    fixture.expected.semantic,
  );

  for (const kind of ['track', 'style']) {
    const input = structuredClone(fixture.inputs[kind]);
    const payload = await makerV8PayloadCommitment(input.payloadProjection);
    delete input.payloadProjection;
    input.payloadCommitment = payload.commitment;
    assert.deepEqual(
      { payloadJson: payload.json, payloadUtf8Hex: payload.utf8Hex, payloadCommitment: payload.commitment },
      {
        payloadJson: fixture.expected[kind].payloadJson,
        payloadUtf8Hex: fixture.expected[kind].payloadUtf8Hex,
        payloadCommitment: fixture.expected[kind].payloadCommitment,
      },
    );
    assert.equal(serializeMakerV8RootRow(kind, input).bcsHex, fixture.expected[kind].rowBcsHex);
    if (kind === 'style') {
      assert.equal(serializeMakerV8RootRow(kind, {
        ...input,
        colorChannelKey: null,
        defaultSwatchKey: null,
      }).bcsHex, fixture.expected.style.noneOptionsRowBcsHex);
      assert.throws(
        () => serializeMakerV8RootRow(kind, { ...input, defaultSwatchKey: null }),
        (error) => error.code === 'MAKER_V8_STYLE_COLOR_PAIR_INVALID',
      );
    }
  }

  const rootContentCommitment = semantic.commitment;
  const trackEmpty = await emptyMakerV8CategoryCommitment(
    rootContentCommitment,
    MAKER_V8_ROOT_CATEGORIES.TRACK,
  );
  assert.deepEqual(trackEmpty, fixture.expected.rootRolling.trackEmpty);
  assert.deepEqual(await advanceMakerV8CategoryCommitment({
    rootContentCommitment,
    category: MAKER_V8_ROOT_CATEGORIES.TRACK,
    previousCommitment: trackEmpty.commitment,
    sequence: 0,
    rowBytes: fixture.expected.track.rowBcsHex,
  }), fixture.expected.rootRolling.trackAdvance);

  const styleEmpty = await emptyMakerV8CategoryCommitment(
    rootContentCommitment,
    MAKER_V8_ROOT_CATEGORIES.STYLE,
  );
  assert.deepEqual(styleEmpty, fixture.expected.rootRolling.styleEmpty);
  assert.deepEqual(await advanceMakerV8CategoryCommitment({
    rootContentCommitment,
    category: MAKER_V8_ROOT_CATEGORIES.STYLE,
    previousCommitment: styleEmpty.commitment,
    sequence: 3,
    rowBytes: fixture.expected.style.rowBcsHex,
  }), fixture.expected.rootRolling.styleAdvance);

  const aggregateEmpty = await emptyMakerV8CategoryCommitment(
    rootContentCommitment,
    MAKER_V8_ROOT_CATEGORIES.AGGREGATE,
  );
  assert.deepEqual(aggregateEmpty, fixture.expected.rootRolling.aggregateEmpty);
  assert.deepEqual(await advanceMakerV8CategoryCommitment({
    rootContentCommitment,
    category: MAKER_V8_ROOT_CATEGORIES.AGGREGATE,
    previousCommitment: aggregateEmpty.commitment,
    sequence: 0,
    rowBytes: fixture.expected.track.rowBcsHex,
  }), fixture.expected.rootRolling.aggregateTrackAdvance);
  assert.deepEqual(await advanceMakerV8CategoryCommitment({
    rootContentCommitment,
    category: MAKER_V8_ROOT_CATEGORIES.AGGREGATE,
    previousCommitment: fixture.expected.rootRolling.aggregateStyleAdvance.priorCommitment,
    sequence: 3,
    rowBytes: fixture.expected.style.rowBcsHex,
  }), {
    bcsHex: fixture.expected.rootRolling.aggregateStyleAdvance.bcsHex,
    commitment: fixture.expected.rootRolling.aggregateStyleAdvance.commitment,
  });

  assert.deepEqual(serializeMakerV8Options(), fixture.expected.options.none);
  assert.deepEqual(serializeMakerV8Options({
    previousRootId: fixture.inputs.previousRootId,
    previousVersionCommitment: fixture.inputs.previousVersionCommitment,
    physicalCommitment: fixture.inputs.physicalCommitment,
  }), fixture.expected.options.some);
});

test('Root compiler derives six category chains and aggregate and rejects caller-owned hashes', async () => {
  const input = fullRootInput();
  const compiled = await compileMakerV8RootCommitments(input);
  assert.equal(compiled.totalRows, 6n);
  assert.deepEqual(compiled.commitments, fixture.expected.fullRoot.commitments);
  assert.equal(compiled.registryCommitmentsBcsHex, fixture.expected.fullRoot.registryCommitmentsBcsHex);
  assert.deepEqual(compiled.rows.map((row) => row.sequence), [0n, 1n, 2n, 3n, 4n, 5n]);
  assert.equal(compiled.rows.find((row) => row.kind === 'style').call.assetSha256,
    fixture.inputs.style.assetSha256);

  const mutated = fullRootInput();
  mutated.tracks[0].payloadProjection.locked = true;
  assert.notEqual(
    (await compileMakerV8RootCommitments(mutated)).commitments.aggregate,
    compiled.commitments.aggregate,
  );

  const reordered = fullRootInput();
  reordered.tracks.push({
    ...structuredClone(reordered.tracks[0]),
    key: 'track-second',
    label: 'Second',
  });
  const forward = await compileMakerV8RootCommitments(reordered);
  reordered.tracks.reverse();
  const reverse = await compileMakerV8RootCommitments(reordered);
  assert.notEqual(forward.commitments.tracks, reverse.commitments.tracks);
  assert.notEqual(forward.commitments.aggregate, reverse.commitments.aggregate);

  const injected = fullRootInput();
  injected.tracks[0].payloadCommitment = digest('f');
  await assert.rejects(
    compileMakerV8RootCommitments(injected),
    (error) => error instanceof MakerV8CompilerError
      && error.code === 'MAKER_V8_CALLER_COMMITMENT_FORBIDDEN',
  );
  const injectedAsset = fullRootInput();
  injectedAsset.styles[0].assetSha256 = digest('f');
  await assert.rejects(
    compileMakerV8RootCommitments(injectedAsset),
    (error) => error.code === 'MAKER_V8_CALLER_COMMITMENT_FORBIDDEN',
  );
  const ignored = fullRootInput();
  ignored.tracks[0].unprojectedMeaning = 'must not be silently dropped';
  await assert.rejects(
    compileMakerV8RootCommitments(ignored),
    (error) => error.code === 'MAKER_V8_ROOT_ROW_FIELDS_UNKNOWN',
  );
  const uncertified = fullRootInput();
  delete uncertified.styles[0].assetCertification;
  await assert.rejects(
    compileMakerV8RootCommitments(uncertified),
    (error) => error.code === 'MAKER_V8_ASSET_CERTIFICATION_REQUIRED',
  );
});

test('canonical JSON preserves array and Unicode semantics while sorting keys deterministically', async () => {
  assert.equal(canonicalMakerV8Json({ z: 1, a: { d: 4, b: 2 } }), '{"a":{"b":2,"d":4},"z":1}');
  assert.equal(canonicalMakerV8Json({ zero: -0, value: 1n }), '{"value":"1","zero":0}');
  assert.notEqual(
    (await makerV8PayloadCommitment({ ordered: ['first', 'second'] })).commitment,
    (await makerV8PayloadCommitment({ ordered: ['second', 'first'] })).commitment,
  );
  assert.notEqual(
    (await makerV8PayloadCommitment({ value: 'é' })).commitment,
    (await makerV8PayloadCommitment({ value: 'é' })).commitment,
  );
  assert.throws(
    () => canonicalMakerV8Json({ amount: Number.MAX_SAFE_INTEGER + 1 }),
    (error) => error.code === 'MAKER_V8_CANONICAL_NUMBER_INVALID',
  );
  assert.throws(
    () => canonicalMakerV8Json({ bytes: new Uint8Array([1]) }),
    (error) => error.code === 'MAKER_V8_CANONICAL_BINARY_UNSUPPORTED',
  );
  const accessor = {};
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() { throw new Error('raw-accessor-sentinel'); },
  });
  assert.throws(
    () => canonicalMakerV8Json(accessor),
    (error) => error instanceof MakerV8CompilerError
      && error.code === 'MAKER_V8_COMPILER_INPUT_DESCRIPTOR_INVALID'
      && !String(error.message).includes('raw-accessor-sentinel'),
  );
  const unreadable = new Proxy({}, {
    getPrototypeOf() { throw new Error('raw-proxy-sentinel'); },
  });
  assert.throws(
    () => canonicalMakerV8Json(unreadable),
    (error) => error instanceof MakerV8CompilerError
      && error.code === 'MAKER_V8_COMPILER_INPUT_UNREADABLE'
      && !String(error.message).includes('raw-proxy-sentinel'),
  );
  assert.throws(
    () => planMakerV8PublicationCalls(unreadable),
    (error) => error instanceof MakerV8CompilerError
      && error.code === 'MAKER_V8_COMPILER_INPUT_UNREADABLE'
      && !String(error.message).includes('raw-proxy-sentinel'),
  );
});

test('certification always hashes exact bytes and rejects missing, mutated, or mismatched evidence', async () => {
  const exact = certification(
    '89504e470d0a1a0a00ffe6b189',
    fixture.inputs.style.assetSha256,
    'walrus-root-asset',
  );
  assert.deepEqual(await verifyMakerV8Certification(exact, {
    expectedSha256: fixture.inputs.style.assetSha256,
    expectedByteLength: 13,
    expectedMediaType: 'image/png',
  }), {
    blobId: 'walrus-root-asset',
    sha256: fixture.inputs.style.assetSha256,
    byteLength: 13n,
    mediaType: 'image/png',
    bytesHex: exact.bytes,
  });
  await assert.rejects(
    verifyMakerV8Certification({ ...exact, bytes: `${exact.bytes.slice(0, -2)}00` }),
    (error) => error.code === 'MAKER_V8_CERTIFICATION_HASH_MISMATCH',
  );
  await assert.rejects(
    verifyMakerV8Certification({ ...exact, certificationVisible: false }),
    (error) => error.code === 'MAKER_V8_CERTIFICATION_REQUIRED',
  );
  await assert.rejects(
    verifyMakerV8Certification({ ...exact, byteLength: 12 }),
    (error) => error.code === 'MAKER_V8_CERTIFICATION_LENGTH_MISMATCH',
  );
  await assert.rejects(
    verifyMakerV8Certification({ ...exact, callerCommitment: digest('f') }),
    (error) => error.code === 'MAKER_V8_CERTIFICATION_FIELDS_UNKNOWN',
  );
});

test('companion commitment chains match exact golden finals across every v8 registry', async () => {
  const root = await compileMakerV8RootCommitments(fullRootInput());
  const rootContentCommitment = root.rootContentCommitment;
  const rootAsset = fixture.inputs.style.assetSha256;
  const certifiedPackAsset = await verifyMakerV8Certification({
    certified: true,
    certificationVisible: true,
    blobId: 'walrus-pack-asset',
    bytes: fixture.inputs.packAssetBytesHex,
    sha256: fixture.inputs.packAssetSha256,
    byteLength: String(fixture.inputs.packAssetBytesHex.length / 2),
    mediaType: 'image/png',
  });
  const packAsset = certifiedPackAsset.sha256;

  const compositionEmpty = await emptyMakerV8CompositionCommitment(rootContentCommitment);
  const compositionSlot = await advanceMakerV8CompositionSlotCommitment({
    rootContentCommitment,
    sequence: 0,
    priorCommitment: compositionEmpty.commitment,
    slotKey: 'body',
    behavior: MAKER_V8_COMPOSITION_BEHAVIORS.FIXED,
    capacity: 1,
    required: true,
    slotCommitment: digest('1'),
  });
  const compositionItem = await advanceMakerV8CompositionItemCommitment({
    rootContentCommitment,
    sequence: 1,
    priorCommitment: compositionSlot.commitment,
    slotKey: 'body',
    itemKey: 'base',
    sourceKind: MAKER_V8_COMPOSITION_SOURCES.OFFICIAL,
    transferable: false,
    definitionCommitment: digest('2'),
    assetCommitment: rootAsset,
  });
  const compositionRule = await advanceMakerV8CompositionRuleCommitment({
    rootContentCommitment,
    sequence: 2,
    priorCommitment: compositionItem.commitment,
    ruleKind: MAKER_V8_COMPOSITION_RULE_KINDS.REQUIRE,
    leftSlotKey: 'body',
    leftItemKey: 'base',
    rightSlotKey: 'body',
    rightItemKey: 'base',
    ruleCommitment: digest('3'),
  });
  assert.equal(compositionRule.commitment, 'aea12a65554cca9b145c6970f43a504772ee78207240322b5e92c2e637ddce8e');

  const manifest = await makerV8SemanticCommitment({
    schemaVersion: 'animacraft.pack-manifest.v1',
    title: '扩展包',
    assets: [{ sha256: packAsset }],
  });
  const certifiedManifest = await verifyMakerV8Certification({
    certified: true,
    certificationVisible: true,
    blobId: 'walrus-manifest',
    bytes: manifest.utf8Hex,
    sha256: manifest.commitment,
    byteLength: String(manifest.utf8Hex.length / 2),
    mediaType: 'application/json',
  });
  const release = await makerV8SemanticCommitment({
    schemaVersion: 'animacraft.pack-release.v1', namespace: 'studio', packKey: '夜色',
  });
  const recipe = await makerV8SemanticCommitment({
    schemaVersion: 'animacraft.complete-recipe-policy.v1', required: ['body'],
  });
  const renderer = await makerV8SemanticCommitment({
    schemaVersion: 'animacraft.renderer-schema.v1', output: 'image/png',
  });
  const materialMaker = await makerV8SemanticCommitment({
    schemaVersion: 'animacraft.material.v1', sku: 'maker-shirt',
  });
  const materialPack = await makerV8SemanticCommitment({
    schemaVersion: 'animacraft.material.v1', sku: 'pack-shirt',
  });
  const assetKey = makerV8StyleAssetKey('body', 'base', '默认');
  const packScope = makerV8PackScopeKey('studio', '夜色');
  const makerScope = makerV8MakerStyleSealScope(rootContentCommitment);
  const exactPackScope = makerV8PackStyleSealScope('studio', '夜色', release.commitment);
  const completeScope = makerV8CompleteSealScope('portrait', recipe.commitment);
  assert.equal(assetKey, 'body\u0000base\u0000默认');
  assert.equal(packScope, 'studio\u0000夜色');
  assert.equal(exactPackScope.scopeKey, packScope);

  const sealEmpty = await emptyMakerV8SealCommitment(rootContentCommitment);
  const makerSeal = await advanceMakerV8SealCommitment({
    rootContentCommitment,
    sequence: 0,
    priorCommitment: sealEmpty.commitment,
    ...makerScope,
    assetKey,
    assetCommitment: rootAsset,
  });
  const packSeal = await advanceMakerV8SealCommitment({
    rootContentCommitment,
    sequence: 1,
    priorCommitment: makerSeal.commitment,
    ...exactPackScope,
    assetKey,
    assetCommitment: packAsset,
  });
  const completeSeal = await advanceMakerV8SealCommitment({
    rootContentCommitment,
    sequence: 2,
    priorCommitment: packSeal.commitment,
    ...completeScope,
    assetKey: 'portrait',
    assetCommitment: renderer.commitment,
  });
  assert.equal(completeSeal.commitment, '66a7f7b1f4f637b9dea1944f35e86200b759aa9d229650e81fd80ce9134f5112');

  const packRegistryEmpty = await emptyMakerV8PackRegistryCommitment(rootContentCommitment);
  const packStyleEmpty = await emptyMakerV8PackStyleCommitment({
    rootContentCommitment,
    namespace: 'studio',
    packKey: '夜色',
    manifestCommitment: manifest.commitment,
    releaseContentCommitment: release.commitment,
  });
  const packStyle = await advanceMakerV8PackStyleCommitment({
    rootContentCommitment,
    namespace: 'studio',
    packKey: '夜色',
    manifestCommitment: manifest.commitment,
    releaseContentCommitment: release.commitment,
    sequence: 0,
    priorCommitment: packStyleEmpty.commitment,
    partKey: 'body',
    itemKey: 'base',
    styleKey: '默认',
    assetBlobId: certifiedPackAsset.blobId,
    assetCommitment: packAsset,
    protected: true,
    sealId: packSeal.sealId,
  });
  const packRelease = await advanceMakerV8PackReleaseCommitment({
    rootContentCommitment,
    sequence: 0,
    priorCommitment: packRegistryEmpty.commitment,
    namespace: 'studio',
    packKey: '夜色',
    manifestCommitment: manifest.commitment,
    releaseContentCommitment: release.commitment,
    styleRegistryCommitment: packStyle.commitment,
    accessKind: MAKER_V8_PACK_ACCESS_KINDS.PAID,
    purchasePriceAtomic: '999999999999',
    completeMode: 1,
    completePriceAtomic: 1_000,
    completeFreeQuotaPerWallet: 2,
    completeTotalCap: 99,
    protectedStyleCount: 1,
    sealRegistryCommitment: completeSeal.commitment,
  });
  assert.equal(packRelease.commitment, 'f3eb573387cd146b4f21812161757158f0b5a836f43d950914a1024f75d56c2c');

  const selectionEmpty = await emptyMakerV8RequiredPackSelectionCommitment(rootContentCommitment);
  const selection = await advanceMakerV8RequiredPackSelectionCommitment({
    rootContentCommitment,
    sequence: 0,
    priorCommitment: selectionEmpty.commitment,
    packScopeKey: packScope,
    releaseContentCommitment: release.commitment,
    partKey: 'body',
    itemKey: 'base',
    styleKey: '默认',
    assetCommitment: packAsset,
    protected: true,
    sealId: packSeal.sealId,
  });
  const completeEmpty = await emptyMakerV8CompleteCommitment(rootContentCommitment);
  const completeOutput = await advanceMakerV8CompleteOutputCommitment({
    rootContentCommitment,
    sequence: 0,
    priorCommitment: completeEmpty.commitment,
    outputKey: 'portrait',
    recipePolicyCommitment: recipe.commitment,
    rendererSchemaCommitment: renderer.commitment,
    protected: true,
    sealId: completeSeal.sealId,
    requiredPackSelectionCount: 1,
    requiredPackSelectionCommitment: selection.commitment,
  });
  const completePolicy = await advanceMakerV8CompletePackPolicyCommitment({
    rootContentCommitment,
    sequence: 1,
    priorCommitment: completeOutput.commitment,
    packScopeKey: packScope,
    releaseContentCommitment: release.commitment,
    mode: 1,
    priceAtomic: 1_000,
    freeQuotaPerWallet: 2,
    totalCap: 99,
  });
  assert.equal(completePolicy.commitment, 'da0556532f30f0a983090bab62c2656301b40032cbe445cdaae97f62da07d137');

  const physicalEmpty = await emptyMakerV8PhysicalCommitment(rootContentCommitment);
  const physicalMaker = await advanceMakerV8PhysicalCommitment({
    rootContentCommitment,
    sequence: 0,
    priorCommitment: physicalEmpty.commitment,
    sourceKind: MAKER_V8_PHYSICAL_SOURCE_KINDS.MAKER_STYLE,
    scopeKey: 'maker',
    scopeCommitment: rootContentCommitment,
    partKey: 'body',
    itemKey: 'base',
    styleKey: '默认',
    styleContentCommitment: rootAsset,
    materialCommitment: materialMaker.commitment,
    maxSupply: 900_000_000,
    transferable: true,
  });
  const physicalPack = await advanceMakerV8PhysicalCommitment({
    rootContentCommitment,
    sequence: 1,
    priorCommitment: physicalMaker.commitment,
    sourceKind: MAKER_V8_PHYSICAL_SOURCE_KINDS.PACK_STYLE,
    scopeKey: packScope,
    scopeCommitment: release.commitment,
    partKey: 'body',
    itemKey: 'base',
    styleKey: '默认',
    styleContentCommitment: packAsset,
    materialCommitment: materialPack.commitment,
    maxSupply: 500,
    transferable: false,
  });
  assert.equal(physicalPack.commitment, fixture.inputs.physicalCommitment);
  assert.equal((await makerV8SoulCommitment(rootContentCommitment)).commitment,
    '02339030c9a2c0f74224a899cac8d236df08c90bfb9ab85052c36622ec2758b5');

  const economics = await makerV8EconomicsCommitment({
    makerAccess: 1,
    makerPriceAtomic: '999999999999',
    completeMode: 1,
    completePriceAtomic: 1_000,
    completePerWalletQuota: 2,
    completeTotalCap: 99,
    protocolFeeBps: 250,
  });
  assert.equal(economics.commitment, 'a387aed60f85c9a902256a54911cf898dccc85e333b287f7f2c886620c514a40');
  assert.equal(economics.inputBcsHex,
    '01ff0fa5d4e800000001e80300000000000002000000000000006300000000000000fa00');
  assert.equal(economics.structBcsHex,
    `01ff0fa5d4e800000001e80300000000000002000000000000006300000000000000fa0020${economics.commitment}`);
  const rights = await makerV8RightsCommitment({
    origin: 1,
    creatorConfirmed: true,
    soulCreatorRoyaltyBps: 500,
    makerSourceRoyaltyBps: 500,
    makerResaleRoyaltyBps: 250,
  });
  assert.equal(rights.commitment, '559bd6e742b9b0379b5d96ef53930ca28a2d64d9f9aec47818ec37f0f854c3c4');
  assert.equal(rights.inputBcsHex, '0101f401f401fa00');
  assert.equal(rights.structBcsHex, `0101f401f401fa0020${rights.commitment}`);
  assert.equal((await makerV8VersionCommitment({
    packageId: `0x${'ab'.repeat(32)}`,
    makerKey: '灵魂-maker',
    makerVersion: 'v8.一',
    previousRootId: fixture.inputs.previousRootId,
    previousVersionCommitment: fixture.inputs.previousVersionCommitment,
    rendererCommitment: renderer.commitment,
    manifestBlobId: certifiedManifest.blobId,
    manifestSha256: certifiedManifest.sha256,
    contentCommitment: rootContentCommitment,
  })).commitment, '01cf660b51a2ec54462465329ea59a3e1c81f13d22686841385b52e6084f943d');

  const capabilityBcs = serializeMakerV8CapabilityCommitments({
    composition: compositionRule.commitment,
    pack: packRelease.commitment,
    complete: completePolicy.commitment,
    seal: completeSeal.commitment,
    soul: (await makerV8SoulCommitment(rootContentCommitment)).commitment,
    physical: physicalPack.commitment,
  }).bcsHex;
  assert.equal(capabilityBcs, [
    compositionRule.commitment,
    packRelease.commitment,
    completePolicy.commitment,
    completeSeal.commitment,
    (await makerV8SoulCommitment(rootContentCommitment)).commitment,
  ].map((commitment) => `20${commitment}`).join('') + `0120${physicalPack.commitment}`);
});

test('call planner computes exact counts and preserves dependency ordering', async () => {
  const root = fullRootInput();
  const packRows = [{ namespace: 'studio', packKey: '夜色', styles: [{ protected: true }] }];
  const plan = planMakerV8PublicationCalls({
    root,
    composition: { slots: [{}], items: [{}], rules: [{}] },
    packs: packRows,
    completeOutputs: [{ protected: true }],
    physicalPolicies: [{ sourceKind: 0 }, { sourceKind: 1 }],
  });
  assert.deepEqual(plan.rowCounts, {
    tracks: 1n,
    parts: 1n,
    items: 1n,
    styles: 1n,
    colors: 1n,
    rules: 1n,
    slots: 1n,
    pack_releases: 1n,
    protected_assets: 3n,
  });
  assert.equal(plan.rowCountsBcsHex,
    '010000000000000001000000000000000100000000000000010000000000000001000000000000000100000000000000010000000000000001000000000000000300000000000000');
  assert.deepEqual(
    [plan.rootSequence, plan.compositionSequence, plan.sealSequence, plan.completeSequence],
    [6n, 3n, 3n, 2n],
  );
  assert.equal(plan.expectedCompletePackPolicyCount, 1n);
  assert.equal(plan.expectedPhysicalPolicyCount, 2n);
  assert.equal(plan.declaredCapabilities, 127n);
  assert.deepEqual(plan.packReleaseCounts, [{
    namespace: 'studio',
    packKey: '夜色',
    expectedStyleCount: 1n,
    expectedProtectedStyleCount: 1n,
  }]);
  assert.deepEqual(plan.calls.map((call) => call.target), [
    'maker_v8::new_row_counts_v8',
    'maker_v8::new_registry_commitments_v8',
    'maker_v8::new_capability_commitments_v8',
    'maker_v8::new_economics_v8',
    'maker_v8::new_rights_v8',
    'publication_v8::begin_maker_v8',
    'maker_v8::append_track_v8',
    'maker_v8::append_part_v8',
    'maker_v8::append_item_v8',
    'maker_v8::append_style_v8',
    'maker_v8::append_color_v8',
    'maker_v8::append_rule_v8',
    'composition_v8::append_wardrobe_slot_v8',
    'composition_v8::append_composition_item_v8',
    'composition_v8::append_loadout_rule_v8',
    'expansion_pack_v8::create_expansion_pack_release_v8',
    'seal_v8::append_protected_asset_v8',
    'seal_v8::append_protected_asset_v8',
    'seal_v8::append_protected_asset_v8',
    'seal_v8::seal_registry_v8',
    'expansion_pack_v8::append_expansion_pack_style_v8',
    'expansion_pack_v8::seal_expansion_pack_release_v8',
    'expansion_pack_v8::append_release_to_registry_v8',
    'complete_v8::append_complete_output_v8',
    'complete_v8::append_complete_pack_policy_v8',
    'physical_v8::append_maker_style_policy_v8',
    'physical_v8::append_pack_style_policy_v8',
    'composition_v8::seal_composition_registry_v8',
    'expansion_pack_v8::seal_expansion_pack_registry_v8',
    'complete_v8::seal_complete_registry_v8',
    'physical_v8::seal_physical_registry_v8',
    'publication_v8::seal_and_activate_physical_maker_v8',
  ]);
  assert.deepEqual(
    plan.calls.filter((call) => call.phase === 'root').map((call) => call.sequence),
    [0n, 1n, 2n, 3n, 4n, 5n],
  );
  assert.deepEqual(
    plan.calls.filter((call) => call.phase === 'seal-rows').map((call) => call.scopeKind),
    [0, 1, 2],
  );

  const withoutPhysical = planMakerV8PublicationCalls({
    root,
    composition: { slots: [], items: [], rules: [] },
    packs: [],
    completeOutputs: [],
  });
  assert.equal(withoutPhysical.declaredCapabilities, 127n);
  assert.equal(withoutPhysical.expectedPhysicalPolicyCount, 0n);
  assert.equal(withoutPhysical.calls.at(-1).target,
    'publication_v8::seal_and_activate_physical_maker_v8');
  assert.equal(withoutPhysical.calls.some((call) => (
    call.target === 'physical_v8::seal_physical_registry_v8'
  )), true);

  const hiddenPack = new Proxy(packRows, {
    get(target, property, receiver) {
      if (property === 'length') return 0;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () => planMakerV8PublicationCalls({
      root,
      composition: { slots: [], items: [], rules: [] },
      packs: hiddenPack,
      completeOutputs: [],
    }),
    (error) => error instanceof MakerV8CompilerError
      && error.code === 'MAKER_V8_COMPILER_INPUT_UNREADABLE',
  );
});

test('u64 and row-count bounds fail closed instead of rounding or overflowing', () => {
  const track = structuredClone(fixture.inputs.track);
  delete track.payloadProjection;
  track.payloadCommitment = fixture.expected.track.payloadCommitment;
  assert.equal(serializeMakerV8RootRow('track', track).bcsHex, fixture.expected.track.rowBcsHex);
  assert.throws(
    () => serializeMakerV8RootRow('track', { ...track, renderOrder: Number.MAX_SAFE_INTEGER + 1 }),
    (error) => error.code === 'MAKER_V8_INTEGER_INVALID',
  );
  assert.throws(
    () => serializeMakerV8RootRow('track', { ...track, renderOrder: '18446744073709551616' }),
    (error) => error.code === 'MAKER_V8_INTEGER_RANGE',
  );
  assert.throws(
    () => serializeMakerV8RowCounts({
      tracks: 0, parts: 1, items: 1, styles: 1, colors: 0, rules: 0,
      slots: 0, packReleases: 0, protectedAssets: 0,
    }),
    (error) => error.code === 'MAKER_V8_ROW_COUNT_INVALID',
  );
});

test('document entry point reports the schema expansion it needs and never invents publication semantics', async () => {
  const document = validCurrentDocument();
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  const issues = collectMakerV8CompilerIssues(document);
  const codes = new Set(issues.map((issue) => issue.code));
  for (const code of [
    'MAKER_V8_COMPILER_PART_KIND_UNSPECIFIED',
    'MAKER_V8_COMPILER_ITEM_GATE_UNSPECIFIED',
    'MAKER_V8_COMPILER_RENDERER_PROJECTION_UNSPECIFIED',
    'MAKER_V8_COMPILER_MANIFEST_CERTIFICATION_REQUIRED',
    'MAKER_V8_COMPILER_COMPLETE_OUTPUTS_UNSPECIFIED',
  ]) {
    assert.equal(codes.has(code), true, code);
  }
  await assert.rejects(
    compileMakerV8Publication(document),
    (error) => error instanceof MakerV8CompilerError
      && error.code === 'MAKER_V8_DOCUMENT_SCHEMA_INCOMPLETE'
      && error.details.issues.length === issues.length,
  );
});
