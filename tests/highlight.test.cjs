const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');

const root = path.join(__dirname, '..');
const context = vm.createContext({
  t: (key, args = []) => `${key}:${args.join(',')}`,
  currentConfig: { visualizeNewlines: false }
});
for (const file of ['utils/constants.js', 'utils/triggers.js', 'options/highlight.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

test('unterminated strings are reported and highlighted even when they swallow the closing tag', () => {
  for (const value of ['{{"sdf}}', "{{'sdf}}", '{{upper("sdf)}}', '{{@"hello world()}}', '{{"', String.raw`{{"sdf\"}}`]) {
    const highlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value }, highlight), 'err_unclosed_string:', value);
    assert.match(highlight.innerHTML, /class="error-badge"/, value);
  }
  for (const value of ['{{upper("}}")}}', "{{upper('}}')}}", String.raw`{{upper("a\"b")}}`]) {
    assert.equal(context.updateHighlight({ value }, { innerHTML: '' }), '', value);
  }
});

test('standalone string literals use expression highlighting without interpreting their contents', () => {
  for (const value of ['{{"str"}}', "{{'str'}}", '{{""}}', "{{''}}", '{{  "str"  }}',
    '{{"}}"}}', '{{"$missing @unknown() index"}}', '{{"<strong>&text</strong>"}}',
    String.raw`{{"say \"hello\""}}`, String.raw`{{'it\'s text'}}`]) {
    const highlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value }, highlight), '', value);
    assert.match(highlight.innerHTML, /class="expr-badge"/, value);
    assert.doesNotMatch(highlight.innerHTML, /error-badge|hl-fn-err|<strong>/, value);
  }
  assert.notEqual(context.updateHighlight({ value: '{{"str" invalid}}' }, { innerHTML: '' }), '');
});

test('set highlights multiple sequential assignments and rejects malformed separators', () => {
  for (const value of [
    '{{set $a = 3, $b = 5}}{{$a}}{{$b}}',
    '{{set $a = 3, $b = $a + 2, $a += $b}}{{$a}}{{$b}}',
    '{{set $a, $b = type($a), $a = "ab", $a *= 2}}{{$b}}{{$a}}',
    '{{set $a = "x,y", $b = join(["a", "b"], ","), $c = max(3, 5)}}{{$a}}{{$b}}{{$c}}',
    '{{set $a = 1}}{{if true}}{{set $a += 2, $b = 5}}{{endif}}{{$a}}'
  ]) assert.equal(context.updateHighlight({ value }, { innerHTML: '' }), '', value);
  for (const value of ['{{set , $a = 3}}', '{{set $a = 3,}}', '{{set $a = 3,, $b = 5}}', '{{set $a = 3, $b =}}', '{{set $a = 3, b = 5}}']) {
    assert.notEqual(context.updateHighlight({ value }, { innerHTML: '' }), '', value);
  }
  assert.equal(context.updateHighlight({ value: '{{set $a = $b, $b = 5}}' }, { innerHTML: '' }), 'err_undefined_variable:$b');
  assert.equal(context.updateHighlight({ value: '{{if true}}{{set $a = 3, $b = 5}}{{endif}}{{$b}}' }, { innerHTML: '' }), 'err_undefined_variable:$b');
});

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

test('snippet calls support captured argument expressions in the editor', () => {
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: '{{@인사(upper($name), 2)}}' }, highlight, '/hello ${name}'), '');
  assert.match(highlight.innerHTML, /class="hl-fn-snippet">@인사<\/span>/);
  assert.equal(context.updateHighlight({ value: '{{@()}}' }, highlight), 'err_snippet_call_syntax:');
});


test('literal snippet calls report incorrect argument counts while editing', () => {
  const library = [{ name: '인사', trigger: '/hello ${name} ${count:\\d+}' }, { name: 'Constant', trigger: '' }];
  const check = text => {
    const highlight = { innerHTML: '' };
    const error = context.updateHighlight({ value: text }, highlight, '/caller ${name}', library);
    return { error, html: highlight.innerHTML };
  };
  for (const text of ['{{@인사("one")}}', '{{upper(@인사("a", 2, 3))}}',
    '{{set $x = @인사()}}', '{{if @인사(1)}}yes{{endif}}']) {
    const result = check(text);
    assert.equal(result.error, 'err_snippet_call_args:인사,2');
    assert.match(result.html, /hl-fn-err/);
  }
  assert.equal(check('{{@인사(upper($name), 2)}}').error, '');
  assert.equal(check('{{@인사("a,b)", 2)}}').error, '');
  assert.equal(check('{{@Constant()}}').error, '');
  assert.equal(check('{{@Constant(1)}}').error, 'err_snippet_call_args:Constant,0');
  assert.equal(check('{{@인사(, 2)}}').error, 'err_snippet_call_syntax:');
  assert.equal(check('{{switch 1}}{{case @인사("a", 2)}}ok{{endcase}}{{endswitch}}').error, '');
});

