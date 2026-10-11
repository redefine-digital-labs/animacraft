import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_DRAFT_BASE_REVISION_FIELD,
  MAKER_DRAFT_REVISION_FIELD,
  createMakerDraftRepository,
} from '../maker-draft-repository.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function memoryStorage(overrides = {}) {
  const documents = new Map();
  const assets = new Map();
  const checkpoints = new Map();
  const calls = [];
  const checkpointsFor = (makerKey) => {
    if (!checkpoints.has(makerKey)) checkpoints.set(makerKey, new Map());
    return checkpoints.get(makerKey);
  };
  const adapter = {
    async loadDocument(makerKey) {
      calls.push(['load-document', makerKey]);
      return documents.has(makerKey) ? structuredClone(documents.get(makerKey)) : null;
    },
    async saveDocument(makerKey, document, metadata) {
      calls.push(['save-document', makerKey, metadata[MAKER_DRAFT_REVISION_FIELD]]);
      documents.set(makerKey, {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
        savedAt: metadata.draftCommittedAt,
      });
      const revision = metadata[MAKER_DRAFT_REVISION_FIELD];
      checkpointsFor(makerKey).set(revision, {
        makerKey,
        revision,
        document: structuredClone(document),
        recipe: metadata.recipe === undefined ? undefined : structuredClone(metadata.recipe),
        metadata: structuredClone(metadata),
        savedAt: metadata.draftCommittedAt,
      });
    },
    async loadAssets(makerKey) {
      calls.push(['load-assets', makerKey]);
      return structuredClone(assets.get(makerKey) || []);
    },
    async upsertAssets(makerKey, records) {
      calls.push(['upsert-assets', makerKey, records.map((record) => record.assetId)]);
      const byId = new Map((assets.get(makerKey) || []).map((record) => [record.assetId, record]));
      records.forEach((record) => byId.set(record.assetId, structuredClone(record)));
      assets.set(makerKey, [...byId.values()]);
    },
    async listCheckpoints(makerKey) {
      calls.push(['list-checkpoints', makerKey]);
      return structuredClone(
        [...checkpointsFor(makerKey).values()].sort((left, right) => right.revision - left.revision),
      );
    },
    async restoreCheckpoint(makerKey, checkpointRevision, options = {}) {
      calls.push(['restore-checkpoint', makerKey, checkpointRevision]);
      const historical = checkpointsFor(makerKey).get(checkpointRevision);
      if (!historical) throw new Error('checkpoint not found');
      const currentRevision = documents.get(makerKey)?.metadata?.[MAKER_DRAFT_REVISION_FIELD] ?? -1;
      const restoredRevision = Math.max(currentRevision, options.minimumRevision ?? -1) + 1;
      const metadata = {
        ...structuredClone(historical.metadata),
        [MAKER_DRAFT_REVISION_FIELD]: restoredRevision,
        draftCommittedAt: options.draftCommittedAt,
        restoredFromRevision: checkpointRevision,
      };
      const record = {
        makerKey,
        document: structuredClone(historical.document),
        metadata,
        savedAt: options.draftCommittedAt,
      };
      documents.set(makerKey, structuredClone(record));
      checkpointsFor(makerKey).set(restoredRevision, {
        makerKey,
        revision: restoredRevision,
        document: structuredClone(record.document),
        recipe: metadata.recipe === undefined ? undefined : structuredClone(metadata.recipe),
        metadata: structuredClone(metadata),
        savedAt: record.savedAt,
      });
      return {
        committed: true,
        persistedRevision: restoredRevision,
        restoredFromRevision: checkpointRevision,
        savedAt: record.savedAt,
        record: structuredClone(record),
      };
    },
    ...overrides,
  };
  return {
    adapter,
    documents,
    assets,
    checkpoints,
    calls,
  };
}

function snapshot(revision, name = `Revision ${revision}`, extras = {}) {
  return {
    revision,
    baseRevision: null,
    document: { metadata: { name }, parts: [] },
    recipe: { selections: [{ partId: 'hair', itemId: `item-${revision}` }], colors: [] },
    journal: [{ label: `Edit ${revision}` }],
    metadata: { walletAddress: '0xowner' },
    ...extras,
  };
}

