import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';
import { createMakerV8LocalPlayerControls } from '../maker-v8-local-player-controls.js';
import { IDBFactory } from 'fake-indexeddb';
import { createMakerV8LocalPlayerStore } from '../maker-v8-local-player-store.js';

function documentFixture() {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'local' }));
  document.canvas.width = 800;
  document.canvas.height = 600;
  const part = structuredClone(document.parts[0]);
  Object.assign(part, { key: 'hat', kind: 'STANDARD', required: false, menuOrder: 1, renderOrder: 1 });
  part.items[0].styles.push({ ...structuredClone(part.items[0].styles[0]), key: 'blue', displayOrder: 1 });
  document.parts.push(part);
  document.colors = [{ key: 'primary', label: 'Primary', defaultSwatchKey: 'red', swatches: [
    { key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] },
    { key: 'blue', label: 'Blue', rgba: '#0000ffff', stops: [] },
  ] }];
  return document;
}
function harness({ document = documentFixture(), render, pngExport, recipeExport, exportCheckpoint } = {}) {
  const model = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1, document });
  let renders = 0;
  const changes = [];
  const controller = createMakerV8LocalPlayerControls({
    pngExport,
    recipeExport,
    session: { ...model, ...(exportCheckpoint ? { exportCheckpoint } : {}), async renderPreview(options = null) {
      renders += 1;
      return render ? render(model.getSnapshot(), options) : Object.freeze({ previewRevision: model.getSnapshot().revision });
    } },
    onChange: (view) => changes.push(view),
  });
  return { model, controller, changes, renders: () => renders };
}

test('local controls select/toggle exact items and styles, retain required Parts, and render each edit', async () => {
  const h = harness();
  await h.controller.refresh();
  assert.equal(h.controller.getView().introOpen, true);
  await h.controller.dispatch('close-player-info');
  await h.controller.dispatch('player-part', { partId: 'hat' });
  assert.equal(h.controller.getView().selectedPartKey, 'hat');
  await h.controller.dispatch('player-item', { choiceId: 'base:hat:default:default' });
  assert.equal(h.model.getSnapshot().recipe.selections.length, 2);
  await h.controller.dispatch('player-style', { choiceId: 'base:hat:default:blue' });
  assert.equal(h.model.getSnapshot().recipe.selections.at(-1).styleKey, 'blue');
  await h.controller.dispatch('player-item', { choiceId: 'base:hat:default:blue' });
  assert.equal(h.model.getSnapshot().recipe.selections.length, 1);
  const revision = h.model.getSnapshot().revision;
  await h.controller.dispatch('player-item', { choiceId: 'base:base:default:default' });
  assert.equal(h.model.getSnapshot().revision, revision);
  assert.equal(h.renders(), 4);
  assert.equal(h.controller.getView().render.state, 'ready');
  assert.equal(h.controller.getRenderRecord().previewRevision, revision);
});

test('local controls use validated Colors, clear/reset/undo/redo and preserve failed-edit atomicity', async () => {
  const h = harness();
  await h.controller.dispatch('player-color', { channelId: 'primary', swatchId: 'blue' });
  await h.controller.dispatch('player-item', { choiceId: 'base:hat:default:default' });
  const before = h.model.getSnapshot();
  await assert.rejects(h.controller.dispatch('player-color', { channelId: 'primary', swatchId: 'absent' }));
  assert.deepEqual(h.model.getSnapshot(), before);
  assert.equal(h.controller.getView().playerTest.state, 'error');
  await assert.rejects(h.controller.dispatch('player-none', { partId: 'base' }));
  await h.controller.dispatch('player-clear');
  assert.equal(h.model.getSnapshot().recipe.selections.length, 1);
  await h.controller.dispatch('player-undo');
  assert.equal(h.model.getSnapshot().recipe.selections.length, 2);
  await h.controller.dispatch('player-redo');
  assert.equal(h.model.getSnapshot().recipe.selections.length, 1);
  await h.controller.dispatch('player-reset');
  assert.deepEqual(h.model.getSnapshot().recipe.colors, []);
  assert.equal(h.controller.getView().playerTest.state, 'idle');
});

