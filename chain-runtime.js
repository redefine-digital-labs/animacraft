import '@mysten/dapp-kit-core/web';
import { createDAppKit } from '@mysten/dapp-kit-core';
import { fromBase64, toBase64 } from '@mysten/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url';
import { assertProtocolV3IncludedItemGates } from './manifest-validation.js';
import { hashRecipe, recipeSlotBcs, recipeValue } from './recipe-hash.js';
import {
  ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
  ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES,
  resolveCallablePackageId,
  resolveOriginalPackageId,
} from './runtime-config.js';
import { publishedMakerFromIntentEvent } from './chain-publication-recovery.js';
import { waitForCertifiedWalrusBlobObject } from './walrus-certification.js';
import { parseCommerceV5Event } from './chain-commerce-v5.js';
import { parseMakerSealPolicyCreatedEventV5 } from './maker-seal-v5.js';

export { hashRecipe } from './recipe-hash.js';
export { publishedMakerFromIntentEvent } from './chain-publication-recovery.js';
export * from './chain-commerce-v5.js';

const CLOCK_OBJECT_ID = '0x6';

let dAppKit;
let runtimeConfig;
let walletModal;
let walletModalLocale = 'en';
let walletModalObserver;
let connectionUnsubscribe;
let walrusClient;
let WalrusFileClass;
let suiClient;
let graphqlClient;

const walrusSessionOperations = new WeakSet();
const walCoinTypeByStakingPackage = new Map();
const WalrusCertificateBcs = bcs.struct('AnimacraftWalrusCertificate', {
  signers: bcs.vector(bcs.u16()),
  serializedMessage: bcs.byteVector(),
  signature: bcs.byteVector(),
});
const WalrusQuiltPatchIdBcs = bcs.struct('AnimacraftWalrusQuiltPatchId', {
  quiltId: bcs.u256(),
  patchId: bcs.struct('AnimacraftWalrusInternalQuiltPatchId', {
    version: bcs.u8(),
    startIndex: bcs.u16(),
    endIndex: bcs.u16(),
  }),
});

const walletModalI18n = Object.freeze({
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

function walletStatusKey(title) {
  if (Object.values(walletModalI18n).some((copy) => copy.awaiting === title)) return 'awaiting';
  if (Object.values(walletModalI18n).some((copy) => copy.requestCanceled === title)) return 'requestCanceled';
  if (Object.values(walletModalI18n).some((copy) => copy.failed === title)) return 'failed';
  return '';
}

function translateWalletModal() {
  const root = walletModal?.shadowRoot;
  if (!root) return;
  const copy = walletModalI18n[walletModalLocale] || walletModalI18n.en;
  const wallets = dAppKit?.stores?.$wallets?.get?.() || [];
  const title = root.querySelector('.title');
  const titleCopy = wallets.length ? copy.connect : copy.noneInstalled;
  if (title && title.textContent !== titleCopy) title.textContent = titleCopy;

  const back = root.querySelector('.back-button');
  if (back?.getAttribute('aria-label') !== copy.back) back?.setAttribute('aria-label', copy.back);
  const close = root.querySelector('.close-button');
  if (close?.getAttribute('aria-label') !== copy.close) close?.setAttribute('aria-label', copy.close);

  const status = root.querySelector('connection-status');
  if (!status) return;
  const key = walletStatusKey(status.title);
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
  if (action && action.textContent.trim() !== actionCopy) action.textContent = actionCopy;
}

export function setWalletModalLocale(locale) {
  walletModalLocale = Object.hasOwn(walletModalI18n, locale) ? locale : 'en';
  translateWalletModal();
}

function requireConfiguredPackageId(packageId, fieldName) {
  if (!packageId || packageId.includes('TODO')) {
    throw new Error(`The Animacraft Move package is not configured yet. Publish it and set ${fieldName} in config.js.`);
  }
  if (!/^0x[0-9a-f]+$/i.test(packageId)) {
    throw new Error(`The configured Animacraft ${fieldName} is not a valid Sui address.`);
  }
  return packageId;
}

function requireCallablePackageId() {
  return requireConfiguredPackageId(resolveCallablePackageId(runtimeConfig), 'callablePackageId');
}

function requireOriginalPackageId() {
  return requireConfiguredPackageId(resolveOriginalPackageId(runtimeConfig), 'originalPackageId');
}

function originalAnimacraftStructType(structName) {
  return normalizeStructTag(`${requireOriginalPackageId()}::animacraft::${structName}`);
}

export function isOriginalAnimacraftObjectType(type, structName, { generic = false } = {}) {
  let actual;
  try {
    actual = normalizeStructTag(String(type || ''));
  } catch {
    return false;
  }
  const expected = originalAnimacraftStructType(structName);
  return generic ? actual.startsWith(`${expected}<`) : actual === expected;
}

function findOriginalAnimacraftObjectId(objectTypes, structName, options) {
  return Object.entries(objectTypes || {})
    .find(([, type]) => isOriginalAnimacraftObjectType(type, structName, options))?.[0] || '';
}

function requirePaymentCoinType() {
  const coinType = String(runtimeConfig?.paymentCoinType || '').trim();
  if (!/^0x[0-9a-f]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i.test(coinType)) {
    throw new Error('Configure a valid Sui paymentCoinType before publishing or using a paid Maker.');
  }
  return coinType;
}

function requireConnection() {
  const connection = dAppKit?.stores.$connection.get();
  if (!connection?.account?.address) {
    throw new Error('Connect a Sui wallet before signing an on-chain action.');
  }
  return connection;
}

/**
 * Returns the initialized read-only Sui client. App code must use this getter
 * instead of constructing a second client with potentially different runtime
 * network configuration.
 */
export function getSuiClient() {
  if (!suiClient) throw new Error('The Sui client runtime has not initialized.');
  return suiClient;
}

export function getConnectedWalletAddress() {
  return requireConnection().account.address;
}

export async function signConnectedWalletPersonalMessage(message, {
  expectedWallet = '',
} = {}) {
  const bytes = message instanceof Uint8Array
    ? message
    : ArrayBuffer.isView(message)
      ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
      : message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : null;
  if (!(bytes instanceof Uint8Array) || !bytes.length) {
    throw new TypeError('A non-empty personal-message byte array is required.');
  }
  const connection = requireConnection();
  const connectedWallet = normalizeSuiAddress(connection.account.address);
  if (
    expectedWallet
    && normalizeSuiAddress(expectedWallet) !== connectedWallet
  ) {
    const error = new Error(
      'The connected wallet changed before the personal message could be signed.',
    );
    error.code = 'WALLET_CONTEXT_CHANGED';
    throw error;
  }
  return dAppKit.signPersonalMessage({ message: bytes });
}

/**
 * Signs through the currently connected wallet, then waits for the submitted
 * digest to be indexed. A pre-set transaction sender is checked before the
 * wallet sees the request so a cached quote can never be signed by another
 * account after a wallet switch.
 */
export async function signExecuteAndWait(transaction, {
  expectedWallet = '',
  timeout = 60_000,
  include = { effects: true, objectTypes: true, events: true },
} = {}) {
  if (!(transaction instanceof Transaction)) {
    throw new TypeError('A Sui Transaction is required.');
  }
  const connection = requireConnection();
  const connectedWallet = normalizeSuiAddress(connection.account.address);
  if (expectedWallet && normalizeSuiAddress(expectedWallet) !== connectedWallet) {
    const error = new Error('The connected wallet changed before the transaction could be signed.');
    error.code = 'WALLET_CONTEXT_CHANGED';
    throw error;
  }
  const transactionSender = transaction.getData().sender;
  if (transactionSender && normalizeSuiAddress(transactionSender) !== connectedWallet) {
    const error = new Error('The transaction sender does not match the connected wallet.');
    error.code = 'TRANSACTION_SENDER_MISMATCH';
    throw error;
  }
  if (!transactionSender) transaction.setSender(connectedWallet);
  const submitted = unwrapTransaction(
    await dAppKit.signAndExecuteTransaction({ transaction }),
  );
  if (!submitted?.digest) {
    throw new Error('The wallet did not return a Sui transaction digest.');
  }
  const indexed = unwrapTransaction(await getSuiClient().waitForTransaction({
    digest: submitted.digest,
    timeout,
    include,
  }));
  return Object.freeze({
    ...submitted,
    digest: submitted.digest,
    indexed,
  });
}

function moveTarget(functionName) {
  return `${requireCallablePackageId()}::animacraft::${functionName}`;
}

function unwrapTransaction(result) {
  if (result?.FailedTransaction) {
    throw new Error(result.FailedTransaction.status?.error?.message || 'The Sui transaction failed.');
  }
  if (!result?.Transaction?.digest) {
    throw new Error('The wallet did not return a Sui transaction digest.');
  }
  return result.Transaction;
}

function licenseKind(value) {
  return {
    'personal-use': 0,
    'free-remix': 1,
    'paid-commercial': 2,
    'exclusive-commission': 3,
  }[value] ?? 0;
}

function partKind(value) {
  return {
    standard: 0,
    'left-right-pair': 1,
    'last-bastion': 2,
  }[value] ?? 0;
}

function pureString(tx, value) {
  return tx.pure.string(String(value || ''));
}

export function initializeChain(config, onConnectionChange) {
  runtimeConfig = config;
  suiClient = new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl || config.rpcUrl });
  dAppKit = createDAppKit({
    networks: [config.network],
    defaultNetwork: config.network,
    autoConnect: true,
    createClient: () => suiClient,
  });

  walletModal = document.createElement('mysten-dapp-kit-connect-modal');
  walletModal.id = 'suiWalletModal';
  walletModal.instance = dAppKit;
  document.body.appendChild(walletModal);
  void walletModal.updateComplete?.then(() => {
    translateWalletModal();
    walletModalObserver?.disconnect();
    walletModalObserver = new MutationObserver(translateWalletModal);
    if (walletModal.shadowRoot) {
      walletModalObserver.observe(walletModal.shadowRoot, { childList: true, subtree: true });
    }
  });

  connectionUnsubscribe = dAppKit.stores.$connection.subscribe((connection) => {
    onConnectionChange({
      connected: Boolean(connection.account?.address),
      address: connection.account?.address || '',
      provider: connection.wallet?.name || '',
      status: connection.status,
    });
  });

  return () => {
    connectionUnsubscribe?.();
    walletModalObserver?.disconnect();
    walletModalObserver = undefined;
    walletModal?.remove();
  };
}

