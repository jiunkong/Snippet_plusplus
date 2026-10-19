import { moduleState as __state_options_state_js } from './state.js';
import { t } from './i18n.js';
import { analyze, analyzeTrigger, snippetParameterNames } from '../language-core/src/index.ts';
// Token categories are a language contract; presentation belongs to this host.
export const TOKEN_CLASSES = Object.freeze({
    syntax: 'syntax-badge', parenthesis: 'hl-parenthesis', keyword: 'keyword-badge', variable: 'hl-var',
    function: 'hl-fn', randomFunction: 'hl-fn-rand', typeFunction: 'hl-fn-type',
    snippetFunction: 'hl-fn-snippet', operator: 'hl-op', arithmeticOperator: 'hl-op-arithmetic', rangeOperator: 'hl-op-range', list: 'hl-list',
    fragmentDelimiter: 'hl-fragment', cursorSyntax: 'cursor-syntax-badge', cursor: 'cursor-badge',
    regex: 'hl-regex', regexFlag: 'flag-badge', bool: 'hl-bool', null: 'hl-null',
    stringEscape: 'hl-string-escape',
});
export const REGION_CLASSES = Object.freeze({ expression: 'expr-badge', cursorExpression: 'cursor-expr-badge', cursor: 'cursor-expr-badge', argument: 'arg-badge' });
export const highlightedAnalyses = new WeakMap();
const highlightedTriggerAnalyses = new WeakMap();
export const escapeHighlightText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Diagnostics remain separate messages. Their visual coverage is a union:
// nesting translucent badges would darken overlapping portions of the text.
function diagnosticHighlightSpans(diagnostics, cls) {
    const ranges = diagnostics.map(item => item.range).filter(range => range.end > range.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const spans = [];
    for (const range of ranges) {
        const previous = spans[spans.length - 1];
        if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
        else spans.push({ start: range.start, end: range.end, cls, order: 1 });
    }
    return spans;
}

export function renderHighlight(analysis, { visualizeNewlines = false } = {}) {
    const errors = analysis.diagnostics.filter(item => item.severity === 'error');
    const warnings = analysis.diagnostics.filter(item => item.severity === 'warning');
    const spans = analysis.regions.filter(region => REGION_CLASSES[region.kind]).map(region => ({ ...region, cls: REGION_CLASSES[region.kind], order: 0 }));
    for (const token of analysis.tokens) {
        const invalidFunction = ['function', 'snippetFunction', 'typeFunction', 'randomFunction'].includes(token.kind) && errors.some(error => error.range.start < token.end && error.range.end > token.start);
        spans.push({ ...token, cls: invalidFunction ? 'hl-fn-err' : TOKEN_CLASSES[token.kind], order: 2 });
    }
    for (const [index, variable] of (analysis.variableTypes || []).entries())
        spans.push({ ...variable.range, cls: 'variable-type-target', variableIndex: index, order: 3 });
    for (const [index, signature] of (analysis.callSignatures || []).entries())
        spans.push({ ...signature.range, cls: 'call-signature-target', callSignatureIndex: index, order: 3 });
    spans.push(...diagnosticHighlightSpans(warnings, 'warning-badge'), ...diagnosticHighlightSpans(errors, 'error-badge'));
    // Event intervals preserve the source exactly, including escaped fragment text.
    // Reopen crossing intervals rather than producing invalid nested HTML.
    const events = new Map();
    const eventAt = offset => {
        if (!events.has(offset))
            events.set(offset, { start: [], end: [] });
        return events.get(offset);
    };
    eventAt(0);
    eventAt(analysis.source.length);
    for (const span of spans) {
        // A point range has no characters to wrap. Adding and removing it at
        // the same boundary would leave it active over the following text.
        if (span.end <= span.start)
            continue;
        eventAt(span.start).start.push(span);
        eventAt(span.end).end.push(span);
    }
    const boundaries = [...events.keys()].sort((a, b) => a - b);
    const covering = new Set();
    const spanOrder = (a, b) => a.start - b.start || b.end - a.end || a.order - b.order;
    let html = '', active = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i], end = boundaries[i + 1];
        for (const span of events.get(start).end)
            covering.delete(span);
        for (const span of events.get(start).start)
            covering.add(span);
        // Error presentation takes precedence over normal token/region badges
        // for exactly the affected characters. Their backgrounds must not hide
        // the red error background (for example on a keyword such as `set`).
        const hasError = [...covering].some(span => span.cls === 'error-badge');
        const hasWarning = [...covering].some(span => span.cls === 'warning-badge');
        const next = [...covering].filter(span => hasError
            ? span.cls === 'error-badge' || span.cls === 'hl-fn-err' || span.variableIndex !== undefined || span.callSignatureIndex !== undefined
            : hasWarning ? span.cls === 'warning-badge' || span.variableIndex !== undefined || span.callSignatureIndex !== undefined : true).sort(spanOrder);
        let common = 0;
        while (common < active.length && active[common] === next[common])
            common++;
        html += '</span>'.repeat(active.length - common);
        for (const span of next.slice(common))
            html += `<span class="${span.cls}"${span.variableIndex !== undefined ? ` data-variable-type-index="${span.variableIndex}"` : ''}${span.callSignatureIndex !== undefined ? ` data-call-signature-index="${span.callSignatureIndex}"` : ''}>`;
        html += escapeHighlightText(analysis.source.slice(start, end)).replace(/\r?\n/g, newline => visualizeNewlines ? `<span class="hl-newline">↵</span>${newline}` : newline);
        active = next;
    }
    html += '</span>'.repeat(active.length);
    if (analysis.source.endsWith('\n'))
        html += ' ';
    return html;
}
export function updateHighlight(textarea, highlightDiv, triggerValue = '', groupSnippets = null, sourceSnippetName = null, literalContext = {}) {
    const options = { library: groupSnippets, variables: [...snippetParameterNames(triggerValue), ...(literalContext.variables || [])], forDepth: literalContext.forDepth || 0 };
    const signature = JSON.stringify({ ...options, library: groupSnippets?.map(({ id, name, trigger }) => ({ id, name, trigger })) ?? null });
    let cached = highlightedAnalyses.get(textarea);
    if (!cached || cached.source !== textarea.value || cached.signature !== signature) {
        cached = { source: textarea.value, signature, analysis: analyze(textarea.value, options) };
        highlightedAnalyses.set(textarea, cached);
    }
    highlightDiv.innerHTML = renderHighlight(cached.analysis, { visualizeNewlines: typeof __state_options_state_js.currentConfig !== 'undefined' && __state_options_state_js.currentConfig.visualizeNewlines });
    const diagnostic = cached.analysis.diagnostics.find(item => item.severity === 'error');
    return diagnostic ? t(diagnostic.code, diagnostic.args) : '';
}
export function updateTriggerHighlight(input, highlightDiv) {
    const analysis = analyzeTrigger(input.value);
    highlightedTriggerAnalyses.set(input, analysis);
    highlightDiv.innerHTML = renderHighlight(analysis);
    const diagnostic = analysis.diagnostics.find(item => item.severity === 'error');
    return diagnostic ? t(diagnostic.code, diagnostic.args) : '';
}
export function getHighlightAnalysis(textarea) { return highlightedAnalyses.get(textarea)?.analysis; }

export function getTriggerHighlightAnalysis(input) { return highlightedTriggerAnalyses.get(input); }
