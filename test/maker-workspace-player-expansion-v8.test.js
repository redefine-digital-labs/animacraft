import assert from 'node:assert/strict';
import test from 'node:test';

import { createMakerV5Document } from '../maker-v4.js';
import {
  EXPANSION_PACK_PLAYER_V8_SCHEMA,
  expansionPackPlayerSessionRefV8,
  materializeExpansionPackPlayerEntryV8,
} from '../expansion-pack-player-v8.js';
import { MAKER_SEAL_ASSET_V5_SCHEMA } from '../maker-seal-v5.js';
import {
  createMakerWorkspace,
  verifiedExpansionPackV8CatalogEntries,
} from '../maker-workspace.js';

const HASH_A = '11'.repeat(32);
const HASH_B = '22'.repeat(32);
const WALLET = '0xabc';
const WALLET_B = '0xdef';
const PLAYER_STATE_SCHEMA = 'animacraft.expansion-pack-player-state.v1';

globalThis.requestAnimationFrame ||= (callback) => {
  callback();
  return 1;
};

class FakeRoot {
  constructor() {
    this.innerHTML = '';
  }

  addEventListener() {}

  removeEventListener() {}

  querySelector() { return null; }

  querySelectorAll() { return []; }
}

function baseDocument() {
  const document = createMakerV5Document({
    makerId: 'maker-root',
    name: 'Player v8 Base',
    creator: 'Maker',
  });
  document.version.number = 7;
  document.version.versionId = 'maker-root-v7';
  return document;
}

function verifiedEntry({
  accessible = true,
  free = true,
  playerUsable = true,
  transportReady = true,
  releaseId = '0xpack-release',
  contentCommitment = HASH_A,
} = {}) {
  return {
    schemaVersion: EXPANSION_PACK_PLAYER_V8_SCHEMA,
    trusted: true,
    playerUsable,
    transportReady,
    identity: `${releaseId}::1.0.0::${contentCommitment}`,
    releaseId,
    parent: {
      rootMakerId: 'maker-root',
      baseMakerRootId: '0xmaker-root',
      releaseId: '0xmaker-v7',
      versionNumber: '7',
      versionId: 'maker-root-v7',
      manifestBlobId: 'parent-quilt',
      manifestSha256: HASH_B,
    },
    release: { objectId: releaseId },
    manifestSha256: HASH_B,
    contentCommitment,
    pack: {
      schemaVersion: 'animacraft.expansion-pack.v1',
      packId: 'pack-one',
      namespace: 'packone',
      name: 'Pack One',
      version: '1.0.0',
      baseMakerId: 'maker-root',
      baseVersion: '7',
      baseVersionId: 'maker-root-v7',
      baseReleaseId: '0xmaker-v7',
      baseManifestBlobId: 'parent-quilt',
      manifestHash: contentCommitment,
      layerTracks: [{ id: 'hat-track', name: 'Hat', order: 0 }],
      colorChannels: [],
      assets: [{
        id: 'hat-art',
        identifier: 'assets/hat.png',
        kind: 'layer',
        mediaType: 'image/png',
        width: 1024,
        height: 1024,
      }],
      parts: [{
        id: 'hat',
        name: 'Hat',
        required: false,
        allowRemove: true,
        menuVisible: true,
        defaultItemId: 'default',
        items: [{
          id: 'default',
          name: 'Default',
          defaultStyleId: 'default',
          styles: [{
            id: 'default',
            name: 'Default',
            assetId: 'hat-art',
            layerTrackId: 'hat-track',
            transform: { x: 0, y: 0, scale: 1, rotation: 0 },
            opacity: 1,
            blendMode: 'normal',
          }],
        }],
      }],
      rules: [],
    },
    assets: [{
      partKey: 'hat',
      itemKey: 'default',
      styleKey: 'default',
      assetId: 'hat-art',
      identifier: 'assets/hat.png',
      mediaType: 'image/png',
      assetSha256: HASH_A,
      assetBlobId: 'hat-blob',
      assetSealId: '',
    }],
    access: {
      kind: free ? 'FREE' : 'PAID_ONCE',
      priceAtomic: free ? '0' : '6000000',
      entitled: accessible,
      availableForAcquire: !accessible,
      accessible,
      reason: accessible ? '' : 'ENTITLEMENT_REQUIRED',
    },
  };
}

function playerState(entry, assets = [], walletAddress = WALLET) {
  return {
    schemaVersion: PLAYER_STATE_SCHEMA,
    trusted: true,
    walletAddress,
    entries: [entry],
    assets,
    rejected: [],
  };
}

