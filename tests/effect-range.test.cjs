const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const vm = require('./helpers/vm.cjs');
const path = require('node:path');
const context = vm.createContext({});
for (const file of ['content/expansion.js', 'content/effect-range.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
function range(before, start, after) {
  const result = context.getReplacementRange({ effectBefore: { text: before }, start }, after);
  return result && JSON.parse(JSON.stringify(result));
}

test('feedback includes the whole insertion even when its text matches the existing prefix or tail', () => {
  assert.deepEqual(range('hello tail', 6, 'hello hello tail'), { start: 6, end: 12 });
  assert.deepEqual(range('same', 0, 'samesame'), { start: 0, end: 4 });
  assert.deepEqual(range('', 0, 'hello'), { start: 0, end: 5 });
});
test('feedback follows multiline text, consumed cursors and backspace effects without covering the tail', () => {
  assert.deepEqual(range('prefix tail', 7, 'prefix one\ntwotail'), { start: 7, end: 14 });
  assert.deepEqual(range('prefix tail', 7, 'prefix ABtail'), { start: 7, end: 9 });
  assert.deepEqual(range('prefix tail', 7, 'prefiXtail'), { start: 5, end: 6 });
  assert.equal(range('prefix tail', 7, 'prefix tail'), null);
  assert.equal(context.getReplacementRange({}, 'text'), null);
});
