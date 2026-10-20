import { FUNCTIONS, formatTypeNames } from '../language-core/src/index.ts';
import { t } from './i18n.js';
import { updateTriggerHighlight, updateHighlight } from './highlight.js';
// Read-only examples share the body editor's tokenizer and token colors.
export function highlightGuideExamples() {
  document.querySelectorAll('#guide-tab code[data-guide-language]').forEach(code => {
    const value = code.textContent;
    if (code.dataset.guideLanguage === 'trigger') {
      updateTriggerHighlight({ value }, code);
    } else {
      const snippets = JSON.parse(code.closest('details').dataset.guideSnippets || '[]');
      updateHighlight({ value }, code, code.dataset.guideTrigger || '', snippets);
    }
  });
}

// Keep signatures tied to the same metadata used by execution and hovers.
export function renderGuideFunctionReference() {
  const body = document.getElementById('guide-function-reference');
  if (!body) return;
  const fragment = document.createDocumentFragment();
  const formatTypes = types => formatTypeNames(types).join(' | ');
  for (const [name, spec] of Object.entries(FUNCTIONS).sort(([a], [b]) => a.localeCompare(b))) {
    for (const overload of spec.overloads) {
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      const label = document.createElement('code');
      label.textContent = name + '()';
      heading.appendChild(label);
      const parameters = document.createElement('td');
      const values = [...overload.parameters.map((parameter, index) => ({ ...parameter, optional: index >= overload.min })),
        ...(overload.restParameter ? [{ ...overload.restParameter, rest: true }] : [])];
      for (const parameter of values) {
        const line = document.createElement('code');
        line.className = 'guide-parameter-type';
        const types = formatTypes(parameter.type);
        line.textContent = `${parameter.rest ? '...' : ''}${parameter.name}${parameter.optional ? '?' : ''}: ${types}`;
        parameters.appendChild(line);
      }
      if (!values.length) {
        const empty = document.createElement('span');
        empty.dataset.i18n = 'guide_doc_no_parameters';
        empty.textContent = t('guide_doc_no_parameters');
        parameters.appendChild(empty);
      }
      const result = document.createElement('td');
      const types = document.createElement('code');
      types.textContent = formatTypes(overload.returnType);
      result.appendChild(types);
      row.append(heading, parameters, result);
      fragment.appendChild(row);
    }
  }
  body.replaceChildren(fragment);
}

export function initGuideNavigation() {
  const guide = document.getElementById('guide-tab');
  const links = [...guide.querySelectorAll('.guide-toc a')];
  const targets = links.map(link => document.getElementById(link.hash.slice(1)));
  const setCurrent = index => links.forEach((link, i) => {
    if (i === index) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  links.forEach((link, index) => {
    const heading = targets[index].querySelector('h2');
    heading.tabIndex = -1;
    link.addEventListener('click', event => {
      event.preventDefault();
      heading.focus({ preventScroll: true });
      targets[index].scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'start'
      });
      setCurrent(index);
    });
  });
  guide.addEventListener('scroll', () => {
    if (guide.scrollTop + guide.clientHeight >= guide.scrollHeight - 2) {
      setCurrent(links.length - 1);
      return;
    }
    const top = guide.getBoundingClientRect().top + 56;
    let current = 0;
    targets.forEach((target, index) => {
      if (target.getBoundingClientRect().top <= top) current = index;
    });
    setCurrent(current);
  }, { passive: true });
  setCurrent(0);
}

highlightGuideExamples();
renderGuideFunctionReference();
initGuideNavigation();
