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
      while (handledGeneration !== generation) {
        const observedGeneration = generation;
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
          // Incomplete chunk notifications and concurrent saves are retried on
          // their next storage event, without replacing the last good backup.
          console.error('Snippet++: Sync backup/recovery deferred', error);
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
