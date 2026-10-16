// --- Template Engine ---
// Note: evaluateExpression, callBuiltinFunction etc. are provided by evaluator.js.
// Note: showSnippetPrompt is provided by handlers.js.

// One clock is shared by the complete expansion, including blocks and @calls.
function createSnippetExecution(timeoutMs) {
  const limit = normalizeSnippetTimeout(timeoutMs);
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  let deadline = now() + limit;
  let nextYield = now() + 16;
  let expired = false;
  const timeoutError = () => createSnippetError('err_snippet_timeout', [limit / 1000]);
  const execution = {
    check() {
      if (expired || now() >= deadline) {
        expired = true;
        throw timeoutError();
      }
    },
    async checkpoint() {
      execution.check();
      // Yield to the browser too: awaiting resolved promises alone cannot let
      // rendering, timers or input events run during a large loop.
      if (now() >= nextYield && typeof setTimeout === 'function') {
        await new Promise(resolve => setTimeout(resolve, 0));
        nextYield = now() + 16;
        execution.check();
      }
    },
    async wait(action) {
      execution.check();
      let timer;
      try {
        const operation = Promise.resolve().then(action);
        const value = typeof setTimeout === 'function' ? await Promise.race([
          operation,
          new Promise((resolve, reject) => {
            timer = setTimeout(() => { expired = true; reject(timeoutError()); }, Math.max(0, deadline - now()));
          })
        ]) : await operation;
        execution.check();
        return value;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    async userInput(action) {
      execution.check();
      const start = now();
      try { return await action(); }
      finally { deadline += now() - start; nextYield = now() + 16; }
    }
  };
  return execution;
}

// Keep call results in expression-local variables: returned text is data, never
// expression source, even when it contains quotes or template/function syntax.
function storeTemplateValue(value, args, expression) {
  let index = 0;
  let name;
  do { name = `__snippetValue${index++}`; }
  while (Object.prototype.hasOwnProperty.call(args, name) || expression.includes('$' + name));
  args[name] = value;
  return '$' + name;
}

function snippetCallError(key, values = []) {
  return createSnippetError(key, values.map(String));
}

async function evaluateTemplateExpression(expression, args, context) {
  context.execution.check();
  const scope = { ...args };
  const resolved = await resolveAsyncCalls(expression, scope, context);
  context.execution.check();
  const value = evaluateExpression(resolved, scope, context.execution);
  context.execution.check();
  return value;
}

async function resolveAsyncCalls(expression, args, context) {
  let result = '';
  let i = 0;
  while (i < expression.length) {
    context.execution.check();
    const char = expression[i];
    if (char === "'" || char === '"') {
      const start = i++;
      while (i < expression.length) {
        if (expression[i] === '\\') { i += 2; continue; }
        if (expression[i++] === char) break;
      }
      result += expression.slice(start, i);
      continue;
    }
    const call = char === '@' ? parseSnippetCall(expression, i) : null;
    if (call?.error) throw snippetCallError(call.error);
    const match = expression.slice(i).match(/^(paste|copy|prompt|choice|toast)\s*\(/);
    if ((!call && !match) || (i > 0 && /[\p{L}\p{N}_$@]/u.test(expression[i - 1]))) {
      if (char === '@') throw snippetCallError('err_snippet_call_syntax');
      result += expression[i++];
      continue;
    }
    const start = call ? call.argsStart : i + match[0].length;
    let end = call ? call.argsEnd : start;
    let depth = call ? 0 : 1;
    let quote = null;
    for (; depth && end < expression.length; end++) {
      const c = expression[end];
      if (quote) {
        if (c === '\\') end++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    if (depth !== 0) throw snippetCallError('err_snippet_call_syntax');
    const parts = splitArgs(expression.slice(start, end));
    const functionName = call ? '@' + call.name : match[1];
    if (!functionName.startsWith('@')) {
      if (parts.some(part => !part) || /,\s*$/.test(expression.slice(start, end))) {
        throw createSnippetError('err_function_arguments', [functionName]);
      }
      if (functionName === 'paste' && parts.length) throw createSnippetError('err_fn_no_args_allowed', [functionName]);
      if (functionName === 'copy' && parts.length !== 1) throw createSnippetError('err_fn_one_arg_exact', [functionName]);
      if (functionName === 'prompt' && parts.length > 1) throw createSnippetError('err_fn_one_arg_max', [functionName]);
      if (functionName === 'choice' && parts.length < 2) throw createSnippetError('err_function_arguments', [functionName]);
      if (functionName === 'toast' && parts.length !== 2) throw createSnippetError('err_fn_two_args_exact', [functionName]);
      const values = [];
      for (const part of parts) values.push(await evaluateTemplateExpression(part, args, context));
      let value = '';
      if (functionName === 'toast') {
        showSnippetToast(values[0], values[1]);
      } else if (functionName === 'copy') {
        try { await context.execution.wait(() => navigator.clipboard.writeText(String(values[0] ?? ''))); }
        catch (error) {
          if (error.messageKey === 'err_snippet_timeout') throw error;
          throw createSnippetError('err_clipboard_copy_failed');
        }
      } else if (functionName === 'paste') {
        try { value = await context.execution.wait(() => navigator.clipboard.readText()); }
        catch (error) { if (error.messageKey === 'err_snippet_timeout') throw error; }
      } else if (functionName === 'prompt') {
        const message = String(values[0] ?? 'Enter value:');
        value = await context.execution.userInput(() => typeof showSnippetPrompt === 'function'
          ? showSnippetPrompt(message) : window.prompt(message));
      } else {
        const title = String(values[0] || 'Select Option:');
        const options = values.slice(1);
        value = await context.execution.userInput(() => typeof showSnippetChoice === 'function'
          ? showSnippetChoice(title, options)
          : window.prompt(`${title}\nOptions: ${options.join(', ')}`));
      }
      if ((functionName === 'prompt' || functionName === 'choice') && (value === '' || value == null)) {
        const error = new Error('Snippet expansion cancelled');
        error.name = 'SnippetPromptCancelled';
        throw error;
      }
      result += storeTemplateValue(String(value ?? ''), args, expression);
      i = end + 1;
      continue;
    }
    if (parts.some(part => !part) || /,\s*$/.test(expression.slice(start, end))) {
      throw snippetCallError('err_snippet_call_syntax');
    }
    const name = functionName.slice(1);
    const matches = (context.snippets || []).filter(s => s && s.name === name);
    if (!name || matches.length !== 1) throw snippetCallError('err_snippet_call_target', [name]);
    const target = matches[0];
    const parameters = snippetParameterNames(target.trigger);
    if (parts.length !== parameters.length) {
      throw snippetCallError('err_snippet_call_args', [name, parameters.length]);
    }
    const stack = context.stack || [];
    if (stack.length >= context.maxCallDepth) {
      throw snippetCallError('err_snippet_call_depth', [context.maxCallDepth, name]);
    }
    const childContext = { ...context, stack: [...stack, target], loopControl: null };
    // A call has its own variable scope. Only explicit parameters are passed;
    // matching belongs to typed triggers, so values need not match their regex.
    const childArgs = {};
    for (let j = 0; j < parameters.length; j++) {
      Object.defineProperty(childArgs, parameters[j], {
        value: await evaluateTemplateExpression(parts[j], args, childContext),
        writable: true, enumerable: true, configurable: true
      });
    }
    let cursorOffset = 0;
    if (call.offsetStart !== null) {
      const offsetExpression = expression.slice(call.offsetStart, call.offsetEnd);
      if (splitArgs(offsetExpression).length !== 1) throw snippetCallError('err_snippet_call_syntax');
      const rawOffset = await evaluateTemplateExpression(offsetExpression, args, childContext);
      cursorOffset = typeof rawOffset === 'number' || (typeof rawOffset === 'string' && rawOffset.trim())
        ? Number(rawOffset) : NaN;
      if (!Number.isSafeInteger(cursorOffset) || cursorOffset < 0) throw snippetCallError('err_snippet_cursor_offset');
    }
    let value = await processTemplate(target.replacement || '', childArgs, {
      ...childContext, source: null, sourceOffsets: null
    });
    if (cursorOffset) {
      value = value.replace(/\{\{\s*(cursor|#(?:cursor|\d+))\s*\}\}/g, (tag, cursor) => {
        const level = cursor === 'cursor' || cursor === '#cursor' ? 0 : Number(cursor.slice(1));
        const shifted = level + cursorOffset;
        if (!Number.isSafeInteger(shifted)) throw snippetCallError('err_snippet_cursor_offset');
        return `{{#${shifted}}}`;
      });
    }
    result += storeTemplateValue(value, args, expression);
    i = call.end;
  }
  return result;
}

function validateTemplateStructure(template, execution, inLoop = false, position = {}) {
  const blocks = [];
  for (let i = 0; i < template.length - 1; i++) {
    execution?.check();
    if (template.slice(i, i + 2) !== '{{' || template[i + 2] === '{') continue;
    const from = i;
    position.offset = from;
    let quote = null;
    let end = i + 2;
    for (; end < template.length; end++) {
      const char = template[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (template.slice(end, end + 2) === '}}') break;
    }
    if (quote) throw createSnippetError('err_unclosed_string');
    if (end >= template.length - 1) throw createSnippetError('err_template_unclosed_tag');
    const tag = template.slice(from + 2, end).trim();
    i = end + 1;
    if (!tag) throw createSnippetError('err_unknown_tag', ['']);
    if ((tag === 'break' || tag === 'continue') && !inLoop && !blocks.some(block => block.type === 'for')) {
      throw createSnippetError('err_loop_control_outside_for', [tag]);
    }
    const opener = tag.match(/^(if|for|switch|case)\s+/)?.[1] || (tag === 'default' ? 'default' : null);
    const parent = blocks[blocks.length - 1];
    if (opener) {
      if ((opener === 'case' || opener === 'default') && parent?.type !== 'switch') {
        throw createSnippetError('err_template_syntax', [tag]);
      }
      blocks.push({ type: opener, hasElse: false, offset: from });
    } else if (tag === 'else' || tag.startsWith('elif ')) {
      if (parent?.type !== 'if' || parent.hasElse) throw createSnippetError('err_elif_else_outside_if');
      if (tag === 'else') parent.hasElse = true;
    } else if (/^end(if|for|switch|case|default)$/.test(tag)) {
      if (parent?.type !== tag.slice(3)) throw createSnippetError('err_template_syntax', [tag]);
      blocks.pop();
    }
  }
  if (blocks.length) {
    position.offset = blocks[blocks.length - 1].offset;
    const type = blocks[blocks.length - 1].type;
    throw createSnippetError(type === 'default' ? 'err_case_unclosed' : `err_${type}_unclosed`);
  }
}

/**
 * Processes control flow (for, if, set, switch/case), expressions, and placeholders.
 * Now async to support paste() and prompt() inline.
 */
async function processTemplate(template, args, context = {}) {
  context = { ...context, position: { offset: 0 } };
  context.source ||= { text: template, name: context.stack?.[context.stack.length - 1]?.name || '' };
  context.sourceOffsets ||= Array.from({ length: template.length }, (_, i) => i);
  try {
    return await processSnippetTemplate(template, args, context);
  } catch (error) {
    if (error && !error.snippetLocation && error.name !== 'SnippetPromptCancelled') {
      const offset = context.sourceOffsets[context.position.offset] ?? context.sourceOffsets.at(-1) ?? 0;
      const lines = context.source.text.slice(0, offset).split(/\r\n|\r|\n/);
      error.snippetLocation = {
        snippetName: context.source.name, offset, line: lines.length,
        column: Array.from(lines[lines.length - 1]).length + 1
      };
    }
    throw error;
  }
}

function snippetBodyContext(context, start, length) {
  return { ...context, sourceOffsets: context.sourceOffsets.slice(start, start + length) };
}

async function processSnippetTemplate(template, args, context) {
  context.maxCallDepth = normalizeSnippetCallDepth(context.maxCallDepth ?? (typeof config !== 'undefined' ? config.maxCallDepth : undefined));
  context.execution ||= createSnippetExecution(context.maxExecutionMs ?? (typeof config !== 'undefined' ? config.maxExecutionMs : undefined));
  await context.execution.checkpoint();
  validateTemplateStructure(template, context.execution, !!context.loopControl, context.position);
  context.position.offset = 0;
  let result = "";
  // Retain original positions when line continuations and indentation vanish.
  const removals = [...template.matchAll(/\\(?:\r\n|\n|\r)\s*/g)];
  if (removals.length) {
    let normalized = '';
    const offsets = [];
    let from = 0;
    for (const match of [...removals, { index: template.length, 0: '' }]) {
      normalized += template.slice(from, match.index);
      for (let i = from; i < match.index; i++) offsets.push(context.sourceOffsets[i]);
      from = match.index + match[0].length;
    }
    template = normalized;
    context.sourceOffsets = offsets;
  }
  let remaining = template;
  
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
    if (context.loopControl?.type) break;
    await context.execution.checkpoint();
    const tagStart = findOpen(remaining);
    if (tagStart === -1) { result += remaining; break; }

    context.position.offset = template.length - remaining.length + tagStart;
    result += remaining.substring(0, tagStart);
    remaining = remaining.substring(tagStart);

    const tagEnd = findClose(remaining, 2);
    if (tagEnd === -1) { result += remaining; break; }

    const fullTag = remaining.substring(0, tagEnd + 2);
    const content = remaining.substring(2, tagEnd).trim();
    remaining = remaining.substring(tagEnd + 2);

    if (content === 'break' || content === 'continue') {
      if (!context.loopControl) throw createSnippetError('err_loop_control_outside_for', [content]);
      context.loopControl.type = content;
      break;
    }

    // 1. {{set $var}} or {{set $var [op] expr}}
    if (content.startsWith('set ')) {
      const assignment = content.substring(4);
      const declaration = assignment.match(/^\$([\p{L}\p{N}_]+)\s*$/u);
      if (declaration) {
        setVar(declaration[1], undefined);
        continue;
      }
      const varMatch = assignment.match(/^\$(?<n>[\p{L}\p{N}_]+)\s*(?<op>=|\+=|-=|\*=|%=|\/=)\s*(?<v>[\s\S]*)$/u);
      if (varMatch) {
        const { n: name, op, v: expr } = varMatch.groups;
        if (!expr.trim()) throw createSnippetError('err_template_syntax', [content]);
        const newVal = await evaluateTemplateExpression(expr, args, context);
        
        if (op === '=') {
          setVar(name, newVal);
        } else {
          const oldVal = args[name] ?? 0;
          switch (op) {
            case '+=': setVar(name, addSnippetValues(oldVal, newVal)); break;
            case '-=': setVar(name, subtractSnippetValues(oldVal, newVal, context.execution)); break;
            case '*=': setVar(name, oldVal * newVal); break;
            case '/=': setVar(name, oldVal / newVal); break;
            case '%=': setVar(name, oldVal % newVal); break;
          }
        }
      } else throw createSnippetError('err_template_syntax', [content]);
      continue;
    }

    // 2. {{for expr}} ... {{endfor}}
    if (content.startsWith('for ')) {
      const countExpr = content.substring(4);
      const bodyStart = template.length - remaining.length;
      const { body, rest } = findMatchingBlock(remaining, 'for', 'endfor');
      remaining = rest;
      const iterable = await evaluateTemplateExpression(countExpr, args, context);
      const range = isRange(iterable);
      const values = !range && isSnippetIterable(iterable) ? (typeof iterable === 'string' ? Array.from(iterable) : iterable) : null;
      const start = range ? iterable.start : 0;
      const step = range && iterable.end < iterable.start ? -1 : 1;
      const count = values ? values.length : range ? Math.abs(iterable.end - iterable.start) + 1 : (parseInt(iterable, 10) || 0);
      
      const hadIndex = ('index' in args);
      const oldIndex = args['index'];
      const hadValue = Object.prototype.hasOwnProperty.call(args, SNIPPET_LOOP_VALUE);
      const oldValue = args[SNIPPET_LOOP_VALUE];
      const loopContext = { ...snippetBodyContext(context, bodyStart, body.length), loopControl: { type: null } };

      try {
        for (let i = 0; i < count; i++) {
          args['index'] = i;
          args[SNIPPET_LOOP_VALUE] = values ? values[i] : start + i * step;
          loopContext.loopControl.type = null;
          result += await processTemplate(body, args, loopContext);
          if (loopContext.loopControl.type === 'break') break;
        }
      } finally {
        if (hadIndex) args['index'] = oldIndex;
        else delete args['index'];
        if (hadValue) args[SNIPPET_LOOP_VALUE] = oldValue;
        else delete args[SNIPPET_LOOP_VALUE];
      }

      continue;
    }

    // 3. {{if expr}} ... {{endif}}
    if (content.startsWith('if ')) {
      const initialCond = content.substring(3);
      const bodyStart = template.length - remaining.length;
      const ifOffset = context.position.offset;
      const { body, rest } = findMatchingBlock(remaining, 'if', 'endif');
      remaining = rest;

      const segments = [{ cond: initialCond, content: "", start: 0, condOffset: ifOffset }];
      const parts = splitIfBody(body);
      for (const part of parts) {
        if (part.type === 'elif') segments.push({ cond: part.cond, content: part.body, start: part.bodyStart, condOffset: bodyStart + part.start });
        else if (part.type === 'else') segments.push({ cond: "true", content: part.body, start: part.bodyStart, condOffset: bodyStart + part.start });
        else {
          const segment = segments[segments.length - 1];
          if (!segment.content) segment.start = part.start;
          segment.content += part.body;
        }
      }

      for (const seg of segments) {
        context.position.offset = seg.condOffset;
        const condition = await evaluateTemplateExpression(seg.cond, args, context);
        if (!!condition && condition !== 'false' && condition !== '0') {
          result += await processTemplate(seg.content, args, snippetBodyContext(context, bodyStart + seg.start, seg.content.length));
          break;
        }
      }
      continue;
    }

    // 4. {{switch expr}} ... {{endswitch}}
    if (content.startsWith('switch ')) {
      const switchExpr = content.substring(7);
      const bodyStart = template.length - remaining.length;
      const switchVal = String(await evaluateTemplateExpression(switchExpr, args, context));
      const match = findMatchingBlock(remaining, 'switch', 'endswitch');
      if (match) {
        remaining = match.rest;
        const segments = splitSwitchBody(match.body);
        let executed = false;
        for (const seg of segments.cases) {
          context.position.offset = bodyStart + seg.start;
          const valExprs = splitArgs(seg.valExpr).filter(Boolean);
          let found = false;
          for (const expr of valExprs) {
            if (String(await evaluateTemplateExpression(expr, args, context)) === switchVal) { found = true; break; }
          }
          if (found) {
            result += await processTemplate(seg.content, args, snippetBodyContext(context, bodyStart + seg.bodyStart, seg.content.length));
            executed = true;
            break;
          }
        }
        if (!executed && segments.defaultContent !== null) {
          result += await processTemplate(segments.defaultContent, args, snippetBodyContext(context, bodyStart + segments.defaultStart, segments.defaultContent.length));
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
        const evaluated = await evaluateTemplateExpression(rest, args, context);
        if (!Number.isSafeInteger(evaluated) || evaluated < 0) throw createSnippetError('err_cursor_level');
        result += `{{#${evaluated}}}`;
      }
      continue;
    }

    // 6. Expression evaluation (with async pre-resolution)
    const evaluated = await evaluateTemplateExpression(content, args, context);
    result += (evaluated !== null && evaluated !== undefined ? evaluated : "");
  }

  // Cleanup newly created variables in this block
  for (const key of newlyCreated) {
    delete args[key];
  }

  context.execution.check();
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
      parts.push({ type: 'text', body: text.substring(lastPos, tagStart), start: lastPos });
      if (content === 'else') {
        parts.push({ type: 'else', body: "", start: tagStart, bodyStart: tagEnd + 2 });
      } else {
        parts.push({ type: 'elif', cond: content.substring(5).trim(), body: "", start: tagStart, bodyStart: tagEnd + 2 });
      }
      lastPos = tagEnd + 2;
    } else if (content.startsWith('if ')) {
      const { rest } = findMatchingBlock(text.substring(tagEnd + 2), 'if', 'endif');
      currentPos = text.length - rest.length;
      continue;
    }
    currentPos = tagEnd + 2;
  }
  parts.push({ type: 'text', body: text.substring(lastPos), start: lastPos });
  return parts;
}

/**
 * Splits switch body into cases and default.
 */
function splitSwitchBody(text) {
  const cases = [];
  let defaultContent = null;
  let defaultStart = 0;
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
        if (isDefault) { defaultContent = body; defaultStart = startOfBody; }
        else cases.push({ valExpr, content: body, start: tagStart, bodyStart: startOfBody });
      } else {
        pos = startOfBody;
      }
    } else {
      pos = tagEnd + 2;
    }
  }
  return { cases, defaultContent, defaultStart };
}
