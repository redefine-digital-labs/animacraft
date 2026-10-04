import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { createProductionMakerV8NativeContentV8 } from '../maker-v8-native-content-production.js';
import { createMakerV8PlayerJourneyV8 } from '../maker-v8-player-journey.js';
import { createMakerV8ProductBridge } from '../maker-v8-product-bridge.js';
import { createProductionAnimacraftApp } from '../app.js';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { applyMakerV8WorkspaceCommand } from '../maker-v8-workspace.js';
import { MAKER_V8_DEFAULT_ASSET_BASE64 } from './fixtures/maker-v8-minimal-artwork.js';
import { makerV8PlayerRecipeCommitmentV8 } from '../maker-v8-player-controller.js';
import { makerV8PlayerRecipeLayout } from '../maker-v8-player-slot-layout.js';
import { makerV8PlayerColorMap, makerV8PlayerSwatchKey } from '../maker-v8-player-colors.js';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';
import { encodeMakerV8ProjectZip } from '../maker-v8-project-zip.js';
import { makerV8RuleIssue, makerV8RuleFromBuilder } from '../maker-v8-rules.js';
import {
  ORIGINAL_CREATOR_TABS,
  ORIGINAL_PRODUCT_PAGES,
  createOriginalProductApp,
  normalizeOriginalWalletConnection,
  renderOriginalCreatorWorkspace,
} from '../original-product-app.js';

const [source, deploymentConfigSource] = await Promise.all([
  readFile(new URL('../original-product-app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public-v8/config.js', import.meta.url), 'utf8'),
]);

function draftRecord({ revision = 1, updatedAt = 1_700_000_000_000 } = {}) {
  return Object.freeze({
    schemaVersion: 'animacraft.maker-v8-draft-record.v1',
    draftId: 'approved-maker',
    revision,
    createdAt: 1_700_000_000_000,
    updatedAt,
    document: createCharacterMakerV8Starter({
      makerKey: 'approved-maker',
      name: 'Approved Maker',
      width: 1024,
      height: 1024,
    }),
  });
}

const ROOT_ONE = `0x${'31'.repeat(32)}`;

test('certified Player original share handlers use only its public exact Root route', async t => {
  for (const mode of ['copy', 'native', 'native-reject', 'fallback', 'cancel', 'reject', 'missing', 'stale', 'destroy']) await t.test(mode, async () => {
    const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, templatesResult: { status: 'READY', diagnostics: [],
      makers: [certifiedMaker(), certifiedMaker({ rootId: ROOT_TWO })] }, playerSessionResult: root => playerSession(root),
      renderPlayerPreviewResult: canonicalPreview() });
    const sent = []; const gate = deferred();
    h.win.navigator.clipboard = { writeText: async value => {
      sent.push(value);
      if (mode === 'reject') throw Error('denied');
      if (['stale', 'destroy'].includes(mode)) await gate.promise;
    } };
    if (['native', 'native-reject', 'cancel'].includes(mode)) h.win.navigator.share = async value => {
      sent.push(value);
      if (mode === 'native-reject') throw Error('share rejected');
      if (mode === 'cancel') throw Object.assign(Error('cancel'), { name: 'AbortError' });
    };
    if (mode === 'missing') delete h.win.navigator.clipboard;
    const app = createOriginalProductApp(h);
    try {
      await app.ready; await app.openPlayer(ROOT_ONE);
      const mount = h.doc.getElementById('makerV4PlayerMount');
      const preview = new FakeTarget(h.doc, { dataset: { action: 'player-preview-export' } }); preview.parent = mount;
      await waitForEvent(mount.fire('click', { target: preview }));
      assert.ok(mount.innerHTML.includes('makerPlayerShareStatus'), 'export sharing controls are visible');
      assert.deepEqual(sent, []);
      assert.match(mount.innerHTML, /Completion price not yet quoted/);
      assert.doesNotMatch(mount.innerHTML, /Purchases are not available for this Maker yet/);
      assert.doesNotMatch(mount.innerHTML, /Publish this Maker before sharing it/);
      const action = ['native', 'native-reject', 'cancel', 'fallback', 'missing'].includes(mode) ? 'player-share-maker' : 'player-copy-maker-link';
      const control = new FakeTarget(h.doc, { dataset: { action } }); control.parent = mount;
      mount.fire('click', { target: control }); await settle();
      if (mode === 'stale') await app.openPlayer(ROOT_TWO);
      if (mode === 'destroy') app.destroy();
      gate.resolve(); await settle(); await settle();
      const url = `https://animacraft.soulidity.ai/maker/${ROOT_ONE}`;
      assert.deepEqual(sent, mode === 'missing' ? [] : [['native', 'native-reject', 'cancel'].includes(mode) ? { url } : url]);
      if (['copy', 'fallback'].includes(mode)) assert.match(mount.innerHTML, /Maker link copied/);
      if (mode === 'native') assert.match(mount.innerHTML, /Maker shared/);
      if (['missing', 'reject', 'native-reject'].includes(mode)) assert.match(mount.innerHTML, /Could not share or copy the Maker link/);
      if (['cancel', 'stale', 'destroy'].includes(mode)) assert.doesNotMatch(mount.innerHTML, /Maker link copied|Maker shared|Could not share or copy the Maker link/);
    } finally { app.destroy(); }
  });
});

test('Player share dispatch rejects invalid protocols and uncertified Root identities', async t => {
  for (const mode of ['protocol', 'root']) await t.test(mode, async () => {
    const h = browserHarness({ initialUrl: mode === 'protocol' ? 'file:///player.html' : undefined,
      connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
      playerSessionResult: mode === 'root' ? { ...playerSession(ROOT_ONE), rootId: 'invalid' } : playerSession(ROOT_ONE),
      renderPlayerPreviewResult: canonicalPreview() });
    const sent = [];
    h.win.navigator.share = async value => sent.push(value);
    h.win.navigator.clipboard = { writeText: async value => sent.push(value) };
    const app = createOriginalProductApp(h);
    try {
      await app.ready;
      if (mode === 'root') await assert.rejects(app.openPlayer(ROOT_ONE));
      else await app.openPlayer(ROOT_ONE);
      const mount = h.doc.getElementById('makerV4PlayerMount');
      for (const action of ['player-copy-maker-link', 'player-share-maker']) {
        const control = new FakeTarget(h.doc, { dataset: { action } }); control.parent = mount;
        await waitForEvent(mount.fire('click', { target: control }));
      }
      assert.deepEqual(sent, []);
    } finally { app.destroy(); }
  });
});

test('ordinary publication opens exact saved review without signing and rejects duplicate clicks', async () => {
  const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  const gate = deferred(); const calls = [];
  h.bridge.prepareMakerPublication = async input => { calls.push(input); return gate.promise; };
  h.bridge.inspectMakerPublication = h.bridge.prepareMakerPublication;
  h.bridge.signMakerPublication = async () => { throw Error('unexpected signature'); };
  h.bridge.continueMakerPublication = async () => { throw Error('unexpected broadcast'); };
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const click = () => { const control = new FakeTarget(h.doc, { dataset: { action: 'publish', reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } }); control.parent = mount; mount.fire('click', { target: control }); };
    click(); click(); await settle(); await settle();
    assert.deepEqual(calls, [{ draftId: 'approved-maker', expectedRevision: 1 }]);
    gate.resolve({ schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'review-one', scope: { draftId: 'approved-maker', draftRevision: 1, signerAddress: ROOT_ONE, network: 'mainnet' }, stage: 'LIVING_CONTENT', status: 'TRANSPORT_SIGNATURE_REQUIRED', nextAction: 'SIGN', step: { id: 'step-one', stage: 'REGISTER', gasBudgetMist: '123456', gasPriceMist: '1000', storageCostAtomic: null }, assetCount: 1 });
    await settle(); await settle();
    assert.match(mount.innerHTML, /123456/);
    assert.match(mount.innerHTML, /data-action="publication-sign"/);
    assert.match(mount.innerHTML, /Unknown/);
  } finally { app.destroy(); }
});

test('publication review fences late results on route, wallet, close and reopened draft', async t => {
  for (const mode of ['route', 'wallet', 'close', 'reopen']) await t.test(mode, async () => {
    const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
    const gate = deferred(); let entered = false;
    h.bridge.prepareMakerPublication = async () => { entered = true; return gate.promise; };
    h.bridge.inspectMakerPublication = h.bridge.prepareMakerPublication;
    h.bridge.signMakerPublication = async () => assert.fail('signature');
    h.bridge.continueMakerPublication = async () => assert.fail('broadcast');
    const app = createOriginalProductApp(h);
    try {
      await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
      const mount = h.doc.getElementById('makerV4CreatorMount');
      const fire = action => { const target = new FakeTarget(h.doc, { dataset: { action, reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } }); target.parent = mount; mount.fire('click', { target }); };
      fire('publish'); await settle(); assert.equal(entered, true);
      if (mode === 'route') app.navigate('templates');
      if (mode === 'wallet') app.refreshConnection(null);
      if (mode === 'close') {
        fire('publication-close');
        await settle();
        assert.match(mount.innerHTML, /makerCreatorPublishCloseConfirm/);
        fire('publication-force-close');
        await settle();
      }
      if (mode === 'reopen') await app.openDraft('approved-maker');
      gate.resolve({ schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'late-review', scope: { draftId: 'approved-maker', draftRevision: 1, signerAddress: ROOT_ONE, network: 'mainnet' }, stage: 'DONE', status: 'COMPLETE', rootId: 'late-root' });
      await settle(); await settle();
      assert.doesNotMatch(mount.innerHTML, /late-root|late-review/);
    } finally { app.destroy(); }
  });
});

test('publication uses explicit single-step signatures, rejection clears authority, refresh never continues', async () => {
  const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  const scope = { draftId: 'approved-maker', draftRevision: 1, signerAddress: ROOT_ONE, network: 'mainnet' };
  const review = { schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'r1', scope, stage: 'LIVING_CONTENT', status: 'TRANSPORT_SIGNATURE_REQUIRED', nextAction: 'SIGN', step: { stage: 'REGISTER', gasBudgetMist: '100' } };
  const calls = []; let reject = true;
  h.bridge.prepareMakerPublication = async () => structuredClone(review);
  h.bridge.inspectMakerPublication = async input => { calls.push(['inspect', input]); return structuredClone(review); };
  h.bridge.signMakerPublication = async input => { calls.push(['sign', input]); if (reject) throw Error('Wallet rejected'); return { ...review, reviewId: 'r2', status: 'TRANSPORT_RECOVERY_REQUIRED', nextAction: 'CONTINUE' }; };
  h.bridge.continueMakerPublication = async input => { calls.push(['continue', input]); return { ...review, reviewId: 'r3', stage: 'ASSETS' }; };
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
    h.emitBridge({ publication: { signingEnabled: true, broadcastEnabled: true } });
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const fire = async (action, publicationReview) => { const target = new FakeTarget(h.doc, { dataset: { action, publicationReview, reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } }); target.parent = mount; mount.fire('click', { target }); await settle(); await settle(); };
    await fire('publish'); await fire('publication-sign', 'wrong'); assert.equal(calls.length, 0);
    await fire('publication-sign', 'r1'); assert.match(mount.innerHTML, /Wallet rejected/);
    await fire('publication-sign', 'r1'); assert.equal(calls.length, 1);
    await fire('publication-refresh'); assert.equal(calls[1][0], 'inspect');
    reject = false; await fire('publication-sign', 'r1');
    assert.match(mount.innerHTML, /data-action="publication-continue"/);
    assert.equal(calls.filter(x => x[0] === 'continue').length, 0);
    await fire('publication-continue', 'r2'); assert.equal(calls.at(-1)[0], 'continue');
    assert.match(mount.innerHTML, /ASSETS/); assert.match(mount.innerHTML, /data-publication-review="r3"/);
    h.emitBridge({ publication: { signingEnabled: false, broadcastEnabled: false } });
    await fire('publication-sign', 'r3'); assert.equal(calls.length, 4);
  } finally { app.destroy(); }
});

test('publication drains a pending saved revision and rejects mismatched wallet or revision review', async t => {
  for (const mismatch of ['none', 'wallet', 'revision']) await t.test(mismatch, async () => {
    const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
    const gate = deferred(), writes = []; const dispatch = h.bridge.dispatchDraftCommand;
    h.bridge.dispatchDraftCommand = async input => { await gate.promise; return dispatch(input); };
    h.bridge.prepareMakerPublication = async input => {
      writes.push(input);
      return { schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'new-review', scope: { draftId: 'approved-maker', draftRevision: mismatch === 'revision' ? 1 : 2, signerAddress: mismatch === 'wallet' ? '0x123' : ROOT_ONE, network: 'mainnet' }, stage: 'ASSETS', status: 'TRANSPORT_SIGNATURE_REQUIRED', nextAction: 'SIGN', step: { stage: 'REGISTER', gasBudgetMist: '99' } };
    };
    h.bridge.inspectMakerPublication = h.bridge.prepareMakerPublication;
    h.bridge.signMakerPublication = async () => assert.fail('signature');
    h.bridge.continueMakerPublication = async () => assert.fail('broadcast');
    const app = createOriginalProductApp(h);
    try {
      await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
      const mount = h.doc.getElementById('makerV4CreatorMount');
      const fire = (action, event = 'click', value) => { const target = new FakeTarget(h.doc, { dataset: { action, reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } }); target.parent = mount; target.value = value; mount.fire(event, { target }); };
      fire('maker-name', 'change', 'Saved before publication'); await settle();
      fire('publish'); await settle(); assert.deepEqual(writes, []);
      gate.resolve(); await settle(); await settle();
      assert.deepEqual(writes, [{ draftId: 'approved-maker', expectedRevision: 2 }]);
      if (mismatch === 'none') assert.match(mount.innerHTML, /data-publication-review="new-review"/);
      else { assert.match(mount.innerHTML, /review is stale/); assert.doesNotMatch(mount.innerHTML, /data-action="publication-sign"/); }
    } finally { app.destroy(); }
  });
});

test('publication explicitly reviews an earlier frozen revision and restores only certified Library identity', async () => {
  const record = draftRecord({ revision: 2 });
  const h = browserHarness({ record, draftsResult: [record], connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  const scope = { draftId: record.draftId, draftRevision: 1, currentSavedRevision: 2, publishingEarlierRevision: true, signerAddress: ROOT_ONE, network: 'mainnet', contentSha256: 'frozen-content-hash' };
  const review = { schemaVersion: 'animacraft.maker-v8-publication-review.v1', scope, reviewId: 'frozen-review', frozenMakerName: 'Frozen Maker name', stage: 'MANIFEST', status: 'READY', nextAction: 'SIGN', step: { gasBudgetMist: '500' } };
  let signs = 0, reads = 0;
  h.bridge.getPublishedMaker = async () => { reads++; return { complete: true, scope, rootId: ROOT_ONE, makerVersion: 1 }; };
  h.bridge.prepareMakerPublication = async () => review;
  h.bridge.inspectMakerPublication = async () => review;
  h.bridge.signMakerPublication = async () => { signs++; return { ...review, nextAction: 'CONTINUE' }; };
  h.bridge.continueMakerPublication = async () => assert.fail('broadcast');
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft(record.draftId); await settle();
    h.emitBridge({ publication: { signingEnabled: true, broadcastEnabled: true } });
    assert.ok(reads > 0); assert.equal(signs, 0);
    assert.match(h.doc.getElementById('imageMakerList').innerHTML, /Earlier revision published · current edits unpublished/);
    assert.match(h.doc.getElementById('imageMakerList').innerHTML, new RegExp(ROOT_ONE));
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const fire = async (action, publicationReview) => { const target = new FakeTarget(h.doc, { dataset: { action, publicationReview, reviewDraft: record.draftId, creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } }); target.parent = mount; mount.fire('click', { target }); await settle(); };
    await fire('manage-lifecycle');
    assert.match(h.doc.getElementById('lifecyclePublishedVersionCard').innerHTML, new RegExp(ROOT_ONE));
    assert.doesNotMatch(h.doc.getElementById('makerLifecycleManagerStatus').textContent, /No version/);
    await fire('publish');
    assert.match(mount.innerHTML, /frozen revision 1/); assert.match(mount.innerHTML, /saved revision 2/);
    assert.match(mount.innerHTML, /Frozen Maker name|frozen-content-hash/);
    await fire('publication-sign', 'frozen-review'); assert.equal(signs, 1);
  } finally { app.destroy(); }
});

test('republish current edits presents version review instead of completed predecessor resources', async () => {
  const record = draftRecord({ revision: 41 });
  const h = browserHarness({ record, connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  const review = { schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'new-version',
    scope: { draftId: record.draftId, draftRevision: 6, currentSavedRevision: 41,
      publishingEarlierRevision: true, signerAddress: ROOT_ONE, network: 'mainnet' },
    status: 'NEW_VERSION_REQUIRED', stage: 'COMPLETE', nextAction: null,
    rootId: ROOT_ONE, makerVersion: 1, frozenMakerName: 'Original Maker', progress: { completed: 3, total: 3 } };
  h.bridge.prepareMakerPublication = async () => review;
  h.bridge.inspectMakerPublication = async () => review;
  h.bridge.signMakerPublication = async () => assert.fail('signature');
  h.bridge.continueMakerPublication = async () => assert.fail('broadcast');
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft(record.draftId); await settle();
    h.emitBridge({ publication: { signingEnabled: true, broadcastEnabled: true } });
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const fire = async action => {
      const target = new FakeTarget(h.doc, { dataset: { action, reviewDraft: record.draftId,
        creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } });
      target.parent = mount; mount.fire('click', { target }); await settle();
    };
    await fire('publish');
    for (const action of [null, 'publication-refresh']) {
      if (action) await fire(action);
      assert.match(mount.innerHTML, /Published saved revision 6 · current saved revision 41/);
      assert.match(mount.innerHTML, /data-action="publication-versions"/);
      assert.doesNotMatch(mount.innerHTML, /data-publication-stage|3 \/ 3|Continue publishing frozen|data-action="publication-(?:sign|continue|open)"/);
    }
    await fire('publication-versions');
    assert.match(mount.innerHTML, /Local saved snapshots/);
    assert.doesNotMatch(mount.innerHTML, /id="makerCreatorPublishDialog"/);
  } finally { app.destroy(); }
});

test('publication busy close warns, keeps its flight, reopens without duplicate work and never resurrects a hidden dialog', async () => {
  const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  const gate = deferred(); let prepares = 0;
  h.bridge.prepareMakerPublication = async () => { prepares++; return gate.promise; };
  h.bridge.inspectMakerPublication = h.bridge.prepareMakerPublication;
  h.bridge.signMakerPublication = async () => assert.fail('signature');
  h.bridge.continueMakerPublication = async () => assert.fail('broadcast');
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const fire = async action => {
      const target = new FakeTarget(h.doc, { dataset: { action, reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } });
      target.parent = mount; mount.fire('click', { target }); await settle();
    };
    await fire('publish'); await fire('publication-close');
    assert.match(mount.innerHTML, /role="alertdialog"/);
    await fire('publication-keep-open'); assert.doesNotMatch(mount.innerHTML, /role="alertdialog"/);
    await fire('publication-close'); await fire('publication-force-close');
    assert.doesNotMatch(mount.innerHTML, /id="makerCreatorPublishDialog"/);
    await fire('publish'); assert.equal(prepares, 1);
    assert.match(mount.innerHTML, /id="makerCreatorPublishDialog"/);
    assert.match(mount.innerHTML, /aria-busy="true"/);
    await fire('publication-close'); await fire('publication-force-close');
    gate.resolve({ schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'same-flight',
      scope: { draftId: 'approved-maker', draftRevision: 1, signerAddress: ROOT_ONE, network: 'mainnet' },
      status: 'TRANSPORT_SIGNATURE_REQUIRED', stage: 'LIVING_CONTENT', nextAction: 'SIGN', step: { stage: 'REGISTER' } });
    await settle(); await settle();
    assert.doesNotMatch(mount.innerHTML, /id="makerCreatorPublishDialog"/);
    await fire('publish'); assert.equal(prepares, 2, 'idle reopen re-reviews durable state');
  } finally { app.destroy(); }
});

test('publication errors preserve context, copy diagnostics and require inspection before another signature', async () => {
  const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  const review = { schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'review',
    frozenMakerName: 'Frozen author work', scope: { draftId: 'approved-maker', draftRevision: 1, signerAddress: ROOT_ONE, network: 'mainnet' },
    status: 'TRANSPORT_SIGNATURE_REQUIRED', stage: 'LIVING_CONTENT', nextAction: 'SIGN', step: { stage: 'REGISTER' } };
  const diagnostics = []; let signs = 0, inspections = 0;
  h.win.navigator.clipboard = { async writeText(text) { diagnostics.push(text); } };
  h.bridge.prepareMakerPublication = async () => review;
  h.bridge.inspectMakerPublication = async () => { inspections++; return review; };
  h.bridge.signMakerPublication = async () => { signs++; throw Object.assign(new Error('Transaction outcome unknown'), { code: 'OUTCOME_UNKNOWN' }); };
  h.bridge.continueMakerPublication = async () => assert.fail('broadcast');
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
    h.emitBridge({ publication: { signingEnabled: true, broadcastEnabled: true } });
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const fire = async action => {
      const target = new FakeTarget(h.doc, { dataset: { action, publicationReview: 'review', reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } });
      target.parent = mount; mount.fire('click', { target }); await settle(); await settle();
    };
    await fire('publish'); await fire('publication-sign');
    assert.match(mount.innerHTML, /Frozen author work/);
    assert.match(mount.innerHTML, /TRANSACTION_OUTCOME_PENDING/);
    assert.doesNotMatch(mount.innerHTML, /data-action="publication-sign"/);
    await fire('publication-sign'); assert.equal(signs, 1);
    await fire('publication-copy-error'); assert.deepEqual(diagnostics, ['Transaction outcome unknown']);
    assert.match(mount.innerHTML, /Details copied/);
    await fire('publication-refresh'); assert.equal(inspections, 1); assert.equal(signs, 1);
  } finally { app.destroy(); }
});

test('publication hides and reopens a pending signature without a second prompt; hidden failures re-review safely', async t => {
  for (const fails of [false, true]) await t.test(fails ? 'unknown outcome' : 'signed bytes', async () => {
    const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
    const pending = deferred(); let prepares = 0, signs = 0, continued = 0, durable = false;
    const review = { schemaVersion: 'animacraft.maker-v8-publication-review.v1', reviewId: 'sign-review',
      scope: { draftId: 'approved-maker', draftRevision: 1, signerAddress: ROOT_ONE, network: 'mainnet' },
      status: 'TRANSPORT_SIGNATURE_REQUIRED', stage: 'ASSET', nextAction: 'SIGN', step: { stage: 'REGISTER', digest: 'same-digest' } };
    const resumed = { ...review, reviewId: 'signed-review', status: 'TRANSPORT_RECOVERY_REQUIRED', nextAction: 'CONTINUE' };
    h.bridge.prepareMakerPublication = async () => { prepares++; return durable ? resumed : review; };
    h.bridge.inspectMakerPublication = h.bridge.prepareMakerPublication;
    h.bridge.signMakerPublication = async () => { signs++; await pending.promise; durable = true;
      if (fails) throw new Error('Transaction outcome unknown'); return resumed; };
    h.bridge.continueMakerPublication = async ({ reviewId }) => { assert.equal(reviewId, 'signed-review'); continued++; return resumed; };
    const app = createOriginalProductApp(h);
    try {
      await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
      h.emitBridge({ publication: { signingEnabled: true, broadcastEnabled: true } });
      const mount = h.doc.getElementById('makerV4CreatorMount');
      const fire = async (action, publicationReview = 'sign-review') => {
        const target = new FakeTarget(h.doc, { dataset: { action, publicationReview, reviewDraft: 'approved-maker', creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)[1] } });
        target.parent = mount; mount.fire('click', { target }); await settle();
      };
      await fire('publish'); await fire('publication-sign'); await fire('publication-close');
      assert.match(mount.innerHTML, /role="alertdialog"/);
      await fire('publication-force-close'); await fire('publish');
      assert.equal(prepares, 1); assert.equal(signs, 1);
      await fire('publication-close'); await fire('publication-force-close');
      pending.resolve(); await settle(); await settle();
      assert.doesNotMatch(mount.innerHTML, /id="makerCreatorPublishDialog"/);
      await fire('publication-sign'); assert.equal(signs, 1);
      await fire('publish'); assert.equal(prepares, 2);
      assert.match(mount.innerHTML, /same-digest/);
      assert.doesNotMatch(mount.innerHTML, /data-action="publication-sign"/);
      await fire('publication-continue', 'signed-review'); assert.equal(continued, 1);
    } finally { app.destroy(); }
  });
});

test('local Player return reuses its existing control outside the hidden retired editor', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal([...html.matchAll(/id="backToCreatorPreview"/g)].length, 1);
  assert.match(html, /<section id="make"[^>]*>\s*<button id="backToCreatorPreview"[^>]*hidden>/);
  assert.ok(html.indexOf('id="backToCreatorPreview"') < html.indexOf('id="legacyPlayerEditor"'));
});

function pngEditorHarness({ document } = {}) {
  const record = structuredClone(draftRecord());
  if (document) record.document = structuredClone(document);
  const bytes = Buffer.from(MAKER_V8_DEFAULT_ASSET_BASE64, 'base64');
  record.document.assets[0].byteLength = bytes.length;
  const asset = { ...localDraftAsset(), kind: record.document.assets[0].kind,
    byteLength: bytes.length, bytesBase64: bytes.toString('base64') };
  const connection = { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } };
  const harness = browserHarness({ record, draftAssets: [asset], connection });
  let saved = { draft: record, assets: [asset] };
  const writes = [];
  harness.bridge.getDraft = async () => structuredClone(saved);
  harness.win.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  harness.bridge.dispatchDraftTransaction = async input => {
    writes.push(input); assert.equal(input.expectedRevision, saved.draft.revision);
    const document = input.commands.reduce(applyMakerV8WorkspaceCommand, saved.draft.document);
    const assets = saved.assets.filter(row => !input.assetDeletes.some(deleted => deleted.assetId === row.assetId)).map(row => {
      const update = input.assetUpserts.find(upsert => upsert.assetId === row.assetId);
      return update ? { ...row, ...update, revision: row.revision + 1,
        byteLength: Buffer.from(update.bytesBase64, 'base64').length } : row;
    });
    for (const update of input.assetUpserts.filter(row => !assets.some(asset => asset.assetId === row.assetId))) {
      assets.push({ ...localDraftAsset(), ...update, revision: 1,
        byteLength: Buffer.from(update.bytesBase64, 'base64').length });
    }
    saved = { draft: { ...saved.draft, revision: saved.draft.revision + 1, document }, assets };
    return structuredClone(saved);
  };
  harness.bridge.dispatchDraftCommand = async input => {
    harness.calls.dispatch.push(input);
    return (await harness.bridge.dispatchDraftTransaction({
      ...input, commands: [input.command], assetUpserts: [], assetDeletes: [],
    })).draft;
  };
  harness.bridge.replaceDraftSnapshot = async input => {
    writes.push(input); assert.equal(input.expectedRevision, saved.draft.revision);
    saved = { draft: { ...saved.draft, revision: saved.draft.revision + 1,
      document: structuredClone(input.document) }, assets: structuredClone(input.assets) };
    return structuredClone(saved);
  };
  harness.bridge.replaceDraftDocument = async input => {
    writes.push(input); assert.equal(input.expectedRevision, saved.draft.revision);
    saved = { ...saved, draft: { ...saved.draft, revision: saved.draft.revision + 1, document: structuredClone(input.document) } };
    return structuredClone(saved.draft);
  };
  const fire = (action, file, dataset = {}) => {
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const target = new FakeTarget(harness.doc, { dataset: { action, ...dataset } }); target.parent = mount;
    const imageUpload = ['style-asset', 'maker-cover'].includes(action);
    if (imageUpload) { target.files = file ? [file] : []; target.value = 'chosen.png'; }
    mount.fire(imageUpload ? 'change' : 'click', { target });
    return target;
  };
  const replacement = Uint8Array.from([...bytes, 0]);
  const file = { type: 'image/png', size: replacement.length,
    arrayBuffer: async () => replacement.buffer.slice(0) };
  const change = (action, value, dataset = {}) => {
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const target = new FakeTarget(harness.doc, { dataset: { action, ...dataset } }); target.parent = mount;
    if (typeof value === 'boolean') target.checked = value;
    target.value = value; mount.fire('change', { target });
  };
  return { harness, fire, change, file, connection, writes, saved: () => structuredClone(saved) };
}

test('Composable original controls select a certified Part and persist isolated source PNG', async () => {
  const h = pngEditorHarness();
  h.harness.win.indexedDB = new IDBFactory();
  h.harness.bridge.listComposableMakers = async () => [{ rootId: ROOT_ONE, title: 'Published target' }];
  h.harness.bridge.listComposableProducts = async () => ({ address: h.connection.account.address,
    products: [{ id: 'controlled-product', rootId: ROOT_ONE, makerKey: 'Published target', lifecycle: 0 }] });
  h.harness.bridge.reviewComposableItem = async ({ productId }) => ({ requestId: 'mint-one', action: 'MINT_ITEM', product: { productId },
    payload: { recipient: h.connection.account.address } });
  let itemOperationRows = [];
  h.harness.bridge.stageComposableOperation = async request => { itemOperationRows = [{ request, status: 'ACTIVE', ticket: null }]; };
  h.harness.bridge.listComposableOperations = async () => ({ address: h.connection.account.address, rows: itemOperationRows });
  h.harness.bridge.continueComposableOperation = async ({ requestId, mode }) => {
    assert.equal(requestId, 'mint-one');
    itemOperationRows = [{ ...itemOperationRows[0], ...(mode === 'SIGN'
      ? { ticket: { digest: 'mint-digest' } }
      : { status: 'COMPLETE', readback: { itemRef: { objectId: 'owned-item-one' } } }) }];
  };
  let historyError = false, historyComplete = false, productAttempt = null, createCalls = 0, recoverCalls = 0;
  const ticket = { recoveryId: 'saved-product-attempt', digest: 'saved-transaction' };
  h.harness.bridge.createComposableUploadProduct = async ({ uploadId }) => {
    assert.equal(uploadId, 'retained-old-upload'); createCalls++;
    if (createCalls === 1) { productAttempt = { status: 'ACTIVE', ticket: null }; throw new Error('User rejected signature'); }
    productAttempt = { status: 'ACTIVE', ticket };
    throw new Error('Connection lost after signed persistence');
  };
  h.harness.bridge.recoverComposableAction = async value => {
    assert.deepEqual(value, ticket); recoverCalls++;
    if (recoverCalls === 1) return { status: 'OUTCOME_UNKNOWN' };
    productAttempt = { status: 'COMPLETE', ticket, readback: { productId: 'certified-product' } };
  };
  h.harness.bridge.reviewComposableUpload = async ({ uploadId }) => {
    assert.equal(uploadId, 'retained-old-upload');
    return { requestId: uploadId, payload: { itemKey: 'old-hat', styleKey: 'old-blue', layerTrackKey: 'base-track',
      assetBlobId: 'certified-old-blob', assetSha256: 'b'.repeat(64) } };
  };
  h.harness.bridge.listComposableUploads = async () => {
    if (historyError) throw new Error('History read failed');
    return { address: h.connection.account.address, rows: [{ uploadId: 'retained-old-upload', artworkRevision: 1,
      binding: { rootId: ROOT_ONE, partKey: 'hat' }, productAttempt, status: historyComplete ? 'COMPLETE' : 'RECOVERY_REQUIRED', stage: historyComplete ? 'COMPLETE' : 'REGISTER' }] };
  };
  h.harness.bridge.prepareComposableStorage = async ({ expectedRevision }) => {
    assert.equal(expectedRevision, 2);
    return { status: 'SIGNATURE_REQUIRED', uploadId: 'exact-local-record' };
  };
  h.harness.bridge.getComposableMaker = async () => ({ rootId: ROOT_ONE, makerVersion: '1', contentCommitment: 'a'.repeat(64), admission: 'OPEN', parts: [{ key: 'hat', label: 'Hat', capacity: 2 }], tracks: [{ key: 'base-track', label: 'Base' }], colors: [] });
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'composable' });
    h.fire('refresh-composable-products'); await settle();
    h.fire('review-composable-item', null, { productId: 'controlled-product' }); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Read-only review. No Item has been issued./);
    h.fire('stage-composable-item'); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Sign saved operation/);
    h.fire('continue-composable-item', null, { requestId: 'mint-one', mode: 'SIGN' }); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Recover operation \(no new signature\)/);
    await app.openDraft('approved-maker'); h.fire('creator-tab', null, { tab: 'composable' });
    h.fire('read-composable-item-operations'); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /mint-digest/);
    h.fire('continue-composable-item', null, { requestId: 'mint-one', mode: 'RECOVER' }); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Item ID: owned-item-one/);
    h.fire('refresh-composable-makers'); await settle();
    h.fire('inspect-composable-maker', null, { rootId: ROOT_ONE }); await settle();
    h.fire('select-composable-part', null, { partKey: 'hat' }); await settle();
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const waitFor = async text => {
      for (let index = 0; index < 30 && !mount.innerHTML.includes(text); index++) await settle();
      assert.ok(mount.innerHTML.includes(text), mount.innerHTML.match(/<section[^>]*data-composable-artwork>[\s\S]*?<\/section>/)?.[0] || 'artwork section missing');
    };
    await waitFor('empty · r0');
    const input = new FakeTarget(h.harness.doc, { dataset: { action: 'composable-artwork' } });
    input.parent = mount; input.files = [h.file]; input.value = 'chosen.png';
    mount.fire('change', { target: input }); await settle();
    await waitFor('saved · r1');
    assert.match(mount.innerHTML, /SHA-256:/);
    h.change('composable-product-setting', 'hat-item', { field: 'itemKey' });
    h.change('composable-product-setting', 'blue', { field: 'styleKey' });
    h.change('composable-product-setting', 'base-track', { field: 'layerTrackKey' });
    h.fire('save-composable-settings'); await waitFor('saved · r2');
    h.fire('prepare-composable-storage'); await waitFor('SIGNATURE_REQUIRED');
    assert.equal(h.writes.length, 0, 'external artwork never changes the open Maker source');
    h.fire('refresh-composable-makers'); await settle();
    assert.doesNotMatch(mount.innerHTML, /SHA-256:/);
    h.fire('inspect-composable-maker', null, { rootId: ROOT_ONE }); await settle();
    h.fire('select-composable-part', null, { partKey: 'hat' }); await settle();
    await waitFor('saved · r2');
    assert.match(mount.innerHTML, /value="hat-item"/);
    assert.match(mount.innerHTML, /value="base-track" selected/);
    h.fire('read-composable-upload-history'); await waitFor('retained-old-upload');
    assert.match(mount.innerHTML, /RECOVERY_REQUIRED · REGISTER/);
    historyComplete = true;
    h.fire('read-composable-upload-history'); await waitFor('Review external Product (no signature)');
    h.fire('review-composable-upload', null, { uploadId: 'retained-old-upload' });
    await waitFor('Product review ready. Not issued.');
    assert.match(mount.innerHTML, /certified-old-blob/);
    h.fire('create-composable-product', null, { uploadId: 'retained-old-upload' });
    await waitFor('User rejected signature');
    await waitFor('Sign saved Product transaction');
    assert.doesNotMatch(mount.innerHTML, /Sign &amp; create external Product/);
    h.fire('create-composable-product', null, { uploadId: 'retained-old-upload' });
    await waitFor('Connection lost after signed persistence');
    await waitFor('Recover Product transaction (no new signature)');
    await app.openDraft('approved-maker'); h.fire('creator-tab', null, { tab: 'composable' });
    h.fire('read-composable-upload-history');
    await waitFor('Product: ACTIVE');
    h.fire('recover-composable-product', null, { uploadId: 'retained-old-upload' });
    await waitFor('Recover Product transaction (no new signature)');
    await settle();
    assert.equal(createCalls, 2, 'reopening and unknown recovery never request another creation');
    assert.doesNotMatch(mount.innerHTML, /Product ID:/);
    h.fire('recover-composable-product', null, { uploadId: 'retained-old-upload' });
    await waitFor('Product ID: certified-product');
    assert.doesNotMatch(mount.innerHTML, /data-action="create-composable-product"/);
    historyError = true;
    h.fire('read-composable-upload-history'); await waitFor('History read failed');
    assert.doesNotMatch(mount.innerHTML, /retained-old-upload|No saved uploads/);
  } finally { app.destroy(); }
});

test('Product archive asks explicit confirmation and restores the saved recovery operation', async () => {
  const h = pngEditorHarness(); let rows = [], confirmed = false, signs = 0, warning = '';
  h.harness.win.confirm = text => { warning = text; return confirmed; };
  h.harness.bridge.listComposableProducts = async () => ({ address: h.connection.account.address,
    products: [{ id: ROOT_ONE, rootId: ROOT_ONE, makerKey: 'Test', lifecycle: 0 }] });
  h.harness.bridge.reviewComposableProduct = async ({ productId, action }) => ({ requestId: 'archive-one', action,
    product: { productId }, payload: { recipient: null } });
  h.harness.bridge.stageComposableOperation = async request => { rows = [{ request, status: 'ACTIVE', ticket: null }]; };
  h.harness.bridge.listComposableOperations = async () => ({ address: h.connection.account.address, rows });
  h.harness.bridge.continueComposableOperation = async ({ requestId, action, mode }) => {
    assert.equal(requestId, 'archive-one'); assert.equal(action, 'ARCHIVE_PRODUCT');
    if (mode === 'SIGN') { signs++; rows = [{ ...rows[0], ticket: { digest: 'archive-digest' } }]; }
    else rows = [{ ...rows[0], status: 'COMPLETE', readback: { lifecycle: 2 } }];
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'composable' }); h.fire('refresh-composable-products'); await settle();
    h.fire('review-composable-product', null, { productId: ROOT_ONE, productAction: 'ARCHIVE_PRODUCT' }); await settle();
    h.fire('stage-composable-item'); await settle();
    h.fire('continue-composable-item', null, { requestId: 'archive-one', mode: 'SIGN' }); await settle();
    assert.equal(signs, 0); assert.match(warning, /cannot be resumed/); assert.ok(warning.includes(ROOT_ONE));
    for (const [locale, phrase] of [['zh', '归档后无法恢复'], ['ja', '再開できません'], ['ko', '다시 활성화할 수 없습니다'], ['vi', 'Không thể kích hoạt lại']]) {
      app.setLocale(locale, { persist: false });
      h.fire('continue-composable-item', null, { requestId: 'archive-one', mode: 'SIGN' }); await settle();
      assert.ok(warning.includes(phrase)); assert.ok(warning.includes(ROOT_ONE)); assert.equal(signs, 0);
    }
    app.setLocale('en', { persist: false });
    confirmed = true;
    h.fire('continue-composable-item', null, { requestId: 'archive-one', mode: 'SIGN' }); await settle(); assert.equal(signs, 1);
    await app.openDraft('approved-maker'); h.fire('creator-tab', null, { tab: 'composable' });
    h.fire('read-composable-item-operations'); await settle();
    h.fire('continue-composable-item', null, { requestId: 'archive-one', mode: 'RECOVER' }); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /ARCHIVE_PRODUCT · archive-one · COMPLETE/);
    assert.equal(signs, 1); assert.equal(h.writes.length, 0);
  } finally { app.destroy(); }
});

test('Maker admission review stages and restores exact action independently of Item issuance', async () => {
  const h = pngEditorHarness();
  let rows = [];
  h.harness.bridge.listComposableMakers = async () => [{ rootId: ROOT_ONE, title: 'Published target' }];
  h.harness.bridge.getComposableMaker = async () => ({ rootId: ROOT_ONE, makerVersion: '1', admission: 'CERTIFIED', parts: [], tracks: [], colors: [] });
  h.harness.bridge.reviewComposableAdmission = async ({ rootId, productId, action }) => {
    assert.equal(rootId, ROOT_ONE); assert.equal(productId, ROOT_ONE); assert.equal(action, 'ADMIT_CERTIFIED');
    return { requestId: 'admission-one', action, product: { rootId, productId }, payload: { recipient: null } };
  };
  h.harness.bridge.stageComposableOperation = async request => { rows = [{ request, status: 'ACTIVE', ticket: null }]; };
  h.harness.bridge.listComposableOperations = async () => ({ address: h.connection.account.address, rows });
  h.harness.bridge.continueComposableOperation = async ({ requestId, action, mode }) => {
    assert.equal(requestId, 'admission-one'); assert.equal(action, 'ADMIT_CERTIFIED');
    rows = [{ ...rows[0], ...(mode === 'SIGN' ? { ticket: { digest: 'admission-digest' } }
      : { status: 'COMPLETE', readback: { packRegistryRevision: '10' } }) }];
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'composable' });
    h.fire('refresh-composable-makers'); await settle();
    h.fire('inspect-composable-maker', null, { rootId: ROOT_ONE }); await settle();
    h.change('admission-product-id', ROOT_ONE);
    h.fire('review-composable-admission', null, { admissionAction: 'ADMIT_CERTIFIED' }); await settle();
    const html = () => h.harness.doc.getElementById('makerV4CreatorMount').innerHTML;
    assert.match(html(), /Review only; not applied/);
    h.fire('stage-composable-admission'); await settle();
    assert.match(html(), /ADMIT_CERTIFIED · admission-one/);
    h.fire('continue-composable-item', null, { requestId: 'admission-one', mode: 'SIGN' }); await settle();
    await app.openDraft('approved-maker'); h.fire('creator-tab', null, { tab: 'composable' });
    h.fire('read-composable-item-operations'); await settle(); assert.match(html(), /admission-digest/);
    h.fire('continue-composable-item', null, { requestId: 'admission-one', mode: 'RECOVER' }); await settle();
    assert.match(html(), /admission-one · COMPLETE/);
    assert.doesNotMatch(html(), /Item ID:/);
    assert.equal(h.writes.length, 0);
  } finally { app.destroy(); }
});

test('Smart Color authoring, Style linking, defaults and deletion persist with Undo and reopen', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    h.fire('creator-tab', null, { tab: 'colors' });
    assert.doesNotMatch(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /data-action="add-channel"[^>]*disabled/);
    h.fire('add-channel'); await settle();
    const channelKey = h.saved().draft.document.colors[0].key;
    h.change('channel-name', 'S2 Palette', { channelId: channelKey }); await settle();
    h.change('style-channel', channelKey); await settle();
    h.fire('add-swatch', null, { channelId: channelKey }); await settle();
    const swatchKey = h.saved().draft.document.colors[0].swatches.at(-1).key;
    h.change('swatch-name', 'Ocean', { channelId: channelKey, swatchId: swatchKey }); await settle();
    h.change('swatch-hint', '#0066aa', { channelId: channelKey, swatchId: swatchKey }); await settle();
    h.change('swatch-mid', '#0099bb', { channelId: channelKey, swatchId: swatchKey }); await settle();
    h.change('swatch-stop', '#001122', { channelId: channelKey, swatchId: swatchKey, stopIndex: '0' }); await settle();
    h.change('channel-default-swatch', swatchKey, { channelId: channelKey }); await settle();
    const colored = h.saved().draft.document;
    assert.equal(colored.colors[0].label, 'S2 Palette');
    assert.equal(colored.colors[0].swatches.at(-1).label, 'Ocean');
    assert.equal(colored.colors[0].swatches.at(-1).rgba, '#0099bbff');
    assert.equal(colored.colors[0].swatches.at(-1).stops[0].rgba, '#001122ff');
    assert.deepEqual(colored.defaultRecipe.colors, [{ channelKey, swatchKey }]);
    assert.equal(colored.parts[0].items[0].styles[0].colorChannelKey, channelKey);
    h.fire('delete-swatch', null, { channelId: channelKey, swatchId: swatchKey }); await settle();
    assert.equal(h.saved().draft.document.colors[0].swatches.length, 1);
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document, colored);
    h.fire('redo'); await settle();
    h.fire('delete-channel', null, { channelId: channelKey }); await settle();
    assert.deepEqual(h.saved().draft.document, before.draft.document);
    assert.deepEqual(h.saved().assets, before.assets);
    await app.openDraft('approved-maker'); assert.equal(app.getState().revision, h.saved().draft.revision);
  } finally { app.destroy(); }
});

test('Smart Color gradient disclosure survives saves but not deletion or draft reopening', async () => {
  const h = pngEditorHarness(), read = h.harness.bridge.getDraft;
  const gate = deferred(), entered = deferred(); let pauseRead = false;
  h.harness.bridge.getDraft = async input => { if (pauseRead) { entered.resolve(); await gate.promise; } return read(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('add-channel'); await settle(); h.fire('creator-tab', null, { tab: 'colors' });
    const channelKey = h.saved().draft.document.colors[0].key;
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const details = new FakeTarget(h.harness.doc, { dataset: { creatorGradient: JSON.stringify([channelKey, 'default']), creatorGeneration: mount.innerHTML.match(/data-creator-generation="(\d+)"/)?.[1] } });
    details.parent = mount; details.tagName = 'DETAILS'; details.open = true;
    mount.fire('toggle', { target: details });
    h.change('swatch-stop', '#123456', { channelId: channelKey, swatchId: 'default', stopIndex: '0' }); await settle();
    assert.match(mount.innerHTML, /<details class="v4-swatch-gradient"[^>]* open>/);
    details.open = false; mount.fire('toggle', { target: details });
    h.change('swatch-stop', '#654321', { channelId: channelKey, swatchId: 'default', stopIndex: '0' }); await settle();
    assert.doesNotMatch(mount.innerHTML, /<details class="v4-swatch-gradient"[^>]* open>/);
    details.open = true; mount.fire('toggle', { target: details });
    pauseRead = true;
    const reopening = app.openDraft('approved-maker'); await entered.promise;
    mount.fire('toggle', { target: details }); // Old DOM is still mounted while the next draft loads.
    gate.resolve(); await reopening; h.fire('creator-tab', null, { tab: 'colors' }); await settle();
    assert.doesNotMatch(mount.innerHTML, /<details class="v4-swatch-gradient"[^>]* open>/);
    details.dataset.creatorGeneration = mount.innerHTML.match(/data-creator-generation="(\d+)"/)?.[1];
    mount.fire('toggle', { target: details });
    h.fire('delete-channel', null, { channelId: channelKey }); await settle();
    h.fire('add-channel'); await settle();
    assert.doesNotMatch(mount.innerHTML, /<details class="v4-swatch-gradient"[^>]* open>/);
  } finally { app.destroy(); }
});

test('Smart Color shared locks and no-op retain exact saved state', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('add-channel'); await settle();
    const channelKey = h.saved().draft.document.colors[0].key;
    h.change('style-channel', channelKey); await settle();
    h.change('style-locked', true); await settle();
    const before = h.saved();
    h.fire('delete-channel', null, { channelId: channelKey }); await settle();
    h.change('channel-name', 'Blocked', { channelId: channelKey }); await settle();
    h.change('style-channel', ''); await settle();
    assert.deepEqual(h.saved(), before);
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Unlock/);
    h.change('style-locked', false); await settle();
    const writes = h.writes.length;
    h.change('channel-name', h.saved().draft.document.colors[0].label, { channelId: channelKey }); await settle();
    assert.equal(h.writes.length, writes);
  } finally { app.destroy(); }
});

test('Smart Color failed save retains intent and retries without losing original assets', async () => {
  const h = pngEditorHarness(), write = h.harness.bridge.replaceDraftDocument;
  let fail = true;
  h.harness.bridge.replaceDraftDocument = async input => { if (fail) { fail = false; throw new Error('color write unavailable'); } return write(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    h.fire('add-channel'); await settle(); assert.deepEqual(h.saved(), before);
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /color write unavailable/);
    h.fire('save'); await settle(); assert.equal(h.saved().draft.document.colors.length, 1);
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document, before.draft.document);
    assert.deepEqual(h.saved().assets, before.assets);
  } finally { app.destroy(); }
});

test('Smart Color channel and preset names flush on focusout before immediate close', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('add-channel'); await settle();
    const channelKey = h.saved().draft.document.colors[0].key;
    for (const action of ['channel-name', 'swatch-name']) {
      h.fire('creator-tab', null, { tab: 'colors' }); await settle();
      const mount = h.harness.doc.getElementById('makerV4CreatorMount');
      const field = new FakeTarget(h.harness.doc, { dataset: { action, channelId: channelKey, swatchId: 'default' } });
      field.parent = mount; field.value = 'Default';
      h.harness.doc.activeElement = field; mount.fire('focusin', { target: field });
      field.value = `S2 ${action}`; mount.fire('input', { target: field });
      h.harness.doc.activeElement = null; mount.fire('focusout', { target: field });
      h.fire('close-tool'); await settle(); await settle();
      const channel = h.saved().draft.document.colors[0];
      assert.equal(action === 'channel-name' ? channel.label : channel.swatches[0].label, `S2 ${action}`);
      assert.equal(app.getState().creatorTab, 'structure');
    }
  } finally { app.destroy(); }
});

test('Layer Tracks actions persist, protect locks, retain artwork and undo/reopen', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    h.fire('add-track'); await settle();
    const key = h.saved().draft.document.tracks.at(-1).key;
    h.change('track-name', 'S2 extra', { trackId: key }); await settle();
    assert.equal(h.saved().draft.document.tracks.at(-1).label, 'S2 extra');
    h.change('assign-style-track', key); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].trackKey, key);
    h.fire('delete-track', null, { trackId: key }); await settle();
    assert.equal(h.saved().draft.document.tracks.length, 2, 'bound Track cannot be deleted');
    h.fire('toggle-track-lock', null, { trackId: key }); await settle();
    const locked = h.saved();
    h.change('track-name', 'forbidden', { trackId: key }); await settle();
    assert.deepEqual(h.saved(), locked);
    h.change('assign-style-track', ''); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].trackKey, null, 'Track lock does not prevent unbinding');
    h.fire('undo'); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].trackKey, key);
    h.fire('redo'); await settle();
    h.fire('toggle-track-lock', null, { trackId: key }); await settle();
    h.fire('delete-track', null, { trackId: key }); await settle();
    assert.equal(h.saved().draft.document.tracks.length, 1);
    await app.openDraft('approved-maker');
    assert.equal(app.getState().revision, h.saved().draft.revision);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].trackKey, null);
    assert.deepEqual(h.saved().assets, before.assets);
  } finally { app.destroy(); }
});

test('Track drag commits once and rejects navigation, wallet and Escape stale gestures', async () => {
  for (const cancel of ['none', 'navigation', 'wallet', 'escape']) {
    const document = structuredClone(draftRecord().document);
    document.tracks[0].locked = false;
    document.tracks.push({ key: 'extra-track', label: 'Extra', renderOrder: 1, locked: false });
    const h = pngEditorHarness({ document }), app = createOriginalProductApp(h.harness);
    const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
    editor.classList.add('active');
    h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
    h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      const mount = h.harness.doc.getElementById('makerV4CreatorMount');
      const row = key => { const node = new FakeTarget(h.harness.doc, { dataset: { dragKind: 'track', dragId: key } }); node.parent = mount; return node; };
      mount.fire('dragstart', { target: row(document.tracks[0].key), dataTransfer: { setData() {} } });
      if (cancel === 'navigation') { app.navigate('docs'); app.navigate('creator'); }
      if (cancel === 'wallet') { app.refreshConnection(null); app.refreshConnection(h.connection); }
      if (cancel === 'escape') h.harness.doc.fire('keydown', { key: 'Escape', preventDefault() {} });
      mount.fire('drop', { target: row('extra-track'), preventDefault() {} }); await settle();
      assert.equal(h.writes.length, cancel === 'none' ? 1 : 0, cancel);
      if (cancel === 'none') assert.equal(h.saved().draft.document.tracks[0].key, 'extra-track');
    } finally { app.destroy(); }
  }
});

test('Creator position, render properties, confirmation and locks persist through history and reopen', async () => {
  const h = pngEditorHarness(); const app = createOriginalProductApp(h.harness);
  const currentStyle = () => h.saved().draft.document.parts[0].items[0].styles[0];
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    for (const [action, value] of [['style-x', '12.125'], ['style-y', '-20.5'], ['style-scale', '0.75'],
      ['style-rotation', '15.125'], ['style-opacity', '65'], ['style-blend', 'linear-dodge']]) {
      h.change(action, value); await settle();
    }
    assert.deepEqual(currentStyle().transform, { x: 12.125, y: -20.5, scale: 0.75, rotation: 15.125 });
    assert.equal(currentStyle().opacity, 0.65); assert.equal(currentStyle().blendMode, 'linear-dodge');
    assert.deepEqual(h.saved().assets, before.assets);
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /value="12.125" data-action="style-x"/);
    assert.equal(currentStyle().payload.animacraftEditor.positionConfirmed, false);
    h.fire('confirm-position'); await settle(); assert.equal(currentStyle().payload.animacraftEditor.positionConfirmed, true);
    const confirmedWrites = h.writes.length;
    h.fire('edit-position'); h.fire('confirm-position'); await settle();
    assert.equal(h.writes.length, confirmedWrites, 'confirming an unchanged position closes without another write');
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /data-action="edit-position"/);
    h.change('style-position-locked', true); await settle();
    const locked = h.saved(); h.change('style-x', '500'); await settle(); assert.deepEqual(h.saved(), locked);
    h.change('style-opacity', '55'); await settle(); assert.equal(currentStyle().opacity, 0.55);
    h.change('style-locked', true); await settle(); const whole = h.saved();
    h.fire('style-asset', h.file); h.change('style-name', 'blocked'); h.change('style-opacity', '10'); await settle(); await settle();
    assert.deepEqual(h.saved(), whole);
    h.fire('undo'); await settle(); assert.equal(currentStyle().payload.animacraftEditor.styleLocked, undefined);
    h.fire('redo'); await settle(); assert.equal(currentStyle().payload.animacraftEditor.styleLocked, true);
    await app.openDraft('approved-maker');
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /data-action="style-asset"[^>]*disabled/);
    h.change('style-locked', false); await settle(); h.change('style-position-locked', false); await settle();
    h.change('style-x', '30'); await settle(); assert.equal(currentStyle().transform.x, 30);
  } finally { app.destroy(); }
});

test('Creator scale input is transient and canvas drag commits exactly one history entry', async () => {
  const h = pngEditorHarness(), previews = [];
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  h.harness.bridge.renderDraftPreview = async input => { previews.push(structuredClone(input)); return canonicalPreview(); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const range = new FakeTarget(h.harness.doc, { dataset: { action: 'style-scale-preview' } });
    range.parent = mount; range.value = '150';
    const markup = mount.innerHTML;
    mount.fire('input', { target: range }); await settle();
    assert.equal(h.writes.length, 0); assert.equal(previews.at(-1).stylePreview.transform.scale, 1.5);
    assert.equal(mount.innerHTML, markup, 'live preview cannot recreate the slider or canvas');
    mount.fire('change', { target: range }); await settle();
    assert.equal(h.writes.length, 1); assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.scale, 1.5);
    h.fire('confirm-position'); await settle(); h.fire('edit-position'); await settle();
    const canvas = h.harness.doc.getElementById('makerV4CreatorCanvas');
    canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
    canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
    const writes = h.writes.length, before = h.saved();
    mount.fire('pointerdown', { target: canvas, pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    mount.fire('pointermove', { target: canvas, pointerId: 1, clientX: 30, clientY: 40 }); await settle();
    assert.equal(h.writes.length, writes);
    assert.deepEqual(previews.at(-1).stylePreview.transform, { x: 40, y: 60, scale: 1.5, rotation: 0 });
    mount.fire('pointerup', { target: canvas, pointerId: 1 });
    mount.fire('lostpointercapture', { target: canvas, pointerId: 1 });
    mount.fire('pointerup', { target: canvas, pointerId: 1 }); await settle();
    assert.equal(h.writes.length, writes + 1);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.x, 40);
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document, before.draft.document);
  } finally { app.destroy(); }
});

test('Creator interrupted position gestures cannot commit after wallet ABA, navigation or Escape', async () => {
  for (const boundary of ['wallet', 'navigation', 'escape', 'library']) {
    const h = pngEditorHarness(), previews = [];
    const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
    h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
    h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
    h.harness.bridge.renderDraftPreview = async input => { previews.push(structuredClone(input)); return canonicalPreview(); };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); h.fire('edit-position');
      const mount = h.harness.doc.getElementById('makerV4CreatorMount'), canvas = h.harness.doc.getElementById('makerV4CreatorCanvas');
      canvas.getBoundingClientRect = () => ({ width: 512, height: 512 }); canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
      mount.fire('pointerdown', { target: canvas, pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      mount.fire('pointermove', { target: canvas, pointerId: 1, clientX: 30, clientY: 40 });
      assert.ok(previews.at(-1).stylePreview, 'gesture really started before interruption');
      if (boundary === 'wallet') { app.refreshConnection(null); app.refreshConnection(h.connection); }
      else if (boundary === 'navigation') { app.navigate('docs'); app.navigate('creator'); }
      else if (boundary === 'escape') h.harness.doc.fire('keydown', { key: 'Escape', preventDefault() {} });
      else h.fire('back-library');
      mount.fire('pointerup', { target: canvas, pointerId: 1 }); await settle(); await settle();
      assert.equal(h.writes.length, 0, boundary);
    } finally { app.destroy(); }
  }
});

test('Creator failed position edits retry one exact saved intent and preserve Undo', async () => {
  const h = pngEditorHarness(), write = h.harness.bridge.replaceDraftDocument;
  let fail = true; h.harness.bridge.replaceDraftDocument = async input => { if (fail) { fail = false; throw new Error('position save unavailable'); } return write(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); const before = h.saved();
    h.change('style-x', '80'); await settle(); assert.deepEqual(h.saved(), before);
    h.change('style-y', '40'); await settle(); assert.deepEqual(h.saved(), before);
    h.fire('save'); await settle();
    assert.deepEqual(h.saved().draft.document.parts[0].items[0].styles[0].transform, { x: 80, y: 40, scale: 1, rotation: 0 });
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document, before.draft.document);
  } finally { app.destroy(); }
});

test('Creator transient failures are visible without replacing controls and recover on valid input', async () => {
  const h = pngEditorHarness();
  const status = h.harness.doc.add(new FakeTarget(h.harness.doc, { id: 'v4CreatorRenderStatus' }));
  let rejectPreview = false;
  h.harness.bridge.renderDraftPreview = async input => {
    if (input.stylePreview && rejectPreview) throw new Error('Transient renderer unavailable');
    return canonicalPreview();
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); await settle();
    const mount = h.harness.doc.getElementById('makerV4CreatorMount'), markup = mount.innerHTML;
    const range = new FakeTarget(h.harness.doc, { dataset: { action: 'style-scale-preview' } });
    range.parent = mount; range.value = '150'; rejectPreview = true;
    mount.fire('input', { target: range }); await settle();
    assert.equal(status.textContent, 'Transient renderer unavailable');
    assert.equal(mount.innerHTML, markup); assert.equal(h.writes.length, 0);
    range.value = '500'; mount.fire('input', { target: range }); await settle();
    assert.notEqual(status.textContent, 'Transient renderer unavailable'); assert.notEqual(status.textContent, 'Preview ready.');
    rejectPreview = false; range.value = '160'; mount.fire('input', { target: range }); await settle();
    assert.equal(status.textContent, 'Preview ready.'); assert.equal(mount.innerHTML, markup);
    assert.equal(h.writes.length, 0);
  } finally { app.destroy(); }
});

test('Creator previous-field save cannot recreate or commit the next half-typed number input', async () => {
  const h = pngEditorHarness(), write = h.harness.bridge.replaceDraftDocument;
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  let release;
  h.harness.bridge.replaceDraftDocument = async input => { await new Promise(resolve => { release = resolve; }); return write(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); await settle();
    h.change('style-x', '80.125'); await settle();
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const field = new FakeTarget(h.harness.doc, { dataset: { action: 'style-y' } });
    field.parent = mount; field.value = '4'; field.focus(); mount.fire('focusin', { target: field });
    const markup = mount.innerHTML;
    release(); await settle(); await settle();
    assert.equal(mount.innerHTML, markup, 'async save and preview leave the native input in place');
    assert.equal(h.harness.doc.activeElement, field); assert.equal(field.value, '4');
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.y, 0);
    field.value = '40.5'; mount.fire('change', { target: field }); await settle();
    const confirm = new FakeTarget(h.harness.doc, { dataset: { action: 'confirm-position' } }); confirm.parent = mount;
    mount.fire('pointerdown', { target: confirm, button: 0 });
    h.harness.doc.activeElement = null; mount.fire('focusout', { target: field, relatedTarget: null });
    release(); await settle(); await settle();
    assert.equal(mount.innerHTML, markup, 'pointer action must survive focusout and the save acknowledgement until click');
    assert.deepEqual(h.saved().draft.document.parts[0].items[0].styles[0].transform,
      { x: 80.125, y: 40.5, scale: 1, rotation: 0 });
    assert.equal(h.writes.length, 2);
    mount.fire('click', { target: confirm }); await settle(); release(); await settle(); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].payload.animacraftEditor.positionConfirmed, true);
    assert.notEqual(mount.innerHTML, markup);
  } finally { app.destroy(); }
});

test('Creator text input keeps the first Close target alive through blur and save acknowledgement', async () => {
  const h = pngEditorHarness();
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  const gate = deferred();
  const dispatch = h.harness.bridge.dispatchDraftCommand;
  h.harness.bridge.dispatchDraftCommand = async input => { await gate.promise; return dispatch(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', undefined, { tab: 'info' }); await settle();
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const field = new FakeTarget(h.harness.doc, { dataset: { action: 'maker-summary' } });
    field.parent = mount; field.focus(); mount.fire('focusin', { target: field });
    const markup = mount.innerHTML;
    field.value = 'Complete introduction'; mount.fire('input', { target: field });
    assert.equal(mount.innerHTML, markup);
    const close = new FakeTarget(h.harness.doc, { dataset: { action: 'close-tool' } }); close.parent = mount;
    mount.fire('pointerdown', { target: close, button: 0, pointerId: 7 });
    mount.fire('change', { target: field });
    h.harness.doc.activeElement = close; mount.fire('focusout', { target: field, relatedTarget: close });
    gate.resolve(); await settle();
    assert.equal(mount.innerHTML, markup, 'the pending Close node must survive saving');
    mount.fire('click', { target: close }); await settle();
    assert.equal(app.getState().creatorTab, 'structure');
    assert.equal(h.harness.calls.dispatch.at(-1).command.metadata.summary, field.value);
    assert.doesNotMatch(mount.innerHTML, /role="dialog"/);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator blur submits changed text even without a preceding native change event', async () => {
  for (const action of ['maker-creator', 'maker-style']) {
    const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.fire('creator-tab', undefined, { tab: 'info' }); await settle();
      const mount = h.harness.doc.getElementById('makerV4CreatorMount');
      const field = new FakeTarget(h.harness.doc, { dataset: { action } });
      field.parent = mount; field.value = ''; field.focus(); mount.fire('focusin', { target: field });
      field.value = 'Pasted public text'; mount.fire('input', { target: field });
      const close = new FakeTarget(h.harness.doc, { dataset: { action: 'close-tool' } }); close.parent = mount;
      mount.fire('pointerdown', { target: close, button: 0, pointerId: 8 });
      h.harness.doc.activeElement = close; mount.fire('focusout', { target: field, relatedTarget: close });
      mount.fire('click', { target: close }); await settle(); await settle();
      assert.equal(h.saved().draft.document.metadata[action === 'maker-creator' ? 'creator' : 'style'], field.value);
      assert.equal(h.harness.calls.dispatch.length, 1);
    } finally { app.destroy(); }
  }
});

test('Creator conflict keeps exact unsaved text visible and explicitly saves a separate recovery copy', async () => {
  const h = pngEditorHarness(); const original = h.saved(), calls = [];
  h.harness.win.crypto = { randomUUID: () => '11111111-2222-4333-8444-555555555555' };
  h.harness.bridge.dispatchDraftCommand = async () => { throw new Error('Maker draft changed in another tab.'); };
  let copied;
  h.harness.bridge.recoverDraftCopy = async input => {
    calls.push(structuredClone(input));
    copied = { draft: { ...original.draft, draftId: input.draftId, document: input.document },
      assets: input.assets.map(row => ({ ...row, draftId: input.draftId })) };
    return structuredClone(copied);
  };
  h.harness.bridge.listDrafts = async () => copied ? [copied.draft, original.draft] : [original.draft];
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.change('maker-summary', 'Keep this exact conflicting text'); await settle();
    h.fire('creator-tab', undefined, { tab: 'info' }); await settle();
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    assert.match(mount.innerHTML, /Keep this exact conflicting text/);
    assert.match(mount.innerHTML, /data-action="save-recovery-copy"/);
    assert.deepEqual(h.saved(), original, 'failed write never modifies the source');
    h.fire('save-recovery-copy'); await settle(); await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceDraftId, 'approved-maker');
    assert.equal(app.getState().draftId, 'maker-recovery-11111111-2222-4333-8444-555555555555');
    assert.equal(copied.draft.document.metadata.summary, 'Keep this exact conflicting text');
    assert.deepEqual(calls[0].assets, original.assets);
    assert.deepEqual(h.saved(), original);
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
    assert.match(h.harness.doc.getElementById('imageMakerList').innerHTML, /Local recovery copy/);
    assert.doesNotMatch(mount.innerHTML, /data-action="save-recovery-copy"/);
  } finally { app.destroy(); }
});

test('Creator recovery copy is single-flight and retries uncertain results with the exact same identity', async () => {
  const h = pngEditorHarness(), original = h.saved(), gate = deferred(), calls = [];
  h.harness.win.crypto = { randomUUID: () => '11111111-2222-4333-8444-555555555555' };
  h.harness.bridge.dispatchDraftCommand = async () => { throw new Error('CAS conflict'); };
  h.harness.bridge.recoverDraftCopy = async input => {
    calls.push(structuredClone(input));
    if (calls.length === 1) { await gate.promise; throw new Error('acknowledgement unavailable'); }
    return { draft: { ...original.draft, draftId: input.draftId, document: input.document },
      assets: input.assets.map(row => ({ ...row, draftId: input.draftId })) };
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.change('maker-summary', 'exact pending snapshot'); await settle();
    h.fire('save-recovery-copy'); h.fire('save-recovery-copy'); await settle();
    assert.equal(calls.length, 1);
    h.change('maker-summary', 'ignored while saving recovery');
    gate.resolve(); await settle();
    assert.equal(app.getState().draftId, 'approved-maker');
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
    h.fire('save-recovery-copy'); await settle(); await settle();
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(app.getState().draftId, calls[0].draftId);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator recovery copy rejects incorrect artwork and cannot install a late wallet-ABA result', async () => {
  for (const boundary of ['artwork', 'wallet', 'navigation']) {
    const h = pngEditorHarness(), original = h.saved(), gate = deferred();
    h.harness.win.crypto = { randomUUID: () => '11111111-2222-4333-8444-555555555555' };
    h.harness.bridge.dispatchDraftCommand = async () => { throw new Error('CAS conflict'); };
    h.harness.bridge.recoverDraftCopy = async input => {
      await gate.promise;
      return { draft: { ...original.draft, draftId: input.draftId, document: input.document },
        assets: boundary === 'artwork' ? [] : input.assets.map(row => ({ ...row, draftId: input.draftId })) };
    };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.change('maker-summary', 'Keep local content'); await settle(); h.fire('save-recovery-copy'); await settle();
      if (boundary === 'wallet') { app.refreshConnection(null); app.refreshConnection(h.connection); }
      if (boundary === 'navigation') app.navigate('docs');
      gate.resolve(); await settle(); await settle();
      assert.equal(app.getState().draftId, 'approved-maker');
      assert.deepEqual(h.saved(), original);
      assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
      assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /data-save-phase="error"/);
    } finally { gate.resolve(); app.destroy(); }
  }
});

test('Creator recovery waiting to start cannot override a later navigation or wallet intent', async () => {
  for (const boundary of ['navigation', 'wallet']) {
    const h = pngEditorHarness(); let calls = 0;
    h.harness.bridge.dispatchDraftCommand = async () => { throw new Error('CAS conflict'); };
    h.harness.bridge.recoverDraftCopy = async () => { calls += 1; throw new Error('must not start'); };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.change('maker-summary', 'pending local text'); await settle();
      h.fire('save-recovery-copy');
      if (boundary === 'navigation') app.navigate('docs');
      else { app.refreshConnection(null); app.refreshConnection(h.connection); }
      await settle();
      assert.equal(calls, 0);
      assert.equal(app.getState().draftId, 'approved-maker');
      assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
    } finally { app.destroy(); }
  }
});

test('Creator failed saves block Library, navigation and reopen while keeping Save retry and unload warning', async () => {
  const h = pngEditorHarness(), write = h.harness.bridge.replaceDraftDocument;
  let fail = true;
  h.harness.bridge.replaceDraftDocument = async input => { if (fail) throw new Error('disk full'); return write(input); };
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.change('style-x', '80'); await settle();
    h.fire('back-library'); await settle();
    assert.equal(editor.classList.contains('active'), true);
    assert.equal(app.navigate('docs'), 'creator'); await settle();
    assert.equal(await app.openDraft('approved-maker'), null);
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /disk full/);
    fail = false; h.fire('save'); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.x, 80);
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
    h.fire('back-library'); await settle();
    assert.equal(editor.classList.contains('active'), false);
    await app.openDraft('approved-maker');
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.x, 80);
  } finally { app.destroy(); }
});

test('Creator Library and reopen drain every queued edit rather than dropping the second coordinate', async () => {
  const h = pngEditorHarness(), write = h.harness.bridge.replaceDraftDocument, gate = deferred();
  let calls = 0;
  h.harness.bridge.replaceDraftDocument = async input => { if (++calls === 1) await gate.promise; return write(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.change('style-x', '80'); h.change('style-y', '40'); await settle();
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
    h.fire('back-library');
    const reopening = app.openDraft('approved-maker');
    gate.resolve(); await reopening; await settle();
    assert.equal(calls, 2);
    assert.deepEqual(h.saved().draft.document.parts[0].items[0].styles[0].transform, { x: 80, y: 40, scale: 1, rotation: 0 });
    assert.equal(app.getState().revision, 3);
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator focused text warns on unload and internal navigation commits it without waiting for blur', async () => {
  const h = pngEditorHarness(); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const field = new FakeTarget(h.harness.doc, { dataset: { action: 'maker-name' } });
    field.parent = mount; field.value = 'Approved Maker'; field.focus(); mount.fire('focusin', { target: field });
    field.value = 'Unblurred name';
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
    assert.equal(h.harness.calls.dispatch.length, 0, 'unload is a warning, not an asynchronous save claim');
    assert.equal(app.navigate('docs'), 'creator'); await settle(); await settle();
    assert.equal(app.getState().route, 'docs');
    assert.equal(h.harness.calls.dispatch.at(-1).command.metadata.name, 'Unblurred name');
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
  } finally { app.destroy(); }
});

test('Creator invalid numeric input cannot masquerade as saved on navigation or blur', async () => {
  const document = structuredClone(draftRecord().document);
  document.parts[0].items[0].styles[0].payload.animacraftEditor = { positionConfirmed: false };
  const h = pngEditorHarness({ document }); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const field = new FakeTarget(h.harness.doc, { dataset: { action: 'style-x' } });
    field.parent = mount; field.value = '0'; field.focus(); mount.fire('focusin', { target: field });
    field.value = '99999';
    app.navigate('docs'); await settle();
    assert.equal(app.getState().route, 'creator'); assert.equal(h.writes.length, 0);
    mount.fire('change', { target: field }); mount.fire('focusout', { target: field }); await settle();
    app.navigate('docs'); await settle();
    assert.equal(app.getState().route, 'creator');
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, true);
    assert.match(mount.innerHTML, /data-save-phase="error"/);
    field.focus(); mount.fire('focusin', { target: field });
    field.value = '0'; mount.fire('change', { target: field }); await settle();
    mount.fire('focusout', { target: field }); h.fire('save'); await settle();
    assert.equal(app.navigate('docs'), 'docs');
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.x, 0);
    assert.equal(h.writes.length, 0, 'returning to the saved valid value needs no new revision');
  } finally { app.destroy(); }
});

test('Creator latest navigation or draft-open intent wins while saves drain', async () => {
  for (const latest of ['open', 'navigate']) {
    const h = pngEditorHarness(), gate = deferred(), write = h.harness.bridge.replaceDraftDocument;
    h.harness.bridge.replaceDraftDocument = async input => { await gate.promise; return write(input); };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.change('style-x', '80'); await settle();
      let opening;
      if (latest === 'open') { app.navigate('docs'); opening = app.openDraft('approved-maker'); }
      else { opening = app.openDraft('approved-maker'); app.navigate('docs'); }
      gate.resolve(); const result = await opening; await settle();
      assert.equal(app.getState().route, latest === 'open' ? 'creator' : 'docs');
      if (latest === 'navigate') assert.equal(result, null);
      assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].transform.x, 80);
    } finally { gate.resolve(); app.destroy(); }
  }
});

test('Creator valid unchanged capacity and default clear only validation errors', async () => {
  for (const action of ['part-capacity', 'part-default']) {
    const h = pngEditorHarness(); const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      const mount = h.harness.doc.getElementById('makerV4CreatorMount');
      const field = new FakeTarget(h.harness.doc, { dataset: { action, partId: 'base' } }); field.parent = mount;
      field.value = action === 'part-capacity' ? '0' : '';
      mount.fire('change', { target: field }); await settle();
      assert.match(mount.innerHTML, /data-save-phase="error"/);
      field.value = action === 'part-capacity' ? '1' : 'default';
      mount.fire('change', { target: field }); await settle();
      assert.equal(app.navigate('docs'), 'docs');
      assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
      assert.equal(h.writes.length, 0);
    } finally { app.destroy(); }
  }
});

test('Creator Escape explicitly commits its focused text even without a native blur event', async () => {
  const h = pngEditorHarness(); const app = createOriginalProductApp(h.harness);
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', undefined, { tab: 'info' }); await settle();
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const field = new FakeTarget(h.harness.doc, { dataset: { action: 'maker-summary' } });
    field.parent = mount; field.focus(); mount.fire('focusin', { target: field }); field.value = 'Escape retained';
    h.harness.doc.fire('keydown', { key: 'Escape' }); await settle(); await settle();
    assert.equal(app.getState().creatorTab, 'structure');
    assert.equal(h.harness.calls.dispatch.at(-1).command.metadata.summary, 'Escape retained');
    assert.equal(h.harness.win.fire('beforeunload').defaultPrevented, undefined);
  } finally { app.destroy(); }
});

test('Creator Space navigation gesture cannot move a Style and keyup restores dragging', async () => {
  const h = pngEditorHarness(), previews = [];
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  h.harness.bridge.renderDraftPreview = async input => { previews.push(input); return canonicalPreview(); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); h.fire('edit-position');
    const mount = h.harness.doc.getElementById('makerV4CreatorMount'), canvas = h.harness.doc.getElementById('makerV4CreatorCanvas');
    canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
    canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
    const drag = () => {
      mount.fire('pointerdown', { target: canvas, pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      mount.fire('pointermove', { target: canvas, pointerId: 1, clientX: 30, clientY: 40 });
    };
    h.harness.doc.fire('keydown', { key: ' ', code: 'Space', target: canvas }); drag();
    mount.fire('pointerup', { target: canvas, pointerId: 1 }); await settle();
    assert.equal(h.writes.length, 0); assert.ok(!previews.at(-1).stylePreview);
    h.harness.doc.fire('keyup', { key: ' ', code: 'Space' }); drag(); await settle();
    assert.ok(previews.at(-1).stylePreview);
    h.harness.win.fire('blur', {}); mount.fire('pointerup', { target: canvas, pointerId: 1 }); await settle();
    assert.equal(h.writes.length, 0, 'losing window focus cancels the active drag');
    drag(); mount.fire('pointerup', { target: canvas, pointerId: 1 }); await settle();
    assert.equal(h.writes.length, 1);
  } finally { app.destroy(); }
});

function defaultEditorDocument({ capacity = 1, required = true, assetization = false } = {}) {
  const document = structuredClone(draftRecord().document);
  const part = document.parts[0]; part.capacity = capacity; part.required = required;
  if (!required) part.kind = 'STANDARD';
  document.composition.itemAssetization = assetization;
  if (assetization) document.composition.mode = 'COMPOSABLE';
  const style = structuredClone(part.items[0].styles[0]); style.key = 'alternate'; style.label = 'Alternate'; style.displayOrder = 1;
  part.items[0].styles.push(style);
  const second = structuredClone(part.items[0]); second.key = 'second'; second.label = 'Second'; second.displayOrder = 1;
  part.items.push(second);
  return document;
}

test('Creator defaults persist through Undo/Redo and reopen without changing assets or selection-only intent', async () => {
  const h = pngEditorHarness({ document: defaultEditorDocument() }); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const original = h.saved();
    h.fire('select-item', undefined, { itemId: 'second' });
    h.fire('select-style', undefined, { styleId: 'alternate' }); await settle();
    assert.deepEqual(h.saved(), original, 'preview selection is not an authored default');
    const html = h.harness.doc.getElementById('makerV4CreatorMount').innerHTML;
    assert.match(html, /data-action="part-default"(?![^>]*disabled)/);
    assert.match(html, /data-action="set-default-style"(?![^>]*disabled)/);
    h.fire('set-default-style'); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[1].defaultStyleKey, 'alternate');
    assert.deepEqual(h.saved().draft.document.defaultRecipe, original.draft.document.defaultRecipe,
      'setting a non-default Item Style does not add that Item to the recipe');
    h.change('part-default', 'second'); await settle();
    const after = h.saved();
    assert.deepEqual(after.draft.document.defaultRecipe.selections, [{ partKey: 'base', itemKey: 'second', styleKey: 'alternate' }]);
    assert.deepEqual(after.assets, original.assets);
    const count = h.writes.length;
    h.change('part-default', 'second'); h.fire('set-default-style'); await settle();
    assert.equal(h.writes.length, count, 'duplicate defaults do not write redundant history');
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document.defaultRecipe, original.draft.document.defaultRecipe);
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document, original.draft.document);
    h.fire('redo'); await settle(); h.fire('redo'); await settle();
    assert.deepEqual(h.saved().draft.document, after.draft.document);
    await app.openDraft('approved-maker');
    h.fire('select-item', undefined, { itemId: 'default' }); await settle();
    h.fire('select-item', undefined, { itemId: 'second' }); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Second › Alternate/);
    assert.equal(h.saved().draft.document.defaultRecipe.selections[0].styleKey, 'alternate');
  } finally { app.destroy(); }
});

test('Creator defaults preserve additional slots and colors and reject invalid required/owned selections', async () => {
  const document = defaultEditorDocument({ capacity: 3 });
  const other = structuredClone(document.parts[0]); other.key = 'other'; other.label = 'Other'; other.renderOrder = 1; other.menuOrder = 1;
  document.parts.push(other);
  document.colors = [{ key: 'tone', label: 'Tone', defaultSwatchKey: 'red', swatches: [{ key: 'red', label: 'Red', rgba: '#FF0000FF', stops: [] }] }];
  document.defaultRecipe.colors = [{ channelKey: 'tone', swatchKey: 'red' }];
  document.defaultRecipe.selections.push({ partKey: 'base', itemKey: 'default', styleKey: 'default' },
    { partKey: 'other', itemKey: 'second', styleKey: 'alternate' });
  const h = pngEditorHarness({ document }); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('select-style', undefined, { styleId: 'alternate' }); h.fire('set-default-style'); await settle();
    assert.deepEqual(h.saved().draft.document.defaultRecipe.selections.slice(0, 2).map(row => row.styleKey), ['alternate', 'alternate']);
    h.change('part-default', 'second'); await settle();
    assert.deepEqual(h.saved().draft.document.defaultRecipe.selections, [
      { partKey: 'base', itemKey: 'second', styleKey: 'default' },
      { partKey: 'base', itemKey: 'default', styleKey: 'alternate' }, document.defaultRecipe.selections[2],
    ]);
    assert.deepEqual(h.saved().draft.document.defaultRecipe.colors, document.defaultRecipe.colors);
    const beforeInvalid = h.saved(), writes = h.writes.length;
    h.change('part-default', ''); await settle();
    assert.deepEqual(h.saved(), beforeInvalid); assert.equal(h.writes.length, writes);
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /required Part needs a default Item/);
    h.change('part-default', 'missing'); await settle(); assert.equal(h.writes.length, writes);
  } finally { app.destroy(); }
  const owned = defaultEditorDocument({ capacity: 2, assetization: true });
  owned.defaultRecipe.selections.push({ partKey: 'base', itemKey: 'second', styleKey: 'default' });
  const h2 = pngEditorHarness({ document: owned }); const app2 = createOriginalProductApp(h2.harness);
  try {
    await app2.ready; await app2.openDraft('approved-maker'); app2.navigate('creator');
    h2.change('part-default', 'second'); await settle();
    assert.equal(h2.writes.length, 0); assert.deepEqual(h2.saved().draft.document.defaultRecipe, owned.defaultRecipe);
  } finally { app2.destroy(); }
});

test('Creator optional default None clears only its Part and can be restored', async () => {
  const document = defaultEditorDocument({ capacity: 2, required: false });
  document.defaultRecipe.selections.push({ partKey: 'base', itemKey: 'second', styleKey: 'alternate' });
  const h = pngEditorHarness({ document }); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.change('part-default', ''); await settle(); assert.deepEqual(h.saved().draft.document.defaultRecipe.selections, []);
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document.defaultRecipe, document.defaultRecipe);
    h.fire('redo'); await settle(); h.change('part-default', 'second'); await settle();
    assert.deepEqual(h.saved().draft.document.defaultRecipe.selections, [{ partKey: 'base', itemKey: 'second', styleKey: 'default' }]);
  } finally { app.destroy(); }
});

test('Creator failed and queued defaults retain exact history and later explicit selection', async () => {
  const h = pngEditorHarness({ document: defaultEditorDocument() });
  const write = h.harness.bridge.replaceDraftDocument; let fail = true;
  const gate = deferred(), started = deferred(); let pause = false;
  h.harness.bridge.replaceDraftDocument = async input => {
    if (fail) { fail = false; throw new Error('default save unavailable'); }
    if (pause) { pause = false; started.resolve(); await gate.promise; }
    return write(input);
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved(); h.change('part-default', 'second'); await settle();
    assert.deepEqual(h.saved(), before);
    h.fire('select-item', undefined, { itemId: 'default' }); h.fire('save'); await settle();
    assert.equal(h.saved().draft.document.defaultRecipe.selections[0].itemKey, 'second');
    h.fire('undo'); await settle(); assert.deepEqual(h.saved().draft.document, before.draft.document);
    h.fire('redo'); await settle();
    pause = true;
    h.change('part-default', 'default'); await started.promise;
    h.change('part-default', 'second');
    h.fire('select-item', undefined, { itemId: 'default' });
    h.fire('select-style', undefined, { styleId: 'alternate' });
    gate.resolve(); await settle(); await settle();
    assert.equal(h.saved().draft.document.defaultRecipe.selections[0].itemKey, 'second');
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Default › Alternate/);
    h.fire('undo'); await settle(); assert.equal(h.saved().draft.document.defaultRecipe.selections[0].itemKey, 'default');
    h.fire('undo'); await settle(); assert.equal(h.saved().draft.document.defaultRecipe.selections[0].itemKey, 'second');
  } finally { gate.resolve(); app.destroy(); }
});

test('Maker Info public text persists, clears, rejects invalid bytes and ignores temporary display overrides', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    h.change('maker-creator', '作者 S2'); await settle();
    h.change('maker-style', '科幻 / Cel shading'); await settle();
    assert.equal(h.saved().draft.document.metadata.creator, '作者 S2');
    assert.equal(h.saved().draft.document.metadata.style, '科幻 / Cel shading');
    assert.deepEqual(h.saved().assets, before.assets);
    h.fire('creator-tab', null, { tab: 'info' }); await settle();
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /value="作者 S2" data-action="maker-creator"/);
    await app.openDraft('approved-maker');
    assert.equal(h.saved().draft.document.metadata.style, '科幻 / Cel shading');
    h.change('maker-creator', '界'.repeat(43)); await settle();
    assert.equal(h.saved().draft.document.metadata.creator, '作者 S2', '129 UTF-8 bytes cannot commit');
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /data-save-phase="error"/);
    h.change('maker-creator', 'Recovered author'); await settle();
    assert.equal(h.saved().draft.document.metadata.creator, 'Recovered author');
    h.change('maker-style', ''); await settle();
    assert.equal(Object.hasOwn(h.saved().draft.document.metadata, 'style'), false);
    h.fire('undo'); await settle();
    assert.equal(h.saved().draft.document.metadata.style, '科幻 / Cel shading');
  } finally { app.destroy(); }
});

test('Maker cover upload, replacement, removal and Undo/Redo retain all layer bytes', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    assert.equal(h.fire('maker-cover', h.file).value, ''); await settle(); await settle();
    const first = h.saved(), firstId = first.draft.document.metadata.coverAssetId;
    assert.ok(firstId); assert.equal(first.assets.length, 2);
    assert.deepEqual(first.draft.document.parts, before.draft.document.parts);
    assert.deepEqual(first.assets.find(row => row.assetId === before.assets[0].assetId), before.assets[0]);
    const replacement = Uint8Array.from([...new Uint8Array(await h.file.arrayBuffer()), 0]);
    h.fire('maker-cover', { ...h.file, size: replacement.length, arrayBuffer: async () => replacement.buffer });
    await settle(); await settle();
    const second = h.saved();
    assert.notEqual(second.draft.document.metadata.coverAssetId, firstId);
    assert.equal(second.assets.length, 2, 'exclusive replaced cover is removed atomically');
    assert.equal(second.draft.document.assets.some(row => row.id === firstId), false);
    h.fire('remove-maker-cover'); await settle(); await settle();
    assert.equal(h.saved().draft.document.metadata.coverAssetId, null);
    assert.deepEqual(h.saved().assets, before.assets);
    h.fire('undo'); await settle(); await settle();
    assert.deepEqual(h.saved().draft.document, second.draft.document);
    assert.deepEqual(h.saved().assets, second.assets);
    h.fire('redo'); await settle(); await settle();
    assert.deepEqual(h.saved().draft.document, before.draft.document);
    assert.deepEqual(h.saved().assets, before.assets);
    await app.openDraft('approved-maker');
    assert.equal(h.saved().draft.document.metadata.coverAssetId, null);
  } finally { app.destroy(); }
});

test('Maker cover Library preview survives text saves and is cleared on removal', async () => {
  const h = pngEditorHarness();
  h.harness.win.URL = { createObjectURL: () => 'blob:cover-preview', revokeObjectURL() {} };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('maker-cover', h.file); await settle(); await settle();
    const list = h.harness.doc.getElementById('imageMakerList');
    assert.match(list.innerHTML, /<img src="blob:cover-preview"/);
    h.change('maker-creator', 'Author'); await settle();
    h.change('maker-style', 'World'); await settle();
    assert.match(list.innerHTML, /<img src="blob:cover-preview"/);
    assert.match(list.innerHTML, /by Author/);
    h.fire('remove-maker-cover'); await settle(); await settle();
    assert.doesNotMatch(list.innerHTML, /<img src="blob:cover-preview"/);
  } finally { app.destroy(); }
});

test('Maker cover Library reloads after wallet reconnect and discards stale asset responses', async () => {
  const h = pngEditorHarness();
  let serial = 0;
  const revoked = [];
  h.harness.win.URL = { createObjectURL: () => `blob:cover-${++serial}`,
    revokeObjectURL: url => revoked.push(url) };
  h.harness.bridge.listDrafts = async () => [h.saved().draft];
  let assetGate = null;
  h.harness.bridge.getDraft = async () => {
    if (assetGate) { const gate = assetGate; assetGate = null; return gate.promise; }
    return h.saved();
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('maker-cover', h.file); await settle(); await settle();
    const list = h.harness.doc.getElementById('imageMakerList');
    const saved = h.saved();
    assert.match(list.innerHTML, /<img src="blob:cover-/);
    app.refreshConnection(null);
    assert.doesNotMatch(list.innerHTML, /<img src="blob:cover-/);
    assert.ok(revoked.length > 0);
    const delayed = deferred(); assetGate = delayed;
    app.refreshConnection(h.connection); await settle();
    app.refreshConnection(null);
    app.refreshConnection(h.connection); await settle(); await settle();
    assert.match(list.innerHTML, /<img src="blob:cover-/);
    const currentHtml = list.innerHTML, count = serial, revokedCount = revoked.length;
    delayed.resolve(saved); await settle(); await settle();
    assert.equal(list.innerHTML, currentHtml);
    assert.equal(serial, count, 'stale request cannot install a new cover');
    assert.equal(revoked.length, revokedCount, 'stale request cannot revoke the current cover');
    assert.deepEqual(h.saved(), saved, 'reconnection only reads the saved draft');
  } finally { app.destroy(); }
});

test('wallet auto-connect during initial draft read cannot leave Library loading forever', async () => {
  const record = draftRecord(), initialRead = deferred();
  const harness = browserHarness({ connection: null, record, draftsResult: [record] });
  let reads = 0;
  harness.bridge.listDrafts = async () => ++reads === 1 ? initialRead.promise : [record];
  const app = createOriginalProductApp(harness);
  try {
    await settle();
    assert.equal(reads, 1);
    app.refreshConnection({ account: { address: ROOT_ONE, chains: ['sui:mainnet'] } });
    initialRead.resolve([record]);
    await app.localReady; await settle();
    assert.equal(app.getState().draftsStatus, 'ready');
    assert.match(harness.doc.getElementById('imageMakerList').innerHTML, /Approved Maker/);
  } finally { initialRead.resolve([record]); app.destroy(); }
});

test('Maker cover invalid input and failed CAS retain the saved cover and show recoverable error', async () => {
  for (const failure of ['mime', 'large', 'header', 'decode', 'write']) {
    const h = pngEditorHarness();
    let rejectWrite = false;
    const dispatch = h.harness.bridge.dispatchDraftTransaction;
    h.harness.bridge.dispatchDraftTransaction = async input => {
      if (rejectWrite) throw new Error('CAS conflict');
      return dispatch(input);
    };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.fire('maker-cover', h.file); await settle(); await settle();
      const before = h.saved();
      h.fire('creator-tab', null, { tab: 'info' }); await settle();
      if (failure === 'decode') h.harness.win.createImageBitmap = async () => { throw new Error('decode failed'); };
      if (failure === 'write') rejectWrite = true;
      const bytes = Uint8Array.from([...new Uint8Array(await h.file.arrayBuffer()), 1]);
      const file = { ...h.file, size: bytes.length, arrayBuffer: async () => bytes.buffer,
        ...(failure === 'mime' ? { type: 'image/jpeg' } : {}),
        ...(failure === 'large' ? { size: 5 * 1024 * 1024 + 1 } : {}),
        ...(failure === 'header' ? { arrayBuffer: async () => new Uint8Array(bytes.length).buffer } : {}),
      };
      h.fire('maker-cover', file); await settle(); await settle();
      assert.deepEqual(h.saved(), before, failure);
      assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /v4-maker-cover-save-status error/, failure);
    } finally { app.destroy(); }
  }
});

test('Maker cover delayed reads reject navigation, wallet ABA and draft changes', async () => {
  for (const stale of ['navigation', 'wallet', 'draft']) {
    const h = pngEditorHarness(), gate = deferred(), app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.fire('maker-cover', { ...h.file, arrayBuffer: () => gate.promise }); await settle();
      if (stale === 'navigation') { app.navigate('docs'); app.navigate('creator'); }
      if (stale === 'wallet') { app.refreshConnection(null); app.refreshConnection(h.connection); }
      if (stale === 'draft') await app.openDraft('approved-maker');
      gate.resolve(await h.file.arrayBuffer()); await settle(); await settle();
      assert.equal(h.writes.length, 0, stale);
      assert.equal(h.saved().draft.document.metadata.coverAssetId, null);
    } finally { gate.resolve(await h.file.arrayBuffer()); app.destroy(); }
  }
});

test('Creator PNG replacement saves bytes and Undo/Redo restores complete snapshots before reopen', async () => {
  const h = pngEditorHarness(); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    assert.equal(h.fire('style-asset', h.file).value, '', 'reselecting the same file can retry');
    await settle(); await settle();
    const after = h.saved(); assert.equal(h.writes.length, 1);
    assert.notEqual(after.assets[0].bytesBase64, before.assets[0].bytesBase64);
    const expectedAfter = structuredClone(before);
    const replacement = Buffer.from(await h.file.arrayBuffer());
    expectedAfter.draft.revision += 1;
    expectedAfter.draft.document.assets[0].byteLength = replacement.length;
    const replacedStyle = expectedAfter.draft.document.parts[0].items[0].styles[0];
    replacedStyle.transform = { x: 512, y: 512, scale: 1, rotation: 0 };
    replacedStyle.payload.animacraftEditor = { positionConfirmed: false };
    Object.assign(expectedAfter.assets[0], { expectedRevision: before.assets[0].revision,
      revision: before.assets[0].revision + 1, byteLength: replacement.length,
      bytesBase64: replacement.toString('base64') });
    assert.deepEqual(after, expectedAfter, 'unlocked replacement centers the full 1×1 PNG and changes no unrelated snapshot fields');
    h.fire('undo'); await settle();
    assert.deepEqual(h.saved(), { ...before, draft: { ...before.draft, revision: after.draft.revision + 1 } });
    assert.deepEqual(h.saved().assets, before.assets);
    h.fire('redo'); await settle();
    assert.deepEqual(h.saved(), { ...expectedAfter, draft: { ...expectedAfter.draft, revision: after.draft.revision + 2 } });
    assert.deepEqual(h.saved().assets, after.assets);
    await app.openDraft('approved-maker');
    assert.equal(app.getState().revision, 4);
    assert.deepEqual(h.saved(), { ...expectedAfter, draft: { ...expectedAfter.draft, revision: 4 } });
  } finally { app.destroy(); }
});

test('Creator Add Part, Item and Style save pending PNGs and first uploads with exact mixed Undo/Redo', async () => {
  const h = pngEditorHarness(); const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); const before = h.saved();
    const act = async action => { h.fire(action, action === 'style-asset' ? h.file : undefined); await settle(); await settle(); };
    await act('add-part');
    assert.equal(h.saved().draft.document.parts.length, 2);
    assert.equal(h.saved().draft.document.parts[1].items[0].styles[0].assetId, null);
    assert.equal(h.saved().assets.length, 1, 'adding a row does not fabricate or copy artwork');
    await act('style-asset');
    assert.equal(h.saved().assets.length, 2);
    await act('add-item'); await act('style-asset');
    await act('add-style'); await act('style-asset');
    const after = h.saved();
    assert.equal(after.draft.document.parts[1].items.length, 2);
    assert.equal(after.draft.document.parts[1].items[1].styles.length, 2);
    assert.equal(after.assets.length, 4);
    assert.deepEqual(after.assets[0], before.assets[0]);
    assert.deepEqual(after.draft.document.defaultRecipe.selections[0], before.draft.document.defaultRecipe.selections[0]);
    await act('undo');
    assert.equal(h.saved().draft.document.parts[1].items[1].styles[1].assetId, null);
    assert.equal(h.saved().assets.length, 3);
    await act('undo'); assert.equal(h.saved().draft.document.parts[1].items[1].styles.length, 1);
    await act('redo'); await act('redo');
    assert.deepEqual(h.saved().draft.document, after.draft.document);
    assert.deepEqual(h.saved().assets, after.assets);
    await app.openDraft('approved-maker');
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Part 2/);
  } finally { app.destroy(); }
});

test('delayed Creator additions have unique keys and cannot steal a later explicit selection', async () => {
  const h = pngEditorHarness(); const gate = deferred();
  const write = h.harness.bridge.replaceDraftDocument;
  let calls = 0;
  h.harness.bridge.replaceDraftDocument = async input => { if (++calls === 1) await gate.promise; return write(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('add-part'); h.fire('add-part'); await settle();
    h.fire('select-part', undefined, { partId: 'base' });
    gate.resolve(); await settle(); await settle();
    const parts = h.saved().draft.document.parts;
    assert.equal(parts.length, 3); assert.equal(new Set(parts.map(row => row.key)).size, 3);
    h.fire('style-asset', h.file); await settle(); await settle();
    assert.equal(h.saved().assets.length, 1, 'explicit Base selection remains selected, so its existing PNG is replaced');
    assert.equal(h.saved().draft.document.parts[1].items[0].styles[0].assetId, null);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator copies and deletes Parts, Items and Styles with exact asset Undo/Redo and confirmation', async () => {
  const h = pngEditorHarness();
  let confirm = true;
  const prompts = [];
  h.harness.win.confirm = message => { prompts.push(message); return confirm; };
  const app = createOriginalProductApp(h.harness);
  const act = async (action, dataset) => {
    h.fire(action, action === 'style-asset' ? h.file : undefined, dataset);
    await settle(); await settle();
  };
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    await act('copy-part'); assert.equal(h.saved().draft.document.parts.length, 2);
    await act('copy-item'); assert.equal(h.saved().draft.document.parts[1].items.length, 2);
    await act('copy-style'); assert.equal(h.saved().draft.document.parts[1].items[1].styles.length, 2);
    await act('style-asset');
    const withImage = h.saved();
    assert.equal(withImage.assets.length, 2);
    assert.equal(withImage.assets[0].bytesBase64, before.assets[0].bytesBase64, 'copy-on-write retains source PNG');
    confirm = false;
    await act('delete-style'); assert.deepEqual(h.saved(), withImage, 'cancel has no persistence');
    confirm = true;
    await act('delete-style');
    assert.equal(h.saved().assets.length, 1, 'only the deleted exclusive PNG is pruned');
    await act('undo');
    assert.deepEqual(h.saved().draft.document, withImage.draft.document);
    assert.deepEqual(h.saved().assets, withImage.assets);
    await act('redo'); assert.equal(h.saved().assets.length, 1);
    const copiedPart = h.saved().draft.document.parts[1];
    await act('delete-item', { partId: copiedPart.key, itemId: copiedPart.items[1].key });
    assert.equal(h.saved().draft.document.parts[1].items.length, 1);
    await act('delete-part', { partId: copiedPart.key });
    const afterRemoval = { ...before.draft.document,
      tracks: withImage.draft.document.tracks.filter(track => track.locked) };
    assert.deepEqual(h.saved().draft.document, afterRemoval, 'explicitly locked cloned Tracks survive removal');
    assert.equal(h.saved().assets[0].bytesBase64, before.assets[0].bytesBase64);
    await act('delete-style', { partId: 'base', itemId: 'default', styleId: 'default' });
    assert.equal(h.saved().draft.document.parts[0].items[0].styles.length, 0);
    assert.equal(h.saved().assets.length, 0);
    await act('undo'); assert.deepEqual(h.saved().draft.document, afterRemoval);
    assert.deepEqual(h.saved().assets, before.assets);
    assert.ok(prompts.some(message => message.includes('style')));
  } finally { app.destroy(); }
});

test('Creator structure snapshot failures retry without losing history and pending duplicate clicks write once', async () => {
  const h = pngEditorHarness(); const write = h.harness.bridge.replaceDraftSnapshot;
  const gate = deferred(); let attempts = 0;
  h.harness.bridge.replaceDraftSnapshot = async input => {
    attempts += 1;
    if (attempts === 1) throw new Error('Temporary structure save failure');
    if (attempts === 2) await gate.promise;
    return write(input);
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('copy-part'); await settle(); await settle();
    assert.equal(h.saved().draft.document.parts.length, 1);
    assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Temporary structure save failure/);
    h.fire('copy-part'); await settle(); h.fire('copy-part');
    assert.equal(attempts, 2);
    gate.resolve(); await settle(); await settle();
    assert.equal(h.saved().draft.document.parts.length, 2);
    h.fire('undo'); await settle(); await settle();
    assert.equal(h.saved().draft.document.parts.length, 1, 'one successful mutation produces exactly one Undo entry');
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator committed structure keeps Undo when wallet ABA invalidates only its pending preview', async () => {
  const h = pngEditorHarness();
  const preview = h.harness.bridge.renderDraftPreview;
  const gate = deferred(); const started = deferred(); let suspend = false;
  h.harness.bridge.renderDraftPreview = async input => {
    if (suspend) { suspend = false; started.resolve(); await gate.promise; }
    return preview(input);
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    suspend = true; h.fire('copy-part'); await started.promise;
    assert.equal(h.saved().draft.document.parts.length, 2, 'mutation committed before preview waits');
    app.refreshConnection({ account: { address: `0x${'42'.repeat(32)}`, chains: ['sui:mainnet'] } });
    app.refreshConnection(h.connection);
    gate.resolve(); await settle(); await settle();
    h.fire('undo'); await settle(); await settle();
    assert.equal(h.saved().draft.document.parts.length, 1);
  } finally { gate.resolve(); app.destroy(); }
});

test('failed Creator addition retries with one Undo entry and respects later selection intent', async () => {
  for (const selectLater of [false, true]) {
    const h = pngEditorHarness(); const write = h.harness.bridge.replaceDraftDocument;
    let failOnce = true;
    h.harness.bridge.replaceDraftDocument = async input => {
      if (input.document.parts.length > 1 && failOnce) { failOnce = false; throw new Error('temporary save failure'); }
      return write(input);
    };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.fire('style-asset', h.file); await settle(); await settle(); const picture = h.saved().assets;
      h.fire('add-part'); await settle(); await settle();
      assert.equal(h.saved().draft.document.parts.length, 1);
      if (selectLater) h.fire('select-part', undefined, { partId: 'base' });
      h.fire('save'); await settle(); await settle();
      assert.equal(h.saved().draft.document.parts.length, 2);
      const selected = selectLater ? 'Base' : 'Part 2';
      assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML,
        new RegExp(`aria-label="Selected Part · ${selected}"`));
      h.fire('undo'); await settle(); await settle();
      assert.equal(h.saved().draft.document.parts.length, 1);
      assert.deepEqual(h.saved().assets, picture, 'retry Undo cannot skip back to the prior PNG operation');
      h.fire('redo'); await settle(); await settle();
      assert.equal(h.saved().draft.document.parts.length, 2);
    } finally { app.destroy(); }
  }
});

test('Creator previews selected alternatives without overwriting the authored default recipe', async () => {
  const h = pngEditorHarness(); const previews = [];
  h.harness.bridge.renderDraftPreview = async input => { previews.push(structuredClone(input)); return canonicalPreview(); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('add-item'); await settle(); await settle();
    const after = h.saved(); const item = after.draft.document.parts[0].items[1];
    assert.equal(previews.at(-1).recipe.selections[0].itemKey, item.key);
    assert.equal(after.draft.document.defaultRecipe.selections[0].itemKey, 'default');
    const writeCount = h.writes.length;
    h.fire('select-item', undefined, { itemId: 'default' }); await settle(); await settle();
    assert.equal(previews.at(-1).recipe.selections[0].itemKey, 'default');
    h.fire('select-item', undefined, { itemId: item.key }); await settle(); await settle();
    assert.equal(previews.at(-1).recipe.selections[0].itemKey, item.key);
    assert.equal(h.writes.length, writeCount);
    assert.deepEqual(h.saved(), after);
  } finally { app.destroy(); }
});

test('Creator PNG invalid input, decoding failure, cancellation and write conflict do not change saved data', async () => {
  for (const failure of ['cancel', 'mime', 'large', 'header', 'decode', 'write']) {
    const h = pngEditorHarness();
    if (failure === 'decode') h.harness.win.createImageBitmap = async () => { throw new Error('decode failed'); };
    if (failure === 'write') h.harness.bridge.dispatchDraftTransaction = async () => { throw new Error('CAS conflict'); };
    const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator'); const before = h.saved();
      const file = failure === 'cancel' ? null : { ...h.file,
        ...(failure === 'mime' ? { type: 'image/jpeg' } : {}),
        ...(failure === 'large' ? { size: 13 * 1024 * 1024 } : {}),
        ...(failure === 'header' ? { arrayBuffer: async () => new Uint8Array(h.file.size).buffer } : {}),
      };
      h.fire('style-asset', file); await settle(); await settle();
      assert.deepEqual(h.saved(), before, failure);
      assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /data-action="undo"[^>]*disabled/);
      if (failure !== 'cancel') assert.match(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /PNG|decode failed|CAS conflict/);
    } finally { app.destroy(); }
  }
});

test('Creator PNG delayed reads cannot survive navigation, wallet ABA or a different draft generation', async () => {
  for (const stale of ['navigation', 'wallet', 'draft']) {
    const h = pngEditorHarness(); const gate = deferred(); const app = createOriginalProductApp(h.harness);
    try {
      await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
      h.fire('style-asset', { ...h.file, arrayBuffer: () => gate.promise }); await settle();
      if (stale === 'navigation') { app.navigate('docs'); app.navigate('creator'); }
      if (stale === 'wallet') {
        app.refreshConnection({ account: { address: `0x${'42'.repeat(32)}`, chains: ['sui:mainnet'] } });
        app.refreshConnection(h.connection);
      }
      if (stale === 'draft') await app.openDraft('approved-maker');
      gate.resolve(await h.file.arrayBuffer()); await settle(); await settle();
      assert.equal(h.writes.length, 0, stale);
    } finally { gate.resolve(await h.file.arrayBuffer()); app.destroy(); }
  }
});

test('Composable author controls persist atomically, retain artwork and survive undo, redo and reopen', async () => {
  const harness = browserHarness();
  let saved = structuredClone(draftRecord());
  const calls = [];
  harness.bridge.getDraft = async () => ({ draft: structuredClone(saved), assets: [] });
  harness.bridge.dispatchDraftCommand = async input => {
    assert.equal(input.expectedRevision, saved.revision);
    calls.push(input);
    saved = { ...saved, revision: saved.revision + 1, document: applyMakerV8WorkspaceCommand(saved.document, input.command) };
    return structuredClone(saved);
  };
  harness.bridge.replaceDraftDocument = async input => {
    assert.equal(input.expectedRevision, saved.revision);
    calls.push(input);
    saved = { ...saved, revision: saved.revision + 1, document: structuredClone(input.document) };
    return structuredClone(saved);
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openDraft(saved.draftId);
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const fire = async (action, dataset = {}, value = '', checked = false, event = 'click') => {
      const target = new FakeTarget(harness.doc, { dataset: { action, ...dataset } });
      target.parent = mount; target.value = value; target.checked = checked;
      mount.fire(event, { target }); await settle();
    };
    await fire('creator-tab', { tab: 'composable' });
    assert.doesNotMatch(mount.innerHTML, /data-action="composable-mode"[^>]*disabled/);
    await fire('composable-mode', { mode: 'COMPOSABLE' });
    assert.deepEqual(saved.document.composition, { mode: 'COMPOSABLE', thirdPartyAdmission: 'OPEN', itemAssetization: true });
    const key = saved.document.parts[0].key;
    await fire('wardrobe-part-mode', { partId: key, mode: 'SLOT' });
    await fire('part-capacity', { partId: key }, '2', false, 'change');
    await fire('third-party-admission', {}, 'CERTIFIED', false, 'change');
    await fire('item-assetization', {}, '', false, 'change');
    assert.equal(saved.document.parts[0].wardrobeMode, 'SLOT');
    assert.equal(saved.document.parts[0].capacity, 2);
    assert.equal(saved.document.composition.thirdPartyAdmission, 'CERTIFIED');
    assert.equal(saved.document.composition.itemAssetization, false);
    const composable = structuredClone(saved.document);
    const count = calls.length;
    for (const capacity of ['0', '-1', '1.5', '65', '99999999999999999999']) await fire('part-capacity', { partId: key }, capacity, false, 'change');
    assert.equal(calls.length, count, 'invalid capacities never enter the durable write queue');
    assert.deepEqual(saved.document, composable);
    await fire('composable-mode', { mode: 'FIXED' });
    assert.equal(calls.length, count + 1, 'disable is one atomic replacement, not invalid intermediate commands');
    assert.deepEqual(saved.document.composition, { mode: 'FIXED', thirdPartyAdmission: 'DISABLED', itemAssetization: false });
    assert.ok(saved.document.parts.every(part => part.wardrobeMode === 'FIXED'));
    assert.deepEqual(saved.document.parts.map(part => part.items), composable.parts.map(part => part.items));
    assert.deepEqual(saved.document.assets, composable.assets);
    assert.deepEqual(saved.document.defaultRecipe, composable.defaultRecipe);
    assert.equal(saved.document.parts[0].capacity, 2);
    await fire('undo'); assert.deepEqual(saved.document, composable);
    await fire('redo'); assert.equal(saved.document.composition.mode, 'FIXED');
    await app.openDraft(saved.draftId);
    await fire('composable-mode', { mode: 'COMPOSABLE' });
    assert.equal(saved.document.parts[0].capacity, 2);
    assert.deepEqual(saved.document.parts[0].items, composable.parts[0].items);
  } finally { app.destroy(); }
});

test('rapid Composable edits compose against pending intent and use consecutive CAS revisions', async () => {
  const harness = browserHarness(); const gate = deferred();
  let saved = structuredClone(draftRecord()); const writes = [];
  harness.bridge.getDraft = async () => ({ draft: structuredClone(saved), assets: [] });
  const write = async input => {
    writes.push(input);
    if (writes.length === 1) await gate.promise;
    assert.equal(input.expectedRevision, saved.revision);
    const document = input.command ? applyMakerV8WorkspaceCommand(saved.document, input.command) : input.document;
    saved = { ...saved, revision: saved.revision + 1, document: structuredClone(document) };
    return structuredClone(saved);
  };
  harness.bridge.dispatchDraftCommand = write; harness.bridge.replaceDraftDocument = write;
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openDraft(saved.draftId);
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const fire = (action, dataset, value, event = 'click') => {
      const target = new FakeTarget(harness.doc, { dataset: { action, ...dataset } });
      target.parent = mount; target.value = value; mount.fire(event, { target });
    };
    fire('composable-mode', { mode: 'COMPOSABLE' });
    fire('wardrobe-part-mode', { mode: 'SLOT', partId: 'base' });
    fire('part-capacity', { partId: 'base' }, '3', 'change');
    fire('third-party-admission', {}, 'CERTIFIED', 'change');
    await settle(); assert.equal(writes.length, 1);
    gate.resolve(); await settle(); await settle();
    assert.deepEqual(writes.map(row => row.expectedRevision), [1, 2, 3, 4]);
    assert.equal(saved.document.parts[0].wardrobeMode, 'SLOT');
    assert.equal(saved.document.parts[0].capacity, 3);
    assert.equal(saved.document.composition.thirdPartyAdmission, 'CERTIFIED');
    await app.openDraft(saved.draftId);
    assert.equal(saved.revision, 5);
  } finally { gate.resolve(); app.destroy(); }
});

test('capacity input saves before Close without blur and change does not duplicate its history', async () => {
  const harness = browserHarness(); const gate = deferred();
  let saved = structuredClone(draftRecord()); saved.document.composition.mode = 'COMPOSABLE';
  const writes = [];
  harness.bridge.getDraft = async () => ({ draft: structuredClone(saved), assets: [] });
  harness.bridge.dispatchDraftCommand = async input => {
    writes.push(input); if (writes.length === 1) await gate.promise;
    assert.equal(input.expectedRevision, saved.revision);
    saved = { ...saved, revision: saved.revision + 1, document: applyMakerV8WorkspaceCommand(saved.document, input.command) };
    return structuredClone(saved);
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openDraft(saved.draftId);
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const control = new FakeTarget(harness.doc, { dataset: { action: 'part-capacity', partId: 'base' } }); control.parent = mount;
    for (const invalid of ['', '0', '-1', '1.5', '65']) {
      control.value = invalid; mount.fire('input', { target: control });
    }
    await settle(); assert.equal(writes.length, 0);
    control.value = '2'; mount.fire('input', { target: control });
    mount.fire('change', { target: control });
    const close = new FakeTarget(harness.doc, { dataset: { action: 'close-tool' } }); close.parent = mount;
    mount.fire('click', { target: close });
    await settle(); assert.equal(writes.length, 1);
    gate.resolve(); await settle();
    await app.openDraft(saved.draftId);
    assert.equal(saved.document.parts[0].capacity, 2);
    assert.equal(saved.revision, 2);
    control.value = '3'; mount.fire('input', { target: control });
    control.value = '4'; mount.fire('input', { target: control });
    mount.fire('change', { target: control }); await settle();
    assert.deepEqual(writes.map(row => row.command.row.capacity), [2, 3, 4]);
    assert.deepEqual(writes.map(row => row.expectedRevision), [1, 2, 3]);
    assert.equal(saved.document.parts[0].capacity, 4);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator Rules keeps the visible default conflict intent after the first input', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'rules' });
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    assert.match(mount.innerHTML, /value="excludes"[^>]*checked/);
    h.change('rule-owner-choice', 'base::default'); await settle();
    assert.match(mount.innerHTML, /value="excludes"[^>]*checked/);
    assert.equal(h.writes.length, 0);
  } finally { app.destroy(); }
});

function visibilityEditorHarness(condition) {
  const document = structuredClone(draftRecord().document);
  const accessory = structuredClone(document.parts[0]);
  accessory.key = 'accessory'; accessory.label = 'Accessory'; accessory.kind = 'STANDARD'; accessory.required = false;
  accessory.items[0].styles.push({ ...structuredClone(accessory.items[0].styles[0]), key: 'blue', label: 'Blue' });
  document.parts.push(accessory);
  if (condition !== undefined) document.parts[0].items[0].styles[0].visibleWhen = condition;
  const h = pngEditorHarness({ document });
  const mount = h.harness.doc.getElementById('makerV4CreatorMount');
  const binding = () => Object.fromEntries([
    ['creatorGeneration', 'creator-generation'], ['visibilityDraft', 'visibility-draft'], ['visibilitySubject', 'visibility-subject'],
  ].map(([key, attr]) => [key, mount.innerHTML.match(new RegExp(`data-${attr}="([^"]*)"`))?.[1]]));
  const event = async (action, value = '', { checked = false, dataset = {}, kind = 'change' } = {}) => {
    const control = new FakeTarget(h.harness.doc, { dataset: { action, ...binding(), ...dataset } });
    control.parent = mount; control.value = value; control.checked = checked;
    mount.fire(kind, { target: control }); await settle(); return control;
  };
  return { ...h, mount, binding, event };
}

test('Style visibility saves exact canonical conditions through Apply, Undo, Redo, reopen and Clear', async () => {
  const h = visibilityEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    const before = h.saved();
    await h.event('edit-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /id="v4RuleVisibilityTab"[^>]*aria-selected="true"/);
    await h.event('visibility-target-choice', 'accessory::default::blue', { checked: true });
    await h.event('visibility-polarity-choice', 'not-selected');
    await h.event('apply-style-visibility', '', { kind: 'click' });
    const condition = { op: 'not', condition: { op: 'selected', source: 'BASE', sourceKey: null,
      partKey: 'accessory', itemKey: 'default', styleKey: 'blue' } };
    const current = () => h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen;
    assert.deepEqual(current(), condition);
    assert.deepEqual(h.saved().draft.document.defaultRecipe, before.draft.document.defaultRecipe);
    assert.deepEqual(h.saved().assets, before.assets);
    h.fire('undo'); await settle(); assert.equal(current(), undefined);
    h.fire('redo'); await settle(); assert.deepEqual(current(), condition);
    await app.openDraft('approved-maker');
    await h.event('edit-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /value="not-selected" selected/);
    assert.match(h.mount.innerHTML, /value="accessory::default::blue" checked/);
    await h.event('clear-style-visibility', '', { kind: 'click' }); assert.equal(current(), null);
    h.fire('undo'); await settle(); assert.deepEqual(current(), condition);
    assert.equal(h.writes.length, 5);
  } finally { app.destroy(); }
});

test('Style visibility rejects empty, same-Part, required-Part and locked writes without losing the document', async () => {
  const h = visibilityEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    await h.event('edit-style-visibility', '', { kind: 'click' });
    const before = h.saved();
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /Choose at least one visibility target/);
    await h.event('visibility-target-choice', 'base::default', { checked: true });
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /another Part/);
    assert.deepEqual(h.saved(), before);
    h.fire('close-tool'); h.fire('select-part', null, { partId: 'accessory' }); await settle();
    await h.event('edit-style-visibility', '', { kind: 'click' });
    await h.event('visibility-target-choice', 'base', { checked: true });
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /required whole Part/);
    h.fire('close-tool'); h.change('style-locked', true); await settle();
    const locked = h.saved(), writes = h.writes.length;
    await h.event('edit-style-visibility', '', { kind: 'click' });
    await h.event('clear-style-visibility', '', { kind: 'click' });
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.equal(h.writes.length, writes); assert.deepEqual(h.saved(), locked);
    assert.match(h.mount.innerHTML, /Unlock the whole Style/);
  } finally { app.destroy(); }
});

test('Style visibility old controls cannot target a different Style or a reopened draft', async () => {
  const h = visibilityEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    await h.event('edit-style-visibility', '', { kind: 'click' });
    await h.event('visibility-target-choice', 'accessory::default::blue', { checked: true });
    const old = h.binding();
    h.fire('close-tool'); h.fire('select-part', null, { partId: 'accessory' }); await settle();
    await h.event('apply-style-visibility', '', { kind: 'click', dataset: old });
    await h.event('visibility-target-choice', 'base::default', { checked: true, dataset: old });
    await h.event('edit-style-visibility', '', { kind: 'click' });
    assert.doesNotMatch(h.mount.innerHTML, /value="base::default" checked/);
    const oldDraft = h.binding(); await app.openDraft('approved-maker');
    await h.event('clear-style-visibility', '', { kind: 'click', dataset: oldDraft });
    assert.equal(h.writes.length, 0);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, undefined);
  } finally { app.destroy(); }
});

test('Style visibility advanced conditions survive editor initialization, search and empty Apply', async () => {
  const condition = { op: 'not', condition: { op: 'any', conditions: [{ op: 'selected', source: 'BASE', sourceKey: null,
    partKey: 'accessory', itemKey: 'default', styleKey: 'blue' }] } };
  const h = visibilityEditorHarness(condition), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    await h.event('edit-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /Advanced visibility condition/);
    const html = h.mount.innerHTML;
    await h.event('visibility-target-search', 'blue', { kind: 'input' });
    assert.equal(h.mount.innerHTML, html, 'search filters in place');
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, condition);
    await h.event('visibility-target-choice', 'accessory::default::blue', { checked: true });
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen.op, 'selected');
  } finally { app.destroy(); }
});

test('Style visibility CAS failure retains exact intent for Save retry and isolates late errors after wallet ABA', async () => {
  const h = visibilityEditorHarness(), original = h.harness.bridge.replaceDraftDocument;
  let fail = true;
  let lateGate, lateEntered;
  h.harness.bridge.replaceDraftDocument = async input => {
    if (lateGate) { lateEntered.resolve(); await lateGate.promise; throw new Error('stale visibility failure'); }
    if (fail) throw new Error('visibility disk failure'); return original(input);
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    await h.event('edit-style-visibility', '', { kind: 'click' });
    await h.event('visibility-target-choice', 'accessory::default::blue', { checked: true });
    await h.event('apply-style-visibility', '', { kind: 'click' });
    assert.match(h.mount.innerHTML, /visibility disk failure/);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, undefined);
    fail = false; h.fire('save'); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen.styleKey, 'blue');
    h.fire('undo'); await settle();
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, undefined);
    lateGate = deferred(); lateEntered = deferred();
    const pending = h.event('clear-style-visibility', '', { kind: 'click' }); await lateEntered.promise;
    app.refreshConnection({}); app.refreshConnection(h.connection);
    lateGate.resolve(); await pending; await settle();
    assert.doesNotMatch(h.mount.innerHTML, /class="v4-rule-error"/);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, undefined);
  } finally { lateGate?.resolve(); app.destroy(); }
});

test('Style visibility ANY choices and a queued Clear compose against the pending document with consecutive CAS', async () => {
  const h = visibilityEditorHarness(), gate = deferred(), entered = deferred();
  const original = h.harness.bridge.replaceDraftDocument;
  let calls = 0;
  h.harness.bridge.replaceDraftDocument = async input => {
    if (++calls === 1) { entered.resolve(); await gate.promise; }
    return original(input);
  };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    await h.event('edit-style-visibility', '', { kind: 'click' });
    await h.event('visibility-target-choice', 'accessory::default::blue', { checked: true });
    await h.event('visibility-target-choice', 'accessory::default::default', { checked: true });
    await h.event('visibility-match-choice', 'any');
    const applying = h.event('apply-style-visibility', '', { kind: 'click' }); await entered.promise;
    const clearing = h.event('clear-style-visibility', '', { kind: 'click' });
    gate.resolve(); await applying; await clearing; await settle();
    assert.deepEqual(h.writes.map(row => row.expectedRevision), [1, 2]);
    const first = h.writes[0].document.parts[0].items[0].styles[0].visibleWhen;
    assert.equal(first.op, 'any'); assert.equal(first.conditions.length, 2);
    assert.equal(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, null);
    h.fire('undo'); await settle();
    assert.deepEqual(h.saved().draft.document.parts[0].items[0].styles[0].visibleWhen, first);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator Rules search filters in place while retaining selected and locked definitions', async () => {
  const h = pngEditorHarness(), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'rules' });
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const target = props => Object.assign(new FakeTarget(h.harness.doc), props);
    const ownerOptions = [
      target({ dataset: { ruleOwnerOption: 'Background / Gold' }, selected: false }),
      target({ dataset: { ruleOwnerOption: 'Body / Current' }, selected: true }),
      target({ dataset: { ruleOwnerOption: 'Body / Gold', ruleOwnerLocked: 'true' }, selected: false }),
      target({ dataset: { ruleOwnerOption: 'Hair / Blue' }, selected: false }),
    ];
    const ownerGroups = ownerOptions.map(option => target({ querySelectorAll: () => [option] }));
    const ownerSelect = target({ querySelectorAll: selector => selector === 'optgroup' ? ownerGroups : ownerOptions });
    const ownerCount = target({ textContent: '' });
    mount.selectorChildren.set('#v4RuleOwnerDefinition', ownerSelect);
    mount.selectorChildren.set('[data-rule-owner-search-count]', ownerCount);
    const rows = ['Body / Gold', 'Hair / Selected', 'Eye / Blue'].map((text, i) =>
      target({ dataset: { ruleSearchRecord: text }, querySelector: () => ({ checked: i === 1 }) }));
    const groups = rows.map(row => target({ open: false, querySelectorAll: () => [row] }));
    const count = target({ textContent: '' }), empty = target({ hidden: true });
    const tree = target({ parentElement: { querySelector: () => count }, querySelector: () => empty,
      querySelectorAll: () => groups });
    mount.selectorChildren.set('[data-rule-target-tree="availability"]', tree);
    const input = (action, value) => {
      const control = target({ dataset: { action }, value, parent: mount }); control.focus();
      mount.fire('input', { target: control }); return control;
    };
    const html = mount.innerHTML;
    const ownerInput = input('rule-owner-search', ' GOLD '); await settle();
    assert.equal(h.harness.doc.activeElement, ownerInput);
    assert.equal(mount.innerHTML, html, 'typing must not replace the input DOM');
    assert.deepEqual(ownerOptions.map(option => [option.hidden, option.disabled]), [[false,false],[false,false],[false,true],[true,true]]);
    assert.equal(ownerGroups[3].hidden, true); assert.match(ownerCount.textContent, /3/);
    input('rule-target-search', 'gold'); await settle();
    assert.deepEqual(rows.map(row => row.hidden), [false,false,true]);
    assert.equal(groups[0].open, true); assert.equal(groups[2].hidden, true);
    assert.equal(empty.hidden, true); assert.match(count.textContent, /2/);
    rows[1].querySelector = () => ({ checked: false });
    input('rule-target-search', 'missing'); await settle(); assert.equal(empty.hidden, false);
    input('rule-owner-search', ''); input('rule-target-search', ''); await settle();
    assert.deepEqual(ownerOptions.map(option => option.disabled), [false,false,true,false]);
    assert.ok(rows.every(row => !row.hidden)); assert.equal(h.writes.length, 0);
  } finally { app.destroy(); }
});

test('Creator Rules whole-Style lock rejects owner writes without locking targets or Part rules', async () => {
  const document = structuredClone(draftRecord().document);
  const accessory = structuredClone(document.parts[0]); accessory.key = 'accessory'; accessory.kind = 'STANDARD'; accessory.required = false;
  document.parts.push(accessory);
  const h = pngEditorHarness({ document }), app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('edit-selection-rules', null, { ruleOwner: 'base::default::default' });
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const target = new FakeTarget(h.harness.doc, { dataset: { action: 'rule-target-choice' } });
    target.parent = mount; target.value = 'accessory::default'; target.checked = true;
    mount.fire('change', { target }); h.fire('add-rule'); await settle();
    assert.equal(h.saved().draft.document.rules.length, 1);
    h.change('style-locked', true); await settle();
    const before = h.saved();
    assert.match(mount.innerHTML, /data-action="add-rule"[^>]*disabled/);
    assert.match(mount.innerHTML, /data-action="delete-rule"[^>]*disabled/);
    h.fire('add-rule'); await settle(); h.fire('delete-rule', null, { ruleId: 'rule-1' }); await settle();
    assert.deepEqual(h.saved(), before, 'direct events must not bypass a locked trigger');
    h.change('rule-owner-choice', 'base'); h.fire('add-rule'); await settle();
    assert.equal(h.saved().draft.document.rules.length, 2, 'Part rules are not owned by a locked child Style');
    h.change('rule-owner-choice', 'accessory::default');
    target.value = 'accessory::default'; target.checked = false; mount.fire('change', { target });
    target.value = 'base::default::default'; target.checked = true; mount.fire('change', { target });
    h.fire('add-rule'); await settle();
    assert.equal(h.saved().draft.document.rules.length, 3, 'locked targets remain valid references');
    h.change('style-locked', false); await settle(); h.fire('delete-rule', null, { ruleId: 'rule-1' }); await settle();
    assert.equal(h.saved().draft.document.rules.length, 2);
  } finally { app.destroy(); }
});

test('Creator Rules ignores old controls while a draft read is pending', async () => {
  const h = pngEditorHarness(), read = h.harness.bridge.getDraft;
  const gate = deferred(), entered = deferred(); let pause = false;
  h.harness.bridge.getDraft = async input => { if (pause) { entered.resolve(); await gate.promise; } return read(input); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'rules' });
    pause = true; const opening = app.openDraft('approved-maker'); await entered.promise;
    h.change('rule-owner-choice', 'stale-owner'); h.change('rule-type-choice', 'requires');
    h.change('rule-owner-search', 'stale-search'); h.fire('add-rule');
    h.fire('delete-rule', null, { ruleId: 'stale-rule' }); await settle();
    assert.equal(h.writes.length, 0);
    gate.resolve(); await opening; h.fire('creator-tab', null, { tab: 'rules' }); await settle();
    const html = h.harness.doc.getElementById('makerV4CreatorMount').innerHTML;
    assert.doesNotMatch(html, /stale-owner|stale-search|selected rule no longer exists/);
    assert.match(html, /value="excludes"[^>]*checked/);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator Rules late delete failure does not inject an editor error after wallet ABA', async () => {
  const document = structuredClone(draftRecord().document);
  const accessory = structuredClone(document.parts[0]); accessory.key = 'accessory'; accessory.kind = 'STANDARD'; accessory.required = false;
  document.parts.push(accessory);
  document.rules.push(makerV8RuleFromBuilder({ key: 'rule-1', type: 'excludes', matchMode: 'all',
    ownerDefinition: 'base::default', definitions: ['accessory::default'] }));
  const h = pngEditorHarness({ document }), gate = deferred(), entered = deferred();
  h.harness.bridge.dispatchDraftCommand = async () => { entered.resolve(); await gate.promise; throw new Error('late rule deletion'); };
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; await app.openDraft('approved-maker'); app.navigate('creator');
    h.fire('creator-tab', null, { tab: 'rules' }); h.fire('delete-rule', null, { ruleId: 'rule-1' }); await entered.promise;
    app.refreshConnection({}); app.refreshConnection(h.connection);
    gate.resolve(); await settle(); h.fire('creator-tab', null, { tab: 'rules' });
    assert.doesNotMatch(h.harness.doc.getElementById('makerV4CreatorMount').innerHTML, /class="v4-rule-error"/);
    assert.equal(h.saved().draft.document.rules.length, 1);
  } finally { gate.resolve(); app.destroy(); }
});

test('Creator canonical Rules persist through events, undo/redo and reload without unrelated controls', async () => {
  const record = structuredClone(draftRecord());
  const accessory = structuredClone(record.document.parts[0]);
  accessory.key = 'accessory'; accessory.kind = 'STANDARD'; accessory.required = false;
  accessory.items[0].styles.push({ ...structuredClone(accessory.items[0].styles[0]), key: 'blue' });
  record.document.parts.push(accessory);
  const harness = browserHarness({ record });
  let saved = record;
  for (const name of ['dispatchDraftCommand', 'replaceDraftDocument']) {
    const original = harness.bridge[name].bind(harness.bridge);
    harness.bridge[name] = async input => { saved = await original(input); return saved; };
  }
  harness.bridge.getDraft = async () => ({ draft: structuredClone(saved), assets: [] });
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openDraft(record.draftId); app.navigate('creator');
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const event = async (action, value = '', checked = false, dataset = {}, kind = 'change') => {
      const control = new FakeTarget(harness.doc, { dataset: { action, ...dataset } });
      control.parent = mount; control.value = value; control.checked = checked;
      mount.fire(kind, { target: control }); await settle();
    };
    await event('edit-selection-rules', '', false, { ruleOwner: 'base::default::default' }, 'click');
    await event('rule-type-choice', 'requires');
    await event('rule-match-choice', 'any');
    await event('rule-target-choice', 'accessory::default::default', true);
    await event('rule-target-choice', 'accessory::default::blue', true);
    await event('add-rule', '', false, {}, 'click');
    assert.equal(saved.document.rules.length, 1);
    assert.equal(saved.document.rules[0].trigger.styleKey, 'default');
    assert.equal(saved.document.rules[0].targetMode, 'ANY');
    assert.equal(saved.document.rules[0].targets.length, 2);
    await event('undo', '', false, {}, 'click'); assert.equal(saved.document.rules.length, 0);
    await event('redo', '', false, {}, 'click'); assert.equal(saved.document.rules.length, 1);
    await app.openDraft(record.draftId);
    assert.match(mount.innerHTML, /Approved Maker/);
    await event('edit-selection-rules', '', false, { ruleOwner: 'base::default::default' }, 'click');
    await event('rule-type-choice', 'excludes');
    await event('rule-target-choice', 'accessory::default::default', true);
    await event('add-rule', '', false, {}, 'click');
    assert.equal(saved.document.rules.length, 2);
    const excluded = saved.document.rules[1];
    assert.equal(excluded.targetMode, 'ANY');
    assert.equal(makerV8RuleIssue([excluded], [{ partKey: 'base', itemKey: 'default', styleKey: 'default' }, { partKey: 'accessory', itemKey: 'default', styleKey: 'default' }]).code, 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED');
    const before = harness.calls.dispatch.length;
    await event('rule-target-choice', 'base::default', true);
    await event('add-rule', '', false, {}, 'click');
    assert.equal(harness.calls.dispatch.length, before);
    await event('delete-rule', '', false, { ruleId: excluded.key }, 'click');
    assert.equal(saved.document.rules.length, 1);
    await app.openDraft(record.draftId);
    await event('add-rule', '', false, {}, 'click');
    assert.equal(saved.document.rules.length, 1, 'reload clears builder targets');
    await event('rule-owner-choice', 'base::default::default');
    await event('rule-target-choice', 'accessory::default::default', true);
    const add = new FakeTarget(harness.doc, { dataset: { action: 'add-rule' } }); add.parent = mount;
    mount.fire('click', { target: add }); mount.fire('click', { target: add }); await settle();
    assert.equal(saved.document.rules.length, 3);
    assert.equal(new Set(saved.document.rules.map(rule => rule.key)).size, 3, 'queued rule keys cannot overwrite each other');
  } finally { app.destroy(); }
});
const ROOT_TWO = `0x${'32'.repeat(32)}`;
const PNG_SIGNATURE_BASE64 = 'iVBORw0KGgo=';

function canonicalPreview({ width = 1024, height = 1024, sha256 = 'dd'.repeat(32) } = {}) {
  return {
    schemaVersion: 'animacraft.maker-v8-player-render.v1',
    mediaType: 'image/png',
    width,
    height,
    bytesBase64: PNG_SIGNATURE_BASE64,
    byteLength: 8,
    sha256,
  };
}

function localDraftAsset(draftId = 'approved-maker') {
  return {
    schemaVersion: 'animacraft.maker-v8-draft-asset.v1',
    draftId,
    assetId: 'base-default',
    revision: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    kind: 'style',
    mediaType: 'image/png',
    bytesBase64: PNG_SIGNATURE_BASE64,
    byteLength: 8,
    sha256: 'ee'.repeat(32),
  };
}

function certifiedCover(assetId = 'maker-cover') {
  return {
    assetId,
    blobId: `${assetId}-blob`,
    mediaType: 'image/png',
    byteLength: 1,
    sha256: 'ab'.repeat(32),
    kind: 'cover',
  };
}

function certifiedMaker({
  rootId = ROOT_ONE,
  title = 'Moon Maker',
  style = 'Fantasy',
  category = 'fantasy',
  cover = certifiedCover(),
} = {}) {
  return {
    rootId,
    title,
    summary: `${title} summary`,
    creator: 'Animacraft Artist',
    style,
    category,
    license: { label: 'Personal use', note: 'Credit the creator.' },
    royaltyBps: 500,
    lifecycle: 'ACTIVE',
    coverAssetId: cover.assetId,
    certifiedAssets: [cover],
    document: {
      metadata: { name: title, summary: `${title} summary` },
      parts: [
        { key: 'hair', label: 'Hair', items: [{ key: 'hair-item' }] },
        { key: 'eyes', label: 'Eyes', items: [{ key: 'eyes-item' }] },
      ],
    },
  };
}

function playerSession(rootId = ROOT_ONE, name = 'Moon Maker') {
  const document = createCharacterMakerV8Starter({ makerKey: 'player-maker', name });
  const selection = document.defaultRecipe.selections[0];
  const exactSelection = {
    source: 'BASE',
    ...selection,
    trackKey: 'base-track',
    colorChannelKey: null,
    defaultSwatchKey: null,
    releaseId: null,
    semanticPackId: null,
    externalProductId: null,
    ownedExternalItemId: null,
  };
  const player = {
      schemaVersion: 'animacraft.maker-v8-player-view.v1',
      id: rootId,
      rootId,
      makerKey: 'player-maker',
      makerVersion: '1',
      title: name,
      summary: `${name} summary`,
      creatorAddress: `0x${'88'.repeat(32)}`,
      ownerAddress: `0x${'99'.repeat(32)}`,
      lifecycle: 'ACTIVE',
      coverAsset: null,
      document,
      certifiedAssets: [{
        assetId: 'base-default', blobId: 'base-blob', mediaType: 'image/png',
        byteLength: 1, sha256: 'aa'.repeat(32),
      }],
      evidence: {
        rootId,
        contentCommitment: 'bb'.repeat(32),
        makerVersion: '1',
      },
      contextualChoices: {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: `0x${'99'.repeat(32)}`,
        rootId,
        baseEntitlements: [],
        packStyles: [], externalStyles: [], certifiedAssets: [], diagnostics: [],
      },
    };
  const recipe = {
      schemaVersion: 'animacraft.maker-v8-player-recipe.v2',
      rootId,
      makerVersion: '1',
      rootContentCommitment: 'bb'.repeat(32),
      selections: [exactSelection],
      colors: [],
      outputKey: 'default-png',
    };
  const loadout = {
      schemaVersion: 'animacraft.maker-v8-player-loadout.v2',
      rootId,
      makerVersion: '1',
      rootContentCommitment: 'bb'.repeat(32),
      selections: [{ selectionIndex: 0, ...exactSelection, swatchKey: null }],
      outputKey: recipe.outputKey,
      usedPacks: [],
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
    };
  return {
    schemaVersion: 'animacraft.maker-v8-player-session.v1',
    status: 'READY',
    rootId,
    player,
    recipe,
    loadout,
    execution: {
      allowWalletSignature: true,
      allowBroadcast: true,
      allowProtectedContent: false,
      writeEnabled: true,
      disabledReason: null,
    },
  };
}

function playerSessionWithAlternate(rootId = ROOT_ONE, { capacity = 2, secondAlternate = false } = {}) {
  const session = structuredClone(playerSession(rootId));
  const base = session.player.document.parts[0];
  base.capacity = capacity;
  const alternate = structuredClone(base.items[0]);
  alternate.key = 'alternate';
  alternate.label = 'Alternate';
  alternate.displayOrder = 1;
  alternate.defaultStyleKey = 'alternate';
  alternate.styles[0].key = 'alternate';
  alternate.styles[0].label = 'Alternate';
  const alternateStyle = structuredClone(alternate.styles[0]);
  alternateStyle.key = 'alternate-2';
  alternateStyle.label = 'Alternate 2';
  alternateStyle.displayOrder = 1;
  alternate.styles.push(alternateStyle);
  base.items.push(alternate);
  if (secondAlternate) {
    const second = structuredClone(alternate);
    second.key = 'alternate-b';
    second.label = 'Alternate B';
    second.displayOrder = 2;
    second.defaultStyleKey = 'alternate-b';
    second.styles = [structuredClone(alternate.styles[0])];
    second.styles[0].key = 'alternate-b';
    second.styles[0].label = 'Alternate B';
    base.items.push(second);
  }
  return session;
}

function playerSessionWithPackChoice(rootId = ROOT_ONE) {
  const session = playerSessionWithAlternate(rootId);
  const releaseId = `0x${'55'.repeat(32)}`;
  session.player.contextualChoices.packStyles.push({
    source: 'PACK',
    access: { accessible: true, canEquip: true, reason: '' },
    id: `pack:${releaseId}:base:moon:violet`,
    label: 'Moon Pack · Violet',
    partKey: 'base',
    itemKey: 'moon',
    styleKey: 'violet',
    trackKey: 'base-track',
    colorChannelKey: null,
    defaultSwatchKey: null,
    releaseId,
    semanticPackId: 'moon-pack',
    externalProductId: null,
    ownedExternalItemId: null,
    assetId: 'pack-moon',
    protected: false,
  });
  session.player.certifiedAssets.push({
    assetId: 'pack-moon', blobId: 'pack-blob', mediaType: 'image/png',
    byteLength: 1, sha256: 'cc'.repeat(32),
  });
  return session;
}

function exactLoadoutSelections(document, recipe, player = null) {
  const layout = player ? makerV8PlayerRecipeLayout(player, recipe.selections) : null;
  const starts = new Map();
  let next = 0;
  [...document.parts]
    .sort((left, right) => left.menuOrder - right.menuOrder || left.key.localeCompare(right.key))
    .forEach((part) => {
      starts.set(part.key, next);
      next += part.capacity;
    });
  const offsets = new Map();
  const colors = new Map(recipe.colors.map((entry) => [entry.channelKey, entry.swatchKey]));
  return recipe.selections.map((selection) => {
    const key = layout ? layout.scopeKey(selection) : selection.partKey;
    const offset = offsets.get(key) || 0;
    offsets.set(key, offset + 1);
    return {
      selectionIndex: (layout ? layout.slot(selection).start : starts.get(selection.partKey)) + offset,
      ...structuredClone(selection),
      swatchKey: player ? makerV8PlayerSwatchKey(player, makerV8PlayerColorMap(player, recipe.colors), selection) : selection.colorChannelKey === null
        ? null : colors.get(selection.colorChannelKey) ?? selection.defaultSwatchKey,
    };
  });
}

function exactUsedPacks(recipe) {
  return [...new Map(recipe.selections.filter((entry) => entry.source === 'PACK')
    .map((entry) => [entry.releaseId, {
      releaseId: entry.releaseId,
      semanticPackId: entry.semanticPackId,
    }])).values()].sort((left, right) => (
    left.semanticPackId.localeCompare(right.semanticPackId)
    || left.releaseId.localeCompare(right.releaseId)
  ));
}

class FakeClassList {
  #values = new Set();

  add(...values) {
    values.forEach((value) => this.#values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.#values.delete(value));
  }

  toggle(value, force) {
    if (force === true) this.#values.add(value);
    else if (force === false) this.#values.delete(value);
    else if (this.#values.has(value)) this.#values.delete(value);
    else this.#values.add(value);
    return this.#values.has(value);
  }

  contains(value) {
    return this.#values.has(value);
  }
}

class FakeTarget {
  constructor(document, { id = '', dataset = {} } = {}) {
    this.ownerDocument = document;
    this.id = id;
    this.dataset = { ...dataset };
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = 0;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.checked = false;
    this.children = [];
    this.listeners = new Map();
    this.parent = null;
    this.selectorChildren = new Map();
    this.validationMessage = '';
    this.reportValidityCalls = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  fire(type, details = {}) {
    const event = {
      type,
      target: this,
      key: '',
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...details,
    };
    event.listenerResults = [];
    for (const listener of this.listeners.get(type) || []) {
      event.listenerResults.push(listener(event));
    }
    return event;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  setCustomValidity(message) {
    this.validationMessage = String(message || '');
  }

  reportValidity() {
    this.reportValidityCalls += 1;
    return !this.validationMessage;
  }

  querySelector(selector) {
    const direct = this.selectorChildren.get(selector);
    if (direct) return direct;
    if (selector === '[role="menuitemradio"][aria-checked="true"]') {
      return this.children.find((child) => child.getAttribute('aria-checked') === 'true') || null;
    }
    if (selector === '[role="menuitemradio"]') return this.children[0] || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '[role="menuitemradio"]') return this.children;
    return [];
  }

  contains(candidate) {
    return candidate === this || candidate?.parent === this;
  }

  closest(selector) {
    if (selector === '[data-drag-kind]' && this.dataset.dragKind) return this;
    if (selector === '[data-action]' && this.dataset.action) return this;
    if (selector === '[data-page]' && this.dataset.page) return this;
    if (selector === '[data-theme-option]' && this.dataset.themeOption) return this;
    if (selector === '[data-filter]' && this.dataset.filter) return this;
    if (selector === '[data-create-first-maker]' && this.dataset.createFirstMaker !== undefined) return this;
    if (selector === '[data-use-template]' && this.dataset.useTemplate) return this;
    if (selector === '[data-view-template]' && this.dataset.viewTemplate) return this;
    if (selector === '[data-detail-start]' && this.dataset.detailStart !== undefined) return this;
    if (selector === '[data-edit-maker]' && this.dataset.editMaker) return this;
    if (selector === '[data-preview-maker]' && this.dataset.previewMaker) return this;
    if (selector === '[data-manage-lifecycle]' && this.dataset.manageLifecycle) return this;
    if (selector === '[data-recovery-action]' && this.dataset.recoveryAction) return this;
    if (selector === '[data-lifecycle-action]' && this.dataset.lifecycleAction) return this;
    if (selector === '.template-card' && this.classList.contains('template-card')) return this;
    if (selector === '.theme-control' && this.inThemeControl) return this;
    return this.parent?.closest?.(selector) || null;
  }
}

class FakeCanvas extends FakeTarget {
  constructor(document, options = {}) {
    super(document, options);
    this.width = 0;
    this.height = 0;
    this.draws = [];
    this.context = {
      clearRect: (...args) => this.draws.push(['clear', ...args]),
      drawImage: (_image, ...args) => this.draws.push(['draw', ...args]),
    };
  }

  getContext(kind) {
    return kind === '2d' ? this.context : null;
  }
}

class FakeDocument extends FakeTarget {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.activeElement = null;
    this.documentElement = new FakeTarget(this);
    this.elements = new Map();
    this.selectorLists = new Map();
    this.selectorSingles = new Map();
    this.downloads = [];
  }

  add(element) {
    this.elements.set(element.id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  querySelector(selector) {
    return this.selectorSingles.get(selector) || null;
  }

  querySelectorAll(selector) {
    return this.selectorLists.get(selector) || [];
  }

  createElement(tagName) {
    const element = new FakeTarget(this);
    element.tagName = String(tagName || '').toUpperCase();
    element.click = () => {
      this.downloads.push({ href: element.href, download: element.download, rel: element.rel });
    };
    return element;
  }
}

class FakeWindow extends FakeTarget {
  constructor(document, {
    initialUrl = 'https://animacraft.soulidity.ai/#templates',
    storageMap = new Map(),
  } = {}) {
    super(document);
    this.location = {};
    const applyUrl = (next) => {
      const current = this.location.href || initialUrl;
      const resolved = new URL(String(next), current);
      for (const key of ['href', 'origin', 'protocol', 'hostname', 'pathname', 'search', 'hash']) {
        this.location[key] = resolved[key];
      }
    };
    applyUrl(initialUrl);
    this.history = {
      pushes: [],
      replacements: [],
      pushState: (_state, _title, next) => {
        this.history.pushes.push(String(next));
        applyUrl(next);
      },
      replaceState: (_state, _title, next) => {
        this.history.replacements.push(String(next));
        applyUrl(next);
      },
    };
    this.location.assign = (next) => applyUrl(next);
    this.setLocation = applyUrl;
    const storage = storageMap;
    this.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
      key: (index) => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    };
    this.navigator = { language: 'en-US' };
    this.opened = [];
    this.open = (...args) => { this.opened.push(args); return {}; };
    this.objectUrls = { created: [], revoked: [] };
    this.URL = {
      createObjectURL: (blob) => {
        const url = `blob:test-${this.objectUrls.created.length + 1}`;
        this.objectUrls.created.push({ url, blob });
        return url;
      },
      revokeObjectURL: (url) => this.objectUrls.revoked.push(url),
    };
    this.Image = class {
      set src(value) {
        this.currentSrc = value;
        queueMicrotask(() => this.onload?.());
      }
    };
    this.scrollTo = () => {};
    let preference = 'auto';
    const applied = [];
    this.ANIMACRAFT_THEME = {
      readPreference: () => preference,
      setPreference: (next) => { preference = next; return next; },
      applyPreference: (next) => { applied.push(next); return next === 'soulidity' ? 'soulidity' : 'animacraft'; },
      applied,
    };
  }
}

function browserHarness({
  connection = null,
  record = draftRecord(),
  draftsResult = [],
  initialLocale = null,
  templatesResult = { status: 'READY', makers: [], diagnostics: [] },
  templateResult = null,
  certifiedAssetResult = null,
  playerSessionResult = null,
  renderPlayerPreviewResult = undefined,
  renderPlayerExportResult = undefined,
  renderDraftPreviewResult = undefined,
  completePlayerJourneyResult = undefined,
  openPlayerReception = undefined,
  exportPlayerEnvelopeRecovery = undefined,
  draftAssets = [],
  bridgeReadyError = null,
  initialUrl = 'https://animacraft.soulidity.ai/#templates',
  soulidityAppUrl = null,
  nativeCompletionConfigured = false,
  storageMap = new Map(),
} = {}) {
  const doc = new FakeDocument();
  const ids = [
    'themeButton', 'themeMenu', 'accountButton', 'accountPanel',
    'closeAccountPanel', 'walletButton', 'panelWalletButton',
    'creatorGateWalletButton', 'walletSummary', 'accountIdentity',
    'walletFirstCard', 'creatorWalletGate', 'creatorConsole',
    'makerV4CreatorMount', 'makerV4PlayerMount', 'backToCreatorPreview', 'accountLanguage', 'templateGrid',
    'publicMakerCount', 'refreshMakers', 'templateSearch',
    'templateDetail', 'templateDetailBack', 'docsHandbook',
    'protocolSteps', 'chainStatusGrid', 'accountMakeOc',
    'soulidityMySoulsLink', 'soulidityProfileLink',
    'soulidityCommunityLink', 'soulidityMarketLink',
    'imageMakerList', 'openDraftRecovery', 'backToMakerList',
    'makerRegistrationModal', 'newMakerName', 'registerMaker',
    'draftRecoveryModal', 'draftRecoveryTitle', 'draftRecoveryStatus',
    'draftRecoveryList', 'rescanDraftRecovery',
    'makerLifecycleManagerModal', 'makerLifecycleManagerDialog',
    'makerLifecycleManagerBadge', 'makerLifecycleManagerName',
    'makerLifecycleManagerScope', 'makerLifecycleManagerFacts',
    'lifecycleWorkingVersionCard', 'lifecyclePublishedVersionCard',
    'makerLifecycleManagerActions', 'makerLifecycleManagerStatus',
    'makerLifecycleManagerNotice', 'deleteMakerDraft',
    'makerV4CreatorCanvas', 'makerV4PlayerCanvas',
    'v4PlayerRenderStatus', 'v4PlayerSaveStatus', 'v4PlayerCompletionStatus',
  ];
  ids.forEach((id) => doc.add(
    id === 'makerV4CreatorCanvas' || id === 'makerV4PlayerCanvas'
      ? new FakeCanvas(doc, { id }) : new FakeTarget(doc, { id }),
  ));
  doc.getElementById('accountMakeOc').dataset.page = 'make';
  doc.getElementById('soulidityMySoulsLink').dataset.soulidityAuth = '';
  doc.getElementById('soulidityProfileLink').dataset.soulidityAuth = '';

  const walletLabel = new FakeTarget(doc);
  doc.getElementById('walletButton').selectorChildren
    .set('[data-i18n="walletConnect"]', walletLabel);
  const options = ['auto', 'animacraft', 'soulidity'].map((theme) => {
    const option = new FakeTarget(doc, { dataset: { themeOption: theme } });
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(theme === 'auto'));
    option.parent = doc.getElementById('themeMenu');
    return option;
  });
  doc.getElementById('themeMenu').children = options;
  doc.selectorLists.set('[data-theme-option]', options);
  const pages = ORIGINAL_PRODUCT_PAGES.map((id) => new FakeTarget(doc, { id }));
  const pageButtons = ['templates', 'docs', 'creator'].map((page) => new FakeTarget(doc, {
    dataset: { page },
  }));
  pageButtons.push(doc.getElementById('accountMakeOc'));
  const filterButtons = ['all', 'daily', 'fantasy', 'chibi'].map((filter) => {
    const button = new FakeTarget(doc, { dataset: { filter } });
    button.classList.toggle('active', filter === 'all');
    return button;
  });
  const localizedNav = new FakeTarget(doc, { dataset: { i18n: 'navTemplates' } });
  localizedNav.textContent = 'Templates';
  const newMakerButton = new FakeTarget(doc, { dataset: { newMakerPanel: '' } });
  const canvasChoices = ['1:1', '9:16'].map((canvasChoice, index) => {
    const button = new FakeTarget(doc, { dataset: { canvasChoice } });
    button.classList.toggle('active', index === 0);
    return button;
  });
  const makerStarts = ['character', 'blank'].map((makerStart, index) => {
    const button = new FakeTarget(doc, { dataset: { makerStart } });
    button.classList.toggle('active', index === 0);
    return button;
  });
  const closeMakerButton = new FakeTarget(doc);
  const closeRecoveryButton = new FakeTarget(doc);
  const closeLifecycleButton = new FakeTarget(doc);
  const lifecycleOpenEditor = new FakeTarget(doc, {
    dataset: { lifecycleAction: 'open-editor' },
  });
  lifecycleOpenEditor.parent = doc.getElementById('makerLifecycleManagerModal');
  doc.selectorLists.set('.page', pages);
  doc.selectorLists.set('[data-page]', pageButtons);
  doc.selectorLists.set('[data-filter]', filterButtons);
  doc.selectorLists.set('[data-i18n]', [localizedNav]);
  doc.selectorLists.set('[data-i18n-placeholder]', []);
  doc.selectorLists.set('[data-i18n-title]', []);
  doc.selectorLists.set('[data-i18n-aria-label]', []);
  doc.selectorLists.set('.account-grid [data-page]', [doc.getElementById('accountMakeOc')]);
  doc.selectorLists.set('[data-soulidity-auth]', [
    doc.getElementById('soulidityMySoulsLink'),
    doc.getElementById('soulidityProfileLink'),
  ]);
  doc.selectorLists.set('[data-creator-view]', []);
  doc.selectorLists.set('[data-editor-panel]', []);
  doc.selectorLists.set('[data-editor-panel-button]', []);
  doc.selectorLists.set('[data-new-maker-panel]', [newMakerButton]);
  doc.selectorLists.set('[data-close-maker-modal]', [closeMakerButton]);
  doc.selectorLists.set('[data-canvas-choice]', canvasChoices);
  doc.selectorLists.set('[data-maker-start]', makerStarts);
  doc.selectorLists.set('[data-close-draft-recovery]', [closeRecoveryButton]);
  doc.selectorLists.set('[data-close-maker-lifecycle]', [closeLifecycleButton]);
  doc.selectorSingles.set('.account-grid', new FakeTarget(doc));

  const win = new FakeWindow(doc, { initialUrl, storageMap });
  if (soulidityAppUrl !== null) win.ANIMACRAFT_CONFIG = { soulidityAppUrl };
  if (initialLocale) win.localStorage.setItem('animacraft-locale', initialLocale);
  let selectedConnection = connection;
  const calls = {
    selector: 0,
    disconnect: 0,
    locales: [],
    bridgeReady: 0,
    bridgeSubscribe: 0,
    listTemplates: 0,
    getTemplate: [],
    loadCertifiedAsset: [],
    docsCreate: 0,
    docsRender: [],
    dispatch: [],
    replace: [],
    listVersions: 0,
    restore: [],
    openPlayer: [],
    updatePlayerRecipe: [],
    resetPlayerRecipe: 0,
    getPlayerSnapshot: 0,
    renderPlayerPreview: [],
    renderPlayerExport: [],
    renderDraftPreview: [],
    completePlayerJourney: [],
    listDrafts: 0,
    createDraft: [],
    getDraft: [],
    sequence: [],
  };
  const walletUi = {
    async openWalletSelector() { calls.selector += 1; },
    async disconnect() { calls.disconnect += 1; selectedConnection = null; },
    getConnection() { return selectedConnection; },
    setLocale(locale) { calls.locales.push(locale); },
  };
  let current = record;
  let draftRows = structuredClone(draftsResult);
  let currentPlayerSession = null;
  const bridgeListeners = new Set();
  let bridgeState = {
    runtime: {
      status: 'STARTING',
      transport: 'SUI_GRPC_GRAPHQL',
      jsonRpc: false,
      issue: null,
    },
    capabilities: { nativeCompletionConfigured },
  };
  const emitBridge = (next = bridgeState) => {
    bridgeState = next;
    bridgeListeners.forEach((listener) => listener(next));
  };
  const bridge = {
    async ready() {
      calls.bridgeReady += 1;
      if (bridgeReadyError) {
        emitBridge({
          runtime: {
            status: 'ERROR', transport: 'SUI_GRPC_GRAPHQL', jsonRpc: false,
            issue: { message: bridgeReadyError.message },
          },
        });
        throw bridgeReadyError;
      }
      emitBridge({
        runtime: {
          status: 'READY', transport: 'SUI_GRPC_GRAPHQL', jsonRpc: false, issue: null,
        },
        capabilities: { nativeCompletionConfigured },
      });
      return true;
    },
    subscribe(listener) {
      calls.bridgeSubscribe += 1;
      bridgeListeners.add(listener);
      listener(bridgeState);
      return () => bridgeListeners.delete(listener);
    },
    async listTemplates() {
      calls.listTemplates += 1;
      return structuredClone(
        typeof templatesResult === 'function'
          ? templatesResult(calls.listTemplates)
          : templatesResult,
      );
    },
    async getTemplate({ makerId }) {
      calls.sequence.push(`getTemplate:${makerId}`);
      calls.getTemplate.push(makerId);
      if (templateResult instanceof Error) throw templateResult;
      if (typeof templateResult === 'function') return templateResult(makerId);
      return structuredClone(templateResult || {
        rootId: makerId,
        title: 'Certified Maker',
        certifiedAssets: [],
      });
    },
    async loadCertifiedAsset({ asset }) {
      calls.sequence.push(`loadCertifiedAsset:${asset.assetId}`);
      calls.loadCertifiedAsset.push(asset);
      if (typeof certifiedAssetResult === 'function') return certifiedAssetResult(asset);
      return {
        ...structuredClone(asset),
        dataUrl: `data:${asset.mediaType};base64,AQ==`,
      };
    },
    async openPlayerSession({ rootId }) {
      calls.sequence.push(`openPlayerSession:${rootId}`);
      calls.openPlayer.push({ rootId });
      if (playerSessionResult instanceof Error) throw playerSessionResult;
      const result = typeof playerSessionResult === 'function'
        ? await playerSessionResult(rootId)
        : structuredClone(playerSessionResult || playerSession(rootId));
      currentPlayerSession = structuredClone(result);
      return result;
    },
    async getPlayerSnapshot() {
      calls.getPlayerSnapshot += 1;
      if (!currentPlayerSession) return null;
      return structuredClone({
        status: currentPlayerSession.status,
        player: currentPlayerSession.player,
        recipe: currentPlayerSession.recipe,
        loadout: currentPlayerSession.loadout,
        execution: currentPlayerSession.execution,
      });
    },
    async updatePlayerRecipe(patch) {
      calls.updatePlayerRecipe.push(structuredClone(patch));
      currentPlayerSession.recipe = {
        ...currentPlayerSession.recipe,
        ...structuredClone(patch),
      };
      currentPlayerSession.loadout = {
        ...currentPlayerSession.loadout,
        selections: exactLoadoutSelections(
          currentPlayerSession.player.document,
          currentPlayerSession.recipe,
          currentPlayerSession.player,
        ),
        outputKey: currentPlayerSession.recipe.outputKey,
        usedPacks: exactUsedPacks(currentPlayerSession.recipe),
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(currentPlayerSession.recipe),
      };
      return structuredClone(currentPlayerSession.recipe);
    },
    async resetPlayerRecipe() {
      calls.resetPlayerRecipe += 1;
      return structuredClone(currentPlayerSession.recipe);
    },
    async listDrafts() {
      calls.listDrafts += 1;
      return structuredClone(draftRows);
    },
    async createDraft(input) {
      calls.createDraft.push(structuredClone(input));
      const createdAt = 1_800_000_000_000 + calls.createDraft.length;
      const draftId = `created-maker-${calls.createDraft.length}`;
      const dimensions = input.canvas === '1080×1920'
        ? { width: 1080, height: 1920 } : { width: 1024, height: 1024 };
      const created = {
        schemaVersion: 'animacraft.maker-v8-draft-record.v1',
        draftId,
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        document: createCharacterMakerV8Starter({
          makerKey: draftId,
          name: input.name,
          ...dimensions,
        }),
      };
      current = created;
      draftRows.unshift(created);
      return structuredClone(created);
    },
    async getDraft({ draftId }) {
      calls.getDraft.push(draftId);
      const found = draftRows.find((row) => row.draftId === draftId) || current;
      return { draft: structuredClone(found), assets: structuredClone(draftAssets) };
    },
    async dispatchDraftCommand(input) {
      calls.dispatch.push(input);
      const document = structuredClone(current.document);
      if (input.command.type === 'part.upsert') {
        const index = document.parts.findIndex((part) => part.key === input.command.row.key);
        document.parts[index] = structuredClone(input.command.row);
      } else if (input.command.type === 'canvas.set') {
        document.canvas = structuredClone(input.command.canvas);
      } else if (input.command.type === 'metadata.set') {
        document.metadata = structuredClone(input.command.metadata);
      } else if (input.command.type === 'livingContent.set') {
        document.livingContent = structuredClone(input.command.livingContent);
      } else if (input.command.type === 'rule.upsert') {
        const index = document.rules.findIndex(rule => rule.key === input.command.row.key);
        if (index < 0) document.rules.push(structuredClone(input.command.row));
        else document.rules[index] = structuredClone(input.command.row);
      } else if (input.command.type === 'rule.remove') {
        document.rules = document.rules.filter(rule => rule.key !== input.command.key);
      }
      current = { ...current, revision: current.revision + 1, document };
      return current;
    },
    async replaceDraftDocument(input) {
      calls.replace.push(input);
      current = { ...current, revision: current.revision + 1, document: input.document };
      return current;
    },
    async listDraftVersions() {
      calls.listVersions += 1;
      return [current, record];
    },
    async restoreDraftVersion(input) {
      calls.restore.push(input);
      current = { ...record, revision: current.revision + 1 };
      const index = draftRows.findIndex((row) => row.draftId === current.draftId);
      if (index >= 0) draftRows[index] = current;
      return current;
    },
  };
  if (renderPlayerPreviewResult !== undefined) {
    let lastPreview;
    bridge.renderPlayerPreview = async ({ rootId }) => {
      calls.renderPlayerPreview.push(rootId);
      lastPreview = structuredClone(typeof renderPlayerPreviewResult === 'function'
        ? await renderPlayerPreviewResult(rootId, calls.renderPlayerPreview.length)
        : renderPlayerPreviewResult);
      return structuredClone(lastPreview);
    };
    bridge.renderPlayerExport = async (input) => {
      calls.renderPlayerExport.push(structuredClone(input));
      if (renderPlayerExportResult !== undefined) return structuredClone(typeof renderPlayerExportResult === 'function'
        ? await renderPlayerExportResult(input, calls.renderPlayerExport.length) : renderPlayerExportResult);
      const { width, height } = currentPlayerSession.player.document.canvas;
      const scale = input.exportOptions.sizeMode === 'standard' ? Math.min(1, 1024 / Math.max(width, height)) : 1;
      return { ...structuredClone(lastPreview), width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    };
  }
  if (renderDraftPreviewResult !== undefined) {
    bridge.renderDraftPreview = async ({ draftId }) => {
      calls.renderDraftPreview.push(draftId);
      return structuredClone(typeof renderDraftPreviewResult === 'function'
        ? await renderDraftPreviewResult(draftId, calls.renderDraftPreview.length)
        : renderDraftPreviewResult);
    };
  }
  if (completePlayerJourneyResult !== undefined) {
    if (exportPlayerEnvelopeRecovery) bridge.exportPlayerEnvelopeRecovery = exportPlayerEnvelopeRecovery;
    if (openPlayerReception) bridge.openPlayerReception = openPlayerReception;
    bridge.completePlayerJourney = async (input, options) => {
      calls.completePlayerJourney.push(structuredClone(input));
      if (completePlayerJourneyResult instanceof Error) throw completePlayerJourneyResult;
      const result = typeof completePlayerJourneyResult === 'function'
        ? await completePlayerJourneyResult(input, calls.completePlayerJourney.length, options)
        : completePlayerJourneyResult;
      return structuredClone(result?.status === 'HANDOFF_READY' ? {
        actionId: 'completed-test-action', soulId: ROOT_TWO, transactionDigest: 'completed-test-digest',
        ...result, completedProjectHash: result.completedProjectHash ?? await exactProjectHash(input.project),
      } : result);
    };
  }
  const docsCenterFactory = () => {
    calls.docsCreate += 1;
    return {
      render(locale) { calls.docsRender.push(locale); },
    };
  };
  return {
    doc,
    win,
    bridge,
    walletUi,
    docsCenterFactory,
    calls,
    options,
    newMakerButton,
    canvasChoices,
    makerStarts,
    lifecycleOpenEditor,
    pageButtons,
    filterButtons,
    localizedNav,
    emitBridge,
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForEvent(event) {
  await Promise.all((event?.listenerResults || []).filter((result) => (
    result && typeof result.then === 'function'
  )));
}

function canonicalTestJson(value) {
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(Object.keys(candidate).sort().flatMap((key) => (
        candidate[key] === undefined ? [] : [[key, normalize(candidate[key])]]
      )));
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

async function exactProjectHash(value) {
  const bytes = new TextEncoder().encode(canonicalTestJson(value));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('the adapter imports only Fresh-v8 data, restored Docs, and approved renderers', () => {
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imports, [
    './maker-v8-document.js',
    './maker-workspace-v8-view.js',
    './maker-player-v8-view.js',
    './docs-center.js',
    './maker-v8-player-definition-resolution.js',
    './maker-v8-player-colors.js',
    './maker-workspace-i18n.js',
    './maker-editor-shell.js',
    './maker-definition-editor.js',
    './maker-definition-rule-control.js',
    './maker-v8-pack-authoring.js',
    '@mysten/sui/utils',
    './maker-v8-player-pack-preferences.js',
    './maker-v8-local-player-controls.js',
    './maker-v8-render-core.js',
    './docs-center-content.js',
    './maker-v8-project-zip.js',
    './maker-v8-rules.js',
    './maker-v8-visibility.js',
    './maker-v8-living-content.js',
    './maker-v8-creator-image.js',
    './maker-v8-composable-artwork-store.js',
    './maker-v8-creator-cover.js',
    './maker-v8-creator-structure.js',
    './maker-v8-creator-tracks.js',
    './maker-v8-creator-colors.js',
    './maker-v8-creator-style.js',
  ]);
  assert.doesNotMatch(source, /product-shell|legacy/i);
  assert.doesNotMatch(source, /function (?:creatorPartList|creatorItemRows|creatorStyleRows|creatorInspector|advancedBody|creatorOverlay)\b/);
  assert.match(source, /projectMakerV8WorkspaceView/);
  assert.match(source, /renderApprovedMakerV8Workspace/);
  assert.match(source, /projectMakerV8PlayerView/);
  assert.match(source, /renderApprovedMakerV8Player/);
  // A transient hidden download anchor is not an alternative product layout.
  assert.doesNotMatch(source.replace('doc.body?.appendChild?.(anchor);', ''), /appendChild|insertAdjacentHTML|CSSStyleSheet/);
  assert.match(source, /doc\.createElement\?\.\('a'\)/, 'only a transient download anchor may be created');
  assert.doesNotMatch(source, /bridge\.(?:connectWallet|disconnectWallet)/);
  assert.match(source, /walletUi.*openWalletSelector/s);
  assert.match(source, /walletUi.*disconnect/s);
  assert.match(source, /walletUi.*getConnection/s);
});

test('the approved Creator order, shell classes and dialog ARIA render from one exact v8 document', () => {
  const record = draftRecord();
  const markup = renderOriginalCreatorWorkspace(record, {
    creatorTab: 'commerce',
    lifecycle: { label: 'Draft', manageLabel: 'Manage status', badgeClass: 'draft' },
    versionHistoryOpen: true,
    versionHistoryStatus: 'ready',
    versionEntries: [record],
  }, { default: true });
  let cursor = -1;
  ORIGINAL_CREATOR_TABS.forEach((tab) => {
    const index = markup.indexOf(`data-tab="${tab.id}"`, cursor + 1);
    assert.ok(index > cursor, `${tab.label} must retain its approved order.`);
    cursor = index;
  });
  assert.match(markup, /class="v4-studio-shell"/);
  assert.match(markup, /class="v4-studio-tabs" role="tablist" aria-label="Maker tools"/);
  assert.match(markup, /class="v4-studio-workspace"/);
  assert.match(markup, /class="v4-parts-browser"/);
  assert.match(markup, /class="v4-canvas-column"/);
  assert.match(markup, /class="v4-inspector"/);
  assert.match(markup, /id="makerV4ToolDialog" class="v4-advanced-panel primary-tool" role="dialog" aria-modal="true" aria-labelledby="makerV4ToolTitle"/);
  assert.match(markup, /class="v4-version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="makerVersionHistoryTitle"/);
  assert.match(markup, /data-action="manage-lifecycle" aria-label="Manage status"/);
  assert.match(markup, /data-action="open-version-history">Version history/);
  assert.doesNotMatch(markup.match(/<button[^>]+data-action="open-player"[^>]*>/)?.[0] || '', /disabled/);
  assert.match(markup, /id="makerV4CreatorCanvas" class="v4-runtime-canvas"[^>]*aria-label="Maker canvas"/);
  assert.doesNotMatch(markup, /Fresh Maker v8 market|Astral Courier|Hanamori Spirit|Local starter/i);
});

test('wallet connections unlock only for an explicit sui:mainnet Wallet Standard account', () => {
  const address = `0x${'12'.repeat(32)}`;
  assert.deepEqual(normalizeOriginalWalletConnection(null), {
    connected: false, address: null, network: null, provider: null,
  });
  assert.deepEqual(normalizeOriginalWalletConnection({
    wallet: { name: 'Slush' },
    account: { address, chains: ['sui:mainnet'] },
  }), {
    connected: true, address, network: 'mainnet', provider: 'Slush',
  });
  for (const connection of [
    { wallet: { name: 'Slush' }, account: { address: `0x${'0'.repeat(64)}`, chains: ['sui:mainnet'] } },
    { wallet: { name: 'Slush' }, account: { address, chains: ['sui:testnet'] }, network: 'mainnet' },
    { wallet: { name: 'Slush' }, account: { address, chains: [] }, network: 'mainnet' },
    { wallet: { name: 'Slush' }, account: { address, network: 'mainnet' } },
  ]) {
    assert.deepEqual(normalizeOriginalWalletConnection(connection), {
      connected: false, address: null, network: null, provider: null,
    });
  }
});

test('shell readiness awaits and observes the Fresh-v8 bridge before walletless catalog reads', async () => {
  let harness;
  harness = browserHarness({
    templatesResult: () => {
      assert.equal(harness.calls.bridgeReady, 1, 'catalog reads start after bridge.ready');
      assert.equal(harness.calls.bridgeSubscribe, 1, 'bridge state is already observed');
      return { status: 'READY', makers: [certifiedMaker()], diagnostics: [] };
    },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;

  assert.equal(harness.calls.bridgeReady, 1);
  assert.equal(harness.calls.bridgeSubscribe, 1);
  assert.equal(harness.calls.listTemplates, 1);
  assert.equal(app.getState().bridgeStatus, 'READY');
  assert.equal(app.getState().templatesStatus, 'ready');
  assert.equal(app.getState().templateCount, 1);
  assert.equal(harness.doc.getElementById('publicMakerCount').textContent, '1');
  assert.equal(harness.calls.selector, 0, 'public discovery never opens a wallet');

  harness.emitBridge({
    runtime: {
      status: 'ERROR', transport: 'SUI_GRPC_GRAPHQL', jsonRpc: false,
      issue: { message: 'runtime changed' },
    },
  });
  assert.equal(app.getState().bridgeStatus, 'ERROR');
  assert.match(harness.doc.getElementById('chainStatusGrid').innerHTML, /runtime changed/);
  app.destroy();
});

test('local Creator initialization and editing remain available before remote readiness or discovery settles', async (context) => {
  for (const stage of ['readiness', 'discovery', 'failure']) {
    await context.test(stage, async () => {
      const record = draftRecord();
      const harness = browserHarness({
        connection: { account: { address: `0x${'78'.repeat(32)}`, chains: ['sui:mainnet'] } },
        record, draftsResult: [record], draftAssets: [localDraftAsset()],
        renderDraftPreviewResult: canonicalPreview(),
        bridgeReadyError: stage === 'failure' ? new Error('chain unavailable') : null,
      });
      const gate = deferred();
      if (stage === 'readiness') harness.bridge.ready = async () => gate.promise;
      if (stage === 'discovery') harness.bridge.listTemplates = async () => gate.promise;
      const app = createOriginalProductApp(harness);
      await app.localReady;
      assert.equal(app.getState().draftsStatus, 'ready');
      assert.equal(app.getState().draftId, 'approved-maker');
      assert.match(harness.doc.getElementById('imageMakerList').innerHTML, /Approved Maker/);
      app.navigate('creator');
      await app.openDraft('approved-maker');
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      assert.match(mount.innerHTML, /Preview ready/);
      const name = new FakeTarget(harness.doc, { dataset: { action: 'maker-name' } });
      name.parent = mount;
      name.value = 'Local edit while chain unavailable';
      mount.fire('change', { target: name });
      await settle();
      assert.equal(app.getState().revision, 2);
      assert.match(mount.innerHTML, /Local edit while chain unavailable/);
      assert.equal(harness.calls.selector, 0);
      assert.deepEqual(harness.calls.openPlayer, []);
      if (stage !== 'failure') gate.resolve(stage === 'readiness' ? true : { status: 'READY', makers: [], diagnostics: [] });
      await app.ready;
      assert.equal(app.getState().revision, 2, 'late chain startup must not reinstall the original draft');
      if (stage === 'failure') {
        assert.equal(app.getState().bridgeStatus, 'ERROR');
        assert.match(harness.doc.getElementById('chainStatusGrid').innerHTML, /chain unavailable/);
      }
      app.destroy();
    });
  }
});

test('late local initialization cannot replace an in-flight selected draft or resurrect a destroyed app', async (context) => {
  for (const destroyed of [false, true]) {
    await context.test(destroyed ? 'destroyed' : 'selected draft loading', async () => {
      const harness = browserHarness();
      const list = deferred();
      const selected = deferred();
      harness.bridge.listDrafts = async () => list.promise;
      harness.bridge.getDraft = async () => selected.promise;
      const app = createOriginalProductApp(harness);
      const opening = destroyed ? null : app.openDraft('selected');
      if (destroyed) app.destroy();
      list.resolve([draftRecord()]);
      assert.equal(await app.localReady, null);
      assert.equal(app.getState().draftId, null);
      if (!destroyed) {
        const record = { ...draftRecord(), draftId: 'selected' };
        selected.resolve({ draft: record, assets: [] });
        await opening;
        assert.equal(app.getState().draftId, 'selected');
      }
      await app.ready;
      app.destroy();
    });
  }
});

test('local storage failure is visible independently of successful remote initialization', async () => {
  const harness = browserHarness();
  harness.bridge.listDrafts = async () => { throw new Error('local storage unavailable'); };
  const app = createOriginalProductApp(harness);
  await app.ready;
  assert.equal(app.getState().bridgeStatus, 'READY');
  assert.equal(app.getState().draftsStatus, 'error');
  assert.equal(app.getState().draftsError, 'local storage unavailable');
  assert.equal(app.getState().draftId, null);
  assert.match(harness.doc.getElementById('imageMakerList').innerHTML, /local storage unavailable/);
  app.destroy();
});

test('account language restores the original lifecycle and keeps wallet and Docs locale aligned', async () => {
  const harness = browserHarness({ initialLocale: 'zh' });
  const app = createOriginalProductApp(harness);
  await app.ready;

  assert.equal(app.getState().locale, 'zh');
  assert.equal(harness.doc.documentElement.lang, 'zh-CN');
  assert.equal(harness.doc.getElementById('accountLanguage').value, 'zh');
  assert.equal(harness.localizedNav.textContent, '模板广场');
  assert.deepEqual(harness.calls.locales, ['zh']);

  app.navigate('docs');
  assert.equal(harness.calls.docsCreate, 1);
  assert.equal(harness.calls.docsRender.at(-1), 'zh');
  assert.equal((harness.doc.getElementById('protocolSteps').innerHTML.match(/class="protocol-card"/g) || []).length, 6);

  const select = harness.doc.getElementById('accountLanguage');
  select.value = 'ja';
  select.fire('change');
  assert.equal(app.getState().locale, 'ja');
  assert.equal(harness.win.localStorage.getItem('animacraft-locale'), 'ja');
  assert.equal(harness.doc.documentElement.lang, 'ja');
  assert.equal(harness.localizedNav.textContent, 'テンプレート');
  assert.deepEqual(harness.calls.locales, ['zh', 'ja']);
  assert.equal(harness.calls.docsRender.at(-1), 'ja');
  app.destroy();
});

test('all five donor locales drive account and chain runtime copy in the existing nodes', async () => {
  const harness = browserHarness();
  const app = createOriginalProductApp(harness);
  await app.ready;
  const expected = {
    en: ['Wallet not connected', 'Animacraft user', 'Choose a published Maker from Templates first', 'Network', 'Wallet', 'Discovery'],
    zh: ['钱包未连接', 'Animacraft 用户', '请先从模板广场选择已发布的 Maker', '网络', '钱包', '链上发现'],
    ja: ['ウォレット未接続', 'Animacraft ユーザー', '先にテンプレートから公開済み Maker を選択してください', 'ネットワーク', 'ウォレット', '検出'],
    ko: ['지갑 연결 안 됨', 'Animacraft 사용자', '먼저 템플릿에서 게시된 Maker를 선택하세요', '네트워크', '지갑', '검색'],
    vi: ['Chưa kết nối ví', 'Người dùng Animacraft', 'Hãy chọn một Maker đã đăng trong Mẫu trước', 'Mạng', 'Ví', 'Khám phá'],
  };
  for (const [locale, [wallet, guest, makeTitle, network, chainWallet, discovery]] of Object.entries(expected)) {
    app.setLocale(locale, { persist: false });
    assert.equal(harness.doc.getElementById('walletSummary').textContent, wallet);
    assert.equal(harness.doc.getElementById('accountIdentity').textContent, guest);
    assert.equal(harness.doc.getElementById('accountMakeOc').title, makeTitle);
    const chain = harness.doc.getElementById('chainStatusGrid').innerHTML;
    assert.match(chain, new RegExp(`>${network}<`));
    assert.match(chain, new RegExp(`>${chainWallet}<`));
    assert.match(chain, new RegExp(`>${discovery}<`));
  }
  app.destroy();
});

test('Soulidity account links project the checked-in canonical origin with no competing local route and fail closed', async () => {
  const configContext = { window: {} };
  runInNewContext(deploymentConfigSource, configContext);
  const deploymentConfig = configContext.window.ANIMACRAFT_CONFIG;
  assert.equal(deploymentConfig.soulidityAppUrl, 'https://www.soulidity.ai');
  assert.equal(Object.isFrozen(deploymentConfig), true);
  assert.deepEqual(Object.keys(deploymentConfig), ['soulidityAppUrl']);
  assert.equal(Object.hasOwn(configContext.window.SoulidityMakerV8, 'soulidityAppUrl'), false);
  assert.equal(Object.hasOwn(configContext.window.SoulidityV8Execution, 'soulidityAppUrl'), false);
  assert.deepEqual(ORIGINAL_PRODUCT_PAGES, ['templates', 'template', 'make', 'creator', 'docs']);
  assert.doesNotMatch(source, /['"]collection['"]|myOcs|ownedCharacter|refreshOwnedCharacters/);

  const disabledHarness = browserHarness({
    initialUrl: 'https://animacraft.soulidity.ai/#collection',
  });
  const disabledApp = createOriginalProductApp(disabledHarness);
  await disabledApp.ready;
  assert.equal(disabledApp.getState().route, 'templates');
  for (const id of ['soulidityMySoulsLink', 'soulidityProfileLink', 'soulidityCommunityLink', 'soulidityMarketLink']) {
    const link = disabledHarness.doc.getElementById(id);
    assert.equal(link.getAttribute('href'), '#');
    assert.equal(link.getAttribute('aria-disabled'), 'true');
    const beforeClick = disabledHarness.win.location.href;
    const click = link.fire('click');
    assert.equal(click.defaultPrevented, true);
    assert.equal(disabledHarness.win.location.href, beforeClick);
  }
  disabledApp.destroy();

  const address = `0x${'19'.repeat(32)}`;
  const configuredHarness = browserHarness({
    connection: { wallet: { name: 'Slush' }, account: { address, chains: ['sui:mainnet'] } },
    initialLocale: 'zh',
    soulidityAppUrl: deploymentConfig.soulidityAppUrl,
  });
  const configuredApp = createOriginalProductApp(configuredHarness);
  await configuredApp.ready;
  const paths = {
    soulidityMySoulsLink: '/my-souls',
    soulidityProfileLink: '/profile',
    soulidityCommunityLink: '/community',
    soulidityMarketLink: '/market',
  };
  for (const [id, pathname] of Object.entries(paths)) {
    const link = configuredHarness.doc.getElementById(id);
    const href = new URL(link.getAttribute('href'));
    assert.equal(href.origin, 'https://www.soulidity.ai');
    assert.equal(href.pathname, pathname);
    assert.equal(href.searchParams.get('source'), 'animacraft');
    assert.equal(href.searchParams.get('lang'), 'zh');
    assert.equal(href.searchParams.get('wallet'), address);
    assert.equal(link.getAttribute('aria-disabled'), 'false');
  }
  await configuredApp.disconnect();
  assert.equal(configuredHarness.doc.getElementById('soulidityMySoulsLink').getAttribute('aria-disabled'), 'true');
  assert.equal(configuredHarness.doc.getElementById('soulidityProfileLink').getAttribute('aria-disabled'), 'true');
  assert.equal(configuredHarness.doc.getElementById('soulidityMySoulsLink').getAttribute('href'), '#');
  assert.equal(configuredHarness.doc.getElementById('soulidityProfileLink').getAttribute('href'), '#');
  assert.equal(configuredHarness.doc.getElementById('soulidityCommunityLink').getAttribute('aria-disabled'), 'false');
  assert.equal(configuredHarness.doc.getElementById('soulidityMarketLink').getAttribute('aria-disabled'), 'false');
  const beforeDisabledClick = configuredHarness.win.location.href;
  const disabledClick = configuredHarness.doc.getElementById('soulidityMySoulsLink').fire('click');
  assert.equal(disabledClick.defaultPrevented, true);
  assert.equal(configuredHarness.win.location.href, beforeDisabledClick);
  assert.equal(
    new URL(configuredHarness.doc.getElementById('soulidityCommunityLink').getAttribute('href')).searchParams.has('wallet'),
    false,
  );
  configuredApp.destroy();
});

test('Template Plaza keeps the approved cards, filters and certified artwork in existing containers', async () => {
  const harness = browserHarness({
    templatesResult: {
      status: 'READY',
      makers: [
        certifiedMaker(),
        certifiedMaker({
          rootId: ROOT_TWO,
          title: 'Daily Maker',
          style: 'Daily icon',
          category: 'daily',
          cover: certifiedCover('daily-cover'),
        }),
      ],
      diagnostics: [],
    },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  const grid = harness.doc.getElementById('templateGrid');

  assert.equal(harness.calls.loadCertifiedAsset.length, 2);
  assert.match(grid.innerHTML, /class="template-card active"/);
  assert.match(grid.innerHTML, /class="template-cover-image"/);
  assert.match(grid.innerHTML, /class="template-body"/);
  assert.match(grid.innerHTML, /class="template-card-actions"/);
  assert.match(grid.innerHTML, /Moon Maker/);
  assert.match(grid.innerHTML, /Daily Maker/);
  assert.doesNotMatch(grid.innerHTML, /Market|Wardrobe|Showcase|local starter/i);

  harness.filterButtons[1].fire('click');
  assert.doesNotMatch(grid.innerHTML, /Moon Maker/);
  assert.match(grid.innerHTML, /Daily Maker/);

  harness.filterButtons[0].fire('click');
  const search = harness.doc.getElementById('templateSearch');
  search.value = 'moon';
  search.fire('input');
  assert.match(grid.innerHTML, /Moon Maker/);
  assert.doesNotMatch(grid.innerHTML, /Daily Maker/);

  harness.doc.getElementById('refreshMakers').fire('click');
  await settle();
  assert.equal(harness.calls.listTemplates, 2);
  app.destroy();
});

test('Template Plaza reads the production catalog adapter schema without legacy field aliases', async () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'production-card', name: 'Production Card' }));
  document.metadata.summary = 'Exact catalog metadata';
  document.metadata.license = { kind: 'paid-commercial', note: 'Exact v8 license note.' };
  document.commerce.makerResaleRoyaltyBps = 425;
  const creatorAddress = `0x${'45'.repeat(32)}`;
  const harness = browserHarness({
    templatesResult: {
      status: 'READY',
      makers: [{
        schemaVersion: 'animacraft.maker-v8-plaza-view.v1',
        id: ROOT_ONE,
        rootId: ROOT_ONE,
        makerKey: 'production-card',
        makerVersion: '1',
        title: 'Production Card',
        summary: 'Exact catalog metadata',
        creatorAddress,
        ownerAddress: creatorAddress,
        lifecycle: 'ACTIVE',
        coverAsset: null,
        counts: { parts: 7, assets: 19, outputs: 1 },
      }],
      diagnostics: [],
    },
    templateResult: {
      schemaVersion: 'animacraft.maker-v8-player-view.v1',
      id: ROOT_ONE,
      rootId: ROOT_ONE,
      makerKey: 'production-card',
      makerVersion: '1',
      title: 'Production Card',
      summary: 'Exact catalog metadata',
      creatorAddress,
      ownerAddress: creatorAddress,
      lifecycle: 'ACTIVE',
      coverAsset: null,
      document,
      certifiedAssets: [],
      evidence: { rootId: ROOT_ONE, contentCommitment: 'aa'.repeat(32) },
    },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  const markup = harness.doc.getElementById('templateGrid').innerHTML;

  assert.match(markup, /Production Card/);
  assert.match(markup, new RegExp(creatorAddress));
  assert.match(markup, /paid-commercial/);
  assert.match(markup, /7 Parts/);
  assert.match(markup, /1 Items/);
  assert.doesNotMatch(markup, /19 Items/, 'certified assets are not Maker Items');
  assert.match(markup, /4\.25%/);
  assert.doesNotMatch(markup, /On-chain creator|Creator terms/);
  assert.deepEqual(harness.calls.getTemplate, [ROOT_ONE]);
  app.destroy();
});

test('walletless Maker detail uses getTemplate and certified assets in the approved detail structure', async () => {
  const maker = certifiedMaker();
  const detailCover = certifiedCover('detail-cover');
  const harness = browserHarness({
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    templateResult: {
      ...maker,
      coverAssetId: detailCover.assetId,
      certifiedAssets: [detailCover],
    },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  const detail = await app.openTemplate(ROOT_ONE);
  const root = harness.doc.getElementById('templateDetail');

  assert.equal(detail.rootId, ROOT_ONE);
  assert.deepEqual(harness.calls.getTemplate, [ROOT_ONE]);
  assert.ok(harness.calls.loadCertifiedAsset.some((asset) => asset.assetId === 'detail-cover'));
  assert.equal(harness.calls.selector, 0, 'detail browsing remains walletless');
  assert.equal(app.getState().route, 'template');
  assert.equal(app.getState().templateDetailStatus, 'ready');
  assert.match(root.innerHTML, /class="template-detail-media"/);
  assert.match(root.innerHTML, /class="template-detail-copy"/);
  assert.match(root.innerHTML, /class="template-detail-metrics"/);
  assert.match(root.innerHTML, /class="template-detail-license"/);
  assert.match(root.innerHTML, /data-detail-start/);
  assert.doesNotMatch(root.innerHTML, /Market|Wardrobe|Showcase/i);

  harness.doc.getElementById('templateDetailBack').fire('click');
  assert.equal(app.getState().route, 'templates');
  assert.equal(harness.win.location.pathname, '/');
  assert.equal(harness.win.location.hash, '#templates');
  app.destroy();
});

test('/maker/:id deep links and popstate restore the approved detail without adding UI', async () => {
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'First Maker', cover: certifiedCover('first-cover') });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Second Maker', cover: certifiedCover('second-cover') });
  const harness = browserHarness({
    initialUrl: `https://animacraft.soulidity.ai/maker/${ROOT_ONE}#template`,
    templatesResult: { status: 'READY', makers: [first, second], diagnostics: [] },
    templateResult: (makerId) => makerId === ROOT_ONE ? first : second,
  });
  const elementCount = harness.doc.elements.size;
  const app = createOriginalProductApp(harness);
  await app.ready;

  assert.equal(app.getState().route, 'template');
  assert.equal(app.getState().templateId, ROOT_ONE);
  assert.deepEqual(harness.calls.getTemplate, [ROOT_ONE]);
  assert.equal(harness.win.location.pathname, `/maker/${ROOT_ONE}`);
  assert.equal(harness.win.history.pushes.length, 0, 'initial deep links do not duplicate history');
  assert.equal(harness.doc.elements.size, elementCount, 'routing reuses the approved DOM');

  harness.win.setLocation(`/maker/${ROOT_TWO}#template`);
  harness.win.fire('popstate');
  await settle();
  await settle();
  assert.equal(app.getState().templateId, ROOT_TWO);
  assert.equal(app.getState().templateDetailStatus, 'ready');
  assert.deepEqual(harness.calls.getTemplate, [ROOT_ONE, ROOT_TWO]);
  assert.match(harness.doc.getElementById('templateDetail').innerHTML, /Second Maker/);
  assert.equal(harness.win.history.pushes.length, 0, 'popstate never pushes a replacement entry');
  app.destroy();
});

test('Maker detail generations reject stale responses and purge removed Base64 covers', async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'First Maker', cover: certifiedCover('first-cover') });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Second Maker', cover: certifiedCover('second-cover') });
  let catalog = [first, second];
  let firstCoverAvailable = true;
  const harness = browserHarness({
    templatesResult: () => ({ status: 'READY', makers: catalog, diagnostics: [] }),
    templateResult: (makerId) => makerId === ROOT_ONE ? firstGate.promise : secondGate.promise,
    certifiedAssetResult: async (asset) => {
      if (asset.assetId === 'first-cover' && !firstCoverAvailable) {
        throw new Error('removed cover is no longer available');
      }
      return {
        ...structuredClone(asset),
        dataUrl: asset.assetId === 'first-cover'
          ? 'data:image/png;base64,QUFB'
          : 'data:image/png;base64,QkJC',
      };
    },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;

  const firstRequest = app.openTemplate(ROOT_ONE);
  const secondRequest = app.openTemplate(ROOT_TWO);
  secondGate.resolve(second);
  await secondRequest;
  firstGate.resolve(first);
  await firstRequest;

  assert.equal(app.getState().templateId, ROOT_TWO);
  assert.equal(app.getState().templateDetailStatus, 'ready');
  assert.match(harness.doc.getElementById('templateDetail').innerHTML, /Second Maker/);
  assert.doesNotMatch(harness.doc.getElementById('templateDetail').innerHTML, /First Maker/);
  assert.deepEqual(harness.win.history.pushes, [
    `/maker/${ROOT_ONE}#template`,
    `/maker/${ROOT_TWO}#template`,
  ]);

  catalog = [second];
  await app.refreshTemplates();
  assert.doesNotMatch(harness.doc.getElementById('templateGrid').innerHTML, /data:image\/png;base64,QUFB/);
  assert.equal(app.getState().templateId, ROOT_TWO);

  firstCoverAvailable = false;
  catalog = [first, second];
  await app.refreshTemplates();
  assert.doesNotMatch(
    harness.doc.getElementById('templateGrid').innerHTML,
    /data:image\/png;base64,QUFB/,
    'a removed Base64 cover is not resurrected when its Maker returns',
  );
  app.destroy();
});

test('catalog loading, empty and error states stay in the approved Template Plaza container', async () => {
  const emptyHarness = browserHarness();
  const emptyApp = createOriginalProductApp(emptyHarness);
  assert.match(emptyHarness.doc.getElementById('templateGrid').innerHTML, /Syncing Makers/);
  await emptyApp.ready;
  assert.match(emptyHarness.doc.getElementById('templateGrid').innerHTML, /plaza-empty-state/);
  assert.match(emptyHarness.doc.getElementById('templateGrid').innerHTML, /No Makers have been published on-chain yet/);
  emptyApp.destroy();

  const errorHarness = browserHarness({ bridgeReadyError: new Error('gRPC unavailable') });
  const errorApp = createOriginalProductApp(errorHarness);
  await errorApp.ready;
  assert.equal(errorApp.getState().templatesStatus, 'error');
  assert.match(errorHarness.doc.getElementById('templateGrid').innerHTML, /gRPC unavailable/);
  assert.equal(errorHarness.doc.getElementById('publicMakerCount').textContent, '0');
  errorApp.destroy();
});

test('Creator reload restores its route only after a valid connection without overriding later navigation', async (context) => {
  const connected = { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } };
  for (const mode of ['immediate', 'delayed', 'other-page', 'wrong-network', 'destroyed']) {
    await context.test(mode, async () => {
      const harness = browserHarness({ initialUrl: 'https://animacraft.soulidity.ai/#creator',
        connection: mode === 'immediate' ? connected : null });
      const app = createOriginalProductApp(harness);
      await app.ready;
      if (mode === 'immediate') assert.equal(app.getState().route, 'creator');
      else {
        assert.equal(app.getState().route, 'templates');
        assert.equal(harness.doc.getElementById('creatorConsole').hidden, true);
        if (mode === 'other-page') app.navigate('docs');
        if (mode === 'destroyed') app.destroy();
        app.refreshConnection(mode === 'wrong-network'
          ? { account: { address: ROOT_ONE, chains: ['sui:testnet'] } } : connected);
        assert.equal(app.getState().route, mode === 'delayed' ? 'creator' : mode === 'other-page' ? 'docs' : 'templates');
      }
      if (mode === 'immediate' || mode === 'delayed') {
        assert.equal(harness.win.location.hash, '#creator');
        app.refreshConnection(null);
        assert.equal(app.getState().route, 'templates');
        app.refreshConnection(connected);
        assert.equal(app.getState().route, 'templates', 'later reconnect must not replay a consumed startup intent');
      }
      app.destroy();
    });
  }
});

test('the existing theme popover preserves active, hidden and focus behavior', async () => {
  const harness = browserHarness();
  const app = createOriginalProductApp(harness);
  await app.ready;
  const button = harness.doc.getElementById('themeButton');
  const menu = harness.doc.getElementById('themeMenu');
  button.fire('click');
  assert.equal(menu.hidden, false);
  assert.equal(menu.classList.contains('active'), true);
  assert.equal(menu.getAttribute('aria-hidden'), 'false');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(harness.doc.activeElement, harness.options[0]);

  menu.fire('keydown', { key: 'ArrowDown' });
  assert.equal(harness.doc.activeElement, harness.options[1]);
  menu.fire('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(menu.classList.contains('active'), false);
  assert.equal(menu.getAttribute('aria-hidden'), 'true');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.doc.activeElement, button);

  harness.win.ANIMACRAFT_THEME.setPreference('soulidity');
  harness.win.fire('focus');
  assert.equal(harness.win.ANIMACRAFT_THEME.applied.at(-1), 'soulidity');
  const applications = harness.win.ANIMACRAFT_THEME.applied.length;
  harness.win.fire('pageshow');
  assert.equal(harness.win.ANIMACRAFT_THEME.applied.length, applications + 1);
  assert.equal(harness.win.ANIMACRAFT_THEME.applied.at(-1), 'soulidity');
  app.destroy();
});

test('the original wallet buttons call only the injected selector and preserve protected routes', async () => {
  const address = `0x${'34'.repeat(32)}`;
  const harness = browserHarness({
    connection: { wallet: { name: 'Slush' }, account: { address, chains: ['sui:mainnet'] } },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  harness.doc.getElementById('walletButton').fire('click');
  await settle();
  assert.equal(harness.calls.selector, 1);
  assert.equal(app.getState().connection.address, address);
  assert.equal(app.navigate('creator'), 'creator');
  assert.equal(harness.win.location.hash, '#creator');
  await app.disconnect();
  assert.equal(harness.calls.disconnect, 1);
  assert.equal(app.getState().connection.connected, false);
  assert.equal(app.getState().route, 'templates');
  app.destroy();
});

test('non-mainnet accounts fail closed and cannot unlock Creator or Player', async () => {
  const address = `0x${'35'.repeat(32)}`;
  const harness = browserHarness({
    connection: {
      wallet: { name: 'Slush' },
      account: { address, chains: ['sui:testnet'] },
      network: 'mainnet',
    },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;

  assert.deepEqual(app.getState().connection, {
    connected: false, address: null, network: null, provider: null,
  });
  assert.equal(app.navigate('creator'), 'templates');
  assert.equal(app.navigate('make'), 'templates');
  assert.equal(harness.doc.getElementById('creatorWalletGate').hidden, false);
  assert.equal(harness.doc.getElementById('creatorConsole').hidden, true);
  assert.equal(harness.doc.getElementById('accountMakeOc').disabled, true);
  app.destroy();
});

test('MyPage Make OC stays gated until the exact selected Player session is READY', async () => {
  const address = `0x${'36'.repeat(32)}`;
  const maker = certifiedMaker();
  const detailGate = deferred();
  const harness = browserHarness({
    connection: { wallet: { name: 'Slush' }, account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    templateResult: () => detailGate.promise,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  const make = harness.doc.getElementById('accountMakeOc');
  assert.equal(make.disabled, true);
  assert.equal(make.title, 'Choose a published Maker from Templates first');
  assert.equal(app.navigate('make'), 'templates');

  const opening = app.openTemplate(ROOT_ONE);
  assert.equal(make.disabled, true, 'loading detail stays fail-closed');
  detailGate.resolve(maker);
  await opening;
  assert.equal(make.disabled, true, 'detail metadata alone cannot unlock Player');
  assert.equal(app.navigate('make'), 'templates');

  await app.openPlayer(ROOT_ONE);
  assert.equal(make.disabled, false);
  assert.equal(make.title, 'Continue the selected Maker session');
  assert.equal(app.getState().route, 'make');
  assert.equal(app.getState().playerRootId, ROOT_ONE);
  app.destroy();
});

test('Template Start Making opens the exact selected Fresh-v8 session before rendering the approved Player', async () => {
  const address = `0x${'37'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    templateResult: maker,
    playerSessionResult: playerSession(ROOT_ONE, 'Moon Maker'),
  });
  const app = createOriginalProductApp(harness);
  await app.ready;

  const use = new FakeTarget(harness.doc, { dataset: { useTemplate: ROOT_ONE } });
  use.parent = harness.doc.getElementById('templateGrid');
  harness.doc.getElementById('templateGrid').fire('click', { target: use });
  await settle();
  await settle();

  assert.deepEqual(harness.calls.openPlayer, [{ rootId: ROOT_ONE }]);
  assert.ok(
    harness.calls.sequence.indexOf(`getTemplate:${ROOT_ONE}`)
      < harness.calls.sequence.indexOf(`openPlayerSession:${ROOT_ONE}`),
    'the approved detail resolves before its Start Making action opens Player',
  );
  assert.equal(app.getState().route, 'make');
  assert.equal(app.getState().playerStatus, 'ready');
  assert.equal(app.getState().playerRootId, ROOT_ONE);
  const markup = harness.doc.getElementById('makerV4PlayerMount').innerHTML;
  assert.match(markup, /class="v4-player-shell"/);
  assert.match(markup, /id="makerV4PlayerCanvas" class="v4-runtime-canvas"/);
  assert.match(markup, /id="makerPlayerInfoDialog" class="v4-player-info-dialog"/);
  assert.match(markup, /data-action="player-item"/);
  assert.doesNotMatch(markup, /Market|Showcase|data-page=/i);
  app.destroy();
});

test('Player session failure stays on the existing Maker detail status area and never opens make', async () => {
  const address = `0x${'38'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    templateResult: maker,
    playerSessionResult: new Error('Certified Player unavailable'),
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openTemplate(ROOT_ONE);

  const start = new FakeTarget(harness.doc, { dataset: { detailStart: '' } });
  start.parent = harness.doc.getElementById('templateDetail');
  harness.doc.getElementById('templateDetail').fire('click', { target: start });
  await settle();
  await settle();

  assert.deepEqual(harness.calls.openPlayer, [{ rootId: ROOT_ONE }]);
  assert.equal(app.getState().route, 'template');
  assert.equal(app.getState().playerStatus, 'error');
  assert.match(harness.doc.getElementById('templateDetail').innerHTML, /Certified Player unavailable/);
  assert.equal(harness.doc.getElementById('makerV4PlayerMount').innerHTML, '');
  app.destroy();
});

test('Start Making rejects Root and commitment drift before mounting the approved Player', async (context) => {
  const address = `0x${'42'.repeat(32)}`;
  const maker = certifiedMaker();
  const cases = [
    ['evidence Root', (session) => { session.player.evidence.rootId = ROOT_TWO; }],
    ['Recipe commitment', (session) => { session.recipe.rootContentCommitment = 'cc'.repeat(32); }],
    ['Loadout commitment', (session) => { session.loadout.rootContentCommitment = 'dd'.repeat(32); }],
  ];
  for (const [label, mutate] of cases) {
    await context.test(label, async () => {
      const session = structuredClone(playerSession(ROOT_ONE));
      mutate(session);
      const harness = browserHarness({
        connection: { account: { address, chains: ['sui:mainnet'] } },
        templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
        templateResult: maker,
        playerSessionResult: session,
      });
      const app = createOriginalProductApp(harness);
      await app.ready;
      await app.openTemplate(ROOT_ONE);
      await assert.rejects(
        app.openPlayer(ROOT_ONE),
        /does not match the selected certified Maker Root/,
      );
      assert.equal(app.getState().route, 'template');
      assert.equal(app.getState().playerStatus, 'error');
      assert.equal(app.getState().playerRootId, null);
      assert.equal(harness.doc.getElementById('makerV4PlayerMount').innerHTML, '');
      app.destroy();
    });
  }
});

test('concurrent Player openings reject stale Maker sessions and keep only the latest exact Root', async () => {
  const first = deferred();
  const second = deferred();
  const address = `0x${'39'.repeat(32)}`;
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: {
      status: 'READY',
      makers: [
        certifiedMaker({ rootId: ROOT_ONE, title: 'First Maker' }),
        certifiedMaker({ rootId: ROOT_TWO, title: 'Second Maker' }),
      ],
      diagnostics: [],
    },
    playerSessionResult: (rootId) => rootId === ROOT_ONE ? first.promise : second.promise,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;

  const firstOpen = app.openPlayer(ROOT_ONE);
  const secondOpen = app.openPlayer(ROOT_TWO);
  second.resolve(playerSession(ROOT_TWO, 'Second Maker'));
  await secondOpen;
  first.resolve(playerSession(ROOT_ONE, 'First Maker'));
  assert.equal(await firstOpen, null);

  assert.equal(app.getState().route, 'make');
  assert.equal(app.getState().playerRootId, ROOT_TWO);
  assert.match(harness.doc.getElementById('makerV4PlayerMount').innerHTML, /Second Maker/);
  assert.doesNotMatch(harness.doc.getElementById('makerV4PlayerMount').innerHTML, /First Maker/);
  app.destroy();
});

test('opening Maker detail B fences a pending Start Making request for detail A', async () => {
  const playerGate = deferred();
  const address = `0x${'40'.repeat(32)}`;
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'First Maker' });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Second Maker' });
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [first, second], diagnostics: [] },
    templateResult: (makerId) => makerId === ROOT_ONE ? first : second,
    playerSessionResult: () => playerGate.promise,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openTemplate(ROOT_ONE);

  const stalePlayer = app.openPlayer(ROOT_ONE);
  await app.openTemplate(ROOT_TWO);
  playerGate.resolve(playerSession(ROOT_ONE, 'First Maker'));
  assert.equal(await stalePlayer, null);

  assert.equal(app.getState().route, 'template');
  assert.equal(app.getState().templateId, ROOT_TWO);
  assert.equal(app.getState().playerStatus, 'idle');
  assert.equal(app.getState().playerRootId, null);
  assert.match(harness.doc.getElementById('templateDetail').innerHTML, /Second Maker/);
  assert.equal(harness.doc.getElementById('makerV4PlayerMount').innerHTML, '');
  app.destroy();
});

test('formal Player Output selection uses the existing recipe bridge and updates the selected control', async () => {
  const session = structuredClone(playerSessionWithAlternate(ROOT_ONE));
  session.player.document.outputs.push({ ...structuredClone(session.player.document.outputs[0]), key: 'alternate-output', label: 'Alternate output' });
  const harness = browserHarness({
    connection: { account: { address: `0x${'41'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session,
  });
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openPlayer(ROOT_ONE);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    const output = new FakeTarget(harness.doc, { dataset: { action: 'player-output', outputKey: 'alternate-output' } });
    output.parent = mount;
    await waitForEvent(mount.fire('click', { target: output }));
    assert.deepEqual(harness.calls.updatePlayerRecipe, [{ outputKey: 'alternate-output' }]);
    assert.match(mount.innerHTML, /data-output-key="alternate-output"[^>]*aria-checked="true"/);
    assert.match(mount.innerHTML, /class="primary" data-action="player-output" data-output-key="alternate-output"/);
  } finally { app.destroy(); }
});

test('Player actions await the Promise snapshot before projecting the exact updated recipe', async () => {
  const address = `0x${'41'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const alternate = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate:alternate' },
  });
  alternate.parent = mount;
  mount.fire('click', { target: alternate });
  await settle();
  await settle();

  assert.equal(harness.calls.updatePlayerRecipe.length, 1);
  assert.equal(harness.calls.getPlayerSnapshot, 2, 'the mutation reads fresh state before and after update');
  assert.equal(
    harness.calls.updatePlayerRecipe[0].selections[1].itemKey,
    'alternate',
  );
  assert.equal(harness.calls.updatePlayerRecipe[0].selections.length, 2);
  assert.match(
    mount.innerHTML,
    /class="v4-player-item active"[^>]+data-choice-id="base:base:alternate:alternate"/,
  );

  const alternateStyle = new FakeTarget(harness.doc, {
    dataset: { action: 'player-style', choiceId: 'base:base:alternate:alternate-2' },
  });
  alternateStyle.parent = mount;
  mount.fire('click', { target: alternateStyle });
  await settle();
  await settle();
  assert.equal(harness.calls.updatePlayerRecipe[1].selections.length, 2);
  assert.equal(harness.calls.updatePlayerRecipe[1].selections[1].styleKey, 'alternate-2');

  const selectedDefault = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:default:default' },
  });
  selectedDefault.parent = mount;
  mount.fire('click', { target: selectedDefault });
  await settle();
  await settle();
  assert.deepEqual(
    harness.calls.updatePlayerRecipe[2].selections.map((selection) => selection.itemKey),
    ['alternate'],
    'a selected card is removed precisely without flattening another card in the same Part',
  );

  const none = new FakeTarget(harness.doc, {
    dataset: { action: 'player-none', partId: 'base' },
  });
  none.parent = mount;
  mount.fire('click', { target: none });
  await settle();
  assert.equal(harness.calls.updatePlayerRecipe.length, 3, 'required Parts cannot be emptied');
  app.destroy();
});

test('a required capacity-one Part atomically switches Items and still replaces only the selected Item style', async () => {
  const address = `0x${'61'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE, { capacity: 1 }),
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fireChoice = async (action, choiceId) => {
    const control = new FakeTarget(harness.doc, { dataset: { action, choiceId } });
    control.parent = mount;
    mount.fire('click', { target: control });
    await settle();
    await settle();
  };

  await fireChoice('player-item', 'base:base:alternate:alternate');
  assert.deepEqual(
    harness.calls.updatePlayerRecipe[0].selections.map(({ itemKey, styleKey }) => ({ itemKey, styleKey })),
    [{ itemKey: 'alternate', styleKey: 'alternate' }],
    'the required capacity-one slot replaces its old Item in one bridge update',
  );

  await fireChoice('player-style', 'base:base:alternate:alternate-2');
  assert.deepEqual(
    harness.calls.updatePlayerRecipe[1].selections.map(({ itemKey, styleKey }) => ({ itemKey, styleKey })),
    [{ itemKey: 'alternate', styleKey: 'alternate-2' }],
  );

  await fireChoice('player-item', 'base:base:default:default');
  assert.deepEqual(
    harness.calls.updatePlayerRecipe[2].selections.map(({ itemKey, styleKey }) => ({ itemKey, styleKey })),
    [{ itemKey: 'default', styleKey: 'default' }],
  );
  await fireChoice('player-item', 'base:base:default:default');
  assert.equal(harness.calls.updatePlayerRecipe.length, 3, 'the last required selection cannot toggle off');
  app.destroy();
});

test('rapid Player choices serialize against a fresh awaited snapshot without losing either update', async () => {
  const address = `0x${'62'.repeat(32)}`;
  const maker = certifiedMaker();
  const firstSnapshot = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE, {
      capacity: 3,
      secondAlternate: true,
    }),
  });
  const getSnapshot = harness.bridge.getPlayerSnapshot.bind(harness.bridge);
  let holdFirstSnapshot = true;
  harness.bridge.getPlayerSnapshot = async () => {
    if (holdFirstSnapshot) {
      holdFirstSnapshot = false;
      await firstSnapshot.promise;
    }
    return getSnapshot();
  };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const first = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate:alternate' },
  });
  const second = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate-b:alternate-b' },
  });
  first.parent = mount;
  second.parent = mount;
  mount.fire('click', { target: first });
  mount.fire('click', { target: second });
  await settle();
  assert.equal(harness.calls.updatePlayerRecipe.length, 0, 'updates wait for the fresh snapshot');

  firstSnapshot.resolve();
  await settle();
  await settle();
  await settle();
  assert.equal(harness.calls.updatePlayerRecipe.length, 2);
  assert.deepEqual(
    harness.calls.updatePlayerRecipe[0].selections.map((selection) => selection.itemKey),
    ['default', 'alternate'],
  );
  assert.deepEqual(
    harness.calls.updatePlayerRecipe[1].selections.map((selection) => selection.itemKey),
    ['default', 'alternate', 'alternate-b'],
    'the second click is derived from the first click\'s exact post-update snapshot',
  );
  assert.equal(harness.calls.getPlayerSnapshot, 4);
  app.destroy();
});

test('a pending recipe mutation waits for the latest canonical render, merges profile and Soul edits, and survives reopen', async () => {
  const address = `0x${'64'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const mutationEntered = deferred();
  const releaseMutation = deferred();
  const renderEntered = deferred();
  const releaseRender = deferred();
  const mergedRecipeSaved = deferred();
  let durableWrites = 0;
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
    renderPlayerPreviewResult: (_rootId, call) => {
      if (call === 1) return canonicalPreview({ sha256: 'd1'.repeat(32) });
      renderEntered.resolve();
      return releaseRender.promise;
    },
    storageMap,
  });
  const updatePlayerRecipe = harness.bridge.updatePlayerRecipe.bind(harness.bridge);
  harness.bridge.updatePlayerRecipe = async (patch) => {
    mutationEntered.resolve(structuredClone(patch));
    await releaseMutation.promise;
    return updatePlayerRecipe(patch);
  };
  const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
  harness.win.localStorage.setItem = (key, value) => {
    const result = setItem(key, value);
    if (key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')) {
      const record = JSON.parse(String(value));
      durableWrites += 1;
      mergedRecipeSaved.resolve(record);
    }
    return result;
  };

  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const alternate = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate:alternate' },
  });
  alternate.parent = mount;
  const recipeEvent = mount.fire('click', { target: alternate });
  await mutationEntered.promise;

  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  profile.parent = mount;
  profile.value = 'Merged Nora';
  const profileEvent = mount.fire('change', { target: profile });
  const soul = new FakeTarget(harness.doc, {
    dataset: { action: 'player-soul-document', soulKey: 'soulMd' },
  });
  soul.parent = mount;
  soul.value = 'Soul update while recipe pending';
  const soulEvent = mount.fire('change', { target: soul });
  assert.equal(durableWrites, 0, 'local edits cannot persist the controller\'s old recipe');

  releaseMutation.resolve();
  await renderEntered.promise;
  assert.equal(durableWrites, 0, 'the merged project waits for its exact canonical render');
  const exactRender = canonicalPreview({ width: 777, height: 555, sha256: 'd2'.repeat(32) });
  releaseRender.resolve(exactRender);
  await Promise.all([
    waitForEvent(recipeEvent),
    waitForEvent(profileEvent),
    waitForEvent(soulEvent),
  ]);
  const mergedRecord = await mergedRecipeSaved.promise;
  assert.equal(durableWrites, 1);
  assert.equal(mergedRecord.session.profile.name, 'Merged Nora');
  assert.equal(mergedRecord.session.soul.documents.soulMd, 'Soul update while recipe pending');
  assert.deepEqual(
    mergedRecord.session.recipe.selections.map((selection) => selection.itemKey),
    ['default', 'alternate'],
  );
  assert.deepEqual(
    mergedRecord.session.loadout.selections.map((selection) => selection.itemKey),
    ['default', 'alternate'],
  );
  assert.equal(mergedRecord.session.render, null, 'recipe persists before the cancellable final export');
  assert.equal(mergedRecord.projectHash, await exactProjectHash(mergedRecord.session));
  app.destroy();

  const reopenedHarness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
    renderPlayerPreviewResult: exactRender,
    storageMap,
  });
  const reopenedApp = createOriginalProductApp(reopenedHarness);
  await reopenedApp.ready;
  await reopenedApp.openPlayer(ROOT_ONE);
  const reopenedMount = reopenedHarness.doc.getElementById('makerV4PlayerMount');
  assert.match(reopenedMount.innerHTML, /value="Merged Nora"[^>]+data-action="player-profile-name"/);
  assert.match(reopenedMount.innerHTML, /Soul update while recipe pending/);
  assert.match(
    reopenedMount.innerHTML,
    /class="v4-player-item active"[^>]+data-choice-id="base:base:alternate:alternate"/,
  );
  assert.deepEqual(
    reopenedHarness.calls.updatePlayerRecipe[0].selections.map((selection) => selection.itemKey),
    ['default', 'alternate'],
  );
  const reopenedProjectKey = [...storageMap.keys()].find((key) => (
    key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
  ));
  assert.equal(JSON.parse(storageMap.get(reopenedProjectKey)).projectHash, mergedRecord.projectHash);
  reopenedApp.destroy();
});

test('a failed post-recipe render is fail-closed in the donor status region and writes no pseudo-complete project', async () => {
  const address = `0x${'65'.repeat(32)}`;
  const maker = certifiedMaker();
  const mutationEntered = deferred();
  const releaseMutation = deferred();
  const renderEntered = deferred();
  const releaseRender = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
    renderPlayerPreviewResult: (_rootId, call) => {
      if (call === 1) return canonicalPreview();
      renderEntered.resolve();
      return releaseRender.promise;
    },
  });
  const updatePlayerRecipe = harness.bridge.updatePlayerRecipe.bind(harness.bridge);
  harness.bridge.updatePlayerRecipe = async (patch) => {
    mutationEntered.resolve();
    await releaseMutation.promise;
    return updatePlayerRecipe(patch);
  };
  const writes = [];
  const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
  harness.win.localStorage.setItem = (key, value) => {
    if (key.startsWith('animacraft:maker-v8-player-project:v1:')) writes.push(key);
    return setItem(key, value);
  };

  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const alternate = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate:alternate' },
  });
  alternate.parent = mount;
  const recipeEvent = mount.fire('click', { target: alternate });
  await mutationEntered.promise;
  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-world' } });
  profile.parent = mount;
  profile.value = 'Must remain local after render failure';
  const profileEvent = mount.fire('change', { target: profile });

  releaseMutation.resolve();
  await renderEntered.promise;
  releaseRender.reject(new Error('canonical render unavailable'));
  await Promise.all([waitForEvent(recipeEvent), waitForEvent(profileEvent)]);

  assert.deepEqual(writes, []);
  assert.match(mount.innerHTML, /canonical render unavailable/);
  assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="dirty"/);
  assert.match(
    harness.doc.getElementById('v4PlayerCompletionStatus').textContent,
    /canonical render unavailable/,
  );
  app.destroy();
});

test('Pack availability toggles persist independently of selection and reject invalid disabling atomically', async () => {
  const session = playerSessionWithPackChoice(ROOT_ONE);
  session.player.document.parts[0].capacity = 1;
  const choice = session.player.contextualChoices.packStyles[0];
  const storageMap = new Map();
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session, renderPlayerPreviewResult: canonicalPreview(), storageMap,
  });
  const update = harness.bridge.updatePlayerRecipe.bind(harness.bridge);
  let rejectUpdates = false;
  harness.bridge.updatePlayerRecipe = async patch => {
    if (rejectUpdates) throw new TypeError('Pack removal violates Rules');
    return update(patch);
  };
  let app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const toggle = new FakeTarget(harness.doc, { dataset: { action: 'player-expansion-v8' } });
  toggle.parent = mount;
  toggle.value = choice.releaseId;
  const saved = () => [...storageMap.entries()].filter(([key]) => key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:'))
    .map(([, value]) => JSON.parse(value))[0].session;
  assert.doesNotMatch(mount.innerHTML, new RegExp(`data-choice-id="${choice.id}"`));
  toggle.checked = true;
  await waitForEvent(mount.fire('change', { target: toggle }));
  assert.deepEqual(saved().enabledPackReleaseIds, [choice.releaseId]);
  assert.deepEqual(saved().loadout.usedPacks, [], 'enabling alone does not use or charge a Pack');
  assert.equal(saved().recipe.selections[0].source, 'BASE');
  assert.match(mount.innerHTML, new RegExp(`data-choice-id="${choice.id}"`));
  await app.destroy();
  app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  assert.match(mount.innerHTML, new RegExp(`data-choice-id="${choice.id}"`));
  const item = new FakeTarget(harness.doc, { dataset: { action: 'player-item', choiceId: choice.id } });
  item.parent = mount;
  await waitForEvent(mount.fire('click', { target: item }));
  assert.equal(saved().recipe.selections[0].source, 'PACK');
  assert.deepEqual(saved().loadout.usedPacks, [{ releaseId: choice.releaseId, semanticPackId: choice.semanticPackId }]);
  rejectUpdates = true;
  toggle.checked = false;
  await waitForEvent(mount.fire('change', { target: toggle }));
  assert.match(mount.innerHTML, /Pack removal violates Rules/);
  assert.equal((await harness.bridge.getPlayerSnapshot()).recipe.selections[0].source, 'PACK');
  assert.deepEqual(saved().enabledPackReleaseIds, [choice.releaseId]);
  rejectUpdates = false;
  await waitForEvent(mount.fire('change', { target: toggle }));
  assert.deepEqual(saved().enabledPackReleaseIds, []);
  assert.deepEqual(saved().loadout.usedPacks, []);
  assert.equal(saved().recipe.selections[0].source, 'BASE');
  assert.equal(saved().recipe.selections[0].itemKey, session.player.document.defaultRecipe.selections[0].itemKey);
  assert.doesNotMatch(mount.innerHTML, new RegExp(`data-choice-id="${choice.id}"`));
  await app.destroy();
});

test('owned-Part picker events isolate same-name Root and two Pack slots for add, replace and remove', async () => {
  const session = playerSessionWithPackChoice(ROOT_ONE);
  session.player.document.parts[0].capacity = 1;
  const first = session.player.contextualChoices.packStyles[0];
  const second = { ...structuredClone(first), id: 'second-owned', releaseId: `0x${'66'.repeat(32)}`,
    semanticPackId: 'second-pack' };
  const replacement = { ...structuredClone(first), id: 'first-replacement', itemKey: 'star' };
  const choices = [first, replacement, second];
  session.player.contextualChoices.packStyles = choices;
  for (const choice of choices) {
    choice.definitionCommitment = 'ab'.repeat(32);
    choice.definitionScope = { part: { source: 'PACK', sourceId: choice.releaseId, key: 'base' } };
  }
  session.player.definitionContext = { rootId: ROOT_ONE, address: session.player.contextualChoices.address,
    packs: [first, second].map(choice => {
      const part = { ...structuredClone(session.player.document.parts[0]), required: false, kind: 'STANDARD', items: [] };
      return { releaseId: choice.releaseId, semanticPackId: choice.semanticPackId,
        definitionCommitment: choice.definitionCommitment, document: { parts: [part] },
        ownedParts: [part], rules: [], styleReferences: choices.filter(row => row.releaseId === choice.releaseId).map(row => ({
          part: { scope: 'PACK_SELF', key: 'base' }, itemKey: row.itemKey, styleKey: row.styleKey,
        })) };
    }) };
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session, renderPlayerPreviewResult: canonicalPreview(),
  });
  // Mirror the real controller's canonical slot ordering after a re-add. The
  // host event assertions below concern which selections survive, not layout.
  const update = harness.bridge.updatePlayerRecipe.bind(harness.bridge);
  harness.bridge.updatePlayerRecipe = async patch => {
    if (patch.selections) {
      const layout = makerV8PlayerRecipeLayout(session.player, patch.selections);
      patch = { ...patch, selections: [...patch.selections].sort((a, b) => layout.slot(a).start - layout.slot(b).start) };
    }
    return update(patch);
  };
  const app = createOriginalProductApp(harness);
  await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = async (action, fields = {}, type = 'click', value = '') => {
    const control = new FakeTarget(harness.doc, { dataset: { action, ...fields } });
    control.parent = mount; control.value = value; control.checked = true;
    await waitForEvent(mount.fire(type, { target: control }));
  };
  for (const choice of [first, second]) {
    await fire('player-expansion-v8', {}, 'change', choice.releaseId);
    const key = `pack:${choice.releaseId}:base`;
    assert.ok(mount.innerHTML.includes(`data-part-id="${key}"`));
    await fire('player-part', { partId: key });
    assert.ok(mount.innerHTML.includes(`data-choice-id="${choice.id}"`));
    await fire('player-item', { choiceId: choice.id });
  }
  const snapshot = () => harness.bridge.getPlayerSnapshot();
  assert.deepEqual((await snapshot()).recipe.selections.map(row => row.source), ['BASE', 'PACK', 'PACK']);
  await fire('player-part', { partId: `pack:${first.releaseId}:base` });
  await fire('player-item', { choiceId: first.id });
  assert.deepEqual((await snapshot()).recipe.selections.map(row => row.releaseId), [null, second.releaseId],
    'clicking the selected card removes only that exact Pack selection');
  await fire('player-item', { choiceId: first.id });
  await fire('player-item', { choiceId: replacement.id });
  assert.deepEqual((await snapshot()).recipe.selections.map(row => row.itemKey), ['default', 'star', 'moon']);
  await fire('player-none', { partId: `pack:${first.releaseId}:base` });
  const remaining = (await snapshot()).recipe.selections;
  assert.deepEqual(remaining.map(row => row.releaseId), [null, second.releaseId]);
  assert.ok(remaining.every(row => row.partKey === 'base'), 'UI identities never leak into protocol keys');
  await fire('player-none', { partId: 'base' });
  assert.deepEqual((await snapshot()).recipe.selections, remaining, 'required Root remains protected');
  await app.destroy();
});

test('a successful Pack toggle survives a newer queued toggle rejection and reopen', async () => {
  const session = playerSessionWithPackChoice(ROOT_ONE);
  const first = session.player.contextualChoices.packStyles[0];
  const second = { ...structuredClone(first), id: 'pack-second', releaseId: `0x${'66'.repeat(32)}`,
    semanticPackId: 'second-pack', label: 'Second Pack' };
  session.player.contextualChoices.packStyles.push(second);
  const storageMap = new Map();
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session, renderPlayerPreviewResult: canonicalPreview(), storageMap,
  });
  const entered = deferred();
  const releaseFirst = deferred();
  const update = harness.bridge.updatePlayerRecipe.bind(harness.bridge);
  let count = 0;
  harness.bridge.updatePlayerRecipe = async patch => {
    count += 1;
    if (count === 1) { entered.resolve(); await releaseFirst.promise; }
    if (count === 2) throw new TypeError('Second Pack lost access');
    return update(patch);
  };
  let app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const toggles = [first, second].map(choice => {
    const toggle = new FakeTarget(harness.doc, { dataset: { action: 'player-expansion-v8' } });
    toggle.parent = mount; toggle.value = choice.releaseId; toggle.checked = true; return toggle;
  });
  const a = mount.fire('change', { target: toggles[0] });
  await entered.promise;
  const b = mount.fire('change', { target: toggles[1] });
  releaseFirst.resolve();
  await Promise.all([waitForEvent(a), waitForEvent(b)]);
  const saved = [...storageMap.entries()].filter(([key]) => key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:'))
    .map(([, value]) => JSON.parse(value))[0].session;
  assert.deepEqual(saved.enabledPackReleaseIds, [first.releaseId]);
  assert.deepEqual(saved.loadout.usedPacks, []);
  assert.match(mount.innerHTML, /Second Pack lost access/);
  await app.destroy();
  app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  assert.match(mount.innerHTML, new RegExp(`data-choice-id="${first.id}"`));
  assert.doesNotMatch(mount.innerHTML, /data-choice-id="pack-second"/);
  await app.destroy();
});

test('confirmed Pack acquisition enables its catalog only after current inventory proof, without equipping Styles', async () => {
  for (const ownedAfterFinality of [false, true]) {
    const session = playerSessionWithPackChoice(ROOT_ONE);
    const choice = session.player.contextualChoices.packStyles[0];
    choice.access = { accessible: false, canEquip: false, availableForAcquire: true };
    choice.entry = { kind: 0, priceAtomic: '0', paymentCoinType: '0x2::token::TOKEN' };
    const storageMap = new Map();
    const harness = browserHarness({
      connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
      playerSessionResult: session, renderPlayerPreviewResult: canonicalPreview(), storageMap,
    });
    let finalized = false;
    const snapshot = harness.bridge.getPlayerSnapshot.bind(harness.bridge);
    harness.bridge.getPlayerSnapshot = async () => {
      const result = await snapshot();
      if (finalized && ownedAfterFinality) result.player.contextualChoices.packStyles[0].access = {
        accessible: true, canEquip: true, availableForAcquire: false,
      };
      return result;
    };
    const record = { action: 'acquirePackAccess', actionId: 'ab'.repeat(32), rootId: ROOT_ONE,
      status: 'PREPARED', packEntryQuote: { ...choice.entry, releaseId: choice.releaseId } };
    harness.bridge.preparePlayerAction = async () => structuredClone(record);
    harness.bridge.executePlayerAction = async () => { finalized = true; return { ...record, status: 'FINALIZED_SUCCESS' }; };
    harness.bridge.recoverPlayerAction = async () => { throw new Error('No recovery expected'); };
    const app = createOriginalProductApp(harness);
    await app.ready;
    await app.openPlayer(ROOT_ONE);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    for (const action of ['player-acquire-expansion-v8', 'player-confirm-pack-v8']) {
      const target = new FakeTarget(harness.doc, { dataset: { action,
        releaseId: choice.releaseId, actionId: record.actionId } });
      target.parent = mount;
      await waitForEvent(mount.fire('click', { target }));
    }
    assert.equal(mount.innerHTML.includes(`data-choice-id="${choice.id}"`), ownedAfterFinality);
    if (ownedAfterFinality) {
      const saved = [...storageMap.entries()].filter(([key]) => key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:'))
        .map(([, value]) => JSON.parse(value))[0].session;
      assert.deepEqual(saved.enabledPackReleaseIds, [choice.releaseId]);
      assert.deepEqual(saved.loadout.usedPacks, []);
      assert.equal(saved.recipe.selections[0].source, 'BASE');
    }
    assert.equal(harness.calls.updatePlayerRecipe.length, 0, 'catalog enablement is not an equip transaction');
    await app.destroy();
  }
});

test('saved Pack availability cannot authorize a Style after current access is lost', async () => {
  const session = playerSessionWithPackChoice(ROOT_ONE);
  const choice = session.player.contextualChoices.packStyles[0];
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session, renderPlayerPreviewResult: canonicalPreview(),
  });
  let lost = false;
  const snapshot = harness.bridge.getPlayerSnapshot.bind(harness.bridge);
  harness.bridge.getPlayerSnapshot = async () => {
    const result = await snapshot();
    if (lost) result.player.contextualChoices.packStyles[0].access = {
      accessible: false, canEquip: false, availableForAcquire: false, reason: 'Current Pack access has been revoked',
    };
    return result;
  };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const toggle = new FakeTarget(harness.doc, { dataset: { action: 'player-expansion-v8' } });
  toggle.parent = mount; toggle.value = choice.releaseId; toggle.checked = true;
  await waitForEvent(mount.fire('change', { target: toggle }));
  const updates = harness.calls.updatePlayerRecipe.length;
  lost = true;
  const item = new FakeTarget(harness.doc, { dataset: { action: 'player-item', choiceId: choice.id } });
  item.parent = mount;
  await waitForEvent(mount.fire('click', { target: item }));
  assert.equal(harness.calls.updatePlayerRecipe.length, updates);
  assert.deepEqual((await snapshot()).loadout.usedPacks, []);
  assert.match(mount.innerHTML, /Current Pack access has been revoked/);
  await app.destroy();
});

test('Pack entry shows exact transaction quote before signature and queries uncertain results without a replacement purchase', async () => {
  const session = playerSessionWithPackChoice(ROOT_ONE);
  const choice = session.player.contextualChoices.packStyles[0];
  choice.access = { accessible: false, canEquip: false, availableForAcquire: true };
  choice.entry = { kind: 1, priceAtomic: '9007199254740993', paymentCoinType: '0x2::coin::TOKEN' };
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session,
  });
  const calls = [];
  let wrongRecoveryIdentity = true;
  const record = { action: 'acquirePackAccess', actionId: 'ab'.repeat(32),
    rootId: ROOT_ONE, status: 'PREPARED', packEntryQuote: {
      ...choice.entry, releaseId: choice.releaseId, requiresMakerAccess: false,
    } };
  harness.bridge.preparePlayerAction = async input => {
    calls.push(['prepare', input]);
    return structuredClone(record);
  };
  harness.bridge.executePlayerAction = async actionId => {
    calls.push(['execute', actionId]);
    throw new Error('Broadcast response lost');
  };
  harness.bridge.recoverPlayerAction = async (actionId, options) => {
    calls.push(['recover', actionId, options]);
    return { ...structuredClone(record), status: 'OUTCOME_UNKNOWN',
      actionId: wrongRecoveryIdentity ? 'cd'.repeat(32) : record.actionId };
  };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  async function click(action) {
    const target = new FakeTarget(harness.doc, { dataset: {
      action, releaseId: choice.releaseId, actionId: record.actionId,
    } });
    target.parent = mount;
    mount.fire('click', { target });
    await settle();
    await settle();
  }
  await click('player-acquire-expansion-v8');
  assert.deepEqual(calls.map(call => call[0]), ['prepare']);
  assert.deepEqual(calls[0][1], { action: 'acquirePackAccess',
    input: { releaseId: choice.releaseId, semanticPackId: 'moon-pack' } });
  assert.match(mount.innerHTML, /9007199254740993/);
  assert.match(mount.innerHTML, /data-action="player-confirm-pack-v8"/);
  await click('player-confirm-pack-v8');
  assert.deepEqual(calls.map(call => call[0]), ['prepare', 'execute']);
  assert.match(mount.innerHTML, /Broadcast response lost/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-confirm-pack-v8"/);
  await click('player-recover-pack-v8');
  assert.deepEqual(calls.map(call => call[0]), ['prepare', 'execute', 'recover']);
  assert.deepEqual(calls[2], ['recover', record.actionId, { replayIfNotFound: false }]);
  assert.match(mount.innerHTML, /prepared Pack transaction does not match/);
  assert.doesNotMatch(mount.innerHTML, new RegExp('cd'.repeat(32)));
  wrongRecoveryIdentity = false;
  await click('player-recover-pack-v8');
  assert.deepEqual(calls[3], ['recover', record.actionId, { replayIfNotFound: false }]);
  assert.match(mount.innerHTML, /OUTCOME_UNKNOWN/);
  await click('player-cancel-pack-v8');
  assert.equal(calls.length, 4);
  app.destroy();
});

test('Pack acquisition refuses included entry without Maker access and discards a late quote after leaving its Player', async () => {
  for (const blocked of [true, false]) {
    const session = playerSessionWithPackChoice(ROOT_ONE);
    const choice = session.player.contextualChoices.packStyles[0];
    choice.access = { accessible: false, canEquip: false, availableForAcquire: !blocked,
      reason: blocked ? 'Maker access required for this included Pack' : '' };
    choice.entry = { kind: blocked ? 2 : 0, priceAtomic: '0', paymentCoinType: '0x2::token::TOKEN' };
    const harness = browserHarness({
      connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker(), certifiedMaker({ rootId: ROOT_TWO })], diagnostics: [] },
      playerSessionResult: rootId => rootId === ROOT_ONE ? structuredClone(session) : playerSession(rootId),
    });
    const gate = deferred();
    let preparations = 0;
    let executions = 0;
    harness.bridge.preparePlayerAction = async () => { preparations += 1; return gate.promise; };
    harness.bridge.executePlayerAction = async () => { executions += 1; };
    harness.bridge.recoverPlayerAction = async () => { throw new Error('No recovery expected'); };
    const app = createOriginalProductApp(harness);
    await app.ready;
    await app.openPlayer(ROOT_ONE);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    const target = new FakeTarget(harness.doc, { dataset: {
      action: 'player-acquire-expansion-v8', releaseId: choice.releaseId,
    } });
    target.parent = mount;
    mount.fire('click', { target });
    await settle();
    await settle();
    if (blocked) {
      assert.equal(preparations, 0);
      assert.match(mount.innerHTML, /Maker access required/);
    } else {
      assert.equal(preparations, 1);
      await app.openPlayer(ROOT_TWO);
      gate.resolve({ action: 'acquirePackAccess', actionId: 'ab'.repeat(32), rootId: ROOT_ONE,
        status: 'PREPARED', packEntryQuote: { ...choice.entry, releaseId: choice.releaseId } });
      await settle();
      await settle();
      assert.doesNotMatch(mount.innerHTML, /data-action="player-confirm-pack-v8"/);
    }
    assert.equal(executions, 0);
    app.destroy();
  }
});

test('Player restores pending Pack recovery even when its Release is absent from the current catalog', async () => {
  const session = playerSession(ROOT_ONE);
  session.player.contextualChoices.packStyles = [];
  const releaseId = `0x${'55'.repeat(32)}`;
  const record = { action: 'acquirePackAccess', actionId: 'ab'.repeat(32), rootId: ROOT_ONE,
    status: 'SIGNED', packEntryQuote: { releaseId, kind: 1, priceAtomic: '25',
      paymentCoinType: '0x2::token::TOKEN', requiresMakerAccess: false } };
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session,
  });
  const calls = [];
  harness.bridge.getPendingPlayerAction = async () => { calls.push('pending'); return structuredClone(record); };
  harness.bridge.preparePlayerAction = async () => { throw new Error('Must not prepare from catalog'); };
  harness.bridge.executePlayerAction = async () => { throw new Error('Must not sign'); };
  harness.bridge.recoverPlayerAction = async (actionId, options) => {
    calls.push('recover');
    assert.equal(actionId, record.actionId);
    assert.deepEqual(options, { replayIfNotFound: false });
    return { ...structuredClone(record), status: 'FINALIZED_SUCCESS' };
  };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  assert.match(mount.innerHTML, /data-action="player-recover-pack-v8"/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-acquire-expansion-v8"/);
  const target = new FakeTarget(harness.doc, { dataset: {
    action: 'player-recover-pack-v8', releaseId, actionId: record.actionId,
  } });
  target.parent = mount;
  mount.fire('click', { target });
  await settle();
  await settle();
  assert.deepEqual(calls, ['pending', 'recover']);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-recover-pack-v8"/);
  app.destroy();
});

test('Pack recovery remains queryable when exact inventory prevents the Player from opening', async () => {
  let queryGate = null;
  const record = { action: 'acquirePackAccess', actionId: 'ab'.repeat(32), rootId: ROOT_ONE,
    status: 'SIGNED', transactionDigest: 'durable-digest', packEntryQuote: {
      releaseId: `0x${'55'.repeat(32)}`, kind: 1, priceAtomic: '25',
      paymentCoinType: '0x2::token::TOKEN', requiresMakerAccess: false } };
  const harness = browserHarness({
    connection: { account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: new Error('MAKER_V8_PACK_RELEASE_INACTIVE: owned Pack inventory rejected'),
  });
  const calls = [];
  harness.bridge.getPendingPlayerAction = async input => {
    calls.push('pending'); assert.deepEqual(input, { rootId: ROOT_ONE }); return structuredClone(record);
  };
  harness.bridge.recoverPlayerAction = async (actionId, options) => {
    calls.push('query'); assert.equal(actionId, record.actionId);
    assert.deepEqual(options, { replayIfNotFound: false });
    if (queryGate) await queryGate.promise;
    return { ...structuredClone(record), status: 'FINALIZED_SUCCESS' };
  };
  harness.bridge.preparePlayerAction = async () => { throw new Error('No purchase'); };
  harness.bridge.executePlayerAction = async () => { throw new Error('No signature'); };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await assert.rejects(app.openPlayer(ROOT_ONE), /PACK_RELEASE_INACTIVE/);
  assert.equal(app.getState().route, 'make');
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  assert.match(mount.innerHTML, /owned Pack inventory rejected/);
  assert.match(mount.innerHTML, /durable-digest/);
  assert.match(mount.innerHTML, /data-action="player-recover-pack-v8"/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-confirm-pack-v8"|makerV4PlayerCanvas|data-action="player-item"/);
  const target = new FakeTarget(harness.doc, { dataset: {
    action: 'player-recover-pack-v8', actionId: record.actionId,
  } });
  target.parent = mount;
  mount.fire('click', { target });
  await settle();
  await settle();
  assert.deepEqual(calls, ['pending', 'query']);
  assert.match(mount.innerHTML, /FINALIZED_SUCCESS/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-recover-pack-v8"/);
  await assert.rejects(app.openPlayer(ROOT_ONE), /PACK_RELEASE_INACTIVE/);
  queryGate = deferred();
  mount.fire('click', { target });
  await settle();
  app.refreshConnection({ account: { address: `0x${'64'.repeat(32)}`, chains: ['sui:mainnet'] } });
  app.refreshConnection({ account: { address: `0x${'63'.repeat(32)}`, chains: ['sui:mainnet'] } });
  assert.equal(mount.innerHTML, '');
  queryGate.resolve();
  await settle();
  await settle();
  assert.equal(mount.innerHTML, '', 'a late query cannot resurrect the first wallet session');
  app.destroy();
});

test('snapshot merging preserves contextual choices only when the bridge omits that field', async () => {
  const address = `0x${'63'.repeat(32)}`;
  const maker = certifiedMaker();
  const session = playerSessionWithPackChoice(ROOT_ONE);
  const emptyContextualChoices = {
    ...structuredClone(session.player.contextualChoices),
    packStyles: [],
    externalStyles: [],
  };
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: session,
  });
  const getSnapshot = harness.bridge.getPlayerSnapshot.bind(harness.bridge);
  let explicitReplacement = false;
  harness.bridge.getPlayerSnapshot = async () => {
    const snapshot = await getSnapshot();
    const player = { ...snapshot.player };
    if (explicitReplacement) player.contextualChoices = emptyContextualChoices;
    else delete player.contextualChoices;
    return { ...snapshot, player };
  };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  assert.match(
    mount.innerHTML,
    /Moon Pack · Violet/,
    'eligible contextual choices remain in their active Part instead of a wardrobe route',
  );

  const alternate = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate:alternate' },
  });
  alternate.parent = mount;
  mount.fire('click', { target: alternate });
  await settle();
  await settle();
  assert.match(mount.innerHTML, /Moon Pack · Violet/, 'an omitted field preserves current context');

  explicitReplacement = true;
  const alternateStyle = new FakeTarget(harness.doc, {
    dataset: { action: 'player-style', choiceId: 'base:base:alternate:alternate-2' },
  });
  alternateStyle.parent = mount;
  mount.fire('click', { target: alternateStyle });
  await settle();
  await settle();
  assert.doesNotMatch(mount.innerHTML, /Moon Pack · Violet/, 'an explicit exact replacement wins');
  app.destroy();
});

test('pending Player requests are cancelled by catalog removal, detail exit, wallet change, and destroy', async (context) => {
  const address = `0x${'64'.repeat(32)}`;
  const nextAddress = `0x${'65'.repeat(32)}`;
  const maker = certifiedMaker();

  await context.test('catalog removal', async () => {
    const playerGate = deferred();
    let catalog = [maker];
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: () => ({ status: 'READY', makers: catalog, diagnostics: [] }),
      playerSessionResult: () => playerGate.promise,
    });
    const app = createOriginalProductApp(harness);
    await app.ready;
    const pending = app.openPlayer(ROOT_ONE);
    catalog = [];
    await app.refreshTemplates();
    playerGate.resolve(playerSession(ROOT_ONE));
    assert.equal(await pending, null);
    assert.equal(app.getState().playerStatus, 'idle');
    assert.equal(app.getState().playerRootId, null);
    app.destroy();
  });

  await context.test('detail exit', async () => {
    const playerGate = deferred();
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
      templateResult: maker,
      playerSessionResult: () => playerGate.promise,
    });
    const app = createOriginalProductApp(harness);
    await app.ready;
    await app.openTemplate(ROOT_ONE);
    const pending = app.openPlayer(ROOT_ONE);
    app.navigate('templates');
    playerGate.resolve(playerSession(ROOT_ONE));
    assert.equal(await pending, null);
    assert.equal(app.getState().route, 'templates');
    assert.equal(app.getState().playerStatus, 'idle');
    app.destroy();
  });

  await context.test('wallet change', async () => {
    const playerGate = deferred();
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
      playerSessionResult: () => playerGate.promise,
    });
    const app = createOriginalProductApp(harness);
    await app.ready;
    const pending = app.openPlayer(ROOT_ONE);
    app.refreshConnection({ account: { address: nextAddress, chains: ['sui:mainnet'] } });
    playerGate.resolve(playerSession(ROOT_ONE));
    assert.equal(await pending, null);
    assert.equal(app.getState().connection.address, nextAddress);
    assert.equal(app.getState().playerStatus, 'idle');
    app.destroy();
  });

  await context.test('destroy', async () => {
    const playerGate = deferred();
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
      playerSessionResult: () => playerGate.promise,
    });
    const app = createOriginalProductApp(harness);
    await app.ready;
    const pending = app.openPlayer(ROOT_ONE);
    app.destroy();
    playerGate.resolve(playerSession(ROOT_ONE));
    assert.equal(await pending, null);
    assert.equal(app.getState().playerStatus, 'idle');
    assert.equal(app.getState().playerRootId, null);
  });
});

test('Creator Import ZIP replaces only the current draft, retries failures and cancels stale file reads', async () => {
  for (const mode of ['valid', 'cancel', 'missing', 'read-failure', 'malformed', 'oversize', 'cas-failure', 'navigate', 'navigate-aba', 'wallet-aba', 'commit-navigate']) {
    const record = draftRecord();
    let saved = structuredClone(record);
    const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
    const editor = new FakeTarget(harness.doc, { dataset: { creatorView: 'edit' } });
    harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
    harness.doc.selectorLists.set('[data-creator-view]', [editor]);
    const gate = deferred();
    let imports = 0;
    let reads = 0;
    const bytes = encodeMakerV8ProjectZip({ draft: record });
    harness.bridge.getDraft = async () => {
      if (saved.revision !== record.revision) throw new Error('Second read unavailable after commit');
      return { draft: saved, assets: [] };
    };
    if (mode !== 'missing') harness.bridge.replaceDraftFromProjectZip = async (input) => {
      imports += 1;
      assert.deepEqual(input, { draftId: record.draftId, expectedRevision: record.revision, bytesBase64: Buffer.from(bytes).toString('base64') });
      if (mode === 'cas-failure') throw new Error('Draft changed in another tab');
      if (mode === 'commit-navigate') await gate.promise;
      saved = structuredClone(record); saved.revision += 1; saved.document.metadata.name = 'Imported artwork';
      return { draft: saved, assets: [] };
    };
    const app = createOriginalProductApp(harness);
    try {
      await app.ready; await app.openDraft(record.draftId); app.navigate('creator');
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      const markup = mount.innerHTML.match(/<input\b[^>]*data-action="import-project"[^>]*>/)[0];
      assert.equal(/\sdisabled(?:\s|=|>)/.test(markup), mode === 'missing');
      const input = new FakeTarget(harness.doc, { dataset: { action: 'import-project' } });
      input.parent = mount; input.disabled = mode === 'missing'; input.value = 'same.zip';
      input.files = mode === 'cancel' ? [] : [{ size: mode === 'oversize' ? 65 * 1024 * 1024 : bytes.length, async arrayBuffer() {
        reads += 1;
        if (mode === 'read-failure') throw new Error('File read failed');
        if (['navigate', 'navigate-aba', 'wallet-aba'].includes(mode)) await gate.promise;
        const result = new Uint8Array(bytes);
        if (mode === 'malformed') result[0] = 0;
        return result.buffer;
      } }];
      mount.fire('change', { target: input });
      await settle();
      if (['navigate', 'navigate-aba', 'wallet-aba'].includes(mode)) {
        assert.equal(reads, 1, `${mode}: context changes only after file reading starts`);
        assert.equal(imports, 0, `${mode}: commit has not started`);
      }
      if (mode === 'commit-navigate') assert.equal(imports, 1, 'navigate only after atomic commit starts');
      if (['navigate', 'commit-navigate'].includes(mode)) { app.navigate('docs'); gate.resolve(); }
      if (mode === 'navigate-aba') { app.navigate('docs'); app.navigate('creator'); gate.resolve(); }
      if (mode === 'wallet-aba') {
        app.refreshConnection({ account: { address: `0x${'42'.repeat(32)}`, chains: ['sui:mainnet'] } });
        app.refreshConnection({ account: { address: ROOT_ONE, chains: ['sui:mainnet'] } });
        gate.resolve();
      }
      await settle(); await settle();
      assert.equal(imports, ['valid', 'cas-failure', 'commit-navigate'].includes(mode) ? 1 : 0);
      const committed = ['valid', 'commit-navigate'].includes(mode);
      assert.equal(saved.document.metadata.name, committed ? 'Imported artwork' : record.document.metadata.name);
      if (committed) {
        assert.equal(app.getState().revision, record.revision + 1);
        if (mode === 'commit-navigate') { assert.equal(app.getState().route, 'docs'); app.navigate('creator'); }
        assert.match(mount.innerHTML, /Imported artwork/);
      }
      if (mode === 'read-failure') assert.match(mount.innerHTML, /File read failed/);
      if (mode === 'cas-failure') assert.match(mount.innerHTML, /Draft changed in another tab/);
      if (mode !== 'missing') assert.equal(input.value, '', 'same archive can be selected again');
      assert.equal(harness.calls.openPlayer.length, 0);
    } finally { app.destroy(); }
  }
});

test('Creator Project ZIP never downloads an old snapshot while a newer edit is pending', async () => {
  const record = draftRecord();
  const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
  const exporting = deferred(); const saving = deferred();
  harness.bridge.exportProjectZip = async () => {
    await exporting.promise;
    const bytes = encodeMakerV8ProjectZip({ draft: record });
    return { mediaType: 'application/zip', byteLength: bytes.length, bytesBase64: Buffer.from(bytes).toString('base64') };
  };
  harness.bridge.dispatchDraftCommand = async () => {
    await saving.promise;
    const next = structuredClone(record); next.revision += 1; next.document.metadata.name = 'New edit'; return next;
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openDraft(record.draftId); app.navigate('creator');
    const mount = harness.doc.getElementById('makerV4CreatorMount');
    const button = new FakeTarget(harness.doc, { dataset: { action: 'export-project' } }); button.parent = mount;
    mount.fire('click', { target: button }); await settle();
    const input = new FakeTarget(harness.doc, { dataset: { action: 'maker-name' } }); input.parent = mount; input.value = 'New edit';
    mount.fire('change', { target: input }); await settle();
    exporting.resolve(); await settle(); await settle();
    assert.equal(harness.doc.downloads.length, 0);
    assert.match(mount.innerHTML, /Creator changed during Project ZIP export/);
    saving.resolve(); await settle();
  } finally { exporting.resolve(); saving.resolve(); app.destroy(); }
});

test('Creator Project ZIP downloads the saved draft and rejects wrong-draft or malformed exports', async () => {
  for (const mode of ['valid', 'wrong-draft', 'malformed', 'missing']) {
    const record = draftRecord();
    const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
    let exports = 0;
    const releaseTimers = [];
    harness.win.setTimeout = (callback, delay) => { releaseTimers.push({ callback, delay }); return 1; };
    if (mode !== 'missing') harness.bridge.exportProjectZip = async ({ makerId }) => {
      exports += 1;
      assert.equal(makerId, record.draftId);
      const draft = structuredClone(record);
      if (mode === 'wrong-draft') draft.draftId = 'other-draft';
      const bytes = mode === 'malformed' ? new Uint8Array([1, 2, 3]) : encodeMakerV8ProjectZip({ draft });
      return { mediaType: 'application/zip', byteLength: bytes.length, bytesBase64: Buffer.from(bytes).toString('base64') };
    };
    const app = createOriginalProductApp(harness);
    try {
      await app.ready; await app.openDraft(record.draftId); app.navigate('creator');
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      const markup = mount.innerHTML.match(/<button\b[^>]*data-action="export-project"[^>]*>/)[0];
      assert.equal(/\sdisabled(?:\s|=|>)/.test(markup), mode === 'missing');
      const button = new FakeTarget(harness.doc, { dataset: { action: 'export-project' } });
      button.parent = mount; button.disabled = mode === 'missing';
      mount.fire('click', { target: button });
      await settle(); await settle();
      assert.equal(exports, mode === 'missing' ? 0 : 1);
      assert.equal(harness.doc.downloads.length, mode === 'valid' ? 1 : 0);
      if (mode === 'valid') {
        const download = harness.doc.downloads[0];
        assert.equal(download.download, `${record.draftId}.animacraft.zip`);
        assert.equal(harness.win.objectUrls.created.find(row => row.url === download.href).blob.type, 'application/zip');
        assert.equal(harness.win.objectUrls.revoked.includes(download.href), false);
        assert.equal(releaseTimers.length, 1);
        assert.equal(releaseTimers[0].delay, 60_000);
        releaseTimers[0].callback();
        assert.equal(harness.win.objectUrls.revoked.filter(url => url === download.href).length, 1);
      }
      if (mode === 'wrong-draft') assert.match(mount.innerHTML, /does not match the current saved draft/);
      if (mode === 'malformed') assert.match(mount.innerHTML, /Project ZIP is truncated/);
      assert.equal(harness.calls.openPlayer.length, 0);
    } finally { app.destroy(); }
  }
});

test('Creator Player test stays disabled without its adapter and exposes opening failures in Creator', async () => {
  for (const available of [false, true]) {
    const record = draftRecord();
    const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
    let opens = 0;
    if (available) harness.bridge.openLocalPlayer = async () => { opens += 1; throw new Error('Exact local assets unavailable'); };
    const app = createOriginalProductApp(harness);
    try {
      await app.ready;
      await app.openDraft(record.draftId);
      app.navigate('creator');
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      const markup = mount.innerHTML.match(/<button\b[^>]*data-action="open-player"[^>]*>/)[0];
      assert.equal(/\sdisabled(?:\s|=|>)/.test(markup), !available);
      const button = new FakeTarget(harness.doc, { dataset: { action: 'open-player' } });
      button.parent = mount;
      button.disabled = !available;
      mount.fire('click', { target: button });
      await settle();
      await settle();
      assert.equal(opens, Number(available));
      assert.equal(app.getState().route, 'creator');
      if (available) assert.match(mount.innerHTML, /Exact local assets unavailable/);
      assert.equal(harness.calls.openPlayer.length, 0);
    } finally { app.destroy(); }
  }
});

test('local Player uses the approved mount, local actions and Creator return without authenticated writes', async () => {
  const record = structuredClone(draftRecord());
  const part = structuredClone(record.document.parts[0]);
  Object.assign(part, { key: 'hat', kind: 'STANDARD', required: false, menuOrder: 1, renderOrder: 1 });
  record.document.parts.push(part);
  record.document.colors = [{ key: 'primary', label: 'Primary', defaultSwatchKey: 'red', swatches: [
    { key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] },
    { key: 'blue', label: 'Blue', rgba: '#0000ffff', stops: [] },
  ] }];
  const storageMap = new Map();
  const harness = browserHarness({
    connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record, storageMap,
  });
  let model;
  let renders = 0;
  harness.bridge.openLocalPlayer = async (input) => {
    assert.deepEqual(input, { draftId: record.draftId, expectedRevision: record.revision });
    model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
    return { ...model, getAssets: async () => [], renderPreview: async () => { renders += 1; return canonicalPreview(); } };
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready;
    await app.openDraft(record.draftId);
    app.navigate('creator');
    const creatorMount = harness.doc.getElementById('makerV4CreatorMount');
    const playerButtonMarkup = creatorMount.innerHTML.match(/<button\b[^>]*data-action="open-player"[^>]*>/)?.[0];
    assert.ok(playerButtonMarkup, 'Player test must be present in the real toolbar');
    assert.doesNotMatch(playerButtonMarkup, /\sdisabled(?:\s|=|>)/, 'Player test must be reachable, not only callable through the app API');
    const playerButton = new FakeTarget(harness.doc, { dataset: { action: 'open-player' } });
    playerButton.parent = creatorMount;
    creatorMount.fire('click', { target: playerButton });
    await settle();
    await settle();
    assert.equal(app.getState().route, 'make');
    assert.equal(renders, 1);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    assert.match(mount.innerHTML, /makerPlayerInfoDialog/);
    const close = new FakeTarget(harness.doc, { dataset: { action: 'close-player-info' } });
    close.parent = mount;
    await waitForEvent(mount.fire('click', { target: close }));
    assert.doesNotMatch(mount.innerHTML, /id="makerPlayerInfoDialog"/);
    const select = new FakeTarget(harness.doc, { dataset: { action: 'player-item', choiceId: 'base:hat:default:default' } });
    select.parent = mount;
    await waitForEvent(mount.fire('click', { target: select }));
    assert.equal(model.getSnapshot().recipe.selections.length, 2);
    assert.equal(renders, 2);
    const undo = new FakeTarget(harness.doc, { dataset: { action: 'player-undo' } });
    undo.parent = mount;
    await waitForEvent(mount.fire('click', { target: undo }));
    assert.equal(model.getSnapshot().recipe.selections.length, 1);
    assert.equal(renders, 3);
    const color = new FakeTarget(harness.doc, { dataset: { action: 'player-color', channelId: 'primary', swatchId: 'blue' } });
    color.parent = mount;
    await waitForEvent(mount.fire('click', { target: color }));
    assert.deepEqual(model.getSnapshot().recipe.colors, [{ channelKey: 'primary', swatchKey: 'blue' }]);
    for (const [key, value] of Object.entries({ name: 'Local Moon', world: 'Test World', description: '<script>text</script>', tags: 'local,test' })) {
      const input = new FakeTarget(harness.doc, { dataset: { action: `player-profile-${key}` } });
      input.parent = mount;
      input.value = value;
      const beforeClick = model.getSnapshot();
      await waitForEvent(mount.fire('click', { target: input }));
      assert.deepEqual(model.getSnapshot(), beforeClick, 'Focusing profile inputs is not an undefined-value edit.');
      assert.doesNotMatch(mount.innerHTML, /Local profile .* exceeds its text limit/);
      await waitForEvent(mount.fire('change', { target: input }));
      assert.equal(model.getSnapshot().profile[key], value);
    }
    assert.match(mount.innerHTML, /&lt;script&gt;text&lt;\/script&gt;/);
    for (const soulKey of ['soulMd', 'memoryMd', 'skillMd']) {
      const input = new FakeTarget(harness.doc, { dataset: { action: 'player-soul-document', soulKey } });
      input.parent = mount;
      input.value = `# Local ${soulKey}`;
      const beforeClick = model.getSnapshot();
      await waitForEvent(mount.fire('click', { target: input }));
      assert.deepEqual(model.getSnapshot(), beforeClick, 'Focusing Soul textareas does not dispatch an empty edit.');
      await waitForEvent(mount.fire('input', { target: input }));
      assert.equal(model.getSnapshot().soulDocuments[soulKey], input.value, 'Local Soul autosaves without blur.');
      const inputRevision = model.getSnapshot().revision;
      await waitForEvent(mount.fire('change', { target: input }));
      assert.equal(model.getSnapshot().soulDocuments[soulKey], input.value);
      assert.equal(model.getSnapshot().revision, inputRevision, 'Blur does not duplicate the input edit.');
    }
    const ime = new FakeTarget(harness.doc, { dataset: { action: 'player-soul-document', soulKey: 'soulMd' } });
    ime.parent = mount; ime.value = '# a';
    mount.fire('input', { target: ime });
    ime.focus(); mount.fire('compositionstart', { target: ime });
    ime.value = '# a中'; mount.fire('input', { target: ime, isComposing: true });
    const imeMarkup = mount.innerHTML;
    await settle(); await settle();
    assert.equal(mount.innerHTML, imeMarkup, 'Pending Player render/save cannot replace IME-owned text.');
    assert.equal(model.getSnapshot().soulDocuments.soulMd, '# a');
    ime.value = '# a中文'; await waitForEvent(mount.fire('compositionend', { target: ime }));
    assert.equal(model.getSnapshot().soulDocuments.soulMd, '# a中文');
    const preview = new FakeTarget(harness.doc, { dataset: { action: 'player-preview-export' } });
    preview.parent = mount;
    await waitForEvent(mount.fire('click', { target: preview }));
    assert.match(mount.innerHTML, /id="makerPlayerExportDialog"/);
    const publicLinks = [];
    harness.win.navigator.share = async value => publicLinks.push(value);
    harness.win.navigator.clipboard = { writeText: async value => publicLinks.push(value) };
    for (const action of ['player-copy-maker-link', 'player-share-maker']) {
      const control = new FakeTarget(harness.doc, { dataset: { action } }); control.parent = mount;
      await waitForEvent(mount.fire('click', { target: control }));
    }
    assert.deepEqual(publicLinks, [], 'local author preview never shares a public Maker link');
    const downloadTag = mount.innerHTML.match(/<button[^>]+data-action="player-download-png"[^>]*>/)[0];
    assert.doesNotMatch(downloadTag, /disabled/);
    const png = new FakeTarget(harness.doc, { dataset: { action: 'player-download-png' } });
    png.parent = mount;
    await waitForEvent(mount.fire('click', { target: png }));
    const download = harness.doc.downloads.at(-1);
    assert.equal(download.download, 'local-moon.png');
    const exported = harness.win.objectUrls.created.find((entry) => entry.url === download.href);
    assert.equal(exported.blob.type, 'image/png');
    assert.deepEqual(new Uint8Array(await exported.blob.arrayBuffer()), new Uint8Array(Buffer.from(PNG_SIGNATURE_BASE64, 'base64')));
    const recipeExport = new FakeTarget(harness.doc, { dataset: { action: 'player-export' } });
    recipeExport.parent = mount;
    await waitForEvent(mount.fire('click', { target: recipeExport }));
    const recipeDownload = harness.doc.downloads.at(-1);
    assert.equal(recipeDownload.download, 'local-moon-local-recipe.json');
    const recipeBlob = harness.win.objectUrls.created.find((entry) => entry.url === recipeDownload.href).blob;
    const serialized = await recipeBlob.text();
    assert.equal(serialized, model.exportCheckpoint(), 'Download retains exact canonical checkpoint bytes.');
    const recovered = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
    recovered.restoreCheckpoint(serialized, 0);
    assert.deepEqual(recovered.getSnapshot().profile, model.getSnapshot().profile);
    assert.deepEqual(recovered.getSnapshot().soulDocuments, model.getSnapshot().soulDocuments);
    recovered.dispose();
    let previousMarkup = mount.innerHTML;
    for (const locale of ['zh', 'ja', 'ko', 'vi', 'en']) {
      app.setLocale(locale, { persist: false });
      assert.equal(app.getState().locale, locale);
      assert.notEqual(mount.innerHTML, previousMarkup);
      previousMarkup = mount.innerHTML;
    }
    const snapshot = model.getSnapshot();
    const complete = new FakeTarget(harness.doc, { dataset: { action: 'player-complete' } });
    complete.parent = mount;
    await waitForEvent(mount.fire('click', { target: complete }));
    assert.deepEqual(model.getSnapshot(), snapshot);
    assert.equal(harness.calls.openPlayer.length, 0);
    assert.equal(harness.calls.completePlayerJourney.length, 0);
    assert.equal(harness.calls.dispatch.length, 0);
    assert.equal([...storageMap.keys()].some((key) => key.startsWith('animacraft:maker-v8-player-project:')), false);
    const back = harness.doc.getElementById('backToCreatorPreview');
    assert.equal(back.hidden, false);
    await waitForEvent(back.fire('click'));
    assert.equal(app.getState().route, 'creator');
    assert.equal(app.getState().revision, record.revision);
    assert.equal(back.hidden, true);
    assert.ok(harness.win.objectUrls.revoked.includes(download.href));
    assert.throws(() => model.getSnapshot(), /closed/);
  } finally { app.destroy(); }
});

test('late local Player opens cannot undo navigation, wallet changes or destruction', async (t) => {
  for (const boundary of ['navigate', 'wallet', 'disconnect', 'destroy']) {
    await t.test(boundary, async () => {
      const record = draftRecord();
      const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
      const gate = deferred();
      const model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
      let assetReads = 0;
      harness.bridge.openLocalPlayer = () => gate.promise;
      const app = createOriginalProductApp(harness);
      try {
        await app.ready;
        await app.openDraft(record.draftId);
        app.navigate('creator');
        const opening = app.openLocalPlayer();
        await settle();
        if (boundary === 'navigate') app.navigate('docs');
        if (boundary === 'wallet') app.refreshConnection({ account: { address: ROOT_TWO, chains: ['sui:mainnet'] } });
        if (boundary === 'disconnect') app.refreshConnection(null);
        if (boundary === 'destroy') app.destroy();
        gate.resolve({ ...model, getAssets: async () => { assetReads += 1; return []; }, renderPreview: async () => canonicalPreview() });
        assert.equal(await opening, null);
        assert.equal(assetReads, 0);
        assert.notEqual(app.getState().route, 'make');
        assert.throws(() => model.getSnapshot(), /closed/);
      } finally { app.destroy(); }
    });
  }
});

test('local Player autosaves, restores before display and keeps failed saves open for retry', async () => {
  const record = structuredClone(draftRecord());
  record.document.outputs.push({ ...structuredClone(record.document.outputs[0]), key: 'alternate', label: 'Alternate output' });
  const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
  let stored = null;
  let unavailable = false;
  const models = [];
  harness.bridge.openLocalPlayer = async () => {
    const model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
    models.push(model);
    return { ...model, getAssets: async () => [], renderPreview: async () => canonicalPreview(),
      loadCheckpoint: async () => stored,
      captureCheckpointSave: () => {
        const checkpoint = model.exportCheckpoint();
        return { revision: model.getSnapshot().revision, commit: async (expected) => {
        if (unavailable) throw new Error('Local storage is full');
        assert.deepEqual(expected, stored ? { revision: stored.revision, contentHash: stored.contentHash } : null);
        stored = { revision: (stored?.revision || 0) + 1, contentHash: 'aa'.repeat(32), checkpoint };
        return stored;
        } };
      },
    };
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready; await app.openDraft(record.draftId); await app.openLocalPlayer();
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    assert.match(mount.innerHTML, /data-action="player-output"[^>]*data-output-key="alternate"/);
    const output = new FakeTarget(harness.doc, { dataset: { action: 'player-output', outputKey: 'alternate' } });
    output.parent = mount;
    await waitForEvent(mount.fire('click', { target: output }));
    assert.equal(models[0].getSnapshot().recipe.outputKey, 'alternate');
    assert.equal(JSON.parse(stored.checkpoint).recipe.outputKey, 'alternate');
    const savedOutput = stored;
    const beforeInvalidOutput = models[0].getSnapshot();
    output.dataset.outputKey = 'missing-output';
    await waitForEvent(mount.fire('click', { target: output }));
    assert.deepEqual(models[0].getSnapshot(), beforeInvalidOutput);
    assert.equal(stored, savedOutput, 'an invalid Output must not overwrite the saved recipe');
    const input = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
    input.parent = mount; input.value = 'Durable Moon';
    await waitForEvent(mount.fire('change', { target: input }));
    assert.equal(JSON.parse(stored.checkpoint).profile.name, 'Durable Moon');
    assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
    await waitForEvent(harness.doc.getElementById('backToCreatorPreview').fire('click'));
    assert.equal(app.getState().route, 'creator');
    await app.openLocalPlayer();
    assert.equal(models[1].getSnapshot().profile.name, 'Durable Moon');
    assert.equal(models[1].getSnapshot().recipe.outputKey, 'alternate');
    assert.match(mount.innerHTML, /value="Durable Moon"/);
    unavailable = true; input.value = 'Keep unsaved';
    await waitForEvent(mount.fire('change', { target: input }));
    assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="error"/);
    await waitForEvent(harness.doc.getElementById('backToCreatorPreview').fire('click'));
    assert.equal(app.getState().route, 'make');
    assert.equal(models[1].getSnapshot().profile.name, 'Keep unsaved');
    assert.equal(JSON.parse(stored.checkpoint).profile.name, 'Durable Moon');
    assert.equal(app.navigate('docs'), 'make');
    await settle();
    assert.equal(app.getState().route, 'make');
    unavailable = false;
    const retry = new FakeTarget(harness.doc, { dataset: { action: 'player-retry-save' } });
    retry.parent = mount;
    await waitForEvent(mount.fire('click', { target: retry }));
    assert.equal(JSON.parse(stored.checkpoint).profile.name, 'Keep unsaved');
    assert.equal(harness.calls.openPlayer.length, 0);
    assert.equal(harness.calls.dispatch.length, 0);
    await waitForEvent(harness.doc.getElementById('backToCreatorPreview').fire('click'));
    assert.equal(app.getState().route, 'creator');
  } finally { app.destroy(); }
});

test('forced local closure drains latest edits before reopen and respects pending-open cancellation', async (t) => {
  for (const boundary of ['reopen', 'wallet', 'destroy', 'navigate']) {
    await t.test(boundary, async () => {
      const record = draftRecord();
      const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
      const gate = deferred();
      const started = deferred();
      const models = [];
      let stored = null;
      let commits = 0;
      harness.bridge.openLocalPlayer = async () => {
        const model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
        models.push(model);
        return { ...model, getAssets: async () => [], renderPreview: async () => canonicalPreview(),
          loadCheckpoint: async () => stored,
          captureCheckpointSave() {
            const checkpoint = model.exportCheckpoint();
            return { revision: model.getSnapshot().revision, async commit(expected) {
              if (++commits === 1) { started.resolve(); await gate.promise; }
              assert.deepEqual(expected, stored ? { revision: stored.revision, contentHash: stored.contentHash } : null);
              stored = { revision: (stored?.revision || 0) + 1, contentHash: 'aa'.repeat(32), checkpoint };
              return stored;
            } };
          },
        };
      };
      const app = createOriginalProductApp(harness);
      try {
        await app.ready; await app.openDraft(record.draftId); await app.openLocalPlayer();
        const mount = harness.doc.getElementById('makerV4PlayerMount');
        const input = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
        input.parent = mount; input.value = 'First';
        const first = waitForEvent(mount.fire('change', { target: input }));
        await started.promise;
        input.value = 'Latest';
        const latest = waitForEvent(mount.fire('change', { target: input }));
        if (boundary === 'wallet') app.refreshConnection({ account: { address: ROOT_TWO, chains: ['sui:mainnet'] } });
        const closing = boundary === 'destroy' ? app.destroy() : app.openLocalPlayer();
        if (boundary === 'navigate') app.navigate('docs');
        await settle();
        assert.throws(() => models[0].getSnapshot(), /closed/);
        assert.equal(models.length, 1, 'a replacement must not hydrate while old saves are pending');
        gate.resolve();
        await Promise.all([first, latest, closing]);
        assert.equal(commits, 2);
        assert.equal(JSON.parse(stored.checkpoint).profile.name, 'Latest');
        if (boundary === 'reopen' || boundary === 'wallet') {
          assert.equal(models.length, 2);
          assert.equal(models[1].getSnapshot().profile.name, 'Latest');
          assert.equal(app.getState().route, 'make');
          assert.match(mount.innerHTML, /value="Latest"/);
        } else {
          assert.equal(models.length, 1);
          if (boundary === 'navigate') assert.equal(app.getState().route, 'docs');
        }
        assert.equal(harness.calls.openPlayer.length, 0);
        assert.equal(harness.calls.dispatch.length, 0);
      } finally { gate.resolve(); await app.destroy(); }
    });
  }
});

test('invalidated local Player fails back to Creator through the existing error region', async () => {
  const record = draftRecord();
  const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
  const model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
  harness.bridge.openLocalPlayer = async () => ({ ...model, getAssets: async () => [], renderPreview: async () => canonicalPreview() });
  const app = createOriginalProductApp(harness);
  try {
    await app.ready;
    await app.openDraft(record.draftId);
    await app.openLocalPlayer();
    model.dispose();
    assert.doesNotThrow(() => app.setLocale('ja', { persist: false }));
    assert.equal(app.getState().route, 'creator');
    assert.equal(harness.doc.getElementById('makerV4PlayerMount').innerHTML, '');
    assert.equal(harness.doc.getElementById('backToCreatorPreview').hidden, true);
  } finally { app.destroy(); }
});

test('local asset hydration is fenced and a wallet change closes an already mounted local Player', async () => {
  const record = draftRecord();
  const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } }, record });
  const assets = deferred();
  const models = [];
  let renders = 0;
  harness.bridge.openLocalPlayer = async () => {
    const model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
    models.push(model);
    const first = models.length === 1;
    return { ...model, getAssets: () => first ? assets.promise : Promise.resolve([]), renderPreview: async () => { renders += 1; return canonicalPreview(); } };
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready;
    await app.openDraft(record.draftId);
    app.navigate('creator');
    const first = app.openLocalPlayer();
    await settle();
    await app.openLocalPlayer();
    assets.resolve([]);
    assert.equal(await first, null);
    assert.throws(() => models[0].getSnapshot(), /closed/);
    assert.equal(models[1].getSnapshot().mode, 'LOCAL_DRAFT');
    assert.equal(renders, 1);
    assert.equal(app.getState().route, 'make');
    app.refreshConnection({ account: { address: ROOT_TWO, chains: ['sui:mainnet'] } });
    assert.equal(app.getState().route, 'creator');
    assert.throws(() => models[1].getSnapshot(), /closed/);
    assert.equal(harness.doc.getElementById('makerV4PlayerMount').innerHTML, '');
    assert.equal(harness.doc.getElementById('backToCreatorPreview').hidden, true);
  } finally { app.destroy(); }
});

test('Creator background checkbox saves only its exact active draft and Part, with undo and reopen', async () => {
  const h = pngEditorHarness();
  const editor = new FakeTarget(h.harness.doc, { dataset: { creatorView: 'edit' } });
  h.harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  const app = createOriginalProductApp(h.harness);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
    const mount = h.harness.doc.getElementById('makerV4CreatorMount');
    const tag = mount.innerHTML.match(/<input[^>]*data-action="part-export-background"[^>]*>/)[0];
    const identity = { partId: 'base', reviewDraft: 'approved-maker', creatorGeneration: tag.match(/data-creator-generation="(\d+)"/)[1] };
    const before = h.saved();
    for (const wrong of [{ ...identity, partId: 'other' }, { ...identity, reviewDraft: 'other' }, { ...identity, creatorGeneration: '-1' }]) {
      h.change('part-export-background', true, wrong); await settle();
      assert.deepEqual(h.saved(), before);
    }
    h.change('part-export-background', true, identity); await settle();
    assert.equal(h.saved().draft.document.parts[0].exportBackground, true);
    assert.deepEqual(h.saved().assets, before.assets);
    h.fire('undo'); await settle();
    assert.deepEqual(h.saved().draft.document, before.draft.document);
    h.fire('redo'); await settle();
    await app.openDraft('approved-maker');
    assert.match(mount.innerHTML, /<input[^>]*checked[^>]*data-action="part-export-background"/);
    const saved = h.saved();
    h.change('part-export-background', false, identity); await settle();
    assert.deepEqual(h.saved(), saved, 'Pre-reopen checkbox cannot mutate the reopened draft.');
  } finally { app.destroy(); }
});

test('Creator Review and Run again inspect current text without publication, persistence or stale-draft actions', async () => {
  const h = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } } });
  let draftGate = null;
  const getDraft = h.bridge.getDraft;
  h.bridge.getDraft = input => draftGate ? draftGate.promise : getDraft(input);
  const editor = new FakeTarget(h.doc, { dataset: { creatorView: 'edit' } });
  h.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  h.doc.selectorLists.set('[data-creator-view]', [editor]);
  const app = createOriginalProductApp(h);
  try {
    await app.ready; app.navigate('creator'); await app.openDraft('approved-maker');
    const mount = h.doc.getElementById('makerV4CreatorMount');
    const fire = async (action, extra = {}, value, event = 'click') => {
      const control = new FakeTarget(h.doc, { dataset: { action, ...extra } });
      control.parent = mount; control.value = value;
      mount.fire(event, { target: control }); await settle(); await settle();
    };
    await fire('soul-document-content', { soulKey: 'memoryMd' }, '', 'input');
    const tag = mount.innerHTML.match(/<button[^>]*data-action="review-preflight"[^>]*>/)?.[0];
    assert.ok(tag); assert.doesNotMatch(tag, /disabled/);
    const identity = { reviewDraft: 'approved-maker', creatorGeneration: tag.match(/data-creator-generation="(\d+)"/)[1] };
    const callsBefore = structuredClone(h.calls);
    await fire('review-preflight', identity);
    assert.equal(app.getState().creatorTab, 'validate');
    assert.match(mount.innerHTML, /1 issue blocks publication/);
    assert.match(mount.innerHTML, /livingContent.memoryMd/);
    await fire('run-preflight', identity);
    assert.deepEqual(h.calls, callsBefore, 'read-only checks must not call any bridge mutation or publication');
    await fire('soul-document-content', { soulKey: 'memoryMd' }, '# Repaired', 'input');
    await fire('run-preflight', identity);
    assert.match(mount.innerHTML, /Ready to publish/);
    assert.match(mount.innerHTML, /data-action="publish"[^>]*disabled/);
    await fire('close-tool');
    await fire('review-preflight', { ...identity, creatorGeneration: '-1' });
    assert.equal(app.getState().creatorTab, 'structure');
    await fire('run-preflight', { ...identity, reviewDraft: 'wrong-draft' });
    assert.equal(app.getState().creatorTab, 'structure');
    draftGate = deferred();
    const opening = app.openDraft('approved-maker'); await settle();
    await fire('review-preflight', identity);
    assert.equal(app.getState().creatorTab, 'structure');
    draftGate.resolve(draftRecord()); await opening;
  } finally { app.destroy(); }
});

test('Creator Soul input saves without blur, deduplicates change and supports undo, redo and scoped resets', async () => {
  const harness = browserHarness({ connection: { account: { address: `0x${'56'.repeat(32)}`, chains: ['sui:mainnet'] } } });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const fire = async (action, { soulKey, value, event = 'click' } = {}) => {
    const control = new FakeTarget(harness.doc, { dataset: { action, soulKey } });
    control.parent = mount; control.value = value;
    mount.fire(event, { target: control });
    await settle(); await settle();
  };
  const original = structuredClone(draftRecord().document.livingContent);
  const text = '  # Literal author text\r\n{{OC_NAME}}\n';
  await fire('soul-document-content', { soulKey: 'soulMd', value: text, event: 'input' });
  assert.equal(harness.calls.dispatch.at(-1).command.livingContent.soulMd, text);
  const writes = harness.calls.dispatch.length;
  await fire('soul-document-content', { soulKey: 'soulMd', value: text, event: 'change' });
  assert.equal(harness.calls.dispatch.length, writes);
  await fire('undo');
  assert.deepEqual(harness.calls.replace.at(-1).document.livingContent, original);
  await fire('redo');
  assert.equal(harness.calls.replace.at(-1).document.livingContent.soulMd, text);
  await fire('soul-document-content', { soulKey: 'memoryMd', value: '', event: 'input' });
  assert.equal(harness.calls.dispatch.at(-1).command.livingContent.memoryMd, '');
  await fire('reset-soul-document', { soulKey: 'soulMd' });
  assert.equal(harness.calls.dispatch.at(-1).command.livingContent.soulMd, original.soulMd);
  assert.equal(harness.calls.dispatch.at(-1).command.livingContent.memoryMd, '');
  assert.equal(harness.calls.dispatch.at(-1).command.livingContent.customized.memoryMd, true);
  await fire('reset-all-soul');
  assert.deepEqual(harness.calls.dispatch.at(-1).command.livingContent, original);
  app.destroy();
});

test('Soul input after a failed save stays visible and retries the latest exact text with Save', async () => {
  const harness = browserHarness({ connection: { account: { address: `0x${'56'.repeat(32)}`, chains: ['sui:mainnet'] } } });
  harness.bridge.dispatchDraftCommand = async input => { harness.calls.dispatch.push(input); throw new Error('storage unavailable'); };
  const app = createOriginalProductApp(harness); await app.ready; await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  for (const text of ['# first text', '# latest exact text']) {
    const input = new FakeTarget(harness.doc, { dataset: { action: 'soul-document-content', soulKey: 'soulMd' } });
    input.parent = mount; input.value = text;
    mount.fire('input', { target: input }); await settle(); await settle();
    assert.match(mount.innerHTML, /data-save-phase="error"/);
    assert.match(mount.innerHTML, /storage unavailable/);
  }
  assert.equal(harness.calls.dispatch.length, 1, 'Further typing does not silently retry a failed CAS.');
  const save = new FakeTarget(harness.doc, { dataset: { action: 'save' } }); save.parent = mount;
  mount.fire('click', { target: save }); await settle(); await settle();
  assert.equal(harness.calls.replace.at(-1).expectedRevision, 1);
  assert.equal(harness.calls.replace.at(-1).document.livingContent.soulMd, '# latest exact text');
  assert.match(mount.innerHTML, /data-save-phase="saved"/);
  app.destroy();
});

test('slow Soul Save retry advances the CAS before saving newer input and stays single flight', async () => {
  const harness = browserHarness({ connection: { account: { address: `0x${'56'.repeat(32)}`, chains: ['sui:mainnet'] } } });
  harness.bridge.dispatchDraftCommand = async () => { throw new Error('storage unavailable'); };
  const slow = deferred();
  const replace = harness.bridge.replaceDraftDocument;
  let attempts = 0;
  harness.bridge.replaceDraftDocument = async input => {
    attempts += 1; if (attempts === 1) await slow.promise;
    return replace(input);
  };
  const app = createOriginalProductApp(harness); await app.ready; await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const input = new FakeTarget(harness.doc, { dataset: { action: 'soul-document-content', soulKey: 'soulMd' } }); input.parent = mount;
  input.value = '# A'; mount.fire('input', { target: input }); await settle(); await settle();
  const save = new FakeTarget(harness.doc, { dataset: { action: 'save' } }); save.parent = mount;
  mount.fire('click', { target: save }); await settle();
  input.value = '# B while retry pending'; mount.fire('input', { target: input }); await settle();
  mount.fire('click', { target: save }); await settle();
  assert.equal(attempts, 1);
  slow.resolve(); await settle(); await settle(); await settle();
  assert.equal(harness.calls.replace.length, 2);
  assert.equal(harness.calls.replace[0].document.livingContent.soulMd, '# A');
  assert.equal(harness.calls.replace[1].document.livingContent.soulMd, '# B while retry pending');
  assert.equal(harness.calls.replace[1].expectedRevision, 2);
  assert.match(mount.innerHTML, /data-save-phase="saved"/);
  assert.equal(app.getState().revision, 3);
  app.destroy();
});

test('Creator defers old-save redraw during IME and persists the complete composition on end', async () => {
  const harness = browserHarness({ connection: { account: { address: `0x${'56'.repeat(32)}`, chains: ['sui:mainnet'] } } });
  const slow = deferred(); const dispatch = harness.bridge.dispatchDraftCommand;
  let attempts = 0;
  harness.bridge.dispatchDraftCommand = async input => { attempts += 1; if (attempts === 1) await slow.promise; return dispatch(input); };
  const app = createOriginalProductApp(harness); await app.ready; await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const input = new FakeTarget(harness.doc, { dataset: { action: 'soul-document-content', soulKey: 'soulMd' } }); input.parent = mount;
  input.value = 'a'; mount.fire('input', { target: input }); await settle();
  input.focus(); mount.fire('compositionstart', { target: input });
  input.value = 'a中'; mount.fire('input', { target: input, isComposing: true });
  const composingMarkup = mount.innerHTML;
  slow.resolve(); await settle(); await settle();
  assert.equal(mount.innerHTML, composingMarkup, 'An older async save must not replace the IME-owned DOM.');
  assert.equal(attempts, 1);
  input.value = 'a中文'; mount.fire('compositionend', { target: input }); await settle(); await settle();
  assert.equal(harness.calls.dispatch.at(-1).command.livingContent.soulMd, 'a中文');
  assert.match(mount.innerHTML, /data-save-phase="saved"/);
  app.destroy();
});

test('Creator edits use only durable Fresh-v8 dispatch and replace commands', async () => {
  const address = `0x${'56'.repeat(32)}`;
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  assert.match(mount.innerHTML, /Approved Maker/);

  const partName = new FakeTarget(harness.doc, { dataset: { action: 'part-name' } });
  partName.parent = mount;
  partName.value = 'Renamed Base';
  mount.fire('change', { target: partName });
  await settle();
  assert.equal(harness.calls.dispatch.length, 1);
  assert.equal(harness.calls.dispatch[0].command.type, 'part.upsert');
  assert.equal(harness.calls.dispatch[0].command.row.label, 'Renamed Base');

  const pixel = new FakeTarget(harness.doc, { dataset: { action: 'toggle-pixel' } });
  pixel.parent = mount;
  mount.fire('click', { target: pixel });
  await settle();
  assert.equal(harness.calls.dispatch.at(-1).command.type, 'canvas.set');
  assert.equal(harness.calls.dispatch.at(-1).command.canvas.pixelMode, 'pixelated');

  const undo = new FakeTarget(harness.doc, { dataset: { action: 'undo' } });
  undo.parent = mount;
  mount.fire('click', { target: undo });
  await settle();
  assert.equal(harness.calls.replace.length, 1);
  assert.equal(harness.calls.replace[0].draftId, 'approved-maker');
  app.destroy();
});

test('Creator writes serialize on fresh revisions and the real Save button retries the last exact CAS snapshot', async () => {
  const address = `0x${'86'.repeat(32)}`;
  const record = structuredClone(draftRecord());
  const firstWrite = deferred();
  let server = structuredClone(record);
  let failFirst = false;
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    record,
  });
  harness.bridge.dispatchDraftCommand = async (input) => {
    harness.calls.dispatch.push(structuredClone(input));
    if (failFirst) {
      failFirst = false;
      throw new Error('durable draft write failed');
    }
    if (harness.calls.dispatch.length === 1) await firstWrite.promise;
    const document = structuredClone(server.document);
    if (input.command.type === 'part.upsert') {
      const index = document.parts.findIndex((part) => part.key === input.command.row.key);
      document.parts[index] = structuredClone(input.command.row);
    } else if (input.command.type === 'canvas.set') {
      document.canvas = structuredClone(input.command.canvas);
    }
    server = { ...server, revision: server.revision + 1, document };
    return structuredClone(server);
  };
  harness.bridge.replaceDraftDocument = async (input) => {
    harness.calls.replace.push(structuredClone(input));
    server = { ...server, revision: server.revision + 1, document: structuredClone(input.document) };
    return structuredClone(server);
  };
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const partName = new FakeTarget(harness.doc, { dataset: { action: 'part-name' } });
  partName.parent = mount;
  partName.value = 'Queued Base';
  const pixel = new FakeTarget(harness.doc, { dataset: { action: 'toggle-pixel' } });
  pixel.parent = mount;
  mount.fire('change', { target: partName });
  mount.fire('click', { target: pixel });
  await settle();
  assert.equal(harness.calls.dispatch.length, 1, 'the second edit waits for the first CAS');
  assert.equal(harness.calls.dispatch[0].expectedRevision, 1);
  firstWrite.resolve();
  await settle();
  await settle();
  assert.equal(harness.calls.dispatch.length, 2);
  assert.equal(harness.calls.dispatch[1].expectedRevision, 2, 'the queued edit uses the fresh revision');
  assert.equal(app.getState().revision, 3);
  assert.equal(server.document.parts[0].label, 'Queued Base');
  assert.equal(server.document.canvas.pixelMode, 'pixelated');

  failFirst = true;
  const failedName = new FakeTarget(harness.doc, { dataset: { action: 'part-name' } });
  failedName.parent = mount;
  failedName.value = 'Retry Snapshot';
  mount.fire('change', { target: failedName });
  await settle();
  await settle();
  assert.match(mount.innerHTML, /data-save-phase="error"/);
  assert.match(mount.innerHTML, /durable draft write failed/);
  assert.doesNotMatch(mount.innerHTML, /data-save-phase="error"[^>]*>[\s\S]*Saved/);
  const save = new FakeTarget(harness.doc, { dataset: { action: 'save' } });
  save.parent = mount;
  mount.fire('click', { target: save });
  await settle();
  await settle();
  assert.equal(harness.calls.replace.at(-1).expectedRevision, 3);
  assert.equal(harness.calls.replace.at(-1).document.parts[0].label, 'Retry Snapshot');
  assert.equal(app.getState().revision, 4);
  assert.match(mount.innerHTML, /data-save-phase="saved"/);
  app.destroy();
});

test('opening draft B drains the pending Creator write for A without copying it into B', async () => {
  const address = `0x${'87'.repeat(32)}`;
  const draftA = structuredClone(draftRecord());
  draftA.draftId = 'draft-a';
  draftA.document.metadata.name = 'Draft A';
  const draftB = structuredClone(draftRecord({ updatedAt: 1_700_000_000_100 }));
  draftB.draftId = 'draft-b';
  draftB.document.metadata.name = 'Draft B';
  const writeA = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    record: draftA,
    draftsResult: [draftA, draftB],
  });
  harness.bridge.getDraft = async ({ draftId }) => ({
    draft: structuredClone(draftId === 'draft-b' ? draftB : draftA),
    assets: [],
  });
  harness.bridge.dispatchDraftCommand = async () => writeA.promise;
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openDraft('draft-a');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const name = new FakeTarget(harness.doc, { dataset: { action: 'part-name' } });
  name.parent = mount;
  name.value = 'Late A';
  mount.fire('change', { target: name });
  await settle();
  const openingB = app.openDraft('draft-b');
  await settle();
  assert.equal(app.getState().draftId, 'draft-a', 'keep A until its pending write is acknowledged');
  const late = structuredClone(draftA);
  late.revision = 2;
  late.document.parts[0].label = 'Late A';
  writeA.resolve(late);
  await openingB;
  await settle();
  await settle();
  assert.equal(app.getState().draftId, 'draft-b');
  assert.equal(app.getState().revision, 1);
  assert.match(mount.innerHTML, /Draft B/);
  assert.doesNotMatch(mount.innerHTML, /Late A/);
  app.destroy();
});

test('the approved Creator Library, New Maker modal and editor use real Fresh-v8 draft APIs', async () => {
  const address = `0x${'57'.repeat(32)}`;
  const record = draftRecord();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    record,
    draftsResult: [record],
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  const library = harness.doc.getElementById('imageMakerList');

  assert.equal(harness.calls.listDrafts, 1);
  assert.match(library.innerHTML, /class="creator-maker-card active"/);
  assert.match(library.innerHTML, /class="maker-cover-mini"/);
  assert.match(library.innerHTML, /data-manage-lifecycle="approved-maker"/);
  assert.match(library.innerHTML, /data-edit-maker="approved-maker"/);

  const edit = new FakeTarget(harness.doc, { dataset: { editMaker: 'approved-maker' } });
  edit.parent = library;
  library.fire('click', { target: edit });
  await settle();
  assert.deepEqual(harness.calls.getDraft, ['approved-maker']);
  assert.match(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Approved Maker/);

  harness.newMakerButton.fire('click');
  assert.equal(harness.doc.getElementById('makerRegistrationModal').classList.contains('active'), true);
  harness.doc.getElementById('newMakerName').value = 'Fresh Created Maker';
  harness.canvasChoices[1].fire('click');
  harness.doc.getElementById('registerMaker').fire('click');
  await settle();
  await settle();

  assert.deepEqual(harness.calls.createDraft, [{
    name: 'Fresh Created Maker',
    canvas: '1080×1920',
    startingStructure: 'character',
  }]);
  assert.equal(app.getState().draftId, 'created-maker-1');
  assert.equal(harness.doc.getElementById('makerRegistrationModal').classList.contains('active'), false);
  assert.match(library.innerHTML, /Fresh Created Maker/);
  app.destroy();
});

test('local draft deletion confirms one exact draft and preserves cancellation, conflicts and other drafts', async (context) => {
  for (const mode of ['cancel', 'success', 'failure', 'wrong-wallet', 'wallet-roundtrip', 'other-draft', 'late-other', 'late-reopen', 'late-read', 'duplicate', 'save-pending']) {
    await context.test(mode, async () => {
      const record = draftRecord();
      const other = structuredClone(record);
      other.draftId = 'other-maker'; other.document.metadata.name = 'Other untouched Maker';
      const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } },
        record, draftsResult: [record, other] });
      const gate = deferred(); const saving = deferred(); const reading = deferred(); const deletions = [];
      let delayRead = false;
      harness.bridge.getDraft = async ({ draftId }) => {
        if (delayRead && draftId === record.draftId) await reading.promise;
        return { draft: draftId === other.draftId ? other : record, assets: [] };
      };
      harness.bridge.deleteDraft = async input => {
        deletions.push(input); await gate.promise;
        if (mode === 'failure') throw new Error('Draft changed in another tab.');
        return true;
      };
      harness.bridge.dispatchDraftCommand = async () => { await saving.promise; return { ...record, revision: record.revision + 1 }; };
      const app = createOriginalProductApp(harness);
      try {
        await app.ready; await app.openDraft(record.draftId);
        const mount = harness.doc.getElementById('makerV4CreatorMount');
        const modal = harness.doc.getElementById('makerLifecycleManagerModal');
        const notice = harness.doc.getElementById('makerLifecycleManagerNotice');
        const click = action => {
          const control = new FakeTarget(harness.doc, { dataset: { lifecycleAction: action } });
          control.parent = modal; modal.fire('click', { target: control });
        };
        const manage = new FakeTarget(harness.doc, { dataset: { action: 'manage-lifecycle' } });
        manage.parent = mount; mount.fire('click', { target: manage });
        if (mode === 'save-pending') {
          const input = new FakeTarget(harness.doc, { dataset: { action: 'maker-name' } });
          input.parent = mount; input.value = 'Pending'; mount.fire('change', { target: input });
          await settle();
        }
        click('delete-draft');
        assert.equal(notice.hidden, mode === 'save-pending');
        if (mode !== 'save-pending') assert.match(notice.innerHTML, /Approved Maker/);
        assert.equal(deletions.length, 0);
        if (mode === 'cancel') click('cancel-delete-draft');
        if (mode === 'wrong-wallet') app.refreshConnection({ account: { address: ROOT_TWO, chains: ['sui:mainnet'] } });
        if (mode === 'wallet-roundtrip') {
          app.refreshConnection(null);
          app.refreshConnection({ account: { address: ROOT_ONE, chains: ['sui:mainnet'] } });
        }
        if (mode === 'other-draft') await app.openDraft(other.draftId);
        click('confirm-delete-draft');
        if (mode === 'duplicate') click('confirm-delete-draft');
        if (mode === 'late-other') await app.openDraft(other.draftId);
        if (mode === 'late-reopen') await app.openDraft(record.draftId);
        let pendingRead;
        if (mode === 'late-read') {
          await app.openDraft(other.draftId);
          delayRead = true;
          pendingRead = app.openDraft(record.draftId);
        }
        gate.resolve(); saving.resolve(); await settle(); await settle();
        reading.resolve();
        if (pendingRead) assert.equal(await pendingRead, null);
        const blocked = ['cancel', 'wrong-wallet', 'wallet-roundtrip', 'other-draft', 'save-pending'].includes(mode);
        assert.equal(deletions.length, blocked ? 0 : 1);
        if (!blocked) assert.deepEqual(deletions[0], { draftId: record.draftId, expectedRevision: record.revision });
        if (mode === 'failure') {
          assert.equal(app.getState().draftId, record.draftId);
          assert.match(harness.doc.getElementById('makerLifecycleManagerStatus').textContent, /Draft changed/);
        }
        if (['success', 'duplicate', 'late-reopen'].includes(mode)) assert.equal(app.getState().draftId, null);
        if (['late-other', 'other-draft', 'late-read'].includes(mode)) assert.equal(app.getState().draftId, other.draftId);
        assert.match(harness.doc.getElementById('imageMakerList').innerHTML, /Other untouched Maker/);
        if (!blocked && mode !== 'failure') assert.doesNotMatch(harness.doc.getElementById('imageMakerList').innerHTML, /data-maker="approved-maker"/);
      } finally { gate.resolve(); saving.resolve(); reading.resolve(); app.destroy(); }
    });
  }
});

test('Creator Library tracks only saved Maker names across pending writes and retries', async (context) => {
  for (const fail of [false, true]) await context.test(fail ? 'failed save then retry' : 'delayed save', async () => {
    const record = draftRecord();
    const other = structuredClone(record);
    other.draftId = 'other-maker';
    other.document.metadata.name = 'Other untouched Maker';
    const harness = browserHarness({
      connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } },
      record, draftsResult: [record, other],
    });
    const gate = deferred();
    const saved = structuredClone(record);
    saved.revision += 1;
    saved.document.metadata.name = 'Saved renamed Maker';
    harness.bridge.dispatchDraftCommand = async () => {
      await gate.promise;
      if (fail) throw new Error('S1 save failed');
      return saved;
    };
    harness.bridge.replaceDraftDocument = async () => saved;
    const app = createOriginalProductApp(harness);
    try {
      await app.ready;
      await app.openDraft(record.draftId);
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      const library = harness.doc.getElementById('imageMakerList');
      const name = new FakeTarget(harness.doc, { dataset: { action: 'maker-name' } });
      name.parent = mount;
      name.value = saved.document.metadata.name;
      mount.fire('change', { target: name });
      await settle();
      harness.doc.getElementById('backToMakerList').fire('click');
      assert.match(library.innerHTML, /Approved Maker/);
      assert.doesNotMatch(library.innerHTML, /Saved renamed Maker/);
      gate.resolve();
      await settle();
      if (fail) {
        assert.match(library.innerHTML, /Approved Maker/);
        assert.doesNotMatch(library.innerHTML, /Saved renamed Maker/);
        const save = new FakeTarget(harness.doc, { dataset: { action: 'save' } });
        save.parent = mount;
        mount.fire('click', { target: save });
        await settle();
      }
      assert.match(library.innerHTML, /Saved renamed Maker/);
      assert.doesNotMatch(library.innerHTML, />Approved Maker</);
      assert.match(library.innerHTML, /Other untouched Maker/);
    } finally { gate.resolve(); app.destroy(); }
  });
});

test('Creator draft openings fence stale async loads without duplicating the approved editor', async () => {
  const address = `0x${'60'.repeat(32)}`;
  const firstRecord = structuredClone(draftRecord());
  firstRecord.draftId = 'draft-a';
  firstRecord.document.metadata.name = 'Draft A';
  const secondRecord = structuredClone(draftRecord({ updatedAt: 1_700_000_000_001 }));
  secondRecord.draftId = 'draft-b';
  secondRecord.document.metadata.name = 'Draft B';
  const firstGate = deferred();
  const secondGate = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    record: firstRecord,
    draftsResult: [firstRecord, secondRecord],
  });
  harness.bridge.getDraft = ({ draftId }) => (
    draftId === 'draft-a' ? firstGate.promise : secondGate.promise
  );
  const app = createOriginalProductApp(harness);
  await app.ready;

  const firstOpen = app.openDraft('draft-a');
  const secondOpen = app.openDraft('draft-b');
  secondGate.resolve({ draft: secondRecord, assets: [] });
  assert.equal((await secondOpen).draftId, 'draft-b');
  firstGate.resolve({ draft: firstRecord, assets: [] });
  assert.equal(await firstOpen, null);

  assert.equal(app.getState().draftId, 'draft-b');
  assert.match(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Draft B/);
  assert.doesNotMatch(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Draft A/);
  app.destroy();
});

test('Draft Recovery uses its approved modal and restores only through Fresh-v8 load', async () => {
  const address = `0x${'58'.repeat(32)}`;
  const record = draftRecord();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    record,
    draftsResult: [record],
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  harness.doc.getElementById('openDraftRecovery').fire('click');
  await settle();
  await settle();

  const modal = harness.doc.getElementById('draftRecoveryModal');
  const list = harness.doc.getElementById('draftRecoveryList');
  assert.equal(modal.classList.contains('active'), true);
  assert.equal(harness.calls.listDrafts, 2);
  assert.match(list.innerHTML, /class="draft-recovery-card"/);
  assert.match(list.innerHTML, /data-recovery-action="restore"/);
  assert.match(list.innerHTML, /data-recovery-action="export"[^>]+disabled/);

  const restore = new FakeTarget(harness.doc, {
    dataset: { recoveryAction: 'restore', recoveryId: 'approved-maker' },
  });
  restore.parent = list;
  list.fire('click', { target: restore });
  await settle();
  assert.deepEqual(harness.calls.getDraft, ['approved-maker']);
  assert.equal(modal.classList.contains('active'), false);
  assert.equal(app.getState().draftId, 'approved-maker');
  app.destroy();
});

test('Manage status reuses the approved panel and never exposes unbound lifecycle actions', async () => {
  const address = `0x${'59'.repeat(32)}`;
  const record = draftRecord();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    record,
    draftsResult: [record],
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  const library = harness.doc.getElementById('imageMakerList');
  const manage = new FakeTarget(harness.doc, {
    dataset: { manageLifecycle: 'approved-maker' },
  });
  manage.parent = library;
  library.fire('click', { target: manage });
  await settle();

  const modal = harness.doc.getElementById('makerLifecycleManagerModal');
  const actions = harness.doc.getElementById('makerLifecycleManagerActions').innerHTML;
  assert.equal(modal.classList.contains('active'), true);
  assert.deepEqual(harness.calls.getDraft, ['approved-maker']);
  assert.match(actions, /data-lifecycle-action="pause" disabled aria-disabled="true"/);
  assert.match(actions, /data-lifecycle-action="resume" disabled aria-disabled="true"/);
  assert.match(actions, /data-lifecycle-action="archive" disabled aria-disabled="true"/);
  assert.match(actions, /data-lifecycle-action="withdraw" disabled aria-disabled="true"/);
  assert.match(harness.doc.getElementById('makerLifecycleManagerStatus').textContent, /unavailable/i);

  modal.fire('click', { target: harness.lifecycleOpenEditor });
  assert.equal(modal.classList.contains('active'), false);
  assert.match(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Approved Maker/);
  app.destroy();
});

test('Version history explicitly reviews and signs archive, cold-recovers it, then copies current work to successor', async () => {
  const address = `0x${'78'.repeat(32)}`, rootId = `0x${'45'.repeat(32)}`;
  const harness = browserHarness({ initialUrl: 'https://animacraft.soulidity.ai/#creator', connection: { account: { address, chains: ['sui:mainnet'] } } });
  let lifecycle = 'ACTIVE', signs = 0, prepares = 0, recoveries = 0, creates = 0;
  harness.bridge.listMakerLineage = async () => [{ rootId, makerVersion: 1, lifecycle, ownerAddress: address, successorRootId: null }];
  harness.bridge.prepareLifecycleAction = async input => { prepares++; assert.equal(input.action, 'ARCHIVE');
    assert.equal(input.draftId, 'approved-maker'); assert.equal(input.expectedRevision, 1);
    return { built: { action: 'ARCHIVE', descriptor: { sender: address } }, digest: 'exact-archive', bytes: 'AA==' }; };
  harness.bridge.requestLifecycleSignature = async prepared => { signs++; assert.equal(prepared.digest, 'exact-archive'); return {}; };
  harness.bridge.recoverLifecycleAction = async input => { recoveries++; assert.deepEqual(input, { action: 'ARCHIVE', rootId }); lifecycle = 'ARCHIVED'; };
  harness.bridge.createSuccessorDraft = async input => { creates++; assert.equal(input.expectedRevision, 1);
    assert.equal(lifecycle, 'ARCHIVED'); const draft = structuredClone(draftRecord());
    draft.draftId = 'maker-successor-test'; draft.document.lineage.version = 2;
    draft.document.lineage.previousRootId = rootId; draft.document.lineage.previousVersionCommitment = 'ab'.repeat(32);
    return { draft, assets: [] }; };
  const oldSubscribe = harness.bridge.subscribe;
  harness.bridge.subscribe = fn => oldSubscribe(value => fn({ ...value,
    publication: { signingEnabled: true, broadcastEnabled: true } }));
  const app = createOriginalProductApp(harness); await app.ready; await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const action = async name => { const target = new FakeTarget(harness.doc, { dataset: { action: name, chainRoot: rootId } });
    target.parent = mount; await waitForEvent(mount.fire('click', { target })); await settle(); };
  await action('open-version-history');
  assert.match(mount.innerHTML, /Published chain versions/); assert.match(mount.innerHTML, /Local saved snapshots/);
  await action('chain-successor'); assert.equal(creates, 0);
  await action('chain-archive-review'); assert.equal(prepares, 1); assert.equal(signs, 0);
  assert.match(mount.innerHTML, /Archiving is irreversible/);
  await action('chain-archive-sign'); assert.equal(signs, 1); assert.equal(recoveries, 0);
  await action('close-version-history'); await action('open-version-history');
  await action('chain-archive-recover'); assert.equal(signs, 1); assert.equal(recoveries, 1);
  await action('chain-successor'); assert.equal(creates, 1);
  assert.equal(app.getState().draftId, 'maker-successor-test');
  app.destroy();
});

test('Version history stays in the approved dialog and restores through the Fresh-v8 bridge', async () => {
  const address = `0x${'78'.repeat(32)}`;
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');

  const history = new FakeTarget(harness.doc, { dataset: { action: 'open-version-history' } });
  history.parent = mount;
  mount.fire('click', { target: history });
  await settle();
  assert.equal(harness.calls.listVersions, 1);
  assert.match(mount.innerHTML, /class="v4-version-history-dialog"/);

  const restore = new FakeTarget(harness.doc, {
    dataset: { action: 'restore-checkpoint', revision: '1' },
  });
  restore.parent = mount;
  mount.fire('click', { target: restore });
  await settle();
  assert.deepEqual(harness.calls.restore[0], {
    draftId: 'approved-maker',
    expectedRevision: 1,
    revision: 1,
  });
  assert.match(mount.innerHTML, /Revision 1 restored/);
  app.destroy();
});

test('Creator Escape dismisses one visible overlay and restores approved focus without enabling actions', async () => {
  const harness = browserHarness({
    connection: { account: { address: `0x${'78'.repeat(32)}`, chains: ['sui:mainnet'] } },
  });
  const editor = new FakeTarget(harness.doc, { dataset: { creatorView: 'edit' } });
  harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  const app = createOriginalProductApp(harness);
  await app.ready;
  app.navigate('creator');
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const action = (dataset) => {
    const target = new FakeTarget(harness.doc, { dataset });
    target.parent = mount;
    mount.fire('click', { target });
    return target;
  };
  const structure = new FakeTarget(harness.doc);
  const toolClose = new FakeTarget(harness.doc);
  const historyOpen = new FakeTarget(harness.doc);
  mount.selectorChildren.set('[data-tab="structure"]', structure);
  mount.selectorChildren.set('.v4-tool-modal-backdrop [data-action="close-tool"]', toolClose);
  mount.selectorChildren.set('[data-action="open-version-history"]', historyOpen);

  for (const tab of ORIGINAL_CREATOR_TABS.filter(({ id }) => id !== 'structure')) {
    action({ action: 'creator-tab', tab: tab.id });
    assert.equal(app.getState().creatorTab, tab.id);
    assert.equal(harness.doc.activeElement, toolClose);
    const handled = harness.doc.fire('keydown', { key: 'Escape', defaultPrevented: true });
    assert.equal(handled.defaultPrevented, true);
    assert.equal(app.getState().creatorTab, tab.id);
    const escape = harness.doc.fire('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(app.getState().creatorTab, 'structure');
    assert.equal(harness.doc.activeElement, structure);
    assert.doesNotMatch(mount.innerHTML, /class="v4-tool-modal-backdrop"/);
  }
  assert.match(mount.innerHTML, /data-action="open-player"[^>]*disabled/);

  action({ action: 'creator-tab', tab: 'info' });
  action({ action: 'open-version-history' });
  await settle();
  const lifecycle = harness.doc.getElementById('makerLifecycleManagerModal');
  lifecycle.classList.add('active');
  harness.doc.fire('keydown', { key: 'Escape' });
  assert.equal(lifecycle.classList.contains('active'), false);
  assert.match(mount.innerHTML, /class="v4-version-history-dialog"/);
  harness.doc.fire('keydown', { key: 'Escape' });
  assert.doesNotMatch(mount.innerHTML, /class="v4-version-history-dialog"/);
  assert.equal(app.getState().creatorTab, 'info');
  assert.equal(harness.doc.activeElement, toolClose);
  harness.doc.fire('keydown', { key: 'Escape' });
  assert.equal(app.getState().creatorTab, 'structure');

  action({ action: 'open-version-history' });
  await settle();
  harness.doc.fire('keydown', { key: 'Escape' });
  assert.equal(harness.doc.activeElement, historyOpen);
  action({ action: 'creator-tab', tab: 'info' });
  editor.classList.remove('active');
  const hidden = harness.doc.fire('keydown', { key: 'Escape' });
  assert.equal(hidden.defaultPrevented, undefined);
  assert.equal(app.getState().creatorTab, 'info');
  app.destroy();
});

test('late history loading cannot steal focus from a hidden Creator or a higher dialog', async (context) => {
  for (const kind of ['hidden', 'lifecycle', 'wallet']) {
    await context.test(kind, async () => {
      const harness = browserHarness({
        connection: { account: { address: `0x${'78'.repeat(32)}`, chains: ['sui:mainnet'] } },
      });
      const editor = new FakeTarget(harness.doc, { dataset: { creatorView: 'edit' } });
      harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
      harness.doc.selectorLists.set('[data-creator-view]', [editor]);
      const gate = deferred();
      harness.bridge.listDraftVersions = async () => gate.promise;
      const app = createOriginalProductApp(harness);
      await app.ready;
      app.navigate('creator');
      await app.openDraft('approved-maker');
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      const historyClose = new FakeTarget(harness.doc);
      mount.selectorChildren.set('.v4-version-history-dialog button[data-action="close-version-history"]', historyClose);
      const history = new FakeTarget(harness.doc, { dataset: { action: 'open-version-history' } });
      history.parent = mount;
      mount.fire('click', { target: history });
      assert.equal(harness.doc.activeElement, historyClose);
      const foreground = new FakeTarget(harness.doc);
      if (kind === 'hidden') editor.classList.remove('active');
      if (kind === 'lifecycle') harness.doc.getElementById('makerLifecycleManagerModal').classList.add('active');
      if (kind === 'wallet') {
        const wallet = harness.doc.add(new FakeTarget(harness.doc, { id: 'suiWalletModal' }));
        wallet.shadowRoot = new FakeTarget(harness.doc);
        wallet.shadowRoot.selectorChildren.set('dialog[open]', foreground);
      }
      foreground.focus();
      gate.resolve([]);
      await settle();
      assert.equal(harness.doc.activeElement, foreground);
      app.destroy();
    });
  }
});

test('closing history invalidates its delayed list without replacing the restored focus', async () => {
  const harness = browserHarness({
    connection: { account: { address: `0x${'78'.repeat(32)}`, chains: ['sui:mainnet'] } },
  });
  const editor = new FakeTarget(harness.doc, { dataset: { creatorView: 'edit' } });
  harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  const gate = deferred();
  harness.bridge.listDraftVersions = async () => gate.promise;
  const app = createOriginalProductApp(harness);
  await app.ready;
  app.navigate('creator');
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  let markup = mount.innerHTML;
  let renders = 0;
  Object.defineProperty(mount, 'innerHTML', {
    get: () => markup,
    set: (value) => {
      markup = value;
      renders += 1;
      if (mount.contains(harness.doc.activeElement)) harness.doc.activeElement = null;
    },
  });
  const history = new FakeTarget(harness.doc, { dataset: { action: 'open-version-history' } });
  history.parent = mount;
  mount.selectorChildren.set('[data-action="open-version-history"]', history);
  mount.fire('click', { target: history });
  harness.doc.fire('keydown', { key: 'Escape' });
  const closedRenders = renders;
  assert.equal(harness.doc.activeElement, history);
  gate.resolve([]);
  await settle();
  assert.equal(renders, closedRenders);
  assert.equal(harness.doc.activeElement, history);
  app.destroy();
});

test('a failed prior save leaves version history dismissible instead of permanently restoring', async (context) => {
  for (const pendingSave of [false, true]) {
    await context.test(pendingSave ? 'save fails after restore queues' : 'save already failed', async () => {
      const harness = browserHarness({
        connection: { account: { address: `0x${'78'.repeat(32)}`, chains: ['sui:mainnet'] } },
      });
      const editor = new FakeTarget(harness.doc, { dataset: { creatorView: 'edit' } });
      harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
      harness.doc.selectorLists.set('[data-creator-view]', [editor]);
      const gate = deferred();
      harness.bridge.dispatchDraftCommand = async () => gate.promise;
      const app = createOriginalProductApp(harness);
      await app.ready;
      app.navigate('creator');
      await app.openDraft('approved-maker');
      const mount = harness.doc.getElementById('makerV4CreatorMount');
      const name = new FakeTarget(harness.doc, { dataset: { action: 'maker-name' } });
      name.parent = mount;
      name.value = 'Pending edit';
      mount.fire('change', { target: name });
      await settle();
      if (!pendingSave) {
        gate.reject(new Error('save failed'));
        await settle();
      }
      const history = new FakeTarget(harness.doc, { dataset: { action: 'open-version-history' } });
      history.parent = mount;
      mount.fire('click', { target: history });
      await settle();
      const restore = new FakeTarget(harness.doc, { dataset: { action: 'restore-checkpoint', revision: '1' } });
      restore.parent = mount;
      mount.fire('click', { target: restore });
      if (pendingSave) gate.reject(new Error('save failed'));
      await settle();
      await settle();
      assert.equal(harness.calls.restore.length, 0);
      assert.match(mount.innerHTML, /Save the current draft before restoring a version/);
      harness.doc.fire('keydown', { key: 'Escape' });
      assert.doesNotMatch(mount.innerHTML, /class="v4-version-history-dialog"/);
      app.destroy();
    });
  }
});

test('Creator history Escape and backdrop cannot interrupt a durable restore', async () => {
  const harness = browserHarness({
    connection: { account: { address: `0x${'78'.repeat(32)}`, chains: ['sui:mainnet'] } },
  });
  const editor = new FakeTarget(harness.doc, { dataset: { creatorView: 'edit' } });
  harness.doc.selectorSingles.set('.creator-view[data-creator-view="edit"]', editor);
  harness.doc.selectorLists.set('[data-creator-view]', [editor]);
  const gate = deferred();
  harness.bridge.restoreDraftVersion = async () => gate.promise;
  const app = createOriginalProductApp(harness);
  await app.ready;
  app.navigate('creator');
  await app.openDraft('approved-maker');
  const mount = harness.doc.getElementById('makerV4CreatorMount');
  const action = (dataset) => {
    const target = new FakeTarget(harness.doc, { dataset });
    target.parent = mount;
    mount.fire('click', { target });
    return target;
  };
  action({ action: 'open-version-history' });
  await settle();
  action({ action: 'restore-checkpoint', revision: '1' });
  await settle();
  assert.equal(harness.doc.fire('keydown', { key: 'Escape' }).defaultPrevented, true);
  action({ action: 'close-version-history-backdrop' });
  action({ action: 'close-version-history' });
  assert.match(mount.innerHTML, /class="v4-version-history-dialog"/);
  gate.resolve(draftRecord());
  await settle();
  await settle();
  const backdrop = new FakeTarget(harness.doc, { dataset: { action: 'close-version-history-backdrop' } });
  backdrop.parent = mount;
  const content = new FakeTarget(harness.doc);
  content.parent = backdrop;
  mount.fire('click', { target: content });
  assert.match(mount.innerHTML, /class="v4-version-history-dialog"/);
  harness.doc.fire('keydown', { key: 'Escape' });
  assert.doesNotMatch(mount.innerHTML, /class="v4-version-history-dialog"/);
  app.destroy();
});

test('Player controller rejections stay visible in both approved status regions and preserve the prior recipe', async (context) => {
  const address = `0x${'81'.repeat(32)}`;
  const maker = certifiedMaker();

  for (const [label, action, installFailure] of [
    ['recipe update', { action: 'player-item', choiceId: 'base:base:alternate:alternate' }, (bridge) => {
      bridge.updatePlayerRecipe = async () => { throw new Error('recipe controller rejected'); };
    }],
    ['recipe reset', { action: 'player-reset' }, (bridge) => {
      bridge.resetPlayerRecipe = async () => { throw new Error('reset controller rejected'); };
    }],
  ]) {
    await context.test(label, async () => {
      const harness = browserHarness({
        connection: { account: { address, chains: ['sui:mainnet'] } },
        templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
        playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
      });
      installFailure(harness.bridge);
      const app = createOriginalProductApp(harness);
      await app.ready;
      await app.openPlayer(ROOT_ONE);
      const mount = harness.doc.getElementById('makerV4PlayerMount');
      const control = new FakeTarget(harness.doc, { dataset: action });
      control.parent = mount;
      mount.fire('click', { target: control });
      await settle();
      await settle();

      assert.match(mount.innerHTML, /id="v4PlayerRenderStatus"[^>]+data-state="error"[^>]*>[^<]*controller rejected/);
      assert.match(mount.innerHTML, /id="v4PlayerCompletionStatus"[^>]+data-state="blocked"[^>]*>[^<]*controller rejected/);
      assert.match(mount.innerHTML, /class="v4-player-item active"[^>]+data-choice-id="base:base:default:default"/);
      assert.doesNotMatch(mount.innerHTML, /class="v4-player-item active"[^>]+data-choice-id="base:base:alternate:alternate"/);
      app.destroy();
    });
  }
});

test('New Maker and draft-open failures reuse only the approved validation and Creator library states', async (context) => {
  const address = `0x${'82'.repeat(32)}`;

  await context.test('create failure', async () => {
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
    });
    harness.bridge.createDraft = async () => { throw new Error('draft create unavailable'); };
    const app = createOriginalProductApp(harness);
    await app.ready;
    harness.newMakerButton.fire('click');
    const input = harness.doc.getElementById('newMakerName');
    input.value = 'Cannot create';
    harness.doc.getElementById('registerMaker').fire('click');
    await settle();

    assert.equal(input.validationMessage, 'draft create unavailable');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.reportValidityCalls, 1);
    input.fire('input');
    assert.equal(input.validationMessage, '');
    assert.equal(input.getAttribute('aria-invalid'), 'false');
    app.destroy();
  });

  await context.test('open failure', async () => {
    const record = draftRecord();
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      record,
      draftsResult: [record],
    });
    harness.bridge.getDraft = async () => { throw new Error('draft asset readback failed'); };
    const app = createOriginalProductApp(harness);
    await app.ready;
    const library = harness.doc.getElementById('imageMakerList');
    const edit = new FakeTarget(harness.doc, { dataset: { editMaker: 'approved-maker' } });
    edit.parent = library;
    library.fire('click', { target: edit });
    await settle();

    assert.match(library.innerHTML, /class="empty-state">draft asset readback failed/);
    app.destroy();
  });
});

test('Creator and Player canvases consume only canonical bridge PNGs, retain draft assets, and release object URLs', async () => {
  const address = `0x${'83'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview({ width: 900, height: 700 }),
    renderDraftPreviewResult: canonicalPreview({ width: 640, height: 480, sha256: 'de'.repeat(32) }),
    draftAssets: [localDraftAsset()],
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openDraft('approved-maker');
  await app.openPlayer(ROOT_ONE);

  assert.deepEqual(harness.calls.renderDraftPreview, ['approved-maker']);
  assert.deepEqual(harness.calls.renderPlayerPreview, [ROOT_ONE]);
  assert.match(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /src="blob:test-/);
  assert.deepEqual(
    harness.doc.getElementById('makerV4CreatorCanvas').draws.at(-1),
    ['draw', 0, 0, 640, 480],
  );
  assert.deepEqual(
    harness.doc.getElementById('makerV4PlayerCanvas').draws.at(-1),
    ['draw', 0, 0, 900, 700],
  );
  assert.ok(harness.win.objectUrls.revoked.length >= 2, 'temporary canvas URLs are released');
  const retainedAssetUrl = harness.win.objectUrls.created[0].url;
  app.destroy();
  assert.ok(harness.win.objectUrls.revoked.includes(retainedAssetUrl), 'retained draft asset URL is released');
});

test('Player canonical rendering fences stale A/B results and draws only the latest exact Root', async () => {
  const address = `0x${'84'.repeat(32)}`;
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'First' });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Second' });
  const firstRender = deferred();
  const secondRender = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [first, second], diagnostics: [] },
    playerSessionResult: (rootId) => playerSession(rootId, rootId === ROOT_ONE ? 'First' : 'Second'),
    renderPlayerPreviewResult: (rootId) => (
      rootId === ROOT_ONE ? firstRender.promise : secondRender.promise
    ),
  });
  const app = createOriginalProductApp(harness);
  await app.ready;

  const stale = app.openPlayer(ROOT_ONE);
  await settle();
  const current = app.openPlayer(ROOT_TWO);
  await settle();
  secondRender.resolve(canonicalPreview({ width: 222, height: 333, sha256: 'f2'.repeat(32) }));
  assert.equal((await current).rootId, ROOT_TWO);
  firstRender.resolve(canonicalPreview({ width: 111, height: 111, sha256: 'f1'.repeat(32) }));
  assert.equal(await stale, null);

  const draws = harness.doc.getElementById('makerV4PlayerCanvas').draws
    .filter((entry) => entry[0] === 'draw');
  assert.deepEqual(draws, [['draw', 0, 0, 222, 333]]);
  assert.equal(app.getState().playerRootId, ROOT_TWO);
  app.destroy();
});

test('signed envelope rescue downloads privately and file import only stages the original completion retry', async () => {
  const address = `0x${'85'.repeat(32)}`; const storageMap = new Map(); const received = [];
  const serialized = JSON.stringify({ schema: 'animacraft.native-envelope-operation.v1',
    intent: { rootId: ROOT_ONE, signer: address, actionId: 'minted' }, status: 'SIGNED', bytes: 'private-recovery-marker', signature: 'verified-fixture-signature' });
  const harness = browserHarness({ storageMap,
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
    completePlayerJourneyResult: async (_input, count, options) => {
      received.push(options.recoveryJson);
      if (count === 1) throw Object.assign(new Error('Private journal could not save the signature.'), { recoveryJson: serialized });
      return { status: 'RECOVERY_REQUIRED', message: 'Original transaction pending' };
    },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  async function fire(action, extra = {}, event = 'click') {
    const target = new FakeTarget(harness.doc, { dataset: { action } }); Object.assign(target, extra);
    target.parent = mount; await waitForEvent(mount.fire(event, { target }));
    for (let i = 0; i < 6; i++) await settle();
  }
  await fire('player-confirm-complete');
  await fire('player-preview-export');
  assert.match(mount.innerHTML, /data-action="player-export-envelope-recovery"/);
  assert.doesNotMatch(mount.innerHTML, /private-recovery-marker|verified-fixture-signature/);
  assert.equal(JSON.stringify(app.getState()).includes('private-recovery-marker'), false);
  assert.equal([...storageMap.values()].some(value => String(value).includes('private-recovery-marker')), false);
  await fire('player-export-envelope-recovery');
  const download = harness.doc.downloads.at(-1);
  assert.equal(download.download, 'animacraft-envelope-recovery.json');
  assert.equal(await harness.win.objectUrls.created.find(row => row.url === download.href).blob.text(), serialized);
  await fire('player-import-envelope-recovery', { files: [{ size: serialized.length, text: async () => serialized }] }, 'change');
  assert.deepEqual(received, [undefined], 'Import does not run a transaction');
  await fire('player-confirm-complete'); assert.deepEqual(received, [undefined, serialized]);
  app.destroy();
});

test('envelope rescue staging rejects late files/refreshes and invalidated wallet or Root', async t => {
  for (const variant of ['newer-file', 'late-refresh', 'wallet', 'root']) await t.test(variant, async () => {
    const address = `0x${'85'.repeat(32)}`; const slow = deferred(); const received = [];
    const json = marker => JSON.stringify({ schema: 'animacraft.native-envelope-operation.v1',
      intent: { rootId: ROOT_ONE, signer: address, actionId: 'minted' }, status: 'SIGNED', bytes: marker });
    const older = json('older-artifact'), newer = json('newer-artifact');
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker(), certifiedMaker({ rootId: ROOT_TWO })], diagnostics: [] },
      playerSessionResult: rootId => playerSession(rootId), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
      exportPlayerEnvelopeRecovery: variant === 'late-refresh' ? () => slow.promise : undefined,
      completePlayerJourneyResult: async (_input, _count, options) => { received.push(options.recoveryJson); return { status: 'RECOVERY_REQUIRED' }; },
    });
    const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    const fire = (action, extra = {}, event = 'click') => {
      const target = new FakeTarget(harness.doc, { dataset: { action } }); Object.assign(target, extra); target.parent = mount;
      return mount.fire(event, { target });
    };
    if (variant === 'late-refresh') await waitForEvent(fire('player-preview-export'));
    else fire('player-import-envelope-recovery', { files: [{ size: older.length, text: () => slow.promise }] }, 'change');
    if (variant === 'wallet') app.refreshConnection({ account: { address: `0x${'86'.repeat(32)}`, chains: ['sui:mainnet'] } });
    else if (variant === 'root') await app.openPlayer(ROOT_TWO);
    else await waitForEvent(fire('player-import-envelope-recovery', { files: [{ size: newer.length, text: async () => newer }] }, 'change'));
    slow.resolve(older); for (let i = 0; i < 8; i++) await settle();
    assert.deepEqual(received, [], 'No import/refresh may run a transaction');
    await waitForEvent(fire('player-export-envelope-recovery'));
    const download = harness.doc.downloads.at(-1);
    if (['wallet', 'root'].includes(variant)) assert.equal(download, undefined);
    else {
      assert.equal(await harness.win.objectUrls.created.find(row => row.url === download.href).blob.text(), newer);
      await waitForEvent(fire('player-clear-envelope-recovery'));
      await waitForEvent(fire('player-confirm-complete'));
      assert.deepEqual(received, [undefined], 'Clearing an imported file does not keep sending stale bytes');
    }
    app.destroy();
  });
});

async function waitForCompletionState(read, message) {
  // WebCrypto runs outside the immediate queue. Wait for observable progress,
  // not a fixed number of turns; a missing control must still fail promptly.
  const deadline = Date.now() + 5000;
  do {
    const value = read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  assert.fail(message);
}

async function waitForCompletionEvent(event) {
  let timer;
  try {
    await Promise.race([waitForEvent(event), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Completion event did not finish within 5 seconds')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

function waitForJourneyConfirmation(mount, previousId = null) {
  return waitForCompletionState(() => {
    const id = mount.innerHTML.match(/data-action="player-confirm-journey-step" data-confirmation-id="([^"]+)"/)?.[1];
    return id && id !== previousId ? id : null;
  }, 'Expected a new visible journey confirmation');
}

test('post-mint envelope step uses the original confirmation for all or only remaining entries', async t => {
  for (const count of [1, 2, 3]) await t.test(`${count} envelopes`, async () => {
    const address = `0x${'85'.repeat(32)}`; const approvals = [];
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
      playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
      completePlayerJourneyResult: async (_input, _count, { confirmStep }) => {
        approvals.push(await confirmStep({ kind: 'NATIVE_ENVELOPES', rootId: ROOT_ONE, signer: address,
          soulId: ROOT_ONE, stateId: ROOT_TWO, transactionDigest: '8'.repeat(43), gasBudgetMist: '50000000', envelopeCount: count }));
        return { status: 'RECOVERY_REQUIRED' };
      },
    });
    const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    const fire = (action, confirmationId) => {
      const target = new FakeTarget(harness.doc, { dataset: { action, confirmationId } });
      target.parent = mount; return mount.fire('click', { target });
    };
    const completion = fire('player-confirm-complete');
    const confirmId = await waitForJourneyConfirmation(mount);
    assert.deepEqual(approvals, []); assert.match(mount.innerHTML, /50000000 MIST/);
    await waitForCompletionEvent(fire('player-confirm-journey-step', confirmId));
    await waitForCompletionEvent(completion);
    assert.deepEqual(approvals, [true]); app.destroy();
  });
});

test('upfront completion overview waits in original Export and continues without approving the next transaction', async () => {
  const address = `0x${'85'.repeat(32)}`;
  const approvals = [];
  const coin = '0x2::test::TEST';
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
    completePlayerJourneyResult: async (_input, _count, { confirmStep }) => {
      const overview = { rootId: ROOT_ONE, signer: address, recipeCommitment: 'a'.repeat(64),
        entryPaymentQuote: { paymentCoinType: coin, maker: { required: true, priceAtomic: '9007199254740993' },
          packs: [], baseItems: [], totalAmountAtomic: '9007199254740993' },
        completePaymentQuote: { paymentCoinType: coin, totalAmountAtomic: '7', packs: [],
          maker: { mode: 0, contentAmountAtomic: '0', fixedFeeAtomic: '7', remainingTotalUses: null },
          rights: { creator: address, soulCreatorRoyaltyBps: '0', makerSourceRoyaltyBps: '0', makerResaleRoyaltyBps: '0',
            termsCommitment: null, evidenceLocator: '', commitment: 'a'.repeat(64) } },
        totalBusinessAmountAtomic: '9007199254741000' };
      const approved = await confirmStep({ kind: 'COMPLETION_OVERVIEW', rootId: ROOT_ONE, signer: address, overview });
      approvals.push(['overview', approved]);
      if (!approved) return { status: 'RECOVERY_REQUIRED' };
      const signed = await confirmStep({ kind: 'PLAYER_ACTION', rootId: ROOT_ONE, signer: address, action: 'commitLoadout',
        record: { action: 'commitLoadout', status: 'PREPARED', rootId: ROOT_ONE, actionId: 'commit-test', transactionDigest: 'digest-test' } });
      approvals.push(['transaction', signed]);
      return { status: 'RECOVERY_REQUIRED' };
    },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = (action, confirmationId) => {
    const control = new FakeTarget(harness.doc, { dataset: { action, confirmationId } });
    control.parent = mount; return { control, event: mount.fire('click', { target: control }) };
  };
  const completion = fire('player-confirm-complete').event;
  const overviewId = await waitForJourneyConfirmation(mount);
  assert.deepEqual(approvals, []);
  assert.match(mount.innerHTML, /9007199254741000/);
  assert.match(mount.innerHTML, /id="makerPlayerExportDialog"/);
  const stale = fire('player-confirm-journey-step', overviewId);
  await waitForCompletionEvent(stale.event);
  await waitForJourneyConfirmation(mount, overviewId);
  assert.deepEqual(approvals, [['overview', true]]);
  await waitForCompletionEvent(mount.fire('click', { target: stale.control }));
  assert.deepEqual(approvals, [['overview', true]]);
  await waitForCompletionEvent(fire('close-player-export').event);
  await waitForCompletionEvent(completion);
  assert.deepEqual(approvals, [['overview', true], ['transaction', false]]);
  app.destroy();
});

test('prepared journey steps wait for their own button and an old confirmation cannot approve the next step', async () => {
  const address = `0x${'85'.repeat(32)}`;
  const approvals = [];
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
    completePlayerJourneyResult: async (_input, _count, { confirmStep, signal }) => {
      for (const action of ['acquireMakerAccess', 'commitLoadout']) {
        const approved = await confirmStep({ kind: 'PLAYER_ACTION', rootId: ROOT_ONE, signer: address, action,
          record: { action, status: 'PREPARED', actionId: `${action}-test`, rootId: ROOT_ONE, transactionDigest: `digest-${action}`,
            makerEntryQuote: action === 'acquireMakerAccess'
              ? { rootId: ROOT_ONE, kind: 1, priceAtomic: '9007199254740993', paymentCoinType: '0x2::test::TEST' } : null } });
        approvals.push({ action, approved });
        if (!approved || signal.aborted) return { status: 'RECOVERY_REQUIRED', stage: action };
      }
      return { status: 'HANDOFF_READY' };
    },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = (action, confirmationId) => {
    const control = new FakeTarget(harness.doc, { dataset: { action, confirmationId } });
    control.parent = mount; return { control, event: mount.fire('click', { target: control }) };
  };
  const completion = fire('player-confirm-complete').event;
  const firstId = await waitForJourneyConfirmation(mount);
  assert.deepEqual(approvals, []);
  assert.match(mount.innerHTML, /9007199254740993/);
  const oldButton = fire('player-confirm-journey-step', firstId);
  await waitForCompletionEvent(oldButton.event);
  const nextId = await waitForJourneyConfirmation(mount, firstId);
  assert.deepEqual(approvals, [{ action: 'acquireMakerAccess', approved: true }]);
  assert.notEqual(nextId, firstId);
  await waitForCompletionEvent(mount.fire('click', { target: oldButton.control }));
  assert.equal(approvals.length, 1);
  await waitForCompletionEvent(fire('player-cancel-journey-step', nextId).event);
  await waitForCompletionEvent(completion);
  assert.deepEqual(approvals[1], { action: 'commitLoadout', approved: false });
  assert.doesNotMatch(mount.innerHTML, /id="makerPlayerCompletionStep"/);
  app.destroy();
});

test('closing, leaving, editing, changing wallet or destroying rejects a visible completion confirmation', async () => {
  for (const boundary of ['close', 'navigate', 'edit', 'wallet', 'destroy']) {
    const address = `0x${'85'.repeat(32)}`;
    const approvals = [];
    const harness = browserHarness({
      connection: { account: { address, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
      playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
      completePlayerJourneyResult: async (_input, _count, { confirmStep, signal }) => {
        const approved = await confirmStep({ kind: 'STORAGE_UPLOAD', purpose: 'NATIVE_CONTENT',
          rootId: ROOT_ONE, signer: address, uploadId: 'encrypted-file', byteLength: 16, byteSha256: '12'.repeat(32) });
        approvals.push({ approved, aborted: signal.aborted });
        return { status: 'RECOVERY_REQUIRED', stage: 'NATIVE_CONTENT' };
      },
    });
    const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
    const mount = harness.doc.getElementById('makerV4PlayerMount');
    const fire = (action, value) => {
      const control = new FakeTarget(harness.doc, { dataset: { action } });
      control.parent = mount; control.value = value;
      return mount.fire(action === 'player-profile-name' ? 'change' : 'click', { target: control });
    };
    const completion = fire('player-confirm-complete');
    await waitForJourneyConfirmation(mount);
    assert.match(mount.innerHTML, /id="makerPlayerCompletionStep"/, boundary);
    if (boundary === 'close') await waitForCompletionEvent(fire('close-player-export'));
    if (boundary === 'navigate') app.navigate('templates');
    if (boundary === 'edit') await waitForCompletionEvent(fire('player-profile-name', 'Changed during confirmation'));
    if (boundary === 'wallet') await app.refreshConnection({ account: { address: ROOT_TWO, chains: ['sui:mainnet'] } });
    if (boundary === 'destroy') await app.destroy();
    await waitForCompletionEvent(completion);
    assert.deepEqual(approvals, [{ approved: false, aborted: true }], boundary);
    assert.doesNotMatch(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Ready for Soulidity/, boundary);
    await app.destroy();
  }
});

test('closing after confirmation suppresses late success navigation and leaves completion for explicit recovery', async () => {
  const finished = deferred();
  const harness = browserHarness({
    connection: { account: { address: `0x${'85'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
    completePlayerJourneyResult: async () => finished.promise,
  });
  const navigations = []; harness.win.location.assign = url => navigations.push(url);
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = action => { const control = new FakeTarget(harness.doc, { dataset: { action } });
    control.parent = mount; return mount.fire('click', { target: control }); };
  await waitForCompletionEvent(fire('player-complete'));
  const completion = fire('player-confirm-complete');
  await waitForCompletionState(() => harness.calls.completePlayerJourney.length, 'Expected the pending completion journey');
  assert.equal(harness.calls.completePlayerJourney.length, 1);
  await waitForCompletionEvent(fire('close-player-export'));
  finished.resolve({ status: 'HANDOFF_READY', handoffUrl: 'https://www.soulidity.ai/my-souls' });
  await waitForCompletionEvent(completion);
  assert.deepEqual(navigations, []);
  assert.doesNotMatch(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Ready for Soulidity/);
  await waitForCompletionEvent(fire('player-preview-export'));
  assert.match(mount.innerHTML, /data-action="player-download-png"[^>]*disabled/);
  app.destroy();
});

test('recovered foreign-draft Soul does not unlock the current PNG and starting another is explicit', async () => {
  const address = `0x${'85'.repeat(32)}`;
  const approvals = [];
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
    completePlayerJourneyResult: async (_input, count, options) => {
      if (count === 1) return { status: 'HANDOFF_READY', recovered: true, completedProjectHash: 'ab'.repeat(32),
        actionId: 'previous-action', soulId: ROOT_TWO, transactionDigest: 'previous-digest', handoffUrl: 'https://www.soulidity.ai/my-souls' };
      assert.equal(options.startNew, true);
      assert.deepEqual(options.newCompletionFrom, { actionId: 'previous-action', soulId: ROOT_TWO, transactionDigest: 'previous-digest' });
      const approved = await options.confirmStep({ kind: 'NEW_COMPLETION', rootId: ROOT_ONE, signer: address,
        ...options.newCompletionFrom });
      approvals.push(approved);
      return approved ? { status: 'HANDOFF_READY', actionId: 'new-action' } : { status: 'RECOVERY_REQUIRED', stage: 'NEW_COMPLETION' };
    },
  });
  const navigations = []; harness.win.location.assign = url => navigations.push(url);
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = dataset => { const control = new FakeTarget(harness.doc, { dataset }); control.parent = mount;
    return mount.fire('click', { target: control }); };
  await waitForCompletionEvent(fire({ action: 'player-complete' }));
  await waitForCompletionEvent(fire({ action: 'player-confirm-complete' }));
  assert.deepEqual(navigations, []);
  assert.match(mount.innerHTML, /data-action="player-start-new-completion"/);
  assert.match(mount.innerHTML, /data-action="player-download-png"[^>]*disabled/);
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /current draft has not been completed/);
  const completion = fire({ action: 'player-start-new-completion', completedActionId: 'previous-action' });
  const confirmationId = await waitForJourneyConfirmation(mount);
  assert.deepEqual(approvals, []);
  await waitForCompletionEvent(fire({ action: 'player-confirm-journey-step', confirmationId }));
  await waitForCompletionEvent(completion);
  assert.deepEqual(approvals, [true]);
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Ready for Soulidity/);
  app.destroy();
});

test('after starting another Soul, cancelling its next step permits ordinary same-page recovery', async () => {
  const address = `0x${'85'.repeat(32)}`;
  const starts = [];
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(), nativeCompletionConfigured: true,
    completePlayerJourneyResult: async (_input, count, options) => {
      starts.push(options.startNew);
      if (count === 1) return { status: 'HANDOFF_READY', recovered: true, actionId: 'prior-action' };
      if (count === 2) {
        assert.equal(await options.confirmStep({ kind: 'NEW_COMPLETION', rootId: ROOT_ONE, signer: address,
          actionId: 'prior-action', soulId: ROOT_TWO, transactionDigest: 'completed-test-digest' }), true);
        assert.equal(await options.confirmStep({ kind: 'STORAGE_UPLOAD', purpose: 'NATIVE_CONTENT', rootId: ROOT_ONE,
          signer: address, uploadId: 'new-upload', byteLength: 16, byteSha256: '12'.repeat(32) }), false);
      }
      return { status: 'RECOVERY_REQUIRED', stage: 'NATIVE_CONTENT' };
    },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = dataset => { const control = new FakeTarget(harness.doc, { dataset }); control.parent = mount;
    return mount.fire('click', { target: control }); };
  await waitForCompletionEvent(fire({ action: 'player-complete' }));
  await waitForCompletionEvent(fire({ action: 'player-confirm-complete' }));
  assert.match(mount.innerHTML, /data-action="player-start-new-completion"/);
  const completion = fire({ action: 'player-start-new-completion', completedActionId: 'prior-action' });
  const firstId = await waitForJourneyConfirmation(mount);
  await waitForCompletionEvent(fire({ action: 'player-confirm-journey-step', confirmationId: firstId }));
  const nextId = await waitForJourneyConfirmation(mount, firstId);
  await waitForCompletionEvent(fire({ action: 'player-cancel-journey-step', confirmationId: nextId }));
  await waitForCompletionEvent(completion);
  await waitForCompletionEvent(fire({ action: 'player-confirm-complete' }));
  assert.deepEqual(starts, [false, true, false]);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-start-new-completion"/);
  app.destroy();
});

test('the original Player controls drive profile, export and the gated completion journey while unauthoritative tools remain disabled', async (context) => {
  const address = `0x${'85'.repeat(32)}`;
  const maker = certifiedMaker();
  const cases = [
    {
      name: 'handoff ready',
      result: { status: 'HANDOFF_READY', handoffUrl: 'https://www.soulidity.ai/my-souls' },
      expected: /Ready for Soulidity/,
      state: 'ready',
    },
    {
      name: 'recovery required',
      result: { status: 'RECOVERY_REQUIRED', stage: 'RENDER_UPLOAD' },
      expected: /Recovery required at RENDER_UPLOAD/,
      state: 'blocked',
    },
    {
      name: 'completion failure',
      result: new Error('wallet rejected completion'),
      expected: /wallet rejected completion/,
      state: 'blocked',
    },
  ];

  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const harness = browserHarness({
        connection: { account: { address, chains: ['sui:mainnet'] } },
        templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
        playerSessionResult: playerSession(ROOT_ONE),
        renderPlayerPreviewResult: canonicalPreview(),
        completePlayerJourneyResult: entry.result,
        nativeCompletionConfigured: true,
      });
      const app = createOriginalProductApp(harness);
      await app.ready;
      await app.openPlayer(ROOT_ONE);
      const mount = harness.doc.getElementById('makerV4PlayerMount');

      assert.match(mount.innerHTML, /data-action="player-undo"[^>]+disabled/);
      assert.match(mount.innerHTML, /data-action="player-redo"[^>]+disabled/);
      assert.match(mount.innerHTML, /data-action="player-random"[^>]+disabled/);
      assert.match(mount.innerHTML, /data-action="player-clear"[^>]+disabled/);
      assert.match(mount.innerHTML, /data-action="player-profile-name"[^>]*\/>/);
      assert.doesNotMatch(mount.innerHTML, /data-action="player-profile-name"[^>]+disabled/);
      assert.doesNotMatch(mount.innerHTML, /data-action="player-preview-export"[^>]+disabled/);

      const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
      profile.parent = mount;
      profile.value = 'Canonical Nora';
      await waitForEvent(mount.fire('change', { target: profile }));
      const previewExport = new FakeTarget(harness.doc, { dataset: { action: 'player-preview-export' } });
      previewExport.parent = mount;
      await waitForEvent(mount.fire('click', { target: previewExport }));
      assert.match(mount.innerHTML, /id="makerPlayerExportDialog"/);
      assert.doesNotMatch(mount.innerHTML, /data-action="player-export-size"[^>]+disabled/);
      assert.doesNotMatch(mount.innerHTML, /data-action="player-export-background"[^>]+disabled/);

      const complete = new FakeTarget(harness.doc, { dataset: { action: 'player-complete' } });
      complete.parent = mount;
      await waitForEvent(mount.fire('click', { target: complete }));
      assert.equal(harness.calls.completePlayerJourney.length, 0, 'Complete OC opens the donor Export confirmation only');

      const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } });
      confirm.parent = mount;
      // A journey call starting is not its completion. Await the real event
      // handler rather than racing the asynchronous final status projection.
      await waitForEvent(mount.fire('click', { target: confirm }));

      assert.equal(harness.calls.completePlayerJourney.length, 1);
      assert.equal(harness.calls.completePlayerJourney[0].rootId, ROOT_ONE);
      assert.equal(harness.calls.completePlayerJourney[0].project.profile.name, 'Canonical Nora');
      const completion = harness.doc.getElementById('v4PlayerCompletionStatus');
      assert.match(completion.textContent, entry.expected);
      assert.equal(completion.dataset.state, entry.state);
      if (entry.result instanceof Error || entry.result.status === 'RECOVERY_REQUIRED') {
        assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
        assert.match(mount.innerHTML, /data-action="player-retry-save" hidden/);
      } else if (entry.result.status === 'HANDOFF_READY') {
        const download = new FakeTarget(harness.doc, { dataset: { action: 'player-download-png' } });
        download.parent = mount;
        mount.fire('click', { target: download });
        assert.match(harness.doc.downloads.at(-1).download, /\.png$/);
        assert.equal(harness.win.opened.length, 0);
      }
      app.destroy();
    });
  }
});

test('formal recipe autosave survives export open/close and final-render failure', async (t) => {
  for (const boundary of ['close', 'open-close', 'open']) await t.test(boundary, { timeout: 3000 }, async (t) => {
    const storageMap = new Map();
    const renderEntered = deferred(); const releaseRender = deferred();
    let holdPreview = false; let failExport = false;
    const config = {
      storageMap,
      connection: { account: { address: `0x${'89'.repeat(32)}`, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
      playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
      renderPlayerPreviewResult: () => {
        if (holdPreview) { holdPreview = false; renderEntered.resolve(); return releaseRender.promise; }
        return canonicalPreview();
      },
      renderPlayerExportResult: () => {
        if (failExport) throw new Error('final export unavailable');
        return canonicalPreview();
      },
    };
    const h = browserHarness(config); const app = createOriginalProductApp(h);
    t.after(() => { releaseRender.resolve(canonicalPreview()); app.destroy(); });
    await app.ready; await app.openPlayer(ROOT_ONE);
    const mount = h.doc.getElementById('makerV4PlayerMount');
    const fire = (action, data = {}) => {
      const target = new FakeTarget(h.doc, { dataset: { action, ...data } }); target.parent = mount;
      return mount.fire('click', { target });
    };
    await waitForEvent(fire('player-preview-export'));
    holdPreview = true; failExport = true;
    const edit = fire('player-item', { choiceId: 'base:base:alternate:alternate' });
    await renderEntered.promise;
    const opening = boundary.startsWith('open') ? fire('player-preview-export') : null;
    if (boundary !== 'open') await waitForEvent(fire('close-player-export'));
    releaseRender.resolve(canonicalPreview());
    await Promise.all([waitForEvent(edit), waitForEvent(opening)]);
    const key = [...storageMap.keys()].find(key => key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:'));
    assert.ok(key, 'recipe is durable even when export is closed or unavailable');
    const saved = JSON.parse(storageMap.get(key));
    assert.deepEqual(saved.session.recipe.selections.map(row => row.itemKey), ['default', 'alternate']);
    assert.equal(saved.session.render, null, 'main preview is not a certified final export');
    assert.equal(saved.projectHash, await exactProjectHash(saved.session));
    assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
    if (boundary !== 'open') assert.doesNotMatch(mount.innerHTML, /id="makerPlayerExportDialog"/);
    await waitForEvent(fire('player-download-png'));
    assert.equal(h.doc.downloads.length, 0, 'durability does not grant download/completion permission');
    app.destroy(); failExport = false;
    const cold = browserHarness(config); const reopened = createOriginalProductApp(cold);
    t.after(() => reopened.destroy());
    await reopened.ready; await reopened.openPlayer(ROOT_ONE);
    assert.match(cold.doc.getElementById('makerV4PlayerMount').innerHTML,
      /class="v4-player-item active"[^>]+data-choice-id="base:base:alternate:alternate"/);
    assert.equal(cold.calls.completePlayerJourney.length, 0);
  });
});

test('formal export options persist the selected final image, keep main preview unchanged and revoke old completion download', async () => {
  const address = `0x${'89'.repeat(32)}`;
  const storageMap = new Map();
  const session = structuredClone(playerSession(ROOT_ONE));
  session.player.document.canvas.width = 1080; session.player.document.canvas.height = 1920;
  let completionHash = null;
  const config = { storageMap,
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: session, nativeCompletionConfigured: true,
    renderPlayerPreviewResult: canonicalPreview({ width: 1080, height: 1920, sha256: '10'.repeat(32) }),
    renderPlayerExportResult: ({ exportOptions }) => canonicalPreview({
      width: exportOptions.sizeMode === 'standard' ? 576 : 1080,
      height: exportOptions.sizeMode === 'standard' ? 1024 : 1920,
      sha256: (exportOptions.transparent ? '20' : '30').repeat(32),
    }),
    completePlayerJourneyResult: async input => {
      completionHash ??= await exactProjectHash(input.project);
      return { status: 'HANDOFF_READY', recovered: true, completedProjectHash: completionHash };
    },
  };
  const h = browserHarness(config); const app = createOriginalProductApp(h);
  await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = h.doc.getElementById('makerV4PlayerMount');
  const fire = async (action, data = {}) => {
    const target = new FakeTarget(h.doc, { dataset: { action, ...data } }); target.parent = mount;
    await waitForEvent(mount.fire('click', { target }));
  };
  const durable = () => JSON.parse([...storageMap.entries()].find(([key]) => key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:'))[1]);
  await fire('player-preview-export');
  assert.match(mount.innerHTML, /576.*1024/);
  await fire('player-export-background', { transparent: 'true' });
  await fire('player-export-size', { sizeMode: 'original' });
  let saved = durable();
  assert.deepEqual(saved.session.imageExport, { sizeMode: 'original', transparent: true });
  assert.deepEqual([saved.session.render.width, saved.session.render.height, saved.session.render.sha256], [1080, 1920, '20'.repeat(32)]);
  assert.equal(h.calls.renderPlayerPreview.length, 1, 'export choices do not redraw the main preview');
  assert.deepEqual(h.doc.getElementById('makerV4PlayerCanvas').draws.at(-1), ['draw', 0, 0, 1080, 1920]);
  assert.equal(h.calls.completePlayerJourney.length, 0, 'selecting export options never incurs completion costs');
  await fire('player-download-png'); assert.equal(h.doc.downloads.length, 0);
  await fire('player-confirm-complete');
  assert.deepEqual(h.calls.completePlayerJourney[0].project.imageExport, saved.session.imageExport);
  assert.deepEqual(h.calls.completePlayerJourney[0].render, saved.session.render);
  await fire('player-download-png'); assert.equal(h.doc.downloads.length, 1);
  await fire('close-player-export'); await fire('player-preview-export');
  await fire('player-download-png'); assert.equal(h.doc.downloads.length, 2, 'identical rerender retains exact completed proof');
  await fire('player-export-background', { transparent: 'false' });
  await fire('player-download-png'); assert.equal(h.doc.downloads.length, 2, 'old completed image does not authorize a different image');
  await fire('player-confirm-complete');
  await fire('player-download-png'); assert.equal(h.doc.downloads.length, 2, 'recovering prior completion cannot certify new pixels');
  saved = durable(); assert.deepEqual(saved.session.imageExport, { sizeMode: 'original', transparent: false });
  assert.equal(saved.session.render.sha256, '30'.repeat(32));
  app.destroy();
  const cold = browserHarness(config); const reopened = createOriginalProductApp(cold);
  await reopened.ready; await reopened.openPlayer(ROOT_ONE);
  assert.deepEqual(cold.calls.renderPlayerExport[0].exportOptions, saved.session.imageExport);
  assert.equal(cold.calls.completePlayerJourney.length, 0, 'cold restoration never starts another completion');
  reopened.destroy();
});

test('formal export ignores late success and errors after close/reopen and keeps the newer image', async (t) => {
  for (const outcome of ['success', 'failure']) await t.test(outcome, async () => {
    const deferredRender = deferred(); let hold = false;
    const h = browserHarness({
      connection: { account: { address: `0x${'89'.repeat(32)}`, chains: ['sui:mainnet'] } },
      templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
      playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(),
      renderPlayerExportResult: () => {
        if (hold) { hold = false; return deferredRender.promise; }
        return canonicalPreview();
      },
    });
    const app = createOriginalProductApp(h); await app.ready; await app.openPlayer(ROOT_ONE);
    const mount = h.doc.getElementById('makerV4PlayerMount');
    const fire = action => { const target = new FakeTarget(h.doc, { dataset: { action } }); target.parent = mount; return mount.fire('click', { target }); };
    hold = true; const old = fire('player-preview-export'); await settle();
    await waitForEvent(fire('close-player-export'));
    await waitForEvent(fire('player-preview-export'));
    const currentUrl = mount.innerHTML.match(/class="v4-player-export-image[^"]*"><img src="([^"]+)"/)[1];
    if (outcome === 'success') deferredRender.resolve(canonicalPreview({ sha256: 'ab'.repeat(32) }));
    else deferredRender.reject(new Error('obsolete render failed'));
    await waitForEvent(old);
    assert.match(mount.innerHTML, /data-state="ready"/);
    assert.doesNotMatch(mount.innerHTML, /obsolete render failed/);
    assert.ok(mount.innerHTML.includes(currentUrl));
    assert.equal(h.win.objectUrls.revoked.includes(currentUrl), false);
    app.destroy(); assert.equal(h.win.objectUrls.revoked.includes(currentUrl), true);
  });
});

test('completion recovery and chain failures preserve the durable-save state without a no-op retry', async (context) => {
  const maker = certifiedMaker();
  const cases = [
    {
      name: 'recovery required',
      result: { status: 'RECOVERY_REQUIRED', stage: 'FINALITY' },
      expected: /Recovery required at FINALITY/,
    },
    {
      name: 'chain failure',
      error: new Error('chain effects rejected'),
      expected: /chain effects rejected/,
    },
  ];

  for (const [index, entry] of cases.entries()) {
    await context.test(entry.name, async () => {
      const address = `0x${String(90 + index).repeat(32)}`;
      const completionEntered = deferred();
      const releaseCompletion = deferred();
      let durableProjectWrites = 0;
      const harness = browserHarness({
        connection: { account: { address, chains: ['sui:mainnet'] } },
        templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
        playerSessionResult: playerSession(ROOT_ONE),
        renderPlayerPreviewResult: canonicalPreview(),
        completePlayerJourneyResult: async () => {
          completionEntered.resolve();
          await releaseCompletion.promise;
          if (entry.error) throw entry.error;
          return entry.result;
        },
        nativeCompletionConfigured: true,
      });
      const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
      harness.win.localStorage.setItem = (key, value) => {
        const result = setItem(key, value);
        if (key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')) {
          durableProjectWrites += 1;
        }
        return result;
      };

      const app = createOriginalProductApp(harness);
      await app.ready;
      await app.openPlayer(ROOT_ONE);
      const mount = harness.doc.getElementById('makerV4PlayerMount');
      const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } });
      confirm.parent = mount;
      const completionEvent = mount.fire('click', { target: confirm });
      await completionEntered.promise;
      assert.equal(durableProjectWrites, 1, 'completion starts only after the exact project is durable');

      releaseCompletion.resolve();
      await waitForEvent(completionEvent);
      assert.match(
        harness.doc.getElementById('v4PlayerCompletionStatus').textContent,
        entry.expected,
      );
      assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
      const saveStatus = mount.innerHTML.match(/id="v4PlayerSaveStatus"[^>]*>([^<]*)</)?.[1] || '';
      assert.doesNotMatch(saveStatus, entry.expected);
      assert.match(mount.innerHTML, /data-action="player-retry-save" hidden/);

      const writesBeforeRetry = durableProjectWrites;
      const retry = new FakeTarget(harness.doc, { dataset: { action: 'player-retry-save' } });
      retry.parent = mount;
      await waitForEvent(mount.fire('click', { target: retry }));
      assert.equal(durableProjectWrites, writesBeforeRetry, 'no pending save means no retry write');
      app.destroy();
    });
  }
});

test('actual production app factory composes Native capability without mint, storage or popup work', async () => {
  const config = { window: {} }; runInNewContext(deploymentConfigSource, config);
  const runtime = JSON.parse(JSON.stringify(config.window.SoulidityMakerV8));
  for (const enabled of [true, false]) {
    const h = browserHarness(); let costs = 0;
    const forbidden = () => { costs++; throw new Error('unexpected paid or popup operation'); };
    const wallet = { async getCurrentAccount() { return null; }, async reconnect() { return null; }, subscribe() { return () => {}; }, dispose() {} };
    const compiler = Object.fromEntries(['loadTrustedContext', 'assertContextFresh', 'recoverStage', 'recoverCheckpoint'].map(key => [key, forbidden]));
    const walrus = { publisher: Object.fromEntries(['prepare', 'load', 'resume', 'requestSignature', 'loadContent'].map(key => [key, forbidden])),
      persistence: { load: forbidden, requirePersistentStorage: forbidden } };
    h.win.crypto = crypto; h.win.indexedDB = new IDBFactory();
    h.win.navigator.locks = { request: forbidden }; h.win.open = forbidden;
    const client = { async getChainIdentifier() { throw new Error('Read-only bootstrap unavailable in fixture'); },
      getObject: forbidden, core: { getObject: forbidden } };
    const app = await createProductionAnimacraftApp({ root: { querySelector() { return {}; } }, doc: h.doc, win: h.win,
      runtime, execution: { schemaVersion: 'animacraft.web-execution.v8', network: 'mainnet', chainIdentifier: '35834a8a',
        allowWalletSignature: enabled, allowBroadcast: enabled }, client, walletUi: h.walletUi,
      browserAdapters: { wallet, compiler, rpc: {} }, indexedDB: h.win.indexedDB,
      controllers: { publication: {}, publicationAdapters: {}, publicationTransport: {}, walrus } });
    await app.ready.catch(() => {});
    assert.equal(app.playerJourney.isNativeCompletionConfigured(), true);
    assert.equal(app.bridge.getState().capabilities.nativeCompletionConfigured, enabled);
    assert.equal(costs, 0);
    app.dispose(); await settle();
    assert.equal(app.playerJourney.isNativeCompletionConfigured(), false);
    assert.equal(costs, 0);
  }
});

test('production Native service through real journey and bridge enables only configured Player UI', async () => {
  const config = { window: {} }; runInNewContext(deploymentConfigSource, config);
  let effects = 0;
  const forbidden = () => { effects++; throw new Error('No preflight, storage, popup or signature during configuration'); };
  const methods = names => Object.fromEntries(names.map(name => [name, forbidden]));
  const walrus = { publisher: methods(['prepare', 'load', 'resume', 'requestSignature', 'loadContent']),
    persistence: methods(['load', 'requirePersistentStorage']) };
  const provider = createProductionMakerV8NativeContentV8({ runtime: JSON.parse(JSON.stringify(config.window.SoulidityMakerV8)),
    client: { getObject: forbidden, core: { getObject: forbidden } },
    wallet: { getCurrentAccount: forbidden }, walrus, indexedDB: new IDBFactory(),
    win: { crypto, navigator: { locks: { request: forbidden } } },
    receiver: methods(['open', 'preflight', 'sync', 'dispose']) });
  const journey = createMakerV8PlayerJourneyV8({ nativeContent: provider, walrus,
    player: methods(['getSnapshot', 'loadPlayer', 'setRecipe', 'preparePlayerAction', 'executePlayerAction', 'recoverPlayerAction']),
    productRuntime: { inventory: { load: forbidden } } });
  const bridgeFor = execution => createMakerV8ProductBridge({ execution, playerJourney: journey,
    productRuntime: { ready: forbidden, catalog: methods(['loadPlaza', 'loadPlayer']), wallet: methods(['getCurrentAccount', 'reconnect']) },
    drafts: methods(['createBundle', 'load', 'list', 'compareAndSwap', 'export']) });
  const enabled = { allowWalletSignature: true, allowBroadcast: true };
  const bridge = bridgeFor(enabled);
  assert.equal(bridge.getState().capabilities.nativeCompletionConfigured, true);
  assert.equal(bridgeFor({}).getState().capabilities.nativeCompletionConfigured, false);
  assert.equal(effects, 0);
  const harness = browserHarness({
    connection: { account: { address: `0x${'88'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(),
    nativeCompletionConfigured: bridge.getState().capabilities.nativeCompletionConfigured,
    completePlayerJourneyResult: { status: 'HANDOFF_READY' },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  assert.doesNotMatch(mount.innerHTML, /Native completion service is not configured/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-complete"[^>]+disabled/);
  assert.equal(effects, 0);
  app.destroy();
  // Dispose is itself allowed here; it must invalidate the live configuration projection.
  await assert.rejects(provider.dispose(), /No preflight/);
  assert.equal(bridge.getState().capabilities.nativeCompletionConfigured, false);
});

test('Player completion fails closed when the Native completion service is not configured', async () => {
  const address = `0x${'88'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    completePlayerJourneyResult: { status: 'HANDOFF_READY' },
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  assert.match(mount.innerHTML, /data-action="player-complete"[^>]+disabled/);
  assert.match(mount.innerHTML, /Native completion service is not configured/);
  const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } });
  confirm.parent = mount;
  await waitForEvent(mount.fire('click', { target: confirm }));
  assert.equal(harness.calls.completePlayerJourney.length, 0);
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Native completion service is not configured/);
  app.destroy();
});

test('receiver preflight rejection remains visible but allows the same saved project to retry through the enabled confirmation', async () => {
  let ready = false;
  const attempts = [];
  const harness = browserHarness({
    connection: { account: { address: `0x${'89'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(),
    nativeCompletionConfigured: true,
    completePlayerJourneyResult: async (_input, _count, options) => {
      attempts.push(options);
      if (!ready) throw Object.assign(new Error('Sign in to the same wallet in Soulidity, then retry.'), { code: 'MAKER_V8_NATIVE_RECEIVER_NOT_READY' });
      return { status: 'RECOVERY_REQUIRED', stage: 'FINALITY', message: 'Recover the existing signed transaction.' };
    },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const fire = async action => {
    const target = new FakeTarget(harness.doc, { dataset: { action } }); target.parent = mount;
    await waitForEvent(mount.fire('click', { target }));
  };
  await fire('player-complete');
  await fire('player-confirm-complete');
  assert.equal(harness.calls.completePlayerJourney.length, 1);
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Sign in to the same wallet/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-confirm-complete"[^>]*disabled/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-complete"[^>]*disabled/);
  ready = true;
  await fire('close-player-export');
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Sign in to the same wallet/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-complete"[^>]*disabled/);
  await fire('player-complete');
  await fire('player-confirm-complete');
  assert.equal(harness.calls.completePlayerJourney.length, 2);
  assert.deepEqual(harness.calls.completePlayerJourney[1], harness.calls.completePlayerJourney[0]);
  assert.equal(attempts[1].startNew, false);
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /existing signed transaction/);
  assert.doesNotMatch(mount.innerHTML, /data-action="player-confirm-complete"[^>]*disabled/);
  await fire('player-confirm-complete');
  assert.equal(harness.calls.completePlayerJourney.length, 3);
  assert.deepEqual(harness.calls.completePlayerJourney[2], harness.calls.completePlayerJourney[0]);
  assert.equal(attempts[2].startNew, false, 'signed recovery must never request a new Soul');
  app.destroy();
});

test('blocked reception popup stops completion before costs and permits retry in the original confirmation', async () => {
  let blocked = true;
  const harness = browserHarness({
    connection: { account: { address: `0x${'89'.repeat(32)}`, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [certifiedMaker()], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE), renderPlayerPreviewResult: canonicalPreview(),
    completePlayerJourneyResult: { status: 'HANDOFF_READY' }, nativeCompletionConfigured: true,
    openPlayerReception() { if (blocked) throw new Error('Allow the Soulidity account window, then retry.'); },
  });
  const app = createOriginalProductApp(harness); await app.ready; await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const complete = new FakeTarget(harness.doc, { dataset: { action: 'player-complete' } }); complete.parent = mount;
  await waitForEvent(mount.fire('click', { target: complete }));
  const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } }); confirm.parent = mount;
  await waitForEvent(mount.fire('click', { target: confirm }));
  assert.equal(harness.calls.completePlayerJourney.length, 0);
  assert.match(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Allow the Soulidity account window/);
  blocked = false;
  await waitForEvent(mount.fire('click', { target: confirm }));
  assert.equal(harness.calls.completePlayerJourney.length, 1);
  app.destroy();
});

test('Player completion is single-flight and an edit invalidates the frozen project before late completion returns', async () => {
  const address = `0x${'89'.repeat(32)}`;
  const maker = certifiedMaker();
  const completion = deferred();
  const completionEntered = deferred();
  const receptions = [];
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    completePlayerJourneyResult: () => {
      completionEntered.resolve();
      return completion.promise;
    },
    openPlayerReception: input => receptions.push(input),
    nativeCompletionConfigured: true,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const complete = new FakeTarget(harness.doc, { dataset: { action: 'player-complete' } });
  complete.parent = mount;
  await waitForEvent(mount.fire('click', { target: complete }));
  assert.equal(harness.calls.completePlayerJourney.length, 0, 'the first donor action opens Export only');
  assert.deepEqual(receptions, [], 'Opening Export must not open the account popup');
  const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } });
  confirm.parent = mount;
  const firstConfirmation = mount.fire('click', { target: confirm });
  assert.deepEqual(receptions, [{ rootId: ROOT_ONE }], 'Reception opens synchronously before user activation expires');
  const duplicateConfirmation = mount.fire('click', { target: confirm });
  assert.equal(receptions.length, 1, 'Double confirmation shares one account popup flight');
  // Hashing and durable project save precede bridge entry. Event-loop turn
  // counts do not establish that boundary, especially on a busy CI worker.
  await completionEntered.promise;
  assert.equal(harness.calls.completePlayerJourney.length, 1, 'double confirmation shares one exact flight');
  assert.match(harness.calls.completePlayerJourney[0].projectHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    harness.calls.completePlayerJourney[0].recipe,
    harness.calls.completePlayerJourney[0].project.recipe,
  );
  assert.deepEqual(
    harness.calls.completePlayerJourney[0].loadout,
    harness.calls.completePlayerJourney[0].project.loadout,
  );
  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  profile.parent = mount;
  profile.value = 'New project B';
  await waitForEvent(mount.fire('change', { target: profile }));
  assert.doesNotMatch(mount.innerHTML, /Preview ready/);
  completion.resolve({ status: 'HANDOFF_READY', handoffUrl: '' });
  await Promise.all([waitForEvent(firstConfirmation), waitForEvent(duplicateConfirmation)]);
  assert.equal(harness.calls.completePlayerJourney.length, 1);
  assert.doesNotMatch(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Ready for Soulidity/);
  assert.match(mount.innerHTML, /data-action="player-download-png"[^>]+disabled/);
  app.destroy();
});

test('an irreversible completion stays globally single-flight after an edit and canonical re-render', async () => {
  const address = `0x${'8e'.repeat(32)}`;
  const maker = certifiedMaker();
  const completionEntered = deferred();
  const releaseCompletion = deferred();
  const rerenderEntered = deferred();
  const releaseRerender = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: (_rootId, call) => {
      if (call === 1) return canonicalPreview();
      rerenderEntered.resolve();
      return releaseRerender.promise;
    },
    completePlayerJourneyResult: async () => {
      completionEntered.resolve();
      await releaseCompletion.promise;
      return { status: 'HANDOFF_READY', handoffUrl: '' };
    },
    nativeCompletionConfigured: true,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } });
  confirm.parent = mount;
  const firstConfirmation = mount.fire('click', { target: confirm });
  await completionEntered.promise;
  assert.equal(harness.calls.completePlayerJourney.length, 1);

  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-world' } });
  profile.parent = mount;
  profile.value = 'A newer generation';
  mount.fire('change', { target: profile });
  const preview = new FakeTarget(harness.doc, { dataset: { action: 'player-preview-export' } });
  preview.parent = mount;
  const previewEvent = mount.fire('click', { target: preview });
  await rerenderEntered.promise;
  releaseRerender.resolve(canonicalPreview({ width: 777, height: 777, sha256: '7e'.repeat(32) }));
  await waitForEvent(previewEvent);

  const secondConfirmation = mount.fire('click', { target: confirm });
  const thirdConfirmation = mount.fire('click', { target: confirm });
  releaseCompletion.resolve();
  await Promise.all([
    waitForEvent(firstConfirmation),
    waitForEvent(secondConfirmation),
    waitForEvent(thirdConfirmation),
  ]);

  assert.equal(
    harness.calls.completePlayerJourney.length,
    1,
    'all confirmations share the pending irreversible flight across generations',
  );
  assert.doesNotMatch(
    harness.doc.getElementById('v4PlayerCompletionStatus').textContent,
    /Ready for Soulidity/,
    'the completed older flight is not projected onto the current generation',
  );
  app.destroy();
});

test('late completion for Player A cannot mark newly opened Player B complete', async () => {
  const address = `0x${'8c'.repeat(32)}`;
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'Maker A' });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Maker B' });
  const completion = deferred();
  const completionEntered = deferred();
  const digestEntered = deferred();
  const releaseDigest = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [first, second], diagnostics: [] },
    playerSessionResult: (rootId) => playerSession(rootId, rootId === ROOT_ONE ? 'Maker A' : 'Maker B'),
    renderPlayerPreviewResult: canonicalPreview(),
    completePlayerJourneyResult: () => {
      completionEntered.resolve();
      return completion.promise;
    },
    nativeCompletionConfigured: true,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const complete = new FakeTarget(harness.doc, { dataset: { action: 'player-complete' } });
  complete.parent = mount;
  await waitForEvent(mount.fire('click', { target: complete }));
  // Hold the real project digest before bridge entry. This deliberately
  // reproduces CI preparation spanning more than the former eight flushes.
  const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let holdDigest = true;
  harness.win.crypto = { subtle: { async digest(...args) {
    if (holdDigest) {
      holdDigest = false;
      digestEntered.resolve();
      await releaseDigest.promise;
    }
    return nativeDigest(...args);
  } } };
  const confirm = new FakeTarget(harness.doc, { dataset: { action: 'player-confirm-complete' } });
  confirm.parent = mount;
  const firstConfirmation = mount.fire('click', { target: confirm });
  await digestEntered.promise;
  for (let index = 0; index < 8; index += 1) await settle();
  assert.equal(harness.calls.completePlayerJourney.length, 0,
    'event-loop turns cannot finish an unresolved project digest');
  releaseDigest.resolve();
  await completionEntered.promise;
  assert.equal(harness.calls.completePlayerJourney.length, 1);
  assert.equal(harness.calls.completePlayerJourney[0].rootId, ROOT_ONE);
  await app.openPlayer(ROOT_TWO);
  completion.resolve({ status: 'HANDOFF_READY', handoffUrl: '' });
  await waitForEvent(firstConfirmation);
  assert.equal(app.getState().playerRootId, ROOT_TWO);
  assert.match(mount.innerHTML, /Maker B/);
  assert.doesNotMatch(harness.doc.getElementById('v4PlayerCompletionStatus').textContent, /Ready for Soulidity/);
  const completeB = new FakeTarget(harness.doc, { dataset: { action: 'player-complete' } });
  completeB.parent = mount;
  await waitForEvent(mount.fire('click', { target: completeB }));
  assert.equal(harness.calls.completePlayerJourney.length, 1,
    'opening Player B Export must not start another completion');
  assert.match(mount.innerHTML, /data-action="player-download-png"[^>]+disabled/);
  app.destroy();
});

test('queued Player A saves retain their exact owner while a pending digest is fenced by opening Player B', async () => {
  const address = `0x${'8f'.repeat(32)}`;
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'Maker A' });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Maker B' });
  const storageMap = new Map();
  const digestEntered = deferred();
  const releaseDigest = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [first, second], diagnostics: [] },
    playerSessionResult: (rootId) => playerSession(rootId, rootId === ROOT_ONE ? 'Maker A' : 'Maker B'),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let holdFirstDigest = true;
  harness.win.crypto = {
    subtle: {
      async digest(...args) {
        if (holdFirstDigest) {
          holdFirstDigest = false;
          digestEntered.resolve();
          await releaseDigest.promise;
        }
        return nativeDigest(...args);
      },
    },
  };
  const projectWrites = [];
  const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
  harness.win.localStorage.setItem = (key, value) => {
    if (key.startsWith('animacraft:maker-v8-player-project:v1:')) {
      projectWrites.push({ key, value: String(value) });
    }
    return setItem(key, value);
  };

  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const firstEdit = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  firstEdit.parent = mount;
  firstEdit.value = 'Queued A1';
  const firstEvent = mount.fire('change', { target: firstEdit });
  await digestEntered.promise;
  const secondEdit = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-world' } });
  secondEdit.parent = mount;
  secondEdit.value = 'Queued A2';
  const secondEvent = mount.fire('change', { target: secondEdit });

  await app.openPlayer(ROOT_TWO);
  releaseDigest.resolve();
  await Promise.all([waitForEvent(firstEvent), waitForEvent(secondEvent)]);
  assert.deepEqual(projectWrites, [], 'stale A work writes neither an A WAL nor B durable state');
  assert.equal(
    [...storageMap.keys()].filter((key) => key.startsWith('animacraft:maker-v8-player-project:v1:')).length,
    0,
  );
  assert.equal(app.getState().playerRootId, ROOT_TWO);

  const bEdit = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  bEdit.parent = mount;
  bEdit.value = 'B owns this save';
  await waitForEvent(mount.fire('change', { target: bEdit }));
  const bMain = projectWrites.find((entry) => !entry.key.includes(':wal:'));
  assert.equal(JSON.parse(bMain.value).rootId, ROOT_TWO);
  assert.equal(JSON.parse(bMain.value).session.profile.name, 'B owns this save');
  assert.equal(projectWrites.some((entry) => entry.key.includes(ROOT_ONE)), false);
  app.destroy();
});

test('a main-written Player revision is acknowledged across generation drift before the latest rendered project saves', async () => {
  const address = `0x${'7a'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const readbackHashEntered = deferred();
  const releaseReadbackHash = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSessionWithAlternate(ROOT_ONE),
    renderPlayerPreviewResult: (_rootId, call) => canonicalPreview({
      width: 700 + call,
      height: 700 + call,
      sha256: String(call).padStart(2, '0').repeat(32),
    }),
    storageMap,
  });
  const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let deferNextDigest = false;
  harness.win.crypto = {
    subtle: {
      async digest(...args) {
        if (deferNextDigest) {
          deferNextDigest = false;
          readbackHashEntered.resolve();
          await releaseReadbackHash.promise;
        }
        return nativeDigest(...args);
      },
    },
  };
  const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
  let armedReadbackHash = false;
  harness.win.localStorage.setItem = (key, value) => {
    const result = setItem(key, value);
    if (!armedReadbackHash
      && key.startsWith('animacraft:maker-v8-player-project:v1:')
      && !key.includes(':wal:')) {
      armedReadbackHash = true;
      deferNextDigest = true;
    }
    return result;
  };

  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const alternate = new FakeTarget(harness.doc, {
    dataset: { action: 'player-item', choiceId: 'base:base:alternate:alternate' },
  });
  alternate.parent = mount;
  const recipeEvent = mount.fire('click', { target: alternate });
  await readbackHashEntered.promise;

  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  profile.parent = mount;
  profile.value = 'Latest generation Nora';
  const profileEvent = mount.fire('change', { target: profile });
  releaseReadbackHash.resolve();
  await Promise.all([waitForEvent(recipeEvent), waitForEvent(profileEvent)]);

  const projectKey = [...storageMap.keys()].find((key) => (
    key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
  ));
  const durable = JSON.parse(storageMap.get(projectKey));
  assert.equal(durable.revision, 2, 'the latest generation continues from the acknowledged main write');
  assert.equal(durable.baseRevision, 1);
  assert.equal(durable.session.profile.name, 'Latest generation Nora');
  assert.deepEqual(
    durable.session.recipe.selections.map((selection) => selection.itemKey),
    ['default', 'alternate'],
  );
  assert.equal(durable.session.render, null, 'autosave does not confuse canonical preview with final export');
  assert.equal(durable.projectHash, await exactProjectHash(durable.session));
  assert.equal([...storageMap.keys()].some((key) => key.includes(':wal:')), false);
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);
  assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
  app.destroy();
});

test('a main-written Player A readback can finish after opening B without acknowledging or projecting into B', async () => {
  const address = `0x${'7b'.repeat(32)}`;
  const first = certifiedMaker({ rootId: ROOT_ONE, title: 'Maker A' });
  const second = certifiedMaker({ rootId: ROOT_TWO, title: 'Maker B' });
  const storageMap = new Map();
  const readbackHashEntered = deferred();
  const releaseReadbackHash = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [first, second], diagnostics: [] },
    playerSessionResult: (rootId) => playerSession(rootId, rootId === ROOT_ONE ? 'Maker A' : 'Maker B'),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let deferNextDigest = false;
  harness.win.crypto = {
    subtle: {
      async digest(...args) {
        if (deferNextDigest) {
          deferNextDigest = false;
          readbackHashEntered.resolve();
          await releaseReadbackHash.promise;
        }
        return nativeDigest(...args);
      },
    },
  };
  const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
  let armedReadbackHash = false;
  harness.win.localStorage.setItem = (key, value) => {
    const result = setItem(key, value);
    if (!armedReadbackHash
      && key.startsWith('animacraft:maker-v8-player-project:v1:')
      && !key.includes(':wal:')) {
      armedReadbackHash = true;
      deferNextDigest = true;
    }
    return result;
  };

  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const editA = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  editA.parent = mount;
  editA.value = 'Durable Player A';
  const eventA = mount.fire('change', { target: editA });
  await readbackHashEntered.promise;

  await app.openPlayer(ROOT_TWO);
  releaseReadbackHash.resolve();
  await waitForEvent(eventA);
  assert.equal(app.getState().playerRootId, ROOT_TWO);
  assert.match(mount.innerHTML, /Maker B/);
  assert.doesNotMatch(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
  const aMainKey = [...storageMap.keys()].find((key) => key.includes(ROOT_ONE) && !key.includes(':wal:'));
  assert.equal(JSON.parse(storageMap.get(aMainKey)).session.profile.name, 'Durable Player A');
  assert.equal([...storageMap.keys()].some((key) => key.includes(ROOT_ONE) && key.includes(':wal:')), false);
  assert.equal([...storageMap.keys()].some((key) => key.includes(ROOT_TWO)), false);

  const editB = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  editB.parent = mount;
  editB.value = 'Durable Player B';
  await waitForEvent(mount.fire('change', { target: editB }));
  const bMainKey = [...storageMap.keys()].find((key) => key.includes(ROOT_TWO) && !key.includes(':wal:'));
  const durableB = JSON.parse(storageMap.get(bMainKey));
  assert.equal(durableB.revision, 1, 'Player B starts from its own empty acknowledged base');
  assert.equal(durableB.session.profile.name, 'Durable Player B');
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);
  app.destroy();
});

test('Player projects save and restore by exact wallet/Root commitment, expose CAS recovery, and download through donor actions', async () => {
  const address = `0x${'8a'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const firstHarness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const firstApp = createOriginalProductApp(firstHarness);
  await firstApp.ready;
  await firstApp.openPlayer(ROOT_ONE);
  const firstMount = firstHarness.doc.getElementById('makerV4PlayerMount');
  const profile = new FakeTarget(firstHarness.doc, { dataset: { action: 'player-profile-name' } });
  profile.parent = firstMount;
  profile.value = 'Persisted Nora';
  await waitForEvent(firstMount.fire('change', { target: profile }));
  const projectKey = [...storageMap.keys()].find((key) => (
    key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
  ));
  assert.ok(projectKey);
  const stored = JSON.parse(storageMap.get(projectKey));
  assert.equal(stored.session.profile.name, 'Persisted Nora');
  assert.match(stored.projectHash, /^[0-9a-f]{64}$/);
  firstApp.destroy();

  const secondHarness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const secondApp = createOriginalProductApp(secondHarness);
  await secondApp.ready;
  await secondApp.openPlayer(ROOT_ONE);
  const secondMount = secondHarness.doc.getElementById('makerV4PlayerMount');
  assert.match(secondMount.innerHTML, /value="Persisted Nora"[^>]+data-action="player-profile-name"/);

  const exportRecipe = new FakeTarget(secondHarness.doc, { dataset: { action: 'player-export' } });
  exportRecipe.parent = secondMount;
  await waitForEvent(secondMount.fire('click', { target: exportRecipe }));
  assert.match(secondHarness.doc.downloads.at(-1).download, /-recipe\.json$/);
  assert.equal(secondHarness.win.opened.length, 0);

  const foreign = JSON.parse(storageMap.get(projectKey));
  foreign.baseRevision = foreign.revision;
  foreign.revision += 1;
  foreign.writerId = 'foreign-tab';
  storageMap.set(projectKey, JSON.stringify(foreign));
  const conflictedProfile = new FakeTarget(secondHarness.doc, { dataset: { action: 'player-profile-world' } });
  conflictedProfile.parent = secondMount;
  conflictedProfile.value = 'Conflicted World';
  await waitForEvent(secondMount.fire('change', { target: conflictedProfile }));
  assert.match(secondMount.innerHTML, /class="v4-player-recovery"/);
  assert.match(
    secondHarness.doc.getElementById('v4PlayerCompletionStatus').textContent,
    /Another tab saved a different Player project revision/,
  );
  const recoveryBranchIds = [...secondMount.innerHTML.matchAll(
    /data-action="player-select-recovery" data-writer-id="([^"]+)"/g,
  )].map((match) => match[1]);
  assert.equal(recoveryBranchIds.length, 2);
  const exportRecovery = new FakeTarget(secondHarness.doc, { dataset: { action: 'player-export-recovery' } });
  exportRecovery.parent = secondMount;
  await waitForEvent(secondMount.fire('click', { target: exportRecovery }));
  assert.equal(secondHarness.doc.downloads.at(-1).download, 'animacraft-player-recovery.json');
  const recoveryDownload = secondHarness.win.objectUrls.created.at(-1).blob;
  assert.match(await recoveryDownload.text(), /"branches": \[/);

  const localBranchId = recoveryBranchIds.find((branchId) => !branchId.startsWith('foreign-tab:'));
  const selectRecovery = new FakeTarget(secondHarness.doc, {
    dataset: { action: 'player-select-recovery', writerId: localBranchId },
  });
  selectRecovery.parent = secondMount;
  await waitForEvent(secondMount.fire('click', { target: selectRecovery }));
  assert.match(secondMount.innerHTML, /value="Conflicted World"[^>]+data-action="player-profile-world"/);
  const retryRecovery = new FakeTarget(secondHarness.doc, { dataset: { action: 'player-retry-save' } });
  retryRecovery.parent = secondMount;
  await waitForEvent(secondMount.fire('click', { target: retryRecovery }));
  const recovered = JSON.parse(storageMap.get(projectKey));
  assert.equal(recovered.session.profile.world, 'Conflicted World');
  assert.doesNotMatch(secondMount.innerHTML, /class="v4-player-recovery"/);
  secondApp.destroy();
});

test('a different writer with different content at the acknowledged revision fails closed into Player recovery', async () => {
  const address = `0x${'8d'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const baseSaved = deferred();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const setItem = harness.win.localStorage.setItem.bind(harness.win.localStorage);
  harness.win.localStorage.setItem = (key, value) => {
    const result = setItem(key, value);
    if (key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')) {
      const record = JSON.parse(String(value));
      if (record.session.profile.name === 'Local branch') baseSaved.resolve({ key, record });
    }
    return result;
  };

  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  profile.parent = mount;
  profile.value = 'Local branch';
  const profileEdit = waitForEvent(mount.fire('change', { target: profile }));
  const { key: projectKey, record: local } = await baseSaved.promise;
  await profileEdit;

  const foreign = structuredClone(local);
  foreign.writerId = 'foreign-same-revision';
  foreign.updatedAt += 1;
  foreign.session.profile.world = 'Forked at the same revision';
  foreign.projectHash = await exactProjectHash(foreign.session);
  assert.equal(foreign.revision, local.revision, 'the counterexample is a same-revision branch');
  assert.notEqual(foreign.projectHash, local.projectHash, 'its exact effective content differs');
  const serialized = JSON.stringify(foreign);
  storageMap.set(projectKey, serialized);
  const storageEvent = harness.win.fire('storage', {
    key: projectKey,
    oldValue: JSON.stringify(local),
    newValue: serialized,
  });
  await waitForEvent(storageEvent);

  assert.match(mount.innerHTML, /class="v4-player-recovery"/);
  assert.match(
    harness.doc.getElementById('v4PlayerCompletionStatus').textContent,
    /Another tab saved a different Player project revision/,
  );
  assert.match(
    mount.innerHTML,
    new RegExp(`data-writer-id="${foreign.writerId}:${foreign.revision}:${foreign.projectHash}"`),
  );
  assert.match(mount.innerHTML, /data-action="player-retry-save" hidden/);

  const blockedEdit = new FakeTarget(harness.doc, {
    dataset: { action: 'player-profile-description' },
  });
  blockedEdit.parent = mount;
  blockedEdit.value = 'Must not overwrite the unresolved branch';
  await waitForEvent(mount.fire('change', { target: blockedEdit }));
  assert.equal(
    JSON.parse(storageMap.get(projectKey)).writerId,
    'foreign-same-revision',
    'ordinary saves remain fail-closed until one recovery branch is selected',
  );
  assert.match(mount.innerHTML, /class="v4-player-recovery"/);
  app.destroy();
});

test('Player CAS rejects unobserved same-revision forks by writer identity and exact content', async (context) => {
  const cases = [
    { name: 'different writer', writerId: 'unobserved-foreign-writer' },
    { name: 'same writer with different content', writerId: null },
  ];
  for (const [index, entry] of cases.entries()) {
    await context.test(entry.name, async () => {
      const address = `0x${String(70 + index).repeat(32)}`;
      const maker = certifiedMaker();
      const storageMap = new Map();
      const harness = browserHarness({
        connection: { account: { address, chains: ['sui:mainnet'] } },
        templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
        playerSessionResult: playerSession(ROOT_ONE),
        renderPlayerPreviewResult: canonicalPreview(),
        storageMap,
      });
      const app = createOriginalProductApp(harness);
      await app.ready;
      await app.openPlayer(ROOT_ONE);
      const mount = harness.doc.getElementById('makerV4PlayerMount');
      const baseEdit = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
      baseEdit.parent = mount;
      baseEdit.value = 'Acknowledged base';
      await waitForEvent(mount.fire('change', { target: baseEdit }));
      const projectKey = [...storageMap.keys()].find((key) => (
        key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
      ));
      const acknowledged = JSON.parse(storageMap.get(projectKey));
      const fork = structuredClone(acknowledged);
      fork.writerId = entry.writerId || acknowledged.writerId;
      fork.updatedAt += 1;
      fork.session.profile.world = `fork-${entry.name}`;
      fork.projectHash = await exactProjectHash(fork.session);
      assert.equal(fork.revision, acknowledged.revision);
      assert.notEqual(fork.projectHash, acknowledged.projectHash);
      const forkSerialized = JSON.stringify(fork);
      storageMap.set(projectKey, forkSerialized);

      const blockedEdit = new FakeTarget(harness.doc, {
        dataset: { action: 'player-profile-description' },
      });
      blockedEdit.parent = mount;
      blockedEdit.value = 'must not overwrite the unseen fork';
      await waitForEvent(mount.fire('change', { target: blockedEdit }));

      assert.equal(storageMap.get(projectKey), forkSerialized);
      assert.match(mount.innerHTML, /class="v4-player-recovery"/);
      assert.match(
        harness.doc.getElementById('v4PlayerCompletionStatus').textContent,
        /Another tab saved a different Player project revision/,
      );
      app.destroy();
    });
  }
});

test('Player storage events cold-read current durability, ignore delayed and same-hash branches, and reject pseudo-hashes', async () => {
  const address = `0x${'72'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const baseEdit = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  baseEdit.parent = mount;
  baseEdit.value = 'Event base';
  await waitForEvent(mount.fire('change', { target: baseEdit }));
  const projectKey = [...storageMap.keys()].find((key) => (
    key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
  ));
  const base = JSON.parse(storageMap.get(projectKey));

  const higherSameHash = structuredClone(base);
  higherSameHash.baseRevision = base.revision;
  higherSameHash.revision = base.revision + 1;
  higherSameHash.writerId = 'same-content-writer';
  higherSameHash.updatedAt += 1;
  const higherSerialized = JSON.stringify(higherSameHash);
  storageMap.set(projectKey, higherSerialized);
  await waitForEvent(harness.win.fire('storage', {
    key: projectKey,
    oldValue: JSON.stringify(base),
    newValue: higherSerialized,
  }));
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);

  const editAfterSameHash = new FakeTarget(harness.doc, {
    dataset: { action: 'player-profile-description' },
  });
  editAfterSameHash.parent = mount;
  editAfterSameHash.value = 'save after exact same-hash acknowledgement';
  await waitForEvent(mount.fire('change', { target: editAfterSameHash }));
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);
  const afterSameHashSerialized = storageMap.get(projectKey);
  const afterSameHash = JSON.parse(afterSameHashSerialized);
  assert.equal(afterSameHash.revision, higherSameHash.revision + 1);

  const higherDifferent = structuredClone(afterSameHash);
  higherDifferent.baseRevision = afterSameHash.revision;
  higherDifferent.revision = afterSameHash.revision + 1;
  higherDifferent.writerId = 'newer-current-writer';
  higherDifferent.updatedAt += 1;
  higherDifferent.session.profile.world = 'newer current durable content';
  higherDifferent.projectHash = await exactProjectHash(higherDifferent.session);
  const higherDifferentSerialized = JSON.stringify(higherDifferent);
  storageMap.set(projectKey, higherDifferentSerialized);
  await waitForEvent(harness.win.fire('storage', {
    key: projectKey,
    oldValue: null,
    newValue: afterSameHashSerialized,
  }));
  assert.doesNotMatch(
    mount.innerHTML,
    /class="v4-player-recovery"/,
    'a delayed lower-revision event is not current durable authority',
  );

  const forged = structuredClone(higherDifferent);
  forged.session.profile.world = 'forged content';
  forged.projectHash = 'fa'.repeat(32);
  const forgedSerialized = JSON.stringify(forged);
  storageMap.set(projectKey, forgedSerialized);
  await waitForEvent(harness.win.fire('storage', {
    key: projectKey,
    oldValue: higherDifferentSerialized,
    newValue: forgedSerialized,
  }));
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);
  assert.equal(storageMap.get(projectKey), forgedSerialized);
  app.destroy();
});

test('a valid cold-read storage rollback stays below the acknowledged base and never becomes Recovery authority', async () => {
  const address = `0x${'73'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const name = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  name.parent = mount;
  name.value = 'Acknowledged revision one';
  await waitForEvent(mount.fire('change', { target: name }));
  const projectKey = [...storageMap.keys()].find((key) => (
    key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
  ));
  const revisionOneSerialized = storageMap.get(projectKey);
  const revisionOne = JSON.parse(revisionOneSerialized);

  const world = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-world' } });
  world.parent = mount;
  world.value = 'Acknowledged revision two';
  await waitForEvent(mount.fire('change', { target: world }));
  const revisionTwoSerialized = storageMap.get(projectKey);
  const revisionTwo = JSON.parse(revisionTwoSerialized);
  assert.equal(revisionTwo.revision, revisionOne.revision + 1);
  assert.notEqual(revisionTwo.projectHash, revisionOne.projectHash);

  storageMap.set(projectKey, revisionOneSerialized);
  await waitForEvent(harness.win.fire('storage', {
    key: projectKey,
    oldValue: revisionTwoSerialized,
    newValue: revisionOneSerialized,
  }));
  assert.equal(storageMap.get(projectKey), revisionOneSerialized, 'the observer does not rewrite cold storage');
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);

  storageMap.set(projectKey, revisionTwoSerialized);
  const description = new FakeTarget(harness.doc, {
    dataset: { action: 'player-profile-description' },
  });
  description.parent = mount;
  description.value = 'The revision-two acknowledgement survived the rollback event';
  await waitForEvent(mount.fire('change', { target: description }));
  const revisionThree = JSON.parse(storageMap.get(projectKey));
  assert.equal(revisionThree.revision, revisionTwo.revision + 1);
  assert.equal(revisionThree.baseRevision, revisionTwo.revision);
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);
  app.destroy();
});

test('same-writer Recovery branches expose exact branch ids and the second branch retries through real CAS', async () => {
  const address = `0x${'74'.repeat(32)}`;
  const maker = certifiedMaker();
  const storageMap = new Map();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    storageMap,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const localName = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-name' } });
  localName.parent = mount;
  localName.value = 'Same writer local branch';
  await waitForEvent(mount.fire('change', { target: localName }));
  const projectKey = [...storageMap.keys()].find((key) => (
    key.startsWith('animacraft:maker-v8-player-project:v1:') && !key.includes(':wal:')
  ));
  const acknowledgedSerialized = storageMap.get(projectKey);
  const acknowledged = JSON.parse(acknowledgedSerialized);

  const foreign = structuredClone(acknowledged);
  foreign.baseRevision = acknowledged.revision;
  foreign.revision += 1;
  foreign.updatedAt += 1;
  foreign.session.profile.name = 'Same writer foreign branch';
  foreign.projectHash = await exactProjectHash(foreign.session);
  const foreignSerialized = JSON.stringify(foreign);
  storageMap.set(projectKey, foreignSerialized);
  await waitForEvent(harness.win.fire('storage', {
    key: projectKey,
    oldValue: acknowledgedSerialized,
    newValue: foreignSerialized,
  }));

  const branchIds = [...mount.innerHTML.matchAll(
    /data-action="player-select-recovery" data-writer-id="([^"]+)"/g,
  )].map((match) => match[1]);
  assert.equal(branchIds.length, 2);
  assert.equal(new Set(branchIds).size, 2, 'same-writer forks remain independently addressable');
  assert.deepEqual(branchIds, [
    `${acknowledged.writerId}:${foreign.revision}:${foreign.projectHash}`,
    `${acknowledged.writerId}:${foreign.revision}:${acknowledged.projectHash}`,
  ]);

  const selectSecond = new FakeTarget(harness.doc, {
    dataset: { action: 'player-select-recovery', writerId: branchIds[1] },
  });
  selectSecond.parent = mount;
  await waitForEvent(mount.fire('click', { target: selectSecond }));
  assert.match(
    mount.innerHTML,
    /value="Same writer local branch"[^>]+data-action="player-profile-name"/,
  );
  assert.match(
    mount.innerHTML,
    new RegExp(`data-writer-id="${branchIds[1]}" aria-pressed="true"`),
  );

  const retry = new FakeTarget(harness.doc, { dataset: { action: 'player-retry-save' } });
  retry.parent = mount;
  await waitForEvent(mount.fire('click', { target: retry }));
  const recovered = JSON.parse(storageMap.get(projectKey));
  assert.equal(recovered.revision, foreign.revision + 1);
  assert.equal(recovered.baseRevision, foreign.revision);
  assert.equal(recovered.writerId, acknowledged.writerId, 'branch ids never replace the durable writer id');
  assert.equal(recovered.session.profile.name, 'Same writer local branch');
  assert.equal(recovered.projectHash, await exactProjectHash(recovered.session));
  assert.doesNotMatch(mount.innerHTML, /class="v4-player-recovery"/);
  app.destroy();
});

test('Player retry-save retries only the exact durable project write and never chain completion', async () => {
  const address = `0x${'8b'.repeat(32)}`;
  const maker = certifiedMaker();
  const harness = browserHarness({
    connection: { account: { address, chains: ['sui:mainnet'] } },
    templatesResult: { status: 'READY', makers: [maker], diagnostics: [] },
    playerSessionResult: playerSession(ROOT_ONE),
    renderPlayerPreviewResult: canonicalPreview(),
    completePlayerJourneyResult: { status: 'HANDOFF_READY' },
    nativeCompletionConfigured: true,
  });
  const app = createOriginalProductApp(harness);
  await app.ready;
  await app.openPlayer(ROOT_ONE);
  const originalSetItem = harness.win.localStorage.setItem;
  let failed = false;
  harness.win.localStorage.setItem = (key, value) => {
    if (!failed && key.includes(':wal:')) {
      failed = true;
      throw new Error('browser storage temporarily unavailable');
    }
    return originalSetItem(key, value);
  };
  const mount = harness.doc.getElementById('makerV4PlayerMount');
  const profile = new FakeTarget(harness.doc, { dataset: { action: 'player-profile-description' } });
  profile.parent = mount;
  profile.value = 'Retry this exact project';
  await waitForEvent(mount.fire('change', { target: profile }));
  assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="error"/);
  const retry = new FakeTarget(harness.doc, { dataset: { action: 'player-retry-save' } });
  retry.parent = mount;
  await waitForEvent(mount.fire('click', { target: retry }));
  assert.match(mount.innerHTML, /id="v4PlayerSaveStatus"[^>]+data-state="saved"/);
  assert.equal(harness.calls.completePlayerJourney.length, 0);
  app.destroy();
});

function libraryPreviewClick(harness, draftId) {
  const list = harness.doc.getElementById('imageMakerList');
  const button = new FakeTarget(harness.doc, { dataset: { previewMaker: draftId } });
  button.parent = list;
  return list.fire('click', { target: button });
}

test('Library Preview opens the exact saved draft once and returns to its existing editor without chain writes', async () => {
  const first = draftRecord();
  const second = structuredClone(first); second.draftId = 'preview-second'; second.document.metadata.name = 'Preview second';
  const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } },
    record: first, draftsResult: [first, second], initialUrl: 'https://animacraft.soulidity.ai/#creator' });
  const gate = deferred(); const inputs = [];
  harness.bridge.openLocalPlayer = async input => {
    inputs.push(input); await gate.promise;
    const model = createMakerV8LocalPlayer({ draftId: second.draftId, draftRevision: second.revision, document: second.document });
    return { ...model, getAssets: async () => [], renderPreview: async () => canonicalPreview() };
  };
  const app = createOriginalProductApp(harness);
  try {
    await app.ready;
    const list = harness.doc.getElementById('imageMakerList');
    const tag = () => list.innerHTML.match(/<button[^>]+data-preview-maker="preview-second"[^>]*>/)?.[0];
    assert.doesNotMatch(tag(), /\sdisabled(?:\s|=|>)/);
    libraryPreviewClick(harness, second.draftId); libraryPreviewClick(harness, second.draftId);
    await settle(); await settle();
    assert.deepEqual(harness.calls.getDraft, [second.draftId]);
    assert.deepEqual(inputs, [{ draftId: second.draftId, expectedRevision: second.revision }]);
    assert.match(tag(), /\sdisabled(?:\s|=|>)/);
    gate.resolve(); await settle(); await settle();
    assert.equal(app.getState().route, 'make');
    assert.match(harness.doc.getElementById('makerV4PlayerMount').innerHTML, /Preview second/);
    await waitForEvent(harness.doc.getElementById('backToCreatorPreview').fire('click'));
    assert.equal(app.getState().route, 'creator');
    assert.equal(app.getState().draftId, second.draftId);
    assert.match(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Preview second/);
    assert.equal(harness.calls.dispatch.length + harness.calls.replace.length + harness.calls.openPlayer.length
      + harness.calls.completePlayerJourney.length, 0);
  } finally { gate.resolve(); await app.destroy(); }
});

test('Library Preview keeps draft read and local Player failures visible and retryable', async t => {
  for (const failure of ['draft', 'player', 'unavailable']) await t.test(failure, async () => {
    const record = draftRecord();
    const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } },
      record, draftsResult: [record], initialUrl: 'https://animacraft.soulidity.ai/#creator' });
    let blocked = true; let opened = 0;
    const read = harness.bridge.getDraft;
    harness.bridge.getDraft = async input => {
      if (blocked && failure === 'draft') throw new Error('Preview draft read failed');
      return read(input);
    };
    if (failure !== 'unavailable') harness.bridge.openLocalPlayer = async () => {
      opened += 1;
      if (blocked && failure === 'player') throw new Error('Preview local assets failed');
      const model = createMakerV8LocalPlayer({ draftId: record.draftId, draftRevision: record.revision, document: record.document });
      return { ...model, getAssets: async () => [], renderPreview: async () => canonicalPreview() };
    };
    const app = createOriginalProductApp(harness);
    try {
      await app.ready; libraryPreviewClick(harness, record.draftId); await settle(); await settle();
      assert.equal(app.getState().route, 'creator');
      const list = harness.doc.getElementById('imageMakerList');
      if (failure === 'unavailable') {
        assert.match(list.innerHTML.match(/<button[^>]+data-preview-maker[^>]*>/)[0], /\sdisabled(?:\s|=|>)/);
        assert.equal(harness.calls.getDraft.length, 0); return;
      }
      if (failure === 'draft') assert.match(list.innerHTML, /Preview draft read failed/);
      else assert.match(harness.doc.getElementById('makerV4CreatorMount').innerHTML, /Preview local assets failed/);
      assert.match(list.innerHTML, /data-preview-maker="approved-maker"/);
      blocked = false;
      await waitForEvent(harness.doc.getElementById('backToMakerList').fire('click'));
      libraryPreviewClick(harness, record.draftId); await settle(); await settle();
      assert.equal(app.getState().route, 'make'); assert.ok(opened > 0);
    } finally { await app.destroy(); }
  });
});

test('Library Preview fences late draft and canvas reads across navigation, wallet ABA, switching and destruction', async t => {
  for (const stage of ['draft', 'canvas']) for (const boundary of ['navigate', 'library', 'wallet', 'disconnect', 'other-draft', 'other-preview', 'destroy']) {
    await t.test(`${stage}/${boundary}`, async () => {
      const record = draftRecord();
      const other = structuredClone(record); other.draftId = 'preview-other'; other.document.metadata.name = 'Other preview';
      const gate = deferred(); const inputs = [];
      const harness = browserHarness({ connection: { account: { address: ROOT_ONE, chains: ['sui:mainnet'] } },
        record, draftsResult: [record, other], initialUrl: 'https://animacraft.soulidity.ai/#creator',
        renderDraftPreviewResult: stage === 'canvas' ? id => id === record.draftId ? gate.promise : canonicalPreview() : undefined });
      const read = harness.bridge.getDraft;
      harness.bridge.getDraft = async input => {
        if (stage === 'draft' && input.draftId === record.draftId) await gate.promise;
        return read(input);
      };
      harness.bridge.openLocalPlayer = async input => {
        inputs.push(input);
        const selected = input.draftId === record.draftId ? record : other;
        const model = createMakerV8LocalPlayer({ draftId: selected.draftId, draftRevision: selected.revision, document: selected.document });
        return { ...model, getAssets: async () => [], renderPreview: async () => canonicalPreview() };
      };
      const app = createOriginalProductApp(harness);
      try {
        await app.ready; libraryPreviewClick(harness, record.draftId); await settle();
        if (boundary === 'navigate') app.navigate('docs');
        if (boundary === 'library') await waitForEvent(harness.doc.getElementById('backToMakerList').fire('click'));
        if (boundary === 'wallet') {
          app.refreshConnection({ account: { address: ROOT_TWO, chains: ['sui:mainnet'] } });
          app.refreshConnection({ account: { address: ROOT_ONE, chains: ['sui:mainnet'] } });
        }
        if (boundary === 'disconnect') app.refreshConnection(null);
        if (boundary === 'other-draft') await app.openDraft(other.draftId);
        if (boundary === 'other-preview') { libraryPreviewClick(harness, other.draftId); await settle(); await settle(); }
        if (boundary === 'destroy') await app.destroy();
        gate.resolve(canonicalPreview()); await settle(); await settle();
        assert.deepEqual(inputs.map(input => input.draftId), boundary === 'other-preview' ? [other.draftId] : []);
        if (boundary === 'navigate') assert.equal(app.getState().route, 'docs');
        if (boundary.startsWith('other-')) assert.equal(app.getState().draftId, other.draftId);
        if (boundary !== 'other-preview') assert.notEqual(app.getState().route, 'make');
      } finally { gate.resolve(canonicalPreview()); await app.destroy(); }
    });
  }
});
