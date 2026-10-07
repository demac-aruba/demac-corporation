'use strict';
// Real hook and IndexedDB, synthetic account, no server authorization/physical safety claim.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const tools=process.env.FIELD_PORTAL_TEST_TOOLS;if(!tools)throw Error('Expected isolated tools');
const esbuild=require(path.join(tools,'node_modules/esbuild')),{chromium,webkit}=require(path.join(tools,'node_modules/playwright'));
const app=path.resolve(__dirname,'..'),out=process.env.FIELD_FORM_EVIDENCE||path.join(app,'.field-form-evidence');fs.mkdirSync(out,{recursive:true});
const settings={ISOLATED_PREVIEW:'true',FIREBASE_API_KEY:'synthetic',FIREBASE_PROJECT_ID:'demo-demac-dwellings',FIREBASE_AUTH_DOMAIN:'demo-demac-dwellings.invalid',FIREBASE_STORAGE_BUCKET:'demo-demac-dwellings.appspot.com',FIREBASE_APP_ID:'synthetic',FIREBASE_MESSAGING_SENDER_ID:'0',FIREBASE_MEASUREMENT_ID:''};
const define=Object.fromEntries(Object.entries(settings).map(([k,v])=>['process.env.NEXT_PUBLIC_'+k,JSON.stringify(v)]));
const js=esbuild.buildSync({entryPoints:[path.join(__dirname,'field-procedure-form-browser.fixture.tsx')],bundle:true,write:false,jsx:'automatic',tsconfig:path.join(app,'tsconfig.json'),define}).outputFiles[0].text;
assert.equal(/\bprocess\.env\.NEXT_PUBLIC_/.test(js),false);
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');});
const protectedDraft=p=>p.waitForFunction(()=>{const s=document.querySelector('#state');return s?.dataset.ready==='true'&&s.dataset.saving==='false'&&!s.dataset.error;});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,reports=[];
 try{for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});try{
   const context=await browser.newContext({viewport:{width:390,height:844}}),outside=[],errors=[];
   await context.route('**/*',r=>{if(!r.request().url().startsWith(origin+'/')){outside.push(r.request().url());return r.abort();}return r.continue();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await protectedDraft(page);
   await page.getByLabel('Nota',{exact:true}).fill('Texto original rápido · áéíóú');await page.getByLabel('Persona',{exact:true}).fill('Persona sintética');await page.getByLabel('Confirmación física nueva').check();await protectedDraft(page);
   await page.reload();await protectedDraft(page);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'Texto original rápido · áéíóú');assert.equal(await page.getByLabel('Persona',{exact:true}).inputValue(),'Persona sintética');assert.equal(await page.getByLabel('Confirmación física nueva').isChecked(),false);
   await context.setOffline(true);await page.getByLabel('Nota',{exact:true}).fill('Borrador durante desconexión');await protectedDraft(page);await context.setOffline(false);await page.reload();await protectedDraft(page);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'Borrador durante desconexión');
   await page.evaluate(()=>formFixture.scope('other-step'));await protectedDraft(page);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'');await page.evaluate(()=>formFixture.scope('coordination'));await protectedDraft(page);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'Borrador durante desconexión');
   await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='forms'){IDBObjectStore.prototype.put=put;throw new DOMException('Synthetic quota','QuotaExceededError');}return put.apply(this,args);};});
   await page.getByLabel('Nota',{exact:true}).fill('Original conservado tras fallo de almacenamiento');await page.getByRole('button',{name:'Reintentar guardar formulario',exact:true}).waitFor();assert.equal(await page.evaluate(()=>formFixture.canExit()),false);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'Original conservado tras fallo de almacenamiento');
   await page.getByRole('button',{name:'Reintentar guardar formulario',exact:true}).click();await protectedDraft(page);assert.equal(await page.evaluate(()=>formFixture.canExit()),true);
   await page.getByLabel('Nota',{exact:true}).fill('x'.repeat(5001));await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>formFixture.canExit()),false);assert.equal(await page.evaluate(async()=>JSON.parse((await formFixture.store.readProcedureForm(formFixture.target,'coordination')).value).note),'Original conservado tras fallo de almacenamiento','oversized field must not corrupt the recoverable original');await page.getByLabel('Nota',{exact:true}).fill('Texto dentro del límite');await page.getByRole('button',{name:'Reintentar guardar formulario',exact:true}).click();await protectedDraft(page);
   const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(origin);await protectedDraft(other);
   await page.getByLabel('Nota',{exact:true}).fill('Primera pestaña confirmada');await protectedDraft(page);
   await other.getByLabel('Nota',{exact:true}).fill('Segunda pestaña en conflicto');await other.getByRole('button',{name:'Reintentar guardar formulario',exact:true}).click();
   await other.getByText('Primera pestaña confirmada',{exact:true}).waitFor();assert.equal(await other.getByLabel('Nota',{exact:true}).inputValue(),'Segunda pestaña en conflicto');assert.equal(await other.evaluate(()=>formFixture.canExit()),false);
   assert.equal(await other.evaluate(async()=>JSON.parse((await formFixture.store.readProcedureForm(formFixture.target,'coordination')).value).note),'Primera pestaña confirmada','stale writer cannot overwrite');
   await other.getByRole('button',{name:'Comparé los borradores; conservar mi texto',exact:true}).click();await protectedDraft(other);await other.reload();await protectedDraft(other);assert.equal(await other.getByLabel('Nota',{exact:true}).inputValue(),'Segunda pestaña en conflicto');await other.close();
   await page.evaluate(()=>formFixture.account('test-helper'));await protectedDraft(page);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'');await page.getByLabel('Nota',{exact:true}).fill('Texto de otra cuenta');await protectedDraft(page);await page.evaluate(()=>formFixture.account('test-tech'));await protectedDraft(page);assert.equal(await page.getByLabel('Nota',{exact:true}).inputValue(),'Segunda pestaña en conflicto');
   await page.evaluate(async()=>{const s=formFixture.store,row=await s.readProcedureForm(formFixture.target,'coordination');await s.saveProcedureForm(formFixture.target,'coordination','unparseable-original',row.revision);});await page.reload();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Nota',{exact:true}).isDisabled(),true);assert.equal(await page.evaluate(async()=>(await formFixture.store.readProcedureForm(formFixture.target,'coordination')).value),'unparseable-original','unreadable original is never silently replaced');
   assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
   const checks=['rapid fields survive reload','physical confirmation is not restored','offline authored text survives','scope isolation','quota failure retains original and blocks exit','explicit same-text retry','stale tab cannot overwrite','explicit conflict comparison and resolution','account isolation','malformed original preserved','oversized field preserves durable original and blocks exit','shortened text can be explicitly retried','no external requests or page errors'];
   reports.push({browser:name,passed:true,checks});console.log('PASS form recovery '+name+' '+checks.length+' checks');await context.close();
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({synthetic:true,reports},null,2));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
