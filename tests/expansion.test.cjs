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
    getTargetInfo: () => ({ isInput: true, isEditable: false }),
    processTemplate: async text => text,
    getMaxCursorLevel: () => -1,
    config: { shiftCursorLevels: false },
    CURSOR_REGEX: /\{\{\s*(cursor|#(?:cursor|\d+))\s*\}\}/g,
    VISUAL_CURSOR_REGEX: /⟦(\d+)⟧/g,
    VISUAL_OPEN: '⟦',
    VISUAL_CLOSE: '⟧',
    setTimeout() {},
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
  context.processTemplate = async () => '';
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

test('contenteditable undo selects the changed text even when the caret moved', () => {
  const { el, context } = editorHarness('', 0);
  el.textContent = 'prefix WORLD suffix';
  el.innerHTML = el.textContent;
  const info = { isInput: false, isEditable: true };
  context.getTargetInfo = () => info;
  context.NodeFilter = { SHOW_TEXT: 4 };
  const textNode = { textContent: el.textContent };
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

  context.recordExpansion(el, info, { text: 'prefix /hello suffix', html: 'prefix /hello suffix' });
  assert.equal(context.undoLastExpansion(), true);
  assert.equal(el.textContent, 'prefix /hello suffix');
});