export async function openWalletSelector() {
  if (!dAppKit) throw new Error('The Sui wallet runtime has not initialized.');
  if (dAppKit.stores.$connection.get()?.account) {
    await dAppKit.disconnectWallet();
    return;
  }
  await walletModal.show();
}

export async function listOwnedMakers(owner) {
  const packageId = requireOriginalPackageId();
  const address = owner || requireConnection().account.address;
  const objects = [];
  let cursor = null;
  do {
    const page = await suiClient.listOwnedObjects({
      owner: address,
      type: `${packageId}::animacraft::OCMaker`,
      cursor,
      limit: 50,
      include: { json: true, display: true, previousTransaction: true },
    });
    objects.push(...page.objects);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && objects.length < 500);
  return objects;
}

export async function listOwnedMakerAdminCaps(owner) {
  const packageId = requireOriginalPackageId();
  const address = owner || requireConnection().account.address;
  const objects = [];
  let cursor = null;
  do {
    const page = await suiClient.listOwnedObjects({
      owner: address,
      type: `${packageId}::animacraft::MakerAdminCap`,
      cursor,
      limit: 50,
      include: { json: true, previousTransaction: true },
    });
    objects.push(...page.objects);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && objects.length < 500);
  return objects;
}

export async function listOwnedCreatorProfiles(owner) {
  const packageId = requireOriginalPackageId();
  const address = owner || requireConnection().account.address;
  const objects = [];
  let cursor = null;
  do {
    const page = await suiClient.listOwnedObjects({
      owner: address,
      type: `${packageId}::animacraft::CreatorProfile`,
      cursor,
      limit: 50,
      include: { json: true, display: true, previousTransaction: true },
    });
    objects.push(...page.objects);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && objects.length < 100);
  return objects;
}

export async function getMakerObjects(objectIds, { expectedStructName = '', generic = false } = {}) {
  requireOriginalPackageId();
  const ids = [...new Set((objectIds || []).map(jsonSuiId).filter(Boolean))];
  if (!ids.length) return [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 50) batches.push(ids.slice(index, index + 50));
  const responses = await Promise.all(batches.map((objectIdsBatch) => suiClient.getObjects({
    objectIds: objectIdsBatch,
    include: { json: true, display: true, previousTransaction: true },
  })));
  return responses
    .flatMap((response) => response.objects)
    .filter((object) => object
      && !('error' in object)
      && (!expectedStructName || isOriginalAnimacraftObjectType(object.type, expectedStructName, { generic })));
}

function jsonSuiId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      try {
        return jsonSuiId(JSON.parse(trimmed));
      } catch {
        return '';
      }
    }
    return /^0x[0-9a-f]+$/i.test(trimmed) ? trimmed : '';
  }
  if (!value || typeof value !== 'object') return '';
  return jsonSuiId(value.id || value.bytes || value.address || value.fields);
}

async function getGraphqlClient() {
  if (!graphqlClient) {
    const { SuiGraphQLClient } = await import('@mysten/sui/graphql');
    graphqlClient = new SuiGraphQLClient({
      network: runtimeConfig.network,
      url: runtimeConfig.graphqlUrl || `https://graphql.${runtimeConfig.network}.sui.io/graphql`,
    });
  }
  return graphqlClient;
}

export async function findCommerceV5MigrationByLegacyMaker(
  legacyMakerId,
  limit = 500,
) {
  const typeOrigin = requireConfiguredPackageId(
    runtimeConfig?.commerceV5TypeOriginPackageId,
    'commerceV5TypeOriginPackageId',
  );
  const expectedMakerId = normalizeSuiAddress(legacyMakerId);
  const client = await getGraphqlClient();
  const eventType = `${typeOrigin}::commerce_v5::LegacyMakerMigratedToV5`;
  let before = null;
  let inspected = 0;
  do {
    const pageSize = Math.min(50, limit - inspected);
    const result = await client.query({
      query: `
        query AnimacraftCommerceV5Migrations($type: String!, $last: Int!, $before: String) {
          events(filter: { type: $type }, last: $last, before: $before) {
            pageInfo { hasPreviousPage startCursor }
            nodes {
              transaction { digest }
              contents { type { repr } json }
            }
          }
        }
      `,
      variables: { type: eventType, last: pageSize, before },
    });
    if (result.errors?.length) {
      throw new Error(result.errors[0].message || 'Commerce v5 migration discovery failed.');
    }
    const connection = result.data?.events;
    for (const event of connection?.nodes || []) {
      const parsed = parseCommerceV5Event(event);
      if (parsed?.legacyMakerId === expectedMakerId) return parsed;
    }
    inspected += (connection?.nodes || []).length;
    before = connection?.pageInfo?.hasPreviousPage
      ? connection.pageInfo.startCursor
      : null;
  } while (before && inspected < limit);
  return null;
}

