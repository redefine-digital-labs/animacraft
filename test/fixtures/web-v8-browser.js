import {
  WEB_V8_CONTEXT_SCHEMA,
  WEB_V8_EXECUTION_SCHEMA,
  WEB_V8_ROUTE_SCHEMA,
  bootstrapFreshV8Browser,
  parseFreshV8Route,
} from '../../app.js';
import { makerV8StableType } from '../../maker-v8-runtime.js';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { runtimeAttestationRpc } from './maker-v8-runtime-attestation.js';

const query = new URLSearchParams(location.search);
const marketOrigin = query.get('marketOrigin');
const recoveryOrigin = query.get('recoveryOrigin');
if (!marketOrigin || !recoveryOrigin) throw new Error('marketOrigin and recoveryOrigin are required.');
const [marketModule, recoveryModule] = await Promise.all([
  import(/* @vite-ignore */ `${marketOrigin}/maker-v8-market.js`),
  import(/* @vite-ignore */ `${recoveryOrigin}/maker-v8-recovery.js`),
]);

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const packageId = (digit) => `0x${digit.repeat(64)}`;
const bytes32 = (value) => Array(32).fill(value);
const digest = '11111111111111111111111111111111';
const u64Bytes = (value) => {
  const bytes = [];
  let remaining = BigInt(value);
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  return bytes;
};
const hexBytes = (value) => value.slice(2).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16));
const vector32 = (value) => [32, ...hexBytes(value)];
const quoteBytes = (quote) => Uint8Array.from([
  quote.quoteKind, ...hexBytes(quote.rootId), ...u64Bytes(quote.makerVersion),
  ...vector32(quote.rootContentCommitment), ...vector32(quote.economicsCommitment),
  ...vector32(quote.rightsCommitment), ...u64Bytes(quote.grossAtomic),
  ...u64Bytes(quote.protocolAtomic), ...u64Bytes(quote.creatorAtomic),
  ...u64Bytes(quote.sourceAtomic), ...u64Bytes(quote.sellerAtomic), ...vector32(quote.commitment),
]);
const rolePackages = {
  core: packageId('1'), seal: packageId('6'), runtime: packageId('4'), output: packageId('2'), physical: packageId('3'), market: packageId('5'), release: packageId('7'),
};
const rawRuntime = {
  schemaVersion: 'animacraft.maker-v8-runtime.v8',
  protocolVersion: 8,
  enabled: true,
  catalogId: id(900),
  protocolConfigId: id(901),
  protocolTreasuryId: id(902),
  paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  clockObjectId: `0x${'0'.repeat(63)}6`,
  roles: Object.fromEntries(Object.entries(rolePackages).map(([role, packageValue]) => [role, {
    typeOriginPackageId: packageValue,
    callablePackageId: packageValue,
  }])),
  roleConfigIds: {
    seal: id(910), runtime: id(911), output: id(912), physical: id(913), market: id(914), release: id(915),
  },
  makerBindings: [],
};
const execution = {
  schemaVersion: WEB_V8_EXECUTION_SCHEMA,
  network: 'mainnet',
  chainIdentifier: '35834a8a',
  allowWalletSignature: false,
  allowBroadcast: false,
};
const market = marketModule.createMarketV8Client(rawRuntime, { network: 'mainnet' });
const IDs = {
  registry: id(100), treasury: id(101), catalog: rawRuntime.catalogId, config: rawRuntime.roleConfigIds.market, root: id(104),
  protocolConfig: rawRuntime.protocolConfigId, admin: id(107), makerTreasury: id(108), seller: id(200),
};
function moveObject(type, objectId, fields) {
  return {
    data: {
      objectId,
      version: '7',
      digest,
      content: { dataType: 'moveObject', type, hasPublicTransfer: false, fields: { id: { id: objectId }, ...fields } },
    },
  };
}
const registry = market.parseRegistry(moveObject(market.types.marketRegistry, IDs.registry, {
  version: '8', catalog_id: IDs.catalog, package_config_id: IDs.config,
  product_binding_commitment: bytes32(1), call_cap_set_commitment: bytes32(2), root_id: IDs.root,
  maker_version: '42', root_content_commitment: bytes32(0xaa), protocol_config_id: IDs.protocolConfig,
  protocol_config_revision: '7', protocol_config_commitment: bytes32(0xdd), economics_commitment: bytes32(0xbb),
  rights_commitment: bytes32(0xcc), maker_market_fee_bps: '250', soul_market_fee_bps: '300',
  soul_creator_royalty_bps: '500', maker_source_royalty_bps: '200', maker_resale_royalty_bps: '400',
  treasury_id: IDs.treasury, sealed: true, revision: '4', listing_count: '0', escrow_count: '0',
  completed_sale_count: '0', canceled_sale_count: '0', recovered_sale_count: '0', gross_volume_atomic: '0',
  protocol_paid_atomic: '0', creator_paid_atomic: '0', source_paid_atomic: '0', seller_paid_atomic: '0',
  zero_state_commitment: bytes32(3),
}));
const treasury = market.parseTreasury(moveObject(market.types.marketTreasury, IDs.treasury, {
  version: '8', catalog_id: IDs.catalog, package_config_id: IDs.config, root_id: IDs.root,
  maker_version: '42', root_content_commitment: bytes32(0xaa), escrow: { value: '0' },
  gross_escrowed_atomic: '0', gross_released_atomic: '0',
}));
const object = (objectId, type, fields = {}) => ({
  schemaVersion: 'animacraft.maker-v8-chain.v8',
  objectId,
  version: '7',
  digest,
  network: 'mainnet',
  type,
  ...fields,
});
const account = { address: IDs.seller, network: 'mainnet' };
const builderInput = {
  registry, treasury,
  root: object(IDs.root, market.types.makerRoot, {
    adminCapId: IDs.admin,
    binding: Object.freeze({
      makerTreasuryId: IDs.makerTreasury,
      marketRegistryId: IDs.registry,
      marketTreasuryId: IDs.treasury,
    }),
    lifecycleCode: marketModule.MARKET_V8_LIFECYCLES.PAUSED,
  }), catalog: object(IDs.catalog, market.types.catalog),
  config: object(IDs.config, market.types.marketConfig), protocolConfig: object(IDs.protocolConfig, market.types.protocolConfig, {
    enabled: true,
    revision: registry.fields.protocolConfigRevision,
    commitment: registry.fields.protocolConfigCommitment,
  }),
  wallet: account, admin: object(IDs.admin, market.types.makerAdmin),
  makerTreasury: object(IDs.makerTreasury, market.types.makerTreasury, { balanceAtomic: '0' }),
  grossAtomic: '1000000', expectedRegistryRevision: registry.fields.revision,
};
const eventType = makerV8StableType(rawRuntime, 'release', 'release_v8', 'MakerV8Activated');
const inspectedQuote = market.quoteMakerResale(registry, '1000000');
const ref = (objectId) => ({ id: objectId, version: '7', digest });
const packageTuple = Object.entries(rawRuntime.roles).map(([role, entry], index) => ({
  role, originalPackageId: entry.typeOriginPackageId, callablePackageId: entry.callablePackageId,
  packageDigest: `${index + 2}`.repeat(32),
}));
let buildCount = 0;
let signCount = 0;
const suiClient = runtimeAttestationRpc(rawRuntime, {
  async simulateTransaction() {
    return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(inspectedQuote) }] }] };
  },
  async dryRunTransactionBlock() { return { effects: { status: { status: 'success' } } }; },
});

