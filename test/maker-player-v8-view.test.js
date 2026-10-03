import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readApprovedUiDonor as donorFile } from './fixtures/approved-ui-donors/read-donor.mjs';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';
import { makerWorkspaceText } from '../maker-workspace-i18n.js';
import {
  MAKER_V8_PLAYER_LOADOUT_SCHEMA,
  MAKER_V8_PLAYER_RECIPE_SCHEMA,
  makerV8PlayerRecipeCommitmentV8,
} from '../maker-v8-player-controller.js';
import {
  MAKER_V8_APPROVED_PLAYER_VIEW_SCHEMA,
  projectMakerV8PlayerView,
  projectMakerV8LocalPlayerView,
  renderApprovedMakerV8Player,
} from '../maker-player-v8-view.js';

const viewSource = await readFile(new URL('../maker-player-v8-view.js', import.meta.url), 'utf8');

function rulesPlayerFixture() {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'rules' }));
  const template = document.parts[0];
  const part = (key, items, menuOrder) => ({ ...structuredClone(template), key, label: key,
    kind: 'STANDARD', required: false, menuOrder, renderOrder: menuOrder,
    items: items.map((key, displayOrder) => ({ ...structuredClone(template.items[0]), key,
      label: key, displayOrder })),
  });
  document.parts.push(part('background', ['ordinary', 'legendary', 'rare', 'mixed'], 1),
    part('body', ['abyss', 'arctic'], 2));
  document.parts[1].items[3].styles.push({
    ...structuredClone(template.items[0].styles[0]), key: 'allowed', label: 'Allowed', displayOrder: 1,
  });
  const selector = (partKey, itemKey, styleKey = null) => ({
    source: 'BASE', sourceKey: null, partKey, itemKey, styleKey,
  });
  document.rules = [
    { key: 'exclude-abyss', kind: 'EXCLUDE', trigger: selector('background', 'legendary'),
      targetMode: 'ANY', targets: [selector('body', 'abyss')], payload: {} },
    { key: 'require-arctic', kind: 'REQUIRE', trigger: selector('background', 'rare'),
      targetMode: 'ALL', targets: [selector('body', 'arctic')], payload: {} },
    { key: 'mixed-style', kind: 'EXCLUDE', trigger: selector('background', 'mixed', 'default'),
      targetMode: 'ANY', targets: [selector('body', 'abyss')], payload: {} },
  ];
  document.defaultRecipe.selections.push(
    { partKey: 'background', itemKey: 'ordinary', styleKey: 'default' },
    { partKey: 'body', itemKey: 'abyss', styleKey: 'default' },
  );
  return createMakerV8LocalPlayer({ draftId: 'rules', draftRevision: 1, document });
}

function rulesPlayerHtml(player, selectedPartKey, capabilities = { default: true }) {
  return renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(player.getSnapshot(),
    { selectedPartKey }, capabilities));
}

function itemButton(html, itemKey, action = 'player-item', styleKey = '') {
  return formActionTags(html).find(tag => tag.includes(`data-action="${action}"`)
    && tag.includes(`data-item-id="${itemKey}"`)
    && (!styleKey || tag.includes(`data-style-id="${styleKey}"`)));
}

function selectRulesItem(player, partKey, itemKey, styleKey = 'default') {
  const snapshot = player.getSnapshot();
  return player.setRecipe({ ...snapshot.recipe,
    selections: snapshot.recipe.selections.map(selection => selection.partKey === partKey
      ? { partKey, itemKey, styleKey } : selection),
  }, snapshot.revision);
}

test('None control carries the exact selected Part identity for local dispatch', () => {
  const player = rulesPlayerFixture();
  for (const key of ['background', 'body']) {
    const html = rulesPlayerHtml(player, key);
    const control = formActionTags(html).find(tag => tag.includes('data-action="player-none"'));
    assert.ok(control?.includes(`data-part-id="${key}"`), control);
  }
});

test('combination rules disable candidate choices before click and recover without changing the recipe', () => {
  const player = rulesPlayerFixture();
  const before = structuredClone(player.getSnapshot());
  let html = rulesPlayerHtml(player, 'background');
  assert.match(itemButton(html, 'legendary'), /disabled[^>]+Recipe violates EXCLUDE rule exclude-abyss/);
  assert.match(itemButton(html, 'rare'), /disabled[^>]+Recipe violates REQUIRE rule require-arctic/);
  assert.deepEqual(player.getSnapshot(), before);
  assert.throws(() => selectRulesItem(player, 'background', 'legendary'), { code: 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED' });
  assert.throws(() => selectRulesItem(player, 'background', 'rare'), { code: 'MAKER_V8_PLAYER_RULE_REQUIRE_FAILED' });
  assert.deepEqual(player.getSnapshot(), before, 'the controller still rejects dispatch bypass without a mutation');
  selectRulesItem(player, 'body', 'arctic');
  html = rulesPlayerHtml(player, 'background');
  assert.doesNotMatch(itemButton(html, 'legendary'), / disabled/);
  assert.doesNotMatch(itemButton(html, 'rare'), / disabled/);
  assert.equal(player.getSnapshot().recipe.selections.find(row => row.partKey === 'background').itemKey, 'ordinary');
});

test('required dependencies cannot be replaced or removed, while removing their trigger stays available', () => {
  const player = rulesPlayerFixture();
  selectRulesItem(player, 'body', 'arctic');
  selectRulesItem(player, 'background', 'rare');
  const before = structuredClone(player.getSnapshot());
  const body = rulesPlayerHtml(player, 'body');
  for (const button of [itemButton(body, 'abyss'), itemButton(body, 'arctic'),
    itemButton(body, 'arctic', 'player-style'), actionTag(body, 'player-none')]) {
    assert.match(button, /disabled[^>]+Recipe violates REQUIRE rule require-arctic/);
  }
  const background = rulesPlayerHtml(player, 'background');
  assert.doesNotMatch(itemButton(background, 'rare'), / disabled/);
  assert.doesNotMatch(itemButton(background, 'rare', 'player-style'), / disabled/);
  assert.doesNotMatch(actionTag(background, 'player-none'), / disabled/);
  assert.deepEqual(player.getSnapshot(), before);
});

test('combination rule style availability chooses a usable sibling and never overrides host capabilities', () => {
  const player = rulesPlayerFixture();
  let html = rulesPlayerHtml(player, 'background');
  assert.match(itemButton(html, 'mixed'), /data-choice-id="base:background:mixed:allowed"/);
  assert.doesNotMatch(itemButton(html, 'mixed'), / disabled/);
  selectRulesItem(player, 'background', 'mixed', 'allowed');
  html = rulesPlayerHtml(player, 'background');
  assert.match(itemButton(html, 'mixed', 'player-style', 'default'), /disabled[^>]+mixed-style/);
  assert.doesNotMatch(itemButton(html, 'mixed', 'player-style', 'allowed'), / disabled/);
  selectRulesItem(player, 'body', 'arctic');
  html = rulesPlayerHtml(player, 'background', { default: true,
    'player-style:base:background:mixed:default': { enabled: false, reason: 'Host denied this style.' } });
  assert.match(itemButton(html, 'mixed', 'player-style', 'default'), /disabled[^>]+Host denied this style/);
  assert.equal(player.getSnapshot().recipe.selections.find(row => row.partKey === 'background').styleKey, 'allowed');
});

test('local Player renders persisted Maker display identity, style and independent cover', () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'local', name: 'Display test' }));
  document.metadata.creator = '作者 S2';
  document.metadata.style = 'World S2';
  document.metadata.coverAssetId = 'maker-cover';
  document.assets.push({ id: 'maker-cover', kind: 'cover', mediaType: 'image/jpeg', byteLength: 123 });
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 2, document });
  try {
    const view = projectMakerV8LocalPlayerView(session.getSnapshot(), {
      locale: 'en', introOpen: true, assetUrls: { 'maker-cover': 'blob:maker-cover' },
    });
    const html = renderApprovedMakerV8Player(view);
    assert.match(html, /by 作者 S2/);
    assert.match(html, /World S2/);
    assert.match(html, /src="blob:maker-cover"/);
    assert.equal(view.execution.writeEnabled, false);
    assert.equal(Object.hasOwn(view.player, 'certifiedAssets'), false);
  } finally { session.dispose(); }
});

test('local saved status uses localized autosaved text without inventing a timestamp', () => {
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local' }) });
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const view = projectMakerV8LocalPlayerView(session.getSnapshot(), {
      locale, localSave: { state: 'saved', savedAt: '' },
    });
    const html = renderApprovedMakerV8Player(view);
    assert.ok(html.includes(makerWorkspaceText(locale, 'draftAutosaved')));
    assert.doesNotMatch(html, /saved at —/);
  }
  const timed = projectMakerV8LocalPlayerView(session.getSnapshot(), {
    locale: 'en', localSave: { state: 'saved', savedAt: '14:23:17' },
  });
  assert.match(renderApprovedMakerV8Player(timed), /OC draft saved at 14:23:17/);
  session.dispose();
});

