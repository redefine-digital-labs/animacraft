export const LEGACY_WORKSPACE_DATABASE_NAME = 'animacraft-maker-workspace-v4';
export const LEGACY_WORKSPACE_DOCUMENT_STORE = 'maker-documents';
export const LEGACY_WORKSPACE_ASSET_STORE = 'maker-assets';

export const LEGACY_CREATOR_DATABASE_NAME = 'animacraft-creator-drafts';
export const LEGACY_CREATOR_DRAFT_STORE = 'maker-drafts';
export const LEGACY_CREATOR_ASSET_STORE = 'maker-assets';

export const LEGACY_UNSCOPED_DRAFT_KEY = 'animacraft-maker-draft-v1';
export const LEGACY_SCOPED_DRAFT_PREFIX = 'animacraft-maker-draft-v2:';
export const LEGACY_MAKER_INDEX_PREFIX = 'animacraft-local-makers-v1:';

export const LEGACY_RECOVERY_EXPORT_SCHEMA = 'animacraft.legacy-maker-recovery.v1';

const MAKER_V5_SCHEMA = 'animacraft.maker.v5';
const SOURCE_WORKSPACE = 'workspace-v4';
const SOURCE_CREATOR = 'creator-drafts';
const SOURCE_LOCAL_DRAFT = 'local-storage-draft';
const SOURCE_LOCAL_INDEX = 'local-storage-index';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizedTimestamp(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  }
  return null;
}

function normalizedRevision(...values) {
  for (const value of values) {
    const revision = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (Number.isSafeInteger(revision) && revision >= 0) return revision;
  }
  return null;
}

function issue(code, message) {
  return { code, message };
}

function isMakerV5Document(value) {
  return isObject(value) && value.schemaVersion === MAKER_V5_SCHEMA;
}

function payloadCandidates(value) {
  if (!isObject(value)) return [];
  const draft = isObject(value.draft) ? value.draft : null;
  return [
    value.document,
    value.manifest,
    value.makerDocumentV5,
    value.makerDocumentV4,
    draft?.document,
    draft?.manifest,
    draft?.makerDocumentV5,
    draft?.makerDocumentV4,
    draft,
    value,
  ].filter(isObject);
}

function v5DocumentFrom(value) {
  const document = payloadCandidates(value).find(isMakerV5Document);
  return document ? clone(document) : null;
}

function anyMakerDocumentFrom(value) {
  return payloadCandidates(value).find((candidate) => (
    typeof candidate.schemaVersion === 'string'
    || (isObject(candidate.version) && Array.isArray(candidate.parts))
  )) || null;
}

function recipeFrom(value, document) {
  const draft = isObject(value?.draft) ? value.draft : value;
  const recipe = value?.metadata?.recipe
    ?? draft?.recipe
    ?? draft?.makerRecipeV5
    ?? draft?.makerRecipeV4
    ?? document?.defaultRecipe
    ?? null;
  return recipe && typeof recipe === 'object' ? clone(recipe) : null;
}

function walletFromMakerKey(makerKey) {
  const firstSegment = nonEmpty(makerKey).split(':', 1)[0];
  return /^0x[0-9a-f]{1,64}$/i.test(firstSegment) ? firstSegment : '';
}

function explicitWalletFrom(value) {
  const draft = isObject(value?.draft) ? value.draft : value;
  const candidates = [
    value?.metadata?.walletAddress,
    value?.walletAddress,
    draft?.metadata?.walletAddress,
    draft?.walletAddress,
    draft?.owner,
  ];
  return candidates.map(nonEmpty).find((candidate) => (
    candidate && !['local', 'wallet', 'public'].includes(candidate.toLowerCase())
  )) || '';
}

function makerIdFrom(value, document, makerKey) {
  const draft = isObject(value?.draft) ? value.draft : value;
  const legacyDocument = anyMakerDocumentFrom(value);
  const candidates = [
    document?.version?.rootMakerId,
    document?.metadata?.id,
    legacyDocument?.version?.rootMakerId,
    legacyDocument?.metadata?.id,
    draft?.templateId,
    draft?.makerId,
    draft?.metadata?.id,
    draft?.id,
    value?.makerId,
    value?.metadata?.id,
    value?.id,
  ];
  const explicit = candidates.map(nonEmpty).find(Boolean);
  if (explicit) return explicit;
  const key = nonEmpty(makerKey);
  const separator = key.indexOf(':');
  return separator >= 0 ? key.slice(separator + 1) : key;
}

