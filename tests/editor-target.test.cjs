const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');

function harness() {
  let range;
  const context = vm.createContext({ window: { getSelection: () => range && ({ rangeCount: 1, getRangeAt: () => range }) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content/dom.js'), 'utf8'), context);
  const element = parent => ({
    nodeType: 1, parentElement: parent, isContentEditable: true,
    closest() { return this; },
    contains(node) {
      for (; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
  });
  const root = element(null);
  const first = element(root);
  const second = element(root);
  const text = { nodeType: 3, parentElement: second };
  const select = (startContainer, endContainer = startContainer) => { range = { startContainer, endContainer }; };
  return { context, root, first, second, text, select };
}

test('nested contenteditable events resolve to the field containing the selection', () => {
  const { context, root, first, second, text, select } = harness();
  select(text);
  assert.equal(context.getEditorTarget(root), second);
  assert.equal(context.getEditorTarget(first), first, 'a selection in a sibling must not redirect the target');
  select(second);
  assert.equal(context.getEditorTarget(root), second, 'an empty field has an element selection boundary');
});

test('cross-field selections and missing selections retain the outer editing host', () => {
  const { context, root, first, second, select } = harness();
  assert.equal(context.getEditorTarget(root), root);
  select(first, second);
  assert.equal(context.getEditorTarget(root), root);
  const input = { tagName: 'INPUT', isContentEditable: false };
  assert.equal(context.getEditorTarget(input), input);
});