test('local controls reject incompatible rule edits instead of painting a successful invalid recipe', async () => {
  const document = documentFixture();
  document.rules.push({ key: 'incompatible', kind: 'EXCLUDE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null },
    targetMode: 'ANY', targets: [{ source: 'BASE', sourceKey: null, partKey: 'hat', itemKey: 'default', styleKey: null }], payload: {} });
  const h = harness({ document });
  await h.controller.refresh();
  await assert.rejects(h.controller.dispatch('player-item', { choiceId: 'base:hat:default:default' }),
    { code: 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED' });
  assert.equal(h.model.getSnapshot().revision, 0);
  assert.equal(h.renders(), 1);
  assert.equal(h.controller.getView().playerTest.state, 'error');
  await h.controller.dispatch('player-reset');
  assert.equal(h.controller.getView().playerTest.state, 'idle');
});

test('local control rendering rejects late results after newer edits and after disposal', async () => {
  const pending = [];
  const h = harness({ render: (snapshot) => new Promise((resolve) => pending.push({ resolve, revision: snapshot.revision })) });
  const first = h.controller.refresh();
  const second = h.controller.dispatch('player-item', { choiceId: 'base:hat:default:default' });
  assert.equal(pending.length, 2);
  pending[1].resolve({ newest: true });
  await second;
  pending[0].resolve({ stale: true });
  assert.equal(await first, null);
  assert.deepEqual(h.controller.getRenderRecord(), { newest: true });
  const third = h.controller.refresh();
  const changeCount = h.changes.length;
  h.controller.dispose();
  pending[2].resolve({ closed: true });
  assert.equal(await third, null);
  assert.equal(h.changes.length, changeCount);
  assert.throws(() => h.controller.getView(), { code: 'MAKER_V8_LOCAL_PLAYER_CONTROLS_CLOSED' });
});

test('local control capabilities and direct dispatch cannot reach chain, persistence or unimplemented actions', async () => {
  const h = harness();
  for (const action of ['player-complete', 'player-unlock-maker', 'player-publish-register', 'player-retry-save', 'player-random', 'player-download-png']) {
    await assert.rejects(h.controller.dispatch(action), { code: 'MAKER_V8_LOCAL_PLAYER_ACTION_UNAVAILABLE' });
    assert.notEqual(h.controller.getView().capabilities.entries[action]?.enabled, true);
  }
  await assert.rejects(h.controller.dispatch('player-part', { partId: 'missing' }));
  await assert.rejects(h.controller.dispatch('player-item', { choiceId: 'external:fake' }));
  assert.equal(h.model.getSnapshot().revision, 0);
  assert.equal(h.renders(), 0);
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) assert.equal(h.controller.setLocale(locale).locale, locale);
  assert.equal(h.controller.getView().execution.writeEnabled, false);
});

test('render failure stays visible and can retry without changing local revision', async () => {
  let failed = true;
  const h = harness({ render: () => {
    if (failed) throw new Error('local image decode failed');
    return { rendered: true };
  } });
  await assert.rejects(h.controller.refresh(), /local image decode failed/);
  assert.equal(h.controller.getView().render.state, 'error');
  assert.equal(h.controller.getRenderRecord(), null);
  failed = false;
  await h.controller.refresh();
  assert.equal(h.controller.getView().render.state, 'ready');
  assert.equal(h.model.getSnapshot().revision, 0);
});

test('local PNG export uses current render dimensions, never completion, and revokes on edit/close/dispose', async () => {
  const revoked = [];
  const downloaded = [];
  let urlCount = 0;
  const h = harness({ render: () => ({ width: 800, height: 600 }), pngExport: {
    createUrl: () => `blob:local-${++urlCount}`,
    revokeUrl: (url) => revoked.push(url),
    download: (url, record) => downloaded.push({ url, record }),
  } });
  await assert.rejects(h.controller.dispatch('player-download-png'), { code: 'MAKER_V8_LOCAL_PLAYER_EXPORT_NOT_READY' });
  await h.controller.dispatch('player-preview-export');
  const view = h.controller.getView();
  assert.deepEqual(view.export.original, { width: 800, height: 600 });
  assert.equal(view.export.completionConfirmed, false);
  assert.equal(view.completeReady, false);
  await h.controller.dispatch('player-download-png');
  assert.equal(downloaded[0].url, 'blob:local-1');
  assert.deepEqual(downloaded[0].record, { width: 800, height: 600 });
  assert.equal(h.controller.getRenderRecord(), null, 'Export does not replace or create the editing preview.');
  await h.controller.dispatch('player-color', { channelId: 'primary', swatchId: 'blue' });
  assert.deepEqual(revoked, ['blob:local-1']);
  await assert.rejects(h.controller.dispatch('player-download-png'));
  await h.controller.dispatch('player-preview-export');
  await h.controller.dispatch('close-player-export');
  await h.controller.dispatch('player-preview-export');
  h.controller.dispose();
  assert.deepEqual(revoked, ['blob:local-1', 'blob:local-2', 'blob:local-3']);
});

test('export size/background changes are isolated from the editing preview and exact recipe', async () => {
  const document = documentFixture();
  document.canvas = { width: 2048, height: 1536, pixelMode: 'smooth' };
  const requests = [], revoked = [], downloads = [];
  let url = 0;
  const h = harness({ document, render: (snapshot, options) => {
    requests.push(options);
    return options?.sizeMode === 'standard' ? { width: 1024, height: 768, options }
      : { width: 2048, height: 1536, options };
  }, pngExport: { createUrl: () => `blob:export-${++url}`, revokeUrl: url => revoked.push(url),
    download: (url, png) => downloads.push({ url, png }) } });
  await h.controller.refresh();
  const preview = h.controller.getRenderRecord();
  const snapshot = structuredClone(h.model.getSnapshot());
  await h.controller.dispatch('player-preview-export');
  assert.equal(h.controller.getView().export.sizeMode, 'standard');
  await h.controller.dispatch('player-export-size', { sizeMode: 'original' });
  await h.controller.dispatch('player-export-background', { transparent: 'true' });
  await h.controller.dispatch('player-download-png');
  assert.deepEqual(downloads[0].png.options, { sizeMode: 'original', transparent: true });
  assert.deepEqual(requests, [null, { sizeMode: 'standard', transparent: false },
    { sizeMode: 'original', transparent: false }, { sizeMode: 'original', transparent: true }]);
  assert.equal(h.controller.getRenderRecord(), preview);
  assert.deepEqual(h.model.getSnapshot(), { ...snapshot, revision: 2, undoDepth: 2,
    imageExport: { sizeMode: 'original', transparent: true } });
  assert.deepEqual(revoked, ['blob:export-1', 'blob:export-2']);
  const count = requests.length;
  await assert.rejects(h.controller.dispatch('player-export-size', { sizeMode: 'giant' }));
  await assert.rejects(h.controller.dispatch('player-export-background', { transparent: 'yes' }));
  assert.equal(requests.length, count);
  h.controller.dispose();
  assert.equal(revoked.at(-1), 'blob:export-3');
});

test('export dispatch enforces original pixel cap and stale option renders cannot create URLs', async () => {
  const document = documentFixture();
  document.canvas = { width: 8192, height: 8192, pixelMode: 'smooth' };
  const pending = [], revoked = [];
  let urls = 0;
  const h = harness({ document, render: (_, options) => new Promise(resolve => pending.push({ options, resolve })),
    pngExport: { createUrl: () => `blob:${++urls}`, revokeUrl: url => revoked.push(url), download() {} } });
  const first = h.controller.dispatch('player-preview-export');
  assert.equal(h.controller.getView().export.originalSafe, false);
  await assert.rejects(h.controller.dispatch('player-export-size', { sizeMode: 'original' }), /safe pixel/);
  assert.equal(pending.length, 1);
  const second = h.controller.dispatch('player-export-background', { transparent: 'true' });
  pending[1].resolve({ width: 1024, height: 1024 });
  await second;
  pending[0].resolve({ width: 1024, height: 1024 });
  await first;
  assert.equal(urls, 1);
  assert.equal(h.controller.getView().export.transparent, true);
  assert.equal(h.controller.getView().export.previewUrl, 'blob:1');
  h.controller.dispose();
  assert.deepEqual(revoked, ['blob:1']);
});

test('wrong renderer dimensions reject before URL creation and retry retains exact export options', async () => {
  let mismatch = true;
  const requests = [];
  const h = harness({ render: (_, options) => { requests.push(options); return { width: mismatch ? 99 : 800, height: 600 }; },
    pngExport: { createUrl: () => 'blob:exact', revokeUrl() {}, download() {} } });
  await assert.rejects(h.controller.dispatch('player-preview-export'), { code: 'MAKER_V8_LOCAL_PLAYER_EXPORT_SIZE_MISMATCH' });
  await assert.rejects(h.controller.dispatch('player-export-background', { transparent: 'true' }));
  assert.equal(h.controller.getView().export.transparent, true);
  mismatch = false;
  await h.controller.dispatch('player-export-retry');
  assert.deepEqual(requests.at(-1), { sizeMode: 'standard', transparent: true });
  assert.equal(h.controller.getView().export.state, 'ready');
  assert.equal(h.model.getSnapshot().revision, 1);
  h.controller.dispose();
});

function durableExportHarness(document, store, render, save = input => store.save(input)) {
  const model = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1, document });
  const binding = { draftId: 'local', draftRevision: 1,
    documentHash: JSON.parse(model.exportCheckpoint()).documentHash, assetHash: 'aa'.repeat(32) };
  const session = { ...model, renderPreview: render,
    loadCheckpoint: () => store.load(binding),
    restoreCheckpoint: (checkpoint, revision) => model.restoreCheckpoint(JSON.parse(checkpoint).checkpoint, revision),
    captureCheckpointSave() {
      const checkpoint = JSON.stringify({ assetHash: binding.assetHash, checkpoint: model.exportCheckpoint(),
        schemaVersion: 'animacraft.maker-v8-local-player-bundle-checkpoint.v1' });
      return { revision: model.getSnapshot().revision, commit: expected => save({ binding, checkpoint, expected }) };
    },
  };
  const urls = [];
  const controller = createMakerV8LocalPlayerControls({ session, pngExport: {
    createUrl: () => { urls.push('blob:export'); return urls.at(-1); }, revokeUrl() {}, download() {},
  } });
  return { model, controller, binding, urls };
}

