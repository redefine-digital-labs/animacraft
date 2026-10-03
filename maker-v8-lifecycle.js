import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58,
  fromBase64,
  normalizeStructTag,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';

import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_CHAIN_SCHEMA,
  isMakerV8RuntimeAttested,
  makerV8ChainTypes,
  makerV8AttestedReplacement,
} from './maker-v8-chain.js';
import {
  assertMakerV8Runtime,
  makerV8StableType,
} from './maker-v8-runtime.js';

export const MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA =
  'animacraft.maker-v8-lifecycle-controller.v1';
export const MAKER_V8_LIFECYCLE_DESCRIPTOR_SCHEMA =
  'animacraft.maker-v8-lifecycle-action.v1';
export const MAKER_V8_LIFECYCLE_READBACK_SCHEMA =
  'animacraft.maker-v8-lifecycle-readback.v1';

export const MAKER_V8_LIFECYCLE_ACTIONS = Object.freeze({
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  ARCHIVE: 'ARCHIVE',
  WITHDRAW_MAKER_REVENUE: 'WITHDRAW_MAKER_REVENUE',
});

export const MAKER_V8_LIFECYCLE_STATES = Object.freeze({
  DRAFT: 0,
  ACTIVE: 1,
  PAUSED: 2,
  ARCHIVED: 3,
});

const ZERO_ID = `0x${'0'.repeat(64)}`;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const BUILT_ACTIONS = new WeakSet();
const PREPARED_ACTIONS = new WeakSet();
const RECOVERY_TICKETS = new WeakSet();
const READBACK_EVIDENCE = new WeakSet();
const BUILT_BLUEPRINTS = new WeakMap();
const BUILT_INPUTS = new WeakMap();

const ACTION_FIELDS = Object.freeze({
  PAUSE: Object.freeze(['action', 'wallet', 'root', 'admin', 'protocolConfig', 'catalog', 'releaseConfig']),
  RESUME: Object.freeze([
    'action', 'wallet', 'root', 'admin', 'protocolConfig', 'catalog', 'releaseConfig',
  ]),
  ARCHIVE: Object.freeze(['action', 'wallet', 'root', 'admin', 'protocolConfig', 'catalog', 'releaseConfig']),
  WITHDRAW_MAKER_REVENUE: Object.freeze([
    'action', 'wallet', 'root', 'admin', 'makerTreasury', 'amountAtomic', 'recipient',
  ]),
});

const ACTION_CONTRACTS = Object.freeze({
  PAUSE: Object.freeze({ role: 'release', module: 'release_v8', function: 'pause_maker_v8' }),
  RESUME: Object.freeze({ role: 'release', module: 'release_v8', function: 'resume_maker_v8' }),
  ARCHIVE: Object.freeze({ role: 'release', module: 'release_v8', function: 'archive_maker_v8' }),
  WITHDRAW_MAKER_REVENUE: Object.freeze({
    role: 'core', module: 'treasury_v8', function: 'withdraw_maker_revenue_v8',
  }),
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('non-integer number');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plain(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  throw new TypeError('unsupported canonical value');
}

function cloneLifecycleInput(value) {
  let cloned;
  try {
    cloned = structuredClone(value);
    if (stableJson(cloned) !== stableJson(value)) throw new TypeError('round trip drift');
  } catch {
    fail(
      'shape',
      'MAKER_V8_LIFECYCLE_INPUT_NOT_DURABLE',
      'Lifecycle input must be one deterministic structured-cloneable value.',
    );
  }
  return deepFreeze(cloned);
}

export class MakerV8LifecycleError extends Error {
  constructor(layer, code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8LifecycleError';
    this.layer = layer;
    this.code = code;
    if (details !== undefined) this.details = deepFreeze({ ...details });
  }
}

function fail(layer, code, message, details) {
  throw new MakerV8LifecycleError(layer, code, message, details);
}

function exactKeys(value, fields, label, layer = 'shape') {
  if (!plain(value)) fail(layer, 'MAKER_V8_LIFECYCLE_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    fail(layer, 'MAKER_V8_LIFECYCLE_FIELDS_INVALID', `${label} must contain exactly: ${expected.join(', ')}.`, {
      actual,
      expected,
    });
  }
  return value;
}

function exactId(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value) || value === ZERO_ID) {
    fail('shape', 'MAKER_V8_LIFECYCLE_ID_INVALID', `${label} must be an exact lowercase non-zero Sui ID.`);
  }
  return value;
}

function exactAddress(value, label) {
  return exactId(value, label);
}

function decimal(value, label, { positive = false, bits = 64 } = {}) {
  const normalized = typeof value === 'bigint' ? value.toString() : value;
  if (typeof normalized !== 'string' || !DECIMAL.test(normalized)) {
    fail('shape', 'MAKER_V8_LIFECYCLE_INTEGER_INVALID', `${label} must be a canonical decimal string or bigint.`);
  }
  const parsed = BigInt(normalized);
  if ((positive && parsed === 0n) || parsed > (1n << BigInt(bits)) - 1n) {
    fail('shape', 'MAKER_V8_LIFECYCLE_INTEGER_RANGE', `${label} is outside u${bits}.`);
  }
  return parsed;
}

function exactDigest(value, label) {
  try {
    if (typeof value !== 'string') throw new TypeError('not a string');
    const bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new TypeError('non-canonical');
  } catch {
    fail('shape', 'MAKER_V8_LIFECYCLE_DIGEST_INVALID', `${label} must be an exact canonical Sui digest.`);
  }
  return value;
}

function canonicalType(value, label) {
  try {
    if (typeof value !== 'string' || value.trim() !== value || /\s/.test(value)) throw new TypeError('shape');
    const normalized = normalizeStructTag(value);
    if (normalized !== value) throw new TypeError('non-canonical');
    return value;
  } catch {
    fail('shape', 'MAKER_V8_LIFECYCLE_TYPE_INVALID', `${label} must be one exact canonical Move struct type.`);
  }
}

function same(actual, expected, code, message, details = {}) {
  let equal = false;
  try { equal = stableJson(actual) === stableJson(expected); } catch { equal = false; }
  if (!equal) fail('state', code, message, { ...details, actual, expected });
}

