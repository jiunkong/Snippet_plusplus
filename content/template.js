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
    if (char === '`') {
      const quoted = scanSnippetQuotedValue(expression, i, context.execution);
      if (quoted.error) throw createSnippetError(quoted.error);
      const token = expression.slice(i, quoted.end);
      const literal = context.activeTemplate.literals[token];
      const template = context.activeTemplate;
      const from = template.sourceOffsets.indexOf(context.position.offset);
      const expressionStart = template.normalizedSource.indexOf(expression, Math.max(0, from));
      const offsets = literal.offsets.map(offset => {
        const local = template.sourceOffsets[Math.max(0, expressionStart) + i + offset] ?? context.position.offset;
        return context.literalSource ? context.literalSource.offsets[local] ?? local : local;
      });
      const value = await processTemplate(literal.template, { ...args }, {
        ...context, loopControl: null, literalSource: { source: context.source, offsets }
      });
      result += storeTemplateValue(value, args, expression);
      i = quoted.end;
      continue;
    }
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
    const match = expression.slice(i).match(/^(paste|copy|prompt|choice|toast|fragment)\s*\(/);
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
      } else if (c === '`') {
        const literal = scanSnippetQuotedValue(expression, end, context.execution);
        if (literal.error) throw createSnippetError(literal.error);
        end = literal.end - 1;
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
      if ((functionName === 'copy' || functionName === 'fragment') && parts.length !== 1) throw createSnippetError('err_fn_one_arg_exact', [functionName]);
      if (functionName === 'prompt' && parts.length > 1) throw createSnippetError('err_fn_one_arg_max', [functionName]);
      if (functionName === 'choice' && parts.length < 2) throw createSnippetError('err_function_arguments', [functionName]);
      if (functionName === 'toast' && parts.length !== 2) throw createSnippetError('err_fn_two_args_exact', [functionName]);
      const values = [];
      for (const part of parts) values.push(await evaluateTemplateExpression(part, args, context));
      let value = '';
      if (functionName === 'fragment') {
        const input = values[0];
        value = input instanceof SnippetFragment ? input : await processTemplate(String(input ?? ''), { ...args }, {
          ...context, loopControl: null, literalSource: null
        });
      } else if (functionName === 'toast') {
        showSnippetToast(String(values[0] ?? ''), String(values[1] ?? ''));
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
        const options = values.slice(1).map(value => String(value ?? ''));
        value = await context.execution.userInput(() => typeof showSnippetChoice === 'function'
          ? showSnippetChoice(title, options)
          : window.prompt(`${title}\nOptions: ${options.join(', ')}`));
      }
      if ((functionName === 'prompt' || functionName === 'choice') && (value === '' || value == null)) {
        const error = new Error('Snippet expansion cancelled');
        error.name = 'SnippetPromptCancelled';
        throw error;
      }
      result += storeTemplateValue(functionName === 'fragment' ? value : String(value ?? ''), args, expression);
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
      cursorOffset = typeof rawOffset === 'number' || ((typeof rawOffset === 'string' || rawOffset instanceof SnippetFragment) && String(rawOffset).trim())
        ? Number(rawOffset) : NaN;
      if (!Number.isSafeInteger(cursorOffset) || cursorOffset < 0) throw snippetCallError('err_snippet_cursor_offset');
    }
    let value = await processTemplate(target, childArgs, childContext);
    if (cursorOffset) value = value.shiftCursors(cursorOffset);
    result += storeTemplateValue(value, args, expression);
    i = call.end;
  }
  return result;
}

/** Parse source once, then solve immutable templates into output fragments. */
async function processTemplate(input, args = {}, context = {}) {
  context = { ...context, position: { offset: 0 } };
  context.maxCallDepth = normalizeSnippetCallDepth(context.maxCallDepth ?? (typeof config !== 'undefined' ? config.maxCallDepth : undefined));
  context.execution ||= createSnippetExecution(context.maxExecutionMs ?? (typeof config !== 'undefined' ? config.maxExecutionMs : undefined));
  const snippet = input && !(input instanceof SnippetTemplate) && typeof input === 'object' ? input : null;
  const source = snippet ? snippet.replacement || '' : input instanceof SnippetTemplate ? input.source : input;
  if (snippet) context.literalSource = null;
  context.source = context.literalSource?.source || { text: source, name: snippet?.name || context.stack?.at(-1)?.name || '' };
  try {
    await context.execution.checkpoint();
    const current = snippet || context.stack?.at(-1);
    const template = input instanceof SnippetTemplate ? input
      : current && (current.replacement || '') === source ? getSnippetTemplate(current, context.execution)
      : parseSnippetTemplate(source, context.execution);
    context.activeTemplate = template;
    const fragment = await solveSnippetTemplate(template, args, context);
    context.execution.check();
    return fragment;
  } catch (error) {
    if (error && !error.snippetLocation && error.name !== 'SnippetPromptCancelled') {
      const localOffset = error.snippetOffset ?? context.position.offset;
      const offset = context.literalSource?.offsets[localOffset] ?? localOffset;
      const lines = context.source.text.slice(0, offset).split(/\r\n|\r|\n/);
      error.snippetLocation = {
        snippetName: context.source.name, offset, line: lines.length,
        column: Array.from(lines[lines.length - 1]).length + 1
      };
    }
    throw error;
  }
}

