/**
 * Snippet++ Internationalization (i18n) Engine using chrome.i18n
 */

/**
 * Applies translations to all elements with data-i18n attribute.
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = t(key);
    if (value && value !== key) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = value;
      } else {
        el.textContent = value;
      }
    }
  });
}

/**
 * Returns a translated string for a given key.
 * Supports dots in keys by converting them to underscores.
 */
function t(key, params = {}) {
  const i18nKey = key.replace(/\./g, '_');
  let value = chrome.i18n.getMessage(i18nKey);
  
  if (!value) return key;

  // Handle placeholders like {name}
  for (const [k, v] of Object.entries(params)) {
    value = value.replace(`{${k}}`, v);
  }
  
  return value;
}

// Initial application
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  document.body.classList.remove('i18n-loading');
});

// For compatibility with scripts that might still call loadLocale
function loadLocale(locale) {
  applyTranslations();
  if (typeof window.onLocaleChange === 'function') {
    window.onLocaleChange();
  }
}
