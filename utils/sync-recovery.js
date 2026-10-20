import { DEFAULT_CONFIG } from './config.js';
import { loadSyncedState, saveSyncedState, syncGet, SNIPPET_META_KEY, SNIPPET_CHUNK_PREFIX } from './sync.js';
import { readSyncBackup, writeSyncBackup } from './sync-backup.js';

export function isSnippetSyncKey(key) {
  return key === 'config' || key === 'snippetGroups' || key === SNIPPET_META_KEY ||
    key.startsWith(SNIPPET_CHUNK_PREFIX);
}

// One background worker owns the local backup and recovery. Content/options
// pages may read that backup but never race to republish it themselves.
export function startSyncRecovery() {
  let generation = 0;
  let handledGeneration = -1;
  let task = null;
  function reconcile() {
    if (task) return task;
    task = (async () => {
      let retryGeneration = generation;
      let conflictRetries = 0;
      while (handledGeneration !== generation) {
        const observedGeneration = generation;
        if (retryGeneration !== observedGeneration) {
          retryGeneration = observedGeneration;
          conflictRetries = 0;
        }
        handledGeneration = observedGeneration;
        try {
          const state = await loadSyncedState(DEFAULT_CONFIG, [], { useBackup: false });
          if (observedGeneration !== generation) continue;
          if (state.hasSyncedSnippets) {
            // Includes an explicitly committed [], which supersedes old data.
            const backup = state.hasSyncedConfig ? null : await readSyncBackup();
            if (observedGeneration !== generation) continue;
            await writeSyncBackup({ ...state, config: backup?.config ?? state.config });
            continue;
          }
          const backup = await readSyncBackup();
          if (!backup || observedGeneration !== generation) continue;
          // Uninstall removes all keys, possibly in several notifications.
          // Wait for that removal to finish; never repair a partial revision or
          // overwrite a preference-only update or an incoming chunked save.
          const records = await syncGet(null);
          if (observedGeneration !== generation || Object.keys(records).some(isSnippetSyncKey)) continue;
          await saveSyncedState(backup.config, backup.snippetGroups, {
            expectedVersion: () => {
              if (observedGeneration !== generation) {
                const error = new Error('Sync changed during recovery.');
                error.code = 'SYNC_CONFLICT';
                throw error;
              }
              return state.syncVersion;
            }
          });
        } catch (error) {
          if (error.code === 'SYNC_CONFLICT') {
            // A newer snapshot may be readable before onChanged arrives. Read
            // it again, but yield after three attempts if Sync keeps changing.
            // A queued storage event already guarantees the next iteration.
            if (observedGeneration === generation && conflictRetries < 2) {
              conflictRetries++;
              handledGeneration = -1;
            }
          } else if (error.code !== 'SYNC_INCOMPLETE') {
            console.error('Snippet++: Sync backup/recovery deferred', error);
          }
          // Partial chunk delivery waits for its next storage event. Neither
          // case is a failed write or permission to republish an older backup.
        }
      }
    })().finally(() => {
      task = null;
      if (handledGeneration !== generation) reconcile();
    });
    return task;
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !Object.keys(changes).some(isSnippetSyncKey)) return;
    generation++;
    reconcile();
  });
  return reconcile();
}
