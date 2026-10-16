/**
 * Shared Trigger Utilities
 */

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Use the same placeholder order and grammar as compileTrigger.
function snippetParameterNames(trigger) {
  return [...String(trigger || '').matchAll(/\$\{([^:}]+)(?::([^}]+))?\}/g)].map(match => match[1]);
}

// Shared by template execution and options validation. Offsets may precede or
// follow the required argument list; nested calls and quoted delimiters are safe.
function parseSnippetFunctionName(text, start = 0) {
  if (text[start] !== '@') return { error: 'err_snippet_call_syntax' };
  const quote = text[start + 1];
  if (quote === '"' || quote === "'") {
    let name = '';
    for (let i = start + 2; i < text.length; i++) {
      const char = text[i];
      if (char === quote) return name ? { name, nameEnd: i + 1 } : { error: 'err_snippet_call_syntax' };
      if (char === '\n' || char === '\r') break;
      if (char === '\\' && (text[i + 1] === quote || text[i + 1] === '\\')) name += text[++i];
      else name += char;
    }
    return { error: 'err_snippet_call_syntax' };
  }
  const name = text.slice(start).match(/^@([\p{L}_][\p{L}\p{N}_]*)/u);
  return name ? { name: name[1], nameEnd: start + name[0].length } : { error: 'err_snippet_call_syntax' };
}

function parseSnippetCall(text, start = 0) {
  const parsedName = parseSnippetFunctionName(text, start);
  if (parsedName.error) return parsedName;
  let position = parsedName.nameEnd;
  const call = { ...parsedName, offsetStart: null, offsetEnd: null };
  while (true) {
    while (/\s/.test(text[position] || '') && position < text.length) position++;
    const open = text.startsWith('&lt;', position) ? '&lt;' : text[position];
    if (open === '[') return { error: 'err_snippet_call_syntax' };
    if (open !== '(' && open !== '<' && open !== '&lt;') break;
    const offset = open !== '(';
    if ((offset && call.offsetStart !== null) || (!offset && call.argsStart !== undefined)) {
      return { error: 'err_snippet_call_syntax' };
    }
    const openStart = position;
    position += open.length;
    const from = position;
    const stack = [offset ? '>' : ')'];
    let closeStart;
    let quote = null;
    for (; position < text.length && stack.length; position++) {
      const char = text[position];
      if (quote) {
        if (char === '\\') position++;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '@') {
        const nested = parseSnippetCall(text, position);
        if (nested.error) return nested;
        position = nested.end - 1;
      }
      else if (offset && stack.length === 1 && (char === '>' || text.startsWith('&gt;', position))) {
        closeStart = position;
        if (char !== '>') position += 3;
        stack.pop();
      }
      else if (char === '(' || char === '[') stack.push(char === '(' ? ')' : ']');
      else if (char === ')' || char === ']') {
        if (stack.pop() !== char) return { error: 'err_snippet_call_syntax' };
      }
    }
    if (stack.length) return { error: 'err_snippet_call_syntax' };
    if (offset) {
      call.offsetOpenStart = openStart;
      call.offsetCloseEnd = position;
      call.offsetStart = from;
      call.offsetEnd = closeStart;
      if (!text.slice(from, closeStart).trim()) return { error: 'err_snippet_cursor_offset' };
    } else {
      call.argsStart = from;
      call.argsEnd = position - 1;
    }
    call.end = position;
  }
  return call.argsStart === undefined ? { error: 'err_snippet_call_syntax' } : call;
}

/**
 * Compiles a trigger string into a RegExp if it contains ${name:regex} syntax.
 * Example: ";task ${id:\d+}" -> /;task (?<id>\d+)$/
 */
function compileTrigger(trigger) {
  if (!trigger.includes('${')) {
    return { isRegex: false, literal: trigger };
  }

  const placeholders = [];
  const flagsSet = new Set();
  
  let pattern = trigger.replace(/\$\{([^:}]+)(?::([^}]+))?\}/g, (match, name, inner) => {
    const id = placeholders.length;
    let regex = inner || '[^ ]+';
    
    // Check for flags within inner part: regex:flags
    // We look for the last colon to separate regex from flags
    if (inner && inner.includes(':')) {
      const lastColonIndex = inner.lastIndexOf(':');
      const potentialFlags = inner.substring(lastColonIndex + 1);
      // Valid JS regex flags: g, i, m, s, u, y
      if (/^[gimsuy]+$/.test(potentialFlags)) {
        regex = inner.substring(0, lastColonIndex);
        [...potentialFlags].forEach(f => flagsSet.add(f));
      }
    }

    placeholders.push(`(?<${name}>${regex})`);
    return `__SNIP_PH_${id}__`;
  });

  pattern = escapeRegex(pattern);
  placeholders.forEach((ph, i) => {
    pattern = pattern.replace(`__SNIP_PH_${i}__`, ph);
  });

  const flags = [...flagsSet].join('');

  try {
    return { isRegex: true, regex: new RegExp(pattern + '$', flags) };
  } catch (e) {
    return { isRegex: false, literal: trigger, error: e.message };
  }
}
