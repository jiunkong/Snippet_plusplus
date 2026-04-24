// --- DOM Utilities: Target Detection, Caret Context, Placeholder Navigation ---

function getTargetInfo(el) {
  const VALID_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel']);
  const isInput = el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && VALID_INPUT_TYPES.has(el.type));
  return { isInput, isEditable: el.isContentEditable };
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
 * Finds the next placeholder (⟦n⟧ or {{n}}) to jump to.
 * Priority: same level after cursor → next higher level → wrap to min level.
 */
function findNextPlaceholder(text, currentStart, currentEnd) {
  const matches = [];

  const getLevel = (tag) => {
    if (tag === 'cursor' || tag === '#c' || tag === '#cursor') return 0;
    if (tag.startsWith('#')) return parseInt(tag.substring(1), 10) || 0;
    return parseInt(tag, 10) || 0;
  };

  for (const m of text.matchAll(CURSOR_REGEX)) {
    matches.push({ index: m.index, length: m[0].length, level: getLevel(m[1]) });
  }
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
  let max = -1;
  // Check static tags {{#1}}, {{#2}}
  for (const m of text.matchAll(CURSOR_REGEX)) {
    const level = (m[1] === 'cursor' || m[1] === '#c' || m[1] === '#cursor') ? 0 : (parseInt(m[1].substring(1), 10) || 0);
    if (level > max) max = level;
  }
  // Check visual tags ⟦1⟧
  for (const m of text.matchAll(VISUAL_CURSOR_REGEX)) {
    const level = parseInt(m[1], 10) || 0;
    if (level > max) max = level;
  }
  return max;
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
    target.value = target.value.replace(VISUAL_CURSOR_REGEX, (match, level) => {
      const newLevel = parseInt(level, 10) + offset;
      return `${VISUAL_OPEN}${newLevel}${VISUAL_CLOSE}`;
    });
    // Restore selection
    target.setSelectionRange(start, end);
  } else if (info.isEditable) {
    // For ContentEditable, search for .ss-placeholder spans and update text and data-val
    const placeholders = target.querySelectorAll('.ss-placeholder');
    placeholders.forEach(ph => {
      const level = parseInt(ph.dataset.val.substring(1), 10) || 0;
      const newLevel = level + offset;
      ph.textContent = `${VISUAL_OPEN}${newLevel}${VISUAL_CLOSE}`;
      ph.dataset.val = `#${newLevel}`;
    });
  }
}
