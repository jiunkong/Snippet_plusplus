const { assertTemplateOutput } = require('./helpers/fragment.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const root = path.join(__dirname, '..');
function engine() {
  const context = vm.createContext({ t: (key, values = []) => `${key}:${values.join(',')}` });
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/fragment.js', 'content/evaluator.js', 'content/template-parser.js', 'content/template.js', 'options/highlight.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('for visits list items with position and typed value, including empty and nested lists', async () => {
  const ctx = engine();
  assertTemplateOutput(await ctx.processTemplate('{{for [10, "x", null, undefined, [1, 2]]}}{{index}}:{{type(value)}}={{value}};{{endfor}}', {}), '0:number=10;1:string=x;2:null=;3:undefined=;4:list=[1,2];');
  assertTemplateOutput(await ctx.processTemplate('{{for []}}bad{{endfor}}done', {}), 'done');
  assertTemplateOutput(await ctx.processTemplate('{{for [[1,2],[3,4]]}}{{value[-1]}}{{endfor}}', {}), '24');
  assertTemplateOutput(await ctx.processTemplate('{{for split("a,b", ",")}}{{upper(value)}}{{endfor}}', {}), 'AB');
});

test('strings iterate code points, including numeric strings, without breaking emoji surrogate pairs', async () => {
  const ctx = engine();
  assertTemplateOutput(await ctx.processTemplate('{{for "A😊한"}}{{index}}:{{value}};{{endfor}}', {}), '0:A;1:😊;2:한;');
  assertTemplateOutput(await ctx.processTemplate('{{for ""}}bad{{endfor}}done', {}), 'done');
  assertTemplateOutput(await ctx.processTemplate('{{for $count}}{{value}}{{endfor}}', { count: '12' }), '12');
  assertTemplateOutput(await ctx.processTemplate('{{for num($count)}}x{{endfor}}', { count: '3' }), 'xxx');
  assertTemplateOutput(await ctx.processTemplate('{{for 2}}[{{index}}:{{value}}]{{endfor}}', {}), '[0:0][1:1]');
});

test('loop values are scoped, restored on control transfer and kept separate from captured variables', async () => {
  const ctx = engine();
  const args = { value: 'capture', index: 99 };
  const template = '{{for ["a", "b"]}}{{value}}{{for [1, 2]}}{{if index == 0}}{{continue}}{{endif}}{{value}}{{break}}{{endfor}}{{value}}:{{$value}};{{endfor}}';
  assertTemplateOutput(await ctx.processTemplate(template, args), 'a2a:capture;b2b:capture;');
  assert.deepEqual(Reflect.ownKeys(args), ['value', 'index']);
  assert.equal(args.index, 99);
  await assert.rejects(ctx.processTemplate('{{for [1]}}{{value}}{{endfor}}{{value}}', {}), error => error.messageKey === 'err_value_outside_for');
  const nestedArgs = {};
  await assert.rejects(ctx.processTemplate('{{for [1]}}{{$missing}}{{endfor}}', nestedArgs), error => error.messageKey === 'err_undefined_variable');
  assert.deepEqual(Reflect.ownKeys(nestedArgs), []);
});

test('loop values can be passed explicitly into functions but are not implicitly shared', async () => {
  const ctx = engine();
  const snippets = [{ name: 'echo', trigger: '/e ${item}', replacement: '{{$item}}' }, { name: 'hidden', replacement: '{{value}}' }];
  assertTemplateOutput(await ctx.processTemplate('{{for [1,2]}}{{@echo(value)}}{{endfor}}', {}, { snippets }), '12');
  await assert.rejects(ctx.processTemplate('{{for [1]}}{{@hidden()}}{{endfor}}', {}, { snippets }), error => error.messageKey === 'err_value_outside_for');
});

test('insertAt and removeAt preserve string type and use code point and negative indices', () => {
  const ctx = engine();
  for (const [source, expected] of [
    ['insertAt("AC", 1, "B")', 'ABC'], ['insertAt("ab", -1, "XY")', 'aXYb'],
    ['insertAt("A😊B", 2, "中")', 'A😊中B'], ['removeAt("A😊B", 1)', 'AB'],
    ['removeAt("A😊B", -1)', 'A😊'], ['insertAt("😊", 1, "!")', '😊!'],
    ['insertAt("", 0, 12)', '12'], ['insertAt("ab", 0, null)', 'ab'],
    ['insertAt("ab", 0, undefined)', 'ab'], ['insertAt("ab", 0, [1,2])', '[1,2]ab'],
    ['insertAt("ab", 3, "x")', 'ab'], ['insertAt("ab", -3, "x")', 'ab'],
    ['removeAt("ab", 2)', 'ab'], ['removeAt("ab", -3)', 'ab'], ['removeAt("", 0)', '']
  ]) {
    const result = ctx.evaluateExpression(source, {});
    assert.equal(result, expected, source);
    assert.equal(typeof result, 'string');
  }
  assert.equal(ctx.evaluateExpression('len("A😊B")', {}), 3);
  assert.equal(ctx.evaluateExpression('len(insertAt("A😊", len("A😊"), "B"))', {}), 3);
  assert.throws(() => ctx.evaluateExpression('removeAt("ab", "1")', {}), error => error.messageKey === 'err_list_index_integer');
});

test('ranges are readonly iterables with inclusive length and zero-based index separate from value', async () => {
  const ctx = engine();
  assert.equal(ctx.evaluateExpression('len(5~2)', {}), 4);
  assert.equal(ctx.evaluateExpression('len(2~2)', {}), 1);
  assert.equal(ctx.evaluateExpression('type(2~5)', {}), 'range');
  assertTemplateOutput(await ctx.processTemplate('{{for 3~1}}{{index}}:{{value}};{{endfor}}', {}), '0:3;1:2;2:1;');
  assertTemplateOutput(await ctx.processTemplate('{{for -2~0}}{{index}}:{{value}};{{endfor}}', {}), '0:-2;1:-1;2:0;');
  assertTemplateOutput(await ctx.processTemplate('{{for 3~3}}{{index}}:{{value}};{{endfor}}', {}), '0:3;');
  for (const source of ['insertAt(1~3, 1, 2)', 'removeAt(1~3, 0)']) {
    assert.throws(() => ctx.evaluateExpression(source, {}), error => error.messageKey === 'err_readonly_iterable');
  }
  assert.ok(ctx.isSnippetIterable('text'));
  assert.ok(ctx.isSnippetIterable([]));
  assert.ok(ctx.isSnippetIterable(ctx.evaluateExpression('1~3', {})));
  assert.equal(ctx.isSnippetIterable(3), false);
});

test('iterable loops and value keyword highlight correctly with capture names and scope validation', () => {
  const ctx = engine();
  const output = {};
  for (const value of ['{{for [1,2]}}{{value}}{{index}}{{endfor}}', '{{for "abc"}}{{insertAt(value, 0, "!")}}{{endfor}}', '{{for [[1]]}}{{value[0]}}{{endfor}}', '{{for 2~5}}{{value}}{{endfor}}']) {
    assert.equal(ctx.updateHighlight({ value }, output), '', value);
    assert.match(output.innerHTML, /hl-var">value/);
  }
  assert.equal(ctx.updateHighlight({ value: '{{$value}}' }, output, '/t ${value}'), '');
  for (const value of ['{{value}}', '{{upper(value)}}', '{{for []}}{{endfor}}{{value}}']) {
    assert.equal(ctx.updateHighlight({ value }, output), 'err_value_outside_for:', value);
    assert.match(output.innerHTML, /error-badge/);
  }
});

test('includes searches substrings and compares complete list elements without coercion', () => {
  const ctx = engine();
  for (const [source, expected] of [
    ['includes("abcd", "bc")', true], ['includes("abcd", "bd")', false],
    ['includes("a😊한", "😊한")', true], ['includes("abc", "")', true], ['includes("", "")', true],
    ['includes("", "a")', false], ['includes("123", 23)', true],
    ['includes([1, 2, 3], 2)', true], ['includes([1, 2, 3], "2")', false], ['includes([], 1)', false],
    ['includes([null, undefined, false], null)', true], ['includes([null, undefined, false], undefined)', true],
    ['includes([[1, 2], [3]], [1, 2])', true], ['includes([[1, 2]], [2, 1])', false],
    ['includes([2~5], 2~5)', true], ['includes([2~5], 5~2)', false]
  ]) assert.equal(ctx.evaluateExpression(source, {}), expected, source);
});

test('includes checks ascending, descending and huge ranges arithmetically', () => {
  const ctx = engine();
  for (const [source, expected] of [
    ['includes(2~5, 2)', true], ['includes(2~5, 5)', true], ['includes(2~5, 3)', true],
    ['includes(5~2, 3)', true], ['includes(-3~2, -1)', true], ['includes(3~3, 3)', true],
    ['includes(2~5, 1)', false], ['includes(2~5, 6)', false], ['includes(2~5, 2.5)', false],
    ['includes(2~5, "3")', false], ['includes(2~5, true)', false], ['includes(2~5, null)', false],
    ['includes(1~9007199254740991, 9007199254740991)', true],
    ['includes(9007199254740991~1, 9007199254740990)', true]
  ]) {
    let checks = 0;
    const execution = { check() { assert.ok(++checks < 40, 'range membership must not enumerate its elements'); } };
    assert.equal(ctx.evaluateExpression(source, {}, execution), expected, source);
  }
});

test('includes requires an iterable and two arguments, including explicit undefined values', () => {
  const ctx = engine();
  for (const source of ['includes(1, 1)', 'includes(true, true)', 'includes(null, 1)', 'includes(undefined, 1)']) {
    assert.throws(() => ctx.evaluateExpression(source, {}), error => error.messageKey === 'err_includes_iterable_target', source);
  }
  for (const source of ['includes()', 'includes([])', 'includes([], 1, 2)', 'includes(,1)', 'includes([],)', 'includes([], 1,)']) {
    assert.throws(() => ctx.evaluateExpression(source, {}), error => error.messageKey === 'err_fn_two_args_exact', source);
  }
  assert.equal(ctx.evaluateExpression('includes([undefined], undefined)', {}), true);
  assert.throws(() => ctx.evaluateExpression('includes([], $missing)', {}), error => error.messageKey === 'err_undefined_variable');
});
