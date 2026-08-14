function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function comparableId(value) {
  const raw = lower(value);
  if (!/^0x[0-9a-f]+$/.test(raw)) return raw;
  try {
    return `0x${BigInt(raw).toString(16)}`;
  } catch {
    return raw;
  }
}

function comparableHash(value) {
  return lower(value).replace(/^0x/, '');
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function lifecycleError(error) {
  return text(error?.message || error) || 'Expansion Pack lifecycle readback failed.';
}

function localIdentity(summary) {
  const identity = summary?.identity || {};
  const project = summary?.project || {};
  const parent = project.parentBinding || {};
  return Object.freeze({
    walletAddress: comparableId(identity.walletAddress || project.ownerWalletAddress),
    parentReleaseId: comparableId(
      identity.parentReleaseId || parent.releaseId || summary?.parentReleaseId,
    ),
    parentVersion: text(parent.versionNumber || summary?.parentVersion || identity.parentVersion),
    parentVersionId: text(identity.parentVersionId || parent.versionId),
    parentManifestBlobId: text(identity.parentManifestBlobId || parent.manifestBlobId),
    parentManifestSha256: comparableHash(
      identity.parentManifestHash || parent.manifestHash,
    ),
    packId: text(summary?.packId || identity.packId || project.packId),
    packVersion: text(summary?.version || project.version),
    namespace: text(summary?.namespace || project.namespace),
  });
}

function chainIdentity(descriptor) {
  const release = descriptor?.release || descriptor || {};
  return Object.freeze({
    walletAddress: comparableId(release.creator),
    parentReleaseId: comparableId(release.parentLegacyMakerId),
    parentVersion: text(release.parentVersion),
    parentVersionId: text(release.parentVersionId),
    parentManifestBlobId: text(release.parentManifestBlobId),
    parentManifestSha256: comparableHash(release.parentManifestSha256),
    packId: text(release.packId),
    packVersion: text(release.packVersion),
    namespace: text(release.namespace),
  });
}

function exactMatch(local, chain) {
  return Boolean(
    local.walletAddress
    && local.walletAddress === chain.walletAddress
    && local.parentReleaseId
    && local.parentReleaseId === chain.parentReleaseId
    && local.parentVersion
    && local.parentVersion === chain.parentVersion
    && local.parentManifestBlobId
    && local.parentManifestBlobId === chain.parentManifestBlobId
    && local.parentManifestSha256
    && local.parentManifestSha256 === chain.parentManifestSha256
    && local.packId
    && local.packId === chain.packId
    && local.packVersion
    && local.packVersion === chain.packVersion
    && (!local.parentVersionId || !chain.parentVersionId
      || local.parentVersionId === chain.parentVersionId)
    && (!local.namespace || !chain.namespace || local.namespace === chain.namespace)
  );
}

function chainKey(descriptor) {
  const releaseId = comparableId(descriptor?.release?.objectId || descriptor?.releaseId);
  return releaseId ? `chain:${releaseId}` : '';
}

function lifecycleRecoveryDescriptor(descriptor) {
  const pending = Array.isArray(descriptor?.lifecycleRecovery?.pending)
    ? descriptor.lifecycleRecovery.pending
    : [];
  const failures = Array.isArray(descriptor?.lifecycleRecovery?.finalizedFailures)
    ? descriptor.lifecycleRecovery.finalizedFailures
    : [];
  if (pending.length) return {
    ...clone(descriptor),
    state: 'recoverable',
    allowedActions: [],
    lifecycleRecovery: clone(descriptor.lifecycleRecovery),
  };
  if (failures.length) return {
    ...clone(descriptor),
    state: 'finalized-failure',
    allowedActions: [],
    lifecycleRecovery: clone(descriptor.lifecycleRecovery),
  };
  return clone(descriptor);
}

export function applyExpansionPackLifecycleRecovery(descriptor, recovery = {}) {
  return lifecycleRecoveryDescriptor({ ...clone(descriptor), lifecycleRecovery: clone(recovery) });
}

function publicationLifecycle(publication) {
  if (!publication) return { state: 'local-draft' };
  if (publication.error) return { state: 'unknown', error: lifecycleError(publication.error) };
  if (publication.receipt?.packReleaseId || publication.receipt?.transactionDigest) {
    return {
      state: 'recoverable',
      error: 'The verified publication receipt is waiting for authoritative chain readback.',
      publication: clone(publication),
    };
  }
  if (publication.started || publication.checkpoint) {
    return {
      state: publication.recoverable === false ? 'publishing' : 'recoverable',
      publication: clone(publication),
    };
  }
  return { state: 'local-draft' };
}

/**
 * Merge local projects, publication checkpoints and fresh chain descriptors.
 * Chain state is authoritative. Ambiguous matches stay unknown and every
 * unmatched chain Release remains visible as a chain-only management row.
 */
export function mergeExpansionPackLifecycleInventory({
  summaries = [],
  chainDescriptors = [],
  publicationByKey = new Map(),
} = {}) {
  const locals = Array.isArray(summaries) ? summaries : [];
  const chains = Array.isArray(chainDescriptors) ? chainDescriptors : [];
  const publication = publicationByKey instanceof Map
    ? publicationByKey
    : new Map(Object.entries(publicationByKey || {}));
  const consumed = new Set();
  const result = locals.map((summary) => {
    const identity = localIdentity(summary);
    const matches = chains
      .map((descriptor, index) => ({ descriptor, index, identity: chainIdentity(descriptor) }))
      .filter((entry) => !consumed.has(entry.index) && exactMatch(identity, entry.identity));
    if (matches.length === 1) {
      consumed.add(matches[0].index);
      return Object.freeze({
        key: text(summary?.key),
        lifecycle: lifecycleRecoveryDescriptor(matches[0].descriptor),
      });
    }
    if (matches.length > 1) {
      return Object.freeze({
        key: text(summary?.key),
        lifecycle: Object.freeze({
          state: 'unknown',
          error: 'More than one on-chain Expansion Pack matches this local project.',
        }),
      });
    }
    return Object.freeze({
      key: text(summary?.key),
      lifecycle: Object.freeze(publicationLifecycle(publication.get(text(summary?.key)))),
    });
  });

  chains.forEach((descriptor, index) => {
    if (consumed.has(index)) return;
    const release = descriptor?.release || {};
    const key = chainKey(descriptor);
    if (!key) return;
    result.push(Object.freeze({
      key,
      packId: text(release.packId),
      name: text(release.packId) || key,
      version: text(release.packVersion),
      namespace: text(release.namespace),
      identity: Object.freeze({
        walletAddress: comparableId(release.creator),
        parentRootId: comparableId(release.parentRootId),
        parentVersion: text(release.parentVersion),
        parentReleaseId: comparableId(release.parentLegacyMakerId),
        parentManifestBlobId: text(release.parentManifestBlobId),
        parentManifestHash: comparableHash(release.parentManifestSha256),
        packId: text(release.packId),
      }),
      lifecycle: lifecycleRecoveryDescriptor(descriptor),
      chainOnly: true,
    }));
  });
  return Object.freeze(result);
}

export function expansionPackLifecycleInventoryIdentity(value) {
  return value?.release ? chainIdentity(value) : localIdentity(value);
}
