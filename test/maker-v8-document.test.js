import assert from 'node:assert/strict';
import test from 'node:test';

import { MAKER_V8_RIGHTS_ORIGINS } from '../maker-commerce-v8.js';
import {
  MAKER_V8_COMPOSITION_MODES,
  MAKER_V8_DOCUMENT_SCHEMA,
  MAKER_V8_OUTPUT_PACK_POLICIES,
  MAKER_V8_PART_KINDS,
  MAKER_V8_PHYSICAL_ISSUANCE,
  MAKER_V8_PHYSICAL_PROOFS,
  MAKER_V8_THIRD_PARTY_ADMISSION_MODES,
  MAKER_V8_WARDROBE_MODES,
  MakerV8DocumentError,
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
  createCharacterMakerV8Starter,
  createMakerV8Document,
  isMakerV8Document,
  projectPublicMakerV8Document,
} from '../maker-v8-document.js';

function mutableStarter() {
  return structuredClone(createCharacterMakerV8Starter({
    makerKey: 'fresh-maker',
    name: 'Fresh Maker',
  }));
}

function addColor(document) {
  document.colors.push({
    key: 'skin',
    label: 'Skin',
    defaultSwatchKey: 'warm',
    swatches: [
      {
        key: 'warm',
        label: 'Warm',
        rgba: '#f0c0a0ff',
        stops: [{ offset: 0, rgba: '#402010ff' }, { offset: 1, rgba: '#f0c0a0ff' }],
      },
      { key: 'cool', label: 'Cool', rgba: '#b0d0ffff', stops: [] },
    ],
  });
  const style = document.parts[0].items[0].styles[0];
  style.colorChannelKey = 'skin';
  style.defaultSwatchKey = 'warm';
  document.defaultRecipe.colors.push({ channelKey: 'skin', swatchKey: 'warm' });
}

test('factory creates an immutable chain-free fresh-v8 document and nothing older', () => {
  const document = createMakerV8Document({ makerKey: 'alpha', name: 'Alpha' });
  assert.equal(document.schemaVersion, MAKER_V8_DOCUMENT_SCHEMA);
  assert.equal(document.protocolVersion, 8);
  assert.equal(Object.isFrozen(document), true);
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'draft' }), []);
  assert.equal(Object.hasOwn(document, 'capabilities'), false);
  assert.equal(Object.hasOwn(document, 'packs'), false);
  assert.equal(JSON.stringify(document).includes('packageId'), false);

  for (const schemaVersion of ['animacraft.maker.v4', 'animacraft.maker.v5', 'animacraft.maker.v6', 'animacraft.maker.v7']) {
    assert.equal(isMakerV8Document({ ...document, schemaVersion }), false);
  }
});

test('starter compiles with the exact Track-Part-Item-Style vocabulary', () => {
  const document = createCharacterMakerV8Starter({ makerKey: 'starter' });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  assert.deepEqual(document.composition, {
    mode: MAKER_V8_COMPOSITION_MODES.FIXED,
    thirdPartyAdmission: MAKER_V8_THIRD_PARTY_ADMISSION_MODES.DISABLED,
    itemAssetization: false,
  });
  assert.equal(document.parts[0].kind, MAKER_V8_PART_KINDS.LAST_BASTION);
  assert.equal(document.parts[0].wardrobeMode, MAKER_V8_WARDROBE_MODES.FIXED);
  assert.equal(document.parts[0].items[0].status, 'PUBLIC');
  assert.deepEqual(document.outputs[0].allowedPackPolicy, {
    kind: MAKER_V8_OUTPUT_PACK_POLICIES.ALL_ADMITTED,
    packIds: [],
  });
});

