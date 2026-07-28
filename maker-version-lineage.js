function normalizedObjectId(value) {
  return String(value || '').trim().toLowerCase();
}

function versionFields(document) {
  return document && typeof document === 'object' && document.version
    ? document.version
    : null;
}

/**
 * Finds an immutable on-chain version that makes a local successor draft stale.
 *
 * Version IDs are deterministic (for example root-v2), so they are not unique
 * publication witnesses. Two devices can independently create root-v2 from the
 * same parent. The Sui Maker object ID is the publication identity that must be
 * compared at the final signature boundary.
 */
export function findMakerVersionDraftConflict({
  workingDocument,
  publishedDocument,
  publishedVersions = [],
  currentMakerObjectId = '',
} = {}) {
  const workingVersion = versionFields(workingDocument);
  const publishedVersion = versionFields(publishedDocument);
  if (
    !workingVersion
    || !publishedVersion
    || String(workingVersion.versionId || '') === String(publishedVersion.versionId || '')
  ) return null;

  const draftParentVersionId = String(
    workingVersion.parentVersionId
      || publishedVersion.versionId
      || '',
  );
  const draftVersionNumber = Number(workingVersion.number || 0);
  const publishedVersionNumber = Number(publishedVersion.number || 0);
  const currentObjectId = normalizedObjectId(currentMakerObjectId);

  return (Array.isArray(publishedVersions) ? publishedVersions : [])
    .filter((version) => {
      if (!version || typeof version !== 'object') return false;
      const objectId = normalizedObjectId(version.makerObjectId);
      if (currentObjectId && objectId === currentObjectId) return false;
      const versionNumber = Number(version.versionNumber || 0);
      if (versionNumber <= publishedVersionNumber) return false;
      return (
        String(version.parentVersionId || '') === draftParentVersionId
        || versionNumber >= draftVersionNumber
      );
    })
    .sort((left, right) => (
      Number(
        String(right.parentVersionId || '') === draftParentVersionId,
      ) - Number(
        String(left.parentVersionId || '') === draftParentVersionId,
      )
      || Number(left.versionNumber || 0) - Number(right.versionNumber || 0)
      || normalizedObjectId(left.makerObjectId).localeCompare(
        normalizedObjectId(right.makerObjectId),
      )
    ))[0] || null;
}