function walletContext(value) {
  exactKeys(value, ['address', 'network'], 'wallet');
  if (value.network !== MAKER_V8_CHAIN_NETWORK) {
    fail('wallet', 'MAKER_V8_LIFECYCLE_NETWORK_INVALID', 'Lifecycle control is pinned to Sui Mainnet.');
  }
  return deepFreeze({ address: exactAddress(value.address, 'wallet.address'), network: value.network });
}

function exactObjectRef(value, label) {
  exactKeys(value, ['objectId', 'version', 'digest'], `${label}.objectRef`);
  return deepFreeze({
    objectId: exactId(value.objectId, `${label}.objectRef.objectId`),
    version: decimal(value.version, `${label}.objectRef.version`, { positive: true }).toString(),
    digest: exactDigest(value.digest, `${label}.objectRef.digest`),
  });
}

function parsedObject(value, expectedType, label, expectedId) {
  if (!plain(value) || value.schemaVersion !== MAKER_V8_CHAIN_SCHEMA
    || value.network !== MAKER_V8_CHAIN_NETWORK) {
    fail('shape', 'MAKER_V8_LIFECYCLE_PARSED_OBJECT_REQUIRED', `${label} must be an exact parsed fresh-v8 Mainnet object.`);
  }
  const objectId = exactId(value.objectId, `${label}.objectId`);
  if (objectId !== expectedId) {
    fail('binding', 'MAKER_V8_LIFECYCLE_OBJECT_ID_MISMATCH', `${label} is not the exact bound object.`, {
      actual: objectId,
      expected: expectedId,
    });
  }
  const type = canonicalType(value.type, `${label}.type`);
  if (type !== normalizeStructTag(expectedType)) {
    fail('binding', 'MAKER_V8_LIFECYCLE_TYPE_MISMATCH', `${label} has the wrong stable TypeOrigin.`, {
      actual: type,
      expected: normalizeStructTag(expectedType),
    });
  }
  const objectRef = exactObjectRef(value.objectRef, label);
  if (objectRef.objectId !== objectId) {
    fail('binding', 'MAKER_V8_LIFECYCLE_REF_MISMATCH', `${label} objectRef does not bind its parsed object.`);
  }
  return { source: value, objectId, type, objectRef };
}

function sharedObject(value, expectedType, label, expectedId, mutable) {
  const object = parsedObject(value, expectedType, label, expectedId);
  if (!plain(value.owner) || value.owner.kind !== 'shared') {
    fail('binding', 'MAKER_V8_LIFECYCLE_SHARED_OBJECT_REQUIRED', `${label} must be a parsed shared object.`);
  }
  const initialSharedVersion = decimal(
    value.owner.initialSharedVersion,
    `${label}.owner.initialSharedVersion`,
    { positive: true },
  ).toString();
  return deepFreeze({
    kind: 'shared',
    name: label,
    objectId: object.objectId,
    type: object.type,
    initialSharedVersion,
    mutable,
    source: value,
  });
}

function ownedObject(value, expectedType, label, expectedId, wallet) {
  const object = parsedObject(value, expectedType, label, expectedId);
  if (!plain(value.owner) || value.owner.kind !== 'address'
    || exactAddress(value.owner.address, `${label}.owner.address`) !== wallet.address) {
    fail('wallet', 'MAKER_V8_LIFECYCLE_OWNED_OBJECT_REQUIRED', `${label} must be exactly owned by the connected wallet.`);
  }
  return deepFreeze({
    kind: 'owned',
    name: label,
    objectId: object.objectId,
    type: object.type,
    version: object.objectRef.version,
    digest: object.objectRef.digest,
    source: value,
  });
}

function assertRootState(root, wallet, expectedState) {
  if (!Number.isInteger(root.lifecycleCode)
    || !Object.values(MAKER_V8_LIFECYCLE_STATES).includes(root.lifecycleCode)) {
    fail('state', 'MAKER_V8_LIFECYCLE_STATE_INVALID', 'Root lifecycle is not a verified v8 state.');
  }
  if (root.lifecycleCode !== expectedState) {
    fail('state', 'MAKER_V8_LIFECYCLE_TRANSITION_INVALID', 'Root is not in the required source lifecycle.', {
      actual: root.lifecycleCode,
      expected: expectedState,
    });
  }
  if (exactAddress(root.ownerAddress, 'root.ownerAddress') !== wallet.address) {
    fail('wallet', 'MAKER_V8_LIFECYCLE_OWNER_MISMATCH', 'Connected wallet is not the current Maker owner.');
  }
}

function assertControl(root, admin, wallet) {
  if (exactId(root.adminCapId, 'root.adminCapId') !== admin.objectId
    || exactId(admin.rootId, 'admin.rootId') !== root.objectId
    || exactAddress(admin.holder, 'admin.holder') !== wallet.address
    || decimal(admin.controlEpoch, 'admin.controlEpoch') !== decimal(root.controlEpoch, 'root.controlEpoch')) {
    fail('binding', 'MAKER_V8_LIFECYCLE_ADMIN_MISMATCH', 'AdminCap does not bind the current Root owner and control epoch.');
  }
}

function objectArgument(value) {
  if (value.kind === 'shared') {
    return deepFreeze({
      kind: value.kind,
      name: value.name,
      objectId: value.objectId,
      type: value.type,
      initialSharedVersion: value.initialSharedVersion,
      mutable: value.mutable,
    });
  }
  return deepFreeze({
    kind: value.kind,
    name: value.name,
    objectId: value.objectId,
    type: value.type,
    version: value.version,
    digest: value.digest,
  });
}

function transactionFromDescriptor(descriptor) {
  const tx = new Transaction();
  tx.setSender(descriptor.sender);
  const args = descriptor.arguments.map((argument) => {
    if (argument.kind === 'shared') {
      return tx.sharedObjectRef({
        objectId: argument.objectId,
        initialSharedVersion: argument.initialSharedVersion,
        mutable: argument.mutable,
      });
    }
    if (argument.kind === 'owned' || argument.kind === 'immutable') {
      return tx.objectRef({
        objectId: argument.objectId,
        version: argument.version,
        digest: argument.digest,
      });
    }
    if (argument.kind === 'u64') return tx.pure.u64(argument.value);
    if (argument.kind === 'address') return tx.pure.address(argument.value);
    fail('shape', 'MAKER_V8_LIFECYCLE_ARGUMENT_INVALID', `Unsupported descriptor argument ${argument.kind}.`);
  });
  tx.moveCall({
    target: descriptor.target,
    typeArguments: descriptor.typeArguments,
    arguments: args,
  });
  return tx;
}

