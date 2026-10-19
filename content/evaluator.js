/**
 * Snippet++ Safe Expression Evaluator
 * Evaluates arithmetic, comparison, and logic expressions without eval().
 * Supports: +, -, *, /, %, ==, !=, >, <, >=, <=, &&, ||, (), $arg, index,
 *           and built-in functions: date(), time(), datetime(), url(), domain(),
 *           title(), uuid(), random(...).
 *
 * Fragment literals, fragment(), and async functions are pre-resolved in template.js
 * before being passed here as expression-local variables.
 */

// --- Built-in Functions ---

function splitArgs(str) {
  const items = [];
  let current = '';
  let depth = 0;
  let inQuote = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (!inQuote && c === '`') {
      const literal = scanSnippetQuotedValue(str, i);
      if (literal.error) throw createSnippetError(literal.error);
      current += str.slice(i, literal.end);
      i = literal.end - 1;
      continue;
    }
    if (inQuote && c === '\\' && i + 1 < str.length) {
      current += c + str[++i];
      continue;
    }
    if ((c === "'" || c === '"') && !inQuote) inQuote = c;
    else if (c === inQuote) inQuote = null;
    else if (!inQuote && (c === '(' || c === '[')) depth++;
    else if (!inQuote && (c === ')' || c === ']')) depth--;
    if (!inQuote && depth === 0 && c === ',') {
      items.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function callRandomFunction(argsStr, args, execution) {
  const items = splitArgs(argsStr);
  if (items.length === 0) return '';

  const evaluated = items.map(item => {
    const value = evaluateExpression(item, args, execution);
    if (!isRange(value)) return value;
    const low = Math.min(value.start, value.end);
    return low + Math.floor(Math.random() * (Math.abs(value.end - value.start) + 1));
  });

  if (evaluated.length === 1) return evaluated[0]; // single value or sampled range
  return evaluated[Math.floor(Math.random() * evaluated.length)];
}

function formatDate(date, format) {
  const pad = n => String(n).padStart(2, '0');
  const tokens = {
    'YYYY': date.getFullYear(),
    'YY': String(date.getFullYear()).slice(-2),
    'MM': pad(date.getMonth() + 1),
    'M': date.getMonth() + 1,
    'DD': pad(date.getDate()),
    'D': date.getDate(),
    'HH': pad(date.getHours()),
    'H': date.getHours(),
    'mm': pad(date.getMinutes()),
    'm': date.getMinutes(),
    'ss': pad(date.getSeconds()),
    's': date.getSeconds(),
    'ddd': date.toLocaleDateString(undefined, { weekday: 'short' }),
    'dddd': date.toLocaleDateString(undefined, { weekday: 'long' })
  };

  return format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s|dddd|ddd/g, match => tokens[match]);
}

function callBuiltinFunction(name, argsStr, args, execution) {
  const arities = {
    url: [0, 0], domain: [0, 0], title: [0, 0], uuid: [0, 0], bs: [0, 0], backspace: [0, 0],
    date: [0, 1], time: [0, 1], datetime: [0, 1], random: [1, Infinity],
    upper: [1, 1], lower: [1, 1], trim: [1, 1], capitalize: [1, 1], substr: [2, 3],
    startswith: [2, 2], endswith: [2, 2], includes: [2, 2], split: [2, 2], join: [2, 2], insertAt: [3, 3], removeAt: [2, 2], replace: [3, 3], len: [1, 1], str: [1, 1],
    num: [1, 1], int: [1, 1], bool: [1, 1], type: [1, 1], isCursor: [1, 1], hasCursor: [1, 1], round: [1, 1], ceil: [1, 1], floor: [1, 1], min: [1, Infinity], max: [1, Infinity]
  };
  if (!Object.prototype.hasOwnProperty.call(arities, name)) throw createSnippetError('err_unknown_function', [name]);
  const parts = splitArgs(argsStr);
  const [minimum, maximum] = arities[name];
  if (parts.some(part => !part) || /,\s*$/.test(argsStr) || parts.length < minimum || parts.length > maximum) {
    throw createSnippetError('err_function_arguments', [name]);
  }
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  switch (name) {
    case 'date': {
      const format = evaluateExpression(splitArgs(argsStr)[0] || '', args, execution);
      return format ? formatDate(now, String(format)) : defaultDate;
    }
    case 'time': {
      const format = evaluateExpression(splitArgs(argsStr)[0] || '', args, execution);
      return format ? formatDate(now, String(format)) : defaultTime;
    }
    case 'datetime': {
      const format = evaluateExpression(splitArgs(argsStr)[0] || '', args, execution);
      return format ? formatDate(now, String(format)) : `${defaultDate} ${defaultTime}`;
    }
    case 'url':      return window.location.href;
    case 'domain':   return window.location.hostname;
    case 'title':    return document.title;
    case 'uuid':     return crypto.randomUUID();
    case 'random':   return callRandomFunction(argsStr, args, execution);
    case 'bs':
    case 'backspace': return '\u0008';
    case 'upper':
    case 'lower':
    case 'trim':
    case 'capitalize': {
      const value = evaluateExpression(parts[0], args, execution);
      if (value instanceof SnippetFragment) {
        if (name === 'trim') {
          return new SnippetFragment(value.nodes.map((node, i) => {
            execution?.check();
            if (node.type === 'cursor') return node;
            let text = node.value;
            if (i === 0) text = text.trimStart();
            if (i === value.nodes.length - 1) text = text.trimEnd();
            return { type: 'text', value: text };
          }));
        }
        let first = true;
        return new SnippetFragment(value.nodes.map(node => {
          execution?.check();
          if (node.type === 'cursor') return node;
          const text = name === 'upper' ? node.value.toUpperCase() : name === 'lower' ? node.value.toLowerCase()
            : first ? String.fromCodePoint(node.value.codePointAt(0)).toUpperCase() + node.value.slice(node.value.codePointAt(0) > 0xffff ? 2 : 1) : node.value;
          first = false;
          return { type: 'text', value: text };
        }));
      }
      const s = String(value || '');
      if (name === 'upper') return s.toUpperCase();
      if (name === 'lower') return s.toLowerCase();
      if (name === 'trim') return s.trim();
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case 'substr': {
      const items = splitArgs(argsStr).map(p => evaluateExpression(p, args, execution));
      if (items[0] instanceof SnippetFragment) {
        const units = snippetIterableItems(items[0], execution);
        // Match substr's start/count coercion, but count Unicode characters and
        // cursor nodes as complete units instead of slicing serialized syntax.
        const integer = value => { const n = Number(value); return Number.isNaN(n) ? 0 : Math.trunc(n); };
        const rawStart = integer(items[1]);
        const start = rawStart < 0 ? Math.max(0, units.length + rawStart) : Math.min(rawStart, units.length);
        const count = items[2] === undefined ? units.length : Math.max(0, integer(items[2]));
        return snippetFragmentFromUnits(units.slice(start, start + count));
      }
      return String(items[0] || '').substr(items[1] || 0, items[2]);
    }
    case 'startswith':
    case 'endswith': {
      const items = splitArgs(argsStr).map(p => evaluateExpression(p, args, execution));
      if (items[0] instanceof SnippetFragment || items[1] instanceof SnippetFragment) {
        const units = snippetIterableItems(SnippetFragment.from(items[0]), execution);
        const search = snippetIterableItems(SnippetFragment.from(items[1]), execution);
        return snippetFragmentMatchAt(units, search, name === 'startswith' ? 0 : units.length - search.length, execution);
      }
      const value = String(items[0] ?? '');
      const search = String(items[1] ?? '');
      return name === 'startswith' ? value.startsWith(search) : value.endsWith(search);
    }
    case 'replace': {
      const items = splitArgs(argsStr).map(p => evaluateExpression(p, args, execution));
      if (items.some(item => item instanceof SnippetFragment)) return snippetFragmentReplace(SnippetFragment.from(items[0]), items[1] ?? '', items[2] ?? '', execution);
      return String(items[0] || '').replace(items[1] || '', items[2] || '');
    }
    case 'includes': {
      const target = evaluateExpression(parts[0], args, execution);
      const value = evaluateExpression(parts[1], args, execution);
      if (!isSnippetIterable(target)) throw createSnippetError('err_includes_iterable_target');
      if (isRange(target)) {
        return Number.isSafeInteger(value) && value >= Math.min(target.start, target.end)
          && value <= Math.max(target.start, target.end);
      }
      if (Array.isArray(target)) return target.some(item => snippetValuesEqual(item, value, execution));
      if (typeof target === 'string' && !(value instanceof SnippetFragment)) return target.includes(String(value ?? ''));
      const search = snippetIterableItems(SnippetFragment.from(value), execution);
      if (!search.length) return true;
      const units = snippetIterableItems(SnippetFragment.from(target), execution);
      for (let i = 0; i <= units.length - search.length; i++) {
        execution?.check();
        if (snippetFragmentMatchAt(units, search, i, execution)) return true;
      }
      return false;
    }
    case 'len': {
      const value = evaluateExpression(parts[0], args, execution);
      if (isRange(value)) return Math.abs(value.end - value.start) + 1;
      if (value instanceof SnippetFragment) return value.getLength(execution);
      return Array.isArray(value) ? value.length : Array.from(String(value || '')).length;
    }
    case 'split': {
      const value = evaluateExpression(parts[0], args, execution);
      const separator = evaluateExpression(parts[1], args, execution);
      if (value instanceof SnippetFragment || separator instanceof SnippetFragment) return createList(snippetFragmentSplit(SnippetFragment.from(value), separator ?? '', execution));
      return createList(String(value ?? '').split(String(separator ?? '')));
    }
    case 'join': {
      const value = evaluateExpression(parts[0], args, execution);
      const separator = evaluateExpression(parts[1], args, execution);
      if (!Array.isArray(value)) throw createSnippetError('err_join_list_required');
      if (separator instanceof SnippetFragment || value.some(item => item instanceof SnippetFragment)) {
        const units = [];
        value.forEach((item, i) => {
          execution?.check();
          if (i) units.push(separator);
          units.push(item);
        });
        return snippetFragmentFromUnits(units);
      }
      return value.join(String(separator ?? ''));
    }
    case 'insertAt':
    case 'removeAt': {
      let target = evaluateExpression(parts[0], args, execution);
      if (isRange(target)) throw createSnippetError('err_readonly_iterable', [name]);
      if (!isSnippetIterable(target)) throw createSnippetError('err_iterable_function_target', [name]);
      const index = evaluateExpression(parts[1], args, execution);
      if (!Number.isSafeInteger(index)) throw createSnippetError('err_list_index_integer');
      const inserted = name === 'insertAt' ? evaluateExpression(parts[2], args, execution) : undefined;
      if (typeof target === 'string' && inserted instanceof SnippetFragment) target = SnippetFragment.from(target);
      const result = snippetIterableItems(target, execution);
      const length = result.length;
      const position = index < 0 ? length + index : index;
      if (name === 'insertAt') {
        const value = inserted;
        if (position >= 0 && position <= length) result.splice(position, 0, typeof target === 'string' ? String(value ?? '') : value);
      } else if (position >= 0 && position < length) result.splice(position, 1);
      return target instanceof SnippetFragment ? snippetFragmentFromUnits(result)
        : typeof target === 'string' ? result.join('') : createList(result);
    }
    case 'str': return String(evaluateExpression(splitArgs(argsStr)[0] || '', args, execution) ?? '');
    case 'bool': return snippetConditionValue(evaluateExpression(parts[0], args, execution));
    case 'isCursor': {
      const value = evaluateExpression(parts[0], args, execution);
      return value instanceof SnippetFragment && value.nodes.length === 1 && value.nodes[0].type === 'cursor';
    }
    case 'hasCursor': {
      const value = evaluateExpression(parts[0], args, execution);
      return value instanceof SnippetFragment && value.nodes.some(node => {
        execution?.check();
        return node.type === 'cursor';
      });
    }
    case 'type': {
      const value = evaluateExpression(parts[0], args, execution);
      if (value === null) return 'null';
      if (typeof value === 'boolean') return 'bool';
      if (value instanceof SnippetFragment) return 'fragment';
      if (Array.isArray(value)) return 'list';
      return isRange(value) ? 'range' : typeof value;
    }
    case 'num': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args, execution));
      return isNaN(v) ? 0 : v;
    }
    case 'int': {
      const v = parseInt(evaluateExpression(splitArgs(argsStr)[0] || 0, args, execution));
      return isNaN(v) ? 0 : v;
    }
    case 'round': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args, execution));
      return isNaN(v) ? 0 : Math.round(v);
    }
    case 'ceil': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args, execution));
      return isNaN(v) ? 0 : Math.ceil(v);
    }
    case 'floor': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args, execution));
      return isNaN(v) ? 0 : Math.floor(v);
    }
    case 'min': {
      const vals = splitArgs(argsStr).map(p => Number(evaluateExpression(p, args, execution))).filter(n => !isNaN(n));
      return vals.length ? Math.min(...vals) : 0;
    }
    case 'max': {
      const vals = splitArgs(argsStr).map(p => Number(evaluateExpression(p, args, execution))).filter(n => !isNaN(n));
      return vals.length ? Math.max(...vals) : 0;
    }
    // paste() and prompt() are pre-resolved in template.js before reaching here
    default: throw createSnippetError('err_unknown_function', [name]);
  }
}

