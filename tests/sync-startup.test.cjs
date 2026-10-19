const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

for (const file of ['options/state.js', 'content/state.js']) {
  test(`${file} does not create example snippets before account sync arrives`, () => {
    const context = vm.createContext({ DEFAULT_CONFIG: {} });
    vm.runInContext(read(file), context);
    assert.equal(vm.runInContext('defaultSnippetGroups.length', context), 0);
  });
}

function harness(groups = []) {
  const data = {};
  if (groups.length) data.snippetGroups = groups;
  const writes = [];
  let changed;
  let reloads = 0;
  const elements = new Map();
  const context = vm.createContext({
    TextEncoder, structuredClone, console,
    DEFAULT_CONFIG: {}, defaultSnippetGroups: [], currentConfig: {}, snippetGroups: [],
    activeGroupIndex: -1, saveTimeout: null,
    chrome: { runtime: {}, storage: {
      sync: {
        get(keys, callback) { callback(structuredClone(Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])))); },
        set(items, callback) { writes.push(items); Object.assign(data, items); callback(); },
        remove(keys, callback) { keys.forEach(key => delete data[key]); callback(); }
      },
      onChanged: { addListener(listener) { changed = listener; } }
    } },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { addEventListener() {} });
        return elements.get(id);
      },
      querySelectorAll() { return []; }
    },
    window: { location: { reload() { reloads++; } } },
    loadLocale: async () => {}, renderGroupsList() {},
    selectGroup(index) { context.activeGroupIndex = index; },
    syncActiveGroupData() {
      // Model the optional fields materialized when reading the rendered editor.
      for (const group of context.snippetGroups) {
        group.disabledSites ||= [];
        group.siteMode ||= 'blacklist';
        group.subgroups ||= [];
      }
    },
    initHotkeyButtons() {}, refreshSnippetTester() {}, initTimeoutScrubber() {},
    scheduleGroupDiagnostics() {}, t: key => key,
    confirm() { assert.fail('untouched startup state must not prompt to overwrite remote data'); }
  });
  vm.runInContext(read('utils/sync-backup.js'), context);
  vm.runInContext(read('utils/sync.js'), context);
  vm.runInContext(read('options/storage.js'), context);
  context.showStatus = () => {};
  return { context, data, writes, changed: (...args) => changed(...args), reloads: () => reloads };
}

test('opening settings and saving unchanged editor normalization never writes to Sync', async () => {
  const { context, writes } = harness([{ name: 'Existing', snippets: [] }]);
  await context.restoreOptions();
  await context.saveToStorage();
  assert.equal(writes.length, 0);
  context.currentConfig.uiLocale = 'en';
  await context.saveToStorage();
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ['config']);
});

test('reinstall startup stays read-only and accepts account snippets arriving later', async () => {
  const { context, data, writes, changed, reloads } = harness();
  await context.restoreOptions();
  await context.saveToStorage();
  assert.equal(context.snippetGroups.length, 0);
  assert.equal(writes.length, 0);
  data.snippetGroups = [{ name: 'From another device', snippets: [{ trigger: '/work', replacement: 'Saved' }] }];
  changed({ snippetGroups: { newValue: data.snippetGroups } }, 'sync');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads(), 1);
  assert.equal(writes.length, 0);
});

test('preference edits with no snippets only write config, without publishing an empty list', async () => {
  const { context, writes } = harness();
  await context.restoreOptions();
  context.currentConfig.uiLocale = 'en';
  assert.equal(await context.saveToStorage(), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ['config']);
});

test('an options page opened during partial deletion retries when a complete revision arrives', async () => {
  const { context, data, changed } = harness();
  data.snippetGroupsSync = { revision: 'removed', count: 1 };
  await context.restoreOptions();
  assert.equal(context.snippetGroups.length, 0);
  delete data.snippetGroupsSync;
  data.snippetGroups = [{ name: 'Restored by B', snippets: [] }];
  changed({ snippetGroupsSync: {}, snippetGroups: { newValue: data.snippetGroups } }, 'sync');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.snippetGroups[0].name, 'Restored by B');
});
