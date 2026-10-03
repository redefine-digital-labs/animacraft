import assert from 'node:assert/strict';
import test from 'node:test';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { createMakerV8LocalPlayerPersistence } from '../maker-v8-local-player-persistence.js';

function fixture({ load = async () => null, save } = {}) {
  const model = createMakerV8LocalPlayer({ draftId: 'local', draftRevision: 1,
    document: createCharacterMakerV8Starter({ makerKey: 'local' }) });
  const writes = [];
  const changes = [];
  const session = { ...model, loadCheckpoint: load, captureCheckpointSave() {
    const checkpoint = model.exportCheckpoint();
    return Object.freeze({ revision: model.getSnapshot().revision, async commit(expected) {
    writes.push({ expected, checkpoint });
    return save ? save(expected, checkpoint, writes.length) : {
      revision: (expected?.revision || 0) + 1, contentHash: String(writes.length).padStart(64, '0'), checkpoint,
    };
    } });
  } };
  const persistence = createMakerV8LocalPlayerPersistence(session, (status) => changes.push(status));
  const edit = (name) => {
    const value = model.getSnapshot();
    model.setPersonalization({ profile: { ...value.profile, name }, soulDocuments: value.soulDocuments }, value.revision);
  };
  return { model, persistence, writes, changes, edit };
}

test('local persistence restores before edits and acknowledges the loaded durable base', async () => {
  const source = fixture(); source.edit('Recovered');
  const row = { revision: 7, contentHash: 'aa'.repeat(32), checkpoint: source.model.exportCheckpoint() };
  const h = fixture({ load: async () => row });
  await assert.rejects(h.persistence.save(), /recovery/);
  await h.persistence.initialize();
  assert.equal(h.model.getSnapshot().profile.name, 'Recovered');
  assert.equal(h.persistence.getStatus().state, 'saved');
  assert.equal(h.persistence.getStatus().savedAt, '');
  assert.equal(h.writes.length, 0);
  h.edit('Updated'); await h.persistence.save();
  assert.equal(h.persistence.getStatus().savedAt, '');
  assert.deepEqual(h.writes[0].expected, { revision: 7, contentHash: row.contentHash });
});

test('edits during a pending save drain against its durable acknowledgement, not a stale base', async () => {
  let release;
  const h = fixture({ save: async (expected, checkpoint, count) => {
    if (count === 1) await new Promise((resolve) => { release = resolve; });
    return { revision: count, contentHash: String(count).padStart(64, '0'), checkpoint };
  } });
  await h.persistence.initialize();
  h.edit('First'); const pending = h.persistence.save();
  await Promise.resolve();
  h.edit('Latest'); assert.equal(h.persistence.save(), pending);
  release(); await pending;
  assert.equal(h.writes.length, 2);
  assert.equal(JSON.parse(h.writes[0].checkpoint).profile.name, 'First');
  assert.equal(JSON.parse(h.writes[1].checkpoint).profile.name, 'Latest');
  assert.deepEqual(h.writes[1].expected, { revision: 1, contentHash: '1'.padStart(64, '0') });
  assert.equal(h.persistence.getStatus().state, 'saved');
});

test('save failure retains the original expected base and exact checkpoint for retry', async () => {
  let unavailable = true;
  const h = fixture({ save: async (expected, checkpoint) => {
    if (unavailable) throw Object.assign(new Error('conflict or quota'), { code: 'LOCAL_PLAYER_STORE_CAS_CONFLICT' });
    return { revision: 1, contentHash: 'aa'.repeat(32), checkpoint };
  } });
  await h.persistence.initialize(); h.edit('Unsaved');
  await assert.rejects(h.persistence.save(), /conflict/);
  assert.equal(h.persistence.getStatus().state, 'error');
  assert.equal(h.model.getSnapshot().profile.name, 'Unsaved');
  unavailable = false; await h.persistence.flush();
  assert.deepEqual(h.writes[1], h.writes[0]);
  assert.equal(h.persistence.getStatus().state, 'saved');
});

test('disposed local recovery and old save completions never resurrect or notify the closed view', async () => {
  let release;
  const h = fixture({ save: async (expected, checkpoint) => {
    await new Promise((resolve) => { release = resolve; });
    return { revision: 1, contentHash: 'aa'.repeat(32), checkpoint };
  } });
  await h.persistence.initialize(); h.edit('Old');
  const pending = h.persistence.save(); await Promise.resolve();
  h.persistence.dispose(); const count = h.changes.length;
  release(); await pending;
  assert.equal(h.changes.length, count);
  assert.throws(() => h.persistence.save(), /closed/);
  const source = fixture(); source.edit('Should not restore');
  let resolveLoad;
  const late = fixture({ load: () => new Promise((resolve) => { resolveLoad = resolve; }) });
  const opening = late.persistence.initialize(); late.persistence.dispose();
  resolveLoad({ checkpoint: source.model.exportCheckpoint() });
  assert.equal(await opening, null);
  assert.equal(late.model.getSnapshot().profile.name, '');
});

test('corrupt recovery cannot silently initialize empty and overwrite existing data', async () => {
  const h = fixture({ load: async () => ({ checkpoint: 'corrupt' }) });
  await assert.rejects(h.persistence.initialize());
  await assert.rejects(h.persistence.save(), /recovery/);
  assert.equal(h.persistence.isReady(), false);
  assert.equal(h.writes.length, 0);
});

test('forced disposal drains the newest captured edit after an older pending save, without accessing the closed model', async () => {
  let release;
  let durable;
  const h = fixture({ save: async (expected, checkpoint, count) => {
    if (count === 1) await new Promise((resolve) => { release = resolve; });
    durable = checkpoint;
    return { revision: count, contentHash: String(count).padStart(64, '0'), checkpoint };
  } });
  await h.persistence.initialize();
  h.edit('first'); const saving = h.persistence.save(); await Promise.resolve();
  h.edit('latest'); h.persistence.save();
  const drained = h.persistence.dispose();
  h.model.dispose();
  const notifications = h.changes.length;
  release(); await saving; await drained;
  assert.equal(JSON.parse(durable).profile.name, 'latest');
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].expected.revision, 1);
  assert.equal(h.changes.length, notifications);
});
