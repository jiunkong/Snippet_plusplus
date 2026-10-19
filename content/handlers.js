import { getEditorSnapshot, withInternalEdit, insertRestoredText, editorMatchesSnapshot, selectEditableText, recordExpansion, settleEditableExpansionCaret, undoLastExpansion } from './expansion.js';
import { processTemplate } from './template.js';
import { showSnippetError, triggerEffect } from './effects.js';
import { SnippetFragment } from '../language-core/src/index.ts';
import { VISUAL_OPEN, VISUAL_CLOSE } from '../utils/constants.js';
import { findNextPlaceholder, shiftVisualPlaceholders, getCaretContext, getEditorTarget, getTargetInfo, selectPlaceholder, placeCaretAtAutoCursor } from './dom.js';
import { moduleState as __state_content_state_js } from './state.js';
// --- Replacement Engine ---

export function showSnippetPrompt(message, signal) {
  const activeEl = document.activeElement;
  let savedRange = null;
  let savedSelection = { start: 0, end: 0 };

  // 1. SAVE SELECTION / RANGE
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange();
  }
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    savedSelection.start = activeEl.selectionStart;
    savedSelection.end = activeEl.selectionEnd;
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'spp-prompt-overlay';
    overlay.style.all = 'initial'; // Reset all inherited styles
    
    overlay.innerHTML = `
      <div class="spp-prompt-modal">
        <div class="spp-prompt-header">
          <div class="spp-prompt-title"><span>✨</span> Snippet++ Prompt</div>
          <div class="spp-prompt-message"></div>
        </div>
        <div class="spp-prompt-body">
          <input type="text" class="spp-prompt-input" placeholder="Type here...">
        </div>
        <div class="spp-prompt-footer">
          <button class="spp-prompt-btn spp-prompt-btn-cancel">Cancel</button>
          <button class="spp-prompt-btn spp-prompt-btn-confirm">Insert</button>
        </div>
      </div>
    `;

    overlay.querySelector('.spp-prompt-message').textContent = String(message);
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.spp-prompt-input');
    const confirmBtn = overlay.querySelector('.spp-prompt-btn-confirm');
    const cancelBtn = overlay.querySelector('.spp-prompt-btn-cancel');

    let finished = false;
    const finish = (val) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      document.body.removeChild(overlay);
      
      // 2. RESTORE SELECTION / FOCUS
      if (activeEl) {
        activeEl.focus();
        if (savedRange && selection) {
          selection.removeAllRanges();
          selection.addRange(savedRange);
        }
        if (activeEl.setSelectionRange) {
          activeEl.setSelectionRange(savedSelection.start, savedSelection.end);
        }
      }

      // Small delay to let browser settle focus
      setTimeout(() => resolve(val || ""), 20);
    };

    const onAbort = () => finish('');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    setTimeout(() => {
      if (finished) return;
      input.focus();
      input.select();
    }, 100);

    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); finish(""); }
      e.stopPropagation();
    };

    input.oninput = (e) => {
      e.stopPropagation();
    };

    // Prevent focus theft (e.g., by Notion)
    input.onblur = () => {
      if (document.contains(overlay)) {
        setTimeout(() => input.focus(), 0);
      }
    };

    confirmBtn.onclick = () => finish(input.value);
    cancelBtn.onclick = () => finish("");
    overlay.onclick = (e) => { if (e.target === overlay) finish(""); };
  });
}

