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

test('list literals support empty, mixed and nested values with normal expression precedence', () => {
  for (const [source, output] of [
    ['[]', '[]'], ['[1, 2, 3]', '[1,2,3]'],
    ['[1 + 2, -4, max(2, 5)]', '[3,-4,5]'],
    ['["a,b", "[text]", true, null, undefined]', '["a,b","[text]",true,null,undefined]'],
    ['[$value, [2, [3]], 2~5]', '[7,[2,[3]],2~5]'],
    ['[true ? 1 : 2, false || true]', '[1,true]'],
    ['true ? [1, 2] : [3]', '[1,2]']
  ]) {
    const list = context.evaluateExpression(source, { value: 7 });
    assert.equal(Array.isArray(list), true, source);
    assert.equal(String(list), output, source);
    assert.equal(Object.isFrozen(list), true);
  }
  assert.equal(context.evaluateExpression('type([1, 2])', {}), 'list');
  assert.equal(context.evaluateExpression('len([1, [2, 3]])', {}), 2);
  assert.equal(context.evaluateExpression('len([])', {}), 0);
  assert.equal(context.evaluateExpression('str(["a", 2])', {}), '["a",2]');
  assert.equal(context.evaluateExpression('len("[1,2]")', {}), 5);
});

test('lists retain their type in variables and snippet parameters and work alongside cursor offsets', async () => {
  assert.equal(await context.processTemplate('{{set $items = [1, 2, 3]}}{{type($items)}} / {{len($items)}} / {{$items}}', {}), 'list / 3 / [1,2,3]');
  const library = { snippets: [{ name: 'show', trigger: '/show ${items}', replacement: '{{type($items)}}:{{len($items)}}:{{$items}}{{cursor}}' }] };
  for (const call of ['@show([1, 2])<3>', '@show<3>([1, 2])', '@show<1 + len([1, 2])>([1, 2])']) {
    assert.equal(await context.processTemplate(`{{${call}}}`, {}, library), 'list:2:[1,2]{{#3}}', call);
  }
});

test('list items can contain async calls without interpreting their returned text as code', async () => {
  context.showSnippetPrompt = async () => 'Guest';
  try {
    assert.equal(await context.processTemplate('{{[1, prompt("Name"), 3]}}', {}), '[1,"Guest",3]');
    context.showSnippetPrompt = async () => '[1,2], unknown()';
    assert.equal(await context.processTemplate('{{[prompt("Name")]}}', {}), '["[1,2], unknown()"]');
  } finally { delete context.showSnippetPrompt; }
});

test('invalid lists and missing variables fail instead of creating sparse or incomplete lists', async () => {
  for (const source of ['[1,', '[1,2', '1]', '[1,,2]', '[,1]', '[1,]', '[(1]]', '[[1],]']) {
    assert.throws(() => context.evaluateExpression(source, {}), error => error.messageKey === 'err_list_syntax', source);
    await assert.rejects(context.processTemplate(`{{${source}}}`, {}), error => error.messageKey === 'err_list_syntax', source);
  }
  assert.throws(() => context.evaluateExpression('[$missing]', {}), error => error.messageKey === 'err_undefined_variable');
});

test('list highlighting handles nested expressions and validates brackets and missing elements', () => {
  for (const value of ['{{[]}}', '{{[1, 2, 3]}}', '{{set $items = [1, [2, 3]]}}{{len($items)}}', '{{type([true, null, undefined])}}', '{{["a,b", max(1, 2), 2~5]}}']) {
    const highlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value }, highlight), '', value);
    assert.match(highlight.innerHTML, /class="hl-list">\[/, value);
    assert.doesNotMatch(highlight.innerHTML, /error-badge|hl-fn-err/, value);
  }
  for (const source of ['[1,', '[1,2', '1]', '[1,,2]', '[,1]', '[1,]', '[(1]]']) {
    assert.equal(context.updateHighlight({ value: `{{${source}}}` }, { innerHTML: '' }), 'err_list_syntax:', source);
  }
  assert.equal(context.updateHighlight({ value: '{{[$missing]}}' }, { innerHTML: '' }), 'err_undefined_variable:$missing');
  const library = [{ name: 'show', trigger: '/show ${items}' }];
  assert.equal(context.updateHighlight({ value: '{{@show<2>([1, 2])}}' }, { innerHTML: '' }, '', library), '');
  assert.equal(context.updateHighlight({ value: '{{@show([1, 2], 3)}}' }, { innerHTML: '' }, '', library), 'err_snippet_call_args:show,1');
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: '{{[1, max(2, 3), "a,b"]}} {{max(4, 5)}}' }, highlight), '');
  assert.deepEqual([...highlight.innerHTML.matchAll(/class="hl-list">([^<]*)<\/span>/g)].map(match => match[1]), ['[', ',', ',', ']']);
  assert.equal(context.updateHighlight({ value: '{{@show<2>([1, 2])}}' }, highlight, '', library), '');
  assert.deepEqual([...highlight.innerHTML.matchAll(/class="hl-list">([^<]*)<\/span>/g)].map(match => match[1]), ['[', ',', ']']);
});

