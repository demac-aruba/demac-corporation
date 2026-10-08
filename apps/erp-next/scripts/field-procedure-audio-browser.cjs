'use strict';
// Real component, MediaRecorder encoder and IndexedDB. Synthetic Web Audio microphone source;
// no real microphone, external network, server authorization or physical-phone claim.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const tools=process.env.FIELD_PORTAL_TEST_TOOLS;if(!tools)throw Error('Expected isolated FIELD_PORTAL_TEST_TOOLS');
const esbuild=require(path.join(tools,'node_modules/esbuild')),{chromium,webkit}=require(path.join(tools,'node_modules/playwright'));
const app=path.resolve(__dirname,'..'),out=path.resolve(process.env.FIELD_AUDIO_EVIDENCE||path.join(app,'.field-audio-evidence'));
fs.mkdirSync(out,{recursive:true});
const settings={ISOLATED_PREVIEW:'true',FIREBASE_API_KEY:'synthetic',FIREBASE_PROJECT_ID:'demo-demac-dwellings',FIREBASE_AUTH_DOMAIN:'demo-demac-dwellings.invalid',FIREBASE_STORAGE_BUCKET:'demo-demac-dwellings.appspot.com',FIREBASE_APP_ID:'synthetic',FIREBASE_MESSAGING_SENDER_ID:'0',FIREBASE_MEASUREMENT_ID:''};
const define=Object.fromEntries(Object.entries(settings).map(([k,v])=>['process.env.NEXT_PUBLIC_'+k,JSON.stringify(v)]));
const common={bundle:true,write:false,tsconfig:path.join(app,'tsconfig.json'),nodePaths:[path.join(tools,'node_modules')],define};
const compiled=esbuild.buildSync({...common,entryPoints:[path.join(__dirname,'field-procedure-audio-browser.fixture.tsx')],outfile:path.join(out,'fixture.js'),jsx:'automatic'});
const js=compiled.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=compiled.outputFiles.find(f=>f.path.endsWith('.css')).contents;
assert.equal(/\bprocess\.env\.NEXT_PUBLIC_/.test(Buffer.from(js).toString('utf8')),false);
const cjs=esbuild.buildSync({...common,entryPoints:[path.join(app,'lib/field-procedure-audio-recorder.ts')],platform:'node',format:'cjs'}).outputFiles[0].text;
const mod={exports:{}};new Function('module','exports','require',cjs)(mod,mod.exports,require);
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}
  if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  if(req.url==='/favicon.ico'){res.statusCode=204;return res.end();}
  if(req.url!=='/'){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
(async()=>{
 const nodeCases=await require('./field-procedure-audio-checks.cjs')(mod.exports);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,reports=[];
 try{for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}}),outside=[],errors=[];
   await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')&&!route.request().url().startsWith('blob:'+origin+'/')){outside.push(route.request().url());return route.abort();}return route.continue();});
   await context.addInitScript(()=>{
    const fake={mode:'live',requests:0,streams:[],contexts:[],release:null};window.microphoneFixture=fake;
    fake.getUserMedia=async constraints=>{
      fake.requests++;if(constraints.video!==false||constraints.audio!==true)throw Error('Unexpected media constraints');
      if(fake.mode==='deny')throw new DOMException('Synthetic denial','NotAllowedError');
      const audio=new AudioContext(),source=audio.createOscillator(),destination=audio.createMediaStreamDestination();
      source.connect(destination);source.start();await audio.resume();fake.contexts.push(audio);fake.streams.push(destination.stream);
      if(fake.mode==='hold')await new Promise(resolve=>fake.release=resolve);return destination.stream;
    };
    // WebKit may discard an unretained MediaDevices wrapper and its own properties.
    // Install on the shared prototype so each wrapper uses this synthetic source.
    // MediaRecorder, Web Audio encoding/decoding and IndexedDB remain native.
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices),'getUserMedia',{configurable:true,writable:true,value:fake.getUserMedia});
   });
   const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR '+name+' '+e.message);});await page.goto(origin);
   const capabilities=await page.evaluate(()=>({secure:isSecureContext,visibility:document.visibilityState,ownMicrophoneMethod:Object.hasOwn(navigator.mediaDevices,'getUserMedia'),domExceptionIsError:new DOMException('synthetic','NotAllowedError') instanceof Error,recorder:typeof MediaRecorder,probe:typeof MediaRecorder==='undefined'?'absent':typeof MediaRecorder.isTypeSupported,microphone:typeof navigator.mediaDevices?.getUserMedia,formats:Object.fromEntries(['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].map(mime=>[mime,typeof MediaRecorder!=='undefined'&&typeof MediaRecorder.isTypeSupported==='function'&&MediaRecorder.isTypeSupported(mime)]))}));
   console.log('CAPABILITIES '+name+' '+JSON.stringify(capabilities));fs.writeFileSync(path.join(out,name+'-capabilities.json'),JSON.stringify(capabilities,null,2));
   assert.equal(await page.evaluate(()=>navigator.mediaDevices.getUserMedia===microphoneFixture.getUserMedia),true,'synthetic microphone installed in the application realm');
   const start=page.getByRole('button',{name:'Grabar audio',exact:true}),stop=page.getByRole('button',{name:'Detener y guardar audio',exact:true});
   await start.waitFor();assert.equal(await page.evaluate(()=>microphoneFixture.requests),0,'no microphone on render');
   await page.evaluate(()=>microphoneFixture.mode='deny');await start.click();
   await page.waitForTimeout(500);
   const deniedProbe=await page.evaluate(()=>({visibility:document.visibilityState,requests:microphoneFixture.requests,mode:microphoneFixture.mode,text:document.querySelector('main').innerText,receipt:{...document.querySelector('#receipt').dataset},storedUsers:Object.keys(localStorage).map(k=>{try{return JSON.parse(localStorage.getItem(k)).uid||null;}catch{return null;}}).filter(Boolean)}));
   console.log('DENIED_PROBE '+name+' '+JSON.stringify(deniedProbe));fs.writeFileSync(path.join(out,name+'-denial-probe.json'),JSON.stringify(deniedProbe,null,2));
   await page.getByRole('alert').filter({hasText:/denegado/}).waitFor();assert.equal(await page.evaluate(()=>microphoneFixture.requests),1,'denial uses the synthetic microphone');assert.equal(await page.locator('#receipt').getAttribute('data-count'),'0');
   await page.evaluate(()=>microphoneFixture.mode='hold');await start.click();await page.waitForFunction(()=>typeof microphoneFixture.release==='function');await page.getByRole('button',{name:'Cancelar solicitud de micrófono'}).click();await page.evaluate(()=>microphoneFixture.release());await page.waitForFunction(()=>microphoneFixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.equal(await page.locator('#receipt').getAttribute('data-count'),'0');
   await page.evaluate(()=>microphoneFixture.mode='live');await start.click();await stop.waitFor();await page.getByRole('button',{name:'Salir del procedimiento'}).click();assert.equal(await page.evaluate(()=>audioFixture.exits),0,'recording blocks app exit');
   await page.waitForTimeout(1300);await stop.click();await page.waitForFunction(()=>document.querySelector('#receipt').dataset.count==='1'&&document.querySelector('#receipt').dataset.busy==='false');
   assert.equal(await page.locator('#receipt').getAttribute('data-source'),'recorder');const hash=await page.locator('#receipt').getAttribute('data-sha');assert.match(hash,/^[a-f0-9]{64}$/);
   await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&a.readyState>=2&&!a.error;});
   assert.equal(await page.evaluate(()=>microphoneFixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
   await page.reload();await page.waitForFunction(()=>document.querySelector('#receipt').dataset.count==='1');assert.equal(await page.locator('#receipt').getAttribute('data-sha'),hash,'reload preserves exact original');
   assert.equal(await page.evaluate(()=>navigator.mediaDevices.getUserMedia===microphoneFixture.getUserMedia),true,'synthetic microphone reinstalled after reload');
   // One failed IndexedDB write; retry must store exactly the already-recorded bytes.
   await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){IDBObjectStore.prototype.add=add;throw new DOMException('Synthetic quota','QuotaExceededError');};});
   await start.click();await stop.waitFor();await page.evaluate(()=>audioFixture.revision(99));await page.waitForTimeout(1300);await stop.click();
   await page.getByRole('button',{name:'Reintentar guardar audio'}).waitFor();await page.getByRole('button',{name:'Salir del procedimiento'}).click();assert.equal(await page.evaluate(()=>audioFixture.exits),0,'unprotected original blocks exit');
   await page.getByRole('button',{name:'Reintentar guardar audio'}).click();await page.waitForFunction(()=>document.querySelector('#receipt').dataset.count==='2'&&document.querySelector('#receipt').dataset.busy==='false');
   assert.equal(await page.locator('#receipt').getAttribute('data-revision'),'7','keep revision from recording start, not save time');
   const attempts=await page.evaluate(()=>audioFixture.attempts);assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1],'retry preserves the same original');
   await start.click();await stop.waitFor();await page.waitForTimeout(1000);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForFunction(()=>document.querySelector('#receipt').dataset.count==='3'&&document.querySelector('#receipt').dataset.busy==='false');await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await page.evaluate(()=>microphoneFixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true,'backgrounding releases microphone');
   await page.evaluate(()=>microphoneFixture.mode='hold');await start.click();await page.waitForFunction(()=>typeof microphoneFixture.release==='function');await page.evaluate(()=>{audioFixture.switchAccount('audio-test-other');microphoneFixture.release();});
   await page.waitForFunction(()=>document.querySelector('#receipt').dataset.count==='0'&&microphoneFixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
   assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
   const checks=['explicit microphone request only','denied permission','late permission cancelled','navigation guard while recording','native encoding and native playback','original survives reload','quota failure retains original','same original retry','pinned coordination revision','background stop and protection','account switch releases late stream','no external requests or page errors'];
   reports.push({browser:name,passed:true,checks});console.log('PASS native audio '+name+' '+checks.length+' checks');await context.close();
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({synthetic:true,nodeCases,sourceHead:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(app,'../..'),encoding:'utf8'}).trim(),notClaimed:['physical microphone','production backend','physical phone'],reports},null,2));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