export async function findMakerSealPolicyByReleaseV5({
  rootId,
  releaseCommitment,
  limit = 500,
} = {}) {
  const typeOrigin = requireConfiguredPackageId(
    runtimeConfig?.commerceV5TypeOriginPackageId,
    'commerceV5TypeOriginPackageId',
  );
  const expectedRootId = normalizeSuiAddress(rootId);
  const expectedCommitment = String(releaseCommitment || '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(expectedCommitment)) {
    throw new Error('Seal release commitment must be an exact 32-byte hex value.');
  }
  const client = await getGraphqlClient();
  const eventType =
    `${typeOrigin}::seal_v5::MakerSealPolicyCreatedV5`;
  let before = null;
  let inspected = 0;
  const matches = new Map();
  do {
    const pageSize = Math.min(50, limit - inspected);
    const result = await client.query({
      query: `
        query AnimacraftMakerSealPolicies($type: String!, $last: Int!, $before: String) {
          events(filter: { type: $type }, last: $last, before: $before) {
            pageInfo { hasPreviousPage startCursor }
            nodes {
              transaction { digest }
              contents { type { repr } json }
            }
          }
        }
      `,
      variables: { type: eventType, last: pageSize, before },
    });
    if (result.errors?.length) {
      throw new Error(
        result.errors[0].message || 'Seal policy discovery failed.',
      );
    }
    const connection = result.data?.events;
    for (const event of connection?.nodes || []) {
      const parsed = parseMakerSealPolicyCreatedEventV5(event);
      if (
        parsed
        && parsed.rootId === expectedRootId
        && parsed.releaseCommitment.toLowerCase() === expectedCommitment
      ) {
        matches.set(parsed.policyId, parsed);
      }
    }
    inspected += (connection?.nodes || []).length;
    before = connection?.pageInfo?.hasPreviousPage
      ? connection.pageInfo.startCursor
      : null;
  } while (before && inspected < limit);
  if (matches.size > 1) {
    const error = new Error(
      'More than one Seal policy claims this immutable Maker release.',
    );
    error.code = 'MAKER_SEAL_V5_POLICY_AMBIGUOUS';
    error.policyIds = [...matches.keys()];
    throw error;
  }
  return matches.values().next().value || null;
}

export async function listPublishedMakerIds(limit = 500) {
  const packageId = requireOriginalPackageId();
  const client = await getGraphqlClient();
  const eventType = `${packageId}::animacraft::OCMakerPublished`;
  const ids = [];
  let before = null;
  do {
    const result = await client.query({
      query: `
        query PublishedAnimacraftMakers($type: String!, $last: Int!, $before: String) {
          events(filter: { type: $type }, last: $last, before: $before) {
            pageInfo { hasPreviousPage startCursor }
            nodes { contents { json } }
          }
        }
      `,
      // Sui Mainnet GraphQL currently rejects event pages larger than 50.
      variables: { type: eventType, last: Math.min(50, limit - ids.length), before },
    });
    if (result.errors?.length) throw new Error(result.errors[0].message || 'Sui GraphQL event discovery failed.');
    const connection = result.data?.events;
    (connection?.nodes || []).forEach((event) => {
      const makerId = jsonSuiId(event.contents?.json?.maker_id || event.contents?.json?.makerId);
      if (makerId) ids.push(makerId);
    });
    before = connection?.pageInfo?.hasPreviousPage ? connection.pageInfo.startCursor : null;
  } while (before && ids.length < limit);
  return [...new Set(ids)];
}

/**
 * Recover an already-submitted publication after a tab closes between wallet
 * signing and the local digest checkpoint. Creator + certified Manifest Quilt
 * id is the immutable publication intent identity.
 */
export async function findPublishedMakerByIntent({ creator, manifestBlobId, limit = 500 } = {}) {
  const packageId = requireOriginalPackageId();
  if (!creator || !manifestBlobId) return null;
  const client = await getGraphqlClient();
  const eventType = `${packageId}::animacraft::OCMakerPublished`;
  let scanned = 0;
  let before = null;
  do {
    const pageSize = Math.min(50, Math.max(1, Number(limit) - scanned));
    const result = await client.query({
      query: `
        query RecoverAnimacraftMaker($type: String!, $last: Int!, $before: String) {
          events(filter: { type: $type }, last: $last, before: $before) {
            pageInfo { hasPreviousPage startCursor }
            nodes {
              transaction { digest }
              contents { json }
            }
          }
        }
      `,
      variables: { type: eventType, last: pageSize, before },
    });
    if (result.errors?.length) {
      throw new Error(result.errors[0].message || 'Sui GraphQL publication recovery failed.');
    }
    const connection = result.data?.events;
    const nodes = connection?.nodes || [];
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const match = publishedMakerFromIntentEvent(nodes[index], { creator, manifestBlobId });
      if (match) return match;
    }
    scanned += nodes.length;
    before = connection?.pageInfo?.hasPreviousPage ? connection.pageInfo.startCursor : null;
  } while (before && scanned < Number(limit));
  return null;
}

function nonNegativeIntegerBigInt(value, label) {
  let amount;
  try {
    amount = BigInt(String(value));
  } catch {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  if (amount < 0n) throw new TypeError(`${label} must be a non-negative integer.`);
  return amount;
}

function walrusRelayTipCapMistBigInt() {
  return nonNegativeIntegerBigInt(
    runtimeConfig.walrusRelayMaxTipMist
      ?? ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
    'The Walrus relay tip policy cap',
  );
}

function safeRelayTipNumber(amount, label) {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw walrusStateError(
      'TIP_TOO_HIGH',
      `${label} exceeds JavaScript's exact integer range and cannot be approved safely.`,
    );
  }
  return Number(amount);
}

function walrusRelayTipCapMist() {
  return safeRelayTipNumber(
    walrusRelayTipCapMistBigInt(),
    'The Walrus relay tip policy cap',
  );
}

function assertWalrusRelayTipWithinPolicy(relayTipMist) {
  const tip = nonNegativeIntegerBigInt(relayTipMist, 'The Walrus relay tip');
  const cap = walrusRelayTipCapMistBigInt();
  if (tip > cap) {
    throw walrusStateError(
      'TIP_TOO_HIGH',
      `The live Walrus relay tip (${tip} MIST) exceeds Animacraft's policy cap (${cap} MIST).`,
    );
  }
  return safeRelayTipNumber(tip, 'The Walrus relay tip');
}

function walrusStorageEpochs() {
  const configuredEpochs = Number(runtimeConfig.walrusEpochs ?? 53);
  return Number.isInteger(configuredEpochs)
    ? Math.min(53, Math.max(1, configuredEpochs))
    : 53;
}

async function createWalrusRuntime(maxRelayTipMist = walrusRelayTipCapMist()) {
  if (!runtimeConfig?.walrusUploadRelayUrl) throw new Error('Configure the Walrus Mainnet upload relay first.');
  const { WalrusFile, walrus } = await import('@mysten/walrus');
  WalrusFileClass = WalrusFile;
  return new SuiGrpcClient({
    network: runtimeConfig.network,
    baseUrl: runtimeConfig.grpcUrl || runtimeConfig.rpcUrl,
  }).$extend(walrus({
    wasmUrl: walrusWasmUrl,
    uploadRelay: {
      host: runtimeConfig.walrusUploadRelayUrl,
      // `max` is a hard client-side ceiling. Registration creates a fresh
      // client with the exact user-confirmed quote as this value.
      sendTip: { max: Number(maxRelayTipMist) },
    },
  }));
}

