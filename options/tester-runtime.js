// This replaces content/settings.js only in the isolated test frame. Site rules
// are intentionally ignored; all snippets in the selected parent group apply.
function loadSettings() {
  if (window.parent !== window) window.parent.postMessage({ type: 'snippetpp:test-request' }, window.location.origin);
}

function applySnippetTestState(state) {
  config = { ...DEFAULT_CONFIG, ...state.config };
  snippets = [];
  for (const group of state.snippetGroups || []) {
    if (!group || !Array.isArray(group.snippets)) continue;
    for (const snippet of group.snippets) {
      if (!snippet || snippet.disabled === true || typeof snippet.trigger !== 'string' || !snippet.trigger) continue;
      const compiled = compileTrigger(snippet.trigger);
      snippets.push({ ...snippet, groupSnippets: group.snippets, sourceSnippet: snippet,
        isRegex: compiled.isRegex, compiledRegex: compiled.regex, literalTrigger: compiled.literal });
    }
  }
  snippets.sort((a, b) => b.trigger.length - a.trigger.length);
  typingSeqLength = 0;
  lastExpansion = null;
  loadSnippetLocale(config.uiLocale);
  return loadLocale(config.uiLocale, false).then(() => {
    document.getElementById('snippet-test-rich').setAttribute('aria-label', t('tester_rich_label'));
    document.getElementById('snippet-test-input').setAttribute('aria-label', t('tester_input_label'));
    document.getElementById('snippet-test-textarea').setAttribute('aria-label', t('tester_textarea_label'));
  });
}

function clearSnippetTestEditors() {
  document.getElementById('snippet-test-input').value = '';
  document.getElementById('snippet-test-textarea').value = '';
  document.getElementById('snippet-test-rich').textContent = '';
  typingSeqLength = 0;
  lastExpansion = null;
  document.getElementById('snippet-test-textarea').focus();
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  if (event.data?.type === 'snippetpp:test-state') applySnippetTestState(event.data);
  if (event.data?.type === 'snippetpp:test-clear') clearSnippetTestEditors();
});
