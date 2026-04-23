// --- Template Engine ---
// Note: evaluateExpression, callBuiltinFunction etc. are provided by evaluator.js.
// Note: showSnippetPrompt is provided by handlers.js.

/**
 * Pre-resolves async function calls (clipboard(), prompt()) in an expression
 * by awaiting their values and substituting them as quoted string literals.
 * This allows the synchronous evaluateExpression() to handle the rest.
 */
async function resolveAsyncCalls(expr, args) {
  let result = expr;

  // clipboard()
  if (result.includes('clipboard()')) {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { }
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    result = result.replace(/clipboard\(\)/g, `'${escaped}'`);
  }

  // prompt(expr)
  // We search for prompt( and find its matching paren
  let searchIdx = 0;
  while (true) {
    const startIdx = result.indexOf('prompt(', searchIdx);
    if (startIdx === -1) break;

    const openParenIdx = startIdx + 6;
    let depth = 1;
    let closeParenIdx = -1;
    for (let j = openParenIdx + 1; j < result.length; j++) {
      if (result[j] === '(') depth++;
      else if (result[j] === ')') {
        depth--;
        if (depth === 0) { closeParenIdx = j; break; }
      }
    }

    if (closeParenIdx !== -1) {
      const argExpr = result.substring(openParenIdx + 1, closeParenIdx).trim();
      const res = evaluateExpression(argExpr, args);
      const msg = (res === null || res === undefined) ? 'Enter value:' : String(res);

      let val = '';
      if (typeof showSnippetPrompt === 'function') {
        val = await showSnippetPrompt(msg);
      } else {
        val = window.prompt(msg) || '';
      }

      const escaped = val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      result = result.substring(0, startIdx) + `'${escaped}'` + result.substring(closeParenIdx + 1);
      searchIdx = 0;
    } else {
      searchIdx = startIdx + 7;
    }
  }

  // choice(title, opt1, opt2, ...)
  searchIdx = 0;
  while (true) {
    const startIdx = result.indexOf('choice(', searchIdx);
    if (startIdx === -1) break;

    const openParenIdx = startIdx + 6;
    let depth = 1;
    let closeParenIdx = -1;
    for (let j = openParenIdx + 1; j < result.length; j++) {
      if (result[j] === '(') depth++;
      else if (result[j] === ')') {
        depth--;
        if (depth === 0) { closeParenIdx = j; break; }
      }
    }

    if (closeParenIdx !== -1) {
      const argsStr = result.substring(openParenIdx + 1, closeParenIdx).trim();
      // splitArgs is available in evaluator.js
      const argExprs = splitArgs(argsStr);
      const evaluatedArgs = argExprs.map(expr => evaluateExpression(expr, args));
      
      const title = evaluatedArgs[0] || 'Select Option:';
      const options = evaluatedArgs.slice(1);

      let val = '';
      if (typeof showSnippetChoice === 'function') {
        val = await showSnippetChoice(title, options);
      } else {
        // Fallback to prompt if choice UI not available
        val = window.prompt(`${title}\nOptions: ${options.join(', ')}`) || '';
      }

      const escaped = String(val ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      result = result.substring(0, startIdx) + `'${escaped}'` + result.substring(closeParenIdx + 1);
      searchIdx = 0;
    } else {
      searchIdx = startIdx + 7;
    }
  }

  return result;
}

/**
 * Processes control flow (for, if, set, switch/case), expressions, and placeholders.
 * Now async to support clipboard() and prompt() inline.
 */
async function processTemplate(template, args) {
  let result = "";
  let remaining = template.replace(/\\\r?\n\s*/g, ''); // Line Continuation with Indent stripping
  
  // Track keys that are newly created in this scope level
  const newlyCreated = new Set();

  const setVar = (name, val) => {
    if (!(name in args)) newlyCreated.add(name);
    args[name] = val;
  };

  // Find {{ where the char at +2 is not { (skips {{{ patterns)
  const findOpen = (str) => {
    let i = str.indexOf('{{');
    while (i !== -1) {
      if (str[i + 2] !== '{') return i;
      i = str.indexOf('{{', i + 1);
    }
    return -1;
  };

  // Find }} that closes a tag, skipping over string literals so that
  // { or } inside 'quotes' or "quotes" don't confuse the parser.
  const findClose = (str, from) => {
    let i = from;
    while (i < str.length - 1) {
      const ch = str[i];
      // Skip string literals
      if (ch === '\'' || ch === '"') {
        const quote = ch;
        i++;
        while (i < str.length) {
          if (str[i] === '\\') { i += 2; continue; }
          if (str[i] === quote) { i++; break; }
          i++;
        }
        continue;
      }
      // Closing }}
      if (ch === '}' && str[i + 1] === '}') {
        if (i === 0 || str[i - 1] !== '}') return i;
      }
      i++;
    }
    return -1;
  };

  while (remaining.length > 0) {
    const tagStart = findOpen(remaining);
    if (tagStart === -1) { result += remaining; break; }

    result += remaining.substring(0, tagStart);
    remaining = remaining.substring(tagStart);

    const tagEnd = findClose(remaining, 2);
    if (tagEnd === -1) { result += remaining; break; }

    const fullTag = remaining.substring(0, tagEnd + 2);
    const content = remaining.substring(2, tagEnd).trim();
    remaining = remaining.substring(tagEnd + 2);

    // 1. {{set $var [op] expr}}
    if (content.startsWith('set ')) {
      const assignment = content.substring(4);
      const varMatch = assignment.match(/^\$(?<n>[\p{L}\p{N}_]+)\s*(?<op>=|\+=|-=|\*=|%=|\/=)\s*(?<v>[\s\S]*)$/u);
      if (varMatch) {
        const { n: name, op, v: expr } = varMatch.groups;
        const resolved = await resolveAsyncCalls(expr, args);
        const newVal = evaluateExpression(resolved, args);
        
        if (op === '=') {
          setVar(name, newVal);
        } else {
          const oldVal = args[name] ?? 0;
          switch (op) {
            case '+=': setVar(name, oldVal + newVal); break;
            case '-=': setVar(name, oldVal - newVal); break;
            case '*=': setVar(name, oldVal * newVal); break;
            case '/=': setVar(name, oldVal / newVal); break;
            case '%=': setVar(name, oldVal % newVal); break;
          }
        }
      }
      continue;
    }

    // 2. {{for expr}} ... {{endfor}}
    if (content.startsWith('for ')) {
      const countExpr = content.substring(4);
      const { body, rest } = findMatchingBlock(remaining, 'for', 'endfor');
      remaining = rest;
      const count = parseInt(evaluateExpression(countExpr, args), 10) || 0;
      
      const hadIndex = ('index' in args);
      const oldIndex = args['index'];

      for (let i = 0; i < count; i++) {
        args['index'] = i;
        result += await processTemplate(body, args);
      }

      if (hadIndex) args['index'] = oldIndex;
      else delete args['index'];

      continue;
    }

    // 3. {{if expr}} ... {{endif}}
    if (content.startsWith('if ')) {
      const initialCond = content.substring(3);
      const { body, rest } = findMatchingBlock(remaining, 'if', 'endif');
      remaining = rest;

      const segments = [{ cond: initialCond, content: "" }];
      const parts = splitIfBody(body);
      for (const part of parts) {
        if (part.type === 'elif') segments.push({ cond: part.cond, content: part.body });
        else if (part.type === 'else') segments.push({ cond: "true", content: part.body });
        else segments[segments.length - 1].content += part.body;
      }

      for (const seg of segments) {
        if (evaluateCondition(seg.cond, args)) {
          result += await processTemplate(seg.content, args);
          break;
        }
      }
      continue;
    }

    // 4. {{switch expr}} ... {{endswitch}}
    if (content.startsWith('switch ')) {
      const switchExpr = content.substring(7);
      const switchVal = String(evaluateExpression(switchExpr, args));
      const match = findMatchingBlock(remaining, 'switch', 'endswitch');
      if (match) {
        remaining = match.rest;
        const segments = splitSwitchBody(match.body);
        let executed = false;
        for (const seg of segments.cases) {
          const valExprs = seg.valExpr.split(',').map(s => s.trim()).filter(Boolean);
          let found = false;
          for (const expr of valExprs) {
            if (String(evaluateExpression(expr, args)) === switchVal) { found = true; break; }
          }
          if (found) {
            result += await processTemplate(seg.content, args);
            executed = true;
            break;
          }
        }
        if (!executed && segments.defaultContent !== null) {
          result += await processTemplate(segments.defaultContent, args);
        }
      }
      continue;
    }

    // Skip control terminators
    if (content === 'endif' || content === 'endfor' || content === 'endswitch' ||
      content === 'else' || content === 'default' ||
      content.startsWith('elif ') || content.startsWith('case ') ||
      content === 'endcase' || content === 'enddefault') {
      continue;
    }

    // 5. Cursor / placeholder handling
    if (content === 'cursor') {
      result += fullTag;
      continue;
    }
    if (content.startsWith('#')) {
      const rest = content.substring(1).trim();
      // If it's a simple number or keyword (cursor, 1, 2, ...), pass it through
      if (/^(cursor|\d+)$/.test(rest)) {
        result += fullTag;
      } else {
        // Dynamic cursor: evaluate expression and format as {{#result}}
        const evaluated = evaluateExpression(rest, args);
        result += `{{#${evaluated ?? 0}}}`;
      }
      continue;
    }

    // 6. Expression evaluation (with async pre-resolution)
    const resolved = await resolveAsyncCalls(content, args);
    const evaluated = evaluateExpression(resolved, args);
    result += (evaluated !== null && evaluated !== undefined ? evaluated : "");
  }

  // Cleanup newly created variables in this block
  for (const key of newlyCreated) {
    delete args[key];
  }

  return result;
}

/**
 * Finds the matching end tag for a block, handling nesting.
 */
function findMatchingBlock(text, startKey, endKey) {
  let depth = 1;
  let pos = 0;
  while (depth > 0 && pos < text.length) {
    const nextTag = text.indexOf('{{', pos);
    if (nextTag === -1) break;
    const nextEnd = text.indexOf('}}', nextTag);
    if (nextEnd === -1) break;
    const content = text.substring(nextTag + 2, nextEnd).trim();
    if (content.startsWith(startKey + ' ')) depth++;
    else if (content === endKey) depth--;
    if (depth === 0) {
      return { body: text.substring(0, nextTag), rest: text.substring(nextEnd + 2) };
    }
    pos = nextEnd + 2;
  }
  return { body: text, rest: "" };
}

/**
 * Splits IF body into segments based on top-level elif/else tags.
 */
function splitIfBody(text) {
  const parts = [];
  let currentPos = 0;
  let lastPos = 0;
  while (currentPos < text.length) {
    const tagStart = text.indexOf('{{', currentPos);
    if (tagStart === -1) break;
    const tagEnd = text.indexOf('}}', tagStart);
    if (tagEnd === -1) break;
    const content = text.substring(tagStart + 2, tagEnd).trim();
    if (content.startsWith('elif ') || content === 'else') {
      parts.push({ type: 'text', body: text.substring(lastPos, tagStart) });
      if (content === 'else') {
        parts.push({ type: 'else', body: "" });
      } else {
        parts.push({ type: 'elif', cond: content.substring(5).trim(), body: "" });
      }
      lastPos = tagEnd + 2;
    } else if (content.startsWith('if ')) {
      const { rest } = findMatchingBlock(text.substring(tagEnd + 2), 'if', 'endif');
      currentPos = text.length - rest.length;
      continue;
    }
    currentPos = tagEnd + 2;
  }
  parts.push({ type: 'text', body: text.substring(lastPos) });
  return parts;
}

/**
 * Splits switch body into cases and default.
 */
function splitSwitchBody(text) {
  const cases = [];
  let defaultContent = null;
  let pos = 0;

  const findOpen = (str, from) => {
    let i = str.indexOf('{{', from);
    while (i !== -1) { if (str[i + 2] !== '{') return i; i = str.indexOf('{{', i + 1); }
    return -1;
  };
  const findClose = (str, from) => {
    let i = str.indexOf('}}', from);
    while (i !== -1) { if (i === 0 || str[i - 1] !== '}') return i; i = str.indexOf('}}', i + 1); }
    return -1;
  };

  while (pos < text.length) {
    const tagStart = findOpen(text, pos);
    if (tagStart === -1) break;
    const tagEnd = findClose(text, tagStart + 2);
    if (tagEnd === -1) break;
    const content = text.substring(tagStart + 2, tagEnd).trim();
    const startOfBody = tagEnd + 2;

    if (content.startsWith('case ') || content === 'default') {
      const isDefault = content === 'default';
      const valExpr = isDefault ? null : content.substring(5).trim();
      const endTagName = isDefault ? 'enddefault' : 'endcase';
      let depth = 1;
      let searchPos = startOfBody;
      let blockBodyEnd = -1;
      while (searchPos < text.length) {
        const nextStart = findOpen(text, searchPos);
        if (nextStart === -1) break;
        const nextEnd = findClose(text, nextStart + 2);
        if (nextEnd === -1) break;
        const nextContent = text.substring(nextStart + 2, nextEnd).trim();
        searchPos = nextEnd + 2;
        if (nextContent.startsWith('if ') || nextContent.startsWith('for ') ||
          nextContent.startsWith('switch ') || nextContent.startsWith('case ') ||
          nextContent === 'default') {
          depth++;
        } else if (nextContent === 'endif' || nextContent === 'endfor' ||
          nextContent === 'endswitch' || nextContent === 'endcase' ||
          nextContent === 'enddefault') {
          depth--;
          if (depth === 0) {
            if (nextContent === endTagName) { blockBodyEnd = nextStart; pos = searchPos; break; }
            else break;
          }
        }
      }
      if (blockBodyEnd !== -1) {
        const body = text.substring(startOfBody, blockBodyEnd);
        if (isDefault) defaultContent = body;
        else cases.push({ valExpr, content: body });
      } else {
        pos = startOfBody;
      }
    } else {
      pos = tagEnd + 2;
    }
  }
  return { cases, defaultContent };
}
