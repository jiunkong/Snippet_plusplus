// --- Snippet Row UI, Drag-and-Drop, Conflict Detection ---

// Auto-scroll state
let scrollSpeed    = 0;
let scrollInterval = null;

// Global resizer state
let activeResizer = null;
let startY, startHeight;

window.addEventListener('mousemove', (e) => {
  if (!activeResizer) return;
  const dy = e.pageY - startY;
  const newHeight = Math.max(80, startHeight + dy);
  activeResizer.style.height = newHeight + 'px';
});

window.addEventListener('mouseup', () => {
  if (activeResizer) {
    activeResizer = null;
    document.body.style.cursor = 'default';
  }
});

function startAutoScroll() {
  const scrollContainer = document.getElementById('group-editor-container');
  if (scrollInterval) return;
  scrollInterval = requestAnimationFrame(function scrollLoop() {
    if (scrollSpeed !== 0) scrollContainer.scrollBy(0, scrollSpeed);
    scrollInterval = requestAnimationFrame(scrollLoop);
  });
}

function stopAutoScroll() {
  cancelAnimationFrame(scrollInterval);
  scrollInterval = null;
  scrollSpeed = 0;
}

function getDragAfterElement(container, y) {
  return [...container.querySelectorAll('.snippet-row:not(.dragging)')].reduce((closest, child) => {
    const box    = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function renderSnippetsList(snippets) {
  const list = document.getElementById('snippets-list');
  list.innerHTML = '';
  snippets.forEach(snippet => addSnippetRowUI(snippet));
  checkTriggerConflicts();
}

/**
 * Returns true if the regex matches any prefix of the literal string.
 * This catches cases where a regex trigger fires mid-sequence, preventing
 * the full literal trigger from ever being reached (e.g. ;;${sym:\w} blocks ;;ab).
 */
function regexShadowsLiteral(regex, literal) {
  for (let i = 1; i <= literal.length; i++) {
    if (regex.test(literal.substring(0, i))) return true;
  }
  return false;
}

/**
 * Returns true if trigger pair (c1, c2) would shadow each other.
 * p1/p2 are the literal prefixes (text before first ${) for regex triggers.
 */
function checkConflict(c1, p1, c2, p2) {
  if (!c1.isRegex && !c2.isRegex) {
    // Literal vs Literal: conflict if one is a prefix of the other
    return c1.literal.startsWith(c2.literal) || c2.literal.startsWith(c1.literal);
  } else if (c1.isRegex && !c2.isRegex) {
    // Regex vs Literal: conflict if regex fires on any prefix of the literal
    return !!(c1.regex && regexShadowsLiteral(c1.regex, c2.literal));
  } else if (!c1.isRegex && c2.isRegex) {
    // Literal vs Regex: conflict if regex fires on any prefix of the literal
    return !!(c2.regex && regexShadowsLiteral(c2.regex, c1.literal));
  } else {
    // Regex vs Regex: undecidable in general, skip.
    // (Exact duplicates are caught by t1Raw === t2Raw before calling this.)
    return false;
  }
}

function checkTriggerConflicts() {
  if (activeGroupIndex === -1) return;

  const currentRows = Array.from(document.querySelectorAll('.snippet-row'));

  // For the active group, use DOM directly (avoids index mismatch from filter).
  // For other groups, use snippetGroups store.
  const otherGroupSnippets = [];
  snippetGroups.forEach((group, gIdx) => {
    if (gIdx === activeGroupIndex) return;
    (group.snippets || []).forEach(snip => {
      if (!snip.trigger) return;
      const tRaw = snip.trigger.trim();
      const compiled = compileTrigger(tRaw);
      otherGroupSnippets.push({
        trigger:  tRaw,
        isRegex:  compiled.isRegex,
        regex:    compiled.regex,
        literal:  compiled.isRegex ? null : tRaw,
        prefix:   tRaw.split('${')[0],
        name:     snip.name || 'Unnamed',
        groupName: group.name || `Group ${gIdx + 1}`
      });
    });
  });

  currentRows.forEach((row, rowIndex) => {
    const triggerInput = row.querySelector('.trigger-input');
    const nameInput    = row.querySelector('.snippet-name-input');
    const t1Raw        = triggerInput.value.trim();

    if (!t1Raw) {
      nameInput.classList.add('invalid');
      nameInput.classList.remove('conflict');
      nameInput.title = "Trigger is required.";
      return;
    }
    nameInput.classList.remove('invalid');

    const c1 = compileTrigger(t1Raw);

    // Invalid regex: mark red and skip conflict check
    if (c1.error) {
      nameInput.classList.add('invalid');
      nameInput.classList.remove('conflict');
      nameInput.title = "잘못된 정규표현식";
      return;
    }

    const p1 = t1Raw.split('${')[0];
    const conflicts = [];

    // 1. Compare against other rows in the active group (skip self by DOM index)
    currentRows.forEach((otherRow, otherIdx) => {
      if (otherIdx === rowIndex) return;
      const t2Raw = otherRow.querySelector('.trigger-input').value.trim();
      if (!t2Raw) return;
      const c2  = compileTrigger(t2Raw);
      const p2  = t2Raw.split('${')[0];
      const n2  = otherRow.querySelector('.snippet-name-input').value.trim() || 'Unnamed';
      if (t1Raw === t2Raw || checkConflict(c1, p1, c2, p2)) conflicts.push(`"${t2Raw}" (${n2})`);
    });

    // 2. Compare against snippets from other groups
    otherGroupSnippets.forEach(s2 => {
      const c2 = { isRegex: s2.isRegex, regex: s2.regex, literal: s2.literal };
      if (t1Raw === s2.trigger || checkConflict(c1, p1, c2, s2.prefix)) {
        conflicts.push(`"${s2.trigger}" (${s2.name}) [Group: ${s2.groupName}]`);
      }
    });

    if (conflicts.length > 0) {
      nameInput.classList.add('conflict');
      nameInput.title = "Conflicts:\n- " + [...new Set(conflicts)].join("\n- ");
    } else {
      nameInput.classList.remove('conflict');
      nameInput.title = "";
    }
  });
}

function addSnippetRowUI(snippet = { trigger: '', replacement: '', name: '', collapsed: false }) {
  const list = document.getElementById('snippets-list');
  const row  = document.createElement('div');
  row.className = `snippet-row ${snippet.collapsed ? 'collapsed' : ''}`;
  row.draggable = true;

  const escHtml     = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const safeName    = escHtml(snippet.name    || '');
  const safeTrigger = escHtml(snippet.trigger || '');

  row.innerHTML = `
    <div class="snippet-row-header">
      <div class="drag-handle" title="Drag to reorder">⠿</div>
      <button class="fold-btn" title="Toggle Fold">▾</button>
      <input type="text" class="snippet-name-input" placeholder="${t('snippets_name_placeholder')}" value="${safeName}">
      <span class="collapsed-trigger-display">${safeTrigger}</span>
      <button class="delete-row-btn" title="Delete Snippet">×</button>
    </div>
    <div class="row-inputs">
      <div class="input-group">
        <label>${t('snippets_trigger_label')}</label>
        <div class="trigger-highlight-container">
          <div class="trigger-highlight"></div>
          <input type="text" class="trigger-input" placeholder="${t('snippets_trigger_placeholder')}" value="${safeTrigger}">
        </div>
      </div>
      <div class="input-group">
        <label>${t('snippets_replacement_label')}</label>
        <div class="highlight-container">
          <div class="replacement-highlight"></div>
          <textarea class="replacement-input" placeholder="${t('snippets_replacement_placeholder')}"></textarea>
          <div class="resizer-bar" title="Drag to resize height"></div>
        </div>
        <div class="error-msg-container" style="display: none;"></div>
      </div>
    </div>
  `;

  row.querySelector('.replacement-input').value = snippet.replacement || '';

  // --- Drag-and-Drop ---
  row.addEventListener('mousedown', (e) => {
    row.draggable = !e.target.closest('input, textarea, _highlight-container, _snippet-name-input');
  });

  row.addEventListener('dragstart', (e) => {
    if (!row.draggable) { e.preventDefault(); return; }
    row.classList.add('dragging');
    startAutoScroll();
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    stopAutoScroll();
    syncActiveGroupData();
    debouncedSave();
    checkTriggerConflicts();
  });

  // --- Highlight & Validation ---
  const textarea         = row.querySelector('.replacement-input');
  const triggerInput     = row.querySelector('.trigger-input');
  const highlightDiv     = row.querySelector('.replacement-highlight');
  const triggerHighlight = row.querySelector('.trigger-highlight');
  const errorDiv         = row.querySelector('.error-msg-container');
  const nameInput        = row.querySelector('.snippet-name-input');
  const foldBtn          = row.querySelector('.fold-btn');

  const runUpdate = () => {
    const triggerError = updateTriggerHighlight(triggerInput, triggerHighlight);
    const replacementError = updateHighlight(textarea, highlightDiv, triggerInput.value);
    
    const finalError = triggerError || replacementError;

    if (finalError) { 
      errorDiv.textContent = finalError; 
      errorDiv.style.display = 'block'; 
    } else { 
      errorDiv.style.display = 'none'; 
    }
  };

  runUpdate();

  triggerInput.oninput = () => {
    row.querySelector('.collapsed-trigger-display').textContent = triggerInput.value;
    runUpdate();
    syncActiveGroupData();
    debouncedSave();
    checkTriggerConflicts();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      // Find boundaries of the lines involved
      const firstLineStart = val.lastIndexOf('\n', start - 1) + 1;
      let lastLineEnd = val.indexOf('\n', end);
      if (lastLineEnd === -1) lastLineEnd = val.length;

      const before = val.substring(0, firstLineStart);
      const after = val.substring(lastLineEnd);
      const targetText = val.substring(firstLineStart, lastLineEnd);
      const lines = targetText.split('\n');

      let newText = "";
      let totalChange = 0;
      let firstLineChange = 0;

      if (e.shiftKey) {
        // Multi-line Outdent
        newText = lines.map((line, i) => {
          let remove = 0;
          if (line.startsWith("  ")) remove = 2;
          else if (line.startsWith(" ")) remove = 1;
          
          if (i === 0) firstLineChange = -remove;
          totalChange -= remove;
          return line.substring(remove);
        }).join('\n');
      } else {
        // Multi-line Indent
        newText = lines.map((line, i) => {
          if (i === 0) firstLineChange = 2;
          totalChange += 2;
          return "  " + line;
        }).join('\n');
      }

      // Use execCommand to preserve undo history
      textarea.focus();
      textarea.setSelectionRange(firstLineStart, lastLineEnd);
      document.execCommand('insertText', false, newText);

      // Restore selection adjusted for indentation
      const newStart = Math.max(firstLineStart, start + firstLineChange);
      const newEnd = end + totalChange;
      textarea.setSelectionRange(newStart, newEnd);
      
      runUpdate();
    }
  });

  textarea.oninput  = (e) => {
    // Auto-close for/if blocks
    if (e.inputType === 'insertText' && e.data === '}' && textarea.selectionStart === textarea.selectionEnd) {
      const pos = textarea.selectionStart;
      const val = textarea.value;
      if (val.substring(pos - 2, pos) === '}}') {
        const startIdx = val.lastIndexOf('{{', pos - 3);
        if (startIdx !== -1) {
          const inner = val.substring(startIdx + 2, pos - 2).trim();
          let closing = "";
          if (inner.startsWith('for ')) closing = "endfor";
          else if (inner.startsWith('if ')) closing = "endif";
          else if (inner.startsWith('switch ')) closing = "endswitch";
          else if (inner.startsWith('case ')) closing = "endcase";
          else if (inner === 'default') closing = "enddefault";

          if (closing) {
            // Get current line indentation
            const lineStart = val.lastIndexOf('\n', startIdx - 1) + 1;
            const lineLeading = val.substring(lineStart, startIdx).match(/^\s*/)[0];
            
            let insertText = "";
            let cursorOffset = 0;

            if (closing === "endcase" || closing === "enddefault") {
              insertText = "{{" + closing + "}}";
              cursorOffset = 0;
            } else if (closing === "endswitch") {
              insertText = "\n" + lineLeading + "\n" + lineLeading + "{{" + closing + "}}";
              cursorOffset = 1 + lineLeading.length;
            } else {
              insertText = "\\\n" + lineLeading + "\\\n" + lineLeading + "{{" + closing + "}}";
              cursorOffset = 2 + lineLeading.length;
            }

            // Use execCommand to preserve undo history
            textarea.focus();
            textarea.setSelectionRange(pos, pos);
            document.execCommand('insertText', false, insertText);
            
            // Adjust cursor position
            const newPos = pos + cursorOffset;
            textarea.setSelectionRange(newPos, newPos);
          }
        }
      }
    }
    runUpdate(); 
    syncActiveGroupData(); 
    debouncedSave(); 
  };
  textarea.onscroll = () => { highlightDiv.scrollTop = textarea.scrollTop; };

  triggerInput.onscroll = () => { triggerHighlight.scrollLeft = triggerInput.scrollLeft; };

  new ResizeObserver(() => {
    highlightDiv.style.width  = textarea.offsetWidth  + 'px';
    highlightDiv.style.height = textarea.offsetHeight + 'px';
  }).observe(textarea);

  // --- Custom Resizer Logic ---
  const resizer = row.querySelector('.resizer-bar');
  resizer.addEventListener('mousedown', (e) => {
    activeResizer = textarea;
    startY = e.pageY;
    startHeight = textarea.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    row.draggable = false;
    e.preventDefault();
  });

  new ResizeObserver(() => {
    triggerHighlight.style.width = triggerInput.offsetWidth + 'px';
  }).observe(triggerInput);

  textarea.onkeydown = (e) => {
    if (e.key === 'Backspace' && !e.shiftKey && textarea.selectionStart === textarea.selectionEnd) {
      const pos = textarea.selectionStart;
      const t   = textarea.value;
      if (t.substring(pos - 2, pos) === '}}') {
        const startIdx = t.lastIndexOf('{{', pos - 3);
        if (startIdx !== -1) {
          const tag = t.substring(startIdx, pos);
          // General match for any {{...}} tag that doesn't contain nested braces
          if (/^\{\{[^{}]*\}\}$/u.test(tag)) {
            e.preventDefault();
            textarea.focus();
            textarea.setSelectionRange(startIdx, pos);
            document.execCommand('delete');
            runUpdate();
            syncActiveGroupData();
            debouncedSave();
          }
        }
      }
    }
  };

  nameInput.oninput = () => { syncActiveGroupData(); debouncedSave(); };
  foldBtn.onclick   = () => { row.classList.toggle('collapsed'); };

  row.querySelector('.delete-row-btn').onclick = () => {
    row.remove();
    syncActiveGroupData();
    debouncedSave();
    checkTriggerConflicts();
  };

  list.appendChild(row);
}

function addSnippetRow() {
  addSnippetRowUI();
  syncActiveGroupData();
  debouncedSave();
  checkTriggerConflicts();
  const rows = document.querySelectorAll('.snippet-row');
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    const input   = lastRow.querySelector('.snippet-name-input');
    if (input) { input.focus(); lastRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
}
