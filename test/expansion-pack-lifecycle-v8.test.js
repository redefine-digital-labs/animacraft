import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';

import {
  EXPANSION_PACK_LIFECYCLE_ACTIONS_V8,
  EXPANSION_PACK_LIFECYCLE_DESCRIPTOR_V8,
  createExpansionPackLifecycleAction,
  readExpansionPackLifecycleSubmission,
  readExpansionPackLifecycleV8,
} from '../expansion-pack-lifecycle-v8.js';

const ORIGIN = '0xa';
const CALLABLE = '0xb';
const COMMERCE = '0xc';
const PAYMENT = '0xe::usdc::USDC';
const AUTHORITY = '0xf';
const PROTOCOL_ADMIN = '0x10';
const RETIRED_CONTROL_CAP = '0x11';
const id = (value) => `0x${value}`;
const bytes = (value) => Array(32).fill(value);
const runtime = Object.freeze({
  expansionPackV8TypeOriginPackageId: ORIGIN,
  expansionPackV8CallablePackageId: CALLABLE,
  commerceV5TypeOriginPackageId: COMMERCE,
  independentExtensionV5TypeOriginPackageId: COMMERCE,
  paymentCoinType: PAYMENT,
  independentExtensionAuthorityV5Id: AUTHORITY,
  expansionPackV8ReleaseEnabled: true,
});

function table(value) { return { id: { id: { bytes: value } } }; }
function releaseObject(lifecycle = 3, overrides = {}) {
  return {
    objectId: id(3),
    version: '13',
    digest: 'release-digest-13',
    type: `${ORIGIN}::expansion_pack_v8::ExpansionPackReleaseV8`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '8',
      parent_root_id: id(1),
      parent_legacy_maker_id: id(2),
      parent_version: '1',
      parent_manifest_blob_id: 'parent',
      parent_manifest_sha256: bytes(17),
      pack_id: 'pack',
      namespace: 'maker.pack',
      pack_version: '1.0.0',
      creator: id(9),
      manifest_bound: true,
      manifest_blob_id: 'pack',
      manifest_sha256: bytes(34),
      content_commitment: bytes(51),
      style_registry_commitment: bytes(68),
      seal_policy_id: { vec: [] },
      seal_package_id: { vec: [] },
      seal_release_commitment: [],
      access_kind: 0,
      purchase_price_atomic: '0',
      lifecycle,
      admin_cap_id: id(4),
      treasury_id: id(5),
      admitted_by: id(9),
      admitted_parent_ownership_epoch: '7',
      styles: table(id(81)),
      seal_assets: table(id(82)),
      entitlements: table(id(83)),
      style_count: '1',
      entitlement_count: '0',
      ...overrides,
    } },
  };
}

function capObject(owner = id(9)) {
  return {
    objectId: id(4),
    type: `${ORIGIN}::expansion_pack_v8::ExpansionPackAdminCapV8`,
    owner: { AddressOwner: owner },
    json: { fields: { version: '8', release_id: id(3), creator: id(9) } },
  };
}

function treasuryObject() {
  return {
    objectId: id(5),
    type: `${ORIGIN}::expansion_pack_v8::ExpansionPackTreasuryV8<${PAYMENT}>`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '8', release_id: id(3), revenue: { fields: { value: '0' } },
      total_collected: '0', total_withdrawn: '0',
    } },
  };
}

function parentObject(overrides = {}) {
  return {
    objectId: id(1),
    type: `${COMMERCE}::commerce_v5::MakerRootV5`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '5', legacy_maker_id: id(2), legacy_treasury_id: id(21),
      control_vault_id: id(22), treasury_id: id(23), protocol_config_id: id(6),
      payment_coin_type: PAYMENT, logical_auxiliary_blob_id: 'protocol-logical',
      original_creator: id(9), current_owner: id(9), rights_origin: 0,
      ownership_epoch: '7', lifecycle: 1,
      current_control_cap_id: { vec: [RETIRED_CONTROL_CAP] },
      active_listing_id: { vec: [] }, soul_creator_royalty_bps: 250,
      maker_resale_royalty_bps: 500, base_access_kind: 0,
      base_purchase_price_atomic: '0',
      base_policy: { fields: {
        mode: 0, free_quota_per_wallet: '0', price_atomic: '0', total_cap: '0',
      } },
      packs: table(id(24)), pack_keys: [], style_registry: table(id(25)),
      complete_outputs: table(id(26)),
      release: { fields: {
        pack_count: '0', paid_pack_count: '0', style_count: '26',
        style_registry_sealed: true, protected_style_count: '0',
        seal_policy_id: { vec: [] }, seal_release_commitment: [],
        complete_output_count: '0', total_completes: '0',
      } },
      ...overrides,
    } },
  };
}

