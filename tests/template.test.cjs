const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ console });
for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js']) {
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

function library() {
  return { snippets: [
    { name: '인사', trigger: '/hello ${name} ${count:\\d+}', replacement: '{{$name}}:{{$count + 1}}{{#0}}' },
    { name: 'Wrapper', trigger: '/wrap ${person}', replacement: '{{@인사($person, 2)}}' },
    { name: 'Constant', trigger: '', replacement: 'Shared body' }
  ] };
}

test('unterminated template strings report the localized string error', async () => {
  for (const value of ['{{"sdf}}', "{{'sdf}}", '{{upper("sdf)}}', '{{@"hello world()}}', '{{"', String.raw`{{"sdf\"}}`]) {
    await assert.rejects(context.processTemplate(value, {}), error => error.messageKey === 'err_unclosed_string', value);
  }
  assert.equal(await context.processTemplate('{{upper("}}")}}', {}), '}}');
  assert.equal(await context.processTemplate(String.raw`{{upper("a\"b")}}`, {}), String.raw`A\"B`);
});

test('snippet calls bind ordered trigger captures and isolate their variables', async () => {
  const args = { name: 'caller', person: 'unrelated' };
  const text = '{{@인사("지운", 3)}}|{{@Wrapper("민수")}}|{{@Constant()}}|{{$name}}';
  assert.equal(await context.processTemplate(text, args, library()), '지운:4{{#0}}|민수:3{{#0}}|Shared body|caller');
  assert.deepEqual(args, { name: 'caller', person: 'unrelated' });
});

test('snippet results compose with functions, assignments, loops and conditions', async () => {
  const ctx = { snippets: [{ name: 'Value', trigger: '/v ${x}', replacement: '{{$x}}' }] };
  const text = '{{set $n = @Value(2)}}{{for num($n)}}{{if @Value(index) == "1"}}{{upper(@Value("ok"))}}{{endif}}{{endfor}}';
  assert.equal(await context.processTemplate(text, {}, ctx), 'OK');
  assert.equal(await context.processTemplate('{{switch @Value("x")}}{{case @Value("x")}}yes{{endcase}}{{endswitch}}', {}, ctx), 'yes');
});

test('call results remain literal data including quotes, function text and template syntax', async () => {
  const value = `O'Reilly "(x)" \\ {{@Missing()}} prompt('ignore')`;
  const ctx = { snippets: [{ name: 'Literal', trigger: '', replacement: '{{$value}}' },
    { name: 'Echo', trigger: '/echo ${value}', replacement: '{{$value}}' }] };
  assert.equal(await context.processTemplate('{{@Echo($text)}}', { text: value }, ctx), value);
  assert.equal(await context.processTemplate('{{upper(@Echo($text))}}', { text: value }, ctx), value.toUpperCase());
  assert.equal(await context.processTemplate(`{{"@Missing()"}}`, {}, ctx), "@Missing()");
});

test('calls reject missing names, duplicate names and wrong argument counts', async () => {
  await assert.rejects(context.processTemplate('{{@Absent()}}', {}, library()), /err_snippet_call_target/);
  await assert.rejects(context.processTemplate('{{@인사("one")}}', {}, library()), /err_snippet_call_args/);
  await assert.rejects(context.processTemplate('{{@Constant(1)}}', {}, library()), /err_snippet_call_args/);
  await assert.rejects(context.processTemplate('{{@()}}', {}, library()), /err_snippet_call_syntax/);
  const ctx = { snippets: [{ name: 'Same' }, { name: 'Same' }] };
  await assert.rejects(context.processTemplate('{{@Same()}}', {}, ctx), /err_snippet_call_target/);
});

test('direct and indirect recursion stop at the configured depth', async () => {
  for (const snippets of [
    [{ name: 'A', replacement: '{{@A()}}' }],
    [{ name: 'A', replacement: '{{@B()}}' }, { name: 'B', replacement: '{{@A()}}' }]
  ]) await assert.rejects(context.processTemplate('{{@A()}}', {}, { snippets, maxCallDepth: 4 }), error => error.messageKey === 'err_snippet_call_depth' && error.messageValues[0] === '4');
  assert.equal(await context.processTemplate('{{@Constant()}}{{@Constant()}}', {}, library()), 'Shared bodyShared body');
});

