const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({ t: key => key, currentConfig: { visualizeNewlines: false } });
for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js', 'options/highlight.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const library = [
  { name: 'func', trigger: '/f ${values}', replacement: '{{type($values)}}{{#0}}' },
  { name: 'offset', trigger: '', replacement: '2' }
];

test('angle offsets work in either order with lists, nested calls and parenthesized comparisons', async () => {
  for (const call of ['@func([1,2])<2>', '@func<2>([1,2])', '@func<@offset()>([1,2])',
    '@func<(2 > 1 ? 2 : 0)>([1,2])', '@func([1,2])<(1 < 2 ? 2 : 0)>', '@func < len([1,2]) > ([1,2])']) {
    assert.equal(await context.processTemplate(`{{${call}}}`, {}, { snippets: library }), 'list{{#2}}', call);
    assert.equal(context.updateHighlight({ value: `{{${call}}}` }, { innerHTML: '' }, '', library), '', call);
  }
  assert.equal(await context.processTemplate('{{(@offset()) < 3}}', {}, { snippets: library }), 'true');
});

test('square offsets are rejected and incomplete or duplicate angle offsets report errors', async () => {
  for (const call of ['@func([1])[2]', '@func[2]([1])', '@func([1])<2', '@func<2', '@func([1])<2><3>']) {
    await assert.rejects(context.processTemplate(`{{${call}}}`, {}, { snippets: library }), error => error.messageKey === 'err_snippet_call_syntax', call);
    assert.equal(context.updateHighlight({ value: `{{${call}}}` }, { innerHTML: '' }, '', library), 'err_snippet_call_syntax', call);
  }
  for (const call of ['@func([1])<>', '@func<>([1])']) {
    await assert.rejects(context.processTemplate(`{{${call}}}`, {}, { snippets: library }), error => error.messageKey === 'err_snippet_cursor_offset', call);
  }
});

test('angle offsets render as escaped function delimiters while list punctuation keeps its own color', () => {
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: '{{@func<2>([1,2])}}' }, highlight, '', library), '');
  assert.match(highlight.innerHTML, /class="hl-fn-snippet">&lt;<\/span>/);
  assert.match(highlight.innerHTML, /class="hl-fn-snippet">&gt;<\/span>/);
  assert.deepEqual([...highlight.innerHTML.matchAll(/class="hl-list">([^<]*)<\/span>/g)].map(match => match[1]), ['[', ',', ']']);
  assert.doesNotMatch(highlight.innerHTML, /<2>/);
  assert.equal(context.parseSnippetCall('@func&lt;&gt;([1])').error, 'err_snippet_cursor_offset');
});
