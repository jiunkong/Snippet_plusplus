const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');

const root = path.join(__dirname, '..');
const messages = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));

// A small DOM harness for moving real editor nodes and serializing their values.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.selectionStart = this.selectionEnd = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), name])].join(' '); },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(' '); },
      toggle: (name, force) => {
        const add = force === undefined ? !this.classList.contains(name) : force;
        this.classList[add ? 'add' : 'remove'](name);
      }
    };
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key === 'class') this.className = value;
    if (key === 'value') this.value = value;
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  set innerHTML(html) {
    this._html = html;
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    const stack = [this];
    for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
      const [, close, tag, attributes] = match;
      if (close) { stack.pop(); continue; }
      const element = new Element(tag);
      for (const [, key, value = ''] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        element.setAttribute(key, value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      }
      stack.at(-1).appendChild(element);
      if (!['input', 'br'].includes(tag)) stack.push(element);
    }
  }
  get innerHTML() { return this._html || ''; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    if (child === before) return child;
    if (before && before.parentNode !== this) throw Error('insertBefore reference is not a direct child');
    child.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    const excluded = selector.match(/:not\(\.([\w-]+)\)/)?.[1];
    selector = selector.replace(/:not\([^)]*\)/g, '');
    if (excluded && this.classList.contains(excluded)) return false;
    if (selector.startsWith('#')) return this.attributes.id === selector.slice(1);
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
    return this.tagName.toLowerCase() === selector;
  }
  closest(selector) {
    for (let element = this; element; element = element.parentNode) if (element.matches(selector)) return element;
    return null;
  }
  querySelectorAll(selector) {
    if (selector.startsWith(':scope > ')) return this.children.filter(child => child.matches(selector.slice(9)));
    const parts = selector.split(/\s+/);
    const result = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(parts.at(-1)) && (parts.length === 1 || child.parentNode?.closest(parts[0]))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  focus() { this.focused = true; }
  select() { this.setSelectionRange(0, this.value.length); }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  scrollIntoView() { this.scrolled = true; }
  getBoundingClientRect() { return { top: 10, height: 20, bottom: 600 }; }
}

function subgroupHarness(group) {
  const document = new Element('document');
  const byId = new Map();
  document.getElementById = id => {
    if (!byId.has(id)) {
      const element = new Element();
      element.setAttribute('id', id);
      byId.set(id, element);
      document.appendChild(element);
    }
    return byId.get(id);
  };
  document.createElement = tag => new Element(tag);
  document.body = new Element('body');
  const mode = new Element('button');
  mode.className = 'mode-btn active';
  mode.dataset.mode = 'blacklist';
  document.getElementById('site-mode-selector').appendChild(mode);
  document.getElementById('active-group-name').value = group.name;
  const context = vm.createContext({
    document, window: { addEventListener() {} },
    snippetGroups: [group], activeGroupIndex: 0, currentConfig: { visualizeNewlines: false },
    t: key => messages[key]?.message || key,
    saves: 0, debouncedSave() { context.saves++; },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    crypto: { randomUUID: () => 'new-subgroup' }
  });
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'options/groups.js', 'options/highlight.js', 'options/subgroups.js', 'options/snippets.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.updateAllHighlights = () => document.querySelectorAll('.snippet-row').forEach(row => row.updateValidation());
  context.renderSnippetsList(group.snippets, context.subgroupDefinitions(group));
  const rows = () => document.querySelectorAll('.snippet-row');
  const findRow = name => rows().find(row => row.querySelector('.snippet-name-input').value === name);
  return { context, document, group, rows, findRow, list: document.getElementById('snippets-list') };
}

