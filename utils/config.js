// Shared defaults for the options page and content script. Stored configs may
// omit keys added by a newer extension version, so both callers merge with this.
const DEFAULT_CONFIG = Object.freeze({
  nextCursor: 'Ctrl+Space',
  undoExpansion: 'Ctrl+Z',
  addSnippet: 'Alt+N',
  addSubgroup: 'Alt+G',
  reloadSnippets: 'Alt+R',
  maxExecutionMs: 500,
  maxCallDepth: 32,
  toggleFold: 'Alt+L',
  showParticles: true,
  shiftCursorLevels: true,
  visualizeNewlines: true,
  uiLocale: 'system'
});
