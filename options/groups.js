import { scheduleGroupDiagnostics } from './group-diagnostics.js';
import { t } from './i18n.js';
import { moduleState as __state_options_state_js } from './state.js';
import { renderSnippetsList } from './snippets.js';
import { subgroupDefinitions, snippetSubgroupId, readSubgroupDefinitions } from './subgroups.js';
import { debouncedSave } from './storage.js';
import { showOptionsConfirmation } from './dialog.js';
// --- Group Management ---

export function groupListLabel(group, index) {
  const name = group.name || `${t('groups.default_name')} ${index + 1}`;
  return `${name} (${group.snippets?.length || 0})`;
}

export function renderGroupsList() {
  const list = document.getElementById('groups-list');
  list.innerHTML = '';
  __state_options_state_js.snippetGroups.forEach((group, index) => {
    const item = document.createElement('div');
    item.className = `group-item ${index === __state_options_state_js.activeGroupIndex ? 'active' : ''}`;
    item.textContent = groupListLabel(group, index);
    item.onclick = () => selectGroup(index);
    list.appendChild(item);
  });
}

export function selectGroup(index) {
  syncActiveGroupData();
  const search = document.getElementById('snippet-search');
  if (search) search.value = '';
  __state_options_state_js.activeGroupIndex = index;
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

  const group = __state_options_state_js.snippetGroups[index];
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

export function addGroup() {
  syncActiveGroupData();
  __state_options_state_js.snippetGroups.push({ name: t('groups.default_name'), snippets: [], siteMode: 'blacklist' });
  renderGroupsList();
  selectGroup(__state_options_state_js.snippetGroups.length - 1);
  debouncedSave();
}

export async function deleteActiveGroup() {
  if (__state_options_state_js.activeGroupIndex === -1) return;
  syncActiveGroupData();
  const target = __state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex];
  if (!await showOptionsConfirmation({
    title: t('groups_delete_title'),
    message: t('groups_delete_message', { name: target.name || t('groups_default_name') }),
    acceptLabel: t('groups_delete_action'),
    danger: true
  })) return;
  const prev = __state_options_state_js.snippetGroups.indexOf(target);
  if (prev === -1) return;
  __state_options_state_js.snippetGroups.splice(prev, 1);
  __state_options_state_js.activeGroupIndex = -1;
  renderGroupsList();
  selectGroup(__state_options_state_js.snippetGroups.length > 0 ? Math.max(0, prev - 1) : -1);
  debouncedSave();
}

export function syncActiveGroupData() {
  scheduleGroupDiagnostics();
  if (__state_options_state_js.activeGroupIndex === -1) return;
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

  __state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex].name = name;
  __state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex].disabledSites = disabledSites;
  __state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex].siteMode = siteMode;
  __state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex].snippets = snippets;
  __state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex].subgroups = readSubgroupDefinitions();

  const activeItem = document.querySelector('.group-item.active');
  if (activeItem) activeItem.textContent = groupListLabel(__state_options_state_js.snippetGroups[__state_options_state_js.activeGroupIndex], __state_options_state_js.activeGroupIndex);
}

export function renderDisabledSitesList(sites) {
  const list = document.getElementById('disabled-sites-list');
  list.innerHTML = '';
  const sitesArray = Array.isArray(sites) ? sites : (sites ? sites.split(',').map(s => s.trim()) : []);
  sitesArray.forEach(site => addDisabledSiteRow(site));
}

export function addDisabledSiteRow(url) {
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
