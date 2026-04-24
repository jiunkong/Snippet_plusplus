// --- Replacement Engine ---

function showSnippetPrompt(message) {
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
          <div class="spp-prompt-message">${message}</div>
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

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.spp-prompt-input');
    const confirmBtn = overlay.querySelector('.spp-prompt-btn-confirm');
    const cancelBtn = overlay.querySelector('.spp-prompt-btn-cancel');

    const finish = (val) => {
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

    setTimeout(() => {
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

function showSnippetChoice(title, options) {
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

    const optionsHtml = options.map((opt, i) => `
      <div class="spp-choice-item ${i === 0 ? 'active' : ''}" data-value="${opt}" data-index="${i}">
        <span class="spp-choice-key">${i + 1}</span>
        <span class="spp-choice-text">${opt}</span>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="spp-prompt-modal spp-choice-modal">
        <div class="spp-prompt-header">
          <div class="spp-prompt-title"><span>📂</span> Snippet++ Choice</div>
          <div class="spp-prompt-message">${title}</div>
        </div>
        <div class="spp-choice-body">
          ${optionsHtml}
        </div>
        <div class="spp-prompt-footer">
          <button class="spp-prompt-btn spp-prompt-btn-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let activeIdx = 0;
    const items = overlay.querySelectorAll('.spp-choice-item');
    const cancelBtn = overlay.querySelector('.spp-prompt-btn-cancel');

    const finish = (val) => {
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
      items[activeIdx].classList.remove('active');
      activeIdx = (newIdx + items.length) % items.length;
      items[activeIdx].classList.add('active');
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    };

    // Global keydown for the overlay
    const handleKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); updateActive(activeIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); updateActive(activeIdx - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); finish(items[activeIdx].dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(""); }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1;
        if (items[idx]) { e.preventDefault(); finish(items[idx].dataset.value); }
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

    items.forEach(item => {
      item.onclick = () => finishWithCleanup(item.dataset.value);
      item.onmouseenter = () => updateActive(parseInt(item.dataset.index));
    });

    cancelBtn.onclick = () => finishWithCleanup("");
    overlay.onclick = (e) => { if (e.target === overlay) finishWithCleanup(""); };
  });
}

async function selectAndReplace(el, info, context, triggerLength, replacement, args = {}) {
  const selection = window.getSelection();
  const triggerText = context.textBefore.slice(-triggerLength);

  // 1. DELETE TRIGGER SYNCHRONOUSLY (before async boundary)
  if (info.isInput) {
    const startPos = el.selectionEnd - triggerLength;
    el.setSelectionRange(startPos, el.selectionEnd);
  } else if (info.isEditable) {
    selection.removeAllRanges();
    selection.addRange(context.range);
    for (let i = 0; i < triggerLength; i++) {
      selection.modify("extend", "backward", "character");
    }
  }
  document.execCommand('delete', false, null);

  // 2. PROCESS TEMPLATE (may show prompt modal)
  const processedReplacement = await processTemplate(replacement, args);
  
  // --- Shift existing placeholders if enabled ---
  if (config.shiftCursorLevels) {
    const newMaxLevel = getMaxCursorLevel(processedReplacement);
    if (newMaxLevel >= 1) {
      shiftVisualPlaceholders(el, newMaxLevel);
    }
  }
  
  // 3. IF CANCELLED, JUST STOP
  if (processedReplacement === null || (processedReplacement === "" && replacement.includes('prompt('))) {
    return { start: 0 };
  }

  const getDisplay = (tag) => {
    if (tag === 'cursor' || tag === '#cursor') return '0';
    if (tag.startsWith('#')) return tag.substring(1);
    return tag;
  };

  // 4. INSERT REPLACEMENT WITH BACKSPACE SUPPORT
  const insertWithBackspaces = (content, isHTML = false) => {
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
    let hasPlaceholders = false;
    const visualReplacement = processedReplacement.replace(CURSOR_REGEX, (_, p1) => {
      hasPlaceholders = true;
      return `${VISUAL_OPEN}${getDisplay(p1)}${VISUAL_CLOSE}`;
    });
    const beforeInsert = el.selectionStart;
    insertWithBackspaces(visualReplacement, false);
    
    if (!hasPlaceholders) {
      // Calculate real inserted length (accounting for \u0008 backspaces)
      const parts = visualReplacement.split('\u0008');
      let netLength = parts[0].length;
      for (let i = 1; i < parts.length; i++) {
        netLength = Math.max(0, netLength - 1) + parts[i].length;
      }
      const newPos = beforeInsert + netLength;
      el.setSelectionRange(newPos, newPos);
    }
    
    return { start: beforeInsert, hasPlaceholders }; 
  }

  if (info.isEditable) {
    let hasPlaceholders = false;
    const escaped = processedReplacement
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const markerId = `spp-cursor-${Date.now()}`;
    let htmlReplacement = escaped
      .replace(CURSOR_REGEX, (_, p1) => {
        hasPlaceholders = true;
        const displayVal = getDisplay(p1);
        const display    = `${VISUAL_OPEN}${displayVal}${VISUAL_CLOSE}`;
        return `<span class="ss-placeholder" contenteditable="false" data-val="${p1}">${display}</span>`;
      })
      .replace(/\n/g, '<br>');

    // If no placeholders, add a temporary marker to track the end position
    if (!hasPlaceholders) {
      htmlReplacement += `<span id="${markerId}" style="display:none; line-height:0;">\u200b</span>`;
    }

    insertWithBackspaces(htmlReplacement, true);

    if (!hasPlaceholders) {
      // Find the marker and move the cursor there
      const marker = document.getElementById(markerId);
      if (marker) {
        const range = document.createRange();
        range.setStartAfter(marker);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        marker.remove();
        
        // Notion fix: ensure focus is maintained
        if (el && typeof el.focus === 'function') el.focus();
      }
    }

    return { start: 0, hasPlaceholders };
  }
}

// --- Input Handler ---
async function handleInput(event) {
  // Support for IME (Korean) and prevent aggressive reset
  if (event.inputType === 'insertText' || event.inputType === 'insertCompositionText') {
    if (event.data) {
      typingSeqLength += event.data.length;
    }
  } else if (event.inputType === 'deleteContentBackward') {
    typingSeqLength = Math.max(0, typingSeqLength - 1);
  } else if (event.inputType === 'formatBold' || event.inputType === 'formatItalic') {
    // Ignore formatting events
  } else {
    if (event.inputType && (event.inputType.includes('delete') || event.inputType.includes('paste'))) {
       typingSeqLength = 0;
    }
  }

  const el   = event.target;
  const info = getTargetInfo(el);
  
  // IGNORE input from our own prompt modal
  if (el.closest('.spp-prompt-overlay')) return;

  if (!info.isInput && !info.isEditable) return;

  const context = getCaretContext(el, info);
  if (!context) return;

  for (const snippet of snippets) {
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

    if (match && typingSeqLength >= triggerLength) {
      typingSeqLength = 0;
      const result = await selectAndReplace(el, info, context, triggerLength, snippet.replacement, match.groups || {});

      setTimeout(() => {
        let fullText = '';
        if (info.isInput) {
          fullText = el.value;
        } else {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while (node = walker.nextNode()) fullText += node.textContent;
        }

        const nextMatch       = result.hasPlaceholders ? findNextPlaceholder(fullText, result.start, result.start) : null;
        const placeholderFound = nextMatch && selectPlaceholder(el, info, nextMatch);

        triggerEffect(el, info);

        if (placeholderFound) document.execCommand('delete', false, null);
      }, 50);

      break;
    }
  }
}

// --- Keydown Handler (Hotkey Navigation) ---
function handleKeyDown(event) {
  if (!isHotkeyPressed(event, config.nextCursor)) return;

  const el   = event.target;
  const info = getTargetInfo(el);
  if (!info.isInput && !info.isEditable) return;

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
}

// --- Hotkey Matching ---
function isHotkeyPressed(event, hotkeyString) {
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
  return keyPart && event.key.toLowerCase() === keyPart.toLowerCase();
}

// --- Initialization ---
loadSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') loadSettings();
});

// Interruption detection: reset typing sequence on mouse click or arrow keys
document.addEventListener('mousedown', () => { typingSeqLength = 0; });
document.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) typingSeqLength = 0;
});

document.addEventListener('input',   handleInput,   true);
document.addEventListener('keydown', handleKeyDown, true);