test('snippet enable switch persists through rendering and subgroup moves while disabled helpers remain navigable', () => {
  const group = exampleGroup();
  group.snippets[1].disabled = true;
  const { context, findRow } = subgroupHarness(group);
  let helper = findRow('helper');
  assert.equal(helper.classList.contains('is-disabled'), true);
  assert.equal(helper.querySelector('.snippet-enabled-toggle').checked, false);
  assert.equal(findRow('caller').querySelector('.error-msg-container').style.display, 'none');
  const body = findRow('caller').querySelector('.replacement-input');
  body.setSelectionRange(3, 9);
  assert.equal(context.navigateToSnippetFunction(body, { preventDefault() {} }), true);
  assert.equal(group.snippets.find(s => s.name === 'helper').disabled, true);
  context.renderSnippetsList(group.snippets, context.subgroupDefinitions(group));
  helper = findRow('helper');
  const toggle = helper.querySelector('.snippet-enabled-toggle');
  toggle.checked = true;
  toggle.onchange();
  assert.equal(helper.classList.contains('is-disabled'), false);
  assert.notEqual(group.snippets.find(s => s.name === 'helper').disabled, true);
  toggle.checked = false;
  toggle.onchange();
  helper.querySelector('.snippet-subgroup-select').value = '';
  helper.querySelector('.snippet-subgroup-select').onchange();
  assert.equal(group.snippets.find(s => s.name === 'helper').disabled, true);
  assert.equal(findRow('caller').querySelector('.snippet-enabled-toggle').checked, true);
});

test('disabled triggers do not produce conflicts within or across groups', () => {
  const group = { name: 'Main', snippets: [
    { name: 'active', trigger: '/same', replacement: 'active' },
    { name: 'disabled', trigger: '/same', replacement: 'helper', disabled: true }
  ] };
  const { context, findRow } = subgroupHarness(group);
  context.snippetGroups.push({ name: 'Other', snippets: [{ trigger: '/same', disabled: true }] });
  context.checkTriggerConflicts();
  assert.equal(findRow('active').querySelector('.snippet-name-input').classList.contains('conflict'), false);
  assert.equal(findRow('disabled').querySelector('.snippet-name-input').classList.contains('conflict'), false);
  const toggle = findRow('disabled').querySelector('.snippet-enabled-toggle');
  toggle.checked = true;
  toggle.onchange();
  assert.equal(findRow('active').querySelector('.snippet-name-input').classList.contains('conflict'), true);
});

function exampleGroup() {
  return { name: 'Example', snippets: [
    { name: 'caller', trigger: '/caller', replacement: '{{@helper()}}' },
    { name: 'helper', trigger: '/helper', replacement: 'body', subgroupId: 'tools', collapsed: true },
    { name: 'legacy', trigger: '/legacy', replacement: 'old', subgroupId: 'missing' }
  ], subgroups: [{ id: 'tools', name: 'Tools', collapsed: true }] };
}

test('subgroups render without losing legacy/orphaned snippets, and moves preserve unsaved edits', () => {
  const { context, document, group, findRow, list } = subgroupHarness(exampleGroup());
  const helper = findRow('helper');
  const caller = findRow('caller');
  assert.equal(context.snippetSubgroupId(helper), 'tools');
  assert.equal(findRow('legacy').parentNode, list);
  const body = caller.querySelector('.replacement-input');
  body.value = 'unsaved edit';
  const select = caller.querySelector('.snippet-subgroup-select');
  select.value = 'tools';
  select.onchange();
  assert.equal(findRow('caller'), caller);
  assert.equal(caller.querySelector('.replacement-input'), body);
  assert.equal(group.snippets.find(snippet => snippet.name === 'caller').replacement, 'unsaved edit');
  assert.equal(group.snippets.find(snippet => snippet.name === 'caller').subgroupId, 'tools');
  assert.equal(context.findSubgroupSection('tools').classList.contains('collapsed'), false);
  context.setSubgroupCollapsed(context.findSubgroupSection('tools'), true);
  assert.equal(group.subgroups[0].collapsed, true);
  context.renderSnippetsList(group.snippets, context.subgroupDefinitions(group));
  assert.equal(context.findSubgroupSection('tools').classList.contains('collapsed'), true);
  assert.equal(document.querySelectorAll('.snippet-row').length, 3);
  assert.equal(findRow('caller').querySelector('.replacement-input').value, 'unsaved edit');
});

