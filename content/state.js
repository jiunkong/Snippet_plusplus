import { DEFAULT_CONFIG } from '../utils/config.js';
// --- Constants & Global State ---

export const defaultConfig = DEFAULT_CONFIG;
export const defaultSnippetGroups = [{
  name: chrome.i18n.getMessage('default_group_name') || "General",
  snippets: [{
    trigger: "/hello",
    replacement: chrome.i18n.getMessage('default_snippet_replacement') || "Hello, {{cursor}}!"
  }],
  disabledSites: []
}];

// Constants (VISUAL_OPEN, CURSOR_REGEX, etc.) are in utils/constants.js

export let snippets        = [];
export let config          = defaultConfig;
export let typingSeqLength = 0; // Tracks consecutive characters typed in a single flow
export let lastExpansion   = null; // Snapshot of the most recent completed expansion
export let isInternalEdit = false;

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get snippets() { return snippets; }, set snippets(value) { snippets = value; },
  get config() { return config; }, set config(value) { config = value; },
  get typingSeqLength() { return typingSeqLength; }, set typingSeqLength(value) { typingSeqLength = value; },
  get lastExpansion() { return lastExpansion; }, set lastExpansion(value) { lastExpansion = value; },
  get isInternalEdit() { return isInternalEdit; }, set isInternalEdit(value) { isInternalEdit = value; },
};
