import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDAppKit } from '@mysten/dapp-kit-core';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import {
  ReadonlyWalletAccount,
  SUI_MAINNET_CHAIN,
  StandardConnect,
  StandardEvents,
  SuiSignPersonalMessage,
  SuiSignTransaction,
  SuiSignTransactionBlock,
  getWallets,
} from '@mysten/wallet-standard';

import {
  MAKER_V8_DAPP_KIT_NETWORK,
  createMakerV8DAppKitWalletAdapterV8,
} from '../maker-v8-dapp-kit-wallet.js';

function exactBytes(keypair, budget = '1000') {
  return TransactionDataBuilder.restore({
    version: 2,
    sender: keypair.toSuiAddress(),
    expiration: { Epoch: '101' },
    gasData: {
      budget,
      price: '1',
      owner: keypair.toSuiAddress(),
      payment: [],
    },
    inputs: [],
    commands: [],
  }).build();
}

function connectionStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener(value);
    },
    get listenerCount() { return listeners.size; },
  };
}

const harnessByAccount = new WeakMap();

function walletHarness(keypair, { id = 'wallet', name = id, legacy = false } = {}) {
  let signCalls = 0;
  let personalSignCalls = 0;
  const feature = legacy ? SuiSignTransactionBlock : SuiSignTransaction;
  const account = {
    address: keypair.toSuiAddress(),
    chains: [SUI_MAINNET_CHAIN],
    features: [feature, SuiSignPersonalMessage],
    publicKey: keypair.getPublicKey().toRawBytes(),
  };
  const wallet = {
    id,
    name,
    version: '1.0.0',
    chains: [SUI_MAINNET_CHAIN],
    accounts: [account],
    features: [feature, SuiSignPersonalMessage],
  };
  const harness = {
    wallet,
    account,
    keypair,
    async signTransaction({ transaction }) {
      signCalls += 1;
      return keypair.signTransaction(await transaction.build());
    },
    async signPersonalMessage({ message }) {
      personalSignCalls += 1;
      return keypair.signPersonalMessage(message);
    },
    get signCalls() { return signCalls; },
    get personalSignCalls() { return personalSignCalls; },
  };
  harnessByAccount.set(account, harness);
  return harness;
}

function dAppKitHarness(connection) {
  const store = connectionStore(connection);
  let connectCalls = 0;
  let disconnectCalls = 0;
  const transactionRequests = [];
  const personalMessageRequests = [];
  const dAppKit = {
    stores: { $connection: store },
    async connectWallet() {
      connectCalls += 1;
      throw new Error('Fresh-v8 must never connect or select a wallet');
    },
    async disconnectWallet() {
      disconnectCalls += 1;
      store.set({ status: 'disconnected', wallet: null, account: null });
    },
    async signTransaction(input) {
      transactionRequests.push(input);
      assert.equal(input.network, MAKER_V8_DAPP_KIT_NETWORK);
      const harness = harnessByAccount.get(input.account);
      assert.ok(harness, 'selected UiWalletAccount must be passed back to dAppKit');
      return harness.signTransaction(input);
    },
    async signPersonalMessage(input) {
      personalMessageRequests.push(input);
      assert.equal(input.network, MAKER_V8_DAPP_KIT_NETWORK);
      const harness = harnessByAccount.get(input.account);
      assert.ok(harness, 'selected UiWalletAccount must be passed back to dAppKit');
      return harness.signPersonalMessage(input);
    },
  };
  return {
    dAppKit,
    store,
    transactionRequests,
    personalMessageRequests,
    get connectCalls() { return connectCalls; },
    get disconnectCalls() { return disconnectCalls; },
  };
}

function signRequest(keypair, budget = '1000') {
  const raw = exactBytes(keypair, budget);
  return {
    raw,
    bytes: toBase64(raw),
    digest: TransactionDataBuilder.getDigestFromBytes(raw),
    signer: keypair.toSuiAddress(),
  };
}

let registeredWalletSequence = 0;

