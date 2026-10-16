// The tester runs the content engine in its own frame so settings inputs never
// expand triggers. Send the current editor state, including unsaved changes.
function sendSnippetTestState() {
  syncActiveGroupData();
  const frame = document.getElementById('snippet-test-frame');
  const selected = document.getElementById('snippet-test-group').value;
  const index = Number(selected);
  const groups = selected === 'all' ? snippetGroups : (snippetGroups[index] ? [snippetGroups[index]] : []);
  frame.contentWindow?.postMessage({ type: 'snippetpp:test-state', config: currentConfig, snippetGroups: groups }, window.location.origin);
}

function refreshSnippetTester() {
  const select = document.getElementById('snippet-test-group');
  const selected = select.value;
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = t('tester_all_groups');
  select.appendChild(all);
  snippetGroups.forEach((group, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = group.name || t('default_group_name');
    select.appendChild(option);
  });
  select.value = selected !== '' && (selected === 'all' || snippetGroups[Number(selected)]) ? selected : 'all';
  document.getElementById('snippet-test-frame').title = t('tester_title');
  sendSnippetTestState();
}

const snippetTestFrame = document.getElementById('snippet-test-frame');
snippetTestFrame.addEventListener('load', refreshSnippetTester);
document.getElementById('snippet-test-group').addEventListener('change', sendSnippetTestState);
document.getElementById('snippet-test-clear').addEventListener('click', () => {
  snippetTestFrame.contentWindow?.postMessage({ type: 'snippetpp:test-clear' }, window.location.origin);
});
window.addEventListener('message', event => {
  if (event.source !== snippetTestFrame.contentWindow || event.origin !== window.location.origin) return;
  if (event.data?.type === 'snippetpp:test-request') refreshSnippetTester();
});
