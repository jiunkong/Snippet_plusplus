const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const groups = name => [{ name, snippets: [{ trigger: '/work', replacement: 'Saved account data' }] }];
const copy = value => structuredClone(value);
const settle = () => new Promise(resolve => setImmediate(resolve));

function account(data = {}) {
  const listeners = [];
  function notify(changes, area) {
    if (Object.keys(changes).length) queueMicrotask(() => listeners.forEach(listener => listener(copy(changes), area)));
  }
  function remove(keys) {
    const changes = {};
    for (const key of keys) {
      if (key in data) { changes[key] = { oldValue: copy(data[key]) }; delete data[key]; }
    }
    notify(changes, 'sync');
  }
  function device(local = {}, { afterSyncGet } = {}) {
    const writes = [];
    const errors = [];
    const ownListeners = [];
    const area = (records, name) => ({
      get(keys, callback) {
        const result = Object.fromEntries((keys ?? Object.keys(records)).filter(key => key in records).map(key => [key, copy(records[key])]));
        if (name === 'sync') afterSyncGet?.(keys, result);
        queueMicrotask(() => callback(result));
      },
      set(items, callback) {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { ...(key in records ? { oldValue: copy(records[key]) } : {}), newValue: copy(value) };
          records[key] = copy(value);
        }
        if (name === 'sync') writes.push(copy(items));
        notify(changes, name);
        queueMicrotask(callback);
      },
      remove(keys, callback) { remove(keys); queueMicrotask(callback); }
    });
    const context = vm.createContext({
      TextEncoder, structuredClone, DEFAULT_CONFIG: {},
      console: { error: (...args) => errors.push(args) },
      chrome: { runtime: {}, storage: {
        sync: area(data, 'sync'), local: area(local, 'local'),
        onChanged: { addListener(listener) { listeners.push(listener); ownListeners.push(listener); } }
      } }
    });
    for (const file of ['utils/sync-backup.js', 'utils/sync.js', 'utils/sync-recovery.js']) {
      vm.runInContext(read(file), context);
    }
    return { context, local, writes, errors,
      stop() { ownListeners.forEach(listener => listeners.splice(listeners.indexOf(listener), 1)); }
    };
  }
  return { data, device, remove };
}

test('A uninstall deletes Sync keys; B restores its local copy with its settings page closed; reinstalled A reads it', async () => {
  const shared = account();
  const a = shared.device();
  await a.context.saveSyncedState({ uiLocale: 'en', nextCursor: 'Alt+N' }, groups('A and B'));
  const b = shared.device();
  await b.context.startSyncRecovery();
  assert.equal(b.writes.length, 0);
  assert.equal(b.local.snippetGroupsLocalBackup.snippetGroups[0].name, 'A and B');

  shared.remove(Object.keys(shared.data)); // Chrome's uninstall cleanup on A.
  await settle();
  assert.ok(shared.data.snippetGroupsSync, 'B republishes a committed revision');
  const reinstalledA = shared.device();
  const restored = await reinstalledA.context.loadSyncedState({}, []);
  assert.equal(JSON.stringify(restored.snippetGroups), JSON.stringify(groups('A and B')));
  assert.equal(restored.config.nextCursor, 'Alt+N');
});

test('separate config, manifest and chunk deletions retain the complete backup until uninstall cleanup finishes', async () => {
  const shared = account();
  const a = shared.device();
  await a.context.saveSyncedState({ uiLocale: 'en' }, groups('Protected'));
  const b = shared.device();
  await b.context.startSyncRecovery();
  const before = JSON.stringify(b.local);
  const chunks = Object.keys(shared.data).filter(key => key.startsWith('snippetGroupsSync_'));
  shared.remove(['config']);
  await settle();
  assert.equal(JSON.stringify(b.local), before, 'missing config must not replace preferences with defaults');
  shared.remove(['snippetGroupsSync']);
  await settle();
  assert.equal(b.writes.length, 0, 'leftover chunks mean removal/publication is still in progress');
  const duringRemoval = await b.context.loadSyncedState({}, []);
  assert.equal(duringRemoval.snippetGroups[0].name, 'Protected');
  assert.equal(duringRemoval.config.uiLocale, 'en');
  shared.remove(chunks);
  await settle();
  assert.ok(shared.data.snippetGroupsSync);
  assert.equal((await b.context.loadSyncedState({}, [])).config.uiLocale, 'en');
});

