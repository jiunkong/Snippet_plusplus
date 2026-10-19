const vm = require('node:vm');
module.exports = { ...vm, createContext(values = {}, ...args) {
  return vm.createContext({ AbortController, AbortSignal, setTimeout, clearTimeout, ...values }, ...args);
}};