function assetFor(entry, url = 'https://aggregator.example/hat.png') {
  return {
    assetId: 'packone__hat-art',
    expansionPackReleaseId: entry.releaseId,
    identifier: 'assets/hat.png',
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
    url,
  };
}

async function paidAcquisitionEntry({ deploymentThreshold = 1 } = {}) {
  const entry = verifiedEntry({
    free: false,
    accessible: false,
    playerUsable: false,
    transportReady: true,
  });
  const publicServer = {
    objectId: `0x${'99'.repeat(32)}`,
    weight: 1,
    aggregatorUrl: 'https://seal.example',
  };
  entry.assets[0].protection = {
    schemaVersion: MAKER_SEAL_ASSET_V5_SCHEMA,
    mode: 'SEAL_PAID_PACK',
    threshold: 1,
    keyServers: [publicServer],
  };
  return materializeExpansionPackPlayerEntryV8(entry, {
    salesEnabled: true,
    sealPublicPolicy: {
      threshold: deploymentThreshold,
      keyServers: [{
        ...publicServer,
        objectId: `0X${publicServer.objectId.slice(2).toUpperCase()}`,
        apiKeyName: 'X-API-Key',
        apiKey: 'local-only-secret',
      }],
    },
  });
}

async function workspaceFor(entry, {
  playerRoot = null,
  onAcquireExpansionPackV8 = null,
  loadSession = null,
  makerKey = 'wallet:maker-root',
} = {}) {
  const document = baseDocument();
  const sessionWrites = [];
  const workspace = createMakerWorkspace({
    playerRoot,
    callbacks: {
      ...(onAcquireExpansionPackV8 ? { onAcquireExpansionPackV8 } : {}),
    },
    walStorage: null,
    async loadPlayerSessionRecord() {
      return loadSession ? { session: structuredClone(loadSession), savedAt: 1 } : null;
    },
    async savePlayerSessionRecord(sessionKey, session) {
      sessionWrites.push({ sessionKey, session: structuredClone(session) });
      return { saved: true, persistedRevision: sessionWrites.length, savedAt: Date.now() };
    },
  });
  await workspace.setContext({
    makerKey,
    walletAddress: WALLET,
    creatorPersistenceEnabled: false,
    document,
    assets: [],
    expansionPackV8State: playerState(entry, entry.access.accessible ? [assetFor(entry)] : []),
  });
  return { workspace, document, sessionWrites };
}

test('trusted v8 catalog rejects duplicate and untrusted release identities', () => {
  const entry = verifiedEntry();
  assert.equal(verifiedExpansionPackV8CatalogEntries(playerState(entry)).length, 1);
  assert.deepEqual(verifiedExpansionPackV8CatalogEntries({
    ...playerState(entry),
    entries: [entry, structuredClone(entry)],
  }), []);
  assert.deepEqual(verifiedExpansionPackV8CatalogEntries({
    ...playerState(entry),
    trusted: false,
  }), []);
});

test('Player enables and merges only an entitled exact v8 release and persists its full ref', async () => {
  const entry = verifiedEntry();
  const { workspace } = await workspaceFor(entry);
  try {
    assert.equal(workspace.runtimeDocument().parts.length, 0);
    assert.equal(workspace.runtimeAsset('packone__hat-art'), null);
    assert.equal(workspace.setPlayerExpansionPackV8Enabled(entry.releaseId, true), true);
    assert.equal(workspace.runtimeDocument().parts[0].id, 'packone__hat');
    assert.equal(
      workspace.runtimeAsset('packone__hat-art')?.expansionPackReleaseId,
      entry.releaseId,
    );
    assert.deepEqual(
      workspace.playerSessionSnapshot().enabledExpansionV8Refs,
      [expansionPackPlayerSessionRefV8(entry)],
    );
    const exportSnapshot = workspace.createPlayerExportSnapshot(workspace.runtimeDocument());
    assert.deepEqual(
      exportSnapshot.expansionPackV8.sessionRefs,
      [expansionPackPlayerSessionRefV8(entry)],
    );
    assert.ok(workspace.playerCompletionIssues(
      workspace.runtimeDocument(),
      workspace.playerRecipe,
    ).some((issue) => /independent v8 Expansion Pack/i.test(issue)));
    assert.equal(workspace.setPlayerExpansionPackV8Enabled(entry.releaseId, false), true);
    assert.equal(workspace.runtimeDocument().parts.length, 0);
    assert.ok(workspace.playerCompletionIssues(
      exportSnapshot.document,
      exportSnapshot.recipe,
      { expansionPackV8: exportSnapshot.expansionPackV8 },
    ).some((issue) => /independent v8 Expansion Pack/i.test(issue)));
  } finally {
    workspace.destroy();
  }
});

