import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalMakerV8Json } from '../maker-v8-compiler.js';
import { encodeMakerV8ProjectZip, decodeMakerV8ProjectZip } from '../maker-v8-project-zip.js';

import { indexedDB } from 'fake-indexeddb';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import {
  MAKER_V8_DRAFT_ASSET_SCHEMA,
  MAKER_V8_DRAFT_EXPORT_SCHEMA,
  MAKER_V8_DRAFT_RECORD_SCHEMA,
  createMakerV8DraftPersistence,
} from '../maker-v8-draft-store.js';
import { toBase64 } from '@mysten/sui/utils';

const objectIdForTest = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;

test('legacy-rule ZIP authenticates original bundle before import and replacement projection', async () => {
  const source = store(`legacy-zip-source-${crypto.randomUUID()}`);
  const target = store(`legacy-zip-target-${crypto.randomUUID()}`);
  try {
    await createStarterBundle(source, { draftId: 'old-project', document: createCharacterMakerV8Starter(), createdAt: 10 });
    const original = structuredClone(await source.export('old-project'));
    original.draft.document.rules = [{ key: 'old', kind: 'REQUIRE', left: { partKey: 'base', itemKey: 'default' }, right: { partKey: 'base', itemKey: 'default' }, payload: { note: 'original' } }];
    const sign = bundle => {
      bundle.draftSha256 = createHash('sha256').update(canonicalMakerV8Json({ draft: bundle.draft, assets: bundle.assets })).digest('hex');
      return bundle;
    };
    sign(original);
    const bundle = decodeMakerV8ProjectZip(encodeMakerV8ProjectZip(original));
    const imported = await target.importBundle(bundle);
    assert.equal(imported.draft.revision, original.draft.revision);
    assert.equal(imported.draft.document.rules[0].trigger.source, 'BASE');
    assert.equal(imported.draft.document.rules[0].payload.note, 'original');
    assert.deepEqual(imported.assets, original.assets);
    assert.deepEqual(bundle, original);
    await createStarterBundle(target, { draftId: 'replacement', document: createCharacterMakerV8Starter(), createdAt: 10 });
    const replaced = await target.replaceBundle({ draftId: 'replacement', expectedRevision: 1, bundle, updatedAt: 20 });
    assert.equal(replaced.draft.revision, 2);
    assert.deepEqual(replaced.draft.document.rules, imported.draft.document.rules);
    assert.equal(replaced.assets[0].draftId, 'replacement');
    await assert.rejects(target.replaceBundle({ draftId: 'replacement', expectedRevision: 1, bundle, updatedAt: 21 }), { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' });
    const tampered = structuredClone(bundle);
    tampered.draft.document.rules[0].payload.note = 'tampered';
    await assert.rejects(target.importBundle(tampered), { code: 'MAKER_V8_DRAFT_EXPORT_HASH_MISMATCH' });
    await assert.rejects(target.replaceBundle({ draftId: 'replacement', expectedRevision: 2, bundle: tampered, updatedAt: 21 }), { code: 'MAKER_V8_DRAFT_EXPORT_HASH_MISMATCH' });
    const badBytes = structuredClone(bundle);
    badBytes.assets[0].bytesBase64 = toBase64(new Uint8Array([1]));
    sign(badBytes);
    await assert.rejects(target.importBundle(badBytes), { code: 'MAKER_V8_DRAFT_ASSET_DOCUMENT_DRIFT' });
    for (const location of ['bundle', 'draft', 'rule', 'asset']) {
      const unknown = structuredClone(bundle);
      const row = location === 'bundle' ? unknown : location === 'draft' ? unknown.draft : location === 'rule' ? unknown.draft.document.rules[0] : unknown.assets[0];
      row.extra = true;
      sign(unknown);
      await assert.rejects(target.importBundle(unknown));
    }
    assert.equal((await target.load('replacement')).revision, 2);
  } finally { source.close(); target.close(); }
});

function store(name, now = () => 100) {
  return createMakerV8DraftPersistence(indexedDB, { databaseName: name, now });
}

test('missing author Soul content upgrades without rewriting history; canonical blanks survive reopen and ZIP', async () => {
  const name = `soul-author-upgrade-${crypto.randomUUID()}`;
  const persistence = store(name);
  const target = store(`${name}-import`);
  const document = structuredClone(createCharacterMakerV8Starter());
  await createStarterBundle(persistence, { draftId: 'soul-author', document, createdAt: 10 });
  const db = await requestResult(indexedDB.open(name, 4));
  try {
    const seed = db.transaction(['drafts', 'versions'], 'readwrite'); const seeded = transactionDone(seed);
    const raw = await requestResult(seed.objectStore('drafts').get('soul-author'));
    delete raw.document.livingContent;
    seed.objectStore('drafts').put(raw); seed.objectStore('versions').put(raw); await seeded;
    const loaded = await persistence.load('soul-author');
    assert.deepEqual(loaded.document.livingContent, document.livingContent);
    const read = db.transaction(['drafts'], 'readonly');
    assert.equal(Object.hasOwn((await requestResult(read.objectStore('drafts').get('soul-author'))).document, 'livingContent'), false);
    const next = structuredClone(loaded.document);
    next.livingContent.soulMd = '  # 原文\r\n{{OC_NAME}}\n'; next.livingContent.memoryMd = '';
    next.livingContent.customized.soulMd = true; next.livingContent.customized.memoryMd = true;
    await persistence.compareAndSwap({ draftId: 'soul-author', expectedRevision: 1, document: next, updatedAt: 20 });
    assert.deepEqual((await persistence.load('soul-author')).document.livingContent, next.livingContent);
    const bundle = decodeMakerV8ProjectZip(encodeMakerV8ProjectZip(await persistence.export('soul-author')));
    assert.deepEqual((await target.importBundle(bundle)).draft.document.livingContent, next.livingContent);
    const history = db.transaction(['versions'], 'readonly');
    assert.equal(Object.hasOwn((await requestResult(history.objectStore('versions').get(['soul-author', 1]))).document, 'livingContent'), false);
  } finally { db.close(); persistence.close(); target.close(); }
});

test('author-only legacy rule projection preserves raw history and CAS recovery', async () => {
  const name = 'author-rule-upgrade';
  const persistence = store(name);
  const document = structuredClone(createCharacterMakerV8Starter());
  await createStarterBundle(persistence, { draftId: 'rules', document, createdAt: 10 });
  const legacy = { key: 'old', kind: 'REQUIRE', left: { partKey: 'base', itemKey: 'default' }, right: { partKey: 'base', itemKey: 'default' }, payload: { note: 'retained' } };
  const db = await requestResult(indexedDB.open(name, 4));
  const seed = db.transaction(['drafts', 'versions'], 'readwrite'); const seeded = transactionDone(seed);
  const raw = await requestResult(seed.objectStore('drafts').get('rules'));
  const canonical = { key: 'canonical', kind: 'REQUIRE', trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null }, targetMode: 'ALL', targets: [{ source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null }], payload: {} };
  raw.document.rules = [legacy, canonical];
  seed.objectStore('drafts').put(raw); seed.objectStore('versions').put(raw);
  await seeded;
  const loaded = await persistence.load('rules');
  assert.equal(loaded.revision, 1); assert.equal(loaded.document.rules[0].trigger.source, 'BASE');
  assert.equal((await persistence.list())[0].document.rules[0].targets.length, 1);
  assert.equal((await persistence.listVersions('rules'))[0].document.rules[0].payload.note, 'retained');
  let read = db.transaction(['drafts', 'versions'], 'readonly');
  assert.deepEqual((await requestResult(read.objectStore('drafts').get('rules'))).document.rules, [legacy, canonical]);
  const next = await persistence.compareAndSwap({ draftId: 'rules', expectedRevision: 1, document: loaded.document, updatedAt: 20 });
  assert.equal(next.revision, 2);
  await assert.rejects(persistence.compareAndSwap({ draftId: 'rules', expectedRevision: 1, document: loaded.document, updatedAt: 21 }), /another tab|changed/i);
  const reopened = store(name);
  assert.equal((await reopened.load('rules')).revision, 2);
  const restored = await reopened.restoreVersion({ draftId: 'rules', expectedRevision: 2, revision: 1, updatedAt: 30 });
  assert.equal(restored.revision, 3); assert.deepEqual(restored.document.rules, loaded.document.rules);
  read = db.transaction(['versions'], 'readonly');
  assert.deepEqual((await requestResult(read.objectStore('versions').get(['rules', 1]))).document.rules, [legacy, canonical]);
  const corrupt = db.transaction(['drafts'], 'readwrite'); const done = transactionDone(corrupt);
  const bad = await requestResult(corrupt.objectStore('drafts').get('rules'));
  bad.document.rules.push({ ...legacy, key: 'unknown', extra: true }); corrupt.objectStore('drafts').put(bad); await done;
  await assert.rejects(reopened.load('rules'));
  db.close();
});

async function createStarterBundle(persistence, { draftId, document, createdAt }) {
  return persistence.createBundle({
    draftId,
    document,
    createdAt,
    assets: [{
      assetId: 'base-default',
      kind: 'layer',
      mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([0])),
    }],
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => {};
  });
}