test('measured seal cap counts only published Styles while author arrays remain bounded', () => {
  const document = mutableStarter();
  const template = document.parts[0].items[0].styles[0];
  document.parts[0].items.push({
    ...structuredClone(document.parts[0].items[0]),
    key: 'private-library',
    label: 'Private library',
    status: 'PRIVATE',
    defaultStyleKey: 'private-0',
    styles: Array.from({ length: 600 }, (_, index) => ({
      ...structuredClone(template),
      key: `private-${index}`,
      label: `Private ${index}`,
      displayOrder: index,
    })),
  });
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'compile' }));
  assert.equal(projectPublicMakerV8Document(document).parts[0].items.length, 1);

  document.parts[0].items[0].styles = Array.from({ length: 501 }, (_, index) => ({
    ...structuredClone(template), key: `public-${index}`, label: `Public ${index}`, displayOrder: index,
  }));
  document.parts[0].items[0].defaultStyleKey = 'public-0';
  document.defaultRecipe.selections[0].styleKey = 'public-0';
  assert.throws(
    () => assertMakerV8Document(document, { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_STYLE_SEAL_LIMIT'
      && entry.details.observedPublishedStyles === 501
      && entry.details.maximumPublishedStyles === 500),
  );
});

test('every schema boundary is exact and arbitrary payload cannot smuggle authority', () => {
  const forbidden = [
    ['rootId', '0xdead'],
    ['catalogId', '0xdead'],
    ['paymentCommitment', '11'.repeat(32)],
    ['assetSha256', '22'.repeat(32)],
    ['ciphertextBlobId', 'blob'],
    ['receivingRef', { objectId: 'x' }],
    ['transactionDigest', 'digest'],
  ];
  for (const [key, value] of forbidden) {
    const document = mutableStarter();
    document.parts[0].payload[key] = value;
    const issues = collectMakerV8DocumentIssues(document, { mode: 'compile' });
    assert.equal(issues.some((entry) => entry.code === 'MAKER_V8_COMPILER_FIELD_FORBIDDEN'), true, key);
  }

  const document = mutableStarter();
  document.parts[0].invented = true;
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_FIELD_UNKNOWN'), true);
});

test('non-JSON graphs, accessors, sparse arrays, symbols, bigint, and non-finite numbers fail closed', () => {
  const cases = [];
  const cycle = mutableStarter();
  cycle.parts[0].payload.self = cycle.parts[0].payload;
  cases.push(cycle);
  const accessor = mutableStarter();
  Object.defineProperty(accessor.metadata, 'name', { enumerable: true, get: () => 'trap' });
  cases.push(accessor);
  const sparse = mutableStarter();
  sparse.outputs = new Array(2);
  cases.push(sparse);
  const symbol = mutableStarter();
  symbol.metadata[Symbol('hidden')] = true;
  cases.push(symbol);
  const bigint = mutableStarter();
  bigint.parts[0].payload.amount = 1n;
  cases.push(bigint);
  const infinite = mutableStarter();
  infinite.canvas.width = Infinity;
  cases.push(infinite);
  cases.forEach((value) => assert.notDeepEqual(collectMakerV8DocumentIssues(value), []));
});

test('public projection removes private Items and revalidates all references', () => {
  const document = mutableStarter();
  const privateItem = structuredClone(document.parts[0].items[0]);
  privateItem.key = 'next-version';
  privateItem.status = 'PRIVATE';
  privateItem.styles[0].key = 'next-style';
  privateItem.defaultStyleKey = 'next-style';
  document.parts[0].items.push(privateItem);
  const projected = projectPublicMakerV8Document(document);
  assert.deepEqual(projected.parts[0].items.map((entry) => entry.key), ['default']);
  assert.equal(Object.isFrozen(projected), true);

  document.defaultRecipe.selections[0] = {
    partKey: 'base', itemKey: 'next-version', styleKey: 'next-style',
  };
  assert.throws(
    () => projectPublicMakerV8Document(document),
    (error) => error instanceof MakerV8DocumentError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_RECIPE_TARGET_UNKNOWN'),
  );
});

