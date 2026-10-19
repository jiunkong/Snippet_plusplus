import { scheduleGroupDiagnostics } from './group-diagnostics.js';
import { moduleState as __state_options_state_js, defaultSnippetGroups } from './state.js';
import { syncActiveGroupData, renderGroupsList, selectGroup } from './groups.js';
import { saveSyncedState, loadSyncedState, SNIPPET_META_KEY, SNIPPET_CHUNK_PREFIX, syncWriteQueue } from '../utils/sync.js';
import { t, loadLocale } from './i18n.js';
import { showExportFormat, showImportConfirmation } from './dialog.js';
import { encodeSnippetExport, decodeSnippetExport } from './file-format.js';
import { subgroupDefinitions } from './subgroups.js';
import { DEFAULT_CONFIG } from '../utils/config.js';
import { normalizeSnippetCallDepth, MAX_SNIPPET_CALL_DEPTH, normalizeSnippetTimeout } from '../language-core/src/index.ts';
import { initTimeoutScrubber } from './timeout.js';
import { initHotkeyButtons } from './hotkeys.js';
import { refreshSnippetTester } from './tester.js';
import { updateHighlight } from './highlight.js';
// --- Storage: Save / Load / Import / Export ---

export let lastSyncedSnapshot = null;
export let conflictResolutionPending = false;
let storageReady = false;
let loadedSyncVersion;
let lastSyncedGroups;
let syncChangeGeneration = 0;
let checkedSyncGeneration = 0;
let syncChangeTask = null;
let restoreTask = null;

export function snapshotSyncedState(config, groups) {
  return JSON.stringify({ config, snippetGroups: groups });
}

export function debouncedSave() {
  if (!storageReady || conflictResolutionPending) return;
  if (__state_options_state_js.saveTimeout) clearTimeout(__state_options_state_js.saveTimeout);
  __state_options_state_js.saveTimeout = setTimeout(() => {
    __state_options_state_js.saveTimeout = null;
    saveToStorage();
  }, 1500);
}

export function saveToStorage(syncEditor = true) {
  if (!storageReady || conflictResolutionPending) return Promise.resolve(false);
  if (syncEditor) syncActiveGroupData();
  const savedSnapshot = snapshotSyncedState(__state_options_state_js.currentConfig, __state_options_state_js.snippetGroups);
  const savedGroups = JSON.stringify(__state_options_state_js.snippetGroups);
  return saveSyncedState(__state_options_state_js.currentConfig, __state_options_state_js.snippetGroups, {
    skipUnchanged: () => savedSnapshot === lastSyncedSnapshot,
    // A preceding queued save may have changed the baseline by the time this
    // write starts (including when the user reverts to an earlier value).
    configOnly: () => savedGroups === lastSyncedGroups,
    expectedVersion: () => loadedSyncVersion,
    onCommitted: version => {
      loadedSyncVersion = version;
      lastSyncedSnapshot = savedSnapshot;
      lastSyncedGroups = savedGroups;
    }
  }).then(() => {
    showStatus(t('status_saved'));
    return true;
  }, error => {
    console.error('Snippet++: Sync save failed', error);
    showStatus(error.code === 'SYNC_CONFLICT' ? t('status_sync_changed') : `${t('status_sync_failed')} ${error.message}`, true);
    return false;
  });
}

export function saveOptions() {
  syncActiveGroupData();
  saveToStorage();
}

export function showStatus(message, isError = false) {
  const status = document.getElementById('status-message');
  const text = status.querySelector('.status-text');
  text.textContent = message;
  status.className = isError ? 'error visible' : 'success visible';
  
  if (status.timeout) clearTimeout(status.timeout);
  status.timeout = setTimeout(() => {
    status.classList.remove('visible');
  }, 2500);
}

// Chrome extension versions are numeric components; missing trailing components
// are zero, so 1.0 and 1.0.0 compare as the same version.
export function compareExtensionVersions(left, right) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    return parts.every(part => part <= 65535) ? parts : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function importVersionWarning(fileVersion) {
  // Legacy files without a version keep their original import flow.
  if (fileVersion == null) return '';
  const currentVersion = chrome.runtime.getManifest().version;
  const comparison = compareExtensionVersions(fileVersion, currentVersion);
  if (comparison === null || comparison === 0) return '';
  return t(comparison < 0 ? 'status_import_older_version' : 'status_import_newer_version', {
    fileVersion, currentVersion
  });
}