function canonicalDraftMakerKey(value, fallbackMakerId = '') {
  const key = nonEmpty(value);
  if (key.startsWith(LEGACY_SCOPED_DRAFT_PREFIX)) {
    return key.slice(LEGACY_SCOPED_DRAFT_PREFIX.length);
  }
  if (key && key !== LEGACY_UNSCOPED_DRAFT_KEY) return key;
  const makerId = nonEmpty(fallbackMakerId)
    || (key === LEGACY_UNSCOPED_DRAFT_KEY ? 'daily-starlit' : '');
  if (!makerId) return '';
  return `local:${makerId}`;
}

function stableRecordId(source, location, makerKey, suffix = '') {
  return [
    'legacy',
    source,
    encodeURIComponent(nonEmpty(location) || 'unknown'),
    encodeURIComponent(nonEmpty(makerKey) || 'unknown'),
    suffix ? encodeURIComponent(String(suffix)) : '',
  ].filter(Boolean).join(':');
}

function recoveryIssues({ document, rawValue, assets, indexOnly = false }) {
  if (rawValue === null) {
    return [issue('invalid-json', 'The legacy localStorage value is not valid JSON; only its raw text can be exported.')];
  }
  if (indexOnly && !document) {
    return [issue('index-entry-only', 'This record is a Maker list entry and does not contain an editor document.')];
  }
  if (!document) {
    if (anyMakerDocumentFrom(rawValue)) {
      return [issue(
        'legacy-document-incompatible',
        'This legacy Maker document is not animacraft.maker.v5 and cannot be restored automatically without data loss.',
      )];
    }
    if (assets.length) {
      return [issue('orphaned-assets', 'Local PNG assets were found without a compatible Maker document.')];
    }
    return [issue('maker-document-missing', 'No compatible animacraft.maker.v5 document was found in this record.')];
  }
  return [];
}

function normalizedRecord({
  source,
  location,
  sourceKey,
  makerKey,
  makerId = '',
  walletAddress = '',
  savedAt = null,
  revision = null,
  document = null,
  recipe = null,
  assets = [],
  raw,
  issues = [],
  idSuffix = '',
}) {
  const clonedRaw = clone(raw);
  const embeddedAssets = Array.isArray(clonedRaw?.assetRecords)
    ? clonedRaw.assetRecords
    : Array.isArray(clonedRaw?.matchedAssetRecords)
      ? clonedRaw.matchedAssetRecords
      : null;
  // Keep one in-memory Blob graph per discovery record. The raw backup and
  // the convenient assets field deliberately share the same cloned array.
  const clonedAssets = embeddedAssets || clone(Array.isArray(assets) ? assets : []);
  const clonedIssues = clone(issues);
  const issueCodes = new Set(clonedIssues.map((entry) => entry?.code));
  const status = document
    ? 'recoverable'
    : issueCodes.has('source-scan-failed')
      ? 'scan-error'
      : issueCodes.has('invalid-json')
        ? 'damaged'
        : issueCodes.has('orphaned-assets')
          ? 'assets-only'
          : issueCodes.has('index-entry-only')
            ? 'index-only'
            : 'raw-only';
  return {
    id: stableRecordId(source, location, makerKey, idSuffix),
    source,
    makerKey: nonEmpty(makerKey),
    makerId: nonEmpty(makerId),
    walletAddress: nonEmpty(walletAddress),
    savedAt,
    revision,
    document: document ? clone(document) : null,
    recipe: recipe ? clone(recipe) : null,
    assets: clonedAssets,
    assetCount: clonedAssets.length,
    raw: clonedRaw,
    recoverable: Boolean(document),
    status,
    issues: clonedIssues,
    sourceKey: nonEmpty(sourceKey),
  };
}

function scanErrorRecord(source, location, error) {
  const message = error?.message || String(error || 'Unknown legacy storage read error');
  return normalizedRecord({
    source,
    location,
    sourceKey: location,
    makerKey: '',
    makerId: '',
    walletAddress: '',
    savedAt: null,
    revision: null,
    document: null,
    recipe: null,
    assets: [],
    raw: {
      location,
      scanError: {
        name: nonEmpty(error?.name) || 'Error',
        message,
      },
    },
    issues: [issue(
      'source-scan-failed',
      `This legacy source could not be read. Its other data was not modified: ${message}`,
    )],
    idSuffix: 'scan-error',
  });
}

function requestResult(request, fallback) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(fallback));
  });
}

function transactionComplete(transaction, fallback) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error(fallback));
    transaction.onerror = () => reject(transaction.error || new Error(fallback));
  });
}

async function knownDatabaseNames(factory) {
  if (typeof factory?.databases !== 'function') return null;
  try {
    const records = await factory.databases();
    return new Set((records || []).map((record) => nonEmpty(record?.name)).filter(Boolean));
  } catch {
    // Some browsers expose databases() but deny enumeration. The open fallback
    // below aborts the version-0 upgrade, so it still cannot create a database.
    return null;
  }
}

