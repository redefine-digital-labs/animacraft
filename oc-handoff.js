function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

/**
 * Freeze the exact Player state that was reviewed when Complete OC was
 * pressed. The runtime document itself remains owned by MakerWorkspace; the
 * immutable fields below are the only Player-authored inputs to an OC package.
 */
export function createPlayerCompletionSnapshot({
  document,
  recipe,
  profile,
  livingContent,
} = {}) {
  const makerVersionId = String(document?.version?.versionId || '');
  if (!makerVersionId) throw new TypeError('A Maker version is required to complete an OC.');
  if (!recipe || typeof recipe !== 'object') throw new TypeError('A completed OC recipe is required.');
  if (!profile || typeof profile !== 'object') throw new TypeError('A completed OC profile is required.');
  if (!livingContent || typeof livingContent !== 'object') {
    throw new TypeError('Resolved Living Content is required to complete an OC.');
  }
  return deepFreeze({
    makerVersionId,
    recipe: clone(recipe),
    profile: clone(profile),
    livingContent: clone(livingContent),
  });
}

/**
 * Canonical JSON fingerprint of the complete immutable Walrus OC profile.
 * This deliberately covers Maker/version/Quilt provenance, resolved Living
 * Content, full recipe, Sui summary and integrity metadata.
 */
export function canonicalOcPackageFingerprint(packageValue) {
  if (!packageValue || typeof packageValue !== 'object' || Array.isArray(packageValue)) {
    throw new TypeError('A canonical OC package is required.');
  }
  return JSON.stringify(canonicalValue(packageValue));
}

/**
 * Return the resolved three-document source embedded in the certified OC
 * package. Final handoff artifacts must never fall back to mutable live Maker
 * state after Walrus preparation.
 */
export function certifiedLivingContentSource(packageValue) {
  const content = packageValue?.livingContent?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new TypeError('The certified OC package is missing resolved Living Content.');
  }
  for (const key of ['soulMd', 'memoryMd', 'skillMd']) {
    if (typeof content[key] !== 'string' || !content[key].trim()) {
      throw new TypeError(`The certified OC package is missing ${key}.`);
    }
  }
  return clone(content);
}
