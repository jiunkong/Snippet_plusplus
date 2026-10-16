// Content scripts use the selected options language for user-facing errors.
// Chrome's built-in i18n API always uses the browser language.
const snippetLocaleCatalogs = new Map();
const snippetLocaleLoads = new Map();

function currentSnippetLocale() {
  return typeof config !== 'undefined' ? config.uiLocale : 'system';
}

function loadSnippetLocale(locale = currentSnippetLocale()) {
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

function snippetMessage(key, substitutions = [], locale = currentSnippetLocale()) {
  const message = snippetLocaleCatalogs.get(locale)?.[key]?.message;
  if (message) return message.replace(/\$(\d+)/g, (match, index) => String(substitutions[Number(index) - 1] ?? match));
  return typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getMessage(key, substitutions.map(String)) : '';
}

function createSnippetError(key, values = [], fallback = '') {
  const error = new Error(snippetMessage(key, values) || fallback || `${key}: ${values.join(', ')}`);
  error.messageKey = key;
  error.messageValues = values;
  return error;
}
