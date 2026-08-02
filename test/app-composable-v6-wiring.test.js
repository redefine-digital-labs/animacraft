import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  executeComposableV6PlayerAction,
  hydrateComposableV6PlayerState,
} from '../maker-composable-player-v6-app.js';

const APP_URL = new URL('../app.js', import.meta.url);

test('closed v6 release gate performs no Sui or Walrus Player hydration request', async () => {
  let requests = 0;
  const result = await hydrateComposableV6PlayerState({
    runtime: { compositionV6ReleaseEnabled: false },
    client: new Proxy({}, {
      get() {
        requests += 1;
        throw new Error('closed gate touched Sui');
      },
    }),
    walletAddress: '0x1',
    makerRootId: '0x2',
    companionLoader() {
      requests += 1;
      throw new Error('closed gate touched Walrus');
    },
  });
  assert.equal(result, null);
  assert.equal(requests, 0);
});

test('app injects trusted v6 state and exposes writes only behind the release gate', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /hydrateComposableV6PlayerState/);
  assert.match(
    source,
    /if \(runtimeConfig\.compositionV6ReleaseEnabled !== true\s*\|\| activeTemplate\(\)\?\.source !== 'chain'\) return null;/,
  );
  assert.match(source, /\.\.\.\(composableV6State \? \{ composableV6State \} : \{\}\)/);
  assert.match(
    source,
    /\.\.\.\(runtimeConfig\.compositionV6ReleaseEnabled === true \? \{\s*async onComposableItemAction\(payload\)/,
  );
  assert.match(source, /return acquirePlayerComposableItemV6\(payload\);/);
  assert.match(source, /playerComposableV6CompletionState\(\{/);
  assert.match(source, /companionManifest:\s*structuredClone\(companionManifest\)/);
  assert.match(source, /entitlements:\s*structuredClone\(trustedState\.entitlements \|\| \[\]\)/);
  assert.match(source, /composableV6:\s*trustedComposableV6/);
  assert.match(
    source,
    /compositionV6SoulOwnerProofTypeOriginPackageId:\s*\n\s*runtimeConfig\.compositionV6SoulOwnerProofTypeOriginPackageId/,
  );
});

test('app preserves the recovery lifecycle and rehydrates confirmed Item acquisitions', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /executeComposableV6PlayerAction\(\{/);
  assert.match(source, /onStatus,/);
  assert.match(source, /confirmReadback\(\{ digest, plan \}\)/);
  assert.match(source, /hydratePlayerComposableV6\(document, \{ force: true, soulId \}\)/);
  assert.match(source, /recoverable: true/);
  assert.match(source, /composableV6State,/);
});

test('Creator v6 uses real recoverable Sui execution and chain-discovered validator authority', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /discoverComposableV6ValidatorAuthority\(\{/);
  assert.match(source, /if \(runtimeConfig\.compositionV6ReleaseEnabled !== true\) return null;\s*const validator = await discoverComposableV6ValidatorAuthority/);
  assert.match(source, /transactionFromComposableV6PublicationAction\(action\)/);
  assert.match(source, /return \{ transactionDigest: submitted\.digest \};/);
  assert.match(source, /readComposableV6PublicationSubmission\(\{/);
  assert.doesNotMatch(source, /COMPOSABLE_V6_CHAIN_EXECUTOR_PENDING_REVIEW/);
  assert.doesNotMatch(source, /validatorCapId:\s*''/);
  assert.doesNotMatch(source, /validatorAddress:\s*''/);
});

test('submitted action retry confirms the persisted plan without a second signature', async () => {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const runtime = {
    network: 'mainnet',
    callablePackageId: '0xa1',
    compositionV6TypeOriginPackageId: '0xa2',
    compositionProtocolConfigV6Id: '0xa3',
    compositionProtocolTreasuryV6Id: '0xa4',
    compositionRegistryV6Id: '0xa5',
    commerceProtocolConfigV5Id: '0xa6',
    paymentCoinType: '0xd1::usdc::USDC',
    compositionV6ReleaseEnabled: true,
    commerceV5ReleaseEnabled: true,
    canonicalSoulMintEnabled: true,
  };
  const input = {
    context: {
      wallet: '0xc1',
      makerRootId: '0xc2',
      profileId: '0xc3',
      productId: '0xc4',
    },
    product: {
      onchainProductId: '0xc4',
      access: { mode: 'FREE_CLAIM', binding: 'ACCOUNT', priceAtomic: 0 },
    },
  };
  let signatures = 0;
  const first = await executeComposableV6PlayerAction({
    runtime,
    input,
    storage,
    async signAndWait() {
      signatures += 1;
      return { digest: 'digest-v6-1' };
    },
    async confirmReadback() {
      throw new Error('indexer pending');
    },
  });
  assert.equal(first.recoverable, true);
  assert.equal(first.digest, 'digest-v6-1');
  assert.equal(signatures, 1);
  const second = await executeComposableV6PlayerAction({
    runtime,
    input,
    recovery: { digest: first.digest },
    storage,
    async signAndWait() {
      signatures += 1;
      throw new Error('must not sign twice');
    },
    async confirmReadback({ digest }) {
      return {
        transactionDigest: digest,
        readbackVerified: true,
        entitlementExists: true,
        profileId: '0xc3',
        productId: '0xc4',
        subjectId: '0xc1',
        paidAtomic: '0',
      };
    },
  });
  assert.equal(second.confirmed, true);
  assert.equal(signatures, 1);
  assert.equal(values.size, 0);
});
