import { compileTrigger as compileCoreTrigger, escapeRegex as escapeCoreRegex } from '../language-core/src/index.ts';

// Compatibility adapters: syntax, signatures and regex validation live in core.
export function compileTrigger(trigger) {
  return compileCoreTrigger(trigger);
}

export function escapeRegex(source) {
  return escapeCoreRegex(source);
}
