export const SUI_MAINNET_USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

export const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  packageId: '0xTODO_ANIMACRAFT_PACKAGE',
  paymentCoinType: SUI_MAINNET_USDC_TYPE,
  paymentCoinSymbol: 'USDC',
  paymentCoinDecimals: 6,
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  walrusRelayMaxTipMist: 1_000_000,
  walrusEpochs: 53,
  featuredMakers: {},
  appUrl: '',
  soulidityAppUrl: 'https://www.soulidity.ai',
  soulidityPackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
  canonicalSoulMintEnabled: false,
});

const SUI_ID = /^0x[0-9a-f]+$/i;
const MOVE_TYPE = /^0x[0-9a-f]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i;

function validHttpsUrl(value, { allowLocalhost = false } = {}) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:') return true;
    return allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeRuntimeConfig(overrides = {}, origin = '') {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...overrides,
    grpcUrl: overrides.grpcUrl || overrides.rpcUrl || DEFAULT_RUNTIME_CONFIG.grpcUrl,
    appUrl: overrides.appUrl || origin || DEFAULT_RUNTIME_CONFIG.appUrl,
    featuredMakers: overrides.featuredMakers && typeof overrides.featuredMakers === 'object'
      ? { ...overrides.featuredMakers }
      : {},
  };
}

export function validateRuntimeConfig(config, { strict = false, requireSoulidity = false } = {}) {
  const errors = [];
  const warnings = [];
  const checkUrl = (field, options) => {
    if (!validHttpsUrl(config[field], options)) errors.push(`${field} must be a valid HTTPS URL${options?.allowLocalhost ? ' (or localhost HTTP)' : ''}.`);
  };

  if (config.network !== 'mainnet') errors.push('Production Animacraft must use Sui Mainnet.');
  checkUrl('grpcUrl');
  checkUrl('graphqlUrl');
  checkUrl('walrusAggregatorUrl');
  checkUrl('walrusUploadRelayUrl');
  checkUrl('appUrl', { allowLocalhost: !strict });
  checkUrl('soulidityAppUrl', { allowLocalhost: !strict });

  const packageReady = SUI_ID.test(String(config.packageId || '')) && !String(config.packageId).includes('TODO');
  if (!packageReady) (strict ? errors : warnings).push('Publish Animacraft and replace packageId before Mainnet activation.');
  const soulidityReady = SUI_ID.test(String(config.soulidityPackageId || '')) && !String(config.soulidityPackageId).includes('TODO');
  if (!soulidityReady) (requireSoulidity ? errors : warnings).push('Set soulidityPackageId before enabling the Soulidity handoff.');
  if (typeof config.canonicalSoulMintEnabled !== 'boolean') errors.push('canonicalSoulMintEnabled must be a boolean release gate.');

  if (!MOVE_TYPE.test(String(config.paymentCoinType || ''))) errors.push('paymentCoinType is not a valid Sui Move coin type.');
  if (config.paymentCoinType !== SUI_MAINNET_USDC_TYPE) errors.push('Mainnet Maker payments must use Circle native Sui USDC.');
  if (config.paymentCoinSymbol !== 'USDC' || Number(config.paymentCoinDecimals) !== 6) errors.push('USDC symbol and decimals must be USDC / 6.');
  if (!Number.isSafeInteger(Number(config.walrusRelayMaxTipMist)) || Number(config.walrusRelayMaxTipMist) < 0) errors.push('walrusRelayMaxTipMist must be a non-negative safe integer.');
  if (!Number.isInteger(Number(config.walrusEpochs)) || Number(config.walrusEpochs) < 1 || Number(config.walrusEpochs) > 53) errors.push('walrusEpochs must be an integer from 1 to 53.');

  Object.entries(config.featuredMakers || {}).forEach(([key, objectId]) => {
    if (!key || !SUI_ID.test(String(objectId || ''))) errors.push(`featuredMakers.${key || '<empty>'} must be a valid Sui object id.`);
  });

  return { valid: errors.length === 0, packageReady, soulidityReady, errors, warnings };
}
