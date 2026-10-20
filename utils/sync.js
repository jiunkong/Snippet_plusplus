import { readSyncBackup } from './sync-backup.js';
// Chrome Sync allows about 100 KB total, but only 8 KB per item. Store the
// snippet list in versioned chunks and publish its manifest after all chunks
// have been written, so readers never observe a partially saved list.
export const SNIPPET_META_KEY = 'snippetGroupsSync';
export const SNIPPET_CHUNK_PREFIX = 'snippetGroupsSync_';

export function syncGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, items => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(items);
    });
  });
}

export function syncSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

export function syncRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(keys, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

export function syncItemBytes(key, value) {
  // Chromium's JSON writer escapes these characters even though JavaScript's
  // JSON.stringify leaves them literal. Quotas use Chromium's serialized size.
  const serialized = JSON.stringify(value).replace(/[<\u2028\u2029]/g, character => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return new TextEncoder().encode(key + serialized).length;
}

export function chunkSnippetData(serialized, revision) {
  const limit = chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192;
  const chunks = {};
  let offset = 0;
  let index = 0;
  while (offset < serialized.length) {
    const key = `${SNIPPET_CHUNK_PREFIX}${revision}_${index++}`;
    let low = offset + 1;
    let high = serialized.length;
    let end = offset;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (syncItemBytes(key, serialized.slice(offset, middle)) <= limit) {
        end = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (end === offset) throw new Error('A snippet cannot fit in sync storage.');
    chunks[key] = serialized.slice(offset, end);
    offset = end;
  }
  return chunks;
}

export function chunkKeys(meta) {
  if (!meta || typeof meta.revision !== 'string' || !Number.isInteger(meta.count) ||
      meta.count < 1 || meta.count > (chrome.storage.sync.MAX_ITEMS || 512)) return [];
  return Array.from({ length: meta.count }, (_, index) => `${SNIPPET_CHUNK_PREFIX}${meta.revision}_${index}`);
}

// Compare the records actually read, including legacy data and settings. Missing
// local Sync data is not evidence that this account has no remote data yet.
export function syncedVersion(items) {
  // Once a manifest exists, legacy data is no longer authoritative. Its
  // best-effort cleanup must not invalidate an otherwise current version.
  return JSON.stringify([items.config ?? null, items[SNIPPET_META_KEY] === undefined ? items.snippetGroups ?? null : null, items[SNIPPET_META_KEY] ?? null]);
}

export function syncConflict() {
  const error = new Error('Synced data changed. Reload settings before saving.');
  error.code = 'SYNC_CONFLICT';
  return error;
}

export async function loadSyncedState(defaultConfig, defaultGroups, { useBackup = true } = {}) {
  const items = await syncGet(['config', 'snippetGroups', SNIPPET_META_KEY]);
  const backup = useBackup ? await readSyncBackup() : null;
  let config = { ...defaultConfig, ...(items.config === undefined ? backup?.config : {}) };
  if (items.config !== undefined) {
    try {
      const saved = typeof items.config === 'string' ? JSON.parse(items.config) : items.config;
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) config = { ...config, ...saved };
    } catch (error) {
      console.error('Snippet++: Invalid synced config', error);
    }
  }

  const meta = items[SNIPPET_META_KEY];
  if (meta !== undefined) {
    const keys = chunkKeys(meta);
    if (!keys.length) throw new Error('Invalid synced snippet manifest.');
    const parts = await syncGet(keys);
    if (keys.some(key => typeof parts[key] !== 'string')) {
      const error = new Error('Synced snippet list is incomplete.');
      error.code = 'SYNC_INCOMPLETE';
      throw error;
    }
    const groups = JSON.parse(keys.map(key => parts[key]).join(''));
    if (!Array.isArray(groups)) throw new Error('Invalid synced snippet list.');
    const latest = await syncGet(['config', 'snippetGroups', SNIPPET_META_KEY]);
    if (syncedVersion(latest) !== syncedVersion(items)) throw syncConflict();
    return { config, snippetGroups: groups, syncVersion: syncedVersion(items), hasSyncedSnippets: true, hasSyncedConfig: items.config !== undefined };
  }

  if (Array.isArray(items.snippetGroups)) {
    return { config, snippetGroups: items.snippetGroups, syncVersion: syncedVersion(items), hasSyncedSnippets: true, hasSyncedConfig: items.config !== undefined };
  }
  return {
    config,
    snippetGroups: backup ? backup.snippetGroups : structuredClone(defaultGroups),
    syncVersion: syncedVersion(items), hasSyncedSnippets: false
  };
}

export let syncWriteQueue = Promise.resolve();

export function saveSyncedState(config, snippetGroups, options = {}) {
  if (!Array.isArray(snippetGroups)) return Promise.reject(new Error('Invalid snippet list.'));
  const serializedConfig = JSON.stringify(config);
  const serializedGroups = JSON.stringify(snippetGroups);
  const write = syncWriteQueue.catch(() => {}).then(async () => {
    if (options.skipUnchanged?.()) return;
    const old = await syncGet(['config', 'snippetGroups', SNIPPET_META_KEY]);
    const expected = options.expectedVersion?.();
    if (expected !== undefined && syncedVersion(old) !== expected) throw syncConflict();
    // Preferences normally leave the snippet revision alone. If Chrome removed
    // the entire list, include the recovered local list in the new commit.
    const configOnly = typeof options.configOnly === 'function' ? options.configOnly() : options.configOnly;
    const needsRecovery = old[SNIPPET_META_KEY] === undefined && !Array.isArray(old.snippetGroups) && await readSyncBackup();
    if (configOnly && !needsRecovery) {
      await syncSet({ config: serializedConfig });
      options.onCommitted?.(syncedVersion({ ...old, config: serializedConfig }));
      return;
    }
    const revision = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const chunks = chunkSnippetData(serializedGroups, revision);
    const meta = { revision, count: Object.keys(chunks).length };
    const limit = chrome.storage.sync.QUOTA_BYTES || 102400;
    const bytes = Object.entries(chunks).reduce((sum, [key, value]) => sum + syncItemBytes(key, value), 0)
      + syncItemBytes('config', serializedConfig) + syncItemBytes(SNIPPET_META_KEY, meta);
    if (bytes > limit) throw new Error('Snippet list exceeds Chrome Sync storage capacity.');
    if (syncItemBytes('config', serializedConfig) > (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192)) {
      throw new Error('Settings exceed Chrome Sync item capacity.');
    }

    await syncSet(chunks);
    try {
      const latest = await syncGet(['config', 'snippetGroups', SNIPPET_META_KEY]);
      if (syncedVersion(latest) !== syncedVersion(old)) throw syncConflict();
      await syncSet({ config: serializedConfig, [SNIPPET_META_KEY]: meta });
      options.onCommitted?.(syncedVersion({ config: serializedConfig, [SNIPPET_META_KEY]: meta }));
    } catch (error) {
      await syncRemove(Object.keys(chunks)).catch(() => {});
      throw error;
    }

    // Cleanup is best effort: the committed manifest already points to the
    // new version. Legacy storage is removed only after the new data exists.
    await syncRemove([...chunkKeys(old[SNIPPET_META_KEY]), 'snippetGroups']).catch(console.error);
  });
  syncWriteQueue = write;
  return write;
}

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get syncWriteQueue() { return syncWriteQueue; }, set syncWriteQueue(value) { syncWriteQueue = value; },
};
