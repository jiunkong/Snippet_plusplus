import { t } from './i18n.js';
import { DEFAULT_CONFIG } from '../utils/config.js';
// --- Global State & Constants ---

export const defaultSnippetGroups = [
  {
    name: t('default_group_name'),
    snippets: [
      { 
        trigger: "/hello", 
        replacement: t('default_snippet_replacement'), 
        name: t('default_snippet_name'), 
        collapsed: false 
      }
    ]
  }
];

export let currentConfig = { ...DEFAULT_CONFIG };
export let snippetGroups = [];
export let activeGroupIndex = -1;
export let recordingTarget = null;
export let saveTimeout = null;

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get currentConfig() { return currentConfig; }, set currentConfig(value) { currentConfig = value; },
  get snippetGroups() { return snippetGroups; }, set snippetGroups(value) { snippetGroups = value; },
  get activeGroupIndex() { return activeGroupIndex; }, set activeGroupIndex(value) { activeGroupIndex = value; },
  get recordingTarget() { return recordingTarget; }, set recordingTarget(value) { recordingTarget = value; },
  get saveTimeout() { return saveTimeout; }, set saveTimeout(value) { saveTimeout = value; },
};
