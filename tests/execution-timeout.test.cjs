const { assertTemplateOutput } = require('./helpers/fragment.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function harness() {
  const clock = { time: 0 };
  const context = vm.createContext({ performance: { now: () => clock.time }, setTimeout, clearTimeout });
  for (const file of ['utils/constants.js', 'utils/config.js', 'utils/triggers.js', 'utils/i18n.js', 'content/fragment.js', 'content/evaluator.js', 'content/template-parser.js', 'content/template.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return { context, clock };
}

test('default execution limit is 500ms and invalid stored limits use the safe default', () => {
  const { context } = harness();
  assert.equal(vm.runInContext('DEFAULT_CONFIG.maxExecutionMs', context), 500);
  for (const value of [undefined, null, '', '1000', 0, -1, NaN, Infinity, 99, 60001]) {
    assert.equal(context.normalizeSnippetTimeout(value), 500);
  }
  for (const value of [100, 500, 1000, 60000]) assert.equal(context.normalizeSnippetTimeout(value), value);
});

test('large and nested loops terminate at the deadline and restore enclosing index', async () => {
  for (const template of ['{{for 100000000000000000000}}x{{endfor}}', '{{for 1~1000000}}{{for 1000000}}x{{endfor}}{{endfor}}']) {
    const { context, clock } = harness();
    context.performance.now = () => clock.time++;
    const args = { index: 7 };
    await assert.rejects(context.processTemplate(template, args, { maxExecutionMs: 100 }), error => error.messageKey === 'err_snippet_timeout' && error.messageValues[0] === 0.1);
    assert.equal(args.index, 7);
    assert.ok(clock.time < 300, 'execution stops promptly');
  }
});

test('nested snippet calls and blocks share one deadline instead of resetting it', async () => {
  const { context, clock } = harness();
  let notifications = 0;
  context.showSnippetToast = () => { notifications++; clock.time += 40; };
  const library = { maxExecutionMs: 100, snippets: [{ name: 'work', replacement: '{{toast("working", "red")}}' }] };
  await assert.rejects(context.processTemplate('{{for 10}}{{if true}}{{@work()}}{{endif}}{{endfor}}', {}, library), error => error.messageKey === 'err_snippet_timeout');
  assert.equal(notifications, 3);
  clock.time = 0;
  notifications = 0;
  assertTemplateOutput(await context.processTemplate('{{for 4}}{{@work()}}{{endfor}}', {}, { ...library, maxExecutionMs: 500 }), '');
  assert.equal(notifications, 4, 'a larger configured limit allows the same work');
});

test('prompt and choice waiting time is excluded but execution resumes on the same budget', async () => {
  const { context, clock } = harness();
  context.showSnippetPrompt = async () => { clock.time += 10000; return 'Guest'; };
  context.showSnippetChoice = async (title, options) => { clock.time += 10000; return options[0]; };
  assertTemplateOutput(await context.processTemplate('{{prompt("Name")}} {{choice("Pick", "A", "B")}}', {}, { maxExecutionMs: 100 }), 'Guest A');
  context.showSnippetToast = () => { clock.time += 101; };
  await assert.rejects(context.processTemplate('{{prompt("Name")}}{{toast("Work", "red")}}', {}, { maxExecutionMs: 100 }), error => error.messageKey === 'err_snippet_timeout');
});

test('a pending clipboard operation times out and its late completion cannot execute later effects', async () => {
  const { context, clock } = harness();
  const timers = [];
  context.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  context.clearTimeout = () => {};
  let finishRead;
  let copies = 0;
  context.navigator = { clipboard: {
    readText: () => new Promise(resolve => { finishRead = resolve; }),
    writeText: async () => { copies++; }
  } };
  const pending = context.processTemplate('{{paste()}}{{copy("late")}}', {}, { maxExecutionMs: 100 });
  const rejected = assert.rejects(pending, error => error.messageKey === 'err_snippet_timeout');
  for (let i = 0; i < 20 && !finishRead; i++) await Promise.resolve();
  assert.ok(finishRead);
  assert.equal(timers[0].delay, 100);
  clock.time = 100;
  timers[0].callback();
  await rejected;
  finishRead('Clipboard');
  await Promise.resolve();
  assert.equal(copies, 0);
});

test('expression evaluation checks the shared execution deadline too', () => {
  const { context } = harness();
  let checks = 0;
  const execution = { check() { if (++checks > 5) throw context.createSnippetError('err_snippet_timeout'); } };
  assert.throws(() => context.evaluateExpression('max(1, 2) + max(3, 4) + max(5, 6)', {}, execution), error => error.messageKey === 'err_snippet_timeout');
});

test('execution time setting loads saved seconds and persists valid edits in milliseconds', async () => {
  const { context } = harness();
  const handlers = {};
  let valid = true;
  let reports = 0;
  let saves = 0;
  const input = { value: '', addEventListener(type, callback) { handlers[type] = callback; },
    checkValidity: () => valid, reportValidity() { reports++; } };
  let depthChange;
  const depthInput = { value: '', addEventListener(type, callback) { depthChange = callback; },
    checkValidity: () => valid, reportValidity() { reports++; } };
  const fields = {
    'snippet-timeout-input': input,
    'snippet-depth-input': depthInput,
    'language-select': { addEventListener() {} },
    ...Object.fromEntries(['nextCursor', 'undoExpansion', 'addSnippet', 'addSubgroup', 'reloadSnippets', 'toggleFold']
      .map(key => [`hotkey-display-${key}`, {}]))
  };
  context.document = { getElementById: id => fields[id], querySelectorAll: () => [] };
  context.window = {};
  context.chrome = { storage: { onChanged: { addListener() {} } } };
  context.currentConfig = {};
  context.defaultSnippetGroups = [];
  context.snippetGroups = [];
  context.activeGroupIndex = -1;
  context.loadSyncedState = async () => ({ config: { maxExecutionMs: 2000, maxCallDepth: 64 }, snippetGroups: [] });
  context.loadLocale = async () => {};
  context.renderGroupsList = () => {};
  context.initHotkeyButtons = () => {};
  context.refreshSnippetTester = () => {};
  vm.runInContext(fs.readFileSync(path.join(root, 'options/timeout.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'options/storage.js'), 'utf8'), context);
  context.saveToStorage = () => { saves++; };
  context.restoreOptions();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(input.value, '2');
  input.value = '0.1';
  handlers.change();
  assert.equal(context.currentConfig.maxExecutionMs, 100);
  assert.equal(saves, 1);
  valid = false;
  input.value = '0';
  handlers.change();
  assert.equal(context.currentConfig.maxExecutionMs, 100);
  assert.equal(saves, 1);
  assert.equal(reports, 1);
  assert.equal(depthInput.value, '64');
  depthInput.value = '0';
  depthChange();
  assert.equal(context.currentConfig.maxCallDepth, 64);
  assert.equal(saves, 1);
  valid = true;
  depthInput.value = '128';
  depthChange();
  assert.equal(context.currentConfig.maxCallDepth, 128);
  assert.equal(saves, 2);
});
