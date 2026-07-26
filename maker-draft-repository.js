import {
  MAKER_DRAFT_BASE_REVISION_FIELD,
  MAKER_DRAFT_DELETED_FIELD,
  MAKER_DRAFT_REVISION_FIELD,
  commitMakerDraftSnapshot,
  deleteMakerDraftProject,
  listMakerDraftCheckpoints,
  listMakerDraftProjects,
  loadMakerDraftAssets,
  loadMakerDraftDocument,
  restoreMakerDraftCheckpoint,
  saveMakerDraftDocument,
  upsertMakerDraftAssets,
} from './maker-draft-store.js';

export {
  MAKER_DRAFT_BASE_REVISION_FIELD,
  MAKER_DRAFT_DELETED_FIELD,
  MAKER_DRAFT_REVISION_FIELD,
} from './maker-draft-store.js';

function requireMakerKey(value) {
  const makerKey = String(value || '').trim();
  if (!makerKey) throw new Error('Maker key is required.');
  return makerKey;
}

function requireRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Maker draft revision must be a non-negative safe integer.');
  }
  return revision;
}

function requireBaseRevision(value) {
  if (value === null) return null;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Maker draft base revision must be null or a non-negative safe integer.');
  }
  return revision;
}

function clone(value) {
  return structuredClone(value);
}

function recordRevision(record) {
  const revision = record?.metadata?.[MAKER_DRAFT_REVISION_FIELD];
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.document || typeof snapshot.document !== 'object') {
    throw new Error('A Maker draft document is required.');
  }
  const revision = requireRevision(snapshot.revision);
  const baseRevision = requireBaseRevision(snapshot.baseRevision ?? null);
  if (snapshot.assets !== undefined && !Array.isArray(snapshot.assets)) {
    throw new Error('Maker draft assets must be an array when provided.');
  }
  return {
    revision,
    baseRevision,
    document: clone(snapshot.document),
    recipe: snapshot.recipe === undefined ? undefined : clone(snapshot.recipe),
    journal: snapshot.journal === undefined ? undefined : clone(snapshot.journal),
    metadata: clone(snapshot.metadata || {}),
    assets: clone(snapshot.assets || []),
  };
}

function createLane() {
  return {
    tail: Promise.resolve(),
    requests: new Map(),
    hydrated: false,
    persistedRevision: null,
    latestRequestedRevision: null,
    savingRevision: null,
    pending: 0,
    savedAt: null,
    error: '',
    ownedBaseRevisions: new Set(),
  };
}

function enqueue(lane, operation) {
  const result = lane.tail.then(operation);
  lane.tail = result.catch(() => undefined);
  return result;
}

function resultFor(lane, makerKey, requestedRevision, {
  confirmed = false,
  superseded = false,
  conflict = false,
} = {}) {
  return {
    makerKey,
    requestedRevision,
    persistedRevision: lane.persistedRevision,
    confirmed,
    superseded,
    conflict,
  };
}

/**
 * Creates the single persistence boundary for Maker v5 drafts.
 *
 * A snapshot is cloned synchronously when save() is called. Saves for one
 * makerKey are serialized while unrelated Maker keys remain independent.
 * The returned result confirms only the revision whose document commit has
 * actually completed.
 */
