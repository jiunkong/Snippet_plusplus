// The browser locale is fixed for chrome.i18n. Load packaged message catalogs
// when the user chooses a language for the options page.
let selectedMessages = null;
let selectedLocale = 'system';
let localeLoadVersion = 0;

function t(key, params = {}) {
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

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const value = t(el.getAttribute('data-i18n'));
    if (!value) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = value;
    else el.textContent = value;
  });
  document.documentElement.lang = selectedLocale === 'system'
    ? chrome.i18n.getUILanguage().split('-')[0]
    : selectedLocale;
}

async function loadLocale(locale, notify = true) {
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
