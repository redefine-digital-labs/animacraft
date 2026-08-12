import {
  EXPANSION_PACK_PUBLICATION_ACTION_STATUS,
  EXPANSION_PACK_PUBLICATION_STAGES,
  beginExpansionPackPublicationAction,
  buildExpansionPackPublicationPlan,
  completedExpansionPackPublication,
  confirmExpansionPackPublicationAction,
  createExpansionPackPublicationRecovery,
  markExpansionPackPublicationSubmitted,
  materializeExpansionPackPublicationCandidate,
  nextExpansionPackPublicationAction,
  recordExpansionPackPublicationError,
  recordExpansionPackPublicationFinalizedFailure,
  recordExpansionPackPublicationProgress,
} from './expansion-pack-publication-recovery.js';
import {
  hashExpansionPackContent,
  protectExpansionPackPublicationCandidate,
} from './expansion-pack-publication.js';

const WALRUS_MANIFEST_KIND = 'expansion-pack-manifest';

export class ExpansionPackPublicationControllerError extends Error {
  constructor(message, code = 'EXPANSION_PACK_PUBLICATION_CONTROLLER_ERROR', details = {}) {
    super(message);
    this.name = 'ExpansionPackPublicationControllerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExpansionPackPublicationControllerError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizedHash(value) {
  return text(value).replace(/^0x/i, '').toLowerCase();
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function publicationNonce() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `pack-${globalThis.crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pack-${Date.now().toString(36)}-${suffix || Math.random().toString(36).slice(2)}`;
}

function requireDependency(dependencies, name) {
  const callback = dependencies?.[name];
  if (typeof callback !== 'function') {
    fail(
      'EXPANSION_PACK_PUBLICATION_DEPENDENCY_MISSING',
      `Expansion Pack publication requires ${name}.`,
      { name },
    );
  }
  return callback;
}

function paidCandidate(candidate) {
  return ['PAID', 'PAID_ONCE'].includes(
    text(candidate?.manifest?.commerce?.accessMode).toUpperCase(),
  );
}

async function exactUploadEntries(candidate, project, { transportAssets = [] } = {}) {
  const assets = new Map();
  list(project?.pack?.assets).forEach((asset) => {
    const id = text(asset?.id ?? asset?.assetId);
    const identifier = text(asset?.identifier);
    if (id) assets.set(`id:${id}`, asset);
    if (identifier) assets.set(`identifier:${identifier}`, asset);
  });
  const protectedAssets = new Map();
  list(transportAssets).forEach((asset) => {
    const id = text(asset?.assetId || asset?.id);
    const identifier = text(asset?.identifier);
    if (id) protectedAssets.set(`id:${id}`, asset);
    if (identifier) protectedAssets.set(`identifier:${identifier}`, asset);
  });
  const entries = [];
  for (const descriptor of list(candidate?.files)) {
    const identifier = text(descriptor?.identifier);
    let blob;
    if (identifier === text(candidate?.manifestIdentifier)) {
      blob = new Blob([candidate.manifestJson], { type: 'application/json' });
    } else {
      const protectedSource = protectedAssets.get(`id:${text(descriptor?.id)}`)
        || protectedAssets.get(`identifier:${identifier}`);
      const source = protectedSource
        || assets.get(`id:${text(descriptor?.id)}`)
        || assets.get(`identifier:${identifier}`);
      blob = source?.blob || source?.file;
    }
    if (!(blob instanceof Blob)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_ASSET_BLOB_MISSING',
        `The exact Pack asset ${identifier || descriptor?.id || ''} is no longer available locally.`,
        { identifier, assetId: descriptor?.id || '' },
      );
    }
    const observed = await hashExpansionPackContent(await blob.arrayBuffer());
    if (observed !== normalizedHash(descriptor?.sha256)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_ASSET_BLOB_CHANGED',
        `The bytes for ${identifier} changed after the publication snapshot was prepared.`,
        { identifier, expected: descriptor?.sha256, actual: observed },
      );
    }
    entries.push(Object.freeze({
      identifier,
      kind: identifier === text(candidate?.manifestIdentifier)
        ? WALRUS_MANIFEST_KIND
        : text(descriptor?.kind) || 'layer',
      blob,
    }));
  }
  return Object.freeze(entries);
}

