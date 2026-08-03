import { normalizeStructTag } from '@mysten/sui/utils';

export const SUI_MAINNET_USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const ANIMACRAFT_MAX_WALRUS_UPLOAD_BYTES = 500 * 1024 * 1024;
// This is a client-side spend ceiling, not the amount charged. The Mainnet
// relay quotes the exact tip from the encoded blob size and the wallet only
// transfers that quote. At the current 40 MIST / encoded KiB schedule, a
// 500 MiB Animacraft upload needs about 0.095 SUI.
export const ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST = 100_000_000;

export const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  packageId: '0xTODO_ANIMACRAFT_PACKAGE',
  callablePackageId: '0xTODO_ANIMACRAFT_PACKAGE',
  originalPackageId: '0xTODO_ANIMACRAFT_PACKAGE',
  paymentCoinType: SUI_MAINNET_USDC_TYPE,
  paymentCoinSymbol: 'USDC',
  paymentCoinDecimals: 6,
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  walrusRelayMaxTipMist: ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
  walrusEpochs: 53,
  featuredMakers: {},
  appUrl: '',
  soulidityAppUrl: 'https://www.soulidity.ai',
  soulidityIntegrationPath: '/integrations/animacraft',
  soulidityPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  // Latest Soulidity package used only for Move approval calls. The legacy
  // soulidityPackageId field remains a compatibility alias for this value.
  soulidityCallablePackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  // Permanent original Soulidity Seal namespace. Ciphertext, SessionKey and
  // recovery identities commit to this package and must survive upgrades.
  souliditySealNamespacePackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  // Stable defining package for the Soulidity v5 Animacraft provenance and
  // binding types. It may differ from soulidityPackageId after an upgrade,
  // and must never be advanced when v6 introduces a new owner-proof type.
  soulidityTypeOriginPackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  // Defining package (TypeOrigin) for the protocol-v4 fee object types. This
  // remains fixed when a later package becomes the callable package.
  protocolFeePackageId: '',
  protocolFeeConfigId: '',
  protocolTreasuryId: '',
  protocolFeeAdminCapId: '',
  protocolFeeAdminCapOwner: '',
  primaryProtocolFeeBps: 5_000,
  canonicalSoulMintEnabled: false,
  // Commerce v5 is an additive protocol. Its type origin is the package that
  // first introduces `commerce_v5`; it remains stable across later upgrades.
  // The release gate stays false until the package upgrade, disabled protocol
  // objects, read-back verification, Maker migration, and Soulidity adapter
  // have all passed production preflight.
  commerceV5TypeOriginPackageId: '',
  commerceProtocolConfigV5Id: '',
  commerceProtocolTreasuryV5Id: '',
  // Bind-once Commerce v5 dependencies. The auxiliary ID is one independent
  // public transparent Walrus Blob shared by logical None/Smart Color rows;
  // it is never a per-Maker Quilt patch.
  commerceV5LogicalAuxiliaryBlobId: '',
  commerceV5SoulBindingProofType: '',
  commerceV5ReleaseEnabled: false,
  // Composable Assets v6 is a companion to one already-published v5 Maker
  // release. A reviewed core tuple may be recorded after disabled Mainnet
  // initialization. The gate must stay false until Soulidity appearance_v6 is
  // deployed and the exact owner-proof TypeOrigin is bound and read back.
  compositionV6TypeOriginPackageId: '',
  compositionProtocolConfigV6Id: '',
  compositionProtocolTreasuryV6Id: '',
  compositionRegistryV6Id: '',
  compositionAdminCapV6Id: '',
  compositionAdminCapV6Owner: '',
  compositionValidatorCapV6Id: '',
  compositionValidatorCapV6Owner: '',
  compositionValidatorEpochV6: '',
  compositionValidatorPolicyCommitmentV6: '',
  // Stable defining package for Soulidity's v6 AnimacraftSoulOwnerProofV6.
  // This is intentionally independent from the v5 provenance TypeOrigin.
  // It may remain empty while the v6 release gate and proof binding are off.
  compositionV6SoulOwnerProofTypeOriginPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  compositionV6SoulOwnerProofType: '',
  compositionV6ReleaseEnabled: false,
  // Physical Style Assets v7 is additive to v6. It remains authoring-only
  // until the wardrobe custody package and Soulidity adapter are deployed and
  // independently audited.
  // v7 is a separate companion package because the combined Core + v7
  // bytecode exceeds Sui Mainnet's package object-size limit. Calls must use
  // this package while v4-v6 calls continue to use callablePackageId.
  physicalV7CallablePackageId: '',
  physicalV7TypeOriginPackageId: '',
  physicalProtocolConfigV7Id: '',
  physicalRegistryV7Id: '',
  physicalAdminCapV7Id: '',
  physicalAdminCapV7Owner: '',
  physicalV7SoulOwnerProofTypeOriginPackageId: '',
  physicalV7SoulOwnerProofType: '',
  physicalStyleV7ReleaseEnabled: false,
  // Seal remains fail-closed until the reviewed v5 package and an authenticated
  // Mainnet committee endpoint are configured. One committee is one outer
  // server with weight 1 / threshold 1; its internal committee is 5-of-8.
  // Frozen package used for Seal encryption, SessionKey scoping and approval
  // calls. Existing ciphertext commits to this namespace, so a later
  // Animacraft upgrade must not silently replace it.
  sealV5CallablePackageId: '',
  // Stable package that first defined seal_v5 object types. It never advances
  // when a later package becomes callable.
  sealV5TypeOriginPackageId: '',
  // Backward-compatible alias for deployments created before callable and
  // TypeOrigin were split. normalizeRuntimeConfig maps it to both identities.
  sealV5PackageId: '',
  sealKeyServers: [],
  sealThreshold: 0,
  sealTimeoutMs: 10_000,
  sealVerifyKeyServers: true,
});

