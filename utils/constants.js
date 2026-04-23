/**
 * Shared Constants
 */

const BUILTIN_FUNCS_NO_ARGS = [
  'url', 'domain', 'title', 'uuid', 'clipboard', 'bs', 'backspace'
];

const BUILTIN_FUNCS_HAS_ARGS = [
  'random', 'upper', 'lower', 'trim', 'capitalize', 'substr', 'replace', 'len'
];

const BUILTIN_FUNCS_OPT_ARGS = [
  'prompt', 'date', 'time', 'datetime', 'choice'
];

const BUILTIN_FUNCS_TYPE_CAST = [
  'str', 'num', 'int'
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
const VISUAL_OPEN         = "⟦";
const VISUAL_CLOSE        = "⟧";
const VISUAL_CURSOR_REGEX = /⟦(\d+)⟧/g;
