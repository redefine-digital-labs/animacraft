import '@mysten/dapp-kit-core/web';
import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url';

const CLOCK_OBJECT_ID = '0x6';

let dAppKit;
let runtimeConfig;
let walletModal;
let connectionUnsubscribe;
let walrusClient;
let WalrusFileClass;

const recipeSlotBcs = bcs.struct('RecipeSlot', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  color_hex: bcs.string(),
  render_order: bcs.u64(),
});

function requirePackageId() {
  if (!runtimeConfig?.packageId || runtimeConfig.packageId.includes('TODO')) {
    throw new Error('The Animacraft Move package is not configured yet. Publish it and set packageId in config.js.');
  }
  return runtimeConfig.packageId;
}

function requireConnection() {
  const connection = dAppKit?.stores.$connection.get();
  if (!connection?.account?.address) {
    throw new Error('Connect a Sui wallet before signing an on-chain action.');
  }
  return connection;
}

function moveTarget(functionName) {
  return `${requirePackageId()}::animacraft::${functionName}`;
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
  dAppKit = createDAppKit({
    networks: [config.network],
    defaultNetwork: config.network,
    autoConnect: true,
    createClient: (network) => new SuiGrpcClient({ network, baseUrl: config.rpcUrl }),
  });

  walletModal = document.createElement('mysten-dapp-kit-connect-modal');
  walletModal.id = 'suiWalletModal';
  walletModal.instance = dAppKit;
  document.body.appendChild(walletModal);

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

export async function prepareWalrusUpload(entries) {
  const connection = requireConnection();
  if (!runtimeConfig?.walrusUploadRelayUrl) throw new Error('Configure the Walrus Mainnet upload relay first.');
  if (!walrusClient) {
    const { WalrusFile, walrus } = await import('@mysten/walrus');
    WalrusFileClass = WalrusFile;
    walrusClient = new SuiGrpcClient({
      network: runtimeConfig.network,
      baseUrl: runtimeConfig.rpcUrl,
    }).$extend(walrus({
      wasmUrl: walrusWasmUrl,
      uploadRelay: {
        host: runtimeConfig.walrusUploadRelayUrl,
        sendTip: { max: Number(runtimeConfig.walrusRelayMaxTipMist || 1_000_000) },
      },
    }));
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Choose at least one file to store on Walrus.');

  const files = await Promise.all(entries.map(async (entry) => WalrusFileClass.from({
    contents: new Uint8Array(await entry.blob.arrayBuffer()),
    identifier: entry.identifier,
    tags: {
      'content-type': entry.blob.type || 'application/octet-stream',
      'animacraft-kind': entry.kind || 'asset',
    },
  })));
  const flow = walrusClient.walrus.writeFilesFlow({ files });
  const encoded = await flow.encode();
  return {
    flow,
    entries,
    encoded,
    owner: connection.account.address,
    stage: 'encoded',
    registerDigest: '',
    certifyDigest: '',
    uploaded: null,
    files: [],
  };
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
    const registerTx = session.flow.register({
      epochs: Math.max(1, Number(runtimeConfig.walrusEpochs || 2)),
      owner: connection.account.address,
      deletable: false,
    });
    const registered = unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: registerTx }));
    session.registerDigest = registered.digest;
    session.stage = 'registered';
  }
  session.uploaded = await session.flow.upload({ digest: session.registerDigest });
  session.stage = 'uploaded';
  return session;
}

export async function certifyWalrusUpload(session) {
  const connection = requireConnection();
  if (!session?.flow || session.stage !== 'uploaded') throw new Error('Register and upload the Walrus quilt before certification.');
  if (session.owner !== connection.account.address) {
    throw new Error('Reconnect the wallet that prepared this Walrus upload.');
  }
  const certifyTx = session.flow.certify();
  const certified = unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: certifyTx }));
  session.certifyDigest = certified.digest;
  session.files = await session.flow.listFiles();
  session.stage = 'certified';
  return session;
}

export function walrusFileUrl(quiltPatchId) {
  if (!quiltPatchId) return '';
  return `${runtimeConfig.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/by-quilt-patch-id/${quiltPatchId}`;
}

export async function publishMaker({ creator, maker, manifestBlobId, parts, items, rules = [] }) {
  const connection = requireConnection();
  const tx = new Transaction();
  const profile = tx.moveCall({
    target: moveTarget('new_creator_profile'),
    arguments: [
      pureString(tx, creator.displayName),
      pureString(tx, creator.bio),
      pureString(tx, creator.avatarUrl),
      tx.pure.address(connection.account.address),
    ],
  });
  const policy = licenseKind(maker.license);
  const ocMaker = tx.moveCall({
    target: moveTarget('new_oc_maker'),
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
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  for (const part of parts) {
    tx.moveCall({
      target: moveTarget('add_part'),
      arguments: [
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
  }

  for (const item of items) {
    tx.moveCall({
      target: moveTarget('add_item'),
      arguments: [
        ocMaker,
        pureString(tx, item.partKey),
        pureString(tx, item.itemKey),
        pureString(tx, item.label),
        pureString(tx, item.blobId),
        pureString(tx, item.iconBlobId),
        tx.pure.u8(Number(item.gateKind || 0)),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  }

  for (const rule of rules) {
    tx.moveCall({
      target: moveTarget('add_selection_rule'),
      arguments: [
        ocMaker,
        pureString(tx, rule.leftPartKey),
        pureString(tx, rule.leftItemKey),
        pureString(tx, rule.rightPartKey),
        pureString(tx, rule.rightItemKey),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  }

  tx.moveCall({
    target: moveTarget('publish_maker'),
    arguments: [ocMaker, pureString(tx, manifestBlobId), tx.object(CLOCK_OBJECT_ID)],
  });
  tx.transferObjects([profile, ocMaker], connection.account.address);

  return unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: tx }));
}

export async function mintCharacter({ makerId, name, profileBlobId, imageBlobId, imageUrl, recipeHash, recipe }) {
  requireConnection();
  const tx = new Transaction();
  const recipeValue = recipe.map((slot) => ({
    part_key: slot.partKey,
    item_key: slot.itemKey,
    color_hex: slot.colorHex,
    render_order: BigInt(slot.renderOrder),
  }));

  tx.moveCall({
    target: moveTarget('mint_oc_character'),
    arguments: [
      tx.object(makerId),
      pureString(tx, name),
      pureString(tx, profileBlobId),
      pureString(tx, imageBlobId),
      pureString(tx, imageUrl),
      tx.pure.vector('u8', [...recipeHash]),
      tx.pure(bcs.vector(recipeSlotBcs).serialize(recipeValue)),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  return unwrapTransaction(await dAppKit.signAndExecuteTransaction({ transaction: tx }));
}

export function explorerTransactionUrl(digest) {
  return `https://suivision.xyz/txblock/${digest}?network=${runtimeConfig?.network || 'mainnet'}`;
}