test('preference changes replace a pending main preview without accepting its stale result or clearing the export lane', async () => {
  const pending = [];
  const h = harness({ render: (snapshot, options) => new Promise((resolve, reject) => pending.push({ snapshot, options, resolve, reject })),
    pngExport: { createUrl: () => 'blob:exact', revokeUrl() {}, download() {} } });
  const preview = h.controller.refresh();
  const exporting = h.controller.dispatch('player-preview-export');
  const changing = h.controller.dispatch('player-export-size', { sizeMode: 'original' });
  assert.equal(pending.length, 4);
  assert.equal(pending[2].options, null);
  assert.equal(pending[2].snapshot.revision, 1);
  pending[0].reject(Object.assign(new Error('stale preview'), { code: 'STALE_LOCAL_PLAYER' }));
  await preview;
  assert.equal(h.controller.getView().render.state, 'pending');
  assert.equal(h.controller.getRenderRecord(), null);
  pending[2].resolve({ width: 800, height: 600, revision: 1 });
  pending[3].resolve({ width: 800, height: 600 });
  await changing;
  pending[1].resolve({ width: 800, height: 600 });
  await exporting;
  assert.equal(h.controller.getView().render.state, 'ready');
  assert.equal(h.controller.getRenderRecord().revision, 1);
  assert.equal(h.controller.getView().export.state, 'ready');
  assert.equal(h.controller.getView().export.sizeMode, 'original');
  await h.controller.dispatch('player-download-png');
  h.controller.dispose();
});

