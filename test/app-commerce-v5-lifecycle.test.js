import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const asyncStart = app.indexOf(`async function ${name}`);
  const actualStart = start >= 0 ? start : asyncStart;
  assert.notEqual(actualStart, -1, `${name} must exist`);
  const candidates = [
    app.indexOf(`\nfunction ${nextName}`, actualStart + 1),
    app.indexOf(`\nasync function ${nextName}`, actualStart + 1),
  ].filter((value) => value >= 0);
  return app.slice(actualStart, candidates.length ? Math.min(...candidates) : undefined);
}

test('Commerce v5 lifecycle reads canonical root, treasury, listing and wallet authority', () => {
  const source = functionSource(
    'readMakerCommerceV5Management',
    'refreshMakerCommerceV5Lifecycle',
  );
  assert.match(source, /resolveActiveCommerceV5Binding\(document\)/);
  assert.match(source, /queryCommerceV5Objects\(client,\s*\{/);
  assert.match(source, /makerRootId:\s*binding\.rootObjectId/);
  assert.match(source, /makerTreasuryId:\s*binding\.makerTreasuryObjectId/);
  assert.match(
    source,
    /if \(chain\.root\.activeListingId\)[\s\S]*listingId:\s*chain\.root\.activeListingId/,
  );
  assert.match(source, /queryOwnedCommerceV5State\(client,\s*\{/);
  assert.match(source, /currentControlCap/);
  assert.match(source, /assertCommerceV5ManagementTypeOrigin\(management\)/);
});

test('Commerce v5 money input stays exact from UI text through u64 transaction arguments', () => {
  const formatter = functionSource(
    'commerceV5AtomicToDecimalText',
    'commerceV5DecimalToAtomicExact',
  );
  const parser = functionSource(
    'commerceV5DecimalToAtomicExact',
    'commerceV5RoyaltyRateText',
  );
  assert.match(formatter, /BigInt\(value \?\? 0\)/);
  assert.match(formatter, /10n \*\* BigInt\(scale\)/);
  assert.match(parser, /BigInt\(whole\)/);
  assert.match(parser, /10n \*\* BigInt\(scale\)/);
  assert.match(parser, /\(1n << 64n\) - 1n/);
  assert.doesNotMatch(parser, /parseFloat|parseInt|Number\(text\)/);
});

test('Every Maker lifecycle action signs against a fresh read and requires exact readback', () => {
  const source = functionSource(
    'executeMakerCommerceV5Action',
    'commerceV5SafeUiNumber',
  );
  [
    'buildPauseMakerV5',
    'buildActivateMakerV5',
    'buildArchiveMakerV5',
    'buildRestoreMakerV5',
    'buildWithdrawMakerRevenueV5',
    'buildListMakerForSaleV5',
    'buildCancelMakerListingV5',
    'buildBuyMakerV5',
  ].forEach((builder) => assert.match(source, new RegExp(`${builder}\\\\?\\(`)));
  assert.match(
    source,
    /latestManagement = await readMakerCommerceV5Management\(operation\)/,
  );
  assert.match(
    source,
    /signExecuteAndWait\(transaction,\s*\{\s*expectedWallet:\s*wallet/,
  );
  assert.match(
    source,
    /readBackMakerCommerceV5Lifecycle\(operation,\s*matches\)/,
  );
  assert.match(source, /COMMERCE_V5_READBACK_PENDING/);
  assert.match(
    source,
    /candidate\.chain\.root\.lifecycle === COMMERCE_V5_LIFECYCLE\.SALE_PENDING[\s\S]*candidate\.chain\.listing\.priceAtomic === priceAtomic[\s\S]*!candidate\.controlCap/,
  );
  assert.match(
    source,
    /candidate\.chain\.root\.lifecycle === COMMERCE_V5_LIFECYCLE\.PAUSED[\s\S]*!candidate\.chain\.root\.activeListingId[\s\S]*Boolean\(candidate\.controlCap\)/,
  );
});

test('Listing is enabled only for a PAUSED Maker whose exact treasury balance is zero', () => {
  const source = functionSource(
    'renderMakerCommerceV5LifecyclePanel',
    'setMakerCommerceV5LifecycleReady',
  );
  assert.match(
    source,
    /const canList = isOwner[\s\S]*Boolean\(controlCap\)[\s\S]*root\.lifecycle === COMMERCE_V5_LIFECYCLE\.PAUSED[\s\S]*makerTreasury\.balanceAtomic === 0n/,
  );
  assert.match(source, /makerCommerceV5EmptyTreasuryBeforeListing/);
  assert.match(
    source,
    /commerceV5RoyaltyRateText\(root\.soulCreatorRoyaltyBps\)/,
  );
  assert.match(source, /makerCommerceV5SoulCreatorRoyaltyFrozen/);
  assert.match(source, /makerCommerceV5ResaleRoyaltyFrozen/);
});

test('Lifecycle manager exposes one responsive Commerce v5 operations surface', () => {
  assert.match(html, /id="makerCommerceV5LifecyclePanel"/);
  assert.match(html, /id="makerCommerceV5LifecycleContent"/);
  assert.match(
    html,
    /data-lifecycle-action="commerce-v5-refresh"/,
  );
  assert.match(styles, /\.maker-commerce-v5-lifecycle-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(styles, /\.maker-lifecycle-version-history\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(styles, /@media[\s\S]*\.maker-commerce-v5-state-grid/);
  assert.match(runtime, /export \* from '\.\/chain-commerce-v5\.js';/);
});

test('Commerce v5 lifecycle labels are complete in all five supported locales', () => {
  const localeBlock = app.slice(
    app.indexOf('const makerCommerceV5LifecycleI18n'),
    app.indexOf(
      '\nObject.entries(makerCommerceV5LifecycleI18n)',
      app.indexOf('const makerCommerceV5LifecycleI18n'),
    ),
  );
  const keys = [
    'makerCommerceV5PanelTitle',
    'makerCommerceV5Active',
    'makerCommerceV5Paused',
    'makerCommerceV5Archived',
    'makerCommerceV5SalePending',
    'makerCommerceV5Treasury',
    'makerCommerceV5WithdrawAction',
    'makerCommerceV5ListAction',
    'makerCommerceV5ActionRefresh',
    'makerCommerceV5SoulCreatorRoyalty',
    'makerCommerceV5SoulCreatorRoyaltyFrozen',
    'makerCommerceV5ActionConfirmed',
    'makerCommerceV5ReadbackFailed',
  ];
  assert.equal((localeBlock.match(/\ben:\s*\{/g) || []).length, 1);
  assert.equal((localeBlock.match(/\bzh:\s*\{/g) || []).length, 1);
  assert.equal((localeBlock.match(/\bja:\s*\{/g) || []).length, 1);
  assert.equal((localeBlock.match(/\bko:\s*\{/g) || []).length, 1);
  assert.equal((localeBlock.match(/\bvi:\s*\{/g) || []).length, 1);
  keys.forEach((key) => {
    assert.equal(
      (localeBlock.match(new RegExp(`\\b${key}:`, 'g')) || []).length,
      5,
      `${key} must exist in all five locales`,
    );
  });
});
