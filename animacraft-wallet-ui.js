import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';

export const ANIMACRAFT_WALLET_UI_SCHEMA = 'animacraft.wallet-ui.v8';

const WALLET_MODAL_COPY = Object.freeze({
  en: Object.freeze({
    connect: 'Connect a wallet',
    noneInstalled: 'No wallets installed',
    back: 'Go back',
    close: 'Close',
    awaiting: 'Awaiting connection...',
    accept: 'Accept the request from {wallet} in order to proceed',
    cancel: 'Cancel',
    requestCanceled: 'Request canceled',
    canceledCopy: 'You canceled the request',
    failed: 'Connection failed',
    failedCopy: 'Something went wrong. Please try again',
    retry: 'Retry',
  }),
  zh: Object.freeze({
    connect: '连接钱包',
    noneInstalled: '未安装可用钱包',
    back: '返回',
    close: '关闭',
    awaiting: '等待连接…',
    accept: '请在 {wallet} 中接受连接请求以继续。',
    cancel: '取消',
    requestCanceled: '请求已取消',
    canceledCopy: '你已取消该请求。',
    failed: '连接失败',
    failedCopy: '出现问题，请重试。',
    retry: '重试',
  }),
  ja: Object.freeze({
    connect: 'ウォレットを接続',
    noneInstalled: '利用できるウォレットがインストールされていません',
    back: '戻る',
    close: '閉じる',
    awaiting: '接続を待機中…',
    accept: '続行するには {wallet} でリクエストを承認してください。',
    cancel: 'キャンセル',
    requestCanceled: 'リクエストはキャンセルされました',
    canceledCopy: 'リクエストをキャンセルしました。',
    failed: '接続に失敗しました',
    failedCopy: '問題が発生しました。もう一度お試しください。',
    retry: '再試行',
  }),
  ko: Object.freeze({
    connect: '지갑 연결',
    noneInstalled: '설치된 지갑이 없습니다',
    back: '뒤로',
    close: '닫기',
    awaiting: '연결 승인 대기 중…',
    accept: '계속하려면 {wallet}에서 요청을 승인하세요.',
    cancel: '취소',
    requestCanceled: '요청이 취소되었습니다',
    canceledCopy: '요청을 취소했습니다.',
    failed: '연결에 실패했습니다',
    failedCopy: '문제가 발생했습니다. 다시 시도하세요.',
    retry: '다시 시도',
  }),
  vi: Object.freeze({
    connect: 'Kết nối ví',
    noneInstalled: 'Chưa cài đặt ví nào',
    back: 'Quay lại',
    close: 'Đóng',
    awaiting: 'Đang chờ kết nối…',
    accept: 'Chấp nhận yêu cầu trong {wallet} để tiếp tục.',
    cancel: 'Hủy',
    requestCanceled: 'Yêu cầu đã bị hủy',
    canceledCopy: 'Bạn đã hủy yêu cầu.',
    failed: 'Kết nối thất bại',
    failedCopy: 'Đã xảy ra lỗi. Vui lòng thử lại.',
    retry: 'Thử lại',
  }),
});

function fail(code, message) {
  const error = new Error(message);
  error.name = 'AnimacraftWalletUiError';
  error.code = code;
  error.layer = 'WALLET';
  throw error;
}

function statusKey(title) {
  if (Object.values(WALLET_MODAL_COPY).some((copy) => copy.awaiting === title)) return 'awaiting';
  if (Object.values(WALLET_MODAL_COPY).some((copy) => copy.requestCanceled === title)) return 'requestCanceled';
  if (Object.values(WALLET_MODAL_COPY).some((copy) => copy.failed === title)) return 'failed';
  return '';
}

function connectionSnapshot(connection) {
  const address = typeof connection?.account?.address === 'string'
    ? connection.account.address.toLowerCase() : '';
  return Object.freeze({
    connected: Boolean(address),
    address,
    provider: String(connection?.wallet?.name || ''),
    walletId: String(connection?.wallet?.id || connection?.wallet?.name || ''),
    status: String(connection?.status || (address ? 'connected' : 'disconnected')),
    account: connection?.account ?? null,
    wallet: connection?.wallet ?? null,
  });
}

function replaceDirectTextNodeValue(element, nextValue) {
  if (!element?.childNodes) return false;
  const textNode = Array.from(element.childNodes)
    .find((node) => node?.nodeType === 3 && String(node.nodeValue || '').trim());
  if (!textNode) return false;
  const currentValue = String(textNode.nodeValue || '');
  const leadingWhitespace = currentValue.match(/^\s*/u)?.[0] || '';
  const trailingWhitespace = currentValue.match(/\s*$/u)?.[0] || '';
  const localizedValue = `${leadingWhitespace}${nextValue}${trailingWhitespace}`;
  if (currentValue === localizedValue) return true;
  textNode.nodeValue = localizedValue;
  return true;
}

/**
 * The approved wallet selector from aac90dbc, isolated from every chain
 * transaction. dAppKit remains the sole owner of discovery, selection,
 * auto-connect and disconnect; Fresh-v8 only consumes its selected account.
 */