test('snippet lookup uses the supplied group and rejects invalid function names', () => {
  const highlight = { innerHTML: '' };
  const check = (text, library) => context.updateHighlight({ value: text }, highlight, '/call ${target}', library);
  assert.equal(check('{{@Missing()}}', []), 'err_snippet_call_target:Missing');
  assert.equal(check('{{@Same()}}', [{ name: 'Same' }, { name: 'Same' }]), 'err_snippet_call_target:Same');
  assert.equal(check('{{@인사(1)}}', [{ name: '인사', trigger: '/hi ${name}' }]), '');
  assert.equal(check('{{@A&B<(()}}', [{ name: 'A&B<(', trigger: '' }]), 'err_snippet_call_syntax:');
});

test('@ functions use a distinct color while built-ins and errors retain theirs', () => {
  const highlight = { innerHTML: '' };
  const library = [{ name: 'hello', trigger: '/hello ${name}' }, { name: 'index', trigger: '' }];
  assert.equal(context.updateHighlight({ value: '{{@hello(upper("name"))}} {{@index()}}' }, highlight, '', library), '');
  assert.match(highlight.innerHTML, /class="hl-fn-snippet">@hello<\/span>/);
  assert.match(highlight.innerHTML, /class="hl-fn">upper\(/);
  assert.match(highlight.innerHTML, /class="hl-fn-snippet">@index<\/span>/);
  assert.equal(context.updateHighlight({ value: '{{@hello()}}' }, highlight, '', library), 'err_snippet_call_args:hello,1');
  assert.match(highlight.innerHTML, /class="hl-fn-err">@hello<\/span>/);
  const css = fs.readFileSync(path.join(root, 'styles/badges.css'), 'utf8');
  assert.match(css, /\.hl-fn-snippet\s*\{[^}]*color:\s*#5eead4/);
  assert.equal(vm.runInContext('BUILTIN_ALL.includes("snippet")', context), false);
});

test('range syntax highlights and validates consistently in for and random', () => {
  const highlight = { innerHTML: '' };
  const library = [{ name: 'list', trigger: '/list ${r}' }];
  const check = value => context.updateHighlight({ value }, highlight, '/caller ${start} ${end}', library);
  for (const value of [
    '{{for 2~5}}{{index}}{{endfor}}',
    '{{for 5~-2}}{{index}}{{endfor}}',
    '{{set $r = $start + 1 ~ $end * 2}}{{for $r}}{{index}}{{endfor}}',
    '{{random((1 + 1)~max(4, 5))}}',
    '{{random("a~b")}}', '{{2~5}}', '{{@list(2~5)}}',
    '{{for true ? 2~3 : 5~6}}{{index}}{{endfor}}'
  ]) assert.equal(check(value), '', value);
  check('{{for 2~5}}{{index}}{{endfor}}');
  assert.match(highlight.innerHTML, /class="hl-op">~<\/span>/);
  for (const value of [
    '{{for 2~}}{{index}}{{endfor}}', '{{for ~5}}{{index}}{{endfor}}',
    '{{set $r = ~5}}', '{{random(2~)}}', '{{random(~5)}}',
    '{{for 1~2~3}}{{index}}{{endfor}}'
  ]) assert.match(check(value), /^err_range_both_values_required:/, value);
});

test('cursor shift syntax validates and highlights both orders without counting it as an argument', () => {
  const highlight = { innerHTML: '' };
  const library = [{ name: 'hello', trigger: '/hi ${name}' }];
  const check = text => context.updateHighlight({ value: text }, highlight, '/call ${shift}', library);
  for (const text of ['{{@hello("Guest")<2>}}', '{{@hello<$shift + 1>("Guest")}}', '{{upper(@hello<max(1,2)>("Guest"))}}']) {
    assert.equal(check(text), '', text);
    assert.match(highlight.innerHTML, /hl-fn-snippet/);
    assert.match(highlight.innerHTML, /Guest/);
    assert.doesNotMatch(highlight.innerHTML, /undefined/);
  }
  assert.equal(check('{{@hello<2>()}}'), 'err_snippet_call_args:hello,1');
  assert.equal(check('{{@hello("Guest")<$unknown>}}'), 'err_undefined_variable:$unknown');
  for (const text of ['{{@hello("Guest")<-1>}}', '{{@hello<1.5>("Guest")}}', '{{@hello("Guest")<>}}']) {
    assert.equal(check(text), 'err_snippet_cursor_offset:');
  }
  for (const text of ['{{@hello<2>}}', '{{@hello("Guest")<2><3>}}', '{{@hello<2)("Guest")}}']) {
    assert.equal(check(text), 'err_snippet_call_syntax:');
  }
});

test('toast is highlighted as a built-in and validates exactly two arguments', () => {
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: '{{toast("Done", "#22c55e")}}' }, highlight), '');
  assert.match(highlight.innerHTML, /class="hl-fn">toast\(/);
  assert.equal(context.updateHighlight({ value: '{{toast("Done")}}' }, highlight), 'err_fn_two_args_exact:toast');
  assert.equal(context.updateHighlight({ value: '{{toast(upper($message), $color)}}' }, highlight, '/t ${message} ${color}'), '');
});

