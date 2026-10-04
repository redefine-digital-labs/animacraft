import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readApprovedUiDonor as donorFile } from './fixtures/approved-ui-donors/read-donor.mjs';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { prepareCreatorColorChange } from '../maker-v8-creator-colors.js';
import { MAKER_WORKSPACE_LOCALES, makerWorkspaceDictionary } from '../maker-workspace-i18n.js';
import {
  MAKER_V8_APPROVED_CREATOR_TABS,
  MAKER_V8_APPROVED_VIEW_SCHEMA,
  projectMakerV8WorkspaceView,
  renderApprovedMakerV8Workspace,
} from '../maker-workspace-v8-view.js';

test('chain version history distinguishes local snapshots and explicit archive in English and Chinese', () => {
  const document = createCharacterMakerV8Starter({ makerKey: 'version-view', name: 'Versioned' });
  for (const locale of ['en', 'zh']) {
    const view = projectMakerV8WorkspaceView(document, { locale, versionHistoryOpen: true,
      versionHistoryStatus: 'ready', versionEntries: [{ revision: 41 }],
      chainVersions: [{ rootId: `0x${'12'.repeat(32)}`, makerVersion: 1, lifecycle: 'ACTIVE', canManage: true }],
      chainVersionStatus: makerWorkspaceDictionary(locale).chainArchiveImpact }, { default: true });
    const html = renderApprovedMakerV8Workspace(view);
    assert.match(html, /chain-archive-review/); assert.match(html, /chain-archive-recover/);
    assert.match(html, /data-action="chain-successor"[^>]*disabled/);
    assert.ok(html.includes(makerWorkspaceDictionary(locale).chainHistory));
    assert.ok(html.includes(makerWorkspaceDictionary(locale).chainLocal));
    assert.ok(html.includes(makerWorkspaceDictionary(locale).chainArchiveImpact));
  }
});

test('publication modal constrains its scroll track on narrow screens', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.v4-chain-flow-backdrop \.v4-chain-flow\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/);
});

test('publication review exposes certified completion only and renders exact costs in every locale', () => {
  const document = createCharacterMakerV8Starter();
  for (const locale of MAKER_WORKSPACE_LOCALES) {
    const dictionary = makerWorkspaceDictionary(locale);
    const review = { reviewId: 'exact-step', scope: { draftId: 'draft', draftRevision: 1, signerAddress: 'wallet', contentSha256: 'hash' }, stage: 'SCAFFOLD', status: 'READY', nextAction: 'SIGN', rootId: 'unfinalized-root', makerVersion: 1,
      step: { gasBudgetMist: '123456789012345678', gasPriceMist: '1000', storageCostAtomic: null, relayTipMist: null, storageEpochs: 5, deletable: false } };
    const render = delta => renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
      { locale, publicationSigningEnabled: true, publicationBroadcastEnabled: true,
        publicationReview: { review: { ...review, ...delta }, busy: false } }, { default: true }));
    const html = render({});
    assert.ok(html.includes(dictionary.publicationUnknown));
    assert.ok(html.includes(dictionary.publicationGas));
    assert.match(html, /123456789012345678/);
    assert.doesNotMatch(html, /unfinalized-root|data-action="publication-open"/);
    assert.ok(!html.includes(dictionary.publicationComplete));
    const complete = render({ status: 'COMPLETE', nextAction: null });
    assert.match(complete, /unfinalized-root|data-action="publication-open"/);
    assert.ok(complete.includes(dictionary.publicationComplete));
  }
});

test('publication restores four-stage donor wizard without treating one Blob as all resources', () => {
  const review = { reviewId: 'exact', scope: { signerAddress: 'wallet', draftId: 'draft', draftRevision: 1, contentSha256: 'technical-hash' }, stage: 'ASSET', status: 'TRANSPORT_SIGNATURE_REQUIRED', nextAction: 'SIGN',
    progress: { completed: 1, total: 5, currentLabel: 'image.png' }, step: { stage: 'CERTIFY', digest: 'technical-digest', gasBudgetMist: '100' } };
  const html = render({ publicationSigningEnabled: true, publicationBroadcastEnabled: true, publicationReview: { review } });
  assert.match(html, /class="v4-modal-backdrop v4-chain-flow-backdrop"/);
  assert.match(html, /class="v4-chain-flow creator"/);
  assert.equal([...html.matchAll(/data-publication-stage="[1-4]"/g)].length, 4);
  assert.match(html, /data-publication-stage="3"[^>]*aria-current="step"/);
  assert.match(html, /1 \/ 5/);
  assert.doesNotMatch(html, /<li class="completed" data-publication-stage="[23]"/);
  assert.match(html, /<details[^>]*>[\s\S]*technical-hash[\s\S]*technical-digest[\s\S]*<\/details>/);
  assert.doesNotMatch(html, /[Qq]uilt/);
});

