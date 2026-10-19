const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');

const root = path.join(__dirname, '..');

function domHarness() {
  const context = vm.createContext({ console });
  for (const file of ['utils/constants.js', 'content/fragment.js', 'content/dom.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('a level zero snippet reserves level zero for itself', () => {
  const context = domHarness();
  const max = context.getMaxCursorLevel(vm.runInContext('new SnippetFragment([{ type: \"cursor\", level: 0 }])', context));
  assert.equal(max, 0);
  assert.equal(context.shiftVisualPlaceholders('old ⟦0⟧ and ⟦2⟧', max + 1), 'old ⟦1⟧ and ⟦3⟧');
});

test('existing placeholders move past every level in the new snippet', () => {
  const context = domHarness();
  const max = context.getMaxCursorLevel(vm.runInContext('new SnippetFragment([0, 1, 2].map(level => ({ type: \"cursor\", level })))', context));
  assert.equal(max, 2);
  assert.equal(context.shiftVisualPlaceholders('existing ⟦0⟧, ⟦1⟧', max + 1), 'existing ⟦3⟧, ⟦4⟧');
});

test('input placeholder shifting preserves the selection', () => {
  const context = domHarness();
  const input = {
    tagName: 'TEXTAREA',
    isContentEditable: false,
    value: 'before ⟦0⟧ after',
    selectionStart: 4,
    selectionEnd: 4,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };
  context.shiftVisualPlaceholders(input, 2);
  assert.equal(input.value, 'before ⟦2⟧ after');
  assert.equal(input.selectionStart, 4);
  assert.equal(input.selectionEnd, 4);
});

test('input selection follows a placeholder when its level gains a digit', () => {
  const context = domHarness();
  const input = {
    tagName: 'TEXTAREA',
    isContentEditable: false,
    value: '⟦9⟧ /trigger',
    selectionStart: 12,
    selectionEnd: 12,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };
  context.shiftVisualPlaceholders(input, 1);
  assert.equal(input.value, '⟦10⟧ /trigger');
  assert.equal(input.selectionStart, 13);
  assert.equal(input.selectionEnd, 13);
});

test('contenteditable placeholder spans are shifted with their data level', () => {
  const context = domHarness();
  const placeholders = [
    { dataset: { val: '#0' }, textContent: '⟦0⟧' },
    { dataset: { val: '#2' }, textContent: '⟦2⟧' }
  ];
  const editable = {
    tagName: 'DIV',
    isContentEditable: true,
    querySelectorAll: () => placeholders
  };
  context.shiftVisualPlaceholders(editable, 3);
  assert.deepEqual(Array.from(placeholders, item => [item.dataset.val, item.textContent]), [
    ['#3', '⟦3⟧'],
    ['#5', '⟦5⟧']
  ]);
});

test('contenteditable plain-text markers are shifted without losing the caret', () => {
  const context = domHarness();
  const textNode = { textContent: '⟦9⟧ /trigger' };
  const editable = {
    tagName: 'DIV',
    isContentEditable: true,
    contains: node => node === textNode,
    querySelectorAll: () => []
  };
  const currentRange = {
    startContainer: textNode,
    startOffset: textNode.textContent.length,
    endContainer: textNode,
    endOffset: textNode.textContent.length,
    cloneRange() {
      return {
        endOffset: 0,
        selectNodeContents() {},
        setEnd(_node, offset) { this.endOffset = offset; },
        toString() { return textNode.textContent.slice(0, this.endOffset); }
      };
    }
  };
  let restoredRange;
  const selection = {
    rangeCount: 1,
    getRangeAt: () => currentRange,
    removeAllRanges() {},
    addRange(range) { restoredRange = range; }
  };
  context.NodeFilter = { SHOW_TEXT: 4 };
  context.window = { getSelection: () => selection };
  context.document = {
    createTreeWalker: () => {
      let visited = false;
      return { nextNode: () => visited ? null : ((visited = true), textNode) };
    },
    createRange: () => ({
      setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
      setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
    })
  };

  context.shiftVisualPlaceholders(editable, 1);

  assert.equal(textNode.textContent, '⟦10⟧ /trigger');
  assert.equal(restoredRange.startOffset, textNode.textContent.length);
  assert.equal(restoredRange.endOffset, textNode.textContent.length);
});

test('contenteditable navigation selects the placeholder element', () => {
  const context = domHarness();
  const placeholder = {};
  const textNode = {
    textContent: '⟦0⟧',
    parentElement: {
      closest: selector => selector === '.ss-placeholder' ? placeholder : null
    }
  };
  const editable = { contains: node => node === placeholder };
  context.NodeFilter = { SHOW_TEXT: 4 };
  context.document = {
    createTreeWalker: () => {
      let visited = false;
      return { nextNode: () => visited ? null : ((visited = true), textNode) };
    },
    createRange: () => ({
      selectNode(node) { this.selected = node; }
    })
  };
  let selectedRange;
  context.window = {
    getSelection: () => ({
      removeAllRanges() {},
      addRange(range) { selectedRange = range; }
    })
  };

  assert.equal(context.selectPlaceholder(
    editable,
    { isInput: false, isEditable: true },
    { index: 0, length: 3, level: 0 }
  ), true);
  assert.equal(selectedRange.selected, placeholder);
});

test('auto cursor placement collapses the caret at the hidden marker', () => {
  const context = domHarness();
  const marker = {};
  const editable = {
    querySelector: selector => selector === '[data-spp-auto-cursor="auto-1"]' ? marker : null
  };
  const range = {
    setStartAfter(node) { this.node = node; },
    collapse(value) { this.collapsed = value; }
  };
  let selectedRange;
  context.document = { createRange: () => range };
  context.window = {
    getSelection: () => ({
      removeAllRanges() {},
      addRange(value) { selectedRange = value; }
    })
  };

  assert.equal(context.placeCaretAtAutoCursor(editable, 'auto-1'), true);
  assert.equal(selectedRange.node, marker);
  assert.equal(selectedRange.collapsed, true);
});
