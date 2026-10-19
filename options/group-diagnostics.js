import { t } from './i18n.js';

let refreshQueued = false;

// Row validation shares the editor's cached core analysis. Never parse again
// to build the group overview, and include folded/filtered rows as well.
export function scheduleGroupDiagnostics() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    refreshGroupDiagnostics();
  });
}

function counter(severity, count) {
  const badge = document.createElement('span');
  badge.className = `group-diagnostic-count group-diagnostic-${severity}`;
  badge.textContent = t(`group_diagnostics_${severity}_count`, { count });
  return badge;
}

export function refreshGroupDiagnostics() {
  const panel = document.getElementById('group-diagnostics');
  if (!panel) return;
  const rows = Array.from(document.querySelectorAll('#snippets-list .snippet-row'));
  const entries = rows.map((row, index) => ({ row, index, diagnostics: row.snippetDiagnostics || [] }))
    .filter(entry => entry.diagnostics.length);
  const counts = { error: 0, warning: 0 };
  for (const entry of entries) for (const diagnostic of entry.diagnostics) counts[diagnostic.severity]++;
  panel.classList.toggle('has-errors', counts.error > 0);
  panel.classList.toggle('has-warnings', counts.warning > 0);
  const counters = document.getElementById('group-diagnostics-counts');
  const signature = JSON.stringify([counts.error, counts.warning, t('group_diagnostics_error_count', { count: counts.error }), t('group_diagnostics_warning_count', { count: counts.warning })]);
  if (counters.dataset.signature !== signature) {
    counters.replaceChildren(counter('error', counts.error), counter('warning', counts.warning));
    counters.dataset.signature = signature;
  }
  const list = document.getElementById('group-diagnostics-list');
  const content = document.createDocumentFragment();
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'group-diagnostics-empty';
    empty.textContent = t('group_diagnostics_empty');
    content.appendChild(empty);
  }
  for (const { row, index, diagnostics } of entries) {
    const section = document.createElement('li');
    section.className = 'group-diagnostic-snippet';
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'group-diagnostic-snippet-link';
    const name = row.querySelector('.snippet-name-input').value.trim();
    const trigger = row.querySelector('.trigger-input').value.trim();
    const label = document.createElement('span');
    label.className = 'group-diagnostic-snippet-name';
    label.textContent = name || trigger || t('group_diagnostics_unnamed', { number: index + 1 });
    heading.appendChild(label);
    for (const severity of ['error', 'warning']) {
      const count = diagnostics.filter(item => item.severity === severity).length;
      if (count) heading.appendChild(counter(severity, count));
    }
    heading.onclick = () => row.navigateToDiagnostic?.(diagnostics[0]);
    section.appendChild(heading);
    const issues = document.createElement('ul');
    issues.className = 'group-diagnostic-issues';
    for (const diagnostic of diagnostics) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `group-diagnostic-link group-diagnostic-${diagnostic.severity}`;
      const severity = document.createElement('span');
      severity.className = 'diagnostic-label';
      severity.textContent = t(`diagnostic_${diagnostic.severity}`);
      const description = document.createElement('span');
      description.className = 'group-diagnostic-description';
      const message = document.createElement('span');
      message.textContent = t(diagnostic.code, diagnostic.args);
      const location = document.createElement('span');
      location.className = 'group-diagnostic-location';
      const input = row.querySelector(diagnostic.target === 'trigger' ? '.trigger-input' : '.replacement-input');
      const before = input.value.slice(0, diagnostic.range.start);
      const line = before.split('\n').length;
      const column = diagnostic.range.start - before.lastIndexOf('\n');
      location.textContent = t(`group_diagnostics_${diagnostic.target}`) + ' · ' + t('group_diagnostics_location', { line, column });
      description.append(message, location);
      button.append(severity, description);
      button.onclick = () => row.navigateToDiagnostic?.(diagnostic);
      item.appendChild(button);
      issues.appendChild(item);
    }
    section.appendChild(issues);
    content.appendChild(section);
  }
  // Keep the native details element intact so live edits preserve its open state.
  list.replaceChildren(content);
}
