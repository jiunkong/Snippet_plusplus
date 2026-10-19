import { moduleState as __state_content_state_js } from '../content/state.js';
import { DEFAULT_CONFIG } from '../utils/config.js';
import { prepareSnippetTemplate } from '../language-core/src/index.ts';
import { compileTrigger } from '../utils/triggers.js';
import { loadSnippetLocale } from '../utils/i18n.js';
import { loadLocale, t } from './i18n.js';
// This replaces content/settings.js only in the isolated test frame. Site rules
// are intentionally ignored; all snippets in the selected parent group apply.
export function loadSettings() {
  if (window.parent !== window) window.parent.postMessage({ type: 'snippetpp:test-request' }, window.location.origin);
}

export function applySnippetTestState(state) {
  __state_content_state_js.config = { ...DEFAULT_CONFIG, ...state.config };
  __state_content_state_js.snippets = [];
  for (const group of state.snippetGroups || []) {
    if (!group || !Array.isArray(group.snippets)) continue;
    group.snippets.forEach(snippet => { if (snippet && typeof snippet === 'object') prepareSnippetTemplate(snippet); });
    for (const snippet of group.snippets) {
      if (!snippet || snippet.disabled === true || typeof snippet.trigger !== 'string' || !snippet.trigger) continue;
      const compiled = compileTrigger(snippet.trigger);
      __state_content_state_js.snippets.push({ ...snippet, groupSnippets: group.snippets, sourceSnippet: snippet,
        isRegex: compiled.isRegex, compiledRegex: compiled.regex, literalTrigger: compiled.literal });
    }
  }
  __state_content_state_js.snippets.sort((a, b) => b.trigger.length - a.trigger.length);
  __state_content_state_js.typingSeqLength = 0;
  __state_content_state_js.lastExpansion = null;
  loadSnippetLocale(__state_content_state_js.config.uiLocale);
  return loadLocale(__state_content_state_js.config.uiLocale, false).then(() => {
    document.getElementById('snippet-test-rich').setAttribute('aria-label', t('tester_rich_label'));
    document.getElementById('snippet-test-input').setAttribute('aria-label', t('tester_input_label'));
    document.getElementById('snippet-test-textarea').setAttribute('aria-label', t('tester_textarea_label'));
  });
}

export function clearSnippetTestEditors() {
  document.getElementById('snippet-test-input').value = '';
  document.getElementById('snippet-test-textarea').value = '';
  document.getElementById('snippet-test-rich').textContent = '';
  __state_content_state_js.typingSeqLength = 0;
  __state_content_state_js.lastExpansion = null;
  document.getElementById('snippet-test-textarea').focus();
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  if (event.data?.type === 'snippetpp:test-state') applySnippetTestState(event.data);
  if (event.data?.type === 'snippetpp:test-clear') clearSnippetTestEditors();
});