const SUI_ID = /^0x[0-9a-f]+$/i;
const MOVE_TYPE = /^0x[0-9a-f]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i;
const WALRUS_BLOB_ID = /^[A-Za-z0-9_-]{20,128}$/;

export function assertSupportedMakerPaymentCoin(actualType, configuredType = SUI_MAINNET_USDC_TYPE) {
  let actual;
  let configured;
  try {
    actual = normalizeStructTag(String(actualType || '').trim());
    configured = normalizeStructTag(String(configuredType || '').trim());
  } catch {
    throw new Error('The on-chain Maker has an invalid payment coin type.');
  }
  if (actual !== configured) {
    throw new Error('The on-chain Maker payment coin does not match configured native Sui USDC.');
  }
  return actual;
}

export function assertSupportedMakerMintEconomics({ mintingEnabled, mintFeeEnabled, mintPriceAtomic }) {
  const price = Number(mintPriceAtomic);
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new Error('The on-chain Maker mint price cannot be represented safely by this client.');
  }
  if ((!mintingEnabled && mintFeeEnabled)
    || (mintFeeEnabled && price === 0)
    || (!mintFeeEnabled && price !== 0)) {
    throw new Error('The on-chain Maker has an invalid mint economics configuration.');
  }
  return { mintingEnabled: Boolean(mintingEnabled), mintFeeEnabled: Boolean(mintFeeEnabled), mintPriceAtomic: price };
}

function validHttpsUrl(value, { allowLocalhost = false } = {}) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:') return true;
    return allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function resolveCallablePackageId(config = {}) {
  return String(config.callablePackageId || config.packageId || config.originalPackageId || '').trim();
}

export function resolveOriginalPackageId(config = {}) {
  return String(config.originalPackageId || config.packageId || config.callablePackageId || '').trim();
}

export function resolveSoulidityCallablePackageId(config = {}) {
  return String(
    config.soulidityCallablePackageId
      || config.soulidityPackageId
      || '',
  ).trim();
}

export function resolveSouliditySealNamespacePackageId(config = {}) {
  return String(
    config.souliditySealNamespacePackageId
      || config.soulidityPackageId
      || '',
  ).trim();
}

export function resolveSealV5CallablePackageId(config = {}) {
  return String(
    config.sealV5CallablePackageId
      || config.sealV5PackageId
      || '',
  ).trim();
}

export function resolveSealV5TypeOriginPackageId(config = {}) {
  return String(
    config.sealV5TypeOriginPackageId
      || config.sealV5PackageId
      || '',
  ).trim();
}