function openExistingDatabase(factory, databaseName, knownNames) {
  if (!factory || typeof factory.open !== 'function') return Promise.resolve(null);
  if (knownNames && !knownNames.has(databaseName)) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName);
    let absent = false;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    request.onupgradeneeded = (event) => {
      if (Number(event?.oldVersion || 0) !== 0) return;
      absent = true;
      try {
        request.transaction?.abort();
      } catch {
        // If the platform has already aborted the versionchange transaction,
        // the subsequent AbortError is handled as an absent database.
      }
    };
    request.onsuccess = () => {
      if (absent) {
        request.result?.close?.();
        finish(resolve, null);
        return;
      }
      if (request.result) request.result.onversionchange = () => request.result.close();
      finish(resolve, request.result || null);
    };
    request.onerror = () => {
      if (absent) {
        finish(resolve, null);
        return;
      }
      finish(reject, request.error || new Error(`Could not open legacy Maker database "${databaseName}".`));
    };
    request.onblocked = () => finish(
      reject,
      new Error(`Legacy Maker database "${databaseName}" is blocked by another Animacraft tab.`),
    );
  });
}

async function readExistingStores(database, databaseName, storeNames) {
  const names = storeNames.filter((name) => database?.objectStoreNames?.contains?.(name));
  const result = Object.fromEntries(storeNames.map((name) => [name, []]));
  if (!names.length) return result;

  const transaction = database.transaction(names, 'readonly');
  const completion = transactionComplete(
    transaction,
    `Could not finish reading legacy Maker database "${databaseName}".`,
  );
  const valuesRequest = Promise.all(names.map(async (name) => {
    const store = transaction.objectStore(name);
    if (typeof store.getAll !== 'function') {
      throw new Error(`Legacy Maker store "${databaseName}/${name}" cannot be enumerated.`);
    }
    const records = await requestResult(
      store.getAll(),
      `Could not read legacy Maker store "${databaseName}/${name}".`,
    );
    return [name, records || []];
  }));
  const [values] = await Promise.all([valuesRequest, completion]);
  values.forEach(([name, records]) => {
    result[name] = clone(records);
  });
  return result;
}

function groupAssetsByMakerKey(records) {
  const groups = new Map();
  (records || []).forEach((record) => {
    const makerKey = canonicalDraftMakerKey(record?.makerKey);
    if (!makerKey) return;
    if (!groups.has(makerKey)) groups.set(makerKey, []);
    groups.get(makerKey).push(record);
  });
  return groups;
}

