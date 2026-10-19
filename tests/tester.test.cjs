const { assertTemplateOutput } = require('./helpers/fragment.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const root = path.join(__dirname, '..');

function runtimeHarness() {
  const fields = Object.fromEntries(['input', 'textarea', 'rich'].map(name => [`snippet-test-${name}`, {
    value: 'test text', textContent: 'rich text', attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused = true; }
  }]));
  const listeners = {};
  const requests = [];
  const context = vm.createContext({
    window: { location: { origin: 'chrome-extension://test' }, parent: { postMessage: (...args) => requests.push(args) },
      addEventListener: (type, listener) => { listeners[type] = listener; } },
    document: { getElementById: id => fields[id] },
    loadSnippetLocale: async () => {}, loadLocale: async () => {}, t: key => key
  });
  vm.runInContext('let config = {}; let snippets = []; let typingSeqLength = 7; let lastExpansion = {};', context);
  for (const file of ['utils/constants.js', 'utils/config.js', 'utils/i18n.js', 'utils/triggers.js', 'content/fragment.js', 'content/evaluator.js', 'content/template-parser.js', 'content/template.js', 'options/tester-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  return { context, fields, requests, listeners };
}

test('the tester uses current group data and retains helpers across subgroups regardless of site rules', async () => {
  const { context, requests, listeners, fields } = runtimeHarness();
  context.loadSettings();
  assert.equal(requests[0][0].type, 'snippetpp:test-request');
  const groups = [{ name: 'Test', siteMode: 'whitelist', disabledSites: ['never.example'], snippets: [
    { name: 'short', trigger: '/a', replacement: 'first' },
    { name: 'long', trigger: '/abc ${name}', replacement: '{{@helper()}}', subgroupId: 'one' },
    { name: 'helper', trigger: '/helper', replacement: 'unsaved helper', subgroupId: 'two', disabled: true }
  ] }];
  await context.applySnippetTestState({ config: { uiLocale: 'ko' }, snippetGroups: groups });
  const loaded = vm.runInContext('snippets', context);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].name, 'long');
  assert.equal(loaded[0].compiledRegex.exec('/abc Guest').groups.name, 'Guest');
  assert.equal(loaded[0].groupSnippets, groups[0].snippets);
  assert.equal(loaded.some(snippet => snippet.name === 'helper'), false);
  assertTemplateOutput(await context.processTemplate('{{@helper()}}', {}, { snippets: loaded[0].groupSnippets }), 'unsaved helper');
  assert.equal(loaded[0].sourceSnippet, groups[0].snippets[1]);
  assert.equal(vm.runInContext('config.uiLocale', context), 'ko');
  assert.equal(vm.runInContext('config.nextCursor', context), 'Ctrl+Space');
  assert.equal(vm.runInContext('typingSeqLength', context), 0);
  assert.equal(vm.runInContext('lastExpansion', context), null);
  assert.equal(fields['snippet-test-rich'].attributes['aria-label'], 'tester_rich_label');

  listeners.message({ source: {}, origin: 'chrome-extension://test', data: { type: 'snippetpp:test-clear' } });
  assert.equal(fields['snippet-test-input'].value, 'test text');
  listeners.message({ source: context.window.parent, origin: 'https://foreign.example', data: { type: 'snippetpp:test-clear' } });
  assert.equal(fields['snippet-test-input'].value, 'test text');
  listeners.message({ source: context.window.parent, origin: 'chrome-extension://test', data: { type: 'snippetpp:test-clear' } });
  assert.equal(fields['snippet-test-input'].value, '');
  assert.equal(fields['snippet-test-textarea'].value, '');
  assert.equal(fields['snippet-test-rich'].textContent, '');
  assert.equal(fields['snippet-test-textarea'].focused, true);
});

test('parent tester sends unsaved state for the selected group only to its own frame', () => {
  const sent = [];
  const windowListeners = {};
  const frameListeners = {};
  const controls = {
    'snippet-test-group': { value: 'all', innerHTML: '', appendChild() {}, addEventListener() {} },
    'snippet-test-frame': { contentWindow: { postMessage: (...args) => sent.push(args) }, addEventListener: (type, listener) => { frameListeners[type] = listener; } },
    'snippet-test-clear': { addEventListener(type, listener) { this.listener = listener; } }
  };
  const groups = [{ name: 'One', snippets: [] }, { name: 'Two', snippets: [] }];
  let syncs = 0;
  const context = vm.createContext({
    window: { location: { origin: 'chrome-extension://test' }, addEventListener: (type, listener) => { windowListeners[type] = listener; } },
    document: { getElementById: id => controls[id], createElement: () => ({}) },
    currentConfig: { uiLocale: 'ko' }, snippetGroups: groups, t: key => key,
    syncActiveGroupData() { syncs++; groups[0].snippets = [{ trigger: '/new', replacement: 'unsaved' }]; }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'options/tester.js'), 'utf8'), context);
  context.refreshSnippetTester();
  assert.equal(syncs, 1);
  assert.equal(sent[0][0].snippetGroups[0].snippets[0].replacement, 'unsaved');
  assert.equal(sent[0][1], 'chrome-extension://test');
  controls['snippet-test-group'].value = '1';
  context.sendSnippetTestState();
  assert.equal(sent[1][0].snippetGroups.length, 1);
  assert.equal(sent[1][0].snippetGroups[0], groups[1]);
  windowListeners.message({ source: {}, origin: 'chrome-extension://test', data: { type: 'snippetpp:test-request' } });
  assert.equal(sent.length, 2);
  windowListeners.message({ source: controls['snippet-test-frame'].contentWindow, origin: 'https://foreign.example', data: { type: 'snippetpp:test-request' } });
  assert.equal(sent.length, 2);
  controls['snippet-test-clear'].listener();
  assert.equal(sent.at(-1)[0].type, 'snippetpp:test-clear');
  frameListeners.load();
  assert.equal(sent.at(-1)[0].type, 'snippetpp:test-state');
});

test('test page loads the shared expansion engine in a separate document', () => {
  const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  const tester = fs.readFileSync(path.join(root, 'tester.html'), 'utf8');
  assert.match(options, /data-tab="tester"/);
  assert.match(options, /id="snippet-test-frame" src="tester.html"/);
  assert.doesNotMatch(options, /src="content\/handlers.js"/);
  assert.match(tester, /<script defer src="bundles\/tester\.js"><\/script>/);
  assert.match(fs.rawReadFileSync(path.join(root, 'entries/tester.js'), 'utf8'), /initializeHandlers\(\{ load: loadSettings/);
  assert.match(fs.rawReadFileSync(path.join(root, 'content/handlers.js'), 'utf8'), /from '\.\/effects\.js'/);
  assert.doesNotMatch(tester, /src="content\/settings.js"/);
  for (const locale of ['ko', 'en']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'));
    for (const [, key] of (options + tester).matchAll(/data-i18n="([^"]+)"/g)) assert.ok(catalog[key], `${locale}: ${key}`);
  }
});