test('quoted function names retain snippet highlighting and argument validation', () => {
  const highlight = { innerHTML: '' };
  const library = [
    { name: 'hello world', trigger: '/hello ${name}' },
    { name: '0 $missing index ? (~) }} <img>', trigger: '' },
    { name: 'say "hello"', trigger: '' },
    { name: "it's here", trigger: '' }
  ];
  const check = text => context.updateHighlight({ value: text }, highlight, '/call ${offset}', library);
  for (const value of ['{{@"hello world"("Guest")<2>}}', "{{@'hello world'<$offset>(upper('Guest'))}}", '{{upper(@"hello world"("Guest"))}}']) {
    assert.equal(check(value), '', value);
    assert.match(highlight.innerHTML, /hl-fn-snippet/);
    assert.match(highlight.innerHTML, /hello world/);
    assert.doesNotMatch(highlight.innerHTML, /undefined/);
  }
  assert.equal(check('{{@"0 $missing index ? (~) }} <img>"()}}'), '');
  assert.doesNotMatch(highlight.innerHTML, /<img>/);
  assert.equal(check(String.raw`{{@"say \"hello\""()}}`), '');
  assert.equal(check(String.raw`{{@'it\'s here'()}}`), '');
  assert.equal(check('{{@"hello world"()}}'), 'err_snippet_call_args:hello world,1');
  assert.equal(check('{{@"missing name"()}}'), 'err_snippet_call_target:missing name');
  assert.equal(check('{{@"hello world"("Guest")<$unknown>}}'), 'err_undefined_variable:$unknown');
});

test('paste and copy are highlighted and validate their argument counts', () => {
  const highlight = { innerHTML: '' };
  const check = value => context.updateHighlight({ value }, highlight, '/copy ${message}');
  assert.equal(check('{{copy(upper($message))}}{{paste()}}'), '');
  assert.match(highlight.innerHTML, /class="hl-fn">copy\(/);
  assert.match(highlight.innerHTML, /class="hl-fn">paste\(/);
  assert.equal(check('{{paste(1)}}'), 'err_fn_no_args_allowed:paste');
  assert.equal(check('{{copy()}}'), 'err_fn_args_required:copy');
  assert.equal(check('{{copy(1, 2)}}'), 'err_fn_one_arg_exact:copy');
  assert.notEqual(check('{{clipboard()}}'), '');
});

test('direct self calls are valid for bare and quoted names with nested arguments or cursor offsets', () => {
  const library = [{ name: 'hello', trigger: '/hello ${name}' }, { name: 'hello world', trigger: '' }, { name: 'other', trigger: '' }];
  for (const [value, name] of [
    ['{{@hello("Guest")}}', 'hello'],
    ['{{upper(@hello("Guest"))}}', 'hello'],
    ['{{@hello<2>("Guest")}}', 'hello'],
    ['{{@hello("Guest")<2>}}', 'hello'],
    ['{{@"hello world"()}}', 'hello world'],
    ["{{@'hello world'()}}", 'hello world'],
    ['{{if true}}{{@hello("Guest")}}{{endif}}', 'hello']
  ]) {
    const highlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value }, highlight, '', library, name), '', value);
    assert.doesNotMatch(highlight.innerHTML, /class="hl-fn-err"/, value);
  }
  for (const value of ['{{@other()}}', '{{"@hello()"}}', '{{@hello("Guest")}}']) {
    assert.equal(context.updateHighlight({ value }, { innerHTML: '' }, '', library, 'hello world'), '', value);
  }
  assert.equal(context.updateHighlight({ value: '{{@hello("Guest")}}' }, { innerHTML: '' }, '', [...library, library[0]], 'hello'), 'err_snippet_call_target:hello');
});