test('local Player projects through the approved renderer without certified identity or chain capabilities', () => {
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local', name: 'Local Player' }) });
  const view = projectMakerV8LocalPlayerView(session.getSnapshot(), {
    render: { state: 'ready' }, completionIssues: [],
    profile: { name: 'Untrusted view override' },
    soul: { defaults: { soulMd: 'Forged Maker default' }, documents: { soulMd: '' },
      validation: { documents: { soulMd: { valid: true } } } },
    publishFlow: { open: true }, save: { state: 'saved' },
    completionConfirmation: { id: 'forged', step: { action: 'completeOutput' } },
    recoveryBranches: [{ id: 'chain-branch' }],
    assetUrls: { 'base-default': 'data:image/png;base64,AQ==' },
    export: { previewUrl: 'blob:local-preview', completionConfirmed: true, shareUrl: 'https://example.com/soul' },
  }, { default: true, 'player-complete': true, 'player-unlock-maker': true, 'player-publish-register': true });
  assert.equal(view.mode, 'LOCAL_DRAFT');
  assert.equal(view.draftId, 'local');
  for (const field of ['rootId', 'loadout']) assert.equal(Object.hasOwn(view, field), false);
  for (const field of ['rootId', 'evidence', 'certifiedAssets']) assert.equal(Object.hasOwn(view.player, field), false);
  assert.equal(view.execution.writeEnabled, false);
  assert.equal(view.completeReady, false);
  assert.equal(view.publishFlow.open, false);
  assert.equal(view.completionConfirmation, null);
  assert.equal(view.save.state, 'idle');
  assert.equal(view.profile.name, '');
  assert.equal(view.soulDocuments[0].value, session.getSnapshot().document.livingContent.soulMd);
  assert.equal(view.soulDocuments[0].valid, true);
  assert.equal(view.export.completionConfirmed, false);
  assert.equal(view.export.shareUrl, '');
  assert.deepEqual(view.recoveryBranches, []);
  assert.equal(view.assets['base-default'].url, 'data:image/png;base64,AQ==');
  assert.equal(view.capabilities.fallback.enabled, false);
  for (const action of ['player-complete', 'player-unlock-maker', 'player-publish-register', 'player-share-maker']) {
    assert.equal(view.capabilities.entries[action], undefined);
  }
  const html = renderApprovedMakerV8Player(view);
  for (const className of ['v4-player-shell', 'v4-player-header', 'v4-player-preview']) assert.ok(html.includes(className));
  assert.match(html, /data-action="player-item"[^>]*>/);
  assert.match(html, /data-action="player-complete"[^>]*disabled/);
  assert.doesNotMatch(html, /id="makerPlayerPublish/);
});

test('Soul restore explains unchanged Maker defaults without implying a purchase requirement', () => {
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local' }) });
  const capabilities = { controls: { 'player-reset-soul-document': true, 'player-reset-all-soul': true } };
  try {
    for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
      const html = renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(session.getSnapshot(), { locale }, capabilities));
      const buttons = html.match(/<button[^>]*data-action="player-reset-(?:soul-document|all-soul)"[^>]*>/g);
      assert.equal(buttons.length, 4);
      for (const button of buttons) {
        assert.match(button, /disabled/);
        assert.ok(button.includes(makerWorkspaceText(locale, 'playerSoulMakerDefault')));
        assert.ok(!button.includes(makerWorkspaceText(locale, 'playerPurchaseUnavailable')));
      }
    }
    const initial = session.getSnapshot();
    session.setPersonalization({ profile: initial.profile, soulDocuments: { ...initial.soulDocuments, memoryMd: '# Changed' } }, initial.revision);
    const html = renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(session.getSnapshot(), {}, capabilities));
    assert.doesNotMatch(html.match(/<button[^>]*data-action="player-reset-all-soul"[^>]*>/)[0], /disabled/);
    assert.doesNotMatch(html.match(/<button[^>]*data-action="player-reset-soul-document" data-soul-key="memoryMd"[^>]*>/)[0], /disabled/);
    assert.match(html.match(/<button[^>]*data-action="player-reset-soul-document" data-soul-key="soulMd"[^>]*>/)[0], /disabled/);
  } finally { session.dispose(); }
});

test('local history explains empty stacks without implying a purchase requirement', () => {
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local' }) });
  const capabilities = { controls: { 'player-undo': true, 'player-redo': true } };
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const html = renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(session.getSnapshot(), { locale }, capabilities));
    for (const action of ['undo', 'redo']) {
      const button = html.match(new RegExp('<button[^>]*data-action="player-' + action + '"[^>]*>'))[0];
      assert.match(button, /disabled/);
      assert.ok(button.includes(makerWorkspaceText(locale, action + 'Unavailable')));
      assert.ok(!button.includes(makerWorkspaceText(locale, 'playerPurchaseUnavailable')));
    }
  }
  const initial = session.getSnapshot();
  session.setPersonalization({ profile: { ...initial.profile, name: 'Local edit' }, soulDocuments: initial.soulDocuments }, initial.revision);
  let html = renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(session.getSnapshot(), {}, capabilities));
  assert.doesNotMatch(html.match(/<button[^>]*data-action="player-undo"[^>]*>/)[0], /disabled/);
  session.undo(session.getSnapshot().revision);
  html = renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(session.getSnapshot(), {}, capabilities));
  assert.doesNotMatch(html.match(/<button[^>]*data-action="player-redo"[^>]*>/)[0], /disabled/);
  session.dispose();
});

test('local projection rejects invented, cloned, stale and disposed snapshots', () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'local' }));
  document.outputs.push({ ...structuredClone(document.outputs[0]), key: 'second' });
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1, document });
  const before = session.getSnapshot();
  assert.throws(() => projectMakerV8LocalPlayerView(structuredClone(before)), { code: 'MAKER_V8_LOCAL_PLAYER_SNAPSHOT_INVALID' });
  assert.throws(() => projectMakerV8LocalPlayerView({ ...before, execution: { writeEnabled: true } }), { code: 'MAKER_V8_LOCAL_PLAYER_SNAPSHOT_INVALID' });
  session.setRecipe({ ...before.recipe, outputKey: 'second' }, 0);
  assert.throws(() => projectMakerV8LocalPlayerView(before), { code: 'MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH' });
  const current = session.getSnapshot();
  assert.equal(projectMakerV8LocalPlayerView(current).recipe.outputKey, 'second');
  session.dispose();
  assert.throws(() => projectMakerV8LocalPlayerView(current), { code: 'MAKER_V8_LOCAL_PLAYER_DISPOSED' });
});

test('local projection keeps all five locales and blocks remote asset/export URLs', () => {
  const session = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local' }) });
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const view = projectMakerV8LocalPlayerView(session.getSnapshot(), {
      locale, assetUrls: { 'base-default': 'https://example.com/image.png' },
      export: { previewUrl: 'https://example.com/export.png', open: true },
    });
    assert.equal(view.locale, locale);
    assert.equal(view.assets['base-default'].url, '');
    assert.equal(view.export.previewUrl, '');
    assert.equal(view.capabilities.entries['player-item'].enabled, false);
    assert.doesNotMatch(renderApprovedMakerV8Player(view), /https:\/\/example.com/);
  }
});

const donorWorkspace = donorFile('maker-workspace.js');
const donorI18n = donorFile('maker-workspace-i18n.js');
const approvedPlayerDonor = donorFile('maker-workspace.js', '93d16531');

function donorMethod(name, nextName) {
  const start = donorWorkspace.indexOf(`  ${name}(`);
  const end = donorWorkspace.indexOf(`\n  ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Expected donor ${name}.`);
  return donorWorkspace.slice(start, end);
}

const donorPlayerSurface = [
  donorMethod('renderPlayerSoulConfiguration', 'updatePlayerSoulConfigurationUi'),
  donorMethod('renderPlayerExportModal', 'renderPlayer'),
  donorMethod('renderPlayer', 'documentWithCreatorPreview'),
  donorMethod('renderPlayerRecoveryBranches', 'updatePlayerSaveStatusUi'),
  donorMethod('renderPublicationFlow', 'renderCreatorPublishFlow'),
].join('\n').replaceAll('${prefix}', 'player');
const approvedPlayerStart = approvedPlayerDonor.indexOf('  renderPlayer()');
const approvedPlayerEnd = approvedPlayerDonor.indexOf(
  '\n  documentWithCreatorPreview()',
  approvedPlayerStart,
);
assert.ok(approvedPlayerStart >= 0 && approvedPlayerEnd > approvedPlayerStart);
const approvedPlayerSurface = approvedPlayerDonor.slice(approvedPlayerStart, approvedPlayerEnd);

function tokenSet(source, expression) {
  return new Set([...source.matchAll(expression)].map((match) => match[1]));
}

