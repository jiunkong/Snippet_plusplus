/**
 * Snippet++ Safe Expression Evaluator
 * Evaluates arithmetic, comparison, and logic expressions without eval().
 * Supports: +, -, *, /, %, ==, !=, >, <, >=, <=, &&, ||, (), $arg, index,
 *           and built-in functions: date(), time(), datetime(), url(), domain(),
 *           title(), uuid(), random(...).
 *
 * async functions (clipboard(), prompt()) are pre-resolved in template.js
 * before being passed here as string literals.
 */

// --- Built-in Functions ---

function splitArgs(str) {
  const items = [];
  let current = '';
  let depth = 0;
  let inQuote = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if ((c === "'" || c === '"') && !inQuote) inQuote = c;
    else if (c === inQuote) inQuote = null;
    else if (!inQuote && c === '(') depth++;
    else if (!inQuote && c === ')') depth--;
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

function callRandomFunction(argsStr, args) {
  const items = splitArgs(argsStr);
  if (items.length === 0) return '';

  const evaluated = items.map(item => {
    item = item.trim();
    // Find ~ outside quotes for range syntax
    let tildeIdx = -1;
    let inQ = null;
    for (let i = 0; i < item.length; i++) {
      const c = item[i];
      if ((c === "'" || c === '"') && !inQ) inQ = c;
      else if (c === inQ) inQ = null;
      if (c === '~' && !inQ) { tildeIdx = i; break; }
    }
    if (tildeIdx !== -1) {
      const v1 = Number(evaluateExpression(item.substring(0, tildeIdx).trim(), args));
      const v2 = Number(evaluateExpression(item.substring(tildeIdx + 1).trim(), args));
      if (!isNaN(v1) && !isNaN(v2)) {
        return Math.floor(Math.random() * (Math.abs(v2 - v1) + 1)) + Math.min(v1, v2);
      }
    }
    return evaluateExpression(item, args);
  });

  if (evaluated.length === 1) return evaluated[0]; // single range arg
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

function callBuiltinFunction(name, argsStr, args) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  switch (name) {
    case 'date': {
      const format = evaluateExpression(splitArgs(argsStr)[0] || '', args);
      return format ? formatDate(now, String(format)) : defaultDate;
    }
    case 'time': {
      const format = evaluateExpression(splitArgs(argsStr)[0] || '', args);
      return format ? formatDate(now, String(format)) : defaultTime;
    }
    case 'datetime': {
      const format = evaluateExpression(splitArgs(argsStr)[0] || '', args);
      return format ? formatDate(now, String(format)) : `${defaultDate} ${defaultTime}`;
    }
    case 'url':      return window.location.href;
    case 'domain':   return window.location.hostname;
    case 'title':    return document.title;
    case 'uuid':     return crypto.randomUUID();
    case 'random':   return callRandomFunction(argsStr, args);
    case 'bs':
    case 'backspace': return '\u0008';
    case 'upper':    return String(evaluateExpression(splitArgs(argsStr)[0] || '', args) || '').toUpperCase();
    case 'lower':    return String(evaluateExpression(splitArgs(argsStr)[0] || '', args) || '').toLowerCase();
    case 'trim':     return String(evaluateExpression(splitArgs(argsStr)[0] || '', args) || '').trim();
    case 'capitalize': {
      const s = String(evaluateExpression(splitArgs(argsStr)[0] || '', args) || '');
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case 'substr': {
      const items = splitArgs(argsStr).map(p => evaluateExpression(p, args));
      return String(items[0] || '').substr(items[1] || 0, items[2]);
    }
    case 'replace': {
      const items = splitArgs(argsStr).map(p => evaluateExpression(p, args));
      return String(items[0] || '').replace(items[1] || '', items[2] || '');
    }
    case 'len': return String(evaluateExpression(splitArgs(argsStr)[0] || '', args) || '').length;
    case 'str': return String(evaluateExpression(splitArgs(argsStr)[0] || '', args) ?? '');
    case 'num': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args));
      return isNaN(v) ? 0 : v;
    }
    case 'int': {
      const v = parseInt(evaluateExpression(splitArgs(argsStr)[0] || 0, args));
      return isNaN(v) ? 0 : v;
    }
    case 'round': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args));
      return isNaN(v) ? 0 : Math.round(v);
    }
    case 'ceil': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args));
      return isNaN(v) ? 0 : Math.ceil(v);
    }
    case 'floor': {
      const v = Number(evaluateExpression(splitArgs(argsStr)[0] || 0, args));
      return isNaN(v) ? 0 : Math.floor(v);
    }
    case 'min': {
      const vals = splitArgs(argsStr).map(p => Number(evaluateExpression(p, args))).filter(n => !isNaN(n));
      return vals.length ? Math.min(...vals) : 0;
    }
    case 'max': {
      const vals = splitArgs(argsStr).map(p => Number(evaluateExpression(p, args))).filter(n => !isNaN(n));
      return vals.length ? Math.max(...vals) : 0;
    }
    // clipboard() and prompt() are pre-resolved in template.js before reaching here
    default: return '';
  }
}