export function createMakerDraftRepository(options = {}) {
  const configuredStorage = options.storage || {};
  const storage = {
    loadDocument: configuredStorage.loadDocument || loadMakerDraftDocument,
    saveDocument: configuredStorage.saveDocument || saveMakerDraftDocument,
    loadAssets: configuredStorage.loadAssets || loadMakerDraftAssets,
    upsertAssets: configuredStorage.upsertAssets || upsertMakerDraftAssets,
    commitSnapshot: configuredStorage.commitSnapshot
      || (options.storage ? null : commitMakerDraftSnapshot),
    listProjects: configuredStorage.listProjects
      || (options.storage ? null : listMakerDraftProjects),
    deleteProject: configuredStorage.deleteProject
      || (options.storage ? null : deleteMakerDraftProject),
    listCheckpoints: configuredStorage.listCheckpoints
      || (options.storage ? null : listMakerDraftCheckpoints),
    restoreCheckpoint: configuredStorage.restoreCheckpoint
      || (options.storage ? null : restoreMakerDraftCheckpoint),
  };
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const lanes = new Map();

  const laneFor = (makerKey) => {
    if (!lanes.has(makerKey)) lanes.set(makerKey, createLane());
    return lanes.get(makerKey);
  };

  const absorbRecordRevision = (lane, record) => {
    const revision = recordRevision(record);
    if (!lane.hydrated || revision !== lane.persistedRevision) {
      lane.persistedRevision = revision;
      lane.ownedBaseRevisions = new Set([revision]);
    }
    if (
      lane.persistedRevision !== null
      && (lane.latestRequestedRevision === null || lane.persistedRevision > lane.latestRequestedRevision)
    ) {
      lane.latestRequestedRevision = lane.persistedRevision;
    }
    lane.savedAt = typeof record?.savedAt === 'number' ? record.savedAt : lane.savedAt;
    lane.hydrated = true;
    return revision;
  };

  const hydrate = async (makerKey, lane) => {
    if (lane.hydrated) return;
    const record = await storage.loadDocument(makerKey);
    absorbRecordRevision(lane, record);
  };

  const status = (makerKey, lane) => ({
    makerKey,
    latestRequestedRevision: lane.latestRequestedRevision,
    persistedRevision: lane.persistedRevision,
    savingRevision: lane.savingRevision,
    pending: lane.pending,
    saving: lane.pending > 0,
    savedAt: lane.savedAt,
    error: lane.error,
  });

  const api = {
    save(makerKeyValue, inputSnapshot) {
      const makerKey = requireMakerKey(makerKeyValue);
      const snapshot = normalizeSnapshot(inputSnapshot);
      const lane = laneFor(makerKey);
      const { revision } = snapshot;

      if (
        lane.latestRequestedRevision !== null
        && revision < lane.latestRequestedRevision
      ) {
        return Promise.resolve(resultFor(lane, makerKey, revision, { superseded: true }));
      }

      const pendingSameRevision = lane.requests.get(revision);
      if (pendingSameRevision) return pendingSameRevision;

      if (lane.latestRequestedRevision === null || revision > lane.latestRequestedRevision) {
        lane.latestRequestedRevision = revision;
      }
      lane.pending += 1;

      const operation = enqueue(lane, async () => {
        try {
          await hydrate(makerKey, lane);

          const ownsBase = lane.ownedBaseRevisions.has(snapshot.baseRevision);
          const effectiveBaseRevision = ownsBase
            ? lane.persistedRevision
            : snapshot.baseRevision;
          if (
            !ownsBase
            && effectiveBaseRevision !== lane.persistedRevision
          ) {
            return resultFor(lane, makerKey, revision, {
              superseded: true,
              conflict: true,
            });
          }

          if (lane.persistedRevision !== null && revision <= lane.persistedRevision) {
            return resultFor(lane, makerKey, revision, {
              superseded: true,
              conflict: true,
            });
          }

          // Pending intermediate revisions are safe to skip. The newest queued
          // immutable snapshot will be the next document commit for this key.
          if (revision < lane.latestRequestedRevision) {
            return resultFor(lane, makerKey, revision, { superseded: true });
          }

          lane.savingRevision = revision;
          lane.error = '';
          const committedAt = Number(clock());
          const metadata = {
            rootMakerId: snapshot.document.version?.rootMakerId || '',
            versionId: snapshot.document.version?.versionId || '',
            name: snapshot.document.metadata?.name || '',
            ...clone(snapshot.metadata),
            [MAKER_DRAFT_REVISION_FIELD]: revision,
            [MAKER_DRAFT_BASE_REVISION_FIELD]: effectiveBaseRevision,
            draftCommittedAt: Number.isFinite(committedAt) ? committedAt : Date.now(),
          };
          if (snapshot.recipe !== undefined) metadata.recipe = clone(snapshot.recipe);
          if (snapshot.journal !== undefined) metadata.journal = clone(snapshot.journal);

          if (storage.commitSnapshot) {
            const commit = await storage.commitSnapshot(
              makerKey,
              clone(snapshot.document),
              metadata,
              clone(snapshot.assets),
            );
            if (commit?.committed === false) {
              if (
                Number.isSafeInteger(commit.persistedRevision)
                && (
                  lane.persistedRevision === null
                  || commit.persistedRevision > lane.persistedRevision
                )
              ) {
                lane.persistedRevision = commit.persistedRevision;
              }
              lane.ownedBaseRevisions = new Set([lane.persistedRevision]);
              if (
                lane.persistedRevision !== null
                && (
                  lane.latestRequestedRevision === null
                  || lane.persistedRevision > lane.latestRequestedRevision
                )
              ) {
                lane.latestRequestedRevision = lane.persistedRevision;
              }
              lane.savedAt = commit.savedAt ?? lane.savedAt;
              return resultFor(lane, makerKey, revision, {
                superseded: true,
                conflict: commit.conflict === true || commit.persistedRevision === revision,
              });
            }
          } else {
            if (snapshot.assets.length) {
              await storage.upsertAssets(makerKey, clone(snapshot.assets));
            }

            // A newer request may have arrived while Blob records were written.
            // Do not publish a document that is already known to be stale.
            if (revision < lane.latestRequestedRevision) {
              return resultFor(lane, makerKey, revision, { superseded: true });
            }
            await storage.saveDocument(makerKey, clone(snapshot.document), metadata);
          }
          lane.ownedBaseRevisions.add(revision);
          lane.persistedRevision = revision;
          lane.savedAt = metadata.draftCommittedAt;
          return resultFor(lane, makerKey, revision, { confirmed: true });
        } catch (error) {
          lane.error = error?.message || 'The Maker draft could not be saved.';
          throw error;
        } finally {
          if (lane.savingRevision === revision) lane.savingRevision = null;
          lane.pending -= 1;
        }
      });

      lane.requests.set(revision, operation);
      const forgetRequest = () => {
        if (lane.requests.get(revision) === operation) lane.requests.delete(revision);
      };
      operation.then(forgetRequest, forgetRequest);
      return operation;
    },

    load(makerKeyValue) {
      const makerKey = requireMakerKey(makerKeyValue);
      const lane = laneFor(makerKey);
      lane.pending += 1;
      return enqueue(lane, async () => {
        try {
          const [record, assets] = await Promise.all([
            storage.loadDocument(makerKey),
            storage.loadAssets(makerKey),
          ]);
          absorbRecordRevision(lane, record);
          lane.error = '';
          if (!record || record.metadata?.[MAKER_DRAFT_DELETED_FIELD] === true) return null;
          const metadata = clone(record.metadata || {});
          return {
            makerKey,
            revision: recordRevision(record),
            document: clone(record.document),
            recipe: metadata.recipe === undefined ? undefined : clone(metadata.recipe),
            journal: metadata.journal === undefined ? undefined : clone(metadata.journal),
            metadata,
            assets: clone(assets || []),
            savedAt: record.savedAt ?? null,
          };
        } catch (error) {
          lane.error = error?.message || 'The Maker draft could not be loaded.';
          throw error;
        } finally {
          lane.pending -= 1;
        }
      });
    },

    async flush(makerKeyValue) {
      if (makerKeyValue !== undefined && String(makerKeyValue || '').trim()) {
        const makerKey = requireMakerKey(makerKeyValue);
        const lane = lanes.get(makerKey);
        if (!lane) return status(makerKey, createLane());
        let observed;
        do {
          observed = lane.tail;
          await observed;
        } while (observed !== lane.tail);
        return status(makerKey, lane);
      }

      let observed;
      do {
        observed = [...lanes.values()].map((lane) => lane.tail);
        await Promise.all(observed);
      } while (
        observed.length !== lanes.size
        || [...lanes.values()].some((lane, index) => lane.tail !== observed[index])
      );
      return [...lanes.entries()].map(([makerKey, lane]) => status(makerKey, lane));
    },

    getStatus(makerKeyValue) {
      const makerKey = requireMakerKey(makerKeyValue);
      return status(makerKey, lanes.get(makerKey) || createLane());
    },

    async listProjects(filter = {}) {
      if (!storage.listProjects) {
        throw new Error('This Maker draft storage adapter cannot list projects.');
      }
      return clone(await storage.listProjects(filter));
    },

    listCheckpoints(makerKeyValue) {
      const makerKey = requireMakerKey(makerKeyValue);
      if (!storage.listCheckpoints) {
        throw new Error('This Maker draft storage adapter cannot list checkpoints.');
      }
      const lane = laneFor(makerKey);
      lane.pending += 1;
      return enqueue(lane, async () => {
        try {
          const checkpoints = await storage.listCheckpoints(makerKey);
          lane.error = '';
          return clone(checkpoints || []);
        } catch (error) {
          lane.error = error?.message || 'Maker draft checkpoints could not be listed.';
          throw error;
        } finally {
          lane.pending -= 1;
        }
      });
    },

    restoreCheckpoint(makerKeyValue, checkpointRevisionValue) {
      const makerKey = requireMakerKey(makerKeyValue);
      const checkpointRevision = requireRevision(checkpointRevisionValue);
      if (!storage.restoreCheckpoint) {
        throw new Error('This Maker draft storage adapter cannot restore checkpoints.');
      }
      const lane = laneFor(makerKey);
      lane.pending += 1;
      return enqueue(lane, async () => {
        try {
          await hydrate(makerKey, lane);
          lane.error = '';
          const committedAt = Number(clock());
          const restored = await storage.restoreCheckpoint(makerKey, checkpointRevision, {
            minimumRevision: Math.max(
              lane.persistedRevision ?? -1,
              lane.latestRequestedRevision ?? -1,
            ),
            draftCommittedAt: Number.isFinite(committedAt) ? committedAt : Date.now(),
            expectedBaseRevision: lane.persistedRevision,
          });
          if (restored?.committed === false) {
            if (Number.isSafeInteger(restored.persistedRevision)) {
              lane.persistedRevision = restored.persistedRevision;
              lane.latestRequestedRevision = Math.max(
                lane.latestRequestedRevision ?? -1,
                restored.persistedRevision,
              );
            }
            lane.ownedBaseRevisions = new Set([lane.persistedRevision]);
            lane.savedAt = restored.savedAt ?? lane.savedAt;
            lane.hydrated = true;
            return {
              makerKey,
              restoredFromRevision: checkpointRevision,
              revision: null,
              persistedRevision: lane.persistedRevision,
              committed: false,
              conflict: restored.conflict === true,
              savedAt: restored.savedAt ?? null,
            };
          }
          const restoredRevision = requireRevision(restored?.persistedRevision);
          lane.persistedRevision = restoredRevision;
          lane.ownedBaseRevisions = new Set([restoredRevision]);
          if (
            lane.latestRequestedRevision === null
            || restoredRevision > lane.latestRequestedRevision
          ) {
            lane.latestRequestedRevision = restoredRevision;
          }
          lane.savedAt = restored.savedAt ?? lane.savedAt;
          lane.hydrated = true;
          return {
            makerKey,
            restoredFromRevision: checkpointRevision,
            revision: restoredRevision,
            persistedRevision: restoredRevision,
            committed: true,
            conflict: false,
            document: restored.record?.document === undefined
              ? undefined
              : clone(restored.record.document),
            recipe: restored.record?.metadata?.recipe === undefined
              ? undefined
              : clone(restored.record.metadata.recipe),
            metadata: restored.record?.metadata === undefined
              ? undefined
              : clone(restored.record.metadata),
            savedAt: restored.savedAt ?? null,
          };
        } catch (error) {
          lane.error = error?.message || 'The Maker draft checkpoint could not be restored.';
          throw error;
        } finally {
          lane.pending -= 1;
        }
      });
    },

    async deleteProject(makerKeyValue) {
      const makerKey = requireMakerKey(makerKeyValue);
      if (!storage.deleteProject) {
        throw new Error('This Maker draft storage adapter cannot delete projects.');
      }
      const lane = laneFor(makerKey);
      lane.pending += 1;
      return enqueue(lane, async () => {
        try {
          await hydrate(makerKey, lane);
          const deletion = await storage.deleteProject(makerKey, {
            expectedBaseRevision: lane.persistedRevision,
          });
          if (deletion?.deleted === false) {
            if (Number.isSafeInteger(deletion.persistedRevision)) {
              lane.persistedRevision = deletion.persistedRevision;
              lane.latestRequestedRevision = Math.max(
                lane.latestRequestedRevision ?? -1,
                deletion.persistedRevision,
              );
            }
            lane.ownedBaseRevisions = new Set([lane.persistedRevision]);
            lane.savedAt = deletion.savedAt ?? lane.savedAt;
            lane.hydrated = true;
            const error = new Error('This Maker changed in another Animacraft tab and was not deleted.');
            error.code = 'MAKER_DRAFT_DELETE_CONFLICT';
            throw error;
          }
          const deletedRevision = requireRevision(deletion?.persistedRevision);
          lane.persistedRevision = deletedRevision;
          lane.ownedBaseRevisions = new Set([deletedRevision]);
          lane.savedAt = deletion.savedAt ?? null;
          lane.hydrated = true;
          lane.error = '';
          lane.latestRequestedRevision = Math.max(
            lane.latestRequestedRevision ?? -1,
            deletedRevision,
          );
          return {
            makerKey,
            deleted: true,
            persistedRevision: deletedRevision,
            savedAt: lane.savedAt,
          };
        } catch (error) {
          lane.error = error?.message || 'The Maker draft could not be deleted.';
          throw error;
        } finally {
          lane.pending -= 1;
        }
      });
    },
  };

  return api;
}
