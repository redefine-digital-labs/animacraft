import { makeTinyDraft } from './tiny-fomoney-draft.js';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { createMakerV8LocalPlayerStore } from '../maker-v8-local-player-store.js';
import { createMakerV8ProductBridge } from '../maker-v8-product-bridge.js';
import { createOriginalProductApp } from '../original-product-app.js';

// Explicit test identity only: no installed wallet, keys, signature or RPC adapter.
const address = '0x' + '1'.repeat(64);
const denied = () => { throw new Error('Local acceptance only: chain/wallet operation unavailable'); };
const drafts = createMakerV8DraftPersistence(indexedDB, { databaseName: 'tiny-fomoney-creator-acceptance-only' });
const localPlayerStore = createMakerV8LocalPlayerStore(indexedDB, { databaseName: 'tiny-fomoney-creator-player-acceptance-only' });
try {
  const catalog = await (await fetch('/tiny-catalog.json')).json();
  for (const [gender, layers] of Object.entries(catalog)) {
    const draftId = `tiny-${gender}-ui`;
    if (await drafts.load(draftId)) continue;
    const { draft: document, assets } = makeTinyDraft(gender, layers);
    await drafts.createBundle({ draftId, document, assets });
  }
  const productRuntime = {
    ready: async () => true,
    catalog: { loadPlaza: async () => ({ status: 'READY', makers: [], diagnostics: [] }), loadPlayer: denied },
    wallet: { getCurrentAccount: async () => ({ address, network: 'mainnet' }), reconnect: denied },
  };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, localPlayerStore,
    execution: { allowWalletSignature: false, allowBroadcast: false } });
  const walletUi = { openWalletSelector: denied, disconnect: denied, setLocale() {},
    getConnection: () => ({ account: { address, chains: ['sui:mainnet'] } }) };
  // The real app requires the public Player entry even in a local-only run.
  // Supply an explicit rejection, never a simulated successful chain session.
  const report = (message) => { document.querySelector('#tinyHarnessStatus').textContent = `本地验收 · 非真实钱包 · 链上禁用 · ${message}`; };
  document.addEventListener('change', (event) => {
    if (event.target?.dataset?.action) report(`change: ${event.target.dataset.action}`);
  }, true);
  const app = createOriginalProductApp({ bridge: { ...bridge, openPlayerSession: denied,
    async exportProjectZip(input) {
      try {
        const result = await bridge.exportProjectZip(input);
        report(`ZIP 已生成 · ${result.byteLength} bytes（下载完成另行核验）`);
        return result;
      } catch (error) { report(`ZIP 生成失败：${error.message}`); throw error; }
    },
    async dispatchDraftCommand(input) {
      try {
        const result = await bridge.dispatchDraftCommand(input);
        report(`已提交 ${input.command.type} · revision ${result.revision}`);
        return result;
      } catch (error) { report(`保存失败：${error.message}`); throw error; }
    },
  }, walletUi, win: window, doc: document });
  await app.ready;
  app.navigate('creator');
  // Seed only on first run; opening later preserves actual saved edits/history.
  await app.openDraft('tiny-man-ui');
  document.querySelector('#tinyHarnessStatus').textContent = '本地验收 · 测试身份（非真实钱包）· 原 Creator/Player + 真实本地保存 · 链上操作禁用';
  window.addEventListener('pagehide', () => { app.destroy(); bridge.dispose(); localPlayerStore.close(); }, { once: true });
} catch (error) {
  document.querySelector('#tinyHarnessStatus').textContent = `本地验收加载失败：${error.message}`;
  throw error;
}