test('publication wizard recovers errors without a signature and confirms closing busy work', () => {
  const review = { reviewId: 'exact', scope: {}, stage: 'ASSET', status: 'READY', nextAction: 'SIGN', step: { stage: 'REGISTER' } };
  const html = render({ publicationSigningEnabled: true, publicationReview: { review,
    errorInfo: { code: 'WALLET_REJECTED', message: 'Rejected', diagnostic: '<private-error>' } } });
  assert.match(html, /v4-chain-error/);
  assert.match(html, /data-action="publication-copy-error"/);
  assert.match(html, /data-action="publication-refresh"/);
  assert.doesNotMatch(html, /data-action="publication-sign"|<private-error>/);
  const close = render({ publicationReview: { review, busy: true, closeConfirm: true } });
  assert.match(close, /v4-chain-flow-content" inert aria-hidden="true"/);
  assert.match(close, /role="alertdialog"/);
  assert.match(close, /data-action="publication-keep-open"/);
  assert.match(close, /data-action="publication-force-close"/);
});

test('publication wizard quotes only verified exact current-resource amounts in all five languages', () => {
  const quote = { verified: true, quotedAt: 1791040000000, relayTipMist: '987654321', walrusStorageCostFrost: '123456789012345678901',
    walrusWriteCostFrost: '7', walrusTotalCostFrost: '123456789012345678908' };
  for (const locale of MAKER_WORKSPACE_LOCALES) {
    const dictionary = makerWorkspaceDictionary(locale);
    const review = { reviewId: 'review', scope: {}, stage: 'ASSET', status: 'READY', nextAction: 'SIGN',
      progress: { completed: 1, total: 5, currentKind: 'ASSET', currentLabel: '<image>' }, step: { stage: 'REGISTER', quote } };
    const display = patch => render({ locale, publicationSigningEnabled: true, publicationReview: { review: { ...review, ...patch } } });
    const html = display({});
    assert.match(html, /123456789012345678901 FROST/);
    assert.match(html, /123456789012\.345678901 WAL/);
    assert.match(html, /0\.987654321 SUI/);
    assert.match(html, /<time datetime="2026-/);
    assert.match(html, /&lt;image&gt;/);
    assert.ok(html.includes(dictionary.publicationQuoteScope));
    assert.ok(html.includes(dictionary.publicationFlowCopy));
    assert.doesNotMatch(html, /Quilt|quilt|<image>/);
    const unverified = display({ step: { stage: 'REGISTER', quote: { ...quote, verified: false } } });
    assert.doesNotMatch(unverified, /123456789012345678901|987654321/);
    assert.ok(unverified.includes(dictionary.publishQuoteUnavailable));
    const partial = display({ step: { stage: 'REGISTER', quote: { verified: true, walrusWriteCostFrost: '0' } } });
    assert.match(partial, /0 FROST/);
    assert.ok(partial.includes(dictionary.publishQuoteUnavailable));
    const unsafeNumber = display({ step: { stage: 'REGISTER', quote: { verified: true, relayTipMist: 9007199254740992 } } });
    assert.doesNotMatch(unsafeNumber, /9007199254740992 MIST/);
  }
});

test('publication wizard requires total resource certification and certified Root for completion', () => {
  const review = { reviewId: 'review', scope: {}, stage: 'SCAFFOLD', status: 'READY', nextAction: 'SIGN',
    progress: { completed: 5, total: 5 }, step: { stage: 'SCAFFOLD', gasBudgetMist: '999' } };
  const display = patch => render({ publicationSigningEnabled: true, publicationReview: { review: { ...review, ...patch } } });
  const chain = display({});
  for (const n of [1, 2, 3]) assert.match(chain, new RegExp('<li class="completed" data-publication-stage="' + n + '"'));
  assert.match(chain, /<li class="current" data-publication-stage="4" aria-current="step"/);
  assert.doesNotMatch(chain, /v4-chain-published|WAL<\/small>|Waiting for quote/);
  assert.match(chain, /999/);
  const unknown = display({ progress: undefined });
  assert.doesNotMatch(unknown, /<li class="completed" data-publication-stage="[23]"/);
  assert.doesNotMatch(display({ status: 'COMPLETE', rootId: null }), /v4-chain-published|publication-open/);
  const complete = display({ status: 'COMPLETE', rootId: 'certified-root', makerVersion: 1 });
  assert.match(complete, /v4-chain-published/);
  assert.match(complete, /data-action="publication-open"/);
  assert.equal([...complete.matchAll(/<li class="completed" data-publication-stage=/g)].length, 4);
});

test('publication wizard uses the original step buttons and never signs failed or uncertain state', () => {
  const review = { reviewId: 'review', scope: {}, stage: 'ASSET', status: 'TRANSPORT_SIGNATURE_REQUIRED', nextAction: 'SIGN', step: { stage: 'REGISTER' } };
  const display = (patch, state = {}) => render({ publicationSigningEnabled: true, publicationBroadcastEnabled: true,
    publicationReview: { review: { ...review, ...patch }, ...state } });
  assert.match(display({}), />2\. Register &amp; upload<\/button>/);
  assert.match(display({ step: { stage: 'REGISTER', quote: { verified: true } } }), />Confirm this quote<\/button>/);
  assert.match(display({ step: { stage: 'CERTIFY' } }), />3\. Certify<\/button>/);
  assert.match(display({ stage: 'BASE_CHUNK', status: 'READY' }), />4\. Publish Maker<\/button>/);
  assert.match(display({ stage: 'BASE_CHUNK', status: 'READY' }), /Review in wallet<\/small>/);
  for (const status of ['FAILED', 'OUTCOME_UNKNOWN', 'OUTCOME_PENDING', 'UNKNOWN', undefined]) {
    assert.doesNotMatch(display({ status }), /data-action="publication-sign"/);
  }
  const continuation = display({ status: 'OUTCOME_UNKNOWN', nextAction: 'CONTINUE' });
  assert.match(continuation, /data-action="publication-continue"/);
  assert.match(continuation, /Continue upload \/ broadcast/);
  const duplicate = display({}, { errorInfo: { code: 'FAILED', message: 'One exact diagnostic', diagnostic: 'One exact diagnostic' } });
  assert.equal([...duplicate.matchAll(/One exact diagnostic/g)].length, 1);
});

test('external Product creation explains published-target prerequisites in every locale', () => {
  const document = createCharacterMakerV8Starter();
  for (const locale of MAKER_WORKSPACE_LOCALES) {
    for (const composableTargets of [null, { status: 'ready', makers: [] }]) {
      const html = renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
        { creatorTab: 'composable', locale, composableTargets }, { default: true }));
      assert.match(html, /data-composable-create-guidance>[^<]+<\/p>/);
      assert.match(html, /data-action="refresh-composable-makers"/);
      if (locale === 'en') assert.match(html, /A local draft is not a published target/);
      if (locale === 'zh') assert.match(html, /本地草稿不是已发布目标/);
    }
  }
});

test('Composable upload actions are stage-specific and execution-gated', () => {
  const document = createCharacterMakerV8Starter();
  const row = { uploadId: 'retained-upload', artworkRevision: 2, binding: { rootId: 'root', partKey: 'hat' },
    status: 'SIGNATURE_REQUIRED', stage: 'REGISTER' };
  const render = (enabled, delta = {}) => renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
    { creatorTab: 'composable', locale: 'en', composableUploadWriteEnabled: enabled,
      composableUploadHistory: { status: 'ready', rows: [{ ...row, ...delta }] } }, { default: true }));
  assert.match(render(false), /data-action="continue-composable-upload"[^>]*disabled/);
  assert.match(render(true), /Sign storage registration &amp; upload PNG/);
  assert.doesNotMatch(render(true), /data-action="continue-composable-upload"[^>]*disabled/);
  assert.match(render(true, { stage: 'CERTIFY' }), /Sign uploaded PNG certification/);
  assert.match(render(true, { status: 'RECOVERY_REQUIRED' }), /data-upload-action="RECOVER"/);
  assert.doesNotMatch(render(true, { status: 'COMPLETE', stage: 'COMPLETE' }), /data-action="continue-composable-upload"/);
});

test('Composable inventory distinguishes unread, empty, failed and real Product identities', () => {
  const document = createCharacterMakerV8Starter();
  const renderInventory = composableInventory => renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(
    document, { creatorTab: 'composable', locale: 'en', composableInventory }, { default: true }));
  assert.match(renderInventory(null), /Not loaded/);
  assert.match(renderInventory({ status: 'ready', products: [] }), /No controlled external Products/);
  const failed = renderInventory({ status: 'error', error: 'Network unavailable', products: [] });
  assert.match(failed, /Network unavailable/);
  assert.doesNotMatch(failed, /No controlled external Products/);
  assert.match(renderInventory({ status: 'ready', products: [{ id: 'product-1', rootId: 'root-1', makerKey: 'maker' }] }), /Product: product-1/);
});

test('external Product review uses Runtime PRODUCT_ACTIVE zero, not Maker ACTIVE one', async () => {
  const contract = await readFile(new URL('../move/animacraft_v8_runtime/sources/runtime_v8.move', import.meta.url), 'utf8');
  assert.match(contract, /const PRODUCT_ACTIVE: u8 = 0;/);
  const document = createCharacterMakerV8Starter();
  for (const lifecycle of [0, 1, 2]) {
    const html = renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
      { creatorTab: 'composable', composableInventory: { status: 'ready', products: [{ id: 'product', rootId: 'root', lifecycle }] } }, { default: true }));
    const button = html.match(/<button[^>]*data-action="review-composable-item"[^>]*>/)[0];
    assert.equal(button.includes('disabled'), lifecycle !== 0);
  }
});

