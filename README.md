# Snippet++

Chrome Manifest V3 snippet expansion, with a portable [SnippetScript](https://github.com/jiunkong/SnippetScript) language core.

## Development

Requires Node.js 22 or newer, npm, Git and Chrome for browser checks.

```sh
git clone --recurse-submodules https://github.com/jiunkong/Snippet_plusplus.git
cd Snippet_plusplus
npm ci
npm run build
```

For an existing checkout, first run `git submodule update --init --recursive`. Load **`dist/`** through Chrome's **Load unpacked** action. The repository root is source code and cannot be loaded directly.

```sh
npm run dev       # watch extension, core sources and static assets
npm run build     # check core types, compile core, build complete extension
npm test          # build, extension regression tests, independent core tests
npm run test:browser # fresh headless Chrome profile and real editor checks
```

`npm run test:browser` uses a disposable profile and leaves existing Chrome data untouched. Set `SNIPPET_CHROME_BIN` if Chrome is not named `google-chrome`.

Reload the extension after rebuilding. `dist/`, `.test-build/` and dependencies are generated and ignored. Do not edit generated files. `manifest.json` is the extension version source of truth, including exported settings files.

### Removal and settings recovery

Use **Reload** in `chrome://extensions` to apply a rebuilt extension while retaining settings. Before using **Remove**, export the full configuration as a `.sppcfg` file; after reinstalling, import that file to restore it.

Chrome Sync is not an uninstall backup. Chromium's [Sync storage backend](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/storage/sync_storage_backend.cc) clears an extension's settings on uninstall, and [the storage implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/storage/syncable_settings_storage.cc) sends those deletions to Sync when enabled. Reinstalling with the same extension ID does not undo those deletions. Blocking startup writes cannot prevent Chrome's uninstall cleanup.

Each remaining installation keeps the last complete synced configuration in `chrome.storage.local`. Its background worker restores that copy to Sync when all configuration and snippet keys disappear, including when another device uninstalls the extension. Settings and content scripts also read that copy while Sync is empty. Enable the updated extension on the other device before removing an installation so it has time to create this backup; the options page does not need to stay open. Incoming partial revisions do not replace the backup.

Deleting all groups within the options page saves an explicit empty list, which is synced and backed up as an intentional edit. It does not trigger recovery. A local backup cannot survive removal of its own installation. If every installation and export is gone, the extension cannot recover the removed data. Keep a `.sppcfg` export for that case, or preserve an offline export on a device that still has the snippets before reconnecting it to Sync.

## Architecture

- `language-core/`: Git submodule containing the TypeScript analyzer, immutable AST and fragments, function specifications, diagnostics and executor. It has no DOM or Chrome dependencies.
- `content/`: browser host callbacks, editor detection, matching, insertion, selection, undo and effects.
- `options/`: extension UI, highlighting renderer, localization and isolated tester.
- `utils/`: extension configuration, sync protocol, localization and thin adapters for core trigger compilation.
- `entries/`: explicit ES module bootstrap for each extension context.
- `scripts/build.mjs`: esbuild bundles and static-resource packaging.

The analyzer returns token **categories and UTF-16 source ranges**, never colors or CSS classes. `options/highlight.js` maps categories to classes; `styles/badges.css` defines presentation. Template and expression parsing are shared with execution. Trigger highlighting, parameter signatures and regex compilation also share one core analysis, including escaped literal braces. DOM insertion consumes `SnippetFragment` cursor nodes; serialized cursor syntax remains plain text.

The core runs code and awaits `host.invoke(request, { signal })` for browser capabilities. User-input waits pause the execution budget. External cancellation and timeouts signal the host and prevent execution from resuming.

See [the implementation plan](docs/snippetscript-core-plan.md). The core checks function parameters at analysis and runtime without implicitly converting arguments; use explicit conversion functions. It also checks cursor expression types: definite mismatches are errors; partly compatible unions and unknown types produce warnings. The editor displays all body diagnostics, and warnings do not block execution. General implicit-conversion warnings for arithmetic remain future work.

## Updating the core

```sh
# Edit core files in the submodule, then verify independently.
cd language-core
npm ci
npm test
git add .
git commit -m "Describe core change"
git push origin main
cd ..
npm test
# Record the tested core commit together with its extension integration.
git add language-core
```

Push the core commit before publishing an extension commit that references it. A normal `git pull` does not update the checked-out submodule automatically; run `git submodule update --init --recursive` afterward. No npm publication is required to consume the core.

## Tests

Core tests import compiled ES modules directly and run without browser globals. Extension tests retain the existing VM editor/Chrome harnesses using `tests/helpers/source.cjs`; that adapter loads the real built core and removes module syntax for injectable host fixtures. It does not contain an alternate language implementation. Browser verification should use the built extension in `dist/` and cover options/tester startup, actual content-script expansion, input/textarea/contenteditable insertion, cursor movement, undo and prompt cancellation.

The active snippet group has a collapsible errors and warnings overview. It counts diagnostics from the same cached trigger/body analysis used by the editors, including folded and search-hidden snippets. Expanding the overview lists affected snippets and messages; selecting an entry reveals the snippet and selects the reported source range.

Hovering a builtin or snippet-call name shows a custom signature tooltip with parameter names/types, optional and variadic markers, and return types. Hovers share the core analysis and registry with validation; variables inside arguments retain their individual type hovers.

Snippet-call arguments must be strings, matching trigger captures. Analysis, signature hovers and runtime checks share this rule. Convert other values explicitly, for example `@foo(str(123))`; snippet calls return fragments.

The options syntax guide is organized around types and explicit conversions, captures and values, cursor-preserving fragments, control flow, functions and snippet calls. It includes diagnostic/hover navigation help and a builtin signature table generated directly from the core registry. Keep English/Korean explanations and examples aligned with runtime argument rules.

Builtin functions use distinct overloads rather than a flattened union signature. The signature popover narrows candidates from inferred arguments, shows the active parameter while editing, and provides previous/next arrows. Incomplete calls retain their parsed argument prefix for signature help; their syntax errors still block execution. Runtime validation and guide tables use the same overload registry.
