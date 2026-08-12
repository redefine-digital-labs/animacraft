import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';

import { fromBase64 } from '@mysten/sui/utils';
import { TransactionDataBuilder } from '@mysten/sui/transactions';

import {
  EXPANSION_PACK_PUBLICATION_ACTION_STATUS,
  EXPANSION_PACK_PUBLICATION_TRANSPORTS,
  beginExpansionPackPublicationAction,
  buildExpansionPackPublicationPlan,
  completedExpansionPackPublication,
  confirmExpansionPackPublicationAction,
  createExpansionPackPublicationRecovery,
  hydrateExpansionPackPublicationRecovery,
  markExpansionPackPublicationSubmitted,
  nextExpansionPackPublicationAction,
  recordExpansionPackPublicationProgress,
} from '../../expansion-pack-publication-recovery.js';
import { canonicalExpansionPackJson } from '../../expansion-pack-publication.js';
import { normalizeRuntimeConfig } from '../../runtime-config.js';

const execFileAsync = promisify(execFile);
export const CEREMONY_SCHEMA = 'animacraft.expansion-pack-v8-pack-ceremony.v1';
export const ACTION_LOCK_SCHEMA = 'animacraft.expansion-pack-v8-pack-action-lock.v1';
export const RECEIPT_SCHEMA = 'animacraft.expansion-pack-v8-pack-ceremony-receipt.v1';
export const ALLOWED_UNTRACKED = Object.freeze([
  'scripts/expansion-pack-v8-parent-migration.mjs',
]);
const SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_ACTION = /seal-policy|\bgate\b|deploy/i;
const CEREMONY_SOURCE_PATHS = Object.freeze(new Set([
  'package.json',
  'scripts/expansion-pack-v8-pack-ceremony.mjs',
  'scripts/lib/expansion-pack-v8-pack-ceremony.mjs',
  'scripts/lib/expansion-pack-v8-pack-ceremony-adapters.mjs',
  'test/expansion-pack-v8-pack-ceremony.test.js',
]));
const GATES = Object.freeze([
  'expansionPackV8ReleaseEnabled',
  'commerceV5ReleaseEnabled',
  'canonicalSoulMintEnabled',
  'compositionV6ReleaseEnabled',
  'physicalStyleV7ReleaseEnabled',
]);

export class PackCeremonyError extends Error {
  constructor(message, code = 'PACK_CEREMONY_FAILED', details = {}) {
    super(message);
    this.name = 'PackCeremonyError';
    this.code = code;
    this.details = details;
  }
}

function fail(message, code = 'PACK_CEREMONY_FAILED', details = {}) {
  throw new PackCeremonyError(message, code, details);
}

