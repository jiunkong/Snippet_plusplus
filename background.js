import { startSyncRecovery } from './utils/sync-recovery.js';

startSyncRecovery();

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