function latestSavedAt(records) {
  const values = (records || [])
    .map((record) => normalizedTimestamp(record?.savedAt))
    .filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

async function scanWorkspaceDatabase(factory, knownNames) {
  const database = await openExistingDatabase(factory, LEGACY_WORKSPACE_DATABASE_NAME, knownNames);
  if (!database) return { records: [], assetsByMakerKey: new Map() };
  try {
    const stores = await readExistingStores(database, LEGACY_WORKSPACE_DATABASE_NAME, [
      LEGACY_WORKSPACE_DOCUMENT_STORE,
      LEGACY_WORKSPACE_ASSET_STORE,
    ]);
    const assetsByMakerKey = groupAssetsByMakerKey(stores[LEGACY_WORKSPACE_ASSET_STORE]);
    const consumedAssetKeys = new Set();
    const records = stores[LEGACY_WORKSPACE_DOCUMENT_STORE].map((rawRecord) => {
      const makerKey = canonicalDraftMakerKey(rawRecord?.makerKey);
      const document = v5DocumentFrom(rawRecord);
      const recipe = recipeFrom(rawRecord, document);
      const assets = assetsByMakerKey.get(makerKey) || [];
      consumedAssetKeys.add(makerKey);
      const walletAddress = explicitWalletFrom(rawRecord) || walletFromMakerKey(makerKey);
      const makerId = makerIdFrom(rawRecord, document, makerKey);
      const savedAt = normalizedTimestamp(
        rawRecord?.savedAt,
        rawRecord?.metadata?.draftCommittedAt,
        rawRecord?.document?.updatedAt,
      );
      const revision = normalizedRevision(
        rawRecord?.metadata?.draftRevision,
        rawRecord?.revision,
        rawRecord?.document?.draftRevision,
      );
      return normalizedRecord({
        source: SOURCE_WORKSPACE,
        location: `${LEGACY_WORKSPACE_DATABASE_NAME}/${LEGACY_WORKSPACE_DOCUMENT_STORE}`,
        sourceKey: makerKey,
        makerKey,
        makerId,
        walletAddress,
        savedAt,
        revision,
        document,
        recipe,
        assets,
        raw: {
          databaseName: LEGACY_WORKSPACE_DATABASE_NAME,
          documentStore: LEGACY_WORKSPACE_DOCUMENT_STORE,
          assetStore: LEGACY_WORKSPACE_ASSET_STORE,
          documentRecord: rawRecord,
          assetRecords: assets,
        },
        issues: recoveryIssues({ document, rawValue: rawRecord, assets }),
      });
    });

    assetsByMakerKey.forEach((assets, makerKey) => {
      if (consumedAssetKeys.has(makerKey)) return;
      const walletAddress = walletFromMakerKey(makerKey);
      const makerId = makerIdFrom({}, null, makerKey);
      records.push(normalizedRecord({
        source: SOURCE_WORKSPACE,
        location: `${LEGACY_WORKSPACE_DATABASE_NAME}/${LEGACY_WORKSPACE_ASSET_STORE}`,
        sourceKey: makerKey,
        makerKey,
        makerId,
        walletAddress,
        savedAt: latestSavedAt(assets),
        revision: null,
        document: null,
        recipe: null,
        assets,
        raw: {
          databaseName: LEGACY_WORKSPACE_DATABASE_NAME,
          documentStore: LEGACY_WORKSPACE_DOCUMENT_STORE,
          assetStore: LEGACY_WORKSPACE_ASSET_STORE,
          documentRecord: null,
          assetRecords: assets,
        },
        issues: recoveryIssues({ document: null, rawValue: {}, assets }),
        idSuffix: 'assets-only',
      }));
    });
    return { records, assetsByMakerKey };
  } finally {
    database.close();
  }
}

async function scanCreatorDatabase(factory, knownNames) {
  const database = await openExistingDatabase(factory, LEGACY_CREATOR_DATABASE_NAME, knownNames);
  if (!database) return { records: [], assetsByMakerKey: new Map() };
  try {
    const stores = await readExistingStores(database, LEGACY_CREATOR_DATABASE_NAME, [
      LEGACY_CREATOR_DRAFT_STORE,
      LEGACY_CREATOR_ASSET_STORE,
    ]);
    const assetsByMakerKey = groupAssetsByMakerKey(stores[LEGACY_CREATOR_ASSET_STORE]);
    const consumedAssetKeys = new Set();
    const records = stores[LEGACY_CREATOR_DRAFT_STORE].map((rawRecord) => {
      const draft = isObject(rawRecord?.draft) ? rawRecord.draft : rawRecord;
      const preliminaryMakerId = makerIdFrom(rawRecord, null, rawRecord?.makerKey);
      const makerKey = canonicalDraftMakerKey(rawRecord?.makerKey, preliminaryMakerId);
      const document = v5DocumentFrom(rawRecord);
      const recipe = recipeFrom(rawRecord, document);
      const assets = assetsByMakerKey.get(makerKey) || [];
      consumedAssetKeys.add(makerKey);
      const walletAddress = explicitWalletFrom(rawRecord) || walletFromMakerKey(makerKey);
      const makerId = makerIdFrom(rawRecord, document, makerKey);
      const savedAt = normalizedTimestamp(
        rawRecord?.savedAt,
        draft?.savedAt,
        rawRecord?.metadata?.draftCommittedAt,
      );
      const revision = normalizedRevision(
        rawRecord?.metadata?.draftRevision,
        rawRecord?.revision,
        draft?.draftRevision,
        draft?.revision,
      );
      return normalizedRecord({
        source: SOURCE_CREATOR,
        location: `${LEGACY_CREATOR_DATABASE_NAME}/${LEGACY_CREATOR_DRAFT_STORE}`,
        sourceKey: rawRecord?.makerKey,
        makerKey,
        makerId,
        walletAddress,
        savedAt,
        revision,
        document,
        recipe,
        assets,
        raw: {
          databaseName: LEGACY_CREATOR_DATABASE_NAME,
          draftStore: LEGACY_CREATOR_DRAFT_STORE,
          assetStore: LEGACY_CREATOR_ASSET_STORE,
          draftRecord: rawRecord,
          assetRecords: assets,
        },
        issues: recoveryIssues({ document, rawValue: rawRecord, assets }),
      });
    });

    assetsByMakerKey.forEach((assets, makerKey) => {
      if (consumedAssetKeys.has(makerKey)) return;
      records.push(normalizedRecord({
        source: SOURCE_CREATOR,
        location: `${LEGACY_CREATOR_DATABASE_NAME}/${LEGACY_CREATOR_ASSET_STORE}`,
        sourceKey: makerKey,
        makerKey,
        makerId: makerIdFrom({}, null, makerKey),
        walletAddress: walletFromMakerKey(makerKey),
        savedAt: latestSavedAt(assets),
        revision: null,
        document: null,
        recipe: null,
        assets,
        raw: {
          databaseName: LEGACY_CREATOR_DATABASE_NAME,
          draftStore: LEGACY_CREATOR_DRAFT_STORE,
          assetStore: LEGACY_CREATOR_ASSET_STORE,
          draftRecord: null,
          assetRecords: assets,
        },
        issues: recoveryIssues({ document: null, rawValue: {}, assets }),
        idSuffix: 'assets-only',
      }));
    });
    return { records, assetsByMakerKey };
  } finally {
    database.close();
  }
}

function storageKeys(storage) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  const keys = [];
  const length = Number(storage.length || 0);
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (typeof key === 'string') keys.push(key);
  }
  return [...new Set(keys)].sort();
}