function registeredWalletHarness({ legacy = false, wrongTransactionSigner = false } = {}) {
  registeredWalletSequence += 1;
  const keypairs = [new Ed25519Keypair(), new Ed25519Keypair()];
  const attacker = new Ed25519Keypair();
  const transactionFeature = legacy ? SuiSignTransactionBlock : SuiSignTransaction;
  const accounts = keypairs.map((keypair, index) => new ReadonlyWalletAccount({
    address: keypair.toSuiAddress(),
    publicKey: keypair.getPublicKey().toRawBytes(),
    chains: [SUI_MAINNET_CHAIN],
    features: [transactionFeature, SuiSignPersonalMessage],
    label: `Account ${index + 1}`,
  }));
  const keypairByAddress = new Map(keypairs.map((keypair) => [keypair.toSuiAddress(), keypair]));
  let transactionSignCalls = 0;
  let personalSignCalls = 0;
  const wallet = {
    id: `animacraft-real-shape-${registeredWalletSequence}`,
    name: `Animacraft real shape ${registeredWalletSequence}`,
    version: '1.0.0',
    chains: [SUI_MAINNET_CHAIN],
    accounts,
    features: {
      [StandardConnect]: {
        version: '1.0.0',
        async connect() { return { accounts }; },
      },
      [StandardEvents]: {
        version: '1.0.0',
        on() { return () => {}; },
      },
      [SuiSignPersonalMessage]: {
        version: '1.1.0',
        async signPersonalMessage({ message, account }) {
          personalSignCalls += 1;
          const keypair = keypairByAddress.get(account.address);
          assert.ok(keypair, 'dAppKit must resolve the selected underlying WalletAccount');
          return keypair.signPersonalMessage(message);
        },
      },
      ...(legacy ? {
        [SuiSignTransactionBlock]: {
          version: '1.0.0',
          async signTransactionBlock({ transactionBlock, account }) {
            transactionSignCalls += 1;
            const keypair = keypairByAddress.get(account.address);
            assert.ok(keypair, 'dAppKit must resolve the selected legacy WalletAccount');
            const signed = await keypair.signTransaction(await transactionBlock.build());
            return { transactionBlockBytes: signed.bytes, signature: signed.signature };
          },
        },
      } : {
        [SuiSignTransaction]: {
          version: '2.0.0',
          async signTransaction({ transaction, account }) {
            transactionSignCalls += 1;
            const selected = wrongTransactionSigner
              ? attacker
              : keypairByAddress.get(account.address);
            assert.ok(selected, 'dAppKit must resolve the selected modern WalletAccount');
            const materialized = Transaction.from(await transaction.toJSON());
            return selected.signTransaction(await materialized.build());
          },
        },
      }),
    },
  };
  const unregister = getWallets().register(wallet);
  const dAppKit = createDAppKit({
    networks: [MAKER_V8_DAPP_KIT_NETWORK],
    defaultNetwork: MAKER_V8_DAPP_KIT_NETWORK,
    createClient: () => ({ network: MAKER_V8_DAPP_KIT_NETWORK }),
    autoConnect: false,
    storage: null,
    slushWalletConfig: null,
  });
  const unmountWallets = dAppKit.stores.$wallets.subscribe(() => {});
  const uiWallet = dAppKit.stores.$wallets.get().find((candidate) => candidate.name === wallet.name);
  assert.ok(uiWallet, 'registered Wallet Standard wallet must project into a UiWallet');

  return {
    dAppKit,
    uiWallet,
    keypairs,
    async connect(accountIndex = 0) {
      await dAppKit.connectWallet({ wallet: uiWallet, account: uiWallet.accounts[accountIndex] });
      return dAppKit.stores.$connection.get();
    },
    cleanup(adapter) {
      adapter?.dispose();
      unmountWallets();
      unregister();
    },
    get transactionSignCalls() { return transactionSignCalls; },
    get personalSignCalls() { return personalSignCalls; },
  };
}