export function normalizeRuntimeConfig(overrides = {}, origin = '') {
  const callablePackageId = resolveCallablePackageId(overrides)
    || DEFAULT_RUNTIME_CONFIG.callablePackageId;
  const originalPackageId = resolveOriginalPackageId(overrides)
    || DEFAULT_RUNTIME_CONFIG.originalPackageId;
  const soulidityCallablePackageId = resolveSoulidityCallablePackageId(overrides)
    || DEFAULT_RUNTIME_CONFIG.soulidityCallablePackageId;
  const souliditySealNamespacePackageId = resolveSouliditySealNamespacePackageId(overrides)
    || DEFAULT_RUNTIME_CONFIG.souliditySealNamespacePackageId;
  const sealV5CallablePackageId = resolveSealV5CallablePackageId(overrides);
  const sealV5TypeOriginPackageId = resolveSealV5TypeOriginPackageId(overrides);
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...overrides,
    // packageId remains a compatibility alias for pre-upgrade config files.
    packageId: callablePackageId,
    callablePackageId,
    originalPackageId,
    // soulidityPackageId remains a compatibility alias for the latest
    // callable package. Seal identities must use the explicit namespace.
    soulidityPackageId: soulidityCallablePackageId,
    soulidityCallablePackageId,
    souliditySealNamespacePackageId,
    // Keep the legacy alias callable for old application code and old static
    // configs. Type checks must use sealV5TypeOriginPackageId instead.
    sealV5PackageId: sealV5CallablePackageId,
    sealV5CallablePackageId,
    sealV5TypeOriginPackageId,
    grpcUrl: overrides.grpcUrl || overrides.rpcUrl || DEFAULT_RUNTIME_CONFIG.grpcUrl,
    appUrl: overrides.appUrl || origin || DEFAULT_RUNTIME_CONFIG.appUrl,
    featuredMakers: overrides.featuredMakers && typeof overrides.featuredMakers === 'object'
      ? { ...overrides.featuredMakers }
      : {},
    sealKeyServers: Array.isArray(overrides.sealKeyServers)
      ? overrides.sealKeyServers.map((server) => ({ ...server }))
      : [],
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
  if (!/^\/[a-z0-9/_-]+$/i.test(String(config.soulidityIntegrationPath || ''))) {
    errors.push('soulidityIntegrationPath must be an absolute application path.');
  }

  const callablePackageId = resolveCallablePackageId(config);
  const originalPackageId = resolveOriginalPackageId(config);
  const callablePackageReady = SUI_ID.test(callablePackageId) && !callablePackageId.includes('TODO');
  const originalPackageReady = SUI_ID.test(originalPackageId) && !originalPackageId.includes('TODO');
  const packageReady = callablePackageReady && originalPackageReady;
  if (!callablePackageReady) {
    (strict ? errors : warnings).push('Publish Animacraft and set callablePackageId before Mainnet activation.');
  }
  if (!originalPackageReady) {
    (strict ? errors : warnings).push('Set originalPackageId to the first published package id before Mainnet activation.');
  }
  if (config.packageId && config.callablePackageId
    && String(config.packageId).trim() !== String(config.callablePackageId).trim()) {
    errors.push('packageId is a compatibility alias and must match callablePackageId.');
  }
  const soulidityCallablePackageId = resolveSoulidityCallablePackageId(config);
  const souliditySealNamespacePackageId = resolveSouliditySealNamespacePackageId(config);
  const soulidityReady = SUI_ID.test(soulidityCallablePackageId)
    && !soulidityCallablePackageId.includes('TODO');
  const souliditySealNamespaceReady = SUI_ID.test(souliditySealNamespacePackageId)
    && !souliditySealNamespacePackageId.includes('TODO');
  if (!soulidityReady) (requireSoulidity ? errors : warnings).push('Set soulidityCallablePackageId before enabling the Soulidity handoff.');
  if (!souliditySealNamespaceReady) {
    (requireSoulidity ? errors : warnings).push('Set the permanent souliditySealNamespacePackageId before enabling protected Complete outputs.');
  }
  if (config.soulidityPackageId && config.soulidityCallablePackageId
    && String(config.soulidityPackageId).trim() !== String(config.soulidityCallablePackageId).trim()) {
    errors.push('soulidityPackageId is a compatibility alias and must match soulidityCallablePackageId.');
  }
  const soulidityTypeOrigin = String(
    config.soulidityTypeOriginPackageId || soulidityCallablePackageId || '',
  );
  const soulidityTypeOriginReady = SUI_ID.test(soulidityTypeOrigin)
    && !soulidityTypeOrigin.includes('TODO');
  if (config.soulidityTypeOriginPackageId && !soulidityTypeOriginReady) {
    errors.push('soulidityTypeOriginPackageId must be a valid Sui package ID.');
  }
  if (requireSoulidity && !soulidityTypeOriginReady) {
    errors.push('Set the stable Soulidity TypeOrigin package before enabling the completion receipt.');
  }
  if (typeof config.canonicalSoulMintEnabled !== 'boolean') errors.push('canonicalSoulMintEnabled must be a boolean release gate.');
  if (requireSoulidity && config.canonicalSoulMintEnabled !== true) {
    errors.push('The Soulidity integration preflight requires canonicalSoulMintEnabled=true.');
  }
  const protocolFeeConfigReady = SUI_ID.test(String(config.protocolFeeConfigId || ''));
  const protocolTreasuryReady = SUI_ID.test(String(config.protocolTreasuryId || ''));
  const protocolFeeAdminCapReady = SUI_ID.test(String(config.protocolFeeAdminCapId || ''));
  const protocolFeeAdminCapOwnerReady = SUI_ID.test(String(config.protocolFeeAdminCapOwner || ''));
  const protocolFeePackageId = String(config.protocolFeePackageId || '').trim();
  const protocolFeePackageReady = SUI_ID.test(protocolFeePackageId);
  const protocolObjectsConfigured = Boolean(
    config.protocolFeeConfigId
      || config.protocolTreasuryId
      || config.protocolFeeAdminCapId
      || config.protocolFeeAdminCapOwner,
  );
  if (protocolFeePackageId && !protocolFeePackageReady) {
    errors.push('protocolFeePackageId must be a valid Sui package ID.');
  }
  if (callablePackageReady
    && originalPackageReady
    && callablePackageId !== originalPackageId
    && !protocolFeePackageReady) {
    errors.push('An upgraded Animacraft callable package requires its stable protocolFeePackageId TypeOrigin.');
  }
  if (protocolObjectsConfigured && !protocolFeePackageReady) {
    errors.push('Protocol fee objects require their stable protocolFeePackageId TypeOrigin.');
  }
  if (config.canonicalSoulMintEnabled
    && (!protocolFeePackageReady
      || !protocolFeeConfigReady
      || !protocolTreasuryReady
      || !protocolFeeAdminCapReady
      || !protocolFeeAdminCapOwnerReady)) {
    errors.push('Canonical Soul minting requires the v4 protocol fee TypeOrigin, ProtocolFeeConfig, ProtocolTreasury, AdminCap, and expected AdminCap owner.');
  }
  const primaryProtocolFeeBps = Number(config.primaryProtocolFeeBps);
  if (!Number.isInteger(primaryProtocolFeeBps) || primaryProtocolFeeBps < 0 || primaryProtocolFeeBps > 5_000) {
    errors.push('primaryProtocolFeeBps must be an integer from 0 to 5000.');
  }

  const commerceV5TypeOriginPackageReady = SUI_ID.test(
    String(config.commerceV5TypeOriginPackageId || ''),
  );
  const commerceProtocolConfigV5Ready = SUI_ID.test(
    String(config.commerceProtocolConfigV5Id || ''),
  );
  const commerceProtocolTreasuryV5Ready = SUI_ID.test(
    String(config.commerceProtocolTreasuryV5Id || ''),
  );
  const commerceV5LogicalAuxiliaryBlobReady = WALRUS_BLOB_ID.test(
    String(config.commerceV5LogicalAuxiliaryBlobId || '').trim(),
  );
  let commerceV5SoulBindingProofType = '';
  try {
    commerceV5SoulBindingProofType = normalizeStructTag(
      String(config.commerceV5SoulBindingProofType || '').trim(),
    );
  } catch {
    commerceV5SoulBindingProofType = '';
  }
  const expectedSoulBindingProofType = soulidityTypeOriginReady
    ? normalizeStructTag(
      `${soulidityTypeOrigin}::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5`,
    )
    : '';
  const commerceV5SoulBindingProofReady = Boolean(
    commerceV5SoulBindingProofType
      && expectedSoulBindingProofType
      && commerceV5SoulBindingProofType === expectedSoulBindingProofType,
  );
  const commerceV5CoreConfigured = Boolean(
    config.commerceV5TypeOriginPackageId
      || config.commerceProtocolConfigV5Id
      || config.commerceProtocolTreasuryV5Id,
  );
  const commerceV5CoreReady = commerceV5TypeOriginPackageReady
    && commerceProtocolConfigV5Ready
    && commerceProtocolTreasuryV5Ready;
  const commerceV5BindingConfigured = Boolean(
    config.commerceV5LogicalAuxiliaryBlobId
      || config.commerceV5SoulBindingProofType,
  );
  if (typeof config.commerceV5ReleaseEnabled !== 'boolean') {
    errors.push('commerceV5ReleaseEnabled must be a boolean release gate.');
  }
  if (config.commerceV5TypeOriginPackageId && !commerceV5TypeOriginPackageReady) {
    errors.push('commerceV5TypeOriginPackageId must be a valid Sui package ID.');
  }
  if (config.commerceProtocolConfigV5Id && !commerceProtocolConfigV5Ready) {
    errors.push('commerceProtocolConfigV5Id must be a valid Sui object ID.');
  }
  if (config.commerceProtocolTreasuryV5Id && !commerceProtocolTreasuryV5Ready) {
    errors.push('commerceProtocolTreasuryV5Id must be a valid Sui object ID.');
  }
  if (
    config.commerceV5LogicalAuxiliaryBlobId
    && !commerceV5LogicalAuxiliaryBlobReady
  ) {
    errors.push('commerceV5LogicalAuxiliaryBlobId must be a valid independent Walrus Blob ID.');
  }
  if (
    config.commerceV5SoulBindingProofType
    && !commerceV5SoulBindingProofReady
  ) {
    errors.push('commerceV5SoulBindingProofType must be the exact AnimacraftSoulBindingProofV5 defined by the stable Soulidity TypeOrigin.');
  }
  if ((commerceV5CoreConfigured || commerceV5BindingConfigured)
    && !commerceV5CoreReady) {
    errors.push('Commerce v5 core configuration must include its stable TypeOrigin, protocol config, and protocol treasury together.');
  }
  if (commerceV5BindingConfigured
    && (!commerceV5LogicalAuxiliaryBlobReady
      || !commerceV5SoulBindingProofReady)) {
    errors.push('Commerce v5 bind-once configuration must include the canonical logical Walrus Blob and exact Soulidity proof type together.');
  }
  if (config.commerceV5ReleaseEnabled
    && (!commerceV5CoreReady
      || !commerceV5LogicalAuxiliaryBlobReady
      || !commerceV5SoulBindingProofReady)) {
    errors.push('Commerce v5 cannot be released before its TypeOrigin, protocol objects, canonical logical Walrus Blob, and exact Soulidity proof type are configured.');
  }
  if (
    config.commerceV5ReleaseEnabled
    && (
      config.canonicalSoulMintEnabled !== true
      || !soulidityReady
      || !souliditySealNamespaceReady
      || !soulidityTypeOriginReady
    )
  ) {
    errors.push('Commerce v5 requires the canonical Soulidity mint gate, callable package, permanent Seal namespace, and stable TypeOrigin because every Complete output is atomically bound to one Soul.');
  }

  const compositionV6TypeOriginPackageReady = SUI_ID.test(
    String(config.compositionV6TypeOriginPackageId || ''),
  );
  const compositionProtocolConfigV6Ready = SUI_ID.test(
    String(config.compositionProtocolConfigV6Id || ''),
  );
  const compositionProtocolTreasuryV6Ready = SUI_ID.test(
    String(config.compositionProtocolTreasuryV6Id || ''),
  );
  const compositionRegistryV6Ready = SUI_ID.test(
    String(config.compositionRegistryV6Id || ''),
  );
  const compositionAdminCapV6Ready = SUI_ID.test(
    String(config.compositionAdminCapV6Id || ''),
  );
  const compositionAdminCapV6OwnerReady = SUI_ID.test(
    String(config.compositionAdminCapV6Owner || ''),
  );
  const compositionValidatorCapV6Ready = SUI_ID.test(
    String(config.compositionValidatorCapV6Id || ''),
  );
  const compositionValidatorCapV6OwnerReady = SUI_ID.test(
    String(config.compositionValidatorCapV6Owner || ''),
  );
  const compositionValidatorEpochV6 = Number(config.compositionValidatorEpochV6);
  const compositionValidatorEpochV6Ready = config.compositionValidatorEpochV6 !== ''
    && config.compositionValidatorEpochV6 !== null
    && config.compositionValidatorEpochV6 !== undefined
    && Number.isSafeInteger(compositionValidatorEpochV6)
    && compositionValidatorEpochV6 >= 0;
  const compositionValidatorPolicyCommitmentV6Ready = /^0x[0-9a-f]{64}$/i.test(
    String(config.compositionValidatorPolicyCommitmentV6 || ''),
  );
  const compositionV6SoulOwnerProofTypeOriginPackageId = String(
    config.compositionV6SoulOwnerProofTypeOriginPackageId || '',
  ).trim();
  const compositionV6SoulOwnerProofTypeOriginPackageReady = SUI_ID.test(
    compositionV6SoulOwnerProofTypeOriginPackageId,
  ) && !compositionV6SoulOwnerProofTypeOriginPackageId.includes('TODO');
  let compositionV6SoulOwnerProofType = '';
  try {
    compositionV6SoulOwnerProofType = normalizeStructTag(
      String(config.compositionV6SoulOwnerProofType || '').trim(),
    );
  } catch {
    compositionV6SoulOwnerProofType = '';
  }
  const expectedSoulOwnerProofType = compositionV6SoulOwnerProofTypeOriginPackageReady
    ? normalizeStructTag(
      `${compositionV6SoulOwnerProofTypeOriginPackageId}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
    )
    : '';
  const compositionV6SoulOwnerProofReady = Boolean(
    compositionV6SoulOwnerProofType
      && expectedSoulOwnerProofType
      && compositionV6SoulOwnerProofType === expectedSoulOwnerProofType,
  );
  const compositionV6CoreConfigured = Boolean(
    config.compositionV6TypeOriginPackageId
      || config.compositionProtocolConfigV6Id
      || config.compositionProtocolTreasuryV6Id
      || config.compositionRegistryV6Id
      || config.compositionAdminCapV6Id
      || config.compositionAdminCapV6Owner
      || config.compositionValidatorCapV6Id
      || config.compositionValidatorCapV6Owner
      || config.compositionValidatorEpochV6 !== ''
      || config.compositionValidatorPolicyCommitmentV6,
  );
  const compositionV6CoreReady = compositionV6TypeOriginPackageReady
    && compositionProtocolConfigV6Ready
    && compositionProtocolTreasuryV6Ready
    && compositionRegistryV6Ready
    && compositionAdminCapV6Ready
    && compositionAdminCapV6OwnerReady
    && compositionValidatorCapV6Ready
    && compositionValidatorCapV6OwnerReady
    && compositionValidatorEpochV6Ready
    && compositionValidatorPolicyCommitmentV6Ready;
  const compositionV6BindingConfigured = Boolean(
    config.compositionV6SoulOwnerProofType,
  );
  if (typeof config.compositionV6ReleaseEnabled !== 'boolean') {
    errors.push('compositionV6ReleaseEnabled must be a boolean release gate.');
  }
  if (typeof config.physicalStyleV7ReleaseEnabled !== 'boolean') {
    errors.push('physicalStyleV7ReleaseEnabled must be a boolean release gate.');
  }
  const physicalV7Fields = [
    'physicalV7CallablePackageId',
    'physicalV7TypeOriginPackageId',
    'physicalProtocolConfigV7Id',
    'physicalRegistryV7Id',
    'physicalAdminCapV7Id',
    'physicalAdminCapV7Owner',
    'physicalV7SoulOwnerProofTypeOriginPackageId',
  ];
  const physicalV7Configured = physicalV7Fields.some((field) => Boolean(config[field]))
    || Boolean(config.physicalV7SoulOwnerProofType);
  const invalidPhysicalV7Ids = physicalV7Fields.filter((field) => (
    config[field] && !SUI_ID.test(String(config[field]))
  ));
  invalidPhysicalV7Ids.forEach((field) => errors.push(`${field} must be a valid Sui object, package or owner ID.`));
  let physicalV7SoulOwnerProofReady = false;
  try {
    const proof = normalizeStructTag(String(config.physicalV7SoulOwnerProofType || '').trim());
    const origin = String(config.physicalV7SoulOwnerProofTypeOriginPackageId || '').toLowerCase();
    const expected = origin
      ? normalizeStructTag(
        `${origin}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
      )
      : '';
    physicalV7SoulOwnerProofReady = Boolean(proof && expected && proof === expected);
  } catch {
    physicalV7SoulOwnerProofReady = false;
  }
  const physicalV7CoreReady = physicalV7Fields.every((field) => SUI_ID.test(String(config[field] || '')))
    && physicalV7SoulOwnerProofReady;
  if (physicalV7Configured && !physicalV7CoreReady) {
    errors.push('Physical Style Assets v7 configuration must include its companion callable package, TypeOrigin, Config, Registry, AdminCap custody and the exact v6 Soulidity owner-proof type together.');
  }
  if (config.physicalStyleV7ReleaseEnabled && (
    config.compositionV6ReleaseEnabled !== true
    || config.commerceV5ReleaseEnabled !== true
    || config.canonicalSoulMintEnabled !== true
    || !physicalV7CoreReady
  )) {
    errors.push('Physical Style Assets v7 requires Composable Assets v6, active canonical Soul mint, Commerce v5, and the complete reviewed v7 object/proof tuple.');
  }
  if (config.compositionV6TypeOriginPackageId && !compositionV6TypeOriginPackageReady) {
    errors.push('compositionV6TypeOriginPackageId must be a valid Sui package ID.');
  }
  if (config.compositionProtocolConfigV6Id && !compositionProtocolConfigV6Ready) {
    errors.push('compositionProtocolConfigV6Id must be a valid Sui object ID.');
  }
  if (config.compositionProtocolTreasuryV6Id && !compositionProtocolTreasuryV6Ready) {
    errors.push('compositionProtocolTreasuryV6Id must be a valid Sui object ID.');
  }
  if (config.compositionRegistryV6Id && !compositionRegistryV6Ready) {
    errors.push('compositionRegistryV6Id must be a valid Sui object ID.');
  }
  if (config.compositionAdminCapV6Id && !compositionAdminCapV6Ready) {
    errors.push('compositionAdminCapV6Id must be a valid Sui object ID.');
  }
  if (config.compositionAdminCapV6Owner && !compositionAdminCapV6OwnerReady) {
    errors.push('compositionAdminCapV6Owner must be a valid Sui address.');
  }
  if (config.compositionValidatorCapV6Id && !compositionValidatorCapV6Ready) {
    errors.push('compositionValidatorCapV6Id must be a valid Sui object ID.');
  }
  if (config.compositionValidatorCapV6Owner && !compositionValidatorCapV6OwnerReady) {
    errors.push('compositionValidatorCapV6Owner must be a valid Sui address.');
  }
  if (config.compositionValidatorEpochV6 !== '' && !compositionValidatorEpochV6Ready) {
    errors.push('compositionValidatorEpochV6 must be a non-negative safe integer.');
  }
  if (config.compositionValidatorPolicyCommitmentV6
    && !compositionValidatorPolicyCommitmentV6Ready) {
    errors.push('compositionValidatorPolicyCommitmentV6 must be an exact 32-byte 0x-prefixed hex value.');
  }
  if (config.compositionV6SoulOwnerProofTypeOriginPackageId
    && !compositionV6SoulOwnerProofTypeOriginPackageReady) {
    errors.push('compositionV6SoulOwnerProofTypeOriginPackageId must be a valid Sui package ID.');
  }
  if (
    config.compositionV6SoulOwnerProofType
    && !compositionV6SoulOwnerProofReady
  ) {
    errors.push('compositionV6SoulOwnerProofType must be the exact AnimacraftSoulOwnerProofV6 defined by compositionV6SoulOwnerProofTypeOriginPackageId.');
  }
  if (
    (compositionV6CoreConfigured || compositionV6BindingConfigured)
    && !compositionV6CoreReady
  ) {
    errors.push('Composable Assets v6 core configuration must include its stable TypeOrigin, full object/cap custody tuple, validator epoch, and policy commitment together.');
  }
  if (
    config.compositionV6ReleaseEnabled
    && (!compositionV6CoreReady
      || !compositionV6SoulOwnerProofTypeOriginPackageReady
      || !compositionV6SoulOwnerProofReady)
  ) {
    errors.push('Composable Assets v6 cannot be released before its complete object/cap custody tuple, validator policy, and exact Soulidity owner-proof type are configured.');
  }
  if (
    config.compositionV6ReleaseEnabled
    && (
      config.commerceV5ReleaseEnabled !== true
      || config.canonicalSoulMintEnabled !== true
      || !soulidityReady
      || !souliditySealNamespaceReady
      || !compositionV6SoulOwnerProofTypeOriginPackageReady
    )
  ) {
    errors.push('Composable Assets v6 requires active Commerce v5, canonical Soul minting, and the reviewed Soulidity v6 appearance adapter.');
  }

  const sealV5CallablePackageId = resolveSealV5CallablePackageId(config);
  const sealV5TypeOriginPackageId = resolveSealV5TypeOriginPackageId(config);
  const sealV5CallablePackageReady = SUI_ID.test(sealV5CallablePackageId);
  const sealV5TypeOriginPackageReady = SUI_ID.test(sealV5TypeOriginPackageId);
  const sealServers = Array.isArray(config.sealKeyServers)
    ? config.sealKeyServers
    : [];
  const sealServerIds = new Set();
  let sealTotalWeight = 0;
  let sealServersReady = sealServers.length > 0 && sealServers.length <= 32;
  for (const [index, server] of sealServers.entries()) {
    const objectId = String(server?.objectId || '');
    const weight = Number(server?.weight);
    const apiKeyName = String(server?.apiKeyName || '').trim();
    const apiKey = String(server?.apiKey || '').trim();
    const aggregatorUrl = String(server?.aggregatorUrl || '');
    if (
      !SUI_ID.test(objectId)
      || sealServerIds.has(objectId.toLowerCase())
      || !Number.isSafeInteger(weight)
      || weight < 1
      || weight > 255
      || !validHttpsUrl(aggregatorUrl)
      || Boolean(apiKeyName) !== Boolean(apiKey)
    ) {
      sealServersReady = false;
    }
    if (
      aggregatorUrl === 'https://seal-aggregator-mainnet.mystenlabs.com'
      && (apiKeyName !== 'X-API-Key' || !apiKey || /YOUR_|TODO/i.test(apiKey))
    ) {
      sealServersReady = false;
    }
    if (!SUI_ID.test(objectId)) {
      errors.push(`sealKeyServers[${index}].objectId must be a valid Sui object ID.`);
    }
    if (!validHttpsUrl(aggregatorUrl)) {
      errors.push(`sealKeyServers[${index}].aggregatorUrl must be a valid HTTPS URL.`);
    }
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > 255) {
      errors.push(`sealKeyServers[${index}].weight must be an integer from 1 to 255.`);
    }
    if (sealServerIds.has(objectId.toLowerCase())) {
      errors.push('Seal key server object IDs must be unique.');
    }
    if (Boolean(apiKeyName) !== Boolean(apiKey)) {
      errors.push(`sealKeyServers[${index}] must configure apiKeyName and apiKey together.`);
    }
    if (
      aggregatorUrl === 'https://seal-aggregator-mainnet.mystenlabs.com'
      && (apiKeyName !== 'X-API-Key' || !apiKey || /YOUR_|TODO/i.test(apiKey))
    ) {
      errors.push('The Mainnet Seal aggregator requires a real Enoki X-API-Key credential.');
    }
    if (SUI_ID.test(objectId)) sealServerIds.add(objectId.toLowerCase());
    if (Number.isSafeInteger(weight) && weight > 0) sealTotalWeight += weight;
  }
  const sealThreshold = Number(config.sealThreshold);
  const sealThresholdReady = Number.isSafeInteger(sealThreshold)
    && sealThreshold >= 1
    && sealThreshold <= sealTotalWeight;
  const sealTimeoutMs = Number(config.sealTimeoutMs);
  if (
    !Number.isSafeInteger(sealTimeoutMs)
    || sealTimeoutMs < 1_000
    || sealTimeoutMs > 60_000
  ) {
    errors.push('sealTimeoutMs must be an integer from 1000 to 60000.');
  }
  if (typeof config.sealVerifyKeyServers !== 'boolean') {
    errors.push('sealVerifyKeyServers must be a boolean.');
  }
  const sealConfigured = Boolean(
    sealV5CallablePackageId
      || sealV5TypeOriginPackageId
      || sealServers.length
      || Number(config.sealThreshold) > 0,
  );
  if (sealV5CallablePackageId && !sealV5CallablePackageReady) {
    errors.push('sealV5CallablePackageId must be a valid Sui package ID.');
  }
  if (sealV5TypeOriginPackageId && !sealV5TypeOriginPackageReady) {
    errors.push('sealV5TypeOriginPackageId must be a valid Sui package ID.');
  }
  if (
    sealV5TypeOriginPackageReady
    && commerceV5TypeOriginPackageReady
    && sealV5TypeOriginPackageId !== String(config.commerceV5TypeOriginPackageId)
  ) {
    errors.push('sealV5TypeOriginPackageId must match the stable Commerce v5 TypeOrigin package.');
  }
  if (sealConfigured && (
    !sealV5CallablePackageReady
    || !sealV5TypeOriginPackageReady
    || !sealServersReady
    || !sealThresholdReady
  )) {
    errors.push('Seal v5 configuration must include its callable package, stable TypeOrigin, authenticated key servers, and a valid outer weight threshold.');
  }
  if (
    config.commerceV5ReleaseEnabled
    && (
      !sealV5CallablePackageReady
      || !sealV5TypeOriginPackageReady
      || !sealServersReady
      || !sealThresholdReady
    )
  ) {
    errors.push('Commerce v5 cannot be released before paid Base/Pack Seal protection is configured.');
  }

  if (!MOVE_TYPE.test(String(config.paymentCoinType || ''))) errors.push('paymentCoinType is not a valid Sui Move coin type.');
  if (config.paymentCoinType !== SUI_MAINNET_USDC_TYPE) errors.push('Mainnet Maker payments must use Circle native Sui USDC.');
  if (config.paymentCoinSymbol !== 'USDC' || Number(config.paymentCoinDecimals) !== 6) errors.push('USDC symbol and decimals must be USDC / 6.');
  if (!Number.isSafeInteger(Number(config.walrusRelayMaxTipMist))
    || Number(config.walrusRelayMaxTipMist) < 0
    || Number(config.walrusRelayMaxTipMist) > ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST) {
    errors.push(`walrusRelayMaxTipMist must be a non-negative safe integer no greater than ${ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST}.`);
  }
  if (!Number.isInteger(Number(config.walrusEpochs)) || Number(config.walrusEpochs) < 1 || Number(config.walrusEpochs) > 53) errors.push('walrusEpochs must be an integer from 1 to 53.');

  Object.entries(config.featuredMakers || {}).forEach(([key, objectId]) => {
    if (!key || !SUI_ID.test(String(objectId || ''))) errors.push(`featuredMakers.${key || '<empty>'} must be a valid Sui object id.`);
  });

  return {
    valid: errors.length === 0,
    packageReady,
    callablePackageReady,
    originalPackageReady,
    soulidityReady,
    souliditySealNamespaceReady,
    soulidityTypeOriginReady,
    protocolFeePackageReady,
    protocolFeeConfigReady,
    protocolTreasuryReady,
    protocolFeeAdminCapReady,
    protocolFeeAdminCapOwnerReady,
    commerceV5TypeOriginPackageReady,
    commerceProtocolConfigV5Ready,
    commerceProtocolTreasuryV5Ready,
    commerceV5LogicalAuxiliaryBlobReady,
    commerceV5SoulBindingProofReady,
    compositionV6TypeOriginPackageReady,
    compositionProtocolConfigV6Ready,
    compositionProtocolTreasuryV6Ready,
    compositionRegistryV6Ready,
    compositionAdminCapV6Ready,
    compositionAdminCapV6OwnerReady,
    compositionValidatorCapV6Ready,
    compositionValidatorCapV6OwnerReady,
    compositionValidatorEpochV6Ready,
    compositionValidatorPolicyCommitmentV6Ready,
    compositionV6SoulOwnerProofTypeOriginPackageReady,
    compositionV6SoulOwnerProofReady,
    physicalV7CoreReady,
    physicalV7SoulOwnerProofReady,
    // Retain the old result name for downstream status UI while exposing the
    // two independently verified identities.
    sealV5PackageReady: sealV5CallablePackageReady,
    sealV5CallablePackageReady,
    sealV5TypeOriginPackageReady,
    sealServersReady,
    sealThresholdReady,
    errors,
    warnings,
  };
}
