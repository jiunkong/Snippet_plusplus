const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function editorHarness(value, caret) {
  const el = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };
  const document = {
    activeElement: el,
    addEventListener() {},
    execCommand(command, _showUI, text) {
      if (command === 'delete' || command === 'insertText') {
        const inserted = command === 'insertText' ? text : '';
        el.value = el.value.slice(0, el.selectionStart) + inserted + el.value.slice(el.selectionEnd);
        const end = el.selectionStart + inserted.length;
        el.setSelectionRange(end, end);
        return true;
      }
      return false;
    }
  };
  const context = vm.createContext({
    document,
    window: { getSelection: () => ({}) },
    chrome: { storage: { onChanged: { addListener() {} } } },
    loadSettings() {},
    showSnippetError() {},
    getTargetInfo: () => ({ isInput: true, isEditable: false }),
    processTemplate: async text => text,
    getMaxCursorLevel: () => -1,
    config: { shiftCursorLevels: false },
    CURSOR_REGEX: /\{\{\s*(cursor|#(?:cursor|\d+))\s*\}\}/g,
    VISUAL_CURSOR_REGEX: /⟦(\d+)⟧/g,
    VISUAL_OPEN: '⟦',
    VISUAL_CLOSE: '⟧',
    setTimeout() {},
    performance: { now: () => 0 },
    console
  });
  vm.runInContext('let lastExpansion = null; let isInternalEdit = false;', context);
  for (const file of ['content/expansion.js', 'content/handlers.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return { el, context };
}

test('input expansion records the original trigger position and undo restores surrounding text', async () => {
  const { el, context } = editorHarness('prefix /hello suffix', 13);
  const info = { isInput: true, isEditable: false };
  const result = await context.selectAndReplace(el, info, { textBefore: 'prefix /hello' }, 6, 'WORLD');
  assert.equal(result.start, 7);
  assert.equal(el.value, 'prefix WORLD suffix');

  context.recordExpansion(el, info, result.before);
  el.setSelectionRange(0, 0);
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.value, 'prefix /hello suffix');
  assert.equal(el.selectionStart, 13);
  assert.equal(el.selectionEnd, 13);
});

test('undo restores the original caret when a shared suffix lies beyond the text change', async () => {
  for (const replacement of ['WORLD/hello', '/hello!', '']) {
    const { el, context } = editorHarness('prefix /hello suffix', 13);
    const info = { isInput: true, isEditable: false };
    const result = await context.selectAndReplace(el, info, { textBefore: 'prefix /hello' }, 6, replacement);
    context.recordExpansion(el, info, result.before);
    el.setSelectionRange(0, 0);
    // Some host editors leave selection at the insertion start after execCommand.
    const execCommand = context.document.execCommand;
    context.document.execCommand = (...args) => {
      const start = el.selectionStart;
      const restored = execCommand(...args);
      el.setSelectionRange(start, start);
      return restored;
    };
    assert.equal(context.undoLastExpansion(), true);
    assert.equal(el.value, 'prefix /hello suffix');
    assert.equal(el.selectionStart, 13, replacement);
    assert.equal(el.selectionEnd, 13, replacement);
  }
});

test('expansion keeps the trigger position when shifted levels gain a digit', async () => {
  const original = '⟦9⟧ /hello';
  const { el, context } = editorHarness(original, original.length);
  context.config.shiftCursorLevels = true;
  context.getMaxCursorLevel = () => 0;
  context.shiftVisualPlaceholders = target => {
    target.value = target.value.replace('⟦9⟧', '⟦10⟧');
    target.setSelectionRange(target.selectionStart + 1, target.selectionEnd + 1);
  };
  context.getCaretContext = target => ({ textBefore: target.value.slice(0, target.selectionEnd) });

  const result = await context.selectAndReplace(
    el,
    { isInput: true, isEditable: false },
    { textBefore: original },
    6,
    'WORLD {{#0}}'
  );
  assert.equal(el.value, '⟦10⟧ WORLD ⟦0⟧');
  assert.equal(result.start, 5);
});

test('undo refuses to change text that was edited after expansion', async () => {
  const { el, context } = editorHarness('/hello', 6);
  const info = { isInput: true, isEditable: false };
  const result = await context.selectAndReplace(el, info, { textBefore: '/hello' }, 6, 'WORLD');
  context.recordExpansion(el, info, result.before);
  el.value += '!';
  assert.equal(context.undoLastExpansion(), false);
  assert.equal(el.value, 'WORLD!');
});

test('undo removes only the added suffix when replacement preserves the trigger', async () => {
  const { el, context } = editorHarness('/hello', 6);
  const info = { isInput: true, isEditable: false };
  const result = await context.selectAndReplace(el, info, { textBefore: '/hello' }, 6, '/hello!');
  context.recordExpansion(el, info, result.before);
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.value, '/hello');
});

test('input handler records expansion immediately and still allows undo', async () => {
  const { el, context } = editorHarness('/hello', 6);
  const scheduled = [];
  el.closest = () => null;
  context.setTimeout = callback => scheduled.push(callback);
  context.getCaretContext = () => ({ textBefore: el.value.slice(0, el.selectionEnd) });
  context.triggerEffect = () => {};
  context.findNextPlaceholder = () => null;
  vm.runInContext('let typingSeqLength = 5; let snippets = [{ isRegex: false, literalTrigger: "/hello", replacement: "WORLD" }];', context);

  await context.handleInput({ target: el, inputType: 'insertText', data: 'o' });
  assert.equal(el.value, 'WORLD');
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.value, '/hello');
  for (const callback of scheduled) callback();
  assert.equal(el.value, '/hello');
});

test('Ctrl+Z restores the most recent snippet expansion', async () => {
  const { el, context } = editorHarness('/hello', 6);
  const info = { isInput: true, isEditable: false };
  const result = await context.selectAndReplace(el, info, { textBefore: '/hello' }, 6, 'WORLD');
  context.recordExpansion(el, info, result.before);
  const event = {
    target: el,
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };

  context.handleKeyDown(event);

  assert.equal(el.value, '/hello');
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(el.selectionStart, 6);
  assert.equal(el.selectionEnd, 6);
});

test('input handler removes the first placeholder synchronously', async () => {
  const { el, context } = editorHarness('/hello', 6);
  const scheduled = [];
  el.closest = () => null;
  context.setTimeout = callback => scheduled.push(callback);
  context.getCaretContext = () => ({ textBefore: el.value.slice(0, el.selectionEnd) });
  context.triggerEffect = () => {};
  context.findNextPlaceholder = text => {
    const index = text.indexOf('⟦0⟧');
    return index < 0 ? null : { index, length: 3, level: 0 };
  };
  context.selectPlaceholder = (target, _info, match) => {
    target.setSelectionRange(match.index, match.index + match.length);
    return true;
  };
  vm.runInContext('let typingSeqLength = 5; let snippets = [{ isRegex: false, literalTrigger: "/hello", replacement: "A{{#0}}B" }];', context);

  await context.handleInput({ target: el, inputType: 'insertText', data: 'o' });

  assert.equal(el.value, 'AB');
  assert.equal(el.selectionStart, 1);
  assert.equal(el.selectionEnd, 1);
  assert.equal(scheduled.length, 0);
});

test('an auto cursor never falls through to an existing placeholder', () => {
  const { context } = editorHarness('/old marker', 11);
  let autoCursorCalls = 0;
  context.placeCaretAtAutoCursor = () => { autoCursorCalls++; return false; };
  context.findNextPlaceholder = () => { throw new Error('must not search old placeholders'); };

  context.placeExpansionCursor(
    {},
    { isEditable: true, isInput: false },
    { autoCursorId: 'auto-1', hasPlaceholders: true, start: 0 },
    'old marker'
  );

  assert.equal(autoCursorCalls, 1);
});

test('cancelled prompt restores its trigger', async () => {
  const { el, context } = editorHarness('prefix /hello', 13);
  context.processTemplate = async () => {
    const error = new Error('Cancelled');
    error.name = 'SnippetPromptCancelled';
    throw error;
  };
  const result = await context.selectAndReplace(
    el, { isInput: true, isEditable: false }, { textBefore: 'prefix /hello' }, 6, 'prompt("Name")'
  );
  assert.equal(result.cancelled, true);
  assert.equal(el.value, 'prefix /hello');
});

test('text change includes backspace effects before the trigger', () => {
  const { context } = editorHarness('', 0);
  const change = context.getTextChange('abc/hello', 'abX');
  assert.equal(change.start, 2);
  assert.equal(change.removed, 'c/hello');
  assert.equal(change.inserted, 'X');
});

test('contenteditable undo restores text and the original caret even when the caret moved', () => {
  const { el, context } = editorHarness('', 0);
  el.textContent = 'prefix WORLD suffix';
  el.innerHTML = el.textContent;
  const info = { isInput: false, isEditable: true };
  context.getTargetInfo = () => info;
  context.NodeFilter = { SHOW_TEXT: 4 };
  const textNode = { get textContent() { return el.textContent; } };
  context.document.createTreeWalker = () => {
    let visited = false;
    return { nextNode: () => visited ? null : ((visited = true), textNode) };
  };
  context.document.createRange = () => ({
    setStart(_node, offset) { this.start = offset; },
    setEnd(_node, offset) { this.end = offset; }
  });
  let selectedRange;
  context.window.getSelection = () => ({
    removeAllRanges() {},
    addRange(range) { selectedRange = range; }
  });
  context.document.execCommand = (_command, _showUI, inserted) => {
    el.textContent = el.textContent.slice(0, selectedRange.start) + inserted + el.textContent.slice(selectedRange.end);
    el.innerHTML = el.textContent;
    return true;
  };

  context.recordExpansion(el, info, { text: 'prefix /hello suffix', html: 'prefix /hello suffix', caretOffset: 13 });
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.textContent, 'prefix /hello suffix');
  assert.equal(selectedRange.start, 13);
  assert.equal(selectedRange.end, 13);
});