export function downloadSnippetExport(blob, filename, successKey) {
  const url = URL.createObjectURL(blob);
  try {
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      URL.revokeObjectURL(url);
      showStatus(t(chrome.runtime.lastError ? 'status_export_failed' : successKey), !!chrome.runtime.lastError);
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function exportSettings() {
  try {
    const format = await showExportFormat();
    if (!format) return;
    syncActiveGroupData();
    const data = { config: __state_options_state_js.currentConfig, snippetGroups: __state_options_state_js.snippetGroups, version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString() };
    const blob = await encodeSnippetExport(data, 'settings', format);
    downloadSnippetExport(blob, `snippetpp_config_${new Date().toISOString().split('T')[0]}.sppcfg`, 'status_export_started');
  } catch (error) {
    console.error('Snippet++: Export failed', error);
    showStatus(t('status_export_failed'), true);
  }
}

export async function importSettings(e) {
  const target = e.target;
  const file = target.files[0];
  if (!file) return;
  try {
    const data = await decodeSnippetExport(await file.arrayBuffer(), 'settings');
    if (!Array.isArray(data.snippetGroups)) throw new Error('Invalid settings file');
    if (await showImportConfirmation({
      title: t('import_dialog_settings_title'),
      message: t('status_import_confirm'),
      warning: importVersionWarning(data.version)
    })) {
      if (__state_options_state_js.saveTimeout) clearTimeout(__state_options_state_js.saveTimeout);
      __state_options_state_js.saveTimeout = null;
      __state_options_state_js.currentConfig = data.config || __state_options_state_js.currentConfig;
      __state_options_state_js.snippetGroups = data.snippetGroups;
      saveToStorage(false).then(saved => { if (saved) window.location.reload(); });
    }
  } catch (err) { showStatus(t('status_invalid_file'), true); }
  finally { target.value = ''; }
}

export async function exportActiveGroup() {
  if (__state_options_state_js.activeGroupIndex === -1) return;
  // Keep the selected group stable while the format dialog is open.
  const groupIndex = __state_options_state_js.activeGroupIndex;
  try {
    const format = await showExportFormat();
    if (!format) return;
    syncActiveGroupData();
    const group = __state_options_state_js.snippetGroups[groupIndex];
    const data = {
      type: 'snippetpp_group', version: chrome.runtime.getManifest().version,
      group, exportedAt: new Date().toISOString()
    };
    const suggestedName = (group.name || 'Untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
    const filename = `snippetpp_group_${suggestedName}_${new Date().toISOString().split('T')[0]}.sppgrp`;
    const blob = await encodeSnippetExport(data, 'group', format);
    downloadSnippetExport(blob, filename, 'status_group_export_started');
  } catch (error) {
    console.error('Snippet++: Group export failed', error);
    showStatus(t('status_export_failed'), true);
  }
}

export async function importGroup(e) {
  const target = e.target;
  const file = target.files[0];
  if (!file) return;
  try {
    const data = await decodeSnippetExport(await file.arrayBuffer(), 'group');
    const groupData = data.type === 'snippetpp_group' ? data.group : data;
    if (!groupData || !Array.isArray(groupData.snippets)) throw new Error('Invalid group file');
    if (await showImportConfirmation({
      title: t('import_dialog_group_title'),
      message: t('status_group_import_confirm', { name: groupData.name || 'Untitled' }),
      warning: importVersionWarning(data.version)
    })) {
      __state_options_state_js.snippetGroups.push({
        name: groupData.name || t('groups_default_name'),
        snippets: groupData.snippets || [],
        subgroups: subgroupDefinitions(groupData),
        disabledSites: groupData.disabledSites || [],
        siteMode: groupData.siteMode || 'blacklist'
      });
      saveToStorage().then(saved => { if (saved) showStatus(t('status_group_imported')); });
      renderGroupsList();
      selectGroup(__state_options_state_js.snippetGroups.length - 1);
    }
  } catch (err) {
    console.error(err);
    showStatus(t('status_invalid_file'), true);
  } finally { target.value = ''; }
}

export function restoreOptions() {
  if (restoreTask) return restoreTask;
  storageReady = false;
  const generation = syncChangeGeneration;
  restoreTask = loadSyncedState(DEFAULT_CONFIG, defaultSnippetGroups).then(async items => {
    loadedSyncVersion = items.syncVersion;
    __state_options_state_js.currentConfig = items.config;
    __state_options_state_js.snippetGroups = items.snippetGroups;
    lastSyncedSnapshot = snapshotSyncedState(__state_options_state_js.currentConfig, __state_options_state_js.snippetGroups);
    await loadLocale(__state_options_state_js.currentConfig.uiLocale, false);

    for (const key of ['nextCursor', 'undoExpansion', 'addSnippet', 'addSubgroup', 'reloadSnippets', 'toggleFold']) {
      document.getElementById(`hotkey-display-${key}`).textContent = __state_options_state_js.currentConfig[key] || DEFAULT_CONFIG[key];
    }

    const particlesToggle = document.getElementById('particles-toggle');
    const depthInput = document.getElementById('snippet-depth-input');
    if (depthInput) {
      depthInput.value = String(normalizeSnippetCallDepth(__state_options_state_js.currentConfig.maxCallDepth));
      depthInput.addEventListener('change', () => {
        if (!depthInput.checkValidity()) { depthInput.reportValidity(); return; }
        __state_options_state_js.currentConfig.maxCallDepth = normalizeSnippetCallDepth(Number(depthInput.value));
        depthInput.value = String(__state_options_state_js.currentConfig.maxCallDepth);
        saveToStorage();
      });
      initTimeoutScrubber(depthInput, {
        controlId: 'snippet-depth-scrubber', min: 1, max: MAX_SNIPPET_CALL_DEPTH,
        scale: 1, normalize: normalizeSnippetCallDepth
      });
    }
    const timeoutInput = document.getElementById('snippet-timeout-input');
    if (timeoutInput) {
      timeoutInput.value = String(normalizeSnippetTimeout(__state_options_state_js.currentConfig.maxExecutionMs) / 1000);
      timeoutInput.addEventListener('change', () => {
        if (!timeoutInput.checkValidity()) { timeoutInput.reportValidity(); return; }
        __state_options_state_js.currentConfig.maxExecutionMs = normalizeSnippetTimeout(Number(timeoutInput.value) * 1000);
        timeoutInput.value = String(__state_options_state_js.currentConfig.maxExecutionMs / 1000);
        saveToStorage();
      });
      initTimeoutScrubber(timeoutInput);
    }
    if (particlesToggle) {
      particlesToggle.checked = __state_options_state_js.currentConfig.showParticles !== false;
      particlesToggle.addEventListener('change', () => {
        __state_options_state_js.currentConfig.showParticles = particlesToggle.checked;
        saveToStorage();
      });
    }

    const shiftCursorToggle = document.getElementById('shift-cursor-toggle');
    if (shiftCursorToggle) {
      shiftCursorToggle.checked = __state_options_state_js.currentConfig.shiftCursorLevels !== false;
      shiftCursorToggle.addEventListener('change', () => {
        __state_options_state_js.currentConfig.shiftCursorLevels = shiftCursorToggle.checked;
        saveToStorage();
      });
    }

    const visualizeNewlinesToggle = document.getElementById('visualize-newlines-toggle');
    if (visualizeNewlinesToggle) {
      visualizeNewlinesToggle.checked = __state_options_state_js.currentConfig.visualizeNewlines !== false;
      visualizeNewlinesToggle.addEventListener('change', () => {
        __state_options_state_js.currentConfig.visualizeNewlines = visualizeNewlinesToggle.checked;
        saveToStorage();
        // Force refresh all highlights to show/hide markers immediately
        if (typeof updateAllHighlights === 'function') updateAllHighlights();
      });
    }

    const languageSelect = document.getElementById('language-select');
    languageSelect.value = __state_options_state_js.currentConfig.uiLocale || 'system';
    languageSelect.addEventListener('change', async () => {
      __state_options_state_js.currentConfig.uiLocale = languageSelect.value;
      await loadLocale(__state_options_state_js.currentConfig.uiLocale);
      saveToStorage();
    });

    renderGroupsList();
    if (typeof updateAllHighlights === 'function') updateAllHighlights();
    if (__state_options_state_js.snippetGroups.length > 0) selectGroup(0);
    initHotkeyButtons();
    refreshSnippetTester();
    // Rendering normalizes optional fields; it must not count as a user edit.
    // Use the same editor serialization as saveToStorage for this baseline.
    syncActiveGroupData();
    lastSyncedSnapshot = snapshotSyncedState(__state_options_state_js.currentConfig, __state_options_state_js.snippetGroups);
    lastSyncedGroups = JSON.stringify(__state_options_state_js.snippetGroups);
    storageReady = true;
    checkSyncedChanges();
  }).catch(async error => {
    console.error('Snippet++: Sync load failed', error);
    await loadLocale('system', false);
    showStatus(error.code === 'SYNC_CONFLICT' ? t('status_sync_changed') : `${t('status_sync_failed')} ${error.message}`, true);
  }).finally(() => {
    restoreTask = null;
    // A page opened during uninstall/recovery may initially see missing chunks.
    // Retry when storage changes instead of leaving that page permanently blank.
    if (!storageReady && generation !== syncChangeGeneration) restoreOptions();
  });
  return restoreTask;
}

// Storage notifications also describe this page's own writes. Reconcile only
// after queued writes have completed and their baselines have been updated.
// If a new write/change arrives while reading, discard that stale read.
function checkSyncedChanges() {
  if (!storageReady || conflictResolutionPending || syncChangeTask || checkedSyncGeneration === syncChangeGeneration) return;
  syncChangeTask = (async () => {
    while (storageReady && !conflictResolutionPending && checkedSyncGeneration !== syncChangeGeneration) {
      const generation = syncChangeGeneration;
      const queue = syncWriteQueue;
      await queue.catch(() => {});
      if (queue !== syncWriteQueue || generation !== syncChangeGeneration) continue;
      let remote;
      try {
        remote = await loadSyncedState(DEFAULT_CONFIG, defaultSnippetGroups);
      } catch (error) {
        if (queue !== syncWriteQueue || generation !== syncChangeGeneration) continue;
        checkedSyncGeneration = generation;
        console.error('Snippet++: Unable to check synced changes', error);
        break;
      }
      if (queue !== syncWriteQueue || generation !== syncChangeGeneration) continue;
      checkedSyncGeneration = generation;
      // Version identity also avoids false differences from fields normalized
      // during initial rendering, and from legacy-record cleanup.
      if (remote.syncVersion === loadedSyncVersion) continue;
      syncActiveGroupData();
      const localSnapshot = snapshotSyncedState(__state_options_state_js.currentConfig, __state_options_state_js.snippetGroups);
      const remoteSnapshot = snapshotSyncedState(remote.config, remote.snippetGroups);
      if (remoteSnapshot === lastSyncedSnapshot || remoteSnapshot === localSnapshot) {
        loadedSyncVersion = remote.syncVersion;
        if (remoteSnapshot === localSnapshot) {
          lastSyncedSnapshot = localSnapshot;
          lastSyncedGroups = JSON.stringify(remote.snippetGroups);
        }
        continue;
      }

      if (__state_options_state_js.saveTimeout) clearTimeout(__state_options_state_js.saveTimeout);
      __state_options_state_js.saveTimeout = null;
      conflictResolutionPending = true;
      const hasLocalEdits = localSnapshot !== lastSyncedSnapshot;
      const keepRemote = !hasLocalEdits || confirm(t('status_sync_conflict_confirm'));
      if (keepRemote) {
        window.location.reload();
        break;
      }
      // The user explicitly chose to publish local edits over the remote copy.
      lastSyncedSnapshot = remoteSnapshot;
      loadedSyncVersion = remote.syncVersion;
      lastSyncedGroups = JSON.stringify(remote.snippetGroups);
      conflictResolutionPending = false;
      await saveToStorage();
    }
  })().catch(error => {
    console.error('Snippet++: Unable to reconcile synced changes', error);
  }).finally(() => {
    syncChangeTask = null;
    if (checkedSyncGeneration !== syncChangeGeneration) checkSyncedChanges();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !Object.keys(changes).some(key =>
    key === 'config' || key === 'snippetGroups' || key === SNIPPET_META_KEY || key.startsWith(SNIPPET_CHUNK_PREFIX))) return;
  syncChangeGeneration++;
  if (!storageReady) {
    if (!restoreTask) restoreOptions();
    return;
  }
  checkSyncedChanges();
});

export function updateAllHighlights() {
  document.querySelectorAll('.snippet-row').forEach(row => {
    if (row.updateValidation) {
      row.updateValidation();
      return;
    }
    const textarea = row.querySelector('.replacement-input');
    const highlightDiv = row.querySelector('.replacement-highlight');
    const triggerInput = row.querySelector('.trigger-input');
    if (textarea && highlightDiv && triggerInput) {
      updateHighlight(textarea, highlightDiv, triggerInput.value);
    }
  });
  scheduleGroupDiagnostics();
}

window.onLocaleChange = () => {
  renderGroupsList();
  if (__state_options_state_js.activeGroupIndex !== -1) {
    selectGroup(__state_options_state_js.activeGroupIndex);
  }
};

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get lastSyncedSnapshot() { return lastSyncedSnapshot; }, set lastSyncedSnapshot(value) { lastSyncedSnapshot = value; },
  get conflictResolutionPending() { return conflictResolutionPending; }, set conflictResolutionPending(value) { conflictResolutionPending = value; },
};