export function showSnippetChoice(title, options, signal) {
  const activeEl = document.activeElement;
  let savedRange = null;
  let savedSelection = { start: 0, end: 0 };

  const selection = window.getSelection();
  if (selection.rangeCount > 0) savedRange = selection.getRangeAt(0).cloneRange();
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    savedSelection.start = activeEl.selectionStart;
    savedSelection.end = activeEl.selectionEnd;
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'spp-prompt-overlay spp-choice-overlay';
    overlay.style.all = 'initial';

    overlay.innerHTML = `
      <div class="spp-prompt-modal spp-choice-modal">
        <div class="spp-prompt-header">
          <div class="spp-prompt-title"><span>📂</span> Snippet++ Choice</div>
          <div class="spp-prompt-message"></div>
        </div>
        <div class="spp-choice-body"></div>
        <div class="spp-prompt-footer">
          <button class="spp-prompt-btn spp-prompt-btn-cancel">Cancel</button>
        </div>
      </div>
    `;

    overlay.querySelector('.spp-prompt-message').textContent = String(title);
    const choiceBody = overlay.querySelector('.spp-choice-body');
    options.forEach((option, index) => {
      const item = document.createElement('div');
      item.className = `spp-choice-item ${index === 0 ? 'active' : ''}`;
      item.dataset.index = String(index);
      item.dataset.value = String(option);
      const key = document.createElement('span');
      key.className = 'spp-choice-key';
      key.textContent = String(index + 1);
      const label = document.createElement('span');
      label.className = 'spp-choice-text';
      label.textContent = String(option);
      item.append(key, label);
      choiceBody.appendChild(item);
    });
    document.body.appendChild(overlay);

    let activeIdx = 0;
    const items = overlay.querySelectorAll('.spp-choice-item');
    const cancelBtn = overlay.querySelector('.spp-prompt-btn-cancel');

    let finished = false;
    const finish = (val) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      document.body.removeChild(overlay);
      if (activeEl) {
        activeEl.focus();
        if (savedRange && selection) {
          selection.removeAllRanges();
          selection.addRange(savedRange);
        }
        if (activeEl.setSelectionRange) activeEl.setSelectionRange(savedSelection.start, savedSelection.end);
      }
      setTimeout(() => resolve(val || ""), 20);
    };

    const updateActive = (newIdx) => {
      if (!items.length) return;
      items[activeIdx].classList.remove('active');
      activeIdx = (newIdx + items.length) % items.length;
      items[activeIdx].classList.add('active');
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    };

    // Global keydown for the overlay
    const handleKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); updateActive(activeIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); updateActive(activeIdx - 1); }
      else if (e.key === 'Enter' && items.length) { e.preventDefault(); finishWithCleanup(items[activeIdx].dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finishWithCleanup(""); }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1;
        if (items[idx]) { e.preventDefault(); finishWithCleanup(items[idx].dataset.value); }
      }
      e.stopPropagation();
    };

    window.addEventListener('keydown', handleKey, true);
    
    // Override finish to remove listener
    const originalFinish = finish;
    const finishWithCleanup = (val) => {
      window.removeEventListener('keydown', handleKey, true);
      originalFinish(val);
    };

    const onAbort = () => finishWithCleanup('');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    items.forEach(item => {
      item.onclick = () => finishWithCleanup(item.dataset.value);
      item.onmouseenter = () => updateActive(parseInt(item.dataset.index));
    });

    cancelBtn.onclick = () => finishWithCleanup("");
    overlay.onclick = (e) => { if (e.target === overlay) finishWithCleanup(""); };
  });
}

