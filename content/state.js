// --- Constants & Global State ---

const defaultConfig = { nextCursor: "Ctrl+Space" };
const defaultSnippetGroups = [{
  name: chrome.i18n.getMessage('default_group_name') || "General",
  snippets: [{
    trigger: "/hello",
    replacement: chrome.i18n.getMessage('default_snippet_replacement') || "Hello, {{cursor}}!"
  }],
  disabledSites: []
}];

// Constants (VISUAL_OPEN, CURSOR_REGEX, etc.) are in utils/constants.js

let snippets        = [];
let config          = defaultConfig;
let typingSeqLength = 0; // Tracks consecutive characters typed in a single flow
