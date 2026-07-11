import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProtocolV3IncludedItemGates,
  validateRemoteMakerManifest,
} from '../manifest-validation.js';

function item(id, identifier) {
  return {
    id,
    label: id,
    displayOrder: 1,
    visibility: 'public',
    iconIdentifier: '',
    images: [{ layerId: 'normal', colorId: 'default', identifier }],
  };
}

function part({ key, kind = 'standard', allowRemove = true, identifier, renderOrder = 0 }) {
  return {
    key,
    label: key,
    kind,
    menuVisible: true,
    allowRemove,
    defaultItemId: 'normal',
    iconIdentifier: '',
    layers: [{ id: 'normal', name: 'Normal', x: 0, y: 0, opacity: 100, blendMode: 'normal', renderOrder }],
    colors: [{ id: 'default', name: 'Default', value: '#7b5cff' }],
    items: [item('normal', identifier)],
  };
}

function validManifest() {
  return {
    schemaVersion: 'animacraft.creator-template.v3',
    template: {
      name: 'Launch Maker',
      summary: 'A production validation fixture.',
      licenseNote: 'Personal use with creator credit.',
      canvas: { width: 1024, height: 1024 },
      coverIdentifier: 'maker-cover.png',
    },
    parts: [
      part({ key: 'base', kind: 'last-bastion', allowRemove: false, identifier: 'base.png' }),
      part({ key: 'hair', identifier: 'hair.png', renderOrder: 1 }),
    ],
    rules: [],
    paletteLinks: [{ primaryPartKey: 'base', linkedPartKey: 'hair' }],
    assets: [
      { identifier: 'base.png' },
      { identifier: 'hair.png' },
      { identifier: 'maker-cover.png' },
    ],
  };
}

test('accepts a complete production manifest', () => {
  const manifest = validManifest();
  assert.equal(validateRemoteMakerManifest(manifest), manifest);
});

test('keeps protocol v3 publication on included Items only', () => {
  const included = [{ id: 'eyes-a' }, { id: 'eyes-b', gateKind: 0 }];
  assert.equal(assertProtocolV3IncludedItemGates(included), included);
  assert.throws(
    () => assertProtocolV3IncludedItemGates([{ id: 'premium', gateKind: 1 }]),
    /only included Items/,
  );
  assert.throws(
    () => assertProtocolV3IncludedItemGates([{ id: 'creator', gateKind: 2 }]),
    /only included Items/,
  );
});

test('rejects duplicate Part keys', () => {
  const manifest = validManifest();
  manifest.parts[1].key = 'base';
  assert.throws(() => validateRemoteMakerManifest(manifest), /duplicate Part keys/);
});

test('rejects unsafe public identifiers', () => {
  const manifest = validManifest();
  manifest.parts[1].key = 'hair:front';
  assert.throws(() => validateRemoteMakerManifest(manifest), /invalid Part key or label/);
});

test('rejects an incomplete Item image matrix', () => {
  const manifest = validManifest();
  manifest.parts[1].items[0].images = [];
  assert.throws(() => validateRemoteMakerManifest(manifest), /incomplete image matrix/);
});

test('rejects an asset reference missing from the Walrus index', () => {
  const manifest = validManifest();
  manifest.assets = manifest.assets.filter((asset) => asset.identifier !== 'hair.png');
  assert.throws(() => validateRemoteMakerManifest(manifest), /missing from the asset index/);
});

test('requires Last Bastion Parts to remain selected', () => {
  const manifest = validManifest();
  manifest.parts[0].allowRemove = true;
  assert.throws(() => validateRemoteMakerManifest(manifest), /required fallback Part/);
});

test('rejects selection rules that target a Last Bastion Part', () => {
  const manifest = validManifest();
  manifest.rules.push({
    leftPartKey: 'base',
    leftItemKey: '',
    rightPartKey: 'hair',
    rightItemKey: '',
  });
  assert.throws(() => validateRemoteMakerManifest(manifest), /invalid selection rule/);
});

test('rejects duplicate selection rules in either direction', () => {
  const manifest = validManifest();
  manifest.parts[0].kind = 'standard';
  manifest.parts[0].allowRemove = true;
  manifest.rules.push(
    { leftPartKey: 'base', leftItemKey: '', rightPartKey: 'hair', rightItemKey: 'normal' },
    { leftPartKey: 'hair', leftItemKey: 'normal', rightPartKey: 'base', rightItemKey: '' },
  );
  assert.throws(() => validateRemoteMakerManifest(manifest), /duplicate selection rule/);
});

test('rejects linked palettes with different on-chain color sets', () => {
  const manifest = validManifest();
  manifest.parts[1].colors[0].value = '#ffffff';
  assert.throws(() => validateRemoteMakerManifest(manifest), /same exact color set/);
});

test('rejects duplicate palette links in either direction', () => {
  const manifest = validManifest();
  manifest.paletteLinks.push({ primaryPartKey: 'hair', linkedPartKey: 'base' });
  assert.throws(() => validateRemoteMakerManifest(manifest), /duplicate palette link/);
});

test('rejects duplicate global Layer order', () => {
  const manifest = validManifest();
  manifest.parts[1].layers[0].renderOrder = 0;
  assert.throws(() => validateRemoteMakerManifest(manifest), /global Layer order/);
});

test('rejects duplicate on-chain Color values', () => {
  const manifest = validManifest();
  manifest.parts[1].colors.push({ id: 'copy', name: 'Copy', value: '#7b5cff' });
  manifest.parts[1].items[0].images.push({ layerId: 'normal', colorId: 'copy', identifier: 'hair-copy.png' });
  manifest.assets.push({ identifier: 'hair-copy.png' });
  assert.throws(() => validateRemoteMakerManifest(manifest), /duplicate Color values/);
});

test('rejects unsupported schema versions', () => {
  const manifest = validManifest();
  manifest.schemaVersion = 'animacraft.creator-template.v99';
  assert.throws(() => validateRemoteMakerManifest(manifest), /unsupported schema version/);
});

test('requires a public license note', () => {
  const manifest = validManifest();
  manifest.template.licenseNote = '';
  assert.throws(() => validateRemoteMakerManifest(manifest), /invalid public metadata/);
});

test('accepts a tiered royalty and USDC mint fee', () => {
  const manifest = validManifest();
  Object.assign(manifest.template, {
    royaltyBps: 500,
    mintingEnabled: true,
    mintFeeEnabled: true,
    mintPriceAtomic: 1_500_000,
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  });
  assert.equal(validateRemoteMakerManifest(manifest), manifest);
});

test('rejects arbitrary royalty basis points', () => {
  const manifest = validManifest();
  manifest.template.royaltyBps = 250;
  assert.throws(() => validateRemoteMakerManifest(manifest), /invalid public metadata/);
});

test('rejects a paid mint without a valid payment coin', () => {
  const manifest = validManifest();
  Object.assign(manifest.template, { mintFeeEnabled: true, mintPriceAtomic: 1_000_000, paymentCoinType: 'USDC' });
  assert.throws(() => validateRemoteMakerManifest(manifest), /invalid mint economics/);
});
