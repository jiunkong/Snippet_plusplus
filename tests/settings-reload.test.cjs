const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function harness() {
  const state = { data: null, reads: 0, toasts: [], fail: false };
  const context = vm.createContext({
    chrome: { i18n: { getMessage: key => key }, storage: { onChanged: { addListener() {} } } },
    document: { addEventListener() {} }, window: { location: { href: 'https://example.com' } },
    async loadSyncedState() {
      state.reads++;
      if (state.fail) throw new Error('Storage failed');
      return state.data;
    },
    async loadSnippetLocale() {}, snippetMessage: key => key,
    showSnippetToast: (...args) => state.toasts.push(args),
    getTargetInfo: () => ({}), console: { error() {} }
  });
  for (const file of ['utils/config.js', 'utils/triggers.js', 'content/state.js', 'content/settings.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  state.data = { config: vm.runInContext('({ ...DEFAULT_CONFIG })', context), snippetGroups: [
    { name: 'Example', snippets: [{ name: 'hello', trigger: '/hello', replacement: 'Old' }] }
  ] };
  return { context, state };
}
const press = (context, changes = {}) => {
  const flags = { prevented: false, stopped: false };
  context.handleKeyDown({ key: 'r', code: 'KeyR', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false,
    preventDefault() { flags.prevented = true; }, stopPropagation() { flags.stopped = true; }, ...changes });
  return flags;
};

test('the configurable reload shortcut replaces stale snippets on the current page without editing page content', async () => {
  const { context, state } = harness();
  await context.loadSettings();
  vm.runInContext(fs.readFileSync(path.join(root, 'content/handlers.js'), 'utf8'), context);
  await context.loadSettings();
  assert.equal(vm.runInContext('snippets[0].replacement', context), 'Old');
  state.data = { config: { ...state.data.config, reloadSnippets: 'Ctrl+Shift+R' }, snippetGroups: [
    { snippets: [{ name: 'hello', trigger: '/hello', replacement: 'New' }, { name: 'helper', trigger: '', replacement: 'Shared' }] },
    { siteMode: 'blacklist', disabledSites: ['example.com'], snippets: [{ trigger: '/hidden' }] }
  ] };
  const field = { value: 'Unsaved input', selectionStart: 5, selectionEnd: 5 };
  assert.deepEqual(press(context, { key: 'ㄱ', target: field }), { prevented: true, stopped: true });
  await context.reloadSnippetSettings();
  assert.equal(vm.runInContext('snippets[0].replacement', context), 'New');
  assert.equal(vm.runInContext('snippets.length', context), 1);
  assert.equal(vm.runInContext('snippets[0].groupSnippets.length', context), 2);
  assert.equal(field.value, 'Unsaved input');
  assert.equal(field.selectionStart, 5);
  assert.equal(state.toasts.at(-1)[0], 'status_snippets_reloaded');
  assert.equal(press(context).prevented, false, 'old shortcut stops matching');
  assert.equal(press(context, { altKey: false, ctrlKey: true, shiftKey: true }).prevented, true);
  await context.reloadSnippetSettings();
});

test('reload requests coalesce and failures retain the existing snippet library', async () => {
  const { context, state } = harness();
  await context.loadSettings();
  const reads = state.reads;
  const first = context.reloadSnippetSettings();
  assert.equal(context.reloadSnippetSettings(), first);
  await first;
  assert.equal(state.reads, reads + 1);
  state.fail = true;
  await context.reloadSnippetSettings();
  assert.equal(vm.runInContext('snippets[0].replacement', context), 'Old');
  assert.equal(state.toasts.at(-1)[0], 'status_snippets_reload_failed');
  assert.equal(state.toasts.at(-1)[2], true);
});

test('key repeats and IME composition do not start reload requests', async () => {
  const { context, state } = harness();
  vm.runInContext(fs.readFileSync(path.join(root, 'content/handlers.js'), 'utf8'), context);
  await context.loadSettings();
  const reads = state.reads;
  assert.equal(press(context, { repeat: true }).prevented, true);
  assert.equal(press(context, { isComposing: true }).prevented, false);
  assert.equal(state.reads, reads);
});
