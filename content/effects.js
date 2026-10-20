import { DEFAULT_TOAST_DURATION_SECONDS, validateToastDuration } from '../language-core/src/index.ts';
import { currentSnippetLocale, loadSnippetLocale, snippetMessage, createSnippetError } from '../utils/i18n.js';
import { moduleState as __state_content_state_js } from './state.js';
import { getReplacementRange, getReplacementRects } from './effect-range.js';
// --- Expansion feedback and snippet toasts ---

export let snippetToast = null;
export let snippetToastTimer = null;

export async function showSnippetError(error) {
  const locale = currentSnippetLocale();
  await loadSnippetLocale(locale);
  let detail = (error?.messageKey && snippetMessage(error.messageKey, error.messageValues, locale))
    || String(error?.message || error);
  const location = error?.snippetLocation;
  if (location) {
    const values = location.snippetName
      ? [location.snippetName, location.line, location.column] : [location.line, location.column];
    const key = location.snippetName ? 'error_location_snippet' : 'error_location';
    const label = snippetMessage(key, values, locale) ||
      `${location.snippetName ? location.snippetName + ' · ' : ''}line ${location.line}, column ${location.column}`;
    detail += '\n' + label;
  }
  const message = snippetMessage('status_expansion_failed', [detail], locale)
    || `Snippet++: Expansion failed. ${detail}`;
  showSnippetToast(message, '#f87171', true);
}

export function showSnippetToast(message, color, tone = 'default', durationSeconds = DEFAULT_TOAST_DURATION_SECONDS) {
  validateToastDuration(durationSeconds);
  const isError = tone === true || tone === 'error';
  const accent = String(color ?? '').trim();
  if (!accent || !CSS.supports('color', accent) || /^(inherit|initial|unset|revert|revert-layer|currentcolor)$/i.test(accent) || /\b(?:var|env)\s*\(/i.test(accent)) {
    throw createSnippetError('err_toast_color');
  }
  if (snippetToastTimer !== null) clearTimeout(snippetToastTimer);

  if (!snippetToast?.host.isConnected) {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'false');
    host.style.cssText = 'all: initial !important; position: fixed !important; right: 20px !important; bottom: 20px !important; z-index: 2147483647 !important; width: max-content !important; max-width: calc(100vw - 40px) !important; pointer-events: none !important;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .toast { box-sizing: border-box; max-width: 440px; padding: 14px 18px;
        border: 1px solid #f87171; border-left-width: 4px; border-radius: 10px; background: #450a0a;
        color: #fef2f2; box-shadow: 0 6px 24px #0004;
        font: 14px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
    </style><div class="toast" role="alert" aria-atomic="true"></div>`;
    snippetToast = { host, message: root.querySelector('.toast') };
    document.documentElement.appendChild(host);
  }
  snippetToast.message.setAttribute('role', isError ? 'alert' : 'status');
  snippetToast.message.style.borderColor = accent;
  snippetToast.message.style.backgroundColor = isError ? '#450a0a' : tone === 'success' ? '#052e16' : '#0f172a';
  // Messages can contain snippet text; always insert them as plain text.
  snippetToast.message.textContent = String(message ?? '');
  snippetToast.message.style.whiteSpace = 'pre-wrap';
  snippetToastTimer = setTimeout(() => {
    snippetToast.host.remove();
    snippetToast = null;
    snippetToastTimer = null;
  }, Math.max(1, Math.round(durationSeconds * 1000)));
}

export function triggerEffect(el, info, result) {
  if (__state_content_state_js.config?.showParticles === false ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const text = info.isInput ? el.value : el.textContent;
  const range = getReplacementRange(result, text);
  if (!range) return;
  const rects = getReplacementRects(el, info, range.start, range.end);
  if (rects.length) showReplacementIndicator(rects, el);
}

export function showReplacementIndicator(rects, el) {
  // Paint over the measured text without touching editor content or selection.
  const host = document.createElement('div');
  host.className = 'ss-replacement-indicator';
  host.setAttribute('contenteditable', 'false');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    @keyframes fade { from { opacity: 1; } to { opacity: 0; } }
    .marks { animation: fade 380ms ease-out both; }
    .mark { position: absolute; border-radius: 2px; background: rgb(126 159 199 / 18%); }
  </style><div class="marks"></div>`;
  const marks = root.querySelector('.marks');
  for (const rect of rects) {
    const mark = document.createElement('div');
    mark.className = 'mark';
    Object.assign(mark.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    marks.appendChild(mark);
  }
  document.documentElement.appendChild(host);
  const position = target => target === window ? [window.scrollX, window.scrollY] : [target.scrollLeft, target.scrollTop];
  const scrollPositions = new Map([[window, position(window)]]);
  for (let target = el; target; target = target.parentElement) scrollPositions.set(target, position(target));
  const onScroll = event => {
    const target = event.target === document ? window : event.target;
    const before = scrollPositions.get(target);
    const after = position(target);
    // Native controls may deliver their insertion scroll event after we have
    // already measured its final position. That event does not move the marks.
    if (before && (before[0] !== after[0] || before[1] !== after[1])) cleanup();
  };
  const cleanup = () => {
    clearTimeout(timer);
    host.remove();
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', cleanup);
    document.removeEventListener('beforeinput', cleanup, true);
    document.removeEventListener('pointerdown', cleanup, true);
  };
  const timer = setTimeout(cleanup, 400);
  // Measurements become stale as soon as the user edits or moves the viewport.
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', cleanup);
  document.addEventListener('beforeinput', cleanup, true);
  document.addEventListener('pointerdown', cleanup, true);
}

// Mutable module state is shared explicitly through accessors.
export const moduleState = {
  get snippetToast() { return snippetToast; }, set snippetToast(value) { snippetToast = value; },
  get snippetToastTimer() { return snippetToastTimer; }, set snippetToastTimer(value) { snippetToastTimer = value; },
};
