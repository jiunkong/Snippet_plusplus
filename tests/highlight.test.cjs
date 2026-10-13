const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({
  t: (key, args = []) => `${key}:${args.join(',')}`,
  currentConfig: { visualizeNewlines: false }
});
for (const file of ['utils/constants.js', 'options/highlight.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

test('set variable names containing a trigger argument name do not cause a false error', () => {
  const textarea = { value: '{{set $mty = substr($ty, 1, 2)}}\\{{$ty}}_{{{#0}}}{{#1}}' };
  const highlight = { innerHTML: '' };

  const error = context.updateHighlight(textarea, highlight, ';${ty:a?max|min}');

  assert.equal(error, '');
  assert.match(highlight.innerHTML, /substr\(/);
});

test('startswith and endswith validate exactly two top-level arguments', () => {
  const highlight = { innerHTML: '' };
  const valid = context.updateHighlight(
    { value: "{{startswith(substr($ty, 0, 2), 'ma')}} {{endswith($ty, 'ax')}}" },
    highlight,
    ';${ty:a?max|min}'
  );
  assert.equal(valid, '');

  const invalid = context.updateHighlight(
    { value: '{{startswith($ty)}}' },
    highlight,
    ';${ty:a?max|min}'
  );
  assert.equal(invalid, 'err_fn_two_args_exact:startswith');
});