test('uses only dAppKit selected wallet/account, including the second installed wallet', async () => {
  const first = walletHarness(new Ed25519Keypair(), { id: 'first-wallet' });
  const second = walletHarness(new Ed25519Keypair(), { id: 'second-wallet' });
  const kit = dAppKitHarness({
    status: 'connected',
    wallet: second.wallet,
    account: second.account,
    installedWallets: [first.wallet, second.wallet],
  });
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  assert.deepEqual(await adapter.reconnect(), {
    address: second.account.address,
    network: MAKER_V8_DAPP_KIT_NETWORK,
  });
  const request = signRequest(second.keypair);
  const signed = await adapter.signExactTransaction(request);

  assert.equal(signed.bytes, request.bytes);
  assert.equal(signed.digest, request.digest);
  assert.equal(signed.signer, second.account.address);
  assert.equal((await adapter.verifyExactSignature(signed)).verified, true);
  assert.equal(first.signCalls, 0);
  assert.equal(second.signCalls, 1);
  assert.equal(kit.transactionRequests.length, 1);
  assert.equal(kit.transactionRequests[0].account, second.account);
  assert.equal(kit.transactionRequests[0].network, 'mainnet');
  assert.ok(kit.transactionRequests[0].transaction instanceof Transaction);
  assert.equal(kit.connectCalls, 0);
});

test('fails closed when dAppKit switches the selected account during the prompt', async () => {
  const original = walletHarness(new Ed25519Keypair(), { id: 'selected-wallet' });
  const replacement = walletHarness(new Ed25519Keypair(), { id: 'selected-wallet' });
  replacement.wallet.features = original.wallet.features;
  const kit = dAppKitHarness({
    status: 'connected', wallet: original.wallet, account: original.account,
  });
  kit.dAppKit.signTransaction = async ({ transaction }) => {
    kit.store.set({
      status: 'connected', wallet: original.wallet, account: replacement.account,
    });
    return original.keypair.signTransaction(await transaction.build());
  };
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });
  const request = signRequest(original.keypair);

  await assert.rejects(
    adapter.signExactTransaction(request),
    { code: 'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT' },
  );
});

test('rejects wallet-returned TransactionData substitution before accepting a signature', async () => {
  const selected = walletHarness(new Ed25519Keypair());
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  const changed = exactBytes(selected.keypair, '1001');
  kit.dAppKit.signTransaction = async () => {
    const signed = await selected.keypair.signTransaction(changed);
    return { bytes: toBase64(changed), signature: signed.signature };
  };
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await assert.rejects(
    adapter.signExactTransaction(signRequest(selected.keypair)),
    { code: 'MAKER_V8_DAPP_KIT_SIGNED_BYTES_DRIFT' },
  );
});

test('rejects a signature from any signer other than the dAppKit-selected address', async () => {
  const selected = walletHarness(new Ed25519Keypair());
  const attacker = new Ed25519Keypair();
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  kit.dAppKit.signTransaction = async ({ transaction }) => (
    attacker.signTransaction(await transaction.build())
  );
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await assert.rejects(
    adapter.signExactTransaction(signRequest(selected.keypair)),
    { code: 'MAKER_V8_DAPP_KIT_SIGNATURE_INVALID' },
  );
});

test('disconnect delegates exclusively to dAppKit and reconnect never initiates connection', async () => {
  const selected = walletHarness(new Ed25519Keypair());
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await adapter.disconnect();
  assert.equal(kit.disconnectCalls, 1);
  assert.equal(kit.connectCalls, 0);
  await assert.rejects(
    adapter.reconnect(),
    { code: 'MAKER_V8_DAPP_KIT_WALLET_NOT_CONNECTED' },
  );
  assert.equal(kit.connectCalls, 0);
});

test('subscription follows dAppKit account revisions and dispose removes the observer', () => {
  const first = walletHarness(new Ed25519Keypair(), { id: 'wallet' });
  const second = walletHarness(new Ed25519Keypair(), { id: 'wallet' });
  second.wallet.features = first.wallet.features;
  const kit = dAppKitHarness({
    status: 'connected', wallet: first.wallet, account: first.account,
  });
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });
  const snapshots = [];
  adapter.subscribe((value) => snapshots.push(value));

  kit.store.set({ status: 'connected', wallet: first.wallet, account: second.account });
  assert.equal(snapshots.at(-1).account.address, second.account.address);
  assert.ok(snapshots.at(-1).revision > snapshots[0].revision);
  assert.equal(kit.store.listenerCount, 1);

  adapter.dispose();
  assert.equal(kit.store.listenerCount, 0);
});