test('template call failures and nested prompt cancellation restore the original input', async () => {
  for (const replacement of ['{{@Missing()}}', '{{@Ask()}}', '{{@Ask<-1>()}}']) {
    const { el, context } = editorHarness('prefix /hello suffix', 13);
    for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    context.console = { error() { assert.fail('Handled template failures must not be logged as extension errors'); } };
    context.showSnippetPrompt = async () => '';
    const errors = [];
    context.showSnippetError = error => errors.push(error);
    const result = await context.selectAndReplace(el, { isInput: true }, { textBefore: 'prefix /hello' }, 6,
      replacement, {}, { snippets: [{ name: 'Ask', replacement: 'prefix {{prompt("Name?")}} suffix' }] });
    assert.equal(result.cancelled, true);
    assert.equal(el.value, 'prefix /hello suffix');
    assert.equal(el.selectionStart, 13);
    assert.equal(errors.length, replacement === '{{@Ask()}}' ? 0 : 1);
  }
});

test('typed regex captures pass through snippet calls with cursor placement and undo', async () => {
  const { el, context } = editorHarness('/greet Jiun', 11);
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  const caller = { name: 'Caller', trigger: '/greet ${name}', replacement: '{{@Greeting($name)}}' };
  const helper = { name: 'Greeting', trigger: '/hello ${person}', replacement: 'Hi {{$person}}{{#0}}!' };
  const compiled = context.compileTrigger(caller.trigger);
  context.runtimeSnippets = [{ ...caller, isRegex: true, compiledRegex: compiled.regex,
    groupSnippets: [caller, helper], sourceSnippet: caller }];
  vm.runInContext('let typingSeqLength = 10; let snippets = runtimeSnippets;', context);
  el.closest = () => null;
  context.getCaretContext = () => ({ textBefore: el.value.slice(0, el.selectionEnd) });
  context.triggerEffect = () => {};
  context.findNextPlaceholder = text => {
    const index = text.indexOf('⟦0⟧');
    return index < 0 ? null : { index, length: 3, level: 0 };
  };
  context.selectPlaceholder = (target, _info, match) => {
    target.setSelectionRange(match.index, match.index + match.length);
    return true;
  };
  await context.handleInput({ target: el, inputType: 'insertText', data: 'n' });
  assert.equal(el.value, 'Hi Jiun!');
  assert.equal(el.selectionStart, 7);
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.value, '/greet Jiun');
  assert.equal(el.selectionStart, 11);
  assert.equal(el.selectionEnd, 11);
});

