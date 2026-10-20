import { t } from './i18n.js';
import { formatTypeNames } from '../language-core/src/index.ts';
// Presentation belongs to the browser host; types come from core analysis.
let tooltip;
let owner;
let pending;
let currentKey;
let hideTimer;
let pointerInside = false;
let currentAnchor;
const overloadSelections = new WeakMap();

export function hideTypeTooltip(target) {
  if (target && target !== owner) return;
  clearTimeout(pending);
  clearTimeout(hideTimer);
  pending = null;
  currentKey = null;
  if (tooltip) tooltip.hidden = true;
  if (owner && tooltip) {
    const ids = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltip.id);
    if (ids.length) owner.setAttribute('aria-describedby', ids.join(' '));
    else owner.removeAttribute('aria-describedby');
  }
  owner = null;
  pointerInside = false;
  currentAnchor = null;
}

export function scheduleHideTypeTooltip(target) {
  if (target && target !== owner || pointerInside) return;
  // Leaving before the hover delay finishes must cancel the pending tooltip.
  // The grace period below only applies to an already visible tooltip.
  if (pending != null) { hideTypeTooltip(target); return; }
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hideTypeTooltip(target), 220);
}

function positionTooltip() {
  if (!tooltip || tooltip.hidden || !currentAnchor) return;
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  const margin = 8, gap = 8, anchor = currentAnchor;
  const bounds = tooltip.getBoundingClientRect();
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - bounds.width - margin));
  const above = anchor.top - bounds.height - gap;
  const top = above >= margin ? above : Math.max(margin, Math.min(anchor.bottom + gap, window.innerHeight - bounds.height - margin));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function queueTooltip(target, key, anchor, variant, build) {
  clearTimeout(hideTimer);
  if (owner === target && currentKey === key) return;
  hideTypeTooltip();
  owner = target;
  currentKey = key;
  currentAnchor = anchor;
  pending = setTimeout(() => {
    pending = null;
    if (!target.isConnected) { hideTypeTooltip(); return; }
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'variable-type-tooltip';
      tooltip.className = 'variable-type-tooltip';
      tooltip.addEventListener('mouseenter', () => { pointerInside = true; clearTimeout(hideTimer); });
      tooltip.addEventListener('mouseleave', () => { pointerInside = false; scheduleHideTypeTooltip(); });
      document.body.appendChild(tooltip);
    }
    tooltip.classList.toggle('call-signature-tooltip', variant === 'signature');
    tooltip.setAttribute('role', variant === 'signature' ? 'dialog' : 'tooltip');
    if (variant === 'signature') tooltip.setAttribute('aria-label', t('signature_overloads'));
    else tooltip.removeAttribute('aria-label');
    tooltip.replaceChildren(...build());
    tooltip.hidden = false;
    positionTooltip();
    const ids = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(tooltip.id);
    target.setAttribute('aria-describedby', [...ids].join(' '));
  }, 500);
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function typeBadges(types, elementTypes) {
  const container = document.createElement('span');
  container.className = 'variable-type-tooltip-types';
  formatTypeNames(types, elementTypes).forEach((type, index) => {
    if (index) container.appendChild(textElement('span', 'variable-type-tooltip-union', '|'));
    container.appendChild(textElement('span', 'variable-type-tooltip-type', type));
  });
  return container;
}

export function showTypeTooltip(target, variable, label, anchor) {
  const key = `variable:${variable.range.start}:${variable.range.end}:${label}:${JSON.stringify(variable.type ?? [variable.types, variable.elementTypes])}`;
  queueTooltip(target, key, anchor, 'variable', () => [
    textElement('span', 'variable-type-tooltip-name', label),
    textElement('span', 'variable-type-tooltip-separator', ':'),
    typeBadges(variable.type ?? variable.types, variable.elementTypes)
  ]);
}

