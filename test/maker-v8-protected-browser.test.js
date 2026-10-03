import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { toBase64 } from '@mysten/sui/utils';
import { EncryptedObject } from '@mysten/seal';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE } from '../maker-v8-seal-profile.js';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';

import { createProductionMakerV8ProtectedTransportV8 } from '../maker-v8-protected-transport.js';
const ANIMACRAFT_V8_MAINNET_SEAL_COMMITTEE = `0x${'90'.repeat(32)}`;
import {
  MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
  MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA,
  MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
} from '../maker-v8-protected-transport.js';
import { MAKER_V8_PAYMENT_COIN_TYPE } from '../maker-v8-runtime.js';

const id = (value) => `0x${value.toString(16).padStart(64, '0')}`;
const hash = (value) => value.repeat(64);
const bytes32 = (value) => Array.from({ length: 32 }, () => value);
const hex = (bytes) => [...bytes]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const SIGNER = id(40);

function ciphertext({ packageId, sealId, aad }) {
  return EncryptedObject.serialize({
    version: 0,
    packageId,
    id: sealId,
    services: [[ANIMACRAFT_V8_MAINNET_SEAL_COMMITTEE, 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96).fill(7),
        encryptedShares: [new Uint8Array(32).fill(8)],
        encryptedRandomness: new Uint8Array(32).fill(9),
      },
    },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(20).fill(9), aad } },
  }).toBytes();
}

function runtime() {
  const roles = Object.fromEntries(
    ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
      .map((role, index) => [role, {
        typeOriginPackageId: id(index + 1),
        callablePackageId: role === 'release' ? id(107) : id(index + 1),
      }]),
  );
  return {
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled: true,
    catalogId: id(20),
    protocolConfigId: id(21),
    protocolTreasuryId: id(22),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: id(6),
    roles,
    roleConfigIds: {
      seal: id(30), runtime: id(31), output: id(32),
      physical: id(33), market: id(34), release: id(35),
    },
    makerBindings: [],
  };
}

function identity(rt = runtime()) {
  const authority = currentRuntimeAuthorityFixture(rt, { keyServerRows: [{ key_server_id: ANIMACRAFT_V8_MAINNET_SEAL_COMMITTEE, weight: 1 }] });
  const policy = authority.objects.get(rt.roleConfigIds.seal).data.content.fields;
  return {
    schemaVersion: 'animacraft.maker-v8-protected-render-identity.v1',
    rootId: id(50), makerVersion: '1', rootContentCommitment: hash('1'),
    signer: SIGNER, outputKey: 'portrait', scopeKey: 'complete/portrait',
    assetKey: `receipt-${SIGNER.slice(2)}-0`,
    releasePackageId: rt.roles.release.typeOriginPackageId,
    productBindingCommitment: hex(policy.product_binding_commitment), policyCommitment: hex(policy.commitment),
    sealPolicyConfigId: rt.roleConfigIds.seal, sealRegistryId: id(51),
    sealRuntimeRevision: '0',
  };
}

function object(objectId, type, fields) {
  return {
    data: {
      objectId,
      owner: { Shared: { initial_shared_version: '1' } },
      type,
      content: { dataType: 'moveObject', type, fields },
    },
  };
}

