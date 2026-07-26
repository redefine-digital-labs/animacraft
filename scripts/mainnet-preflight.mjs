import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { normalizeRuntimeConfig, validateRuntimeConfig } from '../runtime-config.js';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const network = args.has('--network');
const requireSoulidity = args.has('--require-soulidity');
const json = args.has('--json');
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail: String(detail || '') });
}

function moveDatatypeName(parameter) {
  return String(parameter?.body?.datatype?.typeName || '');
}

function moveTypeEndsWith(parameter, suffix) {
  return moveDatatypeName(parameter).endsWith(suffix);
}

function moveTypeEquals(parameter, expectedType) {
  try {
    return normalizeStructTag(moveDatatypeName(parameter))
      === normalizeStructTag(expectedType);
  } catch {
    return false;
  }
}

function jsonField(value, ...names) {
  if (!value || typeof value !== 'object') return undefined;
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
}

function suiId(value) {
  if (typeof value === 'string') {
    try {
      return normalizeSuiAddress(value);
    } catch {
      return '';
    }
  }
  if (!value || typeof value !== 'object') return '';
  return suiId(value.id || value.bytes || value.address || value.fields);
}

function addressOwner(owner) {
  return suiId(owner?.AddressOwner || owner?.addressOwner || owner?.address || '');
}

function isSharedOwner(owner) {
  return owner?.$kind === 'Shared' || Boolean(owner?.Shared || owner?.shared);
}

function optionHasValue(value) {
  if (Array.isArray(value)) return value.length === 1;
  if (!value || typeof value !== 'object') return false;
  if (value.$kind === 'Some') return true;
  if (Object.hasOwn(value, 'Some')) return true;
  if (Array.isArray(value.vec)) return value.vec.length === 1;
  return false;
}

async function moveFunction(client, packageId, name) {
  const result = await client.core.getMoveFunction({
    packageId,
    moduleName: 'animacraft',
    name,
  });
  if (!result.function) throw new Error(`${name} ABI is missing.`);
  return result.function;
}