// Range has lower precedence than arithmetic. Ignore quoted text and nested
// calls/grouping; each nested expression is evaluated separately.
function rangeOperatorPositions(expression) {
  const positions = [];
  let quote = null;
  let depth = 0;
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === '~' && depth === 0) positions.push(i);
  }
  return positions;
}
function isRange(value) {
  return value !== null && typeof value === 'object' && value.type === 'range'
    && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && Number.isSafeInteger(Math.abs(value.end - value.start) + 1);
}

function createRange(start, end) {
  const range = { type: 'range', start, end };
  if (!isRange(range)) {
    throw createSnippetError('err_range_integer_bounds', [], 'Range endpoints must be safe integers.');
  }
  Object.defineProperty(range, 'toString', { value: () => `${start}~${end}` });
  return Object.freeze(range);
}

function isSnippetIterable(value) {
  return typeof value === 'string' || Array.isArray(value) || isRange(value) || value instanceof SnippetFragment;
}

function addSnippetValues(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) throw createSnippetError('err_list_concat_types');
    return createList([...left, ...right]);
  }
  if (left instanceof SnippetFragment || right instanceof SnippetFragment) {
    return SnippetFragment.from(left).concat(right);
  }
  return left + right;
}

function multiplySnippetValues(left, right, execution) {
  if (left instanceof SnippetFragment || right instanceof SnippetFragment) {
    const fragment = left instanceof SnippetFragment ? left : right;
    const count = left instanceof SnippetFragment ? right : left;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw createSnippetError('err_string_repeat_count');
    // Use the same allocation limit as string repetition before building nodes.
    try { fragment.toString().repeat(count); }
    catch (error) {
      if (error instanceof RangeError) throw createSnippetError('err_string_repeat_size');
      throw error;
    }
    const nodes = [];
    if (fragment.nodes.length) for (let i = 0; i < count; i++) {
      execution?.check();
      for (const node of fragment.nodes) nodes.push(node);
    }
    return new SnippetFragment(nodes);
  }
  if (typeof left === 'string' || typeof right === 'string') {
    const text = typeof left === 'string' ? left : right;
    const count = typeof left === 'string' ? right : left;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw createSnippetError('err_string_repeat_count');
    }
    try {
      return text.repeat(count);
    } catch (error) {
      if (error instanceof RangeError) throw createSnippetError('err_string_repeat_size');
      throw error;
    }
  }
  return left * right;
}

