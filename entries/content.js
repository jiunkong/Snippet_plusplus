import { initializeHandlers } from '../content/handlers.js';
import { loadSettings, reloadSnippetSettings, watchSnippetSettings } from '../content/settings.js';
watchSnippetSettings();
initializeHandlers({ load: loadSettings, reload: reloadSnippetSettings });