test('search reveals matches in collapsed subgroups without changing their saved fold state', () => {
  const { context, document, group } = subgroupHarness(exampleGroup());
  const section = context.findSubgroupSection('tools');
  const search = document.getElementById('snippet-search');
  search.value = 'helper';
  context.applySnippetSearch();
  assert.equal(section.hidden, false);
  assert.equal(section.classList.contains('search-open'), true);
  assert.equal(section.querySelector('.subgroup-fold-btn').attributes['aria-expanded'], 'true');
  context.syncActiveGroupData();
  assert.equal(group.subgroups[0].collapsed, true);
  search.value = 'absent';
  context.applySnippetSearch();
  assert.equal(section.hidden, true);
  assert.equal(document.getElementById('snippet-search-empty').hidden, false);
  search.value = '';
  context.applySnippetSearch();
  assert.equal(section.hidden, false);
  assert.equal(section.classList.contains('search-open'), false);
  assert.equal(section.querySelector('.subgroup-fold-btn').attributes['aria-expanded'], 'false');
});

test('definition navigation works across subgroups and expands the destination', () => {
  const { context, document, group, findRow } = subgroupHarness(exampleGroup());
  const caller = findRow('caller');
  assert.equal(caller.querySelector('.error-msg-container').style.display, 'none');
  const body = caller.querySelector('.replacement-input');
  body.setSelectionRange(3, 9); // helper in {{@helper()}}
  document.getElementById('snippet-search').value = 'caller';
  context.applySnippetSearch();
  assert.equal(context.navigateToSnippetFunction(body, { preventDefault() {} }), true);
  assert.equal(group.subgroups[0].collapsed, false);
  assert.equal(findRow('helper').classList.contains('collapsed'), false);
  assert.equal(findRow('helper').querySelector('.replacement-input').focused, true);
});

test('creating, renaming and removing a subgroup retains all of its snippets', () => {
  const { context, group, findRow, rows, list } = subgroupHarness(exampleGroup());
  context.addSubgroup();
  const section = context.findSubgroupSection('new-subgroup');
  const name = section.querySelector('.subgroup-name-input');
  assert.equal(name.focused, true);
  name.value = '<new & tools>';
  name.oninput();
  context.moveSnippetToSubgroup(findRow('caller'), 'new-subgroup');
  assert.equal(group.subgroups.find(item => item.id === 'new-subgroup').name, '<new & tools>');
  assert.match(findRow('caller').querySelector('.snippet-subgroup-select').innerHTML, /&lt;new &amp; tools&gt;/);
  const row = findRow('caller');
  section.querySelector('.subgroup-remove-btn').onclick();
  assert.equal(context.findSubgroupSection('new-subgroup'), undefined);
  assert.equal(findRow('caller'), row);
  assert.equal(row.parentNode, list);
  assert.equal(rows().length, 3);
  assert.equal(group.snippets.find(snippet => snippet.name === 'caller').subgroupId, undefined);
  assert.equal(group.subgroups.length, 1);
});

test('adding a snippet within a subgroup expands it and focuses the new editor row', () => {
  const { context, group, rows } = subgroupHarness(exampleGroup());
  context.findSubgroupSection('tools').querySelector('.subgroup-add-btn').onclick();
  assert.equal(rows().length, 4);
  const row = context.findSubgroupSection('tools').querySelectorAll('.snippet-row').at(-1);
  assert.equal(row.querySelector('.snippet-name-input').focused, true);
  row.querySelector('.snippet-name-input').value = 'new';
  row.querySelector('.snippet-name-input').oninput();
  assert.equal(group.snippets.find(snippet => snippet.name === 'new').subgroupId, 'tools');
});

