import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const profile = await mkdtemp(path.join(os.tmpdir(), 'snippetscript-browser-'));
const chrome = spawn(process.env.SNIPPET_CHROME_BIN || 'google-chrome', [
 '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
 '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
 '--remote-debugging-port=0', '--enable-unsafe-extension-debugging', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError, stderr = '';
chrome.on('error', error => { launchError = error; });
chrome.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
let port;
for(let attempt=0; attempt<100; attempt++) {
 if(launchError) break;
 try { port = Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); break; }
 catch { await new Promise(resolve => setTimeout(resolve,100)); }
}
if(!port) {
 chrome.kill(); await rm(profile,{recursive:true,force:true});
 throw launchError || new Error(`Chrome did not expose DevTools: ${stderr}`);
}
const version=await fetch(`http://127.0.0.1:${port}/json/version`).then(r=>r.json());
const ws=new WebSocket(version.webSocketDebuggerUrl);
await new Promise(resolve=>ws.onopen=resolve);
let id=0;
const pending=new Map(),errors=[];
ws.onmessage=e=>{
 const message=JSON.parse(e.data);
 if(message.id){const task=pending.get(message.id);pending.delete(message.id);message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);}
 if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(sessionId,expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(session,expression,label){for(let i=0;i<100;i++){if(await evaluate(session,expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(`Timed out: ${label} ${JSON.stringify(errors)}`);}
const targets=[];
async function open(url){const {targetId}=await send('Target.createTarget',{url:'about:blank'});targets.push(targetId);const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);await send('Page.navigate',{url},sessionId);await until(sessionId,"document.readyState==='complete'",url);return sessionId;}
const snippets=[
 {name:'main',trigger:'/go',replacement:'{{"{{#0}}"}}|{{upper(fragment("ab{{#1}}cd"))}}'},
 {name:'lazy',trigger:'/lazy',replacement:'{{false && prompt()}}'},
 {name:'ask',trigger:'/ask',replacement:'{{prompt("Value")}}'},
];
const state={config:{shiftCursorLevels:true,maxExecutionMs:500,maxCallDepth:32,showParticles:false,visualizeNewlines:false},snippetGroups:[{name:'Smoke',snippets}]};
let server;
try{
 const loaded=await send('Extensions.loadUnpacked',{path:path.join(root,'dist')});console.log('Extension loaded',loaded);
 const extension=loaded.id; assert.ok(extension);
 const tester=await open(`chrome-extension://${extension}/tester.html`);
 await evaluate(tester,`chrome.storage.sync.clear().then(()=>chrome.storage.sync.set(${JSON.stringify(state)}))`);
 await evaluate(tester,`window.postMessage({type:'snippetpp:test-state',...${JSON.stringify(state)}},location.origin)`);
 await until(tester,`document.getElementById('snippet-test-input').getAttribute('aria-label')!==null`,'tester state');
 assert.equal(await evaluate(tester,"typeof processTemplate"),'undefined');
 async function type(session,selector,text){await evaluate(session,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();if(el.isContentEditable){el.textContent='';const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}else{el.value='';el.setSelectionRange(0,0);}})()`);await send('Input.insertText',{text},session);}
 for(const name of ['input','textarea','rich']){
  const selector='#snippet-test-'+name;
  await type(tester,selector,'/go');
  const expression=`(()=>{const el=document.querySelector('${selector}');return el.isContentEditable?el.textContent:el.value;})()`;
  await until(tester,`${expression}==='{{#0}}|ABCD'`,name+' expansion');
  const caret=await evaluate(tester,`(()=>{const el=document.querySelector('${selector}');if(!el.isContentEditable)return el.selectionStart;const s=window.getSelection(),r=document.createRange();r.selectNodeContents(el);r.setEnd(s.anchorNode,s.anchorOffset);return r.toString().length;})()`);
  assert.equal(caret,9,name+' caret');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2},tester);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:0},tester);
  await until(tester,`${expression}==='/go'`,name+' undo');
 }
 await type(tester,'#snippet-test-input','/lazy');
 await until(tester,"document.querySelector('#snippet-test-input').value==='false'",'lazy branch');
 assert.equal(await evaluate(tester,"!!document.querySelector('.spp-prompt-overlay')"),false);
 await type(tester,'#snippet-test-input','/ask');
 await until(tester,"!!document.querySelector('.spp-prompt-overlay')",'prompt open');
 await evaluate(tester,"document.querySelector('.spp-prompt-input').value='Answer';document.querySelector('.spp-prompt-btn-confirm').click()");
 await until(tester,"document.querySelector('#snippet-test-input').value==='Answer'",'prompt answer');
 await type(tester,'#snippet-test-input','/ask');
 await until(tester,"!!document.querySelector('.spp-prompt-overlay')",'cancel open');
 await evaluate(tester,"document.querySelector('.spp-prompt-btn-cancel').click()");
 await until(tester,"!document.querySelector('.spp-prompt-overlay') && document.querySelector('#snippet-test-input').value==='/ask'",'prompt cancellation');
 console.log('Tester: input, textarea, contenteditable, caret, undo, lazy calls and prompt cancellation passed.');
 const options=await open(`chrome-extension://${extension}/options.html`);
 await until(options,"document.querySelectorAll('.snippet-row').length===3",'options rows');
 assert.equal(await evaluate(options,"chrome.runtime.getManifest().version"),'2.0.0');
 const source='{{set $f=`asdf{{"a"}}`}}{{$f}} {{true}} {{false}} {{null}}';
 await evaluate(options,`(()=>{const field=document.querySelector('.replacement-input');field.value=${JSON.stringify(source)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const result=await evaluate(options,"({bool:document.querySelectorAll('.hl-bool').length,null:document.querySelectorAll('.hl-null').length,errors:document.querySelectorAll('.replacement-highlight .error-badge').length})");
 console.log('Highlight result',result);assert.ok(result.bool>=2);assert.ok(result.null>=1);assert.equal(result.errors,0);
 console.log('Options page: nested fragment highlighting, bool/null categories and module startup passed.');
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<input id="field"><div contenteditable id="rich"></div>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const content=await open(`http://127.0.0.1:${server.address().port}/`);
 // Content scripts load at document_idle after page load.
 await new Promise(resolve=>setTimeout(resolve,300));
 await type(content,'#field','/go');
 await until(content,"document.querySelector('#field').value==='{{#0}}|ABCD'",'real content script');
 assert.equal(await evaluate(content,"document.querySelector('#field').selectionStart"),9);
 console.log('Real web page content-script bundle passed.');
 assert.deepEqual(errors,[]);console.log('No uncaught browser exceptions.');
}finally{for(const targetId of targets)await send('Target.closeTarget',{targetId}).catch(()=>{});server?.closeAllConnections();server?.close();
 await send('Browser.close').catch(()=>{}); ws.close();
 await new Promise(resolve => { if(chrome.exitCode!==null) resolve(); else {chrome.once('exit',resolve);setTimeout(()=>{chrome.kill();resolve();},2000).unref();} });
 await rm(profile,{recursive:true,force:true});
}
