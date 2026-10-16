const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function engine() {
  const context = vm.createContext({ t: (key, values = []) => `${key}:${values.join(',')}` });
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js', 'options/highlight.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('insertAt inserts one value before an index, accepts negatives and can append', () => {
  const ctx = engine();
  for (const [expr, expected] of [
    ['insertAt([1, 3], 1, 2)', '[1,2,3]'],
    ['insertAt([1, 3], 0, 0)', '[0,1,3]'],
    ['insertAt([1, 3], -1, 2)', '[1,2,3]'],
    ['insertAt([1, 3], -2, 0)', '[0,1,3]'],
    ['insertAt([1, 3], 2, 4)', '[1,3,4]'],
    ['insertAt([], 0, [1, 2])', '[[1,2]]'],
    ['insertAt([1], 0, undefined)', '[undefined,1]'],
    ['insertAt([1], 0, null)', '[null,1]'],
    ['insertAt([1], 0, "text")', '["text",1]']
  ]) assert.equal(String(ctx.evaluateExpression(expr, {})), expected, expr);
  assert.equal(ctx.evaluateExpression('insertAt([1], 0, 2)[0]', {}), 2);
});

test('removeAt removes only one item and returns an unchanged new list out of bounds', () => {
  const ctx = engine();
  assert.equal(String(ctx.evaluateExpression('removeAt([1, 2, 2, 3], 1)', {})), '[1,2,3]');
  assert.equal(String(ctx.evaluateExpression('removeAt([1, 2, 3], -1)', {})), '[1,2]');
  assert.equal(String(ctx.evaluateExpression('removeAt([1, 2, 3], -3)', {})), '[2,3]');
  const list = ctx.evaluateExpression('[1, 2]', {});
  for (const expression of ['removeAt($list, 2)', 'removeAt($list, -3)', 'insertAt($list, 3, 0)', 'insertAt($list, -3, 0)']) {
    const result = ctx.evaluateExpression(expression, { list });
    assert.equal(String(result), '[1,2]');
    assert.notEqual(result, list);
    assert.ok(Object.isFrozen(result));
  }
  assert.equal(String(ctx.evaluateExpression('removeAt([], -1)', {})), '[]');
  assert.equal(String(ctx.evaluateExpression('insertAt([], -1, 1)', {})), '[]');
  assert.equal(String(list), '[1,2]');
});

test('list editing validates targets, integer indexes and exact arity', () => {
  const ctx = engine();
  for (const name of ['insertAt', 'removeAt']) {
    const suffix = name === 'insertAt' ? ', 1' : '';
    for (const target of ['1', 'null', 'undefined']) {
      assert.throws(() => ctx.evaluateExpression(`${name}(${target}, 0${suffix})`, {}), error => error.messageKey === 'err_iterable_function_target');
    }
    assert.throws(() => ctx.evaluateExpression(`${name}(1~2, 0${suffix})`, {}), error => error.messageKey === 'err_readonly_iterable');
    for (const index of ['"1"', '0.5', 'true', 'null', 'undefined', '[]', '9007199254740992']) {
      assert.throws(() => ctx.evaluateExpression(`${name}([], ${index}${suffix})`, {}), error => error.messageKey === 'err_list_index_integer');
    }
  }
  for (const expr of ['insertAt()', 'insertAt([], 0)', 'insertAt([], 0, 1, 2)', 'insertAt([], 0,)', 'removeAt([])', 'removeAt([], 0, 1)', 'removeAt([], 0,)']) {
    assert.throws(() => ctx.evaluateExpression(expr, {}), error => error.messageKey === 'err_function_arguments');
  }
});

test('list subtraction removes all matches by value, preserves order and original lists', async () => {
  const ctx = engine();
  const args = { list: ctx.evaluateExpression('[1, 2, 2, "2", null, undefined, [3], 1~2]', {}) };
  const result = ctx.evaluateExpression('$list - [2, null, [3], 1~2]', args);
  assert.equal(String(result), '[1,"2",undefined]');
  assert.ok(Object.isFrozen(result));
  assert.equal(args.list.length, 8);
  assert.equal(String(ctx.evaluateExpression('[1, 2] - [] - [1]', {})), '[2]');
  assert.equal(ctx.evaluateExpression('10 - 3 - 2', {}), 5);
  assert.equal(ctx.evaluateExpression('"10" - 3', {}), 7);
  assert.equal(await ctx.processTemplate('{{set $items = [1, 2, 2, 3]}}{{set $items -= [2]}}{{$items}}', {}), '[1,3]');
  for (const expr of ['[] - 1', '1 - []', '[] - null', '"a" - []']) {
    assert.throws(() => ctx.evaluateExpression(expr, {}), error => error.messageKey === 'err_list_subtract_types');
  }
});

test('list editing composes with async snippet arguments and leaves the source unchanged', async () => {
  const ctx = engine();
  const snippets = [{ name: 'echo', trigger: '/e ${value}', replacement: '{{$value}}' }];
  const args = { items: ctx.evaluateExpression('[1, 2]', {}), index: '1' };
  assert.equal(await ctx.processTemplate('{{@echo(insertAt($items, num($index), "x"))}}|{{@echo(removeAt($items, -1))}}|{{$items}}', args, { snippets }), '[1,"x",2]|[1]|[1,2]');
});

test('editing functions highlight as builtins and validate counts and empty arguments', () => {
  const ctx = engine();
  const output = {};
  assert.equal(ctx.updateHighlight({ value: '{{removeAt(insertAt([1, 2], -1, 3), 0)}}' }, output), '');
  assert.match(output.innerHTML, /hl-fn">insertAt\(/);
  assert.match(output.innerHTML, /hl-fn">removeAt\(/);
  for (const value of ['{{insertAt([], 0)}}', '{{insertAt([], , 1)}}', '{{insertAt([], 0, 1,)}}', '{{removeAt([])}}', '{{removeAt([], 0,)}}']) {
    assert.notEqual(ctx.updateHighlight({ value }, output), '', value);
    assert.match(output.innerHTML, /hl-fn-err/, value);
  }
  assert.equal(ctx.updateHighlight({ value: '{{set $items = [1, 2]}}{{set $items -= [2]}}{{$items - [1]}}' }, output), '');
});
