// --- Storage: Save / Load / Import / Export ---

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveToStorage(), 500);
}

function saveToStorage() {
  chrome.storage.sync.set({ config: JSON.stringify(currentConfig), snippetGroups }, () => showStatus(t('status_saved')));
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

function exportSettings() {
  const data = { config: currentConfig, snippetGroups, version: "1.0", exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const fileName = `snippetpp_config_${new Date().toISOString().split('T')[0]}.sppcfg`;

  chrome.downloads.download({
    url: url,
    filename: fileName,
    saveAs: true
  }, () => {
    URL.revokeObjectURL(url);
    showStatus(t('status_export_started'));
  });
}

function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (!data.snippetGroups) throw new Error();
      if (confirm(t('status_import_confirm'))) {
        currentConfig = data.config || currentConfig;
        snippetGroups = data.snippetGroups;
        saveToStorage();
        setTimeout(() => window.location.reload(), 500);
      }
    } catch (err) { showStatus(t('status_invalid_file'), true); }
  };
  reader.readAsText(file);
}

function exportActiveGroup() {
  if (activeGroupIndex === -1) return;
  syncActiveGroupData();
  const group = snippetGroups[activeGroupIndex];
  const data = { 
    type: "snippetpp_group",
    version: "1.0",
    group: group,
    exportedAt: new Date().toISOString() 
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const suggestedName = (group.name || 'Untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
  const fileName = `snippetpp_group_${suggestedName}_${new Date().toISOString().split('T')[0]}.sppgrp`;

  chrome.downloads.download({
    url: url,
    filename: fileName,
    saveAs: true
  }, () => {
    URL.revokeObjectURL(url);
    showStatus(t('status_group_export_started'));
  });
}

function importGroup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      const groupData = data.type === "snippetpp_group" ? data.group : data;
      if (!groupData || !Array.isArray(groupData.snippets)) throw new Error("Invalid group file");

      if (confirm(t('status_group_import_confirm', { name: groupData.name || 'Untitled' }))) {
        snippetGroups.push({
          name: groupData.name || t('groups_default_name'),
          snippets: groupData.snippets || [],
          disabledSites: groupData.disabledSites || []
        });
        saveToStorage();
        renderGroupsList();
        selectGroup(snippetGroups.length - 1);
        showStatus(t('status_group_imported'));
      }
    } catch (err) { 
      console.error(err);
      showStatus(t('status_invalid_file'), true); 
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function restoreOptions() {
  chrome.storage.sync.get({
    config: JSON.stringify(currentConfig),
    snippetGroups: defaultSnippetGroups
  }, (items) => {
    try {
      currentConfig = JSON.parse(items.config);
    } catch (e) {
      console.error("Invalid config JSON", e);
    }

    document.getElementById('hotkey-display-nextCursor').textContent = currentConfig.nextCursor || "Ctrl+Space";
    document.getElementById('hotkey-display-addSnippet').textContent = currentConfig.addSnippet || "Alt+N";
    document.getElementById('hotkey-display-toggleFold').textContent = currentConfig.toggleFold || "Alt+L";

    const particlesToggle = document.getElementById('particles-toggle');
    if (particlesToggle) {
      particlesToggle.checked = currentConfig.showParticles !== false;
      particlesToggle.addEventListener('change', () => {
        currentConfig.showParticles = particlesToggle.checked;
        saveToStorage();
      });
    }

    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
      languageSelect.style.display = 'none';
      // Manual language selection is not supported with chrome.i18n
      const card = languageSelect.closest('.setting-card');
      if (card) card.style.display = 'none';
    }

    applyTranslations();

    snippetGroups = items.snippetGroups;
    renderGroupsList();
    if (snippetGroups.length > 0) selectGroup(0);
    initHotkeyButtons();
  });
}

window.onLocaleChange = () => {
  renderGroupsList();
  if (activeGroupIndex !== -1) {
    selectGroup(activeGroupIndex);
  }
};