function exactListTransaction(descriptor) {
  const [packageIdValue, moduleName, functionName] = descriptor.target.split('::');
  const inputs = descriptor.arguments.map((argument) => (
    argument.kind === 'u64'
      ? Inputs.Pure(bcs.u64().serialize(BigInt(argument.value)))
      : Inputs.SharedObjectRef({ objectId: argument.objectId, initialSharedVersion: '1', mutable: true })
  ));
  const data = TransactionDataBuilder.restore({
    version: 2, sender: descriptor.sender, expiration: null,
    gasData: {
      budget: '10000000', price: '1000', owner: descriptor.sender,
      payment: [{ objectId: id(999), version: '1', digest }],
    },
    inputs,
    commands: [{
      MoveCall: {
        package: packageIdValue, module: moduleName, function: functionName,
        typeArguments: [...descriptor.typeArguments],
        arguments: inputs.map((_, Input) => ({ Input, $kind: 'Input' })),
      },
      $kind: 'MoveCall',
    }],
  });
  const bytes = data.build();
  return { transactionBytes: toBase64(bytes), transactionDigest: TransactionDataBuilder.getDigestFromBytes(bytes) };
}
const adapters = {
  rpc: {
    async getChainIdentifier() { return '35834a8a'; },
    async getSuiClient() { return suiClient; },
    async browseMarket() { throw new Error('not used'); },
    async loadRoute(request) {
      return {
        schemaVersion: WEB_V8_ROUTE_SCHEMA, source: 'LIVE_RPC', requestId: request.requestId,
        chainIdentifier: '35834a8a', route: `maker:${IDs.root}`,
        activation: { eventType, rootId: IDs.root, lifecycle: 'ACTIVE' },
        view: { title: 'Browser Evidence Maker', subtitle: 'Checked-in fresh v8 Move object fixture', lifecycle: 'PAUSED', listingKind: null, listingStatus: null },
        availableActions: ['listMakerControl'],
      };
    },
    async loadActionContext(request) {
      return {
        schemaVersion: WEB_V8_CONTEXT_SCHEMA, source: 'LIVE_RPC', requestId: request.requestId,
        chainIdentifier: '35834a8a', route: `maker:${IDs.root}`, action: 'listMakerControl',
        activation: { eventType, rootId: IDs.root, lifecycle: 'ACTIVE' }, packageTuple, builderInput,
        refs: { primary: ref(IDs.admin), root: ref(IDs.root), registry: ref(IDs.registry), treasury: ref(IDs.treasury) },
        authority: { kind: 'MAKER_ADMIN', refs: [ref(IDs.admin)] },
      };
    },
    async queryTransaction({ digest: value }) { return { status: 'NOT_FOUND', digest: value, checkpoint: null, error: null }; },
    async readbackMarketAction() { throw new Error('not used'); },
  },
  wallet: {
    async getCurrentAccount() { return account; },
    async reconnect() { return account; },
    async signExactTransaction() { signCount += 1; throw new Error('disabled'); },
    async verifyExactSignature() { return true; },
  },
  transactions: {
    async buildExactTransaction({ client, descriptor, transaction }) {
      if (client !== suiClient || typeof transaction.getData !== 'function' || descriptor.action !== 'listMakerControl') throw new Error('real builder evidence missing');
      buildCount += 1;
      return {
        ...exactListTransaction(descriptor),
        epochWindow: { start: '100', end: '101' }, gas: { budget: '10000000' },
        sourceSnapshot: { fixture: 'web-v8-chain.json', target: descriptor.target },
      };
    },
    async deriveTransactionDigest(bytes) { return TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes)); },
    async dryRunExactTransaction() { throw new Error('private Market simulation is required'); },
    async broadcastExactTransaction() { throw new Error('disabled'); },
  },
};

const controller = await bootstrapFreshV8Browser({
  root: document.querySelector('#app'),
  route: parseFreshV8Route(`/maker/${IDs.root}`),
  rawRuntime,
  rawExecution: execution,
  browserModule: {
    createProductionMakerV8BrowserAdapters({ runtime, execution: checkedExecution }) {
      if (runtime !== rawRuntime || checkedExecution.chainIdentifier !== execution.chainIdentifier) {
        throw new Error('production bootstrap factory inputs drifted');
      }
      return adapters;
    },
  },
  marketModule,
  recoveryModule,
});
window.browserEvidence = { controller, get buildCount() { return buildCount; }, get signCount() { return signCount; } };
document.documentElement.dataset.e2eReady = 'true';