function exactReleaseCommitment(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('binding', 'MAKER_V8_LIFECYCLE_RELEASE_COMMITMENT_INVALID', `${label} must be an exact lowercase 32-byte commitment.`);
  }
  return value;
}

function rootSnapshot(root) {
  return deepFreeze({
    objectId: root.objectId,
    version: decimal(root.objectRef.version, 'root.objectRef.version', { positive: true }).toString(),
    digest: exactDigest(root.objectRef.digest, 'root.objectRef.digest'),
    ownerAddress: exactAddress(root.ownerAddress, 'root.ownerAddress'),
    adminCapId: exactId(root.adminCapId, 'root.adminCapId'),
    controlEpoch: decimal(root.controlEpoch, 'root.controlEpoch').toString(),
    lifecycleCode: root.lifecycleCode,
    makerKey: String(root.makerKey),
    makerVersion: decimal(root.makerVersion, 'root.makerVersion', { positive: true }).toString(),
    contentCommitment: String(root.contentCommitment),
    productBindingCommitment: exactReleaseCommitment(root.productBindingCommitment, 'root.productBindingCommitment'),
    callCapSetCommitment: exactReleaseCommitment(root.callCapSetCommitment, 'root.callCapSetCommitment'),
    binding: JSON.parse(stableJson(root.binding)),
  });
}

function treasurySnapshot(treasury) {
  return deepFreeze({
    objectId: treasury.objectId,
    version: decimal(treasury.objectRef.version, 'makerTreasury.objectRef.version', { positive: true }).toString(),
    digest: exactDigest(treasury.objectRef.digest, 'makerTreasury.objectRef.digest'),
    rootId: exactId(treasury.rootId, 'makerTreasury.rootId'),
    balanceAtomic: decimal(treasury.balanceAtomic, 'makerTreasury.balanceAtomic').toString(),
    totalCollectedAtomic: decimal(treasury.totalCollectedAtomic, 'makerTreasury.totalCollectedAtomic', { bits: 128 }).toString(),
    totalWithdrawnAtomic: decimal(treasury.totalWithdrawnAtomic, 'makerTreasury.totalWithdrawnAtomic', { bits: 128 }).toString(),
  });
}

function actionTarget(runtime, action) {
  const contract = ACTION_CONTRACTS[action];
  return `${runtime.roles[contract.role].callablePackageId}::${contract.module}::${contract.function}`;
}

export function makerV8LifecycleTargetsV8(runtimeInput) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  return deepFreeze(Object.fromEntries(Object.keys(ACTION_CONTRACTS).map((action) => [
    action,
    actionTarget(runtime, action),
  ])));
}

export function makerV8SuccessorPublicationCapabilityV8(runtimeInput) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  return deepFreeze({
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    available: true,
    status: 'ATOMIC_COMPILER',
    code: 'MAKER_V8_SUCCESSOR_PUBLICATION_AVAILABLE',
    issueAuthorityTarget: `${runtime.roles.core.callablePackageId}::maker_v8::issue_successor_authority_v8`,
    successorDraftTarget: `${runtime.roles.core.callablePackageId}::core_v8::new_successor_maker_draft_v8`,
    reason: 'The Fresh-v8 compiler issues and consumes the one-shot successor authority atomically in the exact N+1 scaffold transaction.',
  });
}

