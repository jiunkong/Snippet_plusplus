// Evaluated output. Text is always data; only cursor nodes become tab stops.
// Converting to a string is deliberately lossy: cursor syntax becomes text.
class SnippetFragment {
  constructor(nodes = []) {
    const normalized = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        if (!node.value) continue;
        const previous = normalized[normalized.length - 1];
        if (previous?.type === 'text') previous.value += node.value;
        else normalized.push({ type: 'text', value: node.value });
      } else if (node.type === 'cursor') {
        if (!Number.isSafeInteger(node.level) || node.level < 0) throw createSnippetError('err_cursor_level');
        normalized.push({ type: 'cursor', level: node.level });
      } else throw new TypeError('Invalid SnippetFragment node');
    }
    this.nodes = Object.freeze(normalized.map(Object.freeze));
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof SnippetFragment ? value
      : new SnippetFragment([{ type: 'text', value: String(value ?? '') }]);
  }

  toString() {
    return this.nodes.map(node => node.type === 'text' ? node.value : `{{#${node.level}}}`).join('');
  }

  get length() {
    return this.getLength();
  }

  getLength(execution) {
    let length = 0;
    for (const node of this.nodes) {
      if (node.type === 'text') {
        for (const char of node.value) { execution?.check(); length++; }
      } else { execution?.check(); length++; }
    }
    return length;
  }

  [Symbol.iterator]() {
    return this.iterate();
  }

  *iterate(execution) {
    for (const node of this.nodes) {
      if (node.type === 'text') {
        for (const value of node.value) {
          execution?.check();
          yield new SnippetFragment([{ type: 'text', value }]);
        }
      } else {
        execution?.check();
        yield new SnippetFragment([node]);
      }
    }
  }

  concat(value) {
    return new SnippetFragment([...this.nodes, ...SnippetFragment.from(value).nodes]);
  }

  shiftCursors(offset) {
    return new SnippetFragment(this.nodes.map(node => {
      if (node.type !== 'cursor') return node;
      const level = node.level + offset;
      if (!Number.isSafeInteger(level) || level < 0) throw createSnippetError('err_snippet_cursor_offset');
      return { type: 'cursor', level };
    }));
  }

  get maxCursorLevel() {
    return this.nodes.reduce((max, node) => node.type === 'cursor' ? Math.max(max, node.level) : max, -1);
  }

  // Render only actual cursor nodes. Literal cursor syntax is never inspected.
  render(cursor, text = value => value) {
    return this.nodes.map(node => node.type === 'text' ? text(node.value) : cursor(node.level)).join('');
  }
}

function snippetIterableItems(value, execution) {
  return Array.from(value instanceof SnippetFragment ? value.iterate(execution) : value);
}

function snippetFragmentFromUnits(units) {
  const nodes = [];
  for (const unit of units) for (const node of SnippetFragment.from(unit).nodes) nodes.push(node);
  return new SnippetFragment(nodes);
}

function snippetFragmentUnitsEqual(left, right) {
  const a = left.nodes[0];
  const b = right.nodes[0];
  return a.type === b.type && (a.type === 'text' ? a.value === b.value : a.level === b.level);
}

function snippetFragmentMatchAt(units, search, index, execution) {
  if (index < 0 || index + search.length > units.length) return false;
  for (let i = 0; i < search.length; i++) {
    execution?.check();
    if (!snippetFragmentUnitsEqual(units[index + i], search[i])) return false;
  }
  return true;
}

function snippetFragmentReplace(value, search, replacement, execution) {
  const units = snippetIterableItems(value, execution);
  const target = snippetIterableItems(SnippetFragment.from(search), execution);
  for (let i = 0; i <= units.length - target.length; i++) {
    execution?.check();
    if (snippetFragmentMatchAt(units, target, i, execution)) {
      return snippetFragmentFromUnits([
        ...units.slice(0, i), SnippetFragment.from(replacement), ...units.slice(i + target.length)
      ]);
    }
  }
  return value;
}

function snippetFragmentSplit(value, separator, execution) {
  const units = snippetIterableItems(value, execution);
  const target = snippetIterableItems(SnippetFragment.from(separator), execution);
  if (!target.length) return units;
  const parts = [];
  let from = 0;
  for (let i = 0; i <= units.length - target.length; i++) {
    execution?.check();
    if (snippetFragmentMatchAt(units, target, i, execution)) {
      parts.push(snippetFragmentFromUnits(units.slice(from, i)));
      from = i + target.length;
      i = from - 1;
    }
  }
  parts.push(snippetFragmentFromUnits(units.slice(from)));
  return parts;
}
