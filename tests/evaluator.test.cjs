const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({});
for (const file of ['utils/constants.js', 'content/evaluator.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

test('startswith and endswith compare strings and accept variables', () => {
  const args = { text: 'Snippet++', prefix: 'Sni', suffix: '++' };

  assert.equal(context.evaluateExpression('startswith($text, $prefix)', args), true);
  assert.equal(context.evaluateExpression('startswith($text, "sni")', args), false);
  assert.equal(context.evaluateExpression('endswith($text, $suffix)', args), true);
  assert.equal(context.evaluateExpression('endswith($text, "++!")', args), false);
  assert.equal(context.evaluateExpression("startswith(substr($text, 0, 3), 'Sni')", args), true);
});
