import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ANIMACRAFT_WALRUS_MAINNET_AGGREGATOR,
  createAnimacraftChainExecutionV8,
  createLazyMakerV8ComposableFacade,
  createLazyMakerV8LifecycleFacade,
  createLazyMakerV8PackFacade,
  createLazyMakerV8PlayerFacade,
  createMainnetWalrusManifestFetcher,
  renderAnimacraftBootstrapFailure,
} from '../app.js';

test('public execution config is projected to the exact chain-boundary authority', () => {
  assert.deepEqual(createAnimacraftChainExecutionV8({
    schemaVersion: 'animacraft.web-execution.v8',
    network: 'mainnet',
    chainIdentifier: '35834a8a',
    allowWalletSignature: true,
    allowBroadcast: true,
  }), {
    network: 'mainnet',
    chainIdentifier: '35834a8a',
    allowWalletSignature: true,
    allowBroadcast: true,
  });
});

test('Maker lifecycle authority is resolved only when a user requests that capability', async () => {
  let resolutions = 0;
  const calls = [];
  const lifecycle = createLazyMakerV8LifecycleFacade(async () => {
    resolutions += 1;
    return {
      async build(value) { calls.push(['build', value]); return { built: value }; },
      async prepare(value) { calls.push(['prepare', value]); return { prepared: value }; },
      async requestSignature(value) { calls.push(['sign', value]); return { ticket: value }; },
      async recover(value) { calls.push(['recover', value]); return { recovered: value }; },
    };
  });
  assert.equal(resolutions, 0, 'rendering the product must not require Mainnet lifecycle attestation');
  const built = await lifecycle.build({ action: 'PAUSE' });
  await lifecycle.prepare(built);
  assert.equal(resolutions, 1);
  assert.deepEqual(calls.map(([name]) => name), ['build', 'prepare']);
});

test('Player production authority is resolved only when a Player journey requests it', async () => {
  let resolutions = 0;
  const calls = [];
  const controller = Object.fromEntries([
    'getSnapshot', 'loadPlayer', 'setRecipe', 'updateRecipe', 'resetRecipe', 'preparePlayerAction',
    'executePlayerAction', 'recoverPlayerAction', 'recoverActivePlayerAction', 'getPlayerAction', 'quotePlayerCompletion',
  ].map((name) => [name, async (...args) => { calls.push([name, args]); return { name, args }; }]));
  const player = createLazyMakerV8PlayerFacade(async () => {
    resolutions += 1;
    return controller;
  });
  assert.equal(resolutions, 0, 'rendering the product must not attest or initialize Player write authority');
  assert.equal((await player.loadPlayer('0xroot')).name, 'loadPlayer');
  assert.equal(resolutions, 1);
  await player.updateRecipe({ selections: [] });
  const scope = { action: 'acquireMakerAccess', input: {} };
  assert.deepEqual((await player.recoverActivePlayerAction(scope)).args, [scope]);
  assert.deepEqual((await player.quotePlayerCompletion()).args, []);
  assert.deepEqual(calls.map(([name]) => name), ['loadPlayer', 'updateRecipe', 'recoverActivePlayerAction', 'quotePlayerCompletion']);
  assert.equal(resolutions, 1);
});

test('Pack production authority is resolved only when the approved Expansion Packs tab requests it', async () => {
  let resolutions = 0;
  const calls = [];
  const methods = [
    'createPackDraft', 'list', 'load', 'save', 'upsertAsset', 'preview', 'export',
    'preparePublication', 'resumePublication', 'requestPublicationSignature',
    'recoverPublicationOutcome', 'replayPackPublication', 'performLifecycle',
  ];
  const controller = Object.fromEntries(methods.map((name) => [
    name,
    async (...args) => { calls.push([name, args]); return { name, args }; },
  ]));
  const pack = createLazyMakerV8PackFacade(async () => {
    resolutions += 1;
    return controller;
  });
  assert.equal(resolutions, 0, 'rendering the product must not initialize Pack write authority');
  assert.equal((await pack.list()).name, 'list');
  assert.equal(resolutions, 1);
  await pack.preview('moon-pack');
  assert.deepEqual(calls.map(([name]) => name), ['list', 'preview']);
});

test('Pack local editing remains available when production attestation is unavailable', async () => {
  let productionCalls = 0, localCalls = 0;
  const local = Object.fromEntries(['createPackDraft', 'list', 'load', 'save', 'upsertAsset', 'preview', 'export']
    .map(name => [name, async input => ({ name, input })]));
  const pack = createLazyMakerV8PackFacade(async () => {
    productionCalls += 1; throw new Error('attestation unavailable');
  }, async () => { localCalls += 1; return local; });
  for (const method of ['list', 'load', 'save', 'upsertAsset', 'preview', 'export']) {
    assert.equal((await pack[method]('draft')).name, method);
  }
  assert.equal((await pack.createPackDraft({ parent: {} })).name, 'createPackDraft');
  assert.equal(localCalls, 1); assert.equal(productionCalls, 0);
  await assert.rejects(pack.preparePublication({ draftId: 'draft' }), /attestation unavailable/);
  await assert.rejects(pack.createPackDraft({ rootId: 'published-root' }), /attestation unavailable/);
  assert.equal(productionCalls, 2, 'release failures never fall back to local editing');
});