function formActionTags(markup) {
  return [...markup.matchAll(/<(?:button|input|select|textarea)\b[^>]*data-action="[^"]+"[^>]*>/g)]
    .map((match) => match[0]);
}

function actionTag(markup, action) {
  const match = markup.match(new RegExp(`<[^>]+data-action="${action}"[^>]*>`));
  assert.ok(match, `Expected ${action}.`);
  return match[0];
}

function articleByAttribute(markup, attribute, value) {
  const marker = `${attribute}="${value}"`;
  const markerAt = markup.indexOf(marker);
  assert.ok(markerAt >= 0, `Expected ${marker}.`);
  const start = markup.lastIndexOf('<article', markerAt);
  const end = markup.indexOf('</article>', markerAt);
  assert.ok(start >= 0 && end > markerAt, `Expected article for ${marker}.`);
  return markup.slice(start, end + '</article>'.length);
}

function actionCount(markup, action) {
  return [...markup.matchAll(new RegExp(`data-action="${action}"`, 'g'))].length;
}

function sessionFixture() {
  const document = structuredClone(
    createCharacterMakerV8Starter({ makerKey: 'player-demo', name: 'Player Demo' }),
  );
  document.metadata.summary = 'Approved Player fixture';
  document.metadata.coverAssetId = null;
  document.colors.push({
    key: 'skin', label: 'Skin', defaultSwatchKey: 'warm', swatches: [
      { key: 'warm', label: 'Warm', rgba: '#c58f6fff', stops: [] },
      { key: 'cool', label: 'Cool', rgba: '#8aa6c8ff', stops: [] },
    ],
  });
  document.parts[0].items[0].styles[0].colorChannelKey = 'skin';
  document.parts[0].items[0].styles[0].defaultSwatchKey = 'warm';
  document.defaultRecipe.colors = [{ channelKey: 'skin', swatchKey: 'warm' }];
  const rootId = `0x${'44'.repeat(32)}`;
  const releaseId = `0x${'55'.repeat(32)}`;
  const externalProductId = `0x${'66'.repeat(32)}`;
  const externalItemId = `0x${'77'.repeat(32)}`;
  const pack = {
    source: 'PACK', id: `pack:${releaseId}:base:moon:violet`, label: 'Moon Pack · Violet',
    partKey: 'base', itemKey: 'moon', styleKey: 'violet', trackKey: 'base-track',
    colorChannelKey: null, defaultSwatchKey: null, releaseId,
    semanticPackId: 'moon-pack', externalProductId: null, ownedExternalItemId: null,
    assetId: 'pack-moon', protected: false,
    access: { accessible: true, canEquip: true, reason: '' },
  };
  const external = {
    source: 'EXTERNAL', id: `external:${externalItemId}`, label: 'Hat · Blue',
    partKey: 'base', itemKey: 'hat', styleKey: 'blue', trackKey: 'base-track',
    colorChannelKey: null, defaultSwatchKey: null, releaseId: null,
    semanticPackId: null, externalProductId, ownedExternalItemId: externalItemId,
    assetId: 'external-hat', protected: false,
    access: { accessible: true, canEquip: true, reason: '' },
  };
  const player = {
    schemaVersion: 'animacraft.maker-v8-player-view.v1',
    id: rootId,
    rootId,
    makerKey: 'player-demo',
    makerVersion: '1',
    title: 'Player Demo',
    summary: 'Approved Player fixture',
    creatorAddress: `0x${'88'.repeat(32)}`,
    ownerAddress: `0x${'99'.repeat(32)}`,
    lifecycle: 'ACTIVE',
    coverAsset: null,
    document,
    certifiedAssets: [
      { assetId: 'base-default', blobId: 'base-blob', mediaType: 'image/png', byteLength: 1, sha256: 'a'.repeat(64) },
      { assetId: 'pack-moon', blobId: 'pack-blob', mediaType: 'image/png', byteLength: 1, sha256: 'b'.repeat(64) },
      { assetId: 'external-hat', blobId: 'external-blob', mediaType: 'image/png', byteLength: 1, sha256: 'c'.repeat(64) },
    ],
    evidence: {
      rootId,
      makerVersion: '1',
      contentCommitment: 'd'.repeat(64),
    },
    contextualChoices: {
      schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
      address: `0x${'aa'.repeat(32)}`,
      rootId,
      baseEntitlements: [],
      packStyles: [pack],
      externalStyles: [external],
      certifiedAssets: [],
      diagnostics: [],
    },
  };
  const basePart = document.parts[0];
  const baseItem = basePart.items[0];
  const baseStyle = baseItem.styles[0];
  const baseSelection = {
    source: 'BASE',
    partKey: basePart.key,
    itemKey: baseItem.key,
    styleKey: baseStyle.key,
    trackKey: baseStyle.trackKey,
    colorChannelKey: baseStyle.colorChannelKey,
    defaultSwatchKey: baseStyle.defaultSwatchKey,
    releaseId: null,
    semanticPackId: null,
    externalProductId: null,
    ownedExternalItemId: null,
  };
  const recipe = {
    schemaVersion: MAKER_V8_PLAYER_RECIPE_SCHEMA,
    rootId,
    makerVersion: '1',
    rootContentCommitment: 'd'.repeat(64),
    selections: [baseSelection],
    colors: [{ channelKey: 'skin', swatchKey: 'warm' }],
    outputKey: 'default-png',
  };
  return {
    schemaVersion: 'animacraft.maker-v8-player-session.v1',
    status: 'READY',
    rootId,
    player,
    recipe,
    loadout: {
      schemaVersion: MAKER_V8_PLAYER_LOADOUT_SCHEMA,
      rootId,
      makerVersion: '1',
      rootContentCommitment: 'd'.repeat(64),
      outputKey: recipe.outputKey,
      selections: [{ selectionIndex: 0, ...baseSelection, swatchKey: 'warm' }],
      usedPacks: [],
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
    },
    execution: {
      allowWalletSignature: false,
      allowBroadcast: false,
      allowProtectedContent: false,
      writeEnabled: false,
      disabledReason: 'Exact Fresh-v8 Player execution is unavailable in this view.',
    },
  };
}

const selectionFields = [
  'source', 'partKey', 'itemKey', 'styleKey', 'trackKey', 'colorChannelKey',
  'defaultSwatchKey', 'releaseId', 'semanticPackId', 'externalProductId',
  'ownedExternalItemId',
];

function selectContextualChoice(session, source) {
  const choice = source === 'PACK'
    ? session.player.contextualChoices.packStyles[0]
    : session.player.contextualChoices.externalStyles[0];
  const selection = Object.fromEntries(selectionFields.map((field) => [field, choice[field]]));
  session.recipe.selections = [selection];
  session.loadout.selections = [{ selectionIndex: 0, ...selection, swatchKey: null }];
  session.loadout.usedPacks = source === 'PACK'
    ? [{ releaseId: selection.releaseId, semanticPackId: selection.semanticPackId }]
    : [];
  session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
  return { choice, selection };
}

function fullState(overrides = {}) {
  return {
    enabledPackReleaseIds: [`0x${'55'.repeat(32)}`],
    locale: 'en',
    selectedPartKey: 'base',
    pickerPanel: 'parts',
    undoDepth: 1,
    redoDepth: 1,
    recipeValid: true,
    makerAccess: { accessible: true },
    completionIssues: [],
    render: { state: 'ready', message: 'All selected PNGs rendered successfully' },
    playerTest: { state: 'ready', message: 'Player Test ready' },
    save: { state: 'error', error: 'conflict' },
    profile: { name: 'Nora', world: 'Moon', description: 'A traveler', tags: 'moon,oc' },
    soul: {
      defaults: { soulMd: '# Soul', memoryMd: '# Memory', skillMd: '---\nname: moon\n---\n# Skill' },
      documents: { soulMd: '# Nora', memoryMd: '# Memory', skillMd: '---\nname: moon\n---\n# Skill' },
    },
    assetUrls: {
      'base-default': 'https://assets.example/base.png',
      'pack-moon': 'https://assets.example/moon.png',
      'external-hat': 'https://assets.example/hat.png',
    },
    introOpen: true,
    export: {
      open: true,
      state: 'error',
      error: 'render retry',
      previewUrl: 'https://assets.example/final.png',
      sizeMode: 'standard',
      standard: { width: 1024, height: 1024 },
      original: { width: 1024, height: 1024 },
      originalSafe: true,
      completionConfirmed: false,
      shareUrl: '',
    },
    recoveryBranches: [{
      writerId: 'writer-a', revision: 4, baseRevision: 3,
      session: { profile: { name: 'Nora Recovery' } },
    }],
    selectedRecoveryWriterId: 'writer-a',
    publishFlow: {
      open: true,
      closeConfirm: true,
      error: { code: 'OUTCOME_UNKNOWN', title: 'Pending', message: 'Recovery required' },
    },
    ...overrides,
  };
}

test('projection is pure, immutable, and exactly consumes the Fresh bridge Player session', () => {
  const session = sessionFixture();
  const before = JSON.stringify(session);
  const view = projectMakerV8PlayerView(session, fullState(), { default: true });

  assert.equal(JSON.stringify(session), before);
  assert.equal(view.schemaVersion, MAKER_V8_APPROVED_PLAYER_VIEW_SCHEMA);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.contextualChoices[0]), true);
  assert.equal(view.player.rootId, session.rootId);
  assert.deepEqual(view.recipe, session.recipe);
  assert.deepEqual(view.loadout, session.loadout);
  assert.deepEqual(view.execution, session.execution);
  assert.deepEqual(view.contextualChoices.map((choice) => choice.source), ['PACK', 'EXTERNAL']);
  assert.equal(view.contextualChoices[1].owned, true);
  assert.equal(view.assets['pack-moon'].blobId, 'pack-blob');
  assert.equal(view.assets['pack-moon'].url, 'https://assets.example/moon.png');
  assert.deepEqual(
    view.boundaries.filter((boundary) => ['player-unlock-maker', 'player-expansion', 'player-unlock-pack'].includes(boundary.action)).map((boundary) => boundary.action),
    ['player-expansion', 'player-unlock-maker', 'player-unlock-pack'],
  );
});