function transportFixture(rt, proof, mutate = null) {
  const authority = currentRuntimeAuthorityFixture(rt, { keyServerRows: [{ key_server_id: ANIMACRAFT_V8_MAINNET_SEAL_COMMITTEE, weight: 1 }] });
  const rootType = `${rt.roles.core.typeOriginPackageId}::maker_v8::MakerRootV8<${rt.paymentCoinType}>`;
  const policyType = `${rt.roles.seal.typeOriginPackageId}::seal_v8::SealPolicyConfigV8`;
  const registryType = `${rt.roles.seal.typeOriginPackageId}::seal_v8::SealRegistryV8`;
  const rows = new Map([
    [proof.rootId, object(proof.rootId, rootType, {
      id: proof.rootId,
      version: '8', maker_version: proof.makerVersion,
      lifecycle: '1',
      core_original_package_id: rt.roles.core.typeOriginPackageId,
      core_callable_package_id: rt.roles.core.callablePackageId,
      content: { content_commitment: bytes32(0x11) },
      economics: { protocol_config_id: rt.protocolConfigId, protocol_treasury_id: rt.protocolTreasuryId },
      publication: { catalog_id: { vec: [rt.catalogId] },
        registry_ids: { vec: [{ seal_registry_id: proof.sealRegistryId }] },
        sealed_base_registry_commitment: { vec: [bytes32(1)] },
        release_commitments: { vec: [{ product_binding_commitment: authority.replacement.package_tuple_commitment,
          call_cap_set_commitment: authority.replacement.call_cap_set_commitment }] },
      },
    })],
    [proof.sealPolicyConfigId, authority.objects.get(proof.sealPolicyConfigId)],
    [proof.sealRegistryId, object(proof.sealRegistryId, registryType, {
      id: proof.sealRegistryId,
      root_id: proof.rootId, maker_version: proof.makerVersion,
      root_content_commitment: bytes32(0x11),
      policy_config_id: proof.sealPolicyConfigId,
      policy_commitment: proof.policyCommitment, runtime_revision: proof.sealRuntimeRevision,
    })],
  ]);
  if (mutate) mutate(rows);
  authority.sync(proof.sealPolicyConfigId);
  return { ...authority.rpc, async getObject(input) {
    return rows.has(input.id) ? structuredClone(rows.get(input.id)) : authority.rpc.getObject(input);
  } };
}

function response() {
  const state = { headers: {}, body: null, statusCode: 0 };
  return {
    state,
    set statusCode(value) { state.statusCode = value; },
    get statusCode() { return state.statusCode; },
    setHeader(name, value) { state.headers[name] = value; },
    end(value) { state.body = value; },
  };
}

function requestBody(proof) {
  const plaintext = Uint8Array.from([1, 2, 3, 4]);
  return {
    schemaVersion: MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA,
    identity: proof,
    render: {
      mediaType: 'image/png', bytesBase64: toBase64(plaintext),
      byteLength: plaintext.length, sha256: hex(sha256(plaintext)),
    },
  };
}

test('protected render browser re-reads exact Root/Seal state before official Seal encryption', async () => {
  const rt = runtime();
  const proof = identity(rt);
  let servers = null;
  let encryptInput = null;
  const handler = createBrowserTestInvocation({
    runtime: rt,
    transport: transportFixture(rt, proof),
    async createSealClient({ serverConfigs: value }) {
      servers = value;
      return {
        async encrypt(input) {
          encryptInput = input;
          return {
            encryptedObject: ciphertext({
              packageId: input.packageId,
              sealId: input.id,
              aad: input.aad,
            }),
            key: new Uint8Array(32),
          };
        },
      };
    },
  });
  const res = response();
  await handler({ method: 'POST', body: requestBody(proof) }, res);
  assert.equal(res.state.statusCode, 200);
  const result = JSON.parse(res.state.body);
  assert.equal(result.packageId, rt.roles.release.typeOriginPackageId);
  assert.deepEqual(servers, [{ objectId: ANIMACRAFT_V8_MAINNET_SEAL_COMMITTEE, weight: 1 }]);
  assert.equal(encryptInput.threshold, 1);
  assert.equal(Object.hasOwn(result, 'key'), false);
});

test('protected render browser rejects stale Root identity before Seal client construction', async () => {
  const rt = runtime();
  const proof = identity(rt);
  let sealCalls = 0;
  const handler = createBrowserTestInvocation({
    runtime: rt,
    transport: transportFixture(rt, proof, (rows) => {
      rows.get(proof.rootId).data.content.fields.maker_version = '2';
    }),
    async createSealClient() { sealCalls += 1; throw new Error('not reached'); },
  });
  const res = response();
  await handler({ method: 'POST', body: requestBody(proof) }, res);
  assert.equal(res.state.statusCode, 409);
  assert.equal(JSON.parse(res.state.body).code, 'ANIMACRAFT_PROTECTED_ROOT_DRIFT');
  assert.equal(sealCalls, 0);
});