function snippetValuesEqual(left, right, execution) {
  execution?.check();
  if (left instanceof SnippetFragment && right instanceof SnippetFragment) {
    return left.nodes.length === right.nodes.length && left.nodes.every((node, i) => {
      execution?.check();
      const other = right.nodes[i];
      return node.type === other.type && (node.type === 'text' ? node.value === other.value : node.level === other.level);
    });
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => snippetValuesEqual(value, right[i], execution));
  }
  if (isRange(left) && isRange(right)) return left.start === right.start && left.end === right.end;
  return Object.is(left, right) || left === right;
}

function subtractSnippetValues(left, right, execution) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) throw createSnippetError('err_list_subtract_types');
    return createList(left.filter(value => {
      execution?.check();
      return !right.some(removed => snippetValuesEqual(value, removed, execution));
    }));
  }
  return left - right;
}

function createList(values) {
  const list = [...values];
  Object.defineProperty(list, 'toString', { value: () =>
    `[${list.map(value => typeof value === 'string' ? JSON.stringify(value) : String(value)).join(',')}]`
  });
  return Object.freeze(list);
}

// --- Expression Evaluator ---

function evaluateExpression(expr, args, execution) {
  execution?.check();
  let text = expr.trim();
  if (!text) return null;
  let quote = null;
  const delimiters = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') delimiters.push(char);
    else if (char === ')' || char === ']') {
      const open = delimiters.pop();
      if (open !== (char === ')' ? '(' : '[')) {
        throw createSnippetError(char === ']' || open === '[' ? 'err_list_syntax' : 'err_unmatched_close_paren');
      }
    }
  }
  if (quote) throw createSnippetError('err_unclosed_string');
  if (delimiters.length) throw createSnippetError(delimiters.includes('[') ? 'err_list_syntax' : 'err_unmatched_open_paren');
  args = { ...args };
  const storeResult = value => {
    let index = 0;
    let name;
    do { name = `__expressionValue${index++}`; }
    while (Object.prototype.hasOwnProperty.call(args, name) || text.includes('$' + name));
    args[name] = value;
    return '$' + name;
  };

  // 1. Function calls, grouping and list literals (innermost first).
  // Replace lists with scoped values before scanning outer operators.
  while (text.includes('(') || text.includes('[')) {
    execution?.check();
    let start = -1;
    let end = -1;
    let inQ = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ && c === '\\') { i++; continue; }
      if ((c === "'" || c === '"') && !inQ) inQ = c;
      else if (c === inQ) inQ = null;
      if (!inQ) {
        if (c === '(' || c === '[') start = i;
        else if (c === ')' || c === ']') { if (start !== -1) { end = i; break; } }
      }
    }
    if (start !== -1 && end !== -1) {
      if (text[start] === '[') {
        const source = text.slice(start + 1, end);
        const target = text.slice(0, start).match(/(\$[\p{L}\p{N}_]+|\b[\p{L}_][\p{L}\p{N}_]*|(?:\b\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')\s*$/u);
        if (target) {
          const parts = splitArgs(source);
          if (parts.length !== 1 || !source.trim() || /,\s*$/.test(source)) throw createSnippetError('err_list_index_integer');
          const iterable = resolveToken(target[1], args, execution);
          if (!isSnippetIterable(iterable)) throw createSnippetError('err_list_index_target');
          const index = evaluateExpression(source, args, execution);
          if (typeof index !== 'number' || !Number.isSafeInteger(index)) throw createSnippetError('err_list_index_integer');
          let value;
          if (isRange(iterable)) {
            // Read ranges arithmetically; even huge ranges need no allocation.
            const distance = Math.abs(iterable.end - iterable.start);
            const step = iterable.end < iterable.start ? -1 : 1;
            if ((index < 0 ? -index - 1 : index) <= distance) {
              value = index < 0 ? iterable.end + (index + 1) * step : iterable.start + index * step;
            }
          } else {
            const items = snippetIterableItems(iterable, execution);
            const position = index < 0 ? items.length + index : index;
            value = position >= 0 && position < items.length ? items[position] : undefined;
          }
          text = text.slice(0, start - target[0].length) + storeResult(value) + text.slice(end + 1);
          continue;
        }
        const parts = splitArgs(source);
        if (parts.some(part => !part) || /,\s*$/.test(source)) throw createSnippetError('err_list_syntax');
        const value = createList(parts.map(part => evaluateExpression(part, args, execution)));
        text = text.slice(0, start) + storeResult(value) + text.slice(end + 1);
        continue;
      }
      const funcNameMatch = text.substring(0, start).match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
      if (funcNameMatch) {
        const funcName = funcNameMatch[1];
        const funcStart = start - funcNameMatch[0].length;
        const argsStr = text.substring(start + 1, end);
        const res = callBuiltinFunction(funcName, argsStr, args, execution);
        const val = storeResult(res);
        text = text.substring(0, funcStart) + val + text.substring(end + 1);
      } else {
        // Plain parentheses grouping
        const sub = text.substring(start + 1, end);
        if (!sub.trim()) throw createSnippetError('err_missing_operand', ['()']);
        const res = evaluateExpression(sub, args, execution);
        const val = storeResult(res);
        text = text.substring(0, start) + val + text.substring(end + 1);
      }
    } else break;
  }

  // 1.5 Ternary Operator (condition ? trueExpr : falseExpr)
  let ternaryStart = -1;
  let inQ = null;
  let pDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ((c === "'" || c === '"') && !inQ) inQ = c;
    else if (c === inQ) inQ = null;
    if (!inQ) {
      if (c === '(') pDepth++;
      else if (c === ')') pDepth--;
      if (pDepth === 0 && c === '?') { ternaryStart = i; break; }
    }
  }

  if (ternaryStart !== -1) {
    // Find the matching ':' for this '?'
    let ternaryEnd = -1;
    let tDepth = 1;
    let inQE = null;
    let pDepthE = 0;
    for (let i = ternaryStart + 1; i < text.length; i++) {
      const c = text[i];
      if ((c === "'" || c === '"') && !inQE) inQE = c;
      else if (c === inQE) inQE = null;
      if (!inQE) {
        if (c === '(') pDepthE++;
        else if (c === ')') pDepthE--;
        if (pDepthE === 0) {
          if (c === '?') tDepth++;
          else if (c === ':') {
            tDepth--;
            if (tDepth === 0) { ternaryEnd = i; break; }
          }
        }
      }
    }

    if (ternaryEnd !== -1) {
      const condRaw = text.substring(0, ternaryStart);
      const trueRaw = text.substring(ternaryStart + 1, ternaryEnd);
      const falseRaw = text.substring(ternaryEnd + 1);
      if (!condRaw.trim() || !trueRaw.trim() || !falseRaw.trim()) {
        throw createSnippetError('err_missing_operand', [text]);
      }
      
      const conditionRes = evaluateCondition(condRaw, args, execution);
      return evaluateExpression(conditionRes ? trueRaw : falseRaw, args, execution);
    }
  }

  // Range values can be stored in variables and passed to functions.
  const rangeOperators = rangeOperatorPositions(text);
  if (rangeOperators.length) {
    const index = rangeOperators[0];
    if (rangeOperators.length !== 1 || !text.slice(0, index).trim() || !text.slice(index + 1).trim()) {
      throw createSnippetError('err_range_both_values_required', [text], 'A range requires exactly two endpoints.');
    }
    return createRange(evaluateExpression(text.slice(0, index), args, execution),
      evaluateExpression(text.slice(index + 1), args, execution));
  }

  // 2. Logic OR (||)
  let orIdx = -1;
  let qOR = null;
  for (let i = text.length - 1; i >= 1; i--) {
    const c = text[i];
    if (c === "'" || c === '"') {
      if (!qOR) qOR = c; else if (qOR === c) qOR = null;
    }
    if (!qOR && c === '|' && text[i-1] === '|') {
      orIdx = i - 1;
      break;
    }
  }
  if (orIdx !== -1) {
    if (!text.slice(0, orIdx).trim() || !text.slice(orIdx + 2).trim()) throw createSnippetError('err_missing_operand', [text]);
    const left = evaluateExpression(text.substring(0, orIdx), args, execution);
    if (snippetBooleanValue(left)) return true;
    return snippetBooleanValue(evaluateExpression(text.substring(orIdx + 2), args, execution));
  }

  // 3. Logic AND (&&)
  let andIdx = -1;
  let qAND = null;
  for (let i = text.length - 1; i >= 1; i--) {
    const c = text[i];
    if (c === "'" || c === '"') {
      if (!qAND) qAND = c; else if (qAND === c) qAND = null;
    }
    if (!qAND && c === '&' && text[i-1] === '&') {
      andIdx = i - 1;
      break;
    }
  }
  if (andIdx !== -1) {
    if (!text.slice(0, andIdx).trim() || !text.slice(andIdx + 2).trim()) throw createSnippetError('err_missing_operand', [text]);
    const left = evaluateExpression(text.substring(0, andIdx), args, execution);
    if (!snippetBooleanValue(left)) return false;
    return snippetBooleanValue(evaluateExpression(text.substring(andIdx + 2), args, execution));
  }

  // 4. Comparison (==, !=, >=, <=, >, <)
  let opIdx = -1;
  let opType = "";
  let currentInQ = null;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === "'" || c === '"') {
      if (!currentInQ) currentInQ = c;
      else if (currentInQ === c) currentInQ = null;
    }
    if (!currentInQ) {
      // Check 2-char ops
      if (i > 0) {
        const two = text.substring(i - 1, i + 1);
        if (['==', '!=', '>=', '<='].includes(two)) {
          opIdx = i - 1;
          opType = two;
          break;
        }
      }
      // Check 1-char ops
      if (c === '>' || c === '<') {
        opIdx = i;
        opType = c;
        break;
      }
    }
  }

  if (opIdx !== -1) {
    const leftRaw = text.substring(0, opIdx);
    const rightRaw = text.substring(opIdx + opType.length);
    if (!leftRaw.trim() || !rightRaw.trim()) throw createSnippetError('err_missing_operand', [text]);
    const left = evaluateExpression(leftRaw, args, execution);
    const right = evaluateExpression(rightRaw, args, execution);
    switch (opType) {
      case '==': return left instanceof SnippetFragment && right instanceof SnippetFragment ? snippetValuesEqual(left, right, execution) : left == right;
      case '!=': return left instanceof SnippetFragment && right instanceof SnippetFragment ? !snippetValuesEqual(left, right, execution) : left != right;
      case '>':  return left > right;
      case '<':  return left < right;
      case '>=': return left >= right;
      case '<=': return left <= right;
    }
  }

  // 5. Addition / Subtraction
  const lastAddSub = findLastOperator(text, ['+', '-']);
  if (lastAddSub !== -1) {
    if (!text.slice(0, lastAddSub).trim() || !text.slice(lastAddSub + 1).trim()) {
      throw createSnippetError('err_missing_operand', [text]);
    }
    const left  = evaluateExpression(text.substring(0, lastAddSub), args, execution);
    const right = evaluateExpression(text.substring(lastAddSub + 1), args, execution);
    return text[lastAddSub] === '+' ? addSnippetValues(left, right) : subtractSnippetValues(left, right, execution);
  }

  // 6. Multiplication / Division / Modulo
  const lastMulDiv = findLastOperator(text, ['*', '/', '%']);
  if (lastMulDiv !== -1) {
    if (!text.slice(0, lastMulDiv).trim() || !text.slice(lastMulDiv + 1).trim()) {
      throw createSnippetError('err_missing_operand', [text]);
    }
    const left  = evaluateExpression(text.substring(0, lastMulDiv), args, execution);
    const right = evaluateExpression(text.substring(lastMulDiv + 1), args, execution);
    const op = text[lastMulDiv];
    if (op === '*') return multiplySnippetValues(left, right, execution);
    if (op === '/') return left / right;
    if (op === '%') return left % right;
  }

  // 7. Base Token
  return resolveToken(text, args, execution);
}

