import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'dist');
const assets = ['manifest.json', 'options.html', 'tester.html', 'options.css', 'content.css', 'styles', 'icons', '_locales'];
async function copyAssets() {
    await mkdir(outdir, { recursive: true });
    for (const asset of assets)
        await cp(path.join(root, asset), path.join(outdir, asset), { recursive: true });
}
const options = {
    absWorkingDir: root,
    entryPoints: { content: 'entries/content.js', options: 'entries/options.js', tester: 'entries/tester.js', background: 'background.js' },
    outdir: path.join(outdir, 'bundles'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
    keepNames: true, sourcemap: true, legalComments: 'eof',
};
if (process.argv.includes('--watch')) {
    // Core TypeScript is compiled by esbuild during development; npm run build
    // separately checks types and emits the independent core package.
    const context = await esbuild.context({ ...options, plugins: [{ name: 'extension-assets', setup(build) {
                    build.onStart(copyAssets);
                    build.onLoad({ filter: /entries\/(content|options|tester)\.js$/ }, async (args) => ({
                        contents: await readFile(args.path, 'utf8'), loader: 'js', watchFiles: (await Promise.all(assets.map(async (asset) => {
                            async function walk(name) { const entries = await readdir(name, { withFileTypes: true }); return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(name, entry.name)) : path.join(name, entry.name)))).flat(); }
                            return asset.includes('.') ? [path.join(root, asset)] : walk(path.join(root, asset));
                        }))).flat(),
                    }));
                } }] });
    await context.watch();
    console.log('Watching extension and language-core sources. Load dist/ in Chrome.');
}
else {
    await rm(outdir, { recursive: true, force: true });
    await copyAssets();
    await esbuild.build(options);
}
// A browser-free bundle used only by the legacy VM harnesses during migration.
await mkdir(path.join(root, '.test-build'), { recursive: true });
await esbuild.build({ absWorkingDir: root, entryPoints: ['language-core/src/index.ts'], bundle: true, keepNames: true, format: 'iife', globalName: 'SnippetScript', platform: 'neutral', target: 'es2022', outfile: '.test-build/core.js' });