test('session release commitment drift fails closed without discarding the base OC session', async () => {
  const entry = verifiedEntry();
  const savedRef = expansionPackPlayerSessionRefV8(entry);
  const drifted = verifiedEntry({ contentCommitment: '33'.repeat(32) });
  const session = {
    makerVersionId: 'maker-root-v7',
    recipe: { selections: [], colors: [] },
    profile: { name: 'Recovered OC' },
    livingContent: null,
    enabledExpansionIds: [],
    enabledExpansionV8Refs: [savedRef],
  };
  const { workspace } = await workspaceFor(drifted, { loadSession: session });
  try {
    assert.equal(workspace.playerProfile.name, 'Recovered OC');
    assert.equal(workspace.enabledExpansionReleaseIds.size, 0);
    assert.equal(workspace.runtimeDocument().parts.length, 0);
    assert.match(workspace.playerCommerceError, /no longer matches the verified catalog/i);
  } finally {
    workspace.destroy();
  }
});

test('free v8 acquisition requires fresh verified Pass readback before enabling', async () => {
  const locked = verifiedEntry({ accessible: false });
  const unlocked = verifiedEntry({ accessible: true });
  let workspace;
  let observedPayload = null;
  const prepared = await workspaceFor(locked, {
    async onAcquireExpansionPackV8(payload) {
      observedPayload = payload;
      return {
        confirmed: true,
        releaseId: payload.releaseId,
        expansionPackV8State: playerState(unlocked, [assetFor(unlocked)]),
      };
    },
  });
  workspace = prepared.workspace;
  try {
    assert.equal(await workspace.acquirePlayerExpansionPackV8(locked.releaseId), true);
    assert.equal(observedPayload.releaseId, locked.releaseId);
    assert.equal(observedPayload.accessKind, 'FREE');
    assert.equal(workspace.playerExpansionPackV8AccessState(unlocked).enabled, true);
    assert.equal(workspace.runtimeDocument().parts[0].id, 'packone__hat');
  } finally {
    workspace.destroy();
  }
});

test('paid v8 acquisition uses verified ciphertext readiness before a Pass exists', async () => {
  const locked = await paidAcquisitionEntry();
  const unlocked = verifiedEntry({
    free: false,
    accessible: true,
    playerUsable: true,
    transportReady: true,
  });
  let observedPayload = null;
  const { workspace } = await workspaceFor(locked, {
    async onAcquireExpansionPackV8(payload) {
      observedPayload = payload;
      return {
        confirmed: true,
        releaseId: payload.releaseId,
        expansionPackV8State: playerState(unlocked, [assetFor(unlocked, 'blob:paid-pack')]),
      };
    },
  });
  try {
    const before = workspace.playerExpansionPackV8AccessState(locked);
    assert.equal(before.availableForAcquire, true);
    assert.equal(before.accessible, false);
    assert.doesNotMatch(JSON.stringify(locked), /local-only-secret/);
    assert.equal(await workspace.acquirePlayerExpansionPackV8(locked.releaseId), true);
    assert.equal(observedPayload.accessKind, 'PAID_ONCE');
    assert.equal(workspace.playerExpansionPackV8AccessState(unlocked).enabled, true);
  } finally {
    workspace.destroy();
  }
});

test('deployment-incompatible paid Seal policy never reaches the acquisition signer callback', async () => {
  const locked = await paidAcquisitionEntry({ deploymentThreshold: 2 });
  let signerCalls = 0;
  const { workspace } = await workspaceFor(locked, {
    async onAcquireExpansionPackV8() {
      signerCalls += 1;
      throw new Error('incompatible public policy reached signer callback');
    },
  });
  try {
    const before = workspace.playerExpansionPackV8AccessState(locked);
    assert.equal(locked.transportReady, false);
    assert.equal(before.availableForAcquire, false);
    assert.equal(await workspace.acquirePlayerExpansionPackV8(locked.releaseId), false);
    assert.equal(signerCalls, 0);
  } finally {
    workspace.destroy();
  }
});

