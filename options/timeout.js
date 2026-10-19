import { MIN_SNIPPET_TIMEOUT_MS, MAX_SNIPPET_TIMEOUT_MS, normalizeSnippetTimeout } from '../language-core/src/index.ts';
// Pointer scrubbing keeps normal click-to-edit and keyboard number input intact.
export function initTimeoutScrubber(input, { controlId = 'snippet-timeout-scrubber',
  min = MIN_SNIPPET_TIMEOUT_MS / 100, max = MAX_SNIPPET_TIMEOUT_MS / 100,
  scale = 10, normalize = value => normalizeSnippetTimeout(value * 1000) / 100 } = {}) {
  const control = document.getElementById(controlId);
  if (!control) return;
  let drag = null;
  control.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, value: input.value,
      start: normalize(Number(input.value)), active: false };
    control.setPointerCapture(event.pointerId);
  });
  control.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const distance = event.clientX - drag.x;
    if (!drag.active && Math.abs(distance) < 4) return;
    drag.active = true;
    event.preventDefault();
    control.classList.add('is-dragging');
    const steps = Math.sign(distance) * Math.round(Math.abs(distance) / 8);
    const value = Math.max(min, Math.min(max, Math.round(drag.start) + steps));
    input.value = (value / scale).toFixed(scale === 1 ? 0 : 1);
  });
  const finish = (event, cancelled) => {
    if (!drag || drag.id !== event.pointerId) return;
    const previous = drag;
    drag = null;
    control.classList.remove('is-dragging');
    if (cancelled) input.value = previous.value;
    else if (previous.active && Number(input.value) !== Number(previous.value)) {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (control.hasPointerCapture(previous.id)) control.releasePointerCapture(previous.id);
  };
  control.addEventListener('pointerup', event => finish(event, false));
  control.addEventListener('pointercancel', event => finish(event, true));
  control.addEventListener('lostpointercapture', event => finish(event, true));
  control.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault();
    event.stopPropagation();
    finish({ pointerId: drag.id }, true);
  });
}