function configObject(enabled = true, overrides = {}) {
  return {
    objectId: id(6),
    type: `${COMMERCE}::commerce_v5::CommerceProtocolConfigV5`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '5', legacy_config_id: id(27), legacy_admin_cap_id: PROTOCOL_ADMIN,
      treasury_id: id(28), payment_coin_type: PAYMENT,
      primary_protocol_fee_bps: 1000, fixed_complete_fee_atomic: '0',
      maker_market_fee_bps: 250, logical_auxiliary_blob_id: { vec: ['protocol-logical'] },
      soul_binding_proof_type: { vec: [`${id(29)}::soul::BindingProof`] },
      enabled, ...overrides,
    } },
  };
}

function independentExtensionLockBytes(overrides = {}) {
  const suiId = bcs.struct('ID', { bytes: bcs.Address });
  return bcs.struct('IndependentExtensionLockStateV5', {
    authority_id: suiId, legacy_maker_id: suiId, protocol_config_id: suiId,
    protocol_admin_cap_id: suiId, owner: bcs.Address, retired_control_cap_id: suiId,
    retired_control_cap_epoch: bcs.u64(), locked_ownership_epoch: bcs.u64(),
    audit_hash: bcs.byteVector(), finalized: bcs.bool(),
  }).serialize({
    authority_id: { bytes: AUTHORITY }, legacy_maker_id: { bytes: id(2) },
    protocol_config_id: { bytes: id(6) }, protocol_admin_cap_id: { bytes: PROTOCOL_ADMIN },
    owner: id(9), retired_control_cap_id: { bytes: RETIRED_CONTROL_CAP },
    retired_control_cap_epoch: '6', locked_ownership_epoch: '7',
    audit_hash: bytes(102), finalized: true, ...overrides,
  }).toBytes();
}

function client(objects, { lock = true, lockOverrides = {} } = {}) {
  return {
    async getObjects({ objectIds }) {
      return { objects: objectIds.map((requested) => objects.find(
        (entry) => BigInt(entry.objectId) === BigInt(requested),
      )).filter(Boolean) };
    },
    async getDynamicField() {
      if (!lock) throw new Error('dynamic field not found');
      return { dynamicField: { value: {
        type: `${COMMERCE}::commerce_v5::IndependentExtensionLockStateV5`,
        bcs: independentExtensionLockBytes(lockOverrides),
      } } };
    },
  };
}

async function descriptorFor(lifecycle, overrides = {}) {
  const objects = [
    releaseObject(lifecycle, overrides.release),
    capObject(overrides.capOwner),
    treasuryObject(),
    parentObject(overrides.parent),
    configObject(overrides.configEnabled ?? true, overrides.config),
  ];
  return readExpansionPackLifecycleV8({
    suiClient: client(objects, {
      lock: overrides.lock ?? true,
      lockOverrides: overrides.lockOverrides,
    }), runtime: overrides.runtime || runtime,
    walletAddress: overrides.wallet || id(9), releaseId: id(3),
    adminCapId: overrides.adminCapId, treasuryId: overrides.treasuryId,
    parentRootId: overrides.parentRootId,
  });
}

test('authoritative lifecycle matrix makes ARCHIVED terminal', () => {
  assert.deepEqual(EXPANSION_PACK_LIFECYCLE_ACTIONS_V8.ARCHIVED, []);
  assert.equal(EXPANSION_PACK_LIFECYCLE_DESCRIPTOR_V8.ARCHIVED.terminal, true);
  assert.equal(EXPANSION_PACK_LIFECYCLE_DESCRIPTOR_V8.ACTIVE.transitions.pause, 4);
  assert.deepEqual(EXPANSION_PACK_LIFECYCLE_ACTIONS_V8.PAUSED, ['resume', 'archive']);
});

test('fresh read follows Release-owned links and computes gated allowedActions', async () => {
  const active = await descriptorFor(3);
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.authorityReady, true);
  assert.deepEqual(active.allowedActions, ['pause']);
  assert.equal(active.parent.operational, true);
  assert.equal(active.readbackVerified, true);
  assert.equal(Object.isFrozen(active), true);

  const paused = await descriptorFor(4);
  assert.deepEqual(paused.allowedActions, ['resume', 'archive']);
  const stale = await descriptorFor(4, { parent: { ownership_epoch: '8' } });
  assert.deepEqual(stale.allowedActions, ['archive']);
  const disabledConfig = await descriptorFor(4, { configEnabled: false });
  assert.deepEqual(disabledConfig.allowedActions, ['archive']);
  const noLock = await descriptorFor(4, { lock: false });
  assert.deepEqual(noLock.allowedActions, ['archive']);
  assert.equal(noLock.parent.independentExtensionLock, null);
  const activeListing = await descriptorFor(4, {
    parent: { active_listing_id: { vec: [id(30)] } },
  });
  assert.deepEqual(activeListing.allowedActions, ['archive']);
  const missingDependency = await descriptorFor(4, {
    config: { logical_auxiliary_blob_id: { vec: [] } },
  });
  assert.deepEqual(missingDependency.allowedActions, ['archive']);
  const mismatchedLogicalBlob = await descriptorFor(4, {
    config: { logical_auxiliary_blob_id: { vec: ['another-logical-blob'] } },
  });
  assert.deepEqual(mismatchedLogicalBlob.allowedActions, ['archive']);
  const wrongPayment = await descriptorFor(4, {
    parent: { payment_coin_type: `${id(31)}::coin::OTHER` },
  });
  assert.deepEqual(wrongPayment.allowedActions, ['archive']);
  const wrongRetiredCap = await descriptorFor(4, {
    lockOverrides: { retired_control_cap_id: { bytes: id(32) } },
  });
  assert.deepEqual(wrongRetiredCap.allowedActions, ['archive']);
  const unfinishedLock = await descriptorFor(4, {
    lockOverrides: { finalized: false },
  });
  assert.deepEqual(unfinishedLock.allowedActions, ['archive']);
  const wrongAuthority = await descriptorFor(4, {
    lockOverrides: { authority_id: { bytes: id(33) } },
  });
  assert.deepEqual(wrongAuthority.allowedActions, ['archive']);
  const wrongWallet = await descriptorFor(4, { wallet: id(10) });
  assert.deepEqual(wrongWallet.allowedActions, []);
  const archived = await descriptorFor(5);
  assert.deepEqual(archived.allowedActions, []);
});