test('split creates list values with literal separators and preserves empty fields', () => {
  for (const [source, expected] of [
    ['split("red,blue,green", ",")', '["red","blue","green"]'],
    ['split("a,,b,", ",")', '["a","","b",""]'],
    ['split("a.b.c", ".")', '["a","b","c"]'],
    ['split("hello", "|")', '["hello"]'],
    ['split("abc", "")', '["a","b","c"]'],
    ['split("", "")', '[]'], ['split("", ",")', '[""]'],
    ['split($text, $separator)', '["a","b"]']
  ]) {
    const value = context.evaluateExpression(source, { text: 'a::b', separator: '::' });
    assert.equal(String(value), expected, source);
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(context.evaluateExpression('type(split("a,b", ","))', {}), 'list');
  assert.equal(context.evaluateExpression('len(split("a,b", ","))', {}), 2);
});

test('join combines list values with a string separator and validates the list type', () => {
  for (const [source, expected] of [
    ['join(["red", "blue"], " / ")', 'red / blue'],
    ['join([1, 2, 3], "")', '123'], ['join([], ",")', ''],
    ['join([null, undefined, false, 0], "|")', '||false|0'],
    ['join([[1, 2], 3~5], ";")', '[1,2];3~5'],
    ['join(split("a,,b", ","), "|")', 'a||b']
  ]) assert.equal(context.evaluateExpression(source, {}), expected, source);
  for (const value of ['"text"', '42', 'null', 'undefined', '2~5']) {
    assert.throws(() => context.evaluateExpression(`join(${value}, ",")`, {}), error => error.messageKey === 'err_join_list_required');
  }
});

test('split and join compose with async text, stored variables and snippet function parameters', async () => {
  assert.equal(await context.processTemplate('{{set $items = split($text, ",")}}{{join($items, " / ")}}', { text: 'a,b,c' }), 'a / b / c');
  const library = { snippets: [{ name: 'show', trigger: '/show ${items}', replacement: '{{join($items, "|")}}{{cursor}}' }] };
  assert.equal(await context.processTemplate('{{@show(split("a,b", ","))<2>}}', {}, library), 'a|b{{#2}}');
  context.navigator = { clipboard: { readText: async () => 'a,b,unknown()' } };
  try {
    assert.equal(await context.processTemplate('{{join(split(paste(), ","), "|")}}', {}), 'a|b|unknown()');
  } finally { delete context.navigator; }
});

test('split and join highlight builtins and reject wrong counts or empty arguments', () => {
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: '{{join(split("a,b", ","), "|")}}' }, highlight), '');
  assert.match(highlight.innerHTML, /class="hl-fn">split\(/);
  assert.match(highlight.innerHTML, /class="hl-fn">join\(/);
  for (const name of ['split', 'join']) {
    for (const args of ['', '"one"', '"a", "b", "c"', ', "b"', '"a",']) {
      const value = `{{${name}(${args})}}`;
      assert.equal(context.updateHighlight({ value }, highlight), `err_fn_two_args_exact:${name}`, value);
      assert.throws(() => context.evaluateExpression(`${name}(${args})`, {}), error => error.messageKey === 'err_function_arguments');
    }
  }
});
