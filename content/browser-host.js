import { showSnippetPrompt, showSnippetChoice } from './handlers.js';
import { showSnippetToast } from './effects.js';
import { SnippetError } from '../language-core/src/index.ts';

// Only browser capabilities live here. Language signatures and execution
// policies are defined by the core's FUNCTIONS registry.
const capabilities = Object.freeze({
    url: () => window.location.href,
    domain: () => window.location.hostname,
    title: () => document.title,
    toast: (args) => {
        showSnippetToast(args[0], args[1], 'default', args[2]);
        return undefined;
    },
    copy: async (args) => {
        await navigator.clipboard.writeText(typeof args[0] === 'string' ? args[0] : args[0].toString());
        return '';
    },
    paste: () => navigator.clipboard.readText(),
    prompt: (args, signal) => typeof showSnippetPrompt === 'function' ? showSnippetPrompt(args[0] ?? 'Enter value:', signal) : window.prompt(args[0] ?? 'Enter value:'),
    choice: (args, signal) => {
        const title = args[0] || 'Select Option:', options = args.slice(1);
        return typeof showSnippetChoice === 'function' ? showSnippetChoice(title, options, signal) : window.prompt(`${title}\nOptions: ${options.join(', ')}`);
    },
});

export const browserHost = {
    async invoke({ name, args }, { signal }) {
        if (signal.aborted)
            throw new SnippetError('err_snippet_cancelled');
        const capability = Object.prototype.hasOwnProperty.call(capabilities, name) ? capabilities[name] : undefined;
        if (!capability) throw new SnippetError('err_host_function_unavailable', [name]);
        return capability(args, signal);
    },
};
