import { assertMakerV8SealEncryptionProfile } from './maker-v8-seal-profile.js';
import { assertMakerV8ProtectedAssetIdentityV8, assertMakerV8ProtectedRenderIdentityV8 } from './maker-v8-protected-transport.js';
import { attestMakerV8Runtime } from './maker-v8-chain.js';

const HASH = /^[0-9a-f]{64}$/;
const ID = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.name = 'AnimacraftProtectedIdentityError';
  error.code = code;
  error.status = status;
  throw error;
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function id(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} is not one exact Sui ID.`, 409);
  }
  return normalized;
}

function decimal(value, label) {
  const normalized = String(value ?? '');
  if (!DECIMAL.test(normalized)) {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} is not one canonical integer.`, 409);
  }
  return normalized;
}

function hash(value, label) {
  if (typeof value === 'string' && HASH.test(value)) return value;
  const raw = Array.isArray(value)
    ? value
    : value instanceof Uint8Array ? [...value] : null;
  if (!raw || raw.length !== 32
    || raw.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} is not one exact 32-byte commitment.`, 409);
  }
  const result = raw.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (/^0+$/.test(result)) {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} cannot be zero.`, 409);
  }
  return result;
}

function fields(value, label) {
  const resolved = plain(value?.fields) ? value.fields : value;
  if (!plain(resolved)) {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} has no exact Move fields.`, 409);
  }
  return resolved;
}

function moveOption(value, label) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length > 1) fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} is not one Move Option.`, 409);
    return value.length ? value[0] : null;
  }
  if (plain(value) && Array.isArray(value.vec)) return moveOption(value.vec, label);
  if (plain(value?.fields) && Array.isArray(value.fields.vec)) return moveOption(value.fields.vec, label);
  if (typeof value === 'string') return value;
  if (!plain(value)) {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} is not one exact Move Option.`, 409);
  }
  return fields(value, label);
}

function moveObject(response, expectedId, expectedType, label) {
  const data = response?.data;
  if (!plain(data) || data.objectId !== expectedId
    || String(data.type ?? data.content?.type).replace(/\s+/g, '') !== expectedType
    || data.content?.dataType !== 'moveObject') {
    fail('ANIMACRAFT_PROTECTED_OBJECT_INVALID', `${label} is not the exact current Move object.`, 409);
  }
  return fields(data.content.fields, `${label}.fields`);
}

function keyServers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    fail('ANIMACRAFT_PROTECTED_POLICY_UNSUPPORTED', 'Seal policy needs a bounded authenticated key set.', 409);
  }
  const seen = new Set();
  const rows = value.map((value, index) => {
    const row = fields(value, `SealPolicy.keyServers[${index}]`);
    const objectId = id(row.key_server_id, 'SealPolicy.keyServerId');
    const weight = Number(decimal(row.weight, 'SealPolicy.weight'));
    if (seen.has(objectId) || !Number.isSafeInteger(weight) || weight < 1 || weight > 254) {
      fail('ANIMACRAFT_PROTECTED_POLICY_UNSUPPORTED', 'Seal policy key set is invalid.', 409);
    }
    seen.add(objectId);
    return { objectId, weight };
  });
  if (rows.reduce((sum, row) => sum + row.weight, 0) >= 255) {
    fail('ANIMACRAFT_PROTECTED_POLICY_UNSUPPORTED', 'Seal policy total weight is invalid.', 409);
  }
  return rows;
}

export function createAnimacraftV8ProtectedIdentityVerifier({ runtime: runtimeInput, transport } = {}) {
  if (typeof transport?.getObject !== 'function') {
    fail('ANIMACRAFT_PROTECTED_TRANSPORT_INVALID', 'Authoritative Sui gRPC transport is required.', 500);
  }
  return async (value) => {
    const identity = assertMakerV8ProtectedRenderIdentityV8(value);
    const authority = await attestMakerV8Runtime(transport, runtimeInput);
    const { runtime } = authority;
    const rootType = `${runtime.roles.core.typeOriginPackageId}::maker_v8::MakerRootV8<${runtime.paymentCoinType}>`;
    const registryType = `${runtime.roles.seal.typeOriginPackageId}::seal_v8::SealRegistryV8`;
    if (identity.releasePackageId !== runtime.roles.release.typeOriginPackageId
      || identity.sealPolicyConfigId !== runtime.roleConfigIds.seal) {
      fail('ANIMACRAFT_PROTECTED_RUNTIME_DRIFT', 'Protected identity differs from the approved runtime.', 409);
    }
    const options = { showType: true, showContent: true, showOwner: true };
    const [rootResponse, registryResponse] = await Promise.all([
      transport.getObject({ id: identity.rootId, options }),
      transport.getObject({ id: identity.sealRegistryId, options }),
    ]);
    const root = moveObject(rootResponse, identity.rootId, rootType, 'MakerRootV8');
    const policy = authority.configs.seal.authorityFields;
    const registry = moveObject(
      registryResponse, identity.sealRegistryId, registryType, 'SealRegistryV8',
    );
    const content = fields(root.content, 'MakerRoot.content');
    const publication = fields(root.publication, 'MakerRoot.publication');
    const economics = fields(root.economics, 'MakerRoot.economics');
    const binding = moveOption(publication.registry_ids, 'MakerRoot.publication.registryIds');
    const commitments = fields(moveOption(publication.release_commitments, 'MakerRoot.publication.releaseCommitments'), 'MakerRoot.releaseCommitments');
    hash(moveOption(publication.sealed_base_registry_commitment, 'MakerRoot.sealedBase'), 'MakerRoot.sealedBase');
    if (decimal(root.version, 'MakerRoot.version') !== '8'
      || id(root.id, 'MakerRoot.id') !== identity.rootId
      || !plain(rootResponse.data.owner?.Shared)
      || id(root.core_original_package_id, 'MakerRoot.coreOriginal') !== runtime.roles.core.typeOriginPackageId
      || id(root.core_callable_package_id, 'MakerRoot.coreCallable') !== runtime.roles.core.callablePackageId
      || id(economics.protocol_config_id, 'MakerRoot.protocolConfig') !== runtime.protocolConfigId
      || id(economics.protocol_treasury_id, 'MakerRoot.protocolTreasury') !== runtime.protocolTreasuryId
      || id(moveOption(publication.catalog_id, 'MakerRoot.catalogId'), 'MakerRoot.catalogId') !== runtime.catalogId
      || hash(commitments.product_binding_commitment, 'MakerRoot.productBinding') !== authority.catalog.productBindingCommitment
      || hash(commitments.call_cap_set_commitment, 'MakerRoot.callCapSet') !== authority.catalog.callCapSetCommitment
      || decimal(root.maker_version, 'MakerRoot.makerVersion') !== identity.makerVersion
      || hash(content.content_commitment, 'MakerRoot.contentCommitment') !== identity.rootContentCommitment
      || decimal(root.lifecycle, 'MakerRoot.lifecycle') !== '1'
      || binding === null
      || id(fields(binding, 'MakerRoot.registryIds').seal_registry_id, 'MakerRoot.sealRegistryId') !== identity.sealRegistryId) {
      fail('ANIMACRAFT_PROTECTED_ROOT_DRIFT', 'Maker Root no longer certifies the requested protected identity.', 409);
    }
    const servers = keyServers(policy.key_servers);
    const threshold = Number(decimal(policy.threshold, 'SealPolicy.threshold'));
    if (decimal(policy.version, 'SealPolicy.version') !== '8'
      || id(policy.seal_callable_package_id, 'SealPolicy.callablePackageId')
        !== runtime.roles.seal.callablePackageId
      || hash(policy.product_binding_commitment, 'SealPolicy.productBindingCommitment')
        !== identity.productBindingCommitment
      || hash(policy.commitment, 'SealPolicy.commitment') !== identity.policyCommitment
      || !Number.isSafeInteger(threshold) || threshold < 1
      || threshold > servers.reduce((sum, row) => sum + row.weight, 0)
      || id(registry.root_id, 'SealRegistry.rootId') !== identity.rootId
      || decimal(registry.maker_version, 'SealRegistry.makerVersion') !== identity.makerVersion
      || hash(registry.root_content_commitment, 'SealRegistry.rootContentCommitment')
        !== identity.rootContentCommitment
      || id(registry.policy_config_id, 'SealRegistry.policyConfigId') !== identity.sealPolicyConfigId
      || hash(registry.policy_commitment, 'SealRegistry.policyCommitment') !== identity.policyCommitment
      || decimal(registry.runtime_revision, 'SealRegistry.runtimeRevision')
        !== identity.sealRuntimeRevision) {
      fail('ANIMACRAFT_PROTECTED_SEAL_DRIFT', 'Seal policy or registry no longer certifies the requested identity.', 409);
    }
    const encryptionProfile = assertMakerV8SealEncryptionProfile({
      cipherSuite: policy.cipher_suite, keyDerivation: policy.key_derivation,
      ciphertextFormat: policy.ciphertext_format,
    });
    return { certified: true, identity, threshold, serverConfigs: servers, encryptionProfile,
      maxPlaintextBytes: Number(decimal(policy.max_plaintext_bytes, 'SealPolicy.maxPlaintextBytes')) };
  };
}

export function createAnimacraftV8ProtectedAssetIdentityVerifier({ runtime: runtimeInput, transport } = {}) {
  if (typeof transport?.getObject !== 'function') {
    fail('ANIMACRAFT_PROTECTED_TRANSPORT_INVALID', 'Authoritative Sui gRPC transport is required.', 500);
  }
  return async (value) => {
    const identity = assertMakerV8ProtectedAssetIdentityV8(value);
    const authority = await attestMakerV8Runtime(transport, runtimeInput);
    const { runtime } = authority;
    if (identity.releasePackageId !== runtime.roles.release.typeOriginPackageId
      || identity.sealPolicyConfigId !== runtime.roleConfigIds.seal) {
      fail('ANIMACRAFT_PROTECTED_RUNTIME_DRIFT', 'Protected publication identity differs from the approved runtime.', 409);
    }
    const policy = authority.configs.seal.authorityFields;
    const servers = keyServers(policy.key_servers);
    const threshold = Number(decimal(policy.threshold, 'SealPolicy.threshold'));
    if (decimal(policy.version, 'SealPolicy.version') !== '8'
      || id(policy.seal_callable_package_id, 'SealPolicy.callablePackageId')
        !== runtime.roles.seal.callablePackageId
      || hash(policy.product_binding_commitment, 'SealPolicy.productBindingCommitment')
        !== identity.productBindingCommitment
      || hash(policy.commitment, 'SealPolicy.commitment') !== identity.policyCommitment
      || !Number.isSafeInteger(threshold) || threshold < 1
      || threshold > servers.reduce((sum, row) => sum + row.weight, 0)) {
      fail('ANIMACRAFT_PROTECTED_SEAL_DRIFT', 'Seal policy no longer certifies the protected publication identity.', 409);
    }
    const encryptionProfile = assertMakerV8SealEncryptionProfile({
      cipherSuite: policy.cipher_suite, keyDerivation: policy.key_derivation,
      ciphertextFormat: policy.ciphertext_format,
    });
    return { certified: true, identity, threshold, serverConfigs: servers, encryptionProfile,
      maxPlaintextBytes: Number(decimal(policy.max_plaintext_bytes, 'SealPolicy.maxPlaintextBytes')) };
  };
}


