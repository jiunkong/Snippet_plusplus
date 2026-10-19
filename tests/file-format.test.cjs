const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const path = require('node:path');
const vm = require('./helpers/vm.cjs');
const { gunzipSync } = require('node:zlib');
const root = path.join(__dirname, '..');
function codec() {
  const context = vm.createContext({ Blob, CompressionStream, DecompressionStream, Response, TextDecoder });
  vm.runInContext(fs.readFileSync(path.join(root, 'options/file-format.js'), 'utf8'), context);
  return context;
}

test('binary envelope contains a versioned gzip payload and preserves Unicode and settings exactly', async () => {
  const context = codec();
  const group = { name: '한글 😊', snippets: [{ name: 'helper', trigger: '/a', replacement: '안녕\n{{"😊"}}', disabled: true, subgroupId: 'one' }],
    subgroups: [{ id: 'one', name: '도구', collapsed: true }], siteMode: 'whitelist', disabledSites: ['example.com'] };
  for (const kind of ['settings', 'group']) {
    const data = kind === 'group' ? { type: 'snippetpp_group', version: '1.2.0', group } : { version: '1.2.0', config: { uiLocale: 'ko' }, snippetGroups: [group] };
    const binary = await context.encodeSnippetExport(data, kind, 'binary');
    const bytes = Buffer.from(await binary.arrayBuffer());
    assert.equal(binary.type, 'application/octet-stream');
    assert.equal(bytes.subarray(0, 4).toString(), 'SPPB');
    assert.equal(bytes[4], 1);
    assert.equal(bytes[5], kind === 'settings' ? 1 : 2);
    assert.deepEqual(JSON.parse(gunzipSync(bytes.subarray(8)).toString()), data);
    const restored = await context.decodeSnippetExport(await binary.arrayBuffer(), kind);
    assert.deepEqual(JSON.parse(JSON.stringify(restored)), data);
    const json = await context.encodeSnippetExport(data, kind, 'json');
    assert.deepEqual(JSON.parse(await json.text()), data);
    assert.deepEqual(JSON.parse(JSON.stringify(await context.decodeSnippetExport(await json.arrayBuffer(), kind))), data);
  }
});

test('gzip reduces a representative snippet collection compared to the prior JSON export', async () => {
  const context = codec();
  const data = { version: '1.2.0', snippetGroups: [{ name: 'Examples', snippets: Array.from({ length: 100 }, (_, i) => ({
    name: `helper ${i}`, trigger: `/example${i}`, replacement: '{{set $items = [1, 2, 3]}}\n{{for $items}}{{value}}{{endfor}}\n한글과 이모지 😊'
  })) }] };
  const binary = await context.encodeSnippetExport(data, 'settings', 'binary');
  const json = await context.encodeSnippetExport(data, 'settings', 'json');
  assert.ok(binary.size < json.size / 4, `${binary.size} vs ${json.size} bytes`);
});

test('legacy plain JSON supports UTF-8 BOM and files without version metadata', async () => {
  const context = codec();
  for (const prefix of ['', '\uFEFF']) {
    const data = { name: 'Legacy', snippets: [] };
    const blob = new Blob([prefix, JSON.stringify(data)]);
    assert.deepEqual(JSON.parse(JSON.stringify(await context.decodeSnippetExport(await blob.arrayBuffer(), 'group'))), data);
  }
});

test('damaged, truncated, future-version and wrong-kind binary files fail decoding', async () => {
  const context = codec();
  const blob = await context.encodeSnippetExport({ snippetGroups: [] }, 'settings', 'binary');
  const original = new Uint8Array(await blob.arrayBuffer());
  const variants = [original.slice(0, 6), original.slice(0, original.length - 4)];
  for (const [offset, value] of [[4, 2], [5, 99], [6, 1], [8, 0]]) {
    const changed = original.slice();
    changed[offset] = value;
    variants.push(changed);
  }
  for (const bytes of variants) await assert.rejects(context.decodeSnippetExport(bytes.buffer, 'settings'));
  await assert.rejects(context.decodeSnippetExport(original.buffer, 'group'));
  for (const bytes of [new Uint8Array([]), new Uint8Array([0xff]), new TextEncoder().encode('not json')]) {
    await assert.rejects(context.decodeSnippetExport(bytes.buffer, 'settings'));
  }
});

test('options load the codec before storage handlers and localize all export controls', () => {
  const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  assert.match(fs.rawReadFileSync(path.join(root, 'options/storage.js'), 'utf8'), /from ['"]\.\/file-format\.js['"]/);
  for (const locale of ['ko', 'en']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), 'utf8'));
    for (const key of ['export_dialog_title', 'export_dialog_description', 'export_dialog_accept', 'export_format_label', 'export_format_binary', 'export_format_json', 'status_export_failed']) {
      assert.ok(catalog[key]?.message, `${locale}: ${key}`);
    }
  }
});