test('an intentional empty-list commit replaces the backup and is never resurrected', async () => {
  const shared = account({ snippetGroups: groups('Delete intentionally') });
  const b = shared.device();
  await b.context.startSyncRecovery();
  const a = shared.device();
  await a.context.saveSyncedState({}, []);
  await settle();
  assert.equal(b.local.snippetGroupsLocalBackup.snippetGroups.length, 0);
  assert.equal((await b.context.loadSyncedState({}, [])).snippetGroups.length, 0);
  shared.remove(Object.keys(shared.data));
  await settle();
  assert.equal((await b.context.loadSyncedState({}, [])).snippetGroups.length, 0);
});

test('a suspended B can recover on worker startup after deletions arrived while it was offline', async () => {
  const shared = account({ config: JSON.stringify({ uiLocale: 'ko' }), snippetGroups: groups('Offline B') });
  const b = shared.device();
  await b.context.startSyncRecovery();
  b.stop();
  shared.remove(Object.keys(shared.data));
  await settle();
  const restartedB = shared.device(b.local);
  await restartedB.context.startSyncRecovery();
  assert.equal((await shared.device().context.loadSyncedState({}, [])).snippetGroups[0].name, 'Offline B');
});

test('fresh installations and invalid backups never seed empty Sync state', async () => {
  for (const local of [{}, { snippetGroupsLocalBackup: { format: 1, snippetGroups: 'broken', config: {} } }]) {
    const shared = account();
    const b = shared.device(local);
    await b.context.startSyncRecovery();
    assert.equal(b.writes.length, 0);
    assert.deepEqual(shared.data, {});
  }
});

test('an incoming partial chunk revision cannot overwrite the last complete local backup', async () => {
  const shared = account({ snippetGroups: groups('Last complete') });
  const b = shared.device();
  await b.context.startSyncRecovery();
  const a = shared.device();
  const before = JSON.stringify(b.local);
  await a.context.syncSet({ snippetGroupsSync: { revision: 'incoming', count: 2 }, snippetGroupsSync_incoming_0: '[{"name":' });
  await settle();
  assert.equal(JSON.stringify(b.local), before);
  assert.equal(b.writes.length, 0);
  await a.context.syncSet({ snippetGroupsSync_incoming_1: '"New complete","snippets":[]}]' });
  await settle();
  assert.equal(b.local.snippetGroupsLocalBackup.snippetGroups[0].name, 'New complete');
  assert.equal(b.errors.length, 0, 'partial delivery is expected, not a storage failure');
});

test('a revision changing during a backup read is reread without requiring another storage event', async () => {
  const shared = account();
  await shared.device().context.saveSyncedState({ uiLocale: 'en' }, groups('Current'));
  let changed = false;
  const b = shared.device({}, { afterSyncGet(keys) {
    if (!changed && keys?.some(key => key.startsWith('snippetGroupsSync_'))) {
      changed = true;
      // The new records can be visible before their onChanged notification.
      shared.data.config = JSON.stringify({ uiLocale: 'ko' });
    }
  } });
  await b.context.startSyncRecovery();
  assert.equal(b.local.snippetGroupsLocalBackup.config.uiLocale, 'ko');
  assert.equal(b.local.snippetGroupsLocalBackup.snippetGroups[0].name, 'Current');
  assert.equal(b.writes.length, 0);
  assert.equal(b.errors.length, 0);
});

