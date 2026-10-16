const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function harness(value = '0.5', depth = false) {
  const listeners = {};
  const classes = new Set();
  let captured;
  let saves = 0;
  const input = { value, dispatchEvent(event) { assert.equal(event.type, 'change'); saves++; } };
  const control = {
    addEventListener(type, callback) { listeners[type] = callback; },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    setPointerCapture(id) { captured = id; }, hasPointerCapture: id => captured === id,
    releasePointerCapture() { captured = null; }
  };
  const context = vm.createContext({
    document: { getElementById: () => control },
    Event: class { constructor(type) { this.type = type; } }
  });
  for (const file of ['utils/constants.js', 'options/timeout.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  context.initTimeoutScrubber(input, depth ? { controlId: 'snippet-depth-scrubber', min: 1, max: 256,
    scale: 1, normalize: context.normalizeSnippetCallDepth } : undefined);
  const event = (type, options = {}) => listeners[type]({ button: 0, pointerId: 1, clientX: 0,
    preventDefault() {}, stopPropagation() {}, ...options });
  return { input, event, classes, saves: () => saves };
}

test('horizontal dragging adjusts by tenths and commits only once on release', () => {
  const { input, event, classes, saves } = harness();
  event('pointerdown', { clientX: 100 });
  event('pointermove', { clientX: 116 });
  assert.equal(input.value, '0.7');
  event('pointermove', { clientX: 124 });
  assert.equal(input.value, '0.8');
  assert.equal(saves(), 0);
  assert.ok(classes.has('is-dragging'));
  event('pointerup');
  assert.equal(saves(), 1);
  assert.equal(classes.has('is-dragging'), false);
  event('pointerup');
  assert.equal(saves(), 1);
  event('pointerdown', { clientX: 100 });
  event('pointermove', { clientX: 92 });
  assert.equal(input.value, '0.7');
  event('pointerup');
  assert.equal(saves(), 2);
});

test('depth dragging uses integers, clamps to bounds and commits once', () => {
  const { input, event, saves } = harness('32', true);
  event('pointerdown');
  event('pointermove', { clientX: 16 });
  assert.equal(input.value, '34');
  assert.equal(saves(), 0);
  event('pointermove', { clientX: 10000 });
  assert.equal(input.value, '256');
  event('pointerup');
  assert.equal(saves(), 1);
  event('pointerdown');
  event('pointermove', { clientX: -10000 });
  assert.equal(input.value, '1');
  event('pointercancel');
  assert.equal(input.value, '256');
  assert.equal(saves(), 1);
});

test('clicks remain editable and dragging is bounded by the execution time limits', () => {
  const { input, event, saves } = harness();
  event('pointerdown');
  event('pointermove', { clientX: 2 });
  event('pointerup');
  assert.equal(input.value, '0.5');
  assert.equal(saves(), 0);
  event('pointerdown');
  event('pointermove', { clientX: -10000 });
  assert.equal(input.value, '0.1');
  event('pointermove', { clientX: 10000 });
  assert.equal(input.value, '60.0');
  event('pointerup');
  assert.equal(saves(), 1);
});

test('Escape, pointer cancellation and lost capture roll back without saving', () => {
  for (const action of ['pointercancel', 'lostpointercapture', 'keydown']) {
    const { input, event, saves } = harness();
    event('pointerdown');
    event('pointermove', { clientX: 16 });
    assert.equal(input.value, '0.7');
    event(action, { key: 'Escape' });
    assert.equal(input.value, '0.5');
    assert.equal(saves(), 0);
    event('pointerup');
    assert.equal(saves(), 0);
  }
});
