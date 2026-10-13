const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('each configured hotkey has a display and recording button', () => {
  for (const key of ['nextCursor', 'undoExpansion', 'addSnippet', 'toggleFold']) {
    assert.match(html, new RegExp(`id="hotkey-display-${key}"`));
    assert.match(html, new RegExp(`data-key="${key}"`));
  }
});

test('language selector exposes browser, Korean, and English choices', () => {
  assert.match(html, /id="language-select"/);
  for (const locale of ['system', 'ko', 'en']) assert.match(html, new RegExp(`value="${locale}"`));
});

test('shared config and expansion helpers load before their callers', () => {
  const contentScripts = manifest.content_scripts[0].js;
  assert.ok(contentScripts.indexOf('utils/config.js') < contentScripts.indexOf('content/state.js'));
  assert.ok(contentScripts.indexOf('utils/sync.js') < contentScripts.indexOf('content/settings.js'));
  assert.ok(contentScripts.indexOf('content/expansion.js') < contentScripts.indexOf('content/handlers.js'));
  assert.ok(html.indexOf('utils/config.js') < html.indexOf('options/state.js'));
  assert.ok(html.indexOf('utils/sync.js') < html.indexOf('options/storage.js'));
});