async function ensureWalrusRuntime() {
  if (!walrusClient) walrusClient = await createWalrusRuntime();
}

function walrusStateError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

async function checkpointWalrusSession(session, onCheckpoint) {
  if (typeof onCheckpoint === 'function') await onCheckpoint(session);
}

async function withWalrusSessionOperation(session, operation, callback) {
  if (!session || typeof session !== 'object') throw new Error('The Walrus upload session is missing.');
  if (walrusSessionOperations.has(session)) {
    throw walrusStateError(
      'WALRUS_OPERATION_IN_PROGRESS',
      `A Walrus ${operation} operation is already running for this upload.`,
    );
  }
  walrusSessionOperations.add(session);
  try {
    return await callback();
  } finally {
    walrusSessionOperations.delete(session);
  }
}

function applyWalrusQuote(session, quote) {
  session.relayTipMist = Number(quote.relayTipMist);
  session.relayTipQuotedAt = String(quote.relayTipQuotedAt);
  session.walrusStorageCostFrost = String(quote.walrusStorageCostFrost);
  session.walrusWriteCostFrost = String(quote.walrusWriteCostFrost);
  session.walrusTotalCostFrost = String(quote.walrusTotalCostFrost);
}

async function calculateWalrusQuote(client, unencodedSize) {
  const [relayTipMist, costs] = await Promise.all([
    client.walrus.calculateUploadRelayTip({ size: unencodedSize }),
    client.walrus.storageCost(unencodedSize, walrusStorageEpochs()),
  ]);
  assertWalrusRelayTipWithinPolicy(relayTipMist);
  return walrusQuoteFromCosts(relayTipMist, costs);
}

async function walCoinTypeForClient(client) {
  const blobType = normalizeStructTag(await client.walrus.getBlobType());
  const stakingPackageId = blobType.split('::')[0];
  let pending = walCoinTypeByStakingPackage.get(stakingPackageId);
  if (!pending) {
    pending = (async () => {
      const stakeWithPool = await client.core.getMoveFunction({
        packageId: stakingPackageId,
        moduleName: 'staking',
        name: 'stake_with_pool',
      });
      const toStake = stakeWithPool.function?.parameters?.[1];
      const toStakeCoin = toStake?.body?.$kind === 'datatype'
        ? toStake.body.datatype
        : null;
      const toStakeCoinType = toStakeCoin?.typeParameters?.[0]?.$kind === 'datatype'
        ? toStakeCoin.typeParameters[0]
        : null;
      if (toStakeCoinType?.$kind !== 'datatype') {
        throw new Error('Could not discover the WAL coin type from staking::stake_with_pool.');
      }
      return normalizeStructTag(toStakeCoinType.datatype.typeName);
    })();
    walCoinTypeByStakingPackage.set(stakingPackageId, pending);
  }
  try {
    return await pending;
  } catch (error) {
    if (walCoinTypeByStakingPackage.get(stakingPackageId) === pending) {
      walCoinTypeByStakingPackage.delete(stakingPackageId);
    }
    throw error;
  }
}

async function walrusWalletBalances(owner, client = walrusClient) {
  const walCoinType = await walCoinTypeForClient(client);
  const balances = [];
  let cursor = null;
  do {
    const page = await suiClient.listBalances({
      owner,
      cursor,
      limit: 200,
    });
    balances.push(...(page.balances || []));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && balances.length < 1_000);
  const suiCoinType = normalizeStructTag('0x2::sui::SUI');
  const sui = balances.find((balance) => normalizeStructTag(balance.coinType) === suiCoinType);
  const wal = balances.find((balance) => normalizeStructTag(balance.coinType) === walCoinType);
  return {
    walletSuiBalanceMist: String(sui?.balance || '0'),
    walletWalBalanceFrost: String(wal?.balance || '0'),
  };
}

function applyWalrusWalletBalances(session, balances) {
  session.walletSuiBalanceMist = String(balances.walletSuiBalanceMist);
  session.walletWalBalanceFrost = String(balances.walletWalBalanceFrost);
}

function assertWalrusWalletBalances(session) {
  if (BigInt(session.walletWalBalanceFrost || 0) < BigInt(session.walrusTotalCostFrost || 0)) {
    throw walrusStateError(
      'INSUFFICIENT_WAL_BALANCE',
      `The connected wallet has ${session.walletWalBalanceFrost || 0} FROST but this upload requires ${session.walrusTotalCostFrost || 0} FROST before gas.`,
    );
  }
  if (BigInt(session.walletSuiBalanceMist || 0) < BigInt(session.relayTipMist || 0)) {
    throw walrusStateError(
      'INSUFFICIENT_SUI_BALANCE',
      `The connected wallet has ${session.walletSuiBalanceMist || 0} MIST but the relay tip requires ${session.relayTipMist || 0} MIST before gas.`,
    );
  }
}

function walrusQuoteFromCosts(relayTipMist, costs) {
  // Validate before Number conversion; relay values are policy/security data.
  assertWalrusRelayTipWithinPolicy(relayTipMist);
  return {
    relayTipMist: Number(relayTipMist),
    relayTipQuotedAt: new Date().toISOString(),
    walrusStorageCostFrost: String(costs.storageCost),
    walrusWriteCostFrost: String(costs.writeCost),
    walrusTotalCostFrost: String(costs.totalCost),
  };
}

function walrusQuoteAmountsChanged(session, quote) {
  return Number(session.relayTipMist) !== Number(quote.relayTipMist)
    || String(session.walrusStorageCostFrost ?? '') !== String(quote.walrusStorageCostFrost)
    || String(session.walrusWriteCostFrost ?? '') !== String(quote.walrusWriteCostFrost)
    || String(session.walrusTotalCostFrost ?? '') !== String(quote.walrusTotalCostFrost);
}

async function refreshedRegistrationFlow(session, onCheckpoint) {
  // This client is intentionally new: relay tip configuration and Walrus
  // system prices must not come from the long-lived runtime cache.
  const quoteClient = await createWalrusRuntime(walrusRelayTipCapMist());
  const [quote, balances] = await Promise.all([
    calculateWalrusQuote(quoteClient, session.encoded.unencodedSize),
    walrusWalletBalances(session.owner, quoteClient),
  ]);
  applyWalrusWalletBalances(session, balances);
  if (walrusQuoteAmountsChanged(session, quote)) {
    applyWalrusQuote(session, quote);
    await checkpointWalrusSession(session, onCheckpoint);
    throw walrusStateError(
      'UPLOAD_QUOTE_CHANGED',
      'The live Walrus upload quote changed. Review and confirm the new relay tip and WAL cost before signing.',
    );
  }

  // Build the transaction with another fresh client whose hard maximum is
  // exactly the quote the user approved, rather than the application's cap.
  // Compare as BigInt before creating the exact-quote client so an oversized
  // or precision-losing relay value can never become an SDK willingness cap.
  const exactRelayTipMist = assertWalrusRelayTipWithinPolicy(quote.relayTipMist);
  const exactQuoteClient = await createWalrusRuntime(exactRelayTipMist);
  const exactQuote = await calculateWalrusQuote(exactQuoteClient, session.encoded.unencodedSize);
  if (walrusQuoteAmountsChanged(session, exactQuote)) {
    applyWalrusQuote(session, exactQuote);
    await checkpointWalrusSession(session, onCheckpoint);
    throw walrusStateError(
      'UPLOAD_QUOTE_CHANGED',
      'The live Walrus upload quote changed while preparing the transaction. Review and confirm it again.',
    );
  }
  session.relayTipQuotedAt = exactQuote.relayTipQuotedAt;
  await checkpointWalrusSession(session, onCheckpoint);
  assertWalrusWalletBalances(session);

  const flow = exactQuoteClient.walrus.writeFilesFlow({
    files: session.walrusFiles,
    resume: session.encoded,
  });
  const encoded = await flow.encode();
  if (encoded.blobId !== session.quiltBlobId) {
    throw new Error('The Walrus quilt changed while refreshing its upload quote.');
  }
  session.flow = flow;
  session.walrusClient = exactQuoteClient;
  return flow;
}