function walrusRecovery(session) {
  if (!session) return null;
  return {
    owner: text(session.owner),
    uploadSessionId: text(session.uploadSessionId),
    recoveryRevision: Number(session.recoveryRevision || 0),
    stage: text(session.stage || session.checkpoint?.step),
    checkpoint: clone(session.checkpoint),
    registerDigest: text(session.registerDigest),
    certifyDigest: text(session.certifyDigest),
    relayTipMist: session.relayTipMist == null ? null : String(session.relayTipMist),
    relayTipQuotedAt: text(session.relayTipQuotedAt),
    walrusStorageCostFrost: session.walrusStorageCostFrost == null
      ? null
      : String(session.walrusStorageCostFrost),
    walrusWriteCostFrost: session.walrusWriteCostFrost == null
      ? null
      : String(session.walrusWriteCostFrost),
    walrusTotalCostFrost: session.walrusTotalCostFrost == null
      ? null
      : String(session.walrusTotalCostFrost),
    walletSuiBalanceMist: session.walletSuiBalanceMist == null
      ? null
      : String(session.walletSuiBalanceMist),
    walletWalBalanceFrost: session.walletWalBalanceFrost == null
      ? null
      : String(session.walletWalBalanceFrost),
    pendingRegisterTransaction: clone(session.pendingRegisterTransaction || null),
    pendingCertifyTransaction: clone(session.pendingCertifyTransaction || null),
    finalizedFailures: list(session.finalizedFailures).map((entry) => clone(entry)),
    quiltBlobId: text(session.quiltBlobId),
    files: list(session.files).map((file) => ({
      id: text(file?.id),
      blobId: text(file?.blobId),
    })),
  };
}

function actionStep(actionId) {
  if ([
    'parent.release.verify',
    'chain.parent.evidence.bind',
    'chain.pack.create',
    'local.pack.materialize',
    'walrus.pack.prepare',
  ].includes(actionId)) return 1;
  if (actionId === 'walrus.pack.register-upload') return 2;
  if (actionId === 'walrus.pack.certify') return 3;
  return 4;
}

function actionLabel(actionId) {
  if (actionId === 'parent.release.verify') return 'Verifying the exact parent Maker release…';
  if (actionId === 'chain.parent.evidence.bind') return 'Anchoring the exact parent release on Sui…';
  if (actionId === 'walrus.pack.prepare') return 'Encoding the immutable Pack Quilt…';
  if (actionId === 'walrus.pack.register-upload') return 'Registering and uploading the Pack Quilt…';
  if (actionId === 'walrus.pack.certify') return 'Certifying the Pack Quilt on Walrus…';
  if (actionId === 'local.pack.materialize') return 'Binding the Pack artwork to its exact Release…';
  if (actionId === 'chain.pack.manifest.bind') return 'Binding the certified Pack manifest on Sui…';
  if (actionId?.startsWith('chain.pack.style.register.')) return 'Registering an exact Pack Style on Sui…';
  if (actionId === 'chain.pack.create') return 'Creating the Expansion Pack release on Sui…';
  if (actionId === 'chain.pack.seal') return 'Sealing the Pack Style registry…';
  if (actionId === 'chain.pack.seal-policy.bind') return 'Binding the paid Pack Seal policy…';
  if (actionId === 'chain.pack.admit') return 'Binding the Pack to the exact parent Maker…';
  if (actionId === 'chain.pack.activate') return 'Activating the verified Expansion Pack…';
  return 'Preparing the Expansion Pack release…';
}