test('type uses the type-function color and requires exactly one argument', () => {
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: '{{type($value)}} {{type(2~5)}} {{type(undefined)}}' }, highlight, '/t ${value}'), '');
  assert.match(highlight.innerHTML, /class="hl-fn-type">type\(/);
  for (const value of ['{{type()}}', '{{type(1, 2)}}', '{{type(,1)}}', '{{type(1,)}}']) {
    assert.equal(context.updateHighlight({ value }, highlight), 'err_fn_one_arg_exact:type', value);
    assert.match(highlight.innerHTML, /hl-fn-err/, value);
  }
  assert.equal(context.updateHighlight({ value: '{{type($missing)}}' }, highlight), 'err_undefined_variable:$missing');
});

test('set declarations without initializers define variables and preserve block scope', () => {
  for (const value of [
    '{{set $value}}{{type($value)}}', '{{set $값}}{{set $값 = 42}}{{$값}}',
    '{{set $value = 42}}{{set $value}}{{$value}}',
    '{{set $value}}{{if true}}{{set $value = 3}}{{endif}}{{$value}}'
  ]) {
    const highlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value }, highlight), '', value);
    assert.match(highlight.innerHTML, /class="hl-var"/, value);
    assert.doesNotMatch(highlight.innerHTML, /error-badge|hl-fn-err/, value);
  }
  assert.equal(context.updateHighlight({ value: '{{if true}}{{set $local}}{{endif}}{{$local}}' }, { innerHTML: '' }), 'err_undefined_variable:$local');
  for (const value of ['{{set value}}', '{{set $}}', '{{set $a $b}}']) {
    assert.notEqual(context.updateHighlight({ value }, { innerHTML: '' }), '', value);
  }
});

test('isCursor highlights as a builtin and validates its one argument', () => {
  for (const source of ['{{isCursor("{{#1}}")}}', '{{isCursor(undefined)}}', '{{for "ab"}}{{isCursor(value)}}{{endfor}}']) {
    const output = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.doesNotMatch(output.innerHTML, /error-badge|hl-fn-err/, source);
  }
  for (const source of ['{{isCursor()}}', '{{isCursor(1, 2)}}', '{{isCursor(,1)}}', '{{isCursor(1,)}}']) {
    assert.equal(context.updateHighlight({ value: source }, { innerHTML: '' }), 'err_fn_one_arg_exact:isCursor', source);
  }
  assert.equal(context.updateHighlight({ value: '{{isCursor($missing)}}' }, { innerHTML: '' }), 'err_undefined_variable:$missing');
});

test('includes and hasCursor highlight with their required argument counts', () => {
  for (const source of ['{{includes("abcd", "bc")}}', '{{includes([1,2], 2)}}', '{{includes(5~2, 3)}}', '{{hasCursor(undefined)}}', '{{for "ab"}}{{hasCursor(value)}}{{endfor}}']) {
    const output = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.doesNotMatch(output.innerHTML, /error-badge|hl-fn-err/, source);
  }
  for (const source of ['{{includes()}}', '{{includes([])}}', '{{includes([], 1, 2)}}', '{{includes(,1)}}', '{{includes([],1,)}}']) {
    assert.equal(context.updateHighlight({ value: source }, { innerHTML: '' }), 'err_fn_two_args_exact:includes', source);
  }
  for (const source of ['{{hasCursor()}}', '{{hasCursor(1, 2)}}', '{{hasCursor(,1)}}', '{{hasCursor(1,)}}']) {
    assert.equal(context.updateHighlight({ value: source }, { innerHTML: '' }), 'err_fn_one_arg_exact:hasCursor', source);
  }
});