function parseJson(rawValue) {
  if (typeof rawValue !== 'string') return { parsed: null, error: 'missing' };
  try {
    return { parsed: JSON.parse(rawValue), error: '' };
  } catch (error) {
    return { parsed: null, error: error?.message || 'Invalid JSON' };
  }
}

function scanLocalDraft(storage, storageKey, creatorAssetsByMakerKey) {
  const rawValue = storage.getItem(storageKey);
  const { parsed, error } = parseJson(rawValue);
  const preliminaryMakerId = makerIdFrom(
    parsed || {},
    null,
    storageKey === LEGACY_UNSCOPED_DRAFT_KEY ? '' : storageKey,
  );
  const makerKey = canonicalDraftMakerKey(storageKey, preliminaryMakerId);
  const document = v5DocumentFrom(parsed);
  const recipe = recipeFrom(parsed, document);
  const assets = creatorAssetsByMakerKey.get(makerKey) || [];
  const walletAddress = explicitWalletFrom(parsed) || walletFromMakerKey(makerKey);
  const makerId = makerIdFrom(parsed || {}, document, makerKey);
  const savedAt = normalizedTimestamp(
    parsed?.savedAt,
    parsed?.metadata?.draftCommittedAt,
  );
  const revision = normalizedRevision(
    parsed?.metadata?.draftRevision,
    parsed?.draftRevision,
    parsed?.revision,
  );
  const issues = error
    ? recoveryIssues({ document: null, rawValue: null, assets })
    : recoveryIssues({ document, rawValue: parsed, assets });
  return normalizedRecord({
    source: SOURCE_LOCAL_DRAFT,
    location: storageKey,
    sourceKey: storageKey,
    makerKey,
    makerId,
    walletAddress,
    savedAt,
    revision,
    document,
    recipe,
    assets,
    raw: {
      storageKey,
      rawValue,
      parsedValue: parsed,
      parseError: error,
      matchedAssetRecords: assets,
    },
    issues,
  });
}

function localIndexEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.records)) return parsed.records;
  if (isObject(parsed)) {
    return Object.entries(parsed).map(([id, value]) => (
      isObject(value) ? { id, ...value } : { id, value }
    ));
  }
  return [];
}

function scanLocalIndex(storage, storageKey) {
  const rawValue = storage.getItem(storageKey);
  const { parsed, error } = parseJson(rawValue);
  const walletFromKey = nonEmpty(storageKey.slice(LEGACY_MAKER_INDEX_PREFIX.length));
  const entries = localIndexEntries(parsed);
  if (!error && !entries.length) return [];
  if (error) {
    const makerKey = `${walletFromKey || 'local'}:unknown`;
    return [normalizedRecord({
      source: SOURCE_LOCAL_INDEX,
      location: storageKey,
      sourceKey: storageKey,
      makerKey,
      makerId: '',
      walletAddress: walletFromKey === 'local' ? '' : walletFromKey,
      savedAt: null,
      revision: null,
      document: null,
      recipe: null,
      assets: [],
      raw: {
        storageKey,
        rawValue,
        parsedValue: parsed,
        parseError: error,
        indexRecord: null,
      },
      issues: recoveryIssues({ document: null, rawValue: null, assets: [], indexOnly: true }),
      idSuffix: 'raw-index',
    })];
  }

  const occurrences = new Map();
  return entries.map((entry, index) => {
    const document = v5DocumentFrom(entry);
    const entryMakerId = makerIdFrom(entry, document, '') || `entry-${index + 1}`;
    const occurrence = (occurrences.get(entryMakerId) || 0) + 1;
    occurrences.set(entryMakerId, occurrence);
    const walletAddress = explicitWalletFrom(entry)
      || (walletFromKey === 'local' ? '' : walletFromKey);
    const makerKey = `${walletAddress || 'local'}:${entryMakerId}`;
    const recipe = recipeFrom(entry, document);
    return normalizedRecord({
      source: SOURCE_LOCAL_INDEX,
      location: storageKey,
      sourceKey: storageKey,
      makerKey,
      makerId: entryMakerId,
      walletAddress,
      savedAt: normalizedTimestamp(entry?.savedAt, entry?.updatedAt),
      revision: normalizedRevision(entry?.draftRevision, entry?.revision),
      document,
      recipe,
      assets: [],
      raw: {
        storageKey,
        rawValue,
        parsedValue: parsed,
        parseError: '',
        index: index,
        indexRecord: entry,
      },
      issues: recoveryIssues({
        document,
        rawValue: entry,
        assets: [],
        indexOnly: true,
      }),
      idSuffix: `${entryMakerId}:${occurrence}`,
    });
  });
}