test('export intent cold-restores independently and together at equal and different output dimensions', async t => {
  for (const width of [800, 2048]) for (const imageExport of [
    { sizeMode: 'original', transparent: false }, { sizeMode: 'standard', transparent: true },
    { sizeMode: 'original', transparent: true },
  ]) await t.test(`${width}/${imageExport.sizeMode}/${imageExport.transparent}`, async () => {
    const document = documentFixture(); document.canvas.width = width;
    const store = createMakerV8LocalPlayerStore(new IDBFactory());
    const render = async options => ({ width: options.sizeMode === 'standard' && width > 1024 ? 1024 : width,
      height: options.sizeMode === 'standard' && width > 1024 ? 300 : 600 });
    const first = durableExportHarness(document, store, render);
    await first.controller.initialize();
    await first.controller.dispatch('player-preview-export');
    await first.controller.dispatch('player-export-size', { sizeMode: imageExport.sizeMode });
    await first.controller.dispatch('player-export-background', { transparent: String(imageExport.transparent) });
    await first.controller.dispatch('close-player-export');
    await first.controller.flush(); await first.controller.dispose();
    const cold = durableExportHarness(document, store, render);
    await cold.controller.initialize();
    assert.deepEqual(cold.model.getSnapshot().imageExport, imageExport);
    assert.equal(cold.controller.getView().export.sizeMode, imageExport.sizeMode);
    await assert.rejects(cold.controller.dispatch('player-download-png'), { code: 'MAKER_V8_LOCAL_PLAYER_EXPORT_NOT_READY' });
    await cold.controller.dispatch('player-preview-export');
    assert.equal(cold.controller.getView().export.transparent, imageExport.transparent);
    await cold.controller.dispatch('player-download-png');
    await cold.controller.dispose(); store.close();
  });
});

