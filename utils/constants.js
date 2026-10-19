/**
 * Shared Constants
 */

const BUILTIN_FUNCS_NO_ARGS = [
  'url', 'domain', 'title', 'uuid', 'paste', 'bs', 'backspace'
];

const BUILTIN_FUNCS_HAS_ARGS = [
  'random', 'upper', 'lower', 'trim', 'capitalize', 'substr', 'replace', 'len',
  'startswith', 'endswith', 'includes', 'toast', 'copy', 'type', 'isCursor', 'hasCursor', 'split', 'join', 'insertAt', 'removeAt'
];

const BUILTIN_FUNCS_OPT_ARGS = [
  'prompt', 'date', 'time', 'datetime', 'choice'
];

const BUILTIN_FUNCS_TYPE_CAST = [
  'str', 'num', 'int', 'bool', 'fragment'
];

const BUILTIN_FUNCS_MATH = [
  'round', 'ceil', 'floor', 'min', 'max'
];

const BUILTIN_ALL = [
  ...BUILTIN_FUNCS_NO_ARGS, 
  ...BUILTIN_FUNCS_HAS_ARGS, 
  ...BUILTIN_FUNCS_OPT_ARGS,
  ...BUILTIN_FUNCS_TYPE_CAST, 
  ...BUILTIN_FUNCS_MATH
];

const CURSOR_REGEX        = /\{\{\s*(cursor|#(?:cursor|\d+))\s*\}\}/g;
const SNIPPET_LOOP_VALUE = Symbol('snippetLoopValue');

const VISUAL_OPEN         = "⟦";
const VISUAL_CLOSE        = "⟧";
const VISUAL_CURSOR_REGEX = /⟦(\d+)⟧/g;

const DEFAULT_SNIPPET_TIMEOUT_MS = 500;
const MIN_SNIPPET_TIMEOUT_MS = 100;
const MAX_SNIPPET_TIMEOUT_MS = 60000;

function normalizeSnippetTimeout(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= MIN_SNIPPET_TIMEOUT_MS && value <= MAX_SNIPPET_TIMEOUT_MS
    ? Math.round(value) : DEFAULT_SNIPPET_TIMEOUT_MS;
}

const DEFAULT_SNIPPET_CALL_DEPTH = 32;
const MAX_SNIPPET_CALL_DEPTH = 256;

function normalizeSnippetCallDepth(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SNIPPET_CALL_DEPTH
    ? value : DEFAULT_SNIPPET_CALL_DEPTH;
}