test('callee variables remain local and missing caller/callee variables are errors', async () => {
  const ctx = { snippets: [{ name: 'Scoped', trigger: '/s ${x}', replacement: '{{set $x = "changed"}}{{set $temp = 1}}{{$x}}' }] };
  assert.equal(await context.processTemplate('{{@Scoped($x)}}|{{$x}}', { x: 'caller' }, ctx), 'changed|caller');
  await assert.rejects(context.processTemplate('{{@Scoped($x)}}{{$temp}}', { x: 'caller' }, ctx),
    error => error.messageKey === 'err_undefined_variable' && error.messageValues[0] === '$temp');
  ctx.snippets[0].replacement = '{{$outer}}';
  await assert.rejects(context.processTemplate('{{@Scoped("x")}}', { outer: 'hidden' }, ctx),
    error => error.messageKey === 'err_undefined_variable' && error.messageValues[0] === '$outer');
});

test('nested prompt cancellation aborts the entire calling template', async () => {
  context.showSnippetPrompt = async () => '';
  try {
    const ctx = { snippets: [{ name: 'Ask', trigger: '', replacement: 'prefix {{prompt("Name?")}} suffix' }] };
    await assert.rejects(context.processTemplate('outer {{@Ask()}}', {}, ctx), { name: 'SnippetPromptCancelled' });
  } finally { delete context.showSnippetPrompt; }
});

test('trigger compilation and function parameters agree for multiple captures', () => {
  const trigger = '/sum ${left} ${right:\\d+}';
  assert.deepEqual(Array.from(context.snippetParameterNames(trigger)), ['left', 'right']);
  const compiled = context.compileTrigger(trigger);
  assert.equal(compiled.isRegex, true);
  const match = '/sum apples 42'.match(compiled.regex);
  assert.equal(match.groups.left, 'apples');
  assert.equal(match.groups.right, '42');
});

test('async values passed into snippets remain literal and quote-aware', async () => {
  const received = [];
  context.showSnippetPrompt = async message => { received.push(message); return "A's (answer)"; };
  context.showSnippetChoice = async (title, options) => { received.push([title, ...options]); return options[0]; };
  context.navigator = { clipboard: { readText: async () => "clipboard('text')" } };
  const ctx = { snippets: [{ name: 'Echo', trigger: '/e ${text}', replacement: '{{$text}}' }] };
  try {
    assert.equal(await context.processTemplate('{{@Echo(prompt("Name (full)?"))}}', {}, ctx), "A's (answer)");
    assert.equal(await context.processTemplate('{{choice("Pick (one)", @Echo("one"), "two")}}', {}, ctx), 'one');
    assert.equal(await context.processTemplate('{{@Echo(paste())}}', {}, ctx), "clipboard('text')");
    assert.deepEqual(JSON.parse(JSON.stringify(received)), ['Name (full)?', ['Pick (one)', 'one', 'two']]);
  } finally {
    delete context.showSnippetPrompt;
    delete context.showSnippetChoice;
    delete context.navigator;
  }
});

test('call depth is bounded but sequential calls are only limited by execution time', async () => {
  const snippets = Array.from({ length: 34 }, (_, i) => ({ name: `S${i}`, replacement: `{{@S${i + 1}()}}` }));
  await assert.rejects(context.processTemplate('{{@S0()}}', {}, { snippets }), /err_snippet_call_depth/);
  assert.equal(await context.processTemplate('{{for 1001}}{{@Constant()}}{{endfor}}', {}, { ...library(), maxExecutionMs: 60000, maxCallDepth: 1 }), 'Shared body'.repeat(1001));
});

test('recursive calls can terminate and arguments also count toward nesting depth', async () => {
  const snippets = [
    { name: 'A', trigger: '/a ${n}', replacement: '{{if $n > 0}}{{$n}}{{@A($n - 1)}}{{endif}}' },
    { name: 'Echo', trigger: '/e ${text}', replacement: '{{$text}}' }
  ];
  assert.equal(await context.processTemplate('{{@A(4)}}', {}, { snippets, maxCallDepth: 5 }), '4321');
  await assert.rejects(context.processTemplate('{{@A(4)}}', {}, { snippets, maxCallDepth: 4 }), /err_snippet_call_depth/);
  assert.equal(await context.processTemplate('{{@Echo(@Echo("ok"))}}', {}, { snippets, maxCallDepth: 2 }), 'ok');
  await assert.rejects(context.processTemplate('{{@Echo(@Echo("ok"))}}', {}, { snippets, maxCallDepth: 1 }), /err_snippet_call_depth/);
  assert.equal(await context.processTemplate('{{@Echo("ok")}}', {}, { snippets, maxCallDepth: 1 }), 'ok');
  for (const value of [undefined, null, 0, -1, 1.5, '4', 257, Infinity]) {
    assert.equal(context.normalizeSnippetCallDepth(value), 32);
  }
  assert.equal(context.normalizeSnippetCallDepth(256), 256);
});