export async function selectAndReplace(el, info, context, triggerLength, replacement, args = {}, templateContext) {
  const selection = window.getSelection();
  const triggerText = context.textBefore.slice(-triggerLength);
  const triggerStart = context.textBefore.length - triggerLength;
  let insertionStart = triggerStart;
  const before = getEditorSnapshot(el, info);
  before.caretOffset = context.textBefore.length;
  // Emptying a host editor can end its editing session before the template's
  // async work finishes. Keep a sole trigger until its replacement is ready.
  const replaceTriggerOnInsert = info.isEditable && before.text === triggerText;

  // 1. DELETE TRIGGER SYNCHRONOUSLY (before async boundary)
  const selectTrigger = () => {
    if (info.isInput) {
      el.setSelectionRange(triggerStart, el.selectionEnd);
    } else if (info.isEditable) {
      selection.removeAllRanges();
      selection.addRange(context.range);
      for (let i = 0; i < triggerLength; i++) {
        selection.modify("extend", "backward", "character");
      }
    }
  };
  if (!replaceTriggerOnInsert) {
    selectTrigger();
    withInternalEdit(() => document.execCommand('delete', false, null));
  }

  // 2. PROCESS TEMPLATE (may show prompt modal)
  let processedReplacement;
  try {
    processedReplacement = await processTemplate(replacement, args, templateContext);
  } catch (error) {
    if (!replaceTriggerOnInsert) insertRestoredText(triggerText);
    if (error.name !== 'SnippetPromptCancelled') {
      await showSnippetError(error);
    }
    return { cancelled: true };
  }
  
  // 3. IF CANCELLED, JUST STOP
  if (processedReplacement === null) {
    if (!replaceTriggerOnInsert) insertRestoredText(triggerText);
    return { cancelled: true };
  }
  if (replaceTriggerOnInsert) {
    if (!editorMatchesSnapshot(el, info, before)) return { cancelled: true };
    el.focus({ preventScroll: true });
    // The input event may have caused the host to replace the original nodes.
    // Rebuild the trigger range instead of extending a stale range backwards
    // from the cell's start into the preceding cell.
    if (!selectEditableText(el, 0, before.text.length)) return { cancelled: true };
    // There is no text before a sole trigger for leading backspaces to erase.
    processedReplacement = new SnippetFragment(processedReplacement.nodes.map((node, i) =>
      i === 0 && node.type === 'text' ? { type: 'text', value: node.value.replace(/^\u0008+/, '') } : node));
    if (!processedReplacement.nodes.some(node => node.type === 'text' && node.value.includes('\u0008'))) {
      // Host editors can discard custom spans (including hidden end markers)
      // and reset DOM ranges. Insert native text with the first stop already
      // consumed, then locate the caret in the host's resulting text nodes.
      let text = '';
      for (const node of processedReplacement.nodes) {
        if (node.type === 'text') text += node.value;
        else {
          const marker = `${VISUAL_OPEN}${node.level}${VISUAL_CLOSE}`;
          text += marker;
        }
      }
      // Rendered markers also survive host normalization as ordinary text.
      const firstStop = findNextPlaceholder(text, 0, 0);
      let plainCaretOffset = firstStop ? firstStop.index : text.length;
      if (firstStop) text = text.slice(0, firstStop.index) + text.slice(firstStop.index + firstStop.length);
      withInternalEdit(() => {
        if (text.includes('\n')) {
          // insertText splits multiline input into separate native operations;
          // controlled editors can discard all but the first line. One HTML
          // insertion with ordinary line breaks keeps it in a single edit.
          const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
          document.execCommand('insertHTML', false, html);
        } else document.execCommand('insertText', false, text);
      });
      const afterInsert = getEditorSnapshot(el, info);
      // Some editors retain BR nodes; others normalize them to newline text.
      // Cursor offsets use textContent, which does not count BR nodes.
      if (afterInsert.text !== text && afterInsert.text === text.replace(/\n/g, '')) {
        plainCaretOffset = text.slice(0, plainCaretOffset).replace(/\n/g, '').length;
      }
      return { start: 0, hasPlaceholders: false, before, plainCaretOffset, afterInsert };
    }
  }

  // --- Shift existing placeholders if enabled ---
  if (__state_content_state_js.config.shiftCursorLevels && !replaceTriggerOnInsert) {
    const newMaxLevel = processedReplacement.maxCursorLevel;
    if (newMaxLevel >= 0) {
      // Reserve every level used by the new snippet. Adding only the maximum
      // level causes collisions (and level 0 previously was not shifted at all).
      shiftVisualPlaceholders(el, newMaxLevel + 1);
      const shiftedContext = getCaretContext(el, info);
      if (shiftedContext) insertionStart = shiftedContext.textBefore.length;
    }
  }

  // --- Auto-append cursor if missing (Notion fix) ---
  // If no cursor position is specified, we want the cursor to end up at the very end.
  // We achieve this by automatically appending a hidden cursor node.
  let isAutoCursor = false;
  let autoCursorId = null;
  if (info.isEditable && processedReplacement.maxCursorLevel < 0) {
    processedReplacement = processedReplacement.concat(new SnippetFragment([{ type: 'cursor', level: 0 }]));
    isAutoCursor = true;
    autoCursorId = `spp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // 4. INSERT REPLACEMENT WITH BACKSPACE SUPPORT
  const insertWithBackspaces = (content, isHTML = false) => {
    // A sole trigger has no preceding text for leading backspaces to remove.
    if (replaceTriggerOnInsert) content = content.replace(/^\u0008+/, '');
    const parts = content.split('\u0008');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        // Perform one backspace
        if (info.isInput) {
          const pos = el.selectionStart;
          if (pos > 0) {
            el.setSelectionRange(pos - 1, pos);
            document.execCommand('delete', false, null);
          }
        } else if (info.isEditable) {
          selection.modify("extend", "backward", "character");
          document.execCommand('delete', false, null);
        }
      }
      if (parts[i]) {
        if (isHTML && info.isEditable) {
          document.execCommand('insertHTML', false, parts[i]);
        } else {
          document.execCommand('insertText', false, parts[i]);
        }
      }
    }
  };

  if (info.isInput) {
    const hasPlaceholders = processedReplacement.maxCursorLevel >= 0;
    const visualReplacement = processedReplacement.render(level => `${VISUAL_OPEN}${level}${VISUAL_CLOSE}`);

    withInternalEdit(() => insertWithBackspaces(visualReplacement, false));
    
    if (!hasPlaceholders) {
      // Calculate real inserted length (accounting for \u0008 backspaces)
      const parts = visualReplacement.split('\u0008');
      let netLength = parts[0].length;
      for (let i = 1; i < parts.length; i++) {
        netLength = Math.max(0, netLength - 1) + parts[i].length;
      }
      const newPos = insertionStart + netLength;
      el.setSelectionRange(newPos, newPos);
    }

    return { start: insertionStart, hasPlaceholders, before, afterInsert: getEditorSnapshot(el, info) };
  }
  if (info.isEditable) {
    const hasPlaceholders = processedReplacement.maxCursorLevel >= 0;
    const htmlReplacement = processedReplacement.render(level => {
      const isAuto = isAutoCursor;
      const display = isAuto ? '' : `${VISUAL_OPEN}${level}${VISUAL_CLOSE}`;
      const extraStyle = isAuto ? `style="display:none;" data-spp-auto-cursor="${autoCursorId}"` : '';
      return `<span class="ss-placeholder" ${extraStyle} contenteditable="false" data-val="#${level}">${display}</span>`;
    }, text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>'));

    withInternalEdit(() => insertWithBackspaces(htmlReplacement, true));

    return { start: insertionStart, hasPlaceholders, before, afterInsert: getEditorSnapshot(el, info), autoCursorId };
  }
}

// --- Input Handler ---
export async function handleInput(event) {
  if (__state_content_state_js.isInternalEdit) return;
  // Support for IME (Korean) and prevent aggressive reset
  if (event.inputType === 'insertText' || event.inputType === 'insertCompositionText') {
    if (event.data) {
      __state_content_state_js.typingSeqLength += event.data.length;
    }
  } else if (event.inputType === 'deleteContentBackward') {
    __state_content_state_js.typingSeqLength = Math.max(0, __state_content_state_js.typingSeqLength - 1);
  } else if (event.inputType === 'formatBold' || event.inputType === 'formatItalic') {
    // Ignore formatting events
  } else {
    if (event.inputType && (event.inputType.includes('delete') || event.inputType.includes('paste'))) {
       __state_content_state_js.typingSeqLength = 0;
    }
  }

  const el   = getEditorTarget(event.target);
  const info = getTargetInfo(el);
  
  // IGNORE input from our own prompt modal
  if (el.closest('.spp-prompt-overlay')) return;

  if (!info.isInput && !info.isEditable) return;

  const context = getCaretContext(el, info);
  if (!context) return;

  // Any later edit invalidates the saved transaction.
  if (__state_content_state_js.lastExpansion && __state_content_state_js.lastExpansion.el === el) __state_content_state_js.lastExpansion = null;

  for (const snippet of __state_content_state_js.snippets) {
    let match         = null;
    let triggerLength = 0;

    if (snippet.isRegex) {
      match = context.textBefore.match(snippet.compiledRegex);
      if (match) triggerLength = match[0].length;
    } else {
      if (context.textBefore.endsWith(snippet.literalTrigger)) {
        match         = { groups: {} };
        triggerLength = snippet.literalTrigger.length;
      }
    }

    if (match && __state_content_state_js.typingSeqLength >= triggerLength) {
      __state_content_state_js.typingSeqLength = 0;
      const result = await selectAndReplace(el, info, context, triggerLength, snippet.replacement, match.groups || {}, {
        snippets: snippet.groupSnippets || [],
        stack: snippet.sourceSnippet ? [snippet.sourceSnippet] : []
      });
      if (result.cancelled) break;
      let fullText = '';
      if (info.isInput) {
        fullText = el.value;
      } else {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) fullText += node.textContent;
      }

      // Place the caret before the host editor can normalize the inserted DOM or
      // emit another input event. Deferring this used to make cursor placement
      // depend on a 50 ms race with editors such as Notion.
      placeExpansionCursor(el, info, result, fullText);

      triggerEffect(el, info);
      const expansion = recordExpansion(el, info, result.before, result.autoCursorId);
      if (Number.isInteger(result.plainCaretOffset)) {
        settleEditableExpansionCaret(el, result.plainCaretOffset, expansion);
      }

      break;
    }
  }
}

// --- Keydown Handler (Hotkey Navigation) ---
export function handleKeyDown(event) {
  if (!event.isComposing && isHotkeyPressed(event, __state_content_state_js.config.reloadSnippets) && typeof reloadSettings === 'function') {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) reloadSettings();
    return;
  }
  const el   = getEditorTarget(event.target);
  const info = getTargetInfo(el);
  if (!info.isInput && !info.isEditable) return;

  if (isHotkeyPressed(event, __state_content_state_js.config.nextCursor)) {
    let foundPlaceholder = null;

    if (info.isInput) {
      foundPlaceholder = findNextPlaceholder(el.value, el.selectionStart, el.selectionEnd);
      if (foundPlaceholder) {
        el.setSelectionRange(foundPlaceholder.index, foundPlaceholder.index + foundPlaceholder.length);
      }
    } else {
      const walker    = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let fullText    = '';
      let currentOffset = 0;
      const selection = window.getSelection();
      const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      let node;
      while (node = walker.nextNode()) {
        if (currentRange && node === currentRange.startContainer) {
          currentOffset = fullText.length + currentRange.startOffset;
        }
        fullText += node.textContent;
      }

      foundPlaceholder = findNextPlaceholder(fullText, currentOffset, currentOffset);
      if (foundPlaceholder) selectPlaceholder(el, info, foundPlaceholder);
    }

    if (foundPlaceholder) {
      event.preventDefault();
      setTimeout(() => document.execCommand('delete', false, null), 10);
    }
    return;
  }

  // Ctrl+Z also undoes the most recent snippet expansion, even for users
  // whose saved custom undo hotkey still uses the previous default.
  if (isHotkeyPressed(event, __state_content_state_js.config.undoExpansion) || isHotkeyPressed(event, 'Ctrl+Z')) {
    if (undoLastExpansion()) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
}

// --- Hotkey Matching ---
export function isHotkeyPressed(event, hotkeyString) {
  if (!hotkeyString) return false;
  const parts    = hotkeyString.toLowerCase().split('+').map(p => p.trim());
  const needsCtrl  = parts.includes('ctrl');
  const needsAlt   = parts.includes('alt');
  const needsShift = parts.includes('shift');
  const needsMeta  = parts.includes('meta') || parts.includes('cmd');
  const keyPart    = parts.find(p => !['ctrl', 'alt', 'shift', 'meta', 'cmd'].includes(p));

  if (event.ctrlKey  !== needsCtrl)  return false;
  if (event.altKey   !== needsAlt)   return false;
  if (event.shiftKey !== needsShift) return false;
  if (event.metaKey  !== needsMeta)  return false;

  if (keyPart === 'space' && event.code === 'Space') return true;
  return keyPart && (event.key.toLowerCase() === keyPart || event.code?.toLowerCase() === `key${keyPart}`);
}

export function placeExpansionCursor(el, info, result, fullText) {
  if (info.isEditable && Number.isInteger(result.plainCaretOffset)) {
    el.focus({ preventScroll: true });
    selectEditableText(el, result.plainCaretOffset, result.plainCaretOffset);
    return;
  }
  // An auto cursor means the snippet has no explicit tab stop. Keep the
  // insertion caret at the hidden end marker instead of navigating to an
  // unrelated placeholder that was already in the editor.
  if (result.autoCursorId && info.isEditable) {
    placeCaretAtAutoCursor(el, result.autoCursorId);
    return;
  }

  if (!result.hasPlaceholders) return;
  const nextMatch = findNextPlaceholder(fullText, result.start, result.start);
  if (nextMatch && selectPlaceholder(el, info, nextMatch)) {
    withInternalEdit(() => document.execCommand('delete', false, null));
  }
}

// Host bootstraps provide the appropriate settings source.
export let reloadSettings = async () => {};
export function initializeHandlers({ load = () => {}, reload = async () => {} } = {}) {
  reloadSettings = reload;
  load();
  document.addEventListener('mousedown', () => { __state_content_state_js.typingSeqLength = 0; });
  document.addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) __state_content_state_js.typingSeqLength = 0; });
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeyDown, true);
}

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get reloadSettings() { return reloadSettings; }, set reloadSettings(value) { reloadSettings = value; },
};
