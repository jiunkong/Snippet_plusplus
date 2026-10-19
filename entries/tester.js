import { initializeHandlers } from '../content/handlers.js';
import { loadSettings, applySnippetTestState } from '../options/tester-runtime.js';
initializeHandlers({ load: loadSettings, reload: loadSettings });
