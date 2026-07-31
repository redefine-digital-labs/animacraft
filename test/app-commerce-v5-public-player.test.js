import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8');
const workspaceI18n = await readFile(
  new URL('../maker-workspace-i18n.js', import.meta.url),
  'utf8',
);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const declaration = `function ${name}`;
  const declarationIndex = app.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `missing ${name}`);
  const bodyStart = app.indexOf(') {', declarationIndex + declaration.length) + 2;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < app.length; index += 1) {
    const character = app[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      return app.slice(declarationIndex, index + 1);
    }
  }
  assert.fail(`unterminated ${name}`);
}

function publicState({
  source = 'chain',
  releaseEnabled = true,
  verified = true,
  protocolEnabled = true,
  lifecycle = 0,
  legacyArchived = false,
  resolvingRoot = false,
} = {}) {
  const template = {
    id: 'maker',
    source,
    commerceV5RootObjectId: resolvingRoot ? '0x123' : '',
  };
  const management = verified ? {
    chain: {
      root: { lifecycle },
      protocol: { enabled: protocolEnabled },
      listing: null,
    },
    isSeller: false,
  } : null;
  return new Function('template', 'releaseEnabled', 'legacyArchived', 'management', `
    const makerModels = new Map([['maker', {
      makerArchived: legacyArchived,
      commerceV5RootObjectId: template.commerceV5RootObjectId,
    }]]);
    const state = { templateId: 'maker' };
    const makerCommerceV5ViewMatches = () => true;
    const makerCommerceV5LifecycleView = management
      ? { status: 'ready', management }
      : null;
    const runtimeConfig = {
      commerceV5ReleaseEnabled: releaseEnabled,
      commerceV5TypeOriginPackageId: '0x1',
      commerceProtocolConfigV5Id: '0x2',
      commerceProtocolTreasuryV5Id: '0x3',
    };
    const COMMERCE_V5_LIFECYCLE = { ACTIVE: 0 };
    const suiJsonId = (value) => String(value || '');
    ${functionSource('templateCommerceV5PublicState')}
    return templateCommerceV5PublicState(template);
  `)(template, releaseEnabled, legacyArchived, management);
}