test('clones an immutable revision snapshot when save is requested and confirms only after commit', async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let written;
  const storage = memoryStorage({
    async saveDocument(makerKey, document, metadata) {
      written = { makerKey, document, metadata };
      writeStarted.resolve();
      await releaseWrite.promise;
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter, clock: () => 1234 });
  const input = snapshot(1, 'Original', {
    assets: [{ assetId: 'hair-png', blob: new Blob(['original']) }],
  });

  const saving = repository.save('maker-one', input);
  input.document.metadata.name = 'Mutated outside';
  input.recipe.selections[0].itemId = 'mutated-outside';
  input.assets[0].assetId = 'mutated-outside';

  await writeStarted.promise;
  assert.equal(repository.getStatus('maker-one').persistedRevision, null);
  assert.equal(repository.getStatus('maker-one').savingRevision, 1);
  releaseWrite.resolve();

  const result = await saving;
  assert.deepEqual(result, {
    makerKey: 'maker-one',
    requestedRevision: 1,
    persistedRevision: 1,
    confirmed: true,
    superseded: false,
    conflict: false,
  });
  assert.equal(written.document.metadata.name, 'Original');
  assert.equal(written.metadata.recipe.selections[0].itemId, 'item-1');
  assert.equal(written.metadata[MAKER_DRAFT_REVISION_FIELD], 1);
  assert.equal(written.metadata[MAKER_DRAFT_BASE_REVISION_FIELD], null);
  assert.equal(written.metadata.draftCommittedAt, 1234);
  assert.deepEqual(storage.calls.find((call) => call[0] === 'upsert-assets')[2], ['hair-png']);
});

