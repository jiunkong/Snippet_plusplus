// --- DOM Utilities: Target Detection, Caret Context, Placeholder Navigation ---

function getTargetInfo(el) {
  const VALID_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel']);
  const isInput = el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && VALID_INPUT_TYPES.has(el.type));
  return { isInput, isEditable: el.isContentEditable };
}

// Nested editors may dispatch input at the outer editing host even though the
// selection belongs to a smaller editable field. Keep all offsets in that field.
function getEditorTarget(target) {
  if (!target?.isContentEditable) return target;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return target;
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  const field = element?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
  return field && target.contains(field) && field.contains(range.endContainer) ? field : target;
}

function getCaretContext(el, info) {
  if (info.isInput) {
    return { textBefore: el.value.substring(0, el.selectionEnd), offset: el.selectionEnd };
  }

  if (info.isEditable) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    try {
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(el);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      return { textBefore: preCaretRange.toString(), range };
    } catch (e) {
      console.error("Snippet++: Error getting caret context", e);
      return null;
    }
  }

  return null;
}

/**
 * Finds the next rendered placeholder (⟦n⟧) to jump to.
 * Priority: same level after cursor → next higher level → wrap to min level.
 */
function findNextPlaceholder(text, currentStart, currentEnd) {
  const matches = [];

  const getLevel = (tag) => {
    if (tag === 'cursor' || tag === '#c' || tag === '#cursor') return 0;
    if (tag.startsWith('#')) return parseInt(tag.substring(1), 10) || 0;
    return parseInt(tag, 10) || 0;
  };

  for (const m of text.matchAll(VISUAL_CURSOR_REGEX)) {
    matches.push({ index: m.index, length: m[0].length, level: getLevel(m[1]) });
  }

  if (matches.length === 0) return null;

  const currentMatch = matches.find(m => {
    // Exactly selected
    if (currentStart === m.index && currentEnd === m.index + m.length) return true;
    // Caret is strictly inside
    if (currentStart > m.index && currentStart < m.index + m.length) return true;
    return false;
  });

  const currentLevel = currentMatch ? currentMatch.level : -1;
  const searchPos    = currentMatch ? currentMatch.index + currentMatch.length : currentStart;

  const sameLevel = matches
    .filter(m => m.level === currentLevel && m.index >= searchPos)
    .sort((a, b) => a.index - b.index);
  if (sameLevel.length) return sameLevel[0];

  const nextLevel = matches
    .filter(m => m.level > currentLevel)
    .sort((a, b) => a.level !== b.level ? a.level - b.level : a.index - b.index);
  if (nextLevel.length) return nextLevel[0];

  return [...matches].sort((a, b) => a.level !== b.level ? a.level - b.level : a.index - b.index)[0];
}

function selectPlaceholder(el, info, targetMatch) {
  if (!targetMatch) return false;

  if (info.isInput) {
    el.setSelectionRange(targetMatch.index, targetMatch.index + targetMatch.length);
    el.focus();
    return true;
  }

  // ContentEditable: walk the DOM to find the right text node
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  let charCount = 0;
  let node;

  while (node = walker.nextNode()) {
    const len = node.textContent.length;
    if (charCount + len > targetMatch.index) {
      const placeholder = node.parentElement?.closest?.('.ss-placeholder');
      if (placeholder && el.contains(placeholder)) {
        const range = document.createRange();
        range.selectNode(placeholder);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }

      const offsetInNode = targetMatch.index - charCount;
      const range = document.createRange();
      try {
        range.setStart(node, offsetInNode);
        range.setEnd(node, Math.min(offsetInNode + targetMatch.length, len));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      } catch (e) {
        console.error("Snippet++: Selection error", e);
      }
    }
    charCount += len;
  }

  return false;
}

function placeCaretAtAutoCursor(el, autoCursorId) {
  const marker = el.querySelector(`[data-spp-auto-cursor="${autoCursorId}"]`);
  if (!marker) return false;

  const range = document.createRange();
  range.setStartAfter(marker);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * Mirrors element styles to a hidden div for accurate caret position calculation.
 */
function getCaretCoordinates(element, position) {
  const style = window.getComputedStyle(element);
  const div   = document.createElement('div');

  [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
    'fontSize', 'lineHeight', 'fontFamily',
    'textAlign', 'textTransform', 'textIndent', 'textDecoration',
    'letterSpacing', 'wordSpacing', 'whiteSpace', 'wordBreak'
  ].forEach(prop => div.style[prop] = style[prop]);

  Object.assign(div.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word'
  });

  div.textContent = element.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);
  const elementRect = element.getBoundingClientRect();
  const coords = {
    top:  elementRect.top  + span.offsetTop  - element.scrollTop,
    left: elementRect.left + span.offsetLeft - element.scrollLeft
  };
  document.body.removeChild(div);
  return coords;
}

