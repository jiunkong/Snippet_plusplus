const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ console });
for (const file of ['utils/constants.js', 'content/evaluator.js', 'content/template.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

test('if string predicates update an existing variable and CR-only continuations are removed', async () => {
  const template = [
    '{{set $mty = $ty}}\\',
    '{{if startswith($ty, "a")}}\\',
    '{{set $mty = substr($ty, 1, 3)}}\\arg\\',
    '{{endif}}\\',
    '\\{{$mty}}_{{{#0}}}{{#1}}'
  ].join('\r');

  const matched = await context.processTemplate(template, { ty: 'amax' });
  const unmatched = await context.processTemplate(template, { ty: 'max' });

  assert.equal(matched, '\\arg\\max_{{{#0}}}{{#1}}');
  assert.equal(unmatched, '\\max_{{{#0}}}{{#1}}');
});