test('serializes one Maker key, skips queued intermediate revisions and leaves the newest write persisted', async () => {
  const firstWriteStarted = deferred();
  const releaseFirstWrite = deferred();
  const writes = [];
  const writeBases = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const storage = memoryStorage({
    async saveDocument(makerKey, document, metadata) {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      writes.push(metadata[MAKER_DRAFT_REVISION_FIELD]);
      writeBases.push(metadata[MAKER_DRAFT_BASE_REVISION_FIELD]);
      if (metadata[MAKER_DRAFT_REVISION_FIELD] === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      storage.documents.set(makerKey, {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
        savedAt: metadata.draftCommittedAt,
      });
      activeWrites -= 1;
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter });

  const revisionOne = repository.save('maker-one', snapshot(1));
  await firstWriteStarted.promise;
  const revisionTwo = repository.save('maker-one', snapshot(2));
  const duplicateRevisionTwo = repository.save('maker-one', snapshot(2, 'Must not replace immutable revision 2'));
  const revisionThree = repository.save('maker-one', snapshot(3));
  assert.strictEqual(duplicateRevisionTwo, revisionTwo);
  releaseFirstWrite.resolve();

  assert.equal((await revisionOne).confirmed, true);
  assert.deepEqual(await revisionTwo, {
    makerKey: 'maker-one',
    requestedRevision: 2,
    persistedRevision: 1,
    confirmed: false,
    superseded: true,
    conflict: false,
  });
  assert.equal((await revisionThree).confirmed, true);
  assert.deepEqual(writes, [1, 3]);
  assert.deepEqual(writeBases, [null, 1]);
  assert.equal(maximumActiveWrites, 1);
  assert.equal(storage.documents.get('maker-one').document.metadata.name, 'Revision 3');
  assert.equal(repository.getStatus('maker-one').persistedRevision, 3);
});

test('never lets an older revision overwrite a newer persisted revision', async () => {
  const storage = memoryStorage();
  const repository = createMakerDraftRepository({ storage: storage.adapter });
  await repository.save('maker-one', snapshot(7));

  const stale = await repository.save('maker-one', snapshot(6, 'Stale'));
  assert.equal(stale.confirmed, false);
  assert.equal(stale.superseded, true);
  assert.equal(stale.persistedRevision, 7);
  assert.equal(storage.documents.get('maker-one').document.metadata.name, 'Revision 7');
  assert.deepEqual(
    storage.calls.filter((call) => call[0] === 'save-document').map((call) => call[2]),
    [7],
  );
});

test('a late save from an older repository instance cannot overwrite a newer tab revision', async () => {
  const oldCommitReachedStorage = deferred();
  const releaseOldCommit = deferred();
  let record = null;
  const sharedStorage = {
    async loadDocument() {
      return record ? structuredClone(record) : null;
    },
    async loadAssets() {
      return [];
    },
    async commitSnapshot(makerKey, document, metadata) {
      const revision = metadata[MAKER_DRAFT_REVISION_FIELD];
      const baseRevision = metadata[MAKER_DRAFT_BASE_REVISION_FIELD];
      if (revision === 1) {
        oldCommitReachedStorage.resolve();
        await releaseOldCommit.promise;
      }
      const persistedRevision = record?.metadata?.[MAKER_DRAFT_REVISION_FIELD] ?? null;
      const baseMatches = baseRevision === null
        ? record === null
        : persistedRevision === baseRevision;
      if (!baseMatches || (persistedRevision !== null && revision <= persistedRevision)) {
        return {
          committed: false,
          persistedRevision,
          savedAt: record?.savedAt ?? null,
          conflict: true,
        };
      }
      record = {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
        savedAt: metadata.draftCommittedAt,
      };
      return {
        committed: true,
        persistedRevision: revision,
        savedAt: record.savedAt,
        conflict: false,
      };
    },
  };
  const olderTab = createMakerDraftRepository({ storage: sharedStorage, clock: () => 100 });
  const newerTab = createMakerDraftRepository({ storage: sharedStorage, clock: () => 200 });

  const oldSave = olderTab.save('maker-one', snapshot(1, 'Old tab'));
  await oldCommitReachedStorage.promise;
  const newSave = await newerTab.save('maker-one', snapshot(2, 'New tab'));
  releaseOldCommit.resolve();
  const rejectedOldSave = await oldSave;

  assert.equal(newSave.confirmed, true);
  assert.equal(rejectedOldSave.confirmed, false);
  assert.equal(rejectedOldSave.superseded, true);
  assert.equal(rejectedOldSave.persistedRevision, 2);
  assert.equal(record.document.metadata.name, 'New tab');

  const staleHigherTab = createMakerDraftRepository({ storage: sharedStorage, clock: () => 250 });
  await staleHigherTab.load('maker-one');
  await newerTab.save('maker-one', snapshot(3, 'New tab continued'));
  const rejectedHigherLocalRevision = await staleHigherTab.save(
    'maker-one',
    snapshot(99, 'Stale branch with more local commands', { baseRevision: 2 }),
  );
  assert.equal(rejectedHigherLocalRevision.confirmed, false);
  assert.equal(rejectedHigherLocalRevision.conflict, true);
  assert.equal(rejectedHigherLocalRevision.persistedRevision, 3);
  assert.equal(record.document.metadata.name, 'New tab continued');
});

test('keeps Maker keys independent so unrelated drafts can save in parallel', async () => {
  const bothStarted = deferred();
  const releaseWrites = deferred();
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const startedKeys = new Set();
  const storage = memoryStorage({
    async saveDocument(makerKey, document, metadata) {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      startedKeys.add(makerKey);
      if (startedKeys.size === 2) bothStarted.resolve();
      await releaseWrites.promise;
      storage.documents.set(makerKey, {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
      });
      activeWrites -= 1;
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter });

  const makerA = repository.save('maker-a', snapshot(1, 'A'));
  const makerB = repository.save('maker-b', snapshot(1, 'B'));
  await bothStarted.promise;
  assert.equal(maximumActiveWrites, 2);
  releaseWrites.resolve();
  await Promise.all([makerA, makerB]);
  assert.equal(storage.documents.get('maker-a').document.metadata.name, 'A');
  assert.equal(storage.documents.get('maker-b').document.metadata.name, 'B');
});

test('does not confirm a failed write and permits an explicit same-revision retry', async () => {
  let shouldFail = true;
  const storage = memoryStorage({
    async saveDocument(makerKey, document, metadata) {
      if (shouldFail) throw new Error('disk full');
      storage.documents.set(makerKey, {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
      });
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter });

  await assert.rejects(repository.save('maker-one', snapshot(1)), /disk full/);
  assert.equal(repository.getStatus('maker-one').persistedRevision, null);
  assert.equal(repository.getStatus('maker-one').error, 'disk full');

  shouldFail = false;
  const retried = await repository.save('maker-one', snapshot(1));
  assert.equal(retried.confirmed, true);
  assert.equal(retried.persistedRevision, 1);
  assert.equal(repository.getStatus('maker-one').error, '');
});

test('writes assets before the document commit and abandons a stale document discovered mid-upload', async () => {
  const assetWriteStarted = deferred();
  const releaseAssetWrite = deferred();
  const events = [];
  let firstAssetWrite = true;
  const storage = memoryStorage({
    async upsertAssets(makerKey, records) {
      events.push(`assets:${records[0].assetId}`);
      if (firstAssetWrite) {
        firstAssetWrite = false;
        assetWriteStarted.resolve();
        await releaseAssetWrite.promise;
      }
    },
    async saveDocument(makerKey, document, metadata) {
      events.push(`document:${metadata[MAKER_DRAFT_REVISION_FIELD]}`);
      storage.documents.set(makerKey, { makerKey, document, metadata });
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter });

  const first = repository.save('maker-one', snapshot(1, 'One', {
    assets: [{ assetId: 'asset-one', blob: new Blob(['one']) }],
  }));
  await assetWriteStarted.promise;
  const second = repository.save('maker-one', snapshot(2, 'Two', {
    assets: [{ assetId: 'asset-two', blob: new Blob(['two']) }],
  }));
  releaseAssetWrite.resolve();

  assert.equal((await first).superseded, true);
  assert.equal((await second).confirmed, true);
  assert.deepEqual(events, ['assets:asset-one', 'assets:asset-two', 'document:2']);
});

test('loads persisted revision, document, recipe and assets before rejecting stale future saves', async () => {
  const storage = memoryStorage();
  storage.documents.set('maker-one', {
    makerKey: 'maker-one',
    document: { metadata: { name: 'Restored' }, parts: [] },
    metadata: {
      [MAKER_DRAFT_REVISION_FIELD]: 12,
      recipe: { selections: [], colors: [{ channelId: 'hair', value: '#000000' }] },
      journal: [{ label: 'Restored edit' }],
    },
    savedAt: 4567,
  });
  storage.assets.set('maker-one', [{ assetId: 'restored-png', blob: new Blob(['png']) }]);
  const repository = createMakerDraftRepository({ storage: storage.adapter });

  const loaded = await repository.load('maker-one');
  assert.equal(loaded.revision, 12);
  assert.equal(loaded.document.metadata.name, 'Restored');
  assert.equal(loaded.recipe.colors[0].channelId, 'hair');
  assert.equal(loaded.assets[0].assetId, 'restored-png');
  assert.equal(repository.getStatus('maker-one').persistedRevision, 12);

  const stale = await repository.save('maker-one', snapshot(11));
  assert.equal(stale.superseded, true);
  assert.equal(stale.persistedRevision, 12);
  assert.equal(stale.conflict, false);
  const equalRevisionConflict = await repository.save('maker-one', snapshot(12, 'Conflicting content'));
  assert.equal(equalRevisionConflict.confirmed, false);
  assert.equal(equalRevisionConflict.superseded, true);
  assert.equal(equalRevisionConflict.conflict, true);
  assert.equal(storage.documents.get('maker-one').document.metadata.name, 'Restored');
});

test('flush waits for all writes that were queued before it resolves', async () => {
  const releaseWrite = deferred();
  const writeStarted = deferred();
  const storage = memoryStorage({
    async saveDocument(makerKey, document, metadata) {
      writeStarted.resolve();
      await releaseWrite.promise;
      storage.documents.set(makerKey, { makerKey, document, metadata });
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter });
  repository.save('maker-one', snapshot(1));
  await writeStarted.promise;

  let flushed = false;
  const flushing = repository.flush('maker-one').then((value) => {
    flushed = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(flushed, false);
  releaseWrite.resolve();
  const status = await flushing;
  assert.equal(status.persistedRevision, 1);
  assert.equal(status.pending, 0);
});

test('lists immutable checkpoints and restores one as a higher current revision', async () => {
  const storage = memoryStorage();
  let now = 100;
  const repository = createMakerDraftRepository({
    storage: storage.adapter,
    clock: () => now,
  });

  await repository.save('maker-one', snapshot(1, 'Historical'));
  now = 200;
  await repository.save('maker-one', snapshot(2, 'Current'));

  const listed = await repository.listCheckpoints('maker-one');
  assert.deepEqual(listed.map((checkpoint) => checkpoint.revision), [2, 1]);
  listed[1].document.metadata.name = 'Mutated list result';
  assert.equal(storage.checkpoints.get('maker-one').get(1).document.metadata.name, 'Historical');

  now = 300;
  const restored = await repository.restoreCheckpoint('maker-one', 1);
  assert.equal(restored.restoredFromRevision, 1);
  assert.equal(restored.revision, 3);
  assert.equal(restored.persistedRevision, 3);
  assert.equal(restored.document.metadata.name, 'Historical');
  assert.equal(restored.recipe.selections[0].itemId, 'item-1');
  assert.equal(restored.metadata.draftRevision, 3);
  assert.equal(restored.metadata.restoredFromRevision, 1);
  assert.equal(restored.savedAt, 300);
  assert.equal(repository.getStatus('maker-one').persistedRevision, 3);
  assert.equal(storage.documents.get('maker-one').document.metadata.name, 'Historical');

  const stale = await repository.save('maker-one', snapshot(2, 'Must stay stale'));
  assert.equal(stale.superseded, true);
  assert.equal(stale.persistedRevision, 3);
  assert.deepEqual(
    (await repository.listCheckpoints('maker-one')).map((checkpoint) => checkpoint.revision),
    [3, 2, 1],
  );
});
