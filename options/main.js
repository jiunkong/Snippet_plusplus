import { restoreOptions, exportSettings, importSettings, debouncedSave, exportActiveGroup, importGroup } from './storage.js';
import { addGroup, deleteActiveGroup, syncActiveGroupData, addDisabledSiteRow } from './groups.js';
import { addSnippetRow, applySnippetSearch, moduleState as __state_options_snippets_js, startAutoScroll, getDragAfterElement, stopAutoScroll } from './snippets.js';
import { addSubgroup, reorderSubgroup, setSubgroupCollapsed, appendSnippetToContainer } from './subgroups.js';
import { refreshSnippetTester } from './tester.js';
// --- Main Entry Point: Event Binding & Initialization ---

export const snippetsList = document.getElementById('snippets-list');

document.addEventListener('DOMContentLoaded', restoreOptions);

document.getElementById('add-group-btn').addEventListener('click', addGroup);
document.getElementById('add-snippet-btn').addEventListener('click', () => addSnippetRow());
document.getElementById('add-subgroup-btn').addEventListener('click', addSubgroup);
document.getElementById('delete-group-btn').addEventListener('click', deleteActiveGroup);
document.getElementById('export-btn').addEventListener('click', exportSettings);
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', importSettings);
document.getElementById('active-group-name').addEventListener('input', () => { syncActiveGroupData(); debouncedSave(); });
document.getElementById('add-site-btn').addEventListener('click', () => {
  addDisabledSiteRow("");
  syncActiveGroupData();
  debouncedSave();
});

document.getElementById('export-group-btn').addEventListener('click', exportActiveGroup);
document.getElementById('import-group-btn').addEventListener('click', () => document.getElementById('import-group-file').click());
document.getElementById('import-group-file').addEventListener('change', importGroup);
document.getElementById('snippet-search').addEventListener('input', applySnippetSearch);

// Tab Switching
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
    document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    if (btn.dataset.tab === 'tester') refreshSnippetTester();
  });
});

// Drag-and-Drop: Reorder snippets via dragover
snippetsList.addEventListener('dragover', e => {
  e.preventDefault();
  const dragging = document.querySelector('.dragging');
  if (!dragging) return;

  const scrollContainer = document.getElementById('group-editor-container');
  const rect      = scrollContainer.getBoundingClientRect();
  const threshold = 80;
  if      (e.clientY < rect.top    + threshold) __state_options_snippets_js.scrollSpeed = -Math.max(3, (rect.top    + threshold - e.clientY) / 4);
  else if (e.clientY > rect.bottom - threshold) __state_options_snippets_js.scrollSpeed =  Math.max(3, (e.clientY - rect.bottom + threshold) / 4);
  else __state_options_snippets_js.scrollSpeed = 0;

  startAutoScroll();

  if (dragging.classList.contains('snippet-subgroup')) {
    reorderSubgroup(dragging, e.clientY);
    return;
  }

  const section = e.target.closest('.snippet-subgroup');
  if (section?.classList.contains('collapsed')) setSubgroupCollapsed(section, false, false);
  const container = section ? section.querySelector('.subgroup-snippets') : snippetsList;
  const afterElement = getDragAfterElement(container, e.clientY);
  if (afterElement) container.insertBefore(dragging, afterElement);
  else appendSnippetToContainer(dragging, container);
});

snippetsList.addEventListener('drop',    () => stopAutoScroll());
snippetsList.addEventListener('dragend', () => stopAutoScroll());