test('mutual recursion and depths above the former hard limit can complete', async () => {
  const snippets = [
    { name: 'A', trigger: '/a ${n}', replacement: '{{if $n > 0}}A{{@B($n - 1)}}{{endif}}' },
    { name: 'B', trigger: '/b ${n}', replacement: '{{if $n > 0}}B{{@A($n - 1)}}{{endif}}' }
  ];
  assert.equal(await context.processTemplate('{{@A(40)}}', {}, { snippets, maxCallDepth: 41 }), 'AB'.repeat(20));
  await assert.rejects(context.processTemplate('{{@A(40)}}', {}, { snippets, maxCallDepth: 32 }), /err_snippet_call_depth/);
  assert.equal(await context.processTemplate('{{@A(255)}}', {}, { snippets, maxCallDepth: 256, maxExecutionMs: 60000 }), 'AB'.repeat(127) + 'A');
  context.config = { maxCallDepth: 2 };
  try {
    await assert.rejects(context.processTemplate('{{@A(3)}}', {}, { snippets }), error => error.messageKey === 'err_snippet_call_depth' && error.messageValues[0] === '2');
  } finally { delete context.config; }
});

test('@ functions accept Korean identifiers and stay separate from built-in functions', async () => {
  const ctx = { snippets: [
    { name: 'hello', trigger: '/hello ${name}', replacement: 'Hello {{$name}}!' },
    { name: 'upper', trigger: '/upper ${text}', replacement: 'custom {{$text}}' },
    { name: '_인사2', trigger: '/hi ${name}', replacement: '안녕 {{$name}}' }
  ] };
  assert.equal(await context.processTemplate('{{@hello("name")}}', {}, ctx), 'Hello name!');
  assert.equal(await context.processTemplate('{{@upper(upper("hello"))}}', {}, ctx), 'custom HELLO');
  assert.equal(await context.processTemplate('{{@_인사2(@hello("지운"))}}', {}, ctx), '안녕 Hello 지운!');
  assert.equal(await context.processTemplate('email: a@hello.com / {{"@hello()"}}', {}, ctx), 'email: a@hello.com / @hello()');
  for (const expression of ['{{@()}}', '{{@1hello()}}', '{{@hello}}', '{{@hello("name",)}}']) {
    await assert.rejects(context.processTemplate(expression, {}, ctx), /err_snippet_call_syntax/);
  }
});

test('for iterates inclusive ranges in either direction and preserves count loops', async () => {
  for (const [expression, expected] of [
    ['2~5', '2,3,4,5,'], ['5~2', '5,4,3,2,'], ['-2~1', '-2,-1,0,1,'],
    ['3~3', '3,'], ['4', '0,1,2,3,'], ['0', ''], ['-2', ''], ['(1+1)~max(4,5)', '2,3,4,5,']
  ]) {
    assert.equal(await context.processTemplate(`{{for ${expression}}}{{value}},{{endfor}}`, {}), expected);
  }
  assert.equal(await context.processTemplate('{{set $r = 2~4}}{{for $r}}{{index}}:{{value}};{{endfor}}|{{$r}}', {}), '0:2;1:3;2:4;|2~4');
});

test('range loops restore enclosing index and pass range parameters to snippet functions', async () => {
  const args = { index: 99 };
  assert.equal(await context.processTemplate('{{for 2~3}}[{{index}}:{{value}}:{{for 5~6}}{{index}}:{{value}},{{endfor}}:{{index}}:{{value}}]{{endfor}}', args), '[0:2:0:5,1:6,:0:2][1:3:0:5,1:6,:1:3]');
  assert.equal(args.index, 99);
  const ctx = { snippets: [{ name: 'list', trigger: '/list ${r}', replacement: '{{for $r}}{{value}},{{endfor}}' }] };
  assert.equal(await context.processTemplate('{{@list(2~5)}}', {}, ctx), '2,3,4,5,');
  await assert.rejects(context.processTemplate('{{for 2~3}}{{for 1~}}{{endfor}}{{endfor}}', args));
  assert.equal(args.index, 99);
});