test('saved Composable operations show certified lifecycle, owner and registry results only after completion', () => {
  const document = createCharacterMakerV8Starter();
  const row = { status: 'COMPLETE', request: { action: 'TRANSFER_CONTROL', requestId: 'transfer-one', product: { productId: 'product-one' }, payload: { recipient: 'new-owner' } },
    readback: { lifecycle: 2, owner: 'new-owner', controlEpoch: '4', packRegistryRevision: '9' } };
  const render = status => renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
    { creatorTab: 'composable', locale: 'en', composableOperations: { status: 'ready', rows: [{ ...row, status }] } }, { default: true }));
  assert.match(render('COMPLETE'), /Product state: Archived/);
  assert.match(render('COMPLETE'), /Controller: new-owner/);
  assert.match(render('COMPLETE'), /Control epoch: 4/);
  assert.match(render('COMPLETE'), /Admission revision: 9/);
  assert.doesNotMatch(render('ACTIVE'), /Product state: Archived|Controller: new-owner/);
});

test('Composable slot copy respects configurable capacity', () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.composition = { mode: 'COMPOSABLE', thirdPartyAdmission: 'OPEN', itemAssetization: true };
  document.parts[0].wardrobeMode = 'SLOT';
  document.parts[0].capacity = 2;
  const view = projectMakerV8WorkspaceView(document, { creatorTab: 'composable', locale: 'en' }, { default: true });
  const html = renderApprovedMakerV8Workspace(view);
  assert.match(html, /configured capacity/);
  assert.match(html, /value="2" data-action="part-capacity"/);
  assert.doesNotMatch(html, /capacity-one/);
});

test('background checkbox projects exact saved Part data, not temporary override state', () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.parts[0].exportBackground = true;
  const state = { draftId: 'background-draft', creatorDraftGeneration: 12, backgroundPartKeys: ['other'] };
  let view = projectMakerV8WorkspaceView(document, state, { default: true });
  assert.deepEqual(view.backgroundPartKeys, ['base']);
  const tag = renderApprovedMakerV8Workspace(view).match(/<input[^>]*data-action="part-export-background"[^>]*>/)[0];
  assert.match(tag, /checked/);
  assert.match(tag, /data-part-id="base"/);
  assert.match(tag, /data-review-draft="background-draft"/);
  assert.match(tag, /data-creator-generation="12"/);
  document.parts[0].exportBackground = false;
  view = projectMakerV8WorkspaceView(document, { ...state, backgroundPartKeys: ['base'] }, { default: true });
  assert.deepEqual(view.backgroundPartKeys, []);
});

test('visibility projection uses canonical Style data, labels and scoped controls instead of temporary overrides', () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'visibility' }));
  const target = structuredClone(document.parts[0]); target.key = 'accessory'; target.label = 'Accessory';
  target.kind = 'STANDARD'; target.required = false; document.parts.push(target);
  const style = document.parts[0].items[0].styles[0];
  style.visibleWhen = { op: 'not', condition: { op: 'selected', source: 'BASE', sourceKey: null,
    partKey: 'accessory', itemKey: 'default', styleKey: 'default' } };
  const state = { creatorTab: 'rules', rulesEditorIntent: 'visibility', draftId: 'draft-one', creatorDraftGeneration: 9,
    selectedPartKey: 'base', selectedItemKey: 'default', selectedStyleKey: 'default',
    styleVisibility: { 'base/default/default': null } };
  const view = projectMakerV8WorkspaceView(document, state, { default: true });
  assert.deepEqual(view.parts.find(part => part.key === 'base').items[0].styles[0].visibleWhen, style.visibleWhen);
  assert.deepEqual(view.ruleEditor.visibility.definitions, ['accessory::default::default']);
  assert.equal(view.ruleEditor.visibility.polarity, 'not-selected');
  const html = renderApprovedMakerV8Workspace(view);
  assert.match(html, /data-action="visibility-target-choice"[^>]*data-creator-generation="9"[^>]*data-visibility-draft="draft-one"[^>]*data-visibility-subject="base\/default\/default"/);
  assert.match(html, /value="accessory::default::default" checked/);
  assert.match(html, /Accessory \/ Default \/ Default/);
  assert.match(actionTag(html, 'apply-style-visibility'), /data-visibility-subject="base\/default\/default"/);
  const stale = projectMakerV8WorkspaceView(document, { ...state, ruleEditor: {
    visibilitySubject: 'accessory/default/default', visibility: { definitions: ['wrong'], logic: 'any', polarity: 'selected' },
  } }, { default: true });
  assert.deepEqual(stale.ruleEditor.visibility.definitions, ['accessory::default::default']);
});

test('advanced visibility is disclosed without pretending to be an editable flat condition', () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'advanced' }));
  const target = structuredClone(document.parts[0]); target.key = 'accessory'; target.kind = 'STANDARD'; target.required = false;
  document.parts.push(target);
  document.parts[0].items[0].styles[0].visibleWhen = { op: 'not', condition: { op: 'all', conditions: [{ op: 'selected',
    source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'default', styleKey: null }] } };
  const html = renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
    { creatorTab: 'rules', rulesEditorIntent: 'visibility' }, { default: true }));
  assert.match(html, /Advanced visibility condition/);
  assert.ok(html.includes(makerWorkspaceDictionary('en').visibilityAdvancedReplaceHelp));
  assert.doesNotMatch(html, /value="accessory::default" checked/);
  assert.doesNotMatch(actionTag(html, 'clear-style-visibility'), /disabled/);
});

test('Smart Color view protects shared whole-Style locks and the final preset, with explicit channel identities', () => {
  let document = prepareCreatorColorChange({ document: createCharacterMakerV8Starter({ makerKey: 'colors' }), action: 'add-channel' }).document;
  const channel = document.colors[0];
  const style = document.parts[0].items[0].styles[0];
  style.colorChannelKey = channel.key; style.defaultSwatchKey = channel.defaultSwatchKey;
  const render = () => renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document, { creatorTab: 'colors' }, { default: true }));
  let html = render();
  assert.match(html, /data-action="delete-swatch"[^>]*disabled/);
  assert.match(html, /data-action="channel-name"[^>]*data-channel-id="color-1"/);
  assert.doesNotMatch(html, /data-action="add-swatch"[^>]*disabled/);
  style.payload.animacraftEditor = { ...(style.payload.animacraftEditor || {}), styleLocked: true };
  html = render();
  for (const action of ['channel-name', 'delete-channel', 'add-swatch', 'swatch-name', 'swatch-hint', 'swatch-mid', 'swatch-stop', 'channel-default-swatch']) {
    assert.match(html, new RegExp(`data-action="${action}"[^>]*disabled`), action);
  }
  assert.doesNotMatch(html, /data-action="select-channel"[^>]*disabled/);
  assert.doesNotMatch(html, /data-action="add-channel"[^>]*disabled/);
});
const viewSource = await readFile(new URL('../maker-workspace-v8-view.js', import.meta.url), 'utf8');