test('dragging a snippet into a collapsed subgroup and back uses the correct DOM parent', () => {
  const { context, document, group, findRow, list } = subgroupHarness(exampleGroup());
  for (const name of ['restoreOptions', 'exportSettings', 'importSettings', 'exportActiveGroup', 'importGroup']) context[name] = () => {};
  vm.runInContext(fs.readFileSync(path.join(root, 'options/main.js'), 'utf8'), context);
  const row = findRow('caller');
  row.classList.add('dragging');
  const header = context.findSubgroupSection('tools').querySelector('.subgroup-header');
  list.listeners.dragover[0]({ target: header, clientY: 100, preventDefault() {} });
  row.listeners.dragend[0]();
  assert.equal(group.snippets.find(snippet => snippet.name === 'caller').subgroupId, 'tools');
  assert.equal(context.findSubgroupSection('tools').classList.contains('collapsed'), false);
  row.classList.add('dragging');
  list.listeners.dragover[0]({ target: list, clientY: 200, preventDefault() {} });
  row.listeners.dragend[0]();
  assert.equal(row.parentNode, list);
  assert.equal(group.snippets.find(snippet => snippet.name === 'caller').subgroupId, undefined);
});

test('subgroup membership and fold state survive switching parent groups', () => {
  const { context, group, findRow } = subgroupHarness(exampleGroup());
  context.snippetGroups.push({ name: 'Second', snippets: [{ name: 'second', trigger: '/second', replacement: '2' }] });
  context.moveSnippetToSubgroup(findRow('caller'), 'tools');
  context.setSubgroupCollapsed(context.findSubgroupSection('tools'), true);
  context.selectGroup(1);
  assert.equal(context.subgroupSections().length, 0);
  assert.equal(findRow('second').querySelector('.replacement-input').value, '2');
  context.selectGroup(0);
  assert.equal(group.subgroups[0].collapsed, true);
  assert.equal(context.snippetSubgroupId(findRow('caller')), 'tools');
  assert.equal(context.findSubgroupSection('tools').classList.contains('collapsed'), true);
});

test('legacy groups and malformed subgroup metadata remain editable without dropping snippets', () => {
  const { context, rows, list } = subgroupHarness({ name: 'Legacy', snippets: [{ name: 'old', trigger: '/old', replacement: 'old' }] });
  assert.equal(rows()[0].parentNode, list);
  const definitions = context.subgroupDefinitions({ subgroups: [null, {}, { id: 'tools', name: 'First' }, { id: 'tools', name: 'Duplicate' }] });
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].name, 'First');
});

test('importing an existing parent group preserves subgroup organization', async () => {
  const { context, findRow } = subgroupHarness({ name: 'Old', snippets: [] });
  const imported = exampleGroup();
  context.chrome = { storage: { onChanged: { addListener() {} } } };
  context.showImportConfirmation = async () => true;
  context.decodeSnippetExport = async () => ({ type: 'snippetpp_group', group: imported });
  vm.runInContext(fs.readFileSync(path.join(root, 'options/storage.js'), 'utf8'), context);
  context.saveToStorage = async () => true;
  context.showStatus = () => {};
  await context.importGroup({ target: { files: [{ arrayBuffer: async () => new ArrayBuffer(0) }], value: 'import.sppgrp' } });
  assert.equal(context.activeGroupIndex, 1);
  assert.equal(context.snippetSubgroupId(findRow('helper')), 'tools');
  assert.equal(context.findSubgroupSection('tools').classList.contains('collapsed'), true);
});

