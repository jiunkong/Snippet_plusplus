// --- Syntax Highlighting & Validation Engine ---

/**
 * Highlights {{...}} tags in the replacement textarea with color-coded badges
 * and performs real-time syntax validation.
 * @returns {string} First error message found, or empty string if none.
 */
function updateHighlight(textarea, highlightDiv, triggerValue = "") {
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
            inner += ch;
            i++;
            while (i < src.length) {
              const sc = src[i];
              inner += sc;
              i++;
              if (sc === '\\') { if (i < src.length) { inner += src[i]; i++; } continue; }
              if (sc === quote) break;
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
    if (content.startsWith('if ')) ifStack.push({ offset, content });
    else if (content === 'endif') ifStack.length > 0 ? ifStack.pop() : addError(offset, chrome.i18n.getMessage("err_endif_no_if"));
    else if (content.startsWith('elif ') || content === 'else') { if (ifStack.length === 0) addError(offset, chrome.i18n.getMessage("err_elif_else_outside_if")); }
    else if (content.startsWith('for ')) forStack.push({ offset, content });
    else if (content === 'endfor') forStack.length > 0 ? forStack.pop() : addError(offset, chrome.i18n.getMessage("err_endfor_no_for"));
    else if (content.startsWith('switch ')) switchStack.push({ offset, content });
    else if (content === 'endswitch') switchStack.length > 0 ? switchStack.pop() : addError(offset, chrome.i18n.getMessage("err_endswitch_no_switch"));
    else if (content.startsWith('case ')) caseStack.push({ offset, content });
    else if (content === 'endcase') caseStack.length > 0 ? caseStack.pop() : addError(offset, chrome.i18n.getMessage("err_endcase_no_case"));
    else if (content === 'default') caseStack.push({ offset, content });
    else if (content === 'enddefault') caseStack.length > 0 ? caseStack.pop() : addError(offset, chrome.i18n.getMessage("err_enddefault_no_default"));
  });

  ifStack.forEach(item => addError(item.offset, chrome.i18n.getMessage("err_if_unclosed")));
  forStack.forEach(item => addError(item.offset, chrome.i18n.getMessage("err_for_unclosed")));
  switchStack.forEach(item => addError(item.offset, chrome.i18n.getMessage("err_switch_unclosed")));
  caseStack.forEach(item => {
    const isDef = item.content === 'default';
    addError(item.offset, chrome.i18n.getMessage(isDef ? "err_default_unclosed" : "err_case_unclosed"));
  });

  // --- Single-pass Highlight + Inline Validation ---
  let scopeDepth = 0;
  let activeForDepth = 0; // Still need to track specifically for 'index'
  // Track variables defined via {{set}} and the depth at which they were defined
  const scopedVars = new Map(); // name -> depth

  /**
   * Validates an expression for syntax, variables, and loop context.
   */
  const validateExpr = (expr, offset, isAssignment = false) => {
    let cond = expr.trim();
    cond = cond.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    // Strip strings before checking for operator errors to avoid false positives inside quotes
    const strippedForOps = cond.replace(/(['"])(?:(?!\1).|\\\1)*\1/g, '""');

    if (!isAssignment && /(?<![=!><])=(?![=])/.test(strippedForOps)) return chrome.i18n.getMessage("err_assignment_instead_of_comparison");
    if (/(?<!&)&(?!&)/.test(strippedForOps) || /(?<!\|)\|(?!\|)/.test(strippedForOps)) return chrome.i18n.getMessage("err_logical_operator_single");

    const pStack = [];
    for (let i = 0; i < cond.length; i++) {
      if (cond[i] === '(') pStack.push(i);
      else if (cond[i] === ')') {
        if (pStack.length === 0) return chrome.i18n.getMessage("err_unmatched_close_paren");
        pStack.pop();
      }
    }
    if (pStack.length > 0) return chrome.i18n.getMessage("err_unmatched_open_paren");

    const parts = cond.split(/&&|\|\|/);
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      const compOpRegex = /==|!=|>=|<=|>|</;
      if (compOpRegex.test(part)) {
        const ops = part.split(compOpRegex);
        if (ops.some(op => !op.trim())) return chrome.i18n.getMessage("err_missing_operand", [part]);
      }
    }

    if (/\bindex\b/.test(cond) && activeForDepth === 0) return chrome.i18n.getMessage("err_index_outside_for");

    // Check Ternary Balance (? and :)
    let ternaryDepth = 0;
    let inQTest = null;
    let pDepthTest = 0;
    for (let i = 0; i < cond.length; i++) {
        const c = cond[i];
        if ((c === "'" || c === '"') && !inQTest) inQTest = c;
        else if (c === inQTest) inQTest = null;
        if (!inQTest) {
            if (c === '(') pDepthTest++;
            else if (c === ')') pDepthTest--;
            if (pDepthTest === 0) {
                if (c === '?') ternaryDepth++;
                else if (c === ':') {
                    ternaryDepth--;
                    if (ternaryDepth < 0) return chrome.i18n.getMessage("err_ternary_no_matching_question");
                }
            }
        }
    }
    if (ternaryDepth > 0) return chrome.i18n.getMessage("err_ternary_no_matching_colon");

    const stripped = cond.replace(/(['"])(?:(?!\1).|\\\1)*\1/g, '""');
    const tokens = stripped.match(/[\p{L}_][\p{L}\p{N}_]*/gu) || [];
    const validKeywords = ['index', 'true', 'false', 'null', 'undefined', ...BUILTIN_ALL];
    
    for (const token of tokens) {
      if (validKeywords.includes(token)) continue;
      if (/^\d+$/.test(token)) continue;
      const idx = stripped.indexOf(token);
      if (idx === 0 || stripped[idx - 1] !== '$') {
        return chrome.i18n.getMessage("err_var_start_with_dollar", [token]);
      }
    }

    if (/\$(?![\p{L}\p{N}_])/u.test(cond)) return chrome.i18n.getMessage("err_var_name_required");

    const vars = cond.match(/\$[\p{L}\p{N}_]+/gu);
    if (vars) {
      for (const v of vars) {
        const name = v.substring(1);
        if (isAssignment) {
          const assignmentMatch = cond.match(/^\$([\p{L}\p{N}_]+)\s*(?:=|\+=|-=|\*=|%=|\/=)/u);
          if (assignmentMatch && assignmentMatch[1] === name) continue;
        }
        // Check both trigger args and scoped set variables
        if (!definedArgs.has(name) && !scopedVars.has(name)) return chrome.i18n.getMessage("err_undefined_variable", [v]);
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
    const isTypeFn = (n) => BUILTIN_FUNCS_TYPE_CAST.includes(n);
    
    const getError = (n, a) => {
      if (BUILTIN_FUNCS_NO_ARGS.includes(n) && a.trim() !== "") return chrome.i18n.getMessage("err_fn_no_args_allowed", [n]);
      
      const parts = a.split(',').map(p => p.trim()).filter(p => p.length > 0);
      if (BUILTIN_FUNCS_HAS_ARGS.includes(n) && parts.length === 0) return chrome.i18n.getMessage("err_fn_args_required", [n]);
      // Optional args fns like prompt() are allowed to be empty
      if (BUILTIN_FUNCS_TYPE_CAST.includes(n) && parts.length !== 1) return chrome.i18n.getMessage("err_fn_one_arg_exact", [n]);

      // Strict count checks
      const oneArgFns = ['upper', 'lower', 'trim', 'capitalize', 'len', 'prompt', 'round', 'ceil', 'floor', 'date', 'time', 'datetime'];
      if (oneArgFns.includes(n) && parts.length > 1) return chrome.i18n.getMessage("err_fn_one_arg_max", [n]);
      if ((n === 'min' || n === 'max') && parts.length === 0) return chrome.i18n.getMessage("err_fn_min_one_arg", [n]);
      if (n === 'substr' && (parts.length < 2 || parts.length > 3)) return chrome.i18n.getMessage("err_substr_args");
      if (n === 'replace' && parts.length !== 3) return chrome.i18n.getMessage("err_replace_args");

      if (n === 'random') {
        if (parts.length === 0) return chrome.i18n.getMessage("err_random_args");
        for (const p of parts) {
          if (p.includes('~')) {
            const rangeParts = p.split('~').map(s => s.trim());
            if (rangeParts.length !== 2 || !rangeParts[0] || !rangeParts[1]) {
              return chrome.i18n.getMessage("err_range_both_values_required", [p]);
            }
          }
        }
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
    // 1. Mask strings
    let text = expr.replace(/(['"])(?:(?!\1).|\\\1)*\1/g, (m) => {
      strings.push(m);
      return `\x01${strings.length - 1}\x02`;
    });

    let output = "";
    let i = 0;
    let fnParenStack = []; // Stores { depth, cls }
    let currentDepth = 0;

    while (i < text.length) {
      // A. Check for function start: name(
      const fnMatch = text.substring(i).match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (fnMatch) {
        const name = fnMatch[1];
        const fullMatch = fnMatch[0];
        const openIdx = i + fullMatch.length - 1;
        const closeIdx = getMatchingParen(text, openIdx);

        let cls = isRandomFn(name) ? 'hl-fn-rand' : (isTypeFn(name) ? 'hl-fn-type' : 'hl-fn');
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
        fnParenStack.push({ depth: currentDepth, cls });
        continue;
      }

      const char = text[i];
      // B. Track depth and handle closing parens
      if (char === '(') {
        currentDepth++;
        output += char;
      } else if (char === ')') {
        const stackItem = fnParenStack.length > 0 && fnParenStack[fnParenStack.length - 1];
        if (stackItem && stackItem.depth === currentDepth) {
          output += `<span class="${stackItem.cls}">)</span>`;
          fnParenStack.pop();
        } else {
          output += char;
        }
        currentDepth--;
      } 
      else if (char === '?' || char === ':') {
        output += `<span class="hl-op">${char}</span>`;
      } 
      // C. Handle variables: $name and special 'index'
      else if (char === '$' || (char === 'i' && text.substring(i, i + 5) === 'index')) {
        const varMatch = text.substring(i).match(/^(\$[\p{L}\p{N}_]+|index\b)/u);
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
    return output.replace(/\x01(\d+)\x02/g, (_, i) => strings[i]);
  };

  // Process tags one by one using the string-aware parser results
  let output = '';
  let lastIndex = 0;
  for (const m of findTags(text)) {
    const { index, match, inner } = m;
    const offset = index;
    const content = inner.trim();
    output += text.slice(lastIndex, index);
    lastIndex = index + match.length;

    const highlighted = (() => {
    if (tagErrors.has(offset)) return `<span class="error-badge">${match}</span>`;

    // 2. Control Flow & Expressions
    const isControl = /^(if\s+|elif\s+|for\s+|set\s+|switch\s+|case\s+|else$|default$|endif$|endfor$|endswitch$|endcase$|enddefault$|index$)/.test(content);
    const hasOperators = /[+\-*/%=$]/.test(content);
    const isNumber = /^\d+$/.test(content);
    const hasFunction = /[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(content);
    const hasVariable = /\$[\p{L}\p{N}_]+/u.test(content) || /\bindex\b/.test(content);
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
          addError(offset, chrome.i18n.getMessage("err_cursor_number_required"));
          return `<span class="error-badge">${match}</span>`;
        }

        const err = validateExpr(trimmedExpr, offset);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
        return `<span class="cursor-syntax-badge">{{${prefix}#</span><span class="cursor-expr-badge">${highlightInnerExpr(exprPart, offset, addError)}</span><span class="cursor-syntax-badge">}}</span>`;
      }
    }

    if (isControl || hasOperators || isNumber || hasFunction || hasVariable) {
      if (content.startsWith('if ') || content.startsWith('elif ') || content.startsWith('switch ') || content.startsWith('case ') || content === 'default') {
        const prefixLen = content.startsWith('switch ') ? 7 : (content.startsWith('case ') ? 5 : (content.startsWith('if ') ? 3 : (content === 'default' ? 7 : 5)));
        const exprPart = content.substring(prefixLen);

        // Blocks start a new scope (elif is part of if scope, but switch/case are nested)
        if (!content.startsWith('elif ')) {
           scopeDepth++;
        }

        // For 'case', validate each comma-separated expression
        if (content.startsWith('case ')) {
          const valExprs = exprPart.split(',').map(s => s.trim()).filter(s => s.length > 0);
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
        if (!assignment.includes('=')) {
          addError(offset, chrome.i18n.getMessage("err_set_operator_required"));
          return `<span class="error-badge">${match}</span>`;
        }
        const err = validateExpr(assignment, offset, true);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }

        // Mutation Logic: Only add to scopedVars if it doesn't exist in any outer scope
        const varMatch = assignment.match(/^\$([\p{L}\p{N}_]+)\s*(?:=|\+=|-=|\*=|%=|\/=)/u);
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
        addError(offset, chrome.i18n.getMessage("err_index_outside_for"));
        return `<span class="error-badge">${match}</span>`;
      }

      if (!isControl && (hasOperators || hasFunction || hasVariable)) {
        const err = validateExpr(content, offset);
        if (err) { addError(offset, err); return `<span class="error-badge">${match}</span>`; }
      }

      const keywordMatch = content.match(/^(if|elif|for|set|switch|case|else|default|endif|endfor|endswitch|endcase|enddefault)\b/);
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

    addError(offset, chrome.i18n.getMessage("err_unknown_tag", [content]));
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
      const msg = chrome.i18n.getMessage("err_trigger_arg_regex_required");
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