test('a published Part cannot become empty after private-item projection', () => {
  const document = mutableStarter();
  document.parts[0].required = false;
  document.parts[0].items[0].status = 'PRIVATE';
  document.defaultRecipe.selections = [];
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_PUBLIC_PART_EMPTY'), true);
});

test('Color/Swatch references are exact in Styles and the default Recipe', () => {
  const document = mutableStarter();
  addColor(document);
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);

  document.parts[0].items[0].styles[0].defaultSwatchKey = 'missing';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_SWATCH_UNKNOWN'), true);
  document.parts[0].items[0].styles[0].defaultSwatchKey = 'warm';
  document.defaultRecipe.colors[0].swatchKey = 'missing';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_RECIPE_COLOR_UNKNOWN'), true);
});

test('Composition, Pack allowlist, and rule semantics reject downgrade-shaped inputs', () => {
  const document = mutableStarter();
  document.composition.mode = MAKER_V8_COMPOSITION_MODES.COMPOSABLE;
  document.composition.thirdPartyAdmission = MAKER_V8_THIRD_PARTY_ADMISSION_MODES.CERTIFIED;
  document.parts[0].wardrobeMode = MAKER_V8_WARDROBE_MODES.SLOT;
  document.outputs[0].allowedPackPolicy = {
    kind: MAKER_V8_OUTPUT_PACK_POLICIES.ALLOWLIST,
    packIds: ['alpha-pack', 'zeta-pack'],
  };
  document.rules.push({
    key: 'requires-base',
    kind: 'REQUIRE',
    left: { partKey: 'base', itemKey: 'default' },
    right: { partKey: 'base', itemKey: 'default' },
    payload: {},
  });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.outputs[0].allowedPackPolicy.packIds.reverse();
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_PACK_ALLOWLIST_INVALID'), true);
});

test('Physical policy uses exact issuance/proof/price/supply semantics', () => {
  const document = mutableStarter();
  const style = document.parts[0].items[0].styles[0];
  style.physical = {
    material: 'archival cotton',
    issuance: MAKER_V8_PHYSICAL_ISSUANCE.PAID_PURCHASE,
    proof: MAKER_V8_PHYSICAL_PROOFS.NONE,
    priceAtomic: '1200000',
    maxSupply: '100',
    transferable: true,
  };
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  style.physical.issuance = MAKER_V8_PHYSICAL_ISSUANCE.PROOF_MATERIALIZE;
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_PHYSICAL_PROOF_INVALID'), true);
});

test('license-wrapped rights require one semantic evidence asset, never a Blob or hash', () => {
  const document = mutableStarter();
  document.commerce.rightsOrigin = MAKER_V8_RIGHTS_ORIGINS.LICENSE_WRAPPED;
  document.commerce.rightsEvidence = {
    licensor: 'Example Licensor', evidenceAssetId: 'rights-evidence',
  };
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_RIGHTS_ASSET_UNKNOWN'), true);
  document.assets.push({
    id: 'rights-evidence', kind: 'rights-evidence', mediaType: 'application/pdf', byteLength: 5,
  });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.commerce.rightsEvidence.evidenceBlobId = 'forbidden';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_COMPILER_FIELD_FORBIDDEN'), true);
});

test('atomic values are canonical u64 strings and bounded at both ends', () => {
  const document = mutableStarter();
  document.assets[0].byteLength = '18446744073709551615';
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.assets[0].byteLength = '18446744073709551616';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_U64_INVALID'), true);
  document.assets[0].byteLength = '01';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_U64_INVALID'), true);
});

test('assertion reports layered immutable issues and never mutates author input', () => {
  const document = mutableStarter();
  document.lineage.makerKey = `0x${'11'.repeat(32)}`;
  const before = structuredClone(document);
  assert.throws(
    () => assertMakerV8Document(document, { mode: 'compile' }),
    (error) => error instanceof MakerV8DocumentError
      && error.code === 'MAKER_V8_KEY_INVALID'
      && Object.isFrozen(error.issues),
  );
  assert.deepEqual(document, before);
});