export function showSignatureTooltip(target, signature, anchor) {
  const key = `signature:${JSON.stringify(signature)}`;
  const choices = signature.overloads;
  let selections = overloadSelections.get(target);
  if (!selections) { selections = new Map(); overloadSelections.set(target, selections); }
  let index = Math.max(0, choices.findIndex(choice => choice.id === selections.get(signature.range.start)));
  queueTooltip(target, key, anchor, 'signature', () => {
    const container = document.createElement('div');
    container.className = 'signature-tooltip-content';
    const render = () => {
      const choice = choices[index];
      if (!choice) return;
      selections.set(signature.range.start, choice.id);
      const heading = document.createElement('div');
      heading.className = 'signature-tooltip-heading';
      heading.append(
        textElement('span', 'variable-type-tooltip-name', (signature.kind === 'snippet' ? '@' : '') + signature.name + '()'),
        textElement('span', 'signature-tooltip-kind', t(`signature_${signature.kind}`))
      );
      const navigation = document.createElement('div');
      navigation.className = 'signature-tooltip-navigation';
      const count = textElement('span', 'signature-tooltip-count', `${index + 1} / ${choices.length}`);
      count.setAttribute('aria-live', 'polite');
      const step = amount => {
        const focusedArrow = container.contains(document.activeElement) ? document.activeElement?.dataset.direction : null;
        index = (index + amount + choices.length) % choices.length;
        render(); positionTooltip();
        if (focusedArrow) container.querySelector(`[data-direction="${focusedArrow}"]`)?.focus({ preventScroll: true });
      };
      const arrow = (label, text, amount) => {
        const button = textElement('button', 'signature-tooltip-arrow', text);
        button.type = 'button';
        button.dataset.direction = String(amount);
        button.setAttribute('aria-label', t(label));
        button.disabled = choices.length < 2;
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.onclick = () => step(amount);
        return button;
      };
      if (choices.length > 1) {
        navigation.append(arrow('signature_previous', '‹', -1), count, arrow('signature_next', '›', 1));
      }
      const parameters = document.createElement('dl');
      parameters.className = 'signature-tooltip-parameters';
      choice.parameters.forEach(parameter => {
        const row = document.createElement('div');
        row.className = 'signature-tooltip-parameter';
        const name = (parameter.rest ? '...' : '') + (signature.kind === 'snippet' ? '$' : '') + parameter.name + (parameter.optional ? '?' : '');
        const value = document.createElement('dd');
        value.appendChild(typeBadges(parameter.type ?? parameter.types, parameter.elementTypes));
        row.append(textElement('dt', 'signature-tooltip-parameter-name', name + ':'), value);
        parameters.appendChild(row);
      });
      if (!choice.parameters.length) parameters.appendChild(textElement('div', 'signature-tooltip-empty', t('signature_no_parameters')));
      const returns = document.createElement('div');
      returns.className = 'signature-tooltip-return';
      returns.append(textElement('span', 'signature-tooltip-return-label', t('signature_return')),
        typeBadges(choice.returnType ?? choice.returnTypes, choice.returnElementTypes));
      container.replaceChildren(heading, ...(choices.length > 1 ? [navigation] : []), parameters, returns);
      if (signature.matches === false) container.appendChild(textElement('p', 'signature-tooltip-mismatch', t('signature_no_overload')));
      container.onkeydown = event => {
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); step(['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
        }
      };
    };
    render();
    return [container];
  });
}

// Signature popovers accept arrow clicks; all other editing actions close them.
window.addEventListener('scroll', event => { if (!tooltip?.contains(event.target)) hideTypeTooltip(); }, true);
window.addEventListener('resize', () => hideTypeTooltip());
window.addEventListener('blur', () => hideTypeTooltip());
window.addEventListener('pointerdown', event => { if (!tooltip?.contains(event.target)) hideTypeTooltip(); }, true);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideTypeTooltip();
  else if (!tooltip?.contains(event.target)) hideTypeTooltip();
}, true);
document.addEventListener('mouseleave', () => hideTypeTooltip());