test('failed and held renders persist latest intent through save retry, close and disposal without stale URLs', async () => {
  const store = createMakerV8LocalPlayerStore(new IDBFactory());
  let failSave = true;
  const pending = [], writes = [];
  const h = durableExportHarness(documentFixture(), store, () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    async input => { writes.push(input); if (failSave) throw new Error('quota'); return store.save(input); });
  await h.controller.initialize();
  const original = h.controller.dispatch('player-preview-export');
  const size = h.controller.dispatch('player-export-size', { sizeMode: 'original' });
  const background = h.controller.dispatch('player-export-background', { transparent: 'true' });
  await assert.rejects(h.controller.flush(), /quota/);
  assert.equal(h.controller.getView().save.state, 'error');
  pending[2].reject(new Error('render failed'));
  await assert.rejects(background, /render failed/);
  await assert.rejects(h.controller.dispatch('player-download-png'), { code: 'MAKER_V8_LOCAL_PLAYER_EXPORT_NOT_READY' });
  await h.controller.dispatch('close-player-export');
  failSave = false;
  await h.controller.dispatch('player-retry-save');
  assert.deepEqual(writes.at(-1).expected, null);
  const durable = await store.load(h.binding);
  assert.deepEqual(JSON.parse(JSON.parse(durable.checkpoint).checkpoint).imageExport, { sizeMode: 'original', transparent: true });
  const reopened = h.controller.dispatch('player-preview-export');
  const newest = h.controller.dispatch('player-export-background', { transparent: 'false' });
  await h.controller.dispose();
  for (const job of pending) job.resolve({ width: 800, height: 600 });
  await Promise.all([original, size, reopened, newest]);
  assert.deepEqual(h.urls, []);
  const latest = await store.load(h.binding);
  assert.equal(latest.revision, durable.revision + 1);
  assert.deepEqual(JSON.parse(JSON.parse(latest.checkpoint).checkpoint).imageExport, { sizeMode: 'original', transparent: false });
  assert.deepEqual(writes.at(-1).expected, { revision: durable.revision, contentHash: durable.contentHash });
  store.close();
});

test('local export close, newer render and disposal fence late URL creation', async (t) => {
  for (const boundary of ['close', 'edit', 'dispose']) await t.test(boundary, async () => {
    const pending = [];
    let urls = 0;
    const h = harness({ render: () => new Promise((resolve) => pending.push(resolve)), pngExport: {
      createUrl: () => { urls += 1; return 'blob:unexpected'; }, revokeUrl() {}, download() {},
    } });
    const opening = h.controller.dispatch('player-preview-export');
    let editing;
    if (boundary === 'close') await h.controller.dispatch('close-player-export');
    if (boundary === 'edit') editing = h.controller.dispatch('player-color', { channelId: 'primary', swatchId: 'blue' });
    if (boundary === 'dispose') h.controller.dispose();
    pending.forEach((resolve) => resolve({ width: 800, height: 600 }));
    await opening;
    await editing;
    assert.equal(urls, 0);
  });
});