export function buildMakerV8LifecycleActionV8(runtimeInput, input) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  if (!plain(input) || !Object.hasOwn(ACTION_FIELDS, input.action)) {
    fail('shape', 'MAKER_V8_LIFECYCLE_ACTION_INVALID', 'Lifecycle action is not one of the exact fresh-v8 actions.');
  }
  const action = input.action;
  exactKeys(input, ACTION_FIELDS[action], `${action} input`);
  const durableInput = cloneLifecycleInput(input);
  const wallet = walletContext(input.wallet);
  const types = makerV8ChainTypes(runtime);
  const rootId = exactId(input.root?.objectId, 'root.objectId');
  const root = sharedObject(input.root, types.root, 'root', rootId, action !== 'WITHDRAW_MAKER_REVENUE');
  const adminId = exactId(input.root?.adminCapId, 'root.adminCapId');
  const admin = ownedObject(input.admin, types.adminCap, 'admin', adminId, wallet);
  assertControl(input.root, input.admin, wallet);

  let argumentsList;
  let preState = { root: rootSnapshot(input.root), treasury: null };
  if (action === 'PAUSE') assertRootState(input.root, wallet, MAKER_V8_LIFECYCLE_STATES.ACTIVE);
  if (action === 'RESUME') assertRootState(input.root, wallet, MAKER_V8_LIFECYCLE_STATES.PAUSED);
  if (action === 'ARCHIVE') {
    if (![MAKER_V8_LIFECYCLE_STATES.ACTIVE, MAKER_V8_LIFECYCLE_STATES.PAUSED]
      .includes(input.root.lifecycleCode)) {
      fail('state', 'MAKER_V8_LIFECYCLE_ARCHIVE_INVALID', 'Only ACTIVE or PAUSED can enter terminal ARCHIVED.');
    }
    if (exactAddress(input.root.ownerAddress, 'root.ownerAddress') !== wallet.address) {
      fail('wallet', 'MAKER_V8_LIFECYCLE_OWNER_MISMATCH', 'Connected wallet is not the current Maker owner.');
    }
  }

  if (action === 'WITHDRAW_MAKER_REVENUE') {
    if (!Object.values(MAKER_V8_LIFECYCLE_STATES).includes(input.root.lifecycleCode)
      || input.root.lifecycleCode === MAKER_V8_LIFECYCLE_STATES.DRAFT) {
      fail('state', 'MAKER_V8_LIFECYCLE_WITHDRAW_INVALID', 'Maker revenue withdrawal requires an activated Root, including PAUSED or ARCHIVED.');
    }
    if (exactAddress(input.root.ownerAddress, 'root.ownerAddress') !== wallet.address) {
      fail('wallet', 'MAKER_V8_LIFECYCLE_OWNER_MISMATCH', 'Connected wallet is not the current Maker owner.');
    }
    const makerTreasury = sharedObject(
      input.makerTreasury,
      types.makerTreasury,
      'makerTreasury',
      exactId(input.root.binding?.makerTreasuryId, 'root.binding.makerTreasuryId'),
      true,
    );
    if (exactId(input.makerTreasury.rootId, 'makerTreasury.rootId') !== root.objectId) {
      fail('binding', 'MAKER_V8_LIFECYCLE_TREASURY_MISMATCH', 'MakerTreasury is not bound to this Root.');
    }
    const amount = decimal(input.amountAtomic, 'amountAtomic', { positive: true });
    if (amount > decimal(input.makerTreasury.balanceAtomic, 'makerTreasury.balanceAtomic')) {
      fail('state', 'MAKER_V8_LIFECYCLE_WITHDRAW_BALANCE', 'Withdrawal exceeds the exact parsed MakerTreasury balance.');
    }
    const recipient = exactAddress(input.recipient, 'recipient');
    argumentsList = [
      objectArgument(root),
      objectArgument(admin),
      objectArgument(makerTreasury),
      deepFreeze({ kind: 'u64', name: 'amountAtomic', value: amount.toString() }),
      deepFreeze({ kind: 'address', name: 'recipient', value: recipient }),
    ];
    preState = { ...preState, treasury: treasurySnapshot(input.makerTreasury) };
  } else {
    const catalog = sharedObject(input.catalog, types.productReleaseCatalog, 'catalog', runtime.catalogId, false);
    const releaseConfig = sharedObject(
      input.releaseConfig,
      types.releaseConfig,
      'releaseConfig',
      runtime.roleConfigIds.release,
      false,
    );
    const protocolConfig = sharedObject(
        input.protocolConfig,
        types.protocolConfig,
        'protocolConfig',
        runtime.protocolConfigId,
        false,
      );
    const replacement = makerV8AttestedReplacement(runtime);
    for (const [rootKey, replacementKey] of [['productBindingCommitment', 'package_tuple_commitment'], ['callCapSetCommitment', 'call_cap_set_commitment']]) {
      const raw = replacement.fields[replacementKey];
      const bytes = typeof raw === 'string' ? fromBase64(raw) : raw;
      const expected = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (preState.root[rootKey] !== expected) {
        fail('binding', 'MAKER_V8_LIFECYCLE_REPLACEMENT_INVALID', `Root ${rootKey} differs from the attested replacement.`);
      }
    }
    const replacementObject = parsedObject(replacement,
      makerV8StableType(runtime, 'core', 'package_binding_v8', 'FreshTupleReplacementBindingV2'),
      'replacement', replacement.objectId);
    if (replacement.owner.kind !== 'immutable') {
      fail('binding', 'MAKER_V8_LIFECYCLE_REPLACEMENT_INVALID', 'Replacement must be the attested immutable authority.');
    }
    if (action === 'RESUME') {
      if (input.protocolConfig.enabled !== true || runtime.enabled !== true) {
        fail('state', 'MAKER_V8_LIFECYCLE_RESUME_DISABLED', 'Resume requires the exact enabled live ProtocolConfig and enabled runtime.');
      }
    }
    argumentsList = [objectArgument(root), objectArgument(admin), objectArgument(protocolConfig), objectArgument(catalog),
      objectArgument({ kind: 'immutable', name: 'replacement', objectId: replacementObject.objectId,
        type: replacementObject.type, version: replacementObject.objectRef.version, digest: replacementObject.objectRef.digest }),
      objectArgument(releaseConfig)];
  }

  const eventType = action === 'WITHDRAW_MAKER_REVENUE'
    ? makerV8StableType(runtime, 'core', 'treasury_v8', 'MakerRevenueV8Withdrawn')
    : types.lifecycleEvent;
  const descriptor = deepFreeze({
    schemaVersion: MAKER_V8_LIFECYCLE_DESCRIPTOR_SCHEMA,
    action,
    network: wallet.network,
    sender: wallet.address,
    target: actionTarget(runtime, action),
    typeArguments: [runtime.paymentCoinType],
    arguments: argumentsList,
    expectedEventType: eventType,
    preState: deepFreeze(preState),
  });
  const transaction = transactionFromDescriptor(descriptor);
  const result = Object.freeze({
    schemaVersion: MAKER_V8_LIFECYCLE_DESCRIPTOR_SCHEMA,
    action,
    transaction,
    descriptor,
    runtime,
  });
  BUILT_ACTIONS.add(result);
  BUILT_BLUEPRINTS.set(result, descriptor);
  BUILT_INPUTS.set(result, durableInput);
  return result;
}

function actionWrapper(action, runtime, input) {
  if (!plain(input) || Object.hasOwn(input, 'action')) {
    fail('shape', 'MAKER_V8_LIFECYCLE_FIELDS_INVALID', `${action} wrapper input must omit action.`);
  }
  return buildMakerV8LifecycleActionV8(runtime, { action, ...input });
}

export const buildPauseMakerV8 = (runtime, input) => actionWrapper('PAUSE', runtime, input);
export const buildResumeMakerV8 = (runtime, input) => actionWrapper('RESUME', runtime, input);
export const buildArchiveMakerV8 = (runtime, input) => actionWrapper('ARCHIVE', runtime, input);
export const buildWithdrawMakerRevenueV8 = (runtime, input) => (
  actionWrapper('WITHDRAW_MAKER_REVENUE', runtime, input)
);

export function assertMakerV8LifecycleBuiltActionV8(value) {
  if (!value || !BUILT_ACTIONS.has(value) || BUILT_BLUEPRINTS.get(value) !== value.descriptor) {
    fail('shape', 'MAKER_V8_LIFECYCLE_BUILT_ACTION_REQUIRED', 'Use the exact fresh-v8 lifecycle builder first.');
  }
  return value;
}

function canonicalTransactionBytes(value, label) {
  let bytes;
  try {
    if (typeof value !== 'string') throw new TypeError('not a string');
    bytes = fromBase64(value);
    if (!bytes.length || bytes.length > 128 * 1024 || toBase64(bytes) !== value) throw new TypeError('non-canonical');
  } catch {
    fail('exact-bytes', 'MAKER_V8_LIFECYCLE_TRANSACTION_BYTES_INVALID', `${label} must be bounded canonical TransactionData base64.`);
  }
  return bytes;
}

