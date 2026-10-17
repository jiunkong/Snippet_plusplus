// A single expansion is undoable only while the editor still contains the
// exact result we inserted. This avoids deleting unrelated user text.
function getEditorSnapshot(el, info) {
  return info.isInput
    ? { text: el.value }
    : { text: el.textContent, html: el.innerHTML };
}

function editorMatchesSnapshot(el, info, snapshot) {
  const current = getEditorSnapshot(el, info);
  return current.text === snapshot.text && current.html === snapshot.html;
}

function withInternalEdit(action) {
  isInternalEdit = true;
  try {
    return action();
  } finally {
    isInternalEdit = false;
  }
}

function insertRestoredText(text) {
  return withInternalEdit(() => document.execCommand('insertText', false, text));
}

function getTextChange(before, after) {
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

function recordExpansion(el, info, before, autoCursorId) {
  const after = getEditorSnapshot(el, info);
  if (before.text === after.text && before.html === after.html) return null;
  lastExpansion = { el, before, after, autoCursorId, timestamp: Date.now() };
  return lastExpansion;
}

function selectEditableText(el, start, end) {
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

function undoLastExpansion() {
  if (!lastExpansion) return false;
  const expansion = lastExpansion;
  const { el, before, after } = expansion;
  if (document.activeElement !== el) return false;
  if (Date.now() - expansion.timestamp > 30000) {
    lastExpansion = null;
    return false;
  }

  const info = getTargetInfo(el);
  if (!editorMatchesSnapshot(el, info, after)) {
    lastExpansion = null;
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
  lastExpansion = null;
  return true;
}
