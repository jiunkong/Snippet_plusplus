const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({ t: (key, args = []) => `${key}:${args.join(',')}`, currentConfig: { visualizeNewlines: false } });
for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js', 'options/highlight.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

test('list indexing uses zero-based and negative indices with variables and arithmetic', () => {
  const args = { items: context.evaluateExpression('[10, 20, 30]', {}), i: -2 };
  for (const [expression, expected] of [
    ['$items[0]', 10], ['$items[1]', 20], ['$items[2]', 30],
    ['$items[-1]', 30], ['$items[-2]', 20], ['$items[-3]', 10], ['$items[-0]', 10],
    ['$items[$i]', 20], ['$items[len($items) - 1]', 30], ['$items[1 + 1] * 2', 60],
    ['[10, 20, 30][-1]', 30], ['($items)[-1]', 30]
  ]) assert.equal(context.evaluateExpression(expression, args), expected, expression);
  assert.equal(String(args.items), '[10,20,30]', 'reading does not mutate the list');
});

test('nested indexing and list-returning builtins compose with other expressions', () => {
  for (const [expression, expected] of [
    ['[[1, 2], [3, 4]][1][0]', 3], ['[[1, 2], [3, 4]][-1][-1]', 4],
    ['split("red,blue", ",")[-1]', 'blue'], ['upper(split("red,blue", ",")[0])', 'RED'],
    ['[10, 20, 30][[0, 2][-1]]', 30], ['len([[1, 2], [3]][0])', 2],
    ['type([null][0])', 'null'], ['type([undefined][0])', 'undefined']
  ]) assert.equal(context.evaluateExpression(expression, {}), expected, expression);
});

test('out-of-range integer indices return undefined, including empty lists', async () => {
  for (const expression of ['[1,2][2]', '[1,2][-3]', '[][0]', '[][-1]', '[1][9007199254740991]']) {
    assert.equal(context.evaluateExpression(expression, {}), undefined, expression);
    assert.equal(await context.processTemplate(`before{{${expression}}}after`, {}), 'beforeafter');
  }
  assert.equal(await context.processTemplate('{{type([1][9])}}', {}), 'undefined');
});

test('invalid indices fail with localized errors and captured numeric strings require conversion', () => {
  const args = { items: context.evaluateExpression('[10,20]', {}), i: '1' };
  for (const index of ['', '1,2', '1,', '0.5', 'true', 'null', 'undefined', '"0"', '[0]', '1/0', '9007199254740992']) {
    assert.throws(() => context.evaluateExpression(`$items[${index}]`, args), error => error.messageKey === 'err_list_index_integer', index);
  }
  assert.throws(() => context.evaluateExpression('$items[$i]', args), error => error.messageKey === 'err_list_index_integer');
  assert.equal(context.evaluateExpression('$items[num($i)]', args), 20);
  assert.throws(() => context.evaluateExpression('$value[0]', { value: 123 }), error => error.messageKey === 'err_list_index_target');
  assert.throws(() => context.evaluateExpression('$missing[0]', {}), error => error.messageKey === 'err_undefined_variable');
});

test('indices work in snippet arguments, cursor offsets and loops', async () => {
  const library = { snippets: [{ name: 'echo', trigger: '/echo ${text}', replacement: '{{$text}}{{cursor}}' }] };
  assert.equal(await context.processTemplate('{{@echo(split("red,blue", ",")[-1])<[1,2][-1]>}}', {}, library), 'blue{{#2}}');
  assert.equal(await context.processTemplate('{{set $items = [10,20,30]}}{{for 3}}{{$items[index]}} {{endfor}}', {}), '10 20 30 ');
  assert.equal(await context.processTemplate('{{set $items = [[1,2], [3,4]]}}{{$items[-1][0]}}', {}), '3');
});

test('string indexing reads code points from literals, variables, function results and nested values', () => {
  const args = { text: 'A😊한', i: -2 };
  for (const [expression, expected] of [
    ['"abc"[0]', 'a'], ["'abc'[-1]", 'c'], ['$text[1]', '😊'], ['$text[$i]', '😊'],
    ['"A😊한"[-1]', '한'], ['"A😊한"[-3]', 'A'], ['upper("abc")[1]', 'B'],
    ['["ab", "cd"][1][-1]', 'd'], ['"abc"[1][0]', 'b'],
    ['"a" + "bc"[0]', 'ab'], ['"a,b[0]"[1]', ','],
    ['"abc"[3]', undefined], ['"A😊한"[-4]', undefined], ['""[0]', undefined],
    ['type("abc"[0])', 'string'], ['len("A😊한"[1])', 1]
  ]) assert.equal(context.evaluateExpression(expression, args), expected, expression);
  for (const index of ['true', '"1"', '0.5', 'null', 'undefined']) {
    assert.throws(() => context.evaluateExpression(`$text[${index}]`, args), error => error.messageKey === 'err_list_index_integer');
  }
});

