// --- Storage: Save / Load / Import / Export ---

let lastSyncedSnapshot = null;
let conflictResolutionPending = false;

function snapshotSyncedState(config, groups) {
  return JSON.stringify({ config, snippetGroups: groups });
}

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    saveToStorage();
  }, 1500);
}

function saveToStorage(syncEditor = true) {
  if (syncEditor) syncActiveGroupData();
  const savedSnapshot = snapshotSyncedState(currentConfig, snippetGroups);
  return saveSyncedState(currentConfig, snippetGroups).then(() => {
    lastSyncedSnapshot = savedSnapshot;
    showStatus(t('status_saved'));
    return true;
  }, error => {
    console.error('Snippet++: Sync save failed', error);
    showStatus(`${t('status_sync_failed')} ${error.message}`, true);
    return false;
  });
}

function saveOptions() {
  syncActiveGroupData();
  saveToStorage();
}

function showStatus(message, isError = false) {
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
function compareExtensionVersions(left, right) {
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

function importVersionWarning(fileVersion) {
  // Legacy files without a version keep their original import flow.
  if (fileVersion == null) return '';
  const currentVersion = chrome.runtime.getManifest().version;
  const comparison = compareExtensionVersions(fileVersion, currentVersion);
  if (comparison === null || comparison === 0) return '';
  return t(comparison < 0 ? 'status_import_older_version' : 'status_import_newer_version', {
    fileVersion, currentVersion
  });
}

function downloadSnippetExport(blob, filename, successKey) {
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

async function exportSettings() {
  try {
    const format = await showExportFormat();
    if (!format) return;
    syncActiveGroupData();
    const data = { config: currentConfig, snippetGroups, version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString() };
    const blob = await encodeSnippetExport(data, 'settings', format);
    downloadSnippetExport(blob, `snippetpp_config_${new Date().toISOString().split('T')[0]}.sppcfg`, 'status_export_started');
  } catch (error) {
    console.error('Snippet++: Export failed', error);
    showStatus(t('status_export_failed'), true);
  }
}

async function importSettings(e) {
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
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = null;
      currentConfig = data.config || currentConfig;
      snippetGroups = data.snippetGroups;
      saveToStorage(false).then(saved => { if (saved) window.location.reload(); });
    }
  } catch (err) { showStatus(t('status_invalid_file'), true); }
  finally { target.value = ''; }
}

async function exportActiveGroup() {
  if (activeGroupIndex === -1) return;
  // Keep the selected group stable while the format dialog is open.
  const groupIndex = activeGroupIndex;
  try {
    const format = await showExportFormat();
    if (!format) return;
    syncActiveGroupData();
    const group = snippetGroups[groupIndex];
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

async function importGroup(e) {
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
      snippetGroups.push({
        name: groupData.name || t('groups_default_name'),
        snippets: groupData.snippets || [],
        subgroups: subgroupDefinitions(groupData),
        disabledSites: groupData.disabledSites || [],
        siteMode: groupData.siteMode || 'blacklist'
      });
      saveToStorage().then(saved => { if (saved) showStatus(t('status_group_imported')); });
      renderGroupsList();
      selectGroup(snippetGroups.length - 1);
    }
  } catch (err) {
    console.error(err);
    showStatus(t('status_invalid_file'), true);
  } finally { target.value = ''; }
}

function restoreOptions() {
  loadSyncedState(DEFAULT_CONFIG, defaultSnippetGroups).then(async items => {
    currentConfig = items.config;
    snippetGroups = items.snippetGroups;
    lastSyncedSnapshot = snapshotSyncedState(currentConfig, snippetGroups);
    await loadLocale(currentConfig.uiLocale, false);

    for (const key of ['nextCursor', 'undoExpansion', 'addSnippet', 'addSubgroup', 'reloadSnippets', 'toggleFold']) {
      document.getElementById(`hotkey-display-${key}`).textContent = currentConfig[key] || DEFAULT_CONFIG[key];
    }

    const particlesToggle = document.getElementById('particles-toggle');
    const depthInput = document.getElementById('snippet-depth-input');
    if (depthInput) {
      depthInput.value = String(normalizeSnippetCallDepth(currentConfig.maxCallDepth));
      depthInput.addEventListener('change', () => {
        if (!depthInput.checkValidity()) { depthInput.reportValidity(); return; }
        currentConfig.maxCallDepth = normalizeSnippetCallDepth(Number(depthInput.value));
        depthInput.value = String(currentConfig.maxCallDepth);
        saveToStorage();
      });
      initTimeoutScrubber(depthInput, {
        controlId: 'snippet-depth-scrubber', min: 1, max: MAX_SNIPPET_CALL_DEPTH,
        scale: 1, normalize: normalizeSnippetCallDepth
      });
    }
    const timeoutInput = document.getElementById('snippet-timeout-input');
    if (timeoutInput) {
      timeoutInput.value = String(normalizeSnippetTimeout(currentConfig.maxExecutionMs) / 1000);
      timeoutInput.addEventListener('change', () => {
        if (!timeoutInput.checkValidity()) { timeoutInput.reportValidity(); return; }
        currentConfig.maxExecutionMs = normalizeSnippetTimeout(Number(timeoutInput.value) * 1000);
        timeoutInput.value = String(currentConfig.maxExecutionMs / 1000);
        saveToStorage();
      });
      initTimeoutScrubber(timeoutInput);
    }
    if (particlesToggle) {
      particlesToggle.checked = currentConfig.showParticles !== false;
      particlesToggle.addEventListener('change', () => {
        currentConfig.showParticles = particlesToggle.checked;
        saveToStorage();
      });
    }

    const shiftCursorToggle = document.getElementById('shift-cursor-toggle');
    if (shiftCursorToggle) {
      shiftCursorToggle.checked = currentConfig.shiftCursorLevels !== false;
      shiftCursorToggle.addEventListener('change', () => {
        currentConfig.shiftCursorLevels = shiftCursorToggle.checked;
        saveToStorage();
      });
    }

    const visualizeNewlinesToggle = document.getElementById('visualize-newlines-toggle');
    if (visualizeNewlinesToggle) {
      visualizeNewlinesToggle.checked = currentConfig.visualizeNewlines !== false;
      visualizeNewlinesToggle.addEventListener('change', () => {
        currentConfig.visualizeNewlines = visualizeNewlinesToggle.checked;
        saveToStorage();
        // Force refresh all highlights to show/hide markers immediately
        if (typeof updateAllHighlights === 'function') updateAllHighlights();
      });
    }

    const languageSelect = document.getElementById('language-select');
    languageSelect.value = currentConfig.uiLocale || 'system';
    languageSelect.addEventListener('change', async () => {
      currentConfig.uiLocale = languageSelect.value;
      await loadLocale(currentConfig.uiLocale);
      saveToStorage();
    });

    renderGroupsList();
    if (typeof updateAllHighlights === 'function') updateAllHighlights();
    if (snippetGroups.length > 0) selectGroup(0);
    initHotkeyButtons();
    refreshSnippetTester();
  }).catch(async error => {
    console.error('Snippet++: Sync load failed', error);
    await loadLocale('system', false);
    showStatus(`${t('status_sync_failed')} ${error.message}`, true);
  });
}

// A committed manifest marks a complete remote save. If this page also has
// edits based on the previous version, ask which copy should win.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[SNIPPET_META_KEY] || conflictResolutionPending) return;
  loadSyncedState(DEFAULT_CONFIG, defaultSnippetGroups).then(async remote => {
    if (!lastSyncedSnapshot) return;
    syncActiveGroupData();
    const localSnapshot = snapshotSyncedState(currentConfig, snippetGroups);
    const remoteSnapshot = snapshotSyncedState(remote.config, remote.snippetGroups);
    if (remoteSnapshot === lastSyncedSnapshot || remoteSnapshot === localSnapshot) return;

    conflictResolutionPending = true;
    const hasLocalEdits = localSnapshot !== lastSyncedSnapshot;
    const keepRemote = !hasLocalEdits || confirm(t('status_sync_conflict_confirm'));
    if (keepRemote) {
      window.location.reload();
    } else {
      // Saving the local copy publishes it as the new synced version.
      lastSyncedSnapshot = remoteSnapshot;
      await saveToStorage();
      conflictResolutionPending = false;
    }
  }).catch(error => console.error('Snippet++: Unable to check synced changes', error));
});

function updateAllHighlights() {
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
}

window.onLocaleChange = () => {
  renderGroupsList();
  if (activeGroupIndex !== -1) {
    selectGroup(activeGroupIndex);
  }
};
