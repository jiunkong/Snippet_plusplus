// Parsed code is immutable and reusable; execution never reparses its output.
class SnippetTemplate {
  constructor(source, nodes, metadata = {}) {
    this.source = source;
    this.nodes = Object.freeze(nodes.map(Object.freeze));
    this.normalizedSource = metadata.normalizedSource ?? source;
    this.sourceOffsets = Object.freeze(metadata.sourceOffsets || Array.from({ length: source.length }, (_, i) => i));
    this.literals = Object.freeze(metadata.literals || Object.create(null));
    Object.freeze(this);
  }
}

function parseSnippetTemplate(source, execution) {
  const original = source;
  const offsets = [];
  const pieces = [];
  let from = 0;
  for (const match of [...source.matchAll(/\\(?:\r\n|\n|\r)\s*/g), { index: source.length, 0: '' }]) {
    execution?.check();
    pieces.push(source.slice(from, match.index));
    for (let i = from; i < match.index; i++) offsets.push(i);
    from = match.index + match[0].length;
  }
  source = pieces.join('');
  const literals = Object.create(null);
  const tokens = [];
  const fail = (key, values, offset) => {
    const error = createSnippetError(key, values || []);
    error.snippetOffset = offset;
    throw error;
  };
  let position = 0;
  while (position < source.length) {
    execution?.check();
    let start = source.indexOf('{{', position);
    while (start !== -1 && source[start + 2] === '{') start = source.indexOf('{{', start + 1);
    if (start === -1) start = source.length;
    if (start > position) tokens.push({ type: 'text', value: source.slice(position, start), offset: offsets[position] });
    if (start === source.length) break;
    let quote = null;
    let end = start + 2;
    for (; end < source.length; end++) {
      execution?.check();
      const char = source[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = null;
      } else if (char === '`') {
        const literal = scanSnippetQuotedValue(source, end, execution);
        if (literal.error) fail(literal.error, [], offsets[literal.offset]);
        const token = source.slice(end, literal.end);
        if (!Object.prototype.hasOwnProperty.call(literals, token)) {
          const decoded = decodeSnippetFragmentLiteral(token);
          try {
            literals[token] = Object.freeze({ template: parseSnippetTemplate(decoded.text, execution), offsets: Object.freeze(decoded.offsets) });
          } catch (error) {
            error.snippetOffset = offsets[end + (decoded.offsets[error.snippetOffset] ?? 1)];
            throw error;
          }
        }
        end = literal.end - 1;
      } else if (char === '"' || char === "'") quote = char;
      else if (source.slice(end, end + 2) === '}}') break;
    }
    if (quote) fail('err_unclosed_string', [], offsets[start]);
    if (end >= source.length - 1) fail('err_template_unclosed_tag', [], offsets[start]);
    const value = source.slice(start + 2, end).trim();
    if (!value) fail('err_unknown_tag', [''], offsets[start]);
    tokens.push({ type: 'tag', value, offset: offsets[start] });
    position = end + 2;
  }

  // Build nested templates with a stack so even deeply nested source can be
  // parsed without overflowing the JavaScript call stack.
  const root = { type: 'root', nodes: [] };
  const stack = [root];
  const template = nodes => new SnippetTemplate(original, nodes, { normalizedSource: source, sourceOffsets: offsets, literals });
  for (const token of tokens) {
    execution?.check();
    const parent = stack[stack.length - 1];
    if (token.type === 'text') { parent.nodes.push(token); continue; }
    const { value: tag, offset } = token;
    const opener = tag.match(/^(if|for|switch|case)\s+([\s\S]+)$/);
    if (opener || tag === 'default') {
      const type = opener ? opener[1] : 'default';
      const expression = opener?.[2];
      if ((type === 'case' || type === 'default') && parent.type !== 'switch') fail('err_template_syntax', [tag], offset);
      const node = { type, expression, offset, nodes: [] };
      if (type === 'if') node.branches = [];
      parent.nodes.push(node);
      stack.push(node);
      continue;
    }
    if (tag === 'else' || tag.startsWith('elif ')) {
      if (parent.type !== 'if' || parent.hasElse) fail('err_elif_else_outside_if', [], offset);
      parent.branches.push(Object.freeze({ expression: parent.expression, offset: parent.offset, body: template(parent.nodes) }));
      parent.nodes = [];
      parent.expression = tag === 'else' ? null : tag.slice(5).trim();
      parent.hasElse = tag === 'else';
      parent.offset = offset;
      continue;
    }
    if (/^end(if|for|switch|case|default)$/.test(tag)) {
      if (parent.type !== tag.slice(3)) fail('err_template_syntax', [tag], offset);
      if (parent.type === 'if') {
        parent.branches.push(Object.freeze({ expression: parent.expression, offset: parent.offset, body: template(parent.nodes) }));
        parent.branches = Object.freeze(parent.branches);
        parent.offset = parent.branches[0].offset;
        delete parent.expression;
        delete parent.hasElse;
      } else if (parent.type === 'switch') {
        parent.cases = Object.freeze(parent.nodes.filter(node => node.type === 'case').map(Object.freeze));
        parent.defaultBody = parent.nodes.filter(node => node.type === 'default').at(-1)?.body || null;
      } else parent.body = template(parent.nodes);
      delete parent.nodes;
      stack.pop();
      continue;
    }
    if (tag === 'break' || tag === 'continue') {
      if (!stack.some(node => node.type === 'for')) fail('err_loop_control_outside_for', [tag], offset);
      parent.nodes.push({ type: tag, offset });
    } else if (tag === 'cursor' || /^#\s*(cursor|\d+)$/.test(tag)) {
      const level = tag === 'cursor' || /^#\s*cursor$/.test(tag) ? 0 : Number(tag.slice(1).trim());
      if (!Number.isSafeInteger(level) || level < 0) fail('err_cursor_level', [], offset);
      parent.nodes.push({ type: 'cursor', level, offset });
    } else if (tag.startsWith('#')) {
      parent.nodes.push({ type: 'cursorExpression', expression: tag.slice(1).trim(), offset });
    } else if (tag.startsWith('set ')) {
      const assignments = splitArgs(tag.slice(4));
      if (!assignments.length || assignments.some(part => !part) || /,\s*$/.test(tag)) fail('err_template_syntax', [tag], offset);
      const parsed = assignments.map(assignment => {
        const match = assignment.match(/^\$([\p{L}\p{N}_]+)\s*(?:(=|\+=|-=|\*=|%=|\/=)\s*([\s\S]+))?$/u);
        if (!match || (match[2] && !match[3].trim())) fail('err_template_syntax', [tag], offset);
        return Object.freeze({ name: match[1], operator: match[2], expression: match[3] });
      });
      parent.nodes.push({ type: 'set', assignments: Object.freeze(parsed), offset });
    } else parent.nodes.push({ type: 'expression', expression: tag, offset });
  }
  if (stack.length > 1) {
    const node = stack[stack.length - 1];
    fail(node.type === 'default' ? 'err_case_unclosed' : `err_${node.type}_unclosed`, [], node.branches?.[0]?.offset ?? node.offset);
  }
  return template(root.nodes);
}

// Cache by snippet identity and source. Invalid snippets are reported only when
// run, so one unfinished edit never prevents other snippets from loading.
const snippetTemplateCache = new WeakMap();
function prepareSnippetTemplate(snippet, execution) {
  const source = snippet.replacement || '';
  let entry = snippetTemplateCache.get(snippet);
  if (!entry || entry.source !== source) {
    try { entry = { source, template: parseSnippetTemplate(source, execution) }; }
    catch (error) {
      if (error.messageKey === 'err_snippet_timeout') throw error;
      entry = { source, error };
    }
    snippetTemplateCache.set(snippet, entry);
  }
  return entry;
}

function getSnippetTemplate(snippet, execution) {
  const entry = prepareSnippetTemplate(snippet, execution);
  if (entry.error) {
    const error = createSnippetError(entry.error.messageKey, entry.error.messageValues);
    error.snippetOffset = entry.error.snippetOffset;
    throw error;
  }
  return entry.template;
}
