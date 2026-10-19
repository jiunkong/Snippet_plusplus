const assert = require('node:assert/strict');

// Existing language tests assert serialized output. Node identity and insertion
// semantics are covered separately in fragment.test.cjs and expansion.test.cjs.
function assertTemplateOutput(actual, expected, message) {
  assert.equal(actual?.constructor.name, 'SnippetFragment', message);
  assert.equal(String(actual), expected, message);
}
module.exports = { assertTemplateOutput };