function text(value) { return String(value ?? '').trim(); }
function clone(value) { return structuredClone(value); }
function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined)
    .sort().map((key) => [key, stableValue(value[key])]));
}
export function stableJson(value, space = 0) { return JSON.stringify(stableValue(value), null, space); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function hash(value, label) {
  const result = text(value).replace(/^0x/i, '').toLowerCase();
  if (!SHA256.test(result)) fail(`${label} must be an exact SHA-256.`, 'PACK_CEREMONY_HASH_INVALID');
  return result;
}
function same(left, right, label) {
  if (stableJson(left) !== stableJson(right)) {
    fail(`${label} drifted.`, 'PACK_CEREMONY_DRIFT', { expected: left, actual: right });
  }
}

export async function atomicWriteJson0600(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(temporary, `${stableJson(value, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const handle = await open(temporary, 'r');
    await handle.sync();
    await handle.close();
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
    const readback = JSON.parse(await readFile(target, 'utf8'));
    if (stableJson(readback) !== stableJson(value)) {
      fail('Atomic state readback differs from the persisted value.', 'PACK_CEREMONY_PERSISTENCE_FAILED');
    }
    const mode = (await stat(target)).mode & 0o777;
    if (mode !== 0o600) fail('Ceremony state is not mode 0600.', 'PACK_CEREMONY_PERMISSIONS_INVALID', { mode });
    return readback;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function assertExternalStatePath(repoRoot, statePath) {
  const repo = resolve(repoRoot);
  const state = resolve(statePath);
  const rel = relative(repo, state);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    fail('Ceremony state must live outside the Git worktree.', 'PACK_CEREMONY_STATE_INSIDE_REPO');
  }
}

function statusEntry(line) {
  const raw = line.slice(3).trim();
  return { status: line.slice(0, 2), path: raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw };
}

export function validateWorktreeStatus(status) {
  const entries = text(status) ? text(status).split('\n').filter(Boolean).map(statusEntry) : [];
  const invalid = entries.filter(({ status: code, path }) => (
    code !== '??' || !ALLOWED_UNTRACKED.includes(path)
  ));
  if (invalid.length) fail('Worktree drifted; only the reviewed parent-migration script may be untracked.',
    'PACK_CEREMONY_WORKTREE_DIRTY', { invalid });
  return entries.map(({ path }) => path);
}

function assertActualFalse(config, label) {
  if (text(config?.network) !== 'mainnet') fail(`${label} is not Mainnet.`, 'PACK_CEREMONY_NETWORK_MISMATCH');
  const enabled = GATES.filter((gate) => gate in config && config?.[gate] !== false);
  if (enabled.length) fail(`${label} has a product gate that is not exactly false.`,
    'PACK_CEREMONY_GATE_OPEN', { label, enabled });
}

function loadPublicSource(source) {
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename: 'public/config.js' }).runInContext(context, { timeout: 1_000 });
  return clone(context.window.ANIMACRAFT_CONFIG || {});
}

export async function loadActualConfiguration(repoRoot) {
  const [publicSource, deploymentSource] = await Promise.all([
    readFile(resolve(repoRoot, 'public/config.js'), 'utf8'),
    readFile(resolve(repoRoot, 'deployments/mainnet.json'), 'utf8'),
  ]);
  const publicConfig = loadPublicSource(publicSource);
  const deployment = JSON.parse(deploymentSource);
  const runtime = normalizeRuntimeConfig(publicConfig);
  assertActualFalse(publicConfig, 'public/config.js');
  assertActualFalse(runtime, 'runtime config');
  assertActualFalse(deployment, 'deployments/mainnet.json');
  const release = deployment?.releases?.expansionPackV8;
  if (!release || deployment.observedChainState?.productRuntime?.expansionPackV8ReleaseEnabled !== false
    || deployment.observedChainState?.productRuntime?.physicalStyleV7ReleaseEnabled !== false
    || deployment.verification?.expansionPackV8Enabled !== false
    || deployment.verification?.expansionPackV8CompleteToSoulidityEnabled !== false
    || deployment.verification?.expansionPackV8CompleteBridgeEnabled !== false
    || deployment.verification?.expansionPackV8PhysicalBridgeEnabled !== false) {
    fail('deployments/mainnet.json nested v8/Complete/physical gates are not exactly false.',
      'PACK_CEREMONY_GATE_OPEN');
  }
  return { publicConfig, runtime, deployment };
}

function exactFiles(readiness, repoRoot) {
  const candidate = readiness?.lock?.pack?.candidate;
  const observed = readiness?.lock?.walrus?.files;
  if (!candidate || candidate.manifest?.commerce?.accessMode !== 'FREE'
    || candidate.manifest?.commerce?.purchasePriceAtomic !== '0'
    || candidate.transportProtected === true || candidate.manifest?.transportProtection
    || candidate.files?.length !== 2 || observed?.length !== 2) {
    fail('Readiness is not an exact two-file, unprotected FREE candidate.', 'PACK_CEREMONY_FREE_ONLY');
  }
  if (readiness.lock.pack.intent?.accessKind !== 'FREE'
    || text(readiness.lock.pack.intent?.purchasePriceAtomic) !== '0') {
    fail('Pack intent is not exact FREE/zero-price.', 'PACK_CEREMONY_FREE_ONLY');
  }
  const manifestBytes = Buffer.from(candidate.manifestJson, 'utf8');
  const asset = readiness.lock.pack.intent.asset;
  const assetPath = resolve(repoRoot, asset.sourcePath);
  return readFile(assetPath).then((assetBytes) => {
    const bytes = new Map([
      [candidate.manifestIdentifier, manifestBytes],
      [asset.identifier, assetBytes],
    ]);
    for (const descriptor of candidate.files) {
      const exact = bytes.get(descriptor.identifier);
      const observedDescriptor = observed.find((entry) => entry.identifier === descriptor.identifier);
      if (!exact || sha256(exact) !== hash(descriptor.sha256, `${descriptor.identifier} candidate hash`)
        || sha256(exact) !== hash(observedDescriptor?.sha256, `${descriptor.identifier} readiness hash`)
        || exact.byteLength !== Number(observedDescriptor.byteLength)) {
        fail(`Exact candidate file ${descriptor.identifier} drifted.`, 'PACK_CEREMONY_FILE_DRIFT');
      }
    }
    if (candidate.manifestIdentifier !== 'animacraft-expansion-pack-manifest.json'
      || candidate.files[0].identifier !== candidate.manifestIdentifier
      || asset.sha256 !== sha256(assetBytes) || asset.byteLength !== assetBytes.byteLength) {
      fail('Candidate manifest/asset ordering or exact asset bytes drifted.', 'PACK_CEREMONY_FILE_DRIFT');
    }
    if (text(readiness.lock.walrus.quiltBlobId) === '') {
      fail('Readiness has no exact encoded Quilt Blob ID.', 'PACK_CEREMONY_QUILT_MISSING');
    }
    return { candidate, assetPath, files: [...bytes].map(([identifier, value]) => ({ identifier, bytes: value })) };
  });
}

function planContext(readiness, runtime) {
  const intent = readiness.lock.pack.intent;
  const parent = readiness.lock.parent;
  return {
    owner: readiness.lock.signer.address,
    baseMakerRootId: parent.currentV5.rootId,
    parentLegacyMakerId: parent.legacyMakerId,
    independentExtensionAuthorityV5Id: parent.currentV5.authorityId,
    accessKind: 0,
    purchasePriceAtomic: '0',
    ...runtime,
  };
}

function actionRuntime(actualRuntime) {
  // This overlay authorizes only immutable action resolution. It is hashed and
  // persisted; no config file is changed and actual gates remain false.
  return Object.freeze({ ...clone(actualRuntime), expansionPackV8ReleaseEnabled: true });
}

function assertSafePlan(plan) {
  const unsafe = plan.actions.filter((action) => FORBIDDEN_ACTION.test(`${action.id} ${action.target}`));
  if (unsafe.length) fail('FREE ceremony plan contains Seal policy, gate, or deployment work.',
    'PACK_CEREMONY_UNSAFE_PLAN', { actions: unsafe.map((entry) => entry.id) });
  if (plan.context.accessKind !== 0 || plan.context.purchasePriceAtomic !== '0') {
    fail('Publication plan is not FREE.', 'PACK_CEREMONY_FREE_ONLY');
  }
}

async function git(repoRoot, ...args) {
  return text((await execFileAsync('git', args, { cwd: repoRoot })).stdout);
}

export async function validateReadiness({ repoRoot, readinessPath, expected = null } = {}) {
  const readinessBytes = await readFile(resolve(readinessPath));
  const readiness = JSON.parse(readinessBytes);
  if (readiness.schemaVersion !== 'animacraft.expansion-pack-v8-free-readiness.v1'
    || readiness.ready !== true) fail('A successful FREE readiness report is required.', 'PACK_CEREMONY_READINESS_INVALID');
  const fingerprint = sha256(stableJson(readiness.lock));
  if (hash(readiness.lockFingerprintSha256, 'Readiness fingerprint') !== fingerprint) {
    fail('Readiness stable lock fingerprint is invalid.', 'PACK_CEREMONY_READINESS_FINGERPRINT_INVALID');
  }
  const readinessHead = text(readiness.lock.source?.headCommit);
  const readinessTree = text(readiness.lock.source?.headTree);
  if (!readinessHead || !readinessTree) fail('Readiness has no exact source HEAD/tree.',
    'PACK_CEREMONY_SOURCE_DRIFT');
  const [head, tree, status, configuration, exact, ancestry, changedSinceReadiness] = await Promise.all([
    git(repoRoot, 'rev-parse', 'HEAD'),
    git(repoRoot, 'rev-parse', 'HEAD^{tree}'),
    git(repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'),
    loadActualConfiguration(repoRoot),
    exactFiles(readiness, repoRoot),
    execFileAsync('git', ['merge-base', '--is-ancestor', readinessHead, 'HEAD'], { cwd: repoRoot })
      .then(() => true, () => false),
    git(repoRoot, 'diff', '--name-only', `${readinessHead}..HEAD`).then((value) => (
      value ? value.split('\n').filter(Boolean) : []
    )),
  ]);
  const readinessTreeActual = await git(repoRoot, 'rev-parse', `${readinessHead}^{tree}`);
  if (!ancestry || readinessTreeActual !== readinessTree
    || changedSinceReadiness.some((path) => !CEREMONY_SOURCE_PATHS.has(path))) {
    fail('Readiness HEAD/tree is not the exact ancestor plus ceremony-only implementation.',
      'PACK_CEREMONY_SOURCE_DRIFT', { readinessHead, readinessTree, readinessTreeActual,
        head, tree, changedSinceReadiness });
  }
  const allowed = validateWorktreeStatus(status);
  const readinessUntracked = readiness.lock.source?.allowedUntrackedPaths || [];
  if (readinessUntracked.some((path) => !ALLOWED_UNTRACKED.includes(path))) {
    fail('Readiness itself contains an unapproved untracked path.', 'PACK_CEREMONY_WORKTREE_DIRTY');
  }
  if (readiness.lock.productGates?.expansionPackV8ReleaseEnabledBeforePublication !== false
    || readiness.lock.productGates?.commerceV5ReleaseEnabled !== false
    || readiness.lock.productGates?.completeBridgeEnabled !== false
    || readiness.lock.productGates?.physicalBridgeEnabled !== false) {
    fail('Readiness product gates are not all false.', 'PACK_CEREMONY_GATE_OPEN');
  }
  const snapshot = {
    path: resolve(readinessPath), bytesSha256: sha256(readinessBytes),
    lockFingerprintSha256: fingerprint, head, tree, allowedUntrackedPaths: allowed,
    readinessSource: { head: readinessHead, tree: readinessTree }, changedSinceReadiness,
  };
  if (expected) same(snapshot, expected, 'Readiness/source snapshot');
  return { readiness, snapshot, configuration, exact };
}

export function assertExactSuiLock(data, action) {
  const transaction = data?.transaction;
  if (!transaction || !text(transaction.bytesBase64)
    || hash(transaction.bytesSha256, 'Transaction bytes SHA-256')
      !== sha256(Buffer.from(transaction.bytesBase64, 'base64'))
    || !text(transaction.digest) || !transaction.data || !data.simulation
    || !Array.isArray(data.objects)) {
    fail('Sui action lock is missing exact bytes/SHA/digest/data/simulation/objects.',
      'PACK_CEREMONY_SUI_LOCK_INCOMPLETE');
  }
  const gas = transaction.data.gasData || {};
  if (data.payment?.length !== 0 || data.gasMode !== 'address-balance'
    || gas.payment?.length !== 0 || text(gas.owner).toLowerCase() !== text(action.authority.signer).toLowerCase()
    || !text(gas.price) || !text(gas.budget) || !transaction.data.expiration?.ValidDuring) {
    fail('Sui lock must use Address Balance gas, payment=[], exact owner/price/budget and ValidDuring.',
      'PACK_CEREMONY_GAS_INVALID');
  }
  return data;
}

export function assertWalrusCheckpoint(progress, stage) {
  if (!progress || progress.stage !== stage || !progress.quiltBlobId
    || !progress.uploadSessionId) {
    fail(`Walrus ${stage} checkpoint is incomplete.`, 'PACK_CEREMONY_WALRUS_CHECKPOINT_INVALID');
  }
  if (stage === 'uploaded' && (!progress.certificate || !progress.blobObjectId
    || !progress.registerDigest)) {
    fail('Walrus uploaded checkpoint must persist certificate/blob object/register digest.',
      'PACK_CEREMONY_WALRUS_CHECKPOINT_INVALID');
  }
  if (stage === 'certified' && (!progress.certifyDigest || !progress.filePatchIds
    || progress.certificationVisible !== true || progress.fileReadbacksVerified !== true)) {
    fail('Walrus certified checkpoint must contain exact file readback evidence.',
      'PACK_CEREMONY_WALRUS_CHECKPOINT_INVALID');
  }
  return progress;
}

export async function initializeCeremony({ repoRoot, readinessPath, statePath, nonce } = {}) {
  assertExternalStatePath(repoRoot, statePath);
  const verified = await validateReadiness({ repoRoot, readinessPath });
  const overlay = actionRuntime(verified.configuration.runtime);
  const plan = await buildExpansionPackPublicationPlan({
    candidate: verified.exact.candidate,
    context: planContext(verified.readiness, overlay),
    runtime: overlay,
  });
  assertSafePlan(plan);
  const recovery = await createExpansionPackPublicationRecovery({
    plan, nonce: nonce || `free-pack-v8-${randomBytes(16).toString('hex')}`,
  });
  const authorization = {
    purpose: 'resolve-exact-free-pack-publication-actions-only',
    actualExpansionPackV8ReleaseEnabled: false,
    overlayExpansionPackV8ReleaseEnabled: true,
    planIdentity: plan.planIdentity,
  };
  const state = {
    schemaVersion: CEREMONY_SCHEMA, version: 1, createdAt: new Date().toISOString(),
    repoRoot: resolve(repoRoot), statePath: resolve(statePath), readiness: verified.snapshot,
    authorization, authorizationSha256: sha256(stableJson(authorization)),
    plan, recovery, locks: {}, signed: {}, walrus: {}, receipts: [],
  };
  return atomicWriteJson0600(statePath, state);
}

export async function loadCeremony(statePath, { validate = true } = {}) {
  const state = JSON.parse(await readFile(resolve(statePath), 'utf8'));
  if (state.schemaVersion !== CEREMONY_SCHEMA || state.version !== 1
    || state.authorizationSha256 !== sha256(stableJson(state.authorization))
    || state.authorization?.actualExpansionPackV8ReleaseEnabled !== false
    || state.authorization?.overlayExpansionPackV8ReleaseEnabled !== true
    || state.authorization?.planIdentity !== state.plan?.planIdentity) {
    fail('Ceremony state or authorization hash is invalid.', 'PACK_CEREMONY_STATE_INVALID');
  }
  assertExternalStatePath(state.repoRoot, statePath);
  assertSafePlan(state.plan);
  state.recovery = await hydrateExpansionPackPublicationRecovery(state.recovery, { plan: state.plan });
  if (validate) await validateReadiness({
    repoRoot: state.repoRoot, readinessPath: state.readiness.path, expected: state.readiness,
  });
  return state;
}

export async function ceremonyStatus(statePath) {
  const state = await loadCeremony(statePath);
  const action = await nextExpansionPackPublicationAction({
    recovery: state.recovery, plan: state.plan, runtime: actionRuntime((await loadActualConfiguration(state.repoRoot)).runtime),
  });
  return {
    schemaVersion: CEREMONY_SCHEMA, completed: state.recovery.completed,
    stage: state.recovery.stage, sequence: state.recovery.sequence,
    currentActionIndex: state.recovery.currentActionIndex,
    currentAction: action ? { id: action.id, transport: action.transport, target: action.target } : null,
    readiness: state.readiness, authorizationSha256: state.authorizationSha256,
  };
}

function lockBody(action, snapshot, data) {
  return { actionId: action.id, transport: action.transport, target: action.target,
    action: clone(action), readiness: snapshot, ...stableValue(data) };
}

export async function lockCurrentAction(statePath, options = {}, adapters = {}) {
  const state = await loadCeremony(statePath);
  const actual = await loadActualConfiguration(state.repoRoot);
  const overlay = actionRuntime(actual.runtime);
  let recovery = await beginExpansionPackPublicationAction({ recovery: state.recovery, plan: state.plan, runtime: overlay });
  const action = await nextExpansionPackPublicationAction({ recovery, plan: state.plan, runtime: overlay });
  if (!action) fail('Ceremony is already complete.', 'PACK_CEREMONY_COMPLETE');
  const existing = state.locks[action.id];
  let data;
  if (action.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI) {
    if (!adapters.lockSui) fail('Sui lock adapter is unavailable.', 'PACK_CEREMONY_ADAPTER_MISSING');
    data = await adapters.lockSui({ action, options, state });
    assertExactSuiLock(data, action);
  } else if (action.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.WALRUS) {
    if (!adapters.lockWalrus) fail('Walrus lock adapter is unavailable.', 'PACK_CEREMONY_ADAPTER_MISSING');
    data = await adapters.lockWalrus({ action, options, state });
    if (data.fileCount !== 2 || !data.quiltBlobId || !data.quote || !data.balances) {
      fail('Walrus lock must bind two exact files, Quilt, fresh quote and balances.', 'PACK_CEREMONY_WALRUS_LOCK_INVALID');
    }
    if (['walrus.pack.register-upload', 'walrus.pack.certify'].includes(action.id)) {
      assertExactSuiLock(data, action);
    }
  } else {
    data = adapters.lockLocal ? await adapters.lockLocal({ action, options, state }) : { kind: action.transport };
  }
  const body = lockBody(action, state.readiness, data);
  const lock = { schemaVersion: ACTION_LOCK_SCHEMA, createdAt: new Date().toISOString(),
    lockFingerprintSha256: sha256(stableJson(body)), lock: body };
  if (existing && existing.lockFingerprintSha256 !== lock.lockFingerprintSha256) {
    fail('Current action already has a different immutable lock.', 'PACK_CEREMONY_ACTION_LOCK_CONFLICT');
  }
  state.recovery = recovery;
  state.locks[action.id] = existing || lock;
  await atomicWriteJson0600(statePath, state);
  return state.locks[action.id];
}

async function confirmAndPersist(statePath, state, action, submission, confirmation) {
  state.recovery = await confirmExpansionPackPublicationAction({
    recovery: state.recovery, plan: state.plan, actionId: action.id, confirmation,
  });
  state.receipts.push({ actionId: action.id, transport: action.transport, submission, confirmation });
  await atomicWriteJson0600(statePath, state);
  return { actionId: action.id, completed: state.recovery.completed, confirmation };
}

async function persistSubmitted(statePath, state, action, signed) {
  state.recovery = await markExpansionPackPublicationSubmitted({
    recovery: state.recovery, plan: state.plan, actionId: action.id,
    submission: signed.submission,
  });
  state.signed[action.id] = signed;
  await atomicWriteJson0600(statePath, state);
  const readback = await loadCeremony(statePath);
  same(readback.signed[action.id], signed, 'Persisted signed transaction');
  return readback;
}

export async function executeCurrentAction(statePath, options = {}, adapters = {}) {
  let state = await loadCeremony(statePath);
  const actual = await loadActualConfiguration(state.repoRoot);
  const overlay = actionRuntime(actual.runtime);
  const action = await nextExpansionPackPublicationAction({ recovery: state.recovery, plan: state.plan, runtime: overlay });
  if (!action) fail('Ceremony is already complete.', 'PACK_CEREMONY_COMPLETE');
  const current = state.recovery.actions[state.recovery.currentActionIndex];
  const locked = state.locks[action.id];
  if (!locked || current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
    fail('Lock the current action before execution.', 'PACK_CEREMONY_ACTION_UNLOCKED');
  }
  if (locked.lockFingerprintSha256 !== text(options.expectedLock)) {
    fail('--expected-lock must equal the current action lock.', 'PACK_CEREMONY_LOCK_MISMATCH');
  }
  const durablePending = action.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI
    ? current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED
    : Boolean(state.walrus[action.id]?.pendingTransaction);
  if (adapters.rebuild && !durablePending) {
    const rebuiltData = await adapters.rebuild({ action, options, state, lock: locked.lock });
    const rebuiltBody = lockBody(action, state.readiness, rebuiltData);
    if (sha256(stableJson(rebuiltBody)) !== locked.lockFingerprintSha256) {
      fail('Pre-sign action inputs, bytes, objects, quote, or simulation drifted.', 'PACK_CEREMONY_PRE_SIGN_DRIFT');
    }
  }
  if ([EXPANSION_PACK_PUBLICATION_TRANSPORTS.READBACK, EXPANSION_PACK_PUBLICATION_TRANSPORTS.LOCAL]
    .includes(action.transport)) {
    const result = await adapters.executeLocal({ action, state, lock: locked.lock });
    const submission = { actionId: action.id, local: true };
    state.recovery = await markExpansionPackPublicationSubmitted({ recovery: state.recovery,
      plan: state.plan, actionId: action.id, submission });
    await atomicWriteJson0600(statePath, state);
    return confirmAndPersist(statePath, state, action, submission, result);
  }
  if (action.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI) {
    if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT) {
      const signed = await adapters.signSui({ action, state, lock: locked.lock });
      const bytes = fromBase64(signed.bytesBase64);
      if (sha256(bytes) !== locked.lock.transaction.bytesSha256
        || TransactionDataBuilder.getDigestFromBytes(bytes) !== locked.lock.transaction.digest
        || signed.submission.transactionDigest !== locked.lock.transaction.digest) {
        fail('Signed Sui bytes do not match the exact transaction lock.', 'PACK_CEREMONY_SIGNED_BYTES_MISMATCH');
      }
      state = await persistSubmitted(statePath, state, action, signed);
    }
    return recoverSubmittedAction(statePath, options, adapters);
  }
  if (action.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.WALRUS) {
    if (!adapters.executeWalrus) fail('Walrus execution adapter is unavailable.', 'PACK_CEREMONY_ADAPTER_MISSING');
    const result = await adapters.executeWalrus({ action, state, lock: locked.lock,
      checkpoint: async (progress) => {
        state.recovery = await recordExpansionPackPublicationProgress({ recovery: state.recovery,
          plan: state.plan, actionId: action.id, progress });
        state.walrus[action.id] = progress;
        await atomicWriteJson0600(statePath, state);
      } });
    const submission = clone(result.submission);
    state.recovery = await markExpansionPackPublicationSubmitted({ recovery: state.recovery,
      plan: state.plan, actionId: action.id, submission });
    await atomicWriteJson0600(statePath, state);
    return confirmAndPersist(statePath, state, action, submission, result.confirmation);
  }
  fail(`Unsupported transport ${action.transport}.`, 'PACK_CEREMONY_TRANSPORT_UNSUPPORTED');
}

export async function recoverSubmittedAction(statePath, options = {}, adapters = {}) {
  const state = await loadCeremony(statePath);
  const actual = await loadActualConfiguration(state.repoRoot);
  const action = await nextExpansionPackPublicationAction({ recovery: state.recovery, plan: state.plan,
    runtime: actionRuntime(actual.runtime) });
  const current = state.recovery.actions[state.recovery.currentActionIndex];
  if (action?.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.WALRUS
    && current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT
    && state.walrus[action.id]) {
    const lock = state.locks[action.id];
    if (!lock) fail('Walrus recovery is missing its immutable action lock.', 'PACK_CEREMONY_ACTION_UNLOCKED');
    return executeCurrentAction(statePath, { ...options,
      expectedLock: lock.lockFingerprintSha256 }, adapters);
  }
  if (!action || current.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED) {
    fail('Current action has no durable submitted transaction to recover.', 'PACK_CEREMONY_NOT_SUBMITTED');
  }
  if (action.transport !== EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI) {
    if (!adapters.recoverWalrus) fail('Walrus recovery adapter is unavailable.', 'PACK_CEREMONY_ADAPTER_MISSING');
    const result = await adapters.recoverWalrus({ action, state, progress: state.walrus[action.id] });
    return confirmAndPersist(statePath, state, action, current.submission, result.confirmation);
  }
  const signed = state.signed[action.id];
  if (!signed) fail('Submitted Sui action is missing durable signed bytes.', 'PACK_CEREMONY_SIGNED_BYTES_MISSING');
  // Mandatory query-first recovery: broadcast is reached only after a definitive not-found.
  let indexed = await adapters.querySui({ action, state, signed });
  if (!indexed) indexed = await adapters.broadcastSui({ action, state, signed });
  const finalized = await adapters.waitSui({ action, state, signed, indexed });
  const confirmation = await adapters.readbackSui({ action, state, signed, finalized });
  return confirmAndPersist(statePath, state, action, current.submission, confirmation);
}

export async function ceremonyReceipt(statePath) {
  const state = await loadCeremony(statePath);
  const completed = completedExpansionPackPublication({ plan: state.plan, recovery: state.recovery });
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA, createdAt: new Date().toISOString(),
    readiness: state.readiness, authorizationSha256: state.authorizationSha256,
    planIdentity: state.plan.planIdentity, recoveryIdentity: state.recovery.recoveryIdentity,
    freeOnly: true, actualExpansionPackV8ReleaseEnabled: false,
    noSealPolicy: !state.plan.actions.some((entry) => /seal-policy/.test(entry.id)),
    ...completed, actions: clone(state.receipts),
  };
  return { ...receipt, receiptSha256: sha256(stableJson(receipt)) };
}

export function candidateFileBytes(state, readiness, repoRoot) {
  const candidate = readiness.lock.pack.candidate;
  const asset = readiness.lock.pack.intent.asset;
  return Promise.all([
    Promise.resolve({ identifier: candidate.manifestIdentifier,
      bytes: Buffer.from(candidate.manifestJson, 'utf8'), mediaType: 'application/json', kind: 'manifest' }),
    readFile(resolve(repoRoot, asset.sourcePath)).then((bytes) => ({ identifier: asset.identifier,
      bytes, mediaType: asset.mediaType, kind: 'layer' })),
  ]);
}
