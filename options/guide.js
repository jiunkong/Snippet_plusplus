// Read-only examples share the body editor's tokenizer and token colors.
function highlightGuideExamples() {
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

function initGuideNavigation() {
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
initGuideNavigation();