test('action, donor class, and ARIA signatures are bidirectionally derived from aac90dbc', () => {
  const donorActions = tokenSet(donorPlayerSurface, /data-action="([a-z0-9-]+)"/g);
  const viewActions = tokenSet(viewSource, /data-action="([a-z0-9-]+)"/g);
  const unavailableFromFreshSession = new Set([
    // renderPlayer has no Player branch for force-close; the other three need
    // access/legacy-pack state absent from openPlayerSession and are recorded
    // as explicit fail-closed boundaries by the projection.
    'force-close-player-publish',
    'player-expansion',
    'player-unlock-maker',
    'player-unlock-pack',
  ]);
  const postBaselineWardrobeActions = new Set([
    'player-wardrobe',
    'player-close-wardrobe',
    'player-composable-equip',
    'player-composable-acquire',
    'player-composable-owned-lock',
  ]);
  const expectedActions = new Set([...donorActions].filter((action) => (
    !unavailableFromFreshSession.has(action) && !postBaselineWardrobeActions.has(action)
  )));
  // Retain donor actions. Confirmations and signed-envelope recovery stay in
  // the original Export panel; private project import/export remains separate.
  expectedActions.add('player-confirm-journey-step');
  expectedActions.add('player-cancel-journey-step');
  expectedActions.add('player-start-new-completion');
  // Multiple configured Outputs now use the existing recipe outputKey boundary.
  expectedActions.add('player-output');
  expectedActions.add('player-open-completed-soul');
  expectedActions.add('player-export-envelope-recovery');
  expectedActions.add('player-import-envelope-recovery');
  expectedActions.add('player-clear-envelope-recovery');
  assert.deepEqual([...viewActions].sort(), [...expectedActions].sort());

  const donorClasses = tokenSet(donorPlayerSurface, /\b(v[47]-[a-z0-9-]+)/g);
  const viewClasses = tokenSet(viewSource, /\b(v[47]-[a-z0-9-]+)/g);
  const donorClassesWithoutFreshFields = new Set([
    'v4-chain-published',
    'v4-composable-gate',
    'v4-player-access-gate',
    'v4-player-commerce-error',
    'v4-player-item-tx-',
    'v4-player-soulidity-links',
    'v4-player-style-reason-',
    'v7-player-family',
    'v7-player-part-catalog',
    'v7-player-style-card',
    'v7-player-style-catalog',
  ]);
  const donorClassPrefixes = new Set([...donorClasses].filter((name) => (
    !donorClassesWithoutFreshFields.has(name) && !name.startsWith('v4-player-wardrobe')
  )));
  assert.deepEqual([...viewClasses].filter((name) => !donorClasses.has(name)), []);
  assert.deepEqual([...donorClassPrefixes].filter((name) => !viewClasses.has(name)), []);

  const donorAria = tokenSet(donorPlayerSurface, /\b(aria-[a-z-]+)=/g);
  const viewAria = tokenSet(viewSource, /\b(aria-[a-z-]+)=/g);
  assert.deepEqual([...viewAria].sort(), [...donorAria].sort());

  for (const key of [
    'characterMaker', 'smartColor', 'playerSoulConfigCopy',
    'finalOcPreview', 'downloadRecipePackage', 'playerRecoveryTitle',
  ]) {
    assert.match(donorI18n, new RegExp(`\\b${key}:`));
    assert.match(viewSource, new RegExp(`['"]${key}['"]`));
  }
});

test('approved Player keeps Parts, Items, Styles, Smart Color, runtime canvas, profile, Soul, export, PNG, complete, and recovery controls', () => {
  const session = sessionFixture();
  const view = projectMakerV8PlayerView(session, fullState(), { default: true });
  const markup = renderApprovedMakerV8Player(view);

  for (const fragment of [
    'class="v4-player-shell"',
    'class="v4-player-part-rail"',
    'class="v4-player-item ',
    'class="v4-player-style-option ',
    'id="makerV4PlayerCanvas"',
    'class="v4-runtime-canvas"',
    'data-action="player-profile-name"',
    'data-action="player-profile-description"',
    'data-action="player-soul-document" data-soul-key="soulMd"',
    'data-action="player-soul-document" data-soul-key="memoryMd"',
    'data-action="player-soul-document" data-soul-key="skillMd"',
    'data-action="player-export-recipe"',
    'data-action="player-download-png"',
    'data-action="player-confirm-complete"',
    'data-action="player-select-recovery"',
    'data-action="player-export-recovery"',
  ]) assert.ok(markup.includes(fragment), fragment);
  assert.match(markup, /id="v4PlayerRenderStatus"[^>]*role="status"[^>]*>Player Test ready/);
  assert.match(markup, /data-action="player-undo"/);
  assert.match(markup, /data-action="player-redo"/);
  assert.match(markup, /data-action="player-random"/);
  assert.match(markup, /data-action="player-reset"/);
  assert.match(markup, /data-action="player-clear"/);

  const paletteMarkup = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    session,
    fullState({ pickerPanel: 'colors', export: { open: false } }),
    { default: true },
  ));
  assert.match(paletteMarkup, /class="v4-player-palette-panel"/);
  assert.match(paletteMarkup, /data-action="player-color"/);
  assert.match(paletteMarkup, /data-channel-id="skin"/);
  assert.match(paletteMarkup, /class="active"[^>]*data-action="player-color"/);
  assert.match(paletteMarkup, /<i aria-hidden="true"><\/i><span>[^<]+<\/span><b aria-hidden="true">✓<\/b>/);
  assert.match(paletteMarkup, /class="v4-player-colors"[^>]*>\s*<div>/);
});

test('Palette marks the rendered Style default when recipe has no explicit color override', () => {
  const session = sessionFixture();
  session.player.document.parts[0].items[0].styles[0].defaultSwatchKey = 'cool';
  session.recipe.selections[0].defaultSwatchKey = 'cool';
  session.recipe.colors = [];
  session.loadout.selections[0].defaultSwatchKey = 'cool';
  session.loadout.selections[0].swatchKey = 'cool';
  session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
  const html = renderApprovedMakerV8Player(projectMakerV8PlayerView(session,
    fullState({ pickerPanel: 'colors', export: { open: false } }), { default: true }));
  assert.match(html, /class="active"[^>]*data-swatch-id="cool"[^>]*aria-checked="true"/);
  assert.match(html, /data-swatch-id="warm"[^>]*aria-checked="false"/);
});