function normalizedSignedTransaction(signed) {
  const bytes = typeof signed?.bytes === 'string' ? signed.bytes : toBase64(signed?.bytes || new Uint8Array());
  const signature = String(signed?.signature || '');
  if (!bytes || !signature) throw new Error('The wallet did not return serializable signed transaction bytes.');
  return {
    bytes,
    signature,
    digest: TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes)),
    signedAt: new Date().toISOString(),
  };
}

function transactionNotFound(error) {
  return /transaction .* not found|not found.*transaction|could not find.*transaction/i.test(String(error?.message || error || ''));
}

async function querySignedTransaction(digest) {
  try {
    return {
      found: true,
      result: await suiClient.getTransaction({
        digest,
        include: { effects: true, objectTypes: true },
      }),
    };
  } catch (error) {
    if (transactionNotFound(error)) return { found: false, result: null };
    throw walrusStateError(
      'TRANSACTION_OUTCOME_PENDING',
      `Could not verify Sui transaction ${digest}. Its signed bytes were kept for a safe retry.`,
      error,
    );
  }
}

async function settlePendingTransaction(
  session,
  {
    pendingKey,
    digestKey,
    successStage,
    failureStage,
    result,
    onCheckpoint,
  },
) {
  const pending = session[pendingKey];
  if (result?.FailedTransaction) {
    session[pendingKey] = null;
    session[digestKey] = '';
    session.stage = failureStage;
    await checkpointWalrusSession(session, onCheckpoint);
    throw walrusStateError(
      'WALRUS_TRANSACTION_FAILED',
      result.FailedTransaction.status?.error?.message
        || `Walrus transaction ${pending?.digest || ''} failed on Sui.`,
    );
  }
  const transaction = unwrapTransaction(result);
  if (transaction.digest !== pending?.digest) {
    throw walrusStateError(
      'WALRUS_TRANSACTION_DIGEST_MISMATCH',
      'Sui returned a different transaction digest than the signed Walrus transaction.',
    );
  }

  session[digestKey] = transaction.digest;
  session.stage = successStage;
  pending.confirmedAt = new Date().toISOString();
  await checkpointWalrusSession(session, onCheckpoint);

  // Persist the confirmed digest before removing the replay material. If this
  // second checkpoint fails, restore pending in memory; the durable copy with
  // pending bytes remains safe and will only query/replay the same digest.
  session[pendingKey] = null;
  try {
    await checkpointWalrusSession(session, onCheckpoint);
  } catch (error) {
    session[pendingKey] = pending;
    throw error;
  }
  return transaction;
}

async function executePendingTransaction(
  session,
  {
    pendingKey,
    digestKey,
    successStage,
    failureStage,
    onCheckpoint,
  },
) {
  const pending = session[pendingKey];
  if (!pending?.digest || !pending.bytes || !pending.signature) {
    throw new Error('The saved signed Walrus transaction is incomplete.');
  }

  if (pending.lastBroadcastAt) {
    const status = await querySignedTransaction(pending.digest);
    if (status.found) {
      return settlePendingTransaction(session, {
        pendingKey,
        digestKey,
        successStage,
        failureStage,
        result: status.result,
        onCheckpoint,
      });
    }
  }

  pending.lastBroadcastAt = new Date().toISOString();
  pending.broadcastAttempts = Number(pending.broadcastAttempts || 0) + 1;
  await checkpointWalrusSession(session, onCheckpoint);
  try {
    const result = await suiClient.executeTransaction({
      transaction: fromBase64(pending.bytes),
      signatures: [pending.signature],
      include: { effects: true, objectTypes: true },
    });
    return await settlePendingTransaction(session, {
      pendingKey,
      digestKey,
      successStage,
      failureStage,
      result,
      onCheckpoint,
    });
  } catch (broadcastError) {
    let status;
    try {
      status = await querySignedTransaction(pending.digest);
    } catch (queryError) {
      throw queryError;
    }
    if (status.found) {
      return settlePendingTransaction(session, {
        pendingKey,
        digestKey,
        successStage,
        failureStage,
        result: status.result,
        onCheckpoint,
      });
    }
    throw walrusStateError(
      'TRANSACTION_OUTCOME_PENDING',
      `Sui did not confirm transaction ${pending.digest}. Retry will query or replay these exact signed bytes; it will not request a new signature.`,
      broadcastError,
    );
  }
}

async function signWalrusTransaction(session, pendingKey, transaction, onCheckpoint) {
  await checkpointWalrusSession(session, onCheckpoint);
  const signed = normalizedSignedTransaction(await dAppKit.signTransaction({ transaction }));
  session[pendingKey] = signed;
  await checkpointWalrusSession(session, onCheckpoint);
  return signed;
}

function parseWalrusCertificate(base64) {
  const certificate = WalrusCertificateBcs.fromBase64(base64);
  return {
    signers: certificate.signers,
    serializedMessage: new Uint8Array(certificate.serializedMessage),
    signature: new Uint8Array(certificate.signature),
  };
}