// --- Expression Evaluator ---

function evaluateExpression(expr, args) {
  let text = expr.trim();
  if (!text) return null;

  // 1. Function calls and parentheses (innermost first)
  while (text.includes('(')) {
    let start = -1;
    let end = -1;
    let inQ = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if ((c === "'" || c === '"') && !inQ) inQ = c;
      else if (c === inQ) inQ = null;
      if (!inQ) {
        if (c === '(') start = i;
        else if (c === ')') { if (start !== -1) { end = i; break; } }
      }
    }
    if (start !== -1 && end !== -1) {
      const funcNameMatch = text.substring(0, start).match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
      if (funcNameMatch) {
        const funcName = funcNameMatch[1];
        const funcStart = start - funcName.length;
        const argsStr = text.substring(start + 1, end);
        const res = callBuiltinFunction(funcName, argsStr, args);
        const val = (typeof res === 'string') ? `'${res.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(res ?? '');
        text = text.substring(0, funcStart) + val + text.substring(end + 1);
      } else {
        // Plain parentheses grouping
        const sub = text.substring(start + 1, end);
        const res = evaluateExpression(sub, args);
        const val = (typeof res === 'string') ? `'${res.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : (res ?? '');
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
      
      const conditionRes = evaluateCondition(condRaw, args);
      return evaluateExpression(conditionRes ? trueRaw : falseRaw, args);
    }
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
    const left = evaluateExpression(text.substring(0, orIdx), args);
    if (!!left) return true;
    return !!evaluateExpression(text.substring(orIdx + 2), args);
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
    const left = evaluateExpression(text.substring(0, andIdx), args);
    if (!left) return false;
    return !!evaluateExpression(text.substring(andIdx + 2), args);
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
    const left = evaluateExpression(leftRaw, args);
    const right = evaluateExpression(rightRaw, args);
    switch (opType) {
      case '==': return left == right;
      case '!=': return left != right;
      case '>':  return left > right;
      case '<':  return left < right;
      case '>=': return left >= right;
      case '<=': return left <= right;
    }
  }

  // 5. Addition / Subtraction
  const lastAddSub = findLastOperator(text, ['+', '-']);
  if (lastAddSub !== -1) {
    const left  = evaluateExpression(text.substring(0, lastAddSub), args);
    const right = evaluateExpression(text.substring(lastAddSub + 1), args);
    return text[lastAddSub] === '+' ? (left + right) : (left - right);
  }

  // 6. Multiplication / Division / Modulo
  const lastMulDiv = findLastOperator(text, ['*', '/', '%']);
  if (lastMulDiv !== -1) {
    const left  = evaluateExpression(text.substring(0, lastMulDiv), args);
    const right = evaluateExpression(text.substring(lastMulDiv + 1), args);
    const op = text[lastMulDiv];
    if (op === '*') return left * right;
    if (op === '/') return left / right;
    if (op === '%') return left % right;
  }

  // 7. Base Token
  return resolveToken(text, args);
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
      if (char === '-' && (i === 0 || /[+\-*/%=(!]/.test(text[i-1]))) continue;
      return i;
    }
  }
  return -1;
}

function resolveToken(token, args) {
  token = token.trim();
  if (token.startsWith('$')) {
    const val = args[token.substring(1)];
    return val === undefined ? null : val;
  }
  if (token === 'index') return args.index;
  if (token === 'true')  return true;
  if (token === 'false') return false;
  if (token === 'null')  return null;
  if (!isNaN(token) && token !== '') return parseFloat(token);
  if ((token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))) {
    return token.substring(1, token.length - 1);
  }
  return "";
}

function evaluateCondition(condition, args) {
  const result = evaluateExpression(condition, args);
  return !!result && result !== 'false' && result !== '0';
}
