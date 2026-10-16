// --- Syntax Highlighting & Validation Engine ---

/**
 * Highlights {{...}} tags in the replacement textarea with color-coded badges
 * and performs real-time syntax validation.
 * @returns {string} First error message found, or empty string if none.
 */
function updateHighlight(textarea, highlightDiv, triggerValue = "", groupSnippets = null, sourceSnippetName = null) {
  let text = textarea.value;
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const definedArgs = new Set();
  [...triggerValue.matchAll(/\$\{([\p{L}\p{N}_]+)(?::.*?)?\}/gu)].forEach(m => definedArgs.add(m[1]));

  // --- String-aware tag parser ---
  // Finds all {{ }} tags, correctly handling { } inside string literals.
  // Returns array of { index, match, inner } objects.
  const findTags = (src) => {
    const results = [];
    let i = 0;
    while (i < src.length - 1) {
      if (src[i] === '{' && src[i + 1] === '{') {
        // Skip triple-brace patterns
        if (src[i + 2] === '{') { i++; continue; }
        const start = i;
        i += 2; // skip opening {{
        let inner = '';
        while (i < src.length) {
          const ch = src[i];
          // Handle string literals — skip their content
          if (ch === '\'' || ch === '"') {
            const quote = ch;
            let closed = false;
            inner += ch;
            i++;
            while (i < src.length) {
              const sc = src[i];
              inner += sc;
              i++;
              if (sc === '\\') { if (i < src.length) { inner += src[i]; i++; } continue; }
              if (sc === quote) { closed = true; break; }
            }
            if (!closed) {
              results.push({ index: start, match: src.slice(start), inner, error: 'err_unclosed_string' });
              break;
            }
            continue;
          }
          // Closing }}
          if (ch === '}' && src[i + 1] === '}') {
            // Skip triple-brace
            if (i > 0 && src[i - 1] === '}') { inner += ch; i++; continue; }
            results.push({ index: start, match: '{{' + inner + '}}', inner });
            i += 2;
            break;
          }
          inner += ch;
          i++;
        }
      } else {
        i++;
      }
    }
    return results;
  };

  // --- Pre-scan: Balance & Context Check ---
  const tagMatches = findTags(text);
  const ifStack = [];
  const forStack = [];
  const switchStack = [];
  const caseStack = [];
  const tagErrors = new Map();
  let firstErrorMessage = "";

  const addError = (offset, msg) => {
    tagErrors.set(offset, msg);
    if (!firstErrorMessage) firstErrorMessage = msg;
  };

  tagMatches.forEach(m => {
    const content = m.inner.trim();
    const offset = m.index;
    if (m.error) { addError(offset, t(m.error)); return; }
    if (content.startsWith('if ')) ifStack.push({ offset, content });
    else if (content === 'endif') ifStack.length > 0 ? ifStack.pop() : addError(offset, t("err_endif_no_if"));
    else if (content.startsWith('elif ') || content === 'else') { if (ifStack.length === 0) addError(offset, t("err_elif_else_outside_if")); }
    else if (content.startsWith('for ')) forStack.push({ offset, content });
    else if (content === 'endfor') forStack.length > 0 ? forStack.pop() : addError(offset, t("err_endfor_no_for"));
    else if ((content === 'break' || content === 'continue') && forStack.length === 0) addError(offset, t('err_loop_control_outside_for', [content]));
    else if (content.startsWith('switch ')) switchStack.push({ offset, content });
    else if (content === 'endswitch') switchStack.length > 0 ? switchStack.pop() : addError(offset, t("err_endswitch_no_switch"));
    else if (content.startsWith('case ')) caseStack.push({ offset, content });
    else if (content === 'endcase') caseStack.length > 0 ? caseStack.pop() : addError(offset, t("err_endcase_no_case"));
    else if (content === 'default') caseStack.push({ offset, content });
    else if (content === 'enddefault') caseStack.length > 0 ? caseStack.pop() : addError(offset, t("err_enddefault_no_default"));
  });

  ifStack.forEach(item => addError(item.offset, t("err_if_unclosed")));
  forStack.forEach(item => addError(item.offset, t("err_for_unclosed")));
  switchStack.forEach(item => addError(item.offset, t("err_switch_unclosed")));
  caseStack.forEach(item => {
    const isDef = item.content === 'default';
    addError(item.offset, t(isDef ? "err_default_unclosed" : "err_case_unclosed"));
  });

  // --- Single-pass Highlight + Inline Validation ---
  let scopeDepth = 0;
  let activeForDepth = 0; // Still need to track specifically for 'index'
  // Track variables defined via {{set}} and the depth at which they were defined
  const scopedVars = new Map(); // name -> depth

  const splitFunctionArgs = (text) => {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        current += char;
        if (char === '\\' && i + 1 < text.length) current += text[++i];
        else if (char === quote) quote = null;
      } else if (char === '\'' || char === '"') {
        quote = char;
        current += char;
      } else if ((char === '(' || char === '[')) {
        depth++;
        current += char;
      } else if ((char === ')' || char === ']')) {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim() || text.trim()) parts.push(current.trim());
    return parts;
  };

  /**
   * Validates an expression for syntax, variables, and loop context.
   */
  const validateExpr = (expr, offset, isAssignment = false) => {
    let cond = expr.trim();
    cond = cond.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    // Validate actual calls before hiding their names and string arguments.
    // Quoted names may contain spaces, operators, variables or even @ signs.
    let strippedForOps = '';
    const offsetDelimiters = new Map();
    const snippetArgsOpenings = new Set();
    const normalizedArgsOpenings = new Set();
    for (let i = 0; i < cond.length;) {
      const char = cond[i];
      if (offsetDelimiters.has(i)) { strippedForOps += offsetDelimiters.get(i); i++; continue; }
      if (char === '@') {
        const call = parseSnippetCall(cond, i);
        if (call.error) return t(call.error);
        snippetArgsOpenings.add(call.argsStart - 1);
        if (call.offsetStart !== null) {
          offsetDelimiters.set(call.offsetOpenStart, '(');
          offsetDelimiters.set(call.offsetEnd, ')');
          const offset = cond.slice(call.offsetStart, call.offsetEnd).trim();
          if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(offset) &&
              (!Number.isSafeInteger(Number(offset)) || Number(offset) < 0)) return t('err_snippet_cursor_offset');
        }
        strippedForOps += '@__snippet';
        i = call.nameEnd;
      } else if (char === "'" || char === '"') {
        const quote = char;
        i++;
        while (i < cond.length) {
          if (cond[i] === '\\') { i += 2; continue; }
          if (cond[i++] === quote) break;
        }
        strippedForOps += '""';
      } else {
        if (snippetArgsOpenings.has(i)) normalizedArgsOpenings.add(strippedForOps.length);
        strippedForOps += cond[i++];
      }
    }
    const withoutSnippetNames = strippedForOps.replace(/@__snippet(?=\s*[([])/g, '');

    if (!isAssignment && /(?<![=!><])=(?![=])/.test(strippedForOps)) return t("err_assignment_instead_of_comparison");
    if (/(?<!&)&(?!&)/.test(strippedForOps) || /(?<!\|)\|(?!\|)/.test(strippedForOps)) return t("err_logical_operator_single");

    // Validate range operands outside strings, including ranges nested in calls.
    if (/(?:^|[=(,~?:\[])\s*~|~\s*(?:$|[),~?:\]])/.test(strippedForOps)) {
      return t('err_range_both_values_required', [cond]);
    }
    const rangeDepths = [0];
    for (const char of strippedForOps) {
      if (char === '(' || char === '[') rangeDepths.push(0);
      else if ((char === ')' || char === ']') && rangeDepths.length > 1) rangeDepths.pop();
      else if (char === ',' || char === '?' || char === ':') rangeDepths[rangeDepths.length - 1] = 0;
      else if (char === '~' && ++rangeDepths[rangeDepths.length - 1] > 1) {
        return t('err_range_both_values_required', [cond]);
      }
    }

    const pStack = [];
    const closedGroups = new Map();
    const isNonIterableLiteral = source => {
      let text = source.trim();
      while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
      return /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false|null|undefined)$/.test(text);
    };
    for (let i = 0; i < strippedForOps.length; i++) {
      const char = strippedForOps[i];
      if (char === '(' || char === '[') {
        const prefix = strippedForOps.slice(0, i).trimEnd();
        const literal = prefix.match(/(?:^|[^\p{L}\p{N}_$])((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false|null|undefined)\s*$/u);
        const group = closedGroups.get(prefix.length - 1);
        if (char === '[' && (literal || (group && !group.isCall && isNonIterableLiteral(group.source)))) {
          return t('err_list_index_target');
        }
        const isIndex = char === '[' && /(?:\$[\p{L}\p{N}_]+|\b(?:index|value)|[\])"])\s*$/u.test(strippedForOps.slice(0, i));
        pStack.push({ char, index: i, isIndex,
          isCall: normalizedArgsOpenings.has(i) || /[\p{L}\p{N}_$@]\s*$/u.test(strippedForOps.slice(0, i)) });
      }
      else if (char === ')' || char === ']') {
        const open = pStack.pop();
        if (open?.char !== (char === ')' ? '(' : '[')) {
          return t(char === ']' || open?.char === '[' ? 'err_list_syntax' : 'err_unmatched_close_paren');
        }
        if (char === ')') {
          const source = strippedForOps.slice(open.index + 1, i);
          if (!open.isCall && !source.trim()) return t('err_missing_operand', ['()']);
          closedGroups.set(i, { source, isCall: open.isCall });
        }
        if (char === ']') {
          const source = strippedForOps.slice(open.index + 1, i);
          const parts = splitFunctionArgs(source);
          if (open.isIndex) {
            if (!source.trim() || parts.length !== 1 || parts.some(part => !part) || /,\s*$/.test(source)) return t('err_list_index_integer');
            const literal = source.trim();
            if ((/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(literal) && !Number.isSafeInteger(Number(literal))) ||
                /^(?:true|false|null|undefined|"")$/.test(literal)) return t('err_list_index_integer');
          } else if (parts.some(part => !part) || /,\s*$/.test(source)) return t('err_list_syntax');
        }
      }
    }
    if (pStack.length > 0) return t(pStack.some(item => item.char === '[') ? 'err_list_syntax' : 'err_unmatched_open_paren');

    const parts = strippedForOps.split(/&&|\|\|/);
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      const compOpRegex = /==|!=|>=|<=|>|</;
      if (compOpRegex.test(part)) {
        const ops = part.split(compOpRegex);
        if (ops.some(op => !op.trim())) return t("err_missing_operand", [part]);
      }
    }

    if (/\bindex\b/.test(withoutSnippetNames) && activeForDepth === 0) return t("err_index_outside_for");

    // Check Ternary Balance (? and :)
    let ternaryDepth = 0;
    let inQTest = null;
    let pDepthTest = 0;
    for (let i = 0; i < strippedForOps.length; i++) {
        const c = strippedForOps[i];
        if ((c === "'" || c === '"') && !inQTest) inQTest = c;
        else if (c === inQTest) inQTest = null;
        if (!inQTest) {
            if (c === '(' || c === '[') pDepthTest++;
            else if (c === ')' || c === ']') pDepthTest--;
            if (pDepthTest === 0) {
                if (c === '?') ternaryDepth++;
                else if (c === ':') {
                    ternaryDepth--;
                    if (ternaryDepth < 0) return t("err_ternary_no_matching_question");
                }
            }
        }
    }
    if (ternaryDepth > 0) return t("err_ternary_no_matching_colon");

    const stripped = strippedForOps;
    const tokens = [...stripped.matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu)];
    const validKeywords = ['index', 'value', 'true', 'false', 'null', 'undefined', ...BUILTIN_ALL];
    
    for (const tokenMatch of tokens) {
      const token = tokenMatch[0];
      if (token === 'value' && stripped[tokenMatch.index - 1] !== '$' && activeForDepth === 0) return t('err_value_outside_for');
      if (validKeywords.includes(token)) continue;
      if (stripped[tokenMatch.index - 1] === '@' && /^\s*[([]/.test(stripped.slice(tokenMatch.index + token.length))) continue;
      if (/^\d+$/.test(token)) continue;
      const idx = tokenMatch.index;
      if (idx === 0 || stripped[idx - 1] !== '$') {
        return t("err_var_start_with_dollar", [token]);
      }
    }

    if (/\$(?![\p{L}\p{N}_])/u.test(stripped)) return t("err_var_name_required");

    const vars = stripped.match(/\$[\p{L}\p{N}_]+/gu);
    if (vars) {
      for (const v of vars) {
        const name = v.substring(1);
        if (isAssignment) {
          const assignmentMatch = cond.match(/^\$([\p{L}\p{N}_]+)\s*(?:$|=|\+=|-=|\*=|%=|\/=)/u);
          if (assignmentMatch && assignmentMatch[1] === name) continue;
        }
        // Check both trigger args and scoped set variables
        if (!definedArgs.has(name) && !scopedVars.has(name)) return t("err_undefined_variable", [v]);
      }
    }
    return null;
  };

  /**
   * Highlights functions and variables within an expression string.
   * Tracks parenthesis depth to highlight matching closing parens for functions.
   */
  const highlightInnerExpr = (expr, tagOffset, addError) => {
    const isRandomFn = (n) => n === 'uuid' || n === 'random';
    const isTypeFn = (n) => BUILTIN_FUNCS_TYPE_CAST.includes(n) || n === 'type';

    const getError = (n, a, snippetName = n.slice(1)) => {
      if (BUILTIN_FUNCS_NO_ARGS.includes(n) && a.trim() !== "") return t("err_fn_no_args_allowed", [n]);
      
      const allParts = splitFunctionArgs(a);
      const parts = allParts.filter(p => p.length > 0);
      if ((n === 'insertAt' || n === 'removeAt') && /,\s*$/.test(a)) return t(n === 'insertAt' ? 'err_fn_three_args_exact' : 'err_fn_two_args_exact', [n]);
      if ((n === 'split' || n === 'join' || n === 'removeAt') && (parts.length !== 2 || allParts.some(part => !part))) return t('err_fn_two_args_exact', [n]);
      if (n === 'insertAt' && (parts.length !== 3 || allParts.some(part => !part))) return t('err_fn_three_args_exact', [n]);
      if (n === 'type' && (parts.length !== 1 || allParts.some(part => !part))) return t('err_fn_one_arg_exact', [n]);
      if (BUILTIN_FUNCS_HAS_ARGS.includes(n) && parts.length === 0) return t("err_fn_args_required", [n]);
      if (n.startsWith('@')) {
        if (allParts.some(part => !part)) return t('err_snippet_call_syntax');
        if (groupSnippets) {
          const name = snippetName;
          const matches = groupSnippets.filter(snippet => snippet.name === name);
          if (matches.length !== 1) return t('err_snippet_call_target', [name]);
          const expected = snippetParameterNames(matches[0].trigger).length;
          if (parts.length !== expected) return t('err_snippet_call_args', [name, expected]);
        }
      }
      // Optional args fns like prompt() are allowed to be empty
      if ((BUILTIN_FUNCS_TYPE_CAST.includes(n) || n === 'copy') && parts.length !== 1) return t("err_fn_one_arg_exact", [n]);

      // Strict count checks
      const oneArgFns = ['upper', 'lower', 'trim', 'capitalize', 'len', 'prompt', 'round', 'ceil', 'floor', 'date', 'time', 'datetime'];
      if (oneArgFns.includes(n) && parts.length > 1) return t("err_fn_one_arg_max", [n]);
      if ((n === 'min' || n === 'max') && parts.length === 0) return t("err_fn_min_one_arg", [n]);
      if (n === 'substr' && (parts.length < 2 || parts.length > 3)) return t("err_substr_args");
      if ((n === 'startswith' || n === 'endswith' || n === 'toast') && parts.length !== 2) return t("err_fn_two_args_exact", [n]);
      if (n === 'replace' && parts.length !== 3) return t("err_replace_args");

      if (n === 'random') {
        if (parts.length === 0) return t("err_random_args");

      }
      return null;
    };

    const getMatchingParen = (str, start) => {
      let d = 1;
      for (let j = start + 1; j < str.length; j++) {
        if (str[j] === '(') d++;
        else if (str[j] === ')') { d--; if (d === 0) return j; }
      }
      return -1;
    };

    const strings = [];
    // Mask argument strings while retaining quoted function names for parsing.
    let text = '';
    for (let i = 0; i < expr.length;) {
      if (expr[i] === '@') {
        const name = parseSnippetFunctionName(expr, i);
        if (!name.error) { text += expr.slice(i, name.nameEnd); i = name.nameEnd; continue; }
      }
      if (expr[i] === "'" || expr[i] === '"') {
        const start = i;
        const quote = expr[i++];
        while (i < expr.length) {
          if (expr[i] === '\\') { i += 2; continue; }
          if (expr[i++] === quote) break;
        }
        strings.push(expr.slice(start, i));
        text += `\x01${strings.length - 1}\x02`;
      } else text += expr[i++];
    }

    let output = "";
    let i = 0;
    let fnParenStack = []; // Stores { depth, cls }
    let currentDepth = 0;
    const punctuationStack = [];

    while (i < text.length) {
      if (text[i] === '@') {
        const call = parseSnippetCall(text, i);
        if (call.error) {
          if (addError) addError(tagOffset, t(call.error));
          output += `<span class="hl-fn-err">@</span>`;
          i++;
          continue;
        }
        const name = text.slice(i, call.nameEnd);
        const lookupName = call.name.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const error = getError(name, text.slice(call.argsStart, call.argsEnd), lookupName);
        const cls = error ? 'hl-fn-err' : 'hl-fn-snippet';
        if (error && addError) addError(tagOffset, error);
        output += `<span class="${cls}">${name}</span>`;
        let position = call.nameEnd;
        const blocks = [{ from: call.argsStart, to: call.argsEnd, openStart: call.argsStart - 1, closeEnd: call.argsEnd + 1 }];
        if (call.offsetStart !== null) blocks.push({ from: call.offsetStart, to: call.offsetEnd, openStart: call.offsetOpenStart, closeEnd: call.offsetCloseEnd });
        blocks.sort((a, b) => a.from - b.from);
        for (const block of blocks) {
          output += text.slice(position, block.openStart);
          output += `<span class="${cls}">${text.slice(block.openStart, block.from)}</span>`;
          output += highlightInnerExpr(text.slice(block.from, block.to), tagOffset, addError);
          output += `<span class="${cls}">${text.slice(block.to, block.closeEnd)}</span>`;
          position = block.closeEnd;
        }
        i = call.end;
        continue;
      }
      // A. Check for function start: name(
      const fnMatch = text.substring(i).match(/^(@[\p{L}_][\p{L}\p{N}_]*|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/u);
      if (fnMatch) {
        const name = fnMatch[1];
        const fullMatch = fnMatch[0];
        const openIdx = i + fullMatch.length - 1;
        const closeIdx = getMatchingParen(text, openIdx);

        let cls = name.startsWith('@') ? 'hl-fn-snippet' : (isRandomFn(name) ? 'hl-fn-rand' : (isTypeFn(name) ? 'hl-fn-type' : 'hl-fn'));
        if (closeIdx !== -1) {
          const args = text.substring(openIdx + 1, closeIdx).trim();
          const err = getError(name, args);
          if (err) {
            cls = 'hl-fn-err';
            if (addError) addError(tagOffset, err);
          }
        }

        output += `<span class="${cls}">${name}(</span>`;
        i += fullMatch.length;
        currentDepth++;
        punctuationStack.push('(');
        fnParenStack.push({ depth: currentDepth, cls });
        continue;
      }

      const char = text[i];
      // B. Track depth and handle closing parens
      if (char === '(') {
        punctuationStack.push('(');
        currentDepth++;
        output += char;
      } else if (char === ')') {
        punctuationStack.pop();
        const stackItem = fnParenStack.length > 0 && fnParenStack[fnParenStack.length - 1];
        if (stackItem && stackItem.depth === currentDepth) {
          output += `<span class="${stackItem.cls}">)</span>`;
          fnParenStack.pop();
        } else {
          output += char;
        }
        currentDepth--;
      } 
      else if (char === '?' || char === ':' || char === '~') {
        output += `<span class="hl-op">${char}</span>`;
      } 
      else if (char === '[' || char === ']') {
        if (char === '[') punctuationStack.push('[');
        else punctuationStack.pop();
        output += `<span class="hl-list">${char}</span>`;
      }
      else if (char === ',' && punctuationStack[punctuationStack.length - 1] === '[') {
        output += `<span class="hl-list">${char}</span>`;
      }
      // C. Handle variables: $name and special 'index'
      else if (char === '$' || /^(?:index|value)\b/.test(text.substring(i))) {
        const varMatch = text.substring(i).match(/^(\$[\p{L}\p{N}_]+|index\b|value\b)/u);
        if (varMatch) {
          output += `<span class="hl-var">${varMatch[0]}</span>`;
          i += varMatch[0].length - 1;
        } else {
          output += char;
        }
      } 
      else {
        output += char;
      }
      i++;
    }

    // 4. Unmask strings
    return output.replace(/\x01(\d+)\x02/g, (marker, i) => strings[i] ?? marker);
  };

  // Process tags one by one using the string-aware parser results
  let output = '';
  let lastIndex = 0;
  for (const m of tagMatches) {
    const { index, match, inner } = m;
    const offset = index;
    const content = inner.trim();
    output += text.slice(lastIndex, index);
    lastIndex = index + match.length;

    const highlighted = (() => {
    if (tagErrors.has(offset)) return `<span class="error-badge">${match}</span>`;

    // 2. Control Flow & Expressions
    const isControl = /^(if\s+|elif\s+|for\s+|set\s+|switch\s+|case\s+|else$|default$|endif$|endfor$|endswitch$|endcase$|enddefault$|index$|break$|continue$)/.test(content);
    const hasOperators = /[+\-*/%=$~]/.test(content);
    const isNumber = /^\d+$/.test(content);
    const isString = /^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')$/.test(content);
    const hasList = content.includes('[') || content.includes(']');
    const hasFunction = /(?:@[\p{L}_][\p{L}\p{N}_]*|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/u.test(content) || content.includes('@');
    const hasVariable = /\$[\p{L}\p{N}_]+/u.test(content) || /\b(?:index|value)\b/.test(content);
    const isCursor    = content === 'cursor' || content.startsWith('#');

    if (isCursor) {
      if (content === 'cursor') {
        return `<span class="cursor-syntax-badge">{{</span><span class="cursor-badge">${inner}</span><span class="cursor-syntax-badge">}}</span>`;
      }
      if (content.startsWith('#')) {
        const hashIdx = inner.indexOf('#');
        const prefix = inner.substring(0, hashIdx);
        const exprPart = inner.substring(hashIdx + 1); // Preserve raw whitespace
        const trimmedExpr = exprPart.trim();
        
        if (!trimmedExpr) {
          addError(offset, t("err_cursor_number_required"));
          return `<span class="error-badge">${match}</span>`;
        }

        const err = validateExpr(trimmedExpr, offset);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
        return `<span class="cursor-syntax-badge">{{${prefix}#</span><span class="cursor-expr-badge">${highlightInnerExpr(exprPart, offset, addError)}</span><span class="cursor-syntax-badge">}}</span>`;
      }
    }

    if (isControl || hasOperators || isNumber || isString || hasList || hasFunction || hasVariable) {
      if (content.startsWith('if ') || content.startsWith('elif ') || content.startsWith('switch ') || content.startsWith('case ') || content === 'default') {
        const prefixLen = content.startsWith('switch ') ? 7 : (content.startsWith('case ') ? 5 : (content.startsWith('if ') ? 3 : (content === 'default' ? 7 : 5)));
        const exprPart = content.substring(prefixLen);

        // Blocks start a new scope (elif is part of if scope, but switch/case are nested)
        if (!content.startsWith('elif ')) {
           scopeDepth++;
        }

        // For 'case', validate each comma-separated expression
        if (content.startsWith('case ')) {
          const valExprs = splitFunctionArgs(exprPart).filter(s => s.length > 0);
          for (const expr of valExprs) {
            const err = validateExpr(expr, offset);
            if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
          }
        } else {
          const err = validateExpr(exprPart, offset);
          if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
        }
      }

      if (content.startsWith('for ')) {
        const countExpr = content.substring(4);
        const err = validateExpr(countExpr, offset);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
        scopeDepth++;
        activeForDepth++;
      }

      if (content.startsWith('set ')) {
        const assignment = content.substring(4);
        if (!assignment.includes('=') && !/^\$[\p{L}\p{N}_]+\s*$/u.test(assignment)) {
          addError(offset, t("err_set_operator_required"));
          return `<span class="error-badge">${match}</span>`;
        }
        const err = validateExpr(assignment, offset, true);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }

        // Mutation Logic: Only add to scopedVars if it doesn't exist in any outer scope
        const varMatch = assignment.match(/^\$([\p{L}\p{N}_]+)\s*(?:$|=|\+=|-=|\*=|%=|\/=)/u);
        if (varMatch) {
          const name = varMatch[1];
          if (!definedArgs.has(name) && !scopedVars.has(name)) {
            scopedVars.set(name, scopeDepth);
          }
        }
      }

      if (content === 'endif' || content === 'endfor' || content === 'endswitch' || content === 'endcase' || content === 'enddefault' || content.startsWith('elif ') || content === 'else') {
        // Cleanup variables defined at current depth
        for (const [name, depth] of scopedVars.entries()) {
          if (depth === scopeDepth) scopedVars.delete(name);
        }
        
        if (content === 'endfor') activeForDepth--;
        
        // Decrease depth for end tags, but keep for elif/else (they start a new branch at same depth)
        if (!content.startsWith('elif ') && content !== 'else') {
          scopeDepth--;
        }
      }

      if (content === 'index' && activeForDepth === 0) {
        addError(offset, t("err_index_outside_for"));
        return `<span class="error-badge">${match}</span>`;
      }

      if (!isControl && (hasOperators || hasFunction || hasVariable || hasList)) {
        const err = validateExpr(content, offset);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
      }

      const keywordMatch = content.match(/^(if|elif|for|set|switch|case|else|default|endif|endfor|endswitch|endcase|enddefault|break|continue)\b/);
      if (keywordMatch) {
        const keyword = keywordMatch[1];
        let keywordEndIndex = inner.indexOf(keyword) + keyword.length;
        while (keywordEndIndex < inner.length && /\s/.test(inner[keywordEndIndex])) keywordEndIndex++;
        const head = inner.substring(0, keywordEndIndex);
        const tail = inner.substring(keywordEndIndex);
        return `<span class="syntax-badge">{{</span><span class="keyword-badge">${head}</span><span class="expr-badge">${highlightInnerExpr(tail, offset, addError)}</span><span class="syntax-badge">}}</span>`;
      }

      // For general expressions or numbers: {{ (Syntax) | Content (Expr) | }} (Syntax)
      return `<span class="syntax-badge">{{</span><span class="expr-badge">${highlightInnerExpr(inner, offset, addError)}</span><span class="syntax-badge">}}</span>`;
    }

    addError(offset, t("err_unknown_tag", [content]));
      return `<span class="error-badge">${match}</span>`;
    })();
    output += highlighted;
  }
  output += text.slice(lastIndex);
  text = output;

  if (typeof currentConfig !== 'undefined' && currentConfig.visualizeNewlines !== false) {
    // Standardize to \n and prepend the visual marker
    text = text.replace(/\r?\n/g, '<span class="hl-newline">↵</span>\n');
  }

  highlightDiv.innerHTML = text + (text.endsWith('\n') ? ' ' : '');
  return firstErrorMessage;
}

/**
 * Highlights ${name:regex} arguments in the trigger input.
 */
function updateTriggerHighlight(input, highlightDiv) {
  let text = input.value;
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let firstError = "";
  
  // Robust regex for ${name:regex} or ${name}
  const ARG_REGEX = /\$\{([^:}]+)(?::((?:[^{}]|\{[^{}]*\})*))?\}/gu;
  
  text = text.replace(ARG_REGEX, (match, name, inner) => {
    if (!inner) {
      const msg = t("err_trigger_arg_regex_required");
      if (!firstError) firstError = msg;
      return `<span class="error-badge">${match}</span>`;
    }

    let regex = inner;
    let flags = '';

    // Check for flags: last part after a colon if it matches [gimsuy]+
    if (inner.includes(':')) {
      const lastColonIdx = inner.lastIndexOf(':');
      const potentialFlags = inner.substring(lastColonIdx + 1);
      if (/^[gimsuy]+$/.test(potentialFlags) && lastColonIdx > 0) {
        flags = potentialFlags;
        regex = inner.substring(0, lastColonIdx);
      }
    }

    let html = `<span class="arg-badge"><span class="syntax-badge">\${</span><span class="hl-var">${name}</span><span class="syntax-badge">:</span><span class="hl-regex">${regex}</span>`;
    if (flags) {
      html += `<span class="syntax-badge">:</span><span class="flag-badge">${flags}</span>`;
    }
    html += `<span class="syntax-badge">}</span></span>`;
    return html;
  });

  highlightDiv.innerHTML = text;
  return firstError;
}
