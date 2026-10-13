// Chrome Sync allows about 100 KB total, but only 8 KB per item. Store the
// snippet list in versioned chunks and publish its manifest after all chunks
// have been written, so readers never observe a partially saved list.
const SNIPPET_META_KEY = 'snippetGroupsSync';
const SNIPPET_CHUNK_PREFIX = 'snippetGroupsSync_';

function syncGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, items => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(items);
    });
  });
}

function syncSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

function syncRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(keys, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

function syncItemBytes(key, value) {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}

function chunkSnippetData(serialized, revision) {
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

function chunkKeys(meta) {
  if (!meta || typeof meta.revision !== 'string' || !Number.isInteger(meta.count) ||
      meta.count < 1 || meta.count > (chrome.storage.sync.MAX_ITEMS || 512)) return [];
  return Array.from({ length: meta.count }, (_, index) => `${SNIPPET_CHUNK_PREFIX}${meta.revision}_${index}`);
}

async function loadSyncedState(defaultConfig, defaultGroups) {
  const items = await syncGet(['config', 'snippetGroups', SNIPPET_META_KEY]);
  let config = { ...defaultConfig };
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
    if (keys.some(key => typeof parts[key] !== 'string')) throw new Error('Synced snippet list is incomplete.');
    const groups = JSON.parse(keys.map(key => parts[key]).join(''));
    if (!Array.isArray(groups)) throw new Error('Invalid synced snippet list.');
    return { config, snippetGroups: groups };
  }

  return { config, snippetGroups: Array.isArray(items.snippetGroups) ? items.snippetGroups : defaultGroups };
}

let syncWriteQueue = Promise.resolve();

function saveSyncedState(config, snippetGroups) {
  if (!Array.isArray(snippetGroups)) return Promise.reject(new Error('Invalid snippet list.'));
  const serializedConfig = JSON.stringify(config);
  const serializedGroups = JSON.stringify(snippetGroups);
  const write = syncWriteQueue.catch(() => {}).then(async () => {
    const old = await syncGet([SNIPPET_META_KEY]);
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
      await syncSet({ config: serializedConfig, [SNIPPET_META_KEY]: meta });
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
