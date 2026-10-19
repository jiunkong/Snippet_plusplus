import { moduleState as __state_content_state_js } from './state.js';
import { snippetMessage } from '../utils/i18n.js';
import { processTemplate as executeTemplate } from '../language-core/src/index.ts';
import { browserHost } from './browser-host.js';

// The adapter supplies extension settings and browser capabilities. Parsing and
// execution belong entirely to SnippetScript.
export async function processTemplate(input, args = {}, context = {}) {
  try {
    return await executeTemplate(input, args, {
      maxExecutionMs: __state_content_state_js.config.maxExecutionMs,
      maxCallDepth: __state_content_state_js.config.maxCallDepth,
      ...context,
      host: browserHost,
    });
  } catch (error) {
    if (error.messageKey) error.message = snippetMessage(error.messageKey, error.messageValues) || error.message;
    throw error;
  }
}
