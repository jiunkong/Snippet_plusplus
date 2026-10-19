const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const snippetsCss = fs.readFileSync(path.join(root, 'styles', 'snippets.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('each configured hotkey has a display and recording button', () => {
  for (const key of ['nextCursor', 'undoExpansion', 'addSnippet', 'addSubgroup', 'reloadSnippets', 'toggleFold']) {
    assert.match(html, new RegExp(`id="hotkey-display-${key}"`));
    assert.match(html, new RegExp(`data-key="${key}"`));
  }
});

test('language selector exposes browser, Korean, and English choices', () => {
  assert.match(html, /id="language-select"/);
  for (const locale of ['system', 'ko', 'en']) assert.match(html, new RegExp(`value="${locale}"`));
});

test('extension entrypoints use bundles and explicit module dependencies', () => {
  assert.deepEqual(manifest.content_scripts[0].js, ['bundles/content.js']);
  assert.equal(manifest.background.service_worker, 'bundles/background.js');
  assert.match(html, /<script defer src="bundles\/options\.js"><\/script>/);
  assert.match(fs.rawReadFileSync(path.join(root, 'content/state.js'), 'utf8'), /from '\.\.\/utils\/config\.js'/);
  assert.match(fs.rawReadFileSync(path.join(root, 'options/storage.js'), 'utf8'), /from '\.\.\/utils\/sync\.js'/);
  assert.match(fs.rawReadFileSync(path.join(root, 'options/main.js'), 'utf8'), /from '\.\/snippets\.js'/);
});

