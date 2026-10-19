const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'sync.js'), 'utf8');

function syncHarness(data = {}) {
  const runtime = { lastError: null };
  const storage = {
    QUOTA_BYTES: 102400,
    QUOTA_BYTES_PER_ITEM: 8192,
    get(keys, callback) {
      const result = {};
      for (const key of keys) if (key in data) result[key] = data[key];
      callback(result);
    },
    set(items, callback) {
      // Model base::EscapeJSONString, including escapes absent from JS JSON.
      const bytes = value => new TextEncoder().encode(JSON.stringify(value)
        .replace(/</g, '\\u003C')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')).length;
      const next = { ...data, ...items };
      const oversized = Object.entries(items).some(([key, value]) => bytes(value) + key.length > this.QUOTA_BYTES_PER_ITEM);
      const total = Object.entries(next).reduce((sum, [key, value]) => sum + bytes(value) + key.length, 0);
      if (oversized || total > this.QUOTA_BYTES) runtime.lastError = { message: 'QUOTA_BYTES exceeded' };
      else Object.assign(data, items);
      callback();
      runtime.lastError = null;
    },
    remove(keys, callback) {
      for (const key of keys) delete data[key];
      callback();
    }
  };
  const chrome = { runtime, storage: { sync: storage } };
  const context = vm.createContext({ chrome, TextEncoder, console, Date, Math });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'utils', 'sync-backup.js'), 'utf8'), context);
  vm.runInContext(source, context);
  return { context, data, storage };
}

test('legacy snippet groups load before the first chunked save', async () => {
  const { context, data } = syncHarness();
  data.config = JSON.stringify({ nextCursor: 'Alt+Space' });
  data.snippetGroups = [{ name: 'Old', snippets: [] }];
  const loaded = await context.loadSyncedState({ nextCursor: 'Ctrl+Space', undoExpansion: 'Alt+Z' }, []);
  assert.equal(loaded.config.nextCursor, 'Alt+Space');
  assert.equal(loaded.config.undoExpansion, 'Alt+Z');
  assert.equal(loaded.snippetGroups[0].name, 'Old');
});

test('a list larger than one sync item saves in chunks and restores on another device', async () => {
  const { context, data } = syncHarness();
  const groups = [{ name: 'Shared', snippets: Array.from({ length: 16 }, (_, index) => ({
    trigger: `/item${index}`,
    replacement: '한글 text '.repeat(90)
  })) }];
  await context.saveSyncedState({ nextCursor: 'Ctrl+Space' }, groups);
  assert.ok(data.snippetGroupsSync.count > 1);
  assert.equal(data.snippetGroups, undefined);
  const otherDevice = syncHarness(data);
  const loaded = await otherDevice.context.loadSyncedState({}, []);
  assert.equal(JSON.stringify(loaded.snippetGroups), JSON.stringify(groups));
});

test('a failed sync write keeps the previously committed list', async () => {
  const { context, data, storage } = syncHarness();
  const original = [{ name: 'Safe', snippets: [] }];
  await context.saveSyncedState({}, original);
  const oldRevision = data.snippetGroupsSync.revision;
  storage.QUOTA_BYTES = 500;
  await assert.rejects(context.saveSyncedState({}, [{ name: 'Large', snippets: [{ replacement: 'x'.repeat(1000) }] }]));
  assert.equal(data.snippetGroupsSync.revision, oldRevision);
  const loaded = await context.loadSyncedState({}, []);
  assert.equal(JSON.stringify(loaded.snippetGroups), JSON.stringify(original));
});

for (const [name, replacement] of [
  ['HTML', '<div class="snippet">한글</div>'.repeat(400)],
  ['line and paragraph separators', '\u2028\u2029'.repeat(2000)],
  ['emoji and escaped characters', '😀\\\n\t"<'.repeat(600)]
]) {
  test(`${name} snippets respect Chromium item quotas and round-trip`, async () => {
    const { context, data } = syncHarness();
    const groups = [{ name, snippets: [{ trigger: '/test', replacement }] }];
    await context.saveSyncedState({}, groups);
    assert.ok(data.snippetGroupsSync.count > 1);
    const loaded = await syncHarness(data).context.loadSyncedState({}, []);
    assert.equal(JSON.stringify(loaded.snippetGroups), JSON.stringify(groups));
  });
}

test('settings exceeding Chromium item size fail before publishing any chunks', async () => {
  const { context, data } = syncHarness();
  const groups = [{ name: 'Safe', snippets: [] }];
  await context.saveSyncedState({}, groups);
  const before = JSON.stringify(data);
  await assert.rejects(context.saveSyncedState({ custom: '<'.repeat(1500) }, groups),
    /Settings exceed Chrome Sync item capacity/);
  assert.equal(JSON.stringify(data), before);
});

test('subgroup organization round-trips through sync while snippets stay flat', async () => {
  const { context, data } = syncHarness();
  const groups = [{ name: 'Parent', subgroups: [{ id: 'tools', name: 'Tools', collapsed: true }], snippets: [
    { name: 'inside', trigger: '/inside', replacement: 'text', subgroupId: 'tools', disabled: true },
    { name: 'outside', trigger: '/outside', replacement: 'text' }
  ] }];
  await context.saveSyncedState({}, groups);
  const loaded = await syncHarness(data).context.loadSyncedState({}, []);
  assert.equal(JSON.stringify(loaded.snippetGroups), JSON.stringify(groups));
});

test('intentionally deleting the last saved group can still publish an empty list', async () => {
  for (const legacy of [false, true]) {
    const { context, data } = syncHarness();
    if (legacy) data.snippetGroups = [{ name: 'Old', snippets: [] }];
    else await context.saveSyncedState({}, [{ name: 'Old', snippets: [] }]);
    await context.saveSyncedState({}, []);
    const loaded = await context.loadSyncedState({}, [{ name: 'Fallback', snippets: [] }]);
    assert.equal(loaded.snippetGroups.length, 0);
  }
});
