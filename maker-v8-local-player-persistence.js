/** Coordinates only a draft-bound local bridge handle, never wallet/Root WAL. */
export function createMakerV8LocalPlayerPersistence(session, onChange = () => {}) {
  for (const name of ['getSnapshot', 'loadCheckpoint', 'restoreCheckpoint', 'captureCheckpointSave']) {
    if (typeof session?.[name] !== 'function') throw new TypeError(`Local persistence requires ${name}.`);
  }
  let disposed = false;
  let initialized = false;
  let initialFlight = null;
  let saveFlight = null;
  let acknowledged = null;
  let savedRevision = -1;
  let pending = null;
  let status = Object.freeze({ state: 'idle', error: '', savedAt: '' });
  const check = () => { if (disposed) throw new Error('Local persistence is closed.'); };
  const update = (state, error = '') => {
    if (disposed) return;
    // Checkpoints do not carry a timestamp; never manufacture a saved-at value.
    status = Object.freeze({ state, error, savedAt: '' });
    try { onChange(status); } catch { /* Observers cannot invalidate a durable commit. */ }
  };
  const initialize = () => {
    check();
    if (initialFlight) return initialFlight;
    initialFlight = (async () => {
      const revision = session.getSnapshot().revision;
      try {
        const row = await session.loadCheckpoint();
        if (disposed) return null;
        if (session.getSnapshot().revision !== revision) throw new Error('Local edits changed during checkpoint recovery.');
        if (row) await session.restoreCheckpoint(row.checkpoint, revision);
        if (disposed) return null;
        acknowledged = row;
        savedRevision = session.getSnapshot().revision;
        initialized = true;
        update(row ? 'saved' : 'idle');
        return row;
      } catch (error) { update('error', String(error?.message || error)); throw error; }
    })();
    return initialFlight;
  };
  const save = () => {
    check();
    if (!initialized) return Promise.reject(new Error('Local checkpoint recovery must finish before saving.'));
    if (session.getSnapshot().revision !== savedRevision) pending = session.captureCheckpointSave();
    if (saveFlight) return saveFlight;
    const run = async () => {
      while (pending && pending.revision !== savedRevision) {
        const job = pending;
        pending = null;
        update('saving');
        try {
          const row = await job.commit(acknowledged ? {
            revision: acknowledged.revision, contentHash: acknowledged.contentHash,
          } : null);
          // A settled commit belongs to this owner even if its view was closed.
          acknowledged = row;
          savedRevision = job.revision;
        } catch (error) {
          pending ||= job;
          update('error', String(error?.message || error));
          throw error;
        }
      }
      if (!disposed) update(acknowledged ? 'saved' : 'idle');
      return acknowledged;
    };
    saveFlight = Promise.resolve().then(run).finally(() => { saveFlight = null; });
    return saveFlight;
  };
  return Object.freeze({ initialize, save, flush: save, getStatus: () => status,
    hasUnsavedChanges: () => !disposed && initialized && (Boolean(saveFlight) || session.getSnapshot().revision !== savedRevision),
    isReady: () => initialized && !disposed,
    dispose() { disposed = true; return saveFlight || Promise.resolve(acknowledged); },
  });
}