test('Composable write authority stays lazy until the approved Composable Items journey requests it', async () => {
  let resolutions = 0;
  const calls = [];
  const composable = createLazyMakerV8ComposableFacade(async () => {
    resolutions += 1;
    return Object.fromEntries(['build', 'prepare', 'recover'].map((name) => [
      name,
      async (...args) => { calls.push([name, args]); return { name, args }; },
    ]));
  });
  assert.equal(resolutions, 0);
  assert.equal((await composable.build({ action: 'CREATE_PRODUCT' })).name, 'build');
  assert.equal(resolutions, 1);
  await composable.prepare({ request: 'exact' });
  assert.deepEqual(calls.map(([name]) => name), ['build', 'prepare']);
});

test('Walrus manifest reader uses the official credential-free Mainnet read endpoint', async () => {
  const calls = [];
  const response = { ok: true, status: 200, body: {} };
  const reader = createMainnetWalrusManifestFetcher({
    async fetcher(url, options) {
      calls.push({ url, options });
      return response;
    },
  });
  assert.equal(await reader({ blobId: 'certified_blob-1' }), response);
  assert.equal(
    calls[0].url,
    `${ANIMACRAFT_WALRUS_MAINNET_AGGREGATOR}/v1/blobs/certified_blob-1`,
  );
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json, application/octet-stream;q=0.9' });
});

test('Walrus reader rejects credentialed endpoints, traversal ids, and unavailable responses', async () => {
  assert.throws(
    () => createMainnetWalrusManifestFetcher({
      aggregator: 'https://secret@example.com?token=leak',
      fetcher: async () => ({ ok: true }),
    }),
    (error) => error.code === 'ANIMACRAFT_WALRUS_ENDPOINT_INVALID',
  );
  let calls = 0;
  const reader = createMainnetWalrusManifestFetcher({
    fetcher: async () => { calls += 1; return { ok: false, status: 503 }; },
  });
  await assert.rejects(
    reader({ blobId: '../manifest' }),
    (error) => error.code === 'ANIMACRAFT_WALRUS_BLOB_ID_INVALID',
  );
  assert.equal(calls, 0);
  await assert.rejects(
    reader({ blobId: 'valid-blob' }),
    (error) => error.code === 'ANIMACRAFT_WALRUS_READ_FAILED' && error.details.status === 503,
  );
});

test('bootstrap failure is visible and leaves every chain bridge control disabled', () => {
  const values = new Map();
  const root = {
    querySelector(selector) {
      if (!values.has(selector)) {
        values.set(selector, {
          dataset: {},
          textContent: '',
          disabled: false,
          title: '',
          setAttribute(name, value) { this[name] = value; },
        });
      }
      return values.get(selector);
    },
  };
  const message = renderAnimacraftBootstrapFailure(root, new Error('Certified runtime unavailable'));
  assert.equal(message, 'Certified runtime unavailable');
  assert.equal(values.get('#makerV4CreatorMount').textContent, message);
  assert.equal(values.get('#makerV4CreatorMount')['data-runtime-state'], 'error');
  for (const id of ['#creatorGateWalletButton', '#publishMaker', '#resumePublication']) {
    assert.equal(values.get(id).disabled, true);
    assert.equal(values.get(id)['aria-disabled'], 'true');
    assert.equal(values.get(id).title, message);
  }
});

test('public app composes only v8 product, gRPC/GraphQL, and explicit bridge modules', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  for (const required of [
    './original-product-app.js',
    './animacraft-wallet-ui.js',
    './maker-v8-dapp-kit-wallet.js',
    './maker-v8-product-bridge.js',
    './maker-v8-product-runtime.js',
    './maker-v8-sui-grpc.js',
    './maker-v8-player-adapters.js',
    './maker-v8-composable-controller.js',
  ]) assert.match(source, new RegExp(required.replaceAll('.', '\\.')));
  assert.match(source, /createMakerV8DAppKitWalletAdapterV8\(\{[\s\S]*?client:\s*transport,/);
  assert.doesNotMatch(source, /createMakerV8DAppKitWalletAdapterV8\(\{[\s\S]*?client:\s*walletUi\.client,/);
  assert.doesNotMatch(source, /product-shell\.js|createProductShell|#productShell/);
  assert.doesNotMatch(source, /maker-v8-market(?:-controller)?\.js/);
  assert.doesNotMatch(source, /JsonRpc|json-rpc|SuiJsonRpcClient|fullnode\.mainnet\.sui\.io/);
  assert.doesNotMatch(source, /chain-runtime|maker-v4|maker-v5|maker-v6|maker-v7|expansion-pack-publication/);
  assert.doesNotMatch(source, /window\.(?:AnimacraftV8Bridge|ANIMACRAFT_BRIDGE)\s*=/);
});