test('local export reports renderer/URL failures and retries without certifying or changing the recipe', async () => {
  let unavailable = true;
  let downloadUnavailable = true;
  const revoked = [];
  const h = harness({ render: () => ({ width: 800, height: 600 }), pngExport: {
    createUrl() { if (unavailable) throw new Error('image download unavailable'); return 'blob:ready'; },
    revokeUrl: (url) => revoked.push(url),
    async download() { if (downloadUnavailable) throw new Error('download blocked'); },
  } });
  await assert.rejects(h.controller.dispatch('player-preview-export'), /image download unavailable/);
  assert.equal(h.controller.getView().export.state, 'error');
  unavailable = false;
  await h.controller.dispatch('player-export-retry');
  assert.equal(h.controller.getView().export.state, 'ready');
  await assert.rejects(h.controller.dispatch('player-download-png'), /download blocked/);
  assert.equal(h.controller.getView().export.state, 'error');
  assert.deepEqual(revoked, ['blob:ready']);
  downloadUnavailable = false;
  await h.controller.dispatch('player-export-retry');
  await h.controller.dispatch('player-download-png');
  assert.equal(h.model.getSnapshot().revision, 0);
});

test('a late failed PNG download cannot clear a newer export', async () => {
  let rejectDownload;
  let nextUrl = 0;
  const revoked = [];
  const h = harness({ render: () => ({ width: 800, height: 600 }), pngExport: {
    createUrl: () => `blob:export-${++nextUrl}`,
    revokeUrl: (url) => revoked.push(url),
    download: () => new Promise((resolve, reject) => { rejectDownload = reject; }),
  } });
  await h.controller.dispatch('player-preview-export');
  const download = h.controller.dispatch('player-download-png');
  await h.controller.dispatch('player-export-retry');
  rejectDownload(new Error('old download failed'));
  await assert.rejects(download, /old download failed/);
  assert.equal(h.controller.getView().export.previewUrl, 'blob:export-2');
  assert.equal(h.controller.getView().export.state, 'ready');
  assert.deepEqual(revoked, ['blob:export-1']);
  h.controller.dispose();
});

test('local profile/Soul controls preserve text, report invalid drafts and share history without fake defaults', async () => {
  const h = harness();
  await h.controller.dispatch('player-profile-name', { value: '<b>Moon</b>' });
  await h.controller.dispatch('player-soul-document', { soulKey: 'soulMd', value: '# Moon' });
  assert.equal(h.controller.getView().profile.name, '<b>Moon</b>');
  assert.equal(h.controller.getView().soulDocuments[0].value, '# Moon');
  assert.equal(h.controller.getView().soulDocuments[0].valid, true);
  await h.controller.dispatch('player-undo');
  assert.equal(h.controller.getView().soulDocuments[0].value, h.model.getSnapshot().document.livingContent.soulMd);
  assert.equal(h.controller.getView().soulDocuments[0].valid, true);
  assert.equal(h.controller.getView().profile.name, '<b>Moon</b>');
  await h.controller.dispatch('player-redo');
  const before = h.model.getSnapshot();
  await assert.rejects(h.controller.dispatch('player-soul-document', { soulKey: '__proto__', value: 'x' }));
  await assert.rejects(h.controller.dispatch('player-profile-name', { value: 'x'.repeat(129) }));
  assert.deepEqual(h.model.getSnapshot(), before);
  assert.equal(h.controller.getView().playerTest.state, 'error');
  await h.controller.dispatch('player-reset-soul-document', { soulKey: 'soulMd' });
  assert.equal(h.model.getSnapshot().soulDocuments.soulMd, before.document.livingContent.soulMd);
  assert.equal(h.controller.getView().completeReady, false);
});

test('local recipe checkpoint remains downloadable after render failure without authenticated persistence', async () => {
  const downloads = [];
  const h = harness({ render: () => { throw new Error('pixels unavailable'); }, recipeExport: (text) => downloads.push(text) });
  await assert.rejects(h.controller.dispatch('player-profile-name', { value: 'Recover me' }), /pixels unavailable/);
  await h.controller.dispatch('player-export');
  await h.controller.dispatch('player-export-recipe');
  assert.equal(downloads.length, 2);
  assert.equal(downloads[0], h.model.exportCheckpoint());
  assert.equal(JSON.parse(downloads[0]).profile.name, 'Recover me');
  assert.equal(h.controller.getView().completeReady, false);
});