function latestWalrusRecovery(recovery) {
  const actions = list(recovery?.actions);
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const entry = actions[index];
    const candidate = entry?.outputs?.walrusRecovery
      || entry?.confirmation?.walrusRecovery
      || entry?.submission?.walrusRecovery
      || entry?.progress?.walrusRecovery
      || entry?.progress;
    if (candidate?.checkpoint) return candidate;
  }
  return null;
}

function exactDigest(submission) {
  return text(submission?.digest || submission?.transactionDigest);
}

/**
 * Recoverable coordinator for the four visible product steps. Every internal
 * action still has a durable intent/submission/readback boundary.
 */
export class ExpansionPackPublicationController {
  constructor(options = {}) {
    this.runtime = Object.freeze({ ...object(options.runtime) });
    this.context = Object.freeze({ ...object(options.context) });
    this.candidate = options.candidate || null;
    this.project = options.project || null;
    this.dependencies = object(options.dependencies);
    this.isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
    this.onState = typeof options.onState === 'function' ? options.onState : () => {};
    this.plan = options.plan || null;
    this.recovery = options.recovery || null;
    this.entries = options.entries || null;
    this.entriesVerified = false;
    this.session = null;
    this.receipt = options.receipt || null;
    this.busy = false;
  }

  assertActive() {
    if (!this.isActive()) {
      fail(
        'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
        'The active wallet, parent Maker or Expansion Pack changed. The checkpoint was kept and no later step was started.',
      );
    }
  }

  async persist() {
    const persist = this.dependencies.persist;
    if (!this.plan || !this.recovery) return null;
    if (typeof persist !== 'function') {
      fail(
        'EXPANSION_PACK_PUBLICATION_PERSISTENCE_MISSING',
        'A durable Expansion Pack publication store is required before any recoverable action.',
      );
    }
    const snapshot = {
      plan: this.plan,
      recovery: this.recovery,
      candidate: this.candidate,
      project: this.project,
      entries: this.entries,
      walrusRecovery: walrusRecovery(this.session) || latestWalrusRecovery(this.recovery),
      receipt: this.receipt,
    };
    const saved = await persist(snapshot);
    if (saved?.verified !== true || saved?.saved !== true) {
      fail(
        'EXPANSION_PACK_PUBLICATION_PERSISTENCE_FAILED',
        'The Expansion Pack publication checkpoint could not be saved and read back.',
      );
    }
    return saved;
  }

  async ensureEntriesVerified() {
    if (this.entriesVerified) return this.entries;
    if (paidCandidate(this.candidate) && this.candidate?.transportProtected === true) {
      if (!list(this.entries).length) {
        fail(
          'EXPANSION_PACK_PUBLICATION_PROTECTED_ENTRIES_MISSING',
          'The paid Pack ciphertext checkpoint is missing. Rebuild the publication snapshot before uploading.',
        );
      }
      this.entries = await exactUploadEntries(this.candidate, this.project, {
        transportAssets: this.entries,
      });
    } else {
      this.entries = await exactUploadEntries(this.candidate, this.project);
    }
    this.entriesVerified = true;
    return this.entries;
  }

  currentEntry() {
    if (!this.recovery || this.recovery.completed) return null;
    return this.recovery.actions[this.recovery.currentActionIndex] || null;
  }

  async currentAction() {
    if (!this.plan || !this.recovery) return null;
    return nextExpansionPackPublicationAction({
      plan: this.plan,
      recovery: this.recovery,
      runtime: this.runtime,
    });
  }

