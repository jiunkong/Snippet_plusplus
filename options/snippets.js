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
  return [...container.querySelectorAll(':scope > .snippet-row:not(.dragging)')].reduce((closest, child) => {
    const box    = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function renderSnippetsList(snippets, subgroups = []) {
  const list = document.getElementById('snippets-list');
  list.innerHTML = '';
  const containers = new Map(subgroups.map(subgroup => [subgroup.id, createSubgroupSection(subgroup).querySelector('.subgroup-snippets')]));
  snippets.forEach(snippet => addSnippetRowUI(snippet, containers.get(snippet.subgroupId) || list, true));
  refreshSubgroupSelectors();
  applySnippetSearch();
  checkTriggerConflicts();
  updateAllHighlights();
}

function applySnippetSearch() {
  const search = document.getElementById('snippet-search');
  const query = (search?.value || '').trim().toLocaleLowerCase();
  let visibleCount = 0;
  document.querySelectorAll('#snippets-list .snippet-row').forEach(row => {
    const name = row.querySelector('.snippet-name-input').value.trim().toLocaleLowerCase();
    row.hidden = !!query && !name.includes(query);
    if (!row.hidden) visibleCount++;
  });
  updateSubgroupVisibility(query);
  const emptyMessage = document.getElementById('snippet-search-empty');
  if (emptyMessage) emptyMessage.hidden = !query || visibleCount > 0;
}

// Textarea double-clicks select a word before the event fires. Resolve only
// function names inside template expressions, excluding quoted/literal text.
function snippetFunctionAtSelection(text, selectionStart, selectionEnd) {
  let inTag = false;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!inTag) {
      if (text.slice(i, i + 2) === '{{' && text[i + 2] !== '{') {
        inTag = true;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '`') {
      const literal = scanSnippetQuotedValue(text, i);
      if (literal.error) return null;
      if (selectionStart > i && selectionEnd < literal.end) {
        return snippetFunctionAtSelection(text.slice(i + 1, literal.end - 1), selectionStart - i - 1, selectionEnd - i - 1);
      }
      i = literal.end - 1;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (text.slice(i, i + 2) === '}}') { inTag = false; i++; continue; }
    if (char !== '@') continue;
    const call = parseSnippetCall(text, i);
    if (call.error) continue;
    const nameEnd = call.nameEnd;
    if (selectionStart >= i && selectionStart < nameEnd && selectionEnd <= nameEnd) return call.name;
    i = nameEnd - 1;
  }
  return null;
}

function navigateToSnippetFunction(textarea, event) {
  const name = snippetFunctionAtSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd);
  if (name === null) return false;
  const matches = Array.from(document.querySelectorAll('#snippets-list .snippet-row'))
    .filter(row => row.querySelector('.snippet-name-input').value === name);
  if (matches.length !== 1) return false;

  event.preventDefault();
  const target = matches[0];
  const search = document.getElementById('snippet-search');
  if (search?.value) { search.value = ''; applySnippetSearch(); }
  const wasCollapsed = target.classList.contains('collapsed');
  const subgroupWasCollapsed = revealSnippetSubgroup(target);
  target.classList.remove('collapsed');
  const body = target.querySelector('.replacement-input');
  body.focus({ preventScroll: true });
  body.setSelectionRange(0, 0);
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (wasCollapsed || subgroupWasCollapsed) { syncActiveGroupData(); debouncedSave(); }
  return true;
}

function updateSnippetFunctionCursor(textarea, highlightDiv, event) {
  // The transparent textarea receives events above the highlight layer. Use
  // the rendered name's rectangles so wrapping and scrolling stay aligned.
  const nameSpan = Array.from(highlightDiv.querySelectorAll('.hl-fn-snippet, .hl-fn-err')).find(span =>
    !parseSnippetFunctionName(span.textContent).error &&
    Array.from(span.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX < rect.right &&
      event.clientY >= rect.top && event.clientY < rect.bottom)
  );
  const name = nameSpan ? parseSnippetFunctionName(nameSpan.textContent).name : null;
  const matches = name ? Array.from(document.querySelectorAll('#snippets-list .snippet-row'))
    .filter(row => row.querySelector('.snippet-name-input').value === name) : [];
  textarea.style.cursor = matches.length === 1 ? 'pointer' : '';
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
      if (!snip.trigger || snip.disabled === true) return;
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

    if (row.classList.contains('is-disabled')) {
      nameInput.classList.remove('invalid');
      nameInput.classList.remove('conflict');
      nameInput.title = '';
      return;
    }

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
      if (otherIdx === rowIndex || otherRow.classList.contains('is-disabled')) return;
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

function addSnippetRowUI(snippet = { trigger: '', replacement: '', name: '', collapsed: false }, container, deferRefresh = false) {
  const list = container || document.getElementById('snippets-list');
  const row  = document.createElement('div');
  row.className = `snippet-row ${snippet.collapsed ? 'collapsed' : ''} ${snippet.disabled === true ? 'is-disabled' : ''}`;
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
      <select class="snippet-subgroup-select" aria-label="${escHtml(t('subgroups_move'))}"></select>
      <label class="switch snippet-enable-switch" title="${escHtml(t('snippets_enabled_hint'))}">
        <input type="checkbox" class="snippet-enabled-toggle" aria-label="${escHtml(t('snippets_enabled_hint'))}">
        <span class="slider round"></span>
      </label>
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
    row.draggable = !document.getElementById('snippet-search')?.value.trim() &&
      !e.target.closest('input, textarea, select, button, label, .highlight-container, .snippet-name-input');
  });

  row.addEventListener('dragstart', (e) => {
    if (!row.draggable || document.getElementById('snippet-search')?.value.trim()) { e.preventDefault(); return; }
    row.classList.add('dragging');
    startAutoScroll();
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    stopAutoScroll();
    refreshSubgroupSelectors();
    applySnippetSearch();
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
  const enabledToggle    = row.querySelector('.snippet-enabled-toggle');
  enabledToggle.checked = snippet.disabled !== true;
  enabledToggle.onchange = () => {
    row.classList.toggle('is-disabled', !enabledToggle.checked);
    syncActiveGroupData();
    debouncedSave();
    checkTriggerConflicts();
  };

  const runUpdate = () => {
    const triggerError = updateTriggerHighlight(triggerInput, triggerHighlight);
    // Read the active group's rows so unsaved name/trigger edits are included.
    const library = Array.from(document.querySelectorAll('#snippets-list .snippet-row')).map(item => ({
      name: item.querySelector('.snippet-name-input').value,
      trigger: item.querySelector('.trigger-input').value.trim()
    }));
    const replacementError = updateHighlight(textarea, highlightDiv, triggerInput.value, library, nameInput.value);
    
    const finalError = triggerError || replacementError;

    if (finalError) { 
      errorDiv.textContent = finalError; 
      errorDiv.style.display = 'block'; 
    } else { 
      errorDiv.style.display = 'none'; 
    }
  };

  row.updateValidation = runUpdate;
  textarea.addEventListener('dblclick', event => navigateToSnippetFunction(textarea, event));
  textarea.addEventListener('mousemove', event => updateSnippetFunctionCursor(textarea, highlightDiv, event));
  textarea.addEventListener('mouseleave', () => { textarea.style.cursor = ''; });

  triggerInput.oninput = () => {
    row.querySelector('.collapsed-trigger-display').textContent = triggerInput.value;
    updateAllHighlights();
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
  textarea.onscroll = () => {
    highlightDiv.scrollTop = textarea.scrollTop;
    textarea.style.cursor = '';
  };

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

  nameInput.oninput = () => { applySnippetSearch(); updateAllHighlights(); syncActiveGroupData(); debouncedSave(); };
  foldBtn.onclick   = () => { row.classList.toggle('collapsed'); };
  const subgroupSelect = row.querySelector('.snippet-subgroup-select');
  subgroupSelect.onchange = () => moveSnippetToSubgroup(row, subgroupSelect.value);

  row.querySelector('.delete-row-btn').onclick = () => {
    row.remove();
    applySnippetSearch();
    updateAllHighlights();
    syncActiveGroupData();
    debouncedSave();
    checkTriggerConflicts();
  };

  appendSnippetToContainer(row, list);
  if (!deferRefresh) { refreshSubgroupSelectors(); runUpdate(); }
  return row;
}

function addSnippetRow(subgroupId = '') {
  const search = document.getElementById('snippet-search');
  if (search?.value) {
    search.value = '';
    applySnippetSearch();
  }
  const section = findSubgroupSection(subgroupId);
  if (section) setSubgroupCollapsed(section, false, false);
  const newRow = addSnippetRowUI(undefined, section?.querySelector('.subgroup-snippets'));
  applySnippetSearch();
  updateAllHighlights();
  syncActiveGroupData();
  debouncedSave();
  checkTriggerConflicts();
  const input = newRow.querySelector('.snippet-name-input');
  input.focus();
  newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