test('subgroups stay above ungrouped snippets when rendering, creating and moving snippets', () => {
  const { context, list, findRow } = subgroupHarness(exampleGroup());
  assert.equal(list.children[0].classList.contains('snippet-subgroup'), true);
  context.addSubgroup();
  assert.equal(list.children[1].classList.contains('snippet-subgroup'), true);
  context.moveSnippetToSubgroup(findRow('helper'), '');
  assert.equal(list.children.at(-1), findRow('helper'));
  assert.equal(list.children.slice(0, 2).every(child => child.classList.contains('snippet-subgroup')), true);
});

test('dragging subgroups changes only top-level order and persists it without changing their contents', () => {
  const group = exampleGroup();
  group.subgroups.push({ id: 'other', name: 'Other', collapsed: true });
  group.snippets.push({ name: 'otherHelper', trigger: '/other', replacement: 'keep', subgroupId: 'other' });
  const { context, document, list, findRow } = subgroupHarness(group);
  for (const name of ['restoreOptions', 'exportSettings', 'importSettings', 'exportActiveGroup', 'importGroup']) context[name] = () => {};
  vm.runInContext(fs.readFileSync(path.join(root, 'options/main.js'), 'utf8'), context);
  const tools = context.findSubgroupSection('tools');
  const other = context.findSubgroupSection('other');
  tools.querySelector('.subgroup-header').getBoundingClientRect = () => ({ top: 10, height: 40 });
  other.querySelector('.subgroup-header').getBoundingClientRect = () => ({ top: 100, height: 40 });
  const helper = findRow('helper');
  tools.listeners.mousedown[0]({ target: tools.querySelector('.subgroup-header') });
  tools.listeners.dragstart[0]({ target: tools, stopPropagation() {}, preventDefault() { assert.fail('Header drag must work'); } });
  list.listeners.dragover[0]({ target: other.querySelector('.subgroup-header'), clientY: 200, preventDefault() {} });
  tools.listeners.dragend[0]({ target: tools });
  assert.equal(list.children[0], other);
  assert.equal(list.children[1], tools);
  assert.equal(tools.parentNode, list);
  assert.equal(helper, findRow('helper'));
  assert.equal(context.snippetSubgroupId(helper), 'tools');
  assert.equal(other.classList.contains('collapsed'), true);
  assert.equal(tools.classList.contains('collapsed'), true);
  assert.deepEqual(Array.from(group.subgroups, item => item.id), ['other', 'tools']);

  context.renderSnippetsList(group.snippets, context.subgroupDefinitions(group));
  assert.deepEqual(Array.from(context.subgroupSections(), section => section.dataset.subgroupId), ['other', 'tools']);
  const moved = context.findSubgroupSection('tools');
  moved.classList.add('dragging');
  list.listeners.dragover[0]({ target: list, clientY: 0, preventDefault() {} });
  moved.listeners.dragend[0]({ target: moved });
  assert.deepEqual(Array.from(group.subgroups, item => item.id), ['tools', 'other']);
  assert.equal(document.querySelectorAll('.snippet-row').length, 4);
});

