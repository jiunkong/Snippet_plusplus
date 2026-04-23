// --- Main Entry Point: Event Binding & Initialization ---

const snippetsList = document.getElementById('snippets-list');

document.addEventListener('DOMContentLoaded', restoreOptions);

document.getElementById('add-group-btn').addEventListener('click', addGroup);
document.getElementById('add-snippet-btn').addEventListener('click', addSnippetRow);
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

// Tab Switching
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
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
  if      (e.clientY < rect.top    + threshold) scrollSpeed = -Math.max(3, (rect.top    + threshold - e.clientY) / 4);
  else if (e.clientY > rect.bottom - threshold) scrollSpeed =  Math.max(3, (e.clientY - rect.bottom + threshold) / 4);
  else scrollSpeed = 0;

  startAutoScroll();

  const afterElement = getDragAfterElement(snippetsList, e.clientY);
  afterElement == null ? snippetsList.appendChild(dragging) : snippetsList.insertBefore(dragging, afterElement);
});

snippetsList.addEventListener('drop',    () => stopAutoScroll());
snippetsList.addEventListener('dragend', () => stopAutoScroll());
