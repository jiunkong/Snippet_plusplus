const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const root = path.join(__dirname, '..');

function dialogHarness() {
  const elements = {};
  let document;
  for (const id of ['dialog', 'title', 'message', 'warning', 'warning-box', 'cancel', 'accept', 'export-format-box', 'export-format-select']) {
    elements[id] = {
      textContent: '', hidden: false, isConnected: true, listeners: new Map(),
      classList: { toggle(name, enabled) { this[name] = enabled; } },
      set innerHTML(value) { assert.fail('file content must render as text'); },
      addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(callback);
      },
      removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); },
      dispatch(type, event = {}) { for (const callback of [...this.listeners.get(type) || []]) callback(event); },
      focus() { document.activeElement = this; }
    };
  }
  const opener = { isConnected: true, focus() { document.activeElement = this; } };
  document = { activeElement: opener, getElementById: id => elements[id.replace('import-confirm-', '')] };
  elements.dialog.open = false;
  elements.dialog.showModal = function () { this.open = true; };
  elements.dialog.close = function () { this.open = false; this.dispatch('close'); };
  elements.dialog.getBoundingClientRect = () => ({ left: 100, right: 600, top: 100, bottom: 500 });
  const context = vm.createContext({ document, t: key => key });
  vm.runInContext(fs.readFileSync(path.join(root, 'options/dialog.js'), 'utf8'), context);
  return { context, document, elements, opener };
}

test('export format dialog defaults to binary, returns JSON choice, and resets for imports', async () => {
  const { context, elements, document, opener } = dialogHarness();
  const pending = context.showExportFormat();
  assert.equal(elements['export-format-box'].hidden, false);
  assert.equal(elements['export-format-select'].value, 'binary');
  assert.equal(elements.accept.textContent, 'export_dialog_accept');
  elements['export-format-select'].value = 'json';
  elements.accept.dispatch('click');
  assert.equal(await pending, 'json');
  assert.equal(document.activeElement, opener);
  const next = context.showImportConfirmation({ title: 'Import', message: 'Continue?' });
  assert.equal(elements['export-format-box'].hidden, true);
  assert.equal(elements.accept.textContent, 'import_dialog_accept');
  elements.cancel.dispatch('click');
  assert.equal(await next, false);
  const cancelled = context.showExportFormat();
  assert.equal(elements['export-format-select'].value, 'binary');
  elements.dialog.dispatch('cancel', { preventDefault() {} });
  assert.equal(await cancelled, false);
});

test('custom import dialog renders text safely, focuses cancel, and resolves only on a decision', async () => {
  const { context, document, elements, opener } = dialogHarness();
  const pending = context.showImportConfirmation({ title: 'Import', message: '<img src=x onerror=alert(1)>', warning: 'Older version\n1.0 / 2.0' });
  assert.equal(elements.dialog.open, true);
  assert.equal(document.activeElement, elements.cancel);
  assert.equal(elements.message.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(elements.warning.textContent, 'Older version\n1.0 / 2.0');
  assert.equal(elements['warning-box'].hidden, false);
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  elements.accept.dispatch('click');
  assert.equal(await pending, true);
  assert.equal(elements.dialog.open, false);
  assert.equal(document.activeElement, opener);
  for (const element of Object.values(elements)) {
    for (const callbacks of element.listeners.values()) assert.equal(callbacks.size, 0);
  }
  const next = context.showImportConfirmation({ title: 'Next', message: 'Import group?' });
  assert.equal(elements.warning.textContent, '');
  assert.equal(elements['warning-box'].hidden, true);
  elements.cancel.dispatch('click');
  assert.equal(await next, false);
});

test('Escape, backdrop clicks and external closure cancel, while clicks inside do not', async () => {
  for (const action of ['escape', 'backdrop', 'external']) {
    const { context, elements } = dialogHarness();
    const pending = context.showImportConfirmation({ title: 'Import', message: 'Continue?' });
    elements.dialog.dispatch('click', { target: elements.dialog, clientX: 150, clientY: 150 });
    assert.equal(elements.dialog.open, true);
    if (action === 'escape') {
      let prevented = false;
      elements.dialog.dispatch('cancel', { preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    } else if (action === 'backdrop') {
      elements.dialog.dispatch('click', { target: elements.dialog, clientX: 20, clientY: 20 });
    } else elements.dialog.close();
    assert.equal(await pending, false, action);
    assert.equal(elements.dialog.open, false);
  }
});

test('a second import cannot replace an active confirmation', async () => {
  const { context, elements } = dialogHarness();
  const first = context.showImportConfirmation({ title: 'First', message: 'First file' });
  assert.equal(await context.showImportConfirmation({ title: 'Second', message: 'Second file' }), false);
  assert.equal(elements.message.textContent, 'First file');
  elements.accept.dispatch('click');
  assert.equal(await first, true);
});

test('options load the modal before import handlers and provide localized accessible controls', () => {
  const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  assert.match(fs.rawReadFileSync(path.join(root, 'options/storage.js'), 'utf8'), /from ['"]\.\/dialog\.js['"]/);
  assert.match(html, /<dialog[^>]*aria-labelledby="import-confirm-title"[^>]*aria-describedby="import-confirm-message import-confirm-warning"/);
  for (const locale of ['ko', 'en']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), 'utf8'));
    for (const [, key] of html.matchAll(/data-i18n="(import_dialog_[^"]+)"/g)) assert.ok(catalog[key]?.message);
  }
});

test('group deletion uses a destructive action and the next import restores its own label and style', async () => {
  const { context, elements } = dialogHarness();
  const deletion = context.showOptionsConfirmation({ title: 'Delete group', message: 'Delete Tools?', acceptLabel: 'Delete', danger: true });
  assert.equal(elements.accept.textContent, 'Delete');
  assert.equal(elements.accept.classList.danger, true);
  elements.cancel.dispatch('click');
  assert.equal(await deletion, false);
  const importing = context.showImportConfirmation({ title: 'Import', message: 'Import settings?' });
  assert.equal(elements.accept.textContent, 'import_dialog_accept');
  assert.equal(elements.accept.classList.danger, false);
  elements.cancel.dispatch('click');
  await importing;
});
