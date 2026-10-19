const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function toastHarness() {
  const hosts = [];
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    config: { showParticles: false },
    CSS: { supports: (_property, value) => /^(#[0-9a-f]{3,8}|red|green|blue)$/i.test(value) },
    chrome: { i18n: { getMessage: (key, [detail]) => key === 'status_expansion_failed' ? `Expansion failed: ${detail}` : (key === 'err_unexpected' ? 'Unexpected error' : detail) } },
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    document: {
      documentElement: { appendChild(host) { host.isConnected = true; hosts.push(host); } },
      createElement() {
        const host = {
          style: {}, attributes: {}, isConnected: false,
          setAttribute(key, value) { this.attributes[key] = value; },
          remove() { this.isConnected = false; },
          attachShadow() {
            this.root = { message: { style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }, querySelector() { return this.message; } };
            return this.root;
          }
        };
        return host;
      }
    }
  });
  for (const file of ['utils/i18n.js', 'content/effects.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return { context, hosts, timers };
}

test('expansion errors show a localized accessible toast without interpreting error HTML', async () => {
  const { context, hosts, timers } = toastHarness();
  const detail = '<img src=x onerror=alert(1)>';
  await context.showSnippetError(context.createSnippetError('test_error_detail', [detail]));
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].root.message.textContent, `Expansion failed: ${detail}`);
  assert.match(hosts[0].root.innerHTML, /role="alert"/);
  assert.doesNotMatch(hosts[0].root.innerHTML, /<img/);
  assert.equal(hosts[0].attributes.contenteditable, 'false');
  assert.match(hosts[0].style.cssText, /pointer-events: none/);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 6000);
  timer.callback();
  assert.equal(hosts[0].isConnected, false);
});

test('error toast includes localized source coordinates and renders snippet names as plain text', async () => {
  const { context, hosts } = toastHarness();
  const catalogs = Object.fromEntries(['ko', 'en'].map(locale => [locale,
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', `_locales/${locale}/messages.json`), 'utf8'))]));
  context.chrome.runtime = { getURL: value => value };
  context.fetch = async url => ({ ok: true, json: async () => catalogs[url.split('/')[1]] });
  for (const locale of ['ko', 'en']) {
    context.config.uiLocale = locale;
    const error = context.createSnippetError('err_list_index_target');
    error.snippetLocation = { snippetName: '<b>helper</b>', line: 3, column: 5 };
    await context.showSnippetError(error);
    const label = catalogs[locale].error_location_snippet.message.replace('$1', '<b>helper</b>').replace('$2', '3').replace('$3', '5');
    assert.ok(hosts[0].root.message.textContent.endsWith('\n' + label));
    assert.doesNotMatch(hosts[0].root.innerHTML, /<b>helper/);
    assert.equal(hosts[0].root.message.style.whiteSpace, 'pre-wrap');
    error.snippetLocation.snippetName = '';
    await context.showSnippetError(error);
    assert.ok(hosts[0].root.message.textContent.endsWith('\n' + catalogs[locale].error_location.message.replace('$1', '3').replace('$2', '5')));
  }
});

test('repeated errors update one toast and renew its dismissal timer', async () => {
  const { context, hosts, timers } = toastHarness();
  await context.showSnippetError(context.createSnippetError('test_error_detail', ['first']));
  const firstTimer = [...timers.keys()][0];
  await context.showSnippetError(context.createSnippetError('test_error_detail', ['second']));
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].root.message.textContent, 'Expansion failed: second');
  assert.equal(timers.has(firstTimer), false);
  assert.equal(timers.size, 1);
  [...timers.values()][0].callback();
  await context.showSnippetError(context.createSnippetError('test_error_detail', ['third']));
  assert.equal(hosts.length, 2);
  assert.equal(hosts[1].isConnected, true);
});

test('selected language controls both toast and error details regardless of browser language', async () => {
  const { context, hosts } = toastHarness();
  const catalogs = {};
  for (const locale of ['ko', 'en']) {
    catalogs[locale] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', `_locales/${locale}/messages.json`), 'utf8'));
  }
  const requests = [];
  context.chrome.runtime = { getURL: value => value };
  context.fetch = async url => {
    requests.push(url);
    const locale = url.split('/')[1];
    return { ok: true, json: async () => catalogs[locale] };
  };
  // Simulate an English browser. Explicit Korean must override it, including
  // errors created before the requested catalog finishes loading.
  context.chrome.i18n.getMessage = (key, values = []) => (catalogs.en[key]?.message || '')
    .replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1]);
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'content/fragment.js', 'content/evaluator.js', 'content/template-parser.js', 'content/template.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  context.config.uiLocale = 'ko';
  const error = context.createSnippetError('err_snippet_cursor_offset');
  assert.equal(error.message, catalogs.en.err_snippet_cursor_offset.message);
  await context.showSnippetError(error);
  assert.equal(hosts[0].root.message.textContent, catalogs.ko.status_expansion_failed.message
    .replace('$1', catalogs.ko.err_snippet_cursor_offset.message));
  await assert.rejects(context.processTemplate('{{@Missing()}}', {}),
    exception => exception.message === catalogs.ko.err_snippet_call_target.message.replace('$1', 'Missing'));
  assert.throws(() => context.createRange(1.5, 3),
    exception => exception.message === catalogs.ko.err_range_integer_bounds.message);

  // Explicit English must also override a Korean browser after a settings change.
  context.chrome.i18n.getMessage = (key, values = []) => (catalogs.ko[key]?.message || '')
    .replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1]);
  await assert.rejects(context.processTemplate('{{}}', {}),
    error => error.message === '알 수 없는 태그입니다: {{}}');
  context.config.uiLocale = 'en';
  await context.showSnippetError(context.createSnippetError('err_snippet_call_args', ['hello', 2]));
  assert.equal(hosts[0].root.message.textContent, catalogs.en.status_expansion_failed.message
    .replace('$1', catalogs.en.err_snippet_call_args.message.replace('$1', 'hello').replace('$2', '2')));
  context.config.uiLocale = 'ko';
  await context.showSnippetError(error);
  assert.equal(requests.length, 2); // Catalogs are cached across language changes.
  context.config.uiLocale = 'system';
  await context.showSnippetError(error);
  assert.equal(hosts[0].root.message.textContent, catalogs.ko.status_expansion_failed.message
    .replace('$1', catalogs.ko.err_snippet_cursor_offset.message));
  assert.equal(requests.length, 2);
});

test('custom toasts render message text with the requested color and reject invalid colors', () => {
  const { context, hosts } = toastHarness();
  context.showSnippetToast('<b>Done</b>', '#22c55e');
  assert.equal(hosts.length, 1);
  const message = hosts[0].root.message;
  assert.equal(message.textContent, '<b>Done</b>');
  assert.equal(message.style.borderColor, '#22c55e');
  assert.equal(message.style.backgroundColor, '#0f172a');
  assert.equal(message.attributes.role, 'status');
  assert.doesNotMatch(hosts[0].root.innerHTML, /<b>/);
  context.showSnippetToast('Second', 'red');
  assert.equal(hosts.length, 1);
  assert.equal(message.style.borderColor, 'red');
  for (const color of ['', 'not-a-color', 'red; position: fixed', 'var(--color)', null]) {
    assert.throws(() => context.showSnippetToast('Invalid', color), error => error.messageKey === 'err_toast_color');
  }
  assert.equal(message.textContent, 'Second');
});