test('fragment literals highlight their nested template syntax and inherit variables and loop values', () => {
  for (const source of ['{{`a{{#1}}b`}}', '{{type(``)}}', '{{includes(`a,b{{#1}}`, `b{{#1}}`)}}',
    '{{set $x = 2, $f = `{{$x}}{{#1}}`}}{{$f}}',
    '{{for 2}}{{`{{index}}:{{value}}`}}{{endfor}}',
    '{{`{{upper(`a{{#1}}b`)}}`}}', '{{`{{for 2}}{{break}}{{endfor}}`}}']) {
    const output = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.match(output.innerHTML, /class="hl-fragment"/, source);
    assert.doesNotMatch(output.innerHTML, /error-badge|hl-fn-err/, source);
  }
  assert.equal(context.updateHighlight({ value: '{{`{{$missing}}`}}' }, { innerHTML: '' }), 'err_undefined_variable:$missing');
  assert.equal(context.updateHighlight({ value: '{{`{{set $local = 1}}`}}{{$local}}' }, { innerHTML: '' }), 'err_undefined_variable:$local');
  assert.equal(context.updateHighlight({ value: '{{`{{includes(1)}}`}}' }, { innerHTML: '' }), 'err_fn_two_args_exact:includes');
  for (const source of ['{{`unclosed}}', '{{`{{upper(`unclosed`)}}']) {
    assert.equal(context.updateHighlight({ value: source }, { innerHTML: '' }), 'err_unclosed_fragment_literal:', source);
  }
});

test('literal highlighting preserves source escapes and escapes HTML', () => {
  const source = '{{`a\\`b\\\\c <b>&{{#1}}`}}';
  const output = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: source }, output), '');
  assert.doesNotMatch(output.innerHTML, /<b>/);
  const rendered = output.innerHTML.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(rendered, source);
});

test('fragment conversion highlights as a type cast and requires exactly one argument', () => {
  for (const source of ['{{fragment("ab{{#1}}cd")}}', '{{fragment(`a{{#1}}b`)}}', '{{set $text = "abc", $f = fragment($text)}}{{$f}}']) {
    const output = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.match(output.innerHTML, /class="hl-fn-type">fragment\(/, source);
  }
  for (const source of ['{{fragment()}}', '{{fragment(1,2)}}', '{{fragment(,1)}}', '{{fragment(1,)}}']) {
    assert.equal(context.updateHighlight({ value: source }, { innerHTML: '' }), 'err_fn_one_arg_exact:fragment', source);
  }
});

test('bool is highlighted as a type cast and validates exactly one argument', () => {
  for (const source of ['{{bool(0)}}', '{{bool(undefined)}}', '{{bool(`{{#1}}`)}}', '{{set $flag = bool("yes")}}{{type($flag)}}']) {
    const output = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: source }, output), '', source);
    assert.match(output.innerHTML, /class="hl-fn-type">bool\(/, source);
  }
  for (const source of ['{{bool()}}', '{{bool(1,2)}}', '{{bool(,1)}}', '{{bool(1,)}}']) {
    assert.equal(context.updateHighlight({ value: source }, { innerHTML: '' }), 'err_fn_one_arg_exact:bool', source);
  }
  assert.equal(context.updateHighlight({ value: '{{bool($missing)}}' }, { innerHTML: '' }), 'err_undefined_variable:$missing');
});

test('bool and null categories are mapped by the host without highlighting quoted words', () => {
  const source='{{true}} {{false}} {{null}} {{"true false null"}} {{42}}';
  const analysis=context.analyze(source);
  const html=context.renderHighlight(analysis);
  assert.equal((html.match(/class="hl-bool"/g)||[]).length,2);
  assert.equal((html.match(/class="hl-null"/g)||[]).length,1);
  assert.equal(html.replace(/<[^>]*>/g,''),source);
  assert.equal(vm.runInContext('TOKEN_CLASSES.bool',context),'hl-bool');
  assert.equal(vm.runInContext('TOKEN_CLASSES.null',context),'hl-null');
});

test('nested literal newlines do not insert padding into the fragment source', () => {
  const source='{{`first\n{{true}}\n`}}';
  const analysis=context.analyze(source);
  const html=context.renderHighlight(analysis);
  assert.equal(html.replace(/<[^>]*>/g,''),source);
  assert.equal((html.match(/class="hl-bool"/g)||[]).length,1);
});
