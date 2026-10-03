import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnimacraftWalletUiV8 } from '../animacraft-wallet-ui.js';

function store(initial) {
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
      listeners.forEach((listener) => listener(value));
    },
  };
}

function harness() {
  const connection = store({ status: 'disconnected', wallet: null, account: null });
  const wallets = store([{ id: 'slush', name: 'Slush' }]);
  const calls = { show: 0, close: 0, disconnect: 0, removed: 0 };
  let keydown = null;
  const modal = {
    id: '',
    instance: null,
    shadowRoot: null,
    updateComplete: Promise.resolve(),
    async show() { calls.show += 1; },
    async close() { calls.close += 1; },
    remove() { calls.removed += 1; },
  };
  const doc = {
    body: { appendChild(value) { assert.equal(value, modal); } },
    addEventListener(type, listener, capture) {
      assert.equal(type, 'keydown');
      assert.equal(capture, true);
      keydown = listener;
    },
    removeEventListener(type, listener, capture) {
      assert.equal(type, 'keydown');
      assert.equal(listener, keydown);
      assert.equal(capture, true);
      keydown = null;
    },
    createElement(tag) {
      assert.equal(tag, 'mysten-dapp-kit-connect-modal');
      return modal;
    },
  };
  const dAppKit = {
    stores: { $connection: connection, $wallets: wallets },
    async disconnectWallet() {
      calls.disconnect += 1;
      connection.set({ status: 'disconnected', wallet: null, account: null });
    },
  };
  return { connection, calls, doc, dAppKit, modal, pressKey(event) { keydown?.(event); } };
}

test('approved wallet UI keeps dAppKit as the only connect and disconnect owner', async () => {
  const value = harness();
  const ui = await createAnimacraftWalletUiV8({
    doc: value.doc,
    client: {},
    MutationObserverClass: null,
    createKit: () => value.dAppKit,
    registerWebComponents: async () => {},
  });
  assert.equal(ui.modal.id, 'suiWalletModal');
  assert.equal(ui.getConnection().connected, false);

  await ui.openWalletSelector();
  assert.equal(value.calls.show, 1);
  assert.equal(value.calls.disconnect, 0);

  const account = {
    address: `0x${'1'.repeat(64)}`,
    chains: ['sui:mainnet'],
  };
  value.connection.set({
    status: 'connected',
    wallet: { id: 'slush', name: 'Slush' },
    account,
  });
  assert.deepEqual(ui.getConnection(), {
    connected: true,
    address: account.address,
    provider: 'Slush',
    walletId: 'slush',
    status: 'connected',
    account,
    wallet: { id: 'slush', name: 'Slush' },
  });

  await ui.openWalletSelector();
  assert.equal(value.calls.show, 1);
  assert.equal(value.calls.disconnect, 1);
  ui.destroy();
  assert.equal(value.calls.removed, 1);
});

test('wallet localization preserves Lit-managed child markers and observes text updates', async () => {
  const value = harness();
  const titleMarker = { nodeType: 8, nodeValue: '?lit$' };
  const titleText = { nodeType: 3, nodeValue: 'Connect a wallet' };
  const actionMarker = { nodeType: 8, nodeValue: '?lit$' };
  const actionText = { nodeType: 3, nodeValue: '\n\tCancel\n' };
  const attributes = new Map();
  const action = { childNodes: [actionMarker, actionText] };
  const dialog = { open: true };
  const status = {
    title: 'Awaiting connection...',
    copy: 'Accept the request from Slush in order to proceed',
    wallet: { name: 'Slush' },
    querySelector(selector) {
      return selector === 'internal-button' ? action : null;
    },
  };
  const title = { childNodes: [titleMarker, titleText] };
  const button = {
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, next) { attributes.set(name, next); },
  };
  value.modal.shadowRoot = {
    querySelector(selector) {
      if (selector === 'dialog') return dialog;
      if (selector === '.title') return title;
      if (selector === '.back-button' || selector === '.close-button') return button;
      if (selector === 'connection-status') return status;
      return null;
    },
  };
  let observerOptions = null;
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(_target, options) { observerOptions = options; }
    disconnect() {}
  }

  const ui = await createAnimacraftWalletUiV8({
    doc: value.doc,
    client: {},
    locale: 'zh',
    MutationObserverClass: Observer,
    createKit: () => value.dAppKit,
    registerWebComponents: async () => {},
  });
  await Promise.resolve();

  assert.equal(title.childNodes[0], titleMarker);
  assert.equal(title.childNodes[1], titleText);
  assert.equal(titleText.nodeValue, '连接钱包');
  assert.equal(action.childNodes[0], actionMarker);
  assert.equal(action.childNodes[1], actionText);
  assert.equal(actionText.nodeValue, '\n\t取消\n');
  assert.equal(status.title, '等待连接…');
  assert.equal(status.copy, '请在 Slush 中接受连接请求以继续。');
  assert.deepEqual(observerOptions, { characterData: true, childList: true, subtree: true });

  ui.setLocale('ja');
  assert.equal(title.childNodes[0], titleMarker);
  assert.equal(titleText.nodeValue, 'ウォレットを接続');
  assert.equal(action.childNodes[0], actionMarker);
  assert.equal(actionText.nodeValue, '\n\tキャンセル\n');
  assert.equal(status.title, '接続を待機中…');
  assert.equal(status.copy, '続行するには Slush でリクエストを承認してください。');

  let defaultPrevented = false;
  value.pressKey({ key: 'Escape', preventDefault() { defaultPrevented = true; } });
  assert.equal(defaultPrevented, true);
  assert.equal(value.calls.close, 1);
  ui.destroy();
  value.pressKey({ key: 'Escape' });
  assert.equal(value.calls.close, 1);
});

test('wallet UI source owns no transaction, broadcast, or RPC authority', async () => {
  const source = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../animacraft-wallet-ui.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /executeTransaction|broadcast|signTransaction|JsonRpc/);
  assert.doesNotMatch(source, /\.textContent\s*=/);
  assert.match(source, /mysten-dapp-kit-connect-modal/);
  assert.match(source, /disconnectWallet/);
});