test('dAppKit route accepts a selected legacy signTransactionBlock account', async () => {
  const legacy = walletHarness(new Ed25519Keypair(), { id: 'legacy-wallet', legacy: true });
  const kit = dAppKitHarness({
    status: 'connected', wallet: legacy.wallet, account: legacy.account,
  });
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });
  const request = signRequest(legacy.keypair);

  const signed = await adapter.signExactTransaction(request);
  assert.equal(signed.bytes, request.bytes);
  assert.equal(signed.signer, legacy.account.address);
  assert.equal(legacy.signCalls, 1);
});

test('personal-message signing uses the exact dAppKit-selected Mainnet account and bytes', async () => {
  const selected = walletHarness(new Ed25519Keypair());
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });
  const message = new TextEncoder().encode('animacraft-v8/seal/session/exact');

  const signed = await adapter.signExactPersonalMessage({
    message,
    signer: selected.account.address,
  });

  assert.deepEqual(signed, {
    bytes: toBase64(message),
    signature: signed.signature,
    signer: selected.account.address,
  });
  assert.equal(selected.personalSignCalls, 1);
  assert.equal(selected.signCalls, 0);
  assert.equal(kit.personalMessageRequests.length, 1);
  assert.equal(kit.personalMessageRequests[0].account, selected.account);
  assert.equal(kit.personalMessageRequests[0].network, 'mainnet');
  assert.deepEqual(kit.personalMessageRequests[0].message, message);
});

test('personal-message signing fails closed on prompt-time account revision drift', async () => {
  const original = walletHarness(new Ed25519Keypair(), { id: 'personal-wallet' });
  const replacement = walletHarness(new Ed25519Keypair(), { id: 'personal-wallet' });
  const kit = dAppKitHarness({
    status: 'connected', wallet: original.wallet, account: original.account,
  });
  kit.dAppKit.signPersonalMessage = async ({ message }) => {
    kit.store.set({
      status: 'connected', wallet: original.wallet, account: replacement.account,
    });
    return original.keypair.signPersonalMessage(message);
  };
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await assert.rejects(
    adapter.signExactPersonalMessage({
      message: new TextEncoder().encode('animacraft-v8/seal/session/drift'),
      signer: original.account.address,
    }),
    { code: 'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT' },
  );
});

test('personal-message signing rejects substituted bytes and a different signer', async () => {
  const selected = walletHarness(new Ed25519Keypair());
  const attacker = new Ed25519Keypair();
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  const message = new TextEncoder().encode('animacraft-v8/seal/session/original');
  const substituted = new TextEncoder().encode('animacraft-v8/seal/session/substituted');
  kit.dAppKit.signPersonalMessage = async () => {
    const signed = await attacker.signPersonalMessage(substituted);
    return { bytes: toBase64(substituted), signature: signed.signature };
  };
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await assert.rejects(
    adapter.signExactPersonalMessage({ message, signer: selected.account.address }),
    { code: 'MAKER_V8_DAPP_KIT_PERSONAL_MESSAGE_INVALID' },
  );

  kit.dAppKit.signPersonalMessage = async () => {
    const signed = await attacker.signPersonalMessage(message);
    return { bytes: toBase64(message), signature: signed.signature };
  };
  await assert.rejects(
    adapter.signExactPersonalMessage({ message, signer: selected.account.address }),
    { code: 'MAKER_V8_DAPP_KIT_PERSONAL_MESSAGE_INVALID' },
  );
});

test('only the pinned Slush Web origin-checked plain reject is definitive', async () => {
  const selected = walletHarness(new Ed25519Keypair(), {
    id: 'com.mystenlabs.suiwallet.web',
    name: 'Slush',
  });
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  kit.dAppKit.signTransaction = async () => {
    throw new Error('User rejected the request');
  };
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await assert.rejects(
    adapter.signExactTransaction(signRequest(selected.keypair)),
    (error) => error.code === 'MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED'
      && error.definitiveRejection === true
      && error.signedArtifactCreated === false,
  );

  kit.dAppKit.signPersonalMessage = async () => {
    throw new Error('User rejected the request');
  };
  await assert.rejects(
    adapter.signExactPersonalMessage({
      message: new TextEncoder().encode('animacraft-v8/seal/session/rejected'),
      signer: selected.account.address,
    }),
    (error) => error.code === 'MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED'
      && error.definitiveRejection === true
      && error.signedArtifactCreated === false,
  );
});