test('version history copy names the existing storage retention in every supported locale', async () => {
  const storageSource = await readFile(new URL('../maker-v8-draft-store.js', import.meta.url), 'utf8');
  const limit = Number(storageSource.match(/const MAX_HISTORY = (\d+);/)?.[1]);
  assert.equal(limit, 100, 'matches the bounded-history persistence test');
  for (const locale of MAKER_WORKSPACE_LOCALES) {
    assert.match(makerWorkspaceDictionary(locale).versionHistoryCopy, new RegExp(`\\b${limit}`), locale);
  }
});

const donorWorkspace = donorFile('maker-workspace.js');
const donorDefinition = donorFile('maker-definition-editor.js');
const donorRuleControl = donorFile('maker-definition-rule-control.js');
const donorShell = donorFile('maker-editor-shell.js');
const donorI18nSource = donorFile('maker-workspace-i18n.js');
const donorLifecycleI18nUrl = `data:text/javascript;base64,${Buffer.from(donorFile('expansion-pack-lifecycle-i18n.js')).toString('base64')}`;
const donorI18nUrl = `data:text/javascript;base64,${Buffer.from(donorI18nSource.replace(
  './expansion-pack-lifecycle-i18n.js', donorLifecycleI18nUrl,
)).toString('base64')}`;
const donorI18n = await import(donorI18nUrl);
const donorText = (key, variables = {}) => donorI18n.makerWorkspaceText('en', key, variables);
const donorSources = [
  donorWorkspace, donorDefinition, donorRuleControl, donorShell, donorFile('index.html'),
].join('\n');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function starter() {
  return createCharacterMakerV8Starter({ makerKey: 'approved-demo', name: 'Approved Demo' });
}

function rulesFixture() {
  const document = structuredClone(starter());
  const part = structuredClone(document.parts[0]);
  part.key = 'accessory';
  part.label = 'Accessory';
  part.kind = 'STANDARD';
  part.renderOrder = 1;
  part.menuOrder = 1;
  part.required = false;
  part.items[0].key = 'hat';
  part.items[0].label = 'Hat';
  part.items[0].defaultStyleKey = 'cap';
  part.items[0].styles[0].key = 'cap';
  part.items[0].styles[0].label = 'Cap';
  part.items[0].styles[0].assetId = 'accessory-cap';
  document.parts.push(part);
  document.assets.push({ id: 'accessory-cap', kind: 'layer', mediaType: 'image/png', byteLength: 1 });
  document.rules.push({
    key: 'base-excludes-hat', kind: 'EXCLUDE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null },
    targetMode: 'ANY',
    targets: [{ source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'hat', styleKey: null }], payload: {},
  });
  return document;
}

function enabledCapabilities(overrides = {}) {
  return { default: true, controls: overrides };
}

function renderDocument(document, state = {}, capabilities = enabledCapabilities()) {
  return renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document, state, capabilities));
}

function render(state = {}, capabilities = enabledCapabilities()) {
  return renderDocument(starter(), state, capabilities);
}

function actionTag(markup, action) {
  const match = markup.match(new RegExp(`<[^>]+data-action="${action}"[^>]*>`));
  assert.ok(match, `Expected a ${action} control.`);
  return match[0];
}

function actionSet(markup) {
  return new Set([...markup.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]));
}

function classSet(markup) {
  return new Set([...markup.matchAll(/\bclass="([^"]*)"/g)]
    .flatMap((match) => match[1].split(/\s+/)).filter(Boolean));
}

function sorted(values) {
  return [...values].sort();
}

function toolBody(markup) {
  const start = markup.indexOf('<div class="v4-tool-body">');
  const end = markup.lastIndexOf('</div></section></div>');
  assert.ok(start >= 0 && end > start, 'Expected approved tool body.');
  return markup.slice(start, end);
}

function inspectorBody(markup) {
  const start = markup.indexOf('<aside class="v4-inspector">');
  const end = markup.indexOf('</aside>', start);
  assert.ok(start >= 0 && end > start, 'Expected approved inspector.');
  return markup.slice(start, end);
}

function formActionTags(markup) {
  return [...markup.matchAll(/<(?:button|input|select|textarea)\b[^>]*data-action="[^"]+"[^>]*>/g)]
    .map((match) => match[0]);
}

test('Review is a read-only action separate from publishing and Run again has its own capability', () => {
  const document = structuredClone(starter());
  document.livingContent.memoryMd = '';
  const capabilities = { default: false, controls: { 'review-preflight': true, 'run-preflight': true } };
  const html = renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document,
    { creatorTab: 'validate', draftId: 'exact-draft', creatorDraftGeneration: 7 }, capabilities));
  assert.doesNotMatch(actionTag(html, 'review-preflight'), /disabled/);
  assert.match(actionTag(html, 'review-preflight'), /data-review-draft="exact-draft" data-creator-generation="7"/);
  assert.doesNotMatch(actionTag(html, 'run-preflight'), /disabled/);
  assert.doesNotMatch(html, /data-action="publish"/);
  const blocked = renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(document));
  assert.match(actionTag(blocked, 'review-preflight'), /disabled/);
  const valid = renderApprovedMakerV8Workspace(projectMakerV8WorkspaceView(starter(), {}, capabilities));
  assert.match(actionTag(valid, 'publish'), /disabled/);
  assert.doesNotMatch(valid, /data-action="review-preflight"/);
});

test('Preflight includes every invalid Soul publication document while preserving editable drafts', () => {
  const document = structuredClone(starter());
  const original = structuredClone(document.livingContent);
  for (const [key, value] of [
    ['soulMd', '  \n'], ['memoryMd', ''], ['skillMd', '# Missing frontmatter'],
    ['memoryMd', '界'.repeat(21846)],
  ]) {
    document.livingContent = { ...structuredClone(original), [key]: value };
    const before = JSON.stringify(document);
    const view = projectMakerV8WorkspaceView(document, { creatorTab: 'validate' });
    const row = view.soul.documents.find(entry => entry.key === key);
    assert.equal(row.valid, false);
    assert.ok(view.issues.some(issue => issue.path === `livingContent.${key}` && issue.message === row.error));
    const html = renderApprovedMakerV8Workspace(view);
    assert.doesNotMatch(toolBody(html), /Ready to publish|All checks/);
    assert.match(toolBody(html), new RegExp(`livingContent\\.${key}`));
    assert.equal(JSON.stringify(document), before, 'preflight must not repair or reject draft text');
  }
  document.livingContent = { ...structuredClone(original), soulMd: '', memoryMd: '', skillMd: '# Invalid' };
  const invalid = projectMakerV8WorkspaceView(document);
  assert.deepEqual(invalid.issues.filter(issue => issue.path.startsWith('livingContent.')).map(issue => issue.path),
    ['livingContent.soulMd', 'livingContent.memoryMd', 'livingContent.skillMd']);
  const deduplicated = projectMakerV8WorkspaceView(document, { issues: invalid.issues });
  assert.deepEqual(deduplicated.issues, invalid.issues);
  document.livingContent = original;
  const valid = projectMakerV8WorkspaceView(document, { creatorTab: 'validate' });
  assert.equal(valid.issues.length, 0);
  assert.match(toolBody(renderApprovedMakerV8Workspace(valid)), /Ready to publish/);
});

