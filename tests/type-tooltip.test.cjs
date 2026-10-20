const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source.cjs');
const vm = require('./helpers/vm.cjs');
const path = require('node:path');

function harness() {
  let now = 0, next = 0;
  const timers = new Map();
  function element() {
    const attributes = new Map();
    return {
      hidden: true, isConnected: true, style: {}, children: [], events: {},
      classList: { toggle() {} },
      setAttribute(key, value) { attributes.set(key, value); },
      getAttribute: key => attributes.get(key),
      removeAttribute(key) { attributes.delete(key); },
      addEventListener(name, callback) { this.events[name] = callback; },
      appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      getBoundingClientRect: () => ({ width: 200, height: 80 })
    };
  }
  const body = element(), target = element();
  const context = vm.createContext({
    document: { body, createElement: element, addEventListener() {} }, window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
    t: key => key,
    setTimeout(callback, delay) { const id = next++; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'options/type-tooltip.js'), 'utf8'), context);
  const show = kind => kind === 'variable'
    ? context.showTypeTooltip(target, { range: { start: 0, end: 2 }, types: ['string'] }, '$x', { left: 10, top: 100, bottom: 120 })
    : context.showSignatureTooltip(target, { range: { start: 0, end: 3 }, kind: 'function', name: 'newline', overloads: [
      { id: 'newline:0', parameters: [], returnTypes: ['string'] }
    ] }, { left: 10, top: 100, bottom: 120 });
  function tick(duration) {
    const until = now + duration;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].callback();
    }
    now = until;
  }
  return { context, target, body, show, tick, visible: () => body.children.some(child => !child.hidden) };
}

for (const kind of ['variable', 'function']) {
  test(`${kind} tooltip waits for sustained hover and cancels completely on a brief pass`, () => {
    const h = harness();
    h.show(kind);
    h.tick(300);
    assert.equal(h.visible(), false);
    h.context.scheduleHideTypeTooltip(h.target);
    h.tick(1000);
    assert.equal(h.visible(), false);
    h.show(kind);
    h.tick(499);
    assert.equal(h.visible(), false);
    h.show(kind); // Pointer motion over the same symbol should not restart the delay.
    h.tick(1);
    assert.equal(h.visible(), true);
  });
}

test('a visible tooltip keeps its hover grace period when moving onto the popup', () => {
  const h = harness();
  h.show('variable'); h.tick(500);
  h.context.scheduleHideTypeTooltip(h.target);
  h.tick(100);
  h.body.children[0].events.mouseenter();
  h.tick(500);
  assert.equal(h.visible(), true);
  h.body.children[0].events.mouseleave();
  h.tick(300);
  assert.equal(h.visible(), false);
});
