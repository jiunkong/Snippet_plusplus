const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const root = path.join(__dirname, '..');
const context = vm.createContext({
  t: (key, args = []) => [key, ...args].join(':'),
  currentConfig: { visualizeNewlines: false }
});
for (const file of ['utils/constants.js', 'utils/triggers.js', 'content/template.js', 'options/highlight.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

test('the expansion adapter and editor share compact semantics with captures and generated line breaks', async () => {
  const source = '{{compact}}\n  Hello, {{$who}}!{{"\\n"}}\n  {{#0}}Done\n{{endcompact}}';
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: source }, highlight, '/greet ${who}'), '');
  assert.equal(String(await context.processTemplate(source, { who: 'Guest' })), 'Hello, Guest!\n{{#0}}Done');
  assert.match(highlight.innerHTML, /compact-badge">\{\{compact\}\}<\/span>/);
  assert.match(highlight.innerHTML, /compact-badge">\{\{endcompact\}\}<\/span>/);
  assert.equal(highlight.innerHTML.replace(/<[^>]+>/g, ''), source);
});

test('compact diagnostic messages exist in both catalogs and render at the block markers', () => {
  for (const [source, key] of [['{{compact}}\nText', 'err_compact_unclosed'], ['{{endcompact}}', 'err_endcompact_no_compact']]) {
    const highlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: source }, highlight), key);
    assert.match(highlight.innerHTML, /error-badge/);
    for (const locale of ['en', 'ko']) {
      const catalog = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), 'utf8'));
      assert.ok(catalog[key]?.message);
    }
  }
});

test('both compact formatting guide examples highlight and execute to their documented results', async () => {
  const page = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  const article = page.match(/<article class="guide-item">\s*<h3 data-i18n="guide_doc_compact_title">[\s\S]*?<\/article>/)[0];
  const decode = value => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const examples = [...article.matchAll(/<details class="guide-example">([\s\S]*?)<\/details>/g)];
  assert.equal(examples.length, 2);
  for (const [, example] of examples) {
    const panels = [...example.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map(match => decode(match[1]));
    assert.equal(context.updateHighlight({ value: panels[0] }, { innerHTML: '' }), '');
    assert.equal(String(await context.processTemplate(panels[0], {})), panels[1]);
  }
});

test('newline is highlighted as a builtin and the formatting guide example inserts a real line break', async () => {
  const page = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  const article = page.match(/<article class="guide-item">\s*<h3 data-i18n="guide_doc_newline_title">[\s\S]*?<\/article>/)[0];
  const panels = [...article.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map(match => match[1]);
  const highlight = { innerHTML: '' };
  assert.equal(context.updateHighlight({ value: panels[0] }, highlight), '');
  assert.match(highlight.innerHTML, /hl-fn/);
  assert.equal(String(await context.processTemplate(panels[0], {})), panels[1]);
  for (const name of ['newline', 'nl']) {
    const aliasHighlight = { innerHTML: '' };
    assert.equal(context.updateHighlight({ value: `{{${name}()}}` }, aliasHighlight), '');
    assert.match(aliasHighlight.innerHTML, /hl-fn/);
    assert.equal(String(await context.processTemplate(`{{${name}()}}`, {})), '\n');
    assert.match(context.updateHighlight({ value: `{{${name}(1)}}` }, { innerHTML: '' }), /^err_fn_no_args_allowed/);
  }
  for (const locale of ['en', 'ko']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), 'utf8'));
    assert.ok(catalog.guide_doc_newline_title.message);
    assert.ok(catalog.guide_doc_newline_desc.message);
  }
});
