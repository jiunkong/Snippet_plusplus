const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('settings retain each snippet library by group, including helpers without triggers', async () => {
  const first = { name: 'First', snippets: [
    { name: 'Caller', trigger: '/call ${name}', replacement: '{{@Helper($name)}}' },
    { name: 'Helper', trigger: '/helper ${x}', replacement: 'first {{$x}}', disabled: true },
    { name: 'Constant', trigger: '', replacement: 'constant' }
  ] };
  const second = { name: 'Second', snippets: [
    { name: 'Helper', trigger: '/other ${x}', replacement: 'second {{$x}}' }
  ] };
  const context = vm.createContext({
    console,
    chrome: { storage: { onChanged: { addListener() {} } } },
    window: { location: { href: 'https://example.com' } },
    loadSyncedState: async () => ({ config: {}, snippetGroups: [first, second,
      { siteMode: 'whitelist', disabledSites: ['other.example'], snippets: [{ trigger: '/hidden' }] }] }),
    defaultConfig: {}, defaultSnippetGroups: []
  });
  vm.runInContext('let config; let snippets;', context);
  for (const file of ['utils/constants.js', 'utils/triggers.js', 'utils/i18n.js', 'content/evaluator.js', 'content/template.js', 'content/settings.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.loadSettings();
  await new Promise(resolve => setImmediate(resolve));
  const snippets = vm.runInContext('snippets', context);
  assert.equal(snippets.length, 2);
  assert.equal(snippets.some(snippet => snippet.sourceSnippet === first.snippets[1]), false);
  const caller = snippets.find(s => s.name === 'Caller');
  assert.equal(caller.groupSnippets, first.snippets);
  assert.equal(caller.sourceSnippet, first.snippets[0]);
  assert.equal(await context.processTemplate(caller.replacement, { name: 'Jiun' }, {
    snippets: caller.groupSnippets, stack: [caller.sourceSnippet]
  }), 'first Jiun');
  assert.equal(await context.processTemplate('{{@Constant()}}', {}, { snippets: caller.groupSnippets }), 'constant');
  assert.equal(await context.processTemplate('{{@Caller("self")}}', {}, {
    snippets: caller.groupSnippets, stack: [caller.sourceSnippet]
  }), 'first self');
  await assert.rejects(context.processTemplate('{{@Constant()}}', {}, {
    snippets: second.snippets
  }), /err_snippet_call_target/);
});