test('deferred v8 acquisition cannot mutate a newly selected Maker context', async () => {
  const locked = verifiedEntry({ accessible: false });
  const unlocked = verifiedEntry({ accessible: true });
  const nextEntry = verifiedEntry({
    accessible: false,
    releaseId: '0xnext-pack-release',
    contentCommitment: '33'.repeat(32),
  });
  nextEntry.parent = {
    ...nextEntry.parent,
    rootMakerId: 'maker-next',
    versionId: 'maker-next-v7',
  };
  let resolveAcquisition;
  let acquisitionCalls = 0;
  const acquisitionResult = new Promise((resolve) => {
    resolveAcquisition = resolve;
  });
  const { workspace } = await workspaceFor(locked, {
    async onAcquireExpansionPackV8() {
      acquisitionCalls += 1;
      return acquisitionResult;
    },
  });
  try {
    const previousEpoch = workspace.contextEpoch;
    const pendingAcquisition = workspace.acquirePlayerExpansionPackV8(locked.releaseId);
    assert.equal(acquisitionCalls, 1);

    const nextDocument = baseDocument();
    nextDocument.version.rootMakerId = 'maker-next';
    nextDocument.version.versionId = 'maker-next-v7';
    await workspace.setContext({
      makerKey: 'wallet:maker-next',
      walletAddress: WALLET,
      creatorPersistenceEnabled: false,
      document: nextDocument,
      assets: [],
      expansionPackV8State: playerState(nextEntry),
    });
    assert.ok(workspace.contextEpoch > previousEpoch);

    resolveAcquisition({
      confirmed: true,
      releaseId: unlocked.releaseId,
      expansionPackV8State: playerState(unlocked, [assetFor(unlocked)]),
    });
    assert.equal(await pendingAcquisition, false);

    assert.equal(workspace.makerKey, 'wallet:maker-next');
    assert.equal(workspace.playerExpansionPackV8Entry(locked.releaseId), null);
    assert.equal(
      workspace.playerExpansionPackV8Entry(nextEntry.releaseId)?.identity,
      nextEntry.identity,
    );
    assert.equal(
      workspace.playerExpansionPackV8AccessState(nextEntry).accessible,
      false,
    );
    assert.equal(workspace.runtimeDocument().parts.length, 0);
    assert.equal(workspace.playerCommercePending, '');
    assert.equal(workspace.playerCommerceError, '');
  } finally {
    workspace.destroy();
  }
});

test('deferred v8 acquisition cannot cross a same-public-Maker wallet refresh', async () => {
  const locked = verifiedEntry({ accessible: false });
  const unlocked = verifiedEntry({ accessible: true });
  let resolveAcquisition;
  const acquisitionResult = new Promise((resolve) => {
    resolveAcquisition = resolve;
  });
  const { workspace, document } = await workspaceFor(locked, {
    makerKey: 'public:maker-root:0xmaker-v7',
    async onAcquireExpansionPackV8() {
      return acquisitionResult;
    },
  });
  try {
    const previousContextEpoch = workspace.contextEpoch;
    const previousCatalogEpoch = workspace.playerExpansionPackV8CatalogEpoch;
    const pendingAcquisition = workspace.acquirePlayerExpansionPackV8(locked.releaseId);
    assert.equal(workspace.playerCommercePending, `pack-v8:${locked.releaseId}`);

    workspace.render();
    assert.equal(workspace.playerExpansionPackV8CatalogEpoch, previousCatalogEpoch);

    await workspace.setContext({
      makerKey: 'public:maker-root:0xmaker-v7',
      walletAddress: WALLET_B,
      creatorPersistenceEnabled: false,
      document,
      assets: [],
      expansionPackV8State: playerState(locked, [], WALLET_B),
    });
    assert.equal(workspace.contextEpoch, previousContextEpoch);
    assert.ok(workspace.playerExpansionPackV8CatalogEpoch > previousCatalogEpoch);
    assert.equal(workspace.playerCommercePending, '');

    resolveAcquisition({
      confirmed: true,
      releaseId: unlocked.releaseId,
      expansionPackV8State: playerState(unlocked, [assetFor(unlocked)], WALLET),
    });
    assert.equal(await pendingAcquisition, false);

    assert.equal(workspace.context.walletAddress, WALLET_B);
    assert.equal(workspace.context.expansionPackV8State.walletAddress, WALLET_B);
    assert.equal(workspace.playerExpansionPackV8Entry(locked.releaseId)?.identity, locked.identity);
    assert.equal(workspace.playerExpansionPackV8AccessState(locked).accessible, false);
    assert.equal(workspace.runtimeDocument().parts.length, 0);
    assert.equal(workspace.playerCommercePending, '');
    assert.equal(workspace.playerCommerceError, '');
  } finally {
    workspace.destroy();
  }
});