test('shifted snippet cursors become input placeholders for either call order', async () => {
  for (const replacement of ['{{@func()<2>}}', '{{@func<2>()}}']) {
    const { el, context } = editorHarness('/hello', 6);
    for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    await context.selectAndReplace(el, { isInput: true }, { textBefore: '/hello' }, 6, replacement, {}, {
      snippets: [{ name: 'func', trigger: '', replacement: 'hello{{#0}}{{#1}}{{cursor}}' }]
    });
    assert.equal(el.value, 'hello⟦2⟧⟦3⟧⟦2⟧');
  }
});

test('replacement syntax errors restore the trigger and display Korean errors without console logging', async () => {
  const ko = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales/ko/messages.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales/en/messages.json'), 'utf8'));
  for (const [replacement, key, values] of [
    ['{{$missing}}', 'err_undefined_variable', ['$missing']],
    ['{{unknownTag}}', 'err_unknown_tag', ['unknownTag']],
    ['{{unknownFunction()}}', 'err_unknown_function', ['unknownFunction']],
    ['{{2[0]}}', 'err_list_index_target', []],
    ['{{true[0]}}', 'err_list_index_target', []],
    ['{{if true}}body', 'err_if_unclosed', []]
  ]) {
    const { el, context } = editorHarness('prefix /hello suffix', 13);
    context.config.uiLocale = 'ko';
    context.chrome.runtime = { getURL: path => path };
    context.chrome.i18n = { getMessage: (key, values = []) => (en[key]?.message || '').replace(/\$(\d+)/g, (_, i) => values[i - 1]) };
    context.fetch = async () => ({ ok: true, json: async () => ko });
    context.console = { error() { assert.fail('Syntax errors should only display a toast'); } };
    for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    await context.loadSnippetLocale('ko');
    const errors = [];
    context.showSnippetError = error => errors.push(error.message);
    const result = await context.selectAndReplace(el, { isInput: true }, { textBefore: 'prefix /hello' }, 6, replacement);
    assert.equal(result.cancelled, true);
    assert.equal(el.value, 'prefix /hello suffix');
    assert.deepEqual(errors, [ko[key].message.replace(/\$(\d+)/g, (_, index) => values[index - 1])]);
  }
});