test('Soul reset restores exact Maker text only, with atomic history and no purchase capability', async () => {
  const document = documentFixture(); document.livingContent.memoryMd = '';
  const h = harness({ document });
  await h.controller.dispatch('player-profile-name', { value: 'My identity' });
  await h.controller.dispatch('player-color', { channelId: 'primary', swatchId: 'blue' });
  for (const soulKey of ['soulMd', 'memoryMd', 'skillMd']) {
    await h.controller.dispatch('player-soul-document', { soulKey, value: `Edited ${soulKey}` });
  }
  const before = h.model.getSnapshot();
  assert.equal(h.controller.getView().capabilities.entries['player-reset-all-soul'].enabled, true);
  await h.controller.dispatch('player-reset-soul-document', { soulKey: 'memoryMd' });
  assert.deepEqual(h.model.getSnapshot().soulDocuments, { ...before.soulDocuments, memoryMd: '' });
  await h.controller.dispatch('player-reset-all-soul');
  const restored = h.model.getSnapshot();
  for (const key of ['soulMd', 'memoryMd', 'skillMd']) assert.equal(restored.soulDocuments[key], document.livingContent[key]);
  assert.deepEqual(restored.profile, before.profile);
  assert.deepEqual(restored.recipe, before.recipe);
  await h.controller.dispatch('player-undo');
  assert.equal(h.model.getSnapshot().soulDocuments.soulMd, before.soulDocuments.soulMd);
  await h.controller.dispatch('player-redo');
  assert.deepEqual(h.model.getSnapshot().soulDocuments, restored.soulDocuments);
  const revision = h.model.getSnapshot().revision;
  await assert.rejects(h.controller.dispatch('player-reset-soul-document', { soulKey: '__proto__' }));
  assert.equal(h.model.getSnapshot().revision, revision);
  await assert.rejects(h.controller.dispatch('player-complete'));
  await assert.rejects(h.controller.dispatch('player-acquire-maker'));
  assert.equal(h.controller.getView().completeReady, false);
});

test('Soul reset save failure keeps recoverable state and retries exact checkpoint for reopen', async () => {
  const document = documentFixture();
  let row = null; let failSave = false;
  function open() {
    const model = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1, document });
    const session = { ...model, async renderPreview() { return {}; }, async loadCheckpoint() { return row; },
      captureCheckpointSave() {
        const checkpoint = model.exportCheckpoint(); const revision = model.getSnapshot().revision;
        return { revision, async commit(expected) {
          if (failSave) throw new Error('disk unavailable');
          assert.deepEqual(expected, row ? { revision: row.revision, contentHash: row.contentHash } : null);
          row = { checkpoint, revision, contentHash: `checkpoint-${revision}` }; return row;
        } };
      } };
    return { model, controller: createMakerV8LocalPlayerControls({ session }) };
  }
  const h = open(); await h.controller.initialize();
  await h.controller.dispatch('player-soul-document', { soulKey: 'soulMd', value: 'Personal text' });
  const saved = row;
  failSave = true;
  await h.controller.dispatch('player-reset-all-soul');
  assert.equal(row, saved);
  assert.equal(h.controller.hasUnsavedChanges(), true);
  assert.equal(h.controller.getView().save.state, 'error');
  assert.equal(h.model.getSnapshot().soulDocuments.soulMd, document.livingContent.soulMd);
  failSave = false;
  await h.controller.dispatch('player-retry-save');
  assert.equal(h.controller.hasUnsavedChanges(), false);
  const reopened = open(); await reopened.controller.initialize();
  assert.deepEqual(reopened.model.getSnapshot().soulDocuments, h.model.getSnapshot().soulDocuments);
  await h.controller.dispose(); await reopened.controller.dispose();
});

test('local checkpoint download fences delayed exports after edits and disposal', async (t) => {
  for (const boundary of ['edit', 'dispose']) await t.test(boundary, async () => {
    let release;
    const downloads = [];
    const h = harness({ exportCheckpoint: () => new Promise((resolve) => { release = resolve; }), recipeExport: (text) => downloads.push(text) });
    const serialized = h.model.exportCheckpoint();
    const pending = h.controller.dispatch('player-export');
    if (boundary === 'edit') await h.controller.dispatch('player-profile-name', { value: 'Newer' });
    else h.controller.dispose();
    release(serialized);
    assert.equal(await pending, null);
    assert.equal(downloads.length, 0);
  });
});