function scanLocalStorage(storage, creatorAssetsByMakerKey) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  const records = [];
  storageKeys(storage).forEach((key) => {
    if (key === LEGACY_UNSCOPED_DRAFT_KEY || key.startsWith(LEGACY_SCOPED_DRAFT_PREFIX)) {
      records.push(scanLocalDraft(storage, key, creatorAssetsByMakerKey));
    } else if (key.startsWith(LEGACY_MAKER_INDEX_PREFIX)) {
      records.push(...scanLocalIndex(storage, key));
    }
  });
  return records;
}

/**
 * Discovers legacy Maker drafts without modifying IndexedDB or localStorage.
 *
 * Every IndexedDB transaction is readonly. Missing databases are skipped
 * through indexedDB.databases() when available; the compatibility fallback
 * aborts a version-0 open before creation can commit.
 */
export async function scanLegacyMakerDrafts({
  indexedDB: indexedDb = globalThis.indexedDB,
  localStorage: storage = globalThis.localStorage,
} = {}) {
  const knownNames = await knownDatabaseNames(indexedDb);
  const [workspaceResult, creatorResult] = await Promise.allSettled([
    scanWorkspaceDatabase(indexedDb, knownNames),
    scanCreatorDatabase(indexedDb, knownNames),
  ]);
  const workspace = workspaceResult.status === 'fulfilled'
    ? workspaceResult.value
    : { records: [scanErrorRecord(
      SOURCE_WORKSPACE,
      LEGACY_WORKSPACE_DATABASE_NAME,
      workspaceResult.reason,
    )], assetsByMakerKey: new Map() };
  const creator = creatorResult.status === 'fulfilled'
    ? creatorResult.value
    : { records: [scanErrorRecord(
      SOURCE_CREATOR,
      LEGACY_CREATOR_DATABASE_NAME,
      creatorResult.reason,
    )], assetsByMakerKey: new Map() };
  let localRecords;
  try {
    localRecords = scanLocalStorage(storage, creator.assetsByMakerKey);
  } catch (error) {
    localRecords = [scanErrorRecord(SOURCE_LOCAL_DRAFT, 'localStorage', error)];
  }
  return [
    ...workspace.records,
    ...creator.records,
    ...localRecords,
  ].sort((left, right) => (
    Number(right.savedAt ?? -1) - Number(left.savedAt ?? -1)
    || left.id.localeCompare(right.id)
  ));
}

function durableAssetUrl(value) {
  const url = nonEmpty(value);
  if (!url || /^blob:/i.test(url)) return '';
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) return url;
  if (/^(?:\/(?!\/)|\.{1,2}\/)/.test(url)) return url;
  return '';
}

function recoveryBlob(record) {
  const value = record?.blob || record?.file;
  return typeof Blob !== 'undefined' && value instanceof Blob ? value : null;
}

function referencedRecoveryAssetIds(document) {
  const ids = new Set();
  const add = (value) => {
    const id = nonEmpty(value);
    if (id) ids.add(id);
  };
  add(document?.metadata?.coverAssetId);
  (document?.layerTracks || []).forEach((track) => add(track?.referenceAssetId));
  (document?.parts || []).forEach((part) => {
    add(part?.iconAssetId);
    (part?.items || []).forEach((item) => {
      add(item?.thumbnailAssetId);
      (item?.styles || []).forEach((style) => add(style?.assetId));
    });
  });
  (document?.extensions?.expansionDrafts || []).forEach((pack) => {
    (pack?.assets || []).forEach((asset) => add(asset?.id));
  });
  return ids;
}