test('range indexing reads ascending and descending ranges without allocating their items', () => {
  const args = { range: context.evaluateExpression('5~2', {}) };
  for (const [expression, expected] of [
    ['(2~5)[0]', 2], ['(2~5)[2]', 4], ['(2~5)[-1]', 5], ['(2~5)[-4]', 2],
    ['$range[0]', 5], ['$range[1]', 4], ['$range[-1]', 2], ['$range[-4]', 5],
    ['$range[4]', undefined], ['$range[-5]', undefined], ['(3~3)[0]', 3],
    ['[2~5][0][-1]', 5], ['(1~9007199254740991)[-1]', 9007199254740991],
    ['(-9007199254740991~-1)[-1]', -1],
    ['(9007199254740991~1)[-1]', 1], ['type($range[0])', 'number']
  ]) assert.equal(context.evaluateExpression(expression, args), expected, expression);
  for (const target of [123, true, null, undefined]) {
    assert.throws(() => context.evaluateExpression('$target[0]', { target }), error => error.messageKey === 'err_list_index_target');
  }
});

test('iterable indexing works in loops, snippet parameters, dynamic cursors and highlighting', async () => {
  const value = '{{for ["A😊", 2~5]}}{{value[-1]}}{{endfor}}';
  assert.equal(await context.processTemplate(value, {}), '😊5');
  const snippets = [{ name: 'echo', trigger: '/e ${item}', replacement: '{{$item}}' }];
  assert.equal(await context.processTemplate('{{@echo("abc"[1])}}{{#(2~5)[-1]}}', {}, { snippets }), 'b{{#5}}');
  for (const source of [value, '{{"A😊"[1]}}', "{{'abc'[-1]}}", '{{(5~2)[1]}}', '{{set $r = 1~3}}{{$r[-1]}}', '{{upper("ab")[0]}}']) {
    const output = {};
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.doesNotMatch(output.innerHTML, /error-badge|hl-fn-err/, source);
  }
});

test('index highlighting preserves list colors and reports invalid index syntax', () => {
  const highlight = { innerHTML: '' };
  for (const value of ['{{set $items = [1,2]}}{{$items[0]}} / {{$items[-1]}}', '{{[[1,2],[3,4]][-1][0]}}',
    '{{split("a,b", ",")[-1]}}', '{{set $items = [1,2]}}{{$items[len($items)-1]}}']) {
    assert.equal(context.updateHighlight({ value }, highlight), '', value);
    assert.match(highlight.innerHTML, /class="hl-list">\[/);
    assert.doesNotMatch(highlight.innerHTML, /error-badge|hl-fn-err/);
  }
  for (const index of ['', '1,2', '1,', '0.5', 'true', 'null', 'undefined', '"0"']) {
    assert.equal(context.updateHighlight({ value: `{{set $items = [1]}}{{$items[${index}]}}` }, highlight), 'err_list_index_integer:', index);
  }
  assert.equal(context.updateHighlight({ value: '{{$missing[0]}}' }, highlight), 'err_undefined_variable:$missing');
});

test('non-iterable literals report the indexing error without exposing temporary variable names', async () => {
  for (const source of ['2[0]', '2.5[0]', '.5[0]', '-2[0]', '1e3[0]', 'true[0]', 'false[0]', 'null[0]', 'undefined[0]', '(2)[0]', '((false))[0]', 'len("ab")[0]']) {
    await assert.rejects(context.processTemplate(`{{${source}}}`, {}), error => {
      assert.equal(error.messageKey, 'err_list_index_target', source);
      assert.doesNotMatch(error.message, /__expressionValue|__snippetValue/, source);
      assert.deepEqual(Array.from(error.messageValues), [], source);
      return true;
    });
  }
  assert.throws(() => context.evaluateExpression('unknown[0]', {}), error => error.messageKey === 'err_unknown_tag' && error.messageValues[0] === 'unknown');
});

test('highlighting rejects direct non-iterable literals but does not infer variable values', () => {
  const output = {};
  for (const source of ['2[0]', '2.5[0]', '.5[0]', '-2[0]', '1e3[0]', 'true[0]', 'false[0]', 'null[0]', 'undefined[0]', '(2)[0]', '((false))[0]', '2 [0]', 'upper(true[0])']) {
    assert.equal(context.updateHighlight({ value: `{{${source}}}` }, output), 'err_list_index_target:', source);
    assert.match(output.innerHTML, /error-badge/, source);
  }
  for (const source of ['{{set $a = 2}}{{$a[0]}}', '{{set $flag = true}}{{$flag[0]}}', '{{set $v}}{{$v[0]}}', '{{"a"[0]}}', '{{[1,2][0]}}', '{{(1~2)[0]}}', '{{upper("abc")[0]}}', '{{max(1,2)[0]}}']) {
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.doesNotMatch(output.innerHTML, /error-badge|hl-fn-err/, source);
  }
});

test('empty grouping before indexing is an error while zero-argument calls remain valid', async () => {
  const output = {};
  for (const source of ['()[1]', '( )[0]', '(())[0]', 'upper(())[0]', '[()][0]']) {
    assert.equal(context.updateHighlight({ value: `{{${source}}}` }, output), 'err_missing_operand:()', source);
    assert.match(output.innerHTML, /error-badge/, source);
    await assert.rejects(context.processTemplate(`{{${source}}}`, {}), error => error.messageKey === 'err_missing_operand');
  }
  const library = [{ name: 'hello', trigger: '', replacement: 'text' }, { name: 'hello world', trigger: '', replacement: 'text' }];
  for (const source of ['{{paste()[0]}}', '{{@hello()}}', '{{@hello<2>()}}', '{{@hello()<2>}}', '{{@"hello world"<2>()}}', '{{upper("")[0]}}']) {
    assert.equal(context.updateHighlight({ value: source }, output, '', library), '', source);
    assert.doesNotMatch(output.innerHTML, /error-badge|hl-fn-err/, source);
  }
});