/**
 * Finds the index of the last operator in a list, ensuring it's not inside a string.
 */
function findLastOperator(text, ops) {
  let inQuote = null;
  for (let i = text.length - 1; i >= 0; i--) {
    const char = text[i];
    if (char === "'" || char === '"') {
      if (!inQuote) inQuote = char;
      else if (inQuote === char) inQuote = null;
    }
    if (!inQuote && ops.includes(char)) {
      if ((char === '-' || char === '+') && (i === 0 || /[+\-*/%=(!]/.test(text[i-1]))) continue;
      return i;
    }
  }
  return -1;
}

function resolveToken(token, args, execution) {
  token = token.trim();
  if (token.startsWith('$')) {
    const name = token.substring(1);
    if (!/^[\p{L}\p{N}_]+$/u.test(name)) throw createSnippetError('err_var_name_required');
    if (!Object.prototype.hasOwnProperty.call(args, name)) throw createSnippetError('err_undefined_variable', [token]);
    return args[name];
  }
  if (token === 'index') {
    if (!Object.prototype.hasOwnProperty.call(args, 'index')) throw createSnippetError('err_index_outside_for');
    return args.index;
  }
  if (token === 'value') {
    if (!Object.prototype.hasOwnProperty.call(args, SNIPPET_LOOP_VALUE)) throw createSnippetError('err_value_outside_for');
    return args[SNIPPET_LOOP_VALUE];
  }
  if (token === 'true')  return true;
  if (token === 'false') return false;
  if (token === 'null')  return null;
  if (token === 'undefined') return undefined;
  if (!isNaN(token) && token !== '') return parseFloat(token);
  if ((token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))) {
    return token.substring(1, token.length - 1);
  }
  throw createSnippetError('err_unknown_tag', [token]);
}

function evaluateCondition(condition, args, execution) {
  const result = evaluateExpression(condition, args, execution);
  return snippetConditionValue(result);
}

function snippetConditionValue(value) {
  if (value instanceof SnippetFragment) value = String(value);
  return !!value && value !== 'false' && value !== '0';
}

function snippetBooleanValue(value) {
  return value instanceof SnippetFragment ? value.nodes.length > 0 : !!value;
}
