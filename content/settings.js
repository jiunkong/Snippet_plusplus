// --- Settings: Storage Loading ---

let settingsLoadVersion = 0;

function loadSettings() {
  const version = ++settingsLoadVersion;
  loadSyncedState(defaultConfig, defaultSnippetGroups).then(items => {
    if (version !== settingsLoadVersion) return;
    config = items.config;

    const currentUrl = window.location.href;
    snippets = [];
    if (Array.isArray(items.snippetGroups)) {
      items.snippetGroups.forEach(group => {
        if (!group || !Array.isArray(group.snippets)) return;

        // Normalise disabledSites: support both array (new) and comma-string (legacy)
        let disabledSites = [];
        if (Array.isArray(group.disabledSites)) {
          disabledSites = group.disabledSites.map(s => s.trim()).filter(Boolean);
        } else {
          disabledSites = (group.disabledSites || "")
            .split(',').map(s => s.trim()).filter(Boolean);
        }

        const siteMode = group.siteMode || 'blacklist';
        const onList = disabledSites.some(site => currentUrl.includes(site));
        
        if (siteMode === 'blacklist' && onList) return;
        if (siteMode === 'whitelist' && !onList) return;

        group.snippets.forEach(s => {
          if (!s || typeof s.trigger !== 'string' || !s.trigger) return;
          const compiled = compileTrigger(s.trigger);
          snippets.push({
            ...s,
            isRegex:        compiled.isRegex,
            compiledRegex:  compiled.regex,
            literalTrigger: compiled.literal
          });
        });
      });
    }

    // Longer triggers take priority so they match before their prefixes
    snippets.sort((a, b) => b.trigger.length - a.trigger.length);
  }).catch(error => console.error('Snippet++: Sync load failed', error));
}

// Watch for settings changes and hot-reload
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(key =>
    key === 'config' || key === 'snippetGroups' || key === SNIPPET_META_KEY || key.startsWith(SNIPPET_CHUNK_PREFIX)
  )) {
    loadSettings();
  }
});
