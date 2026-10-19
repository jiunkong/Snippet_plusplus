// --- Settings: Storage Loading ---

let settingsLoadVersion = 0;

function loadSettings(reportFailure = false) {
  const version = ++settingsLoadVersion;
  return loadSyncedState(defaultConfig, defaultSnippetGroups).then(items => {
    if (version !== settingsLoadVersion) return false;
    config = items.config;
    loadSnippetLocale(config.uiLocale);

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

        group.snippets.forEach(s => { if (s && typeof s === 'object') prepareSnippetTemplate(s); });
        group.snippets.forEach(s => {
          if (!s || s.disabled === true || typeof s.trigger !== 'string' || !s.trigger) return;
          const compiled = compileTrigger(s.trigger);
          snippets.push({
            ...s,
            groupSnippets: group.snippets,
            sourceSnippet: s,
            isRegex:        compiled.isRegex,
            compiledRegex:  compiled.regex,
            literalTrigger: compiled.literal
          });
        });
      });
    }

    // Longer triggers take priority so they match before their prefixes
    snippets.sort((a, b) => b.trigger.length - a.trigger.length);
    return true;
  }).catch(error => {
    if (reportFailure) throw error;
    console.error('Snippet++: Sync load failed', error);
    return false;
  });
}

let settingsReloadTask = null;

function reloadSnippetSettings() {
  if (settingsReloadTask) return settingsReloadTask;
  settingsReloadTask = (async () => {
    // A storage-change load may supersede the explicit request; retry once to
    // make sure the success toast follows an applied, complete snapshot.
    if (!await loadSettings(true) && !await loadSettings(true)) throw new Error('Settings refresh superseded');
    typingSeqLength = 0;
    await loadSnippetLocale(config.uiLocale);
    showSnippetToast(snippetMessage('status_snippets_reloaded'), '#22c55e', 'success');
  })().catch(async () => {
    await loadSnippetLocale(config.uiLocale);
    showSnippetToast(snippetMessage('status_snippets_reload_failed'), '#f87171', true);
  }).finally(() => { settingsReloadTask = null; });
  return settingsReloadTask;
}

// Watch for settings changes and hot-reload
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(key =>
    key === 'config' || key === 'snippetGroups' || key === SNIPPET_META_KEY || key.startsWith(SNIPPET_CHUNK_PREFIX)
  )) {
    loadSettings();
  }
});
