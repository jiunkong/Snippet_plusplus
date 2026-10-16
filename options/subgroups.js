// Subgroups organize the existing flat snippet list; expansion and @function
// lookup still share the parent group's full library.
function subgroupDefinitions(group) {
  const seen = new Set();
  return (Array.isArray(group?.subgroups) ? group.subgroups : []).filter(subgroup => {
    if (!subgroup || typeof subgroup.id !== 'string' || !subgroup.id || seen.has(subgroup.id)) return false;
    seen.add(subgroup.id);
    return true;
  }).map(subgroup => ({
    id: subgroup.id,
    name: typeof subgroup.name === 'string' ? subgroup.name : t('subgroups_default_name'),
    collapsed: subgroup.collapsed === true
  }));
}

function subgroupSections() {
  return Array.from(document.querySelectorAll('#snippets-list .snippet-subgroup'))
    .filter(section => typeof section.dataset?.subgroupId === 'string');
}

function readSubgroupDefinitions() {
  return subgroupSections().map(section => ({
    id: section.dataset.subgroupId,
    name: section.querySelector('.subgroup-name-input').value,
    collapsed: section.classList.contains('collapsed')
  }));
}

function findSubgroupSection(id) {
  return subgroupSections().find(section => section.dataset.subgroupId === id);
}

function snippetSubgroupId(row) {
  return row.closest?.('.snippet-subgroup')?.dataset.subgroupId || '';
}

function subgroupOptionHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refreshSubgroupSelectors() {
  const definitions = readSubgroupDefinitions();
  const options = `<option value="">${subgroupOptionHtml(t('subgroups_ungrouped'))}</option>` + definitions.map(subgroup =>
    `<option value="${subgroupOptionHtml(subgroup.id)}">${subgroupOptionHtml(subgroup.name || t('subgroups_default_name'))}</option>`
  ).join('');
  document.querySelectorAll('#snippets-list .snippet-row').forEach(row => {
    const select = row.querySelector('.snippet-subgroup-select');
    if (!select) return;
    select.innerHTML = options;
    select.value = snippetSubgroupId(row);
  });
}

function updateSubgroupVisibility(query = '') {
  subgroupSections().forEach(section => {
    const rows = Array.from(section.querySelectorAll('.snippet-row'));
    const hasMatch = rows.some(row => !row.hidden);
    section.hidden = !!query && !hasMatch;
    section.classList.toggle('search-open', !!query && hasMatch);
    section.querySelector('.subgroup-count').textContent = String(rows.length);
    section.querySelector('.subgroup-fold-btn').setAttribute('aria-expanded',
      String(!section.classList.contains('collapsed') || (!!query && hasMatch)));
  });
}

function setSubgroupCollapsed(section, collapsed, syncState = true) {
  section.classList.toggle('collapsed', collapsed);
  applySnippetSearch();
  if (syncState) syncActiveGroupData();
}

function revealSnippetSubgroup(row) {
  const section = row.closest?.('.snippet-subgroup');
  if (!section || !section.classList.contains('collapsed')) return false;
  setSubgroupCollapsed(section, false, false);
  return true;
}

function appendSnippetToContainer(row, container) {
  container.appendChild(row);
}

function reorderSubgroup(section, y) {
  const root = document.getElementById('snippets-list');
  const after = subgroupSections().filter(item => item !== section && !item.hidden).reduce((closest, item) => {
    const box = item.querySelector('.subgroup-header').getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return offset < 0 && offset > closest.offset ? { offset, item } : closest;
  }, { offset: -Infinity }).item;
  const firstSnippet = Array.from(root.children).find(child => child.classList.contains('snippet-row'));
  root.insertBefore(section, after || firstSnippet || null);
}

function moveSnippetToSubgroup(row, id) {
  const section = findSubgroupSection(id);
  const container = section ? section.querySelector('.subgroup-snippets') : document.getElementById('snippets-list');
  appendSnippetToContainer(row, container);
  if (section) setSubgroupCollapsed(section, false, false);
  refreshSubgroupSelectors();
  applySnippetSearch();
  syncActiveGroupData();
  debouncedSave();
}

function createSubgroupSection(subgroup) {
  const section = document.createElement('section');
  section.className = `snippet-subgroup${subgroup.collapsed ? ' collapsed' : ''}`;
  section.draggable = true;
  section.dataset.subgroupId = subgroup.id;
  section.innerHTML = `
    <div class="subgroup-header">
      <span class="drag-handle" title="${subgroupOptionHtml(t('subgroups_drag'))}">⠿</span>
      <button type="button" class="subgroup-fold-btn" aria-label="${subgroupOptionHtml(t('subgroups_toggle'))}">▾</button>
      <input type="text" class="subgroup-name-input" aria-label="${subgroupOptionHtml(t('subgroups_name'))}">
      <span class="subgroup-count">0</span>
      <button type="button" class="subgroup-add-btn">${subgroupOptionHtml(t('groups_add_snippet'))}</button>
      <button type="button" class="subgroup-remove-btn" title="${subgroupOptionHtml(t('subgroups_remove_desc'))}">${subgroupOptionHtml(t('subgroups_remove'))}</button>
    </div>
    <div class="subgroup-snippets"></div>`;
  const name = section.querySelector('.subgroup-name-input');
  name.value = subgroup.name;
  section.querySelector('.subgroup-snippets').dataset.emptyText = t('subgroups_empty');
  section.querySelector('.subgroup-fold-btn').onclick = () => setSubgroupCollapsed(section, !section.classList.contains('collapsed'));
  name.oninput = () => { refreshSubgroupSelectors(); syncActiveGroupData(); debouncedSave(); };
  section.querySelector('.subgroup-add-btn').onclick = () => addSnippetRow(subgroup.id);
  section.querySelector('.subgroup-remove-btn').onclick = () => {
    const root = document.getElementById('snippets-list');
    Array.from(section.querySelectorAll('.snippet-row')).forEach(row => appendSnippetToContainer(row, root));
    section.remove();
    refreshSubgroupSelectors();
    applySnippetSearch();
    syncActiveGroupData();
    debouncedSave();
  };
  section.addEventListener('mousedown', event => {
    section.draggable = !!event.target.closest('.subgroup-header') && !event.target.closest('input, textarea, select, button');
  });
  section.addEventListener('dragstart', event => {
    // Snippet drag events bubble through their subgroup; only handle this section.
    if (event.target !== section) return;
    if (!section.draggable || document.getElementById('snippet-search')?.value.trim()) { event.preventDefault(); return; }
    event.stopPropagation();
    section.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', subgroup.id);
    }
    startAutoScroll();
  });
  section.addEventListener('dragend', event => {
    if (event.target !== section) return;
    section.classList.remove('dragging');
    stopAutoScroll();
    refreshSubgroupSelectors();
    applySnippetSearch();
    syncActiveGroupData();
    debouncedSave();
  });
  const root = document.getElementById('snippets-list');
  root.insertBefore(section, Array.from(root.children).find(child => child.classList.contains('snippet-row')) || null);
  return section;
}

function addSubgroup() {
  if (activeGroupIndex === -1) return;
  const search = document.getElementById('snippet-search');
  if (search) search.value = '';
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
    : `subgroup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const section = createSubgroupSection({ id, name: t('subgroups_default_name'), collapsed: false });
  refreshSubgroupSelectors();
  applySnippetSearch();
  syncActiveGroupData();
  debouncedSave();
  const name = section.querySelector('.subgroup-name-input');
  name.focus();
  name.select();
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