async function simulateProtocolVersion(client, packageId) {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::animacraft::protocol_version` });
  const result = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(result.FailedTransaction.status?.error?.message || 'protocol_version simulation failed.');
  }
  const bytes = result.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bytes || bytes.length !== 8) throw new Error('protocol_version did not return one BCS u64.');
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]);
  return Number(value);
}

async function checkAnimacraftAbi(client, packageId, protocolFeePackageId) {
  try {
    const protocolFeeTypeOrigin = normalizeSuiAddress(protocolFeePackageId);
    const protocolFeeConfigType =
      `${protocolFeeTypeOrigin}::animacraft::ProtocolFeeConfig`;
    const protocolTreasuryType =
      `${protocolFeeTypeOrigin}::animacraft::ProtocolTreasury`;
    const protocolFeeAdminCapType =
      `${protocolFeeTypeOrigin}::animacraft::ProtocolFeeAdminCap`;
    const canonicalAuthorizationType =
      `${protocolFeeTypeOrigin}::animacraft::CanonicalSoulMintAuthorization`;
    const [
      versionFn,
      initializeFn,
      legacyFreeFn,
      freeFn,
      paidFn,
      legacyConsumeFn,
      canonicalConsumeFn,
      version,
    ] = await Promise.all([
      moveFunction(client, packageId, 'protocol_version'),
      moveFunction(client, packageId, 'initialize_protocol_fees'),
      moveFunction(client, packageId, 'authorize_soul_mint'),
      moveFunction(client, packageId, 'authorize_soul_mint_with_protocol_gate'),
      moveFunction(client, packageId, 'authorize_soul_mint_paid_with_protocol_fee'),
      moveFunction(client, packageId, 'consume_soul_mint_authorization'),
      moveFunction(client, packageId, 'consume_canonical_soul_mint_authorization'),
      simulateProtocolVersion(client, packageId),
    ]);
    const abiReady = versionFn.parameters.length === 0
      && versionFn.returns.length === 1
      && versionFn.returns[0]?.body?.$kind === 'u64'
      && initializeFn.typeParameters.length === 1
      && initializeFn.parameters.length === 2
      && moveTypeEndsWith(initializeFn.parameters[0], '::package::Publisher')
      && initializeFn.returns.length === 1
      && moveTypeEquals(initializeFn.returns[0], protocolFeeAdminCapType)
      && legacyFreeFn.parameters.length === 9
      && freeFn.parameters.length === 10
      && moveTypeEndsWith(freeFn.parameters[0], '::animacraft::OCMaker')
      && moveTypeEquals(freeFn.parameters[1], protocolFeeConfigType)
      && freeFn.returns.length === 1
      && moveTypeEquals(freeFn.returns[0], canonicalAuthorizationType)
      && paidFn.typeParameters.length === 1
      && paidFn.parameters.length === 13
      && moveTypeEquals(paidFn.parameters[2], protocolFeeConfigType)
      && moveTypeEquals(paidFn.parameters[3], protocolTreasuryType)
      && paidFn.returns.length === 1
      && moveTypeEquals(paidFn.returns[0], canonicalAuthorizationType)
      && legacyConsumeFn.parameters.length === 1
      && moveTypeEndsWith(
        legacyConsumeFn.parameters[0],
        '::animacraft::SoulMintAuthorization',
      )
      && canonicalConsumeFn.parameters.length === 1
      && moveTypeEquals(
        canonicalConsumeFn.parameters[0],
        canonicalAuthorizationType,
      );
    record(
      'Animacraft v4 ABI',
      abiReady && version === 4,
      abiReady
        ? `protocol_version=${version}; canonical authorization TypeOrigin=${protocolFeeTypeOrigin}; gated free + paid ABI verified`
        : 'Required v4 canonical authorization shape or TypeOrigin differs.',
    );
  } catch (error) {
    record('Animacraft v4 ABI', false, error.message);
  }
}

async function checkProtocolFeeObjects(client, config, validation) {
  const configured = [
    config.protocolFeeConfigId,
    config.protocolTreasuryId,
    config.protocolFeeAdminCapId,
    config.protocolFeeAdminCapOwner,
  ].filter(Boolean);
  if (!configured.length) {
    if (config.canonicalSoulMintEnabled) {
      record('Animacraft protocol objects', false, 'Canonical minting is enabled without recorded protocol objects.');
    }
    return;
  }
  if (!validation.protocolFeeConfigReady
    || !validation.protocolTreasuryReady
    || !validation.protocolFeeAdminCapReady
    || !validation.protocolFeeAdminCapOwnerReady
    || !validation.protocolFeePackageReady) {
    record('Animacraft protocol objects', false, 'Protocol TypeOrigin, object IDs, and expected AdminCap owner must be recorded together.');
    return;
  }
  try {
    const result = await deadline('Animacraft protocol objects', () => client.core.getObjects({
      objectIds: [
        config.protocolFeeConfigId,
        config.protocolTreasuryId,
        config.protocolFeeAdminCapId,
      ],
      include: { json: true },
    }));
    const [configObject, treasuryObject, adminObject] = result.objects;
    if ([configObject, treasuryObject, adminObject].some((object) => object instanceof Error)) {
      throw new Error(result.objects.filter((object) => object instanceof Error).map((error) => error.message).join('; '));
    }
    const typeOrigin = normalizeSuiAddress(config.protocolFeePackageId);
    const configType = normalizeStructTag(`${typeOrigin}::animacraft::ProtocolFeeConfig`);
    const treasuryType = normalizeStructTag(
      `${typeOrigin}::animacraft::ProtocolTreasury<${normalizeStructTag(config.paymentCoinType)}>`,
    );
    const adminType = normalizeStructTag(`${typeOrigin}::animacraft::ProtocolFeeAdminCap`);
    const configJson = configObject.json || {};
    const treasuryJson = treasuryObject.json || {};
    const adminJson = adminObject.json || {};
    const configId = normalizeSuiAddress(config.protocolFeeConfigId);
    const treasuryId = normalizeSuiAddress(config.protocolTreasuryId);
    const adminOwner = normalizeSuiAddress(config.protocolFeeAdminCapOwner);
    const enabled = Boolean(jsonField(configJson, 'enabled'));
    const feeBps = Number(jsonField(configJson, 'primary_mint_fee_bps', 'primaryMintFeeBps'));
    const ready = normalizeStructTag(configObject.type) === configType
      && normalizeStructTag(treasuryObject.type) === treasuryType
      && normalizeStructTag(adminObject.type) === adminType
      && isSharedOwner(configObject.owner)
      && isSharedOwner(treasuryObject.owner)
      && addressOwner(adminObject.owner) === adminOwner
      && suiId(jsonField(configJson, 'treasury_id', 'treasuryId')) === treasuryId
      && suiId(jsonField(treasuryJson, 'config_id', 'configId')) === configId
      && suiId(jsonField(adminJson, 'config_id', 'configId')) === configId
      && suiId(jsonField(adminJson, 'treasury_id', 'treasuryId')) === treasuryId
      && Number(jsonField(configJson, 'version')) === 4
      && Number(jsonField(treasuryJson, 'version')) === 4
      && Number(jsonField(adminJson, 'version')) === 4
      && feeBps === Number(config.primaryProtocolFeeBps)
      && enabled === Boolean(config.canonicalSoulMintEnabled)
      && optionHasValue(jsonField(adminJson, 'publisher'));
    record(
      'Animacraft protocol objects',
      ready,
      `TypeOrigin=${typeOrigin}; USDC treasury; fee=${feeBps} bps; gate=${enabled}; AdminCap owner=${addressOwner(adminObject.owner) || 'unknown'}`,
    );
  } catch (error) {
    record('Animacraft protocol objects', false, error.message);
  }
}

async function deadline(label, task, timeout = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeout);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function loadPublicConfig() {
  const source = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename: 'public/config.js' }).runInContext(context, { timeout: 1_000 });
  return normalizeRuntimeConfig(context.window.ANIMACRAFT_CONFIG || {});
}

async function checkHttp(name, url, path) {
  try {
    const response = await deadline(name, (signal) => fetch(`${String(url).replace(/\/$/, '')}${path}`, { signal }));
    record(name, response.ok, `HTTP ${response.status}`);
  } catch (error) {
    record(name, false, error.message);
  }
}

async function checkNetwork(config, validation) {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: config.grpcUrl });
  try {
    const result = await deadline('Sui gRPC', () => client.core.getChainIdentifier());
    record('Sui gRPC', Boolean(result.chainIdentifier), result.chainIdentifier || 'Missing chain identifier');
  } catch (error) {
    record('Sui gRPC', false, error.message);
  }

  try {
    const makerEventType = validation.originalPackageReady
      ? `${config.originalPackageId}::animacraft::OCMakerPublished`
      : null;
    const query = makerEventType
      ? `query PublishedAnimacraftMakers($type: String!) {
          chainIdentifier
          events(filter: { type: $type }, last: 1) {
            pageInfo { hasPreviousPage startCursor }
            nodes { contents { json } }
          }
        }`
      : '{ chainIdentifier }';
    const response = await deadline('Sui GraphQL', (signal) => fetch(config.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(makerEventType ? { variables: { type: makerEventType } } : {}),
      }),
      signal,
    }));
    const body = await response.json();
    const eventQueryReady = !makerEventType || Array.isArray(body.data?.events?.nodes);
    const detail = body.errors?.[0]?.message
      || (body.data?.chainIdentifier
        ? `${body.data.chainIdentifier}${makerEventType ? '; Maker event query OK' : ''}`
        : `HTTP ${response.status}`);
    record(
      'Sui GraphQL',
      response.ok && Boolean(body.data?.chainIdentifier) && eventQueryReady && !body.errors?.length,
      detail,
    );
  } catch (error) {
    record('Sui GraphQL', false, error.message);
  }

  await Promise.all([
    checkHttp('Walrus aggregator', config.walrusAggregatorUrl, '/v1/api'),
    checkHttp('Walrus upload relay', config.walrusUploadRelayUrl, '/v1/tip-config'),
    ...(requireSoulidity
      ? [checkHttp('Soulidity Animacraft route', config.soulidityAppUrl, config.soulidityIntegrationPath)]
      : []),
  ]);

  if (validation.callablePackageReady) {
    await checkAnimacraftAbi(
      client,
      config.callablePackageId,
      config.protocolFeePackageId,
    );
  }
  await checkProtocolFeeObjects(client, config, validation);

  if (validation.soulidityReady) {
    const soulidityMintFunction = (requireSoulidity || config.canonicalSoulMintEnabled)
      ? 'mint_animacraft_in_personal_kiosk'
      : 'mint_imported_in_personal_kiosk';
    try {
      const result = await deadline('Soulidity package', () => client.core.getMoveFunction({
        packageId: config.soulidityPackageId,
        moduleName: 'market',
        name: soulidityMintFunction,
      }));
      record(
        'Soulidity package',
        result.function?.name === soulidityMintFunction,
        `${config.soulidityPackageId}::market::${soulidityMintFunction}`,
      );
    } catch (error) {
      record('Soulidity package', false, error.message);
    }
  }

  const featuredIds = Object.values(config.featuredMakers || {});
  if (featuredIds.length) {
    try {
      const result = await deadline('Featured Makers', () => client.getObjects({ objectIds: featuredIds, include: { json: true } }));
      const failures = result.objects.filter((object) => object instanceof Error);
      record('Featured Makers', failures.length === 0, failures.length ? failures.map((error) => error.message).join('; ') : `${result.objects.length} object(s)`);
    } catch (error) {
      record('Featured Makers', false, error.message);
    }
  }
}

const config = await loadPublicConfig();
const validation = validateRuntimeConfig(config, { strict, requireSoulidity });
validation.errors.forEach((message) => record('Runtime config', false, message));
validation.warnings.forEach((message) => record('Runtime config warning', true, message));
if (!validation.errors.length) record('Runtime config', true, strict ? 'Strict production fields are complete.' : 'Source configuration is structurally valid.');
if (network) await checkNetwork(config, validation);

const failed = checks.filter((check) => !check.ok);
if (json) {
  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, strict, network, checks }, null, 2)}\n`);
} else {
  checks.forEach((check) => process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}\n`));
  process.stdout.write(`\n${failed.length ? `${failed.length} preflight check(s) failed.` : 'Animacraft preflight passed.'}\n`);
}
process.exitCode = failed.length ? 1 : 0;