export async function createAnimacraftWalletUiV8({
  network = 'mainnet',
  grpcUrl,
  client = null,
  locale = 'en',
  doc = globalThis.document,
  MutationObserverClass = globalThis.MutationObserver,
  createKit = createDAppKit,
  registerWebComponents = () => import('@mysten/dapp-kit-core/web'),
} = {}) {
  if (network !== 'mainnet') {
    fail('ANIMACRAFT_WALLET_NETWORK_INVALID', 'The approved wallet selector is pinned to Sui Mainnet.');
  }
  if (!doc?.body || typeof doc.createElement !== 'function') {
    fail('ANIMACRAFT_WALLET_DOCUMENT_REQUIRED', 'The approved wallet selector requires a browser document.');
  }
  if (typeof createKit !== 'function') {
    fail('ANIMACRAFT_WALLET_DAPP_KIT_REQUIRED', 'The approved dAppKit factory is required.');
  }
  if (typeof registerWebComponents !== 'function') {
    fail('ANIMACRAFT_WALLET_COMPONENTS_INVALID', 'The approved dAppKit web-component registrar is required.');
  }
  await registerWebComponents();
  const suiClient = client ?? new SuiGrpcClient({ network, baseUrl: grpcUrl });
  const dAppKit = createKit({
    networks: [network],
    defaultNetwork: network,
    autoConnect: true,
    createClient: () => suiClient,
  });
  if (!dAppKit?.stores?.$connection?.subscribe
    || typeof dAppKit.stores.$connection.get !== 'function'
    || typeof dAppKit.disconnectWallet !== 'function') {
    fail('ANIMACRAFT_WALLET_DAPP_KIT_INVALID', 'dAppKit did not expose its approved connection store.');
  }

  let activeLocale = Object.hasOwn(WALLET_MODAL_COPY, locale) ? locale : 'en';
  let disposed = false;
  let observer = null;
  const listeners = new Set();
  const modal = doc.createElement('mysten-dapp-kit-connect-modal');
  modal.id = 'suiWalletModal';
  modal.instance = dAppKit;
  doc.body.appendChild(modal);
  const closeOnEscape = (event) => {
    if (event?.key !== 'Escape') return;
    const dialog = modal.shadowRoot?.querySelector?.('dialog');
    if (!dialog?.open) return;
    event.preventDefault?.();
    void modal.close?.('cancel');
  };
  doc.addEventListener?.('keydown', closeOnEscape, true);

  const translate = () => {
    const root = modal.shadowRoot;
    if (!root) return;
    const copy = WALLET_MODAL_COPY[activeLocale] || WALLET_MODAL_COPY.en;
    const wallets = dAppKit.stores.$wallets?.get?.() || [];
    const title = root.querySelector('.title');
    const titleCopy = wallets.length ? copy.connect : copy.noneInstalled;
    replaceDirectTextNodeValue(title, titleCopy);
    const back = root.querySelector('.back-button');
    if (back?.getAttribute('aria-label') !== copy.back) back?.setAttribute('aria-label', copy.back);
    const close = root.querySelector('.close-button');
    if (close?.getAttribute('aria-label') !== copy.close) close?.setAttribute('aria-label', copy.close);
    const status = root.querySelector('connection-status');
    if (!status) return;
    const key = statusKey(status.title);
    if (key === 'awaiting') {
      status.title = copy.awaiting;
      status.copy = copy.accept.replace('{wallet}', status.wallet?.name || '');
    } else if (key === 'requestCanceled') {
      status.title = copy.requestCanceled;
      status.copy = copy.canceledCopy;
    } else if (key === 'failed') {
      status.title = copy.failed;
      status.copy = copy.failedCopy;
    }
    const action = status.querySelector('internal-button');
    const actionCopy = key === 'awaiting' ? copy.cancel : copy.retry;
    replaceDirectTextNodeValue(action, actionCopy);
  };

  void modal.updateComplete?.then(() => {
    if (disposed) return;
    translate();
    if (MutationObserverClass && modal.shadowRoot) {
      observer = new MutationObserverClass(translate);
      observer.observe(modal.shadowRoot, { characterData: true, childList: true, subtree: true });
    }
  });

  let current = connectionSnapshot(dAppKit.stores.$connection.get());
  const offConnection = dAppKit.stores.$connection.subscribe((connection) => {
    current = connectionSnapshot(connection);
    listeners.forEach((listener) => listener(current));
  });

  return Object.freeze({
    schemaVersion: ANIMACRAFT_WALLET_UI_SCHEMA,
    dAppKit,
    modal,
    client: suiClient,
    getConnection() {
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        fail('ANIMACRAFT_WALLET_LISTENER_INVALID', 'Wallet listener must be a function.');
      }
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    setLocale(nextLocale) {
      activeLocale = Object.hasOwn(WALLET_MODAL_COPY, nextLocale) ? nextLocale : 'en';
      translate();
    },
    async openWalletSelector() {
      if (disposed) fail('ANIMACRAFT_WALLET_DISPOSED', 'The wallet selector has been disposed.');
      if (current.connected) {
        await dAppKit.disconnectWallet();
        return connectionSnapshot(dAppKit.stores.$connection.get());
      }
      if (typeof modal.show !== 'function') {
        fail('ANIMACRAFT_WALLET_MODAL_UNAVAILABLE', 'The approved wallet modal is unavailable.');
      }
      await modal.show();
      return connectionSnapshot(dAppKit.stores.$connection.get());
    },
    async disconnect() {
      if (disposed) fail('ANIMACRAFT_WALLET_DISPOSED', 'The wallet selector has been disposed.');
      await dAppKit.disconnectWallet();
      return connectionSnapshot(dAppKit.stores.$connection.get());
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      offConnection?.();
      observer?.disconnect();
      listeners.clear();
      doc.removeEventListener?.('keydown', closeOnEscape, true);
      modal.remove();
    },
  });
}