function exactBuildResult(value, expectedKind, descriptor) {
  exactKeys(value, ['bytes', 'digest'], 'buildExactTransaction result', 'exact-bytes');
  const bytes = canonicalTransactionBytes(value.bytes, 'buildExactTransaction.bytes');
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (value.digest !== digest) {
    fail('exact-bytes', 'MAKER_V8_LIFECYCLE_TRANSACTION_DIGEST_MISMATCH', 'Built digest does not bind the exact TransactionData bytes.');
  }
  let builder;
  try { builder = TransactionDataBuilder.fromBytes(bytes); } catch {
    fail('exact-bytes', 'MAKER_V8_LIFECYCLE_TRANSACTION_BYTES_INVALID', 'Built bytes are not canonical Sui TransactionData.');
  }
  const snapshot = builder.snapshot();
  const gasBudget = decimal(snapshot.gasData?.budget, 'transaction.gasData.budget', { positive: true });
  const gasPrice = decimal(snapshot.gasData?.price, 'transaction.gasData.price', { positive: true });
  if (snapshot.sender !== descriptor.sender || snapshot.gasData?.owner !== descriptor.sender
    || gasBudget > 500_000_000n || gasPrice === 0n
    || !Array.isArray(snapshot.gasData?.payment)) {
    fail('exact-bytes', 'MAKER_V8_LIFECYCLE_TRANSACTION_ENVELOPE_DRIFT', 'Boundary changed the signer or supplied an unsafe gas envelope.');
  }
  const expirationEpoch = snapshot.expiration?.Epoch;
  if (!Number.isSafeInteger(expirationEpoch)) {
    fail('exact-bytes', 'MAKER_V8_LIFECYCLE_TRANSACTION_ENVELOPE_DRIFT', 'Transaction must carry one bounded epoch expiration.');
  }
  decimal(String(expirationEpoch), 'transaction.expiration.Epoch', { positive: true });
  const kind = toBase64(builder.build({ onlyTransactionKind: true }));
  if (kind !== expectedKind) {
    fail('exact-bytes', 'MAKER_V8_LIFECYCLE_TRANSACTION_KIND_DRIFT', 'Boundary changed the private lifecycle TransactionKind before signing.');
  }
  return { bytes: value.bytes, digest, snapshot };
}

function rootInvariant(root) {
  return {
    objectId: root.objectId,
    ownerAddress: root.ownerAddress,
    adminCapId: root.adminCapId,
    controlEpoch: decimal(root.controlEpoch, 'postRoot.controlEpoch').toString(),
    makerKey: String(root.makerKey),
    makerVersion: decimal(root.makerVersion, 'postRoot.makerVersion', { positive: true }).toString(),
    contentCommitment: String(root.contentCommitment),
    productBindingCommitment: exactReleaseCommitment(root.productBindingCommitment, 'root.productBindingCommitment'),
    callCapSetCommitment: exactReleaseCommitment(root.callCapSetCommitment, 'root.callCapSetCommitment'),
    binding: root.binding,
  };
}

export function certifyMakerV8LifecycleReadbackV8(builtInput, input) {
  const built = assertMakerV8LifecycleBuiltActionV8(builtInput);
  const withdraw = built.action === 'WITHDRAW_MAKER_REVENUE';
  exactKeys(input, withdraw
    ? ['finalized', 'root', 'makerTreasury']
    : ['finalized', 'root'], 'lifecycle finalized readback', 'readback');
  const descriptor = built.descriptor;
  const finalized = input.finalized;
  if (!plain(finalized)) {
    fail('readback', 'MAKER_V8_LIFECYCLE_FINALITY_INVALID', 'Finalized transaction evidence is malformed.');
  }
  exactDigest(finalized.digest, 'finalized.digest');
  if (exactAddress(finalized.sender, 'finalized.sender') !== descriptor.sender
    || !Array.isArray(finalized.events)
    || !finalized.events.some((event) => (
      String(event?.eventType ?? event?.type).replace(/\s+/g, '')
        === descriptor.expectedEventType.replace(/\s+/g, '')
    ))) {
    fail('readback', 'MAKER_V8_LIFECYCLE_FINALITY_INVALID', 'Finality omitted the exact signer or required v8 event.');
  }
  const types = makerV8ChainTypes(built.runtime);
  const postRoot = sharedObject(
    input.root,
    types.root,
    'postRoot',
    descriptor.preState.root.objectId,
    !withdraw,
  ).source;
  same(rootInvariant(postRoot), {
    objectId: descriptor.preState.root.objectId,
    ownerAddress: descriptor.preState.root.ownerAddress,
    adminCapId: descriptor.preState.root.adminCapId,
    controlEpoch: descriptor.preState.root.controlEpoch,
    makerKey: descriptor.preState.root.makerKey,
    makerVersion: descriptor.preState.root.makerVersion,
    contentCommitment: descriptor.preState.root.contentCommitment,
    productBindingCommitment: descriptor.preState.root.productBindingCommitment,
    callCapSetCommitment: descriptor.preState.root.callCapSetCommitment,
    binding: descriptor.preState.root.binding,
  }, 'MAKER_V8_LIFECYCLE_ROOT_DRIFT', 'Final Root changed outside the authorized lifecycle field.');

  const preRootVersion = BigInt(descriptor.preState.root.version);
  const postRootVersion = BigInt(postRoot.objectRef.version);
  if (withdraw) {
    if (postRootVersion !== preRootVersion
      || postRoot.objectRef.digest !== descriptor.preState.root.digest
      || postRoot.lifecycleCode !== descriptor.preState.root.lifecycleCode) {
      fail('readback', 'MAKER_V8_LIFECYCLE_ROOT_DRIFT', 'Revenue withdrawal unexpectedly changed the immutable Root input.');
    }
  } else {
    const expectedLifecycle = {
      PAUSE: MAKER_V8_LIFECYCLE_STATES.PAUSED,
      RESUME: MAKER_V8_LIFECYCLE_STATES.ACTIVE,
      ARCHIVE: MAKER_V8_LIFECYCLE_STATES.ARCHIVED,
    }[built.action];
    if (postRootVersion <= preRootVersion || postRoot.lifecycleCode !== expectedLifecycle) {
      fail('readback', 'MAKER_V8_LIFECYCLE_POST_STATE_MISMATCH', 'Final Root did not reach the exact authorized lifecycle transition.');
    }
  }

  let treasuryEvidence = null;
  if (withdraw) {
    const pre = descriptor.preState.treasury;
    const post = sharedObject(
      input.makerTreasury,
      types.makerTreasury,
      'postMakerTreasury',
      pre.objectId,
      true,
    ).source;
    const amount = BigInt(descriptor.arguments.find((argument) => argument.kind === 'u64').value);
    if (exactId(post.rootId, 'postMakerTreasury.rootId') !== pre.rootId
      || BigInt(post.objectRef.version) <= BigInt(pre.version)
      || decimal(post.balanceAtomic, 'postMakerTreasury.balanceAtomic') !== BigInt(pre.balanceAtomic) - amount
      || decimal(post.totalCollectedAtomic, 'postMakerTreasury.totalCollectedAtomic', { bits: 128 }) !== BigInt(pre.totalCollectedAtomic)
      || decimal(post.totalWithdrawnAtomic, 'postMakerTreasury.totalWithdrawnAtomic', { bits: 128 }) !== BigInt(pre.totalWithdrawnAtomic) + amount) {
      fail('readback', 'MAKER_V8_LIFECYCLE_TREASURY_READBACK_MISMATCH', 'Final MakerTreasury does not prove the exact withdrawal arithmetic.');
    }
    treasuryEvidence = treasurySnapshot(post);
  }
  const evidence = deepFreeze({
    schemaVersion: MAKER_V8_LIFECYCLE_READBACK_SCHEMA,
    action: built.action,
    digest: finalized.digest,
    sender: descriptor.sender,
    eventType: descriptor.expectedEventType,
    root: rootSnapshot(postRoot),
    makerTreasury: treasuryEvidence,
    terminal: built.action === 'ARCHIVE',
  });
  READBACK_EVIDENCE.add(evidence);
  return evidence;
}

