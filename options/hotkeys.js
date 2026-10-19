import { moduleState as __state_options_state_js } from './state.js';
import { debouncedSave, saveOptions } from './storage.js';
import { addSnippetRow } from './snippets.js';
import { addSubgroup } from './subgroups.js';
// --- Hotkey Recording & Global Keyboard Shortcuts ---

export function initHotkeyButtons() {
  document.querySelectorAll('.record-btn').forEach(btn => {
    btn.onclick = () => {
      if (__state_options_state_js.recordingTarget) stopRecording();
      else startRecording(btn);
    };
  });
}

export function startRecording(btn) {
  __state_options_state_js.recordingTarget = btn.dataset.key;
  btn.textContent = 'Cancel';
  btn.classList.add('recording');
  document.getElementById(`hotkey-display-${__state_options_state_js.recordingTarget}`).textContent = 'Press keys...';
  window.addEventListener('keydown', handleKeyCapture);
}

export function stopRecording() {
  if (!__state_options_state_js.recordingTarget) return;
  const btn = document.querySelector(`.record-btn[data-key="${__state_options_state_js.recordingTarget}"]`);
  btn.textContent = 'Change';
  btn.classList.remove('recording');
  document.getElementById(`hotkey-display-${__state_options_state_js.recordingTarget}`).textContent = __state_options_state_js.currentConfig[__state_options_state_js.recordingTarget] || 'None';
  window.removeEventListener('keydown', handleKeyCapture);
  __state_options_state_js.recordingTarget = null;
  debouncedSave();
}

export function handleKeyCapture(e) {
  e.preventDefault();
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

  const modifiers = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Meta');

  let key = e.key;
  if (e.code === 'Space' || key === ' ') key = 'Space';
  else if (key === 'Unidentified' && e.code) key = e.code.replace(/^(Key|Digit)/, '');
  else if (key.length === 1) key = key.toUpperCase();

  __state_options_state_js.currentConfig[__state_options_state_js.recordingTarget] = [...modifiers, key].join('+');
  stopRecording();
}

window.addEventListener('keydown', (e) => {
  if (__state_options_state_js.recordingTarget || e.target?.closest('dialog[open]')) return;

  const matchShortcut = (hotkeyStr) => {
    if (!hotkeyStr) return false;
    const parts = hotkeyStr.toLowerCase().split('+').map(p => p.trim());
    const needsCtrl  = parts.includes('ctrl');
    const needsAlt   = parts.includes('alt');
    const needsShift = parts.includes('shift');
    const needsMeta  = parts.includes('meta') || parts.includes('cmd');
    const keyPart    = parts.find(p => !['ctrl', 'alt', 'shift', 'meta', 'cmd'].includes(p));
    if (e.ctrlKey !== needsCtrl || e.altKey !== needsAlt || e.shiftKey !== needsShift || e.metaKey !== needsMeta) return false;
    const currentKey  = e.key.toLowerCase();
    const currentCode = e.code.toLowerCase();
    if (keyPart === 'space') return currentKey === ' ' || currentCode === 'space';
    return currentKey === keyPart || currentCode === `key${keyPart}` || currentCode === keyPart;
  };

  // Ctrl+S: Save
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveOptions();
    return;
  }

  // Toggle Fold (Alt+L)
  if (matchShortcut(__state_options_state_js.currentConfig.toggleFold)) {
    const row = document.activeElement?.closest('.snippet-row');
    if (row) {
      e.preventDefault();
      row.classList.toggle('collapsed');
      return;
    }
  }

  // Add Snippet (Alt+N)
  if (matchShortcut(__state_options_state_js.currentConfig.addSnippet)) {
    const snippetsTab = document.getElementById('snippets-tab');
    if (snippetsTab.classList.contains('active') && __state_options_state_js.activeGroupIndex !== -1) {
      e.preventDefault();
      addSnippetRow();
      return;
    }
  }

  // Add Subgroup (Alt+G)
  if (matchShortcut(__state_options_state_js.currentConfig.addSubgroup)) {
    const snippetsTab = document.getElementById('snippets-tab');
    if (snippetsTab.classList.contains('active') && __state_options_state_js.activeGroupIndex !== -1) {
      e.preventDefault();
      addSubgroup();
      return;
    }
  }
}, true);
