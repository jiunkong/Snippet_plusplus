// --- Visual Effects: Flash & Ripple Particles ---

function triggerEffect(el, info) {
  if (config?.showParticles === false) return;

  if (info.isInput) {
    el.classList.add('ss-replacement-flash');
    setTimeout(() => el.classList.remove('ss-replacement-flash'), 600);

    const coords = getCaretCoordinates(el, el.selectionStart);
    showRipple(coords.left + window.scrollX, coords.top + window.scrollY + 10);
  } else {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (rect.width === 0) {
      const rects = range.getClientRects();
      if (rects.length) rect = rects[0];
    }
    if (rect.top !== 0 || rect.left !== 0) {
      showRipple(rect.left + window.scrollX, rect.top + window.scrollY);
    }
  }
}

function showRipple(x, y) {
  const container = document.createElement('div');
  container.className = 'ss-ripple-container';
  container.style.left = `${x}px`;
  container.style.top  = `${y}px`;

  const ripple = document.createElement('div');
  ripple.className = 'ss-ripple';
  container.appendChild(ripple);

  for (let i = 0; i < 3; i++) {
    const sparkle = document.createElement('div');
    sparkle.className = 'ss-sparkle';
    const angle = (i / 3) * Math.PI * 2 + (Math.random() * 0.5);
    const dist  = 15 + Math.random() * 20;
    sparkle.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    sparkle.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    sparkle.style.animationDelay = `${Math.random() * 0.1}s`;
    container.appendChild(sparkle);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 800);
}