async function mutateAssetVersion(databaseName, key, mutate) {
  const database = await requestResult(indexedDB.open(databaseName, 4));
  const transaction = database.transaction(['assetVersions'], 'readwrite');
  const done = transactionDone(transaction);
  const versions = transaction.objectStore('assetVersions');
  const current = await requestResult(versions.get(key));
  const next = mutate(structuredClone(current));
  if (next === null) versions.delete(key);
  else versions.put(next);
  await done;
  database.close();
}

async function mutateAssetBlob(databaseName, sha256, mutate) {
  const database = await requestResult(indexedDB.open(databaseName, 4));
  const transaction = database.transaction(['assetBlobs'], 'readwrite');
  const done = transactionDone(transaction);
  const blobs = transaction.objectStore('assetBlobs');
  const current = await requestResult(blobs.get(sha256));
  const next = mutate(structuredClone(current));
  if (next === null) blobs.delete(sha256);
  else blobs.put(next);
  await done;
  database.close();
}

async function mutateCurrentAsset(databaseName, key, mutate) {
  const database = await requestResult(indexedDB.open(databaseName, 4));
  const transaction = database.transaction(['assets'], 'readwrite');
  const done = transactionDone(transaction);
  const assets = transaction.objectStore('assets');
  assets.put(mutate(structuredClone(await requestResult(assets.get(key)))));
  await done;
  database.close();
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rawStoreRows(databaseName, storeName) {
  const database = await requestResult(indexedDB.open(databaseName, 4));
  const transaction = database.transaction([storeName], 'readonly');
  const done = transactionDone(transaction);
  const rows = await requestResult(transaction.objectStore(storeName).getAll());
  await done;
  database.close();
  return rows;
}

async function seedV2Database(databaseName) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = () => {
      const drafts = request.result.createObjectStore('drafts', { keyPath: 'draftId' });
      drafts.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      const assets = request.result.createObjectStore('assets', { keyPath: ['draftId', 'assetId'] });
      assets.createIndex('byDraft', 'draftId', { unique: false });
      const versions = request.result.createObjectStore('versions', { keyPath: ['draftId', 'revision'] });
      versions.createIndex('byDraft', 'draftId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const original = createCharacterMakerV8Starter({ makerKey: 'migrated-v2', name: 'V2 Original' });
  const changed = structuredClone(original);
  changed.metadata.name = 'V2 Current';
  const revisionOne = {
    schemaVersion: MAKER_V8_DRAFT_RECORD_SCHEMA,
    draftId: 'migrated-v2', revision: 1, createdAt: 100, updatedAt: 100, document: original,
  };
  const revisionTwo = {
    ...revisionOne, revision: 2, updatedAt: 101, document: changed,
  };
  const bytes = new Uint8Array([1]);
  const assetSha256 = await sha256(bytes);
  const transaction = database.transaction(['drafts', 'assets', 'versions'], 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('drafts').add(revisionTwo);
  transaction.objectStore('versions').add(revisionOne);
  transaction.objectStore('versions').add(revisionTwo);
  transaction.objectStore('assets').add({
    schemaVersion: MAKER_V8_DRAFT_ASSET_SCHEMA,
    draftId: 'migrated-v2', assetId: 'base-default', revision: 2,
    createdAt: 100, updatedAt: 101, kind: 'layer', mediaType: 'image/png',
    bytesBase64: toBase64(bytes), byteLength: bytes.length, sha256: assetSha256,
  });
  await done;
  database.close();
}

async function seedV3Database(databaseName) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 3);
    request.onupgradeneeded = () => {
      const drafts = request.result.createObjectStore('drafts', { keyPath: 'draftId' });
      drafts.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      const assets = request.result.createObjectStore('assets', { keyPath: ['draftId', 'assetId'] });
      assets.createIndex('byDraft', 'draftId', { unique: false });
      const versions = request.result.createObjectStore('versions', { keyPath: ['draftId', 'revision'] });
      versions.createIndex('byDraft', 'draftId', { unique: false });
      const assetVersions = request.result.createObjectStore('assetVersions', {
        keyPath: ['draftId', 'draftRevision', 'assetId'],
      });
      assetVersions.createIndex('byDraft', 'draftId', { unique: false });
      assetVersions.createIndex('byDraftRevision', ['draftId', 'draftRevision'], { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const original = createCharacterMakerV8Starter({ makerKey: 'migrated-v3', name: 'V3 Original' });
  const changed = structuredClone(original);
  changed.metadata.name = 'V3 Current';
  const revisionOne = {
    schemaVersion: MAKER_V8_DRAFT_RECORD_SCHEMA,
    draftId: 'migrated-v3', revision: 1, createdAt: 100, updatedAt: 100, document: original,
  };
  const revisionTwo = { ...revisionOne, revision: 2, updatedAt: 101, document: changed };
  const bytes = new Uint8Array([3]);
  const assetSha256 = await sha256(bytes);
  const asset = {
    schemaVersion: MAKER_V8_DRAFT_ASSET_SCHEMA,
    draftId: 'migrated-v3', assetId: 'base-default', revision: 1,
    createdAt: 100, updatedAt: 100, kind: 'layer', mediaType: 'image/png',
    bytesBase64: toBase64(bytes), byteLength: bytes.length, sha256: assetSha256,
  };
  const transaction = database.transaction(['drafts', 'assets', 'versions', 'assetVersions'], 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('drafts').add(revisionTwo);
  transaction.objectStore('assets').add(asset);
  transaction.objectStore('versions').add(revisionOne);
  transaction.objectStore('versions').add(revisionTwo);
  transaction.objectStore('assetVersions').add({ ...asset, draftRevision: 1 });
  transaction.objectStore('assetVersions').add({ ...asset, draftRevision: 2 });
  await done;
  database.close();
}

test('Maker v8 drafts create, reload, CAS, list, export, and delete without changing schema', async () => {
  const persistence = store(`draft-${crypto.randomUUID()}`);
  const document = createCharacterMakerV8Starter({ makerKey: 'astral', name: 'Astral' });
  const created = await createStarterBundle(persistence, { draftId: 'astral', document });
  assert.equal(created.draft.revision, 1);
  assert.equal(created.draft.document.schemaVersion, 'animacraft.maker.v8');
  assert.equal(Object.isFrozen(created.draft), true);
  const asset = created.assets[0];
  assert.equal(asset.schemaVersion, MAKER_V8_DRAFT_ASSET_SCHEMA);
  assert.equal((await persistence.listAssets('astral')).length, 1);

  const changed = structuredClone(created.draft.document);
  changed.metadata.summary = 'A safe local edit.';
  const saved = await persistence.compareAndSwap({
    draftId: 'astral', expectedRevision: 1, document: changed, updatedAt: 101,
  });
  assert.equal(saved.revision, 2);
  assert.equal((await persistence.load('astral')).document.metadata.summary, 'A safe local edit.');
  assert.deepEqual((await persistence.list()).map((row) => row.draftId), ['astral']);

  const bundle = await persistence.export('astral');
  assert.equal(bundle.schemaVersion, MAKER_V8_DRAFT_EXPORT_SCHEMA);
  assert.match(bundle.draftSha256, /^[0-9a-f]{64}$/);
  assert.equal(bundle.draft.revision, 2);
  assert.equal(bundle.assets[0].assetId, 'base-default');
  assert.equal(await persistence.delete({ draftId: 'astral', expectedRevision: 2 }), true);
  assert.equal(await persistence.load('astral'), null);
  assert.equal((await persistence.listAssets('astral')).length, 0);
  persistence.close();
});

test('draft CAS rejects stale tabs and never silently converts a non-v8 document', async () => {
  const persistence = store(`cas-${crypto.randomUUID()}`);
  const document = createCharacterMakerV8Starter({ makerKey: 'maker' });
  await createStarterBundle(persistence, { draftId: 'maker', document, createdAt: 100 });
  const left = structuredClone(document);
  left.metadata.name = 'Left';
  await persistence.compareAndSwap({ draftId: 'maker', expectedRevision: 1, document: left, updatedAt: 101 });

  const stale = structuredClone(document);
  stale.metadata.name = 'Stale';
  await assert.rejects(
    persistence.compareAndSwap({ draftId: 'maker', expectedRevision: 1, document: stale, updatedAt: 102 }),
    { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' },
  );
  await assert.rejects(
    persistence.compareAndSwap({
      draftId: 'maker', expectedRevision: 2,
      document: { ...stale, schemaVersion: 'animacraft.maker.v5' }, updatedAt: 102,
    }),
    { code: 'MAKER_V8_SCHEMA_INVALID' },
  );
  assert.equal((await persistence.load('maker')).document.metadata.name, 'Left');
  persistence.close();
});

test('draft version history is durable, bounded by CAS, and restores as a new revision', async () => {
  const persistence = store(`history-${crypto.randomUUID()}`, (() => { let at = 400; return () => at++; })());
  const original = createCharacterMakerV8Starter({ makerKey: 'history-maker', name: 'Original' });
  const created = await createStarterBundle(persistence, {
    draftId: 'history-maker', document: original, createdAt: 400,
  });
  const changed = structuredClone(created.draft.document);
  changed.metadata.name = 'Changed';
  const saved = await persistence.compareAndSwap({
    draftId: 'history-maker', expectedRevision: 1, document: changed, updatedAt: 401,
  });
  assert.deepEqual((await persistence.listVersions('history-maker')).map((row) => row.revision), [2, 1]);
  const restored = await persistence.restoreVersion({
    draftId: 'history-maker', expectedRevision: saved.revision, revision: 1, updatedAt: 402,
  });
  assert.equal(restored.revision, 3);
  assert.equal(restored.document.metadata.name, 'Original');
  assert.deepEqual((await persistence.listVersions('history-maker')).map((row) => row.revision), [3, 2, 1]);
  await assert.rejects(
    persistence.restoreVersion({ draftId: 'history-maker', expectedRevision: 2, revision: 1, updatedAt: 403 }),
    { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' },
  );
  persistence.close();
});

test('successor draft atomically copies exact local assets and binds N+1 chain lineage', async () => {
  const persistence = store(`successor-${crypto.randomUUID()}`);
  const sourceDocument = createCharacterMakerV8Starter({ makerKey: 'successor-maker', name: 'Version One' });
  await createStarterBundle(persistence, {
    draftId: 'successor-source', document: sourceDocument, createdAt: 500,
  });
  const successorDocument = structuredClone(sourceDocument);
  successorDocument.lineage.version = 2;
  successorDocument.lineage.previousRootId = objectIdForTest(700);
  successorDocument.lineage.previousVersionCommitment = 'ab'.repeat(32);
  const created = await persistence.createSuccessor({
    sourceDraftId: 'successor-source',
    sourceExpectedRevision: 1,
    draftId: 'successor-v2',
    document: successorDocument,
    createdAt: 502,
  });
  assert.equal(created.draft.document.lineage.version, 2);
  assert.equal(created.assets.length, 1);
  assert.equal(created.assets[0].draftId, 'successor-v2');
  assert.equal(created.assets[0].bytesBase64, toBase64(new Uint8Array([0])));
  assert.equal((await persistence.load('successor-source')).document.lineage.version, 1);
  await assert.rejects(
    persistence.createSuccessor({
      sourceDraftId: 'successor-source', sourceExpectedRevision: 2,
      draftId: 'successor-v3', document: successorDocument, createdAt: 503,
    }),
    { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' },
  );
  persistence.close();
});

test('history restore replaces current artwork with the exact historical bytes even at the same length', async () => {
  const persistence = store(`history-asset-${crypto.randomUUID()}`);
  const document = createCharacterMakerV8Starter({ makerKey: 'asset-history' });
  await createStarterBundle(persistence, { draftId: 'asset-history', document, createdAt: 100 });
  const updated = await persistence.upsertAsset({
    draftId: 'asset-history', expectedDraftRevision: 1, assetId: 'base-default', kind: 'layer',
    mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([1])),
    expectedAssetRevision: 1, updatedAt: 102,
  });
  const restored = await persistence.restoreVersion({
    draftId: 'asset-history', expectedRevision: updated.draft.revision, revision: 1, updatedAt: 103,
  });
  assert.equal(restored.revision, 3);
  assert.equal((await persistence.loadAsset('asset-history', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([0])));
  persistence.close();
});

test('history restore fails closed when historical asset bytes are missing or tampered', async () => {
  const databaseName = `history-tamper-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const document = createCharacterMakerV8Starter({ makerKey: 'history-tamper' });
  await createStarterBundle(persistence, { draftId: 'history-tamper', document, createdAt: 100 });
  const changed = await persistence.upsertAsset({
    draftId: 'history-tamper', expectedDraftRevision: 1, assetId: 'base-default', kind: 'layer',
    mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([1])),
    expectedAssetRevision: 1, updatedAt: 101,
  });
  const key = ['history-tamper', 1, 'base-default'];
  const historicalVersion = (await rawStoreRows(databaseName, 'assetVersions'))
    .find((row) => row.draftId === 'history-tamper' && row.draftRevision === 1);
  await mutateAssetBlob(databaseName, historicalVersion.sha256, (row) => ({
    ...row,
    bytesBase64: toBase64(new Uint8Array([9])),
  }));
  await assert.rejects(
    persistence.restoreVersion({
      draftId: 'history-tamper', expectedRevision: changed.draft.revision, revision: 1, updatedAt: 102,
    }),
    { code: 'MAKER_V8_DRAFT_VERSION_ASSET_HASH_MISMATCH' },
  );
  assert.equal((await persistence.load('history-tamper')).revision, 2);
  await mutateAssetVersion(databaseName, key, () => null);
  await assert.rejects(
    persistence.restoreVersion({
      draftId: 'history-tamper', expectedRevision: changed.draft.revision, revision: 1, updatedAt: 103,
    }),
    { code: 'MAKER_V8_DRAFT_VERSION_ASSET_SNAPSHOT_MISSING' },
  );
  assert.equal((await persistence.loadAsset('history-tamper', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([1])));
  persistence.close();
});

test('new draft bundles atomically bind the document, bytes, history, and version snapshot', async () => {
  const persistence = store(`create-bundle-${crypto.randomUUID()}`);
  const document = createCharacterMakerV8Starter({ makerKey: 'create-bundle' });
  await assert.rejects(
    persistence.createBundle({ draftId: 'create-bundle', document, assets: [], createdAt: 100 }),
    { code: 'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE' },
  );
  assert.equal(await persistence.load('create-bundle'), null);
  const created = await persistence.createBundle({
    draftId: 'create-bundle',
    document,
    createdAt: 100,
    assets: [{
      assetId: 'base-default', kind: 'layer', mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([0])),
    }],
  });
  assert.equal(created.draft.revision, 1);
  assert.equal(created.assets[0].assetId, 'base-default');
  const changed = structuredClone(created.draft.document);
  changed.metadata.name = 'Changed after atomic creation';
  const saved = await persistence.compareAndSwap({
    draftId: 'create-bundle', expectedRevision: 1, document: changed, updatedAt: 101,
  });
  const restored = await persistence.restoreVersion({
    draftId: 'create-bundle', expectedRevision: saved.revision, revision: 1, updatedAt: 102,
  });
  assert.equal(restored.document.metadata.name, document.metadata.name);
  assert.equal((await persistence.loadAsset('create-bundle', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([0])));
  persistence.close();
});

test('a strict save refuses to copy same-length current asset tampering into version history', async () => {
  const databaseName = `current-tamper-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const document = createCharacterMakerV8Starter({ makerKey: 'current-tamper' });
  const created = await persistence.createBundle({
    draftId: 'current-tamper',
    document,
    createdAt: 100,
    assets: [{
      assetId: 'base-default', kind: 'layer', mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([0])),
    }],
  });
  await mutateCurrentAsset(databaseName, ['current-tamper', 'base-default'], (asset) => ({
    ...asset,
    bytesBase64: toBase64(new Uint8Array([9])),
  }));
  const changed = structuredClone(created.draft.document);
  changed.metadata.summary = 'This must not commit over corrupt bytes.';
  await assert.rejects(
    persistence.compareAndSwap({
      draftId: 'current-tamper', expectedRevision: 1, document: changed, updatedAt: 101,
    }),
    { code: 'MAKER_V8_DRAFT_ASSET_HASH_MISMATCH' },
  );
  assert.equal((await persistence.load('current-tamper')).revision, 1);
  assert.deepEqual((await persistence.listVersions('current-tamper')).map((row) => row.revision), [1]);
  persistence.close();
});

test('restore and export fail closed before propagating corrupt current asset metadata', async () => {
  const databaseName = `current-metadata-tamper-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const document = createCharacterMakerV8Starter({ makerKey: 'current-metadata-tamper' });
  const created = await createStarterBundle(persistence, {
    draftId: 'current-metadata-tamper', document, createdAt: 100,
  });
  const changed = structuredClone(created.draft.document);
  changed.metadata.summary = 'Revision two';
  await persistence.compareAndSwap({
    draftId: 'current-metadata-tamper', expectedRevision: 1, document: changed, updatedAt: 101,
  });
  await mutateCurrentAsset(
    databaseName,
    ['current-metadata-tamper', 'base-default'],
    (asset) => ({ ...asset, revision: 99 }),
  );
  await assert.rejects(
    persistence.restoreVersion({
      draftId: 'current-metadata-tamper', expectedRevision: 2, revision: 1, updatedAt: 102,
    }),
    { code: 'MAKER_V8_DRAFT_ASSET_TIMELINE_INVALID' },
  );
  await assert.rejects(
    persistence.export('current-metadata-tamper'),
    { code: 'MAKER_V8_DRAFT_ASSET_TIMELINE_INVALID' },
  );
  assert.equal((await persistence.load('current-metadata-tamper')).revision, 2);
  assert.deepEqual(
    (await persistence.listVersions('current-metadata-tamper')).map((row) => row.revision),
    [2, 1],
  );
  persistence.close();
});

test('v2 upgrade snapshots only the current asset state and fails closed for unverifiable old bytes', async () => {
  const databaseName = `upgrade-v2-${crypto.randomUUID()}`;
  await seedV2Database(databaseName);
  const persistence = store(databaseName);
  assert.equal((await persistence.load('migrated-v2')).revision, 2);
  assert.deepEqual((await persistence.listVersions('migrated-v2')).map((row) => row.revision), [2, 1]);
  await assert.rejects(
    persistence.restoreVersion({
      draftId: 'migrated-v2', expectedRevision: 2, revision: 1, updatedAt: 102,
    }),
    { code: 'MAKER_V8_DRAFT_VERSION_ASSET_SNAPSHOT_MISSING' },
  );
  const restored = await persistence.restoreVersion({
    draftId: 'migrated-v2', expectedRevision: 2, revision: 2, updatedAt: 102,
  });
  assert.equal(restored.revision, 3);
  assert.equal(restored.document.metadata.name, 'V2 Current');
  assert.equal((await persistence.loadAsset('migrated-v2', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([1])));
  persistence.close();
});

test('v3 upgrade converts repeated inline history bytes into one immutable content blob', async () => {
  const databaseName = `upgrade-v3-${crypto.randomUUID()}`;
  await seedV3Database(databaseName);
  const persistence = store(databaseName);
  assert.equal((await persistence.load('migrated-v3')).revision, 2);
  const refs = (await rawStoreRows(databaseName, 'assetVersions'))
    .filter((row) => row.draftId === 'migrated-v3');
  assert.equal(refs.length, 2);
  assert.equal(refs.every((row) => !Object.hasOwn(row, 'bytesBase64')), true);
  assert.equal(new Set(refs.map((row) => row.blobId)).size, 1);
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 1);
  const restored = await persistence.restoreVersion({
    draftId: 'migrated-v3', expectedRevision: 2, revision: 1, updatedAt: 102,
  });
  assert.equal(restored.document.metadata.name, 'V3 Original');
  assert.equal(
    (await persistence.loadAsset('migrated-v3', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([3])),
  );
  persistence.close();
});

test('document history stores content-addressed asset refs, prunes in pairs, and deletion GCs bytes', async () => {
  const databaseName = `bounded-history-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const document = createCharacterMakerV8Starter({ makerKey: 'bounded-history' });
  let current = (await createStarterBundle(persistence, {
    draftId: 'bounded-history', document, createdAt: 100,
  })).draft;
  for (let nextRevision = 2; nextRevision <= 101; nextRevision += 1) {
    const nextDocument = structuredClone(current.document);
    nextDocument.metadata.summary = `Revision ${nextRevision}`;
    current = await persistence.compareAndSwap({
      draftId: 'bounded-history',
      expectedRevision: current.revision,
      document: nextDocument,
      updatedAt: 99 + nextRevision,
    });
  }
  const versions = await persistence.listVersions('bounded-history');
  assert.equal(versions.length, 100);
  assert.equal(versions[0].revision, 101);
  assert.equal(versions.at(-1).revision, 2);
  const assetVersions = (await rawStoreRows(databaseName, 'assetVersions'))
    .filter((row) => row.draftId === 'bounded-history');
  assert.equal(assetVersions.length, 100);
  assert.equal(assetVersions.some((row) => row.draftRevision === 1), false);
  assert.equal(assetVersions.every((row) => !Object.hasOwn(row, 'bytesBase64')), true);
  const assetBlobs = await rawStoreRows(databaseName, 'assetBlobs');
  assert.equal(assetBlobs.length, 1);
  await assert.rejects(
    persistence.restoreVersion({
      draftId: 'bounded-history', expectedRevision: 101, revision: 1, updatedAt: 201,
    }),
    { code: 'MAKER_V8_DRAFT_VERSION_NOT_FOUND' },
  );
  assert.equal(await persistence.delete({ draftId: 'bounded-history', expectedRevision: 101 }), true);
  for (const storeName of ['drafts', 'assets', 'versions', 'assetVersions', 'assetBlobs']) {
    assert.equal((await rawStoreRows(databaseName, storeName))
      .some((row) => row.draftId === 'bounded-history'), false, storeName);
  }
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 0);
  assert.deepEqual(await rawStoreRows(databaseName, 'draftIdentities'), [{ draftId: 'bounded-history' }]);
  await assert.rejects(
    persistence.createBundle({
      draftId: 'bounded-history', document, createdAt: 300,
      assets: [{
        assetId: 'base-default', kind: 'layer', mediaType: 'image/png',
        bytesBase64: toBase64(new Uint8Array([0])),
      }],
    }),
    { code: 'MAKER_V8_DRAFT_ID_RETIRED' },
  );
  persistence.close();
});

test('content-addressed history deduplicates A-B-A bytes and preserves exact revision metadata', async () => {
  const databaseName = `dedup-aba-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const document = createCharacterMakerV8Starter({ makerKey: 'dedup-aba' });
  await createStarterBundle(persistence, { draftId: 'dedup-aba', document, createdAt: 100 });
  await persistence.upsertAsset({
    draftId: 'dedup-aba', expectedDraftRevision: 1, assetId: 'base-default',
    kind: 'layer', mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([1])),
    expectedAssetRevision: 1, updatedAt: 101,
  });
  await persistence.upsertAsset({
    draftId: 'dedup-aba', expectedDraftRevision: 2, assetId: 'base-default',
    kind: 'layer', mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([0])),
    expectedAssetRevision: 2, updatedAt: 102,
  });
  const refs = (await rawStoreRows(databaseName, 'assetVersions'))
    .filter((row) => row.draftId === 'dedup-aba');
  assert.equal(refs.length, 3);
  assert.equal(new Set(refs.map((row) => row.blobId)).size, 2);
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 2);
  await persistence.restoreVersion({
    draftId: 'dedup-aba', expectedRevision: 3, revision: 2, updatedAt: 103,
  });
  assert.equal(
    (await persistence.loadAsset('dedup-aba', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([1])),
  );
  persistence.close();
});

test('history blob GC retains shared content until the final draft reference is deleted', async () => {
  const databaseName = `dedup-shared-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const left = createCharacterMakerV8Starter({ makerKey: 'dedup-left' });
  const right = createCharacterMakerV8Starter({ makerKey: 'dedup-right' });
  await createStarterBundle(persistence, { draftId: 'dedup-left', document: left, createdAt: 100 });
  await createStarterBundle(persistence, { draftId: 'dedup-right', document: right, createdAt: 100 });
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 1);
  await persistence.delete({ draftId: 'dedup-left', expectedRevision: 1 });
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 1);
  await persistence.delete({ draftId: 'dedup-right', expectedRevision: 1 });
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 0);
  persistence.close();
});

test('100 retained distinct asset revisions retain exactly 100 blobs after paired pruning', async () => {
  const databaseName = `dedup-distinct-${crypto.randomUUID()}`;
  const persistence = store(databaseName);
  const document = createCharacterMakerV8Starter({ makerKey: 'dedup-distinct' });
  await createStarterBundle(persistence, { draftId: 'dedup-distinct', document, createdAt: 100 });
  let draftRevision = 1;
  let assetRevision = 1;
  for (let value = 1; value <= 100; value += 1) {
    const result = await persistence.upsertAsset({
      draftId: 'dedup-distinct', expectedDraftRevision: draftRevision, assetId: 'base-default',
      kind: 'layer', mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([value >> 8, value & 0xff])),
      expectedAssetRevision: assetRevision, updatedAt: 100 + value,
    });
    draftRevision = result.draft.revision;
    assetRevision = result.asset.revision;
  }
  assert.equal((await rawStoreRows(databaseName, 'assetVersions')).length, 100);
  assert.equal((await rawStoreRows(databaseName, 'assetBlobs')).length, 100);
  assert.equal((await persistence.listVersions('dedup-distinct')).length, 100);
  persistence.close();
});

test('asset bytes and document descriptor update in one strict CAS transaction', async () => {
  const persistence = store(`asset-cas-${crypto.randomUUID()}`, (() => { let at = 200; return () => at++; })());
  const document = createCharacterMakerV8Starter({ makerKey: 'asset-maker' });
  await createStarterBundle(persistence, { draftId: 'asset-maker', document, createdAt: 200 });
  const updated = await persistence.upsertAsset({
    draftId: 'asset-maker',
    expectedDraftRevision: 1,
    assetId: 'base-default',
    kind: 'layer',
    mediaType: 'image/webp',
    bytesBase64: toBase64(new Uint8Array([1, 2, 3])),
    expectedAssetRevision: 1,
    updatedAt: 202,
  });
  assert.equal(updated.draft.revision, 2);
  assert.equal(updated.draft.document.assets[0].byteLength, 3);
  assert.equal(updated.draft.document.assets[0].mediaType, 'image/webp');
  assert.equal(updated.asset.revision, 2);
  assert.equal(updated.asset.byteLength, 3);
  await assert.rejects(
    persistence.upsertAsset({
      draftId: 'asset-maker', expectedDraftRevision: 1, assetId: 'base-default',
      kind: 'layer', mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([4])),
      expectedAssetRevision: 1, updatedAt: 203,
    }),
    { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' },
  );
  assert.equal((await persistence.loadAsset('asset-maker', 'base-default')).byteLength, 3);
  persistence.close();
});

test('one draft transaction atomically commits document commands with asset upserts and deletes', async () => {
  const persistence = store(`asset-bundle-${crypto.randomUUID()}`);
  const document = createCharacterMakerV8Starter({ makerKey: 'atomic-maker' });
  await createStarterBundle(persistence, { draftId: 'atomic-maker', document, createdAt: 700 });

  const withAccent = structuredClone(document);
  withAccent.assets.push({ id: 'accent', kind: 'layer', mediaType: 'image/png', byteLength: 2 });
  const added = await persistence.compareAndSwapBundle({
    draftId: 'atomic-maker',
    expectedRevision: 1,
    document: withAccent,
    assetUpserts: [{
      assetId: 'accent', expectedRevision: null, kind: 'layer', mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([7, 8])),
    }],
    updatedAt: 702,
  });
  assert.equal(added.draft.revision, 2);
  assert.deepEqual(added.assets.map((asset) => asset.assetId), ['accent', 'base-default']);
  assert.equal(added.assets.find((asset) => asset.assetId === 'accent').revision, 2);
  assert.equal((await persistence.loadAsset('atomic-maker', 'accent')).sha256, added.assets[0].sha256);

  const withoutAccent = structuredClone(added.draft.document);
  withoutAccent.assets = withoutAccent.assets.filter((asset) => asset.id !== 'accent');
  const removed = await persistence.compareAndSwapBundle({
    draftId: 'atomic-maker',
    expectedRevision: 2,
    document: withoutAccent,
    assetDeletes: [{ assetId: 'accent', expectedRevision: 2 }],
    updatedAt: 703,
  });
  assert.equal(removed.draft.revision, 3);
  assert.equal(await persistence.loadAsset('atomic-maker', 'accent'), null);

  const staleDocument = structuredClone(removed.draft.document);
  staleDocument.assets.push({ id: 'stale', kind: 'layer', mediaType: 'image/png', byteLength: 1 });
  await assert.rejects(
    persistence.compareAndSwapBundle({
      draftId: 'atomic-maker', expectedRevision: 3, document: staleDocument,
      assetUpserts: [{
        assetId: 'stale', expectedRevision: 4, kind: 'layer', mediaType: 'image/png',
        bytesBase64: toBase64(new Uint8Array([9])),
      }],
      updatedAt: 704,
    }),
    { code: 'MAKER_V8_DRAFT_ASSET_CAS_MISMATCH' },
  );
  assert.equal((await persistence.load('atomic-maker')).revision, 3);
  assert.equal(await persistence.loadAsset('atomic-maker', 'stale'), null);
  const restoredWithAccent = await persistence.restoreVersion({
    draftId: 'atomic-maker', expectedRevision: 3, revision: 2, updatedAt: 705,
  });
  assert.equal(restoredWithAccent.revision, 4);
  assert.equal((await persistence.loadAsset('atomic-maker', 'accent')).bytesBase64,
    toBase64(new Uint8Array([7, 8])));
  const restoredWithoutAccent = await persistence.restoreVersion({
    draftId: 'atomic-maker', expectedRevision: 4, revision: 3, updatedAt: 706,
  });
  assert.equal(restoredWithoutAccent.revision, 5);
  assert.equal(await persistence.loadAsset('atomic-maker', 'accent'), null);
  const readded = await persistence.upsertAsset({
    draftId: 'atomic-maker', expectedDraftRevision: 5, assetId: 'accent',
    kind: 'layer', mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([7, 8])),
    expectedAssetRevision: null, updatedAt: 707,
  });
  assert.equal(readded.draft.revision, 6);
  assert.equal(readded.asset.revision, 6);
  await assert.rejects(
    persistence.upsertAsset({
      draftId: 'atomic-maker', expectedDraftRevision: 6, assetId: 'accent',
      kind: 'layer', mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([9, 9])),
      expectedAssetRevision: 1, updatedAt: 708,
    }),
    { code: 'MAKER_V8_DRAFT_ASSET_CAS_MISMATCH' },
  );
  persistence.close();
});

