import { moduleState as __state_content_state_js } from './state.js';
import { getEditorTarget, getTargetInfo } from './dom.js';
// A single expansion is undoable only while the editor still contains the
// exact result we inserted. This avoids deleting unrelated user text.
export function getEditorSnapshot(el, info) {
  return info.isInput
    ? { text: el.value }
    : { text: el.textContent, html: el.innerHTML };
}

export function editorMatchesSnapshot(el, info, snapshot) {
  const current = getEditorSnapshot(el, info);
  return current.text === snapshot.text && current.html === snapshot.html;
}

export function withInternalEdit(action) {
  __state_content_state_js.isInternalEdit = true;
  try {
    return action();
  } finally {
    __state_content_state_js.isInternalEdit = false;
  }
}

export function insertRestoredText(text) {
  return withInternalEdit(() => document.execCommand('insertText', false, text));
}

export function getTextChange(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }

  return { start, removed: before.slice(start, beforeEnd), inserted: after.slice(start, afterEnd) };
}

export function recordExpansion(el, info, before, autoCursorId) {
  const after = getEditorSnapshot(el, info);
  if (before.text === after.text && before.html === after.html) return null;
  __state_content_state_js.lastExpansion = { el, before, after, autoCursorId, timestamp: Date.now() };
  return __state_content_state_js.lastExpansion;
}

export function selectEditableText(el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  const range = document.createRange();
  if (!nodes.length) {
    if (start !== 0 || end !== 0) return false;
    range.selectNodeContents(el);
    range.collapse(true);
  } else {
    const boundary = offset => {
      let count = 0;
      for (const textNode of nodes) {
        const next = count + textNode.textContent.length;
        if (offset <= next) return { node: textNode, offset: offset - count };
        count = next;
      }
      return null;
    };
    const from = boundary(start);
    const to = boundary(end);
    if (!from || !to) return false;
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  }

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function undoLastExpansion() {
  if (!__state_content_state_js.lastExpansion) return false;
  const expansion = __state_content_state_js.lastExpansion;
  const { el, before, after } = expansion;
  if (document.activeElement !== el && getEditorTarget(document.activeElement) !== el) return false;
  if (Date.now() - expansion.timestamp > 30000) {
    __state_content_state_js.lastExpansion = null;
    return false;
  }

  const info = getTargetInfo(el);
  if (!editorMatchesSnapshot(el, info, after)) {
    __state_content_state_js.lastExpansion = null;
    return false;
  }

  const change = getTextChange(before.text, after.text);
  if (info.isInput) {
    el.setSelectionRange(change.start, change.start + change.inserted.length);
  } else if (info.isEditable) {
    if (!selectEditableText(el, change.start, change.start + change.inserted.length)) return false;
  } else {
    return false;
  }

  if (change.inserted || change.removed) {
    const restored = change.removed
      ? insertRestoredText(change.removed)
      : withInternalEdit(() => document.execCommand('delete', false, null));
    if (!restored) return false;
  }
  if (expansion.autoCursorId) {
    el.querySelector(`[data-spp-auto-cursor="${expansion.autoCursorId}"]`)?.remove();
  }
  // The changed text can end before the original caret (for example when the
  // replacement keeps a common suffix). Restore the saved position explicitly.
  const caretOffset = before.caretOffset ?? change.start + change.removed.length;
  if (info.isInput) el.setSelectionRange(caretOffset, caretOffset);
  else selectEditableText(el, caretOffset, caretOffset);
  __state_content_state_js.lastExpansion = null;
  return true;
}

// Some host editors restore their own selection during the next render. Resolve
// the offset again against fresh text nodes, and stop as soon as the user acts.
export function settleEditableExpansionCaret(el, offset, expansion) {
  if (!expansion || typeof requestAnimationFrame !== 'function') return;
  const events = ['pointerdown', 'keydown', 'beforeinput', 'compositionstart'];
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const event of events) document.removeEventListener(event, stop, true);
  };
  for (const event of events) document.addEventListener(event, stop, true);
  let frames = 0;
  const restore = () => {
    if (stopped) return;
    if (__state_content_state_js.lastExpansion !== expansion || !el.isConnected || el.textContent !== expansion.after.text) {
      stop();
      return;
    }
    el.focus({ preventScroll: true });
    selectEditableText(el, offset, offset);
    if (++frames < 2) requestAnimationFrame(restore);
    else stop();
  };
  requestAnimationFrame(restore);
}