test('snippet search filters the active list by snippet name', () => {
  const search = { value: 'HELLO' };
  const emptyMessage = { hidden: true };
  const row = name => ({
    hidden: false,
    querySelector: () => ({ value: name })
  });
  const rows = [row('Hello world'), row('Meeting follow-up')];
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: {
      getElementById(id) {
        return id === 'snippet-search' ? search : emptyMessage;
      },
      querySelectorAll() { return rows; }
    }
  });
  for (const file of ['options/subgroups.js', 'options/snippets.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }

  context.applySnippetSearch();

  assert.equal(rows[0].hidden, false);
  assert.equal(rows[1].hidden, true);
  assert.match(snippetsCss, /\.snippet-row\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.equal(emptyMessage.hidden, true);

  search.value = 'missing';
  context.applySnippetSearch();
  assert.equal(emptyMessage.hidden, false);
});

test('snippet call errors refresh when unsaved target names and parameters change', () => {
  const rows = [];
  const pending = [];
  const list = { children: rows, insertBefore(row) { rows.push(row); }, appendChild(row) { rows.push(row); } };
  const field = value => ({ value, textContent: '', innerHTML: '', style: {},
    classList: { add() {}, remove() {} }, addEventListener() {} });
  const context = vm.createContext({
    t: (key, args = []) => `${key}:${args.join(',')}`,
    currentConfig: { visualizeNewlines: false },
    window: { addEventListener() {} },
    chrome: { storage: { onChanged: { addListener() {} } } },
    ResizeObserver: class { observe() {} },
    document: {
      getElementById: () => list,
      querySelectorAll: () => rows,
      createElement() {
        const snippet = pending.shift();
        const fields = new Map([
          ['.snippet-name-input', field(snippet.name)],
          ['.trigger-input', field(snippet.trigger)]
        ]);
        const row = {
          classList: { contains: () => false },
          addEventListener() {},
          querySelector(selector) {
            if (!fields.has(selector)) fields.set(selector, field(''));
            return fields.get(selector);
          },
          remove() { rows.splice(rows.indexOf(row), 1); }
        };
        return row;
      }
    },
    syncActiveGroupData() {}, debouncedSave() {}
  });
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'options/highlight.js', 'options/storage.js', 'options/subgroups.js', 'options/snippets.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.debouncedSave = () => {};
  context.checkTriggerConflicts = () => {};
  context.applySnippetSearch = () => {};
  const definitions = [
    { name: 'Caller', trigger: '/call', replacement: '{{@Helper("a")}}' },
    { name: 'Helper', trigger: '/h ${one:x} ${two:y}', replacement: 'body' }
  ];
  pending.push(...definitions);
  definitions.forEach(snippet => context.addSnippetRowUI(snippet));
  context.updateAllHighlights();
  const callerError = rows[0].querySelector('.error-msg-container');
  const helper = rows[1];
  assert.equal(callerError.textContent, 'err_snippet_call_args:Helper,2');
  assert.equal(callerError.style.display, 'block');

  helper.querySelector('.trigger-input').value = '/h ${one:x}';
  helper.querySelector('.trigger-input').oninput();
  assert.equal(callerError.style.display, 'none');

  helper.querySelector('.snippet-name-input').value = 'Renamed';
  helper.querySelector('.snippet-name-input').oninput();
  assert.equal(callerError.textContent, 'err_snippet_call_target:Helper');
  assert.equal(callerError.style.display, 'block');

  helper.querySelector('.snippet-name-input').value = 'Helper';
  helper.querySelector('.snippet-name-input').oninput();
  assert.equal(callerError.style.display, 'none');

  helper.querySelector('.delete-row-btn').onclick();
  assert.equal(callerError.textContent, 'err_snippet_call_target:Helper');
  assert.equal(callerError.style.display, 'block');

  const caller = rows[0];
  caller.querySelector('.replacement-input').value = '{{@Caller()}}';
  caller.updateValidation();
  assert.equal(callerError.style.display, 'none');
  caller.querySelector('.snippet-name-input').value = 'Renamed Caller';
  caller.querySelector('.snippet-name-input').oninput();
  assert.equal(callerError.textContent, 'err_snippet_call_target:Caller');
  caller.querySelector('.replacement-input').value = '{{@"Renamed Caller"()}}';
  caller.updateValidation();
  assert.equal(callerError.style.display, 'none');
  caller.querySelector('.replacement-input').value = 'No function call';
  caller.updateValidation();
  assert.equal(callerError.style.display, 'none');
});

function snippetNavigationContext(document = {}, extra = {}) {
  const context = vm.createContext({ window: { addEventListener() {} }, document, ...extra });
  for (const file of ['utils/triggers.js', 'options/subgroups.js', 'options/snippets.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('definition navigation resolves only selected function names inside template expressions', () => {
  const context = snippetNavigationContext();
  for (const text of ['{{@hello("Guest")<2>}}', '{{@hello<2>("Guest")}}', '{{upper(@hello("Guest"))}}', '{{@인사()}}']) {
    const name = text.includes('인사') ? '인사' : 'hello';
    const start = text.indexOf(name);
    assert.equal(context.snippetFunctionAtSelection(text, start, start + name.length), name);
    assert.equal(context.snippetFunctionAtSelection(text, start - 1, start), name);
  }
  for (const text of ['plain @hello()', '{{"@hello()"}}', "{{@outer('@hello()')}}", '{{@hello}}']) {
    const start = text.indexOf('hello');
    assert.equal(context.snippetFunctionAtSelection(text, start, start + 5), null, text);
  }
  const text = '{{@hello("Guest")}}';
  const argument = text.indexOf('Guest');
  assert.equal(context.snippetFunctionAtSelection(text, argument, argument + 5), null);
  assert.equal(context.snippetFunctionAtSelection(text, 2, argument + 5), null);
});

test('double-click navigation reveals a filtered collapsed target and focuses its body', () => {
  let saves = 0;
  let syncs = 0;
  let scrolled = false;
  const search = { value: 'Caller' };
  const empty = {};
  const body = {
    focus(options) { this.focused = options; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  };
  const target = {
    hidden: true,
    collapsed: true,
    querySelector(selector) { return selector === '.snippet-name-input' ? { value: 'hello' } : body; },
    scrollIntoView() { scrolled = true; }
  };
  target.classList = {
    contains: () => target.collapsed,
    remove() { target.collapsed = false; }
  };
  const rows = [target];
  const context = snippetNavigationContext({
    querySelectorAll: () => rows,
    getElementById: id => id === 'snippet-search' ? search : empty
  }, {
    getHighlightAnalysis: () => undefined,
    syncActiveGroupData() { syncs++; }, debouncedSave() { saves++; }
  });
  const text = '{{upper(@hello<2>("Guest"))}}';
  const textarea = { value: text, selectionStart: text.indexOf('hello'), selectionEnd: text.indexOf('hello') + 5 };
  const event = { preventDefault() { this.prevented = true; } };
  assert.equal(context.navigateToSnippetFunction(textarea, event), true);
  assert.equal(event.prevented, true);
  assert.equal(search.value, '');
  assert.equal(target.hidden, false);
  assert.equal(target.collapsed, false);
  assert.equal(scrolled, true);
  assert.equal(body.focused.preventScroll, true);
  assert.equal(body.selectionStart, 0);
  assert.equal(body.selectionEnd, 0);
  assert.equal(syncs, 1);
  assert.equal(saves, 1);

  // Navigation to an already expanded row does not create another save.
  context.navigateToSnippetFunction(textarea, event);
  assert.equal(saves, 1);
  rows.push(target);
  const untouched = { preventDefault() { throw Error('ambiguous name must not navigate'); } };
  assert.equal(context.navigateToSnippetFunction(textarea, untouched), false);
  rows.length = 0;
  assert.equal(context.navigateToSnippetFunction(textarea, untouched), false);
});

test('pointer cursor appears only over a uniquely resolvable function name', () => {
  const rows = [{ querySelector: () => ({ value: 'hello' }) }];
  const context = snippetNavigationContext({ querySelectorAll: () => rows });
  const textarea = { style: {} };
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
  const span = (textContent, rectangles) => ({ textContent, getClientRects: () => rectangles });
  const highlight = { querySelectorAll: () => [
    span('@hello', [rect(10, 10, 40, 25), rect(0, 26, 20, 40)]),
    span('(', [rect(40, 10, 50, 25)]),
    span('@missing', [rect(50, 10, 90, 25)])
  ] };
  const hover = (clientX, clientY) => context.updateSnippetFunctionCursor(textarea, highlight, { clientX, clientY });
  hover(15, 15);
  assert.equal(textarea.style.cursor, 'pointer');
  hover(5, 30); // Wrapped portion of the name.
  assert.equal(textarea.style.cursor, 'pointer');
  for (const [x, y] of [[45, 15], [60, 15], [100, 50], [15, 40]]) {
    hover(x, y);
    assert.equal(textarea.style.cursor, '');
  }
  rows.push(rows[0]);
  hover(15, 15);
  assert.equal(textarea.style.cursor, '');
});

test('quoted function names resolve word selections and show a pointer for the complete name', () => {
  const row = { querySelector: () => ({ value: 'hello world' }) };
  const context = snippetNavigationContext({ querySelectorAll: () => [row] });
  for (const text of ['{{@"hello world"("Guest")}}', "{{@'hello world'<2>('Guest')}}"]) {
    const from = text.indexOf('world');
    assert.equal(context.snippetFunctionAtSelection(text, from, from + 5), 'hello world');
  }
  const text = '{{"@hello world()"}}';
  const from = text.indexOf('world');
  assert.equal(context.snippetFunctionAtSelection(text, from, from + 5), null);
  const textarea = { style: {} };
  const highlight = { querySelectorAll: () => [{ textContent: '@"hello world"', getClientRects: () => [{ left: 0, right: 100, top: 0, bottom: 20 }] }] };
  context.updateSnippetFunctionCursor(textarea, highlight, { clientX: 20, clientY: 10 });
  assert.equal(textarea.style.cursor, 'pointer');
});

test('add-subgroup shortcut honors defaults, custom bindings, editor scope and key recording', () => {
  let listener;
  let active = true;
  let created = 0;
  const context = vm.createContext({
    window: { addEventListener(type, callback) { if (type === 'keydown') listener = callback; } },
    document: { getElementById: () => ({ classList: { contains: () => active } }) },
    activeGroupIndex: 0, recordingTarget: null,
    addSubgroup() { created++; }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'utils/config.js'), 'utf8'), context);
  vm.runInContext('var currentConfig = { ...DEFAULT_CONFIG };', context);
  vm.runInContext(fs.readFileSync(path.join(root, 'options/hotkeys.js'), 'utf8'), context);
  assert.equal(context.currentConfig.addSubgroup, 'Alt+G');
  const press = (changes = {}) => {
    let prevented = false;
    listener({ key: 'g', code: 'KeyG', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false,
      preventDefault() { prevented = true; }, ...changes });
    return prevented;
  };
  assert.equal(press(), true);
  assert.equal(created, 1);
  assert.equal(press({ key: 'ㅎ' }), true, 'physical key works with Korean input');
  assert.equal(created, 2);
  active = false;
  assert.equal(press(), false);
  active = true;
  context.activeGroupIndex = -1;
  assert.equal(press(), false);
  context.activeGroupIndex = 0;
  context.recordingTarget = 'addSubgroup';
  assert.equal(press(), false);
  context.recordingTarget = null;
  assert.equal(press({ shiftKey: true }), false);
  assert.equal(press({ target: { closest: () => ({}) } }), false, 'editor shortcuts stay inactive inside a modal');
  assert.equal(created, 2);
  context.currentConfig.addSubgroup = 'Ctrl+Shift+G';
  assert.equal(press(), false, 'old binding stops working after customization');
  assert.equal(press({ altKey: false, ctrlKey: true, shiftKey: true }), true);
  assert.equal(created, 3);
});

test('function navigation distinguishes fragment text from calls in literal template tags', () => {
  const context = snippetNavigationContext();
  const text = '{{`plain @Missing() {{@Inner()}}` + @After()}}';
  for (const [name, expected] of [['Missing', null], ['Inner', 'Inner'], ['After', 'After']]) {
    const index = text.indexOf(name);
    assert.equal(context.snippetFunctionAtSelection(text, index, index + name.length), expected);
  }
});