test('Player commerce propagates verified availability and never finalizes local quota estimates', () => {
  assert.match(workspace, /available:\s*Boolean\(/);
  assert.match(workspace, /protocolEnabled:\s*Boolean\(/);
  assert.match(workspace, /authoritativeQuoteRequired,/);
  assert.match(workspace, /errorCode:\s*String\(/);
  assert.match(workspace, /errorMessage:\s*String\(/);
  assert.match(
    workspace,
    /state\.authoritativeQuoteRequired[\s\S]*\['TOTAL_CAP_REACHED', 'FREE_QUOTA_EXHAUSTED'\]/,
  );
  assert.match(workspace, /playerCommerceVerifyingChainPrice/);
  assert.match(workspace, /playerContinueToOnchainConfirmation/);
  assert.match(workspace, /\[0, '0', 'ACTIVE'\]\.includes\(state\.lifecycle\)/);
  assert.match(app, /protocolEnabled:\s*chain\.protocol\.enabled/);
  assert.match(app, /authoritativeQuoteRequired:\s*true/);
});

test('Commerce release and protocol gates disable purchase, list and Complete surfaces', () => {
  assert.match(app, /COMMERCE_V5_RELEASE_DISABLED/);
  assert.match(app, /COMMERCE_V5_PROTOCOL_DISABLED/);
  assert.match(
    app,
    /\['commerce-v5-list', 'commerce-v5-buy'\]\.includes\(action\)[\s\S]*runtimeConfig\.commerceV5ReleaseEnabled !== true/,
  );
  assert.match(
    app,
    /\['commerce-v5-list', 'commerce-v5-buy'\]\.includes\(action\)[\s\S]*protocol\.enabled !== true/,
  );
  assert.match(workspace, /playerCommerceBlockingMessage\(basePlayerDocument\)/);
  assert.match(workspace, /player-unlock-pack[\s\S]*commerceBlocking/);
  assert.match(workspace, /player-unlock-maker[\s\S]*commerceBlocking/);
});

test('Public Maker detail resolves v5 lifecycle and exposes a fresh-read SALE_PENDING buy path', () => {
  assert.match(app, /function templateCommerceV5PublicState\(template\)/);
  assert.match(
    app,
    /playable:\s*releaseEnabled[\s\S]*protocolEnabled[\s\S]*verified[\s\S]*lifecycle === COMMERCE_V5_LIFECYCLE\.ACTIVE/,
  );
  assert.match(
    app,
    /const commerceStateToken = publicState\.verified[\s\S]*String\(publicState\.lifecycle\)/,
  );
  assert.match(app, /makerCommerceV5BindingResolving/);
  assert.match(app, /data-detail-buy/);
  assert.match(
    app,
    /const management = await refreshMakerCommerceV5Lifecycle\(\{ silentWhenAbsent: false \}\)/,
  );
  assert.match(app, /await handleMakerLifecycleAction\('commerce-v5-buy'\)/);
  assert.match(app, /listing\.protocolFeeBps/);
});

test('public chain Player opens only after release, protocol, readback and ACTIVE lifecycle all verify', () => {
  assert.equal(publicState().playable, true);
  assert.equal(publicState({ releaseEnabled: false }).playable, false);
  assert.equal(publicState({ protocolEnabled: false }).playable, false);
  assert.equal(publicState({ verified: false }).playable, false);
  assert.equal(publicState({ lifecycle: 1 }).playable, false);
  assert.equal(
    publicState({ verified: false, resolvingRoot: false }).playable,
    false,
    'an unmigrated legacy chain Maker must fail closed',
  );
  assert.equal(publicState({ source: 'local' }).playable, true);
});

test('Migrated v5 Makers suppress legacy v4 economics controls', () => {
  assert.match(html, /id="legacyMakerEconomicsPanel"/);
  assert.match(app, /const commerceV5Managed = Boolean\(/);
  assert.match(app, /legacyMakerEconomicsPanel'\)\.hidden = commerceV5Managed/);
  assert.match(app, /updateMakerEconomics'\)\.disabled = commerceV5Managed/);
  assert.match(app, /withdrawMakerRevenue'\)\.disabled = commerceV5Managed/);
});

test('All player commerce fail-closed copy exists in five locales', () => {
  [
    'playerCommerceReleaseDisabled',
    'playerCommerceProtocolDisabled',
    'playerCommerceMakerInactive',
    'playerCommerceUnavailable',
    'playerCommerceBindingResolving',
    'playerCommerceVerifyingChainPrice',
    'playerCommerceAuthoritativeQuoteCopy',
    'playerContinueToOnchainConfirmation',
    'rightsOriginConfirmationRequired',
    'rightsOriginConfirmed',
  ].forEach((key) => {
    assert.equal(
      (workspaceI18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length,
      5,
      `${key} must exist in all five locales`,
    );
  });
  const lifecycleI18n = app.slice(
    app.indexOf('const makerCommerceV5LifecycleI18n'),
    app.indexOf(
      '\nObject.entries(makerCommerceV5LifecycleI18n)',
      app.indexOf('const makerCommerceV5LifecycleI18n'),
    ),
  );
  [
    'makerCommerceV5BindingResolving',
    'makerCommerceV5BindingResolvingCopy',
    'makerCommerceV5ReleaseDisabled',
    'makerCommerceV5ProtocolDisabled',
    'makerCommerceV5ConnectToBuy',
  ].forEach((key) => {
    assert.equal(
      (lifecycleI18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length,
      5,
      `${key} must exist in all five app locales`,
    );
  });
});

test('Soulidity handoff and social links preserve the active Animacraft locale', () => {
  const linkSource = app.slice(
    app.indexOf('function soulidityAppLink'),
    app.indexOf('\nfunction utf8Length'),
  );
  assert.match(linkSource, /url\.searchParams\.set\(\s*'lang'/);
  assert.match(linkSource, /\['en', 'zh', 'ja', 'ko', 'vi'\]\.includes\(state\.locale\)/);
  assert.match(app, /soulidityAppLink\(runtimeConfig\.soulidityIntegrationPath/);
});