test('subgroup controls and nested snippet drags do not start a subgroup drag', () => {
  const { context, document, findRow } = subgroupHarness(exampleGroup());
  const tools = context.findSubgroupSection('tools');
  tools.listeners.mousedown[0]({ target: tools.querySelector('.subgroup-name-input') });
  assert.equal(tools.draggable, false);
  let prevented = false;
  tools.listeners.dragstart[0]({ target: tools, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  tools.listeners.dragstart[0]({ target: findRow('helper'), preventDefault() { assert.fail('Nested snippet drag must not be cancelled'); } });
  assert.equal(tools.classList.contains('dragging'), false);
  tools.draggable = true;
  document.getElementById('snippet-search').value = 'helper';
  prevented = false;
  tools.listeners.dragstart[0]({ target: tools, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('quoted calls navigate to a spaced name inside a collapsed subgroup', () => {
  const group = exampleGroup();
  group.snippets[0].replacement = '{{@"hello world"()}}';
  group.snippets[1].name = 'hello world';
  const { context, findRow } = subgroupHarness(group);
  const caller = findRow('caller');
  assert.equal(caller.querySelector('.error-msg-container').style.display, 'none');
  const textarea = caller.querySelector('.replacement-input');
  const start = textarea.value.indexOf('world');
  textarea.setSelectionRange(start, start + 5);
  assert.equal(context.navigateToSnippetFunction(textarea, { preventDefault() {} }), true);
  assert.equal(context.findSubgroupSection('tools').classList.contains('collapsed'), false);
  assert.equal(findRow('hello world').querySelector('.replacement-input').focused, true);
});

test('folding subgroups updates the current view without scheduling a save', () => {
  const { context, group } = subgroupHarness(exampleGroup());
  const section = context.findSubgroupSection('tools');
  const fold = section.querySelector('.subgroup-fold-btn');
  const saves = context.saves;
  fold.onclick();
  assert.equal(section.classList.contains('collapsed'), false);
  assert.equal(fold.attributes['aria-expanded'], 'true');
  assert.equal(group.subgroups[0].collapsed, false);
  assert.equal(context.saves, saves);
  fold.onclick();
  assert.equal(section.classList.contains('collapsed'), true);
  assert.equal(fold.attributes['aria-expanded'], 'false');
  assert.equal(group.subgroups[0].collapsed, true);
  assert.equal(context.saves, saves);
  section.querySelector('.subgroup-name-input').value = 'Renamed';
  section.querySelector('.subgroup-name-input').oninput();
  assert.equal(context.saves, saves + 1, 'content edits still save normally');
});

test('group titles count all snippets and refresh on add, delete and rename regardless of search or subgroup folding', () => {
  const { context, document, findRow } = subgroupHarness(exampleGroup());
  context.snippetGroups.push({ name: 'Empty', snippets: [] });
  context.renderGroupsList();
  const labels = () => document.getElementById('groups-list').children.map(item => item.textContent);
  assert.deepEqual(labels(), ['Example (3)', 'Empty (0)']);
  document.getElementById('snippet-search').value = 'helper';
  context.applySnippetSearch();
  assert.deepEqual(labels(), ['Example (3)', 'Empty (0)']);
  context.setSubgroupCollapsed(context.findSubgroupSection('tools'), false);
  assert.equal(labels()[0], 'Example (3)');
  context.addSnippetRow('tools');
  const added = document.querySelectorAll('.snippet-row').find(row => !row.querySelector('.snippet-name-input').value);
  added.querySelector('.snippet-name-input').value = 'new snippet';
  added.querySelector('.snippet-name-input').oninput();
  assert.equal(labels()[0], 'Example (4)');
  findRow('legacy').querySelector('.delete-row-btn').onclick();
  assert.equal(labels()[0], 'Example (3)');
  document.getElementById('active-group-name').value = 'Renamed';
  context.syncActiveGroupData();
  assert.equal(labels()[0], 'Renamed (3)');
});

test('group deletion waits for its own modal and cancel preserves the selected group', async () => {
  for (const accept of [false, true]) {
    const { context, group } = subgroupHarness(exampleGroup());
    context.snippetGroups.push({ name: 'Keep', snippets: [] });
    let decide;
    let options;
    context.confirm = () => assert.fail('group deletion must use the custom modal');
    context.showOptionsConfirmation = value => {
      options = value;
      return new Promise(resolve => { decide = resolve; });
    };
    const saves = context.saves;
    const pending = context.deleteActiveGroup();
    assert.equal(context.snippetGroups.length, 2);
    assert.equal(options.danger, true);
    assert.equal(options.acceptLabel, messages.groups_delete_action.message);
    decide(accept);
    await pending;
    assert.equal(context.snippetGroups.length, accept ? 1 : 2);
    assert.equal(context.snippetGroups.includes(group), !accept);
    assert.equal(context.saves, saves + (accept ? 1 : 0));
    assert.equal(context.activeGroupIndex, 0);
  }
});
