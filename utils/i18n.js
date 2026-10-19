import { moduleState as __state_content_state_js } from '../content/state.js';
// Content scripts use the selected options language for user-facing errors.
// Chrome's built-in i18n API always uses the browser language.
export const snippetLocaleCatalogs = new Map();
export const snippetLocaleLoads = new Map();

export function currentSnippetLocale() {
  return typeof __state_content_state_js.config !== 'undefined' ? __state_content_state_js.config.uiLocale : 'system';
}

export function loadSnippetLocale(locale = currentSnippetLocale()) {
  if (locale !== 'ko' && locale !== 'en') return Promise.resolve(null);
  if (!snippetLocaleLoads.has(locale)) {
    const load = (async () => {
      try {
        const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
        if (!response.ok) return null;
        const catalog = await response.json();
        snippetLocaleCatalogs.set(locale, catalog);
        return catalog;
      } catch (error) { return null; }
    })();
    snippetLocaleLoads.set(locale, load);
    load.then(catalog => { if (!catalog) snippetLocaleLoads.delete(locale); });
  }
  return snippetLocaleLoads.get(locale);
}

export function snippetMessage(key, substitutions = [], locale = currentSnippetLocale()) {
  const message = snippetLocaleCatalogs.get(locale)?.[key]?.message;
  if (message) return message.replace(/\$(\d+)/g, (match, index) => String(substitutions[Number(index) - 1] ?? match));
  return typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getMessage(key, substitutions.map(String)) : '';
}

export function createSnippetError(key, values = [], fallback = '') {
  const error = new Error(snippetMessage(key, values) || fallback || `${key}: ${values.join(', ')}`);
  error.messageKey = key;
  error.messageValues = values;
  return error;
}
