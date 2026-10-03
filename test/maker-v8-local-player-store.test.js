import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';
import { createMakerV8LocalPlayerStore } from '../maker-v8-local-player-store.js';

function fixture() {
  const model = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local' }) });
  const inner = JSON.parse(model.exportCheckpoint());
  const binding = { draftId: inner.draftId, draftRevision: inner.draftRevision, documentHash: inner.documentHash, assetHash: 'aa'.repeat(32) };
  const checkpoint = () => JSON.stringify({ assetHash: binding.assetHash, checkpoint: model.exportCheckpoint(), schemaVersion: 'animacraft.maker-v8-local-player-bundle-checkpoint.v1' });
  return { model, binding, checkpoint };
}
const expected = (row) => ({ revision: row.revision, contentHash: row.contentHash });
function edit(model, name) {
  const current = model.getSnapshot();
  model.setPersonalization({ profile: { ...current.profile, name }, soulDocuments: current.soulDocuments }, current.revision);
}

test('local checkpoint storage atomically saves, verifies, no-ops and cold-reopens independently', async () => {
  const indexedDB = new IDBFactory();
  const f = fixture();
  const store = createMakerV8LocalPlayerStore(indexedDB);
  assert.equal(await store.load(f.binding), null);
  const first = await store.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: null });
  assert.equal(first.revision, 1);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(await store.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: expected(first) }), first);
  store.close();
  const reopened = createMakerV8LocalPlayerStore(indexedDB);
  assert.deepEqual(await reopened.load(f.binding), first);
  edit(f.model, 'Reopened');
  const second = await reopened.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: expected(first) });
  assert.equal(second.revision, 2);
  assert.notEqual(second.contentHash, first.contentHash);
  const coldModel = fixture().model;
  coldModel.restoreCheckpoint(JSON.parse(second.checkpoint).checkpoint, 0);
  assert.equal(coldModel.getSnapshot().profile.name, 'Reopened');
  await assert.rejects(store.load(f.binding), { code: 'LOCAL_PLAYER_STORE_CLOSED' });
  reopened.close();
});

test('two database connections cannot overwrite an unobserved checkpoint even with matching content', async () => {
  const indexedDB = new IDBFactory();
  const a = createMakerV8LocalPlayerStore(indexedDB);
  const b = createMakerV8LocalPlayerStore(indexedDB);
  const f = fixture();
  const first = await a.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: null });
  edit(f.model, 'A');
  const input = { binding: f.binding, checkpoint: f.checkpoint(), expected: expected(first) };
  const results = await Promise.allSettled([a.save(input), b.save(input)]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(results.find((row) => row.status === 'rejected').reason.code, 'LOCAL_PLAYER_STORE_CAS_CONFLICT');
  const latest = await a.load(f.binding);
  await assert.rejects(b.save({ ...input, expected: { revision: latest.revision, contentHash: first.contentHash } }), { code: 'LOCAL_PLAYER_STORE_CAS_CONFLICT' });
  await assert.rejects(b.save({ ...input, expected: null }), { code: 'LOCAL_PLAYER_STORE_CAS_CONFLICT' });
  assert.deepEqual(await b.load(f.binding), latest);
  a.close(); b.close();
});

test('foreign and malformed checkpoint writes reject before mutation', async () => {
  const store = createMakerV8LocalPlayerStore(new IDBFactory());
  const f = fixture();
  for (const input of [
    { binding: f.binding, checkpoint: f.checkpoint(), expected: null, wallet: 'not-local' },
    { binding: { ...f.binding, assetHash: 'bb'.repeat(32) }, checkpoint: f.checkpoint(), expected: null },
    { binding: { ...f.binding, rootId: 'fake' }, checkpoint: f.checkpoint(), expected: null },
    { binding: f.binding, checkpoint: f.checkpoint(), expected: undefined },
    { binding: f.binding, checkpoint: ` ${f.checkpoint()}`, expected: null },
    { binding: f.binding, checkpoint: '{"schemaVersion":"authenticated"}', expected: null },
    { binding: f.binding, checkpoint: f.checkpoint(), expected: { revision: 0, contentHash: 'aa'.repeat(32) } },
  ]) await assert.rejects(store.save(input));
  let accessed = false;
  const accessor = { binding: f.binding, expected: null, get checkpoint() { accessed = true; return f.checkpoint(); } };
  await assert.rejects(store.save(accessor));
  assert.equal(accessed, false);
  assert.equal(await store.load(f.binding), null);
  store.close();
});

test('tampered durable rows fail closed and are never overwritten by a new save', async () => {
  const indexedDB = new IDBFactory();
  const store = createMakerV8LocalPlayerStore(indexedDB);
  const f = fixture();
  const first = await store.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: null });
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('animacraft-maker-v8-local-player-checkpoints', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('checkpoints', 'readwrite');
    tx.objectStore('checkpoints').put({ ...first, contentHash: 'bb'.repeat(32) });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(store.load(f.binding), { code: 'LOCAL_PLAYER_STORE_CORRUPT' });
  await assert.rejects(store.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: expected(first) }), { code: 'LOCAL_PLAYER_STORE_CORRUPT' });
  db.close(); store.close();
});

test('quota errors and transaction aborts preserve the prior durable checkpoint and allow exact retry', async (t) => {
  for (const failure of ['quota', 'abort']) await t.test(failure, async () => {
    const store = createMakerV8LocalPlayerStore(new IDBFactory());
    const f = fixture();
    const first = await store.save({ binding: f.binding, checkpoint: f.checkpoint(), expected: null });
    edit(f.model, 'Pending retry');
    const input = { binding: f.binding, checkpoint: f.checkpoint(), expected: expected(first) };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (failure === 'quota') throw new DOMException('Full storage', 'QuotaExceededError');
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
    try { await assert.rejects(store.save(input)); } finally { IDBObjectStore.prototype.put = put; }
    assert.deepEqual(await store.load(f.binding), first);
    const retried = await store.save(input);
    assert.equal(retried.revision, 2);
    assert.equal(retried.checkpoint, input.checkpoint);
    store.close();
  });
});
