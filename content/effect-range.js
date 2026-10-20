import { getTextChange } from './expansion.js';

// The baseline has already lost the trigger but still has the untouched tail.
// Cap the common prefix at the insertion start so repeated text stays included.
export function getReplacementRange(result, text) {
  if (!result?.effectBefore || !Number.isInteger(result.start)) return null;
  const before = result.effectBefore.text;
  const start = Math.min(result.start, getTextChange(before, text).start);
  const end = text.length - Math.max(0, before.length - result.start);
  return end > start ? { start, end } : null;
}

function textRange(el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0, node, started = false;
  while ((node = walker.nextNode())) {
    const next = offset + node.textContent.length;
    if (!started && start < next) {
      range.setStart(node, Math.max(0, start - offset));
      started = true;
    }
    if (started && end <= next) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return null;
}

function inputRects(el, start, end) {
  // Native controls do not expose text ranges. Mirror their complete value so
  // wrapping, shaping, alignment and tabs are measured by the browser itself.
  const style = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  const properties = [
    'direction', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontStretch',
    'fontVariant', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform',
    'textIndent', 'tabSize', 'wordBreak', 'overflowWrap',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'
  ];
  mirror.style.cssText = 'all: initial !important; position: fixed !important; left: 0 !important; top: 0 !important; visibility: hidden !important; pointer-events: none !important;';
  const setStyle = (property, value) => mirror.style.setProperty(property.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value, 'important');
  for (const property of properties) setStyle(property, style[property]);
  const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  for (const [property, value] of Object.entries({
    boxSizing: 'border-box', borderStyle: 'solid',
    width: `${el.clientWidth + borderX}px`,
    whiteSpace: el.tagName === 'INPUT' || el.wrap === 'off' ? 'pre' : 'pre-wrap'
  })) setStyle(property, value);
  if (el.tagName === 'INPUT') {
    setStyle('lineHeight', `${el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)}px`);
  }
  const node = document.createTextNode(el.value);
  mirror.appendChild(node);
  document.documentElement.appendChild(mirror);
  try {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const origin = mirror.getBoundingClientRect();
    const bounds = el.getBoundingClientRect();
    const scaleX = bounds.width / el.offsetWidth;
    const scaleY = bounds.height / el.offsetHeight;
    return Array.from(range.getClientRects(), rect => ({
      left: bounds.left + (rect.left - origin.left - el.scrollLeft) * scaleX,
      top: bounds.top + (rect.top - origin.top - el.scrollTop) * scaleY,
      width: rect.width * scaleX, height: rect.height * scaleY
    }));
  } finally {
    mirror.remove();
  }
}

export function getReplacementRects(el, info, start, end) {
  const rects = info.isInput ? inputRects(el, start, end)
    : Array.from(textRange(el, start, end)?.getClientRects() || []);
  const bounds = el.getBoundingClientRect();
  const scaleX = bounds.width / el.offsetWidth;
  const scaleY = bounds.height / el.offsetHeight;
  const clip = {
    left: Math.max(0, bounds.left + el.clientLeft * scaleX),
    top: Math.max(0, bounds.top + el.clientTop * scaleY),
    right: Math.min(window.innerWidth, bounds.left + (el.clientLeft + el.clientWidth) * scaleX),
    bottom: Math.min(window.innerHeight, bounds.top + (el.clientTop + el.clientHeight) * scaleY)
  };
  const visible = [];
  for (const rect of rects) {
    const left = Math.max(clip.left, rect.left), top = Math.max(clip.top, rect.top);
    const width = Math.min(clip.right, rect.left + rect.width) - left;
    const height = Math.min(clip.bottom, rect.top + rect.height) - top;
    if (width <= 0 || height <= 0) continue;
    // Inline elements can report the same rectangle as their text nodes.
    if (visible.some(r => Math.abs(r.left - left) < .5 && Math.abs(r.top - top) < .5 &&
        Math.abs(r.width - width) < .5 && Math.abs(r.height - height) < .5)) continue;
    visible.push({ left, top, width, height });
  }
  return visible;
}