test('projection is pure and carries donor UI state without weakening the Fresh-v8 document', () => {
  const document = structuredClone(starter());
  Object.assign(document.livingContent, { soulMd: '# Soul', memoryMd: '# Memory', skillMd: '# Skill' });
  Object.assign(document.metadata, { creator: 'Creator', style: 'Cel shading' });
  const before = JSON.stringify(document);
  const view = projectMakerV8WorkspaceView(document, {
    selectedPartKey: 'base', selectedItemKey: 'default', selectedStyleKey: 'default',
    assets: { 'base-default': { url: 'https://assets.example/base.png' } },
    styleLockedKeys: ['base/default/default'],
    makerInfo: { creator: 'Untrusted temporary override', style: 'Untrusted temporary override' },
    makerCover: { saveState: 'saved', message: donorText('makerCoverSaved') },
    soulConfiguration: { soulMd: 'Untrusted view override' },
    revision: 7,
  }, enabledCapabilities());

  assert.equal(JSON.stringify(document), before);
  assert.equal(view.schemaVersion, MAKER_V8_APPROVED_VIEW_SCHEMA);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(view.parts[0].items[0].styles[0].styleLocked, true);
  assert.equal(view.parts[0].items[0].styles[0].assetUrl, 'https://assets.example/base.png');
  assert.equal(view.makerInfo.creator, 'Creator');
  assert.equal(view.makerInfo.style, 'Cel shading');
  assert.deepEqual(view.soul.documents.map(({ key, content }) => ({ key, content })), [
    { key: 'soulMd', content: '# Soul' }, { key: 'memoryMd', content: '# Memory' },
    { key: 'skillMd', content: '# Skill' },
  ]);
});