test('snippet cursor offsets support both orders, aliases, variables and expressions', async () => {
  const ctx = { snippets: [{ name: 'func', trigger: '/f ${name}', replacement: '{{$name}}{{#0}}{{#1}}{{cursor}}{{#cursor}}{{# 2 + 1}}' }] };
  for (const call of ['@func("hello")<2>', '@func<2>("hello")', '@func ("hello") < $shift + 1 >', '@func<max(1, 2)>("hello")']) {
    assert.equal(await context.processTemplate(`{{${call}}}`, { shift: 1 }, ctx), 'hello{{#2}}{{#3}}{{#2}}{{#2}}{{#5}}', call);
  }
  assert.equal(await context.processTemplate('{{@func("hello")<0>}}', {}, ctx), 'hello{{#0}}{{#1}}{{cursor}}{{#cursor}}{{#3}}');
  assert.equal(await context.processTemplate('{{@func("hello")<$shift>}}', { shift: '2' }, ctx), 'hello{{#2}}{{#3}}{{#2}}{{#2}}{{#5}}');
});

test('cursor shifts apply only to call results and accumulate through nesting', async () => {
  const ctx = { snippets: [
    { name: 'inner', trigger: '', replacement: '{{#0}}{{cursor}}' },
    { name: 'outer', trigger: '', replacement: 'A{{#1}}{{@inner<2>()}}B' },
    { name: 'echo', trigger: '/echo ${text}', replacement: '{{$text}}' }
  ] };
  assert.equal(await context.processTemplate('{{#0}}{{@outer()<3>}}{{#1}}', {}, ctx), '{{#0}}A{{#4}}{{#5}}{{#5}}B{{#1}}');
  assert.equal(await context.processTemplate('{{upper(@echo("hello")<2>)}}', {}, ctx), 'HELLO');
  assert.equal(await context.processTemplate('{{@echo<2>("[()] and comma, text")}}', {}, ctx), '[()] and comma, text');
});

test('invalid cursor offsets fail before expansion and unsafe shifted levels are rejected', async () => {
  const ctx = { snippets: [{ name: 'func', trigger: '', replacement: '{{#1}}' }] };
  for (const call of ['@func()<-1>', '@func<1.5>()', '@func()<null>', '@func()<true>', '@func()<1~2>', '@func()<9007199254740992>', '@func()<>']) {
    await assert.rejects(context.processTemplate(`{{${call}}}`, {}, ctx), /err_snippet_cursor_offset/, call);
  }
  for (const call of ['@func<2>', '@func<2>() <3>', '@func()<2><3>', '@func()<2', '@func<2)()', '@func()<1,2>']) {
    await assert.rejects(context.processTemplate(`{{${call}}}`, {}, ctx), /err_snippet_call_syntax|err_snippet_cursor_offset/, call);
  }
  await assert.rejects(context.processTemplate('{{@func()<9007199254740991>}}', {}, ctx), /err_snippet_cursor_offset/);
  await assert.rejects(context.processTemplate('{{@func()<$missing>}}', {}, ctx), /err_undefined_variable/);
});

test('replacement syntax errors carry translated error keys instead of silently producing empty text', async () => {
  const cases = [
    ['{{$missing}}', 'err_undefined_variable'],
    ['{{unknownTag}}', 'err_unknown_tag'],
    ['{{notAFunction()}}', 'err_unknown_function'],
    ['{{upper()}}', 'err_function_arguments'],
    ['{{prompt("a", "b")}}', 'err_fn_one_arg_max'],
    ['{{paste(1)}}', 'err_fn_no_args_allowed'],
    ['{{(1 + 2}}', 'err_unmatched_open_paren'],
    ['{{1 +}}', 'err_missing_operand'],
    ['{{1 >}}', 'err_missing_operand'],
    ['{{true &&}}', 'err_missing_operand'],
    ['{{true ||}}', 'err_missing_operand'],
    ['{{true ? : 2}}', 'err_missing_operand'],
    ['{{()}}', 'err_missing_operand'],
    ['{{if true}}body', 'err_if_unclosed'],
    ['{{for 2}}body', 'err_for_unclosed'],
    ['{{endif}}', 'err_template_syntax'],
    ['{{set name = 1}}', 'err_template_syntax'],
    ['{{set $name = }}', 'err_template_syntax'],
    ['{{#-1}}', 'err_cursor_level'],
    ['{{}}', 'err_unknown_tag'],
    ['{{unterminated', 'err_template_unclosed_tag']
  ];
  for (const [template, key] of cases) {
    await assert.rejects(context.processTemplate(template, {}), error => error.messageKey === key, template);
  }
  assert.equal(await context.processTemplate('{{set $x = null}}{{$x}}', {}), '');
  assert.equal(await context.processTemplate('{{$optional}}', { optional: undefined }), '');
  assert.equal(await context.processTemplate('{{if false}}{{$notEvaluated}}{{endif}}', {}), '');
  assert.equal(await context.processTemplate('{{upper ("hello")}}', {}), 'HELLO');
});

