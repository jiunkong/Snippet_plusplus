// Existing VM tests keep their injectable browser harnesses while production
// sources use explicit ESM imports. This adapter removes module syntax only;
// the language implementation always comes from the built portable core.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const nativeRead = fs.readFileSync.bind(fs);
let core;
function corePrelude() {
  core ||= nativeRead(path.join(root,'.test-build/core.js'),'utf8');
  return `if(typeof SnippetScript==='undefined'){${core}\n}\n`;
}
const coreNames = ['Type','ScriptValue','StringValue','NumberValue','BoolValue','ListValue','Types','UnionType','ListType','fromNative','toNative','SnippetFragment','SnippetTemplate','SnippetError','analyze','analyzeTrigger','parseExpression','parseSnippetTemplate','prepareSnippetTemplate','getSnippetTemplate','evaluateExpression','evaluateCondition','createSnippetExecution','normalizeSnippetTimeout','normalizeSnippetCallDepth','DEFAULT_SNIPPET_TIMEOUT_MS','MIN_SNIPPET_TIMEOUT_MS','MAX_SNIPPET_TIMEOUT_MS','DEFAULT_SNIPPET_CALL_DEPTH','MAX_SNIPPET_CALL_DEPTH','SNIPPET_LOOP_VALUE','BUILTIN_ALL','FUNCTIONS','isRange','createRange','createList','isSnippetIterable','snippetConditionValue','snippetBooleanValue','snippetParameterNames','scanSnippetQuotedValue','decodeSnippetFragmentLiteral','parseSnippetFunctionName','parseSnippetCall'];
function classic(source, file) {
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const edits=[]; let bindings='';
  for(const statement of parsed.statements) {
    if(ts.isImportDeclaration(statement)) {
      if(statement.moduleSpecifier.text.includes('language-core')) {
        for(const element of statement.importClause?.namedBindings?.elements || []) {
          bindings+=`var ${element.name.text}=SnippetScript.${element.propertyName?.text || element.name.text};\n`;
        }
      }
      edits.push([statement.getStart(parsed),statement.end,'']);
    } else if(ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d=>d.name.text==='moduleState')) edits.push([statement.getStart(parsed),statement.end,'']);
    else if(ts.isExportDeclaration(statement)) edits.push([statement.getStart(parsed),statement.end,'']);
    else for(const modifier of statement.modifiers||[]) if(modifier.kind===ts.SyntaxKind.ExportKeyword) edits.push([modifier.getStart(parsed),modifier.end,'']);
  }
  for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+text+source.slice(end);
  source=source.replace(/__state_[\w]+\.([\w]+)/g,'$1');
  let prefix=corePrelude()+coreNames.map(name=>`var ${name}=${name === "evaluateExpression" ? "(...args)=>SnippetScript.toNative(SnippetScript.evaluateExpression(...args))" : `SnippetScript.${name}`};`).join('\n')+'\n'+bindings;
  if(file==='content/template.js') {
    const host=classicHost();prefix+=host;
    // Harnesses may provide config directly without loading content/state.
    source=source.replace('maxExecutionMs: config.maxExecutionMs','maxExecutionMs: typeof config!=="undefined" ? config.maxExecutionMs : undefined').replace('maxCallDepth: config.maxCallDepth','maxCallDepth: typeof config!=="undefined" ? config.maxCallDepth : undefined');
  }
  if(file==='content/handlers.js')source+='\ninitializeHandlers({ load: typeof loadSettings===\'function\'?loadSettings:()=>{}, reload: typeof reloadSnippetSettings===\'function\'?reloadSnippetSettings:async()=>{} });\n';
  if(file==='content/settings.js')source+='\nwatchSnippetSettings();\n';
  return prefix+source;
}
function classicHost() {
  let source=nativeRead(path.join(root,'content/browser-host.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export const browserHost','var browserHost');
  return source+'\n';
}
module.exports = Object.assign(Object.create(fs), {
  rawReadFileSync: nativeRead,
  readFileSync(filename, options) {
    const absolute=path.resolve(String(filename));
    const relative=path.relative(root,absolute).split(path.sep).join('/');
    if(['content/evaluator.js','content/fragment.js','content/template-parser.js'].includes(relative))return corePrelude()+coreNames.map(name=>`var ${name}=${name === "evaluateExpression" ? "(...args)=>SnippetScript.toNative(SnippetScript.evaluateExpression(...args))" : `SnippetScript.${name}`};`).join('\n');
    const source=nativeRead(filename,options);
    if(typeof source==='string' && /^(content|options|utils)\/.*\.js$/.test(relative))return classic(source,relative);
    return source;
  },
});
