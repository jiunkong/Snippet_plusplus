// --- Group Management ---

function groupListLabel(group, index) {
  const name = group.name || `${t('groups.default_name')} ${index + 1}`;
  return `${name} (${group.snippets?.length || 0})`;
}

function renderGroupsList() {
  const list = document.getElementById('groups-list');
  list.innerHTML = '';
  snippetGroups.forEach((group, index) => {
    const item = document.createElement('div');
    item.className = `group-item ${index === activeGroupIndex ? 'active' : ''}`;
    item.textContent = groupListLabel(group, index);
    item.onclick = () => selectGroup(index);
    list.appendChild(item);
  });
}

function selectGroup(index) {
  syncActiveGroupData();
  const search = document.getElementById('snippet-search');
  if (search) search.value = '';
  activeGroupIndex = index;
  renderGroupsList();

  const noGroup = document.getElementById('no-group-selected');
  const editor = document.getElementById('active-group-editor');

  if (index === -1) {
    noGroup.style.display = 'flex';
    editor.style.display = 'none';
    return;
  }

  noGroup.style.display = 'none';
  editor.style.display = 'flex';

  const group = snippetGroups[index];
  document.getElementById('active-group-name').value = group.name || "";
  renderDisabledSitesList(group.disabledSites || []);
  renderSnippetsList(group.snippets, subgroupDefinitions(group));

  // Update mode selector UI
  const mode = group.siteMode || 'blacklist';
  document.querySelectorAll('#site-mode-selector .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

// Global listener for site mode selector
document.getElementById('site-mode-selector').onclick = (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;

  document.querySelectorAll('#site-mode-selector .mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  syncActiveGroupData();
  debouncedSave();
};

function addGroup() {
  syncActiveGroupData();
  snippetGroups.push({ name: t('groups.default_name'), snippets: [], siteMode: 'blacklist' });
  renderGroupsList();
  selectGroup(snippetGroups.length - 1);
  debouncedSave();
}

async function deleteActiveGroup() {
  if (activeGroupIndex === -1) return;
  syncActiveGroupData();
  const target = snippetGroups[activeGroupIndex];
  if (!await showOptionsConfirmation({
    title: t('groups_delete_title'),
    message: t('groups_delete_message', { name: target.name || t('groups_default_name') }),
    acceptLabel: t('groups_delete_action'),
    danger: true
  })) return;
  const prev = snippetGroups.indexOf(target);
  if (prev === -1) return;
  snippetGroups.splice(prev, 1);
  activeGroupIndex = -1;
  renderGroupsList();
  selectGroup(snippetGroups.length > 0 ? Math.max(0, prev - 1) : -1);
  debouncedSave();
}

function syncActiveGroupData() {
  if (activeGroupIndex === -1) return;
  const name = document.getElementById('active-group-name').value;
  const disabledSites = Array.from(document.querySelectorAll('.site-input')).map(i => i.value.trim()).filter(v => v);
  const siteMode = document.querySelector('#site-mode-selector .mode-btn.active')?.dataset.mode || 'blacklist';
  const snippets = Array.from(document.querySelectorAll('.snippet-row')).map(row => ({
    trigger: row.querySelector('.trigger-input').value.trim(),
    replacement: row.querySelector('.replacement-input').value,
    name: row.querySelector('.snippet-name-input').value,
    collapsed: row.classList.contains('collapsed'),
    ...(row.classList.contains('is-disabled') ? { disabled: true } : {}),
    ...(snippetSubgroupId(row) ? { subgroupId: snippetSubgroupId(row) } : {})
  })).filter(s => s.trigger || s.name);

  snippetGroups[activeGroupIndex].name = name;
  snippetGroups[activeGroupIndex].disabledSites = disabledSites;
  snippetGroups[activeGroupIndex].siteMode = siteMode;
  snippetGroups[activeGroupIndex].snippets = snippets;
  snippetGroups[activeGroupIndex].subgroups = readSubgroupDefinitions();

  const activeItem = document.querySelector('.group-item.active');
  if (activeItem) activeItem.textContent = groupListLabel(snippetGroups[activeGroupIndex], activeGroupIndex);
}

function renderDisabledSitesList(sites) {
  const list = document.getElementById('disabled-sites-list');
  list.innerHTML = '';
  const sitesArray = Array.isArray(sites) ? sites : (sites ? sites.split(',').map(s => s.trim()) : []);
  sitesArray.forEach(site => addDisabledSiteRow(site));
}

function addDisabledSiteRow(url) {
  const list = document.getElementById('disabled-sites-list');
  const row = document.createElement('div');
  row.className = 'site-row';
  row.innerHTML = `
    <input type="text" class="site-input" placeholder="google.com">
    <button class="delete-site-btn" title="삭제">&times;</button>
  `;

  const input = row.querySelector('.site-input');
  input.value = url;
  input.oninput = () => { syncActiveGroupData(); debouncedSave(); };

  row.querySelector('.delete-site-btn').onclick = () => {
    row.remove();
    syncActiveGroupData();
    debouncedSave();
  };

  list.appendChild(row);
  if (!url) input.focus();
}