/**
 * Returns the maximum cursor level found in the given text.
 */
function getMaxCursorLevel(text) {
  if (text instanceof SnippetFragment) return text.maxCursorLevel;
  let max = -1;
  // Check visual tags ⟦1⟧
  for (const m of text.matchAll(VISUAL_CURSOR_REGEX)) {
    const level = parseInt(m[1], 10) || 0;
    if (level > max) max = level;
  }
  return max;
}

function getSelectionOffsets(el) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;

  try {
    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(el);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(el);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
  } catch (_error) {
    return null;
  }
}

function restoreSelectionOffsets(el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  let total = 0;
  let lastNode = null;
  let startPoint = null;
  let endPoint = null;
  let node;

  while (node = walker.nextNode()) {
    lastNode = node;
    const nextTotal = total + node.textContent.length;
    if (!startPoint && start <= nextTotal) startPoint = [node, Math.max(0, start - total)];
    if (!endPoint && end <= nextTotal) endPoint = [node, Math.max(0, end - total)];
    total = nextTotal;
  }

  if (!lastNode) return;
  if (!startPoint) startPoint = [lastNode, lastNode.textContent.length];
  if (!endPoint) endPoint = [lastNode, lastNode.textContent.length];

  const range = document.createRange();
  range.setStart(startPoint[0], Math.min(startPoint[1], startPoint[0].textContent.length));
  range.setEnd(endPoint[0], Math.min(endPoint[1], endPoint[0].textContent.length));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Increments existing placeholder levels by the given offset.
 */
function shiftVisualPlaceholders(target, offset) {
  if (offset <= 0) return target;

  if (typeof target === 'string') {
    return target.replace(VISUAL_CURSOR_REGEX, (match, level) => {
      const newLevel = parseInt(level, 10) + offset;
      return `${VISUAL_OPEN}${newLevel}${VISUAL_CLOSE}`;
    });
  }

  // If target is an Element, we must update its content/value
  const info = getTargetInfo(target);
  if (info.isInput) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    let startDelta = 0;
    let endDelta = 0;
    target.value = target.value.replace(VISUAL_CURSOR_REGEX, (match, level, index) => {
      const newLevel = parseInt(level, 10) + offset;
      const shifted = `${VISUAL_OPEN}${newLevel}${VISUAL_CLOSE}`;
      const delta = shifted.length - match.length;
      if (index + match.length <= start) startDelta += delta;
      if (index + match.length <= end) endDelta += delta;
      return shifted;
    });
    target.setSelectionRange(start + startDelta, end + endDelta);
  } else if (info.isEditable) {
    // Rich-text editors such as Notion may normalize our spans into plain text.
    // Update every visual marker in text nodes, then restore the caret because
    // assigning textContent can otherwise collapse it to the start of the block.
    const placeholders = target.querySelectorAll('.ss-placeholder');
    placeholders.forEach(ph => {
      const level = parseInt(ph.dataset.val.substring(1), 10) || 0;
      const newLevel = level + offset;
      ph.dataset.val = `#${newLevel}`;
    });

    if (typeof document === 'undefined' || typeof document.createTreeWalker !== 'function') {
      placeholders.forEach(ph => {
        const level = parseInt(ph.dataset.val.substring(1), 10) || 0;
        ph.textContent = `${VISUAL_OPEN}${level}${VISUAL_CLOSE}`;
      });
      return;
    }

    const selectionOffsets = getSelectionOffsets(target);
    let textOffset = 0;
    let startDelta = 0;
    let endDelta = 0;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      const original = node.textContent;
      const shifted = original.replace(VISUAL_CURSOR_REGEX, (match, level, index) => {
        const replacement = `${VISUAL_OPEN}${parseInt(level, 10) + offset}${VISUAL_CLOSE}`;
        const delta = replacement.length - match.length;
        const absoluteEnd = textOffset + index + match.length;
        if (selectionOffsets && absoluteEnd <= selectionOffsets.start) startDelta += delta;
        if (selectionOffsets && absoluteEnd <= selectionOffsets.end) endDelta += delta;
        return replacement;
      });
      if (shifted !== original) node.textContent = shifted;
      textOffset += original.length;
    }

    if (selectionOffsets) {
      restoreSelectionOffsets(
        target,
        selectionOffsets.start + startDelta,
        selectionOffsets.end + endDelta
      );
    }
  }
}
