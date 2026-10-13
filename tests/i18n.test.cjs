const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'options', 'i18n.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'ko'].map(locale => [
  locale, JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'))
]));

test('manual language choice translates options and validation messages', async () => {
  const title = { tagName: 'H3', textContent: '', getAttribute: () => 'settings_language' };
  const browserOption = { tagName: 'OPTION', textContent: '', getAttribute: () => 'settings_language_system' };
  const document = {
    querySelectorAll: () => [title, browserOption],
    documentElement: { lang: '' },
    body: { classList: { remove() {} } }
  };
  let notifications = 0;
  const context = vm.createContext({
    document,
    window: { onLocaleChange: () => notifications++ },
    chrome: {
      i18n: {
        getMessage: key => catalogs.en[key]?.message || '',
        getUILanguage: () => 'en-US'
      },
      runtime: { getURL: relative => relative }
    },
    fetch: async url => ({ ok: true, json: async () => catalogs[url.split('/')[1]] }),
    console
  });
  vm.runInContext(source, context);

  await context.loadLocale('ko');
  assert.equal(title.textContent, catalogs.ko.settings_language.message);
  assert.equal(browserOption.textContent, catalogs.ko.settings_language_system.message);
  assert.equal(document.documentElement.lang, 'ko');
  assert.equal(context.t('err_unknown_tag', ['test']), catalogs.ko.err_unknown_tag.message.replace('$1', 'test'));

  await context.loadLocale('system');
  assert.equal(title.textContent, catalogs.en.settings_language.message);
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(notifications, 2);
});
