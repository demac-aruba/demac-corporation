'use strict';
// Real component, deterministic synthetic adapter; all external traffic is blocked.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const http = require('node:http'); const os = require('node:os');
const app = path.resolve(__dirname, '..'); const tooling = process.env.QBO_TEST_TOOLS; const output = process.env.QBO_TEST_OUTPUT;
if (![tooling, output].every(value => value && path.isAbsolute(value))) throw Error('Absolute tooling/output paths required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-catalog-browser-')); fs.mkdirSync(output, { recursive: true });
  await build({ absWorkingDir: app, tsconfig: path.join(app, 'tsconfig.json'), bundle: true, outfile: path.join(folder, 'fixture.js'), jsx: 'automatic',
    stdin: { resolveDir: app, loader: 'tsx', contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {QuickBooksCatalog} from './components/firebase/quickbooks-catalog';import './app/globals.css';
      function Harness(){const [uid,setUid]=useState('owner'),[visible,setVisible]=useState(true);window.changeUid=setUid;window.hide=()=>setVisible(false);
      return <main style={{padding:20,maxWidth:1000,margin:'auto'}}><h1>DEMAC · Prueba con datos ficticios</h1>{visible?<QuickBooksCatalog uid={uid}/>:<p>Cerrado</p>}</main>}
      createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);` },
    plugins: [{ name: 'synthetic-catalog', setup(builder) {
      builder.onResolve({ filter: /lib\/firebase\/quickbooks-catalog$/ }, () => ({ path: 'catalog', namespace: 'synthetic' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ loader: 'js', contents: `
        export const catalogFailureMessage=()=> 'La consulta de catálogos todavía está pendiente de activación.';
        export async function readProductionCatalog(uid,input){window.calls.push({uid,input});if(window.waiting)await new Promise(resolve=>window.release=resolve);
          if(window.fail)throw Error('private error');const count=input.startPosition===1?100:0;
          return {environment:'production',realmId:'9130352327074466',companyName:'DEMAC · Ficticio',fetchedAt:'2026-10-14T12:00:00Z',request:input,
          accountingWritesEnabled:false,syncEnabled:false,catalog:{pageSize:100,nextStartPosition:count?101:null,atLimit:false,endOfCurrentQuery:!count,
          records:Array.from({length:count},(_,i)=>({id:String(i+1),name:i<2?'Cliente de prueba':'Artículo '+i,active:i!==1,type:input.entity==='Item'?'Service':null,currency:'AWG'}))}};}
        export async function readErpComparisonRows(){window.erpReads++;return [{id:'erp1',name:'Cliente de prueba',active:true},{id:'erp2',name:'Otro cliente',active:true}]}` }));
    } }],
  });
  const server = http.createServer((req,res) => { const asset = req.url === '/fixture.js' ? 'fixture.js' : req.url === '/fixture.css' ? 'fixture.css' : null;
    res.setHeader('Content-Type',asset?.endsWith('.js')?'text/javascript':asset?'text/css':'text/html');
    res.end(asset?fs.readFileSync(path.join(folder,asset)):'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,...(process.env.QBO_TEST_CHROMIUM?{executablePath:process.env.QBO_TEST_CHROMIUM}:{})});
  try {
    for(const width of [1280,375]) {
      const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];const external=[];
      page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();external.push(r.request().url());return r.abort();});
      await page.addInitScript(()=>{window.calls=[];window.erpReads=0;window.fail=false;window.waiting=false;});
      await page.goto(origin);await page.getByRole('heading',{name:'Preparar emparejamiento'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0);
      await page.evaluate(()=>{window.waiting=true;document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit();});
      await page.waitForFunction(()=>window.calls.length===1);await page.evaluate(()=>{window.waiting=false;window.release();});
      await page.getByText('Varias coincidencias: revisar',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.erpReads),1);
      await page.getByRole('cell',{name:'Sin coincidencia en esta página',exact:true}).waitFor();
      await page.screenshot({path:path.join(output,`catalog-${width}.png`),fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page-level horizontal overflow');
      await page.getByRole('button',{name:'Página siguiente'}).click();await page.getByText('Fin de esta consulta.',{exact:false}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Página siguiente'}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.calls.at(-1).input.startPosition),101);
      await page.getByLabel('Catálogo para comparar').selectOption('Item');assert.equal(await page.getByRole('region',{name:'Comparación provisional'}).count(),0);
      await page.getByRole('button',{name:'Consultar para comparar'}).click();await page.getByRole('region',{name:'Comparación provisional'}).waitFor();
      await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Consultar para comparar'}).click();await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('region',{name:'Catálogo de QuickBooks'}).count(),0);assert.equal(await page.getByText('private error').count(),0);
      await page.evaluate(()=>{window.fail=false;window.waiting=true;});await page.getByRole('button',{name:'Consultar para comparar'}).click();
      const readsBefore=await page.evaluate(()=>window.erpReads);await page.evaluate(()=>window.changeUid('other'));
      await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);
      await page.evaluate(()=>{window.waiting=false;window.release();});
      assert.equal(await page.getByRole('region',{name:'Catálogo de QuickBooks'}).count(),0);assert.equal(await page.evaluate(()=>window.erpReads),readsBefore);
      await page.evaluate(()=>window.waiting=true);await page.getByRole('button',{name:'Consultar para comparar'}).click();
      await page.evaluate(()=>window.hide());await page.getByText('Cerrado',{exact:true}).waitFor();await page.evaluate(()=>window.release());
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
      console.log(`Catalog browser ${width}: PASS (explicit reads, duplicate click, ambiguity, partial page, pagination, input/identity/unmount invalidation, errors, overflow).`);
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