test('approved tabs, toolbar order, titles, shell ARIA, and version busy rules match the donor', () => {
  const definitionRoutes = [...donorDefinition.matchAll(/makerRoute:\s*'([^']+)'/g)].map((match) => match[1]);
  const expectedTabs = [
    definitionRoutes[0], 'info', ...definitionRoutes.slice(1, 4), 'expansions',
    definitionRoutes[4], 'commerce', 'soul', 'validate',
  ];
  assert.deepEqual(MAKER_V8_APPROVED_CREATOR_TABS.map((tab) => tab.id), expectedTabs);

  const markup = render({
    canUndo: true, canRedo: false,
    assets: { 'base-default': 'https://assets.example/base.png' },
    lifecycle: { label: 'Active', manageLabel: 'Manage status', badgeClass: 'active' },
    versionHistoryOpen: true, versionHistoryStatus: 'restoring', restoringCheckpointRevision: 6,
    versionEntries: [
      { revision: 6, updatedAt: '2026-08-29T12:00:00.000Z', document: { metadata: { name: 'Earlier Demo' } } },
      { revision: 7, updatedAt: '2026-08-30T12:00:00.000Z', document: { metadata: { name: 'Approved Demo' } } },
    ], persistedRevision: 7,
  });
  assert.deepEqual(
    [...markup.matchAll(/<button[^>]*role="tab"[^>]*data-tab="([^"]+)"/g)].map((match) => match[1]),
    expectedTabs,
  );

  const donorToolbar = donorWorkspace.match(/const creatorActions = `([\s\S]*?)`;/)?.[1];
  const renderedToolbar = markup.match(/<div class="v4-top-actions">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(donorToolbar && renderedToolbar);
  assert.deepEqual(
    [...renderedToolbar.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    [...donorToolbar.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
  );
  assert.match(actionTag(markup, 'manage-lifecycle'), /aria-label="Manage status"/);
  assert.match(actionTag(markup, 'undo'), new RegExp(`title="${escapeHtml(donorText('undoHint'))}"`));
  assert.doesNotMatch(actionTag(markup, 'undo'), /\bdisabled\b/);
  assert.match(actionTag(markup, 'redo'), new RegExp(`disabled[^>]+title="${escapeHtml(donorText('redoUnavailable'))}"`));
  assert.match(actionTag(markup, 'save'), new RegExp(`title="${escapeHtml(donorText('saveHint'))}"`));
  assert.match(actionTag(markup, 'open-player'), new RegExp(`title="${escapeHtml(donorText('playerTestHint'))}"`));
  assert.match(markup, new RegExp(`<nav class="v4-studio-tabs" role="tablist" aria-label="${escapeHtml(donorText('makerToolsLabel'))}">`));
  assert.match(markup, /role="tab"[^>]+aria-selected="true"[^>]+aria-pressed="true"[^>]+tabindex="0"[^>]+aria-controls="makerV4ToolPanel"/);
  assert.match(markup, new RegExp(`<canvas id="makerV4CreatorCanvas" class="v4-runtime-canvas"[^>]+tabindex="0" aria-label="${escapeHtml(donorText('makerCanvasLabel'))}"><\/canvas>`));
  assert.match(markup, /class="v4-version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="makerVersionHistoryTitle"/);
  assert.match(actionTag(markup, 'restore-checkpoint'), /disabled aria-disabled="true"/);
  assert.match(markup, new RegExp(`data-action="restore-checkpoint"[^>]*>${escapeHtml(donorText('versionHistoryRestoring'))}<\\/button>`));
  assert.match(actionTag(markup, 'close-version-history'), /disabled aria-disabled="true"/);
});

test('inspector has the complete donor action signature, locks, positioning, blend, and visibility ARIA', () => {
  const normal = inspectorBody(render({ canUndo: true, canRedo: true }));
  const positioning = inspectorBody(render({
    canUndo: true, canRedo: true, unconfirmedPositionStyleKeys: ['base/default/default'],
  }));
  const actual = actionSet(`${normal}${positioning}`);
  const expected = new Set([
    'part-name', 'part-required', 'part-visible', 'part-export-background', 'part-default',
    'edit-selection-rules', 'part-icon', 'item-name', 'item-thumbnail', 'style-name',
    'set-default-style', 'style-position-locked', 'style-locked', 'style-asset',
    'confirm-position', 'edit-position', 'style-x', 'style-y', 'style-scale',
    'style-rotation', 'style-scale-preview', 'style-opacity', 'style-blend',
    'style-channel', 'edit-style-visibility', 'clear-style-visibility', 'toggle-style-hidden',
  ]);
  assert.deepEqual(sorted(actual), sorted(expected));
  const donorStart = donorWorkspace.indexOf('  renderCreatorInspector(');
  const donorInspector = donorWorkspace.slice(donorStart, donorWorkspace.indexOf('  renderCreatorAdvanced(', donorStart));
  for (const action of expected) {
    assert.ok(donorInspector.includes(`data-action="${action}"`) || donorRuleControl.includes(`action = '${action}'`), `Donor must authorize ${action}.`);
  }
  assert.equal((normal.match(/data-shared-definition-rule-control/g) || []).length, 3);
  for (const mode of [
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity', 'linear-dodge',
  ]) assert.ok(normal.includes(`<option value="${mode}"`), mode);
  assert.match(normal, /class="v4-visibility-summary"/);

  const locked = inspectorBody(render({ styleLockedKeys: ['base/default/default'] }));
  assert.match(actionTag(locked, 'style-position-locked'), /disabled aria-disabled="true"/);
  assert.match(actionTag(locked, 'style-asset'), /disabled aria-disabled="true"/);
  assert.match(actionTag(locked, 'style-x'), /readonly aria-readonly="true"/);
  assert.match(actionTag(locked, 'edit-style-visibility'), /disabled aria-disabled="true"/);
});

test('canonical Part and Style triggers render their exact selection level without legacy references', () => {
  for (const level of ['part', 'style']) {
    const document = rulesFixture();
    document.rules[0].trigger = { source: level === 'part' ? 'ANY' : 'BASE', sourceKey: null, partKey: 'base', itemKey: level === 'part' ? null : 'default', styleKey: level === 'part' ? null : 'default' };
    const markup = renderDocument(document, { creatorTab: 'rules' });
    const owner = markup.match(/class="v4-rule-summary-owner">([\s\S]*?)<\/div>/)[1];
    assert.ok(owner.includes(level === 'part' ? '[ANY]' : '[BASE]'));
    assert.ok(owner.includes(escapeHtml(donorText(level === 'part' ? 'ruleTargetPart' : 'ruleTargetStyle'))));
    assert.doesNotMatch(owner, /undefined|null/);
    assert.doesNotThrow(() => renderDocument(document, { creatorTab: 'parts' }));
  }
});

test('ANY alternatives remain one group and one whole-rule delete action', () => {
  const document = rulesFixture();
  const other = structuredClone(document.parts[1].items[0].styles[0]);
  other.key = 'brim'; other.label = 'Brim';
  document.parts[1].items[0].styles.push(other);
  const rule = document.rules[0];
  rule.kind = 'REQUIRE';
  rule.targets = ['cap', 'brim'].map(styleKey => ({ source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'hat', styleKey }));
  const markup = renderDocument(document, { creatorTab: 'rules' });
  assert.ok(markup.includes(escapeHtml(donorText('ruleAnyTargets'))));
  assert.ok(markup.includes('[BASE] Accessory / Hat / Cap'));
  assert.ok(markup.includes('[BASE] Accessory / Hat / Brim'));
  assert.equal((markup.match(/data-rule-summary-row/g) || []).length, 1);
  assert.equal((markup.match(/data-action="delete-rule"/g) || []).length, 1);
  assert.match(markup, /data-action="delete-rule" data-rule-id="base-excludes-hat"/);
  rule.targetMode = 'ALL';
  assert.ok(renderDocument(document, { creatorTab: 'rules' }).includes(escapeHtml(donorText('ruleAllTargets'))));
});

test('EXCLUDE list identifies all forbidden targets and retains one grouped deletion', () => {
  const document = rulesFixture();
  document.rules[0].targets.push({ source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'hat', styleKey: 'cap' });
  const markup = renderDocument(document, { creatorTab: 'rules' });
  assert.ok(markup.includes(escapeHtml(donorText('ruleNotBadge'))));
  assert.ok(markup.includes(`${escapeHtml(donorText('ruleConflictShort'))} (ANY)`));
  assert.ok(markup.includes('[BASE] Accessory / Hat · Item'));
  assert.ok(markup.includes('[BASE] Accessory / Hat / Cap · Style'));
  assert.equal((markup.match(/data-action="delete-rule"/g) || []).length, 1);
});

test('selector scopes distinguish local and remote namesakes without adding source picker controls', () => {
  const document = rulesFixture();
  document.rules[0].targets.push(
    { source: 'PACK', sourceKey: 'hat-pack', partKey: 'accessory', itemKey: 'hat', styleKey: 'cap' },
    { source: 'EXTERNAL', sourceKey: `0x${'ab'.repeat(32)}`, partKey: 'accessory', itemKey: 'hat', styleKey: 'cap' },
  );
  const markup = renderDocument(document, { creatorTab: 'rules' });
  assert.ok(markup.includes('[BASE] Accessory / Hat'));
  assert.ok(markup.includes('[PACK: hat-pack] Accessory / hat / cap'));
  assert.ok(markup.includes(`[EXTERNAL: 0x${'ab'.repeat(32)}] Accessory / hat / cap`));
  assert.doesNotMatch(markup, /<option[^>]+value="(?:PACK|EXTERNAL)"/);
});

test('Rules restores both approved editors with a bidirectional action/class/role/ARIA signature', () => {
  const markup = renderDocument(rulesFixture(), {
    creatorTab: 'rules', selectedPartKey: 'base', selectedItemKey: 'default', selectedStyleKey: 'default',
    ruleBuilderDraft: {
      ownerDefinition: 'base::default', type: 'requires', matchMode: 'any',
      definitions: ['accessory::hat'],
    },
    visibilityBuilderDraft: {
      logic: 'all', polarity: 'selected', definitions: ['accessory::hat::cap'],
    },
  });
  const body = toolBody(markup);
  const expected = new Set([
    'rules-editor-intent', 'rule-owner-search', 'rule-owner-choice', 'rule-type-choice',
    'rule-match-choice', 'rule-target-search', 'rule-target-choice', 'add-rule', 'delete-rule',
    'visibility-match-choice', 'visibility-polarity-choice', 'visibility-target-search',
    'visibility-target-choice', 'apply-style-visibility', 'clear-style-visibility',
  ]);
  assert.deepEqual(sorted(actionSet(body)), sorted(expected));
  for (const className of [
    'v4-rule-intents', 'v4-rule-editor-panel', 'v4-rule-builder', 'v4-rule-owner-picker',
    'v4-rule-type-picker', 'v4-rule-target-picker', 'v4-rule-target-tree', 'v4-rule-list',
    'v4-visibility-current', 'v4-visibility-builder', 'v4-visibility-footer', 'v4-visibility-preview',
  ]) {
    assert.ok(body.includes(className), className);
    assert.ok(donorSources.includes(className), `Donor must own ${className}.`);
  }
  assert.match(body, /class="v4-rule-intents" role="tablist" aria-label="Rules"/);
  assert.match(body, /id="v4RuleAvailabilityTab"[^>]+role="tab" aria-controls="v4RuleAvailabilityPanel" aria-selected="true" tabindex="0"/);
  assert.match(body, /id="v4RuleVisibilityTab"[^>]+role="tab" aria-controls="v4RuleVisibilityPanel" aria-selected="false" tabindex="-1"/);
  assert.match(body, /id="v4RuleAvailabilityPanel" class="v4-rule-editor-panel" role="tabpanel" aria-labelledby="v4RuleAvailabilityTab"/);
  assert.match(body, /id="v4RuleVisibilityPanel" class="v4-rule-editor-panel" role="tabpanel" aria-labelledby="v4RuleVisibilityTab"/);
  assert.match(body, /class="v4-visibility-preview" aria-live="polite"/);
});

test('Soul, Commerce, Expansion Packs, and Maker Info preserve donor signatures and copy', () => {
  const soul = toolBody(render({
    creatorTab: 'soul', selectedSoulDocumentKey: 'memoryMd',
    soulConfiguration: { soulMd: '# Soul', memoryMd: '# Memory', skillMd: '# Skill' },
  }));
  assert.deepEqual(sorted(actionSet(soul)), sorted(new Set([
    'reset-all-soul', 'select-soul-document', 'reset-soul-document', 'soul-document-content',
  ])));
  assert.equal((soul.match(/data-action="select-soul-document"/g) || []).length, 3);
  for (const filename of ['soul.md', 'memory.md', 'SKILL.md']) assert.ok(soul.includes(filename));
  assert.match(soul, /class="v4-soul-document-list" aria-label="Soul Configuration"/);
  assert.match(soul, /data-action="select-soul-document"[^>]+aria-pressed="true"/);
  assert.match(soul, /data-action="soul-document-content"[^>]+aria-label="memory.md"/);

  const pack = {
    key: 'pack-one', packId: 'pack-one', name: 'Pack One', namespace: 'pack', version: 'v1',
    revision: 3, publishable: true, parentBindingIdentity: 'binding-one',
    lifecycle: { badgeClass: 'active', label: 'Active' },
    commerce: { accessMode: 'PAID_ONCE', priceDecimal: '1.25' },
    packPolicy: {
      accessMode: 'ONE_TIME_PAID', purchasePriceAtomic: 1_250_000,
      completion: { mode: 'FREE_QUOTA_THEN_PAID', freeQuotaPerWallet: 2, priceAtomic: 500_000, totalCap: 10 },
    },
  };
  const expansions = toolBody(render({ creatorTab: 'expansions', expansionPacks: [pack] }));
  assert.deepEqual(sorted(actionSet(expansions)), sorted(new Set([
    'add-expansion', 'open-expansion-pack-studio', 'manage-expansion-pack-lifecycle',
  ])));
  assert.match(expansions, /data-pack-project-key="pack-one" data-pack-chain-only="false"/);
  assert.match(expansions, /data-pack-lifecycle-badge>Active/);
  assert.match(actionTag(expansions, 'manage-expansion-pack-lifecycle'), /aria-label="Manage lifecycle for Pack One"/);

  const commerce = toolBody(render({
    creatorTab: 'commerce', expansionPacks: [pack], commerceCanWithdrawRightsConfirmation: true,
    commerceProtocol: { enabled: true, primaryContentFeeBps: 1_000, fixedCompleteFeeAtomic: 250_000 },
  }));
  assert.deepEqual(sorted(actionSet(commerce)), sorted(new Set([
    'commerce-rights-origin', 'withdraw-legacy-rights-confirmation', 'commerce-maker-access',
    'commerce-maker-access-price', 'commerce-base-complete-mode', 'commerce-base-complete-quota',
    'commerce-base-complete-price', 'commerce-base-complete-cap', 'independent-pack-commerce',
    'commerce-pack-access', 'commerce-pack-price', 'commerce-pack-complete-mode',
    'commerce-pack-complete-quota', 'commerce-pack-complete-price', 'commerce-pack-complete-cap',
    'commerce-soul-creator-royalty', 'commerce-maker-source-royalty', 'commerce-maker-resale-royalty',
  ])));
  assert.equal((commerce.match(/class="v4-commerce-section"/g) || []).length, 4);
  assert.ok(commerce.includes('<em>0–5%</em>'));
  assert.ok(commerce.includes('class="v4-commerce-protocol"'));
  assert.ok(commerce.includes(escapeHtml(donorText('primarySplitValue', { maker: 90, protocol: 10 }))));
  assert.equal((commerce.match(/<option value="(?:0|50|100|150|200|250|300|350|400|450|500)"/g) || []).length, 33);

  const infoDocument = structuredClone(starter());
  Object.assign(infoDocument.metadata, { name: 'A'.repeat(129), creator: 'Creator', style: 'Cel shading' });
  const info = toolBody(renderDocument(infoDocument, {
    creatorTab: 'info',
    makerCover: { saveState: 'saved', message: donorText('makerCoverSaved') },
  }));
  assert.deepEqual(sorted(actionSet(info)), sorted(new Set([
    'maker-cover', 'remove-maker-cover', 'maker-name', 'maker-creator', 'maker-summary',
    'maker-style', 'maker-license-kind', 'maker-license-note',
  ])));
  assert.match(actionTag(info, 'maker-name'), /aria-describedby="makerInfoBytes-maker-name" aria-invalid="true"/);
  assert.match(info, /id="makerInfoBytes-maker-name" data-maker-byte-status="maker-name" class="v4-maker-info-byte-status invalid"/);
  assert.ok(info.includes(escapeHtml(donorText('makerInfoByteExceeded', { over: 1 }))));
  assert.match(info, /class="v4-maker-cover-save-status saved" role="status" aria-live="polite"/);
});

test('all actionable form controls remain fail-closed unless the host grants capability', () => {
  const states = [
    { creatorTab: 'structure', unconfirmedPositionStyleKeys: ['base/default/default'] },
    { creatorTab: 'info' }, { creatorTab: 'layers' }, { creatorTab: 'colors' },
    { creatorTab: 'rules', ruleBuilderDraft: { type: 'requires' } },
    { creatorTab: 'expansions', expansionPacks: [{ key: 'p', packId: 'p', name: 'Pack' }] },
    { creatorTab: 'composable' }, { creatorTab: 'commerce' }, { creatorTab: 'soul' },
    { creatorTab: 'validate' },
  ];
  const closed = states.map((state) => renderDocument(
    state.creatorTab === 'rules' ? rulesFixture() : starter(),
    { ...state, versionHistoryOpen: true, versionHistoryStatus: 'ready' }, {},
  )).join('\n');
  const controls = formActionTags(closed);
  assert.ok(controls.length > 100);
  controls.forEach((tag) => assert.match(tag, /\bdisabled\b/, tag));

  const selective = render({ canUndo: true }, {
    default: false,
    controls: {
      save: true, undo: true, 'edit-selection-rules:base': true,
      'select-item:base/default': true,
      'open-player': { enabled: false, reason: 'Player adapter pending' },
    },
  });
  assert.doesNotMatch(actionTag(selective, 'save'), /\bdisabled\b/);
  assert.doesNotMatch(actionTag(selective, 'undo'), /\bdisabled\b/);
  assert.doesNotMatch(actionTag(selective, 'edit-selection-rules'), /\bdisabled\b/);
  assert.doesNotMatch(actionTag(selective, 'select-item'), /\bdisabled\b/);
  assert.match(actionTag(selective, 'open-player'), /disabled aria-disabled="true"/);
});

test('renderer uses only donor classes/copy helpers and forbids rejected replacement UI', () => {
  const document = rulesFixture();
  const rendered = MAKER_V8_APPROVED_CREATOR_TABS.map((tab) => renderDocument(document, {
    creatorTab: tab.id, canUndo: true, canRedo: true,
    expansionPacks: [{ key: 'p', packId: 'p', name: 'Pack' }],
    versionHistoryOpen: true, versionHistoryStatus: 'ready',
    versionEntries: [{ revision: 1, updatedAt: '2026-08-30T00:00:00.000Z' }],
    persistedRevision: 1,
  })).join('\n');
  for (const className of classSet(rendered)) {
    assert.ok(donorSources.includes(className), `Renderer introduced non-donor class ${className}.`);
  }
  for (const forbidden of [
    'Seal protected', '0–10%', 'data-action="select-output"', 'data-action="add-output"',
    'data-action="edit-output"', 'data-action="delete-output"', 'data-fresh-v8-field="outputs"',
    'data-action="open-combination-rules"', 'data-action="open-item-rules"',
    'Fresh-v8 extends the approved', 'Fresh-v8 additive outputs',
  ]) assert.ok(!viewSource.includes(forbidden), `Rejected replacement UI is forbidden: ${forbidden}`);
  assert.doesNotMatch(toolBody(render({ creatorTab: 'soul' })), /\bOutputs?\b|data-output-id|allowedPackPolicy/);
});

test('view imports only current authority and hash-exact approved pure donor helpers', async () => {
  // Original Creator copy stays exact except F10 retention and S6-F01 capacity copy.
  const capacityCopy = {
    en: ['Enable the Soul wardrobe, then choose which Parts become equipment Slots and configure their capacities. Every old or new Part stays fixed until you opt it in.', 'Equipment Slot with the configured capacity; required Slots must keep one included fallback.'],
    zh: ['先启用 Soul 衣柜，再选择装备卡槽部位并设置容量。旧部位和新建部位默认都保持固定。', '装备卡槽使用设置的容量；必选卡槽必须保留一个内置兜底样式。'],
    ja: ['Soul Wardrobe を有効にしてから、装備 Slot にする Part を選び、容量を設定します。既存・新規 Part は既定で固定です。', '設定した容量の装備 Slot。必須 Slot には同梱 fallback が必要です。'],
    ko: ['Soul 옷장을 켠 뒤 장비 Slot으로 만들 Part를 선택하고 용량을 설정합니다. 기존 Part와 새 Part는 기본적으로 고정됩니다.', '설정한 용량의 장비 Slot이며 필수 Slot에는 포함 fallback이 필요합니다.'],
    vi: ['Bật tủ đồ Soul rồi chọn Part làm Slot trang bị và đặt sức chứa. Part cũ và Part mới mặc định vẫn cố định.', 'Slot trang bị dùng sức chứa đã đặt; Slot bắt buộc phải có fallback tích hợp.'],
  };
  // Player entry/Complete replaces the misleading Free label and adds these keys.
  const playerAdditions = [
    'playerPackPaid', 'playerPackTransactionFinalized', 'playerPackAtomicUnits', 'playerPackEntryOnly',
    'playerPackConfirm', 'playerPackRecover', 'playerPackDismiss', 'playerCommerceNotQuoted',
    'playerStepMakerAccess', 'playerStepPackAccess', 'playerStepStartAnother', 'playerStepOpenSoul',
    'playerStepStartAnotherCopy', 'playerStepRecoveredOtherDraft', 'playerStepBaseItem', 'playerStepLoadout',
    'playerStepComplete', 'playerStepRenderUpload', 'playerStepNativeUpload', 'playerStepConfirm',
    'playerStepEnvelopes', 'playerStepEnvelopesCopy', 'playerStepGasBudget',
    'playerEnvelopeRecoveryExport', 'playerEnvelopeRecoveryImport', 'playerEnvelopeRecoveryCopy',
    'playerEnvelopeRecoveryClear',
    'playerStepCancel', 'playerStepCancelCopy', 'playerStepStorageCopy', 'playerStepEntryCopy',
    'playerStepNoBusinessFee', 'playerStepFreeRemaining', 'playerStepTotalRemaining', 'playerStepPolicyPrice',
    'playerStepRightsCopy', 'playerStepQuoteCopy', 'playerOverviewTitle', 'playerOverviewEntry',
    'playerOverviewComplete', 'playerOverviewTotal', 'playerOverviewEntryNeeded', 'playerOverviewEntryHeld',
    'playerOverviewContinue', 'playerOverviewCopy', 'playerOverviewRightsCopy', 'playerSlotCapacityFull',
    'saveRecoveryCopy', 'saveRecoveryCopyHint', 'savingRecoveryCopy', 'localRecoveryCopy',
    'recoveryCopyRetry', 'playerOutputSelection',
    'publicationReview', 'publicationCopy', 'publicationSign', 'publicationContinue', 'publicationRefresh',
    'publicationUnknown', 'publicationGas', 'publicationStorage', 'publicationRelay', 'publicationTerms',
    'publicationWallet', 'publicationStage', 'publicationAssets', 'publicationStale', 'publicationUnavailable',
    'publicationComplete', 'publicationLoading',
    'publicationEarlier', 'publicationGasPrice',
    'publicationOpen',
    'publicationFlowCopy', 'publicationResourceProgress', 'publicationQuoteScope', 'publicationRecoveryCopy', 'publicationInProgress',
    'chainHistory', 'chainCopy', 'chainLocal', 'chainCurrentUnpublished', 'chainNext', 'chainRevisions',
    'chainArchiveReview', 'chainArchiveSign', 'chainArchiveRecover', 'chainSuccessor', 'chainArchiveDigest',
    'chainLoading', 'chainUnavailable', 'chainEmpty', 'chainPreparing', 'chainArchiveImpact', 'chainArchiveSaved', 'chainSuccessorReady',
  ].sort();
  assert.deepEqual(MAKER_WORKSPACE_LOCALES, donorI18n.MAKER_WORKSPACE_LOCALES);
  for (const locale of MAKER_WORKSPACE_LOCALES) {
    const original = donorI18n.makerWorkspaceDictionary(locale);
    const current = makerWorkspaceDictionary(locale);
    assert.deepEqual(Object.keys(original).filter(key => !Object.hasOwn(current, key)), ['playerCommerceFree']);
    assert.deepEqual(Object.keys(current).filter(key => !Object.hasOwn(original, key)).sort(), playerAdditions);
    for (const [key, value] of Object.entries(original)) {
      const approvedCopy = {
        versionHistoryCopy: original.versionHistoryCopy.replace('20', '100'),
        wardrobeSetupCopy: capacityCopy[locale][0],
        wardrobePartSlotCopy: capacityCopy[locale][1],
      };
      if (key !== 'playerCommerceFree') assert.equal(current[key],
        Object.hasOwn(approvedCopy, key) ? approvedCopy[key] : value, `${locale}:${key}`);
    }
    for (const key of playerAdditions) assert.equal(typeof current[key] === 'string' && current[key].length > 0, true, `${locale}:${key}`);
  }
  assert.equal(donorRuleControl, await readFile(new URL('../maker-definition-rule-control.js', import.meta.url), 'utf8'));
  assert.equal(donorShell, await readFile(new URL('../maker-editor-shell.js', import.meta.url), 'utf8'));
  const imports = [...viewSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imports, [
    './maker-v8-document.js', './maker-v8-living-content.js', './maker-v8-creator-style.js', './maker-v8-creator-colors.js', './maker-v8-visibility.js', './maker-v8-creator-tracks.js', './maker-v8-render-core.js', './maker-definition-editor.js',
    './maker-definition-rule-control.js', './maker-workspace-i18n.js',
  ]);
  assert.doesNotMatch(viewSource, /from\s+['"][^'"]*(?:chain|transport|transaction|legacy|json-rpc)[^'"]*['"]/i);
  assert.doesNotMatch(viewSource, /\b(?:fetch|localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(viewSource, /document\.(?:querySelector|getElementById|createElement)/);
});
