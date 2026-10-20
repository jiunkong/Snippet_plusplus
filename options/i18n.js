
// The browser locale is fixed for chrome.i18n. Load packaged message catalogs
// when the user chooses a language for the options page.
export let selectedMessages = null;
export let selectedLocale = 'system';
export let localeLoadVersion = 0;

export function t(key, params = {}) {
  const i18nKey = key.replace(/\./g, '_');
  const substitutions = Array.isArray(params) ? params : [];
  let value = selectedMessages?.[i18nKey]?.message ||
    chrome.i18n.getMessage(i18nKey, substitutions);
  if (!value) return key;

  if (selectedMessages) {
    value = value.replace(/\$(\d+)/g, (match, index) => substitutions[Number(index) - 1] ?? match);
  }
  if (!Array.isArray(params)) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, replacement);
    }
  }
  return value;
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const value = t(el.getAttribute('data-i18n'));
    if (!value) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = value;
    else el.textContent = value;
  });
  for (const [attribute, dataAttribute] of [['title', 'data-i18n-title'], ['aria-label', 'data-i18n-aria-label']]) {
    document.querySelectorAll(`[${dataAttribute}]`).forEach(el => {
      el.setAttribute(attribute, t(el.getAttribute(dataAttribute)));
    });
  }
  document.documentElement.lang = selectedLocale === 'system'
    ? chrome.i18n.getUILanguage().split('-')[0]
    : selectedLocale;
}

export async function loadLocale(locale, notify = true) {
  const version = ++localeLoadVersion;
  let nextLocale = locale === 'ko' || locale === 'en' ? locale : 'system';
  let nextMessages = null;
  if (nextLocale !== 'system') {
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${nextLocale}/messages.json`));
      if (!response.ok) throw new Error(`Locale request failed: ${response.status}`);
      nextMessages = await response.json();
    } catch (error) {
      console.error('Snippet++: Unable to load language', error);
      nextLocale = 'system';
    }
  }
  if (version !== localeLoadVersion) return;
  selectedLocale = nextLocale;
  selectedMessages = nextMessages;
  applyTranslations();
  document.body.classList.remove('i18n-loading');
  if (notify && typeof window.onLocaleChange === 'function') window.onLocaleChange();
}

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get selectedMessages() { return selectedMessages; }, set selectedMessages(value) { selectedMessages = value; },
  get selectedLocale() { return selectedLocale; }, set selectedLocale(value) { selectedLocale = value; },
  get localeLoadVersion() { return localeLoadVersion; }, set localeLoadVersion(value) { localeLoadVersion = value; },
};
