import '@mysten/dapp-kit-core/web';
import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { normalizeStructTag } from '@mysten/sui/utils';
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url';
import { assertProtocolV3IncludedItemGates } from './manifest-validation.js';
import { hashRecipe, recipeSlotBcs, recipeValue } from './recipe-hash.js';
import { resolveCallablePackageId, resolveOriginalPackageId } from './runtime-config.js';
import { publishedMakerFromIntentEvent } from './chain-publication-recovery.js';

export { hashRecipe } from './recipe-hash.js';
export { publishedMakerFromIntentEvent } from './chain-publication-recovery.js';

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

async function ensureWalrusRuntime() {
  if (!runtimeConfig?.walrusUploadRelayUrl) throw new Error('Configure the Walrus Mainnet upload relay first.');
  if (!walrusClient) {
    const { WalrusFile, walrus } = await import('@mysten/walrus');
    WalrusFileClass = WalrusFile;
    walrusClient = new SuiGrpcClient({
      network: runtimeConfig.network,
      baseUrl: runtimeConfig.grpcUrl || runtimeConfig.rpcUrl,
    }).$extend(walrus({
      wasmUrl: walrusWasmUrl,
      uploadRelay: {
        host: runtimeConfig.walrusUploadRelayUrl,
        sendTip: { max: Number(runtimeConfig.walrusRelayMaxTipMist || 1_000_000) },
      },
    }));
  }
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
  if (totalBytes > 500 * 1024 * 1024) throw new Error('A single Animacraft upload cannot exceed 500 MB. Split this Maker into a smaller release.');

  return Promise.all(entries.map(async (entry) => WalrusFileClass.from({
    contents: new Uint8Array(await entry.blob.arrayBuffer()),
    identifier: entry.identifier,
    tags: {
      'content-type': entry.blob.type || 'application/octet-stream',
      'animacraft-kind': entry.kind || 'asset',
    },
  })));
}

export async function prepareWalrusUpload(entries) {
  const connection = requireConnection();
  await ensureWalrusRuntime();
  const files = await walrusFiles(entries);
  const flow = walrusClient.walrus.writeFilesFlow({ files });
  const encoded = await flow.encode();
  return {
    flow,
    entries,
    encoded,
    checkpoint: encoded,
    quiltBlobId: encoded.blobId,
    owner: connection.account.address,
    stage: 'encoded',
    registerDigest: '',
    certifyDigest: '',
    uploaded: null,
    files: [],
    recoveringUploaded: false,
  };
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
    flow,
    entries,
    encoded,
    quiltBlobId: encoded.blobId,
    owner: recovery.owner,
    stage: recovery.stage || recovery.checkpoint.step,
    registerDigest: recovery.registerDigest || recovery.checkpoint.txDigest || '',
    certifyDigest: recovery.certifyDigest || '',
    uploaded: recovery.checkpoint.step === 'uploaded' ? recovery.checkpoint : null,
    checkpoint: recovery.checkpoint,
    files: [],
    recoveringUploaded: false,
  };
  if (session.stage === 'uploaded') {
    session.stage = 'registered';
    session.recoveringUploaded = true;
  } else if (session.stage === 'certified') {
    if (!Array.isArray(recovery.files) || recovery.files.length === 0) {
      throw new Error('The certified Walrus checkpoint is missing its local Quilt file index. Prepare the upload again from the saved source files.');
    }
    session.files = recovery.files;
  }
  return session;
}

export async function registerAndUploadWalrus(session) {
  const connection = requireConnection();
  if (!session?.flow || !['encoded', 'registered'].includes(session.stage)) {
    throw new Error('Prepare the Walrus quilt before registering it.');
  }
  if (session.owner !== connection.account.address) {
    throw new Error('Reconnect the wallet that prepared this Walrus upload.');
  }
  if (session.stage === 'encoded') {
    const configuredEpochs = Number(runtimeConfig.walrusEpochs ?? 53);
    const storageEpochs = Number.isInteger(configuredEpochs) ? Math.min(53, Math.max(1, configuredEpochs)) : 53;
    const registerTx = session.flow.register({
      epochs: storageEpochs,
      owner: connection.account.address,
      deletable: false,
    });
    const registered = unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: registerTx }));
    session.registerDigest = registered.digest;
    session.stage = 'registered';
  }
  session.uploaded = await session.flow.upload({ digest: session.registerDigest });
  session.checkpoint = {
    ...session.uploaded,
    ...(session.encoded.nonce ? { nonce: session.encoded.nonce } : {}),
  };
  if (session.recoveringUploaded) session.files = await session.flow.listFiles();
  if (session.files[0]?.blobObject?.certified_epoch != null) {
    const blobObject = session.files[0].blobObject;
    session.checkpoint = {
      step: 'certified',
      blobId: session.files[0].blobId,
      blobObjectId: blobObject.id,
      blobObject,
      ...(session.encoded.nonce ? { nonce: session.encoded.nonce } : {}),
    };
    session.stage = 'certified';
  } else {
    session.stage = 'uploaded';
  }
  session.recoveringUploaded = false;
  return session;
}

export async function certifyWalrusUpload(session) {
  const connection = requireConnection();
  if (!session?.flow || session.stage !== 'uploaded') throw new Error('Register and upload the Walrus quilt before certification.');
  if (session.owner !== connection.account.address) {
    throw new Error('Reconnect the wallet that prepared this Walrus upload.');
  }
  if (!session.certifyDigest) {
    const certifyTx = session.flow.certify();
    const certified = unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: certifyTx }));
    session.certifyDigest = certified.digest;
  }
  session.files = await session.flow.listFiles();
  const blobObject = session.files[0]?.blobObject;
  session.checkpoint = blobObject ? {
    step: 'certified',
    blobId: session.files[0].blobId,
    blobObjectId: blobObject.id,
    blobObject,
    ...(session.encoded.nonce ? { nonce: session.encoded.nonce } : {}),
  } : session.checkpoint;
  session.stage = 'certified';
  return session;
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