test('toast accepts messages, colors and expressions without inserting text or cancelling expansion', async () => {
  const messages = [];
  context.showSnippetToast = (message, color) => messages.push([message, color]);
  try {
    assert.equal(await context.processTemplate('before{{toast("Done", "#22c55e")}}after', {}), 'beforeafter');
    assert.equal(await context.processTemplate('{{toast(upper($message), $color)}}', { message: 'done', color: 'red' }), '');
    assert.equal(await context.processTemplate('{{if false}}{{toast("hidden", "red")}}{{endif}}', {}), '');
    assert.equal(await context.processTemplate('{{for 2}}{{toast(str(index), "green")}}{{endfor}}', {}), '');
    assert.deepEqual(messages, [['Done', '#22c55e'], ['DONE', 'red'], ['0', 'green'], ['1', 'green']]);
    for (const expression of ['{{toast()}}', '{{toast("one")}}', '{{toast("one", "red", "extra")}}']) {
      await assert.rejects(context.processTemplate(expression, {}), error => error.messageKey === 'err_fn_two_args_exact');
    }
  } finally { delete context.showSnippetToast; }
});

test('quoted snippet names support both quote styles, nested calls and either offset order', async () => {
  const ctx = { snippets: [
    { name: 'hello world', trigger: '/hello ${name}', replacement: 'Hello {{$name}}{{cursor}}' },
    { name: 'outer name', trigger: '/outer ${body}', replacement: 'Outer: {{$body}}' },
    { name: '0 $missing index ? (~) }}', trigger: '', replacement: 'literal' }
  ] };
  for (const call of ['@"hello world"("Guest")<2>', "@'hello world'<2>(\"Guest\")", '@"hello world" < $offset + 1 > ("Guest")']) {
    assert.equal(await context.processTemplate(`{{${call}}}`, { offset: 1 }, ctx), 'Hello Guest{{#2}}');
  }
  assert.equal(await context.processTemplate(`{{@'outer name'(@"hello world"("Guest"))}}`, {}, ctx), 'Outer: Hello Guest{{cursor}}');
  assert.equal(await context.processTemplate('{{@"0 $missing index ? (~) }}"()}}', {}, ctx), 'literal');
  await assert.rejects(context.processTemplate('{{@"hello world"()}}', {}, ctx), error => error.messageKey === 'err_snippet_call_args');
  for (const text of ['{{@""()}}', "{{@''()}}"]) {
    await assert.rejects(context.processTemplate(text, {}, ctx), error => error.messageKey === 'err_snippet_call_syntax');
  }
});

test('quoted snippet names decode escaped quotes and backslashes without evaluating the name', async () => {
  const ctx = { snippets: [
    { name: 'say "hello"', replacement: 'double' },
    { name: "it's here", replacement: 'single' },
    { name: 'path\\name', replacement: 'slash' }
  ] };
  assert.equal(await context.processTemplate(String.raw`{{@"say \"hello\""()}}`, {}, ctx), 'double');
  assert.equal(await context.processTemplate(String.raw`{{@'it\'s here'()}}`, {}, ctx), 'single');
  assert.equal(await context.processTemplate(String.raw`{{@"path\\name"()}}`, {}, ctx), 'slash');
});