test('protected render browser rejects each unsupported policy profile field before constructing Seal', async () => {
  for (const field of ['cipher_suite', 'key_derivation', 'ciphertext_format']) {
    const rt = runtime(); const proof = identity(rt);
    let calls = 0;
    const handler = createBrowserTestInvocation({ runtime: rt,
      transport: transportFixture(rt, proof, rows => {
        rows.get(proof.sealPolicyConfigId).data.content.fields[field] = 'unsupported';
      }),
      async createSealClient() { calls += 1; throw new Error('not reached'); },
    });
    const res = response();
    await handler({ method: 'POST', body: requestBody(proof) }, res);
    assert.equal(res.state.statusCode, 409);
    assert.equal(JSON.parse(res.state.body).code, 'MAKER_V8_SEAL_PROFILE_UNSUPPORTED');
    assert.equal(calls, 0);
  }
});

test('Complete and Pack publication use original Release namespace and reject callable substitution', async () => {
  for (const asset of [false, true]) {
    const rt = runtime(); const proof = identity(rt);
    const body = requestBody(proof);
    const request = asset ? { schemaVersion: MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA,
      identity: { schemaVersion: MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA, signer: proof.signer,
        scopeKind: 1, scopeKey: 'pack/example', assetKey: 'part/item/style',
        rootContentCommitment: proof.rootContentCommitment, makerVersion: proof.makerVersion,
        releasePackageId: proof.releasePackageId, productBindingCommitment: proof.productBindingCommitment,
        policyCommitment: proof.policyCommitment, sealPolicyConfigId: proof.sealPolicyConfigId,
        assetContentCommitment: body.render.sha256 }, asset: body.render } : body;
    let calls = 0;
    const handler = createBrowserTestInvocation({ runtime: rt, transport: transportFixture(rt, proof),
      async createSealClient() { calls += 1; return { async encrypt(input) {
        assert.equal(input.packageId, rt.roles.release.typeOriginPackageId);
        return { encryptedObject: ciphertext({ packageId: input.packageId, sealId: input.id, aad: input.aad }) };
      } }; },
    });
    const ok = response(); await handler({ method: 'POST', body: request }, ok);
    assert.equal(ok.state.statusCode, 200);
    request.identity.releasePackageId = rt.roles.release.callablePackageId;
    const wrong = response(); await handler({ method: 'POST', body: request }, wrong);
    assert.equal(wrong.state.statusCode, 409);
    assert.equal(JSON.parse(wrong.state.body).code, 'ANIMACRAFT_PROTECTED_RUNTIME_DRIFT');
    assert.equal(calls, 1);
  }
});

test('protected browser rejects old Root shape and current publication substitutions before encryption', async () => {
  for (const mutate of [
    fields => { fields.content_commitment = bytes32(0x11); delete fields.content; },
    fields => { fields.capability_registry_binding = { seal_registry_id: id(51) }; delete fields.publication; },
    fields => { fields.publication.catalog_id.vec[0] = id(999); },
    fields => { fields.publication.registry_ids.vec[0].seal_registry_id = id(999); },
    fields => { fields.publication.release_commitments.vec[0].product_binding_commitment = bytes32(9); },
    fields => { fields.publication.sealed_base_registry_commitment = { vec: [] }; },
  ]) {
    const rt = runtime(); const proof = identity(rt); let calls = 0;
    const handler = createBrowserTestInvocation({ runtime: rt,
      transport: transportFixture(rt, proof, rows => mutate(rows.get(proof.rootId).data.content.fields)),
      async createSealClient() { calls += 1; throw new Error('not reached'); },
    });
    const res = response(); await handler({ method: 'POST', body: requestBody(proof) }, res);
    assert.equal(res.state.statusCode, 409);
    assert.equal(calls, 0);
  }
});

// Test-only capture preserves the existing negative status assertions.
function createBrowserTestInvocation(options) {
  const service = createProductionMakerV8ProtectedTransportV8(options);
  return async ({ body }, res) => {
    try {
      const result = await (body.schemaVersion === MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA
        ? service.protectAsset(body) : service.protect(body));
      res.statusCode = 200; res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error.status ?? 500; res.end(JSON.stringify({ code: error.code }));
    }
  };
}