async function solveSnippetTemplate(template, args, context) {
  const nodes = [];
  const append = value => {
    for (const node of SnippetFragment.from(value).nodes) nodes.push(node);
  };
  const newlyCreated = new Set();
  const setVar = (name, value) => {
    if (!Object.prototype.hasOwnProperty.call(args, name)) newlyCreated.add(name);
    Object.defineProperty(args, name, { value, writable: true, enumerable: true, configurable: true });
  };
  try {
    for (const node of template.nodes) {
      if (context.loopControl?.type) break;
      context.position.offset = node.offset;
      await context.execution.checkpoint();
      switch (node.type) {
        case 'text':
        case 'cursor': nodes.push(node); break;
        case 'expression': append(await evaluateTemplateExpression(node.expression, args, context)); break;
        case 'cursorExpression': {
          const level = await evaluateTemplateExpression(node.expression, args, context);
          if (!Number.isSafeInteger(level) || level < 0) throw createSnippetError('err_cursor_level');
          nodes.push({ type: 'cursor', level });
          break;
        }
        case 'break':
        case 'continue':
          if (!context.loopControl) throw createSnippetError('err_loop_control_outside_for', [node.type]);
          context.loopControl.type = node.type;
          break;
        case 'set':
          for (const { name, operator, expression } of node.assignments) {
            const value = operator ? await evaluateTemplateExpression(expression, args, context) : undefined;
            const old = args[name] ?? 0;
            switch (operator) {
              case '+=': setVar(name, addSnippetValues(old, value)); break;
              case '-=': setVar(name, subtractSnippetValues(old, value, context.execution)); break;
              case '*=': setVar(name, multiplySnippetValues(old, value, context.execution)); break;
              case '/=': setVar(name, old / value); break;
              case '%=': setVar(name, old % value); break;
              default: setVar(name, value);
            }
          }
          break;
        case 'for': {
          const iterable = await evaluateTemplateExpression(node.expression, args, context);
          const range = isRange(iterable);
          const values = !range && isSnippetIterable(iterable)
            ? iterable instanceof SnippetFragment ? iterable.iterate(context.execution) : iterable[Symbol.iterator]() : null;
          const start = range ? iterable.start : 0;
          const step = range && iterable.end < iterable.start ? -1 : 1;
          const count = values ? 0 : range ? Math.abs(iterable.end - iterable.start) + 1 : (parseInt(iterable, 10) || 0);
          const hadIndex = Object.prototype.hasOwnProperty.call(args, 'index');
          const oldIndex = args.index;
          const hadValue = Object.prototype.hasOwnProperty.call(args, SNIPPET_LOOP_VALUE);
          const oldValue = args[SNIPPET_LOOP_VALUE];
          const loopContext = { ...context, loopControl: { type: null } };
          try {
            for (let i = 0; values || i < count; i++) {
              const next = values?.next();
              if (next?.done) break;
              args.index = i;
              args[SNIPPET_LOOP_VALUE] = values ? next.value : start + i * step;
              loopContext.loopControl.type = null;
              append(await processTemplate(node.body, args, loopContext));
              if (loopContext.loopControl.type === 'break') break;
            }
          } finally {
            if (hadIndex) args.index = oldIndex;
            else delete args.index;
            if (hadValue) args[SNIPPET_LOOP_VALUE] = oldValue;
            else delete args[SNIPPET_LOOP_VALUE];
          }
          break;
        }
        case 'if':
          for (const branch of node.branches) {
            context.position.offset = branch.offset;
            const condition = branch.expression === null ? true : await evaluateTemplateExpression(branch.expression, args, context);
            if (snippetConditionValue(condition)) {
              append(await processTemplate(branch.body, args, context));
              break;
            }
          }
          break;
        case 'switch': {
          const value = String(await evaluateTemplateExpression(node.expression, args, context));
          let selected = node.defaultBody;
          cases: for (const branch of node.cases) {
            context.position.offset = branch.offset;
            for (const expression of splitArgs(branch.expression)) {
              if (String(await evaluateTemplateExpression(expression, args, context)) === value) {
                selected = branch.body;
                break cases;
              }
            }
          }
          if (selected) append(await processTemplate(selected, args, context));
          break;
        }
      }
    }
    context.execution.check();
    return new SnippetFragment(nodes);
  } finally {
    for (const key of newlyCreated) delete args[key];
  }
}