test('paid entry without a verified decrypt path is visibly unavailable and never merged', async () => {
  const blocked = {
    ...verifiedEntry({ free: false, accessible: true, playerUsable: false }),
    acquisitionBlockedReason: 'PAID_SEAL_DECRYPTION_NOT_READY',
  };
  const playerRoot = new FakeRoot();
  const { workspace } = await workspaceFor(blocked, { playerRoot });
  try {
    workspace.playerIntroOpen = false;
    workspace.renderPlayer();
    assert.equal(workspace.setPlayerExpansionPackV8Enabled(blocked.releaseId, true), false);
    assert.equal(workspace.runtimeDocument().parts.length, 0);
    assert.match(playerRoot.innerHTML, /PAID_SEAL_DECRYPTION_NOT_READY/);
    assert.match(playerRoot.innerHTML, /disabled/);
  } finally {
    workspace.destroy();
  }
});

test('an owned paid v8 Pack retries Seal materialization without purchasing again', async () => {
  const blocked = {
    ...verifiedEntry({
      free: false,
      accessible: true,
      playerUsable: false,
      transportReady: true,
    }),
    acquisitionBlockedReason: 'SEAL_SESSION_REJECTED',
  };
  const recovered = verifiedEntry({
    free: false,
    accessible: true,
    playerUsable: true,
    transportReady: true,
  });
  const playerRoot = new FakeRoot();
  let calls = 0;
  const { workspace } = await workspaceFor(blocked, {
    playerRoot,
    async onAcquireExpansionPackV8(payload) {
      calls += 1;
      assert.equal(payload.releaseId, blocked.releaseId);
      return {
        confirmed: true,
        alreadyOwned: true,
        passId: '0xpass',
        expansionPackV8State: playerState(recovered, [assetFor(recovered, 'blob:recovered')]),
      };
    },
  });
  try {
    workspace.playerIntroOpen = false;
    workspace.renderPlayer();
    const before = workspace.playerExpansionPackV8AccessState(blocked);
    assert.equal(before.canRetryRuntime, true);
    assert.equal(before.availableForAcquire, false);
    assert.match(playerRoot.innerHTML, /Retry secure artwork/);
    assert.equal(await workspace.acquirePlayerExpansionPackV8(blocked.releaseId), true);
    assert.equal(calls, 1);
    assert.equal(workspace.playerExpansionPackV8AccessState(recovered).enabled, true);
    assert.equal(workspace.runtimeDocument().parts[0].id, 'packone__hat');
  } finally {
    workspace.destroy();
  }
});

test('runtime assets follow the enabled exact release when Pack versions reuse an asset id', async () => {
  const first = verifiedEntry({
    releaseId: '0xpack-release-one',
    contentCommitment: HASH_A,
  });
  const second = verifiedEntry({
    releaseId: '0xpack-release-two',
    contentCommitment: '33'.repeat(32),
  });
  const document = baseDocument();
  const workspace = createMakerWorkspace({
    walStorage: null,
    async loadPlayerSessionRecord() { return null; },
    async savePlayerSessionRecord() { return { saved: true, persistedRevision: 1 }; },
  });
  try {
    await workspace.setContext({
      makerKey: 'wallet:maker-root',
      walletAddress: WALLET,
      creatorPersistenceEnabled: false,
      document,
      assets: [],
      expansionPackV8State: {
        ...playerState(first),
        entries: [first, second],
        assets: [
          assetFor(first, 'https://aggregator.example/first.png'),
          assetFor(second, 'https://aggregator.example/second.png'),
        ],
      },
    });
    assert.equal(workspace.runtimeAsset('packone__hat-art'), null);
    assert.equal(workspace.setPlayerExpansionPackV8Enabled(first.releaseId, true), true);
    assert.equal(
      workspace.runtimeAsset('packone__hat-art')?.url,
      'https://aggregator.example/first.png',
    );
    assert.equal(workspace.setPlayerExpansionPackV8Enabled(first.releaseId, false), true);
    assert.equal(workspace.setPlayerExpansionPackV8Enabled(second.releaseId, true), true);
    assert.equal(
      workspace.runtimeAsset('packone__hat-art')?.url,
      'https://aggregator.example/second.png',
    );
  } finally {
    workspace.destroy();
  }
});