test('a toast-only snippet consumes its trigger without inserting or restoring text', async () => {
  const { el, context } = editorHarness('prefix /hello suffix', 13);
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  const messages = [];
  context.showSnippetToast = (message, color) => messages.push([message, color]);
  const result = await context.selectAndReplace(el, { isInput: true }, { textBefore: 'prefix /hello' }, 6,
    '{{toast("prompt() finished", "green")}}');
  assert.notEqual(result.cancelled, true);
  assert.equal(el.value, 'prefix  suffix');
  assert.deepEqual(messages, [['prompt() finished', 'green']]);
});

test('the test frame runs unsaved snippets through real input expansion and undo', async () => {
  const { el, context } = editorHarness('/test Guest', 11);
  context.window.location = { origin: 'chrome-extension://test' };
  context.window.parent = { postMessage() {} };
  context.window.addEventListener = () => {};
  context.document.getElementById = () => ({ setAttribute() {} });
  context.loadLocale = async () => {};
  context.t = key => key;
  vm.runInContext('let snippets = []; let typingSeqLength = 0;', context);
  for (const file of ['utils/constants.js', 'utils/config.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js', 'options/tester-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  const library = [{ name: 'Test', siteMode: 'whitelist', disabledSites: ['unrelated.example'], snippets: [
    { name: 'caller', trigger: '/test ${name}', replacement: '{{@"hello world"($name)}}', subgroupId: 'one' },
    { name: 'hello world', trigger: '/hello ${name}', replacement: 'Hello {{$name}}', subgroupId: 'two' }
  ] }];
  await context.applySnippetTestState({ config: {}, snippetGroups: library });
  el.closest = () => null;
  context.getCaretContext = () => ({ textBefore: el.value.slice(0, el.selectionEnd) });
  context.triggerEffect = () => {};
  context.findNextPlaceholder = () => null;
  vm.runInContext('typingSeqLength = 10;', context);
  await context.handleInput({ target: el, inputType: 'insertText', data: 't' });
  assert.equal(el.value, 'Hello Guest');
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.value, '/test Guest');
});

test('a copy-only snippet consumes its trigger and failed writes restore it', async () => {
  for (const fails of [false, true]) {
    const { el, context } = editorHarness('prefix /hello suffix', 13);
    for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    const writes = [];
    const errors = [];
    context.navigator = { clipboard: { async writeText(text) {
      if (fails) throw new Error('Permission denied');
      writes.push(text);
    } } };
    context.showSnippetError = error => errors.push(error.messageKey);
    const result = await context.selectAndReplace(el, { isInput: true }, { textBefore: 'prefix /hello' }, 6,
      '{{copy("Guest")}}');
    assert.equal(el.value, fails ? 'prefix /hello suffix' : 'prefix  suffix');
    assert.deepEqual(writes, fails ? [] : ['Guest']);
    assert.deepEqual(errors, fails ? ['err_clipboard_copy_failed'] : []);
    if (!fails) assert.notEqual(result.cancelled, true);
  }
});

test('execution timeout restores the trigger and reports a localized error without inserting partial output', async () => {
  const { el, context } = editorHarness('prefix /hello suffix', 13);
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const errors = [];
  context.config.maxExecutionMs = 100;
  let time = 0;
  context.performance.now = () => time;
  context.showSnippetToast = () => { time += 101; };
  context.showSnippetError = error => errors.push(error.messageKey);
  const result = await context.selectAndReplace(el, { isInput: true }, { textBefore: 'prefix /hello' }, 6,
    'partial{{toast("work", "red")}}trailing');
  assert.equal(result.cancelled, true);
  assert.equal(el.value, 'prefix /hello suffix');
  assert.deepEqual(errors, ['err_snippet_timeout']);
});
