const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'"
})[entity]);
const attribute = (source, name) => decode(source.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '');
const examples = [...page.matchAll(/<details class="guide-example"([^>]*)>([\s\S]*?)<\/details>/g)].map(([, attrs, body]) => ({
  snippets: JSON.parse(attribute(attrs, 'data-guide-snippets') || '[]'),
  panels: [...body.matchAll(/data-i18n="guide_doc_(\w+)"[^>]*>[^<]*<\/div>\s*<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g)]
    .map(([, kind, attrs, text]) => ({ kind, attrs, text: decode(text) }))
}));
function engine() {
  const context = vm.createContext({ t: key => key, currentConfig: { visualizeNewlines: false } });
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/fragment.js', 'content/evaluator.js', 'content/template-parser.js', 'content/template.js', 'options/highlight.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('every guide example highlights with real editor validation and no undefined variables or functions', () => {
  const context = engine();
  assert.ok(examples.length > 25);
  for (const example of examples) {
    assert.ok(example.panels.length, 'example has code panels');
    for (const panel of example.panels) {
      const language = attribute(panel.attrs, 'data-guide-language');
      const output = { innerHTML: '' };
      if (language === 'trigger') {
        assert.equal(context.updateTriggerHighlight({ value: panel.text }, output), '', panel.text);
      } else if (language === 'template') {
        assert.equal(context.updateHighlight({ value: panel.text }, output,
          attribute(panel.attrs, 'data-guide-trigger'), example.snippets), '', panel.text);
        assert.doesNotMatch(output.innerHTML, /class="(?:error-badge|hl-fn-err)"/, panel.text);
      }
    }
  }
});

test('documented deterministic results match the actual expansion engine', async () => {
  const context = engine();
  for (const example of examples) {
    const expected = example.panels.find(panel => panel.kind === 'result');
    if (!expected) continue;
    const template = example.panels.find(panel => panel.kind === 'call') || example.panels.find(panel => panel.kind === 'body');
    const input = example.panels.find(panel => panel.kind === 'input');
    const trigger = example.panels.find(panel => panel.kind === 'trigger');
    const compiled = input && trigger ? context.compileTrigger(trigger.text) : null;
    const args = compiled?.isRegex ? compiled.regex.exec(input.text)?.groups || {} : {};
    let actual = String(await context.processTemplate(template.text, args, { snippets: example.snippets }));
    // Backspace effects are applied by expansion after evaluating the body.
    while (actual.includes('\b')) actual = actual.replace(/[^\b]?\x08/, '');
    assert.equal(actual, expected.text, template.text);
  }
});

test('guide contents target every section once and all example toggles start closed', () => {
  const targets = [...page.matchAll(/class="guide-card" id="([^"]+)"/g)].map(match => match[1]);
  const links = [...page.matchAll(/href="#(guide-[^"]+)"/g)].map(match => match[1]);
  assert.equal(targets.length, 12);
  assert.deepEqual(links, targets);
  assert.equal(new Set(targets).size, targets.length);
  assert.doesNotMatch(page, /<details class="guide-example"[^>]*\bopen(?:\s|>)/);
  assert.ok(page.indexOf('options/highlight.js') < page.indexOf('options/guide.js'));
  for (const locale of ['ko', 'en']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), 'utf8'));
    for (const [, key] of page.matchAll(/data-i18n="(guide_[^"]+)"/g)) assert.ok(catalog[key]?.message, `${locale}: ${key}`);
  }
});

test('contents navigation focuses headings and follows the guide scroll container', () => {
  const makeLink = hash => ({ hash, attrs: {}, listeners: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(type, callback) { this.listeners[type] = callback; }
  });
  const links = [makeLink('#guide-start'), makeLink('#guide-capture'), makeLink('#guide-values')];
  const sections = links.map((link, index) => ({
    top: index * 500,
    heading: { focus(options) { this.focused = options; } },
    querySelector() { return this.heading; },
    scrollIntoView(options) { this.scrolled = options; },
    getBoundingClientRect() { return { top: this.top }; }
  }));
  const guide = {
    listeners: {}, scrollTop: 0, clientHeight: 400, scrollHeight: 1500,
    querySelectorAll: () => links,
    addEventListener(type, callback) { this.listeners[type] = callback; },
    getBoundingClientRect: () => ({ top: 0 })
  };
  let reduceMotion = true;
  const context = vm.createContext({
    document: {
      querySelectorAll: () => [],
      getElementById: id => id === 'guide-tab' ? guide : sections[links.findIndex(link => link.hash === '#' + id)]
    },
    window: { matchMedia: () => ({ matches: reduceMotion }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'options/guide.js'), 'utf8'), context);
  let prevented = false;
  links[1].listeners.click({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(sections[1].heading.tabIndex, -1);
  assert.equal(sections[1].heading.focused.preventScroll, true);
  assert.equal(sections[1].scrolled.behavior, 'instant');
  assert.equal(links[1].attrs['aria-current'], 'location');
  assert.equal(links[0].attrs['aria-current'], undefined);
  reduceMotion = false;
  links[2].listeners.click({ preventDefault() {} });
  assert.equal(sections[2].scrolled.behavior, 'smooth');
  sections[0].top = -500;
  sections[1].top = 20;
  sections[2].top = 520;
  guide.listeners.scroll();
  assert.equal(links[1].attrs['aria-current'], 'location');
  guide.scrollTop = 1100;
  guide.listeners.scroll();
  assert.equal(links[2].attrs['aria-current'], 'location');
});