function fromUrlSafeBase64(value) {
  const standard = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  return fromBase64(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
}

function toUrlSafeBase64(bytes) {
  return toBase64(bytes).replace(/=*$/, '').replaceAll('+', '-').replaceAll('/', '_');
}

function encodeWalrusQuiltPatchId(blobId, patch) {
  const quiltId = bcs.u256().parse(fromUrlSafeBase64(blobId));
  return toUrlSafeBase64(WalrusQuiltPatchIdBcs.serialize({
    quiltId,
    patchId: {
      version: 1,
      startIndex: patch.startIndex,
      endIndex: patch.endIndex,
    },
  }).toBytes());
}

async function listQuiltFilesFromCheckpoint(session, { blobObject = null } = {}) {
  if (!blobObject && Array.isArray(session.files) && session.files.length > 0) return session.files;
  const blobObjectId = session.checkpoint?.blobObjectId;
  if (!blobObjectId) throw new Error('The Walrus upload checkpoint is missing its Blob object id.');
  const client = session.walrusClient || walrusClient;
  const blobs = await Promise.all(session.walrusFiles.map(async (file, index) => ({
    contents: await file.bytes(),
    identifier: await file.getIdentifier() ?? `file-${index}`,
    tags: await file.getTags() ?? {},
  })));
  const [{ index }, resolvedBlobObject] = await Promise.all([
    client.walrus.encodeQuilt({ blobs }),
    blobObject || client.walrus.getBlobObject(blobObjectId),
  ]);
  session.files = index.patches.map((patch) => ({
    id: encodeWalrusQuiltPatchId(session.quiltBlobId, patch),
    blobId: session.quiltBlobId,
    blobObject: resolvedBlobObject,
  }));
  return session.files;
}

async function walrusFiles(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Choose at least one file to store on Walrus.');
  if (entries.length > 5_000) throw new Error('A single Walrus quilt cannot contain more than 5,000 Animacraft files.');
  const identifiers = entries.map((entry) => entry.identifier);
  if (entries.some((entry) => !(entry.blob instanceof Blob))) throw new Error('Every Walrus entry must contain a readable browser Blob.');
  if (identifiers.some((identifier) => !identifier || new TextEncoder().encode(String(identifier)).length > 512)) {
    throw new Error('Every Walrus quilt identifier must contain 1 to 512 UTF-8 bytes.');
  }
  if (new Set(identifiers).size !== identifiers.length) throw new Error('Every Walrus quilt file must have a unique identifier.');
  const totalBytes = entries.reduce((total, entry) => total + Number(entry.blob?.size || 0), 0);
  if (totalBytes > ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES) throw new Error('A single Animacraft upload cannot exceed 500 MB. Split this Maker into a smaller release.');

  return Promise.all(entries.map(async (entry) => WalrusFileClass.from({
    contents: new Uint8Array(await entry.blob.arrayBuffer()),
    identifier: entry.identifier,
    tags: {
      'content-type': entry.blob.type || 'application/octet-stream',
      'animacraft-kind': entry.kind || 'asset',
    },
  })));
}

function createUploadSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const entropy = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(entropy);
  const suffix = Array.from(entropy, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `upload-${Date.now().toString(36)}-${suffix || Math.random().toString(36).slice(2)}`;
}

function legacyUploadSessionId(recovery) {
  const owner = String(recovery?.owner || 'unknown-owner').trim().toLowerCase();
  const blobId = String(
    recovery?.quiltBlobId
      || recovery?.checkpoint?.blobId
      || recovery?.checkpoint?.blobObjectId
      || 'unknown-quilt',
  ).trim();
  return `legacy:${owner}:${blobId}`;
}

function recoveryRevision(recovery) {
  const revision = Number(recovery?.recoveryRevision ?? 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export async function prepareWalrusUpload(entries) {
  const connection = requireConnection();
  await ensureWalrusRuntime();
  const files = await walrusFiles(entries);
  const flow = walrusClient.walrus.writeFilesFlow({ files });
  const encoded = await flow.encode();
  const [relayTipMist, costs, balances] = await Promise.all([
    walrusClient.walrus.calculateUploadRelayTip({
      size: encoded.unencodedSize,
    }),
    walrusClient.walrus.storageCost(encoded.unencodedSize, walrusStorageEpochs()),
    walrusWalletBalances(connection.account.address, walrusClient),
  ]);
  const quote = walrusQuoteFromCosts(relayTipMist, costs);
  const session = {
    uploadSessionId: createUploadSessionId(),
    recoveryRevision: 0,
    flow,
    walrusClient,
    walrusFiles: files,
    entries,
    encoded,
    relayTipCapMist: walrusRelayTipCapMist(),
    checkpoint: encoded,
    quiltBlobId: encoded.blobId,
    owner: connection.account.address,
    stage: 'encoded',
    registerDigest: '',
    certifyDigest: '',
    uploaded: null,
    files: [],
    recoveringUploaded: false,
    pendingRegisterTransaction: null,
    pendingCertifyTransaction: null,
  };
  applyWalrusQuote(session, quote);
  applyWalrusWalletBalances(session, balances);
  return session;
}

export async function resumeWalrusUpload(entries, recovery) {
  const connection = requireConnection();
  if (!recovery?.checkpoint) throw new Error('The saved Walrus upload checkpoint is missing.');
  if (recovery.owner !== connection.account.address) throw new Error('Reconnect the wallet that started this Walrus upload.');
  await ensureWalrusRuntime();
  const files = await walrusFiles(entries);
  const flow = walrusClient.walrus.writeFilesFlow({ files, resume: recovery.checkpoint });
  const encoded = await flow.encode();
  if (recovery.quiltBlobId && encoded.blobId !== recovery.quiltBlobId) {
    throw new Error('The local Maker assets no longer match the saved Walrus upload. Prepare a new quilt.');
  }
  const session = {
    uploadSessionId: String(recovery.uploadSessionId || '').trim()
      || legacyUploadSessionId(recovery),
    recoveryRevision: recoveryRevision(recovery),
    flow,
    walrusClient,
    walrusFiles: files,
    entries,
    encoded,
    relayTipMist: recovery.relayTipMist == null ? null : Number(recovery.relayTipMist),
    relayTipQuotedAt: String(recovery.relayTipQuotedAt || ''),
    walrusStorageCostFrost: recovery.walrusStorageCostFrost == null ? '' : String(recovery.walrusStorageCostFrost),
    walrusWriteCostFrost: recovery.walrusWriteCostFrost == null ? '' : String(recovery.walrusWriteCostFrost),
    walrusTotalCostFrost: recovery.walrusTotalCostFrost == null ? '' : String(recovery.walrusTotalCostFrost),
    walletSuiBalanceMist: recovery.walletSuiBalanceMist == null ? '' : String(recovery.walletSuiBalanceMist),
    walletWalBalanceFrost: recovery.walletWalBalanceFrost == null ? '' : String(recovery.walletWalBalanceFrost),
    relayTipCapMist: walrusRelayTipCapMist(),
    quiltBlobId: encoded.blobId,
    owner: recovery.owner,
    stage: recovery.stage || recovery.checkpoint.step,
    registerDigest: recovery.registerDigest || recovery.checkpoint.txDigest || '',
    certifyDigest: recovery.certifyDigest || '',
    uploaded: recovery.checkpoint.step === 'uploaded' ? recovery.checkpoint : null,
    checkpoint: recovery.checkpoint,
    files: Array.isArray(recovery.files) ? recovery.files : [],
    recoveringUploaded: false,
    pendingRegisterTransaction: recovery.pendingRegisterTransaction || null,
    pendingCertifyTransaction: recovery.pendingCertifyTransaction || null,
  };
  // Only an encoded recovery needs a current quote. Paid, uploaded, certified,
  // and signed-pending recoveries must remain usable even if the relay changes
  // its current pricing or is temporarily unavailable.
  const needsInitialQuote = session.stage === 'encoded'
    && !session.pendingRegisterTransaction
    && session.relayTipMist == null;
  if (needsInitialQuote) {
    const [relayTipMist, costs, balances] = await Promise.all([
      walrusClient.walrus.calculateUploadRelayTip({
        size: encoded.unencodedSize,
      }),
      walrusClient.walrus.storageCost(encoded.unencodedSize, walrusStorageEpochs()),
      walrusWalletBalances(session.owner, walrusClient),
    ]);
    applyWalrusQuote(session, walrusQuoteFromCosts(relayTipMist, costs));
    applyWalrusWalletBalances(session, balances);
  }
  if (session.stage === 'certified') {
    const blobObject = await waitForCertifiedWalrusBlobObject(
      session.walrusClient || walrusClient,
      session.checkpoint?.blobObjectId,
      {
        certifyDigest: session.certifyDigest,
        expectedBlobId: session.quiltBlobId,
      },
    );
    await listQuiltFilesFromCheckpoint(session, { blobObject });
  }
  return session;
}

export async function registerAndUploadWalrus(session, { onCheckpoint = null } = {}) {
  return withWalrusSessionOperation(session, 'register/upload', async () => {
    const connection = requireConnection();
    if (!session?.flow || !['encoded', 'registered', 'uploaded', 'certified'].includes(session.stage)) {
      throw new Error('Prepare the Walrus quilt before registering it.');
    }
    if (session.owner !== connection.account.address) {
      throw new Error('Reconnect the wallet that prepared this Walrus upload.');
    }
    if (session.stage === 'certified') return session;
    if (session.stage === 'uploaded') {
      await checkpointWalrusSession(session, onCheckpoint);
      return session;
    }

    if (session.stage === 'encoded' || session.pendingRegisterTransaction) {
      if (session.stage === 'encoded' && !session.pendingRegisterTransaction) {
        const flow = await refreshedRegistrationFlow(session, onCheckpoint);
        const registerTx = flow.register({
          epochs: walrusStorageEpochs(),
          owner: connection.account.address,
          deletable: false,
        });
        await signWalrusTransaction(session, 'pendingRegisterTransaction', registerTx, onCheckpoint);
      }
      if (session.pendingRegisterTransaction) {
        await executePendingTransaction(session, {
          pendingKey: 'pendingRegisterTransaction',
          digestKey: 'registerDigest',
          successStage: 'registered',
          failureStage: 'encoded',
          onCheckpoint,
        });
      }
    }

    // The confirmed register digest is durable before the long relay request.
    await checkpointWalrusSession(session, onCheckpoint);
    session.uploaded = await session.flow.upload({ digest: session.registerDigest });
    session.checkpoint = {
      ...session.uploaded,
      ...(session.encoded.nonce ? { nonce: session.encoded.nonce } : {}),
    };
    session.stage = 'uploaded';
    await checkpointWalrusSession(session, onCheckpoint);

    // Patch IDs are reconstructed only after certification. Calling listFiles()
    // here would cache the pre-certification Blob object inside WalrusClient and
    // make a later getBlobObject() return certified_epoch: null indefinitely.
    session.files = [];
    session.recoveringUploaded = false;
    await checkpointWalrusSession(session, onCheckpoint);
    return session;
  });
}

export async function certifyWalrusUpload(session, { onCheckpoint = null } = {}) {
  return withWalrusSessionOperation(session, 'certify', async () => {
    const connection = requireConnection();
    if (!session?.flow || !['uploaded', 'certified'].includes(session.stage)) {
      throw new Error('Register and upload the Walrus quilt before certification.');
    }
    if (session.owner !== connection.account.address) {
      throw new Error('Reconnect the wallet that prepared this Walrus upload.');
    }
    if (session.stage === 'certified') return session;

    if (!session.pendingCertifyTransaction && session.certifyDigest) {
      const status = await querySignedTransaction(session.certifyDigest);
      if (!status.found) {
        throw walrusStateError(
          'TRANSACTION_OUTCOME_PENDING',
          `The saved Walrus certify transaction ${session.certifyDigest} is not visible yet. No replacement transaction was signed.`,
        );
      }
      if (status.result?.FailedTransaction) {
        session.certifyDigest = '';
        await checkpointWalrusSession(session, onCheckpoint);
        throw walrusStateError(
          'WALRUS_TRANSACTION_FAILED',
          status.result.FailedTransaction.status?.error?.message || 'The Walrus certification transaction failed.',
        );
      }
    } else {
      if (!session.pendingCertifyTransaction) {
        const certificate = session.checkpoint?.certificate;
        const blobObjectId = session.checkpoint?.blobObjectId;
        if (!certificate || !blobObjectId) {
          throw new Error('The uploaded Walrus checkpoint is missing its certificate or Blob object id.');
        }
        const certifyTx = (session.walrusClient || walrusClient).walrus.certifyBlobTransaction({
          blobId: session.quiltBlobId,
          blobObjectId,
          certificate: parseWalrusCertificate(certificate),
          deletable: false,
        });
        await signWalrusTransaction(session, 'pendingCertifyTransaction', certifyTx, onCheckpoint);
      }
      await executePendingTransaction(session, {
        pendingKey: 'pendingCertifyTransaction',
        digestKey: 'certifyDigest',
        successStage: 'uploaded',
        failureStage: 'uploaded',
        onCheckpoint,
      });
    }

    // Certification is already confirmed on Sui. WalrusClient may still hold a
    // pre-certification Blob object, so every read-only attempt clears its
    // object cache before querying again. This path never signs another tx.
    const blobObject = await waitForCertifiedWalrusBlobObject(
      session.walrusClient || walrusClient,
      session.checkpoint.blobObjectId,
      {
        certifyDigest: session.certifyDigest,
        expectedBlobId: session.quiltBlobId,
      },
    );
    session.files = await listQuiltFilesFromCheckpoint(session, { blobObject });
    session.checkpoint = {
      step: 'certified',
      blobId: session.quiltBlobId,
      blobObjectId: blobObject.id,
      blobObject,
      ...(session.encoded.nonce ? { nonce: session.encoded.nonce } : {}),
    };
    session.stage = 'certified';
    await checkpointWalrusSession(session, onCheckpoint);
    return session;
  });
}

export function walrusFileUrl(quiltPatchId) {
  if (!quiltPatchId) return '';
  return `${runtimeConfig.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-patch-id/${quiltPatchId}`;
}

export function walrusQuiltFileUrl(quiltId, identifier) {
  if (!quiltId || !identifier) return '';
  return `${runtimeConfig.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-id/${encodeURIComponent(quiltId)}/${encodeURIComponent(identifier)}`;
}

export async function publishMaker({
  creator,
  maker,
  manifestBlobId,
  parts,
  items,
  rules = [],
  paletteLinks = [],
  onSubmitted = null,
}) {
  const includedItems = assertProtocolV3IncludedItemGates(items);
  const connection = requireConnection();
  const paymentCoinType = requirePaymentCoinType();
  const tx = new Transaction();
  const createsProfile = !creator.profileId;
  const profile = creator.profileId
    ? tx.object(creator.profileId)
    : tx.moveCall({
        target: moveTarget('new_creator_profile'),
        arguments: [
          pureString(tx, creator.displayName),
          pureString(tx, creator.bio),
          pureString(tx, creator.avatarUrl),
          tx.pure.address(connection.account.address),
        ],
      });
  const policy = licenseKind(maker.license);
  const [ocMaker, makerTreasury, makerAdminCap] = tx.moveCall({
    target: moveTarget('new_managed_oc_maker'),
    typeArguments: [paymentCoinType],
    arguments: [
      profile,
      pureString(tx, maker.name),
      pureString(tx, maker.description),
      pureString(tx, maker.coverUrl),
      pureString(tx, manifestBlobId),
      tx.pure.u8(policy),
      tx.pure.u16(Number(maker.royaltyBps || 0)),
      tx.pure.bool(policy >= 2),
      tx.pure.bool(policy === 1),
      tx.pure.bool(true),
      tx.pure.bool(maker.mintingEnabled !== false),
      tx.pure.bool(Boolean(maker.mintFeeEnabled)),
      tx.pure.u64(Number(maker.mintFeeEnabled ? maker.mintPriceAtomic : 0)),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  for (const part of parts) {
    tx.moveCall({
      target: moveTarget('admin_add_part'),
      arguments: [
        makerAdminCap,
        ocMaker,
        pureString(tx, part.key),
        pureString(tx, part.label),
        tx.pure.u8(partKind(part.kind)),
        tx.pure.u64(part.renderOrder),
        tx.pure.bool(part.menuVisible !== false),
        tx.pure.bool(Boolean(part.required)),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
    for (const color of part.colors || []) {
      tx.moveCall({
        target: moveTarget('admin_add_color'),
        arguments: [
          makerAdminCap,
          ocMaker,
          pureString(tx, part.key),
          pureString(tx, color),
          tx.object(CLOCK_OBJECT_ID),
        ],
      });
    }
  }

  for (const item of includedItems) {
    tx.moveCall({
      target: moveTarget('admin_add_item'),
      arguments: [
        makerAdminCap,
        ocMaker,
        pureString(tx, item.partKey),
        pureString(tx, item.itemKey),
        pureString(tx, item.label),
        pureString(tx, item.blobId),
        pureString(tx, item.iconBlobId),
        tx.pure.u8(0),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  }

  for (const rule of rules) {
    tx.moveCall({
      target: moveTarget('admin_add_selection_rule'),
      arguments: [
        makerAdminCap,
        ocMaker,
        pureString(tx, rule.leftPartKey),
        pureString(tx, rule.leftItemKey),
        pureString(tx, rule.rightPartKey),
        pureString(tx, rule.rightItemKey),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  }

  for (const link of paletteLinks) {
    tx.moveCall({
      target: moveTarget('admin_add_palette_link'),
      arguments: [
        makerAdminCap,
        ocMaker,
        pureString(tx, link.primaryPartKey),
        pureString(tx, link.linkedPartKey),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  }

  tx.moveCall({
    target: moveTarget('admin_publish_maker'),
    arguments: [makerAdminCap, ocMaker, pureString(tx, manifestBlobId), tx.object(CLOCK_OBJECT_ID)],
  });
  const returnedAdminCap = tx.moveCall({
    target: moveTarget('share_managed_maker'),
    typeArguments: [paymentCoinType],
    arguments: [ocMaker, makerTreasury, makerAdminCap],
  });
  tx.transferObjects([returnedAdminCap], connection.account.address);
  if (createsProfile) {
    tx.moveCall({
      target: moveTarget('keep_creator_profile'),
      arguments: [profile],
    });
  }

  const transaction = unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: tx }));
  if (typeof onSubmitted === 'function') {
    try {
      await onSubmitted({ digest: transaction.digest, manifestBlobId });
    } catch (error) {
      console.warn('Maker publication was submitted, but its local digest checkpoint could not be saved.', error);
    }
  }
  let makerObjectId = '';
  let makerTreasuryObjectId = '';
  let makerAdminCapObjectId = '';
  let creatorProfileObjectId = creator.profileId || '';
  try {
    const indexedResult = unwrapTransaction(await suiClient.waitForTransaction({
      digest: transaction.digest,
      include: { effects: true, objectTypes: true },
    }));
    makerObjectId = findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'OCMaker');
    makerTreasuryObjectId = findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'MakerTreasury', { generic: true });
    makerAdminCapObjectId = findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'MakerAdminCap');
    creatorProfileObjectId ||= findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'CreatorProfile');
  } catch (error) {
    console.warn('Maker published, but its object id is not indexed yet.', error);
  }
  return { ...transaction, makerObjectId, makerTreasuryObjectId, makerAdminCapObjectId, creatorProfileObjectId };
}

export async function resolvePublishedMakerObjectId(digest, timeout = 30_000) {
  return (await resolvePublishedMakerObjects(digest, timeout)).makerObjectId;
}

export async function resolvePublishedMakerObjects(digest, timeout = 30_000) {
  requireOriginalPackageId();
  if (!digest) return {};
  const indexedResult = unwrapTransaction(await suiClient.waitForTransaction({
    digest,
    timeout,
    include: { objectTypes: true },
  }));
  return {
    makerObjectId: findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'OCMaker'),
    makerTreasuryObjectId: findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'MakerTreasury', { generic: true }),
    makerAdminCapObjectId: findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'MakerAdminCap'),
    creatorProfileObjectId: findOriginalAnimacraftObjectId(indexedResult.objectTypes, 'CreatorProfile'),
  };
}

export async function setMakerArchived(makerId, adminCapId, archived) {
  requireConnection();
  if (!makerId) throw new Error('The published OCMaker object id is missing. Reload it from Sui before changing lifecycle state.');
  if (!adminCapId) throw new Error('The MakerAdminCap is required to change this Maker.');
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget('admin_set_maker_archived'),
    arguments: [tx.object(adminCapId), tx.object(makerId), tx.pure.bool(Boolean(archived)), tx.object(CLOCK_OBJECT_ID)],
  });
  return unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: tx }));
}

export async function configureMakerEconomics({ makerId, adminCapId, mintingEnabled, mintFeeEnabled, mintPriceAtomic, royaltyBps }) {
  requireConnection();
  if (!makerId || !adminCapId) throw new Error('The Maker and its MakerAdminCap are required to update economics.');
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget('configure_maker_economics'),
    arguments: [
      tx.object(adminCapId),
      tx.object(makerId),
      tx.pure.bool(Boolean(mintingEnabled)),
      tx.pure.bool(Boolean(mintFeeEnabled)),
      tx.pure.u64(BigInt(mintFeeEnabled ? mintPriceAtomic : 0)),
      tx.pure.u16(Number(royaltyBps)),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: tx }));
}

export async function withdrawMakerRevenue({ makerId, treasuryId, adminCapId, amountAtomic, recipient }) {
  const connection = requireConnection();
  if (!makerId || !treasuryId || !adminCapId) throw new Error('The Maker, Treasury, and MakerAdminCap are required to withdraw revenue.');
  const amount = BigInt(amountAtomic || 0);
  if (amount <= 0n) throw new Error('Enter a positive revenue amount to withdraw.');
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget('withdraw_maker_revenue'),
    typeArguments: [requirePaymentCoinType()],
    arguments: [
      tx.object(adminCapId),
      tx.object(makerId),
      tx.object(treasuryId),
      tx.pure.u64(amount),
      tx.pure.address(recipient || connection.account.address),
    ],
  });
  return unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: tx }));
}

