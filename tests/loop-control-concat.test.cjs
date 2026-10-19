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

test('break and continue retain partial output and skip subsequent effects', async () => {
  const ctx = engine();
  ctx.showSnippetToast = () => assert.fail('skipped effect executed');
  assertTemplateOutput(await ctx.processTemplate('{{for 5}}A{{break}}{{toast("bad", "red")}}{{endfor}}Z', {}), 'AZ');
  assertTemplateOutput(await ctx.processTemplate('{{for 3}}A{{continue}}{{toast("bad", "red")}}{{endfor}}Z', {}), 'AAAZ');
  assertTemplateOutput(await ctx.processTemplate('{{for 1~5}}{{if value == 2}}{{continue}}{{endif}}{{if value == 4}}{{break}}{{endif}}[{{value}}]{{endfor}}', {}), '[1][3]');
  assertTemplateOutput(await ctx.processTemplate('{{for 5~1}}{{if index == 2}}{{break}}{{endif}}{{value}}{{endfor}}', {}), '54');
});

test('loop signals pass through switch and if, target the nearest loop and clean local variables', async () => {
  const ctx = engine();
  const args = { index: 99, total: 0 };
  const template = '{{for 2}}O{{index}}{{for 3}}{{set $local = 1}}I{{index}}{{switch index}}{{case 0}}{{if true}}{{continue}}{{endif}}bad{{endcase}}{{default}}{{break}}{{enddefault}}{{endswitch}}bad{{endfor}}X{{index}}{{set $total += 1}}{{endfor}}';
  assertTemplateOutput(await ctx.processTemplate(template, args), 'O0I0I1X0O1I0I1X1');
  assert.deepEqual(args, { index: 99, total: 2 });
  assertTemplateOutput(await ctx.processTemplate('{{for 2}}{{set $local = 1}}{{continue}}{{endfor}}', {}), '');
  await assert.rejects(ctx.processTemplate('{{for 1}}{{set $local = 1}}{{break}}{{endfor}}{{$local}}', {}), error => error.messageKey === 'err_undefined_variable');
});

test('loop control outside a loop is rejected even in unexecuted blocks and called snippets', async () => {
  const ctx = engine();
  for (const template of ['{{break}}', '{{continue}}', '{{if false}}{{break}}{{endif}}', '{{for 0}}{{endfor}}{{continue}}']) {
    await assert.rejects(ctx.processTemplate(template, {}), error => error.messageKey === 'err_loop_control_outside_for');
  }
  await assert.rejects(ctx.processTemplate('{{for 1}}{{@helper()}}{{endfor}}', {}, {
    snippets: [{ name: 'helper', replacement: '{{break}}' }]
  }), error => error.messageKey === 'err_loop_control_outside_for');
  assertTemplateOutput(await ctx.processTemplate('{{for 2}}{{@helper()}}X{{endfor}}', {}, {
    snippets: [{ name: 'helper', replacement: '{{for 3}}H{{break}}{{endfor}}' }]
  }), 'HXHX');
});

test('list + and += return immutable lists without flattening or mutating inputs', async () => {
  const ctx = engine();
  const left = ctx.evaluateExpression('[1, [2]]', {});
  const right = ctx.evaluateExpression('["x", null, undefined]', {});
  const result = ctx.evaluateExpression('$a + $b + []', { a: left, b: right });
  assert.deepEqual(Array.from(result), [1, left[1], 'x', null, undefined]);
  assert.equal(String(left), '[1,[2]]');
  assert.equal(right.length, 3);
  assert.ok(Object.isFrozen(result));
  assert.notEqual(result, left);
  assert.equal(ctx.evaluateExpression('type([] + [])', {}), 'list');
  assert.equal(ctx.evaluateExpression('len([1] + [2, 3])', {}), 3);
  assert.equal(ctx.evaluateExpression('([1] + [2])[-1]', {}), 2);
  assertTemplateOutput(await ctx.processTemplate('{{set $items = [1]}}{{set $items += [2, 3]}}{{join($items, ",")}}', {}), '1,2,3');
  assert.equal(ctx.evaluateExpression('1 + 2 * 3', {}), 7);
  assert.equal(ctx.evaluateExpression('"a" + "b"', {}), 'ab');
  for (const expression of ['[] + 1', '"a" + []', '[] + null', '[1] + undefined']) {
    assert.throws(() => ctx.evaluateExpression(expression, {}), error => error.messageKey === 'err_list_concat_types');
  }
  await assert.rejects(ctx.processTemplate('{{set $items = []}}{{set $items += 1}}', {}), error => error.messageKey === 'err_list_concat_types');
});

test('loop tags highlight as keywords and report invalid locations; concatenation remains valid', () => {
  const ctx = engine();
  for (const tag of ['break', 'continue']) {
    const output = {};
    assert.equal(ctx.updateHighlight({ value: `{{for 3}}{{if true}}{{${tag}}}{{endif}}{{endfor}}` }, output), '');
    assert.match(output.innerHTML, new RegExp(`keyword-badge">${tag}`));
    assert.equal(ctx.updateHighlight({ value: `{{${tag}}}` }, output), `err_loop_control_outside_for:${tag}`);
    assert.match(output.innerHTML, /error-badge/);
  }
  assert.equal(ctx.updateHighlight({ value: '{{set $items = [1] + [2]}}{{set $items += [3]}}{{$items}}' }, {}), '');
});