  uiState(overrides = {}) {
    const current = this.currentEntry();
    const id = current?.id || '';
    const step = this.receipt ? 4 : actionStep(id);
    const completedSteps = this.receipt
      ? [1, 2, 3, 4]
      : [1, 2, 3].filter((candidate) => candidate < step);
    const submitted = current?.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED;
    const errored = Boolean(this.recovery?.lastError);
    const actions = {
      prepare: !this.plan || [
        'parent.release.verify',
        'chain.parent.evidence.bind',
        'chain.pack.create',
        'local.pack.materialize',
        'walrus.pack.prepare',
      ].includes(id),
      register: id === 'walrus.pack.register-upload',
      certify: id === 'walrus.pack.certify',
      publish: actionStep(id) === 4 && Boolean(id?.startsWith('chain.pack.')) && !submitted,
      review: actionStep(id) === 4 && Boolean(id?.startsWith('chain.pack.')) && submitted,
      resume: errored && !submitted,
      export: true,
    };
    return {
      stage: this.receipt ? 'complete' : text(this.recovery?.stage || 'idle').toLowerCase(),
      step,
      completedSteps,
      status: this.receipt
        ? 'Expansion Pack published and verified.'
        : current
          ? actionLabel(id)
          : 'Prepare an immutable Expansion Pack release snapshot.',
      busy: this.busy,
      started: Boolean(this.plan),
      recoverable: Boolean(this.plan && !this.receipt),
      locked: Boolean(this.plan),
      available: this.runtime.expansionPackV8ReleaseEnabled === true,
      unavailableReason: this.runtime.expansionPackV8ReleaseEnabled === true
        ? ''
        : 'Expansion Pack v8 publication is disabled until its reviewed package is deployed.',
      error: this.recovery?.lastError
        ? {
            title: 'Expansion Pack release needs attention',
            message: this.recovery.lastError.message,
            code: this.recovery.lastError.code,
          }
        : null,
      receipt: this.receipt
        ? {
            packObjectId: this.receipt.packReleaseId,
            digest: this.receipt.transactionDigest,
            manifestBlobId: this.receipt.manifestBlobId,
            manifestSha256: this.receipt.manifestSha256,
          }
        : null,
      actions,
      ...overrides,
    };
  }

  emit(overrides = {}) {
    const state = this.uiState(overrides);
    this.onState(state);
    return state;
  }