test('plain rejection text from any other wallet remains an unknown signing error', async () => {
  const selected = walletHarness(new Ed25519Keypair(), {
    id: 'untrusted-wallet',
    name: 'Slush',
  });
  const kit = dAppKitHarness({
    status: 'connected', wallet: selected.wallet, account: selected.account,
  });
  const ambiguous = new Error('User rejected the request');
  kit.dAppKit.signTransaction = async () => { throw ambiguous; };
  const adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: kit.dAppKit });

  await assert.rejects(
    adapter.signExactTransaction(signRequest(selected.keypair)),
    (error) => error === ambiguous
      && error.definitiveRejection === undefined
      && error.signedArtifactCreated === undefined,
  );
});

test('real createDAppKit UiWallet signs modern transactions and personal messages across account switches', async () => {
  const harness = registeredWalletHarness();
  let adapter;
  try {
    const connected = await harness.connect(0);
    assert.ok(Array.isArray(connected.wallet.features));
    assert.ok(Array.isArray(connected.account.features));
    assert.equal(connected.wallet.features[SuiSignTransaction], undefined);
    adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: harness.dAppKit });

    const firstRequest = signRequest(harness.keypairs[0]);
    const firstSigned = await adapter.signExactTransaction(firstRequest);
    assert.equal(firstSigned.bytes, firstRequest.bytes);
    const message = new TextEncoder().encode('animacraft-v8/real-dapp-kit/personal');
    const personal = await adapter.signExactPersonalMessage({
      message,
      signer: harness.keypairs[0].toSuiAddress(),
    });
    assert.equal(personal.bytes, toBase64(message));
    assert.equal(personal.signer, harness.keypairs[0].toSuiAddress());

    harness.dAppKit.switchAccount({ account: harness.uiWallet.accounts[1] });
    await assert.rejects(
      adapter.signExactTransaction(firstRequest),
      { code: 'MAKER_V8_DAPP_KIT_ACCOUNT_DRIFT' },
    );
    const secondRequest = signRequest(harness.keypairs[1]);
    const secondSigned = await adapter.signExactTransaction(secondRequest);
    assert.equal(secondSigned.signer, harness.keypairs[1].toSuiAddress());
    assert.equal(harness.transactionSignCalls, 2);
    assert.equal(harness.personalSignCalls, 1);
  } finally {
    harness.cleanup(adapter);
  }
});

test('real createDAppKit UiWallet preserves legacy signTransactionBlock fallback', async () => {
  const harness = registeredWalletHarness({ legacy: true });
  let adapter;
  try {
    const connected = await harness.connect(0);
    assert.ok(connected.wallet.features.includes(SuiSignTransactionBlock));
    assert.ok(!connected.wallet.features.includes(SuiSignTransaction));
    adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: harness.dAppKit });
    const request = signRequest(harness.keypairs[0]);

    const signed = await adapter.signExactTransaction(request);
    assert.equal(signed.bytes, request.bytes);
    assert.equal(signed.signer, harness.keypairs[0].toSuiAddress());
    assert.equal(harness.transactionSignCalls, 1);
  } finally {
    harness.cleanup(adapter);
  }
});

test('real createDAppKit path rejects a cryptographically wrong transaction signature', async () => {
  const harness = registeredWalletHarness({ wrongTransactionSigner: true });
  let adapter;
  try {
    await harness.connect(0);
    adapter = createMakerV8DAppKitWalletAdapterV8({ dAppKit: harness.dAppKit });
    await assert.rejects(
      adapter.signExactTransaction(signRequest(harness.keypairs[0])),
      { code: 'MAKER_V8_DAPP_KIT_SIGNATURE_INVALID' },
    );
  } finally {
    harness.cleanup(adapter);
  }
});

test('adapter source has no UI or wallet discovery/connection implementation', async () => {
  const source = await readFile(new URL('../maker-v8-dapp-kit-wallet.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|createElement|querySelector/);
  assert.doesNotMatch(source, /\bgetWallets\b|\bconnectWallet\b|walletModal/);
  assert.doesNotMatch(source, /walletStandardSignTransaction|getWalletForHandle|getWalletAccount/);
});
