// This copy belongs to this installation, so another device's uninstall cannot
// delete it through Chrome Sync. It is removed if this installation is removed.
export const SYNC_BACKUP_KEY = 'snippetGroupsLocalBackup';

export async function readSyncBackup() {
  if (!chrome.storage.local) return null;
  const items = await new Promise((resolve, reject) => {
    chrome.storage.local.get([SYNC_BACKUP_KEY], items => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(items);
    });
  });
  const backup = items[SYNC_BACKUP_KEY];
  if (backup?.format !== 1 || !Array.isArray(backup.snippetGroups) ||
      !backup.config || typeof backup.config !== 'object' || Array.isArray(backup.config)) return null;
  return backup;
}

export async function writeSyncBackup(state) {
  if (!chrome.storage.local) return;
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [SYNC_BACKUP_KEY]: {
      format: 1, config: state.config, snippetGroups: state.snippetGroups
    } }, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}
