const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const vm = require('./helpers/vm.cjs');
const path = require('node:path');

test('browser copy returns a script undefined value after writing strings and serialized fragments', async () => {
  const copied = [];
  const context = vm.createContext({ navigator: { clipboard: {
    async writeText(text) { copied.push(text); }
  } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content/browser-host.js'), 'utf8'), context);
  assert.equal(await vm.runInContext('browserHost.invoke({name:"copy",args:["hello"]},{signal:{aborted:false}})', context).then(value => value.kind), 'undefined');
  assert.equal(await vm.runInContext('browserHost.invoke({name:"copy",args:[new SnippetFragment([{type:"text",value:"A"},{type:"cursor",level:2}])]},{signal:{aborted:false}})', context).then(value => value.kind), 'undefined');
  assert.deepEqual(copied, ['hello', 'A{{#2}}']);
});