  async withOperation(callback) {
    if (this.busy) return this.uiState();
    this.busy = true;
    this.emit();
    try {
      const result = await callback();
      return this.emit(result || {});
    } catch (error) {
      if (this.plan && this.recovery) {
        if (
          error?.code === 'TRANSACTION_FINALIZED_FAILURE'
          && error?.finalizedFailure?.finalized === true
          && error?.finalizedFailure?.executionStatus === 'FAILURE'
        ) {
          const submittedRecovery = this.recovery;
          try {
            this.recovery = await recordExpansionPackPublicationFinalizedFailure({
              plan: this.plan,
              recovery: submittedRecovery,
              error,
            });
            // A fresh signature is allowed only after the exact failed digest
            // and execution evidence have been saved and read back.
            await this.persist();
          } catch (archiveError) {
            this.recovery = submittedRecovery;
            this.emit();
            throw archiveError;
          }
        } else {
          this.recovery = await recordExpansionPackPublicationError({
            plan: this.plan,
            recovery: this.recovery,
            error,
          });
          await this.persist().catch(() => {});
        }
      }
      this.emit();
      throw error;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async beginCurrent() {
    this.assertActive();
    this.recovery = await beginExpansionPackPublicationAction({
      plan: this.plan,
      recovery: this.recovery,
      runtime: this.runtime,
    });
    this.assertActive();
    await this.persist();
    this.assertActive();
    return this.currentAction();
  }

  async submitAndConfirm(action, submission, confirmation) {
    this.recovery = await markExpansionPackPublicationSubmitted({
      plan: this.plan,
      recovery: this.recovery,
      actionId: action.id,
      submission,
    });
    await this.persist();
    this.assertActive();
    this.recovery = await confirmExpansionPackPublicationAction({
      plan: this.plan,
      recovery: this.recovery,
      actionId: action.id,
      confirmation,
    });
    await this.persist();
  }

  async confirmCurrent(action, confirmation) {
    this.assertActive();
    this.recovery = await confirmExpansionPackPublicationAction({
      plan: this.plan,
      recovery: this.recovery,
      actionId: action.id,
      confirmation,
    });
    await this.persist();
  }

  async verifyParent() {
    let action = await this.currentAction();
    if (action?.id !== 'parent.release.verify') return;
    if (this.currentEntry()?.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
      action = await this.beginCurrent();
    }
    const confirmation = await requireDependency(
      this.dependencies,
      'verifyParent',
    )(action);
    if (this.currentEntry()?.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED) {
      await this.confirmCurrent(action, confirmation);
    } else {
      await this.submitAndConfirm(
        action,
        { readback: true, verifiedAt: new Date().toISOString() },
        confirmation,
      );
    }
  }

  async executeCurrentSuiAction(expectedActionId = '') {
    let action = await this.currentAction();
    if (!action?.id?.startsWith('chain.pack.')
      && !action?.id?.startsWith('chain.parent.')) {
      fail(
        'EXPANSION_PACK_PUBLICATION_STEP_MISMATCH',
        'The current publication action is not a Sui write.',
      );
    }
    if (expectedActionId && action.id !== expectedActionId) return false;
    let current = this.currentEntry();
    if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED) {
      await this.readSubmittedSui(action);
      return true;
    }
    if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
      action = await this.beginCurrent();
      current = this.currentEntry();
    }
    if (current.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT) {
      fail(
        'EXPANSION_PACK_PUBLICATION_STEP_MISMATCH',
        'The Sui publication action is not ready for an exact signature.',
      );
    }
    const transaction = requireDependency(
      this.dependencies,
      'transactionFromAction',
    )(action, { sender: this.context.owner });
    this.assertActive();
    const signed = await requireDependency(
      this.dependencies,
      'signTransactionForRecovery',
    )(transaction, { expectedWallet: this.context.owner });
    const digest = exactDigest(signed);
    if (!digest || !text(signed?.bytes) || !text(signed?.signature)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_SIGNATURE_INCOMPLETE',
        'The wallet did not return durable signed transaction bytes.',
      );
    }
    // Signed bytes are persisted before the first broadcast. Every resume can
    // now only query/replay this exact digest and never request a replacement
    // signature for the same action.
    this.recovery = await markExpansionPackPublicationSubmitted({
      plan: this.plan,
      recovery: this.recovery,
      actionId: action.id,
      submission: {
        transactionDigest: digest,
        digest,
        bytes: text(signed.bytes),
        signature: text(signed.signature),
        signedAt: text(signed.signedAt) || new Date().toISOString(),
      },
    });
    await this.persist();
    this.assertActive();
    await this.readSubmittedSui(action);
    return true;
  }

  async materializeCurrent() {
    let action = await this.currentAction();
    if (action?.id !== 'local.pack.materialize') return false;
    let current = this.currentEntry();
    if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
      action = await this.beginCurrent();
      current = this.currentEntry();
    }

    const paid = Number(action.inputs.accessKind) === 1;
    if (current.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED) {
      if (paid) {
        if (this.candidate?.transportProtected !== true) {
          const protectedTransport = await protectExpansionPackPublicationCandidate(
            this.candidate,
            this.project,
            {
              sealClient: this.dependencies.sealClient,
              sealPackageId: this.runtime.expansionPackV8TypeOriginPackageId,
              releaseId: action.inputs.packReleaseId,
              threshold: this.dependencies.sealThreshold ?? this.runtime.sealThreshold,
              serverConfigs: this.dependencies.sealKeyServers
                || this.runtime.sealKeyServers
                || [],
            },
          );
          this.candidate = protectedTransport.candidate;
          this.entries = await exactUploadEntries(this.candidate, this.project, {
            transportAssets: protectedTransport.encryptedAssets,
          });
        } else {
          this.entries = await exactUploadEntries(this.candidate, this.project, {
            transportAssets: this.entries,
          });
        }
      } else {
        if (this.candidate?.manifest?.transportProtection
          || this.candidate?.transportProtected === true) {
          fail(
            'EXPANSION_PACK_PUBLICATION_FREE_TRANSPORT_PROTECTED',
            'A free Expansion Pack cannot publish paid Seal transport metadata.',
          );
        }
        this.entries = await exactUploadEntries(this.candidate, this.project);
      }
      this.entriesVerified = true;
      const confirmation = await materializeExpansionPackPublicationCandidate({
        candidate: this.candidate,
        context: this.context,
        runtime: this.runtime,
        releaseId: action.inputs.packReleaseId,
      });
      this.recovery = await markExpansionPackPublicationSubmitted({
        plan: this.plan,
        recovery: this.recovery,
        actionId: action.id,
        submission: {
          localMaterialization: true,
          packReleaseId: confirmation.packReleaseId,
          candidateCommitment: confirmation.candidateCommitment,
          manifestSha256: confirmation.manifestSha256,
        },
      });
      await this.persist();
      await this.confirmCurrent(action, confirmation);
      return true;
    }

    // A crash after persisting the ciphertext checkpoint confirms from the
    // exact stored bytes; it never encrypts a different candidate silently.
    await this.ensureEntriesVerified();
    const confirmation = await materializeExpansionPackPublicationCandidate({
      candidate: this.candidate,
      context: this.context,
      runtime: this.runtime,
      releaseId: action.inputs.packReleaseId,
    });
    await this.confirmCurrent(action, confirmation);
    return true;
  }

  async prepare() {
    return this.withOperation(async () => {
      if (!this.plan) {
        this.assertActive();
        if (this.candidate?.manifest?.transportProtection
          || this.candidate?.transportProtected === true) {
          fail(
            'EXPANSION_PACK_PUBLICATION_SOURCE_ALREADY_PROTECTED',
            'A new publication lane must start from the exact unprotected authoring snapshot.',
          );
        }
        this.plan = await buildExpansionPackPublicationPlan({
          candidate: this.candidate,
          context: this.context,
          runtime: this.runtime,
        });
        this.recovery = await createExpansionPackPublicationRecovery({
          plan: this.plan,
          nonce: publicationNonce(),
        });
        await this.persist();
      }

      await this.verifyParent();

      if ((await this.currentAction())?.id === 'chain.parent.evidence.bind') {
        await this.executeCurrentSuiAction('chain.parent.evidence.bind');
      }

      if ((await this.currentAction())?.id === 'chain.pack.create') {
        await this.executeCurrentSuiAction('chain.pack.create');
      }
      await this.materializeCurrent();

      let action = await this.currentAction();
      if (action?.id !== 'walrus.pack.prepare') return {};
      const current = this.currentEntry();
      if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED) {
        const persistedRecovery = current.submission?.walrusRecovery
          || current.progress?.walrusRecovery
          || current.progress;
        await this.confirmCurrent(action, {
          uploadSessionId: text(persistedRecovery?.uploadSessionId),
          quiltBlobId: text(persistedRecovery?.quiltBlobId),
          walrusRecovery: persistedRecovery,
        });
        return {};
      }
      if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
        action = await this.beginCurrent();
      }
      await this.ensureEntriesVerified();
      if (!this.session) {
        const persistedRecovery = latestWalrusRecovery(this.recovery);
        this.session = persistedRecovery
          ? await requireDependency(this.dependencies, 'resumeWalrusUpload')(
              this.entries,
              persistedRecovery,
            )
          : await requireDependency(this.dependencies, 'prepareWalrusUpload')(this.entries);
      }
      const recovery = walrusRecovery(this.session);
      this.recovery = await recordExpansionPackPublicationProgress({
        plan: this.plan,
        recovery: this.recovery,
        actionId: action.id,
        progress: recovery,
      });
      await this.persist();
      await this.submitAndConfirm(
        action,
        { uploadSessionId: recovery.uploadSessionId, walrusRecovery: recovery },
        {
          uploadSessionId: recovery.uploadSessionId,
          quiltBlobId: recovery.quiltBlobId,
          walrusRecovery: recovery,
        },
      );
      return {};
    });
  }

  async restoreWalrusSession() {
    await this.ensureEntriesVerified();
    if (this.session) return this.session;
    const recovery = latestWalrusRecovery(this.recovery);
    if (!recovery) {
      fail(
        'EXPANSION_PACK_WALRUS_RECOVERY_MISSING',
        'The Expansion Pack Walrus checkpoint is missing.',
      );
    }
    this.session = await requireDependency(
      this.dependencies,
      'resumeWalrusUpload',
    )(this.entries, recovery);
    return this.session;
  }

  async checkpoint(actionId, session) {
    this.assertActive();
    const previousRecovery = this.recovery;
    this.recovery = await recordExpansionPackPublicationProgress({
      plan: this.plan,
      recovery: this.recovery,
      actionId,
      progress: walrusRecovery(session),
    });
    try {
      await this.persist();
    } catch (error) {
      // The Walrus runtime also restores its in-memory pending transaction
      // when this checkpoint fails. Keep both layers on the same exact state.
      this.recovery = previousRecovery;
      throw error;
    }
  }

  async register() {
    return this.withOperation(async () => {
      let action = await this.currentAction();
      if (action?.id !== 'walrus.pack.register-upload') {
        fail('EXPANSION_PACK_PUBLICATION_STEP_MISMATCH', 'Prepare the Pack Quilt before uploading it.');
      }
      let current = this.currentEntry();
      if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
        action = await this.beginCurrent();
        current = this.currentEntry();
      }
      const alreadySubmitted = current.status
        === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED;
      const session = await this.restoreWalrusSession();
      if (!alreadySubmitted) {
        await requireDependency(this.dependencies, 'registerAndUploadWalrus')(session, {
          onCheckpoint: (checkpointSession) => this.checkpoint(action.id, checkpointSession),
        });
      }
      const recovery = walrusRecovery(session);
      const confirmation = {
        uploadSessionId: recovery.uploadSessionId,
        quiltBlobId: recovery.quiltBlobId,
        blobObjectId: text(session.checkpoint?.blobObjectId),
        registerDigest: recovery.registerDigest,
        uploaded: ['uploaded', 'certified'].includes(recovery.stage),
        walrusRecovery: recovery,
      };
      if (alreadySubmitted) {
        await this.confirmCurrent(action, confirmation);
      } else {
        await this.submitAndConfirm(
          action,
          {
            uploadSessionId: recovery.uploadSessionId,
            registerDigest: recovery.registerDigest,
            walrusRecovery: recovery,
          },
          confirmation,
        );
      }
      return {};
    });
  }

  async certify() {
    return this.withOperation(async () => {
      let action = await this.currentAction();
      if (action?.id !== 'walrus.pack.certify') {
        fail('EXPANSION_PACK_PUBLICATION_STEP_MISMATCH', 'Upload the Pack Quilt before certifying it.');
      }
      let current = this.currentEntry();
      if (current.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
        action = await this.beginCurrent();
        current = this.currentEntry();
      }
      const alreadySubmitted = current.status
        === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED;
      const session = await this.restoreWalrusSession();
      if (!alreadySubmitted) {
        await requireDependency(this.dependencies, 'certifyWalrusUpload')(session, {
          onCheckpoint: (checkpointSession) => this.checkpoint(action.id, checkpointSession),
        });
      }
      if (list(session.files).length !== this.entries.length) {
        fail(
          'EXPANSION_PACK_WALRUS_FILE_READBACK_MISMATCH',
          'The certified Pack Quilt file list does not match the frozen release snapshot.',
        );
      }
      const filePatchIds = Object.fromEntries(this.entries.map((entry, index) => [
        entry.identifier,
        text(session.files[index]?.id),
      ]));
      const registryRows = list(action.inputs.styles).map((style) => ({
        partKey: style.partKey,
        itemKey: style.itemKey,
        styleKey: style.styleKey,
        assetBlobId: filePatchIds[style.assetIdentifier],
        assetSha256: style.assetSha256,
        assetSealId: style.assetSealId,
      }));
      const styleRegistryCommitment = await hashExpansionPackContent(stableJson(registryRows));
      const recovery = walrusRecovery(session);
      const manifestQuiltPatchId = filePatchIds[action.inputs.manifestIdentifier];
      const confirmation = {
          uploadSessionId: recovery.uploadSessionId,
          quiltBlobId: recovery.quiltBlobId,
          blobObjectId: text(session.checkpoint?.blobObjectId),
          certifyDigest: recovery.certifyDigest,
          certified: recovery.stage === 'certified',
          certificationVisible: recovery.stage === 'certified',
          manifestQuiltPatchId,
          manifestIdentifier: action.inputs.manifestIdentifier,
          manifestSha256: action.inputs.manifestSha256,
          filePatchIds,
          styleRegistryCommitment,
          walrusRecovery: recovery,
        };
      if (alreadySubmitted) {
        await this.confirmCurrent(action, confirmation);
      } else {
        await this.submitAndConfirm(
          action,
          {
            uploadSessionId: recovery.uploadSessionId,
            certifyDigest: recovery.certifyDigest,
            walrusRecovery: recovery,
          },
          confirmation,
        );
      }
      return {};
    });
  }

  async readSubmittedSui(action) {
    const current = this.currentEntry();
    const submission = current?.submission;
    if (!submission || !exactDigest(submission)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_SUBMISSION_MISSING',
        'The submitted Expansion Pack transaction digest is missing.',
      );
    }
    if (text(submission.bytes) && text(submission.signature)) {
      await requireDependency(
        this.dependencies,
        'executeSignedTransactionAndWait',
      )(submission, {
        assertBeforeExecute: () => this.assertActive(),
      });
    }
    const confirmation = await requireDependency(
      this.dependencies,
      'readSuiSubmission',
    )(action, submission);
    this.assertActive();
    this.recovery = await confirmExpansionPackPublicationAction({
      plan: this.plan,
      recovery: this.recovery,
      actionId: action.id,
      confirmation,
    });
    await this.persist();
  }

  async publish() {
    return this.withOperation(async () => {
      while (!this.recovery?.completed) {
        const action = await this.currentAction();
        if (!action?.id?.startsWith('chain.pack.')) {
          fail(
            'EXPANSION_PACK_PUBLICATION_STEP_MISMATCH',
            'Certify the Pack Quilt before publishing it on Sui.',
          );
        }
        await this.executeCurrentSuiAction(action.id);
      }
      this.receipt = completedExpansionPackPublication({
        plan: this.plan,
        recovery: this.recovery,
      });
      // The immutable verified receipt is persisted before transient recovery
      // can ever be cleaned up by the host.
      await this.persist();
      await this.dependencies.onCompleted?.(clone(this.receipt));
      return {};
    });
  }

  async review() {
    return this.withOperation(async () => {
      const action = await this.currentAction();
      if (!action?.id?.startsWith('chain.pack.')
        || this.currentEntry()?.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED) {
        fail(
          'EXPANSION_PACK_PUBLICATION_REVIEW_UNAVAILABLE',
          'There is no submitted Expansion Pack transaction to review.',
        );
      }
      await this.readSubmittedSui(action);
      if (this.recovery.completed) {
        this.receipt = completedExpansionPackPublication({ plan: this.plan, recovery: this.recovery });
        await this.persist();
        await this.dependencies.onCompleted?.(clone(this.receipt));
      }
      return {};
    });
  }

  async resume() {
    const action = await this.currentAction();
    if (!action) return this.emit();
    if (actionStep(action.id) === 1) return this.prepare();
    if (action.id === 'walrus.pack.register-upload') return this.register();
    if (action.id === 'walrus.pack.certify') return this.certify();
    if (action.id?.startsWith('chain.pack.')) {
      return this.currentEntry()?.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED
        ? this.review()
        : this.publish();
    }
    return this.prepare();
  }
}

export function createExpansionPackPublicationController(options = {}) {
  return new ExpansionPackPublicationController(options);
}
