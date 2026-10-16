const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'options/storage.js'), 'utf8');
const group = () => ({ name: 'Tools', snippets: [{ name: 'hello', replacement: 'Hello', subgroupId: 'one', disabled: true }],
  subgroups: [{ id: 'one', name: 'Shared', collapsed: true }] });
function harness({ locale = 'ko', version = '2.10.0', accept = true } = {}) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), 'utf8'));
  const calls = { prompts: [], saves: [], downloads: [], blobs: [], statuses: [], modals: [], syncs: 0, reloads: 0, selected: [] };
  const context = vm.createContext({
    Blob, Date,
    currentConfig: { addSubgroup: 'Alt+G' }, snippetGroups: [group()], activeGroupIndex: 0, saveTimeout: null,
    chrome: {
      runtime: { getManifest: () => ({ version }) },
      storage: { onChanged: { addListener() {} } },
      downloads: { download(options, callback) { calls.downloads.push(options); callback(); } }
    },
    URL: { createObjectURL(blob) { calls.blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    FileReader: class { readAsText(file) { calls.read = this.onload({ target: { result: file.text } }); } },
    t(key, values = {}) {
      return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), catalog[key]?.message || key);
    },
    confirm() { assert.fail('import must not use browser confirmation'); },
    async showImportConfirmation(options) {
      calls.modals.push(options);
      calls.prompts.push([options.warning, options.message].filter(Boolean).join('\n\n'));
      return accept;
    },
    syncActiveGroupData() { calls.syncs++; },
    saveSyncedState(config, groups) { calls.saves.push(JSON.parse(JSON.stringify({ config, groups }))); return Promise.resolve(); },
    subgroupDefinitions: value => value.subgroups || [],
    renderGroupsList() {}, selectGroup(index) { calls.selected.push(index); },
    window: { location: { reload() { calls.reloads++; } } },
    clearTimeout() {}, console: { error() {} }
  });
  vm.runInContext(source, context);
  context.showStatus = (...args) => calls.statuses.push(args);
  const importFile = async (type, data) => {
    const target = { files: [{ text: JSON.stringify(data) }], value: 'selected-file' };
    context[type === 'settings' ? 'importSettings' : 'importGroup']({ target });
    await calls.read;
    await Promise.resolve();
    return target;
  };
  return { context, calls, importFile };
}

test('exports use the running extension version for settings and groups and include current edits', async () => {
  const { context, calls } = harness({ version: '3.4.5.6' });
  context.syncActiveGroupData = () => { calls.syncs++; context.snippetGroups[0].snippets[0].replacement = 'Unsaved body'; };
  context.exportSettings();
  context.exportActiveGroup();
  const all = JSON.parse(await calls.blobs[0].text());
  const single = JSON.parse(await calls.blobs[1].text());
  assert.equal(all.version, '3.4.5.6');
  assert.equal(single.version, '3.4.5.6');
  assert.equal(single.type, 'snippetpp_group');
  assert.equal(all.snippetGroups[0].snippets[0].replacement, 'Unsaved body');
  assert.equal(all.snippetGroups[0].snippets[0].disabled, true);
  assert.deepEqual(single.group, all.snippetGroups[0]);
  assert.deepEqual(single.group.subgroups, group().subgroups);
  assert.ok(Number.isFinite(Date.parse(all.exportedAt)));
  assert.equal(calls.syncs, 2);
  assert.match(calls.downloads[0].filename, /\.sppcfg$/);
  assert.match(calls.downloads[1].filename, /\.sppgrp$/);
});

test('extension versions compare numeric components and treat omitted trailing zeros as equal', () => {
  const { context } = harness();
  for (const [a, b, result] of [
    ['1.9', '1.10', -1], ['2.0', '1.99.99', 1], ['1.0', '1.0.0.0', 0],
    ['1.0.0.1', '1.0', 1], ['65535.0', '2.0', 1], ['1', '1.0', 0]
  ]) assert.equal(context.compareExtensionVersions(a, b), result, `${a} vs ${b}`);
  for (const value of [undefined, null, '', 'next', '1.2beta', '65536', 1, {}]) {
    assert.equal(context.compareExtensionVersions(value, '2.0'), null);
  }
});

test('older and newer import warnings are localized, show both versions, and cancel without changes', async () => {
  for (const locale of ['ko', 'en']) for (const type of ['settings', 'group']) {
    for (const [version, word] of [['2.9', locale === 'ko' ? '이전' : 'older'], ['2.11', locale === 'ko' ? '이후' : 'newer']]) {
      const { context, calls, importFile } = harness({ locale, accept: false });
      const before = JSON.stringify({ config: context.currentConfig, groups: context.snippetGroups });
      const data = type === 'settings' ? { version, config: { changed: true }, snippetGroups: [] }
        : { version, type: 'snippetpp_group', group: group() };
      const target = await importFile(type, data);
      assert.equal(calls.prompts.length, 1, 'warning is included in the existing confirmation');
      assert.ok(calls.prompts[0].includes(word));
      assert.ok(calls.prompts[0].includes(version));
      assert.ok(calls.prompts[0].includes('2.10.0'));
      assert.equal(JSON.stringify({ config: context.currentConfig, groups: context.snippetGroups }), before);
      assert.equal(calls.saves.length, 0);
      assert.equal(calls.reloads, 0);
      assert.equal(target.value, '', 'the same file can be selected again after cancellation');
    }
  }
});

test('matching versions and legacy exports retain normal import confirmation', async () => {
  for (const type of ['settings', 'group']) for (const version of [undefined, '2.10', '2.10.0.0']) {
    const { context, calls, importFile } = harness();
    const data = type === 'settings' ? { version, config: { imported: true }, snippetGroups: [group()] }
      : version === undefined ? group() : { version, type: 'snippetpp_group', group: group() };
    await importFile(type, data);
    assert.equal(calls.prompts.length, 1);
    assert.doesNotMatch(calls.prompts[0], /이전|이후|파일 버전/);
    assert.equal(calls.saves.length, 1);
    if (type === 'settings') {
      assert.equal(context.currentConfig.imported, true);
      assert.equal(calls.reloads, 1);
    } else {
      assert.equal(context.snippetGroups.length, 2);
      assert.equal(calls.selected[0], 1);
    }
  }
});

test('accepting a version warning imports the file normally', async () => {
  for (const type of ['settings', 'group']) {
    const { context, calls, importFile } = harness();
    const data = type === 'settings' ? { version: '3.0', snippetGroups: [group()] }
      : { version: '1.0', type: 'snippetpp_group', group: group() };
    await importFile(type, data);
    assert.equal(calls.saves.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.snippetGroups.at(-1).subgroups)), group().subgroups);
  }
});

test('imports wait for the asynchronous modal decision before changing or saving data', async () => {
  for (const type of ['settings', 'group']) for (const accept of [true, false]) {
    const { context, calls, importFile } = harness();
    let decide;
    context.showImportConfirmation = () => new Promise(resolve => { decide = resolve; });
    const data = type === 'settings' ? { version: '3.0', snippetGroups: [] }
      : { version: '3.0', type: 'snippetpp_group', group: group() };
    const before = JSON.stringify(context.snippetGroups);
    const pending = importFile(type, data);
    assert.equal(JSON.stringify(context.snippetGroups), before);
    assert.equal(calls.saves.length, 0);
    decide(accept);
    await pending;
    assert.equal(calls.saves.length, accept ? 1 : 0);
    if (!accept) assert.equal(JSON.stringify(context.snippetGroups), before);
  }
});
