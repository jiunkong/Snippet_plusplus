// --- Visual Effects: Flash & Ripple Particles ---

let snippetToast = null;
let snippetToastTimer = null;

async function showSnippetError(error) {
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

function showSnippetToast(message, color, tone = 'default') {
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
  }, 6000);
}

function triggerEffect(el, info) {
  if (config?.showParticles === false) return;

  if (info.isInput) {
    el.classList.add('ss-replacement-flash');
    setTimeout(() => el.classList.remove('ss-replacement-flash'), 600);

    const coords = getCaretCoordinates(el, el.selectionStart);
    showRipple(coords.left + window.scrollX, coords.top + window.scrollY + 10);
  } else {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (rect.width === 0) {
      const rects = range.getClientRects();
      if (rects.length) rect = rects[0];
    }
    if (rect.top !== 0 || rect.left !== 0) {
      showRipple(rect.left + window.scrollX, rect.top + window.scrollY);
    }
  }
}

function showRipple(x, y) {
  const container = document.createElement('div');
  container.className = 'ss-ripple-container';
  container.style.left = `${x}px`;
  container.style.top  = `${y}px`;

  const ripple = document.createElement('div');
  ripple.className = 'ss-ripple';
  container.appendChild(ripple);

  for (let i = 0; i < 3; i++) {
    const sparkle = document.createElement('div');
    sparkle.className = 'ss-sparkle';
    const angle = (i / 3) * Math.PI * 2 + (Math.random() * 0.5);
    const dist  = 15 + Math.random() * 20;
    sparkle.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    sparkle.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    sparkle.style.animationDelay = `${Math.random() * 0.1}s`;
    container.appendChild(sparkle);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 800);
}