test('copy writes evaluated values once without inserting text and paste reads literal clipboard data', async () => {
  let clipboard = 'initial';
  const writes = [];
  context.navigator = { clipboard: {
    async readText() { return clipboard; },
    async writeText(value) { writes.push(value); clipboard = value; }
  } };
  try {
    assert.equal(await context.processTemplate('before{{copy(upper($message))}}after', { message: 'hello' }), 'beforeafter');
    assert.deepEqual(writes, ['HELLO']);
    assert.equal(await context.processTemplate('{{paste()}}', {}), 'HELLO');
    assert.equal(await context.processTemplate('{{copy(2 + 3)}}{{paste()}}', {}), '5');
    assert.equal(await context.processTemplate('{{copy(2~5)}}{{paste()}}', {}), '2~5');
    // Pass a quoted-looking value through copy and paste without evaluating it.
    assert.equal(await context.processTemplate('{{copy($text)}}{{paste()}}', { text: 'literal {{unknown()}}' }), 'literal {{unknown()}}');
    assert.equal(await context.processTemplate('{{copy(@hello())}}', {}, { snippets: [{ name: 'hello', replacement: 'Guest' }] }), '');
    assert.equal(clipboard, 'Guest');
    const count = writes.length;
    assert.equal(await context.processTemplate('{{if false}}{{copy("hidden")}}{{endif}}', {}), '');
    assert.equal(writes.length, count);
  } finally { delete context.navigator; }
});

test('copy and paste enforce argument counts before clipboard access and replace the clipboard builtin', async () => {
  context.navigator = { clipboard: {
    async readText() { assert.fail('invalid call must not read'); },
    async writeText() { assert.fail('invalid call must not write'); }
  } };
  try {
    for (const value of ['{{copy()}}', '{{copy(1, 2)}}']) {
      await assert.rejects(context.processTemplate(value, {}), error => error.messageKey === 'err_fn_one_arg_exact');
    }
    for (const value of ['{{copy(,1)}}', '{{copy(1,)}}']) {
      await assert.rejects(context.processTemplate(value, {}), error => error.messageKey === 'err_function_arguments');
    }
    await assert.rejects(context.processTemplate('{{paste(1)}}', {}), error => error.messageKey === 'err_fn_no_args_allowed');
    await assert.rejects(context.processTemplate('{{clipboard()}}', {}), error => error.messageKey === 'err_unknown_function');
  } finally { delete context.navigator; }
});

test('copy failures report a localized error rather than appearing to succeed', async () => {
  context.navigator = { clipboard: { async writeText() { throw new Error('Permission denied'); } } };
  try {
    await assert.rejects(context.processTemplate('{{copy("text")}}', {}), error => error.messageKey === 'err_clipboard_copy_failed');
  } finally { delete context.navigator; }
});

test('type works with stored values, captures and snippet results in templates', async () => {
  assert.equal(await context.processTemplate('{{type($count)}} / {{type(num($count))}}', { count: '42' }), 'string / number');
  assert.equal(await context.processTemplate('{{set $r = 2~5}}{{type($r)}} / {{type($optional)}} / {{$optional}}', { optional: undefined }), 'range / undefined / ');
  assert.equal(await context.processTemplate('{{set $v = undefined}}{{type($v)}}', {}), 'undefined');
  assert.equal(await context.processTemplate('{{type(@value())}}', {}, { snippets: [{ name: 'value', replacement: '{{42}}' }] }), 'string');
});

test('set without an initializer declares undefined and supports assignment, resetting and normal scope', async () => {
  assert.equal(await context.processTemplate('{{set $value}}{{type($value)}}|{{$value}}', {}), 'undefined|');
  assert.equal(await context.processTemplate('{{set $값}}{{set $값 = 42}}{{$값}}', {}), '42');
  assert.equal(await context.processTemplate('{{set $value = 42}}{{set $value}}{{type($value)}}', {}), 'undefined');
  assert.equal(await context.processTemplate('{{set $value}}{{set $value += 2}}{{$value}}', {}), '2');
  assert.equal(await context.processTemplate('{{set $value}}{{if true}}{{set $value = 3}}{{endif}}{{$value}}', {}), '3');
  assert.equal(await context.processTemplate('{{set $value = 3}}{{if true}}{{set $value}}{{endif}}{{type($value)}}', {}), 'undefined');
  await assert.rejects(context.processTemplate('{{if true}}{{set $local}}{{endif}}{{$local}}', {}), error => error.messageKey === 'err_undefined_variable');
  assert.equal(await context.processTemplate('{{for 2}}{{set $local}}{{type($local)}} {{endfor}}', {}), 'undefined undefined ');
  for (const value of ['{{set value}}', '{{set $}}', '{{set $a $b}}', '{{set $value =}}']) {
    await assert.rejects(context.processTemplate(value, {}), error => error.messageKey === 'err_template_syntax', value);
  }
});