export function assertMakerV8LifecycleReadbackV8(value) {
  if (!value || !READBACK_EVIDENCE.has(value)) {
    fail('readback', 'MAKER_V8_LIFECYCLE_READBACK_REQUIRED', 'Final UI state requires controller-certified v8 readback evidence.');
  }
  return value;
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('config', 'MAKER_V8_LIFECYCLE_DEPENDENCY_INVALID', `${label}.${method} is required.`);
  }
}

function executionGates(value = {}) {
  exactKeys(value, ['allowBroadcast', 'allowWalletSignature'], 'execution', 'config');
  if (typeof value.allowWalletSignature !== 'boolean' || typeof value.allowBroadcast !== 'boolean'
    || value.allowWalletSignature !== value.allowBroadcast) {
    fail('config', 'MAKER_V8_LIFECYCLE_EXECUTION_GATE_INVALID', 'Signing and recovery/broadcast gates must be equal booleans.');
  }
  return deepFreeze({ ...value });
}

export function createMakerV8LifecycleControllerV8({
  runtime: runtimeInput,
  boundary,
  wallet,
  recovery,
  readback,
  execution = { allowWalletSignature: false, allowBroadcast: false },
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  requireMethod(boundary, 'buildExactTransaction', 'boundary');
  requireMethod(boundary, 'dryRunExactTransaction', 'boundary');
  requireMethod(wallet, 'signExactTransaction', 'wallet');
  requireMethod(wallet, 'verifyExactSignature', 'wallet');
  requireMethod(recovery, 'reserveSignatureIntent', 'recovery');
  requireMethod(recovery, 'handleSignatureFailure', 'recovery');
  requireMethod(recovery, 'persistSignedArtifact', 'recovery');
  requireMethod(recovery, 'loadSignedArtifact', 'recovery');
  requireMethod(recovery, 'resolveActiveRecovery', 'recovery');
  requireMethod(recovery, 'resolveActiveRecoveryByRoot', 'recovery');
  requireMethod(recovery, 'reclaimActiveSignatureIntent', 'recovery');
  requireMethod(recovery, 'recoverExactTransaction', 'recovery');
  requireMethod(readback, 'readFinalizedTransaction', 'readback');
  requireMethod(readback, 'readRoot', 'readback');
  requireMethod(readback, 'readMakerTreasury', 'readback');
  const gates = executionGates(execution);

  async function prepare(builtInput) {
    const built = assertMakerV8LifecycleBuiltActionV8(builtInput);
    if (built.runtime !== runtime) {
      fail('binding', 'MAKER_V8_LIFECYCLE_RUNTIME_MISMATCH', 'Built action belongs to another runtime identity.');
    }
    if (!isMakerV8RuntimeAttested(runtime)) {
      fail('config', 'MAKER_V8_LIFECYCLE_RUNTIME_ATTESTATION_REQUIRED', 'Signing preparation requires live Mainnet runtime attestation.');
    }
    const canonical = transactionFromDescriptor(BUILT_BLUEPRINTS.get(built));
    const expectedKind = toBase64(new TransactionDataBuilder(canonical.getData()).build({ onlyTransactionKind: true }));
    const raw = await boundary.buildExactTransaction({
      transaction: canonical,
      sender: built.descriptor.sender,
      descriptor: built.descriptor,
      expectedKindBytes: expectedKind,
    });
    const checked = exactBuildResult(raw, expectedKind, built.descriptor);
    const dryRun = await boundary.dryRunExactTransaction({
      bytes: checked.bytes,
      digest: checked.digest,
      signer: built.descriptor.sender,
      descriptor: built.descriptor,
      expectedKindBytes: expectedKind,
    });
    exactKeys(dryRun, ['bytes', 'digest', 'status'], 'dryRunExactTransaction result', 'dry-run');
    if (dryRun.status !== 'SUCCESS' || dryRun.bytes !== checked.bytes || dryRun.digest !== checked.digest) {
      fail('dry-run', 'MAKER_V8_LIFECYCLE_DRY_RUN_FAILED', 'Exact lifecycle TransactionData did not pass an echo-bound dry run.');
    }
    const prepared = deepFreeze({
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      built,
      bytes: checked.bytes,
      digest: checked.digest,
      expectedKindBytes: expectedKind,
    });
    PREPARED_ACTIONS.add(prepared);
    return prepared;
  }

  async function requestSignature(prepared) {
    if (!gates.allowWalletSignature || !gates.allowBroadcast) {
      fail('config', 'MAKER_V8_LIFECYCLE_EXECUTION_DISABLED', 'Lifecycle signing and recovery/broadcast are disabled.');
    }
    if (!prepared || !PREPARED_ACTIONS.has(prepared)) {
      fail('shape', 'MAKER_V8_LIFECYCLE_PREPARED_REQUIRED', 'A fresh exact-byte dry-run proof is required before signing.');
    }
    PREPARED_ACTIONS.delete(prepared);
    const signer = prepared.built.descriptor.sender;
    const reserved = await recovery.reserveSignatureIntent({
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      action: prepared.built.action,
      descriptor: prepared.built.descriptor,
      input: BUILT_INPUTS.get(prepared.built),
      bytes: prepared.bytes,
      digest: prepared.digest,
      signer,
    });
    exactKeys(reserved, ['digest', 'recoveryId'], 'reserveSignatureIntent result', 'recovery');
    if (reserved.digest !== prepared.digest || typeof reserved.recoveryId !== 'string'
      || reserved.recoveryId.length < 1 || reserved.recoveryId.length > 256) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_SIGNATURE_INTENT_INVALID', 'Durable signature intent did not bind the exact prepared transaction.');
    }
    let signed;
    try {
      signed = await wallet.signExactTransaction({
        bytes: prepared.bytes,
        digest: prepared.digest,
        signer,
      });
    } catch (error) {
      await recovery.handleSignatureFailure({
        recoveryId: reserved.recoveryId,
        digest: prepared.digest,
        definitiveRejection: error?.definitiveRejection === true,
        signedArtifactCreated: error?.signedArtifactCreated === false ? false : null,
      });
      throw error;
    }
    exactKeys(signed, ['bytes', 'digest', 'signature', 'signer'], 'wallet signed artifact', 'wallet');
    if (signed.bytes !== prepared.bytes || signed.digest !== prepared.digest
      || signed.signer !== signer) {
      fail('wallet', 'MAKER_V8_LIFECYCLE_SIGNED_ARTIFACT_DRIFT', 'Wallet changed the exact bytes, digest, or signer.');
    }
    canonicalTransactionBytes(signed.bytes, 'signed.bytes');
    try {
      const signature = fromBase64(signed.signature);
      if (!signature.length || toBase64(signature) !== signed.signature) throw new TypeError('signature');
    } catch {
      fail('wallet', 'MAKER_V8_LIFECYCLE_SIGNATURE_INVALID', 'Wallet signature must be non-empty canonical base64.');
    }
    const verified = await wallet.verifyExactSignature({ ...signed });
    if (verified !== true && !(plain(verified)
      && verified.verified === true
      && verified.bytes === signed.bytes
      && verified.digest === signed.digest
      && verified.signer === signed.signer)) {
      fail('wallet', 'MAKER_V8_LIFECYCLE_SIGNATURE_UNVERIFIED', 'Signature did not authenticate the exact TransactionData, digest, and signer.');
    }
    const persisted = await recovery.persistSignedArtifact({
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      action: prepared.built.action,
      descriptor: prepared.built.descriptor,
      input: BUILT_INPUTS.get(prepared.built),
      bytes: signed.bytes,
      digest: signed.digest,
      signature: signed.signature,
      signer: signed.signer,
    });
    exactKeys(persisted, ['digest', 'recoveryId'], 'persistSignedArtifact result', 'recovery');
    if (persisted.digest !== signed.digest || persisted.recoveryId !== reserved.recoveryId) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_PERSISTENCE_INVALID', 'Recovery persistence did not bind the exact signed digest.');
    }
    const ticket = deepFreeze({
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      recoveryId: persisted.recoveryId,
      digest: signed.digest,
      built: prepared.built,
    });
    RECOVERY_TICKETS.add(ticket);
    return ticket;
  }

  async function recoverTicket(ticket) {
    if (!gates.allowBroadcast || !gates.allowWalletSignature) {
      fail('config', 'MAKER_V8_LIFECYCLE_EXECUTION_DISABLED', 'Lifecycle signing and recovery/broadcast are disabled.');
    }
    if (!ticket || !RECOVERY_TICKETS.has(ticket)) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_TICKET_REQUIRED', 'Recovery requires the exact durable signed-artifact ticket.');
    }
    const result = await recovery.recoverExactTransaction({
      recoveryId: ticket.recoveryId,
      digest: ticket.digest,
      signer: ticket.built.descriptor.sender,
      descriptor: ticket.built.descriptor,
    });
    exactKeys(result, ['digest', 'recoveryId', 'status'], 'recoverExactTransaction result', 'recovery');
    if (result.digest !== ticket.digest || result.recoveryId !== ticket.recoveryId
      || !['FINALIZED_SUCCESS', 'OUTCOME_UNKNOWN'].includes(result.status)) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_INVALID', 'Recovery returned a different artifact or unsupported outcome.');
    }
    if (result.status === 'OUTCOME_UNKNOWN') {
      return deepFreeze({
        schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
        status: result.status,
        recoveryId: ticket.recoveryId,
        digest: ticket.digest,
        readback: null,
      });
    }
    const descriptor = ticket.built.descriptor;
    const finalized = await readback.readFinalizedTransaction({
      digest: ticket.digest,
      expectedSender: descriptor.sender,
      expectedEventTypes: [descriptor.expectedEventType],
    });
    if (!plain(finalized) || finalized.digest !== ticket.digest) {
      fail('readback', 'MAKER_V8_LIFECYCLE_FINALITY_INVALID', 'Finalized readback does not bind the exact durable digest.');
    }
    const root = await readback.readRoot({
      rootId: descriptor.preState.root.objectId,
      built: ticket.built,
      finalized,
    });
    const readbackInput = { finalized, root };
    if (ticket.built.action === 'WITHDRAW_MAKER_REVENUE') {
      readbackInput.makerTreasury = await readback.readMakerTreasury({
        treasuryId: descriptor.preState.treasury.objectId,
        root,
        built: ticket.built,
        finalized,
      });
    }
    const evidence = certifyMakerV8LifecycleReadbackV8(ticket.built, readbackInput);
    return deepFreeze({
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      status: 'FINALIZED_SUCCESS',
      recoveryId: ticket.recoveryId,
      digest: ticket.digest,
      readback: evidence,
    });
  }

  async function loadRecoveryTicket(recoveryId) {
    if (!gates.allowBroadcast || !gates.allowWalletSignature) {
      fail('config', 'MAKER_V8_LIFECYCLE_EXECUTION_DISABLED', 'Lifecycle signing and recovery/broadcast are disabled.');
    }
    if (typeof recoveryId !== 'string' || recoveryId.length < 1 || recoveryId.length > 256) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_ID_INVALID', 'Cold recovery requires one bounded durable recoveryId.');
    }
    const artifact = await recovery.loadSignedArtifact({ recoveryId });
    exactKeys(artifact, [
      'schemaVersion', 'recoveryId', 'action', 'descriptor', 'input',
      'bytes', 'digest', 'signature', 'signer',
    ], 'loadSignedArtifact result', 'recovery');
    if (artifact.schemaVersion !== MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA
      || artifact.recoveryId !== recoveryId) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_INVALID', 'Durable recovery returned another schema or recoveryId.');
    }
    const rebuilt = buildMakerV8LifecycleActionV8(runtime, artifact.input);
    if (rebuilt.action !== artifact.action
      || stableJson(rebuilt.descriptor) !== stableJson(artifact.descriptor)
      || artifact.signer !== rebuilt.descriptor.sender) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_DESCRIPTOR_DRIFT', 'Durable action input no longer rebuilds the exact signed descriptor.');
    }
    const canonical = transactionFromDescriptor(BUILT_BLUEPRINTS.get(rebuilt));
    const expectedKind = toBase64(
      new TransactionDataBuilder(canonical.getData()).build({ onlyTransactionKind: true }),
    );
    const checked = exactBuildResult(
      { bytes: artifact.bytes, digest: artifact.digest },
      expectedKind,
      rebuilt.descriptor,
    );
    let signature;
    try {
      signature = fromBase64(artifact.signature);
      if (!signature.length || toBase64(signature) !== artifact.signature) throw new TypeError('signature');
    } catch {
      fail('recovery', 'MAKER_V8_LIFECYCLE_SIGNATURE_INVALID', 'Durable signature must be non-empty canonical base64.');
    }
    const verified = await wallet.verifyExactSignature({
      bytes: artifact.bytes,
      digest: checked.digest,
      signature: artifact.signature,
      signer: artifact.signer,
    });
    if (verified !== true && !(plain(verified)
      && verified.verified === true
      && verified.bytes === artifact.bytes
      && verified.digest === checked.digest
      && verified.signer === artifact.signer)) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_SIGNATURE_UNVERIFIED', 'Durable signature does not authenticate its exact TransactionData and signer.');
    }
    const ticket = deepFreeze({
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      recoveryId,
      digest: checked.digest,
      built: rebuilt,
    });
    RECOVERY_TICKETS.add(ticket);
    return ticket;
  }

  async function recover(ticket) {
    return recoverTicket(ticket);
  }

  async function recoverById(recoveryId) {
    return recoverTicket(await loadRecoveryTicket(recoveryId));
  }

  async function recoverActive(builtInput) {
    const built = assertMakerV8LifecycleBuiltActionV8(builtInput);
    if (built.runtime !== runtime) {
      fail('binding', 'MAKER_V8_LIFECYCLE_RUNTIME_MISMATCH', 'Active recovery belongs to another runtime identity.');
    }
    const resolved = await recovery.resolveActiveRecovery({
      action: built.action,
      descriptor: built.descriptor,
      signer: built.descriptor.sender,
    });
    exactKeys(resolved, ['digest', 'recoveryId'], 'resolveActiveRecovery result', 'recovery');
    if (typeof resolved.recoveryId !== 'string' || resolved.recoveryId.length < 1
      || resolved.recoveryId.length > 256 || typeof resolved.digest !== 'string') {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_INVALID', 'Active recovery did not resolve one bounded durable artifact.');
    }
    const ticket = await loadRecoveryTicket(resolved.recoveryId);
    if (ticket.digest !== resolved.digest) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_INVALID', 'Active recovery digest differs from its durable signed WAL.');
    }
    return recoverTicket(ticket);
  }

  async function recoverByRoot(input) {
    exactKeys(input, ['action', 'rootId', 'signer'], 'stable Root recovery request', 'recovery');
    const resolved = await recovery.resolveActiveRecoveryByRoot(input);
    exactKeys(resolved, ['digest', 'recoveryId'], 'resolveActiveRecoveryByRoot result', 'recovery');
    if (typeof resolved.recoveryId !== 'string' || resolved.recoveryId.length < 1
      || resolved.recoveryId.length > 256 || typeof resolved.digest !== 'string') {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_INVALID', 'Stable Root recovery did not resolve one bounded durable artifact.');
    }
    const ticket = await loadRecoveryTicket(resolved.recoveryId);
    if (ticket.digest !== resolved.digest) {
      fail('recovery', 'MAKER_V8_LIFECYCLE_RECOVERY_INVALID', 'Stable Root recovery digest differs from its durable signed WAL.');
    }
    return recoverTicket(ticket);
  }

  async function reclaimActive(input) {
    exactKeys(input, ['action', 'rootId', 'signer'], 'active signature reclaim request', 'recovery');
    const result = await recovery.reclaimActiveSignatureIntent(input);
    exactKeys(result, ['digest', 'recoveryId', 'status'], 'reclaimActiveSignatureIntent result', 'recovery');
    if (result.status !== 'UNSIGNED_INTENT_RELEASED'
      || typeof result.recoveryId !== 'string' || result.recoveryId.length < 1
      || result.recoveryId.length > 256 || typeof result.digest !== 'string') {
      fail('recovery', 'MAKER_V8_LIFECYCLE_UNSIGNED_CONFIRMATION_INVALID', 'Active signature reclaim did not release one exact unsigned intent.');
    }
    return deepFreeze({ ...result });
  }

  return deepFreeze({
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    runtime,
    execution: gates,
    successorCapability: makerV8SuccessorPublicationCapabilityV8(runtime),
    build: (input) => buildMakerV8LifecycleActionV8(runtime, input),
    prepare,
    requestSignature,
    recover,
    recoverById,
    recoverActive,
    recoverByRoot,
    reclaimActive,
    execute: async (built) => recover(await requestSignature(await prepare(built))),
  });
}
