// --- Settings: Storage Loading ---

function loadSettings() {
  chrome.storage.sync.get({
    config: JSON.stringify(defaultConfig),
    snippetGroups: defaultSnippetGroups
  }, (items) => {
    try {
      config = JSON.parse(items.config);
    } catch (e) {
      console.error("Snippet++: Invalid config JSON", e);
      config = defaultConfig;
    }

    const currentUrl = window.location.href;
    snippets = [];
    if (items.snippetGroups) {
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
  });
}

// Watch for settings changes and hot-reload
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.config || changes.snippetGroups)) {
    loadSettings();
  }
});
