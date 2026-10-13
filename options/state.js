// --- Global State & Constants ---

const defaultSnippetGroups = [
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

let currentConfig = { ...DEFAULT_CONFIG };
let snippetGroups = [];
let activeGroupIndex = -1;
let recordingTarget = null;
let saveTimeout = null;