test('caller-supplied linked IDs must exactly match authoritative Release IDs', async () => {
  await assert.rejects(descriptorFor(3, { adminCapId: id(40) }), {
    code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
  });
  await assert.rejects(descriptorFor(3, { treasuryId: id(50) }), {
    code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
  });
  await assert.rejects(descriptorFor(3, { parentRootId: id(10) }), {
    code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
  });
});

test('action facade reuses audited builders and rejects stale or terminal actions', async () => {
  const active = await descriptorFor(3);
  const pause = createExpansionPackLifecycleAction({
    kind: 'pause', runtime, descriptor: active, sender: id(9),
  });
  assert.equal(pause.action.id, 'chain.pack.pause');
  assert.match(pause.action.target, /::expansion_pack_v8::pause_expansion_pack_v8$/);
  assert.equal(pause.fromLifecycle, 3);
  assert.equal(pause.toLifecycle, 4);
  assert.ok(pause.transaction);

  await assert.rejects(async () => createExpansionPackLifecycleAction({
    kind: 'archive', runtime, descriptor: active, sender: id(9),
  }), { code: 'EXPANSION_PACK_V8_LIFECYCLE_ACTION_NOT_ALLOWED' });
  const archived = await descriptorFor(5);
  await assert.rejects(async () => createExpansionPackLifecycleAction({
    kind: 'resume', runtime, descriptor: archived, sender: id(9),
  }), { code: 'EXPANSION_PACK_V8_LIFECYCLE_ACTION_NOT_ALLOWED' });
});

test('strict lifecycle readback requires success, stable event previous/current and Release state', async () => {
  const active = await descriptorFor(3);
  const { action } = createExpansionPackLifecycleAction({
    kind: 'pause', runtime, descriptor: active, sender: id(9),
  });
  const submission = {
    transactionDigest: 'pause-digest',
    indexed: {
      effects: { status: { status: 'success' } },
      events: [{
        type: `${ORIGIN}::expansion_pack_v8::ExpansionPackLifecycleChangedV8`,
        parsedJson: { release_id: id(3), previous_lifecycle: 3, lifecycle: 4 },
      }],
    },
  };
  const pausedObjects = [releaseObject(4), capObject()];
  const result = await readExpansionPackLifecycleSubmission({
    action, submission, suiClient: client(pausedObjects), runtime,
  });
  assert.equal(result.previousLifecycle, 3);
  assert.equal(result.lifecycle, 4);
  assert.equal(result.readbackVerified, true);

  const wrongPrevious = structuredClone(submission);
  wrongPrevious.indexed.events[0].parsedJson.previous_lifecycle = 2;
  await assert.rejects(readExpansionPackLifecycleSubmission({
    action, submission: wrongPrevious, suiClient: client(pausedObjects), runtime,
  }), { code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH' });
  const wrongCurrent = structuredClone(submission);
  wrongCurrent.indexed.events[0].parsedJson.lifecycle = 3;
  await assert.rejects(readExpansionPackLifecycleSubmission({
    action, submission: wrongCurrent, suiClient: client(pausedObjects), runtime,
  }), { code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH' });
  const staleRelease = [releaseObject(3), capObject()];
  await assert.rejects(readExpansionPackLifecycleSubmission({
    action, submission, suiClient: client(staleRelease), runtime,
  }), { code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH' });
  const failed = structuredClone(submission);
  failed.indexed.effects.status.status = 'failure';
  await assert.rejects(readExpansionPackLifecycleSubmission({
    action, submission: failed, suiClient: client(pausedObjects), runtime,
  }), { code: 'EXPANSION_PACK_V8_CHAIN_EXECUTION_FAILED' });
});