function sourceMatchesDescriptor(source, descriptor) {
  const descriptorId = nonEmpty(descriptor?.id);
  if (!descriptorId || !isObject(source)) return false;
  const sourceAssetId = nonEmpty(source.assetId);
  const sourceAssetKey = nonEmpty(source.assetKey);
  const sourceId = nonEmpty(source.id);
  const descriptorIdentifier = nonEmpty(descriptor.identifier);
  const sourceIdentifier = nonEmpty(source.identifier);
  return sourceAssetId === descriptorId
    || sourceAssetKey === descriptorId
    || sourceId === descriptorId
    || sourceId.endsWith(`::${descriptorId}`)
    || sourceId.endsWith(`:${descriptorId}`)
    || Boolean(
      descriptorIdentifier
      && sourceIdentifier
      && sourceIdentifier === descriptorIdentifier
    );
}

/**
 * Matches preserved Blob records to Maker asset metadata without guessing.
 *
 * A source record can be consumed by at most one descriptor. Every asset
 * referenced by the Maker graph must resolve either to a durable URL or to a
 * Blob/File that can be committed into the new v6 project.
 */
export function prepareRecoveredMakerAssets(document, sourceAssets = []) {
  if (!isMakerV5Document(document)) {
    throw new TypeError('A Maker v5 document is required to recover its assets.');
  }
  if (!Array.isArray(sourceAssets)) {
    throw new TypeError('Recovered Maker source assets must be an array.');
  }

  const descriptors = Array.isArray(document.assets) ? document.assets : [];
  const candidates = sourceAssets.filter(isObject);
  const usedSourceIndexes = new Set();
  const recovered = [];

  descriptors.forEach((descriptor) => {
    const descriptorId = nonEmpty(descriptor?.id);
    if (!descriptorId) return;
    const matches = candidates
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => sourceMatchesDescriptor(source, descriptor));
    if (matches.length > 1) {
      throw new Error(`Asset "${descriptorId}" matches multiple preserved local records; export the raw backup instead of guessing.`);
    }

    const match = matches[0] || null;
    if (match && usedSourceIndexes.has(match.index)) {
      throw new Error(`One preserved local PNG matches more than one Maker asset, including "${descriptorId}".`);
    }
    if (match) usedSourceIndexes.add(match.index);

    const source = match?.source || null;
    const blob = recoveryBlob(source);
    const url = durableAssetUrl(source?.url)
      || durableAssetUrl(descriptor?.url)
      || durableAssetUrl(descriptor?.legacy?.url);
    const thumbnailUrl = durableAssetUrl(source?.thumbnailUrl)
      || durableAssetUrl(descriptor?.thumbnailUrl);
    if (!blob && !url) return;

    const {
      id: _legacyId,
      makerKey: _legacyMakerKey,
      savedAt: _legacySavedAt,
      assetKey: _legacyAssetKey,
      file: _legacyFile,
      blob: _legacyBlob,
      url: _legacyUrl,
      thumbnailUrl: _legacyThumbnailUrl,
      ...rest
    } = source || {};
    recovered.push({
      ...rest,
      assetId: descriptorId,
      identifier: descriptor.identifier,
      kind: descriptor.kind,
      mediaType: descriptor.mediaType,
      width: descriptor.width,
      height: descriptor.height,
      ...(blob ? { blob } : {}),
      ...(url ? { url } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    });
  });

  const descriptorById = new Map(descriptors.map((descriptor) => [nonEmpty(descriptor?.id), descriptor]));
  const recoveredById = new Map(recovered.map((asset) => [asset.assetId, asset]));
  const unavailable = [];
  referencedRecoveryAssetIds(document).forEach((assetId) => {
    const descriptor = descriptorById.get(assetId);
    const asset = recoveredById.get(assetId);
    const available = Boolean(
      recoveryBlob(asset)
      || durableAssetUrl(asset?.url)
      || durableAssetUrl(descriptor?.url)
      || durableAssetUrl(descriptor?.legacy?.url)
    );
    if (!descriptor || !available) unavailable.push(assetId);
  });
  if (unavailable.length) {
    throw new Error(
      `The preserved draft is missing recoverable data for referenced asset(s): ${unavailable.join(', ')}. Export its raw backup instead.`,
    );
  }
  return recovered;
}

function validRecipeSelection(document, selection) {
  if (!isObject(selection)) return null;
  const part = (document.parts || []).find((candidate) => candidate.id === selection.partId);
  const item = part?.items?.find((candidate) => candidate.id === selection.itemId);
  const style = item?.styles?.find((candidate) => candidate.id === selection.styleId);
  return part && item && style
    ? { partId: part.id, itemId: item.id, styleId: style.id }
    : null;
}

function validRecipeColor(document, selection) {
  if (!isObject(selection)) return null;
  const channel = (document.colorChannels || []).find(
    (candidate) => candidate.id === selection.channelId,
  );
  const swatch = channel?.swatches?.find((candidate) => candidate.id === selection.swatchId);
  return channel && swatch
    ? { channelId: channel.id, swatchId: swatch.id }
    : null;
}