/** Adds Maker validation/payment to a Soulidity mint PTB. */
export function appendSoulMintAuthorization(tx, {
  makerId,
  treasuryId,
  protocolFeeConfigId = runtimeConfig?.protocolFeeConfigId,
  protocolTreasuryId = runtimeConfig?.protocolTreasuryId,
  mintPriceAtomic = 0,
  name,
  profileBlobId,
  imageBlobId,
  imageUrl,
  recipeHash,
  recipe,
}) {
  requireConnection();
  const serializedRecipe = bcs.vector(recipeSlotBcs).serialize(recipeValue(recipe));
  const numericPrice = Number(mintPriceAtomic || 0);
  if (!Number.isSafeInteger(numericPrice) || numericPrice < 0) {
    throw new Error('The Maker mint price cannot be represented safely by this client.');
  }
  const price = BigInt(numericPrice);
  const paid = price > 0n;
  if (!protocolFeeConfigId) {
    throw new Error('Canonical Soul minting is waiting for the v4 on-chain integration gate.');
  }
  if (paid && !treasuryId) throw new Error('This paid Maker is missing its on-chain MakerTreasury object id. Refresh the Maker before minting.');
  if (paid && !protocolTreasuryId) {
    throw new Error('Paid minting is waiting for the canonical v4 Protocol Fee objects.');
  }

  return tx.moveCall({
    target: moveTarget(paid ? 'authorize_soul_mint_paid_with_protocol_fee' : 'authorize_soul_mint_with_protocol_gate'),
    ...(paid ? { typeArguments: [requirePaymentCoinType()] } : {}),
    arguments: [
      tx.object(makerId),
      ...(paid ? [
        tx.object(treasuryId),
        tx.object(protocolFeeConfigId),
        tx.object(protocolTreasuryId),
        tx.coin({ type: requirePaymentCoinType(), balance: price }),
      ] : [
        tx.object(protocolFeeConfigId),
      ]),
      pureString(tx, name),
      pureString(tx, profileBlobId),
      pureString(tx, imageBlobId),
      pureString(tx, imageUrl),
      tx.pure.vector('u8', [...recipeHash]),
      tx.pure(serializedRecipe),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
}

export function explorerTransactionUrl(digest) {
  return `https://suivision.xyz/txblock/${digest}?network=${runtimeConfig?.network || 'mainnet'}`;
}

export function explorerObjectUrl(objectId) {
  return `https://suivision.xyz/object/${objectId}?network=${runtimeConfig?.network || 'mainnet'}`;
}