test('fresh v8 project export imports atomically and rejects byte or hash drift', async () => {
  const source = store(`export-source-${crypto.randomUUID()}`);
  const target = store(`export-target-${crypto.randomUUID()}`);
  const replacementTarget = store(`export-replace-${crypto.randomUUID()}`);
  const document = createCharacterMakerV8Starter({ makerKey: 'portable-maker', name: 'Portable Maker' });
  await createStarterBundle(source, { draftId: 'portable-maker', document, createdAt: 300 });
  const portableWithAccent = structuredClone(document);
  portableWithAccent.assets.push({
    id: 'accent', kind: 'layer', mediaType: 'image/png', byteLength: 2,
  });
  await source.compareAndSwapBundle({
    draftId: 'portable-maker',
    expectedRevision: 1,
    document: portableWithAccent,
    assetUpserts: [{
      assetId: 'accent', expectedRevision: null, kind: 'layer', mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([7, 8])),
    }],
    updatedAt: 301,
  });
  const bundle = await source.export('portable-maker');
  const imported = await target.importBundle(bundle);
  assert.equal(imported.draft.document.metadata.name, 'Portable Maker');
  assert.equal(imported.assets[0].sha256, bundle.assets[0].sha256);
  assert.equal((await target.load('portable-maker')).revision, 2);
  const importedChanged = await target.upsertAsset({
    draftId: 'portable-maker', expectedDraftRevision: 2, assetId: 'base-default',
    kind: 'layer', mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array([2])),
    expectedAssetRevision: 1, updatedAt: 302,
  });
  await target.restoreVersion({
    draftId: 'portable-maker', expectedRevision: importedChanged.draft.revision,
    revision: 2, updatedAt: 303,
  });
  assert.equal((await target.loadAsset('portable-maker', 'base-default')).bytesBase64,
    toBase64(new Uint8Array([0])));
  assert.equal((await target.loadAsset('portable-maker', 'accent')).bytesBase64,
    toBase64(new Uint8Array([7, 8])));

  const replacedDocument = createCharacterMakerV8Starter({
    makerKey: 'replace-target', name: 'Replace Target',
  });
  await createStarterBundle(replacementTarget, {
    draftId: 'replace-target', document: replacedDocument, createdAt: 302,
  });
  const replaced = await replacementTarget.replaceBundle({
    draftId: 'replace-target', expectedRevision: 1, bundle, updatedAt: 304,
  });
  assert.equal(replaced.draft.draftId, 'replace-target');
  assert.equal(replaced.draft.revision, 2);
  assert.equal(replaced.draft.document.metadata.name, 'Portable Maker');
  assert.equal(replaced.assets[0].draftId, 'replace-target');
  const restoredLocal = await replacementTarget.restoreVersion({
    draftId: 'replace-target', expectedRevision: 2, revision: 1, updatedAt: 305,
  });
  assert.equal(restoredLocal.document.metadata.name, 'Replace Target');
  assert.equal(await replacementTarget.loadAsset('replace-target', 'accent'), null);
  const restoredImported = await replacementTarget.restoreVersion({
    draftId: 'replace-target', expectedRevision: 3, revision: 2, updatedAt: 306,
  });
  assert.equal(restoredImported.document.metadata.name, 'Portable Maker');
  assert.equal((await replacementTarget.loadAsset('replace-target', 'accent')).bytesBase64,
    toBase64(new Uint8Array([7, 8])));

  const tampered = structuredClone(bundle);
  tampered.assets[0].bytesBase64 = toBase64(new Uint8Array([1]));
  await assert.rejects(
    store(`export-tamper-${crypto.randomUUID()}`).importBundle(tampered),
    { code: 'MAKER_V8_DRAFT_ASSET_INVALID' },
  );
  await assert.rejects(target.importBundle(bundle), { code: 'MAKER_V8_DRAFT_EXISTS' });
  source.close();
  target.close();
  replacementTarget.close();
});