/**
 * Keeps valid player choices from a legacy snapshot and falls back, field by
 * field, to the already validated Maker default Recipe.
 */
export function normalizeRecoveredMakerRecipe(document, recipe) {
  if (!isMakerV5Document(document)) {
    throw new TypeError('A Maker v5 document is required to recover its Recipe.');
  }
  const fallback = clone(document.defaultRecipe || { selections: [], colors: [] });
  const candidateSelections = Array.isArray(recipe?.selections) ? recipe.selections : [];
  const fallbackSelections = Array.isArray(fallback?.selections) ? fallback.selections : [];
  const candidateByPart = new Map(
    candidateSelections
      .map((selection) => validRecipeSelection(document, selection))
      .filter(Boolean)
      .map((selection) => [selection.partId, selection]),
  );
  const fallbackByPart = new Map(
    fallbackSelections
      .map((selection) => validRecipeSelection(document, selection))
      .filter(Boolean)
      .map((selection) => [selection.partId, selection]),
  );
  const selections = (document.parts || []).flatMap((part) => {
    const selection = candidateByPart.get(part.id) || fallbackByPart.get(part.id);
    return selection ? [selection] : [];
  });

  const candidateColors = Array.isArray(recipe?.colors) ? recipe.colors : [];
  const fallbackColors = Array.isArray(fallback?.colors) ? fallback.colors : [];
  const candidateByChannel = new Map(
    candidateColors
      .map((selection) => validRecipeColor(document, selection))
      .filter(Boolean)
      .map((selection) => [selection.channelId, selection]),
  );
  const fallbackByChannel = new Map(
    fallbackColors
      .map((selection) => validRecipeColor(document, selection))
      .filter(Boolean)
      .map((selection) => [selection.channelId, selection]),
  );
  const colors = (document.colorChannels || []).flatMap((channel) => {
    const selection = candidateByChannel.get(channel.id) || fallbackByChannel.get(channel.id);
    return selection ? [selection] : [];
  });
  return { selections, colors };
}

function byteArrayBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  if (typeof btoa !== 'function') throw new Error('This browser cannot encode a recovery Blob.');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

async function jsonSafeValue(value, path = '$', seen = new WeakMap()) {
  if (value === undefined) return { $type: 'undefined' };
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $type: 'number', value: String(value) };
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;

  if (value instanceof Date) return { $type: 'Date', value: value.toISOString() };
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    const isFile = typeof File !== 'undefined' && value instanceof File;
    return {
      $type: isFile ? 'File' : 'Blob',
      type: value.type || 'application/octet-stream',
      size: value.size,
      ...(isFile ? { name: value.name, lastModified: value.lastModified } : {}),
      dataUrl: `data:${value.type || 'application/octet-stream'};base64,${byteArrayBase64(bytes)}`,
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      $type: 'ArrayBuffer',
      byteLength: value.byteLength,
      base64: byteArrayBase64(new Uint8Array(value)),
    };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      $type: value.constructor?.name || 'TypedArray',
      byteLength: value.byteLength,
      base64: byteArrayBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  if (typeof value !== 'object') return String(value);

  if (seen.has(value)) return { $type: 'reference', path: seen.get(value) };
  seen.set(value, path);

  if (value instanceof Map) {
    const entries = [];
    let index = 0;
    for (const [key, entryValue] of value.entries()) {
      entries.push([
        await jsonSafeValue(key, `${path}.mapKey[${index}]`, seen),
        await jsonSafeValue(entryValue, `${path}.mapValue[${index}]`, seen),
      ]);
      index += 1;
    }
    return { $type: 'Map', entries };
  }
  if (value instanceof Set) {
    const values = [];
    let index = 0;
    for (const entryValue of value.values()) {
      values.push(await jsonSafeValue(entryValue, `${path}.set[${index}]`, seen));
      index += 1;
    }
    return { $type: 'Set', values };
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry, index) => jsonSafeValue(entry, `${path}[${index}]`, seen)));
  }

  const result = {};
  for (const [key, entryValue] of Object.entries(value)) {
    result[key] = await jsonSafeValue(entryValue, `${path}.${key}`, seen);
  }
  return result;
}

/**
 * Creates a standalone JSON-safe backup without mutating the discovery record.
 * Blob/File bytes are embedded as data URLs so the payload remains useful
 * after the source database is no longer available.
 */
export async function legacyRecoveryExportPayload(record) {
  if (!isObject(record) || !nonEmpty(record.id)) {
    throw new TypeError('A legacy Maker recovery record is required.');
  }
  return {
    schemaVersion: LEGACY_RECOVERY_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    record: await jsonSafeValue(record),
  };
}