test('simultaneous device recovery converges on the committed revision without reporting conflicts as failures', async () => {
  const shared = account();
  const backup = name => ({ snippetGroupsLocalBackup: { format: 1, config: { uiLocale: 'en' }, snippetGroups: groups(name) } });
  const a = shared.device(backup('A backup'));
  const b = shared.device(backup('B backup'));
  await Promise.all([a.context.startSyncRecovery(), b.context.startSyncRecovery()]);
  await settle();
  const latest = await shared.device().context.loadSyncedState({}, []);
  assert.equal(JSON.stringify(a.local.snippetGroupsLocalBackup.snippetGroups), JSON.stringify(latest.snippetGroups));
  assert.equal(JSON.stringify(b.local.snippetGroupsLocalBackup.snippetGroups), JSON.stringify(latest.snippetGroups));
  assert.equal(a.errors.length + b.errors.length, 0);
});

test('an incoming save wins over a recovery already preparing its chunks', async () => {
  const shared = account();
  let headReads = 0;
  const b = shared.device({ snippetGroupsLocalBackup: {
    format: 1, config: { uiLocale: 'en' }, snippetGroups: groups('Old backup')
  } }, { afterSyncGet(keys) {
    if (keys?.includes('snippetGroupsSync') && ++headReads === 2) {
      // Arrives after the recovery's optimistic read but before publication.
      shared.data.config = JSON.stringify({ uiLocale: 'ko' });
      shared.data.snippetGroups = groups('Incoming save');
    }
  } });
  await b.context.startSyncRecovery();
  await settle();
  assert.equal(b.local.snippetGroupsLocalBackup.snippetGroups[0].name, 'Incoming save');
  assert.equal(b.local.snippetGroupsLocalBackup.config.uiLocale, 'ko');
  assert.equal(b.writes.some(write => 'snippetGroupsSync' in write), false, 'stale backup is never published');
  assert.equal(Object.keys(shared.data).some(key => key.startsWith('snippetGroupsSync_')), false, 'abandoned chunks are cleaned up');
  assert.equal(b.errors.length, 0);
});

test('repeated read conflicts are bounded and real storage errors are still reported', async () => {
  const b = account().device();
  let reads = 0;
  b.context.loadSyncedState = async () => { reads++; throw b.context.syncConflict(); };
  await b.context.startSyncRecovery();
  assert.equal(reads, 3, 'yield after bounded retries instead of spinning indefinitely');
  assert.equal(b.errors.length, 0);
  b.context.loadSyncedState = async () => { throw new Error('Storage unavailable'); };
  await b.context.startSyncRecovery();
  assert.equal(b.errors.length, 1);
  assert.match(b.errors[0][1].message, /Storage unavailable/);
});

test('editing preferences during recovery publishes the recovered groups with the settings', async () => {
  const shared = account({ snippetGroups: groups('Keep') });
  const b = shared.device();
  await b.context.startSyncRecovery();
  b.stop();
  shared.remove(Object.keys(shared.data));
  await settle();
  const state = await b.context.loadSyncedState({}, []);
  await b.context.saveSyncedState({ uiLocale: 'en' }, state.snippetGroups, { configOnly: true });
  assert.ok(shared.data.snippetGroupsSync);
  assert.equal((await shared.device().context.loadSyncedState({}, [])).snippetGroups[0].name, 'Keep');
});

test('a new sparse config uses current defaults rather than preferences from an older backup', async () => {
  const shared = account({ config: JSON.stringify({ uiLocale: 'en', nextCursor: 'Old hotkey' }), snippetGroups: groups('Saved') });
  const b = shared.device();
  await b.context.startSyncRecovery();
  const a = shared.device();
  await a.context.syncSet({ config: JSON.stringify({ uiLocale: 'ko' }) });
  const loaded = await b.context.loadSyncedState({ nextCursor: 'Default hotkey' }, []);
  assert.equal(loaded.config.uiLocale, 'ko');
  assert.equal(loaded.config.nextCursor, 'Default hotkey');
  await settle();
});