test('approved donor Player keeps contextual choices in Parts without any Wardrobe tab or DOM', () => {
  const view = projectMakerV8PlayerView(
    sessionFixture(),
    fullState({ pickerPanel: 'wardrobe', export: { open: false }, introOpen: false }),
    { default: true },
  );
  const markup = renderApprovedMakerV8Player(view);
  assert.equal(view.pickerPanel, 'parts');
  assert.match(markup, /Moon Pack · Violet/);
  assert.match(markup, /Hat · Blue/);
  assert.match(markup, /data-action="player-expansion-v8"/);
  assert.doesNotMatch(approvedPlayerSurface, /Wardrobe|player-wardrobe|v4-player-wardrobe/i);
  assert.doesNotMatch(viewSource, /Wardrobe|player-wardrobe|v4-player-wardrobe/i);
  assert.doesNotMatch(markup, /Wardrobe|player-wardrobe|v4-player-wardrobe|data-route=/i);
  const tabActions = new Set([...markup.matchAll(
    /<button\b[^>]*role="tab"[^>]*data-action="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]));
  assert.deepEqual([...tabActions].sort(), ['player-palette', 'player-part']);
});

test('root identity and content commitment close across session, Player evidence, Recipe, and Loadout', () => {
  const valid = sessionFixture();
  valid.rootContentCommitment = 'd'.repeat(64);
  assert.doesNotThrow(() => projectMakerV8PlayerView(valid, fullState(), { default: true }));

  for (const mutate of [
    (session) => { session.rootId = `0x${'01'.repeat(32)}`; },
    (session) => { session.player.id = `0x${'02'.repeat(32)}`; },
    (session) => { session.player.rootId = `0x${'03'.repeat(32)}`; },
    (session) => { session.player.evidence.rootId = `0x${'04'.repeat(32)}`; },
    (session) => { session.recipe.rootId = `0x${'05'.repeat(32)}`; },
    (session) => { session.loadout.rootId = `0x${'06'.repeat(32)}`; },
  ]) {
    const drifted = sessionFixture();
    mutate(drifted);
    assert.throws(
      () => projectMakerV8PlayerView(drifted, fullState(), { default: true }),
      /Root identity closure/,
    );
  }

  for (const mutate of [
    (session) => { session.player.evidence.contentCommitment = '1'.repeat(64); },
    (session) => { session.recipe.rootContentCommitment = '2'.repeat(64); },
    (session) => { session.loadout.rootContentCommitment = '3'.repeat(64); },
    (session) => { session.rootContentCommitment = '4'.repeat(64); },
    (session) => { session.player.rootContentCommitment = '5'.repeat(64); },
  ]) {
    const drifted = sessionFixture();
    mutate(drifted);
    assert.throws(
      () => projectMakerV8PlayerView(drifted, fullState(), { default: true }),
      /content commitment closure/,
    );
  }
});

test('exact Fresh Recipe and Loadout authority rejects schema, commitment, Track, Output, Color, and Pack drift', () => {
  for (const [label, mutate, pattern] of [
    ['Recipe field set', (session) => {
      session.recipe.unapproved = true;
    }, /Recipe field set/],
    ['Recipe selection field set', (session) => {
      delete session.recipe.selections[0].defaultSwatchKey;
    }, /Recipe selection 0 field set/],
    ['Recipe Color field set', (session) => {
      delete session.recipe.colors[0].swatchKey;
    }, /Recipe Color 0 field set/],
    ['Loadout field set', (session) => {
      delete session.loadout.usedPacks;
    }, /Loadout field set/],
    ['Loadout selection swatch required', (session) => {
      delete session.loadout.selections[0].swatchKey;
    }, /Loadout selection 0 field set/],
    ['Loadout selection index required', (session) => {
      delete session.loadout.selections[0].selectionIndex;
    }, /Loadout selection 0 field set/],
    ['Loadout selection index exact', (session) => {
      session.loadout.selections[0].selectionIndex = 1;
    }, /selection index/],
    ['used Pack field set', (session) => {
      session.loadout.usedPacks.push({
        releaseId: `0x${'98'.repeat(32)}`,
        semanticPackId: 'bad-pack',
        unapproved: true,
      });
    }, /used Pack 0 field set/],
    ['Recipe schema', (session) => {
      session.recipe.schemaVersion = 'animacraft.maker-v8-player-recipe.v999';
      session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
    }, /Recipe or Loadout schema/],
    ['Loadout schema', (session) => {
      session.loadout.schemaVersion = 'animacraft.maker-v8-player-loadout.v999';
    }, /Recipe or Loadout schema/],
    ['Recipe commitment', (session) => {
      session.loadout.recipeCommitment = '0'.repeat(64);
    }, /Loadout Recipe commitment/],
    ['certified Style Track', (session) => {
      session.player.document.tracks.push({
        key: 'wrong-track', label: 'Wrong', renderOrder: 9, locked: false,
      });
      session.recipe.selections[0].trackKey = 'wrong-track';
      session.loadout.selections[0].trackKey = 'wrong-track';
      session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
    }, /selection authority binding/],
    ['Loadout Track', (session) => {
      session.loadout.selections[0].trackKey = 'wrong-track';
    }, /Loadout selection binding/],
    ['Recipe Output authority', (session) => {
      session.recipe.outputKey = 'unknown-output';
      session.loadout.outputKey = 'unknown-output';
      session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
    }, /Output binding/],
    ['Loadout Output', (session) => {
      session.loadout.outputKey = 'another-output';
    }, /Output binding/],
    ['Loadout Color', (session) => {
      session.loadout.selections[0].swatchKey = 'cool';
    }, /Loadout Color binding/],
    ['Loadout Pack', (session) => {
      session.loadout.usedPacks = [{
        releaseId: `0x${'99'.repeat(32)}`,
        semanticPackId: 'unselected-pack',
      }];
    }, /Loadout Pack binding/],
  ]) {
    const session = sessionFixture();
    mutate(session);
    assert.throws(
      () => projectMakerV8PlayerView(session, fullState(), { default: true }),
      pattern,
      label,
    );
  }
  assert.match(viewSource, /MAKER_V8_PLAYER_RECIPE_SCHEMA/);
  assert.match(viewSource, /MAKER_V8_PLAYER_LOADOUT_SCHEMA/);
  assert.match(viewSource, /makerV8PlayerRecipeCommitmentV8\(recipe\)/);
});

test('Player view accepts the exact Pack-owned Track without merging it into Root tracks', () => {
  const session = sessionFixture();
  const { choice, selection } = selectContextualChoice(session, 'PACK');
  choice.trackKey = selection.trackKey = session.loadout.selections[0].trackKey = 'pack-overlay';
  choice.definitionCommitment = 'ab'.repeat(32);
  choice.definitionScope = { track: { source: 'PACK', sourceId: choice.releaseId, key: 'pack-overlay' } };
  session.player.definitionContext = { rootId: session.player.rootId, address: session.player.contextualChoices.address,
    packs: [{ releaseId: choice.releaseId, semanticPackId: choice.semanticPackId, definitionCommitment: choice.definitionCommitment,
      ownedParts: [], rules: [],
      document: { tracks: [{ key: 'pack-overlay', renderOrder: 99 }] }, styleReferences: [{
        part: { scope: 'BASE', key: choice.partKey }, itemKey: choice.itemKey, styleKey: choice.styleKey,
        track: { scope: 'PACK_SELF', key: 'pack-overlay' },
      }] }] };
  session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
  assert.doesNotThrow(() => projectMakerV8PlayerView(session, fullState(), { default: true }));
  assert.equal(session.player.document.tracks.some(row => row.key === 'pack-overlay'), false);
  session.player.definitionContext.packs[0].definitionCommitment = 'cd'.repeat(32);
  assert.throws(() => projectMakerV8PlayerView(session, fullState(), { default: true }), /Track authority/);
  const pack = session.player.definitionContext.packs[0];
  pack.definitionCommitment = choice.definitionCommitment;
  const part = { key: 'plume', label: 'Plume', visible: true, menuOrder: 99, capacity: 1, required: false, items: [] };
  pack.document.parts = [part]; pack.ownedParts = [part];
  choice.partKey = selection.partKey = session.loadout.selections[0].partKey = 'plume';
  choice.definitionScope.part = { source: 'PACK', sourceId: choice.releaseId, key: 'plume' };
  pack.styleReferences[0].part = { scope: 'PACK_SELF', key: 'plume' };
  session.loadout.selections[0].selectionIndex = session.player.document.parts.reduce((sum, row) => sum + row.capacity, 0);
  session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
  assert.doesNotThrow(() => projectMakerV8PlayerView(session, fullState(), { default: true }), 'Scoped readback accepts the own-Part slot');
  const uiKey = `pack:${choice.releaseId}:plume`;
  const view = projectMakerV8PlayerView(session, fullState({ selectedPartKey: uiKey }), { default: true });
  assert.equal(view.selectedPartKey, uiKey);
  assert.equal(view.parts.find(row => row.key === uiKey).partKey, 'plume');
  assert.equal(view.parts.find(row => row.key === uiKey).choices[0].partKey, 'plume');
  assert.equal(view.parts.find(row => row.key === 'base').selections.length, 0);
  const html = renderApprovedMakerV8Player(view);
  assert.ok(html.includes(`data-part-id="${uiKey}"`));
  assert.ok(html.includes(`aria-labelledby="v4PlayerPartTab-${uiKey}"`));
  assert.equal(session.player.document.parts.some(row => row.key === 'plume'), false);
  pack.document.colors = [{ key: 'primary', label: 'Pack Primary', swatches: [
    { key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] },
    { key: 'blue', label: 'Blue', rgba: '#0000ffff', stops: [] },
  ] }];
  pack.styleReferences[0].color = { scope: 'PACK_SELF', key: 'primary' };
  for (const row of [choice, selection, session.loadout.selections[0]]) {
    row.colorChannelKey = 'primary'; row.defaultSwatchKey = 'red';
  }
  choice.definitionScope.color = { source: 'PACK', sourceId: choice.releaseId, key: 'primary' };
  session.recipe.colors = [{ releaseId: choice.releaseId, channelKey: 'primary', swatchKey: 'blue' }];
  session.loadout.selections[0].swatchKey = 'blue';
  session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);
  const colorView = projectMakerV8PlayerView(session, fullState({ selectedPartKey: uiKey, pickerPanel: 'colors' }), { default: true });
  const palette = renderApprovedMakerV8Player(colorView);
  assert.ok(palette.includes(`data-release-id="${choice.releaseId}"`));
  assert.match(palette, /data-swatch-id="blue"[^>]*aria-checked="true"/);
  session.loadout.selections[0].selectionIndex = 0;
  assert.throws(() => projectMakerV8PlayerView(session, fullState(), { default: true }), /selection index/);
});

test('selection authority closes Base, Pack, and External Track/Color/source/asset fields exactly', () => {
  const missingContextOwner = sessionFixture();
  delete missingContextOwner.player.contextualChoices.address;
  assert.throws(
    () => projectMakerV8PlayerView(missingContextOwner, fullState(), { default: true }),
    /contextual choices lack exact wallet and Root authority/,
  );

  const baseColor = sessionFixture();
  baseColor.recipe.selections[0].colorChannelKey = null;
  baseColor.recipe.selections[0].defaultSwatchKey = null;
  baseColor.loadout.selections[0].colorChannelKey = null;
  baseColor.loadout.selections[0].defaultSwatchKey = null;
  baseColor.loadout.selections[0].swatchKey = null;
  baseColor.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(baseColor.recipe);
  assert.throws(
    () => projectMakerV8PlayerView(baseColor, fullState(), { default: true }),
    /selection authority binding/,
  );

  const baseSource = sessionFixture();
  baseSource.recipe.selections[0].releaseId = `0x${'12'.repeat(32)}`;
  baseSource.recipe.selections[0].semanticPackId = 'forged-pack';
  baseSource.loadout.selections[0].releaseId = baseSource.recipe.selections[0].releaseId;
  baseSource.loadout.selections[0].semanticPackId = 'forged-pack';
  baseSource.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(baseSource.recipe);
  assert.throws(
    () => projectMakerV8PlayerView(baseSource, fullState(), { default: true }),
    /source authority/,
  );

  const pack = sessionFixture();
  selectContextualChoice(pack, 'PACK');
  pack.recipe.selections[0].semanticPackId = 'forged-pack';
  pack.loadout.selections[0].semanticPackId = 'forged-pack';
  pack.loadout.usedPacks[0].semanticPackId = 'forged-pack';
  pack.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(pack.recipe);
  assert.throws(
    () => projectMakerV8PlayerView(pack, fullState(), { default: true }),
    /selection authority binding/,
  );

  const incompletePack = sessionFixture();
  const { choice: incompleteChoice } = selectContextualChoice(incompletePack, 'PACK');
  delete incompleteChoice.defaultSwatchKey;
  assert.throws(
    () => projectMakerV8PlayerView(incompletePack, fullState(), { default: true }),
    /selection authority binding/,
  );

  const wrongChoiceLane = sessionFixture();
  const { choice: misplacedPack } = selectContextualChoice(wrongChoiceLane, 'PACK');
  wrongChoiceLane.player.contextualChoices.packStyles = [];
  wrongChoiceLane.player.contextualChoices.externalStyles = [misplacedPack];
  assert.throws(
    () => projectMakerV8PlayerView(wrongChoiceLane, fullState(), { default: true }),
    /selection authority binding/,
  );

  const external = sessionFixture();
  const { choice } = selectContextualChoice(external, 'EXTERNAL');
  choice.assetId = 'missing-external-asset';
  assert.throws(
    () => projectMakerV8PlayerView(external, fullState(), { default: true }),
    /selection asset authority/,
  );
});

test('Maker version closes through Player evidence and document lineage without a pseudo loadout revision', () => {
  const valid = sessionFixture();
  assert.equal(Object.hasOwn(valid.loadout, 'revision'), false);
  assert.doesNotThrow(() => projectMakerV8PlayerView(valid, fullState(), { default: true }));

  const evidenceDrift = sessionFixture();
  evidenceDrift.player.evidence.makerVersion = '2';
  assert.throws(
    () => projectMakerV8PlayerView(evidenceDrift, fullState(), { default: true }),
    /Maker version closure/,
  );

  const lineageDrift = sessionFixture();
  lineageDrift.player.document.lineage.version = 2;
  assert.throws(
    () => projectMakerV8PlayerView(lineageDrift, fullState(), { default: true }),
    /Maker version closure/,
  );
});

test('multi-capacity Parts retain every exact selection in projection and approved summaries', () => {
  const session = sessionFixture();
  const part = session.player.document.parts[0];
  part.capacity = 2;
  const secondItem = structuredClone(part.items[0]);
  secondItem.key = 'moon';
  secondItem.label = 'Moon';
  secondItem.defaultStyleKey = 'glow';
  secondItem.styles[0].key = 'glow';
  secondItem.styles[0].label = 'Glow';
  part.items.push(secondItem);
  const secondSelection = {
    source: 'BASE',
    partKey: part.key,
    itemKey: 'moon',
    styleKey: 'glow',
    trackKey: secondItem.styles[0].trackKey,
    colorChannelKey: secondItem.styles[0].colorChannelKey,
    defaultSwatchKey: secondItem.styles[0].defaultSwatchKey,
    releaseId: null,
    semanticPackId: null,
    externalProductId: null,
    ownedExternalItemId: null,
  };
  session.recipe.selections.push(secondSelection);
  session.loadout.selections.push({ selectionIndex: 1, ...secondSelection, swatchKey: 'warm' });
  session.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(session.recipe);

  const view = projectMakerV8PlayerView(session, fullState({ export: { open: false } }), {
    default: true,
  });
  assert.equal(view.parts[0].capacity, 2);
  assert.equal(view.parts[0].selections.length, 2);
  assert.deepEqual(view.parts[0].selections.map((entry) => entry.itemKey), [
    session.recipe.selections[0].itemKey,
    'moon',
  ]);
  const markup = renderApprovedMakerV8Player(view);
  assert.match(markup, /class="v4-player-item-grid" role="group"/);
  assert.match(markup, /data-choice-id="base:base:default:default"[^>]*aria-checked="true"/);
  assert.match(markup, /data-choice-id="base:base:moon:glow"[^>]*aria-checked="true"/);
  assert.match(markup, /data-choice-id="base:base:moon:glow"[^>]*role="checkbox"/);
  assert.match(markup, /Base: Default/);
  assert.match(markup, /Base: Moon/);

  const overCapacity = structuredClone(session);
  overCapacity.recipe.selections.push(structuredClone(secondSelection));
  overCapacity.loadout.selections.push({ selectionIndex: 2, ...secondSelection, swatchKey: 'warm' });
  overCapacity.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(overCapacity.recipe);
  assert.throws(
    () => projectMakerV8PlayerView(overCapacity, fullState(), { default: true }),
    /exceeds its exact Part capacity/,
  );
});

test('Pack quote confirmation preserves atomic precision, localization, and query-only recovery controls', () => {
  const session = sessionFixture();
  const choice = session.player.contextualChoices.packStyles[0];
  choice.entry = { kind: 1, priceAtomic: '9007199254740993', paymentCoinType: '0x2::token::TOKEN' };
  choice.access = { accessible: false, canEquip: false, availableForAcquire: true };
  const record = { actionId: 'ab'.repeat(32), status: 'PREPARED', packEntryQuote: {
    ...choice.entry, releaseId: choice.releaseId,
  } };
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const html = renderApprovedMakerV8Player(projectMakerV8PlayerView(session, {
      ...fullState(), locale,
      packAcquisition: { releaseId: choice.releaseId, record },
    }, { default: true }));
    assert.match(html, /9007199254740993/);
    assert.ok(html.includes(makerWorkspaceText(locale, 'playerPackEntryOnly')));
    assert.equal(actionCount(html, 'player-confirm-pack-v8'), 1);
    assert.equal(actionCount(html, 'player-recover-pack-v8'), 0);
  }
  for (const status of ['OUTCOME_UNKNOWN', 'FINALIZED_UNCERTIFIED', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND']) {
    const html = renderApprovedMakerV8Player(projectMakerV8PlayerView(session, {
      ...fullState(), packAcquisition: { releaseId: choice.releaseId,
        record: { ...record, status }, error: '<script>unsafe</script>' },
    }, { default: true }));
    assert.equal(actionCount(html, 'player-confirm-pack-v8'), 0);
    assert.equal(actionCount(html, 'player-recover-pack-v8'),
      ['FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(status) ? 0 : 1);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.ok(html.includes(status));
  }
});

test('contextual choices stay in the approved Part picker while Pack controls remain fail-closed', () => {
  assert.match(
    donorPlayerSurface,
    /const control = access\.accessible[\s\S]*?: access\.availableForAcquire \|\| access\.canRetryRuntime[\s\S]*?: `<button type="button" class="v4-player-expansion-unlock" disabled/,
  );
  assert.doesNotMatch(
    viewSource,
    /const actionControl = canEquip[\s\S]*?: canAcquire[\s\S]*?: `<button type="button" disabled/,
  );
  assert.match(
    viewSource,
    /let control = exactAccess\.accessible[\s\S]*?: exactAccess\.availableForAcquire \|\| exactAccess\.canRetryRuntime[\s\S]*?: `<button type="button" class="v4-player-expansion-unlock" disabled/,
  );

  const equippedSession = sessionFixture();
  const externalChoiceId = equippedSession.player.contextualChoices.externalStyles[0].id;
  const equipped = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    equippedSession,
    fullState({ pickerPanel: 'parts', export: { open: false } }),
    { default: true },
  ));
  assert.ok(equipped.includes(`data-choice-id="${externalChoiceId}"`));
  assert.match(equipped, /Hat · Blue/);
  assert.doesNotMatch(equipped, /player-composable-|data-product-id=/);

  const packSession = sessionFixture();
  const releaseId = packSession.player.contextualChoices.packStyles[0].releaseId;
  const accessiblePack = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    packSession,
    fullState({ pickerPanel: 'parts', export: { open: false } }),
    { default: true },
  ));
  const accessiblePackCard = articleByAttribute(accessiblePack, 'data-release-id', releaseId);
  assert.equal(actionCount(accessiblePackCard, 'player-expansion-v8'), 1);
  assert.equal(actionCount(accessiblePackCard, 'player-acquire-expansion-v8'), 0);

  const acquirePackSession = sessionFixture();
  acquirePackSession.player.contextualChoices.packStyles[0].access = {
    accessible: false, availableForAcquire: true,
  };
  const acquirePack = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    acquirePackSession,
    fullState({ pickerPanel: 'parts', export: { open: false } }),
    { default: true },
  ));
  const acquirePackCard = articleByAttribute(acquirePack, 'data-release-id', releaseId);
  assert.equal(actionCount(acquirePackCard, 'player-expansion-v8'), 0);
  assert.equal(actionCount(acquirePackCard, 'player-acquire-expansion-v8'), 1);

  const lockedPackSession = sessionFixture();
  lockedPackSession.player.contextualChoices.packStyles[0].access = {
    accessible: false, availableForAcquire: false,
  };
  const lockedPack = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    lockedPackSession,
    fullState({ pickerPanel: 'parts', export: { open: false } }),
    { default: true },
  ));
  const lockedPackCard = articleByAttribute(lockedPack, 'data-release-id', releaseId);
  assert.equal(actionCount(lockedPackCard, 'player-expansion-v8'), 0);
  assert.equal(actionCount(lockedPackCard, 'player-acquire-expansion-v8'), 0);
  assert.match(lockedPackCard, /v4-player-expansion-unlock" disabled aria-disabled="true"/);
});

test('component picker retains distinct releases and owned instances with identical item keys', () => {
  const session = sessionFixture();
  const choices = session.player.contextualChoices;
  choices.packStyles.push({ ...choices.packStyles[0],
    id: 'pack-second', releaseId: `0x${'12'.repeat(32)}`, semanticPackId: 'second-pack',
    label: 'Second pack same item',
  });
  choices.externalStyles.push({ ...choices.externalStyles[0],
    id: 'external-second-instance', ownedExternalItemId: `0x${'13'.repeat(32)}`,
    label: 'Second owned instance',
  }, { ...choices.externalStyles[0],
    id: 'external-other-product', externalProductId: `0x${'14'.repeat(32)}`,
    ownedExternalItemId: `0x${'15'.repeat(32)}`, label: 'Other product same item',
  });
  selectContextualChoice(session, 'EXTERNAL');
  const before = structuredClone(session);
  const markup = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    session, fullState({ pickerPanel: 'parts', export: { open: false },
      enabledPackReleaseIds: choices.packStyles.map(choice => choice.releaseId).sort() }), { default: true },
  ));
  const itemTags = formActionTags(markup).filter(tag => tag.includes('data-action="player-item"'));
  assert.equal(itemTags.length, 6, 'one Base, two Pack releases and three exact owned instances');
  for (const choice of [...choices.packStyles, ...choices.externalStyles]) {
    assert.ok(itemTags.some(tag => tag.includes(`data-choice-id="${choice.id}"`)), choice.id);
  }
  const reasonIds = itemTags.map(tag => tag.match(/aria-describedby="([^"]+)"/)[1]);
  assert.equal(new Set(reasonIds).size, 6, 'each component needs its own accessible reason');
  const styles = formActionTags(markup).filter(tag => tag.includes('data-action="player-style"'));
  assert.equal(styles.length, 1, 'unselected sibling products/instances must not leak into the selected style group');
  assert.ok(styles[0].includes(`data-choice-id="${choices.externalStyles[0].id}"`));
  assert.deepEqual(session, before, 'projection must not rewrite recipe or ownership');
});

test('full component slots explain the limit while selected components remain removable', () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'capacity' }));
  document.parts[0].capacity = 2;
  document.parts[0].items.push(...['second', 'third'].map(key => ({
    ...structuredClone(document.parts[0].items[0]), key, label: key,
  })));
  const player = createMakerV8LocalPlayer({ draftId: 'capacity', draftRevision: 1, document });
  const recipe = structuredClone(player.getSnapshot().recipe);
  recipe.selections.push({ ...recipe.selections[0], itemKey: 'second' });
  player.setRecipe(recipe, 0);
  const html = renderApprovedMakerV8Player(projectMakerV8LocalPlayerView(player.getSnapshot(),
    { locale: 'zh', selectedPartKey: 'base' }, { 'player-item': true, 'player-style': true }));
  const buttons = formActionTags(html).filter(tag => tag.includes('data-action="player-item"'));
  assert.match(buttons.find(tag => tag.includes('data-item-id="third"')), /disabled[^>]+此卡槽已满/);
  assert.doesNotMatch(buttons.find(tag => tag.includes('data-item-id="second"')), / disabled/);
  assert.match(html, /请先移除一个组件/);
});

test('unselected component exposes an available style even if its first style is blocked', () => {
  const session = sessionFixture();
  const first = session.player.contextualChoices.packStyles[0];
  first.access = { accessible: true, canEquip: false, reason: 'Style unavailable.' };
  const available = { ...first, id: 'pack-available-style', styleKey: 'available',
    access: { accessible: true, canEquip: true, reason: '' } };
  session.player.contextualChoices.packStyles.push(available);
  const markup = renderApprovedMakerV8Player(projectMakerV8PlayerView(session,
    fullState({ pickerPanel: 'parts', export: { open: false } }), { default: true }));
  const items = formActionTags(markup).filter(tag => tag.includes('data-action="player-item"'));
  const entry = items.find(tag => tag.includes(`data-choice-id="${available.id}"`));
  assert.ok(entry, 'the usable sibling style must have a reachable Item button');
  assert.doesNotMatch(entry, / disabled/);
  assert.equal(items.length, 3, 'styles of the same release/item remain one component');
});

test('component permission is explicit, explains blocked instances and permits safe removal', () => {
  const session = sessionFixture();
  const choice = session.player.contextualChoices.externalStyles[0];
  const render = (capabilities = { default: true }) => renderApprovedMakerV8Player(
    projectMakerV8PlayerView(session, fullState({ pickerPanel: 'parts', export: { open: false } }), capabilities),
  );
  const button = (markup) => formActionTags(markup).find(tag => (
    tag.includes('data-action="player-item"') && tag.includes(`data-choice-id="${choice.id}"`)
  ));
  delete choice.access;
  assert.match(button(render()), / disabled/, 'having an owned object ID is not equip permission');
  choice.access = { accessible: true, canEquip: false, reason: 'This instance is in another loadout.' };
  assert.match(button(render()), /disabled[^>]+This instance is in another loadout/);
  choice.access.canEquip = true;
  assert.doesNotMatch(button(render()), / disabled/);
  assert.match(button(render({ default: false })), / disabled/, 'availability never grants a missing host action');
  choice.access = { accessible: false, canEquip: true, reason: 'Admission was revoked.' };
  assert.match(button(render()), / disabled/, 'canEquip cannot override inaccessible content');

  selectContextualChoice(session, 'EXTERNAL');
  session.player.document.parts[0].required = false;
  session.player.document.parts[0].kind = 'STANDARD';
  assert.doesNotMatch(button(render()), / disabled/, 'selected optional component can be removed after revocation');
  assert.match(button(render({ default: false })), / disabled/, 'safe removal still needs the real host action');
  session.player.document.parts[0].required = true;
  assert.match(button(render()), / disabled/, 'required sole selection cannot be cleared');
});

test('public rule projection respects exact Pack scope and preserves access and host denials', () => {
  const session = sessionFixture();
  session.player.document.parts[0].capacity = 2;
  const choices = session.player.contextualChoices;
  const pack = choices.packStyles[0];
  const otherPack = { ...structuredClone(pack), id: 'other-pack',
    releaseId: `0x${'12'.repeat(32)}`, semanticPackId: 'other-pack' };
  choices.packStyles.push(otherPack);
  session.player.document.rules = [{ key: 'exact-pack-conflict', kind: 'EXCLUDE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null },
    targetMode: 'ANY',
    targets: [{ source: 'PACK', sourceKey: pack.semanticPackId, partKey: 'base', itemKey: pack.itemKey, styleKey: null }],
    payload: {},
  }];
  const external = choices.externalStyles[0];
  external.access = { accessible: false, canEquip: true, reason: 'Admission revoked.' };
  const before = structuredClone(session);
  const render = capabilities => renderApprovedMakerV8Player(projectMakerV8PlayerView(session,
    fullState({ pickerPanel: 'parts', export: { open: false },
      enabledPackReleaseIds: choices.packStyles.map(choice => choice.releaseId).sort() }), capabilities));
  const button = (html, id) => formActionTags(html).find(tag => tag.includes('data-action="player-item"')
    && tag.includes(`data-choice-id="${id}"`));
  let html = render({ default: true });
  assert.match(button(html, pack.id), /disabled[^>]+exact-pack-conflict/);
  assert.doesNotMatch(button(html, otherPack.id), / disabled/);
  assert.match(button(html, external.id), /disabled[^>]+Admission revoked/);
  html = render({ default: true, [`player-item:${otherPack.id}`]: { enabled: false, reason: 'Host unavailable.' } });
  assert.match(button(html, otherPack.id), /disabled[^>]+Host unavailable/);
  assert.deepEqual(session, before, 'neither recipe, contextual access nor ownership was rewritten');
});

test('envelope confirmation shows already-minted identity, exact gas and unchanged rights in five locales', () => {
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const view = projectMakerV8PlayerView(sessionFixture(), fullState({ locale,
      export: { open: true }, completionConfirmation: { id: 'envelopes-1', step: {
        kind: 'NATIVE_ENVELOPES', soulId: `0x${'1'.repeat(64)}`, stateId: `0x${'2'.repeat(64)}`,
        transactionDigest: '8'.repeat(43), gasBudgetMist: '9007199254740993', envelopeCount: 3,
      } },
    }), { default: true });
    const html = renderApprovedMakerV8Player(view);
    for (const key of ['playerStepEnvelopes', 'playerStepEnvelopesCopy', 'playerStepGasBudget']) {
      const translated = makerWorkspaceText(locale, key);
      assert.notEqual(translated, key); assert.ok(html.includes(translated), `${locale}:${key}`);
    }
    assert.match(html, /9007199254740993 MIST/);
    assert.match(html, /8888888888888888888888888888888888888888888/);
    assert.equal(actionCount(html, 'player-confirm-journey-step'), 1);
    assert.match(html, /data-action="player-confirm-complete"[^>]*disabled/);
  }
});

test('Complete confirmation shows exact fees, distinct quotas, rights and original action in five locales', () => {
  const session = sessionFixture();
  const quote = {
    paymentCoinType: '0x2::test::TEST', totalAmountAtomic: '9007199254741003',
    maker: { mode: 1, contentAmountAtomic: '0', fixedFeeAtomic: '7', amountAtomic: '7',
      priceAtomic: '9007199254740993', remainingFreeUses: '1', remainingTotalUses: '20' },
    packs: [{ mode: 2, releaseId: `0x${'55'.repeat(32)}`, semanticPackId: 'Moon Pack',
      contentAmountAtomic: '9007199254740996', priceAtomic: '9007199254740996', remainingTotalUses: null }],
    rights: { creator: `0x${'77'.repeat(32)}`, soulCreatorRoyaltyBps: '500', makerSourceRoyaltyBps: '250',
      makerResaleRoyaltyBps: '0', termsCommitment: null, evidenceLocator: '<script>unsafe</script>', commitment: 'a'.repeat(64) },
  };
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const view = projectMakerV8PlayerView(session, fullState({ locale,
      export: { open: true }, completionConfirmation: { id: 'step-2', step: {
        kind: 'PLAYER_ACTION', action: 'completeOutput', rootId: session.rootId,
        record: { completePaymentQuote: quote, actionId: 'exact-complete-action', transactionDigest: 'exact-digest' },
      } },
    }), { default: true });
    const html = renderApprovedMakerV8Player(view);
    for (const key of ['playerStepComplete', 'playerStepFreeRemaining', 'playerStepTotalRemaining',
      'playerStepRightsCopy', 'playerStepQuoteCopy', 'playerStepConfirm', 'playerStepCancel']) {
      assert.ok(html.includes(makerWorkspaceText(locale, key)), `${locale}:${key}`);
    }
    assert.match(html, /9007199254741003/);
    assert.match(html, /9007199254740993/);
    assert.match(html, /exact-complete-action/);
    assert.match(html, /exact-digest/);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.equal(actionCount(html, 'player-confirm-journey-step'), 1);
    assert.match(html, /data-action="player-confirm-complete"[^>]*disabled/);
  }
});

test('known entry access never labels an unquoted Complete as free in any locale', () => {
  const oldFreeLabel = { en: 'Free', zh: '免费', ja: '無料', ko: '무료', vi: 'Miễn phí' };
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const html = renderApprovedMakerV8Player(projectMakerV8PlayerView(
      sessionFixture(), fullState({ locale, export: { open: true } }), { default: true },
    ));
    for (const className of ['v4-player-commerce-summary', 'v4-player-commerce-quote']) {
      const region = html.match(new RegExp(`<section class="${className}"[\\s\\S]*?</section>`))?.[0];
      assert.ok(region, className);
      assert.ok(region.includes(makerWorkspaceText(locale, 'playerCommerceNotQuoted')));
      assert.ok(!region.includes(`>${oldFreeLabel[locale]}<`));
    }
  }
});

test('read-only upfront overview separates held and required entry, completion and network costs in five locales', () => {
  const session = sessionFixture();
  const coin = '0x2::test::TEST';
  const completePaymentQuote = { paymentCoinType: coin, totalAmountAtomic: '7',
    maker: { mode: 3, contentAmountAtomic: '0', fixedFeeAtomic: '7', remainingFreeUses: '2', remainingTotalUses: '19' },
    packs: [], rights: { creator: `0x${'77'.repeat(32)}`, soulCreatorRoyaltyBps: '500', makerSourceRoyaltyBps: '250',
      makerResaleRoyaltyBps: '0', termsCommitment: 'a'.repeat(64), evidenceLocator: '<img src=x>', commitment: 'b'.repeat(64) } };
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const html = renderApprovedMakerV8Player(projectMakerV8PlayerView(session, fullState({ locale,
      export: { open: true }, completionConfirmation: { id: 'overview-1', step: {
        kind: 'COMPLETION_OVERVIEW', rootId: session.rootId, overview: { completePaymentQuote,
          entryPaymentQuote: { paymentCoinType: coin, totalAmountAtomic: '9007199254740993',
            maker: { required: false, priceAtomic: '999999999999999999' },
            packs: [{ releaseId: `0x${'55'.repeat(32)}`, semanticPackId: '<Pack>', required: true, priceAtomic: '9007199254740993' }],
            baseItems: [{ partKey: 'base', itemKey: '<default>', required: true, priceAtomic: '0' }],
          }, totalBusinessAmountAtomic: '9007199254741000' },
      } },
    }), { default: true }));
    for (const key of ['playerOverviewTitle', 'playerOverviewEntry', 'playerOverviewComplete', 'playerOverviewTotal',
      'playerOverviewEntryNeeded', 'playerOverviewEntryHeld', 'playerOverviewCopy', 'playerOverviewContinue', 'playerOverviewRightsCopy']) {
      assert.ok(html.includes(makerWorkspaceText(locale, key)), `${locale}:${key}`);
    }
    assert.match(html, /9007199254740993/);
    assert.match(html, /9007199254741000/);
    assert.doesNotMatch(html, /999999999999999999|Action ID|Transaction digest/);
    assert.doesNotMatch(html, /<Pack>|<img src=x>/);
    assert.match(html, /&lt;Pack&gt;/);
    assert.match(html, /base \/ &lt;default&gt;/);
    assert.ok(html.includes(makerWorkspaceText(locale, 'playerStepBaseItem')));
    assert.equal(actionCount(html, 'player-confirm-journey-step'), 1);
    assert.ok(!html.includes(makerWorkspaceText(locale, 'playerStepConfirm')));
  }
});

test('unknown access and Pack boundaries fail closed in the donor-approved status regions', () => {
  const reason = 'Fresh bridge did not expose exact access state.';
  const unknownAccess = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    sessionFixture(),
    fullState({ makerAccess: null, capabilityReason: reason, export: { open: false } }),
    { default: true },
  ));
  assert.match(
    unknownAccess,
    new RegExp(`class="v4-player-commerce-summary"[\\s\\S]*?<small>${reason.replaceAll('.', '\\.')}`),
  );

  const packSession = sessionFixture();
  packSession.player.contextualChoices.packStyles[0].access = {
    accessible: false, availableForAcquire: false, reason,
  };
  const packBoundary = renderApprovedMakerV8Player(projectMakerV8PlayerView(
    packSession,
    fullState({ capabilityReason: reason, pickerPanel: 'parts', export: { open: false } }),
    { default: true },
  ));
  assert.match(
    packBoundary,
    new RegExp(`class="v4-player-commerce-error" role="status">${reason.replaceAll('.', '\\.')}`),
  );
});

test('missing host capabilities retain donor controls in place and fail closed with an explicit reason', () => {
  const reason = 'Fresh bridge did not expose this Player capability.';
  const view = projectMakerV8PlayerView(
    sessionFixture(),
    fullState({ capabilityReason: reason }),
    {},
  );
  const markup = renderApprovedMakerV8Player(view);

  for (const tag of formActionTags(markup)) {
    assert.match(tag, /\sdisabled(?:\s|>)/, tag);
    assert.match(tag, /aria-disabled="true"/, tag);
  }
  for (const action of [
    'player-item', 'player-style', 'player-palette',
    'player-profile-name', 'player-soul-document', 'player-export-recipe',
    'player-download-png', 'player-confirm-complete', 'player-select-recovery',
    'player-publish-recover',
  ]) {
    const tag = actionTag(markup, action);
    assert.match(tag, /disabled/);
    assert.match(tag, /title="[^"]+"/);
    if (action !== 'player-download-png') {
      assert.match(tag, new RegExp(reason.replaceAll('.', '\\.')));
    }
  }
  assert.equal(view.completeReady, false);
  assert.ok(view.boundaries.length >= 3);
  assert.equal(view.boundaries.every((boundary) => boundary.reason.length > 0), true);
});

test('view rejects incomplete bridge records and never exposes wallet, transaction, or transport behavior', () => {
  const session = sessionFixture();
  assert.throws(
    () => projectMakerV8PlayerView({ ...session, execution: null }),
    /execution state/,
  );
  assert.throws(
    () => projectMakerV8PlayerView({ ...session, recipe: null }),
    /exact recipe/,
  );
  assert.doesNotMatch(viewSource, /addEventListener|requestSignature|broadcastExactTransaction|fetch\(|XMLHttpRequest|Wallet Standard|listWardrobe/);
});
